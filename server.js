import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.WCHESS_DATA_FILE || '/workspace/wchess-data.json';
const PORT = Number(process.env.PORT || 4173);
const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ONLINE_MS = 25000;
let store = { players: {}, requests: {}, matches: {} };
try {
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  store = { players: parsed.players || {}, requests: parsed.requests || {}, matches: parsed.matches || {} };
} catch { /* first run */ }

function persist() {
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(store)); fs.renameSync(tmp, DATA_FILE); } catch (err) { console.error('Could not save WChess data:', err.message); }
}
function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
function cleanName(value) {
  const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 22);
  return name || 'Player';
}
function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(id); }
function online(player) { return !!player && Date.now() - Number(player.lastSeen || 0) < ONLINE_MS; }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 70000) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function personView(player) {
  return { id: player.id, name: player.name, online: online(player), lastSeen: player.lastSeen || 0 };
}
function roomView(room) {
  const host = store.players[room.hostId];
  const guest = room.guestId ? store.players[room.guestId] : null;
  return { ...room, hostName: host?.name || room.hostName || 'Host', guestName: guest?.name || room.guestName || null };
}
function routeError(res, status, message) { send(res, status, { error: message }); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, app: 'WChess', onlinePlayers: Object.values(store.players).filter(online).length });

    if (req.method === 'POST' && pathname === '/api/presence') {
      const body = await readBody(req);
      if (!validId(body.id)) return routeError(res, 400, 'Invalid player ID.');
      const existing = store.players[body.id] || { id: body.id, friends: [] };
      existing.name = cleanName(body.name);
      existing.lastSeen = Date.now();
      existing.friends = Array.isArray(existing.friends) ? existing.friends : [];
      store.players[body.id] = existing;
      persist();
      return send(res, 200, { player: personView(existing) });
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const id = url.searchParams.get('userId');
      if (!validId(id) || !store.players[id]) return routeError(res, 404, 'Player not found.');
      const player = store.players[id];
      const friends = (player.friends || []).map(fid => store.players[fid]).filter(Boolean).map(personView);
      const requests = Object.values(store.requests);
      const incoming = requests.filter(r => r.toId === id && r.status === 'pending').map(r => ({ ...r, from: personView(store.players[r.fromId] || { id:r.fromId, name:'Player', lastSeen:0 }) }));
      const outgoing = requests.filter(r => r.fromId === id && r.status === 'pending');
      const matches = Object.values(store.matches).filter(m => m.status === 'open' || m.hostId === id || m.guestId === id).map(roomView).sort((a,b) => b.createdAt - a.createdAt);
      const players = Object.values(store.players).filter(p => p.id !== id && online(p)).map(personView).sort((a,b) => a.name.localeCompare(b.name));
      return send(res, 200, { me: personView(player), players, friends, incoming, outgoing, matches });
    }

    if (req.method === 'POST' && pathname === '/api/friends/request') {
      const body = await readBody(req);
      const { fromId, toId } = body;
      if (!validId(fromId) || !validId(toId) || fromId === toId || !store.players[fromId] || !store.players[toId]) return routeError(res, 400, 'Choose a valid player.');
      const from = store.players[fromId], to = store.players[toId];
      if ((from.friends || []).includes(toId)) return routeError(res, 409, 'You are already friends.');
      const duplicate = Object.values(store.requests).some(r => r.status === 'pending' && ((r.fromId === fromId && r.toId === toId) || (r.fromId === toId && r.toId === fromId)));
      if (duplicate) return routeError(res, 409, 'A friend request is already pending.');
      const request = { id: randomUUID(), fromId, toId, status: 'pending', createdAt: Date.now() };
      store.requests[request.id] = request; persist();
      return send(res, 201, { request });
    }

    if (req.method === 'POST' && pathname === '/api/friends/respond') {
      const body = await readBody(req);
      const request = store.requests[String(body.requestId || '')];
      if (!request || request.toId !== body.userId || request.status !== 'pending') return routeError(res, 404, 'That request is no longer available.');
      request.status = body.accept ? 'accepted' : 'declined';
      if (body.accept) {
        const a = store.players[request.fromId], b = store.players[request.toId];
        if (a && b) { a.friends = [...new Set([...(a.friends || []), b.id])]; b.friends = [...new Set([...(b.friends || []), a.id])]; }
      }
      persist();
      return send(res, 200, { ok: true, status: request.status });
    }

    if (req.method === 'POST' && pathname === '/api/matches') {
      const body = await readBody(req);
      if (!validId(body.playerId) || !store.players[body.playerId]) return routeError(res, 401, 'Set your player name before hosting.');
      const id = randomBytes(4).toString('hex').toUpperCase();
      const room = { id, hostId: body.playerId, guestId: null, status: 'open', fen: DEFAULT_FEN, pgn: '', turn: 'w', result: '', createdAt: Date.now(), updatedAt: Date.now() };
      store.matches[id] = room; persist();
      return send(res, 201, { match: roomView(room) });
    }

    if (req.method === 'GET' && pathname === '/api/matches') {
      const matches = Object.values(store.matches).filter(m => m.status === 'open').map(roomView).sort((a,b) => b.createdAt - a.createdAt);
      return send(res, 200, { matches });
    }

    const joinMatch = pathname.match(/^\/api\/matches\/([A-Z0-9]+)\/join$/);
    if (req.method === 'POST' && joinMatch) {
      const body = await readBody(req), room = store.matches[joinMatch[1]], id = body.playerId;
      if (!room || room.status === 'closed') return routeError(res, 404, 'Match not found.');
      if (!validId(id) || !store.players[id]) return routeError(res, 401, 'Set your player name before joining.');
      if (id === room.hostId) return send(res, 200, { match: roomView(room), color: 'w' });
      if (room.guestId && room.guestId !== id) return routeError(res, 409, 'This match already has two players.');
      room.guestId = id; room.status = 'active'; room.updatedAt = Date.now(); persist();
      return send(res, 200, { match: roomView(room), color: 'b' });
    }

    const matchPath = pathname.match(/^\/api\/matches\/([A-Z0-9]+)(?:\/(state|leave))?$/);
    if (matchPath) {
      const [, roomId, action] = matchPath;
      const room = store.matches[roomId];
      if (!room) return routeError(res, 404, 'Match not found.');
      if (req.method === 'GET' && (!action || action === 'state')) {
        const id = url.searchParams.get('userId');
        if (id !== room.hostId && id !== room.guestId) return routeError(res, 403, 'You are not in this match.');
        return send(res, 200, { match: roomView(room), color: id === room.hostId ? 'w' : 'b' });
      }
      if (req.method === 'POST' && action === 'state') {
        const body = await readBody(req);
        if (body.playerId !== room.hostId && body.playerId !== room.guestId) return routeError(res, 403, 'You are not in this match.');
        if (typeof body.fen !== 'string' || body.fen.length > 200 || typeof body.pgn !== 'string' || body.pgn.length > 10000) return routeError(res, 400, 'Invalid game state.');
        room.fen = body.fen; room.pgn = body.pgn; room.turn = body.turn === 'b' ? 'b' : 'w'; room.result = String(body.result || '').slice(0, 100); room.updatedAt = Date.now();
        persist(); return send(res, 200, { ok: true, updatedAt: room.updatedAt });
      }
      if (req.method === 'POST' && action === 'leave') {
        const body = await readBody(req);
        if (body.playerId === room.hostId) room.status = 'closed';
        else if (body.playerId === room.guestId) { room.guestId = null; room.status = 'open'; room.fen = DEFAULT_FEN; room.pgn = ''; room.turn = 'w'; room.result = ''; }
        else return routeError(res, 403, 'You are not in this match.');
        room.updatedAt = Date.now(); persist(); return send(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET') {
      if (pathname === '/downloads/WChess.apk') {
        const file = path.join(ROOT, 'downloads', 'WChess.apk');
        if (!fs.existsSync(file)) return routeError(res, 404, 'Android app download not found.');
        res.writeHead(200, {
          'content-type':'application/vnd.android.package-archive',
          'content-disposition':'attachment; filename="WChess-1.6.apk"',
          'content-length':fs.statSync(file).size,
          'cache-control':'no-cache',
          'x-content-type-options':'nosniff'
        });
        return fs.createReadStream(file).pipe(res);
      }
      const safe = new Set(['/','/index.html','/app.js','/chess.js','/layout.css','/ai-worker.js','/ai-engine.js','/training-ui.js','/training-puzzles.js']);
      const file = pathname === '/' ? path.join(ROOT, 'index.html') : safe.has(pathname) ? path.join(ROOT, pathname.slice(1)) : null;
      if (!file) return routeError(res, 404, 'Not found.');
      const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': pathname === '/' ? 'no-cache' : 'public, max-age=60', 'x-content-type-options':'nosniff', 'referrer-policy':'strict-origin-when-cross-origin' });
      return fs.createReadStream(file).pipe(res);
    }
    return routeError(res, 404, 'Not found.');
  } catch (error) {
    console.error('Request error:', error.message);
    if (!res.headersSent) routeError(res, 400, error.message === 'Invalid JSON' ? 'Invalid request.' : 'Request could not be processed.');
  }
});

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24;
  for (const [id, room] of Object.entries(store.matches)) if (room.createdAt < cutoff || room.status === 'closed' && room.updatedAt < Date.now() - 1000 * 60 * 60) delete store.matches[id];
  for (const [id, request] of Object.entries(store.requests)) if (request.createdAt < cutoff) delete store.requests[id];
  persist();
}, 60_000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`WChess server listening on port ${PORT}`));

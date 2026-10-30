import { Chess } from './chess.js';

const game = new Chess();
const $ = id => document.getElementById(id);
const board = $('board');
const symbols = { w: { k:'♔', q:'♕', r:'♖', b:'♗', n:'♘', p:'♙' }, b: { k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' } };
const names = { k:'king', q:'queen', r:'rook', b:'bishop', n:'knight', p:'pawn' };
const colors = { w:'White', b:'Black' };
const idKey = 'wchess-player-id';
const nameKey = 'wchess-player-name';
const newId = () => globalThis.crypto?.randomUUID?.() || `wchess-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
let playerId = localStorage.getItem(idKey) || newId();
let displayName = localStorage.getItem(nameKey) || `Player ${playerId.slice(0,4).toUpperCase()}`;
localStorage.setItem(idKey, playerId);
let selected = null;
let flipped = false;
let pending = null;
let legal = [];
let activeMatchId = null;
let matchMeta = null;
let myColor = null;
let lastSyncedPgn = '';
let lastLocalMoveAt = 0;
let refreshTimer = null;
let toastTimer = null;
let aiMode = false;
let aiLevel = 'intermediate';
let aiColor = 'b';
let aiWorker = null;
let aiThinking = false;
let aiRequestId = 0;
const AI_LEVELS = { beginner:'Beginner', intermediate:'Intermediate', expert:'Expert' };
const soundKey = 'wchess-sound';
let soundEnabled = localStorage.getItem(soundKey) !== 'off';
let audioContext = null;
let animateMove = false;

async function api(path, options={}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'content-type':'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function post(path, body) { return api(path, { method:'POST', body:JSON.stringify(body) }); }

function resultText() {
  if (game.isCheckmate()) {
    const winner=game.turn()==='w'?'b':'w';
    const victory=aiMode ? (winner===aiColor?'WChess AI wins.':'You win!') : `${colors[winner]} wins.`;
    return { title:'Checkmate!', detail:`${victory} That was a fine finish. Fancy another?`, over:true, state:'checkmate' };
  }
  if (game.isStalemate()) return { title:'A draw by stalemate', detail:'No legal moves, and no check. The game ends level.', over:true, state:'draw' };
  if (game.isThreefoldRepetition()) return { title:'A draw by repetition', detail:'The same position came around three times.', over:true, state:'draw' };
  if (game.isInsufficientMaterial()) return { title:'A draw — not enough pieces', detail:'Neither side has enough left to force checkmate.', over:true, state:'draw' };
  if (game.isDraw()) return { title:'A draw', detail:'Fifty moves without a pawn move or capture. Fair enough.', over:true, state:'draw' };
  if (activeMatchId && matchMeta?.status === 'open') return { title:'Your table is ready', detail:'Send the invite to a friend, or keep an eye out for them.', over:false, state:'ready' };
  const checked=game.isCheck();
  let detail = checked ? `${colors[game.turn()]} is in check. Find a safe move.` : selected ? `${colors[game.turn()]} ${names[game.get(selected).type]} picked. Choose a highlighted square.` : game.history().length ? 'No rush. Look over the board and choose your move.' : 'White has the first move. Select a piece to see your options.';
  if (activeMatchId && myColor !== game.turn()) {
    const opponent=matchMeta?.[game.turn() === 'w' ? 'hostName' : 'guestName'] || 'your opponent';
    detail=checked ? `${colors[game.turn()]} is in check. Waiting for ${opponent} to respond.` : `Waiting for ${opponent} to make a move.`;
  }
  if (aiMode) {
    detail=game.turn()===aiColor ? (aiThinking ? `${AI_LEVELS[aiLevel]} is thinking…` : `${AI_LEVELS[aiLevel]} is ready when you are.`) : selected ? `${colors[game.turn()]} ${names[game.get(selected).type]} picked. Choose a highlighted square.` : 'Your move. The computer will take its turn after you.';
    if (checked) detail=game.turn()===aiColor ? `${AI_LEVELS[aiLevel]} is in check and ${aiThinking?'searching for a safe move':'must find a safe move'}.` : 'Your king is in check. Find a safe move.';
  }
  const turn=aiMode ? (game.turn()===aiColor ? `${AI_LEVELS[aiLevel]} AI to move` : 'Your move') : `${colors[game.turn()]} to move`;
  return { title:checked ? `Check — ${turn}` : turn, detail, over:false, state:checked?'check':game.history().length?'playing':'ready' };
}

function render() {
  const history = game.history({ verbose:true });
  const last = history.at(-1);
  const ranks = flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  const files = flipped ? 'hgfedcba' : 'abcdefgh';
  const targets = new Set(legal.map(move => move.to));
  const moving = animateMove;
  const fragment = document.createDocumentFragment();
  ranks.forEach((rank, row) => [...files].forEach((file, col) => {
    const square = `${file}${rank}`;
    const piece = game.get(square);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `square ${(file.charCodeAt(0) - 97 + rank) % 2 ? 'dark' : 'light'}`;
    if (last && (last.from === square || last.to === square)) button.classList.add('last');
    if (moving && last?.to === square) button.classList.add('arriving', ...(last.captured ? ['capture-moment'] : []));
    if (selected === square) button.classList.add('selected');
    if (targets.has(square)) button.classList.add('legal', ...(piece ? ['capture'] : []));
    if (piece && piece.type === 'k' && piece.color === game.turn() && game.isCheck()) button.classList.add('checked');
    button.dataset.square = square;
    button.setAttribute('aria-label', `${square}${piece ? `, ${colors[piece.color]} ${names[piece.type]}` : ', empty'}${targets.has(square) ? ', legal destination' : ''}`);
    button.setAttribute('aria-pressed', String(selected === square));
    if (piece) {
      const span = document.createElement('span');
      span.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
      span.textContent = symbols[piece.color][piece.type];
      span.setAttribute('aria-hidden','true');
      button.append(span);
    }
    if (col === 0) { const label = document.createElement('span'); label.className='coord rank'; label.textContent=rank; label.setAttribute('aria-hidden','true'); button.append(label); }
    if (row === 7) { const label = document.createElement('span'); label.className='coord file'; label.textContent=file; label.setAttribute('aria-hidden','true'); button.append(label); }
    button.addEventListener('click', () => onSquare(square));
    fragment.append(button);
  }));
  board.replaceChildren(fragment);
  if (moving && last?.from && last?.to) {
    const source=board.querySelector(`[data-square="${last.from}"]`);
    const piece=board.querySelector(`[data-square="${last.to}"] .piece`);
    if (source && piece) {
      const from=source.getBoundingClientRect(), to=piece.getBoundingClientRect();
      if (typeof piece.animate==='function') piece.animate([
        { transform:`translate(${from.left-to.left}px, ${from.top-to.top}px) scale(.88)`, opacity:.75 },
        { transform:'translateY(-1px) scale(1)', opacity:1 }
      ],{ duration:360, easing:'cubic-bezier(.2,.86,.22,1.13)' });
      else piece.classList.add('arriving');
    }
  }
  animateMove = false;
  board.setAttribute('aria-label', `Chessboard, ${flipped ? 'Black' : 'White'} at bottom`);
  const status = resultText();
  $('status').textContent=status.title;
  $('status-detail').textContent=status.detail;
  $('status-panel').dataset.state=status.state || (status.over?'finished':history.length?'playing':'ready');
  const badge=$('game-badge');
  badge.textContent=status.state==='check'?'Check!':status.state==='checkmate'?'Checkmate':activeMatchId ? (matchMeta?.status === 'open' ? 'Waiting for player' : 'Online match') : aiMode ? `${AI_LEVELS[aiLevel]} AI` : status.over ? 'That’s the game' : history.length ? 'A game in progress' : 'Ready for the first move';
  badge.closest('.pill').classList.toggle('is-check',status.state==='check');
  badge.closest('.pill').classList.toggle('is-mate',status.state==='checkmate');
  $('move-number').textContent=`Move ${Math.floor(history.length / 2) + 1}`;
  $('turn-icon').textContent=symbols[game.turn()].k;
  $('turn-icon').style.background=game.turn() === 'w' ? '#f0dec9' : '#4a304a';
  $('turn-icon').style.color=game.turn() === 'w' ? '#402b3a' : '#f8ece3';
  $('turn-icon').classList.toggle('in-check',game.isCheck());
  updateSoundButton();
  $('undo').disabled=!history.length || !!activeMatchId || aiThinking;
  updatePlayer('top-player', flipped ? 'w' : 'b', status.over);
  updatePlayer('bottom-player', flipped ? 'b' : 'w', status.over);
  renderHistory(history);
}

function updatePlayer(id, color, over) {
  const player=$(id);
  player.querySelector('.player-name').textContent = activeMatchId && matchMeta
    ? (color === myColor ? `${displayName} (you)` : color === 'w' ? matchMeta.hostName || 'White' : matchMeta.guestName || 'Waiting for player')
    : aiMode ? (color===aiColor ? 'WChess AI' : `${displayName} (you)`) : colors[color];
  player.querySelector('.player-avatar').textContent=symbols[color].p;
  player.querySelector('.player-avatar').classList.toggle('black',color==='b');
  player.querySelector('.player-tag').textContent=activeMatchId ? (color === myColor ? 'Your side' : 'Opponent') : aiMode ? (color===aiColor ? `${AI_LEVELS[aiLevel]} computer` : 'Your side') : color==='w' ? 'The first move' : 'The challenger';
  player.querySelector('.turn-label').classList.toggle('active',game.turn()===color && !over);
}

function renderHistory(history) {
  $('history-count').textContent=`${history.length} ${history.length===1 ? 'move' : 'moves'}`;
  const container=$('history');
  if (!history.length) {
    container.innerHTML='<div class="history-empty"><span class="empty-symbol" aria-hidden="true">♘</span><p>The first move is yours.</p></div>';
    return;
  }
  const fragment=document.createDocumentFragment();
  for (let i=0;i<history.length;i+=2) {
    const row=document.createElement('div'); row.className='move-row';
    const number=document.createElement('span'); number.className='n'; number.textContent=`${i/2+1}.`; row.append(number);
    for (let j=0;j<2;j++) {
      const move=document.createElement('span'); move.className='san';
      if (i+j===history.length-1) move.classList.add('recent');
      move.textContent=history[i+j]?.san || '—';
      row.append(move);
    }
    fragment.append(row);
  }
  container.replaceChildren(fragment);
  container.scrollTop=container.scrollHeight;
}

function onSquare(square) {
  if (pending || game.isGameOver()) return;
  if (aiThinking) { notify('WChess AI is thinking.'); return; }
  if (aiMode && game.turn()===aiColor) { notify('It is the computer’s turn.'); return; }
  if (activeMatchId && matchMeta?.status === 'open') { notify('Share your match link, then play once the other player joins.'); return; }
  if (activeMatchId && game.turn() !== myColor) { notify('It is your opponent’s turn.'); return; }
  const piece=game.get(square);
  const moves=legal.filter(move=>move.to===square);
  if (selected && moves.length) {
    if (moves.some(move=>move.promotion)) { pending={from:selected,to:square}; showPromotion(); return; }
    playMove({from:selected,to:square});
    return;
  }
  if (piece && piece.color===game.turn()) {
    selected=selected===square ? null : square;
    legal=selected ? game.moves({square:selected,verbose:true}) : [];
  } else { selected=null; legal=[]; }
  render();
}

function playMove(move) {
  let played;
  try { played = game.move(move); }
  catch { return; }
  animateMove=true;
  playSound(game.isGameOver() ? 'finish' : played?.captured ? 'capture' : game.isCheck() ? 'check' : 'move');
  selected=null; legal=[]; pending=null;
  $('promotion').hidden=true;
  render();
  if (activeMatchId) publishMatchState();
  else if (aiMode && !game.isGameOver() && game.turn()===aiColor) scheduleAiMove();
}

function showPromotion() {
  const options=$('promotion-options');
  options.replaceChildren();
  ['q','r','b','n'].forEach(type=>{
    const button=document.createElement('button'); button.type='button';
    button.textContent=symbols[game.turn()][type]; button.setAttribute('aria-label',`Promote to ${names[type]}`);
    button.addEventListener('click',()=>playMove({...pending,promotion:type}));
    options.append(button);
  });
  $('promotion').hidden=false;
  options.firstElementChild.focus();
}

function notify(message) {
  const toast=$('lobby-toast');
  toast.textContent=message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.classList.remove('show'),3200);
}
function updateSoundButton() {
  const button=$('sound-toggle');
  if (!button) return;
  button.setAttribute('aria-pressed',String(soundEnabled));
  button.setAttribute('aria-label',soundEnabled?'Turn sound off':'Turn sound on');
  button.title=soundEnabled?'Sound effects are on':'Sound effects are off';
  $('sound-label').textContent=soundEnabled?'Sound on':'Sound off';
}
function playSound(kind='move') {
  if (!soundEnabled) return;
  const AudioContextClass=window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    audioContext ||= new AudioContextClass();
    if (audioContext.state==='suspended') audioContext.resume();
    const now=audioContext.currentTime;
    const notes=kind==='capture'?[{frequency:250,delay:0,duration:.13,volume:.045},{frequency:370,delay:.035,duration:.1,volume:.025}]
      :kind==='check'?[{frequency:520,delay:0,duration:.12,volume:.035},{frequency:690,delay:.07,duration:.16,volume:.028}]
      :kind==='finish'?[{frequency:392,delay:0,duration:.2,volume:.028},{frequency:494,delay:.12,duration:.2,volume:.025},{frequency:587,delay:.24,duration:.28,volume:.022}]
      :[{frequency:335,delay:0,duration:.085,volume:.032},{frequency:465,delay:.018,duration:.07,volume:.018}];
    for (const note of notes) {
      const start=now+note.delay, oscillator=audioContext.createOscillator(), gain=audioContext.createGain();
      oscillator.type='triangle'; oscillator.frequency.setValueAtTime(note.frequency,start);
      gain.gain.setValueAtTime(.0001,start); gain.gain.exponentialRampToValueAtTime(note.volume,start+.012); gain.gain.exponentialRampToValueAtTime(.0001,start+note.duration);
      oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(start); oscillator.stop(start+note.duration+.015);
    }
  } catch { /* Sound is an enhancement; the game should still work if audio is unavailable. */ }
}
function safeText(value) { return String(value || '').replace(/[<>\u0000-\u001f]/g,'').slice(0,80); }
function empty(message) { const div=document.createElement('div'); div.className='lobby-empty'; div.textContent=message; return div; }
function personRow(person, action, actionText, disabled=false) {
  const row=document.createElement('div'); row.className='person-row';
  const info=document.createElement('div'); info.className='person-info';
  const avatar=document.createElement('span'); avatar.className='person-avatar'; avatar.textContent='♟';
  const copy=document.createElement('div'); copy.innerHTML='';
  const name=document.createElement('strong'); name.textContent=safeText(person.name);
  const status=document.createElement('small'); status.textContent=person.online ? 'Online now' : 'Offline';
  copy.append(name,status); info.append(avatar,copy);
  const button=document.createElement('button'); button.type='button'; button.className='mini-action'; button.textContent=actionText; button.disabled=disabled;
  if (action) button.addEventListener('click',action);
  row.append(info,button); return row;
}
function switchTab(tab) {
  document.querySelectorAll('.lobby-tab').forEach(button=>{ const active=button.dataset.tab===tab; button.classList.toggle('active',active); button.setAttribute('aria-selected',String(active)); });
  $('people-tab').hidden=tab!=='people'; $('matches-tab').hidden=tab!=='matches';
}
function renderPlayers(data) {
  const friends = new Set((data.friends || []).map(p=>p.id));
  const incoming = new Set((data.incoming || []).map(r=>r.fromId));
  const outgoing = new Set((data.outgoing || []).map(r=>r.toId));
  const playersList=$('players-list'); playersList.replaceChildren();
  if (!data.players.length) playersList.append(empty('No other players are online yet. Share WChess with a friend to get started.'));
  else data.players.forEach(person=>{
    let action=null,label='Add friend',disabled=false;
    if (friends.has(person.id)) { label='Friends'; disabled=true; }
    else if (incoming.has(person.id)) { label='Respond below'; disabled=true; }
    else if (outgoing.has(person.id)) { label='Request sent'; disabled=true; }
    else action=async()=>{ try { await post('/friends/request',{fromId:playerId,toId:person.id}); notify(`Friend request sent to ${person.name}.`); await refreshSocial(); } catch(e) { notify(e.message); } };
    playersList.append(personRow(person,action,label,disabled));
  });
  $('online-label').textContent=`${data.players.length + 1} online`;
  $('online-count').textContent=`${data.players.length + 1} online`;
  $('request-count').textContent=String(data.incoming.length);
  const requestList=$('requests-list'); requestList.replaceChildren();
  if (!data.incoming.length) requestList.append(empty('No new requests. Send one to a player who is online.'));
  else data.incoming.forEach(request=>{
    const row=document.createElement('div'); row.className='person-row';
    const info=document.createElement('div'); info.className='person-info';
    const avatar=document.createElement('span'); avatar.className='person-avatar'; avatar.textContent='♞';
    const copy=document.createElement('div'); const name=document.createElement('strong'); name.textContent=safeText(request.from.name); const sub=document.createElement('small'); sub.textContent='Wants to be friends'; copy.append(name,sub); info.append(avatar,copy);
    const actions=document.createElement('div'); actions.className='request-actions';
    for (const [accept,text] of [[true,'Accept'],[false,'No thanks']]) { const button=document.createElement('button'); button.className=`mini-action ${accept?'accept':''}`; button.type='button'; button.textContent=text; button.addEventListener('click',async()=>{ try { await post('/friends/respond',{userId:playerId,requestId:request.id,accept}); await refreshSocial(); notify(accept?'Friend request accepted.':'Request dismissed.'); } catch(e) { notify(e.message); } }); actions.append(button); }
    row.append(info,actions); requestList.append(row);
  });
  $('friends-count').textContent=String(data.friends.length);
  const friendsList=$('friends-list'); friendsList.replaceChildren();
  if (!data.friends.length) friendsList.append(empty('Your accepted friends will appear here.'));
  else data.friends.forEach(person=>friendsList.append(personRow(person,null,person.online?'Online':'Offline',true)));
  renderMatches(data.matches || []);
}
function renderMatches(matches) {
  $('match-count').textContent=String(matches.filter(m=>m.status==='open').length);
  const list=$('matches-list'); list.replaceChildren();
  const open=matches.filter(m=>m.status==='open');
  if (!open.length) list.append(empty('No open matches yet. Host one and share the invite link.'));
  open.forEach(match=>{
    const row=document.createElement('div'); row.className='match-row';
    const info=document.createElement('div'); info.className='match-info';
    const name=document.createElement('strong'); name.textContent=match.hostId===playerId?'Your hosted match':`${safeText(match.hostName)} is looking for a game`;
    const sub=document.createElement('small'); sub.textContent=`Invite code ${match.id} · White to move`;
    info.append(name,sub);
    const button=document.createElement('button'); button.className='mini-action'; button.type='button'; button.textContent=match.hostId===playerId?'Copy link':'Join';
    button.addEventListener('click',()=>match.hostId===playerId?showInvite(match):joinMatch(match.id));
    row.append(info,button); list.append(row);
  });
}
async function heartbeat() {
  try { await post('/presence',{id:playerId,name:displayName}); }
  catch (error) { console.warn('WChess presence unavailable:',error.message); }
}
async function refreshSocial() {
  try {
    const data=await api(`/state?userId=${encodeURIComponent(playerId)}`);
    renderPlayers(data);
  } catch (error) { console.warn('WChess social refresh failed:',error.message); }
}
async function publishMatchState() {
  if (!activeMatchId) return;
  const pgn=game.pgn();
  lastSyncedPgn=pgn;
  lastLocalMoveAt=Date.now();
  try { await post(`/matches/${activeMatchId}/state`,{playerId,fen:game.fen(),pgn,turn:game.turn(),result:game.isGameOver()?resultText().title:''}); }
  catch (error) { notify(`Match update failed: ${error.message}`); }
}
async function pollMatch() {
  if (!activeMatchId) return;
  try {
    const { match, color }=await api(`/matches/${activeMatchId}?userId=${encodeURIComponent(playerId)}`);
    if (match.status==='closed') { await leaveOnlineMatch(false); notify('This match has ended.'); return; }
    const previousStatus=matchMeta?.status, previousGuest=matchMeta?.guestId;
    matchMeta=match; myColor=color;
    if (previousStatus!==match.status || previousGuest!==match.guestId) render();
    const pgn=match.pgn || '';
    if (pgn !== lastSyncedPgn && Date.now()-lastLocalMoveAt>900) {
      const previousMoveCount=game.history().length;
      if (pgn) game.loadPgn(pgn); else game.reset();
      const syncedHistory=game.history({verbose:true});
      if (syncedHistory.length>previousMoveCount) { const latest=syncedHistory.at(-1); animateMove=true; playSound(game.isGameOver()?'finish':latest.captured?'capture':game.isCheck()?'check':'move'); }
      lastSyncedPgn=pgn; selected=null; legal=[]; pending=null; $('promotion').hidden=true; render();
    } else if (pgn === game.pgn()) lastSyncedPgn=pgn;
  } catch (error) {
    console.warn('WChess match sync failed:',error.message);
    if (/not found|not in this match/i.test(error.message)) { await leaveOnlineMatch(false); notify('That match is no longer available.'); }
  }
}
function showInvite(match) {
  matchMeta=match;
  activeMatchId=match.id;
  $('share-match').hidden=false;
  $('share-match-text').textContent=`Match ${match.id} is ready. You are White.`;
  $('copy-match-link').dataset.matchId=match.id;
  switchTab('matches');
  $('lobby').hidden=false;
}
function buildInvite(matchId) {
  const url=new URL(location.href); url.searchParams.set('match',matchId); return url.toString();
}
async function copyInvite() {
  const id=$('copy-match-link').dataset.matchId;
  if (!id) return;
  const value=buildInvite(id);
  try { await navigator.clipboard.writeText(value); notify('Invite link copied. Send it to your friend.'); }
  catch { const input=document.createElement('textarea'); input.value=value; document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); notify('Invite link copied. Send it to your friend.'); }
}
async function hostMatch() {
  try {
    await heartbeat();
    const {match}=await post('/matches',{playerId});
    cancelAi(); aiMode=false;
    game.reset(); selected=null; legal=[]; pending=null; activeMatchId=match.id; matchMeta=match; myColor='w'; flipped=false; lastSyncedPgn=''; lastLocalMoveAt=0;
    $('share-match').hidden=false; $('share-match-text').textContent=`Match ${match.id} is ready. You are White.`; $('copy-match-link').dataset.matchId=match.id;
    render(); switchTab('matches'); await refreshSocial(); notify('Match hosted. Copy the invite link for your friend.');
  } catch (error) { notify(error.message); }
}
function parseMatchId(value) {
  const input=String(value||'').trim();
  const fromUrl=input.match(/[?&]match=([a-z0-9]{8})/i)?.[1];
  const code=fromUrl || input.match(/\b([a-z0-9]{8})\b/i)?.[1];
  return code ? code.toUpperCase() : '';
}
async function joinMatch(value) {
  const id=parseMatchId(value);
  if (!id) { notify('Enter a valid eight-character match code or invite link.'); return; }
  try {
    await heartbeat();
    const {match,color}=await post(`/matches/${id}/join`,{playerId});
    cancelAi(); aiMode=false;
    activeMatchId=match.id; matchMeta=match; myColor=color; flipped=color==='b';
    game.reset();
    if (match.pgn) game.loadPgn(match.pgn);
    lastSyncedPgn=match.pgn || ''; lastLocalMoveAt=0; selected=null; legal=[]; pending=null;
    $('share-match').hidden=true; $('lobby').hidden=true; render();
    notify(color==='w'?'You are hosting as White.':'You joined as Black. Good game.');
    await refreshSocial();
  } catch (error) { notify(error.message); }
}
async function leaveOnlineMatch(resetBoard=true) {
  const id=activeMatchId;
  if (id) { try { await post(`/matches/${id}/leave`,{playerId}); } catch {} }
  activeMatchId=null; matchMeta=null; myColor=null; lastSyncedPgn=''; lastLocalMoveAt=0;
  if (resetBoard) game.reset();
  selected=null; legal=[]; pending=null; $('promotion').hidden=true; $('share-match').hidden=true; render();
  if (id) refreshSocial();
}

function cancelAi() {
  aiRequestId++;
  aiThinking=false;
  if (aiWorker) { aiWorker.terminate(); aiWorker=null; }
}
function finishAiMove(requestId, move) {
  if (requestId!==aiRequestId) return;
  if (aiWorker) { aiWorker.terminate(); aiWorker=null; }
  aiThinking=false;
  if (!move) { render(); notify('The AI could not find a legal move. Start a new game to try again.'); return; }
  let played;
  try { played=game.move(move); }
  catch { render(); notify('The AI returned an invalid move. Please start a new game.'); return; }
  animateMove=true;
  playSound(game.isGameOver()?'finish':played?.captured?'capture':game.isCheck()?'check':'move');
  render();
}
function fallbackAiMove(requestId) {
  import('./ai-engine.js').then(({chooseMove})=>{
    setTimeout(()=>{
      if (requestId!==aiRequestId) return;
      try {
        const move=chooseMove(game,aiLevel);
        finishAiMove(requestId,move?{from:move.from,to:move.to,promotion:move.promotion}:null);
      } catch (error) {
        if (requestId!==aiRequestId) return;
        aiThinking=false; render(); notify(`The local AI could not finish its search: ${error.message}`);
      }
    },30);
  }).catch(error=>{
    if (requestId!==aiRequestId) return;
    aiThinking=false; render(); notify(`The WChess AI could not load: ${error.message}`);
  });
}
function scheduleAiMove() {
  if (!aiMode || aiThinking || game.isGameOver() || game.turn()!==aiColor) return;
  const requestId=++aiRequestId;
  aiThinking=true; selected=null; legal=[]; render();
  if (typeof Worker==='undefined') { fallbackAiMove(requestId); return; }
  let worker;
  try { worker=new Worker(new URL('./ai-worker.js',import.meta.url),{type:'module'}); }
  catch { fallbackAiMove(requestId); return; }
  aiWorker=worker;
  worker.onmessage=event=>{
    if (requestId!==aiRequestId) { worker.terminate(); return; }
    if (event.data.error || !event.data.move) { fallbackAiMove(requestId); return; }
    finishAiMove(requestId,event.data.move);
  };
  worker.onerror=()=>{ if(requestId!==aiRequestId)return; worker.terminate(); aiWorker=null; fallbackAiMove(requestId); };
  try { worker.postMessage({pgn:game.pgn(),level:aiLevel}); }
  catch { worker.terminate(); aiWorker=null; fallbackAiMove(requestId); }
}
async function startAiGame() {
  const selectedLevel=document.querySelector('.ai-level.selected')?.dataset.level || 'intermediate';
  const humanColor=$('ai-color').value==='b'?'b':'w';
  cancelAi();
  if (activeMatchId) await leaveOnlineMatch(false);
  aiMode=true; aiLevel=selectedLevel; aiColor=humanColor==='w'?'b':'w';
  activeMatchId=null; matchMeta=null; myColor=null;
  game.reset(); selected=null; legal=[]; pending=null; flipped=humanColor==='b';
  $('promotion').hidden=true; $('ai-modal').hidden=true;
  render();
  if (aiColor==='w') scheduleAiMove();
}
function undoMove() {
  if (pending || activeMatchId || aiThinking || !game.history().length) return;
  game.undo();
  if (aiMode && game.turn()===aiColor && game.history().length) game.undo();
  selected=null; legal=[]; render();
  if (aiMode && game.turn()===aiColor) scheduleAiMove();
}

$('undo').addEventListener('click',undoMove);
$('flip').addEventListener('click',()=>{ flipped=!flipped; render(); });
$('sound-toggle').addEventListener('click',()=>{ soundEnabled=!soundEnabled; localStorage.setItem(soundKey,soundEnabled?'on':'off'); updateSoundButton(); if(soundEnabled) playSound('move'); });
$('new-game').addEventListener('click',async()=>{ if (activeMatchId) await leaveOnlineMatch(false); cancelAi(); game.reset(); selected=null; legal=[]; pending=null; $('promotion').hidden=true; render(); if(aiMode && aiColor==='w') scheduleAiMove(); });
$('open-lobby').addEventListener('click',async()=>{ $('display-name').value=displayName; $('player-id-label').textContent=playerId.slice(0,8).toUpperCase(); $('lobby').hidden=false; switchTab('people'); await heartbeat(); await refreshSocial(); });
$('open-ai').addEventListener('click',()=>{ $('ai-modal').hidden=false; document.querySelector('.ai-level.selected')?.focus(); });
$('close-ai').addEventListener('click',()=> $('ai-modal').hidden=true);
$('ai-modal').addEventListener('click',event=>{ if(event.target===$('ai-modal')) $('ai-modal').hidden=true; });
document.querySelectorAll('.ai-level').forEach(button=>button.addEventListener('click',()=>{ document.querySelectorAll('.ai-level').forEach(level=>{ level.classList.toggle('selected',level===button); level.setAttribute('aria-pressed',String(level===button)); }); }));
$('start-ai').addEventListener('click',startAiGame);
$('close-lobby').addEventListener('click',()=>$('lobby').hidden=true);
$('lobby').addEventListener('click',event=>{ if(event.target===$('lobby')) $('lobby').hidden=true; });
document.querySelectorAll('.lobby-tab').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));
$('save-name').addEventListener('click',async()=>{ const value=$('display-name').value.trim(); if(!value) { notify('Please choose a name.'); return; } displayName=value.replace(/[<>\u0000-\u001f]/g,'').slice(0,22); localStorage.setItem(nameKey,displayName); await heartbeat(); if(matchMeta) render(); await refreshSocial(); notify(`You’ll appear as ${displayName}.`); });
$('host-match').addEventListener('click',hostMatch);
$('copy-match-link').addEventListener('click',copyInvite);
$('join-match').addEventListener('click',()=>joinMatch($('match-code').value));
$('match-code').addEventListener('keydown',event=>{ if(event.key==='Enter') joinMatch($('match-code').value); });
document.addEventListener('keydown',event=>{
  if (event.key==='Escape' && pending) { pending=null; $('promotion').hidden=true; render(); }
  if (event.key==='Escape' && !$('lobby').hidden) $('lobby').hidden=true;
  if (event.key==='Escape' && !$('ai-modal').hidden) $('ai-modal').hidden=true;
  if (event.key==='Tab' && pending) {
    const buttons=[...$('promotion-options').querySelectorAll('button')];
    if (event.shiftKey && document.activeElement===buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement===buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
  }
});

async function init() {
  $('display-name').value=displayName;
  $('player-id-label').textContent=playerId.slice(0,8).toUpperCase();
  render();
  await heartbeat();
  await refreshSocial();
  setInterval(heartbeat,8000);
  setInterval(refreshSocial,3500);
  setInterval(pollMatch,900);
  const invite=new URLSearchParams(location.search).get('match');
  if (invite) { $('match-code').value=invite; $('lobby').hidden=false; switchTab('matches'); await joinMatch(invite); }
}
init();

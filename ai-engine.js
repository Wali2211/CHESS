const VALUE = { p:100, n:320, b:335, r:500, q:900, k:20000 };
const MATE = 100000;

function evaluate(game, side, ply=0) {
  if (game.isCheckmate()) return game.turn() === side ? -MATE+ply : MATE-ply;
  if (game.isDraw()) return 0;
  let score = 0;
  const board = game.board();
  for (let row=0; row<8; row++) for (let file=0; file<8; file++) {
    const piece = board[row][file];
    if (!piece) continue;
    const sign = piece.color === side ? 1 : -1;
    let value = VALUE[piece.type];
    const rank = 8 - row;
    const center = 7 - (Math.abs(file - 3.5) + Math.abs(rank - 4.5));
    if (piece.type === 'p') {
      const progress = piece.color === 'w' ? rank - 2 : 7 - rank;
      value += progress * 7 + Math.max(0, center) * 2;
    } else if (piece.type === 'n') value += center * 11;
    else if (piece.type === 'b') value += center * 5;
    else if (piece.type === 'r') value += center * 1.5;
    score += sign * value;
  }
  if (game.isCheck()) score += game.turn() === side ? -24 : 24;
  return score;
}

function orderScore(move, preferred) {
  const match = preferred && move.from===preferred.from && move.to===preferred.to && move.promotion===preferred.promotion;
  const capture = move.captured ? VALUE[move.captured] * 10 - VALUE[move.piece] : 0;
  const promotion = move.promotion ? VALUE[move.promotion] + 800 : 0;
  const check = move.san?.includes('+') ? 35 : 0;
  return (match ? 100000 : 0) + capture + promotion + check;
}
function movesFor(game, preferred=null) { return game.moves({ verbose:true }).sort((a,b)=>orderScore(b,preferred)-orderScore(a,preferred)); }
function positionKey(game) { return game.fen().split(' ').slice(0,4).join(' '); }
function stopIfNeeded(limits) {
  limits.nodes++;
  if (limits.nodes > limits.maxNodes || (limits.nodes & 255) === 0 && performance.now() > limits.deadline) limits.stopped = true;
  return limits.stopped;
}

function quiescence(game, alpha, beta, side, limits, depth=4, ply=0) {
  if (stopIfNeeded(limits) || game.isGameOver()) return evaluate(game, side, ply);
  const maximizing = game.turn() === side;
  const checked = game.isCheck();
  const stand = evaluate(game, side, ply);
  if (depth <= 0) return stand;
  let best = stand;
  if (!checked) {
    if (maximizing) { if (stand >= beta) return stand; alpha=Math.max(alpha,stand); }
    else { if (stand <= alpha) return stand; beta=Math.min(beta,stand); }
  } else best = maximizing ? -Infinity : Infinity;
  let moves = movesFor(game);
  if (!checked) moves = moves.filter(move=>move.captured || move.promotion);
  if (!moves.length) return Number.isFinite(best) ? best : stand;
  for (const move of moves) {
    game.move({ from:move.from, to:move.to, promotion:move.promotion });
    const score = quiescence(game, alpha, beta, side, limits, depth-1, ply+1);
    game.undo();
    if (maximizing) { best=Math.max(best,score); alpha=Math.max(alpha,best); }
    else { best=Math.min(best,score); beta=Math.min(beta,best); }
    if (beta <= alpha || limits.stopped) break;
  }
  return best;
}

function packMate(score, ply) { return score>MATE-1000 ? score+ply : score<-MATE+1000 ? score-ply : score; }
function unpackMate(score, ply) { return score>MATE-1000 ? score-ply : score<-MATE+1000 ? score+ply : score; }

function search(game, depth, alpha, beta, side, limits, table, ply=0) {
  if (stopIfNeeded(limits) || game.isGameOver()) return evaluate(game, side, ply);
  if (depth <= 0) return quiescence(game, alpha, beta, side, limits, 4, ply);
  const key=positionKey(game), alphaStart=alpha, betaStart=beta;
  const entry=table.get(key);
  if (entry && entry.depth >= depth) {
    const cached=unpackMate(entry.score,ply);
    if (entry.flag==='exact') return cached;
    if (entry.flag==='lower') alpha=Math.max(alpha,cached);
    if (entry.flag==='upper') beta=Math.min(beta,cached);
    if (alpha >= beta) return cached;
  }
  const maximizing = game.turn() === side;
  let best = maximizing ? -Infinity : Infinity, bestMove=null;
  for (const move of movesFor(game,entry?.move)) {
    game.move({ from:move.from, to:move.to, promotion:move.promotion });
    const score=search(game,depth-1,alpha,beta,side,limits,table,ply+1);
    game.undo();
    if (maximizing) { if(score>best){best=score;bestMove=move;} alpha=Math.max(alpha,best); }
    else { if(score<best){best=score;bestMove=move;} beta=Math.min(beta,best); }
    if (beta<=alpha || limits.stopped) break;
  }
  if (table.size > 120000) table.clear();
  table.set(key,{depth,score:packMate(best,ply),move:bestMove,flag:best<=alphaStart?'upper':best>=betaStart?'lower':'exact'});
  return best;
}

export function chooseMove(game, level='beginner') {
  const side=game.turn(), legal=movesFor(game);
  if (!legal.length) return null;
  const immediateMate=legal.find(move=>move.san?.includes('#'));
  if (immediateMate) return immediateMate;
  if (level==='beginner') {
    const ranked=legal.map(move=>{
      game.move({from:move.from,to:move.to,promotion:move.promotion});
      const score=evaluate(game,side)+Math.random()*360-180;
      game.undo();
      return {move,score};
    }).sort((a,b)=>b.score-a.score);
    return ranked[Math.floor(Math.random()*Math.min(8,ranked.length))].move;
  }
  const expert=level==='expert';
  const maxDepth=expert?6:3;
  const limits={nodes:0,maxNodes:expert?125000:30000,deadline:performance.now()+(expert?3800:1200),stopped:false};
  const table=new Map();
  let best=legal[0];
  for (let depth=1; depth<=maxDepth; depth++) {
    let iterationBest=null, iterationScore=-Infinity, alpha=-Infinity;
    for (const move of legal) {
      game.move({from:move.from,to:move.to,promotion:move.promotion});
      const score=search(game,depth-1,alpha,Infinity,side,limits,table,1);
      game.undo();
      if (limits.stopped) break;
      const tieBreak=Math.random()*0.05;
      if (score+tieBreak>iterationScore) { iterationScore=score+tieBreak; iterationBest=move; }
      alpha=Math.max(alpha,iterationScore);
    }
    if (iterationBest) best=iterationBest;
    if (limits.stopped) break;
  }
  return best;
}

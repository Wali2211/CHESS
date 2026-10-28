const VALUE = { p:100, n:325, b:340, r:510, q:930, k:20000 };
const MATE = 100000;
const PASSED_PAWN_BONUS = [0, 4, 11, 22, 38, 64, 105];

function evaluate(game, side, ply=0) {
  if (game.isCheckmate()) return game.turn() === side ? -MATE+ply : MATE-ply;
  if (game.isDraw()) return 0;

  const board=game.board();
  const pawns={ w:[], b:[] };
  const pawnFiles={ w:Array(8).fill(0), b:Array(8).fill(0) };
  const bishops={ w:0, b:0 };
  const rooks={ w:[], b:[] };
  const kings={ w:null, b:null };
  let nonPawnMaterial=0;
  let score=0;

  for (let row=0;row<8;row++) for (let file=0;file<8;file++) {
    const piece=board[row][file];
    if (!piece) continue;
    const sign=piece.color===side?1:-1;
    const rank=8-row;
    const center=7-(Math.abs(file-3.5)+Math.abs(rank-4.5));
    let value=VALUE[piece.type];

    if (piece.type==='p') {
      const progress=piece.color==='w'?rank-2:7-rank;
      pawns[piece.color].push({row,file,progress});
      pawnFiles[piece.color][file]++;
      value+=progress*6+Math.max(0,center)*3;
    } else if (piece.type==='n') {
      nonPawnMaterial+=VALUE.n;
      value+=center*12;
    } else if (piece.type==='b') {
      nonPawnMaterial+=VALUE.b;
      bishops[piece.color]++;
      value+=center*7;
    } else if (piece.type==='r') {
      nonPawnMaterial+=VALUE.r;
      rooks[piece.color].push(file);
      value+=center*1.5;
    } else if (piece.type==='q') {
      nonPawnMaterial+=VALUE.q;
      value+=center*2;
    } else if (piece.type==='k') kings[piece.color]={row,file};

    score+=sign*value;
  }

  for (const color of ['w','b']) {
    const sign=color===side?1:-1;
    const enemies=pawns[color==='w'?'b':'w'];
    const own=pawns[color];
    for (const pawn of own) {
      const isolated=!own.some(other=>Math.abs(other.file-pawn.file)===1);
      const passed=!enemies.some(enemy=>Math.abs(enemy.file-pawn.file)<=1 && (color==='w'?enemy.row<pawn.row:enemy.row>pawn.row));
      const connected=own.some(other=>other.file!==pawn.file && Math.abs(other.file-pawn.file)===1 && Math.abs(other.row-pawn.row)<=1);
      let bonus=connected?7:0;
      if (isolated) bonus-=13;
      if (passed) bonus+=PASSED_PAWN_BONUS[Math.min(6,pawn.progress)];
      score+=sign*bonus;
    }
    for (const count of pawnFiles[color]) if (count>1) score-=sign*(count-1)*15;
    if (bishops[color]>=2) score+=sign*30;
    for (const file of rooks[color]) {
      if (pawnFiles[color][file]===0) score+=sign*(pawnFiles[color==='w'?'b':'w'][file]===0?24:12);
      if (rooks[color].filter(other=>other===file).length>1) score+=sign*7;
    }

    const king=kings[color];
    if (king) {
      const kingRank=8-king.row;
      const kingCenter=7-(Math.abs(king.file-3.5)+Math.abs(kingRank-4.5));
      if (nonPawnMaterial<2300) score+=sign*kingCenter*7;
      else {
        const forward=color==='w'?-1:1;
        let shield=0;
        for (let file=Math.max(0,king.file-1);file<=Math.min(7,king.file+1);file++) {
          for (let step=1;step<=2;step++) {
            const row=king.row+forward*step;
            if (row<0 || row>7) continue;
            if (board[row][file]?.type==='p' && board[row][file]?.color===color) { shield++; break; }
          }
        }
        score+=sign*(shield*10-Math.max(0,2-shield)*5);
      }
    }
  }

  if (game.isCheck()) score+=game.turn()===side?-35:35;
  return score;
}

function orderScore(move, preferred) {
  const match=preferred && move.from===preferred.from && move.to===preferred.to && move.promotion===preferred.promotion;
  const capture=move.captured ? VALUE[move.captured]*10-VALUE[move.piece] : 0;
  const promotion=move.promotion ? VALUE[move.promotion]+800 : 0;
  const check=move.san?.includes('+') ? 45 : 0;
  return (match?1000000:0)+capture+promotion+check;
}
function movesFor(game, preferred=null) {
  return game.moves({verbose:true}).sort((a,b)=>orderScore(b,preferred)-orderScore(a,preferred));
}
function positionKey(game) {
  return game.fen().split(' ').slice(0,5).join(' ');
}
function stopIfNeeded(limits) {
  limits.nodes++;
  if (limits.nodes>limits.maxNodes || (limits.nodes&255)===0 && performance.now()>limits.deadline) limits.stopped=true;
  return limits.stopped;
}

function quiescence(game, alpha, beta, side, limits, depth=5, ply=0) {
  if (stopIfNeeded(limits) || game.isGameOver()) return evaluate(game,side,ply);
  const maximizing=game.turn()===side;
  const checked=game.isCheck();
  const stand=evaluate(game,side,ply);
  if (depth<=0) return stand;
  let best=stand;
  if (!checked) {
    if (maximizing) { if (stand>=beta) return stand; alpha=Math.max(alpha,stand); }
    else { if (stand<=alpha) return stand; beta=Math.min(beta,stand); }
  } else best=maximizing?-Infinity:Infinity;

  let moves=movesFor(game);
  if (!checked) {
    const includeQuietChecks=depth>=2;
    moves=moves.filter(move=>move.captured || move.promotion || includeQuietChecks&&move.san?.includes('+'));
  }
  if (!moves.length) return Number.isFinite(best)?best:stand;
  for (const move of moves) {
    game.move({from:move.from,to:move.to,promotion:move.promotion});
    const score=quiescence(game,alpha,beta,side,limits,depth-1,ply+1);
    game.undo();
    if (maximizing) { best=Math.max(best,score); alpha=Math.max(alpha,best); }
    else { best=Math.min(best,score); beta=Math.min(beta,best); }
    if (beta<=alpha || limits.stopped) break;
  }
  return best;
}

function packMate(score,ply) { return score>MATE-1000?score+ply:score<-MATE+1000?score-ply:score; }
function unpackMate(score,ply) { return score>MATE-1000?score-ply:score<-MATE+1000?score+ply:score; }

function search(game, depth, alpha, beta, side, limits, table, ply=0) {
  if (stopIfNeeded(limits) || game.isGameOver()) return evaluate(game,side,ply);
  if (depth<=0) return quiescence(game,alpha,beta,side,limits,5,ply);

  const key=positionKey(game), alphaStart=alpha, betaStart=beta;
  const entry=table.get(key);
  if (entry && entry.depth>=depth) {
    const cached=unpackMate(entry.score,ply);
    if (entry.flag==='exact') return cached;
    if (entry.flag==='lower') alpha=Math.max(alpha,cached);
    if (entry.flag==='upper') beta=Math.min(beta,cached);
    if (alpha>=beta) return cached;
  }

  const maximizing=game.turn()===side;
  let best=maximizing?-Infinity:Infinity, bestMove=null;
  for (const move of movesFor(game,entry?.move)) {
    game.move({from:move.from,to:move.to,promotion:move.promotion});
    const score=search(game,depth-1,alpha,beta,side,limits,table,ply+1);
    game.undo();
    if (maximizing) { if(score>best){best=score;bestMove=move;} alpha=Math.max(alpha,best); }
    else { if(score<best){best=score;bestMove=move;} beta=Math.min(beta,best); }
    if (beta<=alpha || limits.stopped) break;
  }
  if (!Number.isFinite(best)) best=evaluate(game,side,ply);
  if (limits.stopped) return best;
  if (table.size>120000) table.clear();
  table.set(key,{depth,score:packMate(best,ply),move:bestMove,flag:best<=alphaStart?'upper':best>=betaStart?'lower':'exact'});
  return best;
}

function chooseBeginnerMove(game, legal) {
  const side=game.turn();
  const limits={nodes:0,maxNodes:9000,deadline:performance.now()+550,stopped:false};
  const table=new Map(), scored=[];
  for (const move of legal) {
    game.move({from:move.from,to:move.to,promotion:move.promotion});
    const score=search(game,1,-Infinity,Infinity,side,limits,table,1);
    game.undo();
    if (limits.stopped && scored.length) break;
    scored.push({move,score});
    if (limits.stopped) break;
  }
  if (!scored.length) return legal[0];
  scored.sort((a,b)=>b.score-a.score);
  const threshold=scored[0].score-115;
  const reasonable=scored.filter(item=>item.score>=threshold).slice(0,6);
  return reasonable[Math.floor(Math.random()*reasonable.length)].move;
}

export function chooseMove(game, level='intermediate') {
  const side=game.turn(), legal=movesFor(game);
  if (!legal.length) return null;
  const immediateMate=legal.find(move=>move.san?.includes('#'));
  if (immediateMate) return immediateMate;
  if (level==='beginner') return chooseBeginnerMove(game,legal);

  const expert=level==='expert';
  const maxDepth=expert?8:5;
  const limits={nodes:0,maxNodes:expert?240000:65000,deadline:performance.now()+(expert?4700:1900),stopped:false};
  const table=new Map();
  let best=legal[0];
  for (let depth=1;depth<=maxDepth;depth++) {
    const rootMoves=legal.slice().sort((a,b)=>orderScore(b,best)-orderScore(a,best));
    let iterationBest=null, iterationScore=-Infinity, alpha=-Infinity;
    for (const move of rootMoves) {
      game.move({from:move.from,to:move.to,promotion:move.promotion});
      const score=search(game,depth-1,alpha,Infinity,side,limits,table,1);
      game.undo();
      if (limits.stopped) break;
      if (score>iterationScore) { iterationScore=score; iterationBest=move; }
      alpha=Math.max(alpha,score);
    }
    if (iterationBest) best=iterationBest;
    if (limits.stopped) break;
  }
  return best;
}

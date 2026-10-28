import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from '../chess.js';
import { chooseMove } from '../ai-engine.js';

const levels=['beginner','intermediate','expert'];

function chooseAndPlay(fen,level) {
  const game=new Chess(fen);
  const move=chooseMove(game,level);
  assert.ok(move,`${level} should return a legal move`);
  game.move({from:move.from,to:move.to,promotion:move.promotion});
  return game;
}

test('spots a mate in one at every difficulty',()=>{
  const fen='7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
  for (const level of levels) assert.equal(chooseAndPlay(fen,level).isCheckmate(),true,`${level} should find mate`);
});

test('wins a hanging queen while escaping check',()=>{
  const fen='4k3/8/8/8/8/8/3q4/3RK3 w - - 0 1';
  for (const level of levels) {
    const game=chooseAndPlay(fen,level);
    assert.equal(game.board().flat().some(piece=>piece?.color==='b'&&piece.type==='q'),false,`${level} should take the queen`);
  }
});

test('captures a checking rook instead of retreating',()=>{
  const fen='4k3/8/8/8/8/8/4r3/3QK3 w - - 0 1';
  for (const level of levels) {
    const game=chooseAndPlay(fen,level);
    assert.equal(game.board().flat().some(piece=>piece?.color==='b'&&piece.type==='r'),false,`${level} should take the rook`);
  }
});

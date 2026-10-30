import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from '../chess.js';
import { TRAINING_PUZZLES } from '../training-puzzles.js';

const toMove = token => ({ from: token.slice(0, 2), to: token.slice(2, 4), ...(token[4] ? { promotion: token[4] } : {}) });

test('the training studio contains 59 distinct lessons and puzzle positions', () => {
  assert.equal(TRAINING_PUZZLES.length, 59);
  assert.equal(new Set(TRAINING_PUZZLES.map(puzzle => puzzle.theme)).size, 59);
  assert.equal(new Set(TRAINING_PUZZLES.map(puzzle => puzzle.id)).size, 59);
  for (const puzzle of TRAINING_PUZZLES) {
    assert.ok(puzzle.name && puzzle.description && puzzle.url, `${puzzle.theme} has lesson text and a source link`);
    assert.ok(puzzle.rating >= 700 && puzzle.rating <= 2500, `${puzzle.theme} has an accessible rating`);
  }
});

test('each training puzzle position and full solution line is legal', () => {
  for (const puzzle of TRAINING_PUZZLES) {
    const game = new Chess(puzzle.fen);
    const moves = puzzle.moves.split(/\s+/);
    assert.ok(moves.length >= 2 && moves.length <= 11, `${puzzle.theme} has a bounded training line`);
    for (const token of moves) {
      assert.match(token, /^[a-h][1-8][a-h][1-8][qrbn]?$/, `${puzzle.theme} contains valid UCI move syntax`);
      const played = game.move(toMove(token));
      assert.ok(played, `${puzzle.theme}: ${token} is legal`);
    }
    if (puzzle.theme.includes('Mate') || puzzle.theme.startsWith('mateIn')) {
      assert.equal(game.isCheckmate(), true, `${puzzle.theme} ends in checkmate`);
    }
  }
});

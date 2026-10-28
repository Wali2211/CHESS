import { Chess } from './chess.js';
import { chooseMove } from './ai-engine.js';

self.onmessage = event => {
  try {
    const game = new Chess();
    if (event.data.pgn) game.loadPgn(event.data.pgn);
    const move = chooseMove(game, event.data.level || 'beginner');
    self.postMessage({ move: move ? { from:move.from, to:move.to, promotion:move.promotion } : null });
  } catch (error) {
    self.postMessage({ error:error.message });
  }
};

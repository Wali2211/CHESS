import { Chess } from './chess.js';
import { TRAINING_PUZZLES } from './training-puzzles.js';

const $ = id => document.getElementById(id);
const board = $('training-board');
const trainerGame = new Chess();
const PIECES = { w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
const COLORS = { w: 'White', b: 'Black' };
const PIECE_NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const STORAGE_KEY = 'wchess-training-progress-v1';
let visiblePuzzles = TRAINING_PUZZLES.slice();
let puzzleIndex = 0;
let currentPuzzle = null;
let solutionMoves = [];
let expectedIndex = 0;
let playerColor = 'w';
let flipped = false;
let selected = null;
let legal = [];
let hintsUsed = 0;
let mistakeCount = 0;
let lastMove = null;
let replyTimer = null;
let promotionChoices = [];

function readProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { solvedIds: Array.isArray(value.solvedIds) ? value.solvedIds : [], attempts: Number(value.attempts) || 0, streak: Number(value.streak) || 0, bestStreak: Number(value.bestStreak) || 0 };
  } catch { return { solvedIds: [], attempts: 0, streak: 0, bestStreak: 0 }; }
}
let progress = readProgress();
function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  $('training-solved').textContent = `${progress.solvedIds.length} solved`;
  $('training-streak').textContent = `Best streak: ${progress.bestStreak}`;
  $('training-attempts').textContent = `${progress.attempts} attempts`;
}
function uciMove(token) {
  if (typeof token !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) return null;
  return { from: token.slice(0, 2), to: token.slice(2, 4), ...(token[4] ? { promotion: token[4] } : {}) };
}
function moveToken(move) { return `${move.from}${move.to}${move.promotion || ''}`; }
function playToken(game, token) {
  const move = uciMove(token);
  if (!move) return null;
  try { return game.move(move); } catch { return null; }
}
function makeSanLine(puzzle) {
  const copy = new Chess(puzzle.fen);
  const tokens = puzzle.moves.split(/\s+/).filter(Boolean);
  const san = [];
  for (const token of tokens) {
    const move = playToken(copy, token);
    if (!move) return [];
    san.push(move.san);
  }
  return san;
}
function updatePuzzleHeader() {
  $('training-index').textContent = `Lesson ${puzzleIndex + 1} of ${visiblePuzzles.length}`;
  $('training-rating').textContent = `Puzzle rating ${currentPuzzle.rating}`;
  $('training-title').textContent = currentPuzzle.name;
  $('training-description').textContent = currentPuzzle.description;
  const sourceLink = $('training-source-link');
  sourceLink.hidden = true;
  try {
    const source = new URL(currentPuzzle.url);
    if (source.protocol === 'https:' && source.hostname === 'lichess.org') { sourceLink.href = source.href; sourceLink.hidden = false; }
  } catch { /* Keep the lesson usable if a source link is missing. */ }
  $('training-solution').hidden = true;
  $('training-solution').textContent = '';
  $('training-status').classList.remove('solved');
  $('training-status').textContent = 'Find the strongest continuation.';
  $('training-prev').disabled = visiblePuzzles.length < 2;
}
function renderBoard() {
  if (!currentPuzzle) return;
  const history = trainerGame.history({ verbose: true });
  lastMove = history.at(-1) || null;
  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flipped ? 'hgfedcba' : 'abcdefgh';
  const targets = new Set(legal.map(move => move.to));
  const fragment = document.createDocumentFragment();
  ranks.forEach((rank, row) => [...files].forEach((file, col) => {
    const square = `${file}${rank}`;
    const piece = trainerGame.get(square);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `square ${(file.charCodeAt(0) - 97 + rank) % 2 ? 'dark' : 'light'}`;
    if (lastMove && (lastMove.from === square || lastMove.to === square)) button.classList.add('last');
    if (selected === square) button.classList.add('selected');
    if (targets.has(square)) button.classList.add('legal', ...(piece ? ['capture'] : []));
    if (piece?.type === 'k' && piece.color === trainerGame.turn() && trainerGame.isCheck()) button.classList.add('checked');
    button.dataset.square = square;
    button.setAttribute('aria-label', `${square}${piece ? `, ${COLORS[piece.color]} ${PIECE_NAMES[piece.type]}` : ', empty'}${targets.has(square) ? ', legal destination' : ''}`);
    button.setAttribute('aria-pressed', String(selected === square));
    if (piece) {
      const span = document.createElement('span');
      span.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
      span.textContent = PIECES[piece.color][piece.type];
      span.setAttribute('aria-hidden', 'true');
      button.append(span);
    }
    if (col === 0) { const label = document.createElement('span'); label.className = 'coord rank'; label.textContent = rank; label.setAttribute('aria-hidden', 'true'); button.append(label); }
    if (row === 7) { const label = document.createElement('span'); label.className = 'coord file'; label.textContent = file; label.setAttribute('aria-hidden', 'true'); button.append(label); }
    button.addEventListener('click', () => onSquare(square));
    fragment.append(button);
  }));
  board.replaceChildren(fragment);
  board.setAttribute('aria-label', `Tactics board, ${COLORS[playerColor]} to solve, ${flipped ? 'Black' : 'White'} at bottom`);
}
function showSolved() {
  $('training-status').textContent = mistakeCount ? `Solved — nice persistence. ${makeSanLine(currentPuzzle).slice(1).join(' ')}` : `Solved cleanly. ${makeSanLine(currentPuzzle).slice(1).join(' ')}`;
  $('training-status').classList.add('solved');
  if (!progress.solvedIds.includes(currentPuzzle.id)) progress.solvedIds.push(currentPuzzle.id);
  progress.streak += 1;
  progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
  saveProgress();
}
function setStatus(text) {
  $('training-status').textContent = text;
  $('training-status').classList.remove('solved');
}
function showPromotionChoices(moves) {
  const tray = $('training-promotion');
  promotionChoices = moves.slice().sort((a, b) => ['q','r','b','n'].indexOf(a.promotion) - ['q','r','b','n'].indexOf(b.promotion));
  tray.replaceChildren();
  promotionChoices.forEach(move => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = PIECES[playerColor][move.promotion];
    button.setAttribute('aria-label', `Promote to ${PIECE_NAMES[move.promotion]}`);
    button.addEventListener('click', () => tryPuzzleMove(move));
    tray.append(button);
  });
  tray.hidden = false;
  tray.firstElementChild?.focus();
}
function tryPuzzleMove(chosen) {
  $('training-promotion').hidden = true;
  promotionChoices = [];
  const expected = solutionMoves[expectedIndex];
  if (moveToken(chosen) !== expected) {
    progress.attempts += 1;
    progress.streak = 0;
    mistakeCount += 1;
    saveProgress();
    setStatus('Not that one. Re-check the forcing moves and try again.');
    selected = null;
    legal = [];
    renderBoard();
    return;
  }
  progress.attempts += 1;
  const played = trainerGame.move({ from: chosen.from, to: chosen.to, ...(chosen.promotion ? { promotion: chosen.promotion } : {}) });
  expectedIndex += 1;
  selected = null;
  legal = [];
  if (played) setStatus(played.san.includes('#') ? 'Checkmate — pattern found.' : 'Good move. Watch the reply…');
  renderBoard();
  if (trainerGame.isCheckmate() || expectedIndex >= solutionMoves.length) { showSolved(); return; }
  const currentIndex = expectedIndex;
  replyTimer = setTimeout(() => {
    if (!currentPuzzle || expectedIndex !== currentIndex) return;
    const reply = solutionMoves[expectedIndex];
    const replyPlayed = playToken(trainerGame, reply);
    if (!replyPlayed) { setStatus('This line could not be replayed. Please choose another lesson.'); return; }
    expectedIndex += 1;
    renderBoard();
    if (trainerGame.isCheckmate() || expectedIndex >= solutionMoves.length) showSolved();
    else setStatus('Your turn — find the next move in the line.');
  }, 360);
}
function onSquare(square) {
  if (!currentPuzzle || $('training-modal').hidden || trainerGame.isGameOver() || trainerGame.turn() !== playerColor || expectedIndex >= solutionMoves.length) return;
  const piece = trainerGame.get(square);
  const matchingMoves = legal.filter(move => move.to === square);
  if (selected && matchingMoves.length) {
    if (matchingMoves.some(move => move.promotion)) { showPromotionChoices(matchingMoves); return; }
    tryPuzzleMove(matchingMoves[0]);
    return;
  }
  if (piece && piece.color === trainerGame.turn()) {
    selected = selected === square ? null : square;
    legal = selected ? trainerGame.moves({ square: selected, verbose: true }) : [];
  } else { selected = null; legal = []; }
  renderBoard();
}
function startPuzzle(index = puzzleIndex) {
  clearTimeout(replyTimer);
  $('training-promotion').hidden = true;
  promotionChoices = [];
  if (!visiblePuzzles.length) return;
  puzzleIndex = (index + visiblePuzzles.length) % visiblePuzzles.length;
  currentPuzzle = visiblePuzzles[puzzleIndex];
  const tokens = currentPuzzle.moves.split(/\s+/).filter(Boolean);
  trainerGame.load(currentPuzzle.fen);
  const openingMove = playToken(trainerGame, tokens[0]);
  if (!openingMove || tokens.length < 2) {
    setStatus('This lesson is not available right now. Choose another theme.');
    return;
  }
  solutionMoves = tokens.slice(1);
  expectedIndex = 0;
  playerColor = trainerGame.turn();
  flipped = playerColor === 'b';
  selected = null;
  legal = [];
  hintsUsed = 0;
  mistakeCount = 0;
  updatePuzzleHeader();
  renderBoard();
  $('training-status').textContent = `Find the best move for ${COLORS[playerColor]}.`;
}
function currentFilterKey() { return $('training-filter').value || 'all'; }
function applyFilter(key) {
  visiblePuzzles = key === 'all' ? TRAINING_PUZZLES.slice() : TRAINING_PUZZLES.filter(puzzle => puzzle.theme === key);
  puzzleIndex = 0;
  startPuzzle(0);
}
function populateFilters() {
  const select = $('training-filter');
  const themes = [...new Map(TRAINING_PUZZLES.map(puzzle => [puzzle.theme, puzzle.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  select.replaceChildren(new Option(`All ${TRAINING_PUZZLES.length} lessons`, 'all'));
  themes.forEach(([theme, name]) => select.add(new Option(name, theme)));
  $('training-heading').nextElementSibling.textContent = `${TRAINING_PUZZLES.length} themed, answer-checked puzzles. Solve the line on the board; your progress stays on this device.`;
}
function showHint() {
  if (!currentPuzzle || expectedIndex >= solutionMoves.length) return;
  const move = uciMove(solutionMoves[expectedIndex]);
  const temp = new Chess(trainerGame.fen());
  const san = playToken(temp, solutionMoves[expectedIndex])?.san || 'the forcing move';
  hintsUsed += 1;
  if (hintsUsed === 1) setStatus(`Hint: look for a ${currentPuzzle.theme.toLowerCase().includes('mate') ? 'check' : 'forcing move'} involving ${move.from}.`);
  else setStatus(`Stronger hint: consider ${san} (${move.from}–${move.to}).`);
}
function revealLine() {
  if (!currentPuzzle) return;
  const line = makeSanLine(currentPuzzle).slice(1);
  $('training-solution').textContent = `Full line: ${line.join(' ')}`;
  $('training-solution').hidden = false;
  setStatus('Study the line, then retry the puzzle or move on.');
}
function openTrainer() {
  $('training-modal').hidden = false;
  if (!currentPuzzle) startPuzzle(0);
  $('close-training').focus();
}
function closeTrainer() { $('training-modal').hidden = true; }

populateFilters();
saveProgress();
startPuzzle(0);
$('open-training').addEventListener('click', openTrainer);
$('close-training').addEventListener('click', closeTrainer);
$('training-modal').addEventListener('click', event => { if (event.target === $('training-modal')) closeTrainer(); });
$('training-filter').addEventListener('change', () => applyFilter(currentFilterKey()));
$('training-prev').addEventListener('click', () => startPuzzle(puzzleIndex - 1));
$('training-next').addEventListener('click', () => startPuzzle(puzzleIndex + 1));
$('training-reset').addEventListener('click', () => startPuzzle(puzzleIndex));
$('training-hint').addEventListener('click', showHint);
$('training-reveal').addEventListener('click', revealLine);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('training-modal').hidden) closeTrainer();
});

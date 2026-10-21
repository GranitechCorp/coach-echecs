// Échiquier d'analyse libre : on joue les deux camps, Stockfish affiche ses lignes, le coach répond aux questions.
import { Chess } from 'chess.js';
import { setTitle, esc, md, toast, evalBarHtml, setEvalBar, moveListHtml } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { getAnalysisEngine } from '../engine.js';
import { playUci, evalText, pvToSan, START_FEN, safeChess } from '../chessutil.js';
import { explainBest } from '../explain.js';
import { promptBestMove, promptQuestion } from '../prompts.js';
import { askCoach, coachReady } from '../coach-ai.js';
import { showCoach } from './coach-panel.js';
import { startGame } from './game.js';
import { aiEnabled } from '../local-coach.js';

export const tab = 'profile';

export function render(root, fenParam) {
  setTitle('Échiquier d’analyse', '#/analysis');
  const startFen = fenParam && safeChess(fenParam) ? fenParam : START_FEN;
  root.innerHTML = `
    <div class="board-row">${evalBarHtml()}<div class="board-box" id="b"></div></div>
    <div class="engine-lines card" id="lines"><span class="muted">Stockfish analyse…</span></div>
    <div class="actions">
      <button class="btn" id="back">◀</button>
      <button class="btn" id="explain">🤔 Expliquer</button>
      <button class="btn" id="flip">⇅</button>
      <button class="btn" id="play">♟ Jouer d’ici</button>
    </div>
    <div class="coach" id="coach" hidden></div>
    ${aiEnabled() ? `<section class="card">
      <div class="row"><input id="q" placeholder="Pose une question au coach sur cette position…"/><button class="btn ai" id="ask">✨</button></div>
      <div id="answer"></div>
    </section>` : ''}
    <div class="moves card" id="moves"></div>
    <section class="card"><div class="row"><input id="fen" placeholder="Coller une position FEN"/><button class="btn small" id="load">Charger</button></div></section>`;
  const chess = new Chess(startFen);
  const engine = getAnalysisEngine();
  const board = createBoard(root.querySelector('#b'), { onMove });
  root.querySelector('.evalbar').hidden = false;
  let lines = [];
  let ctrl = null;
  let alive = true;

  function onMove(uci) {
    if (!playUci(chess, uci)) return board.sync();
    refresh();
  }

  async function refresh() {
    board.setPosition(chess, { interactive: 'both' });
    board.setShapes([]);
    const start = new Chess(startFen);
    root.querySelector('#moves').innerHTML = moveListHtml(chess.history({ verbose: true }).map((m) => ({ san: m.san })), chess.history().length - 1, start.moveNumber(), start.turn()) || '<span class="muted">Joue des coups pour les deux camps.</span>';
    root.querySelector('#coach').hidden = true;
    ctrl?.abort();
    lines = [];
    const linesEl = root.querySelector('#lines');
    if (chess.isGameOver()) {
      linesEl.innerHTML = '<span class="muted">Partie terminée.</span>';
      return;
    }
    const fen = chess.fen();
    ctrl = new AbortController();
    const show = (ls) => {
      if (!alive || fen !== chess.fen()) return;
      lines = ls;
      linesEl.innerHTML = ls.map((l) => `<div class="eline"><b>${evalText(l)}</b> ${esc(pvToSan(fen, l.pv, 6))}</div>`).join('');
      setEvalBar(root, ls[0], board.orientation);
      board.setShapes(ls.slice(0, 2).map((l, i) => arrow(l.pv[0], i ? 'blue' : 'green')));
    };
    const r = await engine.search(fen, { depth: 18, multipv: 3, onInfo: (ls) => ls[0]?.depth >= 8 && show(ls), signal: ctrl.signal });
    if (!r.aborted) show(r.lines);
  }

  root.querySelector('#back').onclick = () => {
    chess.undo();
    refresh();
  };
  root.querySelector('#flip').onclick = () => {
    board.flip();
    if (lines[0]) setEvalBar(root, lines[0], board.orientation);
  };
  root.querySelector('#play').onclick = () => startGame({ startFen: chess.fen(), userColor: chess.turn(), elo: 1200, liveCoach: true });
  root.querySelector('#explain').onclick = () => {
    if (!lines.length) return toast('Attends la fin de l’analyse.');
    const fen = chess.fen();
    const ls = lines;
    showCoach(root.querySelector('#coach'), {
      title: 'Analyse de la position',
      paragraphs: explainBest(fen, ls),
      getPrompt: () => promptBestMove({ fen, lines: ls, userColor: chess.turn(), history: chess.history() }),
    });
  };
  const askBtn = root.querySelector('#ask');
  if (askBtn) askBtn.onclick = async () => {
    const q = root.querySelector('#q').value.trim();
    if (!q) return;
    if (!coachReady()) return toast('Ajoute ta clé API Claude dans les Réglages (⚙︎).', 4000);
    const out = root.querySelector('#answer');
    out.innerHTML = '<p class="muted">Le coach réfléchit…</p>';
    try {
      await askCoach(promptQuestion({ fen: chess.fen(), lines, question: q }), { onText: (t) => (out.innerHTML = md(t)) });
    } catch (e) {
      out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  };
  root.querySelector('#load').onclick = () => {
    const f = root.querySelector('#fen').value.trim();
    if (!safeChess(f)) return toast('FEN invalide.');
    location.hash = `#/board/${encodeURIComponent(f)}`;
  };
  refresh();
  return () => {
    alive = false;
    ctrl?.abort();
    board.destroy();
  };
}

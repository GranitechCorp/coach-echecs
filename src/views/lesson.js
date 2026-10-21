// Une leçon : étapes de texte, exercices, quiz et positions à jouer contre l'ordinateur.
import { Chess } from 'chess.js';
import { update } from '../storage.js';
import { setTitle, esc, md, moveSound, sleep } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { lessonById, LESSONS } from '../data/lessons.js';
import { stepFen, cgColor, playUci, gameOverText } from '../chessutil.js';
import { getBotEngine } from '../engine.js';
import { runPuzzle } from './puzzle-runner.js';

export const tab = 'learn';

const toShapes = (shapes = []) =>
  shapes.map(([a, brush]) => (a.length === 4 ? arrow(a, brush) : { orig: a, brush }));

export function render(root, id) {
  const lesson = lessonById(id);
  if (!lesson) {
    location.hash = '#/learn';
    return;
  }
  setTitle(lesson.title, '#/learn');
  let k = 0;
  let cleanupStep = null;

  function renderStep() {
    cleanupStep?.();
    cleanupStep = null;
    const st = lesson.steps[k];
    const last = k === lesson.steps.length - 1;
    root.innerHTML = `
      <div class="steps">${lesson.steps.map((_, i) => `<span class="${i < k ? 'done' : i === k ? 'cur' : ''}"></span>`).join('')}</div>
      <div id="step"></div>
      <div class="row between nav-steps">
        <button class="btn ghost" id="prev" ${k === 0 ? 'disabled' : ''}>← Précédent</button>
        <button class="btn primary" id="next">${last ? 'Terminer ✓' : 'Suivant →'}</button>
      </div>`;
    const el = root.querySelector('#step');
    root.querySelector('#prev').onclick = () => {
      k--;
      renderStep();
    };
    root.querySelector('#next').onclick = () => {
      if (last) return finish();
      k++;
      renderStep();
    };
    const fen = stepFen(st);

    if (st.type === 'text') {
      el.innerHTML = `<section class="card lesson-text">${md(st.text)}</section>${fen ? '<div class="board-row"><div class="board-box" id="b"></div></div>' : ''}`;
      if (fen) {
        const c = new Chess(fen);
        const b = createBoard(el.querySelector('#b'), { orientation: st.orientation || cgColor(c.turn()) });
        b.setPosition(c);
        b.setShapes(toShapes(st.shapes));
        cleanupStep = () => b.destroy();
      }
    } else if (st.type === 'quiz') {
      el.innerHTML = `<section class="card"><p><b>${esc(st.question)}</b></p>${fen ? '<div class="board-row"><div class="board-box" id="b"></div></div>' : ''}
        <div class="quiz">${st.choices.map((c, i) => `<button class="btn block quiz-choice" data-i="${i}">${esc(c)}</button>`).join('')}</div>
        <div class="feedback"></div></section>`;
      if (fen) {
        const c = new Chess(fen);
        const b = createBoard(el.querySelector('#b'), { orientation: cgColor(c.turn()) });
        b.setPosition(c);
        b.setShapes(toShapes(st.shapes));
        cleanupStep = () => b.destroy();
      }
      el.querySelector('.quiz').addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        const ok = +b.dataset.i === st.answer;
        el.querySelectorAll('.quiz-choice').forEach((x) => {
          x.disabled = true;
          if (+x.dataset.i === st.answer) x.classList.add('good');
        });
        if (!ok) b.classList.add('bad');
        const fb = el.querySelector('.feedback');
        fb.className = 'feedback ' + (ok ? 'ok' : 'ko');
        fb.innerHTML = (ok ? '✓ Exact ! ' : '✗ Pas tout à fait. ') + md(st.explain);
      });
    } else if (st.type === 'puzzle') {
      const p = runPuzzle(el, { ...st, fen, prompt: st.text });
      cleanupStep = () => p.destroy();
    } else if (st.type === 'play') {
      cleanupStep = playStep(el, st, fen);
    }
  }

  function finish() {
    update((s) => {
      s.lessons[lesson.id] = { done: true, date: new Date().toISOString() };
    });
    const idx = LESSONS.indexOf(lesson);
    const next = LESSONS[idx + 1];
    cleanupStep?.();
    cleanupStep = null;
    root.innerHTML = `<section class="card center">
      <div class="big">🎓</div><h2>Leçon terminée !</h2>
      <p>Pour ancrer ce que tu viens d’apprendre, fais quelques exercices sur le même thème.</p>
      <div class="row wrap center">
        <a class="btn primary" href="#/puzzles">Exercices de tactique</a>
        ${next ? `<a class="btn" href="#/lesson/${next.id}">Leçon suivante : ${esc(next.title)}</a>` : ''}
        <a class="btn ghost" href="#/learn">Retour aux cours</a>
      </div></section>`;
  }

  renderStep();
  return () => cleanupStep?.();
}

/** Jouer une position contre Stockfish (pleine force) jusqu'à l'objectif. */
function playStep(el, st, fen) {
  const chess = new Chess(fen);
  const me = chess.turn();
  el.innerHTML = `
    <section class="card"><p>${md(st.text)}</p><p class="muted small">Objectif : ${st.goal === 'mate' ? 'faire mat' : 'aller à dame'}${st.maxMoves ? ` en ${st.maxMoves} coups maximum` : ''}.</p></section>
    <div class="board-row"><div class="board-box" id="b"></div></div>
    <div class="feedback"></div>
    <div class="actions"><button class="btn" id="reset">↻ Recommencer</button></div>`;
  const fb = el.querySelector('.feedback');
  const engine = getBotEngine();
  let alive = true;
  let count = 0;
  const board = createBoard(el.querySelector('#b'), { orientation: cgColor(me), onMove });
  board.setPosition(chess, { interactive: me });

  function say(html, cls = '') {
    fb.className = 'feedback ' + cls;
    fb.innerHTML = html;
  }

  async function onMove(uci) {
    const m = playUci(chess, uci);
    if (!m) return board.sync();
    moveSound(!!m.captured);
    count++;
    board.setPosition(chess, { interactive: null });
    if (chess.isCheckmate()) return say(`🎉 Mat en ${count} coups ! ${st.maxMoves && count > st.maxMoves ? 'Essaie maintenant de faire plus court.' : 'Parfait.'}`, 'ok');
    if (chess.isStalemate()) return say('😬 Pat ! Le roi adverse n’a plus de coup mais n’est pas en échec : c’est nulle. Recommence et laisse-lui toujours une case.', 'ko');
    if (st.goal === 'promote' && m.promotion) return say(`🎉 Promotion réussie en ${count} coups !`, 'ok');
    if (chess.isGameOver()) return say(gameOverText(chess) + '. Recommence !', 'ko');
    if (st.maxMoves && count === st.maxMoves) say(`Tu as dépassé ${st.maxMoves} coups : continue, puis recommence pour faire mieux.`, '');
    const r = await engine.search(chess.fen(), { depth: 14 });
    await sleep(250);
    if (!alive || !r.bestmove) return;
    const reply = playUci(chess, r.bestmove);
    if (reply) moveSound(!!reply.captured);
    board.setPosition(chess, { interactive: chess.isGameOver() ? null : me });
    if (chess.isGameOver()) say(gameOverText(chess) + '. Recommence !', 'ko');
    if (st.goal === 'promote' && reply?.captured === 'p') say('Ton pion est tombé… Recommence !', 'ko');
  }

  el.querySelector('#reset').onclick = () => {
    chess.load(fen);
    count = 0;
    say('');
    board.setPosition(chess, { interactive: me });
  };
  return () => {
    alive = false;
    board.destroy();
  };
}

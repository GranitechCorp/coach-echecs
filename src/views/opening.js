// Ouvertures : « Apprendre » (coups commentés) et « S'entraîner » (jouer la ligne de mémoire).
import { Chess } from 'chess.js';
import { db, update, scheduleNext } from '../storage.js';
import { setTitle, esc, md, moveSound, sleep } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { OPENING_LINES, groupOf, parseLine } from '../data/openings.js';
import { cgColor, uciOf, playUci, fig } from '../chessutil.js';

export const tab = 'learn';

export function render(root, lineId, mode = 'learn') {
  if (lineId === 'due') {
    const due = OPENING_LINES.filter((l) => db().openings[l.id]?.due <= Date.now());
    if (!due.length) {
      location.hash = '#/learn';
      return;
    }
    lineId = due[0].id;
    mode = 'train';
  }
  const line = OPENING_LINES.find((l) => l.id === lineId);
  if (!line) {
    location.hash = '#/learn';
    return;
  }
  const side = groupOf(line).side;
  const moves = parseLine(line.moves);
  setTitle(line.name, '#/learn');
  root.innerHTML = `
    <section class="card small"><b>${mode === 'learn' ? '📖 Apprendre' : '🎯 S’entraîner'}</b> — tu joues les ${side === 'w' ? 'Blancs' : 'Noirs'}.
      ${mode === 'train' ? 'Joue les coups de la ligne de mémoire. L’adversaire répond tout seul.' : 'Joue les coups toi-même ou appuie sur « Suivant ».'}</section>
    <div class="board-row"><div class="board-box" id="b"></div></div>
    <div class="coach" id="comment"></div>
    <div class="actions" id="acts"></div>
    <div class="moves card" id="moves"></div>`;
  const chess = new Chess();
  const commentEl = root.querySelector('#comment');
  const actsEl = root.querySelector('#acts');
  const movesEl = root.querySelector('#moves');
  const board = createBoard(root.querySelector('#b'), { orientation: cgColor(side), onMove });
  let i = 0;
  let errors = 0;
  let alive = true;

  const expectedUci = () => {
    const c = new Chess(chess.fen());
    return uciOf(c.move(moves[i].san));
  };

  function renderMoves() {
    const hist = chess.history();
    movesEl.innerHTML = hist.map((san, k) => (k % 2 === 0 ? `<span class="mnum">${k / 2 + 1}.</span>` : '') + `<span class="mv">${fig(san)}</span>`).join(' ') || '<span class="muted">Position de départ</span>';
  }

  function showComment(k) {
    const c = moves[k]?.comment;
    if (!c) return; // on garde le dernier commentaire affiché
    commentEl.hidden = false;
    commentEl.innerHTML = `<div class="coach-title">${Math.floor(k / 2) + 1}${k % 2 === 0 ? '.' : '…'}${fig(moves[k].san)}</div>${md(c)}`;
  }

  function sync() {
    const myTurn = i < moves.length && chess.turn() === side;
    board.setPosition(chess, { interactive: myTurn ? side : null });
    renderMoves();
  }

  async function autoPlay() {
    // joue les coups adverses (et en mode apprendre, attend l'utilisateur)
    while (alive && i < moves.length && chess.turn() !== side) {
      await sleep(mode === 'train' ? 450 : 300);
      if (!alive) return;
      const m = chess.move(moves[i].san);
      moveSound(!!m.captured);
      showComment(i);
      i++;
      sync();
    }
    if (i >= moves.length) end();
    else if (mode === 'learn') board.setShapes([arrow(expectedUci(), 'green')]);
  }

  async function onMove(uci) {
    if (i >= moves.length) return board.sync();
    const exp = expectedUci();
    if (uci === exp || uci === exp.slice(0, 4)) {
      const m = playUci(chess, exp);
      moveSound(!!m.captured);
      board.setShapes([]);
      showComment(i);
      i++;
      sync();
      autoPlay();
      return;
    }
    // mauvais coup
    errors++;
    const c = new Chess(chess.fen());
    const wrong = playUci(c, uci);
    board.setShapes([arrow(uci, 'red'), arrow(exp, 'green')]);
    commentEl.hidden = false;
    commentEl.innerHTML = `<div class="coach-title">✗ ${wrong ? fig(wrong.san) : ''} n’est pas le coup de ta ligne</div><p>Le coup du répertoire est <b>${fig(moves[i].san)}</b>. ${esc(moves[i].comment || '')}</p><p class="muted small">Joue-le pour continuer.</p>`;
    sync();
  }

  function end() {
    board.setPosition(chess, { interactive: null });
    if (mode === 'train') {
      const ok = errors === 0;
      update((s) => {
        const prev = s.openings[line.id] || { box: 0, ok: 0, ko: 0 };
        s.openings[line.id] = { ...scheduleNext(prev, ok), ok: prev.ok + (ok ? 1 : 0), ko: prev.ko + (ok ? 0 : 1), last: new Date().toISOString() };
      });
      const nextDue = OPENING_LINES.find((l) => l.id !== line.id && db().openings[l.id]?.due <= Date.now());
      actsEl.innerHTML = `
        <div class="feedback ${ok ? 'ok' : 'ko'}">${ok ? '🎉 Ligne parfaite ! Elle reviendra en révision plus tard.' : `${errors} erreur${errors > 1 ? 's' : ''} : cette ligne reviendra bientôt.`}</div>
        <button class="btn" id="again">↻ Recommencer</button>
        ${nextDue ? `<a class="btn primary" href="#/opening/${nextDue.id}/train">Ligne suivante →</a>` : '<a class="btn primary" href="#/learn">Terminé</a>'}`;
    } else {
      update((s) => {
        s.openings[line.id] ||= { box: 0, due: Date.now(), ok: 0, ko: 0 };
        s.openings[line.id].last = new Date().toISOString();
      });
      actsEl.innerHTML = `<div class="feedback ok">Fin de la ligne. Passe à l’entraînement pour la mémoriser !</div>
        <button class="btn" id="again">↻ Revoir</button><a class="btn primary" href="#/opening/${line.id}/train">🎯 S’entraîner</a>`;
    }
    actsEl.querySelector('#again').onclick = restart;
  }

  function restart() {
    chess.reset();
    i = 0;
    errors = 0;
    commentEl.hidden = true;
    actsEl.innerHTML = mode === 'learn' ? '<button class="btn" id="step">Suivant ▶</button>' : '<button class="btn ghost" id="show">💡 Montrer le coup</button>';
    actsEl.querySelector('#step')?.addEventListener('click', () => i < moves.length && chess.turn() === side && onMove(expectedUci()));
    actsEl.querySelector('#show')?.addEventListener('click', () => {
      if (i < moves.length && chess.turn() === side) {
        errors++;
        board.setShapes([arrow(expectedUci(), 'green')]);
      }
    });
    board.setShapes([]);
    sync();
    autoPlay();
  }

  restart();
  return () => {
    alive = false;
    board.destroy();
  };
}

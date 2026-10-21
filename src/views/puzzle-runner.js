// Exercice « trouve le coup » réutilisé par les exercices, les cours et « Mes erreurs ».
import { Chess } from 'chess.js';
import { createBoard, arrow } from '../board.js';
import { getAnalysisEngine } from '../engine.js';
import { playUci, uciOf, cgColor, cpWhite, colorName } from '../chessutil.js';
import { explainBest } from '../explain.js';
import { promptBestMove } from '../prompts.js';
import { md, esc, moveSound, sleep } from '../ui.js';
import { db } from '../storage.js';
import { showCoach } from './coach-panel.js';

/**
 * opts : fen, solution (UCI, coups alternés joueur/adversaire), prompt, hint, success,
 *        allowOthers (accepte tout coup aussi bon selon Stockfish), onResult(ok, firstTry), nextLabel, onNext
 */
export function runPuzzle(el, opts) {
  const { fen, solution, prompt = '', hint = '', success = '', allowOthers = false } = opts;
  const chess = new Chess(fen);
  const me = chess.turn();
  el.innerHTML = `
    <div class="puzzle-prompt"><span class="dot ${me}"></span><span>${md(prompt || `Trait aux ${colorName(me)} : trouve le meilleur coup.`)}</span></div>
    <div class="board-row"><div class="board-box"></div></div>
    <div class="feedback" aria-live="polite"></div>
    <div class="actions">
      <button class="btn" data-a="hint">💡 Indice</button>
      <button class="btn" data-a="solution">👁 Solution</button>
      <button class="btn" data-a="explain" hidden>🤔 Pourquoi ?</button>
      <button class="btn primary" data-a="next" hidden>${esc(opts.nextLabel || 'Suivant →')}</button>
    </div>
    <div class="coach" hidden></div>`;
  const fb = el.querySelector('.feedback');
  const coachEl = el.querySelector('.coach');
  const board = createBoard(el.querySelector('.board-box'), { orientation: cgColor(me), onMove });
  let i = 0;
  let firstTry = true;
  let finished = false;
  let alive = true;
  let hintShown = false;
  board.setPosition(chess, { interactive: me });

  function feedback(html, cls = '') {
    fb.className = 'feedback ' + cls;
    fb.innerHTML = html;
  }

  async function onMove(uci) {
    if (finished) return board.sync();
    const expected = solution[i];
    const before = chess.fen();
    const m = playUci(chess, uci);
    if (!m) return board.sync();
    if (db().settings.sound) moveSound(!!m.captured);
    const played = uciOf(m);
    const correct = played === expected || (expected && played === expected.slice(0, 4) && !expected[4]);
    if (correct || chess.isCheckmate()) {
      i++;
      board.setPosition(chess, { interactive: null });
      board.setShapes([]);
      if (i >= solution.length || chess.isCheckmate()) return solved();
      feedback('✓ Bien ! Continue…', 'ok');
      await sleep(450);
      if (!alive) return;
      const reply = playUci(chess, solution[i]);
      if (reply && db().settings.sound) moveSound(!!reply.captured);
      i++;
      board.setPosition(chess, { interactive: me });
      if (i >= solution.length) return solved();
      return;
    }
    // coup différent de la solution : est-il aussi bon ?
    if (allowOthers) {
      board.setPosition(chess, { interactive: null });
      feedback('<span class="muted">Vérification avec Stockfish…</span>');
      const engine = getAnalysisEngine();
      const ref = await engine.search(before, { depth: 12 });
      const mine = await engine.search(chess.fen(), { depth: 12 });
      if (!alive) return;
      const sign = me === 'w' ? 1 : -1;
      const refScore = cpWhite(ref.lines[0]) * sign;
      const myScore = chess.isGameOver() ? 0 : cpWhite(mine.lines[0]) * sign;
      if (myScore >= refScore - 60 || (refScore > 600 && myScore > 600)) {
        return solved('Aussi bon que la solution prévue !');
      }
    }
    firstTry = false;
    feedback('✗ Ce n’est pas le meilleur coup. Réessaie !', 'ko');
    board.setShapes([arrow(played, 'red')]);
    await sleep(700);
    if (!alive) return;
    chess.undo();
    board.setShapes([]);
    board.setPosition(chess, { interactive: me });
  }

  function solved(extra = '') {
    finished = true;
    board.setPosition(chess, { interactive: null });
    feedback(`🎉 ${firstTry ? 'Trouvé du premier coup !' : 'Résolu.'} ${extra ? esc(extra) + ' ' : ''}${success ? md(success) : ''}`, 'ok');
    done(true);
  }

  function done(ok) {
    el.querySelector('[data-a=next]').hidden = !opts.onNext;
    el.querySelector('[data-a=explain]').hidden = false;
    el.querySelector('[data-a=hint]').hidden = true;
    el.querySelector('[data-a=solution]').hidden = true;
    opts.onResult?.(ok, firstTry && ok);
  }

  el.querySelector('.actions').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'hint' && !finished) {
      firstTry = false;
      if (!hintShown) {
        board.setShapes([{ orig: solution[i].slice(0, 2), brush: 'green' }]);
        feedback(hint ? '💡 ' + esc(hint) : '💡 Regarde la pièce entourée.');
        hintShown = true;
      } else {
        board.setShapes([arrow(solution[i], 'green')]);
      }
    } else if (a === 'solution' && !finished) {
      firstTry = false;
      finished = true;
      board.setPosition(chess, { interactive: null });
      while (i < solution.length && alive) {
        board.setShapes([arrow(solution[i], i % 2 === 0 ? 'green' : 'blue')]);
        await sleep(700);
        playUci(chess, solution[i]);
        board.setPosition(chess, { interactive: null });
        i++;
      }
      feedback(`Solution affichée. ${success ? md(success) : ''}`, 'ko');
      done(false);
    } else if (a === 'explain') {
      coachEl.hidden = false;
      coachEl.innerHTML = '<p class="muted">Analyse…</p>';
      const lines = (await getAnalysisEngine().search(fen, { depth: 14, multipv: 2 })).lines;
      if (!alive) return;
      showCoach(coachEl, {
        title: 'Pourquoi c’est le bon coup',
        paragraphs: explainBest(fen, lines),
        getPrompt: () => promptBestMove({ fen, lines, userColor: me, history: [] }),
      });
    } else if (a === 'next') {
      opts.onNext?.();
    }
  });

  return {
    destroy() {
      alive = false;
      board.destroy();
    },
  };
}

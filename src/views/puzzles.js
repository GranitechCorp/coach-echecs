// Exercices : tactique (puzzles Lichess, en ligne), « Mes erreurs » (répétition espacée), exercices des cours.
import { Chess } from 'chess.js';
import { db, update, scheduleNext } from '../storage.js';
import { setTitle, esc, toast } from '../ui.js';
import { runPuzzle } from './puzzle-runner.js';
import { LESSONS } from '../data/lessons.js';
import { stepFen, uciToSan, fig } from '../chessutil.js';

export const tab = 'puzzles';

import { THEMES, THEME_LABELS } from '../data/themes.js';
import { pickFromBank } from '../data/puzzle-bank.js';
import { inClaudeViewer } from '../coach-ai.js';

export { THEMES };
const THEME_FR = THEME_LABELS;

function difficultyFor(rating) {
  // Lichess choisit la difficulté autour de 1500 pour un visiteur anonyme
  if (rating < 1050) return 'easiest';
  if (rating < 1350) return 'easier';
  if (rating < 1650) return 'normal';
  if (rating < 1950) return 'harder';
  return 'hardest';
}

async function fetchLichessPuzzle(theme, rating) {
  const params = new URLSearchParams({ difficulty: difficultyFor(rating) });
  if (theme !== 'mix') params.set('angle', theme);
  const res = await fetch(`https://lichess.org/api/puzzle/next?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Lichess indisponible');
  const data = await res.json();
  const sans = data.game.pgn.split(/\s+/).filter((t) => t && !/^\d+\./.test(t));
  const sol = data.puzzle.solution;
  // la position du puzzle : après le dernier coup adverse du PGN
  for (const n of [sans.length, data.puzzle.initialPly + 1, data.puzzle.initialPly]) {
    const c = new Chess();
    try {
      for (const s of sans.slice(0, n)) c.move(s);
      c.move({ from: sol[0].slice(0, 2), to: sol[0].slice(2, 4), promotion: sol[0][4] });
      c.undo();
      return { id: data.puzzle.id, fen: c.fen(), solution: sol, rating: data.puzzle.rating, themes: data.puzzle.themes };
    } catch {
      /* on essaie la longueur suivante */
    }
  }
  throw new Error('Puzzle illisible');
}

/** Exercices des cours, utilisables hors ligne. */
function lessonPuzzles() {
  const out = [];
  for (const l of LESSONS) for (const st of l.steps) if (st.type === 'puzzle') out.push({ ...st, fen: stepFen(st), lesson: l.title });
  return out;
}

export function render(root, mode = 'tactics', presetTheme = null) {
  if (mode === 'theme') {
    if (presetTheme) update((d) => (d.lastTheme = presetTheme));
    mode = 'tactics';
  }
  setTitle('Exercices');
  const s = db();
  const due = s.mistakes.filter((m) => m.due <= Date.now());
  root.innerHTML = `
    <div class="seg tabs">
      <a href="#/puzzles" class="${mode === 'tactics' ? 'on' : ''}">Tactique</a>
      <a href="#/puzzles/mistakes" class="${mode === 'mistakes' ? 'on' : ''}">Mes erreurs${due.length ? ` <b class="pill">${due.length}</b>` : ''}</a>
      <a href="#/puzzles/lessons" class="${mode === 'lessons' ? 'on' : ''}">Des cours</a>
    </div>
    <div id="head"></div>
    <div id="zone"></div>`;
  const head = root.querySelector('#head');
  const zone = root.querySelector('#zone');
  let current = null;
  const stop = () => current?.destroy();

  if (mode === 'mistakes') {
    if (!due.length) {
      zone.innerHTML = `<section class="card"><p>${s.mistakes.length ? '✅ Rien à revoir pour l’instant : reviens demain !' : 'Pas encore d’erreurs enregistrées.'}</p>
        <p class="muted small">Après chaque bilan de partie, les positions où tu as fait une erreur ou une gaffe arrivent ici. Elles reviennent (1 jour, 2, 4, 8…) jusqu’à ce que tu trouves le bon coup à chaque fois.</p></section>`;
      return;
    }
    let k = 0;
    const next = () => {
      stop();
      const list = db().mistakes.filter((m) => m.due <= Date.now());
      if (!list.length) {
        zone.innerHTML = '<section class="card"><p>🎉 Toutes tes erreurs du jour sont revues !</p></section>';
        head.innerHTML = '';
        return;
      }
      const m = list[0];
      k++;
      head.innerHTML = `<p class="muted small">Position tirée de ta partie ${esc(m.label || '')}. Dans la partie, tu avais joué ${fig(uciToSan(m.fen, m.played))}.</p>`;
      current = runPuzzle(zone, {
        fen: m.fen,
        solution: [m.best],
        allowOthers: true,
        prompt: 'Tu t’étais trompé ici. Trouve le meilleur coup !',
        onResult: (ok, first) =>
          update((d) => {
            const x = d.mistakes.find((y) => y.id === m.id);
            if (x) Object.assign(x, scheduleNext(x, ok && first));
            d.puzzles.history.push({ date: new Date().toISOString(), kind: 'mistake', ok: ok && first });
          }),
        onNext: next,
      });
    };
    next();
    return stop;
  }

  if (mode === 'lessons') {
    const all = lessonPuzzles();
    let idx = Math.floor(Math.random() * all.length);
    const next = () => {
      stop();
      const p = all[idx++ % all.length];
      head.innerHTML = `<p class="muted small">Exercice du cours « ${esc(p.lesson)} »</p>`;
      current = runPuzzle(zone, {
        ...p,
        prompt: p.text,
        onResult: (ok, first) => update((d) => d.puzzles.history.push({ date: new Date().toISOString(), kind: 'lesson', ok: ok && first })),
        onNext: next,
      });
    };
    next();
    return stop;
  }

  // Tactique Lichess
  let theme = s.lastTheme || 'mix';
  let streak = 0;
  let offline = false;
  head.innerHTML = `
    <div class="row between"><span>Classement exercices : <b id="rating">${Math.round(s.puzzles.rating)}</b></span><span class="muted small" id="streak"></span></div>
    <div class="chips scroll" id="themes">${THEMES.map(([id, label]) => `<button class="chip small ${id === theme ? 'on' : ''}" data-t="${id}">${esc(label)}</button>`).join('')}</div>`;
  head.querySelector('#themes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    theme = b.dataset.t;
    update((d) => (d.lastTheme = theme));
    head.querySelectorAll('#themes .chip').forEach((x) => x.classList.toggle('on', x === b));
    load();
  });

  async function load() {
    stop();
    if (inClaudeViewer()) offline = true; // dans claude.ai, la page ne peut pas joindre Lichess
    zone.innerHTML = '<p class="muted card">Chargement d’un exercice…</p>';
    let p;
    try {
      if (offline) throw new Error('hors ligne');
      p = await fetchLichessPuzzle(theme, db().puzzles.rating);
    } catch {
      if (!offline) toast('Lichess ne répond pas : exercices de la banque intégrée.');
      offline = true;
      p = pickFromBank(theme, db().puzzles.rating, db().puzzles.seen || []);
      if (p) update((d) => (d.puzzles.seen = [...(d.puzzles.seen || []).slice(-400), p.id]));
      else {
        const all = lessonPuzzles();
        const q = all[Math.floor(Math.random() * all.length)];
        p = { fen: q.fen, solution: q.solution, rating: null, themes: [], prompt: q.text, allowOthers: q.allowOthers };
      }
    }
    if (!root.isConnected) return;
    const themesFr = (p.themes || []).filter((t) => THEME_FR[t]).map((t) => THEME_FR[t]);
    current = runPuzzle(zone, {
      fen: p.fen,
      solution: p.solution,
      allowOthers: p.allowOthers,
      prompt: p.prompt || `Trait aux ${p.fen.split(' ')[1] === 'w' ? 'Blancs' : 'Noirs'} : trouve le meilleur coup.${p.rating ? ` *(niveau ${p.rating})*` : ''}`,
      success: themesFr.length ? `Thème : ${themesFr.join(', ')}.` : '',
      onResult: (ok, first) => {
        const win = ok && first;
        streak = win ? streak + 1 : 0;
        update((d) => {
          const P = d.puzzles;
          if (p.rating) {
            const expected = 1 / (1 + 10 ** ((p.rating - P.rating) / 400));
            const K = P.played < 20 ? 40 : 20;
            P.rating = Math.max(400, P.rating + K * ((win ? 1 : 0) - expected));
          }
          P.played++;
          if (win) P.solved++;
          P.history.push({ date: new Date().toISOString(), kind: 'lichess', theme, ok: win, rating: Math.round(P.rating) });
          if (P.history.length > 2000) P.history.splice(0, P.history.length - 2000);
          for (const t of p.themes || []) {
            if (!THEME_FR[t]) continue;
            const st = (P.themes[THEME_FR[t]] ||= { played: 0, solved: 0 });
            st.played++;
            if (win) st.solved++;
          }
        });
        head.querySelector('#rating').textContent = Math.round(db().puzzles.rating);
        head.querySelector('#streak').textContent = streak >= 2 ? `🔥 ${streak} d’affilée` : '';
      },
      onNext: load,
    });
  }
  load();
  return stop;
}

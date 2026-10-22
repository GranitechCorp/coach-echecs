// Course contre la montre (comme Puzzle Rush / Puzzle Storm) : un maximum d'exercices, de plus en plus durs,
// 3 erreurs et c'est fini. Exercices tirés de la banque intégrée (fonctionne hors ligne).
import { Chess } from 'chess.js';
import { db, update } from '../storage.js';
import { setTitle, esc, md, confirmDialog, sleep } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { runPuzzle } from './puzzle-runner.js';
import { BANK } from '../data/puzzle-bank-data.js';
import { THEME_LABELS } from '../data/themes.js';
import { describeMove } from '../explain.js';
import { playUci, pvToSan, uciToSan, fig, cgColor, colorName, theName, aName } from '../chessutil.js';

export const tab = 'puzzles';

const MODES = {
  m3: { label: '3 minutes', seconds: 180, step: 40, icon: '⏱', text: 'Le sprint : va vite, mais sans jouer au hasard.' },
  m5: { label: '5 minutes', seconds: 300, step: 30, icon: '⏳', text: 'Un peu plus de temps pour aller plus loin.' },
  survival: { label: 'Survie', seconds: 0, step: 30, icon: '♥', text: 'Pas de chrono : tu continues jusqu’à 3 erreurs.' },
};
const MAX_ERRORS = 3;
const NEXT_DELAY = 300; // enchaînement automatique après une réussite

const today = () => new Date().toISOString().slice(0, 10);

// ─── Outils partagés avec la méthode Woodpecker ───

const EXTRA_THEMES = { mate: 'Mat', middlegame: 'Milieu de partie' };
// ordre de priorité pour nommer le motif principal d'un exercice
const MOTIFS = ['mateIn1', 'mateIn2', 'mate', 'discoveredAttack', 'skewer', 'pin', 'fork', 'endgame', 'opening', 'hangingPiece', 'middlegame'];

/** Difficulté estimée : la note de l'exercice, + un peu pour chaque coup à trouver en plus. */
export const difficulty = (p) => p.rating + 70 * (Math.ceil(p.solution.length / 2) - 1);

const forcedMemo = new Map();
/**
 * Exercice dont le premier coup est le seul coup légal (quelques positions de la banque commencent en échec) :
 * il n'y a rien à trouver, on l'écarte de la course et des lots Woodpecker. Calculé à la demande (≈ 1 ms).
 */
export function isForced(p) {
  if (!forcedMemo.has(p.id)) forcedMemo.set(p.id, new Chess(p.fen).moves().length < 2);
  return forcedMemo.get(p.id);
}

/** Motif principal (pour varier les thèmes). */
export const mainTheme = (p) => MOTIFS.find((t) => p.themes.includes(t)) || p.themes[0] || 'mix';

/** Thèmes en français, sans doublon (« Fourchette, Pièce en prise »). */
export function themeText(p) {
  const labels = [];
  for (const t of p.themes) {
    const l = THEME_LABELS[t] || EXTRA_THEMES[t];
    if (!l || labels.includes(l)) continue;
    if (t === 'mate' && p.themes.some((x) => x.startsWith('mateIn'))) continue;
    labels.push(l);
  }
  return labels.join(', ');
}

/** 2:05 */
export const clock = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** « 45 s », « 12 min 30 s », « 1 h 05 min » */
export function duration(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  const sec = s % 60;
  return sec ? `${m} min ${String(sec).padStart(2, '0')} s` : `${m} min`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Confirmation qu'on peut refermer de force : si tu quittes l'écran (bouton retour du téléphone) pendant
 * qu'elle est ouverte, elle ne doit pas rester par-dessus l'écran suivant. → { promise, close }
 */
export function askConfirm(text, okLabel, cancelLabel) {
  const promise = confirmDialog(text, okLabel, cancelLabel);
  const last = document.body.lastElementChild;
  const box = last?.classList.contains('modal') ? last : null;
  return { promise, close: () => box?.remove() };
}

/** Le coup en mots simples, pour relier la notation aux cases : « Le cavalier part de g5 et va en f7. » */
function moveInWords(fen, uci) {
  const c = new Chess(fen);
  const m = playUci(c, uci);
  if (!m) return '';
  const from = `<b>${m.from}</b>`;
  const to = `<b>${m.to}</b>`;
  if (/[kq]/.test(m.flags)) return `Le roi roque : il part de ${from} et va en ${to}, la tour passe de l’autre côté.`;
  const prise = m.captured ? ` en prenant ${esc(theName(m.captured))}${m.flags.includes('e') ? ' (prise en passant)' : ''}` : '';
  const promo = m.promotion ? ` et devient ${esc(aName(m.promotion))}` : '';
  return `${esc(cap(theName(m.piece)))} part de ${from} et va en ${to}${prise}${promo}.`;
}

/** Ce que fait le premier coup de la solution, sans les mises en garde (trompeuses ici : un sacrifice est voulu). */
function solutionFacts(fen, uci) {
  const out = [];
  const capture = !!playUci(new Chess(fen), uci)?.captured;
  for (const f of describeMove(fen, uci).facts) {
    if (/^(Laisse |Sortir la dame|Le roi bouge en début)/.test(f)) continue;
    if (/^Attention : .* est en prise\.?$/.test(f)) {
      out.push(capture ? 'Ta pièce peut être reprise, mais l’opération reste gagnante.' : 'La pièce semble offerte, mais c’est voulu : la prendre coûterait cher à l’adversaire.');
      continue;
    }
    out.push(f);
  }
  return out;
}

/**
 * Revoir un exercice raté : position de départ, ton coup (rouge), la solution en mots et animée,
 * avec un bouton pour réessayer. opts : { played, intro, backLabel, onBack, autoplay }
 */
export function solutionReview(el, p, { played = null, intro = '', backLabel = '← Retour', onBack, autoplay = false } = {}) {
  let alive = true;
  let runner = null;
  let board = null;
  let playing = false;
  const chess = new Chess(p.fen);
  const me = chess.turn();
  const first = p.solution[0];
  const facts = solutionFacts(p.fen, first);
  const end = new Chess(p.fen);
  for (const u of p.solution) playUci(end, u);
  const themes = themeText(p);

  el.innerHTML = `<div class="tr-review">
    <div class="puzzle-prompt"><span class="dot ${me}"></span><span>${md(intro || `Trait aux ${colorName(me)}.`)}</span></div>
    <div class="board-row"><div class="board-box"></div></div>
    <section class="card tr-sol">
      ${played ? `<p>Tu as joué <b>${esc(fig(uciToSan(p.fen, played)))}</b> <span class="muted small">(flèche rouge)</span>.</p>` : ''}
      <p>Solution : <b class="tr-line">${esc(pvToSan(p.fen, p.solution, 20))}</b></p>
      <p class="small">${moveInWords(p.fen, first)} <span class="muted">(flèche verte)</span></p>
      ${facts.length ? `<ul class="small">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${end.isCheckmate() && p.solution.length > 1 ? '<p class="small">La suite se termine par un <b>échec et mat</b>.</p>' : ''}
      <p class="muted small">${themes ? `Thème : ${esc(themes)} · ` : ''}niveau ${p.rating}</p>
    </section>
    <div class="actions">
      <button class="btn" data-a="play">▶ Voir la solution</button>
      <button class="btn" data-a="retry">🔁 Réessayer</button>
    </div>
    <button class="btn primary block" data-a="back">${esc(backLabel)}</button>
  </div>`;
  board = createBoard(el.querySelector('.board-box'), { orientation: cgColor(me) });
  board.setPosition(chess);
  board.setShapes([...(played ? [arrow(played, 'red')] : []), arrow(first, 'green')]);

  async function play() {
    if (playing || !board) return;
    playing = true;
    const c = new Chess(p.fen);
    board.setPosition(c);
    for (let i = 0; i < p.solution.length; i++) {
      // au premier coup, ton coup reste visible en rouge à côté de la solution
      board.setShapes([...(i === 0 && played ? [arrow(played, 'red')] : []), arrow(p.solution[i], i % 2 === 0 ? 'green' : 'blue')]);
      await sleep(750);
      if (!alive || !board) return;
      playUci(c, p.solution[i]);
      board.setPosition(c, { lastMove: p.solution[i] });
      board.setShapes([]);
      await sleep(350);
      if (!alive || !board) return;
    }
    playing = false;
    const b = el.querySelector('[data-a=play]');
    if (b) b.textContent = '↺ Revoir la solution';
  }

  el.querySelector('.tr-review').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'play') play();
    else if (a === 'back') onBack?.();
    else if (a === 'retry') {
      playing = false;
      board.destroy();
      board = null;
      runner = runPuzzle(el, {
        fen: p.fen,
        solution: p.solution,
        strict: true,
        prompt: 'À toi : retrouve la solution.',
        nextLabel: backLabel,
        onNext: () => onBack?.(),
      });
    }
  });
  if (autoplay) setTimeout(() => alive && play(), 500);

  return {
    destroy() {
      alive = false;
      runner?.destroy();
      board?.destroy();
      board = null;
    },
  };
}

// ─── Données ───

const emptyRush = () => ({ best: { m3: 0, m5: 0, survival: 0 }, history: [] });

function rushData() {
  if (!db().rush?.best || !db().rush?.history)
    update((d) => {
      d.rush = { ...emptyRush(), ...(d.rush || {}) };
      d.rush.best ||= emptyRush().best;
      d.rush.history ||= [];
    });
  return db().rush;
}

/** Pour l'intégrateur (accueil, programme) : records par mode et activité du jour. */
export function rushStats() {
  const r = db().rush || {};
  const best = { ...emptyRush().best, ...(r.best || {}) };
  const t = today();
  const todays = (r.history || []).filter((h) => h.date?.startsWith(t));
  return {
    best,
    today: { runs: todays.length, best: todays.reduce((m, h) => Math.max(m, h.score), 0), solved: todays.reduce((n, h) => n + h.score, 0) },
  };
}

// ─── Choix des exercices ───

/** Prochain exercice : proche de la difficulté visée, jamais déjà vu dans la course, thème différent du précédent si possible. */
function pickNext(run) {
  for (;;) {
    let best = null;
    let bestKey = Infinity;
    for (const p of BANK) {
      if (run.used.has(p.id) || forcedMemo.get(p.id)) continue;
      const key =
        Math.abs(difficulty(p) - run.target) +
        (run.recent.has(p.id) ? 120 : 0) + // déjà vu dans une course récente
        (mainTheme(p) === run.prevTheme ? 60 : 0) + // thèmes mélangés
        Math.random() * 45; // un peu de hasard
      if (key < bestKey) {
        bestKey = key;
        best = p;
      }
    }
    // coup forcé : rien à chercher, on prend le suivant (isForced le mémorise, il sera ignoré ensuite)
    if (!best || !isForced(best)) return best;
  }
}

// ─── Écran ───

export function render(root) {
  setTitle('Course contre la montre', '#/train');
  rushData();
  let run = null; // course en cours
  let runner = null; // exercice affiché
  let review = null; // revue d'un exercice raté
  let timer = null;
  let lastEnd = null;
  let dialog = null; // confirmation « Arrêter » ouverte

  const stopAll = () => {
    dialog?.close();
    dialog = null;
    clearInterval(timer);
    timer = null;
    runner?.destroy();
    runner = null;
    review?.destroy();
    review = null;
  };

  // ── Accueil ──
  function showHome() {
    stopAll();
    const r = rushData();
    const st = rushStats();
    const last = r.history.slice(-5).reverse();
    root.innerHTML = `
      <section class="card tr-intro">
        <p>Résous <b>un maximum d’exercices</b> : ils commencent faciles, puis deviennent plus durs à chaque réussite.
        Une erreur ? Tu vois la solution et tu passes au suivant. <b>3 erreurs et c’est fini.</b></p>
      </section>
      <div class="rush-modes">
        ${Object.entries(MODES)
          .map(
            ([k, m]) => `<button class="card rush-mode" data-mode="${k}">
              <span class="rush-mode-icon">${m.icon}</span>
              <span class="rush-mode-txt"><b>${esc(m.label)}</b><small class="muted">${esc(m.text)}</small></span>
              <span class="rush-mode-best"><small class="muted">Record</small><b>${r.best[k] || 0}</b></span>
            </button>`,
          )
          .join('')}
      </div>
      ${
        last.length
          ? `<section class="card">
        <div class="row between"><h2>Tes dernières courses</h2>${st.today.runs ? `<span class="muted small">Aujourd’hui : ${st.today.runs} course${st.today.runs > 1 ? 's' : ''}</span>` : ''}</div>
        ${last
          .map(
            (h) =>
              `<div class="line-item"><span>${esc(MODES[h.mode]?.label || '')} <span class="muted small">· ${esc(dayLabel(h.date))}</span></span><b>${h.score}${h.record ? ' 🏆' : ''}</b></div>`,
          )
          .join('')}
      </section>`
          : ''
      }
      <section class="card">
        <h2>Comment en tirer le maximum</h2>
        ${md(`- Avant chaque coup, fais le réflexe **échecs, prises, menaces** : presque toutes les solutions s’y cachent.
- Une erreur coûte un cœur, une seconde ne coûte presque rien : va vite sur les exercices faciles, prends 5 secondes de plus quand ça se corse.
- Une ou deux courses par jour valent mieux que dix d’affilée : ton cerveau retient mieux en petites doses.
- Après la course, **revois les exercices ratés** : c’est là que tu apprends le plus.`)}
      </section>`;
    root.querySelector('.rush-modes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) startRun(b.dataset.mode);
    });
  }

  // ── Course ──
  function startRun(mode) {
    stopAll();
    const r = rushData();
    const M = MODES[mode];
    const start = Math.max(600, Math.round((db().puzzles.rating || 900) - 300));
    run = {
      mode,
      M,
      score: 0,
      errors: 0,
      used: new Set(),
      recent: new Set(r.recent || []),
      prevTheme: null,
      start,
      target: start,
      missed: [], // { p, played }
      solved: [], // exercices réussis
      results: [], // { p, ok } dans l'ordre
      current: null,
      seq: 0,
      startedAt: Date.now(),
      endAt: M.seconds ? Date.now() + M.seconds * 1000 : 0,
      prevBest: r.best[mode] || 0,
      over: false,
    };
    root.innerHTML = `
      <div class="rush-hud">
        <div class="rush-clock"><small class="muted">${M.seconds ? 'Temps' : 'Durée'}</small><b id="clock">${M.seconds ? clock(M.seconds) : '0:00'}</b></div>
        <div class="rush-score"><small class="muted">Score</small><b id="score">0</b></div>
        <div class="rush-lives" id="lives" role="img" aria-label="Erreurs restantes">${livesHtml(0)}</div>
      </div>
      ${M.seconds ? '<div class="rush-timebar"><div id="timebar"></div></div>' : ''}
      <div id="rz"></div>
      <div class="row between rush-foot"><span class="muted small" id="lvl"></span><button class="btn ghost small" id="stop">Arrêter</button></div>`;
    root.querySelector('#stop').onclick = async () => {
      if (!run || run.over || dialog) return;
      const d = (dialog = askConfirm('Arrêter la course ? Ton score sera quand même enregistré.', 'Arrêter', 'Continuer'));
      const ok = await d.promise;
      if (dialog === d) dialog = null;
      if (ok && run && !run.over) finish('stop');
    };
    timer = setInterval(tick, 200);
    nextPuzzle();
  }

  function tick() {
    if (!run || run.over) return;
    const el = root.querySelector('#clock');
    if (!el) return;
    if (run.M.seconds) {
      const left = (run.endAt - Date.now()) / 1000;
      el.textContent = clock(left);
      el.parentElement.classList.toggle('hurry', left <= 15);
      const bar = root.querySelector('#timebar');
      if (bar) bar.style.width = `${Math.max(0, (100 * left) / run.M.seconds)}%`;
      if (left <= 0) finish('time');
    } else {
      el.textContent = clock((Date.now() - run.startedAt) / 1000);
    }
  }

  function nextPuzzle() {
    if (!run || run.over) return;
    runner?.destroy();
    runner = null;
    const p = pickNext(run);
    if (!p) return finish('empty');
    run.used.add(p.id);
    run.prevTheme = mainTheme(p);
    run.current = p;
    const seq = ++run.seq;
    const mine = () => run && !run.over && run.seq === seq;
    root.querySelector('#lvl').textContent = `Exercice ${run.used.size} · niveau ${p.rating}`;
    runner = runPuzzle(root.querySelector('#rz'), {
      fen: p.fen,
      solution: p.solution,
      compact: true,
      strict: true,
      onSolved: async () => {
        if (!mine()) return;
        run.score++;
        run.solved.push(p);
        run.results.push({ p, ok: true });
        run.current = null;
        run.target = run.start + run.M.step * run.score; // ça se corse à chaque réussite
        const sc = root.querySelector('#score');
        sc.textContent = run.score;
        sc.parentElement.classList.remove('bump');
        void sc.offsetWidth; // relance l'animation
        sc.parentElement.classList.add('bump');
        await sleep(NEXT_DELAY);
        if (mine()) nextPuzzle();
      },
      onFail: async ({ played, shown }) => {
        if (!mine()) return;
        run.errors++;
        run.missed.push({ p, played });
        run.results.push({ p, ok: false });
        run.current = null;
        root.querySelector('#lives').innerHTML = livesHtml(run.errors);
        await shown;
        if (!mine()) return;
        if (run.errors >= MAX_ERRORS) return finish('errors');
        await sleep(NEXT_DELAY);
        if (mine()) nextPuzzle();
      },
    });
  }

  /** Fin de la course : enregistrement puis bilan (show = false quand on quitte l'écran). */
  function finish(reason, show = true) {
    if (!run || run.over) return;
    run.over = true;
    dialog?.close(); // temps écoulé pendant la confirmation : on la referme
    dialog = null;
    clearInterval(timer);
    timer = null;
    runner?.destroy();
    runner = null;
    const R = run;
    const seconds = Math.round((Math.min(Date.now(), R.endAt || Infinity) - R.startedAt) / 1000);
    const record = R.score > R.prevBest;
    const date = new Date().toISOString();
    update((d) => {
      const x = (d.rush = { ...emptyRush(), ...(d.rush || {}) });
      x.best = { ...emptyRush().best, ...(x.best || {}) };
      x.history ||= [];
      if (record) x.best[R.mode] = R.score;
      x.history.push({ date, mode: R.mode, score: R.score, errors: R.errors, seconds, top: topLevel(R), record });
      if (x.history.length > 300) x.history.splice(0, x.history.length - 300);
      x.recent = [...(x.recent || []), ...R.used].slice(-150);
      // les exercices comptent dans ton activité du jour
      const P = d.puzzles;
      for (const r of R.results) P.history.push({ date, kind: 'rush', theme: mainTheme(r.p), ok: r.ok });
      if (P.history.length > 2000) P.history.splice(0, P.history.length - 2000);
      P.seen = [...(P.seen || []), ...R.used].slice(-400);
    });
    lastEnd = { ...R, reason, seconds, record, unfinished: reason === 'time' || reason === 'stop' ? R.current : null };
    run = null;
    if (show) showEnd();
  }

  // ── Bilan ──
  function showEnd() {
    stopAll();
    const E = lastEnd;
    if (!E) return showHome();
    const M = E.M;
    const reasonTxt = {
      time: '⏱ Temps écoulé !',
      errors: '✗ 3 erreurs : fin de la course.',
      stop: 'Course arrêtée.',
      empty: '🎉 Tu as fait tous les exercices disponibles !',
    }[E.reason];
    const top = topLevel(E);
    const avg = E.score ? E.seconds / E.score : 0;
    const toReview = [...E.missed, ...(E.unfinished ? [{ p: E.unfinished, played: null, unfinished: true }] : [])];
    let recordHtml;
    if (E.record) recordHtml = `<div class="rush-record">🏆 Nouveau record !${E.prevBest ? ` <span class="muted small">(ancien : ${E.prevBest})</span>` : ''}</div>`;
    else if (!E.prevBest) recordHtml = '<div class="muted small">Résous au moins un exercice pour établir ton premier record.</div>';
    else if (E.score === E.prevBest) recordHtml = `<div class="muted small">Tu égales ton record (<b>${E.prevBest}</b>) : encore un exercice de plus pour le battre !</div>`;
    else {
      const gap = E.prevBest - E.score + 1;
      recordHtml = `<div class="muted small">Ton record ${M.seconds ? `en ${esc(M.label)}` : 'en survie'} : <b>${E.prevBest}</b> · encore ${gap} exercice${gap > 1 ? 's' : ''} pour le battre</div>`;
    }
    root.innerHTML = `
      <section class="card center rush-end">
        <div class="muted">${esc(reasonTxt)}</div>
        <div class="rush-final">${E.score}</div>
        <div>exercice${E.score > 1 ? 's' : ''} résolu${E.score > 1 ? 's' : ''} · ${esc(M.label)}</div>
        ${recordHtml}
      </section>
      <section class="card">
        <div class="rush-stats rush-end-stats">
          <div><b>${E.score}</b><small class="muted">réussi${E.score > 1 ? 's' : ''}</small></div>
          <div><b>${E.errors}</b><small class="muted">erreur${E.errors > 1 ? 's' : ''}</small></div>
          <div><b>${top || '–'}</b><small class="muted">plus haut niveau réussi</small></div>
          <div><b>${avg ? esc(duration(avg)) : '–'}</b><small class="muted">par exercice</small></div>
        </div>
        <div class="coach rush-tip">${md(tipFor(E))}</div>
      </section>
      ${
        toReview.length
          ? `<section class="card">
        <h2>À revoir (${toReview.length})</h2>
        <p class="muted small">Prends le temps de comprendre chaque solution : c’est comme ça que les motifs deviennent des réflexes.</p>
        ${toReview
          .map(
            (m, i) => `<button class="list-item rush-miss" data-i="${i}">
              <span><b>${m.unfinished ? (E.reason === 'time' ? 'Pas eu le temps' : 'Pas terminé') : `Exercice ${E.results.findIndex((r) => r.p === m.p) + 1}`}</b> <span class="muted small">· niveau ${m.p.rating}${themeText(m.p) ? ' · ' + esc(themeText(m.p)) : ''}</span><br/>
              <small class="muted">${m.played ? `Tu as joué ${esc(fig(uciToSan(m.p.fen, m.played)))}` : E.reason === 'time' ? 'Exercice en cours à la fin du temps' : 'Exercice en cours quand tu as arrêté'}</small></span>
              <span class="btn small">Revoir</span>
            </button>`,
          )
          .join('')}
      </section>`
          : ''
      }
      <div class="rush-again">
        <button class="btn primary block" id="again">↻ Rejouer · ${esc(M.label)}</button>
        <button class="btn block" id="modes">Changer de mode</button>
      </div>`;
    root.querySelector('#again').onclick = () => startRun(E.mode);
    root.querySelector('#modes').onclick = showHome;
    root.querySelectorAll('.rush-miss').forEach((b) => {
      b.onclick = () => {
        const m = toReview[+b.dataset.i];
        stopAll();
        review = solutionReview(root, m.p, {
          played: m.played,
          intro: m.unfinished
            ? `${E.reason === 'time' ? 'L’exercice que tu n’as pas eu le temps de finir' : 'L’exercice en cours quand tu as arrêté'} : trait aux ${colorName(m.p.fen.split(' ')[1])}.`
            : `Exercice raté : trait aux ${colorName(m.p.fen.split(' ')[1])}.`,
          backLabel: '← Retour au bilan',
          onBack: showEnd,
        });
        window.scrollTo(0, 0);
      };
    });
    window.scrollTo(0, 0);
  }

  showHome();
  return () => {
    if (run && !run.over && run.score > 0) finish('stop', false); // on quitte en pleine course : le score est gardé
    run = null;
    stopAll();
  };
}

function livesHtml(errors) {
  let html = '';
  for (let i = 0; i < MAX_ERRORS; i++) html += i < MAX_ERRORS - errors ? '<span class="rush-life">♥</span>' : '<span class="rush-life lost">✗</span>';
  return html;
}

/** Plus haut niveau réussi pendant la course. */
const topLevel = (R) => R.solved.reduce((m, p) => Math.max(m, p.rating), 0);

function dayLabel(iso) {
  if (!iso) return '';
  if (iso.startsWith(today())) return 'aujourd’hui';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Conseil de fin de course, selon le déroulé. */
function tipFor(E) {
  if (E.reason === 'empty') return '**Impressionnant !** Tu as épuisé la banque d’exercices. Passe à la méthode Woodpecker pour transformer ces motifs en réflexes.';
  if (E.errors >= MAX_ERRORS && E.score < 5)
    return '**Ralentis un peu.** En course, une erreur coûte plus cher qu’une seconde. Avant de jouer, vérifie les **échecs, prises et menaces**, pour toi comme pour ton adversaire.';
  if (E.errors >= MAX_ERRORS)
    return '**Les erreurs sont venues avec la difficulté.** C’est normal : revois les exercices ratés ci-dessous, puis retente ta chance. Ton score montera vite.';
  if (E.reason === 'time' && E.errors === 0)
    return '**Zéro erreur, bravo !** Tu peux te permettre d’aller un peu plus vite sur les exercices faciles du début : ce sont des secondes gagnées pour la fin.';
  if (E.reason === 'time') return '**Bonne course !** Pour aller plus loin, cherche d’abord les coups forcés (échecs et prises) : ils se calculent plus vite.';
  return '**Chaque course entraîne ton coup d’œil.** Une ou deux par jour suffisent pour progresser.';
}

// Méthode Woodpecker (Axel Smith et Hans Tikkanen) : un lot fixe d'exercices, résolu en cycles de plus en plus rapides,
// jusqu'à ce que les motifs deviennent des réflexes. La précision compte plus que la vitesse.
import { db, update } from '../storage.js';
import { setTitle, esc, md, sleep } from '../ui.js';
import { runPuzzle } from './puzzle-runner.js';
import { BANK } from '../data/puzzle-bank-data.js';
import { difficulty, mainTheme, solutionReview, duration, askConfirm } from './rush.js';

export const tab = 'puzzles';

const SIZES = [
  { n: 30, text: 'Idéal pour découvrir la méthode : un premier cycle en 2 ou 3 séances.' },
  { n: 50, text: 'Le bon compromis : assez de motifs, des cycles qui restent courts.' },
  { n: 100, text: 'Pour les motivés : beaucoup de motifs, un premier cycle sur plusieurs jours.' },
];
const GOAL_CYCLES = 7;
const MIN_SECONDS_PER_PUZZLE = 4; // on ne vise jamais moins que ça, même en divisant par deux
const IDLE_PAUSE = 5 * 60 * 1000; // pause automatique après 5 min sans toucher l'écran
const byId = new Map(BANK.map((p) => [p.id, p]));

const EXPLAIN = `Cette méthode vient du livre de deux joueurs suédois, **Axel Smith et Hans Tikkanen** : c’est en l’appliquant que Tikkanen est devenu grand maître. L’idée : au lieu de faire toujours de nouveaux exercices, tu refais **le même lot**, encore et encore, comme le pic-vert (*woodpecker*) qui frappe toujours au même endroit.
- **Cycle 1** : résous tout le lot à ton rythme, même sur plusieurs jours. Calcule chaque exercice jusqu’au bout avant de jouer.
- **Cycles suivants** : le même lot, en visant **la moitié du temps** du cycle précédent.
- Après **6 à 7 cycles**, les motifs sont devenus des **réflexes** : en partie, tu les verras sans les chercher.
- **La précision compte plus que la vitesse** : un coup joué au hasard ne t’apprend rien. Vise au moins 85 % de réussite.
- Entre deux cycles, accorde-toi une petite pause d’un jour ou deux : ta mémoire travaille aussi pendant le repos.`;

// ─── Données ───

function wpData() {
  const w0 = db().woodpecker;
  const fine = w0 && Array.isArray(w0.set) && Array.isArray(w0.cycles) && w0.set.every((id) => byId.has(id)) && (!w0.set.length || curCycle(w0));
  if (!fine)
    update((d) => {
      const w = (d.woodpecker ||= { set: [], cycle: 0, pos: 0, cycles: [] });
      w.set ||= [];
      w.cycles ||= [];
      // exercices disparus de la banque : on les retire du lot
      if (w.set.some((id) => !byId.has(id))) {
        const before = w.set.slice(0, w.pos);
        w.set = w.set.filter((id) => byId.has(id));
        w.pos = Math.min(w.set.length, before.filter((id) => byId.has(id)).length);
      }
      // cycle en cours absent (données abîmées) : on le recrée
      if (w.set.length && !w.cycles[w.cycle - 1]) {
        w.cycle = Math.max(1, w.cycles.length + 1);
        w.pos = 0;
        w.cycles[w.cycle - 1] = { n: w.cycle, startedAt: new Date().toISOString(), finishedAt: null, seconds: 0, solved: 0, errors: 0, missed: [] };
      }
    });
  return db().woodpecker;
}

const curCycle = (w) => w.cycles[w.cycle - 1];
const accuracy = (c) => (c && c.solved + c.errors ? Math.round((100 * c.solved) / (c.solved + c.errors)) : null);
/** Temps visé pour un cycle : la moitié du précédent (sans descendre sous quelques secondes par exercice). */
function goalFor(w, n) {
  const prev = w.cycles[n - 2];
  if (!prev?.finishedAt) return null;
  return Math.max(Math.round(prev.seconds / 2), w.set.length * MIN_SECONDS_PER_PUZZLE);
}

/** Pour l'intégrateur (accueil, programme) : où en est le lot en cours. */
export function woodpeckerStatus() {
  const w = db().woodpecker;
  if (!w?.set?.length) return { active: false, cycle: 0, done: 0, total: 0, cycleFinished: false, goal: GOAL_CYCLES };
  return { active: true, cycle: w.cycle, done: Math.min(w.pos, w.set.length), total: w.set.length, cycleFinished: w.pos >= w.set.length, goal: GOAL_CYCLES };
}

/** Lot construit une fois : autour de ton niveau, thèmes variés, du plus facile au plus difficile (comme dans le livre). */
function buildSet(size) {
  const center = db().puzzles.rating || 900;
  const prev = new Set(db().woodpecker?.lastSet || []);
  const dist = new Map(BANK.map((p) => [p.id, Math.abs(difficulty(p) - center) + (prev.has(p.id) ? 200 : 0) + Math.random() * 40]));
  const groups = new Map();
  for (const p of BANK) {
    const t = mainTheme(p);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(p);
  }
  for (const g of groups.values()) g.sort((a, b) => dist.get(a.id) - dist.get(b.id));
  const chosen = [];
  const taken = new Set();
  // un exercice de chaque thème à tour de rôle, tant qu'on reste proche de ton niveau
  let progress = true;
  while (chosen.length < size && progress) {
    progress = false;
    for (const g of groups.values()) {
      if (chosen.length >= size) break;
      const p = g.find((x) => !taken.has(x.id) && Math.abs(difficulty(x) - center) <= 320);
      if (!p) continue;
      chosen.push(p);
      taken.add(p.id);
      progress = true;
    }
  }
  // complété avec les plus proches de ton niveau
  if (chosen.length < size) {
    const rest = BANK.filter((p) => !taken.has(p.id)).sort((a, b) => dist.get(a.id) - dist.get(b.id));
    chosen.push(...rest.slice(0, size - chosen.length));
  }
  const order = new Map(chosen.map((p, i) => [p.id, i]));
  chosen.sort((a, b) => difficulty(a) - difficulty(b) || order.get(a.id) - order.get(b.id));
  return chosen.map((p) => p.id);
}

/** 1:02:03 ou 12:34 */
function longClock(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const fmtRatio = (r) => r.toFixed(1).replace('.', ',');

// ─── Écran ───

export function render(root) {
  setTitle('Méthode Woodpecker', '#/train');
  wpData();
  let runner = null;
  let review = null;
  let ticker = null;
  let solving = false;
  let paused = false;
  let segStart = null; // début du morceau de temps en cours de comptage
  let lastActivity = Date.now();
  let alive = true;
  let dialog = null; // confirmation « Nouveau lot » ouverte

  // ── Chrono : ne compte que le temps passé sur l'écran d'exercice ──
  const takeElapsed = () => {
    if (segStart === null) return 0;
    const now = Date.now();
    const s = (now - segStart) / 1000;
    segStart = now;
    return s;
  };
  function startCount() {
    if (segStart !== null || !solving || paused || document.visibilityState !== 'visible') return;
    if (curCycle(db().woodpecker)?.finishedAt) return; // cycle bouclé : le chrono est arrêté
    segStart = Date.now();
  }
  function stopCount() {
    if (segStart === null) return;
    const add = takeElapsed();
    segStart = null;
    update((d) => {
      const c = curCycle(d.woodpecker);
      if (c) c.seconds += add;
    });
  }
  const liveSeconds = () => (curCycle(db().woodpecker)?.seconds || 0) + (segStart !== null ? (Date.now() - segStart) / 1000 : 0);

  const onVisibility = () => (document.visibilityState === 'visible' ? startCount() : stopCount());
  const onActivity = () => {
    lastActivity = Date.now();
  };
  document.addEventListener('visibilitychange', onVisibility);
  root.addEventListener('pointerdown', onActivity);

  const stopAll = () => {
    dialog?.close();
    dialog = null;
    stopCount();
    solving = false;
    paused = false;
    clearInterval(ticker);
    ticker = null;
    runner?.destroy();
    runner = null;
    review?.destroy();
    review = null;
  };

  // ── Accueil : explication + choix du lot ──
  function showIntro() {
    stopAll();
    const w = wpData();
    let size = 50;
    const rating = Math.round(db().puzzles.rating || 900);
    root.innerHTML = `
      <section class="card wp-intro">
        <h2>🔁 Le principe</h2>
        ${md(EXPLAIN)}
      </section>
      <section class="card">
        <h2>Choisis ton lot</h2>
        <div class="seg" id="sizes">${SIZES.map((s) => `<button data-n="${s.n}" class="${s.n === size ? 'on' : ''}">${s.n} exercices</button>`).join('')}</div>
        <p class="small" id="size-txt">${esc(SIZES.find((s) => s.n === size).text)}</p>
        <p class="muted small">Les exercices sont choisis autour de ton niveau (classement exercices : ${rating}), avec des thèmes variés, du plus facile au plus difficile. Le lot ne change plus ensuite : c’est le principe !</p>
        <button class="btn primary block" id="create">Créer mon lot et commencer</button>
      </section>
      ${w.archive?.length ? `<p class="muted small center">Lots déjà travaillés : ${w.archive.length} · meilleur nombre de cycles : ${Math.max(...w.archive.map((a) => a.cycles))}</p>` : ''}`;
    root.querySelector('#sizes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-n]');
      if (!b) return;
      size = +b.dataset.n;
      root.querySelectorAll('#sizes button').forEach((x) => x.classList.toggle('on', x === b));
      root.querySelector('#size-txt').textContent = SIZES.find((s) => s.n === size).text;
    });
    root.querySelector('#create').onclick = () => {
      const set = buildSet(size);
      update((d) => {
        d.woodpecker = {
          ...d.woodpecker,
          set,
          cycle: 1,
          pos: 0,
          createdAt: new Date().toISOString(),
          cycles: [{ n: 1, startedAt: new Date().toISOString(), finishedAt: null, seconds: 0, solved: 0, errors: 0, missed: [] }],
        };
      });
      showSolve();
    };
  }

  // ── Tableau de bord du lot ──
  function showDashboard() {
    stopAll();
    const w = wpData();
    if (!w.set.length || !w.cycle) return showIntro();
    const total = w.set.length;
    const c = curCycle(w);
    const finished = w.pos >= total;
    const acc = accuracy(c);
    const goal = goalFor(w, w.cycle);
    const done = w.cycles.filter((x) => x.finishedAt);
    let main;
    if (!finished) {
      main = `<section class="card wp-status">
        <div class="row between"><h2>Cycle ${w.cycle} <span class="muted small">${w.cycle > GOAL_CYCLES ? '(bonus)' : `sur ${GOAL_CYCLES}`}</span></h2><span class="badge">lot de ${total}</span></div>
        <div class="progress"><div style="width:${(100 * w.pos) / total}%"></div></div>
        <div class="row between small"><span>${w.pos} / ${total} exercices</span><span>⏱ ${esc(duration(c.seconds))}${acc !== null ? ` · 🎯 ${acc} %` : ''}</span></div>
        <p class="small">${
          goal
            ? `🎯 Objectif : finir en moins de <b>${esc(duration(goal))}</b> (la moitié du cycle ${w.cycle - 1}), en gardant au moins 85 % de précision.`
            : 'Premier cycle : prends ton temps et calcule chaque exercice jusqu’au bout. <b>La précision avant la vitesse.</b>'
        }</p>
        <button class="btn primary block" id="go">${w.pos ? `▶ Continuer (exercice ${w.pos + 1}/${total})` : `▶ Commencer le cycle ${w.cycle}`}</button>
        <p class="muted small center">Le chrono ne tourne que pendant que tu es sur l’écran des exercices.</p>
      </section>`;
    } else {
      main = cycleSummary(w, c);
    }
    root.innerHTML = `
      ${main}
      ${done.length ? cyclesTable(w) : ''}
      <details class="card wp-how"><summary><b>Comment marche la méthode ?</b></summary>${md(EXPLAIN)}</details>
      <div class="row center"><button class="btn ghost small" id="new">Nouveau lot</button></div>`;
    root.querySelector('#go')?.addEventListener('click', showSolve);
    root.querySelector('#next-cycle')?.addEventListener('click', () => {
      update((d) => {
        const x = d.woodpecker;
        x.cycle++;
        x.pos = 0;
        x.cycles.push({ n: x.cycle, startedAt: new Date().toISOString(), finishedAt: null, seconds: 0, solved: 0, errors: 0, missed: [] });
      });
      showSolve();
    });
    root.querySelector('#missed')?.addEventListener('click', () => reviewMissed(c.missed || [], 0));
    root.querySelector('#new').onclick = async () => {
      if (dialog) return;
      const d = (dialog = askConfirm('Laisser ce lot de côté et en créer un nouveau ? Ta progression sur ce lot sera archivée.', 'Nouveau lot', 'Annuler'));
      const ok = await d.promise;
      if (dialog === d) dialog = null;
      if (!ok || !alive) return;
      update((d) => {
        const x = d.woodpecker;
        x.archive = [...(x.archive || []), { size: x.set.length, cycles: x.cycles.filter((y) => y.finishedAt).length, createdAt: x.createdAt || null, endedAt: new Date().toISOString() }].slice(-20);
        x.lastSet = x.set;
        x.set = [];
        x.cycle = 0;
        x.pos = 0;
        x.cycles = [];
      });
      showIntro();
    };
  }

  /** Bilan d'un cycle terminé : temps, précision, comparaison, objectif du suivant. */
  function cycleSummary(w, c) {
    const prev = w.cycles[c.n - 2];
    const acc = accuracy(c);
    const goal = goalFor(w, c.n);
    const nextGoal = Math.max(Math.round(c.seconds / 2), w.set.length * MIN_SECONDS_PER_PUZZLE);
    const lines = [];
    if (prev?.finishedAt && c.seconds > 0) {
      const r = prev.seconds / c.seconds;
      if (r >= 1.1) lines.push(`⚡ **${fmtRatio(r)} fois plus rapide** que le cycle ${prev.n}.`);
      else if (r > 0.9) lines.push(`À peu près le même temps qu’au cycle ${prev.n}.`);
      else lines.push(`Un peu plus lent qu’au cycle ${prev.n} : pas grave, la précision passe avant.`);
      const dp = acc - accuracy(prev);
      lines.push(dp > 0 ? `🎯 Précision en hausse de ${dp} point${dp > 1 ? 's' : ''}.` : dp < 0 ? `🎯 Précision en baisse de ${-dp} point${dp < -1 ? 's' : ''} : ralentis un peu au prochain cycle.` : '🎯 Même précision qu’au cycle précédent.');
      if (goal) lines.push(c.seconds <= goal ? '✅ Objectif de temps atteint !' : `Objectif de temps (${duration(goal)}) pas encore atteint : tu y arriveras au prochain.`);
    }
    if (acc < 80) lines.push('Ta précision est sous 80 % : au prochain cycle, **calcule jusqu’au bout avant de jouer**. Si ça reste difficile, prends un lot plus petit.');
    else if (acc >= 95) lines.push('Précision remarquable : tu peux accélérer franchement.');
    const last = c.n >= GOAL_CYCLES;
    const missed = c.missed || [];
    return `<section class="card wp-done">
      <div class="center"><div class="big">${last ? '🏁' : '✓'}</div><h2>Cycle ${c.n} terminé !</h2></div>
      <div class="rush-stats">
        <div><b>${esc(duration(c.seconds))}</b><small class="muted">temps total</small></div>
        <div><b>${acc} %</b><small class="muted">précision</small></div>
        <div><b>${c.solved}</b><small class="muted">réussi${c.solved > 1 ? 's' : ''}</small></div>
        <div><b>${c.errors}</b><small class="muted">raté${c.errors > 1 ? 's' : ''}</small></div>
      </div>
      ${lines.length ? `<div class="coach">${md(lines.map((l) => '- ' + l).join('\n'))}</div>` : ''}
      ${
        last
          ? `<p>${md('**Bravo, tu as bouclé les 7 cycles !** Ces motifs sont maintenant des réflexes. Prends un **nouveau lot** pour en ajouter d’autres, ou fais un cycle bonus pour garder la forme.')}</p>`
          : c.seconds <= w.set.length * MIN_SECONDS_PER_PUZZLE
            ? `<p>🎯 <b>Cycle ${c.n + 1}</b> : tu vas déjà très vite (moins de ${MIN_SECONDS_PER_PUZZLE} secondes par exercice). Garde ce rythme et vise <b>100 % de précision</b>.</p>`
            : `<p>🎯 <b>Cycle ${c.n + 1}</b> : vise moins de <b>${esc(duration(nextGoal))}</b>, en gardant ta précision. Accorde-toi un jour ou deux de pause avant de t’y mettre.</p>`
      }
      ${missed.length ? `<button class="btn block" id="missed">${missed.length > 1 ? `Revoir les ${missed.length} exercices ratés` : 'Revoir l’exercice raté'}</button>` : ''}
      <button class="btn primary block" id="next-cycle">▶ ${last ? 'Cycle bonus' : `Commencer le cycle ${c.n + 1}`}</button>
    </section>`;
  }

  function cyclesTable(w) {
    const rows = w.cycles
      .filter((c) => c.finishedAt)
      .map((c) => {
        const goal = goalFor(w, c.n);
        return `<tr><td>Cycle ${c.n}</td><td>${esc(duration(c.seconds))}</td><td>${accuracy(c)} %</td><td>${goal ? `${esc(duration(goal))} ${c.seconds <= goal ? '✅' : ''}` : '–'}</td></tr>`;
      })
      .join('');
    return `<section class="card"><h2>Tes cycles</h2>
      <table class="otable wp-table"><tr><th>Cycle</th><th>Temps</th><th>Précision</th><th>Objectif</th></tr>${rows}</table></section>`;
  }

  /** Revoir un à un les exercices ratés du cycle. */
  function reviewMissed(ids, k) {
    stopAll();
    const list = ids.map((id) => byId.get(id)).filter(Boolean);
    if (k >= list.length) return showDashboard();
    review = solutionReview(root, list[k], {
      intro: `Exercice raté ${k + 1} sur ${list.length}`,
      backLabel: k + 1 < list.length ? 'Suivant →' : '← Bilan du cycle',
      onBack: () => reviewMissed(ids, k + 1),
    });
    window.scrollTo(0, 0);
  }

  // ── Résolution ──
  function showSolve() {
    stopAll();
    const w = wpData();
    if (!w.set.length) return showIntro();
    if (w.pos >= w.set.length) return showDashboard();
    solving = true;
    lastActivity = Date.now();
    const total = w.set.length;
    const goal = goalFor(w, w.cycle);
    root.innerHTML = `
      <div class="wp-hud">
        <div><small class="muted">Cycle</small><b>${w.cycle}</b></div>
        <div><small class="muted">Exercice</small><b id="wp-pos"></b></div>
        <div><small class="muted">Chrono</small><b id="wp-clock">0:00</b></div>
        <div><small class="muted">Précision</small><b id="wp-acc">–</b></div>
      </div>
      <div class="progress wp-progress"><div id="wp-bar"></div></div>
      ${goal ? `<div class="muted small wp-goal" id="wp-goal">Objectif du cycle : moins de ${esc(duration(goal))}</div>` : ''}
      <div id="wz"></div>
      <section class="card center wp-paused" hidden>
        <div class="big">⏸</div>
        <p id="wp-paused-txt">Pause : le chrono est arrêté.</p>
        <button class="btn primary" id="wp-resume">▶ Reprendre</button>
      </section>
      <div class="row between wp-foot">
        <button class="btn ghost small" id="wp-pause">⏸ Pause</button>
        <button class="btn ghost small" id="wp-dash">Tableau de bord</button>
      </div>`;
    const zone = root.querySelector('#wz');
    root.querySelector('#wp-pause').onclick = () => pause(false);
    root.querySelector('#wp-resume').onclick = resume;
    root.querySelector('#wp-dash').onclick = showDashboard;
    startCount();
    ticker = setInterval(tick, 500);
    refreshHud();
    nextPuzzle();

    /** justDone : l'exercice affiché vient d'être compté (pos a déjà avancé), on garde son numéro jusqu'au suivant. */
    function refreshHud(justDone = false) {
      const x = db().woodpecker;
      const c = curCycle(x);
      root.querySelector('#wp-pos').textContent = `${Math.min(x.pos + (justDone ? 0 : 1), total)}/${total}`;
      root.querySelector('#wp-bar').style.width = `${(100 * x.pos) / total}%`;
      const acc = accuracy(c);
      root.querySelector('#wp-acc').textContent = acc === null ? '–' : `${acc} %`;
      tick();
    }

    function tick() {
      if (!solving) return;
      if (!paused && Date.now() - lastActivity > IDLE_PAUSE) pause(true);
      const s = liveSeconds();
      const el = root.querySelector('#wp-clock');
      if (el) el.textContent = longClock(s);
      root.querySelector('#wp-goal')?.classList.toggle('over', !!goal && s > goal);
    }

    function pause(auto) {
      if (paused) return;
      stopCount();
      paused = true;
      zone.hidden = true; // on cache l'échiquier : pas de réflexion gratuite pendant la pause
      root.querySelector('.wp-paused').hidden = false;
      root.querySelector('#wp-pause').hidden = true;
      root.querySelector('#wp-paused-txt').textContent = auto ? 'Pause automatique (5 minutes sans toucher l’écran) : le chrono est arrêté.' : 'Pause : le chrono est arrêté.';
    }

    function resume() {
      paused = false;
      lastActivity = Date.now();
      zone.hidden = false;
      root.querySelector('.wp-paused').hidden = true;
      root.querySelector('#wp-pause').hidden = false;
      startCount();
      tick();
    }

    function record(p, ok, played) {
      update((d) => {
        const x = d.woodpecker;
        const c = curCycle(x);
        c.seconds += takeElapsed();
        if (ok) c.solved++;
        else {
          c.errors++;
          (c.missed ||= []).push(p.id);
        }
        x.pos++;
        if (x.pos >= x.set.length) {
          c.finishedAt = new Date().toISOString();
          segStart = null; // fin du cycle : on arrête le chrono
        }
        d.puzzles.history.push({ date: new Date().toISOString(), kind: 'woodpecker', theme: mainTheme(p), ok, played });
        if (d.puzzles.history.length > 2000) d.puzzles.history.splice(0, d.puzzles.history.length - 2000);
      });
      refreshHud(true);
    }

    function nextPuzzle() {
      review?.destroy();
      review = null;
      runner?.destroy();
      runner = null;
      const x = db().woodpecker;
      if (x.pos >= x.set.length) return showDashboard();
      const p = byId.get(x.set[x.pos]);
      refreshHud();
      window.scrollTo(0, 0);
      runner = runPuzzle(zone, {
        fen: p.fen,
        solution: p.solution,
        compact: true,
        strict: true,
        prompt: `Trait aux ${p.fen.split(' ')[1] === 'w' ? 'Blancs' : 'Noirs'} : trouve le meilleur coup.`,
        onSolved: async () => {
          if (!solving) return;
          record(p, true);
          await sleep(500);
          if (solving && alive) nextPuzzle();
        },
        onFail: async ({ played, shown }) => {
          if (!solving) return;
          record(p, false, played);
          await shown;
          if (!solving || !alive) return;
          runner?.destroy();
          runner = null;
          const last = db().woodpecker.pos >= total;
          review = solutionReview(zone, p, {
            played,
            intro: 'Raté : regarde bien la solution avant de passer à la suite.',
            backLabel: last ? 'Bilan du cycle →' : 'Suivant →',
            onBack: nextPuzzle,
            autoplay: true,
          });
        },
      });
    }
  }

  const w0 = wpData();
  if (w0.set.length && w0.cycle) showDashboard();
  else showIntro();

  return () => {
    alive = false;
    stopAll();
    document.removeEventListener('visibilitychange', onVisibility);
    root.removeEventListener('pointerdown', onActivity);
  };
}

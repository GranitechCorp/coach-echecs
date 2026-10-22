// Vision de l’échiquier : repérer les cases sans hésiter, lire la notation, visualiser des coups.
// Inspiré du « Coordinate trainer » de Lichess et de « Vision » de chess.com, en français et plus complet :
// manches de 30 s, cases difficiles qui reviennent plus souvent, notation française, cavalier, visualisation.
import { Chess, SQUARES } from 'chess.js';
import { db, update } from '../storage.js';
import { setTitle, esc, md, moveSound } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { fenFromMoves, START_FEN, theName, aName, uciOf, cgColor, colorName } from '../chessutil.js';
import { OPENING_LINES, parseLine } from '../data/openings.js';
import { lineChart, attachLineTooltip } from '../charts.js';

export const tab = 'puzzles';

const FILES = 'abcdefgh';
const ROUND_S = 30;
const EMPTY = '8/8/8/8/8/8/8/8';
const fileOf = (sq) => sq.charCodeAt(0) - 97;
const rankOf = (sq) => +sq[1] - 1;
const sqAt = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? FILES[f] + (r + 1) : null);
/** a1 est foncée : (n° de colonne avec a = 1) + rangée pair → foncée. */
export const isDark = (sq) => (fileOf(sq) + rankOf(sq)) % 2 === 0;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const todayKey = () => new Date().toISOString().slice(0, 10);
const fmt1 = (x) => x.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;
const sideLabel = (or) => ({ w: 'Blancs', b: 'Noirs', r: 'au hasard' })[or] || '';

// ───────────── Notation française ─────────────

const FR = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
const EN = { R: 'K', D: 'Q', T: 'R', F: 'B', C: 'N' };

/** Notation anglaise → française : Nf3 → Cf3, Bxe5+ → Fxe5+, exd8=Q# → exd8=D#, Rae1 → Tae1, O-O inchangé. */
export function sanToFr(san) {
  if (!san) return '';
  return String(san)
    .replace(/^[KQRBN]/, (c) => FR[c])
    .replace(/=([QRBN])/, (_, p) => '=' + FR[p]);
}

/** Inverse : Cf3 → Nf3, Txd1 → Rxd1, Rg1 → Kg1, e8=D → e8=Q. */
export function frToSan(fr) {
  if (!fr) return '';
  return String(fr)
    .replace(/^[RDTFC]/, (c) => EN[c])
    .replace(/=([DTFC])/, (_, p) => '=' + EN[p]);
}

const FEM = { q: true, r: true };
const colorAdj = (type, color) => (color === 'w' ? (FEM[type] ? 'blanche' : 'blanc') : FEM[type] ? 'noire' : 'noir');

/** Le coup en mots : « le cavalier va en f3 », « le pion e4 prend en d5 », « petit roque ». */
export function moveInWords(m) {
  let s;
  if (m.flags.includes('k')) s = `petit roque (le roi va en ${m.to}, la tour en f${m.to[1]})`;
  else if (m.flags.includes('q')) s = `grand roque (le roi va en ${m.to}, la tour en d${m.to[1]})`;
  else {
    s = `${m.piece === 'p' ? `le pion ${m.from}` : theName(m.piece)} ${m.captured ? 'prend en' : 'va en'} ${m.to}`;
    if (m.flags.includes('e')) s += ' (prise en passant)';
    if (m.promotion) s += ` et devient ${aName(m.promotion)} (promotion)`;
    const amb = m.san.match(/^[KQRBN]([a-h]?[1-8]?)x?[a-h][1-8]/);
    if (amb && amb[1]) {
      const where = amb[1].length === 2 ? 'de la case' : /[a-h]/.test(amb[1]) ? 'de la colonne' : 'de la rangée';
      s += ` ; le « ${amb[1]} » précise ${FEM[m.piece] ? 'laquelle joue : celle' : 'lequel joue : celui'} ${where} ${amb[1]}`;
    }
  }
  if (m.san.includes('#')) s += ', échec et mat';
  else if (m.san.includes('+')) s += ', avec échec';
  return s;
}

/** « 1.d4 Cf6 2.c4 e6 » */
function movesFr(sans) {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${sanToFr(s)}` : sanToFr(s))).join(' ');
}

const NOTATION_MEMO = `<ul class="v-memo-list">
  <li><b>C</b> cavalier · <b>F</b> fou · <b>T</b> tour · <b>D</b> dame · <b>R</b> roi · pas de lettre = un pion</li>
  <li><b>Cf3</b> : le cavalier va en f3 · <b>e4</b> : le pion avance en e4</li>
  <li><b>x</b> = prend : <b>Fxc4</b>, le fou prend en c4 · <b>exd5</b>, le pion de la colonne e prend en d5</li>
  <li><b>+</b> = échec · <b>#</b> = échec et mat</li>
  <li><b>O-O</b> petit roque (côté roi) · <b>O-O-O</b> grand roque (côté dame)</li>
  <li><b>e8=D</b> : le pion arrive en e8 et devient une dame</li>
  <li><b>Cbd7</b> : deux cavaliers peuvent aller en d7, c’est celui de la colonne b qui y va</li>
  <li>Dans l’appli, les coups sont parfois écrits avec des figurines (♞f3) : c’est la même chose que Cf3.</li>
</ul>`;

// ───────────── Cavalier ─────────────

const KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
export const knightMoves = (sq) => KNIGHT_JUMPS.map(([df, dr]) => sqAt(fileOf(sq) + df, rankOf(sq) + dr)).filter(Boolean);

/** Un plus court chemin de cavalier (parcours en largeur) : [from, …, to]. */
export function knightPath(from, to) {
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const s = queue.shift();
    if (s === to) break;
    for (const n of knightMoves(s)) {
      if (n in prev) continue;
      prev[n] = s;
      queue.push(n);
    }
  }
  const path = [];
  for (let s = to; s; s = prev[s]) path.unshift(s);
  return path;
}

/** FEN (partie plateau) à partir de { e4: 'N', d5: 'p' } */
function boardFen(pieces) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pieces[sqAt(f, r)];
      if (p) {
        if (empty) row += empty;
        empty = 0;
        row += p;
      } else empty++;
    }
    rows.push(row + (empty || ''));
  }
  return rows.join('/');
}

// ───────────── Données (db().vision) ─────────────

const VDEF = () => ({ best: {}, sessions: [], blindLevel: 1, miss: {}, prefs: {}, daily: '', dailyLog: [] });
function ensure(d) {
  const v = (d.vision ||= {});
  for (const [k, val] of Object.entries(VDEF())) if (v[k] === undefined || v[k] === null) v[k] = val;
  return v;
}
const vis = () => ensure(db());
const prefs = () => ({ or: 'w', pieces: false, answer: 'keys', coords: false, variant: 'play', ...vis().prefs });

/** Résumé pour le programme quotidien et l’accueil. */
export function visionStats() {
  const v = db().vision || {};
  const best = v.best || {};
  const today = todayKey();
  const bestFind = Math.max(0, best['find-w'] || 0, best['find-b'] || 0, best['find-r'] || 0);
  return {
    today: (v.sessions || []).filter((s) => s.date?.slice(0, 10) === today).length,
    bestFind,
    level: bestFind < 12 ? 'débutant' : bestFind < 22 ? 'en progrès' : 'solide',
    dailyDone: v.daily === today,
    blindLevel: v.blindLevel || 1,
  };
}

/** Enregistre une manche ; renvoie l’ancien record. */
function saveRound({ mode, key, score, total, orientation = null, misses = {}, hits = {} }) {
  let prev = 0;
  update((d) => {
    const v = ensure(d);
    prev = v.best[key] || 0;
    if (score > prev) v.best[key] = score;
    v.sessions.push({ date: new Date().toISOString(), mode, score, total, orientation });
    if (v.sessions.length > 300) v.sessions.splice(0, v.sessions.length - 300);
    // cases ratées : elles reviendront plus souvent ; chaque réussite les « soigne » un peu
    for (const [sq, n] of Object.entries(misses)) v.miss[sq] = Math.min(6, (v.miss[sq] || 0) + n);
    for (const [sq, n] of Object.entries(hits)) {
      if (!v.miss[sq]) continue;
      v.miss[sq] = Math.max(0, v.miss[sq] - 0.5 * n);
      if (!v.miss[sq]) delete v.miss[sq];
    }
  });
  return { prev, isRecord: score > prev };
}

const weakSquares = () =>
  Object.entries(vis().miss)
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

/** Case au hasard ; les cases difficiles reviennent plus souvent (6 % par case difficile, 30 % au plus). */
function pickSquare(prev, weak) {
  if (weak.length && Math.random() < Math.min(0.3, 0.06 * weak.length)) {
    const w = pick(weak.slice(0, 12));
    if (w !== prev) return w;
  }
  let s;
  do s = SQUARES[rnd(64)];
  while (s === prev);
  return s;
}

// ───────────── Petits outils d’écran ─────────────

/** Minuteries et nettoyage regroupés : tout s’arrête quand on quitte l’écran. */
function makeCtx() {
  const fns = new Set();
  const ctx = {
    alive: true,
    on(fn) {
      fns.add(fn);
    },
    later(fn, ms) {
      const stop = () => clearTimeout(id);
      const id = setTimeout(() => {
        fns.delete(stop);
        if (ctx.alive) fn();
      }, ms);
      fns.add(stop);
    },
    every(fn, ms) {
      const id = setInterval(() => ctx.alive && fn(), ms);
      fns.add(() => clearInterval(id));
    },
    child() {
      const c = makeCtx();
      const d = () => c.dispose();
      fns.add(d);
      c.on(() => fns.delete(d));
      return c;
    },
    dispose() {
      if (!ctx.alive) return;
      ctx.alive = false;
      for (const f of [...fns]) {
        try {
          f();
        } catch (e) {
          console.warn(e);
        }
      }
      fns.clear();
    },
  };
  return ctx;
}

/** Échiquier d’exercice : sans coordonnées par défaut, sans l’aide « nom de la case » (ce serait tricher). */
function visionBoard(el, ctx, orientation, { pieces = false, coords = false, onMove } = {}) {
  const board = createBoard(el, { orientation, coordinates: coords, squareNames: false, onMove });
  board.cg.set({ fen: pieces ? START_FEN : EMPTY, drawable: { enabled: false } });
  ctx.on(() => board.destroy());
  return board;
}

/** Case sous le doigt, calculée sur la boîte de l’échiquier (indépendant de Chessground). */
function squareAt(el, orientation, x, y) {
  const r = el.getBoundingClientRect();
  const col = Math.floor(((x - r.left) / r.width) * 8);
  const row = Math.floor(((y - r.top) / r.height) * 8);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return orientation === 'black' ? sqAt(7 - col, row) : sqAt(col, 7 - row);
}

function onTap(el, ctx, getOrientation, fn) {
  const h = (e) => {
    if ((e.button ?? 0) > 0) return;
    const sq = squareAt(el, getOrientation(), e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();
    fn(sq);
  };
  el.addEventListener('pointerdown', h);
  ctx.on(() => el.removeEventListener('pointerdown', h));
}

/** Colore des cases un instant ; base() = surlignage permanent à remettre ensuite. */
function flash(board, ctx, marks, ms, base = () => ({})) {
  const token = {};
  board.flashToken = token;
  board.cg.set({ highlight: { custom: new Map(Object.entries({ ...base(), ...marks })) } });
  ctx.later(() => {
    if (board.flashToken === token) board.cg.set({ highlight: { custom: new Map(Object.entries(base())) } });
  }, ms);
}
function setMarks(board, marks) {
  board.flashToken = null;
  board.cg.set({ highlight: { custom: new Map(Object.entries(marks)) } });
}

function sideStrip(el, orient) {
  const s = el.querySelector('.v-strip');
  if (!s) return;
  s.className = 'v-strip ' + orient;
  s.textContent = orient === 'white' ? 'Les Blancs sont en bas' : 'Les Noirs sont en bas';
}

function timedHead(withNext = false) {
  return `<div class="v-head">
    <div class="v-timer"><div></div></div>
    <div class="v-stats"><span>✓ <b class="v-score">0</b></span><span class="v-err-count"></span><span class="v-time">${ROUND_S} s</span></div>
    <div class="v-prompt"><span class="v-target">…</span>${withNext ? '<span class="v-next"></span>' : ''}</div>
  </div>`;
}

function startClock(el, ctx, seconds, onEnd) {
  const bar = el.querySelector('.v-timer > div');
  const txt = el.querySelector('.v-time');
  const t0 = performance.now();
  let done = false;
  const tick = () => {
    if (done) return;
    const left = Math.max(0, seconds - (performance.now() - t0) / 1000);
    bar.style.width = `${(left / seconds) * 100}%`;
    bar.classList.toggle('low', left < 5);
    txt.textContent = `${Math.ceil(left)} s`;
    if (left <= 0) {
      done = true;
      onEnd();
    }
  };
  ctx.every(tick, 100);
  tick();
}

/** Fait défiler pour que le bouton « Suivant » reste visible sur un petit écran. */
function reveal(node) {
  try {
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch {
    /* ancien navigateur : tant pis */
  }
}

function pulse(node, cls) {
  node.classList.remove('ok', 'ko');
  void node.offsetWidth; // relance l’animation
  node.classList.add(cls);
}

/** Mini-échiquier HTML : marks = { c6: 'ko' | 'weak2'… } ; les cases marquées sont nommées. */
function miniBoard(marks, orientation = 'white') {
  let html = `<div class="v-mini ${orientation}">`;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sq = orientation === 'black' ? sqAt(7 - x, y) : sqAt(x, 7 - y);
      const m = marks[sq];
      html += `<span class="${isDark(sq) ? 'd' : 'l'}${m ? ' m-' + m : ''}">${m ? sq : ''}${x === 0 ? `<i class="rk">${sq[1]}</i>` : ''}${y === 7 ? `<i class="fl">${sq[0]}</i>` : ''}</span>`;
    }
  }
  return html + '</div>';
}

// ───────────── Les modes ─────────────

const MODES = {
  find: {
    icon: '🎯',
    title: 'Trouve la case',
    text: 'Une case est annoncée (« e4 ») : touche-la sur un échiquier sans lettres ni chiffres. 30 secondes.',
    intro: 'Une case est annoncée en grand : touche-la le plus vite possible. L’échiquier n’a ni lettres ni chiffres : c’est tout l’intérêt ! La case suivante est écrite en petit pour que tu puisses enchaîner.',
    options: ['or', 'pieces'],
    start: 'Commencer (30 s)',
  },
  name: {
    icon: '🔤',
    title: 'Nomme la case',
    text: 'Une case s’allume : donne son nom, colonne puis rangée. 30 secondes.',
    intro: 'Une case s’allume en bleu : donne son nom. Touche d’abord la lettre de la colonne (a à h), puis le chiffre de la rangée (1 à 8). Plus facile : choisis parmi 4 propositions.',
    options: ['or', 'answer', 'pieces'],
    start: 'Commencer (30 s)',
  },
  color: {
    icon: '🌓',
    title: 'Clair ou foncé ?',
    text: 'Sans échiquier : c6 est-elle claire ou foncée ? Pour « voir » le plateau dans ta tête.',
    intro: 'Une case est nommée, sans échiquier : dis si elle est claire ou foncée. C’est l’exercice qui construit l’échiquier dans ta tête (très utile pour voir les diagonales des fous).',
    options: [],
    start: 'Commencer (30 s)',
  },
  notation: {
    icon: '✍️',
    title: 'Lis la notation',
    text: 'Joue le coup écrit (Cf3, Fxc4, O-O…) ou trouve comment s’écrit un coup montré par une flèche.',
    intro: 'Des positions tirées de vraies ouvertures (ton répertoire). « Joue le coup » : un coup est écrit en notation, joue-le sur l’échiquier. « Lis la flèche » : un coup est montré par une flèche, choisis comment il s’écrit. 10 questions.',
    options: ['variant', 'coords'],
    start: 'Commencer (10 coups)',
  },
  knight: {
    icon: '♞',
    title: 'Le cavalier voyageur',
    text: 'Emmène un cavalier d’une case à une autre par le plus court chemin.',
    intro: 'Emmène le cavalier jusqu’à la case jaune en touchant les cases de son trajet, saut par saut, avec le moins de sauts possible. Le cavalier saute en « L » : 2 cases tout droit puis 1 sur le côté. 5 trajets.',
    options: ['or', 'coords'],
    start: 'Commencer (5 trajets)',
  },
  blind: {
    icon: '🧠',
    title: 'Visualisation',
    text: 'Lis quelques coups sans les voir joués, puis retrouve où sont les pièces. Le niveau monte quand tu réussis.',
    intro: 'Quelques coups sont écrits, mais l’échiquier reste sur la position de départ : joue-les dans ta tête, puis réponds (touche la case ou choisis la pièce). Tout juste : niveau suivant, avec 2 demi-coups de plus.',
    options: ['or', 'coords'],
    start: 'Commencer',
  },
};
const MODE_ORDER = ['find', 'name', 'color', 'notation', 'knight', 'blind'];

const OPTION_DEFS = {
  or: { label: 'Orientation', values: [['w', 'Côté Blancs'], ['b', 'Côté Noirs'], ['r', 'Au hasard']] },
  pieces: { label: 'Échiquier', values: [[false, 'Vide'], [true, 'Avec les pièces']] },
  answer: { label: 'Réponse', values: [['keys', 'Colonne puis rangée'], ['choices', '4 propositions']] },
  variant: { label: 'Exercice', values: [['play', 'Joue le coup'], ['read', 'Lis la flèche']] },
  coords: { label: 'Coordonnées sur l’échiquier', values: [[false, 'Cachées'], [true, 'Affichées']] },
};

function recordKey(mode, o) {
  if (mode === 'find') return `find-${o.or}`;
  if (mode === 'name') return `${o.answer === 'choices' ? 'name4' : 'name'}-${o.or}`;
  if (mode === 'notation') return `notation-${o.variant}`;
  return mode;
}

/** Texte des records d’un mode. */
function recordsText(mode) {
  const b = vis().best;
  const sides = (prefix) =>
    ['w', 'b', 'r']
      .filter((o) => b[`${prefix}-${o}`])
      .map((o) => `${o === 'r' ? 'hasard' : sideLabel(o)} ${b[`${prefix}-${o}`]}`)
      .join(' · ');
  let t = '';
  if (mode === 'find') t = sides('find');
  if (mode === 'name') t = [sides('name'), sides('name4') && `4 choix : ${sides('name4')}`].filter(Boolean).join(' · ');
  if (mode === 'color') t = b.color ? `${b.color} en ${ROUND_S} s` : '';
  if (mode === 'notation') t = [b['notation-play'] && `jouer ${b['notation-play']}/10`, b['notation-read'] && `lire ${b['notation-read']}/10`].filter(Boolean).join(' · ');
  if (mode === 'knight') t = b.knight ? `${b.knight}/5 trajets parfaits` : '';
  if (mode === 'blind') t = b.blind ? `niveau ${b.blind} réussi` : '';
  return t ? `Record : ${t}` : 'Pas encore de record';
}

// ───────────── Écran d’accueil Vision ─────────────

function menu(el) {
  const v = vis();
  const st = visionStats();
  const finds = v.sessions.filter((s) => s.mode === 'find').slice(-20);
  const weak = Object.entries(v.miss).filter(([, n]) => n >= 1);
  el.innerHTML = `
    <section class="card v-hero">
      <h2>👁 Vision de l’échiquier</h2>
      <p>Objectif : voir où sont <b>c6</b>, <b>h7</b> ou <b>f3</b> instantanément, sans chercher les lettres et les chiffres. Les livres, les vidéos et tes bilans parlent en cases : les voir sans effort, c’est comprendre et calculer plus vite.</p>
      <div class="v-kpis">
        <div><b>${esc(st.level)}</b><small>ton niveau</small></div>
        <div><b>${st.bestFind || '—'}</b><small>record en 30 s</small></div>
        <div><b>${st.today}</b><small>${st.today > 1 ? 'manches' : 'manche'} aujourd’hui</small></div>
      </div>
      <div id="v-chart"></div>
    </section>
    <section class="card v-daily ${st.dailyDone ? 'done' : ''}">
      <h2>📅 Défi du jour</h2>
      <p class="small">3 manches de 30 secondes : <b>Trouve la case</b> côté Blancs, puis côté Noirs, puis <b>Nomme la case</b>. Environ 2 minutes.</p>
      ${st.dailyDone ? '<p class="good-txt small">✓ Fait aujourd’hui. Tu peux le refaire pour battre ton score.</p>' : ''}
      <a class="btn ${st.dailyDone ? '' : 'primary'} block" href="#/vision/daily">${st.dailyDone ? '↻ Refaire le défi' : '▶ Lancer le défi du jour'}</a>
    </section>
    <h2 class="v-section">Les exercices</h2>
    ${MODE_ORDER.map((id) => {
      const m = MODES[id];
      return `<a class="card v-mode" href="#/vision/${id}">
        <span class="v-mode-icon">${m.icon}</span>
        <span class="v-mode-body"><b>${esc(m.title)}</b><small class="muted">${esc(m.text)}</small><small class="v-rec">${esc(recordsText(id))}${id === 'blind' ? ` · niveau actuel ${v.blindLevel}` : ''}</small></span>
        <span class="v-go">›</span></a>`;
    }).join('')}
    ${
      weak.length
        ? `<section class="card">
      <h2>Tes cases difficiles</h2>
      <p class="small muted">Les cases où tu t’es le plus souvent trompé (vues côté Blancs). Elles reviennent plus souvent dans « Trouve la case » et « Nomme la case », jusqu’à ce que tu les trouves sans erreur.</p>
      ${miniBoard(Object.fromEntries(weak.map(([s, n]) => [s, n >= 3 ? 'weak3' : n >= 2 ? 'weak2' : 'weak1'])))}
    </section>`
        : ''
    }
    <section class="card v-method">
      <h2>📖 La méthode</h2>
      <ul>
        <li><b>5 minutes par jour pendant 2 à 3 semaines</b> : le défi du jour + un exercice au choix. Mieux vaut 5 minutes chaque jour qu’une heure le dimanche.</li>
        <li><b>Semaine 1 : côté Blancs</b> (tes parties avec le Gambit Dame). <b>Semaine 2 : côté Noirs</b> (la Caro-Kann), là où tout est inversé. <b>Semaine 3 : au hasard</b>, plus la notation et la visualisation.</li>
        <li>Dis le nom de la case à voix basse quand tu la touches : la voix aide la mémoire.</li>
        <li>Objectif : plus de 20 bonnes réponses en 30 s des deux côtés. À ce moment-là, «&nbsp;c6&nbsp;» ou «&nbsp;h7&nbsp;» te sauteront aux yeux.</li>
      </ul>
      <h2>📍 Les repères à connaître par cœur</h2>
      <ul>
        <li><b>Côté Blancs</b>, les colonnes vont de <b>a à h, de gauche à droite</b>, et la rangée 1 est en bas. <b>Côté Noirs</b>, tout est inversé : h à gauche, rangée 8 en bas.</li>
        <li><b>a1 est foncée, h1 est claire</b> : chaque joueur a une case claire en bas à droite.</li>
        <li>Les colonnes a-b-c-d forment l’<b>aile dame</b>, e-f-g-h l’<b>aile roi</b>.</li>
        <li>Le centre : <b>d4, e4, d5, e5</b>. Les cases des cavaliers : <b>c3, f3</b> (Blancs) et <b>c6, f6</b> (Noirs).</li>
        <li><b>f2 et f7</b> : les points faibles du début de partie, défendus seulement par le roi.</li>
        <li>Les grandes diagonales : <b>a1-h8</b> (cases foncées) et <b>h1-a8</b> (cases claires).</li>
        <li>Les roques : petit roque → roi en <b>g1</b> (g8) et tour en f1 (f8) ; grand roque → roi en <b>c1</b> (c8) et tour en d1 (d8).</li>
        <li>La dame sur sa couleur : dame blanche en <b>d1</b> (claire), dame noire en <b>d8</b> (foncée).</li>
      </ul>
      <p class="small muted">Pendant tes parties : Réglages → « Repérage sur l’échiquier » affiche le nom de la case que tu touches.</p>
    </section>`;
  if (finds.length >= 2) {
    const pts = finds.map((s) => {
      const day = new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const side = s.orientation === 'r' ? 'orientation au hasard' : `côté ${sideLabel(s.orientation)}`;
      return { y: s.score, x: day, label: `${day} : ${s.score} (${side})` };
    });
    const box = el.querySelector('#v-chart');
    box.innerHTML = `<p class="small muted">Tes dernières manches « Trouve la case »</p>${lineChart(pts, { height: 110, yLabel: 'Bonnes réponses en 30 s' })}`;
    attachLineTooltip(box, pts, { height: 110 });
  }
}

// ───────────── Écran d’un mode : réglages → exercice → résultat ─────────────

function modeScreen(el, mode, ctx) {
  let phase = null;
  const fresh = () => {
    phase?.dispose();
    phase = ctx.child();
    return phase;
  };
  const setup = () => renderSetup(el, mode, fresh(), start);
  const start = () => {
    window.scrollTo(0, 0);
    RUNNERS[mode](el, fresh(), prefs(), (res) => {
      if (res.restart) return start();
      showResult(el, fresh(), res, { again: start, setup });
    });
  };
  setup();
}

function renderSetup(el, mode, ctx, start) {
  const m = MODES[mode];
  const p = prefs();
  el.innerHTML = `
    <section class="card">
      <h2>${m.icon} ${esc(m.title)}</h2>
      <p>${esc(m.intro)}</p>
      ${m.options
        .map((k) => {
          const def = OPTION_DEFS[k];
          return `<p class="small muted v-opt-label">${esc(def.label)}</p>
          <div class="seg v-seg" data-pref="${k}">${def.values.map(([val, label]) => `<button data-v="${String(val)}" class="${String(p[k]) === String(val) ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
        })
        .join('')}
      <button class="btn primary block" id="v-start">▶ ${esc(m.start)}</button>
      <p class="small muted center v-rec-line">${esc(recordsText(mode))}${mode === 'blind' ? ` · tu es au niveau ${vis().blindLevel}` : ''}</p>
    </section>
    ${setupExtra(mode)}`;
  el.querySelectorAll('.v-seg').forEach((seg) =>
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = seg.dataset.pref;
      const raw = b.dataset.v;
      const val = raw === 'true' ? true : raw === 'false' ? false : raw;
      update((d) => (ensure(d).prefs[k] = val));
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
  el.querySelector('#v-start').onclick = start;
}

function setupExtra(mode) {
  if (mode === 'color')
    return `<section class="card coach">
      <div class="coach-title">💡 Les astuces pour ne jamais se tromper</div>
      <ul>
        <li><b>a1 est foncée</b> et <b>h1 est claire</b> (« la case claire à droite »).</li>
        <li>Le calcul : numérote les colonnes (a = 1, b = 2 … h = 8) et ajoute la rangée. <b>Pair → foncée, impair → claire.</b> Exemple : e4 → 5 + 4 = 9, impair : e4 est claire.</li>
        <li>Plus rapide : colonnes <b>a, c, e, g</b> avec une rangée impaire → foncée ; colonnes <b>b, d, f, h</b> avec une rangée impaire → claire. Et l’inverse pour les rangées paires.</li>
        <li><b>La dame sur sa couleur</b> : d1 (dame blanche) est claire, d8 (dame noire) est foncée.</li>
        <li>Une diagonale garde toujours la même couleur : a1-h8 est foncée, h1-a8 est claire. C’est pour ça qu’un fou reste toujours sur sa couleur.</li>
      </ul></section>`;
  if (mode === 'notation') return `<section class="card"><h2>Rappel de la notation</h2>${NOTATION_MEMO}</section>`;
  if (mode === 'find' || mode === 'name')
    return `<section class="card coach"><div class="coach-title">💡 Comment s’y prendre</div>
      <ul>
        <li>Ne compte pas les cases une par une : repère d’abord la <b>moitié</b> (a-d à gauche côté Blancs), puis le <b>quart</b>, puis la case.</li>
        <li>Appuie-toi sur les repères : d4/e4 au centre, c3/f3 les cases des cavaliers, g1/g8 les cases du roi après le petit roque.</li>
        <li>Côté Noirs, tout est inversé : la colonne a est à <b>droite</b> et la rangée 1 en <b>haut</b>.</li>
      </ul></section>`;
  return '';
}

// ───────────── 1. Trouve la case ─────────────

function runFind(el, ctx, opts, onEnd) {
  el.innerHTML = `${timedHead(true)}
    <div class="board-row"><div class="board-box v-board"></div></div>
    <div class="v-strip"></div>`;
  const boardEl = el.querySelector('.v-board');
  const random = opts.or === 'r';
  let orient = opts.or === 'b' ? 'black' : 'white';
  const board = visionBoard(boardEl, ctx, orient, { pieces: opts.pieces });
  const weak = weakSquares();
  const targetEl = el.querySelector('.v-target');
  const nextEl = el.querySelector('.v-next');
  let target = pickSquare(null, weak);
  let next = pickSquare(target, weak);
  let score = 0;
  let errors = 0;
  let busy = false;
  let over = false;
  const misses = {};
  const hits = {};
  const show = () => {
    if (random) {
      orient = Math.random() < 0.5 ? 'white' : 'black';
      if (board.orientation !== orient) board.orientation = orient;
    }
    targetEl.textContent = target;
    nextEl.textContent = `puis ${next}`;
    sideStrip(el, orient);
  };
  const advance = () => {
    target = next;
    next = pickSquare(target, weak);
    show();
  };
  show();
  onTap(boardEl, ctx, () => orient, (sq) => {
    if (busy || over) return;
    if (sq === target) {
      score++;
      hits[sq] = (hits[sq] || 0) + 1;
      el.querySelector('.v-score').textContent = score;
      pulse(el.querySelector('.v-score'), 'ok');
      if (!random) flash(board, ctx, { [sq]: 'v-ok' }, 220);
      advance();
    } else {
      errors++;
      misses[target] = (misses[target] || 0) + 1;
      el.querySelector('.v-err-count').textContent = `✗ ${errors}`;
      flash(board, ctx, { [sq]: 'v-ko', [target]: 'v-good' }, 650);
      pulse(targetEl, 'ko');
      busy = true;
      ctx.later(() => {
        busy = false;
        targetEl.classList.remove('ko');
        advance();
      }, 650);
    }
  });
  startClock(el, ctx, ROUND_S, () => {
    over = true;
    onEnd({ mode: 'find', key: `find-${opts.or}`, score, errors, total: score + errors, misses, hits, orientation: opts.or });
  });
}

// ───────────── 2. Nomme la case ─────────────

/** 4 propositions : la bonne + des confusions classiques (case vue de l’autre côté, voisines). */
function nameChoices(sq) {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const near = [sqAt(7 - f, 7 - r), sqAt(7 - f, r), sqAt(f, 7 - r), sqAt(f + 1, r), sqAt(f - 1, r), sqAt(f, r + 1), sqAt(f, r - 1)];
  const cands = [...new Set(near.filter((s) => s && s !== sq))];
  const out = [sq, ...shuffle(cands.slice(0, 3)).slice(0, 2)];
  for (const s of shuffle(cands.slice(2))) if (out.length < 4 && !out.includes(s)) out.push(s);
  while (out.length < 4) {
    const s = SQUARES[rnd(64)];
    if (!out.includes(s)) out.push(s);
  }
  return shuffle(out);
}

function runName(el, ctx, opts, onEnd) {
  const choices = opts.answer === 'choices';
  el.innerHTML = `${timedHead(false)}
    <div class="board-row"><div class="board-box v-board"></div></div>
    <div class="v-strip"></div>
    <div class="v-answer">${
      choices
        ? '<div class="v-choices"></div>'
        : `<div class="v-keys">${[...FILES].map((f) => `<button class="btn" data-f="${f}">${f}</button>`).join('')}</div>
           <div class="v-keys">${[1, 2, 3, 4, 5, 6, 7, 8].map((r) => `<button class="btn" data-r="${r}">${r}</button>`).join('')}</div>`
    }</div>`;
  const boardEl = el.querySelector('.v-board');
  const random = opts.or === 'r';
  let orient = opts.or === 'b' ? 'black' : 'white';
  const board = visionBoard(boardEl, ctx, orient, { pieces: opts.pieces });
  const weak = weakSquares();
  const targetEl = el.querySelector('.v-target');
  const answerEl = el.querySelector('.v-answer');
  let target = null;
  let file = '';
  let rank = '';
  let score = 0;
  let errors = 0;
  let busy = false;
  let over = false;
  const misses = {};
  const hits = {};
  const base = () => (target ? { [target]: 'v-lit' } : {});
  const typed = () => {
    targetEl.textContent = `${file || '?'}${rank || '?'}`;
    answerEl.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === file));
    answerEl.querySelectorAll('[data-r]').forEach((b) => b.classList.toggle('on', b.dataset.r === rank));
  };
  const newTarget = () => {
    target = pickSquare(target, weak);
    file = '';
    rank = '';
    if (random) {
      orient = Math.random() < 0.5 ? 'white' : 'black';
      if (board.orientation !== orient) board.orientation = orient;
    }
    sideStrip(el, orient);
    setMarks(board, base());
    targetEl.classList.remove('ok', 'ko', 'v-name-ko');
    if (choices) {
      targetEl.textContent = '?';
      answerEl.querySelector('.v-choices').innerHTML = nameChoices(target)
        .map((s) => `<button class="btn" data-s="${s}">${s}</button>`)
        .join('');
    } else typed();
  };
  const answer = (sq) => {
    if (busy || over) return;
    busy = true;
    if (sq === target) {
      score++;
      hits[sq] = (hits[sq] || 0) + 1;
      el.querySelector('.v-score').textContent = score;
      targetEl.textContent = sq;
      pulse(targetEl, 'ok');
      flash(board, ctx, { [sq]: 'v-ok' }, 200, base);
      ctx.later(() => {
        busy = false;
        newTarget();
      }, 200);
    } else {
      errors++;
      misses[target] = (misses[target] || 0) + 1;
      el.querySelector('.v-err-count').textContent = `✗ ${errors}`;
      targetEl.textContent = `${sq} ✗ c’était ${target}`;
      targetEl.classList.add('v-name-ko');
      pulse(targetEl, 'ko');
      flash(board, ctx, { [target]: 'v-good' }, 1000, base);
      if (choices) answerEl.querySelector(`[data-s="${target}"]`)?.classList.add('right');
      ctx.later(() => {
        busy = false;
        newTarget();
      }, 1000);
    }
  };
  answerEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || busy || over) return;
    if (b.dataset.s) {
      if (b.dataset.s !== target) b.classList.add('wrong');
      return answer(b.dataset.s);
    }
    if (b.dataset.f) file = b.dataset.f;
    if (b.dataset.r) rank = b.dataset.r;
    typed();
    if (file && rank) answer(file + rank);
  });
  newTarget();
  startClock(el, ctx, ROUND_S, () => {
    over = true;
    onEnd({ mode: 'name', key: recordKey('name', opts), score, errors, total: score + errors, misses, hits, orientation: opts.or });
  });
}

// ───────────── 3. Clair ou foncé ─────────────

function colorWhy(sq) {
  const n = fileOf(sq) + 1;
  const r = rankOf(sq) + 1;
  const sum = n + r;
  return `**${sq}** : ${sq[0]} = ${n}, et ${n} + ${r} = ${sum} (${sum % 2 ? 'impair' : 'pair'}) → **${sum % 2 ? 'claire' : 'foncée'}**`;
}

function runColor(el, ctx, opts, onEnd) {
  el.innerHTML = `<div class="v-color">${timedHead(false)}</div>
    <div class="v-color-btns">
      <button class="v-col light" data-c="l"><i></i>Claire</button>
      <button class="v-col dark" data-c="d"><i></i>Foncée</button>
    </div>
    <div class="feedback v-color-fb" aria-live="polite"></div>`;
  const targetEl = el.querySelector('.v-target');
  const fb = el.querySelector('.v-color-fb');
  let target = null;
  let score = 0;
  let errors = 0;
  let busy = false;
  let over = false;
  const missed = [];
  const newTarget = () => {
    target = pickSquare(target, []);
    targetEl.textContent = target;
    targetEl.classList.remove('ok', 'ko');
  };
  el.querySelector('.v-color-btns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b || busy || over) return;
    busy = true;
    if ((b.dataset.c === 'd') === isDark(target)) {
      score++;
      el.querySelector('.v-score').textContent = score;
      pulse(targetEl, 'ok');
      fb.className = 'feedback v-color-fb ok';
      fb.textContent = '✓';
      ctx.later(() => {
        busy = false;
        newTarget();
      }, 150);
    } else {
      errors++;
      if (!missed.includes(target)) missed.push(target);
      el.querySelector('.v-err-count').textContent = `✗ ${errors}`;
      pulse(targetEl, 'ko');
      fb.className = 'feedback v-color-fb ko';
      fb.innerHTML = md(colorWhy(target));
      ctx.later(() => {
        busy = false;
        fb.textContent = '';
        newTarget();
      }, 1500);
    }
  });
  newTarget();
  startClock(el, ctx, ROUND_S, () => {
    over = true;
    // une erreur de couleur ne fait pas d’une case une « case difficile à situer »
    onEnd({ mode: 'color', key: 'color', score, errors, total: score + errors, colorMisses: missed, orientation: null });
  });
}

// ───────────── 4. Lis la notation ─────────────

const OPENING_SANS = OPENING_LINES.map((l) => ({ name: l.name, sans: parseLine(l.moves).map((m) => m.san) })).filter((l) => l.sans.length >= 3);

const moveWeight = (m) => {
  if (m.flags.includes('k') || m.flags.includes('q')) return 6;
  if (m.promotion) return 6;
  let w = m.piece === 'p' ? 1 : 2;
  if (m.captured) w += 2;
  if (m.san.includes('+')) w += 2;
  if (/^[KQRBN][a-h1-8]x?[a-h][1-8]/.test(m.san)) w += 3; // désambiguïsation (Cbd7)
  return w;
};
function weightedPick(arr, weight) {
  const ws = arr.map(weight);
  let x = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < arr.length; i++) if ((x -= ws[i]) <= 0) return arr[i];
  return arr.at(-1);
}

/** Une position d’ouverture réelle (préfixe d’une ligne du répertoire) et un coup légal à lire. */
function notationQuestion() {
  for (let tries = 0; tries < 30; tries++) {
    const line = pick(OPENING_SANS);
    const k = 1 + rnd(line.sans.length - 1);
    let fen;
    try {
      fen = fenFromMoves(line.sans.slice(0, k).join(' '));
    } catch {
      continue;
    }
    const chess = new Chess(fen);
    const legal = chess.moves({ verbose: true });
    if (!legal.length) continue;
    // souvent le coup de la théorie, sinon un coup légal choisi pour la variété de notation
    let move = Math.random() < 0.4 ? legal.find((m) => m.san === line.sans[k]) : null;
    move ||= weightedPick(legal, moveWeight);
    return { fen, move, legal, turn: chess.turn() };
  }
  const chess = new Chess();
  const legal = chess.moves({ verbose: true });
  return { fen: chess.fen(), move: pick(legal), legal, turn: 'w' };
}

/** 4 écritures possibles : la bonne + des pièges utiles (x oublié, case vue à l’envers, autre pièce…). */
export function notationChoices(move, legal) {
  const right = sanToFr(move.san);
  const fake = [];
  const dest = /([a-h])([1-8])(?=[^a-h1-8]*$)/;
  if (move.flags.includes('k')) fake.push('O-O-O', `R${move.to}`, `Tf${move.to[1]}`);
  else if (move.flags.includes('q')) fake.push('O-O', `R${move.to}`, `Td${move.to[1]}`);
  else {
    if (move.piece !== 'p') fake.push(move.captured ? right.replace('x', '') : right.replace(/([a-h][1-8])(?=[^a-h1-8]*$)/, 'x$1'));
    fake.push(right.replace(dest, (_, f, r) => FILES[7 - fileOf(f)] + r));
    fake.push(right.replace(dest, (_, f, r) => f + (9 - +r)));
    const other = legal.filter((m) => m.to === move.to && m.san !== move.san);
    if (other.length) fake.push(sanToFr(pick(other).san));
    const same = legal.filter((m) => m.piece === move.piece && m.to !== move.to);
    if (same.length) fake.push(sanToFr(pick(same).san));
  }
  const uniq = [...new Set(fake)].filter((s) => s && s !== right);
  const out = [right, ...shuffle(uniq.slice(0, 5)).slice(0, 3)];
  for (const m of shuffle([...legal])) if (out.length < 4 && !out.includes(sanToFr(m.san))) out.push(sanToFr(m.san));
  return shuffle(out);
}

function runNotation(el, ctx, opts, onEnd) {
  const N = 10;
  const read = opts.variant === 'read';
  const t0 = performance.now();
  let i = 0;
  let score = 0;
  let q = null;
  const missed = [];
  el.innerHTML = `
    <div class="v-head">
      <div class="v-stats"><span>Question <b class="v-qn">1</b>/${N}</span><span>✓ <b class="v-score">0</b></span></div>
      <div class="v-nprompt"></div>
    </div>
    <div class="board-row"><div class="board-box v-board v-board-play"></div></div>
    <div class="v-answer"></div>
    <div class="feedback" aria-live="polite"></div>
    <div class="actions"><button class="btn primary v-next-btn" hidden>Suivant →</button></div>
    <details class="card small v-memo"><summary>Rappel de la notation</summary>${NOTATION_MEMO}</details>`;
  const prompt = el.querySelector('.v-nprompt');
  const answerEl = el.querySelector('.v-answer');
  const fb = el.querySelector('.feedback');
  const nextBtn = el.querySelector('.v-next-btn');
  const board = visionBoard(el.querySelector('.v-board'), ctx, 'white', { coords: opts.coords, onMove: read ? undefined : onMove });
  const feedback = (html, cls) => {
    fb.className = 'feedback ' + cls;
    fb.innerHTML = html;
  };

  function ask() {
    q = notationQuestion();
    q.answered = false;
    el.querySelector('.v-qn').textContent = i + 1;
    nextBtn.hidden = true;
    feedback('', '');
    board.orientation = cgColor(q.turn);
    board.setShapes([]);
    const chess = new Chess(q.fen);
    const trait = `<span class="v-trait"><span class="dot ${q.turn}"></span>Trait aux ${colorName(q.turn)}</span>`;
    if (read) {
      board.setPosition(chess, { interactive: null });
      board.setShapes([arrow(uciOf(q.move), 'blue')]);
      prompt.innerHTML = `${trait}<span class="v-ask">Comment s’écrit le coup de la flèche ?</span>`;
      answerEl.innerHTML = `<div class="v-choices">${notationChoices(q.move, q.legal)
        .map((s) => `<button class="btn" data-s="${esc(s)}">${esc(s)}</button>`)
        .join('')}</div>`;
    } else {
      board.setPosition(chess, { interactive: q.turn });
      prompt.innerHTML = `${trait}<span class="v-ask">Joue <span class="v-target">${esc(sanToFr(q.move.san))}</span></span>`;
      answerEl.innerHTML = '';
    }
  }

  function done(ok, html) {
    q.answered = true;
    if (ok) score++;
    else missed.push({ fr: sanToFr(q.move.san), words: moveInWords(q.move) });
    el.querySelector('.v-score').textContent = score;
    feedback(html, ok ? 'ok' : 'ko');
    i++;
    if (i >= N) nextBtn.textContent = 'Voir le bilan →';
    if (ok) ctx.later(next, 1500);
    else {
      nextBtn.hidden = false;
      reveal(nextBtn);
    }
  }

  function next() {
    if (i >= N) {
      return onEnd({ mode: 'notation', key: recordKey('notation', opts), score, errors: N - score, total: N, seconds: (performance.now() - t0) / 1000, missed, orientation: null });
    }
    ask();
  }

  function onMove(uci) {
    if (!q || q.answered) return board.sync();
    const chess = new Chess(q.fen);
    let m = null;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return board.sync();
    }
    if (db().settings.sound) moveSound(!!m.captured);
    const right = sanToFr(q.move.san);
    if (uciOf(m) === uciOf(q.move)) {
      board.setPosition(chess, { interactive: null });
      done(true, md(`✓ **${right}** : ${moveInWords(q.move)}.`));
    } else {
      board.setPosition(new Chess(q.fen), { interactive: null });
      board.setShapes([arrow(uci, 'red'), arrow(uciOf(q.move), 'green')]);
      done(false, md(`✗ Tu as joué **${sanToFr(m.san)}** (${moveInWords(m)}).\n**${right}**, c’est : ${moveInWords(q.move)} (flèche verte).`));
    }
  }

  answerEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || !q || q.answered) return;
    const right = sanToFr(q.move.san);
    const ok = b.dataset.s === right;
    b.classList.add(ok ? 'right' : 'wrong');
    answerEl.querySelectorAll('[data-s]').forEach((x) => x.dataset.s === right && x.classList.add('right'));
    done(ok, md(ok ? `✓ **${right}** : ${moveInWords(q.move)}.` : `✗ La flèche montre **${right}** : ${moveInWords(q.move)}.`));
  });
  nextBtn.onclick = next;
  ask();
}

// ───────────── 5. Le cavalier voyageur ─────────────

function knightTrip(dist) {
  for (let t = 0; t < 500; t++) {
    const from = SQUARES[rnd(64)];
    const to = SQUARES[rnd(64)];
    const path = knightPath(from, to);
    if (path.length - 1 === dist) return { from, to, best: path };
  }
  return { from: 'b1', to: 'f7', best: knightPath('b1', 'f7') };
}

function runKnight(el, ctx, opts, onEnd) {
  const DIST = [2, 3, 3, 4, 4];
  const t0 = performance.now();
  let i = 0;
  let perfect = 0;
  let trip = null;
  let path = [];
  let finished = false;
  let retried = false;
  el.innerHTML = `
    <div class="v-head">
      <div class="v-stats"><span>Trajet <b class="v-qn">1</b>/${DIST.length}</span><span>Parfaits : <b class="v-score">0</b></span></div>
      <div class="v-kprompt"></div>
    </div>
    <div class="board-row"><div class="board-box v-board"></div></div>
    <div class="v-strip"></div>
    <div class="v-path small muted"></div>
    <div class="feedback" aria-live="polite"></div>
    <div class="actions">
      <button class="btn v-reset">↺ Recommencer</button>
      <button class="btn v-show">👁 Solution</button>
      <button class="btn primary v-next-btn" hidden>Suivant →</button>
    </div>`;
  const boardEl = el.querySelector('.v-board');
  let orient = opts.or === 'b' ? 'black' : 'white';
  const board = visionBoard(boardEl, ctx, orient, { coords: opts.coords });
  const fb = el.querySelector('.feedback');
  const feedback = (html, cls = '') => {
    fb.className = 'feedback ' + cls;
    fb.innerHTML = html;
  };
  const base = () => (trip ? { [trip.to]: 'v-goal' } : {});
  const cur = () => path.at(-1);

  function draw() {
    board.cg.set({ fen: boardFen({ [cur()]: 'N' }), lastMove: path.length > 1 ? [path.at(-2), cur()] : undefined });
    setMarks(board, base());
    board.setShapes(path.slice(1).map((s, k) => ({ orig: path[k], dest: s, brush: 'paleBlue' })));
    el.querySelector('.v-path').textContent = path.length > 1 ? `Ton trajet : ${path.join(' → ')} (${plural(path.length - 1, 'saut')})` : 'Touche la case où le cavalier saute en premier.';
  }

  function newTrip() {
    trip = knightTrip(DIST[i]);
    path = [trip.from];
    finished = false;
    retried = false;
    if (opts.or === 'r') {
      orient = Math.random() < 0.5 ? 'white' : 'black';
      board.orientation = orient;
    }
    sideStrip(el, orient);
    el.querySelector('.v-qn').textContent = i + 1;
    el.querySelector('.v-kprompt').innerHTML = md(`Emmène le cavalier de **${trip.from}** à **${trip.to}** (case jaune). Le plus court : **${plural(DIST[i], 'saut')}**.`);
    el.querySelector('.v-next-btn').hidden = true;
    el.querySelector('.v-reset').hidden = false;
    el.querySelector('.v-show').hidden = false;
    feedback('');
    draw();
  }

  function endTrip(ok, html) {
    finished = true;
    if (ok) perfect++;
    el.querySelector('.v-score').textContent = perfect;
    feedback(html, ok ? 'ok' : 'ko');
    el.querySelector('.v-reset').hidden = true;
    el.querySelector('.v-show').hidden = true;
    i++;
    if (i >= DIST.length) el.querySelector('.v-next-btn').textContent = 'Voir le bilan →';
    if (ok) ctx.later(nextTrip, 1500);
    else {
      el.querySelector('.v-next-btn').hidden = false;
      reveal(el.querySelector('.v-next-btn'));
    }
  }

  function showBest() {
    board.setShapes(trip.best.slice(1).map((s, k) => ({ orig: trip.best[k], dest: s, brush: 'green' })));
  }

  function nextTrip() {
    if (i >= DIST.length) {
      return onEnd({ mode: 'knight', key: 'knight', score: perfect, errors: DIST.length - perfect, total: DIST.length, seconds: (performance.now() - t0) / 1000, orientation: opts.or });
    }
    newTrip();
  }

  onTap(boardEl, ctx, () => orient, (sq) => {
    if (finished || sq === cur()) return;
    if (!knightMoves(cur()).includes(sq)) {
      flash(board, ctx, { [sq]: 'v-ko' }, 500, base);
      feedback(md(`Pas un saut de cavalier depuis **${cur()}** : il saute en « L », 2 cases tout droit puis 1 sur le côté.`), 'ko');
      return;
    }
    path.push(sq);
    if (db().settings.sound) moveSound(false);
    draw();
    feedback('');
    if (sq !== trip.to) return;
    const n = path.length - 1;
    const best = trip.best.length - 1;
    if (n === best && !retried) endTrip(true, md(`🎉 Parfait : ${plural(n, 'saut')}, le chemin le plus court !`));
    else if (n === best) endTrip(false, md(`✓ Bien : ${plural(n, 'saut')}, le plus court (après un nouvel essai).`));
    else {
      showBest();
      endTrip(false, md(`Arrivé en ${plural(n, 'saut')} ; on pouvait le faire en ${best} : **${trip.best.join(' → ')}** (flèches vertes).`));
    }
  });
  el.querySelector('.v-reset').onclick = () => {
    if (finished) return;
    retried = true;
    path = [trip.from];
    feedback('');
    draw();
  };
  el.querySelector('.v-show').onclick = () => {
    if (finished) return;
    showBest();
    endTrip(false, md(`Un chemin le plus court : **${trip.best.join(' → ')}**.`));
  };
  el.querySelector('.v-next-btn').onclick = nextTrip;
  newTrip();
}

// ───────────── 6. Visualisation ─────────────

/** Coup « plausible » au hasard : développement, centre, prises et roques plutôt que des coups absurdes. */
function plausibleMove(chess) {
  const early = chess.moveNumber() < 8;
  return weightedPick(chess.moves({ verbose: true }), (m) => {
    let w = 1;
    if ((m.piece === 'n' || m.piece === 'b') && (m.from[1] === '1' || m.from[1] === '8')) w += 5;
    if (m.piece === 'p' && 'cdef'.includes(m.from[0]) && early) w += 4;
    if (m.captured) w += 4;
    if (m.flags.includes('k') || m.flags.includes('q')) w += 6;
    if (m.piece === 'k') w *= 0.1;
    if (m.piece === 'q' && early) w *= 0.4;
    if (m.piece === 'r' && early) w *= 0.3;
    if (m.piece === 'p' && 'abgh'.includes(m.from[0])) w *= 0.4;
    if (m.piece === 'n' && 'ah'.includes(m.to[0])) w *= 0.2; // « cavalier au bord, cavalier qui s’endort »
    return w;
  });
}

/** Une suite de coups depuis le départ : début d’une ligne du répertoire, ou coups plausibles au hasard. */
export function blindSequence(plies) {
  const lines = OPENING_SANS.filter((l) => l.sans.length >= plies);
  if (lines.length && Math.random() < 0.5) return pick(lines).sans.slice(0, plies);
  const chess = new Chess();
  const out = [];
  for (let k = 0; k < plies && !chess.isGameOver(); k++) out.push(chess.move(plausibleMove(chess)).san);
  return out;
}

/** Suit chaque pièce depuis sa case de départ (identifiant = case de départ). */
export function trackPieces(sans) {
  const chess = new Chess();
  const at = new Map(); // case actuelle → identifiant
  const info = {};
  const touched = new Set(); // cases de départ et d’arrivée des coups
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (!p) continue;
    at.set(sq, sq);
    info[sq] = { id: sq, color: p.color, type: p.type, start: p.type, sq, moves: 0 };
  }
  for (const san of sans) {
    const m = chess.move(san);
    touched.add(m.from).add(m.to);
    const id = at.get(m.from);
    const capSq = m.flags.includes('e') ? m.to[0] + m.from[1] : m.to;
    if (m.captured && at.has(capSq)) {
      info[at.get(capSq)].sq = null;
      at.delete(capSq);
    }
    at.delete(m.from);
    at.set(m.to, id);
    info[id].sq = m.to;
    info[id].moves++;
    if (m.promotion) info[id].type = m.promotion;
    if (m.flags.includes('k') || m.flags.includes('q')) {
      const r = m.to[1];
      const [rf, rt] = m.flags.includes('k') ? ['h' + r, 'f' + r] : ['a' + r, 'd' + r];
      const rid = at.get(rf);
      at.delete(rf);
      at.set(rt, rid);
      info[rid].sq = rt;
      info[rid].moves++;
    }
  }
  return { chess, pieces: Object.values(info), touched: [...touched] };
}

/** 3 questions sur la position finale : « où est… ? » (toucher la case) ou « quelle pièce en… ? ». */
export function blindQuestions(sans) {
  const { chess, pieces, touched } = trackPieces(sans);
  // pièces qui ont bougé, sont encore là, n’ont pas été promues et ne sont pas revenues sur leur case
  const moved = pieces.filter((p) => p.sq && p.moves > 0 && p.type === p.start && p.sq !== p.id);
  const qs = [];
  const used = new Set();
  const where = (p) => {
    // « qui est sorti » ne suffit plus si une pièce du même genre a aussi bougé (même prise depuis, ou promue)
    const twin = pieces.some((x) => x.id !== p.id && x.color === p.color && x.moves > 0 && (x.start === p.type || x.type === p.type));
    const who = `${theName(p.type)} ${colorAdj(p.type, p.color)}`;
    let text;
    if (twin || p.type === 'p') text = `Où est maintenant ${who} ${FEM[p.type] ? 'partie' : 'parti'} de ${p.id} ?`;
    else if (p.type === 'k' || p.type === 'q') text = `Sur quelle case est maintenant ${who} ?`;
    else if (p.type === 'r') text = `Où est maintenant ${who} qui a bougé ?`;
    else text = `Où est maintenant ${who} qui est sorti ?`;
    return { kind: 'where', text, answer: p.sq };
  };
  const what = (sq) => {
    const p = chess.get(sq);
    return { kind: 'what', text: `Quelle pièce est en ${sq} ?`, answer: p ? p.color + p.type : 'empty', sq };
  };
  // d’abord les pièces (plus intéressantes que les pions)
  const order = shuffle([...moved]).sort((a, b) => (a.type === 'p') - (b.type === 'p'));
  for (const p of order) {
    if (qs.length >= 2) break;
    if (used.has(p.sq)) continue;
    used.add(p.sq);
    qs.push(Math.random() < 0.6 ? where(p) : what(p.sq));
  }
  // parfois une case vidée (réponse : aucune pièce)
  const vacated = pieces.filter((p) => p.moves > 0 && !chess.get(p.id) && !used.has(p.id)).map((p) => p.id);
  if (vacated.length && Math.random() < 0.35) qs.push(what(pick(vacated)));
  for (const p of order) {
    if (qs.length >= 3) break;
    if (used.has(p.sq)) continue;
    used.add(p.sq);
    qs.push(qs.some((x) => x.kind === 'what') ? where(p) : what(p.sq));
  }
  // compléter avec des cases qui ont changé (pièce arrivée, ou case vidée), d’abord les cases occupées
  const rest = shuffle(touched.filter((sq) => !used.has(sq))).sort((a, b) => !chess.get(a) - !chess.get(b));
  for (const sq of rest) {
    if (qs.length >= 3) break;
    used.add(sq);
    qs.push(what(sq));
  }
  if (!qs.length) qs.push(what(pick(SQUARES.filter((s) => chess.get(s)))));
  return qs;
}

const PIECE_CODES = ['w', 'b'].flatMap((c) => ['p', 'n', 'b', 'r', 'q', 'k'].map((t) => c + t));
const ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const pieceLabel = (code) => (code === 'empty' ? 'aucune pièce (la case est vide)' : `${theName(code[1])} ${colorAdj(code[1], code[0])}`);

function runBlind(el, ctx, opts, onEnd) {
  const level = vis().blindLevel || 1;
  const sans = blindSequence(Math.min(2 * level, 24));
  const qs = blindQuestions(sans);
  let qi = 0;
  let score = 0;
  let answered = false;
  el.innerHTML = `
    <div class="v-head">
      <div class="v-stats"><span>Niveau <b>${level}</b> · ${plural(sans.length, 'demi-coup')}</span><span>Question <b class="v-qn">1</b>/${qs.length}</span></div>
      <p class="small muted v-moves-label">Joue ces coups dans ta tête :</p>
      <div class="v-moves">${esc(movesFr(sans))}</div>
      <div class="v-bq"></div>
    </div>
    <div class="board-row"><div class="board-box v-board"></div></div>
    <div class="v-strip"></div>
    <div class="v-answer"></div>
    <div class="feedback" aria-live="polite"></div>
    <div class="actions v-blind-actions"><button class="btn primary v-next-btn" hidden>Question suivante →</button></div>`;
  const boardEl = el.querySelector('.v-board');
  const orient = opts.or === 'b' ? 'black' : opts.or === 'r' ? (Math.random() < 0.5 ? 'white' : 'black') : 'white';
  const board = visionBoard(boardEl, ctx, orient, { pieces: true, coords: opts.coords });
  sideStrip(el, orient);
  const fb = el.querySelector('.feedback');
  const answerEl = el.querySelector('.v-answer');
  const nextBtn = el.querySelector('.v-next-btn');
  const feedback = (html, cls = '') => {
    fb.className = 'feedback ' + cls;
    fb.innerHTML = html;
  };

  function ask() {
    const q = qs[qi];
    answered = false;
    el.querySelector('.v-qn').textContent = qi + 1;
    el.querySelector('.v-bq').innerHTML = `<p class="v-ask">${esc(q.text)}</p><p class="small muted">${q.kind === 'where' ? 'Touche la case sur l’échiquier.' : 'Choisis la pièce ci-dessous.'}</p>`;
    nextBtn.hidden = true;
    feedback('');
    setMarks(board, {});
    answerEl.innerHTML =
      q.kind === 'what'
        ? `<div class="v-pieces">${PIECE_CODES.map(
            (c) => `<button class="btn" data-p="${c}" aria-label="${esc(pieceLabel(c))}"><span class="v-pc cg-wrap"><piece class="${cgColor(c[0])} ${ROLE[c[1]]}"></piece></span></button>`,
          ).join('')}</div><button class="btn block v-empty" data-p="empty">Aucune : la case est vide</button>`
        : '';
  }

  function result(ok, text) {
    answered = true;
    if (ok) score++;
    feedback(md(text), ok ? 'ok' : 'ko');
    qi++;
    nextBtn.textContent = qi >= qs.length ? 'Voir le bilan →' : 'Question suivante →';
    nextBtn.hidden = false;
    reveal(nextBtn);
  }

  onTap(boardEl, ctx, () => orient, (sq) => {
    const q = qs[qi];
    if (answered || !q || q.kind !== 'where') return;
    const ok = sq === q.answer;
    setMarks(board, ok ? { [sq]: 'v-ok' } : { [sq]: 'v-ko', [q.answer]: 'v-good' });
    result(ok, ok ? `✓ Oui, en **${q.answer}**.` : `✗ Tu as touché ${sq}. La bonne case est **${q.answer}** (en vert).`);
  });
  answerEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    const q = qs[qi];
    if (!b || answered || !q || q.kind !== 'what') return;
    const ok = b.dataset.p === q.answer;
    b.classList.add(ok ? 'right' : 'wrong');
    answerEl.querySelector(`[data-p="${q.answer}"]`)?.classList.add('right');
    setMarks(board, { [q.sq]: ok ? 'v-ok' : 'v-good' });
    result(ok, ok ? `✓ Exact : en ${q.sq}, ${pieceLabel(q.answer)}.` : `✗ En ${q.sq}, il y a ${pieceLabel(q.answer)}.`);
  });
  nextBtn.onclick = () => (qi >= qs.length ? summary() : ask());

  function summary() {
    const perfect = score === qs.length;
    const down = score * 2 < qs.length && level > 1;
    const newLevel = perfect ? Math.min(12, level + 1) : down ? level - 1 : level;
    update((d) => {
      const v = ensure(d);
      v.blindLevel = newLevel;
      if (perfect && level > (v.best.blind || 0)) v.best.blind = level;
      v.sessions.push({ date: new Date().toISOString(), mode: 'blind', score, total: qs.length, orientation: opts.or, level });
      if (v.sessions.length > 300) v.sessions.splice(0, v.sessions.length - 300);
    });
    el.querySelector('.v-bq').innerHTML = '';
    answerEl.innerHTML = '';
    setMarks(board, {});
    feedback(
      md(
        perfect
          ? `🎉 **${score}/${qs.length}** : bravo ! Niveau ${newLevel} débloqué (${newLevel * 2} demi-coups).`
          : down
            ? `**${score}/${qs.length}** : on redescend au niveau ${newLevel} pour consolider. C’est en réussissant qu’on progresse.`
            : `**${score}/${qs.length}** : encore une suite à ce niveau. Réussis les ${qs.length} questions pour monter.`,
      ),
      perfect ? 'ok' : '',
    );
    el.querySelector('.v-blind-actions').innerHTML = `
      <button class="btn v-replay">▶ Voir les coups joués</button>
      <button class="btn primary v-again">Suite suivante →</button>`;
    el.querySelector('.v-blind-actions').insertAdjacentHTML('afterend', '<a class="btn ghost block" href="#/vision">← Tous les exercices de vision</a>');
    el.querySelector('.v-replay').onclick = replay;
    el.querySelector('.v-again').onclick = () => onEnd({ restart: true });
  }

  // rejoue la suite sur l’échiquier, coup par coup
  let replaying = false;
  async function replay() {
    if (replaying) return;
    replaying = true;
    const c = new Chess();
    board.setPosition(c, { interactive: null });
    for (const san of sans) {
      await new Promise((r) => ctx.later(r, 750));
      c.move(san);
      board.setPosition(c, { interactive: null });
    }
    replaying = false;
  }
  ask();
}

// ───────────── Résultat d’une manche ─────────────

const TIPS = [
  'Côté Noirs, la colonne a est à droite et la rangée 1 en haut : tout est inversé.',
  'Lettre = colonne (verticale), chiffre = rangée (horizontale). On dit toujours la lettre d’abord.',
  'e4 et d4 sont juste devant le roi et la dame blancs ; e5 et d5 devant ceux des Noirs.',
  'Repère d’abord la moitié (a-d ou e-h), puis le quart, puis la case : c’est plus rapide que compter.',
  'c3 et f3 (c6 et f6 pour les Noirs) : les cases naturelles des cavaliers.',
  'g1 et g8 : là où va le roi après le petit roque. c1 et c8 : après le grand roque.',
  'f7 (et f2) est le point faible du début de partie : seul le roi le défend.',
  'La grande diagonale a1-h8 est foncée, h1-a8 est claire.',
];

function showResult(el, ctx, res, { again, setup }) {
  const saved = saveRound(res);
  const timed = ['find', 'name', 'color'].includes(res.mode);
  const prevBest = saved.prev;
  let line = '';
  if (timed) {
    const acc = res.total ? Math.round((100 * res.score) / res.total) : 0;
    // espaces insécables : « 86 % » et « 30 s » ne se coupent pas en fin de ligne
    line = `${plural(res.score, 'bonne réponse', 'bonnes réponses')} en ${ROUND_S} s · ${plural(res.errors, 'erreur')}${res.total ? ` · précision ${acc} %` : ''}${res.score ? ` · environ ${fmt1(ROUND_S / res.score)} s par case` : ''}`;
  } else if (res.mode === 'notation') line = `${res.score}/${res.total} coups bien lus en ${Math.round(res.seconds)} s`;
  else if (res.mode === 'knight') line = `${res.score}/${res.total} trajets parfaits en ${Math.round(res.seconds)} s`;
  let rec;
  if (saved.isRecord && prevBest > 0) rec = `<p class="v-record">🏆 Nouveau record ! (ancien : ${prevBest})</p>`;
  else if (saved.isRecord) rec = '<p class="v-record">🏁 Premier score enregistré : à battre demain !</p>';
  else if (prevBest > 0) rec = `<p class="muted small">Ton record : ${prevBest}</p>`;
  else rec = '<p class="muted small">Pas encore de score : la prochaine manche sera la bonne.</p>';
  let level = '';
  if (res.mode === 'find' || res.mode === 'name') {
    level =
      res.score < 12
        ? 'Débutant : c’est normal au début. Avec 5 minutes par jour, ce score va doubler en deux semaines.'
        : res.score < 22
          ? 'En progrès : tu commences à voir les cases. Vise 22 et plus.'
          : 'Solide : ton repérage devient automatique. Essaie l’autre orientation ou « au hasard ».';
  }
  let review = '';
  const missedSq = Object.keys(res.misses || {});
  if (missedSq.length) {
    const view = res.orientation === 'b' ? 'black' : 'white';
    review = `<section class="card"><h2>À revoir</h2>
      <p class="small">Tu t’es trompé sur : <b>${esc(missedSq.join(', '))}</b>. Regarde où ${missedSq.length > 1 ? 'elles sont' : 'elle est'} (côté ${view === 'black' ? 'Noirs' : 'Blancs'}) :</p>
      ${miniBoard(Object.fromEntries(missedSq.map((s) => [s, 'ko'])), view)}
      <p class="small muted">Elles reviendront plus souvent dans les prochaines manches.</p></section>`;
  }
  if (res.colorMisses?.length) review = `<section class="card"><h2>À revoir</h2>${md(res.colorMisses.map((s) => '- ' + colorWhy(s)).join('\n'))}</section>`;
  if (res.missed?.length) review = `<section class="card"><h2>À revoir</h2>${md(res.missed.map((m) => `- **${m.fr}** : ${m.words}`).join('\n'))}</section>`;
  el.innerHTML = `
    <section class="card v-result">
      <p class="muted small">${esc(MODES[res.mode].title)}${res.orientation ? ` · ${res.orientation === 'r' ? 'orientation au hasard' : `côté ${sideLabel(res.orientation)}`}` : ''}</p>
      <div class="v-res-score">${res.score}</div>
      <p>${esc(line)}</p>
      ${rec}
      ${level ? `<p class="small">${esc(level)}</p>` : ''}
      <div class="row"><button class="btn primary v-grow" id="v-again">↻ Rejouer</button><button class="btn v-grow" id="v-setup">⚙︎ Réglages</button></div>
      <a class="btn ghost block" href="#/vision">← Tous les exercices de vision</a>
    </section>
    ${review}
    <section class="card coach"><div class="coach-title">💡 Repère</div><p>${esc(pick(TIPS))}</p></section>`;
  el.querySelector('#v-again').onclick = again;
  el.querySelector('#v-setup').onclick = setup;
}

// ───────────── Défi du jour ─────────────

function dailyScreen(el, ctx) {
  const odd = new Date().getDate() % 2 === 1;
  const steps = [
    { mode: 'find', opts: { or: 'w', pieces: false }, label: 'Trouve la case, côté Blancs' },
    { mode: 'find', opts: { or: 'b', pieces: false }, label: 'Trouve la case, côté Noirs' },
    { mode: 'name', opts: { or: odd ? 'b' : 'w', answer: 'keys', pieces: false }, label: `Nomme la case, côté ${odd ? 'Noirs' : 'Blancs'}` },
  ];
  const results = [];
  let phase = null;
  const fresh = () => {
    phase?.dispose();
    phase = ctx.child();
    return phase;
  };
  const v = vis();
  const last = v.dailyLog.at(-1);

  function intro() {
    fresh();
    el.innerHTML = `<section class="card">
      <h2>📅 Défi du jour</h2>
      <p>3 manches de 30 secondes, à enchaîner :</p>
      <ol class="v-steps">${steps.map((s) => `<li>${esc(s.label)}</li>`).join('')}</ol>
      ${last ? `<p class="small muted">Dernier défi (${esc(new Date(last.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}) : ${last.total} bonnes réponses au total.</p>` : ''}
      ${v.daily === todayKey() ? '<p class="good-txt small">✓ Déjà fait aujourd’hui : tu peux le refaire pour battre ton score.</p>' : ''}
      <button class="btn primary block" id="v-go">▶ C’est parti</button>
    </section>`;
    el.querySelector('#v-go').onclick = () => run(0);
  }

  function run(k) {
    window.scrollTo(0, 0);
    const s = steps[k];
    RUNNERS[s.mode](el, fresh(), { ...prefs(), ...s.opts }, (res) => {
      const saved = saveRound(res);
      results.push({ ...res, ...saved, label: s.label });
      between(k);
    });
    // rappel de la manche en cours au-dessus de l’exercice
    el.insertAdjacentHTML('afterbegin', `<p class="v-daily-step small muted">Manche ${k + 1}/3 · ${esc(s.label)}</p>`);
  }

  function between(k) {
    fresh();
    const r = results[k];
    if (k < steps.length - 1) {
      el.innerHTML = `<section class="card v-result">
        <p class="muted small">Manche ${k + 1}/3 · ${esc(r.label)}</p>
        <div class="v-res-score">${r.score}</div>
        <p>${plural(r.score, 'bonne réponse', 'bonnes réponses')} · ${plural(r.errors, 'erreur')}</p>
        ${r.isRecord && r.prev > 0 ? `<p class="v-record">🏆 Nouveau record ! (ancien : ${r.prev})</p>` : ''}
        <button class="btn primary block" id="v-next">Manche ${k + 2} : ${esc(steps[k + 1].label)} →</button>
      </section>`;
      el.querySelector('#v-next').onclick = () => run(k + 1);
      return;
    }
    const total = results.reduce((a, x) => a + x.score, 0);
    update((d) => {
      const vv = ensure(d);
      vv.daily = todayKey();
      vv.dailyLog.push({ date: new Date().toISOString(), total, scores: results.map((x) => x.score) });
      if (vv.dailyLog.length > 120) vv.dailyLog.splice(0, vv.dailyLog.length - 120);
    });
    const diff = last ? total - last.total : null;
    let cmp = '<p class="small">Premier défi enregistré : reviens demain pour comparer.</p>';
    if (diff > 0) cmp = `<p class="good-txt">+${diff} par rapport au dernier défi : ça progresse !</p>`;
    else if (diff === 0) cmp = '<p class="muted">Autant que la dernière fois : la régularité finit toujours par payer.</p>';
    else if (diff < 0) cmp = `<p class="muted">${diff} par rapport au dernier défi : un jour sans, ça arrive. L’important, c’est la régularité.</p>`;
    el.innerHTML = `<section class="card v-result">
      <h2>🎉 Défi du jour terminé</h2>
      <div class="v-res-score">${total}</div>
      <p>bonnes réponses au total</p>
      ${cmp}
      <ul class="v-daily-res">${results.map((x) => `<li><span>${esc(x.label)}</span><b>${x.score}${x.isRecord && x.prev > 0 ? ' 🏆' : ''}</b></li>`).join('')}</ul>
      <a class="btn primary block" href="#/vision">Terminer</a>
    </section>
    <section class="card coach"><div class="coach-title">💡 Pour aller plus loin</div><p>${esc(pick(TIPS))}</p>
      <p class="small">Encore 3 minutes ? Essaie <a class="v-link" href="#/vision/notation">Lis la notation</a> ou <a class="v-link" href="#/vision/blind">Visualisation</a>.</p></section>`;
  }
  intro();
}

const RUNNERS = { find: runFind, name: runName, color: runColor, notation: runNotation, knight: runKnight, blind: runBlind };

// ───────────── Point d’entrée ─────────────

export function render(root, mode) {
  const ctx = makeCtx();
  root.innerHTML = '<div class="vision"></div>';
  const el = root.firstChild;
  if (mode === 'daily' || Object.hasOwn(MODES, mode || '')) {
    setTitle(mode === 'daily' ? 'Défi du jour' : MODES[mode].title, '#/vision');
    if (mode === 'daily') dailyScreen(el, ctx);
    else modeScreen(el, mode, ctx);
  } else {
    setTitle('Vision de l’échiquier', '#/train');
    menu(el);
  }
  return () => ctx.dispose();
}

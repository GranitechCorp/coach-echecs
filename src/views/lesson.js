// Une leçon : étapes de texte, exercices, quiz, repérage de cases et positions à jouer contre l'ordinateur.
import { Chess } from 'chess.js';
import { db, update } from '../storage.js';
import { setTitle, esc, md, moveSound, sleep } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { lessonById, LESSONS } from '../data/lessons.js';
import { stepFen, cgColor, playUci, gameOverText, cpWhite, uciToSan, fig, material } from '../chessutil.js';
import { getBotEngine, getAnalysisEngine } from '../engine.js';
import { runPuzzle } from './puzzle-runner.js';

export const tab = 'learn';

const toShapes = (shapes = []) =>
  shapes.map(([a, brush]) => (a.length === 4 ? arrow(a, brush) : { orig: a, brush }));

/**
 * Typographie française : espace insécable avant « : ; ! ? » et à l'intérieur des guillemets,
 * et entre un nombre et le mot qui suit (« 2 minutes », « Td8 mat ») : jamais de « ou de ! seul en début de ligne.
 * (pas entre deux coups : « e4 e5 » ou « c6 bxc6 » doivent pouvoir passer à la ligne) ;
 * un coup noir « …Dxg5 » ne se coupe pas après les points de suspension (« word joiner » invisible).
 */
const nb = (s) =>
  typeof s === 'string'
    ? s
        .replace(/« /g, '«\u00a0')
        .replace(/ ([»:;!?])/g, '\u00a0$1')
        .replace(/(\d) (?=\p{Ll}+(?![\p{L}\d]))/gu, '$1\u00a0')
        .replace(/…(?=[A-Za-h♔-♟])/g, '…\u2060')
    : s;
/** Mêmes textes, espaces insécables en plus (le reste de l'étape est inchangé). */
const nbStep = (st) => {
  const out = { ...st };
  for (const f of ['text', 'question', 'explain', 'hint', 'success']) if (out[f]) out[f] = nb(out[f]);
  if (out.choices) out.choices = out.choices.map(nb);
  if (out.link) out.link = { ...out.link, label: nb(out.link.label) };
  return out;
};
/** Le son des coups suit le réglage « Son » (comme dans les exercices). */
const sound = (capture) => {
  if (db().settings?.sound !== false) moveSound(capture);
};

/** Bouton facultatif sous une étape : link: { href: '#/vision', label: '…' } */
const linkHtml = (link) => (link ? `<a class="btn block" href="${esc(link.href)}">${esc(link.label)}</a>` : '');

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
    const st = nbStep(lesson.steps[k]);
    const last = k === lesson.steps.length - 1;
    root.innerHTML = `
      <div class="steps">${lesson.steps.map((_, i) => `<span class="${i < k ? 'done' : i === k ? 'cur' : ''}"></span>`).join('')}</div>
      <div id="step"></div>
      ${linkHtml(st.link)}
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
        const b = createBoard(el.querySelector('#b'), { orientation: st.orientation || cgColor(c.turn()) });
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
        fb.innerHTML = nb(ok ? '✓ Exact ! ' : '✗ Pas tout à fait. ') + md(st.explain);
      });
    } else if (st.type === 'puzzle') {
      const p = runPuzzle(el, { ...st, fen, prompt: st.text });
      cleanupStep = () => p.destroy();
    } else if (st.type === 'play') {
      cleanupStep = playStep(el, st, fen);
    } else if (st.type === 'square') {
      cleanupStep = squareStep(el, st, fen);
    }
  }

  function finish() {
    update((s) => {
      s.lessons[lesson.id] = { done: true, date: new Date().toISOString() };
    });
    const idx = LESSONS.indexOf(lesson);
    const next = LESSONS[idx + 1];
    // lien d'entraînement propre à la leçon (sinon : exercices de tactique)
    const practice = lesson.practice || { href: '#/puzzles', label: 'Exercices de tactique' };
    cleanupStep?.();
    cleanupStep = null;
    root.innerHTML = `<section class="card center">
      <div class="big">🎓</div><h2>Leçon terminée !</h2>
      <p>${esc(nb(lesson.practiceText || 'Pour ancrer ce que tu viens d’apprendre, fais quelques exercices sur le même thème.'))}</p>
      <div class="row wrap center">
        <a class="btn primary" href="${esc(practice.href)}">${esc(nb(practice.label))}</a>
        ${next ? `<a class="btn" href="#/lesson/${next.id}">${esc(nb(`Leçon suivante : ${next.title}`))}</a>` : ''}
        <a class="btn ghost" href="#/learn">Retour aux cours</a>
      </div></section>`;
  }

  renderStep();
  return () => cleanupStep?.();
}

// ───────────── Repérage : toucher les cases demandées ─────────────

const FILES = 'abcdefgh';
/** a1 est foncée : (colonne + rangée) paire → case foncée. */
const isDark = (sq) => (FILES.indexOf(sq[0]) + +sq[1] - 1) % 2 === 0;
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;

/**
 * Étape « square » : { text, targets: ['c4', …], orientation: 'white'|'black', coordinates (false par défaut), fen|moves facultatif }.
 * Le joueur touche les cases une par une ; retour immédiat ; une case ratée revient une fois à la fin.
 */
function squareStep(el, st, fen) {
  const orientation = st.orientation === 'black' ? 'black' : 'white';
  const total = st.targets.length;
  el.innerHTML = `
    <section class="card lesson-text">${md(st.text)}</section>
    <section class="card sq-card" style="padding:8px 12px">
      <div class="row between" style="align-items:center;gap:8px">
        <span class="muted small">${orientation === 'white' ? 'Les Blancs sont en bas' : 'Les Noirs sont en bas (échiquier retourné)'}</span>
        <button class="btn small ghost" id="again" style="white-space:nowrap;flex:none">↻ Recommencer</button>
      </div>
      <div class="sq-ask center" aria-live="polite"></div>
    </section>
    <div class="board-row"><div class="board-box" id="b"></div></div>
    <div class="feedback" aria-live="polite"></div>`;
  const ask = el.querySelector('.sq-ask');
  const fb = el.querySelector('.feedback');
  // pas d'aide « nom de la case » ici : ce serait donner la réponse
  const board = createBoard(el.querySelector('#b'), { orientation, coordinates: st.coordinates === true, squareNames: false });
  board.cg.set({
    fen: fen ? fen.split(' ')[0] : '8/8/8/8/8/8/8/8',
    blockTouchScroll: true, // un toucher sur une case vide est traité tout de suite
    movable: { color: undefined, dests: new Map() },
    draggable: { enabled: false },
    drawable: { enabled: false },
    highlight: { lastMove: false, check: false },
    events: { select: onSelect },
  });

  let queue, retried, missed, errors, done, locked, startedAt;
  let timer = null;

  function start() {
    clearTimeout(timer);
    queue = [...st.targets];
    retried = new Set();
    missed = [];
    errors = 0;
    done = 0;
    locked = false;
    startedAt = 0;
    mark({});
    say('');
    showTarget();
  }

  /** marks : { case: true (vert) | false (rouge) } — cercles, et fond coloré si le thème le prévoit */
  function mark(marks) {
    const list = Object.entries(marks);
    board.setShapes(list.map(([sq, ok]) => ({ orig: sq, brush: ok ? 'green' : 'red' })));
    board.cg.set({ highlight: { custom: new Map(list.map(([sq, ok]) => [sq, ok ? 'v-ok' : 'v-ko'])) } });
  }

  function say(html, cls = '') {
    fb.className = 'feedback ' + cls;
    fb.innerHTML = nb(html);
  }

  function showTarget() {
    const n = total + retried.size;
    ask.innerHTML = `<span class="muted">Touche la case</span> <b class="big" style="display:inline-block;min-width:2.2em">${esc(queue[0])}</b>
      <span class="muted small">(${Math.min(done + 1, n)}/${n})</span>`;
  }

  function onSelect(key) {
    if (locked || !queue.length) return;
    if (!startedAt) startedAt = Date.now();
    const target = queue.shift();
    done++;
    if (key === target) {
      mark({ [key]: true });
      say(`✓ ${esc(key)}\u00a0: case ${isDark(key) ? 'foncée' : 'claire'}`, 'ok');
      return next(450);
    }
    errors++;
    if (!missed.includes(target)) missed.push(target);
    // la case ratée revient une fois à la fin
    if (!retried.has(target)) {
      retried.add(target);
      queue.push(target);
    }
    mark({ [key]: false, [target]: true });
    say(`✗ Ça, c’est ${esc(key)}. La case ${esc(target)} est entourée en vert.`, 'ko');
    next(1500);
  }

  function next(ms) {
    locked = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      locked = false;
      mark({});
      if (queue.length) return showTarget();
      const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      ask.innerHTML = errors ? `<b>Terminé\u00a0: ${plural(errors, 'erreur')}</b>` : '<b class="good-txt">🎉 Parfait\u00a0: aucune erreur\u00a0!</b>';
      say(
        errors
          ? `À revoir\u00a0: ${missed.map(esc).join(', ')}. Recommence pour viser zéro faute (${secs}\u00a0s).`
          : `${plural(total, 'case')} trouvée${total > 1 ? 's' : ''} en ${secs}\u00a0s. Refais-le demain pour aller encore plus vite.`,
        errors ? 'ko' : 'ok',
      );
    }, ms);
  }

  el.querySelector('#again').onclick = start;
  start();
  return () => {
    clearTimeout(timer);
    board.destroy();
  };
}

// ───────────── Jouer une position contre Stockfish ─────────────

/**
 * Objectifs (`goal`) : 'mate' (faire mat), 'promote' (aller à dame), 'draw' (tenir la nulle pendant `maxMoves` coups).
 * `failBelow` (centipions, de ton point de vue) : si l'évaluation après ton coup passe en dessous, c'est raté
 * (par défaut −200 pour 'draw', rien pour les autres objectifs).
 */
function playStep(el, st, fen) {
  const chess = new Chess(fen);
  const me = chess.turn();
  const sign = me === 'w' ? 1 : -1;
  const goal = st.goal || 'mate';
  const toHold = st.maxMoves || 10;
  const failBelow = st.failBelow ?? (goal === 'draw' ? -200 : null);
  const goalText =
    goal === 'draw'
      ? `tenir la nulle pendant ${toHold} coups (un pat, une répétition ou la prise du dernier pion comptent aussi)`
      : `${goal === 'mate' ? 'faire mat' : 'aller à dame'}${st.maxMoves ? ` en ${st.maxMoves} coups maximum` : ''}`;
  el.innerHTML = `
    <section class="card lesson-text">${md(st.text)}<p class="muted small">${esc(nb(`Objectif : ${goalText}.`))}</p></section>
    <div class="board-row"><div class="board-box" id="b"></div></div>
    <div class="feedback" aria-live="polite"></div>
    <div class="actions"><button class="btn" id="undo" hidden>↶ Reprendre mon coup</button><button class="btn" id="reset">↻ Recommencer</button></div>`;
  const fb = el.querySelector('.feedback');
  const undoBtn = el.querySelector('#undo');
  const engine = getBotEngine();
  let alive = true;
  let count = 0;
  let over = false;
  let retakes = 0; // coups repris (après une erreur)
  let gen = 0; // change à chaque « Recommencer » / « Reprendre » : une réponse du moteur arrivée trop tard est ignorée
  const board = createBoard(el.querySelector('#b'), { orientation: cgColor(me), onMove });
  board.setPosition(chess, { interactive: me });

  function say(html, cls = '') {
    fb.className = 'feedback ' + cls;
    fb.innerHTML = nb(html);
  }

  function end(html, ok, canUndo = false) {
    over = true;
    board.setPosition(chess, { interactive: null });
    say(html, ok ? 'ok' : 'ko');
    undoBtn.hidden = !canUndo;
  }

  const progress = () => (goal === 'draw' ? `<span class="muted">Coups tenus\u00a0: ${count} / ${toHold}</span>` : '');
  /** Nulle : l'adversaire n'a plus de pion et pas plus de matériel que toi (tour contre tour…) : il ne peut plus gagner. */
  const cannotWin = () => {
    const them = me === 'w' ? 'b' : 'w';
    const mat = material(chess);
    return !chess.findPiece({ type: 'p', color: them }).length && (mat[them] <= mat[me] || mat[them] <= 3);
  };
  const overText = () => esc(gameOverText(chess) || 'Partie terminée');
  const retakeText = () =>
    retakes ? ` (avec ${retakes} coup${retakes > 1 ? 's' : ''} repris : recommence pour réussir sans aide)` : '';

  /**
   * Raté : le coup est annulé. Flèche rouge sur ton coup, orange sur la réponse qui le punissait,
   * verte sur celui qu'il fallait jouer.
   */
  async function failed(played, why, g, refutation) {
    retakes++;
    const after = chess.fen();
    const punish = refutation ? `${me === 'w' ? '…' : ''}${fig(uciToSan(after, refutation))}` : '';
    const whyFull = punish ? `${why} Sa réponse : <b>${esc(punish)}</b> (flèche orange).` : why;
    const shapes = [arrow(played, 'red'), ...(refutation ? [arrow(refutation, 'yellow')] : [])];
    chess.undo();
    count--;
    board.setPosition(chess, { interactive: null });
    board.setShapes(shapes);
    say(`${whyFull} <span class="muted">Je cherche un meilleur coup…</span>`, 'ko');
    const before = chess.fen();
    const r = await getAnalysisEngine().search(before, { depth: 12 });
    if (!alive || g !== gen) return;
    const best = r.bestmove && r.bestmove !== played ? r.bestmove : null;
    board.setPosition(chess, { interactive: me });
    // la flèche verte d'abord : ton coup (rouge) et sa réponse (orange) restent visibles par-dessus
    board.setShapes(best ? [arrow(best, 'green'), ...shapes] : shapes);
    say(`${whyFull} Ton coup est annulé${best ? ` : essaie plutôt <b>${esc(fig(uciToSan(before, best)))}</b> (flèche verte)` : ''}. À toi !`, 'ko');
  }

  async function onMove(uci) {
    if (over) return board.sync();
    const m = playUci(chess, uci);
    if (!m) return board.sync();
    const g = gen;
    sound(!!m.captured);
    count++;
    board.setShapes([]);
    board.setPosition(chess, { interactive: null });
    const played = m.from + m.to + (m.promotion || '');
    if (chess.isCheckmate()) {
      if (goal === 'draw') return end(`🎉 Mat ! Tu as fait encore mieux que la nulle${retakeText()}.`, true);
      return end(`🎉 Mat en ${count} coups${retakeText()} !${st.maxMoves && count > st.maxMoves ? ' Essaie maintenant de faire plus court.' : retakes ? '' : ' Parfait.'}`, true);
    }
    if (chess.isStalemate()) {
      if (goal === 'draw') return end(`🎉 Pat : c’est nulle. Objectif atteint${retakeText()} !`, true);
      return end('😬 Pat ! Le roi adverse n’a plus de coup mais n’est pas en échec : c’est nulle. Reprends ton coup et laisse-lui toujours une case.', false, true);
    }
    if (goal === 'promote' && m.promotion) return end(`🎉 Promotion réussie en ${count} coups${retakeText()} !`, true);
    if (chess.isDraw()) {
      if (goal === 'draw') return end(`🎉 ${overText()} : objectif atteint${retakeText()} !`, true);
      return end(`${overText()}. Reprends ton coup ou recommence !`, false, true);
    }
    // (efface aussi le message d'un coup repris : il ne doit pas rester affiché pendant que l'ordinateur réfléchit)
    if (goal === 'draw') say(`${progress()} <span class="muted">· l’ordinateur réfléchit…</span>`);
    else if (st.maxMoves && count === st.maxMoves + 1) say(`Tu as dépassé ${st.maxMoves} coups : continue, puis recommence pour faire mieux.`);
    else say('');
    const r = await engine.search(chess.fen(), { depth: 14 });
    await sleep(250);
    if (!alive || g !== gen) return;
    // évaluation de la position après ton coup, de ton point de vue
    const mine = r.lines[0] ? cpWhite(r.lines[0]) * sign : 0;
    if (failBelow !== null && mine < failBelow) {
      const why =
        goal === 'draw'
          ? '✗ Après ce coup, l’ordinateur aurait une position gagnante : la nulle t’échappait.'
          : '✗ Après ce coup, ton avantage fondait : l’adversaire revenait dans la partie.';
      return failed(played, why, g, r.bestmove);
    }
    if (goal === 'draw' && m.captured === 'p' && cannotWin())
      return end(`🎉 Tu as pris son dernier pion : sans pion, il ne peut plus gagner. Nulle assurée${retakeText()} !`, true);
    if (goal === 'draw' && count >= toHold)
      return end(retakes ? `🎉 Nulle tenue pendant ${count} coups${retakeText()}.` : `🎉 Nulle tenue : ${count} coups sans craquer face à Stockfish !`, true);
    if (!r.bestmove) return end(overText(), goal === 'draw');
    const reply = playUci(chess, r.bestmove);
    if (reply) sound(!!reply.captured);
    board.setPosition(chess, { interactive: me });
    if (chess.isCheckmate()) return end(`${overText()}. Reprends ton coup ou recommence !`, false, true);
    // objectif « dame » : un pion pris (avant « nulle : matériel insuffisant », moins parlant quand c'était le dernier)
    const fallen = goal === 'promote' && reply?.captured === 'p' ? reply.to[0] + (reply.flags.includes('e') ? reply.from[1] : reply.to[1]) : null;
    const left = fallen ? chess.findPiece({ type: 'p', color: me }).length : 0;
    if (fallen && !left) return end('Ton dernier pion est tombé : tu ne peux plus aller à dame. Reprends ton coup ou recommence !', false, true);
    if (chess.isGameOver()) {
      if (goal === 'draw') return end(`🎉 ${overText()} : objectif atteint${retakeText()} !`, true);
      return end(`${overText()}. Reprends ton coup ou recommence !`, false, true);
    }
    if (fallen) say(`Ton pion ${fallen} est tombé : il t’en reste ${left}. S’il a servi de leurre, c’est le plan : continue !`);
    if (goal === 'draw') say(progress());
  }

  /** Annule ton dernier coup (et la réponse de l'ordinateur s'il a déjà joué). */
  undoBtn.onclick = () => {
    gen++;
    if (!chess.history().length) return;
    retakes++;
    if (chess.turn() === me && chess.history().length >= 2) chess.undo();
    chess.undo();
    count = Math.max(0, count - 1);
    over = false;
    undoBtn.hidden = true;
    board.setShapes([]);
    say(progress());
    board.setPosition(chess, { interactive: me });
  };

  el.querySelector('#reset').onclick = () => {
    gen++;
    chess.load(fen);
    count = 0;
    retakes = 0;
    over = false;
    undoBtn.hidden = true;
    board.setShapes([]);
    say(progress());
    board.setPosition(chess, { interactive: me });
  };
  say(progress());
  return () => {
    alive = false;
    board.destroy();
  };
}

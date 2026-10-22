// Devine le coup : on rejoue une partie modèle en devinant chaque coup d'un camp
// (le « Solitaire chess » de Bruce Pandolfini, « Logical Chess Move by Move » d'Irving Chernev).
// Coup exact = 5 points ; sinon Stockfish compare ton coup à celui de la partie : aussi bon = 3, jouable = 1.
import { Chess } from 'chess.js';
import { db, update } from '../storage.js';
import { setTitle, esc, md, moveSound, sleep } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { getAnalysisEngine } from '../engine.js';
import { playUci, uciOf, cgColor, cpWhite, fig, colorName, material, theName, VALUE } from '../chessutil.js';
import { describeMove } from '../explain.js';
import { MODEL_GAMES, modelGameById } from '../data/model-games.js';

export const tab = 'puzzles';

const POINTS = { exact: 5, good: 3, ok: 1, miss: 0, skip: 0 };
const HINT_COST = 2;
const DEPTH = 12;
const GOOD_LOSS = 30; // 0,3 pion
const OK_LOSS = 100; // 1 pion
const ENGINE_TIMEOUT = 25000;

const EXPLAIN = `Rejoue une partie modèle **en devinant chaque coup** du camp choisi : c’est la méthode des livres *Logical Chess Move by Move* (Irving Chernev) et *Solitaire Chess* (Bruce Pandolfini).
- **5 points** : exactement le coup joué.
- **3 points** : un coup aussi bon d’après Stockfish (0,3 pion d’écart au plus).
- **1 point** : un coup jouable (1 pion d’écart au plus).
- L’**indice** montre la pièce à jouer, mais coûte 2 points.
Après chaque coup, lis le commentaire : c’est là qu’on apprend les plans.`;

const TIP = 'Avant chaque coup, pose-toi trois questions : que menace l’adversaire ? Quelle est ma pièce la moins active ? Quel est mon plan ?';

const GROUPS = [
  ['repertoire', 'Tes ouvertures', 'Des parties jouées par Stockfish à partir des lignes de ton répertoire.'],
  ['classiques', 'Parties célèbres', 'Les chefs-d’œuvre que tous les joueurs ont rejoués un jour.'],
];

// Évaluations déjà calculées (FEN → centipions du point de vue des Blancs), gardées pendant la session ;
// les recherches en cours sont à part, liées à l'écran qui les a lancées (un écran quitté les annule).
const evalCache = new Map();
const evalPending = new Map(); // FEN → { job, signal }

/** Espaces insécables avant « ? ! : ; » et dans les guillemets : la ponctuation ne passe jamais seule à la ligne. */
const nb = (s) => String(s).replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');

// ─── Données ───

function record(id) {
  return db().guess?.[id] || null;
}

/** Partie en cours (reprise possible) pour ce jeu, sinon null. */
function progressOf(g) {
  const p = record(g.id)?.progress;
  const ok = p && p.sig === sigOf(g) && ['w', 'b'].includes(p.side) && Number.isInteger(p.ply) && p.ply > 0 && p.ply < sansOf(g).length && Array.isArray(p.results);
  return ok ? p : null;
}

function saveRecord(id, fn) {
  update((d) => {
    d.guess ||= {};
    const r = (d.guess[id] ||= { best: null, attempts: 0 });
    fn(r);
  });
}

/** Coups de la partie, avec la position avant chaque coup. */
export function pliesOf(game) {
  const c = new Chess();
  return game.moves
    .split(/\s+/)
    .filter(Boolean)
    .map((san, i) => {
      const fen = c.fen();
      const m = c.move(san);
      return { i, fen, san: m.san, uci: uciOf(m), color: m.color, from: m.from, to: m.to, captured: m.captured || null };
    });
}

/** Position avant le demi-coup i (i = nombre de coups : position finale). */
function positionOf(plies, i) {
  if (i < plies.length) return new Chess(plies[i].fen);
  const c = new Chess(plies.at(-1).fen);
  playUci(c, plies.at(-1).uci);
  return c;
}

/** Matériel gagné par le camp qui joue le coup i, jusqu'à quatre demi-coups plus tard (depuis le début de l'échange). */
function materialSwing(plies, i) {
  const me = plies[i].color;
  const bal = (c) => {
    const m = material(c);
    return me === 'w' ? m.w - m.b : m.b - m.w;
  };
  // l'échange a pu commencer jusqu'à trois demi-coups plus tôt (prise adverse, échec intermédiaire, reprise)
  let from = i;
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (plies[j].captured && plies[j].color !== me) from = j;
  return bal(positionOf(plies, Math.min(i + 4, plies.length))) - bal(positionOf(plies, from));
}

/**
 * Explication du coup i : le commentaire de la partie, sinon un ou deux faits observés sur l'échiquier
 * (describeMove), filtrés avec la suite réelle de la partie pour ne rien affirmer de faux.
 */
export function explainPly(game, plies, i, max = 2) {
  const c = game.comments?.[i];
  if (c) return c;
  const p = plies[i];
  const d = describeMove(p.fen, p.uci);
  let facts = d.facts;
  const next = plies[i + 1];
  const after = positionOf(plies, i + 1);
  // reprise : l'adversaire vient de prendre sur cette case (éventuellement avant un échec intermédiaire)
  const recapture = p.captured && [i - 1, i - 3].some((j) => plies[j]?.captured && plies[j].to === p.to && plies[j].color !== p.color);
  // la partie se termine par un mat contre ce camp dans les quatre demi-coups : la prise était un cadeau empoisonné
  const end = positionOf(plies, plies.length);
  const poisoned = p.captured && plies.length - 1 - i <= 4 && end.isCheckmate() && end.turn() === p.color;
  if (recapture) facts = [`Reprend en ${p.to}.`, ...facts.filter((f) => !f.startsWith('Prend'))];
  else if (poisoned) facts = [`Prend ${theName(p.captured)} en ${p.to}, mais c’est un cadeau empoisonné : regarde la suite.`, ...facts.filter((f) => !f.startsWith('Prend'))];
  // « matériel gratuit », « échange favorable » : on vérifie avec la suite réelle de la partie (fin d'un échange ?)
  else if (d.tags.has('gain') && materialSwing(plies, i) < 2) facts = facts.map((f) => (/^Prend .*:/.test(f) ? `Prend ${theName(p.captured)} en ${p.to}.` : f));
  // fourchette : il faut au moins deux pièces visées (le roi compte, pas les pions), sinon c'est une attaque double
  facts = facts.map((f) => {
    if (!f.startsWith('Fourchette')) return f;
    const targets = f.split('en même temps')[1]?.match(/\b(roi|dame|tour|fou|cavalier)\b/g) || [];
    return targets.length >= 2 ? f : f.replace(/^Fourchette :/, 'Attaque double :');
  });
  // enfilade : la pièce de derrière ne « tombe » que si elle vaut plus que l'attaquant ou n'est pas défendue
  const moved = VALUE[after.get(p.to)?.type] || 0;
  facts = facts.filter((f) => {
    if (!f.startsWith('Enfilade')) return true;
    const sq = [...f.matchAll(/ en ([a-h][1-8])/g)].at(-1)?.[1];
    const rear = sq && after.get(sq);
    return !!rear && (VALUE[rear.type] > moved || !after.attackers(sq, rear.color).length);
  });
  // la pièce qui fait la fourchette (ou l'enfilade) est prise tout de suite : la menace ne compte plus
  if (next?.captured && next.to === p.to) facts = facts.filter((f) => !/^(Fourchette|Attaque double|Enfilade)/.test(f));
  // « en prise » / « sans protection » : le test de describeMove est statique et se trompe souvent sur un coup
  // de partie modèle. On ne le garde que si la pièce est vraiment prise au coup suivant.
  const warn = (f) => /^(Attention|Laisse)/.test(f);
  const taken = (f) => {
    const sq = f.match(/ en ([a-h][1-8])/)?.[1];
    return !!(sq && next?.captured && next.to === sq);
  };
  const warnings = facts.filter((f) => warn(f) && taken(f));
  // un coup du camp modèle qui laisse une pièce se faire prendre : c'est un échange ou un sacrifice voulu
  const sacrifice = (f) => {
    const a = f.match(/^Attention : ((la|le) .+) est en prise\.$/);
    if (a) return `Sacrifice ou échange voulu : ${a[1]} peut être ${a[2] === 'la' ? 'prise' : 'pris'}, regarde la suite.`;
    const b = f.match(/^Laisse (.+) sans protection suffisante\.$/);
    return b ? `Laisse ${b[1]} sans protection : c’est voulu, regarde la suite.` : f;
  };
  facts = [...facts.filter((f) => !warn(f)), ...(p.color === game.side ? warnings.map(sacrifice) : warnings)];
  // « la pièce était attaquée » ne convient pas à un pion
  facts = facts.map((f) => f.replace(/^Met le pion à l’abri : la pièce était attaquée\./, 'Met le pion à l’abri : il était attaqué.'));
  // rien à dire de sûr : on invite à chercher l'idée, sans rien inventer
  if (!facts.length && max > 1) {
    return d.facts.some((f) => !warn(f))
      ? 'Regarde bien la suite de la partie : c’est elle qui montre l’idée de ce coup.'
      : 'Un coup calme : demande-toi quelle pièce il améliore, ce qu’il empêche ou quel plan il prépare.';
  }
  return facts.slice(0, max).join(' ');
}

const moveNo = (i) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'}`;
/** « 0,7 pion », « 2,4 pions » */
const pawns = (cp) => `${(Math.abs(cp) / 100).toFixed(1).replace('.', ',')} pion${Math.abs(cp) >= 200 ? 's' : ''}`;
/** « 0 raté », « 1 raté », « 3 ratés » (en français, 0 et 1 restent au singulier) */
const plural = (n, one, many) => (n > 1 ? many : one);
const MATE = 9000; // au-delà : évaluation de mat
const playerOf = (game, side) => (game.group === 'classiques' ? (side === 'w' ? game.white : game.black) : null);
const sansOf = (g) => g.moves.split(/\s+/).filter(Boolean);
/** Nombre de coups à deviner pour un camp. */
const countFor = (g, side) => {
  const n = sansOf(g).length;
  return side === 'w' ? Math.ceil(n / 2) : Math.floor(n / 2);
};
/** Signature des coups : une partie en cours n'est reprise que si la partie n'a pas changé depuis. */
const sigOf = (g) => {
  let h = 5381;
  for (let k = 0; k < g.moves.length; k++) h = (Math.imul(h, 33) + g.moves.charCodeAt(k)) >>> 0;
  return `${sansOf(g).length}:${h.toString(36)}`;
};
const subtitle = (g) => (g.group === 'classiques' ? `${g.white} – ${g.black} · ${g.event}` : g.opening);
/** « quel coup a joué Paul Morphy », « quel coup ont joué le duc de Brunswick et le comte Isouard » */
const whoPlayed = (who) => `quel coup ${/ et /.test(who) ? 'ont' : 'a'} joué <b>${esc(who.replace(/^(Le|La|Les) /, (w) => w.toLowerCase()))}</b>`;

function encouragement(pct) {
  if (pct >= 80) return 'Remarquable ! Tu as très souvent pensé comme le joueur modèle : tes plans sont solides.';
  if (pct >= 60) return 'Très bien ! Tu as compris la plupart des idées. Relis les commentaires des coups ratés pour compléter.';
  if (pct >= 40) return 'Bon travail : chaque coup raté est une idée nouvelle. Rejoue cette partie dans quelques jours, tu verras la différence.';
  return 'C’est en se trompant qu’on apprend : les grands joueurs ont progressé exactement comme ça. Relis les commentaires et rejoue la partie dans quelques jours.';
}

// ─── Liste des parties ───

function renderList(root) {
  setTitle('Devine le coup', '#/train');
  const item = (g) => {
    const r = record(g.id);
    const p = progressOf(g);
    const side = p?.side || g.side;
    const prog = p ? ' <span class="badge guess-badge">en cours</span>' : '';
    return `<a class="list-item guess-item" href="#/guess/${esc(g.id)}">
      <span class="guess-item-txt"><b>${esc(g.title)}</b><small class="muted">${esc(subtitle(g))}</small>
        <small>${p ? 'Tu joues' : 'Conseillé :'} les ${colorName(side)} · ${countFor(g, side)} coups à trouver${prog}</small></span>
      <span class="guess-best">${r?.best != null ? `<b>${r.best}&nbsp;%</b><small class="muted">record</small>` : '<small class="muted">à faire</small>'}</span>
    </a>`;
  };
  root.innerHTML = `
    <section class="card guess-intro">${md(nb(EXPLAIN))}</section>
    ${GROUPS.map(([gid, name, text]) => {
      const list = MODEL_GAMES.filter((g) => g.group === gid);
      if (!list.length) return '';
      return `<section class="card guess-group"><h2>${esc(name)}</h2><p class="muted small">${esc(text)}</p>${list.map(item).join('')}</section>`;
    }).join('')}`;
}

// ─── Une partie ───

export function render(root, id) {
  if (!id) {
    renderList(root);
    return;
  }
  const game = modelGameById(id);
  if (!game) {
    location.hash = '#/guess';
    return;
  }
  setTitle(game.title.replace(/^Partie modèle : /, ''), '#/guess'); // le titre complet est dans la carte
  const plies = pliesOf(game);
  const sig = sigOf(game);
  let alive = true;
  let board = null;
  let ac = new AbortController();

  function stopBoard() {
    ac.abort();
    ac = new AbortController();
    board?.destroy();
    board = null;
  }

  // ── Choix du camp ──
  function showSetup() {
    stopBoard();
    window.scrollTo(0, 0);
    const r = record(game.id);
    const prog = progressOf(game);
    let side = prog?.side || game.side;
    const sideBtn = (s) => {
      const who = playerOf(game, s);
      const n = countFor(game, s);
      return `<button class="guess-side-btn ${s === side ? 'on' : ''}" data-side="${s}">
        <span class="dot ${s}"></span><span class="guess-side-txt"><b>Les ${colorName(s)}</b>${who ? `<small>${esc(who)}</small>` : ''}<small class="muted">${n} coups${s === game.side ? ' · conseillé' : ''}</small></span></button>`;
    };
    root.innerHTML = `
      <section class="card guess-setup">
        <h2>${esc(game.title)}</h2>
        <p class="muted small">${esc(game.group === 'classiques' ? subtitle(game) : `${game.opening} · ${game.event}`)}</p>
        ${md(nb(game.intro))}
        <p><b>Quel camp veux-tu deviner&nbsp;?</b></p>
        <div class="guess-sides">${sideBtn('w')}${sideBtn('b')}</div>
        <p class="muted small guess-pov" ${side === game.side || game.group !== 'repertoire' ? 'hidden' : ''}>Les commentaires de l’ouverture sont écrits du point de vue des ${colorName(game.side)}.</p>
        <p class="muted small guess-tip">💡 ${esc(nb(TIP))}</p>
        ${r?.best != null ? `<p class="small">🏆 Ton record&nbsp;: <b>${r.best}&nbsp;%</b> (${r.attempts} ${plural(r.attempts, 'partie terminée', 'parties terminées')})</p>` : ''}
        ${prog ? `<button class="btn primary block" data-a="resume">Reprendre au coup ${Math.floor(prog.ply / 2) + 1} avec les ${colorName(prog.side)}</button>` : ''}
        <button class="btn ${prog ? 'ghost' : 'primary'} block" data-a="start">${prog ? 'Recommencer depuis le début' : 'Commencer'}</button>
      </section>`;
    root.querySelector('.guess-sides').addEventListener('click', (e) => {
      const b = e.target.closest('[data-side]');
      if (!b) return;
      side = b.dataset.side;
      root.querySelectorAll('.guess-side-btn').forEach((x) => x.classList.toggle('on', x === b));
      root.querySelector('.guess-pov').hidden = side === game.side || game.group !== 'repertoire';
    });
    root.querySelector('[data-a=start]').addEventListener('click', () => play({ side, ply: 0, pts: 0, maxPts: 0, results: [] }));
    root.querySelector('[data-a=resume]')?.addEventListener('click', () => play(prog));
  }

  // ── Le jeu ──
  function play(start) {
    stopBoard();
    window.scrollTo(0, 0);
    const side = start.side;
    const state = { ply: start.ply, pts: +start.pts || 0, maxPts: +start.maxPts || 0, results: [...(start.results || [])] };
    const heroTotal = plies.filter((p) => p.color === side).length;
    const who = playerOf(game, side);
    root.innerHTML = `
      <div class="guess-hud">
        <div><small class="muted">Score</small><b class="guess-score">0</b></div>
        <div><small class="muted">Coup</small><b class="guess-count">–</b></div>
        <div><small class="muted">Réussite</small><b class="guess-pct">–</b></div>
      </div>
      <div class="puzzle-prompt"><span class="dot ${side}"></span><span class="guess-prompt">La partie commence…</span></div>
      <div class="board-row"><div class="board-box"></div></div>
      <div class="feedback" aria-live="polite"></div>
      <div class="actions guess-actions" hidden>
        <button class="btn" data-a="hint">💡 Indice (−${HINT_COST})</button>
        <button class="btn" data-a="show">👁 Voir le coup</button>
      </div>
      <div class="coach guess-coach" hidden></div>
      <section class="card guess-moves-card"><div class="moves guess-moves"></div></section>`;
    const $ = (s) => root.querySelector(s);
    const fb = $('.feedback');
    const coach = $('.guess-coach');
    const actions = $('.guess-actions');
    board = createBoard($('.board-box'), { orientation: cgColor(side), onMove });
    const signal = ac.signal;
    const live = () => alive && !signal.aborted;
    let waiting = false;
    let hintUsed = false;
    let entries = [];

    const feedback = (html, cls = '') => {
      fb.className = 'feedback ' + cls;
      fb.innerHTML = nb(html); // html construit ici, textes échappés : aucun « : » dans les balises
    };

    function hud() {
      const done = state.results.length;
      $('.guess-score').textContent = `${state.pts} / ${state.maxPts}`;
      $('.guess-count').textContent = `${Math.min(done + (waiting ? 1 : 0), heroTotal)} / ${heroTotal}`;
      $('.guess-pct').textContent = state.maxPts ? `${Math.round((100 * state.pts) / state.maxPts)} %` : '–';
    }

    function renderMoves() {
      const res = new Map(state.results.map((r) => [r.i, r]));
      let html = '';
      for (let i = 0; i < state.ply; i++) {
        const p = plies[i];
        if (p.color === 'w') html += `<span class="mnum">${Math.floor(i / 2) + 1}.</span>`;
        else if (i === 0) html += '<span class="mnum">1…</span>';
        const r = res.get(i);
        html += `<span class="mv ${r ? 'g-' + r.kind : ''}">${fig(p.san)}</span>`;
      }
      const box = $('.guess-moves');
      box.innerHTML = html || '<span class="muted small">Les coups de la partie s’afficheront ici, avec en couleur ceux que tu as devinés.</span>';
      box.scrollTop = box.scrollHeight;
    }

    function showCoach() {
      coach.hidden = !entries.length;
      coach.innerHTML = entries
        .map((e) => `<div class="guess-entry"><div class="coach-title">${esc(e.label)}<span class="muted small">${esc(e.tag)}</span></div>${e.text ? md(nb(e.text)) : ''}</div>`)
        .join('');
    }

    const positionAt = (i) => positionOf(plies, i);

    /** Joue le coup i de la partie sur l'échiquier (coup adverse ou vrai coup révélé). */
    function playPly(i, shapes = []) {
      const c = positionAt(i);
      const m = playUci(c, plies[i].uci);
      if (m && db().settings.sound) moveSound(!!m.captured);
      board.setPosition(c, { interactive: null, lastMove: plies[i].uci });
      board.setShapes(shapes);
    }

    function saveProgress() {
      const prog = { sig, side, ply: state.ply, pts: state.pts, maxPts: state.maxPts, results: state.results };
      saveRecord(game.id, (r) => (r.progress = prog));
    }

    /** Score (centipions, point de vue des Blancs) d'une position, avec cache. */
    function evalFen(chess) {
      if (chess.isCheckmate()) return Promise.resolve(chess.turn() === 'w' ? -10000 : 10000);
      if (chess.isDraw()) return Promise.resolve(0);
      const fen = chess.fen();
      if (evalCache.has(fen)) return Promise.resolve(evalCache.get(fen));
      // une recherche lancée par un écran fermé depuis (signal annulé) ne doit pas être réutilisée
      const pending = evalPending.get(fen);
      if (pending && !pending.signal.aborted) return pending.job;
      const job = getAnalysisEngine()
        .search(fen, { depth: DEPTH, signal })
        .then((res) => {
          if (res.aborted || !res.lines[0]) throw new Error('interrompu');
          const cp = cpWhite(res.lines[0]);
          evalCache.set(fen, cp);
          return cp;
        });
      const entry = { job, signal };
      evalPending.set(fen, entry);
      job.catch(() => {}).finally(() => evalPending.get(fen) === entry && evalPending.delete(fen));
      return job;
    }
    const withTimeout = (p) => Promise.race([p, sleep(ENGINE_TIMEOUT).then(() => Promise.reject(new Error('délai')))]);

    /** Fait avancer la partie (coups adverses joués tout seuls) jusqu'au prochain coup à deviner. */
    async function advance() {
      while (live() && state.ply < plies.length && plies[state.ply].color !== side) {
        await sleep(state.ply === 0 ? 350 : 700);
        if (!live()) return;
        const i = state.ply;
        playPly(i);
        entries.push({ label: `${moveNo(i)}${fig(plies[i].san)}`, tag: 'réponse', text: explainPly(game, plies, i, 1) });
        showCoach();
        state.ply++;
        renderMoves();
      }
      if (!live()) return;
      if (state.ply >= plies.length) return finish();
      waitGuess();
    }

    function waitGuess() {
      const i = state.ply;
      hintUsed = false;
      waiting = true;
      board.setPosition(positionAt(i), { interactive: side, lastMove: plies[i - 1]?.uci });
      $('.guess-prompt').innerHTML = nb(who
        ? `${moveNo(i)} À toi : ${whoPlayed(who)} ?`
        : `${moveNo(i)} Trait aux ${colorName(side)} : trouve le coup de la partie modèle.`);
      actions.hidden = false;
      actions.querySelector('[data-a=hint]').disabled = false;
      hud();
      // on prépare déjà l'évaluation du vrai coup (utile si tu en joues un autre)
      const real = positionAt(i);
      playUci(real, plies[i].uci);
      evalFen(real).catch(() => {});
    }

    async function onMove(uci) {
      if (!waiting) return board?.sync();
      const i = state.ply;
      const p = plies[i];
      const test = positionAt(i);
      const m = playUci(test, uci);
      if (!m) return board.sync();
      waiting = false;
      actions.hidden = true;
      if (db().settings.sound) moveSound(!!m.captured);
      board.setPosition(test, { interactive: null, lastMove: uci });
      board.setShapes([]);
      const guess = uciOf(m);
      if (guess === p.uci) return reveal({ kind: 'exact', guess, guessSan: m.san });
      feedback('<span class="muted">Stockfish compare ton coup avec celui de la partie…</span>');
      const real = positionAt(i);
      playUci(real, p.uci);
      let loss;
      let note = null;
      try {
        const [mine, ref] = (await withTimeout(Promise.all([evalFen(test), evalFen(real)]))).map((v) => (side === 'w' ? v : -v));
        loss = ref - mine;
        if (ref >= MATE && mine >= MATE) {
          // les deux coups matent : un mat un peu plus long reste un coup gagnant, pas une perte en pions
          if (loss > 0) note = 'Ton coup mène aussi à un mat forcé, juste un peu plus long.';
          loss = Math.min(loss, 0);
        } else if (ref >= MATE) note = 'Le coup de la partie menait à un mat forcé !';
        else if (mine <= -MATE && ref > -MATE) note = 'Ton coup permettait à l’adversaire de mater.';
        else if (ref <= -MATE && mine > -MATE) note = 'Le coup de la partie permettait un mat forcé : le tien résiste mieux.';
        else if (ref <= -MATE && mine <= -MATE) loss = Math.min(loss, 0); // de toute façon, l'adversaire mate
      } catch {
        if (!live()) return;
        return reveal({ kind: 'skip', guess, guessSan: m.san, noEngine: true });
      }
      if (!live()) return;
      reveal({ kind: loss <= GOOD_LOSS ? 'good' : loss <= OK_LOSS ? 'ok' : 'miss', guess, guessSan: m.san, loss, note });
    }

    /** Montre le vrai coup, compte les points, explique, puis joue la réponse adverse. */
    async function reveal({ kind, guess = null, guessSan = '', loss = null, note = null, noEngine = false }) {
      waiting = false;
      actions.hidden = true;
      const i = state.ply;
      const p = plies[i];
      const pts = hintUsed ? Math.max(0, POINTS[kind] - HINT_COST) : POINTS[kind];
      state.results.push({ i, kind, pts, guess: guessSan });
      state.pts += pts;
      if (!noEngine) state.maxPts += POINTS.exact; // un coup que Stockfish n'a pas pu juger ne compte pas
      const real = esc(fig(p.san));
      const mine = esc(fig(guessSan));
      const plus = `<b>+${pts}</b>${hintUsed && POINTS[kind] ? ` <span class="muted small">(indice : −${Math.min(HINT_COST, POINTS[kind])})</span>` : ''}`;
      const lossTxt = note
        ? `<br><span class="muted small">${esc(note)}</span>`
        : loss > 0
          ? `<br><span class="muted small">Ton coup ${mine} : environ ${pawns(loss)} de moins d’après Stockfish.</span>`
          : '';
      const [html, cls] = {
        exact: [`✓ Exactement le coup joué ! ${plus}`, 'ok'],
        good: [
          (loss < -GOOD_LOSS
            ? `👍 Aussi bon ! Stockfish trouve même ${mine} meilleur que le coup de la partie (${real}). ${plus}`
            : `👍 Aussi bon que le coup de la partie (${real}) ! ${plus}`) + (note ? lossTxt : ''),
          'ok',
        ],
        ok: [`Jouable : le coup de la partie était <b>${real}</b>. ${plus}${lossTxt}`, 'guess-ok'],
        miss: [`✗ Le coup joué était <b>${real}</b>.${lossTxt}`, 'ko'],
        skip: [noEngine ? `Stockfish n’a pas pu vérifier ton coup : il ne compte pas. Le coup joué était <b>${real}</b>.` : `Le coup joué était <b>${real}</b>.`, 'ko'],
      }[kind];
      feedback(html, cls);
      $('.guess-prompt').innerHTML = `${moveNo(i)} Le coup de la partie : <b>${real}</b>`;
      hud();

      // ton coup (rouge si raté, bleu sinon) et le vrai (vert), puis on joue le vrai
      const green = [arrow(p.uci, 'green')];
      if (guess && guess !== p.uci) {
        board.setPosition(positionAt(i), { interactive: null, lastMove: plies[i - 1]?.uci });
        board.setShapes([arrow(guess, kind === 'miss' || kind === 'skip' ? 'red' : 'blue'), ...green]);
        await sleep(1100);
        if (!live()) return;
      }
      if (guess === p.uci) board.setShapes(green);
      else playPly(i, green);
      entries = [{ label: `${moveNo(i)}${fig(p.san)}`, tag: 'le coup de la partie', text: explainPly(game, plies, i, 2) }];
      showCoach();
      state.ply++;
      renderMoves();
      saveProgress();
      await sleep(900);
      if (live()) advance();
    }

    function finish() {
      waiting = false;
      actions.hidden = true;
      board.setInteractive(null);
      // aucun coup n'a pu être jugé (moteur indisponible) : pas de pourcentage, pas de record
      const pct = state.maxPts ? Math.round((100 * state.pts) / state.maxPts) : null;
      const prevBest = record(game.id)?.best ?? null;
      saveRecord(game.id, (r) => {
        r.attempts = (r.attempts || 0) + 1;
        if (pct != null) r.best = Math.max(r.best ?? 0, pct);
        delete r.progress;
      });
      const count = (...k) => state.results.filter((r) => k.includes(r.kind)).length;
      const allMissed = state.results.filter((r) => r.kind === 'miss' || r.kind === 'skip');
      const missed = allMissed.slice(0, 10);
      $('.guess-prompt').textContent = nb('Partie terminée !');
      hud();
      const recordTxt =
        pct == null
          ? 'Stockfish n’a pu juger aucun de tes coups : pas de record cette fois.'
          : prevBest == null
            ? '🏆 Premier record enregistré !'
            : pct > prevBest
              ? `🏆 Nouveau record ! (avant : ${prevBest} %)`
              : `Ton record : ${prevBest} %`;
      const stat = (cls, n, one, many) => `<div><b class="${cls}">${n}</b><small class="muted">${plural(n, one, many)}</small></div>`;
      const nMiss = count('miss', 'skip');
      const end = document.createElement('section');
      end.className = 'card guess-end';
      end.innerHTML = `
        <div class="muted">Ton score</div>
        <div class="guess-final">${state.pts}<small> / ${state.maxPts} points</small></div>
        ${pct != null ? `<div class="guess-final-pct">${pct}&nbsp;%</div>` : ''}
        <div class="guess-record">${esc(nb(recordTxt))}</div>
        <div class="guess-stats">
          ${stat('g-exact', count('exact'), 'exact', 'exacts')}
          ${stat('g-good', count('good'), 'aussi bon', 'aussi bons')}
          ${stat('g-ok', count('ok'), 'jouable', 'jouables')}
          ${stat('g-miss', nMiss, 'raté', 'ratés')}
        </div>
        ${md(nb(encouragement(pct ?? 0)))}
        ${
          missed.length
            ? `<h2>Les coups à retenir</h2><div class="guess-missed">${missed
                .map((r) => `<div class="line-item"><b>${moveNo(r.i)}${esc(fig(plies[r.i].san))}</b><span class="muted small">${r.guess ? `tu as joué ${esc(fig(r.guess))}` : 'pas trouvé'}</span></div>`)
                .join('')}${allMissed.length > missed.length ? `<p class="muted small">… et ${allMissed.length - missed.length} ${plural(allMissed.length - missed.length, 'autre', 'autres')}, en orange dans la liste des coups.</p>` : ''}</div>`
            : ''
        }
        <div class="actions">
          <button class="btn primary" data-a="again">Rejouer</button>
          <a class="btn" href="#/guess">Autres parties</a>
        </div>`;
      root.insertBefore(end, root.firstChild);
      end.querySelector('[data-a=again]').addEventListener('click', showSetup);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    actions.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || !waiting) return;
      const p = plies[state.ply];
      if (b.dataset.a === 'hint') {
        if (hintUsed) return;
        hintUsed = true;
        b.disabled = true;
        board.setShapes([{ orig: p.from, brush: 'green' }]);
        feedback(`💡 La pièce à jouer est entourée en vert (−${HINT_COST} points si tu trouves).`);
      } else if (b.dataset.a === 'show') {
        waiting = false;
        board.setInteractive(null);
        reveal({ kind: 'skip' });
      }
    });

    // début ou reprise : l'échiquier part de la bonne position
    board.setPosition(positionAt(state.ply), { interactive: null, lastMove: plies[state.ply - 1]?.uci });
    renderMoves();
    hud();
    if (state.ply > 0) feedback(`On reprend au coup ${Math.floor(state.ply / 2) + 1}.`);
    advance();
  }

  showSetup();
  return () => {
    alive = false;
    stopBoard();
  };
}

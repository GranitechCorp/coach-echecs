// Auto-analyse (méthode Dvoretsky / Yusupov / Kotov) : tu analyses ta partie TOI-MÊME avant de regarder le moteur.
// Étape 1 : rejouer la partie sans aucune aide du moteur, marquer ses erreurs supposées, les moments critiques,
// une note et « le coup que j'aurais dû jouer ». Étape 2 : comparaison avec Stockfish et score de lucidité.
import { Chess } from 'chess.js';
import { db, update } from '../storage.js';
import { setTitle, esc, md, toast, moveListHtml, classBadge, confirmDialog } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { getAnalysisEngine } from '../engine.js';
import { parsePgn, uciOf, playUci, cgColor, fig, uciToSan, pvToSan, winPct, cpWhite, NAME, theName, aName } from '../chessutil.js';
import { explainMistake, classifyMove, CLASSES } from '../explain.js';
import { analyzeGame, saveReview, cpOfEval, ensureDerived, ensureReviewExtras } from '../analyzer.js';

export const tab = 'profile';

const DEPTH = 12;
const ERR = ['mistake', 'blunder'];
const LIST_HASH = '#/selfreview/choisir';
const PCT = ' %';

// ─────────────── Petits outils ───────────────

const fem = (t) => t === 'q' || t === 'r';
/** « ton fou », « ta dame », « son cavalier »… */
const poss = (t, mine) => (mine ? (fem(t) ? 'ta ' : 'ton ') : fem(t) ? 'sa ' : 'son ') + NAME[t];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function fmtDate(iso) {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR');
}
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
/** Résultat lisible du point de vue du joueur (« 1-0 » → « Victoire » ou « Défaite » ; « * » = partie non terminée). */
function resultFr(raw, color) {
  const r = String(raw || '').trim();
  if (r === '1-0') return color === 'b' ? 'Défaite' : 'Victoire';
  if (r === '0-1') return color === 'b' ? 'Victoire' : 'Défaite';
  if (r === '1/2-1/2' || r === '½-½') return 'Nulle';
  return r === '*' ? '' : r;
}

/** Le coup en mots, cases comprises (aide à se repérer sur l'échiquier) — aucune info du moteur. */
function moveWords(m, mine) {
  const mate = m.san.includes('#');
  const check = !mate && m.san.includes('+');
  let s;
  if (m.flags.includes('k') || m.flags.includes('q')) {
    s = `${mine ? 'Tu roques' : 'Ton adversaire roque'} côté ${m.flags.includes('k') ? 'roi' : 'dame'}`;
  } else {
    s = cap(poss(m.piece, mine));
    if (m.flags.includes('e')) s += ` prend le pion en passant (${m.from} → ${m.to})`;
    else if (m.captured) s += ` prend ${theName(m.captured)} en ${m.to}`;
    else s += ` va de ${m.from} à ${m.to}`;
    if (m.promotion) s += ` et devient ${aName(m.promotion)}`;
  }
  if (mate) return s + ' : échec et mat !';
  return s + (check ? ', avec échec.' : '.');
}

/** Marques d'un coup (dans la liste des coups et les puces). */
const shortMarks = (f) => (f.error ? '✗' : '') + (f.critical ? '⚡' : '') || (f.proposal ? '💡' : '✎');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
/** Espaces insécables de la typographie française : jamais de « ! » ou de « : » seul en début de ligne. */
const nbsp = (s) => s.replace(/ ([!?:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
const fullMarks = (f) => (f.error ? '✗' : '') + (f.critical ? '⚡' : '') + (f.proposal ? '💡' : '') + (f.note?.trim() ? '✎' : '');

/** Message selon le score de lucidité. */
function scoreMessage(score, nFalse) {
  if (score === null) {
    return {
      title: 'Partie propre !',
      text: nFalse
        ? 'Stockfish n’a trouvé ni erreur ni gaffe de ta part. Les coups dont tu doutais étaient en fait jouables : fais un peu plus confiance à ton jeu.'
        : 'Stockfish n’a trouvé ni erreur ni gaffe de ta part, et tu ne t’es pas inventé de fausses alertes. Bravo !',
    };
  }
  if (score >= 80) return { title: 'Œil de coach !', text: 'Tu as repéré (presque) toutes tes erreurs tout seul. C’est exactement l’habitude des joueurs qui progressent vite.' };
  if (score >= 50) return { title: 'Belle lucidité', text: 'Tu as vu l’essentiel. Les erreurs qui t’ont échappé sont les plus instructives : prends le temps de les comprendre ci-dessous.' };
  if (score >= 25) return { title: 'Bon début', text: 'Tu as trouvé une partie de tes erreurs. À chaque auto-analyse, ton regard s’aiguise : continue comme ça !' };
  return {
    title: 'C’est normal au début',
    text: 'Repérer ses propres erreurs sans moteur, c’est difficile : même les forts joueurs ont dû l’apprendre. Lis bien les explications ci-dessous et recommence sur ta prochaine partie : le score monte vite.',
  };
}

/** Conseil ciblé : d'abord d'après les erreurs manquées (catégories du bilan), sinon d'après le profil de l'auto-analyse. */
function adviceFor({ score, missedCats, nFalse, nFound, nNotes, nMarked }) {
  const has = (p) => missedCats.some((c) => c === p || c.startsWith(p));
  if (has('piece-en-prise') || has('mat-subi'))
    return 'Avant de lâcher ta pièce, fais le **contrôle anti-gaffe** : « Quelles pièces mon adversaire peut-il prendre ? Ma pièce sera-t-elle défendue sur sa nouvelle case ? »';
  if (has('subi-'))
    return 'Pose-toi la question de Kotov à chaque coup adverse : **« Qu’est-ce qu’il menace ? »** Regarde ses échecs, ses prises et ses attaques avant de jouer ton coup.';
  if (has('occasion-manquee') || has('rate-'))
    return 'Quand ton adversaire vient de jouer, cherche d’abord les **coups forcés** : échecs, prises, menaces. Certaines de tes erreurs étaient des occasions laissées passer.';
  if (has('zeitnot')) return 'Plusieurs erreurs sont arrivées avec peu de temps à la pendule : garde au moins un tiers de ton temps pour le milieu de partie.';
  if (nFalse >= 2 && nFalse > nFound)
    return 'Tu as soupçonné plusieurs bons coups : ta compréhension est meilleure que tu ne le crois. Marque seulement les coups où tu as un **vrai doute**.';
  if (nMarked && !nNotes)
    return 'Écris une **note** sur chaque moment marqué, même courte (« j’ai oublié son fou »). Mettre ton idée en mots t’aide à la retenir.';
  if (score !== null && score >= 80)
    return 'Étape suivante : pour chaque erreur, écris **pourquoi** tu l’as faite (menace pas vue, calcul trop court, manque de temps). Tu repéreras tes erreurs-types.';
  return 'Fais une auto-analyse après chaque partie longue : 10 minutes suffisent, et ton score de lucidité montera vite.';
}

/** Historique des auto-analyses terminées (les plus anciennes d'abord). */
function scoreHistory() {
  return Object.entries(db().selfReviews || {})
    .filter(([, x]) => x?.done && typeof x.score === 'number')
    .sort((a, b) => String(a[1].date || '').localeCompare(String(b[1].date || '')))
    .map(([id, x]) => ({ id, score: x.score }));
}

const stepper = (step) => `
  <div class="sr-steps">
    <span class="${step === 1 ? 'on' : 'done'}">${step > 1 ? '✓ ' : ''}1 · Ta propre analyse</span>
    <span class="${step === 2 ? 'on' : ''}">2 · Comparer avec Stockfish</span>
  </div>`;

// ─────────────── Liste des parties ───────────────

function renderList(root, notFound) {
  setTitle('Auto-analyse', '#/train');
  const s = db();
  const reviews = s.selfReviews || {};
  const games = s.games
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 40);
  const hist = scoreHistory().filter((h) => s.games.some((g) => g.id === h.id));
  const avg = hist.length ? Math.round(hist.reduce((t, h) => t + h.score, 0) / hist.length) : null;
  const status = (g) => {
    const r = reviews[g.id];
    if (r?.done) return typeof r.score === 'number' ? `<span class="sr-status done">Lucidité ${r.score}${PCT}</span>` : '<span class="sr-status done">✓ Partie propre</span>';
    if (r) return '<span class="sr-status draft">En cours</span>';
    return '<span class="sr-status">À faire</span>';
  };
  root.innerHTML = `
    ${notFound ? '<p class="card error">Cette partie est introuvable : choisis-en une autre ci-dessous.</p>' : ''}
    <section class="card sr-hero">
      <h2>🧠 Analyse ta partie toi-même</h2>
      <p>Les grands entraîneurs (Dvoretsky, Yusupov, Kotov) sont d’accord : avant de regarder l’ordinateur, rejoue ta partie et cherche <b>toi-même</b> où tu t’es trompé. C’est l’habitude qui fait le plus progresser sur le long terme.</p>
      <ol class="small sr-how">
        <li>Tu rejoues ta partie sans aucune aide et tu marques 3 à 5 moments importants.</li>
        <li>Stockfish compare avec ton analyse : tu obtiens ton score de <b>lucidité</b>.</li>
      </ol>
      ${hist.length ? `<div class="sr-kpis">
        <div><b>${hist.length}</b><small>auto-analyse${hist.length > 1 ? 's' : ''}</small></div>
        <div><b>${avg}${PCT}</b><small>lucidité moyenne</small></div>
        <div><b>${hist.at(-1).score}${PCT}</b><small>la dernière</small></div>
      </div>` : ''}
    </section>
    <section class="card">
      <h2>Choisis une partie</h2>
      ${games.length
        ? games
            .map(
              (g) => `<a class="list-item sr-game" href="#/selfreview/${encodeURIComponent(g.id)}">
          <span class="sr-game-txt">${g.userColor === 'b' ? '⚫' : '⚪'} ${esc(g.label || 'Partie')}<br/><small class="muted">${esc([fmtDate(g.date), resultFr(g.result, g.userColor)].filter(Boolean).join(' · '))}</small></span>
          ${status(g)}</a>`,
            )
            .join('')
        : `<p class="muted">Aucune partie pour l’instant. Importe tes parties chess.com ou joue contre l’ordinateur, puis reviens ici.</p>
           <div class="row wrap"><a class="btn small" href="#/analysis">Importer mes parties</a><a class="btn small ghost" href="#/play">Jouer une partie</a></div>`}
    </section>`;
}

// ─────────────── Écran principal ───────────────

export function render(root, gameId) {
  const game = gameId ? db().games.find((g) => g.id === gameId) : null;
  if (!game) return renderList(root, !!gameId && gameId !== 'choisir');
  setTitle('Auto-analyse', LIST_HASH);

  const parsed = parsePgn(game.pgn || '');
  if (!parsed || !parsed.moves.length) {
    root.innerHTML = `<section class="card"><p class="error">${parsed ? 'Cette partie ne contient aucun coup : rien à analyser.' : 'Impossible de lire cette partie.'}</p><a class="btn" href="${LIST_HASH}">Choisir une autre partie</a></section>`;
    return;
  }
  const { headers, moves, startFen } = parsed;
  const fens = [startFen, ...moves.map((m) => m.after)];
  const me = game.userColor === 'b' ? 'b' : 'w';
  const sign = me === 'w' ? 1 : -1;
  const winFor = (cp) => winPct(cp * sign);
  const start = new Chess(startFen);
  const startNo = start.moveNumber();
  const startTurn = start.turn();
  const numOf = (i) => `${Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2) + startNo}${moves[i].color === 'w' ? '.' : '…'}`;
  const moveLabel = (i) => numOf(i) + fig(moves[i].san);
  const label = game.label || [headers.White, headers.Black].filter(Boolean).join(' – ') || 'Partie';
  const resultTxt = resultFr(game.result || headers.Result, game.userColor);
  const engine = getAnalysisEngine();

  if (!moves.some((m) => m.color === me)) {
    root.innerHTML = `<section class="card"><p>Cette partie est trop courte pour une auto-analyse : tu n’y as joué aucun coup.</p><a class="btn" href="${LIST_HASH}">Choisir une autre partie</a></section>`;
    return;
  }

  let alive = true;
  let board = null; // échiquier de l'étape 1
  let viewer = null; // petit échiquier de l'étape 2
  let viewerBtn = null;
  let rev = null; // bilan affiché à l'étape 2 (copie : ses tableaux restent lisibles même si le stockage plein allège la partie)
  let ctrl = null; // recherches moteur de l'étape 2
  let noteTimer = null;
  let keyHandler = null;
  let phase = 'intro';

  const saved = db().selfReviews?.[game.id];
  let flags = clone(saved?.flags);
  let verdicts = clone(saved?.verdicts);
  /** Indices (triés) des coups marqués, limités aux coups du joueur. */
  const flaggedIdx = () =>
    Object.keys(flags)
      .map(Number)
      .filter((i) => i >= 0 && i < moves.length && moves[i].color === me)
      .sort((a, b) => a - b);

  const headHtml = (step) => `
    <section class="card sr-head">
      <div class="row between"><b class="sr-label">${me === 'w' ? '⚪' : '⚫'} ${esc(label)}</b>${resultTxt ? `<span class="badge">${esc(resultTxt)}</span>` : ''}</div>
      <p class="muted small">${esc([fmtDate(game.date), `tu avais les ${me === 'w' ? 'Blancs' : 'Noirs'}`, plural(Math.ceil(moves.length / 2), 'coup')].filter(Boolean).join(' · '))}</p>
      ${stepper(step)}
    </section>`;

  function saveDraft() {
    update((d) => {
      d.selfReviews ||= {};
      const prev = d.selfReviews[game.id];
      d.selfReviews[game.id] = { flags: clone(flags), started: prev?.started || new Date().toISOString(), done: false };
    });
  }

  function teardown() {
    clearTimeout(noteTimer);
    noteTimer = null;
    ctrl?.abort();
    ctrl = null;
    board?.destroy();
    board = null;
    viewer?.destroy();
    viewer = null;
    viewerBtn = null;
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }

  // ─────────────── Auto-analyse déjà faite : revoir ou recommencer ───────────────

  function showIntro() {
    phase = 'intro';
    teardown();
    const r = db().selfReviews?.[game.id] || {};
    const nFound = r.found?.length ?? 0;
    const nReal = r.real ?? nFound + (r.missed?.length ?? 0);
    root.innerHTML = `
      ${headHtml(2)}
      <section class="card">
        <h2>Tu as déjà fait l’auto-analyse de cette partie</h2>
        <p>${r.date ? `Le ${esc(fmtDate(r.date))} · ` : ''}${
          typeof r.score === 'number'
            ? `lucidité <b>${r.score}${PCT}</b> (${nFound} erreur${nFound > 1 ? 's' : ''} trouvée${nFound > 1 ? 's' : ''} sur ${nReal}).`
            : 'aucune erreur à trouver dans cette partie.'
        }</p>
        ${
          r.falseAlarms?.length || r.missed?.length
            ? `<p class="small muted">${[r.missed?.length ? `${r.missed.length} manquée${r.missed.length > 1 ? 's' : ''}` : '', r.falseAlarms?.length ? `${r.falseAlarms.length} fausse${r.falseAlarms.length > 1 ? 's' : ''} alerte${r.falseAlarms.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</p>`
            : ''
        }
        <div class="row wrap">
          <button class="btn primary" id="sr-see">Revoir le résultat</button>
          <button class="btn ghost" id="sr-restart">🔁 Recommencer</button>
        </div>
        <a class="btn ghost small" href="#/review/${encodeURIComponent(game.id)}">📊 Bilan complet de la partie</a>
      </section>`;
    root.querySelector('#sr-see').onclick = () => compare();
    root.querySelector('#sr-restart').onclick = restart;
  }

  async function restart() {
    if (!(await confirmDialog('Recommencer efface tes marques et ton résultat pour cette partie. On y va ?', 'Recommencer'))) return;
    if (!alive) return;
    flags = {};
    verdicts = {};
    update((d) => {
      d.selfReviews ||= {};
      delete d.selfReviews[game.id];
    });
    showStep1();
    window.scrollTo(0, 0);
  }

  // ─────────────── Étape 1 : ta propre analyse (aucune info du moteur) ───────────────

  function showStep1() {
    phase = 'step1';
    teardown();
    root.innerHTML = `
      ${headHtml(1)}
      <section class="card sr-guide">
        <p><b>Rejoue ta partie sans l’ordinateur.</b> Cherche 3 à 5 moments :</p>
        <ul>
          <li>où as-tu perdu du matériel ?</li>
          <li>où la position a-t-elle basculé ?</li>
          <li>qu’est-ce que ton adversaire menaçait ?</li>
        </ul>
        <details class="small"><summary>Pourquoi sans Stockfish ?</summary>
          <p>Si tu regardes le moteur tout de suite, tu lis des réponses sans chercher. En analysant d’abord toi-même, tu entraînes exactement ce qui te manque en partie : <b>voir tes erreurs avant qu’elles arrivent</b>. Ensuite seulement, Stockfish te dit ce que tu as vu… et ce qui t’a échappé.</p>
        </details>
      </section>
      <div class="board-row"><div class="board-box" id="sr-board"></div></div>
      <div class="nav">
        <button class="btn" data-nav="first" aria-label="Début">⏮</button><button class="btn" data-nav="prev" aria-label="Coup précédent">◀</button>
        <button class="btn" data-nav="next" aria-label="Coup suivant">▶</button><button class="btn" data-nav="last" aria-label="Fin">⏭</button>
      </div>
      <section class="card sr-panel" id="sr-panel" aria-live="polite"></section>
      <div class="moves card" id="sr-moves"></div>
      <section class="card sr-marked" id="sr-marked"></section>`;

    const panel = root.querySelector('#sr-panel');
    const movesEl = root.querySelector('#sr-moves');
    const markedEl = root.querySelector('#sr-marked');
    let cur = -1;
    let proposing = false;
    board = createBoard(root.querySelector('#sr-board'), { orientation: cgColor(me), onMove: onBoardMove });

    function flushNote() {
      if (!noteTimer) return;
      clearTimeout(noteTimer);
      noteTimer = null;
      saveDraft();
    }

    function setFlag(i, patch) {
      const f = { error: false, critical: false, note: '', proposal: null, ...flags[i], ...patch };
      if (!f.error && !f.critical && !f.note.trim() && !f.proposal) delete flags[i];
      else flags[i] = f;
      saveDraft();
    }

    function show(i) {
      flushNote();
      cur = Math.max(-1, Math.min(moves.length - 1, i));
      proposing = false;
      board.setPosition(new Chess(fens[cur + 1]), { interactive: null, lastMove: cur >= 0 ? uciOf(moves[cur]) : undefined });
      const p = flags[cur]?.proposal;
      board.setShapes(p ? [arrow(p, 'blue')] : []);
      renderMoves();
      renderPanel();
      renderMarked();
    }

    function startProposal() {
      if (cur < 0 || moves[cur].color !== me) return;
      flushNote();
      proposing = true;
      board.setPosition(new Chess(fens[cur]), { interactive: me, lastMove: cur > 0 ? uciOf(moves[cur - 1]) : undefined });
      board.setShapes([]);
      renderPanel();
      root.querySelector('#sr-board').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function onBoardMove(uci) {
      if (!proposing || cur < 0) return board.sync();
      const m = playUci(new Chess(fens[cur]), uci);
      if (!m) return board.sync();
      if (uciOf(m) === uciOf(moves[cur])) {
        toast('C’est le coup que tu as joué : propose une autre idée.');
        board.setPosition(new Chess(fens[cur]), { interactive: me, lastMove: cur > 0 ? uciOf(moves[cur - 1]) : undefined });
        return;
      }
      setFlag(cur, { proposal: uciOf(m) });
      toast(`Idée enregistrée : ${fig(m.san)}`);
      show(cur);
    }

    /** Marques des coups dans la liste, mises à jour sur place (sans recréer les boutons). */
    function markMoves() {
      for (const b of movesEl.querySelectorAll('.sr-mv-flag')) {
        b.classList.remove('sr-mv-flag', 'sr-mv-err');
        b.querySelector('.sr-sup')?.remove();
      }
      for (const i of flaggedIdx()) {
        const b = movesEl.querySelector(`.mv[data-i="${i}"]`);
        if (!b) continue;
        b.classList.add('sr-mv-flag');
        if (flags[i].error) b.classList.add('sr-mv-err');
        b.insertAdjacentHTML('beforeend', `<sup class="sr-sup">${shortMarks(flags[i])}</sup>`);
      }
    }

    function renderMoves() {
      movesEl.innerHTML = moveListHtml(
        moves.map((m) => ({ san: m.san })),
        cur,
        startNo,
        startTurn,
      );
      markMoves();
      // fait défiler la liste seulement (sans faire sauter la page)
      const curEl = movesEl.querySelector('.cur');
      if (curEl) {
        const a = curEl.getBoundingClientRect();
        const z = movesEl.getBoundingClientRect();
        movesEl.scrollTop += a.top - z.top - (movesEl.clientHeight - a.height) / 2;
      }
    }

    function renderPanel() {
      if (cur < 0) {
        panel.innerHTML = '<p class="muted">Position de départ. Avance avec ▶ (ou touche un coup dans la liste) et arrête-toi sur chaque coup qui te semble important.</p>';
        return;
      }
      const m = moves[cur];
      const mine = m.color === me;
      const title = `${mine ? 'Ton coup' : 'Coup adverse'} <b>${esc(moveLabel(cur))}</b>`;
      if (!mine) {
        panel.innerHTML = `
          <div class="sr-ptitle">${title}</div>
          <p class="small sr-words">${esc(moveWords(m, false))}</p>
          <p class="muted small">Avant d’avancer, demande-toi : <b>qu’est-ce que ce coup menace ?</b> Qu’est-ce que ton adversaire veut faire ensuite ?</p>`;
        return;
      }
      if (proposing) {
        panel.innerHTML = `
          <div class="sr-ptitle">💡 Ton idée à la place de <b>${esc(moveLabel(cur))}</b></div>
          <p>Joue sur l’échiquier le coup que tu aurais dû jouer. L’échiquier est revenu à la position <b>d’avant</b> ton coup.</p>
          <button class="btn small ghost" data-a="cancel">Annuler</button>`;
        return;
      }
      const f = flags[cur] || {};
      const prop = f.proposal ? fig(uciToSan(fens[cur], f.proposal)) : '';
      panel.innerHTML = `
        <div class="sr-ptitle">${title}</div>
        <p class="small sr-words">${esc(moveWords(m, true))}</p>
        <div class="sr-toggles">
          <button class="btn sr-toggle sr-err${f.error ? ' on' : ''}" data-t="error" aria-pressed="${!!f.error}">Je crois m’être trompé ici</button>
          <button class="btn sr-toggle sr-crit${f.critical ? ' on' : ''}" data-t="critical" aria-pressed="${!!f.critical}">⚡ Moment critique</button>
        </div>
        <textarea id="sr-note" rows="2" maxlength="200" placeholder="Ta note (facultatif) : ce que tu pensais, ce que tu as raté…">${esc(f.note || '')}</textarea>
        ${
          f.proposal
            ? `<div class="sr-prop"><span>💡 Ton idée : <b>${esc(prop)}</b></span><span class="sr-prop-btns"><button class="btn small ghost" data-a="propose">Changer</button><button class="btn small ghost" data-a="clear">Effacer</button></span></div>`
            : '<button class="btn small sr-propose" data-a="propose">💡 Le coup que j’aurais dû jouer…</button>'
        }`;
    }

    function renderMarked() {
      const idx = flaggedIdx();
      const n = idx.length;
      const goal =
        n === 0
          ? 'Objectif : 3 à 5 moments.'
          : n < 3
            ? `Encore ${3 - n === 1 ? 'un moment' : 'deux moments'} à chercher ? Objectif : 3 à 5.`
            : n <= 5
              ? '✓ Objectif atteint : 3 à 5 moments.'
              : 'C’est beaucoup : garde surtout les moments vraiment importants (3 à 5).';
      // le bouton « Comparer » n'est jamais recréé : un toucher qui fait perdre le focus à la note ne se perd pas
      if (!markedEl.querySelector('#sr-compare')) {
        markedEl.innerHTML = `
          <h2>Tes moments marqués <span class="muted" id="sr-n"></span></h2>
          <div id="sr-chips-wrap"></div>
          <p class="small" id="sr-goal"></p>
          <button class="btn primary block" id="sr-compare">Comparer avec Stockfish →</button>
          <p class="muted small">Une fois la comparaison lancée, tes marques sont figées : c’est ta première impression qui compte.</p>`;
      }
      markedEl.querySelector('#sr-n').textContent = `(${n})`;
      const wrap = markedEl.querySelector('#sr-chips-wrap');
      let box = wrap.querySelector('.sr-chips');
      if (!n) {
        wrap.innerHTML = '<p class="muted small">Aucun pour l’instant. Va sur un de tes coups (avec ▶ ou en touchant la liste) puis marque-le.</p>';
      } else {
        if (!box) {
          wrap.innerHTML = `<div class="sr-chips"></div>
             <p class="small muted sr-legend-marks">✗ erreur supposée · ⚡ moment critique · 💡 ton idée · ✎ note</p>`;
          box = wrap.querySelector('.sr-chips');
        }
        // mise à jour sur place, puce par puce : un toucher en cours sur une puce existante n'est jamais perdu
        const existing = new Map([...box.children].map((c) => [+c.dataset.i, c]));
        for (const [i, c] of existing) if (!idx.includes(i)) c.remove();
        idx.forEach((i, k) => {
          let c = existing.get(i);
          if (!c) {
            c = document.createElement('button');
            c.className = 'sr-chip';
            c.dataset.i = i;
            c.innerHTML = `<b>${esc(moveLabel(i))}</b> <span></span>`;
          }
          if (box.children[k] !== c) box.insertBefore(c, box.children[k] || null);
          c.classList.toggle('cur', i === cur);
          c.querySelector('span').textContent = fullMarks(flags[i]);
        });
      }
      const goalEl = markedEl.querySelector('#sr-goal');
      goalEl.className = `small ${n >= 3 && n <= 5 ? 'good-txt' : 'muted'}`;
      goalEl.textContent = goal;
    }

    root.querySelector('.nav').addEventListener('click', (e) => {
      const a = e.target.closest('[data-nav]')?.dataset.nav;
      if (a === 'first') show(-1);
      else if (a === 'prev') show(cur - 1);
      else if (a === 'next') show(cur + 1);
      else if (a === 'last') show(moves.length - 1);
    });
    movesEl.addEventListener('click', (e) => {
      const b = e.target.closest('.mv');
      if (b) show(+b.dataset.i);
    });
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]')?.dataset.t;
      if (t && cur >= 0) {
        flushNote();
        const firstError = t === 'error' && !flaggedIdx().some((i) => flags[i].error);
        setFlag(cur, { [t]: !flags[cur]?.[t] });
        if (firstError) toast('Noté ! Si tu veux, écris pourquoi ou propose un meilleur coup.');
        renderPanel();
        renderMoves();
        renderMarked();
        return;
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'propose') startProposal();
      else if (a === 'cancel') show(cur);
      else if (a === 'clear') {
        setFlag(cur, { proposal: null });
        show(cur);
      }
    });
    panel.addEventListener('input', (e) => {
      if (e.target.id !== 'sr-note' || cur < 0) return;
      const note = e.target.value.slice(0, 200);
      const f = { error: false, critical: false, note: '', proposal: null, ...flags[cur], note };
      if (!f.error && !f.critical && !note.trim() && !f.proposal) delete flags[cur];
      else flags[cur] = f;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        noteTimer = null;
        saveDraft();
      }, 400);
    });
    panel.addEventListener('change', (e) => {
      if (e.target.id !== 'sr-note') return;
      flushNote();
      markMoves();
      renderMarked();
    });
    markedEl.addEventListener('click', async (e) => {
      const chip = e.target.closest('.sr-chip');
      if (chip) {
        show(+chip.dataset.i);
        root.querySelector('#sr-board').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!e.target.closest('#sr-compare')) return;
      flushNote();
      if (!flaggedIdx().length && !(await confirmDialog('Tu n’as encore marqué aucun moment. Comparer quand même avec Stockfish ?', 'Comparer', 'Je continue à chercher'))) return;
      if (alive && phase === 'step1') {
        compare();
        window.scrollTo(0, 0);
      }
    });
    keyHandler = (e) => {
      if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) || document.querySelector('.modal')) return;
      if (e.key === 'ArrowLeft') show(cur - 1);
      else if (e.key === 'ArrowRight') show(cur + 1);
    };
    document.addEventListener('keydown', keyHandler);
    show(-1);
  }

  // ─────────────── Étape 2 : comparer avec Stockfish ───────────────

  const hasReview = () => {
    const r = game.review;
    return !!(r?.evals && r.n === moves.length && r.evals.length === moves.length + 1 && r.classes?.length === moves.length);
  };

  function compare() {
    phase = 'compare';
    teardown();
    if (hasReview()) return showResults();
    const minutes = Math.max(1, Math.round((fens.length * 0.9) / 60));
    const idx = flaggedIdx();
    root.innerHTML = `
      ${headHtml(2)}
      <section class="card">
        <h2>Stockfish analyse la partie…</h2>
        <p class="muted small">Il examine chacune des ${fens.length} positions. Garde l’écran allumé, ça prend environ ${minutes} min.</p>
        <div class="progress"><div id="sr-prog" style="width:0%"></div></div>
        <p class="small muted" id="sr-prog-txt"></p>
      </section>
      ${
        idx.length
          ? `<section class="card"><h2>En attendant, relis tes moments</h2>${idx
              .map((i) => `<div class="sr-recap"><b>${esc(moveLabel(i))}</b> <span>${fullMarks(flags[i])}</span>${flags[i].note?.trim() ? `<br/><small class="muted">« ${esc(flags[i].note.trim())} »</small>` : ''}</div>`)
              .join('')}</section>`
          : ''
      }`;
    analyzeGame(game, {
      depth: DEPTH,
      isAlive: () => alive && phase === 'compare',
      onProgress: (i, n) => {
        const bar = root.querySelector('#sr-prog');
        if (!bar) return;
        bar.style.width = Math.round((i / n) * 100) + '%';
        root.querySelector('#sr-prog-txt').textContent = `${i} / ${n} positions`;
      },
    })
      .then((review) => {
        if (!alive || phase !== 'compare' || !review) return;
        saveReview(game, review);
        game.review = review;
        showResults();
      })
      .catch((err) => {
        console.warn(err);
        if (!alive || phase !== 'compare') return;
        root.innerHTML = `${headHtml(2)}<section class="card"><p class="error">L’analyse n’a pas pu aboutir.</p><button class="btn primary" id="sr-retry">Réessayer</button></section>`;
        root.querySelector('#sr-retry').onclick = () => compare();
      });
  }

  /** Le moment marqué « critique » l'était-il vraiment pour Stockfish ? */
  function criticalVerdict(i) {
    const r = rev;
    const cls = r.classes[i];
    const tag = r.tags?.[i];
    if (ERR.includes(cls)) return { ok: true, text: `Oui : c’est là que la partie a basculé (${CLASSES[cls].label.toLowerCase()}).` };
    if (tag === 'brilliant' || tag === 'great') return { ok: true, text: 'Oui : il fallait trouver un coup fort ici… et tu l’as trouvé !' };
    if (tag === 'miss') return { ok: true, text: 'Oui : ton adversaire venait de se tromper, il y avait une occasion à saisir.' };
    const e = r.evals[i];
    if (e?.second && !e.over) {
      const gap = winFor(cpOfEval(e)) - winFor(cpWhite({ white: e.second }));
      if (gap >= 15) return { ok: true, text: 'Oui : dans cette position, un seul coup était vraiment bon.' };
    }
    const j = Math.min(i + 2, r.evals.length - 1);
    if (Math.abs(winFor(cpOfEval(r.evals[i])) - winFor(cpOfEval(r.evals[j]))) >= 15) return { ok: true, text: 'Oui : l’évaluation a nettement bougé autour de ce coup.' };
    return { ok: false, text: 'Pour Stockfish, la position est restée assez calme ici : pas de vrai tournant.' };
  }

  /** Évalue la position après le coup proposé (profondeur 12). Renvoie { uci, cp (point de vue des Blancs), pv, fen } ou null. */
  async function evalProposal(i, uci, signal) {
    const c = new Chess(fens[i]);
    const m = playUci(c, uci);
    if (!m) return null;
    if (c.isCheckmate()) return { uci, cp: 10000 * sign, pv: [], fen: c.fen() };
    if (c.isGameOver()) return { uci, cp: 0, pv: [], fen: c.fen() };
    const res = await engine.search(c.fen(), { depth: DEPTH, signal });
    if (res.aborted || !res.lines[0]) return null;
    return { uci, cp: cpWhite(res.lines[0]), pv: res.lines[0].pv.slice(0, 6), fen: c.fen() };
  }

  /** Verdict du moteur sur une idée : 'equal' (aussi bon que le meilleur), 'better' (meilleur que le coup joué) ou 'worse'. */
  function verdictOf(i, v) {
    const r = rev;
    const best = r.evals[i].pv?.[0];
    const cpBest = cpOfEval(r.evals[i]);
    const wBest = winFor(cpBest);
    const wPlayed = winFor(cpOfEval(r.evals[i + 1]));
    const wProp = winFor(v.cp);
    const isBest = v.uci === best;
    const cls = classifyMove({ cpBefore: cpBest, cpAfter: v.cp, color: me, isBest }).cls;
    const kind = isBest || wBest - wProp <= 2 ? 'equal' : wProp - wPlayed >= 1.5 ? 'better' : 'worse';
    return { kind, cls, isBest, best, close: wProp > wPlayed - 1.5 };
  }

  function proposalHtml(i, v) {
    const { kind, cls, isBest, best, close } = verdictOf(i, v);
    const played = moves[i];
    const bestSan = best ? fig(uciToSan(fens[i], best)) : '';
    const head = {
      equal: isBest ? '✓ Exactement le coup de Stockfish !' : '✓ Aussi bon que le meilleur coup',
      better: '↗ Meilleur que ton coup joué',
      worse: '✗ Pas meilleur que ton coup joué',
    }[kind];
    let txt;
    if (kind === 'equal') txt = isBest ? 'Tu as trouvé tout seul le choix du moteur : bravo.' : `Stockfish le met au même niveau que son coup préféré${bestSan ? ` (${esc(bestSan)})` : ''}.`;
    else if (kind === 'better') txt = `Bonne intuition : ton idée valait mieux que ${esc(fig(played.san))}.${bestSan ? ` Le meilleur coup était quand même <b>${esc(bestSan)}</b>.` : ''}`;
    else {
      txt = `${close ? `Ton idée et ton coup ${esc(fig(played.san))} se valent à peu près.` : `Ton coup ${esc(fig(played.san))} était meilleur.`}${bestSan && best !== uciOf(played) ? ` Stockfish préférait <b>${esc(bestSan)}</b>.` : ''}`;
      if (v.pv?.length) txt += `<br/><span class="muted">Après ton idée, Stockfish répond : ${esc(pvToSan(v.fen, v.pv, 4))}</span>`;
    }
    const clsLine = isBest ? '' : `<div class="sr-verdict-row small"><span class="muted">Pour Stockfish, ton idée est :</span>${classBadge(cls)}</div>`;
    return `<div class="sr-verdict-row"><span class="sr-verdict ${kind}">${head}</span></div>${clsLine}<p class="small">${txt}</p>`;
  }

  function showResults() {
    phase = 'results';
    teardown();
    // anciens bilans : étiquettes et données dérivées recalculées sans moteur (comme dans le bilan)
    const derivedV = game.review.derived?.v;
    const changed = ensureReviewExtras(game.review, fens, moves);
    ensureDerived(game);
    rev = { ...game.review };
    if (changed || derivedV !== rev.derived?.v) update(() => {});
    const r = rev;
    const prev = db().selfReviews?.[game.id];
    const mineIdx = moves.map((m, i) => (m.color === me ? i : -1)).filter((i) => i >= 0);
    const real = mineIdx.filter((i) => ERR.includes(r.classes[i]));
    const idx = flaggedIdx();
    const found = real.filter((i) => flags[i]?.error);
    const missed = real.filter((i) => !flags[i]?.error);
    const falseAlarms = idx.filter((i) => flags[i].error && !ERR.includes(r.classes[i]));
    const criticals = idx.filter((i) => flags[i].critical);
    const proposals = idx.filter((i) => flags[i].proposal);
    const notesOnly = idx.filter((i) => !flags[i].error && !flags[i].critical && !flags[i].proposal && !real.includes(i));
    const score = real.length ? Math.round((found.length / real.length) * 100) : null;
    const errInfo = (i) => (r.derived?.errors || []).find((e) => e.i === i);
    const missedCats = missed.flatMap((i) => errInfo(i)?.cats || []);
    const nNotes = idx.filter((i) => flags[i].note?.trim()).length;

    // verdicts déjà calculés pour la même idée : on les garde
    for (const k of Object.keys(verdicts)) if (verdicts[k]?.uci !== flags[k]?.proposal) delete verdicts[k];
    update((d) => {
      d.selfReviews ||= {};
      d.selfReviews[game.id] = {
        flags: clone(flags),
        verdicts: clone(verdicts),
        score,
        real: real.length,
        found,
        missed,
        falseAlarms,
        started: prev?.started || new Date().toISOString(),
        date: prev?.done && prev.date ? prev.date : new Date().toISOString(),
        done: true,
      };
    });

    const msg = scoreMessage(score, falseAlarms.length);
    const advice = nbsp(adviceFor({ score, missedCats, nFalse: falseAlarms.length, nFound: found.length, nNotes, nMarked: idx.length }));
    const tier = score === null || score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low';
    const hist = scoreHistory()
      .filter((h) => db().games.some((g) => g.id === h.id))
      .slice(-6);
    const best = (i) => r.evals[i]?.pv?.[0];
    const bestSan = (i) => (best(i) ? fig(uciToSan(fens[i], best(i))) : '');
    const linesOf = (e) => (e?.pv?.length ? [{ pv: e.pv, white: e.white }] : []);
    const explain = (i) => md(explainMistake(fens[i], uciOf(moves[i]), linesOf(r.evals[i]), linesOf(r.evals[i + 1])).join('\n'));
    const noteHtml = (i) => (flags[i]?.note?.trim() ? `<p class="sr-note">Ta note : « ${esc(flags[i].note.trim())} »</p>` : '');
    const itemHead = (i, ico, kind) =>
      `<div class="sr-item-head"><span class="sr-ico ${kind}">${ico}</span><b>${esc(moveLabel(i))}</b>${classBadge(r.classes[i])}${flags[i] ? `<span class="sr-mine" title="tes marques">${fullMarks(flags[i])}</span>` : ''}</div>`;
    const tools = (i, withReview = true) =>
      `<div class="row wrap sr-tools"><button class="btn small ghost" data-view="${i}">👁 Voir la position</button>${withReview ? `<a class="btn small ghost" href="#/review/${encodeURIComponent(game.id)}/${i}">Voir dans le bilan</a>` : ''}</div><div class="sr-viewer" hidden></div>`;

    const foundHtml = found
      .map(
        (i) => `<div class="sr-item">${itemHead(i, '✓', 'found')}${noteHtml(i)}
          <p class="small">Bien vu ! Stockfish confirme.${bestSan(i) && best(i) !== uciOf(moves[i]) ? ` Il fallait jouer <b>${esc(bestSan(i))}</b>.` : ''}</p>
          <details class="sr-why"><summary>Pourquoi c’était une erreur ?</summary><div class="sr-explain">${explain(i)}</div></details>
          ${tools(i)}</div>`,
      )
      .join('');
    const missedHtml = missed
      .map((i) => {
        const near = flags[i]?.critical
          ? 'Tu avais marqué ce coup comme « moment critique » : tu sentais que c’était important, c’est déjà bien.'
          : flags[i - 2]?.error
            ? 'Tu avais marqué ton coup d’avant : tu n’étais pas loin !'
            : flags[i + 2]?.error
              ? 'Tu avais marqué ton coup d’après : tu n’étais pas loin !'
              : '';
        return `<div class="sr-item">${itemHead(i, '✗', 'missed')}${noteHtml(i)}${near ? `<p class="small good-txt">${esc(near)}</p>` : ''}
          <div class="sr-explain">${explain(i)}</div>
          ${tools(i)}</div>`;
      })
      .join('');
    const falseHtml = falseAlarms
      .map((i) => {
        const cls = r.classes[i];
        const other = bestSan(i) && best(i) !== uciOf(moves[i]) ? bestSan(i) : '';
        const tag = r.tags?.[i];
        const txt =
          cls === 'inaccuracy'
            ? `Pas une vraie erreur, mais tu avais raison de douter : c’était une petite imprécision.${other ? ` Stockfish préférait <b>${esc(other)}</b>.` : ''}`
            : tag === 'brilliant'
              ? 'Au contraire : c’était un <b>coup brillant</b>, un sacrifice juste ! Fais confiance à tes idées.'
              : tag === 'great'
                ? 'Au contraire : c’était un <b>coup fort</b>, le seul bon coup de la position. Fais confiance à ton jeu.'
                : `${cls === 'book' ? 'C’était un coup de théorie' : 'Ton coup était bon'} : fais confiance à ton jeu ici.${other ? ` <span class="muted">(Il préférait ${esc(other)}, mais la différence est minime.)</span>` : ''}`;
        return `<div class="sr-item">${itemHead(i, '!', 'false')}${noteHtml(i)}<p class="small">${txt}</p>${tools(i, false)}</div>`;
      })
      .join('');
    const propHtml = proposals
      .map((i) => {
        const v = verdicts[i];
        // la note n'apparaît dans aucune autre section : on la montre ici
        const note = !flags[i].error && !flags[i].critical && !real.includes(i) ? noteHtml(i) : '';
        return `<div class="sr-item">${itemHead(i, '💡', 'prop')}${note}
          <p class="small">À la place de ${esc(fig(moves[i].san))}, tu proposais <b>${esc(fig(uciToSan(fens[i], flags[i].proposal)))}</b>.</p>
          <div data-prop="${i}">${v ? proposalHtml(i, v) : '<p class="muted small sr-wait">Stockfish examine ton idée…</p>'}</div>
          ${tools(i, false)}</div>`;
      })
      .join('');
    const critVerdicts = new Map(criticals.map((i) => [i, criticalVerdict(i)]));
    const critHtml = criticals
      .map((i) => {
        const v = critVerdicts.get(i);
        return `<div class="sr-item">${itemHead(i, '⚡', v.ok ? 'found' : 'calm')}${noteHtml(i)}<p class="small">${esc(v.text)}</p>${tools(i, false)}</div>`;
      })
      .join('');
    const critOk = [...critVerdicts.values()].filter((v) => v.ok).length;
    const notesHtml = notesOnly.map((i) => `<div class="sr-item">${itemHead(i, '✎', 'calm')}${noteHtml(i)}</div>`).join('');

    root.innerHTML = `<div class="sr-results">
      ${headHtml(2)}
      <section class="card sr-score sr-t-${tier}">
        <div class="sr-score-row">
          <div class="sr-ring" style="--p:${score ?? 100}"><div><b>${score === null ? '✓' : score + PCT}</b><small>lucidité</small></div></div>
          <div>
            <h2>${esc(nbsp(msg.title))}</h2>
            <p>${
              real.length === 1
                ? `${found.length ? 'Tu as repéré' : 'Tu n’as pas repéré'} <b>ton erreur</b> de la partie (selon Stockfish, une seule erreur ou gaffe).`
                : real.length
                  ? `Tu as repéré <b>${found.length}</b> de tes <b>${real.length}</b> erreurs (erreurs et gaffes selon Stockfish).`
                  : 'Aucune erreur ni gaffe à trouver dans cette partie.'
            }</p>
          </div>
        </div>
        <p>${esc(nbsp(msg.text))}</p>
        <div class="sr-tip">${md('**Conseil :** ' + advice)}</div>
        <div class="sr-kpis">
          <div class="found"><b>${found.length}</b><small>trouvée${found.length > 1 ? 's' : ''}</small></div>
          <div class="missed"><b>${missed.length}</b><small>manquée${missed.length > 1 ? 's' : ''}</small></div>
          <div class="false"><b>${falseAlarms.length}</b><small>fausse${falseAlarms.length > 1 ? 's' : ''} alerte${falseAlarms.length > 1 ? 's' : ''}</small></div>
        </div>
        ${
          hist.length >= 2 && score !== null
            ? `<p class="small muted sr-trend">Tes dernières auto-analyses : ${hist.map((h) => `<span class="${h.id === game.id ? 'cur' : ''}">${h.score}${PCT}</span>`).join(' → ')}</p>`
            : ''
        }
      </section>
      ${found.length ? `<section class="card"><h2>✓ Erreurs trouvées <span class="muted">(${found.length})</span></h2>${foundHtml}</section>` : ''}
      ${
        missed.length
          ? `<section class="card"><h2>✗ Erreurs manquées <span class="muted">(${missed.length})</span></h2><p class="small muted">Celles-ci t’ont échappé : ce sont les plus importantes à comprendre.</p>${missedHtml}</section>`
          : ''
      }
      ${
        falseAlarms.length
          ? `<section class="card"><h2>Fausses alertes <span class="muted">(${falseAlarms.length})</span></h2><p class="small muted">Tu pensais t’être trompé, mais Stockfish n’y voit ni erreur ni gaffe.</p>${falseHtml}</section>`
          : ''
      }
      ${proposals.length ? `<section class="card"><h2>💡 Tes idées <span class="muted">(${proposals.length})</span></h2>${propHtml}</section>` : ''}
      ${
        criticals.length
          ? `<section class="card"><h2>⚡ Tes moments critiques <span class="muted">(${critOk}/${criticals.length} confirmé${critOk > 1 ? 's' : ''})</span></h2>${critHtml}</section>`
          : ''
      }
      ${notesOnly.length ? `<section class="card"><h2>✎ Tes autres notes</h2>${notesHtml}</section>` : ''}
      <section class="card sr-end">
        <a class="btn block" href="#/review/${encodeURIComponent(game.id)}">📊 Bilan complet de la partie</a>
        ${real.length ? '<a class="btn block" href="#/puzzles/mistakes">🎯 Retravailler mes erreurs</a>' : ''}
        <div class="row wrap">
          <button class="btn ghost small" id="sr-restart">🔁 Recommencer l’auto-analyse</button>
          <a class="btn ghost small" href="${LIST_HASH}">Analyser une autre partie</a>
        </div>
      </section></div>`;

    const wrap = root.querySelector('.sr-results');
    wrap.querySelector('#sr-restart').onclick = restart;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) toggleViewer(b);
    });

    // verdicts du moteur sur les idées proposées (calculés une seule fois, puis gardés)
    const todo = proposals.filter((i) => !verdicts[i]);
    if (!todo.length) return;
    const c = new AbortController();
    ctrl = c;
    (async () => {
      for (const i of todo) {
        let v = null;
        try {
          v = await evalProposal(i, flags[i].proposal, c.signal);
        } catch (err) {
          console.warn(err);
        }
        if (!alive || c.signal.aborted || phase !== 'results') return;
        const slot = wrap.querySelector(`[data-prop="${i}"]`);
        if (!v) {
          if (slot) slot.innerHTML = '<p class="muted small">Vérification impossible pour cette idée.</p>';
          continue;
        }
        verdicts[i] = v;
        update((d) => {
          const e = d.selfReviews?.[game.id];
          if (e) e.verdicts = clone(verdicts);
        });
        if (slot) slot.innerHTML = proposalHtml(i, v);
      }
    })();
  }

  /** Petit échiquier sous un élément de résultat : position avant le coup, avec ton coup, celui de Stockfish et ton idée. */
  function toggleViewer(btn) {
    const slot = btn.closest('.sr-item')?.querySelector('.sr-viewer');
    if (!slot) return;
    const wasOpen = viewerBtn === btn;
    closeViewer();
    if (wasOpen) return;
    const i = +btn.dataset.view;
    const played = uciOf(moves[i]);
    const best = rev?.evals?.[i]?.pv?.[0];
    const prop = flags[i]?.proposal;
    const shapes = [arrow(played, 'red')];
    const legend = [`<span class="sr-key red"></span>ton coup (${esc(fig(moves[i].san))})`];
    if (best && best !== played) {
      shapes.push(arrow(best, 'green'));
      legend.push(`<span class="sr-key green"></span>Stockfish (${esc(fig(uciToSan(fens[i], best)))})`);
    }
    if (prop && prop !== best) {
      shapes.push(arrow(prop, 'blue'));
      legend.push(`<span class="sr-key blue"></span>ton idée (${esc(fig(uciToSan(fens[i], prop)))})`);
    } else if (prop) legend.push('ton idée = le coup de Stockfish');
    slot.hidden = false;
    slot.innerHTML = `<div class="board-row"><div class="board-box"></div></div><p class="small sr-legend">${legend.join('<span class="sr-sep"> · </span>')}</p>`;
    viewer = createBoard(slot.querySelector('.board-box'), { orientation: cgColor(me) });
    viewer.setPosition(new Chess(fens[i]), { lastMove: i > 0 ? uciOf(moves[i - 1]) : undefined });
    viewer.setShapes(shapes);
    btn.textContent = '✕ Fermer l’échiquier';
    viewerBtn = btn;
  }

  function closeViewer() {
    viewer?.destroy();
    viewer = null;
    for (const s of root.querySelectorAll('.sr-viewer')) {
      s.hidden = true;
      s.innerHTML = '';
    }
    if (viewerBtn) viewerBtn.textContent = '👁 Voir la position';
    viewerBtn = null;
  }

  // ─────────────── Démarrage ───────────────

  if (saved?.done) showIntro();
  else {
    if (flaggedIdx().length) toast('On reprend ton auto-analyse là où tu l’avais laissée.');
    showStep1();
  }

  return () => {
    alive = false;
    // une note en cours de frappe n'est pas perdue
    if (noteTimer && phase === 'step1') saveDraft();
    teardown();
  };
}

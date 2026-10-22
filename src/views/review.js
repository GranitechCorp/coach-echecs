// Bilan de partie : précision, Elo estimé, classification de chaque coup (avec coups brillants,
// coups forts et occasions manquées comme sur chess.com), moments clés, explications.
import { Chess } from 'chess.js';
import { db, update, uid } from '../storage.js';
import { setTitle, esc, md, toast, moveListHtml, classBadge } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { getAnalysisEngine } from '../engine.js';
import { parsePgn, uciOf, winPct, evalText, pvToSan, fig, uciToSan, cgColor } from '../chessutil.js';
import { explainMistake, describeMove, CLASSES, TAGS, tagCount, explainBrilliant, explainGreat, explainMiss, explainAlternative } from '../explain.js';
import { promptPlayedMove, promptGameSummary } from '../prompts.js';
import { showCoach } from './coach-panel.js';
import { askCoach, coachReady } from '../coach-ai.js';
import { analyzeGame, saveReview, cpOfEval, ensureDerived, ensureReviewExtras, sacrificeOf, REVIEW_VERSION } from '../analyzer.js';
import { startGame } from './game.js';
import { aiEnabled, gameSummaryLocal } from '../local-coach.js';
import { frOpening } from '../data/opening-names.js';

export const tab = 'profile';
const DEPTH = 12;

/** Badge d'étiquette (coup brillant, coup fort, occasion manquée). */
const tagBadge = (t) => (TAGS[t] ? `<span class="badge ri-tag ri-${TAGS[t].css}"><b>${TAGS[t].sym}</b> ${TAGS[t].label}</span>` : '');

export function render(root, id, startIdx) {
  const s = db();
  const game = s.games.find((x) => x.id === id);
  if (!game) {
    root.innerHTML = '<p class="card">Partie introuvable.</p>';
    return;
  }
  setTitle('Bilan de la partie', game.source === 'bot' ? '#/' : '#/analysis');
  const parsed = parsePgn(game.pgn);
  if (!parsed) {
    root.innerHTML = '<p class="card error">PGN illisible.</p>';
    return;
  }
  const { headers, moves, startFen } = parsed;
  const fens = [startFen, ...moves.map((m) => m.after)];
  const sans = moves.map((m) => m.san);
  game.sans = sans;
  const engine = getAnalysisEngine();
  const startNo = new Chess(startFen).moveNumber();
  const startTurn = new Chess(startFen).turn();
  let alive = true;
  let board = null;
  let altCtrl = null; // recherche en cours pour illustrer un « coup fort »

  function startAnalysis() {
    altCtrl?.abort();
    altCtrl = null;
    board?.destroy();
    board = null;
    root.innerHTML = `
      <section class="card">
        <h2>Analyse en cours…</h2>
        <p class="muted">Stockfish examine chaque coup (${moves.length} demi-coups). Garde l’écran allumé, ça prend environ ${Math.max(1, Math.round((moves.length * 0.9) / 60))} min.</p>
        <div class="progress"><div id="prog" style="width:0%"></div></div>
        <p class="small muted" id="prog-txt"></p>
      </section>`;
    analyzeGame(game, {
      depth: DEPTH,
      isAlive: () => alive,
      onProgress: (i, n) => {
        const bar = root.querySelector('#prog');
        if (!bar) return;
        bar.style.width = Math.round((i / n) * 100) + '%';
        root.querySelector('#prog-txt').textContent = `${i} / ${n} positions`;
      },
    })
      .then((review) => {
        if (!alive || !review) return;
        saveReview(game, review);
        game.review = review;
        showReview(true);
      })
      .catch((err) => {
        console.warn(err);
        if (alive) root.innerHTML = '<section class="card"><p class="error">L’analyse n’a pas pu aboutir. Reviens en arrière et réessaie.</p></section>';
      });
  }

  if (!game.review?.evals || game.review.n !== moves.length) startAnalysis();
  else showReview(false);

  function showReview(fresh) {
    const r = game.review;
    // anciens bilans : étiquettes, Elo estimé et données dérivées recalculés sans moteur
    const derivedV = r.derived?.v;
    const changed = ensureReviewExtras(r, fens, moves);
    ensureDerived(game);
    if (changed || derivedV !== r.derived?.v) update(() => {});
    const me = game.userColor;
    const them = me === 'w' ? 'b' : 'w';
    const cpOf = cpOfEval;
    const tags = r.tags || [];
    const elo = r.elo || {};
    const order = ['best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
    const keyIdx = r.classes.map((c, i) => i).filter((i) => moves[i].color === me && ['mistake', 'blunder'].includes(r.classes[i]));
    const mineTagged = (t) => tags.map((x, i) => (x === t && moves[i].color === me ? i : -1)).filter((i) => i >= 0);
    const tagIdx = { brilliant: mineTagged('brilliant'), great: mineTagged('great'), miss: mineTagged('miss') };
    const legacy = (r.v || 0) < REVIEW_VERSION && !r.evals.some((e) => e.second);
    const numOf = (i) => `${Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2) + startNo}${moves[i].color === 'w' ? '.' : '…'}`;

    // courbe d'évaluation
    const W = 320;
    const H = 70;
    const xOf = (k) => (k / Math.max(1, r.evals.length - 1)) * W;
    const yOf = (k) => Math.max(4, Math.min(H - 4, H - (winPct(cpOf(r.evals[k])) / 100) * H)); // repères toujours visibles
    const pts = r.evals.map((e, i) => `${xOf(i)},${H - (winPct(cpOf(e)) / 100) * H}`).join(' ');
    const marks = keyIdx.map((i) => `<circle cx="${xOf(i + 1)}" cy="${yOf(i + 1)}" r="4" class="mk-${r.classes[i]}" data-i="${i}"/>`).join('');
    const tagMarks = [...tagIdx.brilliant, ...tagIdx.great].map((i) => `<circle cx="${xOf(i + 1)}" cy="${yOf(i + 1)}" r="4" class="ri-mk-${tags[i]}" data-i="${i}"/>`).join('');
    const eloLine = (v, mine) => (v ? `<div class="ri-elo${mine ? '' : ' muted'}">Elo estimé ≈ <b>${v}</b></div>` : '');
    const acplMe = r.acpl?.[me];

    root.innerHTML = `
      <section class="card">
        <div class="row between"><b>${esc(headers.White || '?')} – ${esc(headers.Black || '?')}</b><span class="badge">${esc(headers.Result || game.result || '')}</span></div>
        ${r.opening ? `<p class="muted small">📖 ${esc(frOpening(r.opening))}</p>` : ''}
        <div class="acc-row">
          <div><div class="big">${Math.round(r.accuracy[me])}%</div><div class="muted small">ta précision</div>${eloLine(elo[me], true)}</div>
          <div><div class="big muted">${Math.round(r.accuracy[them])}%</div><div class="muted small">adversaire</div>${eloLine(elo[them], false)}</div>
        </div>
        ${elo[me] ? `<details class="ri-help small"><summary>D’où vient l’Elo estimé ?</summary>
          <p>C’est une estimation <b>indicative</b>, calculée comme le « Game Rating » de chess.com : Stockfish mesure combien chaque coup fait perdre${acplMe !== null && acplMe !== undefined ? ` (pour toi, en moyenne ${acplMe} centipions par coup, soit ${(acplMe / 100).toFixed(1).replace('.', ',')} pion${acplMe >= 200 ? 's' : ''})` : ''}. Moins tu perds, plus l’estimation est haute.</p>
          <p class="muted">Sur une seule partie, ça varie beaucoup : regarde plutôt la tendance dans « Mes progrès ».</p>
        </details>` : ''}
        <div class="counts">${['brilliant', 'great', 'miss']
          .filter((t) => tagIdx[t].length)
          .map((t) => `<span class="badge ri-tag ri-${TAGS[t].css}"><b>${TAGS[t].sym}</b> ${tagCount(t, tagIdx[t].length)}</span>`)
          .join('')}${order
          .filter((c) => r.counts[me][c])
          .map((c) => `<span class="badge c-${CLASSES[c].css}">${CLASSES[c].sym} ${r.counts[me][c]} ${(r.counts[me][c] > 1 ? CLASSES[c].plural : CLASSES[c].label).toLowerCase()}</span>`)
          .join('')}</div>
        <svg class="graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H / 2}" class="g-black"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="g-mid"/><polyline points="${pts}" class="g-line"/>${marks}${tagMarks}</svg>
        <div class="row wrap">
          ${keyIdx.length ? `<button class="btn small" id="first-key">🎯 Voir mes erreurs (${keyIdx.length})</button>` : '<span class="muted small">Aucune grosse erreur : bravo !</span>'}
          ${tagIdx.brilliant.length ? `<button class="btn small ri-btn-brilliant" id="ri-brilliant">💎 Mes coups brillants (${tagIdx.brilliant.length})</button>` : ''}
          ${tagIdx.great.length ? `<button class="btn small ri-btn-great" id="ri-great"><b>!</b> Mes coups forts (${tagIdx.great.length})</button>` : ''}
          <a class="btn small ghost" href="#/selfreview/${encodeURIComponent(game.id)}">🧠 Auto-analyse</a>
          ${aiEnabled() ? '<button class="btn ai small" id="ai-summary">✨ Bilan rédigé par Claude</button>' : ''}
        </div>
        ${legacy ? `<p class="small muted ri-legacy">Ce bilan date d’une version précédente : les coups forts n’y sont pas encore repérés. <button class="btn ghost small" id="ri-reanalyze">⟳ Mettre à jour l’analyse</button></p>` : ''}
        <div class="coach-local">${md(gameSummaryLocal(game, r, sans).join('\n'))}</div>
        <div class="coach" id="summary" hidden></div>
      </section>
      <div class="board-row"><div class="board-box" id="board"></div></div>
      <div class="nav">
        <button class="btn" data-nav="first" aria-label="Début">⏮</button><button class="btn" data-nav="prev" aria-label="Coup précédent">◀</button>
        <button class="btn" data-nav="next" aria-label="Coup suivant">▶</button><button class="btn" data-nav="last" aria-label="Fin">⏭</button>
        <button class="btn" data-nav="key" aria-label="Erreur suivante">🎯</button>
      </div>
      <div class="coach ri-coach" id="coach"></div>
      <div class="moves card" id="moves"></div>`;

    board = createBoard(root.querySelector('#board'), { orientation: cgColor(me) });
    const coachEl = root.querySelector('#coach');
    const movesEl = root.querySelector('#moves');
    let cur = -1;

    /** Liste des coups avec les symboles !!, ! et ✗ à la place du symbole de classe. */
    function renderMoves() {
      movesEl.innerHTML = moveListHtml(moves.map((m, k) => ({ san: m.san, cls: r.classes[k] })), cur, startNo, startTurn);
      tags.forEach((t, k) => {
        if (!TAGS[t]) return;
        const b = movesEl.querySelector(`.mv[data-i="${k}"]`);
        if (!b) return;
        b.querySelector('sup')?.remove();
        b.classList.add('ri-mv-' + TAGS[t].css);
        b.insertAdjacentHTML('beforeend', `<sup class="ri-sup ri-${TAGS[t].css}">${TAGS[t].sym}</sup>`);
      });
    }

    function show(i) {
      cur = Math.max(-1, Math.min(moves.length - 1, i));
      altCtrl?.abort();
      altCtrl = null;
      const c = new Chess(fens[cur + 1]);
      board.setPosition(c, { lastMove: cur >= 0 ? uciOf(moves[cur]) : undefined });
      renderMoves();
      // fait défiler la liste des coups seulement (sans faire sauter la page)
      const curEl = movesEl.querySelector('.cur');
      if (curEl) {
        const a = curEl.getBoundingClientRect();
        const z = movesEl.getBoundingClientRect();
        movesEl.scrollTop += a.top - z.top - (movesEl.clientHeight - a.height) / 2;
      }
      coachEl.classList.remove('ri-is-brilliant', 'ri-is-great', 'ri-is-miss');
      if (cur < 0) {
        board.setShapes([]);
        coachEl.innerHTML = `<p class="muted">Position de départ. Utilise ▶ ou 🎯 pour aller aux moments clés.</p>`;
        return;
      }
      const m = moves[cur];
      const cls = r.classes[cur];
      const tag = tags[cur];
      const mine = m.color === me;
      const before = r.evals[cur];
      const after = r.evals[cur + 1];
      const played = uciOf(m);
      const brush = tag === 'brilliant' || tag === 'great' ? 'blue' : ['mistake', 'blunder'].includes(cls) ? 'red' : cls === 'inaccuracy' ? 'yellow' : 'blue';
      const shapes = [arrow(played, brush)];
      if (before.pv[0] && before.pv[0] !== played) shapes.push(arrow(before.pv[0], 'green'));
      board.setShapes(shapes);
      if (TAGS[tag]) coachEl.classList.add('ri-is-' + TAGS[tag].css);
      const who = mine ? 'Ton coup' : 'Coup adverse';
      const num = numOf(cur);
      const linesB = before.pv.length ? [{ pv: before.pv, white: before.white }] : [];
      const linesA = after.pv.length ? [{ pv: after.pv, white: after.white }] : [];
      let paras;
      if (tag === 'brilliant') {
        paras = explainBrilliant(fens[cur], played, before, after, sacrificeOf(fens[cur], played, after.pv, m.color, fens[cur + 1]), mine);
      } else if (tag === 'great') {
        paras = explainGreat(fens[cur], played, before, mine);
      } else if (tag === 'miss') {
        const prev = moves[cur - 1];
        paras = explainMiss(fens[cur], played, { san: prev?.san, cls: r.classes[cur - 1], num: cur > 0 ? numOf(cur - 1) : '' }, before, after, mine);
        if (mine) {
          const rest = explainMistake(fens[cur], played, linesB, linesA, { withBest: false }).slice(1);
          if (rest.length) paras.push('#### Ce que ton coup permet', ...rest);
        }
      } else if (['inaccuracy', 'mistake', 'blunder'].includes(cls)) paras = explainMistake(fens[cur], played, linesB, linesA);
      else if (cls === 'book') paras = [`Coup de théorie (${frOpening(r.opening) || 'ouverture'}).`];
      else {
        const facts = describeMove(fens[cur], played).facts;
        paras = [...facts.map((f) => '• ' + f)];
        if (before.pv[0] && before.pv[0] !== played) paras.push(`Le moteur préférait ${fig(uciToSan(fens[cur], before.pv[0]))}.`);
        if (!paras.length) paras.push('Coup solide.');
      }
      paras.push(`*Évaluation : ${evalText(before)} → ${evalText(after)}*`);
      showCoach(coachEl, {
        title: `${who} ${num}${fig(m.san)} ${classBadge(cls)}${tagBadge(tag)}`,
        paragraphs: paras,
        getPrompt: async () => {
          const deep = await engine.search(fens[cur], { depth: 14, multipv: 3 });
          const deepAfter = await engine.search(fens[cur + 1], { depth: 13 });
          return promptPlayedMove({ fen: fens[cur], playedUci: played, linesBefore: deep.lines, linesAfter: deepAfter.lines, userColor: m.color, history: sans.slice(0, cur), cls: CLASSES[cls].label });
        },
      });
      const extra = document.createElement('div');
      extra.className = 'row wrap';
      extra.innerHTML = `<button class="btn small" data-act="replay">♟ Rejouer d’ici contre l’ordi</button><a class="btn ghost small" href="#/board/${encodeURIComponent(fens[cur])}">🔍 Explorer</a>`;
      coachEl.appendChild(extra);
      extra.querySelector('[data-act=replay]').onclick = () => {
        const c2 = new Chess(fens[cur]);
        startGame({ startFen: fens[cur], userColor: c2.turn(), elo: game.botElo || 1200, liveCoach: true, showEval: false });
      };
      // coup fort : on montre ce que donnait concrètement une autre option (calculé à la demande)
      if (tag === 'great') {
        const ctrl = new AbortController();
        altCtrl = ctrl;
        const at = cur;
        engine
          .search(fens[at], { depth: DEPTH, multipv: 2, signal: ctrl.signal })
          .then((res) => {
            if (!alive || ctrl.signal.aborted || res.aborted || cur !== at) return;
            const alt = res.lines.find((l) => l.pv?.[0] && l.pv[0] !== played);
            const txt = coachEl.querySelector('.coach-txt');
            if (!alt || !txt) return;
            // seulement si cette autre option est vraiment moins bonne (le calcul en direct peut différer du bilan)
            const sign = m.color === 'w' ? 1 : -1;
            if (winPct(cpOfEval(before) * sign) - winPct(cpOfEval(alt) * sign) < 5) return;
            txt.insertAdjacentHTML('beforeend', `<div class="ri-alt">${md(explainAlternative(fens[at], alt).join('\n'))}</div>`);
          })
          .catch(() => {});
      }
    }

    /** Va au prochain coup de la liste (en boucle). */
    const cycle = (list) => {
      const next = list.find((i) => i > cur) ?? list[0];
      if (next === undefined) return;
      show(next);
      root.querySelector('#board').scrollIntoView({ behavior: 'smooth' });
    };

    root.querySelector('.nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      const a = b.dataset.nav;
      if (a === 'first') show(-1);
      else if (a === 'prev') show(cur - 1);
      else if (a === 'next') show(cur + 1);
      else if (a === 'last') show(moves.length - 1);
      else if (a === 'key') {
        const next = keyIdx.find((i) => i > cur) ?? keyIdx[0];
        if (next === undefined) toast('Aucune erreur importante dans cette partie.');
        else show(next);
      }
    });
    movesEl.addEventListener('click', (e) => {
      const b = e.target.closest('.mv');
      if (b) show(+b.dataset.i);
    });
    root.querySelector('.graph').addEventListener('click', (e) => {
      const svg = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - svg.left) / svg.width;
      show(Math.round(x * (r.evals.length - 1)) - 1);
    });
    root.querySelector('#first-key')?.addEventListener('click', () => {
      show(keyIdx[0]);
      root.querySelector('#board').scrollIntoView({ behavior: 'smooth' });
    });
    root.querySelector('#ri-brilliant')?.addEventListener('click', () => cycle(tagIdx.brilliant));
    root.querySelector('#ri-great')?.addEventListener('click', () => cycle(tagIdx.great));
    root.querySelector('#ri-reanalyze')?.addEventListener('click', () => startAnalysis());
    const aiBtn = root.querySelector('#ai-summary');
    if (aiBtn) aiBtn.onclick = async (e) => {
      if (!coachReady()) return toast('Ajoute ta clé API Claude dans les Réglages (⚙︎) pour le bilan IA.', 4000);
      const out = root.querySelector('#summary');
      out.hidden = false;
      out.innerHTML = '<p class="muted">Le coach prépare ton bilan…</p>';
      e.target.disabled = true;
      const moments = [...keyIdx]
        .sort((a, b) => Math.abs(cpOf(r.evals[b]) - cpOf(r.evals[b + 1])) - Math.abs(cpOf(r.evals[a]) - cpOf(r.evals[a + 1])))
        .slice(0, 4)
        .sort((a, b) => a - b)
        .map((i) => ({
          label: `${Math.floor(i / 2) + 1}${moves[i].color === 'w' ? '.' : '...'}`,
          played: moves[i].san,
          cls: CLASSES[r.classes[i]].label,
          best: uciToSan(fens[i], r.evals[i].pv[0]),
          evalBefore: evalText(r.evals[i]),
          evalAfter: evalText(r.evals[i + 1]),
          refutation: pvToSan(fens[i + 1], r.evals[i + 1].pv, 5, true),
        }));
      try {
        await askCoach(promptGameSummary({ game: { ...game, sans }, review: r, moments, opening: r.opening }), {
          effort: 'medium',
          onText: (t) => (out.innerHTML = md(t)),
        });
      } catch (err) {
        out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
        e.target.disabled = false;
      }
    };

    if (startIdx !== undefined && startIdx !== null) show(+startIdx);
    else show(keyIdx.length ? keyIdx[0] : -1);
    if (fresh && tagIdx.brilliant.length) toast(`💎 ${tagCount('brilliant', tagIdx.brilliant.length)} dans cette partie !`, 3500);
  }

  return () => {
    alive = false;
    altCtrl?.abort();
    board?.destroy();
  };
}

/** Enregistre une partie importée (PGN) et renvoie son id. */
export function importGame({ pgn, userColor, label, source = 'import', result }) {
  const id = uid();
  update((s) => {
    s.games.push({ id, date: new Date().toISOString(), pgn, userColor, result: result || '', source, label });
    if (s.games.length > 200) s.games.splice(0, s.games.length - 200);
  });
  return id;
}

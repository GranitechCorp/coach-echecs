// Bilan de partie : précision, classification de chaque coup, moments clés, explications.
import { Chess } from 'chess.js';
import { db, update, uid } from '../storage.js';
import { setTitle, esc, md, toast, moveListHtml, classBadge } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { getAnalysisEngine } from '../engine.js';
import { parsePgn, uciOf, cpWhite, winPct, evalText, pvToSan, fig, uciToSan, cgColor } from '../chessutil.js';
import { classifyMove, explainMistake, describeMove, CLASSES } from '../explain.js';
import { promptPlayedMove, promptGameSummary } from '../prompts.js';
import { showCoach } from './coach-panel.js';
import { askCoach, coachReady } from '../coach-ai.js';
import { OPENING_LINES, parseLine } from '../data/openings.js';
import { startGame } from './game.js';

export const tab = 'analysis';
const DEPTH = 12;

/** Trouve la ligne de répertoire qui colle le plus longtemps à la partie. */
function matchOpening(sans) {
  let best = { len: 0, line: null };
  for (const line of OPENING_LINES) {
    const moves = parseLine(line.moves).map((m) => m.san);
    let k = 0;
    while (k < moves.length && k < sans.length && moves[k] === sans[k]) k++;
    if (k > best.len) best = { len: k, line };
  }
  return best;
}

function openingName(headers, match) {
  if (match.len >= 4) return match.line.name;
  if (headers.Opening) return headers.Opening;
  if (headers.ECOUrl) return decodeURIComponent(headers.ECOUrl.split('/').pop()).replace(/-/g, ' ');
  return '';
}

export function render(root, id) {
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
  let alive = true;
  let board = null;

  if (!game.review || game.review.n !== moves.length) {
    root.innerHTML = `
      <section class="card">
        <h2>Analyse en cours…</h2>
        <p class="muted">Stockfish examine chaque coup (${moves.length} demi-coups). Garde l’écran allumé, ça prend environ ${Math.max(1, Math.round(moves.length * 0.6 / 60))} min.</p>
        <div class="progress"><div id="prog" style="width:0%"></div></div>
        <p class="small muted" id="prog-txt"></p>
      </section>`;
    runAnalysis().then((review) => {
      if (!alive || !review) return;
      update((d) => {
        const gg = d.games.find((x) => x.id === id);
        if (gg) gg.review = review;
        // les erreurs de l'utilisateur deviennent des exercices personnels
        for (const [i, cls] of review.classes.entries()) {
          if (fens[i].split(' ')[1] !== game.userColor || !['mistake', 'blunder'].includes(cls)) continue;
          if (d.mistakes.some((m) => m.fen === fens[i])) continue;
          d.mistakes.push({ id: uid(), fen: fens[i], best: review.evals[i].pv[0], played: uciOf(moves[i]), gameId: id, box: 0, due: Date.now(), label: `${game.label || ''} — coup ${Math.floor(i / 2) + 1}` });
        }
        if (d.mistakes.length > 300) d.mistakes.splice(0, d.mistakes.length - 300);
      });
      game.review = review;
      showReview();
    });
  } else {
    showReview();
  }

  async function runAnalysis() {
    const evals = [];
    for (let i = 0; i < fens.length; i++) {
      if (!alive) return null;
      const c = new Chess(fens[i]);
      if (c.isGameOver()) {
        evals.push({ pv: [], white: c.isCheckmate() ? { mate: 0 } : { cp: 0 }, over: c.isCheckmate() ? (c.turn() === 'w' ? 'b' : 'w') : 'draw' });
      } else {
        const r = await engine.search(fens[i], { depth: DEPTH });
        const l = r.lines[0];
        evals.push({ pv: (l?.pv || [r.bestmove]).slice(0, 8), white: l?.white || { cp: 0 } });
      }
      const pct = Math.round(((i + 1) / fens.length) * 100);
      const bar = root.querySelector('#prog');
      if (bar) {
        bar.style.width = pct + '%';
        root.querySelector('#prog-txt').textContent = `${i + 1} / ${fens.length} positions`;
      }
    }
    const cpOf = (e) => (e.over ? (e.over === 'w' ? 10000 : e.over === 'b' ? -10000 : 0) : cpWhite(e));
    const match = matchOpening(sans);
    const classes = [];
    const acc = { w: [], b: [] };
    const counts = { w: {}, b: {} };
    moves.forEach((m, i) => {
      const color = m.color;
      const res = classifyMove({ cpBefore: cpOf(evals[i]), cpAfter: cpOf(evals[i + 1]), color, isBest: evals[i].pv[0] === uciOf(m) });
      let cls = res.cls;
      if (i < match.len && res.loss < 5) cls = 'book';
      classes.push(cls);
      acc[color].push(res.accuracy);
      counts[color][cls] = (counts[color][cls] || 0) + 1;
    });
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 100);
    return {
      n: moves.length,
      depth: DEPTH,
      evals,
      classes,
      counts,
      accuracy: { w: avg(acc.w), b: avg(acc.b) },
      opening: openingName(headers, match),
      bookLen: match.len,
    };
  }

  function showReview() {
    const r = game.review;
    const me = game.userColor;
    const them = me === 'w' ? 'b' : 'w';
    const cpOf = (e) => (e.over ? (e.over === 'w' ? 10000 : e.over === 'b' ? -10000 : 0) : cpWhite(e));
    const order = ['best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
    const keyIdx = r.classes.map((c, i) => i).filter((i) => moves[i].color === me && ['mistake', 'blunder'].includes(r.classes[i]));

    // courbe d'évaluation
    const W = 320;
    const H = 70;
    const pts = r.evals.map((e, i) => `${(i / Math.max(1, r.evals.length - 1)) * W},${H - (winPct(cpOf(e)) / 100) * H}`).join(' ');
    const marks = keyIdx
      .map((i) => `<circle cx="${((i + 1) / Math.max(1, r.evals.length - 1)) * W}" cy="${H - (winPct(cpOf(r.evals[i + 1])) / 100) * H}" r="4" class="mk-${r.classes[i]}" data-i="${i}"/>`)
      .join('');

    root.innerHTML = `
      <section class="card">
        <div class="row between"><b>${esc(headers.White || '?')} – ${esc(headers.Black || '?')}</b><span class="badge">${esc(headers.Result || game.result || '')}</span></div>
        ${r.opening ? `<p class="muted small">📖 ${esc(r.opening)}</p>` : ''}
        <div class="acc-row">
          <div><div class="big">${Math.round(r.accuracy[me])}%</div><div class="muted small">ta précision</div></div>
          <div><div class="big muted">${Math.round(r.accuracy[them])}%</div><div class="muted small">adversaire</div></div>
        </div>
        <div class="counts">${order
          .filter((c) => r.counts[me][c])
          .map((c) => `<span class="badge c-${CLASSES[c].css}">${CLASSES[c].sym} ${r.counts[me][c]} ${CLASSES[c].label.toLowerCase()}</span>`)
          .join('')}</div>
        <svg class="graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H / 2}" class="g-black"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="g-mid"/><polyline points="${pts}" class="g-line"/>${marks}</svg>
        <div class="row wrap">
          ${keyIdx.length ? `<button class="btn small" id="first-key">🎯 Voir mes erreurs (${keyIdx.length})</button>` : '<span class="muted small">Aucune grosse erreur : bravo !</span>'}
          <button class="btn ai small" id="ai-summary">✨ Bilan du coach IA</button>
        </div>
        <div class="coach" id="summary" hidden></div>
      </section>
      <div class="board-row"><div class="board-box" id="board"></div></div>
      <div class="nav">
        <button class="btn" data-nav="first">⏮</button><button class="btn" data-nav="prev">◀</button>
        <button class="btn" data-nav="next">▶</button><button class="btn" data-nav="last">⏭</button>
        <button class="btn" data-nav="key">🎯</button>
      </div>
      <div class="coach" id="coach"></div>
      <div class="moves card" id="moves"></div>`;

    board = createBoard(root.querySelector('#board'), { orientation: cgColor(me) });
    const coachEl = root.querySelector('#coach');
    const movesEl = root.querySelector('#moves');
    let cur = -1;

    function show(i) {
      cur = Math.max(-1, Math.min(moves.length - 1, i));
      const c = new Chess(fens[cur + 1]);
      board.setPosition(c, { lastMove: cur >= 0 ? uciOf(moves[cur]) : undefined });
      movesEl.innerHTML = moveListHtml(moves.map((m, k) => ({ san: m.san, cls: r.classes[k] })), cur, new Chess(startFen).moveNumber(), new Chess(startFen).turn());
      movesEl.querySelector('.cur')?.scrollIntoView({ block: 'nearest', inline: 'center' });
      if (cur < 0) {
        board.setShapes([]);
        coachEl.innerHTML = `<p class="muted">Position de départ. Utilise ▶ ou 🎯 pour aller aux moments clés.</p>`;
        return;
      }
      const m = moves[cur];
      const cls = r.classes[cur];
      const before = r.evals[cur];
      const after = r.evals[cur + 1];
      const played = uciOf(m);
      const shapes = [arrow(played, ['mistake', 'blunder'].includes(cls) ? 'red' : cls === 'inaccuracy' ? 'yellow' : 'blue')];
      if (before.pv[0] && before.pv[0] !== played) shapes.push(arrow(before.pv[0], 'green'));
      board.setShapes(shapes);
      const who = m.color === me ? 'Ton coup' : 'Coup adverse';
      const num = `${Math.floor(cur / 2) + new Chess(startFen).moveNumber()}${m.color === 'w' ? '.' : '…'}`;
      const linesB = before.pv.length ? [{ pv: before.pv, white: before.white }] : [];
      const linesA = after.pv.length ? [{ pv: after.pv, white: after.white }] : [];
      let paras;
      if (['inaccuracy', 'mistake', 'blunder'].includes(cls)) paras = explainMistake(fens[cur], played, linesB, linesA);
      else if (cls === 'book') paras = [`Coup de théorie (${esc(r.opening || 'ouverture')}).`];
      else {
        const facts = describeMove(fens[cur], played).facts;
        paras = [...facts.map((f) => '• ' + f)];
        if (before.pv[0] && before.pv[0] !== played) paras.push(`Le moteur préférait ${fig(uciToSan(fens[cur], before.pv[0]))}.`);
        if (!paras.length) paras.push('Coup solide.');
      }
      paras.push(`<small>Évaluation : ${evalText(before)} → ${evalText(after)}</small>`);
      showCoach(coachEl, {
        title: `${who} ${num}${fig(m.san)} ${classBadge(cls)}`,
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
    }

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
    root.querySelector('#ai-summary').onclick = async (e) => {
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

    show(keyIdx.length ? keyIdx[0] : -1);
    if (!keyIdx.length) show(-1);
  }

  return () => {
    alive = false;
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


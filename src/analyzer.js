// Analyse d'une partie avec Stockfish + extraction des données qui servent au suivi personnalisé
// (phases, pendule, catégories d'erreurs, occasions, conversion…).
import { Chess } from 'chess.js';
import { update, uid } from './storage.js';
import { getAnalysisEngine } from './engine.js';
import { parsePgn, uciOf, cpWhite, VALUE } from './chessutil.js';
import { classifyMove, describeMove } from './explain.js';
import { OPENING_LINES, parseLine } from './data/openings.js';

export const REVIEW_VERSION = 2;

/** Trouve la ligne de répertoire qui colle le plus longtemps à la partie. */
export function matchOpening(sans) {
  let best = { len: 0, line: null };
  for (const line of OPENING_LINES) {
    const moves = parseLine(line.moves).map((m) => m.san);
    let k = 0;
    while (k < moves.length && k < sans.length && moves[k] === sans[k]) k++;
    if (k > best.len) best = { len: k, line };
  }
  return best;
}

export function openingName(headers, match) {
  if (headers.ECOUrl) return decodeURIComponent(headers.ECOUrl.split('/').pop()).replace(/-/g, ' ');
  if (match.len >= 4) return match.line.name;
  return headers.Opening || '';
}

export const cpOfEval = (e) => (e.over ? (e.over === 'w' ? 10000 : e.over === 'b' ? -10000 : 0) : cpWhite(e));

/** Score de la partie pour l'utilisateur (1, 0.5, 0). */
export function userScore(game, headers) {
  if (typeof game.score === 'number') return game.score;
  const r = headers?.Result || game.result;
  if (r === '1-0') return game.userColor === 'w' ? 1 : 0;
  if (r === '0-1') return game.userColor === 'b' ? 1 : 0;
  if (r === '1/2-1/2') return 0.5;
  return null;
}

/** Analyse complète. onProgress(i, total) ; isAlive() permet d'interrompre. */
export async function analyzeGame(game, { depth = 12, onProgress, isAlive = () => true } = {}) {
  const parsed = parsePgn(game.pgn);
  if (!parsed) throw new Error('PGN illisible');
  const { headers, moves, startFen } = parsed;
  const fens = [startFen, ...moves.map((m) => m.after)];
  const engine = getAnalysisEngine();
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    if (!isAlive()) return null;
    const c = new Chess(fens[i]);
    if (c.isGameOver()) {
      evals.push({ pv: [], white: c.isCheckmate() ? { mate: 0 } : { cp: 0 }, over: c.isCheckmate() ? (c.turn() === 'w' ? 'b' : 'w') : 'draw' });
    } else {
      const r = await engine.search(fens[i], { depth });
      const l = r.lines[0];
      evals.push({ pv: (l?.pv || [r.bestmove]).slice(0, 6), white: l?.white || { cp: 0 } });
    }
    onProgress?.(i + 1, fens.length);
  }
  const sans = moves.map((m) => m.san);
  const match = matchOpening(sans);
  const classes = [];
  const acc = { w: [], b: [] };
  const counts = { w: {}, b: {} };
  moves.forEach((m, i) => {
    const res = classifyMove({ cpBefore: cpOfEval(evals[i]), cpAfter: cpOfEval(evals[i + 1]), color: m.color, isBest: evals[i].pv[0] === uciOf(m) });
    let cls = res.cls;
    if (i < match.len && res.loss < 5) cls = 'book';
    classes.push(cls);
    acc[m.color].push(res.accuracy);
    counts[m.color][cls] = (counts[m.color][cls] || 0) + 1;
  });
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 100);
  const review = {
    v: REVIEW_VERSION,
    n: moves.length,
    depth,
    evals,
    classes,
    counts,
    accuracy: { w: avg(acc.w), b: avg(acc.b) },
    opening: openingName(headers, match),
    bookLen: match.len,
  };
  review.derived = deriveGame(game, parsed, review);
  return review;
}

// ─────────────── Données dérivées (sans moteur) ───────────────

function nonPawnMaterial(fen) {
  let t = 0;
  let queens = 0;
  for (const ch of fen.split(' ')[0]) {
    const p = ch.toLowerCase();
    if ('nbrq'.includes(p)) t += VALUE[p];
    if (p === 'q') queens++;
  }
  return { t, queens };
}

function pawnCount(fen) {
  return (fen.split(' ')[0].match(/p/gi) || []).length;
}

export function phaseOf(fen, ply) {
  const { t, queens } = nonPawnMaterial(fen);
  if (t <= 20 || (queens === 0 && t <= 26)) return 'e';
  return ply < 20 ? 'o' : 'm';
}

/** Lit les pendules [%clk 0:04:32.1] du PGN chess.com ; renvoie des secondes restantes par coup. */
function clocksOf(pgn, n) {
  const out = [];
  const re = /\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
  let m;
  while ((m = re.exec(pgn))) out.push(+m[1] * 3600 + +m[2] * 60 + +m[3]);
  return out.length >= n * 0.9 ? out.slice(0, n) : null;
}

const MOTIFS = ['fourchette', 'clouage', 'enfilade', 'decouverte', 'echec-double'];
const TACTICAL = new Set(['gain', 'mat', ...MOTIFS]);

export function deriveGame(game, parsed, review) {
  const { headers, moves, startFen } = parsed;
  const fens = [startFen, ...moves.map((m) => m.after)];
  const me = game.userColor;
  const sign = me === 'w' ? 1 : -1;
  const base = +(game.timeControl || headers.TimeControl || '').split('+')[0] || null;
  const clocks = clocksOf(game.pgn, moves.length);
  const ev = review.evals;
  const userCp = (k) => cpOfEval(ev[k]) * sign; // évaluation pour l'utilisateur dans la position k
  const out = {
    v: REVIEW_VERSION,
    score: userScore(game, headers),
    moves: 0,
    acc: { o: [], m: [], e: [] },
    errors: [],
    opportunities: 0,
    converted: 0,
    maxAdv: -99999,
    minAdv: 99999,
    evalAt20: ev[Math.min(20, ev.length - 1)] ? userCp(Math.min(20, ev.length - 1)) : 0,
    pawnsAt30: pawnCount(fens[Math.min(30, fens.length - 1)]),
    capturesChecks: 0,
    earlyMoves: 0,
    castledAt: null,
    earlyQueen: false,
    firstMove: moves[0]?.san || '',
    firstReply: moves[1]?.san || '',
    lostOnTime: game.resultCode === 'timeout',
    wonOnTime: game.oppResultCode === 'timeout',
    hasClock: !!clocks,
  };

  moves.forEach((m, i) => {
    if (i >= 16) {
      const u = userCp(i + 1);
      out.maxAdv = Math.max(out.maxAdv, u);
      out.minAdv = Math.min(out.minAdv, u);
    }
    if (m.color !== me) return;
    out.moves++;
    const phase = phaseOf(fens[i], i);
    const res = classifyMove({ cpBefore: cpOfEval(ev[i]), cpAfter: cpOfEval(ev[i + 1]), color: me, isBest: false });
    out.acc[phase].push(Math.round(res.accuracy));
    if (i < 40) {
      out.earlyMoves++;
      if (m.captured || m.san.includes('+')) out.capturesChecks++;
    }
    if (out.castledAt === null && (m.san === 'O-O' || m.san === 'O-O-O')) out.castledAt = i;
    if (m.piece === 'q' && i < 12) out.earlyQueen = true;

    // occasion : l'adversaire vient de se tromper lourdement
    const prevCls = review.classes[i - 1];
    const cls = review.classes[i];
    const good = ['best', 'excellent', 'good', 'book'].includes(cls);
    if (['mistake', 'blunder'].includes(prevCls) && userCp(i) >= 150) {
      out.opportunities++;
      if (good) out.converted++;
    }
    if (!['inaccuracy', 'mistake', 'blunder'].includes(cls)) return;

    const cats = [];
    const played = uciOf(m);
    const best = ev[i].pv[0];
    const refut = ev[i + 1].pv[0];
    const after = ev[i + 1];
    if (cls !== 'inaccuracy') {
      const tagsP = describeMove(fens[i], played).tags;
      const tagsR = refut ? describeMove(fens[i + 1], refut).tags : new Set();
      const tagsB = best ? describeMove(fens[i], best).tags : new Set();
      if (after.white.mate !== undefined && after.white.mate * sign < 0) cats.push('mat-subi');
      if (tagsP.has('en-prise') || tagsR.has('gain')) cats.push('piece-en-prise');
      for (const t of MOTIFS) if (tagsR.has(t)) cats.push('subi-' + t);
      const missedTactic = [...tagsB].filter((t) => TACTICAL.has(t));
      if ((userCp(i) >= 150 && missedTactic.length) || ['mistake', 'blunder'].includes(prevCls)) {
        cats.push('occasion-manquee');
        for (const t of missedTactic) cats.push('rate-' + t);
      }
    }
    if (phase === 'o') cats.push('ouverture');
    if (phase === 'e') cats.push('finale');
    const clock = clocks ? clocks[i] : null;
    if (clock !== null && base && (clock < 30 || clock < base * 0.1)) cats.push('zeitnot');
    out.errors.push({
      i,
      cls,
      phase,
      cats,
      clock,
      fen: fens[i],
      played,
      best,
      loss: Math.round(Math.max(0, userCp(i) - userCp(i + 1))),
    });
  });
  if (out.maxAdv === -99999) out.maxAdv = 0;
  if (out.minAdv === 99999) out.minAdv = 0;
  return out;
}

/** Recalcule les données dérivées si le format a changé (sans relancer le moteur). */
export function ensureDerived(game) {
  if (!game.review?.evals) return game.review?.derived || null;
  if (game.review.derived?.v === REVIEW_VERSION) return game.review.derived;
  const parsed = parsePgn(game.pgn);
  if (!parsed) return null;
  game.review.derived = deriveGame(game, parsed, game.review);
  return game.review.derived;
}

/** Enregistre l'analyse et transforme les erreurs en exercices « Mes erreurs ». */
export function saveReview(game, review) {
  update((d) => {
    const gg = d.games.find((x) => x.id === game.id);
    if (gg) gg.review = review;
    for (const e of review.derived?.errors || []) {
      if (!['mistake', 'blunder'].includes(e.cls) || !e.best) continue;
      if (d.mistakes.some((m) => m.fen === e.fen)) continue;
      d.mistakes.push({ id: uid(), fen: e.fen, best: e.best, played: e.played, gameId: game.id, box: 0, due: Date.now(), cats: e.cats, label: `${game.label || ''} — coup ${Math.floor(e.i / 2) + 1}` });
    }
    if (d.mistakes.length > 400) d.mistakes.splice(0, d.mistakes.length - 400);
  });
}

/** File d'analyse en arrière-plan pour plusieurs parties. */
export async function analyzeMany(games, { depth = 10, onGame, onProgress, isAlive = () => true } = {}) {
  let done = 0;
  for (const g of games) {
    if (!isAlive()) break;
    try {
      const review = await analyzeGame(g, { depth, isAlive, onProgress: (i, n) => onProgress?.(done, games.length, i / n) });
      if (!review) break;
      saveReview(g, review);
      g.review = review;
    } catch (e) {
      console.warn('Analyse impossible', g.id, e);
    }
    done++;
    onGame?.(done, games.length);
  }
  return done;
}

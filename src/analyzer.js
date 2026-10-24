// Analyse d'une partie avec Stockfish + extraction des données qui servent au suivi personnalisé
// (phases, pendule, catégories d'erreurs, occasions, conversion…).
import { Chess } from 'chess.js';
import { update, uid, dayOf, today } from './storage.js';
import { getAnalysisEngine } from './engine.js';
import { parsePgn, uciOf, cpWhite, winPct, safeChess, playUci, VALUE } from './chessutil.js';
import { classifyMove, describeMove, isHanging } from './explain.js';
import { OPENING_LINES, parseLine, groupOf } from './data/openings.js';

// v3 : analyse en multipv 2 (score de la 2e ligne), étiquettes brillant / fort / occasion manquée, Elo estimé
export const REVIEW_VERSION = 3;
// version des règles d'étiquetage (!!, !, ✗) : les étiquettes se recalculent sans moteur quand elle change
// (2 : la pièce sacrifiée doit être en prise juste après le coup ; pas de « brillant » au-delà de ≈ +6)
export const TAGS_VERSION = 2;
// version des règles de l'Elo estimé (2 : pas d'Elo sous MIN_ELO_MOVES coups joués) : recalcul sans moteur
export const ELO_VERSION = 2;
// version des données dérivées (2 : parties trop courtes sans Elo, temps passé par coup, catégorie « trop-vite » ;
// 3 : seuil « trop vite » plafonné à 5 s, pendules incomplètes ignorées) :
// elles se recalculent sans moteur quand elle change
export const DERIVED_VERSION = 3;
/** En dessous de ce nombre de coups joués, une partie est trop courte pour estimer un niveau. */
export const MIN_ELO_MOVES = 15;

/** Trouve la ligne de répertoire qui colle le plus longtemps à la partie (parmi celles de ton camp, s'il est donné). */
export function matchOpening(sans, color = null) {
  let best = { len: 0, line: null };
  for (const line of OPENING_LINES) {
    if (color && groupOf(line)?.side !== color) continue;
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

// ─────────────── Étiquettes « façon chess.com » et Elo estimé ───────────────

/** Chances de gain (0-100) de `color` dans la position évaluée par `e`. */
const winFor = (e, color) => winPct(cpOfEval(e) * (color === 'w' ? 1 : -1));
const secondWinFor = (e, color) => (e?.second ? winPct(cpWhite({ white: e.second }) * (color === 'w' ? 1 : -1)) : null);
const mateFor = (e, color) => !!e && !e.over && e.white?.mate !== undefined && e.white.mate * (color === 'w' ? 1 : -1) > 0;

/** Plateau léger (tableau de 64 cases) pour rejouer vite une variante : bien plus rapide que chess.js. */
function lightBoard(fen) {
  const rows = String(fen || '').split(' ')[0].split('/');
  if (rows.length !== 8) return null;
  const b = new Array(64).fill(null);
  rows.forEach((row, k) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else {
        b[(7 - k) * 8 + f] = { t: ch.toLowerCase(), c: ch === ch.toLowerCase() ? 'b' : 'w' };
        f++;
      }
    }
  });
  return b;
}
const sqIdx = (sq) => 'abcdefgh'.indexOf(sq[0]) + (+sq[1] - 1) * 8;
const sqName = (i) => 'abcdefgh'[i % 8] + (Math.floor(i / 8) + 1);

/** Joue un coup UCI sur le plateau léger (sans vérifier la légalité). Renvoie { color, captured, from, to } ou null. */
function lightMove(b, uci) {
  if (!uci || uci.length < 4) return null;
  const from = sqIdx(uci.slice(0, 2));
  const to = sqIdx(uci.slice(2, 4));
  const p = b[from];
  if (!p || from < 0 || to < 0) return null;
  let captured = b[to]?.t || null;
  if (p.t === 'p' && !b[to] && from % 8 !== to % 8) {
    // prise en passant
    const ep = (from - (from % 8)) + (to % 8);
    captured = b[ep]?.t || null;
    b[ep] = null;
  }
  if (p.t === 'k' && Math.abs((to % 8) - (from % 8)) === 2) {
    // roque : la tour suit
    const rank = from - (from % 8);
    const [rf, rt] = to % 8 === 6 ? [rank + 7, rank + 5] : [rank, rank + 3];
    b[rt] = b[rf];
    b[rf] = null;
  }
  b[to] = uci[4] ? { t: uci[4], c: p.c } : p;
  b[from] = null;
  return { color: p.c, captured, from: sqName(from), to: sqName(to) };
}

function lightBalance(b, color) {
  let t = 0;
  for (const p of b) if (p && p.t !== 'k') t += (p.c === color ? 1 : -1) * VALUE[p.t];
  return t;
}

/**
 * Le coup `played` est-il un vrai sacrifice ? On suit la meilleure suite adverse (replyPv, 4 demi-coups max)
 * et on regarde le matériel après chaque réponse du joueur : il doit avoir au moins 2 points de moins
 * qu'avant son coup, et l'adversaire doit avoir pris une vraie pièce (cavalier ou plus) qui n'était pas
 * déjà perdue avant le coup. Un échange ou une reprise immédiate ne comptent donc pas.
 * À défaut, on regarde si le coup laisse une pièce en prise que l'adversaire a intérêt à ne pas prendre.
 * Renvoie null ou { given: [{type, square}], deficit, plies, offered? }.
 */
export function sacrificeOf(fen, played, replyPv, color, fenAfter = null) {
  const b = lightBoard(fen);
  if (!b || !replyPv?.length) return null;
  const b0 = lightBalance(b, color);
  const origin = new Map(); // case actuelle d'une pièce du joueur → sa case avant le coup
  const track = (mv) => {
    origin.set(mv.to, origin.get(mv.from) ?? mv.from);
    origin.delete(mv.from);
  };
  const first = lightMove(b, played);
  if (!first || first.color !== color) return null;
  track(first);
  const given = [];
  const candidates = [];
  // pièces que le joueur déplace ensuite dans la variante : si elles tombent, c'est le sacrifice
  // du coup suivant (jugé à son tour), pas de celui-ci
  const later = new Set();
  let ply = 0;
  for (const u of replyPv.slice(0, 4)) {
    const mv = lightMove(b, u);
    if (!mv) break;
    ply++;
    if (mv.color === color) {
      track(mv);
      later.delete(mv.from);
      later.add(mv.to);
      // bilan après une réponse du joueur
      const deficit = b0 - lightBalance(b, color);
      if (deficit >= 2 && given.length) candidates.push({ deficit, given: [...given], plies: ply });
    } else if (mv.captured && mv.captured !== 'p' && mv.captured !== 'k') {
      given.push({ type: mv.captured, square: mv.to, from: origin.get(mv.to) ?? mv.to, later: later.has(mv.to) });
      later.delete(mv.to);
    }
  }
  const c = safeChess(fen);
  if (!c) return null;
  // une pièce déjà en prise avant le coup n'est pas « sacrifiée » : elle était perdue de toute façon
  const hung = new Map();
  const wasHanging = (sq) => {
    if (!hung.has(sq)) hung.set(sq, isHanging(c, sq));
    return hung.get(sq);
  };
  // … et une pièce que le coup ne laisse pas en prise non plus : si elle tombe plus tard, c'est un simple
  // échange (avec un coup intermédiaire) ou le sacrifice d'un coup suivant, pas celui de ce coup-ci
  const cAfter = candidates.length ? (fenAfter ? safeChess(fenAfter) : (() => { const x = safeChess(fen); return x && playUci(x, played) ? x : null; })()) : null;
  const offeredNow = (sq) => !!cAfter && cAfter.get(sq)?.color === color && isHanging(cAfter, sq);
  let best = null;
  for (const cand of candidates) {
    const notMine = (g) => g.later || wasHanging(g.from) || !offeredNow(g.square);
    const real = cand.given.filter((g) => !notMine(g));
    // ces pièces-là ne comptent pas non plus dans le déficit (sinon « pièce déjà en prise + échange
    // des dames », ou un échange suivi d'un sacrifice au coup d'après, passeraient pour un sacrifice)
    const lost = cand.given.filter(notMine).reduce((t, g) => t + VALUE[g.type], 0);
    const deficit = cand.deficit - lost;
    if (real.length && deficit >= 2 && (!best || deficit > best.deficit)) best = { given: real.map(({ type, square }) => ({ type, square })), deficit, plies: cand.plies };
  }
  return best || offeredPiece(c, played, color, wasHanging, fenAfter);
}

/**
 * Pièce offerte que l'adversaire ne prend pas forcément (sacrifice « refusé ») : juste après le coup,
 * une pièce du joueur (cavalier ou plus) qui n'était pas en prise peut être prise légalement, et la prendre
 * coûterait au joueur au moins 2 points nets (même s'il reprend avec sa pièce la moins chère).
 * `c` est la position avant le coup (elle est modifiée si fenAfter, la position après le coup, n'est pas fournie).
 */
function offeredPiece(c, played, color, wasHanging, fenAfter) {
  const opp = color === 'w' ? 'b' : 'w';
  const before = {};
  for (const row of c.board()) for (const p of row) if (p && p.color === color && 'nbrq'.includes(p.type)) before[p.square] = wasHanging(p.square);
  const b0 = lightBalance(lightBoard(c.fen()), color);
  const first = { from: played.slice(0, 2), to: played.slice(2, 4) };
  if (fenAfter) c = safeChess(fenAfter);
  else if (!playUci(c, played)) return null;
  if (!c) return null;
  const balAfter = lightBalance(lightBoard(c.fen()), color);
  let best = null;
  for (const row of c.board()) {
    for (const p of row) {
      if (!p || p.color !== color || !'nbrq'.includes(p.type)) continue;
      const from = p.square === first.to ? first.from : p.square;
      if (before[from] || !c.attackers(p.square, opp).length || !isHanging(c, p.square)) continue;
      // prises légales de cette pièce (un attaquant cloué ne compte pas)
      const takers = c.attackers(p.square, opp).flatMap((sq) => c.moves({ square: sq, verbose: true }).filter((mv) => mv.to === p.square));
      if (!takers.length) continue;
      const cheapest = Math.min(...takers.map((mv) => VALUE[mv.piece]));
      const defended = c.attackers(p.square, color).length > 0;
      const deficit = b0 - (balAfter - VALUE[p.type] + (defended && cheapest < 100 ? cheapest : 0));
      if (deficit >= 2 && (!best || deficit > best.deficit)) best = { given: [{ type: p.type, square: p.square }], deficit, plies: 0, offered: true };
    }
  }
  return best;
}

/**
 * Étiquettes superposées aux classes (sans les modifier) pour chaque coup i :
 * 'brilliant' (!! sacrifice juste), 'great' (! seul bon coup), 'miss' (✗ erreur adverse non punie) ou null.
 * Fonction pure : marche aussi pour les anciens bilans (sans `second`, il n'y a simplement pas de « coup fort »).
 */
export function computeTags(fens, moves, evals, classes) {
  return moves.map((m, i) => {
    const e0 = evals[i];
    const e1 = evals[i + 1];
    if (!e0 || !e1 || e0.over) return null;
    const color = m.color;
    const played = uciOf(m);
    const before = winFor(e0, color);
    const after = winFor(e1, color);
    const loss = Math.max(0, before - after);
    const isBest = e0.pv?.[0] === played;
    const cls = classes?.[i];

    // ✗ occasion manquée : l'adversaire vient de se tromper et le coup ne le punit pas
    // (si le coup joué est celui du moteur, la « perte » n'est qu'un artefact d'analyse)
    if (i > 0 && ['mistake', 'blunder'].includes(classes?.[i - 1]) && loss >= 10 && !isBest) return 'miss';
    if (cls === 'book' || e1.over) return null;

    // !! coup brillant : meilleur coup (ou presque) qui sacrifie une pièce, sans compromettre la position
    if ((isBest || loss <= 2) && after >= 50) {
      const sac = sacrificeOf(fens[i], played, e1.pv, color, fens[i + 1]);
      if (sac) {
        // en dessous de 90 % (≈ +6) : la position n'était pas déjà gagnée sans ce sacrifice
        if (before < 90) return 'brilliant';
        // déjà totalement gagnant : seulement si le sacrifice mate ou rapporte nettement plus que la 2e option
        const sign = color === 'w' ? 1 : -1;
        const gap = e0.second ? (cpOfEval(e1) - cpWhite({ white: e0.second })) * sign : 0;
        if (mateFor(e1, color) || gap >= 300) return 'brilliant';
      }
    }

    // ! coup fort : le seul bon coup, la 2e option fait perdre beaucoup
    if (isBest && e0.second && before < 95) {
      const second = secondWinFor(e0, color);
      const prev = moves[i - 1];
      const recapture = prev?.captured && prev.to === m.to;
      // prise « naturelle » (échange ou pièce plus chère) : pas besoin d'être fort pour la voir
      const naturalCapture = m.captured && VALUE[m.captured] >= VALUE[m.piece];
      if (before - second >= 15 && !recapture && !naturalCapture) {
        const legal = safeChess(fens[i])?.moves().length ?? 0;
        if (legal > 2) return 'great';
      }
    }
    return null;
  });
}

/** Elo correspondant à une perte moyenne en centipions (formule type « Game Rating »), arrondi à 25. */
export const eloFromAcpl = (acpl) => Math.round(Math.max(300, Math.min(2800, Math.round(3100 * Math.exp(-0.0116 * acpl)))) / 25) * 25;

/**
 * Elo estimé de la partie pour chaque camp, à partir de la perte moyenne par coup (ACPL) :
 * chaque perte est plafonnée à 400 cp, les mats (et les évaluations énormes) ramenés à ±1000 cp.
 * Renvoie { w, b, acpl: {w, b} } : l'Elo vaut null si le camp a joué moins de MIN_ELO_MOVES coups
 * (quelques coups de théorie suffiraient à afficher 2800), l'ACPL dès 5 coups. Toujours indicatif.
 */
export function computeGameElo(moves, evals) {
  const clamp = (v) => Math.max(-1000, Math.min(1000, v));
  const losses = { w: [], b: [] };
  moves.forEach((m, i) => {
    if (!evals[i] || !evals[i + 1]) return;
    const sign = m.color === 'w' ? 1 : -1;
    const loss = (clamp(cpOfEval(evals[i])) - clamp(cpOfEval(evals[i + 1]))) * sign;
    losses[m.color].push(Math.min(400, Math.max(0, loss)));
  });
  const acpl = (a) => (a.length >= 5 ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const a = { w: acpl(losses.w), b: acpl(losses.b) };
  const elo = (c) => (a[c] === null || losses[c].length < MIN_ELO_MOVES ? null : eloFromAcpl(a[c]));
  return { w: elo('w'), b: elo('b'), acpl: a };
}

/** Ajoute étiquettes et Elo estimé à un bilan qui n'en a pas encore (anciens bilans). Renvoie vrai si modifié. */
export function ensureReviewExtras(review, fens, moves) {
  if (!review?.evals || review.evals.length !== moves.length + 1) return false;
  let changed = false;
  if (!Array.isArray(review.tags) || review.tags.length !== moves.length || review.tagsV !== TAGS_VERSION) {
    review.tags = computeTags(fens, moves, review.evals, review.classes);
    review.tagsV = TAGS_VERSION;
    changed = true;
  }
  if (!review.elo || review.eloV !== ELO_VERSION) {
    const est = computeGameElo(moves, review.evals);
    review.elo = { w: est.w, b: est.b };
    review.eloV = ELO_VERSION;
    review.acpl = est.acpl;
    changed = true;
  }
  return changed;
}

/**
 * Effet d'horizon du moteur : quand le camp au trait joue exactement le coup prévu par le moteur et que la
 * position suivante révèle un mat contre lui, ce mat existait déjà avant sa réponse (le moteur, à faible
 * profondeur, ne l'avait pas vu). On recopie ce mat d'un demi-coup en arrière, sinon le coup qui lance la
 * combinaison passe pour une gaffe (partie de l'Opéra : 15.Fxd7+ Cxd7 16.Db8+ !! Cxb8 17.Td8#).
 * Modifie `evals` sur place ; renvoie le nombre de positions corrigées.
 */
export function fixMateHorizon(moves, evals) {
  let fixed = 0;
  for (let k = moves.length - 1; k >= 1; k--) {
    const e = evals[k];
    const next = evals[k + 1];
    if (!e || !next || e.over || next.over || e.white?.mate !== undefined || !next.white?.mate) continue;
    const mated = next.white.mate > 0 ? 'b' : 'w';
    if (moves[k].color !== mated || e.pv?.[0] !== uciOf(moves[k])) continue;
    evals[k] = { ...e, pv: [e.pv[0], ...(next.pv || [])].slice(0, 6), white: { mate: next.white.mate } };
    fixed++;
  }
  return fixed;
}

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
      // 2 lignes : la 2e sert à repérer les « seuls bons coups » (on ne garde que son score)
      const r = await engine.search(fens[i], { depth, multipv: 2 });
      const l = r.lines[0];
      const e = { pv: (l?.pv || [r.bestmove]).slice(0, 6), white: l?.white || { cp: 0 } };
      if (r.lines[1]?.white) e.second = { ...r.lines[1].white };
      evals.push(e);
    }
    onProgress?.(i + 1, fens.length);
  }
  fixMateHorizon(moves, evals);
  const sans = moves.map((m) => m.san);
  const match = matchOpening(sans, game.userColor);
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
  const est = computeGameElo(moves, evals);
  const review = {
    v: REVIEW_VERSION,
    n: moves.length,
    depth,
    evals,
    classes,
    counts,
    accuracy: { w: avg(acc.w), b: avg(acc.b) },
    tags: computeTags(fens, moves, evals, classes),
    tagsV: TAGS_VERSION,
    elo: { w: est.w, b: est.b },
    eloV: ELO_VERSION,
    acpl: est.acpl,
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

/** Cadence « 600+5 » → { base: 600, inc: 5 } en secondes ; null pour une partie par correspondance ou sans cadence. */
export function timeControlOf(game, headers) {
  const m = /^(\d+)(?:\+(\d+(?:\.\d+)?))?$/.exec(String(game.timeControl || headers?.TimeControl || '').trim());
  return m && +m[1] > 0 ? { base: +m[1], inc: +(m[2] || 0) } : null;
}

/**
 * Temps passé sur chaque demi-coup (secondes) : pendule du joueur avant son coup (deux demi-coups plus tôt,
 * ou le temps de base au premier coup) − pendule après le coup + incrément (chess.com l'ajoute après le coup).
 * Renvoie { spent: [], left: [] } (left : temps qu'il restait avant de jouer), ou null sans pendule.
 */
export function moveTimes(clocks, tc) {
  if (!clocks || !tc) return null;
  const left = clocks.map((c, i) => (i >= 2 ? clocks[i - 2] : tc.base));
  const spent = clocks.map((c, i) => (Number.isFinite(c) && Number.isFinite(left[i]) ? Math.max(0, Math.round((left[i] - c + tc.inc) * 10) / 10) : null));
  return { spent, left };
}

/**
 * Coup joué trop vite : moins de 5 s (ou de 2 % du temps de base quand c'est moins : 3,6 s en 3 minutes,
 * 1,2 s en bullet, où 5 s sont déjà une longue réflexion) alors qu'il restait plus de la moitié du temps
 * de base à la pendule (pas de manque de temps pour l'excuser). Jamais plus de 5 s : le conseil donné
 * ensuite est de prendre 10 secondes de vérification.
 */
export const tooFast = (spent, left, tc) => !!tc && Number.isFinite(spent) && Number.isFinite(left) && spent < Math.min(5, 0.02 * tc.base) && left > tc.base / 2;

const MOTIFS = ['fourchette', 'clouage', 'enfilade', 'decouverte', 'echec-double'];
const TACTICAL = new Set(['gain', 'mat', ...MOTIFS]);

export function deriveGame(game, parsed, review) {
  const { headers, moves, startFen } = parsed;
  const fens = [startFen, ...moves.map((m) => m.after)];
  const me = game.userColor;
  const sign = me === 'w' ? 1 : -1;
  const tc = timeControlOf(game, headers);
  const base = tc?.base || null;
  const clocks = clocksOf(game.pgn, moves.length);
  // temps passé sur chaque coup (avec l'incrément) ; seulement si chaque coup a sa pendule, sinon tout serait décalé
  const times = clocks?.length === moves.length ? moveTimes(clocks, tc) : null;
  const ev = review.evals;
  const userCp = (k) => cpOfEval(ev[k]) * sign; // évaluation pour l'utilisateur dans la position k
  const out = {
    v: REVIEW_VERSION,
    tagsV: TAGS_VERSION,
    derivedV: DERIVED_VERSION,
    score: userScore(game, headers),
    moves: 0,
    acc: { o: [], m: [], e: [] },
    errors: [],
    opportunities: 0,
    converted: 0,
    maxAdv: -99999,
    minAdv: 99999,
    // borné à ±10 : un mat (±10000) ferait exploser la moyenne par ouverture
    evalAt20: ev[Math.min(20, ev.length - 1)] ? Math.max(-1000, Math.min(1000, userCp(Math.min(20, ev.length - 1)))) : 0,
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
    const clock = clocks ? clocks[i] ?? null : null;
    if (clock !== null && base && (clock < 30 || clock < base * 0.1)) cats.push('zeitnot');
    // gaffe ou erreur jouée en quelques secondes alors que la pendule laissait tout le temps de vérifier
    const spent = times?.spent[i] ?? null;
    if (cls !== 'inaccuracy' && tooFast(spent, times?.left[i], tc)) cats.push('trop-vite');
    out.errors.push({
      i,
      cls,
      phase,
      cats,
      clock,
      spent,
      fen: fens[i],
      played,
      best,
      loss: Math.round(Math.max(0, userCp(i) - userCp(i + 1))),
    });
  });
  if (out.maxAdv === -99999) out.maxAdv = 0;
  if (out.minAdv === 99999) out.minAdv = 0;

  // coups brillants / forts / occasions manquées du joueur et Elo estimé de la partie
  const tags = Array.isArray(review.tags) && review.tags.length === moves.length ? review.tags : computeTags(fens, moves, ev, review.classes);
  out.brilliantIdx = [];
  out.greatIdx = [];
  out.missIdx = [];
  tags.forEach((t, i) => {
    if (!t || moves[i].color !== me) return;
    out[{ brilliant: 'brilliantIdx', great: 'greatIdx', miss: 'missIdx' }[t]]?.push(i);
  });
  out.brilliants = out.brilliantIdx.length;
  out.greats = out.greatIdx.length;
  out.misses = out.missIdx.length;
  // partie trop courte : pas de performance (ni ici, ni dans la forme des progrès)
  out.short = out.moves < MIN_ELO_MOVES;
  return out;
}

/** Recalcule les données dérivées si le format a changé (sans relancer le moteur). */
export function ensureDerived(game) {
  if (!game.review?.evals) return game.review?.derived || null;
  const dv = game.review.derived;
  if (dv?.v === REVIEW_VERSION && dv.tagsV === TAGS_VERSION && dv.derivedV === DERIVED_VERSION) return dv;
  const parsed = parsePgn(game.pgn);
  if (!parsed) return null;
  // anciens bilans : on ajoute les étiquettes et l'Elo estimé (calculés sans moteur)
  ensureReviewExtras(game.review, [parsed.startFen, ...parsed.moves.map((m) => m.after)], parsed.moves);
  game.review.derived = deriveGame(game, parsed, game.review);
  return game.review.derived;
}

/** Nouvelles positions « Mes erreurs » par jour : un premier bilan de 20 parties n'en déverse pas 60 d'un coup. */
export const NEW_MISTAKES_PER_DAY = 10;
const MAX_MISTAKES = 400;

/** Gravité d'une erreur : les gaffes d'abord, puis la plus grosse perte. */
const severity = (m) => (m.cls === 'blunder' ? 1e6 : 0) + Math.min(Math.max(0, m.loss || 0), 99999);

/** Début (minuit, heure du téléphone) du jour k à partir d'aujourd'hui. */
function dayStart(k) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k).getTime();
}

/**
 * Programme de nouvelles cartes « Mes erreurs » : NEW_MISTAKES_PER_DAY par jour au plus, les plus graves d'abord,
 * les suivantes les jours d'après (champ due). `plan` garde le jour prévu : tant qu'une carte n'a pas été jouée
 * (due === plan) et que son jour n'est pas passé, elle reste dans la file et peut céder sa place à une erreur
 * plus grave d'une partie analysée ensuite. Les cartes déjà jouées ou plus anciennes ne bougent pas.
 * Modifie `list` sur place.
 */
export function planMistakes(list, fresh, now = Date.now()) {
  const t = today();
  const waiting = new Set(list.filter((m) => m.plan && m.due === m.plan && dayOf(m.plan) >= t));
  const used = {}; // places déjà prises chaque jour par des cartes nouvelles déjà jouées
  for (const m of list) if (m.plan && !waiting.has(m)) used[dayOf(m.plan)] = (used[dayOf(m.plan)] || 0) + 1;
  const queue = [...waiting, ...fresh].sort((a, b) => severity(b) - severity(a));
  let k = 0;
  for (const m of queue) {
    while ((used[dayOf(dayStart(k))] || 0) >= NEW_MISTAKES_PER_DAY) k++;
    const day = dayOf(dayStart(k));
    used[day] = (used[day] || 0) + 1;
    // aujourd'hui : tout de suite ; une carte déjà prévue aujourd'hui garde son heure
    m.plan = m.due = k === 0 ? (m.plan && dayOf(m.plan) === t ? m.plan : now) : dayStart(k);
  }
  // dans la liste, la file vient après les cartes déjà en cours, par jour puis par gravité
  const kept = list.filter((m) => !waiting.has(m));
  queue.sort((a, b) => dayOf(a.plan).localeCompare(dayOf(b.plan)) || severity(b) - severity(a));
  list.splice(0, list.length, ...kept, ...queue);
  return list;
}

/**
 * Limite de MAX_MISTAKES cartes : on retire d'abord les cartes en attente des jours les plus lointains
 * (les moins graves), puis, comme avant, les plus anciennes.
 */
function trimMistakes(list) {
  let excess = list.length - MAX_MISTAKES;
  const t = today();
  for (let i = list.length - 1; i >= 0 && excess > 0; i--) {
    const m = list[i];
    if (m.plan && m.due === m.plan && dayOf(m.plan) > t) {
      list.splice(i, 1);
      excess--;
    }
  }
  if (excess > 0) list.splice(0, excess);
}

/** Enregistre l'analyse et transforme les erreurs en exercices « Mes erreurs » (10 nouvelles par jour). */
export function saveReview(game, review) {
  update((d) => {
    const gg = d.games.find((x) => x.id === game.id);
    if (gg) gg.review = review;
    const fresh = [];
    for (const e of review.derived?.errors || []) {
      if (!['mistake', 'blunder'].includes(e.cls) || !e.best) continue;
      if (d.mistakes.some((m) => m.fen === e.fen) || fresh.some((m) => m.fen === e.fen)) continue;
      fresh.push({ id: uid(), fen: e.fen, best: e.best, played: e.played, gameId: game.id, box: 0, due: 0, cats: e.cats, cls: e.cls, loss: e.loss, label: `${game.label || ''} — coup ${Math.floor(e.i / 2) + 1}` });
    }
    if (fresh.length) planMistakes(d.mistakes, fresh);
    trimMistakes(d.mistakes);
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

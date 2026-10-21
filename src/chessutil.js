// Petits outils autour de chess.js : conversions, évaluations, noms français.
import { Chess, SQUARES } from 'chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const NAME = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const FEMININE = { r: true, q: true };
/** « le cavalier », « la dame » */
export const theName = (t) => (FEMININE[t] ? 'la ' : 'le ') + NAME[t];
/** « du cavalier », « de la dame » */
export const ofName = (t) => (FEMININE[t] ? 'de la ' : 'du ') + NAME[t];
/** « un cavalier », « une dame » */
export const aName = (t) => (FEMININE[t] ? 'une ' : 'un ') + NAME[t];
export const colorName = (c) => (c === 'w' ? 'Blancs' : 'Noirs');

const FIGURINE = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };
/** Notation figurine : Nf3 → ♘f3 (lisible quelle que soit la langue) */
export const fig = (san) => (san ? san.replace(/[KQRBN]/g, (c) => FIGURINE[c]) : '');

export function safeChess(fen) {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

export const uciOf = (m) => m.from + m.to + (m.promotion || '');
export const parseUci = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });

/** Joue un coup UCI, renvoie le coup verbeux ou null s'il est illégal. */
export function playUci(chess, uci) {
  try {
    return chess.move(parseUci(uci));
  } catch {
    return null;
  }
}

export function uciToSan(fen, uci) {
  const c = safeChess(fen);
  const m = c && playUci(c, uci);
  return m ? m.san : uci;
}

/** Convertit une suite de coups UCI en SAN, numérotée (« 12.♘f5 exf5 13.♕g4+ »). */
export function pvToSan(fen, pv, max = 8, plain = false) {
  const c = safeChess(fen);
  if (!c) return '';
  const out = [];
  for (const u of pv.slice(0, max)) {
    const turn = c.turn();
    const num = c.moveNumber();
    const m = playUci(c, u);
    if (!m) break;
    const san = plain ? m.san : fig(m.san);
    if (turn === 'w') out.push(`${num}.${san}`);
    else out.push(out.length === 0 ? `${num}${plain ? '...' : '…'}${san}` : san);
  }
  return out.join(' ');
}

/** Cases de destination légales au format attendu par chessground. */
export function toDests(chess) {
  const dests = new Map();
  for (const s of SQUARES) {
    const ms = chess.moves({ square: s, verbose: true });
    if (ms.length) dests.set(s, ms.map((m) => m.to));
  }
  return dests;
}

export const cgColor = (c) => (c === 'w' ? 'white' : 'black');

export function material(chess) {
  const res = { w: 0, b: 0 };
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') res[p.color] += VALUE[p.type];
  return res;
}

/** Score « en centipions » du point de vue des Blancs ; les mats sont ramenés à ±10000. */
export function cpWhite(line) {
  if (!line) return 0;
  const s = line.white;
  if (s.mate !== undefined) {
    if (s.mate === 0) return 0;
    return s.mate > 0 ? 10000 - s.mate * 10 : -10000 - s.mate * 10;
  }
  return s.cp;
}

/** Probabilité de gain (0-100) — formule utilisée par Lichess. */
export function winPct(cp) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Texte d'évaluation : « +1.4 », « M3 », « -M2 » (point de vue des Blancs). */
export function evalText(line) {
  if (!line) return '…';
  const s = line.white;
  if (s.mate !== undefined) return s.mate > 0 ? `M${s.mate}` : `-M${-s.mate}`;
  const v = s.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

/** Phrase simple sur l'évaluation, du point de vue d'une couleur. */
export function evalPhrase(line, color) {
  if (!line) return '';
  const s = line.white;
  const sign = color === 'w' ? 1 : -1;
  if (s.mate !== undefined) {
    const m = s.mate * sign;
    return m > 0 ? `tu as un mat en ${m}` : `ton adversaire a un mat en ${-m}`;
  }
  const cp = s.cp * sign;
  if (cp >= 500) return 'tu es gagnant';
  if (cp >= 200) return 'tu as un net avantage';
  if (cp >= 70) return 'tu es un peu mieux';
  if (cp > -70) return 'la position est équilibrée';
  if (cp > -200) return 'ton adversaire est un peu mieux';
  if (cp > -500) return 'ton adversaire a un net avantage';
  return 'ton adversaire est gagnant';
}

/** Charge une partie PGN ; renvoie { headers, moves: [verbose], startFen } ou null. */
export function parsePgn(pgn) {
  const c = new Chess();
  try {
    c.loadPgn(pgn.trim());
  } catch {
    return null;
  }
  const headers = c.getHeaders();
  const moves = c.history({ verbose: true });
  const startFen = headers.FEN || START_FEN;
  return { headers, moves, startFen };
}

export function gameOverText(chess) {
  if (chess.isCheckmate()) return `Échec et mat — victoire des ${colorName(chess.turn() === 'w' ? 'b' : 'w')}`;
  if (chess.isStalemate()) return 'Pat — partie nulle';
  if (chess.isThreefoldRepetition()) return 'Nulle par répétition';
  if (chess.isInsufficientMaterial()) return 'Nulle : matériel insuffisant';
  if (chess.isDrawByFiftyMoves()) return 'Nulle : règle des 50 coups';
  return '';
}

/** Position obtenue en jouant des coups SAN depuis le départ (« e4 e5 Nf3 »). */
export function fenFromMoves(moves) {
  const c = new Chess();
  for (const san of moves.split(/\s+/).filter(Boolean)) c.move(san);
  return c.fen();
}

/** FEN d'une étape de leçon (donnée par `fen` ou par `moves`). */
export const stepFen = (step) => step.fen || (step.moves ? fenFromMoves(step.moves) : null);

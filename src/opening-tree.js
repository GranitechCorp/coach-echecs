// Arbre d'ouvertures personnel (façon ChessBase / explorateur de Lichess) : toutes tes parties regroupées
// position par position, comparées à ton répertoire (src/data/openings.js). Ici, que du calcul, aucun affichage.
import { OPENING_LINES, OPENING_GROUPS, parseLine } from './data/openings.js';
import { frOpening } from './data/opening-names.js';
import { START_FEN } from './chessutil.js';

/** On ne garde que les 20 premiers coups de chaque partie (40 demi-coups) : c'est l'ouverture qui compte ici. */
export const MAX_PLIES = 40;

/** Clé d'une position : placement, trait, roques, prise en passant (sans les compteurs). Les transpositions se rejoignent. */
export const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
export const ROOT_KEY = posKey(START_FEN);

/** Score de la partie pour toi : 1, 0,5, 0, ou null si on ne connaît pas le résultat. */
export function gameScore(g) {
  if (typeof g.score === 'number') return g.score;
  const r = g.pgn?.match(/\[Result "([^"]*)"\]/)?.[1] || g.result || '';
  if (r === '1-0') return g.userColor === 'w' ? 1 : 0;
  if (r === '0-1') return g.userColor === 'b' ? 1 : 0;
  if (r === '1/2-1/2') return 0.5;
  const t = g.result || '';
  if (/^Victoire/i.test(t)) return 1;
  if (/^Défaite/i.test(t)) return 0;
  if (/^(Nulle|Pat)/i.test(t)) return 0.5;
  return null;
}

/** Nom d'ouverture en français ; vide si la traduction n'existe pas (jamais d'anglais à l'écran). */
export function frName(name) {
  // noms Lichess (« Queen's Gambit Declined: Exchange Variation », « Caro-Kann Defense ») : on les écrit comme
  // chess.com pour les traduire ; un nom déjà en français (ligne du répertoire) reste tel quel
  const cc = (name || '').replace(/[’']/g, '').replace(/[-:,]/g, ' ').replace(/\s+/g, ' ').trim();
  const alt = frOpening(cc);
  const fr = alt !== cc ? alt : frOpening(name || '');
  return /\b(Defense|Defence|Opening|Game|Attack|Variation|Line|Declined|Accepted|System|Countergambit|Queens?|Kings?|Indian|Pawn)\b|\b[A-Z][a-z]+ Gambit\b/.test(fr) ? '' : fr;
}

/** Date de la partie, comparable (ISO), même pour une ancienne sauvegarde où elle serait en millisecondes. */
export const dateKey = (d) => (typeof d === 'number' ? new Date(d).toISOString() : String(d || ''));

/** Premiers coups (SAN) d'un PGN, sans entêtes, commentaires, variantes ni numéros. Bien plus rapide que loadPgn. */
export function sanTokens(pgn, max = MAX_PLIES) {
  let s = pgn.replace(/^\s*\[[^\n]*\]\s*$/gm, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, ' ');
  }
  const out = [];
  for (const tok of s.split(/\s+/)) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) break;
    const t = tok.replace(/^\d+\.+/, '').replace(/[!?]+$/, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
    if (!t || /^\$\d+$/.test(t) || /^\.+$/.test(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Partie commencée ailleurs qu'à la position de départ (position arrangée) : pas dans l'arbre. */
const customStart = (pgn) => {
  const fen = pgn.match(/\[FEN "([^"]*)"\]/)?.[1];
  return !!fen && posKey(fen) !== ROOT_KEY;
};

// ─────────────── Mini-échiquier rapide pour suivre des coups SAN ───────────────
// chess.js met ~130 µs par coup (il recalcule la notation de tous les coups possibles) : plus d'une seconde pour
// 300 parties sur un téléphone. Ici on suit des coups déjà joués (donc légaux) : il suffit de trouver la pièce qui part.

const FILES = 'abcdefgh';
const sqOf = (s) => FILES.indexOf(s[0]) + 8 * (s.charCodeAt(1) - 49);
const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const SAN_RE = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQ]))?[+#]?$/;
const pieceOf = (t, col) => (col === 'w' ? t : t.toLowerCase());
const inside = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

/** Position minimale { b: 64 cases (lettres FEN, a1 = 0), turn, castling, ep } lue depuis une FEN. */
function fromFen(fen) {
  const [placement, turn, castling, ep] = fen.split(' ');
  const b = new Array(64).fill('');
  placement.split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') f += +ch;
      else b[(7 - r) * 8 + f++] = ch;
    }
  });
  return { b, turn, castling: castling === '-' ? '' : castling, ep: ep && ep !== '-' ? sqOf(ep) : -1 };
}

/** Cases d'où une pièce de type t (N, B, R, Q, K) de la couleur col atteint la case `to`. */
function sources(b, t, col, to) {
  const piece = pieceOf(t, col);
  const out = [];
  const f0 = to & 7;
  const r0 = to >> 3;
  const jump = (dirs) => {
    for (const [df, dr] of dirs) if (inside(f0 + df, r0 + dr) && b[(r0 + dr) * 8 + f0 + df] === piece) out.push((r0 + dr) * 8 + f0 + df);
  };
  const slide = (dirs) => {
    for (const [df, dr] of dirs) {
      for (let f = f0 + df, r = r0 + dr; inside(f, r); f += df, r += dr) {
        const c = b[r * 8 + f];
        if (!c) continue;
        if (c === piece) out.push(r * 8 + f);
        break;
      }
    }
  };
  if (t === 'N') jump(KNIGHT);
  else if (t === 'K') jump(KING);
  else {
    if (t !== 'B') slide(ROOK);
    if (t !== 'R') slide(BISHOP);
  }
  return out;
}

/** La case s est-elle attaquée par la couleur `by` ? */
function attacked(b, s, by) {
  if (sources(b, 'N', by, s).length || sources(b, 'K', by, s).length) return true;
  if (sources(b, 'R', by, s).length || sources(b, 'Q', by, s).length || sources(b, 'B', by, s).length) return true;
  const dr = by === 'w' ? -1 : 1;
  const pawn = pieceOf('P', by);
  return [-1, 1].some((df) => inside((s & 7) + df, (s >> 3) + dr) && b[((s >> 3) + dr) * 8 + (s & 7) + df] === pawn);
}

/** Le coup from→to laisse-t-il son propre roi en échec ? (pour lever les ambiguïtés : pièce clouée) */
function selfCheck(p, from, to) {
  const b = p.b.slice();
  b[to] = b[from];
  b[from] = '';
  const king = b.indexOf(pieceOf('K', p.turn));
  return king >= 0 && attacked(b, king, p.turn === 'w' ? 'b' : 'w');
}

/** Trouve le coup désigné par un SAN : { from, to, promo } ou null. */
function resolveSan(p, san) {
  const col = p.turn;
  const home = col === 'w' ? 0 : 56;
  const king = pieceOf('K', col);
  if (/^O-O-O[+#]?$/.test(san)) return p.b[home + 4] === king ? { from: home + 4, to: home + 2, castle: 'q' } : null;
  if (/^O-O[+#]?$/.test(san)) return p.b[home + 4] === king ? { from: home + 4, to: home + 6, castle: 'k' } : null;
  const m = san.match(SAN_RE);
  if (!m) return null;
  const [, t, ff, fr, dest, promo] = m;
  const to = sqOf(dest);
  if (!t) {
    const dir = col === 'w' ? 8 : -8;
    const pawn = pieceOf('P', col);
    let from = -1;
    if (ff) from = FILES.indexOf(ff) + (to - dir - (to & 7));
    else if (p.b[to - dir] === pawn) from = to - dir;
    else if (!p.b[to - dir] && p.b[to - 2 * dir] === pawn) from = to - 2 * dir;
    return from >= 0 && p.b[from] === pawn ? { from, to, promo: promo?.toLowerCase() } : null;
  }
  let cands = sources(p.b, t, col, to);
  if (ff) cands = cands.filter((s) => FILES[s & 7] === ff);
  if (fr) cands = cands.filter((s) => (s >> 3) + 1 === +fr);
  if (cands.length > 1) cands = cands.filter((s) => !selfCheck(p, s, to));
  return cands.length === 1 ? { from: cands[0], to } : null;
}

/** Joue le coup (déjà trouvé) et renvoie la nouvelle position. */
function applyMove(p, mv) {
  const b = p.b.slice();
  const piece = b[mv.from];
  const isPawn = piece === 'P' || piece === 'p';
  if (isPawn && mv.to === p.ep && !b[mv.to]) b[mv.to + (p.turn === 'w' ? -8 : 8)] = ''; // prise en passant
  b[mv.to] = mv.promo ? pieceOf(mv.promo.toUpperCase(), p.turn) : piece;
  b[mv.from] = '';
  if (mv.castle) {
    const home = p.turn === 'w' ? 0 : 56;
    const [rf, rt] = mv.castle === 'k' ? [home + 7, home + 5] : [home, home + 3];
    b[rt] = b[rf];
    b[rf] = '';
  }
  let castling = p.castling;
  if (piece === 'K') castling = castling.replace(/[KQ]/g, '');
  if (piece === 'k') castling = castling.replace(/[kq]/g, '');
  for (const [s, r] of [[0, 'Q'], [7, 'K'], [56, 'q'], [63, 'k']]) if (mv.from === s || mv.to === s) castling = castling.replace(r, '');
  const ep = isPawn && Math.abs(mv.to - mv.from) === 16 ? (mv.from + mv.to) / 2 : -1;
  return { b, turn: p.turn === 'w' ? 'b' : 'w', castling, ep };
}

/** Clé de la position (même format que posKey d'une FEN de chess.js). */
function keyOf(p) {
  let s = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const c = p.b[r * 8 + f];
      if (!c) empty++;
      else {
        if (empty) s += empty;
        empty = 0;
        s += c;
      }
    }
    if (empty) s += empty;
    if (r) s += '/';
  }
  return `${s} ${p.turn} ${p.castling || '-'} ${epUsable(p) ? sqName(p.ep) : '-'}`;
}

/** Comme chess.js : la case de prise en passant n'est notée que si un pion peut vraiment la prendre (sans être cloué). */
function epUsable(p) {
  if (p.ep < 0) return false;
  const pawn = pieceOf('P', p.turn);
  const behind = p.ep + (p.turn === 'w' ? -8 : 8); // case du pion qui vient d'avancer de deux cases
  return [-1, 1].some((df) => {
    if (!inside((p.ep & 7) + df, 0) || p.b[behind + df] !== pawn) return false;
    const b = p.b.slice();
    b[behind] = '';
    return !selfCheck({ ...p, b }, behind + df, p.ep);
  });
}

/** Joue un coup SAN sur la position : { pos, key, san, uci } ou null s'il est illisible. */
function playSan(pos, tok) {
  const mv = resolveSan(pos, tok);
  if (!mv) return null;
  const next = applyMove(pos, mv);
  return { pos: next, key: keyOf(next), san: tok, uci: sqName(mv.from) + sqName(mv.to) + (mv.promo || '') };
}

/**
 * Rejoue les coups d'une partie en réutilisant les débuts déjà rejoués (trie) : avec 300 parties qui commencent
 * presque toutes pareil, chaque position commune n'est calculée qu'une fois.
 * Renvoie { keys, sans, ucis } (keys : positions AVANT chaque coup, plus la position finale).
 */
function replay(tokens, trie) {
  const keys = [trie.key];
  const sans = [];
  const ucis = [];
  let node = trie;
  for (const tok of tokens) {
    let next = node.kids.get(tok);
    if (!next) {
      const r = playSan(node.pos, tok);
      if (!r) break; // coup illisible : on s'arrête là pour cette partie
      next = { ...r, kids: new Map() };
      node.kids.set(tok, next);
    }
    node = next;
    keys.push(node.key);
    sans.push(node.san);
    ucis.push(node.uci);
  }
  return { keys, sans, ucis };
}

const newTree = (side) => ({ side, nodes: new Map(), games: [] });

function nodeOf(tree, key) {
  let n = tree.nodes.get(key);
  if (!n) {
    n = { key, games: [], moves: new Map() };
    tree.nodes.set(key, n);
  }
  return n;
}

/** Ajoute l'indice d'une partie à une liste, une seule fois (une répétition de position ne compte pas double). */
const addOnce = (list, gi) => {
  if (list.at(-1) !== gi) list.push(gi);
};

/** Racine du trie de lecture : position de départ. */
const newTrie = () => {
  const pos = fromFen(START_FEN);
  return { pos, key: keyOf(pos), kids: new Map() };
};

/**
 * Construit les deux arbres (tes parties avec les Blancs, avec les Noirs). Chaque PGN n'est lu qu'une fois.
 * Tree = { side, nodes: Map<clé, Node>, games: [{ id, score, date, opening, family, keys, sans, ucis }] }
 * Node = { key, games: [indices de parties], moves: Map<uci, { san, uci, to, games }> }
 */
export function buildTrees(games) {
  const trees = { w: newTree('w'), b: newTree('b') };
  const trie = newTrie();
  for (const g of games) {
    if (!g?.pgn || !trees[g.userColor] || customStart(g.pgn)) continue;
    const { keys, sans, ucis } = replay(sanTokens(g.pgn), trie);
    if (!sans.length) continue;
    const tree = trees[g.userColor];
    const gi = tree.games.length;
    tree.games.push({ id: g.id, score: gameScore(g), date: dateKey(g.date), opening: g.opening || g.review?.opening || '', family: g.family || '', keys, sans, ucis });
    for (let i = 0; i < keys.length; i++) {
      const node = nodeOf(tree, keys[i]);
      addOnce(node.games, gi);
      if (i === sans.length) break;
      let mv = node.moves.get(ucis[i]);
      if (!mv) {
        mv = { san: sans[i], uci: ucis[i], to: keys[i + 1], games: [] };
        node.moves.set(ucis[i], mv);
      }
      addOnce(mv.games, gi);
    }
  }
  return trees;
}

/** Bilan d'une liste de parties : { n, w, d, l, known, pct } (pct : % de points, null sans résultat connu). */
export function statsOf(tree, list) {
  let w = 0;
  let d = 0;
  let l = 0;
  for (const gi of list) {
    const s = tree.games[gi].score;
    if (s === 1) w++;
    else if (s === 0.5) d++;
    else if (s === 0) l++;
  }
  const known = w + d + l;
  return { n: list.length, w, d, l, known, pct: known ? Math.round((100 * (w + d / 2)) / known) : null };
}

/** Suit un chemin de coups (UCI) depuis le départ ; renvoie le nœud atteint, ou null si le chemin sort de l'arbre. */
export function nodeAt(tree, path) {
  let node = tree.nodes.get(ROOT_KEY);
  for (const uci of path) {
    const mv = node?.moves.get(uci);
    node = mv ? tree.nodes.get(mv.to) : null;
    if (!node) return null;
  }
  return node || null;
}

/** Qui a le trait dans une position de l'arbre ('w' ou 'b'). */
export const turnOf = (key) => key.split(' ')[1];

// ─────────────── Répertoire ───────────────

/** Lignes du répertoire d'un camp : les groupes principaux, plus les groupes « en plus » dont tu as étudié une ligne. */
export function repertoireLines(side, studied = {}) {
  return OPENING_LINES.filter((l) => {
    const g = OPENING_GROUPS.find((x) => x.id === l.group);
    if (!g || g.side !== side) return false;
    return !g.extra || OPENING_LINES.some((o) => o.group === g.id && studied[o.id]);
  });
}

/**
 * Index du répertoire d'un camp : clé de position → { moves: Map<uci, { san, lines: [ids] }>, lines: [ids] }.
 * La dernière position de chaque ligne y figure aussi, avec moves vide (« fin de la ligne »).
 */
export function repertoireIndex(side, studied) {
  const idx = new Map();
  const entry = (key) => {
    if (!idx.has(key)) idx.set(key, { moves: new Map(), lines: [] });
    return idx.get(key);
  };
  for (const line of repertoireLines(side, studied)) {
    let pos = fromFen(START_FEN);
    let key = keyOf(pos);
    for (const { san } of parseLine(line.moves)) {
      const r = playSan(pos, san);
      if (!r) break;
      const e = entry(key);
      addId(e.lines, line.id);
      if (!e.moves.has(r.uci)) e.moves.set(r.uci, { san: r.san, lines: [] });
      addId(e.moves.get(r.uci).lines, line.id);
      pos = r.pos;
      key = r.key;
    }
    addId(entry(key).lines, line.id);
  }
  return idx;
}
const addId = (list, id) => {
  if (!list.includes(id)) list.push(id);
};

/**
 * Premier écart au répertoire de chaque partie : le tien (« tu sors du répertoire ») ou celui de l'adversaire
 * (« position à préparer »). Regroupés par position, les plus fréquents d'abord.
 * Renvoie [{ by: 'me'|'opp', key, ply, path (UCI), pathSans, played: [{uci, san, n}], games, repMoves: [{uci, san}], lineId }].
 */
export function deviations(tree, rep) {
  const groups = new Map();
  tree.games.forEach((gm, gi) => {
    for (let i = 0; i < gm.ucis.length; i++) {
      const e = rep.get(gm.keys[i]);
      if (!e?.moves.size) return; // ta ligne est finie (ou la partie n'y est jamais entrée) : rien à signaler
      if (e.moves.has(gm.ucis[i])) continue;
      const by = (i % 2 === 0) === (tree.side === 'w') ? 'me' : 'opp';
      const id = by + '|' + gm.keys[i];
      let grp = groups.get(id);
      if (!grp) {
        const repMoves = [...e.moves].map(([uci, m]) => ({ uci, san: m.san, lines: m.lines }));
        grp = { by, key: gm.keys[i], ply: i, paths: new Map(), played: new Map(), games: [], repMoves, lineId: by === 'me' ? repMoves[0].lines[0] : closestLine(e.lines) };
        groups.set(id, grp);
      }
      const p = gm.ucis.slice(0, i).join(' ');
      if (!grp.paths.has(p)) grp.paths.set(p, { n: 0, sans: gm.sans.slice(0, i) });
      grp.paths.get(p).n++;
      const pl = grp.played.get(gm.ucis[i]) || { uci: gm.ucis[i], san: gm.sans[i], n: 0 };
      pl.n++;
      grp.played.set(gm.ucis[i], pl);
      grp.games.push(gi);
      return;
    }
  });
  return [...groups.values()]
    .map((g) => {
      const [p, best] = [...g.paths].sort((a, b) => b[1].n - a[1].n)[0];
      return { ...g, path: p.split(' ').filter(Boolean), pathSans: best.sans, played: [...g.played.values()].sort((a, b) => b.n - a.n) };
    })
    .sort((a, b) => b.games.length - a.games.length || (a.by === 'me' ? 0 : 1) - (b.by === 'me' ? 0 : 1) || a.ply - b.ply);
}

/** Ligne à revoir quand l'adversaire sort du répertoire : seulement si toutes les lignes qui passent là sont du même groupe. */
export function closestLine(ids) {
  const groups = new Set(ids.map((id) => OPENING_LINES.find((l) => l.id === id)?.group));
  return groups.size === 1 ? ids[0] : null;
}

/** Nom d'ouverture commun aux parties d'une liste (nom chess.com en anglais, à traduire), ou '' s'il varie. */
export function commonOpening(tree, list) {
  const names = list.map((gi) => tree.games[gi].opening).filter(Boolean);
  if (!names.length) return '';
  if (names.every((n) => n === names[0])) return names[0];
  const fams = list.map((gi) => tree.games[gi].family).filter(Boolean);
  if (fams.length === names.length && fams.every((f) => f === fams[0])) return fams[0];
  return '';
}

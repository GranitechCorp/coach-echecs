// Anti-gaffe : d'où viennent les positions (tes parties analysées, sinon parties modèles et banque d'exercices),
// pourquoi un coup est sûr ou une gaffe, et ce que l'on garde en mémoire (historique, positions ratées à revoir).
// Rien ici ne touche à l'affichage : les scripts de test s'en servent aussi avec Stockfish en Node.
import { Chess } from 'chess.js';
import { db, update, isToday, scheduleNext } from './storage.js';
import { parsePgn, uciOf, playUci, safeChess, cpWhite, winPct, fig, uciToSan, pvToSan, theName, NAME, VALUE, evalPhrase } from './chessutil.js';
import { describeMove, isHanging, classifyMove } from './explain.js';
import { MODEL_GAMES } from './data/model-games.js';
import { pickFromBank } from './data/puzzle-bank.js';

export const SESSION_SIZE = 10;
const MAX_HISTORY = 600;
const MAX_CARDS = 150;
const MAX_SEEN = 600;
const RECENT_SEEN = 40; // positions des dernières séances : on ne les reprend pas tout de suite
const LEARNED_BOX = 4; // réussie quatre fois de suite en révision : la position est acquise
const GOOD = ['best', 'excellent', 'good'];
const BAD = ['mistake', 'blunder'];
const LOST_WIN = 30; // chances de gain (%) sous lesquelles la position est déjà perdue (environ −2,3)
const DECIDED_CP = 400; // coups sûrs : au-delà de ±4, le classement du coup ne dit plus rien du matériel

// ─────────────── Petits outils ───────────────

const opp = (c) => (c === 'w' ? 'b' : 'w');
const rnd = (n) => Math.floor(Math.random() * n);
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** La position sans les compteurs : la même position venue de deux parties ne compte qu'une fois. */
export const posKey = (fen) => String(fen || '').split(' ').slice(0, 4).join(' ');
const isMateFor = (white, color) => white?.mate !== undefined && white.mate !== 0 && (white.mate > 0) === (color === 'w');
const winFor = (white, color) => winPct(cpWhite({ white }) * (color === 'w' ? 1 : -1));
const isWarning = (f) => /^(Attention|Laisse)/.test(f);
/** Partie encore indécise (entre −4 et +4, sans mat) : un coup « sûr » y est jugé sur le matériel, pas noyé dans un gros avantage. */
const undecided = (white, color) => !!white && Math.abs(cpWhite({ white }) * (color === 'w' ? 1 : -1)) < DECIDED_CP;
const fem = (t) => t === 'r' || t === 'q';
/** « ton cavalier », « ta dame » */
const yours = (t) => (fem(t) ? 'ta ' : 'ton ') + NAME[t];
const listFr = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} et ${a.at(-1)}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pts = (n) => `${n} point${n > 1 ? 's' : ''}`;
/** « 1er coup », « 14e coup » (numéro du coup complet, comme sur la feuille de partie). */
export const moveNth = (ply) => {
  const n = Math.floor(ply / 2) + 1;
  return n === 1 ? '1er coup' : `${n}e coup`;
};
/** Position après un coup UCI (objet chess.js), ou null. */
function afterMove(fen, uci) {
  const c = safeChess(fen);
  return c && uci && playUci(c, uci) ? c : null;
}
function piecesOf(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === color) out.push(p);
  return out;
}
/** Le coup en notation figurine (« ♞e5 »). */
export const sanOf = (fen, uci) => fig(uciToSan(fen, uci));

// Plateau léger (64 cases) pour rejouer vite une variante sans vérifier la légalité : sur des centaines de coups,
// chess.js (qui calcule la notation de chaque coup) serait bien trop lent sur un téléphone.
function lightBoard(fen) {
  const rows = String(fen || '').split(' ')[0].split('/');
  if (rows.length !== 8) return null;
  const b = new Array(64).fill(null);
  rows.forEach((row, k) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else b[(7 - k) * 8 + f++] = { t: ch.toLowerCase(), c: ch === ch.toLowerCase() ? 'b' : 'w' };
    }
  });
  return b;
}
const sqIdx = (sq) => 'abcdefgh'.indexOf(sq[0]) + (+sq[1] - 1) * 8;
/**
 * Joue un coup UCI sur le plateau léger (prise en passant, roque et promotion compris).
 * Renvoie { capture } (vrai pour une prise ou une promotion), ou false si la case de départ est vide.
 */
function lightPlay(b, uci) {
  if (!uci || uci.length < 4) return false;
  const from = sqIdx(uci.slice(0, 2));
  const to = sqIdx(uci.slice(2, 4));
  const p = b[from];
  if (!p || to < 0) return false;
  let capture = !!b[to] || !!uci[4];
  if (p.t === 'p' && !b[to] && from % 8 !== to % 8) {
    b[from - (from % 8) + (to % 8)] = null; // en passant
    capture = true;
  }
  if (p.t === 'k' && Math.abs((to % 8) - (from % 8)) === 2) {
    const rank = from - (from % 8);
    const [rf, rt] = to % 8 === 6 ? [rank + 7, rank + 5] : [rank, rank + 3];
    b[rt] = b[rf];
    b[rf] = null;
  }
  b[to] = uci[4] ? { t: uci[4], c: p.c } : p;
  b[from] = null;
  return { capture };
}
const lightBalance = (b, color) => b.reduce((t, p) => (p && p.t !== 'k' ? t + (p.c === color ? 1 : -1) * VALUE[p.t] : t), 0);
/** Comme pvMaterialSwing (explain.js), en bien plus rapide : matériel gagné (+) ou perdu (−) par color au bout de la suite. */
function swing(fen, pv, color, plies = 6) {
  const b = lightBoard(fen);
  if (!b) return 0;
  const b0 = lightBalance(b, color);
  let last = 0;
  for (const u of (pv || []).slice(0, plies)) {
    if (!lightPlay(b, u)) break;
    last = lightBalance(b, color) - b0;
  }
  return last;
}
/** Position du plateau léger en FEN (sans roque ni prise en passant : assez pour compter les prises). */
function lightFen(b, turn) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let e = 0;
    for (let f = 0; f < 8; f++) {
      const p = b[r * 8 + f];
      if (!p) {
        e++;
        continue;
      }
      if (e) row += e;
      e = 0;
      row += p.c === 'w' ? p.t.toUpperCase() : p.t;
    }
    rows.push(row + (e || ''));
  }
  return `${rows.join('/')} ${turn} - - 0 1`;
}

/**
 * Matériel gagné (+) ou perdu (−) par color le long de la suite, de deux façons :
 * calm : à la dernière position « calme » (le demi-coup suivant n'est pas une prise) ; une suite qui s'arrête
 * sur une prise n'est pas calme, la reprise viendrait juste après (sinon « tu perds 11 points » au milieu d'un échange) ;
 * end : au bout de la suite, en terminant l'échange sur la case de la dernière prise (bilan statique des prises).
 */
function lineMaterial(fen, pv, color, plies = 10) {
  const b = lightBoard(fen);
  if (!b) return { calm: 0, end: 0 };
  const b0 = lightBalance(b, color);
  let turn = String(fen).split(' ')[1] || 'w';
  const steps = [];
  for (const u of (pv || []).slice(0, plies)) {
    const r = lightPlay(b, u);
    if (!r) break;
    turn = opp(turn);
    steps.push({ capture: r.capture, swing: lightBalance(b, color) - b0, to: u.slice(2, 4) });
  }
  let calm = 0; // que des prises : rien de sûr
  for (let k = steps.length - 1; k >= 0; k--) {
    const next = steps[k + 1];
    if (next ? !next.capture : !steps[k].capture) {
      calm = steps[k].swing;
      break;
    }
  }
  const last = steps.at(-1);
  let end = last?.swing || 0;
  if (last?.capture) {
    const c = safeChess(lightFen(b, turn));
    const g = c ? seeGain(c, last.to) : 0;
    end += turn === color ? g : -g;
  }
  return { calm, end };
}
/** Matériel une fois les échanges terminés (voir lineMaterial) : sert à décider si un coup tient, si une erreur se punit. */
const settledSwing = (fen, pv, color, plies) => lineMaterial(fen, pv, color, plies).calm;
/** Le même, seulement quand les deux façons de compter sont d'accord (à 1 point près) ; sinon null : rien à annoncer. */
function sureSwing(fen, pv, color, plies) {
  const { calm, end } = lineMaterial(fen, pv, color, plies);
  return Math.abs(calm - end) <= 1 ? calm : null;
}

/**
 * Bilan statique des prises sur sq pour le camp au trait (≥ 0) : il prend avec sa pièce la moins chère, l'autre reprend…
 * chacun pouvant s'arrêter quand il veut. Seules les prises légales comptent (une pièce clouée ne prend pas).
 */
function seeGain(c, sq) {
  const target = c.get(sq);
  if (!target || target.color === c.turn() || target.type === 'k') return 0;
  const from = c.attackers(sq, c.turn()).sort((x, y) => VALUE[c.get(x).type] - VALUE[c.get(y).type]);
  for (const s of from) {
    try {
      c.move({ from: s, to: sq, promotion: 'q' });
    } catch {
      continue; // coup illégal (pièce clouée, roi qui irait en échec)
    }
    const v = VALUE[target.type] - seeGain(c, sq);
    c.undo();
    return Math.max(0, v);
  }
  return 0;
}
/** Ce que vaut la prise de p (à toi, color) sans regarder la légalité : pièce sans défenseur ou attaquée par moins cher. */
function roughGain(c, p, color) {
  const att = c.attackers(p.square, opp(color)).map((s) => VALUE[c.get(s).type]);
  if (!att.length) return 0;
  const defended = c.attackers(p.square, color).length > 0;
  return !defended || Math.min(...att) < VALUE[p.type] ? VALUE[p.type] : 0;
}
/** Le camp au trait peut-il prendre (légalement) la pièce en sq ? */
function canCapture(c, sq) {
  for (const s of c.attackers(sq, c.turn())) {
    try {
      c.move({ from: s, to: sq, promotion: 'q' });
      c.undo();
      return true;
    } catch {
      // pièce clouée, ou roi qui irait en échec
    }
  }
  return false;
}

// ─────────────── Gaffe ou coup sûr ? ───────────────

/**
 * Le coup perd-il du matériel (au moins 2 points de plus que le meilleur coup) ou laisse-t-il un mat ?
 * before : meilleure ligne avant le coup ; after : meilleure ligne adverse après le coup ({ pv, white }).
 * Renvoie 'mat', 'materiel' ou null.
 */
export function lossKind(fen, move, before, after) {
  const c = safeChess(fen);
  if (!c || !after?.pv?.length) return null;
  const me = c.turn();
  // position déjà perdue (moins de 30 % de chances, environ −2,3) : une gaffe de plus n'y change plus grand-chose
  if (before?.white && winFor(before.white, me) < LOST_WIN) return null;
  if (isMateFor(after.white, opp(me))) return isMateFor(before?.white, opp(me)) ? null : 'mat';
  // matériel au bout de 7 demi-coups (on finit sur ton coup : tes reprises comptent), et une fois les échanges
  // terminés : une suite qui ne fait que manquer un gain (sans rien te prendre) n'est pas une gaffe
  const line = [move, ...after.pv];
  const played = swing(fen, line, me, 7);
  const best = before?.pv?.length ? swing(fen, before.pv, me, 7) : 0;
  return played <= -2 && best - played >= 2 && settledSwing(fen, line, me) <= -2 ? 'materiel' : null;
}

/**
 * Le coup tient : pas de mat contre toi, aucun matériel perdu au bout de la suite (même une fois les échanges
 * terminés), et aucune de tes pièces n'est en prise « à vue » (voir cleanSafe).
 */
function holds(fen, move, after) {
  const me = fen.split(' ')[1];
  if (!after?.pv?.length || isMateFor(after.white, opp(me))) return false;
  const line = [move, ...after.pv];
  return swing(fen, line, me, 7) >= -1 && settledSwing(fen, line, me) >= 0 && cleanSafe(fen, move);
}

/**
 * Après le coup, aucune prise ne gagne de matériel à vue : chacune de tes pièces attaquées (pions compris) est assez
 * protégée, et la pièce qui vient de prendre ne peut être reprise qu'en échange de ce qu'elle a pris.
 * Les coups qui ne tiennent que par une tactique (« le prendre serait une erreur pour lui ») sont écartés :
 * le moteur à faible profondeur s'y trompe souvent, et l'explication serait trop dure à suivre.
 */
export function cleanSafe(fen, move) {
  const c = safeChess(fen);
  const a = afterMove(fen, move);
  if (!c || !a) return false;
  const me = c.turn();
  const to = move.slice(2, 4);
  const took = c.get(to)?.type || null;
  const check = a.inCheck(); // il doit d'abord parer l'échec : ses prises viendront peut-être au coup d'après
  for (const p of piecesOf(a, me)) {
    if (p.type === 'k' || !a.attackers(p.square, opp(me)).length) continue;
    const g = check ? roughGain(a, p, me) : seeGain(a, p.square);
    if (p.square === to && took ? g > VALUE[took] : g > 0) return false;
  }
  return true;
}

/**
 * Un coup sûr ne mérite la question que s'il y a un danger à vérifier : c'est une prise (l'adversaire peut-il
 * reprendre ?) ou, après lui, l'adversaire peut prendre une de tes pièces. Une simple reprise ne compte pas.
 */
export function worthAsking(fen, move, last = null) {
  const c = safeChess(fen);
  const m = c && playUci(c, move);
  if (!m) return false;
  if (m.captured && last && last.slice(2, 4) === m.to) return false;
  if (m.captured) return true;
  const them = opp(m.color);
  return piecesOf(c, m.color).some((p) => p.type !== 'p' && p.type !== 'k' && c.attackers(p.square, them).length > 0);
}

/**
 * L'erreur adverse se punit : le meilleur coup mate, ou il gagne au moins 2 points (comptés depuis avant
 * l'erreur, pour ne pas prendre une simple reprise pour un gain) et donne un net avantage.
 */
function punishes(fenPrev, oppMove, before, me) {
  if (isMateFor(before.white, me)) return true;
  if (winFor(before.white, me) < 60) return false;
  const line = [oppMove, ...before.pv];
  return swing(fenPrev, line, me, line.length) >= 2 && settledSwing(fenPrev, line, me) >= 2;
}

// ─────────────── D'où vient la gaffe (catégories) ───────────────

/**
 * Première pièce (pas un pion) que tu perds dans la suite : { type, square, by, ply }. Une prise aussitôt compensée
 * (tu reprends sur la même case une pièce qui vaut au moins autant) est un échange : on regarde plus loin.
 */
function firstLoss(fenA, pv, me) {
  const c = safeChess(fenA);
  const moves = [];
  for (const u of pv || []) {
    const m = c && playUci(c, u);
    if (!m) break;
    moves.push(m);
  }
  for (let k = 0; k < moves.length; k++) {
    const m = moves[k];
    if (m.color === me || !m.captured || m.captured === 'p') continue;
    const next = moves[k + 1];
    if (next && next.to === m.to && next.captured && VALUE[next.captured] >= VALUE[m.captured]) continue;
    return { type: m.captured, square: m.to, by: m.from, ply: k };
  }
  return null;
}

/** Mat du couloir : une tour ou la dame adverse donne échec sur ta dernière rangée, où ton roi est enfermé. */
function backRank(fenA, pv, me) {
  const c = safeChess(fenA);
  const rank = me === 'w' ? '1' : '8';
  for (const u of pv) {
    const m = c && playUci(c, u);
    if (!m) break;
    if (m.color !== me && c.inCheck() && 'rq'.includes(m.piece) && m.to[1] === rank) {
      if (c.findPiece({ type: 'k', color: me })[0]?.[1] === rank) return true;
    }
  }
  return false;
}

/** La case sq est-elle strictement entre a et b, sur une même ligne, colonne ou diagonale ? */
function between(a, b, sq) {
  const f = (s) => s.charCodeAt(0) - 97;
  const r = (s) => +s[1] - 1;
  const df = f(b) - f(a);
  const dr = r(b) - r(a);
  if (!(df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr))) return false;
  for (let x = f(a) + Math.sign(df), y = r(a) + Math.sign(dr); x !== f(b) || y !== r(b); x += Math.sign(df), y += Math.sign(dr)) {
    if ('abcdefgh'[x] + (y + 1) === sq) return true;
  }
  return false;
}

/**
 * Ta pièce prise en sq avait des défenseurs (hors roi), mais aucun ne peut reprendre : ils sont cloués.
 * a : position après ton coup ; reply : la prise adverse.
 */
function pinnedGuards(a, reply, sq, me) {
  const guards = a.attackers(sq, me).filter((s) => a.get(s)?.type !== 'k');
  const r = guards.length && safeChess(a.fen());
  if (!r || !playUci(r, reply) || r.inCheck()) return false;
  return !guards.some((s) => r.moves({ square: s, verbose: true }).some((x) => x.to === sq));
}

/**
 * Pourquoi le coup est une gaffe, en catégories : 'non-protegee', 'defenseur' (la pièce partie protégeait celle
 * qui tombe), 'ecran' (elle cachait la ligne d'une pièce adverse), 'clouee' (défenseur cloué, ou clouage subi),
 * 'dame', 'couloir', 'mat', 'fourchette', 'enfilade', 'decouverte'.
 * line : meilleure ligne adverse après le coup.
 */
export function gaffeCats(fen, move, line) {
  const c = safeChess(fen);
  const a = afterMove(fen, move);
  if (!c || !a || !line?.pv?.length) return [];
  const me = c.turn();
  const fa = a.fen();
  if (isMateFor(line.white, opp(me))) return [backRank(fa, line.pv, me) ? 'couloir' : 'mat'];
  // d'abord la cause (quelle pièce tombe, et pourquoi), puis le motif tactique s'il en faut un pour l'expliquer
  const cats = new Set();
  const lost = firstLoss(fa, line.pv, me);
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  if (lost?.square === to) cats.add('non-protegee'); // la pièce que tu viens de jouer tombe : elle n'était pas assez protégée
  else if (lost) {
    // la pièce qui tombe était déjà attaquée avant ton coup, et ton coup ne la sauve pas : menace ignorée
    if (alreadyThreatened(c, lost, me)) cats.add('menace');
    // la pièce que tu bouges cachait celle qui tombe : en partant, elle ouvre la ligne d'une pièce adverse
    else if (lost.ply === 0 && 'brq'.includes(a.get(lost.by)?.type) && between(lost.by, lost.square, from)) cats.add('ecran');
    // elle la protégeait : en partant, elle la laisse sans défense
    else if (c.attackers(lost.square, me).includes(from) && !a.attackers(lost.square, me).length) cats.add('defenseur');
  }
  if (lost?.ply === 0 && pinnedGuards(a, line.pv[0], lost.square, me)) cats.add('clouee');
  if (!cats.has('non-protegee')) {
    // le motif de la punition (une fourchette, une enfilade…), quand ce n'est pas simplement la pièce jouée qui est en prise
    const tags = describeMove(fa, line.pv[0]).tags;
    if (tags.has('fourchette')) cats.add('fourchette');
    if (tags.has('clouage')) cats.add('clouee');
    if (tags.has('enfilade')) cats.add('enfilade');
    if (tags.has('decouverte') || tags.has('echec-double')) cats.add('decouverte');
  }
  if (lost?.type === 'q') cats.add('dame');
  if (!cats.size || (cats.size === 1 && cats.has('dame'))) cats.add('non-protegee');
  return [...cats];
}

/** La pièce perdue (lost, vue par firstLoss) était-elle déjà en prise avant ton coup, sur la même case ? c : position avant. */
function alreadyThreatened(c, lost, me) {
  const p = c.get(lost.square);
  return !!p && p.color === me && p.type === lost.type && isHanging(c, lost.square);
}

/** Ce qu'il fallait voir pour punir : 'p-mat', 'p-fourchette', 'p-clouage', 'p-decouverte', 'p-prise', 'p-echec', 'p-menace'. */
export function punishCats(fen, pv, white = null, themes = []) {
  const c = safeChess(fen);
  if (!c || !pv?.length) return [];
  if (isMateFor(white, c.turn()) || themes.some((t) => /^mate/.test(t))) return ['p-mat'];
  const tags = describeMove(fen, pv[0]).tags;
  if (tags.has('mat')) return ['p-mat'];
  if (tags.has('fourchette')) return ['p-fourchette'];
  if (tags.has('clouage') || tags.has('enfilade')) return ['p-clouage'];
  if (tags.has('decouverte') || tags.has('echec-double')) return ['p-decouverte'];
  const m = playUci(c, pv[0]);
  if (m?.captured) return ['p-prise'];
  if (c.inCheck()) return ['p-echec'];
  return ['p-menace'];
}

/** « une prise », « un échec », « une prise avec échec », « une menace » : la case de la routine qui trouvait le coup. */
export function cctOf(fen, uci) {
  const c = safeChess(fen);
  const m = c && playUci(c, uci);
  if (!m) return '';
  if (c.isCheckmate()) return 'un échec et mat';
  if (m.captured && c.inCheck()) return 'une prise avec échec';
  if (m.captured) return 'une prise';
  if (c.inCheck()) return 'un échec';
  return 'une menace';
}

/** Ce qu'il faut retenir, par catégorie : [titre, conseil]. */
export const LESSONS_BY_CAT = {
  'non-protegee': ['Pièce pas assez protégée', 'Avant de lâcher ta pièce, compte pour chacune de tes pièces, à commencer par celle que tu joues : combien d’attaquants, combien de défenseurs ? Attaquée par une pièce moins chère, elle est en danger même si elle est défendue.'],
  menace: ['Menace ignorée', 'Avant de jouer, regarde ce que le dernier coup de ton adversaire attaque : une pièce déjà attaquée doit être mise à l’abri ou protégée, sinon elle tombe au coup suivant.'],
  defenseur: ['Défenseur parti', 'Avant de bouger une pièce, demande-toi ce qu’elle protège : en partant, elle peut laisser une autre de tes pièces sans défense.'],
  ecran: ['Pièce qui faisait écran', 'Avant de bouger une pièce, regarde ce qu’elle cache : si une tour, un fou ou la dame adverse est derrière elle, en partant elle laisse une autre de tes pièces attaquée.'],
  clouee: ['Pièce clouée', 'Une pièce clouée ne protège plus rien : elle ne peut pas reprendre sans découvrir ce qu’il y a derrière elle. Repère les fous, tours et dames adverses alignés avec tes pièces.'],
  dame: ['Dame exposée', 'Ta dame vaut 9 points : avant de la placer, vérifie qu’aucune pièce adverse, même un pion ou un cavalier, ne peut l’attaquer ou la prendre.'],
  couloir: ['Mat du couloir', 'Ton roi est enfermé derrière ses pions : donne-lui une case de fuite (avance un pion devant lui) ou garde une tour sur ta dernière rangée.'],
  mat: ['Mat contre toi', 'Avant chaque coup, regarde d’abord tous les échecs que ton adversaire pourra donner, surtout quand ton roi a peu de défenseurs.'],
  fourchette: ['Fourchette', 'Repère les cases d’où un cavalier, un pion ou la dame adverse attaquerait deux de tes pièces (ou ton roi et une pièce) à la fois.'],
  enfilade: ['Enfilade', 'Roi et dame, ou dame et tour, alignés sur une ligne ouverte : une tour ou un fou adverse attaque le premier et prend celui de derrière.'],
  decouverte: ['Attaque à la découverte', 'Quand une pièce adverse se trouve entre sa tour, son fou ou sa dame et l’une de tes pièces, imagine ce qui se passe si elle bouge, surtout avec échec.'],
  'fausse-alerte': ['Fausses alertes', 'Une pièce attaquée n’est pas forcément en prise : si elle est protégée et que l’attaquant vaut autant ou plus qu’elle, le coup tient. Compte avant de renoncer à un bon coup.'],
  punition: ['Punition pas trouvée', 'Tu as senti le danger sans trouver la réponse adverse : mets-toi à sa place et passe en revue ses échecs, puis ses prises, puis ses menaces.'],
  'p-prise': ['Prises gratuites pas vues', 'Après chaque coup adverse, demande-toi : « Qu’est-ce qu’il ne défend plus ? » Regarde toutes tes prises, même celles qui semblent impossibles.'],
  'p-mat': ['Mats pas vus', 'Commence toujours par les échecs : un échec force la réponse adverse et cache souvent un mat.'],
  'p-fourchette': ['Fourchettes pas vues', 'Cherche les cases d’où une de tes pièces attaquerait deux cibles à la fois : le roi, la dame, une pièce mal protégée.'],
  'p-clouage': ['Clouages pas vus', 'Quand deux pièces adverses sont alignées (ou une pièce devant son roi), une tour, un fou ou ta dame peut les attaquer en ligne.'],
  'p-decouverte': ['Découvertes pas vues', 'Quand une de tes pièces cache la ligne d’une autre vers une cible, bouger la première (avec une menace) déclenche une double attaque.'],
  'p-echec': ['Échecs pas vus', 'Les échecs d’abord : ils sont forcés et gagnent souvent du matériel juste après.'],
  'p-menace': ['Menaces pas vues', 'Après les échecs et les prises, cherche les coups qui créent une menace plus forte que celle de ton adversaire.'],
};

/** Les trois leçons les plus fréquentes parmi les positions ratées : [{ cat, n, title, tip }]. */
export function takeaways(results, max = 3) {
  const n = {};
  for (const r of results) if (!r.ok) for (const c of new Set(r.cats || [])) n[c] = (n[c] || 0) + 1;
  return Object.entries(n)
    .filter(([c]) => LESSONS_BY_CAT[c])
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([cat, k]) => ({ cat, n: k, title: LESSONS_BY_CAT[cat][0], tip: LESSONS_BY_CAT[cat][1] }));
}
const tipFor = (cats) => LESSONS_BY_CAT[(cats || []).find((c) => LESSONS_BY_CAT[c] && c !== 'dame') || cats?.[0]]?.[1] || '';

// ─────────────── Explications ───────────────

/**
 * La réponse qui punit, en une phrase (flèche orange). fen : position avant ton coup ; move : ton coup ;
 * line : sa meilleure ligne après ton coup.
 */
function punishSentence(fen, move, line, me) {
  const them = opp(me);
  const uci = line?.pv?.[0];
  const fa = afterMove(fen, move)?.fen();
  const before = fa && safeChess(fa);
  const c = fa && safeChess(fa);
  const m = c && uci && playUci(c, uci);
  if (!m) return '';
  const san = fig(m.san);
  if (isMateFor(line.white, them)) {
    const n = Math.abs(line.white.mate);
    return n === 1 ? `La punition, **${san}** (flèche orange) : échec et mat !` : `La punition, **${san}** (flèche orange), lance un mat en ${n} coups contre toi.`;
  }
  // matériel une fois les échanges terminés, compté depuis avant ton coup (ce que tu viens de prendre compte aussi)
  const loss = -(sureSwing(fen, [move, ...line.pv], me) ?? 0);
  const lossTxt = loss >= 2 ? ` Au bout de la suite, tu perds environ ${pts(loss)} de matériel.` : '';
  const tags = describeMove(fa, uci).tags;
  const moved = m.promotion || m.piece;
  const piece = `${theName(moved)} adverse`;
  // tes pièces attaquées par la pièce qui vient de bouger (le roi, une pièce plus chère ou mal protégée),
  // le roi d'abord puis les plus chères ; un pion ne compte pas dans une fourchette sur deux pièces
  let targets = piecesOf(c, me)
    .filter((p) => c.attackers(p.square, them).includes(m.to) && (p.type === 'k' || VALUE[p.type] > VALUE[moved] || isHanging(c, p.square)))
    .sort((x, y) => VALUE[y.type] - VALUE[x.type]);
  if (targets.filter((p) => p.type !== 'p').length >= 2) targets = targets.filter((p) => p.type !== 'p');
  // pas de fourchette si tu peux simplement prendre la pièce qui attaque, avec une pièce qui ne vaut pas plus qu'elle
  const answerable = c.moves({ verbose: true }).some((x) => x.to === m.to && x.captured && VALUE[x.piece] <= VALUE[moved]);
  const names = targets.map((p) => (p.type === 'k' ? 'ton roi' : `${yours(p.type)} en ${p.square}`));
  // échange d'abord (il prend, tu reprends aussitôt sur la même case), puis la vraie perte plus loin dans la suite
  const lost = firstLoss(fa, line.pv, me);
  const later = lost && lost.ply > 0 ? `, puis il prend ${yours(lost.type)} en ${lost.square}` : '';
  const pv1 = line.pv[1];
  const traded = m.captured && pv1 && pv1.slice(2, 4) === m.to && later;
  let what;
  if (targets.length >= 2 && !answerable) what = `une fourchette, ${piece} ${m.captured ? `prend ${yours(m.captured)} et ` : ''}attaque ${listFr(names)} en même temps`;
  else if (traded) what = `ton adversaire échange ${fem(moved) ? 'sa' : 'son'} ${NAME[moved]} contre ${yours(m.captured)}`;
  else if (m.captured) {
    const weak = isHanging(before, m.to);
    what = `ton adversaire prend ${yours(m.captured)}${weak ? `, qui n’était pas assez protégé${fem(m.captured) ? 'e' : ''}` : ''}`;
  } else if (tags.has('clouage')) what = 'un clouage, une de tes pièces ne peut plus bouger sans laisser plus gros derrière elle';
  else if (tags.has('enfilade')) what = 'une enfilade, ta pièce attaquée doit bouger et celle de derrière tombe';
  else if (tags.has('decouverte') || tags.has('echec-double')) what = 'une attaque à la découverte, en bougeant, sa pièce ouvre la ligne d’une autre';
  else if (c.inCheck()) what = `un échec${names.length && targets[0].type !== 'k' ? ` qui attaque aussi ${names[0]}` : ''}`;
  else if (targets.length >= 1 && targets[0].type !== 'k') what = `${piece} attaque ${names[0]}`;
  else what = 'la meilleure réponse de ton adversaire';
  // la pièce qui tombe plus loin, sauf si la phrase la nomme déjà
  const tail = later && !what.includes(`${yours(lost.type)} en ${lost.square}`) ? later : '';
  return `La punition, **${san}** (flèche orange) : ${what}${tail}.${lossTxt}`;
}

/** « Ton fou en g5 était déjà attaqué… » : la menace que ton coup ignore (catégorie 'menace'), ou ''. */
function threatIgnored(fen, move, line, me) {
  const c = safeChess(fen);
  const a = afterMove(fen, move);
  const lost = a && firstLoss(a.fen(), line?.pv, me);
  if (!lost || lost.square === move.slice(2, 4) || !alreadyThreatened(c, lost, me)) return '';
  const by = c.attackers(lost.square, opp(me)).map((s) => c.get(s).type).sort((x, y) => VALUE[x] - VALUE[y])[0];
  const e = fem(lost.type) ? 'e' : '';
  return `• ${cap(yours(lost.type))} en ${lost.square} était déjà attaqué${e} par ${theName(by)} adverse avant ton coup, et ton coup ne ${fem(lost.type) ? 'la' : 'le'} sauve pas.`;
}

/** Pourquoi c'est une gaffe : ce qui reste en prise, la punition, la suite et le bon coup (paragraphes pour md()). */
export function explainGaffe(item) {
  const { fen, move, before, after } = item;
  const me = fen.split(' ')[1];
  const a = afterMove(fen, move);
  if (!a) return [];
  const d = describeMove(fen, move);
  const out = [];
  const threat = threatIgnored(fen, move, after, me);
  if (threat) out.push(threat);
  for (const f of d.facts.filter(isWarning).slice(0, threat ? 1 : 2)) out.push('• ' + f);
  const ps = punishSentence(fen, move, after, me);
  if (ps) out.push(ps);
  if (after?.pv?.length > 1 && !isMateFor(after.white, opp(me))) out.push(`Suite probable : ${pvToSan(a.fen(), after.pv, 6)}.`);
  else if (after?.pv?.length > 1) out.push(`Le mat : ${pvToSan(a.fen(), after.pv, 8)}.`);
  const best = before?.pv?.[0];
  if (best && best !== move && afterMove(fen, best)) {
    const b = describeMove(fen, best);
    const facts = b.facts.filter((f) => !isWarning(f)).slice(0, 2);
    out.push(`**Il fallait jouer ${fig(b.san)}** (flèche verte)${facts.length ? ' :' : '.'}`);
    for (const f of facts) out.push('• ' + f);
  }
  const tip = tipFor(item.cats);
  if (tip) out.push(`*${tip}*`);
  return out;
}

/**
 * Pourquoi le coup tient : tes pièces attaquées sont protégées (et la prise coûterait du matériel),
 * et la meilleure réponse adverse ne gagne rien. Renvoie { paragraphs, guards } (guards : cases des défenseurs).
 */
export function explainSafe(item) {
  const { fen, move, after } = item;
  const me = fen.split(' ')[1];
  const them = opp(me);
  const a = afterMove(fen, move);
  if (!a) return { paragraphs: [], guards: [] };
  const d = describeMove(fen, move);
  const out = [`**${fig(d.san)}** ne laisse rien en prise.`];
  for (const f of d.facts.filter((x) => !isWarning(x)).slice(0, 2)) out.push('• ' + f);
  const to = move.slice(2, 4);
  const took = safeChess(fen).get(to)?.type || null; // pièce prise par ton coup
  const replyTo = after?.pv?.[0]?.slice(2, 4);
  const check = a.inCheck(); // il doit d'abord parer l'échec : ses prises se lisent « s'il pouvait »
  const guards = new Set();
  let tricky = false; // une phrase renvoie à la suite : on la montre
  const attacked = piecesOf(a, me)
    .filter((p) => p.type !== 'k' && p.type !== 'p' && a.attackers(p.square, them).length)
    .sort((x, y) => VALUE[y.type] - VALUE[x.type])
    .slice(0, 2);
  for (const p of attacked) {
    const cheapest = a.attackers(p.square, them).map((s) => a.get(s).type).sort((x, y) => VALUE[x] - VALUE[y])[0];
    const defenders = a.attackers(p.square, me);
    const e = fem(p.type) ? 'e' : '';
    const it = fem(p.type) ? 'la' : 'le';
    const who = `${cap(yours(p.type))} en ${p.square} est attaqué${e} par ${theName(cheapest)} adverse`;
    // ses attaquants sont cloués (le roi, lui, ne prend jamais une pièce protégée : voir plus bas)
    if (!check && cheapest !== 'k' && !canCapture(a, p.square)) {
      out.push(`• ${who}, mais ${fem(cheapest) ? 'elle est clouée : elle' : 'il est cloué : il'} ne peut pas ${it} prendre.`);
      continue;
    }
    // ce que les prises sur cette case lui rapportent vraiment (prises légales, reprises comprises)
    const gain = check ? roughGain(a, p, me) : seeGain(new Chess(a.fen()), p.square);
    if (p.square === to && took && gain > 0) {
      // la pièce qui vient de prendre peut être reprise : c'est un échange (describeMove le dit déjà s'il est favorable)
      const net = VALUE[took] - gain;
      if (d.facts.some((f) => /échange favorable/.test(f)) && net > 0) continue;
      if (net >= 0) out.push(`• ${cap(yours(p.type))} en ${p.square} peut être repris${e}, mais tu viens de prendre ${fem(took) ? 'sa' : 'son'} ${NAME[took]} : ${net ? `l’échange te rapporte ${pts(net)}` : 'c’est un échange égal'}.`);
      else {
        tricky = true;
        out.push(`• ${who} : il peut ${it} prendre, mais tu récupères autant de matériel juste après (regarde la suite).`);
      }
      continue;
    }
    if (gain > 0) {
      tricky = true;
      out.push(replyTo === p.square
        ? `• ${who} : il peut ${it} prendre, mais tu récupères autant de matériel juste après (regarde la suite).`
        : `• ${who} : ${it} prendre serait pourtant une erreur pour lui (regarde la suite).`);
      continue;
    }
    for (const s of defenders) if (s !== to) guards.add(s);
    const by = listFr(defenders.slice(0, 2).map((s) => `${theName(a.get(s).type)} en ${s}`));
    const lose = VALUE[cheapest] - VALUE[p.type];
    if (cheapest === 'k') out.push(`• ${who}, mais protégé${e} par ${by} : le roi ne peut pas ${it} prendre.`);
    else if (lose > 0) out.push(`• ${who}, mais protégé${e} par ${by} : s’il ${it} prend, tu reprends et il perd ${pts(lose)}.`);
    else out.push(`• ${who}, mais protégé${e} par ${by} : s’il ${it} prend, tu reprends, c’est un simple échange.`);
  }
  const r = after?.pv?.[0];
  if (r) {
    const san = sanOf(a.fen(), r);
    const capture = !!safeChess(a.fen()).get(r.slice(2, 4));
    // ce que sa suite lui rapporte, une fois les échanges terminés, compté depuis avant ton coup
    const net = -(sureSwing(fen, [move, ...after.pv], me) ?? -1); // sans certitude, on ne dit pas « aucun matériel »
    const phrase = evalPhrase(after, me);
    const retake = after.pv[1]?.slice(2, 4) === r.slice(2, 4); // tu reprends aussitôt sur la même case
    if (!capture) out.push(`Sa meilleure réponse est **${san}**${net <= 0 ? ', qui ne lui rapporte aucun matériel' : ''} : ${phrase}.`);
    else if (r.slice(2, 4) === to && took) out.push(`Sa meilleure réponse est **${san}**, il reprend : ${phrase}.`);
    else if (retake && net <= 0) out.push(`Sa meilleure réponse est **${san}**, et tu reprends : ${phrase}.`);
    else {
      tricky ||= net <= 0;
      out.push(`Sa meilleure réponse est **${san}**${net <= 0 ? ', mais tu récupères autant juste après' : ''} : ${phrase}.`);
    }
    if (tricky && after.pv.length > 1) out.push(`Suite probable : ${pvToSan(a.fen(), after.pv, 6)}.`);
  }
  return { paragraphs: out, guards: [...guards] };
}

/** Indice du mode « Punis la gaffe » (sans donner le coup). */
export function punishHint(item) {
  const c = item.cats?.[0];
  return {
    'p-mat': 'Il y a un mat : regarde tous tes échecs.',
    'p-fourchette': 'Cherche un coup qui attaque deux cibles à la fois.',
    'p-clouage': 'Deux pièces adverses sont alignées : attaque-les en ligne.',
    'p-decouverte': 'Une de tes pièces cache la ligne d’une autre : fais-la bouger avec une menace.',
    'p-prise': 'Une pièce adverse n’est pas assez protégée : regarde toutes tes prises.',
    'p-echec': 'Commence par un échec.',
  }[c] || 'Échecs, prises, menaces : passe-les en revue dans cet ordre.';
}

/** Message après l'exercice « Punis la gaffe » : ce que c'était, ce que ça rapporte, ce que tu avais joué (court : le bouton suivant reste visible). */
export function punishSuccess(item) {
  const sol = item.solution?.[0];
  const kind = sol ? cctOf(item.fen, sol) : '';
  const me = item.fen.split(' ')[1];
  let what = '';
  if (item.line?.length && isMateFor(item.white, me)) what = kind === 'un échec et mat' ? '' : ', qui mène au mat';
  else if (item.line?.length) {
    // gain une fois les échanges terminés (jamais au milieu d'une prise suivie d'une reprise)
    const gain = sureSwing(item.fen, item.line, me) ?? 0;
    if (gain >= 2) what = `, qui gagne environ ${pts(gain)}`;
  }
  const parts = [];
  if (kind) parts.push(`C’était ${kind} : ${sanOf(item.fen, sol)}${what}.`);
  if (item.src === 'game') parts.push(item.found ? 'Dans ta partie, tu l’avais trouvée : bravo !' : `Dans ta partie, tu avais joué ${fig(item.playedSan || '')}.`);
  return parts.join(' ');
}

// ─────────────── Tes parties ───────────────

/** Nom de l'adversaire d'une de tes parties (ou null). */
export function opponentOf(g) {
  if (g.source === 'bot') return g.botElo ? `l’ordinateur (${g.botElo})` : 'l’ordinateur';
  if (g.opp) return g.opp;
  const tag = g.userColor === 'w' ? 'Black' : 'White';
  const m = String(g.pgn || '').match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
  return m && m[1] && m[1] !== '?' ? m[1] : null;
}
const gameLabel = (g, ply) => {
  const who = opponentOf(g);
  return `${who ? `Ta partie contre ${who}` : 'Une de tes parties'}, ${moveNth(ply)}`;
};

/** Bilan allégé (stockage plein) : il ne reste que tes erreurs, sans la réponse adverse (le moteur la retrouvera). */
function mineLight(g, out) {
  for (const e of g.review.derived?.errors || []) {
    if (!BAD.includes(e.cls) || !e.fen || !e.played) continue;
    if (!(e.cats || []).some((c) => c === 'piece-en-prise' || c === 'mat-subi')) continue;
    out.gaffes.push({ key: `g:${g.id}:${e.i}`, src: 'game', mode: 'check', fen: e.fen, move: e.played, verdict: 'gaffe', label: gameLabel(g, e.i), need: true, cats: [] });
  }
  return out;
}

/**
 * Les positions d'entraînement d'une partie analysée :
 * gaffes (tes coups qui perdent du matériel ou laissent un mat), coups sûrs non évidents,
 * et positions à punir (juste après une erreur de ton adversaire).
 */
export function mineGame(g) {
  const out = { gaffes: [], safes: [], punish: [] };
  const r = g?.review;
  const me = g?.userColor;
  if (!r || !me || !g.pgn) return out;
  if (!r.evals) return mineLight(g, out);
  const parsed = parsePgn(g.pgn);
  if (!parsed || r.evals.length !== parsed.moves.length + 1) return out;
  const { moves, startFen } = parsed;
  const fens = [startFen, ...moves.map((m) => m.after)];
  moves.forEach((m, i) => {
    if (m.color !== me) return;
    const e0 = r.evals[i];
    const e1 = r.evals[i + 1];
    if (!e0?.pv?.length || e0.over || !e1) return;
    const fen = fens[i];
    const move = uciOf(m);
    const cls = r.classes?.[i];
    const last = i > 0 ? uciOf(moves[i - 1]) : null;
    const base = { src: 'game', gameId: g.id, ply: i, fen, last, label: gameLabel(g, i) };
    const before = { pv: e0.pv.slice(0, 6), white: e0.white };
    const after = e1.over || !e1.pv?.length ? null : { pv: e1.pv.slice(0, 6), white: e1.white };
    if (after && BAD.includes(cls) && lossKind(fen, move, before, after)) {
      // need : le bilan (profondeur 10) se trompe parfois ; la gaffe sera confirmée plus profond avant d'être montrée
      out.gaffes.push({ ...base, key: `g:${g.id}:${i}`, mode: 'check', move, verdict: 'gaffe', before, after, cats: gaffeCats(fen, move, after), need: true });
    } else if (after && GOOD.includes(cls) && undecided(e0.white, me) && worthAsking(fen, move, last) && holds(fen, move, after)) {
      out.safes.push({ ...base, key: `g:${g.id}:${i}`, mode: 'check', move, verdict: 'sur', before, after, cats: [] });
    }
    const prevP = out.punish.at(-1);
    const sameChance = prevP && i - prevP.ply <= 2 && prevP.solution[0] === before.pv[0]; // la même occasion, encore ouverte
    if (i > 0 && !sameChance && BAD.includes(r.classes?.[i - 1]) && punishes(fens[i - 1], last, before, me)) {
      out.punish.push({
        ...base,
        key: `p:${g.id}:${i}`,
        mode: 'punish',
        solution: [before.pv[0]],
        line: before.pv,
        white: before.white,
        playedSan: m.san,
        found: GOOD.includes(cls) && r.tags?.[i] !== 'miss',
        oppSan: moves[i - 1].san,
        cats: punishCats(fen, before.pv, before.white),
      });
    }
  });
  return out;
}

// Les parties ne changent pas pendant une séance : on garde le résultat (relu si la partie est réanalysée).
const mined = new Map();
const sigOf = (g) => `${g.review?.v}|${g.review?.n}|${g.review?.depth}|${g.review?.evals?.length ?? 'allégé'}|${g.userColor}`;
function minedOf(g) {
  const hit = mined.get(g.id);
  if (hit && hit.sig === sigOf(g)) return hit.res;
  let res;
  try {
    res = mineGame(g);
  } catch (e) {
    console.warn('Anti-gaffe : partie illisible', g.id, e);
    res = { gaffes: [], safes: [], punish: [] };
  }
  mined.set(g.id, { sig: sigOf(g), res });
  return res;
}

/**
 * Toutes tes positions (sans doublon), partie par partie, en laissant l'affichage respirer entre deux parties.
 * Renvoie { gaffes, safes, punish, games } ou null si l'écran a été quitté.
 */
export async function loadPools({ isAlive = () => true } = {}) {
  const pools = { gaffes: [], safes: [], punish: [], games: 0 };
  const seen = new Set();
  const once = (it, k) => !seen.has(k) && seen.add(k);
  for (const g of db().games.filter((x) => x.review && x.pgn)) {
    if (mined.get(g.id)?.sig !== sigOf(g)) await new Promise((r) => setTimeout(r, 0));
    if (!isAlive()) return null;
    const res = minedOf(g);
    for (const it of res.gaffes) {
      const done = it.need && completed.has(it.key) ? completed.get(it.key) : it; // déjà jugée par le moteur
      if (done && once(done, posKey(done.fen) + done.move)) pools.gaffes.push(done);
    }
    for (const it of res.safes) if (once(it, posKey(it.fen) + it.move)) pools.safes.push(it);
    for (const it of res.punish) if (once(it, 'p' + posKey(it.fen))) pools.punish.push(it);
    if (res.gaffes.length + res.safes.length + res.punish.length) pools.games++;
  }
  return pools;
}

// ─────────────── Parties modèles et banque (s'il manque des positions) ───────────────

const plyCache = new Map();
/** Positions d'une partie modèle : [{ fen, uci, last }]. */
function modelPlies(g) {
  if (!plyCache.has(g.id)) {
    const c = new Chess();
    const out = [];
    for (const san of g.moves.split(/\s+/).filter(Boolean)) {
      const fen = c.fen();
      let m;
      try {
        m = c.move(san);
      } catch {
        break;
      }
      out.push({ fen, uci: uciOf(m), last: out.at(-1)?.uci || null });
    }
    plyCache.set(g.id, out);
  }
  return plyCache.get(g.id);
}
const modelLabel = (g) => `Position tirée de la partie modèle « ${g.title.replace(/^Partie modèle : /, '')} »`;

/**
 * Coups « naturels » qui laissent une pièce en prise (à confirmer au moteur), du plus tentant au moins tentant :
 * développer, aller vers le centre, attaquer une pièce, donner échec, prendre un pion. On écarte le roi,
 * les promotions et les bonnes prises. Positions écartées : échec au roi, pièce déjà en prise avant le coup.
 */
export function hangingMoves(fen) {
  const c = safeChess(fen);
  if (!c || c.inCheck()) return [];
  const me = c.turn();
  const them = opp(me);
  if (piecesOf(c, me).some((p) => p.type !== 'p' && isHanging(c, p.square))) return [];
  const home = me === 'w' ? '1' : '8';
  const out = [];
  for (const m of c.moves({ verbose: true })) {
    if (m.piece === 'k' || m.promotion || (m.captured && VALUE[m.captured] >= VALUE[m.piece])) continue;
    c.move(m.san);
    const hung = piecesOf(c, me).filter((p) => p.type !== 'p' && p.type !== 'k' && isHanging(c, p.square));
    if (hung.length) {
      let score = 10 + Math.random() * 3;
      if ('nb'.includes(m.piece) && m.from[1] === home) score += 3; // développement
      if ('cdef'.includes(m.to[0]) && '3456'.includes(m.to[1])) score += 2; // vers le centre
      if (c.inCheck()) score += 2;
      if (piecesOf(c, them).some((p) => p.type !== 'p' && p.type !== 'k' && c.attackers(p.square, me).includes(m.to))) score += 3; // attaque une pièce
      if (m.captured) score += 1; // un pion « gratuit » attire
      if (hung.some((p) => p.type === 'q')) score -= 3; // la dame offerte pour rien : trop gros, sauf si c'est tentant
      out.push({ uci: uciOf(m), score });
    }
    c.undo();
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.uci);
}

/**
 * Un coup de partie modèle qui tient (vérifié par Stockfish) : position « coup sûr ». deep : recherche plus profonde
 * pour confirmer (la profondeur 10 rate parfois un mat en trois, comme dans le piège de la Caro-Kann).
 */
async function modelSafe(g, p, search, deep) {
  if (!worthAsking(p.fen, p.uci, p.last)) return null;
  const me = p.fen.split(' ')[1];
  const a = afterMove(p.fen, p.uci);
  if (!a || a.isGameOver()) return null;
  const before = await search(p.fen);
  if (!undecided(before.white, me)) return null;
  const after = await search(a.fen());
  const ok = (b, x) => undecided(b.white, me) && GOOD.includes(classifyMove({ cpBefore: cpWhite(b), cpAfter: cpWhite(x), color: me, isBest: b.pv[0] === p.uci }).cls) && holds(p.fen, p.uci, x);
  if (!ok(before, after)) return null;
  if (!deep) return { verdict: 'sur', move: p.uci, before, after, cats: [] };
  const b2 = await deep(p.fen);
  const a2 = await deep(a.fen());
  return ok(b2, a2) ? { verdict: 'sur', move: p.uci, before: b2, after: a2, cats: [] } : null;
}

/** Un coup naturel qui laisse une pièce en prise dans une position de partie modèle (vérifié par Stockfish, puis confirmé par deep). */
async function modelGaffe(p, search, deep) {
  const cands = hangingMoves(p.fen).slice(0, 3);
  if (!cands.length) return null;
  const me = p.fen.split(' ')[1];
  const before = await search(p.fen);
  if (isMateFor(before.white, me) || isMateFor(before.white, opp(me))) return null;
  for (const mv of cands) {
    const a = afterMove(p.fen, mv);
    if (!a || a.isGameOver()) continue;
    const after = await search(a.fen());
    const bad = (b, x) => !isMateFor(b.white, me) && BAD.includes(classifyMove({ cpBefore: cpWhite(b), cpAfter: cpWhite(x), color: me, isBest: false }).cls) && lossKind(p.fen, mv, b, x);
    if (!bad(before, after)) continue;
    if (!deep) return { verdict: 'gaffe', move: mv, before, after, cats: gaffeCats(p.fen, mv, after) };
    const b2 = await deep(p.fen);
    const a2 = await deep(a.fen());
    if (bad(b2, a2)) return { verdict: 'gaffe', move: mv, before: b2, after: a2, cats: gaffeCats(p.fen, mv, a2) };
  }
  return null;
}

/**
 * Fabrique une position « Sûr ou gaffe ? » à partir d'une partie modèle.
 * want : 'gaffe' ou 'sur' ; search(fen) → { pv, white } (Stockfish, profondeur ~10) ; deep : la même, plus profonde,
 * pour confirmer la position retenue ; exclude : positions déjà prises dans la séance (complété ici).
 * Renvoie l'exercice ou null.
 */
export async function modelCheckItem(want, { search, deep = null, exclude = new Set(), tries = want === 'sur' ? 12 : 8 } = {}) {
  for (let t = 0; t < tries; t++) {
    const g = MODEL_GAMES[rnd(MODEL_GAMES.length)];
    const plies = modelPlies(g);
    if (plies.length < 16) continue;
    const i = 8 + rnd(plies.length - 12);
    const p = plies[i];
    const k = posKey(p.fen);
    if (exclude.has(k)) continue;
    exclude.add(k);
    const res = want === 'sur' ? await modelSafe(g, p, search, deep) : await modelGaffe(p, search, deep);
    if (res) return { key: `m:${g.id}:${i}:${res.move}`, src: 'model', mode: 'check', fen: p.fen, last: p.last, label: modelLabel(g), ...res };
  }
  return null;
}

// Verdicts du moteur sur les gaffes de tes parties, gardés le temps de la session de l'appli.
const completed = new Map(); // clé → exercice complété, ou null si ce n'était pas une gaffe

/**
 * Confirme au moteur une gaffe de tes parties (need) : le bilan, calculé vite (profondeur 10), se trompe parfois,
 * et un bilan allégé (stockage plein) n'a plus la réponse adverse. Recalcule la meilleure ligne avant et après
 * le coup ; null si ce n'est pas une gaffe. search(fen) → { pv, white } ; lève une erreur si le moteur ne répond pas.
 */
export async function completeItem(it, search) {
  if (completed.has(it.key)) return completed.get(it.key);
  const a = afterMove(it.fen, it.move);
  let res = null;
  if (a && !a.isGameOver()) {
    const before = await search(it.fen);
    const after = await search(a.fen());
    if (lossKind(it.fen, it.move, before, after)) res = { ...it, need: false, before, after, cats: gaffeCats(it.fen, it.move, after) };
  }
  completed.set(it.key, res);
  return res;
}

/** Exercice « pièce en prise » de la banque, proche de ton classement, pas encore vu. */
export function bankPunishItem(rating, exclude = new Set(), seenIds = []) {
  const avoid = [...seenIds];
  for (let t = 0; t < 12; t++) {
    const p = pickFromBank('hangingPiece', rating, avoid);
    if (!p) return null;
    avoid.push(p.id);
    const k = posKey(p.fen);
    if (exclude.has(k)) continue;
    exclude.add(k);
    return { key: `b:${p.id}`, src: 'bank', mode: 'punish', fen: p.fen, solution: p.solution, label: 'Exercice « pièce en prise » à ton niveau', cats: punishCats(p.fen, p.solution, null, p.themes || []) };
  }
  return null;
}

// ─────────────── Mémoire : historique, positions à revoir ───────────────

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
/** Carte à revoir bien formée (vérification rapide ; la position elle-même est vérifiée par validItem avant la séance). */
const cardShape = (c) =>
  isObj(c) && typeof c.key === 'string' && ['check', 'punish'].includes(c.mode) && Number.isFinite(+c.due) && isObj(c.item) && typeof c.item.fen === 'string' &&
  (c.mode === 'check' ? typeof c.item.move === 'string' : Array.isArray(c.item.solution));
/** Les trois listes de db().blunder, nettoyées : un stockage abîmé (entrée vide, valeur d'un autre type) ne casse rien. */
function cleanLists(b) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    history: arr(b.history).filter((h) => isObj(h) && typeof h.ok === 'boolean'),
    cards: arr(b.cards).filter(cardShape),
    seen: arr(b.seen).filter((k) => typeof k === 'string'),
  };
}
/** db().blunder, avec des valeurs par défaut (sans rien écrire). */
export function blunderState() {
  const b = isObj(db().blunder) ? db().blunder : {};
  return { ...cleanLists(b), total: Math.max(0, +b.total || 0) };
}
const pctOk = (list) => (list.length ? Math.round((100 * list.filter((h) => h.ok).length) / list.length) : null);

/** Où tu en es : positions faites aujourd'hui (les deux modes), au total, et % de bonnes réponses sur les 50 dernières. */
export function blunderStats() {
  const b = blunderState();
  return { today: b.history.filter((h) => isToday(h.date)).length, total: Math.max(b.total, b.history.length), accuracy: pctOk(b.history.slice(-50)) };
}

/** Pour un mode : positions faites, précision (50 dernières), positions à revoir (aujourd'hui / en tout). */
export function modeStats(mode) {
  const b = blunderState();
  const h = b.history.filter((x) => x.mode === mode);
  const cards = b.cards.filter((c) => c.mode === mode);
  const now = Date.now();
  return { done: h.length, accuracy: pctOk(h.slice(-50)), due: cards.filter((c) => c.due <= now).length, cards: cards.length };
}

/** Début de la journée dans n jours (heure du téléphone) : une position ratée revient le lendemain (n = 1). */
function dayStart(n = 1) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** Ce qu'on garde d'une position pour la reproposer (sans les champs de travail de la séance). */
const cardItem = ({ review, need, lazy, ...it }) => it;

/**
 * Enregistre une réponse : historique (borné), positions vues, et carte à revoir.
 * Ratée : elle revient demain. Réussie en révision : elle revient 1, 2 puis 4 jours plus tard (en début de journée),
 * et disparaît à la quatrième réussite de suite, acquise.
 */
export function recordResult(item, ok, cats = []) {
  update((d) => {
    const b = isObj(d.blunder) ? d.blunder : (d.blunder = {});
    Object.assign(b, cleanLists(b));
    b.history.push({ date: new Date().toISOString(), mode: item.mode, ok, key: item.key, ...(ok || !cats.length ? {} : { cats: cats.slice(0, 4) }) });
    if (b.history.length > MAX_HISTORY) b.history.splice(0, b.history.length - MAX_HISTORY);
    b.total = (+b.total || 0) + 1;
    b.seen = [...b.seen.filter((k) => k !== item.key), item.key].slice(-MAX_SEEN);
    const i = b.cards.findIndex((c) => c.key === item.key);
    if (!ok) {
      const card = { key: item.key, mode: item.mode, box: 0, due: dayStart(1), added: Date.now(), item: cardItem(item) };
      if (i >= 0) b.cards[i] = { ...b.cards[i], box: 0, due: card.due };
      else b.cards.push(card);
    } else if (i >= 0) {
      // boîtes de Leitner (storage.js), mais l'échéance tombe en début de journée : 1, 2, 4 jours
      const next = scheduleNext(b.cards[i], true);
      if (next.box >= LEARNED_BOX) b.cards.splice(i, 1);
      else b.cards[i] = { ...next, due: dayStart(2 ** (next.box - 1)) };
    }
    if (b.cards.length > MAX_CARDS) {
      // on garde les moins bien sues, puis les plus récentes
      b.cards.sort((x, y) => x.box - y.box || (y.added || 0) - (x.added || 0));
      b.cards.length = MAX_CARDS;
    }
  });
}

// ─────────────── Une séance ───────────────

/**
 * Les positions d'une séance : d'abord celles à revoir aujourd'hui (la moitié au plus), puis des positions neuves
 * de tes parties (en « Sûr ou gaffe ? », 4 à 6 gaffes sur 10 : impossible de deviner en comptant), enfin des
 * positions à fabriquer s'il en manque ({ lazy, want } : partie modèle vérifiée par Stockfish, ou banque).
 * Jamais deux fois la même position. Renvoie { specs, used, spare } (used : positions déjà prises ;
 * spare : gaffes de tes parties restées en réserve, si l'une d'un bilan allégé n'est pas confirmée au moteur).
 */
export function planSession(mode, pools, n = SESSION_SIZE) {
  const b = blunderState();
  const now = Date.now();
  const recent = new Set(b.seen.slice(-RECENT_SEEN));
  const seenAt = new Map(b.seen.map((k, i) => [k, i]));
  const used = new Set();
  const specs = [];
  const spare = [];
  const add = (it) => {
    const k = posKey(it.fen);
    if (!it.fen || used.has(k)) return false;
    used.add(k);
    specs.push(it);
    return true;
  };
  const due = b.cards.filter((c) => c.mode === mode && +c.due <= now).sort((x, y) => x.due - y.due);
  // une position gardée qu'on ne peut plus jouer (stockage abîmé, ancienne version) est oubliée : sinon elle resterait « à revoir »
  const broken = due.filter((c) => !validItem(c.item, mode)).map((c) => c.key);
  if (broken.length) {
    update((d) => {
      if (isObj(d.blunder) && Array.isArray(d.blunder.cards)) d.blunder.cards = d.blunder.cards.filter((c) => !broken.includes(c?.key));
    });
  }
  for (const c of due) {
    if (specs.length >= Math.ceil(n / 2)) break;
    if (broken.includes(c.key)) continue;
    add({ ...c.item, key: c.key, mode, cats: Array.isArray(c.item.cats) ? c.item.cats : [], label: typeof c.item.label === 'string' ? c.item.label : 'Position à revoir', review: true });
  }
  // une position ratée qui attend son jour de révision ne revient pas avant, comme position « neuve »
  const waiting = new Set(b.cards.filter((c) => !(+c.due <= now)).map((c) => c.key));
  // neuves d'abord (au hasard), puis les plus anciennement vues ; jamais celles des dernières séances
  const order = (list) => [
    ...shuffle(list.filter((x) => !seenAt.has(x.key) && !waiting.has(x.key))),
    ...list.filter((x) => seenAt.has(x.key) && !recent.has(x.key) && !waiting.has(x.key)).sort((x, y) => seenAt.get(x.key) - seenAt.get(y.key)),
  ];
  // deux positions au plus par partie (les autres attendent, avant de recourir aux parties modèles)
  const perGame = (id) => specs.filter((x) => id && x.gameId === id).length;
  const fill = (list, k, want) => {
    const later = [];
    while (k > 0) {
      let it = list.shift();
      if (it && perGame(it.gameId) >= 2) {
        later.push(it);
        continue;
      }
      if (!it) it = later.shift();
      if (!it) {
        specs.push({ lazy: true, mode, want });
        k--;
      } else if (add(it)) k--;
    }
  };
  if (mode === 'check') {
    const g = specs.filter((x) => x.verdict === 'gaffe').length;
    const wantG = Math.min(n - specs.length + g, Math.max(g, 4 + rnd(3)));
    const left = n - specs.length;
    const G = order(pools?.gaffes || []);
    fill(G, wantG - g, 'gaffe');
    fill(order(pools?.safes || []), left - (wantG - g), 'sur');
    spare.push(...G.filter((x) => !used.has(posKey(x.fen)))); // remplaçantes si une gaffe n'est pas confirmée
  } else {
    const P = pools?.punish || [];
    const missed = order(P.filter((x) => !x.found));
    const found = order(P.filter((x) => x.found));
    // celles que tu n'avais pas punies d'abord
    const fresh = (x) => !seenAt.has(x.key);
    fill([...missed.filter(fresh), ...found.filter(fresh), ...missed.filter((x) => !fresh(x)), ...found.filter((x) => !fresh(x))], n - specs.length, 'bank');
  }
  shuffle(specs);
  // la première position ne se fabrique pas avec une partie modèle quand tes parties en offrent une (attente plus longue) ;
  // on ne force pas pour autant une position déjà prête (un coup sûr) en tête : ce serait deviner la réponse
  const ready = specs.findIndex((x) => !x.lazy);
  if (specs[0]?.lazy && ready > 0) [specs[0], specs[ready]] = [specs[ready], specs[0]];
  return { specs: spread(specs), used, spare };
}

/** Une position gardée en mémoire (carte à revoir) est-elle encore jouable ? Le stockage peut être abîmé ou ancien. */
function validItem(it, mode) {
  if (!isObj(it) || typeof it.fen !== 'string') return false;
  const c = safeChess(it.fen);
  if (!c || c.isGameOver()) return false;
  if (mode === 'check') {
    if (!['gaffe', 'sur'].includes(it.verdict) || typeof it.move !== 'string' || !Array.isArray(it.after?.pv) || !it.after.white) return false;
    const a = afterMove(it.fen, it.move);
    return !!a && !!afterMove(a.fen(), it.after.pv[0]);
  }
  return Array.isArray(it.solution) && typeof it.solution[0] === 'string' && !!afterMove(it.fen, it.solution[0]);
}

/** Range les positions pour que deux voisines ne viennent pas de la même partie (quand c'est possible) ; la première reste en tête. */
function spread(list) {
  const out = [];
  const rest = [...list];
  while (rest.length) {
    const last = out.at(-1);
    const i = rest.findIndex((x) => !(x.gameId && x.gameId === last?.gameId));
    out.push(rest.splice(Math.max(0, i), 1)[0]);
  }
  return out;
}

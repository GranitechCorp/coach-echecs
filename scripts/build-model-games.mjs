// Génère les parties modèles du répertoire pour « Devine le coup » : on part de la fin d'une ligne
// d'ouverture (src/data/openings.js) et Stockfish joue les deux camps pendant 25 à 35 coups.
// Variété contrôlée : le camp « modèle » (celui du joueur) joue le meilleur coup ou un coup équivalent ;
// l'adversaire se permet parfois le 2ᵉ choix du moteur s'il ne coûte presque rien (comme à 900-1200 Elo, en bien plus fin).
// Les commentaires sont produits automatiquement et ne disent que ce qui est vérifié sur l'échiquier ou par le moteur.
// Usage : node scripts/build-model-games.mjs [--fast] [--only=ck-advance] [--tries=3]
//         node scripts/build-model-games.mjs --recomment   (garde les coups déjà générés, recalcule seulement les commentaires)
// Le résultat remplace la section générée de src/data/model-games.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { NodeEngine, scoreOf } from './uci.mjs';
import { OPENING_LINES, OPENING_GROUPS, parseLine } from '../src/data/openings.js';
import { describeMove, isHanging } from '../src/explain.js';
import { fig, NAME, VALUE } from '../src/chessutil.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'src', 'data', 'model-games.js');
const fast = process.argv.includes('--fast');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const recomment = process.argv.includes('--recomment');
const DEPTH = fast ? 10 : 14;
const DECISIVE = 500; // +5 : on arrête la partie
const TRIES = +(process.argv.find((a) => a.startsWith('--tries='))?.slice(8) || (fast ? 1 : 3)); // essais par ligne : on garde le meilleur
const SUITE = 'La suite est jouée par Stockfish ; ton adversaire s’y permet de petites imprécisions : regarde comment les exploiter.';

const PLAN = [
  {
    line: 'qgd-ortho',
    id: 'modele-qgd-ortho',
    title: 'Partie modèle : Gambit Dame Refusé',
    opening: 'Gambit Dame Refusé, variante orthodoxe',
    intro: `Le Gambit Dame Refusé, variante orthodoxe : la ligne de ton répertoire avec les Blancs, tour en c1 et fou qui reprend en c4 en un seul temps. ${SUITE}`,
    seed: 11,
  },
  {
    line: 'qga',
    id: 'modele-qga',
    title: 'Partie modèle : Gambit Dame Accepté',
    opening: 'Gambit Dame Accepté',
    intro: `Le Gambit Dame Accepté : les Noirs prennent en c4, tu récupères le pion avec e3 et ♝xc4 en gardant un beau centre. ${SUITE}`,
    seed: 23,
  },
  {
    line: 'slav-white',
    id: 'modele-slave-blancs',
    title: 'Partie modèle : Gambit Dame contre la Slave',
    opening: 'Défense Slave (avec les Blancs)',
    intro: `Contre la Slave, a4 empêche …b5 et les Blancs récupèrent le pion c4 en se développant, puis préparent e4. ${SUITE}`,
    seed: 37,
  },
  {
    line: 'london-main',
    id: 'modele-londres',
    title: 'Partie modèle : Système de Londres',
    opening: 'Système de Londres',
    intro: `Le Système de Londres : ♝f4 avant e3, puis la pyramide c3-d4-e3, ♞bd2 et ♝d3. Toujours le même placement, quoi que fassent les Noirs. ${SUITE}`,
    seed: 41,
  },
  {
    line: 'ck-advance',
    id: 'modele-ck-avance',
    title: 'Partie modèle : Caro-Kann, variante d’avance',
    opening: 'Caro-Kann, variante d’avance',
    intro: `La Caro-Kann contre la variante d’avance : le fou sort en f5 avant …e6, puis …c5 attaque la base de la chaîne de pions blancs. Tu as les Noirs. ${SUITE}`,
    seed: 53,
  },
  {
    line: 'ck-classical',
    id: 'modele-ck-classique',
    title: 'Partie modèle : Caro-Kann classique',
    opening: 'Caro-Kann, variante classique',
    intro: `La Caro-Kann classique : le fou sort en f5 en chassant le cavalier, …h6 lui garde une retraite, et tu bâtis une structure très solide. Tu as les Noirs. ${SUITE}`,
    seed: 67,
  },
  {
    line: 'ck-exchange',
    id: 'modele-ck-echange',
    title: 'Partie modèle : Caro-Kann, variante d’échange',
    opening: 'Caro-Kann, variante d’échange',
    intro: `La Caro-Kann, variante d’échange : structure symétrique, développement rapide (♞c6, ♝g4 avant …e6) et échange du bon fou blanc. Tu as les Noirs. ${SUITE}`,
    seed: 79,
  },
  {
    line: 'slav-main',
    id: 'modele-slave',
    title: 'Partie modèle : Défense Slave',
    opening: 'Défense Slave',
    intro: `La Slave, cousine de la Caro-Kann : …c6, …dxc4, puis le fou sort en f5 avant …e6. Tu as les Noirs. ${SUITE}`,
    seed: 97,
  },
];

// ─── Hasard reproductible ───
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Petits outils ───
const FILES = 'abcdefgh';
const opp = (c) => (c === 'w' ? 'b' : 'w');
const camp = (c) => (c === 'w' ? 'Blancs' : 'Noirs');
const pawn = (n) => n.toFixed(1).replace('.', ',');
/** « 0,8 pion », « 2,4 pions » */
const pawnsTxt = (cp) => `${pawn(Math.abs(cp) / 100)} pion${Math.abs(cp) >= 200 ? 's' : ''}`;
/** « 12.♞f3 » ou « 12…♞f6 » */
const numbered = (chess, san) => `${chess.moveNumber()}${chess.turn() === 'w' ? '.' : '…'}${fig(san)}`;
const sanOf = (fen, uci) => new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
const whiteScore = (line, turn) => scoreOf(line) * (turn === 'w' ? 1 : -1);
const FR_PIECES = { R: '♚', D: '♛', T: '♜', F: '♝', C: '♞' };
/** Commentaires des lignes d'ouverture : notation française (♞ = « C », ♜ = « T »…) → figurines, comme le reste de l'écran ; apostrophes typographiques. */
const polish = (t) => t.replace(/(^|[^\p{L}])([RDTFC])(?=[a-h]?[1-8]?x?[a-h][1-8])/gu, (_, a, p) => a + FR_PIECES[p]).replace(/'/g, '’');

function evalWords(cpWhite) {
  if (Math.abs(cpWhite) >= 9000) return cpWhite > 0 ? 'les Blancs ont un mat forcé' : 'les Noirs ont un mat forcé';
  const side = cpWhite > 0 ? 'Blancs' : 'Noirs';
  const v = Math.abs(cpWhite);
  const txt = `${cpWhite > 0 ? '+' : '−'}${pawn(v / 100)}`;
  if (v >= DECISIVE) return `les ${side} ont un avantage décisif (${txt})`;
  if (v >= 200) return `les ${side} ont un net avantage (${txt})`;
  if (v >= 70) return `les ${side} sont un peu mieux (${txt})`;
  return `la position est équilibrée (${txt})`;
}

function pawnsOn(c, color, file) {
  const out = [];
  for (let r = 1; r <= 8; r++) {
    const p = c.get(file + r);
    if (p?.type === 'p' && p.color === color) out.push(file + r);
  }
  return out;
}
const countPawns = (c, color, files) => [...files].reduce((n, f) => n + pawnsOn(c, color, f).length, 0);

/** Pion passé : aucun pion adverse devant lui sur sa colonne ni sur les colonnes voisines. */
function isPassed(c, sq, color) {
  const f = FILES.indexOf(sq[0]);
  const r = +sq[1];
  for (const ff of [f - 1, f, f + 1]) {
    if (ff < 0 || ff > 7) continue;
    for (const s of pawnsOn(c, opp(color), FILES[ff])) if (color === 'w' ? +s[1] > r : +s[1] < r) return false;
  }
  return true;
}

/** Case forte : dans le camp adverse, protégée par un pion, et aucun pion adverse ne pourra jamais l'attaquer. */
function isOutpost(c, sq, color) {
  const r = +sq[1];
  if (color === 'w' ? r < 5 || r > 6 : r > 4 || r < 3) return false;
  if (!c.attackers(sq, color).some((s) => c.get(s).type === 'p')) return false;
  const f = FILES.indexOf(sq[0]);
  for (const ff of [f - 1, f + 1]) {
    if (ff < 0 || ff > 7) continue;
    for (const s of pawnsOn(c, opp(color), FILES[ff])) if (color === 'w' ? +s[1] > r : +s[1] < r) return false;
  }
  return true;
}

const queensOn = (c) => c.board().flat().filter((p) => p?.type === 'q').length;
const kingSquare = (c, color) => c.board().flat().find((p) => p?.type === 'k' && p.color === color).square;
const wing = (sq) => ('abc'.includes(sq[0]) ? 'dame' : 'fgh'.includes(sq[0]) ? 'roi' : 'centre');
const TACTIC_TAGS = ['fourchette', 'clouage', 'enfilade', 'decouverte', 'echec-double'];

/**
 * Commentaire d'un coup de la partie générée (ou null).
 * ctx : { before (Chess avant), after (Chess après), m (coup verbeux), prev (coup précédent), hero, loss, bestLine, altLine, isHero, used (Set) }
 */
function commentFor(ctx) {
  const { before, after, m, prev, loss, bestLine, altLine, isHero } = ctx;
  const parts = [];
  const d = describeMove(before.fen(), m.from + m.to + (m.promotion || ''));
  const recapture = prev?.captured && prev.to === m.to;

  if (after.isCheckmate()) return 'Échec et mat !';

  // 1. Imprécision de l'adversaire (mesurée par Stockfish)
  const played = m.from + m.to + (m.promotion || '');
  if (!isHero && loss >= 70 && played !== bestLine.pv[0]) {
    const bestSan = sanOf(before.fen(), bestLine.pv[0]);
    parts.push(`Imprécision : d’après Stockfish, ce coup coûte environ ${pawnsTxt(loss)} ; il préférait ${numbered(before, bestSan)}.`);
  }

  // 2. Tactique détectée sur l'échiquier
  const tactic = d.facts.find((f) => /^(Fourchette|Cloue|Enfilade|Échec double|Échec à la découverte|Attaque à la découverte)/.test(f));
  // une fourchette doit viser au moins deux pièces (pas des pions), et la pièce qui attaque ne doit pas pouvoir être prise gratuitement
  const targets = (tactic?.split('en même temps')[1] || '').match(/\b(roi|dame|tour|fou|cavalier)\b/g) || [];
  const minor = tactic?.startsWith('Fourchette') && targets.length < 2;
  const loose = !after.isCheck() && isHanging(after, m.to);
  const looseCheck = after.isCheck() && after.attackers(m.to, opp(m.color)).length && !after.attackers(m.to, m.color).length;
  // une enfilade ne gagne la pièce de derrière que si elle vaut plus que l'attaquant ou n'est pas défendue
  const rearSq = tactic?.startsWith('Enfilade') ? [...tactic.matchAll(/ en ([a-h][1-8])/g)].at(-1)?.[1] : null;
  const rear = rearSq && after.get(rearSq);
  const fakeSkewer = !!rearSq && !(rear && (VALUE[rear.type] > VALUE[m.promotion || m.piece] || !after.attackers(rearSq, rear.color).length));
  if (tactic && !minor && !loose && !looseCheck && !fakeSkewer && TACTIC_TAGS.some((t) => d.tags.has(t))) parts.push(tactic);

  // 3. Seul bon coup (pour le camp modèle)
  if (isHero && !recapture && altLine && bestLine.mate === undefined && altLine.mate === undefined && played === bestLine.pv[0]) {
    const gap = scoreOf(bestLine) - scoreOf(altLine);
    if (gap >= 100 && parts.length < 2) {
      parts.push(`Le seul bon coup d’après Stockfish : le meilleur autre choix (${fig(sanOf(before.fen(), altLine.pv[0]))}) coûte environ ${pawnsTxt(gap)}.`);
    }
  }

  // 4. Plans typiques de la structure (une seule fois par partie et par idée)
  const plan = planComment(ctx, d);
  if (plan && parts.length < 2) parts.push(plan);
  return parts.length ? parts.join(' ') : null;
}

function planComment({ before, after, m, used }, d) {
  const me = m.color;
  const them = opp(me);
  const once = (key, text) => {
    if (used.has(key)) return null;
    used.add(key);
    return text;
  };
  const moveNo = before.moveNumber();

  if (m.piece === 'p') {
    // Attaque des minorités : les pions a/b avancent contre une majorité adverse sur l'aile dame
    if (m.to[0] === 'b' && (me === 'w' ? '45' : '54').includes(m.to[1]) && !pawnsOn(after, me, 'c').length && pawnsOn(after, them, 'c').length && countPawns(after, me, 'abc') < countPawns(after, them, 'abc') && countPawns(after, me, 'abc') >= 1) {
      const t = once('minorite', `Attaque des minorités : les pions de l’aile dame avancent contre la majorité adverse (pion ${pawnsOn(after, them, 'c')[0]}) pour lui créer un pion faible.`);
      if (t) return t;
    }
    // Poussées centrales typiques
    if (me === 'w' && m.to === 'e4' && m.from[0] === 'e' && !m.captured && moveNo >= 8) {
      const freesBishop = after.get('c1')?.type === 'b' && after.get('c1')?.color === 'w' && !after.get('d2') && m.from === 'e3';
      const t = once('e4', `La poussée e4 : les Blancs prennent plus de place au centre${freesBishop ? ' et libèrent la diagonale du fou c1' : ''}.`);
      if (t) return t;
    }
    if (me === 'b' && m.to === 'e5' && m.from[0] === 'e' && !m.captured && moveNo >= 8) {
      const freesBishop = after.get('c8')?.type === 'b' && after.get('c8')?.color === 'b' && !after.get('d7') && m.from === 'e6';
      const t = once('e5', `La poussée …e5 : les Noirs contestent le centre${freesBishop ? ' et libèrent leur fou c8, enfermé jusqu’ici' : ''}.`);
      if (t) return t;
    }
    if (me === 'b' && m.to === 'c5' && m.from[0] === 'c' && !m.captured && after.get('d4')?.type === 'p' && after.get('d4')?.color === 'w') {
      const chain = after.get('e5')?.type === 'p' && after.get('e5')?.color === 'w';
      const t = once('c5', chain ? '…c5 attaque la base de la chaîne de pions blancs d4-e5 : le plan classique contre une chaîne de pions.' : '…c5 attaque le pion d4 : les Noirs contestent le centre blanc.');
      if (t) return t;
    }
    if (me === 'b' && m.to === 'f6' && m.from === 'f7' && after.get('e5')?.type === 'p' && after.get('e5')?.color === 'w') {
      const t = once('f6', '…f6 attaque la tête de la chaîne de pions blancs, le pion e5.');
      if (t) return t;
    }
    if (me === 'w' && m.to === 'c5' && after.get('d4')?.type === 'p' && after.get('d4')?.color === 'w' && !m.captured) {
      const t = once('c5w', 'c5 : les Blancs gagnent de la place sur l’aile dame et fixent les pions noirs.');
      if (t) return t;
    }
    // Pion passé avancé
    const rank = me === 'w' ? +m.to[1] : 9 - +m.to[1];
    if (rank >= 5 && isPassed(after, m.to, me) && !isHanging(after, m.to)) {
      const t = once('passe-' + m.to[0], `Pion passé en ${m.to} : aucun pion adverse ne peut plus l’arrêter. Un pion passé est fait pour avancer, soutenu par les pièces.`);
      if (t) return t;
    }
  }

  // Roques opposés
  if (m.isKingsideCastle() || m.isQueensideCastle()) {
    const theirKing = kingSquare(after, them);
    const homeRank = them === 'w' ? '1' : '8';
    const mine = wing(kingSquare(after, me));
    if (theirKing[1] === homeRank && wing(theirKing) !== 'centre' && wing(theirKing) !== mine) {
      const t = once('roques', 'Roques opposés : chaque camp peut lancer ses pions contre le roi adverse. C’est souvent une course à l’attaque.');
      if (t) return t;
    }
  }

  // Échange des dames
  if (queensOn(before) > 0 && queensOn(after) === 0) {
    const t = once('finale', 'Les dames ont disparu : dans cette finale, le roi devient une pièce active. Il faut le rapprocher du centre.');
    if (t) return t;
  }

  // Cavalier sur une case forte
  if (m.piece === 'n' && isOutpost(after, m.to, me)) {
    const t = once('avant-poste-' + m.to, `Le cavalier s’installe en ${m.to}, une case forte : protégé par un pion, aucun pion adverse ne pourra le chasser.`);
    if (t) return t;
  }

  // Tours sur les colonnes
  if (m.piece === 'r' && m.from[0] !== m.to[0] && !m.captured) {
    const file = m.to[0];
    const own = pawnsOn(after, me, file).length;
    const theirs = pawnsOn(after, them, file);
    const doubled = FILES.includes(file) && [1, 2, 3, 4, 5, 6, 7, 8].some((r) => {
      const p = after.get(file + r);
      return p?.type === 'r' && p.color === me && file + r !== m.to;
    });
    if (!own && doubled) {
      const t = once('doublees', `Tours doublées sur la colonne ${file} : leur force s’additionne.`);
      if (t) return t;
    }
    if (!own && theirs.length) {
      const t = once('colonne', `La tour s’installe sur la colonne ${file} semi-ouverte : elle vise le pion ${theirs[0]}.`);
      if (t) return t;
    }
    if (!own && !theirs.length) {
      const t = once('colonne', `La tour prend la colonne ${file}, ouverte : les tours sont faites pour les colonnes ouvertes.`);
      if (t) return t;
    }
  }

  // Roi actif en finale
  if (m.piece === 'k' && queensOn(after) === 0 && 'cdef'.includes(m.to[0]) && '3456'.includes(m.to[1]) && !d.tags.has('roi-expose')) {
    const t = once('roi-actif', 'Le roi se centralise : en finale, c’est une pièce de combat.');
    if (t) return t;
  }
  return null;
}

/** Clé de position (sans les compteurs de coups) pour repérer les répétitions. */
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

/**
 * Joue une partie modèle à partir d'une ligne d'ouverture. Renvoie { game, score } (score : intérêt pour le camp modèle).
 * fixed : liste de coups SAN à rejouer telle quelle (mode --recomment) au lieu de laisser Stockfish choisir.
 */
async function buildGame(engine, p, seed, fixed = null) {
  const line = OPENING_LINES.find((l) => l.id === p.line);
  if (!line) throw new Error(`Ligne introuvable : ${p.line}`);
  const hero = OPENING_GROUPS.find((g) => g.id === line.group).side;
  const rand = rng(seed);
  const seen = new Map();
  const remember = () => seen.set(posKey(c.fen()), (seen.get(posKey(c.fen())) || 0) + 1);
  const c = new Chess();
  const moves = [];
  const comments = {};
  const verbose = [];
  for (const [i, mv] of parseLine(line.moves).entries()) {
    const m = c.move(mv.san);
    moves.push(m.san);
    verbose.push(m);
    if (mv.comment) comments[i] = polish(mv.comment);
    remember();
  }
  const bookLen = moves.length;
  const extra = 25 + Math.floor(rand() * 11); // 25 à 35 coups de plus
  const target = bookLen + 2 * extra;
  const used = new Set();
  let lines = await engine.analyse(c.fen(), { depth: DEPTH, multipv: 2 });
  let reason = 'longueur';

  while (!c.isGameOver()) {
    if (fixed && moves.length >= fixed.length) break;
    const mover = c.turn();
    const best = lines[0];
    if (!best) break;
    const bestScore = scoreOf(best);
    const alt = lines[1];
    let pick = best;
    if (fixed) {
      const t = new Chess(c.fen());
      const fm = t.move(fixed[moves.length]);
      const fu = fm.from + fm.to + (fm.promotion || '');
      pick = lines.find((l) => l.pv[0] === fu) || { pv: [fu] };
    } else {
      // un mat court se joue jusqu'au bout ; sinon on s'arrête à la longueur visée ou dès que la partie est jouée
      const shortMate = best.mate !== undefined && Math.abs(best.mate) <= 6;
      // on ne s'arrête pas au milieu d'un échange ou d'une série d'échecs (6 demi-coups de plus au maximum)
      const lastMove = verbose.at(-1);
      const calm = !lastMove.captured && !lastMove.san.includes('+');
      if (!shortMate && moves.length >= target && (calm || moves.length >= target + 6)) break;
      if (!shortMate && bestScore <= -DECISIVE) {
        reason = 'avantage décisif';
        break; // le camp qui vient de jouer est gagnant : on s'arrête là
      }
      // choix du coup : un peu de variété, contrôlée par l'écart d'évaluation
      if (alt && best.mate === undefined && alt.mate === undefined) {
        const gap = bestScore - scoreOf(alt);
        const r = rand();
        if (mover === hero ? gap <= 8 && r < 0.2 : gap <= 40 && r < 0.4) pick = alt;
      }
      // pas de répétition de position si un autre coup presque aussi bon existe (une partie modèle cherche à gagner)
      const repeats = (line) => {
        const t = new Chess(c.fen());
        t.move({ from: line.pv[0].slice(0, 2), to: line.pv[0].slice(2, 4), promotion: line.pv[0][4] });
        return seen.has(posKey(t.fen()));
      };
      if (alt && best.mate === undefined && repeats(pick)) {
        const other = pick === best ? alt : best;
        if (other.mate === undefined && !repeats(other) && bestScore - scoreOf(other) <= 60) pick = other;
      }
    }
    const before = new Chess(c.fen());
    const uci = pick.pv[0];
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    moves.push(m.san);
    verbose.push(m);
    remember();
    const next = c.isGameOver() ? [] : await engine.analyse(c.fen(), { depth: DEPTH, multipv: 2 });
    const afterScore = c.isCheckmate() ? 10000 : c.isDraw() ? 0 : -scoreOf(next[0]);
    const loss = best.mate === undefined && Math.abs(afterScore) < 9000 ? bestScore - afterScore : 0;
    const text = commentFor({ before, after: c, m, prev: verbose.at(-2), hero, loss, bestLine: best, altLine: alt, isHero: mover === hero, used });
    if (text) comments[moves.length - 1] = text;
    lines = next;
  }
  if (c.isCheckmate()) reason = 'mat';
  else if (c.isDraw()) reason = 'nulle';

  // commentaire final : où en est la partie
  const last = moves.length - 1;
  const heroSign = hero === 'w' ? 1 : -1;
  let final;
  let score;
  if (c.isCheckmate()) {
    final = `Les ${camp(opp(c.turn()))} gagnent.`;
    score = opp(c.turn()) === hero ? 5000 : -5000;
  } else if (c.isDraw()) {
    final = 'Partie nulle.';
    score = -150;
  } else {
    const fin = lines[0] || (await engine.analyse(c.fen(), { depth: DEPTH }))[0];
    const w = whiteScore(fin, c.turn());
    score = Math.max(-3000, Math.min(3000, w * heroSign));
    final = `Fin de la partie modèle : d’après Stockfish, ${evalWords(w)}.`;
    if (Math.abs(w) < 9000 && (w * (hero === 'w' ? 1 : -1)) >= 150) final += ` Les ${camp(hero)} doivent maintenant convertir leur avantage.`;
  }
  comments[last] = comments[last] ? `${comments[last]} ${final}` : final;

  const nComments = Object.keys(comments).length;
  console.log(`    essai ${seed} : ${moves.length} demi-coups (${bookLen} d’ouverture + ${moves.length - bookLen}), arrêt : ${reason}, ${nComments} commentaires, intérêt ${score}`);
  const game = {
    id: p.id,
    title: p.title,
    group: 'repertoire',
    white: 'Stockfish',
    black: 'Stockfish',
    event: 'Partie modèle générée par Stockfish',
    side: hero,
    opening: p.opening,
    line: p.line,
    intro: p.intro,
    moves: moves.join(' '),
    comments,
  };
  return { game, score };
}

/** Écrit la section générée de model-games.js (le reste du fichier n'est pas touché). */
function writeGames(games) {
  const src = readFileSync(OUT, 'utf8');
  const start = src.indexOf('// <généré');
  const end = src.indexOf('// </généré>');
  if (start < 0 || end < 0) throw new Error('Marqueurs de section générée introuvables dans model-games.js');
  const startLineEnd = src.indexOf('\n', start) + 1;
  const body = `const REPERTOIRE = ${JSON.stringify(games, null, 2)};\n`;
  writeFileSync(OUT, src.slice(0, startLineEnd) + body + src.slice(end));
}

/** Parties déjà générées (pour --only : on ne régénère qu'une partie). */
async function previousGames() {
  try {
    const mod = await import('../src/data/model-games.js?t=' + Date.now());
    return mod.MODEL_GAMES.filter((g) => g.group === 'repertoire');
  } catch {
    return [];
  }
}

const engine = new NodeEngine();
console.log(`Génération des parties modèles (profondeur ${DEPTH}, MultiPV 2, ${recomment ? 'commentaires seulement' : `${TRIES} essai(s) par ligne`})…`);
const old = only || recomment ? await previousGames() : [];
const games = [];
for (const p of PLAN) {
  if (recomment) {
    const prev = old.find((g) => g.id === p.id);
    if (!prev) throw new Error(`Partie ${p.id} absente : lance d'abord la génération complète.`);
    console.log(`  ${p.id}`);
    games.push((await buildGame(engine, p, p.seed, prev.moves.split(' '))).game);
    continue;
  }
  if (only && !p.line.includes(only) && !p.id.includes(only)) {
    const keep = old.find((g) => g.id === p.id);
    if (keep) games.push(keep);
    continue;
  }
  console.log(`  ${p.id}`);
  let best = null;
  for (let k = 0; k < TRIES; k++) {
    const cand = await buildGame(engine, p, p.seed + 1000 * k);
    if (!best || cand.score > best.score) best = cand;
  }
  console.log(`  ✓ ${p.id} retenue (intérêt ${best.score})`);
  games.push(best.game);
}
engine.quit();
writeGames(games);
console.log(`${games.length} parties écrites dans src/data/model-games.js. Vérifie avec : node scripts/verify-model-games.mjs`);

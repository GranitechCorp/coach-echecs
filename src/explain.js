// Explications « maison » (sans IA) : on lit la position avec chess.js et les lignes de Stockfish
// pour décrire en français ce que fait un coup, pourquoi c'est le meilleur, ou pourquoi c'est une erreur.
import {
  VALUE, NAME, theName, aName, safeChess, playUci, uciToSan, pvToSan, fig,
  material, cpWhite, winPct, evalText, evalPhrase,
} from './chessutil.js';

const FILES = 'abcdefgh';
const sqName = (f, r) => FILES[f] + (r + 1);
const coords = (sq) => [FILES.indexOf(sq[0]), +sq[1] - 1];
const opp = (c) => (c === 'w' ? 'b' : 'w');
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const dirsOf = (t) => (t === 'r' ? ROOK_DIRS : t === 'b' ? BISHOP_DIRS : t === 'q' ? [...ROOK_DIRS, ...BISHOP_DIRS] : []);

function pieces(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p && (!color || p.color === color)) out.push(p);
  return out;
}

/** Une pièce est « en prise » si elle est attaquée et pas assez défendue. */
export function isHanging(chess, sq) {
  const p = chess.get(sq);
  if (!p || p.type === 'k') return false;
  const attackers = chess.attackers(sq, opp(p.color));
  if (!attackers.length) return false;
  const defenders = chess.attackers(sq, p.color);
  if (!defenders.length) return true;
  const minAtt = Math.min(...attackers.map((s) => VALUE[chess.get(s).type]));
  return minAtt < VALUE[p.type] || attackers.length > defenders.length;
}

function hangingSquares(chess, color) {
  return pieces(chess, color).filter((p) => isHanging(chess, p.square)).map((p) => p.square);
}

/** Parcourt un rayon depuis sq et renvoie les deux premières pièces rencontrées. */
function firstTwoOnRay(chess, sq, [df, dr], skip = null) {
  let [f, r] = coords(sq);
  const found = [];
  for (;;) {
    f += df;
    r += dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) break;
    const s = sqName(f, r);
    if (s === skip) continue;
    const p = chess.get(s);
    if (p) {
      found.push({ ...p, square: s });
      if (found.length === 2) break;
    }
  }
  return found;
}

const pieceAt = (p) => `${theName(p.type)} en ${p.square}`;
const ifMoves = (t) => (t === 'r' || t === 'q' ? 'si elle bouge' : 's’il bouge');

/**
 * Décrit ce que fait un coup. Renvoie { san, facts: [phrases], tags: Set }.
 * Les tags servent à classer les thèmes (fourchette, clouage…).
 */
export function describeMove(fen, uci) {
  const c = safeChess(fen);
  if (!c) return { san: uci, facts: [], tags: new Set() };
  const me = c.turn();
  const them = opp(me);
  const moveNo = c.moveNumber();
  const myHangingBefore = hangingSquares(c, me);
  const theirHangingBefore = hangingSquares(c, them);
  const m = playUci(c, uci);
  if (!m) return { san: uci, facts: [], tags: new Set() };

  const facts = [];
  const tags = new Set();
  const movedType = m.promotion || m.piece;
  const movedValue = VALUE[movedType];

  if (c.isCheckmate()) {
    facts.push('Échec et mat !');
    tags.add('mat');
    return { san: m.san, facts, tags };
  }

  if (m.isKingsideCastle() || m.isQueensideCastle()) {
    facts.push('Roque : le roi se met à l’abri et la tour entre dans le jeu.');
    tags.add('roque');
  }

  if (m.captured) {
    const cv = VALUE[m.captured];
    if (theirHangingBefore.includes(m.to) && !c.attackers(m.to, them).length) {
      facts.push(`Prend ${theName(m.captured)} en ${m.to} : la pièce n’était pas défendue, c’est du matériel gratuit.`);
      tags.add('gain');
    } else if (cv > VALUE[m.piece]) {
      facts.push(`Prend ${theName(m.captured)} avec ${aName(m.piece)} : échange favorable (+${cv - VALUE[m.piece]}).`);
      tags.add('gain');
    } else if (m.isEnPassant()) {
      facts.push('Prise en passant.');
    } else {
      facts.push(`Prend ${theName(m.captured)} en ${m.to}.`);
    }
  }

  if (m.promotion) facts.push(`Promotion en ${NAME[m.promotion]} !`);

  // Échec (simple, double, à la découverte)
  const theirKing = pieces(c, them).find((p) => p.type === 'k');
  const checkers = c.inCheck() ? c.attackers(theirKing.square, me) : [];
  if (checkers.length >= 2) {
    facts.push('Échec double : le roi adverse est obligé de bouger.');
    tags.add('echec-double');
  } else if (checkers.length === 1) {
    if (checkers[0] !== m.to) {
      facts.push(`Échec à la découverte : ${theName(c.get(checkers[0]).type)} en ${checkers[0]} donne échec.`);
      tags.add('decouverte');
    } else {
      facts.push('Donne échec.');
    }
  }

  // Cibles attaquées par la pièce qui vient de bouger
  const targets = pieces(c, them).filter((p) => {
    if (!c.attackers(p.square, me).includes(m.to)) return false;
    if (p.type === 'k') return true;
    return VALUE[p.type] > movedValue || isHanging(c, p.square);
  });
  const valuable = targets.filter((p) => p.type !== 'k');
  if (targets.length >= 2) {
    const names = targets.map((p) => (p.type === 'k' ? 'le roi' : pieceAt(p)));
    facts.push(`Fourchette : ${aName(movedType)} attaque en même temps ${names.slice(0, -1).join(', ')} et ${names.at(-1)}.`);
    tags.add('fourchette');
  } else if (valuable.length === 1 && !checkers.length) {
    facts.push(`Menace ${pieceAt(valuable[0])}.`);
    tags.add('menace');
  }

  // Clouage / enfilade par une pièce à longue portée
  for (const d of dirsOf(movedType)) {
    const [a, b] = firstTwoOnRay(c, m.to, d);
    if (!a || !b || a.color !== them || b.color !== them) continue;
    if (a.type !== 'k' && a.type !== 'p' && (b.type === 'k' || (VALUE[b.type] > VALUE[a.type] && (VALUE[b.type] > movedValue || isHanging(c, b.square))))) {
      facts.push(b.type === 'k'
        ? `Cloue ${pieceAt(a)} sur son roi : ${a.type === 'r' || a.type === 'q' ? 'elle' : 'il'} ne peut plus bouger.`
        : `Cloue ${pieceAt(a)} : ${ifMoves(a.type)}, ${theName(b.type)} en ${b.square} tombe.`);
      tags.add('clouage');
    } else if ((a.type === 'k' || VALUE[a.type] > VALUE[b.type]) && b.type !== 'k' && VALUE[b.type] >= 3) {
      facts.push(`Enfilade : ${a.type === 'k' ? 'le roi' : pieceAt(a)} doit bouger, puis ${pieceAt(b)} tombe.`);
      tags.add('enfilade');
    }
  }

  // Attaque à la découverte (sans échec) : une de nos pièces à longue portée est libérée
  if (!checkers.length || checkers[0] === m.to) {
    for (const p of pieces(c, me)) {
      if (p.square === m.to || !['r', 'b', 'q'].includes(p.type)) continue;
      for (const d of dirsOf(p.type)) {
        // le rayon doit passer par la case de départ du coup
        let [f, r] = coords(p.square);
        let passes = false;
        let hit = null;
        for (;;) {
          f += d[0];
          r += d[1];
          if (f < 0 || f > 7 || r < 0 || r > 7) break;
          const s = sqName(f, r);
          if (s === m.from) passes = true;
          const q = c.get(s);
          if (q) {
            hit = { ...q, square: s };
            break;
          }
        }
        if (passes && hit && hit.color === them && hit.type !== 'k' && VALUE[hit.type] > VALUE[p.type] - 1 && VALUE[hit.type] >= 3) {
          facts.push(`Attaque à la découverte : en partant, la pièce libère ${theName(p.type)} en ${p.square}, qui attaque ${pieceAt(hit)}.`);
          tags.add('decouverte');
        }
      }
    }
  }

  // Défense
  if (myHangingBefore.includes(m.from) && !isHanging(c, m.to)) {
    facts.push(`Met ${theName(m.piece)} à l’abri : la pièce était attaquée.`);
    tags.add('defense');
  }
  for (const s of myHangingBefore) {
    if (s === m.from) continue;
    const p = c.get(s);
    if (p && p.color === me && !isHanging(c, s)) {
      facts.push(`Protège ${theName(p.type)} en ${s}.`);
      tags.add('defense');
    }
  }

  // Ce que le coup laisse en prise
  const isTrade = m.captured && VALUE[m.captured] >= VALUE[m.piece];
  const discoveredCheck = checkers.length && !checkers.includes(m.to);
  const myHangingAfter = hangingSquares(c, me).filter((s) => {
    if (s === m.to) return !isTrade && !discoveredCheck && !c.isCheckmate();
    return !myHangingBefore.includes(s);
  });
  for (const s of myHangingAfter) {
    const p = c.get(s);
    if (s === m.to) facts.push(`Attention : ${theName(p.type)} en ${s} est en prise.`);
    else facts.push(`Laisse ${theName(p.type)} en ${s} sans protection suffisante.`);
    tags.add('en-prise');
  }

  // Principes d'ouverture
  const backRank = me === 'w' ? '1' : '8';
  const opening = moveNo <= 12 && pieces(c).length >= 24;
  const tactical = ['fourchette', 'gain', 'clouage', 'enfilade', 'decouverte', 'menace'].some((t) => tags.has(t));
  if (opening && (m.piece === 'n' || m.piece === 'b') && m.from[1] === backRank && !m.captured) {
    facts.push(`Développe ${theName(m.piece)} : une pièce de plus en jeu.`);
    tags.add('developpement');
  }
  if (opening && moveNo <= 6 && m.piece === 'q' && !m.captured && !checkers.length && !tactical) {
    facts.push('Sortir la dame très tôt l’expose aux attaques des pièces adverses (perte de temps).');
    tags.add('dame-tot');
  }
  if (opening && m.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(m.to) && !m.captured) {
    facts.push('Prend de l’espace au centre.');
    tags.add('centre');
  }
  if (m.piece === 'k' && !m.isKingsideCastle() && !m.isQueensideCastle() && moveNo <= 15 && pieces(c).length > 20) {
    facts.push('Le roi bouge en début de partie : il perd le droit de roquer.');
    tags.add('roi-expose');
  }
  if (m.piece === 'r' && !m.captured) {
    const file = m.to[0];
    let ownPawn = false;
    let theirPawn = false;
    for (let r = 1; r <= 8; r++) {
      const p = c.get(file + r);
      if (p?.type === 'p') p.color === me ? (ownPawn = true) : (theirPawn = true);
    }
    if (!ownPawn && !theirPawn) facts.push('Place la tour sur une colonne ouverte.');
    else if (!ownPawn) facts.push('Place la tour sur une colonne semi-ouverte.');
  }

  return { san: m.san, facts, tags };
}

/** Matériel gagné (+) ou perdu (-) par `color` en suivant la variante principale. */
export function pvMaterialSwing(fen, pv, color, plies = 6) {
  const c = safeChess(fen);
  if (!c) return 0;
  const m0 = material(c);
  let last = 0;
  for (const u of pv.slice(0, plies)) {
    if (!playUci(c, u)) break;
    const m = material(c);
    last = color === 'w' ? m.w - m.b - (m0.w - m0.b) : m.b - m.w - (m0.b - m0.w);
  }
  return last;
}

export const CLASSES = {
  best: { label: 'Meilleur coup', plural: 'Meilleurs coups', sym: '★', css: 'best' },
  excellent: { label: 'Excellent', plural: 'Excellents', sym: '👍', css: 'excellent' }, // « ! » est réservé aux coups forts
  good: { label: 'Bon coup', plural: 'Bons coups', sym: '✓', css: 'good' },
  book: { label: 'Théorie', plural: 'Coups de théorie', sym: '📖', css: 'book' },
  inaccuracy: { label: 'Imprécision', plural: 'Imprécisions', sym: '?!', css: 'inaccuracy' },
  mistake: { label: 'Erreur', plural: 'Erreurs', sym: '?', css: 'mistake' },
  blunder: { label: 'Gaffe', plural: 'Gaffes', sym: '??', css: 'blunder' },
};

/**
 * Classe un coup à partir de l'évaluation avant (meilleure ligne) et après le coup joué.
 * cpBefore / cpAfter : centipions du point de vue des Blancs.
 */
export function classifyMove({ cpBefore, cpAfter, color, isBest }) {
  const sign = color === 'w' ? 1 : -1;
  const before = winPct(cpBefore * sign);
  const after = winPct(cpAfter * sign);
  const loss = Math.max(0, before - after);
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
  let cls;
  if (isBest || loss < 0.5) cls = isBest ? 'best' : 'excellent';
  else if (loss <= 2) cls = 'excellent';
  else if (loss <= 5) cls = 'good';
  else if (loss <= 10) cls = 'inaccuracy';
  else if (loss <= 20) cls = 'mistake';
  else cls = 'blunder';
  return { cls, loss, accuracy };
}

/** Explique pourquoi le meilleur coup (lines[0]) est le meilleur. Renvoie une liste de paragraphes. */
export function explainBest(fen, lines) {
  const best = lines?.[0];
  if (!best) return ['Pas d’analyse disponible.'];
  const c = safeChess(fen);
  const color = c.turn();
  const uci = best.pv[0];
  const d = describeMove(fen, uci);
  const out = [];
  out.push(`**Meilleur coup : ${fig(d.san)}** (${evalText(best)} — ${evalPhrase(best, color)}).`);
  if (d.facts.length) out.push(...d.facts.map((f) => '• ' + f));
  if (best.white.mate !== undefined && (best.white.mate > 0) === (color === 'w')) {
    out.push(`Ce coup force le mat en ${Math.abs(best.white.mate)} : ${pvToSan(fen, best.pv, 12)}.`);
    return out;
  }
  const swing = pvMaterialSwing(fen, best.pv, color);
  if (best.pv.length > 1) out.push(`Suite probable : ${pvToSan(fen, best.pv, 7)}.`);
  if (swing >= 2) out.push(`Au bout de cette suite, tu gagnes environ ${swing} point${swing > 1 ? 's' : ''} de matériel.`);
  else if (swing <= -2 && cpWhite(best) * (color === 'w' ? 1 : -1) > 0) out.push(`Tu donnes du matériel, mais tu récupères bien plus en activité ou en attaque : c’est un vrai sacrifice.`);

  const second = lines[1];
  if (second) {
    const sign = color === 'w' ? 1 : -1;
    const gap = winPct(cpWhite(best) * sign) - winPct(cpWhite(second) * sign);
    if (gap >= 15) out.push(`C’est de loin le meilleur coup : le suivant (${fig(uciToSan(fen, second.pv[0]))}, ${evalText(second)}) fait perdre une grosse partie de l’avantage.`);
    else if (gap < 3) out.push(`D’autres coups se valent, par exemple ${fig(uciToSan(fen, second.pv[0]))} (${evalText(second)}).`);
  }
  if (!d.facts.length && best.pv.length > 1) {
    out.push('Pas de tactique immédiate ici : c’est un coup d’amélioration (meilleure case pour une pièce, préparation d’un plan).');
  }
  return out;
}

/**
 * Explique une erreur : ce que le coup joué permet à l'adversaire, et ce qu'il fallait faire.
 * linesBefore : analyse de `fen` ; linesAfter : analyse de la position après le coup joué.
 */
export function explainMistake(fen, playedUci, linesBefore, linesAfter, { withBest = true } = {}) {
  const c = safeChess(fen);
  const color = c.turn();
  const played = describeMove(fen, playedUci);
  const out = [];
  const best = linesBefore?.[0];
  const reply = linesAfter?.[0];
  const after = safeChess(fen);
  playUci(after, playedUci);
  const afterFen = after.fen();

  const bad = played.facts.filter((f) => f.startsWith('Attention') || f.startsWith('Laisse'));
  out.push(`Tu as joué **${fig(played.san)}**.`);
  if (bad.length) out.push(...bad.map((f) => '• ' + f));

  if (reply?.pv?.length) {
    const r = describeMove(afterFen, reply.pv[0]);
    const mateAgainst = reply.white.mate !== undefined && (reply.white.mate > 0) !== (color === 'w');
    let s = `Ton adversaire peut répondre **${fig(r.san)}**`;
    if (mateAgainst) s += ` et il a un mat en ${Math.abs(reply.white.mate)} (${pvToSan(afterFen, reply.pv, 10)})`;
    out.push(s + '.');
    if (!mateAgainst) {
      if (r.facts.length) out.push(...r.facts.slice(0, 3).map((f) => '• ' + f));
      const theirGain = pvMaterialSwing(afterFen, reply.pv, color === 'w' ? 'b' : 'w');
      if (theirGain >= 2) out.push(`Variante : ${pvToSan(afterFen, reply.pv, 6)} — tu perds environ ${theirGain} points de matériel.`);
      else if (reply.pv.length > 1) out.push(`Variante : ${pvToSan(afterFen, reply.pv, 6)}.`);
    }
  }
  if (withBest && best && best.pv[0] !== playedUci) {
    const b = describeMove(fen, best.pv[0]);
    out.push(`**Il fallait jouer ${fig(b.san)}** (${evalText(best)}).`);
    if (b.facts.length) out.push(...b.facts.slice(0, 3).map((f) => '• ' + f));
  }
  return out;
}

/** Petit conseil de méthode selon le type d'erreur (thèmes détectés). */
export function adviceFor(tags) {
  if (tags.has('en-prise')) return 'Réflexe anti-gaffe : avant de lâcher ta pièce, vérifie qu’aucune de tes pièces n’est attaquée sans défense après ton coup.';
  if (tags.has('fourchette')) return 'Regarde toujours les cases où un cavalier adverse peut attaquer deux pièces à la fois.';
  if (tags.has('clouage')) return 'Quand ta pièce est alignée avec ton roi ou ta dame, méfie-toi des clouages.';
  if (tags.has('mat')) return 'Avant chaque coup, vérifie les échecs que ton adversaire peut donner : ÉCHECS, CAPTURES, MENACES.';
  return 'Routine à chaque coup : quels sont les échecs, captures et menaces possibles — pour moi ET pour mon adversaire ?';
}

// ─────────────── Coups brillants, coups forts, occasions manquées ───────────────

/** Étiquettes superposées aux classes (calculées par computeTags dans analyzer.js). */
export const TAGS = {
  brilliant: { label: 'Coup brillant', plural: 'Coups brillants', sym: '!!', css: 'brilliant' },
  great: { label: 'Coup fort', plural: 'Coups forts', sym: '!', css: 'great' },
  miss: { label: 'Occasion manquée', plural: 'Occasions manquées', sym: '✗', css: 'miss' },
};

/** « 1 coup brillant », « 3 occasions manquées » */
export const tagCount = (tag, n) => `${n} ${(n > 1 ? TAGS[tag].plural : TAGS[tag].label).toLowerCase()}`;

const otherColor = (c) => (c === 'w' ? 'b' : 'w');
const possessive = (t, mine) => (mine ? (t === 'r' || t === 'q' ? 'ta ' : 'ton ') : t === 'r' || t === 'q' ? 'sa ' : 'son ') + NAME[t];
const listFr = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} et ${a.at(-1)}`);
const pct = (v) => `${Math.round(v)}\u00a0%`; // espace insécable : « 53 % » ne se coupe pas
const winOf = (white, color) => winPct(cpWhite({ white }) * (color === 'w' ? 1 : -1));
/** Chances de gain d'après une évaluation du bilan (gère les fins de partie : mat déjà donné, nulle). */
const winOfEval = (e, color) => (e?.over ? (e.over === 'draw' ? 50 : e.over === color ? 100 : 0) : winOf(e?.white || { cp: 0 }, color));
const isMateFor = (white, color) => white?.mate !== undefined && white.mate !== 0 && (white.mate > 0) === (color === 'w');

function fenAfter(fen, uci) {
  const c = safeChess(fen);
  return c && playUci(c, uci) ? c.fen() : fen;
}

/**
 * « Pourquoi c'est brillant » : ce qui est sacrifié et ce que ça rapporte.
 * e0 / e1 : évaluations (format du bilan) avant et après le coup ; sac : résultat de sacrificeOf ;
 * mine : coup du joueur (sinon de son adversaire).
 */
export function explainBrilliant(fen, playedUci, e0, e1, sac, mine = true) {
  const c = safeChess(fen);
  if (!c) return [];
  const color = c.turn();
  const d = describeMove(fen, playedUci);
  const line = [playedUci, ...(e1?.pv || [])];
  const out = ['#### Pourquoi c’est brillant'];
  const n = sac?.deficit || 0;
  const pts = (k) => `${k} point${k > 1 ? 's' : ''} de matériel`;
  if (sac?.offered) {
    const g = sac.given[0];
    out.push(`**${fig(d.san)} est un sacrifice** : ${mine ? 'tu laisses' : 'ton adversaire laisse'} ${possessive(g.type, mine)} en ${g.square} à la merci de ${mine ? 'ton adversaire' : 'tes pièces'}${n ? ` (${mine ? 's’il accepte, tu as' : 'si tu acceptes, il a'} ${pts(n)} en moins)` : ''}.`);
  } else {
    const given = (sac?.given || []).map((g) => possessive(g.type, mine));
    out.push(`**${fig(d.san)} est un sacrifice** : ${mine ? 'tu donnes' : 'ton adversaire donne'} ${listFr(given) || 'du matériel'}${n ? ` (au bilan, ${pts(n)} en moins)` : ''}.`);
  }
  // « Attention : … en prise » décrit le sacrifice lui-même : inutile (et trompeur) de le répéter ici.
  // Si la pièce jouée est prise tout de suite, ses « fourchettes » ou « enfilades » n'auront jamais lieu.
  const movedTaken = !sac?.offered && (sac?.given || []).some((g) => g.square === playedUci.slice(2, 4));
  const facts = d.facts.filter((f) => !/^(Attention|Laisse)/.test(f) && !(movedTaken && /^(Fourchette|Enfilade|Cloue|Menace)/.test(f)));
  if (facts.length) out.push(...facts.slice(0, 3).map((f) => '• ' + f));
  if (isMateFor(e1?.white, color)) {
    out.push(`Et ça force le **mat en ${Math.abs(e1.white.mate) + 1}** : ${pvToSan(fen, line, 12)}.`);
  } else {
    if (sac?.offered && e1?.pv?.length) out.push(`Prendre ${theName(sac.given[0].type)} serait une erreur : la meilleure réponse est ${fig(uciToSan(fenAfter(fen, playedUci), e1.pv[0]))}. Suite probable : ${pvToSan(fen, line, 7)}.`);
    else if (e1?.pv?.length) out.push(`Suite probable : ${pvToSan(fen, line, 7)}.`);
    const swing = pvMaterialSwing(fen, line, color, 7);
    const chances = `${mine ? 'tes' : 'ses'} chances de gain : ${pct(winOfEval(e1, color))}`;
    const verdict = winOfEval(e1, color) >= 55 ? 'favorable' : 'équilibrée'; // « favorable » à 51 % serait exagéré
    if (swing >= 0 && sac?.offered) out.push(`Le cadeau est refusé et le matériel ne baisse pas${swing >= 2 ? ` (au bout de la suite, environ ${pts(swing)} de plus)` : ''} : la position reste ${verdict} (${chances}).`);
    else if (swing >= 0) out.push(`Le matériel est récupéré quelques coups plus tard${swing >= 2 ? `, avec un bénéfice d’environ ${pts(swing)}` : ''} : c’est une combinaison.`);
    else out.push(`Même avec moins de matériel, la position reste ${verdict} (${chances}) : l’activité des pièces et l’attaque ${verdict === 'favorable' ? 'valent plus que' : 'compensent'} le matériel donné.`);
  }
  if (e0?.second && !isMateFor(e0.second, color)) {
    const w2 = winOf(e0.second, color);
    if (winOfEval(e0, color) - w2 >= 5) out.push(`Les autres coups faisaient moins bien : le 2e meilleur ne laissait que ${pct(w2)} de chances de gain${mine ? '' : ' à ton adversaire'}.`);
  }
  out.push(mine ? '*Un sacrifice, ça se calcule : cherche d’abord les coups forcés (échecs, captures, menaces) et vérifie la suite jusqu’au bout.*' : '*Retiens l’idée : quand un roi est mal protégé, un sacrifice peut ouvrir les lignes vers lui.*');
  return out;
}

/** « Le seul bon coup » : ce que donnait la 2e meilleure option. */
export function explainGreat(fen, playedUci, e0, mine = true) {
  const c = safeChess(fen);
  if (!c) return [];
  const color = c.turn();
  const d = describeMove(fen, playedUci);
  const wBest = winOfEval(e0, color);
  const out = ['#### Le seul bon coup'];
  const goal = wBest >= 60 ? 'garder l’avantage' : wBest >= 40 ? 'garder l’équilibre' : 'rester dans la partie';
  out.push(`**${fig(d.san)}** était le seul coup pour ${goal} : ${mine ? 'tu gardes' : 'ton adversaire garde'} ${pct(wBest)} de chances de gain.`);
  if (e0.second) {
    const pov = mine ? color : otherColor(color); // les phrases d'évaluation parlent toujours au joueur
    out.push(`Le 2e meilleur coup les faisait tomber à ${pct(winOf(e0.second, color))} (${evalPhrase({ white: e0.second }, pov)}) : ${mine ? 'tu as' : 'ton adversaire a'} trouvé le bon chemin.`);
  }
  const facts = d.facts.filter((f) => !/^(Attention|Laisse)/.test(f)); // le coup est le bon : pas d'alerte « en prise »
  if (facts.length) out.push(...facts.slice(0, 3).map((f) => '• ' + f));
  if (e0.pv?.length > 1 && e0.pv[0] === playedUci) out.push(`Suite probable : ${pvToSan(fen, e0.pv, 7)}.`);
  return out;
}

/** Une autre option (calculée à la demande) pour montrer ce que donnait un coup « normal ». */
export function explainAlternative(fen, line) {
  const c = safeChess(fen);
  if (!c || !line?.pv?.length) return [];
  const san = uciToSan(fen, line.pv[0]);
  return [`Par exemple, **${fig(san)}** ne laissait que ${pct(winOf(line.white, c.turn()))} de chances de gain : ${pvToSan(fen, line.pv, 6)}.`];
}

/**
 * Occasion manquée : ce que l'adversaire venait de laisser et ce qu'il fallait jouer.
 * prev : { san, cls, num } du coup adverse précédent ; e0 / e1 : évaluations avant / après le coup joué.
 */
export function explainMiss(fen, playedUci, prev, e0, e1, mine = true) {
  const c = safeChess(fen);
  if (!c) return [];
  const color = c.turn();
  const out = ['#### Occasion manquée'];
  const fault = prev?.cls === 'blunder' ? 'une gaffe' : 'une erreur';
  const prevTxt = prev?.san ? ` avec **${prev.num || ''}${fig(prev.san)}**` : '';
  out.push(mine
    ? `Ton adversaire venait de faire ${fault}${prevTxt} : c’était le moment d’en profiter, et ${fig(uciToSan(fen, playedUci))} laisse passer l’occasion.`
    : `Tu venais de faire ${fault}${prevTxt}, et ton adversaire ne l’a pas punie avec ${fig(uciToSan(fen, playedUci))}.`);
  const bestUci = e0?.pv?.[0];
  if (bestUci && bestUci !== playedUci) {
    const b = describeMove(fen, bestUci);
    out.push(`**Il fallait jouer ${fig(b.san)}** (${mine ? 'tes' : 'ses'} chances de gain : ${pct(winOfEval(e0, color))}).`);
    if (b.facts.length) out.push(...b.facts.slice(0, 3).map((f) => '• ' + f));
    if (isMateFor(e0.white, color)) out.push(`Il y avait un **mat en ${Math.abs(e0.white.mate)}** : ${pvToSan(fen, e0.pv, 12)}.`);
    else {
      const swing = pvMaterialSwing(fen, e0.pv, color);
      if (e0.pv.length > 1) out.push(`Suite probable : ${pvToSan(fen, e0.pv, 6)}.`);
      if (swing >= 2) out.push(`Au bout, ${mine ? 'tu gagnais' : 'ton adversaire gagnait'} environ ${swing} points de matériel.`);
    }
  }
  if (e0 && e1) out.push(`Avec le coup joué, ${mine ? 'tes' : 'ses'} chances de gain passent de ${pct(winOfEval(e0, color))} à ${pct(winOfEval(e1, color))}.`);
  if (mine) out.push('*Réflexe : après chaque coup adverse, demande-toi « qu’est-ce qu’il vient de laisser ? » — échecs, captures, menaces.*');
  return out;
}

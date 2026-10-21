// Diagnostic personnalisé : à partir de tes parties analysées, on mesure tes compétences,
// on repère tes erreurs typiques et on en déduit des priorités de travail.
import { ensureDerived } from './analyzer.js';
import { LESSONS } from './data/lessons.js';
import { OPENING_LINES } from './data/openings.js';

export const CATEGORIES = {
  'piece-en-prise': { label: 'Pièces laissées en prise', lessons: ['routine', 'valeurs'], theme: 'hangingPiece', tip: 'Avant chaque coup : « après mon coup, une de mes pièces est-elle attaquée sans être assez défendue ? »' },
  'mat-subi': { label: 'Mats ou attaques sur ton roi non vus', lessons: ['mats', 'routine'], theme: 'mateIn2', tip: 'Regarde tous les échecs possibles de ton adversaire avant de jouer, surtout quand ton roi a peu de défenseurs.' },
  'subi-fourchette': { label: 'Fourchettes subies', lessons: ['fourchette'], theme: 'fork', tip: 'Repère les cases d’où un cavalier ou un pion adverse attaquerait deux de tes pièces.' },
  'subi-clouage': { label: 'Clouages subis', lessons: ['clouage'], theme: 'pin', tip: 'Évite d’aligner ta dame ou ton roi avec une pièce derrière laquelle un fou ou une tour peut clouer.' },
  'subi-enfilade': { label: 'Enfilades subies', lessons: ['enfilade'], theme: 'skewer', tip: 'Roi et dame alignés sur une ligne ouverte = danger d’enfilade.' },
  'subi-decouverte': { label: 'Attaques à la découverte subies', lessons: ['decouverte'], theme: 'discoveredAttack', tip: 'Quand une pièce adverse se trouve entre sa tour/son fou et ta pièce, pense à ce qui se passe si elle bouge.' },
  'subi-echec-double': { label: 'Échecs doubles subis', lessons: ['decouverte'], theme: 'discoveredAttack', tip: 'Surveille les batteries adverses dirigées vers ton roi.' },
  'occasion-manquee': { label: 'Occasions manquées (l’adversaire s’est trompé, tu n’as pas puni)', lessons: ['penser', 'fourchette'], theme: 'mix', tip: 'Après chaque coup adverse : « qu’est-ce qu’il ne défend plus ? » Cherche d’abord les échecs, captures et menaces pour toi.' },
  ouverture: { label: 'Erreurs dans l’ouverture', lessons: ['principes'], theme: 'opening', tip: 'Développe, roque, et entraîne-toi sur les lignes de ton répertoire.' },
  finale: { label: 'Erreurs en finale', lessons: ['pions', 'tours', 'mat-tour'], theme: 'endgame', tip: 'En finale : active ton roi, crée un pion passé, mets la tour derrière les pions passés.' },
  zeitnot: { label: 'Erreurs par manque de temps', lessons: ['penser'], theme: 'mateIn1', tip: 'Joue plus vite l’ouverture que tu connais et garde au moins 1 à 2 minutes pour la fin de partie.' },
};

export const SKILLS = [
  { id: 'opening', label: 'Ouverture', help: 'Précision de tes coups pendant les 10 premiers coups.' },
  { id: 'middle', label: 'Milieu de partie', help: 'Précision de tes coups en milieu de partie.' },
  { id: 'endgame', label: 'Finales', help: 'Précision de tes coups quand il reste peu de pièces.' },
  { id: 'vigilance', label: 'Vigilance (anti-gaffe)', help: 'Moins tu fais de gaffes par partie, plus ce score est haut.' },
  { id: 'opportunism', label: 'Punir les erreurs', help: 'Part des erreurs adverses que tu as su exploiter.' },
  { id: 'conversion', label: 'Convertir un avantage', help: 'Parties gagnées quand tu as eu +3 ou plus.' },
  { id: 'defense', label: 'Défense', help: 'Parties sauvées (nulle ou victoire) quand tu étais à −3 ou moins.' },
  { id: 'time', label: 'Gestion du temps', help: 'Peu de défaites au temps et peu d’erreurs dans le rush final.' },
];

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);

/** Filtre de parties : temps de jeu inclus. */
export function filterGames(games, classes) {
  return games.filter((g) => {
    const tc = g.source === 'bot' ? 'bot' : g.timeClass || 'other';
    return classes.includes(tc);
  });
}

/** Famille d'ouverture lisible pour une partie. */
export function familyOf(g) {
  if (g.family) return g.family;
  const o = g.review?.opening || '';
  return o.split(':')[0].split('(')[0].trim();
}

/**
 * Calcule le diagnostic à partir des parties (analysées ou non).
 */
export function computeInsights(allGames) {
  const games = allGames.filter((g) => g.pgn);
  const analysed = games.filter((g) => g.review?.evals || g.review?.derived);
  const D = analysed.map((g) => ({ g, d: ensureDerived(g) })).filter((x) => x.d);
  const n = D.length;

  // ── compétences ──
  const acc = { o: [], m: [], e: [] };
  let blunders = 0;
  let mistakes = 0;
  let opp = 0;
  let conv = 0;
  let winning = 0;
  let wonWhenWinning = 0;
  let losing = 0;
  let savedWhenLosing = 0;
  let timeLosses = 0;
  let losses = 0;
  let zeitnotErrors = 0;
  let errorsWithClock = 0;
  const cats = {};
  const catsRaw = {};
  const catsGames = {};
  const examples = {};
  for (const { g, d } of D) {
    for (const ph of ['o', 'm', 'e']) acc[ph].push(...d.acc[ph]);
    opp += d.opportunities;
    conv += d.converted;
    if (d.maxAdv >= 300) {
      winning++;
      if (d.score === 1) wonWhenWinning++;
    }
    if (d.minAdv <= -300) {
      losing++;
      if (d.score >= 0.5) savedWhenLosing++;
    }
    if (d.score === 0) losses++;
    if (d.lostOnTime) timeLosses++;
    for (const e of d.errors) {
      if (e.cls === 'blunder') blunders++;
      if (e.cls === 'mistake') mistakes++;
      if (e.cls === 'inaccuracy') continue;
      if (d.hasClock) errorsWithClock++;
      const weight = e.cls === 'blunder' ? 2 : 1;
      for (const c of e.cats) {
        cats[c] = (cats[c] || 0) + weight;
        catsRaw[c] = (catsRaw[c] || 0) + 1;
        (catsGames[c] ||= new Set()).add(g.id);
        (examples[c] ||= []).push({ gameId: g.id, i: e.i, fen: e.fen, played: e.played, best: e.best, cls: e.cls });
      }
      if (e.cats.includes('zeitnot')) zeitnotErrors++;
    }
  }
  const bpg = n ? blunders / n : null;
  const skills = {
    opening: mean(acc.o),
    middle: mean(acc.m),
    endgame: acc.e.length >= 15 ? mean(acc.e) : null,
    vigilance: n ? 100 * Math.exp(-0.35 * bpg) : null,
    opportunism: opp >= 5 ? pct(conv, opp) : null,
    conversion: winning >= 3 ? pct(wonWhenWinning, winning) : null,
    defense: losing >= 3 ? pct(savedWhenLosing, losing) : null,
    time: errorsWithClock >= 5 ? Math.max(0, 100 - pct(zeitnotErrors, errorsWithClock) * 1.5 - (losses ? pct(timeLosses, losses) : 0)) : null,
  };
  for (const k of Object.keys(skills)) if (skills[k] !== null) skills[k] = Math.round(skills[k]);

  // ── ouvertures ──
  const openings = {};
  for (const g of games) {
    const fam = familyOf(g) || 'Inconnue';
    const key = g.userColor + '|' + fam;
    const o = (openings[key] ||= { color: g.userColor, family: fam, n: 0, score: 0, scored: 0, evals: [], accs: [], openingErrors: 0 });
    o.n++;
    const d = g.review?.derived;
    const sc = typeof g.score === 'number' ? g.score : d?.score;
    if (sc !== null && sc !== undefined) {
      o.score += sc;
      o.scored++;
    }
    if (d) {
      o.evals.push(d.evalAt20);
      if (d.acc.o.length) o.accs.push(mean(d.acc.o));
      o.openingErrors += d.errors.filter((e) => e.phase === 'o' && e.cls !== 'inaccuracy').length;
    }
  }
  const openingList = Object.values(openings)
    .map((o) => ({
      ...o,
      scorePct: o.scored ? Math.round((100 * o.score) / o.scored) : null,
      evalAt20: o.evals.length ? Math.round(mean(o.evals)) : null,
      openingAcc: o.accs.length ? Math.round(mean(o.accs)) : null,
      problem: o.n >= 3 && ((o.scored && o.score / o.scored < 0.4) || (o.evals.length >= 2 && mean(o.evals) < -80)),
    }))
    .sort((a, b) => b.n - a.n);

  // ── style de jeu ──
  const style = computeStyle(D, games);

  // ── priorités ──
  const weaknesses = rankWeaknesses({ n, cats, catsRaw, catsGames, examples, skills, bpg, openingList, timeLosses, losses });

  return { total: games.length, analysed: n, blunders, mistakes, bpg, skills, cats, catsRaw, examples, openings: openingList, style, weaknesses, timeLosses, losses };
}

function computeStyle(D, games) {
  let cc = 0;
  let early = 0;
  const open = [];
  const closed = [];
  const sharp = [];
  const calm = [];
  let lateCastle = 0;
  let earlyQueen = 0;
  for (const { d } of D) {
    cc += d.capturesChecks;
    early += d.earlyMoves;
    if (d.score === null || d.score === undefined) continue;
    if (d.pawnsAt30 <= 11) open.push(d.score);
    else if (d.pawnsAt30 >= 14) closed.push(d.score);
    const swing = d.maxAdv - d.minAdv;
    (swing >= 600 ? sharp : calm).push(d.score);
    if (d.castledAt === null || d.castledAt > 24) lateCastle++;
    if (d.earlyQueen) earlyQueen++;
  }
  const activity = early ? cc / early : null; // part de captures/échecs dans les 20 premiers coups
  const openPerf = open.length >= 3 && closed.length >= 3 ? mean(open) - mean(closed) : null;
  const sharpPerf = sharp.length >= 3 && calm.length >= 3 ? mean(sharp) - mean(calm) : null;
  // préférence tactique entre 0 (positionnel) et 1 (tacticien)
  let tactical = 0.5;
  if (activity !== null) tactical += Math.max(-0.25, Math.min(0.25, (activity - 0.25) * 2));
  if (sharpPerf !== null) tactical += Math.max(-0.25, Math.min(0.25, sharpPerf));
  tactical = Math.max(0, Math.min(1, tactical));
  // ce que tu joues réellement
  const asWhite = {};
  const vsE4 = {};
  const vsD4 = {};
  for (const g of games) {
    const fam = familyOf(g) || '?';
    const first = g.review?.derived?.firstMove || (g.pgn.match(/\n1\.\s*(\S+)/)?.[1] ?? '');
    if (g.userColor === 'w') asWhite[fam] = (asWhite[fam] || 0) + 1;
    else if (first === 'e4') vsE4[fam] = (vsE4[fam] || 0) + 1;
    else if (first === 'd4') vsD4[fam] = (vsD4[fam] || 0) + 1;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const n = D.length;
  let label = 'Équilibré';
  if (tactical >= 0.62) label = 'Tacticien / attaquant';
  else if (tactical <= 0.38) label = 'Positionnel / solide';
  return {
    label,
    tactical,
    activity: activity !== null ? Math.round(activity * 100) : null,
    openPerf,
    sharpPerf,
    openGames: open.length,
    closedGames: closed.length,
    lateCastlePct: n ? pct(lateCastle, n) : null,
    earlyQueenPct: n ? pct(earlyQueen, n) : null,
    mainWhite: top(asWhite),
    mainVsE4: top(vsE4),
    mainVsD4: top(vsD4),
  };
}

function rankWeaknesses({ n, cats, catsRaw, catsGames, examples, skills, bpg, openingList, timeLosses, losses }) {
  if (!n) return [];
  const list = [];
  for (const [id, w] of Object.entries(cats)) {
    const def = CATEGORIES[id];
    if (!def || catsRaw[id] < 2) continue; // un cas isolé n'est pas une tendance
    const perGame = w / n;
    const inGames = catsGames[id].size;
    list.push({
      id,
      title: def.label,
      priority: perGame * (id === 'piece-en-prise' || id === 'mat-subi' ? 1.3 : 1),
      detail: `${catsRaw[id]} erreur${catsRaw[id] > 1 ? 's' : ''} de ce type, dans ${inGames} partie${inGames > 1 ? 's' : ''} sur ${n} (${Math.round((100 * inGames) / n)} %)`,
      tip: def.tip,
      lessons: def.lessons,
      theme: def.theme,
      examples: (examples[id] || []).slice(-5),
    });
  }
  // compétences faibles
  const known = Object.entries(skills).filter(([, v]) => v !== null);
  const avgSkill = mean(known.map(([, v]) => v)) || 0;
  if (skills.conversion !== null && skills.conversion < 60) {
    list.push({ id: 'conversion', title: 'Convertir un avantage en victoire', priority: (60 - skills.conversion) / 25, detail: `Tu ne gagnes que ${skills.conversion} % des parties où tu as eu +3`, tip: 'Quand tu es gagnant : échange les pièces (pas les pions), mets ton roi à l’abri et élimine le contre-jeu avant d’attaquer.', lessons: ['structures', 'mat-dame'], theme: 'endgame', examples: [] });
  }
  if (skills.time !== null && skills.time < 60) {
    list.push({ id: 'time', title: 'Gestion du temps', priority: (60 - skills.time) / 25, detail: `${timeLosses} défaite(s) au temps sur ${losses} défaites`, tip: CATEGORIES.zeitnot.tip, lessons: ['penser'], theme: 'mateIn1', examples: [] });
  }
  if (skills.endgame !== null && skills.endgame < avgSkill - 6) {
    list.push({ id: 'endgame-skill', title: 'Les finales', priority: (avgSkill - skills.endgame) / 10, detail: `Précision en finale ${skills.endgame} % contre ${Math.round(avgSkill)} % en moyenne`, tip: CATEGORIES.finale.tip, lessons: ['pions', 'tours', 'mat-tour'], theme: 'endgame', examples: [] });
  }
  for (const o of openingList.filter((x) => x.problem).slice(0, 2)) {
    list.push({ id: 'opening:' + o.color + o.family, title: `Ouverture : ${o.family} (${o.color === 'w' ? 'Blancs' : 'Noirs'})`, priority: 0.6 + (o.n / 20), detail: `${o.n} parties, ${o.scorePct ?? '?'} % de points${o.evalAt20 !== null ? `, éval. moyenne au coup 10 : ${(o.evalAt20 / 100).toFixed(1)}` : ''}`, tip: 'Revois les lignes de cette ouverture dans « Cours → Ouvertures » et analyse tes défaites dans cette ouverture.', lessons: ['principes'], theme: 'opening', opening: o, examples: [] });
  }
  if (bpg !== null && bpg > 1.5 && !list.some((x) => x.id === 'piece-en-prise')) {
    list.push({ id: 'blunders', title: 'Trop de gaffes', priority: bpg / 2, detail: `${Math.round(bpg * 10) / 10} gaffe(s) par partie`, tip: CATEGORIES['piece-en-prise'].tip, lessons: ['routine'], theme: 'hangingPiece', examples: [] });
  }
  return list.sort((a, b) => b.priority - a.priority).slice(0, 5);
}

/** Lignes d'ouverture à travailler pour une famille d'ouverture chess.com. */
export function linesForFamily(family, color) {
  const f = (family || '').toLowerCase();
  const map = [
    [/caro/, ['ck']],
    [/slav/, ['slav', 'qg']],
    [/queens gambit declined/, color === 'w' ? ['qg'] : ['qgd-black']],
    [/queens gambit accepted/, ['qg']],
    [/queens gambit/, color === 'w' ? ['qg'] : ['qgd-black', 'slav']],
    [/london/, color === 'w' ? ['london'] : ['slav']],
    [/indian|grunfeld|benoni|dutch|englund|queens pawn/, color === 'w' ? ['qg-other', 'qg'] : ['slav']],
    [/italian|giuoco|two knights|fried/, color === 'w' ? ['italian'] : ['e5']],
    [/ruy|spanish|scotch|petrov|russian|kings pawn|philidor/, color === 'w' ? ['italian'] : ['e5']],
    [/scandinavian|center counter/, ['scandi']],
  ];
  for (const [re, groups] of map) if (re.test(f)) return OPENING_LINES.filter((l) => groups.includes(l.group));
  return [];
}

export const lessonTitle = (id) => LESSONS.find((l) => l.id === id)?.title || id;

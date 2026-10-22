// Programme personnalisé sur 7 jours, construit à partir du diagnostic (insights.js).
import { db, update, dayOf, today } from './storage.js';
import { LESSONS } from './data/lessons.js';
import { OPENING_LINES } from './data/openings.js';
import { linesForFamily, lessonTitle } from './insights.js';
import { LEVELS } from './bot.js';
import { THEME_LABELS } from './data/themes.js';
import { visionStats } from './views/vision.js';
import { rushStats } from './views/rush.js';
import { woodpeckerStatus } from './views/woodpecker.js';
import { blunderStats } from './views/blunder.js';

const dayKey = (offset) => dayOf(Date.now() + offset * 86400000);
const onDay = (d, t) => !!d && dayOf(d) === t;

function nearestLevel(elo) {
  return LEVELS.reduce((a, l) => (Math.abs(l.elo - elo) < Math.abs(a.elo - elo) ? l : a)).elo;
}

/**
 * Une semaine type, inspirée des méthodes qui marchent (Heisman, Woodpecker, Dvoretsky, Chernev) :
 * vision de l'échiquier chaque jour tant qu'elle n'est pas solide, tactique ciblée sur tes faiblesses,
 * répétition espacée de tes erreurs, une leçon un jour sur deux, des parties suivies d'une analyse
 * (d'abord par toi, puis par Stockfish), et un bilan en fin de semaine.
 */
export function buildProgram(ins) {
  const s = db();
  const W = ins.weaknesses.length ? ins.weaknesses.slice(0, 3) : [];
  const elo = s.profile.currentElo || s.profile.startElo;
  const level = nearestLevel(elo + 150);
  const vision = visionStats();
  const visionWeak = vision.level !== 'solide';
  const wood = woodpeckerStatus();
  // pièces laissées en prise : la cause n°1 des défaites sous 1200 ; sans parties analysées, on suppose que oui
  const blunderWeak = !ins.analysed || (ins.bpg ?? 0) >= 1 || W.some((w) => ['piece-en-prise', 'blunders'].includes(w.id));

  // leçons : repérage d'abord si la vision est faible, puis celles liées à tes faiblesses, puis le programme normal
  const lessonQueue = [];
  if (visionWeak && !s.lessons.reperage?.done) lessonQueue.push('reperage');
  for (const w of W) for (const id of w.lessons) if (!lessonQueue.includes(id)) lessonQueue.push(id);
  for (const l of LESSONS) if (!s.lessons[l.id]?.done && !lessonQueue.includes(l.id)) lessonQueue.push(l.id);
  lessonQueue.sort((a, b) => (s.lessons[a]?.done ? 1 : 0) - (s.lessons[b]?.done ? 1 : 0));

  // ouvertures : celles où tu perds des points, sinon ton répertoire principal
  const openingQueue = [];
  for (const w of W) if (w.opening) for (const l of linesForFamily(w.opening.family, w.opening.color)) openingQueue.push(l.id);
  for (const o of ins.openings.filter((x) => x.problem)) for (const l of linesForFamily(o.family, o.color)) if (!openingQueue.includes(l.id)) openingQueue.push(l.id);
  for (const l of OPENING_LINES.filter((x) => ['qg', 'ck', 'slav'].includes(x.group))) if (!openingQueue.includes(l.id)) openingQueue.push(l.id);

  const themes = W.length ? W.map((w) => w.theme) : ['hangingPiece', 'fork', 'mix'];
  const why = (k) => W[k % Math.max(1, W.length)]?.title;
  let li = 0;
  let oi = 0;
  let ti = 0;
  const lesson = () => {
    if (!lessonQueue.length) return null;
    const id = lessonQueue[li++ % lessonQueue.length];
    return { type: 'lesson', id, label: `Leçon : ${lessonTitle(id)}`, why: id === 'reperage' ? 'Te repérer sur l’échiquier' : W.find((w) => w.lessons.includes(id))?.title };
  };
  const opening = () => {
    if (!openingQueue.length) return null;
    const id = openingQueue[oi++ % openingQueue.length];
    return { type: 'opening', lineId: id, label: `Ouverture : ${OPENING_LINES.find((l) => l.id === id).name}` };
  };
  const tactics = (count) => {
    const theme = themes[ti % themes.length] || 'mix';
    const w = why(ti++);
    return { type: 'puzzles', theme, count, label: `${count} exercices « ${THEME_LABELS[theme] || 'mélange'} »`, why: w };
  };
  const visionItem = { type: 'vision', label: 'Vision : le défi du jour (5 min)', why: 'Te repérer sur l’échiquier sans regarder les lettres' };
  const mistakes = s.mistakes.length || ins.analysed ? { type: 'mistakes', label: 'Revoir « Mes erreurs » du jour' } : null;
  const woodItem = { type: 'woodpecker', label: !wood.active ? 'Woodpecker : commence ton lot (au moins 10 exercices)' : wood.cycleFinished ? `Woodpecker : commence le cycle ${wood.cycle + 1} (au moins 10 exercices)` : `Woodpecker : continue ton cycle ${wood.cycle} (au moins 10 exercices)`, why: 'Transformer les motifs tactiques en réflexes' };
  const rushItem = { type: 'rush', count: 2, label: '2 courses contre la montre', why: 'Le coup d’œil tactique' };
  const playItem = { type: 'play', elo: level, label: `1 partie contre l’ordinateur ${level}` };
  const selfItem = { type: 'selfreview', label: 'Auto-analyse de ta dernière partie, puis son bilan Stockfish', why: 'Apprendre à trouver tes erreurs tout seul' };
  const blunderItem = { type: 'blunder', count: 10, label: 'Anti-gaffe : 10 positions « Sûr ou gaffe ? »', why: 'Vérifier chaque coup avant de le jouer' };
  const guessItem = { type: 'guess', label: 'Devine le coup : au moins 10 coups d’une partie modèle', why: 'Comprendre les plans des bons joueurs' };

  const plan = [
    [visionWeak && visionItem, blunderItem, tactics(10), mistakes, lesson()],
    [visionWeak && visionItem, blunderWeak && blunderItem, woodItem, opening(), playItem],
    [visionWeak && visionItem, blunderItem, tactics(10), mistakes, lesson(), selfItem],
    [visionWeak && visionItem, blunderWeak && blunderItem, rushItem, opening(), playItem],
    [visionWeak && visionItem, blunderItem, tactics(10), mistakes, lesson(), guessItem],
    [visionWeak && visionItem, blunderWeak && blunderItem, woodItem, opening(), playItem, selfItem],
    [rushItem, tactics(15), guessItem, { type: 'analyze', label: 'Bilan de la semaine : synchronise chess.com, analyse tes parties et génère un nouveau programme' }],
  ];
  const days = plan.map((items, d) => ({ date: dayKey(d), items: items.filter(Boolean) }));
  const focus = [...(visionWeak ? ['Vision de l’échiquier'] : []), ...(blunderWeak && !W.some((w) => ['piece-en-prise', 'blunders'].includes(w.id)) ? ['Ne plus laisser de pièces en prise'] : []), ...W.map((w) => w.title)];
  const program = { created: new Date().toISOString(), focus, days };
  update((x) => (x.program = program));
  return program;
}

/** Programme du jour (ou null si le programme est terminé). */
export function todayItems() {
  const p = db().program;
  if (!p) return null;
  const d = p.days.find((x) => x.date === today());
  return d ? d.items : null;
}

/** L'élément est-il déjà fait aujourd'hui ? */
export function isDone(item) {
  const s = db();
  const t = today();
  switch (item.type) {
    case 'puzzles': {
      const h = s.puzzles.history.filter((x) => onDay(x.date, t) && ['lichess', 'rush', 'woodpecker'].includes(x.kind) && (item.theme === 'mix' || x.theme === item.theme));
      return h.length >= item.count;
    }
    case 'mistakes':
      return !s.mistakes.some((m) => m.due <= Date.now()) || s.puzzles.history.filter((x) => onDay(x.date, t) && x.kind === 'mistake').length >= 5;
    case 'lesson':
      return !!onDay(s.lessons[item.id]?.date, t);
    case 'opening':
      return !!onDay(s.openings[item.lineId]?.last, t);
    case 'play':
      return s.games.some((g) => g.source === 'bot' && onDay(g.date, t));
    case 'analyze':
      return onDay(s.sync?.at, t);
    case 'vision': {
      const v = visionStats();
      return v.dailyDone || v.today >= 3;
    }
    case 'rush':
      return rushStats().today.runs >= (item.count || 1);
    case 'woodpecker':
      // au moins 10 exercices du lot aujourd'hui (ou un cycle bouclé) : ouvrir la page ne suffit pas
      return s.puzzles.history.filter((x) => onDay(x.date, t) && x.kind === 'woodpecker').length >= 10 || !!s.woodpecker?.cycles?.some((c) => onDay(c.finishedAt, t));
    case 'selfreview':
      return Object.values(s.selfReviews || {}).some((r) => onDay(r.date, t));
    case 'guess':
      // au moins 10 coups devinés aujourd'hui, ou une partie modèle terminée
      return s.guessDay?.date === t && (s.guessDay.n >= 10 || !!s.guessDay.finished);
    case 'blunder':
      return blunderStats().today >= (item.count || 10);
    default:
      return false;
  }
}

/** Dernière partie sans auto-analyse (pour l'élément « auto-analyse »). */
function lastGameToSelfReview() {
  const s = db();
  const done = s.selfReviews || {};
  return [...s.games].reverse().find((g) => !done[g.id]) || s.games.at(-1) || null;
}

export function itemHref(item) {
  switch (item.type) {
    case 'puzzles':
      return `#/puzzles/theme/${item.theme}`;
    case 'mistakes':
      return '#/puzzles/mistakes';
    case 'lesson':
      return `#/lesson/${item.id}`;
    case 'opening':
      return `#/opening/${item.lineId}/train`;
    case 'play':
      return `#/play/${item.elo}`;
    case 'analyze':
      return '#/profile';
    case 'vision':
      return '#/vision/daily';
    case 'rush':
      return '#/rush';
    case 'woodpecker':
      return '#/woodpecker';
    case 'guess':
      return '#/guess';
    case 'blunder':
      return '#/gaffe';
    case 'selfreview': {
      const g = lastGameToSelfReview();
      return g ? `#/selfreview/${g.id}` : '#/play';
    }
    default:
      return '#/';
  }
}

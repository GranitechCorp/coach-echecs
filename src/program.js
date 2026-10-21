// Programme personnalisé sur 7 jours, construit à partir du diagnostic (insights.js).
import { db, update } from './storage.js';
import { LESSONS } from './data/lessons.js';
import { OPENING_LINES } from './data/openings.js';
import { linesForFamily, lessonTitle } from './insights.js';
import { LEVELS } from './bot.js';
import { THEME_LABELS } from './data/themes.js';

const today = () => new Date().toISOString().slice(0, 10);
const dayKey = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

function nearestLevel(elo) {
  return LEVELS.reduce((a, l) => (Math.abs(l.elo - elo) < Math.abs(a.elo - elo) ? l : a)).elo;
}

export function buildProgram(ins) {
  const s = db();
  const W = ins.weaknesses.length ? ins.weaknesses.slice(0, 3) : [];
  const elo = s.profile.currentElo || s.profile.startElo;
  const level = nearestLevel(elo + 150);

  // leçons : d'abord celles liées à tes faiblesses, puis le programme normal
  const lessonQueue = [];
  for (const w of W) for (const id of w.lessons) if (!lessonQueue.includes(id)) lessonQueue.push(id);
  for (const l of LESSONS) if (!s.lessons[l.id]?.done && !lessonQueue.includes(l.id)) lessonQueue.push(l.id);
  lessonQueue.sort((a, b) => (s.lessons[a]?.done ? 1 : 0) - (s.lessons[b]?.done ? 1 : 0));

  // ouvertures : celles où tu perds des points, sinon ton répertoire principal
  const openingQueue = [];
  for (const w of W) if (w.opening) for (const l of linesForFamily(w.opening.family, w.opening.color)) openingQueue.push(l.id);
  for (const o of ins.openings.filter((x) => x.problem)) for (const l of linesForFamily(o.family, o.color)) if (!openingQueue.includes(l.id)) openingQueue.push(l.id);
  for (const l of OPENING_LINES.filter((x) => ['qg', 'ck', 'slav'].includes(x.group))) if (!openingQueue.includes(l.id)) openingQueue.push(l.id);

  const themes = W.length ? W.map((w) => w.theme) : ['hangingPiece', 'fork', 'mix'];
  const days = [];
  let li = 0;
  let oi = 0;
  for (let d = 0; d < 7; d++) {
    const items = [];
    const theme = themes[d % themes.length] || 'mix';
    items.push({ type: 'puzzles', theme, count: d >= 5 ? 15 : 10, label: `${d >= 5 ? 15 : 10} exercices « ${THEME_LABELS[theme] || 'mélange'} »`, why: W[d % Math.max(1, W.length)]?.title });
    if (s.mistakes.length || ins.analysed) items.push({ type: 'mistakes', label: 'Revoir « Mes erreurs » du jour' });
    if (d % 2 === 0 && lessonQueue.length) {
      const id = lessonQueue[li++ % lessonQueue.length];
      items.push({ type: 'lesson', id, label: `Leçon : ${lessonTitle(id)}`, why: W.find((w) => w.lessons.includes(id))?.title });
    }
    if (d % 2 === 1 && openingQueue.length) {
      const id = openingQueue[oi++ % openingQueue.length];
      const line = OPENING_LINES.find((l) => l.id === id);
      items.push({ type: 'opening', lineId: id, label: `Ouverture : ${line.name}` });
    }
    if (d % 2 === 1 || d === 6) items.push({ type: 'play', elo: level, label: `1 partie contre l’ordinateur ${level} puis son bilan` });
    if (d === 6) items.push({ type: 'analyze', label: 'Bilan de la semaine : synchronise chess.com, analyse tes parties et génère un nouveau programme' });
    days.push({ date: dayKey(d), items });
  }
  const program = { created: new Date().toISOString(), focus: W.map((w) => w.title), days };
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
      const h = s.puzzles.history.filter((x) => x.date?.startsWith(t) && x.kind === 'lichess' && (item.theme === 'mix' || x.theme === item.theme));
      return h.length >= item.count;
    }
    case 'mistakes':
      return !s.mistakes.some((m) => m.due <= Date.now()) || s.puzzles.history.filter((x) => x.date?.startsWith(t) && x.kind === 'mistake').length >= 5;
    case 'lesson':
      return !!s.lessons[item.id]?.date?.startsWith(t);
    case 'opening':
      return !!s.openings[item.lineId]?.last?.startsWith(t);
    case 'play':
      return s.games.some((g) => g.source === 'bot' && g.date?.startsWith(t));
    case 'analyze':
      return new Date(s.sync?.at || 0).toISOString().startsWith(t);
    default:
      return false;
  }
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
    default:
      return '#/';
  }
}

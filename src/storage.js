// Toutes les données restent sur le téléphone (localStorage). Export/import JSON pour sauvegarder.

const KEY = 'coach-echecs-v1';

const DEFAULTS = () => ({
  settings: {
    apiKey: '',
    model: 'claude-opus-5-5',
    showEvalDefault: false,
    liveCoach: true,
    sound: true,
    aiEnabled: false, // boutons ✨ (Claude) masqués par défaut : tout fonctionne en local
  },
  profile: { startElo: 900, goalElo: 1600, chesscomUser: 'Granitech', currentElo: null },
  games: [], // { id, date, pgn, white, black, result, source, botElo, userColor, review? }
  puzzles: { rating: 900, played: 0, solved: 0, history: [], themes: {} },
  mistakes: [], // positions ratées tirées de tes parties { id, fen, best, played, gameId, box, due }
  lessons: {}, // id -> { done: true, date }
  openings: {}, // lineId -> { box, due, ok, ko }
  streak: { last: '', days: 0 },
  botResults: {}, // elo -> { w, d, l }
});

let state = null;

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? merge(DEFAULTS(), JSON.parse(raw)) : DEFAULTS();
  } catch {
    state = DEFAULTS();
  }
  return state;
}

function merge(base, saved) {
  for (const k of Object.keys(saved)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) {
      base[k] = merge(base[k], saved[k]);
    } else {
      base[k] = saved[k];
    }
  }
  return base;
}

export function save() {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return;
    } catch (e) {
      // stockage plein : on allège les plus anciennes analyses (on garde le résumé qui sert au diagnostic,
      // le détail coup par coup sera recalculé si tu rouvres le bilan)
      const heavy = state.games.filter((g) => g.review?.evals);
      if (!heavy.length) {
        console.warn('Sauvegarde impossible', e);
        return;
      }
      for (const g of heavy.slice(0, Math.max(5, Math.ceil(heavy.length / 4)))) {
        delete g.review.evals;
        g.review.light = true;
      }
    }
  }
}

export const db = () => load();

export function update(fn) {
  fn(load());
  save();
}

export function exportData() {
  const copy = JSON.parse(JSON.stringify(load()));
  copy.settings.apiKey = ''; // la clé API ne part jamais dans une sauvegarde
  return JSON.stringify(copy, null, 1);
}

export function importData(json) {
  const parsed = JSON.parse(json);
  const key = load().settings.apiKey;
  state = merge(DEFAULTS(), parsed);
  if (!state.settings.apiKey) state.settings.apiKey = key;
  save();
}

export function resetAll() {
  const key = load().settings.apiKey;
  state = DEFAULTS();
  state.settings.apiKey = key;
  save();
}

/**
 * Jour (AAAA-MM-JJ) à l'heure du téléphone, pas en UTC : en France, une séance faite à minuit et demi
 * compte pour le bon jour. Accepte un horodatage ISO, des millisecondes ou une date déjà au format jour.
 */
export function dayOf(t = Date.now()) {
  if (typeof t === 'string' && t.length === 10) return t;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const today = () => dayOf();
/** Vrai si la date (ISO ou millisecondes) tombe aujourd'hui, à l'heure du téléphone. */
export const isToday = (t) => !!t && dayOf(t) === today();

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Marque l'activité du jour (série de jours consécutifs). */
export function touchStreak() {
  update((s) => {
    const t = today();
    if (s.streak.last === t) return;
    const y = dayOf(Date.now() - 86400000);
    s.streak.days = s.streak.last === y ? s.streak.days + 1 : 1;
    s.streak.last = t;
  });
}

// Répétition espacée (boîtes de Leitner) : 0 → demain, puis 2, 4, 8, 16 jours…
export function scheduleNext(card, ok) {
  const box = ok ? Math.min((card.box || 0) + 1, 6) : 0;
  const days = box === 0 ? 0.5 : 2 ** (box - 1);
  return { ...card, box, due: Date.now() + days * 86400000 };
}

// Banque d'exercices intégrée (fonctionne hors ligne et dans claude.ai).
// Positions tirées de parties d'entraînement : un seul coup gagne nettement (vérifié par Stockfish).
import { BANK } from './puzzle-bank-data.js';

/** Choisit un exercice proche du classement, sur le thème demandé, pas encore vu récemment. */
export function pickFromBank(theme, rating, seen = []) {
  const recent = new Set(seen.slice(-300));
  let pool = BANK.filter((p) => !recent.has(p.id) && (theme === 'mix' || p.themes.includes(theme)));
  if (!pool.length) pool = BANK.filter((p) => theme === 'mix' || p.themes.includes(theme));
  if (!pool.length) pool = BANK;
  if (!pool.length) return null;
  const near = pool.filter((p) => Math.abs(p.rating - rating) <= 250);
  const list = near.length ? near : pool;
  return { ...list[Math.floor(Math.random() * list.length)] };
}

export const bankSize = () => BANK.length;

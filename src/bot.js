// Adversaire à niveau réglable.
// ≥ 1350 Elo : on utilise le limiteur officiel de Stockfish (UCI_Elo).
// < 1350 : Stockfish calcule ses meilleurs coups (MultiPV) puis on en choisit un au hasard,
// pondéré par la perte qu'il entraîne — plus le niveau est bas, plus il se trompe (de façon humaine).
import { cpWhite } from './chessutil.js';

export const LEVELS = [
  { elo: 400, label: 'Débutant', temp: 260, blunder: 0.22, depth: 6 },
  { elo: 600, label: 'Novice', temp: 170, blunder: 0.15, depth: 7 },
  { elo: 800, label: 'Club débutant', temp: 115, blunder: 0.1, depth: 8 },
  { elo: 1000, label: 'Amateur', temp: 75, blunder: 0.06, depth: 9 },
  { elo: 1200, label: 'Amateur+', temp: 45, blunder: 0.035, depth: 10 },
  { elo: 1400, label: 'Intermédiaire' },
  { elo: 1600, label: 'Objectif !' },
  { elo: 1800, label: 'Confirmé' },
  { elo: 2000, label: 'Expert' },
  { elo: 2400, label: 'Maître' },
];

export const levelFor = (elo) => LEVELS.reduce((a, l) => (Math.abs(l.elo - elo) < Math.abs(a.elo - elo) ? l : a));

/** Choisit le coup de l'ordinateur. Renvoie un coup UCI. */
export async function chooseBotMove(engine, fen, elo) {
  const lvl = levelFor(elo);
  if (!lvl.temp) {
    const movetime = elo >= 2000 ? 1000 : 600;
    const res = await engine.search(fen, { movetime, elo });
    return res.bestmove;
  }
  const res = await engine.search(fen, { depth: lvl.depth, multipv: 8 });
  const lines = res.lines.filter((l) => l.pv?.length);
  if (!lines.length) return res.bestmove;
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  const scores = lines.map((l) => cpWhite(l) * sign);
  const top = scores[0];

  // de temps en temps, une vraie gaffe : un coup pris parmi les moins bons
  if (lines.length > 3 && Math.random() < lvl.blunder) {
    const pool = lines.slice(Math.floor(lines.length / 2));
    return pool[Math.floor(Math.random() * pool.length)].pv[0];
  }
  // sinon un choix « softmax » : les coups proches du meilleur sont les plus probables
  const weights = scores.map((s) => Math.exp(-(top - Math.min(s, top)) / lvl.temp));
  // ne rate presque jamais un mat en 1 au-dessus de 800
  if (elo >= 800 && lines[0].white.mate !== undefined && Math.abs(lines[0].white.mate) === 1 && top > 0) return lines[0].pv[0];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < lines.length; i++) {
    r -= weights[i];
    if (r <= 0) return lines[i].pv[0];
  }
  return lines[0].pv[0];
}

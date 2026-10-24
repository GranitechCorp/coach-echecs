// Étalonnage de l'ordinateur (src/bot.js) : pour chaque niveau, perte moyenne par coup et part de gaffes,
// mesurées contre une analyse plus profonde, à comparer aux joueurs humains du même niveau.
// Usage : node scripts/calibrate-bot.mjs [parties.json…]   (positions tirées des parties modèles et des fichiers donnés)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Chess } from 'chess.js';
import { NodeEngine } from './uci.mjs';
import { LEVELS, moveChances } from '../src/bot.js';
import { MODEL_GAMES } from '../src/data/model-games.js';

// Repères humains (parties rapides en ligne, ordres de grandeur) : perte moyenne par coup (centipions, plafonnée
// à 10 pions) et part des coups qui perdent 2 pions ou plus.
const HUMAN = { 400: [200, 18], 600: [150, 13], 800: [115, 9.5], 1000: [90, 7], 1200: [72, 5], 1400: [58, 3.6], 1600: [47, 2.6], 1800: [38, 1.8] };
const CACHE = new URL('./.calibrate-cache.json', import.meta.url);
const CAP = 1000;

const fens = [];
const addGame = (sans) => {
  const c = new Chess();
  sans.forEach((san, i) => {
    try {
      c.move(san);
    } catch {
      return;
    }
    if (i >= 6 && i <= 70 && i % 4 === 0 && !c.isGameOver()) fens.push(c.fen());
  });
};
for (const g of MODEL_GAMES) addGame(typeof g.moves === 'string' ? g.moves.split(' ') : g.moves);
for (const f of process.argv.slice(2)) {
  for (const g of JSON.parse(readFileSync(f, 'utf8')).games || []) {
    const c = new Chess();
    try {
      c.loadPgn(g.pgn);
      addGame(c.history());
    } catch {
      /* partie illisible */
    }
  }
}
console.log(fens.length, 'positions');

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let engine = null; // démarré seulement si une analyse manque au cache
const toLine = (fen, l) => {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  return { pv: l.pv, white: l.mate !== undefined ? { mate: l.mate * sign } : { cp: l.cp * sign } };
};
const analyse = async (fen, depth, multipv) => {
  const k = `${fen}|${depth}|${multipv}`;
  if (!cache[k]) cache[k] = (await (engine ||= new NodeEngine()).analyse(fen, { depth, multipv })).map((l) => toLine(fen, l));
  return cache[k];
};

const depths = [...new Set(LEVELS.filter((l) => l.temp).map((l) => l.depth))];
let n = 0;
for (const fen of fens) {
  await analyse(fen, 14, 12);
  for (const d of depths) await analyse(fen, d, 10);
  if (++n % 20 === 0) {
    writeFileSync(CACHE, JSON.stringify(cache));
    console.log(`  ${n}/${fens.length} analysées`);
  }
}
writeFileSync(CACHE, JSON.stringify(cache));
engine?.quit();

const sideScore = (fen, l) => {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  const w = l.white;
  const cp = w.mate !== undefined ? (w.mate > 0 ? 10000 : -10000) : w.cp;
  return Math.max(-CAP, Math.min(CAP, cp * sign));
};
console.log('\nniveau  perte/coup (humain)   gaffes ≥ 2 pions (humain)');
for (const lvl of LEVELS.filter((l) => l.temp)) {
  let loss = 0;
  let blunders = 0;
  for (const fen of fens) {
    const ref = cache[`${fen}|14|12`];
    const top = sideScore(fen, ref[0]);
    const refOf = new Map(ref.map((l) => [l.pv[0], sideScore(fen, l)]));
    const worst = sideScore(fen, ref.at(-1));
    for (const c of moveChances(fen, cache[`${fen}|${lvl.depth}|${lvl.lines}`] || cache[`${fen}|${lvl.depth}|10`].slice(0, lvl.lines), lvl)) {
      const l = Math.max(0, top - (refOf.get(c.uci) ?? worst));
      loss += c.p * l;
      if (l >= 200) blunders += c.p;
    }
  }
  const [hl, hb] = HUMAN[lvl.elo];
  console.log(`${String(lvl.elo).padStart(5)}   ${String(Math.round(loss / fens.length)).padStart(4)} (${hl})            ${(100 * blunders / fens.length).toFixed(1).padStart(5)} % (${hb} %)`);
}

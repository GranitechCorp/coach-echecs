// Regroupe les exercices générés (fichiers JSON) dans src/data/puzzle-bank-data.js.
import { readFileSync, writeFileSync } from 'node:fs';
const files = process.argv.slice(2);
const seen = new Set();
const out = [];
for (const f of files) {
  for (const p of JSON.parse(readFileSync(f, 'utf8'))) {
    const key = p.fen.split(' ').slice(0, 2).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: 'b' + out.length.toString(36), fen: p.fen, solution: p.solution, themes: p.themes, rating: p.rating });
  }
}
writeFileSync(
  new URL('../src/data/puzzle-bank-data.js', import.meta.url),
  `// Généré par scripts/build-puzzle-bank.mjs — ${out.length} exercices.\nexport const BANK = ${JSON.stringify(out)};\n`,
);
console.log(out.length, 'exercices');

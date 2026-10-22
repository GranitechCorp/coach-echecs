// Regroupe les exercices générés (fichiers JSON) dans src/data/puzzle-bank-data.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
const files = process.argv.slice(2);
const seen = new Set();
const out = [];
let n = 0;
for (const f of files) {
  for (const p of JSON.parse(readFileSync(f, 'utf8'))) {
    const key = p.fen.split(' ').slice(0, 2).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    // l'identifiant suit l'ordre des positions, même écartées : il reste stable d'une génération à l'autre
    const id = 'b' + (n++).toString(36);
    // rien à chercher quand le premier coup est le seul coup légal (position qui commence en échec)
    if (new Chess(p.fen).moves().length < 2) continue;
    out.push({ id, fen: p.fen, solution: p.solution, themes: p.themes, rating: p.rating });
  }
}
writeFileSync(
  new URL('../src/data/puzzle-bank-data.js', import.meta.url),
  `// Généré par scripts/build-puzzle-bank.mjs — ${out.length} exercices.\nexport const BANK = ${JSON.stringify(out)};\n`,
);
console.log(out.length, 'exercices');

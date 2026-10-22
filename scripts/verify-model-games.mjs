// Vérifie les parties modèles de « Devine le coup » (src/data/model-games.js) :
//  - champs présents, identifiants uniques, groupe et camp valides ;
//  - chaque coup est légal (chess.js) et écrit comme chess.js l'écrit ;
//  - chaque commentaire pointe vers un demi-coup qui existe, et ne contient ni HTML ni « undefined » ;
//  - textes affichés (titre, intro, commentaires) : apostrophes typographiques, coups en figurines (♞f3), pas de « Cf3 ».
// Usage : node scripts/verify-model-games.mjs [--print]   (--print affiche chaque commentaire à côté de son coup)
import { Chess } from 'chess.js';
import { MODEL_GAMES } from '../src/data/model-games.js';

const print = process.argv.includes('--print');
let errors = 0;
const fail = (msg) => {
  errors++;
  console.log('  ✗ ' + msg);
};

const ids = new Set();
console.log(`== Parties modèles (${MODEL_GAMES.length}) ==`);
for (const g of MODEL_GAMES) {
  const label = g.id || '(sans id)';
  for (const k of ['id', 'title', 'white', 'black', 'event', 'opening', 'intro', 'moves']) {
    if (typeof g[k] !== 'string' || !g[k].trim()) fail(`${label} : champ « ${k} » manquant`);
  }
  if (ids.has(g.id)) fail(`${label} : identifiant en double`);
  ids.add(g.id);
  if (!/^[\w-]+$/.test(g.id || '')) fail(`${label} : identifiant invalide pour une adresse #/guess/<id>`);
  if (!['repertoire', 'classiques'].includes(g.group)) fail(`${label} : groupe inconnu « ${g.group} »`);
  if (!['w', 'b'].includes(g.side)) fail(`${label} : camp inconnu « ${g.side} »`);
  if (!g.comments || typeof g.comments !== 'object') fail(`${label} : pas d’objet « comments »`);

  const sans = (g.moves || '').split(/\s+/).filter(Boolean);
  const c = new Chess();
  const played = [];
  for (const [i, san] of sans.entries()) {
    let m;
    try {
      m = c.move(san);
    } catch {
      fail(`${label} : coup illégal « ${san} » (demi-coup ${i})`);
      break;
    }
    if (m.san !== san) fail(`${label} : « ${san} » s’écrit « ${m.san} » (demi-coup ${i})`);
    played.push(m.san);
  }
  // le camp à deviner doit avoir au moins quelques coups
  const guesses = played.filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === g.side).length;
  if (guesses < 5) fail(`${label} : seulement ${guesses} coups à deviner`);

  /** Défauts d'un texte affiché : HTML, valeur technique, apostrophe droite, notation française (Cf3) au lieu des figurines. */
  const textIssue = (t) =>
    /[<>]|undefined|NaN|\bnull\b/.test(t) ? 'HTML ou valeur technique'
    : t.includes("'") ? 'apostrophe droite (’ attendue)'
    : /(^|[^\p{L}])[RDTFC][a-h]?[1-8]?x?[a-h][1-8]/u.test(t) ? 'notation française (♞f3 attendu)'
    : null;
  for (const k of ['title', 'intro', 'event', 'opening']) {
    const issue = typeof g[k] === 'string' && textIssue(g[k]);
    if (issue) fail(`${label} : champ « ${k} » : ${issue}`);
  }
  for (const [k, text] of Object.entries(g.comments || {})) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= sans.length) fail(`${label} : commentaire sur un demi-coup inexistant (${k}, la partie en a ${sans.length})`);
    if (typeof text !== 'string' || !text.trim()) fail(`${label} : commentaire vide (${k})`);
    else if (textIssue(text)) fail(`${label} : commentaire ${k} : ${textIssue(text)} : ${text}`);
  }

  const end = c.isCheckmate() ? 'mat' : c.isDraw() ? 'nulle' : 'en cours';
  const nc = Object.keys(g.comments || {}).length;
  console.log(`  ✓ ${label} : ${played.length} demi-coups, ${guesses} à deviner (${g.side === 'w' ? 'Blancs' : 'Noirs'}), ${nc} commentaires, fin : ${end}`);

  if (print) {
    for (const [k, text] of Object.entries(g.comments || {}).sort((a, b) => a[0] - b[0])) {
      const i = Number(k);
      console.log(`      ${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'}${sans[i]}  →  ${text}`);
    }
  }
}

console.log(errors ? `\n${errors} problème(s) trouvé(s).` : '\nTout est bon.');
process.exit(errors ? 1 : 0);

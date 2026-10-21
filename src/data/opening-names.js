// Traduction en français des noms d'ouvertures fournis par chess.com (en anglais).
// Le nom anglais reste utilisé en interne (reconnaissance des ouvertures) ; on traduit à l'affichage.

const FAMILIES = [
  ['Queens Gambit Declined', 'Gambit Dame refusé'],
  ['Queens Gambit Accepted', 'Gambit Dame accepté'],
  ['Queens Gambit', 'Gambit Dame'],
  ['Semi Slav Defense', 'Défense semi-slave'],
  ['Slav Defense', 'Défense slave'],
  ['Caro Kann Defense', 'Défense Caro-Kann'],
  ['Kings Indian Defense', 'Défense est-indienne'],
  ['Kings Indian Attack', 'Attaque est-indienne'],
  ['Queens Indian Defense', 'Défense ouest-indienne'],
  ['Nimzo Indian Defense', 'Défense nimzo-indienne'],
  ['Bogo Indian Defense', 'Défense bogo-indienne'],
  ['Old Indian Defense', 'Défense vieille-indienne'],
  ['Indian Defense', 'Défense indienne'],
  ['Grunfeld Defense', 'Défense Grünfeld'],
  ['Benoni Defense', 'Défense Benoni'],
  ['Benko Gambit', 'Gambit Benko'],
  ['Dutch Defense', 'Défense hollandaise'],
  ['Englund Gambit', 'Gambit Englund'],
  ['Albin Countergambit', 'Contre-gambit Albin'],
  ['Chigorin Defense', 'Défense Tchigorine'],
  ['Tarrasch Defense', 'Défense Tarrasch'],
  ['Budapest Defense', 'Gambit de Budapest'],
  ['London System', 'Système de Londres'],
  ['Colle System', 'Système Colle'],
  ['Trompowsky Attack', 'Attaque Trompowsky'],
  ['Catalan Opening', 'Ouverture catalane'],
  ['Queens Pawn Opening', 'Début du pion dame'],
  ['Kings Pawn Opening', 'Début du pion roi'],
  ['Sicilian Defense', 'Défense sicilienne'],
  ['French Defense', 'Défense française'],
  ['Scandinavian Defense', 'Défense scandinave'],
  ['Center Counter Defense', 'Défense scandinave'],
  ['Alekhine Defense', 'Défense Alekhine'],
  ['Pirc Defense', 'Défense Pirc'],
  ['Modern Defense', 'Défense moderne'],
  ['Owens Defense', 'Défense Owen'],
  ['Nimzowitsch Defense', 'Défense Nimzowitsch'],
  ['Italian Game', 'Partie italienne'],
  ['Giuoco Piano', 'Giuoco Piano'],
  ['Two Knights Defense', 'Défense des deux cavaliers'],
  ['Ruy Lopez Opening', 'Partie espagnole'],
  ['Ruy Lopez', 'Partie espagnole'],
  ['Scotch Game', 'Partie écossaise'],
  ['Petrovs Defense', 'Défense Petrov'],
  ['Russian Game', 'Défense Petrov'],
  ['Philidor Defense', 'Défense Philidor'],
  ['Four Knights Game', 'Partie des quatre cavaliers'],
  ['Three Knights Opening', 'Partie des trois cavaliers'],
  ['Vienna Game', 'Partie viennoise'],
  ['Bishops Opening', 'Début du fou'],
  ['Kings Gambit', 'Gambit du roi'],
  ['Center Game', 'Partie du centre'],
  ['Danish Gambit', 'Gambit danois'],
  ['Ponziani Opening', 'Ouverture Ponziani'],
  ['Elephant Gambit', 'Gambit de l’éléphant'],
  ['Latvian Gambit', 'Gambit letton'],
  ['English Opening', 'Ouverture anglaise'],
  ['Reti Opening', 'Ouverture Réti'],
  ['Zukertort Opening', 'Ouverture Zukertort'],
  ['Bird Opening', 'Ouverture Bird'],
  ['Polish Opening', 'Ouverture polonaise'],
  ['Grob Opening', 'Ouverture Grob'],
  ['Mieses Opening', 'Ouverture Mieses'],
  ['Van Geet Opening', 'Ouverture Van Geet'],
  ['Saragossa Opening', 'Ouverture Saragosse'],
];

const VARIATIONS = [
  ['Advance Variation', 'variante d’avance'],
  ['Exchange Variation', 'variante d’échange'],
  ['Classical Variation', 'variante classique'],
  ['Main Line', 'ligne principale'],
  ['Mainline', 'ligne principale'],
  ['Normal Defense', 'défense normale'],
  ['Normal Variation', 'variante normale'],
  ['Modern Line', 'ligne moderne'],
  ['Modern Variation', 'variante moderne'],
  ['Panov Attack', 'attaque Panov'],
  ['Panov Botvinnik Attack', 'attaque Panov-Botvinnik'],
  ['Two Knights Attack', 'attaque des deux cavaliers'],
  ['Two Knights Variation', 'variante des deux cavaliers'],
  ['Three Knights Variation', 'variante des trois cavaliers'],
  ['Fantasy Variation', 'variante Fantaisie'],
  ['Closed Variation', 'variante fermée'],
  ['Open Variation', 'variante ouverte'],
  ['Accelerated', 'accélérée'],
  ['Dragon Variation', 'variante du Dragon'],
  ['Najdorf Variation', 'variante Najdorf'],
  ['Alapin Variation', 'variante Alapin'],
  ['Winawer Variation', 'variante Winawer'],
  ['Tarrasch Variation', 'variante Tarrasch'],
  ['Fried Liver Attack', 'attaque Fried Liver'],
  ['Knight Attack', 'attaque du cavalier'],
  ['Berlin Defense', 'défense berlinoise'],
  ['Morphy Defense', 'défense Morphy'],
  ['Mieses Kotrc Variation', 'variante Mieses-Kotrč'],
  ['Accepted', 'accepté'],
  ['Declined', 'refusé'],
];

// « Columbus Variation » → « variante Columbus » (nom propre inversé)
const GENERIC = { Variation: 'variante', Defense: 'défense', Attack: 'attaque', Gambit: 'gambit', Line: 'ligne', System: 'système' };

/** « Caro Kann Defense Advance Variation 3...Bf5 » → « Défense Caro-Kann, variante d’avance » */
export function frOpening(name) {
  if (!name) return '';
  const fam = FAMILIES.find(([en]) => name.startsWith(en));
  if (!fam) return name; // déjà en français (ligne du répertoire) ou inconnu
  let rest = name.slice(fam[0].length).trim();
  // on enlève les coups (« 3...Bf5 », « 4.Bg5 ») et ce qui suit
  rest = rest.replace(/\s*\d+\.[\s\S]*$/, '').trim();
  if (!rest) return fam[1];
  let fr = rest;
  for (const [en, f] of VARIATIONS) fr = fr.replace(new RegExp(`\\b${en}\\b`, 'g'), f);
  fr = fr.replace(/\b([A-Z][a-z]+)\s(Variation|Defense|Attack|Gambit|Line|System)\b/g, (_, nm, w) => `${GENERIC[w]} ${nm}`);
  fr = fr.replace(/\b(Variation|Defense|Attack|Gambit|Line|System)\b/g, (w) => GENERIC[w]);
  // s'il reste trop d'anglais, on garde seulement la famille
  const leftover = fr.split(/\s+/).filter((w) => /^[A-Z][a-z]+$/.test(w) && !/^(Panov|Botvinnik|Najdorf|Alapin|Winawer|Tarrasch|Morphy|Mieses|Fantaisie|Dragon|Fried|Liver)$/.test(w));
  if (leftover.length > 1) return fam[1];
  return `${fam[1]}, ${fr}`;
}

// Programme de cours 900 → 1600.
// Types d'étapes :
//  text   : explication (+ position facultative, flèches `shapes` : ['e2e4', 'green'] ou ['d5', 'red'] pour un cercle)
//  puzzle : trouver le(s) coup(s) — `solution` en UCI, les coups adverses sont joués automatiquement
//  quiz   : question à choix multiple
//  play   : jouer la position contre l'ordinateur jusqu'à l'objectif (`goal` : 'mate' | 'promote' | 'draw') ;
//           'draw' = tenir `maxMoves` coups sans que l'évaluation passe sous −2 ; `failBelow` (centipions) pour les autres
//  square : toucher les cases demandées (`targets`), `orientation` 'white' | 'black', `coordinates` (false par défaut)
// Une position se donne par `fen` ou par `moves` (coups SAN depuis la position initiale).
// Toute étape peut avoir un bouton `link: { href, label }` ; une leçon peut avoir `practice: { href, label }`
// (bouton d'entraînement en fin de leçon) et `practiceText`.
// Tout est vérifié par `npm run check`.

export const MODULES = [
  { id: 'base', name: '1. Arrêter de donner des pièces', target: '900 → 1100' },
  { id: 'tactique', name: '2. Tactique', target: '1000 → 1400' },
  { id: 'finales', name: '3. Finales essentielles', target: '1100 → 1500' },
  { id: 'strategie', name: '4. Stratégie et méthode', target: '1300 → 1600' },
  { id: 'ouvertures', name: '5. Tes ouvertures', target: 'Gambit Dame & Caro-Kann' },
];

export const LESSONS = [
  // ───────────────────────── Module 1 ─────────────────────────
  {
    id: 'reperage',
    module: 'base',
    title: 'Se repérer sur l’échiquier',
    minutes: 12,
    practice: { href: '#/vision', label: 'Vision de l’échiquier' },
    practiceText: 'Le repérage se travaille comme un muscle : 2 minutes par jour dans « Vision de l’échiquier », et c4, c6 ou h7 deviendront aussi évidents que ton prénom.',
    steps: [
      {
        type: 'text',
        text: `Chaque case a un nom : **une lettre, puis un chiffre**.
- Les **colonnes** (verticales) vont de **a à h**, de gauche à droite *quand on regarde depuis le camp blanc*.
- Les **rangées** (horizontales) vont de **1 à 8** : la rangée 1 est celle des pièces blanches, la 8 celle des pièces noires.
- **c4** = colonne c, rangée 4. La lettre d'abord, toujours.

Les repères qui rendent ça automatique :
- **Les pièces de départ donnent leur nom aux colonnes** : a et h = tours, b et g = cavaliers, c et f = fous, d = dame, e = roi. « c4 », c'est *la colonne du fou c1, sur la 4e rangée* ; « h7 », c'est *le pion juste devant la tour h8*.
- **Rangées 1-2** = camp blanc, **7-8** = camp noir, **4 et 5** = la ligne de front au milieu.
- **Le centre** : d4, e4, d5, e5.
- **f2 et f7** : les points faibles du début de partie, défendus seulement par le roi.
- **Les grandes diagonales** : a1-h8 (cases foncées) et h1-a8 (cases claires).
- **Le roque** : petit roque = roi en g1 et tour en f1 (g8 et f8 pour les Noirs) ; grand roque = roi en c1 et tour en d1 (c8 et d8).

Sur l'échiquier, les cases c4, c6 et h7 sont entourées.`,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        orientation: 'white',
        shapes: [['c4', 'green'], ['c6', 'green'], ['h7', 'green']],
      },
      {
        type: 'square',
        text: 'À toi ! Plus de lettres ni de chiffres au bord de l’échiquier : sers-toi des pièces comme repères (la colonne du fou, la rangée des pions…). Touche les cases demandées, sans te presser.',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        orientation: 'white',
        coordinates: false,
        targets: ['e4', 'd5', 'c4', 'c6', 'h7', 'f7', 'f3', 'g1', 'b5', 'e6'],
      },
      {
        type: 'text',
        text: `**L'astuce de la couleur d'une case** : remplace la lettre par son rang (a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8) et ajoute le chiffre.
- Total **pair** → case **foncée** (a1 : 1 + 1 = 2).
- Total **impair** → case **claire** (h1 : 8 + 1 = 9 ; c4 : 3 + 4 = 7).
- Repère rapide : *« la dame sur sa couleur »* (dame blanche en d1, case claire ; dame noire en d8, case foncée), et chaque joueur a une case **claire dans son coin droit**.

Pourquoi c'est utile : un fou reste toute la partie sur sa couleur. Si tu sais que c6 est claire, tu sais aussitôt que ton fou des cases foncées ne pourra jamais l'attaquer.

**Lire la notation française** :
- Pièces : **R** roi, **D** dame, **T** tour, **F** fou, **C** cavalier. Le pion n'a pas de lettre : « e4 » = un pion va en e4.
- **x** = prise : Fxe5 = le fou prend en e5 ; exd5 = le pion de la colonne e prend en d5.
- **+** = échec, **#** = mat ; **O‑O** = petit roque, **O‑O‑O** = grand roque ; **e8=D** = le pion arrive en e8 et devient une dame.
- **Cbd7** : deux cavaliers peuvent aller en d7, c'est celui de la colonne b qui y va.
- Dans l'appli, les listes de coups utilisent de petites figurines : ♞f3 = Cf3.`,
      },
      {
        type: 'quiz',
        question: 'Sans regarder un échiquier : de quelle couleur est la case c6 ?',
        choices: ['Claire', 'Foncée'],
        answer: 0,
        explain: 'c = 3, et 3 + 6 = 9 : impair, donc **claire**. Autre repère : c6 est sur la grande diagonale claire a8-h1, comme d5, e4 et f3. C’est la case de ton premier coup dans la Caro-Kann (…c6).',
      },
      {
        type: 'quiz',
        question: 'Que signifie le coup « Fxe5+ » ?',
        choices: ['Le fou va en e5 sans rien prendre', 'Le fou prend la pièce qui est en e5 et donne échec', 'Le pion e prend sur la 5e rangée avec échec'],
        answer: 1,
        explain: '**F** = fou, **x** = prise, **e5** = la case d’arrivée, **+** = échec. La case écrite est toujours la case où la pièce arrive.',
      },
      {
        type: 'square',
        text: `Avec les Noirs, l'échiquier est **retourné** : a1 est en haut à droite, h8 en bas à gauche. **Les cases gardent leur nom !**
Repères : tes pions sont sur la rangée 7, ta dame en d8, ton roi en e8. Les colonnes se lisent maintenant de h (à gauche) vers a (à droite). Touche les cases de ta Caro-Kann : c6, d5, f5 (la case de ton fou), e6…`,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        orientation: 'black',
        coordinates: false,
        targets: ['c6', 'd5', 'f5', 'e6', 'd7', 'f6', 'g6', 'b6', 'e4', 'h7'],
        link: { href: '#/vision', label: '🎯 S’entraîner chaque jour : Vision de l’échiquier' },
      },
    ],
  },
  {
    id: 'routine',
    module: 'base',
    title: 'La routine anti-gaffe',
    minutes: 8,
    steps: [
      {
        type: 'text',
        text: `À 900 Elo, la plupart des parties se décident sur **une pièce laissée en prise** ou **une menace pas vue**. Bonne nouvelle : c'est ce qui se corrige le plus vite.

Avant CHAQUE coup, fais la routine **É.C.M.** :
- **Échecs** : quels échecs l'adversaire peut-il me donner ? Et moi ?
- **Captures** : quelles pièces peuvent être prises, des deux côtés ?
- **Menaces** : que veut faire l'adversaire avec son dernier coup ?

Puis, une fois ton coup choisi : « Après mon coup, est-ce qu'une de mes pièces est attaquée sans être défendue ? »`,
      },
      {
        type: 'puzzle',
        text: 'Les Blancs menacent le « coup du berger » : Dxf7 mat. Trouve une défense qui pare la menace.',
        moves: 'e4 e5 Bc4 Nc6 Qh5',
        solution: ['g7g6'],
        allowOthers: true,
        hint: 'Le pion f7 n’est défendu que par le roi. Tu peux le protéger… ou chasser la dame.',
        success: 'Bien vu ! …g6 chasse la dame tout en bloquant la diagonale. (…De7 marchait aussi.)',
      },
      {
        type: 'puzzle',
        text: 'La dame revient à la charge sur f7. Défends-toi en développant une pièce.',
        moves: 'e4 e5 Bc4 Nc6 Qh5 g6 Qf3',
        solution: ['g8f6'],
        hint: 'Une pièce peut se placer entre la dame et f7.',
        success: '…Cf6 bloque la colonne f et développe. La dame blanche est sortie trop tôt : tu as gagné du temps.',
      },
      {
        type: 'puzzle',
        text: 'Les Noirs viennent de prendre en b2 avec leur dame. Routine « Captures » : y a-t-il quelque chose à prendre ?',
        moves: 'e4 c6 d4 d5 e5 Bf5 Bd3 Bxd3 Qxd3 e6 Nf3 Qb6 O-O Qxb2',
        solution: ['c1b2'],
        hint: 'Regarde ce que défend ton fou c1.',
        success: 'La dame était tout simplement en prise ! Avec les Noirs dans la Caro-Kann, retiens que le pion b2 est « empoisonné » quand le fou c1 le protège.',
      },
      {
        type: 'quiz',
        question: 'Tu as trouvé un super coup qui attaque la dame adverse. Que fais-tu avant de le jouer ?',
        choices: ['Je le joue tout de suite, c’est une attaque !', 'Je vérifie que ma pièce n’est pas en prise et que l’adversaire n’a pas d’échec ou de capture dangereuse', 'Je regarde seulement si ma dame est en sécurité'],
        answer: 1,
        explain: 'Le « coup génial » qui laisse une pièce en prise est la gaffe n°1 à ton niveau. 10 secondes de vérification valent des centaines de points Elo.',
      },
    ],
  },
  {
    id: 'valeurs',
    module: 'base',
    title: 'Valeur des pièces et échanges',
    minutes: 8,
    steps: [
      {
        type: 'text',
        text: `Valeurs à connaître par cœur : **pion 1, cavalier 3, fou 3, tour 5, dame 9**.

Pour savoir si une prise est bonne, **compte attaquants et défenseurs** sur la case :
- Si tu as plus d'attaquants que lui de défenseurs → tu gagnes souvent du matériel.
- Commence toujours par prendre avec ta pièce **la moins chère**.
- Une pièce attaquée par une pièce de moindre valeur est en danger, même si elle est défendue (ex. un pion qui attaque ta tour).`,
      },
      {
        type: 'puzzle',
        text: 'Le cavalier noir en e4 a l’air protégé… mais l’est-il vraiment ? Gagne du matériel.',
        fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5',
        solution: ['c3e4'],
        allowOthers: true,
        hint: 'Compte : qui attaque e4 ? Qui le défend ?',
        success: 'Personne ne défendait e4 : une pièce gratuite. Quand une pièce adverse arrive au centre, demande-toi toujours qui la défend.',
      },
      {
        type: 'puzzle',
        text: 'Un pion peut attaquer deux pièces. Gagne une pièce !',
        fen: 'r1bqkb1r/pppp1ppp/3n1n2/8/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 1',
        solution: ['e4e5'],
        allowOthers: true,
        hint: 'Les deux cavaliers noirs sont côte à côte…',
        success: 'e5 ! Le pion attaque les deux cavaliers à la fois : l’un des deux va tomber. Une fourchette de pion, l’arme la moins chère !',
      },
      {
        type: 'quiz',
        question: 'Échanger ton fou contre une tour adverse, c’est…',
        choices: ['Une perte (−2)', 'Un échange égal', 'Un gain de 2 points (« gain de la qualité »)'],
        answer: 2,
        explain: 'Tour (5) − fou (3) = +2 : on appelle ça « gagner la qualité ». Souvent décisif en finale.',
      },
    ],
  },
  {
    id: 'principes',
    module: 'base',
    title: 'Les principes d’ouverture',
    minutes: 10,
    steps: [
      {
        type: 'text',
        text: `Même sans connaître la théorie, ces 6 règles évitent 90 % des catastrophes :
1. **Occupe ou contrôle le centre** (cases d4, e4, d5, e5).
2. **Développe tes cavaliers et tes fous** avant de bouger la dame ou les tours.
3. **Ne bouge pas deux fois la même pièce** sans raison.
4. **Roque tôt** (avant le 10e coup en général).
5. **Ne sors pas la dame trop tôt** : elle se fait chasser et tu perds du temps.
6. **Ne prends pas les pions de l'aile** (comme b2) si ça retarde ton développement.

Dans tes ouvertures : avec les Blancs (Gambit Dame) c4, Cc3, Cf3, Fg5/Ff4, e3, Fd3, O-O. Avec les Noirs (Caro-Kann) c6, d5, Ff5, e6, Cd7, Cgf6, Fe7, O-O.`,
        moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3',
      },
      {
        type: 'puzzle',
        text: 'Les Noirs ont sorti leur dame tôt dans la partie. Gagne du temps en la chassant avec une pièce qui se développe.',
        moves: 'e4 d5 exd5 Qxd5',
        solution: ['b1c3'],
        hint: 'Quelle pièce peut attaquer d5 tout en se développant ?',
        success: 'Cc3 développe ET attaque la dame : elle doit encore bouger. C’est le principe du « gain de temps ».',
      },
      {
        type: 'puzzle',
        text: 'Les Noirs ont négligé leur développement. Les Blancs ont roqué et ouvert le centre. Quel est le coup le plus énergique ?',
        fen: 'rnbqkb1r/ppp2ppp/5n2/4p3/2B5/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 5',
        solution: ['f3e5'],
        allowOthers: true,
        hint: 'Un pion central noir n’est pas défendu.',
        success: 'Cxe5 gagne un pion central ET menace f7 avec le fou c4. Le roi noir est encore au centre : c’est dangereux pour lui.',
      },
    ],
  },

  // ───────────────────────── Module 2 : Tactique ─────────────────────────
  {
    id: 'fourchette',
    module: 'tactique',
    title: 'La fourchette',
    minutes: 10,
    steps: [
      {
        type: 'text',
        text: `Une **fourchette**, c'est une pièce qui attaque **deux cibles en même temps**. L'adversaire ne peut en sauver qu'une.
Le roi des fourchettes est le **cavalier** (il attaque sans être attaqué en retour), mais pions, dames et fous en font aussi.

Cherche les fourchettes quand :
- deux pièces adverses sont sur des cases de **même couleur** à un saut de cavalier ;
- le **roi et la dame** sont mal placés ;
- une case est **non défendue** près des pièces adverses.`,
        fen: 'r3k3/6pp/8/1N6/8/8/6PP/4K3 w - - 0 1',
        shapes: [['b5c7', 'green'], ['c7a8', 'red'], ['c7e8', 'red']],
      },
      {
        type: 'puzzle',
        text: 'Fourchette royale : gagne la tour.',
        fen: 'r3k3/6pp/8/1N6/8/8/6PP/4K3 w - - 0 1',
        solution: ['b5c7'],
        hint: 'Quel saut de cavalier attaque le roi ET la tour ?',
        success: 'Cc7+ : le roi doit bouger et la tour tombe.',
      },
      {
        type: 'puzzle',
        text: 'Les Blancs viennent de prendre le pion e5. Avec les Noirs, punis-les ! (piège de Blackburne-Shilling)',
        moves: 'e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5',
        solution: ['d8g5', 'e5f7', 'g5g2', 'h1f1', 'g2e4', 'c4e2', 'd4f3'],
        hint: 'Ta dame peut attaquer le cavalier e5 ET le pion g2 en même temps.',
        success: '…Dg5 ! fourchette sur e5 et g2. Si 5.Cxf7 Dxg2 6.Tf1 Dxe4+ 7.Fe2 Cf3 mat !',
      },
      {
        type: 'puzzle',
        text: 'Fourchette de dame : deux cibles non défendues.',
        moves: 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6',
        solution: ['f3b3'],
        hint: 'f7 et b7 sont deux faiblesses noires.',
        success: 'Db3 ! attaque f7 (avec le fou c4) et b7. Les Noirs ne peuvent pas tout défendre.',
      },
      {
        type: 'puzzle',
        text: 'Avec les Noirs : le « truc de la fourchette ». Prends un pion central, le pion d5 récupérera la pièce.',
        moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Nc3',
        solution: ['f6e4', 'c3e4', 'd7d5'],
        allowOthers: true,
        hint: 'Prends en e4 : si le cavalier reprend, un pion fera une fourchette.',
        success: '…Cxe4 ! 5.Cxe4 d5 : fourchette sur le fou c4 et le cavalier e4. Tu récupères la pièce avec un beau centre.',
      },
    ],
  },
  {
    id: 'clouage',
    module: 'tactique',
    title: 'Le clouage',
    minutes: 10,
    steps: [
      {
        type: 'text',
        text: `Un **clouage** : une pièce ne peut pas bouger car elle protège une pièce plus importante derrière elle.
- **Clouage absolu** : derrière, il y a le roi → la pièce ne peut **légalement** pas bouger.
- **Clouage relatif** : derrière, il y a la dame ou une tour → elle peut bouger, mais on perd plus gros.

Une pièce clouée est **une cible** : attaque-la avec un pion !
Dans ton Gambit Dame, Fg5 cloue le cavalier f6 sur la dame noire. Dans la Caro-Kann, …Fg4 cloue souvent le cavalier f3.`,
        fen: '4k3/8/5p2/4n3/8/8/3P4/4RK2 w - - 0 1',
        shapes: [['e1e8', 'red']],
      },
      {
        type: 'puzzle',
        text: 'Le cavalier e5 est cloué sur son roi. Gagne-le !',
        fen: '4k3/8/5p2/4n3/8/8/3P4/4RK2 w - - 0 1',
        solution: ['d2d4'],
        hint: 'Une pièce clouée, on l’attaque… avec un pion.',
        success: 'd4 ! Le cavalier ne peut pas fuir : il est perdu. (Txe5 ?? aurait donné la tour pour le cavalier, car f6 le défend.)',
      },
      {
        type: 'puzzle',
        text: 'Dans le Gambit Dame, les Blancs croient gagner un pion car le cavalier f6 est « cloué ». Avec les Noirs, montre que ce clouage n’est qu’une illusion !',
        moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Nbd7 cxd5 exd5 Nxd5',
        solution: ['f6d5', 'g5d8', 'f8b4', 'd1d2', 'b4d2', 'e1d2', 'e8d8'],
        hint: 'Prends quand même en d5 : si le fou prend ta dame, un échec suivra.',
        success: 'Le piège de l’éléphant : …Cxd5 ! 7.Fxd8 Fb4+ 8.Dd2 Fxd2+ 9.Rxd2 Rxd8 et tu as une pièce de plus. Le clouage n’était que relatif !',
      },
      {
        type: 'puzzle',
        text: 'Le fou noir cloue ton cavalier f3. Comment exploiter la situation ? (piège de Légal)',
        moves: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6',
        solution: ['f3e5', 'g4d1', 'c4f7', 'e8e7', 'c3d5'],
        hint: 'Le cavalier f3 n’est cloué que sur la dame… et ta dame n’est pas indispensable si tu fais mat !',
        success: 'Cxe5 ! Si …Fxd1 ? Fxf7+ Re7 Cd5 mat : le mat de Légal. Un clouage relatif peut être ignoré si ça rapporte plus gros.',
      },
    ],
  },
  {
    id: 'enfilade',
    module: 'tactique',
    title: 'L’enfilade',
    minutes: 6,
    steps: [
      {
        type: 'text',
        text: `L'**enfilade** est un clouage à l'envers : tu attaques une pièce **importante** (souvent le roi), elle doit s'écarter, et la pièce **derrière** tombe.
Elle se fait avec les pièces à longue portée : **fou, tour, dame**. Cherche-la quand le roi et la dame adverses sont alignés.`,
        fen: '7q/8/8/4k3/8/8/8/4B1K1 w - - 0 1',
        shapes: [['e1c3', 'green'], ['c3h8', 'red']],
      },
      {
        type: 'puzzle',
        text: 'Le roi et la dame noirs sont sur la même diagonale. Gagne la dame !',
        fen: '7q/8/8/4k3/8/8/8/4B1K1 w - - 0 1',
        solution: ['e1c3'],
        hint: 'Donne un échec sur la grande diagonale.',
        success: 'Fc3+ ! Le roi doit quitter la diagonale et Fxh8 suit.',
      },
      {
        type: 'puzzle',
        text: 'Même idée avec une tour.',
        fen: '3q4/8/8/3k4/8/8/8/R5K1 w - - 0 1',
        solution: ['a1d1'],
        hint: 'Roi en d5, dame en d8 : une colonne en commun…',
        success: 'Td1+ et la dame tombe derrière le roi.',
      },
    ],
  },
  {
    id: 'decouverte',
    module: 'tactique',
    title: 'L’attaque à la découverte',
    minutes: 8,
    steps: [
      {
        type: 'text',
        text: `Quand une pièce bouge, elle peut **libérer la ligne** d'une autre pièce (tour, fou, dame) : c'est une **attaque à la découverte**.
C'est redoutable car **deux pièces attaquent à la fois** : celle qui bouge et celle qui est découverte.
Le cas le plus fort : l'**échec à la découverte** — la pièce qui bouge peut aller n'importe où, même en prise, et prendre ce qu'elle veut !`,
        fen: '4k3/8/8/2q5/4N3/8/8/4R2K w - - 0 1',
        shapes: [['e4c5', 'green'], ['e1e8', 'red']],
      },
      {
        type: 'puzzle',
        text: 'Échec à la découverte : gagne la dame.',
        fen: '4k3/8/8/2q5/4N3/8/8/4R2K w - - 0 1',
        solution: ['e4c5'],
        hint: 'Le cavalier bouge, la tour donne échec… et le cavalier peut prendre quelque chose.',
        success: 'Cxc5+ ! La tour donne échec, et le cavalier a mangé la dame.',
      },
      {
        type: 'puzzle',
        text: 'Défense russe : les Noirs ont copié un coup de trop. Trouve le coup qui gagne la dame !',
        moves: 'e4 e5 Nf3 Nf6 Nxe5 Nxe4 Qe2 Nf6',
        solution: ['e5c6'],
        hint: 'Ta dame est sur la colonne e, face au roi noir. Ton cavalier e5 bloque cette colonne…',
        success: 'Cc6+ ! Échec à la découverte de la dame e2, et le cavalier attaque la dame d8 : elle est perdue.',
      },
    ],
  },
  {
    id: 'deviation',
    module: 'tactique',
    title: 'Élimination du défenseur et déviation',
    minutes: 10,
    steps: [
      {
        type: 'text',
        text: `Si une pièce adverse **défend quelque chose d'important** (une case de mat, une pièce), alors :
- **élimine-la** (prends-la, même avec perte de matériel), ou
- **dévie-la** (force-la à quitter son poste, souvent par un sacrifice).

Question à se poser : « Qu'est-ce qui empêche mon coup gagnant ? Puis-je supprimer cet obstacle ? »`,
      },
      {
        type: 'puzzle',
        text: 'Ta dame et ton fou visent h7, mais le cavalier f6 défend. Élimine-le !',
        fen: '5rk1/2q2ppp/5n2/6B1/7Q/3B4/5PPP/6K1 w - - 0 1',
        solution: ['g5f6'],
        allowOthers: true,
        hint: 'Quelle pièce peut prendre le défenseur de h7 ?',
        success: 'Fxf6 ! Si …gxf6 ou …Dxf6, Dxh7 mat. Le défenseur a disparu.',
      },
      {
        type: 'puzzle',
        text: 'La partie de l’Opéra (Morphy, 1858) : finis avec style ! Le cavalier d7 défend la case d8…',
        moves: 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7',
        solution: ['b3b8', 'd7b8', 'd1d8'],
        hint: 'Dévie le cavalier d7 avec un sacrifice de dame.',
        success: 'Db8+ !! Cxb8 Td8 mat. Le cavalier a été dévié : la case d8 n’était plus défendue.',
      },
    ],
  },
  {
    id: 'mats',
    module: 'tactique',
    title: 'Les mats à connaître',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `Quelques schémas de mat reviennent sans cesse :
- **Mat du couloir** : roi bloqué par ses propres pions sur la dernière rangée → une tour ou une dame suffit. *Pense à faire « respirer » ton roi (h3 / h6) !*
- **Mat du berger** : Dxf7 avec l'aide du fou c4.
- **Mat à l'étouffée** : un cavalier mate un roi entouré de ses propres pièces.
- **Mat du baiser** : la dame colle au roi, protégée par une autre pièce.`,
        fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
        shapes: [['d1d8', 'red']],
      },
      {
        type: 'puzzle',
        text: 'Mat du couloir.',
        fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
        solution: ['d1d8'],
        hint: 'Le roi noir n’a pas de case de fuite.',
        success: 'Td8 mat. Les pions f7-g7-h7 emprisonnent leur propre roi.',
      },
      {
        type: 'puzzle',
        text: 'Mat en 1 (le mat du berger).',
        moves: 'e4 e5 Qh5 Nc6 Bc4 Nf6',
        solution: ['h5f7'],
        hint: 'f7 n’est défendu que par le roi.',
        success: 'Dxf7 mat ! Retiens ce schéma… pour ne jamais le subir.',
      },
      {
        type: 'puzzle',
        text: 'Caro-Kann : les Noirs ont joué 4…Cd7 puis 5…Cgf6 ?? Mat en 1 !',
        moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Qe2 Ngf6',
        solution: ['e4d6'],
        hint: 'Le pion e7 est cloué par ta dame…',
        success: 'Cd6 mat à l’étouffée ! Avec les Noirs, c’est pour ça qu’on joue 4…Ff5 dans ta Caro-Kann.',
      },
      {
        type: 'puzzle',
        text: 'Mat du baiser : la dame vient au contact du roi.',
        fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1',
        solution: ['g1g7'],
        allowOthers: true,
        hint: 'La dame protégée par le roi peut se coller au roi adverse.',
        success: 'Dg7 mat : la dame est protégée par ton roi.',
      },
      {
        type: 'play',
        text: 'Le mat de l’escalier : avec deux tours, fais mat. Les tours avancent l’une après l’autre, rangée par rangée.',
        fen: '8/8/8/3k4/8/8/8/R3K2R w - - 0 1',
        goal: 'mate',
        maxMoves: 15,
      },
    ],
  },
  {
    id: 'sacrifices',
    module: 'tactique',
    title: 'Le coup brillant : sacrifier pour gagner',
    minutes: 14,
    steps: [
      {
        type: 'text',
        text: `Un **sacrifice**, c'est donner du matériel **exprès**, pour obtenir davantage en échange. Sur chess.com, c'est souvent ce genre de coup qui reçoit la mention « Brillant » (!!).

Un sacrifice marche quand il rapporte, **de façon forcée** :
- un **mat** ;
- **plus de matériel** que ce qu'il coûte ;
- une **attaque décisive** contre un roi privé de défenseurs.

La règle d'or : un sacrifice **se calcule**. Avant de donner une pièce, suis la suite forcée (échecs, prises, menaces) jusqu'au bout. Si tu ne vois pas ce que tu gagnes, ce n'est pas un sacrifice : c'est une gaffe.

Les grands classiques :
- **la destruction du roque** : le sacrifice grec Fxh7+ ;
- **l'attraction** : forcer le roi (ou une pièce) à venir sur une case où il sera maté ou pris ;
- **la déviation** : forcer un défenseur à abandonner son poste.`,
      },
      {
        type: 'text',
        text: `**Le sacrifice grec** : Fxh7+ ! Rxh7, Cg5+ puis Dh5, et la dame menace Dh7 mat.

Avant de le jouer, vérifie les ingrédients :
- un **fou en d3** qui vise h7 ;
- un **cavalier en f3** qui sautera en g5 avec échec, **protégé par le fou c1** ;
- une **dame** qui peut arriver en h5 ;
- **pas de cavalier noir en f6** pour défendre h7 (ici, le pion e5 l'a chassé) ;
- le roi noir n'a pas de case de fuite confortable.

Si le roi recule en g8, Dh5 menace le mat en h7. S'il avance en g6 ou h6, la dame et le cavalier le traquent en pleine rue.`,
        moves: 'e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 Nf3 Bb4 Bd3 c5 O-O Nc6 Re1 O-O',
        orientation: 'white',
        shapes: [['d3h7', 'green'], ['f3g5', 'blue'], ['d1h5', 'blue']],
      },
      {
        type: 'puzzle',
        text: 'Défense française : tous les ingrédients sont réunis. À toi de jouer le sacrifice grec !',
        moves: 'e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 Nf3 Bb4 Bd3 c5 O-O Nc6 Re1 O-O',
        solution: ['d3h7', 'g8h7', 'f3g5', 'h7g8', 'd1h5'],
        hint: 'Commence par donner ton fou en h7, avec échec.',
        success: 'Fxh7+ ! Rxh7 Cg5+ Rg8 Dh5 : Dh7 mat est imparable, les Noirs doivent donner leur dame (…Dxg5 Fxg5). Tu as donné un fou et un cavalier, tu récupères une dame et un pion : le sacrifice a payé !',
      },
      {
        type: 'puzzle',
        text: 'Réti – Tartakower, Vienne 1910 : une Caro-Kann ! Les Noirs viennent de prendre le cavalier e4. Les Blancs ont trouvé l’un des coups les plus célèbres de l’histoire. Mat en 3 !',
        moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Qd3 e5 dxe5 Qa5+ Bd2 Qxe5 O-O-O Nxe4',
        solution: ['d3d8', 'e8d8', 'd2g5', 'd8e8', 'd1d8'],
        hint: 'Attire le roi noir en d8 : ta tour d1 et ton fou d2 l’y attendent.',
        success: 'Dd8+ !! Rxd8 Fg5+ (échec double : la tour d1 et le fou) Re8 Td8 mat (ou …Rc7 Fd8 mat). C’est une **attraction** : la dame a forcé le roi à venir sur la case de son exécution. Avec les Noirs, retiens la leçon : ne laisse pas ton roi au centre face à une tour sur une colonne ouverte.',
      },
      {
        type: 'puzzle',
        text: 'Avec les Noirs. Ta dame et ta tour e8 visent la case e1, que seule la tour h1 protège. Sacrifie ta dame pour détourner cette tour : mat en 3 !',
        fen: '3rr1k1/pp3pp1/2p1q2p/5b2/P4QPP/2P2P2/1BPR4/2K4R b - - 0 23',
        solution: ['e6e1', 'h1e1', 'e8e1', 'd2d1', 'e1d1'],
        hint: 'Ta dame peut donner échec en e1… même si elle s’y fait prendre.',
        success: '…De1+ !! Txe1 Txe1+ Td1 Texd1 mat. La tour h1 a été **déviée** : en prenant la dame, elle a abandonné la garde de la 1re rangée.',
      },
      {
        type: 'quiz',
        question: 'Quand un sacrifice est-il une bonne idée ?',
        choices: ['Quand l’adversaire a l’air distrait', 'Quand je vois une suite forcée qui rapporte plus que ce que je donne (mat, matériel, attaque décisive)', 'Quand je suis en retard de développement et que je veux du jeu'],
        answer: 1,
        explain: 'Un sacrifice se calcule : échecs, prises, menaces, jusqu’au bout. « Espérer » que l’adversaire se trompe marche parfois à 900 Elo… et coûte beaucoup de points ensuite.',
      },
    ],
  },

  // ───────────────────────── Module 3 : Finales ─────────────────────────
  {
    id: 'mat-dame',
    module: 'finales',
    title: 'Mater avec roi + dame',
    minutes: 10,
    steps: [
      {
        type: 'text',
        text: `Méthode simple :
1. Place ta dame à **un saut de cavalier** du roi adverse : il se retrouve dans une « boîte ».
2. Suis-le en gardant ce saut de cavalier : la boîte rétrécit jusqu'au bord.
3. Quand il est au bord, **arrête** : amène ton roi pour soutenir la dame, puis fais mat.

⚠️ Danger n°1 : le **pat** ! Si le roi adverse n'a plus de coup légal et n'est pas en échec, c'est nulle. Vérifie toujours qu'il lui reste une case.`,
        fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1',
      },
      { type: 'play', text: 'À toi : mate le roi noir (l’ordinateur défend au mieux).', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', goal: 'mate', maxMoves: 20 },
    ],
  },
  {
    id: 'mat-tour',
    module: 'finales',
    title: 'Mater avec roi + tour',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `Plus long qu'avec la dame, mais indispensable :
1. La tour **coupe** le roi adverse (une rangée ou une colonne qu'il ne peut pas franchir).
2. Amène ton roi **en face** du roi adverse (« opposition »).
3. Quand les rois sont face à face, **échec de la tour** : le roi recule d'une rangée.
4. Si le roi adverse ne se met pas en opposition, fais un **coup d'attente** avec la tour (en restant loin de son roi).

Garde ta tour **loin** du roi adverse pour qu'il ne puisse pas l'attaquer.`,
        fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
      },
      { type: 'play', text: 'Mate avec roi + tour.', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', goal: 'mate', maxMoves: 30 },
    ],
  },
  {
    id: 'pions',
    module: 'finales',
    title: 'Finales de pions : le carré et l’opposition',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `**La règle du carré** : trace un carré du pion jusqu'à sa case de promotion. Si le roi adverse peut **entrer dans ce carré**, il rattrape le pion. Pas besoin de calculer coup par coup !

**L'opposition** : deux rois face à face avec une case entre eux. Celui qui **n'a pas** le trait « a l'opposition » : l'autre doit céder le passage.

**Règle d'or roi + pion contre roi** : mets ton roi **devant** ton pion, idéalement sur la 6e rangée (3e pour les Noirs). Là, c'est gagné (sauf pion de la colonne a ou h).`,
        fen: '8/8/8/8/p7/8/4K3/7k w - - 0 1',
        shapes: [['a4', 'red'], ['d1', 'green']],
      },
      {
        type: 'puzzle',
        text: 'Le pion a4 file à dame. Rattrape-le !',
        fen: '8/8/8/8/p7/8/4K3/7k w - - 0 1',
        solution: ['e2d2'],
        allowOthers: true,
        hint: 'Le carré du pion va de a4 à d1. Entre dedans !',
        success: 'Le roi entre dans le carré : le pion est rattrapé.',
      },
      {
        type: 'puzzle',
        text: 'Roi + pion contre roi : quel est le coup qui gagne ?',
        fen: '4k3/8/8/4K3/4P3/8/8/8 w - - 0 1',
        solution: ['e5e6'],
        allowOthers: true,
        hint: 'Le roi devant le pion, sur la 6e rangée…',
        success: 'Le roi sur la 6e rangée devant son pion : c’est gagné, quoi que fassent les Noirs.',
      },
      {
        type: 'play',
        text: 'Gagne cette finale : amène ton pion à dame (puis l’ordinateur abandonnera).',
        fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
        goal: 'promote',
        maxMoves: 15,
      },
    ],
  },
  {
    id: 'pions-passes',
    module: 'finales',
    title: 'Les pions passés et la percée',
    minutes: 14,
    practice: { href: '#/puzzles/theme/endgame', label: 'Exercices de finale' },
    steps: [
      {
        type: 'text',
        text: `Un **pion passé** n'a plus aucun pion adverse devant lui, ni sur les colonnes voisines : seules des pièces peuvent l'arrêter. *« Les pions passés doivent être poussés ! »*
- **Pion passé protégé** (défendu par un autre pion) : l'adversaire doit le surveiller sans jamais pouvoir le prendre. En finale de pions, c'est souvent gagnant.
- **Pion passé éloigné** (loin des autres pions) : il attire le roi adverse d'un côté pendant que ton roi dévore les pions de l'autre côté.
- **Pions passés liés** (côte à côte) : ils se protègent en avançant. Deux pions liés sur la 6e rangée battent une tour !
- **Contre un pion passé adverse** : **bloque-le** avec une pièce posée juste devant lui, idéalement un cavalier ou ton roi (Nimzowitsch).
- **Course de pions** : avant de te lancer, compte les coups de chaque côté (la règle du carré).

Ici, les Blancs ont un pion passé éloigné en a4 : le roi noir devra aller le chercher.`,
        fen: '8/6pp/3k4/8/P2K4/8/6PP/8 w - - 0 1',
        shapes: [['a4a8', 'green']],
      },
      {
        type: 'puzzle',
        text: 'La célèbre **percée** : trois pions contre trois, les rois sont loin. Fais une dame !',
        fen: '6k1/ppp5/8/PPP5/8/8/8/7K w - - 0 1',
        solution: ['b5b6', 'a7b6', 'c5c6', 'b7c6', 'a5a6'],
        hint: 'Sacrifie le pion du milieu.',
        success: 'b6 !! Si …axb6, c6 ! bxc6 a6 et le pion a file à dame. Si …cxb6, a6 ! bxa6 c6. Trois pions sur la 5e rangée contre trois sur la 7e : la percée gagne quand les rois sont trop loin.',
      },
      {
        type: 'puzzle',
        text: '**Course de pions** : aucun roi ne peut rattraper le pion adverse. Ton roi file vers h4, ou tu pousses ton pion ? Compte les coups avant de jouer !',
        fen: '8/8/8/P3k3/7p/8/8/1K6 w - - 0 1',
        solution: ['a5a6'],
        hint: 'Compte : chaque pion a besoin de 3 coups pour faire dame. Qui joue le premier ? Et regarde la grande diagonale a8-h1.',
        success: 'a6 ! Chaque pion a besoin de 3 coups, mais tu joues le premier : ta dame arrive avant la sienne. Et depuis a8, elle surveille toute la grande diagonale jusqu’à h1, la case où son pion veut faire dame. Si tu avais couru avec ton roi (Rc2 ?), c’était l’inverse : il faisait dame le premier, et sa dame en h1 surveillait a8 !',
      },
      {
        type: 'puzzle',
        text: 'Tu as un **pion passé éloigné** en a4. Comment l’utiliser ?',
        fen: '8/6pp/3k4/8/P2K4/8/6PP/8 w - - 0 1',
        solution: ['a4a5'],
        allowOthers: true,
        hint: 'Pousse-le : le roi noir devra lui courir après.',
        success: 'a5 ! Le roi noir doit partir arrêter ce pion… pendant ce temps, ton roi file manger les pions g7 et h7. Le pion éloigné sert de **leurre**.',
      },
      {
        type: 'quiz',
        question: 'Les Blancs ont un pion passé en d4, et tu as les Noirs. Où places-tu ton cavalier ?',
        choices: ['En d5, juste devant le pion', 'En b3, pour l’attaquer de loin', 'Le plus loin possible, pour attaquer ailleurs'],
        answer: 0,
        explain: 'Bloque le pion passé juste devant lui : il ne peut plus avancer, et ton cavalier y est solide, abrité des attaques de face par le pion lui-même. Nimzowitsch : un pion passé est un criminel qu’il faut mettre sous les verrous.',
      },
      {
        type: 'play',
        text: 'À toi de jouer contre l’ordinateur : utilise ton pion éloigné comme leurre, mange ses pions avec ton roi, puis va à dame.',
        fen: '8/6pp/3k4/8/P2K4/8/6PP/8 w - - 0 1',
        goal: 'promote',
        maxMoves: 20,
        failBelow: 150,
      },
    ],
  },
  {
    id: 'tours',
    module: 'finales',
    title: 'Finales de tours : les règles d’or',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `La moitié des finales sont des finales de tours. Trois règles :
1. **La tour derrière le pion passé** (le tien ou celui de l'adversaire) : elle le pousse ou le freine en restant active.
2. **Une tour active vaut mieux qu'un pion** : n'aie pas peur de sacrifier un pion pour activer ta tour.
3. **Position de Lucena** (pour gagner) : roi devant son pion sur la 7e, on « construit un pont » avec la tour sur la 4e rangée pour abriter le roi des échecs.

**Position de Philidor** (pour annuler) : ta tour sur ta 3e rangée empêche le roi adverse d'avancer ; quand le pion avance, ta tour va tout au fond et donne des échecs par derrière.`,
        fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
      },
      {
        type: 'puzzle',
        text: 'Position de Lucena. Premier pas : chasse le roi noir loin du pion.',
        fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
        solution: ['c1d1'],
        allowOthers: true,
        hint: 'Un échec sur la colonne d éloigne le roi.',
        success: 'Td1+ ! Puis Td4 : le « pont » qui protégera ton roi des échecs.',
      },
      { type: 'play', text: 'Gagne la position de Lucena (fais dame, l’ordinateur défend).', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', goal: 'promote', maxMoves: 20 },
    ],
  },
  {
    id: 'philidor',
    module: 'finales',
    title: 'Défendre : la position de Philidor',
    minutes: 15,
    practice: { href: '#/puzzles/theme/endgame', label: 'Exercices de finale' },
    steps: [
      {
        type: 'text',
        text: `Tour + pion contre tour : si ton roi est **devant le pion**, c'est nulle… à condition de connaître la **position de Philidor** (1777). Deux temps :
1. **Ta tour sur ta 3e rangée** (la 6e pour les Noirs) : le roi blanc ne peut pas y monter sans recevoir des échecs. Ne bouge pas ton roi, fais des va-et-vient avec la tour sur cette rangée.
2. **Dès que le pion avance sur cette rangée**, ta tour file **tout au fond** (1re rangée) et donne des **échecs par derrière**. Le pion n'abrite plus le roi blanc : il ne peut pas échapper aux échecs.

L'erreur classique : la tour passive sur la dernière rangée, le roi blanc arrive sur la 6e rangée… et c'est perdu.`,
        fen: '4k3/1R6/r7/4PK2/8/8/8/8 b - - 0 1',
        orientation: 'black',
        shapes: [['a6h6', 'green'], ['d6', 'red'], ['e6', 'red'], ['f6', 'red']],
      },
      {
        type: 'quiz',
        question: 'Le roi blanc est en f5, son pion en e5, ton roi en e8. Où places-tu ta tour ?',
        fen: '4k3/1R6/8/4PK2/8/8/8/r7 b - - 0 1',
        orientation: 'black',
        choices: ['Sur la 6e rangée (en a6 par exemple), pour interdire au roi blanc d’y monter', 'Sur la 8e rangée, à côté de mon roi, pour le protéger', 'Le plus près possible du roi blanc, pour l’attaquer'],
        answer: 0,
        explain: 'Tour sur la 6e rangée : si le roi blanc veut monter en d6, e6 ou f6, il reçoit un échec. Les Blancs ne peuvent progresser qu’en poussant e6… et là, ta tour change de rôle.',
      },
      {
        type: 'puzzle',
        text: 'Les Blancs viennent de pousser leur pion en e6. Ta tour, restée sur la 6e rangée, doit changer de rôle : trouve le coup qui sauve la nulle.',
        fen: '4k3/1R6/r3P3/5K2/8/8/8/8 b - - 0 1',
        solution: ['a6a1', 'f5f6', 'a1f1'],
        allowOthers: true,
        hint: 'Le pion bloque maintenant tes échecs sur la rangée. Où ta tour peut-elle attaquer le roi blanc par derrière ?',
        success: '…Ta1 ! puis …Tf1+ : des échecs par derrière, et le roi blanc n’a plus d’abri (son pion est devant lui). Rester sur la 6e rangée (…Tc6 ?) perdait : après Rf6, ton roi est enfermé sur la 8e rangée et Tb8+ arrive.',
      },
      {
        type: 'play',
        text: 'À toi de défendre avec les Noirs ! Garde ta tour sur la 6e rangée ; si le pion arrive en e6, file au fond et donne des échecs par derrière.',
        fen: '4k3/1R6/r7/4PK2/8/8/8/8 b - - 0 1',
        goal: 'draw',
        maxMoves: 12,
      },
      {
        type: 'puzzle',
        text: 'Roi seul contre roi et pion. Un seul coup sauve la nulle : lequel ?',
        fen: '4k3/8/8/4K3/4P3/8/8/8 b - - 0 1',
        solution: ['e8e7'],
        hint: 'Mets ton roi face au sien, avec une case entre les deux.',
        success: '…Re7 ! Tu prends l’**opposition** : les rois se font face et c’est aux Blancs de jouer, donc leur roi doit céder le passage. Si tu avais reculé (…Rd8 ?), le roi blanc entrait en d6 ou f6, et c’était perdu.',
      },
      {
        type: 'play',
        text: `Tiens la nulle contre l'ordinateur ! Les deux règles :
- garde ton roi **devant le pion** ;
- quand les rois se font face avec une case entre eux, fais en sorte que ce soit **à lui** de jouer : c'est l'opposition. Quand le pion approche de ta dernière rangée, recule ton roi **droit devant lui**.

Ici, commence par prendre l'opposition, comme dans l'exercice précédent.`,
        fen: '8/8/4k3/8/3KP3/8/8/8 b - - 0 1',
        goal: 'draw',
        maxMoves: 10,
      },
    ],
  },

  // ───────────────────────── Module 4 : Stratégie & méthode ─────────────────────────
  {
    id: 'activite',
    module: 'strategie',
    title: 'Pièces actives et cases fortes',
    minutes: 10,
    steps: [
      {
        type: 'text',
        text: `Quand il n'y a pas de tactique, **améliore ta pire pièce** : celle qui fait le moins de choses.
- Un **cavalier** adore une **case forte** (avant-poste) : une case au centre ou chez l'adversaire, protégée par un de tes pions, qu'aucun pion adverse ne peut attaquer.
- Un **fou** est « mauvais » si ses propres pions sont sur des cases de sa couleur : il est bloqué.
- Une **tour** veut une **colonne ouverte** (sans pions) ou la **7e rangée**.`,
        fen: 'r4rk1/pp3ppp/2p5/3pN3/3P4/8/PP3PPP/R4RK1 w - - 0 1',
        shapes: [['e5', 'green']],
      },
      {
        type: 'quiz',
        question: 'Dans cette position, pourquoi le cavalier blanc en e5 est-il si fort ?',
        fen: 'r4rk1/pp3ppp/2p5/3pN3/3P4/8/PP3PPP/R4RK1 w - - 0 1',
        choices: ['Il est sur une case noire', 'Il est protégé par le pion d4 et aucun pion noir ne peut le chasser', 'Il attaque la dame'],
        answer: 1,
        explain: 'C’est un avant-poste : soutenu par d4, et aucun pion noir ne peut plus l’attaquer. Il domine toute la position.',
      },
      {
        type: 'quiz',
        question: 'Tes pions sont en d4 et e3 (cases noires). Quel fou risque d’être « mauvais » ?',
        choices: ['Le fou des cases noires', 'Le fou des cases blanches', 'Aucun'],
        answer: 0,
        explain: 'Les pions sur cases noires bloquent le fou des cases noires. C’est pour ça que dans le Gambit Dame, on sort le fou c1 (Fg5 ou Ff4) AVANT de jouer e3.',
      },
    ],
  },
  {
    id: 'structures',
    module: 'strategie',
    title: 'Les structures de pions',
    minutes: 10,
    steps: [
      {
        type: 'text',
        text: `Les pions ne reculent jamais : leurs faiblesses sont **permanentes**.
- **Pion isolé** (aucun pion voisin) : il doit être défendu par des pièces. La case devant lui est un bel avant-poste pour l'adversaire.
- **Pions doublés** : souvent faibles, mais ils ouvrent une colonne.
- **Pion passé** (aucun pion adverse devant lui ni sur les colonnes voisines) : un atout énorme en finale. *« Les pions passés doivent être poussés ! »*

Dans la **Panov** (Caro-Kann), les Blancs ont souvent un pion isolé en d4 : bloque-le avec un cavalier en d5, échange des pièces, puis attaque-le.`,
        moves: 'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7 cxd5 Nxd5 Bd3 Nc6 O-O O-O',
        shapes: [['d4', 'red'], ['d5', 'green']],
      },
      {
        type: 'quiz',
        question: 'Avec un pion isolé adverse, la meilleure stratégie est en général…',
        choices: ['Échanger les dames et les pièces, puis attaquer le pion en finale', 'Garder toutes les pièces et attaquer le roi', 'Pousser ses propres pions du centre'],
        answer: 0,
        explain: 'Le pion isolé donne de l’activité aux pièces en milieu de partie, mais devient une faiblesse en finale. Échange et attaque-le !',
      },
    ],
  },
  {
    id: 'plans',
    module: 'strategie',
    title: 'Trouver un plan',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `Un plan simple vaut mieux que pas de plan. Selon la structure :
- **Centre fermé** (pions bloqués) → attaque du côté où tes pions **pointent** (là où tu as de l'espace).
- **Roques opposés** → attaque à la baïonnette : pousse les pions vers le roi adverse, vite !
- **Colonne ouverte** → doublement des tours, puis invasion en 7e rangée.
- **Attaque des minorités** (Gambit Dame, variante d'échange) : les Blancs avancent b4-b5 avec 2 pions contre 3 pour créer une faiblesse en c6.

Méthode : 1) quelles sont les faiblesses (les miennes, les siennes) ? 2) quelle est ma pire pièce ? 3) où mes pions m'indiquent-ils d'attaquer ?`,
      },
      {
        type: 'quiz',
        question: 'Variante d’avance de la Caro-Kann (pions blancs d4-e5, pions noirs c6-d5-e6). Quel est le plan principal des Noirs ?',
        moves: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2',
        choices: ['Jouer …f6 tout de suite', 'Attaquer la base de la chaîne avec …c5', 'Roquer côté dame et attaquer avec …g5'],
        answer: 1,
        explain: '…c5 attaque d4, la base de la chaîne de pions blancs. C’est LE plan des Noirs dans l’avance.',
      },
      {
        type: 'quiz',
        question: 'Tu as roqué côté roi, ton adversaire côté dame. Les dames sont sur l’échiquier. Que fais-tu ?',
        choices: ['J’attaque avec mes pions de l’aile dame (a, b, c) vers son roi', 'Je pousse mes pions g et h', 'J’échange les dames tout de suite'],
        answer: 0,
        explain: 'Roques opposés = course à l’attaque : pousse tes pions vers SON roi (ici l’aile dame), sans affaiblir le tien.',
      },
    ],
  },
  {
    id: 'attaque-roi',
    module: 'strategie',
    title: 'Attaquer le roi roqué',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `Pour attaquer un roi roqué, il faut **plus d'attaquants que de défenseurs** autour de lui. Compte-les avant de te lancer !

Les plans types :
- **Roques opposés** : chacun pousse ses pions vers le roi adverse (ils ne protègent pas son propre roi). C'est une course : la vitesse compte plus qu'un pion.
- **Les crochets** : un pion avancé devant le roi (h6, g6) donne prise à tes pions : g4-g5 contre h6, h4-h5 contre g6. Le but est d'**ouvrir des colonnes**.
- **La colonne h ouverte** : une tour en h1 et la dame, et les cases h7 ou h8 deviennent mortelles.
- **Les pièces qui visent h7 et g7** : un fou en d3, la dame en h5 ou h4, un cavalier en g5 ou en f5.
- **Le défenseur n°1 est le cavalier f6** : chasse-le (e5) ou élimine-le (Fxf6, Txf6), même si ça coûte du matériel.

Ici, ta Caro-Kann (variante classique) : les Blancs ont roqué côté dame, toi côté roi. Leur plan : g4-g5, en s'appuyant sur ton pion h6 comme crochet.`,
        moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6 Bd2 Ngf6 O-O-O Be7 Kb1 O-O',
        orientation: 'black',
        shapes: [['g2g4', 'red'], ['g4g5', 'red'], ['h6', 'red']],
      },
      {
        type: 'quiz',
        question: 'Même position, les Blancs ont joué De2. Tu as les Noirs : quel est ton plan ?',
        moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6 Bd2 Ngf6 O-O-O Be7 Kb1 O-O Qe2',
        choices: ['Attendre qu’il attaque, puis défendre', 'Contre-attaquer vite son roi : …c5, …Db6 ou …Da5, puis …b5', 'Pousser …g5 pour bloquer son aile roi'],
        answer: 1,
        explain: 'Roques opposés = course. Son roi est en b1 : ouvre des lignes de ce côté-là (…c5, …b5) et amène ta dame (…Db6, …Da5) avant que g4-g5 n’arrive chez toi. Pousser …g5 créerait de nouvelles faiblesses devant ton propre roi.',
      },
      {
        type: 'puzzle',
        text: 'Ta dame et ton fou visent h7. Un seul défenseur : le cavalier f6. Élimine-le !',
        fen: 'r2q1rk1/pp3ppp/2p1pn2/3p4/3P3Q/2PBP3/PP4PP/R4RK1 w - - 0 1',
        solution: ['f1f6'],
        hint: 'Ta tour f1 peut se sacrifier sur f6.',
        success: 'Txf6 ! Si …gxf6 ou …Dxf6, Dxh7 mat : les Noirs ne peuvent pas reprendre ta tour sans être matés, et tu gagnes une pièce. Retiens le réflexe : quand une seule pièce défend le roi, élimine-la, même au prix d’une tour.',
      },
      {
        type: 'puzzle',
        text: 'La colonne h est ouverte et ton fou g5 contrôle les cases foncées. Mat en 2 !',
        fen: '2r1rk2/pp3p2/6p1/4PbBR/8/P1p2P2/2P3PP/4R1K1 w - - 0 31',
        solution: ['h5h8', 'f8g7', 'g5f6'],
        hint: 'Envoie ta tour tout au fond de la colonne h.',
        success: 'Th8+ ! Rg7 (seule case) Ff6 mat : le fou, soutenu par le pion e5, ferme le filet, et la tour h8 ne peut pas être prise.',
      },
      {
        type: 'puzzle',
        text: 'Ton cavalier f6 est planté devant le roi noir et ta dame est sur la colonne h. Mat en 2 !',
        fen: '5r1k/ppr1np2/q3pNp1/P2pP1P1/3P1P1b/7Q/6KP/1n6 w - - 4 31',
        solution: ['h3h4', 'h8g7', 'h4h6'],
        hint: 'Prends le fou h4 : avec échec !',
        success: 'Dxh4+ Rg7 Dh6 mat. Le cavalier f6 (soutenu par e5) contrôle h7 et g8 : la dame n’a plus qu’à se poser en h6. Un cavalier en f6 devant un roi roqué vaut souvent une tour !',
      },
    ],
  },
  {
    id: 'convertir',
    module: 'strategie',
    title: 'Gagner une partie gagnée',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `Être gagnant et **gagner**, ce n'est pas la même chose ! Beaucoup de parties « gagnées » finissent en nulle (pat, échec perpétuel) ou même en défaite. La méthode des champions, que Capablanca appliquait à la perfection :
1. **Supprime le contre-jeu d'abord** : à chaque coup, demande-toi « que veut-il ? » (une menace de mat, un pion passé, un échec perpétuel).
2. **Échange les pièces, pas les pions** : avec une pièce de plus, chaque échange rend ton avantage plus grand. Garde tes pions : ce sont eux qui feront une nouvelle dame.
3. **Mets ton roi à l'abri** (donne-lui une case de fuite, avec h3 par exemple), puis **active-le** en finale : c'est une pièce forte.
4. **Pas de précipitation** : un coup sûr vaut mieux qu'un coup brillant. Vérifie toujours ses échecs, ses prises et ses menaces.
5. **Méfie-toi du pat** : quand il n'a plus que son roi, laisse-lui toujours une case.`,
      },
      {
        type: 'puzzle',
        text: 'Tu as une pièce de plus. Avant de chercher à gagner encore plus : que menacent les Noirs ?',
        fen: 'r4rk1/pp3ppp/3b4/8/7q/2N5/PPPBQ1PP/R4RK1 w - - 0 1',
        solution: ['g2g3'],
        allowOthers: true,
        hint: 'Regarde la case h2 : la dame noire et le fou d6 la visent.',
        success: 'g3 ! Le pion coupe la diagonale du fou d6 et chasse la dame noire. Sans ce coup, …Fxh2+ ! Rh1 Fg3+ Rg1 Dh2 mat. Ta pièce de plus finira par parler : quand tu es gagnant, ta première mission est de ne rien laisser à l’adversaire.',
      },
      {
        type: 'puzzle',
        text: 'Finale de tours : tu as un pion de plus, le pion a. Quel est le chemin le plus simple vers la victoire ?',
        fen: '8/5ppp/3rk3/8/P3K3/6PP/5P2/3R4 w - - 0 1',
        solution: ['d1d6'],
        hint: 'Quand tu as plus de matériel, les échanges sont tes amis.',
        success: 'Txd6+ ! Rxd6 et la finale de pions est gagnée : ton pion a, éloigné, va attirer le roi noir pendant que ton roi dévore l’aile roi. En finale de tours, l’adversaire aurait encore eu du contre-jeu ; sans les tours, il n’a plus rien.',
      },
      {
        type: 'quiz',
        question: 'Tu as une tour de plus. Ton adversaire te propose l’échange des dames. Que fais-tu ?',
        choices: ['J’accepte : moins il reste de pièces, plus ma tour de plus pèse lourd', 'Je refuse : je garde ma dame pour attaquer', 'J’échange plutôt des pions'],
        answer: 0,
        explain: 'Avec du matériel en plus, échange les pièces, surtout les dames : c’est la pièce qui donne le plus de chances de contre-attaque à l’adversaire. Et garde tes pions pour faire une nouvelle dame.',
      },
      {
        type: 'play',
        text: 'Ton adversaire a gaffé une tour : dame et tour contre tour. Maintenant, gagne sans trembler ! Rapproche ta dame et ta tour du roi noir, accepte l’échange des tours s’il se présente, et surveille les échecs de sa tour sur ta 1re rangée.',
        fen: '2r3k1/5p1p/6p1/8/8/7P/5PP1/R2Q2K1 w - - 0 1',
        goal: 'mate',
        maxMoves: 25,
        failBelow: 300,
      },
    ],
  },
  {
    id: 'calcul',
    module: 'strategie',
    title: 'Calcul : coups candidats et vérification',
    minutes: 14,
    steps: [
      {
        type: 'text',
        text: `Le grand maître Kotov (*Pensez comme un grand maître*) a donné une méthode que beaucoup de forts joueurs utilisent :
1. **Liste tes coups candidats** (2 à 4) avant d'en calculer un seul.
2. **Les coups forçants d'abord** : échecs, prises, menaces. Ils limitent les réponses adverses : on peut les calculer jusqu'au bout.
3. **Calcule chaque ligne une seule fois**, jusqu'à une position calme, puis **visualise la position finale** : qui a gagné du matériel ? un roi est-il en danger ?
4. **Compare**, puis choisis.
5. **Vérification anti-gaffe** : « Après mon coup, quels sont SES échecs, ses prises et ses menaces ? »

Et le conseil de Lasker : *« Quand tu vois un bon coup, cherches-en un meilleur. »*`,
      },
      {
        type: 'puzzle',
        text: 'Avec les Noirs. Applique la méthode : commence par les échecs. Mat en 2 !',
        fen: 'r3r1k1/pp3ppp/1q1N4/5b2/4n3/3nQP2/PP1BB1PP/2R2KNR b - - 2 18',
        solution: ['e4d2', 'e3d2', 'b6f2'],
        hint: 'Un cavalier peut donner échec en prenant quelque chose…',
        success: '…Cxd2+ ! Dxd2 (forcé) Df2 mat. Le premier échec a **dévié** la dame blanche : en quittant e3, elle a ouvert la diagonale b6-f2 et ne gardait plus la case f2.',
      },
      {
        type: 'puzzle',
        text: 'Le pion b7 a l’air gratuit… Vérifie avant de prendre : si ta dame quitte b3, qui défend ta tour d1 ?',
        fen: '3r2k1/pp3ppp/5q2/8/8/1Q5P/PP3PP1/3R2K1 w - - 0 1',
        solution: ['d1d8', 'f6d8', 'b3b7'],
        hint: 'Échange d’abord les tours, avec échec.',
        success: 'Txd8+ ! Dxd8 Dxb7 : tu gagnes le pion sans risque. Le gourmand Dxb7 ?? tout de suite perdait la tour (…Txd1+), qui n’était défendue que par ta dame. L’ordre des coups compte !',
      },
      {
        type: 'quiz',
        question: 'Dans une position tactique, quels coups examines-tu en premier ?',
        choices: ['Les coups qui développent mes pièces', 'Les coups forçants : échecs, prises, menaces', 'Le premier coup qui me vient à l’esprit'],
        answer: 1,
        explain: 'Les coups forçants réduisent les réponses de l’adversaire : on peut les calculer jusqu’au bout. Et avant de jouer, fais le même travail pour LUI.',
      },
      {
        type: 'puzzle',
        text: 'Défi : mat en 4, uniquement avec des échecs. Visualise chaque position avant de toucher une pièce… et attention, les Noirs menacent …Te1 mat !',
        fen: '4r2k/pp4pp/2p5/q5N1/8/1Q6/PP3PPP/6K1 w - - 0 1',
        solution: ['g5f7', 'h8g8', 'f7h6', 'g8h8', 'b3g8', 'e8g8', 'h6f7'],
        hint: 'Cavalier en f7 avec échec, puis échec double en h6…',
        success: 'Cf7+ Rg8 Ch6+ (échec double) Rh8 Dg8+ !! Txg8 Cf7 mat : le « mat à l’étouffée de Philidor ». Le roi noir est enfermé par ses propres pièces.',
      },
    ],
  },
  {
    id: 'penser',
    module: 'strategie',
    title: 'Comment penser pendant une partie',
    minutes: 10,
    steps: [
      {
        type: 'text',
        text: `Le processus de réflexion qui fait passer de 900 à 1600 :
1. **Qu'a fait l'adversaire ?** Que menace son dernier coup ? (É.C.M. pour lui)
2. **Ai-je une tactique ?** Échecs, captures, menaces pour moi. Cherche les pièces non défendues et le roi mal protégé.
3. **Sinon, un plan** : améliorer ma pire pièce, viser une faiblesse.
4. **Choisis 2-3 coups candidats** et compare-les.
5. **Vérification anti-gaffe** avant de lâcher la pièce.

**Gestion du temps** : en 10 minutes, joue vite l'ouverture que tu connais, prends du temps dans les positions critiques (captures, échecs, moment où la position s'ouvre). Ne laisse jamais ta pendule descendre sous 1 minute avec une position compliquée.

**Plan d'entraînement conseillé** (avec cette appli) :
- 15 min d'exercices de tactique par jour (c'est le plus rentable !) ;
- 1 partie contre l'ordinateur à ton niveau +100, puis son **bilan** ;
- révise **« Mes erreurs »** : les positions où tu t'es trompé reviennent jusqu'à ce que tu les trouves ;
- 1 leçon ou 1 entraînement d'ouverture par jour.`,
      },
      {
        type: 'quiz',
        question: 'Ton adversaire vient de jouer un coup surprenant qui ne semble rien faire. Ta première réaction ?',
        choices: ['Je joue mon plan, il a dû se tromper', 'Je cherche ce que ce coup menace (échecs, captures, attaques)', 'Je propose nulle'],
        answer: 1,
        explain: 'Toujours se demander « pourquoi a-t-il joué ça ? ». La plupart des gaffes viennent d’une menace adverse non vue.',
      },
    ],
  },

  // ───────────────────────── Module 5 : Ouvertures ─────────────────────────
  {
    id: 'idees-gambit-dame',
    module: 'ouvertures',
    title: 'Comprendre le Gambit Dame',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `**1.d4 d5 2.c4** : tu proposes le pion c4 pour éloigner le pion d5 du centre.

Les réponses principales :
- **2…e6 (Refusé)** : solide. Tes pièces : Cc3, Fg5 (clouage), e3, Cf3, Tc1, Fd3. Ne te précipite pas pour prendre en d5.
- **2…dxc4 (Accepté)** : joue **e3** puis **Fxc4** ; tu récupères le pion avec un beau centre. Si les Noirs défendent le pion avec …b5, attaque avec **a4** !
- **2…c6 (Slave)** : le fou c8 sort en f5. Cf3, Cc3, puis e3 ou a4.
- **2…e5 (Albin)** et **2…Cc6 (Tchigorine)** : réponses rares mais piégeuses, vois tes lignes dans « Ouvertures ».

Idée clé du milieu de partie : la **colonne c** (Tc1) et la poussée **e4** quand tu es prêt.`,
        moves: 'd4 d5 c4',
      },
      {
        type: 'puzzle',
        text: 'Gambit Dame Accepté : les Noirs défendent leur pion avec …b5. Punis-les !',
        moves: 'd4 d5 c4 dxc4 e3 b5 a4 c6 axb5 cxb5',
        solution: ['d1f3'],
        hint: 'La grande diagonale vers a8 s’est ouverte.',
        success: 'Df3 ! attaque la tour a8 : les Noirs perdent une pièce.',
      },
      {
        type: 'puzzle',
        text: 'Contre-gambit Albin : les Noirs viennent de jouer …Fb4+ puis …dxe3. Ne tombe pas dans le piège de Lasker : quel est le bon coup ?',
        moves: 'd4 d5 c4 e5 dxe5 d4 e3 Bb4+ Bd2 dxe3',
        solution: ['f2e3'],
        allowOthers: true,
        hint: 'Prendre le fou b4 serait une catastrophe (…exf2+ puis …fxg1=C+ !).',
        success: 'fxe3 ! Surtout pas Fxb4 ?? exf2+ Re2 fxg1=C+ !',
      },
    ],
  },
  {
    id: 'idees-caro-kann',
    module: 'ouvertures',
    title: 'Comprendre la Caro-Kann',
    minutes: 12,
    steps: [
      {
        type: 'text',
        text: `**1.e4 c6 2.d4 d5** : tu attaques e4 avec un pion soutenu.

Règle n°1 : **ton fou c8 sort AVANT …e6** (en f5 ou g4), sinon il reste enfermé.

Selon le 3e coup blanc :
- **3.e5 (Avance)** → …Ff5, …e6, puis **…c5** pour attaquer d4.
- **3.exd5 cxd5 (Échange)** → développement simple : …Cc6, …Cf6, …Fg4/Ff5, …e6.
- **3.exd5 cxd5 4.c4 (Panov)** → jeu contre le pion isolé : …Cf6, …e6, …Fe7, bloque en d5.
- **3.Cc3 dxe4 4.Cxe4 (Classique)** → **…Ff5** (pas 4…Cd7 5.De2 Cgf6?? 6.Cd6 mat !).

La Caro-Kann n'est pas passive : tu attends la bonne occasion pour frapper au centre avec …c5 ou …e5.`,
        moves: 'e4 c6 d4 d5',
      },
      {
        type: 'puzzle',
        text: 'Variante d’avance : où va ton fou c8 ?',
        moves: 'e4 c6 d4 d5 e5',
        solution: ['c8f5'],
        allowOthers: true,
        hint: 'Il doit sortir avant …e6.',
        success: '…Ff5 : le fou est actif avant que …e6 ne ferme sa diagonale.',
      },
      {
        type: 'puzzle',
        text: 'Toujours dans l’avance : les Blancs ont fini leur développement. Quel est le coup thématique des Noirs ?',
        moves: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2',
        solution: ['c6c5'],
        allowOthers: true,
        hint: 'Attaque la base de la chaîne de pions blancs.',
        success: '…c5 ! On attaque d4, base de la chaîne d4-e5.',
      },
    ],
  },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id);

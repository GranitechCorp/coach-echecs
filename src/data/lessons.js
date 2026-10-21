// Programme de cours 900 → 1600.
// Types d'étapes :
//  text   : explication (+ position facultative, flèches `shapes` : ['e2e4', 'green'] ou ['d5', 'red'] pour un cercle)
//  puzzle : trouver le(s) coup(s) — `solution` en UCI, les coups adverses sont joués automatiquement
//  quiz   : question à choix multiple
//  play   : jouer la position contre l'ordinateur jusqu'à l'objectif (`goal` : 'mate' | 'promote')
// Une position se donne par `fen` ou par `moves` (coups SAN depuis la position initiale).
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

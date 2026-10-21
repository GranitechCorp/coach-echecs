// Répertoire d'ouvertures : Gambit Dame (Blancs), Caro-Kann et Slave (Noirs).
// Format des coups : SAN séparés par des espaces ; un commentaire {…} suit le coup qu'il explique.
// Toutes les lignes sont vérifiées par `npm run check` (légalité + évaluation Stockfish).

export const OPENING_GROUPS = [
  {
    id: 'qg',
    side: 'w',
    name: 'Gambit Dame',
    intro: `Le Gambit Dame (1.d4 d5 2.c4) n'est pas un vrai gambit : si les Noirs prennent en c4, tu récupères presque toujours le pion. L'idée : attaquer le pion d5 avec le pion c pour gagner le centre. Plan type : Cc3, Cf3, Fg5 ou Ff4, e3, Fd3, roque, puis Tc1 et pression sur la colonne c.`,
  },
  {
    id: 'qg-other',
    side: 'w',
    name: 'Si les Noirs ne jouent pas 1…d5',
    intro: `À ton niveau, beaucoup d'adversaires répondent 1…Cf6, 1…e5 (gambit Englund, plein de pièges) ou 1…f5 (Hollandaise). Voici des réponses simples dans l'esprit du Gambit Dame : c4, Cc3, Cf3, développement rapide.`,
  },
  {
    id: 'ck',
    side: 'b',
    name: 'Caro-Kann',
    intro: `La Caro-Kann (1.e4 c6 2.d4 d5) est une défense solide : tu attaques e4 avec d5 après avoir préparé c6. Ton fou des cases blanches sort AVANT de jouer e6 (souvent en f5 ou g4). Structure robuste, peu de faiblesses : tu gagnes en finale et en jouant les cases blanches.`,
  },
  {
    id: 'slav',
    side: 'b',
    name: 'Contre 1.d4 : la Slave',
    intro: `La Slave (1.d4 d5 2.c4 c6) est la « cousine » de la Caro-Kann : même pion c6, même fou qui sort en f5 avant e6. Si tu aimes la Caro-Kann, c'est la défense idéale contre 1.d4 et le Gambit Dame.`,
  },
  {
    id: 'london',
    side: 'w',
    extra: true,
    name: 'Système de Londres',
    intro: `Le Système de Londres (1.d4, 2.Ff4, e3, Cf3, c3, Cbd2, Fd3) : presque toujours le même placement de pièces quoi que fassent les Noirs. Très peu de théorie, plans simples : idéal pour se concentrer sur le milieu de partie.`,
  },
  {
    id: 'italian',
    side: 'w',
    extra: true,
    name: 'Partie italienne (1.e4 e5)',
    intro: `La Partie italienne (1.e4 e5 2.Cf3 Cc6 3.Fc4) : développement rapide, le fou vise f7, jeu ouvert et tactique. Attention : passer à 1.e4 demande aussi des réponses à la Sicilienne, la Française, la Caro-Kann…`,
  },
  {
    id: 'e5',
    side: 'b',
    extra: true,
    name: 'Contre 1.e4 : 1…e5 (jeu ouvert)',
    intro: `1…e5 : la réponse classique. Positions ouvertes, développement rapide, beaucoup de tactique. Il faut connaître quelques pièges (Fried Liver, Écossaise…) mais les principes d'ouverture suffisent souvent.`,
  },
  {
    id: 'scandi',
    side: 'b',
    extra: true,
    name: 'Contre 1.e4 : la Scandinave (1…d5)',
    intro: `La Scandinave (1.e4 d5 2.exd5 Dxd5) : tu imposes ta structure dès le 1er coup. Peu de théorie, plan très clair (…Da5, …Cf6, …c6, …Ff5, …e6), proche de la Caro-Kann dans l'esprit.`,
  },
  {
    id: 'qgd-black',
    side: 'b',
    extra: true,
    name: 'Contre 1.d4 : Gambit Dame Refusé',
    intro: `Le Gambit Dame Refusé avec les Noirs (1.d4 d5 2.c4 e6) : la défense la plus classique. Solide, et tu connais déjà ses idées depuis le côté blanc !`,
  },
];

export const OPENING_LINES = [
  // ───────────── Gambit Dame : Blancs ─────────────
  {
    id: 'qgd-ortho',
    group: 'qg',
    name: 'Gambit Dame Refusé : variante orthodoxe',
    moves: `d4{On occupe le centre et on libère le fou c1.} d5 c4{Le Gambit Dame : on attaque d5 pour éloigner ce pion du centre.} e6{Le Gambit Dame Refusé : les Noirs soutiennent d5, mais enferment leur fou c8.} Nc3{On ajoute une pièce qui attaque d5.} Nf6 Bg5{Le clouage : le cavalier f6 défend d5 et ne peut plus bouger sans perdre la dame.} Be7{Déclouage : maintenant le cavalier peut bouger.} e3{Solide : on ouvre la diagonale du fou f1.} O-O Nf3{Développement + contrôle de e5.} Nbd7 Rc1{La tour sur la colonne c, qui s'ouvrira après …dxc4 ou cxd5.} c6 Bd3{On développe le fou en attendant que les Noirs prennent en c4 : on gagne alors un temps.} dxc4 Bxc4{Le fou reprend en un seul coup : on a gagné du temps sur les Noirs.} Nd5{Les Noirs échangent pour se libérer (manœuvre de Capablanca).} Bxe7 Qxe7 O-O{Roi à l'abri ; on peut penser au plan e4 ou à la pression sur c.} Nxc3 Rxc3 e5{Les Noirs libèrent enfin leur fou c8. Position équilibrée, plus facile à jouer pour toi.}`,
  },
  {
    id: 'qgd-cambridge',
    group: 'qg',
    name: 'GDR avec 4…Cbd7 (attention au piège de l’éléphant)',
    moves: `d4 d5 c4 e6 Nc3 Nf6 Bg5 Nbd7{Piège ! Si 5.cxd5 exd5 6.Cxd5?? Cxd5 ! 7.Fxd8 Fb4+ 8.Dd2 Fxd2+ 9.Rxd2 Rxd8 et les Noirs gagnent une pièce : c'est le piège de l'éléphant.} e3{On ne tombe pas dans le piège : développement normal.} c6 Nf3 Qa5{La défense Cambridge Springs : la dame cloue le cavalier c3 et vise g5.} Nd2{Défend le fou g5 et menace de chasser la dame avec Cb3 ; prépare aussi cxd5.} Bb4 Qc2{Protège c3 une seconde fois.} O-O Be2{Développement, puis roque.} e5 O-O{Position riche et équilibrée.}`,
  },
  {
    id: 'qga',
    group: 'qg',
    name: 'Gambit Dame Accepté',
    moves: `d4 d5 c4 dxc4{Les Noirs prennent le pion… mais ils ne pourront pas le garder.} e3{Simple et fort : le fou f1 va reprendre en c4.} Nf6 Bxc4{On a récupéré le pion et on garde un beau centre.} e6 Nf3 c5{Les Noirs attaquent ton centre : c'est la réaction normale.} O-O a6 Qe2{Prépare Td1 et e4 ; la dame protège aussi le fou c4.} b5 Bb3{Le fou reste sur la grande diagonale a2-g8.} Bb7 Nc3{Développement complet : tu es un peu mieux.}`,
  },
  {
    id: 'qga-trap',
    group: 'qg',
    name: 'GDA : punir 3…b5 (piège classique)',
    moves: `d4 d5 c4 dxc4 e3 b5{Erreur fréquente : les Noirs veulent garder le pion c4.} a4{On attaque immédiatement le soutien du pion.} c6 axb5 cxb5 Qf3{Piège ! La diagonale f3-a8 est ouverte : la dame attaque la tour a8 et menace aussi Dxa8. Les Noirs perdent une pièce.} Nc6 Qxc6+{Le cavalier est cloué : tu gagnes une pièce.}`,
  },
  {
    id: 'slav-white',
    group: 'qg',
    name: 'Contre la Slave (2…c6)',
    moves: `d4 d5 c4 c6{La Slave : les Noirs soutiennent d5 sans enfermer leur fou c8.} Nf3 Nf6 Nc3 dxc4 a4{Empêche …b5 qui garderait le pion.} Bf5 e3 e6 Bxc4{Pion récupéré, développement agréable.} Bb4 O-O O-O Qe2{Prépare e4 pour chasser le fou f5.} Nbd7 e4 Bg6 Bd3{Tu as le centre ; position typique et confortable.}`,
  },
  {
    id: 'albin',
    group: 'qg',
    name: 'Contre-gambit Albin (2…e5)',
    moves: `d4 d5 c4 e5{Le contre-gambit Albin : agressif et piégeux.} dxe5 d4{Le pion d4 gêne ton cavalier c3.} Nf3{Le bon coup ! Attention à 4.e3?? Fb4+ 5.Fd2 dxe3 ! 6.Fxb4?? exf2+ 7.Re2 fxg1=C+ ! : le piège de Lasker.} Nc6 g3{Le fou va en g2 pour viser la grande diagonale.} Be6 Nbd2 Qd7 Bg2{Tu as un pion de plus ; roque ensuite et joue a3/b4.}`,
  },
  {
    id: 'chigorin',
    group: 'qg',
    name: 'Défense Tchigorine (2…Cc6)',
    moves: `d4 d5 c4 Nc6{La Tchigorine : les Noirs jouent avec les pièces plutôt qu'avec les pions.} Nf3 Bg4 cxd5 Bxf3 gxf3{On reprend vers le centre ; la paire de fous compense le pion doublé.} Qxd5 e3 e5 Nc3 Bb4 Bd2 Bxc3 bxc3{Tes deux fous et ton centre te donnent l'avantage.}`,
  },
  {
    id: 'baltic',
    group: 'qg',
    name: 'Défense balte (2…Ff5)',
    moves: `d4 d5 c4 Bf5{La défense balte : le fou sort tout de suite.} cxd5 Bxb1 Qa4+{Échec intermédiaire ! La dame reprendra le fou plus tard.} c6 dxc6 Nxc6 Rxb1{Tu as un pion de plus et la paire de fous.}`,
  },
  {
    id: 'vs-nf6',
    group: 'qg-other',
    name: '1…Cf6 2.c4 e6 : retour au Gambit Dame',
    moves: `d4 Nf6{Coup le plus fréquent après 1.d4.} c4 e6 Nf3{Évite la Nimzo-indienne (3.Cc3 Fb4) qui est plus compliquée.} d5 Nc3{On est revenu dans le Gambit Dame Refusé !} Be7 Bg5 O-O e3 Nbd7 Rc1{Exactement les mêmes idées que dans la variante orthodoxe.}`,
  },
  {
    id: 'vs-kid',
    group: 'qg-other',
    name: 'Contre l’Est-indienne (2…g6)',
    moves: `d4 Nf6 c4 g6{L'Est-indienne : les Noirs laissent le centre pour l'attaquer plus tard.} Nc3 Bg7 e4{Prends tout le centre : quatre pions centraux contre deux.} d6 Nf3 O-O Be2{Développement classique et sûr.} e5 O-O Nc6 d5{On ferme le centre ; ton plan sera d'attaquer à l'aile dame (c5, b4).} Ne7`,
  },
  {
    id: 'vs-bogo',
    group: 'qg-other',
    name: 'Contre 3…Fb4+ (Bogo-indienne)',
    moves: `d4 Nf6 c4 e6 Nf3 Bb4+{Échec du fou.} Bd2{On s'interpose en développant.} Qe7 g3 Nc6 Bg2 Bxd2+ Nbxd2 d6 O-O{Développement harmonieux, léger avantage.}`,
  },
  {
    id: 'englund',
    group: 'qg-other',
    name: 'Gambit Englund (1…e5) : éviter le piège',
    moves: `d4 e5{Le gambit Englund : douteux, mais rempli de pièges.} dxe5 Nc6 Nf3 Qe7{Les Noirs espèrent 4.Ff4?? Db4+ ! 5.Fd2 Dxb2 6.Fc3?? Fb4 ! et mat avec Dc1#.} Qd5{Le bon coup : on protège e5 et b7 n'est pas menacé.} f6 exf6 Nxf6 Qb3{La dame se retire avec un pion de plus.}`,
  },
  {
    id: 'dutch',
    group: 'qg-other',
    name: 'Contre la Hollandaise (1…f5)',
    moves: `d4 f5{La Hollandaise : les Noirs contrôlent e4 et rêvent d'attaque à l'aile roi.} c4 Nf6 g3{Le fou en g2 contrôlera e4 et la grande diagonale.} e6 Bg2 Be7 Nf3 O-O O-O d5 b3{Le fou c1 ira en b2 ou a3 ; position agréable.}`,
  },

  // ───────────── Caro-Kann : Noirs ─────────────
  {
    id: 'ck-advance',
    group: 'ck',
    name: 'Variante d’avance (3.e5) avec 4.Cf3',
    moves: `e4 c6{La Caro-Kann : on prépare …d5.} d4 d5{On attaque e4.} e5{La variante d'avance : les Blancs gagnent de l'espace.} Bf5{Règle d'or : le fou sort AVANT …e6.} Nf3 e6{Maintenant on peut jouer e6 sans enfermer le fou.} Be2 c5{On attaque la base de la chaîne de pions d4 : c'est LE plan contre l'avance.} Be3 cxd4 Nxd4 Ne7{Le cavalier va en c6 ou g6 ; position solide pour toi.}`,
  },
  {
    id: 'ck-advance-bd3',
    group: 'ck',
    name: 'Avance avec 4.Fd3 (échange des fous)',
    moves: `e4 c6 d4 d5 e5 Bf5 Bd3{Les Blancs proposent l'échange de ton bon fou.} Bxd3 Qxd3 e6 Nf3 Qb6{La dame vise b2 et d4.} O-O c5{Le plan habituel : attaquer d4.} c3 Nc6{Pression maximale sur d4 ; tu es très bien.}`,
  },
  {
    id: 'ck-advance-g4',
    group: 'ck',
    name: 'Avance agressive : 4.Cc3 e6 5.g4',
    moves: `e4 c6 d4 d5 e5 Bf5 Nc3 e6 g4{Les Blancs chassent ton fou.} Bg6 Nge2 c5{Contre-attaque au centre : la meilleure défense contre une attaque à l'aile.} h4 h5{On bloque l'avance des pions blancs.}`,
  },
  {
    id: 'ck-exchange',
    group: 'ck',
    name: 'Variante d’échange (3.exd5 cxd5 4.Fd3)',
    moves: `e4 c6 d4 d5 exd5 cxd5{On reprend vers le centre.} Bd3 Nc6{Développement + pression sur d4.} c3 Nf6 Bf4 Bg4{Le fou sort avant e6, toujours la même règle.} Qb3 Qd7{On protège b7 en restant solide.} Nd2 e6 Ngf3 Bxf3 Nxf3 Bd6{On propose l'échange du fou f4, le meilleur fou blanc.} Bxd6 Qxd6{Égalité ; plan typique : …O-O, …Tab8 et …b5 (attaque des minorités).}`,
  },
  {
    id: 'ck-panov',
    group: 'ck',
    name: 'Attaque Panov (4.c4)',
    moves: `e4 c6 d4 d5 exd5 cxd5 c4{La Panov : les Blancs jouent pour un pion isolé en d4.} Nf6 Nc3 e6 Nf3 Be7 cxd5 Nxd5{Ton cavalier sur d5 est une case forte, devant le pion isolé.} Bd3 Nc6 O-O O-O{Plan : bloquer le pion d4, échanger des pièces, puis l'attaquer.}`,
  },
  {
    id: 'ck-classical',
    group: 'ck',
    name: 'Variante classique (3.Cc3 dxe4 4.Cxe4 Ff5)',
    moves: `e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5{Le fou sort en chassant le cavalier. Attention : 4…Cd7 5.De2 Cgf6?? 6.Cd6# est un mat étouffé célèbre !} Ng3 Bg6 h4 h6{On garde une case de retraite pour le fou.} Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6{Structure solide ; tu roqueras souvent du côté dame ou tu garderas ton roi au centre un moment.} Bd2 Ngf6 O-O-O Be7`,
  },
  {
    id: 'ck-classical-calm',
    group: 'ck',
    name: 'Classique sans h4 (6.Cf3)',
    moves: `e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 Nf3 Nd7 Bd3 Bxd3{On échange les fous : le fou d3 était le meilleur attaquant blanc.} Qxd3 e6 O-O Ngf6 Re1 Be7{Développement terminé ; tu roques et tu prépares …c5.}`,
  },
  {
    id: 'ck-two-knights',
    group: 'ck',
    name: 'Deux cavaliers (2.Cc3 d5 3.Cf3)',
    moves: `e4 c6 Nc3 d5 Nf3 Bg4{Le fou cloue le cavalier f3.} h3 Bxf3{On échange tout de suite.} Qxf3 e6{Les Blancs ont la paire de fous, toi une structure solide.} d3 Nd7 Bd2 Ngf6 O-O-O Qb6{La dame vise l'aile dame où le roi blanc a roqué.}`,
  },
  {
    id: 'ck-fantasy',
    group: 'ck',
    name: 'Variante Fantaisie (3.f3)',
    moves: `e4 c6 d4 d5 f3{La Fantaisie : les Blancs soutiennent e4 avec un pion.} e6{Simple : on prépare …Fb4 et …c5.} Nc3 Bb4{Le fou cloue le cavalier c3 qui défend e4.} Bd2 Ne7 a3 Ba5{On garde le fou : il continue de gêner le cavalier c3.} Bd3 Nd7{Plan : …c5 pour attaquer le centre, ou …dxe4 puis …Cg6/…Cf6 contre le pion e4.}`,
  },
  {
    id: 'ck-nf3',
    group: 'ck',
    name: '2.Cf3 : retour à l’avance',
    moves: `e4 c6 Nf3 d5 e5 Bf5 d4 e6{On retombe dans la variante d'avance : même plan …c5.} Be2 c5`,
  },
  {
    id: 'ck-c4',
    group: 'ck',
    name: '2.c4 : structure Panov',
    moves: `e4 c6 c4 d5 exd5 cxd5 cxd5 Nf6{On récupère le pion d5 avec le cavalier.} Nc3 Nxd5 Nf3 Nc6 d4{On retombe dans la Panov ; mêmes idées : bloquer et attaquer le pion isolé.} e6`,
  },
  {
    id: 'ck-d3',
    group: 'ck',
    name: '2.d3 : système fermé',
    moves: `e4 c6 d3 d5 Nd2 e5{Contre un système lent, on prend aussi le centre.} Ngf3 Bd6 g3 Nf6 Bg2 O-O O-O Re8{Position agréable et équilibrée.}`,
  },

  // ───────────── Slave : Noirs contre 1.d4 ─────────────
  {
    id: 'slav-main',
    group: 'slav',
    name: 'Slave principale (4.Cc3 dxc4)',
    moves: `d4 d5 c4 c6{La Slave : comme dans la Caro-Kann, le pion c6 soutient d5.} Nf3 Nf6 Nc3 dxc4{On prend le pion pour libérer le fou c8.} a4 Bf5{Le fou sort avant …e6, encore la même règle.} e3 e6 Bxc4 Bb4{Le fou vise le cavalier c3.} O-O O-O Qe2 Nbd7 e4 Bg6{Position solide et classique.}`,
  },
  {
    id: 'slav-exchange',
    group: 'slav',
    name: 'Slave d’échange (3.cxd5)',
    moves: `d4 d5 c4 c6 cxd5 cxd5{Structure symétrique : le jeu est calme.} Nc3 Nf6 Bf4 Nc6 e3 Bf5{Toujours le même fou actif.} Nf3 e6 Bb5 Nd7{Égalité confortable.}`,
  },
  {
    id: 'slav-e3',
    group: 'slav',
    name: 'Slave avec 4.e3 (Semi-Slave)',
    moves: `d4 d5 c4 c6 Nf3 Nf6 e3{Les Blancs enferment leur fou c1.} Bf5{Quand le fou c1 est enfermé, on sort le nôtre !} Nc3 e6 Nh4 Bg6 Nxg6 hxg6{La colonne h semi-ouverte compense la perte du fou.}`,
  },
  {
    id: 'vs-london',
    group: 'slav',
    name: 'Contre le Système de Londres (2.Ff4)',
    moves: `d4 d5 Bf4{Le Système de Londres, très populaire à ton niveau.} Nf6 e3 c5{Contre le Londres, on attaque d4 tout de suite.} c3 Nc6 Nd2 e6 Ngf3 Bd6{On propose l'échange du fou f4.} Bg3 O-O Bd3 b6{Le fou ira en b7 ; position confortable.}`,
  },
  // ───────────── Ouvertures recommandables (selon ton profil) ─────────────
  {
    id: 'london-main',
    group: 'london',
    name: 'Londres contre …d5 et …c5',
    moves: `d4{Comme dans le Gambit Dame.} d5 Bf4{Le fou sort AVANT e3 : c'est toute l'idée du Londres.} Nf6 e3 e6 Nf3 c5 c3{La pyramide c3-d4-e3 : solide comme un roc.} Nc6 Nbd2 Bd6 Bg3{On garde le fou : s'il prend en g3, on reprend hxg3 et la colonne h s'ouvre.} O-O Bd3{Le fou vise h7 : plan d'attaque avec Ce5, f4, Df3.}`,
  },
  {
    id: 'london-qb6',
    group: 'london',
    name: 'Londres : la menace …Db6',
    moves: `d4 d5 Bf4 c5 e3 Nc6 c3 Qb6{La dame attaque b2 : c'est LE piège à connaître contre le Londres.} Qb3{On propose l'échange des dames : b2 est protégé.} c4 Qxb6 axb6 Nd2{Le cavalier va contrôler c4/e4 ; finale égale et facile à jouer.}`,
  },
  {
    id: 'london-kid',
    group: 'london',
    name: 'Londres contre …g6 (setup indien)',
    moves: `d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2{Contre le fianchetto, le fou e2 est plus sûr.} d6 h3{Une case de retraite pour le fou f4, et pas de …Cg4/…Ch5 gênant.} c5 c3{Même pyramide de pions, même plan.}`,
  },
  {
    id: 'italian-giuoco',
    group: 'italian',
    name: 'Giuoco Piano (3…Fc5)',
    moves: `e4 e5 Nf3{Attaque e5 en développant.} Nc6 Bc4{Le fou vise f7, le point faible des Noirs.} Bc5 c3{Prépare d4 pour prendre le centre.} Nf6 d3{Version calme : on consolide e4 avant d'agir.} d6 O-O O-O Re1 a6 Bb3{On garde le fou sur la diagonale a2-g8.} Ba7 Nbd2{Le cavalier ira en f1 puis g3 : manœuvre typique.}`,
  },
  {
    id: 'italian-2knights',
    group: 'italian',
    name: 'Contre les Deux Cavaliers (3…Cf6)',
    moves: `e4 e5 Nf3 Nc6 Bc4 Nf6 d3{Simple et solide : on protège e4 et on évite les complications.} Be7 O-O O-O Re1 d6 c3{Comme dans le Giuoco Piano : plan h3, Cbd2-f1-g3.}`,
  },
  {
    id: 'italian-petrov',
    group: 'italian',
    name: 'Contre la Petrov (2…Cf6)',
    moves: `e4 e5 Nf3 Nf6{La défense Petrov : symétrique.} Nxe5 d6{Attention : 3…Cxe4?? 4.De2 et si 4…Cf6?? 5.Cc6+ gagne la dame !} Nf3 Nxe4 d4 d5 Bd3{Développement naturel, légèrement mieux pour les Blancs.}`,
  },
  {
    id: 'e5-italian',
    group: 'e5',
    name: '1…e5 contre l’Italienne',
    moves: `e4 e5{On prend sa part du centre.} Nf3 Nc6{Défend e5 en développant.} Bc4 Bc5{Le fou vise f2, le point faible des Blancs.} c3 Nf6{On attaque e4.} d3 d6 O-O O-O Re1 a6{Une case pour le fou en a7 s'il est attaqué par b4 ou d4.}`,
  },
  {
    id: 'e5-ruy',
    group: 'e5',
    name: '1…e5 contre l’Espagnole (3.Fb5)',
    moves: `e4 e5 Nf3 Nc6 Bb5{L'Espagnole : le fou attaque le défenseur de e5.} a6{On chasse le fou tout de suite.} Ba4 Nf6 O-O Be7{Solide : on se prépare à roquer.} Re1 b5 Bb3 d6 c3 O-O{L'Espagnole fermée : position riche et équilibrée.}`,
  },
  {
    id: 'e5-scotch',
    group: 'e5',
    name: '1…e5 contre l’Écossaise (3.d4)',
    moves: `e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5{Le fou attaque le cavalier d4.} Be3 Qf6{Pression sur d4 avec la dame et le fou.} c3 Nge7{Développement : le cavalier ne bloque pas la dame f6.}`,
  },
  {
    id: 'e5-friedliver',
    group: 'e5',
    name: '1…e5 : contre 4.Cg5 (Fried Liver)',
    moves: `e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5{Les Blancs attaquent f7 avec le cavalier et le fou.} d5{La seule bonne défense : on bloque la diagonale du fou.} exd5 Na5{Surtout pas 5…Cxd5?! qui permet le sacrifice 6.Cxf7 (Fried Liver). On chasse le fou.} Bb5+ c6 dxc6 bxc6 Be2 h6{On chasse le cavalier : les Noirs ont un pion de moins mais beaucoup d'activité.} Nf3 e4 Ne5`,
  },
  {
    id: 'scandi-main',
    group: 'scandi',
    name: 'Scandinave principale (3…Da5)',
    moves: `e4 d5{Tu attaques e4 tout de suite.} exd5 Qxd5 Nc3 Qa5{La dame se met à l'abri sur a5, d'où elle cloue le cavalier c3.} d4 Nf6 Nf3 c6{Une case de retraite pour la dame (c7) et contrôle de d5.} Bc4 Bf5{Le fou sort avant …e6, comme dans la Caro-Kann.} Bd2 e6{Structure solide ; tu roques ensuite et le plan est simple.}`,
  },
  {
    id: 'scandi-d4',
    group: 'scandi',
    name: 'Scandinave sans 3.Cc3',
    moves: `e4 d5 exd5 Qxd5 d4 Nf6 Nf3 Bg4{Le fou cloue le cavalier f3.} Be2 e6 O-O Nc6{Pression sur d4 ; développement harmonieux.}`,
  },
  {
    id: 'scandi-e5',
    group: 'scandi',
    name: 'Scandinave contre 2.e5',
    moves: `e4 d5 e5{Les Blancs évitent l'échange.} Bf5{Comme dans la Caro-Kann avance : le fou sort.} d4 e6 Nf3 c5{Même plan : attaquer la base d4.}`,
  },
  {
    id: 'qgd-black-main',
    group: 'qgd-black',
    name: 'GDR avec les Noirs (Tartakower)',
    moves: `d4 d5 c4 e6{Solide : on soutient d5.} Nc3 Nf6 Bg5 Be7{On déloue le cavalier f6.} e3 O-O Nf3 h6{On pose la question au fou.} Bh4 b6{Le fou c8 ira en b7 : il n'est plus enfermé.} cxd5 Nxd5 Bxe7 Qxe7 Nxd5 exd5{Structure solide, le fou b7 sera actif.}`,
  },
  {
    id: 'qgd-black-exchange',
    group: 'qgd-black',
    name: 'GDR avec les Noirs : variante d’échange',
    moves: `d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5{La diagonale du fou c8 s'ouvre !} Bg5 c6 e3 Be7 Bd3 Nbd7 Qc2 O-O{Attention à l'attaque des minorités (b4-b5) : réponds par …a6, …Te8, …Cf8.}`,
  },
];

/** Découpe la notation « coups {commentaires} » en [{ san, comment }]. */
export function parseLine(text) {
  const out = [];
  const re = /\{([^}]*)\}|([^\s{}]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      if (out.length) out.at(-1).comment = m[1].trim();
    } else {
      out.push({ san: m[2] });
    }
  }
  return out;
}

export const linesOf = (groupId) => OPENING_LINES.filter((l) => l.group === groupId);
export const groupOf = (line) => OPENING_GROUPS.find((g) => g.id === line.group);

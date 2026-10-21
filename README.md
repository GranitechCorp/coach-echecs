# ♟ Coach Échecs

Application perso pour progresser aux échecs sur téléphone (pensée pour un Galaxy S24 Ultra) :
**de 900 à 1600 Elo**, avec le Gambit Dame en Blancs et la Caro-Kann en Noirs.

C'est une **PWA** : un site web qui s'installe comme une appli, fonctionne hors connexion,
et fait tourner **Stockfish 18 directement sur le téléphone** (gratuit, sans serveur).

## Ce que fait l'appli

| | |
|---|---|
| **Jouer** | Contre l'ordinateur de 400 à 2400 Elo. Départ normal ou directement dans ton Gambit Dame / ta Caro-Kann / ta Slave. |
| **Indices** | 💡 1er appui : la pièce à jouer. 2e appui : le meilleur coup, avec l'explication. |
| **Pourquoi ?** | Explique le meilleur coup de la position ou ton dernier coup (menaces, fourchettes, clouages, pièces en prise, suite probable…). |
| **Coach en direct** | Te prévient quand tu fais une erreur ou une gaffe, t'explique pourquoi et te laisse reprendre ton coup. |
| **Bilan de partie** | Précision (%), chaque coup classé (meilleur, excellent, bon, théorie, imprécision, erreur, gaffe), courbe d'évaluation, moments clés expliqués, « rejouer d'ici ». |
| **Parties chess.com** | Importe tes parties chess.com (ou Lichess) avec ton pseudo et obtiens le même bilan que l'abonnement. |
| **Mes erreurs** | Chaque erreur de tes parties devient un exercice qui revient (1, 2, 4, 8 jours…) jusqu'à ce que tu le trouves à chaque fois. |
| **Exercices** | Puzzles Lichess (en ligne) par thème : fourchette, clouage, mat en 2, finales… avec un classement qui s'adapte à toi. |
| **Cours** | 19 leçons interactives en 5 modules : routine anti-gaffe, tactique, finales (mats de base, opposition, Lucena), stratégie, tes ouvertures. |
| **Ouvertures** | 44 lignes commentées (Gambit Dame et ses défenses, Caro-Kann, Slave, réponses à 1…Cf6, Englund, Hollandaise, Londres…) en mode *Apprendre* ou *S'entraîner* avec répétition espacée. |
| **Progrès (suivi chess.com)** | Synchronise automatiquement tes parties chess.com (compte *Granitech* par défaut), les analyse toutes avec Stockfish et calcule ton diagnostic : 8 compétences (ouverture, milieu, finales, vigilance, punir les erreurs, convertir un avantage, défense, gestion du temps), tes erreurs typiques (pièces en prise, fourchettes subies, occasions manquées, erreurs en finale ou par manque de temps…), tes résultats par ouverture et ton style de jeu. |
| **Programme personnalisé** | Un plan de 7 jours construit à partir de tes erreurs : exercices sur tes thèmes faibles, leçons ciblées, ouvertures où tu perds des points, parties à ton niveau. Affiché chaque jour sur l'accueil. |
| **Conseiller d'ouvertures** | Pour les Blancs, les Noirs contre 1.e4 et contre 1.d4 : l'ouverture la plus adaptée à ton style, ton niveau et tes résultats, avec les raisons et les lignes pour l'apprendre (Gambit Dame, Londres, Italienne, Caro-Kann, 1…e5, Scandinave, Slave, GDR). |
| **Coach IA (facultatif)** | Avec une clé API Claude : explications rédigées, bilan complet de partie, questions libres sur une position. |

Toutes les positions des cours et toutes les lignes d'ouverture sont **vérifiées par Stockfish** (`npm run check`).

## Installer sur le téléphone

1. Ouvre l'adresse de l'appli dans **Chrome** sur ton S24 Ultra (voir « Mise en ligne » plus bas).
2. Menu **⋮** → **Ajouter à l'écran d'accueil** → **Installer**.
3. L'appli s'ouvre en plein écran comme une vraie appli, et marche même sans réseau
   (sauf exercices Lichess, import chess.com et coach IA).

## Le coach IA (Claude) et tes crédits

Sans clé, tout fonctionne déjà : les explications viennent de Stockfish et de règles écrites pour l'appli.
Pour des explications « comme un vrai coach » :

1. Va sur **console.anthropic.com** → *API Keys* → crée une clé.
2. Dans l'appli : ⚙︎ **Réglages** → colle la clé → **Tester**.
3. Mets une **limite de dépense mensuelle** dans la console pour garder le contrôle.

Ordre de grandeur des coûts : avec Claude Opus 5.5, une explication coûte environ 2 à 4 centimes
et un bilan de partie environ 5 à 10 centimes. Avec Claude Haiku 5.5, c'est des dizaines de fois moins.
Avec 100 $ de crédit API, tu as donc plusieurs milliers d'explications.

La clé reste stockée sur ton téléphone et n'est envoyée qu'à `api.anthropic.com`.

## Mise en ligne (GitHub Pages, gratuit)

1. Crée un dépôt **public** `coach-echecs` sur GitHub et pousse ce code sur `main`.
2. Dans le dépôt : **Settings → Pages → Source : GitHub Actions**.
3. À chaque push sur `main`, l'appli est reconstruite et publiée sur
   `https://<ton-pseudo>.github.io/coach-echecs/`.

## Plan d'entraînement conseillé

- **Chaque jour** (≈ 30 min) : 10 exercices de tactique, revoir « Mes erreurs », 1 leçon ou 1 révision d'ouverture.
- **3 à 4 fois par semaine** : 1 partie contre l'ordinateur à ton niveau + 100/200, **puis son bilan**.
- **Chaque semaine** : importe tes parties chess.com et analyse au moins les défaites.
- Quand tu gagnes 2 parties sur 3 contre un niveau, monte d'un cran.

## Développement

```bash
npm install
npm run dev      # serveur local (accessible depuis le téléphone sur le même Wi-Fi)
npm run build    # version de production dans dist/
npm run check    # vérifie cours et ouvertures avec Stockfish (quelques minutes)
```

Structure :

- `src/engine.js` – Stockfish dans un Web Worker ; `src/bot.js` – niveaux de l'ordinateur
- `src/explain.js` – explications et classification des coups sans IA
- `src/coach-ai.js`, `src/prompts.js` – coach IA (SDK Anthropic)
- `src/data/lessons.js`, `src/data/openings.js` – contenu pédagogique
- `src/views/` – les écrans

## Licences

Code sous **GPL-3.0** (comme ses briques principales) :
[Stockfish](https://stockfishchess.org) / [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0),
[Chessground](https://github.com/lichess-org/chessground) (GPL-3.0), [chess.js](https://github.com/jhlywa/chess.js) (BSD-2),
pièces *cburnett* (CC BY-SA 3.0), puzzles [Lichess](https://database.lichess.org) (CC0).

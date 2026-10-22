import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles.css';
import './styles/vision.css';
import './styles/training.css';
import './styles/guess.css';
import './styles/self-review.css';
import './styles/review-intel.css';
import './styles/blunder.css';

import { load, touchStreak, update } from './storage.js';
import * as home from './views/home.js';
import * as playSetup from './views/play-setup.js';
import * as game from './views/game.js';
import * as review from './views/review.js';
import * as puzzles from './views/puzzles.js';
import * as learn from './views/learn.js';
import * as lesson from './views/lesson.js';
import * as opening from './views/opening.js';
import * as analysis from './views/analysis.js';
import * as freeBoard from './views/free-board.js';
import * as settings from './views/settings.js';
import * as profile from './views/profile.js';
import * as train from './views/train.js';
import * as vision from './views/vision.js';
import * as rush from './views/rush.js';
import * as woodpecker from './views/woodpecker.js';
import * as selfReview from './views/self-review.js';
import * as guess from './views/guess.js';
import * as blunder from './views/blunder.js';
import { autoSync } from './chesscom.js';

const routes = [
  [/^#?\/?$/, home],
  [/^#\/play(?:\/(\d+))?$/, playSetup],
  [/^#\/game$/, game],
  [/^#\/review\/([\w-]+)(?:\/(\d+))?$/, review],
  [/^#\/puzzles(?:\/(\w+))?(?:\/(\w+))?$/, puzzles],
  [/^#\/learn$/, learn],
  [/^#\/lesson\/([\w-]+)$/, lesson],
  [/^#\/opening\/([\w-]+)(?:\/(\w+))?$/, opening],
  [/^#\/analysis$/, analysis],
  [/^#\/profile$/, profile],
  [/^#\/board(?:\/(.+))?$/, freeBoard],
  [/^#\/settings$/, settings],
  [/^#\/train$/, train],
  [/^#\/vision(?:\/(\w+))?$/, vision],
  [/^#\/rush$/, rush],
  [/^#\/woodpecker$/, woodpecker],
  [/^#\/selfreview\/([\w-]+)$/, selfReview],
  [/^#\/guess(?:\/([\w-]+))?$/, guess],
  [/^#\/gaffe(?:\/(\w+))?$/, blunder],
];

const app = document.getElementById('app');
let cleanup = null;

function route() {
  try {
    cleanup?.();
  } catch (e) {
    console.warn(e);
  }
  cleanup = null;
  const h = location.hash || '#/';
  for (const [re, view] of routes) {
    const m = h.match(re);
    if (!m) continue;
    app.innerHTML = '';
    app.className = 'view-' + (view.tab || 'home');
    for (const a of document.querySelectorAll('#tabbar a')) a.classList.toggle('active', a.dataset.tab === view.tab);
    window.scrollTo(0, 0);
    cleanup = view.render(app, ...m.slice(1).map((x) => (x ? decodeURIComponent(x) : x))) || null;
    return;
  }
  location.hash = '#/';
}

load();
touchStreak();
window.addEventListener('hashchange', route);
route();

// synchro chess.com silencieuse au démarrage (au plus toutes les 6 h)
autoSync().then((r) => {
  if (r?.added) document.dispatchEvent(new CustomEvent('games-synced', { detail: r }));
});

if ('serviceWorker' in navigator && import.meta.env.PROD && !window.claude) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

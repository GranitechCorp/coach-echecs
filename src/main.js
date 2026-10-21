import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles.css';

import { load, touchStreak } from './storage.js';
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

const routes = [
  [/^#?\/?$/, home],
  [/^#\/play$/, playSetup],
  [/^#\/game$/, game],
  [/^#\/review\/([\w-]+)$/, review],
  [/^#\/puzzles(?:\/(\w+))?$/, puzzles],
  [/^#\/learn$/, learn],
  [/^#\/lesson\/([\w-]+)$/, lesson],
  [/^#\/opening\/([\w-]+)(?:\/(\w+))?$/, opening],
  [/^#\/analysis$/, analysis],
  [/^#\/board(?:\/(.+))?$/, freeBoard],
  [/^#\/settings$/, settings],
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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

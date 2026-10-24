import { db, update } from '../storage.js';
import { setTitle, esc } from '../ui.js';
import { LEVELS } from '../bot.js';
import { startGame } from './game.js';
import { START_FEN } from '../chessutil.js';

export const tab = 'play';

const STARTS = [
  { id: 'std', label: 'Position initiale', color: null, moves: '' },
  { id: 'qg', label: 'Mon Gambit Dame (1.d4 d5 2.c4)', color: 'w', moves: 'd4 d5 c4' },
  { id: 'ck', label: 'Ma Caro-Kann (1.e4 c6)', color: 'b', moves: 'e4 c6' },
  { id: 'slav', label: 'Ma Slave contre 1.d4 (1.d4 d5 2.c4 c6)', color: 'b', moves: 'd4 d5 c4 c6' },
];

export function render(root, presetElo) {
  setTitle('Nouvelle partie');
  const s = db();
  const pref = { ...(s.lastSetup || { elo: 1000, color: 'w', start: 'std' }) };
  if (presetElo) pref.elo = +presetElo;
  root.innerHTML = `
    <section class="card">
      <h2>Niveau de l’ordinateur</h2>
      <div class="chips" id="levels">
        ${LEVELS.map((l) => {
          const r = s.botResults[l.elo];
          return `<button class="chip ${l.elo === pref.elo ? 'on' : ''}" data-elo="${l.elo}"><b>${l.elo}</b><small>${esc(l.label)}</small>${r ? `<small class="rec">${r.w}V ${r.d}N ${r.l}D</small>` : ''}</button>`;
        }).join('')}
      </div>
      <p class="muted small">Conseil : joue contre un niveau 100 à 200 points au-dessus du tien. Quand tu gagnes 2 parties sur 3, monte d’un cran.</p>
    </section>
    <section class="card">
      <h2>Couleur</h2>
      <div class="seg" id="colors">
        <button data-c="w" class="${pref.color === 'w' ? 'on' : ''}">⚪ Blancs</button>
        <button data-c="b" class="${pref.color === 'b' ? 'on' : ''}">⚫ Noirs</button>
        <button data-c="r" class="${pref.color === 'r' ? 'on' : ''}">🎲 Hasard</button>
      </div>
      <h2>Départ</h2>
      <div class="radio-list" id="starts">
        ${STARTS.map((st) => `<label><input type="radio" name="start" value="${st.id}" ${st.id === pref.start ? 'checked' : ''}/> ${esc(st.label)}</label>`).join('')}
      </div>
    </section>
    <section class="card">
      <label class="switch"><input type="checkbox" id="live" ${s.settings.liveCoach ? 'checked' : ''}/> Coach en direct : m’alerter quand je fais une erreur, sans me donner la solution, pour que je cherche mieux (je peux reprendre mon coup)</label>
      <label class="switch"><input type="checkbox" id="evalbar" ${s.settings.showEvalDefault ? 'checked' : ''}/> Afficher la barre d’évaluation</label>
    </section>
    <button class="btn primary block" id="go">Commencer la partie</button>`;

  let elo = pref.elo;
  let color = pref.color;
  root.querySelector('#levels').addEventListener('click', (e) => {
    const b = e.target.closest('[data-elo]');
    if (!b) return;
    elo = +b.dataset.elo;
    root.querySelectorAll('#levels .chip').forEach((x) => x.classList.toggle('on', x === b));
  });
  root.querySelector('#colors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    color = b.dataset.c;
    root.querySelectorAll('#colors button').forEach((x) => x.classList.toggle('on', x === b));
  });
  root.querySelector('#starts').addEventListener('change', (e) => {
    const st = STARTS.find((x) => x.id === e.target.value);
    if (st?.color) {
      color = st.color;
      root.querySelectorAll('#colors button').forEach((x) => x.classList.toggle('on', x.dataset.c === color));
    }
  });
  root.querySelector('#go').addEventListener('click', () => {
    const start = root.querySelector('input[name=start]:checked').value;
    const st = STARTS.find((x) => x.id === start);
    const userColor = st.color || (color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : color);
    const liveCoach = root.querySelector('#live').checked;
    const showEval = root.querySelector('#evalbar').checked;
    update((d) => {
      d.lastSetup = { elo, color, start };
      d.settings.liveCoach = liveCoach;
      d.settings.showEvalDefault = showEval;
    });
    startGame({
      startFen: START_FEN,
      prefix: st.moves,
      userColor,
      elo,
      liveCoach,
      showEval,
    });
  });
}

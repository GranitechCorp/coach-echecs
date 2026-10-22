import { db } from '../storage.js';
import { setTitle, esc } from '../ui.js';
import { MODULES, LESSONS } from '../data/lessons.js';
import { OPENING_GROUPS, linesOf } from '../data/openings.js';

export const tab = 'learn';

export function render(root) {
  setTitle('Cours & ouvertures');
  const s = db();
  const dueLines = Object.entries(s.openings).filter(([, o]) => o.due <= Date.now()).length;
  root.innerHTML = `
    <div class="seg tabs"><a href="#/learn" class="on" data-sec="cours">Cours</a><a href="#/learn" data-sec="ouv">Ouvertures${dueLines ? ` <b class="pill">${dueLines}</b>` : ''}</a></div>
    <div id="sec-cours">
      ${MODULES.map((m) => {
        const ls = LESSONS.filter((l) => l.module === m.id);
        const done = ls.filter((l) => s.lessons[l.id]?.done).length;
        return `<section class="card">
          <div class="row between"><h2>${esc(m.name)}</h2><span class="muted small">${done}/${ls.length}</span></div>
          <p class="muted small">Niveau visé : ${esc(m.target)}</p>
          ${ls.map((l) => `<a class="list-item" href="#/lesson/${l.id}"><span>${s.lessons[l.id]?.done ? '✅' : '○'} ${esc(l.title)}</span><span class="muted small">${l.minutes} min</span></a>`).join('')}
        </section>`;
      }).join('')}
    </div>
    <div id="sec-ouv" hidden>
      <section class="card">
        <p>Choisis une ligne : <b>Apprendre</b> te montre les coups avec leurs explications, <b>S’entraîner</b> te demande de les jouer de mémoire. Les lignes reviennent en révision (1, 2, 4, 8 jours…) jusqu’à ce que tu les connaisses par cœur.</p>
        ${dueLines ? `<a class="btn primary" href="#/opening/due/train">Réviser les ${dueLines} lignes du jour</a>` : ''}
      </section>
      <a class="card link-card" href="#/tree"><b>🌳 Mon arbre d’ouvertures</b><span class="muted small">Tes parties regroupées coup par coup, comme dans ChessBase : où tu sors de ton répertoire, ce que jouent tes adversaires, tes résultats dans chaque variante.</span></a>
      ${OPENING_GROUPS.map((g) => `
        <section class="card">
          <h2>${g.side === 'w' ? '⚪' : '⚫'} ${esc(g.name)}</h2>
          <p class="muted small">${esc(g.intro)}</p>
          ${linesOf(g.id).map((l) => {
            const o = s.openings[l.id];
            const status = !o ? 'nouveau' : o.due <= Date.now() ? 'à réviser' : `maîtrise ${'★'.repeat(Math.min(o.box, 5))}`;
            return `<div class="line-item"><div><b>${esc(l.name)}</b><div class="muted small">${status}</div></div>
              <div class="row"><a class="btn small ghost" href="#/opening/${l.id}/learn">Apprendre</a><a class="btn small" href="#/opening/${l.id}/train">S’entraîner</a></div></div>`;
          }).join('')}
        </section>`).join('')}
    </div>`;
  const tabs = root.querySelectorAll('.tabs a');
  const show = (sec) => {
    tabs.forEach((t) => t.classList.toggle('on', t.dataset.sec === sec));
    root.querySelector('#sec-cours').hidden = sec !== 'cours';
    root.querySelector('#sec-ouv').hidden = sec !== 'ouv';
    sessionStorage.setItem('learn-sec', sec);
  };
  tabs.forEach((t) =>
    t.addEventListener('click', (e) => {
      e.preventDefault();
      show(t.dataset.sec);
    }),
  );
  show(sessionStorage.getItem('learn-sec') || 'cours');
}

// « Progrès » : synchro chess.com, analyse de toutes tes parties, diagnostic, priorités,
// programme de la semaine, évolution, ouvertures et conseils personnalisés.
import { db, update } from '../storage.js';
import { setTitle, esc, md, toast } from '../ui.js';
import { syncChesscom, TIME_FR } from '../chesscom.js';
import { analyzeMany, REVIEW_VERSION } from '../analyzer.js';
import { computeInsights, filterGames, SKILLS, linesForFamily, lessonTitle } from '../insights.js';
import { recommendOpenings, SLOTS } from '../advisor.js';
import { buildProgram, isDone, itemHref } from '../program.js';
import { skillBars, lineChart, attachLineTooltip } from '../charts.js';
import { THEME_LABELS } from '../data/themes.js';
import { frOpening } from '../data/opening-names.js';
import { OPENING_LINES } from '../data/openings.js';
import { askCoach, coachReady, inClaudeViewer } from '../coach-ai.js';
import { aiEnabled, profileReportLocal, acplForElo } from '../local-coach.js';
import { TAGS, tagCount } from '../explain.js';
import { promptProfileReport } from '../prompts.js';

export const tab = 'profile';

const CLASSES = [
  ['rapid', 'Rapide'],
  ['blitz', 'Blitz'],
  ['daily', 'Correspondance'],
  ['bullet', 'Bullet'],
  ['bot', 'Ordinateur'],
];
/** Nombre à une décimale, à la française (« 1,2 »). */
const dec1 = (v) => v.toFixed(1).replace('.', ',').replace('-', '−');
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const ago = (t) => {
  if (!t) return 'jamais';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `il y a ${m} min`;
  if (m < 48 * 60) return `il y a ${Math.round(m / 60)} h`;
  return `il y a ${Math.round(m / 1440)} jours`;
};

export function render(root) {
  setTitle('Mes progrès');
  let alive = true;
  let analyzing = false;
  const s0 = db();
  if (!s0.insightFilter) update((d) => (d.insightFilter = ['rapid', 'blitz', 'daily', 'bot']));

  function draw() {
    const s = db();
    const filter = s.insightFilter;
    const games = filterGames(s.games, filter);
    const ins = computeInsights(games);
    const elo = s.profile.currentElo || s.profile.startElo;
    const recs = recommendOpenings(ins, elo);
    const todo = games.filter((g) => !g.review?.derived && !g.review?.evals).reverse(); // les plus récentes d'abord
    // analyses faites avec une version précédente (sans 2e ligne du moteur : pas de « coups forts »)
    const old = games.filter((g) => g.review?.evals && (g.review.v || 0) < REVIEW_VERSION && !g.review.evals.some((e) => e.second)).reverse();
    const r = s.ccRatings || {};
    const prog = s.program;
    const progFresh = prog && Date.now() - new Date(prog.created).getTime() < 7 * 86400000;

    root.innerHTML = `
      <section class="card">
        <div class="row between"><h2>♟ ${esc(s.profile.chesscomUser || 'chess.com')}</h2><a class="small muted" href="#/settings">changer</a></div>
        <div class="chips">${Object.entries(r).map(([k, v]) => `<span class="chip small"><b>${v.rating}</b><small>${esc(TIME_FR[k] || k)}</small></span>`).join('') || '<span class="muted small">Classements non chargés</span>'}</div>
        <p class="small muted">Dernière synchro : ${ago(s.sync?.at)} · ${s.games.length} partie${s.games.length > 1 ? 's' : ''} enregistrée${s.games.length > 1 ? 's' : ''}</p>
        ${inClaudeViewer() ? `<p class="small">Dans claude.ai, la page ne peut pas contacter chess.com elle-même : importe tes parties en PGN (copier-coller ou fichier), c’est rapide.</p>
        <div class="row wrap"><a class="btn primary small" href="#/analysis">⬆ Importer mes parties chess.com</a></div>` : `<div class="row wrap">
          <button class="btn primary small" id="sync">⟳ Synchroniser chess.com</button>
          <a class="btn ghost small" href="#/analysis">Mes parties / importer</a>
        </div>`}
        <div id="sync-out" class="small"></div>
      </section>

      <section class="card">
        <h2>Parties prises en compte</h2>
        <div class="chips" id="filter">${CLASSES.map(([id, l]) => `<button class="chip small ${filter.includes(id) ? 'on' : ''}" data-f="${id}">${l}</button>`).join('')}</div>
        <p class="small">${games.length} partie${games.length > 1 ? 's' : ''} · <b>${ins.analysed}</b> analysée${ins.analysed > 1 ? 's' : ''} par Stockfish${todo.length ? ` · ${todo.length} à analyser` : ''}</p>
        ${todo.length ? `<div class="row wrap"><button class="btn small" id="an10">Analyser les ${Math.min(10, todo.length)} plus récentes</button>${todo.length > 10 ? `<button class="btn ghost small" id="anall">Tout analyser (${todo.length})</button>` : ''}</div>
        <p class="muted small">≈ 45 s par partie sur ton téléphone. Garde l’appli ouverte ; tu peux arrêter et reprendre quand tu veux.</p>` : ''}
        ${old.length ? `<p class="small muted ri-legacy">${old.length > 1 ? `${old.length} parties ont été analysées` : '1 partie a été analysée'} avec une version précédente : coups brillants, occasions manquées et Elo estimé y sont repérés, mais pas encore les coups forts. <button class="btn ghost small" id="anold">⟳ Mettre à jour ${old.length > 10 ? 'les 10 plus récentes' : old.length > 1 ? `ces ${old.length} parties` : 'cette partie'}</button></p>` : ''}
        <div id="an-out" hidden><div class="progress"><div id="an-bar" style="width:0%"></div></div><div class="row between small"><span id="an-txt"></span><button class="btn ghost small" id="an-stop">Arrêter</button></div></div>
      </section>

      ${levelCard(ins, s)}

      ${ins.analysed < 3 ? `<section class="card"><p>📊 Analyse au moins <b>3 parties</b> pour obtenir ton diagnostic. Plus il y a de parties analysées (idéalement 20 ou plus), plus le diagnostic est fiable.</p></section>` : `
      <section class="card">
        <h2>Ton diagnostic</h2>
        <p class="small muted">Sur ${ins.analysed} parties analysées · ${dec1(ins.bpg)} gaffe${ins.bpg >= 2 ? 's' : ''} par partie. Touche une compétence pour savoir comment elle est calculée.</p>
        ${skillBars(SKILLS.map((k) => ({ label: k.label, value: ins.skills[k.id], help: k.help })))}
        ${tagsDiagnostic(ins)}
      </section>

      <section class="card">
        <h2>Tes priorités</h2>
        ${ins.weaknesses.length ? ins.weaknesses.map((w, k) => `
          <div class="weak">
            <div class="weak-head"><span class="weak-rank">${k + 1}</span><b>${esc(w.title)}</b></div>
            <p class="small muted">${esc(w.detail)}</p>
            <p class="small">💡 ${esc(w.tip)}</p>
            <div class="row wrap">
              ${w.lessons.slice(0, 2).map((id) => `<a class="btn small ghost" href="#/lesson/${id}">📘 ${esc(lessonTitle(id))}</a>`).join('')}
              <a class="btn small" href="#/puzzles/theme/${w.theme}">✦ Exercices ${esc(THEME_LABELS[w.theme] || '')}</a>
              ${w.opening ? linesForFamily(w.opening.family, w.opening.color).slice(0, 1).map((l) => `<a class="btn small" href="#/opening/${l.id}/learn">📖 ${esc(l.name)}</a>`).join('') : ''}
              ${w.examples.length ? `<a class="btn small ghost" href="#/review/${w.examples.at(-1).gameId}/${w.examples.at(-1).i}">🔍 Voir un exemple</a>` : ''}
            </div>
          </div>`).join('') : '<p class="muted">Pas de faiblesse marquée détectée pour l’instant.</p>'}
      </section>`}

      <section class="card">
        <div class="row between"><h2>Ton programme de la semaine</h2>${progFresh ? '<button class="btn ghost small" id="regen">Regénérer</button>' : ''}</div>
        ${progFresh ? `${prog.focus?.length ? `<p class="small muted">Axes de travail : ${prog.focus.map(esc).join(' · ')}</p>` : ''}
          ${prog.days.map((d) => {
            const isToday = d.date === new Date().toISOString().slice(0, 10);
            const label = cap(new Date(d.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
            return `<details class="day" ${isToday ? 'open' : ''}><summary>${isToday ? '<b>Aujourd’hui</b>' : esc(label)}</summary>
              ${d.items.map((it) => `<a class="todo ${isToday && isDone(it) ? 'done' : ''}" href="${itemHref(it)}"><span class="check"></span><span>${esc(it.label)}${it.why ? `<br/><small class="muted">pour : ${esc(it.why)}</small>` : ''}</span></a>`).join('')}
            </details>`;
          }).join('')}` : `<p class="small">Un programme de 7 jours construit à partir de tes erreurs : exercices sur tes thèmes faibles, leçons ciblées, ouvertures où tu perds des points, parties à ton niveau.</p>
          <button class="btn primary" id="gen">Générer mon programme</button>`}
      </section>

      <section class="card">
        <h2>Évolution</h2>
        <div class="chips" id="rc">${['rapid', 'blitz', 'daily', 'bullet'].filter((k) => s.games.some((g) => g.timeClass === k)).map((k) => `<button class="chip small ${k === (s.ratingClass || 'rapid') ? 'on' : ''}" data-rc="${k}">${TIME_FR[k]}</button>`).join('')}</div>
        <p class="small muted">Classement chess.com</p>
        <div id="rating-chart"></div>
        <p class="small muted">Gaffes par partie (moyenne sur 5 parties)</p>
        <div id="blunder-chart"></div>
      </section>

      <section class="card">
        <h2>Tes ouvertures</h2>
        ${['w', 'b'].map((c) => {
          const list = ins.openings.filter((o) => o.color === c).slice(0, 6);
          return `<h4>${c === 'w' ? '⚪ Avec les Blancs' : '⚫ Avec les Noirs'}</h4>${list.length ? `<table class="otable"><thead><tr><th>Ouverture</th><th>Parties</th><th>Points</th><th>Coup 10</th></tr></thead><tbody>${list
            .map((o) => {
              const lines = linesForFamily(o.family, c);
              return `<tr class="${o.problem ? 'warn' : ''}"><td>${o.problem ? '⚠ ' : ''}${lines.length ? `<a href="#/opening/${lines[0].id}/learn">${esc(frOpening(o.family))}</a>` : esc(frOpening(o.family))}</td><td>${o.n}</td><td>${o.scorePct ?? '—'} %</td><td>${o.evalAt20 === null ? '—' : (o.evalAt20 > 0 ? '+' : '') + dec1(o.evalAt20 / 100)}</td></tr>`;
            })
            .join('')}</tbody></table>` : '<p class="muted small">Pas encore de parties.</p>'}`;
        }).join('')}
        <p class="muted small">« Coup 10 » : évaluation Stockfish moyenne après 10 coups (pour toi). ⚠ = ouverture où tu perds des points.</p>
      </section>

      <section class="card">
        <h2>Ton style et les ouvertures conseillées</h2>
        ${ins.analysed < 5 ? '<p class="muted small">Analyse au moins 5 parties pour des conseils fiables. En attendant, les conseils se basent sur ton niveau et ton répertoire actuel.</p>' : ''}
        <p><b>Style : ${esc(ins.style.label)}</b></p>
        <ul class="small">
          ${ins.style.activity !== null ? `<li>${ins.style.activity} % de tes coups de début de partie sont des captures ou des échecs.</li>` : ''}
          ${ins.style.openPerf !== null ? `<li>Tu marques ${Math.abs(Math.round(ins.style.openPerf * 100))} points de % de plus dans les positions ${ins.style.openPerf > 0 ? 'ouvertes' : 'fermées'}.</li>` : ''}
          ${ins.style.sharpPerf !== null ? `<li>Dans les parties très agitées, tu fais ${ins.style.sharpPerf >= 0 ? 'mieux' : 'moins bien'} que dans les parties calmes.</li>` : ''}
          ${ins.style.lateCastlePct !== null && ins.style.lateCastlePct >= 30 ? `<li>⚠ Dans ${ins.style.lateCastlePct} % de tes parties, tu roques tard ou pas du tout.</li>` : ''}
          ${ins.style.earlyQueenPct !== null && ins.style.earlyQueenPct >= 30 ? `<li>⚠ Tu sors ta dame avant le 6e coup dans ${ins.style.earlyQueenPct} % des parties.</li>` : ''}
        </ul>
        ${Object.entries(SLOTS).map(([slot, title]) => {
          const [best, alt] = recs[slot];
          const firstLine = (c) => OPENING_LINES.find((l) => c.groups.includes(l.group));
          return `<div class="rec"><div class="muted small">${esc(title)}</div>
            <div class="rec-best"><b>${esc(best.name)}</b> <a class="btn small" href="#/opening/${firstLine(best).id}/learn">Apprendre</a></div>
            <p class="small">${esc(best.pitch)}</p>
            <p class="small muted">Pourquoi pour toi : ${esc(best.reasons.length ? best.reasons.join(' ; ') : 'bon compromis entre ton style et la quantité de théorie')}.</p>
            ${alt ? `<p class="small">Alternative : <a href="#/opening/${firstLine(alt).id}/learn">${esc(alt.name)}</a></p>` : ''}
          </div>`;
        }).join('')}
        <p class="muted small">Ces conseils viennent de règles simples (ton répertoire, ton style mesuré, tes résultats par ouverture, la quantité de théorie adaptée à ton niveau).${aiEnabled() ? ' Pour un avis plus nuancé, demande le rapport du coach IA ci-dessous.' : ''} Changer d’ouverture coûte cher : à ton niveau, ce sont surtout les gaffes qui décident des parties.</p>
      </section>

      ${ins.analysed >= 3 ? `<section class="card">
        <h2>Ton bilan de coach</h2>
        <div class="coach-local">${md(profileReportLocal(ins, recs).join('\n'))}</div>
      </section>` : ''}

      ${aiEnabled() ? `<section class="card">
        <h2>✨ Rapport complet du coach IA</h2>
        <p class="small muted">Claude lit tout ton diagnostic et rédige un bilan, des conseils d’ouvertures et un plan sur 4 semaines.</p>
        <button class="btn ai" id="ai-report" ${ins.analysed < 3 ? 'disabled' : ''}>Demander mon rapport</button>
        <div id="ai-out">${s.aiReport ? `<p class="muted small">Dernier rapport : ${new Date(s.aiReport.date).toLocaleDateString('fr-FR')}</p>${md(s.aiReport.text)}` : ''}</div>
      </section>` : ''}`;

    // graphiques
    const rc = s.ratingClass || 'rapid';
    const rated = s.games.filter((g) => g.timeClass === rc && g.myRating);
    const rp = rated.map((g) => ({ y: g.myRating, x: new Date(g.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), label: `${new Date(g.date).toLocaleDateString('fr-FR')} : ${g.myRating} (${g.result})` }));
    root.querySelector('#rating-chart').innerHTML = lineChart(rp, { yLabel: 'Classement chess.com' });
    attachLineTooltip(root.querySelector('#rating-chart'), rp);
    const an = games.filter((g) => g.review?.derived).sort((a, b) => a.date.localeCompare(b.date));
    const bp = an.map((g, i) => {
      const win = an.slice(Math.max(0, i - 4), i + 1);
      const avg = win.reduce((a, x) => a + x.review.derived.errors.filter((e) => e.cls === 'blunder').length, 0) / win.length;
      return { y: avg, x: new Date(g.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), label: `${new Date(g.date).toLocaleDateString('fr-FR')} : ${dec1(avg)} gaffe${avg >= 2 ? 's' : ''} par partie` };
    });
    root.querySelector('#blunder-chart').innerHTML = lineChart(bp, { yLabel: 'Gaffes par partie', fmt: (v) => dec1(v) });
    attachLineTooltip(root.querySelector('#blunder-chart'), bp);
    const estBox = root.querySelector('#est-chart');
    if (estBox) {
      const ep = ins.estEloSeries.map((p) => {
        const day = new Date(p.date);
        const known = !!p.date && !Number.isNaN(day.getTime()); // partie sans date : pas de « Invalid Date »
        return { y: p.elo, x: known ? day.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '', label: `${known ? day.toLocaleDateString('fr-FR') + ' : ' : ''}≈ ${p.elo}` };
      });
      estBox.innerHTML = lineChart(ep, { yLabel: 'Elo estimé par partie', fmt: (v) => String(Math.round(v / 25) * 25) });
      attachLineTooltip(estBox, ep);
    }

    // ── événements ──
    const syncBtn = root.querySelector('#sync');
    if (syncBtn) syncBtn.onclick = async (e) => {
      const out = root.querySelector('#sync-out');
      e.target.disabled = true;
      try {
        const r2 = await syncChesscom(undefined, (t) => (out.textContent = t));
        toast(r2.added ? `${r2.added} nouvelle(s) partie(s) récupérée(s) ✓` : 'Déjà à jour ✓');
        if (alive) draw();
      } catch (err) {
        out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
        e.target.disabled = false;
      }
    };
    root.querySelector('#filter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      update((d) => {
        const f = new Set(d.insightFilter);
        f.has(b.dataset.f) ? f.delete(b.dataset.f) : f.add(b.dataset.f);
        d.insightFilter = [...f];
      });
      draw();
    });
    root.querySelector('#rc')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rc]');
      if (!b) return;
      update((d) => (d.ratingClass = b.dataset.rc));
      draw();
    });
    const runAnalysis = async (list) => {
      if (analyzing) return;
      analyzing = true;
      const box = root.querySelector('#an-out');
      box.hidden = false;
      let stop = false;
      root.querySelector('#an-stop').onclick = () => (stop = true);
      await analyzeMany(list, {
        depth: 10,
        isAlive: () => alive && !stop,
        onProgress: (done, total, frac) => {
          const bar = root.querySelector('#an-bar');
          if (!bar) return;
          bar.style.width = `${Math.round(((done + frac) / total) * 100)}%`;
          root.querySelector('#an-txt').textContent = `Partie ${done + 1} / ${total}`;
        },
      });
      analyzing = false;
      if (alive) {
        toast('Analyse terminée ✓');
        draw();
      }
    };
    root.querySelector('#an10')?.addEventListener('click', () => runAnalysis(todo.slice(0, 10)));
    root.querySelector('#anall')?.addEventListener('click', () => runAnalysis(todo));
    root.querySelector('#anold')?.addEventListener('click', () => runAnalysis(old.slice(0, 10)));
    const gen = () => {
      buildProgram(ins);
      toast('Programme généré ✓');
      draw();
    };
    root.querySelector('#gen')?.addEventListener('click', gen);
    root.querySelector('#regen')?.addEventListener('click', gen);
    const aiReportBtn = root.querySelector('#ai-report');
    if (aiReportBtn) aiReportBtn.onclick = async (e) => {
      if (!coachReady()) return toast('Ajoute ta clé API Claude dans les Réglages (⚙︎).', 4000);
      const out = root.querySelector('#ai-out');
      e.target.disabled = true;
      out.innerHTML = '<p class="muted">Le coach étudie ton profil…</p>';
      try {
        const text = await askCoach(promptProfileReport({ ins, recs, profile: s.profile, ratings: s.ccRatings, skillsLabels: SKILLS, slots: SLOTS }), {
          effort: 'medium',
          onText: (t) => (out.innerHTML = md(t)),
        });
        update((d) => (d.aiReport = { date: new Date().toISOString(), text }));
      } catch (err) {
        out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      }
      e.target.disabled = false;
    };
  }

  draw();
  const onSynced = () => alive && !analyzing && draw();
  document.addEventListener('games-synced', onSynced);
  return () => {
    alive = false;
    document.removeEventListener('games-synced', onSynced);
  };
}

/** Elo chess.com de référence (rapide, sinon blitz, sinon classement mémorisé). */
function chesscomElo(s) {
  const r = s.ccRatings || {};
  if (r.rapid?.rating) return { value: r.rapid.rating, label: 'Elo chess.com en rapide' };
  if (r.blitz?.rating) return { value: r.blitz.rating, label: 'Elo chess.com en blitz' };
  if (s.profile.currentElo) return { value: s.profile.currentElo, label: 'ton Elo chess.com' };
  return null;
}

/** Carte « Niveau de jeu estimé » : médiane des dernières parties, comparaison et courbe. */
function levelCard(ins, s) {
  if (!ins.estElo) return '';
  const cc = chesscomElo(s);
  const n = ins.estEloN;
  const diff = cc ? ins.estElo - cc.value : 0;
  let cmp = '';
  if (cc) {
    if (diff >= 150) cmp = `Tu joues environ ${Math.round(diff / 25) * 25} points au-dessus de ton classement : si tu restes régulier, ton Elo devrait monter.`;
    else if (diff <= -150) cmp = `C’est sous ton classement : en général, ce sont quelques grosses gaffes qui font chuter la moyenne. Les éviter, c’est ton plus gros levier.`;
    else cmp = 'C’est cohérent avec ton classement chess.com.';
  }
  const goal = s.profile.goalElo;
  const target = goal && ins.estAcpl !== null && ins.estElo < goal
    ? `<p class="small">🎯 Pour jouer à ${goal}, il faut perdre en moyenne environ <b>${acplForElo(goal)} centipions</b> par coup ; tu en es à <b>${ins.estAcpl}</b>.</p>`
    : '';
  const tags = ['brilliant', 'great', 'miss'].filter((t) => ins[{ brilliant: 'brilliants', great: 'greats', miss: 'misses' }[t]]);
  const lastB = ins.brilliantMoves.at(-1);
  return `<section class="card">
    <h2>Niveau de jeu estimé</h2>
    <div class="ri-level-row">
      <div><div class="big">≈ ${ins.estElo}</div><div class="small muted">${n > 1 ? `médiane de tes ${n} dernières parties analysées` : 'd’après ta seule partie analysée'}</div></div>
      ${cc ? `<div><div class="big muted">${cc.value}</div><div class="small muted">${esc(cc.label)}</div></div>` : ''}
    </div>
    ${cmp ? `<p class="small">${cmp}</p>` : ''}
    ${n < 5 ? '<p class="small muted">Encore peu de parties : l’estimation deviendra fiable à partir de 5 à 10 parties analysées.</p>' : ''}
    ${target}
    ${ins.estEloSeries.length >= 2 ? '<p class="small muted">Elo estimé à chaque partie</p><div id="est-chart"></div>' : ''}
    ${tags.length ? `<div class="ri-tags-line">${tags.map((t) => `<span class="badge ri-tag ri-${TAGS[t].css}"><b>${TAGS[t].sym}</b> ${tagCount(t, ins[{ brilliant: 'brilliants', great: 'greats', miss: 'misses' }[t]])}</span>`).join('')}</div>` : ''}
    ${lastB ? `<a class="btn small ri-btn-brilliant" href="#/review/${encodeURIComponent(lastB.gameId)}/${lastB.i}">💎 Revoir mon dernier coup brillant</a>` : ''}
    <p class="muted small">Estimation indicative, calculée comme l’« Elo de la partie » du bilan chess.com : plus tu perds peu de terrain à chaque coup (mesuré par Stockfish), plus elle est haute. Une partie isolée varie beaucoup : c’est la tendance qui compte.</p>
  </section>`;
}

/** Ligne du diagnostic sur les coups brillants / forts et les occasions manquées. */
function tagsDiagnostic(ins) {
  const { brilliants: b, greats: g, misses: m } = ins;
  if (!b && !g && !m) return '';
  const good = [b ? `💎 ${tagCount('brilliant', b)}` : '', g ? tagCount('great', g) : ''].filter(Boolean).join(' et ');
  const parts = [];
  if (good) parts.push(`Tu as déjà joué ${good} : tu sais trouver des coups difficiles.`);
  if (m) parts.push(`${good ? 'Mais ' : ''}${tagCount('miss', m)} : ${m > 1 ? 'des erreurs adverses que tu n’as pas punies' : 'une erreur adverse que tu n’as pas punie'}.`);
  return `<p class="small">${parts.join(' ')}</p>`;
}

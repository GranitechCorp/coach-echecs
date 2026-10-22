import { db } from '../storage.js';
import { setTitle, esc } from '../ui.js';
import { LESSONS, MODULES } from '../data/lessons.js';
import { todayItems, isDone, itemHref } from '../program.js';
import { visionStats } from './vision.js';
import { computeInsights, filterGames } from '../insights.js';

export const tab = 'home';

const today = () => new Date().toISOString().slice(0, 10);

export function estimatedLevel(s) {
  const wins = Object.entries(s.botResults)
    .filter(([, r]) => r.w >= 1)
    .map(([elo]) => +elo);
  const bot = wins.length ? Math.max(...wins) : s.profile.startElo;
  const puzzle = s.puzzles.played >= 10 ? s.puzzles.rating : s.profile.startElo;
  return Math.round((0.5 * bot + 0.5 * puzzle) / 10) * 10;
}

function nextLesson(s) {
  return LESSONS.find((l) => !s.lessons[l.id]?.done);
}

export function render(root) {
  setTitle('Coach Échecs');
  const onSynced = () => root.isConnected && render(root);
  document.addEventListener('games-synced', onSynced, { once: true });
  const s = db();
  const t = today();
  const puzzlesToday = s.puzzles.history.filter((h) => h.date?.startsWith(t)).length;
  const gamesToday = s.games.filter((g) => g.date?.startsWith(t)).length;
  const studiedToday = Object.values(s.lessons).some((l) => l.date?.startsWith(t)) || Object.values(s.openings).some((o) => o.last?.startsWith(t));
  const due = s.mistakes.filter((m) => m.due <= Date.now()).length;
  const ccElo = s.ccRatings?.rapid?.rating || s.ccRatings?.blitz?.rating || null;
  const level = ccElo || estimatedLevel(s);
  const levelLabel = ccElo ? `Ton Elo chess.com (${s.ccRatings?.rapid ? 'rapide' : 'blitz'})` : 'Ton niveau estimé';
  const items = todayItems();
  const vision = visionStats();
  const ins = computeInsights(filterGames(s.games, s.insightFilter || ['rapid', 'blitz', 'daily', 'bot']));
  const { startElo, goalElo } = s.profile;
  const pct = Math.max(2, Math.min(100, ((level - startElo) / (goalElo - startElo)) * 100));
  const lesson = nextLesson(s);
  const cur = s.currentGame && !s.currentGame.over ? s.currentGame : null;
  const lastGames = s.games.slice(-4).reverse();
  const weak = Object.entries(s.puzzles.themes)
    .filter(([, v]) => v.played >= 3)
    .sort((a, b) => a[1].solved / a[1].played - b[1].solved / b[1].played)
    .slice(0, 2);

  root.innerHTML = `
    <section class="card hero">
      <div class="row between">
        <div>
          <div class="muted small">${levelLabel}</div>
          <div class="big">${level}</div>
        </div>
        <div class="right">
          <div class="muted small">Objectif</div>
          <div class="big accent">${goalElo}</div>
        </div>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="row between small muted">
        <span>Départ ${startElo}</span>
        <span>🔥 ${s.streak.days} jour${s.streak.days > 1 ? 's' : ''} d’affilée</span>
      </div>
      ${ins.estElo ? `<div class="small hero-est">Niveau de jeu estimé sur tes ${ins.estEloN} dernières parties analysées : <b>≈ ${ins.estElo}</b>${ins.brilliants ? ` · 💎 ${ins.brilliants} coup${ins.brilliants > 1 ? 's' : ''} brillant${ins.brilliants > 1 ? 's' : ''}` : ''}</div>` : ''}
    </section>

    ${!items && vision.level !== 'solide' ? `<a class="card link-card vision-cta" href="#/vision"><b>👁 Vision de l’échiquier ${vision.dailyDone ? '✓' : ''}</b><span class="muted small">${vision.dailyDone ? 'Défi du jour fait. Bravo !' : `5 minutes par jour pour situer c4, c6 ou h7 sans regarder les lettres. Ton record : ${vision.bestFind} case${vision.bestFind > 1 ? 's' : ''} en 30 s.`}</span></a>` : ''}

    ${cur ? `<a class="card link-card resume" href="#/game"><b>▶ Reprendre ta partie</b><span class="muted">contre l’ordinateur ${cur.elo} — ${Math.ceil(cur.moves.length / 2)} coups joués</span></a>` : ''}

    ${items ? `<section class="card">
      <div class="row between"><h2>Ton programme du jour</h2><a class="small muted" href="#/profile">semaine →</a></div>
      ${items.map((it) => `<a class="todo ${isDone(it) ? 'done' : ''}" href="${itemHref(it)}"><span class="check"></span><span>${esc(it.label)}${it.why ? `<br/><small class="muted">pour : ${esc(it.why)}</small>` : ''}</span></a>`).join('')}
    </section>` : `<section class="card">
      <h2>Plan du jour</h2>
      <a class="todo ${puzzlesToday >= 10 ? 'done' : ''}" href="#/puzzles"><span class="check"></span><span>10 exercices de tactique <small>(${Math.min(puzzlesToday, 10)}/10)</small></span></a>
      <a class="todo ${due === 0 ? 'done' : ''}" href="#/puzzles/mistakes"><span class="check"></span><span>Revoir mes erreurs <small>(${due} à revoir)</small></span></a>
      <a class="todo ${gamesToday >= 1 ? 'done' : ''}" href="#/play"><span class="check"></span><span>1 partie contre l’ordinateur + son bilan</span></a>
      <a class="todo ${studiedToday ? 'done' : ''}" href="${lesson ? `#/lesson/${lesson.id}` : '#/learn'}"><span class="check"></span><span>1 leçon ou 1 révision d’ouverture${lesson ? ` <small>(suivante : ${esc(lesson.title)})</small>` : ''}</span></a>
      <a class="btn small" href="#/profile">✨ Créer mon programme personnalisé</a>
    </section>`}

    <a class="card link-card" href="#/profile">
      <b>📈 Mon diagnostic</b>
      <span class="muted small">${ins.analysed >= 3 && ins.weaknesses.length ? `Priorité n°1 : ${esc(ins.weaknesses[0].title)}` : `${s.games.filter((g) => g.source === 'chess.com').length} parties chess.com récupérées · ${ins.analysed} analysées — analyse-les pour ton diagnostic`}</span>
    </a>

    ${weak.length ? `<section class="card"><h2>À travailler</h2>${weak
      .map(([th, v]) => `<p>• Thème « ${esc(th)} » : ${Math.round((100 * v.solved) / v.played)} % de réussite</p>`)
      .join('')}<a class="btn small" href="#/puzzles">S’entraîner</a></section>` : ''}

    <section class="grid2">
      <a class="tile" href="#/play"><span>♟</span>Jouer</a>
      <a class="tile" href="#/train"><span>✦</span>Entraînement</a>
      <a class="tile" href="#/learn"><span>❖</span>Cours & ouvertures</a>
      <a class="tile" href="#/profile"><span>📈</span>Mes progrès & chess.com</a>
    </section>

    ${lastGames.length ? `<section class="card"><h2>Dernières parties</h2>${lastGames
      .map((g) => `<a class="list-item" href="#/review/${g.id}"><span>${g.userColor === 'w' ? '⚪' : '⚫'} ${esc(g.label || '')}</span><span class="muted">${esc(g.result)}${g.review ? ` · ${Math.round(g.review.accuracy[g.userColor])} %` : ''}</span></a>`)
      .join('')}</section>` : ''}

    <section class="card small muted">
      <p>Programme : ${MODULES.map((m) => esc(m.name)).join(' · ')}</p>
    </section>`;
}

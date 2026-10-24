// Anti-gaffe : « Sûr ou gaffe ? » et « Punis la gaffe », à partir de tes propres parties.
// La méthode de Dan Heisman (« Real chess ») : avant chaque coup, imagine-le joué et regarde ce que ton adversaire
// peut faire ensuite (échecs, prises, menaces), et si chacune de tes pièces reste protégée.
// Les positions et les explications viennent de blunder-data.js ; ici, seulement l'affichage.
import { Chess } from 'chess.js';
import { db } from '../storage.js';
import { setTitle, esc, md, moveSound, sleep } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { getAnalysisEngine } from '../engine.js';
import { playUci, uciOf, cgColor, cpWhite, fig, VALUE } from '../chessutil.js';
import { runPuzzle } from './puzzle-runner.js';
import * as B from '../blunder-data.js';

export const tab = 'puzzles';

const PREP_DEPTH = 10; // positions fabriquées (parties modèles) : préparées à l'avance, vite
const CONFIRM_DEPTH = 14; // confirmation avant d'être montrée : gaffes de tes parties (bilan à la profondeur 10), positions fabriquées
const CHECK_DEPTH = 12; // vérification d'une autre punition que celle prévue
const ENGINE_TIMEOUT = 20000;
const MODES = { check: 'Sûr ou gaffe ?', punish: 'Punis la gaffe' };
const QUESTIONS = [
  ['Échecs ?', 'Quels échecs pourra-t-il me donner ?'],
  ['Prises ?', 'Que pourra-t-il prendre ? Chacune de mes pièces est-elle assez protégée ?'],
  ['Menaces ?', 'Que pourra-t-il menacer : un mat, une fourchette, une pièce ?'],
];

/** Espaces insécables avant « ? ! : ; » et dans les guillemets : la ponctuation ne passe jamais seule à la ligne. */
const nb = (s) => String(s).replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;
const pct = (v) => (v == null ? '–' : `${v} %`);
const sound = (capture) => db().settings.sound && moveSound(capture);

/** Fait défiler doucement la page pour que le bouton soit visible au-dessus de la barre d'onglets. */
function reveal(el) {
  setTimeout(() => {
    if (!el?.isConnected || el.closest('[hidden]')) return;
    const bar = document.getElementById('tabbar')?.getBoundingClientRect().top ?? innerHeight;
    const r = el.getBoundingClientRect();
    if (r.bottom > bar - 8) window.scrollBy({ top: r.bottom - bar + 16, behavior: 'smooth' });
  }, 60);
}

/** Où tu en es (salle d'entraînement et programme) : positions faites aujourd'hui, au total, précision. */
export function blunderStats() {
  return B.blunderStats();
}

export function render(root, mode) {
  if (mode === 'check' || mode === 'punish') return renderSession(root, mode);
  if (mode) {
    location.hash = '#/gaffe';
    return null;
  }
  return renderMenu(root);
}

// ─────────────── Menu ───────────────

function renderMenu(root) {
  setTitle('Anti-gaffe', '#/train');
  let alive = true;
  const all = B.blunderStats();
  const st = { check: B.modeStats('check'), punish: B.modeStats('punish') };
  const due = st.check.due + st.punish.due;
  const modeCard = (mode, icon, text) => `
    <a class="card bl-mode" href="#/gaffe/${mode}">
      <span class="bl-mode-icon">${icon}</span>
      <span class="bl-mode-txt"><b>${nb(MODES[mode])}</b><small>${esc(nb(text))}</small><small class="bl-mode-src" data-src="${mode}">Je regarde tes parties…</small></span>
      ${st[mode].due ? `<span class="pill">${st[mode].due}</span>` : ''}
    </a>`;
  root.innerHTML = `
    <section class="card bl-method">
      <h2>Le contrôle anti-gaffe</h2>
      <p>${esc(nb('Avant de lâcher ta pièce, imagine ton coup joué et regarde l’échiquier avec les yeux de ton adversaire. Trois questions :'))}</p>
      <ol class="bl-questions">${QUESTIONS.map(([q, t]) => `<li><b>${nb(q)}</b> ${esc(nb(t))}</li>`).join('')}</ol>
      <p class="muted small">${esc(nb('C’est la méthode de Dan Heisman, entraîneur américain : jouer aux « vrais échecs », c’est penser aux coups de l’adversaire avant chacun de ses propres coups. Ici, tu l’entraînes sur tes parties.'))}</p>
    </section>
    <section class="bl-stats">
      <div><b>${all.today}</b><small>aujourd’hui</small></div>
      <div><b>${pct(st.check.accuracy)}</b><small>${nb('Sûr ou gaffe ?')}</small></div>
      <div><b>${pct(st.punish.accuracy)}</b><small>Punis la gaffe</small></div>
      <div><b class="${due ? 'bl-due' : ''}">${due}</b><small>à revoir</small></div>
    </section>
    ${due ? `<p class="muted small bl-due-note">${esc(nb(`${plural(due, 'position ratée', 'positions ratées')} ${due > 1 ? 'reviennent' : 'revient'} aujourd’hui : ${due > 1 ? 'elles passent' : 'elle passe'} avant les nouvelles positions.`))}</p>` : ''}
    ${modeCard('check', '🛡', 'On te montre le coup que tu t’apprêtes à jouer : sûr ou gaffe ? Si c’est une gaffe, prouve-le en trouvant la punition.')}
    ${modeCard('punish', '⚔', 'Ton adversaire vient de se tromper : trouve le coup qui le punit, en passant en revue échecs, prises et menaces.')}
    <p class="muted small bl-foot">${esc(nb('Séances de 10 positions. Les positions ratées reviennent les jours suivants, jusqu’à ce que tu les réussisses.'))}</p>`;
  B.loadPools({ isAlive: () => alive })
    .catch((e) => {
      console.warn('Anti-gaffe : lecture des parties impossible', e);
      return { gaffes: [], safes: [], punish: [], games: 0 };
    })
    .then((pools) => {
      if (!alive || !pools) return;
      const src = (m) => root.querySelector(`[data-src=${m}]`);
      src('check').textContent = nb(checkSource(pools));
      src('punish').textContent = nb(punishSource(pools));
    });
  return () => {
    alive = false;
  };
}

function checkSource(p) {
  const nG = p.gaffes.length;
  const nS = p.safes.length;
  if (!nG && !nS) {
    return db().games.length
      ? 'Analyse tes parties (onglet Progrès) pour t’entraîner sur les tiennes ; en attendant, positions de parties modèles vérifiées par Stockfish.'
      : 'Pas encore de partie analysée : positions de parties modèles, vérifiées par Stockfish.';
  }
  const more = nG < 5 || nS < 5 ? ', complétés par des parties modèles' : '';
  return `${plural(nG, 'gaffe')} et ${plural(nS, 'coup sûr', 'coups sûrs')} tirés de tes parties${more}.`;
}

function punishSource(p) {
  const n = p.punish.length;
  if (!n) return 'Pas encore d’erreur adverse à punir dans tes parties analysées : exercices « pièce en prise » à ton niveau.';
  const missed = p.punish.filter((x) => !x.found).length;
  const more = n < 10 ? ', complétées par des exercices de la banque' : '';
  return `${plural(n, 'position')} de tes parties, dont ${missed} que tu n’avais pas ${missed > 1 ? 'punies' : 'punie'}${more}.`;
}

// ─────────────── Séance ───────────────

function renderSession(root, mode) {
  setTitle(MODES[mode], '#/gaffe');
  let alive = true;
  const ac = new AbortController();
  let stopItem = null; // nettoyage de la position affichée
  let S = null; // séance en cours
  let engineDown = false; // le moteur n'a pas répondu à temps : on ne l'attend plus pendant cette séance
  root.innerHTML = `
    <div class="bl-hud"><span class="bl-count"></span><span class="bl-dots"></span><span class="bl-score"></span></div>
    <div class="bl-stage"></div>`;
  const stage = root.querySelector('.bl-stage');
  const hudEl = root.querySelector('.bl-hud');

  /** Stockfish (profondeur depth) → { pv, white } ; lève une erreur s'il ne répond pas ou si l'écran est quitté. */
  const search = (depth) => async (fen) => {
    if (engineDown || !alive) throw new Error('moteur indisponible');
    const job = getAnalysisEngine().search(fen, { depth, signal: ac.signal });
    const r = await Promise.race([job, sleep(ENGINE_TIMEOUT).then(() => null)]);
    if (!r) engineDown = true;
    if (!r || r.aborted || !r.lines?.[0]?.pv?.length) throw new Error('moteur indisponible');
    return { pv: r.lines[0].pv.slice(0, 6), white: r.lines[0].white };
  };

  /** Bandeau : numéro de la position affichée, une pastille par position (verte réussie, orange ratée), score. */
  function hud(ses, final = false) {
    const total = Math.max(0, ses.specs.length - ses.skipped);
    const done = ses.results.length;
    const ok = ses.results.filter((r) => r.ok).length;
    hudEl.querySelector('.bl-count').textContent = final ? `${done} / ${done}` : `${Math.max(1, Math.min(ses.shown, total))} / ${total}`;
    hudEl.querySelector('.bl-score').textContent = `✓ ${ok}`;
    let dots = ses.results.map((r) => `<span class="${r.ok ? 'ok' : 'ko'}"></span>`).join('');
    if (!final) for (let k = done; k < total; k++) dots += `<span class="${k === done && ses.shown > done ? 'cur' : ''}"></span>`;
    hudEl.querySelector('.bl-dots').innerHTML = dots;
  }

  async function start() {
    stopItem?.();
    stopItem = null;
    window.scrollTo(0, 0);
    hudEl.hidden = true;
    stage.innerHTML = '<p class="card muted">Je prépare ta séance…</p>';
    let pools;
    try {
      pools = await B.loadPools({ isAlive: () => alive });
    } catch (e) {
      console.warn('Anti-gaffe : lecture des parties impossible', e);
      pools = { gaffes: [], safes: [], punish: [], games: 0 }; // parties modèles et banque à la place
    }
    if (!alive || !pools) return;
    const { specs, used, spare } = B.planSession(mode, pools);
    S = { specs, used, spare, slots: [], k: 0, shown: 0, results: [], skipped: 0 };
    hudEl.hidden = false;
    show(S, 0);
  }

  /** Prépare la position k (tout de suite si elle vient de tes parties, sinon avec Stockfish). */
  function prep(ses, k) {
    if (k >= ses.specs.length) return null;
    if (!ses.slots[k]) {
      const spec = ses.specs[k];
      // position de tes parties : prête tout de suite (pas d'écran d'attente)
      if (!spec.lazy && !spec.need) ses.slots[k] = { done: true, job: Promise.resolve(spec) };
      else {
        const slot = { done: false, job: resolve(ses, spec).catch(() => null) };
        slot.job.then(() => (slot.done = true));
        ses.slots[k] = slot;
      }
    }
    return ses.slots[k];
  }

  async function resolve(ses, spec) {
    const opts = { search: search(PREP_DEPTH), deep: search(CONFIRM_DEPTH), exclude: ses.used };
    if (spec.need) {
      // gaffe de tes parties : confirmée plus profond que le bilan, sinon une autre de tes parties (4 essais),
      // sinon une partie modèle ; si le moteur ne répond pas, on garde l'analyse du bilan quand elle est complète
      for (let it = spec, n = 0; it && n < 4; it = spareOf(ses), n++) {
        let done;
        try {
          done = it.need ? await B.completeItem(it, opts.deep) : it;
        } catch (e) {
          if (!alive) throw e;
          done = it.before && it.after ? { ...it, need: false } : null;
        }
        if (done) return done;
      }
      return B.modelCheckItem('gaffe', opts);
    }
    if (!spec.lazy) return spec;
    if (spec.want === 'bank') {
      const seenIds = B.blunderState().seen.filter((k) => k.startsWith('b:')).map((k) => k.slice(2));
      return B.bankPunishItem(db().puzzles.rating, ses.used, seenIds);
    }
    return B.modelCheckItem(spec.want, opts);
  }

  /** Prochaine gaffe de tes parties restée en réserve (pas encore dans la séance). */
  function spareOf(ses) {
    while (ses.spare.length) {
      const it = ses.spare.shift();
      const key = B.posKey(it.fen);
      if (ses.used.has(key)) continue;
      ses.used.add(key);
      return it;
    }
    return null;
  }

  async function show(ses, k) {
    stopItem?.();
    stopItem = null;
    stage.classList.remove('bl-done'); // l'échiquier reprend sa taille pour la position suivante
    window.scrollTo(0, 0);
    if (k >= ses.specs.length) return finish(ses);
    ses.k = k;
    hud(ses);
    const slot = prep(ses, k);
    if (!slot.done) stage.innerHTML = `<p class="card muted bl-wait">${mode === 'check' ? 'Stockfish vérifie la prochaine position…' : 'Je prépare la prochaine position…'}</p>`;
    const item = await slot.job;
    if (!alive || S !== ses) return;
    if (!item) {
      // pas de message flottant ici : il couvrirait les boutons « Sûr » / « Gaffe » ; le bilan le dira
      ses.skipped++;
      return show(ses, k + 1);
    }
    prep(ses, k + 1); // la suivante se prépare pendant que tu réfléchis
    ses.shown++;
    hud(ses);
    stopItem = mode === 'check' ? showCheck(ses, item) : showPunish(ses, item);
  }

  /** Une seule réponse par position : enregistrée tout de suite (même si tu quittes pendant l'animation). */
  function record(ses, item, ok, cats, answer = null) {
    if (ses.results.some((r) => r.item === item)) return;
    ses.results.push({ item, ok, cats, answer });
    B.recordResult(item, ok, cats);
    hud(ses);
  }

  const nextLabel = (ses) => (ses.k >= ses.specs.length - 1 ? 'Voir le bilan →' : 'Position suivante →');
  const reviewBadge = (item) => (item.review ? '<span class="badge bl-rev">à revoir</span> ' : '');

  // ── « Sûr ou gaffe ? » ──
  function showCheck(ses, item) {
    const me = item.fen.split(' ')[1];
    const them = me === 'w' ? 'b' : 'w';
    const san = B.sanOf(item.fen, item.move);
    const pun = item.after?.pv?.[0];
    const missedPunish = `✗ <b>${esc(san)}</b> est bien une gaffe, mais la punition t’a échappé.`;
    stage.innerHTML = `
      <p class="bl-src small">${reviewBadge(item)}<span class="muted">${esc(nb(item.label))}</span></p>
      <div class="puzzle-prompt bl-prompt"><span class="dot ${me}"></span><span class="bl-q"></span></div>
      <div class="board-row cg-wrap"><div class="board-box"></div></div>
      <div class="bl-legend" hidden></div>
      <div class="feedback" aria-live="polite"></div>
      <div class="bl-answer">
        <button class="btn bl-safe" data-a="sur">✓ Sûr</button>
        <button class="btn bl-gaffe" data-a="gaffe">⚠ Gaffe</button>
      </div>
      <div class="actions" data-zone="find" hidden><button class="btn" data-a="show">👁 Montre la punition</button></div>
      <div class="actions bl-next" data-zone="next" hidden><button class="btn primary" data-a="next">${nextLabel(ses)}</button></div>
      <div class="coach bl-coach" hidden></div>`;
    const $ = (s) => stage.querySelector(s);
    const fb = $('.feedback');
    let phase = 'ask'; // ask → find (trouver la punition) → show (animation) → done
    let here = true;
    let busy = false;
    let tries = 0;
    let findFen = null;
    let refJob = null;
    const live = () => here && alive && S === ses;
    const board = createBoard($('.board-box'), { orientation: cgColor(me), onMove });
    const startPos = () => new Chess(item.fen);
    const atStart = () => board.setPosition(startPos(), { interactive: null, lastMove: item.last || undefined });
    const say = (html, cls = '') => {
      fb.className = 'feedback ' + cls;
      fb.innerHTML = nb(html);
    };
    const ask = (html, color = me) => {
      $('.bl-q').innerHTML = nb(html);
      $('.bl-prompt .dot').className = `dot ${color}`;
    };
    const zone = (name) => {
      $('.bl-answer').hidden = name !== 'ask';
      $('[data-zone=find]').hidden = name !== 'find';
      $('[data-zone=next]').hidden = name !== 'next';
    };
    /**
     * Réponse donnée : le verdict prend la place de la question, et l'échiquier rétrécit pour que « Position suivante »
     * et le début de l'explication tiennent juste dessous sur l'écran du téléphone (780 px), sans défiler.
     */
    const verdict = (html, ok) => {
      phase = 'done';
      ask(html);
      $('.bl-prompt').classList.add(ok ? 'ok' : 'ko');
      fb.hidden = true;
      stage.classList.add('bl-done');
      zone('next');
      window.scrollTo(0, 0);
    };
    const legend = (keys) => {
      const el = $('.bl-legend');
      el.hidden = false;
      el.innerHTML = keys.filter(Boolean).map(([k, t]) => `<span><i class="bl-key ${k}"></i>${esc(t)}</span>`).join('');
    };
    const coach = (title, paragraphs) => {
      const el = $('.bl-coach');
      el.hidden = false;
      el.innerHTML = `<div class="coach-title">${esc(title)}</div>${md(nb(paragraphs.join('\n')))}`;
    };

    atStart();
    board.setShapes([arrow(item.move, 'blue')]);
    ask(`Tu t’apprêtes à jouer <b>${esc(san)}</b> (flèche bleue). Sûr ou gaffe ?`);
    zone('ask');

    function answer(a) {
      if (phase !== 'ask') return;
      if (item.verdict === 'gaffe' && a === 'gaffe') return startFind();
      if (item.verdict === 'gaffe') {
        record(ses, item, false, item.cats, a);
        return revealGaffe('✗ Attention : c’est une gaffe ! Regarde la punition.', 'ko', false, `✗ Non : <b>${esc(san)}</b> est une gaffe.`);
      }
      const ok = a === 'sur';
      record(ses, item, ok, ok ? [] : ['fausse-alerte'], a);
      showSafe(ok);
    }

    function showSafe(ok) {
      const { paragraphs, guards } = B.explainSafe(item);
      board.setShapes([arrow(item.move, 'blue'), ...guards.map((s) => ({ orig: s, brush: 'green' }))]);
      legend([['blue', 'ton coup'], guards.length && ['ring', 'tes défenseurs']]);
      coach('Pourquoi ce coup tient', ok ? paragraphs : [...paragraphs, `*${B.LESSONS_BY_CAT['fausse-alerte'][1]}*`]);
      verdict(ok ? `✓ Exact : <b>${esc(san)}</b> est un coup sûr.` : `✗ Non : <b>${esc(san)}</b> est un coup sûr.`, ok);
    }

    /** Étape 2 : tu as dit « gaffe », prouve-le en jouant le coup de ton adversaire qui la punit. */
    function startFind() {
      phase = 'find';
      const pos = startPos();
      const m = playUci(pos, item.move);
      sound(!!m?.captured);
      findFen = pos.fen();
      board.setShapes([]);
      board.setPosition(pos, { interactive: them, lastMove: item.move });
      ask(`Bien vu ! Prouve-le : joue le coup de ton adversaire qui punit <b>${esc(san)}</b>.`, them);
      say('<span class="muted">Mets-toi à sa place : ses échecs, ses prises, ses menaces.</span>');
      zone('find');
      refJob = evalOf(findFen); // préparé pendant que tu cherches
      refJob.catch(() => {});
    }

    async function evalOf(fen) {
      return cpWhite(await search(CHECK_DEPTH)(fen));
    }

    /** Un autre coup que la punition prévue punit-il aussi bien ? (Stockfish ; sans lui, une prise au moins aussi grosse.) */
    async function punishesToo(pos, m) {
      const sign = them === 'w' ? 1 : -1;
      try {
        const ref = (await refJob) * sign;
        const mine = pos.isCheckmate() ? 100000 : pos.isGameOver() ? 0 : (await evalOf(pos.fen())) * sign;
        return mine >= ref - 80 || (ref >= 600 && mine >= 600);
      } catch {
        const exp = playUci(new Chess(findFen), pun);
        return !!(exp?.captured && m.captured && VALUE[m.captured] >= VALUE[exp.captured]);
      }
    }

    async function onMove(uci) {
      if (phase !== 'find' || busy) return board.sync();
      const pos = new Chess(findFen);
      const m = playUci(pos, uci);
      if (!m) return board.sync();
      sound(!!m.captured);
      board.setPosition(pos, { interactive: null, lastMove: uciOf(m) });
      const exact = uciOf(m) === pun;
      const pat = pos.isStalemate(); // un pat n'est jamais une punition : la partie serait nulle
      let good = exact || pos.isCheckmate();
      if (!good && !pat) {
        busy = true;
        say('<span class="muted">Stockfish vérifie ton coup…</span>');
        good = await punishesToo(pos, m);
        busy = false;
        if (!live()) return;
      }
      if (good) {
        record(ses, item, true, [], 'gaffe');
        return revealGaffe(`✓ Bravo : ${fig(m.san)} punit ${exact ? 'la gaffe' : 'aussi la gaffe'} !`, 'ok', true, `✓ Bien vu : <b>${esc(san)}</b> est une gaffe, et ${fig(m.san)} la punit.`);
      }
      tries++;
      const why = pat ? 'fait pat : la partie serait nulle' : 'ne punit pas assez';
      if (tries >= 2) {
        record(ses, item, false, ['punition', ...item.cats], 'gaffe');
        return revealGaffe(`✗ ${fig(m.san)} ${why}. Voici la punition :`, 'ko', false, missedPunish);
      }
      say(`${fig(m.san)} ${why}. Encore un essai : ses échecs, puis ses prises, puis ses menaces.`, 'ko');
      await sleep(900);
      if (!live() || phase !== 'find') return;
      board.setPosition(new Chess(findFen), { interactive: them, lastMove: item.move });
    }

    /**
     * Montre la punition (ton coup puis sa réponse), puis le récapitulatif : rouge = ton coup, orange = punition,
     * vert = bon coup. headline : message pendant l'animation ; final : verdict affiché ensuite à la place de la question.
     */
    async function revealGaffe(headline, cls, found, final) {
      phase = 'show';
      zone(null);
      say(headline, cls);
      if (!found) {
        const pos = startPos();
        playUci(pos, item.move);
        board.setPosition(pos, { interactive: null, lastMove: item.move });
        board.setShapes([arrow(pun, 'yellow')]);
        await sleep(1000);
        if (!live()) return;
        const m = playUci(pos, pun);
        sound(!!m?.captured);
        board.setPosition(pos, { interactive: null, lastMove: pun });
        board.setShapes([]);
      }
      await sleep(1100);
      if (!live()) return;
      atStart();
      const best = item.before?.pv?.[0];
      const showBest = best && best !== item.move;
      board.setShapes([...(showBest ? [arrow(best, 'green')] : []), arrow(item.move, 'red'), arrow(pun, 'yellow')]);
      legend([['red', 'ton coup'], ['orange', 'la punition'], showBest && ['green', 'le bon coup']]);
      coach('Pourquoi c’est une gaffe', B.explainGaffe(item));
      verdict(final, cls === 'ok');
    }

    stage.querySelector('.bl-answer').addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a) answer(a);
    });
    $('[data-a=show]').addEventListener('click', () => {
      if (phase !== 'find' || busy) return;
      record(ses, item, false, ['punition', ...item.cats], 'gaffe');
      revealGaffe('Voici la punition :', 'ko', false, missedPunish);
    });
    $('[data-a=next]').addEventListener('click', () => show(ses, ses.k + 1));
    return () => {
      here = false;
      board.destroy();
    };
  }

  // ── « Punis la gaffe » ──
  function showPunish(ses, item) {
    const missed = item.src === 'game' && !item.found && item.playedSan ? ` · dans ta partie, tu avais joué ${fig(item.playedSan)}` : '';
    stage.innerHTML = `
      <p class="bl-src small">${reviewBadge(item)}<span class="muted">${esc(nb(item.label + missed))}</span></p>
      <p class="muted small bl-cct-label">${esc(nb('Avant de jouer, passe en revue pour toi :'))}</p>
      <div class="bl-cct">${QUESTIONS.map(([q], i) => `<button class="bl-chip" data-q="${i}">${nb(q)}</button>`).join('')}</div>
      <div class="bl-puzzle"></div>`;
    // rappel actif : tu coches chaque question une fois regardée (rien ne bloque l'échiquier)
    stage.querySelector('.bl-cct').addEventListener('click', (e) => e.target.closest('.bl-chip')?.classList.toggle('on'));
    const runner = runPuzzle(stage.querySelector('.bl-puzzle'), {
      fen: item.fen,
      solution: item.solution,
      allowOthers: true,
      prompt: nb(item.oppSan ? `Ton adversaire vient de jouer **${fig(item.oppSan)}**. Punis-le !` : 'Ton adversaire vient de laisser une pièce mal protégée. Punis-le !'),
      hint: B.punishHint(item),
      success: nb(B.punishSuccess(item)),
      nextLabel: nextLabel(ses),
      onResult: (ok, first) => {
        record(ses, item, ok && first, ok && first ? [] : item.cats);
        // la question de la routine qui trouvait le coup
        const kind = B.cctOf(item.fen, item.solution[0]);
        const q = /échec/.test(kind) && !/prise/.test(kind) ? 0 : /prise/.test(kind) ? 1 : 2;
        stage.querySelector(`.bl-chip[data-q="${q}"]`)?.classList.add('answer');
        reveal(stage.querySelector('.bl-puzzle [data-a=next]'));
      },
      onNext: () => show(ses, ses.k + 1),
    });
    // promotion : la fenêtre de choix (board.js) est posée à côté de l'échiquier ; ses pièces n'ont leur dessin
    // que dans un conteneur .cg-wrap (comme dans vision.js)
    stage.querySelector('.bl-puzzle .board-row')?.classList.add('cg-wrap');
    return () => runner.destroy();
  }

  // ── Bilan ──
  function finish(ses) {
    hud(ses, true);
    const R = ses.results;
    const n = R.length;
    const ok = R.filter((r) => r.ok).length;
    const actions = `<div class="actions bl-end-actions"><button class="btn primary" data-a="again">Encore 10</button><a class="btn" href="#/gaffe">Menu anti-gaffe</a></div>`;
    if (!n) {
      hudEl.hidden = true;
      stage.innerHTML = `<section class="card"><p>${esc(nb('Aucune position n’a pu être préparée : Stockfish ne répond pas sur cet appareil. Analyse quelques parties (onglet Progrès) pour t’entraîner sur les tiennes, puis réessaie.'))}</p>${actions}</section>`;
    } else {
      const take = B.takeaways(R);
      const missed = R.filter((r) => !r.ok);
      stage.innerHTML = `
        <section class="card bl-end">
          <div class="muted">Séance terminée</div>
          <div class="bl-final">${ok}<small> / ${n}</small></div>
          <p class="bl-cheer">${esc(nb(cheer(ok, n)))}</p>
          ${ses.skipped ? `<p class="muted small">${esc(nb(`Stockfish n’a pas pu préparer ${plural(ses.skipped, 'position')} : la séance a été un peu plus courte.`))}</p>` : ''}
          <div class="bl-end-stats">${endStats(R)}</div>
          <h2>Ce qu’il faut retenir</h2>
          ${take.length
            ? take.map((t) => `<div class="bl-take"><b>${esc(t.title)}</b> <span class="muted small">(${plural(t.n, 'position')})</span><p>${esc(nb(t.tip))}</p></div>`).join('')
            : `<p>${esc(nb('Aucune gaffe ne t’a échappé. Garde ce réflexe dans tes parties : avant chaque coup, échecs, prises, menaces.'))}</p>`}
          ${missed.length ? `<h2>À revoir demain</h2><div class="bl-missed">${missed.map(missedLine).join('')}</div><p class="muted small">${esc(nb('Les positions ratées reviennent les jours suivants (répétition espacée), jusqu’à ce que tu les réussisses.'))}</p>` : ''}
          ${actions}
        </section>`;
    }
    stage.querySelector('[data-a=again]').addEventListener('click', start);
    window.scrollTo(0, 0);
  }

  /** Détail du score : gaffes repérées, punitions trouvées, coups sûrs reconnus (ou exercices trouvés du premier coup). */
  function endStats(R) {
    const stat = (v, t) => `<div><b>${v}</b><small class="muted">${esc(t)}</small></div>`;
    if (mode === 'punish') return stat(`${R.filter((r) => r.ok).length} / ${R.length}`, 'trouvées du premier coup');
    const G = R.filter((r) => r.item.verdict === 'gaffe');
    const seen = G.filter((r) => r.answer === 'gaffe');
    const safe = R.filter((r) => r.item.verdict === 'sur');
    return [
      G.length && stat(`${seen.length} / ${G.length}`, 'gaffes repérées'),
      seen.length && stat(`${G.filter((r) => r.ok).length} / ${seen.length}`, 'punitions trouvées'),
      safe.length && stat(`${safe.filter((r) => r.ok).length} / ${safe.length}`, 'coups sûrs reconnus'),
    ].filter(Boolean).join('');
  }

  function missedLine(r) {
    const it = r.item;
    const move = it.mode === 'check' ? B.sanOf(it.fen, it.move) : B.sanOf(it.fen, it.solution[0]);
    const why = it.mode === 'punish'
      ? 'punition pas trouvée'
      : it.verdict === 'sur'
        ? 'coup sûr pris pour une gaffe'
        : r.answer === 'gaffe'
          ? 'gaffe vue, punition pas trouvée'
          : 'gaffe pas vue';
    return `<div class="line-item"><span><b>${esc(move)}</b> <small class="muted">${esc(nb(it.label))}</small></span><small class="bl-why">${esc(why)}</small></div>`;
  }

  start();
  return () => {
    alive = false;
    ac.abort();
    stopItem?.();
  };
}

function cheer(ok, n) {
  if (ok === n) return 'Parfait : aucune position ne t’a piégé. Garde ce réflexe dans tes parties, à chaque coup.';
  if (ok >= 0.8 * n) return 'Très bien ! Ton contrôle anti-gaffe devient un réflexe.';
  if (ok >= 0.5 * n) return 'Bon travail : chaque gaffe repérée ici, c’est une gaffe de moins dans tes parties.';
  return 'C’est en s’entraînant que le réflexe vient : les positions ratées reviendront demain, et tu les reconnaîtras.';
}

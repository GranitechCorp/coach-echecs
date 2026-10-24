// Partie contre l'ordinateur : indices, « pourquoi ? », coach en direct (qui fait chercher avant d'expliquer),
// reprise de coup.
import { Chess } from 'chess.js';
import { db, update, uid, today, trimGames } from '../storage.js';
import { setTitle, toast, esc, md, evalBarHtml, setEvalBar, moveListHtml, classBadge, confirmDialog, moveSound, sleep } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { getBotEngine, getAnalysisEngine } from '../engine.js';
import { chooseBotMove, levelFor } from '../bot.js';
import { playUci, uciOf, cgColor, cpWhite, START_FEN, gameOverText, colorName, fig, uciToSan } from '../chessutil.js';
import { classifyMove, explainBestFor, explainMistakeFor, describeMove, adviceFor, CLASSES, evalLabelFor, mistakeKind, MISTAKE_ALERTS, threatSentence } from '../explain.js';
import { promptBestMove, promptPlayedMove } from '../prompts.js';
import { showCoach } from './coach-panel.js';

export const tab = 'play';

/** Crée une nouvelle partie et ouvre l'écran de jeu. */
export function startGame({ startFen = START_FEN, prefix = '', userColor = 'w', elo = 1000, liveCoach = true, showEval = false, label = '' }) {
  const moves = [];
  if (prefix) {
    const c = new Chess(startFen);
    for (const san of prefix.split(/\s+/).filter(Boolean)) moves.push(uciOf(c.move(san)));
  }
  update((s) => {
    s.currentGame = { id: uid(), startFen, moves, userColor, elo, liveCoach, showEval, hints: 0, takebacks: 0, rescued: [], over: false, label, created: new Date().toISOString() };
  });
  getBotEngine().newGame();
  location.hash = '#/game';
}

export function render(root) {
  const g = db().currentGame;
  if (!g) {
    location.hash = '#/play';
    return;
  }
  setTitle(`Contre l’ordinateur ${g.elo}`, '#/play');
  const lvl = levelFor(g.elo);
  root.innerHTML = `
    <div class="players">
      <div class="player top"><span class="dot ${g.userColor === 'w' ? 'b' : 'w'}"></span>Ordinateur ${g.elo} <small class="muted">${esc(lvl.label)}</small><span class="thinking" hidden>réfléchit…</span></div>
    </div>
    <div class="board-row">${evalBarHtml()}<div class="board-box" id="board"></div></div>
    <div class="players"><div class="player"><span class="dot ${g.userColor}"></span>Toi</div></div>
    <div class="status" id="status"></div>
    <div class="actions">
      <button class="btn" id="hint">💡 Indice</button>
      <button class="btn" id="why">🤔 Pourquoi</button>
      <button class="btn" id="undo">↶ Reprendre</button>
      <button class="btn" id="more">⋯</button>
    </div>
    <div class="menu" id="menu" hidden>
      <button class="btn ghost" id="flip">⇅ Retourner l’échiquier</button>
      <button class="btn ghost" id="toggle-eval">📊 Barre d’évaluation</button>
      <button class="btn ghost" id="resign">🏳 Abandonner</button>
      <button class="btn ghost" id="new">✚ Nouvelle partie</button>
    </div>
    <div class="coach" id="coach" hidden></div>
    <div class="moves card" id="moves"></div>`;

  const statusEl = root.querySelector('#status');
  const actionsEl = root.querySelector('.actions');
  const menuEl = root.querySelector('#menu');
  const coachEl = root.querySelector('#coach');
  const movesEl = root.querySelector('#moves');
  const thinkingEl = root.querySelector('.thinking');
  const evalBar = root.querySelector('.evalbar');
  evalBar.hidden = !g.showEval;

  const chess = new Chess(g.startFen);
  for (const u of g.moves) playUci(chess, u);
  const board = createBoard(root.querySelector('#board'), { orientation: cgColor(g.userColor), onMove: onUserMove });
  const analysis = getAnalysisEngine();
  const bot = getBotEngine();
  let alive = true;
  let busy = false; // l'ordinateur joue
  let pendingDecision = false; // coach en direct : on attend « reprendre / continuer »
  let pendingAlert = null; // erreur signalée par le coach : { fenBefore, uci, before, after, cls }
  let posAnalysis = null; // { fen, promise, lines }
  let hintLevel = 0;
  let classes = g.classes || []; // classification des coups de l'utilisateur, par index de coup
  g.rescued ||= []; // gaffes rattrapées : coups repris après l'alerte du coach (« position|coup »)

  function save() {
    update((s) => {
      s.currentGame = { ...g, moves: g.moves, classes };
    });
  }

  function analyse(fen) {
    if (posAnalysis?.fen === fen) return posAnalysis.promise;
    const entry = { fen, lines: null };
    entry.promise = analysis.search(fen, { depth: 13, multipv: 3 }).then((r) => {
      entry.lines = r.lines;
      if (alive && fen === chess.fen()) setEvalBar(root, r.lines[0], board.orientation);
      return r.lines;
    });
    posAnalysis = entry;
    return entry.promise;
  }

  function renderMoves() {
    const hist = chess.history({ verbose: true });
    const start = new Chess(g.startFen);
    movesEl.innerHTML = hist.length
      ? moveListHtml(hist.map((m, i) => ({ san: m.san, cls: classes[i] })), hist.length - 1, start.moveNumber(), start.turn())
      : '<span class="muted">La partie commence. À toi de jouer !</span>';
    movesEl.scrollLeft = movesEl.scrollWidth;
  }

  function setStatus(html) {
    statusEl.innerHTML = html;
  }

  function refresh() {
    const userTurn = chess.turn() === g.userColor;
    board.setPosition(chess, { interactive: userTurn && !busy && !pendingDecision && !g.over ? g.userColor : null });
    renderMoves();
    if (g.over) return;
    if (chess.isGameOver()) return finish(gameOverText(chess));
    if (userTurn) {
      setStatus(chess.inCheck() ? '<b>Échec !</b> À toi de jouer.' : 'À toi de jouer.');
      analyse(chess.fen());
    } else {
      setStatus('');
    }
  }

  async function botTurn() {
    if (g.over || chess.turn() === g.userColor || chess.isGameOver()) return;
    busy = true;
    thinkingEl.hidden = false;
    refresh();
    const fen = chess.fen();
    const t0 = Date.now();
    const uci = await chooseBotMove(bot, fen, g.elo);
    await sleep(Math.max(0, 500 - (Date.now() - t0))); // un temps de réflexion « humain »
    if (!alive || fen !== chess.fen()) return;
    thinkingEl.hidden = true;
    busy = false;
    const m = uci && playUci(chess, uci);
    if (!m) return refresh();
    g.moves.push(uci);
    save();
    if (db().settings.sound) moveSound(!!m.captured);
    hintLevel = 0;
    refresh();
  }

  async function onUserMove(uci) {
    if (busy || pendingDecision || g.over) return board.sync();
    const fenBefore = chess.fen();
    const m = playUci(chess, uci);
    if (!m) return board.sync();
    const idx = g.moves.length;
    g.moves.push(uciOf(m));
    if (db().settings.sound) moveSound(!!m.captured);
    coachEl.hidden = true;
    hintLevel = 0;
    board.setShapes([]);
    save();
    refresh();
    if (chess.isGameOver()) return;

    // coach en direct : on classe le coup (analyse avant / après)
    if (g.liveCoach) {
      busy = true;
      setStatus('<span class="muted">Le coach regarde ton coup…</span>');
      const before = await analyse(fenBefore);
      const after = (await analysis.search(chess.fen(), { depth: 12, multipv: 1 })).lines;
      if (!alive) return;
      busy = false;
      const res = classifyMove({ cpBefore: cpWhite(before[0]), cpAfter: chess.isCheckmate() ? (g.userColor === 'w' ? 10000 : -10000) : cpWhite(after[0]), color: g.userColor, isBest: before[0]?.pv[0] === uciOf(m) });
      classes[idx] = res.cls;
      save();
      renderMoves();
      setEvalBar(root, after[0], board.orientation);
      if (res.cls === 'mistake' || res.cls === 'blunder') return alertMistake({ fenBefore, uci: uciOf(m), before, after, cls: res.cls });
    }
    botTurn();
  }

  /** Le texte des 3 questions à se poser, vu depuis l'adversaire juste après ton coup (court : tout tient sous l'échiquier). */
  const QUESTIONS = `
    <ol class="lc-questions">
      <li><b>Échecs</b>&nbsp;: lesquels peut-il me donner&nbsp;?</li>
      <li><b>Prises</b>&nbsp;: que peut-il prendre&nbsp;? Est-ce défendu&nbsp;?</li>
      <li><b>Menaces</b>&nbsp;: que menace-t-il au coup suivant&nbsp;?</li>
    </ol>`;

  /** Hauteurs de la barre du haut (collante) et de la barre d'onglets (fixe) : la partie visible de la page est entre les deux. */
  function visibleBand() {
    const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const tab = document.querySelector('.tabbar');
    const bottom = tab && !tab.hidden ? tab.getBoundingClientRect().top : innerHeight;
    return { top: Math.max(0, top), bottom: Math.min(innerHeight, bottom) };
  }

  /**
   * Fait défiler doucement la page pour que `el` soit entièrement visible (sans le cacher sous les barres).
   * keepBoard : ne cache jamais le haut de l'échiquier (quitte à couper le bas de `el`).
   */
  function reveal(el, { keepBoard = false } = {}) {
    if (!el || !alive) return;
    const band = visibleBand();
    const r = el.getBoundingClientRect();
    let dy = 0;
    if (r.bottom > band.bottom - 8) dy = r.bottom - (band.bottom - 8);
    if (r.top - dy < band.top + 8) dy = r.top - (band.top + 8); // le haut d'abord
    // keepBoard : l'échiquier entier passe avant le bas de `el` (on remonte même un peu s'il était coupé)
    if (keepBoard) dy = Math.min(dy, root.querySelector('#board').getBoundingClientRect().top - band.top);
    if (Math.abs(dy) >= 2) window.scrollTo({ top: window.scrollY + dy, behavior: 'smooth' });
  }

  /** Remet l'échiquier entier à l'écran s'il est en partie caché sous la barre du haut. */
  function revealBoard() {
    const band = visibleBand();
    const r = root.querySelector('#board').getBoundingClientRect();
    if (r.top < band.top) window.scrollTo({ top: Math.max(0, window.scrollY + r.top - band.top - 4), behavior: 'smooth' });
  }

  /** Pendant l'alerte, ses boutons remplacent la barre d'actions et la ligne d'état : l'alerte tient sous l'échiquier. */
  function setDeciding(on) {
    statusEl.hidden = on;
    actionsEl.hidden = on;
    if (on) menuEl.hidden = true;
  }

  /**
   * Coach en direct : on prévient sans révéler (ni case ni coup) et on fait chercher d'abord.
   * Ensuite le joueur choisit : reprendre et chercher, voir la menace, voir l'explication, ou continuer.
   */
  function alertMistake(alert) {
    const { fenBefore, uci, before, after, cls } = alert;
    pendingDecision = true;
    pendingAlert = alert;
    board.setInteractive(null);
    board.setShapes([arrow(uci, 'red')]);
    const kind = mistakeKind(fenBefore, uci, before, after);
    const title = MISTAKE_ALERTS[kind] || (cls === 'blunder' ? 'Attention, ce coup est une gaffe' : 'Ce coup est une erreur');
    setStatus(`${classBadge(cls)} <span class="muted">Cherche mieux avant de continuer.</span>`);
    setDeciding(true);
    coachEl.hidden = false;
    coachEl.innerHTML = `
      <div class="lc-alert">
        <div class="coach-title"><span>⚠ ${esc(title)}</span>${MISTAKE_ALERTS[kind] ? classBadge(cls) : ''}</div>
        <p class="lc-threat" hidden></p>
        <p class="lc-lead">${kind === 'avantage' ? 'Tu avais mieux&nbsp;! Avant de rejouer, mets-toi à sa place&nbsp;:' : 'Reprends ton coup et cherche mieux. À sa place, après ton coup&nbsp;:'}</p>
        ${QUESTIONS}
        <div class="lc-actions">
          <button class="btn primary block" data-dec="undo">↶ Reprendre et chercher mieux</button>
          <div class="lc-row">
            <button class="btn small" data-dec="threat">💡 Montre la menace</button>
            <button class="btn small" data-dec="show">Voir l’explication</button>
            <button class="btn ghost small" data-dec="go">Continuer quand même</button>
          </div>
        </div>
      </div>`;
    coachEl.querySelector('[data-dec=undo]').onclick = rescue;
    coachEl.querySelector('[data-dec=go]').onclick = proceed;
    coachEl.querySelector('[data-dec=threat]').onclick = (e) => {
      const reply = after[0];
      const txt = coachEl.querySelector('.lc-threat');
      e.currentTarget.remove();
      if (!reply?.pv?.[0]) return;
      board.setShapes([arrow(uci, 'red'), arrow(reply.pv[0], 'yellow')]); // « yellow » de Chessground = orange
      txt.textContent = threatSentence(chess.fen(), reply, g.userColor, kind);
      txt.hidden = false;
      coachEl.querySelector('.lc-lead').hidden = true; // la phrase de la menace prend sa place
      // l'échiquier entier (avec la flèche) et la phrase, juste dessous, à l'écran ensemble
      reveal(coachEl, { keepBoard: true });
    };
    coachEl.querySelector('[data-dec=show]').onclick = () => showMistake(alert);
    // l'alerte arrive sous l'échiquier : on la fait monter doucement pour qu'elle soit lue tout de suite
    reveal(coachEl);
  }

  /** L'explication complète (flèches comprises) : le coup joué, la réponse qui punit et le meilleur coup. */
  function showMistake({ fenBefore, uci, before, after, cls }) {
    const tags = describeMove(chess.fen(), after[0]?.pv[0] || '').tags;
    showCoach(coachEl, {
      title: `${classBadge(cls)}`,
      paragraphs: [...explainMistakeFor(g.userColor, fenBefore, uci, before, after), `*${adviceFor(tags)}*`],
      getPrompt: () => promptPlayedMove({ fen: fenBefore, playedUci: uci, linesBefore: before, linesAfter: after, userColor: g.userColor, history: chess.history().slice(0, -1), cls: CLASSES[cls].label }),
    });
    const row = document.createElement('div');
    row.className = 'row wrap';
    row.innerHTML = '<button class="btn primary small" data-dec="undo">↶ Reprendre mon coup</button><button class="btn ghost small" data-dec="go">Continuer quand même</button>';
    coachEl.prepend(row);
    row.querySelector('[data-dec=undo]').onclick = rescue;
    row.querySelector('[data-dec=go]').onclick = proceed;
    board.setShapes([arrow(uci, 'red'), ...(before[0] ? [arrow(before[0].pv[0], 'green')] : []), ...(after[0] ? [arrow(after[0].pv[0], 'blue')] : [])]);
  }

  /** Coup repris après l'alerte du coach : une gaffe rattrapée (comptée une fois par position et par coup). */
  function rescue() {
    const key = pendingAlert && `${pendingAlert.fenBefore}|${pendingAlert.uci}`;
    if (key && !g.rescued.includes(key)) g.rescued.push(key);
    pendingDecision = false;
    pendingAlert = null;
    setDeciding(false);
    takeBack();
    if (!busy) setStatus('↶ Coup repris. À toi de trouver mieux : échecs, prises, menaces !');
    revealBoard();
  }

  function proceed() {
    pendingDecision = false;
    pendingAlert = null;
    setDeciding(false);
    coachEl.hidden = true;
    board.setShapes([]);
    revealBoard();
    botTurn();
  }

  /** Bilan du coach en direct pour l'écran de fin. */
  function rescuedHtml() {
    const n = (g.rescued || []).length;
    if (!n) return '';
    return `<p class="lc-rescued">🛟 Gaffes rattrapées grâce au coach : <b>${n}</b>. En vraie partie, personne ne te préviendra : prends l’habitude de te poser les 3 questions avant chaque coup.</p>`;
  }

  /** Reprend le dernier coup de l'utilisateur (et la réponse de l'ordinateur s'il a déjà joué). */
  function takeBack() {
    if (busy) return toast('Attends que l’ordinateur ait joué.');
    const n = chess.turn() === g.userColor ? 2 : 1;
    if (g.moves.length < n) return;
    for (let k = 0; k < n; k++) {
      chess.undo();
      g.moves.pop();
    }
    classes.length = g.moves.length;
    g.takebacks++;
    coachEl.hidden = true;
    board.setShapes([]);
    save();
    refresh();
  }

  async function finish(text, resultOverride) {
    if (g.over) return;
    g.over = true;
    pendingDecision = false;
    pendingAlert = null;
    setDeciding(false);
    board.setInteractive(null);
    let result = resultOverride;
    if (!result) {
      if (chess.isCheckmate()) result = chess.turn() === 'w' ? '0-1' : '1-0';
      else result = '1/2-1/2';
    }
    const userWon = (result === '1-0' && g.userColor === 'w') || (result === '0-1' && g.userColor === 'b');
    const draw = result === '1/2-1/2';
    // enregistrement de la partie
    const pgnGame = new Chess(g.startFen);
    for (const u of g.moves) playUci(pgnGame, u);
    pgnGame.setHeader('Event', 'Coach Échecs');
    pgnGame.setHeader('Date', today().replace(/-/g, '.'));
    pgnGame.setHeader('White', g.userColor === 'w' ? 'Moi' : `Stockfish ${g.elo}`);
    pgnGame.setHeader('Black', g.userColor === 'b' ? 'Moi' : `Stockfish ${g.elo}`);
    pgnGame.setHeader('Result', result);
    if (g.startFen !== START_FEN) {
      pgnGame.setHeader('SetUp', '1');
      pgnGame.setHeader('FEN', g.startFen);
    }
    const record = {
      id: g.id,
      date: new Date().toISOString(),
      pgn: pgnGame.pgn(),
      userColor: g.userColor,
      result,
      botElo: g.elo,
      source: 'bot',
      label: `vs ordinateur ${g.elo} (${g.moves.length > 1 ? Math.ceil(g.moves.length / 2) : 0} coups)`,
      hints: g.hints,
      takebacks: g.takebacks,
      rescued: (g.rescued || []).length,
    };
    update((s) => {
      if (!s.games.find((x) => x.id === g.id)) s.games.push(record);
      trimGames(s, g.id);
      const r = (s.botResults[g.elo] ||= { w: 0, d: 0, l: 0 });
      if (userWon) r.w++;
      else if (draw) r.d++;
      else r.l++;
      s.currentGame = { ...g, over: true };
    });
    setStatus(`<b>${esc(text)}</b>`);
    const verdict = userWon ? '🎉 Bravo, tu as gagné !' : draw ? '🤝 Partie nulle.' : 'Défaite… mais c’est en analysant ses défaites qu’on progresse le plus.';
    coachEl.hidden = false;
    coachEl.innerHTML = `
      <div class="coach-title">${verdict}</div>
      ${g.hints || g.takebacks ? `<p class="muted small">Indices utilisés : ${g.hints} · coups repris : ${g.takebacks}</p>` : ''}
      ${rescuedHtml()}
      <div class="row wrap">
        <a class="btn primary" href="#/review/${g.id}">📋 Bilan de la partie</a>
        <button class="btn" id="again">↻ Revanche</button>
        <a class="btn ghost" href="#/play">Autre niveau</a>
      </div>`;
    coachEl.querySelector('#again').onclick = () =>
      startGame({ userColor: g.userColor === 'w' ? 'b' : 'w', elo: g.elo, liveCoach: g.liveCoach, showEval: g.showEval });
    // le menu (abandon) se referme et le verdict, avec les gaffes rattrapées, monte à l'écran
    menuEl.hidden = true;
    reveal(coachEl);
  }

  // ─── Boutons ───
  root.querySelector('#hint').onclick = async () => {
    if (g.over || chess.turn() !== g.userColor || pendingDecision) return toast('Attends ton tour.');
    const fen = chess.fen();
    setStatus('<span class="muted">Recherche d’un indice…</span>');
    const lines = await analyse(fen);
    if (!alive || fen !== chess.fen() || !lines[0]) return;
    hintLevel++;
    g.hints++;
    save();
    const best = lines[0].pv[0];
    if (hintLevel === 1) {
      board.setShapes([{ orig: best.slice(0, 2), brush: 'green' }]);
      const tags = describeMove(fen, best).tags;
      const theme = tags.has('mat') ? 'Il y a un mat !' : tags.has('fourchette') ? 'Cherche une fourchette.' : tags.has('gain') ? 'Il y a du matériel à gagner.' : tags.has('clouage') ? 'Pense au clouage.' : tags.has('defense') ? 'Une de tes pièces est menacée.' : 'Cette pièce a un bon coup.';
      setStatus(`💡 Regarde la pièce entourée. ${theme} <span class="muted">(appuie encore pour voir le coup)</span>`);
    } else {
      board.setShapes([arrow(best, 'green')]);
      showCoach(coachEl, {
        title: '💡 Le meilleur coup',
        paragraphs: explainBestFor(g.userColor, fen, lines),
        getPrompt: () => promptBestMove({ fen, lines, userColor: g.userColor, history: chess.history() }),
      });
      setStatus('À toi de jouer.');
    }
  };

  root.querySelector('#why').onclick = async () => {
    if (pendingDecision && pendingAlert) return showMistake(pendingAlert); // garde les boutons « reprendre / continuer »
    const hist = chess.history({ verbose: true });
    // dernier coup de l'utilisateur
    let i = hist.length - 1;
    while (i >= 0 && hist[i].color !== g.userColor) i--;
    if (chess.turn() === g.userColor && !g.over) {
      // à toi de jouer : on explique la position (meilleur coup)
      const fen = chess.fen();
      const lines = await analyse(fen);
      if (!alive || !lines[0]) return;
      board.setShapes(lines.slice(0, 2).map((l, k) => arrow(l.pv[0], k === 0 ? 'green' : 'blue')));
      showCoach(coachEl, {
        title: 'Analyse de la position',
        paragraphs: explainBestFor(g.userColor, fen, lines),
        getPrompt: () => promptBestMove({ fen, lines, userColor: g.userColor, history: chess.history() }),
      });
      g.hints++;
      save();
      return;
    }
    if (i < 0) return toast('Joue d’abord un coup !');
    const fenBefore = hist[i].before;
    const played = uciOf(hist[i]);
    coachEl.hidden = false;
    coachEl.innerHTML = '<p class="muted">Analyse de ton coup…</p>';
    const before = (await analysis.search(fenBefore, { depth: 13, multipv: 3 })).lines;
    const after = (await analysis.search(hist[i].after, { depth: 12 })).lines;
    if (!alive) return;
    const res = classifyMove({ cpBefore: cpWhite(before[0]), cpAfter: cpWhite(after[0]), color: g.userColor, isBest: before[0]?.pv[0] === played });
    const paras = ['inaccuracy', 'mistake', 'blunder'].includes(res.cls)
      ? explainMistakeFor(g.userColor, fenBefore, played, before, after)
      : [
          `**${CLASSES[res.cls].label}** : ${fig(hist[i].san)}.`,
          ...describeMove(fenBefore, played).facts.map((f) => '• ' + f),
          ...(before[0] && before[0].pv[0] !== played ? [`Le moteur préférait ${fig(uciToSan(fenBefore, before[0].pv[0]))} (${evalLabelFor(before[0], g.userColor)}), mais ton coup est tout à fait jouable.`] : []),
        ];
    showCoach(coachEl, {
      title: `${classBadge(res.cls)}`,
      paragraphs: paras,
      getPrompt: () => promptPlayedMove({ fen: fenBefore, playedUci: played, linesBefore: before, linesAfter: after, userColor: g.userColor, history: hist.slice(0, i).map((m) => m.san), cls: CLASSES[res.cls].label }),
    });
  };

  root.querySelector('#undo').onclick = () => {
    if (g.over) return toast('La partie est terminée.');
    if (!g.moves.length) return;
    if (pendingDecision) return rescue(); // reprise après l'alerte du coach : gaffe rattrapée
    takeBack();
  };
  root.querySelector('#more').onclick = () => (root.querySelector('#menu').hidden ^= true);
  root.querySelector('#flip').onclick = () => {
    board.flip();
    if (posAnalysis?.lines) setEvalBar(root, posAnalysis.lines[0], board.orientation);
  };
  root.querySelector('#toggle-eval').onclick = () => {
    g.showEval = !g.showEval;
    evalBar.hidden = !g.showEval;
    save();
  };
  root.querySelector('#resign').onclick = async () => {
    if (g.over) return;
    if (await confirmDialog('Abandonner la partie ?', 'Abandonner')) finish(`${colorName(g.userColor)} abandonnent`, g.userColor === 'w' ? '0-1' : '1-0');
  };
  root.querySelector('#new').onclick = () => (location.hash = '#/play');
  movesEl.addEventListener('click', (e) => {
    if (e.target.closest('.mv') && g.over) location.hash = `#/review/${g.id}`;
  });

  refresh();
  if (g.over) {
    setStatus('<b>Partie terminée.</b>');
    coachEl.hidden = false;
    coachEl.innerHTML = `${rescuedHtml()}<div class="row wrap"><a class="btn primary" href="#/review/${g.id}">📋 Bilan de la partie</a><a class="btn" href="#/play">Nouvelle partie</a></div>`;
  } else if (chess.turn() !== g.userColor) botTurn();

  return () => {
    alive = false;
    board.destroy();
  };
}

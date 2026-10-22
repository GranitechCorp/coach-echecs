// Partie contre l'ordinateur : indices, « pourquoi ? », coach en direct, reprise de coup.
import { Chess } from 'chess.js';
import { db, update, uid, today } from '../storage.js';
import { setTitle, toast, esc, md, evalBarHtml, setEvalBar, moveListHtml, classBadge, confirmDialog, moveSound, sleep } from '../ui.js';
import { createBoard, arrow } from '../board.js';
import { getBotEngine, getAnalysisEngine } from '../engine.js';
import { chooseBotMove, levelFor } from '../bot.js';
import { playUci, uciOf, cgColor, cpWhite, START_FEN, gameOverText, colorName, fig, uciToSan, evalText } from '../chessutil.js';
import { classifyMove, explainBest, explainMistake, describeMove, adviceFor, CLASSES } from '../explain.js';
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
    s.currentGame = { id: uid(), startFen, moves, userColor, elo, liveCoach, showEval, hints: 0, takebacks: 0, over: false, label, created: new Date().toISOString() };
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
  let posAnalysis = null; // { fen, promise, lines }
  let hintLevel = 0;
  let classes = g.classes || []; // classification des coups de l'utilisateur, par index de coup

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
      if (res.cls === 'mistake' || res.cls === 'blunder') {
        pendingDecision = true;
        board.setInteractive(null);
        board.setShapes([arrow(uciOf(m), 'red')]);
        const tags = describeMove(chess.fen(), after[0]?.pv[0] || '').tags;
        setStatus(`${classBadge(res.cls)} <span class="muted">Tu peux reprendre ton coup.</span>`);
        showCoach(coachEl, {
          title: res.cls === 'blunder' ? '⚠️ Attention, ce coup est une gaffe' : '⚠️ Ce coup est une erreur',
          paragraphs: [...explainMistake(fenBefore, uciOf(m), before, after).slice(0, 1), `*${adviceFor(tags)}*`, '<<decision>>'],
          getPrompt: () => promptPlayedMove({ fen: fenBefore, playedUci: uciOf(m), linesBefore: before, linesAfter: after, userColor: g.userColor, history: chess.history().slice(0, -1), cls: CLASSES[res.cls].label }),
        });
        // les boutons de décision remplacent le marqueur
        const txt = coachEl.querySelector('.coach-txt');
        txt.innerHTML = txt.innerHTML.replace(
          '<p>&lt;&lt;decision&gt;&gt;</p>',
          `<div class="row wrap"><button class="btn primary small" data-dec="undo">↶ Reprendre mon coup</button><button class="btn small" data-dec="show">Voir pourquoi</button><button class="btn ghost small" data-dec="go">Continuer quand même</button></div>`,
        );
        coachEl.querySelector('[data-dec=undo]').onclick = () => {
          pendingDecision = false;
          takeBack();
        };
        coachEl.querySelector('[data-dec=show]').onclick = (e) => {
          e.target.remove();
          showCoach(coachEl, {
            title: CLASSES[res.cls].label,
            paragraphs: explainMistake(fenBefore, uciOf(m), before, after),
            getPrompt: () => promptPlayedMove({ fen: fenBefore, playedUci: uciOf(m), linesBefore: before, linesAfter: after, userColor: g.userColor, history: chess.history().slice(0, -1), cls: CLASSES[res.cls].label }),
          });
          const row = document.createElement('div');
          row.className = 'row wrap';
          row.innerHTML = '<button class="btn primary small" data-dec="undo">↶ Reprendre mon coup</button><button class="btn ghost small" data-dec="go">Continuer</button>';
          coachEl.prepend(row);
          row.querySelector('[data-dec=undo]').onclick = () => {
            pendingDecision = false;
            takeBack();
          };
          row.querySelector('[data-dec=go]').onclick = proceed;
          board.setShapes([arrow(uciOf(m), 'red'), ...(before[0] ? [arrow(before[0].pv[0], 'green')] : []), ...(after[0] ? [arrow(after[0].pv[0], 'blue')] : [])]);
        };
        coachEl.querySelector('[data-dec=go]').onclick = proceed;
        return;
      }
    }
    botTurn();
  }

  function proceed() {
    pendingDecision = false;
    coachEl.hidden = true;
    board.setShapes([]);
    botTurn();
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
    };
    update((s) => {
      if (!s.games.find((x) => x.id === g.id)) s.games.push(record);
      if (s.games.length > 200) s.games.splice(0, s.games.length - 200);
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
      <div class="row wrap">
        <a class="btn primary" href="#/review/${g.id}">📋 Bilan de la partie</a>
        <button class="btn" id="again">↻ Revanche</button>
        <a class="btn ghost" href="#/play">Autre niveau</a>
      </div>`;
    coachEl.querySelector('#again').onclick = () =>
      startGame({ userColor: g.userColor === 'w' ? 'b' : 'w', elo: g.elo, liveCoach: g.liveCoach, showEval: g.showEval });
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
        paragraphs: explainBest(fen, lines),
        getPrompt: () => promptBestMove({ fen, lines, userColor: g.userColor, history: chess.history() }),
      });
      setStatus('À toi de jouer.');
    }
  };

  root.querySelector('#why').onclick = async () => {
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
        paragraphs: explainBest(fen, lines),
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
      ? explainMistake(fenBefore, played, before, after)
      : [
          `**${CLASSES[res.cls].label}** : ${fig(hist[i].san)}.`,
          ...describeMove(fenBefore, played).facts.map((f) => '• ' + f),
          ...(before[0] && before[0].pv[0] !== played ? [`Le moteur préférait ${fig(uciToSan(fenBefore, before[0].pv[0]))} (${evalText(before[0])}), mais ton coup est tout à fait jouable.`] : []),
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
    pendingDecision = false;
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
    coachEl.innerHTML = `<div class="row wrap"><a class="btn primary" href="#/review/${g.id}">📋 Bilan de la partie</a><a class="btn" href="#/play">Nouvelle partie</a></div>`;
  } else if (chess.turn() !== g.userColor) botTurn();

  return () => {
    alive = false;
    board.destroy();
  };
}

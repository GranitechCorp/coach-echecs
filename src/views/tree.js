// Mon arbre d'ouvertures : tes parties regroupées coup par coup (comme l'arbre de ChessBase ou l'explorateur de
// Lichess), comparées à ton répertoire : où tu en sors, ce que jouent tes adversaires, tes résultats dans chaque suite.
import { Chess } from 'chess.js';
import { db } from '../storage.js';
import { setTitle, esc, md, toast } from '../ui.js';
import { createBoard } from '../board.js';
import { getAnalysisEngine } from '../engine.js';
import { fig, cgColor, playUci, pvToSan, evalText, evalPhrase, uciToSan } from '../chessutil.js';
import { explainBest, describeMove } from '../explain.js';
import { OPENING_LINES, OPENING_GROUPS } from '../data/openings.js';
import { buildTrees, repertoireIndex, deviations, statsOf, nodeAt, turnOf, commonOpening, closestLine, frName, MAX_PLIES } from '../opening-tree.js';

export const tab = 'learn';
const DEPTH = 14;
const LAST_GAMES = 5;

// Les arbres restent en mémoire tant que tes parties ne changent pas : chaque PGN n'est lu qu'une fois.
let cache = null;
// (une partie analysée depuis peut recevoir un nom d'ouverture : elle compte dans la signature)
const signature = (games) => games.length + '|' + games.map((g) => g.id + (g.review ? '+' : '')).join(',');

/** « 4.♘f3 » ou « 4…♘f6 » : le coup numéro `ply` (0 = premier coup des Blancs). */
const numLabel = (ply, san) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'}${fig(san)}`;
/** « 1.d4 d5 2.c4 » */
const pathText = (sans) => sans.map((san, i) => (i % 2 ? fig(san) : `${i / 2 + 1}.${fig(san)}`)).join(' ');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

const lineById = (id) => OPENING_LINES.find((l) => l.id === id);

/** Nom du répertoire à cet endroit : la ligne si une seule y passe, le groupe si toutes en font partie. */
function repName(entry) {
  if (!entry?.lines.length) return '';
  if (entry.lines.length === 1) return `Ta ligne : ${lineById(entry.lines[0])?.name || ''}`;
  const groups = new Set(entry.lines.map((id) => lineById(id)?.group));
  if (groups.size !== 1) return '';
  return `Ton répertoire : ${OPENING_GROUPS.find((g) => g.id === [...groups][0])?.name || ''}`;
}

/** Résultat lisible d'une partie (les parties contre l'ordinateur gardent « 1-0 » dans leur fiche). */
function resultFr(g, score) {
  if (/^(Victoire|Défaite|Nulle|Pat)/.test(g.result || '')) return g.result;
  return score === 1 ? 'Victoire' : score === 0 ? 'Défaite' : score === 0.5 ? 'Nulle' : 'Résultat inconnu';
}

function dateFr(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function emptyHtml() {
  return `<section class="card">
    <h2>🌳 Ton arbre est encore vide</h2>
    <p>Ici, toutes tes parties sont rangées coup par coup : tu vois où tu sors de ton répertoire, ce que jouent tes adversaires et tes résultats dans chaque variante.</p>
    <p>Pour le remplir, récupère tes parties chess.com :</p>
    <ul>
      <li>dans <b>Progrès</b>, avec ton pseudo chess.com : la synchronisation est automatique ;</li>
      <li>ou dans <b>Mes parties</b> : chargement depuis chess.com ou Lichess, ou import d’un fichier PGN.</li>
    </ul>
    <div class="row wrap"><a class="btn primary" href="#/profile">📈 Synchroniser chess.com</a><a class="btn" href="#/analysis">📂 Mes parties</a></div>
    <p class="muted small">Tes parties contre l’ordinateur s’y ajoutent aussi.</p>
  </section>`;
}

export function render(root, sideParam) {
  const side = sideParam === 'b' ? 'b' : 'w';
  setTitle('Mon arbre d’ouvertures', '#/learn');
  const games = db().games.filter((g) => g.pgn);
  if (!games.length) {
    root.innerHTML = emptyHtml();
    return null;
  }
  const sig = signature(games);
  if (cache?.sig === sig) return mount(root, side, cache.trees);
  // premier calcul : on affiche d'abord un message, puis on range les parties (quelques dixièmes de seconde)
  root.innerHTML = '<section class="card"><p class="muted">Je range tes parties coup par coup…</p></section>';
  let alive = true;
  let stop = null;
  const timer = setTimeout(() => {
    if (!alive) return;
    cache = { sig, trees: buildTrees(games) };
    stop = mount(root, side, cache.trees);
  }, 30);
  return () => {
    alive = false;
    clearTimeout(timer);
    stop?.();
  };
}

function mount(root, side, trees) {
  const s = db();
  const tree = trees[side];
  const other = side === 'w' ? 'b' : 'w';
  const sideName = (c) => (c === 'w' ? 'les Blancs' : 'les Noirs');
  const seg = `<div class="seg tree-side">${['w', 'b'].map((c) => `<a href="#/tree/${c}" class="${c === side ? 'on' : ''}">${c === 'w' ? '⚪' : '⚫'} Avec ${sideName(c)} <small>(${trees[c].games.length})</small></a>`).join('')}</div>`;
  if (!tree.games.length) {
    root.innerHTML = `${seg}<section class="card"><p>Aucune partie avec ${sideName(side)} pour l’instant.</p>
      ${trees[other].games.length ? `<a class="btn" href="#/tree/${other}">Voir mon arbre avec ${sideName(other)}</a>` : ''}
      <p class="muted small">Récupère tes parties chess.com dans <a href="#/profile"><u>Progrès</u></a> ou dans <a href="#/analysis"><u>Mes parties</u></a>.</p></section>`;
    return null;
  }
  const rep = repertoireIndex(side, s.openings);
  const devs = deviations(tree, rep).slice(0, 5);
  const byId = new Map(s.games.map((g) => [g.id, g]));
  const engine = getAnalysisEngine();
  const evals = new Map(); // clé de position → lignes de Stockfish (pour ne pas recalculer en revenant)
  let engineOn = false;
  let ctrl = null;
  let alive = true;

  // Premier écran (780 px de haut) : l'échiquier et la liste des coups. Le résumé tient sur une ligne qu'on déplie ;
  // le nom de l'ouverture, le chemin des coups et les boutons Début / Retour sont sous l'échiquier, juste au-dessus
  // de la liste (l'échiquier ne bouge pas quand on avance).
  root.innerHTML = `${seg}
    ${summaryHtml(devs, tree)}
    <div class="board-row tree-board"><div class="board-box" id="t-board"></div></div>
    <div class="tree-name" id="t-name"></div>
    <div class="tree-bar"><div class="tree-path" id="t-path"></div><div class="tree-btns"><button class="btn small" id="t-start">⏮ Début</button><button class="btn small" id="t-back">◀ Retour</button></div></div>
    <section class="card" id="t-moves"></section>
    <section class="card" id="t-eval"></section>
    <section class="card" id="t-games"></section>`;
  const $ = (sel) => root.querySelector(sel);
  const board = createBoard($('#t-board'), { orientation: cgColor(side), onMove });
  // le résumé reste ouvert (ou fermé) pendant la visite
  $('#t-sum')?.addEventListener('toggle', (e) => {
    try {
      sessionStorage.setItem('tree-sum-open', e.target.open ? '1' : '');
    } catch {
      /* rien */
    }
  });

  // ── position courante : chemin de coups (UCI) depuis le départ, gardé pendant la visite ──
  const storeKey = 'tree-path-' + side;
  let path = [];
  try {
    path = JSON.parse(sessionStorage.getItem(storeKey) || '[]');
  } catch {
    path = [];
  }
  if (!Array.isArray(path) || !nodeAt(tree, path)) path = [];
  let cur = null; // { node, sans, chess }

  function go(p) {
    path = p;
    try {
      sessionStorage.setItem(storeKey, JSON.stringify(path));
    } catch {
      /* navigation privée : tant pis */
    }
    ctrl?.abort();
    ctrl = null;
    const chess = new Chess();
    const sans = [];
    let node = nodeAt(tree, []);
    for (const u of path) {
      const mv = node.moves.get(u);
      sans.push(mv.san);
      node = tree.nodes.get(mv.to);
      playUci(chess, u);
    }
    cur = { node, sans, chess };
    board.setPosition(chess, { interactive: 'both', lastMove: path.at(-1) });
    drawName();
    drawPath();
    drawMoves();
    drawEval();
    drawGames();
    if (engineOn && !evals.has(node.key)) evaluate();
  }

  function onMove(uci) {
    const c = new Chess(cur.chess.fen());
    const m = playUci(c, uci);
    const u = m ? m.from + m.to + (m.promotion || '') : '';
    if (m && cur.node.moves.has(u)) return go([...path, u]);
    if (m) toast(`${fig(m.san)} n’a jamais été joué ici dans tes parties.`);
    board.sync();
  }

  // ── en-tête : nom de l'ouverture ──
  function drawName() {
    const eco = frName(commonOpening(tree, cur.node.games));
    const repTxt = path.length ? repName(rep.get(cur.node.key)) : '';
    const parts = [eco && `📖 ${esc(eco)}`, repTxt && `📘 ${esc(repTxt)}`].filter(Boolean);
    $('#t-name').innerHTML = parts.join('<br/>');
  }

  // ── chemin joué (on peut toucher un coup pour y revenir) ──
  function drawPath() {
    $('#t-path').innerHTML = cur.sans.length
      ? cur.sans.map((san, i) => (i % 2 ? '' : `<span class="mnum">${i / 2 + 1}.</span>`) + `<button class="mv ${i === cur.sans.length - 1 ? 'cur' : ''}" data-k="${i + 1}">${esc(fig(san))}</button>`).join('')
      : '<span class="muted small">Touche un coup ci-dessous ou joue-le sur l’échiquier.</span>';
    // au départ, pas de boutons : le texte prend toute la largeur
    $('.tree-btns').hidden = !path.length;
  }

  // ── coups suivants avec leurs résultats ──
  function drawMoves() {
    const node = cur.node;
    const ply = path.length;
    const mine = turnOf(node.key) === side;
    const st = statsOf(tree, node.games);
    const entry = rep.get(node.key);
    const repMoves = entry?.moves.size ? entry.moves : null;
    const moves = [...node.moves.values()].sort((a, b) => b.games.length - a.games.length);
    const off = repMoves ? moves.filter((m) => !repMoves.has(m.uci)) : [];
    const repList = repMoves ? [...repMoves.values()].map((m) => `<b>${esc(numLabel(ply, m.san))}</b>`).join(' ou ') : '';
    // ligne à revoir : celle de ton coup si c'est à toi ; sinon la ligne qui passe ici (si elle est sans ambiguïté)
    const lineId = repMoves && mine ? [...repMoves.values()][0].lines[0] : entry ? closestLine(entry.lines) : null;
    const lineLink = lineId ? ` <a class="tm-link" href="#/opening/${lineId}/learn">📖 Revoir la ligne</a>` : '';
    let note = '';
    if (repMoves && mine) {
      const offN = new Set(off.flatMap((m) => m.games)).size;
      note = off.length
        ? `<p class="tm-note off">⚠️ Ton répertoire joue ici ${repList}. Dans ${plural(offN, 'partie')}, tu as joué autre chose.${lineLink}</p>`
        : `<p class="tm-note rep">📘 Tu suis ton répertoire : ici, c’est ${repList}.</p>`;
    } else if (repMoves) {
      note = off.length
        ? `<p class="tm-note prep">🧭 Position à préparer : ${off.map((m) => `<b>${esc(numLabel(ply, m.san))}</b>`).join(', ')} ${off.length > 1 ? 'ne sont pas prévus' : 'n’est pas prévu'} par ton répertoire. Demande à Stockfish la bonne réponse et regarde tes parties.${lineLink}</p>`
        : `<p class="tm-note rep">📘 Ici, tes adversaires ont toujours joué un coup de ton répertoire.</p>`;
    } else if (entry) {
      note = `<p class="tm-note rep">📘 Fin de ta ligne : à partir d’ici, ce sont les plans et la tactique qui comptent.${lineLink}</p>`;
    } else if (ply) {
      note = '<p class="muted small">Cette position est en dehors de ton répertoire.</p>';
    }
    const maxN = moves[0]?.games.length || 1;
    const rows = moves.map((m) => moveRow(tree, m, ply, mine, repMoves)).join('');
    // coups du répertoire jamais joués dans tes parties (à toi de les essayer)
    const missing = repMoves && mine ? [...repMoves].filter(([u]) => !node.moves.has(u)) : [];
    const ghost = missing.map(([, m]) => `<div class="tm-row ghost"><span class="tm-top"><b class="tm-san">${esc(numLabel(ply, m.san))}</b><span class="tm-badge rep">📘 répertoire</span><span class="tm-n">jamais joué</span></span></div>`).join('');
    const end = moves.length ? '' : `<p class="muted">${ply >= MAX_PLIES ? 'L’arbre s’arrête au 20e coup : c’est l’ouverture qui compte ici.' : 'Tes parties se sont terminées dans cette position.'}</p>`;
    // les coups d'abord (juste sous l'échiquier), le commentaire du répertoire ensuite
    $('#t-moves').innerHTML = `
      <div class="row between tm-head"><h2>${mine ? 'À toi de jouer' : 'À ton adversaire de jouer'}</h2><span class="muted small">${plural(st.n, 'partie')}${st.pct === null ? '' : ` · ${st.pct} %`}</span></div>
      ${rows}${ghost}${end}${note}
      ${moves.length ? '<p class="muted small tm-legend"><span class="lg w"></span> gains <span class="lg d"></span> nulles <span class="lg l"></span> défaites · % = tes points (une nulle compte pour moitié). Touche un coup pour avancer.</p>' : ''}`;
    // flèches pâles : les coups de tes parties (vert : répertoire, rouge : ton écart) ; vert vif : coup du répertoire jamais joué
    const arrows = moves.slice(0, 4).map((m) => ({
      orig: m.uci.slice(0, 2),
      dest: m.uci.slice(2, 4),
      brush: repMoves?.has(m.uci) ? 'paleGreen' : repMoves && mine ? 'paleRed' : 'paleGrey',
      modifiers: { lineWidth: Math.round(6 + (9 * m.games.length) / maxN) },
    }));
    for (const [u] of missing) arrows.push({ orig: u.slice(0, 2), dest: u.slice(2, 4), brush: 'green' });
    board.setShapes(evals.has(node.key) ? engineShapes(evals.get(node.key)) : arrows);
  }

  // ── Stockfish à la demande ──
  const myEval = (l) => {
    const w = l.white;
    const sign = side === 'w' ? 1 : -1;
    if (w.mate !== undefined) return w.mate * sign > 0 ? `mat en ${Math.abs(w.mate)} pour toi` : `mat en ${Math.abs(w.mate)} pour ton adversaire`;
    const v = Math.round((w.cp * sign) / 10) / 10;
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1).replace('.', ',')} pour toi`;
  };
  const engineShapes = (lines) => lines.slice(0, 2).map((l, i) => ({ orig: l.pv[0].slice(0, 2), dest: l.pv[0].slice(2, 4), brush: i ? 'paleBlue' : 'blue' }));

  function explanation(lines) {
    const fen = cur.chess.fen();
    const [best, second] = lines;
    if (turnOf(cur.node.key) === side) {
      // explainBest parle au joueur qui a le trait : ici, c'est toi ; on donne juste l'évaluation « pour toi »
      return explainBest(fen, lines).map((p) => {
        let q = p.replace(`(${evalText(best)} — `, `(${myEval(best)} — `);
        if (second) q = q.replace(`, ${evalText(second)})`, `, ${myEval(second)})`).replace(`(${evalText(second)})`, `(${myEval(second)})`);
        return q;
      });
    }
    const d = describeMove(fen, best.pv[0]);
    const out = [`**Le meilleur coup de ton adversaire : ${fig(d.san)}** (${myEval(best)} — ${evalPhrase(best, side)}).`, ...d.facts.map((f) => '• ' + f)];
    if (best.pv.length > 1) out.push(`Suite probable : ${pvToSan(fen, best.pv, 7)}.`);
    if (second) out.push(`Autre bon coup pour lui : ${fig(uciToSan(fen, second.pv[0]))} (${myEval(second)}).`);
    return out;
  }

  function drawEval() {
    const el = $('#t-eval');
    const lines = evals.get(cur.node.key);
    if (cur.chess.isGameOver()) {
      el.innerHTML = '<p class="muted">La partie est terminée dans cette position.</p>';
      return;
    }
    if (!lines) {
      el.innerHTML = engineOn
        ? '<p class="muted">Stockfish réfléchit… <span class="thinking">●</span></p>'
        : '<button class="btn block" id="t-sf">🔍 Évaluer avec Stockfish</button><p class="muted small">Stockfish te dit qui est mieux ici, quel coup jouer et pourquoi. Il continue ensuite sur chaque position où tu vas.</p>';
      return;
    }
    if (!lines.length) {
      el.innerHTML = '<p class="muted">Stockfish n’a rien trouvé à dire ici.</p>';
      return;
    }
    const best = lines[0];
    const bestMv = cur.node.moves.get(best.pv[0]);
    const mine = turnOf(cur.node.key) === side;
    const repMv = rep.get(cur.node.key)?.moves.has(best.pv[0]);
    const tree2 = bestMv
      ? `${mine ? 'Tu l’as joué' : 'Tes adversaires l’ont joué'} dans ${plural(bestMv.games.length, 'partie')} ici.`
      : `${mine ? 'Tu ne l’as encore jamais joué' : 'Aucun de tes adversaires ne l’a joué'} ici.`;
    el.innerHTML = `<div class="coach-title">🔍 Stockfish : ${esc(evalPhrase(best, side))}</div>
      <div class="tree-eval">${md(explanation(lines).join('\n'))}</div>
      <p class="small">${tree2}${repMv ? ' C’est aussi le coup de ton répertoire 📘.' : ''}</p>
      <div class="row between"><span class="muted small">Flèche bleue : le choix de Stockfish (profondeur ${DEPTH}).</span><button class="btn ghost small" id="t-sf-off">Couper Stockfish</button></div>`;
  }

  async function evaluate() {
    const key = cur.node.key;
    const fen = cur.chess.fen();
    if (cur.chess.isGameOver() || evals.has(key)) return;
    ctrl?.abort();
    const mine = (ctrl = new AbortController());
    drawEval();
    let res;
    try {
      res = await engine.search(fen, { depth: DEPTH, multipv: 2, signal: mine.signal });
    } catch {
      res = null;
    }
    if (!alive || mine.signal.aborted) return; // page quittée ou position changée entre-temps
    if (!res) {
      $('#t-eval').innerHTML = '<p class="error">Stockfish n’a pas pu démarrer. Réessaie dans un instant.</p>';
      return;
    }
    evals.set(key, res.lines);
    if (cur.node.key !== key) return;
    drawEval();
    drawMoves();
  }

  // ── parties passées par cette position ──
  function drawGames() {
    const ply = path.length;
    const list = cur.node.games
      .map((gi) => tree.games[gi])
      .filter((gm) => byId.has(gm.id))
      .sort((a, b) => b.date.localeCompare(a.date));
    const rows = list.slice(0, LAST_GAMES).map((gm) => {
      const g = byId.get(gm.id);
      const analysed = !!g.review;
      const next = gm.sans[ply] ? ` · puis ${esc(numLabel(ply, gm.sans[ply]))}` : '';
      const res = resultFr(g, gm.score);
      const cls = gm.score === 1 ? 'good-txt' : gm.score === 0 ? 'tg-loss' : '';
      return `<a class="list-item tg-row" href="#/review/${encodeURIComponent(g.id)}"><span>${esc(g.label || 'Partie')}<br/><small class="muted">${esc(dateFr(g.date))} · <span class="${cls}">${esc(res)}</span>${next}</small></span><span class="nowrap small ${analysed ? 'accent' : 'muted'}">${analysed ? 'Bilan →' : 'Analyser →'}</span></a>`;
    });
    $('#t-games').innerHTML = `<h2>Tes parties passées par ici</h2>
      <p class="muted small">${list.length > LAST_GAMES ? `Les ${LAST_GAMES} plus récentes sur ${list.length}.` : plural(list.length, 'partie') + '.'}${list.slice(0, LAST_GAMES).some((gm) => !byId.get(gm.id).review) ? ' « Analyser » lance le bilan Stockfish de la partie (environ une minute).' : ''}</p>
      ${rows.join('') || '<p class="muted">Aucune partie.</p>'}`;
  }

  /** Fait remonter l'échiquier sous la barre du haut (toujours, ou seulement s'il est sorti de l'écran par le haut). */
  function showBoard(always) {
    const bar = Math.max(0, document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0);
    const top = $('#t-board').getBoundingClientRect().top;
    if (always || top < bar) window.scrollTo({ top: Math.max(0, top + window.scrollY - bar - 6), behavior: 'smooth' });
  }

  // ── interactions ──
  root.addEventListener('click', onClick);
  function onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.uci) {
      go([...path, t.dataset.uci]);
      showBoard(false);
    } else if (t.dataset.k) go(path.slice(0, +t.dataset.k));
    else if (t.dataset.dev) {
      go(devs[+t.dataset.dev].path);
      // on replie le résumé : l'échiquier remonte, la position choisie est sous les yeux
      const sum = $('#t-sum');
      if (sum) sum.open = false;
      showBoard(true);
    } else if (t.id === 't-start') go([]);
    else if (t.id === 't-back') go(path.slice(0, -1));
    else if (t.id === 't-sf') {
      engineOn = true;
      evaluate();
    } else if (t.id === 't-sf-off') {
      engineOn = false;
      ctrl?.abort();
      evals.clear();
      drawEval();
      drawMoves();
    }
  }

  go(path);
  return () => {
    alive = false;
    ctrl?.abort();
    root.removeEventListener('click', onClick);
    board.destroy();
  };
}

/** Une ligne du tableau des coups : coup, badge, nombre de parties, barre gains/nulles/défaites, % des points. */
function moveRow(tree, m, ply, mine, repMoves) {
  const st = statsOf(tree, m.games);
  const inRep = !!repMoves?.has(m.uci);
  const off = !!repMoves && !inRep;
  const badge = inRep
    ? '<span class="tm-badge rep">📘 répertoire</span>'
    : off
      ? mine
        ? '<span class="tm-badge off">⚠️ hors répertoire</span>'
        : '<span class="tm-badge prep">🧭 à préparer</span>'
      : '';
  const w = (v) => (100 * v) / st.known;
  const seg = (k, v) => (v ? `<i class="${k}" style="width:${w(v).toFixed(1)}%">${w(v) >= 14 ? v : ''}</i>` : '');
  const bar = st.known ? seg('w', st.w) + seg('d', st.d) + seg('l', st.l) : '<i class="u" style="width:100%"></i>';
  return `<button class="tm-row ${inRep ? 'rep' : off ? (mine ? 'off' : 'prep') : ''}" data-uci="${m.uci}">
    <span class="tm-top"><b class="tm-san">${esc(numLabel(ply, m.san))}</b>${badge}<span class="tm-n">${plural(st.n, 'partie')}</span><span class="tm-pct">${st.pct === null ? '' : st.pct + ' %'}</span></span>
    <span class="tm-bar">${bar}</span>
  </button>`;
}

/**
 * Résumé « Là où tu sors du répertoire » : une seule ligne qu'on déplie (l'échiquier reste sur le premier écran).
 * Déplié : les positions les plus fréquentes, chacune avec qui sort, où, les coups joués, le coup prévu, le nombre de
 * parties, tes points, un lien vers l'arbre et un lien vers la ligne à revoir.
 */
function summaryHtml(devs, tree) {
  if (!devs.length) return '<section class="card tree-sum tree-sum-ok"><p>📘 <b>Répertoire respecté</b> : dans tes parties, toi comme tes adversaires êtes restés dans tes lignes tant qu’elles duraient. 👏</p></section>';
  const item = (d, k) => {
    const st = statsOf(tree, d.games);
    const where = d.ply ? `après ${esc(pathText(d.pathSans))}` : 'dès le premier coup';
    const played = d.played
      .slice(0, 3)
      .map((p) => `<b>${esc(numLabel(d.ply, p.san))}</b>${d.played.length > 1 ? ` (${p.n})` : ''}`)
      .join(', ');
    const others = d.played.length > 3 ? ` et ${plural(d.played.length - 3, 'autre coup')}` : '';
    const repTxt = d.repMoves.map((m) => `<b>${esc(numLabel(d.ply, m.san))}</b>`).join(' ou ');
    const body =
      d.by === 'me'
        ? `<b class="ts-tag">⚠️ Tu sors du répertoire</b> ${where} : tu as joué ${played}${others} ; ton répertoire joue ${repTxt}.`
        : `<b class="ts-tag">🧭 Position à préparer</b> ${where} : ton adversaire a joué ${played}${others} ; ton répertoire ne prévoit que ${repTxt}.`;
    return `<div class="ts-item ${d.by}">
      <p class="ts-body">${body}</p>
      <div class="ts-foot"><span class="muted small">${plural(d.games.length, 'partie')}${st.pct === null ? '' : ` · ${st.pct} % des points`}</span>
        <span class="ts-links"><button class="ts-btn" data-dev="${k}">🌳 Voir dans l’arbre</button>${lineById(d.lineId) ? `<a class="ts-btn" href="#/opening/${d.lineId}/learn">📖 Revoir la ligne</a>` : ''}</span></div>
    </div>`;
  };
  let open = false;
  try {
    open = sessionStorage.getItem('tree-sum-open') === '1';
  } catch {
    open = false;
  }
  return `<details class="card tree-sum" id="t-sum" ${open ? 'open' : ''}>
    <summary><h2>Là où tu sors du répertoire</h2><span class="ts-count">${plural(devs.length, 'position')}</span></summary>
    <p class="muted small ts-intro">${devs.length > 1 ? `Les ${devs.length} positions` : 'La position'} où tes parties quittent le plus souvent tes lignes : ⚠️ c’est toi qui en sors, 🧭 c’est ton adversaire (position à préparer).</p>
    ${devs.map(item).join('')}
  </details>`;
}

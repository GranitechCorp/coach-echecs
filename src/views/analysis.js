// Analyse : importer ses parties chess.com / Lichess ou un PGN, et retrouver toutes ses parties.
import { db, update, uid, trimGames } from '../storage.js';
import { setTitle, esc, toast, confirmDialog } from '../ui.js';
import { parsePgn } from '../chessutil.js';
import { importPgnBatch, splitPgn, openingFromPgn } from '../chesscom.js';
import { gameScore, frName, dateKey } from '../opening-tree.js';
import { OPENING_LINES } from '../data/openings.js';

export const tab = 'profile';

const RESULT_FR = { win: 'Victoire', checkmated: 'Défaite (mat)', resigned: 'Défaite (abandon)', timeout: 'Défaite (temps)', abandoned: 'Défaite (abandon)', agreed: 'Nulle', repetition: 'Nulle', stalemate: 'Pat', insufficient: 'Nulle', '50move': 'Nulle', timevsinsufficient: 'Nulle' };
const TIME_FR = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Par correspondance' };
const SPEED_LI = { ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'rapid', correspondence: 'daily' };
const SPEED_FR = { ultraBullet: 'Ultra-bullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', classical: 'Classique', correspondence: 'Par correspondance' };

async function chesscomGames(user) {
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`);
  if (res.status === 404) throw new Error('Joueur introuvable sur chess.com');
  if (!res.ok) throw new Error('chess.com ne répond pas');
  const { archives } = await res.json();
  const games = [];
  for (const url of archives.slice(-2).reverse()) {
    const r = await fetch(url);
    if (r.ok) games.push(...(await r.json()).games);
    if (games.length >= 25) break;
  }
  return games
    .filter((g) => g.pgn && (g.rules || 'chess') === 'chess')
    .sort((a, b) => b.end_time - a.end_time)
    .slice(0, 25)
    .map((g) => {
      const meWhite = g.white.username.toLowerCase() === user.toLowerCase();
      const me = meWhite ? g.white : g.black;
      const opp = meWhite ? g.black : g.white;
      return {
        pgn: g.pgn,
        userColor: meWhite ? 'w' : 'b',
        date: new Date(g.end_time * 1000).toLocaleDateString('fr-FR'),
        kind: TIME_FR[g.time_class] || g.time_class,
        opp: `${opp.username} (${opp.rating})`,
        myRating: me.rating,
        result: RESULT_FR[me.result] || me.result,
        win: me.result === 'win',
        // pour la base « Mes parties » (filtres, tri, pas de doublon avec la synchro)
        extra: { url: g.url, date: new Date(g.end_time * 1000).toISOString(), timeClass: g.time_class, opp: opp.username, oppRating: opp.rating, myRating: me.rating },
      };
    });
}

async function lichessGames(user) {
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=20&pgnInJson=true&opening=true`, { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error('Joueur introuvable sur Lichess');
  if (!res.ok) throw new Error('Lichess ne répond pas');
  const text = await res.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((g) => g.variant === 'standard' && g.pgn)
    .map((g) => {
      const meWhite = g.players.white.user?.name?.toLowerCase() === user.toLowerCase();
      const opp = meWhite ? g.players.black : g.players.white;
      const myColor = meWhite ? 'white' : 'black';
      return {
        pgn: g.pgn,
        userColor: meWhite ? 'w' : 'b',
        date: new Date(g.createdAt).toLocaleDateString('fr-FR'),
        kind: SPEED_FR[g.speed] || g.speed,
        opp: `${opp.user?.name || 'Anonyme'} (${opp.rating || '?'})`,
        result: g.winner ? (g.winner === myColor ? 'Victoire' : 'Défaite') : 'Nulle',
        win: g.winner === myColor,
        extra: { url: `https://lichess.org/${g.id}`, date: new Date(g.createdAt).toISOString(), timeClass: SPEED_LI[g.speed], opp: opp.user?.name || '', oppRating: opp.rating || null, opening: g.opening?.name || '' },
      };
    });
}

export function render(root) {
  setTitle('Mes parties');
  const s = db();
  const importHtml = `
    <section class="card" id="import">
      <h2>Mes parties chess.com</h2>
      <p class="muted small">Le même bilan que l’abonnement chess.com, mais gratuit : choisis une partie et Stockfish l’analyse coup par coup sur ton téléphone (coups brillants, erreurs, Elo estimé).</p>
      <div class="row"><input id="user" placeholder="Pseudo chess.com" value="${esc(s.profile.chesscomUser)}" autocapitalize="off" autocomplete="off"/><button class="btn primary" id="load-cc">Charger</button></div>
      <button class="btn ghost small" id="load-li">ou charger depuis Lichess</button>
      <div id="list"></div>
    </section>
    <section class="card">
      <h2>Importer des parties (PGN)</h2>
      <p class="small muted">Colle une ou plusieurs parties, ou choisis un fichier .pgn. Ta couleur est reconnue grâce à ton pseudo.</p>
      <details class="small"><summary>Comment récupérer le PGN sur chess.com ?</summary>
        <p><b>Une partie, dans l’appli chess.com :</b> ouvre la partie → icône Partager (ou ⋯) → <b>PGN</b> → Copier. Reviens ici et colle.</p>
        <p><b>Plusieurs parties, sur chess.com dans le navigateur :</b> Jouer → <b>Archive</b> (ou chess.com/games/archive) → coche les parties → <b>Télécharger</b>. Tu obtiens un fichier .pgn à choisir ci-dessous.</p>
      </details>
      <textarea id="pgn" rows="4" placeholder="[Event &quot;Live Chess&quot;]&#10;[White &quot;Granitech&quot;]&#10;1. d4 d5 2. c4 ..."></textarea>
      <div class="row wrap"><label class="btn small ghost">📄 Choisir un fichier .pgn<input type="file" id="pgn-file" accept=".pgn,text/plain,application/x-chess-pgn" hidden/></label>
        <label class="small">Si ton pseudo n’apparaît pas, je jouais : <select id="pgn-color"><option value="w">les Blancs</option><option value="b">les Noirs</option></select></label></div>
      <button class="btn primary" id="go-pgn">Importer</button>
      <div id="pgn-out" class="small"></div>
    </section>
    <section class="card">
      <h2>Échiquier d’analyse</h2>
      <p class="muted small">Joue librement des coups, Stockfish et le coach t’expliquent la position.</p>
      <a class="btn" href="#/board">Ouvrir l’échiquier</a>
    </section>`;
  const dbHtml = '<section class="card gdb" id="gdb"></section>';
  // avec des parties, la base passe en premier ; sinon on commence par l'import
  root.innerHTML = s.games.length ? dbHtml + importHtml : importHtml + dbHtml;
  const base = mountGameBase(root.querySelector('#gdb'));

  const list = root.querySelector('#list');
  let loaded = [];

  async function load(fn, source) {
    const user = root.querySelector('#user').value.trim();
    if (!user) return toast('Entre ton pseudo.');
    update((d) => (d.profile.chesscomUser = user));
    list.innerHTML = '<p class="muted">Chargement…</p>';
    try {
      loaded = (await fn(user)).map((g) => ({ ...g, source }));
    } catch (e) {
      list.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      return;
    }
    list.innerHTML = loaded.length
      ? loaded.map((g, i) => `<button class="list-item game-row" data-i="${i}"><span>${g.userColor === 'w' ? '⚪' : '⚫'} vs ${esc(g.opp)}<br/><small class="muted">${esc(g.date)} · ${esc(g.kind)}</small></span><span class="${g.win ? 'good-txt' : ''}">${esc(g.result)}</span></button>`).join('')
      : '<p class="muted">Aucune partie récente.</p>';
  }
  root.querySelector('#load-cc').onclick = () => load(chesscomGames, 'chess.com');
  root.querySelector('#load-li').onclick = () => load(lichessGames, 'lichess');
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const g = loaded[+b.dataset.i];
    const existing = db().games.find((x) => x.pgn === g.pgn || (g.extra?.url && x.url === g.extra.url));
    location.hash = `#/review/${existing?.id || addLoaded(g)}`;
  });
  const doImport = (text) => {
    const out = root.querySelector('#pgn-out');
    const r = importPgnBatch(text, { fallbackColor: root.querySelector('#pgn-color').value });
    if (!r.total) return toast('Aucune partie PGN reconnue.');
    // base pleine (300 parties) : les parties plus anciennes que toutes les autres ne sont pas gardées
    const have = new Set(db().games.map((g) => g.id));
    const kept = r.ids.filter((id) => have.has(id));
    const lost = r.added - kept.length;
    if (kept.length === 1 && r.total === 1) {
      location.hash = `#/review/${kept[0]}`;
      return;
    }
    base.draw();
    const n = kept.length;
    const full = lost ? ` <br/>⚠️ Ta liste est pleine (300 parties au plus) : ${lost > 1 ? `${lost} parties plus anciennes que toutes les autres n’ont pas été gardées` : 'une partie plus ancienne que toutes les autres n’a pas été gardée'}. Supprime des parties pour faire de la place.` : '';
    if (lost) toast(`Liste pleine (300 parties) : ${lost > 1 ? `${lost} parties trop anciennes n’ont pas été gardées` : 'partie trop ancienne, pas gardée'}.`, 5000);
    const skipped = r.skipped ? ` (${r.skipped} déjà présente${r.skipped > 1 ? 's' : ''})` : '';
    out.innerHTML = n
      ? `✓ ${n} partie${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}${skipped}.${full} <a href="#/profile">Analyser et voir mon diagnostic →</a>`
      : lost
        ? `✗ Aucune partie gardée${skipped}.${full}`
        : `${r.total > 1 ? 'Ces parties sont' : 'Cette partie est'} déjà dans ta liste : rien de nouveau à importer.`;
  };
  root.querySelector('#go-pgn').onclick = () => {
    const text = root.querySelector('#pgn').value.trim();
    if (!text) return toast('Colle d’abord une partie.');
    if (!parsePgn(splitPgn(text)[0] || text)) return toast('PGN invalide.');
    doImport(text);
  };
  root.querySelector('#pgn-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (f) doImport(await f.text());
  };
}

/**
 * Ajoute une partie chargée depuis chess.com ou Lichess, avec sa vraie date, sa cadence, l'adversaire et l'ouverture
 * (pour les filtres de « Mes parties » ; l'adresse évite un doublon à la prochaine synchro). Renvoie son identifiant.
 */
function addLoaded(g) {
  const { name, family } = openingFromPgn(g.pgn);
  const rec = { id: uid(), date: new Date().toISOString(), pgn: g.pgn, userColor: g.userColor, result: g.result, source: g.source, label: `vs ${g.opp} · ${g.kind}${g.source === 'lichess' ? ' · Lichess' : ''}`, ...g.extra };
  if (name) rec.opening = name;
  if (family) rec.family = family;
  const sc = gameScore(rec);
  if (sc !== null) rec.score = sc;
  update((d) => {
    d.games.push(rec);
    d.games.sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
    // trop de parties (300) : on enlève d'abord les plus anciennes pas encore analysées, jamais celle qu'on ajoute
    trimGames(d, rec.id);
  });
  return rec.id;
}

// ─────────────── « Mes parties » façon base de données : filtres, recherche, tri ───────────────

const FILTER_KEY = 'games-db';
const NO_FILTER = { side: '', res: '', tc: '', op: '', an: '', q: '', sort: 'new' };
const PAGE = 30;
const CADENCE_FR = { rapid: 'Rapide', blitz: 'Blitz', bullet: 'Bullet', daily: 'Correspondance', bot: 'Ordinateur', other: 'Autre cadence' };
const RES_CODE = { 1: 'w', 0.5: 'd', 0: 'l' };

function loadFilters() {
  try {
    return { ...NO_FILTER, ...JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') };
  } catch {
    return { ...NO_FILTER };
  }
}
function saveFilters(f) {
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch {
    /* navigation privée : les filtres ne seront pas gardés */
  }
}

const header = (pgn, key) => pgn?.match(new RegExp(`\\[${key} "([^"]*)"\\]`))?.[1] || '';

/** Cadence d'une partie : rapid, blitz, bullet, daily, bot ou other. */
function cadenceOf(g) {
  if (g.source === 'bot') return 'bot';
  if (CADENCE_FR[g.timeClass]) return g.timeClass;
  const tc = header(g.pgn, 'TimeControl');
  if (!tc || tc === '-') return 'other';
  if (tc.includes('/')) return 'daily';
  const [base, inc = 0] = tc.split('+').map(Number);
  if (!Number.isFinite(base)) return 'other';
  const total = base + 40 * (inc || 0);
  return total < 180 ? 'bullet' : total < 600 ? 'blitz' : 'rapid';
}

/** Nom de l'adversaire (pour la recherche). */
function oppOf(g) {
  if (g.opp) return g.opp;
  if (g.source === 'bot') return `ordinateur ${g.botElo || ''}`;
  return header(g.pgn, g.userColor === 'w' ? 'Black' : 'White');
}

/**
 * Famille d'ouverture (en français) des lignes du répertoire : c'est le nom que le bilan donne aux parties sans nom
 * chess.com (parties contre l'ordinateur, PGN importés). Par ligne d'abord, sinon par groupe.
 */
const LINE_FAMILY = {
  qg: 'Gambit Dame', ck: 'Défense Caro-Kann', slav: 'Défense slave', london: 'Système de Londres', italian: 'Partie italienne',
  e5: 'Partie ouverte (1.e4 e5)', scandi: 'Défense scandinave', 'qgd-black': 'Gambit Dame refusé',
  'qgd-ortho': 'Gambit Dame refusé', 'qgd-cambridge': 'Gambit Dame refusé', qga: 'Gambit Dame accepté', 'qga-trap': 'Gambit Dame accepté',
  'slav-white': 'Défense slave', albin: 'Contre-gambit Albin', chigorin: 'Défense Tchigorine', baltic: 'Défense balte',
  'vs-nf6': 'Gambit Dame refusé', 'vs-kid': 'Défense est-indienne', 'vs-bogo': 'Défense bogo-indienne', englund: 'Gambit Englund',
  dutch: 'Défense hollandaise', 'vs-london': 'Système de Londres', 'italian-2knights': 'Défense des deux cavaliers',
  'italian-petrov': 'Défense Petrov', 'e5-italian': 'Partie italienne', 'e5-ruy': 'Partie espagnole', 'e5-scotch': 'Partie écossaise',
  'e5-friedliver': 'Défense des deux cavaliers',
};

/** Ouverture en français (famille), '~' si on ne sait pas la traduire, '' si inconnue. */
function openingOf(g) {
  const raw = g.opening || g.review?.opening || '';
  const line = !g.family && raw && OPENING_LINES.find((l) => l.name === raw);
  if (line) return LINE_FAMILY[line.id] || LINE_FAMILY[line.group] || '~';
  const fam = g.family || raw.split(':')[0].split('(')[0].trim();
  if (!fam) return '';
  return frName(fam).split(',')[0].trim() || '~'; // la famille seulement (« Défense slave »), pas la variante
}
/** Clé d'une ouverture pour les puces : « Gambit Dame Refusé » et « Gambit Dame refusé » sont la même. */
const opKey = (op) => op.toLocaleLowerCase('fr-FR');

/** Précision de la partie (ton camp), ou null si elle n'est pas analysée. */
function accuracyOf(g) {
  const a = g.review?.accuracy?.[g.userColor];
  return typeof a === 'number' ? Math.round(a) : null;
}

function resultText(g, sc) {
  if (/^(Victoire|Défaite|Nulle|Pat)/.test(g.result || '')) return g.result;
  return sc === 1 ? 'Victoire' : sc === 0 ? 'Défaite' : sc === 0.5 ? 'Nulle' : '';
}

function shortDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** La base de parties : filtres en puces, recherche, tri, compteur, liste, suppression. */
function mountGameBase(el) {
  const f = loadFilters();
  if (f.op) f.op = opKey(f.op); // filtre gardé d'une version précédente (nom affiché au lieu de la clé)
  let shown = PAGE;
  let allOpenings = false;

  // l'en-tête et la recherche ne sont dessinés qu'une fois (le clavier reste ouvert pendant la frappe)
  el.innerHTML = `
    <div class="row between gdb-head"><h2 id="gdb-title"></h2><span class="gdb-links"><a class="small accent" href="#/tree">🌳 Arbre</a><button class="gdb-reset small" id="gdb-import">＋ Importer</button></span></div>
    <input id="gdb-q" type="search" placeholder="Rechercher un adversaire" value="${esc(f.q)}" autocapitalize="off" autocomplete="off"/>
    <div id="gdb-body"></div>`;
  const body = el.querySelector('#gdb-body');

  function draw() {
    const games = db().games.map((g) => {
      const op = openingOf(g);
      return { g, sc: gameScore(g), tc: cadenceOf(g), op, ok: opKey(op), acc: accuracyOf(g) };
    });
    el.querySelector('#gdb-title').textContent = `Mes parties (${games.length})`;
    el.querySelector('#gdb-q').hidden = !games.length;
    el.querySelector('.gdb-links').hidden = !games.length;
    if (!games.length) {
      body.innerHTML = '<p class="muted">Aucune partie pour l’instant : charge tes parties chess.com ou Lichess, importe un PGN, ou joue contre l’ordinateur.</p>';
      return;
    }
    const q = f.q.trim().toLowerCase();
    const keep = (x) =>
      (!f.side || x.g.userColor === f.side) &&
      (!f.res || RES_CODE[x.sc] === f.res) &&
      (!f.tc || x.tc === f.tc) &&
      (!f.op || x.ok === f.op) &&
      (!f.an || (f.an === 'yes') === !!x.g.review) &&
      (!q || `${oppOf(x.g)} ${x.g.label || ''}`.toLowerCase().includes(q));
    const list = games.filter(keep).sort(sorter(f.sort));
    const active = ['side', 'res', 'tc', 'op', 'an', 'q'].filter((k) => f[k]).length;
    body.innerHTML = `
      <p class="muted small gdb-help">${active ? `${active} filtre${active > 1 ? 's' : ''} actif${active > 1 ? 's' : ''} · <button class="gdb-reset" id="gdb-reset">✕ tout effacer</button>` : 'Touche une puce pour filtrer ; retouche-la pour l’enlever.'}</p>
      <div class="chips gdb-chips">${chips('side', [['w', '⚪ Blancs'], ['b', '⚫ Noirs']])}<span class="gdb-sep"></span>${chips('an', [['yes', 'Analysées'], ['no', 'À analyser']])}</div>
      <div class="chips gdb-chips">${chips('res', [['w', 'Gains'], ['d', 'Nulles'], ['l', 'Défaites']])}<span class="gdb-sep"></span>${chips('tc', ['rapid', 'blitz', 'bullet', 'daily', 'bot', 'other'].filter((c) => c === f.tc || games.some((x) => x.tc === c)).map((c) => [c, CADENCE_FR[c]]))}</div>
      ${openingChips(games)}
      <div class="row between gdb-bar"><b id="gdb-count">${list.length} partie${list.length > 1 ? 's' : ''}${list.length !== games.length ? ` sur ${games.length}` : ''}</b>
        <select id="gdb-sort" aria-label="Trier">${[['new', 'Plus récentes'], ['old', 'Plus anciennes'], ['acc', 'Meilleure précision'], ['acc-low', 'Moins bonne précision']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="gdb-list">${list.slice(0, shown).map(rowHtml).join('') || '<p class="muted">Aucune partie ne correspond à ces filtres.</p>'}</div>
      ${list.length > shown ? `<button class="btn block" id="gdb-more">Afficher plus (${list.length - shown} restante${list.length - shown > 1 ? 's' : ''})</button>` : ''}`;
  }

  /** Puces d'un filtre : une seule active à la fois ; la toucher encore l'enlève. */
  const chips = (key, opts) => opts.map(([v, label, n]) => `<button class="chip small ${f[key] === v ? 'on' : ''}" data-k="${key}" data-v="${esc(v)}" aria-pressed="${f[key] === v}">${esc(label)}${n ? ` <span class="gdb-n">${n}</span>` : ''}</button>`).join('');

  /** Puces d'ouverture : regroupées sans tenir compte des majuscules, avec l'orthographe la plus fréquente. */
  function openingChips(games) {
    const groups = new Map(); // clé → { n, labels: Map(nom affiché → nombre) }
    for (const x of games) {
      if (!x.op) continue;
      const gr = groups.get(x.ok) || { n: 0, labels: new Map() };
      gr.n++;
      gr.labels.set(x.op, (gr.labels.get(x.op) || 0) + 1);
      groups.set(x.ok, gr);
    }
    const label = (k, gr) => (k === '~' ? 'Autres ouvertures' : [...gr.labels].sort((a, b) => b[1] - a[1])[0][0]);
    const all = [...groups].map(([k, gr]) => [k, label(k, gr), gr.n]).sort((a, b) => (a[0] === '~') - (b[0] === '~') || b[2] - a[2]);
    // filtre actif sur une ouverture qui n'a plus de partie (supprimées) : sa puce reste visible pour pouvoir l'enlever
    if (f.op && !groups.has(f.op)) all.push([f.op, f.op === '~' ? 'Autres ouvertures' : f.op.charAt(0).toLocaleUpperCase('fr-FR') + f.op.slice(1), 0]);
    if (!all.length) return '';
    const top = allOpenings ? all : all.slice(0, 5);
    if (f.op && !top.some(([k]) => k === f.op)) top.push(all.find(([k]) => k === f.op));
    const rest = all.length - top.length;
    const more = rest > 0 ? `<button class="chip small gdb-more-op" data-more="1">+ ${rest} autre${rest > 1 ? 's' : ''}</button>` : '';
    return `<div class="chips gdb-chips">${chips('op', top)}${more}</div>`;
  }

  function rowHtml({ g, sc, op, acc, tc }) {
    const res = resultText(g, sc);
    const cls = sc === 1 ? 'good-txt' : sc === 0 ? 'gdb-loss' : '';
    const parts = [esc(shortDate(g.date)), res && `<span class="${cls}">${esc(res)}</span>`, op && op !== '~' && esc(op), acc !== null ? `précision ${acc} %` : 'pas encore analysée'].filter(Boolean);
    return `<div class="list-item"><a href="#/review/${encodeURIComponent(g.id)}"><span>${g.userColor === 'w' ? '⚪' : '⚫'} ${esc(g.label || 'Partie')}${g.label ? '' : ` · ${esc(CADENCE_FR[tc])}`}</span><br/><small class="muted">${parts.join(' · ')}</small></a>
      <button class="icon-btn del" data-del="${esc(g.id)}" aria-label="Supprimer">🗑</button></div>`;
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.del) {
      if (!(await confirmDialog('Supprimer cette partie ?', 'Supprimer'))) return;
      update((d) => (d.games = d.games.filter((g) => g.id !== b.dataset.del)));
      draw();
      return;
    }
    if (b.dataset.more) allOpenings = true;
    else if (b.dataset.k) {
      f[b.dataset.k] = f[b.dataset.k] === b.dataset.v ? '' : b.dataset.v;
      shown = PAGE;
    } else if (b.id === 'gdb-reset') {
      Object.assign(f, NO_FILTER, { sort: f.sort });
      el.querySelector('#gdb-q').value = '';
      shown = PAGE;
    } else if (b.id === 'gdb-more') shown += PAGE;
    else if (b.id === 'gdb-import') return document.getElementById('import')?.scrollIntoView({ behavior: 'smooth' });
    else return;
    saveFilters(f);
    draw();
  });
  el.addEventListener('change', (e) => {
    if (e.target.id !== 'gdb-sort') return;
    f.sort = e.target.value;
    saveFilters(f);
    draw();
  });
  // recherche : le champ n'est jamais redessiné, le clavier reste ouvert
  el.addEventListener('input', (e) => {
    if (e.target.id !== 'gdb-q') return;
    f.q = e.target.value;
    saveFilters(f);
    shown = PAGE;
    draw();
  });
  draw();
  return { draw };
}

/** Ordre de la liste : date (récentes / anciennes) ou précision (les parties non analysées à la fin). */
function sorter(kind) {
  const byDate = (a, b) => dateKey(b.g.date).localeCompare(dateKey(a.g.date));
  if (kind === 'old') return (a, b) => -byDate(a, b);
  if (kind === 'acc' || kind === 'acc-low') {
    const sign = kind === 'acc' ? 1 : -1;
    return (a, b) => (a.acc === null) - (b.acc === null) || sign * ((b.acc ?? 0) - (a.acc ?? 0)) || byDate(a, b);
  }
  return byDate;
}

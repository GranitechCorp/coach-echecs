// Analyse : importer ses parties chess.com / Lichess ou un PGN, et retrouver toutes ses parties.
import { db, update } from '../storage.js';
import { setTitle, esc, toast, confirmDialog } from '../ui.js';
import { parsePgn } from '../chessutil.js';
import { importPgnBatch, splitPgn } from '../chesscom.js';
import { importGame } from './review.js';

export const tab = 'profile';

const RESULT_FR = { win: 'Victoire', checkmated: 'Défaite (mat)', resigned: 'Défaite (abandon)', timeout: 'Défaite (temps)', abandoned: 'Défaite (abandon)', agreed: 'Nulle', repetition: 'Nulle', stalemate: 'Pat', insufficient: 'Nulle', '50move': 'Nulle', timevsinsufficient: 'Nulle' };
const TIME_FR = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Par correspondance' };

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
        kind: g.speed,
        opp: `${opp.user?.name || 'Anonyme'} (${opp.rating || '?'})`,
        result: g.winner ? (g.winner === myColor ? 'Victoire' : 'Défaite') : 'Nulle',
        win: g.winner === myColor,
      };
    });
}

export function render(root) {
  setTitle('Analyse');
  const s = db();
  root.innerHTML = `
    <section class="card">
      <h2>Mes parties chess.com</h2>
      <p class="muted small">Le bilan de partie de l’abonnement, gratuitement : choisis une partie et Stockfish l’analyse coup par coup sur ton téléphone.</p>
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
    </section>
    <section class="card">
      <h2>Toutes mes parties (${s.games.length})</h2>
      ${s.games.length ? s.games.slice().reverse().map((g) => `
        <div class="list-item"><a href="#/review/${g.id}"><span>${g.userColor === 'w' ? '⚪' : '⚫'} ${esc(g.label || 'Partie')}</span><br/><small class="muted">${new Date(g.date).toLocaleDateString('fr-FR')} · ${esc(g.result || '')}${g.review ? ` · précision ${Math.round(g.review.accuracy[g.userColor])} %` : ' · pas encore analysée'}</small></a>
        <button class="icon-btn del" data-del="${g.id}" aria-label="Supprimer">🗑</button></div>`).join('') : '<p class="muted">Aucune partie pour l’instant.</p>'}
    </section>`;

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
    const existing = db().games.find((x) => x.pgn === g.pgn);
    const id = existing?.id || importGame({ pgn: g.pgn, userColor: g.userColor, label: `vs ${g.opp} (${g.source}, ${g.kind})`, source: g.source, result: g.result });
    location.hash = `#/review/${id}`;
  });
  const doImport = (text) => {
    const out = root.querySelector('#pgn-out');
    const r = importPgnBatch(text, { fallbackColor: root.querySelector('#pgn-color').value });
    if (!r.total) return toast('Aucune partie PGN reconnue.');
    if (r.added === 1 && r.total === 1) {
      location.hash = `#/review/${r.ids[0]}`;
      return;
    }
    out.innerHTML = `✓ ${r.added} partie${r.added > 1 ? 's' : ''} importée${r.added > 1 ? 's' : ''}${r.skipped ? ` (${r.skipped} déjà présente${r.skipped > 1 ? 's' : ''})` : ''}. <a href="#/profile">Analyser et voir mon diagnostic →</a>`;
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
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (!(await confirmDialog('Supprimer cette partie ?', 'Supprimer'))) return;
    update((d) => (d.games = d.games.filter((g) => g.id !== b.dataset.del)));
    render(root);
  });
}

// Synchronisation avec l'API publique de chess.com (pas besoin de mot de passe : les parties sont publiques).
import { db, update, uid, trimGames } from './storage.js';

const API = 'https://api.chess.com/pub/player/';
const FIRST_SYNC_MONTHS = 6;

const LOSS = new Set(['checkmated', 'resigned', 'timeout', 'abandoned', 'lose', 'bughousepartnerlose']);
const RESULT_FR = { win: 'Victoire', checkmated: 'Défaite (mat)', resigned: 'Défaite (abandon)', timeout: 'Défaite (temps)', abandoned: 'Défaite (abandon)', agreed: 'Nulle (accord)', repetition: 'Nulle (répétition)', stalemate: 'Nulle (pat)', insufficient: 'Nulle (matériel)', '50move': 'Nulle (50 coups)', timevsinsufficient: 'Nulle (temps)' };
export const TIME_FR = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Correspondance' };

async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(typeof window.claude?.use === 'function'
      ? 'Dans la version claude.ai, la page ne peut pas contacter chess.com directement. Importe tes parties en PGN : « Mes parties / importer ».'
      : 'Impossible de joindre chess.com : vérifie ta connexion.');
  }
  if (res.status === 404) throw new Error('Joueur introuvable sur chess.com');
  if (res.status === 429) throw new Error('chess.com limite les requêtes : réessaie dans une minute');
  if (!res.ok) throw new Error(`chess.com ne répond pas (${res.status})`);
  return res.json();
}

/** Nom d'ouverture lisible à partir de l'URL ECO de chess.com. */
export function openingFromPgn(pgn) {
  const url = pgn.match(/\[ECOUrl "([^"]+)"\]/)?.[1];
  if (!url) return { name: '', family: '' };
  const name = decodeURIComponent(url.split('/').pop()).replace(/-/g, ' ').replace(/\.\.\./g, '…').trim();
  return { name, family: openingFamily(name) };
}

/** « Caro Kann Defense Advance Variation » → « Caro Kann Defense » */
export function openingFamily(name) {
  const words = name.split(' ');
  const out = [];
  for (const w of words) {
    if (/^\d/.test(w)) break;
    out.push(w);
    if (/^(Defense|Defence|Game|Opening|Attack|System|Gambit)$/.test(w)) {
      const next = words[out.length];
      if (next && /^(Declined|Accepted|Refused)$/.test(next)) out.push(next);
      break;
    }
    if (out.length >= 4) break;
  }
  return out.join(' ');
}

function toRecord(g, user) {
  const meWhite = g.white.username.toLowerCase() === user.toLowerCase();
  const me = meWhite ? g.white : g.black;
  const opp = meWhite ? g.black : g.white;
  const score = me.result === 'win' ? 1 : LOSS.has(me.result) ? 0 : 0.5;
  const { name, family } = openingFromPgn(g.pgn);
  return {
    id: uid(),
    source: 'chess.com',
    url: g.url,
    date: new Date(g.end_time * 1000).toISOString(),
    pgn: g.pgn,
    userColor: meWhite ? 'w' : 'b',
    result: RESULT_FR[me.result] || me.result,
    resultCode: me.result,
    oppResultCode: opp.result,
    score,
    myRating: me.rating,
    oppRating: opp.rating,
    opp: opp.username,
    timeClass: g.time_class,
    timeControl: g.time_control,
    opening: name,
    family,
    ccAccuracy: g.accuracies ? (meWhite ? g.accuracies.white : g.accuracies.black) : null,
    label: `vs ${opp.username} (${opp.rating}) · ${TIME_FR[g.time_class] || g.time_class}`,
  };
}

/**
 * Récupère les nouvelles parties chess.com et les ajoute à la base locale.
 * Renvoie { added, total, ratings }.
 */
export async function syncChesscom(user = db().profile.chesscomUser, onProgress) {
  if (!user) throw new Error('Indique ton pseudo chess.com dans les Réglages.');
  const s = db();
  const known = new Set(s.games.filter((g) => g.url).map((g) => g.url));
  const { archives } = await getJson(`${API}${encodeURIComponent(user.toLowerCase())}/games/archives`);
  // première synchro : 6 derniers mois ; ensuite : depuis le mois de la dernière synchro
  const lastMonth = s.sync?.lastArchive;
  let todo = lastMonth ? archives.filter((a) => a >= lastMonth) : archives.slice(-FIRST_SYNC_MONTHS);
  if (!todo.length) todo = archives.slice(-1);
  const fresh = [];
  for (const [i, url] of todo.entries()) {
    onProgress?.(`Mois ${i + 1}/${todo.length}…`);
    const { games } = await getJson(url);
    for (const g of games) {
      if (!g.pgn || (g.rules || 'chess') !== 'chess' || known.has(g.url)) continue;
      fresh.push(toRecord(g, user));
      known.add(g.url);
    }
  }
  let ratings = null;
  try {
    const st = await getJson(`${API}${encodeURIComponent(user.toLowerCase())}/stats`);
    ratings = {};
    for (const k of ['chess_rapid', 'chess_blitz', 'chess_bullet', 'chess_daily']) {
      if (st[k]?.last) ratings[k.replace('chess_', '')] = { rating: st[k].last.rating, best: st[k].best?.rating, w: st[k].record?.win, l: st[k].record?.loss, d: st[k].record?.draw };
    }
  } catch {
    /* les statistiques sont un bonus */
  }
  update((d) => {
    d.games.push(...fresh.sort((a, b) => a.date.localeCompare(b.date)));
    d.games.sort((a, b) => a.date.localeCompare(b.date));
    trimGames(d); // on garde en priorité les parties déjà analysées
    d.sync = { at: Date.now(), lastArchive: todo.at(-1), user };
    if (ratings) {
      d.ccRatings = ratings;
      const main = ratings.rapid?.rating || ratings.blitz?.rating;
      if (main && !d.profile.startEloLocked) d.profile.currentElo = main;
    }
  });
  return { added: fresh.length, total: db().games.length, ratings };
}

/** Synchro silencieuse au démarrage (au plus toutes les 6 heures). */
export async function autoSync() {
  const s = db();
  if (!s.profile.chesscomUser || !navigator.onLine || typeof window.claude?.use === 'function') return null;
  if (s.sync?.at && Date.now() - s.sync.at < 6 * 3600 * 1000) return null;
  try {
    return await syncChesscom();
  } catch {
    return null;
  }
}

// ─────────────── Import par PGN (copier-coller ou fichier) ───────────────

/** Sépare un texte contenant une ou plusieurs parties PGN. */
export function splitPgn(text) {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  const parts = t.split(/\n\s*\n(?=\[Event )/);
  return parts.map((p) => p.trim()).filter((p) => /\d+\.\s*\S/.test(p));
}

function header(pgn, key) {
  return pgn.match(new RegExp(`\\[${key} "([^"]*)"\\]`))?.[1] ?? '';
}

function timeClassOf(tc) {
  if (!tc || tc === '-') return 'rapid';
  if (tc.includes('/')) return 'daily';
  const [base, inc = 0] = tc.split('+').map(Number);
  const total = base + 40 * inc;
  if (total < 180) return 'bullet';
  if (total < 600) return 'blitz';
  return 'rapid';
}

/**
 * Ajoute des parties PGN à la base. La couleur du joueur est trouvée grâce à son pseudo ;
 * à défaut on utilise `fallbackColor`. Renvoie { added, skipped }.
 */
export function importPgnBatch(text, { user = db().profile.chesscomUser, fallbackColor = 'w' } = {}) {
  const games = splitPgn(text);
  const s = db();
  const known = new Set(s.games.map((g) => g.url || g.pgn));
  const fresh = [];
  let skipped = 0;
  for (const pgn of games) {
    const url = header(pgn, 'Link') || (header(pgn, 'Site').startsWith('http') ? header(pgn, 'Site') : '');
    if (known.has(url || pgn)) {
      skipped++;
      continue;
    }
    const white = header(pgn, 'White');
    const black = header(pgn, 'Black');
    const u = (user || '').toLowerCase();
    const userColor = u && white.toLowerCase() === u ? 'w' : u && black.toLowerCase() === u ? 'b' : fallbackColor;
    const result = header(pgn, 'Result');
    const score = result === '1/2-1/2' ? 0.5 : result === '1-0' ? (userColor === 'w' ? 1 : 0) : result === '0-1' ? (userColor === 'b' ? 1 : 0) : null;
    const term = header(pgn, 'Termination').toLowerCase();
    const onTime = /time|temps/.test(term);
    const tc = header(pgn, 'TimeControl');
    const { name, family } = openingFromPgn(pgn);
    const date = (header(pgn, 'EndDate') || header(pgn, 'UTCDate') || header(pgn, 'Date')).replace(/\./g, '-');
    const time = header(pgn, 'EndTime') || header(pgn, 'UTCTime') || '12:00:00';
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T${time.slice(0, 8)}Z`).toISOString() : new Date().toISOString();
    const opp = userColor === 'w' ? black : white;
    const oppRating = +header(pgn, userColor === 'w' ? 'BlackElo' : 'WhiteElo') || null;
    const timeClass = timeClassOf(tc);
    fresh.push({
      id: uid(),
      source: /chess\.com/i.test(header(pgn, 'Site') + url) ? 'chess.com' : 'import',
      url: url || null,
      date: iso,
      pgn,
      userColor,
      result: score === 1 ? 'Victoire' : score === 0 ? (onTime ? 'Défaite (temps)' : 'Défaite') : score === 0.5 ? 'Nulle' : result,
      resultCode: score === 0 && onTime ? 'timeout' : score === 1 ? 'win' : '',
      oppResultCode: score === 1 && onTime ? 'timeout' : '',
      score,
      myRating: +header(pgn, userColor === 'w' ? 'WhiteElo' : 'BlackElo') || null,
      oppRating,
      opp,
      timeClass,
      timeControl: tc,
      opening: name,
      family,
      label: `vs ${opp || '?'}${oppRating ? ` (${oppRating})` : ''} · ${TIME_FR[timeClass] || timeClass}`,
    });
    known.add(url || pgn);
  }
  if (fresh.length) {
    update((d) => {
      d.games.push(...fresh);
      d.games.sort((a, b) => a.date.localeCompare(b.date));
      trimGames(d, fresh.map((g) => g.id)); // jamais les parties qu'on vient d'importer
    });
  }
  return { added: fresh.length, skipped, total: games.length, ids: fresh.map((g) => g.id) };
}

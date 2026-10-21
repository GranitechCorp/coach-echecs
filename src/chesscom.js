// Synchronisation avec l'API publique de chess.com (pas besoin de mot de passe : les parties sont publiques).
import { db, update, uid } from './storage.js';

const API = 'https://api.chess.com/pub/player/';
const FIRST_SYNC_MONTHS = 6;
const MAX_GAMES = 300;

const LOSS = new Set(['checkmated', 'resigned', 'timeout', 'abandoned', 'lose', 'bughousepartnerlose']);
const RESULT_FR = { win: 'Victoire', checkmated: 'Défaite (mat)', resigned: 'Défaite (abandon)', timeout: 'Défaite (temps)', abandoned: 'Défaite (abandon)', agreed: 'Nulle (accord)', repetition: 'Nulle (répétition)', stalemate: 'Nulle (pat)', insufficient: 'Nulle (matériel)', '50move': 'Nulle (50 coups)', timevsinsufficient: 'Nulle (temps)' };
export const TIME_FR = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Correspondance' };

async function getJson(url) {
  const res = await fetch(url);
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
    if (d.games.length > MAX_GAMES) {
      // on garde en priorité les parties déjà analysées
      const drop = d.games.length - MAX_GAMES;
      let removed = 0;
      d.games = d.games.filter((g) => (removed < drop && !g.review ? (removed++, false) : true));
    }
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
  if (!s.profile.chesscomUser || !navigator.onLine) return null;
  if (s.sync?.at && Date.now() - s.sync.at < 6 * 3600 * 1000) return null;
  try {
    return await syncChesscom();
  } catch {
    return null;
  }
}

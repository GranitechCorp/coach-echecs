// Coach IA (optionnel) : Claude explique les positions en s'appuyant sur les analyses de Stockfish.
// La clé API est saisie dans les réglages et ne quitte le téléphone que vers api.anthropic.com.
import Anthropic from '@anthropic-ai/sdk';
import { db } from './storage.js';
import { safeChess, NAME } from './chessutil.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — le plus pédagogue (≈ 2 à 4 centimes l’explication)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — très bon, moins cher' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — économique (≈ 0,1 centime)' },
];

// Les modèles qui acceptent le repli automatique côté serveur en cas de refus
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const SYSTEM = `Tu es un coach d'échecs bienveillant, précis et concret. Ton élève est francophone, classé environ 900 Elo sur chess.com, et vise 1600. Avec les Blancs il joue le Gambit Dame (1.d4 d5 2.c4), avec les Noirs la Caro-Kann (1.e4 c6), sans encore bien connaître la théorie.

Règles :
- Les analyses de Stockfish fournies sont la vérité. Ne contredis jamais leurs évaluations et n'invente aucune variante : chaque coup que tu cites doit apparaître dans les données fournies.
- La liste des pièces fait foi : vérifie où sont les pièces avant d'affirmer quoi que ce soit (« le fou attaque… »).
- Les coups sont en notation algébrique anglaise (K roi, Q dame, R tour, B fou, N cavalier) : cite-les tels quels, mais parle des pièces en français.
- Explique avec des mots simples et des idées concrètes adaptées à son niveau : pièces en prise, menaces, fourchettes, clouages, sécurité du roi, développement, centre, plans simples.
- Termine par une ligne « À retenir : … » avec un principe court et réutilisable.
- Réponds en français, en markdown simple (gras, listes), sans titre.`;

/** Vrai quand l'appli tourne dans claude.ai : le coach passe alors par le compte Claude du joueur. */
export const inClaudeViewer = () => typeof window !== 'undefined' && typeof window.claude?.use === 'function';

let samplePromise = null;
const getSample = () => (samplePromise ??= inClaudeViewer() ? window.claude.use('sample').catch(() => null) : Promise.resolve(null));

export const coachReady = () => !!db().settings.apiKey || inClaudeViewer();

function client() {
  return new Anthropic({ apiKey: db().settings.apiKey, dangerouslyAllowBrowser: true });
}

/** Décrit la position pour le modèle : FEN + liste des pièces par camp. */
export function describePosition(fen) {
  const c = safeChess(fen);
  if (!c) return `FEN : ${fen}`;
  const by = { w: [], b: [] };
  const order = 'kqrbnp';
  const all = [];
  for (const row of c.board()) for (const p of row) if (p) all.push(p);
  all.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  for (const p of all) by[p.color].push(`${NAME[p.type]} ${p.square}`);
  return [
    `FEN : ${fen}`,
    `Trait aux ${c.turn() === 'w' ? 'Blancs' : 'Noirs'}${c.inCheck() ? ' (en échec)' : ''}.`,
    `Pièces blanches : ${by.w.join(', ')}.`,
    `Pièces noires : ${by.b.join(', ')}.`,
  ].join('\n');
}

/**
 * Envoie une demande au coach en streaming.
 * onText(texteCumulé) est appelé au fil de l'eau. Renvoie le texte final.
 */
export async function askCoach(prompt, { effort = 'low', onText, maxTokens = 16000 } = {}) {
  if (!db().settings.apiKey && inClaudeViewer()) return askViaClaudeAi(prompt, { effort, onText });
  const { model } = db().settings;
  const params = {
    model,
    max_tokens: maxTokens,
    system: SYSTEM,
    output_config: { effort },
    messages: [{ role: 'user', content: prompt }],
  };
  let text = '';
  try {
    const stream = FALLBACK_MODELS.has(model)
      ? client().beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : client().messages.stream(params);
    stream.on('text', (delta) => {
      text += delta;
      onText?.(text);
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new Error('Le coach n’a pas pu répondre à cette demande. Réessaie en reformulant.');
    }
    return text;
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Clé API invalide : vérifie-la dans les Réglages.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Cette clé API n’a pas accès à ce modèle.';
  if (e instanceof Anthropic.RateLimitError) return 'Trop de demandes d’un coup : attends quelques secondes et réessaie.';
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit|balance/i.test(e.message)) return 'Crédit API épuisé : recharge ton compte sur console.anthropic.com.';
    return `Requête refusée : ${e.message}`;
  }
  if (e instanceof Anthropic.APIConnectionError) return 'Pas de connexion à Internet (le coach IA a besoin du réseau).';
  if (e instanceof Anthropic.APIError) return `Erreur du service (${e.status}). Réessaie plus tard.`;
  return e?.message || String(e);
}

const SAMPLE_ERRORS = {
  not_granted: 'Tu n’as pas autorisé l’appli à utiliser Claude. Recharge la page pour qu’elle te le redemande.',
  sampling_disabled: 'Claude n’est pas disponible pour ce compte.',
  rate_limited: 'Limite d’utilisation de Claude atteinte pour le moment : réessaie un peu plus tard.',
  session_expired: 'Ta session claude.ai a expiré : reconnecte-toi.',
  refused: 'Le coach n’a pas pu répondre à cette demande.',
  prompt_too_large: 'Demande trop longue pour le coach.',
};

/** Dans claude.ai : le coach utilise le compte Claude du joueur (aucune clé API nécessaire). */
async function askViaClaudeAi(prompt, { effort, onText }) {
  const sample = await getSample();
  if (!sample) throw new Error('Le coach IA n’est pas disponible ici : ajoute une clé API dans les Réglages.');
  try {
    const { text } = await sample(`${SYSTEM}\n\n---\n\n${prompt}`, {
      modelTier: effort === 'medium' ? 'complex' : 'default',
      effort,
      onText: ({ text: t }) => onText?.(t),
    });
    return text;
  } catch (e) {
    throw new Error(SAMPLE_ERRORS[e?.code] || 'Le coach n’a pas pu répondre (erreur passagère). Réessaie dans un instant.');
  }
}

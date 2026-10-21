// Panneau « coach » : explication maison immédiate + bouton pour l'explication IA (Claude).
import { md, esc, toast } from '../ui.js';
import { askCoach, coachReady } from '../coach-ai.js';
import { aiEnabled } from '../local-coach.js';

/**
 * Remplit `el` avec une explication. getPrompt() fabrique la demande IA (appelée seulement au clic).
 * Renvoie une fonction pour vider le panneau.
 */
export function showCoach(el, { title = '', paragraphs = [], getPrompt = null, effort = 'low' } = {}) {
  el.hidden = false;
  el.innerHTML = `
    ${title ? `<div class="coach-title">${title}</div>` : ''}
    <div class="coach-txt">${md(paragraphs.join('\n'))}</div>
    <div class="coach-ai" hidden></div>
    ${getPrompt && aiEnabled() ? '<button class="btn ai small" data-ai>✨ Explication détaillée du coach IA</button>' : ''}`;
  const btn = el.querySelector('[data-ai]');
  btn?.addEventListener('click', async () => {
    if (!coachReady()) {
      toast('Ajoute ta clé API Claude dans les Réglages (⚙︎) pour activer le coach IA.', 4000);
      return;
    }
    const out = el.querySelector('.coach-ai');
    out.hidden = false;
    out.innerHTML = '<p class="muted">Le coach réfléchit…</p>';
    btn.disabled = true;
    try {
      const prompt = await getPrompt();
      await askCoach(prompt, { effort, onText: (t) => (out.innerHTML = md(t)) });
      btn.remove();
    } catch (e) {
      out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      btn.disabled = false;
    }
  });
  return () => {
    el.innerHTML = '';
    el.hidden = true;
  };
}

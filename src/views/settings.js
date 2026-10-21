import { db, update, exportData, importData, resetAll } from '../storage.js';
import { setTitle, esc, toast, confirmDialog, md } from '../ui.js';
import { MODELS, askCoach } from '../coach-ai.js';

export const tab = 'settings';

export function render(root) {
  setTitle('Réglages', '#/');
  const s = db();
  root.innerHTML = `
    <section class="card">
      <h2>✨ Coach IA (Claude)</h2>
      <p class="small">Facultatif : sans clé, l’appli explique déjà les coups avec Stockfish et ses propres règles. Avec une clé API Claude, tu obtiens en plus des explications rédigées par un vrai coach, des bilans de partie et des réponses à tes questions.</p>
      <p class="small muted">Crée une clé sur <b>console.anthropic.com</b> → « API Keys ». La clé reste sur ton téléphone et n’est envoyée qu’à api.anthropic.com. Mets une limite de dépense mensuelle dans la console pour garder le contrôle.</p>
      <label>Clé API<input id="key" type="password" placeholder="sk-ant-…" value="${esc(s.settings.apiKey)}" autocomplete="off"/></label>
      <label>Modèle<select id="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.settings.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <div class="row"><button class="btn primary" id="save-key">Enregistrer</button><button class="btn" id="test">Tester</button></div>
      <div id="test-out"></div>
    </section>
    <section class="card">
      <h2>Profil</h2>
      <label>Elo de départ<input id="start" type="number" value="${s.profile.startElo}"/></label>
      <label>Objectif<input id="goal" type="number" value="${s.profile.goalElo}"/></label>
      <label>Pseudo chess.com<input id="cc" value="${esc(s.profile.chesscomUser)}" autocapitalize="off"/></label>
      <label class="switch"><input type="checkbox" id="sound" ${s.settings.sound ? 'checked' : ''}/> Sons</label>
      <button class="btn" id="save-profile">Enregistrer</button>
    </section>
    <section class="card">
      <h2>Sauvegarde</h2>
      <p class="small muted">Tes données (parties, progrès, erreurs) sont stockées uniquement sur ce téléphone. Exporte-les de temps en temps.</p>
      <div class="row wrap">
        <button class="btn" id="export">⬇ Exporter</button>
        <label class="btn">⬆ Importer<input type="file" id="import" accept="application/json" hidden/></label>
        <button class="btn ghost danger" id="reset">Tout effacer</button>
      </div>
    </section>
    <section class="card small muted">
      <h2>À propos</h2>
      <p>Coach Échecs — appli personnelle et libre (GPL-3.0). Moteur : Stockfish 18 (GPL-3.0), échiquier : Chessground (Lichess, GPL-3.0), règles : chess.js, pièces : cburnett (CC BY-SA 3.0). Exercices en ligne : base de puzzles Lichess (CC0).</p>
    </section>`;

  root.querySelector('#save-key').onclick = () => {
    update((d) => {
      d.settings.apiKey = root.querySelector('#key').value.trim();
      d.settings.model = root.querySelector('#model').value;
    });
    toast('Enregistré ✓');
  };
  root.querySelector('#test').onclick = async () => {
    root.querySelector('#save-key').click();
    const out = root.querySelector('#test-out');
    out.innerHTML = '<p class="muted">Test en cours…</p>';
    try {
      await askCoach('Dis bonjour en une phrase et donne-moi un conseil d’échecs pour un joueur de 900 Elo (une seule ligne).', { onText: (t) => (out.innerHTML = md(t)) });
    } catch (e) {
      out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  };
  root.querySelector('#save-profile').onclick = () => {
    update((d) => {
      d.profile.startElo = +root.querySelector('#start').value || 900;
      d.profile.goalElo = +root.querySelector('#goal').value || 1600;
      d.profile.chesscomUser = root.querySelector('#cc').value.trim();
      d.settings.sound = root.querySelector('#sound').checked;
    });
    toast('Enregistré ✓');
  };
  root.querySelector('#export').onclick = () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coach-echecs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  root.querySelector('#import').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      importData(await f.text());
      toast('Données importées ✓');
      render(root);
    } catch {
      toast('Fichier invalide.');
    }
  };
  root.querySelector('#reset').onclick = async () => {
    if (await confirmDialog('Effacer toutes tes données (parties, progrès, erreurs) ? La clé API est conservée.', 'Tout effacer')) {
      resetAll();
      toast('Données effacées.');
      render(root);
    }
  };
}

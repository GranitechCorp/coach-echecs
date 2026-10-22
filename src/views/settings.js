import { db, update, exportData, importData, resetAll } from '../storage.js';
import { setTitle, esc, toast, confirmDialog, md } from '../ui.js';
import { MODELS, askCoach, inClaudeViewer } from '../coach-ai.js';

export const tab = 'settings';

export function render(root) {
  setTitle('Réglages', '#/');
  const s = db();
  root.innerHTML = `
    <section class="card">
      <h2>Repérage sur l’échiquier</h2>
      <label class="switch"><input type="checkbox" id="sq-names" ${s.settings.squareNames !== false ? 'checked' : ''}/> Afficher le nom de la case que je touche</label>
      <p class="small muted">Sur tous les échiquiers, une petite étiquette (« e4 ») apparaît une seconde au-dessus de la case touchée.</p>
      <label class="switch"><input type="checkbox" id="sq-coords" ${s.settings.coordsOnSquares === true ? 'checked' : ''}/> Écrire les coordonnées dans toutes les cases</label>
      <p class="small muted">Pratique au début pour lire les coups. Désactive-le dès que tu te sens prêt : le but est de t’en passer.</p>
      <a class="btn block" href="#/vision">👁 S’entraîner à repérer les cases</a>
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
      <h2>✨ Coach IA (Claude) — facultatif</h2>
      <label class="switch"><input type="checkbox" id="ai-on" ${s.settings.aiEnabled ? 'checked' : ''}/> Afficher les boutons ✨ du coach IA</label>
      <p class="small muted">Désactivé, l’appli fonctionne à 100 % en local : Stockfish analyse, et les explications, bilans, diagnostic et programme sont rédigés par l’appli elle-même. Claude n’est jamais utilisé tant que tu n’appuies pas sur un bouton ✨.</p>
      ${inClaudeViewer() ? '<p class="small"><b>Tu utilises l’appli dans claude.ai : le coach IA passe par ton compte Claude, aucune clé n’est nécessaire.</b> La première fois, claude.ai te demande l’autorisation. Laisse le champ ci-dessous vide.</p>' : ''}
      <p class="small">Facultatif : sans clé, l’appli explique déjà les coups avec Stockfish et ses propres règles. Avec une clé API Claude, tu obtiens en plus des explications rédigées par un vrai coach, des bilans de partie et des réponses à tes questions.</p>
      <p class="small muted">Crée une clé sur <b>console.anthropic.com</b> → « API Keys ». La clé reste sur ton téléphone et n’est envoyée qu’à api.anthropic.com. Mets une limite de dépense mensuelle dans la console pour garder le contrôle.</p>
      <label>Clé API<input id="key" type="password" placeholder="sk-ant-…" value="${esc(s.settings.apiKey)}" autocomplete="off"/></label>
      <label>Modèle<select id="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.settings.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <div class="row"><button class="btn primary" id="save-key">Enregistrer</button><button class="btn" id="test">Tester</button></div>
      <div id="test-out"></div>
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

  root.querySelector('#ai-on').onchange = (e) => {
    update((d) => (d.settings.aiEnabled = e.target.checked));
    toast(e.target.checked ? 'Coach IA activé' : 'Mode 100 % local');
  };
  root.querySelector('#sq-names').onchange = (e) => {
    update((d) => (d.settings.squareNames = e.target.checked));
    toast(e.target.checked ? 'Nom de la case affiché au toucher ✓' : 'Nom de la case masqué');
  };
  root.querySelector('#sq-coords').onchange = (e) => {
    update((d) => (d.settings.coordsOnSquares = e.target.checked));
    toast(e.target.checked ? 'Coordonnées dans toutes les cases ✓' : 'Coordonnées seulement sur les bords');
  };
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
  root.querySelector('#export').onclick = async () => {
    const filename = `coach-echecs-${new Date().toISOString().slice(0, 10)}.json`;
    if (inClaudeViewer()) {
      const downloads = await window.claude.use('downloads');
      if (!downloads) return toast('Export indisponible ici.');
      try {
        await downloads.save({ filename, data: exportData() });
        toast('Sauvegarde enregistrée ✓');
      } catch (e) {
        if (e?.code !== 'declined') toast('Export impossible.');
      }
      return;
    }
    const blob = new Blob([exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
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

// Petits outils d'interface partagés par les écrans.
import { fig, winPct, cpWhite, evalText } from './chessutil.js';
import { CLASSES } from './explain.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Markdown minimal : paragraphes, listes, **gras**, *italique*. Le texte est échappé d'abord. */
export function md(text) {
  const lines = esc(text).split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+\.)\s+(.*)/);
    if (item) {
      if (!inList) html += '<ul>';
      inList = true;
      html += `<li>${inline(item[1])}</li>`;
      continue;
    }
    if (inList) {
      html += '</ul>';
      inList = false;
    }
    if (!line) continue;
    const h = line.match(/^#{1,4}\s+(.*)/);
    html += h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}
const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

export function setTitle(title, back = null) {
  document.getElementById('page-title').textContent = title;
  const b = document.getElementById('back-btn');
  b.hidden = !back;
  b.onclick = back ? () => (typeof back === 'string' ? (location.hash = back) : back()) : null;
}

/** Barre d'évaluation verticale. */
export function evalBarHtml() {
  return '<div class="evalbar" hidden><div class="evalbar-fill"></div><span class="evalbar-txt"></span></div>';
}
export function setEvalBar(root, line, orientation = 'white') {
  const bar = root.querySelector('.evalbar');
  if (!bar || !line) return;
  const w = winPct(cpWhite(line));
  const fill = bar.querySelector('.evalbar-fill');
  fill.style.height = `${orientation === 'white' ? w : 100 - w}%`;
  bar.classList.toggle('flipped', orientation !== 'white');
  bar.querySelector('.evalbar-txt').textContent = evalText(line);
}

/** Liste de coups cliquable. moves : [{san, cls?}] ; current : index du coup affiché (-1 = départ). */
export function moveListHtml(moves, current, startMoveNo = 1, startTurn = 'w') {
  let html = '';
  let num = startMoveNo;
  let turn = startTurn;
  moves.forEach((m, i) => {
    if (turn === 'w') html += `<span class="mnum">${num}.</span>`;
    else if (i === 0) html += `<span class="mnum">${num}…</span>`;
    const c = m.cls ? CLASSES[m.cls] : null;
    html += `<button class="mv ${i === current ? 'cur' : ''} ${c ? 'c-' + c.css : ''}" data-i="${i}">${fig(m.san)}${c && ['inaccuracy', 'mistake', 'blunder', 'best'].includes(m.cls) ? `<sup>${c.sym}</sup>` : ''}</button>`;
    if (turn === 'b') num++;
    turn = turn === 'w' ? 'b' : 'w';
  });
  return html;
}

export function classBadge(cls) {
  const c = CLASSES[cls];
  return c ? `<span class="badge c-${c.css}">${c.sym} ${c.label}</span>` : '';
}

/** Boîte de dialogue simple (confirmation). */
export function confirmDialog(text, okLabel = 'OK', cancelLabel = 'Annuler') {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="modal-box"><p>${esc(text)}</p><div class="row end"><button class="btn ghost" data-r="0">${esc(cancelLabel)}</button><button class="btn primary" data-r="1">${esc(okLabel)}</button></div></div>`;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b && e.target !== d) return;
      d.remove();
      resolve(b?.dataset.r === '1');
    });
    document.body.appendChild(d);
  });
}

/** Petit son de coup (synthétisé, aucun fichier à télécharger). */
let audioCtx = null;
export function moveSound(capture = false) {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.value = capture ? 220 : 330;
    g.gain.setValueAtTime(0.18, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.09);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.1);
  } catch {
    /* pas de son, pas grave */
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

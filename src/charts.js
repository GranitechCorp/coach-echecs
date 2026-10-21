// Petits graphiques SVG sans bibliothèque : barres de compétences et courbe avec info-bulle au toucher.
import { esc } from './ui.js';

/** Barres horizontales 0-100 (une seule teinte, valeurs écrites en clair). */
export function skillBars(rows) {
  return `<div class="skills">${rows
    .map(
      (r) => `<details class="skill">
        <summary><span class="skill-label">${esc(r.label)}</span>
          <span class="skill-track">${r.value === null ? '' : `<span class="skill-fill" style="width:${Math.max(2, r.value)}%"></span>`}</span>
          <span class="skill-val">${r.value === null ? '—' : r.value}</span></summary>
        <p class="muted small">${esc(r.help)}${r.value === null ? ' Pas encore assez de parties analysées pour cette mesure.' : ''}</p>
      </details>`,
    )
    .join('')}</div>`;
}

/**
 * Courbe simple. points : [{ y, label }] (label = texte de l'info-bulle).
 * Renvoie le HTML ; appeler ensuite attachLineTooltip(conteneur, points).
 */
export function lineChart(points, { height = 140, yLabel = '', fmt = (v) => String(Math.round(v)) } = {}) {
  if (points.length < 2) return '<p class="muted small">Pas encore assez de données.</p>';
  const W = 320;
  const H = height;
  const P = { l: 34, r: 8, t: 10, b: 18 };
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.1;
  min -= pad;
  max += pad;
  const x = (i) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const ticks = [min + pad, (min + max) / 2, max - pad];
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  return `<div class="chart" data-n="${points.length}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)}">
      ${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${P.l - 4}" y="${y(t) + 3}" class="tick" text-anchor="end">${esc(fmt(t))}</text>`).join('')}
      <path d="${path}" class="line"/>
      <circle r="4" class="end" cx="${x(points.length - 1)}" cy="${y(points.at(-1).y)}"/>
      <line class="cross" y1="${P.t}" y2="${H - P.b}" x1="-10" x2="-10"/>
      <circle class="hover" r="5" cx="-10" cy="-10"/>
      <text x="${P.l}" y="${H - 4}" class="tick">${esc(points[0].x || '')}</text>
      <text x="${W - P.r}" y="${H - 4}" class="tick" text-anchor="end">${esc(points.at(-1).x || '')}</text>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}

export function attachLineTooltip(container, points, { height = 140 } = {}) {
  const chart = container.querySelector('.chart');
  if (!chart || points.length < 2) return;
  const svg = chart.querySelector('svg');
  const tip = chart.querySelector('.tip');
  const W = 320;
  const P = { l: 34, r: 8, t: 10, b: 18 };
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.1;
  min -= pad;
  max += pad;
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((vx - P.l) / (W - P.l - P.r)) * (points.length - 1))));
    const cx = P.l + (i / (points.length - 1)) * (W - P.l - P.r);
    const cy = P.t + (1 - (points[i].y - min) / (max - min)) * (height - P.t - P.b);
    svg.querySelector('.cross').setAttribute('x1', cx);
    svg.querySelector('.cross').setAttribute('x2', cx);
    const h = svg.querySelector('.hover');
    h.setAttribute('cx', cx);
    h.setAttribute('cy', cy);
    tip.hidden = false;
    tip.textContent = points[i].label;
    const left = (cx / W) * r.width;
    tip.style.left = `${Math.min(r.width - 150, Math.max(0, left - 75))}px`;
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => (tip.hidden = true));
}

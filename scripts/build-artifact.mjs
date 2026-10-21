// Construit la version « page claude.ai » (Artifact) à partir du build Vite :
// une seule page HTML avec le CSS et le JS intégrés, plus les fichiers du moteur Stockfish.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'artifact');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8')).join('\n');
const js = [...html.matchAll(/<script type="module"[^>]*src="\.?\/?([^"]+)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8')).join('\n');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').trim();
const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/\uFFFD/g, '\\uFFFD');
const safeCss = css.replace(/<\/style/gi, '<\\/style');

mkdirSync(join(out, 'engine'), { recursive: true });
writeFileSync(
  join(out, 'coach-echecs.html'),
  `<title>Coach Échecs</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${safeCss}</style>
${body}
<script type="module">${safeJs}</script>
`,
);
for (const f of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) copyFileSync(join(root, 'public', 'engine', f), join(out, 'engine', f));
console.log('artifact/coach-echecs.html', Math.round((safeCss.length + safeJs.length) / 1024), 'Ko');

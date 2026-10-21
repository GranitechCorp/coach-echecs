// Pilote Stockfish depuis Node (pour les scripts de vérification du contenu).
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = join(here, '..', 'public', 'engine');

export class NodeEngine {
  constructor() {
    // le paquet est en "type": "module" : on copie le moteur en .cjs dans un dossier temporaire
    const dir = mkdtempSync(join(tmpdir(), 'sf-'));
    copyFileSync(join(ENGINE_DIR, 'stockfish-18-lite-single.js'), join(dir, 'sf.cjs'));
    copyFileSync(join(ENGINE_DIR, 'stockfish-18-lite-single.wasm'), join(dir, 'sf.wasm'));
    this.proc = spawn(process.execPath, [join(dir, 'sf.cjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buf = '';
    this.listeners = new Set();
    this.proc.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        for (const l of [...this.listeners]) l(line);
      }
    });
    this.queue = this.init();
  }
  send(c) {
    this.proc.stdin.write(c + '\n');
  }
  wait(pred) {
    return new Promise((res) => {
      const f = (l) => {
        if (pred(l)) {
          this.listeners.delete(f);
          res(l);
        }
      };
      this.listeners.add(f);
    });
  }
  async init() {
    this.send('uci');
    await this.wait((l) => l === 'uciok');
    this.send('setoption name Hash value 64');
    this.send('isready');
    await this.wait((l) => l === 'readyok');
  }
  /** Renvoie [{ pv, cp, mate }] du point de vue du camp au trait, triées par multipv. */
  analyse(fen, { depth = 16, multipv = 1 } = {}) {
    const job = this.queue.then(async () => {
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send('isready');
      await this.wait((l) => l === 'readyok');
      this.send(`position fen ${fen}`);
      const lines = [];
      const done = new Promise((res) => {
        const f = (l) => {
          if (l.startsWith('info') && l.includes(' pv ') && !l.includes('bound')) {
            const t = l.split(' ');
            const mpv = +t[t.indexOf('multipv') + 1] || 1;
            const si = t.indexOf('score');
            const s = { pv: t.slice(t.indexOf('pv') + 1) };
            if (t[si + 1] === 'mate') s.mate = +t[si + 2];
            else s.cp = +t[si + 2];
            lines[mpv - 1] = s;
          } else if (l.startsWith('bestmove')) {
            this.listeners.delete(f);
            res(lines.filter(Boolean));
          }
        };
        this.listeners.add(f);
      });
      this.send(`go depth ${depth}`);
      return done;
    });
    this.queue = job.catch(() => {});
    return job;
  }
  quit() {
    this.send('quit');
  }
}

/** Score comparable (côté au trait) : les mats valent ±10000. */
export const scoreOf = (l) => (l.mate !== undefined ? (l.mate > 0 ? 10000 - l.mate : -10000 - l.mate) : l.cp);

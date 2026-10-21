// Enveloppe UCI autour de Stockfish 18 (WASM, mono-thread) lancé dans un Web Worker.
// Les recherches passent par une file d'attente : une seule à la fois par instance.

const ENGINE_URL = 'engine/stockfish-18-lite-single.js';

function parseInfo(line, stm) {
  const tok = line.split(' ');
  const info = { depth: 0, multipv: 1, score: null, pv: [] };
  for (let i = 1; i < tok.length; i++) {
    const t = tok[i];
    if (t === 'depth') info.depth = +tok[++i];
    else if (t === 'multipv') info.multipv = +tok[++i];
    else if (t === 'score') {
      const kind = tok[++i];
      const val = +tok[++i];
      // on ignore lowerbound / upperbound : la ligne finale est toujours exacte
      if (tok[i + 1] === 'lowerbound' || tok[i + 1] === 'upperbound') return null;
      info.score = kind === 'mate' ? { mate: val } : { cp: val };
    } else if (t === 'pv') {
      info.pv = tok.slice(i + 1);
      break;
    }
  }
  if (!info.score || !info.pv.length) return null;
  // score du point de vue des Blancs, plus pratique pour l'affichage
  const sign = stm === 'w' ? 1 : -1;
  info.white = info.score.mate !== undefined ? { mate: info.score.mate * sign } : { cp: info.score.cp * sign };
  return info;
}

export class Engine {
  constructor(name = 'moteur') {
    this.name = name;
    this.worker = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      for (const l of [...this.listeners]) l(e.data);
    };
    this.ready = (async () => {
      this.send('uci');
      await this.waitFor((l) => l === 'uciok');
      this.send('setoption name Hash value 32');
      this.send('isready');
      await this.waitFor((l) => l === 'readyok');
    })();
    return this.ready;
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(pred) {
    return new Promise((resolve) => {
      const f = (l) => {
        if (pred(l)) {
          this.listeners.delete(f);
          resolve(l);
        }
      };
      this.listeners.add(f);
    });
  }

  /**
   * Lance une recherche.
   * opts : depth, movetime, multipv (1), elo (limite la force), onInfo(lines), signal (AbortSignal)
   * Renvoie { bestmove, lines: [{multipv, depth, score, white, pv}] , aborted }
   */
  search(fen, opts = {}) {
    const job = this.queue.then(() => this._run(fen, opts));
    this.queue = job.catch(() => {});
    return job;
  }

  async _run(fen, { depth, movetime, multipv = 1, elo = null, onInfo, signal } = {}) {
    await this.start();
    if (signal?.aborted) return { bestmove: null, lines: [], aborted: true };
    this.send(`setoption name MultiPV value ${multipv}`);
    if (elo) {
      this.send('setoption name UCI_LimitStrength value true');
      this.send(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, elo))}`);
    } else {
      this.send('setoption name UCI_LimitStrength value false');
    }
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
    this.send(`position fen ${fen}`);
    const stm = fen.split(' ')[1];
    const lines = [];
    return new Promise((resolve) => {
      const onAbort = () => this.send('stop');
      signal?.addEventListener('abort', onAbort, { once: true });
      const f = (line) => {
        if (line.startsWith('info') && line.includes(' pv ')) {
          const info = parseInfo(line, stm);
          if (info) {
            lines[info.multipv - 1] = info;
            onInfo?.(lines.filter(Boolean));
          }
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(f);
          signal?.removeEventListener('abort', onAbort);
          const bm = line.split(' ')[1];
          resolve({
            bestmove: bm && bm !== '(none)' ? bm : null,
            lines: lines.filter(Boolean).sort((a, b) => a.multipv - b.multipv),
            aborted: !!signal?.aborted,
          });
        }
      };
      this.listeners.add(f);
      let go = 'go';
      if (depth) go += ` depth ${depth}`;
      if (movetime) go += ` movetime ${movetime}`;
      if (!depth && !movetime) go += ' depth 14';
      this.send(go);
    });
  }

  newGame() {
    this.queue = this.queue.then(async () => {
      await this.start();
      this.send('ucinewgame');
    });
  }
}

// Deux moteurs : un pour l'adversaire, un pour l'analyse (indices, bilans),
// pour qu'un indice ne bloque jamais le coup de l'ordinateur.
let botEngine = null;
let analysisEngine = null;
export const getBotEngine = () => (botEngine ??= new Engine('adversaire'));
export const getAnalysisEngine = () => (analysisEngine ??= new Engine('analyse'));

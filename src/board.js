// Échiquier tactile (Chessground, celui de Lichess) relié à une partie chess.js.
import { Chessground } from '@lichess-org/chessground';
import { toDests, cgColor, parseUci } from './chessutil.js';

/**
 * el : conteneur ; opts : { orientation: 'white'|'black', onMove(uci), interactive(chess) → bool }
 * Le plateau ne modifie jamais la partie lui-même : il appelle onMove, l'appelant décide.
 */
export function createBoard(el, { orientation = 'white', onMove } = {}) {
  el.classList.add('board');
  const inner = document.createElement('div');
  inner.className = 'cg-host';
  el.appendChild(inner);
  let chess = null;
  let interactiveColor = null;
  let pendingPromo = null;

  const cg = Chessground(inner, {
    orientation,
    coordinates: true,
    animation: { enabled: true, duration: 180 },
    highlight: { lastMove: true, check: true },
    movable: { free: false, color: undefined, showDests: true, events: { after: handleMove } },
    premovable: { enabled: false },
    draggable: { enabled: true, showGhost: true },
    drawable: { enabled: true, eraseOnMovablePieceClick: true },
  });

  function handleMove(orig, dest) {
    if (!chess) return;
    const piece = chess.get(orig);
    const isPromo = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1');
    if (isPromo) {
      askPromotion(orig, dest, piece.color);
      return;
    }
    onMove?.(orig + dest);
  }

  function askPromotion(orig, dest, color) {
    pendingPromo?.remove();
    const box = document.createElement('div');
    box.className = 'promo';
    box.innerHTML = ['q', 'r', 'b', 'n']
      .map((t) => `<button data-p="${t}"><piece class="${cgColor(color)} ${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[t]}"></piece></button>`)
      .join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      box.remove();
      pendingPromo = null;
      if (b) onMove?.(orig + dest + b.dataset.p);
      else sync();
    });
    el.appendChild(box);
    pendingPromo = box;
  }

  /** Synchronise l'affichage avec la partie. */
  function sync(lastMoveUci) {
    if (!chess) return;
    const turn = chess.turn();
    const canMove = interactiveColor === 'both' || interactiveColor === turn;
    const hist = chess.history({ verbose: true });
    const last = lastMoveUci ? parseUci(lastMoveUci) : hist.at(-1);
    cg.set({
      fen: chess.fen(),
      turnColor: cgColor(turn),
      check: chess.inCheck() ? cgColor(turn) : false,
      lastMove: last ? [last.from, last.to] : undefined,
      movable: {
        color: canMove && !chess.isGameOver() ? cgColor(turn) : undefined,
        dests: canMove && !chess.isGameOver() ? toDests(chess) : new Map(),
      },
    });
  }

  return {
    cg,
    /** Affiche la partie. interactive : 'w' | 'b' | 'both' | null */
    setPosition(c, { interactive = null, lastMove } = {}) {
      chess = c;
      interactiveColor = interactive;
      sync(lastMove);
    },
    sync,
    setInteractive(color) {
      interactiveColor = color;
      sync();
    },
    /** Flèches/cercles : [{orig, dest?, brush: 'green'|'red'|'blue'|'yellow'}] */
    setShapes(shapes) {
      cg.setAutoShapes(shapes || []);
    },
    flip() {
      cg.toggleOrientation();
    },
    get orientation() {
      return cg.state.orientation;
    },
    set orientation(o) {
      cg.set({ orientation: o });
    },
    destroy() {
      cg.destroy();
      el.innerHTML = '';
    },
  };
}

/** Flèche depuis un coup UCI. */
export const arrow = (uci, brush = 'green') => ({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush });

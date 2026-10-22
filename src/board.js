// Échiquier tactile (Chessground, celui de Lichess) relié à une partie chess.js.
import { Chessground } from '@lichess-org/chessground';
import { toDests, cgColor, parseUci } from './chessutil.js';
import { db } from './storage.js';

/**
 * el : conteneur ; opts : { orientation: 'white'|'black', onMove(uci), interactive(chess) → bool }
 * coordinates : false pour un plateau sans lettres ni chiffres (exercices de vision) ;
 * squareNames : false pour couper l'aide « nom de la case » (sinon elle suit le réglage).
 * Le plateau ne modifie jamais la partie lui-même : il appelle onMove, l'appelant décide.
 */
export function createBoard(el, { orientation = 'white', onMove, coordinates = true, squareNames = true } = {}) {
  el.classList.add('board');
  const inner = document.createElement('div');
  inner.className = 'cg-host';
  el.appendChild(inner);
  let chess = null;
  let interactiveColor = null;
  let pendingPromo = null;

  const settings = db().settings || {};
  const cg = Chessground(inner, {
    orientation,
    coordinates,
    coordinatesOnSquares: coordinates && settings.coordsOnSquares === true,
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

  const stopNames = squareNames ? attachSquareNames(el, cg) : null;
  // Chessground garde en cache la position du plateau à l'écran : si le texte au-dessus change de hauteur (question
  // sur deux lignes, message d'erreur), elle devient fausse et le doigt tomberait sur la mauvaise case.
  // On la fait relire juste avant chaque toucher.
  const refreshBounds = () => cg.state.dom.bounds.clear();
  for (const ev of ['touchstart', 'mousedown']) el.addEventListener(ev, refreshBounds, { capture: true, passive: true });

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
      stopNames?.();
      cg.destroy();
      el.innerHTML = '';
    },
  };
}

/**
 * Aide au repérage : toucher (ou glisser sur) une case affiche son nom une seconde, juste au-dessus.
 * Suit le réglage db().settings.squareNames (actif sauf s'il vaut false), relu à chaque toucher.
 */
function attachSquareNames(el, cg) {
  const tag = document.createElement('div');
  tag.className = 'sq-name';
  tag.setAttribute('aria-hidden', 'true');
  let pressed = false;
  let shown = null;
  let timer = null;
  const hit = (e) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    const x = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const y = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    const white = cg.state.orientation !== 'black';
    return { key: 'abcdefgh'[white ? x : 7 - x] + (white ? 8 - y : y + 1), x, y, size: r.width / 8 };
  };
  const show = (h) => {
    if (!h || h.key === shown) return;
    shown = h.key;
    tag.textContent = h.key;
    if (tag.parentNode !== el) el.appendChild(tag);
    // au-dessus de la case (le doigt la cache) ; en dessous pour la rangée du haut
    const above = h.y > 0;
    tag.style.left = `${(h.x + 0.5) * h.size}px`;
    tag.style.top = `${above ? h.y * h.size - 2 : (h.y + 1) * h.size + 2}px`;
    tag.classList.toggle('below', !above);
    tag.classList.add('on');
  };
  const hideSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      tag.classList.remove('on');
      shown = null;
    }, 1000);
  };
  const onDown = (e) => {
    if (db().settings.squareNames === false || (e.button ?? 0) > 0 || e.target.closest?.('.promo')) return;
    pressed = true;
    shown = null;
    show(hit(e));
    hideSoon();
  };
  const onMoveOver = (e) => {
    if (!pressed) return;
    const h = hit(e);
    if (h && h.key !== shown) {
      show(h);
      hideSoon();
    }
  };
  const onUp = () => {
    if (!pressed) return;
    pressed = false;
    hideSoon();
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMoveOver);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  return () => {
    clearTimeout(timer);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMoveOver);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    tag.remove();
  };
}

/** Flèche depuis un coup UCI. */
export const arrow = (uci, brush = 'green') => ({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush });

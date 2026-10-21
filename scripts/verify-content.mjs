// Vérifie tout le contenu pédagogique avec chess.js et Stockfish :
//  - ouvertures : coups légaux, et aucun coup de « ton » camp ne perd plus de 0,6 pion ;
//  - cours : positions légales, solutions légales, et la solution est bien le meilleur coup.
// Usage : npm run check   (option --fast : profondeur réduite)
import { Chess } from 'chess.js';
import { NodeEngine, scoreOf } from './uci.mjs';
import { OPENING_LINES, OPENING_GROUPS, parseLine } from '../src/data/openings.js';
import { LESSONS } from '../src/data/lessons.js';
import { stepFen } from '../src/chessutil.js';

const fast = process.argv.includes('--fast');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const DEPTH = fast ? 12 : 16;
const engine = new NodeEngine();
let errors = 0;
const fail = (msg) => {
  errors++;
  console.log('  ✗ ' + msg);
};

async function checkOpenings() {
  console.log(`\n== Ouvertures (${OPENING_LINES.length} lignes) ==`);
  for (const line of OPENING_LINES) {
    if (only && !line.id.includes(only)) continue;
    const side = OPENING_GROUPS.find((g) => g.id === line.group).side;
    const c = new Chess();
    const moves = parseLine(line.moves);
    let ok = true;
    for (const [i, mv] of moves.entries()) {
      const mover = c.turn();
      const before = c.fen();
      let m;
      try {
        m = c.move(mv.san);
      } catch {
        fail(`${line.id} : coup illégal ${mv.san} (coup ${i + 1})`);
        ok = false;
        break;
      }
      if (mover === side) {
        const [best] = await engine.analyse(before, { depth: DEPTH });
        const [after] = c.isGameOver() ? [{ cp: c.isCheckmate() ? -10000 : 0, pv: [] }] : await engine.analyse(c.fen(), { depth: DEPTH });
        const drop = scoreOf(best) - -scoreOf(after);
        if (drop > 60) fail(`${line.id} : ${Math.ceil(i / 2 + 0.5)}${mover === 'w' ? '.' : '…'}${m.san} perd ${drop} cp (meilleur : ${best.pv[0]})`);
      }
    }
    if (ok) {
      const [fin] = c.isGameOver() ? [{ cp: 0 }] : await engine.analyse(c.fen(), { depth: DEPTH });
      const forSide = (c.turn() === side ? 1 : -1) * scoreOf(fin);
      console.log(`  ${forSide < -80 ? '⚠' : '✓'} ${line.id} (${moves.length} demi-coups, éval. finale pour toi : ${forSide})`);
      if (forSide < -80) fail(`${line.id} : position finale défavorable (${forSide})`);
    }
  }
}

async function checkLessons() {
  console.log(`\n== Cours (${LESSONS.length} leçons) ==`);
  for (const lesson of LESSONS) {
    if (only && !lesson.id.includes(only)) continue;
    let n = 0;
    for (const step of lesson.steps) {
      let c;
      try {
        const fen = stepFen(step);
        if (!fen) continue;
        c = new Chess(fen);
      } catch (e) {
        fail(`${lesson.id} : position invalide ${step.fen || step.moves} (${e.message})`);
        continue;
      }
      if (step.type === 'puzzle') {
        n++;
        // chaque coup « à trouver » doit être le meilleur (ou aussi bon)
        for (let i = 0; i < step.solution.length; i++) {
          const uci = step.solution[i];
          const fen = c.fen();
          if (i % 2 === 0) {
            const lines = await engine.analyse(fen, { depth: DEPTH, multipv: 2 });
            if (!lines.length) {
              fail(`${lesson.id} : aucune analyse (partie finie ?) — ${fen}`);
              break;
            }
            const best = lines[0];
            const second = lines[1];
            const bs = scoreOf(best);
            const legal = c.moves({ verbose: true }).find((m) => m.from + m.to + (m.promotion || '') === uci);
            if (!legal) {
              fail(`${lesson.id} : solution illégale ${uci} dans ${fen}`);
              break;
            }
            const c2 = new Chess(fen);
            c2.move(legal);
            let mine;
            if (c2.isCheckmate()) mine = 10000;
            else if (c2.isGameOver()) mine = 0;
            else mine = -scoreOf((await engine.analyse(c2.fen(), { depth: DEPTH }))[0]);
            if (bs - mine > 40 && !(bs > 9000 && mine > 9000)) fail(`${lesson.id} : ${uci} n'est pas le meilleur (${mine} contre ${bs} pour ${best.pv[0]}) — ${fen}`);
            if (!step.allowOthers && second && i === 0 && scoreOf(second) > bs - 120 && !(bs > 9000 && scoreOf(second) < 9000) && bs < 9000) {
              console.log(`    ⚠ ${lesson.id} : solution non unique (${best.pv[0]} ${bs} / ${second.pv[0]} ${scoreOf(second)}) — ${fen}`);
            }
          }
          try {
            c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
          } catch {
            fail(`${lesson.id} : coup ${uci} illégal dans la suite`);
            break;
          }
        }
      }
    }
    console.log(`  ✓ ${lesson.id} (${n} exercice${n > 1 ? 's' : ''})`);
  }
}

if (!process.argv.includes('--lessons')) await checkOpenings();
if (!process.argv.includes('--openings')) await checkLessons();
engine.quit();
console.log(errors ? `\n${errors} problème(s) trouvé(s).` : '\nTout est bon ✓');
process.exit(errors ? 1 : 0);

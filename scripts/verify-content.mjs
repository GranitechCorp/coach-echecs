// Vérifie tout le contenu pédagogique avec chess.js et Stockfish :
//  - ouvertures : coups légaux, et aucun coup de « ton » camp ne perd plus de 0,6 pion ;
//  - cours : positions légales, solutions légales, et la solution est bien le meilleur coup ;
//    étapes « square » : noms de cases valides ; étapes « play » : objectif réaliste (gagnant pour 'mate'/'promote',
//    proche de 0 pour 'draw') ; quiz bien formés ; textes sans HTML ni notation anglaise.
// Usage : npm run check   (options : --fast profondeur réduite, --lessons / --openings, --only=<id>)
import { Chess } from 'chess.js';
import { NodeEngine, scoreOf } from './uci.mjs';
import { OPENING_LINES, OPENING_GROUPS, parseLine } from '../src/data/openings.js';
import { LESSONS, MODULES } from '../src/data/lessons.js';
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

/** Problème de légalité que chess.js ne détecte pas toujours (rois collés, roi du camp qui n'a pas le trait en échec…). */
function legalityProblem(c) {
  const kings = { w: c.findPiece({ type: 'k', color: 'w' }), b: c.findPiece({ type: 'k', color: 'b' }) };
  if (kings.w.length !== 1 || kings.b.length !== 1) return 'il faut exactement un roi de chaque couleur';
  const [w, b] = [kings.w[0], kings.b[0]];
  if (Math.abs(w.charCodeAt(0) - b.charCodeAt(0)) <= 1 && Math.abs(+w[1] - +b[1]) <= 1) return 'les deux rois se touchent';
  const other = c.turn() === 'w' ? 'b' : 'w';
  if (c.isAttacked(kings[other][0], c.turn())) return 'le camp qui n’a pas le trait est en échec';
  for (const row of [0, 7]) for (const p of c.board()[row]) if (p?.type === 'p') return 'pion sur la première ou la dernière rangée';
  return null;
}

const SQUARE = /^[a-h][1-8]$/;
// notation anglaise (N, B, Q, K + case) : le texte doit utiliser C, F, D, R
const ENGLISH_SAN = /(^|[\s(«…'’"/])(?:[KQNB][a-h]?[1-8]?x?[a-h][1-8])/;

/** Textes visibles : pas de HTML, pas de « undefined », pas de notation anglaise. */
function checkTexts(lesson, step, k) {
  const where = k >= 0 ? `étape ${k + 1}` : 'leçon';
  const fields = [step.text, step.hint, step.success, step.question, step.explain, step.link?.label, ...(step.choices || [])];
  for (const t of fields) {
    if (t === undefined) continue;
    if (typeof t !== 'string' || !t.trim()) fail(`${lesson.id} (${where}) : texte vide ou invalide`);
    else if (/<\/?[a-z][^>]*>/i.test(t)) fail(`${lesson.id} (${where}) : balise HTML dans le texte « ${t.slice(0, 40)}… »`);
    else if (/\b(undefined|null|NaN)\b/.test(t)) fail(`${lesson.id} (${where}) : texte suspect « ${t.slice(0, 40)}… »`);
    else if (ENGLISH_SAN.test(t)) fail(`${lesson.id} (${where}) : notation anglaise « ${t.match(ENGLISH_SAN)[0].trim()} » (utilise C, F, T, D, R)`);
  }
  if (step.link && !/^#\//.test(step.link.href || '')) fail(`${lesson.id} (${where}) : lien invalide ${step.link.href}`);
}

/** Évaluation de départ, du point de vue du camp au trait. */
async function startScore(c) {
  if (c.isCheckmate()) return -10000;
  if (c.isGameOver()) return 0;
  const [l] = await engine.analyse(c.fen(), { depth: DEPTH });
  return l ? scoreOf(l) : 0;
}

async function checkLessons() {
  console.log(`\n== Cours (${LESSONS.length} leçons) ==`);
  for (const lesson of LESSONS) {
    if (only && !lesson.id.includes(only)) continue;
    let n = 0;
    const counts = { play: 0, square: 0, quiz: 0 };
    if (!MODULES.some((m) => m.id === lesson.module)) fail(`${lesson.id} : module inconnu ${lesson.module}`);
    if (LESSONS.filter((l) => l.id === lesson.id).length > 1) fail(`${lesson.id} : identifiant en double`);
    if (!/^[a-z0-9-]+$/.test(lesson.id)) fail(`${lesson.id} : identifiant invalide (lettres minuscules, chiffres et tirets)`);
    if (!lesson.title?.trim() || !Number.isFinite(lesson.minutes)) fail(`${lesson.id} : titre ou durée manquants`);
    if (!lesson.steps?.length) fail(`${lesson.id} : aucune étape`);
    checkTexts(lesson, { text: lesson.title, success: lesson.practiceText, link: lesson.practice }, -1);
    for (const [k, step] of lesson.steps.entries()) {
      checkTexts(lesson, step, k);
      if (!['text', 'puzzle', 'quiz', 'play', 'square'].includes(step.type)) fail(`${lesson.id} (étape ${k + 1}) : type inconnu ${step.type}`);
      if (step.type === 'quiz') {
        counts.quiz++;
        if (!Array.isArray(step.choices) || step.choices.length < 2) fail(`${lesson.id} (étape ${k + 1}) : quiz sans choix`);
        else if (!Number.isInteger(step.answer) || step.answer < 0 || step.answer >= step.choices.length) fail(`${lesson.id} (étape ${k + 1}) : réponse du quiz hors des choix`);
        if (!step.explain) fail(`${lesson.id} (étape ${k + 1}) : quiz sans explication`);
      }
      if (step.type === 'square') {
        counts.square++;
        if (!Array.isArray(step.targets) || !step.targets.length) fail(`${lesson.id} (étape ${k + 1}) : aucune case à trouver`);
        else for (const t of step.targets) if (!SQUARE.test(t)) fail(`${lesson.id} (étape ${k + 1}) : nom de case invalide « ${t} »`);
        if (step.orientation && !['white', 'black'].includes(step.orientation)) fail(`${lesson.id} (étape ${k + 1}) : orientation invalide ${step.orientation}`);
      }
      let c;
      try {
        const fen = stepFen(step);
        if (!fen) {
          if (step.type === 'puzzle' || step.type === 'play') fail(`${lesson.id} (étape ${k + 1}) : position manquante`);
          continue;
        }
        c = new Chess(fen);
      } catch (e) {
        fail(`${lesson.id} : position invalide ${step.fen || step.moves} (${e.message})`);
        continue;
      }
      const illegal = legalityProblem(c);
      if (illegal) {
        fail(`${lesson.id} (étape ${k + 1}) : position illégale, ${illegal} — ${c.fen()}`);
        continue;
      }
      if (step.type === 'play') {
        counts.play++;
        const goal = step.goal || 'mate';
        const sc = await startScore(c);
        if (!['mate', 'promote', 'draw'].includes(goal)) fail(`${lesson.id} (étape ${k + 1}) : objectif inconnu ${goal}`);
        else if (c.isGameOver()) fail(`${lesson.id} (étape ${k + 1}) : la partie est déjà finie`);
        else if (goal === 'draw') {
          // tenir la nulle : la position de départ doit être tenable (évaluation proche de 0)
          if (!step.maxMoves) fail(`${lesson.id} (étape ${k + 1}) : 'draw' sans maxMoves`);
          if (Math.abs(sc) > 100) fail(`${lesson.id} (étape ${k + 1}) : position de départ pas nulle (${sc}) — ${c.fen()}`);
        } else if (sc < 300) fail(`${lesson.id} (étape ${k + 1}) : avantage pas décisif pour '${goal}' (${sc}) — ${c.fen()}`);
        if (step.failBelow !== undefined && sc < step.failBelow + 100) fail(`${lesson.id} (étape ${k + 1}) : failBelow ${step.failBelow} trop proche de l’éval. de départ (${sc})`);
        console.log(`    · ${lesson.id} : partie '${goal}', éval. de départ pour toi : ${sc}`);
      }
      if (step.type === 'puzzle') {
        n++;
        if (!Array.isArray(step.solution) || !step.solution.length) {
          fail(`${lesson.id} (étape ${k + 1}) : exercice sans solution`);
          continue;
        }
        // « Mat en N » annoncé : N coups à trouver, et la suite finit bien par un mat
        const announced = /\bmat en (\d+)/i.exec(step.text || '');
        if (announced) {
          const end = new Chess(c.fen());
          try {
            for (const u of step.solution) end.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
          } catch {
            /* coup illégal : signalé plus bas */
          }
          if (+announced[1] !== Math.ceil(step.solution.length / 2) || !end.isCheckmate())
            fail(`${lesson.id} (étape ${k + 1}) : « ${announced[0]} » annoncé, mais la solution fait ${Math.ceil(step.solution.length / 2)} coup(s)${end.isCheckmate() ? '' : ' sans finir par un mat'}`);
        }
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
            // si le moteur choisit lui-même ce coup, il est le meilleur (les deux évaluations peuvent différer un peu) ;
            // dans une position déjà gagnante, l'évaluation varie d'une analyse à l'autre : tolérance de 20 %
            const tol = Math.max(40, bs >= 300 && mine >= 300 ? bs * 0.2 : 0);
            if (best.pv[0] !== uci && bs - mine > tol && !(bs > 9000 && mine > 9000)) fail(`${lesson.id} : ${uci} n'est pas le meilleur (${mine} contre ${bs} pour ${best.pv[0]}) — ${fen}`);
            if (!step.allowOthers && second && i === 0 && scoreOf(second) > bs - 120 && !(bs > 9000 && scoreOf(second) < 9000) && bs < 9000) {
              console.log(`    ⚠ ${lesson.id} : solution non unique (${best.pv[0]} ${bs} / ${second.pv[0]} ${scoreOf(second)}) — ${fen}`);
            }
          } else {
            // coup de l'adversaire joué automatiquement : il doit être une défense raisonnable, sinon l'exercice montre
            // une suite que personne ne jouerait (simple avertissement : plusieurs défenses peuvent se valoir)
            const [best] = await engine.analyse(fen, { depth: DEPTH });
            const c2 = new Chess(fen);
            let reply = null;
            try {
              reply = c2.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
            } catch {
              /* signalé plus bas */
            }
            if (best && reply && best.pv[0] !== uci) {
              const after = c2.isCheckmate() ? -10000 : c2.isGameOver() ? 0 : -scoreOf((await engine.analyse(c2.fen(), { depth: DEPTH }))[0]);
              const bs = scoreOf(best);
              if (bs - after > 150 && !(bs < -9000 && after < -9000))
                console.log(`    ⚠ ${lesson.id} (étape ${k + 1}) : la réponse adverse ${uci} n’est pas la meilleure défense (${after} contre ${bs} pour ${best.pv[0]}), normal si l’exercice montre un piège — ${fen}`);
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
    const extra = [counts.play && `${counts.play} partie${counts.play > 1 ? 's' : ''}`, counts.square && `${counts.square} repérage${counts.square > 1 ? 's' : ''}`, counts.quiz && `${counts.quiz} quiz`].filter(Boolean);
    console.log(`  ✓ ${lesson.id} (${n} exercice${n > 1 ? 's' : ''}${extra.length ? ', ' + extra.join(', ') : ''})`);
  }
}

if (!process.argv.includes('--lessons')) await checkOpenings();
if (!process.argv.includes('--openings')) await checkLessons();
engine.quit();
console.log(errors ? `\n${errors} problème(s) trouvé(s).` : '\nTout est bon ✓');
process.exit(errors ? 1 : 0);

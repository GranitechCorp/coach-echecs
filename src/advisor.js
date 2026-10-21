// Conseiller d'ouvertures : croise ton style, ton niveau et tes résultats par ouverture
// pour recommander, pour chaque situation, l'ouverture la plus adaptée.
// C'est une aide à la décision (règles simples et transparentes), pas une vérité absolue.

const CATALOG = [
  // Avec les Blancs
  { id: 'qg', slot: 'w', name: 'Gambit Dame (1.d4 d5 2.c4)', groups: ['qg', 'qg-other'], match: /queens gambit|slav|queens pawn|indian|dutch|englund|benoni|grunfeld/, tactical: 0.4, open: 0.4, theory: 0.55, pitch: 'Jeu central et positionnel, plans clairs (colonne c, poussée e4), positions solides.' },
  { id: 'london', slot: 'w', name: 'Système de Londres', groups: ['london'], match: /london/, tactical: 0.3, open: 0.3, theory: 0.2, pitch: 'Toujours le même schéma : presque zéro théorie, tu gagnes du temps à la pendule et tu te concentres sur le milieu de partie.' },
  { id: 'italian', slot: 'w', name: 'Passer à 1.e4 avec la Partie italienne', groups: ['italian'], match: /italian|giuoco|two knights|kings pawn|ruy|scotch|petrov|sicilian|french|caro|scandinavian/, tactical: 0.8, open: 0.8, theory: 0.7, pitch: 'Positions ouvertes, attaques rapides sur f7 et le roi : beaucoup de tactique. Il faudra aussi préparer des réponses à la Sicilienne, la Française et la Caro-Kann.' },
  // Avec les Noirs contre 1.e4
  { id: 'caro', slot: 'b-e4', name: 'Caro-Kann (1…c6)', groups: ['ck'], match: /caro/, tactical: 0.3, open: 0.3, theory: 0.45, pitch: 'Ultra-solide, peu de faiblesses, très bonne en finale. Idéale si tu fais beaucoup de gaffes en positions ouvertes.' },
  { id: 'e5', slot: 'b-e4', name: '1…e5 (jeu ouvert)', groups: ['e5'], match: /italian|giuoco|two knights|ruy|scotch|petrov|kings pawn|philidor|vienna|bishops opening|four knights|ponziani|kings gambit/, tactical: 0.75, open: 0.85, theory: 0.6, pitch: 'Le jeu ouvert classique : développement rapide et beaucoup de tactique. Excellent pour progresser en calcul.' },
  { id: 'scandi', slot: 'b-e4', name: 'Scandinave (1…d5)', groups: ['scandi'], match: /scandinavian|center counter/, tactical: 0.5, open: 0.6, theory: 0.2, pitch: 'Tu imposes ta structure dès le premier coup, très peu de théorie, et le même esprit que la Caro-Kann (fou en f5, pions c6-e6).' },
  // Avec les Noirs contre 1.d4
  { id: 'slav', slot: 'b-d4', name: 'Slave (1…d5 2.c4 c6)', groups: ['slav'], match: /slav|london/, tactical: 0.35, open: 0.3, theory: 0.45, pitch: 'La cousine de la Caro-Kann : mêmes idées (pion c6, fou en f5). Cohérent avec ton répertoire, donc moins à apprendre.' },
  { id: 'qgd-black', slot: 'b-d4', name: 'Gambit Dame Refusé (1…d5 2.c4 e6)', groups: ['qgd-black'], match: /queens gambit declined/, tactical: 0.3, open: 0.3, theory: 0.5, pitch: 'Le grand classique, solide. Tu connais déjà ses idées grâce à ton Gambit Dame avec les Blancs.' },
];

export const SLOTS = { w: 'Avec les Blancs', 'b-e4': 'Avec les Noirs contre 1.e4', 'b-d4': 'Avec les Noirs contre 1.d4' };

/**
 * Renvoie, pour chaque situation, les ouvertures classées avec les raisons.
 * ins : résultat de computeInsights ; elo : niveau actuel.
 */
export function recommendOpenings(ins, elo = 900) {
  const st = ins.style;
  const out = {};
  for (const slot of Object.keys(SLOTS)) {
    const cands = CATALOG.filter((c) => c.slot === slot);
    // statistiques de tes parties pour chaque candidate
    const statsFor = (c) => {
      const color = slot === 'w' ? 'w' : 'b';
      const rel = ins.openings.filter((o) => o.color === color && c.match.test(o.family.toLowerCase()));
      const n = rel.reduce((a, o) => a + o.n, 0);
      const scored = rel.reduce((a, o) => a + o.scored, 0);
      const score = rel.reduce((a, o) => a + o.score, 0);
      const evals = rel.flatMap((o) => o.evals);
      return { n, scorePct: scored ? Math.round((100 * score) / scored) : null, evalAt20: evals.length ? Math.round(evals.reduce((a, b) => a + b, 0) / evals.length) : null };
    };
    const ranked = cands
      .map((c) => {
        const s = statsFor(c);
        const reasons = [];
        let score = 0;
        // 1. accord avec ton style
        const fit = 1 - Math.abs(c.tactical - st.tactical);
        score += 2 * fit;
        if (fit >= 0.75) reasons.push(`colle à ton style (${st.label.toLowerCase()})`);
        else if (fit < 0.5) reasons.push(`assez éloignée de ton style (${st.label.toLowerCase()})`);
        // 2. positions ouvertes ou fermées : où marques-tu le plus de points ?
        if (st.openPerf !== null && Math.abs(st.openPerf) >= 0.1) {
          const likesOpen = st.openPerf > 0;
          const bonus = (likesOpen ? c.open : 1 - c.open) * Math.min(1, Math.abs(st.openPerf) * 3);
          score += 1.5 * bonus;
          if (bonus > 0.5) reasons.push(`tu marques plus de points dans les positions ${likesOpen ? 'ouvertes' : 'fermées'}`);
        }
        // 3. quantité de théorie adaptée au niveau
        const theoryPenalty = c.theory * (elo < 1300 ? 1.6 : elo < 1600 ? 1 : 0.5);
        score -= theoryPenalty;
        if (c.theory <= 0.25) reasons.push('très peu de théorie à apprendre');
        else if (c.theory >= 0.65 && elo < 1400) reasons.push('demande pas mal de théorie à ton niveau');
        // 4. beaucoup de gaffes → structures solides
        if (ins.bpg !== null && ins.bpg >= 1.5) {
          score += (1 - c.open) * 0.8;
          if (c.open <= 0.35) reasons.push('structure solide qui limite les gaffes tactiques');
        }
        // 5. ce que tu joues déjà et tes résultats
        if (s.n >= 3) {
          score += 1.6; // changer d'ouverture coûte cher : l'habitude a de la valeur
          reasons.push(`tu l’as jouée ${s.n} fois : ${s.scorePct ?? '?'} % de points${s.evalAt20 !== null ? `, position moyenne au coup 10 : ${s.evalAt20 > 0 ? '+' : ''}${(s.evalAt20 / 100).toFixed(1)}` : ''}`);
          // les résultats ne comptent que sur un échantillon suffisant
          if (s.n >= 8) {
            if (s.scorePct !== null && s.scorePct < 40) score -= 1.4;
            if (s.scorePct !== null && s.scorePct >= 55) score += 0.6;
            if (s.evalAt20 !== null && s.evalAt20 < -100) score -= 0.8;
          } else reasons.push('encore trop peu de parties pour juger tes résultats');
        }
        return { ...c, stats: s, score, reasons };
      })
      .sort((a, b) => b.score - a.score);
    out[slot] = ranked;
  }
  return out;
}

import { initialState, makeRequirement, achievement, type State, type Option } from '../src/model';
import { OPTION_WEIGHTS, TIER_PROBABILITIES, tierValue } from '../src/data/tiers';
import { acceptSum, choosePlacement, copyGear, decideSum, gearFromState, sumContext, sumMet, type Gear, type SumAction, type SumSettings } from '../src/sumPolicy';
import { planAllocation } from '../src/planner';
import { combinePolicies, policyProbability } from '../src/probability';
import { fileURLToPath } from 'node:url';

// Independent raw draw and execution loop: no drawSum, simulateSum, tierTail,
// transition kernel, or production random generator. Policy decisions are shared
// intentionally: we validate the specified policy, not a different heuristic.
const options: Option[] = ['code', 'attack', 'ammo', 'chargeDamage', 'chargeSpeed', 'hit', 'crit', 'critDamage', 'defense'];
// Numeric indices follow OPTIONS, whereas the sampling traversal deliberately
// uses a different order to avoid sharing cumulative-rounding mistakes.
const indexOptions: Option[] = ['code', 'attack', 'ammo', 'chargeDamage', 'chargeSpeed', 'hit', 'crit', 'critDamage', 'defense'];
// OPTIONS puts these kinds in this order; assert in tests against the public API.
function randomStream(seed: number) { return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }; }
function pick<T>(items: T[], weight: (x: T) => number, random: () => number): T {
  const total = items.reduce((n, item) => n + weight(item), 0), u = random();
  let cumulative = 0;
  for (const item of items) { cumulative += weight(item) / total; if (u < cumulative) return item; }
  return items.at(-1)!;
}
export function independentDraw(g: Gear, action: SumAction, random: () => number): Gear {
  const out = copyGear(g), js = [0, 1, 2].map(j => 3 * action.part + j);
  const used = new Set(js.filter(j => g.locked[j]).map(j => indexOptions[g.kind[j]]));
  for (const j of js) {
    if (g.locked[j]) continue;
    let option: Option | undefined = indexOptions[g.kind[j]];
    if (!action.reset) option = random() < [1, .5, .3][j % 3]
      ? pick([...options].reverse().filter(o => !used.has(o)), o => OPTION_WEIGHTS[o], random) : undefined;
    if (!option) { out.kind[j] = -1; out.tier[j] = 0; continue; }
    const kind = indexOptions.indexOf(option);
    const tiers = Array.from({ length: 15 }, (_, n) => n + 1).filter(t => !(g.kind[j] === kind && g.tier[j] === t));
    out.kind[j] = kind; out.tier[j] = pick(tiers, t => TIER_PROBABILITIES[t - 1], random); used.add(option);
  }
  return out;
}
export function independentRun(s: State, settings: SumSettings, n: number, seed: number) {
  const c = sumContext(s, 'minimum')!, initial = gearFromState(s), fixed = choosePlacement(c, initial), random = randomStream(seed);
  const costs: number[] = []; let censored = 0;
  for (let run = 0; run < n; run++) {
    let g = copyGear(initial), cost = 0;
    while (!sumMet(c, g, settings) && cost < 20000) {
      const action = decideSum(c, g, settings, fixed);
      if (!action) break;
      // Independently charge only newly installed locks, including on rejection.
      let locked = g.locked.slice(action.part * 3, action.part * 3 + 3).filter(Boolean).length;
      for (const j of action.locks) if (!g.locked[j]) { cost += [2, 3][locked++]; g.locked[j] = true; }
      cost += [1, 2, 3][locked];
      const next = independentDraw(g, action, random);
      if (acceptSum(c, g, next, settings, fixed)) g = next;
    }
    if (!sumMet(c, g, settings)) { censored++; costs.push(Infinity); continue; }
    // Cross-check final completion with the UI's independent actual-value model.
    const completed = structuredClone(s);
    completed.equipment.forEach((e, p) => e.slots.forEach((slot, j) => {
      const k = p * 3 + j, o = indexOptions[g.kind[k]];
      Object.assign(slot, { option: o ?? 'none', tier: g.tier[k], value: o ? tierValue(o, g.tier[k]) : 0, locked: g.locked[k] });
    }));
    if (achievement(completed, 'minimum').status !== 'met') throw new Error('Policy completed without satisfying real sums');
    costs.push(cost);
  }
  return statistics(costs, censored);
}
export function statistics(costs: number[], censored = 0) {
  const n = costs.length, mean = censored ? Infinity : costs.reduce((a, b) => a + b, 0) / n;
  return { n, censored, mean, ci95: 1.96 * Math.sqrt(costs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) / n),
    p100: costs.filter(c => c <= 100).length / n, p150: costs.filter(c => c <= 150).length / n,
    p300: costs.filter(c => c <= 300).length / n };
}
export function fixture(attack = 3, ammo = 1, hit = true) {
  const s = initialState();
  for (const [o, n] of [['code', 4], ['attack', attack], ['ammo', ammo]] as [Option, number][]) s.targets.minimum[o] = makeRequirement(o, n, 8);
  if (hit) s.equipment.forEach(e => e.slots[0] = { option: 'hit', tier: 1, value: 4.77, locked: false });
  return s;
}
// Independent execution of the old minimum-tier retention policy for the
// reference fixture (the planner selects retention on all four pieces).
export function independentLegacy(s: State, n: number, seed: number) {
  const plan = planAllocation(s, 'minimum')!, random = randomStream(seed), costs: number[] = [];
  for (let run = 0; run < n; run++) {
    let g = gearFromState(s), cost = 0;
    for (let p = 0; p < 4; p++) {
      const required = plan.assignments.filter(a => a.part === p);
      const js = [3 * p, 3 * p + 1, 3 * p + 2];
      const qualifies = (state: Gear, j: number) => required.some(a => indexOptions[state.kind[j]] === a.option && state.tier[j] >= a.tier);
      while (!required.every(a => js.some(j => indexOptions[g.kind[j]] === a.option && g.tier[j] >= a.tier))) {
        let locked = js.filter(j => g.locked[j]).length;
        for (const j of js) if (!g.locked[j] && qualifies(g, j)) { cost += [2, 3][locked++]; g.locked[j] = true; }
        cost += locked + 1;
        const next = independentDraw(g, { part: p, reset: false, locks: [], modules: locked + 1, setup: 0, allocation: [] }, random);
        if (js.filter(j => required.some(a => a.option === indexOptions[next.kind[j]])).every(j => qualifies(next, j)) && js.filter(j => qualifies(next, j)).length > locked) g = next;
      }
    }
    costs.push(cost);
  }
  return statistics(costs);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = Number(process.env.STM_SAMPLES || 8192), s = fixture();
  for (const refine of [false, true]) for (const shortlistSize of [1, 32, 100000]) {
    const plan = planAllocation(s, 'minimum', 'forward', { refine, shortlistSize })!;
    const policy = combinePolicies(plan.pieces.flatMap(p => p.policy ? [p.policy] : []));
    console.log(JSON.stringify({ policy: 'legacy analytic', refine, shortlistSize, mean: plan.cost, allocations: plan.diagnostics.allocations, p150: policyProbability(policy, 150) }));
  }
  console.log(JSON.stringify({ policy: 'legacy independent', ...independentLegacy(s, n, 778811) }));
  for (const adaptive of [false, true]) for (const individual of [true, false]) {
    const start = performance.now();
    console.log(JSON.stringify({ policy: 'reset + retention', adaptive, individual,
      ...independentRun(s, { adaptive, individual, lockTier: 1 }, n, 712789), milliseconds: performance.now() - start }));
  }
  for (const [attack, ammo] of [[0, 0], [1, 1], [4, 4]]) {
    const start = performance.now();
    console.log(JSON.stringify({ case: `4code+${attack}attack+${ammo}ammo`, ...independentRun(fixture(attack, ammo), { adaptive: false, individual: false, lockTier: 1 }, n, 87321), milliseconds: performance.now() - start }));
  }
}

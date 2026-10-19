import { fileURLToPath } from 'node:url';
import { initialState, makeRequirement, type TargetOption } from '../src/model';
import { tierValue } from '../src/data/tiers';
import { calculateGoal } from '../src/engine';
import { independentRun } from './validate-sums';
export const criticalCases: [string, Partial<Record<TargetOption, number>>][] = [
  ['4크확', { crit: 4 }], ['4크뎀', { critDamage: 4 }],
  ['2크확2크뎀', { crit: 2, critDamage: 2 }], ['4크크', { critical: 4 }],
];
export function criticalFixture(target: Partial<Record<TargetOption, number>>) {
  const s = initialState();
  [7, 7, 1, 6].forEach((tier, p) => s.equipment[p].slots[0] = { option: 'code', tier, value: tierValue('code', tier)!, locked: false });
  for (const [o, n] of Object.entries({ code: 4, attack: 4, ...target })) s.targets.minimum[o as TargetOption] = makeRequirement(o as TargetOption, n!, 8);
  s.resources.modules.budget = 150;
  return s;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) for (const [name, target] of criticalCases) {
  const s = criticalFixture(target), start = performance.now(), r = calculateGoal(s, 'minimum');
  console.log(JSON.stringify({ name, screenMean: r.expectedModules, p150: r.successProbability,
    meanCI95: r.simulation ? 1.96 * r.simulation.standardError : null,
    milliseconds: performance.now() - start, simulation: !!r.simulation,
    independent: independentRun(s, { adaptive: r.simulation?.adaptive ?? false, individual: false, lockTier: 1 }, 8192, 20102026) }));
}

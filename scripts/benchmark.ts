import { cpus } from 'node:os';
import { calculateGoal } from '../src/engine';
import { initialState, makeRequirement, type Option } from '../src/model';
import { tierValue } from '../src/data/tiers';
import { planAllocation } from '../src/planner';
const cases = [
  { name: '4우코 T8', count: 0, tier: 8, locked: false },
  { name: '4우코+1공증+1장탄 T8', count: 1, tier: 8, locked: false },
  { name: '4우코+4공증+4장탄 T8', count: 4, tier: 8, locked: false },
  { name: '4우코+4공증+4장탄 T15', count: 4, tier: 15, locked: false },
  { name: '기존 우코 T15 잠금 + 12줄 T8', count: 4, tier: 8, locked: true },
];
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform }));
for (const c of cases) {
  const s = initialState();
  for (const o of ['code', 'attack', 'ammo'] as Option[]) s.targets.minimum[o] = makeRequirement(o, o === 'code' ? 4 : c.count, c.tier);
  s.resources.modules = { owned: 100, budget: 100 };
  if (c.locked) s.equipment.forEach(e => e.slots[2] = { option: 'code', tier: 15, value: tierValue('code', 15)!, locked: true });
  const start = performance.now(), first = calculateGoal(s, 'minimum'), cold = performance.now() - start;
  const times: number[] = [];
  for (let i = 0; i < 7; i++) { const start = performance.now(); calculateGoal(s, 'minimum'); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  const reverse = planAllocation(s, 'minimum', 'reverse');
  console.log(JSON.stringify({ name: c.name, expected: first.expectedModules, probabilityAt100: first.successProbability,
    coldMs: +cold.toFixed(2), medianMs: +times[3].toFixed(2), maxMs: +times.at(-1)!.toFixed(2),
    allocations: first.diagnostics?.allocations, localEvaluations: first.diagnostics?.localEvaluations,
    policyNodes: first.completionPolicy?.nodes.length, reverseOrderExpected: reverse?.cost }));
}

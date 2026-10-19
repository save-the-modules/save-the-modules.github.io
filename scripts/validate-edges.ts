import assert from 'node:assert/strict';
import { initialState, makeRequirement, type TargetOption } from '../src/model';
import { calculateGoal } from '../src/engine';
import { independentRun } from './validate-sums';
const cases: [string, Partial<Record<TargetOption, number>>, boolean?][] = [
  ['4우4공4명중', { code: 4, attack: 4, hit: 4 }],
  ['4우4공4차속', { code: 4, attack: 4, chargeSpeed: 4 }],
  ['4우4공2명중2차속', { code: 4, attack: 4, hit: 2, chargeSpeed: 2 }],
  ['4명중4차속4크크', { hit: 4, chargeSpeed: 4, critical: 4 }],
  ['4명중4차속2크확2크뎀', { hit: 4, chargeSpeed: 4, crit: 2, critDamage: 2 }],
  ['3번 명중15 잠금+4명중4차속', { hit: 4, chargeSpeed: 4 }, true],
];
for (const [name, target, locked] of cases) {
  const s = initialState(); s.targets.minimum = structuredClone(s.targets.balanced);
  for (const [o, n] of Object.entries(target)) s.targets.minimum[o as TargetOption] = makeRequirement(o as TargetOption, n!, 8);
  if (locked) s.equipment.forEach(e => e.slots[2] = { option: 'hit', tier: 15, value: 14.63, locked: true });
  s.resources.modules.budget = 150;
  const start = performance.now(), r = calculateGoal(s, 'minimum'), ms = performance.now() - start;
  assert.ok(r.simulation, `${name}: unexpectedly fell back`);
  const v = independentRun(s, { adaptive: r.simulation.adaptive, individual: false, lockTier: 1 }, 4096, 20261020);
  assert.equal(v.censored, 0);
  assert.ok(Math.abs(r.expectedModules! - v.mean) < 4 * (r.simulation.standardError + v.ci95 / 1.96), name);
  assert.ok(Math.abs(r.successProbability! - v.p150) < .05, name);
  console.log(JSON.stringify({ name, screenMean: r.expectedModules, p150: r.successProbability, ms, independent: v }));
}

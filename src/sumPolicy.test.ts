import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPTIONS, achievement, initialState, makeRequirement } from './model';
import { tierValue } from './data/tiers';
import { acceptSum, choosePlacement, copyGear, decideSum, drawSum, gearFromState, randomGenerator, sampleInterval, sampleProbability, simulateSum, sumContext, sumMet } from './sumPolicy';
import { fixture, independentDraw, independentRun } from '../scripts/validate-sums';
import { calculate, calculateGoal } from './engine';
import { CostCache } from './resultCache';
const settings = { adaptive: false, individual: false, lockTier: 1 };
test('sum controller agrees with UI: code tiers 1,15,8,8 meet 77.40, not individual floors', () => {
  const s = fixture(0, 0);
  [1, 15, 8, 8].forEach((tier, p) => s.equipment[p].slots[0] = { option: 'code', tier, value: tierValue('code', tier)!, locked: false });
  const c = sumContext(s, 'minimum')!, g = gearFromState(s);
  assert.equal(achievement(s, 'minimum').status, 'met');
  assert.equal(sumMet(c, g, settings), true);
  assert.equal(sumMet(c, g, { ...settings, individual: true }), false);
  assert.equal(decideSum(c, g, settings, choosePlacement(c, g)), null);
});
test('low wanted type is accepted then reset, without locking the low tier', () => {
  const s = fixture(0, 0), c = sumContext(s, 'minimum')!, before = gearFromState(s), after = copyGear(before);
  after.kind[0] = 0; after.tier[0] = 1;
  const fixed = choosePlacement(c, before);
  assert.equal(acceptSum(c, before, after, settings, fixed), true);
  // Other parts may be acquired first, but when all kinds are available the
  // next operation is a reset, never another effect roll for a tier threshold.
  for (const j of [3, 6, 9]) { after.kind[j] = 0; after.tier[j] = 1; }
  const action = decideSum(c, after, settings, fixed)!;
  assert.equal(action.reset, true); assert.deepEqual(action.locks, []);
});
test('sum simulator and a separate raw sampler/execution loop agree', () => {
  assert.deepEqual(OPTIONS.map(o => o.id), ['code', 'attack', 'ammo', 'chargeDamage', 'chargeSpeed', 'hit', 'crit', 'critDamage', 'defense']);
  const s = fixture(), c = sumContext(s, 'minimum')!;
  const production = simulateSum(c, gearFromState(s), settings, 2048, 912341);
  const independent = independentRun(s, settings, 2048, 818273);
  assert.equal(production.censored, 0); assert.equal(independent.censored, 0);
  assert.ok(Math.abs(production.mean - independent.mean) < 4 * (production.standardError + independent.ci95 / 1.96));
  assert.ok(Math.abs(sampleProbability(production.costs, 150)! - independent.p150) < .035);
});
test('reset never changes kinds, paid locks, blank slots or repeats the current tier', () => {
  const s = fixture(1, 1); s.equipment[0].slots[1] = { option: 'attack', tier: 8, value: 9.7, locked: true };
  const g = gearFromState(s), action = { part: 0, reset: true, locks: [1], setup: 0, modules: 2, allocation: [] };
  for (const draw of [drawSum, independentDraw]) for (let i = 1; i <= 50; i++) {
    const next = draw(g, action, randomGenerator(i));
    assert.deepEqual(next.kind, g.kind); assert.equal(next.tier[1], 8); assert.equal(next.tier[2], 0); assert.notEqual(next.tier[0], 1);
  }
});
test('sampling limits do not turn incomplete runs into cheap means or normalized CDFs', () => {
  const s = fixture(), c = sumContext(s, 'minimum')!;
  const r = simulateSum(c, gearFromState(s), settings, 100, 7, undefined, 1);
  assert.ok(r.censored > 0); assert.equal(r.mean, Infinity);
});
test('already paid locks survive rejected outcomes; setup only charges newly added locks', () => {
  const s = fixture(1, 1); s.equipment[0].slots[2] = { option: 'code', tier: 15, value: 29.16, locked: true };
  const c = sumContext(s, 'minimum')!, g = gearFromState(s), a = choosePlacement(c, g);
  const action = decideSum(c, g, settings, a)!;
  const before = JSON.stringify(g);
  assert.ok(action.setup <= 5);
  const rejected = copyGear(g); rejected.kind[0] = -1; rejected.tier[0] = 0;
  acceptSum(c, g, rejected, settings, a);
  assert.equal(JSON.stringify(g), before); assert.equal(g.locked[2], true);
});
test('empirical budget cache uses same sample costs and preserves state/storage format', () => {
  const s = fixture(); s.resources.modules.budget = 150;
  const before = JSON.stringify(s), r = calculate(s), cache = new CostCache();
  assert.ok(r.goals.minimum.simulation); cache.put(s, false, r);
  assert.equal(JSON.stringify(s), before);
  s.resources.modules.budget = 100;
  const cached = cache.get(s, false)!;
  assert.equal(cached.goals.minimum.expectedModules, r.goals.minimum.expectedModules);
  assert.equal(cached.goals.minimum.successProbability, sampleProbability(r.goals.minimum.simulation!.costs, 100));
  assert.ok(cached.goals.minimum.successProbability! < r.goals.minimum.successProbability!);
  assert.equal(s.schemaVersion, 3);
});
test('unsupported critical mixture and overlarge targets do not invent a sum simulation', () => {
  const s = initialState(); s.targets.minimum.critical = makeRequirement('critical', 1, 8);
  assert.equal(sumContext(s, 'minimum'), null);
  s.targets.minimum.critical.lines = 0; s.targets.minimum.code.total = 1000;
  assert.equal(sumContext(s, 'minimum'), null);
});
test('reference fixture improves analytic policy with holdout samples, not a target-number constant', () => {
  const s = fixture(), r = calculateGoal(s, 'minimum');
  assert.ok(r.simulation && r.expectedModules! < 180 && r.expectedModules! > 60);
  assert.equal(r.simulation.samples, 2048);
  assert.ok(r.reason.includes('최적해가 아닙니다'));
});
test('blank versus irrelevant hit tier1 has identical completion costs under the same draws', () => {
  const a = fixture(3, 1, false), b = fixture(3, 1, true);
  const x = simulateSum(sumContext(a, 'minimum')!, gearFromState(a), settings, 256, 13579);
  const y = simulateSum(sumContext(b, 'minimum')!, gearFromState(b), settings, 256, 13579);
  assert.deepEqual(x.costs, y.costs);
});
test('Wilson intervals communicate uncertainty even at all-success and all-failure samples', () => {
  assert.ok(sampleInterval([1, 1, 1, 1], 1)![0] < 1);
  assert.ok(sampleInterval([2, 2, 2, 2], 1)![1] > 0);
  assert.equal(sampleInterval([], 100), null);
});
test('manual sub-cent goal is rounded upward, never into a false success', () => {
  const s = fixture(0, 0); s.targets.minimum.code.total = 77.401;
  [1, 15, 8, 8].forEach((tier, p) => s.equipment[p].slots[0] = { option: 'code', tier, value: tierValue('code', tier)!, locked: false });
  assert.equal(sumMet(sumContext(s, 'minimum')!, gearFromState(s), settings), false);
  assert.equal(achievement(s, 'minimum').status, 'unmet');
});

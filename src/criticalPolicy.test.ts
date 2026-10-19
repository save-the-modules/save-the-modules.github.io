import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticalCases, criticalFixture } from '../scripts/validate-critical';
import { independentRun } from '../scripts/validate-sums';
import { calculateGoal } from './engine';
import { achievement, emptySlot, type Option } from './model';
import { tierValue } from './data/tiers';
import { acceptSum, choosePlacement, copyGear, decideSum, drawSum, gearFromState, randomGenerator, simulateSum, sumContext, sumMet } from './sumPolicy';
const settings = { adaptive: false, individual: false, lockTier: 1 };
test('four reported critical goals all use the same sum/reset policy family', () => {
  const results = criticalCases.map(([, goal]) => calculateGoal(criticalFixture(goal), 'minimum'));
  for (const r of results) assert.ok(r.simulation, r.reason);
  assert.ok(results[2].expectedModules! < 1.4 * results[0].expectedModules!);
  assert.ok(results[3].expectedModules! < Math.min(results[0].expectedModules!, results[1].expectedModules!));
  assert.ok(results[3].allocation!.some(p => p.targets.some(t => t.includes('크크'))));
});
test('wildcard terminal includes every 0..4 chance/damage mixture at equal normalized tiers', () => {
  for (let count = 0; count <= 4; count++) {
    const s = criticalFixture({ critical: 4 });
    s.equipment.forEach((e, p) => e.slots = (['code', 'attack', p < count ? 'crit' : 'critDamage'] as Option[]).map(option => ({ option, tier: 8, value: tierValue(option, 8)!, locked: false })));
    assert.equal(achievement(s, 'minimum').status, 'met');
    assert.equal(sumMet(sumContext(s, 'minimum')!, gearFromState(s), settings), true);
  }
});
test('either critical kind is accepted; fixed mixed counts still distinguish physical kinds', () => {
  const s = criticalFixture({ critical: 4 }), c = sumContext(s, 'minimum')!, before = gearFromState(s);
  for (const kind of [6, 7]) {
    const next = copyGear(before); next.kind[1] = kind; next.tier[1] = 1;
    assert.equal(acceptSum(c, before, next, settings, choosePlacement(c, before)), true);
  }
  const mixed = criticalFixture({ crit: 2, critDamage: 2 });
  mixed.equipment.forEach(e => e.slots = (['code', 'attack', 'crit'] as Option[]).map(option => ({ option, tier: 15, value: tierValue(option, 15)!, locked: false })));
  assert.equal(sumMet(sumContext(mixed, 'minimum')!, gearFromState(mixed), settings), false);
});
test('critical kinds stay distinct in raw draws, including duplicate exclusion and old tier exclusion', () => {
  const s = criticalFixture({ critical: 4 });
  s.equipment[0].slots = [{ option: 'crit', tier: 8, value: 4.69, locked: true }, { option: 'critDamage', tier: 8, value: 13.5, locked: false }, emptySlot()];
  const g = gearFromState(s), random = randomGenerator(81239);
  let damage = 0;
  for (let i = 0; i < 5000; i++) {
    const next = drawSum(g, { part: 0, reset: false, locks: [0], modules: 2, setup: 0, allocation: [] }, random);
    assert.equal(next.kind[0], 6); assert.equal(next.tier[0], 8);
    assert.ok(!next.kind.slice(1, 3).includes(6));
    if (next.kind[1] === 7) { damage++; assert.notEqual(next.tier[1], 8); }
  }
  assert.ok(damage > 100); // A locked crit does NOT remove critDamage from the draw.
});
test('a surplus critical on one piece is not mandatory and cannot cause a 4-kind dead end', () => {
  const s = criticalFixture({ critical: 4 });
  s.equipment[0].slots = [
    { option: 'crit', tier: 8, value: 4.69, locked: false },
    { option: 'critDamage', tier: 8, value: 13.5, locked: false }, emptySlot(),
  ];
  const c = sumContext(s, 'minimum')!, before = gearFromState(s), next = copyGear(before);
  next.kind[1] = 0; next.tier[1] = 8;
  assert.equal(acceptSum(c, before, next, settings, choosePlacement(c, before)), true);
  const action = decideSum(c, before, settings, choosePlacement(c, before))!;
  assert.ok(action.locks.filter(j => before.kind[j] === 6 || before.kind[j] === 7).length <= 1);
});
test('two physical critical locks still consume two physical slots', () => {
  const s = criticalFixture({ critical: 4 });
  s.equipment[0].slots = [
    { option: 'crit', tier: 15, value: 7.07, locked: true },
    { option: 'critDamage', tier: 15, value: 20.36, locked: true }, emptySlot(),
  ];
  assert.equal(sumContext(s, 'minimum'), null);
});
test('wildcard sampler agrees with independent draws and UI terminal checks', () => {
  const s = criticalFixture({ critical: 4 });
  const a = simulateSum(sumContext(s, 'minimum')!, gearFromState(s), settings, 1024, 9117);
  const b = independentRun(s, settings, 1024, 902711);
  assert.equal(a.censored, 0); assert.equal(b.censored, 0);
  assert.ok(Math.abs(a.mean - b.mean) < 4 * (a.standardError + b.ci95 / 1.96));
});

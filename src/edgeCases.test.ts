import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTarget, achievement, emptySlot, initialState, makeRequirement, OPTIONS, type Option, type TargetOption } from './model';
import { tierValue } from './data/tiers';
import { calculateGoal } from './engine';
import { completionEventProbability } from './rules';
import { choosePlacement, decideSum, drawSum, gearFromState, randomGenerator, sumContext, sumMet } from './sumPolicy';
const settings = { adaptive: false, individual: false, lockTier: 1 };
const slot = (option: Option, tier: number, locked = false) => ({ option, tier, value: tierValue(option, tier)!, locked });

test('all nine single-option goals: true values, exact boundary, and one-cent shortfall', () => {
  for (const { id } of OPTIONS) for (const tier of [1, 8, 15]) {
    const s = initialState(); s.targets.minimum = emptyTarget();
    s.targets.minimum[id] = makeRequirement(id, 4, tier);
    s.equipment.forEach(e => e.slots[0] = slot(id, tier));
    assert.equal(achievement(s, 'minimum').status, 'met');
    assert.equal(sumMet(sumContext(s, 'minimum')!, gearFromState(s), settings), true);
    s.targets.minimum[id].total += .01;
    assert.equal(achievement(s, 'minimum').status, 'unmet');
    const c = sumContext(s, 'minimum');
    if (c) assert.equal(sumMet(c, gearFromState(s), settings), false);
  }
});
test('hit and charge speed use their own value scales despite equal kind weights', () => {
  assert.equal(makeRequirement('hit', 4, 8).total, 38.8);
  assert.equal(makeRequirement('chargeSpeed', 4, 8).total, 16.16);
  const empty = [emptySlot(), emptySlot(), emptySlot()];
  assert.ok(Math.abs(completionEventProbability(empty, { hit: 8 }, [], '효과 변경') - completionEventProbability(empty, { chargeSpeed: 8 }, [], '효과 변경')) < 1e-12);
  const s = initialState(); s.targets.minimum.hit = makeRequirement('hit', 1, 8);
  s.targets.minimum.chargeSpeed = makeRequirement('chargeSpeed', 1, 8);
  s.equipment[0].slots[0] = slot('hit', 15);
  // A large hit percentage cannot substitute for any missing charge-speed line.
  assert.equal(sumMet(sumContext(s, 'minimum')!, gearFromState(s), settings), false);
});
test('random valid gear and up to four target kinds agree with UI terminal decisions', () => {
  const random = randomGenerator(20102026);
  for (let i = 0; i < 1500; i++) {
    const s = initialState(); s.targets.minimum = emptyTarget();
    const critical = i % 3 === 0;
    const pool: TargetOption[] = critical ? ['code', 'hit', 'chargeSpeed', 'critical'] : ['hit', 'chargeSpeed', 'crit', 'critDamage'];
    for (const o of pool) s.targets.minimum[o] = makeRequirement(o, 1 + Math.floor(random() * 3), 1 + Math.floor(random() * 15));
    for (const e of s.equipment) {
      const available = OPTIONS.map(o => o.id);
      for (let j = 0; j < 3; j++) {
        const option = available.splice(Math.floor(random() * available.length), 1)[0];
        e.slots[j] = random() < .15 ? emptySlot() : slot(option, 1 + Math.floor(random() * 15), random() < .15);
      }
    }
    const c = sumContext(s, 'minimum');
    if (!c) continue;
    assert.equal(sumMet(c, gearFromState(s), settings), achievement(s, 'minimum').status === 'met', `case ${i}`);
    const g = gearFromState(s), a = decideSum(c, g, settings, choosePlacement(c, g));
    if (!a) continue;
    assert.ok(a.locks.length <= 2);
    assert.ok(a.locks.every(j => Math.floor(j / 3) === a.part && g.kind[j] >= 0));
    for (let j = a.part * 3; j < a.part * 3 + 3; j++) if (g.locked[j]) assert.ok(a.locks.includes(j));
    for (const j of a.locks) g.locked[j] = true;
    const next = drawSum(g, a, random);
    for (let j = 0; j < 12; j++) if (g.locked[j] || Math.floor(j / 3) !== a.part) {
      assert.equal(next.kind[j], g.kind[j]); assert.equal(next.tier[j], g.tier[j]);
    }
    for (let p = 0; p < 4; p++) {
      const kinds = next.kind.slice(3 * p, 3 * p + 3).filter(o => o >= 0);
      assert.equal(new Set(kinds).size, kinds.length);
    }
  }
});
test('a locked low charge-speed line can be subsidized by high lines elsewhere', () => {
  const s = initialState(); s.targets.minimum = emptyTarget();
  s.targets.minimum.chargeSpeed = makeRequirement('chargeSpeed', 4, 8);
  [1, 15, 15, 15].forEach((tier, p) => s.equipment[p].slots[2] = slot('chargeSpeed', tier, true));
  assert.equal(calculateGoal(s, 'minimum').expectedModules, 0);
  s.equipment[3].slots[2] = slot('chargeSpeed', 1, true);
  // 1+15+15+1 is 16.14%, not four T8's 16.16% (rounded game table).
  assert.equal(achievement(s, 'minimum').status, 'unmet');
  const r = calculateGoal(s, 'minimum');
  assert.equal(r.expectedModules, null); assert.equal(r.nextAction, null);
});
test('full irrelevant paid locks do not acquire impossible hit/charge-speed targets', () => {
  const s = initialState(); s.targets.minimum.hit = makeRequirement('hit', 4, 8);
  s.targets.minimum.chargeSpeed = makeRequirement('chargeSpeed', 4, 8);
  s.equipment[0].slots = [slot('defense', 15, true), slot('chargeDamage', 15, true), slot('ammo', 15, true)];
  const r = calculateGoal(s, 'minimum');
  assert.equal(r.expectedModules, null); assert.equal(r.successProbability, null);
});
test('specific critical plus wildcard never counts one physical line twice', () => {
  const s = initialState(); s.targets.minimum = emptyTarget();
  s.targets.minimum.crit = makeRequirement('crit', 1, 8);
  s.targets.minimum.critical = makeRequirement('critical', 1, 8);
  s.equipment[0].slots[0] = slot('crit', 15);
  assert.equal(achievement(s, 'minimum').status, 'unmet');
  assert.equal(sumContext(s, 'minimum'), null);
  s.equipment[1].slots[0] = slot('critDamage', 8);
  assert.equal(calculateGoal(s, 'minimum').expectedModules, 0);
});

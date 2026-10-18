import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, emptySlot, emptyTarget, makeRequirement, type Option, type Slot, OPTIONS } from './model';
import { tierValue, OPTION_WEIGHTS, TIER_PROBABILITIES } from './data/tiers';
import { calculateGoal } from './engine';
import { planAllocation } from './planner';
import { retentionPolicy } from './retention';
import { completionEventProbability } from './rules';
import { combinePolicies, completionProbability, eventPolicy, policyExpectation, policyProbability } from './probability';
const close = (a: number, b: number, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const slot = (option: Option, tier: number, locked = false): Slot => ({ option, tier, value: tierValue(option, tier)!, locked });
const fixture = (count: number, tier = 8) => {
  const s = initialState();
  s.targets.minimum.code = makeRequirement('code', 4, tier);
  for (const o of ['attack', 'ammo'] as const) s.targets.minimum[o] = makeRequirement(o, count, tier);
  s.resources.modules = { owned: 100, budget: 100 };
  return s;
};

test('four successes cannot finish in fewer than four modules (old exponential bug)', () => {
  const p = combinePolicies(Array.from({ length: 4 }, () => eventPolicy({ probability: 0.1, modules: 1, setup: 0 })));
  assert.equal(policyProbability(p, 3), 0);
  close(policyProbability(p, 4)!, 0.1 ** 4);
  close(policyExpectation(p), 40);
});
test('setup is paid once, and budget DP agrees with independent convolution', () => {
  const events = [{ probability: 0.2, modules: 2, setup: 2 }, { probability: 0.35, modules: 3, setup: 3 }];
  const p = combinePolicies(events.map(eventPolicy));
  for (let b = 0; b < 100; b++) close(policyProbability(p, b)!, completionProbability(events, b)!);
  assert.equal(policyProbability(p, 9), 0);
  close(policyProbability(p, 10)!, 0.07);
  close(policyExpectation(p), 5 + 2 / 0.2 + 3 / 0.35);
});
test('branch-specific setup costs affect the CDF, not just the expected value', () => {
  const p = { setup: 2, root: 1, nodes: [
    { modules: 2, transitions: [{ probability: 1, next: -1, setup: 0 }] },
    { modules: 1, transitions: [{ probability: 0.5, next: -1, setup: 0 }, { probability: 0.5, next: 0, setup: 3 }] },
  ] };
  assert.equal(policyProbability(p, 2), 0);
  assert.equal(policyProbability(p, 3), 0.5);
  assert.equal(policyProbability(p, 7), 0.5);
  assert.equal(policyProbability(p, 8), 1);
  close(policyExpectation(p), 5.5);
});
test('a locked third slot excludes its kind before drawing the guaranteed first slot', () => {
  const slots = [emptySlot(), slot('defense', 5, true), slot('code', 15, true)];
  close(completionEventProbability(slots, { attack: 1 }, [1, 2], '효과 변경'), 0.1 / 0.8);
  assert.equal(completionEventProbability(slots, { code: 15 }, [1, 2], '효과 변경'), 1);
  assert.equal(completionEventProbability(slots, { ammo: 1 }, [1, 2], '수치 재설정'), 0);
});
test('representative 4 / 6 / 12 line goals produce finite policies and internally consistent expectations', () => {
  for (const count of [0, 1, 4]) {
    const s = fixture(count), r = calculateGoal(s, 'minimum');
    assert.ok(r.expectedModules! > 0 && r.expectedModules! < 2000);
    if (r.simulation) {
      close(r.expectedModules!, r.simulation.costs.reduce((a, b) => a + b, 0) / r.simulation.samples);
      assert.equal(r.successProbability, r.simulation.costs.filter(c => c <= 100).length / r.simulation.samples);
    } else {
      close(r.expectedModules!, policyExpectation(r.completionPolicy!), 1e-7);
      assert.equal(r.successProbability, policyProbability(r.completionPolicy!, 100));
    }
    assert.equal(r.allocation!.flatMap(a => a.targets).length, 4 + count * 2);
    assert.equal(r.diagnostics!.limited, false);
    assert.ok((r.completionPolicy?.nodes.length ?? r.simulation!.samples) < 50000);
  }
});
test('concentrated and distributed assignments both remain available and reuse existing gear', () => {
  const together = fixture(1), apart = fixture(1);
  together.equipment[2].slots = [slot('attack', 8), slot('ammo', 8), emptySlot()];
  apart.equipment[1].slots[0] = slot('attack', 8);
  apart.equipment[3].slots[0] = slot('ammo', 8);
  const a = planAllocation(together, 'minimum')!, b = planAllocation(apart, 'minimum')!;
  assert.equal(a.diagnostics.allocations, 16);
  assert.equal(b.diagnostics.allocations, 16);
  assert.ok(a.assignments.some(x => x.option === 'attack' && x.part === 2));
  assert.ok(a.assignments.some(x => x.option === 'ammo' && x.part === 2));
  assert.ok(b.assignments.some(x => x.option === 'attack' && x.part === 1));
  assert.ok(b.assignments.some(x => x.option === 'ammo' && x.part === 3));
});
test('actual high tiers subsidize other pieces without forcing four tier-8 lines', () => {
  const s = fixture(0); s.equipment[0].slots[2] = slot('code', 15, true);
  const p = planAllocation(s, 'minimum')!;
  assert.equal(p.pieces[0].cost, 0);
  assert.ok(p.assignments.some(a => a.tier < 8));
  assert.ok(p.assignments.reduce((sum, a) => sum + tierValue('code', a.tier)!, 0) >= 77.4 - 1e-7);
});
test('locked irrelevant lines are respected; fully locked unreachable equipment yields no invented cost', () => {
  const s = fixture(4);
  s.equipment[0].slots = [slot('hit', 15, true), slot('defense', 15, true), slot('chargeSpeed', 15, true)];
  const r = calculateGoal(s, 'minimum');
  assert.equal(r.expectedModules, null);
  assert.equal(r.successProbability, null);
  assert.equal(r.nextAction, null);
});
test('mixed critical requirements use exclusive physical lines', () => {
  const s = initialState(); s.targets.minimum = emptyTarget();
  for (const o of ['crit', 'critDamage', 'critical'] as const) s.targets.minimum[o] = makeRequirement(o, 1, 8);
  const p = planAllocation(s, 'minimum')!;
  assert.equal(new Set(p.assignments.map(a => `${a.part}:${a.option}`)).size, 3);
});
test('all-complete / empty targets return 100% / unavailable and no spurious work', () => {
  const s = fixture(4);
  s.equipment.forEach(e => e.slots = [slot('code', 8), slot('attack', 8), slot('ammo', 8)]);
  const r = calculateGoal(s, 'minimum');
  assert.equal(r.expectedModules, 0); assert.equal(r.successProbability, 1);
  assert.equal(r.nextAction?.action, '사용 중단');
  assert.equal(calculateGoal(s, 'balanced').expectedModules, null);
});

// Independent raw sampler: no probability/planner helper is used for the random draws.
function rng(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function sample(current: Slot[], random: () => number): Slot[] {
  const result = current.map(s => s.locked ? { ...s } : emptySlot());
  const used = new Set(result.filter(s => s.option !== 'none').map(s => s.option));
  for (let j = 0; j < 3; j++) {
    if (current[j].locked || random() >= [1, 0.5, 0.3][j]) continue;
    const options = OPTIONS.filter(o => !used.has(o.id));
    let r = random() * options.reduce((sum, o) => sum + OPTION_WEIGHTS[o.id], 0);
    const option = options.find(o => (r -= OPTION_WEIGHTS[o.id]) < 0)!.id;
    const weights: number[] = TIER_PROBABILITIES.map((p, i) => current[j].option === option && current[j].tier === i + 1 ? 0 : p);
    let t = random() * weights.reduce((sum, p) => sum + p, 0);
    const tier = weights.findIndex(p => (t -= p) < 0) + 1;
    result[j] = slot(option, tier); used.add(option);
  }
  return result;
}
test('raw Monte Carlo independently validates monotone DP expected cost and budget CDF', () => {
  const requirements = { code: 8, attack: 8, ammo: 8 }, initial = [emptySlot(), emptySlot(), emptySlot()];
  const p = retentionPolicy(initial, requirements, 'forward')!;
  const random = rng(24017), n = 12000, budget = 300;
  let sum = 0, within = 0;
  for (let i = 0; i < n; i++) {
    let slots = initial.map(s => ({ ...s })), cost = 0;
    while (!Object.keys(requirements).every(o => slots.some(s => s.option === o && s.tier >= 8))) {
      let locked = slots.filter(s => s.locked).length;
      for (const s of slots) if (!s.locked && s.option in requirements && s.tier >= 8) {
        cost += [2, 3][locked++]; s.locked = true;
      }
      cost += locked + 1;
      const next = sample(slots, random);
      const passes = next.filter(s => s.option in requirements);
      if (passes.every(s => s.tier >= 8) && passes.length > locked) slots = next;
    }
    sum += cost; if (cost <= budget) within++;
  }
  close(sum / n, p.cost, p.cost * 0.025);
  close(within / n, policyProbability(p.policy, budget)!, 0.015);
});
test('CDF is monotone and handles a large budget without budget-sized memory', () => {
  const p = retentionPolicy([emptySlot(), emptySlot(), emptySlot()], { code: 8, attack: 8 }, 'forward')!.policy;
  let previous = 0;
  for (const b of [0, 1, 2, 4, 10, 50, 100, 1000, 1000000]) {
    const next = policyProbability(p, b)!;
    assert.ok(next >= previous && next <= 1); previous = next;
  }
  assert.equal(previous, 1);
});

test('raw sampling validates conditional exclusion with an existing low tier and paid lock', () => {
  const initial = [slot('code', 1), slot('attack', 15, true), emptySlot()];
  const requirements = { code: 8, attack: 15, ammo: 8 };
  const p = retentionPolicy(initial, requirements, 'forward')!;
  assert.equal(p.policy.setup, 0);
  const random = rng(9921), n = 8000;
  let sum = 0, within = 0;
  for (let i = 0; i < n; i++) {
    let slots = initial.map(s => ({ ...s })), cost = 0;
    const qualifies = (s: Slot) => s.option in requirements && s.tier >= requirements[s.option as keyof typeof requirements];
    while (!Object.keys(requirements).every(o => slots.some(s => s.option === o && qualifies(s)))) {
      let locked = slots.filter(s => s.locked).length;
      for (const s of slots) if (!s.locked && qualifies(s)) { cost += [2, 3][locked++]; s.locked = true; }
      cost += locked + 1;
      const next = sample(slots, random), useful = next.filter(s => s.option in requirements);
      if (useful.every(qualifies) && useful.length > locked && next.some(s => s.option === 'code')) slots = next;
    }
    sum += cost; if (cost <= 300) within++;
  }
  close(sum / n, p.cost, p.cost * 0.035);
  close(within / n, policyProbability(p.policy, 300)!, 0.02);
});

test('one-step conditional probability matches a separate raw sampler', () => {
  const initial = [slot('code', 8), slot('attack', 15, true), slot('hit', 5)];
  const expected = completionEventProbability(initial, { code: 9, attack: 15, ammo: 5 }, [1], '효과 변경');
  const random = rng(18003), n = 200000;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const next = sample(initial, random);
    if (next.some(s => s.option === 'code' && s.tier >= 9) && next.some(s => s.option === 'ammo' && s.tier >= 5)) hits++;
  }
  close(hits / n, expected, 0.0004);
});

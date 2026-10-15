import { test } from "node:test";
import assert from "node:assert/strict";
import reference from "./data/reference-transcription.json";
import {
  OPTION_WEIGHTS,
  SLOT_PROBABILITIES,
  TIER_PROBABILITIES,
  VERIFIED_TIERS,
  tierValue,
} from "./data/tiers";
import {
  achievement,
  deficits,
  demoState,
  emptySlot,
  emptyTarget,
  equipmentIssues,
  initialState,
  inputSignature,
  makeRequirement,
  parseState,
  progress,
  recommend,
  resultIsCurrent,
  STAGES,
  targetSignature,
  totals,
  type EngineResult,
  type Option,
  type Slot,
} from "./model";
import {
  calculate,
  calculateGoal,
  lockSetupCost,
  preservationValues,
  simpleProbability,
  tierDistribution,
} from "./engine";
const fresh = () => {
  const s = initialState();
  s.targets.minimum = emptyTarget();
  return s;
};
const slot = (option: Option, tier: number, locked = false): Slot => ({
  option,
  tier,
  value: tierValue(option, tier)!,
  locked,
});
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("135 values match separate row-by-row transcription of original attachment", () => {
  let count = 0;
  for (const [key, row] of Object.entries(reference.rows)) {
    const expected = row.split(" ").map(Number);
    assert.equal(expected.length, 15);
    assert.deepEqual([...VERIFIED_TIERS[key]], expected, key);
    count += expected.length;
  }
  assert.equal(count, 135);
});
test("D / E: code tier 8 = 19.35 and four-line target = 77.40", () => {
  assert.equal(tierValue("code", 8), 19.35);
  assert.equal(makeRequirement("code", 4, 8).total, 77.4);
});
test("probabilities sum to one and use user-corrected critical weights", () => {
  close(
    Object.values(OPTION_WEIGHTS).reduce((a, b) => a + b, 0),
    1,
  );
  close(
    TIER_PROBABILITIES.reduce((a, b) => a + b, 0),
    1,
  );
  assert.deepEqual(SLOT_PROBABILITIES, [1, 0.5, 0.3]);
  assert.equal(OPTION_WEIGHTS.crit, 0.12);
  assert.equal(OPTION_WEIGHTS.critDamage, 0.10);
});
test("fresh default is only four code lines; other goals are independent", () => {
  const s = initialState();
  assert.equal(s.targets.minimum.code.lines, 4);
  assert.equal(s.targets.minimum.code.averageTier, 1);
  assert.equal(s.targets.balanced.code.lines, 0);
  s.targets.minimum.code.lines = 2;
  assert.equal(s.targets.ultimate.code.lines, 0);
});
test("v3 round trip and schema validation", () => {
  const s = initialState();
  assert.deepEqual(parseState(JSON.stringify(s)), s);
  assert.throws(() => parseState("{"));
  assert.throws(() => parseState(JSON.stringify({ ...s, schemaVersion: 99 })));
});
test("A: irrelevant hit/defense do not become new locks", () => {
  const s = initialState();
  s.equipment[0].slots = [slot("hit", 15), slot("defense", 15), emptySlot()];
  const r = calculateGoal(s, "minimum");
  assert.ok(r.nextAction);
  assert.deepEqual(r.nextAction!.newLockSlots, []);
  assert.equal(r.nextAction!.action, "효과 변경");
});
test("B: high code in third slot is preserved while another piece can improve", () => {
  const s = initialState();
  s.equipment[0].slots[2] = slot("code", 15);
  assert.ok(preservationValues(s, "minimum")[0][2] > 0);
  const r = calculateGoal(s, "minimum");
  assert.ok(r.nextAction);
  assert.notEqual(r.nextAction!.part, "머리");
});
test("C: attack three lines can be on any three pieces", () => {
  const s = fresh();
  s.targets.minimum.attack = makeRequirement("attack", 3, 8);
  [1, 2, 3].forEach((p) => (s.equipment[p].slots[0] = slot("attack", 8)));
  assert.equal(achievement(s, "minimum").status, "met");
  assert.equal(calculateGoal(s, "minimum").expectedModules, 0);
});
test("sum target does not force minimum tier on each line", () => {
  const s = initialState();
  s.targets.minimum.code = makeRequirement("code", 4, 8);
  [1, 15, 8, 8].forEach((t, p) => (s.equipment[p].slots[0] = slot("code", t)));
  assert.equal(achievement(s, "minimum").status, "met");
});
test("automatic aggregation and separate count/value deficits", () => {
  const s = initialState();
  s.targets.minimum.code = makeRequirement("code", 4, 8);
  s.equipment[0].slots[0] = slot("code", 15);
  const r = deficits(s, "minimum")[0];
  assert.equal(r.missingCount, 3);
  close(r.missingValue, 77.4 - 29.16);
  assert.equal(totals(s)[0].value, 29.16);
});
test("F: same-tier crit/damage are equal despite all 15 rounding differences", () => {
  for (let tier = 1; tier <= 15; tier++) {
    const s = fresh();
    s.targets.minimum.critical = makeRequirement("critical", 1, tier);
    s.equipment[0].slots[0] = slot("crit", tier);
    assert.equal(achievement(s, "minimum").status, "met");
    s.equipment[0].slots[0] = slot("critDamage", tier);
    assert.equal(achievement(s, "minimum").status, "met");
  }
});
test("F: critical lines cannot satisfy two targets", () => {
  const s = fresh();
  s.targets.minimum.crit = makeRequirement("crit", 1, 8);
  s.targets.minimum.critical = makeRequirement("critical", 1, 8);
  s.equipment[0].slots[0] = slot("crit", 8);
  assert.equal(achievement(s, "minimum").status, "unmet");
  s.equipment[1].slots[0] = slot("critDamage", 8);
  assert.equal(achievement(s, "minimum").status, "met");
});
test("G: fixture costs respect 90/50 percent and highest goal; no forced recommendation", () => {
  const s = fresh(),
    r = calculate(s);
  r.goals.minimum.expectedModules = 20;
  r.goals.balanced.expectedModules = 50;
  r.goals.ultimate.expectedModules = 200;
  for (const stage of STAGES)
    r.goals[stage].successProbability = simpleProbability(
      80,
      r.goals[stage].expectedModules,
    );
  assert.equal(recommend(r, "safe"), "minimum");
  assert.equal(recommend(r, "challenge"), "balanced");
  for (const stage of STAGES) r.goals[stage].successProbability = 0;
  assert.equal(recommend(r, "safe"), null);
});
test("E=0 is complete; null, NaN, negative are not calculable", () => {
  assert.equal(simpleProbability(0, 0), 1);
  assert.equal(simpleProbability(100, null), null);
  assert.equal(simpleProbability(100, NaN), null);
  assert.equal(simpleProbability(1, -1), null);
  assert.equal(simpleProbability(0, 10), 0);
  close(simpleProbability(10, 10)!, 1 - Math.exp(-1));
});
test("H: equipment, goal, budget and style changes invalidate old results; navigation does not", () => {
  const s = initialState(),
    r = calculate(s);
  assert.ok(resultIsCurrent(r, s));
  s.ui.tab = "guide";
  s.ui.selectedGoal = "ultimate";
  assert.ok(resultIsCurrent(r, s));
  for (const mutate of [
    (x: typeof s) => (x.equipment[0].slots[0] = slot("code", 8)),
    (x: typeof s) => (x.targets.minimum.code = makeRequirement("code", 4, 8)),
    (x: typeof s) => x.resources.modules.budget++,
    (x: typeof s) => (x.style = "challenge"),
  ]) {
    const next = structuredClone(s);
    mutate(next);
    assert.equal(resultIsCurrent(r, next), false);
  }
});
test("I: v2 migration preserves budget, resolves fixed values and converts manual goals", () => {
  const s = initialState();
  s.equipment[0].slots[0] = slot("code", 8);
  const old: any = { ...s, schemaVersion: 2 };
  delete old.baselines;
  delete old.migrationNotes;
  old.resources.modules = { owned: 180, budget: 80 };
  for (const stage of STAGES)
    for (const r of Object.values(old.targets[stage]) as any[])
      r.floors = Array(r.lines).fill(0);
  old.targets.minimum.code = {
    lines: 4,
    averageTier: 0,
    total: 77.4,
    floors: [0, 0, 0, 0],
    manual: true,
  };
  const migrated = parseState(JSON.stringify(old));
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.resources.modules.budget, 80);
  assert.equal(migrated.resources.modules.owned, 80);
  assert.equal(migrated.equipment[0].slots[0].tier, 8);
  assert.equal(migrated.targets.minimum.code.averageTier, 8);
  assert.equal(migrated.targets.minimum.code.total, 77.4);
  assert.ok(migrated.migrationNotes.length);
});
test("I: unknown old manual equipment value stays visible for review and blocks calculation", () => {
  const s = initialState();
  const old: any = { ...s, schemaVersion: 2 };
  for (const stage of STAGES)
    for (const r of Object.values(old.targets[stage]) as any[])
      r.floors = Array(r.lines).fill(0);
  old.equipment[0].slots[0] = {
    option: "code",
    tier: 8,
    value: 19.34,
    locked: false,
  };
  const m = parseState(JSON.stringify(old));
  assert.equal(m.equipment[0].slots[0].value, 19.34);
  assert.equal(m.equipment[0].slots[0].tier, 0);
  assert.ok(equipmentIssues(m).length);
  assert.equal(calculateGoal(m, "minimum").expectedModules, null);
});
test("existing same type and tier are excluded and probabilities renormalize", () => {
  const d = tierDistribution(slot("code", 8), "code", "수치 재설정");
  assert.equal(d[7], 0);
  close(d[0], 0.12 / 0.93);
  close(
    d.reduce((a, b) => a + b, 0),
    1,
  );
});
test("effect change excludes value only if option stays the same; none is not excluded", () => {
  assert.equal(
    tierDistribution(slot("attack", 8), "code", "효과 변경")[7],
    0.07,
  );
  assert.equal(tierDistribution(slot("code", 8), "code", "효과 변경")[7], 0);
  assert.deepEqual(
    tierDistribution(emptySlot(), "code", "효과 변경"),
    TIER_PROBABILITIES,
  );
});
test("lock setup only uses first and second permanent costs; no third lock", () => {
  assert.equal(lockSetupCost(0, 1), 2);
  assert.equal(lockSetupCost(0, 2), 5);
  assert.equal(lockSetupCost(1, 1), 3);
  assert.equal(lockSetupCost(2, 1), null);
  assert.equal(lockSetupCost(0, 3), null);
  assert.equal(lockSetupCost(2, 0), 0);
});
test("reset can lock needed third-slot high option and accounts for first execution separately", () => {
  const s = initialState();
  s.targets.minimum.code = makeRequirement("code", 4, 8);
  s.targets.minimum.attack = makeRequirement("attack", 1, 15);
  s.equipment.forEach((e) => (e.slots[0] = slot("code", 8)));
  s.equipment[0].slots = [slot("code", 1), emptySlot(), slot("attack", 15)];
  const r = calculateGoal(s, "minimum"),
    a = r.nextAction!;
  assert.equal(a.action, "수치 재설정");
  assert.deepEqual(a.newLockSlots, [2]);
  assert.equal(a.lockCost, 2);
  assert.equal(a.modules, 2);
  assert.equal(a.firstExecutionModules, 4);
  assert.equal(a.strategy.unlockedExpected, null);
  assert.ok(a.strategy.lockedExpected! > 0);
});
test("completed goal recommends stopping modules", () => {
  const s = initialState();
  s.equipment.forEach((e) => (e.slots[0] = slot("code", 1)));
  const r = calculateGoal(s, "minimum");
  assert.equal(r.expectedModules, 0);
  assert.equal(r.successProbability, 1);
  assert.equal(r.nextAction?.action, "사용 중단");
});
test("unverified conditional effect paths are excluded, not filled with arbitrary costs", () => {
  const s = initialState();
  s.targets.minimum.attack = makeRequirement("attack", 4, 8);
  s.equipment.forEach((e) => (e.slots[2] = slot("code", 15, true)));
  const r = calculateGoal(s, "minimum");
  assert.equal(r.expectedModules, null);
  assert.equal(r.successProbability, null);
  assert.match(r.reason, /조건부/);
});
test("same equipment duplicate types invalidate a migrated state until corrected", () => {
  const s = initialState();
  s.equipment[0].slots = [slot("attack", 1), slot("attack", 8), emptySlot()];
  assert.ok(equipmentIssues(s).length);
  assert.equal(achievement(s, "minimum").status, "invalid");
});
test("goal line count exceeding 12 remains editable locally and rejects external import", () => {
  const s = initialState();
  for (const k of ["attack", "ammo", "hit"] as const)
    s.targets.minimum[k] = makeRequirement(k, 4, 1);
  assert.equal(achievement(s, "minimum").status, "invalid");
  assert.throws(() => parseState(JSON.stringify(s)));
  assert.ok(parseState(JSON.stringify(s), true));
});
test("progress baselines are per-goal, do not use consumed budget and reset on changed goal", () => {
  const s = initialState(),
    r = calculateGoal(s, "minimum");
  s.baselines.minimum = {
    signature: targetSignature(s.targets.minimum),
    cost: 100,
  };
  r.expectedModules = 60;
  r.stable = true;
  close(progress(s, "minimum", r)!, 0.4);
  s.resources.modules.budget = 1;
  close(progress(s, "minimum", r)!, 0.4);
  s.targets.minimum.code = makeRequirement("code", 4, 8);
  assert.equal(progress(s, "minimum", r), null);
  assert.equal(progress(s, "balanced", r), null);
});
test("demo shares real interface with explicit source and cannot mutate user state", () => {
  const user = initialState(),
    before = JSON.stringify(user),
    demo = demoState();
  const r = calculate(demo, "demo");
  assert.equal(r.source, "demo");
  assert.equal(r.inputSignature, inputSignature(demo));
  demo.equipment[0].slots[0] = slot("code", 15);
  assert.equal(JSON.stringify(user), before);
});
test("calculation is deterministic and leaves input/budget/lock flags untouched", () => {
  const s = demoState(),
    before = JSON.stringify(s);
  assert.deepEqual(calculate(s), calculate(s));
  assert.equal(JSON.stringify(s), before);
});

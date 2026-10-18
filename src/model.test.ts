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
  chooseEquipmentOption,
  costSignature,
  DEFAULT_TARGET_TIER,
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
  tierDistribution,
} from "./engine";
import { getFastGuide, fastGuideSignature, evaluatePieces } from "./fastGuide";
import { CostCache, recordBaselines } from "./resultCache";
import { completionProbability, policyProbability } from './probability';
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
  assert.equal(OPTION_WEIGHTS.critDamage, 0.1);
});
test("fresh default is only four code lines; other goals are independent", () => {
  const s = initialState();
  assert.equal(s.targets.minimum.code.lines, 4);
  assert.equal(s.targets.minimum.code.averageTier, 8);
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
    r.goals[stage].successProbability = completionProbability(
      [{ probability: 1 / r.goals[stage].expectedModules!, modules: 1, setup: 0 }], 80);
  assert.equal(recommend(r, "safe"), "minimum");
  assert.equal(recommend(r, "challenge"), "balanced");
  for (const stage of STAGES) r.goals[stage].successProbability = 0;
  assert.equal(recommend(r, "safe"), null);
});
test("completion probabilities use integer event costs, not an exponential mean approximation", () => {
  assert.equal(completionProbability([], 0), 1);
  assert.equal(completionProbability([], NaN), null);
  assert.equal(completionProbability([], -1), null);
  assert.equal(completionProbability([{ probability: 0.1, modules: 1, setup: 0 }], 0), 0);
  close(completionProbability([{ probability: 0.1, modules: 1, setup: 0 }], 10)!, 1 - 0.9 ** 10);
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
    (x: typeof s) => (x.targets.minimum.code = makeRequirement("code", 4, 9)),
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
  assert.ok(a.strategy.unlockedExpected! > a.strategy.lockedExpected!);
  assert.ok(a.strategy.lockedExpected! > 0);
});
test("completed goal recommends stopping modules", () => {
  const s = initialState();
  s.targets.minimum.code = makeRequirement("code", 4, 1);
  s.equipment.forEach((e) => (e.slots[0] = slot("code", 1)));
  const r = calculateGoal(s, "minimum");
  assert.equal(r.expectedModules, 0);
  assert.equal(r.successProbability, 1);
  assert.equal(r.nextAction?.action, "사용 중단");
});
test("conditional effect paths are computed with prominently documented assumptions", () => {
  const s = initialState();
  s.targets.minimum.attack = makeRequirement("attack", 4, 8);
  s.equipment.forEach((e) => (e.slots[2] = slot("code", 15, true)));
  const r = calculateGoal(s, "minimum");
  assert.ok(r.expectedModules! > 0);
  assert.ok(r.completionPolicy || r.simulation);
  assert.match(r.reason, /가정/);
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
  s.targets.minimum.code = makeRequirement("code", 4, 9);
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
  const a = calculate(s), b = calculate(s);
  for (const stage of STAGES) {
    if (a.goals[stage].diagnostics) a.goals[stage].diagnostics!.milliseconds = 0;
    if (b.goals[stage].diagnostics) b.goals[stage].diagnostics!.milliseconds = 0;
  }
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(s), before);
});

test("v2.2: first equipment option uses tier 11; existing tiers survive option changes", () => {
  const first = chooseEquipmentOption(emptySlot(), "code");
  assert.equal(first.tier, 11);
  assert.equal(first.value, 23.56);
  assert.equal(chooseEquipmentOption(slot("attack", 6), "code").tier, 6);
  const cleared = chooseEquipmentOption(first, "none");
  assert.deepEqual(cleared, emptySlot());
  assert.equal(chooseEquipmentOption(cleared, "attack").tier, 11);
});

test("v2.2: new targets use tier 8 and update totals at boundaries", () => {
  assert.equal(DEFAULT_TARGET_TIER, 8);
  assert.equal(initialState().targets.minimum.code.total, 77.4);
  assert.equal(makeRequirement("attack", 1, DEFAULT_TARGET_TIER).total, 9.7);
  assert.equal(makeRequirement("code", 4, 9).total, 83);
  assert.equal(makeRequirement("code", 4, 1).total, 38.16);
  assert.equal(makeRequirement("code", 4, 15).total, 116.64);
});

test("v2.2: v2.1 persisted goals, equipment, locks and manual goal selection are preserved", () => {
  const saved = initialState();
  saved.targets.minimum.code = makeRequirement("code", 4, 1);
  saved.targets.balanced.attack = makeRequirement("attack", 3, 6);
  saved.ui.selectedGoal = "ultimate";
  saved.equipment[0].slots[2] = slot("code", 7, true);
  const loaded = parseState(JSON.stringify(saved));
  assert.deepEqual(loaded.targets, saved.targets);
  assert.deepEqual(loaded.equipment, saved.equipment);
  assert.equal(loaded.ui.selectedGoal, "ultimate");
});

test("compound goals now have a cost as well as live candidates", () => {
  const s = initialState();
  s.targets.minimum.attack = makeRequirement("attack", 4, 8);
  s.equipment.forEach((e) => (e.slots[2] = slot("code", 15, true)));
  assert.ok(calculateGoal(s, "minimum").expectedModules! > 0);
  const guide = getFastGuide(s);
  assert.equal(guide.status, "unmet");
  assert.equal(guide.rows.find((r) => r.key === "attack")!.missingCount, 4);
  assert.ok(guide.candidates.length >= 4);
  assert.ok(
    guide.candidates.every((c) => c.conditional && c.lockSlots.includes(2)),
  );
});

test("v2.2: irrelevant hit/defense never receive a new lock in fast guide", () => {
  const s = initialState();
  s.equipment[0].slots = [slot("hit", 15), slot("defense", 15), emptySlot()];
  assert.ok(getFastGuide(s).candidates.length);
  for (const c of getFastGuide(s).candidates) {
    for (const j of c.newLockSlots)
      assert.equal(s.equipment[c.partIndex].slots[j].option, "code");
  }
});

test("v2.2: a requested hit option is a contributor and can be protected", () => {
  const s = initialState();
  s.targets.minimum.hit = makeRequirement("hit", 1, 8);
  s.equipment[0].slots[2] = slot("hit", 15);
  const head = getFastGuide(s).candidates.find(
    (c) => c.partIndex === 0 && c.action === "효과 변경",
  );
  assert.ok(head?.lockSlots.includes(2));
});

test("v2.2: protect a third-slot core option and work a less valuable piece first", () => {
  const s = initialState();
  s.equipment[0].slots[2] = slot("code", 15);
  const guide = getFastGuide(s);
  assert.notEqual(guide.candidates[0].partIndex, 0);
  assert.ok(evaluatePieces(s, "minimum")[0].protectedSlots.includes(2));
});

test("v2.2: joint removal of interchangeable critical lines cannot discard both", () => {
  const s = initialState();
  s.targets.minimum.critical = makeRequirement("critical", 1, 8);
  s.equipment[0].slots = [slot("crit", 8), emptySlot(), slot("critDamage", 8)];
  [1, 2, 3].forEach((p) => (s.equipment[p].slots[0] = slot("code", 8)));
  const guide = getFastGuide(s);
  const head = guide.candidates.find(
    (c) => c.partIndex === 0 && c.target === "code",
  )!;
  assert.ok(head);
  assert.equal(head.newLockSlots.length, 1);
  assert.deepEqual(head.newLockSlots, [2]);
});

test("v2.2: full-equipment allocation does not force attack on any fixed three parts", () => {
  const s = fresh();
  s.targets.minimum.attack = makeRequirement("attack", 3, 8);
  const empty = getFastGuide(s);
  assert.deepEqual(
    new Set(empty.candidates.map((c) => c.partIndex)),
    new Set([0, 1, 2, 3]),
  );
  [1, 2, 3].forEach((p) => (s.equipment[p].slots[0] = slot("attack", 8)));
  assert.equal(getFastGuide(s).status, "met");
  assert.equal(getFastGuide(s).candidates.length, 0);
});

test("v2.2: no effect candidate may require discarding three protected options", () => {
  const s = initialState();
  for (const key of ["attack", "ammo", "chargeSpeed"] as const)
    s.targets.minimum[key] = makeRequirement(key, 1, 8);
  s.equipment[0].slots = [
    slot("attack", 8),
    slot("ammo", 8),
    slot("chargeSpeed", 8),
  ];
  assert.ok(
    !getFastGuide(s).candidates.some(
      (c) => c.partIndex === 0 && c.action === "효과 변경",
    ),
  );
});

test("v2.2: equipment edits change live guide without running the cost engine", () => {
  const s = initialState(),
    before = fastGuideSignature(s);
  assert.equal(getFastGuide(s).rows[0].missingCount, 4);
  s.equipment[0].slots[0] = slot("code", 11);
  assert.notEqual(fastGuideSignature(s), before);
  assert.equal(getFastGuide(s).rows[0].missingCount, 3);
  assert.ok(
    !getFastGuide(s).candidates.some(
      (c) => c.partIndex === 0 && c.target === "code",
    ),
  );
  s.equipment.forEach((e) => (e.slots[0] = slot("code", 11)));
  assert.equal(getFastGuide(s).status, "met");
});

test("v2.2: recording a recommendation never overwrites manual goal selection", () => {
  const s = demoState();
  s.ui.selectedGoal = "ultimate";
  const result = calculate(s);
  assert.equal(result.recommendedStage, recommend(result, s.style));
  recordBaselines(s, result);
  assert.equal(s.ui.selectedGoal, "ultimate");
  assert.equal(getFastGuide(s).stage, "ultimate");
});

test("v2.2: cost cache reuses geometry for budget/style and recomputes probability and recommendation", () => {
  const s = demoState(),
    cache = new CostCache();
  const geometry = costSignature(s),
    result = calculate(s);
  cache.put(s, false, result);
  s.style = "challenge";
  assert.equal(costSignature(s), geometry);
  assert.equal(cache.get(s, false)!.recommendedStage, recommend(result, 'challenge'));
  s.resources.modules.budget = 0;
  const updated = cache.get(s, false)!;
  assert.equal(updated.goals.minimum.successProbability, 0);
  assert.equal(updated.recommendedStage, null);
  assert.ok(resultIsCurrent(updated, s));
});

test("v2.2: changed equipment/goals hide cached costs; exact undo can reuse them", () => {
  const s = initialState(),
    cache = new CostCache();
  cache.put(s, false, calculate(s));
  const original = structuredClone(s);
  s.equipment[0].slots[0] = slot("code", 11);
  assert.equal(cache.get(s, false), null);
  assert.ok(cache.get(original, false));
  original.targets.minimum.code = makeRequirement("code", 4, 9);
  assert.equal(cache.get(original, false), null);
});

test("v2.2: cache isolates demo results and rejects mismatched input responses", () => {
  const s = demoState(),
    cache = new CostCache();
  const result = calculate(s, "demo");
  cache.put(s, true, result);
  assert.ok(cache.get(s, true));
  assert.equal(cache.get(s, false), null);
  const changed = structuredClone(s);
  changed.equipment[0].slots[0] = slot("code", 11);
  cache.put(changed, true, result);
  assert.equal(cache.get(changed, true), null);
});

test("v2.2: live guide evaluates selected goal and demo edits cannot change user guide", () => {
  const user = initialState(),
    demo = demoState(),
    before = getFastGuide(user);
  demo.ui.selectedGoal = "balanced";
  demo.equipment[0].slots[0] = slot("code", 15);
  assert.equal(getFastGuide(demo).stage, "balanced");
  assert.deepEqual(getFastGuide(user), before);
});

test("v2.2: invalid data and empty goals cannot produce action candidates", () => {
  const s = initialState();
  s.ui.selectedGoal = "balanced";
  assert.equal(getFastGuide(s).status, "empty");
  assert.deepEqual(getFastGuide(s).candidates, []);
  s.ui.selectedGoal = "minimum";
  s.equipment[0].slots = [slot("code", 8), slot("code", 9), emptySlot()];
  assert.equal(getFastGuide(s).status, "invalid");
  assert.deepEqual(getFastGuide(s).candidates, []);
});

test("v2.2: previous model progress baselines are hidden and replaced without changing targets", () => {
  const s = initialState();
  const targetBefore = structuredClone(s.targets);
  s.baselines.minimum = { signature: "stm-v2.1-model-signature", cost: 50 };
  const loaded = parseState(JSON.stringify(s));
  const result = calculate(loaded);
  assert.equal(progress(loaded, "minimum", result.goals.minimum), null);
  recordBaselines(loaded, result);
  assert.equal(progress(loaded, "minimum", result.goals.minimum), null);
  assert.deepEqual(loaded.targets, targetBefore);
});

test("v2.2: critical allocation bottlenecks can suggest value resets without duplicate type acquisition", () => {
  const s = fresh();
  s.targets.minimum.crit = makeRequirement("crit", 2, 15);
  s.targets.minimum.critDamage = makeRequirement("critDamage", 2, 15);
  s.targets.minimum.critical = makeRequirement("critical", 4, 15);
  s.equipment.forEach(
    (e) => (e.slots = [slot("crit", 8), slot("critDamage", 8), emptySlot()]),
  );
  const guide = getFastGuide(s);
  assert.ok(guide.candidates.some((c) => c.action === "수치 재설정"));
  assert.ok(!guide.candidates.some((c) => c.action === "효과 변경"));
  assert.ok(guide.candidates.every((c) => c.conditional));
});

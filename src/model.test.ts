import { test } from "node:test";
import assert from "node:assert/strict";
import {
  achievement,
  demoResult,
  demoState,
  initialState,
  parseState,
  recommend,
  toEngineInput,
  totals,
  type Slot,
} from "./model";
import { tierValue } from "./data/tiers";
const slot = (option: Slot["option"], value: number, tier = 8): Slot => ({
  option,
  value,
  tier,
  locked: false,
});
test("fresh state round-trips, preserving schema and UI", () => {
  const s = initialState();
  assert.deepEqual(parseState(JSON.stringify(s)), s);
  assert.equal(achievement(s, "minimum").status, "empty");
});
test("unverified tier data never produces fabricated values", () => {
  assert.equal(tierValue("code", 8), null);
  assert.ok(tierValue("code", 8, true)! > 0);
});
test("all four pieces update option totals", () => {
  const s = initialState();
  s.equipment.forEach((e) => {
    e.slots[0] = slot("attack", 2.5);
  });
  assert.deepEqual(totals(s).find((x) => x.id === "attack")?.value, 10);
});
test("critical targets cannot use the same line twice", () => {
  const s = initialState();
  s.equipment[0].slots[0] = slot("crit", 10);
  s.targets.minimum.crit.lines = 1;
  s.targets.minimum.critical.lines = 1;
  assert.equal(achievement(s, "minimum").status, "unmet");
  s.equipment[1].slots[0] = slot("critDamage", 28.8);
  assert.equal(achievement(s, "minimum").status, "met");
});
test("critical damage is converted by 2.88 with floating point tolerance", () => {
  const s = initialState();
  s.equipment[0].slots[0] = slot("critDamage", 28.8);
  s.targets.minimum.critical = {
    lines: 1,
    total: 10,
    averageTier: 8,
    floors: [8],
    manual: true,
  };
  assert.equal(achievement(s, "minimum").status, "met");
  s.targets.minimum.critical.total = 10.01;
  assert.equal(achievement(s, "minimum").status, "unmet");
});
test("disjoint critical assignment searches viable allocations", () => {
  const s = initialState();
  s.equipment[0].slots = [
    slot("crit", 9, 10),
    slot("crit", 4, 4),
    slot("critDamage", 25.92, 10),
  ];
  s.targets.minimum.crit = {
    lines: 1,
    total: 4,
    averageTier: 0,
    floors: [0],
    manual: true,
  };
  s.targets.minimum.critical = {
    lines: 2,
    total: 18,
    averageTier: 0,
    floors: [10, 10],
    manual: true,
  };
  assert.equal(achievement(s, "minimum").status, "met");
});
test("per-line minimum tiers cannot be replaced by a high total", () => {
  const s = initialState();
  s.equipment[0].slots = [
    slot("code", 99, 15),
    slot("code", 99, 2),
    slot("code", 10, 8),
  ];
  s.targets.minimum.code = {
    lines: 2,
    total: 20,
    averageTier: 0,
    floors: [8, 8],
    manual: true,
  };
  assert.equal(achievement(s, "minimum").status, "met");
  s.equipment[0].slots.pop();
  assert.equal(achievement(s, "minimum").status, "unmet");
});
test("goal stages are independent", () => {
  const s = initialState();
  s.targets.minimum.code.lines = 2;
  assert.equal(s.targets.balanced.code.lines, 0);
});
test("more than twelve goal lines is invalid and round-trips locally", () => {
  const s = demoState();
  s.targets.ultimate.attack.lines = 4;
  s.targets.ultimate.code.lines = 4;
  s.targets.ultimate.ammo.lines = 4;
  s.targets.ultimate.ammo.floors = [0, 0, 0, 0];
  s.targets.ultimate.critical.lines = 1;
  assert.equal(achievement(s, "ultimate").status, "invalid");
  assert.throws(() => parseState(JSON.stringify(s)));
  assert.equal(
    parseState(JSON.stringify(s), true).targets.ultimate.critical.lines,
    1,
  );
});
test("demo uses the same result interface and changes by style", () => {
  const s = demoState();
  const r = demoResult(s);
  assert.equal(r.source, "demo");
  assert.equal(recommend(r, "safe"), "minimum");
  assert.equal(recommend(r, "challenge"), "balanced");
  s.resources.modules.budget = 0;
  assert.equal(demoResult(s).recommendedStage, null);
  assert.equal(demoResult(s).nextAction, null);
});
test("demo fixtures are independent from user data", () => {
  const user = initialState();
  const before = JSON.stringify(user);
  const demo = demoState();
  demo.equipment[0].slots[0].value = 123;
  demo.targets.minimum.code.lines = 4;
  assert.equal(JSON.stringify(user), before);
});
test("budget, schema, enum, tier, malformed JSON validation", () => {
  assert.throws(() => parseState("{"));
  const s = initialState();
  s.resources.modules.budget = 1;
  assert.throws(() => parseState(JSON.stringify(s)));
  const cases = [
    { ...initialState(), schemaVersion: 1 },
    { ...initialState(), style: "balanced" },
    { ...initialState(), ui: {} },
  ];
  cases.forEach((c) => assert.throws(() => parseState(JSON.stringify(c))));
  s.resources.modules.budget = 0;
  s.equipment[0].slots[0] = slot("code", 10, 99);
  assert.throws(() => parseState(JSON.stringify(s)));
});
test("reject negative numbers, nonfinite and duplicate/wrong parts on import", () => {
  const s = initialState();
  s.equipment[0].slots[0] = slot("attack", -1);
  assert.throws(() => parseState(JSON.stringify(s)));
  s.equipment[0].slots[0] = slot("attack", Infinity);
  assert.throws(() => parseState(JSON.stringify(s)));
  s.equipment[0] = s.equipment[1];
  assert.throws(() => parseState(JSON.stringify(s)));
});
test("future engine input includes explicit critical policy", () => {
  const input = toEngineInput(initialState());
  assert.deepEqual(input.criticalRule, {
    damagePerChance: 2.88,
    exclusiveAssignment: true,
  });
  assert.equal(input.style, "safe");
});

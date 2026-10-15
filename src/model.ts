import { tierValue, TIER_COUNT } from "./data/tiers";
export const OPTIONS = [
  { id: "code", name: "우월 코드 대미지", short: "우월 코드" },
  { id: "attack", name: "공격력", short: "공격력" },
  { id: "ammo", name: "최대 장탄 수", short: "장탄 수" },
  { id: "chargeDamage", name: "차지 대미지", short: "차지 대미지" },
  { id: "chargeSpeed", name: "차지 속도", short: "차지 속도" },
  { id: "hit", name: "명중률", short: "명중률" },
  { id: "crit", name: "크리티컬 확률", short: "크확" },
  { id: "critDamage", name: "크리티컬 대미지", short: "크뎀" },
  { id: "defense", name: "방어력", short: "방어력" },
] as const;
export type Option = (typeof OPTIONS)[number]["id"];
export type TargetOption = Option | "critical";
export const PARTS = ["머리", "몸통", "팔", "다리"] as const;
export const STAGES = ["minimum", "balanced", "ultimate"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_NAMES: Record<Stage, string> = {
  minimum: "최소",
  balanced: "타협",
  ultimate: "종결",
};
export interface Slot {
  option: Option | "none";
  tier: number;
  value: number;
  locked: boolean;
}
export interface Equipment {
  part: (typeof PARTS)[number];
  slots: Slot[];
}
export interface Requirement {
  lines: number;
  averageTier: number;
  total: number;
  floors: number[];
  manual: boolean;
}
export type Target = Record<TargetOption, Requirement>;
export interface State {
  schemaVersion: 2;
  equipment: Equipment[];
  targets: Record<Stage, Target>;
  resources: {
    modules: { owned: number; budget: number };
    [key: string]: { owned: number; budget: number };
  };
  style: "safe" | "challenge";
  ui: {
    tab: "targets" | "guide";
    stage: Stage;
    selectedGoal: Stage;
    equipmentOpen: boolean;
  };
}
export interface EngineInput {
  equipment: Equipment[];
  targets: Record<Stage, Target>;
  resources: State["resources"];
  style: State["style"];
  criticalRule: { damagePerChance: 2.88; exclusiveAssignment: true };
}
export interface EngineResult {
  source: "engine" | "demo";
  goals: Record<
    Stage,
    { expectedModules: number | null; successProbability: number | null }
  >;
  recommendedStage: Stage | null;
  nextAction: {
    part: (typeof PARTS)[number];
    action: "효과 변경" | "수치 재설정";
    lockSlots: number[];
    reason: string;
    modules: number;
    lockKeys: number;
  } | null;
}
export const targetOptions = [
  ...OPTIONS,
  { id: "critical" as const, name: "크확 또는 크뎀", short: "크크" },
];
export const emptySlot = (): Slot => ({
  option: "none",
  tier: 0,
  value: 0,
  locked: false,
});
export const emptyTarget = (): Target =>
  targetOptions.reduce((result, o) => {
    result[o.id] = {
      lines: 0,
      averageTier: 0,
      total: 0,
      floors: [],
      manual: false,
    };
    return result;
  }, {} as Target);
export function initialState(): State {
  return {
    schemaVersion: 2,
    equipment: PARTS.map((part) => ({
      part,
      slots: Array.from({ length: 3 }, emptySlot),
    })),
    targets: {
      minimum: emptyTarget(),
      balanced: emptyTarget(),
      ultimate: emptyTarget(),
    },
    resources: { modules: { owned: 0, budget: 0 } },
    style: "safe",
    ui: {
      tab: "targets",
      stage: "minimum",
      selectedGoal: "minimum",
      equipmentOpen: true,
    },
  };
}
export function toEngineInput(s: State): EngineInput {
  return {
    equipment: s.equipment,
    targets: s.targets,
    resources: s.resources,
    style: s.style,
    criticalRule: { damagePerChance: 2.88, exclusiveAssignment: true },
  };
}
export function lineCount(t: Target) {
  return Object.values(t).reduce((a, r) => a + r.lines, 0);
}
export function totals(s: State) {
  return OPTIONS.map((o) => {
    const slots = s.equipment
      .flatMap((e) => e.slots)
      .filter((x) => x.option === o.id);
    return {
      ...o,
      lines: slots.length,
      value: slots.reduce((a, x) => a + x.value, 0),
    };
  });
}
function matches(slots: Slot[], r: Requirement, critical = false): boolean {
  if (!r.lines) return true;
  if (slots.length !== r.lines) return false;
  const tiers = slots.map((s) => s.tier).sort((a, b) => b - a);
  const floors = Array.from(
    { length: r.lines },
    (_, i) => r.floors[i] ?? 0,
  ).sort((a, b) => b - a);
  return (
    tiers.every((t, i) => t >= floors[i]) &&
    slots.reduce(
      (a, s) =>
        a + (critical && s.option === "critDamage" ? s.value / 2.88 : s.value),
      0,
    ) +
      1e-7 >=
      r.total
  );
}
export function achievement(
  s: State,
  stage: Stage,
): {
  status: "empty" | "invalid" | "met" | "unmet";
  checks: Record<string, boolean>;
} {
  const t = s.targets[stage],
    slots = s.equipment.flatMap((e) => e.slots),
    checks: Record<string, boolean> = {};
  if (lineCount(t) > 12) return { status: "invalid", checks };
  for (const o of OPTIONS.filter(
    (o) => o.id !== "crit" && o.id !== "critDamage",
  ))
    checks[o.id] = subsets(
      slots.filter((s) => s.option === o.id),
      t[o.id].lines,
    ).some((x) => matches(x, t[o.id]));
  const criticals = slots.filter(
    (s) => s.option === "crit" || s.option === "critDamage",
  );
  // Exhaustive disjoint assignment over at most twelve slots, not probability optimization.
  const canAssign = (keys: TargetOption[], rest: Slot[]): boolean => {
    if (!keys.length) return true;
    const [key, ...next] = keys,
      req = t[key];
    return subsets(
      rest.filter((s) => key === "critical" || s.option === key),
      req.lines,
    ).some(
      (group) =>
        matches(group, req, key === "critical") &&
        canAssign(
          next,
          rest.filter((s) => !group.includes(s)),
        ),
    );
  };
  const criticalOK = canAssign(["crit", "critDamage", "critical"], criticals);
  for (const key of ["crit", "critDamage", "critical"])
    checks[key] = criticalOK;
  return {
    status: !lineCount(t)
      ? "empty"
      : Object.values(checks).every(Boolean)
        ? "met"
        : "unmet",
    checks,
  };
}
function subsets<T>(list: T[], n: number): T[][] {
  if (!n) return [[]];
  if (list.length < n) return [];
  if (n === list.length) return [list];
  const [first, ...rest] = list;
  return [
    ...subsets(rest, n - 1).map((s) => [first, ...s]),
    ...subsets(rest, n),
  ];
}
export function recommend(
  r: EngineResult,
  style: State["style"],
): Stage | null {
  return (
    [...STAGES]
      .reverse()
      .find(
        (s) =>
          (r.goals[s].successProbability ?? -1) >=
          (style === "safe" ? 0.9 : 0.5),
      ) ?? null
  );
}
export function demoResult(s: State): EngineResult {
  const budget = s.resources.modules.budget;
  // Explicit fixture table. This is a UI demonstration, not a cost/probability model.
  const probs =
    budget >= 120
      ? [0.99, 0.95, 0.72]
      : budget >= 60
        ? [0.96, 0.74, 0.32]
        : budget >= 20
          ? [0.78, 0.42, 0.12]
          : [0, 0, 0];
  const r: EngineResult = {
    source: "demo",
    goals: Object.fromEntries(
      STAGES.map((stage, i) => [
        stage,
        { expectedModules: [24, 68, 156][i], successProbability: probs[i] },
      ]),
    ) as EngineResult["goals"],
    recommendedStage: null,
    nextAction: null,
  };
  r.recommendedStage = recommend(r, s.style);
  if (r.recommendedStage)
    r.nextAction = {
      part: "다리",
      action: "효과 변경",
      lockSlots: [0],
      reason:
        "가상 시나리오: 우월 코드 옵션을 유지하고 남은 슬롯의 유효 옵션을 확보합니다.",
      modules: 2,
      lockKeys: 0,
    };
  return r;
}
export function demoState(): State {
  const s = initialState();
  s.resources.modules = { owned: 180, budget: 80 };
  const opts: Option[][] = [
    ["code", "attack", "ammo"],
    ["code", "attack"],
    ["ammo", "critDamage"],
    ["code"],
  ];
  s.equipment.forEach(
    (e, i) =>
      (e.slots = e.slots.map((_, j) =>
        opts[i][j]
          ? {
              option: opts[i][j],
              tier: 5 + j,
              value: tierValue(opts[i][j], 5 + j, true)!,
              locked: j === 0,
            }
          : emptySlot(),
      )),
  );
  STAGES.forEach((stage, i) => {
    for (const [key, lines] of [
      ["code", [2, 3, 4][i]],
      ["attack", [2, 3, 4][i]],
      ["ammo", [0, 2, 3][i]],
      ["critical", [0, 0, 1][i]],
    ] as [TargetOption, number][])
      s.targets[stage][key] = {
        lines,
        averageTier: [5, 7, 10][i],
        total:
          Math.round((tierValue(key, [5, 7, 10][i], true) ?? 0) * lines * 100) /
          100,
        floors: Array(lines).fill(0),
        manual: false,
      };
  });
  return s;
}
const isObject = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown, max = 1000000, integer = false) =>
  typeof x === "number" &&
  Number.isFinite(x) &&
  x >= 0 &&
  x <= max &&
  (!integer || Number.isInteger(x));
export function parseState(raw: string, allowInvalidTargets = false): State {
  const s: unknown = JSON.parse(raw);
  if (!isObject(s) || s.schemaVersion !== 2)
    throw Error("지원하지 않는 스키마 버전입니다. v2 JSON을 선택해 주세요.");
  if (
    !Array.isArray(s.equipment) ||
    s.equipment.length !== 4 ||
    !s.equipment.every(
      (e: any, i: number) =>
        isObject(e) &&
        e.part === PARTS[i] &&
        Array.isArray(e.slots) &&
        e.slots.length === 3 &&
        e.slots.every(
          (x: any) =>
            isObject(x) &&
            ["none", ...OPTIONS.map((o) => o.id)].includes(x.option) &&
            num(x.tier, TIER_COUNT, true) &&
            num(x.value) &&
            typeof x.locked === "boolean" &&
            (x.option !== "none" ||
              (x.tier === 0 && x.value === 0 && !x.locked)),
        ),
    )
  )
    throw Error("장비 데이터 형식이 올바르지 않습니다.");
  if (
    !isObject(s.targets) ||
    !STAGES.every(
      (stage) =>
        isObject(s.targets[stage]) &&
        targetOptions.every((o) => {
          const r = s.targets[stage][o.id];
          return (
            isObject(r) &&
            num(r.lines, 4, true) &&
            num(r.averageTier, TIER_COUNT, true) &&
            num(r.total) &&
            typeof r.manual === "boolean" &&
            Array.isArray(r.floors) &&
            r.floors.length === r.lines &&
            r.floors.every((n: unknown) => num(n, TIER_COUNT, true)) &&
            (r.lines > 0 || r.total === 0)
          );
        }),
    )
  )
    throw Error("목표 데이터 형식이 올바르지 않습니다.");
  if (
    !allowInvalidTargets &&
    STAGES.some((stage) => lineCount(s.targets[stage]) > 12)
  )
    throw Error("목표의 전체 줄 수는 12줄 이하여야 합니다.");
  if (
    !isObject(s.resources) ||
    !isObject(s.resources.modules) ||
    !Object.values(s.resources).every(
      (r) =>
        isObject(r) &&
        num(r.owned, 1000000, true) &&
        num(r.budget, r.owned, true),
    )
  )
    throw Error("보유 자원과 투자 예산을 확인해 주세요.");
  if (
    !["safe", "challenge"].includes(s.style) ||
    !isObject(s.ui) ||
    !["targets", "guide"].includes(s.ui.tab) ||
    !STAGES.includes(s.ui.stage) ||
    !STAGES.includes(s.ui.selectedGoal) ||
    typeof s.ui.equipmentOpen !== "boolean"
  )
    throw Error("설정 데이터가 올바르지 않습니다.");
  return s as State;
}

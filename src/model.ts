import { DATA_REVISION, tierValue, TIER_COUNT } from "./data/tiers";
export const MODEL_REVISION = "stm-v2.3-allocation-retention-budget-dp-v1";
export const DEFAULT_EQUIPMENT_TIER = 11;
export const DEFAULT_TARGET_TIER = 8;
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
  schemaVersion: 3;
  migrationNotes: string[];
  baselines: Partial<Record<Stage, { signature: string; cost: number }>>;
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
export interface NextAction {
  part: (typeof PARTS)[number];
  action: "효과 변경" | "수치 재설정" | "사용 중단";
  lockSlots: number[];
  newLockSlots: number[];
  reason: string;
  modules: number;
  lockCost: number;
  firstExecutionModules: number;
  strategy: { unlockedExpected: number | null; lockedExpected: number | null };
}
export interface GoalResult {
  expectedModules: number | null;
  successProbability: number | null;
  reason: string;
  nextAction: NextAction | null;
  stable: boolean;
  completionPolicy?: import('./probability').CompletionPolicy;
  allocation?: { part: string; targets: string[]; expectedModules: number }[];
  diagnostics?: { allocations: number; localEvaluations: number; milliseconds: number; limited: boolean };
}
export interface EngineResult {
  source: "engine" | "demo";
  inputSignature: string;
  goals: Record<Stage, GoalResult>;
  recommendedStage: Stage | null;
  assumptions: string[];
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
export function chooseEquipmentOption(
  slot: Slot,
  option: Slot["option"],
): Slot {
  if (option === "none") return emptySlot();
  const tier = slot.tier || DEFAULT_EQUIPMENT_TIER;
  return { ...slot, option, tier, value: tierValue(option, tier)! };
}
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
    schemaVersion: 3,
    migrationNotes: [],
    baselines: {},
    equipment: PARTS.map((part) => ({
      part,
      slots: Array.from({ length: 3 }, emptySlot),
    })),
    targets: {
      minimum: {
        ...emptyTarget(),
        code: makeRequirement("code", 4, DEFAULT_TARGET_TIER),
      },
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
  return targetOptions.reduce((a, o) => a + t[o.id].lines, 0);
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
export function makeRequirement(
  key: TargetOption,
  lines: number,
  tier: number,
): Requirement {
  return {
    lines,
    averageTier: lines ? tier : 0,
    total: Math.round((tierValue(key, tier) ?? 0) * lines * 100) / 100,
    floors: [],
    manual: false,
  };
}
export function equipmentIssues(s: State): string[] {
  return s.equipment.flatMap((e) => {
    const options = e.slots
      .filter((x) => x.option !== "none")
      .map((x) => x.option);
    return [
      ...(new Set(options).size !== options.length
        ? [`${e.part}: 동일 옵션 중복을 수정해 주세요.`]
        : []),
      ...e.slots.flatMap((x, i) =>
        x.option !== "none" &&
        (!x.tier || tierValue(x.option, x.tier) !== x.value)
          ? [
              `${e.part} ${i + 1}번: 기존 수치 ${x.value}%의 단계를 확인해 주세요.`,
            ]
          : [],
      ),
    ];
  });
}
export interface Deficit {
  key: TargetOption;
  targetCount: number;
  currentCount: number;
  targetValue: number;
  currentValue: number;
  missingCount: number;
  missingValue: number;
  slotIds: string[];
}
export function normalizedValue(s: Slot, key: TargetOption): number {
  // Canonical tier lookup removes rounding drift in the 2.88 ratio.
  return key === "critical" && s.option === "critDamage"
    ? (tierValue("crit", s.tier) ?? s.value / 2.88)
    : s.value;
}
export function deficits(s: State, stage: Stage): Deficit[] {
  const t = s.targets[stage];
  const all = s.equipment
    .flatMap((e, p) => e.slots.map((slot, j) => ({ slot, id: `${p}:${j}` })))
    .filter((x) => x.slot.option !== "none");
  const make = (key: TargetOption, assigned: typeof all): Deficit => ({
    key,
    targetCount: t[key].lines,
    currentCount: assigned.length,
    targetValue: t[key].total,
    currentValue: assigned.reduce(
      (a, x) => a + normalizedValue(x.slot, key),
      0,
    ),
    missingCount: Math.max(0, t[key].lines - assigned.length),
    missingValue: Math.max(
      0,
      t[key].total -
        assigned.reduce((a, x) => a + normalizedValue(x.slot, key), 0),
    ),
    slotIds: assigned.map((x) => x.id),
  });
  const criticals = all.filter(
    (x) => x.slot.option === "crit" || x.slot.option === "critDamage",
  );
  const keys: TargetOption[] = ["crit", "critDamage", "critical"];
  let best = keys.map((k) => make(k, [])),
    bestScore: number[] | null = null;
  const groups: (typeof all)[] = [[], [], []];
  const assign = (i: number) => {
    if (i === criticals.length) {
      const rows = keys.map((k, j) => make(k, groups[j]));
      // Lexicographic assignment: completed goals, missing lines, then value shortfall.
      // Counts and percentages are never combined with an invented weighting constant.
      const active = rows.filter((r) => r.targetCount > 0);
      const score = [
        active.filter((r) => r.missingCount === 0 && r.missingValue < 1e-7)
          .length,
        -active.reduce((n, r) => n + r.missingCount, 0),
        -active.reduce((n, r) => n + r.missingValue / (r.targetValue || 1), 0),
      ];
      const difference =
        bestScore === null
          ? 1
          : (score.map((x, i) => x - bestScore![i]).find((x) => x !== 0) ?? 0);
      if (difference > 0) {
        bestScore = score;
        best = rows;
      }
      return;
    }
    assign(i + 1);
    keys.forEach((k, j) => {
      if (t[k].lines && (k === "critical" || criticals[i].slot.option === k)) {
        groups[j].push(criticals[i]);
        assign(i + 1);
        groups[j].pop();
      }
    });
  };
  assign(0);
  return [
    ...OPTIONS.filter((o) => o.id !== "crit" && o.id !== "critDamage").map(
      (o) =>
        make(
          o.id,
          t[o.id].lines ? all.filter((x) => x.slot.option === o.id) : [],
        ),
    ),
    ...best,
  ].filter((r) => r.targetCount > 0);
}
export function achievement(
  s: State,
  stage: Stage,
): {
  status: "empty" | "invalid" | "met" | "unmet";
  checks: Record<string, boolean>;
} {
  if (lineCount(s.targets[stage]) > 12 || equipmentIssues(s).length)
    return { status: "invalid", checks: {} };
  const rows = deficits(s, stage),
    checks = Object.fromEntries(
      rows.map((r) => [r.key, r.missingCount === 0 && r.missingValue < 1e-7]),
    );
  return {
    status: !rows.length
      ? "empty"
      : Object.values(checks).every(Boolean)
        ? "met"
        : "unmet",
    checks,
  };
}
export function targetSignature(t: Target) {
  return JSON.stringify([
    DATA_REVISION,
    MODEL_REVISION,
    targetOptions.map((o) => [
      o.id,
      t[o.id].lines,
      t[o.id].averageTier,
      t[o.id].total,
    ]),
  ]);
}
// Heavy costs depend on equipment/goals/model, not budget, style or navigation.
export function costSignature(s: State) {
  return JSON.stringify([
    MODEL_REVISION,
    DATA_REVISION,
    s.equipment,
    STAGES.map((k) => targetSignature(s.targets[k])),
  ]);
}
export function inputSignature(s: State) {
  return JSON.stringify([
    DATA_REVISION,
    s.equipment,
    STAGES.map((k) => targetSignature(s.targets[k])),
    s.resources.modules.budget,
    s.style,
  ]);
}
export function resultIsCurrent(r: EngineResult | null, s: State) {
  return !!r && r.inputSignature === inputSignature(s);
}
export function progress(s: State, stage: Stage, r: GoalResult): number | null {
  const base = s.baselines[stage];
  return base &&
    base.signature === targetSignature(s.targets[stage]) &&
    base.cost > 0 &&
    r.stable &&
    r.expectedModules !== null
    ? Math.max(0, Math.min(1, 1 - r.expectedModules / base.cost))
    : null;
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
              value: tierValue(opts[i][j], 5 + j)!,
              locked: false,
            }
          : emptySlot(),
      )),
  );
  STAGES.forEach((stage, i) => {
    for (const [key, lines] of [
      ["code", 4],
      ["attack", 0],
      ["ammo", 0],
      ["critical", 0],
    ] as [TargetOption, number][])
      s.targets[stage][key] = makeRequirement(key, lines, [5, 7, 10][i]);
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
  if (!isObject(s) || ![2, 3].includes(s.schemaVersion))
    throw Error(
      "지원하지 않는 스키마 버전입니다. v2 또는 v3 JSON을 선택해 주세요.",
    );
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
            (s.schemaVersion === 3 || r.floors.length === r.lines) &&
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
  const migrated = structuredClone(s) as State;
  const wasLegacy = s.schemaVersion === 2;
  migrated.schemaVersion = 3;
  migrated.migrationNotes = wasLegacy
    ? [
        "v2.0에서 가져왔습니다. 사용 가능 모듈은 기존 투자 예산이며, 목표 합계는 단계 기준으로 변환했습니다.",
      ]
    : Array.isArray(s.migrationNotes) &&
        s.migrationNotes.every((x: unknown) => typeof x === "string")
      ? s.migrationNotes.slice(0, 20)
      : [];
  migrated.baselines = {};
  if (!wasLegacy && isObject(s.baselines))
    for (const stage of STAGES) {
      const b = s.baselines[stage];
      if (
        b &&
        isObject(b) &&
        typeof b.signature === "string" &&
        num(b.cost, 1e15)
      )
        migrated.baselines[stage] = { signature: b.signature, cost: b.cost };
    }
  migrated.resources.modules.owned = migrated.resources.modules.budget;
  for (const e of migrated.equipment)
    for (const x of e.slots) {
      if (x.option !== "none" && tierValue(x.option, x.tier) !== x.value) {
        const found = Array.from({ length: 15 }, (_, i) => i + 1).find(
          (n) => Math.abs((tierValue(x.option, n) ?? 0) - x.value) < 1e-7,
        );
        if (!wasLegacy && found === undefined && x.tier !== 0)
          throw Error("단계와 수치가 일치하지 않습니다.");
        x.tier = found ?? 0;
      }
    }
  for (const stage of STAGES)
    for (const o of targetOptions) {
      const r = migrated.targets[stage][o.id];
      const average =
        wasLegacy && (r.manual || !r.averageTier) && r.lines
          ? (Array.from({ length: 15 }, (_, i) => i + 1).find(
              (n) => (tierValue(o.id, n) ?? 0) * r.lines + 1e-7 >= r.total,
            ) ?? 15)
          : r.averageTier;
      if (wasLegacy && r.floors.some(Boolean))
        migrated.migrationNotes.push(
          `${STAGE_NAMES[stage]} ${o.short}: v2.0 줄별 하한은 제거되었습니다.`,
        );
      if (wasLegacy && r.total > (tierValue(o.id, 15) ?? 0) * r.lines)
        migrated.migrationNotes.push(
          `${STAGE_NAMES[stage]} ${o.short}: 기존 직접 합계가 최대 단계를 초과해 15단계로 변환했습니다.`,
        );
      migrated.targets[stage][o.id] = makeRequirement(
        o.id,
        r.lines,
        r.lines ? Math.max(1, average) : 0,
      );
    }
  return migrated;
}

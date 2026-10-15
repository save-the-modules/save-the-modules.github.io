import {
  achievement,
  deficits,
  emptySlot,
  equipmentIssues,
  inputSignature,
  makeRequirement,
  normalizedValue,
  OPTIONS,
  PARTS,
  recommend,
  STAGES,
  type EngineResult,
  type GoalResult,
  type NextAction,
  type Option,
  type Slot,
  type Stage,
  type State,
  type TargetOption,
} from "./model";
import {
  OPTION_WEIGHTS,
  RULES,
  SLOT_PROBABILITIES,
  TIER_PROBABILITIES,
  tierValue,
} from "./data/tiers";
import { comparePriority, evaluatePieces } from "./fastGuide";

export const ENGINE_ASSUMPTIONS = [
  "예상 달성 확률은 지수모델 근사: P = 1 − exp(−사용 가능 모듈 / 추정 기대 비용). 실제 완료 분포가 아닙니다.",
  "각 단계는 조건을 만족할 때만 결과를 채용하는 반복 시도로 보고 E = c / p를 합산합니다. 여러 옵션의 동시 획득 이득은 선반영하지 않습니다.",
  "효과 변경은 무잠금 첫 슬롯의 단일 옵션 획득 경로만 계산합니다. 다른 유효 옵션이 사라지면 후보에서 제외합니다. 2·3슬롯 동시 추첨 및 잠금 후 종류별 조건부 확률은 미확인으로 계산하지 않습니다.",
  "수치 재설정은 기존 단계 제외 후 확률을 재정규화합니다. 다른 유효 옵션의 현재 수치를 보존하는 조건까지 곱하는 슬롯별 근사입니다.",
  "새 영구 잠금 비용은 첫 실행에만 2·3모듈을 더합니다. 기존 잠금은 이미 지불한 상태로 취급합니다. 세 번째 잠금·임시 잠금권은 계산에서 제외합니다.",
  "옵션 없음은 개조 완료 장비의 빈 슬롯입니다. 최초 오버로드 제작 비용은 포함하지 않습니다.",
];

export function tierDistribution(
  current: Slot,
  nextOption: Option,
  action: "효과 변경" | "수치 재설정",
): number[] {
  const exclude = current.option === nextOption && current.tier > 0;
  const denominator = 1 - (exclude ? TIER_PROBABILITIES[current.tier - 1] : 0);
  return TIER_PROBABILITIES.map((p, i) =>
    exclude && i + 1 === current.tier ? 0 : p / denominator,
  );
}
export function tailProbability(
  current: Slot,
  option: Option,
  minimum: number,
  action: "효과 변경" | "수치 재설정",
) {
  return tierDistribution(current, option, action).reduce(
    (a, p, i) => a + (i + 1 >= minimum ? p : 0),
    0,
  );
}
export function simpleProbability(
  budget: number,
  expected: number | null,
): number | null {
  if (expected === null || !Number.isFinite(expected) || expected < 0)
    return null;
  return expected === 0 ? 1 : -Math.expm1(-budget / expected);
}
export function lockSetupCost(existing: number, added: number): number | null {
  if (existing < 0 || added < 0 || existing + added > 2) return null;
  return Array.from(
    { length: added },
    (_, i) => RULES.newPermanentLockModules[existing + i],
  ).reduce((a, n) => a + n, 0);
}
const relevant = (slot: Slot, s: State, stage: Stage) =>
  slot.option !== "none" &&
  (s.targets[stage][slot.option].lines > 0 ||
    (["crit", "critDamage"].includes(slot.option) &&
      s.targets[stage].critical.lines > 0));
export function preservationValues(s: State, stage: Stage): number[][] {
  return evaluatePieces(s, stage).map((p) =>
    s.equipment[p.index].slots.map((_, j) =>
      p.protectedSlots.includes(j) ? 1 : 0,
    ),
  );
}
type Candidate = {
  next: State;
  action: NextAction;
  cost: number;
  protection: number[];
};
const name = (key: TargetOption) =>
  key === "critical" ? "크크" : OPTIONS.find((o) => o.id === key)!.short;
function threshold(
  option: Option,
  key: TargetOption,
  value: number,
): number | null {
  return (
    Array.from({ length: 15 }, (_, i) => i + 1).find(
      (t) =>
        normalizedValue(
          { option, tier: t, value: tierValue(option, t)!, locked: false },
          key,
        ) +
          1e-7 >=
        value,
    ) ?? null
  );
}
function improves(
  before: ReturnType<typeof deficits>,
  after: ReturnType<typeof deficits>,
): boolean {
  let changed = false;
  for (const r of before) {
    const n = after.find((x) => x.key === r.key)!;
    if (
      n.missingCount > r.missingCount ||
      n.missingValue > r.missingValue + 1e-7
    )
      return false;
    if (
      n.missingCount < r.missingCount ||
      n.missingValue + 1e-7 < r.missingValue
    )
      changed = true;
  }
  return changed;
}
function candidates(s: State, stage: Stage): Candidate[] {
  const rows = deficits(s, stage),
    pieces = evaluatePieces(s, stage, rows),
    values = pieces.map((p) =>
      s.equipment[p.index].slots.map((_, j) =>
        p.protectedSlots.includes(j) ? 1 : 0,
      ),
    ),
    out: Candidate[] = [];
  for (const row of rows.filter(
    (r) => r.missingCount || r.missingValue > 1e-7,
  )) {
    const key = row.key,
      options: Option[] = key === "critical" ? ["crit", "critDamage"] : [key];
    for (let part = 0; part < 4; part++) {
      const eq = s.equipment[part],
        existing = eq.slots.flatMap((x, j) => (x.locked ? [j] : []));
      if (existing.length > 2) continue;
      for (const option of options) {
        // An acquisition event on the first slot needs no unverified conditional option draw.
        if (
          row.missingCount &&
          existing.length === 0 &&
          !eq.slots.some((x) => x.option === option)
        ) {
          const desired = Math.min(
            row.missingValue / row.missingCount,
            tierValue(key, s.targets[stage][key].averageTier)!,
          );
          const tier = threshold(option, key, desired);
          if (tier !== null) {
            const next = structuredClone(s);
            next.equipment[part].slots = [
              { option, tier, value: tierValue(option, tier)!, locked: false },
              emptySlot(),
              emptySlot(),
            ];
            if (improves(rows, deficits(next, stage))) {
              const p =
                OPTION_WEIGHTS[option] *
                tailProbability(eq.slots[0], option, tier, "효과 변경");
              if (p > 0)
                out.push({
                  next,
                  cost: 1 / p,
                  protection: pieces[part].protection,
                  action: {
                    part: PARTS[part],
                    action: "효과 변경",
                    lockSlots: [],
                    newLockSlots: [],
                    modules: 1,
                    lockCost: 0,
                    firstExecutionModules: 1,
                    strategy: { unlockedExpected: 1 / p, lockedExpected: null },
                    reason: `${name(key)} ${row.missingCount}줄 부족. 다른 부위의 유효 옵션을 유지하며 ${PARTS[part]}에서 ${tier}단계 이상을 확보하는 첫 슬롯 경로입니다. 유효 옵션 소실은 허용하지 않고 추가 동시 획득 이득은 제외했습니다.`,
                  },
                });
            }
          }
        }
        // Type counts are already present; improve one line's value while preserving all others.
        if (row.missingCount === 0 && row.missingValue > 1e-7)
          eq.slots.forEach((slot, j) => {
            if (
              slot.option !== option ||
              slot.locked ||
              !row.slotIds.includes(`${part}:${j}`) ||
              slot.tier === 15
            )
              return;
            const desired = Math.min(
              normalizedValue(slot, key) + row.missingValue,
              normalizedValue(
                { ...slot, tier: 15, value: tierValue(option, 15)! },
                key,
              ),
            );
            const tier = threshold(option, key, desired);
            if (tier === null || tier <= slot.tier) return;
            const compare: Candidate[] = [];
            // At most eight local lock masks, not a search over equipment states.
            for (let mask = 0; mask < 8; mask++) {
              const locks = [0, 1, 2].filter((k) => !!(mask & (1 << k)));
              if (
                locks.includes(j) ||
                locks.length > 2 ||
                existing.some((k) => !locks.includes(k))
              )
                continue;
              const added = locks.filter((k) => !existing.includes(k));
              if (
                added.some(
                  (k) => values[part][k] === 0 || eq.slots[k].option === "none",
                )
              )
                continue;
              const setup = lockSetupCost(existing.length, added.length);
              if (setup === null) continue;
              let p = 1;
              eq.slots.forEach((other, k) => {
                if (locks.includes(k) || other.option === "none") return;
                if (k === j)
                  p *= tailProbability(other, option, tier, "수치 재설정");
                else if (relevant(other, s, stage))
                  p *= tailProbability(
                    other,
                    other.option,
                    other.tier,
                    "수치 재설정",
                  );
              });
              if (p <= 0) continue;
              const c = RULES.rerollModules[locks.length],
                cost = setup + c / p,
                next = structuredClone(s);
              next.equipment[part].slots[j] = {
                ...slot,
                tier,
                value: tierValue(option, tier)!,
              };
              locks.forEach(
                (k) => (next.equipment[part].slots[k].locked = true),
              );
              if (!improves(rows, deficits(next, stage))) continue;
              compare.push({
                next,
                cost,
                protection: [0, 0, 0, 0],
                action: {
                  part: PARTS[part],
                  action: "수치 재설정",
                  lockSlots: locks,
                  newLockSlots: added,
                  modules: c,
                  lockCost: setup,
                  firstExecutionModules: c + setup,
                  strategy: { unlockedExpected: null, lockedExpected: null },
                  reason: `줄 수는 확보했으며 ${name(key)} 합계가 ${row.missingValue.toFixed(2)}% 부족합니다. ${j + 1}번 옵션을 ${tier}단계 이상으로 높이는 경로와 다른 유효 옵션의 수치 보존 비용을 함께 비교했습니다.`,
                },
              });
            }
            const unlocked =
              compare.find((c) => c.action.newLockSlots.length === 0)?.cost ??
              null;
            const locked = compare
              .filter((c) => c.action.newLockSlots.length > 0)
              .reduce<
                number | null
              >((a, c) => (a === null ? c.cost : Math.min(a, c.cost)), null);
            compare.forEach(
              (c) =>
                (c.action.strategy = {
                  unlockedExpected: unlocked,
                  lockedExpected: locked,
                }),
            );
            out.push(...compare);
          });
      }
    }
  }
  // Third-slot high-tier contribution raises preservation priority, not a mandatory lock.
  return out.sort(
    (a, b) => comparePriority(a.protection, b.protection) || a.cost - b.cost,
  );
}
export function calculateGoal(input: State, stage: Stage): GoalResult {
  const status = achievement(input, stage).status;
  if (status === "empty")
    return {
      expectedModules: null,
      successProbability: null,
      nextAction: null,
      reason: "목표를 먼저 설정해 주세요.",
      stable: false,
    };
  if (status === "invalid")
    return {
      expectedModules: null,
      successProbability: null,
      nextAction: null,
      reason:
        equipmentIssues(input).join(" ") || "전체 목표가 12줄을 초과했습니다.",
      stable: false,
    };
  if (status === "met")
    return {
      expectedModules: 0,
      successProbability: 1,
      reason: "선택한 목표를 이미 달성했습니다.",
      stable: true,
      nextAction: {
        part: PARTS[0],
        action: "사용 중단",
        lockSlots: [],
        newLockSlots: [],
        reason:
          "목표 달성 · 추가 모듈 사용을 중단하세요. 상위 목표를 선택하면 다시 계산할 수 있습니다.",
        modules: 0,
        lockCost: 0,
        firstExecutionModules: 0,
        strategy: { unlockedExpected: 0, lockedExpected: null },
      },
    };
  let s = structuredClone(input),
    cost = 0,
    first: NextAction | null = null;
  for (let step = 0; step < 24; step++) {
    const candidate = candidates(s, stage)[0];
    if (!candidate)
      return {
        expectedModules: null,
        successProbability: null,
        nextAction: first,
        stable: false,
        reason:
          "계산 불가: 유효 옵션을 보존하려면 잠금 후 효과 변경 또는 복수 옵션의 조건부 추첨 확률이 필요합니다. 해당 분포는 검증되지 않아 이 경로를 제외했습니다. 모든 옵션 잠금 상태와 목표 배분도 확인해 주세요.",
      };
    first ??= candidate.action;
    cost += candidate.cost;
    s = candidate.next;
    if (achievement(s, stage).status === "met")
      return {
        expectedModules: cost,
        successProbability: simpleProbability(
          input.resources.modules.budget,
          cost,
        ),
        nextAction: first,
        reason: "4부위 기여도를 반영한 순차 경로의 기대 비용 합산 근사",
        stable: deficits(input, stage).length === 1,
      };
  }
  return {
    expectedModules: null,
    successProbability: null,
    nextAction: first,
    reason:
      "근사 경로의 단계 제한에 도달했습니다. 장비와 목표를 확인해 주세요.",
    stable: false,
  };
}
export function calculate(
  s: State,
  source: EngineResult["source"] = "engine",
): EngineResult {
  const result: EngineResult = {
    source,
    inputSignature: inputSignature(s),
    goals: Object.fromEntries(
      STAGES.map((k) => [k, calculateGoal(s, k)]),
    ) as EngineResult["goals"],
    recommendedStage: null,
    assumptions: ENGINE_ASSUMPTIONS,
  };
  result.recommendedStage = recommend(result, s.style);
  return result;
}

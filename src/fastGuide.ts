import {
  achievement,
  deficits,
  emptySlot,
  equipmentIssues,
  OPTIONS,
  PARTS,
  type Deficit,
  type Option,
  type Stage,
  type State,
  type TargetOption,
} from "./model";
import { RULES, tierValue } from "./data/tiers";

export const optionName = (key: TargetOption) =>
  key === "critical" ? "크크" : OPTIONS.find((o) => o.id === key)!.short;
export const isMissing = (r: Deficit) =>
  r.missingCount > 0 || r.missingValue > 1e-7;
export interface PieceEvaluation {
  part: (typeof PARTS)[number];
  index: number;
  usefulSlots: number[];
  protectedSlots: number[];
  surplusSlots: number[];
  // Lexicographic risk, no invented exchange rate between preservation and cost.
  protection: number[];
}
export function comparePriority(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
export function evaluatePieces(
  s: State,
  stage: Stage,
  rows = deficits(s, stage),
): PieceEvaluation[] {
  return s.equipment.map((e, index) => {
    const usefulSlots: number[] = [],
      protectedSlots: number[] = [];
    e.slots.forEach((slot, j) => {
      if (slot.option === "none") return;
      const useful =
        s.targets[stage][slot.option].lines > 0 ||
        (["crit", "critDamage"].includes(slot.option) &&
          s.targets[stage].critical.lines > 0);
      if (!useful) return;
      usefulSlots.push(j);
      const removed = structuredClone(s);
      removed.equipment[index].slots[j] = emptySlot();
      const after = deficits(removed, stage);
      if (
        rows.some(
          (r, k) =>
            after[k].missingCount > r.missingCount ||
            after[k].missingValue > r.missingValue + 1e-7,
        )
      )
        protectedSlots.push(j);
    });
    return {
      index,
      part: e.part,
      usefulSlots,
      protectedSlots,
      surplusSlots: usefulSlots.filter((j) => !protectedSlots.includes(j)),
      // Preserve contributors first; at equal counts, rarer third/second slots
      // and their high tiers have greater protection priority.
      protection: [
        protectedSlots.length,
        ...[2, 1, 0].map((j) =>
          protectedSlots.includes(j) ? e.slots[j].tier : 0,
        ),
      ],
    };
  });
}
export interface FastCandidate {
  part: (typeof PARTS)[number];
  partIndex: number;
  action: "효과 변경" | "수치 재설정";
  target: TargetOption;
  slot: number | null;
  lockSlots: number[];
  newLockSlots: number[];
  firstExecutionModules: number;
  conditional: boolean;
  reason: string;
}
export interface FastGuide {
  stage: Stage;
  status: ReturnType<typeof achievement>["status"];
  rows: Deficit[];
  pieces: PieceEvaluation[];
  candidates: FastCandidate[];
  reason: string;
}
export function fastGuideSignature(s: State) {
  return JSON.stringify([
    s.equipment,
    s.ui.selectedGoal,
    s.targets[s.ui.selectedGoal],
  ]);
}
export function getFastGuide(s: State): FastGuide {
  const stage = s.ui.selectedGoal,
    status = achievement(s, stage).status;
  const rows = deficits(s, stage);
  const result: FastGuide = {
    stage,
    status,
    rows,
    pieces: [],
    candidates: [],
    reason: "",
  };
  if (status === "invalid") {
    result.reason =
      equipmentIssues(s).join(" ") || "목표를 12줄 이하로 조정해 주세요.";
    return result;
  }
  if (status === "empty") {
    result.reason = "선택한 단계의 목표를 먼저 설정해 주세요.";
    return result;
  }
  if (status === "met") {
    result.reason = "목표 달성 · 모듈 사용을 중단하세요.";
    return result;
  }
  const pieces = evaluatePieces(s, stage, rows);
  result.pieces = [...pieces].sort(
    (a, b) => comparePriority(a.protection, b.protection) || a.index - b.index,
  );
  for (const piece of pieces) {
    const eq = s.equipment[piece.index];
    const existing = eq.slots.flatMap((x, j) => (x.locked ? [j] : []));
    if (existing.length > 2) continue;
    const add = (
      row: Deficit,
      action: FastCandidate["action"],
      slot: number | null,
    ) => {
      const toProtect = piece.protectedSlots.filter((j) => j !== slot);
      let locks = [...new Set([...existing, ...toProtect])].sort();
      if (action === "효과 변경") {
        // Individual marginal contributions can hide fungible pairs (crit/critDamage).
        // Check removing all unprotected slots together before suggesting any action.
        const feasible: number[][] = [];
        for (let mask = 0; mask < 8; mask++) {
          const keep = [0, 1, 2].filter((j) => mask & (1 << j));
          if (
            keep.length > 2 ||
            locks.some((j) => !keep.includes(j)) ||
            keep.some(
              (j) => !existing.includes(j) && !piece.usefulSlots.includes(j),
            )
          )
            continue;
          const removed = structuredClone(s);
          removed.equipment[piece.index].slots = eq.slots.map((slot, j) =>
            keep.includes(j) ? slot : emptySlot(),
          );
          const after = deficits(removed, stage);
          if (
            rows.every(
              (r, k) =>
                after[k].missingCount <= r.missingCount &&
                after[k].missingValue <= r.missingValue + 1e-7,
            )
          )
            feasible.push(keep);
        }
        feasible.sort(
          (a, b) =>
            a.length - b.length ||
            comparePriority(
              [2, 1, 0].map((j) => (b.includes(j) ? eq.slots[j].tier : 0)),
              [2, 1, 0].map((j) => (a.includes(j) ? eq.slots[j].tier : 0)),
            ),
        );
        if (!feasible.length) return;
        locks = feasible[0];
      }
      if (locks.length > 2) return; // Cannot preserve all contributors within verified lock limits.
      const newLocks = locks.filter((j) => !existing.includes(j));
      const setup = newLocks.reduce(
        (total, _, i) =>
          total + RULES.newPermanentLockModules[existing.length + i],
        0,
      );
      const conditional = locks.length > 0 || action === "수치 재설정";
      const protectedUseful = locks.filter((j) =>
        piece.usefulSlots.includes(j),
      );
      result.candidates.push({
        part: eq.part,
        partIndex: piece.index,
        target: row.key,
        action,
        slot,
        lockSlots: locks,
        newLockSlots: newLocks,
        firstExecutionModules: setup + RULES.rerollModules[locks.length],
        conditional,
        reason:
          action === "효과 변경"
            ? `${optionName(row.key)} ${row.missingCount}줄 부족. ${protectedUseful.length ? `${protectedUseful.map((j) => j + 1).join("·")}번 기여 옵션을 보존하는 잠금 검토 후` : "보호가 필요한 기존 기여 옵션이 없는 부위에서"} 효과 변경을 검토하세요. 새 결과가 다른 목표를 악화시키면 유지하지 마세요.`
            : `${row.missingCount ? "크확·크뎀·크크 사이의 배정 여유가 부족합니다." : `${optionName(row.key)} 줄 수는 확보했고 합계가 ${row.missingValue.toFixed(2)}% 부족합니다.`} ${slot! + 1}번 수치를 높이는 후보입니다. 다른 기여 옵션의 수치를 보존할 수 있는지 확인하세요.`,
      });
    };
    for (const row of rows.filter(isMissing)) {
      const types: Option[] =
        row.key === "critical" ? ["crit", "critDamage"] : [row.key];
      // A fixed type can occur at most once per piece. No artificial part assignment.
      if (
        row.missingCount &&
        types.some((t) => !eq.slots.some((x) => x.option === t))
      )
        add(row, "효과 변경", null);
      if (!row.missingCount && row.missingValue > 1e-7) {
        eq.slots.forEach((slot, j) => {
          if (
            !slot.locked &&
            slot.tier < 15 &&
            row.slotIds.includes(`${piece.index}:${j}`)
          )
            add(row, "수치 재설정", j);
        });
      }
      // Critical replacement allocation may report missing lines even when the
      // types already exist on every part. Raising one existing line can free
      // another for a different goal, without acquiring a duplicate type.
      if (
        row.missingCount &&
        ["crit", "critDamage", "critical"].includes(row.key)
      ) {
        eq.slots.forEach((slot, j) => {
          if (
            slot.option === "none" ||
            slot.locked ||
            slot.tier >= 15 ||
            !types.includes(slot.option)
          )
            return;
          const improved = structuredClone(s);
          improved.equipment[piece.index].slots[j] = {
            ...slot,
            tier: 15,
            value: tierValue(slot.option, 15)!,
          };
          const after = deficits(improved, stage);
          if (
            rows.every(
              (r, k) =>
                after[k].missingCount <= r.missingCount &&
                after[k].missingValue <= r.missingValue + 1e-7,
            ) &&
            rows.some(
              (r, k) =>
                after[k].missingCount < r.missingCount ||
                after[k].missingValue < r.missingValue - 1e-7,
            )
          )
            add(row, "수치 재설정", j);
        });
      }
    }
  }
  result.candidates.sort(
    (a, b) =>
      // Prefer a path that preserves contributors without paying for irreversible new locks.
      a.newLockSlots.length - b.newLockSlots.length ||
      comparePriority(
        pieces[a.partIndex].protection,
        pieces[b.partIndex].protection,
      ) ||
      a.partIndex - b.partIndex,
  );
  result.reason = result.candidates.length
    ? "4부위 합산 부족량과 기여 옵션 보존에 따른 작업 후보입니다. 최적 행동을 보장하지 않습니다."
    : "모든 기여 옵션을 보존할 작업 후보가 없습니다. 잠금 상태와 목표를 검토하세요. 무리한 효과 변경은 권하지 않습니다.";
  return result;
}

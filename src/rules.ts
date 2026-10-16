import { OPTION_WEIGHTS, SLOT_PROBABILITIES, TIER_PROBABILITIES } from './data/tiers';
import { OPTIONS, type Option, type Slot } from './model';

export type DrawOrder = 'forward' | 'reverse';
export type Requirements = Partial<Record<Option, number>>;
export const kinds = OPTIONS.map(o => o.id);

export function tierDistribution(current: Slot, option: Option, _action: '효과 변경' | '수치 재설정'): number[] {
  const excluded = current.option === option ? current.tier : 0;
  const denominator = 1 - (TIER_PROBABILITIES[excluded - 1] ?? 0);
  return TIER_PROBABILITIES.map((p, i) => i + 1 === excluded ? 0 : p / denominator);
}

export function tierTail(current: Slot, option: Option, tier: number): number {
  return tierDistribution(current, option, '효과 변경').reduce((sum, p, i) => sum + (i + 1 >= tier ? p : 0), 0);
}

/** Explicit hypothesis: independent presence, locked kinds excluded first, weighted draw without replacement. */
export function completionEventProbability(slots: Slot[], requirements: Requirements, locks: number[],
  action: '효과 변경' | '수치 재설정', order: DrawOrder = 'forward'): number {
  const required = Object.entries(requirements) as [Option, number][];
  const tail = slots.map(s => Object.fromEntries(required.map(([o, t]) => [o, tierTail(s, o, t)])) as Requirements);
  const used = new Set<Option>();
  const remaining = new Map(required);
  for (const j of locks) {
    const s = slots[j];
    if (s.option === 'none') return 0;
    used.add(s.option);
    if (remaining.has(s.option)) {
      if (s.tier < remaining.get(s.option)!) return 0;
      remaining.delete(s.option);
    }
  }
  if (action === '수치 재설정') {
    let p = 1;
    for (const [o] of remaining) {
      const j = slots.findIndex(s => s.option === o);
      if (j < 0 || locks.includes(j)) return 0;
      p *= tail[j][o]!;
    }
    return p;
  }
  const indices = (order === 'forward' ? [0, 1, 2] : [2, 1, 0]).filter(j => !locks.includes(j));
  const visit = (i: number): number => {
    if (!remaining.size) return 1;
    if (indices.length - i < remaining.size) return 0;
    const j = indices[i], appearance = SLOT_PROBABILITIES[j];
    let result = (1 - appearance) * visit(i + 1);
    const denominator = kinds.reduce((sum, o) => sum + (used.has(o) ? 0 : OPTION_WEIGHTS[o]), 0);
    for (const o of kinds) {
      if (used.has(o)) continue;
      used.add(o);
      const minimum = remaining.get(o);
      if (minimum !== undefined) remaining.delete(o);
      result += appearance * OPTION_WEIGHTS[o] / denominator *
        (minimum === undefined ? 1 : tail[j][o]!) * visit(i + 1);
      if (minimum !== undefined) remaining.set(o, minimum);
      used.delete(o);
    }
    return result;
  };
  return Math.max(0, Math.min(1, visit(0)));
}

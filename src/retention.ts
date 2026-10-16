import { OPTION_WEIGHTS, RULES, SLOT_PROBABILITIES } from './data/tiers';
import { type Option, type Slot } from './model';
import { kinds, tierTail, type Requirements, type DrawOrder } from './rules';
import { policyExpectation, type CompletionPolicy, type PolicyNode } from './probability';

/** Monotone acquisition DP: retain qualifying lines, lock them on the next roll.
 * Reject outcomes with a below-threshold target kind. Non-target kinds/tiers can be
 * marginalized exactly: future target probabilities do not depend on their old tiers.
 */
export function retentionPolicy(slots: Slot[], required: Requirements, order: DrawOrder):
  { cost: number; policy: CompletionPolicy; locks: number[] } | null {
  const requirements = Object.entries(required) as [Option, number][];
  if (requirements.length > 3) return null;
  const fixed = slots.map(s => s.locked ? s.option : 'none');
  if (slots.some(s => s.locked && s.option !== 'none' && required[s.option] && s.tier < required[s.option]!)) return null;
  const root = slots.map(s => s.option !== 'none' && required[s.option] && s.tier >= required[s.option]! ? s.option : 'none');
  const nodes: PolicyNode[] = [], memo = new Map<string, number>();
  const solved = (state: string[]) => requirements.every(([o]) => state.includes(o));
  const lockPositions = (state: string[]) => [0, 1, 2].filter(j => fixed[j] !== 'none' || state[j] !== 'none');
  const newLockCost = (before: number, after: number) => {
    let cost = 0;
    for (let k = before; k < after; k++) cost += RULES.newPermanentLockModules[k];
    return cost;
  };
  const build = (state: string[], initial = false): number => {
    if (solved(state)) return -1;
    const key = `${initial}:` + state.join(',');
    const cached = memo.get(key); if (cached !== undefined) return cached;
    const locks = lockPositions(state);
    if (locks.length > 2) return -2;
    const used = new Set<Option>(locks.map(j => (fixed[j] !== 'none' ? fixed[j] : state[j]) as Option));
    const indices = (order === 'forward' ? [0, 1, 2] : [2, 1, 0]).filter(j => !locks.includes(j));
    const next = [...state], outcomes = new Map<string, { state: string[]; probability: number }>();
    const visit = (i: number, probability: number) => {
      if (i === indices.length) {
        if (next.every((o, j) => o === state[j])) return;
        // Existing relevant lines must survive at least their current tier, even in partial results.
        if (initial && slots.some(s => s.option !== 'none' && required[s.option] && !next.includes(s.option))) return;
        const k = next.join(',');
        const old = outcomes.get(k);
        if (old) old.probability += probability;
        else outcomes.set(k, { state: [...next], probability });
        return;
      }
      const j = indices[i], appearance = SLOT_PROBABILITIES[j];
      if (appearance < 1) visit(i + 1, probability * (1 - appearance));
      const denominator = kinds.reduce((sum, o) => sum + (used.has(o) ? 0 : OPTION_WEIGHTS[o]), 0);
      for (const o of kinds) {
        if (used.has(o)) continue;
        const minimum = required[o];
        const pass = minimum ? tierTail(initial ? slots[j] : { option: 'none', tier: 0, value: 0, locked: false }, o, minimum) : 1;
        if (!pass) continue;
        used.add(o); next[j] = minimum ? o : 'none';
        visit(i + 1, probability * appearance * OPTION_WEIGHTS[o] / denominator * pass);
        next[j] = 'none'; used.delete(o);
      }
    };
    visit(0, 1);
    const transitions: PolicyNode['transitions'] = [];
    for (const outcome of outcomes.values()) {
      const child = build(outcome.state);
      if (child === -2) continue;
      const setup = child === -1 ? 0 : newLockCost(locks.length, lockPositions(outcome.state).length);
      transitions.push({ probability: outcome.probability, next: child, setup });
    }
    if (!transitions.length) return -2;
    const index = nodes.length;
    nodes.push({ modules: RULES.rerollModules[locks.length], transitions }); memo.set(key, index);
    return index;
  };
  const id = build(root, true);
  if (id < 0) return null;
  const locks = lockPositions(root);
  const policy = { nodes, root: id, setup: newLockCost(slots.filter(s => s.locked).length, locks.length) };
  return { cost: policyExpectation(policy), policy, locks };
}

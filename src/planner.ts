import { RULES, tierValue } from './data/tiers';
import { OPTIONS, PARTS, type State, type Stage, type Option, type TargetOption, type NextAction } from './model';
import { completionEventProbability, type Requirements, type DrawOrder } from './rules';
import { expectedCost, eventPolicy, type CompletionEvent, type CompletionPolicy } from './probability';
import { retentionPolicy } from './retention';

interface Assignment { part: number; option: Option; key: TargetOption; tier: number }
interface LocalPlan { cost: number; event?: CompletionEvent; policy?: CompletionPolicy; action?: NextAction }
export interface AllocationPlan {
  cost: number; assignments: Assignment[]; pieces: LocalPlan[];
  diagnostics: { allocations: number; localEvaluations: number; milliseconds: number; limited: boolean };
}
const bitCount = (n: number) => n.toString(2).replace(/0/g, '').length;
const label = (o: Option) => OPTIONS.find(x => x.id === o)!.short;

/** Globally enumerate placements; compare whole-goal events and monotone retention policies.
 * This is NOT an adaptive Bellman optimum. See docs/ENGINE.md for the policy boundary.
 */
export function planAllocation(s: State, stage: Stage, order: DrawOrder = 'forward',
  audit: { refine?: boolean; shortlistSize?: number } = {}): AllocationPlan | null {
  const start = performance.now(), target = s.targets[stage];
  const rows = Object.entries(target).filter(([, r]) => r.lines > 0) as [TargetOption, State['targets'][Stage][TargetOption]][];
  const memo = new Map<string, LocalPlan>();
  let evaluations = 0, allocations = 0, limited = false;
  const wanted = (o: Option) => target[o].lines > 0 || (target.critical.lines > 0 && (o === 'crit' || o === 'critDamage'));
  const local = (part: number, assignments: Assignment[]): LocalPlan => {
    const slots = s.equipment[part].slots, requirements: Requirements = {};
    for (const a of assignments) if (a.part === part) requirements[a.option] = a.tier;
    // Never destroy a currently useful kind or reduce its tier in this conservative policy.
    for (const slot of slots) if (slot.option !== 'none' && wanted(slot.option))
      requirements[slot.option] = Math.max(requirements[slot.option] ?? 0, slot.tier);
    const key = `${part}:` + Object.entries(requirements).sort().map(([o, t]) => `${o}=${t}`).join(',');
    const saved = memo.get(key);
    if (saved) return saved;
    evaluations++;
    const required = Object.entries(requirements) as [Option, number][];
    if (required.every(([o, t]) => slots.some(slot => slot.option === o && slot.tier >= t))) {
      const done = { cost: 0 }; memo.set(key, done); return done;
    }
    const existing = slots.flatMap((x, j) => x.locked ? [j] : []);
    let best: LocalPlan = { cost: Infinity };
    let unlocked: number | null = null, locked: number | null = null;
    for (let mask = 0; mask < 8; mask++) {
      if (bitCount(mask) > 2 || existing.some(j => !(mask & (1 << j)))) continue;
      const locks = [0, 1, 2].filter(j => mask & (1 << j));
      const added = locks.filter(j => !existing.includes(j));
      if (added.some(j => slots[j].option === 'none' || !requirements[slots[j].option as Option])) continue;
      const setup = added.reduce((sum, _, i) => sum + RULES.newPermanentLockModules[existing.length + i], 0);
      for (const action of ['효과 변경', '수치 재설정'] as const) {
        const probability = completionEventProbability(slots, requirements, locks, action, order);
        if (!(probability > 0)) continue;
        const event = { probability, modules: RULES.rerollModules[locks.length], setup };
        const cost = expectedCost([event]);
        if (added.length) locked = Math.min(locked ?? Infinity, cost);
        else unlocked = Math.min(unlocked ?? Infinity, cost);
        if (cost < best.cost) best = { cost, event, policy: eventPolicy(event), action: {
          part: PARTS[part], action, lockSlots: locks, newLockSlots: added,
          modules: event.modules, lockCost: setup, firstExecutionModules: setup + event.modules,
          strategy: { unlockedExpected: null, lockedExpected: null },
          reason: `${required.map(([o, t]) => `${label(o)} ${t}단계 이상`).join(' + ')}을 이 부위에서 함께 확보하는 배분입니다. 목표를 만족하지 않으면 기존 결과를 유지하세요. 중간 유효 옵션을 얻으면 입력을 갱신해 재계산하세요.`,
        } };
      }
    }
    const progressive = retentionPolicy(slots, requirements, order);
    if (progressive) {
      const added = progressive.locks.filter(j => !existing.includes(j));
      if (added.length) locked = Math.min(locked ?? Infinity, progressive.cost);
      else unlocked = Math.min(unlocked ?? Infinity, progressive.cost);
      if (progressive.cost < best.cost) best = { cost: progressive.cost, policy: progressive.policy, action: {
        part: PARTS[part], action: '효과 변경', lockSlots: progressive.locks, newLockSlots: added,
        modules: RULES.rerollModules[progressive.locks.length], lockCost: progressive.policy.setup,
        firstExecutionModules: RULES.rerollModules[progressive.locks.length] + progressive.policy.setup,
        strategy: { unlockedExpected: null, lockedExpected: null },
        reason: `${required.map(([o, t]) => `${label(o)} ${t}단계 이상`).join(' + ')}을 단계적으로 확보합니다. 기존 유효 옵션을 보존하면서 위 기준을 만족하는 새 옵션이 생기면 채용하고 다음 실행에서 잠급니다. 기준 미달인 목표 옵션이 섞인 결과는 이 정책에서 유지(취소)합니다. 결과를 입력하면 배분을 다시 비교합니다.`,
      } };
    }
    if (best.action) best.action.strategy = { unlockedExpected: unlocked, lockedExpected: locked };
    // Runtime memo only, bounded below the requested 50,000 entries. No baked data.
    if (memo.size >= 49000) memo.delete(memo.keys().next().value!);
    memo.set(key, best);
    return best;
  };
  const evaluate = (a: Assignment[]) => {
    const pieces = PARTS.map((_, p) => local(p, a));
    return { cost: pieces.reduce((sum, p) => sum + p.cost, 0), assignments: a.map(x => ({ ...x })), pieces };
  };
  type Candidate = ReturnType<typeof evaluate>;
  let best: Candidate | null = null;
  const shortlist: { score: number; assignments: Assignment[] }[] = [];
  const shortlistSize = audit.shortlistSize ?? 32;
  const occupied = PARTS.map(() => new Set<Option>()), assigned: Assignment[] = [];
  const visit = (row: number) => {
    if (allocations >= 100000) { limited = true; return; }
    if (row === rows.length) {
      allocations++;
      const candidate = evaluate(assigned);
      if (Number.isFinite(candidate.cost) && (!best || candidate.cost < best.cost)) best = candidate;
      const lower = evaluate(assigned.map(a => ({ ...a, tier: 1 })));
      if (Number.isFinite(lower.cost) && (shortlist.length < shortlistSize || lower.cost < (shortlist.at(-1)?.score ?? -Infinity))) {
        shortlist.push({ score: lower.cost, assignments: assigned.map(a => ({ ...a })) });
        shortlist.sort((a, b) => a.score - b.score);
        if (shortlist.length > shortlistSize) shortlist.pop();
      }
      return;
    }
    const [key, r] = rows[row];
    const choices = PARTS.flatMap((_, part) => (key === 'critical' ? ['crit', 'critDamage'] as Option[] : [key]).map(option => ({ part, option })));
    const choose = (offset: number, remaining: number) => {
      if (!remaining) { visit(row + 1); return; }
      for (let i = offset; i <= choices.length - remaining; i++) {
        const { part, option } = choices[i];
        if (occupied[part].size >= 3 || occupied[part].has(option)) continue;
        const tier = Array.from({ length: 15 }, (_, n) => n + 1).find(t => tierValue(key, t)! * r.lines + 1e-7 >= r.total);
        if (tier === undefined) continue;
        occupied[part].add(option); assigned.push({ part, option, key, tier });
        choose(i + 1, remaining - 1);
        assigned.pop(); occupied[part].delete(option);
      }
    };
    choose(0, r.lines);
  };
  visit(0);
  // Refine promising placements using actual existing values as credits, then marginal cost.
  // Bounded candidate search, not an exhaustive search over all 15^12 tier allocations.
  if (best) shortlist.push({ score: (best as Candidate).cost, assignments: (best as Candidate).assignments });
  for (const entry of audit.refine === false ? [] : shortlist) {
    const a = entry.assignments.map(x => ({ ...x, tier: s.equipment[x.part].slots.find(slot => slot.option === x.option)?.tier || 1 }));
    for (const [key, r] of rows) {
      const group = a.filter(x => x.key === key);
      let total = group.reduce((sum, x) => sum + tierValue(key, x.tier)!, 0);
      while (total + 1e-7 < r.total) {
        let selected: Assignment | undefined, delta = Infinity;
        for (const x of group) {
          if (x.tier >= 15) continue;
          const before = local(x.part, a).cost;
          x.tier++;
          const after = local(x.part, a).cost;
          x.tier--;
          const increase = after - before;
          if (increase < delta) { delta = increase; selected = x; }
        }
        if (!selected) break;
        total += tierValue(key, selected.tier + 1)! - tierValue(key, selected.tier)!;
        selected.tier++;
      }
    }
    if (rows.some(([key, r]) => a.filter(x => x.key === key).reduce((sum, x) => sum + tierValue(key, x.tier)!, 0) + 1e-7 < r.total)) continue;
    const candidate = evaluate(a);
    if (Number.isFinite(candidate.cost) && (!best || candidate.cost < best.cost)) best = candidate;
  }
  if (!best) return null;
  return { ...(best as Candidate), diagnostics: { allocations, localEvaluations: evaluations, milliseconds: performance.now() - start, limited } };
}

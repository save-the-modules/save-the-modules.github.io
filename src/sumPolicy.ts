import { OPTIONS, PARTS, type State, type Stage, type NextAction } from './model';
import { OPTION_WEIGHTS, RULES, SLOT_PROBABILITIES, TIER_PROBABILITIES, tierValue } from './data/tiers';

// A deliberately limited, reproducible policy, not a Bellman optimum. Integer
// hundredths are used for goal sums; normalized shortfalls ONLY rank actions.
const kinds = OPTIONS.map(o => o.id);
const values = kinds.map(o => Array.from({ length: 16 }, (_, t) => t ? Math.round(tierValue(o, t)! * 100) : 0));
const weights = kinds.map(o => OPTION_WEIGHTS[o]);
export interface Gear { kind: number[]; tier: number[]; locked: boolean[] }
export interface SumContext { counts: number[]; totals: number[]; active: number[]; allocations: number[][]; critical?: boolean }
export interface SumSettings { adaptive: boolean; lockTier: number; individual: boolean }
export interface SumAction { part: number; reset: boolean; locks: number[]; setup: number; modules: number; allocation: number[] }
export interface Samples { costs: number[]; mean: number; standardError: number; censored: number; rolls: number }
export function gearFromState(s: State): Gear {
  const slots = s.equipment.flatMap(e => e.slots);
  return { kind: slots.map(s => kinds.indexOf(s.option as typeof kinds[number])), tier: slots.map(s => s.tier), locked: slots.map(s => s.locked) };
}
export const copyGear = (g: Gear): Gear => ({ kind: [...g.kind], tier: [...g.tier], locked: [...g.locked] });
// Only the policy view merges critical kinds. The raw draw MUST retain their
// physical identities, separate weights and same-kind/tier exclusions.
function policyGear(c: SumContext, g: Gear, onePerPart = false): Gear {
  if (!c.critical) return g;
  const kind = g.kind.map(o => o === 7 ? 6 : o);
  if (onePerPart) for (let p = 0; p < 4; p++) {
    const js = [3 * p, 3 * p + 1, 3 * p + 2].filter(j => kind[j] === 6)
      .sort((a, b) => Number(g.locked[b]) - Number(g.locked[a]) || g.tier[b] - g.tier[a]);
    // A placement promises one critical line on this part. Surplus physical
    // critical kinds must not become mandatory companions and block the other
    // two target kinds. They still count in the actual terminal sum.
    for (const j of js.slice(1)) kind[j] = -1;
  }
  return { ...g, kind };
}
function fitsLocks(mask: number, g: Gear, p: number): boolean {
  let occupied = 0, covered = 0;
  for (let j = p * 3; j < p * 3 + 3; j++) if (g.locked[j]) { occupied++; covered |= 1 << g.kind[j]; }
  return occupied + bitCount(mask & ~covered) <= 3;
}
export function sumContext(s: State, stage: Stage): SumContext | null {
  const target = s.targets[stage];
  const active = kinds.flatMap((o, i) => target[o].lines ? [i] : []);
  // Specific crit plus wildcard needs exclusive assignment and still uses the
  // analytic fallback. Pure wildcard has one logical, either-kind contribution.
  const critical = target.critical.lines > 0;
  if (critical && (target.crit.lines || target.critDamage.lines || target.critical.lines > 4)) return null;
  if (critical) active.push(6);
  if (active.length > 4 || !active.length) return null;
  const counts = kinds.map(o => target[o].lines), totals = kinds.map(o => Math.ceil(target[o].total * 100 - 1e-7));
  if (critical) { counts[6] = target.critical.lines; totals[6] = Math.ceil(target.critical.total * 100 - 1e-7); }
  if (active.some(o => totals[o] > counts[o] * values[o][15])) return null;
  const allocations: number[][] = [], a = [0, 0, 0, 0], gear = gearFromState(s);
  if (critical) gear.kind = gear.kind.map(o => o === 7 ? 6 : o);
  const visit = (i: number) => {
    if (i === active.length) {
      if (a.some((mask, p) => !fitsLocks(mask, gear, p))) return;
      allocations.push([...a]); return;
    }
    const o = active[i];
    for (let mask = 1; mask < 16; mask++) {
      if (bitCount(mask) !== counts[o]) continue;
      for (let p = 0; p < 4; p++) if (mask & (1 << p)) a[p] |= 1 << o;
      if (a.every(x => bitCount(x) <= 3)) visit(i + 1);
      for (let p = 0; p < 4; p++) if (mask & (1 << p)) a[p] &= ~(1 << o);
    }
  };
  visit(0);
  return allocations.length ? { active, counts, totals, allocations, critical } : null;
}
const bitCount = (n: number) => { let count = 0; for (; n; n &= n - 1) count++; return count; };
function totals(g: Gear, a?: number[]) {
  const count = kinds.map(() => 0), sum = kinds.map(() => 0);
  for (let j = 0; j < 12; j++) if (g.kind[j] >= 0 && (!a || (a[Math.floor(j / 3)] & (1 << g.kind[j])))) { count[g.kind[j]]++; sum[g.kind[j]] += values[g.kind[j]][g.tier[j]]; }
  return { count, sum };
}
export function sumMet(c: SumContext, g: Gear, settings: SumSettings): boolean {
  g = policyGear(c, g);
  const t = totals(g);
  if (!settings.individual) return c.active.every(o => t.count[o] >= c.counts[o] && t.sum[o] >= c.totals[o]);
  return c.active.every(o => g.kind.filter((kind, j) => kind === o && values[o][g.tier[j]] * c.counts[o] >= c.totals[o]).length >= c.counts[o]);
}
// Rank placements by retained kinds, then retained value. No probability claim
// is attached to this heuristic. All feasible placements are considered here.
function placementScore(c: SumContext, g: Gear, a: number[]): number {
  let result = -0.01 * a.reduce((n, mask) => n + bitCount(mask) ** 2, 0);
  for (let j = 0; j < 12; j++) if (g.kind[j] >= 0 && (a[Math.floor(j / 3)] & (1 << g.kind[j])))
    result += 100 + values[g.kind[j]][g.tier[j]] / values[g.kind[j]][15];
  return result;
}
export function choosePlacement(c: SumContext, g: Gear): number[] {
  g = policyGear(c, g, true);
  let best = c.allocations[0], score = -Infinity;
  for (const a of c.allocations) {
    if (a.some((mask, p) => !fitsLocks(mask, g, p))) continue;
    const v = placementScore(c, g, a);
    if (v > score) { best = a; score = v; }
  }
  return best;
}
function score(c: SumContext, g: Gear, a: number[], individual: boolean): [number, number] {
  let count = 0;
  for (let j = 0; j < 12; j++) if (g.kind[j] >= 0 && (a[Math.floor(j / 3)] & (1 << g.kind[j]))) count++;
  const t = totals(g, a);
  const quality = individual
    ? g.kind.reduce((n, o, j) => n + (o >= 0 && (a[Math.floor(j / 3)] & (1 << o)) ? Math.min(values[o][g.tier[j]], c.totals[o] / c.counts[o]) / values[o][15] : 0), 0)
    : c.active.reduce((n, o) => n + Math.min(t.sum[o], c.totals[o]) / values[o][15], 0);
  return [count, quality];
}
export function acceptSum(c: SumContext, before: Gear, after: Gear, settings: SumSettings, fixed: number[]): boolean {
  if (sumMet(c, after, settings)) return true;
  before = policyGear(c, before, true); after = policyGear(c, after, true);
  const a = settings.adaptive ? choosePlacement(c, before) : fixed;
  const b = settings.adaptive ? choosePlacement(c, after) : fixed;
  const x = score(c, before, a, settings.individual), y = score(c, after, b, settings.individual);
  // Retain each acquired kind and each option's capped global sum. This keeps
  // credits used for permanent locks valid after later whole-result decisions.
  const old = totals(before, a), next = totals(after, b);
  if (c.active.some(o => Math.min(next.count[o], c.counts[o]) < Math.min(old.count[o], c.counts[o]) ||
    (!settings.individual && Math.min(next.sum[o], c.totals[o]) < Math.min(old.sum[o], c.totals[o])))) return false;
  return y[0] > x[0] || (y[0] === x[0] && y[1] > x[1] + 1e-10);
}
export function decideSum(c: SumContext, g: Gear, settings: SumSettings, fixed: number[]): SumAction | null {
  if (sumMet(c, g, settings)) return null;
  g = policyGear(c, g, true);
  const a = settings.adaptive ? choosePlacement(c, g) : fixed, t = totals(g, a);
  // Water-fill remaining contributions, crediting real high rolls and paid
  // locks. This is a target SUM allocation, never an average-tier floor.
  const quotas = c.active.map(o => {
    if (settings.individual) return c.totals[o] / c.counts[o];
    let remaining = c.totals[o];
    const free: number[] = [];
    for (let p = 0; p < 4; p++) {
      const j = g.kind.findIndex((kind, index) => kind === o && Math.floor(index / 3) === p);
      const value = j < 0 ? 0 : values[o][g.tier[j]];
      if ((a[p] & (1 << o)) && !(j >= 0 && g.locked[j])) free.push(value);
      else if (a[p] & (1 << o)) remaining -= value;
    }
    free.sort((x, y) => y - x);
    for (let i = 0; i < free.length; i++) {
      const quota = remaining / (free.length - i);
      if (free[i] <= quota) return Math.max(0, quota);
      remaining -= free[i];
    }
    return 0;
  });
  let best: SumAction | null = null, bestPriority = -Infinity;
  for (let p = 0; p < 4; p++) {
    const js = [p * 3, p * 3 + 1, p * 3 + 2];
    const required = c.active.filter(o => a[p] & (1 << o));
    const missing = required.filter(o => !js.some(j => g.kind[j] === o)).length;
    const needsValue = (j: number) => {
      const o = g.kind[j];
      if (o < 0 || !required.includes(o)) return 0;
      if (!settings.individual && t.sum[o] >= c.totals[o]) return 0;
      return Math.max(0, quotas[c.active.indexOf(o)] - values[o][g.tier[j]] - 1e-7);
    };
    // A low wanted kind can be upgraded with a reset BEFORE hunting its
    // companion. This is the path omitted by the former retention DP.
    const reset = missing === 0 || js.some(j => !g.locked[j] && needsValue(j) > 0);
    let locks = js.filter(j => g.locked[j]);
    // Only lock values already sufficient for their share during acquisition.
    // During resets, a completed global sum may be protected even at tier 1.
    for (const j of [...js].reverse()) {
      const o = g.kind[j];
      if (o < 0 || !required.includes(o) || g.locked[j] || locks.length >= 2) continue;
      if (c.critical && o === 6 && locks.some(k => g.kind[k] === 6)) continue;
      const sufficient = needsValue(j) === 0;
      if ((reset && sufficient) || (!reset && g.tier[j] >= settings.lockTier && sufficient)) locks.push(j);
    }
    if (locks.length >= 3) continue;
    let potential = 0;
    for (const j of js) {
      const o = g.kind[j];
      if (o < 0 || !required.includes(o) || locks.includes(j)) continue;
      const deficit = needsValue(j);
      potential += Math.min(deficit, values[o][15] - values[o][g.tier[j]]) / values[o][15];
    }
    if (reset && potential <= 0) continue;
    const oldLocks = js.filter(j => g.locked[j]).length;
    const setup = locks.slice(oldLocks).reduce((n, _, i) => n + RULES.newPermanentLockModules[oldLocks + i], 0);
    const modules = RULES.rerollModules[locks.length];
    // Finish kinds first; reset the piece with the most recoverable sum deficit.
    const priority = missing ? 100 + missing / modules : potential / modules;
    if (priority > bestPriority) { bestPriority = priority; best = { part: p, reset, locks, setup, modules, allocation: a }; }
  }
  return best;
}
export function randomGenerator(seed: number): () => number {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** Draw all slots before apply/reject. Locks were paid and installed by caller. */
export function drawSum(g: Gear, action: SumAction, random: () => number): Gear {
  const next = copyGear(g), start = action.part * 3;
  let used = 0;
  for (let j = start; j < start + 3; j++) if (g.locked[j] && g.kind[j] >= 0) used |= 1 << g.kind[j];
  for (let j = start; j < start + 3; j++) {
    if (g.locked[j]) continue;
    let o = g.kind[j];
    if (!action.reset) {
      o = -1;
      if (random() < SLOT_PROBABILITIES[j - start]) {
        let total = 0; for (let k = 0; k < 9; k++) if (!(used & (1 << k))) total += weights[k];
        let r = random() * total;
        for (let k = 0; k < 9; k++) if (!(used & (1 << k)) && (r -= weights[k]) < 0) { o = k; break; }
      }
    }
    next.kind[j] = o; next.tier[j] = 0;
    if (o < 0) continue;
    used |= 1 << o;
    const excluded = g.kind[j] === o ? g.tier[j] : 0;
    let r = random() * (1 - (TIER_PROBABILITIES[excluded - 1] ?? 0));
    for (let tier = 1; tier <= 15; tier++) if (tier !== excluded && (r -= TIER_PROBABILITIES[tier - 1]) < 0) { next.tier[j] = tier; break; }
  }
  return next;
}
export function simulateSum(c: SumContext, initial: Gear, settings: SumSettings, n: number, seed: number,
  draw = drawSum, maxRolls = 2_000_000): Samples {
  const random = randomGenerator(seed), fixed = choosePlacement(c, initial), costs: number[] = [];
  let censored = 0, rolls = 0;
  for (let i = 0; i < n; i++) {
    let g = copyGear(initial), cost = 0;
    while (!sumMet(c, g, settings) && cost < 20000 && rolls < maxRolls) {
      const action = decideSum(c, g, settings, fixed);
      if (!action) break;
      cost += action.setup + action.modules; rolls++;
      for (const j of action.locks) g.locked[j] = true;
      const next = draw(g, action, random);
      if (acceptSum(c, g, next, settings, fixed)) g = next;
    }
    if (!sumMet(c, g, settings)) { censored++; costs.push(Infinity); } else costs.push(cost);
    if (rolls >= maxRolls) { censored += n - i - 1; break; }
  }
  const mean = censored ? Infinity : costs.reduce((n, x) => n + x, 0) / n;
  const standardError = censored || n < 2 ? Infinity : Math.sqrt(costs.reduce((v, x) => v + (x - mean) ** 2, 0) / (n - 1) / n);
  return { costs, mean, standardError, censored, rolls };
}
export function sampleProbability(costs: number[], budget: number): number | null {
  if (!Number.isFinite(budget) || budget < 0 || !costs.length) return null;
  return costs.filter(c => c <= budget).length / costs.length;
}
export function sampleInterval(costs: number[], budget: number): [number, number] | null {
  const p = sampleProbability(costs, budget);
  if (p === null) return null;
  const n = costs.length, z = 1.96, d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
export function sumNextAction(action: SumAction): NextAction {
  return { part: PARTS[action.part], action: action.reset ? '수치 재설정' : '효과 변경',
    lockSlots: action.locks.map(j => j % 3), newLockSlots: [], modules: action.modules, lockCost: action.setup,
    firstExecutionModules: action.setup + action.modules, strategy: { unlockedExpected: null, lockedExpected: null },
    reason: action.reset ? '종류를 유지하면서 4부위 실제 합계의 부족분을 보완합니다. 낮은 단계라도 다른 부위의 높은 수치와 합산합니다. 결과를 입력해 다음 행동을 갱신하세요.'
      : '낮은 단계의 목표 옵션도 종류 확보에 활용하고, 이후 수치 재설정을 비교하는 경로입니다. 결과를 입력해 다음 행동을 갱신하세요.' };
}

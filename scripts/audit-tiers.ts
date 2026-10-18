import { fixture } from './validate-sums';
import { retentionPolicy } from '../src/retention';
import { completionEventProbability } from '../src/rules';
import { tierValue } from '../src/data/tiers';

// Exhaustive Pareto frontier of threshold allocations for the reference
// distributed placement: (code+attack) x3 and (code+ammo) x1. Initial gear is
// identical. Costs are the old policy, so this isolates its tier-search loss.
// With the first three code tiers fixed, the cheapest feasible fourth tier is
// the smallest meeting the code sum; likewise attack's third tier. Local costs
// are monotone in thresholds. Ammo has one line and therefore needs tier >=8.
const s = fixture(), slots = s.equipment[0].slots;
const v = (o: string, t: number) => Math.round(tierValue(o, t)! * 100);
const local = (required: { code: number; attack?: number; ammo?: number }) => Math.min(
  retentionPolicy(slots, required, 'forward')!.cost,
  1 / completionEventProbability(slots, required, [], '효과 변경'));
const pair = Array.from({ length: 16 }, () => new Array<number>(16));
const ammo: number[] = [];
for (let c = 1; c <= 15; c++) {
  for (let a = 1; a <= 15; a++) pair[c][a] = local({ code: c, attack: a });
  ammo[c] = local({ code: c, ammo: 8 });
}
const need = (o: string, value: number) => Array.from({ length: 15 }, (_, i) => i + 1).find(t => v(o, t) >= value);
let best = Infinity, tiers: number[] = [], checked = 0;
for (let c1 = 1; c1 <= 15; c1++) for (let c2 = 1; c2 <= 15; c2++) for (let c3 = 1; c3 <= 15; c3++) {
  const c4 = need('code', 7740 - v('code', c1) - v('code', c2) - v('code', c3));
  if (!c4) continue;
  for (let a1 = 1; a1 <= 15; a1++) for (let a2 = 1; a2 <= 15; a2++) {
    const a3 = need('attack', 2910 - v('attack', a1) - v('attack', a2));
    if (!a3) continue;
    checked++;
    const cost = pair[c1][a1] + pair[c2][a2] + pair[c3][a3] + ammo[c4];
    if (cost < best) { best = cost; tiers = [c1, c2, c3, c4, a1, a2, a3, 8]; }
  }
}
console.log(JSON.stringify({ scope: 'old policy, distributed reference placement, exhaustive monotone threshold frontier', best, tiers, checked }));

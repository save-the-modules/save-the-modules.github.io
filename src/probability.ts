/** Independent geometric completion events, with one-time setup and integer roll costs. */
export interface CompletionEvent {
  probability: number;
  modules: number;
  setup: number;
}

export interface PolicyNode {
  modules: number;
  transitions: { probability: number; next: number; setup: number }[];
}
/** Child nodes precede parents. next=-1 means terminal success; missing mass is rejection. */
export interface CompletionPolicy { nodes: PolicyNode[]; root: number; setup: number }
export function eventPolicy(e: CompletionEvent): CompletionPolicy {
  return { nodes: [{ modules: e.modules, transitions: [{ probability: e.probability, next: -1, setup: 0 }] }], root: 0, setup: e.setup };
}
export function policyExpectation(policy: CompletionPolicy): number {
  const values: number[] = [];
  for (const n of policy.nodes) {
    const p = n.transitions.reduce((sum, t) => sum + t.probability, 0);
    values.push(p > 0 ? (n.modules + n.transitions.reduce((sum, t) => sum + t.probability * (t.setup + (t.next < 0 ? 0 : values[t.next])), 0)) / p : Infinity);
  }
  return policy.setup + (policy.root < 0 ? 0 : values[policy.root]);
}
export function combinePolicies(policies: CompletionPolicy[]): CompletionPolicy {
  const nodes: PolicyNode[] = [];
  let root = -1, setup = 0;
  for (const policy of [...policies].reverse()) {
    const offset = nodes.length, nextRoot = root, nextSetup = setup;
    for (const n of policy.nodes) nodes.push({ modules: n.modules, transitions: n.transitions.map(t => ({
      probability: t.probability, next: t.next < 0 ? nextRoot : offset + t.next,
      setup: t.setup + (t.next < 0 ? nextSetup : 0),
    })) });
    root = offset + policy.root; setup = policy.setup;
  }
  return { nodes, root, setup };
}
/** Budget DP with a short ring buffer: memory depends on costs, never on the budget. */
export function policyProbability(policy: CompletionPolicy, budget: number): number | null {
  if (!Number.isFinite(budget) || budget < 0) return null;
  const b = Math.floor(budget) - policy.setup;
  if (b < 0) return 0;
  if (policy.root < 0) return 1;
  const delay = Math.max(...policy.nodes.map(n => n.modules + Math.max(0, ...n.transitions.map(t => t.setup)))) + 1;
  const values = policy.nodes.map(() => new Float64Array(delay));
  const sums = policy.nodes.map(n => Math.min(1, n.transitions.reduce((sum, t) => sum + t.probability, 0)));
  for (let amount = 0; amount <= b; amount++) {
    for (let i = 0; i < policy.nodes.length; i++) {
      const n = policy.nodes[i], previous = amount - n.modules;
      let p = previous >= 0 ? (1 - sums[i]) * values[i][previous % delay] : 0;
      for (const t of n.transitions) {
        const rest = previous - t.setup;
        if (rest >= 0) p += t.probability * (t.next < 0 ? 1 : values[t.next][rest % delay]);
      }
      values[i][amount % delay] = Math.min(1, p);
    }
    // Only round when the absolute numerical probability error is below 1e-12.
    if (values[policy.root][amount % delay] >= 1 - 1e-12) return 1;
  }
  return values[policy.root][b % delay];
}

export function expectedCost(events: CompletionEvent[]): number {
  return events.reduce((sum, e) => sum + e.setup + e.modules / e.probability, 0);
}

/** O(events * budget), no exponential approximation and no truncated-tail normalization. */
export function completionProbability(events: CompletionEvent[], budget: number): number | null {
  if (!Number.isFinite(budget) || budget < 0) return null;
  if (events.some(e => !(e.probability > 0 && e.probability <= 1) ||
    !Number.isInteger(e.modules) || e.modules < 1 || !Number.isInteger(e.setup) || e.setup < 0)) return null;
  const b = Math.floor(budget) - events.reduce((sum, e) => sum + e.setup, 0);
  if (b < events.reduce((sum, e) => sum + e.modules, 0)) return 0;
  if (!events.length) return 1;
  let distribution = new Float64Array(b + 1);
  distribution[0] = 1;
  for (const e of events) {
    const next = new Float64Array(b + 1);
    for (let n = e.modules; n <= b; n++)
      next[n] = e.probability * distribution[n - e.modules] + (1 - e.probability) * next[n - e.modules];
    distribution = next;
  }
  return Math.max(0, Math.min(1, distribution.reduce((sum, p) => sum + p, 0)));
}

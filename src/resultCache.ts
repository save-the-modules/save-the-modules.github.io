import {
  costSignature,
  inputSignature,
  recommend,
  STAGES,
  targetSignature,
  type EngineResult,
  type State,
} from "./model";
import { simpleProbability } from "./engine";

// A bounded, per-dataset memory cache. Demo and user data never share entries.
export class CostCache {
  private entries = new Map<string, EngineResult>();
  private key(s: State, demo: boolean) {
    return `${demo}:${costSignature(s)}`;
  }
  put(s: State, demo: boolean, result: EngineResult) {
    if (
      result.source !== (demo ? "demo" : "engine") ||
      result.inputSignature !== inputSignature(s)
    )
      return;
    const key = this.key(s, demo);
    this.entries.delete(key);
    this.entries.set(key, structuredClone(result));
    if (this.entries.size > 12)
      this.entries.delete(this.entries.keys().next().value!);
  }
  get(s: State, demo: boolean): EngineResult | null {
    const saved = this.entries.get(this.key(s, demo));
    if (!saved) return null;
    const result = structuredClone(saved);
    result.inputSignature = inputSignature(s);
    for (const stage of STAGES)
      result.goals[stage].successProbability = simpleProbability(
        s.resources.modules.budget,
        result.goals[stage].expectedModules,
      );
    result.recommendedStage = recommend(result, s.style);
    return result;
  }
}
export function recordBaselines(s: State, r: EngineResult) {
  for (const stage of STAGES) {
    const goal = r.goals[stage],
      signature = targetSignature(s.targets[stage]);
    if (
      goal.expectedModules !== null &&
      (!s.baselines[stage] || s.baselines[stage]?.signature !== signature)
    )
      s.baselines[stage] = { signature, cost: goal.expectedModules };
  }
  // Recommendations never change the user's selected goal.
}

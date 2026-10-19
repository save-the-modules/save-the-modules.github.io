import { type GoalResult, type State, type Stage, OPTIONS, PARTS } from './model';
import { choosePlacement, decideSum, gearFromState, sampleProbability, simulateSum, sumContext, sumNextAction, type SumSettings } from './sumPolicy';

/** Pilot selection is separate from the displayed holdout. A censored run is
 * NEVER used as a finite expectation or normalized success distribution. */
export function estimateSum(s: State, stage: Stage, analyticCost: number): GoalResult | null {
  const c = sumContext(s, stage);
  if (!c) return null;
  const initial = gearFromState(s), start = performance.now();
  const candidates: SumSettings[] = [false, true].map(adaptive => ({ adaptive, individual: false, lockTier: 1 }));
  let best: SumSettings | null = null, bestCost = analyticCost;
  for (const settings of candidates) {
    const pilot = simulateSum(c, initial, settings, 128, 71023, undefined, 80000);
    if (!pilot.censored && pilot.mean + 3 * pilot.standardError < bestCost) { best = settings; bestCost = pilot.mean; }
  }
  if (!best) return null;
  const seed = 981723, samples = simulateSum(c, initial, best, 2048, seed, undefined, 800000);
  if (samples.censored || samples.mean + 3 * samples.standardError >= analyticCost) return null;
  const action = decideSum(c, initial, best, choosePlacement(c, initial));
  if (!action) return null;
  const nextAction = sumNextAction(action);
  nextAction.newLockSlots = action.locks.filter(j => !initial.locked[j]).map(j => j % 3);
  const mode = best.adaptive ? '결과마다 종류 배분도 재선택' : '종류 배분 유지';
  const names = (mask: number) => OPTIONS.flatMap((o, i) => mask & (1 << i) ? [c.critical && i === 6 ? '크크 (크확 또는 크뎀)' : o.short] : []);
  nextAction.reason += ` ${mode}, 합계 배분은 매번 갱신합니다. 현재 부위의 배정 종류: ${names(action.allocation[action.part]).join(' · ')}. 배정된 종류별 줄 수와 목표까지의 합계가 줄지 않으면서 하나라도 늘어난 결과를 채용하는 정책입니다.`;
  return {
    expectedModules: samples.mean, successProbability: sampleProbability(samples.costs, s.resources.modules.budget),
    simulation: { costs: samples.costs, standardError: samples.standardError, samples: samples.costs.length, adaptive: best.adaptive, seed },
    nextAction, stable: false,
    allocation: action.allocation.map((mask, p) => ({ part: PARTS[p], expectedModules: null,
      targets: names(mask).map(name => `${name} · 전체 합계로 보완`) })),
    diagnostics: { allocations: c.allocations.length, localEvaluations: samples.rolls, milliseconds: performance.now() - start, limited: false },
    reason: `가정 기반 모의실험 · ${mode}. 낮은 단계 채용·수치 재설정·실제 합계 보완 정책입니다. 별도 검증 표본 ${samples.costs.length.toLocaleString()}회, 평균의 근사 95% 오차 ±${(1.96 * samples.standardError).toFixed(1)}개. 제한된 정책 비교이며 최적해가 아닙니다.`,
  };
}

import { achievement, equipmentIssues, inputSignature, OPTIONS, PARTS, recommend, STAGES,
  type EngineResult, type GoalResult, type State, type Stage } from './model';
import { RULES } from './data/tiers';
import { evaluatePieces } from './fastGuide';
import { planAllocation } from './planner';
import { combinePolicies, policyProbability } from './probability';
export { tierDistribution } from './rules';

export const ENGINE_ASSUMPTIONS = [
  '가정 기반 보수적 모델입니다. 4부위 배분마다 일괄 달성 정책과 유효 옵션을 단계적으로 채용·잠금하는 DP 정책을 비교합니다. 모든 적응형 전략의 최적해는 아닙니다.',
  '미검증 가정: 2·3번 줄 등장 여부는 독립이며, 잠긴 종류를 먼저 제외하고 1→2→3번 순서로 중복 없이 10/12% 가중치를 재정규화하여 추첨합니다. 공식 조건부 분포 확인이 필요합니다.',
  '사용자 확인 규칙: 같은 슬롯에서 같은 종류가 나오면 현재 단계를 제외합니다. 12/7/1% 확률 재정규화 및 슬롯별 수치 추첨 독립성을 가정합니다.',
  '결과 취소 시 이전 옵션·단계가 유지되고 새 영구 잠금은 남는다는 사용자 확인을 반영했습니다. 새 잠금 2·3개는 첫 실행에 한 번만, 리롤 1/2/3개는 매번 소모합니다.',
  '예산 확률은 선택된 정책의 상태 전이와 모듈 비용에 대한 예산 DP로 계산합니다. 평균 비용에서 역산하지 않습니다. 다시 입력하면 배분·정책이 바뀔 수 있습니다. 1에 대한 오차가 1e-12 이하일 때만 100%로 반올림합니다.',
  '옵션 배분은 최대 10만 조합, 수치 배분은 균등 배분과 유망한 최대 33개 배치의 현재 수치·한계비용 탐색입니다. 단계적 정책은 기준 이상인 목표 옵션을 잠그며 기준 미달 목표 옵션이 섞인 결과는 거절합니다. 배분 밖의 옵션·초과 수치 이득은 선반영하지 않습니다.',
  '현재 목표에 관련된 옵션의 종류와 수치는 낮추지 않으며 기존 잠금은 해제하지 않습니다. 더 경제적인 손실·해제 전략이 있을 수 있습니다. 임시 잠금권과 최초 개조 비용은 제외합니다.',
];

export function lockSetupCost(existing: number, added: number): number | null {
  if (!Number.isInteger(existing) || !Number.isInteger(added) || existing < 0 || added < 0 || existing + added > 2) return null;
  return Array.from({ length: added }, (_, i) => RULES.newPermanentLockModules[existing + i]).reduce((a, n) => a + n, 0);
}
export function preservationValues(s: State, stage: Stage): number[][] {
  return evaluatePieces(s, stage).map(p => s.equipment[p.index].slots.map((_, j) => p.protectedSlots.includes(j) ? 1 : 0));
}
export function calculateGoal(input: State, stage: Stage): GoalResult {
  const status = achievement(input, stage).status;
  const unavailable = (reason: string): GoalResult => ({ expectedModules: null, successProbability: null, nextAction: null, reason, stable: false });
  if (status === 'empty') return unavailable('목표를 먼저 설정해 주세요.');
  if (status === 'invalid') return unavailable(equipmentIssues(input).join(' ') || '전체 목표가 12줄을 초과했습니다.');
  if (status === 'met') return {
    expectedModules: 0, successProbability: 1, completionPolicy: { nodes: [], root: -1, setup: 0 }, stable: true,
    reason: '선택한 목표를 이미 달성했습니다.',
    nextAction: { part: PARTS[0], action: '사용 중단', lockSlots: [], newLockSlots: [], modules: 0, lockCost: 0,
      firstExecutionModules: 0, strategy: { unlockedExpected: 0, lockedExpected: null }, reason: '목표 달성 · 추가 모듈 사용을 중단하세요.' },
  };
  const plan = planAllocation(input, stage);
  if (!plan) return unavailable('보존 정책에서 가능한 배분을 찾지 못했습니다. 기존 잠금·목표의 최대 수치·중복 종류 제한을 확인하세요. 불가능한 게임 목표라는 판정은 아닙니다.');
  const policy = combinePolicies(plan.pieces.flatMap(p => p.policy ? [p.policy] : []));
  const first = plan.pieces.filter(p => p.action).sort((a, b) => a.cost - b.cost)[0];
  return {
    expectedModules: plan.cost, successProbability: policyProbability(policy, input.resources.modules.budget),
    completionPolicy: policy, nextAction: first?.action ?? null, stable: false,
    allocation: plan.pieces.map((p, i) => ({ part: PARTS[i], expectedModules: p.cost,
      targets: plan.assignments.filter(a => a.part === i).map(a => `${OPTIONS.find(o => o.id === a.option)!.short} ${a.tier}단계 이상`) })),
    diagnostics: plan.diagnostics,
    reason: `가정 기반 · ${plan.diagnostics.allocations.toLocaleString()}개 배분 비교. 단계적 확보·잠금 DP와 일괄 달성 경로를 비교한 보수적 정책입니다.${plan.diagnostics.limited ? ' 배분 탐색 한도에 도달해 일부 조합은 제외했습니다.' : ''}`,
  };
}
export function calculate(s: State, source: EngineResult['source'] = 'engine'): EngineResult {
  const result: EngineResult = { source, inputSignature: inputSignature(s),
    goals: Object.fromEntries(STAGES.map(k => [k, calculateGoal(s, k)])) as EngineResult['goals'],
    recommendedStage: null, assumptions: ENGINE_ASSUMPTIONS };
  result.recommendedStage = recommend(result, s.style);
  return result;
}

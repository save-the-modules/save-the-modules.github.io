import { achievement, equipmentIssues, inputSignature, OPTIONS, PARTS, recommend, STAGES,
  type EngineResult, type GoalResult, type State, type Stage } from './model';
import { RULES } from './data/tiers';
import { evaluatePieces } from './fastGuide';
import { planAllocation } from './planner';
import { combinePolicies, policyProbability } from './probability';
import { estimateSum } from './sumEstimate';
export { tierDistribution } from './rules';

export const ENGINE_ASSUMPTIONS = [
  '목표 종류 4종 이하에서는 낮은 단계 채용 후 수치 재설정과 합계 재배분 정책도 비교합니다. 크크는 크확 또는 크뎀이 나오는 대로 채용하며 같은 단계의 크확 수치로 합산합니다. 실제 추첨에서는 두 종류의 확률·중복·동일 수치 제외를 별도로 유지합니다. 종류 배분 유지/재선택을 예비 표본으로 비교하고, 선택 정책을 새로운 2,048회 표본으로 평가합니다. 표본 오차가 있으며 전역 최적해가 아닙니다.',
  '모의실험 예산 확률은 완료 비용 표본의 경험분포입니다. 0/100% 관측은 불가능/보장을 뜻하지 않습니다. 실행 한도에 걸린 표본을 제외해 평균을 낮추지 않으며, 그런 정책은 기존 해석적 정책으로 돌아갑니다. 크크와 별도 크확/크뎀 목표를 동시에 요구하는 경우, 크크 5줄 이상, 목표 종류 5종 이상도 기존 정책을 사용합니다. 화면의 정책명이 다르면 직접 비용 비교에 주의하세요.',
  '기존 해석적 모델도 비교 기준으로 유지합니다. 4부위 배분마다 일괄 달성 정책과 유효 옵션을 단계적으로 채용·잠금하는 DP 정책을 비교합니다. 모든 적응형 전략의 최적해는 아닙니다.',
  '미검증 가정: 2·3번 줄 등장 여부는 독립이며, 잠긴 종류를 먼저 제외하고 1→2→3번 순서로 중복 없이 10/12% 가중치를 재정규화하여 추첨합니다. 공식 조건부 분포 확인이 필요합니다.',
  '사용자 확인 규칙: 같은 슬롯에서 같은 종류가 나오면 현재 단계를 제외합니다. 12/7/1% 확률 재정규화 및 슬롯별 수치 추첨 독립성을 가정합니다.',
  '결과 취소 시 이전 옵션·단계가 유지되고 새 영구 잠금은 남는다는 사용자 확인을 반영했습니다. 새 잠금 2·3개는 첫 실행에 한 번만, 리롤 1/2/3개는 매번 소모합니다.',
  '해석적 정책의 예산 확률은 상태 전이와 모듈 비용에 대한 예산 DP로 계산합니다. 평균 비용에서 역산하지 않습니다. 다시 입력하면 배분·정책이 바뀔 수 있습니다. DP에서는 1에 대한 오차가 1e-12 이하일 때만 100%로 반올림합니다.',
  '해석적 정책의 옵션 배분은 최대 10만 조합, 수치 배분은 균등 배분과 유망한 최대 33개 배치의 현재 수치·한계비용 탐색입니다. 이 정책은 기준 미달 목표 옵션이 섞인 결과를 거절하며, 배분 밖의 옵션·초과 수치 이득은 선반영하지 않습니다.',
  '모의실험 정책은 배정 종류별 줄 수와 목표까지의 합산 기여를 보존하며 높은 실제 수치로 남은 할당량을 낮춥니다. 기존 해석적 정책은 각 기존 유효 줄의 수치까지 보존합니다. 두 정책 모두 기존 잠금을 해제하지 않습니다. 더 경제적인 손실·해제 전략이 있을 수 있습니다. 임시 잠금권과 최초 개조 비용은 제외합니다.',
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
  const sum = estimateSum(input, stage, plan?.cost ?? Infinity);
  if (sum) return sum;
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

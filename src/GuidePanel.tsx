import { Check, Calculator, LockKeyhole, Sparkles, Info } from "lucide-react";
import {
  achievement,
  deficits,
  lineCount,
  progress,
  STAGES,
  STAGE_NAMES,
  type EngineResult,
  type State,
} from "./model";
import { RULES } from "./data/tiers";
import { sampleInterval } from './sumPolicy';
import { NumberField } from "./controls";
import type { Update } from "./TargetEditor";
import { FastGuidePanel } from "./FastGuidePanel";
import { isMissing, optionName, type FastGuide } from "./fastGuide";
export function GuidePanel({
  state,
  update,
  result,
  guide,
  stale,
  busy,
  onCalculate,
  isDemo,
}: {
  state: State;
  update: Update;
  result: EngineResult | null;
  guide: FastGuide;
  stale: boolean;
  busy: boolean;
  onCalculate: () => void;
  isDemo: boolean;
}) {
  const selected = state.ui.selectedGoal,
    g = result?.goals[selected],
    a = g?.nextAction;
  const threshold = state.style === "safe" ? 0.9 : 0.5;
  return (
    <>
      <div className="view-heading">
        <div>
          <h2>최적화 가이드</h2>
          <p>장비 수정 시 다음 행동 후보가 자동으로 갱신됩니다.</p>
        </div>
      </div>
      <section className="budget-panel panel compact-budget">
        <label>
          사용 가능한 모듈 개수
          <NumberField
            value={state.resources.modules.budget}
            onChange={(budget) =>
              update((s) => {
                s.resources.modules = { owned: budget, budget };
              })
            }
            integer
            label="사용 가능한 모듈 개수"
            suffix="개"
          />
        </label>
        <div className="compact-style" aria-label="투자 성향">
          {(["safe", "challenge"] as const).map((k) => (
            <button
              key={k}
              className={state.style === k ? "selected" : ""}
              aria-pressed={state.style === k}
              onClick={() =>
                update((s) => {
                  s.style = k;
                })
              }
            >
              {k === "safe" ? "안정형 90%" : "도전형 50%"}
            </button>
          ))}
        </div>
        <button
          className="button primary calculate-button"
          disabled={busy}
          onClick={onCalculate}
        >
          <Calculator size={17} />
          {busy ? "계산 중…" : "최적화 계산"}
        </button>
      </section>
      {stale && (
        <div className="notice stale-notice" role="status">
          장비·목표가 변경되어 이전 비용과 확률을 숨겼습니다. 현재 입력으로 자동 재계산합니다.
        </div>
      )}
      {isDemo && (
        <p className="demo-result-label">
          예시 장비 · 사용자 데이터와 분리된 데모 결과입니다.
        </p>
      )}
      <div className="compare-heading">
        <h3>목표별 투자 비교</h3>
        <details className="probability-info">
          <summary aria-label="예산 내 달성 확률의 계산 정책 설명">
            <Info size={16} /> 예상 달성 확률
          </summary>
          <p>
            선택 정책의 완료 비용 분포에서 계산합니다. 모의실험 결과에는 표본 오차가 있습니다. 첫 잠금 비용과
            매회 리롤 비용을 구분하며, 평균 비용에서 확률을 역산하지 않습니다.
            중간 결과를 채용해 재계산하면 정책이 달라집니다. 미검증 추첨 가정에 의존합니다.
          </p>
        </details>
      </div>
      <p className="notice" role="note">
        가정 기반 보수적 계산 · 추첨 순서·독립성·중복 제외 후 확률은 공식 확인 전입니다.
        낮은 단계 채용 후 수치 재설정·합계 보완 경로도 비교하며, 모든 전략의 최소 비용은 아닙니다.
      </p>
      <div className="goal-comparison">
        {STAGES.map((stage) => {
          const r = result?.goals[stage],
            status = achievement(state, stage).status,
            pct = r ? progress(state, stage, r) : null;
          const interval = r?.simulation ? sampleInterval(r.simulation.costs, state.resources.modules.budget) : null;
          return (
            <button
              key={stage}
              className={`comparison-card panel ${selected === stage ? "selected" : ""}`}
              aria-pressed={selected === stage}
              onClick={() =>
                update((s) => {
                  s.ui.selectedGoal = stage;
                })
              }
            >
              <div>
                <b>{STAGE_NAMES[stage]}</b>
                {result?.recommendedStage === stage && (
                  <span className="gold-pill">추천</span>
                )}
                <span className="selection-check">
                  {selected === stage && <Check size={13} />}
                </span>
              </div>
              <span
                className={`goal-status ${status === "met" ? "green" : ""}`}
              >
                {
                  (
                    {
                      met: "달성 완료",
                      unmet: "미달성",
                      empty: "목표 미설정",
                      invalid: "입력 확인",
                    } as const
                  )[status]
                }{" "}
                · {lineCount(state.targets[stage])}줄
              </span>
              <dl>
                <dt>{r?.simulation ? '합계 보완 정책 예상 소모 (추정)' : '보수적 정책 예상 소모'}</dt>
                <dd>
                  {!r
                    ? "계산 전"
                    : r.expectedModules === null
                      ? "계산 불가"
                      : `약 ${r.expectedModules.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}개`}
                </dd>
                <dt>같은 정책의 예산 내 확률</dt>
                <dd
                  className={
                    r?.successProbability !== null &&
                    (r?.successProbability ?? -1) >= threshold
                      ? "gold"
                      : ""
                  }
                >
                  {!r
                    ? "계산 전"
                    : r.successProbability === null
                      ? "계산 불가"
                      : r.simulation && (r.successProbability === 0 || r.successProbability === 1)
                        ? `${(r.successProbability * 100).toFixed(1)}% (표본 관측)`
                      : r.successProbability > 0 && r.successProbability < 0.0005
                        ? "0.1% 미만"
                        : r.successProbability < 1 && r.successProbability >= 0.9995
                          ? "99.9% 초과"
                          : `${(r.successProbability * 100).toFixed(1)}%`}
                  {interval && <small style={{ display: 'block' }}>표본 95% 구간 {(interval[0] * 100).toFixed(1)}–{(interval[1] * 100).toFixed(1)}%</small>}
                </dd>
              </dl>
              <ul
                className="goal-deficits"
                aria-label={`${STAGE_NAMES[stage]} 부족 옵션`}
              >
                {deficits(state, stage).map((d) => (
                  <li key={d.key} className={isMissing(d) ? "" : "green"}>
                    {optionName(d.key)}{" "}
                    {isMissing(d)
                      ? `부족 ${d.missingCount}줄 · ${d.missingValue.toFixed(2)}%`
                      : "충족"}
                  </li>
                ))}
              </ul>
              <span className="criteria">
                {!r
                  ? "자동 계산 대기 중"
                  : r.successProbability === null
                    ? "추천 기준 판정 불가"
                    : r.successProbability >= threshold
                      ? "투자 성향 기준 충족"
                      : "예산 부족 · 기준 미달"}
              </span>
              {pct !== null && (
                <div className="goal-progress">
                  <progress
                    max={1}
                    value={pct}
                    aria-label={`${STAGE_NAMES[stage]} 목표 비용 감소 진행률`}
                  />
                  <small>최초 계산 대비 {(pct * 100).toFixed(0)}%</small>
                </div>
              )}
            </button>
          );
        })}
      </div>
      {result && !result.recommendedStage && (
        <p className="compact-note">
          추천 기준을 충족한 목표가 없습니다. 다른 목표도 직접 선택할 수
          있습니다.
        </p>
      )}
      {!result && <FastGuidePanel guide={guide} state={state} isDemo={isDemo} />}
      {result && (
        <details open className="next-action panel cost-action">
          <summary>비용 계산 경로의 첫 행동 · 현재 장비 기준</summary>
          <div className="action-topline">
            <span>
              <Sparkles size={17} />
              {STAGE_NAMES[selected]} · 다음 행동
            </span>
            <span className="small-badge">
              {result ? "가정 기반 배분 비교" : "계산 전"}
            </span>
          </div>
          {!result ? (
            <div className="engine-empty">
              <h3>최적화 계산으로 다음 작업을 확인하세요.</h3>
              <p>장비·목표·모듈 예산이 준비되면 위 버튼을 눌러 주세요.</p>
            </div>
          ) : a ? (
            <>
              <div className="next-action-heading">
                <h2>
                  {a.action === "사용 중단"
                    ? "목표 달성 · 모듈 사용 중단"
                    : `${a.part} · ${a.action}`}
                </h2>
              </div>
              <p>{a.reason}</p>
              {a.action !== "사용 중단" && (
                <>
                  <div className="action-details">
                    <div>
                      <small>
                        <LockKeyhole size={13} />
                        잠금 대상
                      </small>
                      <b>
                        {a.lockSlots.length
                          ? a.lockSlots
                              .map(
                                (j) =>
                                  `${j + 1}번${a.newLockSlots.includes(j) ? " (새 잠금)" : ""}`,
                              )
                              .join(", ")
                          : "추가 잠금 없음"}
                      </b>
                    </div>
                    <div>
                      <small>첫 실행 모듈</small>
                      <b>
                        {a.firstExecutionModules}개{" "}
                        <small>
                          잠금 {a.lockCost} + 리롤 {a.modules}
                        </small>
                      </b>
                    </div>
                    <div>
                      <small>현재 잠금 유지 시</small>
                      <b>회당 {a.modules}개</b>
                    </div>
                  </div>
                  {a.strategy.lockedExpected !== null && (
                    <p className="strategy-comparison">
                      잔여 비용 비교 · 기존 잠금만{" "}
                      {a.strategy.unlockedExpected === null
                        ? "계산 불가"
                        : `${a.strategy.unlockedExpected.toFixed(1)}개`}{" "}
                      / 추가 잠금 포함 {a.strategy.lockedExpected.toFixed(1)}개
                    </p>
                  )}
                  {state.resources.modules.budget < a.firstExecutionModules && (
                    <p className="notice error">
                      첫 실행에 {a.firstExecutionModules}개가 필요합니다. 현재
                      사용 가능 모듈이 부족합니다.
                    </p>
                  )}
                  <p className="compact-note">
                    잠금 선택만으로 모듈을 차감하지 않습니다. 새 잠금 비용은
                    게임에서 첫 리롤 실행 시 한 번만 반영합니다.
                  </p>
                </>
              )}
            </>
          ) : (
            <div className="engine-empty">
              <h3>추천 가능한 경로를 계산할 수 없습니다.</h3>
            </div>
          )}
          {g && (
            <p
              className={`result-reason ${g.expectedModules === null ? "warning-text" : ""}`}
            >
              {g.reason}
            </p>
          )}
          {g?.allocation && (
            <div className="piece-priorities">
              <h3>4부위 목표 배분</h3>
              <ul>{g.allocation.map(p => <li key={p.part}>
                <b>{p.part}</b> · {p.targets.join(' + ') || '추가 목표 없음'}{p.expectedModules === null ? '' : ` · 약 ${p.expectedModules.toFixed(1)}개`}
              </li>)}</ul>
              <p>{g.simulation ? '부위별 최소 단계는 고정하지 않습니다. 종류를 확보한 뒤 실제 높은 수치를 나머지 합계 부족분에 반영합니다.' : '현재 유효 옵션은 추가로 보존합니다. 높은 현재 수치를 다른 부위의 목표 합계에 반영합니다.'}</p>
            </div>
          )}
          <p className="approx-label">
            {isDemo ? "데모 결과 · " : ""}표시된 배분과 정책의 비교 결과입니다. 목표 배분 변경이나
            더 폭넓은 적응형 전략은 더 저렴할 수 있습니다. 변경 결과를 입력하고 다시 확인하세요.
          </p>
        </details>
      )}
      {result && (
        <details className="panel model-details">
          <summary>계산 범위와 제외한 규칙</summary>
          {result.assumptions.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </details>
      )}
      <details className="panel source-details">
        <summary>데이터 출처 · 검증 범위</summary>
        <p>
          {RULES.source}. 135개 수치와 10/12% 옵션 가중치, 슬롯 100/50/30%, 단계
          12/7/1%를 등록했습니다.
        </p>
        <p>
          크리티컬 등장 확률은 사용자 교차 검증에 따라 크확 12%·크뎀 10%로
          교정했습니다. 첨부 표에서 이 두 확률만 예외입니다.
        </p>
        <p>
          <a
            href="https://www.prydwen.gg/nikke/guides/overload-gear-reroll/"
            target="_blank"
            rel="noreferrer"
          >
            Prydwen 비용 안내
          </a>{" "}
          ·{" "}
          <a
            href="https://nikke.gg/september-17-patch-notes/"
            target="_blank"
            rel="noreferrer"
          >
            9월 17일 패치노트 11.2 (전재)
          </a>
        </p>
        <p>
          사용자가 확인한 첫·둘째 영구 잠금 비용 2·3개 및 동일 조합 재추첨
          규칙을 반영합니다. 세 번째 잠금, 임시 잠금권, 잠금 후 옵션 종류의
          조건부 추첨은 위에 명시한 가정으로 계산합니다.
        </p>
      </details>
    </>
  );
}

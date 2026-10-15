import { Check, Calculator, LockKeyhole, Sparkles } from "lucide-react";
import {
  achievement,
  lineCount,
  progress,
  STAGES,
  STAGE_NAMES,
  type EngineResult,
  type State,
} from "./model";
import { RULES } from "./data/tiers";
import { NumberField } from "./controls";
import type { Update } from "./TargetEditor";
export function GuidePanel({
  state,
  update,
  result,
  stale,
  busy,
  onCalculate,
  isDemo,
}: {
  state: State;
  update: Update;
  result: EngineResult | null;
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
          <p>게임 결과를 왼쪽에 반영하고 다시 계산하세요.</p>
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
          입력이 변경되었습니다. 이전 상태의 결과를 숨겼습니다. 최적화 계산을
          다시 실행해 주세요.
        </div>
      )}
      {isDemo && (
        <p className="demo-result-label">
          예시 장비 · 사용자 데이터와 분리된 데모 결과입니다. 확률은 단순
          근사입니다.
        </p>
      )}
      <div className="compare-heading">
        <h3>목표별 투자 비교</h3>
        <span>단순 근사 확률</span>
      </div>
      <div className="goal-comparison">
        {STAGES.map((stage) => {
          const r = result?.goals[stage],
            status = achievement(state, stage).status,
            pct = r ? progress(state, stage, r) : null;
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
                <dt>예상 모듈 소모</dt>
                <dd>
                  {!r
                    ? "계산 전"
                    : r.expectedModules === null
                      ? "계산 불가"
                      : `약 ${r.expectedModules.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}개`}
                </dd>
                <dt>단순 근사 확률</dt>
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
                      : `${(r.successProbability * 100).toFixed(1)}%`}
                </dd>
              </dl>
              <span className="criteria">
                {!r
                  ? "최적화 계산을 실행하세요."
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
      <section className="next-action panel">
        <div className="action-topline">
          <span>
            <Sparkles size={17} />
            {STAGE_NAMES[selected]} · 다음 행동
          </span>
          <span className="small-badge">
            {result ? "규칙 기반 근사" : "계산 전"}
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
                    <small>이후 반복</small>
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
        <p className="approx-label">
          {isDemo ? "데모 결과 · " : ""}단순 근사 결과입니다. 최적해·실제 성공
          확률을 보장하지 않습니다.
        </p>
      </section>
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
          조건부 추첨은 제외합니다.
        </p>
      </details>
    </>
  );
}

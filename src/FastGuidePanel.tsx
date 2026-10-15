import { Sparkles } from "lucide-react";
import { optionName, type FastGuide } from "./fastGuide";
import { STAGE_NAMES, type State } from "./model";

export function FastGuidePanel({
  guide,
  state,
  isDemo,
}: {
  guide: FastGuide;
  state: State;
  isDemo: boolean;
}) {
  return (
    <section
      className="next-action panel fast-guide"
      aria-label="실시간 빠른 가이드"
    >
      <div className="action-topline">
        <span>
          <Sparkles size={17} />
          {STAGE_NAMES[guide.stage]} · 다음 행동 후보
        </span>
        <span className="small-badge">자동 갱신</span>
      </div>
      {isDemo && (
        <p className="demo-result-label">
          데모 장비 기준 · 사용자 데이터와 분리
        </p>
      )}
      <h2>
        {guide.status === "met"
          ? "목표 달성 · 모듈 사용 중단"
          : guide.candidates.length
            ? `${guide.candidates[0].part} · ${guide.candidates[0].action} 검토`
            : "장비와 목표 확인"}
      </h2>
      <p role="status">{guide.reason}</p>
      {guide.candidates.length > 0 && (
        <ol className="fast-candidates">
          {guide.candidates.slice(0, 3).map((c, i) => (
            <li key={`${c.partIndex}:${c.action}:${c.target}:${c.slot}`}>
              <div>
                <b>
                  {i + 1}. {c.part} · {c.action}
                </b>
                <span className="small-badge">
                  {optionName(c.target)} ·{" "}
                  {c.conditional ? "조건 확인 필요" : "작업 후보"}
                </span>
              </div>
              <p>{c.reason}</p>
              <div className="candidate-facts">
                <span>
                  보존{" "}
                  {c.lockSlots.length
                    ? c.lockSlots
                        .map(
                          (j) =>
                            `${j + 1}번${c.newLockSlots.includes(j) ? " 잠금 검토" : " 기존 잠금"}`,
                        )
                        .join(" · ")
                    : "추가 잠금 없음"}
                </span>
                <span>첫 실행 {c.firstExecutionModules}모듈</span>
              </div>
              {state.resources.modules.budget < c.firstExecutionModules && (
                <p className="warning-text">첫 실행 모듈이 부족합니다.</p>
              )}
              {c.conditional && (
                <small>
                  잠금은 확정 추천이 아닙니다. 비용 비교가 가능한 경우 아래 계산
                  경로도 확인하세요.
                </small>
              )}
            </li>
          ))}
        </ol>
      )}
      {guide.pieces.length > 0 && (
        <details className="piece-priorities">
          <summary>4부위 기여도 · 작업 검토 순서</summary>
          <ol>
            {guide.pieces.map((p) => (
              <li key={p.part}>
                <b>{p.part}</b>
                <span>
                  유효 {p.usefulSlots.length}줄 ·{" "}
                  {p.protectedSlots.length
                    ? `우선 보존 ${p.protectedSlots.map((j) => `${j + 1}번 ${state.equipment[p.index].slots[j].tier}단계`).join(", ")}`
                    : "단독 손실 시 악화되는 기여 옵션 없음"}
                </span>
              </li>
            ))}
          </ol>
          <p>
            기여 옵션 수 → 3·2·1번 슬롯의 단계 순으로 보호합니다. 후보 생성
            시에는 함께 잃을 수 있는 대체 옵션도 재검사합니다. 이 순서는
            최적해가 아닌 보존 중심 검토 순서입니다.
          </p>
        </details>
      )}
    </section>
  );
}

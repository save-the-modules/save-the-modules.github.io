import { useState } from "react";
import { ArrowRight, Check, Copy, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  achievement,
  deficits,
  emptyTarget,
  lineCount,
  makeRequirement,
  STAGES,
  STAGE_NAMES,
  targetOptions,
  type State,
  type TargetOption,
} from "./model";
import { TierSelect } from "./controls";
export type Update = (fn: (s: State) => void) => void;
export function TargetEditor({
  state,
  update,
  onReset,
  notify,
}: {
  state: State;
  update: Update;
  onReset: () => void;
  notify: (m: string) => void;
}) {
  const [adding, setAdding] = useState(false),
    stage = state.ui.stage,
    target = state.targets[stage],
    rows = deficits(state, stage);
  const active = targetOptions.filter((o) => target[o.id].lines),
    available = targetOptions.filter((o) => !target[o.id].lines);
  const set = (key: TargetOption, lines: number, tier: number) =>
    update((s) => {
      s.targets[stage][key] = makeRequirement(key, lines, tier);
      delete s.baselines[stage];
    });
  return (
    <>
      <div className="view-heading">
        <div>
          <h2>목표 설정</h2>
          <p>4부위 전체의 줄 수와 합계로 판정합니다.</p>
        </div>
        <button
          className="text-button"
          onClick={() =>
            update((s) => {
              s.ui.tab = "guide";
            })
          }
        >
          가이드 <ArrowRight size={16} />
        </button>
      </div>
      <div className="stage-tabs" role="tablist" aria-label="목표 단계">
        {STAGES.map((k, i) => (
          <button
            key={k}
            id={`stage-${k}`}
            role="tab"
            aria-selected={stage === k}
            aria-controls="target-content"
            tabIndex={stage === k ? 0 : -1}
            className={stage === k ? "selected" : ""}
            onClick={() =>
              update((s) => {
                s.ui.stage = k;
              })
            }
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const n =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 2
                    : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
              update((s) => {
                s.ui.stage = STAGES[n];
              });
              document.getElementById(`stage-${STAGES[n]}`)?.focus();
            }}
          >
            <b>{STAGE_NAMES[k]}</b>
            <small>권장 {["4–8", "8–10", "12"][i]}줄</small>
          </button>
        ))}
      </div>
      <section
        className="target-content panel"
        id="target-content"
        role="tabpanel"
        aria-labelledby={`stage-${stage}`}
      >
        <div className="target-toolbar">
          <h3>
            {STAGE_NAMES[stage]} 목표{" "}
            <span className={lineCount(target) > 12 ? "red" : "gold"}>
              {lineCount(target)}
              <small> / 12줄</small>
            </span>
          </h3>
          <div className="toolbar-actions">
            {stage !== "minimum" && (
              <button
                className="button"
                onClick={() => {
                  const prev = STAGES[STAGES.indexOf(stage) - 1];
                  update((s) => {
                    s.targets[stage] = structuredClone(s.targets[prev]);
                    delete s.baselines[stage];
                  });
                  notify("이전 단계 목표를 복사했습니다.");
                }}
              >
                <Copy size={15} />
                이전 단계 복사
              </button>
            )}
            <button
              className="icon-button"
              aria-label="현재 목표 초기화"
              onClick={onReset}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
        {lineCount(target) > 12 && (
          <p className="notice error" role="alert">
            전체 {lineCount(target)}줄입니다. 12줄 이하로 줄여 주세요.
          </p>
        )}
        {!active.length && (
          <div className="empty-target">
            설정된 옵션이 없습니다. 아래에서 옵션을 추가하세요.
          </div>
        )}
        {active.map((o) => {
          const r = target[o.id],
            d = rows.find((x) => x.key === o.id);
          return (
            <section className="compact-target" key={o.id}>
              <div className="target-name">
                <h4>
                  {o.short}
                  {o.id === "critical" && (
                    <span className="tiny-badge">크확 또는 크뎀</span>
                  )}
                </h4>
                <button
                  className="icon-button"
                  aria-label={`${o.short} 목표 삭제`}
                  onClick={() => set(o.id, 0, 0)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="target-inputs">
                <label>
                  목표 줄 수
                  <div className="stepper">
                    <button
                      aria-label={`${o.short} 목표 줄 수 줄이기`}
                      onClick={() => set(o.id, r.lines - 1, r.averageTier)}
                    >
                      −
                    </button>
                    <span>{r.lines}줄</span>
                    <button
                      aria-label={`${o.short} 목표 줄 수 늘리기`}
                      disabled={r.lines === 4}
                      onClick={() => set(o.id, r.lines + 1, r.averageTier)}
                    >
                      +
                    </button>
                  </div>
                </label>
                <label>
                  평균 단계
                  <TierSelect
                    label={`${o.short} 평균 단계`}
                    value={r.averageTier}
                    option={o.id}
                    onChange={(tier) => set(o.id, r.lines, tier)}
                  />
                </label>
                <div className="goal-total">
                  <small>목표 합계 이상</small>
                  <b>
                    {r.total.toFixed(2)}
                    <span>%</span>
                  </b>
                </div>
              </div>
              <div className="inline-checks">
                <span className={d && d.missingCount === 0 ? "green" : ""}>
                  {d && d.missingCount === 0 && <Check size={13} />}줄 수{" "}
                  {d?.currentCount ?? 0} / {r.lines}
                </span>
                <span className={d && d.missingValue < 1e-7 ? "green" : ""}>
                  {d && d.missingValue < 1e-7 && <Check size={13} />}현재 합계{" "}
                  {(d?.currentValue ?? 0).toFixed(2)}%
                </span>
              </div>
            </section>
          );
        })}
        <div className="add-options">
          <button
            className="button"
            aria-expanded={adding}
            disabled={!available.length}
            onClick={() => setAdding(!adding)}
          >
            <Plus size={16} />
            옵션 추가
          </button>
          {adding && (
            <div className="option-picker" aria-label="추가할 목표 옵션">
              {available.map((o) => (
                <button
                  className="button"
                  key={o.id}
                  onClick={() => {
                    set(o.id, 1, 1);
                    setAdding(false);
                  }}
                >
                  {o.short}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="compact-note">
          평균 단계는 합계 기준입니다. 각 줄의 최소 단계를 강제하지 않습니다.
          <br />
          크크는 크확 기준 합계 · 같은 단계의 크확/크뎀은 반올림 차이 없이
          동등하게 환산하며, 동일 줄을 중복 배정하지 않습니다.
        </div>
      </section>
      <button
        className="guide-cta"
        onClick={() =>
          update((s) => {
            s.ui.tab = "guide";
          })
        }
      >
        <span>목표와 예산으로 다음 작업 확인</span>
        <span>
          가이드로 이동 <ArrowRight size={16} />
        </span>
      </button>
    </>
  );
}

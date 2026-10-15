import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Crosshair,
  Download,
  FlaskConical,
  Gem,
  Hexagon,
  Info,
  Layers3,
  LockKeyhole,
  RotateCcw,
  Shield,
  Sparkles,
  Target as TargetIcon,
  UnlockKeyhole,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import {
  achievement,
  demoResult,
  demoState,
  emptySlot,
  emptyTarget,
  initialState,
  lineCount,
  OPTIONS,
  PARTS,
  parseState,
  STAGES,
  STAGE_NAMES,
  targetOptions,
  totals,
  type Requirement,
  type Slot,
  type State,
  type TargetOption,
} from "./model";
import { tierValue, TIER_COUNT } from "./data/tiers";
import "./style.css";

const STORAGE = "stm-state-v2";
const BACKUP = "stm-invalid-state-backup";
const copy = <T,>(x: T): T => structuredClone(x);
function readSaved(): { state: State; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE);
    return { state: raw ? parseState(raw, true) : initialState(), error: "" };
  } catch {
    return {
      state: initialState(),
      error:
        "저장 데이터를 읽지 못했습니다. 기존 데이터를 보호하기 위해 자동 저장을 중지했습니다. JSON을 불러오거나 전체 초기화를 진행해 주세요.",
    };
  }
}
const saved = readSaved();
const pct = (n: number) =>
  n.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const goalStatus = {
  empty: "목표 미설정",
  invalid: "입력 오류",
  met: "달성 완료",
  unmet: "미달성",
};

function NumberField({
  value,
  onChange,
  max = 1000000,
  integer = false,
  label,
  suffix,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
  integer?: boolean;
  label: string;
  suffix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setError(false);
  }, [value]);
  return (
    <span className={`number-wrap ${error ? "input-error" : ""}`}>
      <input
        aria-label={label}
        title={
          error
            ? `0~${max} ${integer ? "정수" : "숫자"}를 입력해 주세요.`
            : label
        }
        aria-invalid={error}
        type="number"
        min="0"
        max={max}
        step={integer ? 1 : 0.01}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = Number(raw);
          const valid =
            raw !== "" &&
            Number.isFinite(n) &&
            n >= 0 &&
            n <= max &&
            (!integer || Number.isInteger(n));
          setError(!valid);
          if (valid) onChange(n);
        }}
        onBlur={() => {
          setDraft(String(value));
          setError(false);
        }}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}
function TierSelect({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
    >
      <option value="0">직접</option>
      {Array.from({ length: TIER_COUNT }, (_, i) => (
        <option key={i} value={i + 1}>
          T{i + 1}
        </option>
      ))}
    </select>
  );
}
function SlotEditor({
  slot,
  onChange,
  label,
  demo,
}: {
  slot: Slot;
  onChange: (s: Slot) => void;
  label: string;
  demo: boolean;
}) {
  const inactive = slot.option === "none";
  const changeOption = (option: Slot["option"]) => {
    if (option === "none") onChange(emptySlot());
    else {
      const v = tierValue(option, slot.tier, demo);
      onChange({
        ...slot,
        option,
        value: v ?? (slot.option === option ? slot.value : 0),
      });
    }
  };
  return (
    <div className={`slot-row ${inactive ? "empty-slot" : ""}`}>
      <select
        aria-label={`${label} 옵션 종류`}
        className="option-select"
        value={slot.option}
        onChange={(e) => changeOption(e.target.value as Slot["option"])}
      >
        <option value="none">옵션 없음</option>
        {OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.short}
          </option>
        ))}
      </select>
      <TierSelect
        label={`${label} 티어`}
        disabled={inactive}
        value={slot.tier}
        onChange={(tier) =>
          onChange({
            ...slot,
            tier,
            value: tierValue(slot.option, tier, demo) ?? slot.value,
          })
        }
      />
      <NumberField
        label={`${label} 실제 수치`}
        value={slot.value}
        disabled={inactive}
        suffix="%"
        onChange={(value) => onChange({ ...slot, value })}
      />
      <button
        className={`icon-button lock ${slot.locked ? "is-locked" : ""}`}
        aria-label={`${label} ${slot.locked ? "잠금 해제" : "잠금"}`}
        aria-pressed={slot.locked}
        disabled={inactive}
        onClick={() => onChange({ ...slot, locked: !slot.locked })}
      >
        {slot.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
      </button>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<State>(saved.state);
  const [demo, setDemo] = useState<State | null>(null);
  const [storageError, setStorageError] = useState(saved.error);
  const [protectStorage, setProtectStorage] = useState(!!saved.error);
  const [toast, setToast] = useState("");
  const [confirm, setConfirm] = useState<"equipment" | "target" | "all" | null>(
    null,
  );
  const [help, setHelp] = useState(false);
  const [rerollPart, setRerollPart] = useState(0);
  const [draft, setDraft] = useState<{
    part: number;
    before: Slot[];
    after: Slot[];
  } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const state = demo ?? user,
    isDemo = demo !== null;
  const update = (fn: (s: State) => void) => {
    const next = copy(state);
    fn(next);
    (isDemo ? setDemo : setUser)(next);
  };
  const notify = (msg: string) => setToast(msg);
  useEffect(() => {
    if (!protectStorage) {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(user));
        setStorageError("");
      } catch {
        setStorageError(
          "브라우저 저장 공간에 접근할 수 없습니다. JSON 내보내기로 데이터를 보관해 주세요.",
        );
      }
    }
  }, [user, protectStorage]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const currentStage = state.ui.stage;
  const target = state.targets[currentStage];
  const count = lineCount(target);
  const summary = totals(state);
  const filled = summary.reduce((a, s) => a + s.lines, 0);
  const result = isDemo ? demoResult(state) : null;
  const selectedGoal = state.ui.selectedGoal;
  const setRequirement = (key: TargetOption, patch: Partial<Requirement>) =>
    update((s) => {
      const r = { ...s.targets[currentStage][key], ...patch };
      r.floors = Array.from({ length: r.lines }, (_, i) => r.floors[i] ?? 0);
      if (!r.lines) {
        r.total = 0;
        r.averageTier = 0;
        r.manual = false;
      } else if (!r.manual) {
        const v = tierValue(key, r.averageTier, isDemo);
        if (v !== null) r.total = Math.round(v * r.lines * 100) / 100;
      }
      s.targets[currentStage][key] = r;
    });
  const setSlot = (part: number, slot: number, v: Slot) =>
    update((s) => {
      s.equipment[part].slots[slot] = v;
    });
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stm-${isDemo ? "demo-" : ""}${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("JSON 파일을 내보냈습니다.");
  };
  const importJSON = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 1000000)
        throw Error("1MB 이하의 JSON 파일만 불러올 수 있습니다.");
      const loaded = parseState(await file.text());
      if (isDemo) setDemo(loaded);
      else {
        setUser(loaded);
        setProtectStorage(false);
      }
      setDraft(null);
      notify(`${isDemo ? "데모에" : "사용자 데이터에"} JSON을 불러왔습니다.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "파일을 불러오지 못했습니다.");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };
  const reset = () => {
    if (confirm === "all") {
      if (protectStorage) {
        try {
          const raw = localStorage.getItem(STORAGE);
          if (raw) localStorage.setItem(BACKUP, raw);
        } catch {
          /* Preserve corrupt storage when backup fails. */
        }
      }
      (isDemo ? setDemo : setUser)(initialState());
      if (!isDemo) setProtectStorage(false);
      setDraft(null);
    } else if (confirm === "equipment") {
      update((s) => {
        s.equipment = initialState().equipment;
      });
      setDraft(null);
    } else if (confirm === "target")
      update((s) => {
        s.targets[currentStage] = emptyTarget();
      });
    setConfirm(null);
    notify("초기화했습니다.");
  };
  const staleDraft =
    draft &&
    JSON.stringify(state.equipment[draft.part].slots) !==
      JSON.stringify(draft.before);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="#" className="brand" aria-label="STM 홈">
          <span className="brand-symbol">
            <Hexagon size={27} strokeWidth={1.6} />
            <span />
          </span>
          <b>
            STM
            <span className="brand-divider" />
          </b>
          <span className="brand-full">SAVE THE MODULES</span>
        </a>
        <div className="header-actions">
          <span className="local-status">
            <span className={storageError ? "dot warn" : "dot"} />
            {storageError
              ? "저장 확인 필요"
              : isDemo
                ? "데모 · 사용자 데이터 보호 중"
                : "이 기기에 자동 저장"}
          </span>
          <button
            className={`button demo-button ${isDemo ? "active" : ""}`}
            onClick={() => {
              setDemo(isDemo ? null : demoState());
              setDraft(null);
              notify(
                isDemo
                  ? "기존 사용자 데이터를 복원했습니다."
                  : "사용자 데이터와 분리된 데모를 시작했습니다.",
              );
            }}
          >
            <FlaskConical size={15} />
            {isDemo ? "데모 종료" : "데모 체험"}
          </button>
          <button
            className="icon-button"
            aria-label="사용 안내"
            onClick={() => setHelp(!help)}
          >
            <CircleHelp size={19} />
          </button>
        </div>
      </header>
      {isDemo && (
        <div className="demo-banner">
          <FlaskConical size={15} />
          <strong>데모 모드</strong>
          <span>
            예시 결과 · 실제 계산 아님. 모든 장비 수치와 추천은 가상
            데이터입니다.
          </span>
          <button
            onClick={() => {
              setDemo(null);
              setDraft(null);
            }}
          >
            종료하고 내 데이터로 돌아가기 <ArrowRight size={14} />
          </button>
        </div>
      )}
      <main>
        <section className="page-heading">
          <div>
            <div className="eyebrow">
              <span />
              OVERLOAD EQUIPMENT PLANNER
            </div>
            <h1>
              모듈 하나도, 더 가치 있게<span>.</span>
            </h1>
            <p>
              지금의 장비에서 다음 목표까지. 나만의 오버로드 플랜을 만들어
              보세요.
            </p>
          </div>
          <div className="heading-label">
            <Shield size={16} />
            <span>
              입력 · 목표 관리 전용<b>계산 엔진 연결 준비 중</b>
            </span>
          </div>
        </section>
        {storageError && (
          <div role="alert" className="notice error">
            {storageError}
          </div>
        )}
        {help && (
          <section className="help-panel panel">
            <button
              className="icon-button close-help"
              aria-label="안내 닫기"
              onClick={() => setHelp(false)}
            >
              <X size={17} />
            </button>
            <h3>STM 시작하기</h3>
            <p>
              ① 현재 장비를 입력하고 ② 최소·타협·종결 목표를 설정하세요. ③
              가이드에서 예산을 관리하고 게임에서 얻은 새 옵션을 비교·채용할 수
              있습니다.
            </p>
            <p>
              현재 버전은 확률·기대 비용·최적 잠금 전략을 계산하지 않습니다.
              미등록 티어는 수치를 직접 입력하세요. 티어와 수치는 각각 판정에
              사용하며, 평균 티어는 목표 합계를 입력하는 빠른 선택입니다.
            </p>
            <p>
              장비의 잠금 표시는 현재 게임 상태를 기록합니다. 목표 줄별 하한은
              해당 목표에 배정된 각 줄에 적용됩니다. 옵션 종류별 목표는 최대
              4줄, 전체는 12줄입니다.
            </p>
          </section>
        )}
        <div className="workspace">
          <aside
            className={`equipment-panel panel ${state.ui.equipmentOpen ? "expanded" : ""}`}
          >
            <div className="panel-heading">
              <div className="section-title">
                <Layers3 size={18} />
                <h2>현재 장비</h2>
                <span className="small-badge">{filled} / 12줄</span>
              </div>
              <button
                className="icon-button"
                aria-label="현재 장비 초기화"
                onClick={() => setConfirm("equipment")}
              >
                <RotateCcw size={15} />
              </button>
            </div>
            <p className="panel-caption">
              게임에서 바뀐 옵션을 바로 반영하세요.
            </p>
            <button
              className="mobile-toggle button"
              aria-expanded={state.ui.equipmentOpen}
              onClick={() =>
                update((s) => {
                  s.ui.equipmentOpen = !s.ui.equipmentOpen;
                })
              }
            >
              장비 편집 {state.ui.equipmentOpen ? "접기" : "펼치기"}
              <ChevronDown size={15} />
            </button>
            <div className="equipment-body">
              <div className="column-guide">
                <span>옵션</span>
                <span>티어</span>
                <span>수치</span>
                <span>잠금</span>
              </div>
              {state.equipment.map((e, i) => (
                <section className="equipment-card" key={e.part}>
                  <div className="equipment-card-heading">
                    <span className="part-icon">
                      {i === 0 ? (
                        <Shield size={15} />
                      ) : i === 1 ? (
                        <Hexagon size={15} />
                      ) : i === 2 ? (
                        <Crosshair size={15} />
                      ) : (
                        <Layers3 size={15} />
                      )}
                    </span>
                    <h3>{e.part}</h3>
                    <span>
                      {e.slots.filter((s) => s.option !== "none").length} / 3
                    </span>
                  </div>
                  {e.slots.map((slot, j) => (
                    <SlotEditor
                      key={j}
                      slot={slot}
                      onChange={(v) => setSlot(i, j, v)}
                      label={`${e.part} ${j + 1}번 슬롯`}
                      demo={isDemo}
                    />
                  ))}
                </section>
              ))}
              <p className="micro-note">
                <Info size={13} />
                {isDemo
                  ? "데모 티어·수치는 모두 가상 데이터입니다."
                  : "티어 수치 미등록 · 실제 수치를 직접 입력해 주세요."}
              </p>
            </div>
            <section className="equipment-summary">
              <div className="subheading">
                <h3>4부위 합산</h3>
                <span>실시간 반영</span>
              </div>
              {summary.filter((s) => s.lines).length ? (
                <div className="summary-grid">
                  {summary
                    .filter((s) => s.lines)
                    .map((s) => (
                      <div key={s.id}>
                        <span>
                          {s.short} <small>{s.lines}줄</small>
                        </span>
                        <strong>
                          {pct(s.value)}
                          <small>%</small>
                        </strong>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="empty-summary">
                  옵션을 입력하면 합산 수치가 표시됩니다.
                </p>
              )}
            </section>
            <div className="equipment-footer">
              <LockKeyhole size={12} />
              잠금 상태와 입력 내용이 자동 저장됩니다.
            </div>
          </aside>

          <div className="right-workspace">
            <nav className="main-tabs" aria-label="작업 화면">
              {(
                [
                  { id: "targets", label: "목표 설정", icon: TargetIcon },
                  { id: "guide", label: "최적화 가이드", icon: Sparkles },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  aria-current={state.ui.tab === t.id ? "page" : undefined}
                  className={state.ui.tab === t.id ? "selected" : ""}
                  onClick={() =>
                    update((s) => {
                      s.ui.tab = t.id;
                    })
                  }
                >
                  <t.icon size={17} />
                  {t.label}
                  {t.id === "guide" && <span className="tab-dot" />}
                </button>
              ))}
              <span className="tabs-trailing">YOUR NEXT UPGRADE</span>
            </nav>
            {state.ui.tab === "targets" ? (
              <>
                <section className="target-intro">
                  <div>
                    <div className="eyebrow">SET YOUR DESTINATION</div>
                    <h2>어디까지 완성할까요?</h2>
                    <p>
                      4부위 전체를 기준으로, 원하는 옵션과 목표를 설정하세요.
                    </p>
                  </div>
                  <TargetIcon size={42} strokeWidth={1} />
                </section>
                <div
                  className="stage-tabs"
                  role="tablist"
                  aria-label="목표 단계"
                >
                  {STAGES.map((stage, i) => (
                    <button
                      key={stage}
                      id={`stage-${stage}`}
                      role="tab"
                      aria-selected={currentStage === stage}
                      aria-controls="target-content"
                      tabIndex={currentStage === stage ? 0 : -1}
                      onKeyDown={(event) => {
                        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                        event.preventDefault();
                        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? 2 : (i + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                        update((s) => { s.ui.stage = STAGES[nextIndex]; });
                        document.getElementById(`stage-${STAGES[nextIndex]}`)?.focus();
                      }}
                      className={currentStage === stage ? "selected" : ""}
                      onClick={() =>
                        update((s) => {
                          s.ui.stage = stage;
                        })
                      }
                    >
                      <span className="stage-number">0{i + 1}</span>
                      <span>
                        <b>{STAGE_NAMES[stage]}</b>
                        <small>
                          {
                            [
                              "첫 번째 유효 세팅",
                              "효율적인 투자 지점",
                              "마지막까지 완벽하게",
                            ][i]
                          }
                        </small>
                      </span>
                      <span className="stage-recommend">
                        {["4–8줄", "8–10줄", "12줄"][i]}
                        <small>권장</small>
                      </span>
                    </button>
                  ))}
                </div>
                <section
                  className="target-content panel"
                  id="target-content"
                  role="tabpanel"
                  aria-labelledby={`stage-${currentStage}`}
                >
                  <div className="target-toolbar">
                    <div>
                      <h3>
                        {STAGE_NAMES[currentStage]} 목표{" "}
                        <span className={count > 12 ? "red" : "gold"}>
                          {count}
                          <small> / 12줄</small>
                        </span>
                      </h3>
                      <p>
                        권장 줄 수는 가이드이며 자유롭게 설정할 수 있습니다.
                      </p>
                    </div>
                    <div className="toolbar-actions">
                      {currentStage !== "minimum" && (
                        <button
                          className="text-button"
                          onClick={() => {
                            const prev =
                              STAGES[STAGES.indexOf(currentStage) - 1];
                            update((s) => {
                              s.targets[currentStage] = copy(s.targets[prev]);
                            });
                            notify("이전 단계의 목표를 복사했습니다.");
                          }}
                        >
                          <Copy size={13} />
                          이전 단계 복사
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label="현재 목표 초기화"
                        onClick={() => setConfirm("target")}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  </div>
                  {count > 12 && (
                    <div className="notice error" role="alert">
                      전체 목표가 {count}줄입니다. 12줄 이하로 설정해 주세요. 이
                      목표의 달성 판정은 중지됩니다.
                    </div>
                  )}
                  <div className="target-column-guide">
                    <span>옵션 / 현재 합계</span>
                    <span>목표 줄 수</span>
                    <span>평균 티어</span>
                    <span>목표 합계 이상</span>
                  </div>
                  <div className="target-list">
                    {targetOptions.map((o, i) => {
                      const r = target[o.id];
                      const actual = summary.find((s) => s.id === o.id);
                      const registered =
                        tierValue(o.id, r.averageTier, isDemo) !== null;
                      const checked = achievement(state, currentStage).checks[
                        o.id
                      ];
                      return (
                        <section
                          className={`target-row ${r.lines ? "has-target" : ""} ${o.id === "critical" ? "critical-row" : ""}`}
                          key={o.id}
                        >
                          <div className="target-row-main">
                            <div className="target-option">
                              <span className={`option-icon option-${i % 4}`}>
                                {o.id === "critical" ? (
                                  <Sparkles size={15} />
                                ) : i === 0 ? (
                                  <Crosshair size={15} />
                                ) : i === 1 ? (
                                  <ArrowUpRight size={15} />
                                ) : (
                                  <Hexagon size={14} />
                                )}
                              </span>
                              <div>
                                <h4>
                                  {o.short}
                                  {o.id === "critical" && (
                                    <span className="tiny-badge">
                                      대체 목표
                                    </span>
                                  )}
                                </h4>
                                <small>
                                  {o.id === "critical"
                                    ? "크확 기준 환산"
                                    : actual?.lines
                                      ? `현재 ${actual.lines}줄 · ${pct(actual.value)}%`
                                      : "현재 옵션 없음"}
                                </small>
                              </div>
                            </div>
                            <div className="stepper">
                              <button
                                aria-label={`${o.short} 목표 줄 수 줄이기`}
                                disabled={!r.lines}
                                onClick={() =>
                                  setRequirement(o.id, { lines: r.lines - 1 })
                                }
                              >
                                −
                              </button>
                              <span aria-label={`${o.short} 목표 ${r.lines}줄`}>
                                {r.lines}
                              </span>
                              <button
                                aria-label={`${o.short} 목표 줄 수 늘리기`}
                                disabled={r.lines === 4}
                                onClick={() =>
                                  setRequirement(o.id, { lines: r.lines + 1 })
                                }
                              >
                                +
                              </button>
                            </div>
                            <TierSelect
                              label={`${o.short} 평균 티어`}
                              value={r.averageTier}
                              disabled={!r.lines}
                              onChange={(averageTier) =>
                                setRequirement(o.id, {
                                  averageTier,
                                  manual: false,
                                })
                              }
                            />
                            <NumberField
                              label={`${o.short} 목표 합산 수치`}
                              value={r.total}
                              disabled={!r.lines}
                              onChange={(total) =>
                                setRequirement(o.id, { total, manual: true })
                              }
                              suffix="%"
                            />
                          </div>
                          {!!r.lines && (
                            <div className="target-row-detail">
                              <details>
                                <summary>
                                  줄별 최소 티어 <ChevronDown size={12} />
                                  <span>
                                    {r.floors.some(Boolean)
                                      ? r.floors
                                          .map((v) =>
                                            v ? `T${v}` : "제한 없음",
                                          )
                                          .join(" / ")
                                      : "선택 사항"}
                                  </span>
                                </summary>
                                <div className="floor-inputs">
                                  {r.floors.map((floor, j) => (
                                    <label key={j}>
                                      {j + 1}번째 줄
                                      <TierSelect
                                        label={`${o.short} ${j + 1}번째 줄 하한`}
                                        value={floor}
                                        onChange={(v) => {
                                          const floors = [...r.floors];
                                          floors[j] = v;
                                          setRequirement(o.id, { floors });
                                        }}
                                      />
                                    </label>
                                  ))}
                                  <small>
                                    직접 = 하한 없음 · 줄 순서와 무관하게
                                    배정합니다.
                                  </small>
                                </div>
                              </details>
                              <span className="target-value-note">
                                {r.manual
                                  ? "직접 입력"
                                  : registered
                                    ? "티어로 자동 계산"
                                    : r.averageTier
                                      ? "티어 수치 미등록 · 합계 직접 입력"
                                      : "합계 직접 입력"}
                                <span
                                  className={
                                    checked ? "achieved-dot" : "pending-dot"
                                  }
                                  title={
                                    checked ? "현재 장비로 충족" : "목표 미충족"
                                  }
                                />
                              </span>
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                  <div className="critical-note">
                    <Info size={15} />
                    <p>
                      <b>크크 = 크확 또는 크뎀</b>
                      <span>
                        같은 줄을 중복 사용하지 않습니다. 크뎀 ÷ 2.88로 크확
                        기준 합계를 판정합니다. 같은 티어는 같은 환산 등급이며,
                        실제 전투 효율을 의미하지 않습니다.
                      </span>
                    </p>
                  </div>
                </section>
                <section className="target-progress panel">
                  <div>
                    <span className="progress-icon">
                      <CheckCheck size={20} />
                    </span>
                    <div>
                      <h3>현재 장비와 목표 비교</h3>
                      <p>장비를 수정하면 달성 현황이 즉시 반영됩니다.</p>
                    </div>
                  </div>
                  <span
                    className={`status-pill ${achievement(state, currentStage).status === "met" ? "success" : ""}`}
                  >
                    {goalStatus[achievement(state, currentStage).status]}
                  </span>
                </section>
                <button
                  className="guide-cta"
                  onClick={() =>
                    update((s) => {
                      s.ui.tab = "guide";
                    })
                  }
                >
                  <div>
                    <Sparkles size={19} />
                    <span>목표를 정했다면, 다음은 투자 계획</span>
                  </div>
                  <span>
                    가이드로 이동 <ArrowRight size={16} />
                  </span>
                </button>
              </>
            ) : (
              <>
                <section className="guide-intro">
                  <div className="eyebrow">MAKE EVERY MODULE COUNT</div>
                  <h2>다음 한 번을 위한 플랜.</h2>
                  <p>예산과 투자 성향을 정하고, 다음 행동을 확인하세요.</p>
                </section>
                <section className="budget-panel panel">
                  <div className="section-title">
                    <Wallet size={17} />
                    <h3>모듈 예산</h3>
                  </div>
                  <div className="budget-fields">
                    <label>
                      현재 보유 모듈
                      <NumberField
                        label="현재 보유 모듈"
                        integer
                        value={state.resources.modules.owned}
                        suffix="개"
                        onChange={(owned) =>
                          update((s) => {
                            s.resources.modules.owned = owned;
                            s.resources.modules.budget = Math.min(
                              owned,
                              s.resources.modules.budget,
                            );
                          })
                        }
                      />
                    </label>
                    <ArrowRight size={16} />
                    <label>
                      이번에 사용할 모듈
                      <NumberField
                        label="이번에 사용할 모듈"
                        integer
                        max={state.resources.modules.owned}
                        value={state.resources.modules.budget}
                        suffix="개"
                        onChange={(budget) =>
                          update((s) => {
                            s.resources.modules.budget = budget;
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="budget-slider">
                    <input
                      type="range"
                      aria-label="투자 모듈 예산 조정"
                      min={0}
                      max={state.resources.modules.owned}
                      value={state.resources.modules.budget}
                      onChange={(e) =>
                        update((s) => {
                          s.resources.modules.budget = Number(e.target.value);
                        })
                      }
                    />
                    <span>
                      보유량의{" "}
                      {state.resources.modules.owned
                        ? Math.round(
                            (state.resources.modules.budget /
                              state.resources.modules.owned) *
                              100,
                          )
                        : 0}
                      % 투자
                    </span>
                  </div>
                  <div className="style-options">
                    {(
                      [
                        {
                          id: "safe",
                          name: "안정형",
                          percent: "90%",
                          description: "높은 확신으로, 차근차근",
                          icon: Shield,
                        },
                        {
                          id: "challenge",
                          name: "도전형",
                          percent: "50%",
                          description: "더 높은 목표에 도전",
                          icon: Crosshair,
                        },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        className={state.style === p.id ? "selected" : ""}
                        aria-pressed={state.style === p.id}
                        onClick={() =>
                          update((s) => {
                            s.style = p.id;
                          })
                        }
                      >
                        <p.icon size={19} />
                        <span>
                          <b>
                            {p.name} <em>{p.percent}</em>
                          </b>
                          <small>{p.description}</small>
                        </span>
                        <span className="radio-dot" />
                      </button>
                    ))}
                  </div>
                  <p className="micro-note">
                    예산 내 성공 확률이 {state.style === "safe" ? 90 : 50}%
                    이상인 단계 중 가장 높은 목표를 추천합니다.
                  </p>
                </section>
                <section className="next-action panel">
                  <div className="action-topline">
                    <span>
                      <Sparkles size={16} />
                      다음 행동 추천
                    </span>
                    <span className="small-badge">
                      {isDemo ? "예시 결과 · 실제 계산 아님" : "ENGINE PENDING"}
                    </span>
                  </div>
                  {result?.nextAction ? (
                    <>
                      <div className="next-action-heading">
                        <h2>
                          {result.nextAction.part} 장비 ·{" "}
                          {result.nextAction.action}
                        </h2>
                        <span className="gold-pill">
                          {STAGE_NAMES[result.recommendedStage!]} 목표
                        </span>
                      </div>
                      <p>{result.nextAction.reason}</p>
                      <div className="action-details">
                        <div>
                          <small>잠금 대상</small>
                          <b>
                            {result.nextAction.part}{" "}
                            {result.nextAction.lockSlots
                              .map((n) => `${n + 1}번`)
                              .join(", ")}{" "}
                            슬롯
                          </b>
                        </div>
                        <div>
                          <small>예상 모듈</small>
                          <b>{result.nextAction.modules}개</b>
                        </div>
                        <div>
                          <small>예상 락키</small>
                          <b>{result.nextAction.lockKeys}개</b>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="engine-empty">
                      <span className="engine-symbol">
                        <Gem size={28} strokeWidth={1.2} />
                      </span>
                      <h3>
                        {isDemo
                          ? "현재 예산으로는 추천 기준 미달"
                          : "장비와 목표가 준비되면, 다음 행동으로."}
                      </h3>
                      <p>
                        {isDemo
                          ? "예산을 조정하거나 목표를 직접 선택해 주세요."
                          : "계산 엔진 연결 전입니다. 현재는 장비 입력과 목표 달성 현황을 확인할 수 있습니다."}
                      </p>
                      {!isDemo && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setDemo(demoState());
                            setDraft(null);
                          }}
                        >
                          가상 데이터로 가이드 체험 <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </section>
                <div className="compare-heading">
                  <h3>목표별 투자 비교</h3>
                  <span>
                    {isDemo
                      ? "예시 결과 · 실제 계산 아님"
                      : "예상 비용과 성공 확률은 계산 전입니다."}
                  </span>
                </div>
                <div className="goal-comparison">
                  {STAGES.map((stage) => {
                    const r = result?.goals[stage];
                    const suggested = result?.recommendedStage === stage;
                    const status = achievement(state, stage).status;
                    const qualified =
                      r &&
                      r.successProbability !== null &&
                      r.successProbability >=
                        (state.style === "safe" ? 0.9 : 0.5);
                    return (
                      <button
                        key={stage}
                        className={`comparison-card panel ${selectedGoal === stage ? "selected" : ""}`}
                        aria-pressed={selectedGoal === stage}
                        onClick={() =>
                          update((s) => {
                            s.ui.selectedGoal = stage;
                          })
                        }
                      >
                        <div>
                          <b>{STAGE_NAMES[stage]}</b>
                          {suggested && <span className="gold-pill">추천</span>}
                          <span className="selection-check">
                            {selectedGoal === stage && <Check size={12} />}
                          </span>
                        </div>
                        <span
                          className={`goal-status ${status === "met" ? "green" : ""}`}
                        >
                          {goalStatus[status]} ·{" "}
                          {lineCount(state.targets[stage])}줄
                        </span>
                        <dl>
                          <dt>예상 모듈</dt>
                          <dd>
                            {r?.expectedModules !== null &&
                            r?.expectedModules !== undefined
                              ? `${r.expectedModules}개`
                              : "계산 전"}
                          </dd>
                          <dt>예산 내 성공 확률</dt>
                          <dd className={qualified ? "gold" : ""}>
                            {r?.successProbability !== null &&
                            r?.successProbability !== undefined
                              ? `${Math.round(r.successProbability * 100)}%`
                              : "계산 전"}
                          </dd>
                        </dl>
                        <span className="criteria">
                          {r
                            ? qualified
                              ? "투자 성향 기준 충족"
                              : "투자 성향 기준 미달"
                            : "기준 충족 여부 · 계산 전"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="micro-note">
                  선택한 목표: {STAGE_NAMES[selectedGoal]} · 추천과 관계없이
                  목표를 직접 선택할 수 있습니다.
                  {isDemo && " 현재 추천은 고정된 데모 시나리오 기준입니다."}
                </p>
                <section className="reroll-panel panel">
                  <div className="panel-heading">
                    <div className="section-title">
                      <RotateCcw size={17} />
                      <h3>리롤 결과 비교</h3>
                    </div>
                    <span className="small-badge">직접 채용 결정</span>
                  </div>
                  <p className="panel-caption">
                    새 옵션을 비교한 후 채용하면 왼쪽 장비에 반영됩니다.
                  </p>
                  <div className="reroll-controls">
                    <select
                      aria-label="리롤 비교 장비"
                      value={rerollPart}
                      onChange={(e) => {
                        setRerollPart(Number(e.target.value));
                        setDraft(null);
                      }}
                    >
                      {PARTS.map((p, i) => (
                        <option key={p} value={i}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button"
                      onClick={() =>
                        setDraft({
                          part: rerollPart,
                          before: copy(state.equipment[rerollPart].slots),
                          after: copy(state.equipment[rerollPart].slots),
                        })
                      }
                    >
                      {draft ? "현재 장비로 다시 시작" : "새 결과 입력 시작"}
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  {draft && (
                    <>
                      <div className="reroll-columns">
                        <div>
                          <h4>
                            기존 옵션 <span>입력 시작 시점</span>
                          </h4>
                          {draft.before.map((slot, i) => (
                            <div className="old-slot" key={i}>
                              <span>
                                {OPTIONS.find((o) => o.id === slot.option)
                                  ?.short ?? "옵션 없음"}
                              </span>
                              <span>
                                {slot.tier ? `T${slot.tier}` : "직접"}
                              </span>
                              <b>{pct(slot.value)}%</b>
                              {slot.locked && <LockKeyhole size={12} />}
                            </div>
                          ))}
                        </div>
                        <div>
                          <h4>
                            새 옵션 <span>게임 결과 직접 입력</span>
                          </h4>
                          {draft.after.map((slot, i) => (
                            <SlotEditor
                              key={i}
                              slot={slot}
                              demo={isDemo}
                              label={`새 ${PARTS[draft.part]} ${i + 1}번 슬롯`}
                              onChange={(v) =>
                                setDraft((d) => {
                                  if (!d) return null;
                                  const next = copy(d);
                                  next.after[i] = v;
                                  return next;
                                })
                              }
                            />
                          ))}
                        </div>
                      </div>
                      {staleDraft && (
                        <div className="notice error" role="alert">
                          입력 중 현재 장비가 변경되었습니다. 현재 장비로 다시
                          시작해야 채용할 수 있습니다.
                        </div>
                      )}
                      <div className="reroll-footer">
                        <span>채용 여부는 직접 결정해 주세요.</span>
                        <button
                          className="button"
                          onClick={() => {
                            setDraft(null);
                            notify(
                              "새 옵션을 거절했습니다. 현재 장비는 그대로 유지됩니다.",
                            );
                          }}
                        >
                          거절
                        </button>
                        <button
                          className="button primary"
                          disabled={!!staleDraft}
                          onClick={() => {
                            update((s) => {
                              s.equipment[draft.part].slots = copy(draft.after);
                            });
                            setDraft(null);
                            notify("새 옵션을 현재 장비에 반영했습니다.");
                          }}
                        >
                          <Check size={14} />
                          채용
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
            <footer className="data-footer">
              <span>
                <Shield size={13} />
                서버 전송 없이, 이 브라우저에만 저장됩니다.
              </span>
              <div>
                <button className="text-button" onClick={exportJSON}>
                  <Download size={13} />
                  내보내기
                </button>
                <button
                  className="text-button"
                  onClick={() => importRef.current?.click()}
                >
                  <Upload size={13} />
                  불러오기
                </button>
                <button
                  className="text-button"
                  onClick={() => setConfirm("all")}
                >
                  전체 초기화
                </button>
              </div>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                aria-label="JSON 불러오기"
                className="hidden"
                onChange={(e) => void importJSON(e.target.files?.[0])}
              />
            </footer>
          </div>
        </div>
        <footer className="page-footer">
          <span>
            STM <small>SAVE THE MODULES</small>
          </span>
          <p>승리의 여신: 니케 · 비공식 팬 도구</p>
          <span>
            UI v2.0 <span className="dot" />
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Info size={16} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="알림 닫기"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {confirm && (
        <div className="dialog-backdrop" onClick={() => setConfirm(null)}>
          <section
            className="confirm-dialog panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setConfirm(null);
              if (e.key === "Tab") {
                const buttons = e.currentTarget.querySelectorAll("button");
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <RotateCcw size={24} />
            <h2 id="confirm-title">
              {confirm === "all"
                ? "모든 설정을"
                : confirm === "equipment"
                  ? "현재 장비를"
                  : `${STAGE_NAMES[currentStage]} 목표를`}{" "}
              초기화할까요?
            </h2>
            <p>
              {isDemo
                ? "데모 데이터에만 적용됩니다."
                : "초기화한 내용은 복구할 수 없습니다. 필요한 데이터는 먼저 JSON으로 내보내 주세요."}
            </p>
            <div>
              <button
                className="button"
                autoFocus
                onClick={() => setConfirm(null)}
              >
                취소
              </button>
              <button className="button danger" onClick={reset}>
                초기화
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

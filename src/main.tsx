import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Download,
  FlaskConical,
  Hexagon,
  Info,
  Layers3,
  LockKeyhole,
  RotateCcw,
  Shield,
  Sparkles,
  Target as TargetIcon,
  Upload,
  X,
} from "lucide-react";
import {
  demoState,
  emptyTarget,
  equipmentIssues,
  initialState,
  parseState,
  STAGE_NAMES,
  totals,
  type Slot,
  type State,
} from "./model";
import { SlotEditor } from "./controls";
import { TargetEditor } from "./TargetEditor";
import { GuidePanel } from "./GuidePanel";
import { useOptimization } from "./useOptimization";
import "./style.css";

const STORAGE = "stm-state-v3";
const LEGACY_STORAGE = "stm-state-v2";
const BACKUP = "stm-invalid-state-backup";
const copy = <T,>(x: T): T => structuredClone(x);
function readSaved(): { state: State; error: string } {
  try {
    const raw =
      localStorage.getItem(STORAGE) ?? localStorage.getItem(LEGACY_STORAGE);
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
  const importRef = useRef<HTMLInputElement>(null);
  const state = demo ?? user,
    isDemo = demo !== null;
  const update = (fn: (s: State) => void) => {
    const apply = (previous: State) => {
      const next = copy(previous);
      fn(next);
      return next;
    };
    if (isDemo) setDemo((previous) => (previous ? apply(previous) : previous));
    else setUser(apply);
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
  const summary = totals(state);
  const filled = summary.reduce((a, s) => a + s.lines, 0);
  const optimization = useOptimization(state, isDemo, update, notify);
  const issues = equipmentIssues(state);
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
          const raw =
            localStorage.getItem(STORAGE) ??
            localStorage.getItem(LEGACY_STORAGE);
          if (raw) localStorage.setItem(BACKUP, raw);
        } catch {
          /* Preserve corrupt storage when backup fails. */
        }
      }
      (isDemo ? setDemo : setUser)(initialState());
      if (!isDemo) setProtectStorage(false);
    } else if (confirm === "equipment") {
      update((s) => {
        s.equipment = initialState().equipment;
      });
    } else if (confirm === "target")
      update((s) => {
        s.targets[currentStage] = emptyTarget();
        delete s.baselines[currentStage];
      });
    setConfirm(null);
    notify("초기화했습니다.");
  };
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
          <span className="brand-full">
            Save the Modules<small>NIKKE Overload Planner</small>
          </span>
        </a>
        <div className="header-actions">
          <button className="button" onClick={exportJSON}>
            <Download size={16} />
            설정 저장
          </button>
          <button className="button" onClick={() => importRef.current?.click()}>
            <Upload size={16} />
            불러오기
          </button>
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
            예시 장비로 체험 중 · 사용자 데이터와 분리됩니다. 결과는 단순 근사
            엔진으로 계산합니다.
          </span>
          <button
            onClick={() => {
              setDemo(null);
            }}
          >
            종료하고 내 데이터로 돌아가기 <ArrowRight size={14} />
          </button>
        </div>
      )}
      <main>
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
            <h3>STM v2.3.2</h3>
            <p>
              4부위 입력 → 단계별 목표 → 사용 가능 모듈 → 최적화 계산. 게임
              결과는 왼쪽 장비에 반영하세요. 합산·달성 판정·빠른 행동 후보는
              자동 갱신됩니다. 비용과 확률도 입력 변경 후 자동 계산하며, 추천
              단계가 선택한 목표를 바꾸지 않습니다.
            </p>
            <p>
              빈 슬롯은 이미 개조한 장비의 빈 옵션입니다. 최초 제작은 계산하지
              않습니다. 잠금 토글은 게임의 현재 영구 잠금을 기록하며, 모듈
              예산을 차감하지 않습니다.
            </p>
          </section>
        )}
        {state.migrationNotes.length > 0 && (
          <details className="migration-note panel">
            <summary>
              v2.0 데이터 변환 안내 ({state.migrationNotes.length})
            </summary>
            {state.migrationNotes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </details>
        )}
        {issues.length > 0 && (
          <div className="notice error" role="alert">
            {issues.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
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
                <span>단계 · 실제 수치</span>
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
                      usedOptions={e.slots
                        .filter((_, k) => k !== j)
                        .map((x) => x.option)}
                    />
                  ))}
                </section>
              ))}
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
              <TargetEditor
                state={state}
                update={update}
                onReset={() => setConfirm("target")}
                notify={notify}
              />
            ) : (
              <GuidePanel
                state={state}
                update={update}
                {...optimization}
                onCalculate={optimization.run}
                isDemo={isDemo}
              />
            )}
            <footer className="data-footer">
              <span>
                <Shield size={13} />
                서버 전송 없이, 이 브라우저에만 저장됩니다.
              </span>
              <div>
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
            v2.3.2 <span className="dot" />
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

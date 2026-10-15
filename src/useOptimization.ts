import { useEffect, useRef, useState } from "react";
import {
  inputSignature,
  resultIsCurrent,
  STAGES,
  targetSignature,
  type EngineResult,
  type State,
} from "./model";
export function useOptimization(
  state: State,
  isDemo: boolean,
  update: (fn: (s: State) => void) => void,
  notify: (s: string) => void,
) {
  const [result, setResult] = useState<EngineResult | null>(null),
    [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null),
    latest = useRef("");
  latest.current = `${isDemo}:${inputSignature(state)}`;
  useEffect(() => () => worker.current?.terminate(), []);
  const run = () => {
    worker.current?.terminate();
    setBusy(true);
    const requested = latest.current;
    try {
      const w = new Worker(new URL("./engine.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      w.onmessage = (e) => {
        w.terminate();
        if (worker.current !== w) return;
        worker.current = null;
        setBusy(false);
        if (latest.current !== requested) {
          notify(
            "계산 중 입력이 변경되어 결과를 폐기했습니다. 다시 계산해 주세요.",
          );
          return;
        }
        if (e.data.error) {
          notify(e.data.error);
          return;
        }
        const r = e.data.result as EngineResult;
        setResult(r);
        update((s) => {
          for (const stage of STAGES) {
            const g = r.goals[stage],
              signature = targetSignature(s.targets[stage]);
            if (
              g.expectedModules !== null &&
              (!s.baselines[stage] ||
                s.baselines[stage]?.signature !== signature)
            )
              s.baselines[stage] = { signature, cost: g.expectedModules };
          }
          if (r.recommendedStage) s.ui.selectedGoal = r.recommendedStage;
        });
      };
      w.onerror = () => {
        if (worker.current === w) {
          setBusy(false);
          worker.current = null;
          notify(
            "계산 작업을 실행하지 못했습니다. 브라우저의 Worker 지원과 배포 파일을 확인해 주세요.",
          );
        }
        w.terminate();
      };
      w.postMessage({ state, source: isDemo ? "demo" : "engine" });
    } catch {
      setBusy(false);
      notify("계산 작업을 시작하지 못했습니다.");
    }
  };
  const current =
    resultIsCurrent(result, state) &&
    result?.source === (isDemo ? "demo" : "engine");
  return {
    result: current ? result : null,
    stale: !!result && !current,
    busy,
    run,
  };
}

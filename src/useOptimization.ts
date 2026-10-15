import { useEffect, useMemo, useRef, useState } from "react";
import {
  costSignature,
  inputSignature,
  type EngineResult,
  type State,
} from "./model";
import { fastGuideSignature, getFastGuide } from "./fastGuide";
import { CostCache, recordBaselines } from "./resultCache";

export function useOptimization(
  state: State,
  isDemo: boolean,
  update: (fn: (s: State) => void) => void,
  notify: (s: string) => void,
) {
  const cache = useRef(new CostCache());
  const [revision, setRevision] = useState(0);
  const [calculated, setCalculated] = useState({ user: false, demo: false });
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const latest = useRef("");
  const geometry = costSignature(state),
    signature = inputSignature(state);
  const dataset = isDemo ? "demo" : "user";
  latest.current = `${dataset}:${geometry}`;
  const guideSignature = fastGuideSignature(state);
  const guide = useMemo(() => getFastGuide(state), [guideSignature]);
  const result = useMemo(
    () => cache.current.get(state, isDemo),
    [signature, isDemo, revision],
  );
  useEffect(() => () => worker.current?.terminate(), []);
  const run = () => {
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
    const cached = cache.current.get(state, isDemo);
    if (cached) {
      setCalculated((previous) => ({ ...previous, [dataset]: true }));
      update((s) => recordBaselines(s, cached));
      return;
    }
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
            "계산 중 장비나 목표가 변경되어 비용 결과를 폐기했습니다. 빠른 가이드는 현재 상태로 갱신됩니다.",
          );
          return;
        }
        if (e.data.error) {
          notify(e.data.error);
          return;
        }
        const r = e.data.result as EngineResult;
        cache.current.put(state, isDemo, r);
        setCalculated((previous) => ({ ...previous, [dataset]: true }));
        setRevision((n) => n + 1);
        update((s) => {
          if (costSignature(s) === geometry) recordBaselines(s, r);
        });
      };
      w.onerror = () => {
        if (worker.current === w) {
          worker.current = null;
          setBusy(false);
          notify(
            "비용 계산 Worker를 실행하지 못했습니다. 빠른 가이드는 계속 사용할 수 있습니다.",
          );
        }
        w.terminate();
      };
      w.postMessage({ state, source: isDemo ? "demo" : "engine" });
    } catch {
      setBusy(false);
      notify(
        "비용 계산을 시작하지 못했습니다. 빠른 가이드는 계속 사용할 수 있습니다.",
      );
    }
  };
  return { result, guide, stale: calculated[dataset] && !result, busy, run };
}

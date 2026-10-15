/// <reference lib="webworker" />
import { calculate } from "./engine";
import type { EngineResult, State } from "./model";
self.onmessage = (
  event: MessageEvent<{ state: State; source: EngineResult["source"] }>,
) => {
  try {
    self.postMessage({
      result: calculate(event.data.state, event.data.source),
    });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "계산 중 오류가 발생했습니다.",
    });
  }
};

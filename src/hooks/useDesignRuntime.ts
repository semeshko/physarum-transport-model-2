"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { PreparedNetwork } from "../scenario/types";
import type { DesignAdaptationParameters } from "../design/adaptation";
import type { DesignScale } from "../design/scale";
import { designRuntimeReducer, INITIAL_DESIGN_RUNTIME_STATE, type DesignWorkerRequest, type DesignWorkerResponse } from "../design/worker-protocol";

export function useDesignRuntime() {
  const [runtime, dispatch] = useReducer(designRuntimeReducer, INITIAL_DESIGN_RUNTIME_STATE);
  const workerRef = useRef<Worker | null>(null);
  const activeRunId = useRef<string | null>(null);
  const runSequence = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/design.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<DesignWorkerResponse>) => dispatch({ type: "WORKER_MESSAGE", message: event.data });
    worker.onerror = (event) => {
      if (activeRunId.current) dispatch({ type: "WORKER_MESSAGE", message: { type: "ERROR", runId: activeRunId.current, message: event.message || "Design Worker failed." } });
    };
    return () => { worker.terminate(); workerRef.current = null; activeRunId.current = null; };
  }, []);

  const send = useCallback((message: DesignWorkerRequest) => workerRef.current?.postMessage(message), []);

  const start = useCallback((network: PreparedNetwork, scale?: DesignScale, parameters?: Partial<DesignAdaptationParameters>) => {
    if (activeRunId.current) send({ type: "CANCEL", runId: activeRunId.current });
    runSequence.current += 1;
    const runId = `design-${Date.now()}-${runSequence.current}`;
    activeRunId.current = runId;
    dispatch({ type: "LOCAL_START", runId });
    send({ type: "START", runId, network, scale, parameters });
  }, [send]);

  const pause = useCallback(() => { if (activeRunId.current) send({ type: "PAUSE", runId: activeRunId.current }); }, [send]);
  const resume = useCallback(() => { if (activeRunId.current) send({ type: "RESUME", runId: activeRunId.current }); }, [send]);
  const cancel = useCallback(() => {
    if (activeRunId.current) send({ type: "CANCEL", runId: activeRunId.current });
    activeRunId.current = null;
  }, [send]);
  const reset = useCallback(() => { cancel(); dispatch({ type: "RESET" }); }, [cancel]);

  return { runtime, start, pause, resume, cancel, reset } as const;
}

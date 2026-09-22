import type { PreparedNetwork } from "../scenario/types";
import type { DesignAdaptationParameters, DesignFieldState } from "./adaptation";
import type { DesignScale } from "./scale";

/**
 * Design gets its own Worker channel rather than a mode flag on the Analyze
 * one. `PhysarumState` (per-edge D under the Hill law) and `DesignFieldState`
 * (conductivity density + flux density under Hu-Cai / IMEX) are different
 * scientific states; sharing a channel would force every message, reducer and
 * consumer to discriminate between them. The two Workers share only the
 * hydraulic solver underneath.
 */
export const DESIGN_BATCH_SIZE = 5;
export const DESIGN_PROGRESS_INTERVAL = 5;
export const DESIGN_BATCH_DELAY_MS = 50;

export type DesignWorkerRequest =
  | {
      readonly type: "START";
      readonly runId: string;
      readonly network: PreparedNetwork;
      /** Barrier-independent AOI scale from assembleDesignNetwork. Without it
       * the worker would infer the scale from the surviving edges, so adding a
       * building would recalibrate the model rather than only block flow. */
      readonly scale?: DesignScale;
      readonly parameters?: Partial<DesignAdaptationParameters>;
    }
  | { readonly type: "PAUSE"; readonly runId: string }
  | { readonly type: "RESUME"; readonly runId: string }
  | { readonly type: "CANCEL"; readonly runId: string };

export type DesignWorkerResponse =
  | { readonly type: "STARTED"; readonly runId: string; readonly state: DesignFieldState }
  | { readonly type: "PROGRESS"; readonly runId: string; readonly state: DesignFieldState }
  | { readonly type: "PAUSED"; readonly runId: string; readonly state: DesignFieldState }
  | { readonly type: "COMPLETED"; readonly runId: string; readonly state: DesignFieldState }
  | { readonly type: "CANCELLED"; readonly runId: string }
  | { readonly type: "ERROR"; readonly runId: string; readonly message: string };

export type DesignRuntimeStatus = "idle" | "running" | "paused" | "completed" | "cancelled" | "error";

export type DesignRuntimeState = {
  readonly status: DesignRuntimeStatus;
  readonly runId: string | null;
  readonly state: DesignFieldState | null;
  readonly error: string | null;
};

export type DesignRuntimeAction =
  | { readonly type: "LOCAL_START"; readonly runId: string }
  | { readonly type: "RESET" }
  | { readonly type: "WORKER_MESSAGE"; readonly message: DesignWorkerResponse };

export const INITIAL_DESIGN_RUNTIME_STATE: DesignRuntimeState = { status: "idle", runId: null, state: null, error: null };

export function designRuntimeReducer(state: DesignRuntimeState, action: DesignRuntimeAction): DesignRuntimeState {
  if (action.type === "RESET") return INITIAL_DESIGN_RUNTIME_STATE;
  if (action.type === "LOCAL_START") return { status: "running", runId: action.runId, state: null, error: null };
  const message = action.message;
  // Stale guard: a message from a superseded run must never overwrite the current one.
  if (message.runId !== state.runId) return state;
  if ((state.status === "completed" || state.status === "cancelled" || state.status === "error") && (message.type === "STARTED" || message.type === "PROGRESS" || message.type === "PAUSED")) return state;
  if (message.type === "STARTED" || message.type === "PROGRESS") return { ...state, status: "running", state: message.state, error: null };
  if (message.type === "PAUSED") return { ...state, status: "paused", state: message.state };
  if (message.type === "COMPLETED") return { ...state, status: "completed", state: message.state, error: message.state.error };
  if (message.type === "CANCELLED") return { status: "cancelled", runId: state.runId, state: null, error: null };
  return { ...state, status: "error", error: message.message };
}

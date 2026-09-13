import type { PreparedNetwork } from "../scenario/types";
import type { PhysarumParameters, PhysarumState } from "./types";

export const PHYSARUM_BATCH_SIZE = 5;
export const PHYSARUM_PROGRESS_INTERVAL = 5;
export const PHYSARUM_BATCH_DELAY_MS = 100;

export type PhysarumWorkerRequest =
  | { readonly type: "START"; readonly runId: string; readonly network: PreparedNetwork; readonly parameters?: Partial<PhysarumParameters> }
  | { readonly type: "PAUSE"; readonly runId: string }
  | { readonly type: "RESUME"; readonly runId: string }
  | { readonly type: "CANCEL"; readonly runId: string };

export type PhysarumWorkerResponse =
  | { readonly type: "STARTED"; readonly runId: string; readonly state: PhysarumState }
  | { readonly type: "PROGRESS"; readonly runId: string; readonly state: PhysarumState }
  | { readonly type: "PAUSED"; readonly runId: string; readonly state: PhysarumState }
  | { readonly type: "COMPLETED"; readonly runId: string; readonly state: PhysarumState }
  | { readonly type: "CANCELLED"; readonly runId: string }
  | { readonly type: "ERROR"; readonly runId: string; readonly message: string };

export type PhysarumRuntimeStatus = "idle" | "running" | "paused" | "completed" | "cancelled" | "error";

export type PhysarumRuntimeState = {
  readonly status: PhysarumRuntimeStatus;
  readonly runId: string | null;
  readonly state: PhysarumState | null;
  readonly error: string | null;
};

export type PhysarumRuntimeAction =
  | { readonly type: "LOCAL_START"; readonly runId: string }
  | { readonly type: "RESET" }
  | { readonly type: "WORKER_MESSAGE"; readonly message: PhysarumWorkerResponse };

export const INITIAL_PHYSARUM_RUNTIME_STATE: PhysarumRuntimeState = { status: "idle", runId: null, state: null, error: null };

export function physarumRuntimeReducer(state: PhysarumRuntimeState, action: PhysarumRuntimeAction): PhysarumRuntimeState {
  if (action.type === "RESET") return INITIAL_PHYSARUM_RUNTIME_STATE;
  if (action.type === "LOCAL_START") return { status: "running", runId: action.runId, state: null, error: null };
  const message = action.message;
  if (message.runId !== state.runId) return state;
  if ((state.status === "completed" || state.status === "cancelled" || state.status === "error") && (message.type === "STARTED" || message.type === "PROGRESS" || message.type === "PAUSED")) return state;
  if (message.type === "STARTED" || message.type === "PROGRESS") return { ...state, status: "running", state: message.state, error: null };
  if (message.type === "PAUSED") return { ...state, status: "paused", state: message.state };
  if (message.type === "COMPLETED") return { ...state, status: "completed", state: message.state, error: message.state.error };
  if (message.type === "CANCELLED") return { status: "cancelled", runId: state.runId, state: null, error: null };
  return { ...state, status: "error", error: message.message };
}

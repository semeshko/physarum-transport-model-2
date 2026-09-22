import { advanceDesignField, initializeDesignField, type DesignSimulation } from "./adaptation";
import { resolveDesignV2 } from "./scale";
import type { DesignWorkerRequest, DesignWorkerResponse } from "./worker-protocol";

/**
 * Pure Worker logic: no DOM, no timers, so it is directly testable. Drives the
 * continuum Design law (`advanceDesignField`) and nothing else — the Analyze
 * Hill adaptation is never reachable from here.
 */
export class DesignWorkerMachine {
  private runId: string | null = null;
  private simulation: DesignSimulation | null = null;
  private paused = false;
  private cancelled = false;

  handle(message: DesignWorkerRequest): DesignWorkerResponse | null {
    if (message.type === "START") {
      this.runId = message.runId; this.paused = false; this.cancelled = false;
      try {
        // Design-v2 (Gate H): the scale is derived from the network, so the
        // regularizer stays a 0.1% perturbation instead of carrying the field.
        this.simulation = initializeDesignField(message.network, { ...resolveDesignV2(message.network), ...message.parameters });
        return { type: "STARTED", runId: message.runId, state: this.simulation.state };
      } catch (error) {
        this.simulation = null;
        return { type: "ERROR", runId: message.runId, message: error instanceof Error ? error.message : "Unable to initialize the Design field." };
      }
    }
    if (message.runId !== this.runId || !this.simulation) return null;
    if (message.type === "PAUSE") { this.paused = true; return { type: "PAUSED", runId: message.runId, state: this.simulation.state }; }
    if (message.type === "RESUME") { this.paused = false; return { type: "PROGRESS", runId: message.runId, state: this.simulation.state }; }
    this.cancelled = true;
    return { type: "CANCELLED", runId: message.runId };
  }

  stepBatch(batchSize: number): DesignWorkerResponse | null {
    if (!this.runId || !this.simulation || this.paused || this.cancelled) return null;
    for (let step = 0; step < batchSize && this.simulation.state.diagnostics.terminationReason === null; step += 1) this.simulation = advanceDesignField(this.simulation);
    return this.simulation.state.diagnostics.terminationReason === null
      ? { type: "PROGRESS", runId: this.runId, state: this.simulation.state }
      : { type: "COMPLETED", runId: this.runId, state: this.simulation.state };
  }

  get isRunnable(): boolean { return Boolean(this.runId && this.simulation && !this.paused && !this.cancelled && this.simulation.state.diagnostics.terminationReason === null); }
}

import { initializePhysarum, stepPhysarum } from "./solver";
import type { PhysarumSimulation } from "./types";
import type { PhysarumWorkerRequest, PhysarumWorkerResponse } from "./worker-protocol";

export class PhysarumWorkerMachine {
  private runId: string | null = null;
  private network: Extract<PhysarumWorkerRequest, { type: "START" }>["network"] | null = null;
  private simulation: PhysarumSimulation | null = null;
  private paused = false;
  private cancelled = false;

  handle(message: PhysarumWorkerRequest): PhysarumWorkerResponse | null {
    if (message.type === "START") {
      this.runId = message.runId; this.network = message.network; this.paused = false; this.cancelled = false;
      try {
        this.simulation = initializePhysarum(message.network, message.parameters);
        return { type: "STARTED", runId: message.runId, state: this.simulation.state };
      } catch (error) {
        this.simulation = null;
        return { type: "ERROR", runId: message.runId, message: error instanceof Error ? error.message : "Unable to initialize Physarum." };
      }
    }
    if (message.runId !== this.runId || !this.simulation) return null;
    if (message.type === "PAUSE") { this.paused = true; return { type: "PAUSED", runId: message.runId, state: this.simulation.state }; }
    if (message.type === "RESUME") { this.paused = false; return { type: "PROGRESS", runId: message.runId, state: this.simulation.state }; }
    this.cancelled = true;
    return { type: "CANCELLED", runId: message.runId };
  }

  stepBatch(batchSize: number): PhysarumWorkerResponse | null {
    if (!this.runId || !this.network || !this.simulation || this.paused || this.cancelled) return null;
    for (let step = 0; step < batchSize && this.simulation.state.terminationReason === null; step += 1) this.simulation = stepPhysarum(this.network, this.simulation);
    return this.simulation.state.terminationReason === null
      ? { type: "PROGRESS", runId: this.runId, state: this.simulation.state }
      : { type: "COMPLETED", runId: this.runId, state: this.simulation.state };
  }

  get isRunnable(): boolean { return Boolean(this.runId && this.network && this.simulation && !this.paused && !this.cancelled && this.simulation.state.terminationReason === null); }
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GISBounds } from "../gis/types";
import { runDesignField } from "./adaptation";
import { buildDesignMesh, createDesignArea } from "./mesh";
import { assembleDesignNetwork, type DesignTerminal } from "./network";
import { createLocalProjection } from "./projection";
import { DesignWorkerMachine } from "./worker-machine";
import { designRuntimeReducer, INITIAL_DESIGN_RUNTIME_STATE, type DesignRuntimeState } from "./worker-protocol";

const BOUNDS: GISBounds = [24.02, 49.835, 24.048, 49.851];
const area = createDesignArea(BOUNDS);
const mesh = buildDesignMesh(area, 160);
const projection = createLocalProjection(area.origin);
const terminals: DesignTerminal[] = [
  { id: "src", role: "source", centre: projection.unproject([-600, 0]), radiusMeters: 250, magnitude: 1 },
  { id: "snk", role: "sink", centre: projection.unproject([600, 0]), radiusMeters: 250, magnitude: 1 },
];
const network = assembleDesignNetwork(mesh, terminals).network!;

function drain(machine: DesignWorkerMachine, batchSize = 25) {
  let last = machine.stepBatch(batchSize);
  while (machine.isRunnable) last = machine.stepBatch(batchSize);
  return last;
}

describe("design worker machine", () => {
  it("starts a run and reports the initial, un-evolved field", () => {
    const machine = new DesignWorkerMachine();
    const response = machine.handle({ type: "START", runId: "r1", network });
    expect(response?.type).toBe("STARTED");
    expect(response && "state" in response && response.state.diagnostics.iteration).toBe(0);
    expect(response && "state" in response && response.state.diagnostics.terminationReason).toBeNull();
  });

  it("reaches exactly the same field as running the law directly", () => {
    const machine = new DesignWorkerMachine();
    machine.handle({ type: "START", runId: "r1", network, parameters: { maxIterations: 40 } });
    const last = drain(machine, 7);
    expect(last?.type).toBe("COMPLETED");
    // Batching is a scheduling detail; it must not change the science.
    expect(last && "state" in last && last.state.conductivity).toEqual(runDesignField(network, { maxIterations: 40 }).conductivity);
  });

  it("stops stepping while paused and continues from the same iteration on resume", () => {
    const machine = new DesignWorkerMachine();
    machine.handle({ type: "START", runId: "r1", network, parameters: { maxIterations: 200 } });
    machine.stepBatch(5);
    const paused = machine.handle({ type: "PAUSE", runId: "r1" });
    expect(paused?.type).toBe("PAUSED");
    const iteration = paused && "state" in paused ? paused.state.diagnostics.iteration : -1;
    expect(iteration).toBe(5);
    expect(machine.isRunnable).toBe(false);
    expect(machine.stepBatch(5)).toBeNull();

    const resumed = machine.handle({ type: "RESUME", runId: "r1" });
    expect(resumed && "state" in resumed && resumed.state.diagnostics.iteration).toBe(5);
    const advanced = machine.stepBatch(5);
    expect(advanced && "state" in advanced && advanced.state.diagnostics.iteration).toBe(10);
  });

  it("ignores messages from a superseded run", () => {
    const machine = new DesignWorkerMachine();
    machine.handle({ type: "START", runId: "r1", network });
    expect(machine.handle({ type: "PAUSE", runId: "stale" })).toBeNull();
    expect(machine.isRunnable).toBe(true);
  });

  it("stops after a cancel", () => {
    const machine = new DesignWorkerMachine();
    machine.handle({ type: "START", runId: "r1", network });
    expect(machine.handle({ type: "CANCEL", runId: "r1" })?.type).toBe("CANCELLED");
    expect(machine.isRunnable).toBe(false);
    expect(machine.stepBatch(5)).toBeNull();
  });

  it("reports invalid parameters as an error instead of starting", () => {
    const machine = new DesignWorkerMachine();
    const response = machine.handle({ type: "START", runId: "r1", network, parameters: { gamma: 1 } });
    expect(response?.type).toBe("ERROR");
    expect(machine.isRunnable).toBe(false);
  });
});

describe("design runtime reducer", () => {
  const started: DesignRuntimeState = designRuntimeReducer(INITIAL_DESIGN_RUNTIME_STATE, { type: "LOCAL_START", runId: "r1" });
  const state = runDesignField(network, { maxIterations: 5 });

  it("drops messages belonging to a superseded run", () => {
    expect(designRuntimeReducer(started, { type: "WORKER_MESSAGE", message: { type: "PROGRESS", runId: "r0", state } })).toBe(started);
  });

  it("does not let a late progress message revive a finished run", () => {
    const completed = designRuntimeReducer(started, { type: "WORKER_MESSAGE", message: { type: "COMPLETED", runId: "r1", state } });
    expect(completed.status).toBe("completed");
    expect(designRuntimeReducer(completed, { type: "WORKER_MESSAGE", message: { type: "PROGRESS", runId: "r1", state } })).toBe(completed);
  });

  it("surfaces a worker error", () => {
    const errored = designRuntimeReducer(started, { type: "WORKER_MESSAGE", message: { type: "ERROR", runId: "r1", message: "boom" } });
    expect(errored.status).toBe("error");
    expect(errored.error).toBe("boom");
  });

  it("resets to idle", () => {
    expect(designRuntimeReducer(started, { type: "RESET" })).toEqual(INITIAL_DESIGN_RUNTIME_STATE);
  });
});

/**
 * The Analyze and Design branches share only the hydraulic solver. If the
 * Design Worker ever imported the Physarum solver, Design would silently be
 * driven by the graph Hill law instead of the continuum Hu-Cai law.
 */
describe("design/analyze separation", () => {
  it("keeps the Design worker path free of the Analyze adaptation", () => {
    for (const path of ["src/workers/design.worker.ts", "src/design/worker-machine.ts", "src/design/adaptation.ts"]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("physarum/solver");
      expect(source).not.toMatch(/\bstepPhysarum\b|\brunPhysarum\b|\binitializePhysarum\b/);
    }
  });
});

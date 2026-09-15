import { describe, expect, it } from "vitest";
import type { PreparedNetwork } from "../scenario/types";
import { INITIAL_PHYSARUM_RUNTIME_STATE, physarumRuntimeReducer, type PhysarumWorkerResponse } from "./worker-protocol";
import { PhysarumWorkerMachine } from "./worker-machine";

const network: PreparedNetwork = {
  graphId: "worker", scenarioId: "scenario", nodes: [{ id: "s", position: [0, 0] }, { id: "t", position: [1, 0] }],
  edges: [{ graphEdgeId: "e", fromNodeId: "s", toNodeId: "t", lengthMeters: 1, penaltyMultiplier: 1, effectiveCost: 1 }],
  terminals: [{ id: "source", role: "source", nodeId: "s", magnitude: 1 }, { id: "sink", role: "sink", nodeId: "t", magnitude: 1 }], activeEdgeCount: 1, blockedEdgeCount: 0, sourceSinkConnected: true,
};

describe("Physarum Worker machine", () => {
  it("initializes a valid START", () => expect(new PhysarumWorkerMachine().handle({ type: "START", runId: "a", network })?.type).toBe("STARTED"));
  it("returns a typed error for invalid parameters", () => expect(new PhysarumWorkerMachine().handle({ type: "START", runId: "a", network, parameters: { timeStep: 0 } })?.type).toBe("ERROR"));
  it("emits monotonically increasing progress", () => {
    const machine = new PhysarumWorkerMachine(); machine.handle({ type: "START", runId: "a", network });
    const first = machine.stepBatch(2); const second = machine.stepBatch(2);
    expect(first?.type).toBe("PROGRESS"); expect(second?.type).toBe("PROGRESS");
    if (first?.type === "PROGRESS" && second?.type === "PROGRESS") expect(second.state.iteration).toBeGreaterThan(first.state.iteration);
  });
  it("pause prevents stepping and resume continues", () => {
    const machine = new PhysarumWorkerMachine(); machine.handle({ type: "START", runId: "a", network });
    const before = machine.stepBatch(3); machine.handle({ type: "PAUSE", runId: "a" }); expect(machine.stepBatch(5)).toBeNull();
    const resumed = machine.handle({ type: "RESUME", runId: "a" }); const after = machine.stepBatch(1);
    if (before?.type === "PROGRESS" && resumed?.type === "PROGRESS" && after?.type === "PROGRESS") { expect(resumed.state.iteration).toBe(before.state.iteration); expect(after.state.iteration).toBe(before.state.iteration + 1); }
  });
  it("cancel stops the current run", () => {
    const machine = new PhysarumWorkerMachine(); machine.handle({ type: "START", runId: "a", network });
    expect(machine.handle({ type: "CANCEL", runId: "a" })?.type).toBe("CANCELLED"); expect(machine.stepBatch(5)).toBeNull();
  });
});

describe("Physarum client runtime reducer", () => {
  const progress = (runId: string, iteration: number): Extract<PhysarumWorkerResponse, { type: "PROGRESS" }> => ({ type: "PROGRESS", runId, state: { networkGraphId: "worker", scenarioId: "scenario", iteration, nodePressures: {}, edgeConductivities: {}, edgeFlows: {}, diagnostics: { iteration, maxDeltaD: 0, totalAbsoluteFlow: 0, sourceFlowBalanceError: 0, sinkFlowBalanceError: 0, maximumKirchhoffResidual: 0, linearSolve: null }, scale: { mode: "absolute", qRef: 0, effectiveHillK: 1 }, converged: false, terminationReason: null, error: null } });
  it("ignores stale run IDs", () => {
    const running = physarumRuntimeReducer(INITIAL_PHYSARUM_RUNTIME_STATE, { type: "LOCAL_START", runId: "new" });
    expect(physarumRuntimeReducer(running, { type: "WORKER_MESSAGE", message: progress("old", 99) })).toBe(running);
  });
  it("does not revive a completed run from stale progress", () => {
    let state = physarumRuntimeReducer(INITIAL_PHYSARUM_RUNTIME_STATE, { type: "LOCAL_START", runId: "new" });
    const completed = { ...progress("new", 5), type: "COMPLETED" as const, state: { ...progress("new", 5).state, converged: true, terminationReason: "converged" as const } };
    state = physarumRuntimeReducer(state, { type: "WORKER_MESSAGE", message: completed });
    expect(physarumRuntimeReducer(state, { type: "WORKER_MESSAGE", message: progress("old", 20) }).status).toBe("completed");
    expect(physarumRuntimeReducer(state, { type: "WORKER_MESSAGE", message: progress("new", 4) }).status).toBe("completed");
  });
  it("reset returns predictable idle state", () => {
    const running = physarumRuntimeReducer(INITIAL_PHYSARUM_RUNTIME_STATE, { type: "LOCAL_START", runId: "a" });
    expect(physarumRuntimeReducer(running, { type: "RESET" })).toEqual(INITIAL_PHYSARUM_RUNTIME_STATE);
  });
});

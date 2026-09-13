import { describe, expect, it } from "vitest";
import type { PreparedNetwork } from "../scenario/types";
import { initializePhysarum, runPhysarum, stepPhysarum } from "./solver";

function fixture(): PreparedNetwork {
  return {
    graphId: "incremental", scenarioId: "scenario",
    nodes: ["s", "a", "b", "t"].map((id, index) => ({ id, position: [index, 0] })),
    edges: [
      { graphEdgeId: "u1", fromNodeId: "s", toNodeId: "a", lengthMeters: 1, penaltyMultiplier: 1, effectiveCost: 1 },
      { graphEdgeId: "u2", fromNodeId: "a", toNodeId: "t", lengthMeters: 1, penaltyMultiplier: 1, effectiveCost: 1 },
      { graphEdgeId: "l1", fromNodeId: "s", toNodeId: "b", lengthMeters: 2, penaltyMultiplier: 2, effectiveCost: 2 },
      { graphEdgeId: "l2", fromNodeId: "b", toNodeId: "t", lengthMeters: 2, penaltyMultiplier: 2, effectiveCost: 2 },
    ],
    terminals: [{ id: "source", role: "source", nodeId: "s", magnitude: 1 }, { id: "sink", role: "sink", nodeId: "t", magnitude: 1 }],
    activeEdgeCount: 4, blockedEdgeCount: 0, sourceSinkConnected: true,
  };
}

function stepped(batchSize: number) {
  const network = fixture();
  let simulation = initializePhysarum(network);
  while (simulation.state.terminationReason === null) for (let index = 0; index < batchSize && simulation.state.terminationReason === null; index += 1) simulation = stepPhysarum(network, simulation);
  return simulation.state;
}

describe("incremental Physarum API", () => {
  it("matches the synchronous convenience solver", () => expect(stepped(1)).toEqual(runPhysarum(fixture())));
  it.each([1, 2, 5, 10])("is invariant to batch size %i", (batchSize) => expect(stepped(batchSize)).toEqual(stepped(1)));
  it("pause-equivalent interruption preserves the final result", () => {
    const network = fixture();
    let simulation = initializePhysarum(network);
    for (let index = 0; index < 7; index += 1) simulation = stepPhysarum(network, simulation);
    const pausedSnapshot = JSON.stringify(simulation);
    expect(JSON.stringify(simulation)).toBe(pausedSnapshot);
    while (simulation.state.terminationReason === null) simulation = stepPhysarum(network, simulation);
    expect(simulation.state).toEqual(runPhysarum(network));
  });
  it("increments iteration exactly once per step", () => {
    const first = initializePhysarum(fixture());
    expect(stepPhysarum(fixture(), first).state.iteration).toBe(1);
  });
  it("does not mutate PreparedNetwork", () => {
    const network = fixture(); const before = JSON.stringify(network); stepped(5); expect(JSON.stringify(network)).toBe(before);
  });
});

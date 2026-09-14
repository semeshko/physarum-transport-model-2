import { describe, expect, it } from "vitest";
import { runPhysarum } from "../physarum/solver";
import type { PreparedNetwork } from "../scenario/types";

function alternatives(shortCost: number, includeShort = true): PreparedNetwork {
  const allEdges = [
    { graphEdgeId: "short-1", fromNodeId: "s", toNodeId: "a", lengthMeters: 1, profileCostSeconds: 1, spatialCostSeconds: shortCost, spatialMultiplier: shortCost, penaltyMultiplier: 1, effectiveCost: shortCost },
    { graphEdgeId: "short-2", fromNodeId: "a", toNodeId: "t", lengthMeters: 1, profileCostSeconds: 1, spatialCostSeconds: shortCost, spatialMultiplier: shortCost, penaltyMultiplier: 1, effectiveCost: shortCost },
    { graphEdgeId: "long-1", fromNodeId: "s", toNodeId: "b", lengthMeters: 1.1, profileCostSeconds: 1.1, spatialCostSeconds: 1.1, spatialMultiplier: 1, penaltyMultiplier: 1, effectiveCost: 1.1 },
    { graphEdgeId: "long-2", fromNodeId: "b", toNodeId: "t", lengthMeters: 1.1, profileCostSeconds: 1.1, spatialCostSeconds: 1.1, spatialMultiplier: 1, penaltyMultiplier: 1, effectiveCost: 1.1 },
  ];
  const edges = includeShort ? allEdges : allEdges.slice(2);
  return { graphId: "spatial-comparison", transportProfileId: "pedestrian", scenarioId: "comparison", nodes: [{ id: "s", position: [0,0] }, { id: "a", position: [1,1] }, { id: "b", position: [1,-1] }, { id: "t", position: [2,0] }], edges, terminals: [{ id: "source", role: "source", nodeId: "s", magnitude: 1 }, { id: "sink", role: "sink", nodeId: "t", magnitude: 1 }], activeEdgeCount: edges.length, blockedEdgeCount: includeShort ? 0 : 2, sourceSinkConnected: true };
}

describe("spatial-cost Physarum sensitivity record", () => {
  it("compares no constraint, hard exclusion, and conservative soft impedance without tuning equations", () => {
    const none = runPhysarum(alternatives(1)); const hard = runPhysarum(alternatives(1, false)); const soft = runPhysarum(alternatives(1.025));
    console.info(`spatial-comparison none=${none.edgeFlows["short-1"].toFixed(6)}:${none.edgeFlows["long-1"].toFixed(6)} hard-long=${hard.edgeFlows["long-1"].toFixed(6)} soft=${soft.edgeFlows["short-1"].toFixed(6)}:${soft.edgeFlows["long-1"].toFixed(6)} iterations=${none.iteration}/${hard.iteration}/${soft.iteration}`);
    expect(none.converged && hard.converged && soft.converged).toBe(true);
    expect(hard.edgeFlows["short-1"]).toBeUndefined(); expect(hard.edgeFlows["long-1"]).toBeCloseTo(1);
    expect(soft.edgeFlows["short-1"]).toBeGreaterThan(soft.edgeFlows["long-1"]);
    expect(soft.edgeConductivities["long-1"]).toBeGreaterThan(0);
  });
});

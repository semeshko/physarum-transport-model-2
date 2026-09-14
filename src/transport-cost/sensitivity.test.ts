import { describe, expect, it } from "vitest";
import { runPhysarum } from "../physarum/solver";
import type { PreparedNetwork } from "../scenario/types";

function network(ratio: number): PreparedNetwork { return { graphId: `sensitivity-${ratio}`, scenarioId: "sensitivity", nodes: [{ id: "s", position: [0, 0] }, { id: "a", position: [1, 1] }, { id: "b", position: [1, -1] }, { id: "t", position: [2, 0] }], edges: [
  { graphEdgeId: "cheap-1", fromNodeId: "s", toNodeId: "a", lengthMeters: 1, profileCostSeconds: 1, penaltyMultiplier: 1, effectiveCost: 1 }, { graphEdgeId: "cheap-2", fromNodeId: "a", toNodeId: "t", lengthMeters: 1, profileCostSeconds: 1, penaltyMultiplier: 1, effectiveCost: 1 },
  { graphEdgeId: "costly-1", fromNodeId: "s", toNodeId: "b", lengthMeters: 1, profileCostSeconds: ratio, penaltyMultiplier: 1, effectiveCost: ratio }, { graphEdgeId: "costly-2", fromNodeId: "b", toNodeId: "t", lengthMeters: 1, profileCostSeconds: ratio, penaltyMultiplier: 1, effectiveCost: ratio },
], terminals: [{ id: "source", role: "source", nodeId: "s", magnitude: 1 }, { id: "sink", role: "sink", nodeId: "t", magnitude: 1 }], activeEdgeCount: 4, blockedEdgeCount: 0, sourceSinkConnected: true }; }

describe("Physarum generalized-cost sensitivity", () => {
  it.each([1, 1.1, 1.25, 1.5, 2, 3, 5])("records deterministic response for cost ratio 1:%s", (ratio) => { const first = runPhysarum(network(ratio)); const second = runPhysarum(network(ratio)); const cheap = Math.abs(first.edgeFlows["cheap-1"]); const costly = Math.abs(first.edgeFlows["costly-1"]); expect(first).toEqual(second); expect(cheap).toBeGreaterThanOrEqual(costly); console.info(`sensitivity ratio=1:${ratio} flow=${cheap.toFixed(6)}:${costly.toFixed(6)} conductivity=${first.edgeConductivities["cheap-1"].toFixed(6)}:${first.edgeConductivities["costly-1"].toFixed(6)} iterations=${first.iteration}`); });
});

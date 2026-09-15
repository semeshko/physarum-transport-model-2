import { describe, expect, it } from "vitest";
import type { PreparedEdge, PreparedNetwork, ScenarioTerminal } from "../scenario/types";
import { demandReferenceMagnitude } from "./demand";
import { runPhysarum } from "./solver";

function edge(graphEdgeId: string, fromNodeId: string, toNodeId: string, effectiveCost = 1): PreparedEdge {
  return { graphEdgeId, fromNodeId, toNodeId, lengthMeters: effectiveCost, penaltyMultiplier: 1, effectiveCost };
}

function network(nodeIds: readonly string[], edges: readonly PreparedEdge[], terminals: readonly ScenarioTerminal[]): PreparedNetwork {
  return {
    graphId: "multi-terminal-fixture",
    scenarioId: "multi-terminal-fixture",
    nodes: nodeIds.map((id, index) => ({ id, position: [index, 0] })),
    edges,
    terminals,
    activeEdgeCount: edges.length,
    blockedEdgeCount: 0,
    sourceSinkConnected: true,
  };
}

const ROBUST = { maxIterations: 2000, convergenceTolerance: 1e-8 };

// A. two sources -> one sink. Each source has a single dedicated edge, so
// Kirchhoff conservation forces edge flow to exactly match that source's
// magnitude regardless of Physarum adaptation - a clean conservation check.
function twoSourcesOneSink(s1: number, s2: number): PreparedNetwork {
  return network(
    ["s1", "s2", "t"],
    [edge("s1-t", "s1", "t", 1), edge("s2-t", "s2", "t", 1)],
    [
      { id: "s1", role: "source", nodeId: "s1", magnitude: s1 },
      { id: "s2", role: "source", nodeId: "s2", magnitude: s2 },
      { id: "t", role: "sink", nodeId: "t", magnitude: s1 + s2 },
    ],
  );
}

// B. one source -> two sinks, mirror of A.
function oneSourceTwoSinks(t1: number, t2: number): PreparedNetwork {
  return network(
    ["s", "t1", "t2"],
    [edge("s-t1", "s", "t1", 1), edge("s-t2", "s", "t2", 1)],
    [
      { id: "s", role: "source", nodeId: "s", magnitude: t1 + t2 },
      { id: "t1", role: "sink", nodeId: "t1", magnitude: t1 },
      { id: "t2", role: "sink", nodeId: "t2", magnitude: t2 },
    ],
  );
}

// C. two sources -> two sinks, each source paired 1:1 with a sink via its
// own edge - again a pure conservation check with a fully multi-terminal
// network (no shared nodes between the two source/sink pairs).
function twoSourcesTwoSinks(s1: number, t1: number, s2: number, t2: number): PreparedNetwork {
  return network(
    ["s1", "t1", "s2", "t2"],
    [edge("s1-t1", "s1", "t1", 1), edge("s2-t2", "s2", "t2", 1)],
    [
      { id: "s1", role: "source", nodeId: "s1", magnitude: s1 },
      { id: "t1", role: "sink", nodeId: "t1", magnitude: t1 },
      { id: "s2", role: "source", nodeId: "s2", magnitude: s2 },
      { id: "t2", role: "sink", nodeId: "t2", magnitude: t2 },
    ],
  );
}

// D/E-style unequal magnitudes reuse the same two fixtures above with
// deliberately asymmetric numbers (see individual tests below).

// "Genuine choice" fixture: two sources, each with a cheap route and an
// expensive route into a shared sink. s1 prefers route A, s2 prefers route
// B. This is the fixture that can actually exercise Physarum's competitive
// selection across multiple demand terminals (the star fixtures above
// cannot, since they have no alternative routes to select between).
function competingRoutes(s1: number, s2: number): PreparedNetwork {
  return network(
    ["s1", "s2", "a", "b", "t"],
    [
      edge("s1-a", "s1", "a", 1),
      edge("s1-b", "s1", "b", 2),
      edge("s2-a", "s2", "a", 2),
      edge("s2-b", "s2", "b", 1),
      edge("a-t", "a", "t", 1),
      edge("b-t", "b", "t", 1),
    ],
    [
      { id: "s1", role: "source", nodeId: "s1", magnitude: s1 },
      { id: "s2", role: "source", nodeId: "s2", magnitude: s2 },
      { id: "t", role: "sink", nodeId: "t", magnitude: s1 + s2 },
    ],
  );
}

function routeAShare(edgeFlows: Readonly<Record<string, number>>): number {
  const a = Math.abs(edgeFlows["a-t"]);
  const b = Math.abs(edgeFlows["b-t"]);
  return a / (a + b);
}

describe("multi-source / multi-sink conservation", () => {
  it("two sources -> one sink: edge flow matches each source's magnitude exactly", () => {
    const state = runPhysarum(twoSourcesOneSink(3, 1), ROBUST);
    expect(state.terminationReason).toBe("converged");
    expect(state.edgeFlows["s1-t"]).toBeCloseTo(3, 6);
    expect(state.edgeFlows["s2-t"]).toBeCloseTo(1, 6);
    expect(state.diagnostics.sourceFlowBalanceError).toBeLessThan(1e-6);
    expect(state.diagnostics.sinkFlowBalanceError).toBeLessThan(1e-6);
  });

  it("one source -> two sinks: edge flow matches each sink's magnitude exactly (unequal, globally balanced)", () => {
    const state = runPhysarum(oneSourceTwoSinks(3, 1), ROBUST);
    expect(state.terminationReason).toBe("converged");
    expect(state.edgeFlows["s-t1"]).toBeCloseTo(3, 6);
    expect(state.edgeFlows["s-t2"]).toBeCloseTo(1, 6);
  });

  it("two sources -> two sinks: each independent source/sink pair conserves flow", () => {
    const state = runPhysarum(twoSourcesTwoSinks(2, 2, 5, 5), ROBUST);
    expect(state.terminationReason).toBe("converged");
    expect(state.edgeFlows["s1-t1"]).toBeCloseTo(2, 6);
    expect(state.edgeFlows["s2-t2"]).toBeCloseTo(5, 6);
  });

  it("Qref sums all positive source terminals, not just the first one", () => {
    expect(demandReferenceMagnitude(twoSourcesOneSink(3, 1))).toBe(4);
    expect(demandReferenceMagnitude(twoSourcesTwoSinks(2, 2, 5, 5))).toBe(7);
  });

  it("is deterministic: running the same multi-terminal network twice yields identical flows", () => {
    const a = runPhysarum(competingRoutes(3, 1), ROBUST);
    const b = runPhysarum(competingRoutes(3, 1), ROBUST);
    expect(a.edgeFlows).toEqual(b.edgeFlows);
  });
});

describe("multi-source structural response", () => {
  it("uniform scaling of all source magnitudes together leaves structure unchanged under demand normalization", () => {
    const small = runPhysarum(competingRoutes(3, 1), { ...ROBUST, demandScaleKappa: 1 });
    const large = runPhysarum(competingRoutes(30, 10), { ...ROBUST, demandScaleKappa: 1 });
    expect(Math.abs(routeAShare(small.edgeFlows) - routeAShare(large.edgeFlows))).toBeLessThan(1e-3);
  });

  it("uniform scaling of all source magnitudes together DOES shift structure under legacy fixed-K (documenting the problem Task 17 addresses for multi-source networks too)", () => {
    const small = routeAShare(runPhysarum(competingRoutes(3, 1), ROBUST).edgeFlows);
    const large = routeAShare(runPhysarum(competingRoutes(30, 10), ROBUST).edgeFlows);
    expect(Math.abs(small - large)).toBeGreaterThan(0.05);
  });

  it("changing the RELATIVE demand between two sources changes which route dominates (this must remain true in both scale modes)", () => {
    for (const overrides of [ROBUST, { ...ROBUST, demandScaleKappa: 1 }]) {
      const s1Dominant = routeAShare(runPhysarum(competingRoutes(10, 1), overrides).edgeFlows);
      const s2Dominant = routeAShare(runPhysarum(competingRoutes(1, 10), overrides).edgeFlows);
      // s1 prefers route A, s2 prefers route B, so route A's share of total
      // flow must be higher when s1 dominates than when s2 dominates.
      expect(s1Dominant).toBeGreaterThan(s2Dominant);
    }
  });
});

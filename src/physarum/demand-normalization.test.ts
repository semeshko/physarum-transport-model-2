import { describe, expect, it } from "vitest";
import type { PreparedEdge, PreparedNetwork, ScenarioTerminal } from "../scenario/types";
import { demandReferenceMagnitude } from "./demand";
import { resolvePhysarumParameters } from "./parameters";
import { runPhysarum } from "./solver";
import { PhysarumSolverError } from "./types";

function edge(graphEdgeId: string, fromNodeId: string, toNodeId: string, effectiveCost: number): PreparedEdge {
  return { graphEdgeId, fromNodeId, toNodeId, lengthMeters: effectiveCost, penaltyMultiplier: 1, effectiveCost };
}

function twoCorridorNetwork(magnitude: number, ratio = 1.1): PreparedNetwork {
  const terminals: readonly ScenarioTerminal[] = [
    { id: "source", role: "source", nodeId: "s", magnitude },
    { id: "sink", role: "sink", nodeId: "t", magnitude },
  ];
  return {
    graphId: "demand-normalization-fixture",
    scenarioId: "demand-normalization-fixture",
    nodes: ["s", "a", "b", "t"].map((id, index) => ({ id, position: [index, 0] })),
    edges: [edge("upper-1", "s", "a", 1), edge("upper-2", "a", "t", 1), edge("lower-1", "s", "b", ratio), edge("lower-2", "b", "t", ratio)],
    terminals,
    activeEdgeCount: 4,
    blockedEdgeCount: 0,
    sourceSinkConnected: true,
  };
}

const ROBUST = { maxIterations: 2000, convergenceTolerance: 1e-8 };

function upperShare(edgeFlows: Readonly<Record<string, number>>): number {
  const upper = Math.abs(edgeFlows["upper-1"]);
  const lower = Math.abs(edgeFlows["lower-1"]);
  return upper / (upper + lower);
}

describe("demandReferenceMagnitude", () => {
  it("sums only source terminals, ignoring sinks", () => {
    const network = twoCorridorNetwork(5);
    expect(demandReferenceMagnitude(network)).toBe(5);
  });

  it("ignores non-positive magnitudes and ignores sink role entirely", () => {
    const network: PreparedNetwork = {
      ...twoCorridorNetwork(1),
      terminals: [
        { id: "s1", role: "source", nodeId: "s", magnitude: 3 },
        { id: "s2", role: "source", nodeId: "s", magnitude: -2 },
        { id: "sink", role: "sink", nodeId: "t", magnitude: 999 },
      ],
    };
    expect(demandReferenceMagnitude(network)).toBe(3);
  });
});

describe("resolvePhysarumParameters demandScaleKappa validation", () => {
  it("accepts undefined (legacy mode, unchanged default behavior)", () => {
    expect(() => resolvePhysarumParameters({})).not.toThrow();
  });

  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`rejects demandScaleKappa=${invalid}`, () => {
      expect(() => resolvePhysarumParameters({ demandScaleKappa: invalid })).toThrow(PhysarumSolverError);
    });
  }
});

describe("Task 17: demand-normalized Hill threshold", () => {
  it("legacy mode (no kappa) is scale-dependent: selection strength changes with absolute demand magnitude", () => {
    const shareAt1 = upperShare(runPhysarum(twoCorridorNetwork(1), ROBUST).edgeFlows);
    const shareAt10 = upperShare(runPhysarum(twoCorridorNetwork(10), ROBUST).edgeFlows);
    // This is the Task 16 problem: identical relative demand (one source, one
    // sink, same cost ratio) produces very different network structure once
    // absolute magnitude moves away from the fixed hillK=1 baseline.
    expect(Math.abs(shareAt1 - shareAt10)).toBeGreaterThan(0.3);
  });

  it("normalized mode (kappa) keeps network structure invariant under uniform demand rescaling", () => {
    const magnitudes = [0.1, 1, 10];
    const shares = magnitudes.map((magnitude) => upperShare(runPhysarum(twoCorridorNetwork(magnitude), { ...ROBUST, demandScaleKappa: 1 }).edgeFlows));
    for (const share of shares) expect(Math.abs(share - shares[0])).toBeLessThan(1e-3);
  });

  it("still discriminates between genuinely different cost ratios under normalization (not just collapsing to 50/50)", () => {
    const closeRatio = upperShare(runPhysarum(twoCorridorNetwork(5, 1.01), { ...ROBUST, demandScaleKappa: 1 }).edgeFlows);
    const wideRatio = upperShare(runPhysarum(twoCorridorNetwork(5, 3), { ...ROBUST, demandScaleKappa: 1 }).edgeFlows);
    expect(closeRatio).toBeGreaterThan(0.5);
    expect(wideRatio).toBeGreaterThan(closeRatio);
  });
});

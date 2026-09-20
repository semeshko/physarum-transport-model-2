import { describe, expect, it } from "vitest";
import type { PreparedEdge, PreparedNetwork, ScenarioTerminal } from "../scenario/types";
import { DEFAULT_DESIGN_ADAPTATION, resolveDesignAdaptation, runDesignField } from "./adaptation";

const TRANSMISSIBILITY = Math.sqrt(3);
/**
 * Subdividing a corridor lengthwise does not change its physical width, so the
 * dual width w_e stays fixed while l_e shrinks and effectiveCost = l_e / w_e
 * varies. (Refining the lattice itself would shrink both together.)
 */
const CORRIDOR_WIDTH = 100 / TRANSMISSIBILITY;

/** Chain of `segments` collinear candidate edges spanning the same physical corridor. */
function chain(segments: number, totalLength = 100, magnitude = 1): PreparedNetwork {
  const length = totalLength / segments;
  const nodes = Array.from({ length: segments + 1 }, (_, i) => `n${i}`);
  const edges: PreparedEdge[] = Array.from({ length: segments }, (_, i) => ({
    graphEdgeId: `e${i}`, fromNodeId: nodes[i], toNodeId: nodes[i + 1],
    lengthMeters: length, penaltyMultiplier: 1, effectiveCost: length / CORRIDOR_WIDTH,
  }));
  const terminals: ScenarioTerminal[] = [
    { id: "s", role: "source", nodeId: nodes[0], magnitude },
    { id: "t", role: "sink", nodeId: nodes.at(-1)!, magnitude },
  ];
  return { graphId: "chain", scenarioId: "chain", nodes: nodes.map((id, i) => ({ id, position: [i, 0] as const })), edges, terminals, activeEdgeCount: edges.length, blockedEdgeCount: 0, sourceSinkConnected: true };
}

/** Two parallel corridors between the same endpoints, with a physical resistance ratio. */
function twoCorridors(ratio: number): PreparedNetwork {
  const edge = (id: string, from: string, to: string, cost: number): PreparedEdge => ({ graphEdgeId: id, fromNodeId: from, toNodeId: to, lengthMeters: 50, penaltyMultiplier: 1, effectiveCost: cost });
  const edges = [
    edge("upper1", "s", "a", TRANSMISSIBILITY), edge("upper2", "a", "t", TRANSMISSIBILITY),
    edge("lower1", "s", "b", TRANSMISSIBILITY * ratio), edge("lower2", "b", "t", TRANSMISSIBILITY * ratio),
  ];
  return {
    graphId: "corridors", scenarioId: "corridors",
    nodes: ["s", "a", "b", "t"].map((id, i) => ({ id, position: [i, 0] as const })), edges,
    terminals: [{ id: "s", role: "source", nodeId: "s", magnitude: 1 }, { id: "t", role: "sink", nodeId: "t", magnitude: 1 }],
    activeEdgeCount: 4, blockedEdgeCount: 0, sourceSinkConnected: true,
  };
}

describe("design adaptation parameters", () => {
  it("defaults to the Gate E/F validated configuration", () => {
    expect(DEFAULT_DESIGN_ADAPTATION.gamma).toBe(1.5);
    expect(DEFAULT_DESIGN_ADAPTATION.nu).toBe(1);
    expect(DEFAULT_DESIGN_ADAPTATION.timeStep).toBe(0.5);
  });

  it("rejects gamma <= 1, which has no p-Laplacian steady state", () => {
    expect(() => resolveDesignAdaptation({ gamma: 1 })).toThrow();
    expect(() => resolveDesignAdaptation({ gamma: 0.5 })).toThrow();
  });

  it("rejects non-positive or non-finite parameters", () => {
    expect(() => resolveDesignAdaptation({ nu: 0 })).toThrow();
    expect(() => resolveDesignAdaptation({ timeStep: Number.NaN })).toThrow();
    expect(() => resolveDesignAdaptation({ maxIterations: 0 })).toThrow();
  });
});

describe("design field evolution", () => {
  it("converges with monotone energy under the IMEX step", () => {
    const state = runDesignField(chain(5));
    expect(state.error).toBeNull();
    expect(state.diagnostics.converged).toBe(true);
    expect(state.diagnostics.energyMonotone).toBe(true);
    expect(state.diagnostics.iteration).toBeLessThan(400);
    expect(state.diagnostics.maximumKirchhoffResidual).toBeLessThan(1e-8);
  });

  it("produces finite, positive conductivity everywhere", () => {
    const state = runDesignField(chain(8));
    for (const value of Object.values(state.conductivity)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("is invariant to subdividing the same physical corridor", () => {
    const reference = runDesignField(chain(1));
    const referenceC = Object.values(reference.conductivity)[0];
    for (const segments of [2, 5, 10, 25]) {
      const state = runDesignField(chain(segments));
      for (const value of Object.values(state.conductivity)) expect(value).toBeCloseTo(referenceC, 6);
    }
  });

  it("keeps flux density invariant under subdivision", () => {
    const reference = Object.values(runDesignField(chain(1)).fluxDensity)[0];
    for (const segments of [2, 5, 10, 25]) {
      for (const value of Object.values(runDesignField(chain(segments)).fluxDensity)) expect(value).toBeCloseTo(reference, 6);
    }
  });

  it("scales conductivity with demand while holding the spatial pattern", () => {
    const base = runDesignField(chain(5, 100, 1));
    const scaled = runDesignField(chain(5, 100, 10));
    const baseValues = Object.values(base.conductivity), scaledValues = Object.values(scaled.conductivity);
    expect(Math.max(...scaledValues)).toBeGreaterThan(Math.max(...baseValues));
    // pattern: every edge keeps the same share of the total
    const share = (values: number[]) => { const total = values.reduce((a, b) => a + b, 0); return values.map((v) => v / total); };
    share(scaledValues).forEach((value, index) => expect(value).toBeCloseTo(share(baseValues)[index], 9));
  });

  it("responds monotonically to a physical cost difference", () => {
    const shares = [1, 1.1, 1.5, 2].map((ratio) => {
      const state = runDesignField(twoCorridors(ratio));
      const upper = Math.abs(state.edgeFlows.upper1), lower = Math.abs(state.edgeFlows.lower1);
      return upper / (upper + lower);
    });
    expect(shares[0]).toBeCloseTo(0.5, 6);
    for (let i = 1; i < shares.length; i += 1) expect(shares[i]).toBeGreaterThan(shares[i - 1]);
    expect(shares.at(-1)!).toBeGreaterThan(0.6);
  });

  it("is deterministic", () => {
    expect(runDesignField(chain(6)).conductivity).toEqual(runDesignField(chain(6)).conductivity);
  });

  it("reports maxIterations rather than pretending to converge", () => {
    const state = runDesignField(chain(5), { maxIterations: 3 });
    expect(state.diagnostics.converged).toBe(false);
    expect(state.diagnostics.terminationReason).toBe("maxIterations");
    expect(state.error).toBeNull();
  });
});

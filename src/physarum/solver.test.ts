import { describe, expect, it } from "vitest";
import type { PreparedEdge, PreparedNetwork, ScenarioTerminal } from "../scenario/types";
import { solveHydraulics } from "./hydraulics";
import { runPhysarum } from "./solver";

const terminals: readonly ScenarioTerminal[] = [
  { id: "source", role: "source", nodeId: "s", magnitude: 1 },
  { id: "sink", role: "sink", nodeId: "t", magnitude: 1 },
];

function edge(graphEdgeId: string, fromNodeId: string, toNodeId: string, effectiveCost = 1): PreparedEdge {
  return { graphEdgeId, fromNodeId, toNodeId, lengthMeters: 1, penaltyMultiplier: effectiveCost, effectiveCost };
}

function network(nodeIds: readonly string[], edges: readonly PreparedEdge[], networkTerminals = terminals): PreparedNetwork {
  return { graphId: "fixture", scenarioId: "scenario", nodes: nodeIds.map((id, index) => ({ id, position: [index, 0] })), edges, terminals: networkTerminals, activeEdgeCount: edges.length, blockedEdgeCount: 0, sourceSinkConnected: true };
}

const single = () => network(["s", "t"], [edge("e", "s", "t")]);
const series = () => network(["s", "m", "t"], [edge("e1", "s", "m"), edge("e2", "m", "t")]);
const parallel = (upperCost = 1, lowerCost = 1) => network(["s", "a", "b", "t"], [edge("upper-1", "s", "a", upperCost), edge("upper-2", "a", "t", upperCost), edge("lower-1", "s", "b", lowerCost), edge("lower-2", "b", "t", lowerCost)]);

describe("Physarum hydraulic core", () => {
  it("solves finite pressure and unit flow for a single edge", () => {
    const result = runPhysarum(single());
    expect(result.terminationReason).toBe("converged");
    expect(result.edgeFlows.e).toBeCloseTo(1, 10);
    expect(result.nodePressures.t).toBe(0);
    expect(Number.isFinite(result.nodePressures.s)).toBe(true);
  });

  it("satisfies Kirchhoff conservation", () => {
    expect(runPhysarum(series()).diagnostics.maximumKirchhoffResidual).toBeLessThan(1e-9);
  });

  it("has equal flow through two series edges", () => {
    const result = runPhysarum(series());
    expect(result.edgeFlows.e1).toBeCloseTo(result.edgeFlows.e2, 10);
    expect(Math.abs(result.edgeFlows.e1)).toBeCloseTo(1, 10);
  });

  it("keeps symmetric parallel paths equal", () => {
    const result = runPhysarum(parallel());
    expect(Math.abs(result.edgeFlows["upper-1"])).toBeCloseTo(0.5, 8);
    expect(result.edgeConductivities["upper-1"]).toBeCloseTo(result.edgeConductivities["lower-1"], 10);
  });

  it("favors the lower-cost parallel path", () => {
    const result = runPhysarum(parallel(1, 2));
    expect(Math.abs(result.edgeFlows["upper-1"])).toBeGreaterThan(Math.abs(result.edgeFlows["lower-1"]));
    expect(result.edgeConductivities["upper-1"]).toBeGreaterThan(result.edgeConductivities["lower-1"]);
  });

  it("soft effective-cost penalty reduces path flow", () => {
    const unpenalized = runPhysarum(parallel());
    const penalized = runPhysarum(parallel(1, 3));
    expect(Math.abs(penalized.edgeFlows["lower-1"])).toBeLessThan(Math.abs(unpenalized.edgeFlows["lower-1"]));
  });

  it("initializes conductivity deterministically", () => {
    const hydraulic = solveHydraulics(single(), { e: 2 });
    expect(hydraulic.flows.e).toBeCloseTo(1, 10);
    expect(runPhysarum(single(), { initialConductivity: 2 })).toEqual(runPhysarum(single(), { initialConductivity: 2 }));
  });

  it("returns identical repeated solves", () => {
    expect(runPhysarum(parallel(1, 2))).toEqual(runPhysarum(parallel(1, 2)));
  });

  it("keeps every conductivity positive", () => {
    expect(Object.values(runPhysarum(parallel(1, 4)).edgeConductivities).every((value) => value > 0)).toBe(true);
  });

  it.each([
    { initialConductivity: 0 },
    { timeStep: Number.NaN },
    { hillK: Number.POSITIVE_INFINITY },
    { maxIterations: 1.5 },
  ])("rejects invalid parameters %#", (parameters) => {
    expect(() => runPhysarum(single(), parameters)).toThrow();
  });

  it("fails clearly for invalid effectiveCost", () => {
    const result = runPhysarum(network(["s", "t"], [edge("bad", "s", "t", 0)]));
    expect(result).toMatchObject({ terminationReason: "numericFailure", converged: false });
    expect(result.error).toMatch(/effectiveCost/);
  });

  it("uses a deterministic zero-pressure reference", () => {
    const result = runPhysarum(series());
    expect(result.nodePressures.t).toBe(0);
  });

  it("contains no non-finite values in a valid run", () => {
    const result = runPhysarum(parallel(1, 2));
    expect([...Object.values(result.nodePressures), ...Object.values(result.edgeFlows), ...Object.values(result.edgeConductivities)].every(Number.isFinite)).toBe(true);
  });

  it("reports convergence explicitly", () => {
    expect(runPhysarum(single())).toMatchObject({ converged: true, terminationReason: "converged" });
  });

  it("distinguishes maxIterations from convergence", () => {
    expect(runPhysarum(single(), { maxIterations: 1, convergenceTolerance: 1e-15 })).toMatchObject({ converged: false, terminationReason: "maxIterations", iteration: 1 });
  });

  it("does not mutate PreparedNetwork", () => {
    const input = parallel(1, 2);
    const before = JSON.stringify(input);
    runPhysarum(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("supports balanced multiple terminals", () => {
    const multiple = network(["s", "u", "t"], [edge("a", "s", "t"), edge("b", "u", "t")], [
      { id: "s1", role: "source", nodeId: "s", magnitude: 0.4 },
      { id: "s2", role: "source", nodeId: "u", magnitude: 0.6 },
      { id: "t1", role: "sink", nodeId: "t", magnitude: 1 },
    ]);
    expect(runPhysarum(multiple).diagnostics.maximumKirchhoffResidual).toBeLessThan(1e-9);
  });

  it("rejects unbalanced terminal magnitudes", () => {
    const unbalanced = network(["s", "t"], [edge("e", "s", "t")], [{ ...terminals[0], magnitude: 2 }, terminals[1]]);
    expect(runPhysarum(unbalanced).terminationReason).toBe("numericFailure");
  });

  it("only receives edges retained by PreparedNetwork", () => {
    const preparedAfterBlock = network(["s", "a", "t"], [edge("detour-1", "s", "a"), edge("detour-2", "a", "t")]);
    expect(Object.keys(runPhysarum(preparedAfterBlock).edgeFlows)).toEqual(["detour-1", "detour-2"]);
  });
});

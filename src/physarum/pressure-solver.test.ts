import { describe, expect, it } from "vitest";
import { createBranchingNetwork, createGridNetwork } from "../benchmarks/networks";
import type { PreparedNetwork } from "../scenario/types";
import { solveHydraulics } from "./hydraulics";
import { solveConjugateGradient } from "./pressure-solver";
import { initializePhysarum, runPhysarum, stepPhysarum } from "./solver";

function conductivities(network: PreparedNetwork): Record<string, number> {
  return Object.fromEntries(network.edges.map((edge, index) => [edge.graphEdgeId, 0.5 + (index % 7) * 0.17]));
}

function expectRecordsClose(actual: Readonly<Record<string, number>>, expected: Readonly<Record<string, number>>, digits = 7): void {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(expected)) expect(actual[key], key).toBeCloseTo(expected[key], digits);
}

function smallNetwork(kind: "single" | "series" | "parallel" | "unequal"): PreparedNetwork {
  const nodeIds = kind === "single" ? ["s", "t"] : kind === "series" ? ["s", "m", "t"] : ["s", "a", "b", "t"];
  const definitions = kind === "single" ? [["e", "s", "t", 1]] : kind === "series" ? [["e1", "s", "m", 1], ["e2", "m", "t", 1]] : [["u1", "s", "a", 1], ["u2", "a", "t", 1], ["l1", "s", "b", kind === "unequal" ? 2 : 1], ["l2", "b", "t", kind === "unequal" ? 2 : 1]];
  return {
    graphId: kind, scenarioId: "test", nodes: nodeIds.map((id, index) => ({ id, position: [index, 0] })),
    edges: definitions.map(([graphEdgeId, fromNodeId, toNodeId, effectiveCost]) => ({ graphEdgeId: String(graphEdgeId), fromNodeId: String(fromNodeId), toNodeId: String(toNodeId), lengthMeters: Number(effectiveCost), penaltyMultiplier: 1, effectiveCost: Number(effectiveCost) })),
    terminals: [{ id: "source", role: "source", nodeId: "s", magnitude: 1 }, { id: "sink", role: "sink", nodeId: "t", magnitude: 1 }],
    activeEdgeCount: definitions.length, blockedEdgeCount: 0, sourceSinkConnected: true,
  };
}

describe("sparse pressure solver parity", () => {
  it.each(["single", "series", "parallel", "unequal"] as const)("matches the dense reference on the %s fixture", (kind) => {
    const network = smallNetwork(kind);
    const values = conductivities(network);
    const dense = solveHydraulics(network, values, { method: "dense" });
    const sparse = solveHydraulics(network, values);
    expectRecordsClose(sparse.pressures, dense.pressures, 9);
    expectRecordsClose(sparse.flows, dense.flows, 9);
    expect(sparse.linearSolve.residualNorm).toBeLessThanOrEqual(sparse.linearSolve.tolerance);
  });

  it.each([
    ["grid", createGridNetwork(5, 5)],
    ["branching", createBranchingNetwork(6)],
  ])("matches the dense reference on %s topology", (_name, network) => {
    const values = conductivities(network);
    const dense = solveHydraulics(network, values, { method: "dense" });
    const sparse = solveHydraulics(network, values);
    expectRecordsClose(sparse.pressures, dense.pressures, 7);
    expectRecordsClose(sparse.flows, dense.flows, 7);
    expect(sparse.maximumKirchhoffResidual).toBeLessThan(1e-9);
    expect(sparse.linearSolve).toMatchObject({ method: "conjugate-gradient", converged: true, failureReason: null });
  });

  it("solves balanced disconnected components with deterministic anchors", () => {
    const network: PreparedNetwork = {
      graphId: "disconnected", scenarioId: "test",
      nodes: ["a", "b", "c", "d"].map((id, index) => ({ id, position: [index, 0] })),
      edges: [
        { graphEdgeId: "ab", fromNodeId: "a", toNodeId: "b", lengthMeters: 1, penaltyMultiplier: 1, effectiveCost: 1 },
        { graphEdgeId: "cd", fromNodeId: "c", toNodeId: "d", lengthMeters: 1, penaltyMultiplier: 1, effectiveCost: 1 },
      ],
      terminals: [
        { id: "sa", role: "source", nodeId: "a", magnitude: 1 }, { id: "tb", role: "sink", nodeId: "b", magnitude: 1 },
        { id: "sc", role: "source", nodeId: "c", magnitude: 2 }, { id: "td", role: "sink", nodeId: "d", magnitude: 2 },
      ], activeEdgeCount: 2, blockedEdgeCount: 0, sourceSinkConnected: true,
    };
    const result = solveHydraulics(network, { ab: 1, cd: 1 });
    expect(result.pressures).toMatchObject({ b: 0, d: 0 });
    expect(result.flows.ab).toBeCloseTo(1, 10);
    expect(result.flows.cd).toBeCloseTo(2, 10);
  });

  it("produces deterministic finite results", () => {
    const network = createGridNetwork(7, 7);
    const first = solveHydraulics(network, conductivities(network));
    const second = solveHydraulics(network, conductivities(network));
    expect(second).toEqual(first);
    expect([...Object.values(first.pressures), ...Object.values(first.flows)].every(Number.isFinite)).toBe(true);
  });

  it("fails clearly on a non-positive preconditioner diagonal", () => {
    expect(() => solveConjugateGradient({ size: 1, edges: [], diagonal: [0], vector: [1] })).toThrow(/non-positive diagonal/);
  });

  it("fails clearly when the iteration budget cannot satisfy tolerance", () => {
    const network = createGridNetwork(5, 5);
    expect(() => solveHydraulics(network, conductivities(network), { maxIterations: 1, relativeTolerance: 1e-15, absoluteTolerance: 1e-15 })).toThrow(/did not converge/);
  });

  it("matches a dense Physarum step and complete nonlinear run", () => {
    const network = createGridNetwork(4, 4);
    const parameters = { maxIterations: 80, convergenceTolerance: 1e-6 };
    const denseStep = stepPhysarum(network, initializePhysarum(network, parameters, { method: "dense" }));
    const sparseStep = stepPhysarum(network, initializePhysarum(network, parameters));
    expectRecordsClose(sparseStep.state.edgeConductivities, denseStep.state.edgeConductivities, 8);
    expectRecordsClose(sparseStep.state.edgeFlows, denseStep.state.edgeFlows, 8);
    const dense = runPhysarum(network, parameters, { method: "dense" });
    const sparse = runPhysarum(network, parameters);
    expect(sparse.terminationReason).toBe(dense.terminationReason);
    expect(sparse.iteration).toBe(dense.iteration);
    expectRecordsClose(sparse.nodePressures, dense.nodePressures, 6);
    expectRecordsClose(sparse.edgeFlows, dense.edgeFlows, 6);
    expectRecordsClose(sparse.edgeConductivities, dense.edgeConductivities, 6);
    expect(sparse.diagnostics.maximumKirchhoffResidual).toBeLessThan(1e-9);
  });

  it("does not mutate the prepared network or conductivity input", () => {
    const network = createGridNetwork(4, 4);
    const values = conductivities(network);
    const before = JSON.stringify({ network, values });
    solveHydraulics(network, values);
    expect(JSON.stringify({ network, values })).toBe(before);
  });
});

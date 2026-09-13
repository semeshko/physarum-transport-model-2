import type { PreparedNetwork } from "../scenario/types";
import { solveConjugateGradient, solveDenseReference, type SparseLaplacianSystem } from "./pressure-solver";
import type { HydraulicSolution, PressureSolverOptions } from "./types";
import { PhysarumSolverError } from "./types";

const BALANCE_TOLERANCE = 1e-10;

export type AssembledPressureSystem = {
  readonly sparseSystem: SparseLaplacianSystem;
  readonly solvedNodeIds: readonly string[];
  readonly referenceNodeIds: ReadonlySet<string>;
  readonly injections: Readonly<Record<string, number>>;
};

function buildInjections(network: PreparedNetwork): Record<string, number> {
  const injections = Object.fromEntries(network.nodes.map((node) => [node.id, 0])) as Record<string, number>;
  let sourceMagnitude = 0;
  let sinkMagnitude = 0;
  for (const terminal of network.terminals) {
    if (!(terminal.nodeId in injections) || !Number.isFinite(terminal.magnitude) || terminal.magnitude <= 0) throw new PhysarumSolverError("invalid-network", `Invalid terminal ${terminal.id}.`);
    const signed = terminal.role === "source" ? terminal.magnitude : -terminal.magnitude;
    injections[terminal.nodeId] += signed;
    if (terminal.role === "source") sourceMagnitude += terminal.magnitude; else sinkMagnitude += terminal.magnitude;
  }
  if (Math.abs(sourceMagnitude - sinkMagnitude) > BALANCE_TOLERANCE * Math.max(1, sourceMagnitude, sinkMagnitude)) throw new PhysarumSolverError("unbalanced-terminals", "Total source and sink magnitudes must balance.");
  return injections;
}

export function assemblePressureSystem(network: PreparedNetwork, conductivities: Readonly<Record<string, number>>): AssembledPressureSystem {
  if (network.nodes.length < 2) throw new PhysarumSolverError("invalid-network", "A hydraulic network requires at least two nodes.");
  const nodeIds = network.nodes.map((node) => node.id).sort((a, b) => a.localeCompare(b));
  const nodeIndex = new Map(nodeIds.map((id, index) => [id, index]));
  const injections = buildInjections(network);
  const adjacency = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  for (const edge of network.edges) {
    if (!nodeIndex.has(edge.fromNodeId) || !nodeIndex.has(edge.toNodeId) || edge.fromNodeId === edge.toNodeId) throw new PhysarumSolverError("invalid-network", `Edge ${edge.graphEdgeId} has invalid endpoints.`);
    adjacency.get(edge.fromNodeId)!.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)!.add(edge.fromNodeId);
  }

  const referenceNodeIds = new Set<string>();
  const visited = new Set<string>();
  for (const start of nodeIds) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const neighbor of adjacency.get(current)!) if (!visited.has(neighbor)) queue.push(neighbor);
    }
    const componentInjection = component.reduce((sum, id) => sum + injections[id], 0);
    if (Math.abs(componentInjection) > BALANCE_TOLERANCE) throw new PhysarumSolverError("unbalanced-terminals", "Each disconnected component must have balanced terminal injections.");
    referenceNodeIds.add(component.sort((a, b) => a.localeCompare(b))[component.length - 1]);
  }

  const solvedNodeIds = nodeIds.filter((id) => !referenceNodeIds.has(id));
  const reducedIndex = new Map(solvedNodeIds.map((id, index) => [id, index]));
  const diagonal = Array<number>(solvedNodeIds.length).fill(0);
  const edges = network.edges.map((edge) => {
    const conductivity = conductivities[edge.graphEdgeId];
    if (!Number.isFinite(edge.effectiveCost) || edge.effectiveCost <= 0) throw new PhysarumSolverError("invalid-network", `Edge ${edge.graphEdgeId} has invalid effectiveCost.`);
    if (!Number.isFinite(conductivity) || conductivity <= 0) throw new PhysarumSolverError("invalid-network", `Edge ${edge.graphEdgeId} has invalid conductivity.`);
    const conductance = conductivity / edge.effectiveCost;
    const from = reducedIndex.get(edge.fromNodeId) ?? null;
    const to = reducedIndex.get(edge.toNodeId) ?? null;
    if (from !== null) diagonal[from] += conductance;
    if (to !== null) diagonal[to] += conductance;
    return { from, to, conductance };
  });
  return { sparseSystem: { size: solvedNodeIds.length, edges, diagonal, vector: solvedNodeIds.map((id) => injections[id]) }, solvedNodeIds, referenceNodeIds, injections };
}

export function solveHydraulics(network: PreparedNetwork, conductivities: Readonly<Record<string, number>>, options: PressureSolverOptions = {}): HydraulicSolution {
  const assembled = assemblePressureSystem(network, conductivities);
  const initialGuess = options.initialPressures ? assembled.solvedNodeIds.map((id) => options.initialPressures![id] ?? 0) : undefined;
  const solved = options.method === "dense"
    ? solveDenseReference(assembled.sparseSystem, options)
    : solveConjugateGradient(assembled.sparseSystem, options, initialGuess);
  if (!solved.diagnostics.converged) throw new PhysarumSolverError("numeric-failure", solved.diagnostics.failureReason ?? "Pressure solve did not converge.");

  const pressures: Record<string, number> = Object.fromEntries([...assembled.referenceNodeIds].map((id) => [id, 0]));
  assembled.solvedNodeIds.forEach((id, index) => { pressures[id] = solved.solution[index]; });
  const flows: Record<string, number> = {};
  const nodeIds = network.nodes.map((node) => node.id).sort((a, b) => a.localeCompare(b));
  const netOutflow = Object.fromEntries(nodeIds.map((id) => [id, 0])) as Record<string, number>;
  let totalAbsoluteFlow = 0;
  for (const edge of network.edges) {
    const flow = (conductivities[edge.graphEdgeId] / edge.effectiveCost) * (pressures[edge.fromNodeId] - pressures[edge.toNodeId]);
    if (!Number.isFinite(flow)) throw new PhysarumSolverError("numeric-failure", `Edge ${edge.graphEdgeId} produced a non-finite flow.`);
    flows[edge.graphEdgeId] = flow;
    netOutflow[edge.fromNodeId] += flow;
    netOutflow[edge.toNodeId] -= flow;
    totalAbsoluteFlow += Math.abs(flow);
  }
  let maximumKirchhoffResidual = 0;
  let sourceFlowBalanceError = 0;
  let sinkFlowBalanceError = 0;
  for (const nodeId of nodeIds) {
    const residual = Math.abs(netOutflow[nodeId] - assembled.injections[nodeId]);
    maximumKirchhoffResidual = Math.max(maximumKirchhoffResidual, residual);
    if (assembled.injections[nodeId] > 0) sourceFlowBalanceError = Math.max(sourceFlowBalanceError, residual);
    if (assembled.injections[nodeId] < 0) sinkFlowBalanceError = Math.max(sinkFlowBalanceError, residual);
  }
  return { pressures, flows, injections: assembled.injections, maximumKirchhoffResidual, sourceFlowBalanceError, sinkFlowBalanceError, totalAbsoluteFlow, linearSolve: solved.diagnostics };
}

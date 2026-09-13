import type { PreparedNetwork } from "../scenario/types";
import { solveDenseLinearSystem } from "./linear-system";
import type { HydraulicSolution } from "./types";
import { PhysarumSolverError } from "./types";

const BALANCE_TOLERANCE = 1e-10;

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

export function solveHydraulics(network: PreparedNetwork, conductivities: Readonly<Record<string, number>>): HydraulicSolution {
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
      visited.add(current); component.push(current);
      for (const neighbor of adjacency.get(current)!) if (!visited.has(neighbor)) queue.push(neighbor);
    }
    const componentInjection = component.reduce((sum, id) => sum + injections[id], 0);
    if (Math.abs(componentInjection) > BALANCE_TOLERANCE) throw new PhysarumSolverError("unbalanced-terminals", "Each disconnected component must have balanced terminal injections.");
    referenceNodeIds.add(component.sort((a, b) => a.localeCompare(b))[component.length - 1]);
  }
  const solvedNodeIds = nodeIds.filter((id) => !referenceNodeIds.has(id));
  const reducedIndex = new Map(solvedNodeIds.map((id, index) => [id, index]));
  const matrix = solvedNodeIds.map(() => Array<number>(solvedNodeIds.length).fill(0));
  const vector = solvedNodeIds.map((id) => injections[id]);
  for (const edge of network.edges) {
    const conductivity = conductivities[edge.graphEdgeId];
    if (!Number.isFinite(edge.effectiveCost) || edge.effectiveCost <= 0) throw new PhysarumSolverError("invalid-network", `Edge ${edge.graphEdgeId} has invalid effectiveCost.`);
    if (!Number.isFinite(conductivity) || conductivity <= 0) throw new PhysarumSolverError("invalid-network", `Edge ${edge.graphEdgeId} has invalid conductivity.`);
    const conductance = conductivity / edge.effectiveCost;
    const from = reducedIndex.get(edge.fromNodeId);
    const to = reducedIndex.get(edge.toNodeId);
    if (from !== undefined) matrix[from][from] += conductance;
    if (to !== undefined) matrix[to][to] += conductance;
    if (from !== undefined && to !== undefined) { matrix[from][to] -= conductance; matrix[to][from] -= conductance; }
  }
  const solution = solveDenseLinearSystem(matrix, vector);
  const pressures: Record<string, number> = Object.fromEntries([...referenceNodeIds].map((id) => [id, 0]));
  solvedNodeIds.forEach((id, index) => { pressures[id] = solution[index]; });
  const flows: Record<string, number> = {};
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
    const residual = Math.abs(netOutflow[nodeId] - injections[nodeId]);
    maximumKirchhoffResidual = Math.max(maximumKirchhoffResidual, residual);
    if (injections[nodeId] > 0) sourceFlowBalanceError = Math.max(sourceFlowBalanceError, residual);
    if (injections[nodeId] < 0) sinkFlowBalanceError = Math.max(sinkFlowBalanceError, residual);
  }
  return { pressures, flows, injections, maximumKirchhoffResidual, sourceFlowBalanceError, sinkFlowBalanceError, totalAbsoluteFlow };
}

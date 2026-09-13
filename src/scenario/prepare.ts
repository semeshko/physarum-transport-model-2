import type { GraphEdge, TransportGraph } from "../graph/types";
import type { AnalysisScenario, PreparedEdge, PreparedNetworkResult, ScenarioValidation, ScenarioValidationIssue } from "./types";

function terminalsConnected(graph: TransportGraph, terminalNodeIds: readonly string[], usableEdges: readonly GraphEdge[]): boolean | null {
  if (terminalNodeIds.length < 2) return null;
  const adjacency = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of usableEdges) {
    adjacency.get(edge.fromNodeId)?.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)?.add(edge.fromNodeId);
  }
  const visited = new Set<string>();
  const queue = [terminalNodeIds[0]];
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) if (!visited.has(neighbor)) queue.push(neighbor);
  }
  return terminalNodeIds.every((nodeId) => visited.has(nodeId));
}

export function prepareNetwork(graph: TransportGraph, scenario: AnalysisScenario): PreparedNetworkResult {
  const issues: ScenarioValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  const sources = scenario.terminals.filter((terminal) => terminal.role === "source");
  const sinks = scenario.terminals.filter((terminal) => terminal.role === "sink");
  if (sources.length === 0) issues.push({ code: "missing-source", message: "Select at least one source node." });
  if (sinks.length === 0) issues.push({ code: "missing-sink", message: "Select at least one sink node." });
  const terminalIds = new Set<string>();
  const terminalKeys = new Set<string>();
  for (const terminal of scenario.terminals) {
    const key = `${terminal.role}:${terminal.nodeId}`;
    if (terminalIds.has(terminal.id) || terminalKeys.has(key)) issues.push({ code: "duplicate-terminal", message: `Terminal ${terminal.id} is duplicated.` });
    terminalIds.add(terminal.id); terminalKeys.add(key);
    if (!nodeIds.has(terminal.nodeId)) issues.push({ code: "unknown-node", message: `Terminal ${terminal.id} references unknown node ${terminal.nodeId}.` });
    if (!Number.isFinite(terminal.magnitude) || terminal.magnitude <= 0) issues.push({ code: "invalid-terminal-magnitude", message: `Terminal ${terminal.id} must have a finite positive magnitude.` });
  }
  if (sources.some((source) => sinks.some((sink) => sink.nodeId === source.nodeId))) issues.push({ code: "same-source-sink", message: "A node cannot be both source and sink." });

  const constraintEdgeIds = new Set<string>();
  for (const constraint of scenario.edgeConstraints) {
    if (constraintEdgeIds.has(constraint.edgeId)) issues.push({ code: "duplicate-edge-constraint", message: `Edge ${constraint.edgeId} has duplicate constraints.` });
    constraintEdgeIds.add(constraint.edgeId);
    if (!edgeIds.has(constraint.edgeId)) issues.push({ code: "unknown-edge", message: `Constraint references unknown edge ${constraint.edgeId}.` });
    if (!Number.isFinite(constraint.penaltyMultiplier) || constraint.penaltyMultiplier < 1) issues.push({ code: "invalid-penalty", message: `Penalty for ${constraint.edgeId} must be finite and at least 1.` });
  }

  const validTerminalNodeIds = scenario.terminals.filter((terminal) => nodeIds.has(terminal.nodeId)).map((terminal) => terminal.nodeId);
  const blockedIds = new Set(scenario.edgeConstraints.filter((constraint) => constraint.blocked && edgeIds.has(constraint.edgeId)).map((constraint) => constraint.edgeId));
  const usableGraphEdges = graph.edges.filter((edge) => !blockedIds.has(edge.id));
  const sourceSinkConnectedOnGraph = terminalsConnected(graph, validTerminalNodeIds, graph.edges);
  const sourceSinkConnectedAfterConstraints = terminalsConnected(graph, validTerminalNodeIds, usableGraphEdges);
  if (sourceSinkConnectedOnGraph === false) issues.push({ code: "terminals-disconnected", message: "Source and sink are in different graph components." });
  else if (sourceSinkConnectedAfterConstraints === false) issues.push({ code: "constraints-disconnect-terminals", message: "Hard constraints disconnect source and sink." });

  const validation: ScenarioValidation = {
    valid: issues.length === 0,
    issues,
    sourceSinkConnectedOnGraph,
    sourceSinkConnectedAfterConstraints,
    activeEdgeCount: usableGraphEdges.length,
    blockedEdgeCount: blockedIds.size,
    penalizedEdgeCount: scenario.edgeConstraints.filter((constraint) => !constraint.blocked && constraint.penaltyMultiplier > 1 && edgeIds.has(constraint.edgeId)).length,
  };
  if (!validation.valid) return { network: null, validation };

  const constraints = new Map(scenario.edgeConstraints.map((constraint) => [constraint.edgeId, constraint]));
  const edges: PreparedEdge[] = usableGraphEdges.map((edge) => {
    const penaltyMultiplier = constraints.get(edge.id)?.penaltyMultiplier ?? 1;
    return { graphEdgeId: edge.id, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, lengthMeters: edge.lengthMeters, penaltyMultiplier, effectiveCost: edge.lengthMeters * penaltyMultiplier };
  });
  return {
    validation,
    network: { graphId: graph.id, scenarioId: scenario.id, nodes: graph.nodes, edges, terminals: scenario.terminals.map((terminal) => ({ ...terminal })), activeEdgeCount: edges.length, blockedEdgeCount: blockedIds.size, sourceSinkConnected: true },
  };
}

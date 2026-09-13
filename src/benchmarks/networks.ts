import type { PreparedEdge, PreparedNetwork } from "../scenario/types";

function prepared(id: string, nodeIds: string[], edges: PreparedEdge[]): PreparedNetwork {
  return { graphId: id, scenarioId: "benchmark", nodes: nodeIds.map((nodeId, index) => ({ id: nodeId, position: [index, 0] })), edges, terminals: [{ id: "source", role: "source", nodeId: nodeIds[0], magnitude: 1 }, { id: "sink", role: "sink", nodeId: nodeIds[nodeIds.length - 1], magnitude: 1 }], activeEdgeCount: edges.length, blockedEdgeCount: 0, sourceSinkConnected: true };
}

function edge(id: string, from: string, to: string): PreparedEdge {
  return { graphEdgeId: id, fromNodeId: from, toNodeId: to, lengthMeters: 1, penaltyMultiplier: 1, effectiveCost: 1 };
}

export function createChainNetwork(nodeCount: number): PreparedNetwork {
  const nodes = Array.from({ length: nodeCount }, (_, index) => `n-${index.toString().padStart(5, "0")}`);
  return prepared(`chain-${nodeCount}`, nodes, nodes.slice(0, -1).map((node, index) => edge(`e-${index}`, node, nodes[index + 1])));
}

export function createGridNetwork(rows: number, columns: number): PreparedNetwork {
  const nodes = Array.from({ length: rows * columns }, (_, index) => `n-${index.toString().padStart(5, "0")}`);
  const edges: PreparedEdge[] = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const index = row * columns + column;
    if (column + 1 < columns) edges.push(edge(`e-h-${row}-${column}`, nodes[index], nodes[index + 1]));
    if (row + 1 < rows) edges.push(edge(`e-v-${row}-${column}`, nodes[index], nodes[index + columns]));
  }
  return prepared(`grid-${rows}x${columns}`, nodes, edges);
}

export function createBranchingNetwork(levels: number): PreparedNetwork {
  const nodeCount = 2 ** levels - 1;
  const nodes = Array.from({ length: nodeCount }, (_, index) => `n-${index.toString().padStart(5, "0")}`);
  const edges = nodes.slice(1).map((node, index) => edge(`e-${index}`, nodes[Math.floor((index + 1 - 1) / 2)], node));
  return prepared(`branch-${levels}`, nodes, edges);
}

import type { GraphCleanupMetrics, GraphDiagnostics, GraphEdge, GraphNode } from "./types";

export function calculateGraphDiagnostics(nodes: readonly GraphNode[], edges: readonly GraphEdge[], cleanup: GraphCleanupMetrics): GraphDiagnostics {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)?.add(edge.fromNodeId);
  }

  const isolatedNodeCount = [...adjacency.values()].filter((neighbors) => neighbors.size === 0).length;
  const visited = new Set<string>();
  let connectedComponentCount = 0;
  let largestConnectedComponentNodeCount = 0;

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    connectedComponentCount += 1;
    let componentSize = 0;
    const pending = [node.id];
    visited.add(node.id);
    while (pending.length > 0) {
      const current = pending.pop()!;
      componentSize += 1;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    largestConnectedComponentNodeCount = Math.max(largestConnectedComponentNodeCount, componentSize);
  }

  const degrees = [...adjacency.values()].map((neighbors) => neighbors.size);
  const endpoints = nodes.filter((node) => adjacency.get(node.id)?.size === 1);
  let nearbyUnconnectedEndpointCount = 0;
  for (let first = 0; first < endpoints.length; first += 1) {
    for (let second = first + 1; second < endpoints.length; second += 1) {
      const a = endpoints[first]; const b = endpoints[second];
      if (a.topologyKind === "boundary" || b.topologyKind === "boundary") continue;
      const longitudeMeters = (a.position[0] - b.position[0]) * 111_320 * Math.cos(((a.position[1] + b.position[1]) * Math.PI) / 360);
      const latitudeMeters = (a.position[1] - b.position[1]) * 110_540;
      if (Math.hypot(longitudeMeters, latitudeMeters) <= 0.2) nearbyUnconnectedEndpointCount += 1;
    }
  }
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    isolatedNodeCount,
    connectedComponentCount,
    largestConnectedComponentNodeCount,
    degreeDistribution: {
      minimum: degrees.length ? Math.min(...degrees) : 0,
      maximum: degrees.length ? Math.max(...degrees) : 0,
      average: degrees.length ? degrees.reduce((sum, degree) => sum + degree, 0) / degrees.length : 0,
    },
    anchoredNodeCount: nodes.filter((node) => node.topologyKind === "source").length,
    syntheticOrGeometricNodeCount: nodes.filter((node) => node.topologyKind !== "source").length,
    degreeOneEndpointCount: endpoints.length,
    boundaryEndpointCount: endpoints.filter((node) => node.topologyKind === "boundary").length,
    nearbyUnconnectedEndpointCount,
    ...cleanup,
  };
}

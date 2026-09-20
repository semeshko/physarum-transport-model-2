import type { GISGeometry, GISPosition } from "../gis/types";
import type { PreparedEdge, PreparedNetwork, ScenarioTerminal, TerminalRole } from "../scenario/types";
import { geometryPolygons, relateSegmentToPolygons } from "../spatial-constraints/geometry";
import { createLocalProjection } from "./projection";
import type { DesignCandidateNetwork } from "./types";

/**
 * A demand marker occupies a fixed PHYSICAL radius, never a single mesh node.
 *
 * Task 18 Gate D measured a single-node source diverging logarithmically under
 * refinement (fitted slope 0.165 against the theoretical 1/2pi = 0.159), i.e.
 * it never converges. A fixed-radius support converges, so the radius is part
 * of the model, not a UI detail.
 */
export type DesignTerminal = {
  readonly id: string;
  readonly role: TerminalRole;
  readonly centre: GISPosition;
  readonly radiusMeters: number;
  readonly magnitude: number;
};

/** Design v0 treats buildings and water as impermeable. It does not create new bridges or tunnels. */
export type DesignBarrier = {
  readonly id: string;
  readonly kind: "building" | "water";
  readonly geometry: Extract<GISGeometry, { type: "Polygon" | "MultiPolygon" }>;
};

export type DesignTerminalResolution = {
  readonly terminalId: string;
  readonly nodeIds: readonly string[];
  readonly nearestDistanceMeters: number;
};

export type DesignAssemblyIssue = {
  readonly code: "empty-terminal-support" | "unbalanced-demand" | "no-usable-edges" | "terminals-disconnected" | "invalid-magnitude";
  readonly message: string;
};

export type DesignAssemblyDiagnostics = {
  readonly candidateEdgeCount: number;
  readonly blockedByBuildingCount: number;
  readonly blockedByWaterCount: number;
  readonly usableEdgeCount: number;
  readonly terminals: readonly DesignTerminalResolution[];
  readonly totalPositiveDemand: number;
  readonly totalNegativeDemand: number;
};

export type DesignAssembly = {
  readonly network: PreparedNetwork | null;
  readonly issues: readonly DesignAssemblyIssue[];
  readonly diagnostics: DesignAssemblyDiagnostics;
};

/** Barrier polygons are projected into the SAME local metric plane as the mesh;
 * lon/lat degrees are never used as the scientific geometry space. */
function projectBarrier(barrier: DesignBarrier, project: (position: GISPosition) => readonly [number, number]) {
  return geometryPolygons(barrier.geometry).map((polygon) => polygon.map((ring) => ring.map((point) => project(point) as GISPosition)));
}

function blockedBy(a: GISPosition, b: GISPosition, polygons: readonly (readonly (readonly GISPosition[])[])[]): boolean {
  const relation = relateSegmentToPolygons(a, b, polygons);
  return relation.relation === "inside" || relation.relation === "intersects";
}

export function assembleDesignNetwork(
  mesh: DesignCandidateNetwork,
  terminals: readonly DesignTerminal[],
  barriers: readonly DesignBarrier[] = [],
  scenarioId = "design-v0",
): DesignAssembly {
  const projection = createLocalProjection(mesh.area.origin);
  const metricById = new Map(mesh.nodes.map((node) => [node.id, node.metric]));
  const issues: DesignAssemblyIssue[] = [];

  const buildings = barriers.filter((b) => b.kind === "building").map((b) => projectBarrier(b, projection.project));
  const waters = barriers.filter((b) => b.kind === "water").map((b) => projectBarrier(b, projection.project));

  let blockedByBuildingCount = 0, blockedByWaterCount = 0;
  const usable: PreparedEdge[] = [];
  for (const edge of mesh.edges) {
    const a = metricById.get(edge.fromNodeId) as GISPosition, b = metricById.get(edge.toNodeId) as GISPosition;
    if (buildings.some((polygons) => blockedBy(a, b, polygons))) { blockedByBuildingCount += 1; continue; }
    if (waters.some((polygons) => blockedBy(a, b, polygons))) { blockedByWaterCount += 1; continue; }
    // Gate D: conductance = sigma * w_e / l_e, so the solver's effectiveCost carries l_e / w_e.
    usable.push({ graphEdgeId: edge.id, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, lengthMeters: edge.lengthMeters, penaltyMultiplier: 1, effectiveCost: edge.lengthMeters / edge.widthMeters });
  }

  const activeNodeIds = new Set(usable.flatMap((edge) => [edge.fromNodeId, edge.toNodeId]));
  const resolutions: DesignTerminalResolution[] = [];
  const scenarioTerminals: ScenarioTerminal[] = [];
  let totalPositiveDemand = 0, totalNegativeDemand = 0;

  for (const terminal of terminals) {
    if (!Number.isFinite(terminal.magnitude) || terminal.magnitude <= 0) {
      issues.push({ code: "invalid-magnitude", message: `Terminal ${terminal.id} must have a positive magnitude.` });
      continue;
    }
    const centre = projection.project(terminal.centre);
    let nearestDistanceMeters = Number.POSITIVE_INFINITY;
    const nodeIds: string[] = [];
    for (const node of mesh.nodes) {
      if (!activeNodeIds.has(node.id)) continue;
      const distance = Math.hypot(node.metric[0] - centre[0], node.metric[1] - centre[1]);
      nearestDistanceMeters = Math.min(nearestDistanceMeters, distance);
      if (distance <= terminal.radiusMeters) nodeIds.push(node.id);
    }
    resolutions.push({ terminalId: terminal.id, nodeIds, nearestDistanceMeters });
    if (!nodeIds.length) {
      issues.push({ code: "empty-terminal-support", message: `Terminal ${terminal.id} covers no reachable mesh node; nearest is ${nearestDistanceMeters.toFixed(1)} m away. Increase its radius or move it.` });
      continue;
    }
    const share = terminal.magnitude / nodeIds.length;
    if (terminal.role === "source") totalPositiveDemand += terminal.magnitude; else totalNegativeDemand += terminal.magnitude;
    for (const [index, nodeId] of nodeIds.entries()) scenarioTerminals.push({ id: `${terminal.id}-${index}`, role: terminal.role, nodeId, magnitude: share });
  }

  if (!usable.length) issues.push({ code: "no-usable-edges", message: "Every candidate edge is blocked by a barrier." });
  if (Math.abs(totalPositiveDemand - totalNegativeDemand) > 1e-9 * Math.max(1, totalPositiveDemand)) {
    issues.push({ code: "unbalanced-demand", message: `Total source demand (${totalPositiveDemand}) must equal total sink demand (${totalNegativeDemand}).` });
  }
  if (usable.length && scenarioTerminals.length && !terminalsConnected(usable, scenarioTerminals)) {
    issues.push({ code: "terminals-disconnected", message: "Sources and sinks are not connected through the unblocked candidate network." });
  }

  const diagnostics: DesignAssemblyDiagnostics = {
    candidateEdgeCount: mesh.edges.length,
    blockedByBuildingCount,
    blockedByWaterCount,
    usableEdgeCount: usable.length,
    terminals: resolutions,
    totalPositiveDemand,
    totalNegativeDemand,
  };

  if (issues.length) return { network: null, issues, diagnostics };

  const network: PreparedNetwork = {
    graphId: `design-${mesh.diagnostics.effectiveSpacingMeters.toFixed(3)}`,
    scenarioId,
    nodes: mesh.nodes.filter((node) => activeNodeIds.has(node.id)).map((node) => ({ id: node.id, position: node.position })),
    edges: usable,
    terminals: scenarioTerminals,
    activeEdgeCount: usable.length,
    blockedEdgeCount: mesh.edges.length - usable.length,
    sourceSinkConnected: true,
  };
  return { network, issues, diagnostics };
}

function terminalsConnected(edges: readonly PreparedEdge[], terminals: readonly ScenarioTerminal[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.fromNodeId)) adjacency.set(edge.fromNodeId, []);
    if (!adjacency.has(edge.toNodeId)) adjacency.set(edge.toNodeId, []);
    adjacency.get(edge.fromNodeId)!.push(edge.toNodeId);
    adjacency.get(edge.toNodeId)!.push(edge.fromNodeId);
  }
  const sources = terminals.filter((t) => t.role === "source").map((t) => t.nodeId);
  const sinks = new Set(terminals.filter((t) => t.role === "sink").map((t) => t.nodeId));
  if (!sources.length || !sinks.size) return false;
  const seen = new Set(sources);
  const stack = [...sources];
  while (stack.length) {
    for (const next of adjacency.get(stack.pop()!) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  }
  return [...sinks].every((sink) => seen.has(sink));
}

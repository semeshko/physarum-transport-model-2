import type { GISDataset, GISFeature, GISPosition, GISVertexAnchor } from "../gis/types";
import { calculateGraphDiagnostics } from "./diagnostics";
import { haversineMeters } from "./distance";
import type { GraphBuildOptions, GraphCleanupMetrics, GraphEdge, GraphEdgeProvenance, GraphNode, TransportGraph } from "./types";
import { areTopologicallyCompatible } from "./vertical-level";

export const DEFAULT_SNAP_TOLERANCE_DEGREES = 1e-6;
type Split = { parameter: number; position: GISPosition; anchor?: GISVertexAnchor };
type Segment = { provenance: GraphEdgeProvenance; start: GISPosition; end: GISPosition; startAnchor?: GISVertexAnchor; endAnchor?: GISVertexAnchor; authoritative: boolean; stableKey: string; splits: Split[] };
type IntersectionResult = { points: GISPosition[]; collinearOverlap: boolean };
type MutableCleanup = { -readonly [Key in keyof GraphCleanupMetrics]: GraphCleanupMetrics[Key] };

function emptyCleanup(): MutableCleanup {
  return { duplicateEdgesMerged: 0, selfLoopsRejected: 0, zeroLengthEdgesRejected: 0, gradeSeparatedCrossingsIgnored: 0, collinearOverlapsResolved: 0, invalidSegmentsRejected: 0, transportSegmentCount: 0, candidateSegmentPairCount: 0, geometricIntersectionTestCount: 0, geometricIntersectionCount: 0, missingExpectedTopologyFeatureCount: 0, conflictingAnchorCoordinateCount: 0 };
}
function distanceDegrees(a: GISPosition, b: GISPosition): number { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function parameterOnSegment(point: GISPosition, segment: Segment): number {
  const dx = segment.end[0] - segment.start[0]; const dy = segment.end[1] - segment.start[1]; const length = dx ** 2 + dy ** 2;
  return length === 0 ? 0 : ((point[0] - segment.start[0]) * dx + (point[1] - segment.start[1]) * dy) / length;
}
function pointOnSegment(point: GISPosition, segment: Segment, tolerance: number): boolean {
  const parameter = parameterOnSegment(point, segment); if (parameter < -tolerance || parameter > 1 + tolerance) return false;
  return distanceDegrees(point, [segment.start[0] + parameter * (segment.end[0] - segment.start[0]), segment.start[1] + parameter * (segment.end[1] - segment.start[1])]) <= tolerance;
}
function isEndpoint(point: GISPosition, segment: Segment, tolerance: number): boolean { return distanceDegrees(point, segment.start) <= tolerance || distanceDegrees(point, segment.end) <= tolerance; }
function cross(a: GISPosition, b: GISPosition): number { return a[0] * b[1] - a[1] * b[0]; }

function intersections(first: Segment, second: Segment, tolerance: number): IntersectionResult {
  const separated = Math.max(first.start[0], first.end[0]) + tolerance < Math.min(second.start[0], second.end[0]) || Math.max(second.start[0], second.end[0]) + tolerance < Math.min(first.start[0], first.end[0]) || Math.max(first.start[1], first.end[1]) + tolerance < Math.min(second.start[1], second.end[1]) || Math.max(second.start[1], second.end[1]) + tolerance < Math.min(first.start[1], first.end[1]);
  if (separated) return { points: [], collinearOverlap: false };
  const a: GISPosition = [first.end[0] - first.start[0], first.end[1] - first.start[1]]; const b: GISPosition = [second.end[0] - second.start[0], second.end[1] - second.start[1]]; const offset: GISPosition = [second.start[0] - first.start[0], second.start[1] - first.start[1]]; const denominator = cross(a, b);
  if (Math.abs(denominator) <= 1e-14) {
    if (![second.start, second.end, first.start, first.end].some((point) => pointOnSegment(point, first, tolerance) && pointOnSegment(point, second, tolerance))) return { points: [], collinearOverlap: false };
    const candidates = [first.start, first.end, second.start, second.end];
    const points = candidates.filter((point, index) => pointOnSegment(point, first, tolerance) && pointOnSegment(point, second, tolerance) && candidates.findIndex((other) => distanceDegrees(point, other) <= tolerance) === index);
    return { points, collinearOverlap: points.length >= 2 && distanceDegrees(points[0], points.at(-1)!) > tolerance };
  }
  const firstParameter = cross(offset, b) / denominator; const secondParameter = cross(offset, a) / denominator;
  if (firstParameter < -tolerance || firstParameter > 1 + tolerance || secondParameter < -tolerance || secondParameter > 1 + tolerance) return { points: [], collinearOverlap: false };
  const parameter = Math.max(0, Math.min(1, firstParameter)); return { points: [[first.start[0] + parameter * a[0], first.start[1] + parameter * a[1]]], collinearOverlap: false };
}
function lineParts(feature: GISFeature): readonly (readonly GISPosition[])[] { if (feature.geometry.type === "LineString") return [feature.geometry.coordinates]; if (feature.geometry.type === "MultiLineString") return feature.geometry.coordinates; return []; }

function createSegments(dataset: GISDataset, tolerance: number, cleanup: MutableCleanup): Segment[] {
  const segments: Segment[] = [];
  for (const feature of dataset.features) {
    if (feature.category !== "road" && feature.category !== "path") continue;
    const sourceCategory: "road" | "path" = feature.category;
    if (feature.lineTopology?.missingExpectedAnchors) cleanup.missingExpectedTopologyFeatureCount += 1;
    lineParts(feature).forEach((coordinates, partIndex) => {
      for (let segmentIndex = 0; segmentIndex < coordinates.length - 1; segmentIndex += 1) {
        const start = coordinates[segmentIndex]; const end = coordinates[segmentIndex + 1]; const separation = distanceDegrees(start, end);
        if (!Number.isFinite(separation)) { cleanup.invalidSegmentsRejected += 1; continue; } if (separation === 0) { cleanup.zeroLengthEdgesRejected += 1; continue; } if (separation <= tolerance) { cleanup.invalidSegmentsRejected += 1; continue; }
        const startAnchor = feature.lineTopology?.vertexAnchors[partIndex]?.[segmentIndex]; const endAnchor = feature.lineTopology?.vertexAnchors[partIndex]?.[segmentIndex + 1];
        const provenance: GraphEdgeProvenance = { sourceFeatureId: feature.id, sourceCategory, sourceProperties: feature.properties, sourcePartIndex: partIndex, sourceSegmentIndex: segmentIndex };
        segments.push({ provenance, start, end, startAnchor, endAnchor, authoritative: feature.lineTopology?.mode === "authoritative", stableKey: `${feature.id}|${partIndex}|${segmentIndex}|${startAnchor?.id ?? ""}|${endAnchor?.id ?? ""}`, splits: [{ parameter: 0, position: start, anchor: startAnchor }, { parameter: 1, position: end, anchor: endAnchor }] });
      }
    });
  }
  cleanup.transportSegmentCount = segments.length; return segments.sort((a, b) => a.stableKey.localeCompare(b.stableKey));
}
function splitAtIntersections(segments: Segment[], tolerance: number, cleanup: MutableCleanup): void {
  cleanup.candidateSegmentPairCount = segments.length * (segments.length - 1) / 2;
  for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
    const first = segments[i]; const second = segments[j]; if (first.authoritative || second.authoritative) continue;
    cleanup.geometricIntersectionTestCount += 1; const result = intersections(first, second, tolerance); if (!result.points.length) continue;
    if (!areTopologicallyCompatible(first.provenance.sourceProperties, second.provenance.sourceProperties)) { const endpoints = result.points.filter((point) => isEndpoint(point, first, tolerance) && isEndpoint(point, second, tolerance)); cleanup.gradeSeparatedCrossingsIgnored += result.points.length - endpoints.length; result.points = endpoints; }
    if (result.collinearOverlap && result.points.length >= 2) cleanup.collinearOverlapsResolved += 1; cleanup.geometricIntersectionCount += result.points.length;
    for (const position of result.points) { first.splits.push({ parameter: Math.max(0, Math.min(1, parameterOnSegment(position, first))), position }); second.splits.push({ parameter: Math.max(0, Math.min(1, parameterOnSegment(position, second))), position }); }
  }
}
function stableHash(value: string): string { let first = 2166136261; let second = 2246822519; for (let index = 0; index < value.length; index += 1) { first = Math.imul(first ^ value.charCodeAt(index), 16777619); second = Math.imul(second ^ value.charCodeAt(index), 3266489917); } return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`; }
function canonicalEdgeKey(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }

export function buildTransportGraph(dataset: GISDataset, options: GraphBuildOptions = {}): TransportGraph {
  const tolerance = options.snapToleranceDegrees ?? DEFAULT_SNAP_TOLERANCE_DEGREES; if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("snapToleranceDegrees must be a positive finite number.");
  const cleanup = emptyCleanup(); const segments = createSegments(dataset, tolerance, cleanup); splitAtIntersections(segments, tolerance, cleanup);
  const anchorPositions = new Map<string, { anchor: GISVertexAnchor; position: GISPosition }>();
  for (const segment of segments) for (const [anchor, position] of [[segment.startAnchor, segment.start], [segment.endAnchor, segment.end]] as const) {
    if (!anchor) continue; const existing = anchorPositions.get(anchor.id); if (!existing) { anchorPositions.set(anchor.id, { anchor, position: [...position] }); continue; }
    const separation = distanceDegrees(existing.position, position); if (separation > tolerance) throw new Error(`Topology anchor ${anchor.id} has conflicting coordinates beyond the snap tolerance.`); if (separation > 1e-12) cleanup.conflictingAnchorCoordinateCount += 1;
    if (position[0] < existing.position[0] || (position[0] === existing.position[0] && position[1] < existing.position[1])) existing.position = [...position];
  }
  const nodes: GraphNode[] = []; const anchoredNodes = new Map<string, GraphNode>(); const edges: GraphEdge[] = []; const edgesByPair = new Map<string, number>();
  function nodeFor(position: GISPosition, anchor?: GISVertexAnchor): GraphNode {
    if (anchor) { const existing = anchoredNodes.get(anchor.id); if (existing) return existing; const canonical = anchorPositions.get(anchor.id)?.position ?? position; const node: GraphNode = { id: `node-a-${stableHash(anchor.id)}`, position: [...canonical], topologyAnchorId: anchor.id, topologyKind: anchor.kind }; anchoredNodes.set(anchor.id, node); nodes.push(node); return node; }
    const existing = nodes.find((node) => !node.topologyAnchorId && distanceDegrees(node.position, position) <= tolerance); if (existing) return existing; const node: GraphNode = { id: `node-${nodes.filter((item) => !item.topologyAnchorId).length + 1}`, position: [...position] }; nodes.push(node); return node;
  }
  for (const segment of segments) {
    const ordered = segment.splits.sort((a, b) => a.parameter - b.parameter).filter((split, index, all) => index === 0 || distanceDegrees(split.position, all[index - 1].position) > tolerance);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index]; const end = ordered[index + 1]; const lengthMeters = haversineMeters(start.position, end.position); if (!Number.isFinite(lengthMeters)) { cleanup.invalidSegmentsRejected += 1; continue; } if (lengthMeters <= 0) { cleanup.zeroLengthEdgesRejected += 1; continue; }
      const from = nodeFor(start.position, start.anchor); const to = nodeFor(end.position, end.anchor); if (from.id === to.id) { cleanup.selfLoopsRejected += 1; continue; }
      const key = canonicalEdgeKey(from.id, to.id); const existingIndex = edgesByPair.get(key); const provenance = { ...segment.provenance, sourceProperties: { ...segment.provenance.sourceProperties } };
      if (existingIndex !== undefined) { const existing = edges[existingIndex]; edges[existingIndex] = { ...existing, provenance: [...existing.provenance, provenance] }; cleanup.duplicateEdgesMerged += 1; continue; }
      edgesByPair.set(key, edges.length); edges.push({ id: from.topologyAnchorId && to.topologyAnchorId ? `edge-a-${stableHash(key)}` : `edge-${edges.length + 1}`, fromNodeId: from.id, toNodeId: to.id, coordinates: [[...from.position], [...to.position]], lengthMeters, provenance: [provenance] });
    }
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id)); edges.sort((a, b) => a.id.localeCompare(b.id));
  return { id: `graph-${dataset.id}`, sourceDatasetId: dataset.id, snapToleranceDegrees: tolerance, nodes, edges, diagnostics: calculateGraphDiagnostics(nodes, edges, cleanup) };
}

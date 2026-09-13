import type { GISDataset, GISFeature, GISPosition } from "../gis/types";
import { calculateGraphDiagnostics } from "./diagnostics";
import { haversineMeters } from "./distance";
import type { GraphBuildOptions, GraphCleanupMetrics, GraphEdge, GraphEdgeProvenance, GraphNode, TransportGraph } from "./types";
import { areTopologicallyCompatible } from "./vertical-level";

export const DEFAULT_SNAP_TOLERANCE_DEGREES = 1e-6;

type TransportCategory = "road" | "path";
type Split = { parameter: number; position: GISPosition };
type Segment = {
  provenance: GraphEdgeProvenance;
  start: GISPosition;
  end: GISPosition;
  splits: Split[];
};
type IntersectionResult = { points: GISPosition[]; collinearOverlap: boolean };
type MutableCleanup = { -readonly [Key in keyof GraphCleanupMetrics]: GraphCleanupMetrics[Key] };

function emptyCleanup(): MutableCleanup {
  return { duplicateEdgesMerged: 0, selfLoopsRejected: 0, zeroLengthEdgesRejected: 0, gradeSeparatedCrossingsIgnored: 0, collinearOverlapsResolved: 0, invalidSegmentsRejected: 0 };
}

function distanceDegrees(a: GISPosition, b: GISPosition): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function parameterOnSegment(point: GISPosition, segment: Segment): number {
  const longitudeDelta = segment.end[0] - segment.start[0];
  const latitudeDelta = segment.end[1] - segment.start[1];
  const squaredLength = longitudeDelta ** 2 + latitudeDelta ** 2;
  return squaredLength === 0 ? 0 : ((point[0] - segment.start[0]) * longitudeDelta + (point[1] - segment.start[1]) * latitudeDelta) / squaredLength;
}

function pointOnSegment(point: GISPosition, segment: Segment, tolerance: number): boolean {
  const parameter = parameterOnSegment(point, segment);
  if (parameter < -tolerance || parameter > 1 + tolerance) return false;
  const projected: GISPosition = [segment.start[0] + parameter * (segment.end[0] - segment.start[0]), segment.start[1] + parameter * (segment.end[1] - segment.start[1])];
  return distanceDegrees(point, projected) <= tolerance;
}

function isEndpoint(point: GISPosition, segment: Segment, tolerance: number): boolean {
  return distanceDegrees(point, segment.start) <= tolerance || distanceDegrees(point, segment.end) <= tolerance;
}

function cross(a: GISPosition, b: GISPosition): number {
  return a[0] * b[1] - a[1] * b[0];
}

function intersections(first: Segment, second: Segment, tolerance: number): IntersectionResult {
  const separated =
    Math.max(first.start[0], first.end[0]) + tolerance < Math.min(second.start[0], second.end[0]) ||
    Math.max(second.start[0], second.end[0]) + tolerance < Math.min(first.start[0], first.end[0]) ||
    Math.max(first.start[1], first.end[1]) + tolerance < Math.min(second.start[1], second.end[1]) ||
    Math.max(second.start[1], second.end[1]) + tolerance < Math.min(first.start[1], first.end[1]);
  if (separated) return { points: [], collinearOverlap: false };

  const firstVector: GISPosition = [first.end[0] - first.start[0], first.end[1] - first.start[1]];
  const secondVector: GISPosition = [second.end[0] - second.start[0], second.end[1] - second.start[1]];
  const offset: GISPosition = [second.start[0] - first.start[0], second.start[1] - first.start[1]];
  const denominator = cross(firstVector, secondVector);

  if (Math.abs(denominator) <= 1e-14) {
    if (!pointOnSegment(second.start, first, tolerance) && !pointOnSegment(second.end, first, tolerance) && !pointOnSegment(first.start, second, tolerance) && !pointOnSegment(first.end, second, tolerance)) return { points: [], collinearOverlap: false };
    const candidates = [first.start, first.end, second.start, second.end];
    const points = candidates.filter((candidate, index) => pointOnSegment(candidate, first, tolerance) && pointOnSegment(candidate, second, tolerance) && candidates.findIndex((other) => distanceDegrees(candidate, other) <= tolerance) === index);
    return { points, collinearOverlap: points.length >= 2 && distanceDegrees(points[0], points[points.length - 1]) > tolerance };
  }

  const firstParameter = cross(offset, secondVector) / denominator;
  const secondParameter = cross(offset, firstVector) / denominator;
  if (firstParameter < -tolerance || firstParameter > 1 + tolerance || secondParameter < -tolerance || secondParameter > 1 + tolerance) return { points: [], collinearOverlap: false };
  const clamped = Math.max(0, Math.min(1, firstParameter));
  return { points: [[first.start[0] + clamped * firstVector[0], first.start[1] + clamped * firstVector[1]]], collinearOverlap: false };
}

function lineParts(feature: GISFeature): readonly (readonly GISPosition[])[] {
  if (feature.geometry.type === "LineString") return [feature.geometry.coordinates];
  if (feature.geometry.type === "MultiLineString") return feature.geometry.coordinates;
  return [];
}

function createSegments(dataset: GISDataset, tolerance: number, cleanup: MutableCleanup): Segment[] {
  const segments: Segment[] = [];
  for (const feature of dataset.features) {
    if (feature.category !== "road" && feature.category !== "path") continue;
    const sourceCategory = feature.category as TransportCategory;
    lineParts(feature).forEach((coordinates, sourcePartIndex) => {
      for (let sourceSegmentIndex = 0; sourceSegmentIndex < coordinates.length - 1; sourceSegmentIndex += 1) {
        const start = coordinates[sourceSegmentIndex];
        const end = coordinates[sourceSegmentIndex + 1];
        const separation = distanceDegrees(start, end);
        if (!Number.isFinite(separation)) { cleanup.invalidSegmentsRejected += 1; continue; }
        if (separation === 0) { cleanup.zeroLengthEdgesRejected += 1; continue; }
        if (separation <= tolerance) { cleanup.invalidSegmentsRejected += 1; continue; }
        segments.push({ provenance: { sourceFeatureId: feature.id, sourceCategory, sourceProperties: feature.properties, sourcePartIndex, sourceSegmentIndex }, start, end, splits: [{ parameter: 0, position: start }, { parameter: 1, position: end }] });
      }
    });
  }
  return segments;
}

function splitAtIntersections(segments: Segment[], tolerance: number, cleanup: MutableCleanup): void {
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const first = segments[firstIndex];
      const second = segments[secondIndex];
      const result = intersections(first, second, tolerance);
      if (result.points.length === 0) continue;
      if (!areTopologicallyCompatible(first.provenance.sourceProperties, second.provenance.sourceProperties)) {
        const sharedEndpoints = result.points.filter((point) => isEndpoint(point, first, tolerance) && isEndpoint(point, second, tolerance));
        cleanup.gradeSeparatedCrossingsIgnored += result.points.length - sharedEndpoints.length;
        result.points = sharedEndpoints;
      }
      if (result.collinearOverlap && result.points.length >= 2) cleanup.collinearOverlapsResolved += 1;
      for (const position of result.points) {
        first.splits.push({ parameter: Math.max(0, Math.min(1, parameterOnSegment(position, first))), position });
        second.splits.push({ parameter: Math.max(0, Math.min(1, parameterOnSegment(position, second))), position });
      }
    }
  }
}

function canonicalEdgeKey(firstNodeId: string, secondNodeId: string): string {
  return firstNodeId < secondNodeId ? `${firstNodeId}|${secondNodeId}` : `${secondNodeId}|${firstNodeId}`;
}

export function buildTransportGraph(dataset: GISDataset, options: GraphBuildOptions = {}): TransportGraph {
  const tolerance = options.snapToleranceDegrees ?? DEFAULT_SNAP_TOLERANCE_DEGREES;
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("snapToleranceDegrees must be a positive finite number.");
  const cleanup = emptyCleanup();
  const segments = createSegments(dataset, tolerance, cleanup);
  splitAtIntersections(segments, tolerance, cleanup);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgesByNodePair = new Map<string, number>();

  function nodeFor(position: GISPosition): GraphNode {
    const existing = nodes.find((node) => distanceDegrees(node.position, position) <= tolerance);
    if (existing) return existing;
    const node = { id: `node-${nodes.length + 1}`, position: [position[0], position[1]] as GISPosition };
    nodes.push(node);
    return node;
  }

  for (const segment of segments) {
    const ordered = segment.splits.sort((a, b) => a.parameter - b.parameter).filter((split, index, all) => index === 0 || distanceDegrees(split.position, all[index - 1].position) > tolerance);
    for (let splitIndex = 0; splitIndex < ordered.length - 1; splitIndex += 1) {
      const start = ordered[splitIndex].position;
      const end = ordered[splitIndex + 1].position;
      const lengthMeters = haversineMeters(start, end);
      if (!Number.isFinite(lengthMeters)) { cleanup.invalidSegmentsRejected += 1; continue; }
      if (lengthMeters <= 0) { cleanup.zeroLengthEdgesRejected += 1; continue; }
      const from = nodeFor(start);
      const to = nodeFor(end);
      if (from.id === to.id) { cleanup.selfLoopsRejected += 1; continue; }
      const key = canonicalEdgeKey(from.id, to.id);
      const existingIndex = edgesByNodePair.get(key);
      if (existingIndex !== undefined) {
        const existing = edges[existingIndex];
        edges[existingIndex] = { ...existing, provenance: [...existing.provenance, { ...segment.provenance, sourceProperties: { ...segment.provenance.sourceProperties } }] };
        cleanup.duplicateEdgesMerged += 1;
        continue;
      }
      edgesByNodePair.set(key, edges.length);
      edges.push({ id: `edge-${edges.length + 1}`, fromNodeId: from.id, toNodeId: to.id, coordinates: [[...from.position], [...to.position]], lengthMeters, provenance: [{ ...segment.provenance, sourceProperties: { ...segment.provenance.sourceProperties } }] });
    }
  }

  return { id: `graph-${dataset.id}`, sourceDatasetId: dataset.id, snapToleranceDegrees: tolerance, nodes, edges, diagnostics: calculateGraphDiagnostics(nodes, edges, cleanup) };
}

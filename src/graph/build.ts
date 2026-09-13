import type { GISDataset, GISFeature, GISPosition, GISProperties } from "../gis/types";
import { calculateGraphDiagnostics } from "./diagnostics";
import { haversineMeters } from "./distance";
import type { GraphBuildOptions, GraphEdge, GraphNode, TransportGraph } from "./types";

export const DEFAULT_SNAP_TOLERANCE_DEGREES = 1e-6;

type TransportCategory = "road" | "path";
type Segment = {
  sourceFeatureId: string;
  sourceCategory: TransportCategory;
  sourceProperties: GISProperties;
  partIndex: number;
  segmentIndex: number;
  start: GISPosition;
  end: GISPosition;
  splits: Array<{ parameter: number; position: GISPosition }>;
};

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

function cross(a: GISPosition, b: GISPosition): number {
  return a[0] * b[1] - a[1] * b[0];
}

function intersectionPoints(first: Segment, second: Segment, tolerance: number): GISPosition[] {
  const separated =
    Math.max(first.start[0], first.end[0]) + tolerance < Math.min(second.start[0], second.end[0]) ||
    Math.max(second.start[0], second.end[0]) + tolerance < Math.min(first.start[0], first.end[0]) ||
    Math.max(first.start[1], first.end[1]) + tolerance < Math.min(second.start[1], second.end[1]) ||
    Math.max(second.start[1], second.end[1]) + tolerance < Math.min(first.start[1], first.end[1]);
  if (separated) return [];

  const firstVector: GISPosition = [first.end[0] - first.start[0], first.end[1] - first.start[1]];
  const secondVector: GISPosition = [second.end[0] - second.start[0], second.end[1] - second.start[1]];
  const offset: GISPosition = [second.start[0] - first.start[0], second.start[1] - first.start[1]];
  const denominator = cross(firstVector, secondVector);

  if (Math.abs(denominator) <= 1e-14) {
    const candidates = [first.start, first.end, second.start, second.end];
    return candidates.filter((candidate, index) => pointOnSegment(candidate, first, tolerance) && pointOnSegment(candidate, second, tolerance) && candidates.findIndex((other) => distanceDegrees(candidate, other) <= tolerance) === index);
  }

  const firstParameter = cross(offset, secondVector) / denominator;
  const secondParameter = cross(offset, firstVector) / denominator;
  if (firstParameter < -tolerance || firstParameter > 1 + tolerance || secondParameter < -tolerance || secondParameter > 1 + tolerance) return [];
  const clamped = Math.max(0, Math.min(1, firstParameter));
  return [[first.start[0] + clamped * firstVector[0], first.start[1] + clamped * firstVector[1]]];
}

function lineParts(feature: GISFeature): readonly (readonly GISPosition[])[] {
  if (feature.geometry.type === "LineString") return [feature.geometry.coordinates];
  if (feature.geometry.type === "MultiLineString") return feature.geometry.coordinates;
  return [];
}

function createSegments(dataset: GISDataset, tolerance: number): Segment[] {
  const segments: Segment[] = [];
  for (const feature of dataset.features) {
    if (feature.category !== "road" && feature.category !== "path") continue;
    lineParts(feature).forEach((coordinates, partIndex) => {
      for (let segmentIndex = 0; segmentIndex < coordinates.length - 1; segmentIndex += 1) {
        const start = coordinates[segmentIndex];
        const end = coordinates[segmentIndex + 1];
        if (distanceDegrees(start, end) <= tolerance) continue;
        segments.push({ sourceFeatureId: feature.id, sourceCategory: feature.category as TransportCategory, sourceProperties: feature.properties, partIndex, segmentIndex, start, end, splits: [{ parameter: 0, position: start }, { parameter: 1, position: end }] });
      }
    });
  }
  return segments;
}

function splitAtIntersections(segments: Segment[], tolerance: number): void {
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const first = segments[firstIndex];
      const second = segments[secondIndex];
      for (const position of intersectionPoints(first, second, tolerance)) {
        first.splits.push({ parameter: Math.max(0, Math.min(1, parameterOnSegment(position, first))), position });
        second.splits.push({ parameter: Math.max(0, Math.min(1, parameterOnSegment(position, second))), position });
      }
    }
  }
}

export function buildTransportGraph(dataset: GISDataset, options: GraphBuildOptions = {}): TransportGraph {
  const tolerance = options.snapToleranceDegrees ?? DEFAULT_SNAP_TOLERANCE_DEGREES;
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("snapToleranceDegrees must be a positive finite number.");
  const segments = createSegments(dataset, tolerance);
  splitAtIntersections(segments, tolerance);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

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
      if (lengthMeters <= 0) continue;
      const from = nodeFor(start);
      const to = nodeFor(end);
      edges.push({ id: `edge-${edges.length + 1}`, fromNodeId: from.id, toNodeId: to.id, coordinates: [[...from.position], [...to.position]], lengthMeters, sourceFeatureId: segment.sourceFeatureId, sourceCategory: segment.sourceCategory, sourceProperties: { ...segment.sourceProperties }, sourcePartIndex: segment.partIndex, sourceSegmentIndex: segment.segmentIndex });
    }
  }

  return { id: `graph-${dataset.id}`, sourceDatasetId: dataset.id, snapToleranceDegrees: tolerance, nodes, edges, diagnostics: calculateGraphDiagnostics(nodes, edges) };
}

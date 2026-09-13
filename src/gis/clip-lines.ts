import { calculateBounds } from "./bounds";
import { GIS_CATEGORIES, type GISBounds, type GISCategory, type GISDataset, type GISFeature, type GISGeometryType, type GISPosition, type GISVertexAnchor } from "./types";

type ClippedSegment = { start: GISPosition; end: GISPosition; startParameter: number; endParameter: number };
type AnchoredPoint = { position: GISPosition; anchor: GISVertexAnchor };

function clipSegment(start: GISPosition, end: GISPosition, bounds: GISBounds): ClippedSegment | null {
  const [west, south, east, north] = bounds;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const p = [-dx, dx, -dy, dy];
  const q = [start[0] - west, east - start[0], start[1] - south, north - start[1]];
  let startParameter = 0;
  let endParameter = 1;
  for (let index = 0; index < 4; index += 1) {
    if (p[index] === 0) { if (q[index] < 0) return null; continue; }
    const ratio = q[index] / p[index];
    if (p[index] < 0) startParameter = Math.max(startParameter, ratio); else endParameter = Math.min(endParameter, ratio);
    if (startParameter > endParameter) return null;
  }
  return {
    start: [start[0] + startParameter * dx, start[1] + startParameter * dy],
    end: [start[0] + endParameter * dx, start[1] + endParameter * dy],
    startParameter,
    endParameter,
  };
}

function samePosition(first: GISPosition, second: GISPosition): boolean { return Math.abs(first[0] - second[0]) < 1e-12 && Math.abs(first[1] - second[1]) < 1e-12; }
function coordinateKey(position: GISPosition): string { return `${position[0].toFixed(12)},${position[1].toFixed(12)}`; }

function boundaryAnchor(featureId: string, bounds: GISBounds, position: GISPosition): GISVertexAnchor {
  return { id: `clip-boundary:${featureId}:${bounds.join(",")}:${coordinateKey(position)}`, kind: "boundary" };
}

function clipFeature(feature: GISFeature, bounds: GISBounds): GISFeature | null {
  if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") return feature;
  const sourceParts = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const topologyParts = feature.lineTopology?.vertexAnchors;
  const clippedParts: GISPosition[][] = [];
  const clippedTopologyParts: GISVertexAnchor[][] = [];

  sourceParts.forEach((coordinates, partIndex) => {
    let current: AnchoredPoint[] = [];
    const flush = () => {
      if (current.length >= 2) { clippedParts.push(current.map((point) => point.position)); clippedTopologyParts.push(current.map((point) => point.anchor)); }
      current = [];
    };
    for (let segmentIndex = 0; segmentIndex < coordinates.length - 1; segmentIndex += 1) {
      const clipped = clipSegment(coordinates[segmentIndex], coordinates[segmentIndex + 1], bounds);
      if (!clipped) { flush(); continue; }
      const originalAnchors = topologyParts?.[partIndex];
      const startAnchor = clipped.startParameter <= 1e-12 && originalAnchors ? originalAnchors[segmentIndex] : boundaryAnchor(feature.id, bounds, clipped.start);
      const endAnchor = clipped.endParameter >= 1 - 1e-12 && originalAnchors ? originalAnchors[segmentIndex + 1] : boundaryAnchor(feature.id, bounds, clipped.end);
      if (!feature.lineTopology) {
        const genericStart = { id: `clip-generic:${feature.id}:${partIndex}:${segmentIndex}:start:${coordinateKey(clipped.start)}`, kind: "fallback" as const };
        const genericEnd = { id: `clip-generic:${feature.id}:${partIndex}:${segmentIndex}:end:${coordinateKey(clipped.end)}`, kind: "fallback" as const };
        current = current.length && samePosition(current[current.length - 1].position, clipped.start) ? [...current, { position: clipped.end, anchor: genericEnd }] : [{ position: clipped.start, anchor: genericStart }, { position: clipped.end, anchor: genericEnd }];
      } else if (current.length && samePosition(current[current.length - 1].position, clipped.start) && current[current.length - 1].anchor.id === startAnchor.id) current.push({ position: clipped.end, anchor: endAnchor });
      else { flush(); current = [{ position: clipped.start, anchor: startAnchor }, { position: clipped.end, anchor: endAnchor }]; }
    }
    flush();
  });
  if (clippedParts.length === 0) return null;
  const geometry = clippedParts.length === 1 ? { type: "LineString" as const, coordinates: clippedParts[0] } : { type: "MultiLineString" as const, coordinates: clippedParts };
  const lineTopology = feature.lineTopology ? { ...feature.lineTopology, vertexAnchors: clippedTopologyParts } : undefined;
  return { ...feature, geometry, ...(lineTopology ? { lineTopology } : {}) };
}

function categoryCounts(features: readonly GISFeature[]): Readonly<Record<GISCategory, number>> {
  const counts = Object.fromEntries(GIS_CATEGORIES.map((category) => [category, 0])) as Record<GISCategory, number>;
  for (const feature of features) counts[feature.category] += 1;
  return counts;
}

export function clipLineDatasetToBounds(dataset: GISDataset, bounds: GISBounds): GISDataset {
  const features = dataset.features.map((feature) => clipFeature(feature, bounds)).filter((feature): feature is GISFeature => feature !== null);
  const geometryTypes = [...new Set(features.map((feature) => feature.geometry.type))] as GISGeometryType[];
  return { ...dataset, id: `${dataset.id}-clip-${bounds.join("_")}`, features, featureCount: features.length, bounds: calculateBounds(features), geometryTypes, categoryCounts: categoryCounts(features) };
}

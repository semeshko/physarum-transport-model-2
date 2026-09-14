import type { OverpassElement } from "./types";

export type OSMGeoJSONResult = {
  readonly featureCollection: { readonly type: "FeatureCollection"; readonly features: readonly unknown[] };
  readonly wayCount: number;
  readonly skippedElementCount: number;
  readonly warnings: readonly string[];
  readonly timestamp: string | null;
  readonly missingTopologyWayCount: number;
};

export type OSMUrbanContextResult = Omit<OSMGeoJSONResult, "missingTopologyWayCount"> & { readonly polygonCount: number; readonly lineCount: number };

export class OSMAdapterError extends Error {
  constructor(message: string) { super(message); this.name = "OSMAdapterError"; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeWay(element: OverpassElement): { feature: unknown; missingTopology: boolean } | null {
  if (element.type !== "way" || !Number.isSafeInteger(element.id) || Number(element.id) <= 0) return null;
  const tags = record(element.tags);
  if (!tags || typeof tags.highway !== "string" || !Array.isArray(element.geometry) || element.geometry.length < 2) return null;
  const coordinates: [number, number][] = [];
  for (const value of element.geometry) {
    const point = record(value);
    if (!point || typeof point.lat !== "number" || typeof point.lon !== "number" || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) return null;
    coordinates.push([point.lon, point.lat]);
  }
  const rawNodes = element.nodes;
  const hasValidNodes = Array.isArray(rawNodes) && rawNodes.length === coordinates.length && rawNodes.every((nodeId) => Number.isSafeInteger(nodeId) && Number(nodeId) > 0);
  const vertexAnchors = coordinates.map((_coordinate, index) => ({ id: hasValidNodes ? `osm-node-${rawNodes[index]}` : `osm-way-${element.id}-vertex-${index}`, kind: hasValidNodes ? "source" : "fallback" }));
  return { feature: {
    type: "Feature",
    id: `osm-way-${element.id}`,
    properties: { ...tags, osm_type: "way", osm_id: Number(element.id) },
    geometry: { type: "LineString", coordinates },
    lineTopology: { mode: "authoritative", vertexAnchors: [vertexAnchors], missingExpectedAnchors: !hasValidNodes },
  }, missingTopology: !hasValidNodes };
}

export function overpassResponseToGeoJSON(value: unknown): OSMGeoJSONResult {
  const root = record(value);
  if (!root || !Array.isArray(root.elements)) throw new OSMAdapterError("The OSM service returned a malformed response without an elements array.");
  const features: unknown[] = [];
  let skippedElementCount = 0;
  let missingTopologyWayCount = 0;
  for (const rawElement of root.elements) {
    const element = record(rawElement) as OverpassElement | null;
    const normalized = element ? normalizeWay(element) : null;
    if (normalized) { features.push(normalized.feature); if (normalized.missingTopology) missingTopologyWayCount += 1; } else skippedElementCount += 1;
  }
  const timestampValue = record(root.osm3s)?.timestamp_osm_base;
  const timestamp = typeof timestampValue === "string" ? timestampValue : null;
  const warnings = skippedElementCount ? [`Skipped ${skippedElementCount} unsupported or malformed OSM element${skippedElementCount === 1 ? "" : "s"}.`] : [];
  if (missingTopologyWayCount) warnings.push(`${missingTopologyWayCount} OSM way${missingTopologyWayCount === 1 ? " is" : "s are"} missing valid ordered node anchors; isolated fallback anchors were used.`);
  return { featureCollection: { type: "FeatureCollection", features }, wayCount: features.length, skippedElementCount, warnings, timestamp, missingTopologyWayCount };
}

export function overpassUrbanContextToGeoJSON(value: unknown): OSMUrbanContextResult {
  const root = record(value);
  if (!root || !Array.isArray(root.elements)) throw new OSMAdapterError("The OSM service returned malformed urban context.");
  const features: unknown[] = []; let skippedElementCount = 0; let polygonCount = 0; let lineCount = 0;
  for (const rawElement of root.elements) {
    const element = record(rawElement) as OverpassElement | null; const tags = element ? record(element.tags) : null;
    if (!element || element.type !== "way" || !Number.isSafeInteger(element.id) || !tags || !Array.isArray(element.geometry) || element.geometry.length < 2) { skippedElementCount += 1; continue; }
    const coordinates: [number, number][] = []; let valid = true;
    for (const rawPoint of element.geometry) { const point = record(rawPoint); if (!point || typeof point.lat !== "number" || typeof point.lon !== "number") { valid = false; break; } coordinates.push([point.lon, point.lat]); }
    if (!valid) { skippedElementCount += 1; continue; }
    const closed = coordinates.length >= 4 && coordinates[0][0] === coordinates.at(-1)![0] && coordinates[0][1] === coordinates.at(-1)![1];
    const polygonTagged = Boolean(tags.building) || tags.natural === "water" || Boolean(tags.water) || tags.leisure === "park" || tags.natural === "wood" || Boolean(tags.landuse);
    const geometry = closed && polygonTagged ? { type: "Polygon", coordinates: [coordinates] } : { type: "LineString", coordinates };
    if (geometry.type === "Polygon") polygonCount += 1; else lineCount += 1;
    features.push({ type: "Feature", id: `osm-context-way-${element.id}`, properties: { ...tags, osm_type: "way", osm_id: Number(element.id) }, geometry });
  }
  const timestampValue = record(root.osm3s)?.timestamp_osm_base; const timestamp = typeof timestampValue === "string" ? timestampValue : null;
  const warnings = [skippedElementCount ? `Skipped ${skippedElementCount} malformed urban-context elements.` : "", "OSM relation multipolygons are not reconstructed in this MVP; only way geometries are imported."].filter(Boolean);
  return { featureCollection: { type: "FeatureCollection", features }, wayCount: features.length, polygonCount, lineCount, skippedElementCount, warnings, timestamp };
}

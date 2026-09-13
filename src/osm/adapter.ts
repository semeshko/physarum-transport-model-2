import type { OverpassElement } from "./types";

export type OSMGeoJSONResult = {
  readonly featureCollection: { readonly type: "FeatureCollection"; readonly features: readonly unknown[] };
  readonly wayCount: number;
  readonly skippedElementCount: number;
  readonly warnings: readonly string[];
  readonly timestamp: string | null;
};

export class OSMAdapterError extends Error {
  constructor(message: string) { super(message); this.name = "OSMAdapterError"; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeWay(element: OverpassElement): unknown | null {
  if (element.type !== "way" || !Number.isSafeInteger(element.id) || Number(element.id) <= 0) return null;
  const tags = record(element.tags);
  if (!tags || typeof tags.highway !== "string" || !Array.isArray(element.geometry) || element.geometry.length < 2) return null;
  const coordinates: [number, number][] = [];
  for (const value of element.geometry) {
    const point = record(value);
    if (!point || typeof point.lat !== "number" || typeof point.lon !== "number" || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) return null;
    coordinates.push([point.lon, point.lat]);
  }
  return {
    type: "Feature",
    id: `osm-way-${element.id}`,
    properties: { ...tags, osm_type: "way", osm_id: Number(element.id) },
    geometry: { type: "LineString", coordinates },
  };
}

export function overpassResponseToGeoJSON(value: unknown): OSMGeoJSONResult {
  const root = record(value);
  if (!root || !Array.isArray(root.elements)) throw new OSMAdapterError("The OSM service returned a malformed response without an elements array.");
  const features: unknown[] = [];
  let skippedElementCount = 0;
  for (const rawElement of root.elements) {
    const element = record(rawElement) as OverpassElement | null;
    const feature = element ? normalizeWay(element) : null;
    if (feature) features.push(feature); else skippedElementCount += 1;
  }
  const timestampValue = record(root.osm3s)?.timestamp_osm_base;
  const timestamp = typeof timestampValue === "string" ? timestampValue : null;
  const warnings = skippedElementCount ? [`Skipped ${skippedElementCount} unsupported or malformed OSM element${skippedElementCount === 1 ? "" : "s"}.`] : [];
  return { featureCollection: { type: "FeatureCollection", features }, wayCount: features.length, skippedElementCount, warnings, timestamp };
}

import { calculateBounds } from "./bounds";
import { classifyFeature } from "./classification";
import { GIS_CATEGORIES, GIS_CRS, type GISCategory, type GISDataset, type GISDatasetSource, type GISFeature, type GISGeometry, type GISPosition, type GISProperties } from "./types";

export class GISIngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GISIngestionError";
  }
}

type ImportOptions = { name: string; source: GISDatasetSource };

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GISIngestionError(message);
  return value as Record<string, unknown>;
}

function position(value: unknown, path: string): GISPosition {
  if (!Array.isArray(value) || value.length < 2) throw new GISIngestionError(`${path} must contain [longitude, latitude].`);
  const [longitude, latitude] = value;
  if (typeof longitude !== "number" || typeof latitude !== "number" || !Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new GISIngestionError(`${path} coordinates must be finite numbers.`);
  if (longitude < -180 || longitude > 180) throw new GISIngestionError(`${path} longitude must be between -180 and 180.`);
  if (latitude < -90 || latitude > 90) throw new GISIngestionError(`${path} latitude must be between -90 and 90.`);
  return [longitude, latitude];
}

function line(value: unknown, path: string): readonly GISPosition[] {
  if (!Array.isArray(value) || value.length < 2) throw new GISIngestionError(`${path} must contain at least two positions.`);
  return value.map((item, index) => position(item, `${path}[${index}]`));
}

function ring(value: unknown, path: string): readonly GISPosition[] {
  if (!Array.isArray(value) || value.length < 4) throw new GISIngestionError(`${path} must contain at least four positions.`);
  const result = value.map((item, index) => position(item, `${path}[${index}]`));
  const first = result[0];
  const last = result[result.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) throw new GISIngestionError(`${path} must be a closed polygon ring.`);
  return result;
}

function geometry(value: unknown, path: string): GISGeometry {
  const input = object(value, `${path} must be a GeoJSON geometry.`);
  const coordinates = input.coordinates;
  switch (input.type) {
    case "Point": return { type: "Point", coordinates: position(coordinates, `${path}.coordinates`) };
    case "LineString": return { type: "LineString", coordinates: line(coordinates, `${path}.coordinates`) };
    case "MultiLineString": {
      if (!Array.isArray(coordinates) || coordinates.length === 0) throw new GISIngestionError(`${path}.coordinates must contain lines.`);
      return { type: "MultiLineString", coordinates: coordinates.map((item, index) => line(item, `${path}.coordinates[${index}]`)) };
    }
    case "Polygon": {
      if (!Array.isArray(coordinates) || coordinates.length === 0) throw new GISIngestionError(`${path}.coordinates must contain rings.`);
      return { type: "Polygon", coordinates: coordinates.map((item, index) => ring(item, `${path}.coordinates[${index}]`)) };
    }
    case "MultiPolygon": {
      if (!Array.isArray(coordinates) || coordinates.length === 0) throw new GISIngestionError(`${path}.coordinates must contain polygons.`);
      return { type: "MultiPolygon", coordinates: coordinates.map((polygonValue, polygonIndex) => {
        if (!Array.isArray(polygonValue) || polygonValue.length === 0) throw new GISIngestionError(`${path}.coordinates[${polygonIndex}] must contain rings.`);
        return polygonValue.map((item, ringIndex) => ring(item, `${path}.coordinates[${polygonIndex}][${ringIndex}]`));
      }) };
    }
    case "GeometryCollection": throw new GISIngestionError(`${path}: GeometryCollection is not supported yet.`);
    default: throw new GISIngestionError(`${path}: unsupported geometry type "${String(input.type)}".`);
  }
}

function properties(value: unknown, path: string): GISProperties {
  if (value === null || value === undefined) return {};
  return { ...object(value, `${path} must be an object or null.`) };
}

function hash(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

function normalizeFeature(value: unknown, index: number): GISFeature {
  const input = object(value, `features[${index}] must be a GeoJSON Feature.`);
  if (input.type !== "Feature") throw new GISIngestionError(`features[${index}].type must be "Feature".`);
  if (!input.geometry) throw new GISIngestionError(`features[${index}].geometry is required.`);
  const normalizedGeometry = geometry(input.geometry, `features[${index}].geometry`);
  const normalizedProperties = properties(input.properties, `features[${index}].properties`);
  if (input.id !== undefined && typeof input.id !== "string" && typeof input.id !== "number") throw new GISIngestionError(`features[${index}].id must be a string or number.`);
  const id = input.id === undefined ? `generated-${hash(JSON.stringify([index, normalizedGeometry, normalizedProperties]))}` : String(input.id);
  return { id, geometry: normalizedGeometry, properties: normalizedProperties, category: classifyFeature(normalizedProperties) };
}

function emptyCategoryCounts(): Record<GISCategory, number> {
  return Object.fromEntries(GIS_CATEGORIES.map((category) => [category, 0])) as Record<GISCategory, number>;
}

export function ingestGeoJSON(value: unknown, options: ImportOptions): GISDataset {
  const root = object(value, "GeoJSON root must be an object.");
  const warnings: string[] = [];
  let rawFeatures: unknown[];
  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features)) throw new GISIngestionError("FeatureCollection.features must be an array.");
    rawFeatures = root.features;
  } else if (root.type === "Feature") {
    rawFeatures = [root];
    warnings.push("A single Feature was normalized to a FeatureCollection dataset.");
  } else {
    throw new GISIngestionError("GeoJSON root must be a Feature or FeatureCollection.");
  }

  const features = rawFeatures.map(normalizeFeature);
  const ids = new Set<string>();
  for (const feature of features) {
    if (ids.has(feature.id)) throw new GISIngestionError(`Feature ID "${feature.id}" is duplicated.`);
    ids.add(feature.id);
  }
  const categoryCounts = emptyCategoryCounts();
  for (const feature of features) categoryCounts[feature.category] += 1;
  const geometryTypes = [...new Set(features.map((feature) => feature.geometry.type))];
  return { id: `dataset-${hash(`${options.source.kind}:${options.name}`)}`, name: options.name, source: { ...options.source }, crs: GIS_CRS, featureCount: features.length, features, bounds: calculateBounds(features), geometryTypes, categoryCounts, warnings };
}

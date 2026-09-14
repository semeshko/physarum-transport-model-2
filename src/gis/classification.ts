import type { GISCategory, GISProperties } from "./types";

const PATH_HIGHWAYS = new Set([
  "bridleway",
  "cycleway",
  "footway",
  "path",
  "pedestrian",
  "steps",
]);
const GREEN_LANDUSES = new Set(["forest", "grass", "meadow", "recreation_ground", "village_green"]);

function property(properties: GISProperties, key: string): string | undefined {
  const value = properties[key];
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

export function classifyFeature(properties: GISProperties): GISCategory {
  const highway = property(properties, "highway");
  if (highway) return PATH_HIGHWAYS.has(highway) ? "path" : "road";
  const declaredCategory = property(properties, "category") ?? property(properties, "kind");
  if (declaredCategory === "road" || declaredCategory === "path") return declaredCategory;
  if (property(properties, "building")) return "building";
  if (property(properties, "waterway") || property(properties, "natural") === "water") return "water";
  if (property(properties, "railway")) return "railway";
  if (property(properties, "leisure") === "park" || GREEN_LANDUSES.has(property(properties, "landuse") ?? "")) return "green";
  return "unknown";
}

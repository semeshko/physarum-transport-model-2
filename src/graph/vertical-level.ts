import type { GISProperties } from "../gis/types";

function numericProperty(properties: GISProperties, key: string): number | undefined {
  const value = properties[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isTruthyTag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return !["", "0", "false", "no"].includes(value.trim().toLowerCase());
}

export function topologyLevel(properties: GISProperties): number {
  const layer = numericProperty(properties, "layer");
  if (layer !== undefined) return layer;
  const level = numericProperty(properties, "level");
  if (level !== undefined) return level;
  if (isTruthyTag(properties.bridge)) return 1;
  if (isTruthyTag(properties.tunnel)) return -1;
  return 0;
}

export function areTopologicallyCompatible(first: GISProperties, second: GISProperties): boolean {
  return topologyLevel(first) === topologyLevel(second);
}

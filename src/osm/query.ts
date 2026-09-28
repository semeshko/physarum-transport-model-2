import type { GISBounds } from "../gis/types";
import { OSM_AREA_LIMITS, validateOSMArea } from "./area";

/**
 * Pure OSM request vocabulary: query construction, error classification and
 * response validation. No transport. Both the browser client and the
 * server-side Overpass client import this, so neither pulls the other's
 * networking into its bundle.
 */

export class OSMRequestError extends Error {
  constructor(readonly code: "aborted" | "timeout" | "throttled" | "remote" | "network" | "empty" | "oversized", message: string) {
    super(message);
    this.name = "OSMRequestError";
  }
}

const INCLUDED_HIGHWAYS = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|track|footway|path|cycleway|bridleway|steps|road";

export function createOverpassQuery(bounds: GISBounds): string {
  validateOSMArea(bounds);
  const [west, south, east, north] = bounds;
  return `[out:json][timeout:20];way["highway"~"^(${INCLUDED_HIGHWAYS})$"]["area"!="yes"](${south},${west},${north},${east});out body geom;`;
}

export function createUrbanContextQuery(bounds: GISBounds): string {
  validateOSMArea(bounds);
  const [west, south, east, north] = bounds;
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:20];(way["building"](${bbox});way["natural"="water"](${bbox});way["water"](${bbox});way["waterway"](${bbox});way["leisure"="park"](${bbox});way["natural"="wood"](${bbox});way["landuse"~"^(forest|grass|meadow|recreation_ground|village_green)$"](${bbox}););out body geom;`;
}

/** Everything that can be said about a payload without knowing how it arrived. */
export function validateOverpassPayload(payload: unknown, emptyMessage: string): unknown {
  const root = payload !== null && typeof payload === "object" ? (payload as { elements?: unknown }) : null;
  if (!root || !Array.isArray(root.elements)) throw new OSMRequestError("remote", "The OSM service returned malformed data.");
  if (root.elements.length === 0) throw new OSMRequestError("empty", emptyMessage);
  if (root.elements.length > OSM_AREA_LIMITS.maximumWays) throw new OSMRequestError("oversized", `The area returned more than ${OSM_AREA_LIMITS.maximumWays.toLocaleString()} ways. Select a smaller area.`);
  return payload;
}

/** Maps an upstream HTTP status onto an error the operator can act on. */
export function classifyOverpassStatus(status: number): OSMRequestError {
  if (status === 429) return new OSMRequestError("throttled", "The OSM service is busy or rate-limiting requests. Wait a moment and try again.");
  if (status === 504) return new OSMRequestError("timeout", "The OSM service could not finish this area in time. Select a smaller area and retry.");
  if (status === 406) return new OSMRequestError("remote", "The OSM service refused the request as an unidentified client. This is a server configuration problem, not an area problem.");
  return new OSMRequestError("remote", `The OSM service rejected the request (${status}). Try again later or select a smaller area.`);
}

export const OSM_QUERY_KINDS = ["transport", "context"] as const;
export type OSMQueryKind = (typeof OSM_QUERY_KINDS)[number];

export const OSM_EMPTY_MESSAGES: Readonly<Record<OSMQueryKind, string>> = {
  transport: "No supported OSM roads or paths were found in the selected area.",
  context: "No supported OSM urban context was found in the selected area.",
};

export function createQuery(kind: OSMQueryKind, bounds: GISBounds): string {
  return kind === "transport" ? createOverpassQuery(bounds) : createUrbanContextQuery(bounds);
}

export function parseBoundsParameter(raw: string | null): GISBounds {
  const parts = (raw ?? "").split(",").map((value) => Number.parseFloat(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    throw new OSMRequestError("remote", "bbox must be four finite numbers: west,south,east,north.");
  }
  return [parts[0], parts[1], parts[2], parts[3]] as GISBounds;
}

import type { GISBounds } from "../gis/types";
import { OSM_AREA_LIMITS, validateOSMArea } from "./area";

export const OVERPASS_ENDPOINTS = ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"] as const;
export const OSM_REQUEST_TIMEOUT_MILLISECONDS = 25_000;
const INCLUDED_HIGHWAYS = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|track|footway|path|cycleway|bridleway|steps|road";

export class OSMRequestError extends Error {
  constructor(readonly code: "aborted" | "timeout" | "throttled" | "remote" | "network" | "empty" | "oversized", message: string) { super(message); this.name = "OSMRequestError"; }
}

export function createOverpassQuery(bounds: GISBounds): string {
  validateOSMArea(bounds);
  const [west, south, east, north] = bounds;
  return `[out:json][timeout:20];way["highway"~"^(${INCLUDED_HIGHWAYS})$"]["area"!="yes"](${south},${west},${north},${east});out body geom;`;
}

type RequestOptions = { readonly signal?: AbortSignal; readonly fetchImplementation?: typeof fetch; readonly timeoutMilliseconds?: number };

export async function fetchOSMTransport(bounds: GISBounds, options: RequestOptions = {}): Promise<unknown> {
  const query = createOverpassQuery(bounds);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMilliseconds ?? OSM_REQUEST_TIMEOUT_MILLISECONDS);
  try {
    let lastFailure: OSMRequestError | null = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await (options.fetchImplementation ?? fetch)(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: new URLSearchParams({ data: query }), signal: controller.signal });
        if (!response.ok) {
          if (response.status === 429) throw new OSMRequestError("throttled", "The OSM service is busy or rate-limiting requests. Wait a moment and try again.");
          if (response.status === 504) throw new OSMRequestError("timeout", "The OSM service could not finish this area in time. Select a smaller area and retry.");
          throw new OSMRequestError("remote", `The OSM service rejected the request (${response.status}). Try again later or select a smaller area.`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("json")) throw new OSMRequestError("remote", "The OSM service returned an unexpected response format.");
        const payload: unknown = await response.json();
        const root = payload !== null && typeof payload === "object" ? payload as { elements?: unknown } : null;
        if (!root || !Array.isArray(root.elements)) throw new OSMRequestError("remote", "The OSM service returned malformed data.");
        if (root.elements.length === 0) throw new OSMRequestError("empty", "No supported OSM roads or paths were found in the selected area.");
        if (root.elements.length > OSM_AREA_LIMITS.maximumWays) throw new OSMRequestError("oversized", `The area returned more than ${OSM_AREA_LIMITS.maximumWays.toLocaleString()} ways. Select a smaller area.`);
        return payload;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (error instanceof OSMRequestError && (error.code === "empty" || error.code === "oversized")) throw error;
        lastFailure = error instanceof OSMRequestError ? error : new OSMRequestError("network", "Could not reach the OSM service. Check your connection and try again.");
      }
    }
    throw lastFailure ?? new OSMRequestError("network", "Could not reach an OSM service endpoint.");
  } catch (error) {
    if (error instanceof OSMRequestError) throw error;
    if (controller.signal.aborted) {
      if (timedOut) throw new OSMRequestError("timeout", "The OSM request timed out. Select a smaller area or try again.");
      throw new OSMRequestError("aborted", "The previous OSM request was cancelled.");
    }
    throw new OSMRequestError("network", "Could not reach the OSM service. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

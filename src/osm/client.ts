import type { GISBounds } from "../gis/types";
import { OSMRequestError, validateOverpassPayload, OSM_EMPTY_MESSAGES, type OSMQueryKind } from "./query";
import { validateOSMArea } from "./area";
import type { OSMAcquisition } from "./types";

export { OSMRequestError, createOverpassQuery, createUrbanContextQuery } from "./query";

/**
 * Browser-side OSM client.
 *
 * It talks to this application's own `/api/osm` route, never to Overpass.
 * A browser cannot set `User-Agent` — it is a forbidden header name — so a
 * request made from page JavaScript arrives at an OSM community endpoint as an
 * unidentified browser and is answered with HTTP 406. The identifying request
 * has to be made by the server; see `src/osm/server-client.ts`.
 */
// Allow the server's three sequential 25-second provider attempts plus response
// overhead. A 30-second deadline cancelled the request during mirror fallback.
export const OSM_REQUEST_TIMEOUT_MILLISECONDS = 80_000;

type RequestOptions = { readonly signal?: AbortSignal; readonly fetchImplementation?: typeof fetch; readonly timeoutMilliseconds?: number };

export async function fetchOSMAcquisition(kind: OSMQueryKind, bounds: GISBounds, options: RequestOptions = {}): Promise<OSMAcquisition> {
  // Refuse an oversized viewport here rather than spending a round trip and a
  // volunteer-run Overpass slot to be told the same thing.
  validateOSMArea(bounds);
  if (options.signal?.aborted) throw new OSMRequestError("aborted", "The previous OSM request was cancelled.");
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMilliseconds ?? OSM_REQUEST_TIMEOUT_MILLISECONDS);
  try {
    const url = `/api/osm?kind=${kind}&bbox=${bounds.map((value) => value.toFixed(6)).join(",")}`;
    const response = await (options.fetchImplementation ?? fetch)(url, { signal: controller.signal });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { error?: string; code?: OSMRequestError["code"] } | null;
      throw new OSMRequestError(detail?.code ?? "remote", detail?.error ?? `The OSM service rejected the request (${response.status}).`);
    }
    const payload = validateOverpassPayload(await response.json(), OSM_EMPTY_MESSAGES[kind], kind === "context");
    const timestamp = (payload as { osm3s?: { timestamp_osm_base?: unknown } }).osm3s?.timestamp_osm_base;
    const header = (name: string) => response.headers?.get(name) ?? null;
    return { payload, provenance: {
      endpoint: header("X-OSM-Endpoint"), fetchedAt: header("X-OSM-Fetched-At"),
      receivedAt: new Date().toISOString(),
      snapshotTimestamp: typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)) ? timestamp : null,
      cached: header("X-OSM-Cached") === null ? null : header("X-OSM-Cached") === "true",
    } };
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

export async function fetchOSMTransport(bounds: GISBounds, options: RequestOptions = {}): Promise<unknown> { return (await fetchOSMAcquisition("transport", bounds, options)).payload; }
export async function fetchOSMUrbanContext(bounds: GISBounds, options: RequestOptions = {}): Promise<unknown> { return (await fetchOSMAcquisition("context", bounds, options)).payload; }

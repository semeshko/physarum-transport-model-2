import type { GISBounds } from "../gis/types";
import { OSMRequestError, validateOverpassPayload, OSM_EMPTY_MESSAGES, type OSMQueryKind } from "./query";
import { validateOSMArea } from "./area";

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
export const OSM_REQUEST_TIMEOUT_MILLISECONDS = 30_000;

type RequestOptions = { readonly signal?: AbortSignal; readonly fetchImplementation?: typeof fetch; readonly timeoutMilliseconds?: number };

async function fetchViaServer(kind: OSMQueryKind, bounds: GISBounds, options: RequestOptions): Promise<unknown> {
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
    return validateOverpassPayload(await response.json(), OSM_EMPTY_MESSAGES[kind]);
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

export async function fetchOSMTransport(bounds: GISBounds, options: RequestOptions = {}): Promise<unknown> { return fetchViaServer("transport", bounds, options); }
export async function fetchOSMUrbanContext(bounds: GISBounds, options: RequestOptions = {}): Promise<unknown> { return fetchViaServer("context", bounds, options); }

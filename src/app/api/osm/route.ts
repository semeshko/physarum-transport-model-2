import { NextResponse } from "next/server";
import { OSM_QUERY_KINDS, OSMRequestError, parseBoundsParameter, type OSMQueryKind } from "@/osm/query";
import { requestOverpass } from "@/osm/server-client";

/**
 * Server-side OSM acquisition.
 *
 * The browser cannot talk to Overpass itself: `User-Agent` is a forbidden
 * header name, so page JavaScript cannot identify the application, and OSM
 * community endpoints answer an unidentified client with HTTP 406. This route
 * is the only place that speaks to a provider; the client sees a bbox in and
 * an Overpass payload out, with no provider mechanics leaking into the UI.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Readonly<Record<OSMRequestError["code"], number>> = {
  aborted: 499, timeout: 504, throttled: 429, remote: 502, network: 502, empty: 404, oversized: 413,
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("kind") ?? "transport";
  if (!OSM_QUERY_KINDS.includes(requested as OSMQueryKind)) {
    return NextResponse.json({ error: `kind must be one of ${OSM_QUERY_KINDS.join(", ")}.`, code: "remote" }, { status: 400 });
  }
  try {
    const bounds = parseBoundsParameter(searchParams.get("bbox"));
    const result = await requestOverpass(requested as OSMQueryKind, bounds, { signal: request.signal });
    return NextResponse.json(result.payload, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-OSM-Endpoint": result.endpoint,
        "X-OSM-Elements": String(result.elementCount),
        "X-OSM-Elapsed-Ms": String(result.elapsedMilliseconds),
        "X-OSM-Cached": String(result.cached),
      },
    });
  } catch (error) {
    if (error instanceof OSMRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS[error.code] });
    }
    return NextResponse.json({ error: "Could not reach the OSM service.", code: "network" }, { status: 502 });
  }
}

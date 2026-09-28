import { clipLineDatasetToBounds } from "../gis/clip-lines";
import { ingestGeoJSON } from "../gis/ingest";
import type { GISBounds, GISDataAcquisition, GISDataset } from "../gis/types";
import { overpassResponseToGeoJSON, overpassUrbanContextToGeoJSON } from "./adapter";
import { formatOSMBounds } from "./area";
import { fetchOSMAcquisition } from "./client";
import { OSMRequestError } from "./query";
import type { OSMAcquisition, OSMImportSummary } from "./types";

export function snapshotWarning(provenance: GISDataAcquisition, now = Date.now()): string | null {
  if (!provenance.snapshotTimestamp) return "OSM snapshot date is unknown; currentness is not verified.";
  const ageDays = (now - Date.parse(provenance.snapshotTimestamp)) / 86_400_000;
  if (ageDays > 7) return `OSM snapshot is ${Math.floor(ageDays)} days old. Review its date before using this scenario.`;
  if (ageDays < -1) return "OSM snapshot date is in the future; check provider metadata.";
  return null;
}

export type OSMAreaImport = { readonly dataset: GISDataset; readonly summary: OSMImportSummary; readonly transport: OSMAcquisition };

/** Standard adapter only. Display configuration never enters the dataset. */
export async function loadOSMArea(bounds: GISBounds, options: {
  signal: AbortSignal;
  transport?: OSMAcquisition;
  fetchAcquisition?: typeof fetchOSMAcquisition;
}): Promise<OSMAreaImport> {
  const checkCancelled = () => { if (options.signal.aborted) throw new OSMRequestError("aborted", "The previous OSM request was cancelled."); };
  checkCancelled();
  const fetchData = options.fetchAcquisition ?? fetchOSMAcquisition;
  const started = performance.now();
  const [transport, context] = await Promise.all([
    options.transport ? Promise.resolve(options.transport) : fetchData("transport", bounds, { signal: options.signal }),
    fetchData("context", bounds, { signal: options.signal }).then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error: error instanceof Error ? error.message : "Urban context unavailable." }),
    ),
  ]);
  checkCancelled();
  const fetchMilliseconds = performance.now() - started;
  const adapterStarted = performance.now();
  const converted = overpassResponseToGeoJSON(transport.payload);
  if (!converted.wayCount) throw new OSMRequestError("empty", "No usable OSM transport ways were returned for this area.");
  const urban = context.value ? overpassUrbanContextToGeoJSON(context.value.payload) : null;
  const urbanStatus = !urban ? "unavailable" : urban.skippedElementCount ? "partial" : urban.wayCount ? "loaded" : "empty";
  const urbanContextWarning = context.error ?? (urbanStatus === "partial" ? "Some urban context geometries were rejected; spatial coverage is incomplete." : null);
  const provenanceWarnings = [snapshotWarning(transport.provenance), context.value ? snapshotWarning(context.value.provenance) : null].filter((item): item is string => item !== null);
  const boundsKey = formatOSMBounds(bounds);
  const ingested = ingestGeoJSON({ type: "FeatureCollection", features: [...converted.featureCollection.features, ...(urban?.featureCollection.features ?? [])] }, {
    name: `OSM transport${urban ? " + urban context" : " (context unavailable)"} · ${boundsKey}`,
    source: {
      kind: "osm", name: `${boundsKey}:${converted.timestamp ?? "unknown"}:${urban?.timestamp ?? "unavailable"}`,
      acquisitions: { transport: transport.provenance, ...(context.value ? { context: context.value.provenance } : {}) },
    },
  });
  const clipped = clipLineDatasetToBounds(ingested, bounds);
  const warnings = [...converted.warnings, ...(urban?.warnings ?? []), ...provenanceWarnings,
    ...(urbanContextWarning ? [`Urban context: ${urbanContextWarning} Missing objects are unknown, not absent.`] : []),
    "One-way restrictions are not enforced; Analyze currently uses an undirected graph."];
  // Version analytical input, not camera/style/provider-cache access times.
  const versionInput = JSON.stringify({
    features: [...clipped.features].sort((a, b) => a.id.localeCompare(b.id)),
    transportSnapshot: converted.timestamp, contextSnapshot: urban?.timestamp ?? null, urbanStatus,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(versionInput));
  const version = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  checkCancelled();
  return {
    transport,
    dataset: { ...clipped, id: `osm-${version}`, warnings: [...clipped.warnings, ...warnings] },
    summary: {
      bounds, wayCount: converted.wayCount, skippedElementCount: converted.skippedElementCount,
      missingTopologyWayCount: converted.missingTopologyWayCount,
      urbanFeatureCount: urban?.wayCount ?? 0, urbanPolygonCount: urban?.polygonCount ?? 0,
      urbanStatus, urbanContextWarning, transportProvenance: transport.provenance,
      contextProvenance: context.value?.provenance ?? null,
      fetchMilliseconds, adapterMilliseconds: performance.now() - adapterStarted, warnings,
    },
  };
}

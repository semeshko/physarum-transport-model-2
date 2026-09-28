import { describe, expect, it, vi } from "vitest";
import { buildTransportGraph } from "../graph/build";
import type { GISBounds } from "../gis/types";
import { loadOSMArea, snapshotWarning } from "./acquisition";
import { SMALL_OSM_RESPONSE_FIXTURE } from "./fixtures";
import { fetchOSMAcquisition } from "./client";
import type { OSMAcquisition } from "./types";

const bounds: GISBounds = [24.029, 49.839, 24.033, 49.842];
const acquisition = (payload: unknown): OSMAcquisition => ({ payload, provenance: {
  endpoint: "https://provider.example/api", fetchedAt: "2026-09-28T07:00:00Z", receivedAt: "2026-09-28T07:00:01Z", snapshotTimestamp: "2026-06-01T08:52:28Z", cached: false,
} });
const transport = acquisition(SMALL_OSM_RESPONSE_FIXTURE);
const empty = acquisition({ elements: [] });
const building = { type: "way", id: 999, tags: { building: "yes" }, geometry: [{ lon: 24.0301, lat: 49.8401 }, { lon: 24.0302, lat: 49.8401 }, { lon: 24.0302, lat: 49.8402 }, { lon: 24.0301, lat: 49.8401 }] };
const fetcher = (context: OSMAcquisition | Error) => vi.fn<typeof fetchOSMAcquisition>(async (kind) => {
  if (kind === "transport") return transport;
  if (context instanceof Error) throw context;
  return context;
});

describe("Analyze OSM acquisition", () => {
  it("distinguishes unavailable context from a successful empty response", async () => {
    const failed = await loadOSMArea(bounds, { signal: new AbortController().signal, fetchAcquisition: fetcher(new Error("Provider down")) });
    const vacant = await loadOSMArea(bounds, { signal: new AbortController().signal, fetchAcquisition: fetcher(empty) });
    expect(failed.summary.urbanStatus).toBe("unavailable");
    expect(failed.summary.contextProvenance).toBeNull();
    expect(failed.dataset.warnings.join(" ")).toContain("unknown, not absent");
    expect(vacant.summary.urbanStatus).toBe("empty");
    expect(vacant.summary.urbanContextWarning).toBeNull();
    expect(vacant.dataset.id).not.toBe(failed.dataset.id);
  });

  it("retries context using the same authoritative transport input", async () => {
    const fetchAcquisition = fetcher(acquisition({ elements: [building] }));
    const result = await loadOSMArea(bounds, { signal: new AbortController().signal, transport, fetchAcquisition });
    expect(fetchAcquisition).toHaveBeenCalledTimes(1);
    expect(fetchAcquisition.mock.calls[0][0]).toBe("context");
    expect(result.summary).toMatchObject({ urbanStatus: "loaded", missingTopologyWayCount: 0 });
    expect(result.dataset.categoryCounts.building).toBe(1);
    expect(result.dataset.source.acquisitions?.transport).toEqual(transport.provenance);
    const graph = buildTransportGraph(result.dataset);
    expect(graph.nodes.some((node) => node.topologyAnchorId?.startsWith("osm-node-"))).toBe(true);
  });

  it("marks rejected context geometry as partial rather than a successful absence", async () => {
    const result = await loadOSMArea(bounds, { signal: new AbortController().signal, fetchAcquisition: fetcher(acquisition({ elements: [building, { ...building, id: 1000, geometry: [{ lon: NaN, lat: 0 }, { lon: 24, lat: 91 }] }] })) });
    expect(result.summary.urbanStatus).toBe("partial");
    expect(result.dataset.categoryCounts.building).toBe(1);
  });

  it("rejects a late response after cancellation even when the fetch implementation ignores abort", async () => {
    const controller = new AbortController();
    let deliver!: (value: OSMAcquisition) => void;
    const pending = loadOSMArea(bounds, { signal: controller.signal, transport, fetchAcquisition: async () => new Promise((resolve) => { deliver = resolve; }) });
    const assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
    controller.abort();
    deliver(empty);
    await assertion;
  });

  it("versions changed analytical data but not cache or retrieval metadata", async () => {
    const options = { signal: new AbortController().signal, fetchAcquisition: fetcher(empty) };
    const original = await loadOSMArea(bounds, options);
    const cached = await loadOSMArea(bounds, { ...options, transport: { ...transport, provenance: { ...transport.provenance, cached: true, receivedAt: "2026-09-29T00:00:00Z" } } });
    const withBuilding = await loadOSMArea(bounds, { ...options, fetchAcquisition: fetcher(acquisition({ elements: [building] })) });
    expect(cached.dataset.id).toBe(original.dataset.id);
    expect(withBuilding.dataset.id).not.toBe(original.dataset.id);
    expect(original.dataset.source).not.toHaveProperty("basemap");
  });

  it("warns about old and unknown snapshots without calling them current", () => {
    expect(snapshotWarning(transport.provenance, Date.parse("2026-09-28T00:00:00Z"))).toMatch(/118 days old/);
    expect(snapshotWarning({ ...transport.provenance, snapshotTimestamp: null })).toMatch(/unknown/);
    expect(snapshotWarning({ ...transport.provenance, snapshotTimestamp: "2026-09-28T00:00:00Z" }, Date.parse("2026-09-28T12:00:00Z"))).toBeNull();
  });
});

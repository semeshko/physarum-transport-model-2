import { describe, expect, it, vi } from "vitest";
import { createOverpassQuery, createUrbanContextQuery, fetchOSMTransport, OSMRequestError } from "./client";
import { measureOSMArea, validateOSMArea } from "./area";

const bounds = [24.03, 49.84, 24.04, 49.85] as const;

describe("OSM request safeguards", () => {
  it("builds a bounded geometry query for supported highways", () => {
    const query = createOverpassQuery(bounds);
    expect(query).toContain('[out:json][timeout:20]');
    expect(query).toContain('["highway"~');
    expect(query).toContain('["area"!="yes"](49.84,24.03,49.85,24.04)');
    expect(query).toContain("out body geom");
  });

  it("keeps focused urban context in a separate bounded query", () => { const query = createUrbanContextQuery(bounds); expect(query).toContain('way["building"]'); expect(query).toContain('way["natural"="water"]'); expect(query).toContain('way["leisure"="park"]'); expect(query).not.toContain('way["highway"'); });

  it("measures and accepts a district-scale area", () => {
    expect(measureOSMArea(bounds).areaSquareKilometers).toBeGreaterThan(0);
    expect(validateOSMArea(bounds)).toEqual(measureOSMArea(bounds));
  });

  it("rejects an oversized viewport before fetch", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(fetchOSMTransport([24, 49.8, 24.2, 50], { fetchImplementation })).rejects.toThrow(/too large/);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("posts the query and returns JSON", async () => {
    const payload = { elements: [{ type: "way", id: 1 }] };
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation })).resolves.toEqual(payload);
    expect(fetchImplementation).toHaveBeenCalledWith(expect.stringContaining("overpass"), expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }));
  });

  it("falls back deterministically when the primary public instance fails", async () => {
    const payload = { elements: [{ type: "way", id: 1 }] };
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("timeout", { status: 504 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation })).resolves.toEqual(payload);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each([[429, "throttled"], [504, "timeout"], [500, "remote"]] as const)("maps HTTP %s to %s", async (status, code) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("error", { status }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation })).rejects.toMatchObject({ code });
  });

  it("reports empty and malformed responses", async () => {
    const emptyFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"elements":[]}', { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation: emptyFetch })).rejects.toMatchObject({ code: "empty" });
    const malformedFetch = vi.fn<typeof fetch>().mockImplementation(async () => new Response("not json", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation: malformedFetch })).rejects.toMatchObject({ code: "remote" });
  });

  it("times out and aborts the underlying request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    await expect(fetchOSMTransport(bounds, { fetchImplementation, timeoutMilliseconds: 1 })).rejects.toEqual(expect.objectContaining<Partial<OSMRequestError>>({ code: "timeout" }));
  });
});

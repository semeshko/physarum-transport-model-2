import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { measureOSMArea, validateOSMArea } from "./area";
import { createOverpassQuery, createUrbanContextQuery, fetchOSMTransport, fetchOSMUrbanContext, OSMRequestError } from "./client";
import type { GISBounds } from "../gis/types";

const bounds: GISBounds = [24.0241, 49.8398, 24.0391, 49.846];
const oversized: GISBounds = [24, 49.8, 24.2, 49.95];

const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response;
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body }) as unknown as Response;

describe("OSM query construction", () => {
  it("builds a bounded geometry query for supported highways", () => {
    const query = createOverpassQuery(bounds);
    expect(query).toContain('way["highway"');
    expect(query).toContain("out body geom");
    expect(query).toContain("49.8398,24.0241,49.846,24.0391");
  });

  it("keeps focused urban context in a separate bounded query", () => {
    const query = createUrbanContextQuery(bounds);
    expect(query).toContain('way["building"]');
    expect(query).toContain('way["natural"="water"]');
    expect(query).toContain('way["leisure"="park"]');
    expect(query).not.toContain('way["highway"');
  });

  it("measures and accepts a district-scale area", () => {
    const measurement = measureOSMArea(bounds);
    expect(measurement.areaSquareKilometers).toBeLessThan(2);
    expect(() => validateOSMArea(bounds)).not.toThrow();
  });
});

/**
 * The browser never speaks to Overpass. `User-Agent` is a forbidden header
 * name, so page JavaScript cannot identify the application and OSM community
 * endpoints answer an unidentified browser with HTTP 406. Everything below
 * asserts that the client's only correspondent is this app's own route.
 */
describe("browser OSM client", () => {
  it("requests this application's route, not a public Overpass instance", async () => {
    const fetchImplementation = vi.fn(async () => ok({ elements: [{ type: "way", id: 1 }] }));
    await fetchOSMTransport(bounds, { fetchImplementation });
    const [url] = fetchImplementation.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/^\/api\/osm\?/);
    expect(url).toContain("kind=transport");
    expect(url).toContain("bbox=24.024100,49.839800,24.039100,49.846000");
    expect(url).not.toMatch(/overpass|openstreetmap\.de|mail\.ru/);
  });

  it("asks for context separately from transport", async () => {
    const fetchImplementation = vi.fn(async () => ok({ elements: [{ type: "way", id: 2 }] }));
    await fetchOSMUrbanContext(bounds, { fetchImplementation });
    expect((fetchImplementation.mock.calls[0] as unknown as [string])[0]).toContain("kind=context");
  });

  it("rejects an oversized viewport before spending a request", async () => {
    const fetchImplementation = vi.fn(async () => ok({ elements: [] }));
    await expect(fetchOSMTransport(oversized, { fetchImplementation })).rejects.toThrow(/too large/);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("surfaces the server's error classification unchanged", async () => {
    for (const [status, code, message] of [[429, "throttled", "busy"], [504, "timeout", "could not finish"], [413, "oversized", "smaller area"]] as const) {
      const fetchImplementation = vi.fn(async () => fail(status, { error: `The OSM service is ${message}.`, code }));
      await expect(fetchOSMTransport(bounds, { fetchImplementation })).rejects.toMatchObject({ code });
    }
  });

  it("reports an empty area rather than an empty dataset", async () => {
    const fetchImplementation = vi.fn(async () => ok({ elements: [] }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation })).rejects.toMatchObject({ code: "empty" });
  });

  it("classifies a malformed payload as a remote fault", async () => {
    const fetchImplementation = vi.fn(async () => ok({ nope: true }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation })).rejects.toMatchObject({ code: "remote" });
  });

  it("times out and aborts the underlying request", async () => {
    const fetchImplementation = vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
    await expect(fetchOSMTransport(bounds, { fetchImplementation, timeoutMilliseconds: 10 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("distinguishes a caller cancellation from a timeout", async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
    const pending = fetchOSMTransport(bounds, { fetchImplementation, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("does not start a request when the caller is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImplementation = vi.fn(async () => ok({ elements: [{ type: "way", id: 1 }] }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("never substitutes fixture data when a live fetch fails", async () => {
    const fetchImplementation = vi.fn(async () => fail(502, { error: "Could not reach the OSM service.", code: "network" }));
    await expect(fetchOSMTransport(bounds, { fetchImplementation })).rejects.toBeInstanceOf(OSMRequestError);
  });
});

/**
 * The Node transport must never reach a client bundle. `node:https` in a
 * `"use client"` graph is a build failure at best and a silent polyfill at
 * worst, and it would take the identifying User-Agent somewhere it cannot work.
 */
describe("server-only boundary", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("keeps the Node transport out of the browser client", () => {
    const source = read("src/osm/client.ts");
    expect(source).not.toMatch(/from\s+["']\.\/server-client["']/);
    expect(source).not.toMatch(/node:https|from "https"/);
  });

  it("keeps provider mechanics out of the workspace component", () => {
    const source = read("src/components/MapWorkspace.tsx");
    expect(source).not.toMatch(/from\s+["']@\/osm\/server-client["']|node:https|\/api\/interpreter/i);
    expect(source).toMatch(/from "@\/osm\/client"/);
  });

  it("confines the Node transport to the server route", () => {
    expect(read("src/osm/server-client.ts")).toMatch(/node:https/);
    const route = read("src/app/api/osm/route.ts");
    expect(route).toMatch(/runtime = "nodejs"/);
    expect(route).toMatch(/signal:\s*request\.signal/);
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";
import type { GISBounds } from "../gis/types";
import { OSMRequestError } from "./query";
import { clearOverpassCache, OVERPASS_ENDPOINTS, overpassUserAgent, requestOverpass, type OverpassTransport } from "./server-client";

const bounds: GISBounds = [24.0241, 49.8398, 24.0391, 49.846];
const payload = (count = 3) => JSON.stringify({ version: 0.6, elements: Array.from({ length: count }, (_, i) => ({ type: "way", id: i + 1 })) });
const respond = (body: string) => ({ status: 200, headers: {}, body });

beforeEach(() => clearOverpassCache());

/**
 * These tests never touch a public Overpass instance: the transport is
 * injected. The one live probe belongs in QA, not in the suite — volunteer-run
 * mirrors should not be hit on every `npm test`.
 */
describe("server-side Overpass client", () => {
  it("identifies the application rather than impersonating a browser", () => {
    const agent = overpassUserAgent("https://example.test/contact");
    expect(agent).toMatch(/^physarum-transport-model-2\/\d/);
    expect(agent).toContain("+https://example.test/contact");
    expect(agent).not.toMatch(/Mozilla|Chrome|Safari|AppleWebKit/);
  });

  it("sends that identity on the wire", async () => {
    let seen: string | undefined;
    const transport: OverpassTransport = async (_endpoint, _body, _timeout) => { seen = overpassUserAgent(); return respond(payload()); };
    await requestOverpass("transport", bounds, { transport });
    expect(seen).toMatch(/^physarum-transport-model-2\//);
  });

  it("posts the generated query as a form body", async () => {
    let body = "";
    const transport: OverpassTransport = async (_endpoint, sent) => { body = sent; return respond(payload()); };
    await requestOverpass("transport", bounds, { transport });
    const decoded = decodeURIComponent(body.replace(/^data=/, "").replace(/\+/g, " "));
    expect(decoded).toContain('way["highway"');
    expect(decoded).toContain("49.8398,24.0241,49.846,24.0391");
  });

  it("returns a parsed payload with provenance", async () => {
    const transport: OverpassTransport = async () => respond(payload(5));
    const result = await requestOverpass("transport", bounds, { transport });
    expect(result.elementCount).toBe(5);
    expect(result.endpoint).toBe(OVERPASS_ENDPOINTS[0]);
    expect(result.cached).toBe(false);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("falls back to the next mirror when one rejects", async () => {
    const tried: string[] = [];
    const transport: OverpassTransport = async (endpoint) => {
      tried.push(endpoint);
      if (endpoint === OVERPASS_ENDPOINTS[0]) throw new OSMRequestError("remote", "nope");
      return respond(payload());
    };
    const result = await requestOverpass("transport", bounds, { transport });
    expect(tried).toEqual([OVERPASS_ENDPOINTS[0], OVERPASS_ENDPOINTS[1]]);
    expect(result.endpoint).toBe(OVERPASS_ENDPOINTS[1]);
  });

  it("does not retry other mirrors for an area-shaped problem", async () => {
    const tried: string[] = [];
    const transport: OverpassTransport = async (endpoint) => { tried.push(endpoint); return respond(JSON.stringify({ elements: [] })); };
    await expect(requestOverpass("transport", bounds, { transport })).rejects.toMatchObject({ code: "empty" });
    expect(tried).toHaveLength(1);
  });

  it("classifies malformed JSON as a remote fault", async () => {
    const transport: OverpassTransport = async () => respond("<html>not json</html>");
    await expect(requestOverpass("transport", bounds, { transport })).rejects.toMatchObject({ code: "remote" });
  });

  it("propagates a timeout from the transport", async () => {
    const transport: OverpassTransport = async () => { throw new OSMRequestError("timeout", "timed out"); };
    await expect(requestOverpass("transport", bounds, { transport })).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports an unreachable provider after exhausting every mirror", async () => {
    const transport: OverpassTransport = async () => { throw new Error("ECONNREFUSED"); };
    await expect(requestOverpass("transport", bounds, { transport })).rejects.toMatchObject({ code: "network" });
  });

  it("serves an identical small-AOI query from cache instead of the provider", async () => {
    const transport = vi.fn<OverpassTransport>(async () => respond(payload()));
    const first = await requestOverpass("transport", bounds, { transport });
    const second = await requestOverpass("transport", bounds, { transport });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("keeps transport and context as separate cache entries", async () => {
    const transport = vi.fn<OverpassTransport>(async () => respond(payload()));
    await requestOverpass("transport", bounds, { transport });
    await requestOverpass("context", bounds, { transport });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

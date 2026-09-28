import { describe, expect, it } from "vitest";
import { BASEMAP_STYLE, cartoRequest } from "./basemap";

describe("CARTO display requests", () => {
  it.each([BASEMAP_STYLE, "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite.json", "https://basemaps.cartocdn.com/fonts/OpenSans/0-255.pbf", "https://a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/4/8/5.mvt"])("authenticates %s", (url) => {
    expect(new URL(cartoRequest(url, "test-key").url).searchParams.get("key")).toBe("test-key");
  });
  it.each(["/api/osm?kind=transport", "https://other.test/tile", "https://basemaps.cartocdn.com.other.test/tile", "https://evilbasemaps.cartocdn.com/tile", "http://basemaps.cartocdn.com/tile", "data:application/json,{}"])("does not send the key to %s", (url) => {
    expect(cartoRequest(url, "test-key")).toEqual({ url });
  });
  it("preserves query parameters and replaces an existing key without duplication", () => {
    const url = new URL(cartoRequest(`${BASEMAP_STYLE}?language=uk&key=old`, "new").url);
    expect(url.searchParams.get("language")).toBe("uk");
    expect(url.searchParams.getAll("key")).toEqual(["new"]);
  });
  it("does not invent credentials when unconfigured", () => {
    expect(cartoRequest(BASEMAP_STYLE, " ")).toEqual({ url: BASEMAP_STYLE });
  });
});

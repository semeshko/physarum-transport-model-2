import { describe, expect, it } from "vitest";
import { createLayerRegistry } from "../map/layer-registry";
import { addOSMAreaToRegistry } from "./map-registry";

describe("OSM selected-area map registry", () => {
  it("leaves the registry unchanged without an area", () => {
    const base = createLayerRegistry([], []);
    expect(addOSMAreaToRegistry(base, null)).toBe(base);
  });

  it("adds one shared GeoJSON source and two preview layers", () => {
    const result = addOSMAreaToRegistry(createLayerRegistry([], []), [24.03, 49.84, 24.04, 49.85]);
    expect(result.sources.map((source) => source.id)).toEqual(["osm-selected-area-source"]);
    expect(result.layers.map((layer) => layer.id)).toEqual(["osm-selected-area-fill", "osm-selected-area-outline"]);
  });
});

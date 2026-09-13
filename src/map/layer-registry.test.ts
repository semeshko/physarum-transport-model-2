import { describe, expect, it } from "vitest";
import { createLayerRegistry, setLayerVisibility } from "./layer-registry";

const source = { id: "roads-source", definition: { type: "geojson" as const, data: "/roads.geojson" } };
const layer = { id: "roads-layer", type: "line" as const, source: source.id, visible: true, paint: { "line-color": "#ffffff" } };

describe("layer registry", () => {
  it("creates a registry with valid source references", () => { const registry = createLayerRegistry([source], [layer]); expect(registry.sources).toHaveLength(1); expect(registry.layers[0].source).toBe(source.id); });
  it("rejects an unknown source", () => { expect(() => createLayerRegistry([source], [{ ...layer, source: "missing" }])).toThrow(/unknown source/i); });
  it("updates visibility without mutation", () => { const registry = createLayerRegistry([source], [layer]); const hidden = setLayerVisibility(registry, layer.id, false); expect(hidden.layers[0].visible).toBe(false); expect(registry.layers[0].visible).toBe(true); });
  it("rejects unknown layers", () => { const registry = createLayerRegistry([source], [layer]); expect(() => setLayerVisibility(registry, "missing", false)).toThrow(/unknown layer/i); });
});

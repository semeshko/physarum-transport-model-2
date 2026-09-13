import { createLayerRegistry } from "./layer-registry";

export const TEST_NETWORK_LAYER_ID = "test-network-lines";
export const testNetworkRegistry = createLayerRegistry(
  [{ id: "test-network-source", definition: { type: "geojson", data: "/data/test-network.geojson" } }],
  [{ id: TEST_NETWORK_LAYER_ID, type: "line", source: "test-network-source", visible: true, paint: { "line-color": "#42d9c8", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 15, 7], "line-opacity": 0.92 }, layout: { "line-cap": "round", "line-join": "round" } }],
);

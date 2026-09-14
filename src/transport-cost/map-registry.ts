import type { GeoJSONSourceSpecification } from "maplibre-gl";
import { createLayerRegistry, type LayerRegistry } from "../map/layer-registry";
import type { CostedTransportNetwork } from "./types";

type MapGeoJSON = Exclude<GeoJSONSourceSpecification["data"], string>;
export const COST_LAYER_ID = "profile-generalized-cost";

export function addTransportCostsToRegistry(base: LayerRegistry, network: CostedTransportNetwork, visible: boolean): LayerRegistry {
  const values = network.edges.map((item) => item.cost.generalizedCostSeconds / item.edge.lengthMeters).sort((a, b) => a - b);
  const low = values[Math.floor(Math.max(0, values.length - 1) * 0.1)] ?? 0; const high = values[Math.floor(Math.max(0, values.length - 1) * 0.9)] ?? Math.max(low, 1);
  const span = Math.max(high - low, Number.EPSILON);
  const features = network.edges.map(({ edge, cost }) => ({ type: "Feature", id: edge.id, properties: { edgeId: edge.id, costSeconds: cost.generalizedCostSeconds, costPerMeter: cost.generalizedCostSeconds / edge.lengthMeters, normalizedCost: Math.max(0, Math.min(1, (cost.generalizedCostSeconds / edge.lengthMeters - low) / span)) }, geometry: { type: "LineString", coordinates: edge.coordinates } }));
  const data = { type: "FeatureCollection", features } as unknown as MapGeoJSON;
  return createLayerRegistry([...base.sources, { id: "profile-cost-source", definition: { type: "geojson", data } }], [...base.layers, { id: COST_LAYER_ID, type: "line", source: "profile-cost-source", visible, paint: { "line-color": ["interpolate", ["linear"], ["get", "normalizedCost"], 0, "#39d98a", 0.5, "#ffd166", 1, "#ef476f"], "line-width": 5, "line-opacity": 0.85 } }]);
}

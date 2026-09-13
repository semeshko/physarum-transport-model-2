import type { GeoJSONSourceSpecification } from "maplibre-gl";
import type { TransportGraph } from "../graph/types";
import { createLayerRegistry, type LayerRegistry } from "../map/layer-registry";
import type { PhysarumState } from "./types";

type MapGeoJSON = Exclude<GeoJSONSourceSpecification["data"], string>;

export function addPhysarumResultToRegistry(base: LayerRegistry, graph: TransportGraph, state: PhysarumState | null): LayerRegistry {
  const maximumConductivity = state ? Math.max(...Object.values(state.edgeConductivities), 0) : 0;
  const features = state ? graph.edges.flatMap((edge) => {
    const conductivity = state.edgeConductivities[edge.id];
    const flow = state.edgeFlows[edge.id];
    if (!Number.isFinite(conductivity) || !Number.isFinite(flow)) return [];
    return [{ type: "Feature", id: `physarum-${edge.id}`, properties: { edgeId: edge.id, conductivity, absoluteFlow: Math.abs(flow), normalizedConductivity: maximumConductivity > 0 ? conductivity / maximumConductivity : 0 }, geometry: { type: "LineString", coordinates: edge.coordinates } }];
  }) : [];
  const data = { type: "FeatureCollection", features } as unknown as MapGeoJSON;
  return createLayerRegistry(
    [...base.sources, { id: "physarum-result-source", definition: { type: "geojson", data } }],
    [...base.layers, { id: "physarum-result", type: "line", source: "physarum-result-source", visible: state !== null, paint: { "line-color": ["interpolate", ["linear"], ["get", "normalizedConductivity"], 0, "#334155", 0.5, "#43d9c8", 1, "#f8ff8b"], "line-width": ["interpolate", ["linear"], ["get", "normalizedConductivity"], 0, 1, 1, 9], "line-opacity": 0.92 } }],
  );
}

import { createLayerRegistry, type LayerRegistry } from "../map/layer-registry";
import type { SpatiallyConstrainedNetwork } from "./types";

export function addSpatialImpactsToRegistry(base: LayerRegistry, network: SpatiallyConstrainedNetwork, visible = true): LayerRegistry {
  const features = network.edges.filter((item) => item.hardExcluded || item.impacts.some((impact) => impact.effect === "soft")).map((item) => ({ type: "Feature" as const, id: item.costedEdge.edge.id, properties: { edgeId: item.costedEdge.edge.id, hard: item.hardExcluded, soft: item.impacts.some((impact) => impact.effect === "soft") }, geometry: { type: "LineString" as const, coordinates: item.costedEdge.edge.coordinates.map((position) => [...position]) } }));
  return createLayerRegistry([...base.sources, { id: "spatial-impacts-source", definition: { type: "geojson", data: { type: "FeatureCollection", features } } }], [...base.layers,
    { id: "spatial-hard-edges", type: "line", source: "spatial-impacts-source", visible, filter: ["==", ["get", "hard"], true], paint: { "line-color": "#ff315f", "line-width": 8, "line-opacity": 0.92 } },
    { id: "spatial-soft-edges", type: "line", source: "spatial-impacts-source", visible, filter: ["==", ["get", "soft"], true], paint: { "line-color": "#b4ff39", "line-width": 7, "line-opacity": 0.9, "line-dasharray": [1, 1] } },
  ]);
}

import type { GeoJSONSourceSpecification } from "maplibre-gl";
import { createGISLayerRegistry, type GISLayerVisibility } from "@/gis/map-registry";
import type { GISDataset } from "@/gis/types";
import { createLayerRegistry, type LayerRegistry } from "@/map/layer-registry";
import type { TransportGraph } from "./types";
import type { ProfiledTransportNetwork } from "../transport-profile/types";

export type GraphLayerVisibility = {
  readonly edges: boolean;
  readonly nodes: boolean;
};

export const DEFAULT_GRAPH_LAYER_VISIBILITY: GraphLayerVisibility = { edges: true, nodes: true };

type MapGeoJSON = Exclude<GeoJSONSourceSpecification["data"], string>;

export function createTransportWorkspaceRegistry(dataset: GISDataset, graph: TransportGraph, profiled: ProfiledTransportNetwork, gisVisibility: GISLayerVisibility, graphVisibility: GraphLayerVisibility): LayerRegistry {
  const gisRegistry = createGISLayerRegistry(dataset, gisVisibility);
  const usableEdgeIds = new Set(profiled.usableEdges.map((edge) => edge.id));
  const edgeData = {
    type: "FeatureCollection",
    features: graph.edges.map((edge) => ({ type: "Feature", id: edge.id, properties: { edgeId: edge.id, usable: usableEdgeIds.has(edge.id), sourceFeatureIds: edge.provenance.map((item) => item.sourceFeatureId), lengthMeters: edge.lengthMeters }, geometry: { type: "LineString", coordinates: edge.coordinates } })),
  } as unknown as MapGeoJSON;
  const nodeData = {
    type: "FeatureCollection",
    features: graph.nodes.filter((node) => profiled.activeNodeIds.has(node.id)).map((node) => ({ type: "Feature", id: node.id, properties: { nodeId: node.id }, geometry: { type: "Point", coordinates: node.position } })),
  } as unknown as MapGeoJSON;

  return createLayerRegistry(
    [...gisRegistry.sources, { id: "transport-graph-edges-source", definition: { type: "geojson", data: edgeData } }, { id: "transport-graph-nodes-source", definition: { type: "geojson", data: nodeData } }],
    [
      ...gisRegistry.layers,
      { id: "transport-profile-excluded-edges", type: "line", source: "transport-graph-edges-source", visible: graphVisibility.edges, filter: ["==", ["get", "usable"], false], paint: { "line-color": "#697080", "line-width": 1.5, "line-opacity": 0.35, "line-dasharray": [1, 2] } },
      { id: "transport-graph-edges", type: "line", source: "transport-graph-edges-source", visible: graphVisibility.edges, filter: ["==", ["get", "usable"], true], paint: { "line-color": "#ff4fd8", "line-width": 2, "line-opacity": 0.9, "line-dasharray": [2, 1.5] } },
      { id: "transport-graph-nodes", type: "circle", source: "transport-graph-nodes-source", visible: graphVisibility.nodes, paint: { "circle-color": "#fff36b", "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6], "circle-stroke-color": "#18111f", "circle-stroke-width": 1.5 } },
    ],
  );
}

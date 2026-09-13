import type { GeoJSONSourceSpecification } from "maplibre-gl";
import type { TransportGraph } from "@/graph/types";
import { createLayerRegistry, type LayerRegistry } from "@/map/layer-registry";
import type { AnalysisScenario } from "./types";

export const SCENARIO_LAYER_IDS = {
  source: "scenario-source",
  sink: "scenario-sink",
  blockedEdges: "scenario-blocked-edges",
  penalizedEdges: "scenario-penalized-edges",
} as const;

type MapGeoJSON = Exclude<GeoJSONSourceSpecification["data"], string>;

export function addScenarioToRegistry(base: LayerRegistry, graph: TransportGraph, scenario: AnalysisScenario): LayerRegistry {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const terminals = scenario.terminals.flatMap((terminal) => {
    const node = nodes.get(terminal.nodeId);
    return node ? [{ type: "Feature", id: terminal.id, properties: { terminalId: terminal.id, nodeId: node.id, role: terminal.role }, geometry: { type: "Point", coordinates: node.position } }] : [];
  });
  const constrainedEdges = scenario.edgeConstraints.flatMap((constraint) => {
    const edge = edges.get(constraint.edgeId);
    return edge ? [{ type: "Feature", id: constraint.id, properties: { edgeId: edge.id, blocked: constraint.blocked, penaltyMultiplier: constraint.penaltyMultiplier }, geometry: { type: "LineString", coordinates: edge.coordinates } }] : [];
  });
  const terminalData = { type: "FeatureCollection", features: terminals } as unknown as MapGeoJSON;
  const constraintData = { type: "FeatureCollection", features: constrainedEdges } as unknown as MapGeoJSON;
  return createLayerRegistry(
    [...base.sources, { id: "scenario-terminals-source", definition: { type: "geojson", data: terminalData } }, { id: "scenario-constraints-source", definition: { type: "geojson", data: constraintData } }],
    [
      ...base.layers,
      { id: SCENARIO_LAYER_IDS.blockedEdges, type: "line", source: "scenario-constraints-source", visible: true, filter: ["==", ["get", "blocked"], true], paint: { "line-color": "#ff3b4f", "line-width": 7, "line-opacity": 0.9 } },
      { id: SCENARIO_LAYER_IDS.penalizedEdges, type: "line", source: "scenario-constraints-source", visible: true, filter: ["all", ["==", ["get", "blocked"], false], [">", ["get", "penaltyMultiplier"], 1]], paint: { "line-color": "#ff9f1c", "line-width": 6, "line-opacity": 0.9, "line-dasharray": [1, 1] } },
      { id: SCENARIO_LAYER_IDS.source, type: "circle", source: "scenario-terminals-source", visible: true, filter: ["==", ["get", "role"], "source"], paint: { "circle-color": "#3ee089", "circle-radius": 9, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
      { id: SCENARIO_LAYER_IDS.sink, type: "circle", source: "scenario-terminals-source", visible: true, filter: ["==", ["get", "role"], "sink"], paint: { "circle-color": "#ff4fd8", "circle-radius": 9, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
    ],
  );
}

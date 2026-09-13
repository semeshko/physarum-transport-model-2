import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "../gis/ingest";
import { buildTransportGraph } from "../graph/build";
import { prepareNetwork } from "../scenario/prepare";
import { createEmptyScenario, setTerminal } from "../scenario/scenario";
import { overpassResponseToGeoJSON } from "./adapter";
import { SMALL_OSM_RESPONSE_FIXTURE } from "./fixtures";

function dataset() {
  const converted = overpassResponseToGeoJSON(SMALL_OSM_RESPONSE_FIXTURE);
  return ingestGeoJSON(converted.featureCollection, { name: "fixture", source: { kind: "osm", name: "fixture" } });
}

describe("OSM domain adapter", () => {
  it("converts ways to LineString features with stable OSM IDs", () => {
    const converted = overpassResponseToGeoJSON(SMALL_OSM_RESPONSE_FIXTURE);
    expect(converted.wayCount).toBe(4);
    expect(converted.featureCollection.features[0]).toMatchObject({ id: "osm-way-101", geometry: { type: "LineString", coordinates: [[24.03, 49.84], [24.031, 49.84], [24.032, 49.84]] } });
    expect(converted.featureCollection.features[0]).toMatchObject({ lineTopology: { mode: "authoritative", vertexAnchors: [[{ id: "osm-node-1" }, { id: "osm-node-10" }, { id: "osm-node-2" }]], missingExpectedAnchors: false } });
  });

  it("preserves highway and future routing metadata without enforcing it", () => {
    const first = dataset().features[0];
    expect(first.properties).toMatchObject({ osm_type: "way", osm_id: 101, highway: "residential", name: "Test Street", surface: "asphalt", oneway: "yes", access: "yes", motor_vehicle: "yes" });
  });

  it("preserves bridge, tunnel, layer, foot, and bicycle metadata", () => {
    const features = dataset().features;
    expect(features[1].properties).toMatchObject({ bridge: "yes", layer: "1", foot: "designated", bicycle: "yes" });
    expect(features[2].properties).toMatchObject({ tunnel: "yes", layer: "-1" });
  });

  it("uses existing GIS classification for road, footway, and path", () => {
    expect(dataset().features.map((feature) => feature.category)).toEqual(["road", "path", "path", "road"]);
  });

  it("supports multi-segment geometry and missing optional tags", () => {
    const features = dataset().features;
    expect(features[0].geometry).toMatchObject({ type: "LineString", coordinates: expect.any(Array) });
    if (features[0].geometry.type === "LineString") expect(features[0].geometry.coordinates).toHaveLength(3);
    expect(features[3].properties).toEqual({ highway: "service", osm_type: "way", osm_id: 104 });
  });

  it("skips unsupported and malformed elements with a diagnostic", () => {
    const result = overpassResponseToGeoJSON(SMALL_OSM_RESPONSE_FIXTURE);
    expect(result.skippedElementCount).toBe(3);
    expect(result.warnings[0]).toMatch(/Skipped 3/);
  });

  it("fails clearly when the root response is malformed", () => {
    expect(() => overpassResponseToGeoJSON({ elements: "wrong" })).toThrow(/elements array/);
  });

  it("does not mutate the remote response", () => {
    const before = JSON.stringify(SMALL_OSM_RESPONSE_FIXTURE);
    overpassResponseToGeoJSON(SMALL_OSM_RESPONSE_FIXTURE);
    expect(JSON.stringify(SMALL_OSM_RESPONSE_FIXTURE)).toBe(before);
  });

  it("feeds the existing graph builder deterministically", () => {
    const first = buildTransportGraph(dataset());
    const second = buildTransportGraph(dataset());
    expect(second).toEqual(first);
    expect(first.nodes.length).toBeGreaterThan(0);
    expect(first.edges.length).toBeGreaterThan(0);
    expect(first.edges.some((edge) => edge.provenance.some((item) => item.sourceFeatureId === "osm-way-101"))).toBe(true);
    expect(first.diagnostics.geometricIntersectionTestCount).toBe(0);
    expect(first.diagnostics.anchoredNodeCount).toBeGreaterThan(0);
  });

  it("preserves anchored graph identity when Overpass elements are reordered", () => {
    const reversed = { ...SMALL_OSM_RESPONSE_FIXTURE, elements: [...SMALL_OSM_RESPONSE_FIXTURE.elements].reverse() };
    const converted = overpassResponseToGeoJSON(reversed);
    const reorderedDataset = ingestGeoJSON(converted.featureCollection, { name: "fixture", source: { kind: "osm", name: "fixture" } });
    const first = buildTransportGraph(dataset()); const second = buildTransportGraph(reorderedDataset);
    expect(second.nodes.map((node) => node.id)).toEqual(first.nodes.map((node) => node.id));
    expect(second.edges.map((edge) => edge.id)).toEqual(first.edges.map((edge) => edge.id));
  });

  it("uses isolated fallback anchors and reports missing ordered node IDs", () => {
    const result = overpassResponseToGeoJSON({ elements: [{ type: "way", id: 1, tags: { highway: "road" }, geometry: [{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }] }] });
    expect(result.missingTopologyWayCount).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/missing valid ordered node anchors/);
    expect(result.featureCollection.features[0]).toMatchObject({ lineTopology: { missingExpectedAnchors: true, vertexAnchors: [[{ id: "osm-way-1-vertex-0", kind: "fallback" }, { id: "osm-way-1-vertex-1", kind: "fallback" }]] } });
  });

  it("prepares an ordinary scenario on an OSM-derived graph", () => {
    const graph = buildTransportGraph(dataset());
    const edge = graph.edges[0];
    const scenario = setTerminal(setTerminal(createEmptyScenario(), "source", edge.fromNodeId), "sink", edge.toNodeId);
    expect(prepareNetwork(graph, scenario)).toMatchObject({ validation: { valid: true }, network: { graphId: graph.id } });
  });
});

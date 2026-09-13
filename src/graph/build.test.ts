import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "../gis/ingest";
import { buildTransportGraph } from "./build";

const options = { name: "graph-test.geojson", source: { kind: "file" as const, name: "graph-test.geojson" } };

function road(id: string, coordinates: unknown, type: "LineString" | "MultiLineString" = "LineString") {
  return { type: "Feature", id, properties: { highway: "residential" }, geometry: { type, coordinates } };
}

function graph(features: unknown[]) {
  return buildTransportGraph(ingestGeoJSON({ type: "FeatureCollection", features }, options));
}

describe("transport graph builder", () => {
  it("converts a simple LineString to two nodes and one edge", () => {
    const result = graph([road("a", [[24, 49], [24.01, 49]])]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 2, edgeCount: 1, connectedComponentCount: 1 });
  });

  it("deduplicates shared endpoints", () => {
    const result = graph([road("a", [[24, 49], [24.01, 49]]), road("b", [[24.01, 49], [24.02, 49]])]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 3, edgeCount: 2 });
  });

  it("snaps endpoint noise within the configured tolerance", () => {
    const result = graph([road("a", [[24, 49], [24.01, 49]]), road("b", [[24.0100005, 49], [24.02, 49]])]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 3, edgeCount: 2, connectedComponentCount: 1 });
  });

  it("creates an intersection node and splits crossing line interiors", () => {
    const result = graph([road("horizontal", [[24, 49], [24.02, 49]]), road("vertical", [[24.01, 48.99], [24.01, 49.01]])]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 5, edgeCount: 4, connectedComponentCount: 1 });
    expect(result.nodes.some((node) => node.position[0] === 24.01 && node.position[1] === 49)).toBe(true);
  });

  it("splits a line when another line endpoint touches its interior", () => {
    const result = graph([road("horizontal", [[24, 49], [24.02, 49]]), road("touch", [[24.01, 49], [24.01, 49.01]])]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 4, edgeCount: 3 });
  });

  it("normalizes MultiLineString parts and preserves provenance", () => {
    const result = graph([road("multi", [[[24, 49], [24.01, 49]], [[24.01, 49], [24.02, 49]]], "MultiLineString")]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 3, edgeCount: 2 });
    expect(result.edges.map((edge) => edge.provenance[0].sourcePartIndex)).toEqual([0, 1]);
    expect(result.edges.every((edge) => edge.provenance[0].sourceFeatureId === "multi")).toBe(true);
  });

  it("produces deterministic node and edge IDs", () => {
    const features = [road("a", [[24, 49], [24.01, 49], [24.02, 49]])];
    expect(graph(features)).toEqual(graph(features));
  });

  it("stores positive geographic edge length in meters", () => {
    const result = graph([road("a", [[24, 49], [24.001, 49]])]);
    expect(result.edges[0].lengthMeters).toBeGreaterThan(70);
    expect(result.edges[0].lengthMeters).toBeLessThan(80);
  });

  it("reports disconnected components", () => {
    const result = graph([road("a", [[24, 49], [24.01, 49]]), road("b", [[25, 50], [25.01, 50]])]);
    expect(result.diagnostics).toMatchObject({ connectedComponentCount: 2, largestConnectedComponentNodeCount: 2 });
  });

  it("does not mutate the source GISDataset", () => {
    const dataset = ingestGeoJSON({ type: "FeatureCollection", features: [road("a", [[24, 49], [24.01, 49]])] }, options);
    const snapshot = JSON.stringify(dataset);
    buildTransportGraph(dataset);
    expect(JSON.stringify(dataset)).toBe(snapshot);
  });

  it("ignores non-transport features", () => {
    const result = graph([{ type: "Feature", id: "building", properties: { building: "yes" }, geometry: { type: "Polygon", coordinates: [[[24, 49], [24.01, 49], [24.01, 49.01], [24, 49]]] } }]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 0, edgeCount: 0, connectedComponentCount: 0 });
  });
});

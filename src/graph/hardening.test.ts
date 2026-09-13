import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "../gis/ingest";
import { buildTransportGraph } from "./build";

const options = { name: "topology.geojson", source: { kind: "file" as const, name: "topology.geojson" } };

function road(id: string, coordinates: number[][], properties: Record<string, unknown> = {}) {
  return { type: "Feature", id, properties: { highway: "residential", ...properties }, geometry: { type: "LineString", coordinates } };
}

function build(features: unknown[]) {
  return buildTransportGraph(ingestGeoJSON({ type: "FeatureCollection", features }, options));
}

const horizontal = [[24, 49], [24.02, 49]];
const vertical = [[24.01, 48.99], [24.01, 49.01]];

describe("graph topology hardening", () => {
  it("creates a junction for an ordinary same-level crossing", () => {
    expect(build([road("a", horizontal), road("b", vertical)]).diagnostics).toMatchObject({ nodeCount: 5, edgeCount: 4, gradeSeparatedCrossingsIgnored: 0 });
  });

  it("does not connect a bridge crossing to a ground-level road", () => {
    const result = build([road("ground", horizontal), road("bridge", vertical, { bridge: "yes", layer: "1" })]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 4, edgeCount: 2, connectedComponentCount: 2, gradeSeparatedCrossingsIgnored: 1 });
  });

  it("does not connect a tunnel crossing to a ground-level road", () => {
    const result = build([road("ground", horizontal), road("tunnel", vertical, { tunnel: "yes", layer: -1 })]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 4, edgeCount: 2, gradeSeparatedCrossingsIgnored: 1 });
  });

  it("does not connect crossings with different layer values", () => {
    const result = build([road("lower", horizontal, { layer: 0 }), road("upper", vertical, { layer: 2 })]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 4, edgeCount: 2, gradeSeparatedCrossingsIgnored: 1 });
  });

  it("merges exact duplicates and retains both provenances", () => {
    const result = build([road("a", horizontal), road("b", horizontal)]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 2, edgeCount: 1, duplicateEdgesMerged: 1, collinearOverlapsResolved: 1 });
    expect(result.edges[0].provenance.map((item) => item.sourceFeatureId)).toEqual(["a", "b"]);
  });

  it("merges reversed duplicates deterministically", () => {
    const result = build([road("forward", horizontal), road("reverse", [...horizontal].reverse())]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 2, edgeCount: 1, duplicateEdgesMerged: 1 });
    expect(result.edges[0].provenance).toHaveLength(2);
  });

  it("splits and merges a partial collinear overlap", () => {
    const result = build([road("long-a", [[24, 49], [24.02, 49]]), road("long-b", [[24.01, 49], [24.03, 49]])]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 4, edgeCount: 3, duplicateEdgesMerged: 1, collinearOverlapsResolved: 1 });
    expect(result.edges.find((edge) => edge.provenance.length === 2)?.provenance.map((item) => item.sourceFeatureId)).toEqual(["long-a", "long-b"]);
  });

  it("splits and merges a fully contained segment", () => {
    const result = build([road("outer", [[24, 49], [24.03, 49]]), road("inner", [[24.01, 49], [24.02, 49]])]);
    expect(result.diagnostics).toMatchObject({ nodeCount: 4, edgeCount: 3, duplicateEdgesMerged: 1, collinearOverlapsResolved: 1 });
  });

  it("rejects duplicate coordinates, snapping collapses, self-loops, and zero lengths", () => {
    const result = build([
      road("duplicate-coordinate", [[24, 49], [24, 49], [24.01, 49]]),
      road("snap-collapse", [[25, 50], [25.0000005, 50]]),
    ]);
    expect(result.diagnostics.zeroLengthEdgesRejected).toBe(1);
    expect(result.diagnostics.invalidSegmentsRejected).toBe(1);
    expect(result.edges.every((edge) => edge.fromNodeId !== edge.toNodeId && edge.lengthMeters > 0)).toBe(true);
  });

  it("keeps hardened output deterministic and source data immutable", () => {
    const source = { type: "FeatureCollection", features: [road("a", horizontal), road("b", [...horizontal].reverse())] };
    const snapshot = JSON.stringify(source);
    const first = build(source.features);
    const second = build(source.features);
    expect(first).toEqual(second);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});

describe("moderately larger deterministic grid", () => {
  it("builds a 25 by 25 grid within an MVP-scale budget", () => {
    const features: unknown[] = [];
    for (let index = 0; index < 25; index += 1) {
      const offset = index * 0.001;
      features.push(road(`horizontal-${index}`, [[24, 49 + offset], [24.024, 49 + offset]]));
      features.push(road(`vertical-${index}`, [[24 + offset, 49], [24 + offset, 49.024]]));
    }
    const started = performance.now();
    const result = build(features);
    const durationMilliseconds = performance.now() - started;
    console.info(`grid-performance segments=50 nodes=${result.nodes.length} edges=${result.edges.length} durationMs=${durationMilliseconds.toFixed(2)}`);
    expect(result.diagnostics).toMatchObject({ nodeCount: 625, edgeCount: 1200, connectedComponentCount: 1 });
    expect(durationMilliseconds).toBeLessThan(1_000);
  });
});

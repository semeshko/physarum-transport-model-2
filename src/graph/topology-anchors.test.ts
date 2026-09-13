import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "../gis/ingest";
import { runPhysarum } from "../physarum/solver";
import { prepareNetwork } from "../scenario/prepare";
import { createEmptyScenario, setTerminal } from "../scenario/scenario";
import { buildTransportGraph } from "./build";

const options = { name: "topology", source: { kind: "file" as const, name: "topology" } };
function line(id: string, coordinates: number[][], anchors?: string[]) {
  return { type: "Feature", id, properties: { highway: "residential" }, geometry: { type: "LineString", coordinates }, ...(anchors ? { lineTopology: { mode: "authoritative", vertexAnchors: [anchors.map((anchor) => ({ id: anchor, kind: "source" }))], missingExpectedAnchors: false } } : {}) };
}
function graph(features: unknown[]) { return buildTransportGraph(ingestGeoJSON({ type: "FeatureCollection", features }, options)); }

describe("authoritative topology anchors", () => {
  it("does not create a junction for crossing OSM ways without a shared node", () => {
    const result = graph([line("horizontal", [[-1, 0], [1, 0]], ["h1", "h2"]), line("vertical", [[0, -1], [0, 1]], ["v1", "v2"])]);
    expect(result).toMatchObject({ diagnostics: { nodeCount: 4, edgeCount: 2, connectedComponentCount: 2, geometricIntersectionTestCount: 0 } });
  });

  it("connects ways only through a shared authoritative node", () => {
    const result = graph([line("horizontal", [[-1, 0], [0, 0], [1, 0]], ["h1", "shared", "h2"]), line("vertical", [[0, -1], [0, 0], [0, 1]], ["v1", "shared", "v2"])]);
    expect(result).toMatchObject({ diagnostics: { nodeCount: 5, edgeCount: 4, connectedComponentCount: 1, anchoredNodeCount: 5 } });
    expect(result.nodes.find((node) => node.topologyAnchorId === "shared")).toBeDefined();
  });

  it("keeps stable anchored node and edge IDs when feature order changes", () => {
    const features = [line("a", [[0, 0], [1, 0]], ["n1", "n2"]), line("b", [[1, 0], [2, 0]], ["n2", "n3"])];
    const first = graph(features); const second = graph([...features].reverse());
    expect(second.nodes.map((node) => node.id)).toEqual(first.nodes.map((node) => node.id));
    expect(second.edges.map((edge) => edge.id)).toEqual(first.edges.map((edge) => edge.id));
  });

  it("fails explicitly when one anchor has materially conflicting coordinates", () => {
    expect(() => graph([line("a", [[0, 0], [1, 0]], ["same", "a2"]), line("b", [[0.01, 0], [0.01, 1]], ["same", "b2"])] )).toThrow(/conflicting coordinates/);
  });

  it("rejects a repeated anchor that would create a self-loop", () => {
    const result = graph([line("loop", [[0, 0], [0, 0]], ["same", "same"])]);
    expect(result).toMatchObject({ diagnostics: { edgeCount: 0, zeroLengthEdgesRejected: 1 } });
  });

  it("retains geometric intersections for ordinary GeoJSON", () => {
    const result = graph([line("horizontal", [[-1, 0], [1, 0]]), line("vertical", [[0, -1], [0, 1]])]);
    expect(result).toMatchObject({ diagnostics: { nodeCount: 5, edgeCount: 4, connectedComponentCount: 1, geometricIntersectionTestCount: 1, geometricIntersectionCount: 1 } });
  });

  it("does not silently join mixed anchored and geometry-only inputs", () => {
    const result = graph([line("anchored", [[-1, 0], [1, 0]], ["a1", "a2"]), line("generic", [[0, -1], [0, 1]])]);
    expect(result.diagnostics.connectedComponentCount).toBe(2);
  });

  it("prepares and solves a scenario on an anchored graph", () => {
    const result = graph([line("a", [[0, 0], [1, 0], [2, 0]], ["n1", "n2", "n3"])]);
    const scenario = setTerminal(setTerminal(createEmptyScenario(), "source", result.nodes[0].id), "sink", result.nodes.at(-1)!.id);
    const prepared = prepareNetwork(result, scenario);
    expect(prepared.validation.valid).toBe(true);
    expect(runPhysarum(prepared.network!).terminationReason).toBe("converged");
  });
});

import { describe, expect, it } from "vitest";
import { buildTransportGraph } from "../graph/build";
import { ingestGeoJSON } from "../gis/ingest";
import { prepareNetwork } from "./prepare";
import { createEmptyScenario, setEdgePenalty, setTerminal, toggleBlockedEdge } from "./scenario";
import type { AnalysisScenario } from "./types";

function road(id: string, coordinates: number[][]) {
  return { type: "Feature", id, properties: { highway: "residential" }, geometry: { type: "LineString", coordinates } };
}

function graph(features = [road("chain", [[24, 49], [24.01, 49], [24.02, 49]])]) {
  return buildTransportGraph(ingestGeoJSON({ type: "FeatureCollection", features }, { name: "scenario.geojson", source: { kind: "file", name: "scenario.geojson" } }));
}

function validScenario(): AnalysisScenario {
  return setTerminal(setTerminal(createEmptyScenario(), "source", "node-1"), "sink", "node-3");
}

describe("scenario preparation", () => {
  it("prepares a valid source and sink scenario", () => {
    const result = prepareNetwork(graph(), validScenario());
    expect(result.validation).toMatchObject({ valid: true, sourceSinkConnectedAfterConstraints: true, activeEdgeCount: 2 });
    expect(result.network?.terminals).toHaveLength(2);
  });

  it("rejects a missing source", () => {
    const result = prepareNetwork(graph(), setTerminal(createEmptyScenario(), "sink", "node-3"));
    expect(result.validation.issues.some((issue) => issue.code === "missing-source")).toBe(true);
  });

  it("rejects a missing sink", () => {
    const result = prepareNetwork(graph(), setTerminal(createEmptyScenario(), "source", "node-1"));
    expect(result.validation.issues.some((issue) => issue.code === "missing-sink")).toBe(true);
  });

  it("rejects the same node as source and sink", () => {
    const scenario = setTerminal(setTerminal(createEmptyScenario(), "source", "node-1"), "sink", "node-1");
    expect(prepareNetwork(graph(), scenario).validation.issues.some((issue) => issue.code === "same-source-sink")).toBe(true);
  });

  it("rejects nonexistent node references", () => {
    const scenario = setTerminal(setTerminal(createEmptyScenario(), "source", "missing"), "sink", "node-3");
    expect(prepareNetwork(graph(), scenario).validation.issues.some((issue) => issue.code === "unknown-node")).toBe(true);
  });

  it("rejects terminals in different graph components", () => {
    const disconnected = graph([road("a", [[24, 49], [24.01, 49]]), road("b", [[25, 50], [25.01, 50]])]);
    const scenario = setTerminal(setTerminal(createEmptyScenario(), "source", "node-1"), "sink", "node-3");
    expect(prepareNetwork(disconnected, scenario).validation.issues.some((issue) => issue.code === "terminals-disconnected")).toBe(true);
  });

  it("blocks an edge without mutating TransportGraph", () => {
    const transportGraph = graph();
    const before = JSON.stringify(transportGraph);
    prepareNetwork(transportGraph, toggleBlockedEdge(validScenario(), "edge-1"));
    expect(JSON.stringify(transportGraph)).toBe(before);
  });

  it("excludes a hard-constrained edge from the usable network", () => {
    const alternate = graph([
      road("lower", [[24, 49], [24.01, 49], [24.02, 49]]),
      road("detour", [[24, 49], [24.01, 49.01], [24.02, 49]]),
    ]);
    const scenario = setTerminal(setTerminal(createEmptyScenario(), "source", "node-1"), "sink", "node-3");
    const result = prepareNetwork(alternate, toggleBlockedEdge(scenario, "edge-1"));
    expect(result.validation).toMatchObject({ valid: true, activeEdgeCount: 3, blockedEdgeCount: 1 });
    expect(result.network?.edges.some((edge) => edge.graphEdgeId === "edge-1")).toBe(false);
  });

  it("reports when a hard constraint disconnects source and sink", () => {
    const result = prepareNetwork(graph(), toggleBlockedEdge(validScenario(), "edge-2"));
    expect(result.validation).toMatchObject({ sourceSinkConnectedOnGraph: true, sourceSinkConnectedAfterConstraints: false, valid: false });
    expect(result.validation.issues.some((issue) => issue.code === "constraints-disconnect-terminals")).toBe(true);
  });

  it("applies a soft multiplier to effective cost", () => {
    const transportGraph = graph();
    const result = prepareNetwork(transportGraph, setEdgePenalty(validScenario(), "edge-1", 2));
    expect(result.network?.edges.find((edge) => edge.graphEdgeId === "edge-1")?.effectiveCost).toBeCloseTo(transportGraph.edges[0].lengthMeters * 2);
  });

  it("rejects multipliers below one", () => {
    expect(prepareNetwork(graph(), setEdgePenalty(validScenario(), "edge-1", 0.5)).validation.issues.some((issue) => issue.code === "invalid-penalty")).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects non-finite multiplier %s", (multiplier) => {
    expect(prepareNetwork(graph(), setEdgePenalty(validScenario(), "edge-1", multiplier)).validation.issues.some((issue) => issue.code === "invalid-penalty")).toBe(true);
  });

  it("keeps physical graph length unchanged", () => {
    const transportGraph = graph();
    const length = transportGraph.edges[0].lengthMeters;
    prepareNetwork(transportGraph, setEdgePenalty(validScenario(), "edge-1", 3));
    expect(transportGraph.edges[0].lengthMeters).toBe(length);
  });

  it("derives deterministic prepared output", () => {
    const transportGraph = graph();
    const scenario = setEdgePenalty(validScenario(), "edge-1", 1.5);
    expect(prepareNetwork(transportGraph, scenario)).toEqual(prepareNetwork(transportGraph, scenario));
  });

  it("creates a predictable empty and reset scenario", () => {
    expect(createEmptyScenario()).toEqual({ id: "scenario-1", name: "Untitled scenario", terminals: [], edgeConstraints: [], costModel: { kind: "length-meters" } });
    expect(prepareNetwork(graph(), createEmptyScenario()).validation).toMatchObject({ valid: false, activeEdgeCount: 2, blockedEdgeCount: 0, penalizedEdgeCount: 0 });
  });

  it("rejects invalid terminal magnitude and duplicate terminal entries", () => {
    const base = validScenario();
    const scenario = { ...base, terminals: [...base.terminals, { ...base.terminals[0], magnitude: 0 }] };
    const codes = prepareNetwork(graph(), scenario).validation.issues.map((issue) => issue.code);
    expect(codes).toContain("duplicate-terminal");
    expect(codes).toContain("invalid-terminal-magnitude");
  });

  it("preserves immutable scenario input during derivation", () => {
    const scenario = setEdgePenalty(validScenario(), "edge-1", 2);
    const before = JSON.stringify(scenario);
    prepareNetwork(graph(), scenario);
    expect(JSON.stringify(scenario)).toBe(before);
  });
});

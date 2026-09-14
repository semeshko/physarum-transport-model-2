import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "../gis/ingest";
import { buildTransportGraph } from "../graph/build";
import { runPhysarum } from "../physarum/solver";
import { prepareNetwork } from "../scenario/prepare";
import { createEmptyScenario, setEdgePenalty, setTerminal, setTransportProfile, toggleBlockedEdge } from "../scenario/scenario";
import { applyTransportProfile, decideEdgeAccess } from "./profile";
import type { TransportProfileId } from "./types";

const options = { name: "profiles", source: { kind: "file" as const, name: "profiles" } };
function feature(id: string, highway: string, start: number, tags: Record<string, unknown> = {}) { return { type: "Feature", id, properties: { highway, ...tags }, geometry: { type: "LineString", coordinates: [[start, 0], [start + 0.001, 0]] } }; }
function graph(features: unknown[]) { return buildTransportGraph(ingestGeoJSON({ type: "FeatureCollection", features }, options)); }
function decision(highway: string, profileId: TransportProfileId, tags: Record<string, unknown> = {}) { return decideEdgeAccess(graph([feature("edge", highway, 0, tags)]).edges[0], profileId); }

describe("transport profile access rules", () => {
  it.each([
    ["residential", true, true, true], ["footway", true, false, false], ["cycleway", false, true, false], ["pedestrian", true, false, false], ["path", true, true, false], ["steps", true, false, false], ["motorway", false, false, true], ["service", true, false, false], ["track", true, true, true], ["bridleway", false, false, false],
  ] as const)("applies documented MVP defaults for highway=%s", (highway, pedestrian, bicycle, motor) => {
    expect(decision(highway, "pedestrian").decision === "allowed").toBe(pedestrian);
    expect(decision(highway, "bicycle").decision === "allowed").toBe(bicycle);
    expect(decision(highway, "motor").decision === "allowed").toBe(motor);
  });

  it("applies mode-specific keys over generic parent restrictions", () => {
    expect(decision("residential", "pedestrian", { access: "no", foot: "yes" }).decision).toBe("allowed");
    expect(decision("residential", "bicycle", { access: "no", vehicle: "no", bicycle: "designated" }).decision).toBe("allowed");
    expect(decision("residential", "motor", { access: "no", vehicle: "no", motor_vehicle: "no", motorcar: "yes" }).decision).toBe("allowed");
    expect(decision("residential", "motor", { access: "yes", motor_vehicle: "no" }).decision).toBe("denied");
  });

  it.each([
    ["pedestrian", "foot", "yes", "allowed"], ["pedestrian", "foot", "no", "denied"],
    ["bicycle", "bicycle", "yes", "allowed"], ["bicycle", "bicycle", "designated", "allowed"], ["bicycle", "bicycle", "no", "denied"],
    ["motor", "motor_vehicle", "yes", "allowed"], ["motor", "motor_vehicle", "no", "denied"], ["motor", "motorcar", "yes", "allowed"], ["motor", "motorcar", "no", "denied"],
  ] as const)("applies %s access key %s=%s", (profileId, key, value, expected) => expect(decision("residential", profileId, { [key]: value }).decision).toBe(expected));

  it.each(["no", "private"])("denies access=%s", (value) => expect(decision("residential", "pedestrian", { access: value }).decision).toBe("denied"));
  it.each(["yes", "designated", "permissive"])("allows explicit access=%s", (value) => expect(decision("motorway", "pedestrian", { foot: value }).decision).toBe("allowed"));
  it.each(["destination", "customers", "delivery", "permit", "official", "unknown"])("conservatively excludes unsupported access=%s", (value) => expect(decision("residential", "motor", { motorcar: value })).toMatchObject({ decision: "denied", reason: "conditional-excluded", conditional: true }));
  it("conservatively excludes conditional expressions", () => expect(decision("residential", "pedestrian", { foot: "yes", "foot:conditional": "no @ (Mo-Fr)" })).toMatchObject({ decision: "denied", reason: "conditional-excluded" }));

  it("evaluates every merged provenance and diagnoses disagreement", () => {
    const merged = graph([feature("allowed", "residential", 0, { foot: "yes" }), feature("denied", "residential", 0, { foot: "no" })]);
    expect(merged.edges[0].provenance).toHaveLength(2);
    expect(decideEdgeAccess(merged.edges[0], "pedestrian")).toMatchObject({ decision: "allowed", conflictingProvenance: true });
  });

  it("does not mutate the base graph or change physical identities", () => {
    const base = graph([feature("road", "residential", 0), feature("walk", "footway", 1)]); const snapshot = JSON.stringify(base);
    for (const profileId of ["pedestrian", "bicycle", "motor"] as const) { const profiled = applyTransportProfile(base, profileId); expect(profiled.nodes.map((node) => node.id)).toEqual(base.nodes.map((node) => node.id)); expect([...profiled.usableEdges, ...profiled.excludedEdges].map((edge) => edge.id).sort()).toEqual(base.edges.map((edge) => edge.id).sort()); }
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("calculates profile-specific active nodes and connectivity", () => {
    const connected = graph([
      { ...feature("a", "residential", 0), geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] } },
      { ...feature("middle", "footway", 1), geometry: { type: "LineString", coordinates: [[1, 0], [2, 0]] } },
      { ...feature("b", "residential", 2), geometry: { type: "LineString", coordinates: [[2, 0], [3, 0]] } },
    ]);
    expect(applyTransportProfile(connected, "pedestrian").connectivity).toMatchObject({ activeNodeCount: 4, usableEdgeCount: 3, connectedComponentCount: 1 });
    expect(applyTransportProfile(connected, "motor").connectivity).toMatchObject({ activeNodeCount: 4, usableEdgeCount: 2, connectedComponentCount: 2 });
  });

  it.each(["yes", "-1", "no"])("preserves oneway=%s metadata without orienting profile edges", (oneway) => {
    const base = graph([feature("road", "residential", 0, { oneway })]); const profiled = applyTransportProfile(base, "motor");
    expect(profiled.accessDiagnostics.onewayTaggedNotEnforced).toBe(1); expect(profiled.usableEdges[0]).toBe(base.edges[0]); expect(profiled.decisions[0].onewayTagged).toBe(true);
  });

  it("filters a moderate graph in approximately linear work", () => {
    const features = Array.from({ length: 400 }, (_, index) => feature(`edge-${index}`, index % 2 ? "residential" : "footway", index * 0.002)); const base = graph(features); const started = performance.now(); const profiled = applyTransportProfile(base, "motor"); const duration = performance.now() - started;
    expect(profiled.connectivity.usableEdgeCount).toBe(200); expect(duration).toBeLessThan(100); console.info(`profile-performance nodes=${base.nodes.length} edges=${base.edges.length} durationMs=${duration.toFixed(2)}`);
  });
});

describe("profiled scenario preparation", () => {
  const base = graph([feature("residential", "residential", 0), feature("footway", "footway", 1), feature("cycleway", "cycleway", 2)]);
  it("rejects inactive terminals and constraints", () => {
    const motor = applyTransportProfile(base, "motor"); const inactive = base.nodes.find((node) => !motor.activeNodeIds.has(node.id))!;
    let scenario = setTransportProfile(createEmptyScenario(), "motor"); scenario = setTerminal(setTerminal(scenario, "source", base.nodes[0].id), "sink", inactive.id);
    expect(prepareNetwork(base, scenario, motor).validation.issues.some((issue) => issue.code === "inactive-node")).toBe(true);
    expect(prepareNetwork(base, toggleBlockedEdge(setTransportProfile(createEmptyScenario(), "motor"), base.edges[1].id), motor).validation.issues.some((issue) => issue.code === "inactive-edge")).toBe(true);
  });

  it("makes the same physical terminals valid for pedestrian and disconnected for motor", () => {
    const chain = graph([
      { ...feature("a", "residential", 0), geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] } },
      { ...feature("walk", "footway", 1), geometry: { type: "LineString", coordinates: [[1, 0], [2, 0]] } },
      { ...feature("b", "residential", 2), geometry: { type: "LineString", coordinates: [[2, 0], [3, 0]] } },
    ]);
    const pedestrian = setTerminal(setTerminal(createEmptyScenario(), "source", chain.nodes[0].id), "sink", chain.nodes.at(-1)!.id);
    expect(prepareNetwork(chain, pedestrian).validation.valid).toBe(true);
    const motor = { ...pedestrian, transportProfileId: "motor" as const };
    expect(prepareNetwork(chain, motor).validation).toMatchObject({ valid: false, sourceSinkConnectedOnGraph: false });
  });

  it("applies hard blocks and soft penalties after profile filtering", () => {
    const profiled = applyTransportProfile(base, "pedestrian"); const edge = profiled.usableEdges[0]; let scenario = createEmptyScenario(); scenario = setTerminal(setTerminal(scenario, "source", edge.fromNodeId), "sink", edge.toNodeId);
    expect(prepareNetwork(base, setEdgePenalty(scenario, edge.id, 2), profiled).network?.edges[0].effectiveCost).toBeCloseTo(edge.lengthMeters * 2);
    expect(prepareNetwork(base, toggleBlockedEdge(scenario, edge.id), profiled).validation.sourceSinkConnectedAfterConstraints).toBe(false);
  });

  it.each(["pedestrian", "bicycle", "motor"] as const)("runs Physarum on a valid %s network", (profileId) => {
    const profiled = applyTransportProfile(base, profileId); const edge = profiled.usableEdges[0]; let scenario = setTransportProfile(createEmptyScenario(), profileId); scenario = setTerminal(setTerminal(scenario, "source", edge.fromNodeId), "sink", edge.toNodeId); const prepared = prepareNetwork(base, scenario, profiled);
    expect(prepared.network?.edges.every((item) => profiled.usableEdges.some((edge) => edge.id === item.graphEdgeId))).toBe(true); expect(runPhysarum(prepared.network!).terminationReason).toBe("converged");
  });

  it("clears stale terminals and constraints when the profile changes", () => {
    let scenario = setTerminal(createEmptyScenario(), "source", "node-1"); scenario = toggleBlockedEdge(scenario, "edge-1"); expect(setTransportProfile(scenario, "motor")).toMatchObject({ transportProfileId: "motor", terminals: [], edgeConstraints: [] });
  });
});

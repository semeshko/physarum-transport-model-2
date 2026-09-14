import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "../gis/ingest";
import { buildTransportGraph } from "../graph/build";
import { runPhysarum } from "../physarum/solver";
import { prepareNetwork } from "../scenario/prepare";
import { createEmptyScenario, setEdgePenalty, setTerminal, setTransportProfile } from "../scenario/scenario";
import { applyTransportProfile } from "../transport-profile/profile";
import type { TransportProfileId } from "../transport-profile/types";
import { applyGeneralizedCosts, parseMaxspeedKilometersPerHour } from "./model";

const options = { name: "costs", source: { kind: "file" as const, name: "costs" } };
function feature(id: string, highway: string | null, tags: Record<string, unknown> = {}, y = 0) { return { type: "Feature", id, properties: { ...(highway ? { highway } : { category: "road" }), ...tags }, geometry: { type: "LineString", coordinates: [[0, y], [0.001, y]] } }; }
function network(profileId: TransportProfileId, features = [feature("edge", "residential")]) { const graph = buildTransportGraph(ingestGeoJSON({ type: "FeatureCollection", features }, options)); return { graph, profiled: applyTransportProfile(graph, profileId) }; }

describe("profile generalized cost", () => {
  it.each(["pedestrian", "bicycle", "motor"] as const)("is deterministic, finite and positive for %s", (profileId) => { const value = network(profileId); const first = applyGeneralizedCosts(value.profiled); expect(first).toEqual(applyGeneralizedCosts(value.profiled)); expect(first.edges[0].cost.generalizedCostSeconds).toBeGreaterThan(0); expect(Number.isFinite(first.edges[0].cost.generalizedCostSeconds)).toBe(true); });
  it("uses explicit motor maxspeed and parses mph", () => { expect(parseMaxspeedKilometersPerHour("30 mph")).toBeCloseTo(48.28032); const slow = applyGeneralizedCosts(network("motor", [feature("slow", "residential", { maxspeed: "20" })]).profiled); const fast = applyGeneralizedCosts(network("motor", [feature("fast", "residential", { maxspeed: "50 km/h" })]).profiled); expect(fast.edges[0].cost.generalizedCostSeconds).toBeLessThan(slow.edges[0].cost.generalizedCostSeconds); expect(fast.edges[0].cost.speedSource).toBe("explicit-maxspeed"); });
  it.each(["signals", "variable", "none", "UA:urban", "0", "nonsense"])("falls back for unsupported maxspeed=%s", (maxspeed) => expect(applyGeneralizedCosts(network("motor", [feature("edge", "residential", { maxspeed })]).profiled).edges[0].cost.speedSource).toBe("highway-default"));
  it("applies conservative surface bands", () => { const asphalt = applyGeneralizedCosts(network("bicycle", [feature("a", "residential", { surface: "asphalt" })]).profiled); const gravel = applyGeneralizedCosts(network("bicycle", [feature("g", "residential", { surface: "gravel" })]).profiled); expect(gravel.edges[0].cost.generalizedCostSeconds).toBeGreaterThan(asphalt.edges[0].cost.generalizedCostSeconds); });
  it("uses the stronger condition factor instead of double counting surface and smoothness", () => { const value = applyGeneralizedCosts(network("bicycle", [feature("g", "residential", { surface: "gravel", smoothness: "bad" })]).profiled).edges[0].cost; expect(value.conditionFactor).toBe(Math.max(value.surfaceFactor, value.smoothnessFactor)); });
  it("keeps missing metadata neutral and supports generic roads and paths", () => { const generic = network("pedestrian", [feature("road", null), { ...feature("path", null, {}, 1), properties: { category: "path" } }]); const costs = applyGeneralizedCosts(generic.profiled); expect(costs.edges).toHaveLength(2); expect(costs.edges.every((item) => item.cost.conditionFactor === 1 && item.cost.speedSource === "profile-default")).toBe(true); });
  it("never costs restricted or denied edges", () => { const value = network("motor", [feature("restricted", "service"), feature("denied", "footway", {}, 1), feature("allowed", "residential", {}, 2)]); expect(value.profiled.usableEdges).toHaveLength(1); expect(applyGeneralizedCosts(value.profiled).edges.map((item) => item.edge.provenance[0].sourceFeatureId)).toEqual(["allowed"]); });
  it("selects the cheapest allowed provenance deterministically and diagnoses differences", () => { const value = network("motor", [feature("slow", "residential", { maxspeed: "20" }), feature("fast", "residential", { maxspeed: "50" })]); const costed = applyGeneralizedCosts(value.profiled); expect(costed.edges[0].cost.sourceFeatureId).toBe("fast"); expect(costed.edges[0].provenanceCostConflict).toBe(true); });
  it("preserves graph identity and applies scenario penalty after profile cost", () => { const value = network("pedestrian"); const before = JSON.stringify(value.graph); const edge = value.profiled.usableEdges[0]; let scenario = setTerminal(setTerminal(createEmptyScenario(), "source", edge.fromNodeId), "sink", edge.toNodeId); scenario = setEdgePenalty(scenario, edge.id, 2); const prepared = prepareNetwork(value.graph, scenario, value.profiled, applyGeneralizedCosts(value.profiled)).network!.edges[0]; expect(prepared.effectiveCost).toBeCloseTo(prepared.profileCostSeconds! * 2); expect(JSON.stringify(value.graph)).toBe(before); });
  it("changes Physarum allocation relative to length-only impedance", () => {
    const value = network("motor", [
      { ...feature("slow", "residential", { maxspeed: "10" }), geometry: { type: "LineString", coordinates: [[0,0],[0.001,0.001],[0.002,0]] } },
      { ...feature("fast", "residential", { maxspeed: "50" }), geometry: { type: "LineString", coordinates: [[0,0],[0.001,-0.001],[0.002,0]] } },
    ]);
    const source = value.graph.nodes.find((node) => node.position[0] === 0)!; const sink = value.graph.nodes.find((node) => node.position[0] === 0.002)!;
    let scenario = setTransportProfile(createEmptyScenario(), "motor"); scenario = setTerminal(setTerminal(scenario, "source", source.id), "sink", sink.id);
    const prepared = prepareNetwork(value.graph, scenario, value.profiled, applyGeneralizedCosts(value.profiled)).network!;
    const generalized = runPhysarum(prepared); const lengthOnly = runPhysarum({ ...prepared, edges: prepared.edges.map((edge) => ({ ...edge, effectiveCost: edge.lengthMeters })) });
    const fastEdge = value.graph.edges.find((edge) => edge.provenance[0].sourceFeatureId === "fast")!; const slowEdge = value.graph.edges.find((edge) => edge.provenance[0].sourceFeatureId === "slow")!;
    expect(Math.abs(generalized.edgeFlows[fastEdge.id])).toBeGreaterThan(Math.abs(generalized.edgeFlows[slowEdge.id]));
    expect(Math.abs(lengthOnly.edgeFlows[fastEdge.id])).toBeCloseTo(Math.abs(lengthOnly.edgeFlows[slowEdge.id]), 4);
    console.info(`cost-comparison lengthFast=${Math.abs(lengthOnly.edgeFlows[fastEdge.id]).toFixed(4)} lengthSlow=${Math.abs(lengthOnly.edgeFlows[slowEdge.id]).toFixed(4)} generalizedFast=${Math.abs(generalized.edgeFlows[fastEdge.id]).toFixed(4)} generalizedSlow=${Math.abs(generalized.edgeFlows[slowEdge.id]).toFixed(4)}`);
  });

  it("computes a moderate network in approximately linear work", () => {
    const features = Array.from({ length: 400 }, (_, index) => feature(`edge-${index}`, "residential", {}, index * 0.002)); const value = network("motor", features); const started = performance.now(); const costed = applyGeneralizedCosts(value.profiled); const duration = performance.now() - started;
    expect(costed.edges).toHaveLength(400); expect(duration).toBeLessThan(100); console.info(`cost-performance edges=${costed.edges.length} durationMs=${duration.toFixed(2)}`);
  });
});

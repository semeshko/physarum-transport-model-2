import type { GISProperties } from "../gis/types";
import type { GraphEdge, GraphEdgeProvenance, TransportGraph } from "../graph/types";
import type { AccessEvidence, EdgeAccessDecision, ProfiledTransportNetwork, TransportProfileId } from "./types";

type DefaultAccess = "allow" | "deny" | "restricted";
const DEFAULTS: Readonly<Record<TransportProfileId, Readonly<Record<string, DefaultAccess>>>> = {
  pedestrian: { motorway: "deny", motorway_link: "deny", trunk: "allow", trunk_link: "allow", primary: "allow", primary_link: "allow", secondary: "allow", secondary_link: "allow", tertiary: "allow", tertiary_link: "allow", unclassified: "allow", residential: "allow", living_street: "allow", service: "allow", track: "allow", road: "allow", pedestrian: "allow", path: "allow", footway: "allow", steps: "allow", cycleway: "deny", bridleway: "deny" },
  bicycle: { motorway: "deny", motorway_link: "deny", trunk: "allow", trunk_link: "allow", primary: "allow", primary_link: "allow", secondary: "allow", secondary_link: "allow", tertiary: "allow", tertiary_link: "allow", unclassified: "allow", residential: "allow", living_street: "restricted", service: "restricted", track: "allow", road: "allow", pedestrian: "deny", path: "allow", footway: "deny", steps: "deny", cycleway: "allow", bridleway: "deny" },
  motor: { motorway: "allow", motorway_link: "allow", trunk: "allow", trunk_link: "allow", primary: "allow", primary_link: "allow", secondary: "allow", secondary_link: "allow", tertiary: "allow", tertiary_link: "allow", unclassified: "allow", residential: "allow", living_street: "restricted", service: "restricted", track: "allow", road: "allow", pedestrian: "deny", path: "deny", footway: "deny", steps: "deny", cycleway: "deny", bridleway: "deny" },
};
const ALLOWED_VALUES = new Set(["yes", "designated", "permissive"]);
const DENIED_VALUES = new Set(["no", "private"]);
const CONDITIONAL_KEYS: Readonly<Record<TransportProfileId, readonly string[]>> = { pedestrian: ["foot:conditional", "access:conditional"], bicycle: ["bicycle:conditional", "vehicle:conditional", "access:conditional"], motor: ["motorcar:conditional", "motor_vehicle:conditional", "vehicle:conditional", "access:conditional"] };
const PRECEDENCE: Readonly<Record<TransportProfileId, readonly string[]>> = { pedestrian: ["foot", "access"], bicycle: ["bicycle", "vehicle", "access"], motor: ["motorcar", "motor_vehicle", "vehicle", "access"] };

function stringTag(properties: GISProperties, key: string): string | null { const value = properties[key]; return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null; }
function provenanceDecision(provenance: GraphEdgeProvenance, profileId: TransportProfileId): AccessEvidence {
  for (const key of CONDITIONAL_KEYS[profileId]) { const value = stringTag(provenance.sourceProperties, key); if (value) return { sourceFeatureId: provenance.sourceFeatureId, key, value, reason: "conditional-restricted", decision: "restricted", allowed: false }; }
  for (const key of PRECEDENCE[profileId]) {
    const value = stringTag(provenance.sourceProperties, key); if (!value) continue;
    if (ALLOWED_VALUES.has(value)) return { sourceFeatureId: provenance.sourceFeatureId, key, value, reason: "explicit-allow", decision: "allowed", allowed: true };
    if (DENIED_VALUES.has(value)) return { sourceFeatureId: provenance.sourceFeatureId, key, value, reason: "explicit-deny", decision: "denied", allowed: false };
    return { sourceFeatureId: provenance.sourceFeatureId, key, value, reason: "explicit-restricted", decision: "restricted", allowed: false };
  }
  const highway = stringTag(provenance.sourceProperties, "highway");
  if ((highway === "trunk" || highway === "trunk_link") && profileId !== "motor" && stringTag(provenance.sourceProperties, "motorroad") === "yes") return { sourceFeatureId: provenance.sourceFeatureId, key: "motorroad", value: "yes", reason: "motorroad-default-deny", decision: "denied", allowed: false };
  if (!highway) {
    const allowed = provenance.sourceCategory === "road" || profileId !== "motor";
    return { sourceFeatureId: provenance.sourceFeatureId, key: "category", value: provenance.sourceCategory, reason: allowed ? "category-default-allow" : "category-default-deny", decision: allowed ? "allowed" : "denied", allowed };
  }
  const fallback = DEFAULTS[profileId][highway] ?? "deny"; const decision = fallback === "allow" ? "allowed" : fallback === "restricted" ? "restricted" : "denied";
  return { sourceFeatureId: provenance.sourceFeatureId, key: "highway", value: highway, reason: `highway-default-${decision}` as AccessEvidence["reason"], decision, allowed: decision === "allowed" };
}

export function decideEdgeAccess(edge: GraphEdge, profileId: TransportProfileId): EdgeAccessDecision {
  const evidence = edge.provenance.map((item) => provenanceDecision(item, profileId)).sort((a, b) => `${a.sourceFeatureId}|${a.key}|${a.value}`.localeCompare(`${b.sourceFeatureId}|${b.key}|${b.value}`));
  const allowed = evidence.some((item) => item.decision === "allowed"); const restricted = evidence.some((item) => item.decision === "restricted"); const conflictingProvenance = new Set(evidence.map((item) => item.decision)).size > 1;
  const decision = allowed ? "allowed" : restricted ? "restricted" : "denied"; const selected = evidence.find((item) => item.decision === decision) ?? evidence[0];
  return { edgeId: edge.id, decision, reason: selected.reason, evidence, conflictingProvenance, conditional: evidence.some((item) => item.reason === "conditional-restricted"), onewayTagged: edge.provenance.some((item) => stringTag(item.sourceProperties, "oneway") !== null) };
}

function connectivity(graph: TransportGraph, edges: readonly GraphEdge[]) {
  const active = new Set<string>(); const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) { active.add(edge.fromNodeId); active.add(edge.toNodeId); if (!adjacency.has(edge.fromNodeId)) adjacency.set(edge.fromNodeId, new Set()); if (!adjacency.has(edge.toNodeId)) adjacency.set(edge.toNodeId, new Set()); adjacency.get(edge.fromNodeId)!.add(edge.toNodeId); adjacency.get(edge.toNodeId)!.add(edge.fromNodeId); }
  const visited = new Set<string>(); let components = 0; let largest = 0;
  for (const nodeId of active) { if (visited.has(nodeId)) continue; components += 1; let size = 0; const queue = [nodeId]; visited.add(nodeId); while (queue.length) { const current = queue.pop()!; size += 1; for (const neighbor of adjacency.get(current) ?? []) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); } } largest = Math.max(largest, size); }
  return { active, diagnostics: { activeNodeCount: active.size, usableEdgeCount: edges.length, excludedEdgeCount: graph.edges.length - edges.length, connectedComponentCount: components, largestConnectedComponentNodeCount: largest, largestConnectedComponentRatio: active.size ? largest / active.size : 0, unusedNodeCount: graph.nodes.length - active.size } };
}

export function applyTransportProfile(graph: TransportGraph, profileId: TransportProfileId): ProfiledTransportNetwork {
  const decisions = graph.edges.map((edge) => decideEdgeAccess(edge, profileId)); const byId = new Map(decisions.map((decision) => [decision.edgeId, decision]));
  const usableEdges = graph.edges.filter((edge) => byId.get(edge.id)?.decision === "allowed"); const excludedEdges = graph.edges.filter((edge) => byId.get(edge.id)?.decision !== "allowed"); const result = connectivity(graph, usableEdges);
  return { graphId: graph.id, profileId, nodes: graph.nodes, usableEdges, excludedEdges, activeNodeIds: result.active, decisions, connectivity: result.diagnostics, accessDiagnostics: { physicalEdgeCount: graph.edges.length, allowedEdgeCount: usableEdges.length, restrictedEdgeCount: decisions.filter((item) => item.decision === "restricted").length, deniedEdgeCount: decisions.filter((item) => item.decision === "denied").length, excludedByHighwayDefault: decisions.filter((item) => item.decision !== "allowed" && (item.reason === "highway-default-deny" || item.reason === "highway-default-restricted" || item.reason === "motorroad-default-deny")).length, excludedByAccessTag: decisions.filter((item) => item.decision !== "allowed" && (item.reason === "explicit-deny" || item.reason === "explicit-restricted")).length, allowedByCategoryFallback: decisions.filter((item) => item.reason === "category-default-allow").length, explicitlyAllowed: decisions.filter((item) => item.decision === "allowed" && item.reason === "explicit-allow").length, conflictingProvenance: decisions.filter((item) => item.conflictingProvenance).length, conditionalAccessExcluded: decisions.filter((item) => item.conditional).length, onewayTaggedNotEnforced: decisions.filter((item) => item.onewayTagged).length } };
}

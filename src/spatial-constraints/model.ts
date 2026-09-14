import type { GISDataset, GISProperties } from "../gis/types";
import type { CostedTransportEdge, CostedTransportNetwork } from "../transport-cost/types";
import { bboxesOverlap, geometryPolygons, relateSegmentToPolygons } from "./geometry";
import { DEFAULT_SPATIAL_POLICY, type SpatialConstraintCategory, type SpatialConstraintPolicy, type SpatialConstraintRule, type SpatialConstraintSet, type SpatialEdgeImpact, type SpatialException, type SpatiallyConstrainedNetwork } from "./types";

function rule(category: SpatialConstraintCategory): SpatialConstraintRule { return category === "green" ? { effect: "soft", multiplier: DEFAULT_SPATIAL_POLICY.greenMultiplier, rationale: "Optional conservative green-space impedance." } : { effect: "hard", multiplier: 1, rationale: `${category === "building" ? "Building footprint" : "Polygonal water"} is a model barrier unless tagged infrastructure provides an exception.` }; }
export function createSpatialConstraintSet(dataset: GISDataset): SpatialConstraintSet {
  const counts = { building: 0, water: 0, green: 0 }; const warnings: string[] = [];
  const features = dataset.features.filter((feature) => ["building", "water", "green"].includes(feature.category)).map((feature) => {
    const category = feature.category as SpatialConstraintCategory; counts[category] += 1;
    const polygonal = feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
    if (!polygonal) warnings.push(`${feature.id}: ${category} ${feature.geometry.type} is context-only because it has no area.`);
    return { id: `spatial-${feature.id}`, sourceFeatureId: feature.id, category, geometry: feature.geometry, rule: polygonal ? rule(category) : { effect: "context" as const, multiplier: 1, rationale: "Non-polygon geometry has no defensible physical width." } };
  });
  return { datasetId: dataset.id, features, counts, warnings };
}
function value(properties: GISProperties, key: string): string { const raw = properties[key]; return typeof raw === "string" ? raw.toLowerCase() : raw === true ? "yes" : ""; }
function affirmative(properties: GISProperties, key: string): boolean { const current = value(properties, key); return Boolean(current && !["no", "false", "0"].includes(current)); }
function exceptionFor(edge: CostedTransportEdge, category: SpatialConstraintCategory): SpatialException {
  const properties = edge.edge.provenance.map((item) => item.sourceProperties);
  if (category === "water") { if (properties.some((item) => affirmative(item, "bridge"))) return "bridge"; if (properties.some((item) => affirmative(item, "tunnel"))) return "tunnel"; }
  if (category === "building") { if (properties.some((item) => value(item, "tunnel") === "building_passage")) return "building-passage"; if (properties.some((item) => affirmative(item, "covered"))) return "covered"; if (properties.some((item) => affirmative(item, "tunnel"))) return "tunnel"; }
  return null;
}
function median(values: readonly number[]): number { if (!values.length) return 1; const sorted = [...values].sort((a,b) => a-b); const middle = Math.floor(sorted.length/2); return sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2; }
export function applySpatialConstraints(costed: CostedTransportNetwork, constraints: SpatialConstraintSet, policy: SpatialConstraintPolicy = DEFAULT_SPATIAL_POLICY): SpatiallyConstrainedNetwork {
  const started = typeof performance === "undefined" ? 0 : performance.now(); let relationTestCount = 0;
  const polygonFeatures = constraints.features.filter((feature) => feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon");
  const edges = costed.edges.map((costedEdge) => {
    const impacts: SpatialEdgeImpact[] = [];
    for (const feature of polygonFeatures) {
      const enabled = feature.category === "building" ? policy.buildings : feature.category === "water" ? policy.water : policy.green;
      if (!enabled || !bboxesOverlap(costedEdge.edge.coordinates, feature.geometry as never)) continue;
      relationTestCount += 1; const relation = relateSegmentToPolygons(costedEdge.edge.coordinates[0], costedEdge.edge.coordinates[1], geometryPolygons(feature.geometry as never));
      if (relation.relation === "outside") continue;
      const exception = relation.affectedFraction > 0 ? exceptionFor(costedEdge, feature.category) : null;
      const baseEffect = feature.category === "green" ? "soft" : "hard";
      const effect = relation.relation === "boundary-touch" || exception ? "context" : baseEffect;
      const multiplier = effect === "soft" ? 1 + relation.affectedFraction * (policy.greenMultiplier - 1) : 1;
      impacts.push({ graphEdgeId: costedEdge.edge.id, constraintFeatureId: feature.id, sourceFeatureId: feature.sourceFeatureId, category: feature.category, relation: relation.relation, effect, affectedFraction: relation.affectedFraction, multiplier, exception, reason: exception ? `${exception} infrastructure exception` : relation.relation === "boundary-touch" ? "Boundary contact only; no occupied length." : feature.rule.rationale });
    }
    const hardExcluded = impacts.some((impact) => impact.effect === "hard");
    const spatialMultiplier = hardExcluded ? 1 : Math.max(1, ...impacts.filter((impact) => impact.effect === "soft").map((impact) => impact.multiplier));
    return { costedEdge, impacts, hardExcluded, spatialMultiplier, spatialCostSeconds: costedEdge.cost.generalizedCostSeconds * spatialMultiplier };
  });
  const usable = edges.filter((item) => !item.hardExcluded); const usableEdges = usable.map((item) => item.costedEdge.edge); const activeNodeIds = new Set(usableEdges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId]));
  const multipliers = usable.map((item) => item.spatialMultiplier), affectedFractions = edges.flatMap((item) => item.impacts.filter((impact) => impact.effect === "soft").map((impact) => impact.affectedFraction));
  const exceptionCounts = (kind: SpatialException) => edges.flatMap((edge) => edge.impacts).filter((impact) => impact.exception === kind).length;
  const evaluationMilliseconds = typeof performance === "undefined" ? 0 : performance.now() - started;
  return { graphId: costed.graphId, profileId: costed.profileId, nodes: costed.nodes, edges, usableEdges, activeNodeIds, diagnostics: { edgeCount: edges.length, polygonCount: polygonFeatures.length, relationTestCount, unaffectedEdgeCount: edges.filter((item) => item.impacts.length === 0).length, hardExcludedEdgeCount: edges.filter((item) => item.hardExcluded).length, softAffectedEdgeCount: edges.filter((item) => item.impacts.some((impact) => impact.effect === "soft")).length, bridgeExceptionCount: exceptionCounts("bridge"), tunnelExceptionCount: exceptionCounts("tunnel"), buildingPassageExceptionCount: exceptionCounts("building-passage"), coveredExceptionCount: exceptionCounts("covered"), geometryWarningCount: constraints.warnings.length, minimumSpatialMultiplier: Math.min(...multipliers, 1), medianSpatialMultiplier: median(multipliers), maximumSpatialMultiplier: Math.max(...multipliers, 1), averageAffectedFraction: affectedFractions.length ? affectedFractions.reduce((a,b)=>a+b,0)/affectedFractions.length : 0, evaluationMilliseconds } };
}

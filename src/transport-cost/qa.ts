import type { CostedTransportNetwork } from "./types";

export type CostQAReport = {
  readonly schemaVersion: 1;
  readonly graphId: string;
  readonly profileId: string;
  readonly counts: { readonly edges: number; readonly explicitSpeed: number; readonly fallbackSpeed: number; readonly surfaceTagged: number; readonly smoothnessTagged: number; readonly tracktypeTagged: number; readonly provenanceConflicts: number };
  readonly generalizedCostSeconds: { readonly minimum: number; readonly median: number; readonly maximum: number };
  readonly secondsPerMeter: { readonly minimum: number; readonly median: number; readonly maximum: number };
  readonly speedSources: Readonly<Record<string, number>>;
  readonly assumptions: { readonly costEquation: string; readonly conditionCombination: "maximum-not-product"; readonly comfortFactor: 1; readonly restrictedEdgesIncluded: false };
};
function distribution(values: readonly number[]) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); const median = !sorted.length ? 0 : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; return { minimum: sorted[0] ?? 0, median, maximum: sorted.at(-1) ?? 0 }; }
export function createCostQAReport(network: CostedTransportNetwork): CostQAReport {
  const costs = network.edges.map((item) => item.cost.generalizedCostSeconds); const perMeter = network.edges.map((item) => item.cost.generalizedCostSeconds / item.edge.lengthMeters); const speedSources: Record<string, number> = {};
  for (const item of network.edges) speedSources[item.cost.speedSource] = (speedSources[item.cost.speedSource] ?? 0) + 1;
  return { schemaVersion: 1, graphId: network.graphId, profileId: network.profileId, counts: { edges: network.diagnostics.edgeCount, explicitSpeed: network.diagnostics.explicitSpeedCount, fallbackSpeed: network.diagnostics.fallbackSpeedCount, surfaceTagged: network.diagnostics.surfaceTaggedCount, smoothnessTagged: network.diagnostics.smoothnessTaggedCount, tracktypeTagged: network.diagnostics.tracktypeTaggedCount, provenanceConflicts: network.diagnostics.provenanceCostConflictCount }, generalizedCostSeconds: distribution(costs), secondsPerMeter: distribution(perMeter), speedSources: Object.fromEntries(Object.entries(speedSources).sort(([a], [b]) => a.localeCompare(b))), assumptions: { costEquation: "max(0.001, lengthMeters / (speedKmH / 3.6) * max(surfaceFactor, smoothnessFactor, tracktypeFallbackFactor) * comfortFactor)", conditionCombination: "maximum-not-product", comfortFactor: 1, restrictedEdgesIncluded: false } };
}
export function serializeCostQAReport(report: CostQAReport): string { return `${JSON.stringify(report, null, 2)}\n`; }

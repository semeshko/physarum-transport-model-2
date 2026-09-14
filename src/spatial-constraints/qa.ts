import type { SpatiallyConstrainedNetwork } from "./types";

export type SpatialQAReport = {
  readonly graphId: string;
  readonly profileId: string;
  readonly diagnostics: SpatiallyConstrainedNetwork["diagnostics"];
  readonly affectedEdges: readonly { readonly edgeId: string; readonly hardExcluded: boolean; readonly spatialMultiplier: number; readonly impacts: SpatiallyConstrainedNetwork["edges"][number]["impacts"] }[];
};

export function createSpatialQAReport(network: SpatiallyConstrainedNetwork): SpatialQAReport {
  return { graphId: network.graphId, profileId: network.profileId, diagnostics: { ...network.diagnostics, evaluationMilliseconds: 0 }, affectedEdges: network.edges.filter((edge) => edge.impacts.length > 0).map((edge) => ({ edgeId: edge.costedEdge.edge.id, hardExcluded: edge.hardExcluded, spatialMultiplier: edge.spatialMultiplier, impacts: edge.impacts.map((impact) => ({ ...impact })) })) };
}

export function serializeSpatialQAReport(report: SpatialQAReport): string { return JSON.stringify(report, null, 2); }

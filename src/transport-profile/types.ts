import type { GraphEdge, GraphNode } from "../graph/types";

export const TRANSPORT_PROFILE_IDS = ["pedestrian", "bicycle", "motor"] as const;
export type TransportProfileId = typeof TRANSPORT_PROFILE_IDS[number];
export type TransportProfile = { readonly id: TransportProfileId; readonly label: string };
export const TRANSPORT_PROFILES: readonly TransportProfile[] = [
  { id: "pedestrian", label: "Pedestrian" }, { id: "bicycle", label: "Bicycle" }, { id: "motor", label: "Motor" },
];
export type AccessDecisionKind = "allowed" | "restricted" | "denied";
export type AccessDecisionReason = "explicit-allow" | "explicit-restricted" | "explicit-deny" | "conditional-restricted" | "smoothness-impassable-deny" | "motorroad-default-deny" | "highway-default-allow" | "highway-default-restricted" | "highway-default-deny" | "category-default-allow" | "category-default-deny";
export type AccessEvidence = { readonly sourceFeatureId: string; readonly key: string; readonly value: string; readonly reason: AccessDecisionReason; readonly decision: AccessDecisionKind; readonly allowed: boolean };
export type EdgeAccessDecision = { readonly edgeId: string; readonly decision: AccessDecisionKind; readonly reason: AccessDecisionReason; readonly evidence: readonly AccessEvidence[]; readonly conflictingProvenance: boolean; readonly conditional: boolean; readonly onewayTagged: boolean };
export type ProfileConnectivityDiagnostics = { readonly activeNodeCount: number; readonly usableEdgeCount: number; readonly excludedEdgeCount: number; readonly connectedComponentCount: number; readonly largestConnectedComponentNodeCount: number; readonly largestConnectedComponentRatio: number; readonly unusedNodeCount: number };
export type ProfileAccessDiagnostics = { readonly physicalEdgeCount: number; readonly allowedEdgeCount: number; readonly restrictedEdgeCount: number; readonly deniedEdgeCount: number; readonly excludedByHighwayDefault: number; readonly excludedByAccessTag: number; readonly allowedByCategoryFallback: number; readonly explicitlyAllowed: number; readonly conflictingProvenance: number; readonly conditionalAccessExcluded: number; readonly onewayTaggedNotEnforced: number };
export type ProfiledTransportNetwork = {
  readonly graphId: string;
  readonly profileId: TransportProfileId;
  readonly nodes: readonly GraphNode[];
  readonly usableEdges: readonly GraphEdge[];
  readonly excludedEdges: readonly GraphEdge[];
  readonly activeNodeIds: ReadonlySet<string>;
  readonly decisions: readonly EdgeAccessDecision[];
  readonly connectivity: ProfileConnectivityDiagnostics;
  readonly accessDiagnostics: ProfileAccessDiagnostics;
};

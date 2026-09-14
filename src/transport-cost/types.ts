import type { GraphEdge, GraphNode } from "../graph/types";
import type { TransportProfileId } from "../transport-profile/types";

export type SpeedSource = "explicit-maxspeed" | "highway-default" | "profile-default";
export type ConditionSource = "surface" | "smoothness" | "surface-and-smoothness" | "tracktype-fallback" | "default-neutral";
export type EdgeCostBreakdown = {
  readonly profileId: TransportProfileId;
  readonly lengthMeters: number;
  readonly speedKilometersPerHour: number;
  readonly speedSource: SpeedSource;
  readonly speedEvidence: string;
  readonly baseTravelTimeSeconds: number;
  readonly surface: string | null;
  readonly surfaceFactor: number;
  readonly smoothness: string | null;
  readonly smoothnessFactor: number;
  readonly tracktype: string | null;
  readonly tracktypeFactor: number;
  readonly conditionFactor: number;
  readonly conditionSource: ConditionSource;
  readonly comfortFactor: 1;
  readonly generalizedCostSeconds: number;
  readonly sourceFeatureId: string;
};
export type CostedTransportEdge = { readonly edge: GraphEdge; readonly cost: EdgeCostBreakdown; readonly provenanceCostConflict: boolean; readonly candidateCosts: readonly EdgeCostBreakdown[] };
export type CostDiagnostics = { readonly edgeCount: number; readonly explicitSpeedCount: number; readonly fallbackSpeedCount: number; readonly surfaceTaggedCount: number; readonly smoothnessTaggedCount: number; readonly tracktypeTaggedCount: number; readonly provenanceCostConflictCount: number; readonly medianTravelTimeSeconds: number; readonly medianCostPerMeter: number };
export type CostedTransportNetwork = { readonly graphId: string; readonly profileId: TransportProfileId; readonly nodes: readonly GraphNode[]; readonly edges: readonly CostedTransportEdge[]; readonly diagnostics: CostDiagnostics };

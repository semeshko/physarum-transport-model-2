import type { GISGeometry, GISPosition } from "../gis/types";
import type { GraphEdge, GraphNode } from "../graph/types";
import type { CostedTransportEdge } from "../transport-cost/types";
import type { TransportProfileId } from "../transport-profile/types";

export type SpatialConstraintCategory = "building" | "water" | "green";
export type SpatialEffect = "hard" | "soft" | "context";
export type SpatialRelation = "outside" | "boundary-touch" | "intersects" | "inside";
export type SpatialException = "bridge" | "tunnel" | "building-passage" | "covered" | null;
export type SpatialConstraintRule = { readonly effect: SpatialEffect; readonly multiplier: number; readonly rationale: string };
export type SpatialConstraintFeature = { readonly id: string; readonly sourceFeatureId: string; readonly category: SpatialConstraintCategory; readonly geometry: Extract<GISGeometry, { type: "Polygon" | "MultiPolygon" }>; readonly rule: SpatialConstraintRule };
export type SpatialContextFeature = { readonly id: string; readonly sourceFeatureId: string; readonly category: SpatialConstraintCategory; readonly geometry: GISGeometry; readonly rule: SpatialConstraintRule };
export type SpatialConstraintSet = { readonly datasetId: string; readonly features: readonly SpatialContextFeature[]; readonly counts: Readonly<Record<SpatialConstraintCategory, number>>; readonly warnings: readonly string[] };
export type SpatialConstraintPolicy = { readonly buildings: boolean; readonly water: boolean; readonly green: boolean; readonly greenMultiplier: number };
export type SpatialEdgeImpact = { readonly graphEdgeId: string; readonly constraintFeatureId: string; readonly sourceFeatureId: string; readonly category: SpatialConstraintCategory; readonly relation: SpatialRelation; readonly effect: SpatialEffect; readonly affectedFraction: number; readonly multiplier: number; readonly exception: SpatialException; readonly reason: string };
export type SpatiallyConstrainedEdge = { readonly costedEdge: CostedTransportEdge; readonly impacts: readonly SpatialEdgeImpact[]; readonly hardExcluded: boolean; readonly spatialMultiplier: number; readonly spatialCostSeconds: number };
export type SpatialDiagnostics = { readonly edgeCount: number; readonly polygonCount: number; readonly relationTestCount: number; readonly unaffectedEdgeCount: number; readonly hardExcludedEdgeCount: number; readonly softAffectedEdgeCount: number; readonly bridgeExceptionCount: number; readonly tunnelExceptionCount: number; readonly buildingPassageExceptionCount: number; readonly coveredExceptionCount: number; readonly geometryWarningCount: number; readonly minimumSpatialMultiplier: number; readonly medianSpatialMultiplier: number; readonly maximumSpatialMultiplier: number; readonly averageAffectedFraction: number; readonly evaluationMilliseconds: number };
export type SpatiallyConstrainedNetwork = { readonly graphId: string; readonly profileId: TransportProfileId; readonly nodes: readonly GraphNode[]; readonly edges: readonly SpatiallyConstrainedEdge[]; readonly usableEdges: readonly GraphEdge[]; readonly activeNodeIds: ReadonlySet<string>; readonly diagnostics: SpatialDiagnostics };
export type SegmentPolygonRelation = { readonly relation: SpatialRelation; readonly affectedFraction: number; readonly intersectionPoints: readonly GISPosition[] };

export const DEFAULT_SPATIAL_POLICY: SpatialConstraintPolicy = { buildings: true, water: true, green: false, greenMultiplier: 1.025 };

import type { GISCategory, GISPosition, GISProperties } from "../gis/types";

export type GraphNode = {
  readonly id: string;
  readonly position: GISPosition;
};

export type GraphEdgeProvenance = {
  readonly sourceFeatureId: string;
  readonly sourceCategory: Extract<GISCategory, "road" | "path">;
  readonly sourceProperties: GISProperties;
  readonly sourcePartIndex: number;
  readonly sourceSegmentIndex: number;
};

export type GraphEdge = {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly coordinates: readonly [GISPosition, GISPosition];
  readonly lengthMeters: number;
  readonly provenance: readonly GraphEdgeProvenance[];
};

export type DegreeDistribution = {
  readonly minimum: number;
  readonly maximum: number;
  readonly average: number;
};

export type GraphDiagnostics = {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly isolatedNodeCount: number;
  readonly connectedComponentCount: number;
  readonly largestConnectedComponentNodeCount: number;
  readonly degreeDistribution: DegreeDistribution;
  readonly duplicateEdgesMerged: number;
  readonly selfLoopsRejected: number;
  readonly zeroLengthEdgesRejected: number;
  readonly gradeSeparatedCrossingsIgnored: number;
  readonly collinearOverlapsResolved: number;
  readonly invalidSegmentsRejected: number;
};

export type GraphCleanupMetrics = Pick<
  GraphDiagnostics,
  | "duplicateEdgesMerged"
  | "selfLoopsRejected"
  | "zeroLengthEdgesRejected"
  | "gradeSeparatedCrossingsIgnored"
  | "collinearOverlapsResolved"
  | "invalidSegmentsRejected"
>;

export type TransportGraph = {
  readonly id: string;
  readonly sourceDatasetId: string;
  readonly snapToleranceDegrees: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly diagnostics: GraphDiagnostics;
};

export type GraphBuildOptions = {
  readonly snapToleranceDegrees?: number;
};

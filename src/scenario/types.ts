import type { GraphNode } from "../graph/types";

export type TerminalRole = "source" | "sink";

export type ScenarioTerminal = {
  readonly id: string;
  readonly role: TerminalRole;
  readonly nodeId: string;
  readonly magnitude: number;
};

export type ScenarioEdgeConstraint = {
  readonly id: string;
  readonly edgeId: string;
  readonly blocked: boolean;
  readonly penaltyMultiplier: number;
};

export type EdgeCostModel = { readonly kind: "length-meters" };

export type AnalysisScenario = {
  readonly id: string;
  readonly name: string;
  readonly terminals: readonly ScenarioTerminal[];
  readonly edgeConstraints: readonly ScenarioEdgeConstraint[];
  readonly costModel: EdgeCostModel;
};

export type ScenarioValidationCode =
  | "missing-source"
  | "missing-sink"
  | "duplicate-terminal"
  | "unknown-node"
  | "invalid-terminal-magnitude"
  | "same-source-sink"
  | "duplicate-edge-constraint"
  | "unknown-edge"
  | "invalid-penalty"
  | "terminals-disconnected"
  | "constraints-disconnect-terminals";

export type ScenarioValidationIssue = { readonly code: ScenarioValidationCode; readonly message: string };

export type ScenarioValidation = {
  readonly valid: boolean;
  readonly issues: readonly ScenarioValidationIssue[];
  readonly sourceSinkConnectedOnGraph: boolean | null;
  readonly sourceSinkConnectedAfterConstraints: boolean | null;
  readonly activeEdgeCount: number;
  readonly blockedEdgeCount: number;
  readonly penalizedEdgeCount: number;
};

export type PreparedEdge = {
  readonly graphEdgeId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly lengthMeters: number;
  readonly penaltyMultiplier: number;
  readonly effectiveCost: number;
};

export type PreparedNetwork = {
  readonly graphId: string;
  readonly scenarioId: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly PreparedEdge[];
  readonly terminals: readonly ScenarioTerminal[];
  readonly activeEdgeCount: number;
  readonly blockedEdgeCount: number;
  readonly sourceSinkConnected: true;
};

export type PreparedNetworkResult = {
  readonly network: PreparedNetwork | null;
  readonly validation: ScenarioValidation;
};

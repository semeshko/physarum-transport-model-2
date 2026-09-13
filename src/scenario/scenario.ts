import type { AnalysisScenario, ScenarioEdgeConstraint, ScenarioTerminal, TerminalRole } from "./types";

export const DEFAULT_TERMINAL_MAGNITUDE = 1;

export function createEmptyScenario(id = "scenario-1", name = "Untitled scenario"): AnalysisScenario {
  return { id, name, terminals: [], edgeConstraints: [], costModel: { kind: "length-meters" } };
}

export function setTerminal(scenario: AnalysisScenario, role: TerminalRole, nodeId: string, magnitude = DEFAULT_TERMINAL_MAGNITUDE): AnalysisScenario {
  const terminal: ScenarioTerminal = { id: `${scenario.id}-${role}-1`, role, nodeId, magnitude };
  return { ...scenario, terminals: [...scenario.terminals.filter((item) => item.role !== role), terminal] };
}

export function toggleBlockedEdge(scenario: AnalysisScenario, edgeId: string): AnalysisScenario {
  const existing = scenario.edgeConstraints.find((constraint) => constraint.edgeId === edgeId);
  const blocked = !(existing?.blocked ?? false);
  return updateConstraint(scenario, edgeId, blocked, existing?.penaltyMultiplier ?? 1);
}

export function setEdgePenalty(scenario: AnalysisScenario, edgeId: string, penaltyMultiplier: number): AnalysisScenario {
  const existing = scenario.edgeConstraints.find((constraint) => constraint.edgeId === edgeId);
  return updateConstraint(scenario, edgeId, existing?.blocked ?? false, penaltyMultiplier);
}

function updateConstraint(scenario: AnalysisScenario, edgeId: string, blocked: boolean, penaltyMultiplier: number): AnalysisScenario {
  const remaining = scenario.edgeConstraints.filter((constraint) => constraint.edgeId !== edgeId);
  if (!blocked && penaltyMultiplier === 1) return { ...scenario, edgeConstraints: remaining };
  const constraint: ScenarioEdgeConstraint = { id: `${scenario.id}-edge-${edgeId}`, edgeId, blocked, penaltyMultiplier };
  return { ...scenario, edgeConstraints: [...remaining, constraint] };
}

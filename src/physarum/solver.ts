import type { PreparedNetwork } from "../scenario/types";
import { solveHydraulics } from "./hydraulics";
import { resolvePhysarumParameters } from "./parameters";
import type { HydraulicSolution, PhysarumParameters, PhysarumState } from "./types";
import { PhysarumSolverError } from "./types";

function updateConductivities(
  network: PreparedNetwork,
  current: Readonly<Record<string, number>>,
  hydraulic: HydraulicSolution,
  parameters: PhysarumParameters,
): { conductivities: Record<string, number>; maxDeltaD: number } {
  const conductivities: Record<string, number> = {};
  let maxDeltaD = 0;
  for (const edge of network.edges) {
    const id = edge.graphEdgeId;
    const absoluteFlow = Math.abs(hydraulic.flows[id]);
    const hillResponse = absoluteFlow === 0 ? 0 : 1 / (1 + (parameters.hillK / absoluteFlow) ** parameters.hillExponent);
    const adaptation = parameters.adaptationRate * hillResponse - parameters.decayRate * current[id];
    const next = Math.max(parameters.minimumConductivity, current[id] + parameters.timeStep * adaptation);
    if (!Number.isFinite(next) || next <= 0) throw new PhysarumSolverError("numeric-failure", `Edge ${id} produced invalid conductivity.`);
    conductivities[id] = next;
    maxDeltaD = Math.max(maxDeltaD, Math.abs(next - current[id]));
  }
  return { conductivities, maxDeltaD };
}

function createState(network: PreparedNetwork, iteration: number, conductivities: Readonly<Record<string, number>>, hydraulic: HydraulicSolution, maxDeltaD: number, converged: boolean, terminationReason: PhysarumState["terminationReason"]): PhysarumState {
  return {
    networkGraphId: network.graphId,
    scenarioId: network.scenarioId,
    iteration,
    nodePressures: { ...hydraulic.pressures },
    edgeConductivities: { ...conductivities },
    edgeFlows: { ...hydraulic.flows },
    diagnostics: { iteration, maxDeltaD, totalAbsoluteFlow: hydraulic.totalAbsoluteFlow, sourceFlowBalanceError: hydraulic.sourceFlowBalanceError, sinkFlowBalanceError: hydraulic.sinkFlowBalanceError, maximumKirchhoffResidual: hydraulic.maximumKirchhoffResidual },
    converged,
    terminationReason,
    error: null,
  };
}

function numericFailureState(network: PreparedNetwork, iteration: number, conductivities: Readonly<Record<string, number>>, error: unknown): PhysarumState {
  return {
    networkGraphId: network.graphId,
    scenarioId: network.scenarioId,
    iteration,
    nodePressures: {},
    edgeConductivities: { ...conductivities },
    edgeFlows: {},
    diagnostics: { iteration, maxDeltaD: 0, totalAbsoluteFlow: 0, sourceFlowBalanceError: 0, sinkFlowBalanceError: 0, maximumKirchhoffResidual: 0 },
    converged: false,
    terminationReason: "numericFailure",
    error: error instanceof Error ? error.message : "Unknown numeric failure.",
  };
}

export function runPhysarum(network: PreparedNetwork, parameterOverrides: Partial<PhysarumParameters> = {}): PhysarumState {
  const parameters = resolvePhysarumParameters(parameterOverrides);
  let conductivities = Object.fromEntries(network.edges.map((edge) => [edge.graphEdgeId, parameters.initialConductivity])) as Record<string, number>;
  let lastDelta = 0;
  for (let iteration = 1; iteration <= parameters.maxIterations; iteration += 1) {
    try {
      const hydraulic = solveHydraulics(network, conductivities);
      const updated = updateConductivities(network, conductivities, hydraulic, parameters);
      conductivities = updated.conductivities;
      lastDelta = updated.maxDeltaD;
      if (lastDelta < parameters.convergenceTolerance) {
        const finalHydraulic = solveHydraulics(network, conductivities);
        return createState(network, iteration, conductivities, finalHydraulic, lastDelta, true, "converged");
      }
    } catch (error) {
      return numericFailureState(network, iteration, conductivities, error);
    }
  }
  try {
    const hydraulic = solveHydraulics(network, conductivities);
    return createState(network, parameters.maxIterations, conductivities, hydraulic, lastDelta, false, "maxIterations");
  } catch (error) {
    return numericFailureState(network, parameters.maxIterations, conductivities, error);
  }
}

import type { PreparedNetwork } from "../scenario/types";
import { demandReferenceMagnitude } from "./demand";
import { solveHydraulics } from "./hydraulics";
import { resolvePhysarumParameters } from "./parameters";
import type { HydraulicSolution, PhysarumParameters, PhysarumScaleInfo, PhysarumSimulation, PhysarumState, PressureSolverOptions } from "./types";
import { PhysarumSolverError } from "./types";

/** Resolves which Hill-threshold regime a run actually used. Explicit and
 * inspectable on every PhysarumState (Task 17: "no hidden automatic
 * normalization" - a report must state its scale mode, Qref, and the K it
 * actually applied so the run can be reproduced from the report alone). */
function resolveScaleInfo(network: PreparedNetwork, parameters: PhysarumParameters): PhysarumScaleInfo {
  if (parameters.demandScaleKappa === undefined) {
    return { mode: "absolute", qRef: 0, effectiveHillK: parameters.hillK };
  }
  const qRef = demandReferenceMagnitude(network);
  const effectiveHillK = qRef > 0 ? parameters.demandScaleKappa * qRef : parameters.hillK;
  return { mode: "demandNormalized", qRef, effectiveHillK };
}

function updateConductivities(
  network: PreparedNetwork,
  current: Readonly<Record<string, number>>,
  hydraulic: HydraulicSolution,
  parameters: PhysarumParameters,
  scale: PhysarumScaleInfo,
): { conductivities: Record<string, number>; maxDeltaD: number } {
  const conductivities: Record<string, number> = {};
  let maxDeltaD = 0;
  for (const edge of network.edges) {
    const id = edge.graphEdgeId;
    const absoluteFlow = Math.abs(hydraulic.flows[id]);
    const hillResponse = absoluteFlow === 0 ? 0 : 1 / (1 + (scale.effectiveHillK / absoluteFlow) ** parameters.hillExponent);
    const adaptation = parameters.adaptationRate * hillResponse - parameters.decayRate * current[id];
    const next = Math.max(parameters.minimumConductivity, current[id] + parameters.timeStep * adaptation);
    if (!Number.isFinite(next) || next <= 0) throw new PhysarumSolverError("numeric-failure", `Edge ${id} produced invalid conductivity.`);
    conductivities[id] = next;
    maxDeltaD = Math.max(maxDeltaD, Math.abs(next - current[id]));
  }
  return { conductivities, maxDeltaD };
}

function createState(network: PreparedNetwork, iteration: number, conductivities: Readonly<Record<string, number>>, hydraulic: HydraulicSolution, maxDeltaD: number, converged: boolean, terminationReason: PhysarumState["terminationReason"], scale: PhysarumScaleInfo): PhysarumState {
  return {
    networkGraphId: network.graphId,
    scenarioId: network.scenarioId,
    iteration,
    nodePressures: { ...hydraulic.pressures },
    edgeConductivities: { ...conductivities },
    edgeFlows: { ...hydraulic.flows },
    diagnostics: { iteration, maxDeltaD, totalAbsoluteFlow: hydraulic.totalAbsoluteFlow, sourceFlowBalanceError: hydraulic.sourceFlowBalanceError, sinkFlowBalanceError: hydraulic.sinkFlowBalanceError, maximumKirchhoffResidual: hydraulic.maximumKirchhoffResidual, linearSolve: hydraulic.linearSolve },
    scale,
    converged,
    terminationReason,
    error: null,
  };
}

function initialState(network: PreparedNetwork, parameters: PhysarumParameters, scale: PhysarumScaleInfo): PhysarumState {
  return {
    networkGraphId: network.graphId,
    scenarioId: network.scenarioId,
    iteration: 0,
    nodePressures: {},
    edgeConductivities: Object.fromEntries(network.edges.map((edge) => [edge.graphEdgeId, parameters.initialConductivity])),
    edgeFlows: {},
    diagnostics: { iteration: 0, maxDeltaD: 0, totalAbsoluteFlow: 0, sourceFlowBalanceError: 0, sinkFlowBalanceError: 0, maximumKirchhoffResidual: 0, linearSolve: null },
    scale,
    converged: false,
    terminationReason: null,
    error: null,
  };
}

function numericFailureState(network: PreparedNetwork, iteration: number, conductivities: Readonly<Record<string, number>>, error: unknown, scale: PhysarumScaleInfo): PhysarumState {
  return {
    networkGraphId: network.graphId,
    scenarioId: network.scenarioId,
    iteration,
    nodePressures: {},
    edgeConductivities: { ...conductivities },
    edgeFlows: {},
    diagnostics: { iteration, maxDeltaD: 0, totalAbsoluteFlow: 0, sourceFlowBalanceError: 0, sinkFlowBalanceError: 0, maximumKirchhoffResidual: 0, linearSolve: null },
    scale,
    converged: false,
    terminationReason: "numericFailure",
    error: error instanceof Error ? error.message : "Unknown numeric failure.",
  };
}

export function initializePhysarum(network: PreparedNetwork, parameterOverrides: Partial<PhysarumParameters> = {}, pressureSolver: PressureSolverOptions = {}): PhysarumSimulation {
  const parameters = resolvePhysarumParameters(parameterOverrides);
  const scale = resolveScaleInfo(network, parameters);
  return { parameters, pressureSolver, state: initialState(network, parameters, scale) };
}

export function stepPhysarum(network: PreparedNetwork, simulation: PhysarumSimulation): PhysarumSimulation {
  if (simulation.state.terminationReason !== null) return simulation;
  const iteration = simulation.state.iteration + 1;
  const scale = simulation.state.scale;
  try {
    const hydraulic = solveHydraulics(network, simulation.state.edgeConductivities, { ...simulation.pressureSolver, initialPressures: simulation.state.nodePressures });
    const updated = updateConductivities(network, simulation.state.edgeConductivities, hydraulic, simulation.parameters, scale);
    const finalHydraulic = solveHydraulics(network, updated.conductivities, { ...simulation.pressureSolver, initialPressures: hydraulic.pressures });
    const converged = updated.maxDeltaD < simulation.parameters.convergenceTolerance;
    const reachedLimit = iteration >= simulation.parameters.maxIterations;
    const terminationReason = converged ? "converged" : reachedLimit ? "maxIterations" : null;
    return { parameters: simulation.parameters, pressureSolver: simulation.pressureSolver, state: createState(network, iteration, updated.conductivities, finalHydraulic, updated.maxDeltaD, converged, terminationReason, scale) };
  } catch (error) {
    return { parameters: simulation.parameters, pressureSolver: simulation.pressureSolver, state: numericFailureState(network, iteration, simulation.state.edgeConductivities, error, scale) };
  }
}

export function runPhysarum(network: PreparedNetwork, parameterOverrides: Partial<PhysarumParameters> = {}, pressureSolver: PressureSolverOptions = {}): PhysarumState {
  let simulation = initializePhysarum(network, parameterOverrides, pressureSolver);
  while (simulation.state.terminationReason === null) simulation = stepPhysarum(network, simulation);
  return simulation.state;
}

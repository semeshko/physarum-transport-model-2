import type { PreparedNetwork } from "../scenario/types";
import { solveHydraulics } from "../physarum/hydraulics";
import type { PressureSolverOptions } from "../physarum/types";

/**
 * Continuum adaptation for Design Mode (Hu-Cai / Haskovec-Markowich-Zampini):
 *
 *   -div((c + r) grad u) = S
 *   dc/dt = |grad u|^2 - nu * c^(gamma - 1)
 *   E[c]  = integral (c + r)|grad u|^2 + (nu/gamma) c^gamma
 *
 * `c` is a conductivity DENSITY, not a tube size; the mesh geometry lives in
 * the network's effectiveCost = l_e / w_e. Selected in Task 18 Gate E over the
 * DMK alternative because DMK at beta=1 saturates against physical cost
 * (doubling a corridor's resistance moved its flux share by 1.6 points, versus
 * 12 for this law), and over the project's own Hill law because a Hill
 * response needs a reference scale that no continuum quantity supplies.
 */
export type DesignAdaptationParameters = {
  /** Metabolic exponent. gamma > 1 gives the p-Laplacian steady state with p = 2*gamma/(gamma-1). */
  readonly gamma: number;
  /** Metabolic coefficient; sets the magnitude of c, not the spatial pattern. */
  readonly nu: number;
  /** Background conductivity keeping the elliptic operator non-degenerate. */
  readonly backgroundConductivity: number;
  readonly initialConductivity: number;
  /** Validated in Gate F: dt = 0.5 converges in ~100 steps; dt = 2 diverges. */
  readonly timeStep: number;
  readonly maxIterations: number;
  readonly convergenceTolerance: number;
  readonly minimumConductivity: number;
};

export const DEFAULT_DESIGN_ADAPTATION: DesignAdaptationParameters = {
  gamma: 1.5,
  nu: 1,
  backgroundConductivity: 1e-3,
  initialConductivity: 1,
  timeStep: 0.5,
  maxIterations: 1_000,
  convergenceTolerance: 1e-7,
  minimumConductivity: 1e-9,
};

export type DesignFieldDiagnostics = {
  readonly iteration: number;
  readonly converged: boolean;
  readonly terminationReason: "converged" | "maxIterations" | "numericFailure";
  readonly maxDelta: number;
  readonly energy: number;
  readonly energyMonotone: boolean;
  readonly maximumKirchhoffResidual: number;
};

export type DesignFieldState = {
  /** Conductivity density per candidate edge. */
  readonly conductivity: Readonly<Record<string, number>>;
  readonly edgeFlows: Readonly<Record<string, number>>;
  readonly nodePressures: Readonly<Record<string, number>>;
  /** Flux density j_e = Q_e / w_e — the mesh-independent physical quantity. */
  readonly fluxDensity: Readonly<Record<string, number>>;
  readonly diagnostics: DesignFieldDiagnostics;
  readonly error: string | null;
};

export function resolveDesignAdaptation(overrides: Partial<DesignAdaptationParameters> = {}): DesignAdaptationParameters {
  const parameters = { ...DEFAULT_DESIGN_ADAPTATION, ...overrides };
  for (const key of ["gamma", "nu", "backgroundConductivity", "initialConductivity", "timeStep", "convergenceTolerance", "minimumConductivity"] as const) {
    if (!Number.isFinite(parameters[key]) || parameters[key] <= 0) throw new Error(`Design adaptation ${key} must be finite and positive.`);
  }
  if (parameters.gamma <= 1) throw new Error("Design adaptation gamma must exceed 1 (p = 2*gamma/(gamma-1) requires gamma > 1).");
  if (!Number.isInteger(parameters.maxIterations) || parameters.maxIterations <= 0) throw new Error("Design adaptation maxIterations must be a positive integer.");
  return parameters;
}

/**
 * One semi-implicit (IMEX) step. The stiff metabolic term is linearised as
 * nu*c*(c^n)^(gamma-2) and taken implicitly:
 *
 *   c^(n+1) = (c^n + dt|grad u|^2) / (1 + dt*nu*(c^n)^(gamma-2))
 *
 * Unconditionally positive and needs no nonlinear solve. Gate F measured this
 * converging in 93 steps with monotone energy where explicit Euler failed to
 * converge in 4000 and lost monotonicity.
 */
export function stepDesignField(
  network: PreparedNetwork,
  conductivity: Readonly<Record<string, number>>,
  parameters: DesignAdaptationParameters,
  pressureSolver: PressureSolverOptions = {},
): { conductivity: Record<string, number>; maxDelta: number; energy: number; pressures: Readonly<Record<string, number>>; flows: Readonly<Record<string, number>>; kirchhoff: number } {
  const hydraulic = solveHydraulics(network, Object.fromEntries(network.edges.map((edge) => [edge.graphEdgeId, conductivity[edge.graphEdgeId] + parameters.backgroundConductivity])), pressureSolver);
  const next: Record<string, number> = {};
  let maxDelta = 0, energy = 0;
  for (const edge of network.edges) {
    const id = edge.graphEdgeId;
    const current = Math.max(conductivity[id], parameters.minimumConductivity);
    // effectiveCost = l_e / w_e, so w_e * effectiveCost = l_e and the cell measure is w_e * l_e.
    const length = edge.lengthMeters;
    const gradient = Math.abs(hydraulic.pressures[edge.fromNodeId] - hydraulic.pressures[edge.toNodeId]) / length;
    const cellMeasure = (length / edge.effectiveCost) * length;
    energy += cellMeasure * ((current + parameters.backgroundConductivity) * gradient * gradient + (parameters.nu / parameters.gamma) * current ** parameters.gamma);
    const value = Math.max(parameters.minimumConductivity, (current + parameters.timeStep * gradient * gradient) / (1 + parameters.timeStep * parameters.nu * current ** (parameters.gamma - 2)));
    if (!Number.isFinite(value)) throw new Error(`Candidate edge ${id} produced a non-finite conductivity.`);
    next[id] = value;
    maxDelta = Math.max(maxDelta, Math.abs(value - current));
  }
  return { conductivity: next, maxDelta, energy, pressures: hydraulic.pressures, flows: hydraulic.flows, kirchhoff: hydraulic.maximumKirchhoffResidual };
}

export function runDesignField(network: PreparedNetwork, overrides: Partial<DesignAdaptationParameters> = {}, pressureSolver: PressureSolverOptions = {}): DesignFieldState {
  const parameters = resolveDesignAdaptation(overrides);
  const widthById = new Map(network.edges.map((edge) => [edge.graphEdgeId, edge.lengthMeters / edge.effectiveCost]));
  let conductivity: Record<string, number> = Object.fromEntries(network.edges.map((edge) => [edge.graphEdgeId, parameters.initialConductivity]));
  let pressures: Readonly<Record<string, number>> = {}, flows: Readonly<Record<string, number>> = {};
  let iteration = 0, maxDelta = Number.POSITIVE_INFINITY, energy = Number.NaN, kirchhoff = 0;
  let previousEnergy = Number.POSITIVE_INFINITY, energyMonotone = true, converged = false;

  try {
    for (; iteration < parameters.maxIterations; iteration += 1) {
      const step = stepDesignField(network, conductivity, parameters, pressureSolver);
      conductivity = step.conductivity;
      pressures = step.pressures;
      flows = step.flows;
      maxDelta = step.maxDelta;
      energy = step.energy;
      kirchhoff = step.kirchhoff;
      if (energy > previousEnergy + 1e-12) energyMonotone = false;
      previousEnergy = energy;
      if (maxDelta < parameters.convergenceTolerance) { iteration += 1; converged = true; break; }
    }
  } catch (error) {
    return {
      conductivity, edgeFlows: flows, nodePressures: pressures, fluxDensity: {},
      diagnostics: { iteration, converged: false, terminationReason: "numericFailure", maxDelta, energy, energyMonotone, maximumKirchhoffResidual: kirchhoff },
      error: error instanceof Error ? error.message : "Unknown design adaptation failure.",
    };
  }

  const fluxDensity = Object.fromEntries(network.edges.map((edge) => [edge.graphEdgeId, Math.abs(flows[edge.graphEdgeId] ?? 0) / widthById.get(edge.graphEdgeId)!]));
  return {
    conductivity, edgeFlows: flows, nodePressures: pressures, fluxDensity,
    diagnostics: { iteration, converged, terminationReason: converged ? "converged" : "maxIterations", maxDelta, energy, energyMonotone, maximumKirchhoffResidual: kirchhoff },
    error: null,
  };
}

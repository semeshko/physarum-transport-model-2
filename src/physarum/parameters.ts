import type { PhysarumParameters } from "./types";
import { PhysarumSolverError } from "./types";

export const DEFAULT_PHYSARUM_PARAMETERS: PhysarumParameters = {
  initialConductivity: 1,
  adaptationRate: 1,
  decayRate: 1,
  hillK: 1,
  hillExponent: 2,
  timeStep: 0.2,
  maxIterations: 250,
  convergenceTolerance: 1e-6,
  minimumConductivity: 1e-6,
};

export function resolvePhysarumParameters(overrides: Partial<PhysarumParameters> = {}): PhysarumParameters {
  const parameters = { ...DEFAULT_PHYSARUM_PARAMETERS, ...overrides };
  const positive: Array<keyof PhysarumParameters> = ["initialConductivity", "adaptationRate", "decayRate", "hillK", "hillExponent", "timeStep", "convergenceTolerance", "minimumConductivity"];
  for (const key of positive) if (!Number.isFinite(parameters[key]) || parameters[key] <= 0) throw new PhysarumSolverError("invalid-parameters", `${key} must be finite and positive.`);
  if (!Number.isInteger(parameters.maxIterations) || parameters.maxIterations <= 0) throw new PhysarumSolverError("invalid-parameters", "maxIterations must be a positive integer.");
  return parameters;
}

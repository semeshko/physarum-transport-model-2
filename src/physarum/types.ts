import type { PreparedNetwork } from "../scenario/types";

export type PhysarumParameters = {
  readonly initialConductivity: number;
  readonly adaptationRate: number;
  readonly decayRate: number;
  readonly hillK: number;
  readonly hillExponent: number;
  readonly timeStep: number;
  readonly maxIterations: number;
  readonly convergenceTolerance: number;
  readonly minimumConductivity: number;
};

export type PhysarumTerminationReason = "converged" | "maxIterations" | "numericFailure";

export type LinearSolveDiagnostics = { readonly method: "dense" | "conjugate-gradient"; readonly iterations: number; readonly converged: boolean; readonly residualNorm: number; readonly tolerance: number; readonly failureReason: string | null };
export type PressureSolverOptions = { readonly method?: "dense" | "conjugate-gradient"; readonly relativeTolerance?: number; readonly absoluteTolerance?: number; readonly maxIterations?: number; readonly initialPressures?: Readonly<Record<string, number>> };

export type PhysarumDiagnostics = {
  readonly iteration: number;
  readonly maxDeltaD: number;
  readonly totalAbsoluteFlow: number;
  readonly sourceFlowBalanceError: number;
  readonly sinkFlowBalanceError: number;
  readonly maximumKirchhoffResidual: number;
  readonly linearSolve: LinearSolveDiagnostics | null;
};

export type PhysarumState = {
  readonly networkGraphId: string;
  readonly scenarioId: string;
  readonly iteration: number;
  readonly nodePressures: Readonly<Record<string, number>>;
  readonly edgeConductivities: Readonly<Record<string, number>>;
  readonly edgeFlows: Readonly<Record<string, number>>;
  readonly diagnostics: PhysarumDiagnostics;
  readonly converged: boolean;
  readonly terminationReason: PhysarumTerminationReason | null;
  readonly error: string | null;
};

export type PhysarumSimulation = {
  readonly parameters: PhysarumParameters;
  readonly pressureSolver: PressureSolverOptions;
  readonly state: PhysarumState;
};

export type HydraulicSolution = {
  readonly pressures: Readonly<Record<string, number>>;
  readonly flows: Readonly<Record<string, number>>;
  readonly injections: Readonly<Record<string, number>>;
  readonly maximumKirchhoffResidual: number;
  readonly sourceFlowBalanceError: number;
  readonly sinkFlowBalanceError: number;
  readonly totalAbsoluteFlow: number;
  readonly linearSolve: LinearSolveDiagnostics;
};

export type PhysarumRunInput = { readonly network: PreparedNetwork; readonly parameters?: Partial<PhysarumParameters> };

export class PhysarumSolverError extends Error {
  constructor(readonly code: "invalid-parameters" | "invalid-network" | "unbalanced-terminals" | "singular-system" | "numeric-failure", message: string) {
    super(message);
    this.name = "PhysarumSolverError";
  }
}

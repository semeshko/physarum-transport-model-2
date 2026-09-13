import { solveDenseLinearSystem } from "./linear-system";
import type { LinearSolveDiagnostics, PressureSolverOptions } from "./types";
import { PhysarumSolverError } from "./types";

export type SparseLaplacianEdge = { readonly from: number | null; readonly to: number | null; readonly conductance: number };
export type SparseLaplacianSystem = { readonly size: number; readonly edges: readonly SparseLaplacianEdge[]; readonly diagonal: readonly number[]; readonly vector: readonly number[] };
export type PressureSolveResult = { readonly solution: readonly number[]; readonly diagnostics: LinearSolveDiagnostics };

const DEFAULT_RELATIVE_TOLERANCE = 1e-10;
const DEFAULT_ABSOLUTE_TOLERANCE = 1e-12;

function dot(first: readonly number[], second: readonly number[]): number { return first.reduce((sum, value, index) => sum + value * second[index], 0); }
function norm(values: readonly number[]): number { return Math.sqrt(dot(values, values)); }

export function multiplySparseLaplacian(system: SparseLaplacianSystem, vector: readonly number[]): number[] {
  const result = Array<number>(system.size).fill(0);
  for (const edge of system.edges) {
    const fromValue = edge.from === null ? 0 : vector[edge.from];
    const toValue = edge.to === null ? 0 : vector[edge.to];
    const contribution = edge.conductance * (fromValue - toValue);
    if (edge.from !== null) result[edge.from] += contribution;
    if (edge.to !== null) result[edge.to] -= contribution;
  }
  return result;
}

function validatedOptions(system: SparseLaplacianSystem, options: PressureSolverOptions) {
  const relativeTolerance = options.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const absoluteTolerance = options.absoluteTolerance ?? DEFAULT_ABSOLUTE_TOLERANCE;
  const maxIterations = options.maxIterations ?? Math.max(100, system.size * 4);
  if (!Number.isFinite(relativeTolerance) || relativeTolerance <= 0 || !Number.isFinite(absoluteTolerance) || absoluteTolerance <= 0 || !Number.isInteger(maxIterations) || maxIterations <= 0) throw new PhysarumSolverError("invalid-parameters", "Pressure solver tolerances and iteration limit are invalid.");
  return { tolerance: absoluteTolerance + relativeTolerance * norm(system.vector), maxIterations };
}

export function solveConjugateGradient(system: SparseLaplacianSystem, options: PressureSolverOptions = {}, initialGuess?: readonly number[]): PressureSolveResult {
  const { tolerance, maxIterations } = validatedOptions(system, options);
  if (system.size === 0) return { solution: [], diagnostics: { method: "conjugate-gradient", iterations: 0, converged: true, residualNorm: 0, tolerance, failureReason: null } };
  if (system.diagonal.some((value) => !Number.isFinite(value) || value <= 0)) throw new PhysarumSolverError("singular-system", "Sparse Laplacian has a non-positive diagonal.");
  let solution = initialGuess ? [...initialGuess] : Array<number>(system.size).fill(0);
  if (solution.length !== system.size || solution.some((value) => !Number.isFinite(value))) throw new PhysarumSolverError("invalid-network", "CG initial pressure guess is invalid.");
  const initialProduct = multiplySparseLaplacian(system, solution);
  let residual = system.vector.map((value, index) => value - initialProduct[index]);
  let residualNorm = norm(residual);
  if (residualNorm <= tolerance) return { solution, diagnostics: { method: "conjugate-gradient", iterations: 0, converged: true, residualNorm, tolerance, failureReason: null } };
  let preconditioned = residual.map((value, index) => value / system.diagonal[index]);
  let direction = [...preconditioned];
  let residualProduct = dot(residual, preconditioned);
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const matrixDirection = multiplySparseLaplacian(system, direction);
    const denominator = dot(direction, matrixDirection);
    if (!Number.isFinite(denominator) || denominator <= 0 || !Number.isFinite(residualProduct) || residualProduct <= 0) throw new PhysarumSolverError("singular-system", "Conjugate Gradient encountered a non-SPD breakdown.");
    const scale = residualProduct / denominator;
    solution = solution.map((value, index) => value + scale * direction[index]);
    residual = residual.map((value, index) => value - scale * matrixDirection[index]);
    residualNorm = norm(residual);
    if (!Number.isFinite(residualNorm) || solution.some((value) => !Number.isFinite(value))) throw new PhysarumSolverError("numeric-failure", "Conjugate Gradient produced non-finite values.");
    if (residualNorm <= tolerance) return { solution, diagnostics: { method: "conjugate-gradient", iterations: iteration, converged: true, residualNorm, tolerance, failureReason: null } };
    preconditioned = residual.map((value, index) => value / system.diagonal[index]);
    const nextResidualProduct = dot(residual, preconditioned);
    direction = preconditioned.map((value, index) => value + (nextResidualProduct / residualProduct) * direction[index]);
    residualProduct = nextResidualProduct;
  }
  throw new PhysarumSolverError("numeric-failure", `Conjugate Gradient did not converge within ${maxIterations} iterations (residual ${residualNorm}).`);
}

export function solveDenseReference(system: SparseLaplacianSystem, options: PressureSolverOptions = {}): PressureSolveResult {
  const { tolerance } = validatedOptions(system, options);
  if (system.size === 0) return { solution: [], diagnostics: { method: "dense", iterations: 0, converged: true, residualNorm: 0, tolerance, failureReason: null } };
  const matrix = Array.from({ length: system.size }, () => Array<number>(system.size).fill(0));
  for (const edge of system.edges) {
    if (edge.from !== null) matrix[edge.from][edge.from] += edge.conductance;
    if (edge.to !== null) matrix[edge.to][edge.to] += edge.conductance;
    if (edge.from !== null && edge.to !== null) { matrix[edge.from][edge.to] -= edge.conductance; matrix[edge.to][edge.from] -= edge.conductance; }
  }
  const solution = solveDenseLinearSystem(matrix, system.vector);
  const product = multiplySparseLaplacian(system, solution);
  const residualNorm = norm(system.vector.map((value, index) => value - product[index]));
  return { solution, diagnostics: { method: "dense", iterations: system.size, converged: residualNorm <= tolerance, residualNorm, tolerance, failureReason: residualNorm <= tolerance ? null : "Dense residual exceeded tolerance." } };
}

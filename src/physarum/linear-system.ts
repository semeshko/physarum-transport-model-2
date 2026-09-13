import { PhysarumSolverError } from "./types";

const PIVOT_TOLERANCE = 1e-12;

export function solveDenseLinearSystem(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  const size = vector.length;
  if (matrix.length !== size || matrix.some((row) => row.length !== size)) throw new PhysarumSolverError("invalid-network", "Pressure matrix dimensions are inconsistent.");
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    if (!Number.isFinite(augmented[pivotRow][column]) || Math.abs(augmented[pivotRow][column]) < PIVOT_TOLERANCE) throw new PhysarumSolverError("singular-system", "The reduced pressure system is singular or numerically unstable.");
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / augmented[column][column];
      for (let entry = column; entry <= size; entry += 1) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }
  const solution = Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let remainder = augmented[row][size];
    for (let column = row + 1; column < size; column += 1) remainder -= augmented[row][column] * solution[column];
    solution[row] = remainder / augmented[row][row];
    if (!Number.isFinite(solution[row])) throw new PhysarumSolverError("numeric-failure", "Pressure solution contains a non-finite value.");
  }
  return solution;
}

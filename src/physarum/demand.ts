import type { PreparedNetwork } from "../scenario/types";

/**
 * Q_ref = sum of positive source-terminal magnitudes.
 *
 * Task 16 found that the legacy Hill threshold `hillK` is compared directly
 * against absolute edge flow, so uniformly scaling every terminal's demand
 * changes network structure even though nothing about the city changed —
 * only the arbitrary units of `magnitude`. Q_ref gives demand-normalized
 * mode (see `demandScaleKappa` in PhysarumParameters) a scale to measure
 * flow against instead of a fixed absolute constant.
 */
export function demandReferenceMagnitude(network: PreparedNetwork): number {
  return network.terminals
    .filter((terminal) => terminal.role === "source")
    .reduce((sum, terminal) => sum + Math.max(0, terminal.magnitude), 0);
}

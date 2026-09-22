import type { PreparedNetwork } from "../scenario/types";
import type { DesignFieldState } from "./adaptation";
import type { DesignCandidateNetwork } from "./types";

/**
 * Mesh-independent measurement of a Design field.
 *
 * Every quantity here is defined in the local metric plane in METRES, on bins
 * that are fixed physical intervals rather than mesh elements. Edge-level
 * statistics (bright-edge counts, active-edge fractions, median edge
 * conductivity) are deliberately absent: they change with h even when the
 * underlying physical field does not, so they cannot compare resolutions or
 * rotations.
 */

export type MetricVector = readonly [number, number];

const subtract = (a: MetricVector, b: MetricVector): MetricVector => [a[0] - b[0], a[1] - b[1]];
const dot = (a: MetricVector, b: MetricVector): number => a[0] * b[0] + a[1] * b[1];

/** Frame whose first axis runs source centre -> sink centre. */
export type AxisFrame = {
  readonly origin: MetricVector;
  readonly along: MetricVector;
  readonly normal: MetricVector;
  readonly separationMeters: number;
};

export function createAxisFrame(sourceCentre: MetricVector, sinkCentre: MetricVector): AxisFrame {
  const delta = subtract(sinkCentre, sourceCentre);
  const separationMeters = Math.hypot(delta[0], delta[1]);
  if (!(separationMeters > 0)) throw new Error("Source and sink centres must be distinct to define a measurement axis.");
  const along: MetricVector = [delta[0] / separationMeters, delta[1] / separationMeters];
  return { origin: sourceCentre, along, normal: [-along[1], along[0]], separationMeters };
}

/** Fixed physical bins in the cross-axis coordinate, shared by every run. */
export type PhysicalBins = {
  readonly halfWidthMeters: number;
  readonly binWidthMeters: number;
  readonly centres: readonly number[];
};

export function createPhysicalBins(halfWidthMeters: number, binWidthMeters: number): PhysicalBins {
  if (!(halfWidthMeters > 0) || !(binWidthMeters > 0)) throw new Error("Physical bin geometry must be positive.");
  const count = Math.round((2 * halfWidthMeters) / binWidthMeters);
  if (count < 2) throw new Error("Physical binning needs at least two bins.");
  const centres = Array.from({ length: count }, (_, i) => -halfWidthMeters + (i + 0.5) * binWidthMeters);
  return { halfWidthMeters, binWidthMeters, centres };
}

export type CrossSection = {
  readonly fraction: number;
  readonly alongMeters: number;
  /** Normalized |axial flux| per fixed physical bin; sums to 1 (or is all zero). */
  readonly density: readonly number[];
  /** Signed axial flux through the plane — equals total demand when conservation holds. */
  readonly netAxialFlux: number;
  readonly absoluteAxialFlux: number;
  /** net / absolute: 1 means every crossing edge carries flow down-axis. */
  readonly coherence: number;
  /** Share of |axial flux| that fell inside the bin window rather than outside it. */
  readonly capturedShare: number;
  readonly crossingEdgeCount: number;
};

/**
 * Flux crossing a plane perpendicular to the axis at `fraction` of the
 * source-sink separation.
 *
 * An edge contributes `Q_e * (e_hat . along)` — the axial component of its
 * flow — at the point where it pierces the plane. Summing the signed
 * contributions reproduces the total demand, which is the conservation check
 * this measurement rests on. The half-open crossing test counts each edge at
 * most once even when a node lies exactly on the plane.
 */
export function crossSectionFluxProfile(
  mesh: DesignCandidateNetwork,
  state: DesignFieldState,
  frame: AxisFrame,
  fraction: number,
  bins: PhysicalBins,
): CrossSection {
  const metricById = new Map(mesh.nodes.map((node) => [node.id, node.metric as MetricVector]));
  const alongMeters = fraction * frame.separationMeters;
  const totals = new Array<number>(bins.centres.length).fill(0);
  const crossings: { eta: number; magnitude: number }[] = [];
  let netAxialFlux = 0, absoluteAxialFlux = 0, crossingEdgeCount = 0;

  for (const edge of mesh.edges) {
    const a = metricById.get(edge.fromNodeId), b = metricById.get(edge.toNodeId);
    if (!a || !b) continue;
    const flow = state.edgeFlows[edge.id];
    if (flow === undefined || !Number.isFinite(flow)) continue;

    const xiA = dot(subtract(a, frame.origin), frame.along);
    const xiB = dot(subtract(b, frame.origin), frame.along);
    const crosses = (xiA <= alongMeters && alongMeters < xiB) || (xiB <= alongMeters && alongMeters < xiA);
    if (!crosses) continue;

    const t = (alongMeters - xiA) / (xiB - xiA);
    const etaA = dot(subtract(a, frame.origin), frame.normal);
    const etaB = dot(subtract(b, frame.origin), frame.normal);
    const eta = etaA + (etaB - etaA) * t;

    // A cut through a network is not a surface integral of a continuum field:
    // an edge that crosses the plane carries its WHOLE flow across it, with no
    // cosine factor. Weighting by the edge direction instead undercounts by
    // ~8% here and breaks the conservation identity below.
    const axial = flow * Math.sign(xiB - xiA);

    crossingEdgeCount += 1;
    netAxialFlux += axial;
    absoluteAxialFlux += Math.abs(axial);
    crossings.push({ eta, magnitude: Math.abs(axial) });
  }

  // Crossings land exactly on lattice rows, so binning them as points measures
  // the row pitch rather than the physical profile — a comb whose teeth move
  // with h. Each crossing instead owns the part of the cut line closest to it
  // (a 1-D Voronoi partition) and its flux is spread uniformly over that
  // interval, which turns the comb into a flux-per-metre density that refines
  // with the mesh instead of tracking it.
  crossings.sort((a, b) => a.eta - b.eta);

  // A crossing owns at most a couple of mesh pitches. Without this cap the
  // interval beside a barrier stretches across the whole blocked span and
  // smears flux into a region the network cannot reach, which would make an
  // impermeable obstacle look permeable.
  const spacings: number[] = [];
  for (let i = 1; i < crossings.length; i += 1) spacings.push(crossings[i].eta - crossings[i - 1].eta);
  const sortedSpacings = spacings.slice().sort((a, b) => a - b);
  const medianSpacing = sortedSpacings.length ? sortedSpacings[Math.floor(sortedSpacings.length / 2)] : bins.binWidthMeters;
  const halfExtentCap = Math.max(bins.binWidthMeters, 1.5 * medianSpacing) / 2;

  let capturedAbsolute = 0;
  for (let i = 0; i < crossings.length; i += 1) {
    const { eta, magnitude } = crossings[i];
    if (magnitude <= 0) continue;
    const previous = crossings[i - 1], next = crossings[i + 1];
    const fallback = previous || next ? Math.abs((next ?? previous).eta - eta) : bins.binWidthMeters;
    const lower = Math.max(previous ? (previous.eta + eta) / 2 : eta - fallback / 2, eta - halfExtentCap);
    const upper = Math.min(next ? (next.eta + eta) / 2 : eta + fallback / 2, eta + halfExtentCap);
    const span = upper - lower;
    if (!(span > 0)) continue;
    const first = Math.max(0, Math.floor((lower + bins.halfWidthMeters) / bins.binWidthMeters));
    const last = Math.min(totals.length - 1, Math.floor((upper + bins.halfWidthMeters) / bins.binWidthMeters));
    for (let index = first; index <= last; index += 1) {
      const binLower = -bins.halfWidthMeters + index * bins.binWidthMeters;
      const overlap = Math.min(upper, binLower + bins.binWidthMeters) - Math.max(lower, binLower);
      if (overlap <= 0) continue;
      const share = magnitude * (overlap / span);
      totals[index] += share;
      capturedAbsolute += share;
    }
  }

  const sum = totals.reduce((a, b) => a + b, 0);
  return {
    fraction,
    alongMeters,
    density: sum > 0 ? totals.map((value) => value / sum) : totals,
    netAxialFlux,
    absoluteAxialFlux,
    coherence: absoluteAxialFlux > 0 ? netAxialFlux / absoluteAxialFlux : 0,
    capturedShare: absoluteAxialFlux > 0 ? capturedAbsolute / absoluteAxialFlux : 0,
    crossingEdgeCount,
  };
}

export type ConcentrationMetrics = {
  readonly centroidMeters: number;
  readonly standardDeviationMeters: number;
  /** Interquantile widths: the central 50% and 80% of transport, in metres. */
  readonly width50Meters: number;
  readonly width80Meters: number;
  /** Shannon entropy over the fixed bins, divided by ln(binCount): 1 = uniform. */
  readonly normalizedEntropy: number;
  /** Peak bin density relative to a uniform spread over the same bins. */
  readonly peakOverUniform: number;
  readonly bandShare: number;
};

/** Linear-interpolated quantile of the cross-axis coordinate, in metres. */
function quantileMeters(density: readonly number[], bins: PhysicalBins, q: number): number {
  let cumulative = 0;
  for (let i = 0; i < density.length; i += 1) {
    const next = cumulative + density[i];
    if (next >= q) {
      const within = density[i] > 0 ? (q - cumulative) / density[i] : 0.5;
      return bins.centres[i] - bins.binWidthMeters / 2 + within * bins.binWidthMeters;
    }
    cumulative = next;
  }
  return bins.centres[bins.centres.length - 1] + bins.binWidthMeters / 2;
}

export function concentrationMetrics(section: CrossSection, bins: PhysicalBins, bandHalfWidthMeters: number): ConcentrationMetrics {
  const density = section.density;
  const total = density.reduce((a, b) => a + b, 0);
  if (!(total > 0)) {
    return { centroidMeters: Number.NaN, standardDeviationMeters: Number.NaN, width50Meters: Number.NaN, width80Meters: Number.NaN, normalizedEntropy: Number.NaN, peakOverUniform: Number.NaN, bandShare: 0 };
  }
  const centroidMeters = density.reduce((sum, p, i) => sum + p * bins.centres[i], 0);
  const variance = density.reduce((sum, p, i) => sum + p * (bins.centres[i] - centroidMeters) ** 2, 0);
  const entropy = density.reduce((sum, p) => (p > 0 ? sum - p * Math.log(p) : sum), 0);
  return {
    centroidMeters,
    standardDeviationMeters: Math.sqrt(variance),
    width50Meters: quantileMeters(density, bins, 0.75) - quantileMeters(density, bins, 0.25),
    width80Meters: quantileMeters(density, bins, 0.9) - quantileMeters(density, bins, 0.1),
    normalizedEntropy: entropy / Math.log(density.length),
    peakOverUniform: Math.max(...density) * density.length,
    bandShare: density.reduce((sum, p, i) => (Math.abs(bins.centres[i]) <= bandHalfWidthMeters ? sum + p : sum), 0),
  };
}

/**
 * Effective source-to-sink resistance, R = sum_i b_i u_i.
 *
 * With balanced demand (sum b_i = 0) this is invariant to the solver's choice
 * of pressure reference node, and with unit total demand it is numerically the
 * dissipated power — a single scalar summarising the whole field, which makes
 * it the natural quantity to compare across rotations.
 */
export function effectiveResistance(network: PreparedNetwork, state: DesignFieldState): number {
  let total = 0;
  for (const terminal of network.terminals) {
    const pressure = state.nodePressures[terminal.nodeId];
    if (pressure === undefined || !Number.isFinite(pressure)) return Number.NaN;
    total += (terminal.role === "source" ? terminal.magnitude : -terminal.magnitude) * pressure;
  }
  return total;
}

function assertComparable(a: readonly number[], b: readonly number[]): void {
  if (a.length !== b.length) throw new Error("Distributions must share the same fixed physical bins to be comparable.");
}

/** Total-variation distance in [0,1]. */
export function totalVariationDistance(a: readonly number[], b: readonly number[]): number {
  assertComparable(a, b);
  return 0.5 * a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
}

/**
 * Jensen-Shannon distance (base 2) in [0,1].
 *
 * Chosen over KL because it is symmetric, bounded, finite when a bin is empty
 * in one distribution but not the other — which happens constantly between a
 * coarse and a fine mesh — and because its square root is a true metric, so
 * "half as different" means something.
 */
export function jensenShannonDistance(a: readonly number[], b: readonly number[]): number {
  assertComparable(a, b);
  let divergence = 0;
  for (let i = 0; i < a.length; i += 1) {
    const mean = (a[i] + b[i]) / 2;
    if (mean <= 0) continue;
    if (a[i] > 0) divergence += 0.5 * a[i] * Math.log2(a[i] / mean);
    if (b[i] > 0) divergence += 0.5 * b[i] * Math.log2(b[i] / mean);
  }
  return Math.sqrt(Math.max(0, divergence));
}

/**
 * How the transport through a cross-section splits either side of the axis.
 *
 * The primary barrier metric: with an obstacle straddling the centreline, the
 * flow has to choose a side, and for symmetric geometry the two shares must
 * match to within the mesh anisotropy already measured in Gate G. Field width
 * alone cannot show this — a field can narrow for reasons that have nothing to
 * do with an obstacle.
 */
export function crossSectionSideShares(section: CrossSection, bins: PhysicalBins, centreBandMeters = 0): { upper: number; lower: number; centre: number } {
  let upper = 0, lower = 0, centre = 0;
  for (const [index, value] of section.density.entries()) {
    const eta = bins.centres[index];
    if (Math.abs(eta) <= centreBandMeters) centre += value;
    else if (eta > 0) upper += value;
    else lower += value;
  }
  return { upper, lower, centre };
}

/** (max - min) / mean of a metric across orientations; 0 means perfectly isotropic. */
export function anisotropyError(values: readonly number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return Number.NaN;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  if (!(Math.abs(mean) > 0)) return Number.NaN;
  return (Math.max(...finite) - Math.min(...finite)) / Math.abs(mean);
}

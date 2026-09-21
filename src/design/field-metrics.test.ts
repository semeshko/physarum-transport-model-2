import { describe, expect, it } from "vitest";
import type { GISBounds } from "../gis/types";
import { runDesignField } from "./adaptation";
import {
  anisotropyError,
  concentrationMetrics,
  createAxisFrame,
  createPhysicalBins,
  crossSectionFluxProfile,
  effectiveResistance,
  jensenShannonDistance,
  totalVariationDistance,
  type MetricVector,
} from "./field-metrics";
import { buildDesignMesh, createDesignArea } from "./mesh";
import { assembleDesignNetwork, type DesignTerminal } from "./network";
import { createLocalProjection } from "./projection";

const BOUNDS: GISBounds = [24.0, 49.83, 24.056, 49.855];
const area = createDesignArea(BOUNDS);
const projection = createLocalProjection(area.origin);
const SOURCE: MetricVector = [-500, 0];
const SINK: MetricVector = [500, 0];

const bins = createPhysicalBins(1400, 25);
const frame = createAxisFrame(SOURCE, SINK);

function run(spacing: number, overrides = {}) {
  const mesh = buildDesignMesh(area, spacing);
  const terminals: DesignTerminal[] = [
    { id: "src", role: "source", centre: projection.unproject(SOURCE), radiusMeters: 200, magnitude: 1 },
    { id: "snk", role: "sink", centre: projection.unproject(SINK), radiusMeters: 200, magnitude: 1 },
  ];
  const { network } = assembleDesignNetwork(mesh, terminals);
  return { mesh, network: network!, state: runDesignField(network!, { maxIterations: 400, ...overrides }) };
}

describe("axis frame", () => {
  it("builds an orthonormal frame along the source-sink direction", () => {
    const rotated = createAxisFrame([0, 0], [3, 4]);
    expect(rotated.separationMeters).toBeCloseTo(5, 12);
    expect(rotated.along[0] * rotated.normal[0] + rotated.along[1] * rotated.normal[1]).toBeCloseTo(0, 12);
    expect(Math.hypot(...rotated.along)).toBeCloseTo(1, 12);
  });

  it("refuses a degenerate axis", () => {
    expect(() => createAxisFrame([1, 1], [1, 1])).toThrow();
  });
});

describe("physical binning", () => {
  it("produces symmetric bin centres independent of any mesh", () => {
    const created = createPhysicalBins(100, 25);
    expect(created.centres).toEqual([-87.5, -62.5, -37.5, -12.5, 12.5, 37.5, 62.5, 87.5]);
  });

  it("rejects degenerate geometry", () => {
    expect(() => createPhysicalBins(0, 25)).toThrow();
    expect(() => createPhysicalBins(10, 25)).toThrow();
  });
});

describe("cross-section flux profile", () => {
  const { mesh, state } = run(120);

  it("conserves demand: signed axial flux through any plane equals the total demand", () => {
    for (const fraction of [0.25, 0.5, 0.75]) {
      const section = crossSectionFluxProfile(mesh, state, frame, fraction, bins);
      expect(section.netAxialFlux).toBeCloseTo(1, 6);
    }
  });

  it("captures essentially all of the flux inside the physical window", () => {
    const section = crossSectionFluxProfile(mesh, state, frame, 0.5, bins);
    expect(section.capturedShare).toBeGreaterThan(0.99);
    expect(section.crossingEdgeCount).toBeGreaterThan(10);
  });

  it("emits a normalized density over the fixed bins", () => {
    const section = crossSectionFluxProfile(mesh, state, frame, 0.5, bins);
    expect(section.density).toHaveLength(bins.centres.length);
    expect(section.density.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  /**
   * What survives refinement is the physical envelope, not the profile at
   * arbitrarily fine bins: a 150 m mesh cannot carry structure below its own
   * ~126 m row pitch, so comparing two resolutions on 25 m bins measures the
   * leftover imprint of each lattice rather than the field. The width
   * statistics are the mesh-independent claim; the distribution distance is
   * only meaningful on bins both meshes can actually resolve.
   */
  it("keeps its physical width statistics under refinement", () => {
    const coarse = run(150), fine = run(90);
    const a = concentrationMetrics(crossSectionFluxProfile(coarse.mesh, coarse.state, frame, 0.5, bins), bins, 250);
    const b = concentrationMetrics(crossSectionFluxProfile(fine.mesh, fine.state, frame, 0.5, bins), bins, 250);
    const relative = (x: number, y: number) => Math.abs(x - y) / ((x + y) / 2);
    expect(relative(a.width50Meters, b.width50Meters)).toBeLessThan(0.15);
    expect(relative(a.width80Meters, b.width80Meters)).toBeLessThan(0.15);
    expect(relative(a.standardDeviationMeters, b.standardDeviationMeters)).toBeLessThan(0.15);
  });

  it("agrees between resolutions on bins both meshes can resolve", () => {
    const resolvable = createPhysicalBins(1400, 200);
    const coarse = run(150), fine = run(90);
    const a = crossSectionFluxProfile(coarse.mesh, coarse.state, frame, 0.5, resolvable);
    const b = crossSectionFluxProfile(fine.mesh, fine.state, frame, 0.5, resolvable);
    expect(jensenShannonDistance(a.density, b.density)).toBeLessThan(0.12);
  });
});

describe("concentration metrics", () => {
  const { mesh, state } = run(120);
  const section = crossSectionFluxProfile(mesh, state, frame, 0.5, bins);

  it("reports a centred, finite-width profile in metres", () => {
    const metrics = concentrationMetrics(section, bins, 200);
    expect(Math.abs(metrics.centroidMeters)).toBeLessThan(bins.binWidthMeters);
    expect(metrics.width50Meters).toBeGreaterThan(0);
    expect(metrics.width80Meters).toBeGreaterThan(metrics.width50Meters);
    expect(metrics.standardDeviationMeters).toBeGreaterThan(0);
  });

  it("bounds entropy and band share", () => {
    const metrics = concentrationMetrics(section, bins, 200);
    expect(metrics.normalizedEntropy).toBeGreaterThan(0);
    expect(metrics.normalizedEntropy).toBeLessThanOrEqual(1);
    expect(metrics.bandShare).toBeGreaterThan(0);
    expect(metrics.bandShare).toBeLessThanOrEqual(1);
    expect(metrics.peakOverUniform).toBeGreaterThan(1);
  });

  it("scores a concentrated profile as narrower than a uniform one", () => {
    const uniform = bins.centres.map(() => 1 / bins.centres.length);
    const spike = bins.centres.map((_, i) => (i === Math.floor(bins.centres.length / 2) ? 1 : 0));
    const asSection = (density: number[]) => ({ ...section, density });
    const wide = concentrationMetrics(asSection(uniform), bins, 200);
    const narrow = concentrationMetrics(asSection(spike), bins, 200);
    expect(narrow.width80Meters).toBeLessThan(wide.width80Meters);
    expect(narrow.normalizedEntropy).toBeLessThan(wide.normalizedEntropy);
    expect(narrow.peakOverUniform).toBeGreaterThan(wide.peakOverUniform);
  });

  it("returns NaN rather than a fake zero when nothing crossed", () => {
    const empty = concentrationMetrics({ ...section, density: bins.centres.map(() => 0) }, bins, 200);
    expect(Number.isNaN(empty.width80Meters)).toBe(true);
    expect(empty.bandShare).toBe(0);
  });
});

describe("effective resistance", () => {
  it("is positive and independent of the solver's pressure reference", () => {
    const { network, state } = run(120);
    const resistance = effectiveResistance(network, state);
    expect(resistance).toBeGreaterThan(0);
    const shifted = { ...state, nodePressures: Object.fromEntries(Object.entries(state.nodePressures).map(([id, value]) => [id, value + 137])) };
    expect(effectiveResistance(network, shifted)).toBeCloseTo(resistance, 9);
  });
});

describe("distribution distances", () => {
  const p = [0.5, 0.3, 0.2], q = [0.2, 0.3, 0.5];

  it("are zero for identical distributions and symmetric otherwise", () => {
    expect(jensenShannonDistance(p, p)).toBeCloseTo(0, 12);
    expect(totalVariationDistance(p, p)).toBeCloseTo(0, 12);
    expect(jensenShannonDistance(p, q)).toBeCloseTo(jensenShannonDistance(q, p), 12);
    expect(totalVariationDistance(p, q)).toBeCloseTo(0.3, 12);
  });

  it("stay bounded by 1 for disjoint support and tolerate empty bins", () => {
    expect(jensenShannonDistance([1, 0], [0, 1])).toBeCloseTo(1, 12);
    expect(totalVariationDistance([1, 0], [0, 1])).toBeCloseTo(1, 12);
  });

  it("refuse distributions on different bins", () => {
    expect(() => jensenShannonDistance([0.5, 0.5], [1 / 3, 1 / 3, 1 / 3])).toThrow();
  });
});

describe("anisotropy error", () => {
  it("is zero when a metric does not depend on orientation", () => {
    expect(anisotropyError([4, 4, 4, 4])).toBeCloseTo(0, 12);
  });

  it("scales with the spread relative to the mean", () => {
    expect(anisotropyError([9, 11])).toBeCloseTo(0.2, 12);
    expect(anisotropyError([5])).toBeNaN();
  });
});

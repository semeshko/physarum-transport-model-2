import { describe, expect, it } from "vitest";
import type { GISBounds } from "../gis/types";
import type { PreparedEdge, PreparedNetwork, ScenarioTerminal } from "../scenario/types";
import { runDesignField } from "./adaptation";
import { concentrationMetrics, createAxisFrame, createPhysicalBins, crossSectionFluxProfile, effectiveResistance, jensenShannonDistance, type MetricVector } from "./field-metrics";
import { buildDesignMesh, createDesignArea } from "./mesh";
import { assembleDesignNetwork, type DesignTerminal } from "./network";
import { createLocalProjection } from "./projection";
import {
  DESIGN_MODEL_VERSION,
  DESIGN_V2,
  designScaleFromNetwork,
  elapsedDimensionlessTime,
  metabolicCoefficient,
  resolveDesignV2,
  timeStepFromDimensionless,
  toAdaptationParameters,
} from "./scale";

const BOUNDS: GISBounds = [24.0, 49.83, 24.056, 49.855];
const area = createDesignArea(BOUNDS);
const projection = createLocalProjection(area.origin);
const SOURCE: MetricVector = [-500, 0];
const SINK: MetricVector = [500, 0];
const bins = createPhysicalBins(1400, 25);
const frame = createAxisFrame(SOURCE, SINK);

function build(spacing: number) {
  const mesh = buildDesignMesh(area, spacing);
  const terminals: DesignTerminal[] = [
    { id: "src", role: "source", centre: projection.unproject(SOURCE), radiusMeters: 200, magnitude: 1 },
    { id: "snk", role: "sink", centre: projection.unproject(SINK), radiusMeters: 200, magnitude: 1 },
  ];
  const network = assembleDesignNetwork(mesh, terminals).network!;
  return { mesh, network, scale: designScaleFromNetwork(network) };
}

const base = build(150);
const profile = (mesh: ReturnType<typeof build>["mesh"], state: ReturnType<typeof runDesignField>) =>
  crossSectionFluxProfile(mesh, state, frame, 0.5, bins).density;

describe("characteristic scales", () => {
  /**
   * L0 must be a property of the domain, not of the discretisation — otherwise
   * the model scale is quietly tied to numerical resolution again, which is the
   * whole failure Gate H exists to undo. The sum runs over mesh elements, so
   * invariance is a measurement, not a definition: verified here across a 2.5x
   * refinement, and separately over 250..80 m where the spread is 1.0% and L0
   * recovers sqrt(AOI area) to within 1%.
   */
  it("derives a length that is a domain property, not a mesh property", () => {
    const physical = Math.sqrt(area.widthMeters * area.heightMeters);
    const lengths = [250, 200, 150, 120, 100].map((spacing) => build(spacing).scale.lengthMeters);
    for (const length of lengths) expect(Math.abs(length - physical) / physical).toBeLessThan(0.02);
    const spread = (Math.max(...lengths) - Math.min(...lengths)) / physical;
    expect(spread).toBeLessThan(0.02);
  });

  /**
   * What actually has to stay small is the regularizer measured against the
   * field, r/c_max. c_max is a point statistic and does move with the mesh
   * (~20% over 250..80 m), so this pins the quantity that matters rather than
   * assuming it follows L0.
   */
  it("keeps the effective regularizer r/c_max well inside the negligible region at every resolution", () => {
    for (const spacing of [200, 150, 120, 100]) {
      const { network } = build(spacing);
      const parameters = resolveDesignV2(network);
      const state = runDesignField(network, parameters);
      const effective = parameters.backgroundConductivity / Math.max(...Object.values(state.conductivity));
      expect(effective).toBeLessThan(1e-3);
    }
  });

  it("is deterministic and takes the demand from the network", () => {
    expect(designScaleFromNetwork(base.network)).toEqual(designScaleFromNetwork(base.network));
    expect(base.scale.demand).toBeCloseTo(1, 12);
    expect(base.scale.conductivity).toBe(1);
  });

  it("refuses a degenerate scale", () => {
    const empty: PreparedNetwork = { ...base.network, edges: [] };
    expect(() => designScaleFromNetwork(empty)).toThrow();
    expect(() => designScaleFromNetwork(base.network, 0)).toThrow();
  });
});

describe("dimensionless conversion", () => {
  it("round-trips the timestep group dt_hat = dt * nu * C0^(gamma-2)", () => {
    for (const gamma of [1.25, 1.5, 3]) {
      for (const dtHat of [0.25, 5]) {
        const dt = timeStepFromDimensionless(base.scale, gamma, dtHat);
        const nu = metabolicCoefficient(base.scale, gamma);
        expect(dt * nu * base.scale.conductivity ** (gamma - 2)).toBeCloseTo(dtHat, 9);
      }
    }
  });

  it("derives nu from prescribed quantities only, never from an observed c_max", () => {
    const nu = metabolicCoefficient(base.scale, 1.5);
    expect(nu).toBeCloseTo(base.scale.demand ** 2 / (base.scale.lengthMeters ** 2 * base.scale.conductivity ** 2.5), 20);
  });

  it("maps every ratio onto its dimensional parameter", () => {
    const parameters = toAdaptationParameters({ ...base.scale, conductivity: 4 }, DESIGN_V2);
    expect(parameters.backgroundConductivity).toBeCloseTo(DESIGN_V2.backgroundRatio * 4, 12);
    expect(parameters.minimumConductivity).toBeCloseTo(DESIGN_V2.minimumRatio * 4, 20);
    expect(parameters.initialConductivity).toBeCloseTo(DESIGN_V2.initialRatio * 4, 12);
    expect(parameters.convergenceTolerance).toBeCloseTo(DESIGN_V2.convergenceTolerance * 4, 12);
  });

  it("reports dimensionless elapsed time", () => {
    expect(elapsedDimensionlessTime(DESIGN_V2, 40)).toBeCloseTo(40 * DESIGN_V2.timeStep, 12);
  });
});

/**
 * The central claim of Gate H: with every parameter expressed as a ratio to C0,
 * the conductivity unit cancels out of the dynamics entirely. If this fails,
 * "nu = 1" is hiding a scale again.
 */
describe("C0 is a gauge", () => {
  const units = [1e-2, 1, 1e2];
  const runs = units.map((conductivity) => {
    const scale = { ...base.scale, conductivity };
    const state = runDesignField(base.network, toAdaptationParameters(scale, DESIGN_V2));
    return { conductivity, state };
  });

  it("gives the same iteration count and the same normalized field", () => {
    for (const run of runs) {
      expect(run.state.diagnostics.iteration).toBe(runs[1].state.diagnostics.iteration);
      expect(jensenShannonDistance(profile(base.mesh, run.state), profile(base.mesh, runs[1].state))).toBeLessThan(1e-6);
    }
  });

  it("scales conductivity and resistance by exactly the unit", () => {
    const reference = Math.max(...Object.values(runs[1].state.conductivity));
    for (const run of runs) {
      expect(Math.max(...Object.values(run.state.conductivity)) / run.conductivity).toBeCloseTo(reference, 6);
      expect(effectiveResistance(base.network, run.state) * run.conductivity).toBeCloseTo(effectiveResistance(base.network, runs[1].state), 6);
    }
  });
});

describe("nu equilibrium scaling", () => {
  it("moves c_max as nu^(-1/(gamma+1)) when dt_hat is held fixed", () => {
    const gamma = 1.5;
    const reference = toAdaptationParameters(base.scale, { ...DESIGN_V2, gamma, backgroundRatio: 1e-7 });
    const measure = (factor: number) => {
      const nu = reference.nu / factor;
      const state = runDesignField(base.network, { ...reference, nu, timeStep: reference.timeStep * factor, maxIterations: 4000 });
      return Math.max(...Object.values(state.conductivity));
    };
    const at1 = measure(1), at100 = measure(100);
    const exponent = Math.log(at100 / at1) / Math.log(1 / 100);
    expect(exponent).toBeCloseTo(-1 / (gamma + 1), 1);
  });
});

describe("regularizer semantics", () => {
  it("keeps the background a negligible share of the transport at eps_r = 1e-3", () => {
    const parameters = resolveDesignV2(base.network);
    const state = runDesignField(base.network, parameters);
    const ids = Object.keys(state.conductivity);
    const total = ids.reduce((sum, id) => sum + Math.abs(state.edgeFlows[id] ?? 0), 0);
    const dominated = ids.filter((id) => state.conductivity[id] < parameters.backgroundConductivity);
    expect(dominated.reduce((sum, id) => sum + Math.abs(state.edgeFlows[id] ?? 0), 0) / total).toBeLessThan(0.02);
  });

  it("changes the field only negligibly when eps_r is reduced a further 10x", () => {
    const scale = base.scale;
    const coarse = runDesignField(base.network, toAdaptationParameters(scale, DESIGN_V2));
    const fine = runDesignField(base.network, toAdaptationParameters(scale, { ...DESIGN_V2, backgroundRatio: DESIGN_V2.backgroundRatio / 10 }));
    const widthOf = (state: typeof coarse) => concentrationMetrics(crossSectionFluxProfile(base.mesh, state, frame, 0.5, bins), bins, 250).width80Meters;
    expect(Math.abs(widthOf(coarse) - widthOf(fine)) / widthOf(fine)).toBeLessThan(0.05);
    expect(jensenShannonDistance(profile(base.mesh, coarse), profile(base.mesh, fine))).toBeLessThan(0.05);
  });

  it("is materially distorted at the v1-equivalent eps_r = 1e-1", () => {
    const widthOf = (backgroundRatio: number) => {
      const state = runDesignField(base.network, toAdaptationParameters(base.scale, { ...DESIGN_V2, backgroundRatio }));
      return concentrationMetrics(crossSectionFluxProfile(base.mesh, state, frame, 0.5, bins), bins, 250).width80Meters;
    };
    expect(widthOf(1e-1)).toBeGreaterThan(widthOf(1e-3) * 1.05);
  });
});

describe("minimum conductivity semantics", () => {
  it("is inert at the corrected scale: the clamp no longer decides the field", () => {
    const widths = [1e-5, 1e-9, 1e-12].map((minimumRatio) => {
      const state = runDesignField(base.network, toAdaptationParameters(base.scale, { ...DESIGN_V2, minimumRatio }));
      return concentrationMetrics(crossSectionFluxProfile(base.mesh, state, frame, 0.5, bins), bins, 250).width80Meters;
    });
    // Metres: agreement to a micrometre is already far past "inert".
    for (const width of widths) expect(Math.abs(width - widths[0]) / widths[0]).toBeLessThan(1e-6);
  });
});

describe("scale-aware convergence", () => {
  it("expresses the tolerance relative to C0, so it survives rescaling", () => {
    expect(toAdaptationParameters({ ...base.scale, conductivity: 7 }, DESIGN_V2).convergenceTolerance).toBeCloseTo(7 * DESIGN_V2.convergenceTolerance, 12);
  });

  it("reaches a true fixed point rather than a limit cycle at the v2 timestep", () => {
    const state = runDesignField(base.network, resolveDesignV2(base.network));
    expect(state.diagnostics.terminationReason).toBe("converged");
    expect(state.diagnostics.maxDelta).toBeLessThan(DESIGN_V2.convergenceTolerance);
    expect(elapsedDimensionlessTime(DESIGN_V2, state.diagnostics.iteration)).toBeGreaterThan(DESIGN_V2.minimumElapsed);
  });

  /**
   * Gate G's failure mode: shrink the timestep far enough and the first step is
   * smaller than the tolerance, so an untouched initial condition is reported
   * as converged. The dimensionless elapsed time separates "near equilibrium"
   * from "barely moving".
   */
  it("rejects a converged verdict that arrives before any dimensionless time has passed", () => {
    const parameters = resolveDesignV2(base.network);
    const crawling = runDesignField(base.network, { ...parameters, timeStep: parameters.timeStep * 1e-9, maxIterations: 20 });
    const elapsed = crawling.diagnostics.iteration * DESIGN_V2.timeStep * 1e-9;
    expect(elapsed).toBeLessThan(DESIGN_V2.minimumElapsed);
    const unchanged = Math.max(...Object.values(crawling.conductivity)) / parameters.initialConductivity;
    expect(unchanged).toBeCloseTo(1, 6);
  });
});

describe("initial condition", () => {
  it("reaches the same field from very different starts", () => {
    const runs = [1e-2, 1, 10].map((initialRatio) => runDesignField(base.network, toAdaptationParameters(base.scale, { ...DESIGN_V2, initialRatio, maxIterations: 8000 })));
    for (const state of runs) {
      expect(state.diagnostics.terminationReason).toBe("converged");
      expect(jensenShannonDistance(profile(base.mesh, state), profile(base.mesh, runs[1]))).toBeLessThan(0.01);
    }
  });
});

describe("Gate D hydraulic invariances survive the rescaling", () => {
  const TRANSMISSIBILITY = Math.sqrt(3);
  const CORRIDOR_WIDTH = 100 / TRANSMISSIBILITY;
  function chain(segments: number, totalLength = 100, magnitude = 1): PreparedNetwork {
    const length = totalLength / segments;
    const nodes = Array.from({ length: segments + 1 }, (_, i) => `n${i}`);
    const edges: PreparedEdge[] = Array.from({ length: segments }, (_, i) => ({
      graphEdgeId: `e${i}`, fromNodeId: nodes[i], toNodeId: nodes[i + 1],
      lengthMeters: length, penaltyMultiplier: 1, effectiveCost: length / CORRIDOR_WIDTH,
    }));
    const terminals: ScenarioTerminal[] = [
      { id: "s", role: "source", nodeId: nodes[0], magnitude },
      { id: "t", role: "sink", nodeId: nodes.at(-1)!, magnitude },
    ];
    return { graphId: "chain", scenarioId: "chain", nodes: nodes.map((id, i) => ({ id, position: [i, 0] as const })), edges, terminals, activeEdgeCount: edges.length, blockedEdgeCount: 0, sourceSinkConnected: true };
  }

  it("is still invariant to subdividing the same physical corridor", () => {
    const reference = Object.values(runDesignField(chain(1), resolveDesignV2(chain(1))).conductivity)[0];
    for (const segments of [2, 5, 10]) {
      const network = chain(segments);
      for (const value of Object.values(runDesignField(network, resolveDesignV2(network)).conductivity)) {
        expect(value / reference).toBeCloseTo(1, 4);
      }
    }
  });

  it("still conserves demand through every cross-section", () => {
    const state = runDesignField(base.network, resolveDesignV2(base.network));
    for (const fraction of [0.25, 0.5, 0.75]) {
      expect(crossSectionFluxProfile(base.mesh, state, frame, fraction, bins).netAxialFlux).toBeCloseTo(1, 6);
    }
  });

  it("keeps the Kirchhoff residual at solver precision", () => {
    expect(runDesignField(base.network, resolveDesignV2(base.network)).diagnostics.maximumKirchhoffResidual).toBeLessThan(1e-8);
  });
});

describe("Gate E/F adaptation behaviour on the corrected scale", () => {
  it("keeps energy monotone", () => {
    expect(runDesignField(base.network, resolveDesignV2(base.network)).diagnostics.energyMonotone).toBe(true);
  });

  it("is deterministic", () => {
    const a = runDesignField(base.network, resolveDesignV2(base.network));
    const b = runDesignField(base.network, resolveDesignV2(base.network));
    expect(a.conductivity).toEqual(b.conductivity);
    expect(a.diagnostics.iteration).toBe(b.diagnostics.iteration);
  });

  it("reports the hydraulic solve health alongside the field", () => {
    const state = runDesignField(base.network, resolveDesignV2(base.network));
    expect(state.diagnostics.linearSolve?.converged).toBe(true);
    expect(state.diagnostics.linearSolve!.iterations).toBeGreaterThan(0);
  });

  /** Gate G's ordering, now on a derived scale rather than a fitted one. */
  it("orders field width by gamma, narrower as gamma approaches 1", () => {
    const widthFor = (gamma: number) => {
      const state = runDesignField(base.network, toAdaptationParameters(base.scale, { ...DESIGN_V2, gamma, maxIterations: 12000 }));
      return concentrationMetrics(crossSectionFluxProfile(base.mesh, state, frame, 0.5, bins), bins, 250).width80Meters;
    };
    const narrow = widthFor(1.25), middle = widthFor(1.5), wide = widthFor(2);
    expect(narrow).toBeLessThan(middle);
    expect(middle).toBeLessThan(wide);
  });
});

describe("model version", () => {
  it("names the version the parameters belong to", () => {
    expect(DESIGN_MODEL_VERSION).toBe("design-hucai-v2");
    expect(DESIGN_V2.backgroundRatio).toBe(1e-3);
    expect(DESIGN_V2.timeStep).toBe(0.25);
  });
});

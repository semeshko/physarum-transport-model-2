import { describe, expect, it } from "vitest";
import type { GISBounds, GISPosition } from "../gis/types";
import { runDesignField } from "./adaptation";
import {
  createAxisFrame,
  createPhysicalBins,
  crossSectionFluxProfile,
  crossSectionSideShares,
  effectiveResistance,
  jensenShannonDistance,
  totalVariationDistance,
  type MetricVector,
} from "./field-metrics";
import { buildDesignMesh, createDesignArea } from "./mesh";
import { assembleDesignNetwork, countBarrierCrossingEdges, type DesignBarrier, type DesignTerminal } from "./network";
import { createLocalProjection } from "./projection";
import { designV2Parameters, metabolicCoefficient } from "./scale";

/**
 * Canonical Task 18B fixture — a symmetric building straddling the axis:
 *
 *     Source  o        [====]        o  Sink
 *
 * The obstacle is centred on the source-sink line, so a correct implementation
 * has to push all of the transport around it and, for perfectly symmetric
 * geometry, split it evenly between the two sides.
 */
const BOUNDS: GISBounds = [24.0, 49.828, 24.06, 49.856];
const area = createDesignArea(BOUNDS);
const projection = createLocalProjection(area.origin);
const bins = createPhysicalBins(1500, 25);

const SOURCE: MetricVector = [-800, 0];
const SINK: MetricVector = [800, 0];
const frame = createAxisFrame(SOURCE, SINK);

function terminals(): DesignTerminal[] {
  return [
    { id: "src", role: "source", centre: projection.unproject(SOURCE), radiusMeters: 200, magnitude: 1 },
    { id: "snk", role: "sink", centre: projection.unproject(SINK), radiusMeters: 200, magnitude: 1 },
  ];
}

/** Axis-aligned rectangle in metric metres, expressed as a lon/lat barrier. */
function rect(id: string, kind: DesignBarrier["kind"], x0: number, y0: number, x1: number, y1: number): DesignBarrier {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => projection.unproject([x, y]) as GISPosition);
  return { id, kind, geometry: { type: "Polygon", coordinates: [ring] } };
}

function run(spacing: number, barriers: readonly DesignBarrier[]) {
  const mesh = buildDesignMesh(area, spacing);
  const assembly = assembleDesignNetwork(mesh, terminals(), barriers);
  if (!assembly.network || !assembly.scale) return { assembly, mesh, state: null, section: null };
  const state = runDesignField(assembly.network, designV2Parameters(assembly.scale, { maxIterations: 6000 }));
  return { assembly, mesh, state, section: crossSectionFluxProfile(mesh, state, frame, 0.5, bins) };
}

const SYMMETRIC_BUILDING = rect("b1", "building", -250, -300, 250, 300);

describe("barrier scale discipline", () => {
  it("keeps L0, Q0 and nu identical with barriers off and on", () => {
    const off = run(150, []).assembly;
    const on = run(150, [SYMMETRIC_BUILDING]).assembly;
    expect(on.diagnostics.blockedByBuildingCount).toBeGreaterThan(0);
    expect(on.scale!.lengthMeters).toBeCloseTo(off.scale!.lengthMeters, 9);
    expect(on.scale!.demand).toBeCloseTo(off.scale!.demand, 12);
    expect(on.scale!.conductivity).toBe(off.scale!.conductivity);
    expect(metabolicCoefficient(on.scale!, 1.5)).toBeCloseTo(metabolicCoefficient(off.scale!, 1.5), 20);
  });

  /** The failure this guards: a scale summed over surviving edges shrinks when a barrier removes some. */
  it("would have recalibrated the model if the scale came from the surviving mesh", () => {
    const off = run(150, []);
    const on = run(150, [SYMMETRIC_BUILDING]);
    const meshedArea = (network: NonNullable<typeof off.assembly.network>) =>
      network.edges.reduce((sum, edge) => sum + (edge.lengthMeters * edge.lengthMeters) / edge.effectiveCost, 0) / 2;
    expect(meshedArea(on.assembly.network!)).toBeLessThan(meshedArea(off.assembly.network!) * 0.99);
  });

  it("gives the worker the AOI scale, not the remainder", () => {
    const on = run(150, [SYMMETRIC_BUILDING]).assembly;
    expect(on.scale!.lengthMeters).toBeCloseTo(Math.sqrt(area.areaSquareMeters), 9);
  });
});

describe("impermeable buildings", () => {
  const off = run(150, []);
  const on = run(150, [SYMMETRIC_BUILDING]);

  it("removes every candidate edge that enters the polygon", () => {
    expect(on.assembly.diagnostics.blockedByBuildingCount).toBeGreaterThan(0);
    expect(on.assembly.diagnostics.blockedByWaterCount).toBe(0);
    expect(on.assembly.network!.edges.length).toBe(on.assembly.diagnostics.usableEdgeCount);
  });

  /**
   * The strict invariant: interior(edge) intersect interior(barrier) = empty,
   * for every surviving edge. Measured with the exact segment/polygon interior
   * length, not by sampling points along the edge — see the counterexamples
   * below for why sampling is not evidence.
   */
  it("leaves no active edge crossing the barrier interior", () => {
    const { crossingEdgeCount, maximumAffectedFraction } = countBarrierCrossingEdges(on.mesh, on.assembly.network!, [SYMMETRIC_BUILDING]);
    expect(crossingEdgeCount).toBe(0);
    expect(maximumAffectedFraction).toBe(0);
  });

  it("still conserves the whole demand around the obstacle", () => {
    for (const fraction of [0.25, 0.5, 0.75]) {
      const section = crossSectionFluxProfile(on.mesh, on.state!, frame, fraction, bins);
      expect(section.netAxialFlux).toBeCloseTo(1, 6);
    }
    expect(on.state!.diagnostics.maximumKirchhoffResidual).toBeLessThan(1e-8);
  });

  /** The headline result: symmetric geometry must split symmetrically. */
  it("splits transport evenly above and below a symmetric obstacle", () => {
    const shares = crossSectionSideShares(on.section!, bins);
    expect(shares.centre).toBe(0);
    expect(shares.upper + shares.lower).toBeCloseTo(1, 9);
    // Gate G measured ~20% orientation sensitivity in width metrics at this
    // resolution; the side split is far tighter than that.
    expect(Math.abs(shares.upper - shares.lower)).toBeLessThan(0.05);
  });

  /**
   * Impermeability is proven at the network level by the test above — no edge
   * survives inside the polygon. This one measures the consequence in the
   * smoothed cross-section, which is an estimator with a resolution of about
   * one mesh pitch: flux from crossings just outside the obstacle bleeds a
   * little way into the blocked band, so the honest assertion is a sharp drop
   * rather than an exact zero (which only happens at some spacings).
   */
  it("pushes flow off the centreline that an unobstructed field used", () => {
    const openShares = crossSectionSideShares(off.section!, bins, 300);
    const blockedShares = crossSectionSideShares(on.section!, bins, 300);
    expect(openShares.centre).toBeGreaterThan(0.3);
    expect(blockedShares.centre).toBeLessThan(openShares.centre / 2);
  });

  it("raises the effective resistance and changes the distribution measurably", () => {
    expect(effectiveResistance(on.assembly.network!, on.state!)).toBeGreaterThan(effectiveResistance(off.assembly.network!, off.state!));
    expect(jensenShannonDistance(on.section!.density, off.section!.density)).toBeGreaterThan(0.2);
    expect(totalVariationDistance(on.section!.density, off.section!.density)).toBeGreaterThan(0.2);
  });

  it("converges with monotone energy despite the obstacle", () => {
    expect(on.state!.diagnostics.terminationReason).toBe("converged");
    expect(on.state!.diagnostics.energyMonotone).toBe(true);
    expect(on.state!.diagnostics.linearSolve?.converged).toBe(true);
  });
});

describe("crossing predicate is not sampling", () => {
  const spacing = 150;
  const mesh = buildDesignMesh(area, spacing);

  /** A wall thinner than one mesh edge: an edge enters and leaves it, and the
   * edge midpoint lands outside. Sampling would miss this; the interior-measure
   * predicate does not. */
  it.each([
    ["thin wall crossed with the midpoint outside", rect("thin", "building", -6, -1400, 6, 1400)],
    ["oblique thin wall", { id: "obl", kind: "building" as const, geometry: { type: "Polygon" as const, coordinates: [[[-400, -1400], [-380, -1400], [420, 1400], [400, 1400], [-400, -1400]].map(([x, y]) => projection.unproject([x, y]) as GISPosition)] } }],
    ["narrow sliver", rect("sliver", "building", -300, -4, 300, 4)],
  ])("blocks %s", (_label, barrier) => {
    const assembly = assembleDesignNetwork(mesh, terminals(), [barrier as DesignBarrier]);
    expect(assembly.diagnostics.blockedByBuildingCount).toBeGreaterThan(0);
    const proof = countBarrierCrossingEdges(mesh, assembly.network!, [barrier as DesignBarrier]);
    expect(proof.crossingEdgeCount).toBe(0);
    expect(proof.maximumAffectedFraction).toBe(0);
  });

  it("shows the sampling check would have passed a crossing the strict one rejects", () => {
    const thin = rect("thin2", "building", -6, -1400, 6, 1400);
    const unmasked = assembleDesignNetwork(mesh, terminals(), []);
    const metric = new Map(mesh.nodes.map((node) => [node.id, node.metric as MetricVector]));
    const insideThin = (p: MetricVector) => p[0] > -6 && p[0] < 6 && p[1] > -1400 && p[1] < 1400;
    const midpointMisses = unmasked.network!.edges.filter((edge) => {
      const a = metric.get(edge.fromNodeId)!, b = metric.get(edge.toNodeId)!;
      const mid: MetricVector = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      return !insideThin(mid) && Math.sign(a[0]) !== Math.sign(b[0]) && Math.abs(a[0]) > 6 && Math.abs(b[0]) > 6;
    });
    expect(midpointMisses.length).toBeGreaterThan(0);
    expect(countBarrierCrossingEdges(mesh, unmasked.network!, [thin]).crossingEdgeCount).toBeGreaterThan(0);
  });
});

describe("asymmetric obstacle", () => {
  it("sends the flow around the cheaper side when the obstacle is offset", () => {
    const offset = rect("b2", "building", -250, -700, 250, 200);
    const { section } = run(150, [offset]);
    const shares = crossSectionSideShares(section!, bins);
    // The obstacle covers more of the lower half, so the upper side must carry more.
    expect(shares.upper).toBeGreaterThan(shares.lower);
    expect(section!.netAxialFlux).toBeCloseTo(1, 6);
  });
});

describe("impermeable water", () => {
  it("blocks water exactly like a building and invents no crossing", () => {
    const river = rect("w1", "water", -150, -2000, 150, 2000);
    const { assembly } = run(150, [river]);
    expect(assembly.diagnostics.blockedByWaterCount).toBeGreaterThan(0);
    expect(assembly.diagnostics.blockedByBuildingCount).toBe(0);
    // A river spanning the whole AOI separates source from sink: Design v0 does
    // not build a bridge, so this must be reported rather than routed around.
    expect(assembly.network).toBeNull();
    expect(assembly.issues.map((issue) => issue.code)).toContain("terminals-disconnected");
  });
});

describe("narrow passage", () => {
  /**
   * Two blocks leaving a physical gap. The passage must survive while the mesh
   * can resolve it and disappear when it cannot — the resolution limit is real
   * and is reported, not hidden.
   */
  const GAP = 300;
  const upper = rect("u", "building", -200, GAP / 2, 200, 2000);
  const lower = rect("l", "building", -200, -2000, 200, -GAP / 2);

  it("keeps a resolved gap open and sends everything through it", () => {
    const { assembly, section } = run(90, [upper, lower]);
    expect(assembly.network).not.toBeNull();
    const shares = crossSectionSideShares(section!, bins, GAP / 2);
    expect(shares.centre).toBeGreaterThan(0.9);
    expect(section!.netAxialFlux).toBeCloseTo(1, 6);
  });

  /**
   * The limitation, stated as it actually behaves rather than as one might
   * assume. Survival is not "gap vs spacing": the odd-row parity rule puts a
   * node row exactly on the axis, so a gap straddling y = 0 stays connected
   * even at a mesh step well above its width. What decides it is whether the
   * lattice lands a row inside the gap — so an OFF-AXIS gap of the same width
   * closes once the row pitch steps over it.
   */
  const OFF_AXIS_GAP = 120, OFF_AXIS_CENTRE = 700;
  const upperOff = rect("uo", "building", -200, OFF_AXIS_CENTRE + OFF_AXIS_GAP / 2, 200, 2000);
  const lowerOff = rect("lo", "building", -200, -2000, 200, OFF_AXIS_CENTRE - OFF_AXIS_GAP / 2);

  it("keeps a narrow off-axis gap when the mesh is fine enough to land a row in it", () => {
    const { assembly } = run(60, [upperOff, lowerOff]);
    expect(assembly.network).not.toBeNull();
  });

  it("loses the same gap when the row pitch steps over it", () => {
    const { assembly } = run(300, [upperOff, lowerOff]);
    expect(assembly.network).toBeNull();
    expect(assembly.issues.map((issue) => issue.code)).toContain("terminals-disconnected");
  });

  it("keeps an on-axis gap even above its width, because odd row parity puts a row on the axis", () => {
    const { assembly } = run(400, [upper, lower]);
    expect(assembly.network).not.toBeNull();
  });
});

describe("boundary and corner semantics", () => {
  it("does not block an edge that only runs along a barrier wall", () => {
    const open = run(150, []).assembly.diagnostics.usableEdgeCount;
    // A zero-height sliver has no interior to cross.
    const sliver = rect("s", "building", -250, 0, 250, 0);
    expect(run(150, [sliver]).assembly.diagnostics.usableEdgeCount).toBe(open);
  });

  it("handles a MultiPolygon barrier as one impermeable set", () => {
    const first = rect("m1", "building", -300, 100, -100, 400);
    const second = rect("m2", "building", 100, 100, 300, 400);
    const combined: DesignBarrier = {
      id: "multi",
      kind: "building",
      geometry: { type: "MultiPolygon", coordinates: [first.geometry.coordinates as GISPosition[][], second.geometry.coordinates as GISPosition[][]] },
    };
    const separate = run(150, [first, second]).assembly.diagnostics;
    const multi = run(150, [combined]).assembly.diagnostics;
    expect(multi.usableEdgeCount).toBe(separate.usableEdgeCount);
    expect(multi.blockedByBuildingCount).toBe(separate.blockedByBuildingCount);
  });

  it("tolerates a barrier that runs past the AOI edge", () => {
    const overhang = rect("o", "building", -250, 900, 250, 5000);
    const { assembly } = run(150, [overhang]);
    expect(assembly.network).not.toBeNull();
    expect(assembly.diagnostics.blockedByBuildingCount).toBeGreaterThan(0);
  });
});

describe("terminal supports meet barriers", () => {
  it("drops blocked support nodes and renormalizes the demand exactly", () => {
    // A building covering part of the source disc.
    const clipped = rect("c", "building", -900, -400, -750, 400);
    const { assembly } = run(150, [clipped]);
    expect(assembly.network).not.toBeNull();
    const source = assembly.diagnostics.terminals.find((terminal) => terminal.terminalId === "src")!;
    const open = run(150, []).assembly.diagnostics.terminals.find((terminal) => terminal.terminalId === "src")!;
    expect(source.nodeIds.length).toBeLessThan(open.nodeIds.length);
    expect(source.nodeIds.length).toBeGreaterThan(0);
    const supplied = assembly.network!.terminals.filter((terminal) => terminal.role === "source").reduce((sum, terminal) => sum + terminal.magnitude, 0);
    expect(supplied).toBeCloseTo(1, 12);
    expect(assembly.diagnostics.totalPositiveDemand).toBeCloseTo(assembly.diagnostics.totalNegativeDemand, 12);
  });

  it("refuses to place demand inside a building when the whole support is blocked", () => {
    const buried = rect("x", "building", -1000, -400, -600, 400);
    const { assembly } = run(150, [buried]);
    expect(assembly.network).toBeNull();
    expect(assembly.issues.map((issue) => issue.code)).toContain("empty-terminal-support");
  });
});

describe("obstacle response under mesh refinement", () => {
  /**
   * Amendment 2: compare barriers OFF/ON at a FIXED mesh. Refinement is a
   * separate robustness check, and Gate H measured width metrics moving ~33%
   * across a broad refinement range, so the stable quantities are the side
   * split and the resistance ratio.
   */
  it("keeps the symmetric split and the resistance increase at three resolutions", () => {
    for (const spacing of [200, 150, 120]) {
      const off = run(spacing, []);
      const on = run(spacing, [SYMMETRIC_BUILDING]);
      const shares = crossSectionSideShares(on.section!, bins);
      expect(Math.abs(shares.upper - shares.lower)).toBeLessThan(0.08);
      expect(on.section!.netAxialFlux).toBeCloseTo(1, 6);
      const ratio = effectiveResistance(on.assembly.network!, on.state!) / effectiveResistance(off.assembly.network!, off.state!);
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(3);
    }
  });
});

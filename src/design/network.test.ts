import { describe, expect, it } from "vitest";
import type { GISBounds, GISPosition } from "../gis/types";
import { solveHydraulics } from "../physarum/hydraulics";
import { runDesignField } from "./adaptation";
import { buildDesignMesh, createDesignArea } from "./mesh";
import { assembleDesignNetwork, type DesignBarrier, type DesignTerminal } from "./network";

const BOUNDS: GISBounds = [24.02, 49.835, 24.048, 49.851];
const area = createDesignArea(BOUNDS);
const mesh = buildDesignMesh(area, 60);

/** Convert a metric offset from the AOI centre into lon/lat, for placing fixtures. */
function atMetric(x: number, y: number): GISPosition {
  const [lon, lat] = area.origin;
  const metresPerDegreeLat = 111_195;
  return [lon + x / (metresPerDegreeLat * Math.cos((lat * Math.PI) / 180)), lat + y / metresPerDegreeLat];
}

const source = (magnitude = 1): DesignTerminal => ({ id: "src", role: "source", centre: atMetric(-600, 0), radiusMeters: 150, magnitude });
const sink = (magnitude = 1): DesignTerminal => ({ id: "snk", role: "sink", centre: atMetric(600, 0), radiusMeters: 150, magnitude });

function rectBarrier(id: string, kind: DesignBarrier["kind"], x0: number, y0: number, x1: number, y1: number): DesignBarrier {
  const ring = [atMetric(x0, y0), atMetric(x1, y0), atMetric(x1, y1), atMetric(x0, y1), atMetric(x0, y0)];
  return { id, kind, geometry: { type: "Polygon", coordinates: [ring] } };
}

describe("design network assembly", () => {
  it("produces a solver-ready PreparedNetwork from a mesh and two markers", () => {
    const { network, issues, diagnostics } = assembleDesignNetwork(mesh, [source(), sink()]);
    expect(issues).toEqual([]);
    expect(network).not.toBeNull();
    expect(network!.edges.length).toBe(mesh.edges.length);
    expect(diagnostics.usableEdgeCount).toBe(mesh.edges.length);
    expect(diagnostics.totalPositiveDemand).toBeCloseTo(diagnostics.totalNegativeDemand, 12);
  });

  it("carries the Gate D transmissibility in effectiveCost, not raw length", () => {
    const { network } = assembleDesignNetwork(mesh, [source(), sink()]);
    for (const edge of network!.edges) {
      expect(edge.effectiveCost).toBeCloseTo(Math.sqrt(3), 9);
      expect(edge.lengthMeters).toBeCloseTo(mesh.diagnostics.effectiveSpacingMeters, 9);
    }
  });

  it("spreads each marker's demand over its physical support, never a single node", () => {
    const { network, diagnostics } = assembleDesignNetwork(mesh, [source(), sink()]);
    for (const resolution of diagnostics.terminals) expect(resolution.nodeIds.length).toBeGreaterThan(1);
    const sourceTotal = network!.terminals.filter((t) => t.role === "source").reduce((sum, t) => sum + t.magnitude, 0);
    expect(sourceTotal).toBeCloseTo(1, 12);
  });

  it("keeps total demand conserved when the mesh is refined", () => {
    for (const spacing of [100, 80, 60, 45]) {
      const refined = buildDesignMesh(area, spacing);
      const { network, diagnostics } = assembleDesignNetwork(refined, [source(), sink()]);
      expect(network).not.toBeNull();
      expect(diagnostics.totalPositiveDemand).toBeCloseTo(1, 12);
      const total = network!.terminals.filter((t) => t.role === "source").reduce((sum, t) => sum + t.magnitude, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it("is deterministic", () => {
    const a = assembleDesignNetwork(mesh, [source(), sink()]);
    const b = assembleDesignNetwork(buildDesignMesh(createDesignArea(BOUNDS), 60), [source(), sink()]);
    expect(a.network!.edges.map((e) => e.graphEdgeId)).toEqual(b.network!.edges.map((e) => e.graphEdgeId));
    expect(a.network!.terminals).toEqual(b.network!.terminals);
  });

  it("blocks candidate edges that cross a building", () => {
    const barrier = rectBarrier("b1", "building", -200, -200, 200, 200);
    const { network, diagnostics } = assembleDesignNetwork(mesh, [source(), sink()], [barrier]);
    expect(diagnostics.blockedByBuildingCount).toBeGreaterThan(0);
    expect(diagnostics.usableEdgeCount).toBeLessThan(mesh.edges.length);
    expect(network!.blockedEdgeCount).toBe(diagnostics.blockedByBuildingCount);
    for (const edge of network!.edges) expect(edge.graphEdgeId).toBeDefined();
  });

  it("blocks water the same way — Design v0 does not invent bridges", () => {
    const barrier = rectBarrier("w1", "water", -100, -300, 100, 300);
    const { diagnostics } = assembleDesignNetwork(mesh, [source(), sink()], [barrier]);
    expect(diagnostics.blockedByWaterCount).toBeGreaterThan(0);
    expect(diagnostics.blockedByBuildingCount).toBe(0);
  });

  it("reports an unreachable marker instead of silently snapping it somewhere else", () => {
    const stranded: DesignTerminal = { id: "far", role: "source", centre: atMetric(-600, 0), radiusMeters: 1, magnitude: 1 };
    const { network, issues, diagnostics } = assembleDesignNetwork(mesh, [stranded, sink()]);
    expect(network).toBeNull();
    expect(issues.map((i) => i.code)).toContain("empty-terminal-support");
    expect(diagnostics.terminals[0].nearestDistanceMeters).toBeGreaterThan(1);
  });

  it("rejects unbalanced demand", () => {
    const { network, issues } = assembleDesignNetwork(mesh, [source(2), sink(1)]);
    expect(network).toBeNull();
    expect(issues.map((i) => i.code)).toContain("unbalanced-demand");
  });

  it("rejects a non-positive magnitude", () => {
    const bad: DesignTerminal = { ...source(), magnitude: 0 };
    const { issues } = assembleDesignNetwork(mesh, [bad, sink()]);
    expect(issues.map((i) => i.code)).toContain("invalid-magnitude");
  });

  it("detects a barrier that fully separates source from sink", () => {
    const wall = rectBarrier("wall", "building", -80, -5_000, 80, 5_000);
    const { network, issues } = assembleDesignNetwork(mesh, [source(), sink()], [wall]);
    expect(network).toBeNull();
    expect(issues.map((i) => i.code)).toContain("terminals-disconnected");
  });

  /**
   * The hydraulic solve is the ONLY part shared with Analyze:
   *
   *              shared hydraulics (weighted Laplacian / CG)
   *                            |
   *              +-------------+-------------+
   *           ANALYZE                     DESIGN
   *        graph Hill adaptation     continuum Hu-Cai / IMEX
   *
   * Design must never be driven by the Analyze adaptation law, so this asserts
   * the shared solver accepts the Design network and stops there.
   */
  it("is valid input for the shared hydraulic solver", () => {
    const { network } = assembleDesignNetwork(mesh, [source(), sink()]);
    const solution = solveHydraulics(network!, Object.fromEntries(network!.edges.map((edge) => [edge.graphEdgeId, 1])));
    expect(solution.maximumKirchhoffResidual).toBeLessThan(1e-9);
    for (const value of Object.values(solution.pressures)) expect(Number.isFinite(value)).toBe(true);
    for (const value of Object.values(solution.flows)) expect(Number.isFinite(value)).toBe(true);
  });

  it("evolves under the continuum Design law, not the Analyze graph law", () => {
    const { network } = assembleDesignNetwork(mesh, [source(), sink()]);
    const state = runDesignField(network!, { maxIterations: 60 });
    expect(state.error).toBeNull();
    expect(state.diagnostics.maximumKirchhoffResidual).toBeLessThan(1e-6);
    for (const value of Object.values(state.conductivity)) expect(Number.isFinite(value)).toBe(true);
    for (const value of Object.values(state.fluxDensity)) expect(Number.isFinite(value)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { GISBounds } from "../gis/types";
import { DEFAULT_DESIGN_ADAPTATION, runDesignField } from "./adaptation";
import { createDesignFieldCollection } from "./map-registry";
import { buildDesignMesh, createDesignArea } from "./mesh";
import { assembleDesignNetwork, type DesignTerminal } from "./network";
import { createLocalProjection } from "./projection";
import { createDesignReport, DESIGN_REPORT_SCHEMA_VERSION, serializeDesignReport } from "./report";

const BOUNDS: GISBounds = [24.02, 49.835, 24.048, 49.851];
const area = createDesignArea(BOUNDS);
const mesh = buildDesignMesh(area, 120);
const projection = createLocalProjection(area.origin);

const terminals: DesignTerminal[] = [
  { id: "src", role: "source", centre: projection.unproject([-600, 0]), radiusMeters: 200, magnitude: 1 },
  { id: "snk", role: "sink", centre: projection.unproject([600, 0]), radiusMeters: 200, magnitude: 1 },
];

const assembly = assembleDesignNetwork(mesh, terminals);
const state = runDesignField(assembly.network!, { maxIterations: 120 });

describe("design field map layer", () => {
  it("emits one LineString per candidate edge with real lon/lat", () => {
    const collection = createDesignFieldCollection(mesh, state);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features.length).toBe(mesh.edges.length);
    for (const feature of collection.features) {
      expect(feature.geometry.coordinates).toHaveLength(2);
      for (const [lon, lat] of feature.geometry.coordinates) {
        expect(lon).toBeGreaterThan(BOUNDS[0] - 0.01);
        expect(lon).toBeLessThan(BOUNDS[2] + 0.01);
        expect(lat).toBeGreaterThan(BOUNDS[1] - 0.01);
        expect(lat).toBeLessThan(BOUNDS[3] + 0.01);
      }
    }
  });

  it("normalizes to [0,1] for rendering without thresholding anything away", () => {
    const collection = createDesignFieldCollection(mesh, state);
    let sawMaximum = false;
    for (const feature of collection.features) {
      expect(feature.properties.normalizedConductivity).toBeGreaterThanOrEqual(0);
      expect(feature.properties.normalizedConductivity).toBeLessThanOrEqual(1);
      expect(feature.properties.normalizedFluxDensity).toBeGreaterThanOrEqual(0);
      expect(feature.properties.normalizedFluxDensity).toBeLessThanOrEqual(1);
      if (feature.properties.normalizedConductivity === 1) sawMaximum = true;
    }
    expect(sawMaximum).toBe(true);
    // Nothing is dropped: a continuous strength field, not an extracted network.
    expect(collection.features.length).toBe(Object.keys(state.conductivity).length);
  });

  it("is deterministic", () => {
    const a = createDesignFieldCollection(mesh, state);
    const b = createDesignFieldCollection(mesh, state);
    expect(a.features.map((f) => f.id)).toEqual(b.features.map((f) => f.id));
    expect(a.maximumConductivity).toBe(b.maximumConductivity);
  });
});

describe("design report", () => {
  const report = createDesignReport(mesh, assembly.diagnostics, DEFAULT_DESIGN_ADAPTATION, state);

  it("states the model it came from, so a result is reproducible from the report alone", () => {
    expect(report.schemaVersion).toBe(DESIGN_REPORT_SCHEMA_VERSION);
    expect(report.model.adaptation).toContain("dc/dt");
    expect(report.model.conductivityMeaning).toContain("density");
    expect(report.model.parameters.gamma).toBe(1.5);
    expect(report.model.parameters.timeStep).toBe(0.5);
  });

  it("records mesh provenance including the Gate F parity rule", () => {
    expect(report.mesh.algorithm).toBe("equilateral-triangular-voronoi");
    expect(report.mesh.rowsAreOdd).toBe(true);
    expect(report.mesh.effectiveSpacingMeters).toBeGreaterThan(0);
  });

  it("records demand conservation and terminal supports", () => {
    expect(report.assembly.totalPositiveDemand).toBeCloseTo(report.assembly.totalNegativeDemand, 12);
    for (const terminal of report.assembly.terminals) expect(terminal.supportNodeCount).toBeGreaterThan(1);
  });

  it("reports convergence honestly rather than only on success", () => {
    expect(report.result.terminationReason).toMatch(/converged|maxIterations/);
    expect(report.result.converged).toBe(report.result.terminationReason === "converged");
    expect(Number.isFinite(report.result.maxDelta)).toBe(true);
    expect(report.result.maximumKirchhoffResidual).toBeLessThan(1e-6);
  });

  it("summarises the field with aggregates, not a per-edge dump", () => {
    expect(report.result.conductivity.min).toBeLessThanOrEqual(report.result.conductivity.median);
    expect(report.result.conductivity.median).toBeLessThanOrEqual(report.result.conductivity.max);
    expect(report.result.conductivity.integralOverArea).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("de-dn-");
  });

  it("serialises deterministically", () => {
    expect(serializeDesignReport(report)).toBe(serializeDesignReport(createDesignReport(mesh, assembly.diagnostics, DEFAULT_DESIGN_ADAPTATION, state)));
  });
});

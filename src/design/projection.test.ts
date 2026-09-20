import { describe, expect, it } from "vitest";
import { haversineMeters } from "../graph/distance";
import type { GISPosition } from "../gis/types";
import { boundsCentre, createLocalProjection, projectionErrorBound } from "./projection";

const LVIV: GISPosition = [24.0316, 49.842];

describe("local metric projection", () => {
  it("places the origin at the metric origin", () => {
    const projection = createLocalProjection(LVIV);
    const [x, y] = projection.project(LVIV);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
  });

  it("round-trips lon/lat through metres to sub-millimetre accuracy", () => {
    const projection = createLocalProjection(LVIV);
    for (const offset of [[0.001, 0.001], [-0.01, 0.005], [0.02, -0.018], [-0.03, -0.03]] as const) {
      const position: GISPosition = [LVIV[0] + offset[0], LVIV[1] + offset[1]];
      const [lon, lat] = projection.unproject(projection.project(position));
      expect(haversineMeters([lon, lat], position)).toBeLessThan(1e-3);
    }
  });

  it("reproduces true ground distance within the documented error bound over a district-scale AOI", () => {
    const projection = createLocalProjection(LVIV);
    const halfExtent = 2_500;
    const bound = projectionErrorBound(LVIV, halfExtent);
    for (const bearing of [0, 30, 45, 60, 90]) {
      const radians = (bearing * Math.PI) / 180;
      const target = projection.unproject([halfExtent * Math.sin(radians), halfExtent * Math.cos(radians)]);
      const relativeError = Math.abs(haversineMeters(LVIV, target) - halfExtent) / halfExtent;
      expect(relativeError).toBeLessThan(bound);
    }
  });

  it("keeps district-scale distortion below 0.2 percent", () => {
    expect(projectionErrorBound(LVIV, 2_500)).toBeLessThan(2e-3);
  });

  it("is deterministic: the same input always yields identical metres", () => {
    const a = createLocalProjection(LVIV).project([24.05, 49.85]);
    const b = createLocalProjection(LVIV).project([24.05, 49.85]);
    expect(a).toEqual(b);
  });

  it("rejects an origin at the pole", () => {
    expect(() => createLocalProjection([0, 90])).toThrow();
  });

  it("derives the AOI centre from bounds", () => {
    expect(boundsCentre([24, 49.8, 24.06, 49.88])).toEqual([24.03, 49.84]);
  });
});

import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "../gis/ingest";
import { DEFAULT_DESIGN_BARRIER_POLICY, designBarriersFromDataset } from "./barrier-source";

function dataset(features: unknown[]) {
  return ingestGeoJSON({ type: "FeatureCollection", features }, { name: "ctx", source: { kind: "bundled", name: "ctx" } });
}
const square = (x: number, y: number) => [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]];
const polygon = (id: string, properties: Record<string, unknown>, x = 24, y = 49.8) => ({ type: "Feature", id, properties, geometry: { type: "Polygon", coordinates: square(x, y) } });

describe("design barriers from a GIS dataset", () => {
  const set = designBarriersFromDataset(dataset([
    polygon("b1", { building: "yes" }),
    polygon("b2", { building: "residential" }, 24.002),
    polygon("w1", { natural: "water" }, 24.004),
    polygon("g1", { leisure: "park" }, 24.006),
    { type: "Feature", id: "stream", properties: { waterway: "stream" }, geometry: { type: "LineString", coordinates: [[24.01, 49.8], [24.011, 49.801]] } },
  ]));

  it("promotes polygonal buildings and water to hard barriers", () => {
    expect(set.buildingCount).toBe(2);
    expect(set.waterCount).toBe(1);
    expect(set.barriers.filter((barrier) => barrier.kind === "building")).toHaveLength(2);
    expect(set.barriers.filter((barrier) => barrier.kind === "water")).toHaveLength(1);
  });

  it("keeps green as context only — Design v0 applies no green penalty", () => {
    expect(set.greenContextCount).toBe(1);
    expect(set.barriers.some((barrier) => barrier.id.includes("g1"))).toBe(false);
  });

  it("skips water with no area rather than inventing an impermeable line", () => {
    expect(set.skippedNonPolygonCount).toBeGreaterThan(0);
    expect(set.barriers.every((barrier) => barrier.geometry.type === "Polygon" || barrier.geometry.type === "MultiPolygon")).toBe(true);
  });

  it("honours the policy toggles while still reporting what exists", () => {
    const off = designBarriersFromDataset(dataset([polygon("b1", { building: "yes" }), polygon("w1", { natural: "water" }, 24.004)]), { buildings: false, water: true });
    expect(off.buildingCount).toBe(1);
    expect(off.barriers.every((barrier) => barrier.kind === "water")).toBe(true);
    const none = designBarriersFromDataset(dataset([polygon("b1", { building: "yes" })]), { buildings: false, water: false });
    expect(none.barriers).toHaveLength(0);
  });

  it("defaults to both hard classes on", () => {
    expect(DEFAULT_DESIGN_BARRIER_POLICY).toEqual({ buildings: true, water: true });
  });

  it("is deterministic", () => {
    expect(designBarriersFromDataset(dataset([polygon("b1", { building: "yes" })]))).toEqual(designBarriersFromDataset(dataset([polygon("b1", { building: "yes" })])));
  });
});

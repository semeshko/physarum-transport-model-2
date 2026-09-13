import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "./ingest";
import { clipLineDatasetToBounds } from "./clip-lines";

const options = { name: "clip", source: { kind: "file" as const, name: "clip" } };
function dataset(coordinates: number[][], anchored = true) {
  return ingestGeoJSON({ type: "FeatureCollection", features: [{ type: "Feature", id: "road-1", properties: { highway: "residential" }, geometry: { type: "LineString", coordinates }, ...(anchored ? { lineTopology: { mode: "authoritative", vertexAnchors: [coordinates.map((_, index) => ({ id: `n-${index}`, kind: "source" }))], missingExpectedAnchors: false } } : {}) }] }, options);
}

describe("line clipping to an AOI", () => {
  it("clips a partially outside line and creates a boundary anchor", () => {
    const clipped = clipLineDatasetToBounds(dataset([[-1, 0.5], [0.5, 0.5]]), [0, 0, 1, 1]);
    expect(clipped.features[0].geometry).toEqual({ type: "LineString", coordinates: [[0, 0.5], [0.5, 0.5]] });
    expect(clipped.features[0].lineTopology?.vertexAnchors[0][0]).toMatchObject({ kind: "boundary", id: expect.stringContaining("road-1") });
    expect(clipped.bounds).toEqual([0, 0.5, 0.5, 0.5]);
  });

  it("keeps multiple inside portions when a polyline crosses the AOI repeatedly", () => {
    const clipped = clipLineDatasetToBounds(dataset([[-1, 0.25], [2, 0.25], [-1, 0.75], [2, 0.75]]), [0, 0, 1, 1]);
    expect(clipped.features[0].geometry.type).toBe("MultiLineString");
    expect(clipped.features[0].lineTopology?.vertexAnchors).toHaveLength(3);
  });

  it("drops fully outside lines and preserves geometry-only GeoJSON semantics", () => {
    expect(clipLineDatasetToBounds(dataset([[-2, -2], [-1, -1]]), [0, 0, 1, 1]).featureCount).toBe(0);
    const clipped = clipLineDatasetToBounds(dataset([[-1, 0.5], [0.5, 0.5]], false), [0, 0, 1, 1]);
    expect(clipped.features[0].lineTopology).toBeUndefined();
  });

  it("is deterministic and does not mutate the source dataset", () => {
    const source = dataset([[-1, 0.5], [0.5, 0.5]]); const before = JSON.stringify(source);
    expect(clipLineDatasetToBounds(source, [0, 0, 1, 1])).toEqual(clipLineDatasetToBounds(source, [0, 0, 1, 1]));
    expect(JSON.stringify(source)).toBe(before);
  });
});

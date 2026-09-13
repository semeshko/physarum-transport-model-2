import { describe, expect, it } from "vitest";
import { classifyFeature } from "./classification";
import { GISIngestionError, ingestGeoJSON } from "./ingest";

const options = { name: "test.geojson", source: { kind: "file" as const, name: "test.geojson" } };

function collection(features: unknown[]) {
  return { type: "FeatureCollection", features };
}

function feature(properties: Record<string, unknown> = {}, coordinates: number[] = [24, 49]) {
  return { type: "Feature", properties, geometry: { type: "Point", coordinates } };
}

describe("GeoJSON ingestion", () => {
  it("imports a valid FeatureCollection", () => {
    const dataset = ingestGeoJSON(collection([feature({ highway: "primary" })]), options);
    expect(dataset.featureCount).toBe(1);
    expect(dataset.crs).toBe("EPSG:4326");
    expect(dataset.features[0].category).toBe("road");
  });

  it("rejects coordinates outside WGS84 longitude/latitude ranges", () => {
    expect(() => ingestGeoJSON(collection([feature({}, [181, 49])]), options)).toThrow(GISIngestionError);
    expect(() => ingestGeoJSON(collection([feature({}, [24, -91])]), options)).toThrow(/latitude/i);
  });

  it.each([
    [{ highway: "primary" }, "road"],
    [{ building: "yes" }, "building"],
    [{ waterway: "river" }, "water"],
  ] as const)("classifies %j as %s", (properties, expected) => {
    expect(classifyFeature(properties)).toBe(expected);
  });

  it("generates stable IDs when source IDs are missing", () => {
    const input = collection([feature({ name: "same" })]);
    const first = ingestGeoJSON(input, options);
    const second = ingestGeoJSON(input, options);
    expect(first.features[0].id).toMatch(/^generated-/);
    expect(first.features[0].id).toBe(second.features[0].id);
  });

  it("calculates bounds across nested geometry coordinates", () => {
    const input = collection([
      { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [[[20, 40], [22, 44]], [[19, 43], [23, 41]]] } },
    ]);
    expect(ingestGeoJSON(input, options).bounds).toEqual([19, 40, 23, 44]);
  });

  it("does not mutate source objects", () => {
    const originalFeature = feature({ highway: "footway", nested: { value: 1 } });
    const input = collection([originalFeature]);
    const snapshot = JSON.stringify(input);
    const dataset = ingestGeoJSON(input, options);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(dataset.features[0].properties).not.toBe(originalFeature.properties);
  });

  it("rejects GeometryCollection with a clear message", () => {
    const input = collection([{ type: "Feature", properties: {}, geometry: { type: "GeometryCollection", geometries: [] } }]);
    expect(() => ingestGeoJSON(input, options)).toThrow(/GeometryCollection is not supported/i);
  });
});

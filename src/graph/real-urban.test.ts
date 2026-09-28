import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ingestGeoJSON } from "../gis/ingest";
import { applyTransportProfile } from "../transport-profile/profile";
import { buildTransportGraph } from "./build";

/**
 * Behaviour that only shows up on real urban data.
 *
 * The tag combinations below are taken from the OSM extract used for Task 18C
 * QA (central Lviv, api.openstreetmap.org map.json), not invented: that slice
 * contains primary/secondary/tertiary/residential/service roads, pedestrian
 * streets, footways, steps, cycleways, and 23 `railway=tram` ways.
 */
const options = { name: "urban.geojson", source: { kind: "file" as const, name: "urban.geojson" } };
const line = (id: string, properties: Record<string, unknown>, coordinates: number[][]) => ({ type: "Feature", id, properties, geometry: { type: "LineString", coordinates } });
const build = (features: unknown[]) => buildTransportGraph(ingestGeoJSON({ type: "FeatureCollection", features }, options));
const ingest = (features: unknown[]) => ingestGeoJSON({ type: "FeatureCollection", features }, options);

const horizontal = [[24.030, 49.840], [24.036, 49.840]];
const vertical = [[24.033, 49.837], [24.033, 49.843]];

describe("real OSM transport classification", () => {
  it("splits carriageways from pedestrian ways and keeps rail separate", () => {
    const dataset = ingest([
      line("primary", { highway: "primary", name: "Prospekt Svobody" }, horizontal),
      line("residential", { highway: "residential" }, horizontal),
      line("service", { highway: "service" }, horizontal),
      line("footway", { highway: "footway" }, horizontal),
      line("steps", { highway: "steps" }, horizontal),
      line("pedestrian", { highway: "pedestrian" }, horizontal),
      line("cycleway", { highway: "cycleway" }, horizontal),
      line("tram", { railway: "tram" }, horizontal),
    ]);
    // primary / residential / service are carriageways; pedestrian streets are
    // classified with footways and steps, which is what the profile rules expect.
    expect(dataset.categoryCounts.road).toBe(3);
    expect(dataset.categoryCounts.path).toBe(4);
    expect(dataset.categoryCounts.railway).toBe(1);
  });

  it("treats a way tagged both highway and railway as street infrastructure", () => {
    // Tram track laid in a carriageway: the surface is drivable, so it is a road.
    const dataset = ingest([line("mixed", { highway: "secondary", railway: "tram" }, horizontal)]);
    expect(dataset.categoryCounts.road).toBe(1);
    expect(dataset.categoryCounts.railway).toBe(0);
  });
});

/**
 * Rail is ingested, categorised and rendered, but it is NOT part of the
 * TransportGraph: `buildTransportGraph` admits only road and path. A tram line
 * therefore cannot contribute nodes, edges, or connectivity to Analyze. That
 * is the current architectural boundary, recorded here so a future rail model
 * has to change it deliberately rather than by accident.
 */
describe("rail is not part of the Analyze transport graph", () => {
  it("ignores a tram line entirely", () => {
    const withoutRail = build([line("road", { highway: "primary" }, horizontal)]);
    const withRail = build([line("road", { highway: "primary" }, horizontal), line("tram", { railway: "tram" }, vertical)]);
    expect(withRail.diagnostics.nodeCount).toBe(withoutRail.diagnostics.nodeCount);
    expect(withRail.diagnostics.edgeCount).toBe(withoutRail.diagnostics.edgeCount);
  });

  it("does not connect a road to a tram line that crosses it", () => {
    const graph = build([line("road", { highway: "primary" }, horizontal), line("tram", { railway: "tram" }, vertical)]);
    expect(graph.diagnostics.connectedComponentCount).toBe(1);
    expect(graph.edges.every((edge) => edge.provenance.every((item) => item.sourceFeatureId !== "tram"))).toBe(true);
  });

  it("still connects two roads crossing at grade", () => {
    const graph = build([line("road", { highway: "primary" }, horizontal), line("cross", { highway: "residential" }, vertical)]);
    expect(graph.diagnostics.geometricIntersectionCount).toBeGreaterThan(0);
    expect(graph.diagnostics.connectedComponentCount).toBe(1);
    expect(graph.diagnostics.gradeSeparatedCrossingsIgnored).toBe(0);
  });
});

describe("transport profiles on real tags", () => {
  const graph = build([
    line("primary", { highway: "primary" }, horizontal),
    line("footway", { highway: "footway" }, [[24.030, 49.841], [24.036, 49.841]]),
    line("cycleway", { highway: "cycleway" }, [[24.030, 49.842], [24.036, 49.842]]),
    line("steps", { highway: "steps" }, [[24.030, 49.843], [24.036, 49.843]]),
  ]);
  const usable = (profile: "motor" | "pedestrian" | "bicycle") =>
    new Set(applyTransportProfile(graph, profile).usableEdges.flatMap((edge) => edge.provenance.map((item) => item.sourceFeatureId)));

  it("gives motor the carriageway only", () => {
    expect(usable("motor")).toEqual(new Set(["primary"]));
  });

  it("gives pedestrians footways and steps but not the cycleway", () => {
    const result = usable("pedestrian");
    expect(result.has("footway")).toBe(true);
    expect(result.has("steps")).toBe(true);
    expect(result.has("cycleway")).toBe(false);
  });

  it("gives bicycles the cycleway and the road but not steps", () => {
    const result = usable("bicycle");
    expect(result.has("cycleway")).toBe(true);
    expect(result.has("primary")).toBe(true);
    expect(result.has("steps")).toBe(false);
  });

  it("changes which edges are usable when the mode changes", () => {
    expect(usable("motor")).not.toEqual(usable("pedestrian"));
  });
});

/**
 * The synthetic fixture is a developer aid. It used to be the startup dataset,
 * so a user opening the app saw small straight test edges drawn over a real
 * basemap and read them as proposed roads. It must stay reachable for tests and
 * behind an explicit action, but never load on its own.
 */
describe("synthetic sample is not the default workspace dataset", () => {
  const source = readFileSync("src/components/MapWorkspace.tsx", "utf8");

  it("starts the workspace from an empty dataset", () => {
    expect(source).toMatch(/useState<GISDataset>\(EMPTY_DATASET\)/);
    expect(source).not.toMatch(/useState<GISDataset>\(initialDataset\)/);
  });

  it("keeps the fixture behind an explicit action", () => {
    expect(source).toMatch(/Load synthetic demo/);
    expect(source).toMatch(/function loadSyntheticSample/);
  });

  it("still ingests cleanly when it is asked for", () => {
    const sample = JSON.parse(readFileSync("src/data/sample-urban.json", "utf8"));
    expect(ingestGeoJSON(sample, options).featureCount).toBeGreaterThan(0);
  });
});

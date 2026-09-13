export const SMALL_OSM_RESPONSE_FIXTURE = {
  version: 0.6,
  generator: "Overpass API fixture",
  osm3s: { timestamp_osm_base: "2026-09-13T12:00:00Z" },
  elements: [
    { type: "way", id: 101, nodes: [1, 10, 2], tags: { highway: "residential", name: "Test Street", surface: "asphalt", oneway: "yes", access: "yes", motor_vehicle: "yes" }, geometry: [{ lat: 49.84, lon: 24.03 }, { lat: 49.84, lon: 24.031 }, { lat: 49.84, lon: 24.032 }] },
    { type: "way", id: 102, nodes: [3, 10, 4], tags: { highway: "footway", bridge: "yes", layer: "1", foot: "designated", bicycle: "yes" }, geometry: [{ lat: 49.8395, lon: 24.031 }, { lat: 49.84, lon: 24.031 }, { lat: 49.8405, lon: 24.031 }] },
    { type: "way", id: 103, nodes: [5, 6], tags: { highway: "path", tunnel: "yes", layer: "-1" }, geometry: [{ lat: 49.8398, lon: 24.0305 }, { lat: 49.8402, lon: 24.0315 }] },
    { type: "way", id: 104, nodes: [2, 7], tags: { highway: "service" }, geometry: [{ lat: 49.84, lon: 24.032 }, { lat: 49.8405, lon: 24.0325 }] },
    { type: "node", id: 999, tags: { highway: "crossing" }, lat: 49.84, lon: 24.031 },
    { type: "way", id: "bad-id", tags: { highway: "residential" }, geometry: [{ lat: 49.84, lon: 24.03 }, { lat: 49.84, lon: 24.031 }] },
    { type: "way", id: 105, tags: { highway: "cycleway" }, geometry: [{ lat: "bad", lon: 24.03 }, { lat: 49.84, lon: 24.031 }] },
  ],
} as const;

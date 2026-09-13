import type { GISBounds, GISFeature, GISGeometry, GISPosition } from "./types";

function positions(geometry: GISGeometry): readonly GISPosition[] {
  switch (geometry.type) {
    case "Point": return [geometry.coordinates];
    case "LineString": return geometry.coordinates;
    case "MultiLineString":
    case "Polygon": return geometry.coordinates.flat();
    case "MultiPolygon": return geometry.coordinates.flat(2);
  }
}

export function calculateBounds(features: readonly GISFeature[]): GISBounds | null {
  if (features.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const feature of features) {
    for (const [longitude, latitude] of positions(feature.geometry)) {
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    }
  }

  return [west, south, east, north];
}

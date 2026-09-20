import type { GISBounds, GISPosition } from "../gis/types";

const EARTH_RADIUS_METERS = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (value: number) => (value * 180) / Math.PI;

/**
 * Local tangent-plane (equirectangular) projection anchored at `origin`.
 *
 * Design Mode is metric-first: candidate generation, barrier geometry, edge
 * lengths and future cost fields all live in this plane, and lon/lat is only
 * reconstructed for rendering/export. Equirectangular is exact along the
 * origin parallel and degrades with the square of the latitude offset, which
 * is why `projectionErrorBound` is exposed and Design AOIs are capped at
 * district scale rather than city-wide.
 */
export type LocalProjection = {
  readonly origin: GISPosition;
  readonly project: (position: GISPosition) => readonly [number, number];
  readonly unproject: (metric: readonly [number, number]) => GISPosition;
};

export function createLocalProjection(origin: GISPosition): LocalProjection {
  const [originLon, originLat] = origin;
  const cosLat = Math.cos(radians(originLat));
  if (!Number.isFinite(cosLat) || Math.abs(cosLat) < 1e-9) throw new Error("Local projection origin is too close to a pole.");
  return {
    origin,
    project: ([lon, lat]) => [radians(lon - originLon) * EARTH_RADIUS_METERS * cosLat, radians(lat - originLat) * EARTH_RADIUS_METERS],
    unproject: ([x, y]) => [originLon + degrees(x / (EARTH_RADIUS_METERS * cosLat)), originLat + degrees(y / EARTH_RADIUS_METERS)],
  };
}

export function boundsCentre(bounds: GISBounds): GISPosition {
  const [west, south, east, north] = bounds;
  return [(west + east) / 2, (south + north) / 2];
}

/**
 * Worst-case relative distance error of the tangent-plane approximation over a
 * half-extent of `halfExtentMeters` from the origin. Derived from the
 * second-order term of cos(lat) about the origin parallel.
 */
export function projectionErrorBound(origin: GISPosition, halfExtentMeters: number): number {
  const deltaLat = halfExtentMeters / EARTH_RADIUS_METERS;
  const originLat = radians(origin[1]);
  return Math.abs(Math.tan(originLat) * deltaLat) + 0.5 * deltaLat * deltaLat;
}

import type { GISPosition } from "../gis/types";
import type { SegmentPolygonRelation } from "./types";

const EPSILON = 1e-10;
type PolygonCoordinates = readonly (readonly GISPosition[])[];

function cross(a: GISPosition, b: GISPosition, c: GISPosition): number { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(point: GISPosition, a: GISPosition, b: GISPosition): boolean { return Math.abs(cross(a, b, point)) <= EPSILON && point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON && point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON; }
function ringLocation(point: GISPosition, ring: readonly GISPosition[]): "inside" | "outside" | "boundary" {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[previous], b = ring[index];
    if (onSegment(point, a, b)) return "boundary";
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? "inside" : "outside";
}
function polygonLocation(point: GISPosition, polygon: PolygonCoordinates): "inside" | "outside" | "boundary" {
  const outer = ringLocation(point, polygon[0]);
  if (outer !== "inside") return outer;
  for (const hole of polygon.slice(1)) { const location = ringLocation(point, hole); if (location === "boundary") return "boundary"; if (location === "inside") return "outside"; }
  return "inside";
}
function intersectionParameter(a: GISPosition, b: GISPosition, c: GISPosition, d: GISPosition): number | null {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= EPSILON) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denominator, u = (qx * ry - qy * rx) / denominator;
  return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON ? Math.max(0, Math.min(1, t)) : null;
}
function pointAt(a: GISPosition, b: GISPosition, t: number): GISPosition { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
function polygonIntervals(a: GISPosition, b: GISPosition, polygon: PolygonCoordinates): { intervals: [number, number][]; touches: number[] } {
  const parameters = [0, 1];
  for (const ring of polygon) for (let index = 1; index < ring.length; index += 1) { const t = intersectionParameter(a, b, ring[index - 1], ring[index]); if (t !== null) parameters.push(t); }
  const unique = [...new Set(parameters.map((value) => Number(value.toFixed(12))))].sort((left, right) => left - right);
  const intervals: [number, number][] = [];
  for (let index = 1; index < unique.length; index += 1) { const start = unique[index - 1], end = unique[index]; if (end - start > EPSILON && polygonLocation(pointAt(a, b, (start + end) / 2), polygon) === "inside") intervals.push([start, end]); }
  return { intervals, touches: unique.filter((value) => value > EPSILON && value < 1 - EPSILON || polygonLocation(pointAt(a, b, value), polygon) === "boundary") };
}
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]); const merged: [number, number][] = [];
  for (const interval of sorted) { const last = merged.at(-1); if (!last || interval[0] > last[1] + EPSILON) merged.push([...interval]); else last[1] = Math.max(last[1], interval[1]); }
  return merged;
}
export function relateSegmentToPolygons(a: GISPosition, b: GISPosition, polygons: readonly PolygonCoordinates[]): SegmentPolygonRelation {
  const allIntervals: [number, number][] = []; const touches: number[] = [];
  for (const polygon of polygons) { const result = polygonIntervals(a, b, polygon); allIntervals.push(...result.intervals); touches.push(...result.touches); }
  const intervals = mergeIntervals(allIntervals); const affectedFraction = intervals.reduce((sum, [start, end]) => sum + end - start, 0);
  const intersectionPoints = [...new Set(touches.map((value) => value.toFixed(12)))].map((value) => pointAt(a, b, Number(value)));
  if (affectedFraction >= 1 - EPSILON) return { relation: "inside", affectedFraction: 1, intersectionPoints };
  if (affectedFraction > EPSILON) return { relation: "intersects", affectedFraction, intersectionPoints };
  if (intersectionPoints.length || polygons.some((polygon) => polygonLocation(a, polygon) === "boundary" || polygonLocation(b, polygon) === "boundary")) return { relation: "boundary-touch", affectedFraction: 0, intersectionPoints };
  return { relation: "outside", affectedFraction: 0, intersectionPoints: [] };
}

export function geometryPolygons(geometry: { readonly type: "Polygon" | "MultiPolygon"; readonly coordinates: unknown }): readonly PolygonCoordinates[] {
  return geometry.type === "Polygon" ? [geometry.coordinates as PolygonCoordinates] : geometry.coordinates as readonly PolygonCoordinates[];
}

export function bboxesOverlap(edge: readonly [GISPosition, GISPosition], geometry: { readonly type: "Polygon" | "MultiPolygon"; readonly coordinates: unknown }): boolean {
  const values: GISPosition[] = (geometry.type === "Polygon" ? geometry.coordinates as PolygonCoordinates : (geometry.coordinates as readonly PolygonCoordinates[]).flat()).flat() as GISPosition[];
  const minX = Math.min(...values.map((p) => p[0])), maxX = Math.max(...values.map((p) => p[0])), minY = Math.min(...values.map((p) => p[1])), maxY = Math.max(...values.map((p) => p[1]));
  return Math.max(edge[0][0], edge[1][0]) >= minX && Math.min(edge[0][0], edge[1][0]) <= maxX && Math.max(edge[0][1], edge[1][1]) >= minY && Math.min(edge[0][1], edge[1][1]) <= maxY;
}

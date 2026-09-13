import type { GISBounds } from "../gis/types";

export type OverpassGeometryPoint = { readonly lat: number; readonly lon: number };
export type OverpassElement = {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly tags?: unknown;
  readonly geometry?: unknown;
  readonly nodes?: unknown;
};
export type OverpassResponse = { readonly elements: readonly OverpassElement[]; readonly osm3s?: { readonly timestamp_osm_base?: unknown } };
export type OSMImportSummary = {
  readonly bounds: GISBounds;
  readonly wayCount: number;
  readonly skippedElementCount: number;
  readonly fetchMilliseconds: number;
  readonly adapterMilliseconds: number;
  readonly warnings: readonly string[];
  readonly missingTopologyWayCount: number;
};

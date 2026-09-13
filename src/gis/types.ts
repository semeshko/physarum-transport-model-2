export const GIS_CRS = "EPSG:4326" as const;

export type GISCategory =
  | "road"
  | "path"
  | "building"
  | "water"
  | "railway"
  | "green"
  | "unknown";

export const GIS_CATEGORIES: readonly GISCategory[] = [
  "road",
  "path",
  "building",
  "water",
  "railway",
  "green",
  "unknown",
];

export type GISPosition = readonly [longitude: number, latitude: number];
export type GISGeometry =
  | { readonly type: "Point"; readonly coordinates: GISPosition }
  | { readonly type: "LineString"; readonly coordinates: readonly GISPosition[] }
  | { readonly type: "MultiLineString"; readonly coordinates: readonly (readonly GISPosition[])[] }
  | { readonly type: "Polygon"; readonly coordinates: readonly (readonly GISPosition[])[] }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly (readonly (readonly GISPosition[])[])[] };

export type GISGeometryType = GISGeometry["type"];
export type GISBounds = readonly [west: number, south: number, east: number, north: number];
export type GISProperties = Readonly<Record<string, unknown>>;
export type GISVertexAnchor = { readonly id: string; readonly kind: "source" | "boundary" | "fallback" };
export type GISLineTopology = {
  readonly mode: "authoritative";
  readonly vertexAnchors: readonly (readonly GISVertexAnchor[])[];
  readonly missingExpectedAnchors: boolean;
};

export type GISFeature = {
  readonly id: string;
  readonly geometry: GISGeometry;
  readonly properties: GISProperties;
  readonly category: GISCategory;
  readonly lineTopology?: GISLineTopology;
};

export type GISDatasetSource = {
  readonly kind: "bundled" | "file" | "osm";
  readonly name: string;
};

export type GISDataset = {
  readonly id: string;
  readonly name: string;
  readonly source: GISDatasetSource;
  readonly crs: typeof GIS_CRS;
  readonly featureCount: number;
  readonly features: readonly GISFeature[];
  readonly bounds: GISBounds | null;
  readonly geometryTypes: readonly GISGeometryType[];
  readonly categoryCounts: Readonly<Record<GISCategory, number>>;
  readonly warnings: readonly string[];
};

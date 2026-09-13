import type { GeoJSONSourceSpecification } from "maplibre-gl";
import type { GISBounds } from "../gis/types";
import type { LayerRegistry } from "../map/layer-registry";

type MapGeoJSON = Exclude<GeoJSONSourceSpecification["data"], string>;

export function addOSMAreaToRegistry(base: LayerRegistry, bounds: GISBounds | null): LayerRegistry {
  if (!bounds) return base;
  const [west, south, east, north] = bounds;
  const data = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } } as unknown as MapGeoJSON;
  return {
    sources: [...base.sources, { id: "osm-selected-area-source", definition: { type: "geojson", data } }],
    layers: [...base.layers,
      { id: "osm-selected-area-fill", type: "fill", source: "osm-selected-area-source", visible: true, paint: { "fill-color": "#42d9c8", "fill-opacity": 0.08 } },
      { id: "osm-selected-area-outline", type: "line", source: "osm-selected-area-source", visible: true, paint: { "line-color": "#42d9c8", "line-width": 2, "line-dasharray": [2, 2] } },
    ],
  };
}

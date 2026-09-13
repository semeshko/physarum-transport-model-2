import type { FilterSpecification, GeoJSONSourceSpecification } from "maplibre-gl";
import { createLayerRegistry, type LayerRegistry } from "@/map/layer-registry";
import type { GISCategory, GISDataset } from "./types";

export const GIS_LAYER_IDS = {
  roadsPaths: "gis-roads-paths",
  buildings: "gis-buildings",
  water: "gis-water",
  green: "gis-green",
} as const;

export type GISLayerGroup = keyof typeof GIS_LAYER_IDS;
export type GISLayerVisibility = Readonly<Record<GISLayerGroup, boolean>>;

export const DEFAULT_GIS_LAYER_VISIBILITY: GISLayerVisibility = {
  roadsPaths: true,
  buildings: true,
  water: true,
  green: true,
};

function categoryFilter(categories: readonly GISCategory[]): FilterSpecification {
  return ["match", ["get", "__category"], [...categories], true, false];
}

type MapGeoJSON = Exclude<GeoJSONSourceSpecification["data"], string>;

export function datasetToFeatureCollection(dataset: GISDataset): MapGeoJSON {
  return {
    type: "FeatureCollection",
    features: dataset.features.map((feature) => ({
      type: "Feature",
      id: feature.id,
      properties: { ...feature.properties, __category: feature.category, __featureId: feature.id },
      geometry: JSON.parse(JSON.stringify(feature.geometry)),
    })),
  } as MapGeoJSON;
}

export function createGISLayerRegistry(dataset: GISDataset, visibility: GISLayerVisibility): LayerRegistry {
  const source = "gis-dataset";
  return createLayerRegistry(
    [{ id: source, definition: { type: "geojson", data: datasetToFeatureCollection(dataset) } }],
    [
      { id: GIS_LAYER_IDS.green, type: "fill", source, visible: visibility.green, filter: categoryFilter(["green"]), paint: { "fill-color": "#48a868", "fill-opacity": 0.4, "fill-outline-color": "#70d28c" } },
      { id: GIS_LAYER_IDS.water, type: "fill", source, visible: visibility.water, filter: categoryFilter(["water"]), paint: { "fill-color": "#3182b8", "fill-opacity": 0.5, "fill-outline-color": "#67b7e1" } },
      { id: "gis-water-lines", type: "line", source, visible: visibility.water, filter: categoryFilter(["water"]), paint: { "line-color": "#58b9e8", "line-width": 4, "line-opacity": 0.85 } },
      { id: GIS_LAYER_IDS.buildings, type: "fill", source, visible: visibility.buildings, filter: categoryFilter(["building"]), paint: { "fill-color": "#9b8b7b", "fill-opacity": 0.62, "fill-outline-color": "#c4b3a2" } },
      { id: GIS_LAYER_IDS.roadsPaths, type: "line", source, visible: visibility.roadsPaths, filter: categoryFilter(["road", "path"]), paint: { "line-color": ["match", ["get", "__category"], "path", "#e7bf65", "#f3f4f6"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 15, 5], "line-opacity": 0.92 } },
    ],
  );
}

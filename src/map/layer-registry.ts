import type { CircleLayerSpecification, FillLayerSpecification, GeoJSONSource, GeoJSONSourceSpecification, LayerSpecification, LineLayerSpecification, Map as MapLibreMap } from "maplibre-gl";

export type SourceRegistration = { id: string; definition: GeoJSONSourceSpecification };
type RegisteredLineLayer = { id: string; type: "line"; source: string; visible: boolean; paint?: LineLayerSpecification["paint"]; layout?: Omit<NonNullable<LineLayerSpecification["layout"]>, "visibility">; filter?: LineLayerSpecification["filter"] };
type RegisteredFillLayer = { id: string; type: "fill"; source: string; visible: boolean; paint?: FillLayerSpecification["paint"]; layout?: Omit<NonNullable<FillLayerSpecification["layout"]>, "visibility">; filter?: FillLayerSpecification["filter"] };
type RegisteredCircleLayer = { id: string; type: "circle"; source: string; visible: boolean; paint?: CircleLayerSpecification["paint"]; layout?: Omit<NonNullable<CircleLayerSpecification["layout"]>, "visibility">; filter?: CircleLayerSpecification["filter"] };
export type LayerRegistration = RegisteredLineLayer | RegisteredFillLayer | RegisteredCircleLayer;
export type LayerRegistry = { sources: readonly SourceRegistration[]; layers: readonly LayerRegistration[] };

export function createLayerRegistry(sources: readonly SourceRegistration[], layers: readonly LayerRegistration[]): LayerRegistry {
  const sourceIds = new Set(sources.map(({ id }) => id));
  if (sourceIds.size !== sources.length) throw new Error("Source IDs must be unique.");
  const layerIds = new Set(layers.map(({ id }) => id));
  if (layerIds.size !== layers.length) throw new Error("Layer IDs must be unique.");
  for (const layer of layers) if (!sourceIds.has(layer.source)) throw new Error(`Layer "${layer.id}" references an unknown source.`);
  return { sources: [...sources], layers: [...layers] };
}

export function setLayerVisibility(registry: LayerRegistry, layerId: string, visible: boolean): LayerRegistry {
  if (!registry.layers.some(({ id }) => id === layerId)) throw new Error(`Unknown layer "${layerId}".`);
  return { ...registry, layers: registry.layers.map((layer) => layer.id === layerId ? { ...layer, visible } : layer) };
}

export function installLayerRegistry(map: MapLibreMap, registry: LayerRegistry): void {
  for (const source of registry.sources) if (!map.getSource(source.id)) map.addSource(source.id, source.definition);
  for (const layer of registry.layers) {
    if (map.getLayer(layer.id)) continue;
    const { visible, ...specification } = layer;
    map.addLayer({ ...specification, layout: { ...layer.layout, visibility: visible ? "visible" : "none" } } as LayerSpecification);
  }
}

export function syncLayerRegistry(map: MapLibreMap, registry: LayerRegistry): void {
  for (const source of registry.sources) {
    const existing = map.getSource(source.id) as GeoJSONSource | undefined;
    if (existing) existing.setData(source.definition.data);
    else map.addSource(source.id, source.definition);
  }
  installLayerRegistry(map, registry);
  for (const layer of registry.layers) if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, "visibility", layer.visible ? "visible" : "none");
}

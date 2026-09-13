import type { GeoJSONSourceSpecification, LineLayerSpecification, Map as MapLibreMap } from "maplibre-gl";

export type SourceRegistration = { id: string; definition: GeoJSONSourceSpecification };
export type LayerRegistration = { id: string; type: "line"; source: string; visible: boolean; paint: NonNullable<LineLayerSpecification["paint"]>; layout?: Omit<NonNullable<LineLayerSpecification["layout"]>, "visibility"> };
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
  for (const layer of registry.layers) if (!map.getLayer(layer.id)) map.addLayer({ id: layer.id, type: layer.type, source: layer.source, paint: layer.paint, layout: { ...layer.layout, visibility: layer.visible ? "visible" : "none" } });
}

export function syncLayerVisibility(map: MapLibreMap, registry: LayerRegistry): void {
  for (const layer of registry.layers) if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, "visibility", layer.visible ? "visible" : "none");
}

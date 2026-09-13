"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, MapMouseEvent, ProjectionSpecification } from "maplibre-gl";
import { installLayerRegistry, syncLayerRegistry, type LayerRegistry } from "@/map/layer-registry";
import type { GISBounds } from "@/gis/types";

export type CameraCommand =
  | { id: number; type: "zoom-in" | "zoom-out" | "reset" }
  | { id: number; type: "fit-bounds"; bounds: GISBounds };
export type MapFeatureSelection = { readonly kind: "node" | "edge"; readonly id: string };
type Props = { cameraCommand: CameraCommand | null; projection: "mercator" | "globe"; registry: LayerRegistry; onFeatureSelect?: (selection: MapFeatureSelection) => void };
const INITIAL_VIEW = { center: [24.0316, 49.8429] as [number, number], zoom: 12, bearing: 0, pitch: 0 };
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export function MapCanvas({ cameraCommand, projection, registry, onFeatureSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const registryRef = useRef(registry);
  const projectionRef = useRef(projection);
  const selectionRef = useRef(onFeatureSelect);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    registryRef.current = registry;
  }, [registry]);

  useEffect(() => {
    projectionRef.current = projection;
  }, [projection]);

  useEffect(() => {
    selectionRef.current = onFeatureSelect;
  }, [onFeatureSelect]);

  useEffect(() => {
    let cancelled = false;
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;

    async function initialiseMap() {
      try {
        const maplibregl = await import("maplibre-gl");
        if (cancelled || !containerRef.current) return;
        const map = new maplibregl.Map({ container: containerRef.current, style: BASEMAP_STYLE, ...INITIAL_VIEW, attributionControl: { compact: true } });
        mapRef.current = map;
        map.on("style.load", () => {
          if (cancelled) return;
          map.setProjection({ type: projectionRef.current });
          installLayerRegistry(map, registryRef.current);
          setIsLoading(false);
          if (loadingTimer) clearTimeout(loadingTimer);
        });
        map.on("click", (event: MapMouseEvent) => {
          const features = map.queryRenderedFeatures(event.point, { layers: ["transport-graph-nodes", "transport-graph-edges"] });
          const nodeId = features.find((feature) => feature.layer.id === "transport-graph-nodes")?.properties?.nodeId;
          if (typeof nodeId === "string") { selectionRef.current?.({ kind: "node", id: nodeId }); return; }
          const edgeId = features.find((feature) => feature.layer.id === "transport-graph-edges")?.properties?.edgeId;
          if (typeof edgeId === "string") selectionRef.current?.({ kind: "edge", id: edgeId });
        });
        loadingTimer = setTimeout(() => {
          if (!cancelled && !map.isStyleLoaded()) {
            setError("The basemap is taking too long to load. Check your connection and reload.");
            setIsLoading(false);
          }
        }, 15_000);
      } catch (caught) {
        console.error("MapLibre initialisation failed", caught);
        if (!cancelled) {
          setError("The map could not be started in this browser. Please reload and try again.");
          setIsLoading(false);
        }
      }
    }

    initialiseMap();
    return () => {
      cancelled = true;
      if (loadingTimer) clearTimeout(loadingTimer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => { const map = mapRef.current; if (map?.isStyleLoaded()) syncLayerRegistry(map, registry); }, [registry]);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) map.setProjection({ type: projection } as ProjectionSpecification);
  }, [projection]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cameraCommand) return;
    if (cameraCommand.type === "zoom-in") map.zoomIn();
    if (cameraCommand.type === "zoom-out") map.zoomOut();
    if (cameraCommand.type === "reset") map.easeTo(INITIAL_VIEW);
    if (cameraCommand.type === "fit-bounds") map.fitBounds([...cameraCommand.bounds], { padding: 64, duration: 700 });
  }, [cameraCommand]);

  return <><div ref={containerRef} className="map-canvas" aria-label="Interactive map" />{isLoading && <div className="map-status">Loading map…</div>}{error && <div className="map-status" role="alert">{error}</div>}</>;
}

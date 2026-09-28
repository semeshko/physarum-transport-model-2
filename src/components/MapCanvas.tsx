"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, MapMouseEvent, ProjectionSpecification } from "maplibre-gl";
import { installLayerRegistry, syncLayerRegistry, type LayerRegistry } from "@/map/layer-registry";
import type { GISBounds, GISPosition } from "@/gis/types";
import { BASEMAP_STYLE, BASEMAP_ATTRIBUTION, cartoRequest } from "@/map/basemap";
import { INITIAL_CAMERA, type ProjectCamera } from "@/project/document";
import type { StyleSpecification } from "maplibre-gl";

export type CameraCommand =
  | { id:number;type:"restore";camera:ProjectCamera }
  | { id: number; type: "zoom-in" | "zoom-out" | "reset" | "capture-bounds" }
  | { id: number; type: "fit-bounds"; bounds: GISBounds };
export type MapFeatureSelection = { readonly kind: "node" | "edge"; readonly id: string };
type Props = { cameraCommand: CameraCommand | null; projection: "mercator" | "globe"; registry: LayerRegistry; onCameraChanged?:(camera:ProjectCamera)=>void; onFeatureSelect?: (selection: MapFeatureSelection) => void; onBoundsCaptured?: (bounds: GISBounds) => void; onMapClick?: (position: GISPosition) => void };
const INITIAL_VIEW = { center: [24.0316, 49.8429] as [number, number], zoom: 12, bearing: 0, pitch: 0 };
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;
/**
 * MapLibre 6 derives its Worker URL from its own `import.meta.url` and returns
 * an empty string when that is not an http(s) URL, which is what a bundler
 * leaves behind. `new Worker("")` then loads this HTML document as a module
 * worker: it never answers, so every source — vector tiles and inline GeoJSON
 * alike — stays unloaded and only the style's background colour is painted.
 * Copied into /public by scripts/copy-maplibre-worker.mjs.
 */
const MAPLIBRE_WORKER_URL = "/maplibre-gl-worker.mjs";

export function MapCanvas({ cameraCommand, projection, registry, onCameraChanged, onFeatureSelect, onBoundsCaptured, onMapClick }: Props) {
  const cameraChangedRef=useRef(onCameraChanged);
  const cameraRef=useRef<ProjectCamera>(INITIAL_CAMERA);
  const [basemapKey,setBasemapKey]=useState(CARTO_KEY??"");
  const [keyInput,setKeyInput]=useState("");
  const [desktop,setDesktop]=useState(false);
  const [basemapUnavailable,setBasemapUnavailable]=useState(false);
  const [keyReady,setKeyReady]=useState(false);
  useEffect(()=>{cameraChangedRef.current=onCameraChanged;},[onCameraChanged]);
  useEffect(()=>{void (window.physarumDesktop?.getBasemapKey()??Promise.resolve(CARTO_KEY??"")).then(key=>{setDesktop(Boolean(window.physarumDesktop));setBasemapKey(key);setKeyReady(true);});},[]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const registryRef = useRef(registry);
  const projectionRef = useRef(projection);
  const selectionRef = useRef(onFeatureSelect);
  const boundsCapturedRef = useRef(onBoundsCaptured);
  const mapClickRef = useRef(onMapClick);
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
    boundsCapturedRef.current = onBoundsCaptured;
  }, [onBoundsCaptured]);

  useEffect(() => {
    mapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if(!keyReady) return;
    let cancelled = false;
    const styleRequest=new AbortController();
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;

    async function initialiseMap() {
      try {
        const maplibregl = await import("maplibre-gl");
        if (cancelled || !containerRef.current) return;
        if (!maplibregl.getWorkerUrl()) maplibregl.setWorkerUrl(new URL(MAPLIBRE_WORKER_URL, window.location.origin).href);
        const map = new maplibregl.Map({
          container: containerRef.current, style: {version:8,sources:{},layers:[{id:"offline-background",type:"background",paint:{"background-color":"#17232b"}}]}, ...cameraRef.current,
          transformRequest: (url) => cartoRequest(url, basemapKey),
          attributionControl: { compact: false, customAttribution: BASEMAP_ATTRIBUTION },
        });
        mapRef.current = map;
        map.on("moveend",()=>{const center=map.getCenter();const camera:ProjectCamera={center:[center.lng,center.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()};cameraRef.current=camera;cameraChangedRef.current?.(camera);});
        // Local layers never depend on successful remote style acquisition.
        const styleTimer=setTimeout(()=>styleRequest.abort(),5000);
        void fetch(cartoRequest(BASEMAP_STYLE,basemapKey).url,{signal:styleRequest.signal}).then(async response=>{
          if(!response.ok) throw new Error("Basemap unavailable");
          const style=await response.json() as StyleSpecification;
          if(!cancelled){map.setStyle(style);setBasemapUnavailable(false);}
        }).catch(()=>{if(!cancelled)setBasemapUnavailable(true);}).finally(()=>clearTimeout(styleTimer));
        map.on("style.load", () => {
          if (cancelled) return;
          map.setProjection({ type: projectionRef.current });
          installLayerRegistry(map, registryRef.current);
          setIsLoading(false);
          setError(null);
          if (loadingTimer) clearTimeout(loadingTimer);
        });
        map.on("click", (event: MapMouseEvent) => {
          // Design places markers at arbitrary positions, so when a raw-click
          // handler is installed it takes the click instead of graph picking.
          if (mapClickRef.current) { mapClickRef.current([event.lngLat.lng, event.lngLat.lat]); return; }
          const features = map.queryRenderedFeatures(event.point, { layers: ["transport-graph-nodes", "transport-graph-edges"] });
          const nodeId = features.find((feature) => feature.layer.id === "transport-graph-nodes")?.properties?.nodeId;
          if (typeof nodeId === "string") { selectionRef.current?.({ kind: "node", id: nodeId }); return; }
          const edgeId = features.find((feature) => feature.layer.id === "transport-graph-edges")?.properties?.edgeId;
          if (typeof edgeId === "string") selectionRef.current?.({ kind: "edge", id: edgeId });
        });
        loadingTimer = setTimeout(() => {
          if (!cancelled && !map.isStyleLoaded()) {
            setBasemapUnavailable(true);
            map.setStyle({version:8,sources:{},layers:[{id:"offline-background",type:"background",paint:{"background-color":"#17232b"}}]});
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
      styleRequest.abort();
      if (loadingTimer) clearTimeout(loadingTimer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [basemapKey,keyReady]);

  useEffect(() => { const map = mapRef.current; if (map?.isStyleLoaded()) syncLayerRegistry(map, registry); }, [registry]);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) map.setProjection({ type: projection } as ProjectionSpecification);
  }, [projection]);
  useEffect(() => {
    const map = mapRef.current;
    if(cameraCommand?.type==="restore") {cameraRef.current=cameraCommand.camera;map?.jumpTo(cameraCommand.camera);return;}
    if (!map || !cameraCommand) return;
    if (cameraCommand.type === "zoom-in") map.zoomIn();
    if (cameraCommand.type === "zoom-out") map.zoomOut();
    if (cameraCommand.type === "reset") map.easeTo(INITIAL_VIEW);
    if (cameraCommand.type === "fit-bounds") map.fitBounds([...cameraCommand.bounds], { padding: 64, duration: 700 });
    if (cameraCommand.type === "capture-bounds") {
      const bounds = map.getBounds();
      boundsCapturedRef.current?.([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
    }
  }, [cameraCommand]);

  return <><div ref={containerRef} className="map-canvas" aria-label="Interactive map" />{isLoading && <div className="map-status">Loading map…</div>}{error && <div className="map-status" role="alert">{error}</div>}{(basemapUnavailable || !basemapKey.trim()) && <div className="basemap-notice" role="status">{basemapUnavailable && <div>Підкладка недоступна. Геометрії проєкту та Analyze працюють незалежно.</div>}{!basemapKey.trim() && <><div>Потрібен власний ключ CARTO. <a href="https://carto.com/basemaps/apikey/" target="_blank" rel="noopener noreferrer">Отримати ключ</a></div>{desktop ? <><input aria-label="Ключ CARTO" type="password" value={keyInput} onChange={e=>setKeyInput(e.target.value)} /><button onClick={()=>{void window.physarumDesktop?.setBasemapKey(keyInput.trim()).then(()=>{setBasemapKey(keyInput.trim());setKeyInput("");});}}>Застосувати ключ</button></> : <div>NEXT_PUBLIC_CARTO_API_KEY у .env.local, потім перезапустіть.</div>}</>}</div>}</>;
}

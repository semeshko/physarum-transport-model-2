"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import sampleUrban from "@/data/sample-urban.json";
import { buildTransportGraph } from "@/graph/build";
import { createTransportWorkspaceRegistry, DEFAULT_GRAPH_LAYER_VISIBILITY, type GraphLayerVisibility } from "@/graph/map-registry";
import { GISIngestionError, ingestGeoJSON } from "@/gis/ingest";
import { DEFAULT_GIS_LAYER_VISIBILITY, type GISLayerGroup, type GISLayerVisibility } from "@/gis/map-registry";
import type { GISDataset } from "@/gis/types";
import { MapCanvas, type CameraCommand } from "./MapCanvas";

const initialDataset = ingestGeoJSON(sampleUrban, { name: "Synthetic urban sample", source: { kind: "bundled", name: "sample-urban.json" } });
const LAYER_LABELS: Readonly<Record<GISLayerGroup, string>> = { roadsPaths: "Original transport", buildings: "Buildings", water: "Water", green: "Green areas" };
type CameraCommandInput =
  | { type: "zoom-in" | "zoom-out" | "reset" }
  | { type: "fit-bounds"; bounds: NonNullable<GISDataset["bounds"]> };

export function MapWorkspace() {
  const [dataset, setDataset] = useState<GISDataset>(initialDataset);
  const [visibility, setVisibility] = useState<GISLayerVisibility>(DEFAULT_GIS_LAYER_VISIBILITY);
  const [graphVisibility, setGraphVisibility] = useState<GraphLayerVisibility>(DEFAULT_GRAPH_LAYER_VISIBILITY);
  const [projection, setProjection] = useState<"mercator" | "globe">("mercator");
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const commandId = useRef(0);
  const graphResult = useMemo(() => {
    try { return { graph: buildTransportGraph(dataset), error: null }; }
    catch (error) { return { graph: null, error: error instanceof Error ? error.message : "Graph extraction failed." }; }
  }, [dataset]);
  const registry = useMemo(() => graphResult.graph ? createTransportWorkspaceRegistry(dataset, graphResult.graph, visibility, graphVisibility) : null, [dataset, graphResult.graph, graphVisibility, visibility]);

  function command(value: CameraCommandInput) {
    commandId.current += 1;
    setCameraCommand({ ...value, id: commandId.current } as CameraCommand);
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const imported = ingestGeoJSON(parsed, { name: file.name, source: { kind: "file", name: file.name } });
      setDataset(imported);
      setVisibility(DEFAULT_GIS_LAYER_VISIBILITY);
      setGraphVisibility(DEFAULT_GRAPH_LAYER_VISIBILITY);
      if (imported.bounds) command({ type: "fit-bounds", bounds: imported.bounds });
    } catch (error) {
      const message = error instanceof GISIngestionError ? error.message : error instanceof SyntaxError ? "The selected file is not valid JSON." : "The selected GeoJSON file could not be imported.";
      setImportError(message);
    }
  }

  return (
    <section className="map-workspace" aria-label="Physarum map workspace">
      {registry && <MapCanvas cameraCommand={cameraCommand} projection={projection} registry={registry} />}
      <aside className="map-panel" aria-label="GIS controls">
        <header className="panel-heading">
          <div><h1>Physarum Transport Model 2.0</h1><p>GIS ingestion foundation · EPSG:4326</p></div>
          <label className="import-button">Import GeoJSON<input aria-label="Import GeoJSON" type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={importFile} /></label>
        </header>
        <div className="control-row" aria-label="Camera controls">
          <button className="control-button" type="button" aria-label="Zoom in" onClick={() => command({ type: "zoom-in" })}>+</button>
          <button className="control-button" type="button" aria-label="Zoom out" onClick={() => command({ type: "zoom-out" })}>−</button>
          <button className="control-button" type="button" aria-label="Reset view" onClick={() => command({ type: "reset" })}>↺</button>
          <button className="control-button fit-button" type="button" disabled={!dataset.bounds} onClick={() => dataset.bounds && command({ type: "fit-bounds", bounds: dataset.bounds })}>Fit to dataset</button>
          <button className="control-button projection-button" type="button" aria-label={`Switch to ${projection === "mercator" ? "globe" : "Mercator"} projection`} onClick={() => setProjection((current) => current === "mercator" ? "globe" : "mercator")}>{projection === "mercator" ? "Globe" : "Mercator"}</button>
        </div>
        <section className="dataset-summary" aria-label="Dataset summary">
          <strong>{dataset.name}</strong>
          <span>{dataset.featureCount} features · {dataset.geometryTypes.join(", ") || "No geometry"}</span>
          <span>Road {dataset.categoryCounts.road} · Path {dataset.categoryCounts.path} · Building {dataset.categoryCounts.building} · Water {dataset.categoryCounts.water} · Railway {dataset.categoryCounts.railway} · Green {dataset.categoryCounts.green} · Unknown {dataset.categoryCounts.unknown}</span>
          <span>Assumes WGS84 [longitude, latitude]; reprojection is not supported.</span>
          {dataset.warnings.map((warning) => <span className="dataset-warning" key={warning}>{warning}</span>)}
        </section>
        {graphResult.graph && (
          <section className="dataset-summary graph-summary" aria-label="Graph summary">
            <strong>Transport graph</strong>
            <span>Nodes {graphResult.graph.diagnostics.nodeCount} · Edges {graphResult.graph.diagnostics.edgeCount}</span>
            <span>Components {graphResult.graph.diagnostics.connectedComponentCount} · Largest {graphResult.graph.diagnostics.largestConnectedComponentNodeCount} nodes</span>
            <span>Snap tolerance {graphResult.graph.snapToleranceDegrees}° · Length meters</span>
          </section>
        )}
        {graphResult.error && <div className="import-error" role="alert">{graphResult.error}</div>}
        <fieldset className="layer-list">
          <legend>Layers</legend>
          {(Object.keys(LAYER_LABELS) as GISLayerGroup[]).map((group) => (
            <label className="layer-toggle" key={group}><span>{LAYER_LABELS[group]}</span><input type="checkbox" checked={visibility[group]} onChange={(event) => setVisibility((current) => ({ ...current, [group]: event.target.checked }))} /></label>
          ))}
        </fieldset>
        <fieldset className="layer-list">
          <legend>Graph diagnostics</legend>
          <label className="layer-toggle"><span>Graph edges</span><input type="checkbox" checked={graphVisibility.edges} onChange={(event) => setGraphVisibility((current) => ({ ...current, edges: event.target.checked }))} /></label>
          <label className="layer-toggle"><span>Graph nodes</span><input type="checkbox" checked={graphVisibility.nodes} onChange={(event) => setGraphVisibility((current) => ({ ...current, nodes: event.target.checked }))} /></label>
        </fieldset>
        {importError && <div className="import-error" role="alert">{importError}</div>}
      </aside>
    </section>
  );
}

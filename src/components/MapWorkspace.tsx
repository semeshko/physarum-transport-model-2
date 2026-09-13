"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import sampleUrban from "@/data/sample-urban.json";
import { buildTransportGraph } from "@/graph/build";
import { createTransportWorkspaceRegistry, DEFAULT_GRAPH_LAYER_VISIBILITY, type GraphLayerVisibility } from "@/graph/map-registry";
import { GISIngestionError, ingestGeoJSON } from "@/gis/ingest";
import { DEFAULT_GIS_LAYER_VISIBILITY, type GISLayerGroup, type GISLayerVisibility } from "@/gis/map-registry";
import type { GISBounds, GISDataset } from "@/gis/types";
import { usePhysarumRuntime } from "@/hooks/usePhysarumRuntime";
import { addPhysarumResultToRegistry } from "@/physarum/map-registry";
import { DEFAULT_PHYSARUM_PARAMETERS } from "@/physarum/parameters";
import { overpassResponseToGeoJSON } from "@/osm/adapter";
import { formatOSMBounds, measureOSMArea, validateOSMArea } from "@/osm/area";
import { fetchOSMTransport, OSMRequestError } from "@/osm/client";
import { addOSMAreaToRegistry } from "@/osm/map-registry";
import type { OSMImportSummary } from "@/osm/types";
import { addScenarioToRegistry } from "@/scenario/map-registry";
import { prepareNetwork } from "@/scenario/prepare";
import { createEmptyScenario, setEdgePenalty, setTerminal, toggleBlockedEdge } from "@/scenario/scenario";
import type { AnalysisScenario } from "@/scenario/types";
import { MapCanvas, type CameraCommand, type MapFeatureSelection } from "./MapCanvas";

const initialDataset = ingestGeoJSON(sampleUrban, { name: "Synthetic urban sample", source: { kind: "bundled", name: "sample-urban.json" } });
const LAYER_LABELS: Readonly<Record<GISLayerGroup, string>> = { roadsPaths: "Original transport", buildings: "Buildings", water: "Water", green: "Green areas" };
type CameraCommandInput =
  | { type: "zoom-in" | "zoom-out" | "reset" | "capture-bounds" }
  | { type: "fit-bounds"; bounds: NonNullable<GISDataset["bounds"]> };
type ScenarioMode = "source" | "sink" | "block" | "penalty" | null;

export function MapWorkspace() {
  const [dataset, setDataset] = useState<GISDataset>(initialDataset);
  const [visibility, setVisibility] = useState<GISLayerVisibility>(DEFAULT_GIS_LAYER_VISIBILITY);
  const [graphVisibility, setGraphVisibility] = useState<GraphLayerVisibility>(DEFAULT_GRAPH_LAYER_VISIBILITY);
  const [projection, setProjection] = useState<"mercator" | "globe">("mercator");
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<AnalysisScenario>(() => createEmptyScenario());
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>(null);
  const [penaltyMultiplier, setPenaltyMultiplier] = useState(1.5);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [osmBounds, setOSMBounds] = useState<GISBounds | null>(null);
  const [osmAreaError, setOSMAreaError] = useState<string | null>(null);
  const [osmLoading, setOSMLoading] = useState(false);
  const [osmSummary, setOSMSummary] = useState<OSMImportSummary | null>(null);
  const physarum = usePhysarumRuntime();
  const commandId = useRef(0);
  const osmRequestRef = useRef<AbortController | null>(null);
  const graphResult = useMemo(() => {
    const started = performance.now();
    try { return { graph: buildTransportGraph(dataset), error: null, buildMilliseconds: performance.now() - started }; }
    catch (error) { return { graph: null, error: error instanceof Error ? error.message : "Graph extraction failed.", buildMilliseconds: performance.now() - started }; }
  }, [dataset]);
  const prepared = useMemo(() => graphResult.graph ? prepareNetwork(graphResult.graph, scenario) : null, [graphResult.graph, scenario]);
  const registry = useMemo(() => {
    if (!graphResult.graph) return null;
    const base = createTransportWorkspaceRegistry(dataset, graphResult.graph, visibility, graphVisibility);
    const withScenario = addScenarioToRegistry(base, graphResult.graph, scenario);
    const withResult = addPhysarumResultToRegistry(withScenario, graphResult.graph, physarum.runtime.state);
    return addOSMAreaToRegistry(withResult, osmBounds);
  }, [dataset, graphResult.graph, graphVisibility, osmBounds, physarum.runtime.state, scenario, visibility]);

  useEffect(() => () => osmRequestRef.current?.abort(), []);

  function command(value: CameraCommandInput) {
    commandId.current += 1;
    setCameraCommand({ ...value, id: commandId.current } as CameraCommand);
  }

  function resetForDataset(imported: GISDataset) {
    setDataset(imported);
    setVisibility(DEFAULT_GIS_LAYER_VISIBILITY);
    setGraphVisibility(DEFAULT_GRAPH_LAYER_VISIBILITY);
    setScenario(createEmptyScenario());
    setScenarioMode(null);
    physarum.reset();
    setSelectedEdgeId("");
  }

  function captureOSMArea(bounds: GISBounds) {
    osmRequestRef.current?.abort();
    osmRequestRef.current = null;
    setOSMLoading(false);
    setOSMBounds(bounds);
    setOSMSummary(null);
    physarum.reset();
    try { validateOSMArea(bounds); setOSMAreaError(null); }
    catch (error) { setOSMAreaError(error instanceof Error ? error.message : "The selected area is invalid."); }
  }

  async function loadOSMNetwork() {
    if (!osmBounds) return;
    physarum.reset();
    setImportError(null);
    setOSMAreaError(null);
    osmRequestRef.current?.abort();
    const controller = new AbortController();
    osmRequestRef.current = controller;
    setOSMLoading(true);
    const fetchStarted = performance.now();
    try {
      validateOSMArea(osmBounds);
      const payload = await fetchOSMTransport(osmBounds, { signal: controller.signal });
      const fetchMilliseconds = performance.now() - fetchStarted;
      const adapterStarted = performance.now();
      const converted = overpassResponseToGeoJSON(payload);
      if (converted.wayCount === 0) throw new OSMRequestError("empty", "No usable OSM transport ways were returned for this area.");
      const adapterMilliseconds = performance.now() - adapterStarted;
      const boundsKey = formatOSMBounds(osmBounds);
      const imported = ingestGeoJSON(converted.featureCollection, { name: `OSM transport · ${boundsKey}`, source: { kind: "osm", name: `${boundsKey}:${converted.timestamp ?? "current"}` } });
      resetForDataset({ ...imported, warnings: [...imported.warnings, ...converted.warnings, "OSM access and one-way tags are preserved but not enforced; the graph is currently undirected."] });
      setOSMSummary({ bounds: osmBounds, wayCount: converted.wayCount, skippedElementCount: converted.skippedElementCount, fetchMilliseconds, adapterMilliseconds, warnings: converted.warnings });
      if (imported.bounds) command({ type: "fit-bounds", bounds: imported.bounds });
    } catch (error) {
      if (controller !== osmRequestRef.current || error instanceof OSMRequestError && error.code === "aborted") return;
      setImportError(error instanceof Error ? error.message : "The OSM network could not be loaded.");
    } finally {
      if (controller === osmRequestRef.current) { osmRequestRef.current = null; setOSMLoading(false); }
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    osmRequestRef.current?.abort();
    osmRequestRef.current = null;
    setOSMLoading(false);
    setOSMSummary(null);
    setOSMBounds(null);
    setOSMAreaError(null);
    setImportError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const imported = ingestGeoJSON(parsed, { name: file.name, source: { kind: "file", name: file.name } });
      resetForDataset(imported);
      if (imported.bounds) command({ type: "fit-bounds", bounds: imported.bounds });
    } catch (error) {
      const message = error instanceof GISIngestionError ? error.message : error instanceof SyntaxError ? "The selected file is not valid JSON." : "The selected GeoJSON file could not be imported.";
      setImportError(message);
    }
  }

  function selectMapFeature(selection: MapFeatureSelection) {
    if (scenarioMode === "source" && selection.kind === "node") updateScenario((current) => setTerminal(current, "source", selection.id));
    if (scenarioMode === "sink" && selection.kind === "node") updateScenario((current) => setTerminal(current, "sink", selection.id));
    if (scenarioMode === "block" && selection.kind === "edge") { setSelectedEdgeId(selection.id); updateScenario((current) => toggleBlockedEdge(current, selection.id)); }
    if (scenarioMode === "penalty" && selection.kind === "edge") { setSelectedEdgeId(selection.id); updateScenario((current) => setEdgePenalty(current, selection.id, penaltyMultiplier)); }
  }

  function updateScenario(updater: (current: AnalysisScenario) => AnalysisScenario) {
    setScenario(updater);
    physarum.reset();
  }

  const source = scenario.terminals.find((terminal) => terminal.role === "source");
  const sink = scenario.terminals.find((terminal) => terminal.role === "sink");
  const connectivity = prepared?.validation.sourceSinkConnectedAfterConstraints;

  return (
    <section className="map-workspace" aria-label="Physarum map workspace">
      {registry && <MapCanvas cameraCommand={cameraCommand} projection={projection} registry={registry} onFeatureSelect={selectMapFeature} onBoundsCaptured={captureOSMArea} />}
      <aside className={`map-panel${panelCollapsed ? " is-collapsed" : ""}`} aria-label="GIS controls">
        <header className="panel-heading">
          <div><h1>Physarum Transport Model 2.0</h1><p>GIS ingestion foundation · EPSG:4326</p></div>
          <label className="import-button">Import GeoJSON<input aria-label="Import GeoJSON" type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={importFile} /></label>
          <button className="panel-collapse" type="button" aria-expanded={!panelCollapsed} onClick={() => setPanelCollapsed((current) => !current)}>{panelCollapsed ? "Show controls" : "Hide controls"}</button>
        </header>
        <div className="control-row" aria-label="Camera controls">
          <button className="control-button" type="button" aria-label="Zoom in" onClick={() => command({ type: "zoom-in" })}>+</button>
          <button className="control-button" type="button" aria-label="Zoom out" onClick={() => command({ type: "zoom-out" })}>−</button>
          <button className="control-button" type="button" aria-label="Reset view" onClick={() => command({ type: "reset" })}>↺</button>
          <button className="control-button fit-button" type="button" disabled={!dataset.bounds} onClick={() => dataset.bounds && command({ type: "fit-bounds", bounds: dataset.bounds })}>Fit to dataset</button>
          <button className="control-button projection-button" type="button" aria-label={`Switch to ${projection === "mercator" ? "globe" : "Mercator"} projection`} onClick={() => setProjection((current) => current === "mercator" ? "globe" : "mercator")}>{projection === "mercator" ? "Globe" : "Mercator"}</button>
        </div>
        <section className="scenario-section osm-section" aria-label="OpenStreetMap import">
          <div className="scenario-heading"><strong>OpenStreetMap network</strong><span>{osmLoading ? "Loading" : osmBounds ? "Area selected" : "No area"}</span></div>
          <p>Zoom to a small district, capture the visible rectangle, then load roads and paths.</p>
          <div className="runtime-actions">
            <button className="run-physarum" type="button" onClick={() => command({ type: "capture-bounds" })}>Select current view</button>
            <button className="run-physarum" type="button" disabled={!osmBounds || Boolean(osmAreaError) || osmLoading} onClick={loadOSMNetwork}>{osmLoading ? "Loading…" : "Load OSM network"}</button>
          </div>
          {osmBounds && <div className="scenario-stats" aria-label="OSM area summary">
            <span>Bounds <b>{formatOSMBounds(osmBounds)}</b></span>
            <span>Approximate area <b>{measureOSMArea(osmBounds).areaSquareKilometers.toFixed(2)} km²</b></span>
          </div>}
          {osmAreaError && <div className="import-error" role="alert">{osmAreaError}</div>}
          {osmSummary && <div className="scenario-stats" aria-label="OSM import summary">
            <span>OSM ways <b>{osmSummary.wayCount}</b> · Skipped <b>{osmSummary.skippedElementCount}</b></span>
            <span>Fetch <b>{osmSummary.fetchMilliseconds.toFixed(0)} ms</b> · Adapter <b>{osmSummary.adapterMilliseconds.toFixed(1)} ms</b></span>
            <span>Graph build <b>{graphResult.buildMilliseconds.toFixed(1)} ms</b></span>
          </div>}
        </section>
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
            <span>Merged {graphResult.graph.diagnostics.duplicateEdgesMerged} duplicates · Resolved {graphResult.graph.diagnostics.collinearOverlapsResolved} overlaps</span>
            <span>Ignored {graphResult.graph.diagnostics.gradeSeparatedCrossingsIgnored} grade-separated crossings · Rejected {graphResult.graph.diagnostics.zeroLengthEdgesRejected + graphResult.graph.diagnostics.selfLoopsRejected + graphResult.graph.diagnostics.invalidSegmentsRejected} invalid edges</span>
            <span>Snap tolerance {graphResult.graph.snapToleranceDegrees}° · Length meters</span>
            <span>Build time {graphResult.buildMilliseconds.toFixed(1)} ms</span>
          </section>
        )}
        {graphResult.error && <div className="import-error" role="alert">{graphResult.error}</div>}
        {prepared && (
          <section className="scenario-section" aria-label="Scenario controls">
            <div className="scenario-heading"><strong>Scenario</strong><span className={prepared.validation.valid ? "status-valid" : "status-invalid"}>{prepared.validation.valid ? "Valid" : "Invalid"}</span></div>
            <div className="scenario-stats">
              <label>Source <select aria-label="Source node" value={source?.nodeId ?? ""} onChange={(event) => event.target.value && updateScenario((current) => setTerminal(current, "source", event.target.value))}><option value="">not selected</option>{graphResult.graph?.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
              <label>Sink <select aria-label="Sink node" value={sink?.nodeId ?? ""} onChange={(event) => event.target.value && updateScenario((current) => setTerminal(current, "sink", event.target.value))}><option value="">not selected</option>{graphResult.graph?.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
              <label>Edge <select aria-label="Scenario edge" value={selectedEdgeId} onChange={(event) => setSelectedEdgeId(event.target.value)}><option value="">select on map</option>{graphResult.graph?.edges.map((edge) => <option key={edge.id} value={edge.id}>{edge.id}</option>)}</select></label>
              <span>Usable edges <b>{prepared.validation.activeEdgeCount}</b> · Blocked <b>{prepared.validation.blockedEdgeCount}</b> · Penalized <b>{prepared.validation.penalizedEdgeCount}</b></span>
              <span>Connectivity <b>{connectivity === null ? "Not evaluated" : connectivity ? "Connected" : "Disconnected"}</b></span>
            </div>
            <div className="scenario-actions" aria-label="Scenario selection mode">
              <button type="button" aria-pressed={scenarioMode === "source"} onClick={() => setScenarioMode("source")}>Select source</button>
              <button type="button" aria-pressed={scenarioMode === "sink"} onClick={() => setScenarioMode("sink")}>Select sink</button>
              <button type="button" aria-pressed={scenarioMode === "block"} onClick={() => setScenarioMode("block")}>Block / unblock edge</button>
              <button type="button" aria-pressed={scenarioMode === "penalty"} onClick={() => setScenarioMode("penalty")}>Set / clear penalty</button>
            </div>
            <div className="penalty-row" aria-label="Soft penalty multiplier">
              {[1, 1.5, 2, 3].map((value) => <button type="button" aria-pressed={penaltyMultiplier === value} key={value} onClick={() => { setPenaltyMultiplier(value); setScenarioMode("penalty"); }}>{value}×</button>)}
              <button type="button" className="clear-scenario" onClick={() => { setScenario(createEmptyScenario()); setScenarioMode(null); physarum.reset(); setSelectedEdgeId(""); }}>Clear scenario</button>
            </div>
            <div className="scenario-actions">
              <button type="button" disabled={!selectedEdgeId} onClick={() => selectedEdgeId && updateScenario((current) => toggleBlockedEdge(current, selectedEdgeId))}>Apply block</button>
              <button type="button" disabled={!selectedEdgeId} onClick={() => selectedEdgeId && updateScenario((current) => setEdgePenalty(current, selectedEdgeId, penaltyMultiplier))}>Apply penalty</button>
            </div>
            {scenarioMode && <p className="scenario-hint">Click a graph {scenarioMode === "source" || scenarioMode === "sink" ? "node" : "edge"} on the map.</p>}
            {prepared.validation.issues.length > 0 && <p className="scenario-hint">{prepared.validation.issues[0].message}</p>}
          </section>
        )}
        {prepared && (
          <section className="scenario-section physarum-section" aria-label="Physarum controls">
            <div className="scenario-heading"><strong>Physarum runtime</strong><span className={physarum.runtime.status === "completed" ? "status-valid" : physarum.runtime.status === "error" ? "status-invalid" : ""}>{physarum.runtime.status}</span></div>
            <div className="runtime-actions">
              {(physarum.runtime.status === "idle" || physarum.runtime.status === "completed" || physarum.runtime.status === "cancelled" || physarum.runtime.status === "error") && <button className="run-physarum" type="button" disabled={!prepared.network} onClick={() => prepared.network && physarum.start(prepared.network)}>Run</button>}
              {physarum.runtime.status === "running" && <button className="run-physarum" type="button" onClick={physarum.pause}>Pause</button>}
              {physarum.runtime.status === "paused" && <button className="run-physarum" type="button" onClick={physarum.resume}>Resume</button>}
              {(physarum.runtime.status === "running" || physarum.runtime.status === "paused" || physarum.runtime.status === "completed" || physarum.runtime.status === "error") && <button className="run-physarum reset-runtime" type="button" onClick={physarum.reset}>Reset runtime</button>}
            </div>
            {physarum.runtime.state && <div className="scenario-stats" aria-label="Physarum diagnostics">
              <span>Iteration <b>{physarum.runtime.state.iteration} / {DEFAULT_PHYSARUM_PARAMETERS.maxIterations}</b></span>
              <span>Scientific termination <b>{physarum.runtime.state.terminationReason ?? "—"}</b></span>
              <span>Max ΔD <b>{physarum.runtime.state.diagnostics.maxDeltaD.toExponential(2)}</b></span>
              <span>Kirchhoff residual <b>{physarum.runtime.state.diagnostics.maximumKirchhoffResidual.toExponential(2)}</b></span>
              {physarum.runtime.state.diagnostics.linearSolve && <span>Pressure solver <b>{physarum.runtime.state.diagnostics.linearSolve.method === "conjugate-gradient" ? "CG" : "dense"} · {physarum.runtime.state.diagnostics.linearSolve.iterations} iterations</b></span>}
              {physarum.runtime.state.diagnostics.linearSolve && <span>Linear residual <b>{physarum.runtime.state.diagnostics.linearSolve.residualNorm.toExponential(2)}</b></span>}
              {physarum.runtime.error && <span className="status-invalid">{physarum.runtime.error}</span>}
            </div>}
          </section>
        )}
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

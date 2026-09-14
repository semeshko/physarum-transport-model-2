"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import sampleUrban from "@/data/sample-urban.json";
import { buildTransportGraph } from "@/graph/build";
import { createTransportWorkspaceRegistry, DEFAULT_GRAPH_LAYER_VISIBILITY, type GraphLayerVisibility } from "@/graph/map-registry";
import { GISIngestionError, ingestGeoJSON } from "@/gis/ingest";
import { clipLineDatasetToBounds } from "@/gis/clip-lines";
import { DEFAULT_GIS_LAYER_VISIBILITY, type GISLayerGroup, type GISLayerVisibility } from "@/gis/map-registry";
import type { GISBounds, GISDataset } from "@/gis/types";
import { usePhysarumRuntime } from "@/hooks/usePhysarumRuntime";
import { addPhysarumResultToRegistry } from "@/physarum/map-registry";
import { DEFAULT_PHYSARUM_PARAMETERS } from "@/physarum/parameters";
import { overpassResponseToGeoJSON, overpassUrbanContextToGeoJSON } from "@/osm/adapter";
import { formatOSMBounds, measureOSMArea, validateOSMArea } from "@/osm/area";
import { fetchOSMTransport, fetchOSMUrbanContext, OSMRequestError } from "@/osm/client";
import { addOSMAreaToRegistry } from "@/osm/map-registry";
import type { OSMImportSummary } from "@/osm/types";
import { addScenarioToRegistry } from "@/scenario/map-registry";
import { prepareNetwork } from "@/scenario/prepare";
import { createEmptyScenario, setEdgePenalty, setTerminal, setTransportProfile, toggleBlockedEdge } from "@/scenario/scenario";
import type { AnalysisScenario } from "@/scenario/types";
import { applyTransportProfile } from "@/transport-profile/profile";
import { TRANSPORT_PROFILE_IDS, type TransportProfileId } from "@/transport-profile/types";
import { applyGeneralizedCosts } from "@/transport-cost/model";
import { addTransportCostsToRegistry } from "@/transport-cost/map-registry";
import { createCostQAReport, serializeCostQAReport } from "@/transport-cost/qa";
import { applySpatialConstraints, createSpatialConstraintSet } from "@/spatial-constraints/model";
import { addSpatialImpactsToRegistry } from "@/spatial-constraints/map-registry";
import { DEFAULT_SPATIAL_POLICY, type SpatialConstraintPolicy } from "@/spatial-constraints/types";
import { createSpatialQAReport, serializeSpatialQAReport } from "@/spatial-constraints/qa";
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
  const [costVisible, setCostVisible] = useState(false);
  const [spatialPolicy, setSpatialPolicy] = useState<SpatialConstraintPolicy>(DEFAULT_SPATIAL_POLICY);
  const [spatialVisible, setSpatialVisible] = useState(true);
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
    try { return { graph: buildTransportGraph(dataset), error: null }; }
    catch (error) { return { graph: null, error: error instanceof Error ? error.message : "Graph extraction failed." }; }
  }, [dataset]);
  const profiled = useMemo(() => graphResult.graph ? applyTransportProfile(graphResult.graph, scenario.transportProfileId) : null, [graphResult.graph, scenario.transportProfileId]);
  const costed = useMemo(() => profiled ? applyGeneralizedCosts(profiled) : null, [profiled]);
  const spatialConstraints = useMemo(() => createSpatialConstraintSet(dataset), [dataset]);
  const spatial = useMemo(() => costed ? applySpatialConstraints(costed, spatialConstraints, spatialPolicy) : null, [costed, spatialConstraints, spatialPolicy]);
  const prepared = useMemo(() => graphResult.graph && profiled && costed && spatial ? prepareNetwork(graphResult.graph, scenario, profiled, costed, spatial) : null, [costed, graphResult.graph, profiled, scenario, spatial]);
  const registry = useMemo(() => {
    if (!graphResult.graph) return null;
    if (!profiled) return null;
    const base = createTransportWorkspaceRegistry(dataset, graphResult.graph, profiled, visibility, graphVisibility);
    const withCosts = costed ? addTransportCostsToRegistry(base, costed, costVisible) : base;
    const withSpatial = spatial ? addSpatialImpactsToRegistry(withCosts, spatial, spatialVisible) : withCosts;
    const withScenario = addScenarioToRegistry(withSpatial, graphResult.graph, scenario);
    const withResult = addPhysarumResultToRegistry(withScenario, graphResult.graph, physarum.runtime.state);
    return addOSMAreaToRegistry(withResult, osmBounds);
  }, [costVisible, costed, dataset, graphResult.graph, graphVisibility, osmBounds, physarum.runtime.state, profiled, scenario, spatial, spatialVisible, visibility]);

  useEffect(() => () => osmRequestRef.current?.abort(), []);

  function command(value: CameraCommandInput) {
    commandId.current += 1;
    setCameraCommand({ ...value, id: commandId.current } as CameraCommand);
  }

  function resetForDataset(imported: GISDataset) {
    setDataset(imported);
    setVisibility(DEFAULT_GIS_LAYER_VISIBILITY);
    setGraphVisibility(DEFAULT_GRAPH_LAYER_VISIBILITY);
    setSpatialPolicy(DEFAULT_SPATIAL_POLICY);
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
      const [payload, contextResult] = await Promise.all([fetchOSMTransport(osmBounds, { signal: controller.signal }), fetchOSMUrbanContext(osmBounds, { signal: controller.signal }).then((value) => ({ value, error: null as string | null })).catch((error: unknown) => ({ value: null, error: error instanceof Error ? error.message : "Urban context unavailable." }))]);
      const fetchMilliseconds = performance.now() - fetchStarted;
      const adapterStarted = performance.now();
      const converted = overpassResponseToGeoJSON(payload);
      const urban = contextResult.value ? overpassUrbanContextToGeoJSON(contextResult.value) : null;
      if (converted.wayCount === 0) throw new OSMRequestError("empty", "No usable OSM transport ways were returned for this area.");
      const adapterMilliseconds = performance.now() - adapterStarted;
      const boundsKey = formatOSMBounds(osmBounds);
      const combined = { type: "FeatureCollection", features: [...converted.featureCollection.features, ...(urban?.featureCollection.features ?? [])] };
      const ingested = ingestGeoJSON(combined, { name: `OSM transport + urban context · ${boundsKey}`, source: { kind: "osm", name: `${boundsKey}:${converted.timestamp ?? "current"}` } });
      const imported = clipLineDatasetToBounds(ingested, osmBounds);
      resetForDataset({ ...imported, warnings: [...imported.warnings, ...converted.warnings, ...(urban?.warnings ?? []), ...(contextResult.error ? [`Urban context: ${contextResult.error}`] : []), "OSM access and one-way tags are preserved but not enforced; the graph is currently undirected."] });
      setOSMSummary({ bounds: osmBounds, wayCount: converted.wayCount, skippedElementCount: converted.skippedElementCount, missingTopologyWayCount: converted.missingTopologyWayCount, urbanFeatureCount: urban?.wayCount ?? 0, urbanPolygonCount: urban?.polygonCount ?? 0, urbanContextWarning: contextResult.error, fetchMilliseconds, adapterMilliseconds, warnings: converted.warnings });
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
    if (selection.kind === "edge" && profiled?.usableEdges.some((edge) => edge.id === selection.id)) setSelectedEdgeId(selection.id);
    if (scenarioMode === "source" && selection.kind === "node" && spatial?.activeNodeIds.has(selection.id)) updateScenario((current) => setTerminal(current, "source", selection.id));
    if (scenarioMode === "sink" && selection.kind === "node" && spatial?.activeNodeIds.has(selection.id)) updateScenario((current) => setTerminal(current, "sink", selection.id));
    if (scenarioMode === "block" && selection.kind === "edge" && spatial?.usableEdges.some((edge) => edge.id === selection.id)) { setSelectedEdgeId(selection.id); updateScenario((current) => toggleBlockedEdge(current, selection.id)); }
    if (scenarioMode === "penalty" && selection.kind === "edge" && spatial?.usableEdges.some((edge) => edge.id === selection.id)) { setSelectedEdgeId(selection.id); updateScenario((current) => setEdgePenalty(current, selection.id, penaltyMultiplier)); }
  }

  function changeProfile(profileId: TransportProfileId) {
    setScenario((current) => setTransportProfile(current, profileId));
    setScenarioMode(null); setSelectedEdgeId(""); physarum.reset();
  }

  function updateScenario(updater: (current: AnalysisScenario) => AnalysisScenario) {
    setScenario(updater);
    physarum.reset();
  }

  function updateSpatialPolicy(key: "buildings" | "water" | "green", enabled: boolean) { setSpatialPolicy((current) => ({ ...current, [key]: enabled })); physarum.reset(); }

  const source = scenario.terminals.find((terminal) => terminal.role === "source");
  const sink = scenario.terminals.find((terminal) => terminal.role === "sink");
  const connectivity = prepared?.validation.sourceSinkConnectedAfterConstraints;
  const selectedCost = costed?.edges.find((item) => item.edge.id === selectedEdgeId);
  const selectedPrepared = prepared?.network?.edges.find((item) => item.graphEdgeId === selectedEdgeId);
  const selectedSpatial = spatial?.edges.find((item) => item.costedEdge.edge.id === selectedEdgeId);
  const selectedPenalty = scenario.edgeConstraints.find((item) => item.edgeId === selectedEdgeId)?.penaltyMultiplier ?? 1;
  const costQAUrl = costed ? `data:application/json;charset=utf-8,${encodeURIComponent(serializeCostQAReport(createCostQAReport(costed)))}` : null;
  const spatialQAUrl = spatial ? `data:application/json;charset=utf-8,${encodeURIComponent(serializeSpatialQAReport(createSpatialQAReport(spatial)))}` : null;

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
            <span>Urban context <b>{osmSummary.urbanFeatureCount}</b> features · <b>{osmSummary.urbanPolygonCount}</b> polygons</span>
            {osmSummary.urbanContextWarning && <span className="dataset-warning">Urban context unavailable: {osmSummary.urbanContextWarning}</span>}
            <span>Missing topology anchors <b>{osmSummary.missingTopologyWayCount}</b></span>
            <span>Fetch <b>{osmSummary.fetchMilliseconds.toFixed(0)} ms</b> · Adapter <b>{osmSummary.adapterMilliseconds.toFixed(1)} ms</b></span>
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
            <span>Anchored {graphResult.graph.diagnostics.anchoredNodeCount} · Synthetic / geometric {graphResult.graph.diagnostics.syntheticOrGeometricNodeCount}</span>
            <span>Components {graphResult.graph.diagnostics.connectedComponentCount} · Largest {graphResult.graph.diagnostics.largestConnectedComponentNodeCount} nodes ({graphResult.graph.diagnostics.nodeCount ? (100 * graphResult.graph.diagnostics.largestConnectedComponentNodeCount / graphResult.graph.diagnostics.nodeCount).toFixed(1) : "0.0"}%)</span>
            <span>Degree-1 endpoints {graphResult.graph.diagnostics.degreeOneEndpointCount} · Boundary endpoints {graphResult.graph.diagnostics.boundaryEndpointCount}</span>
            <span>Topology QA: missing anchors {graphResult.graph.diagnostics.missingExpectedTopologyFeatureCount} · coordinate conflicts {graphResult.graph.diagnostics.conflictingAnchorCoordinateCount} · nearby unconnected endpoints {graphResult.graph.diagnostics.nearbyUnconnectedEndpointCount}</span>
            <span>Segments {graphResult.graph.diagnostics.transportSegmentCount} · candidate pairs {graphResult.graph.diagnostics.candidateSegmentPairCount} · geometric tests {graphResult.graph.diagnostics.geometricIntersectionTestCount} · intersections {graphResult.graph.diagnostics.geometricIntersectionCount}</span>
            <span>Merged {graphResult.graph.diagnostics.duplicateEdgesMerged} duplicates · Resolved {graphResult.graph.diagnostics.collinearOverlapsResolved} overlaps</span>
            <span>Ignored {graphResult.graph.diagnostics.gradeSeparatedCrossingsIgnored} grade-separated crossings · Rejected {graphResult.graph.diagnostics.zeroLengthEdgesRejected + graphResult.graph.diagnostics.selfLoopsRejected + graphResult.graph.diagnostics.invalidSegmentsRejected} invalid edges</span>
            <span>Snap tolerance {graphResult.graph.snapToleranceDegrees}° · Length meters</span>
          </section>
        )}
        {graphResult.error && <div className="import-error" role="alert">{graphResult.error}</div>}
        {profiled && <section className="scenario-section" aria-label="Transport profile">
          <div className="scenario-heading"><strong>Transport mode</strong><span>{scenario.transportProfileId}</span></div>
          <div className="scenario-actions" aria-label="Transport mode selector">
            {TRANSPORT_PROFILE_IDS.map((profileId) => <button type="button" aria-pressed={scenario.transportProfileId === profileId} key={profileId} onClick={() => changeProfile(profileId)}>{profileId === "pedestrian" ? "Pedestrian" : profileId === "bicycle" ? "Bicycle" : "Motor"}</button>)}
          </div>
          <div className="scenario-stats" aria-label="Transport profile summary">
            <span>Active nodes <b>{profiled.connectivity.activeNodeCount}</b> · Usable edges <b>{profiled.connectivity.usableEdgeCount}</b> · Excluded <b>{profiled.connectivity.excludedEdgeCount}</b></span>
            <span>Components <b>{profiled.connectivity.connectedComponentCount}</b> · Largest <b>{(profiled.connectivity.largestConnectedComponentRatio * 100).toFixed(1)}%</b></span>
            <span>Physical <b>{profiled.accessDiagnostics.physicalEdgeCount}</b> · Allowed <b>{profiled.accessDiagnostics.allowedEdgeCount}</b> · Restricted <b>{profiled.accessDiagnostics.restrictedEdgeCount}</b> · Denied <b>{profiled.accessDiagnostics.deniedEdgeCount}</b> · Conditional <b>{profiled.accessDiagnostics.conditionalAccessExcluded}</b></span>
            <span>Explicitly allowed <b>{profiled.accessDiagnostics.explicitlyAllowed}</b> · Provenance conflicts <b>{profiled.accessDiagnostics.conflictingProvenance}</b></span>
            <span>One-way tagged edges <b>{profiled.accessDiagnostics.onewayTaggedNotEnforced}</b>. One-way restrictions are not yet enforced.</span>
            {costed && <><span>Cost model <b>profile travel-time impedance</b></span><span>Median edge <b>{costed.diagnostics.medianTravelTimeSeconds.toFixed(1)} s</b> · Median <b>{costed.diagnostics.medianCostPerMeter.toFixed(3)} s/m</b></span><span>Explicit speed <b>{costed.diagnostics.explicitSpeedCount}</b> · Fallback speed <b>{costed.diagnostics.fallbackSpeedCount}</b> · Surface <b>{costed.diagnostics.surfaceTaggedCount}</b> · Smoothness <b>{costed.diagnostics.smoothnessTaggedCount}</b> · Tracktype <b>{costed.diagnostics.tracktypeTaggedCount}</b></span></>}
          </div>
          {costed && costQAUrl && <a className="run-physarum" href={costQAUrl} download={`physarum-cost-qa-${costed.profileId}.json`}>Export cost QA JSON</a>}
        </section>}
        {spatial && <section className="scenario-section" aria-label="Spatial constraints">
          <div className="scenario-heading"><strong>Spatial constraints</strong><span>{spatial.diagnostics.hardExcludedEdgeCount} hard · {spatial.diagnostics.softAffectedEdgeCount} soft</span></div>
          <div className="scenario-actions" aria-label="Spatial constraint controls">
            <button type="button" aria-pressed={spatialPolicy.buildings} onClick={() => updateSpatialPolicy("buildings", !spatialPolicy.buildings)}>Buildings {spatialPolicy.buildings ? "On" : "Off"}</button>
            <button type="button" aria-pressed={spatialPolicy.water} onClick={() => updateSpatialPolicy("water", !spatialPolicy.water)}>Water {spatialPolicy.water ? "On" : "Off"}</button>
            <button type="button" aria-pressed={spatialPolicy.green} onClick={() => updateSpatialPolicy("green", !spatialPolicy.green)}>Green {spatialPolicy.green ? "Soft 1.025×" : "Off"}</button>
          </div>
          <div className="scenario-stats"><span>Context: building <b>{spatialConstraints.counts.building}</b> · water <b>{spatialConstraints.counts.water}</b> · green <b>{spatialConstraints.counts.green}</b></span><span>Edges unaffected <b>{spatial.diagnostics.unaffectedEdgeCount}</b> · relation tests <b>{spatial.diagnostics.relationTestCount}</b></span><span>Exceptions: bridge <b>{spatial.diagnostics.bridgeExceptionCount}</b> · tunnel <b>{spatial.diagnostics.tunnelExceptionCount}</b> · passage <b>{spatial.diagnostics.buildingPassageExceptionCount}</b></span></div>
          {spatialQAUrl && <a className="run-physarum" href={spatialQAUrl} download={`physarum-spatial-qa-${spatial.profileId}.json`}>Export spatial QA JSON</a>}
        </section>}
        {selectedCost && <details className="scenario-section" open aria-label="Selected edge cost inspector">
          <summary><strong>Edge cost inspector</strong> · {selectedCost.edge.id}</summary>
          <div className="scenario-stats">
            <span>Profile <b>{selectedCost.cost.profileId}</b> · Highway <b>{String(selectedCost.edge.provenance[0]?.sourceProperties.highway ?? "generic")}</b> · Access <b>allowed</b></span>
            <span>Length <b>{selectedCost.cost.lengthMeters.toFixed(1)} m</b></span>
            <span>Speed <b>{selectedCost.cost.speedKilometersPerHour.toFixed(1)} km/h</b> · <b>{selectedCost.cost.speedSource}</b></span>
            <span>Evidence <b>{selectedCost.cost.speedEvidence}</b></span>
            <span>Surface <b>{selectedCost.cost.surface ?? "missing / neutral"}</b> ×{selectedCost.cost.surfaceFactor.toFixed(2)}</span>
            <span>Smoothness <b>{selectedCost.cost.smoothness ?? "missing / neutral"}</b> ×{selectedCost.cost.smoothnessFactor.toFixed(2)}</span>
            <span>Tracktype <b>{selectedCost.cost.tracktype ?? "missing"}</b> ×{selectedCost.cost.tracktypeFactor.toFixed(2)} · Combined ×{selectedCost.cost.conditionFactor.toFixed(2)}</span>
            <span>Base time <b>{selectedCost.cost.baseTravelTimeSeconds.toFixed(2)} s</b> · Profile cost <b>{selectedCost.cost.generalizedCostSeconds.toFixed(2)} s</b></span>
            {selectedSpatial?.impacts.map((impact) => <span key={impact.constraintFeatureId}>Spatial <b>{impact.category}</b> · {impact.effect} · {impact.relation} · {(impact.affectedFraction * 100).toFixed(1)}% · {impact.exception ? `exception ${impact.exception}` : impact.reason}</span>)}
            <span>Spatial ×<b>{selectedSpatial?.spatialMultiplier.toFixed(3) ?? "1.000"}</b> · Spatial cost <b>{selectedSpatial?.spatialCostSeconds.toFixed(2) ?? selectedCost.cost.generalizedCostSeconds.toFixed(2)} s</b></span>
            <span>Scenario ×<b>{selectedPenalty.toFixed(1)}</b> · Effective <b>{selectedPrepared?.effectiveCost.toFixed(2) ?? ((selectedSpatial?.spatialCostSeconds ?? selectedCost.cost.generalizedCostSeconds) * selectedPenalty).toFixed(2)} s</b></span>
            <span>Source <b>{selectedCost.cost.sourceFeatureId}</b> · Provenance conflict <b>{selectedCost.provenanceCostConflict ? "yes" : "no"}</b></span>
          </div>
        </details>}
        {prepared && (
          <section className="scenario-section" aria-label="Scenario controls">
            <div className="scenario-heading"><strong>Scenario</strong><span className={prepared.validation.valid ? "status-valid" : "status-invalid"}>{prepared.validation.valid ? "Valid" : "Invalid"}</span></div>
            <div className="scenario-stats">
              <label>Source <select aria-label="Source node" value={source?.nodeId ?? ""} onChange={(event) => event.target.value && updateScenario((current) => setTerminal(current, "source", event.target.value))}><option value="">not selected</option>{graphResult.graph?.nodes.filter((node) => spatial?.activeNodeIds.has(node.id)).map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
              <label>Sink <select aria-label="Sink node" value={sink?.nodeId ?? ""} onChange={(event) => event.target.value && updateScenario((current) => setTerminal(current, "sink", event.target.value))}><option value="">not selected</option>{graphResult.graph?.nodes.filter((node) => spatial?.activeNodeIds.has(node.id)).map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
              <label>Edge <select aria-label="Scenario edge" value={selectedEdgeId} onChange={(event) => setSelectedEdgeId(event.target.value)}><option value="">select on map</option>{spatial?.usableEdges.map((edge) => <option key={edge.id} value={edge.id}>{edge.id}</option>)}</select></label>
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
          <label className="layer-toggle"><span>Profile cost</span><input type="checkbox" checked={costVisible} onChange={(event) => setCostVisible(event.target.checked)} /></label>
          <label className="layer-toggle"><span>Spatial impacts</span><input type="checkbox" checked={spatialVisible} onChange={(event) => setSpatialVisible(event.target.checked)} /></label>
        </fieldset>
        {importError && <div className="import-error" role="alert">{importError}</div>}
      </aside>
    </section>
  );
}

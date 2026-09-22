import type { GeoJSONSourceSpecification } from "maplibre-gl";
import type { GISPosition } from "../gis/types";
import { createLayerRegistry, type LayerRegistry } from "../map/layer-registry";
import type { DesignFieldState } from "./adaptation";
import type { DesignBarrier, DesignTerminal } from "./network";
import { createLocalProjection } from "./projection";
import type { DesignArea, DesignCandidateNetwork } from "./types";

export type DesignFieldFeature = {
  readonly type: "Feature";
  readonly id: string;
  readonly properties: {
    readonly edgeId: string;
    readonly conductivity: number;
    readonly fluxDensity: number;
    /** Visualization only — NOT a claim that this edge is a proposed road. */
    readonly normalizedConductivity: number;
    readonly normalizedFluxDensity: number;
  };
  readonly geometry: { readonly type: "LineString"; readonly coordinates: readonly GISPosition[] };
};

export type DesignFieldCollection = {
  readonly type: "FeatureCollection";
  readonly features: readonly DesignFieldFeature[];
  readonly maximumConductivity: number;
  readonly maximumFluxDensity: number;
};

/**
 * Renders the adapted field as a continuous strength layer over the candidate
 * mesh. Task 18 deliberately stops here: no conductivity threshold is applied
 * and no edge is promoted to a "proposed road". The `normalized*` properties
 * exist so a renderer can scale width/opacity, and carry no scientific
 * meaning beyond that.
 */
export function createDesignFieldCollection(mesh: DesignCandidateNetwork, state: DesignFieldState): DesignFieldCollection {
  const positionById = new Map(mesh.nodes.map((node) => [node.id, node.position]));
  const conductivities = Object.values(state.conductivity);
  const fluxes = Object.values(state.fluxDensity);
  const maximumConductivity = conductivities.length ? Math.max(...conductivities) : 0;
  const maximumFluxDensity = fluxes.length ? Math.max(...fluxes) : 0;

  const features: DesignFieldFeature[] = [];
  for (const edge of mesh.edges) {
    const conductivity = state.conductivity[edge.id];
    const fluxDensity = state.fluxDensity[edge.id];
    const from = positionById.get(edge.fromNodeId), to = positionById.get(edge.toNodeId);
    if (conductivity === undefined || fluxDensity === undefined || !from || !to) continue;
    if (!Number.isFinite(conductivity) || !Number.isFinite(fluxDensity)) continue;
    features.push({
      type: "Feature",
      id: `design-${edge.id}`,
      properties: {
        edgeId: edge.id,
        conductivity,
        fluxDensity,
        normalizedConductivity: maximumConductivity > 0 ? conductivity / maximumConductivity : 0,
        normalizedFluxDensity: maximumFluxDensity > 0 ? fluxDensity / maximumFluxDensity : 0,
      },
      geometry: { type: "LineString", coordinates: [from, to] },
    });
  }
  return { type: "FeatureCollection", features, maximumConductivity, maximumFluxDensity };
}

type MapGeoJSON = Exclude<GeoJSONSourceSpecification["data"], string>;

const EMPTY = { type: "FeatureCollection", features: [] } as unknown as MapGeoJSON;

/** What the workspace currently has staged for Design, at whatever stage it reached. */
export type DesignMapView = {
  /** False outside Design mode: the layers stay registered but hidden, because
   * MapLibre sync adds layers and never removes them. */
  readonly active: boolean;
  readonly area: DesignArea | null;
  readonly mesh: DesignCandidateNetwork | null;
  readonly terminals: readonly DesignTerminal[];
  /** Hard barriers actually fed to the science, so what is drawn is what blocks. */
  readonly barriers: readonly DesignBarrier[];
  readonly state: DesignFieldState | null;
};

function areaRing(area: DesignArea): GISPosition[] {
  const [west, south, east, north] = area.bounds;
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

/**
 * Approximates the marker's physical support radius as a ring in the SAME local
 * metric plane the mesh and barriers use, so what the user sees is the region
 * that actually receives demand, not a fixed screen-pixel dot.
 */
function supportRing(terminal: DesignTerminal, area: DesignArea, segments = 48): GISPosition[] {
  const projection = createLocalProjection(area.origin);
  const [x, y] = projection.project(terminal.centre);
  const ring: GISPosition[] = [];
  for (let step = 0; step <= segments; step += 1) {
    const angle = (2 * Math.PI * step) / segments;
    ring.push(projection.unproject([x + terminal.radiusMeters * Math.cos(angle), y + terminal.radiusMeters * Math.sin(angle)]));
  }
  return ring;
}

/**
 * Design layers. The field is drawn as a continuous strength ramp over every
 * candidate edge — deliberately no threshold, no corridor extraction, and no
 * "proposed road" styling, because Task 18 stops at the field.
 */
export function addDesignToRegistry(base: LayerRegistry, view: DesignMapView): LayerRegistry {
  const { active, area, mesh, terminals, barriers, state } = view;

  const areaData = area ? { type: "FeatureCollection", features: [{ type: "Feature", id: "design-area", properties: {}, geometry: { type: "Polygon", coordinates: [areaRing(area)] } }] } as unknown as MapGeoJSON : EMPTY;

  const positionById = mesh ? new Map(mesh.nodes.map((node) => [node.id, node.position])) : new Map<string, GISPosition>();
  const meshData = mesh ? { type: "FeatureCollection", features: mesh.edges.flatMap((edge) => {
    const from = positionById.get(edge.fromNodeId), to = positionById.get(edge.toNodeId);
    return from && to ? [{ type: "Feature", id: `design-mesh-${edge.id}`, properties: { edgeId: edge.id }, geometry: { type: "LineString", coordinates: [from, to] } }] : [];
  }) } as unknown as MapGeoJSON : EMPTY;

  const fieldData = mesh && state ? createDesignFieldCollection(mesh, state) as unknown as MapGeoJSON : EMPTY;

  const supportData = area ? { type: "FeatureCollection", features: terminals.map((terminal) => ({ type: "Feature", id: `design-support-${terminal.id}`, properties: { role: terminal.role, terminalId: terminal.id }, geometry: { type: "Polygon", coordinates: [supportRing(terminal, area)] } })) } as unknown as MapGeoJSON : EMPTY;

  const barrierData = barriers.length ? { type: "FeatureCollection", features: barriers.map((barrier) => ({ type: "Feature", id: `design-barrier-${barrier.id}`, properties: { kind: barrier.kind }, geometry: barrier.geometry })) } as unknown as MapGeoJSON : EMPTY;

  const centreData = { type: "FeatureCollection", features: terminals.map((terminal) => ({ type: "Feature", id: `design-centre-${terminal.id}`, properties: { role: terminal.role, terminalId: terminal.id }, geometry: { type: "Point", coordinates: terminal.centre } })) } as unknown as MapGeoJSON;


  return createLayerRegistry(
    [
      ...base.sources,
      { id: "design-area-source", definition: { type: "geojson", data: areaData } },
      { id: "design-mesh-source", definition: { type: "geojson", data: meshData } },
      { id: "design-field-source", definition: { type: "geojson", data: fieldData } },
      { id: "design-barrier-source", definition: { type: "geojson", data: barrierData } },
      { id: "design-support-source", definition: { type: "geojson", data: supportData } },
      { id: "design-centre-source", definition: { type: "geojson", data: centreData } },
    ],
    [
      ...base.layers,
      { id: "design-area", type: "line", source: "design-area-source", visible: active && area !== null, paint: { "line-color": "#94a3b8", "line-width": 1.5, "line-dasharray": [3, 3] } },
      { id: "design-mesh", type: "line", source: "design-mesh-source", visible: active && mesh !== null && (state === null || state.diagnostics.iteration === 0), paint: { "line-color": "#7dd3fc", "line-width": 0.7, "line-opacity": 0.5 } },
      { id: "design-field", type: "line", source: "design-field-source", visible: active && state !== null && state.diagnostics.iteration > 0, paint: { "line-color": ["interpolate", ["linear"], ["get", "normalizedConductivity"], 0, "#1e293b", 0.35, "#2563eb", 0.7, "#43d9c8", 1, "#f8ff8b"], "line-width": ["interpolate", ["linear"], ["get", "normalizedConductivity"], 0, 0.5, 1, 7], "line-opacity": 0.95 } },
      { id: "design-barrier-fill", type: "fill", source: "design-barrier-source", visible: active && barriers.length > 0, paint: { "fill-color": ["match", ["get", "kind"], "water", "#1d4ed8", "#b45309"], "fill-opacity": 0.45 } },
      { id: "design-barrier-line", type: "line", source: "design-barrier-source", visible: active && barriers.length > 0, paint: { "line-color": ["match", ["get", "kind"], "water", "#60a5fa", "#fbbf24"], "line-width": 1 } },
      { id: "design-support", type: "fill", source: "design-support-source", visible: active && terminals.length > 0, paint: { "fill-color": ["match", ["get", "role"], "source", "#f8ff8b", "#43d9c8"], "fill-opacity": 0.14 } },
      { id: "design-centre", type: "circle", source: "design-centre-source", visible: active && terminals.length > 0, paint: { "circle-color": ["match", ["get", "role"], "source", "#f8ff8b", "#43d9c8"], "circle-radius": 5, "circle-stroke-color": "#0f172a", "circle-stroke-width": 1.5 } },
    ],
  );
}

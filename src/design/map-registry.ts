import type { GISPosition } from "../gis/types";
import type { DesignFieldState } from "./adaptation";
import type { DesignCandidateNetwork } from "./types";

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

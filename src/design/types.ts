import type { GISBounds, GISPosition } from "../gis/types";

export type DesignArea = {
  readonly bounds: GISBounds;
  readonly origin: GISPosition;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly areaSquareMeters: number;
  readonly projectionErrorBound: number;
};

export type DesignNode = {
  readonly id: string;
  /** Local metric coordinates — the scientific domain (see projection.ts). */
  readonly metric: readonly [number, number];
  /** Reconstructed lon/lat, for rendering and export only. */
  readonly position: GISPosition;
};

/**
 * A candidate edge is an element of a discretized conductivity field, not a
 * proposed road. `lengthMeters` is the primal edge length l_e and
 * `widthMeters` the dual (Voronoi) interface width w_e; together they give the
 * finite-volume transmissibility w_e / l_e established in Task 18 Gate D.
 */
export type DesignEdge = {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly lengthMeters: number;
  readonly widthMeters: number;
};

export type DesignMeshDiagnostics = {
  readonly algorithm: "equilateral-triangular-voronoi";
  readonly requestedSpacingMeters: number;
  readonly effectiveSpacingMeters: number;
  readonly rows: number;
  readonly rowsAreOdd: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly averageDegree: number;
  readonly transmissibility: number;
};

export type DesignCandidateNetwork = {
  readonly area: DesignArea;
  readonly nodes: readonly DesignNode[];
  readonly edges: readonly DesignEdge[];
  readonly diagnostics: DesignMeshDiagnostics;
};

export type DesignMeshLimits = {
  readonly maxNodes: number;
  readonly maxEdges: number;
};

/** Envelope validated in Task 18 Gates D–F; beyond this convergence was not demonstrated. */
export const DEFAULT_DESIGN_MESH_LIMITS: DesignMeshLimits = { maxNodes: 12_000, maxEdges: 36_000 };

export class DesignMeshError extends Error {
  constructor(readonly code: "invalid-area" | "invalid-spacing" | "limit-exceeded", message: string) {
    super(message);
    this.name = "DesignMeshError";
  }
}

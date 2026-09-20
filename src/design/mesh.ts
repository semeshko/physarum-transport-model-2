import type { GISBounds } from "../gis/types";
import { boundsCentre, createLocalProjection, projectionErrorBound } from "./projection";
import {
  DEFAULT_DESIGN_MESH_LIMITS,
  DesignMeshError,
  type DesignArea,
  type DesignCandidateNetwork,
  type DesignEdge,
  type DesignMeshLimits,
  type DesignNode,
} from "./types";

const ROW_HEIGHT_FACTOR = Math.sqrt(3) / 2;
/** Voronoi interface width of an equilateral triangular lattice: w_e = a / sqrt(3). */
const DUAL_WIDTH_FACTOR = 1 / Math.sqrt(3);

export function createDesignArea(bounds: GISBounds): DesignArea {
  const [west, south, east, north] = bounds;
  if (!(east > west) || !(north > south)) throw new DesignMeshError("invalid-area", "Design AOI bounds must be non-degenerate.");
  const origin = boundsCentre(bounds);
  const projection = createLocalProjection(origin);
  const [x0, y0] = projection.project([west, south]);
  const [x1, y1] = projection.project([east, north]);
  const widthMeters = x1 - x0, heightMeters = y1 - y0;
  return {
    bounds,
    origin,
    widthMeters,
    heightMeters,
    areaSquareMeters: widthMeters * heightMeters,
    projectionErrorBound: projectionErrorBound(origin, Math.max(widthMeters, heightMeters) / 2),
  };
}

/**
 * Chooses the row count nearest the requested spacing that is ODD, then derives
 * the effective spacing so the lattice spans the AOI height exactly.
 *
 * Both conditions come from Task 18 Gate F: an equilateral lattice is mirror
 * symmetric about its centre only when the row count is odd (row j maps to row
 * rows-1-j with the same half-row x offset), and spanning the height exactly
 * removes the residual centring offset. Verified there: odd row counts gave
 * exactly 0.000% flux asymmetry across a symmetric obstacle at three
 * independent spacings, even counts did not.
 */
export function resolveRowGeometry(heightMeters: number, requestedSpacingMeters: number): { rows: number; spacingMeters: number } {
  if (!(requestedSpacingMeters > 0) || !Number.isFinite(requestedSpacingMeters)) throw new DesignMeshError("invalid-spacing", "Spacing must be a positive, finite number of metres.");
  const requestedRowHeight = requestedSpacingMeters * ROW_HEIGHT_FACTOR;
  const idealRows = heightMeters / requestedRowHeight + 1;
  const lower = Math.max(3, 2 * Math.floor((idealRows - 1) / 2) + 1);
  const upper = lower + 2;
  const rows = Math.abs(idealRows - lower) <= Math.abs(idealRows - upper) ? lower : upper;
  return { rows, spacingMeters: heightMeters / (rows - 1) / ROW_HEIGHT_FACTOR };
}

export function estimateDesignMeshSize(area: DesignArea, requestedSpacingMeters: number): { rows: number; spacingMeters: number; nodeCount: number; edgeCount: number } {
  const { rows, spacingMeters } = resolveRowGeometry(area.heightMeters, requestedSpacingMeters);
  const columns = Math.floor(area.widthMeters / spacingMeters) + 1;
  const nodeCount = rows * columns;
  return { rows, spacingMeters, nodeCount, edgeCount: Math.round(nodeCount * 3) };
}

/**
 * Deterministic equilateral triangular candidate mesh with Voronoi dual widths.
 *
 * Same AOI + same requested spacing always yields identical node and edge
 * identities; ids are pure functions of the lattice indices, never random.
 */
export function buildDesignMesh(area: DesignArea, requestedSpacingMeters: number, limits: DesignMeshLimits = DEFAULT_DESIGN_MESH_LIMITS): DesignCandidateNetwork {
  const estimate = estimateDesignMeshSize(area, requestedSpacingMeters);
  if (estimate.nodeCount > limits.maxNodes || estimate.edgeCount > limits.maxEdges) {
    throw new DesignMeshError("limit-exceeded", `Requested mesh is ~${estimate.nodeCount} nodes / ~${estimate.edgeCount} edges, above the safe envelope (${limits.maxNodes}/${limits.maxEdges}). Use a coarser spacing or a smaller area.`);
  }

  const { rows, spacingMeters } = estimate;
  const rowHeight = spacingMeters * ROW_HEIGHT_FACTOR;
  const projection = createLocalProjection(area.origin);
  const halfWidth = area.widthMeters / 2, halfHeight = area.heightMeters / 2;
  const nodeId = (i: number, j: number) => `dn-${i}-${j}`;

  const nodes: DesignNode[] = [];
  const present = new Set<string>();
  for (let j = 0; j < rows; j += 1) {
    const offset = j % 2 === 1 ? spacingMeters / 2 : 0;
    const columns = Math.floor((area.widthMeters - offset) / spacingMeters);
    for (let i = 0; i <= columns; i += 1) {
      const metric = [i * spacingMeters + offset - halfWidth, j * rowHeight - halfHeight] as const;
      const id = nodeId(i, j);
      present.add(id);
      nodes.push({ id, metric, position: projection.unproject(metric) });
    }
  }

  const edges: DesignEdge[] = [];
  const widthMeters = spacingMeters * DUAL_WIDTH_FACTOR;
  const connect = (i1: number, j1: number, i2: number, j2: number) => {
    const from = nodeId(i1, j1), to = nodeId(i2, j2);
    if (!present.has(from) || !present.has(to)) return;
    edges.push({ id: `de-${from}|${to}`, fromNodeId: from, toNodeId: to, lengthMeters: spacingMeters, widthMeters });
  };
  for (let j = 0; j < rows; j += 1) {
    const offset = j % 2 === 1 ? spacingMeters / 2 : 0;
    const columns = Math.floor((area.widthMeters - offset) / spacingMeters);
    for (let i = 0; i <= columns; i += 1) {
      connect(i, j, i + 1, j);
      if (j + 1 >= rows) continue;
      connect(i, j, i, j + 1);
      if (j % 2 === 0) connect(i, j, i - 1, j + 1);
      else connect(i, j, i + 1, j + 1);
    }
  }

  return {
    area,
    nodes,
    edges,
    diagnostics: {
      algorithm: "equilateral-triangular-voronoi",
      requestedSpacingMeters,
      effectiveSpacingMeters: spacingMeters,
      rows,
      rowsAreOdd: rows % 2 === 1,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      averageDegree: nodes.length ? (2 * edges.length) / nodes.length : 0,
      transmissibility: widthMeters / spacingMeters,
    },
  };
}

import { describe, expect, it } from "vitest";
import type { GISBounds } from "../gis/types";
import { buildDesignMesh, createDesignArea, estimateDesignMeshSize, resolveRowGeometry } from "./mesh";
import { DesignMeshError } from "./types";

const LVIV_DISTRICT: GISBounds = [24.02, 49.835, 24.048, 49.851];

describe("design area", () => {
  it("measures the AOI in metres and reports projection distortion", () => {
    const area = createDesignArea(LVIV_DISTRICT);
    expect(area.widthMeters).toBeGreaterThan(1_500);
    expect(area.widthMeters).toBeLessThan(2_500);
    expect(area.heightMeters).toBeGreaterThan(1_500);
    expect(area.areaSquareMeters).toBeCloseTo(area.widthMeters * area.heightMeters, 6);
    expect(area.projectionErrorBound).toBeLessThan(2e-3);
  });

  it("rejects degenerate bounds", () => {
    expect(() => createDesignArea([24, 49.8, 24, 49.9])).toThrow(DesignMeshError);
    expect(() => createDesignArea([24, 49.9, 24.1, 49.8])).toThrow(DesignMeshError);
  });
});

describe("row geometry (Gate F parity rule)", () => {
  it("always returns an odd row count", () => {
    for (const height of [400, 600, 613.7, 900, 1_234.5]) {
      for (const spacing of [10, 15, 20, 25, 30, 40]) {
        expect(resolveRowGeometry(height, spacing).rows % 2).toBe(1);
      }
    }
  });

  it("spans the full height exactly so no centring offset remains", () => {
    for (const height of [600, 851.25]) {
      for (const spacing of [12, 20, 33]) {
        const { rows, spacingMeters } = resolveRowGeometry(height, spacing);
        const rowHeight = spacingMeters * (Math.sqrt(3) / 2);
        expect((rows - 1) * rowHeight).toBeCloseTo(height, 9);
      }
    }
  });

  it("stays close to the requested spacing", () => {
    for (const spacing of [10, 20, 30, 40]) {
      const { spacingMeters } = resolveRowGeometry(1_000, spacing);
      expect(Math.abs(spacingMeters - spacing) / spacing).toBeLessThan(0.15);
    }
  });

  it("never produces fewer than three rows", () => {
    expect(resolveRowGeometry(10, 500).rows).toBe(3);
  });

  it("rejects invalid spacing", () => {
    expect(() => resolveRowGeometry(100, 0)).toThrow(DesignMeshError);
    expect(() => resolveRowGeometry(100, Number.NaN)).toThrow(DesignMeshError);
  });
});

describe("design candidate mesh", () => {
  const area = createDesignArea(LVIV_DISTRICT);

  it("is deterministic: identical inputs give identical node and edge identities", () => {
    const a = buildDesignMesh(area, 60);
    const b = buildDesignMesh(createDesignArea(LVIV_DISTRICT), 60);
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id));
    expect(a.edges.map((e) => e.id)).toEqual(b.edges.map((e) => e.id));
    expect(a.nodes.map((n) => n.metric)).toEqual(b.nodes.map((n) => n.metric));
  });

  it("uses no random identifiers", () => {
    const mesh = buildDesignMesh(area, 60);
    for (const node of mesh.nodes) expect(node.id).toMatch(/^dn-\d+-\d+$/);
    for (const edge of mesh.edges) expect(edge.id).toMatch(/^de-dn-\d+-\d+\|dn-\d+-\d+$/);
  });

  it("reports an odd row count and the Voronoi transmissibility", () => {
    const mesh = buildDesignMesh(area, 60);
    expect(mesh.diagnostics.rowsAreOdd).toBe(true);
    expect(mesh.diagnostics.rows % 2).toBe(1);
    expect(mesh.diagnostics.transmissibility).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(mesh.diagnostics.algorithm).toBe("equilateral-triangular-voronoi");
  });

  it("gives every edge a positive finite length and dual width", () => {
    const mesh = buildDesignMesh(area, 60);
    expect(mesh.edges.length).toBeGreaterThan(0);
    for (const edge of mesh.edges) {
      expect(edge.lengthMeters).toBeGreaterThan(0);
      expect(edge.widthMeters).toBeGreaterThan(0);
      expect(Number.isFinite(edge.lengthMeters)).toBe(true);
      expect(Number.isFinite(edge.widthMeters)).toBe(true);
      expect(edge.widthMeters / edge.lengthMeters).toBeCloseTo(1 / Math.sqrt(3), 12);
    }
  });

  it("has no self loops and no duplicate edges", () => {
    const mesh = buildDesignMesh(area, 60);
    const seen = new Set<string>();
    for (const edge of mesh.edges) {
      expect(edge.fromNodeId).not.toBe(edge.toNodeId);
      const key = [edge.fromNodeId, edge.toNodeId].sort().join("~");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("references only existing nodes", () => {
    const mesh = buildDesignMesh(area, 60);
    const ids = new Set(mesh.nodes.map((n) => n.id));
    for (const edge of mesh.edges) {
      expect(ids.has(edge.fromNodeId)).toBe(true);
      expect(ids.has(edge.toNodeId)).toBe(true);
    }
  });

  it("places every edge's endpoints exactly one spacing apart in metric space", () => {
    const mesh = buildDesignMesh(area, 60);
    const byId = new Map(mesh.nodes.map((n) => [n.id, n.metric]));
    for (const edge of mesh.edges) {
      const a = byId.get(edge.fromNodeId)!, b = byId.get(edge.toNodeId)!;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(mesh.diagnostics.effectiveSpacingMeters, 6);
    }
  });

  it("is connected", () => {
    const mesh = buildDesignMesh(area, 60);
    const adjacency = new Map<string, string[]>(mesh.nodes.map((n) => [n.id, []]));
    for (const edge of mesh.edges) { adjacency.get(edge.fromNodeId)!.push(edge.toNodeId); adjacency.get(edge.toNodeId)!.push(edge.fromNodeId); }
    const seen = new Set<string>([mesh.nodes[0].id]);
    const stack = [mesh.nodes[0].id];
    while (stack.length) for (const next of adjacency.get(stack.pop()!)!) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    expect(seen.size).toBe(mesh.nodes.length);
  });

  it("is mirror symmetric about the horizontal centre line", () => {
    const mesh = buildDesignMesh(area, 60);
    const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
    const above = mesh.nodes.filter((n) => rounded(n.metric[1]) > 0).map((n) => rounded(-n.metric[1])).sort((a, b) => a - b);
    const below = mesh.nodes.filter((n) => rounded(n.metric[1]) < 0).map((n) => rounded(n.metric[1])).sort((a, b) => a - b);
    expect(above).toEqual(below);
  });

  it("keeps all nodes inside the AOI", () => {
    const mesh = buildDesignMesh(area, 60);
    const halfWidth = area.widthMeters / 2 + 1e-6, halfHeight = area.heightMeters / 2 + 1e-6;
    for (const node of mesh.nodes) {
      expect(Math.abs(node.metric[0])).toBeLessThanOrEqual(halfWidth);
      expect(Math.abs(node.metric[1])).toBeLessThanOrEqual(halfHeight);
    }
  });

  it("refuses to build a mesh beyond the validated safety envelope", () => {
    expect(() => buildDesignMesh(area, 2)).toThrow(DesignMeshError);
    try { buildDesignMesh(area, 2); } catch (error) { expect((error as DesignMeshError).code).toBe("limit-exceeded"); }
  });

  it("estimates size before paying for generation", () => {
    const estimate = estimateDesignMeshSize(area, 60);
    const mesh = buildDesignMesh(area, 60);
    expect(estimate.rows).toBe(mesh.diagnostics.rows);
    expect(estimate.spacingMeters).toBeCloseTo(mesh.diagnostics.effectiveSpacingMeters, 9);
    expect(Math.abs(estimate.nodeCount - mesh.nodes.length) / mesh.nodes.length).toBeLessThan(0.1);
  });
});

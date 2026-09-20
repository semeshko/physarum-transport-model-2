import type { DesignAdaptationParameters, DesignFieldState } from "./adaptation";
import type { DesignAssemblyDiagnostics } from "./network";
import type { DesignCandidateNetwork } from "./types";

export const DESIGN_REPORT_SCHEMA_VERSION = "design-v0-continuum-1" as const;

export type DesignReport = {
  readonly schemaVersion: typeof DESIGN_REPORT_SCHEMA_VERSION;
  readonly model: {
    readonly hydraulics: "-div((c + r) grad u) = S; G_e = (c_e + r) * w_e / l_e";
    readonly adaptation: "dc/dt = |grad u|^2 - nu * c^(gamma - 1)";
    readonly integrator: "semi-implicit (IMEX), decay linearised";
    readonly conductivityMeaning: "conductivity density (field value), not tube size";
    readonly parameters: DesignAdaptationParameters;
  };
  readonly area: {
    readonly bounds: DesignCandidateNetwork["area"]["bounds"];
    readonly widthMeters: number;
    readonly heightMeters: number;
    readonly areaSquareMeters: number;
    readonly projectionErrorBound: number;
  };
  readonly mesh: DesignCandidateNetwork["diagnostics"];
  readonly assembly: Omit<DesignAssemblyDiagnostics, "terminals"> & {
    readonly terminals: readonly { readonly terminalId: string; readonly supportNodeCount: number; readonly nearestDistanceMeters: number }[];
  };
  readonly result: {
    readonly iterations: number;
    readonly converged: boolean;
    readonly terminationReason: DesignFieldState["diagnostics"]["terminationReason"];
    readonly maxDelta: number;
    readonly energy: number;
    readonly energyMonotone: boolean;
    readonly maximumKirchhoffResidual: number;
    readonly conductivity: { readonly min: number; readonly median: number; readonly max: number; readonly integralOverArea: number };
    readonly fluxDensity: { readonly median: number; readonly max: number };
  };
  readonly error: string | null;
};

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Deterministic, self-describing summary of one Design run. Aggregates only —
 * the per-edge field belongs in the map layer, not in the report.
 */
export function createDesignReport(
  mesh: DesignCandidateNetwork,
  assembly: DesignAssemblyDiagnostics,
  parameters: DesignAdaptationParameters,
  state: DesignFieldState,
): DesignReport {
  const conductivities = Object.values(state.conductivity).slice().sort((a, b) => a - b);
  const fluxes = Object.values(state.fluxDensity).slice().sort((a, b) => a - b);
  const cellMeasure = new Map(mesh.edges.map((edge) => [edge.id, edge.widthMeters * edge.lengthMeters]));
  const integralOverArea = Object.entries(state.conductivity).reduce((sum, [id, value]) => sum + value * (cellMeasure.get(id) ?? 0), 0);

  return {
    schemaVersion: DESIGN_REPORT_SCHEMA_VERSION,
    model: {
      hydraulics: "-div((c + r) grad u) = S; G_e = (c_e + r) * w_e / l_e",
      adaptation: "dc/dt = |grad u|^2 - nu * c^(gamma - 1)",
      integrator: "semi-implicit (IMEX), decay linearised",
      conductivityMeaning: "conductivity density (field value), not tube size",
      parameters,
    },
    area: {
      bounds: mesh.area.bounds,
      widthMeters: mesh.area.widthMeters,
      heightMeters: mesh.area.heightMeters,
      areaSquareMeters: mesh.area.areaSquareMeters,
      projectionErrorBound: mesh.area.projectionErrorBound,
    },
    mesh: mesh.diagnostics,
    assembly: {
      candidateEdgeCount: assembly.candidateEdgeCount,
      blockedByBuildingCount: assembly.blockedByBuildingCount,
      blockedByWaterCount: assembly.blockedByWaterCount,
      usableEdgeCount: assembly.usableEdgeCount,
      totalPositiveDemand: assembly.totalPositiveDemand,
      totalNegativeDemand: assembly.totalNegativeDemand,
      terminals: assembly.terminals.map((terminal) => ({ terminalId: terminal.terminalId, supportNodeCount: terminal.nodeIds.length, nearestDistanceMeters: terminal.nearestDistanceMeters })),
    },
    result: {
      iterations: state.diagnostics.iteration,
      converged: state.diagnostics.converged,
      terminationReason: state.diagnostics.terminationReason,
      maxDelta: state.diagnostics.maxDelta,
      energy: state.diagnostics.energy,
      energyMonotone: state.diagnostics.energyMonotone,
      maximumKirchhoffResidual: state.diagnostics.maximumKirchhoffResidual,
      conductivity: { min: conductivities[0] ?? Number.NaN, median: quantile(conductivities, 0.5), max: conductivities.at(-1) ?? Number.NaN, integralOverArea },
      fluxDensity: { median: quantile(fluxes, 0.5), max: fluxes.at(-1) ?? Number.NaN },
    },
    error: state.error,
  };
}

export function serializeDesignReport(report: DesignReport): string {
  return JSON.stringify(report, null, 2);
}

import type { GISDataset } from "../gis/types";
import { createSpatialConstraintSet } from "../spatial-constraints/model";
import type { DesignBarrier } from "./network";

export type DesignBarrierPolicy = {
  readonly buildings: boolean;
  readonly water: boolean;
};

export const DEFAULT_DESIGN_BARRIER_POLICY: DesignBarrierPolicy = { buildings: true, water: true };

export type DesignBarrierSet = {
  readonly barriers: readonly DesignBarrier[];
  readonly buildingCount: number;
  readonly waterCount: number;
  /** Categorised as a barrier but with no area, so it cannot block anything. */
  readonly skippedNonPolygonCount: number;
  readonly greenContextCount: number;
};

/**
 * Turns an ingested GIS dataset into Design hard barriers.
 *
 * Reuses the Task 15 ingestion and the existing spatial categorisation rather
 * than re-deriving what counts as a building. Only buildings and polygonal
 * water are hard: green is counted for context and never returned as a
 * barrier, because Design v0 applies no green penalty. Line or point features
 * tagged as water are skipped — they have no width, so treating them as
 * impermeable would be inventing a barrier the data does not support.
 */
export function designBarriersFromDataset(dataset: GISDataset, policy: DesignBarrierPolicy = DEFAULT_DESIGN_BARRIER_POLICY): DesignBarrierSet {
  const constraints = createSpatialConstraintSet(dataset);
  const barriers: DesignBarrier[] = [];
  let buildingCount = 0, waterCount = 0, skippedNonPolygonCount = 0, greenContextCount = 0;

  for (const feature of constraints.features) {
    if (feature.category === "green") { greenContextCount += 1; continue; }
    const polygonal = feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
    if (!polygonal) { skippedNonPolygonCount += 1; continue; }
    if (feature.category === "building") {
      buildingCount += 1;
      if (policy.buildings) barriers.push({ id: feature.id, kind: "building", geometry: feature.geometry });
    } else if (feature.category === "water") {
      waterCount += 1;
      if (policy.water) barriers.push({ id: feature.id, kind: "water", geometry: feature.geometry });
    }
  }

  return { barriers, buildingCount, waterCount, skippedNonPolygonCount, greenContextCount };
}

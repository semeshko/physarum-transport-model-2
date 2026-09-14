import type { GISProperties } from "../gis/types";
import type { GraphEdgeProvenance } from "../graph/types";
import { decideEdgeAccess } from "../transport-profile/profile";
import type { ProfiledTransportNetwork, TransportProfileId } from "../transport-profile/types";
import type { CostedTransportNetwork, EdgeCostBreakdown } from "./types";

const PROFILE_DEFAULT_SPEED: Readonly<Record<TransportProfileId, number>> = { pedestrian: 5, bicycle: 15, motor: 30 };
const SPEEDS: Readonly<Record<TransportProfileId, Readonly<Record<string, number>>>> = {
  pedestrian: { steps: 3.5, footway: 5, pedestrian: 5, path: 4.5, track: 4.5 },
  bicycle: { cycleway: 18, path: 12, track: 12, residential: 15, unclassified: 16, tertiary: 17, tertiary_link: 15, secondary: 17, secondary_link: 15, primary: 16, primary_link: 14, trunk: 16, trunk_link: 14, road: 15 },
  motor: { motorway: 100, motorway_link: 60, trunk: 80, trunk_link: 50, primary: 60, primary_link: 40, secondary: 50, secondary_link: 35, tertiary: 40, tertiary_link: 30, unclassified: 35, residential: 30, track: 20, road: 30 },
};
const SURFACE_BANDS: Readonly<Record<string, readonly [number, number, number]>> = {
  asphalt: [1, 1, 1], concrete: [1, 1, 1], paved: [1, 1, 1], paving_stones: [1.05, 1.08, 1.05],
  compacted: [1.05, 1.15, 1.1], fine_gravel: [1.08, 1.25, 1.15], gravel: [1.1, 1.35, 1.2], cobblestone: [1.1, 1.35, 1.2], sett: [1.08, 1.25, 1.15],
  unpaved: [1.15, 1.5, 1.35], ground: [1.15, 1.5, 1.35], dirt: [1.15, 1.5, 1.35], earth: [1.15, 1.5, 1.35], sand: [1.5, 2, 2], mud: [1.5, 2.2, 2.5],
};
const SMOOTHNESS_BANDS: Readonly<Record<string, readonly [number, number, number]>> = {
  excellent: [1, 1, 1], good: [1, 1, 1], intermediate: [1.02, 1.1, 1.1], bad: [1.1, 1.35, 1.4], very_bad: [1.25, 1.7, 2], horrible: [1.5, 2.5, 3], very_horrible: [1.8, 3, 4], impassable: [2.5, 4, 5],
};
const TRACKTYPE_FALLBACK_BANDS: Readonly<Record<string, readonly [number, number, number]>> = { grade1: [1, 1, 1], grade2: [1.05, 1.15, 1.1], grade3: [1.1, 1.3, 1.25], grade4: [1.2, 1.5, 1.5], grade5: [1.35, 1.8, 2] };
const PROFILE_INDEX: Readonly<Record<TransportProfileId, 0 | 1 | 2>> = { pedestrian: 0, bicycle: 1, motor: 2 };
const MINIMUM_COST_SECONDS = 0.001;

function tag(properties: GISProperties, key: string): string | null { const value = properties[key]; return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null; }
export function parseMaxspeedKilometersPerHour(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(km\/h|kmh|kph|mph)?$/);
  if (!match) return null;
  const numeric = Number(match[1]); if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return match[2] === "mph" ? numeric * 1.609344 : numeric;
}
function costForProvenance(lengthMeters: number, provenance: GraphEdgeProvenance, profileId: TransportProfileId): EdgeCostBreakdown {
  const highway = tag(provenance.sourceProperties, "highway");
  const explicit = profileId === "motor" ? parseMaxspeedKilometersPerHour(tag(provenance.sourceProperties, "maxspeed")) : null;
  const highwaySpeed = highway ? SPEEDS[profileId][highway] : undefined;
  const speedKilometersPerHour = Math.min(explicit ?? highwaySpeed ?? PROFILE_DEFAULT_SPEED[profileId], 160);
  const speedSource = explicit ? "explicit-maxspeed" as const : highwaySpeed ? "highway-default" as const : "profile-default" as const;
  const surface = tag(provenance.sourceProperties, "surface"); const smoothness = tag(provenance.sourceProperties, "smoothness"); const tracktype = tag(provenance.sourceProperties, "tracktype"); const index = PROFILE_INDEX[profileId];
  const surfaceFactor = surface ? SURFACE_BANDS[surface]?.[index] ?? 1 : 1; const smoothnessFactor = smoothness ? SMOOTHNESS_BANDS[smoothness]?.[index] ?? 1 : 1;
  const tracktypeFactor = !surface && !smoothness && tracktype ? TRACKTYPE_FALLBACK_BANDS[tracktype]?.[index] ?? 1 : 1; const conditionFactor = Math.max(surfaceFactor, smoothnessFactor, tracktypeFactor); const baseTravelTimeSeconds = lengthMeters / (speedKilometersPerHour / 3.6);
  const generalizedCostSeconds = Math.max(MINIMUM_COST_SECONDS, baseTravelTimeSeconds * conditionFactor);
  return { profileId, lengthMeters, speedKilometersPerHour, speedSource, speedEvidence: explicit ? `maxspeed=${tag(provenance.sourceProperties, "maxspeed")}` : highwaySpeed ? `model highway=${highway}` : `model profile=${profileId}`, baseTravelTimeSeconds, surface, surfaceFactor, smoothness, smoothnessFactor, tracktype, tracktypeFactor, conditionFactor, conditionSource: surface && smoothness ? "surface-and-smoothness" : surface ? "surface" : smoothness ? "smoothness" : tracktype ? "tracktype-fallback" : "default-neutral", comfortFactor: 1, generalizedCostSeconds, sourceFeatureId: provenance.sourceFeatureId };
}
function median(values: readonly number[]): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }

export function applyGeneralizedCosts(profiled: ProfiledTransportNetwork): CostedTransportNetwork {
  const edges = profiled.usableEdges.map((edge) => {
    const decision = decideEdgeAccess(edge, profiled.profileId); const allowedIds = new Set(decision.evidence.filter((item) => item.decision === "allowed").map((item) => item.sourceFeatureId));
    const candidateCosts = edge.provenance.filter((item) => allowedIds.has(item.sourceFeatureId)).map((item) => costForProvenance(edge.lengthMeters, item, profiled.profileId)).sort((a, b) => a.generalizedCostSeconds - b.generalizedCostSeconds || a.sourceFeatureId.localeCompare(b.sourceFeatureId));
    if (!candidateCosts.length) throw new Error(`Usable edge ${edge.id} has no allowed cost provenance.`);
    const cheapest = candidateCosts[0]; const provenanceCostConflict = candidateCosts.some((item) => Math.abs(item.generalizedCostSeconds - cheapest.generalizedCostSeconds) / cheapest.generalizedCostSeconds > 0.1);
    return { edge, cost: cheapest, provenanceCostConflict, candidateCosts };
  });
  const costs = edges.map((item) => item.cost);
  return { graphId: profiled.graphId, profileId: profiled.profileId, nodes: profiled.nodes, edges, diagnostics: { edgeCount: edges.length, explicitSpeedCount: costs.filter((item) => item.speedSource === "explicit-maxspeed").length, fallbackSpeedCount: costs.filter((item) => item.speedSource !== "explicit-maxspeed").length, surfaceTaggedCount: costs.filter((item) => item.surface !== null).length, smoothnessTaggedCount: costs.filter((item) => item.smoothness !== null).length, tracktypeTaggedCount: costs.filter((item) => item.tracktype !== null).length, provenanceCostConflictCount: edges.filter((item) => item.provenanceCostConflict).length, medianTravelTimeSeconds: median(costs.map((item) => item.generalizedCostSeconds)), medianCostPerMeter: median(costs.map((item) => item.generalizedCostSeconds / item.lengthMeters)) } };
}

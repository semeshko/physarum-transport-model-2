import type { GISBounds } from "../gis/types";

export const OSM_AREA_LIMITS = { maximumWidthKilometers: 1.5, maximumHeightKilometers: 1.5, maximumAreaSquareKilometers: 2, maximumWays: 5_000 } as const;

export type OSMAreaMeasurement = { readonly widthKilometers: number; readonly heightKilometers: number; readonly areaSquareKilometers: number };

export class OSMAreaError extends Error {
  constructor(message: string) { super(message); this.name = "OSMAreaError"; }
}

export function measureOSMArea(bounds: GISBounds): OSMAreaMeasurement {
  const [west, south, east, north] = bounds;
  if (![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) throw new OSMAreaError("The selected map area has invalid geographic bounds.");
  const middleLatitudeRadians = ((south + north) / 2) * Math.PI / 180;
  const widthKilometers = (east - west) * 111.32 * Math.cos(middleLatitudeRadians);
  const heightKilometers = (north - south) * 110.574;
  return { widthKilometers, heightKilometers, areaSquareKilometers: widthKilometers * heightKilometers };
}

export function validateOSMArea(bounds: GISBounds): OSMAreaMeasurement {
  const measurement = measureOSMArea(bounds);
  if (measurement.widthKilometers > OSM_AREA_LIMITS.maximumWidthKilometers || measurement.heightKilometers > OSM_AREA_LIMITS.maximumHeightKilometers || measurement.areaSquareKilometers > OSM_AREA_LIMITS.maximumAreaSquareKilometers) {
    throw new OSMAreaError(`Selected area is too large. Zoom in below ${OSM_AREA_LIMITS.maximumWidthKilometers} × ${OSM_AREA_LIMITS.maximumHeightKilometers} km (${OSM_AREA_LIMITS.maximumAreaSquareKilometers} km² maximum).`);
  }
  return measurement;
}

export function formatOSMBounds(bounds: GISBounds): string { return bounds.map((value) => value.toFixed(6)).join(","); }

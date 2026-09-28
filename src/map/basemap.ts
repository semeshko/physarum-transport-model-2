/** Display-only configuration. Never use basemap tiles as Analyze input. */
export const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
export const BASEMAP_ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">© CARTO</a>';

export function cartoRequest(url: string, key: string | undefined): { url: string } {
  if (!key?.trim()) return { url };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !(parsed.hostname === "basemaps.cartocdn.com" || parsed.hostname.endsWith(".basemaps.cartocdn.com"))) return { url };
    parsed.searchParams.set("key", key.trim());
    return { url: parsed.href };
  } catch { return { url }; }
}

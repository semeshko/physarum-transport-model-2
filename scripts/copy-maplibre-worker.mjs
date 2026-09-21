import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * MapLibre 6 derives its Worker URL from its own `import.meta.url` and gives up
 * with an empty string when that is not an http(s) URL — which is exactly what
 * happens once a bundler rewrites the module. `new Worker("")` then loads the
 * HTML document itself as a module worker, so the worker never answers and
 * every source (vector tiles AND inline GeoJSON) stays unloaded forever.
 *
 * We copy the worker chunks out of the installed package and serve them from
 * /public, so `setWorkerUrl` in MapCanvas can point at a real same-origin URL.
 * Copying (instead of committing a vendored file) keeps the worker locked to
 * the installed maplibre-gl version.
 */
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const target = join(process.cwd(), "public");

// The worker imports the shared chunk relatively, so both must sit side by side.
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(join(dist, file), join(target, file));
console.log(`Copied ${files.join(", ")} to public/`);

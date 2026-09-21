# Task 18A — Design Mode Visual MVP

Status: **ready for manual visual test**. Not committed — the next action is Ivan's browser check.

## Inspection of the existing integration (done before editing)

| Concern | What exists | Decision |
|---|---|---|
| Worker | 4-file pattern: pure protocol + pure machine + thin DOM shim + React hook | Mirrored exactly for Design |
| Run IDs | `physarum-${Date.now()}-${seq}`, stale guard in the reducer | Mirrored as `design-…` |
| Pause / Resume / Cancel | Machine flags; `isRunnable` gates the scheduler | Mirrored |
| Stale-result protection | `if (message.runId !== state.runId) return state;` plus a finished-state guard | Mirrored |
| Map layers | `createLayerRegistry` → `syncLayerRegistry`; adds layers, **never removes** them | Design layers always registered, visibility gated on mode |
| AOI interaction | `capture-bounds` camera command → `onBoundsCaptured(bounds)` | Reused; routed by mode |
| Terminal placement | Analyze picks graph nodes via `queryRenderedFeatures` | Design needs arbitrary positions → added `onMapClick(lngLat)` to `MapCanvas` |

**Separate Design Worker, not a mode flag on the Analyze one.** `PhysarumState` (per-edge `D` under the Hill law) and `DesignFieldState` (conductivity density + flux density under Hu–Cai/IMEX) are different scientific states; a discriminated union would have leaked into every message, reducer and consumer. The two Workers share only the hydraulic solver.

## The boundary, still intact

```
            shared hydraulics (weighted Laplacian / CG)
                            |
              +-------------+-------------+
           ANALYZE                     DESIGN
        graph Hill adaptation     continuum Hu-Cai + IMEX
```

`src/design/worker-machine.test.ts` asserts this structurally: the Design worker path must not import `physarum/solver` or name `stepPhysarum` / `runPhysarum` / `initializePhysarum`. It also asserts that batching is a scheduling detail only — stepping the machine in batches of 7 reproduces `runDesignField`'s conductivity field exactly.

## What changed

**New**
- `src/design/worker-protocol.ts` — messages, runtime state, reducer
- `src/design/worker-machine.ts` — pure `DesignWorkerMachine`
- `src/workers/design.worker.ts` — DOM shim, batch scheduler
- `src/hooks/useDesignRuntime.ts` — React hook
- `src/design/worker-machine.test.ts` — 11 tests

**Changed**
- `src/design/adaptation.ts` — the run is now steppable: `DesignSimulation`, `initializeDesignField`, `advanceDesignField`. `runDesignField` is a loop over them, so the main-thread and Worker paths are the same code. `terminationReason` gained `null` = still running. Behaviour-preserving: all pre-existing Design tests pass untouched.
- `src/design/map-registry.ts` — `addDesignToRegistry` (AOI outline, bare mesh, conductivity field, marker support discs, marker centres)
- `src/components/MapCanvas.tsx` — optional `onMapClick`
- `src/components/MapWorkspace.tsx` — Analyze/Design switch and the Design panel

## The workflow to test

1. **Design** in the mode switch (top of the panel).
2. Zoom to roughly a **2–4 km** wide district, then **Capture current view**. The dashed AOI rectangle and the bare triangular mesh appear.
3. Pick a **spacing** (200 / 150 / 120 / 90 / 60 m). Mesh diagnostics report node/edge counts, row parity, effective spacing and transmissibility.
4. **Place source**, click the map. **Place sink**, click the map. Each marker draws its physical support disc; assembly diagnostics report how many mesh nodes it actually covers.
5. Adjust the **support radius** (150 / 250 / 400 / 600 m) if a marker covers too few nodes.
6. **Run field** → **Pause** → **Resume**. Iteration, max Δc, energy + monotonicity, and the Kirchhoff residual update live.
7. The conductivity field replaces the bare mesh, colour and width scaling with normalized conductivity.

**Measured envelope** (one IMEX step, this machine): 623 edges → 6.5 ms; 1 393 → 18 ms; 1 728 → 28 ms; 5 030 → 55 ms. Batches of 5 steps run in the Worker, so the map stays responsive throughout. Beyond ~12 000 nodes / 36 000 edges the mesh builder refuses with an explicit message naming the estimate — zoom in or coarsen the spacing.

## What this MVP deliberately does not do

- **No barriers wired to the UI.** `assembleDesignNetwork` takes buildings and water and is tested on them, but the Design panel does not yet feed the dataset's polygons in. Next step, not a scientific gap.
- **No corridor extraction, no threshold, no proposed roads.** The map shows a continuous field; `normalizedConductivity` is a rendering scale with no scientific meaning.
- One source and one sink; re-clicking a role moves it.
- No report export button yet (`createDesignReport` exists and is tested).

## Verification

356/356 tests pass · `eslint` clean (4 warnings, all in untracked `scratch/`) · `next build` clean.

---

# Addendum — blank MapLibre viewport (found in the first browser smoke)

The first browser smoke failed before any Design testing: the whole map viewport was black in **both** Analyze and Design.

## Root cause

MapLibre 6 derives its Worker URL from its own `import.meta.url` and gives up silently when that is not an `http(s)` URL:

```js
function qi() {
  let e = import.meta.url;
  if (!/^https?:/.test(e)) return ``;   // <- bundled build lands here
  ...
  return new URL(`./maplibre-gl-worker.mjs`, e).href;
}
```

Under Turbopack the rewritten module URL is not `http(s)`, so the worker URL is `""`. `new Worker("", { type: "module" })` resolves against the document, so MapLibre loaded **the HTML page itself** as its worker. It never answers the Actor protocol and never raises an error.

MapLibre 6 parses **every** source in that worker — vector tiles and inline GeoJSON alike. So the style parsed on the main thread (`style.load` fired, sprite loaded), but no source ever became ready, no tile was ever requested, and the renderer painted only the style's `background` layer, `#0e0e0e`. Hence a black viewport with a working attribution control.

This is **not** a Task 18A regression: a bare `new maplibregl.Map()` with no application layers reproduced it identically. maplibre-gl 6.10.0 has the same code, so upgrading does not help.

## Evidence

| Check | Before | After |
|---|---|---|
| `maplibregl.getWorkerUrl()` | `""` | `http://localhost:3000/maplibre-gl-worker.mjs` |
| Worker URL seen by the browser | `http://localhost:3000/` (the HTML document) | `/maplibre-gl-worker.mjs` |
| `.mvt` tile requests | **0** | 6 on load, 30 after pan/zoom |
| `map.isStyleLoaded()` after 10 s | `false` | `true` |
| `isSourceLoaded` (all 14 sources) | all `false` | loaded |
| Console / page / request errors | none | none |
| style.json · tiles.json · sprite | 200 · 200 · 200 | unchanged |

The absence of any error was the misleading part: nothing fails, the worker simply never replies.

## Fix

- `scripts/copy-maplibre-worker.mjs` — copies `maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` from the installed package into `public/`. Copying rather than vendoring keeps the worker locked to the installed version.
- `package.json` — `predev` / `prebuild` run that script.
- `src/components/MapCanvas.tsx` — `if (!maplibregl.getWorkerUrl()) maplibregl.setWorkerUrl(...)`, using MapLibre's public API. The guard means a future MapLibre that resolves its own worker keeps doing so.
- `.gitignore` / `eslint.config.mjs` — ignore the two generated chunks.
- `src/design/map-registry.ts` — candidate mesh restyled from `#334155` 0.6 px to `#7dd3fc` 0.7 px @ 0.5 opacity; at the old value it was invisible over the dark basemap.

## Post-fix browser smoke

Basemap visible in Analyze · pan and zoom load new tiles (6 → 30) · Design keeps the basemap · Capture current view works · the triangular mesh draws **above** the basemap · zero console, page or request errors.

356/356 tests · lint clean (4 warnings, all in untracked `scratch/`) · build clean, `prebuild` copies the worker on a cold checkout.

---

# End-to-end browser QA (after the basemap fix)

Driven in a real Chrome via CDP, Design mode, AOI 8.62 × 5.54 km over Lviv, spacing 120 m.

| Step | Result |
|---|---|
| Capture AOI → mesh | 4 015 nodes · 11 790 edges · mean degree 5.87 · rows 55 (odd → mirror symmetric) · effective spacing 118.4 m · w/l 0.5774 |
| Place source / sink by map click | source support **17 nodes**, nearest 26.0 m; sink support **15 nodes**, nearest 49.7 m — both distributed, neither a single node |
| Demand balance | 1.000 / 1.000 |
| Usable edges | 11 790 of 11 790 |
| Run | iteration 5 → 10, max Δc 6.81e-2 → 8.51e-4 |
| Pause | diagnostics frozen across 2.5 s (verified identical), worker stops stepping |
| Resume | continues from iteration 10 → 20 |
| Convergence | **converged at iteration 36**, max Δc 8.15e-8 < tol 1e-7 |
| Energy | 2.457e+6 → 8.091e+2, **monotone** throughout |
| Kirchhoff residual | 2.44e-12 |
| Console / page errors | none |

Analyze dataset layers are hidden in Design mode (`DESIGN_GIS_VISIBILITY`): the panel states the existing network is not used, so drawing it was misleading. Geographic context comes from the basemap; barriers will get their own layer when they are wired in.

## Observation for the next gate (not acted on — Design science unchanged)

The converged field is a **broad, lattice-aligned band** with radial spokes at each terminal, not a single concentrated corridor. Both features are expected and neither is a defect:

- radial spokes: a finite-radius support behaves like a near-point source at mesh scale, and 2D potential flow radiates from it;
- broad band + visible anisotropy along the three lattice directions: γ = 1.5 gives p = 2γ/(γ−1) = 6, a comparatively diffuse steady state, and a discrete triangular lattice can only carry flux along its own edge directions.

If a more corridor-like result is wanted, γ is the knob (higher γ → lower p → stronger concentration). That is a scientific decision for a Gate, not a rendering change.

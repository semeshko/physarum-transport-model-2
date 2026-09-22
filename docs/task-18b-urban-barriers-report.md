# Task 18B — Continuum Design Urban Barriers

Continues from `7b4417a` (Gate H, `design-hucai-v2`). Harness and screenshots in `scratch/task-18b/` (untracked).

Buildings and polygonal water become impermeable regions for the continuum Design field. The scientific model is
untouched: same `design-hucai-v2`, same gamma, same `eps_r`, same dimensionless timestep, same convergence
semantics, same TPFA hydraulics, same triangular mesh, same distributed terminal supports. This is a spatial
boundary integration.

**Design v0 does not generate crossings through buildings or polygonal water.** No bridges, no tunnels, no
demolition, no land cost, no green penalty.

---

## 1. Validation status — read this before the results

| Path | Status |
|---|---|
| Barrier science (masking, conservation, A/B response) | **validated**, unit + browser |
| Imported-GeoJSON barrier ingestion | **browser-validated** end to end through the production Design pipeline |
| Direct Overpass → OSM barrier ingestion | **implemented, not live-validated** |

All three endpoints in `OVERPASS_ENDPOINTS` were unavailable from this environment: `overpass-api.de` returned
HTTP 406 even with an explicit User-Agent, `overpass.private.coffee` and `maps.mail.ru` timed out. The
`fetchOSMUrbanContext` → `overpassUrbanContextToGeoJSON` → `ingestGeoJSON` path is wired and the failure is
surfaced in the panel, but it could not be exercised against a live server here.

The Lviv figures below therefore use **hand-authored barrier footprints on real Lviv coordinates** — five
city-block polygons in the Halytskyi district, sized like real quarters (~90–130 m) with street-width gaps
(~20–30 m). They are **not real OSM buildings.** They enter the model through exactly the same downstream
pipeline any OSM polygon would: `ingestGeoJSON` → `createSpatialConstraintSet` → `designBarriersFromDataset` →
metric projection → mesh masking → `assembleDesignNetwork` → Hu–Cai. Only the network fetch is absent.

**Live OSM acquisition is an external integration QA item, not a scientific uncertainty in the barrier model.**
Proposed follow-up `18B.1 Live OSM smoke`, no new scientific Gate: small AOI → Load OSM barriers → counts > 0 →
render → mesh → Source/Sink → Run → `crossingEdgeCount = 0`.

## 2. The strict impermeability invariant

> For every active Design edge: `interior(segment) ∩ interior(barrier) = ∅`.

Midpoint-outside is not evidence — an edge can enter and leave a thin or oblique polygon with its midpoint, or
any finite sample set, outside it. The production predicate was audited rather than rewritten, because it was
already strict: `relateSegmentToPolygons` collects every intersection parameter with every ring, sorts them, and
for each resulting sub-interval tests whether the sub-interval's own midpoint lies inside the polygon (full
point-in-polygon with hole handling), summing the inside lengths. That is the exact interior measure. Any
entry/exit produces an inside sub-interval regardless of where the whole edge's midpoint falls.

`countBarrierCrossingEdges(mesh, network, barriers)` is the QA counter: it recomputes that exact measure over the
surviving edges and must return 0. It is kept out of `assembleDesignNetwork` so the cost is paid only when a
report or a test asks for the proof.

Proven with counterexamples that defeat sampling: a 12 m wall crossed by a 150 m edge, an oblique wall, an 8 m
sliver. One test explicitly demonstrates that the midpoint check would have passed a crossing the strict
predicate rejects.

**Boundary policy:** `boundary-touch` is not blocked. An edge running along a wall or clipping a single corner
point never enters the interior, and blocking it would erode the domain by a mesh cell along every facade.

## 3. Scale discipline

`designScaleFromNetwork` summed over `network.edges` — the edges that survive masking. Adding a building would
have shrunk the meshed area, moved `nu`, and silently recalibrated the model between A and B. Fixed:
`assembleDesignNetwork` now returns a `scale` built from the **AOI area**, and it is carried to the Worker
through the START message. Asserted: `L0`, `Q0`, `C0` and `nu` are identical with barriers off and on, and a
companion test shows the naive scale would have moved.

## 4. Canonical symmetric obstacle

AOI 4303 × 3113 m, separation 1600 m, building 500 × 600 m centred on the axis:

| spacing | effective | blocked | L0 | nu | R_off | R_on | R_on/R_off | upper | lower | \|u−l\| | Kirchhoff | JS | TV |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 200 | 199.7 | 35 | 3660.0 | 7.465e-8 | 6.30e-1 | 7.14e-1 | 1.134 | 0.5000 | 0.5000 | 0.0000 | 2.2e-11 | 0.631 | 0.578 |
| 150 | 149.8 | 71 | 3660.0 | 7.465e-8 | 6.47e-1 | 7.54e-1 | 1.166 | 0.5000 | 0.5000 | 0.0000 | 1.4e-11 | 0.689 | 0.639 |
| 120 | 119.8 | 85 | 3660.0 | 7.465e-8 | 6.45e-1 | 7.24e-1 | 1.124 | 0.5000 | 0.5000 | 0.0000 | 8.8e-12 | 0.630 | 0.564 |
| 90 | 89.9 | 142 | 3660.0 | 7.465e-8 | 6.32e-1 | 7.11e-1 | 1.125 | 0.5000 | 0.5000 | 0.0000 | 5.4e-12 | 0.629 | 0.558 |

The split is **exactly** 0.5000/0.5000, not "within anisotropy": Gate F's odd-row parity makes the mesh mirror
symmetric, so symmetric geometry splits exactly by construction. Net axial flux = 1.000000 at 25/50/75%.

**Asymmetric control** (building shifted to cover y ∈ [−700, 200]): upper 0.7843 / lower 0.2157 — the flow
favours the open side by 3.64×.

## 5. Lviv A/B — hand-authored footprints on real coordinates

AOI 524 × 523 m, mesh requested 60 m / effective 60.3 m, 99 nodes / 258 edges, 5 block polygons:

| | active/total | blocked | L0 | src/snk support | demand | R_eff | net flux | Kirchhoff | iters | CG | **crossing edges** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **OFF** | 258/258 | 0 | 523.1 | 10 / 7 | 1.000000 | 1.242 | 1.000000 | 1.4e-11 | 99 | 59 | **85** (control) |
| **ON** | 173/258 | 85 | 523.1 | 10 / 6 | 1.000000 | 1.937 | 1.000000 | 1.4e-11 | 166 | 57 | **0** |

JS 0.8023 · TV 0.8093 · effective resistance +56% · both converged with monotone energy.

The 85 edges that *would* pierce the blocks are exactly the 85 removed, and none remain. The sink support drops
7 → 6 because a block clips its disc: the blocked node is dropped and the demand renormalised over the rest,
with the balance still exactly 1.000000.

**Browser A/B** at AOI 0.81 × 0.52 km, effective spacing 59.8 m, 398 edges, 81 blocked by buildings: same AOI,
same mesh, same terminals, same scale, only the barrier policy toggled. Energy 1.296 → 1.596.

Screenshots (kept in `scratch/task-18b/`, not committed):
`lviv-1-barriers-mesh.png` · `lviv-2-terminals.png` · `lviv-3-field-barriers-off.png` ·
`lviv-4-field-barriers-on.png`. The block near Halytska ploshcha is identifiable as a case where the OFF field
crosses its footprint and the ON field is forced around it.

## 6. Terminal supports meeting barriers

A support disc overlapping a barrier keeps only its reachable nodes and the prescribed demand is redistributed
over them, so the total is conserved exactly. If nothing valid remains the run refuses with
`empty-terminal-support` rather than placing demand inside a building. Both asserted.

## 7. Narrow passages — a resolution limit, stated

Passage survival is **not** "gap versus spacing". A 300 m gap straddling the axis stayed open at a 449 m mesh
step, because Gate F's odd-row parity places a node row exactly on the axis — inside the gap. What decides it is
whether the lattice lands a row inside the passage. The same 120 m gap moved off-axis to y = 700 m closes at a
300 m step and opens at 60 m.

No sub-grid routing was invented. The Design panel states: *"A gap narrower than about one mesh spacing is
numerically unresolved and may close — that is a resolution limit, not a barrier."* Three tests pin the three
behaviours.

Related, from Gate H and still applicable: field-width figures are good to roughly ±15% at this discretisation,
so OFF/ON comparisons must use the same mesh. Every comparison here does.

## 8. Other boundary cases covered

MultiPolygon treated as one impermeable set (identical counts to the same polygons passed separately); a barrier
overhanging the AOI edge; a zero-height sliver leaving the usable edge count unchanged; water blocked exactly
like a building, with a river spanning the AOI correctly reported as `terminals-disconnected` rather than routed
around — Design v0 does not invent a bridge.

## 9. Performance

Barrier filtering uses a metric-plane bounding box per barrier before the exact segment/polygon test, so the
expensive predicate only runs on genuine candidates rather than every edge against every polygon. Lviv A/B at
258 edges and 5 polygons: 0.1 s OFF, 0.2 s ON. Browser run at 398 edges: converged in 92 (OFF) / 124 (ON)
iterations with CG at 69–77 per hydraulic solve.

## 10. Regressions

- **Pause/Resume**: diagnostics frozen while paused, advancing after resume.
- **Stale invalidation**: barriers are scientific input, so toggling them resets the runtime —
  `completed → toggle → idle → re-run → completed → toggle → idle`, verified both directions.
- **Analyze**: graph, transport profile and spatial-constraint summaries identical before and after Design work;
  the Physarum runtime is present and idle. `git diff 7b4417a -- src/physarum src/graph src/scenario
  src/transport-cost src/transport-profile src/osm src/gis` is empty.

Two false alarms in my own probes, both corrected: a status regex matched the word "error" inside "Local
projection **error** bound", and a pixel comparison of the Analyze map was invalid because the camera is shared
and had been moved. Neither was a product failure.

## 11. Files

**New:** `src/design/barrier-source.ts`, `src/design/barrier-source.test.ts`, `src/design/barriers.test.ts`,
this report.
**Changed:** `src/design/network.ts` (AOI scale returned, bbox pre-filter, `countBarrierCrossingEdges`),
`src/design/scale.ts` (`designScaleFromArea`, `designV2Parameters`), `src/design/worker-protocol.ts` and
`src/design/worker-machine.ts` and `src/hooks/useDesignRuntime.ts` (scale carried to the Worker),
`src/design/map-registry.ts` (barrier layers), `src/design/field-metrics.ts` (`crossSectionSideShares`, and a cap
on the Voronoi spreading so flux is not smeared into a blocked span), `src/design/report.ts` (barrier QA
metadata, `design-barriers-v0-impermeable`), `src/components/MapWorkspace.tsx` (barrier controls, OSM load,
offline imported-dataset path), `src/design/report.test.ts` (layer expectations).

**Unchanged:** `design-hucai-v2` and every one of its parameters, TPFA hydraulics, mesh geometry, terminal
support semantics, the pressure solver, and all Analyze code.

## 12. Tests / lint / build

`npx tsc --noEmit` clean · **435 tests pass** (403 baseline + 32) · `npm run lint` **0 errors**
(8 warnings, all in untracked `scratch/`) · `npm run build` clean.

# Codex audit of the Claude handoff after Task 16

Audit baseline: `163033a1ce7b84d372f9a67bc21df333d7e442b0`

Remote baseline at handoff: `c469b5846beeebaf02a0e17cb71dd608cdc82dbc`

Preserved local 18C/18C.1 checkpoint: `1d2d41343095ac943d0ef264d78bf7d704a3b2a7`

Review branch: `codex/claude-handoff-audit`

This audit was performed locally. No browser or browser-control tool was used.

## 1. Recovered state

The six remote commits after Task 16 are present in order:

1. `3730a66` — Physarum scientific regimes
2. `3cfc120` — continuum Design core
3. `9462e1d` — Design visual MVP
4. `e3a835d` — Design field metrics
5. `7b4417a` — Design v2 scaling
6. `c469b58` — urban barriers

The local repository additionally contained ten modified/new source files for
18C/18C.1. They were preserved unchanged in checkpoint `1d2d413` before audit
fixes were made. The research reports and ignored `scratch/task-18c` evidence
are present. No concurrent Claude/Codex writer or Git lock was found; only an
old Next development server was running.

## 2. Confirmed findings

### Task 17

- Demand normalization is implemented as an optional threshold
  `K_eff = demandScaleKappa * Q_ref`, where `Q_ref` is total positive source
  demand.
- Its scale-invariance and multi-terminal conservation tests are substantive.
- It does **not** change current Analyze behaviour: `demandScaleKappa` remains
  absent from `DEFAULT_PHYSARUM_PARAMETERS` and the UI/Worker starts Analyze
  with the legacy defaults. Task 17 is therefore a researched optional regime,
  not a product-mode migration.

### Continuum Design

- Design has a separate triangular candidate mesh, TPFA-style conductance,
  Hu–Cai adaptation, scale model, Worker protocol and map layers.
- Design does not call the Analyze Hill adaptation.
- Barrier intersection is based on exact segment/polygon relations rather than
  midpoint sampling. Buildings and polygonal water are hard barriers.
- The test suite contains meaningful invariance, refinement, conservation,
  barrier and Worker comparisons, although the full suite is expensive.

### Live OSM and Analyze

- The production Overpass adapter preserves ordered OSM node IDs as
  authoritative topology anchors.
- `ingestGeoJSON`, AOI clipping and `buildTransportGraph` preserve these
  anchors. Crossing OSM ways are connected only when they share an OSM node.
- A local server-only probe of `/api/osm` for a small Lviv AOI returned 62
  ways from Overpass with HTTP 200.
- The complete local pipeline produced 0 missing topology anchors, a graph of
  133 nodes / 141 edges, and no geometry-based intersection tests.
- On that live graph, pedestrian Analyze converged in 82 iterations and motor
  Analyze in 56, with Kirchhoff residuals approximately `4.2e-11` and
  `1.2e-10` respectively.

## 3. Confirmed defects and fixes

### A. Gate H minimum-time convergence guard was documented but absent

`docs/task-18-gate-h-report.md` requires both a small conductivity update and
minimum dimensionless elapsed time before convergence. Production
`advanceDesignField` checked only the update. The associated test was titled
“rejects a converged verdict” but never asserted the verdict.

Fix:

- add dimensional `minimumSimulationTime` to Design adaptation parameters;
- derive it from `minimumElapsed` and the explicit Design scale;
- require elapsed time as well as `maxDelta` for convergence;
- assert that a tiny-step run terminates at `maxIterations`, not `converged`.

The Hu–Cai equation, `DESIGN_V2` dimensionless values and field defaults were
not changed.

### B. OSM cancellation stopped in the browser client

The client AbortController cancelled its fetch to `/api/osm`, but the route did
not pass `request.signal` to `requestOverpass`. An abandoned request could
therefore continue consuming a volunteer Overpass slot. A signal already
aborted before invocation also still started a request.

Fix:

- propagate `request.signal` through the route and server client;
- fail before provider/cache work for an already-aborted request;
- destroy the active Node request on abort and remove its listener on close;
- add client and server regression tests.

### C. Two OSM boundary tests were false positives

The tests searched entire source files for words such as `server-client` and
`overpass`. Comments and the legitimate adapter name
`overpassResponseToGeoJSON` made them fail even though no server transport was
imported into the client bundle.

Fix: assert forbidden import/module boundaries rather than arbitrary text.

## 4. Claims not established by the available evidence

### The Task 18C screenshots do not prove OSM topology fidelity

`scratch/task-18c/osm-to-geojson.ts` resolved OSM API node references to
coordinates but omitted `lineTopology`. Consequently its generated
`lviv-slice.geojson` entered the geometry-only graph path and could create
geometric intersections. Those screenshots are useful visual QA, not evidence
that the anchor-aware OSM pipeline worked.

The live production path has now been checked independently and does preserve
anchors; the historical evidence should not be cited for that property.

### Scientific GO labels are bounded experimental conclusions

- Gate G/H metrics support the tested synthetic domains and resolutions; they
  do not validate urban forecasting or planning conclusions.
- A stable median or one symmetric obstacle does not prove general mesh
  invariance.
- Conductivity and flux are model fields, not observed trips, required road
  width, resilience or a forecast of city growth.
- The selected Hu–Cai law is an engineering/research choice and is not shown to
  reproduce the diploma's Mukachevo experiment.

### Visual MVP evidence

Build and Worker logic are verified locally, but this audit did not repeat
browser visual acceptance because browser use was explicitly excluded.

## 5. Product-goal gap

The post-Task-16 work adds strong numerical infrastructure but does not yet
implement the central authored urban workflow:

- semantic central/local/function markers;
- the authored radial/hexagonal pattern as an editable urban-planning layer;
- many-centre network formation with marker importance;
- scenario comparison and feedback from a result to marker placement.

Current Analyze still uses one manually selected source and one sink in the UI.
Current Design uses one source and one sink and must remain frozen as requested.

## 6. Current OSM/Analyze boundary

- Live acquisition currently queries highway ways and separately queries
  building/water/green context.
- Railway is classifiable and renderable when imported from a file, but the
  live query and Analyze graph intentionally do not model rail connectivity.
- One-way tags are preserved but not enforced; Analyze remains undirected.
- OSM relation multipolygons are not reconstructed.
- The public `/api/osm` route has area/response limits and a small cache, but
  no per-client deployment rate limiter.

These are visible limitations, not reasons to retune Physarum or transport
costs.

## 7. Verification record

Before fixes:

- build: passed;
- lint: passed with 12 warnings, all in research scratch plus one test stub;
- tests: 461 passed, 2 failed (the false-positive boundary assertions);
- full suite duration: approximately 259 seconds; Design barrier/scale tests
  dominate runtime.

Focused verification after fixes:

- OSM client/server/adapter/topology/real-urban: 62/62 passed;
- Design adaptation/Worker: 23/23 passed;
- Gate H scale-aware convergence group: passed;
- TypeScript `--noEmit`: passed;
- focused changed-file ESLint: passed.

Final verification after fixes:

- full suite: 35 files, 466/466 tests passed in approximately 252 seconds;
- lint: 0 errors and 9 warnings, all confined to ignored research scratch;
- production build: passed, including the dynamic `/api/osm` route;
- TypeScript: passed as part of the production build.

## 8. Manual acceptance steps

These steps are for the owner to perform later; they were not executed by this
browser-free audit.

1. Start the app and open `http://localhost:3000`.
2. Confirm Analyze starts with “No data loaded”, not synthetic streets.
3. Zoom to a small district (roughly 1–2 km²), select the current view and load
   the OSM network.
4. Confirm the import summary reports zero missing topology anchors.
5. Inspect graph diagnostics: anchored nodes should be present and geometric
   intersection tests should remain zero for the authoritative OSM dataset.
6. Select two nodes in the same component, run Pedestrian Analyze, and record
   convergence, Kirchhoff residual and visible path.
7. Switch to Motor; terminals reset by design. Select a connected pair and run
   again. The usable graph should materially differ from Pedestrian.
8. Cancel an OSM load or immediately select a different area; the stale request
   must not overwrite the newer selection.
9. Do not accept railway, one-way routing, relation polygons, authored pattern
   semantics or Design-mode urban conclusions as implemented.

## 9. Recommendation

Accept the OSM server path and convergence/cancellation fixes after the final
regression passes. Keep the review branch separate from `main` until manual
acceptance.

Continue with a small real Analyze slice and explicit data/graph diagnostics.
Do not start Prediction, new Design mathematics, automatic parameter fitting or
new multimodal semantics in this review.

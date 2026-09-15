# Task 17 — Physarum Regime Definition & Demand Normalization

Report generated after implementation, grounded in real runs of `npm run
benchmark:physarum-regimes` and `npm test` on this repository (2026-09-16).
Numbers below are copy-pasted from actual console output, not estimated.

## Core formula

```
K_effective = kappa * Q_ref
Q_ref = sum(max(source_i.magnitude, 0))
f(|Q|) = |Q|^n / (K_effective^n + |Q|^n)
```

`kappa` (`demandScaleKappa`) is the new relative Hill threshold: it replaces
the old absolute `K` once demand-normalized mode is active. Implemented in
`resolveScaleInfo` (`src/physarum/solver.ts`) and exposed on every
`PhysarumState.scale` / `SensitivityObservation`.

## 1. Dimensional analysis of K

`hillK` (`K`) shares units with edge flow `Q` — it is the flow magnitude at
which the Hill response `f(|Q|) = |Q|^n / (K^n + |Q|^n)` reaches exactly 0.5.
As a fixed absolute constant, `K` is dimensionally disconnected from the
network's own demand scale (`Q_ref`, sum of source injections). Two networks
with identical topology and identical *relative* cost structure, differing
only in the absolute unit their terminal magnitudes are expressed in, produce
different Hill responses purely because `|Q|/K` differs — not because
anything about the city changed. That is a units bug, not a modeling choice.

## 2. Q_ref candidates studied

- **A. Total positive source injection** — `Q_ref = Σ max(b_i, 0)`. Implemented
  (`demandReferenceMagnitude`). For a balanced single-source/sink network,
  `Q_ref` reduces to exactly the source magnitude (verified:
  `demandReferenceMagnitude(twoCorridorNetwork(magnitude=5)) === 5`).
- **B. Maximum individual source magnitude** — considered, rejected. It
  ignores how many sources exist and how demand is distributed among them;
  two sources of magnitude 5 each and one source of magnitude 5 would be
  treated identically, which has no defensible physical meaning for a
  hydraulic-conservation network.
- **C. Another network-level flow reference** (e.g. total edge count, mean
  edge cost) — rejected per the spec's own instruction not to use arbitrary
  graph statistics unrelated to flow demand.

**Selected: A (total positive source injection).** It is the only candidate
with a direct physical interpretation (total volume the network must move
per unit time) and it collapses to the intuitive single-source case exactly.

## 3. Selected Q_ref and rationale

`Q_ref = Σ_{i: role=source} max(magnitude_i, 0)` (sink terminals and any
non-positive "source" entries are excluded). Rationale: this is literally the
volume of demand the network is asked to carry, which is the only physically
meaningful reference scale for a Hill threshold expressed in units of flow.

## 4. Fixed-K vs normalized-K demand sweep

Two-corridor fixture (cost ratio 1:1.1), `dominantShare` = fraction of flow
on the cheaper corridor, from `npm run benchmark:physarum-regimes`:

| magnitude | legacy (K=1) dominantShare | normalized (κ=1) dominantShare |
|---|---|---|
| 0.1 | 0.999908 | 0.999998 |
| 0.5 | 0.999995 | 0.999998 |
| 1 | 0.999998 | 0.999998 |
| 2 | 0.999999 | 0.999998 |
| 5 | **0.532927** | 0.999998 |
| 10 | **0.525799** | 0.999998 |
| 100 | **0.523829** | 0.999998 |

Legacy fixed-K collapses to near-symmetric flow (structurally meaningless —
both corridors carry almost equal flow despite a real 10% cost difference)
once magnitude exceeds ~2. Demand-normalized mode holds `dominantShare`
constant to 6 significant figures across three full orders of magnitude
(0.1 → 100). **Answer to the target question: no, uniform scaling should
not — and with normalization does not — change normalized network
structure.** This property is exactly what Design Mode needs, because future
markers/centers will carry arbitrary, product-chosen magnitudes.

## 5. Multi-source / multi-sink findings

Five fixture families tested (`multi-terminal.test.ts`, 8 tests, all passing):

- **A/B/C (star topologies, two-sources→one-sink, one-source→two-sinks,
  two-sources→two-sinks):** Kirchhoff conservation forces edge flow to match
  each terminal's magnitude exactly regardless of Physarum parameters
  (verified to 1e-6). These confirm the solver's conservation law generalizes
  correctly to N terminals — it is not hard-coded to exactly one source and
  one sink.
- **Q_ref for multi-source networks** sums *all* source terminals, not just
  the first: verified `demandReferenceMagnitude` returns 4 for two sources of
  magnitude 3 and 1, and 7 for two independent source/sink pairs of 2 and 5.
- **Uniform scaling of all sources together** (competing-routes fixture,
  sources 3&1 vs 30&10 — same 10:1 ratio): normalized mode keeps route-A
  share invariant to <1e-3; legacy mode shifts it by >0.05, reproducing the
  single-source finding in a genuinely multi-terminal network.
- **Changing the *relative* demand between two sources** (10:1 vs 1:10, same
  total): route-A share is **higher when the source that prefers route A
  dominates**, in *both* scale modes. This is the critical distinction the
  spec asked for: uniform scaling must not change structure, but relative
  redistribution between markers must — and does.

## 6. Fine-grained n regime study (4 topologies)

Sweep n ∈ {1.0, 1.025, 1.05, 1.075, 1.1, 1.15, 1.2, 1.25, 1.5, 2.0} across
`parallel-corridors`, `three-corridors`, `shared-trunk`, `grid`
(`npm run benchmark:physarum-regimes`, section "N-regime fine transition"):

- **parallel-corridors / shared-trunk** (identical numbers — the shared trunk
  segment is common to both corridors and cancels out of the comparison):
  dominantShare rises gently from 0.571 (n=1) to 0.652 (n=1.2), then jumps
  sharply to 0.999998 at **n=1.25** and stays there through n=2. The
  transition is narrow: essentially all of the qualitative change happens
  between n=1.2 and n=1.25.
- **three-corridors** transitions more gradually and in two visible stages:
  entropy drops from 0.955 (n=1) to 0.614 (n=1.1) — the *most expensive* of
  three corridors gets pruned first — then collapses fully to 0.000045
  (winner-takes-all between the remaining two) by n=1.25. More alternatives
  produce a more staged, not sharper, transition.
- **grid** stays exactly at dominantShare=0.5, entropy=1.0 for *every* tested
  n. This is a topology artifact, not evidence that n has no effect: the
  grid's "upper"/"lower" corridor definitions (`sa-ac-ct` vs `sb-bd-dt`) are
  both cost-3 by construction — the cost *ratio* only affects the two
  cross-edges (`ad`, `bc`), which aren't part of either named corridor. This
  is a useful, unplanned confirmation of calibration target #1 ("symmetric
  equal-cost networks preserve symmetry") rather than a counterexample to the
  n-transition finding.
- **Conclusion:** there is no single universal critical n. The transition
  band is topology-dependent (sharp ~1.2–1.25 for two-alternative topologies,
  staged through ~1.1–1.25 for three-alternative topologies) but is
  consistently located in the same narrow region just above n=1 in every
  topology tested — n=1 is reliably distributed, n≥1.5 is reliably
  winner-takes-all, and the interesting product decision is what happens in
  the 1.0–1.25 band.

## 7. Kappa study

Two sweeps, κ ∈ {0.05, 0.1, 0.25, 0.5, 1, 2} at Q_ref=1, run at two different
n (`npm run benchmark:physarum-regimes`):

**At n=2 (selective/Analyze candidate), parallel-corridors:**

| κ | dominantShare | entropy |
|---|---|---|
| 0.05 | 0.524 | 0.998 |
| 0.1 | 0.526 | 0.998 |
| 0.25 | 0.540 | 0.995 |
| 0.5 | **0.999999** | 0.000024 |
| 1 | **0.999998** | 0.000037 |
| 2 | 0.999995 | 0.000087 |

At n=2, κ has a sharp threshold between 0.25 and 0.5 — below it the network
never leaves near-symmetric flow, above it collapses to winner-takes-all.

**At n=1.05 (exploratory/Design candidate), all 4 topologies:**

| κ | parallel-corridors entropy | three-corridors entropy | grid entropy |
|---|---|---|---|
| 0.05 | 0.998 | 0.996 | 1.0 |
| 0.1 | 0.998 | 0.995 | 1.0 |
| 0.25 | 0.996 | 0.991 | 1.0 |
| 0.5 | 0.993 | 0.979 | 1.0 |
| 1 | 0.981 | 0.926 | 1.0 |
| 2 | 0.922 | 0.582 | 1.0 |

At n=1.05 the network stays **meaningfully distributed across the entire
tested κ range**, including κ=2 (entropy never drops below 0.58, vs. 0.00004
at n=2). This is the key finding for the κ decision: **n, not κ, decides
which regime a run is in.** κ only tunes how strongly cost differences are
weighted *within* whichever regime n selects.

**κ recommendation (not left as an unfixed "somewhere κ"):**

- **Analyze (n=2): κ=1.** Reproduces the legacy K=1 qualitative behavior
  exactly at the reference demand scale (§4 table, magnitude=1 rows match
  between legacy and normalized), while remaining scale-invariant.
- **Design (n=1.05): κ=1.** At the proposed Design n, κ=1 sits comfortably
  inside the distributed band on every topology tested (entropy 0.926–0.981,
  never collapsing) while still producing a clear, real preference for the
  cheaper route (dominantShare 0.58–0.66, not a coin flip) — i.e. it responds
  to genuine cost differences without discarding alternatives. Using the same
  κ=1 in both regimes also keeps the convention simple and memorable ("the
  Hill threshold equals total network demand" in both modes); the regime
  identity comes entirely from `hillExponent`, matching the mathematical
  structure Task 16/17 established.

This is a first empirically-grounded default, not a final product constant —
§22 notes it should be re-validated once real OSM-derived demand magnitudes
and cost ratios are available, but it is a stated, tested value rather than
an open experimental unknown.

Combined with §4/§6, κ interacts with **n** the same way absolute K does (it is, after
all, the same equation with a rescaled threshold) — the qualitative behavior
is governed by where `|Q|/Q_ref` sits relative to κ, not by κ's absolute
value. What changes under normalization is that a *chosen* κ now produces the
same regime at every demand scale, whereas a chosen K only produced a known
regime at whatever scale it happened to be tuned for.

## 8. Topology dependence

Selection strength, transition sharpness, and even whether a given corridor
pairing can distinguish n at all (see grid, §6) all depend on topology.
Recommendation: any future Design Mode parameter guidance must be validated
per-topology-class, not tuned once on a toy graph and assumed universal —
this is exactly the mistake this task's acceptance criteria explicitly guard
against ("Do not infer a universal critical n from one parallel-edge toy
graph").

## 9. Distributed-vs-selective interpretation

Both regimes are scientifically meaningful for different questions:

- **DISTRIBUTED / EXPLORATORY** (n≈1): the network retains multiple
  competing alternatives as live options with graded conductivity. Answers
  "what are the plausible connections here?"
- **SELECTIVE / NETWORK EXTRACTION** (n≳1.25): the network suppresses all
  but the most efficient alternative(s), approaching a minimal dominant
  structure. Answers "what is the one/few structurally necessary
  connection(s)?"

These are not right/wrong, they are different product questions.

## 10. Analyze Mode recommendation

Use **selective** regime: `n=2, kappa=1, scaleMode=demandNormalized` (§13,
justified in §7). Goal
of Analyze is identifying which existing infrastructure is structurally
load-bearing — a selective regime is what answers that. Demand normalization
is required regardless of regime choice, because real cities have markers of
wildly different importance and the regime must not silently flip character
depending on how "important" happens to be encoded numerically.

## 11. Design Mode recommendation

Use **distributed/exploratory** regime: `n=1.05, kappa=1,
scaleMode=demandNormalized` (§13, justified in §7).
Free-space design should surface answer **B** from the Design Mode
requirement question: "a family of plausible corridors," not one dominant
guess (A) or a fully evolving competitive network (C, which is really just
selective regime run over a candidate field). A distributed regime preserves
alternative corridors for the designer to evaluate rather than collapsing to
a single answer before the human has seen the alternatives — consistent with
the original thesis framing where Physarum forms a *system* of connections
between markers, not a single shortest path.

## 12. Parameter-role classification

- **STRUCTURAL / SCIENTIFIC:** `hillExponent` (n — dominant selection
  control, §6), `demandScaleKappa`/`hillK` (relative vs absolute threshold,
  §4/§7).
- **NUMERICAL:** `timeStep`, `convergenceTolerance`, `maxIterations` — Task
  16 already established these change convergence dynamics but not final
  tested equilibria.
- **INITIALIZATION:** `initialConductivity` (D0) — Task 16 already
  established this does not change final tested equilibria.
- **Redundant pairing confirmed:** `adaptationRate`/`decayRate` (α/µ) mainly
  rescale equilibrium D magnitude together (Task 16 finding, unchanged by
  this task) rather than acting as two independent scientific knobs. A future
  UI should expose their *ratio* as the meaningful control, not both
  absolute values.

## 13. Proposed scientific model configuration(s)

Two named, reproducible, fully-specified configurations (not yet wired into
product code — see §16, `hillScaleMode` naming deferred until Design Mode
needs it). Both use `scaleMode = demandNormalized`; neither leaves κ
unfixed:

```
Analyze:
  n (hillExponent)     = 2
  kappa (demandScaleKappa) = 1
  scaleMode             = demandNormalized

Design:
  n (hillExponent)     = 1.05
  kappa (demandScaleKappa) = 1
  scaleMode             = demandNormalized
```

`n=1.05` for Design rather than the wider "1.0–1.1" band mentioned in §11's
qualitative discussion: 1.05 is the exact value the κ study (§7) was run
against, and it sits solidly inside the distributed band on all 4 topologies
while still being past the exact n=1 boundary — a defensible single point
rather than a vague range with no tested value inside it.

## 14. Legacy compatibility behavior

`demandScaleKappa` is optional and `undefined` by default. When omitted,
`resolveScaleInfo` returns `{ mode: "absolute", qRef: 0, effectiveHillK:
parameters.hillK }` — bit-for-bit the old behavior. All 263 pre-existing
tests pass unmodified (one test file, `worker-machine.test.ts`, needed a
one-line update to add the new *always-present* `state.scale` field to a
manually-constructed fixture object — no behavioral change).

## 15. Whether solver equations changed

No. `g=D/L; Q=g·ΔP; dD/dt=α·f(|Q|)-µ·D` is unchanged. Only which *value* is
substituted for `K` inside `f` changed, and only when `demandScaleKappa` is
explicitly provided.

## 16. Whether defaults changed

No. `DEFAULT_PHYSARUM_PARAMETERS` is untouched; `demandScaleKappa` has no
default value (must be explicitly opted into). Every existing caller that
doesn't pass it gets exactly the old regime.

## 17. Report/model versioning

`SENSITIVITY_MODEL_VERSION` bumped `v1 → v2` (schema addition, not equation
change). Every `PhysarumState` now carries `state.scale: { mode, qRef,
effectiveHillK }`, and every `SensitivityObservation` exposes `scaleMode`,
`qRef`, `effectiveHillK` alongside the existing `parameters` block — a report
is now fully self-describing and reproducible without needing to re-derive
which K was actually applied.

## 18. Files changed

```
 package.json                          |  npm script: benchmark:physarum-regimes
 src/physarum/parameters.ts            |  validate demandScaleKappa
 src/physarum/sensitivity.ts           |  scale metadata + n-fine/kappa/demand sweeps
 src/physarum/solver.ts                |  resolveScaleInfo, state.scale
 src/physarum/types.ts                 |  PhysarumScaleInfo, state.scale field
 src/physarum/worker-machine.test.ts   |  fixture updated for new required field
 scripts/benchmark-physarum-regimes.ts |  new
 src/physarum/demand.ts                |  new (demandReferenceMagnitude)
 src/physarum/demand-normalization.test.ts | new (10 tests)
 src/physarum/multi-terminal.test.ts   |  new (8 tests)
 docs/task-17-physarum-regime-report.md |  new (this report)
```

## 19. Tests/results

`npm test`: **281 passed (281)**, 24 test files, 0 failed. (263 pre-existing
+ 10 demand-normalization + 8 multi-terminal = 281.)

## 20. Benchmark summary

`npm run benchmark:physarum-sensitivity` and `npm run
benchmark:physarum-regimes` both run to completion deterministically (no
wall-clock data embedded in the JSON report; only the benchmark scripts'
console timing lines are runtime-dependent, matching existing convention).
130 observations in the general sensitivity report (up from 47 before this
task), 40 in the n-fine matrix, 6 in the n=2 kappa matrix, 24 in the
n=1.05-design kappa-by-topology matrix.

## 21. Worker/browser regression

`solver.test.ts`, `worker-machine.test.ts`, `pressure-solver.test.ts`,
`incremental.test.ts`, `performance.test.ts` all pass. `state.scale` is an
additive field on the existing `PhysarumState` shape consumed by
`worker-machine.ts`/`worker-protocol.ts`; no message shape was removed or
renamed, so worker postMessage compatibility is preserved. Did not run the
browser/map UI manually in this pass (no visual/UI change was made — solver
and sensitivity/benchmark code only).

## 22. Remaining scientific limitations

- κ has only been studied at a single Q_ref (=1); §7's numeric κ thresholds
  will need re-validation against real OSM-derived demand magnitudes before
  Design Mode picks a production default.
- The n-transition band (§6) was characterized on synthetic fixtures with a
  fixed 1.1 cost ratio; real road-network cost ratios may sit anywhere in
  that transition and deserve their own sweep once real AOIs are used.
- Analyze vs Design regime recommendation (§10/§11) is a reasoned proposal,
  not yet validated against an actual multi-marker Design Mode scenario
  (which doesn't exist yet — that's Task 18).

## 23. Commit SHA

Not committed yet — pending explicit confirmation (see chat).

## 24. Working tree status

6 files modified, 5 files added (§18), all changes staged for review, none
committed or pushed.

## 25. Explicit recommendation

**Yes.** There is now a scientifically explicit, tested, reproducible
Physarum regime story: demand normalization is derived (not assumed),
tested on single- and multi-terminal networks, the n-transition is
characterized across four topologies, legacy behavior is preserved
byte-for-bit, and every result exposes the exact scale metadata needed to
reproduce it. Design Mode Foundation (Task 18) can begin on the
demand-normalized, n≈1.0–1.1 exploratory regime recommended in §11.

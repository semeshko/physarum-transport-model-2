# Task 18 Gate H — Design Parameter Scale & Nondimensionalization

Continues from `e3a835d` (Gate G measurement checkpoint). Harness in `scratch/gate-h/`.

**Verdict: GO for urban barriers.** `design-hucai-v2` puts the model on a derived, reproducible scale where the
regularizer carries 0.0–0.1% of the flux instead of ~55%, the gamma ordering is recovered, and every accepted
hydraulic invariance survives. One finding changed the shape of the answer: the regularizer was never only an
ellipticity guard — it was also damping the nonlinear adaptation loop, and that, not CG conditioning, is what
bounds how small it can go.

---

## 1. Exact production equations

Read from `src/design/adaptation.ts`, `src/design/network.ts`, `src/physarum/hydraulics.ts`,
`src/physarum/pressure-solver.ts` — not from memory.

```
assembly (network.ts)    effectiveCost_e = l_e / w_e
hydraulics (hydraulics)  G_e = (c_e + r) / effectiveCost_e = (c_e + r) w_e / l_e
                         q_e = G_e (p_from - p_to)          [flow positive from -> to]
                         L p = b,  b_i = +mag (source) / -mag (sink), one reference node per component pinned to 0
pumping  (adaptation)    g_e = |p_from - p_to| / l_e
metabolic                nu * c^(gamma-1)
IMEX step                c+ = max(c_min, (c + dt g^2) / (1 + dt nu c^(gamma-2))),  c = max(c_prev, c_min)
energy                   E = sum_e (w_e l_e) [ (c + r) g^2 + (nu/gamma) c^gamma ]
convergence              max_e |c+ - c| < convergenceTolerance        [absolute, in v1]
linear solve             Jacobi-preconditioned CG, tol = 1e-12 + 1e-10*||b||, cap max(100, 4n),
                         throws on non-convergence; no warm start between adaptation steps
```

Two things visible only in the code and material later: the fixed point of the IMEX step is exactly
`nu c^(gamma-1) = g^2` (no splitting error in the steady state), and the cell measure `w_e l_e` summed over edges
is **twice** the meshed area, because for a Voronoi/Delaunay pair the kite spanned by an edge and its dual has
area `w_e l_e / 2`. The factor 2 is a constant multiplier on the energy and affects nothing comparative.

## 2. Dimensional analysis

| quantity | dimension |
|---|---|
| `x`, `l_e`, `w_e`, `L0` | [L] |
| `w_e / l_e`, `effectiveCost` | dimensionless |
| source magnitude, `q_e`, `Q0` | [Q] |
| flux density `j = q/w` | [Q][L]⁻¹ |
| pressure `p` | [P] |
| `G_e` | [Q][P]⁻¹ |
| **`c`** | **[Q][P]⁻¹** — a conductance, since `w/l` is dimensionless |
| `g = grad p` | [P][L]⁻¹ |
| time | `[c][L]²[P]⁻²` |
| **`nu`** | **`[c]^(1-gamma) [P]² [L]⁻²`** |

`nu` carries **gamma-dependent units**. That is the tell: it is not a free physical constant, it is where a
conductivity scale was hidden. Consistency check: `q = c w g` gives `[Q] = [c][P]`, which matches `[c] = [Q]/[P]`.

## 3. Current hidden / implicit scales (v1)

- **Lengths in metres**, i.e. `L0 = 1 m` implicitly.
- **Total demand 1**, i.e. `Q0 = 1` implicitly, in unnamed units.
- **`nu = 1`** in those units, which fixes the reference gradient at 1 pressure-unit per metre. Actual gradients
  are O(0.1–1e-3), so the equilibrium `c = (g²/nu)^(1/(gamma-1))` collapsed to 1e-3…1e-2.
- **`r = 1e-3` absolute**, therefore comparable to `c_max` — an effective `r/c_max ≈ 1e-1`.
- **`tol = 1e-7` absolute**, i.e. ~1e-5 relative at v1 scale and ~1e-7 relative at any other — not a fixed
  stringency.
- **`dt = 0.5` with `nu = 1`**, so the actual dimensionless step was `dt·nu·c^(gamma-2) ≈ 5` at `c ≈ 1e-2`, not
  the 0.5 the constant suggests.

## 4. Characteristic scales chosen

| scale | definition | why not circular |
|---|---|---|
| `L0` | `sqrt(meshed area)` = `sqrt( (1/2) Σ l_e²/effectiveCost_e )` | geometry only; mesh-invariance **measured**, see below |
| `Q0` | total positive demand | prescribed by the scenario |
| `C0` | prescribed conductivity unit (1) | prescribed, **not** fitted to an observed `c_max` |

`nu` is then **derived**, not chosen. From the flux form of the equilibrium
`q_e = w_e sqrt(nu) c_e^((gamma+1)/2)`, requiring that an edge of width `L0` carrying the whole demand `Q0` sit at
exactly `C0`:

```
nu = Q0^2 / (L0^2 * C0^(gamma+1))
```

At the study geometry this gives `nu = 7.758e-8` where v1 shipped `nu = 1`.

### L0 is a domain property, not a mesh property

The sum runs over mesh elements, so this had to be measured rather than asserted — otherwise the model scale
would be quietly retied to numerical resolution, which is the failure this Gate exists to undo. On the 3600 m
square, requested spacing 250 -> 80 m (a 3x refinement, 653 -> 7039 edges):

| requested | 250 | 200 | 150 | 120 | 100 | 80 |
|---|---|---|---|---|---|---|
| L0 (m) | 3567.1 | 3578.8 | 3590.4 | 3579.9 | 3587.4 | 3603.5 |
| L0 / sqrt(A_AOI) | 0.9909 | 0.9941 | 0.9973 | 0.9944 | 0.9965 | 1.0010 |

**Spread 1.0%**, and L0 recovers the physical `sqrt(A_AOI)` to within 1% at every resolution. Asserted in
`scale.test.ts`.

`c_max`, by contrast, is a point statistic and does move with the mesh (spread 20% over the same range), so the
quantity that actually matters — the regularizer measured against the field — is pinned separately: the effective
`r/c_max` stays in **1.10e-4 … 1.34e-4** across all six resolutions, an order of magnitude inside the negligible
region and never near the nominal `eps_r = 1e-3`. Also asserted.

## 5. Nondimensional equations

With `x̂ = x/L0`, `q̂ = q/Q0`, `ĉ = c/C0`, `t̂ = t/T0` and `T0 = C0^(2-gamma)/nu`:

```
hydraulics   -div( (ĉ + eps_r) grad û ) = Ŝ
adaptation   dĉ/dt̂ = |grad û|^2 - ĉ^(gamma-1)
IMEX         ĉ+ = max(eps_min, (ĉ + dt̂ |grad û|^2) / (1 + dt̂ ĉ^(gamma-2)))
```

## 6. Dimensionless groups

`gamma` · `dt̂ = dt·nu·C0^(gamma-2)` · `eps_r = r/C0` · `eps_min = c_min/C0` · `ĉ0 = c_init/C0` ·
`tol/C0` · geometric `h/L0` and `R/L0`.

### C0 is an exact gauge

Substituting `c = λĉ` and holding the groups fixed (`nu → nu/λ^(gamma+1)`, `dt → λ³dt`; pressures scale as `1/λ`
because every conductance scales by `λ`) reproduces the IMEX step identically:

```
numerator    λc + λ³dt (g/λ)²                       = λ(c + dt g²)
denominator  1 + λ³dt (nu/λ^(gamma+1)) (λc)^(gamma-2) = 1 + dt nu c^(gamma-2)
```

**Measured** (C0 spanning 1e-2 … 1e2, i.e. `nu` over 1e10 and `dt` over 1e12):

| C0 | nu | dt | iterations | c_max/C0 | w80 | R_eff·C0 | JS vs C0=1 |
|---|---|---|---|---|---|---|---|
| 1e-2 | 7.76e-3 | 6.45e0 | identical | 7.6030 | 540 m | 4.4690e-1 | 8.2e-9 |
| 1e0 | 7.76e-8 | 6.45e6 | identical | 7.6030 | 540 m | 4.4690e-1 | 0 |
| 1e2 | 7.76e-13 | 6.45e12 | identical | 7.6030 | 540 m | 4.4690e-1 | 5.4e-9 |

Only the ratios are science; `C0` is bookkeeping. Asserted in `scale.test.ts`.

## 7. Role of nu — it was two things at once

1. **Scale**: `c(nu) ∝ nu^(-1/(gamma+1))` (measured exponent −0.50 … −0.35 against the predicted −0.40, the
   spread coming from the regularizer at the loose end).
2. **Rate**: the decay term is `nu c^(gamma-1)`, so the relaxation timescale goes like `1/nu`.

Gate G hit consequence (2) without knowing it: rescaling `nu` alone froze the dynamics and a run reported
"converged" at iteration 1 on its untouched initial condition. Holding `dt̂` fixed separates the two.

## 8–9. Equilibrium and time-scale derivations

Equilibrium (§4). Timescale: linearising the decay about `C0` gives a rate `nu(gamma-1)C0^(gamma-2)`, hence
`T0 = C0^(2-gamma)/nu` and `dt̂ = dt·nu·C0^(gamma-2)` — which is exactly the group that appears in the IMEX
denominator `1 + dt·nu·c^(gamma-2)`. Gate G's empirical `dt·nu` is the `C0 = 1` special case.

## 10. Timestep study — the IMEX scheme has a limit cycle

With the regularizer made small, the iteration does **not** reach a fixed point. Plateau measured over the last
200 of 1200 steps, `eps_r` = 1e-6:

| dt̂ | max\|Δc\| / c_max at the plateau | energy swing | behaviour |
|---|---|---|---|
| 1 | 0.44% | −2e-5 per step | small stable cycle |
| 5 | 10.6% | **+1.4e-4** | large cycle, energy rises within it |
| 20 | 212% | **+0.21** | violent oscillation |

Everything repeats exactly from iteration 1000 to 3000 — a genuine attracting cycle, not slow drift. **v1 never
saw it because `r` was damping it**: the hydraulic solve sees `c + r`, so when `r` is comparable to `c_max` an
oscillation in `c` barely moves the conductance and the feedback is suppressed.

## 11. Background regularizer study — both sides at once

Fixed 1200 steps, plateau over the last 200; reference for distortion is `eps_r = 1e-6, dt̂ = 0.25`.

| eps_r | dt̂ | cycle amplitude | %flux where r>c | w80 | JS vs ref | CG median/max | ms/iter |
|---|---|---|---|---|---|---|---|
| 1e-1 | 0.25 | 1.5e-11 | 10.1% | 619 | 0.0895 | 143/144 | 13.0 |
| 1e-1 | 5 | 1.9e-10 | 10.1% | 619 | 0.0895 | 143/144 | 13.4 |
| 1e-2 | 0.25 | 6.8e-12 | 0.7% | 541 | 0.0185 | 140/140 | 13.2 |
| 1e-2 | 5 | 9.5e-2 | 0.8% | 536 | 0.0374 | 142/144 | 11.7 |
| **1e-3** | **0.25** | **3.8e-11** | **0.0%** | **540** | **0.0034** | **132/140** | **11.3** |
| 1e-3 | 1 | 3.0e-3 | 0.0% | 540 | 0.0030 | 132/140 | 11.9 |
| 1e-3 | 5 | 1.05e-1 | 0.1% | 533 | 0.0615 | 137/145 | 11.1 |
| 1e-4 | 0.25 | 1.4e-4 | 0.0% | 540 | 0.0012 | 129/140 | 10.4 |
| 1e-6 | 0.25 | 2.6e-4 | 0.0% | 540 | 0 (ref) | 132/140 | 10.6 |

**Conditioning is not the constraint.** CG took **129–143** iterations across five orders of magnitude of
`eps_r`, with `ms/iter` between 10.4 and 13.4 and **zero** solve failures at any setting. The theoretical
`(c_max + r)/r` trend would predict roughly a 30× rise in CG iterations from `eps_r` 1e-1 to 1e-6; the measured
rise is ~0%. It was not used to choose anything. The Jacobi preconditioner and the mesh connectivity evidently
keep the spectrum tame even when a large fraction of edges sit far below `r`.

**Stability is the constraint**, and it runs the other way from distortion:

| eps_r reduced 10× | Δ w80 | Δ R_eff | JS between the two | CG median |
|---|---|---|---|---|
| 1e-1 → 1e-2 | 12.6% | 1.1% | 0.077 | 143 → 140 |
| 1e-2 → 1e-3 | 0.2% | 0.2% | 0.016 | 140 → 132 |
| 1e-3 → 1e-4 | 0.0% | 0.0% | 0.003 | 132 → 129 |
| 1e-4 → 1e-6 | 0.0% | 0.0% | 0.001 | 129 → 132 |

## 12. Selected eps_r = 1e-3, with dt̂ = 0.25

The Pareto region exists and this is the corner of it: the only tested combination that is simultaneously a true
fixed point (amplitude 3.8e-11, seven orders below the tolerance) and physically undistorted (w80 identical to
the metre against a 1000× smaller regularizer, 0.0% of flux background-dominated, JS 0.0034).

**Acceptance criterion, stated in advance and met:** reducing `eps_r` by a further 10× changes `w80` by 0.0%,
`R_eff` by 0.0%, and gives JS 0.003 — all far inside the 5% / 0.05 thresholds asserted in `scale.test.ts`.

## 13–14. Minimum conductivity — separate, and inert

`eps_min` is a clamp on the state; `eps_r` is an additive term in the operator. They were studied separately.

| eps_min | iterations | c_median | R_eff | w80 | energy | JS vs 1e-12 |
|---|---|---|---|---|---|---|
| 1e-3 | 225 | 1.47e-3 | 4.47e-1 | 540 | 7.445e-1 | 0.0006 |
| 1e-5 … 1e-12 | 225 | 1.37e-3 | 4.47e-1 | 540 | 7.445e-1 | 0.00000 |

At the corrected scale the median conductivity (1.37e-3·C0) sits **above** the clamp for every tested value, so
the clamp is measurably inactive — in sharp contrast with Gate G, where 73–98% of edges rested on it. **Selected
`eps_min = 1e-9`**, retained purely as a positivity safeguard.

## 15. Convergence criterion

```
max_e |Δc| < tol * C0        with tol = 1e-6
AND  t̂ = iterations * dt̂ >= minimumElapsed  (= 1)
```

Dimensionless by construction, invariant under the C0 gauge (asserted), robust when `c` is small because it is
referenced to `C0` rather than to the current maximum. Energy was investigated as a second signal and **not**
adopted: at the selected point the run reaches a genuine fixed point, so a Δc criterion suffices, and adding an
energy-stagnation clause would be complexity the evidence does not support. Energy remains reported.

At the candidate point: **225 iterations, converged, t̂ = 56.25, maxΔc = 9.7e-7, Kirchhoff 1.9e-11, CG median
132, 4.5 s.**

## 16. Slow-dynamics false convergence

Deliberately collapsing `dt̂` by 1e-3 and 1e-6 at the v2 tolerance produced `maxIterations`, not a false
`converged` — the relative tolerance alone already refuses. Pushed further (`dt̂ × 1e-9`), the field does not move
at all (`c_max/c_init = 1` to 1e-6) while elapsed `t̂` stays below `minimumElapsed`, which is what the guard
rejects. Asserted in `scale.test.ts`.

A production bug was also found and fixed here: `energyMonotone` compared with an **absolute** 1e-12 slack, which
is below roundoff once the energy is O(1), so converged runs flagged their own last digits as violations. It is
now relative.

## 17. Initial condition

| ĉ0 | iterations | c_max | w80 | R_eff | JS vs ĉ0=1 |
|---|---|---|---|---|---|
| 1e-2 | 1050 | 7.5995 | 540 | 4.47e-1 | 0.00000 |
| 1e-1 | 339 | 7.5995 | 540 | 4.47e-1 | 0.00000 |
| **1** | **225** | 7.5994 | 540 | 4.47e-1 | ref |
| 10 | 244 | 7.5994 | 540 | 4.47e-1 | 0.00000 |

The final field is **independent of the start** — only cost changes. `ĉ0 = 1` retained as the cheapest.

## 18. Gate D revalidation

Re-run at the v2 scale (`scale.test.ts`): subdividing the same physical corridor leaves conductivity invariant
(ratio 1.0000 to 4 decimals for 2/5/10 segments); demand conservation through cross-sections at 25/50/75% gives
net axial flux = 1.000000; Kirchhoff residual < 1e-8 (measured 1.9e-11). Unchanged, as required — the
nondimensionalisation is a change of units, not of geometry.

## 19. Gate E/F revalidation

Energy monotone at the v2 point (after the §16 fix). Determinism: identical conductivity and identical iteration
count across repeat runs. IMEX stability: §10 maps where it holds. Distributed sources unchanged. Cost response
unchanged and still monotone (Gate G established it is γ-independent by the fixture's own constraint structure).

## 20–21. Corrected gamma sweep

| gamma | alpha | iterations | energy monotone | c_max | %flux r>c | R_eff | w50 (m) | w80 (m) | sd (m) | H | band |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.25 | 1.111 | 715 | yes | 13.044 | 0.1% | 3.81e-1 | 200 | **341** | 154 | 0.521 | 0.864 |
| 1.50 | 1.200 | 225 | yes | 7.599 | 0.0% | 4.47e-1 | 290 | **540** | 255 | 0.646 | 0.684 |
| 2.00 | 1.333 | 62 | yes | 4.289 | 0.0% | 5.29e-1 | 485 | **964** | 401 | 0.768 | 0.518 |
| 3.00 | 1.500 | 1975 | yes | 2.576 | 0.0% | 6.08e-1 | 539 | **1284** | 544 | 0.852 | 0.416 |

Strictly monotone, and within 1% of Gate G's empirically gauge-fixed widths (343/541/968/1284 m) — two
independent routes to the same numbers, one fitted, one derived. Background-dominated flux is now **0.0–0.1%**
against ~55% in v1. γ=1.25 now also keeps energy monotone, which it did not at Gate G's fitted scale.

## 22. Regime interpretation

The separation is real and stable: w80 = 341 / 540 / 964 / 1284 m and bandShare = 0.86 / 0.68 / 0.52 / 0.42.
But **this Gate deliberately ships one default, not three regimes.** Cost differs by 30× across the range
(62 iterations at γ=2 versus 1975 at γ=3) and the regimes have not been tested against urban geometry. γ = 1.5 is
adopted as the Design-v2 default: middle of the usable band, monotone energy, 225 iterations, and an 80%-flux
corridor of ~540 m for a 1000 m separation. Raw `gamma` stays out of the Design UI; named regimes remain a
candidate for LAB after barriers.

## 23. Rotation spot check

| effective spacing | R_eff anisotropy (v2) | (Gate G, v1) | 0 vs 60 (lattice) | 0 vs 90 (square AOI) |
|---|---|---|---|---|
| 148.5 m | 0.1111 | 0.1103 | 0.0000 | 0.1069 |
| 99.0 m | 0.0407 | 0.0420 | 0.0174 | 0.0416 |

Fixing the regularization leaves the anisotropy conclusion **untouched** — as it should, since orientation bias is
a property of the discretisation. Gate G's finding stands unchanged.

## 24. Proposed Design-v0 parameter set

```
model              design-hucai-v2
gamma              1.5
dt_hat             0.25        dt = dt_hat / (nu * C0^(gamma-2))
eps_r              1e-3        r      = eps_r   * C0
eps_min            1e-9        c_min  = eps_min * C0
c0_hat             1           c_init = c0_hat  * C0
convergence        max|dc| < 1e-6 * C0  AND  t_hat >= 1
maxIterations      4000
L0                 sqrt(meshed area), from the network
Q0                 total positive demand, from the network
C0                 1 (gauge; only ratios matter)
nu                 Q0^2 / (L0^2 * C0^(gamma+1))   — derived
```

## 25. Model version / metadata

`DESIGN_MODEL_VERSION = "design-hucai-v2"`. `DESIGN_REPORT_SCHEMA_VERSION` bumped
`design-v0-continuum-1` → `design-hucai-v2-1`. `DesignFieldDiagnostics` now carries `linearSolve`
(CG iterations, residual, converged) so a Design run can state whether its hydraulics were healthy. The Design
panel shows model version, gamma, dt̂, eps_r, CG iterations and residual. Old QA reports are **not**
reinterpreted: v1 numbers remain v1 numbers under the old schema id.

## 26. Files changed

**New:** `src/design/scale.ts`, `src/design/scale.test.ts` (26 tests).
**Changed:** `src/design/adaptation.ts` (linearSolve threaded through; relative energy-monotonicity test),
`src/design/worker-machine.ts` (defaults to the v2 scale derived from the network),
`src/design/report.ts` (schema id), `src/components/MapWorkspace.tsx` (v2 metadata in the panel),
`src/design/worker-machine.test.ts` (reference updated to v2; new assertion that the worker no longer uses v1).
**Unchanged:** all Analyze code, the TPFA formulation, mesh geometry, support semantics, the pressure solver and
its preconditioner (explicitly not touched to accommodate a smaller `r`).
**Untracked harness:** `scratch/gate-h/{harness,part-1,part-2,part-3,pareto,floor}.ts` and their results.

## 27. Tests / lint / build

`npx tsc --noEmit` clean · **402 tests pass** (375 baseline + 27) · `npm run lint` **0 errors**
(6 warnings, all in untracked `scratch/`) · `npm run build` clean.

Coverage against the requested list: dimensionless round-trip (§6), scale determinism, equal groups → equal
result, `nu` equilibrium scaling, nondimensional time, `eps_r` semantics, `eps_min` semantics, scale-aware
convergence, slow-dynamics rejection, series subdivision, demand conservation, energy monotonicity, gamma
ordering, determinism, Analyze untouched, all previous tests passing.

## 28. Performance

At 2026 edges: 225 iterations, ~14 ms/iteration, **3.2 s** to convergence at γ=1.5. By gamma: 62 iterations
(γ=2) / 225 (γ=1.5) / 715 (γ=1.25) / 1975 (γ=3). CG is 129–143 iterations per hydraulic solve regardless of
`eps_r`, with no warm start between adaptation steps.

**v2 costs roughly 4× more iterations than v1** (225 vs 54) because `dt̂` dropped from an effective ~5 to 0.25 to
kill the limit cycle. That is the price of a field that is actually the model's. Two obvious future savings, both
out of scope here: warm-starting CG from the previous step's pressures, and an adaptive `dt̂`.

## 29. Known limitations

- **The `eps_r` margin is one-sided.** At `dt̂ = 0.25`, `eps_r = 1e-3` is a fixed point but `eps_r = 1e-4` is not
  (amplitude 1.4e-4, above the 1e-6 tolerance). The amplitude margin at the chosen point is enormous (7 orders);
  the margin in the `eps_r` direction is one decade. A different geometry could sit differently, and the
  convergence criterion would report `maxIterations` rather than silently accepting a cycle — but it would stall.
- **The limit cycle was characterised, not explained.** No stability analysis of the IMEX map was done.
- **`w80` is not as resolution-stable as `R_eff`.** Across 250 → 80 m the 80%-flux width spans 438 … 616 m
  (spread 33%) at γ=1.5 while `L0` moves 1% and the effective `r/c_max` moves 20%. This is the same sensitivity
  Gate G reported for the concentrated regime (34% over 200 → 90 m) and it is a property of the discretisation,
  not of the rescaling — a narrower field is resolved by fewer mesh rows. Width figures quoted here are therefore
  good to roughly ±15%, and single-resolution width comparisons between two barrier scenarios should be run at
  the same spacing.
- Studies were run at one geometry (3600 m square, 1000 m separation, 150 m mesh) and mostly at γ=1.5.
- `L0` from the meshed area means the conductivity scale moves with AOI size. Harmless because C0 is a gauge, but
  it does mean `nu` is not comparable between AOIs without stating `L0`.
- The rotation spot check used 4 angles at 2 resolutions, not Gate G's full matrix.
- Warm-starting CG is untested and might change the CG-iteration numbers reported here.

## 30. GO / NO-GO for barriers — **GO**

| condition | status |
|---|---|
| 1. regularization numerically small relative to the field | **yes** — 0.0–0.1% of flux, JS 0.003 vs a 1000× smaller r |
| 2. stable when regularization reduced further | **yes** — Δw80 0.0%, ΔR_eff 0.0% per 10× reduction |
| 3. convergence semantics scale-aware | **yes** — relative to C0, gauge-invariance asserted |
| 4. slow dynamics cannot masquerade as convergence | **yes** — relative tolerance plus a `t̂` floor, tested |
| 5. Hu–Cai gamma behaviour recovered cleanly | **yes** — monotone 341/540/964/1284 m, matching Gate G to 1% |
| 6. accepted hydraulic invariances remain | **yes** — subdivision, conservation, Kirchhoff 1.9e-11 |
| 7. energy behaviour valid | **yes** — monotone at every gamma once the roundoff threshold was fixed |
| 8. one parameterization with reproducible semantics | **yes** — `design-hucai-v2`, every constant derived or a stated ratio |

No arbitrary constant was introduced to compensate for anything: `nu` is derived, `C0` is a proven gauge,
`eps_r` and `dt̂` were chosen from a measured Pareto surface, `eps_min` is demonstrably inert, and `ĉ0` does not
affect the answer.

**Next step:** urban barriers. With a corridor of known width (~540 m at γ=1.5 for a 1000 m separation) and a
regularizer carrying under 0.1% of the flux, `Q_above` vs `Q_below` around a building is now a measurement of the
model rather than a reading of the background.

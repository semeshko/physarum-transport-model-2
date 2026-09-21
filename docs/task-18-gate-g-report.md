# Task 18 Gate G — Design Field Concentration & Mesh Anisotropy

Baseline: `9462e1d` · Design-v0 production code unchanged · study harness in `scratch/gate-g/`

**Verdict: NO-GO for barriers as the model is currently parameterised — but the blocker is not mesh anisotropy.**
At the shipped settings the numerical regularizer, not the Hu–Cai field, carries most of the transport. Mesh
orientation is measured, understood, and refines away for the scalar response. Fix the parameter scale, then proceed.

---

## 1. The exact implemented equation

From `src/design/adaptation.ts` (unchanged):

```
hydraulics   G_e = (c_e + r) * w_e / l_e ,  -div((c + r) grad u) = S
adaptation   dc/dt = |grad u|^2 - nu * c^(gamma - 1)
energy       E[c]  = integral (c + r)|grad u|^2 + (nu/gamma) c^gamma
IMEX step    c+ = (c + dt|grad u|^2) / (1 + dt * nu * c^(gamma-2))
```

with `gamma = 1.5, nu = 1, r = 1e-3, c_0 = 1, dt = 0.5, tol = 1e-7 (absolute), c_min = 1e-9`.

The step's fixed point is `c(1 + dt·nu·c^(gamma-2)) = c + dt·g^2`, i.e. **`nu·c^(gamma-1) = g^2`** — the IMEX
discretisation has exactly the continuum equilibrium, no splitting error in the steady state.

## 2. Theoretical role and admissible range of gamma

**Equilibrium.** `c = (|grad u|^2 / nu)^(1/(gamma-1))`. The exponent `2/(gamma-1)` is the *contrast* exponent:
it says how strongly conductivity responds to a difference in gradient. γ=1.25 → 8, γ=1.5 → 4, γ=3 → 1.

**What is actually minimised.** Eliminating `c` from the energy at fixed flux `q = c·grad u` gives
`min_c [ |q|^2/c + (nu/gamma)c^gamma ]` at `c = (|q|^2/nu)^(1/(gamma+1))`, and substituting back:

```
E_reduced  =  (1 + 1/gamma) * nu^(1/(gamma+1)) * integral |q|^alpha ,     alpha = 2*gamma/(gamma+1)
```

So Design minimises a **branched-transport functional** `∫|q|^α`. This is the exponent that governs concentration:

| regime | meaning |
|---|---|
| α < 1 | concave — concentration is *rewarded*; true branching, Y-junctions |
| α = 1 | Monge / optimal transport; transport collapses onto straight lines |
| 1 < α < 2 | convex — concentration is *penalised*; a distributed field is correct |
| α = 2 | ohmic; maximally spread |

**Admissible range.** The code requires `gamma > 1` and that is also the mathematical requirement (`p` finite,
equilibrium well defined). Therefore `alpha = 2γ/(γ+1)` lies strictly in **(1, 2)**: Design-v0 can never enter the
branching regime. It can only approach the Monge limit from the convex side as `γ → 1+`.

**Direction.** Lower γ → α → 1 → narrower. Higher γ → α → 2 → ohmic → broader. **Measured and confirmed in §6.**

## 3. gamma ↔ exponent relation

`p = 2γ/(γ−1)` as documented in Gate E/F and in `adaptation.ts` is **correct**, and `α = p/(p−1) = p'` is its
Hölder conjugate. Both descriptions are the same statement; α is the useful one because it acts on the flux,
which is what "corridor width" is about.

### Correction to a previous project note

`docs/task-18a-visual-mvp-report.md` line 151 states:

> "If a more corridor-like result is wanted, γ is the knob (higher γ → lower p → stronger concentration)."

**This is wrong, and it was mine.** The `p` relation is right, the concentration direction is inverted. Lower `p`
means `α = p'` closer to 2, i.e. closer to ohmic and *more* diffuse. Concentration requires `α → 1`, i.e. `p → ∞`,
i.e. **`γ → 1+`**. The same file's description of γ=1.5 / p=6 as "a comparatively diffuse steady state" is also
loose: α=1.2 sits nearer the concentrated end of the admissible range. The measurements in §6 settle it: w80 at
γ=1.25 is 343 m versus 1284 m at γ=3.

---

## 4. Experiment geometry

Square AOI **3600 × 3600 m** centred on [24.03, 49.84] (square so rotating the terminals is as fair as a
rectangular AOI allows). Source→sink separation **1000 m**, chord centred on the AOI centre and rotated about it.
Cross-sections at **25% / 50% / 75%** of the separation. Fixed physical bins **±1800 m in 25 m steps**, shared by
every run at every resolution and rotation. Corridor band for `bandShare`: **±250 m**.

## 5. Source / sink support definition

Unchanged production semantics: a marker occupies a physical disc of radius `R` and its demand is split equally
over every mesh node inside it (`assembleDesignNetwork`). Default R = 150 m, magnitude 1 each, balanced.

## 6. Gamma sweep

Two gauges are reported because they answer different questions. "Production gauge" is literally what ships.
"Gauge fixed" is the same model with the scale nuisance removed — see §20 for why that is necessary.

**Production gauge (nu = 1, r = 1e-3), spacing 150 m**

| γ | α | 2/(γ−1) | iters | term | R_eff | w50 (m) | w80 (m) | sd (m) | H | band |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.25 | 1.111 | 8.00 | 37 | converged | 4.80e2 | 519 | 1594 | 646 | 0.865 | 0.473 |
| 1.50 | 1.200 | 4.00 | 54 | converged | 2.81e2 | 473 | 1096 | 541 | 0.813 | 0.526 |
| 2.00 | 1.333 | 2.00 | 41 | converged | 1.17e2 | 507 | 1041 | 489 | 0.812 | 0.482 |

Width is **non-monotonic** and barely responds to γ at all. A wider sweep at spacing 100 m confirmed the shape:
w80 = 1982, 1896, 1575, 1120, 1031, 1239, 1785 m for γ = 1.05, 1.10, 1.25, 1.50, 2.00, 3.00, 5.00 — a spurious
minimum near γ≈2, with γ=3 and γ=5 failing to converge in 4000 iterations.

**Gauge fixed (max c ≈ 1, r = 1e-3 is then a 0.1% perturbation), spacing 150 m**

| γ | α | nu* | c_max | c_med | iters | term | energy monotone | R_eff | w50 (m) | w80 (m) | sd (m) | H | band |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.25 | 1.111 | 2.49e-5 | 1.0 | 1.4e-8 | 88 | converged | **NO** | 4.95 | **201** | **343** | 168 | 0.528 | 0.860 |
| 1.50 | 1.200 | 1.23e-5 | 1.0 | 1.5e-4 | 56 | converged | yes | 3.39 | 291 | 541 | 260 | 0.649 | 0.683 |
| 2.00 | 1.333 | 6.10e-6 | 1.0 | 1.1e-2 | 36 | converged | yes | 2.26 | 485 | 968 | 403 | 0.769 | 0.518 |
| 3.00 | 1.500 | 3.41e-6 | 1.0 | 8.5e-2 | 1408 | converged | yes | 1.56 | 539 | 1284 | 545 | 0.853 | 0.415 |

**Strictly monotonic, exactly as theory predicts**, and the dynamic range is 3.7× in w80 versus 1.5× (and
non-monotonic) in the production gauge.

## 7. Convergence

All conserved quantities are clean in every run: net axial flux through all three cross-sections = **1.00000**,
coherence = 1.000 (every cut edge carries flow down-axis), Kirchhoff residual 4e-12 … 1e-11.

Energy decreased monotonically everywhere **except γ = 1.25 gauge-fixed**, which registered violations. γ = 3.0
needs 1408 iterations against 36–88 for γ ≤ 2. γ ≥ 3 in the production gauge did not converge within 4000 at all.
Usable band on this evidence: **1.25 < γ ≤ 2**, with γ=1.25 itself flagged.

## 8. Physical field width

Width is reported in metres as the central 50% / 80% of transport through a fixed physical cross-section:

> **γ = 1.25 → the central 80% of flux occupies ≈ 343 m; γ = 1.5 → ≈ 541 m; γ = 2.0 → ≈ 968 m; γ = 3.0 → ≈ 1284 m**
> (gauge fixed, 1000 m separation, 150 m mesh)

For comparison the shipped configuration gives ≈ 1096 m at γ=1.5 — twice as wide, and for the wrong reason.

## 9. Entropy / concentration

Normalised bin entropy and corridor share move together with width and in the same monotone order:
H = 0.528 / 0.649 / 0.769 / 0.853 and bandShare(±250 m) = 0.860 / 0.683 / 0.518 / 0.415 for γ = 1.25 / 1.5 / 2 / 3.
At γ=1.25, 86% of transport passes within ±250 m of the centreline; at γ=3 only 42%.

## 10. Cost response

Two parallel physical corridors, one given `ratio`× the resistance (the Gate E fixture). Flux share on the cheaper
corridor, for **every** γ from 1.1 to 5.0 and in **both** gauges:

| ratio | 1.0 | 1.1 | 1.5 | 2.0 | 3.0 |
|---|---|---|---|---|---|
| share | 0.500 | 0.524 | 0.600 | 0.667 | 0.750 |

Monotone everywhere; response to physical resistance is **not** damaged by any γ.

The γ-independence is a property of this fixture, not evidence of a dead model. Equal pressure drop across two
parallel corridors forces `c_1 = c_2` at equilibrium, after which `q_1/q_2 = w_1/w_2 = ratio` for any γ. (I initially
predicted a strong γ-dependence here from the continuum `∫|q|^α` formula; that prediction does not apply to this
discrete parallel-corridor constraint structure, and the measurement is right.) **Consequence: the two-corridor
fixture cannot be used as a γ probe.** The cross-section metrics of §6 are the instrument that works.

## 11. Resolution refinement

Physical metrics at angle 0, four resolutions (full table in `scratch/gate-g/part-bce.txt`):

| γ | gauge | w80 @200 m | @150 m | @120 m | @90 m | spread |
|---|---|---|---|---|---|---|
| 1.25 | production | 1477 | 1594 | 1614 | 1625 | 9% |
| 1.50 | production | 1054 | 1096 | 1120 | 1112 | 6% |
| 2.00 | production | 1042 | 1041 | 1053 | 1063 | 2% |
| 1.25 | fixed | 353 | 343 | 404 | 357 | 16% |
| 1.50 | fixed | 440 | 541 | 618 | 600 | 34% |
| 2.00 | fixed | 828 | 968 | 876 | 901 | 16% |

`R_eff` is markedly more stable than width: e.g. γ=1.5 gauge-fixed gives 3.71 / 3.39 / 3.24 / 3.38 (13% spread),
γ=1.5 production 3.14e2 / 2.81e2 / 2.67e2 / 2.79e2 (17%). Both are **bounded, not drifting** — refining 200→90 m
does not send the field anywhere. The concentrated regime is noisier under refinement than the diffuse one, which
is expected: a narrower field is resolved by fewer mesh rows.

## 12. Requested vs effective spacing

The odd-row parity rule (Gate F) means the effective spacing is not the requested one. All comparisons above use
the effective geometry.

| requested | effective | rows (odd) | nodes | edges |
|---|---|---|---|---|
| 200 | 207.8 | 21 | 368 | 1027 |
| 150 | 148.5 | 29 | 711 | 2026 |
| 120 | 122.3 | 35 | 1033 | 2970 |
| 100 | 99.0 | 43 | 1570 | 4551 |
| 90 | 90.4 | 47 | 1880 | 5467 |

Drift is up to **+3.9%** (200 → 207.8). Not large enough to explain any effect reported here, but it is why the
tables carry the effective column.

## 13. Rotation study

Same physical source/sink pair rotated about the AOI centre through 0/15/30/45/60/75/90°, γ = 1.5.

**Theoretical equivalences.** The equilateral triangular lattice is D6 — metrics must repeat every 60° and under
mirror, so {0, 60}, {15, 45, 75}, {30, 90} are predicted equivalent. The square AOI is only D4, repeating every
90°. These predict different pairings, which makes them a clean discriminator rather than an assumption.

Per-angle tables are in `scratch/gate-g/part-bce.txt`. Centreline deviation stayed within ±42 m of the axis at
every angle and resolution (≤4% of separation), so the field does not drift off-axis.

## 14. Anisotropy metric

`anisotropyError(x) = (max(x) − min(x)) / |mean(x)|` over the seven orientations, applied to physical metrics only.
Reported for `R_eff` (one scalar for the whole field, the least noisy), `w50`, `w80`, `bandShare`, `H`.

## 15. Anisotropy vs resolution

| effective spacing | R_eff (prod) | R_eff (fixed) | w50 (prod) | w80 (prod) | band (prod) |
|---|---|---|---|---|---|
| 207.8 m | 0.2082 | 0.1895 | 0.2596 | 0.1317 | 0.1737 |
| 148.5 m | 0.1103 | 0.1133 | 0.2500 | 0.0861 | 0.0920 |
| 99.0 m | **0.0420** | **0.0406** | 0.2000 | 0.1171 | 0.1099 |

**The scalar physical response becomes isotropic under refinement: 21% → 11% → 4%,** and identically so in both
gauges — orientation bias is a property of the discretisation, not of the parameter scale. Width metrics improve
much more slowly and are still ~20% orientation-dependent at 99 m.

**Symmetry discriminator on R_eff** (relative difference):

| spacing | 0 vs 60 (lattice) | 30 vs 90 (lattice) | 15 vs 45 (lattice) | 0 vs 90 (square AOI) |
|---|---|---|---|---|
| 207.8 m | 0.1424 | 0.1701 | 0.0818 | 0.0446 |
| 148.5 m | **0.0006** | 0.0584 | 0.0271 | 0.1037 |
| 99.0 m | 0.0211 | **0.0058** | **0.0099** | 0.0432 |

At 148.5 m and 99.0 m the lattice-equivalent pairs agree far better than they do at 200 m, and at 148.5 m
`R(0°)` and `R(60°)` agree to **0.06%** while `R(0°)` vs `R(90°)` differ by 10%. That is the D6 fingerprint: the
residual orientation dependence is the **triangular lattice**, not the square domain. At 200 m the pattern breaks
down because the terminal supports themselves discretise differently at each angle.

## 16. Distribution distances

Jensen–Shannon distance (base 2, bounded [0,1], symmetric, a true metric, finite when a bin is empty in one
distribution only — which happens constantly between two meshes) and total variation, on the shared fixed bins.

Cross-orientation JS at 25 m bins stays in 0.27–0.67 at every resolution and does **not** fall with refinement.
**This is an instrument limitation, not a result.** A 150 m mesh has a ~126 m row pitch and cannot carry structure
at 25 m; comparing two orientations at that bin width measures each lattice's imprint. The same effect was caught
and fixed inside the metric itself (see §24), and is why `field-metrics.test.ts` asserts cross-resolution agreement
on 200 m bins (JS < 0.12) and on width statistics (<15%), not on 25 m bins. Conclusions about anisotropy in this
report rest on `R_eff` and the width statistics, which are resolvable.

## 17. Source-support radius study

γ = 1.5, spacing 100 m, radius 100 / 150 / 250 / 400 m (4 / 9 / 23 / 60 support nodes):

| radius | gauge | R_eff | w50 @25% | w50 @50% | w80 @50% | band @50% |
|---|---|---|---|---|---|---|
| 100 | fixed | 3.37 | 233 | 264 | 532 | 0.743 |
| 150 | fixed | 3.21 | 246 | 304 | 546 | 0.715 |
| 250 | fixed | 2.99 | 322 | 330 | 671 | 0.668 |
| 400 | fixed | 2.76 | 425 | 387 | 820 | 0.568 |

The radial fan near the markers is **expected continuum behaviour**: a finite disc still looks near-point-like at
mesh scale, and 2-D potential flow radiates from it. But the support radius is *not* cosmetic — it changes the
**mid-field** too (w80 at the halfway section grows 532 → 820 m, +54%, as R goes 100 → 400 m). Radius is a model
parameter with physical consequences, as Gate D already established, and it must be held fixed in any comparison.
It was held fixed at 150 m throughout §6–§15.

## 18. Visual observations — *not* evidence

`scratch/gate-g/fig1..fig6.svg`, rendered deterministically from the field data (no app changes; the UI exposes no
γ control and Gate G must not add one). Ordering by file size alone tracks the measurements: γ=1.25 → 37 KB,
γ=1.5 → 115 KB, γ=3.0 → 494 KB, i.e. progressively more edges carrying non-negligible conductivity.

- `fig1` production γ=1.5 — broad, low-contrast wash; this is what Ivan saw in the browser.
- `fig2` gauge-fixed γ=1.5 — a recognisable corridor with structured fringes.
- `fig3` gauge-fixed γ=1.25 — narrow, nearly single-corridor.
- `fig4` gauge-fixed γ=3.0 — diffuse, close to ohmic.
- `fig5` vs `fig6` — mesh-aligned (0°) vs off-axis (30°); the lattice imprint is visible in both, the corridor is not.

## 19. Performance

Representative, single-threaded, this machine (full column in `part-bce.txt`):

| nodes | edges | γ | iters | total | per iteration |
|---|---|---|---|---|---|
| 368 | 1027 | 1.5 | 60–81 | 0.3–0.5 s | ~6 ms |
| 711 | 2026 | 1.5 | 54–56 | 1.1 s | ~20 ms |
| 1033 | 2970 | 1.5 | 54–55 | 0.9–1.0 s | ~18 ms |
| 1880 | 5467 | 1.5 | 59–75 | 2.3–3.1 s | ~40 ms |
| 3740 | 10975 | 1.5 | 54 | 8.9 s | ~165 ms |

γ = 3.0 costs ~25× more iterations (1408 vs 56). **Practical Design-v0 envelope: ≤ ~2000 nodes / ~6000 edges**
for an interactive run, which at 1000 m separation means an effective spacing of ~90–100 m.

## 20. Are gamma and mesh anisotropy empirically separable? — Yes

They are separable, and they differ by an order of magnitude in effect size:

- **γ** moves w80 by **3.7×** (343 → 1284 m) and `R_eff` by 3.2× under a fixed mesh and fixed orientation.
- **Orientation** moves `R_eff` by **4%** at 99 m, and that number *falls* with refinement (21% → 11% → 4%),
  identically in both gauges — so it is a property of the discretisation alone.

γ does **not** fix anisotropy and anisotropy does **not** produce the width ordering. Confirmed as two axes.

### But a third factor dominated both, and it was not on the list

At the shipped parameters the equilibrium conductivity lands at `c_max ≈ 1e-3 … 1e-2` because `nu = 1` with metre
lengths and unit demand puts the reference gradient far above the actual gradients (~0.3). The regularizer
`r = 1e-3` is then **not** a perturbation. Measured at spacing 150 m:

| γ | c_max | edges at the 1e-9 floor | edges with c < r | flux on those edges | Σr / (Σr + Σc) |
|---|---|---|---|---|---|
| 1.05 | 1.20e-3 | 98% | 100% | 98.2% | 99.8% |
| 1.25 | 4.13e-3 | 73% | 99% | 79.4% | 96.7% |
| **1.50** | **7.81e-3** | **11%** | **97%** | **55.3%** | **88.5%** |
| 2.00 | 1.66e-2 | 0% | 84% | 19.4% | 57.7% |
| 3.00 | 4.22e-2 | 0% | 11% | 0.1% | 15.3% |

**At the reference baseline γ=1.5, 97% of edges have conductivity below the regularizer and 55% of all flux flows on
them.** The broad band in the browser is substantially the regularizer, not Hu–Cai. These runs are genuinely
converged — relative Δc reaches 1e-14 by iteration 200 — so this is not under-convergence.

`nu` is a gauge on the magnitude of `c` (`c(nu) = c(1)·nu^(−1/(γ+1))`, from the flux form, since conservation pins
`|q|`), and a uniform rescaling of `c` cannot change the flow because conductances enter the Laplacian only through
ratios. The fixed `r` breaks that gauge: what matters physically is `c/r`. Fixing the gauge so `c_max ≈ 1` restores
`r` to 0.1% — and only then does the γ ordering appear (§6). Direct evidence: sweeping `nu` = 1 → 1e-2 → 1e-4 →
1e-6, the JS distance of the flux profile from the `nu=1` field **saturates at 0.287** once `c ≫ r`, i.e. the field
stops depending on `nu` exactly as a gauge should, and the shipped field differs from the true one by JS = 0.29.

`nu` also sets the relaxation **rate** (decay term `nu·c^(γ−1)`), so rescaling it without rescaling `dt` freezes the
dynamics — a first attempt reported "converged at iteration 1" on the untouched initial condition. The genuine
dimensionless timestep is **`dt·nu`**, and Gate F's "dt=0.5 converges, dt=2 diverges" is really a statement about
`dt·nu = 0.5`. All gauge-fixed runs here hold `dt·nu = 0.5`.

## 21. Design-v0 gamma status

**γ = 1.5 remains the REFERENCE BASELINE. It is not an approved product default, and Gate G does not approve one.**

Gate G cannot select a product default, because at the shipped scale γ barely moves the result (§6, production
gauge) and what little it moves is non-monotonic — the knob being turned is not the one that matters. Nor is the
shipped configuration currently delivering a γ=1.5 field at all.

γ = 1.5 keeps the baseline role on the corrected scale too: monotone energy, 56 iterations, an 80%-flux corridor
of ~540 m at 1000 m separation. But once the model is properly non-dimensionalised, 1.25, 1.5 or some other value
may turn out to suit the role of Design Mode better. **The Design-v0 γ recommendation belongs to Gate H, after
corrected-scale validation.** Do not change γ before then either — that would be tuning the wrong knob while `r`
still dominates.

**Recommended change is to the scale, not to γ** (a separate, reviewable task):
1. gauge `nu` so `c_max` is O(1) — equivalently non-dimensionalise the gradient — and hold `dt·nu = 0.5`;
2. make the convergence tolerance **relative** to the conductivity scale; an absolute 1e-7 means very different
   stringency at `c ~ 1e-3` and at `c ~ 1`;
3. re-validate Gate E/F at the corrected scale (they were established in the same regime and may be affected);
4. then re-run Gate G Part A to confirm the ordering, and only then pick γ.

## 22. Are multiple Design regimes justified?

**Yes, on the measured evidence — but only after §21.** The gauge-fixed regimes are cleanly separated, not a
continuum of taste: w80 = 343 / 541 / 968 / 1284 m and bandShare = 0.86 / 0.68 / 0.52 / 0.42 for γ = 1.25 / 1.5 /
2 / 3. Those are distinguishable on the map and in metres.

Provisional mapping, to be confirmed after the scale fix — **not to be shipped from this Gate**:
`Concentrated` γ≈1.25 (flagged: energy monotonicity violated), `Balanced` γ=1.5, `Exploratory` γ≈2.
γ ≥ 3 is not recommended: 25× the iterations for a field approaching ohmic.

## 23. Should raw gamma stay LAB-only?

**Yes.** γ is not a user quantity: it is an exponent whose effect is invisible unless the `nu`/`r` scale is right,
it silently changes runtime by 25×, and below ~1.25 it breaks energy monotonicity. Expose named regimes with
tested definitions in Design; keep raw γ (and `nu`, `dt`, `r`) to a future LAB mode.

## 24. Known limitations

- **Domain confinement.** w80 reaches ~1284 m in a 3600 m domain with 1000 m separation, so the boundary is not
  irrelevant for the diffuse end. Geometry was held identical across every comparison, so the *ordering* is safe;
  absolute widths at γ ≥ 2 are lower bounds.
- **Square AOI vs D6 lattice.** No rectangular AOI is rotation-invariant. Mitigated by the 0/60 vs 0/90
  discriminator (§15) rather than removed.
- **Cross-orientation profile distances at 25 m bins are not interpretable** (§16).
- **Two-corridor fixture cannot probe γ** (§10).
- γ = 1.25 gauge-fixed violates energy monotonicity; not investigated further here.
- γ ≥ 3 in the production gauge does not converge within 4000 iterations.
- Rotation was studied at γ = 1.5 only.
- A measurement bug was found and fixed mid-Gate: the flux through a network cut is the sum of the *whole* flows of
  the cut edges, not their axis-projected components. The cosine weighting undercounted by ~8% and broke
  conservation; the conservation check (`net axial flux == total demand`) is what caught it and is now a test.

## 25. Files created / changed

**Production (new, tested, no behaviour change to Design-v0):**
- `src/design/field-metrics.ts` — axis frame, fixed physical bins, cross-section flux profile, concentration
  metrics, effective resistance, JS/TV distances, anisotropy error.
- `src/design/field-metrics.test.ts` — 19 tests.

**Study harness (untracked, `scratch/gate-g/`):** `harness.ts`, `gauge.ts`, `part-bce.ts`, `cost2.ts`,
`background-dominance.ts`, `render.ts`, results `part-bce.txt` / `part-a2.txt`, figures `fig1..fig6.svg`.

**Unchanged:** every Design-v0 production parameter, the TPFA formulation, mesh geometry, support semantics,
the pressure solver, the Hu–Cai equation, the IMEX step, and all Analyze code.

## 26. Test / lint / build

`npx tsc --noEmit` clean · **375 tests pass** (356 baseline + 19 new) · `npm run lint` **0 errors**
(5 warnings, all in untracked `scratch/`) · `npm run build` clean. No Analyze regressions; no Analyze science touched.

## 27. Working tree

Two new untracked files (`src/design/field-metrics.ts`, `.test.ts`). Nothing committed — Gate G is a study.
`scratch/` remains untracked and gitignored.

## 28. Recommended next step

**Do not start barriers.** Not because mesh orientation dominates — it does not; it is 4% on `R_eff` at 99 m and
falling — but because at the shipped scale a barrier experiment would mostly be measuring `r`. Adding buildings now
would mix urban geometry into an effect that is already ~55% regularizer.

Proposed **Gate H — Design parameter scale**: non-dimensionalise the model (`nu` gauge, `dt·nu` invariant,
relative tolerance, `r` as a stated fraction of `c_max`), re-validate Gate E/F at the corrected scale, re-run Gate G
Part A to confirm the γ ordering, and select the Design-v0 default. Barriers become a sharp test immediately after:
with a genuine corridor of known width, `Q_above` vs `Q_below` around an obstacle is a real measurement rather than
a reading of the background.

### Decision rule

| condition | status |
|---|---|
| 1. a γ regime with stable physical interpretation | yes — after gauge fix; **not** at shipped settings |
| 2. concentration metrics stable under refinement | yes, bounded (6–34% over 200→90 m; `R_eff` 13–17%) |
| 3. energy / convergence valid | yes for 1.5 ≤ γ ≤ 2; **no** at γ=1.25 and γ≥3 |
| 4. rotational anisotropy measured and understood | **yes** — D6, 21%→11%→4% on `R_eff` |
| 5. no catastrophic mesh locking | **yes** — nothing diverges or locks under refinement |
| 6. distributed-source behaviour understood | yes — radial fan expected; radius affects the mid-field |
| 7. default based on quantitative behaviour | **blocked** by the scale defect |

Conditions 4 and 5 — the ones this Gate existed to answer — pass. Condition 7 fails for a reason the Gate found
along the way. **NO-GO for barriers; GO for Gate H.**

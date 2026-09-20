# Task 18 Gate C.1 — Corridor / Representation Invariance

Verdict: **NO-GO** for `localThroughput` normalization as the Design v0
adaptation law. All numbers below are from real runs of
`scratch/task18-gate-c1.ts` against the unmodified production
`solveHydraulics`. `src/` was not modified in this gate.

## Headline finding

Global-demand and local-throughput normalization fail on **complementary
axes**. Neither is a valid continuum formulation.

| Property | Global (`κ·Q_ref`) | Local (`κ·T_upstream`) |
|---|---|---|
| Path subdivision invariance (same corridor, more segments) | **PASS** (exact) | **FAIL** (up to 5.15% asymmetry) |
| Alternative-multiplication invariance (mesh refinement) | **FAIL** (3.5× median-D drift, Gate B) | **PASS** (0.573–0.591 across 40→10 m) |

Refining a mesh does two different things at once: it *subdivides* existing
paths **and** *multiplies* parallel alternatives. Each normalization is blind
to exactly one of them.

## 1. Parallel corridor subdivision (both corridors split equally)

Two physically identical corridors, S→T, each split into N segments,
κ=1 (global) / κ=0.25 (local), n=1.05.

| N | global shareA | global R_A | local shareA | local R_A |
|---|---|---|---|---|
| 1 | 0.5000 | 3.07053 | 0.5000 | 1.48297 |
| 2 | 0.5000 | 3.07053 | 0.5000 | 1.35811 |
| 5 | 0.5000 | 3.07053 | 0.5000 | 1.28320 |
| 10 | 0.5000 | 3.07053 | 0.5000 | 1.25823 |
| 20 | 0.5000 | 3.07053 | 0.5000 | 1.24574 |
| 50 | 0.5000 | 3.07053 | 0.5000 | 1.23825 |

Both preserve the 50/50 split — but only because the bias is *identical on
both sides and cancels*. Local's absolute corridor resistance drifts 16.5%
(1.483 → 1.238) purely from subdivision; global's is exact to 5 decimals.

**Analytical explanation.** Under local normalization only the first edge
after a branch sees competition (q̂ = Q_A/T_branch); every downstream transit
edge has T_upstream = Q_A, hence q̂ = 1. With α=μ=1, κ=0.25, n=1.05:

```
D_transit = f(1)   = 1/(κ^n + 1)          = 0.8109   (matches observed max D exactly)
D_branch  = f(0.5) = 0.5^n/(κ^n + 0.5^n)  = 0.6743
R(N) = (L/N)/D_branch + (N−1)(L/N)/D_transit  →  L/D_transit as N→∞
```

The competitive segment's share of corridor resistance is O(1/N) and vanishes
under refinement. Predicted R: 1.48297 (N=1) → 1.23825 (N=50). Observed:
identical to 5 decimals. The mechanism is fully understood, not empirical.

## 2. Unequal-cost corridors × subdivision (local, κ=0.25)

`cheapShare` for a given total cost ratio, as segment count changes:

| ratio | N=1 | N=5 | N=20 | N=50 |
|---|---|---|---|---|
| 1.05 | 0.5185 | 0.5132 | 0.5124 | 0.5123 |
| 1.10 | 0.5362 | 0.5259 | 0.5243 | 0.5240 |
| 1.25 | 0.5845 | 0.5603 | 0.5567 | 0.5560 |
| 1.50 | 0.6522 | 0.6086 | 0.6021 | 0.6008 |
| 2.00 | 0.7546 | 0.6811 | 0.6701 | 0.6681 |

Cost sensitivity survives and is monotonic in ratio (good), and converges to a
limit as N grows (0.6811→0.6701→0.6681). But the *magnitude* of the response
drifts materially at low N — 8.7 percentage points between N=1 and N=50 at
ratio 2.0. The response has a continuum limit; coarse representations do not
sit on it.

## 3. Mixed subdivision — the decisive adversarial test

Physically identical corridors (same total length, same total cost), differing
**only** in segment count:

| mode | segA : segB | shareA | shareB | asymmetry | R_A | R_B |
|---|---|---|---|---|---|---|
| global | 5 : 50 | 0.5000 | 0.5000 | 0.0000 | 3.07053 | 3.07053 |
| global | 1 : 10 | 0.5000 | 0.5000 | 0.0000 | 3.07053 | 3.07053 |
| **local** | 5 : 50 | 0.4907 | 0.5093 | **−0.93%** | 1.28513 | 1.23807 |
| **local** | 2 : 20 | 0.4758 | 0.5242 | **−2.42%** | 1.37101 | 1.24458 |
| **local** | 1 : 10 | 0.4485 | 0.5515 | **−5.15%** | 1.54136 | 1.25351 |

Swapping the operands mirrors the result exactly (50:5 → +0.93%), confirming a
systematic representation bias rather than noise or asymmetric convergence.
**The more finely a corridor is represented, the more flow it attracts.**

Per the Gate C.1 decision rule this is a NO-GO.

## 4. Branch-degree study

Equal d-way alternatives, n=1.05, κ=0.25. Analytical q̂ = 1/d confirmed
empirically to 4 decimals:

| d | q̂ | Hill response | observed D |
|---|---|---|---|
| 2 | 0.5000 | 0.6743 | 0.6743 |
| 3 | 0.3333 | 0.5749 | 0.5749 |
| 4 | 0.2500 | 0.5000 | 0.5000 |
| 6 | 0.1667 | 0.3951 | 0.3951 |

κ=0.25 has clean semantics ("half-response at 25% of local throughput") but
the *operating point* depends on branch degree. The accepted planar
center-split square lattice has **mixed degree**: interior grid nodes have
degree 8 (4 orthogonal + 4 cell-centre spokes), cell-centre nodes have degree
4. So a single κ sits at two different points on the Hill curve depending on
node type. Acceptable in isolation, but it is an additional
representation dependence, not a neutral parameter.

## 5–6. Macroscopic resolution / obstacle tests — not run

Deliberately skipped. The decision rule fails at item 3 on a fixture far
simpler and more diagnostic than a macro cross-section study; running the
expensive macro tests on a formulation already shown to be
subdivision-biased would not change the verdict. They should be run against
whatever formulation replaces this one.

## 7. Convergence

All Gate C.1 fixtures are small and converged strictly (tolerance 1e-9,
82–85 iterations). The 15 m / 10 m non-convergence reported in Gate C stands
uncorrected and un-hidden: maxDeltaD ≈ 8.4e-6 and 3.5e-5 at 3000 iterations
against a 1e-6 tolerance, for both global and local. Macroscopic metrics
(median/max D) had stabilised well before strict D convergence. `maxIterations`
was not raised to force green results.

**Recommended safe Design-v0 resolution envelope** (from Gate B/C timings on
this hardware): 40–20 m spacing over a ~600 m AOI (≈1.5k–5.5k edges) converges
strictly within 3000 iterations; 15 m and finer should be treated as
experimental until convergence behaviour is addressed separately.

## 8. Correction to the Gate C report (cyclic graphs)

The previous report's claim that the planar center-split square lattice "has
no cycles" was **wrong**. The lattice contains many undirected graph cycles.
The correct statement: flow is potential-driven, so `Q_ij > 0 ⟹ P_i > P_j`,
and a strictly-positive directed flow cycle would require a strictly
decreasing closed pressure loop, which is impossible. Zero-flow /
equal-pressure degeneracies remain the only edge case. The Gate C.1 fixtures
(parallel corridors sharing S and T) are themselves cyclic graphs and
behaved deterministically.

## 9. Zero / near-zero flow and the q̂ invariant

`T_i = (Σ|Q_ij| + |b_i|)/2 = max(outflow_i, inflow_i)` — the identity from the
Gate C.1 brief is correct and was verified numerically: max deviation between
the two forms over all nodes = **4.441e-16**.

Since T_upstream includes the edge itself, `|Q_e| ≤ outflow ≤ T_upstream`,
giving the strict invariant `0 < q̂ ≤ 1` for any non-zero edge — no epsilon
guard is structurally required. Observed q̂ range on a mixed 5/7-segment
unequal-cost fixture: **[0.433068, 1.000000]**. No NaN/Infinity produced.
`Q = 0 → Hill response = 0` is already the existing production behaviour and
was not changed.

## Recommendation

**NO-GO** on `scaleMode = localThroughput` for Design v0. Do not attempt a
further heuristic correction to it (per the decision rule).

The diagnosis points precisely where the Gate C.1 brief anticipated: neither
normalization is a continuum formulation, because both normalize by a *flow*
quantity while the discretization artifact is *geometric*. A candidate edge
represents a physical width/area of space, and two representations of the same
corridor differ in how many edges share that width. The next hypothesis should
therefore be a **flux-density formulation** — normalizing edge flow by the
physical cross-sectional width the edge represents (e.g. dual-cell width in
the lattice), so that subdividing a corridor divides its represented width
accordingly and leaves total corridor flux invariant.

That is a materially different formulation from tuning κ, and should be its
own research gate before any Design Mode implementation.

## Working tree / verification

- `src/` unchanged; 281/281 existing tests pass; `next build` clean.
- `npx eslint .` reports 0 errors, 3 warnings — all unused-variable warnings
  inside `scratch/` research files.
- New untracked files only: `scratch/task18-*.ts`, this report. Nothing
  committed.

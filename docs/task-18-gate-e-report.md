# Task 18 Gate E — Continuum Adaptation Law

**Verdict: GO on the adaptation law (Hu–Cai / HKM scalar continuum).
NO-GO on immediate production implementation** — four concrete, well-defined
engineering items must close first (§27).

All numbers from real runs of `scratch/task18-gate-e.ts` against the
**unmodified** production `solveHydraulics`. `src/` untouched.

## 1. Literature review

| source | contribution used here |
|---|---|
| [Facca–Cardin–Putti, DMK / branching structures](https://arxiv.org/html/1811.12691v2) | exact DMK equations + Lyapunov functional |
| [Mesoscopic model of biological transportation networks](https://arxiv.org/html/2401.07922) | exact Hu–Cai discrete energy + gradient flow |
| [Haskovec–Markowich–Zampini, *Gradient flows for the p-Laplacian*](https://arxiv.org/html/2510.15379) | **rigorous Γ-limit** of the discrete model on **equilateral triangulations**; scalar continuum energy; p-Laplacian steady state |
| [Implicit/semi-implicit schemes for Cai–Hu](https://smai-jcm.centre-mersenne.org/item/10.5802/smai-jcm.59.pdf) | documents explicit-Euler stiffness; implicit schemes decay energy unconditionally |

**Independent confirmation of Gate D.** HKM prove Γ-convergence *specifically on
equilateral triangulations*, and state the reason as their rotational symmetry
making the discrete directional weighting average to isotropy. Gate D reached
the same mesh conclusion numerically (triangular spread 1.54% vs square-4
2.97%). Two independent routes, same answer.

## 2. Candidate A — DMK (exact equations)

```
−∇·(μ ∇u) = f                     (Neumann, ∫f⁺ = ∫f⁻)
∂μ/∂t = (μ|∇u|)^β − μ
μ(0,x) = μ₀ > 0
```
Lyapunov: `ℒ_β(μ) = ½∫μ|∇u|²dx + ½∫ μ^((2−β)/β)/((2−β)/β) dx`
(for β=2 the second term is `½∫ln μ`).

Since `j = −μ∇u`, we have `μ|∇u| = |j|`, so the law is literally
`∂μ/∂t = |j|^β − μ` — driven by **flux density**, the exact quantity Gate D
validated. **No `J_ref` required.**

## 3. Candidate B — Hu–Cai / HKM (exact equations)

Discrete (Hu–Cai):
```
Q_ij = C_ij (P_j − P_i)/L_ij
E[C] = Σ_(i<j) ( Q_ij²/C_ij + (ν/γ)C_ij^γ ) L_ij
dC_ij/dt = ( Q_ij²/C_ij² − ν C_ij^(γ−1) ) L_ij
```
Γ-limit continuum (HKM, on equilateral triangulations):
```
−∇·((c+r)∇u) = S
ℰ[c] = ∫_Ω (c+r)|∇u[c]|² + (ν/γ)c^γ dx
∂c/∂t − |∇u|² + ν c^(γ−1) = 0
```
Steady state (r=0, ν=1): `−∇·(|∇u|^(p−2)∇u) = S` with `p = 2γ/(γ−1) > 2`.

Note `Q²/C² = ((P_j−P_i)/L)²` is exactly the discrete `|∇u|²`. **No `J_ref`.**

## 4. Candidate C — continuum Hill: **rejected**

Rejected on the gate's own criterion. A Hill response requires a reference
scale `J_ref`, and no principled continuum source for it exists: it is not
determined by the equations (unlike A and B, where the decay term sets the
scale intrinsically). Gates B/C/C.1 spent three rounds failing to construct
such a reference. Both literature laws **eliminate the problem rather than
solve it** — that is the decisive argument against C.

## 5. Dimensional analysis

```
u,p : potential                     [P]
σ,μ,c : conductivity density        — field value, not tube size
j   : flux density  = −σ∇u          [Q·m⁻¹]
s,f,S : source density              [Q·m⁻²]
G_e = σ_e w_e / l_e   (Gate D TPFA);  Q_e = G_e ΔP;  j_e = Q_e / w_e
```
Every term in both A and B is dimensionally closed without an added constant.

## 6. Scalar vs tensor

**Scalar, and this is justified rather than a convenience.** The full Hu–Cai
continuum is often written tensorially (`C = rI + m⊗m`, vector `m`). But HKM
prove a **rigorous scalar Γ-limit** on equilateral triangulations. So a scalar
Design v0 sits on published ground, not on a simplification I invented. A
tensor field is not introduced — per the gate's instruction not to generalise
without need.

## 7. Source-density model

Fixed-physical-radius disk (r = 9 m), demand divided over the enclosed nodes so
`Σ magnitudes = prescribed total` at every resolution. Carried over from Gate D
§9, where single-node snapping was shown to diverge logarithmically
(`k ≈ 0.165` vs theoretical `1/2π = 0.159`).

## 8. Mesh implementation

Equilateral triangular lattice, hexagonal Voronoi dual: `w_e = a/√3`, `l_e = a`,
all transmissibilities positive. Center-split square excluded (Gate D: zero
transmissibility on orthogonal edges). Largest connected component extracted
after obstacle carving.

## 9. Mesh-refinement study (TEST 1/5) — **PASS**

Normalised L1 between the adapted conductivity field on fixed physical bins
(20×12) and the finest mesh:

| law | a=6 | a=4 | a=3 | a=2.5 |
|---|---|---|---|---|
| DMK β=1 | 0.3362 | 0.1650 | **0.1044** | 0 (ref) |
| DMK β=1.5 | 0.2986 | 0.1618 | 0.1462 | 0 (ref) |
| Hu–Cai γ=1.5 | 0.1777 | 0.1405 | **0.0678** | 0 (ref) |

All three converge monotonically. **This is the property that global (Gate B),
local (Gate C.1) and every earlier formulation failed.** Hu–Cai converges from
the lowest error; DMK β=1 shows the cleanest ~O(h) halving; DMK β=1.5 stalls
between a=4 and a=3.

**Caveat:** Hu–Cai did not reach the steady-state tolerance (maxDelta ≈ 2e-3 vs
tol 1e-7, hit the 4000-step cap) — see §17.

## 10. Rotational study — **NOT RUN**

Not executed in this gate (compute budget). Gate D established rotational
convergence for the *hydraulics* on this mesh (1.54% at a=2.5); the adaptation
layer has **not** been rotation-tested. This is item 3 of §27.

## 11. Obstacle study (TEST 3) — **partial pass, artifact identified**

Symmetric building polygon, flux above vs below:

| law | a=4 | a=3 | a=2.5 | L1 vs finest |
|---|---|---|---|---|
| DMK β=1 | 36.36% | **0.39%** | −5.60% | 0.2495 → 0.2172 → 0 |
| Hu–Cai γ=1.5 | 9.01% | −0.62% | −5.14% | 0.1350 → 0.0931 → 0 |

Asymmetry is **not monotonically decreasing**, and both laws land on nearly the
same −5% at the finest mesh. Identical sign and magnitude across two different
adaptation laws points to a **mesh/obstacle-representation artifact, not a
model defect**: the obstacle is carved by deleting enclosed nodes (a staircase
approximation), and the offset rows of an equilateral lattice do not straddle
the obstacle boundary symmetrically at arbitrary `a`. A conforming/cut-cell
obstacle treatment is required — item 2 of §27.

## 12. Two-corridor physical-cost study (TEST 4) — **decisive differentiator**

Upper-corridor flux share as the lower corridor is made physically more
resistant:

| ratio | DMK β=1 | Hu–Cai γ=1.5 |
|---|---|---|
| 1.00 | 0.5054 | 0.4990 |
| 1.05 | 0.5081 | 0.5072 |
| 1.10 | 0.5106 | 0.5150 |
| 1.25 | 0.5151 | 0.5364 |
| 1.50 | 0.5161 | 0.5678 |
| 2.00 | **0.5161** | **0.6171** |

**DMK β=1 saturates**: doubling the physical resistance moves the split by only
1.6 points, and the response is flat from ratio 1.5 onward. Hu–Cai responds
monotonically and ~6× more strongly.

This is explicable: DMK at β=1 is the Wasserstein-1 / optimal-transport regime,
where equilibrium forces `|∇u| = 1` wherever `μ > 0`; physical cost enters
degenerately. Hu–Cai has a genuine pumping-vs-metabolic power-law trade-off.

For an urban design tool, where the entire point is that terrain/road cost
should shape the answer, DMK β=1's insensitivity is disqualifying.

**Caveat:** all cost runs hit the 2500-step cap (`converged: false`), so these
are near-steady, not steady, values. The ~6× gap is far larger than plausible
integration error, but the absolute numbers should not be quoted as final.

## 13. Demand-scale study (TEST 6) — **PASS, analytically confirmed**

| law | mean σ at demand 0.1 / 1 / 10 / 100 | pattern L1 vs demand=1 |
|---|---|---|
| DMK β=1 | 5.921e-4 → 5.921e-3 → 5.921e-2 → 5.921e-1 (**exactly ×10**) | 0.0000 / 0.0004 / 0.0008 |
| Hu–Cai γ=1.5 | 2.03e-3 → 1.48e-2 → 9.53e-2 → 6.03e-1 | 0.0000 / 0.0024 / 0.0028 |

**Magnitude scales, spatial pattern is invariant** — the "intentional
demand-scaling behaviour" the gate required, explicit in the equations rather
than hidden by normalisation.

Hu–Cai's exponent is derivable: equilibrium `|∇u|² = νc^(γ−1)` with `|∇u| ~ S/c`
gives `c ~ S^(2/(γ+1))`. For γ=1.5 that is `S^0.800`; **measured 0.824**
(residual from incomplete convergence).

## 14. Multi-source study — **NOT RUN** (item 4 of §27)

## 15. Initial-condition study — **NOT RUN**

Baseline used a uniform `σ₀ = 1` throughout, deterministically; no random
initialisation anywhere. Multiple-attractor behaviour untested.

## 16. Diffusion / regularisation — literature only, not tested

The tensor Hu–Cai family includes a `D²Δm` diffusion term; the scalar Γ-limit
used here does not require one. No diffusion was added — per the gate's
instruction not to add smoothing for visual reasons.

## 17. Time-discretisation study — **explicit Euler is inadequate for Hu–Cai**

Explicit Euler, dt = 0.02–0.05. Hu–Cai never reached tolerance (maxDelta ≈ 2e-3
after 4000 steps) while DMK converged in 400–4000 steps. My energy-monotonicity
check reported `false` for all runs, but that check was **partly invalid for
DMK**: I evaluated only `∫μ|∇u|²`, whereas the DMK Lyapunov functional also
contains `ℳ_β`. For Hu–Cai the full energy was evaluated and was still
non-monotone.

The literature independently confirms this is expected: explicit discretisation
"puts severe constraints on the time step", while implicit/semi-implicit schemes
"decay the energy unconditionally". Implicit integration is therefore a
**requirement, not an optimisation** — item 1 of §27.

## 18. Mesh-independent metrics used

Conductivity averaged onto **fixed physical bins** (20×12 over the 100×60
domain), area-weighted by `w_e·l_e`, then compared with **normalised L1**
(total-variation distance, range [0,1]). Chosen over Jensen–Shannon because it
is linear in the field, has a direct "fraction of the pattern that moved"
reading, and needs no smoothing of empty bins. Flux compared through fixed
physical cross-section bands. Per-edge medians and active-edge fraction were
deliberately **not** used as primary metrics.

## 19. Candidate comparison

| criterion | DMK (β=1) | Hu–Cai / HKM (γ=1.5) |
|---|---|---|
| literature grounding | strong (Lyapunov, OT theory) | strong + **rigorous Γ-limit on equilateral triangulations** |
| dimensional consistency | ✓ | ✓ |
| needs `J_ref` | no | no |
| hydraulic compatibility | ✓ (Gate D TPFA) | ✓ (Gate D TPFA) |
| mesh-refinement convergence | ✓ (0.336→0.104) | ✓ (0.178→0.068) |
| rotational convergence | not tested | not tested |
| distributed-source robustness | ✓ | ✓ |
| demand scaling | ✓ exactly linear | ✓ `S^(2/(γ+1))`, derived |
| **physical cost response** | **saturates (1.6 pts at ratio 2)** | **monotone (12 pts at ratio 2)** |
| numerical stability (explicit) | converges | stiff, needs implicit |
| obstacle behaviour | artifact at fine mesh | artifact at fine mesh |
| implementation complexity | lower | higher (implicit solver) |

## 20. Selected adaptation law

**Hu–Cai / HKM scalar continuum**, on the strength of §12 (cost sensitivity)
and the rigorous Γ-limit. DMK is retained as a reference implementation — it is
cheaper, converges under explicit Euler, and is a useful cross-check, but its
cost insensitivity makes it unsuitable as the primary Design law.

## 21. Recommended parameters / nondimensional groups

```
law     : ∂c/∂t = |∇u|² − ν c^(γ−1),   −∇·((c+r)∇u) = S
gamma   : 1.5   (p = 2γ/(γ−1) = 6; γ > 1 required for the p-Laplacian result)
nu      : 1     (metabolic coefficient; sets the c scale, not the pattern)
r       : 1e-3  (background conductivity, keeps the elliptic operator non-degenerate)
mesh    : equilateral triangular, w_e = a/√3, l_e = a
sources : fixed physical radius, never single-node
```
These are *research defaults*, validated only in the tests above. `γ` in
particular controls branching character and deserves its own sweep before
production.

## 22. Compatibility with the existing pressure solver — **full reuse**

Every experiment ran against the unmodified `solveHydraulics` by setting
`conductivity := c + r` and `effectiveCost := l_e/w_e`. The CG solver,
Kirchhoff assembly, reference-node handling and Worker protocol need no
changes. The only new production code required is the adaptation step and the
mesh generator.

## 23. Known mathematical limitations

- No continuum limit is claimed for the *project's original Hill law*; it is
  rejected, not ported.
- The scalar Γ-limit is proved for equilateral triangulations; other meshes do
  not inherit it automatically.
- Obstacle boundaries are staircase-approximated (§11).
- `γ > 1` used throughout; the `γ < 1` branching regime of the biological
  literature is outside the p-Laplacian result and untested.
- Steady states of nonlinear gradient flows may be non-unique; §15 untested.

## 24. Performance

All runs are adaptation loops, each step a full CG pressure solve. Meshes 204 –
1134 nodes. DMK: 400–4000 steps. Hu–Cai: capped at 4000 without converging.
Refinement study (3 laws × 4 meshes) ≈ 7 min; obstacle+demand ≈ 10 min; cost
study ≈ 8 min. Implicit integration should reduce step counts by orders of
magnitude, which is also a performance argument, not only a correctness one.

## 25–26. Files / source-tree status

Created (untracked, research only): `scratch/task18-gate-e.ts`, this report.
`src/` unchanged (`git diff -- src/` empty). 281/281 existing tests pass;
`next build` clean; `eslint` reports only unused-variable warnings inside
`scratch/`.

## 27. GO / NO-GO

**GO on the adaptation law.** Gate E's GO criteria 1–4, 6–8, 10 are met:
explicit continuum semantics, dimensional coherence, no raw-edge-flow
normalisation, convergent macroscopic pattern under refinement, distributed-
source robustness, intentional demand scaling, meaningful cost response
(Hu–Cai), no edge/node-count correction anywhere.

**NO-GO on starting production Design Mode implementation now.** Criterion 5
(rotational convergence of the adaptation) is untested and criterion 9 (stable
obstacle behaviour) shows a representation artifact. Four concrete items:

1. **Implicit / semi-implicit time integration** for Hu–Cai — a correctness
   requirement, corroborated by the literature, not a tuning knob.
2. **Conforming or cut-cell obstacle representation** to replace node deletion.
3. **Rotation study of the adaptation** (0–90°, two resolutions), mirroring
   Gate D's hydraulic isotropy test.
4. **Multi-source / relative-demand study**, closing the Task 17 property in
   the continuum setting.

These are well-defined and bounded. I recommend one final short gate covering
them rather than folding them into the Design Mode build, on the same reasoning
that has held through Gates B–E: each time we tested an assumption instead of
implementing it, we found a real defect.

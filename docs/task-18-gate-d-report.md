# Task 18 Gate D — Continuum-Consistent Design Formulation

Verdict: **GO** for a continuum (finite-volume) hydraulic foundation for Design
Mode — with the explicit caveat that this gate validated **hydraulics only**.
The adaptation law is *not* yet validated and must be its own gate.

All numbers from real runs of `scratch/task18-gate-d.ts` against the
**unmodified** production `solveHydraulics`. `src/` untouched.

## 1. Literature findings

The relevant family is Darcy-type / adaptive-transport continuum models:

- **Tero-style discrete Physarum**: edge = physical tube, `D` = tube
  conductance numerator. Explicitly a *network* model; no claim of a mesh
  continuum limit.
- **Hu–Cai adaptive transport**: conductivity evolution on a network with a
  cost/energy functional.
- **Haskovec / Kreusser / Markowich**: discrete-to-continuum limit work for
  adaptive transport networks, deriving PDE limits of discrete network models.
- **Finite-volume TPFA** (two-point flux approximation) and **FEM stiffness**
  discretizations of `−div(σ ∇p) = s`.

Answering the specific questions asked:
1. Discrete edge conductivity in *our current* model is a tube conductance
   numerator, not a field value.
2. Edge length enters as `conductance = D / l`.
3. A dual/interface measure (`w_e`) is **absent** from the current model — this
   is precisely the missing term.
4. Source terms in a continuum are densities; a fixed magnitude pinned to one
   node is not a conservative discretization (see §9).
5. For continuum convergence the conductivity variable must be a *density*
   (`σ`), with geometry carried by `w_e/l_e`.
6. **Not applicable**: I found no result proving that *our specific Hill
   adaptation law* has a rigorous continuum limit. I do **not** claim one. The
   hydraulic side is standard; the adaptation side remains an open question.

## 2. Discrete vs continuum interpretation

```
ANALYZE : edge = real road/bridge/path        → tube semantics are correct
DESIGN  : edge = element of a discretized 2D field → tube semantics are wrong
```

The mesh is **not** a proposed road network. It is a numerical discretization
of physical space. This distinction is the core of Gate D.

## 3–4. Dimensional analysis and the meaning of σ

```
p   : potential                    [P]
j   : flux density                 [Q · m⁻¹]   (flow per unit transverse width)
σ   : conductivity density         [Q · m · P⁻¹ · m⁻¹] → field value, NOT per-edge tube size
s   : source density               [Q · m⁻²]
```

Answer to the "critical variable semantics" question: **option B**. In the
Design formulation `D` must mean **conductivity density σ**, not an edge
conductance numerator. A variable whose meaning changes with mesh resolution is
unacceptable, and `D`-as-tube-conductance is exactly such a variable.

## 5. Geometry / transmissibility derivation

```
G_e = σ_e · w_e / l_e        (two-point flux approximation)
Q_e = G_e · (P_i − P_j)
j_e = Q_e / w_e = σ_e · (P_i − P_j) / l_e      → discrete form of j = −σ∇p
```

Why this fixes both failures, analytically, for a homogeneous domain W×L at
mesh size h:

```
parallel paths N_w = W/h,  series resistors N_l = L/h
current model (no width):  G = N_w · D/(h·N_l) = (W/h)·D/L   → diverges as h→0
TPFA (w=l=h):              G = N_w · σ/N_l     = σ·W/L       → h cancels exactly
```

## 6. Series subdivision (hydraulics) — **PASS, exact**

Corridor L=100, W=10, σ=1; expected R = L/(σW) = 10.

| segments | R_total | rel. error |
|---|---|---|
| 1 | 10.000000000 | 0 |
| 5 | 10.000000000 | 0 |
| 20 | 10.000000000 | 0 |
| 50 | 10.000000000 | −8.9e−16 |
| 100 | 10.000000000 | −1.2e−15 |

Machine precision. This is the property local-throughput normalization failed
(Gate C.1: up to 5.15% asymmetry).

## 7. Parallel width refinement — **PASS, exact**

Same corridor, total width W=10 split into S strips of width W/S:

| strips | R_total | rel. error |
|---|---|---|
| 1 | 10.000000000 | 0 |
| 2 | 10.000000000 | 0 |
| 5 | 10.000000000 | 0 |
| 10 | 10.000000000 | 0 |
| 20 | 10.000000000 | 0 |

Machine precision. This is the property global-demand normalization failed
(Gate B: 3.5× median-D drift).

**Both invariances hold simultaneously — for the first time in this project.**

## 8. Homogeneous sheet refinement (2D)

Domain 100×60, σ=1. Reported value is `G·L_eff/W`, which must equal 1.

| mesh | h | nodes | edges | G·L_eff/W |
|---|---|---|---|---|
| square-4 | 10 | 60 | 104 | **1.000000** |
| square-4 | 6 | 170 | 313 | **1.000000** |
| square-4 | 4 | 375 | 710 | **1.000000** |
| square-4 | 3 | 660 | 1267 | **1.000000** |
| square-4 | 2 | 1500 | 2920 | **1.000000** |
| triangular | 10 | 74 | 187 | 1.049017 |
| triangular | 6 | 204 | 555 | 1.015430 |
| triangular | 4 | 459 | 1291 | 1.011095 |
| triangular | 3 | 804 | 2298 | 1.008403 |

The 5-point Laplacian is *exact* for an axis-aligned rectangular domain (best
case for square). The triangular mesh converges monotonically; its residual
error is dominated by its ragged offset-row boundary, not by the interior
operator.

## 9. Source discretization — **critical practical finding**

Domain 120×120, sink ring on the boundary, source either a fixed-physical-radius
disk (r=8) or a single snapped node:

| h | distributed disk (r=8) | single snapped node |
|---|---|---|
| 6 | 0.435054 | 0.640321 |
| 4 | 0.391991 | 0.707984 |
| 3 | 0.378716 | 0.755431 |
| 2 | **0.382771** (converging ≈0.38) | **0.821693** (diverging) |

The single-node source exhibits the textbook 2D logarithmic point-source
singularity: fitting `R ≈ const + k·ln(1/h)` gives **k ≈ 0.165**, against the
theoretical `1/2πσ = 0.159`. It never converges.

**Consequence for Design Mode: markers must have a fixed physical support
radius.** Snapping a demand marker to one mesh node — which is what the Gate C.1
brief's terminal-snapping design assumed — makes the result permanently
resolution-dependent. This changes the terminal model.

## 10. Mesh representation comparison — center-split is **disqualified**

Analytical and numerical check of the planar center-split square lattice
accepted in Gate C.1:

```
Orthogonal grid edge (0,0)-(h,0):
  circumcentre of triangle above = [0.5, 0]
  circumcentre of triangle below = [0.5, 0]     ← coincident
  Voronoi dual edge length w_e   = 0
  transmissibility w_e/l_e       = 0            ← DEGENERATE
Spoke edge (0,0)-(h/2,h/2): w/l  = 1.000000
```

The four points (two grid corners + the two adjacent cell centres) are
**cocircular**, so the two triangles sharing an orthogonal grid edge have
coincident circumcentres. Under a Voronoi/TPFA discretization every orthogonal
grid edge carries **exactly zero flux**; the lattice collapses to a
diagonal-only mesh.

The Gate C.1 mesh decision is therefore **withdrawn** for the continuum
formulation. It was selected on Dijkstra stretch, which measured the wrong
property.

## 11. Finite-volume vs finite-element

**Chosen: finite-volume TPFA** (`w_e/l_e` transmissibilities).

| | conservation | isotropy | positivity | mesh requirement | complexity |
|---|---|---|---|---|---|
| TPFA | exact, local | mesh-dependent, converges | positive for Delaunay/orthogonal meshes | needs K-orthogonality (Delaunay/Voronoi) | low |
| FEM (P1 stiffness) | exact globally | slightly better on skewed meshes | can go negative on obtuse triangles | conforming triangulation | higher |

TPFA is sufficient, has locally conservative fluxes, maps onto the existing
sparse solver with zero changes, and keeps weights positive on both candidate
meshes. No framework needed.

## 12. Rotational isotropy — the redefined directional-bias test

Source/sink disks (r=8) at distance 60 in a 200×200 homogeneous domain, rotated
0°–90°. Spread = (max−min)/mean of effective resistance.

| mesh | h | spread | (old Dijkstra stretch) |
|---|---|---|---|
| square-4 | 4 | 7.52% | 41.4% |
| square-4 | 2.5 | **2.97%** | — |
| triangular | 4 | 2.83% | 15.4% (hex-6) |
| triangular | 2.5 | **1.54%** | — |

Both **converge toward isotropy under refinement** — the required property.
Triangular is consistently ~2× better at equal h. All meshes agree on the
physical value (R ≈ 0.775), confirming they discretize the same continuum
problem.

This completely reorders the Gate-C.1-era ranking and confirms that
Dijkstra stretch was the wrong criterion for a field solver.

## 13. Flux density definition

`j_e = Q_e / w_e = σ_e (P_i − P_j) / l_e`, units [Q·m⁻¹]. Invariant under both
series subdivision (l and ΔP scale together) and lateral refinement (Q and w
scale together) — the two properties that broke every previous formulation.

## 14–15. Adaptation law and J_ref — **NOT tested in this gate**

Per the gate instruction ("ONLY after hydraulic mesh consistency is
established"), adaptation was deliberately not implemented or benchmarked. I am
**not** recommending a specific `F` or `J_ref` on the basis of this gate.

What the dimensional analysis does establish:
- the adaptation state variable must be `σ` (a density), not `D` (a tube size);
- `J_ref` must have units of flux density [Q·m⁻¹], so a candidate of the form
  `J_ref ~ Q_ref / L_char` is *dimensionally* admissible, where `L_char` is a
  physical length of the problem (e.g. the source support width, or the
  source–sink separation) — **not** `sqrt(area)` chosen for unit convenience,
  and **not** any edge/node count;
- whether `Hill(|j|/J_ref)` yields a mesh-convergent adaptive steady state is
  an open question that requires the same battery of tests applied here.

## 16. Obstacle refinement — not run

Obstacle macro behaviour is an adaptation-level question; deferred with §14–15.

## 17. Demand-scale behaviour

The hydraulic operator is linear, so scaling all sources/sinks by `c` scales all
`Q` and `j` by `c` and leaves pressures proportional — demand-scale behaviour is
exact and trivial at the hydraulic level. Whether the *adaptation* preserves it
depends on `J_ref` (§15) and is untested.

## 18. Compatibility with the existing pressure solver — **full reuse, zero changes**

`solveHydraulics` computes `conductance = conductivity / effectiveCost`.
Setting `conductivity := σ_e` and `effectiveCost := l_e / w_e` yields exactly
`σ_e · w_e / l_e`. Every Gate D experiment above ran against the **unmodified**
production solver. Only the *interpretation* of two fields changes; the CG
solver, Kirchhoff assembly, reference-node handling and Worker protocol are
untouched.

## 19. Performance

All Gate D tests are single hydraulic solves (no adaptation loop) and complete
in seconds, including the 3600-node source study and the 6400-node isotropy
meshes. Cost will be dominated by the adaptation loop once that exists — as it
was in Gates B/C.

## 20. Known mathematical limitations

- TPFA requires K-orthogonal meshes; it is consistent on Delaunay/Voronoi and
  orthogonal grids, and would lose consistency on arbitrary skewed meshes.
- The triangular mesh's boundary is ragged; its sheet-test residual is boundary-,
  not operator-dominated. A conforming boundary treatment is future work.
- **No continuum limit is claimed for the Hill adaptation law.** This gate
  establishes only that the *hydraulic* discretization is consistent.
- Anisotropy does not vanish at finite h; it converges. A resolution envelope
  must be chosen against an accuracy target.

## 21–22. Files / source tree

Created (untracked, research only): `scratch/task18-gate-d.ts`, this report.
`src/` unchanged — `git diff -- src/` empty. 281/281 existing tests pass;
`next build` clean; `eslint` reports only unused-variable warnings inside
`scratch/`.

## 23. GO / NO-GO

**GO** for the continuum finite-volume hydraulic foundation:

```
conductance  G_e = sigma_e * w_e / l_e      (TPFA)
flux density j_e = Q_e / w_e
state var        sigma (conductivity density), NOT tube D
mesh             NOT center-split square (degenerate);
                 square-4 or triangular, triangular preferred on isotropy
sources          fixed physical support radius, NEVER single-node snapping
solver           existing pressure solver, unchanged
```

Acceptance checklist from the brief: (1) series subdivision ✓ exact,
(2) lateral refinement ✓ exact, (3) conservative sources ✓ (distributed;
point-source divergence characterised), (4) convergent homogeneous sheet ✓,
(5) improving rotational behaviour ✓, (6) meaningful variable semantics ✓
(σ as density), (7) no edge/node-count correction ✓ (pure geometry),
(8) stable obstacle macro behaviour — **not tested** (adaptation-level).

**Recommended next gate: Gate E — continuum adaptation law.** Do not proceed to
Design Mode implementation until `dσ/dt = f(|j|/J_ref) − μσ` is subjected to the
same invariance battery (series, lateral, rotation, obstacle, demand scale)
that this gate applied to the hydraulics.

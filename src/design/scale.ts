import type { PreparedNetwork } from "../scenario/types";
import type { DesignAdaptationParameters } from "./adaptation";

/**
 * Explicit scale for the continuum Design model.
 *
 * ## Why this exists
 *
 * The v1 parameters took their meaning by accident from metres, from a total
 * demand of 1, and from `nu = 1` carrying gamma-dependent units. Gate G
 * measured the consequence: the equilibrium landed at c ~ 1e-3..1e-2, the
 * background regularizer r = 1e-3 stopped being a perturbation, and roughly
 * 55% of the flux ran where the regularizer beat the adapted field.
 *
 * ## Dimensions
 *
 * With `G_e = (c_e + r) w_e / l_e` and `w_e / l_e` dimensionless, `c` carries
 * the dimensions of a conductance, [Q]/[P]. From `q = c w |grad u|` the flux
 * scale follows, and from `dc/dt = |grad u|^2 - nu c^(gamma-1)`:
 *
 *   [T]  = [c][L]^2 [P]^-2 ,      [nu] = [c]^(1-gamma) [P]^2 [L]^-2
 *
 * `nu` therefore has gamma-dependent units. That is the tell that it is not a
 * free physical constant: it is where a conductivity scale has been hidden.
 *
 * ## The fix
 *
 * Prescribe the conductivity scale C0 and DERIVE nu from it. Eliminating the
 * gradient in favour of the flux, the discrete equilibrium is
 *
 *   q_e = w_e sqrt(nu) c_e^((gamma+1)/2)   =>   c_e = (q_e / (w_e sqrt(nu)))^(2/(gamma+1))
 *
 * so demanding that an edge of width L0 carrying the whole demand Q0 sit at
 * exactly C0 gives
 *
 *   nu = Q0^2 / (L0^2 * C0^(gamma+1))
 *
 * This is derived from the equation and from prescribed quantities only. It is
 * NOT fitted to an observed c_max, which would be circular: C0 is a reference
 * scale, not a prediction of the maximum.
 *
 * ## C0 is a gauge
 *
 * Once r, c_min, c_init and dt are all expressed as ratios to C0, the absolute
 * value of C0 cancels exactly. Substituting c = lambda * c_hat and rescaling
 * nu -> nu/lambda^(gamma+1), dt -> lambda^3 dt (which is what holding the
 * dimensionless groups fixed does), the IMEX step reproduces itself:
 *
 *   numerator    lambda*c + lambda^3 dt (g/lambda)^2        = lambda (c + dt g^2)
 *   denominator  1 + lambda^3 dt (nu/lambda^(gamma+1)) (lambda c)^(gamma-2) = 1 + dt nu c^(gamma-2)
 *
 * (pressures scale as 1/lambda because every conductance scales by lambda).
 * `scale.test.ts` asserts this numerically. It is why only the ratios
 * below are science; C0 itself is bookkeeping.
 */
export const DESIGN_MODEL_VERSION = "design-hucai-v2" as const;

export type DesignScale = {
  /**
   * L0, metres: the square root of the Design domain area.
   *
   * From designScaleFromArea this is the AOI directly. From
   * designScaleFromNetwork it is summed over mesh elements, and its
   * independence from resolution is then a measured property rather than a
   * definition: across 250..80 m spacing on a 3600 m square the spread is 1.0%
   * and it recovers sqrt(AOI area) to within 1%. Asserted in scale.test.ts.
   */
  readonly lengthMeters: number;
  /** Q0: total positive demand. */
  readonly demand: number;
  /** C0: prescribed conductivity unit. A gauge — see the note above. */
  readonly conductivity: number;
};

/** Everything that is actually science. Each entry is dimensionless. */
export type DesignDimensionlessParameters = {
  readonly gamma: number;
  /** dt_hat = dt * nu * C0^(gamma-2) — the group that appears in the IMEX denominator. */
  readonly timeStep: number;
  /** eps_r = r / C0. */
  readonly backgroundRatio: number;
  /** eps_min = c_min / C0. */
  readonly minimumRatio: number;
  /** c0_hat = c_init / C0. */
  readonly initialRatio: number;
  /** Relative: the run stops when max|dc| / C0 falls below this. */
  readonly convergenceTolerance: number;
  readonly maxIterations: number;
  /**
   * Minimum dimensionless elapsed time, t_hat = iterations * dt_hat, before a
   * run may report convergence. Guards the Gate G failure mode where a
   * mis-scaled dt made the very first step tiny and the untouched initial
   * condition was reported as converged.
   */
  readonly minimumElapsed: number;
};

/**
 * Scale from the physical Design domain.
 *
 * This is the form to use whenever barriers are involved. `L0` must describe
 * the AOI, not the unblocked remainder: otherwise adding buildings shrinks the
 * meshed area, `nu` moves with it, and an A/B comparison silently recalibrates
 * the model instead of only changing the geometry available to the flow.
 * Barriers change where the flow may go; they must not change the scale it is
 * measured in.
 */
export function designScaleFromArea(areaSquareMeters: number, demand: number, conductivityUnit = 1): DesignScale {
  if (!(areaSquareMeters > 0) || !Number.isFinite(areaSquareMeters)) throw new Error("Design scale needs a positive domain area.");
  if (!(demand > 0) || !Number.isFinite(demand)) throw new Error("Design scale needs positive total demand.");
  if (!(conductivityUnit > 0) || !Number.isFinite(conductivityUnit)) throw new Error("Design conductivity unit must be finite and positive.");
  return { lengthMeters: Math.sqrt(areaSquareMeters), demand, conductivity: conductivityUnit };
}

/**
 * Scale inferred from a prepared network's own elements.
 *
 * Only valid when nothing has been removed from the mesh — the sum runs over
 * the edges the network still has, so with barriers present it measures the
 * unblocked remainder. Prefer `designScaleFromArea` in that case;
 * `assembleDesignNetwork` returns the correct scale directly.
 */
export function designScaleFromNetwork(network: PreparedNetwork, conductivityUnit = 1): DesignScale {
  let doubledArea = 0;
  for (const edge of network.edges) {
    // w_e = l_e / effectiveCost.
    if (!(edge.effectiveCost > 0) || !(edge.lengthMeters > 0)) continue;
    doubledArea += (edge.lengthMeters * edge.lengthMeters) / edge.effectiveCost;
  }
  // For a Voronoi/Delaunay pair the kite spanned by an edge and its dual has
  // area w_e*l_e/2, and those kites tile the domain exactly once — so the sum
  // above is twice the meshed area. (The same factor 2 rides along in the
  // energy integral in `stepDesignField`, where it is a constant multiplier and
  // affects neither monotonicity nor any comparison.)
  const area = doubledArea / 2;
  const demand = network.terminals.reduce((sum, terminal) => (terminal.role === "source" ? sum + terminal.magnitude : sum), 0);
  if (!(area > 0)) throw new Error("Design scale needs a mesh with positive area.");
  if (!(demand > 0)) throw new Error("Design scale needs positive total demand.");
  if (!(conductivityUnit > 0) || !Number.isFinite(conductivityUnit)) throw new Error("Design conductivity unit must be finite and positive.");
  return { lengthMeters: Math.sqrt(area), demand, conductivity: conductivityUnit };
}

/** nu = Q0^2 / (L0^2 C0^(gamma+1)) — derived, never fitted to a run. */
export function metabolicCoefficient(scale: DesignScale, gamma: number): number {
  if (!(gamma > 1)) throw new Error("Design gamma must exceed 1.");
  return (scale.demand * scale.demand) / (scale.lengthMeters * scale.lengthMeters * scale.conductivity ** (gamma + 1));
}

/** Inverts dt_hat = dt * nu * C0^(gamma-2). */
export function timeStepFromDimensionless(scale: DesignScale, gamma: number, dimensionlessTimeStep: number): number {
  const nu = metabolicCoefficient(scale, gamma);
  return dimensionlessTimeStep / (nu * scale.conductivity ** (gamma - 2));
}

/** Turns the dimensionless science into the dimensional parameters the solver takes. */
export function toAdaptationParameters(scale: DesignScale, parameters: DesignDimensionlessParameters): DesignAdaptationParameters {
  const { gamma } = parameters;
  const nu = metabolicCoefficient(scale, gamma);
  return {
    gamma,
    nu,
    backgroundConductivity: parameters.backgroundRatio * scale.conductivity,
    minimumConductivity: parameters.minimumRatio * scale.conductivity,
    initialConductivity: parameters.initialRatio * scale.conductivity,
    timeStep: timeStepFromDimensionless(scale, gamma, parameters.timeStep),
    convergenceTolerance: parameters.convergenceTolerance * scale.conductivity,
    maxIterations: parameters.maxIterations,
  };
}

/** Dimensionless elapsed time after `iterations` steps. */
export function elapsedDimensionlessTime(parameters: DesignDimensionlessParameters, iterations: number): number {
  return iterations * parameters.timeStep;
}

/**
 * Design-v2 parameter set, selected in Task 18 Gate H.
 *
 * `backgroundRatio` and `timeStep` come from a joint sweep, because the two
 * interact. The regularizer is not only an ellipticity guard: because the
 * hydraulic solve sees `c + r`, a large r also damps the nonlinear feedback of
 * the adaptation loop. With r made negligible the IMEX iteration stops
 * reaching a fixed point and settles into a limit cycle whose amplitude grows
 * with the timestep — measured at 0.4% of c_max at dt_hat = 1, 11% at 5 and
 * 212% at 20.
 *
 * At eps_r = 1e-3 with dt_hat = 0.25 the iteration reaches a true fixed point
 * (residual change ~1e-11) while the field is indistinguishable from an
 * eps_r = 1e-6 reference (JS 0.003, identical 80%-flux width to the metre) and
 * under 0.1% of the flux runs where the background beats the adapted field.
 * v1 sat at an effective eps_r of ~1e-1, where the width is inflated ~15% and
 * ~10% of the flux is carried by the regularizer.
 *
 * CG cost is nearly flat across this range — the Jacobi-preconditioned solve
 * took 129-143 iterations for eps_r from 1e-1 down to 1e-6 — so the binding
 * constraint is the nonlinear iteration, not the linear algebra. The
 * theoretical (c_max + r)/r condition-number trend does not predict the
 * measured behaviour and was not used to choose anything here.
 */
export const DESIGN_V2: DesignDimensionlessParameters = {
  gamma: 1.5,
  timeStep: 0.25,
  backgroundRatio: 1e-3,
  minimumRatio: 1e-9,
  initialRatio: 1,
  convergenceTolerance: 1e-6,
  maxIterations: 4_000,
  minimumElapsed: 1,
};

/** Design-v2 parameters at an explicit scale. Preferred whenever barriers exist. */
export function designV2Parameters(scale: DesignScale, overrides: Partial<DesignDimensionlessParameters> = {}): DesignAdaptationParameters {
  return toAdaptationParameters(scale, { ...DESIGN_V2, ...overrides });
}

/**
 * Design-v2 parameters with the scale inferred from the network itself.
 * Only correct for an unmasked mesh — see .
 */
export function resolveDesignV2(network: PreparedNetwork, overrides: Partial<DesignDimensionlessParameters> = {}): DesignAdaptationParameters {
  return designV2Parameters(designScaleFromNetwork(network), overrides);
}

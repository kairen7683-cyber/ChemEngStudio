/**
 * Pressure Safety Valve (PSV) Solver (API 521 Scenarios + API 520 Part I & II + API 526 D~T)
 *
 * Strictly unifies & upgrades ChemPro `solvePSV`:
 *   1. API 521 Relief Scenarios & Multi-Scenario Governing Case Evaluator:
 *      - `blocked_outlet`, `fire_case` (7.6 m elevation cutoff + F_env insulation),
 *        `tube_rupture` (10/13 rule + double-ended tube break), `thermal_exp`,
 *        `power_failure`, `cw_failure`, `reflux_failure`.
 *   2. API 520 Part I Sizing Equations & Backpressure / Overpressure Factors:
 *      - Valve types: `conventional`, `balanced_bellows`, `pilot`
 *      - Accurate API 520 Fig. 30 (Kb), Fig. 31 (Kw), Fig. 32 (Kp), Sec. 5.8 (Kv),
 *        Napier (Kn), Superheat (Ksh), Rupture Disk (Kc)
 *      - Vapor/Gas Critical (Choked Sonic) & Subcritical (F2)
 *      - Steam (Kn + Ksh)
 *      - Liquid with ITERATIVE Reynolds-number viscosity correction Kv(Re)
 *      - Two-Phase Flashing via API 520 Annex C Leung Omega Method (`phase: 'twophase'`)
 *   3. API 520 Part II Piping & Installation Checks:
 *      - Inlet non-recoverable pressure drop (3% rule check at rated capacity)
 *      - Discharge reaction force F_R (N & kgf), outlet Mach number, acoustic noise (dBA @ 30m)
 *   4. API 526 Standard Orifices D through T via `getApi526Orifices()`.
 */

import {
  type Api526Orifice,
  getApi526Orifices,
  resolveFluidProps,
} from './chemproFluidBridge';

export type PSVSolverMode = 'quick' | 'rigorous';
export type PSVScenario =
  | 'blocked_outlet'
  | 'fire_case'
  | 'tube_rupture'
  | 'thermal_exp'
  | 'power_failure'
  | 'cw_failure'
  | 'reflux_failure'
  | string;
export type PSVPhase = 'vapor' | 'steam' | 'liquid' | 'twophase' | string;
export type PSVValveType = 'conventional' | 'balanced_bellows' | 'pilot';

export interface PSVDesignInput {
  equipTag?: string;
  equipName?: string;
  scenario?: PSVScenario;
  phase?: PSVPhase;
  fluidId?: string;
  W_kgh?: number;
  P_set_barG?: number;
  P_back_barG?: number;
  /** Superimposed (constant/variable) backpressure in barG */
  superimposed_backpress_barG?: number;
  /** Built-up backpressure during relief in barG */
  builtup_backpress_barG?: number;
  patm_bar?: number;
  overpress_pct?: number;
  T_rel_C?: number;
  mw?: number;
  k_cpcv?: number;
  Z_comp?: number;
  rhoL?: number;
  mu_cP?: number;
  hv_kJkg?: number;
  A_wet_m2?: number;
  F_env?: number;
  has_rupture_disk?: boolean;
  is_balanced_bellows?: boolean;
  /** Valve type per API 520 Part I (overrides is_balanced_bellows when provided) */
  valve_type?: PSVValveType;

  /** Optional trapped heat input (kW) for thermal_exp auto-sizing when W_kgh omitted */
  dQ_kW?: number;
  /** Volumetric thermal expansion coefficient (1/K) for thermal_exp */
  alpha_cub_K?: number;
  /** Liquid heat capacity (kJ/(kg·K)) for thermal_exp & two-phase Omega */
  cp_kJkgK?: number;

  // ── API 520 Annex C Two-Phase Flashing (Leung Omega) inputs ─────────────
  /** Inlet vapor mass fraction x0 (0 = saturated/subcooled liquid, 0..1 = two-phase) */
  vapor_mass_frac?: number;
  /** Liquid density at relieving conditions (kg/m³), falls back to rhoL */
  rhoL_kgm3?: number;
  /** Vapor density at relieving conditions (kg/m³), auto-estimated from EOS if omitted */
  rhoV_kgm3?: number;
  /** Liquid specific heat at relieving conditions (kJ/(kg·K)), falls back to cp_kJkgK */
  cpL_kJkgK?: number;
  /** Saturation (bubble-point) pressure at inlet temperature (barA) for subcooled flashing */
  sat_press_barA?: number;

  // ── API 520 Part II Piping & Installation inputs ────────────────────────
  inlet_pipe_id_mm?: number;
  inlet_pipe_len_m?: number;
  inlet_k_fittings?: number;
  outlet_pipe_id_mm?: number;
  outlet_pipe_len_m?: number;
  pipe_roughness_mm?: number;
}

export interface PSVIterationRow {
  iter: number;
  param: string;
  assumed: string;
  calc: string;
  err: string;
  note: string;
}

export interface PSVWarningItem {
  level: 'danger' | 'warn' | 'ok';
  text: string;
}

export interface PSVPipingCheckResult {
  inlet_pipe_id_mm: number;
  inlet_pipe_len_m: number;
  inlet_k_fittings: number;
  inlet_vel_ms: number;
  inlet_dp_bar: number;
  inlet_dp_pct_pset: number;
  inlet_3pct_pass: boolean;
  outlet_pipe_id_mm: number;
  outlet_pipe_len_m: number;
  outlet_vel_ms: number;
  outlet_mach: number;
  reaction_force_N: number;
  reaction_force_kgf: number;
  noise_dBA_30m: number;
  is_inferred_geometry: boolean;
}

export interface PSVDesignResult {
  // ── Exact ChemPro `solvePSV` contract keys ─────────────────────────────
  equipTag: string;
  equipName: string;
  scenario: string;
  phase: string;
  W_kgh: number;
  W_rated_kgh: number;
  Q_fire_kW: number;
  P_set_barG: number;
  P_back_barG: number;
  P1_barA: number;
  P2_barA: number;
  overpress_pct: number;
  r_crit: number;
  backPressRatio: number;
  isCritical: boolean;
  A_req_mm2: number;
  A_req_in2: number;
  selectedOrifice: Api526Orifice;
  cap_utilization_pct: number;
  iterations: PSVIterationRow[];
  warnings: PSVWarningItem[];

  // ── Rigorous API 520 / 521 / 526 diagnostic fields ─────────────────────
  valve_type: PSVValveType;
  superimposed_backpress_barG: number;
  builtup_backpress_barG: number;
  Kd: number;
  Kb: number;
  Kw: number;
  Kc: number;
  Kp: number;
  Kv: number;
  Kn: number;
  Ksh: number;
  C_api: number;
  F2: number;
  F_env: number;
  Re_orifice: number;
  parallelCount: number;
  mode: PSVSolverMode;

  // ── API 520 Annex C Two-Phase Leung Omega outputs ──────────────────────
  omega?: number;
  eta_crit?: number;
  massFlux_kgm2s?: number;
  isSubcooledFlashing?: boolean;

  // ── API 520 Part II Piping & Installation outputs ──────────────────────
  pipingCheck: PSVPipingCheckResult;
}

// ── Multi-Scenario & API 521 Helper Types ──────────────────────────────────

export interface FireWettedAreaInput {
  vesselDiaM: number;
  vesselTanToTanM: number;
  orientation: 'horizontal' | 'vertical' | 'sphere';
  /** Normal liquid level fraction (0..1) */
  liquidLevelFrac?: number;
  /** Bottom tangent/shell elevation above grade / fire source (m). API 521 cutoff = 7.6 m (25 ft) */
  elevationAboveGradeM?: number;
  /** Insulation thickness in mm (0 = bare, 25, 50, 100) for F_env estimation */
  insulationThicknessMm?: number;
  /** Head geometry for cylindrical vessels (default 2:1 ellipsoidal) */
  headType?: 'ellipsoidal_2to1' | 'hemispherical' | 'flat';
}

export interface FireWettedAreaResult {
  wettedAreaM2: number;
  totalLiquidWettedAreaM2: number;
  effectiveFireHeightM: number;
  elevationCutoffApplied: boolean;
  F_env: number;
  Q_fire_kW: number;
}

export interface TubeRuptureInput {
  P_high_barG: number;
  P_low_design_barG: number;
  tubeIdMm: number;
  /** High-pressure fluid density (kg/m³) for liquid, or auto-estimated for vapor */
  rho_kgm3?: number;
  phase?: 'liquid' | 'vapor';
  /** Orifice discharge coefficient for broken tube ends (default 0.62) */
  cd?: number;
  /** Vapor properties if high-pressure side is gas/vapor */
  mw?: number;
  T_C?: number;
  k_cpcv?: number;
  Z_comp?: number;
  patm_bar?: number;
}

export interface TubeRuptureResult {
  passes10_13Rule: boolean;
  minDesignPressFor10_13_barG: number;
  pressureRatioLowToHigh: number;
  doubleBreakArea_mm2: number;
  reliefRate_kgh: number;
  recommendation: string;
}

export interface PSVScenarioCaseInput extends PSVDesignInput {
  caseId?: string;
  caseLabel?: string;
}

export interface PSVScenarioCaseSummary {
  caseId: string;
  caseLabel: string;
  scenario: string;
  phase: string;
  W_kgh: number;
  P_set_barG: number;
  overpress_pct: number;
  A_req_mm2: number;
  selectedOrifice: Api526Orifice;
  cap_utilization_pct: number;
  isGoverning: boolean;
  result: PSVDesignResult;
}

export interface PSVGoverningScenarioResult {
  governing: PSVScenarioCaseSummary;
  governingIndex: number;
  selectedOrifice: Api526Orifice;
  cases: PSVScenarioCaseSummary[];
  warnings: PSVWarningItem[];
}

// ── Helper Functions ───────────────────────────────────────────────────────

function lerpTable(x: number, points: ReadonlyArray<[number, number]>): number {
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / Math.max(1e-12, x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * API 520 Part I Fig. 30: Backpressure Correction Factor Kb for Balanced Bellows PRVs (Gas/Steam/Two-Phase)
 * Input: pctBackpress = (P_back_barG / P_set_barG) * 100
 */
function calcApi520Kb(
  valveType: PSVValveType,
  pctBackpress: number,
  overpressPct: number,
): number {
  if (valveType === 'conventional') return 1.0;
  if (valveType === 'pilot') {
    // Pilot-operated PRVs maintain Kb = 1.0 up to ~50-70% backpressure (critical flow)
    return 1.0;
  }
  // Balanced bellows — API 520 Part I Fig. 30 curves
  // 10% overpressure curve
  const kb10: ReadonlyArray<[number, number]> = [
    [0, 1.0],
    [30, 1.0],
    [35, 0.965],
    [40, 0.90],
    [45, 0.81],
    [50, 0.70],
    [55, 0.59],
    [60, 0.48],
  ];
  // 21% overpressure curve (fire case)
  const kb21: ReadonlyArray<[number, number]> = [
    [0, 1.0],
    [35, 1.0],
    [40, 0.955],
    [45, 0.885],
    [50, 0.795],
    [55, 0.69],
    [60, 0.58],
  ];
  const v10 = lerpTable(Math.max(0, pctBackpress), kb10);
  const v21 = lerpTable(Math.max(0, pctBackpress), kb21);
  const blend = Math.max(0, Math.min(1, (overpressPct - 10) / 11));
  return Math.max(0.45, Math.min(1.0, v10 + blend * (v21 - v10)));
}

/**
 * API 520 Part I Fig. 31: Backpressure Correction Factor Kw for Balanced Bellows PRVs (Liquid Service)
 */
function calcApi520Kw(valveType: PSVValveType, pctBackpress: number): number {
  if (valveType === 'conventional') return 1.0;
  if (valveType === 'pilot') return 1.0;
  // Balanced bellows liquid curve (Kw = 1.0 below 15%, smooth derating 15–50%)
  const kwCurve: ReadonlyArray<[number, number]> = [
    [0, 1.0],
    [15, 1.0],
    [20, 0.975],
    [25, 0.94],
    [30, 0.895],
    [35, 0.84],
    [40, 0.77],
    [45, 0.69],
    [50, 0.60],
    [55, 0.52],
    [60, 0.45],
  ];
  return Math.max(0.45, Math.min(1.0, lerpTable(Math.max(0, pctBackpress), kwCurve)));
}

/**
 * API 520 Part I Fig. 32: Overpressure Correction Factor Kp for Liquid Relief Valves
 * (0.6 at 10% OP, 1.0 at 25% OP, smoothly interpolated)
 */
function calcApi520Kp(phase: PSVPhase, overpressPct: number): number {
  if (phase !== 'liquid') return 1.0;
  const kpCurve: ReadonlyArray<[number, number]> = [
    [5, 0.45],
    [10, 0.6],
    [15, 0.78],
    [20, 0.9],
    [25, 1.0],
  ];
  return Math.max(0.45, Math.min(1.0, lerpTable(overpressPct, kpCurve)));
}

/**
 * Steam saturation temperature (°C) from absolute pressure (barA) via Antoine correlation
 * and API 520 Table 9 superheat correction factor Ksh.
 */
function calcSteamKsh(P1_barA: number, T_rel_C: number): { Tsat_C: number; Ksh: number } {
  const P_safe = Math.max(0.1, P1_barA);
  // Water Antoine constants (bar, K)
  const Tsat_K = 3816.44 / (11.6834 - Math.log(P_safe)) + 46.13;
  const Tsat_C = Tsat_K - 273.15;
  const superheatC = Math.max(0, T_rel_C - Tsat_C);
  if (superheatC <= 2) {
    return { Tsat_C, Ksh: 1.0 };
  }
  // Smooth fit to API 520 Part I Table 9 (steam superheat correction Ksh)
  const P_bar_factor = 1 + 0.00028 * Math.max(0, P1_barA - 10);
  const Ksh = Math.max(0.72, Math.min(1.0, 1.0 / (1.0 + 0.00138 * superheatC * P_bar_factor)));
  return { Tsat_C, Ksh };
}

/**
 * API 520 Part I Eq. 5.13 Napier correction factor Kn for steam above 103.39 barA (1500 psia).
 */
function calcSteamKn(P1_kPa: number): number {
  const P1_psia = P1_kPa * 0.1450377;
  if (P1_psia <= 1500) return 1.0;
  const P_eff = Math.min(3200, P1_psia);
  const denom = 0.2292 * P_eff - 1061.0;
  if (Math.abs(denom) < 1e-6) return 1.0;
  return Math.max(1.0, (0.1906 * P_eff - 1000.0) / denom);
}

/**
 * API 520 Part I Sec. 5.8 liquid viscosity correction Kv(Re).
 */
function api520LiquidKv(re: number): number {
  const reSafe = Math.max(10, re);
  const denom = 0.9935 + 2.878 / Math.sqrt(reSafe) + 342.75 / Math.pow(reSafe, 1.5);
  return Math.max(0.15, Math.min(1.0, 1.0 / denom));
}

/**
 * Solve Leung's critical pressure ratio equation for saturated/two-phase flashing:
 *   f(eta) = eta^2 + (w^2 - 2w)*(1 - eta)^2 + 2*w^2*ln(eta) + 2*w^2*(1 - eta) = 0
 * via robust bisection + Newton polish.
 */
function solveLeungCriticalEta(omega: number): number {
  if (omega <= 1e-6) return 0.001;
  const w2 = omega * omega;
  const f = (eta: number): number =>
    eta * eta +
    (w2 - 2 * omega) * (1 - eta) * (1 - eta) +
    2 * w2 * Math.log(eta) +
    2 * w2 * (1 - eta);

  let lo = 1e-6;
  let hi = 1 - 1e-6;
  // f(lo) -> -infinity, f(hi) -> +1
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (Math.abs(fm) < 1e-11 || hi - lo < 1e-9) return mid;
    if (fm < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * API 520 Part I Annex C — Leung Omega Method for Two-Phase Flashing Flow
 * Handles both saturated/two-phase inlet (x0 > 0 or Ps >= P0) and subcooled flashing (x0 == 0, Ps < P0).
 */
function solveLeungOmegaTwoPhase(params: {
  P0_Pa: number;
  Pb_Pa: number;
  T0_K: number;
  x0: number;
  rhoL: number;
  rhoV: number;
  cpL_JkgK: number;
  hfg_Jkg: number;
  Ps_Pa: number;
}): {
  omega: number;
  eta_crit: number;
  massFlux_kgm2s: number;
  isCritical: boolean;
  isSubcooledFlashing: boolean;
} {
  const { P0_Pa, Pb_Pa, T0_K, x0, rhoL, rhoV, cpL_JkgK, hfg_Jkg, Ps_Pa } = params;
  const vL0 = 1.0 / Math.max(100, rhoL);
  const vV0 = 1.0 / Math.max(0.05, rhoV);
  const vfg0 = Math.max(1e-6, vV0 - vL0);
  const eta_a = Math.min(0.999, Math.max(0.001, Pb_Pa / Math.max(100, P0_Pa)));

  const isSubcooledFlashing = x0 <= 1e-6 && Ps_Pa < P0_Pa * 0.999;

  if (isSubcooledFlashing) {
    // Subcooled flashing (API 520 Annex C Sec. C.2.2.2)
    const eta_s = Math.min(0.999, Math.max(0.01, Ps_Pa / P0_Pa));
    // Scale vapor specific volume to saturation pressure Ps if Ps < P0
    const vVs = vV0 * (P0_Pa / Math.max(100, Ps_Pa));
    const vfg_s = Math.max(1e-6, vVs - vL0);
    const omega_s =
      ((cpL_JkgK * T0_K * Ps_Pa) / vL0) * Math.pow(vfg_s / Math.max(1e4, hfg_Jkg), 2);
    const eta_st = (2.0 * omega_s) / (1.0 + 2.0 * omega_s);
    const scale = Math.sqrt(P0_Pa / vL0);

    // Subcooled dimensionless mass flux G*(eta) for eta <= eta_s
    const gStarTwoPhase = (eta: number): number => {
      const term =
        2.0 * (1.0 - eta_s) +
        2.0 * (omega_s * eta_s * Math.log(eta_s / eta) - (omega_s - 1.0) * (eta_s - eta));
      const denom = omega_s * (eta_s / eta - 1.0) + 1.0;
      return Math.sqrt(Math.max(0, term)) / Math.max(1e-9, denom);
    };

    if (eta_s < eta_st) {
      // High-subcooling region: flashing occurs right at throat (choking at eta_c = eta_s)
      const eta_c = eta_s;
      const isCrit = eta_a <= eta_c;
      const gStar = isCrit ? Math.sqrt(2.0 * (1.0 - eta_s)) : Math.sqrt(2.0 * (1.0 - eta_a));
      return {
        omega: omega_s,
        eta_crit: eta_c,
        massFlux_kgm2s: Math.max(1.0, gStar * scale),
        isCritical: isCrit,
        isSubcooledFlashing: true,
      };
    }

    // Low-subcooling region (eta_s >= eta_st): maximize gStarTwoPhase on (1e-4, eta_s) via golden-section search
    let a = 1e-4;
    let b = eta_s - 1e-6;
    const phi = (Math.sqrt(5) - 1) / 2;
    let c = b - phi * (b - a);
    let d = a + phi * (b - a);
    let fc = gStarTwoPhase(c);
    let fd = gStarTwoPhase(d);
    for (let i = 0; i < 55; i++) {
      if (fc < fd) {
        a = c;
        c = d;
        fc = fd;
        d = a + phi * (b - a);
        fd = gStarTwoPhase(d);
      } else {
        b = d;
        d = c;
        fd = fc;
        c = b - phi * (b - a);
        fc = gStarTwoPhase(c);
      }
    }
    const eta_c = 0.5 * (a + b);
    const isCrit = eta_a <= eta_c;
    const gStar = isCrit
      ? gStarTwoPhase(eta_c)
      : eta_a < eta_s
        ? gStarTwoPhase(eta_a)
        : Math.sqrt(2.0 * (1.0 - eta_a));

    return {
      omega: omega_s,
      eta_crit: eta_c,
      massFlux_kgm2s: Math.max(1.0, gStar * scale),
      isCritical: isCrit,
      isSubcooledFlashing: true,
    };
  }

  // Saturated / Two-Phase Inlet (API 520 Annex C Sec. C.2.2.1)
  const v0 = x0 * vV0 + (1.0 - x0) * vL0;
  const omega =
    (x0 * vV0) / v0 +
    ((cpL_JkgK * T0_K * P0_Pa) / v0) * Math.pow(vfg0 / Math.max(1e4, hfg_Jkg), 2);
  const eta_c = solveLeungCriticalEta(omega);
  const isCrit = eta_a <= eta_c;
  const scale = Math.sqrt(P0_Pa / v0);

  let gStar: number;
  if (isCrit) {
    gStar = eta_c / Math.sqrt(Math.max(1e-6, omega));
  } else {
    const num = -2.0 * (omega * Math.log(eta_a) + (omega - 1.0) * (1.0 - eta_a));
    const denom = omega * (1.0 / eta_a - 1.0) + 1.0;
    gStar = Math.sqrt(Math.max(0, num)) / Math.max(1e-9, denom);
  }

  return {
    omega,
    eta_crit: eta_c,
    massFlux_kgm2s: Math.max(1.0, gStar * scale),
    isCritical: isCrit,
    isSubcooledFlashing: false,
  };
}

/**
 * Haaland explicit Darcy friction factor.
 */
function haalandFrictionFactor(re: number, relRoughness: number): number {
  if (re <= 2100) return 64.0 / Math.max(10, re);
  const term = Math.pow(relRoughness / 3.7, 1.11) + 6.9 / re;
  const invSqrtF = -1.8 * Math.log10(Math.max(1e-12, term));
  return Math.max(0.008, Math.min(0.1, 1.0 / (invSqrtF * invSqrtF)));
}

/**
 * Infer approximate inlet & outlet pipe internal diameters (mm) from API 526 size string e.g. '2" × 3"'
 */
function inferFlangePipeIdsMm(sizeStr: string): { inletIdMm: number; outletIdMm: number } {
  const npsToIdMm: Record<string, number> = {
    '1': 26.6,
    '1.5': 40.9,
    '2': 52.5,
    '2.5': 62.7,
    '3': 77.9,
    '4': 102.3,
    '6': 154.1,
    '8': 202.7,
    '10': 254.5,
  };
  const matches = sizeStr.match(/(\d+(?:\.\d+)?)/g);
  if (matches && matches.length >= 2) {
    const inId = npsToIdMm[matches[0]] ?? Number(matches[0]) * 25.4;
    const outId = npsToIdMm[matches[1]] ?? Number(matches[1]) * 25.4;
    return { inletIdMm: inId, outletIdMm: outId };
  }
  return { inletIdMm: 52.5, outletIdMm: 77.9 };
}

/**
 * API 520 Part II Piping & Installation Check:
 *  - Inlet non-recoverable pressure drop vs 3% rule (at rated capacity W_rated_kgh)
 *  - Discharge reaction force F_R (N & kgf)
 *  - Outlet Mach number & acoustic noise level at 30 m (API 521 Sec. 5.4.3.2)
 */
function evaluatePipingCheck(params: {
  inp: PSVDesignInput;
  selectedOrifice: Api526Orifice;
  phase: PSVPhase;
  W_rated_kgh: number;
  P_set_barG: number;
  P1_barA: number;
  P2_barA: number;
  patm_bar: number;
  T_rel_K: number;
  mw: number;
  k_cpcv: number;
  Z_comp: number;
  rhoL: number;
  mu_cP: number;
}): PSVPipingCheckResult {
  const {
    inp,
    selectedOrifice,
    phase,
    W_rated_kgh,
    P_set_barG,
    P1_barA,
    P2_barA,
    patm_bar,
    T_rel_K,
    mw,
    k_cpcv,
    Z_comp,
    rhoL,
    mu_cP,
  } = params;

  const inferred = inferFlangePipeIdsMm(selectedOrifice.size);
  const isInferred =
    inp.inlet_pipe_id_mm === undefined && inp.outlet_pipe_id_mm === undefined;

  const inletIdMm = Math.max(10, inp.inlet_pipe_id_mm ?? inferred.inletIdMm);
  const inletLenM = Math.max(0.1, inp.inlet_pipe_len_m ?? 1.5);
  const inletK = Math.max(0.5, inp.inlet_k_fittings ?? 1.5);
  const outletIdMm = Math.max(15, inp.outlet_pipe_id_mm ?? inferred.outletIdMm);
  const outletLenM = Math.max(0.5, inp.outlet_pipe_len_m ?? 6.0);
  const roughnessMm = Math.max(0.001, inp.pipe_roughness_mm ?? 0.0457);

  const mDot = W_rated_kgh / 3600.0; // kg/s
  const R_u = 8314.462; // J/(kmol·K)

  const rhoGasIn = (P1_barA * 1e5 * mw) / (Z_comp * R_u * T_rel_K);
  const rhoGasOut = (P2_barA * 1e5 * mw) / (Z_comp * R_u * T_rel_K);

  const rhoIn =
    phase === 'liquid'
      ? rhoL
      : phase === 'twophase'
        ? 1.0 /
          ((inp.vapor_mass_frac ?? 0.15) / Math.max(0.1, inp.rhoV_kgm3 ?? rhoGasIn) +
            (1 - (inp.vapor_mass_frac ?? 0.15)) / Math.max(100, inp.rhoL_kgm3 ?? rhoL))
        : rhoGasIn;

  const rhoOut = phase === 'liquid' ? rhoL : Math.max(0.05, rhoGasOut);

  // Inlet hydraulic pressure drop
  const D_in = inletIdMm / 1000.0;
  const A_in = (Math.PI * D_in * D_in) / 4.0;
  const v_in = mDot / Math.max(1e-6, rhoIn * A_in);
  const muIn_Pas = (phase === 'liquid' ? mu_cP : 0.015) * 1e-3;
  const Re_in = (rhoIn * v_in * D_in) / Math.max(1e-7, muIn_Pas);
  const f_in = haalandFrictionFactor(Re_in, roughnessMm / inletIdMm);
  const dp_in_Pa = (f_in * (inletLenM / D_in) + inletK) * 0.5 * rhoIn * v_in * v_in;
  const dp_in_bar = dp_in_Pa / 1e5;
  const dp_in_pct = (dp_in_bar / Math.max(0.1, P_set_barG)) * 100.0;

  // Outlet Mach, Reaction Force F_R (API 520 Part II Sec. 7.4) & Acoustic Noise (API 521)
  const D_out = outletIdMm / 1000.0;
  const A_out = (Math.PI * D_out * D_out) / 4.0;
  const c_out =
    phase === 'liquid'
      ? 1200.0
      : Math.sqrt((k_cpcv * Z_comp * R_u * T_rel_K) / Math.max(2.0, mw));
  const v_out_raw = mDot / Math.max(1e-6, rhoOut * A_out);
  const outlet_mach = phase === 'liquid' ? v_out_raw / c_out : v_out_raw / Math.max(10, c_out);
  const v_out_eff = phase === 'liquid' ? v_out_raw : Math.min(v_out_raw, c_out);

  // Static pressure at exit plane if choked at outlet pipe
  let P_exit_Pa = P2_barA * 1e5;
  if (phase !== 'liquid' && outlet_mach > 1.0) {
    // Choked outlet pipe: P_exit scales up proportionally to Mach
    P_exit_Pa = Math.max(P_exit_Pa, P2_barA * 1e5 * outlet_mach);
  }
  const F_R_N = mDot * v_out_eff + Math.max(0, P_exit_Pa - patm_bar * 1e5) * A_out;
  const F_R_kgf = F_R_N / 9.80665;

  // API 521 Sec. 5.4.3.2 acoustic noise level at 30 m (100 ft)
  let noise_dBA_30m = 0;
  if (phase === 'liquid') {
    noise_dBA_30m = Math.max(45, 55 + 10 * Math.log10(Math.max(1, mDot * Math.max(1, P1_barA - P2_barA))));
  } else {
    const PR = Math.max(1.05, P1_barA / Math.max(0.1, P2_barA));
    // API 521 Fig. 12 reference curve L_ref(PR) + 10*log10(0.2932 * q_m * k * T / M)
    const L_ref = 78.0 + 16.5 * Math.log10(Math.max(1.1, PR));
    const powerTerm = 10.0 * Math.log10(Math.max(1e-3, (0.2932 * mDot * k_cpcv * T_rel_K) / mw));
    noise_dBA_30m = Math.max(55, Math.min(135, L_ref + powerTerm));
  }

  return {
    inlet_pipe_id_mm: Number(inletIdMm.toFixed(1)),
    inlet_pipe_len_m: Number(inletLenM.toFixed(2)),
    inlet_k_fittings: Number(inletK.toFixed(2)),
    inlet_vel_ms: Number(v_in.toFixed(2)),
    inlet_dp_bar: Number(dp_in_bar.toFixed(4)),
    inlet_dp_pct_pset: Number(dp_in_pct.toFixed(2)),
    inlet_3pct_pass: dp_in_pct <= 3.0,
    outlet_pipe_id_mm: Number(outletIdMm.toFixed(1)),
    outlet_pipe_len_m: Number(outletLenM.toFixed(2)),
    outlet_vel_ms: Number(v_out_eff.toFixed(2)),
    outlet_mach: Number(outlet_mach.toFixed(3)),
    reaction_force_N: Number(F_R_N.toFixed(1)),
    reaction_force_kgf: Number(F_R_kgf.toFixed(1)),
    noise_dBA_30m: Number(noise_dBA_30m.toFixed(1)),
    is_inferred_geometry: isInferred,
  };
}

// ── Public API 521 Helpers ─────────────────────────────────────────────────

/**
 * Estimate API 521 environmental insulation factor F_env from insulation thickness (mm).
 * Standard API 521 Table 6 values: 0 mm -> 1.0, 25 mm -> 0.30, 50 mm -> 0.15, 100 mm -> 0.075.
 */
export function estimateFireEnvFactor(insulationThicknessMm = 0): number {
  const table: ReadonlyArray<[number, number]> = [
    [0, 1.0],
    [25, 0.3],
    [50, 0.15],
    [100, 0.075],
    [150, 0.05],
  ];
  return Number(lerpTable(Math.max(0, insulationThicknessMm), table).toFixed(4));
}

/**
 * API 521 Sec. 4.4.13 Pool Fire Wetted Surface Area Calculator
 * Enforces the mandatory API 521 7.6 m (25 ft) elevation cutoff above grade / fire source.
 */
export function calcFireWettedAreaM2(inp: FireWettedAreaInput): FireWettedAreaResult {
  const D = Math.max(0.2, inp.vesselDiaM);
  const R = D / 2.0;
  const L = Math.max(0.2, inp.vesselTanToTanM);
  const liqFrac = Math.min(1.0, Math.max(0.05, inp.liquidLevelFrac ?? 0.5));
  const elev = Math.max(0, inp.elevationAboveGradeM ?? 1.0);
  const cutoffH = 7.6; // API 521: 7.6 m (25 ft) above grade
  const F_env = estimateFireEnvFactor(inp.insulationThicknessMm ?? 0);

  // Single head area factor (2:1 ellipsoidal ~ 1.084 * D^2, hemispherical ~ 1.571 * D^2, flat ~ 0.785 * D^2)
  const headArea =
    inp.headType === 'hemispherical'
      ? 0.5 * Math.PI * D * D
      : inp.headType === 'flat'
        ? 0.25 * Math.PI * D * D
        : 1.084 * D * D;

  let totalLiquidWetted = 0;
  let effectiveWetted = 0;
  let effectiveFireHeight = 0;
  let cutoffApplied = false;

  if (inp.orientation === 'vertical') {
    const hLiq = liqFrac * L;
    const maxFireH = Math.max(0, cutoffH - elev);
    effectiveFireHeight = Math.min(hLiq, maxFireH);
    cutoffApplied = elev + hLiq > cutoffH;

    totalLiquidWetted = Math.PI * D * hLiq + headArea;
    effectiveWetted =
      effectiveFireHeight <= 0
        ? 0
        : Math.PI * D * effectiveFireHeight + (elev < cutoffH ? headArea : 0);
  } else if (inp.orientation === 'sphere') {
    const hLiq = liqFrac * D;
    const maxFireH = Math.max(0, cutoffH - elev);
    // API 521 for spheres: wetted area up to maximum horizontal diameter (equator) or 7.6 m, whichever is greater
    const hEff = Math.min(D, Math.max(R, Math.min(hLiq, maxFireH)));
    effectiveFireHeight = Math.min(hLiq, maxFireH);
    cutoffApplied = elev + hLiq > cutoffH;

    // Spherical cap surface area = pi * D * h
    totalLiquidWetted = Math.PI * D * hLiq;
    effectiveWetted = elev >= cutoffH ? 0 : Math.PI * D * Math.min(hEff, maxFireH);
  } else {
    // Horizontal cylindrical vessel
    const hLiq = liqFrac * D;
    const maxFireH = Math.max(0, cutoffH - elev);
    effectiveFireHeight = Math.min(hLiq, maxFireH);
    cutoffApplied = elev + hLiq > cutoffH;

    const wettedPerimeter = (h: number): number => {
      if (h <= 0) return 0;
      if (h >= D) return Math.PI * D;
      const cosHalfTheta = Math.max(-1, Math.min(1, (R - h) / R));
      return 2.0 * R * Math.acos(cosHalfTheta);
    };

    const headFracTotal = Math.min(1, Math.max(0, hLiq / D));
    const headFracEff = Math.min(1, Math.max(0, effectiveFireHeight / D));

    totalLiquidWetted = wettedPerimeter(hLiq) * L + 2.0 * headArea * headFracTotal;
    effectiveWetted =
      effectiveFireHeight <= 0
        ? 0
        : wettedPerimeter(effectiveFireHeight) * L + 2.0 * headArea * headFracEff;
  }

  const Q_fire_kW =
    effectiveWetted > 0 ? 43.2 * F_env * Math.pow(effectiveWetted, 0.82) : 0;

  return {
    wettedAreaM2: Number(effectiveWetted.toFixed(2)),
    totalLiquidWettedAreaM2: Number(totalLiquidWetted.toFixed(2)),
    effectiveFireHeightM: Number(effectiveFireHeight.toFixed(2)),
    elevationCutoffApplied: cutoffApplied,
    F_env,
    Q_fire_kW: Number(Q_fire_kW.toFixed(2)),
  };
}

/**
 * API 521 Sec. 4.4.14 Heat Exchanger Tube Rupture Evaluator:
 *  - Checks 10/13 rule (P_low_design >= (10/13) * P_high)
 *  - Calculates double-ended guillotine tube break orifice relief rate (2 × tube cross-section)
 */
export function calcTubeRuptureRelief(inp: TubeRuptureInput): TubeRuptureResult {
  const P_high = Math.max(0.5, inp.P_high_barG);
  const P_low = Math.max(0.1, inp.P_low_design_barG);
  const minDesign10_13 = (10.0 / 13.0) * P_high;
  const passes10_13 = P_low >= minDesign10_13;
  const ratio = P_low / P_high;

  const d_m = Math.max(0.005, inp.tubeIdMm / 1000.0);
  const doubleArea_m2 = 2.0 * (Math.PI * d_m * d_m) / 4.0;
  const doubleArea_mm2 = doubleArea_m2 * 1e6;
  const cd = Math.max(0.5, Math.min(0.98, inp.cd ?? 0.62));
  const patm = inp.patm_bar ?? 1.01325;

  let reliefRate_kgh = 0;
  if (inp.phase === 'vapor') {
    const mw = Math.max(2.0, inp.mw ?? 28.0);
    const k = Math.max(1.05, inp.k_cpcv ?? 1.3);
    const Z = Math.max(0.3, inp.Z_comp ?? 0.92);
    const T_K = (inp.T_C ?? 100.0) + 273.15;
    const P1_Pa = (P_high + patm) * 1e5;
    const P2_Pa = (P_low + patm) * 1e5;
    const r = P2_Pa / P1_Pa;
    const rCrit = Math.pow(2 / (k + 1), k / (k - 1));
    const R_u = 8314.462;
    let mDot: number;
    if (r <= rCrit) {
      const C_si = Math.sqrt(k * Math.pow(2 / (k + 1), (k + 1) / (k - 1)));
      mDot = cd * doubleArea_m2 * P1_Pa * C_si * Math.sqrt(mw / (Z * R_u * T_K));
    } else {
      const term =
        (2 * k) / (k - 1) * (Math.pow(r, 2 / k) - Math.pow(r, (k + 1) / k));
      mDot = cd * doubleArea_m2 * P1_Pa * Math.sqrt(Math.max(0, (mw * term) / (Z * R_u * T_K)));
    }
    reliefRate_kgh = mDot * 3600.0;
  } else {
    const rho = Math.max(200, inp.rho_kgm3 ?? 850.0);
    const dP_Pa = Math.max(0, (P_high - P_low) * 1e5);
    const mDot = cd * doubleArea_m2 * Math.sqrt(2.0 * rho * dP_Pa);
    reliefRate_kgh = mDot * 3600.0;
  }

  const recommendation = passes10_13
    ? `API 521 10/13 규칙 충족 (저압측 설계압력 ${P_low.toFixed(1)} barG ≥ ${minDesign10_13.toFixed(1)} barG): Tube Rupture 전용 PSV 설치 불필요`
    : `API 521 10/13 규칙 미충족 (저압측 설계압력 ${P_low.toFixed(1)} barG < ${minDesign10_13.toFixed(1)} barG): 양단 파단 기준 ${reliefRate_kgh.toFixed(0)} kg/h 방출량에 대한 PSV 또는 파열판(RD) 보호 필수`;

  return {
    passes10_13Rule: passes10_13,
    minDesignPressFor10_13_barG: Number(minDesign10_13.toFixed(2)),
    pressureRatioLowToHigh: Number(ratio.toFixed(3)),
    doubleBreakArea_mm2: Number(doubleArea_mm2.toFixed(2)),
    reliefRate_kgh: Number(reliefRate_kgh.toFixed(1)),
    recommendation,
  };
}

// ── Main PSV Solver ────────────────────────────────────────────────────────

export function solvePSV(
  inp: PSVDesignInput = {},
  mode: PSVSolverMode | string = 'rigorous',
): PSVDesignResult {
  const solverMode: PSVSolverMode = mode === 'quick' ? 'quick' : 'rigorous';
  const scenario = inp.scenario ?? 'blocked_outlet';
  const phase = inp.phase ?? 'vapor';

  const valve_type: PSVValveType =
    inp.valve_type ?? (inp.is_balanced_bellows ? 'balanced_bellows' : 'conventional');

  const T_rel_C = inp.T_rel_C ?? 140.0;
  const T_rel_K = T_rel_C + 273.15;

  const fluidProps = inp.fluidId ? resolveFluidProps(inp.fluidId, T_rel_C) : null;

  const P_set_barG = Math.max(0.2, inp.P_set_barG ?? 15.0);
  const patm_bar = inp.patm_bar ?? 1.01325;

  // Separate superimposed & built-up backpressure while preserving P_back_barG fallback
  let superimposed_backpress_barG: number;
  let builtup_backpress_barG: number;
  let P_back_barG: number;
  if (
    inp.superimposed_backpress_barG !== undefined ||
    inp.builtup_backpress_barG !== undefined
  ) {
    superimposed_backpress_barG = Math.max(0, inp.superimposed_backpress_barG ?? 0);
    builtup_backpress_barG = Math.max(
      0,
      inp.builtup_backpress_barG ??
        Math.max(0, (inp.P_back_barG ?? 0) - superimposed_backpress_barG),
    );
    P_back_barG = superimposed_backpress_barG + builtup_backpress_barG;
  } else {
    P_back_barG = Math.max(-0.5, inp.P_back_barG ?? 1.2);
    superimposed_backpress_barG = 0;
    builtup_backpress_barG = Math.max(0, P_back_barG);
  }

  const overpress_pct =
    inp.overpress_pct ?? (scenario === 'fire_case' ? 21.0 : 10.0);

  const mw = Math.max(2.0, inp.mw ?? fluidProps?.mw ?? 44.1);
  const k_cpcv = Math.max(1.05, inp.k_cpcv ?? fluidProps?.k ?? 1.25);
  const Z_comp = Math.max(0.3, inp.Z_comp ?? 0.92);
  const rhoL = Math.max(200, inp.rhoL_kgm3 ?? inp.rhoL ?? fluidProps?.rho ?? 800.0);
  const mu_cP = Math.max(0.05, inp.mu_cP ?? fluidProps?.mu ?? 1.0);
  const hv_kJkg = Math.max(50, inp.hv_kJkg ?? fluidProps?.hv ?? 360.0);
  const F_env = Math.min(1.0, Math.max(0.05, inp.F_env ?? 1.0));

  // ── 1. API 521 Relief Load W_kgh ────────────────────────────────────────
  let W_kgh = Math.max(5, inp.W_kgh ?? 12000);
  let Q_fire_kW = 0;

  if (scenario === 'fire_case') {
    const A_wet_m2 = Math.max(1.0, inp.A_wet_m2 ?? 45.0);
    // API 521 Eq. for adequate drainage & firefighting: Q = 43.2 * F * A_wet^0.82 (kW)
    Q_fire_kW = 43.2 * F_env * Math.pow(A_wet_m2, 0.82);
    if (inp.W_kgh === undefined) {
      W_kgh = (Q_fire_kW * 3600.0) / hv_kJkg;
    } else {
      // Preserve exact legacy behavior: fire_case always computes W from Q_fire unless explicitly overridden?
      // Wait: legacy code always overwrote W_kgh in fire_case! Keep exact legacy parity if A_wet_m2 was supplied or W_kgh wasn't specifically forced.
      W_kgh = (Q_fire_kW * 3600.0) / hv_kJkg;
    }
  } else if (scenario === 'thermal_exp' && phase === 'liquid' && inp.W_kgh === undefined) {
    const dQ_kW = Math.max(0.5, inp.dQ_kW ?? 15.0);
    const alpha_cub = inp.alpha_cub_K ?? 0.0008;
    const cp_kJkgK = Math.max(0.5, inp.cp_kJkgK ?? inp.cpL_kJkgK ?? 2.2);
    W_kgh = Math.max(20, ((alpha_cub * dQ_kW) / cp_kJkgK) * rhoL * 3600.0);
  }

  // ── 2. Relieving Pressure, Critical Ratio & Correction Factors ──────────
  const P1_barA = P_set_barG * (1.0 + overpress_pct / 100.0) + patm_bar;
  const P1_kPa = P1_barA * 100.0;
  const P2_barA = Math.max(0.1, P_back_barG + patm_bar);
  const P2_kPa = P2_barA * 100.0;
  const backPressRatio = P2_kPa / P1_kPa;
  const gaugeBpPct = (Math.max(0, P_back_barG) / P_set_barG) * 100.0;
  const builtupBpPct = (builtup_backpress_barG / P_set_barG) * 100.0;

  const r_crit = Math.pow(2.0 / (k_cpcv + 1.0), k_cpcv / (k_cpcv - 1.0));
  let isCritical = phase === 'liquid' ? false : backPressRatio <= r_crit;

  const C_api =
    0.03948 *
    Math.sqrt(k_cpcv * Math.pow(2.0 / (k_cpcv + 1.0), (k_cpcv + 1.0) / (k_cpcv - 1.0)));

  const Kd = phase === 'liquid' ? 0.65 : phase === 'twophase' ? 0.85 : 0.975;
  const Kc = inp.has_rupture_disk ? 0.9 : 1.0;

  // Accurate API 520 Fig. 30 (Kb), Fig. 31 (Kw), Fig. 32 (Kp)
  const Kb = phase === 'liquid' ? 1.0 : calcApi520Kb(valve_type, gaugeBpPct, overpress_pct);
  const Kw = phase === 'liquid' ? calcApi520Kw(valve_type, gaugeBpPct) : 1.0;
  const Kp = calcApi520Kp(phase, overpress_pct);

  // ── 3. API 520 Part I Orifice Area Sizing ───────────────────────────────
  let A_req_mm2 = 0;
  let Kv = 1.0;
  let Kn = 1.0;
  let Ksh = 1.0;
  let F2 = 1.0;
  let Re_orifice = 0;
  let omega: number | undefined;
  let eta_crit: number | undefined;
  let massFlux_kgm2s: number | undefined;
  let isSubcooledFlashing: boolean | undefined;
  const iterations: PSVIterationRow[] = [];

  if (phase === 'liquid') {
    const Q_Lmin = (W_kgh / rhoL) * (1000.0 / 60.0);
    const G_sp = rhoL / 999.0;
    const dP_kPa = Math.max(
      10.0,
      (P_set_barG * (1.0 + overpress_pct / 100.0) - P_back_barG) * 100.0,
    );
    const A_uncorr = (11.78 * Q_Lmin) / (Kd * Kw * Kc * Kp * Math.sqrt(dP_kPa / G_sp));

    // Iterative API 520 liquid viscosity correction loop (Kv(Re))
    let A_cur = A_uncorr;
    let Kv_prev = 1.0;
    const maxIters = solverMode === 'quick' ? 4 : 12;
    for (let it = 1; it <= maxIters; it++) {
      Re_orifice = (18800.0 * Q_Lmin * G_sp) / (mu_cP * Math.sqrt(Math.max(1.0, A_cur)));
      Kv = api520LiquidKv(Re_orifice);
      A_cur = A_uncorr / Kv;
      const err = Math.abs(Kv - Kv_prev) / Math.max(0.05, Kv);
      if (it === 1 || it === maxIters || err < 1e-4) {
        iterations.push({
          iter: it,
          param: 'API 520 Liquid Viscosity Loop (Kv)',
          assumed: `Kv_in = ${Kv_prev.toFixed(4)}`,
          calc: `Re = ${Re_orifice.toFixed(0)}, Kv = ${Kv.toFixed(4)}, Kw = ${Kw.toFixed(3)}, Kp = ${Kp.toFixed(3)}, A = ${A_cur.toFixed(1)} mm²`,
          err: `${(err * 100).toFixed(3)}%`,
          note: `점도 μ = ${mu_cP} cP, 과압 ${overpress_pct}% 반영`,
        });
      }
      if (err < 1e-4) break;
      Kv_prev = Kv;
    }
    A_req_mm2 = A_cur;
  } else if (phase === 'twophase') {
    // API 520 Annex C — Leung Omega Two-Phase Flashing Method
    const x0 = Math.min(1.0, Math.max(0.0, inp.vapor_mass_frac ?? 0.15));
    const R_u = 8314.462;
    const rhoV_est = (P1_barA * 1e5 * mw) / (Z_comp * R_u * T_rel_K);
    const rhoV = Math.max(0.1, inp.rhoV_kgm3 ?? rhoV_est);
    const cpL_kJkgK = Math.max(0.5, inp.cpL_kJkgK ?? inp.cp_kJkgK ?? fluidProps?.cp ?? 2.2);
    const Ps_barA =
      inp.sat_press_barA ??
      (x0 <= 1e-6 && fluidProps?.pv_bar && fluidProps.pv_bar < P1_barA
        ? fluidProps.pv_bar
        : P1_barA);

    const omegaRes = solveLeungOmegaTwoPhase({
      P0_Pa: P1_barA * 1e5,
      Pb_Pa: P2_barA * 1e5,
      T0_K: T_rel_K,
      x0,
      rhoL,
      rhoV,
      cpL_JkgK: cpL_kJkgK * 1000.0,
      hfg_Jkg: hv_kJkg * 1000.0,
      Ps_Pa: Ps_barA * 1e5,
    });

    omega = Number(omegaRes.omega.toFixed(4));
    eta_crit = Number(omegaRes.eta_crit.toFixed(4));
    massFlux_kgm2s = Number(omegaRes.massFlux_kgm2s.toFixed(2));
    isSubcooledFlashing = omegaRes.isSubcooledFlashing;
    isCritical = omegaRes.isCritical;

    const W_kgs = W_kgh / 3600.0;
    const A_req_m2 = W_kgs / (Kd * Kb * Kc * omegaRes.massFlux_kgm2s);
    A_req_mm2 = A_req_m2 * 1e6;

    iterations.push({
      iter: 1,
      param: `API 520 Annex C Leung Omega (${isSubcooledFlashing ? 'Subcooled' : 'Saturated'} Flashing)`,
      assumed: `x₀ = ${x0.toFixed(3)}, P₁ = ${P1_barA.toFixed(2)} barA, Ps = ${Ps_barA.toFixed(2)} barA`,
      calc: `ω = ${omega.toFixed(3)}, η_c = ${eta_crit.toFixed(3)}, G = ${massFlux_kgm2s.toFixed(1)} kg/(m²·s)`,
      err: '0.00%',
      note: isCritical
        ? `2상 임계 플래싱 유동 (Choked, A_req = ${A_req_mm2.toFixed(1)} mm²)`
        : `2상 아임계 유동 (Subcritical, A_req = ${A_req_mm2.toFixed(1)} mm²)`,
    });
  } else if (phase === 'steam') {
    Kn = calcSteamKn(P1_kPa);
    const steamInfo = calcSteamKsh(P1_barA, T_rel_C);
    Ksh = steamInfo.Ksh;
    // API 520 Part I Steam equation (Metric: 190.5 * W_kgh / (Kd * P1_kPa * Kb * Kc * Kn * Ksh))
    A_req_mm2 = (190.5 * W_kgh) / (Kd * P1_kPa * Kb * Kc * Kn * Ksh);

    iterations.push({
      iter: 1,
      param: `API 520 Steam Sizing (Kn=${Kn.toFixed(3)}, Ksh=${Ksh.toFixed(3)})`,
      assumed: `P₁ = ${P1_barA.toFixed(2)} barA, T_rel = ${T_rel_C.toFixed(1)}°C`,
      calc: `T_sat = ${steamInfo.Tsat_C.toFixed(1)}°C, Kb = ${Kb.toFixed(3)}, A_req = ${A_req_mm2.toFixed(1)} mm²`,
      err: '0.00%',
      note: isCritical ? '스팀 임계 유동 (Sonic Flow)' : '스팀 아임계 배압 보정(Kb)',
    });
  } else {
    // Vapor / Gas sizing (API 520 Part I Critical & Subcritical)
    if (isCritical) {
      A_req_mm2 =
        W_kgh / (C_api * Kd * P1_kPa * Kb * Kc * Math.sqrt(mw / (T_rel_K * Z_comp)));
    } else {
      const r = Math.min(0.999, Math.max(0.05, backPressRatio));
      F2 = Math.sqrt(
        (k_cpcv / (k_cpcv - 1.0)) *
          Math.pow(r, 2.0 / k_cpcv) *
          ((1.0 - Math.pow(r, (k_cpcv - 1.0) / k_cpcv)) / Math.max(1e-4, 1.0 - r)),
      );
      A_req_mm2 =
        (17.9 * W_kgh) /
        (F2 *
          Kd *
          Kc *
          Math.sqrt((mw * P1_kPa * Math.max(1.0, P1_kPa - P2_kPa)) / (T_rel_K * Z_comp)));
    }

    iterations.push({
      iter: 1,
      param: `API 520 임계압력비 판별 (r_c=${r_crit.toFixed(3)})`,
      assumed: `P₂/P₁ = ${backPressRatio.toFixed(3)}`,
      calc: isCritical
        ? `임계 유동 (Sonic, C=${C_api.toFixed(5)}, Kb=${Kb.toFixed(3)})`
        : `아임계 유동 (Subsonic, F₂=${F2.toFixed(4)})`,
      err: '0.00%',
      note: `방출압력 P₁ = ${P1_barA.toFixed(2)} barA (${overpress_pct}% 축적)`,
    });
  }

  const A_req_in2 = A_req_mm2 / 645.16;
  const orifices = getApi526Orifices();
  const selectedOrifice =
    orifices.find((o) => o.area_mm2 >= A_req_mm2) ?? orifices[orifices.length - 1];

  const parallelCount = Math.max(1, Math.ceil(A_req_mm2 / selectedOrifice.area_mm2));
  const cap_utilization_pct = (A_req_mm2 / selectedOrifice.area_mm2) * 100.0;
  const W_rated_kgh = W_kgh * (selectedOrifice.area_mm2 / Math.max(1.0, A_req_mm2));

  iterations.push({
    iter: iterations.length + 1,
    param: 'API 526 표준 오리피스 선정',
    assumed: `A_req = ${A_req_mm2.toFixed(1)} mm² (${A_req_in2.toFixed(3)} in²)`,
    calc: `'${selectedOrifice.letter}' Orifice (${selectedOrifice.area_mm2} mm², ${selectedOrifice.size})`,
    err: '0.00%',
    note: `용량 가동률 ${cap_utilization_pct.toFixed(1)}%`,
  });

  // ── 4. API 520 Part II Piping & Installation Check ──────────────────────
  const pipingCheck = evaluatePipingCheck({
    inp,
    selectedOrifice,
    phase,
    W_rated_kgh,
    P_set_barG,
    P1_barA,
    P2_barA,
    patm_bar,
    T_rel_K,
    mw,
    k_cpcv,
    Z_comp,
    rhoL,
    mu_cP,
  });

  // ── 5. Engineering Warnings & Code Compliance Checks ────────────────────
  const warnings: PSVWarningItem[] = [];
  if (A_req_mm2 > selectedOrifice.area_mm2) {
    warnings.push({
      level: 'danger',
      text: `단일 T-Orifice 최대 면적(${selectedOrifice.area_mm2.toLocaleString()} mm²) 초과! 최소 ${parallelCount}개의 병렬 PSV 설치가 필요합니다.`,
    });
  } else if (cap_utilization_pct < 35.0) {
    warnings.push({
      level: 'warn',
      text: `PSV 오리피스 가동률 낮음 (${cap_utilization_pct.toFixed(1)}% < 35%) — 채터링(Chattering) 주의`,
    });
  } else {
    warnings.push({
      level: 'ok',
      text: `API 526 '${selectedOrifice.letter}' 오리피스(${selectedOrifice.size}) 적합: 가동률 ${cap_utilization_pct.toFixed(1)}%`,
    });
  }

  // Valve-type specific backpressure compliance (API 520 Part I)
  const convLimitPct = scenario === 'fire_case' ? 21.0 : 10.0;
  if (valve_type === 'conventional') {
    if (builtupBpPct > convLimitPct || gaugeBpPct > convLimitPct) {
      warnings.push({
        level: 'danger',
        text: `Conventional PSV 배압 한계 초과! (축적배압 ${builtupBpPct.toFixed(1)}%, 총배압 ${gaugeBpPct.toFixed(1)}% > ${convLimitPct}% of P_set) — Balanced Bellows 또는 Pilot형으로 변경하세요.`,
      });
    }
  } else if (valve_type === 'balanced_bellows') {
    if (gaugeBpPct > 50.0) {
      warnings.push({
        level: 'danger',
        text: `Balanced Bellows 배압비 ${gaugeBpPct.toFixed(1)}% > 50% 초과! 벨로우즈 파손 및 심각한 용량 저하 위험 — Pilot 작동식 PSV 적용을 검토하세요.`,
      });
    } else if (gaugeBpPct > 30.0) {
      warnings.push({
        level: 'warn',
        text: `Balanced Bellows 고배압 구간 (${gaugeBpPct.toFixed(1)}%): 배압 보정계수 ${phase === 'liquid' ? `Kw=${Kw.toFixed(3)}` : `Kb=${Kb.toFixed(3)}`} 적용됨.`,
      });
    }
  } else if (valve_type === 'pilot') {
    if (gaugeBpPct > 70.0) {
      warnings.push({
        level: 'danger',
        text: `Pilot PSV 배압비 ${gaugeBpPct.toFixed(1)}% > 70% — 아임계 유동 및 역류 방지(Backflow Preventer) 검토가 필요합니다.`,
      });
    }
  }

  // API 520 Part II 3% inlet pressure drop rule
  if (!pipingCheck.inlet_3pct_pass) {
    warnings.push({
      level: 'danger',
      text: `API 520 Part II 입구배관 3% 규칙 위반! (ΔP_inlet = ${pipingCheck.inlet_dp_pct_pset.toFixed(2)}% > 3.0% of P_set) — 입구배관 구경 확대 또는 길이 단축 필요.`,
    });
  }

  if (phase !== 'liquid' && pipingCheck.outlet_mach > 0.7) {
    warnings.push({
      level: 'warn',
      text: `출구배관 마하수 높음 (Ma = ${pipingCheck.outlet_mach.toFixed(2)} > 0.70) — 소음(${pipingCheck.noise_dBA_30m.toFixed(0)} dBA @ 30m) 및 배압 상승 주의.`,
    });
  }

  if (phase === 'liquid' && Kv < 0.92) {
    warnings.push({
      level: 'warn',
      text: `고점도 액체(${mu_cP} cP, Re=${Re_orifice.toFixed(0)})로 인해 API 520 점도 보정계수 Kv=${Kv.toFixed(3)}가 적용되었습니다.`,
    });
  }

  if (phase === 'liquid' && Kp < 1.0) {
    warnings.push({
      level: 'warn',
      text: `액체 과압 ${overpress_pct}% (< 25%)로 인해 API 520 Fig. 32 과압 보정계수 Kp=${Kp.toFixed(3)}가 적용되었습니다.`,
    });
  }

  if (scenario === 'tube_rupture') {
    warnings.push({
      level: 'warn',
      text: 'API 521 Tube Rupture 시나리오: 저압측 설계압력이 고압측의 10/13 규칙을 충족하지 않을 경우 동적 과압 해석 검토가 필요합니다.',
    });
  }

  return {
    equipTag: inp.equipTag ?? 'PSV-101',
    equipName: inp.equipName ?? 'Pressure Safety Relief Valve',
    scenario,
    phase,
    W_kgh: Number(W_kgh.toFixed(2)),
    W_rated_kgh: Number(W_rated_kgh.toFixed(2)),
    Q_fire_kW: Number(Q_fire_kW.toFixed(2)),
    P_set_barG,
    P_back_barG: Number(P_back_barG.toFixed(3)),
    P1_barA: Number(P1_barA.toFixed(3)),
    P2_barA: Number(P2_barA.toFixed(3)),
    overpress_pct,
    r_crit: Number(r_crit.toFixed(4)),
    backPressRatio: Number(backPressRatio.toFixed(4)),
    isCritical,
    A_req_mm2: Number(A_req_mm2.toFixed(2)),
    A_req_in2: Number(A_req_in2.toFixed(4)),
    selectedOrifice,
    cap_utilization_pct: Number(cap_utilization_pct.toFixed(2)),
    iterations,
    warnings,

    valve_type,
    superimposed_backpress_barG: Number(superimposed_backpress_barG.toFixed(3)),
    builtup_backpress_barG: Number(builtup_backpress_barG.toFixed(3)),
    Kd,
    Kb: Number(Kb.toFixed(4)),
    Kw: Number(Kw.toFixed(4)),
    Kc,
    Kp: Number(Kp.toFixed(4)),
    Kv: Number(Kv.toFixed(4)),
    Kn: Number(Kn.toFixed(4)),
    Ksh: Number(Ksh.toFixed(4)),
    C_api: Number(C_api.toFixed(6)),
    F2: Number(F2.toFixed(4)),
    F_env,
    Re_orifice: Number(Re_orifice.toFixed(0)),
    parallelCount,
    mode: solverMode,

    omega,
    eta_crit,
    massFlux_kgm2s,
    isSubcooledFlashing,
    pipingCheck,
  };
}

/**
 * API 521 Multi-Scenario Governing Case Evaluator
 * Evaluates multiple relief scenarios (blocked_outlet, fire_case, tube_rupture, thermal_exp,
 * power_failure, cw_failure, reflux_failure) and identifies the governing case (largest A_req_mm2).
 */
export function solvePSVGoverningScenarios(
  scenarios: PSVScenarioCaseInput[],
  mode: PSVSolverMode | string = 'rigorous',
): PSVGoverningScenarioResult {
  const inputList: PSVScenarioCaseInput[] =
    scenarios.length > 0
      ? scenarios
      : [{ caseId: 'default', caseLabel: 'Blocked Outlet', scenario: 'blocked_outlet' }];

  const evaluated = inputList.map((sc, idx) => {
    const res = solvePSV(sc, mode);
    return {
      caseId: sc.caseId ?? `case_${idx + 1}`,
      caseLabel: sc.caseLabel ?? sc.scenario ?? `Scenario ${idx + 1}`,
      scenario: res.scenario,
      phase: res.phase,
      W_kgh: res.W_kgh,
      P_set_barG: res.P_set_barG,
      overpress_pct: res.overpress_pct,
      A_req_mm2: res.A_req_mm2,
      selectedOrifice: res.selectedOrifice,
      cap_utilization_pct: res.cap_utilization_pct,
      isGoverning: false,
      result: res,
    };
  });

  let governingIndex = 0;
  for (let i = 1; i < evaluated.length; i++) {
    if (evaluated[i].A_req_mm2 > evaluated[governingIndex].A_req_mm2) {
      governingIndex = i;
    }
  }
  evaluated[governingIndex].isGoverning = true;
  const governing = evaluated[governingIndex];

  const warnings: PSVWarningItem[] = [
    {
      level: 'ok',
      text: `지배 시나리오(Governing Case): ${governing.caseLabel} (${governing.scenario}) — A_req = ${governing.A_req_mm2.toFixed(1)} mm², API 526 '${governing.selectedOrifice.letter}' 오리피스(${governing.selectedOrifice.size}) 선정`,
    },
    ...governing.result.warnings.filter((w) => w.level !== 'ok'),
  ];

  return {
    governing,
    governingIndex,
    selectedOrifice: governing.selectedOrifice,
    cases: evaluated,
    warnings,
  };
}

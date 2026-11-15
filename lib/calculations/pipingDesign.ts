/**
 * Unified Industrial Piping & Multiphase Hydraulics Engine (ASME B31.3 / Crane TP-410 / API RP 14E)
 *
 * Single mathematical source of truth covering:
 * - Liquid service: Churchill (1977) full-regime Darcy-Weisbach + Crane TP-410 fitting K + static elevation
 * - Gas / vapor service: Isothermal compressible Darcy-Weisbach with Mach number & sonic choke checks
 * - Two-phase service: Friedel (1979) + Lockhart-Martinelli + Chisholm-B + Rouhani-Axelsson void fraction
 *   + Taitel-Dukler (1976) flow regime map + liquid holdup & slug/annular warnings
 * - API RP 14E erosional velocity, momentum flux (rho*v^2), and inverse max-flow bisection solver
 * - Full schedule candidate table (getPipeScheduleList) & multi-segment pipe network evaluation
 */

import {
  getFittingK,
  getPipeScheduleList,
  resolveFluidProps,
  type FluidProps as ChemproFluidProps,
  type PipeScheduleItem,
} from './chemproFluidBridge';
import {
  chisholmBGradient,
  churchillDarcy,
  friedelTwoPhaseGradient,
  homogeneousGradient,
  lockhartMartinelliGradient,
  singlePhaseGradient,
  voidFractionRouhani,
  voidFractionZivi,
  type TwoPhaseInput,
} from './twoPhaseHydraulics';
import {
  densityAtT,
  PIPE_SIZES,
  viscosityAtT,
  type FluidProps as LegacyFluidProps,
} from '../physicalProperties';

const G_ACCEL = 9.80665;
const R_GAS_SI = 8.314462618;
const P_ATM_BAR = 1.01325;
const API_RP_14E_C_SI = 122.0; // C = 100 in English units -> 122 m/s * (kg/m^3)^0.5

export type PipingFlowMode = 'liquid' | 'gas' | 'twophase';
export type PipingDofMode = 'calc_dp' | 'calc_max_flow';
export type TaitelDuklerRegime =
  | 'stratified_smooth'
  | 'stratified_wavy'
  | 'intermittent_slug'
  | 'dispersed_bubble'
  | 'annular';

export interface PipingIterationRow {
  iter: number;
  param: string;
  assumed: number;
  calc: number;
  err: number;
  note: string;
}

export interface PipingWarning {
  level: 'ok' | 'warn' | 'danger';
  text: string;
}

export interface TwoPhaseFlowDetails {
  regime: TaitelDuklerRegime;
  regimeLabel: string;
  quality: number;
  voidFraction: number;
  voidFractionZivi: number;
  liquidHoldup: number;
  phi2_Friedel: number;
  phi2_LM: number;
  X_martinelli: number;
  hL_over_D: number;
  v_sl: number;
  v_sg: number;
  rho_tp: number;
  rho_homog: number;
  dp_grav_bar: number;
  dp_acc_bar: number;
}

export interface PipingSolverInput {
  equipTag?: string;
  equipName?: string;
  fluidId?: string;
  T_C?: number;
  P1_barG?: number;
  flowMode?: 'liquid' | 'gas' | 'vapor' | 'twophase' | 'two_phase' | '2phase';
  phase?: 'liquid' | 'gas' | 'vapor' | 'twophase' | 'two_phase' | '2phase';
  dofMode?: PipingDofMode;
  schedule?: string;
  Q_m3h?: number;
  W_kgs?: number;
  rho?: number;
  mu_cP?: number;
  rhoL?: number;
  rhoG?: number;
  muL_cP?: number;
  muG_cP?: number;
  sigma_mNm?: number;
  mw?: number;
  gamma_k?: number;
  Z?: number;
  L_m?: number;
  dZ_m?: number;
  target_dp_bar?: number;
  dpLimit_bar?: number;
  maxDp?: number;
  vapor_wt_pct?: number;
  vaporFraction?: number;
  quality?: number;
  n_elbow90?: number;
  n_elbow45?: number;
  n_tee?: number;
  n_tee_thru?: number;
  n_gate?: number;
  n_globe?: number;
  n_check?: number;
  n_control?: number;
  K_extra?: number;
  rough_mm?: number;
  selected_nps_idx?: number;
  selected_nps?: string;
  v_target?: number;
  erosionC_SI?: number;
  includeSmallBore?: boolean;
}

export interface PipingSolverCandidate {
  idx: number;
  nps: string;
  dn: number;
  od_mm: number;
  wall_mm: number;
  id_mm: number;
  v: number;
  Re: number;
  f: number;
  mach: number;
  phi2_LM: number;
  dP_fric_bar: number;
  dP_fit_bar: number;
  dP_elev_bar: number;
  dP_total_bar: number;
  dP_100m_bar: number;
  Leq_m: number;
  v_erode_ms: number;
  rho_v2: number;
  velDiff: number;
  c_sound_ms?: number;
  phi2_Friedel?: number;
  phi2_LM_exact?: number;
  liquidHoldup?: number;
  voidFraction?: number;
  flowRegime?: TaitelDuklerRegime;
  v_sg?: number;
  v_sl?: number;
  dp_grav_bar?: number;
  dp_acc_bar?: number;
  choked?: boolean;
}

export interface PipingSolverResult {
  equipTag: string;
  equipName: string;
  Q_m3h: number;
  W_kgs: number;
  flowMode: PipingFlowMode;
  dofMode: PipingDofMode;
  schedule: string;
  selected: PipingSolverCandidate;
  recommended: PipingSolverCandidate;
  candidates: PipingSolverCandidate[];
  sumK: number;
  iterations: PipingIterationRow[];
  warnings: PipingWarning[];
  c_sound_ms?: number;
  mach?: number;
  flowRegime?: TaitelDuklerRegime;
  liquidHoldup?: number;
  voidFraction?: number;
  twoPhaseDetails?: TwoPhaseFlowDetails;
  mode?: 'quick' | 'rigorous';
  fluidName?: string;
  rho?: number;
  mu_cP?: number;
}

// Legacy facade fitting catalog & types mirrored cleanly for lib/pipePressureDrop.ts
export interface FittingType {
  key: string;
  name: string;
  nameKo: string;
  K: number;
}

export const FITTING_TYPES: FittingType[] = [
  { key: 'elbow_90_std',  name: '90° std elbow',       nameKo: '90° 엘보 (표준)',   K: 0.75 },
  { key: 'elbow_90_lr',   name: '90° LR elbow',        nameKo: '90° 엘보 (LR)',     K: 0.45 },
  { key: 'elbow_45',      name: '45° elbow',            nameKo: '45° 엘보',          K: 0.35 },
  { key: 'tee_flow',      name: 'Tee (through)',        nameKo: '티 (직류)',          K: 0.20 },
  { key: 'tee_branch',    name: 'Tee (branch)',         nameKo: '티 (분기)',          K: 1.00 },
  { key: 'gate_open',     name: 'Gate valve (open)',    nameKo: '게이트 밸브 (전개)', K: 0.13 },
  { key: 'globe_open',    name: 'Globe valve (open)',   nameKo: '글로브 밸브 (전개)', K: 4.50 },
  { key: 'ball_open',     name: 'Ball valve (open)',    nameKo: '볼 밸브 (전개)',     K: 0.05 },
  { key: 'butterfly',     name: 'Butterfly valve',     nameKo: '버터플라이 밸브',    K: 0.60 },
  { key: 'check_swing',   name: 'Check valve (swing)', nameKo: '체크 밸브 (스윙)',   K: 2.50 },
  { key: 'check_lift',    name: 'Check valve (lift)',  nameKo: '체크 밸브 (리프트)', K: 5.00 },
  { key: 'reducer',       name: 'Reducer',             nameKo: '리듀서',             K: 0.05 },
  { key: 'entrance',      name: 'Entrance (sharp)',    nameKo: '입구 (직각)',         K: 0.50 },
  { key: 'exit',          name: 'Exit',                nameKo: '출구',               K: 1.00 },
  { key: 'strainer_y',    name: 'Y-Strainer',          nameKo: 'Y형 스트레이너',     K: 1.50 },
  { key: 'orifice',       name: 'Orifice plate',       nameKo: '오리피스',           K: 3.00 },
  { key: 'control_valve', name: 'Control valve',       nameKo: '컨트롤 밸브',        K: 8.00 },
];

const FITTING_K_MAP: Record<string, number> = Object.fromEntries(
  FITTING_TYPES.map((ft) => [ft.key, ft.K]),
);

export interface PipeFitting {
  fittingKey: string;
  count: number;
}

export interface PipeSegment {
  id: string;
  label: string;
  D_mm: number;
  length_m: number;
  roughness_mm: number;
  fittings: PipeFitting[];
  elevation_m: number;
}

export interface PipeSegmentResult {
  segment: PipeSegment;
  velocity_ms: number;
  Re: number;
  frictionFactor: number;
  dP_friction_kPa: number;
  dP_fittings_kPa: number;
  dP_elevation_kPa: number;
  dP_total_kPa: number;
  K_total: number;
}

export interface PipeCalcResult {
  flowRate_m3h: number;
  segments: PipeSegmentResult[];
  dP_friction_total_kPa: number;
  dP_fittings_total_kPa: number;
  dP_elevation_total_kPa: number;
  dP_total_kPa: number;
  dP_total_mH2O: number;
  dP_total_bar: number;
}

// ---------------------------------------------------------------------------
// Core Single-Phase Hydraulic Helpers (Churchill 1977)
// ---------------------------------------------------------------------------

/**
 * Churchill (1977) explicit full-regime Darcy-Weisbach friction factor.
 * Accurate across laminar (Re <= 2100), transition (2100 < Re < 4000), and turbulent regimes.
 */
export function calcChurchillFrictionFactor(Re: number, eps_m: number, D_m: number): number {
  if (Re <= 0 || D_m <= 0) return 0;
  const relRough = Math.max(0, eps_m) / D_m;
  return churchillDarcy(Re, relRough);
}

/**
 * Reynolds number Re = rho * v * D / mu.
 */
export function calcReynoldsNumber(rho: number, v: number, D_m: number, mu_mPas: number): number {
  const mu_Pas = mu_mPas * 1e-3;
  if (mu_Pas <= 0 || D_m <= 0 || rho <= 0) return 0;
  return (rho * Math.abs(v) * D_m) / mu_Pas;
}

/**
 * Internal pipe cross-sectional area [m^2] from inside diameter [mm].
 */
export function calcPipeArea(D_mm: number): number {
  const D_m = D_mm / 1000;
  return (Math.PI * D_m * D_m) / 4;
}

/**
 * Bulk fluid velocity [m/s] from volumetric flow [m^3/h] and inside diameter [mm].
 */
export function calcFlowVelocity(flowRate_m3h: number, D_mm: number): number {
  const area = calcPipeArea(D_mm);
  if (area <= 0) return 0;
  return (flowRate_m3h / 3600) / area;
}

// ---------------------------------------------------------------------------
// Two-Phase Taitel-Dukler (1976) Flow Regime Map
// ---------------------------------------------------------------------------

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

function stratifiedGeometry(hL_over_D: number) {
  const h = clamp(hL_over_D, 0.005, 0.995);
  const cosArg = clamp(1 - 2 * h, -1, 1);
  const gamma = Math.acos(cosArg); // half-angle wetted by liquid [0..pi]
  const sinG = Math.sin(gamma);
  const sin2G = Math.sin(2 * gamma);

  const AL = 0.25 * (gamma - 0.5 * sin2G); // normalized A_L / D^2 (actually / D^2, since pi/4 total)
  const AG = Math.PI / 4 - AL;
  const SL = gamma; // S_L / D
  const SG = Math.PI - gamma; // S_G / D
  const Si = sinG; // S_i / D
  const dAL_dhL = 2 * sinG; // d(A_L/D^2)/d(h_L/D)

  const uL = (Math.PI / 4) / Math.max(AL, 1e-6);
  const uG = (Math.PI / 4) / Math.max(AG, 1e-6);
  const DL = (4 * AL) / Math.max(SL, 1e-6);
  const DG = (4 * AG) / Math.max(SG + Si, 1e-6);

  return { AL, AG, SL, SG, Si, dAL_dhL, uL, uG, DL, DG };
}

function solveStratifiedHeight(X: number, Y: number, turbL: boolean, turbG: boolean): number {
  const n = turbL ? 0.2 : 1.0;
  const m = turbG ? 0.2 : 1.0;
  const evalResidual = (h: number): number => {
    const g = stratifiedGeometry(h);
    const termL = X * X * Math.pow(g.uL * g.DL, -n) * g.uL * g.uL * (g.SL / g.AL);
    const termG =
      Math.pow(g.uG * g.DG, -m) * g.uG * g.uG * ((g.SG + g.Si) / g.AG + g.Si / g.AL);
    return termL - termG - 4 * Y;
  };

  let lo = 0.01;
  let hi = 0.99;
  const fLo = evalResidual(lo);
  const fHi = evalResidual(hi);
  if (fLo <= 0) return lo;
  if (fHi >= 0) return hi;

  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    const fMid = evalResidual(mid);
    if (fMid > 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-4) break;
  }
  return 0.5 * (lo + hi);
}

/**
 * Taitel-Dukler (1976) mechanistic horizontal / near-horizontal two-phase flow regime classifier.
 */
export function classifyTaitelDuklerRegime(params: {
  v_sl: number;
  v_sg: number;
  rhoL: number;
  rhoG: number;
  muL_Pas: number;
  muG_Pas: number;
  diamM: number;
  roughnessM?: number;
  inclinationRad?: number;
}): {
  regime: TaitelDuklerRegime;
  regimeLabel: string;
  hL_over_D: number;
  X_martinelli: number;
  F: number;
  K: number;
  T: number;
} {
  const {
    v_sl,
    v_sg,
    rhoL,
    rhoG,
    muL_Pas,
    muG_Pas,
    diamM,
    roughnessM = 4.6e-5,
    inclinationRad = 0,
  } = params;

  const vSL = Math.max(v_sl, 1e-6);
  const vSG = Math.max(v_sg, 1e-6);
  const G_L = rhoL * vSL;
  const G_G = rhoG * vSG;

  const dPdz_L = singlePhaseGradient(G_L, rhoL, muL_Pas, diamM, roughnessM);
  const dPdz_G = singlePhaseGradient(G_G, rhoG, muG_Pas, diamM, roughnessM);
  const X = Math.sqrt(Math.max(dPdz_L, 1e-12) / Math.max(dPdz_G, 1e-12));

  const cosTheta = Math.max(0.1, Math.cos(inclinationRad));
  const sinTheta = Math.sin(inclinationRad);
  const deltaRho = Math.max(rhoL - rhoG, 1e-3);
  const Y = (deltaRho * G_ACCEL * sinTheta) / Math.max(dPdz_G, 1e-12);

  const Re_SL = (rhoL * vSL * diamM) / Math.max(muL_Pas, 1e-9);
  const Re_SG = (rhoG * vSG * diamM) / Math.max(muG_Pas, 1e-9);
  const hL_over_D = solveStratifiedHeight(X, Y, Re_SL > 2100, Re_SG > 2100);
  const geom = stratifiedGeometry(hL_over_D);

  // Dimensionless Taitel-Dukler groups
  const F = Math.sqrt(rhoG / deltaRho) * (vSG / Math.sqrt(diamM * G_ACCEL * cosTheta));
  const K = F * Math.sqrt(Math.max(Re_SL, 1));
  const T = Math.sqrt(Math.max(dPdz_L, 1e-12) / (deltaRho * G_ACCEL * cosTheta));

  // Transition A: Stratified vs Non-stratified (Kelvin-Helmholtz wave growth)
  const C2 = 1 - hL_over_D;
  const K2_strat = Math.max(
    1e-6,
    (C2 * C2 * geom.uG * geom.uG * geom.dAL_dhL) / Math.max(geom.AG, 1e-6),
  );
  const isStratified = F * F * K2_strat < 1.0;

  let regime: TaitelDuklerRegime;
  if (isStratified) {
    // Transition B: Stratified Smooth vs Stratified Wavy (Jeffreys sheltering coefficient s = 0.01 -> K_crit = 2/(sqrt(uL)*...) ~ 1.6..2.0)
    const kCrit = 2.0 / Math.sqrt(Math.max(geom.uL * (0.01 * geom.uG), 1e-4));
    regime = K >= kCrit ? 'stratified_wavy' : 'stratified_smooth';
  } else if (hL_over_D < 0.35) {
    // Transition C: Low equilibrium liquid holdup fraction -> Annular / Annular-Mist
    regime = 'annular';
  } else {
    // Transition D: Intermittent (Slug/Elongated Bubble) vs Dispersed Bubble (turbulent break-up vs buoyancy)
    const nL = Re_SL > 2100 ? 0.2 : 1.0;
    const critT = Math.sqrt(
      (8 * geom.AG) / Math.max(geom.Si * geom.uL * geom.uL * Math.pow(geom.uL * geom.DL, -nL), 1e-6),
    );
    regime = T >= critT ? 'dispersed_bubble' : 'intermittent_slug';
  }

  const labelMap: Record<TaitelDuklerRegime, string> = {
    stratified_smooth: 'Stratified Smooth',
    stratified_wavy: 'Stratified Wavy',
    intermittent_slug: 'Intermittent / Slug Flow',
    dispersed_bubble: 'Dispersed Bubble',
    annular: 'Annular / Mist Flow',
  };

  return {
    regime,
    regimeLabel: labelMap[regime],
    hL_over_D,
    X_martinelli: X,
    F,
    K,
    T,
  };
}

// ---------------------------------------------------------------------------
// Fluid, Fitting, and Schedule Resolution Helpers
// ---------------------------------------------------------------------------

interface ResolvedServiceProps {
  flowMode: PipingFlowMode;
  fluid: ChemproFluidProps;
  T_C: number;
  P1_abs_bar: number;
  rhoL: number;
  rhoG: number;
  muL_cP: number;
  muG_cP: number;
  sigma_Nm: number;
  mw: number;
  gamma_k: number;
  Z: number;
  c_sound_ms: number;
  quality: number;
  inclinationRad: number;
}

function resolveFlowMode(inp: PipingSolverInput): PipingFlowMode {
  const raw = String(inp.flowMode ?? inp.phase ?? '').toLowerCase().trim();
  if (raw === 'twophase' || raw === 'two_phase' || raw === '2phase') return 'twophase';
  if (raw === 'gas' || raw === 'vapor') return 'gas';
  if (raw === 'liquid') return 'liquid';

  const qFrac = inp.vaporFraction ?? inp.quality;
  if (qFrac !== undefined && qFrac > 0 && qFrac < 1) return 'twophase';
  if (inp.rhoG !== undefined && inp.rhoL !== undefined) return 'twophase';
  return 'liquid';
}

function resolveServiceProps(inp: PipingSolverInput): ResolvedServiceProps {
  const T_C = inp.T_C ?? 25;
  const T_K = T_C + 273.15;
  const P1_abs_bar = Math.max((inp.P1_barG ?? 0) + P_ATM_BAR, 0.05);
  const fluid = resolveFluidProps(inp.fluidId ?? 'water', T_C);
  const flowMode = resolveFlowMode(inp);

  const mw = inp.mw && inp.mw > 0 ? inp.mw : fluid.mw > 0 ? fluid.mw : 28.97;
  const gamma_k = inp.gamma_k && inp.gamma_k > 0 ? inp.gamma_k : fluid.k > 1 ? fluid.k : 1.4;
  const Z = inp.Z && inp.Z > 0 ? inp.Z : 1.0;

  const rhoL = Math.max(1e-3, inp.rhoL ?? (flowMode !== 'gas' ? inp.rho : undefined) ?? fluid.rho ?? 998.2);
  const rhoGIdeal = (P1_abs_bar * 1e5 * (mw * 1e-3)) / (Z * R_GAS_SI * T_K);
  const rhoG = Math.max(1e-4, inp.rhoG ?? (flowMode === 'gas' ? inp.rho : undefined) ?? rhoGIdeal);

  const muL_cP = Math.max(1e-4, inp.muL_cP ?? (flowMode !== 'gas' ? inp.mu_cP : undefined) ?? fluid.mu ?? 1.0);
  const muG_cP = Math.max(
    1e-4,
    inp.muG_cP ?? (flowMode === 'gas' ? inp.mu_cP : undefined) ?? 0.015,
  );
  const sigma_Nm = Math.max(1e-4, (inp.sigma_mNm ?? fluid.sigma ?? 30) * 1e-3);
  const c_sound_ms = Math.sqrt((gamma_k * Z * 8314.462618 * T_K) / mw);

  let quality = 0.2;
  if (flowMode === 'twophase') {
    const rawQ =
      inp.vaporFraction ??
      inp.quality ??
      (inp.vapor_wt_pct !== undefined ? inp.vapor_wt_pct / 100 : 0.2);
    quality = clamp(rawQ, 0.001, 0.999);
  } else if (flowMode === 'gas') {
    quality = 1.0;
  } else {
    quality = 0.0;
  }

  const L_m = Math.max(inp.L_m ?? 100, 1e-3);
  const dZ_m = inp.dZ_m ?? 0;
  const inclinationRad = Math.asin(clamp(dZ_m / L_m, -1, 1));

  return {
    flowMode,
    fluid,
    T_C,
    P1_abs_bar,
    rhoL,
    rhoG,
    muL_cP,
    muG_cP,
    sigma_Nm,
    mw,
    gamma_k,
    Z,
    c_sound_ms,
    quality,
    inclinationRad,
  };
}

function buildScheduleList(scheduleKey: string, includeSmallBore?: boolean): PipeScheduleItem[] {
  const base = getPipeScheduleList(scheduleKey);
  if (!includeSmallBore) return base;

  const extraNames = ['1/2"', '3/4"'];
  const smallItems: PipeScheduleItem[] = [];
  for (const npsName of extraNames) {
    if (base.some((b) => b.nps === npsName)) continue;
    const match = PIPE_SIZES.find((p) => p.NPS === npsName);
    if (!match) continue;
    const keyUpper = scheduleKey.toUpperCase();
    const wall =
      keyUpper === '80'
        ? (match.schedule['80'] ?? match.schedule['40'])
        : keyUpper === '10S'
          ? (match.schedule['10S'] ?? match.schedule['40'])
          : match.schedule['40'];
    if (wall) {
      smallItems.push({
        nps: match.NPS,
        dn: match.DN,
        od: match.OD_mm,
        wall,
        id: Number((match.OD_mm - 2 * wall).toFixed(2)),
      });
    }
  }
  return [...smallItems, ...base];
}

function computeTotalFittingK(inp: PipingSolverInput): number {
  const K = getFittingK();
  return (
    (inp.n_elbow90 ?? 0) * (K.elbow90 ?? 0.75) +
    (inp.n_elbow45 ?? 0) * (K.elbow45 ?? 0.35) +
    (inp.n_tee ?? 0) * (K.teeBranch ?? 1.5) +
    (inp.n_tee_thru ?? 0) * (K.teeThru ?? 0.4) +
    (inp.n_gate ?? 0) * (K.gateValve ?? 0.17) +
    (inp.n_globe ?? 0) * (K.globeValve ?? 6.0) +
    (inp.n_check ?? 0) * (K.checkValve ?? 2.0) +
    (inp.n_control ?? 0) * (K.controlValve ?? 8.5) +
    (inp.K_extra ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Single Pipe Candidate Evaluator (Liquid / Gas Compressible / Two-Phase)
// ---------------------------------------------------------------------------

interface InternalCandidateEval {
  candidate: PipingSolverCandidate;
  twoPhase?: TwoPhaseFlowDetails;
}

function evaluatePipeCandidate(
  item: PipeScheduleItem,
  idx: number,
  Q_m3h: number,
  W_kgs: number,
  sumK: number,
  L_m: number,
  dZ_m: number,
  rough_mm: number,
  v_target: number,
  erosionC: number,
  svc: ResolvedServiceProps,
): InternalCandidateEval {
  const D_m = item.id / 1000;
  const eps_m = rough_mm / 1000;
  const area = (Math.PI * D_m * D_m) / 4;
  const G = area > 0 ? W_kgs / area : 0;

  if (svc.flowMode === 'liquid') {
    const v = area > 0 ? (Q_m3h / 3600) / area : 0;
    const Re = calcReynoldsNumber(svc.rhoL, v, D_m, svc.muL_cP);
    const f = calcChurchillFrictionFactor(Re, eps_m, D_m);
    const qDyn = 0.5 * svc.rhoL * v * v;
    const dP_fric_bar = (f * (L_m / D_m) * qDyn) / 1e5;
    const dP_fit_bar = (sumK * qDyn) / 1e5;
    const dP_elev_bar = (svc.rhoL * G_ACCEL * dZ_m) / 1e5;
    const dP_total_bar = dP_fric_bar + dP_fit_bar + dP_elev_bar;
    const dP_100m_bar = L_m > 0 ? (dP_fric_bar / L_m) * 100 : 0;
    const Leq_m = f > 0 ? (sumK * D_m) / f : 0;
    const v_erode_ms = erosionC / Math.sqrt(svc.rhoL);
    const rho_v2 = svc.rhoL * v * v;

    return {
      candidate: {
        idx,
        nps: item.nps,
        dn: item.dn,
        od_mm: item.od,
        wall_mm: item.wall,
        id_mm: item.id,
        v,
        Re,
        f,
        mach: 0,
        phi2_LM: 1,
        dP_fric_bar,
        dP_fit_bar,
        dP_elev_bar,
        dP_total_bar,
        dP_100m_bar,
        Leq_m,
        v_erode_ms,
        rho_v2,
        velDiff: Math.abs(v - v_target),
      },
    };
  }

  if (svc.flowMode === 'gas') {
    const v_in = area > 0 ? (W_kgs / svc.rhoG) / area : 0;
    const Re = calcReynoldsNumber(svc.rhoG, v_in, D_m, svc.muG_cP);
    const f = calcChurchillFrictionFactor(Re, eps_m, D_m);
    const K_fric = f * (L_m / D_m);
    const K_tot = K_fric + sumK;
    const P1_Pa = svc.P1_abs_bar * 1e5;

    // Isothermal compressible Darcy-Weisbach with sonic outlet protection
    const machLimit = 1 / Math.sqrt(svc.gamma_k);
    const P_sonic_Pa = P1_Pa * Math.min(0.999, (v_in / svc.c_sound_ms) / Math.max(machLimit, 0.5));
    let P2_Pa = Math.max(P1_Pa - K_tot * 0.5 * svc.rhoG * v_in * v_in, 0.05 * P1_Pa);
    let choked = false;

    for (let it = 0; it < 8; it++) {
      const ratio = clamp(P1_Pa / Math.max(P2_Pa, 1e3), 1, 50);
      const rhs = P1_Pa * P1_Pa - ((G * G * P1_Pa) / svc.rhoG) * (K_tot + 2 * Math.log(ratio));
      if (rhs <= P_sonic_Pa * P_sonic_Pa) {
        P2_Pa = Math.max(P_sonic_Pa, 0.1 * P1_Pa);
        choked = true;
        break;
      }
      const nextP2 = Math.sqrt(rhs);
      if (Math.abs(nextP2 - P2_Pa) < 1) {
        P2_Pa = nextP2;
        break;
      }
      P2_Pa = 0.5 * (P2_Pa + nextP2);
    }

    const rho_out = svc.rhoG * (P2_Pa / P1_Pa);
    const v_out = area > 0 ? (W_kgs / Math.max(rho_out, 1e-4)) / area : 0;
    const mach_out = v_out / svc.c_sound_ms;
    if (mach_out >= 1.0) choked = true;

    const dP_dyn_bar = Math.max(0, (P1_Pa - P2_Pa) / 1e5);
    const fricShare = K_tot > 0 ? K_fric / K_tot : 1;
    const dP_fric_bar = dP_dyn_bar * fricShare;
    const dP_fit_bar = dP_dyn_bar * (1 - fricShare);
    const rho_avg = 0.5 * (svc.rhoG + rho_out);
    const dP_elev_bar = (rho_avg * G_ACCEL * dZ_m) / 1e5;
    const dP_total_bar = dP_fric_bar + dP_fit_bar + dP_elev_bar;
    const dP_100m_bar = L_m > 0 ? (dP_fric_bar / L_m) * 100 : 0;
    const Leq_m = f > 0 ? (sumK * D_m) / f : 0;
    const v_erode_ms = erosionC / Math.sqrt(rho_avg);
    const rho_v2 = svc.rhoG * v_in * v_in;

    return {
      candidate: {
        idx,
        nps: item.nps,
        dn: item.dn,
        od_mm: item.od,
        wall_mm: item.wall,
        id_mm: item.id,
        v: v_in,
        Re,
        f,
        mach: mach_out,
        phi2_LM: 1,
        dP_fric_bar,
        dP_fit_bar,
        dP_elev_bar,
        dP_total_bar,
        dP_100m_bar,
        Leq_m,
        v_erode_ms,
        rho_v2,
        velDiff: Math.abs(v_in - v_target),
        c_sound_ms: svc.c_sound_ms,
        choked,
      },
    };
  }

  // Two-phase service: Friedel + Lockhart-Martinelli + Chisholm-B + Rouhani-Axelsson + Taitel-Dukler
  const x = svc.quality;
  const muL_Pas = svc.muL_cP * 1e-3;
  const muG_Pas = svc.muG_cP * 1e-3;
  const tpInput: TwoPhaseInput = {
    massFluxKgM2s: G,
    quality: x,
    rhoL: svc.rhoL,
    rhoG: svc.rhoG,
    muL: muL_Pas,
    muG: muG_Pas,
    sigma: svc.sigma_Nm,
    diamM: D_m,
    roughnessM: eps_m,
  };

  const friedel = friedelTwoPhaseGradient(tpInput);
  const lm = lockhartMartinelliGradient(tpInput);
  const chisholm = chisholmBGradient(tpInput);
  const homog = homogeneousGradient(tpInput);
  const voidRouhani = voidFractionRouhani(tpInput);
  const voidZivi = voidFractionZivi(x, svc.rhoL, svc.rhoG);
  const liquidHoldup = 1 - voidRouhani;
  const rho_tp = voidRouhani * svc.rhoG + liquidHoldup * svc.rhoL;

  const v_sl = (G * (1 - x)) / svc.rhoL;
  const v_sg = (G * x) / svc.rhoG;
  const v = v_sl + v_sg;
  const Re = (G * D_m) / Math.max(homog.muH, 1e-9);
  const f = calcChurchillFrictionFactor(Re, eps_m, D_m);

  const td = classifyTaitelDuklerRegime({
    v_sl,
    v_sg,
    rhoL: svc.rhoL,
    rhoG: svc.rhoG,
    muL_Pas,
    muG_Pas,
    diamM: D_m,
    roughnessM: eps_m,
    inclinationRad: svc.inclinationRad,
  });

  const dP_fric_bar = (friedel.dPdzPaPerM * L_m) / 1e5;
  // Chisholm-B two-phase multiplier for minor losses / fittings
  const dP_fit_bar = (chisholm.phiLO2 * sumK * ((G * G) / (2 * svc.rhoL))) / 1e5;
  const dP_elev_bar = (rho_tp * G_ACCEL * dZ_m) / 1e5;

  // Acceleration pressure drop term from slight density relaxation along frictional loss
  const P1_Pa = svc.P1_abs_bar * 1e5;
  const dP_est_Pa = (dP_fric_bar + dP_fit_bar) * 1e5;
  const P2_est_Pa = Math.max(0.2 * P1_Pa, P1_Pa - dP_est_Pa);
  const rhoG_out = svc.rhoG * (P2_est_Pa / P1_Pa);
  const alpha_in = Math.max(0.01, Math.min(0.999, voidRouhani));
  const invRhoMom = (pGas: number, alpha: number) =>
    (x * x) / (pGas * alpha) + ((1 - x) * (1 - x)) / (svc.rhoL * Math.max(0.01, 1 - alpha));
  const dP_acc_bar = Math.max(0, (G * G * (invRhoMom(rhoG_out, alpha_in) - invRhoMom(svc.rhoG, alpha_in))) / 1e5);

  const dP_total_bar = dP_fric_bar + dP_fit_bar + dP_elev_bar + dP_acc_bar;
  const dP_100m_bar = L_m > 0 ? (dP_fric_bar / L_m) * 100 : 0;
  const Leq_m = f > 0 ? (sumK * D_m) / f : 0;
  const v_erode_ms = erosionC / Math.sqrt(Math.max(homog.rhoH, 1e-4));
  const rho_v2 = homog.rhoH * v * v;
  const mach = svc.c_sound_ms > 0 ? v_sg / svc.c_sound_ms : 0;

  return {
    candidate: {
      idx,
      nps: item.nps,
      dn: item.dn,
      od_mm: item.od,
      wall_mm: item.wall,
      id_mm: item.id,
      v,
      Re,
      f,
      mach,
      phi2_LM: friedel.phiLO2,
      dP_fric_bar,
      dP_fit_bar,
      dP_elev_bar,
      dP_total_bar,
      dP_100m_bar,
      Leq_m,
      v_erode_ms,
      rho_v2,
      velDiff: Math.abs(v - v_target),
      c_sound_ms: svc.c_sound_ms,
      phi2_Friedel: friedel.phiLO2,
      phi2_LM_exact: lm.phiL2,
      liquidHoldup,
      voidFraction: voidRouhani,
      flowRegime: td.regime,
      v_sg,
      v_sl,
      dp_grav_bar: dP_elev_bar,
      dp_acc_bar: dP_acc_bar,
    },
    twoPhase: {
      regime: td.regime,
      regimeLabel: td.regimeLabel,
      quality: x,
      voidFraction: voidRouhani,
      voidFractionZivi: voidZivi,
      liquidHoldup,
      phi2_Friedel: friedel.phiLO2,
      phi2_LM: lm.phiL2,
      X_martinelli: lm.X,
      hL_over_D: td.hL_over_D,
      v_sl,
      v_sg,
      rho_tp,
      rho_homog: homog.rhoH,
      dp_grav_bar: dP_elev_bar,
      dp_acc_bar: dP_acc_bar,
    },
  };
}

function pickSelectedIndex(inp: PipingSolverInput, scheduleList: PipeScheduleItem[]): number {
  if (inp.selected_nps) {
    const found = scheduleList.findIndex(
      (s) => s.nps.replace(/"/g, '').trim() === inp.selected_nps!.replace(/"/g, '').trim(),
    );
    if (found >= 0) return found;
  }
  const rawIdx = inp.selected_nps_idx ?? Math.min(4, scheduleList.length - 1);
  return clamp(Math.round(rawIdx), 0, Math.max(0, scheduleList.length - 1));
}

function pickRecommendedCandidate(
  candidates: PipingSolverCandidate[],
  flowMode: PipingFlowMode,
  v_target: number,
  dpLimitBar?: number,
): PipingSolverCandidate {
  const viable = candidates.filter((c) => {
    if (c.choked) return false;
    if (c.v > 0.9 * c.v_erode_ms) return false;
    if (flowMode === 'gas' && c.mach > 0.35) return false;
    if (dpLimitBar !== undefined && dpLimitBar > 0 && c.dP_total_bar > dpLimitBar) return false;
    return true;
  });

  const pool = viable.length > 0 ? viable : candidates;
  return pool.reduce((best, cur) => {
    const scoreCur = Math.abs(cur.v - v_target) + (cur.v > cur.v_erode_ms ? 100 : 0);
    const scoreBest = Math.abs(best.v - v_target) + (best.v > best.v_erode_ms ? 100 : 0);
    return scoreCur < scoreBest ? cur : best;
  }, pool[0]);
}

function resolveFlowRates(
  inp: PipingSolverInput,
  svc: ResolvedServiceProps,
): { Q_m3h: number; W_kgs: number; rho_mix: number } {
  const rho_mix =
    svc.flowMode === 'liquid'
      ? svc.rhoL
      : svc.flowMode === 'gas'
        ? svc.rhoG
        : 1 / (svc.quality / svc.rhoG + (1 - svc.quality) / svc.rhoL);

  if (inp.W_kgs !== undefined && inp.W_kgs > 0) {
    const Q_m3h = inp.Q_m3h && inp.Q_m3h > 0 ? inp.Q_m3h : (inp.W_kgs * 3600) / rho_mix;
    return { Q_m3h, W_kgs: inp.W_kgs, rho_mix };
  }
  const Q_m3h = Math.max(0.01, inp.Q_m3h ?? 50);
  const W_kgs = (Q_m3h * rho_mix) / 3600;
  return { Q_m3h, W_kgs, rho_mix };
}

function runMaxFlowBisection(
  selectedItem: PipeScheduleItem,
  selectedIdx: number,
  dpLimitBar: number,
  rho_mix: number,
  sumK: number,
  L_m: number,
  dZ_m: number,
  rough_mm: number,
  v_target: number,
  erosionC: number,
  svc: ResolvedServiceProps,
): { Q_max_m3h: number; W_max_kgs: number; iterations: PipingIterationRow[]; infeasible: boolean } {
  const iterations: PipingIterationRow[] = [];
  const dpAtQ = (q: number) =>
    evaluatePipeCandidate(
      selectedItem,
      selectedIdx,
      q,
      (q * rho_mix) / 3600,
      sumK,
      L_m,
      dZ_m,
      rough_mm,
      v_target,
      erosionC,
      svc,
    ).candidate.dP_total_bar;

  const dpZero = dpAtQ(1e-4);
  if (dpZero >= dpLimitBar) {
    iterations.push({
      iter: 1,
      param: 'Q_max_m3h',
      assumed: 0,
      calc: dpZero,
      err: dpZero - dpLimitBar,
      note: 'Static head alone exceeds dpLimit_bar',
    });
    return { Q_max_m3h: 0.01, W_max_kgs: (0.01 * rho_mix) / 3600, iterations, infeasible: true };
  }

  let lo = 1e-3;
  let hi = 10;
  for (let b = 0; b < 25 && dpAtQ(hi) < dpLimitBar; b++) {
    hi *= 2;
  }

  for (let iter = 1; iter <= 45; iter++) {
    const mid = 0.5 * (lo + hi);
    const dpMid = dpAtQ(mid);
    const err = dpMid - dpLimitBar;
    if (iter <= 10 || Math.abs(err) < 1e-4 || iter === 45) {
      iterations.push({
        iter,
        param: 'Q_max_m3h',
        assumed: Number(mid.toFixed(4)),
        calc: Number(dpMid.toFixed(5)),
        err: Number(Math.abs(err).toFixed(5)),
        note: `Bisect [${lo.toFixed(2)}, ${hi.toFixed(2)}] bar limit=${dpLimitBar.toFixed(3)}`,
      });
    }
    if (err < 0) lo = mid;
    else hi = mid;
    if (Math.abs(err) < 1e-5 || hi - lo < 1e-4) break;
  }

  const Q_max_m3h = 0.5 * (lo + hi);
  const W_max_kgs = (Q_max_m3h * rho_mix) / 3600;
  return { Q_max_m3h, W_max_kgs, iterations, infeasible: false };
}

function buildPipingWarnings(
  selected: PipingSolverCandidate,
  svc: ResolvedServiceProps,
  twoPhase: TwoPhaseFlowDetails | undefined,
  dpLimitBar: number | undefined,
  infeasibleMaxFlow: boolean,
): PipingWarning[] {
  const warnings: PipingWarning[] = [];

  if (infeasibleMaxFlow) {
    warnings.push({
      level: 'danger',
      text: 'Static elevation head exceeds target allowable pressure drop; zero flow achievable.',
    });
  }
  if (selected.choked) {
    warnings.push({
      level: 'danger',
      text: `Sonic choking reached in ${selected.nps} (Ma=${selected.mach.toFixed(2)} >= 1.0); upsize line diameter.`,
    });
  } else if (svc.flowMode === 'gas' && selected.mach > 0.3) {
    warnings.push({
      level: 'warn',
      text: `High gas Mach number Ma=${selected.mach.toFixed(2)} (> 0.30); acoustic vibration risk.`,
    });
  }

  if (selected.v > selected.v_erode_ms) {
    warnings.push({
      level: 'danger',
      text: `Velocity ${selected.v.toFixed(2)} m/s exceeds API RP 14E erosional limit ${selected.v_erode_ms.toFixed(2)} m/s.`,
    });
  } else if (selected.v > 0.85 * selected.v_erode_ms) {
    warnings.push({
      level: 'warn',
      text: `Velocity ${selected.v.toFixed(2)} m/s is within 15% of API RP 14E erosional limit (${selected.v_erode_ms.toFixed(2)} m/s).`,
    });
  }

  if (selected.rho_v2 > 1500 && svc.flowMode === 'twophase') {
    warnings.push({
      level: 'warn',
      text: `High two-phase momentum flux rho*v^2 = ${selected.rho_v2.toFixed(0)} Pa (> 1500 Pa); pipe support/FIV check advised.`,
    });
  }

  if (twoPhase?.regime === 'intermittent_slug') {
    warnings.push({
      level: 'warn',
      text: `Taitel-Dukler slug flow regime predicted (hL/D=${twoPhase.hL_over_D.toFixed(2)}, liquid holdup=${(twoPhase.liquidHoldup * 100).toFixed(1)}%); check slug catcher & pipe restraints.`,
    });
  } else if (twoPhase?.regime === 'annular') {
    warnings.push({
      level: 'warn',
      text: `Taitel-Dukler annular/mist regime predicted (void fraction=${(twoPhase.voidFraction * 100).toFixed(1)}%); verify impingement corrosion allowance.`,
    });
  }

  if (dpLimitBar !== undefined && dpLimitBar > 0 && selected.dP_total_bar > dpLimitBar) {
    warnings.push({
      level: 'warn',
      text: `Total pressure drop ${selected.dP_total_bar.toFixed(3)} bar exceeds limit ${dpLimitBar.toFixed(3)} bar.`,
    });
  }

  if (warnings.length === 0) {
    warnings.push({
      level: 'ok',
      text: `${selected.nps} satisfies velocity (${selected.v.toFixed(2)} m/s < ${selected.v_erode_ms.toFixed(2)} m/s) and pressure-drop limits.`,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Public ChemPro-Superset Piping Solver Entrypoint
// ---------------------------------------------------------------------------

/**
 * Solve industrial pipe sizing and pressure drop across liquid, compressible gas,
 * and two-phase gas-liquid regimes with full EngSolvers output key parity.
 */
export function solvePiping(
  inp: PipingSolverInput,
  mode: 'quick' | 'rigorous' = 'rigorous',
): PipingSolverResult {
  const svc = resolveServiceProps(inp);
  const scheduleKey = inp.schedule ?? '40';
  const scheduleList = buildScheduleList(scheduleKey, inp.includeSmallBore);
  const selectedIdx = pickSelectedIndex(inp, scheduleList);
  const dofMode: PipingDofMode = inp.dofMode === 'calc_max_flow' ? 'calc_max_flow' : 'calc_dp';

  const L_m = Math.max(0.01, inp.L_m ?? 100);
  const dZ_m = inp.dZ_m ?? 0;
  const rough_mm = Math.max(0, inp.rough_mm ?? (mode === 'quick' ? 0.045 : 0.0457));
  const sumK = computeTotalFittingK(inp);
  const erosionC = inp.erosionC_SI ?? API_RP_14E_C_SI;
  const v_target =
    inp.v_target ?? (svc.flowMode === 'gas' ? 15 : svc.flowMode === 'twophase' ? 8 : 2.0);
  const dpLimitBar = inp.dpLimit_bar ?? inp.maxDp ?? inp.target_dp_bar;

  let { Q_m3h, W_kgs, rho_mix } = resolveFlowRates(inp, svc);
  let iterations: PipingIterationRow[] = [];
  let infeasibleMaxFlow = false;

  if (dofMode === 'calc_max_flow' && dpLimitBar !== undefined && dpLimitBar > 0) {
    const bisected = runMaxFlowBisection(
      scheduleList[selectedIdx],
      selectedIdx,
      dpLimitBar,
      rho_mix,
      sumK,
      L_m,
      dZ_m,
      rough_mm,
      v_target,
      erosionC,
      svc,
    );
    Q_m3h = bisected.Q_max_m3h;
    W_kgs = bisected.W_max_kgs;
    iterations = bisected.iterations;
    infeasibleMaxFlow = bisected.infeasible;
  }

  const evals = scheduleList.map((item, idx) =>
    evaluatePipeCandidate(
      item,
      idx,
      Q_m3h,
      W_kgs,
      sumK,
      L_m,
      dZ_m,
      rough_mm,
      v_target,
      erosionC,
      svc,
    ),
  );

  const candidates = evals.map((e) => e.candidate);
  const selectedEval = evals[selectedIdx];
  const selected = selectedEval.candidate;
  const recommended = pickRecommendedCandidate(candidates, svc.flowMode, v_target, dpLimitBar);
  const twoPhaseDetails = selectedEval.twoPhase;

  if (iterations.length === 0) {
    iterations = [
      {
        iter: 1,
        param: 'f_churchill',
        assumed: Number((selected.f || 0.02).toFixed(6)),
        calc: Number(selected.f.toFixed(6)),
        err: 0,
        note: `Explicit Churchill (1977) full-regime Darcy factor (Re=${selected.Re.toFixed(0)})`,
      },
    ];
  }

  const warnings = buildPipingWarnings(selected, svc, twoPhaseDetails, dpLimitBar, infeasibleMaxFlow);

  return {
    equipTag: inp.equipTag ?? 'LINE-101',
    equipName: inp.equipName ?? 'Process Piping Line',
    Q_m3h,
    W_kgs,
    flowMode: svc.flowMode,
    dofMode,
    schedule: scheduleKey,
    selected,
    recommended,
    candidates,
    sumK,
    iterations,
    warnings,
    mode,
    fluidName: svc.fluid.name,
    rho: svc.flowMode === 'gas' ? svc.rhoG : svc.rhoL,
    mu_cP: svc.flowMode === 'gas' ? svc.muG_cP : svc.muL_cP,
    ...(svc.flowMode === 'gas'
      ? { c_sound_ms: svc.c_sound_ms, mach: selected.mach }
      : {}),
    ...(twoPhaseDetails
      ? {
          flowRegime: twoPhaseDetails.regime,
          liquidHoldup: twoPhaseDetails.liquidHoldup,
          voidFraction: twoPhaseDetails.voidFraction,
          twoPhaseDetails,
          c_sound_ms: svc.c_sound_ms,
          mach: selected.mach,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Multi-Segment Network Pressure Drop Backend (for lib/pipePressureDrop.ts)
// ---------------------------------------------------------------------------

/**
 * Multi-segment liquid pipe pressure drop solver using Churchill (1977) Darcy-Weisbach.
 * Used as the computational core behind lib/pipePressureDrop.ts and lib/calculations/pumpDesign.ts.
 */
export function calcMultiSegmentPressureDrop(
  fluid: LegacyFluidProps,
  T_C: number,
  flowRate_m3h: number,
  segments: PipeSegment[],
  fittingKLookup: Record<string, number> = {},
): PipeCalcResult {
  const rho = densityAtT(fluid, T_C);
  const mu = viscosityAtT(fluid, T_C);
  const gLegacy = 9.81;
  const fallbackK = getFittingK();

  const segmentResults: PipeSegmentResult[] = segments.map((seg) => {
    const D_m = seg.D_mm / 1000;
    const eps_m = seg.roughness_mm / 1000;
    const v = calcFlowVelocity(flowRate_m3h, seg.D_mm);
    const Re = calcReynoldsNumber(rho, v, D_m, mu);
    const f = calcChurchillFrictionFactor(Re, eps_m, D_m);

    const K_total = seg.fittings.reduce((acc, pf) => {
      const kVal =
        fittingKLookup[pf.fittingKey] ?? FITTING_K_MAP[pf.fittingKey] ?? fallbackK[pf.fittingKey] ?? 0;
      return acc + kVal * pf.count;
    }, 0);

    const qDyn = 0.5 * rho * v * v;
    const dP_friction_kPa = D_m > 0 ? (f * (seg.length_m / D_m) * qDyn) / 1000 : 0;
    const dP_fittings_kPa = (K_total * qDyn) / 1000;
    const dP_elevation_kPa = (rho * gLegacy * seg.elevation_m) / 1000;
    const dP_total_kPa = dP_friction_kPa + dP_fittings_kPa + dP_elevation_kPa;

    return {
      segment: seg,
      velocity_ms: v,
      Re,
      frictionFactor: f,
      dP_friction_kPa,
      dP_fittings_kPa,
      dP_elevation_kPa,
      dP_total_kPa,
      K_total,
    };
  });

  const dP_friction_total_kPa = segmentResults.reduce((s, r) => s + r.dP_friction_kPa, 0);
  const dP_fittings_total_kPa = segmentResults.reduce((s, r) => s + r.dP_fittings_kPa, 0);
  const dP_elevation_total_kPa = segmentResults.reduce((s, r) => s + r.dP_elevation_kPa, 0);
  const dP_total_kPa = dP_friction_total_kPa + dP_fittings_total_kPa + dP_elevation_total_kPa;
  const dP_total_mH2O = rho > 0 ? (dP_total_kPa * 1000) / (rho * gLegacy) : 0;
  const dP_total_bar = dP_total_kPa / 100;

  return {
    flowRate_m3h,
    segments: segmentResults,
    dP_friction_total_kPa,
    dP_fittings_total_kPa,
    dP_elevation_total_kPa,
    dP_total_kPa,
    dP_total_mH2O,
    dP_total_bar,
  };
}

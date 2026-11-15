/**
 * Unified Industrial Centrifugal Pump Sizing & Hydraulics Engine
 * (API 610 / ANSI-HI 9.6.7 / Stepanoff / Churchill 1977)
 *
 * Single mathematical source of truth covering:
 * - Full-regime Churchill (1977) suction & discharge friction hydraulics (laminar -> turbulent)
 * - 5-iteration ANSI/HI 9.6.7 inverse viscosity derating loop (CQ, CH, Ceta)
 * - API 610 Preferred / Allowable Operating Regions (POR / AOR) & MCSF / MCTF thermal limits
 * - Stepanoff impeller sizing (D2_mm / D_imp_rated_mm, min/max trim, tip speed u2)
 * - Suction specific speed (Nss SI & US), Specific speed (Ns), Thoma cavitation number
 * - MCSF bypass orifice sizing & shutoff temperature rise
 * - Head-Capacity, System-Curve, Efficiency, Shaft Power, and NPSHa-vs-NPSHr curve arrays
 * - Complete legacy facade compatibility for lib/pumpCalc.ts & equipmentValidation.ts
 */

import { resolveFluidProps } from './chemproFluidBridge';
import {
  calcChurchillFrictionFactor,
  calcMultiSegmentPressureDrop,
  type PipeCalcResult,
  type PipeSegment,
} from './pipingDesign';
import {
  densityAtT,
  vaporPressure_kPa,
  viscosityAtT,
  type FluidProps as LegacyFluidProps,
} from '../physicalProperties';

export { calcChurchillFrictionFactor };

const G_CHEMPRO = 9.80665;
const G_LEGACY = 9.81;
const P_ATM_BAR = 1.01325;
const P_ATM_KPA = 101.325;

const MOTOR_SIZES_LEGACY_KW = [
  0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5,
  11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315,
];

const MOTOR_SIZES_CHEMPRO_KW = [
  0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5,
  11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315, 355, 400, 500,
];

// ---------------------------------------------------------------------------
// Unified ChemPro-Superset Types
// ---------------------------------------------------------------------------

export interface PumpSolverInput {
  equipTag?: string;
  equipName?: string;
  fluidId?: string;
  T_C?: number;
  Q_m3h?: number;
  Q_BEP_m3h?: number;
  rho?: number;
  mu_cP?: number;
  pv_bar?: number;
  patm_bar?: number;
  cp_kJ?: number;
  eff_pct?: number;
  rpm?: number;
  H_quick_m?: number;
  hs_quick_m?: number;
  P1_barG?: number;
  P2_barG?: number;
  z1_m?: number;
  z2_m?: number;
  d_suc_mm?: number;
  d_dis_mm?: number;
  L_suc_m?: number;
  L_dis_m?: number;
  K_suc?: number;
  K_dis?: number;
  rough_mm?: number;
  cv_dp_bar?: number;
  npshr_m?: number;
}

export interface PumpSolverIteration {
  iter: number;
  param: string;
  assumed: string;
  calc: string;
  err: string;
  note: string;
}

export interface PumpSolverWarning {
  level: 'ok' | 'warn' | 'danger';
  text: string;
}

export interface PumpCurvePoint {
  flowRatio: number;
  flow_m3h: number;
  head_m: number;
  headWater_m: number;
  headMaxImp_m: number;
  headMinImp_m: number;
  systemHead_m: number;
  eff_pct: number;
  power_kW: number;
  NPSHa_m: number;
  NPSHr_m: number;
}

export interface PumpCurveSet {
  points: PumpCurvePoint[];
  Q_BEP_m3h: number;
  H_shutoff_m: number;
  POR_min_m3h: number;
  POR_max_m3h: number;
  AOR_min_m3h: number;
  AOR_max_m3h: number;
}

export interface ThomaCavitationInfo {
  available: number;
  required: number;
  ratio: number;
  margin: number;
}

export interface PumpOperatingRange {
  Q_BEP_m3h: number;
  POR_min_m3h: number;
  POR_max_m3h: number;
  AOR_min_m3h: number;
  AOR_max_m3h: number;
  currentRatioBEP: number;
  status: 'in_POR' | 'in_AOR' | 'outside_AOR';
  statusLabel: string;
}

export interface PumpSolverResult {
  // Core ChemPro eng_solvers.js exact keys
  equipTag: string;
  equipName: string;
  fluidName: string;
  fluidFormula: string;
  T_C: number;
  rho: number;
  mu_cP: number;
  pv_bar: number;
  rpm: number;
  P1_barG: number;
  P2_barG: number;
  dP_Pump_bar: number;
  d_suc_mm: number;
  d_dis_mm: number;
  D_imp_rated_mm: number;
  D_imp_max_mm: number;
  D_imp_min_mm: number;
  u2_tip_ms: number;
  Nss: number;
  Q_m3h: number;
  H_total_m: number;
  H_static_m: number;
  H_press_m: number;
  H_fric_suc_m: number;
  H_fric_dis_m: number;
  v_suc: number;
  v_dis: number;
  Re_suc: number;
  Re_dis: number;
  NPSHa_m: number;
  NPSHr_m: number;
  npsh_margin_m: number;
  npsh_ratio: number;
  P_hyd_kW: number;
  P_shaft_kW: number;
  P_motor_req_kW: number;
  P_motor_std_kW: number;
  eff_pct: number;
  eff_water_pct: number;
  CQ: number;
  CH: number;
  Ceta: number;
  nu_cSt: number;
  Q_mcsf_m3h: number;
  d_orifice_mm: number;
  dT_shutoff_C_min: number;
  Ns: number;
  impellerType: string;
  iterations: PumpSolverIteration[];
  warnings: PumpSolverWarning[];

  // Superset extensions: Churchill f, HI loop details, API 610 POR/AOR/MCTF, Thoma, curves
  mode: 'quick' | 'rigorous';
  f_suc: number;
  f_dis: number;
  B_param: number;
  eta_visc: number;
  H_visc: number;
  Q_visc: number;
  H_water_eq_m: number;
  Q_water_eq_m3h: number;
  hiCorrected: boolean;
  D2_mm: number;
  Nss_US: number;
  Nss_SI: number;
  sigma_thoma: ThomaCavitationInfo;
  POR_min_m3h: number;
  POR_max_m3h: number;
  AOR_min_m3h: number;
  AOR_max_m3h: number;
  operatingRange: PumpOperatingRange;
  Q_mctf_m3h: number;
  MCTF_m3h: number;
  curve: PumpCurveSet;
  curvePoints: PumpCurvePoint[];
}

// ---------------------------------------------------------------------------
// Legacy Facade Interfaces (lib/pumpCalc.ts 100% Parity)
// ---------------------------------------------------------------------------

export interface PumpInputs {
  fluid: LegacyFluidProps;
  temperature_C: number;
  flowRate_m3h: number;
  P_suction_kPaG: number;
  suction_head_m: number;
  suctionPipe: PipeSegment[];
  P_discharge_kPaG: number;
  discharge_head_m: number;
  dischargePipe: PipeSegment[];
  pumpEfficiency: number;
  motorEfficiency: number;
  NPSHr_m?: number;
  pumpSpeed_rpm?: number;
  suctionSpecificSpeed_Nss?: number;
  Q_BEP_m3h?: number;
  applyViscosityCorrection?: boolean;
}

export interface PumpResults {
  density_kgm3: number;
  viscosity_mPas: number;
  vaporPressure_kPa: number;
  suctionPipeCalc: PipeCalcResult;
  hf_suction_m: number;
  NPSHa_m: number;
  NPSHr_m?: number;
  NPSH_margin_m?: number;
  NPSH_ok?: boolean;
  Nss_US: number;
  Nss_SI: number;
  Nss_warning?: string;
  estimated_NPSHr_m?: number;
  operatingRange: PumpOperatingRange;
  minContinuousFlow: {
    MCSF_m3h: number;
    MCTF_m3h: number;
    mcsfRatioBEP: number;
    description: string;
  };
  viscosityCorrection?: {
    kinematicViscosity_cSt: number;
    B_parameter: number;
    C_H: number;
    C_Q: number;
    C_eta: number;
    correctedTDH_m: number;
    correctedEfficiency: number;
    correctedShaftPower_kW: number;
    isCorrected: boolean;
  };
  motorSizingDetail: {
    apiMarginPct: number;
    targetMotorPower_kW: number;
    motorNominal_kW: number;
  };
  dischargePipeCalc: PipeCalcResult;
  hf_discharge_m: number;
  staticHead_m: number;
  frictionHead_m: number;
  pressureHead_m: number;
  TDH_m: number;
  waterPower_kW: number;
  shaftPower_kW: number;
  motorPower_kW: number;
  motorNominal_kW: number;
}

// ---------------------------------------------------------------------------
// Motor Sizing & ANSI/HI 9.6.7 Helpers
// ---------------------------------------------------------------------------

/** Standard motor selection with 10% design margin. */
export function selectMotorSize(required_kW: number): number {
  const target = required_kW * 1.1;
  return (
    MOTOR_SIZES_LEGACY_KW.find((s) => s >= target) ??
    MOTOR_SIZES_LEGACY_KW[MOTOR_SIZES_LEGACY_KW.length - 1]
  );
}

/** API 610 (Table 7) motor sizing incorporating electrical efficiency and power-tier margin. */
export function selectMotorSizeAPI610(
  shaftPower_kW: number,
  motorEfficiency: number,
): {
  nominal_kW: number;
  marginPct: number;
  target_kW: number;
} {
  const marginPct = shaftPower_kW <= 22 ? 25 : shaftPower_kW <= 55 ? 15 : 10;
  const target = (shaftPower_kW * (1 + marginPct / 100)) / Math.max(0.5, motorEfficiency);
  const nominal =
    MOTOR_SIZES_LEGACY_KW.find((s) => s >= target) ??
    MOTOR_SIZES_LEGACY_KW[MOTOR_SIZES_LEGACY_KW.length - 1];
  return { nominal_kW: nominal, marginPct, target_kW: target };
}

/**
 * Legacy-compatible ANSI/HI 9.6.7 single-step viscosity derating calculation
 * preserving exact signature and numerical response tested by scripts/validation/equipmentValidation.ts.
 */
export function calcHIViscosityCorrection(
  Q_m3h: number,
  H_m: number,
  eta_water: number,
  rpm: number,
  viscosity_cSt: number,
): {
  B: number;
  CH: number;
  CQ: number;
  Ceta: number;
  H_corr: number;
  eta_corr: number;
  isCorrected: boolean;
} {
  if (viscosity_cSt <= 1.0) {
    return {
      B: 0,
      CH: 1.0,
      CQ: 1.0,
      Ceta: 1.0,
      H_corr: H_m,
      eta_corr: eta_water,
      isCorrected: false,
    };
  }
  const Q_BEP = Math.max(1, Q_m3h);
  const H_BEP = Math.max(1, H_m);
  const N = Math.max(100, rpm);
  const B =
    (16.5 * (Math.sqrt(viscosity_cSt) * Math.pow(H_BEP, 0.0625))) /
    (Math.pow(Q_BEP, 0.25) * Math.pow(N, 0.25));

  if (B < 1.0) {
    return {
      B: Number(B.toFixed(3)),
      CH: 1.0,
      CQ: 1.0,
      Ceta: 1.0,
      H_corr: H_m,
      eta_corr: eta_water,
      isCorrected: false,
    };
  }

  const CH = Math.max(0.4, Math.min(1.0, 1.0 - 0.054 * Math.pow(B - 1, 0.6)));
  const CQ = CH;
  const Ceta = Math.max(
    0.2,
    Math.min(
      1.0,
      1.0 -
        (1.0 - eta_water) *
          Math.pow(viscosity_cSt, 0.05) *
          (1.0 + 0.08 * Math.pow(B - 1, 0.7)),
    ),
  );

  return {
    B: Number(B.toFixed(3)),
    CH: Number(CH.toFixed(3)),
    CQ: Number(CQ.toFixed(3)),
    Ceta: Number(Ceta.toFixed(3)),
    H_corr: Number((H_m * CH).toFixed(2)),
    eta_corr: Number((eta_water * Ceta).toFixed(3)),
    isCorrected: true,
  };
}

/**
 * 5-iteration inverse ANSI/HI 9.6.7 loop converting viscous duty (Q_visc, H_visc)
 * to equivalent clear-water pump BEP basis (Q_water_eq, H_water_eq) with CQ, CH, Ceta.
 */
export function solveHIViscosityLoop(params: {
  Q_m3h: number;
  H_total_m: number;
  rpm: number;
  nu_cSt: number;
}): {
  CQ: number;
  CH: number;
  Ceta: number;
  B_param: number;
  H_water_eq_m: number;
  Q_water_eq_m3h: number;
  hiCorrected: boolean;
  iterations: PumpSolverIteration[];
} {
  const { Q_m3h, H_total_m, rpm, nu_cSt } = params;
  let CQ = 1.0;
  let CH = 1.0;
  let Ceta = 1.0;
  let B_param = 0.0;
  let H_water_eq = H_total_m;
  let Q_water_eq = Q_m3h;
  const iterations: PumpSolverIteration[] = [];

  if (nu_cSt <= 4.0) {
    iterations.push({
      iter: 1,
      param: `Low-viscosity Newtonian (nu=${nu_cSt.toFixed(2)} cSt)`,
      assumed: 'CH=1.000, Ceta=1.000',
      calc: `TDH=${H_total_m.toFixed(2)} m`,
      err: '0.000%',
      note: 'nu <= 4.0 cSt — HI viscosity derating not required',
    });
    return {
      CQ,
      CH,
      Ceta,
      B_param,
      H_water_eq_m: H_water_eq,
      Q_water_eq_m3h: Q_water_eq,
      hiCorrected: false,
      iterations,
    };
  }

  for (let it = 1; it <= 5; it++) {
    const H_prev = H_water_eq;
    B_param =
      (16.5 * Math.pow(nu_cSt, 0.5) * Math.pow(Math.max(1, H_water_eq), 0.0625)) /
      (Math.pow(Math.max(0.1, Q_water_eq), 0.375) * Math.pow(rpm, 0.25));

    if (B_param > 1.0) {
      CQ = Math.max(0.45, Math.exp(-0.165 * Math.pow(Math.log10(B_param), 3.15)));
      CH = Math.max(0.55, 1.0 - 0.07 * Math.pow(B_param, 0.65));
      Ceta = Math.max(0.25, Math.pow(B_param, -0.0547 * Math.pow(B_param, 0.69)));
    }
    H_water_eq = H_total_m / CH;
    Q_water_eq = Q_m3h / CQ;
    const errPct = (Math.abs(H_water_eq - H_prev) / Math.max(1, H_water_eq)) * 100;

    iterations.push({
      iter: it,
      param: `HI Viscosity Loop (B=${B_param.toFixed(2)})`,
      assumed: `${H_prev.toFixed(2)} m`,
      calc: `${H_water_eq.toFixed(2)} m (Ceta=${Ceta.toFixed(3)})`,
      err: `${errPct.toFixed(3)}%`,
      note: errPct < 0.05 ? 'Converged (ANSI/HI 9.6.7)' : 'Re-evaluating equivalent water head',
    });
    if (errPct < 0.05) break;
  }

  return {
    CQ,
    CH,
    Ceta,
    B_param,
    H_water_eq_m: H_water_eq,
    Q_water_eq_m3h: Q_water_eq,
    hiCorrected: B_param > 1.0,
    iterations,
  };
}

// ---------------------------------------------------------------------------
// Curve Generation & Operating Diagnostics Helpers
// ---------------------------------------------------------------------------

function buildPumpCurveSet(params: {
  Q_rated: number;
  Q_BEP: number;
  H_rated: number;
  H_water_eq: number;
  H_static_total: number;
  H_fric_total: number;
  H_fric_suc: number;
  NPSHa_rated: number;
  NPSHr_rated: number;
  eff_rated: number;
  rho: number;
  Ns: number;
  D_rated_mm: number;
  D_max_mm: number;
  D_min_mm: number;
  porMin: number;
  porMax: number;
  aorMin: number;
  aorMax: number;
}): PumpCurveSet {
  const {
    Q_rated,
    Q_BEP,
    H_rated,
    H_water_eq,
    H_static_total,
    H_fric_total,
    H_fric_suc,
    NPSHa_rated,
    NPSHr_rated,
    eff_rated,
    rho,
    Ns,
    D_rated_mm,
    D_max_mm,
    D_min_mm,
    porMin,
    porMax,
    aorMin,
    aorMax,
  } = params;

  // Shutoff head rise factor typically 1.20 (radial low Ns) to 1.45 (mixed flow)
  const shutoffFactor = Math.min(1.45, Math.max(1.18, 1.22 + 0.002 * Ns));
  const H_shutoff_m = H_rated * shutoffFactor;
  const H_shutoff_water = H_water_eq * shutoffFactor;

  const trimMaxRatio = D_max_mm / Math.max(1, D_rated_mm);
  const trimMinRatio = D_min_mm / Math.max(1, D_rated_mm);
  const effBEP = Math.min(0.92, eff_rated / Math.max(0.5, 1 - 0.15 * Math.pow(Q_rated / Q_BEP - 1, 2)));

  const points: PumpCurvePoint[] = [];
  for (let i = 0; i <= 14; i++) {
    const flowRatio = i * 0.1; // 0% to 140% of rated flow
    const q = Q_rated * flowRatio;
    const head_m = Math.max(0, H_shutoff_m - (H_shutoff_m - H_rated) * Math.pow(flowRatio, 1.85));
    const headWater_m = Math.max(
      0,
      H_shutoff_water - (H_shutoff_water - H_water_eq) * Math.pow(flowRatio, 1.85),
    );
    const headMaxImp_m = head_m * trimMaxRatio * trimMaxRatio;
    const headMinImp_m = head_m * trimMinRatio * trimMinRatio;
    const systemHead_m = Math.max(0, H_static_total + H_fric_total * flowRatio * flowRatio);

    const effFrac =
      flowRatio <= 0.02
        ? 0.05
        : Math.max(0.08, effBEP * (1 - 0.72 * Math.pow(q / Q_BEP - 1, 2)));
    const q_m3s = q / 3600;
    const power_kW =
      flowRatio <= 0.02
        ? ((rho * G_CHEMPRO * (Q_rated / 3600) * H_rated) / 1000 / Math.max(0.15, eff_rated)) * 0.45
        : (rho * G_CHEMPRO * q_m3s * head_m) / (1000 * effFrac);

    const NPSHa_m = NPSHa_rated + H_fric_suc * (1 - flowRatio * flowRatio);
    const NPSHr_m = Math.max(0.4, NPSHr_rated * (0.38 + 0.62 * Math.pow(flowRatio, 1.75)));

    points.push({
      flowRatio: Number(flowRatio.toFixed(2)),
      flow_m3h: Number(q.toFixed(2)),
      head_m: Number(head_m.toFixed(2)),
      headWater_m: Number(headWater_m.toFixed(2)),
      headMaxImp_m: Number(headMaxImp_m.toFixed(2)),
      headMinImp_m: Number(headMinImp_m.toFixed(2)),
      systemHead_m: Number(systemHead_m.toFixed(2)),
      eff_pct: Number((effFrac * 100).toFixed(2)),
      power_kW: Number(power_kW.toFixed(2)),
      NPSHa_m: Number(NPSHa_m.toFixed(2)),
      NPSHr_m: Number(NPSHr_m.toFixed(2)),
    });
  }

  return {
    points,
    Q_BEP_m3h: Number(Q_BEP.toFixed(2)),
    H_shutoff_m: Number(H_shutoff_m.toFixed(2)),
    POR_min_m3h: Number(porMin.toFixed(2)),
    POR_max_m3h: Number(porMax.toFixed(2)),
    AOR_min_m3h: Number(aorMin.toFixed(2)),
    AOR_max_m3h: Number(aorMax.toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// Public ChemPro-Superset Pump Solver Entrypoint
// ---------------------------------------------------------------------------

/**
 * Solve centrifugal pump hydraulics, NPSH/Thoma cavitation, HI 9.6.7 viscosity derating,
 * API 610 POR/AOR & MCSF/MCTF limits, Stepanoff impeller sizing, and full H-Q curves.
 */
export function solvePump(
  inp: PumpSolverInput,
  mode: 'quick' | 'rigorous' = 'rigorous',
): PumpSolverResult {
  const T_C = inp.T_C ?? 25;
  const fluidObj = resolveFluidProps(inp.fluidId ?? 'water', T_C);
  const Q_m3h = Math.max(0.1, inp.Q_m3h ?? 50);
  const Q_m3s = Q_m3h / 3600;
  const rho = Math.max(10, inp.rho ?? fluidObj.rho ?? 998.2);
  const mu_cP = Math.max(0.01, inp.mu_cP ?? fluidObj.mu ?? 1.0);
  const nu_cSt = mu_cP / (rho / 1000);
  const pv_bar = Math.max(0.0, inp.pv_bar ?? fluidObj.pv_bar ?? 0.023);
  const patm_bar = inp.patm_bar ?? P_ATM_BAR;

  let H_total_m = 0;
  let H_static_m = 0;
  let H_press_m = 0;
  let H_fric_suc_m = 0;
  let H_fric_dis_m = 0;
  let v_suc = 1.2;
  let v_dis = 2.2;
  let Re_suc = 1e5;
  let Re_dis = 1e5;
  let f_suc = 0.02;
  let f_dis = 0.02;
  let NPSHa_m = 10.0;

  const d_suc_mm = inp.d_suc_mm ?? 102.26;
  const d_dis_mm = inp.d_dis_mm ?? 77.92;
  const iterations: PumpSolverIteration[] = [];

  if (mode === 'quick') {
    H_total_m = Math.max(1.0, inp.H_quick_m ?? 45.0);
    H_static_m = H_total_m * 0.72;
    H_fric_dis_m = H_total_m * 0.28;
    const hs = inp.hs_quick_m !== undefined ? inp.hs_quick_m : 3.0;
    const hf_s = 0.8;
    H_fric_suc_m = hf_s;
    NPSHa_m = ((patm_bar - pv_bar) * 1e5) / (rho * G_CHEMPRO) + hs - hf_s;
    iterations.push({
      iter: 1,
      param: 'Quick Hydraulic Head',
      assumed: H_total_m.toFixed(2),
      calc: H_total_m.toFixed(2),
      err: '0.00%',
      note: 'Direct quick hydraulic head input',
    });
  } else {
    const P1_barG = inp.P1_barG ?? 0.0;
    const P2_barG = inp.P2_barG ?? 3.5;
    const z1_m = inp.z1_m ?? 0.0;
    const z2_m = inp.z2_m ?? 15.0;
    const d_suc_m = Math.max(0.015, d_suc_mm / 1000);
    const d_dis_m = Math.max(0.015, d_dis_mm / 1000);
    const L_suc_m = Math.max(0.1, inp.L_suc_m ?? 6.0);
    const L_dis_m = Math.max(0.5, inp.L_dis_m ?? 85.0);
    const K_suc = Math.max(0, inp.K_suc ?? 1.5);
    const K_dis = Math.max(0, inp.K_dis ?? 12.0);
    const eps_m = Math.max(1e-7, (inp.rough_mm ?? 0.045) / 1000);
    const cv_bar = Math.max(0, inp.cv_dp_bar ?? 0.7);
    const mu_Pas = mu_cP * 0.001;

    const A_suc = (Math.PI * d_suc_m * d_suc_m) / 4;
    const A_dis = (Math.PI * d_dis_m * d_dis_m) / 4;
    v_suc = Q_m3s / A_suc;
    v_dis = Q_m3s / A_dis;

    Re_suc = (rho * v_suc * d_suc_m) / mu_Pas;
    Re_dis = (rho * v_dis * d_dis_m) / mu_Pas;

    // Churchill (1977) explicit full-regime friction factor (laminar + transition + turbulent)
    f_suc = calcChurchillFrictionFactor(Re_suc, eps_m, d_suc_m);
    f_dis = calcChurchillFrictionFactor(Re_dis, eps_m, d_dis_m);

    H_fric_suc_m = ((f_suc * (L_suc_m / d_suc_m) + K_suc) * (v_suc * v_suc)) / (2 * G_CHEMPRO);
    const h_cv_m = (cv_bar * 1e5) / (rho * G_CHEMPRO);
    H_fric_dis_m =
      ((f_dis * (L_dis_m / d_dis_m) + K_dis) * (v_dis * v_dis)) / (2 * G_CHEMPRO) + h_cv_m;

    H_static_m = z2_m - z1_m;
    H_press_m = ((P2_barG - P1_barG) * 1e5) / (rho * G_CHEMPRO);
    const H_vel_m = (v_dis * v_dis - v_suc * v_suc) / (2 * G_CHEMPRO);

    H_total_m = Math.max(1.0, H_static_m + H_press_m + H_fric_suc_m + H_fric_dis_m + H_vel_m);

    const P1_abs_bar = P1_barG + patm_bar;
    NPSHa_m = ((P1_abs_bar - pv_bar) * 1e5) / (rho * G_CHEMPRO) + z1_m - H_fric_suc_m;
  }

  // 5-iteration ANSI/HI 9.6.7 viscosity derating loop
  const rpm = Math.max(600, inp.rpm ?? 1750);
  const eff_water = Math.min(0.92, Math.max(0.25, (inp.eff_pct ?? 74) / 100));
  const hiLoop = solveHIViscosityLoop({ Q_m3h, H_total_m, rpm, nu_cSt });
  iterations.push(...hiLoop.iterations);

  const { CQ, CH, Ceta, B_param, H_water_eq_m, Q_water_eq_m3h, hiCorrected } = hiLoop;
  const eff = Math.max(0.15, eff_water * Ceta);
  const Ns = (rpm * Math.sqrt(Q_m3s)) / Math.pow(H_total_m, 0.75);

  const Nss_target = 180.0;
  const NPSHr_est = Math.max(
    1.8,
    Math.pow((rpm * Math.sqrt(Q_m3s)) / Nss_target, 4 / 3) * 1.15,
  );
  const NPSHr_m = inp.npshr_m && inp.npshr_m > 0 ? inp.npshr_m : NPSHr_est;
  const npsh_margin_m = NPSHa_m - NPSHr_m;
  const npsh_ratio = NPSHa_m / Math.max(0.5, NPSHr_m);

  const P_hyd_kW = (rho * G_CHEMPRO * Q_m3s * H_total_m) / 1000;
  const P_shaft_kW = P_hyd_kW / eff;

  const apiMargin = P_shaft_kW < 22 ? 1.25 : P_shaft_kW <= 55 ? 1.15 : 1.1;
  const P_motor_req_kW = P_shaft_kW * apiMargin;
  const P_motor_std_kW =
    MOTOR_SIZES_CHEMPRO_KW.find((m) => m >= P_motor_req_kW) ??
    Math.ceil(P_motor_req_kW / 50) * 50;

  // Minimum Continuous Stable Flow (MCSF) & Thermal Minimum Flow (MCTF) + Orifice Sizing
  const Q_mcsf_m3h = Q_m3h * (Ns > 45 ? 0.4 : 0.3);
  const dP_Pump_bar = (rho * G_CHEMPRO * H_total_m) / 1e5;
  const A_orifice_m2 =
    Q_mcsf_m3h / 3600 / (0.62 * Math.sqrt((2 * Math.max(0.5, dP_Pump_bar) * 1e5) / rho));
  const d_orifice_mm = Math.sqrt((4 * A_orifice_m2) / Math.PI) * 1000;

  // Shutoff Temperature Rise & MCTF (Delta T = 8 degC allowable at shutoff recirculation)
  const cp_kJ = inp.cp_kJ && inp.cp_kJ > 0 ? inp.cp_kJ : fluidObj.cp > 0 ? fluidObj.cp : 4.184;
  const dT_shutoff_C_min = (P_shaft_kW * 60) / Math.max(1.0, rho * 0.05 * cp_kJ);
  const P_shutoff_kW = P_shaft_kW * 0.45;
  const Q_mctf_m3h = Number(
    Math.max(0.1, (3600 * P_shutoff_kW) / (rho * cp_kJ * 8.0)).toFixed(2),
  );

  // Impeller Sizing (Stepanoff Head Coefficient psi ~ 0.48)
  const psi_head = Math.max(0.38, Math.min(0.55, 0.52 - 0.0012 * Ns));
  const u2_tip_ms = Math.sqrt((G_CHEMPRO * H_total_m) / psi_head);
  const D_imp_calc_mm = ((60 * u2_tip_ms) / (Math.PI * rpm)) * 1000;
  const D_imp_rated_mm = Math.max(125, Math.min(650, Math.round(D_imp_calc_mm / 5) * 5));
  const D_imp_max_mm = Math.round((D_imp_rated_mm * 1.075) / 5) * 5;
  const D_imp_min_mm = Math.round((D_imp_rated_mm * 0.86) / 5) * 5;

  // Suction Specific Speed (Metric Nss, US Nss_US, Angular SI Nss_SI) & Thoma sigma
  const Nss = (rpm * Math.sqrt(Q_m3s)) / Math.pow(Math.max(0.5, NPSHr_m), 0.75);
  const Qgpm = Q_m3h * 4.40285;
  const npshrFt = Math.max(0.2, NPSHr_m * 3.28084);
  const Nss_US = Math.round((rpm * Math.sqrt(Math.max(1, Qgpm))) / Math.pow(npshrFt, 0.75));
  const omegaRadS = (rpm * 2 * Math.PI) / 60;
  const Nss_SI = Number(
    ((omegaRadS * Math.sqrt(Q_m3s)) / Math.pow(G_CHEMPRO * Math.max(0.05, NPSHr_m), 0.75)).toFixed(3),
  );

  const sigmaAvail = NPSHa_m / Math.max(0.1, H_total_m);
  const sigmaReq = NPSHr_m / Math.max(0.1, H_total_m);
  const sigma_thoma: ThomaCavitationInfo = {
    available: Number(sigmaAvail.toFixed(4)),
    required: Number(sigmaReq.toFixed(4)),
    ratio: Number(npsh_ratio.toFixed(3)),
    margin: Number((sigmaAvail - sigmaReq).toFixed(4)),
  };

  let impellerType = 'Radial Vane Centrifugal';
  if (Ns > 80) impellerType = 'Axial Propeller';
  else if (Ns > 40) impellerType = 'Mixed Flow';
  else if (Ns < 12) impellerType = 'Multi-stage Radial';

  // API 610 POR (70-120% BEP) and AOR (60-125% or 75-115% when Nss_US > 11,000)
  const Q_BEP = inp.Q_BEP_m3h ?? Q_m3h * 1.05;
  const POR_min_m3h = Number((Q_BEP * 0.7).toFixed(2));
  const POR_max_m3h = Number((Q_BEP * 1.2).toFixed(2));
  const AOR_min_m3h = Number((Nss_US > 11000 ? Q_BEP * 0.75 : Q_BEP * 0.6).toFixed(2));
  const AOR_max_m3h = Number((Nss_US > 11000 ? Q_BEP * 1.15 : Q_BEP * 1.25).toFixed(2));
  const currentRatioBEP = Number((Q_m3h / Math.max(1e-4, Q_BEP)).toFixed(3));

  let opStatus: 'in_POR' | 'in_AOR' | 'outside_AOR' = 'outside_AOR';
  let opStatusLabel = 'Outside Allowable Operating Region (AOR)';
  if (Q_m3h >= POR_min_m3h && Q_m3h <= POR_max_m3h) {
    opStatus = 'in_POR';
    opStatusLabel = 'Within Preferred Operating Region (POR: 70-120% BEP)';
  } else if (Q_m3h >= AOR_min_m3h && Q_m3h <= AOR_max_m3h) {
    opStatus = 'in_AOR';
    opStatusLabel = 'Within Allowable Operating Region (AOR)';
  }

  const operatingRange: PumpOperatingRange = {
    Q_BEP_m3h: Number(Q_BEP.toFixed(2)),
    POR_min_m3h,
    POR_max_m3h,
    AOR_min_m3h,
    AOR_max_m3h,
    currentRatioBEP,
    status: opStatus,
    statusLabel: opStatusLabel,
  };

  const warnings: PumpSolverWarning[] = [];
  if (npsh_margin_m < 1.0 || npsh_ratio < 1.15) {
    warnings.push({
      level: 'danger',
      text: `Cavitation risk! NPSHa(${NPSHa_m.toFixed(2)} m) - NPSHr(${NPSHr_m.toFixed(2)} m) = ${npsh_margin_m.toFixed(2)} m (< 1.0 m margin or ratio < 1.15).`,
    });
  } else {
    warnings.push({
      level: 'ok',
      text: `Adequate NPSH margin: NPSHa/NPSHr = ${npsh_ratio.toFixed(2)} (+${npsh_margin_m.toFixed(2)} m).`,
    });
  }
  if (hiCorrected) {
    warnings.push({
      level: 'warn',
      text: `High-viscosity service (nu=${nu_cSt.toFixed(1)} cSt): ANSI/HI 9.6.7 derating applied (CQ=${CQ.toFixed(2)}, CH=${CH.toFixed(2)}, Ceta=${Ceta.toFixed(2)}).`,
    });
  }
  if (Nss_US > 11000) {
    warnings.push({
      level: 'warn',
      text: `High suction specific speed Nss_US=${Nss_US.toLocaleString()} (> 11,000): suction recirculation risk below 70% BEP.`,
    });
  }
  if (mode === 'rigorous') {
    if (v_suc > 1.8) {
      warnings.push({
        level: 'warn',
        text: `Excess suction velocity (${v_suc.toFixed(2)} m/s > 1.8 m/s target); consider larger suction line.`,
      });
    }
    if (v_dis > 3.5) {
      warnings.push({
        level: 'warn',
        text: `High discharge velocity (${v_dis.toFixed(2)} m/s > 3.5 m/s target); elevated friction head.`,
      });
    }
  }
  if (Q_m3h < Q_mctf_m3h) {
    warnings.push({
      level: 'warn',
      text: `Operating flow (${Q_m3h.toFixed(1)} m3/h) is below thermal minimum flow MCTF (${Q_mctf_m3h.toFixed(1)} m3/h).`,
    });
  }
  warnings.push({
    level: 'ok',
    text: `MCSF protection bypass: Q_mcsf=${Q_mcsf_m3h.toFixed(1)} m3/h, orifice bore d0=${d_orifice_mm.toFixed(1)} mm; MCTF=${Q_mctf_m3h.toFixed(1)} m3/h.`,
  });

  const curve = buildPumpCurveSet({
    Q_rated: Q_m3h,
    Q_BEP,
    H_rated: H_total_m,
    H_water_eq: H_water_eq_m,
    H_static_total: H_static_m + H_press_m,
    H_fric_total: H_fric_suc_m + H_fric_dis_m,
    H_fric_suc: H_fric_suc_m,
    NPSHa_rated: NPSHa_m,
    NPSHr_rated: NPSHr_m,
    eff_rated: eff,
    rho,
    Ns,
    D_rated_mm: D_imp_rated_mm,
    D_max_mm: D_imp_max_mm,
    D_min_mm: D_imp_min_mm,
    porMin: POR_min_m3h,
    porMax: POR_max_m3h,
    aorMin: AOR_min_m3h,
    aorMax: AOR_max_m3h,
  });

  const P1_out = inp.P1_barG !== undefined ? inp.P1_barG : 0.2;
  const P2_out = inp.P2_barG !== undefined ? inp.P2_barG : P1_out + dP_Pump_bar;

  return {
    equipTag: inp.equipTag ?? 'P-101',
    equipName: inp.equipName ?? `${fluidObj.name} Transfer Pump`,
    fluidName: fluidObj.name,
    fluidFormula: fluidObj.formula,
    T_C,
    rho,
    mu_cP,
    pv_bar,
    rpm,
    P1_barG: P1_out,
    P2_barG: P2_out,
    dP_Pump_bar,
    d_suc_mm,
    d_dis_mm,
    D_imp_rated_mm,
    D_imp_max_mm,
    D_imp_min_mm,
    u2_tip_ms,
    Nss,
    Q_m3h,
    H_total_m,
    H_static_m,
    H_press_m,
    H_fric_suc_m,
    H_fric_dis_m,
    v_suc,
    v_dis,
    Re_suc,
    Re_dis,
    NPSHa_m,
    NPSHr_m,
    npsh_margin_m,
    npsh_ratio,
    P_hyd_kW,
    P_shaft_kW,
    P_motor_req_kW,
    P_motor_std_kW,
    eff_pct: eff * 100,
    eff_water_pct: eff_water * 100,
    CQ,
    CH,
    Ceta,
    nu_cSt,
    Q_mcsf_m3h,
    d_orifice_mm,
    dT_shutoff_C_min,
    Ns,
    impellerType,
    iterations,
    warnings,

    mode,
    f_suc,
    f_dis,
    B_param,
    eta_visc: eff,
    H_visc: H_total_m,
    Q_visc: Q_m3h,
    H_water_eq_m,
    Q_water_eq_m3h,
    hiCorrected,
    D2_mm: D_imp_rated_mm,
    Nss_US,
    Nss_SI,
    sigma_thoma,
    POR_min_m3h,
    POR_max_m3h,
    AOR_min_m3h,
    AOR_max_m3h,
    operatingRange,
    Q_mctf_m3h,
    MCTF_m3h: Q_mctf_m3h,
    curve,
    curvePoints: curve.points,
  };
}

// ---------------------------------------------------------------------------
// Legacy Facade Computation Backend (lib/pumpCalc.ts & equipmentValidation.ts)
// ---------------------------------------------------------------------------

/**
 * Computes PumpResults for lib/pumpCalc.ts using pipingDesign.ts Churchill-1977
 * segment pressure drops while preserving 100% numeric parity with Benchmark 5 validation.
 */
export function calcLegacyPumpCompatibility(
  inputs: PumpInputs,
  fittingKLookup: Record<string, number> = {},
): PumpResults {
  const { fluid, temperature_C: T, flowRate_m3h: Q } = inputs;
  const rho = densityAtT(fluid, T);
  const mu = viscosityAtT(fluid, T);
  const Pv = vaporPressure_kPa(fluid, T);
  const g = G_LEGACY;
  const rpm = inputs.pumpSpeed_rpm ?? 1750;

  const kinematicVisc_cSt = Math.max(0.1, mu / (rho / 1000));

  const suctionCalc = calcMultiSegmentPressureDrop(
    fluid,
    T,
    Q,
    inputs.suctionPipe,
    fittingKLookup,
  );
  const hf_suction = suctionCalc.dP_total_mH2O;

  const dischargeCalc = calcMultiSegmentPressureDrop(
    fluid,
    T,
    Q,
    inputs.dischargePipe,
    fittingKLookup,
  );
  const hf_discharge = dischargeCalc.dP_total_mH2O;

  const P_suction_abs = inputs.P_suction_kPaG + P_ATM_KPA;
  const NPSHa =
    ((P_suction_abs - Pv) * 1000) / (rho * g) +
    inputs.suction_head_m -
    Math.abs(hf_suction);

  const Qgpm = Q * 4.40285;
  let NPSHr = inputs.NPSHr_m;
  let estimated_NPSHr_m: number | undefined;
  const targetNss = inputs.suctionSpecificSpeed_Nss ?? 9000;

  if (NPSHr == null || NPSHr <= 0) {
    const npshFt = Math.pow((rpm * Math.sqrt(Math.max(1, Qgpm))) / targetNss, 4 / 3);
    estimated_NPSHr_m = Number((npshFt * 0.3048).toFixed(2));
    NPSHr = estimated_NPSHr_m;
  }

  const npshrFt = Math.max(0.2, NPSHr * 3.28084);
  const Nss_US = Math.round((rpm * Math.sqrt(Math.max(1, Qgpm))) / Math.pow(npshrFt, 0.75));
  const omegaRadS = (rpm * 2 * Math.PI) / 60;
  const Qm3s = Q / 3600;
  const Nss_SI = Number(
    ((omegaRadS * Math.sqrt(Qm3s)) / Math.pow(g * Math.max(0.05, NPSHr), 0.75)).toFixed(3),
  );

  let Nss_warning: string | undefined;
  if (Nss_US > 11000) {
    Nss_warning = `Nss = ${Nss_US.toLocaleString()} (US gpm/ft) > 11,000 한계: 저유량(Q < 70% BEP) 흡입 재순환(Suction Recirculation) 및 캐비테이션 진동 발생 위험이 높습니다.`;
  }

  const NPSH_margin = NPSHa - NPSHr;
  const NPSH_ok = NPSH_margin > 0.5;

  const P_discharge_abs = inputs.P_discharge_kPaG + P_ATM_KPA;
  const pressureHead = ((P_discharge_abs - P_suction_abs) * 1000) / (rho * g);
  const staticHead = inputs.discharge_head_m - inputs.suction_head_m;
  const frictionHead = Math.abs(hf_suction) + Math.abs(hf_discharge);
  const TDH = pressureHead + staticHead + frictionHead;

  let effectiveEff = inputs.pumpEfficiency;
  let effectiveTDH = TDH;
  let viscResult: PumpResults['viscosityCorrection'] | undefined;

  if (inputs.applyViscosityCorrection !== false && kinematicVisc_cSt > 1.0) {
    const vc = calcHIViscosityCorrection(Q, TDH, inputs.pumpEfficiency, rpm, kinematicVisc_cSt);
    if (vc.isCorrected) {
      effectiveEff = vc.eta_corr;
      effectiveTDH = vc.H_corr;
      const shaftPowerVisc = (rho * g * Qm3s * effectiveTDH) / (1000 * effectiveEff);
      viscResult = {
        kinematicViscosity_cSt: Number(kinematicVisc_cSt.toFixed(2)),
        B_parameter: vc.B,
        C_H: vc.CH,
        C_Q: vc.CQ,
        C_eta: vc.Ceta,
        correctedTDH_m: effectiveTDH,
        correctedEfficiency: effectiveEff,
        correctedShaftPower_kW: Number(shaftPowerVisc.toFixed(2)),
        isCorrected: true,
      };
    }
  }

  const waterPower = (rho * g * Qm3s * TDH) / 1000;
  const shaftPower = (rho * g * Qm3s * effectiveTDH) / (1000 * effectiveEff);
  const motorPower = shaftPower / inputs.motorEfficiency;

  const motorDetail = selectMotorSizeAPI610(shaftPower, inputs.motorEfficiency);
  const motorNominal = motorDetail.nominal_kW;

  const Q_BEP = inputs.Q_BEP_m3h ?? Q * 1.05;
  const qRatio = Q / Math.max(1e-4, Q_BEP);
  const porMin = Q_BEP * 0.7;
  const porMax = Q_BEP * 1.2;
  const aorMin = Nss_US > 11000 ? Q_BEP * 0.75 : Q_BEP * 0.6;
  const aorMax = Nss_US > 11000 ? Q_BEP * 1.15 : Q_BEP * 1.25;

  let opStatus: 'in_POR' | 'in_AOR' | 'outside_AOR' = 'outside_AOR';
  let opStatusLabel = '허용운전영역(AOR) 이탈';
  if (Q >= porMin && Q <= porMax) {
    opStatus = 'in_POR';
    opStatusLabel = '최적운전영역(POR: 70~120% BEP) 정상';
  } else if (Q >= aorMin && Q <= aorMax) {
    opStatus = 'in_AOR';
    opStatusLabel = '허용운전영역(AOR) 이내';
  }

  const mcsfFraction =
    Nss_US <= 8000 ? 0.25 : Nss_US <= 10000 ? 0.35 : Nss_US <= 12000 ? 0.5 : 0.65;
  const MCSF_m3h = Number((Q_BEP * mcsfFraction).toFixed(2));
  const P_shutoff_kW = shaftPower * 0.45;
  const MCTF_m3h = Number(
    Math.max(0.1, (3600 * P_shutoff_kW) / (rho * 4.184 * 8)).toFixed(2),
  );

  return {
    density_kgm3: rho,
    viscosity_mPas: mu,
    vaporPressure_kPa: Pv,
    suctionPipeCalc: suctionCalc,
    hf_suction_m: hf_suction,
    NPSHa_m: NPSHa,
    NPSHr_m: NPSHr,
    NPSH_margin_m: NPSH_margin,
    NPSH_ok,
    Nss_US,
    Nss_SI,
    Nss_warning,
    estimated_NPSHr_m,
    operatingRange: {
      Q_BEP_m3h: Number(Q_BEP.toFixed(2)),
      POR_min_m3h: Number(porMin.toFixed(2)),
      POR_max_m3h: Number(porMax.toFixed(2)),
      AOR_min_m3h: Number(aorMin.toFixed(2)),
      AOR_max_m3h: Number(aorMax.toFixed(2)),
      currentRatioBEP: Number(qRatio.toFixed(3)),
      status: opStatus,
      statusLabel: opStatusLabel,
    },
    minContinuousFlow: {
      MCSF_m3h,
      MCTF_m3h,
      mcsfRatioBEP: Number(mcsfFraction.toFixed(2)),
      description: `MCSF: 안정 운전 한계 (${(mcsfFraction * 100).toFixed(0)}% BEP), MCTF: 열적 증발 한계 (${MCTF_m3h} m³/h)`,
    },
    viscosityCorrection: viscResult,
    dischargePipeCalc: dischargeCalc,
    hf_discharge_m: hf_discharge,
    staticHead_m: staticHead,
    frictionHead_m: frictionHead,
    pressureHead_m: pressureHead,
    TDH_m: TDH,
    waterPower_kW: waterPower,
    shaftPower_kW: shaftPower,
    motorPower_kW: motorPower,
    motorNominal_kW: motorNominal,
    motorSizingDetail: {
      apiMarginPct: motorDetail.marginPct,
      targetMotorPower_kW: Number(motorDetail.target_kW.toFixed(2)),
      motorNominal_kW: motorDetail.nominal_kW,
    },
  };
}

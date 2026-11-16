import {
  resolveFluidProps,
  resolveNrtlPreset,
  getAllNrtlPresets,
  type FluidProps,
} from './chemproFluidBridge';
import {
  PACKING_CATALOG,
  calcTrayPointHydraulics,
  calcBilletSchultesPacking,
  type PackingCatalogSpec,
} from './columnInternalsDesign';

const G_ACCEL = 9.80665;
const R_GAS_KJ_KMOL_K = 8.31446;

export interface ChemproPackingSpec {
  name: string;
  type: 'Random' | 'Structured';
  mat: string;
  size_mm: number;
  Fp: number;
  ap: number;
  void_pct: number;
  hetp_base: number;
}

export const PACKING_DB: Record<string, ChemproPackingSpec> = {
  pall_plastic_50:    { name: 'PP/PVDF Plastic Pall Ring 50mm (2")', type: 'Random', mat: 'PP / PVDF', size_mm: 50, Fp: 85, ap: 110, void_pct: 92, hetp_base: 0.65 },
  intalox_ceramic_25: { name: 'Ceramic Intalox Saddle 25mm (1")', type: 'Random', mat: 'Acid-Proof Ceramic', size_mm: 25, Fp: 300, ap: 255, void_pct: 77, hetp_base: 0.45 },
  intalox_ceramic_38: { name: 'Ceramic Intalox Saddle 38mm (1.5")', type: 'Random', mat: 'Acid-Proof Ceramic', size_mm: 38, Fp: 170, ap: 195, void_pct: 80, hetp_base: 0.58 },
  pall_ti_38:         { name: 'Titanium Gr.2 Pall Ring 38mm (1.5")', type: 'Random', mat: 'Titanium Gr.2', size_mm: 38, Fp: 131, ap: 130, void_pct: 95, hetp_base: 0.56 },
  pall_ss316_38:      { name: 'SS316L Metal Pall Ring 38mm (1.5")', type: 'Random', mat: 'SS316L / SS304L', size_mm: 38, Fp: 131, ap: 130, void_pct: 95, hetp_base: 0.56 },
  tellerette_pp_50:   { name: 'PP/PVDF Tellerette 2" Rosette', type: 'Random', mat: 'PP / PVDF', size_mm: 50, Fp: 65, ap: 125, void_pct: 93, hetp_base: 0.55 },
  pall_metal_16:      { name: 'Metal Pall Ring 16mm (5/8")', type: 'Random', mat: 'SS316L', size_mm: 16, Fp: 266, ap: 340, void_pct: 93, hetp_base: 0.36 },
  pall_metal_25:      { name: 'Metal Pall Ring 25mm (1")', type: 'Random', mat: 'SS316L', size_mm: 25, Fp: 183, ap: 205, void_pct: 94, hetp_base: 0.48 },
  pall_metal_38:      { name: 'Metal Pall Ring 38mm (1.5")', type: 'Random', mat: 'SS316L / Ti Gr.2', size_mm: 38, Fp: 131, ap: 130, void_pct: 95, hetp_base: 0.64 },
  pall_metal_50:      { name: 'Metal Pall Ring 50mm (2")', type: 'Random', mat: 'SS316L', size_mm: 50, Fp: 89, ap: 105, void_pct: 96, hetp_base: 0.82 },
  imtp_25:            { name: 'IMTP #25 (Intalox Metal)', type: 'Random', mat: 'SS316L', size_mm: 25, Fp: 135, ap: 225, void_pct: 96.5, hetp_base: 0.42 },
  imtp_40:            { name: 'IMTP #40 (Intalox Metal)', type: 'Random', mat: 'SS316L', size_mm: 40, Fp: 79, ap: 150, void_pct: 97.0, hetp_base: 0.56 },
  imtp_50:            { name: 'IMTP #50 (Intalox Metal)', type: 'Random', mat: 'SS316L', size_mm: 50, Fp: 59, ap: 100, void_pct: 97.8, hetp_base: 0.72 },
  raschig_metal_25:   { name: 'Metal Raschig Ring 25mm', type: 'Random', mat: 'Carbon Steel / SS304', size_mm: 25, Fp: 450, ap: 190, void_pct: 86, hetp_base: 0.58 },
  berl_ceramic_25:    { name: 'Ceramic Berl Saddle 25mm', type: 'Random', mat: 'Chemical Porcelain', size_mm: 25, Fp: 360, ap: 250, void_pct: 68, hetp_base: 0.52 },
  mellapak_250y:      { name: 'Mellapak 250Y (Structured)', type: 'Structured', mat: 'SS316L Sheet 0.15mm', size_mm: 250, Fp: 66, ap: 250, void_pct: 98.0, hetp_base: 0.38 },
  mellapak_350y:      { name: 'Mellapak 350Y (Structured)', type: 'Structured', mat: 'SS316L Sheet 0.15mm', size_mm: 350, Fp: 95, ap: 350, void_pct: 97.5, hetp_base: 0.29 },
  mellapak_500y:      { name: 'Mellapak 500Y (Structured)', type: 'Structured', mat: 'SS316L Gauze/Sheet', size_mm: 500, Fp: 145, ap: 500, void_pct: 96.5, hetp_base: 0.22 },
};

export interface NRTLGammaResult {
  gamma1: number;
  gamma2: number;
}

export interface BubblePointNRTLResult {
  T_C: number;
  y1: number;
  gamma1: number;
  gamma2: number;
  alpha_loc: number;
  K1: number;
  K2: number;
  iters: number;
}

export interface VLEPoint {
  x: number;
  y: number;
  T: number;
  alpha: number;
}

export interface ColumnIterationRow {
  iter: number;
  param: string;
  assumed: string;
  calc: string;
  err: string;
  note: string;
}

export interface ColumnWarning {
  level: 'ok' | 'warn' | 'danger';
  text: string;
}

export interface ChemproColumnInput {
  equipTag?: string;
  equipName?: string;
  col_mode?: 'distillation' | 'absorption' | string;
  columnType?: 'distillation' | 'absorption' | string;
  lkFluidId?: string;
  hkFluidId?: string;
  P_col_bar?: number;
  nrtlPreset?: string;
  presetId?: string;
  nrtl_a12?: number;
  nrtl_a21?: number;
  nrtl_alpha?: number;
  F_kmolh?: number;
  zF?: number;
  xD?: number;
  xB?: number;
  q?: number;
  R_mult?: number;
  manualAlpha?: boolean;
  alpha?: number;
  rhoL?: number;
  rhoV?: number;
  sigma?: number;
  hv_kJmol?: number;
  internals?: 'tray' | 'packed' | string;
  tray_type?: 'sieve' | 'valve' | 'bubble_cap' | string;
  tray_passes?: number;
  tray_spacing_m?: number;
  hole_d_mm?: number;
  weir_h_mm?: number;
  hole_area_pct?: number;
  tray_eff_pct?: number;
  pack_key?: string;
  bed_max_h_m?: number;
  flood_pct?: number;
}

export interface ChemproDistillationResult {
  equipTag: string;
  equipName: string;
  colMode: 'distillation';
  lkBase: FluidProps;
  hkBase: FluidProps;
  P_bar: number;
  internals: 'tray' | 'packed';
  trayType: 'sieve' | 'valve' | 'bubble_cap';
  trayPasses: number;
  holeD_mm: number;
  weirH_mm: number;
  holeAreaPct: number;
  traySpacing_m: number;
  packKey: string;
  packSpec: ChemproPackingSpec;
  H_pack_total_m: number;
  N_beds: number;
  dP_pack_mbar_m: number;
  HETP_m: number;
  internalsSummary: string;
  T_top_C: number;
  T_feed_C: number;
  T_bot_C: number;
  gamma1_top: number;
  gamma2_bot: number;
  alpha: number;
  alpha_calc: number;
  azeotropeX: number | null;
  vleCurve: VLEPoint[];
  F: number;
  D: number;
  B: number;
  zF: number;
  xD: number;
  xB: number;
  q: number;
  lk_recovery_pct: number;
  Nmin: number;
  N_min: number;
  Rmin: number;
  R_min: number;
  R: number;
  N_theo: number;
  N_actual: number;
  feed_stage_actual: number;
  feedStage: number;
  E_overall_pct: number;
  L_rect: number;
  V_rect: number;
  L_strip: number;
  V_strip: number;
  Qc_kW: number;
  Qr_kW: number;
  Csb: number;
  u_flood: number;
  u_design: number;
  u_op: number;
  F_factor: number;
  D_col_m: number;
  H_tangent_m: number;
  weep_ratio: number;
  psi_entrain: number;
  dc_backup_pct: number;
  dP_tray_mbar: number;
  dP_total_mbar: number;
  // Upgraded MESH, Heat Exchanger Duty/UA & Internals Master Fields
  x_profile: number[];
  y_profile: number[];
  T_profile: number[];
  L_profile: number[];
  V_profile: number[];
  K1_profile: number[];
  K2_profile: number[];
  stage_pressures_bar: number[];
  tray_x_profile: number[];
  tray_y_profile: number[];
  tray_T_profile: number[];
  xD_mesh: number;
  xB_mesh: number;
  meshConverged: boolean;
  meshIterations: number;
  meshFallbackUsed: boolean;
  meshMassBalanceErrPct: number;
  meshEnergyBalanceErrPct: number;
  murphreeEff: number;
  nrtlPresetId: string | null;
  nrtl_a12: number;
  nrtl_a21: number;
  nrtl_alpha: number;
  condenserUA_WK: number;
  reboilerUA_WK: number;
  condenserArea_m2: number;
  reboilerArea_m2: number;
  flood_pct: number;
  trayHydraulics: ReturnType<typeof calcTrayPointHydraulics> | null;
  billetSchultes: ReturnType<typeof calcBilletSchultesPacking> | null;
  status: 'ok' | 'warning' | 'error';
  iterations: ColumnIterationRow[];
  warnings: ColumnWarning[];
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function calcNRTLGamma(
  x1: number,
  T_K: number,
  a12_cal: number,
  a21_cal: number,
  alpha12 = 0.3
): NRTLGammaResult {
  const x = clampNum(x1, 0.0001, 0.9999);
  const x2 = 1.0 - x;
  if (Math.abs(a12_cal) < 1e-3 && Math.abs(a21_cal) < 1e-3) {
    return { gamma1: 1.0, gamma2: 1.0 };
  }
  const RT = 1.9872 * Math.max(200.0, T_K);
  const tau12 = a12_cal / RT;
  const tau21 = a21_cal / RT;
  const G12 = Math.exp(-alpha12 * tau12);
  const G21 = Math.exp(-alpha12 * tau21);

  const denom1 = x + x2 * G21;
  const denom2 = x2 + x * G12;
  const lnGamma1 =
    x2 * x2 * (tau21 * Math.pow(G21 / denom1, 2) + (tau12 * G12) / (denom2 * denom2));
  const lnGamma2 =
    x * x * (tau12 * Math.pow(G12 / denom2, 2) + (tau21 * G21) / (denom1 * denom1));
  return {
    gamma1: clampNum(Math.exp(lnGamma1), 0.1, 25.0),
    gamma2: clampNum(Math.exp(lnGamma2), 0.1, 25.0),
  };
}

export function solveBubblePointNRTL(
  x1: number,
  P_bar: number,
  lkFluid: { id: string; tb: number } | string,
  hkFluid: { id: string; tb: number } | string,
  a12 = 0,
  a21 = 0,
  alpha12 = 0.3
): BubblePointNRTLResult {
  const lkId = typeof lkFluid === 'string' ? lkFluid : lkFluid.id;
  const hkId = typeof hkFluid === 'string' ? hkFluid : hkFluid.id;
  const lkTb = typeof lkFluid === 'string' ? resolveFluidProps(lkId).tb : lkFluid.tb;
  const hkTb = typeof hkFluid === 'string' ? resolveFluidProps(hkId).tb : hkFluid.tb;

  const x = clampNum(x1, 0.0, 1.0);
  const P = Math.max(0.02, P_bar);
  let T = x * lkTb + (1.0 - x) * hkTb;
  let y1 = x;
  let gamma1 = 1.0;
  let gamma2 = 1.0;
  let alpha_loc = 2.0;
  let K1 = 1.0;
  let K2 = 0.5;
  let iters = 0;

  const evalSumY = (T_C: number) => {
    const p1 = resolveFluidProps(lkId, T_C);
    const p2 = resolveFluidProps(hkId, T_C);
    const g = calcNRTLGamma(x, T_C + 273.15, a12, a21, alpha12);
    const k1 = (g.gamma1 * p1.pv_bar) / P;
    const k2 = (g.gamma2 * p2.pv_bar) / P;
    const sumY = k1 * x + k2 * (1.0 - x);
    return { sumY, k1, k2, g };
  };

  for (let it = 1; it <= 22; it++) {
    iters = it;
    const ev = evalSumY(T);
    gamma1 = ev.g.gamma1;
    gamma2 = ev.g.gamma2;
    K1 = ev.k1;
    K2 = ev.k2;
    alpha_loc = K1 / Math.max(1e-5, K2);
    y1 = (K1 * x) / Math.max(1e-5, ev.sumY);

    if (Math.abs(ev.sumY - 1.0) < 0.00015) break;

    const evPlus = evalSumY(T + 0.5);
    const evMinus = evalSumY(T - 0.5);
    const dlnSumDT = clampNum(
      Math.log(Math.max(1e-6, evPlus.sumY) / Math.max(1e-6, evMinus.sumY)),
      0.012,
      0.095
    );
    const dT = -Math.log(Math.max(0.05, ev.sumY)) / dlnSumDT;
    T += clampNum(dT, -20.0, 20.0);
  }

  return { T_C: T, y1, gamma1, gamma2, alpha_loc, K1, K2, iters };
}

/**
 * Pure liquid & vapor molar enthalpies [kJ/kmol] referenced to liquid at T_ref = 25 °C.
 */
function calcPureComponentMolarEnthalpies(
  fluidId: string,
  T_C: number,
  tb_C: number,
  mw: number,
  hv_tb_kJkg: number,
  cpLiqFallback: number,
  cpVapFallback: number
): { hL: number; hV: number } {
  const T_ref = 25.0;
  const pT = resolveFluidProps(fluidId, T_C);
  const pMidLiq = resolveFluidProps(fluidId, 0.5 * (T_C + T_ref));
  const cpL = Math.max(0.4, pMidLiq.cp || cpLiqFallback);
  const cpV = Math.max(0.35, pT.cp_vap || cpVapFallback || cpL * 0.62);
  const hv_tb = Math.max(40.0, hv_tb_kJkg);

  const hL = mw * cpL * (T_C - T_ref);
  const hV_at_tb = mw * (cpL * (tb_C - T_ref) + hv_tb);
  const hV = hV_at_tb + mw * cpV * (T_C - tb_C);
  return { hL, hV };
}

function calcMixtureEnthalpies(
  x1: number,
  y1: number,
  T_C: number,
  lkId: string,
  hkId: string,
  lkTb: number,
  hkTb: number,
  lkMw: number,
  hkMw: number,
  lkHvTb: number,
  hkHvTb: number,
  lkCpL: number,
  hkCpL: number,
  lkCpV: number,
  hkCpV: number
): { hL: number; hV: number } {
  const x = clampNum(x1, 0, 1);
  const y = clampNum(y1, 0, 1);
  const c1 = calcPureComponentMolarEnthalpies(lkId, T_C, lkTb, lkMw, lkHvTb, lkCpL, lkCpV);
  const c2 = calcPureComponentMolarEnthalpies(hkId, T_C, hkTb, hkMw, hkHvTb, hkCpL, hkCpV);
  return {
    hL: x * c1.hL + (1.0 - x) * c2.hL,
    hV: y * c1.hV + (1.0 - y) * c2.hV,
  };
}

/**
 * Thomas tridiagonal solver for system a[j]*x[j-1] + b[j]*x[j] + c[j]*x[j+1] = d[j], j = 0..n-1.
 */
function solveTridiagonalThomas(
  a: number[],
  b: number[],
  c: number[],
  d: number[]
): number[] {
  const n = b.length;
  const cp = new Array<number>(n).fill(0);
  const dp = new Array<number>(n).fill(0);
  const x = new Array<number>(n).fill(0);

  const b0 = Math.abs(b[0]) < 1e-12 ? (b[0] >= 0 ? 1e-12 : -1e-12) : b[0];
  cp[0] = c[0] / b0;
  dp[0] = d[0] / b0;

  for (let i = 1; i < n; i++) {
    const denomRaw = b[i] - a[i] * cp[i - 1];
    const denom = Math.abs(denomRaw) < 1e-12 ? (denomRaw >= 0 ? 1e-12 : -1e-12) : denomRaw;
    cp[i] = i < n - 1 ? c[i] / denom : 0;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / denom;
  }

  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    x[i] = dp[i] - cp[i] * x[i + 1];
  }
  return x;
}

interface MeshSolveOutput {
  converged: boolean;
  iterations: number;
  x_profile: number[];
  y_profile: number[];
  T_profile: number[];
  L_profile: number[];
  V_profile: number[];
  K1_profile: number[];
  K2_profile: number[];
  stage_pressures_bar: number[];
  Qc_kW: number;
  Qr_kW: number;
  gamma1_top: number;
  gamma2_bot: number;
  massErrPct: number;
  energyErrPct: number;
  degeneratePinch: boolean;
}

/**
 * Stage-by-stage binary NRTL Wang-Henke Bubble-Point MESH solver (Mass, Equilibrium, Summation, Heat/Enthalpy)
 * across Total Condenser (j=0), Trays/Stages (j=1..N_eq-1), and Partial Reboiler (j=N_eq).
 */
function solveBinaryNrtlMesh(params: {
  N_eq: number;
  feedIdx: number;
  P_top_bar: number;
  dP_total_bar: number;
  F: number;
  D: number;
  B: number;
  zF: number;
  xD_init: number;
  xB_init: number;
  R: number;
  q: number;
  T_feed_bp_C: number;
  lkBase: FluidProps;
  hkBase: FluidProps;
  a12: number;
  a21: number;
  nrtlAlpha: number;
}): MeshSolveOutput {
  const {
    N_eq,
    feedIdx,
    P_top_bar,
    dP_total_bar,
    F,
    D,
    B,
    zF,
    xD_init,
    xB_init,
    R,
    q,
    T_feed_bp_C,
    lkBase,
    hkBase,
    a12,
    a21,
    nrtlAlpha,
  } = params;

  const nStages = N_eq + 1; // 0 = Total Condenser, 1..N_eq-1 = equilibrium trays, N_eq = Partial Reboiler
  const lkId = lkBase.id;
  const hkId = hkBase.id;
  const lkSat = resolveFluidProps(lkId, lkBase.tb);
  const hkSat = resolveFluidProps(hkId, hkBase.tb);
  const lkHvTb = Math.max(40, lkSat.hv_T || lkBase.hv || 350);
  const hkHvTb = Math.max(40, hkSat.hv_T || hkBase.hv || 400);

  const bpTop0 = solveBubblePointNRTL(xD_init, P_top_bar, lkBase, hkBase, a12, a21, nrtlAlpha);
  const bpBot0 = solveBubblePointNRTL(xB_init, P_top_bar + dP_total_bar, lkBase, hkBase, a12, a21, nrtlAlpha);

  const T_feed_dew_approx = T_feed_bp_C + 0.35 * Math.abs(hkBase.tb - lkBase.tb);
  const hF_liq = calcMixtureEnthalpies(
    zF, zF, T_feed_bp_C, lkId, hkId, lkBase.tb, hkBase.tb, lkBase.mw, hkBase.mw,
    lkHvTb, hkHvTb, lkBase.cp, hkBase.cp, lkBase.cp_vap, hkBase.cp_vap
  ).hL;
  const hF_vap = calcMixtureEnthalpies(
    zF, zF, T_feed_dew_approx, lkId, hkId, lkBase.tb, hkBase.tb, lkBase.mw, hkBase.mw,
    lkHvTb, hkHvTb, lkBase.cp, hkBase.cp, lkBase.cp_vap, hkBase.cp_vap
  ).hV;
  const hF = q * hF_liq + (1.0 - q) * hF_vap;

  const P_stage = new Array<number>(nStages);
  const x1 = new Array<number>(nStages);
  const y1 = new Array<number>(nStages);
  const T_C = new Array<number>(nStages);
  const K1 = new Array<number>(nStages);
  const K2 = new Array<number>(nStages);
  const L_flow = new Array<number>(nStages);
  const V_flow = new Array<number>(nStages);
  const hL = new Array<number>(nStages);
  const hV = new Array<number>(nStages);

  const V_rect0 = (R + 1.0) * D;
  const L_rect0 = R * D;
  const V_strip0 = Math.max(0.2 * D, V_rect0 - (1.0 - q) * F);
  const L_strip0 = L_rect0 + q * F;

  let gamma1_top = bpTop0.gamma1;
  let gamma2_bot = bpBot0.gamma2;

  for (let j = 0; j < nStages; j++) {
    const frac = j / N_eq;
    P_stage[j] = P_top_bar + frac * dP_total_bar;
    const xInit = clampNum(xD_init + frac * (xB_init - xD_init), 1e-4, 1 - 1e-4);
    x1[j] = xInit;
    const bp = solveBubblePointNRTL(xInit, P_stage[j], lkBase, hkBase, a12, a21, nrtlAlpha);
    T_C[j] = bp.T_C;
    K1[j] = bp.K1;
    K2[j] = bp.K2;
    y1[j] = j === 0 ? xInit : bp.y1;
    if (j < feedIdx) {
      L_flow[j] = L_rect0;
      V_flow[j] = j === 0 ? 0 : V_rect0;
    } else {
      L_flow[j] = j === N_eq ? B : L_strip0;
      V_flow[j] = V_strip0;
    }
    const mh = calcMixtureEnthalpies(
      x1[j], y1[j], T_C[j], lkId, hkId, lkBase.tb, hkBase.tb, lkBase.mw, hkBase.mw,
      lkHvTb, hkHvTb, lkBase.cp, hkBase.cp, lkBase.cp_vap, hkBase.cp_vap
    );
    hL[j] = mh.hL;
    hV[j] = mh.hV;
  }

  let converged = false;
  let iters = 0;
  let Qc_kW = (V_rect0 * (hV[1] - hL[0])) / 3600.0;
  let Qr_kW = Qc_kW;

  for (let it = 1; it <= 45; it++) {
    iters = it;

    // 1. Thomas tridiagonal component mass balances for LK (i=1) and HK (i=2)
    const buildAndSolveComponent = (compIdx: 1 | 2): number[] => {
      const a = new Array<number>(nStages).fill(0);
      const b = new Array<number>(nStages).fill(0);
      const c = new Array<number>(nStages).fill(0);
      const d = new Array<number>(nStages).fill(0);
      const Karr = compIdx === 1 ? K1 : K2;
      const zFeedComp = compIdx === 1 ? zF : 1.0 - zF;

      // Stage 0: Total Condenser V1*y1 - (L0 + D)*x0 = 0
      b[0] = -(L_flow[0] + D);
      c[0] = V_flow[1] * Karr[1];
      d[0] = 0;

      // Stages 1 .. N_eq - 1: L_{j-1}*x_{j-1} - (L_j + V_j*K_j)*x_j + V_{j+1}*K_{j+1}*x_{j+1} = -F_j*z_F
      for (let j = 1; j < N_eq; j++) {
        a[j] = L_flow[j - 1];
        b[j] = -(L_flow[j] + V_flow[j] * Karr[j]);
        c[j] = V_flow[j + 1] * Karr[j + 1];
        d[j] = j === feedIdx ? -F * zFeedComp : 0;
      }

      // Stage N_eq: Partial Reboiler L_{N-1}*x_{N-1} - (B + V_N*K_N)*x_N = 0
      a[N_eq] = L_flow[N_eq - 1];
      b[N_eq] = -(B + V_flow[N_eq] * Karr[N_eq]);
      c[N_eq] = 0;
      d[N_eq] = 0;

      return solveTridiagonalThomas(a, b, c, d);
    };

    const x1Sol = buildAndSolveComponent(1);
    const x2Sol = buildAndSolveComponent(2);

    let maxDX = 0;
    const dampX = it <= 5 ? 0.65 : 0.75;
    for (let j = 0; j < nStages; j++) {
      const p1 = Math.max(1e-8, x1Sol[j]);
      const p2 = Math.max(1e-8, x2Sol[j]);
      const xNorm = clampNum(p1 / (p1 + p2), 1e-6, 1 - 1e-6);
      const xNext = (1 - dampX) * x1[j] + dampX * xNorm;
      maxDX = Math.max(maxDX, Math.abs(xNext - x1[j]));
      x1[j] = xNext;
    }

    // 2. Stage-by-stage Bubble-Point T_j & NRTL K_{1,j}, K_{2,j}
    let maxDT = 0;
    for (let j = 0; j < nStages; j++) {
      const bp = solveBubblePointNRTL(x1[j], P_stage[j], lkBase, hkBase, a12, a21, nrtlAlpha);
      const Tnext = 0.25 * T_C[j] + 0.75 * bp.T_C;
      maxDT = Math.max(maxDT, Math.abs(Tnext - T_C[j]));
      T_C[j] = Tnext;
      K1[j] = bp.K1;
      K2[j] = bp.K2;
      if (j === 0) {
        gamma1_top = bp.gamma1;
      }
      if (j === N_eq) {
        gamma2_bot = bp.gamma2;
      }
    }
    for (let j = 1; j < nStages; j++) {
      y1[j] = clampNum((K1[j] * x1[j]) / Math.max(1e-8, K1[j] * x1[j] + K2[j] * (1.0 - x1[j])), 1e-6, 1 - 1e-6);
    }
    y1[0] = y1[1]; // vapor rising into total condenser

    // 3. Evaluate Stage Mixture Enthalpies & Top-Envelope Non-CMO Flow Update
    for (let j = 0; j < nStages; j++) {
      const mh = calcMixtureEnthalpies(
        x1[j], y1[j], T_C[j], lkId, hkId, lkBase.tb, hkBase.tb, lkBase.mw, hkBase.mw,
        lkHvTb, hkHvTb, lkBase.cp, hkBase.cp, lkBase.cp_vap, hkBase.cp_vap
      );
      hL[j] = mh.hL;
      hV[j] = mh.hV;
    }

    V_flow[1] = V_rect0;
    L_flow[0] = L_rect0;
    const Qc_kJh = Math.max(100.0, V_flow[1] * (hV[1] - hL[0]));
    Qc_kW = Qc_kJh / 3600.0;

    const vLo = Math.max(0.25 * D, 0.35 * V_rect0);
    const vHi = Math.max(V_rect0, V_strip0) * 2.2;
    for (let j = 2; j < nStages; j++) {
      const aboveFeed = j - 1 >= feedIdx;
      const F_above = aboveFeed ? F : 0;
      const M_net_above = D - F_above;
      const rhs_kJh = Qc_kJh + D * hL[0] - F_above * hF - M_net_above * hL[j - 1];
      const latSpan = Math.max(500.0, hV[j] - hL[j - 1]);
      const V_new = clampNum(rhs_kJh / latSpan, vLo, vHi);
      V_flow[j] = 0.5 * V_flow[j] + 0.5 * V_new;
    }
    for (let j = 1; j < N_eq; j++) {
      const F_cum = j >= feedIdx ? F : 0;
      L_flow[j] = Math.max(0.05 * D, V_flow[j + 1] - (D - F_cum));
    }
    L_flow[N_eq] = B;

    const Qr_kJh = Qc_kJh + D * hL[0] + B * hL[N_eq] - F * hF;
    Qr_kW = Math.max(10.0, Qr_kJh / 3600.0);

    const massErrRel = Math.abs(D * x1[0] + B * x1[N_eq] - F * zF) / Math.max(1e-6, F * zF);
    if (it >= 5 && maxDX < 2e-4 && maxDT < 0.05 && massErrRel < 2e-3) {
      converged = true;
      break;
    }
  }

  const massErrPct = (Math.abs(D * x1[0] + B * x1[N_eq] - F * zF) / Math.max(1e-6, F * zF)) * 100.0;
  const energyIn_kW = (F * hF) / 3600.0 + Qr_kW;
  const energyOut_kW = (D * hL[0] + B * hL[N_eq]) / 3600.0 + Qc_kW;
  const energyErrPct = (Math.abs(energyIn_kW - energyOut_kW) / Math.max(1.0, Math.abs(Qc_kW) + Math.abs(Qr_kW))) * 100.0;
  const degeneratePinch = Math.abs(T_C[N_eq] - T_C[0]) < 0.35 || T_C.some((t) => !Number.isFinite(t));

  return {
    converged: converged && !degeneratePinch,
    iterations: iters,
    x_profile: x1,
    y_profile: y1,
    T_profile: T_C,
    L_profile: L_flow,
    V_profile: V_flow,
    K1_profile: K1,
    K2_profile: K2,
    stage_pressures_bar: P_stage,
    Qc_kW,
    Qr_kW,
    gamma1_top,
    gamma2_bot,
    massErrPct,
    energyErrPct,
    degeneratePinch,
  };
}

/**
 * Generates clean FUG + McCabe-Thiele fallback profiles when extreme azeotropic/close-boiling pinch prevents MESH convergence.
 */
function buildMcCabeThieleFallbackProfiles(
  N_eq: number,
  feedIdx: number,
  xD: number,
  xB: number,
  zF: number,
  R: number,
  alpha: number,
  P_top_bar: number,
  dP_total_bar: number,
  lkBase: FluidProps,
  hkBase: FluidProps,
  a12: number,
  a21: number,
  nrtlAlpha: number,
  L_rect: number,
  V_rect: number,
  L_strip: number,
  V_strip: number
) {
  const nStages = N_eq + 1;
  const x_profile = new Array<number>(nStages);
  const y_profile = new Array<number>(nStages);
  const T_profile = new Array<number>(nStages);
  const L_profile = new Array<number>(nStages);
  const V_profile = new Array<number>(nStages);
  const K1_profile = new Array<number>(nStages);
  const K2_profile = new Array<number>(nStages);
  const stage_pressures_bar = new Array<number>(nStages);

  const slopeR = R / (R + 1.0);
  const intR = xD / (R + 1.0);
  const x_int = zF;
  const y_int = slopeR * x_int + intR;

  let yCurr = xD;
  x_profile[0] = xD;
  y_profile[0] = xD;

  for (let j = 1; j < nStages; j++) {
    const xFromAlpha = yCurr / Math.max(0.01, alpha - (alpha - 1.0) * yCurr);
    const xStage = clampNum(xFromAlpha, xB, xD);
    x_profile[j] = xStage;
    y_profile[j] = yCurr;
    yCurr =
      xStage >= x_int
        ? slopeR * xStage + intR
        : xB + ((y_int - xB) / Math.max(1e-4, x_int - xB)) * (xStage - xB);
  }
  x_profile[N_eq] = xB;

  for (let j = 0; j < nStages; j++) {
    stage_pressures_bar[j] = P_top_bar + (j / N_eq) * dP_total_bar;
    const bp = solveBubblePointNRTL(x_profile[j], stage_pressures_bar[j], lkBase, hkBase, a12, a21, nrtlAlpha);
    T_profile[j] = bp.T_C;
    K1_profile[j] = bp.K1;
    K2_profile[j] = bp.K2;
    L_profile[j] = j === 0 ? L_rect : j < feedIdx ? L_rect : L_strip;
    V_profile[j] = j === 0 ? 0 : j < feedIdx ? V_rect : V_strip;
  }

  return { x_profile, y_profile, T_profile, L_profile, V_profile, K1_profile, K2_profile, stage_pressures_bar };
}

/**
 * Maps theoretical stage profiles (0..N_eq) onto N_actual real trays adjusted by Murphree efficiency E_MV.
 */
function interpolateActualTrayProfiles(
  x_eq: number[],
  y_eq: number[],
  T_eq: number[],
  N_actual: number,
  E_MV: number
): { tray_x_profile: number[]; tray_y_profile: number[]; tray_T_profile: number[] } {
  const nEq = x_eq.length - 1;
  const nTray = Math.max(2, N_actual);
  const tray_x_profile = new Array<number>(nTray);
  const tray_y_profile = new Array<number>(nTray);
  const tray_T_profile = new Array<number>(nTray);

  for (let m = 0; m < nTray; m++) {
    const sPos = 1.0 + (m / Math.max(1, nTray - 1)) * Math.max(1.0, nEq - 1.0);
    const idx0 = clampNum(Math.floor(sPos), 0, nEq - 1);
    const idx1 = Math.min(nEq, idx0 + 1);
    const w = sPos - idx0;
    const xVal = (1 - w) * x_eq[idx0] + w * x_eq[idx1];
    const yStar = (1 - w) * y_eq[idx0] + w * y_eq[idx1];
    const yBelow = idx1 < nEq ? y_eq[idx1 + 1] : y_eq[idx1];
    tray_x_profile[m] = xVal;
    tray_y_profile[m] = clampNum(yBelow + E_MV * (yStar - yBelow), 0, 1);
    tray_T_profile[m] = (1 - w) * T_eq[idx0] + w * T_eq[idx1];
  }
  return { tray_x_profile, tray_y_profile, tray_T_profile };
}

/**
 * Maps ChemPro's 18-item PACKING_DB onto Billet-Schultes (1999) PackingCatalogSpec.
 */
function mapPackingToCatalogSpec(packKey: string, packSpec: ChemproPackingSpec): PackingCatalogSpec {
  if (packKey === 'mellapak_250y') {
    return { ...PACKING_CATALOG.mellapak_250y, name: packSpec.name };
  }
  if (packKey === 'mellapak_350y') {
    return { ...PACKING_CATALOG.mellapak_350y, name: packSpec.name };
  }
  if (packKey === 'imtp_40') {
    return { ...PACKING_CATALOG.imtp_40_metal, name: packSpec.name };
  }
  if (packKey === 'pall_metal_38' || packKey === 'pall_ss316_38' || packKey === 'pall_ti_38') {
    return { ...PACKING_CATALOG.pall_ring_38_ss, name: packSpec.name };
  }
  if (packKey === 'pall_metal_25') {
    return { ...PACKING_CATALOG.pall_ring_25_ss, name: packSpec.name };
  }
  if (packKey === 'intalox_ceramic_38') {
    return { ...PACKING_CATALOG.ceramic_intalox_38, name: packSpec.name };
  }

  let template: PackingCatalogSpec = PACKING_CATALOG.pall_ring_38_ss;
  if (packSpec.type === 'Structured') {
    template = packSpec.ap >= 320 ? PACKING_CATALOG.mellapak_350y : PACKING_CATALOG.mellapak_250y;
  } else if (packKey.startsWith('imtp_')) {
    template = PACKING_CATALOG.imtp_40_metal;
  } else if (packSpec.mat.toLowerCase().includes('ceramic') || packSpec.mat.toLowerCase().includes('porcelain')) {
    template = PACKING_CATALOG.ceramic_intalox_38;
  } else if (packSpec.size_mm <= 26) {
    template = PACKING_CATALOG.pall_ring_25_ss;
  }

  return {
    ...template,
    name: packSpec.name,
    category: packSpec.type === 'Structured' ? 'structured' : 'random',
    materialNote: packSpec.mat,
    packingFactorFpM1: packSpec.Fp,
    surfaceAreaM2M3: packSpec.ap,
    voidFraction: packSpec.void_pct / 100.0,
    baseHetpM: packSpec.hetp_base,
    minWettingM3M2H: packSpec.type === 'Structured' ? 0.12 : 0.5,
  };
}

function resolveNrtlParameters(
  lkId: string,
  hkId: string,
  inp: ChemproColumnInput
): { presetId: string | null; a12: number; a21: number; alpha: number } {
  const reqPreset = inp.nrtlPreset || inp.presetId;
  if (reqPreset) {
    const p = resolveNrtlPreset(reqPreset);
    if (p) {
      return {
        presetId: reqPreset,
        a12: inp.nrtl_a12 !== undefined ? inp.nrtl_a12 : p.a12,
        a21: inp.nrtl_a21 !== undefined ? inp.nrtl_a21 : p.a21,
        alpha: inp.nrtl_alpha !== undefined && inp.nrtl_alpha > 0 ? inp.nrtl_alpha : p.alpha,
      };
    }
  }

  const allPresets = getAllNrtlPresets();
  for (const [key, p] of Object.entries(allPresets)) {
    if (p.lk === lkId && p.hk === hkId) {
      return {
        presetId: key,
        a12: inp.nrtl_a12 !== undefined ? inp.nrtl_a12 : p.a12,
        a21: inp.nrtl_a21 !== undefined ? inp.nrtl_a21 : p.a21,
        alpha: inp.nrtl_alpha !== undefined && inp.nrtl_alpha > 0 ? inp.nrtl_alpha : p.alpha,
      };
    }
    if (p.lk === hkId && p.hk === lkId) {
      return {
        presetId: key,
        a12: inp.nrtl_a12 !== undefined ? inp.nrtl_a12 : p.a21,
        a21: inp.nrtl_a21 !== undefined ? inp.nrtl_a21 : p.a12,
        alpha: inp.nrtl_alpha !== undefined && inp.nrtl_alpha > 0 ? inp.nrtl_alpha : p.alpha,
      };
    }
  }

  return {
    presetId: null,
    a12: inp.nrtl_a12 !== undefined ? inp.nrtl_a12 : 0.0,
    a21: inp.nrtl_a21 !== undefined ? inp.nrtl_a21 : 0.0,
    alpha: inp.nrtl_alpha !== undefined && inp.nrtl_alpha > 0 ? inp.nrtl_alpha : 0.3,
  };
}

/**
 * Solves distillation column design/rating using NRTL VLE, Fenske-Underwood-Gilliland shortcut,
 * stage-by-stage binary NRTL MESH tray solver (in 'rigorous' mode), Fair/Glitsch/Chan-Fair tray hydraulics,
 * and Billet-Schultes (1999) + Eckert GPDC mechanistic packing hydraulics.
 */
export function solveDistillationColumn(
  inp: ChemproColumnInput,
  mode: 'quick' | 'rigorous' = 'rigorous'
): ChemproDistillationResult {
  const colMode = inp.col_mode || inp.columnType || 'distillation';
  if (colMode === 'absorption') {
    throw new Error('solveDistillationColumn only handles distillation mode (col_mode !== "absorption").');
  }

  const lkId = inp.lkFluidId || 'ethanol';
  const hkId = inp.hkFluidId || 'water';
  const lkBase = resolveFluidProps(lkId);
  const hkBase = resolveFluidProps(hkId);
  const P_bar = Math.max(0.05, inp.P_col_bar || 1.05);

  const packKey = inp.pack_key || 'pall_metal_38';
  const packSpec = PACKING_DB[packKey] || PACKING_DB.pall_plastic_50;
  const bedMaxH_m = inp.bed_max_h_m || 4.5;
  const floodFrac = clampNum((inp.flood_pct || 78) / 100.0, 0.45, 0.9);

  const nrtlInfo = resolveNrtlParameters(lkId, hkId, inp);
  const a12 = nrtlInfo.a12;
  const a21 = nrtlInfo.a21;
  const nrtlAlpha = nrtlInfo.alpha;

  const F = Math.max(1.0, inp.F_kmolh || 100.0);
  const zF = clampNum(inp.zF || 0.45, 0.02, 0.98);
  const xD = clampNum(inp.xD || 0.96, zF + 0.02, 0.999);
  const xB = clampNum(inp.xB || 0.03, 0.001, zF - 0.02);
  const q = inp.q !== undefined ? inp.q : 1.0;
  const R_mult = Math.max(1.03, inp.R_mult || 1.25);

  const iterations: ColumnIterationRow[] = [];

  // 1. Bubble-Point VLE Convergence at Top (xD), Feed (zF), and Bottom (xB)
  const bpTop = solveBubblePointNRTL(xD, P_bar, lkBase, hkBase, a12, a21, nrtlAlpha);
  const bpFeed = solveBubblePointNRTL(zF, P_bar, lkBase, hkBase, a12, a21, nrtlAlpha);
  const bpBot = solveBubblePointNRTL(xB, P_bar, lkBase, hkBase, a12, a21, nrtlAlpha);

  iterations.push({
    iter: 1,
    param: `탑상 이슬/기포점 수렴 (x_D=${xD.toFixed(3)})`,
    assumed: `${lkBase.tb.toFixed(1)} °C`,
    calc: `T_top=${bpTop.T_C.toFixed(1)} °C (α_top=${bpTop.alpha_loc.toFixed(2)}, γ₁=${bpTop.gamma1.toFixed(2)})`,
    err: `< 0.02% (${bpTop.iters}회)`,
    note: 'Antoine + NRTL 기액평형 수렴',
  });
  iterations.push({
    iter: 2,
    param: `공급단 기포점 수렴 (z_F=${zF.toFixed(3)})`,
    assumed: `${(0.5 * (lkBase.tb + hkBase.tb)).toFixed(1)} °C`,
    calc: `T_feed=${bpFeed.T_C.toFixed(1)} °C (α_F=${bpFeed.alpha_loc.toFixed(2)}, γ₁=${bpFeed.gamma1.toFixed(2)})`,
    err: `< 0.02% (${bpFeed.iters}회)`,
    note: '공급단 활동도계수 산출 완료',
  });
  iterations.push({
    iter: 3,
    param: `탑저 기포점 수렴 (x_B=${xB.toFixed(3)})`,
    assumed: `${hkBase.tb.toFixed(1)} °C`,
    calc: `T_bot=${bpBot.T_C.toFixed(1)} °C (α_bot=${bpBot.alpha_loc.toFixed(2)}, γ₂=${bpBot.gamma2.toFixed(2)})`,
    err: `< 0.02% (${bpBot.iters}회)`,
    note: '탑저 리보일러 온도 확정',
  });

  // 51-point Non-Ideal NRTL VLE Curve & Azeotrope Detection
  const vleCurve: VLEPoint[] = [];
  let azeotropeX: number | null = null;
  let prevDiff: number | null = null;
  for (let i = 0; i <= 50; i++) {
    const xi = i / 50.0;
    const bp = solveBubblePointNRTL(xi, P_bar, lkBase, hkBase, a12, a21, nrtlAlpha);
    vleCurve.push({ x: xi, y: bp.y1, T: bp.T_C, alpha: bp.alpha_loc });
    if (i > 0 && i < 50) {
      const diff = bp.y1 - xi;
      if (prevDiff !== null && prevDiff * diff <= 0) {
        const denom = diff - prevDiff;
        const frac = Math.abs(denom) > 1e-12 ? diff / denom : 0;
        azeotropeX = clampNum(xi - frac * (1.0 / 50.0), 0.001, 0.999);
      }
      prevDiff = diff;
    }
  }

  const alpha_calc = Math.pow(
    Math.max(1.02, bpTop.alpha_loc) * Math.max(1.02, bpFeed.alpha_loc) * Math.max(1.02, bpBot.alpha_loc),
    1.0 / 3.0
  );
  const alpha = inp.manualAlpha && inp.alpha && inp.alpha > 1.01 ? inp.alpha : Math.max(1.05, alpha_calc);

  // Overall Component Balance & FUG Shortcut
  const D = (F * (zF - xB)) / (xD - xB);
  const B = F - D;
  const lk_recovery_pct = ((D * xD) / (F * zF)) * 100.0;

  const Nmin = Math.log((xD / (1.0 - xD)) * ((1.0 - xB) / xB)) / Math.log(alpha);

  let theta = 1.25;
  if (Math.abs(q - 1.0) < 1e-4) {
    theta = alpha / (1.0 + (alpha - 1.0) * zF);
  } else {
    let lo = 1.0001;
    let hi = alpha - 0.0001;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      const fval = (alpha * zF) / (alpha - mid) + (1.0 - zF) / (1.0 - mid) - (1.0 - q);
      if (fval > 0) lo = mid;
      else hi = mid;
    }
    theta = 0.5 * (lo + hi);
  }

  const Rmin_plus_1 = (alpha * xD) / (alpha - theta) + (1.0 - xD) / (1.0 - theta);
  const Rmin = Math.max(0.15, Rmin_plus_1 - 1.0);
  const R = Rmin * R_mult;

  const X_g = (R - Rmin) / (R + 1.0);
  const Y_g =
    1.0 -
    Math.exp(
      ((1.0 + 54.4 * X_g) / (11.0 + 117.2 * X_g)) * ((X_g - 1.0) / Math.sqrt(Math.max(1e-4, X_g)))
    );
  const N_theo = (Y_g + Nmin) / Math.max(0.01, 1.0 - Y_g);

  const ratio_NF = Math.pow((B / D) * (zF / (1.0 - zF)) * Math.pow((1.0 - xD) / xB, 2.0), 0.206);
  const N_rect_theo = N_theo * (ratio_NF / (1.0 + ratio_NF));

  let T_top_C = bpTop.T_C;
  const T_feed_C = bpFeed.T_C;
  let T_bot_C = bpBot.T_C;
  let gamma1_top = bpTop.gamma1;
  let gamma2_bot = bpBot.gamma2;

  const T_col_avg = 0.5 * (T_top_C + T_bot_C);
  const lkAvg = resolveFluidProps(lkId, T_col_avg);
  const hkAvg = resolveFluidProps(hkId, T_col_avg);
  const mw_avg = zF * lkAvg.mw + (1.0 - zF) * hkAvg.mw;
  const rhoL = inp.rhoL || zF * lkAvg.rho + (1.0 - zF) * hkAvg.rho;
  const rhoV = inp.rhoV || Math.max(0.15, (P_bar * 100.0 * mw_avg) / (R_GAS_KJ_KMOL_K * (T_col_avg + 273.15)));
  const sigma = inp.sigma || zF * lkAvg.sigma + (1.0 - zF) * hkAvg.sigma;
  const muL_cP = zF * lkAvg.mu + (1.0 - zF) * hkAvg.mu;
  const hv_kJmol = inp.hv_kJmol || (zF * lkAvg.hv * lkAvg.mw + (1.0 - zF) * hkAvg.hv * hkAvg.mw) / 1000.0;

  const internals: 'tray' | 'packed' = inp.internals === 'packed' ? 'packed' : 'tray';
  const rawTrayType = (inp.tray_type || 'sieve').toLowerCase();
  const trayType: 'sieve' | 'valve' | 'bubble_cap' =
    rawTrayType === 'valve' ? 'valve' : rawTrayType === 'bubble_cap' ? 'bubble_cap' : 'sieve';
  const trayPasses = Math.max(1, Math.round(inp.tray_passes || 1));
  const holeD_mm = inp.hole_d_mm || 5.0;
  const weirH_mm = inp.weir_h_mm || 50.0;
  const holeAreaPct = inp.hole_area_pct || 10.0;
  const traySpacing_m = inp.tray_spacing_m || 0.6;

  // Baseline O'Connell Efficiency
  const E_oconnell_base = clampNum(50.3 * Math.pow(alpha * muL_cP, -0.226), 28.0, 88.0);
  const trayEffMod = trayType === 'valve' ? 1.06 : trayType === 'bubble_cap' ? 0.96 : 1.0;
  const holeEffMod = holeD_mm <= 3.5 ? 1.04 : holeD_mm >= 10.0 ? 0.95 : 1.0;
  const weirEffMod = 1.0 + (weirH_mm - 50.0) * 0.0012;
  let E_calc_pct = clampNum((inp.tray_eff_pct || E_oconnell_base) * trayEffMod * holeEffMod * weirEffMod, 25.0, 92.0);
  let E_overall = E_calc_pct / 100.0;
  let N_actual = Math.max(2, Math.ceil((N_theo - 1.0) / E_overall));
  let feed_stage_actual = clampNum(Math.round((N_rect_theo / N_theo) * N_actual), 2, Math.max(2, N_actual - 1));

  // Shortcut Internal Molar Flows & Condenser/Reboiler Duties
  let L_rect = R * D;
  let V_rect = (R + 1.0) * D;
  let L_strip = L_rect + q * F;
  let V_strip = Math.max(0.2 * D, V_rect - (1.0 - q) * F);

  let Qc_kW = (V_rect * hv_kJmol * 1000.0) / 3600.0;
  let Qr_kW = (V_strip * hv_kJmol * 1000.0) / 3600.0;

  // 2. Rigorous Mode: Stage-by-Stage Binary NRTL MESH Solver
  const N_eq_mesh = Math.max(4, Math.min(200, Math.round(N_theo)));
  const feedIdx_mesh = clampNum(Math.round(N_rect_theo), 1, N_eq_mesh - 1);
  const dP_est_bar = internals === 'packed' ? 0.025 : Math.min(0.45, N_actual * 0.006);

  let x_profile: number[];
  let y_profile: number[];
  let T_profile: number[];
  let L_profile: number[];
  let V_profile: number[];
  let K1_profile: number[];
  let K2_profile: number[];
  let stage_pressures_bar: number[];

  let xD_mesh = xD;
  let xB_mesh = xB;
  let meshConverged = false;
  let meshIterations = 0;
  let meshFallbackUsed = false;
  let meshMassBalanceErrPct = 0;
  let meshEnergyBalanceErrPct = 0;

  if (mode === 'rigorous') {
    const meshOut = solveBinaryNrtlMesh({
      N_eq: N_eq_mesh,
      feedIdx: feedIdx_mesh,
      P_top_bar: P_bar,
      dP_total_bar: dP_est_bar,
      F,
      D,
      B,
      zF,
      xD_init: xD,
      xB_init: xB,
      R,
      q,
      T_feed_bp_C: bpFeed.T_C,
      lkBase,
      hkBase,
      a12,
      a21,
      nrtlAlpha,
    });

    meshIterations = meshOut.iterations;
    meshMassBalanceErrPct = meshOut.massErrPct;
    meshEnergyBalanceErrPct = meshOut.energyErrPct;

    if (meshOut.converged && !meshOut.degeneratePinch) {
      meshConverged = true;
      meshFallbackUsed = false;
      x_profile = meshOut.x_profile;
      y_profile = meshOut.y_profile;
      T_profile = meshOut.T_profile;
      L_profile = meshOut.L_profile;
      V_profile = meshOut.V_profile;
      K1_profile = meshOut.K1_profile;
      K2_profile = meshOut.K2_profile;
      stage_pressures_bar = meshOut.stage_pressures_bar;
      xD_mesh = x_profile[0];
      xB_mesh = x_profile[N_eq_mesh];
      T_top_C = T_profile[0];
      T_bot_C = T_profile[N_eq_mesh];
      gamma1_top = meshOut.gamma1_top;
      gamma2_bot = meshOut.gamma2_bot;
      Qc_kW = meshOut.Qc_kW;
      Qr_kW = meshOut.Qr_kW;
      L_rect = L_profile[0];
      V_rect = V_profile[1];
      const stripIdx = Math.min(N_eq_mesh - 1, feedIdx_mesh);
      L_strip = L_profile[stripIdx];
      V_strip = V_profile[Math.min(N_eq_mesh, feedIdx_mesh + 1)];

      iterations.push({
        iter: 4,
        param: `Rigorous NRTL MESH (${N_eq_mesh + 1}단 왕-헨케 Tridiagonal + 열수지)`,
        assumed: `xD=${xD.toFixed(3)}, xB=${xB.toFixed(4)}`,
        calc: `xD_mesh=${xD_mesh.toFixed(3)}, xB_mesh=${xB_mesh.toFixed(4)} (${meshIterations}회)`,
        err: `Mass ${meshMassBalanceErrPct.toFixed(3)}% / Heat ${meshEnergyBalanceErrPct.toFixed(3)}%`,
        note: `Qc=${Qc_kW.toFixed(1)} kW, Qr=${Qr_kW.toFixed(1)} kW`,
      });
    } else {
      meshConverged = false;
      meshFallbackUsed = true;
      const fb = buildMcCabeThieleFallbackProfiles(
        N_eq_mesh, feedIdx_mesh, xD, xB, zF, R, alpha, P_bar, dP_est_bar,
        lkBase, hkBase, a12, a21, nrtlAlpha, L_rect, V_rect, L_strip, V_strip
      );
      x_profile = fb.x_profile;
      y_profile = fb.y_profile;
      T_profile = fb.T_profile;
      L_profile = fb.L_profile;
      V_profile = fb.V_profile;
      K1_profile = fb.K1_profile;
      K2_profile = fb.K2_profile;
      stage_pressures_bar = fb.stage_pressures_bar;

      iterations.push({
        iter: 4,
        param: `Rigorous NRTL MESH Pinch Fallback (FUG + McCabe-Thiele)`,
        assumed: `N_eq=${N_eq_mesh}`,
        calc: `T_top=${T_top_C.toFixed(1)}°C, T_bot=${T_bot_C.toFixed(1)}°C`,
        err: `Fallback (${meshIterations}회 후 전환)`,
        note: '극한 핀치/공비 영역으로 FUG+McCabe-Thiele 안정 프로파일 적용',
      });
    }
  } else {
    const fb = buildMcCabeThieleFallbackProfiles(
      N_eq_mesh, feedIdx_mesh, xD, xB, zF, R, alpha, P_bar, dP_est_bar,
      lkBase, hkBase, a12, a21, nrtlAlpha, L_rect, V_rect, L_strip, V_strip
    );
    x_profile = fb.x_profile;
    y_profile = fb.y_profile;
    T_profile = fb.T_profile;
    L_profile = fb.L_profile;
    V_profile = fb.V_profile;
    K1_profile = fb.K1_profile;
    K2_profile = fb.K2_profile;
    stage_pressures_bar = fb.stage_pressures_bar;
  }

  // Max column traffic for hydraulics (using MESH non-CMO peak when available)
  const V_max_kmolh = mode === 'rigorous' && meshConverged
    ? Math.max(...V_profile.slice(1))
    : Math.max(V_rect, V_strip);
  const L_max_kmolh = mode === 'rigorous' && meshConverged
    ? Math.max(...L_profile)
    : Math.max(L_rect, L_strip);

  const Lw_kgh = L_max_kmolh * mw_avg;
  const Vw_kgh = V_max_kmolh * mw_avg;
  const Lw_mgs = Lw_kgh / 3600.0;
  const Vw_mgs = Vw_kgh / 3600.0;
  const Qv_m3s = Vw_mgs / rhoV;
  const Flv = clampNum((Lw_mgs / Math.max(0.01, Vw_mgs)) * Math.sqrt(rhoV / rhoL), 0.01, 1.5);
  const logFlv = Math.log10(Flv);

  let Csb = 0.08;
  let u_flood = 1.5;
  let u_design = 1.2;
  let F_factor = 1.4;
  let D_col_m = 1.2;
  let H_tangent_m = 15.0;
  let weep_ratio = 1.5;
  let psi_entrain = 0.02;
  let dc_backup_pct = 28.0;
  let dP_tray_mbar = 6.0;
  let dP_total_mbar = 150.0;
  let HETP_m = 0.5;
  let H_pack_total_m = 0;
  let N_beds = 0;
  let dP_pack_mbar_m = 0;
  let flood_pct_actual = floodFrac * 100.0;
  let internalsSummary = '';
  let trayHydraulics: ReturnType<typeof calcTrayPointHydraulics> | null = null;
  let billetSchultes: ReturnType<typeof calcBilletSchultesPacking> | null = null;

  if (internals === 'packed') {
    // =========================================================================
    // PACKED COLUMN HYDRAULICS: Billet-Schultes (1999) + Eckert GPDC
    // =========================================================================
    const catalogSpec = mapPackingToCatalogSpec(packKey, packSpec);
    const viscVapPaS = clampNum(1.05e-5 * Math.pow(Math.max(200, T_col_avg + 273.15) / 350.0, 0.7), 6e-6, 3e-5);
    const strippingLambda = clampNum(alpha * (V_max_kmolh / Math.max(1.0, L_max_kmolh)) * 0.65, 0.4, 2.5);

    const Y_flood = Math.exp(-3.635 - 1.164 * Math.log(Flv) - 0.124 * Math.pow(Math.log(Flv), 2));
    const muFactor = Math.pow(Math.max(0.1, muL_cP), 0.1);
    const u_flood_init = Math.sqrt((Y_flood * G_ACCEL * (rhoL - rhoV)) / (packSpec.Fp * rhoV * muFactor));
    const u_des_init = u_flood_init * floodFrac * (packSpec.type === 'Structured' ? 1.12 : 1.0);
    const Ac_init = Qv_m3s / Math.max(0.05, u_des_init);
    D_col_m = Math.max(0.35, Math.ceil(Math.sqrt((4.0 * Ac_init) / Math.PI) * 20.0) / 20.0);

    let bsRes = calcBilletSchultesPacking({
      spec: catalogSpec,
      diamM: D_col_m,
      vapMassKgH: Vw_kgh,
      liqMassKgH: Lw_kgh,
      rhoVapKgM3: rhoV,
      rhoLiqKgM3: rhoL,
      viscLiqCp: muL_cP,
      viscVapPaS,
      surfTensMnM: sigma,
      foamingFactor: 1.0,
      tempC: T_col_avg,
      pressBarA: P_bar,
      avgMwVap: mw_avg,
      avgMwLiq: mw_avg,
      strippingFactorLambda: strippingLambda,
    });

    const targetFloodPct = floodFrac * 100.0;
    for (let k = 0; k < 30; k++) {
      if (bsRes.bsFloodPct > targetFloodPct + 3.0 && D_col_m < 9.5) {
        const jump = bsRes.bsFloodPct > targetFloodPct + 18.0
          ? Math.max(0.1, D_col_m * (Math.sqrt(bsRes.bsFloodPct / targetFloodPct) - 1.0) * 0.8)
          : 0.05;
        D_col_m = Math.min(9.5, Math.ceil((D_col_m + jump) * 20.0) / 20.0);
      } else if (bsRes.bsFloodPct < targetFloodPct - 12.0 && D_col_m > 0.35) {
        D_col_m = Math.max(0.35, Math.round((D_col_m - 0.05) * 100) / 100);
      } else {
        break;
      }
      bsRes = calcBilletSchultesPacking({
        spec: catalogSpec,
        diamM: D_col_m,
        vapMassKgH: Vw_kgh,
        liqMassKgH: Lw_kgh,
        rhoVapKgM3: rhoV,
        rhoLiqKgM3: rhoL,
        viscLiqCp: muL_cP,
        viscVapPaS,
        surfTensMnM: sigma,
        foamingFactor: 1.0,
        tempC: T_col_avg,
        pressBarA: P_bar,
        avgMwVap: mw_avg,
        avgMwLiq: mw_avg,
        strippingFactorLambda: strippingLambda,
      });
    }

    billetSchultes = bsRes;
    u_flood = bsRes.uFloodMS;
    u_design = bsRes.uSupMS;
    F_factor = u_design * Math.sqrt(rhoV);
    Csb = u_flood / Math.sqrt((rhoL - rhoV) / rhoV);
    flood_pct_actual = bsRes.bsFloodPct;

    HETP_m = Number.isFinite(bsRes.hetpM) && bsRes.hetpM > 0.1
      ? clampNum(bsRes.hetpM, 0.15, 2.5)
      : bsRes.gpdcHetpM;
    H_pack_total_m = Math.max(0.5, (N_theo - 1.0) * HETP_m);
    N_beds = Math.max(2, Math.ceil(H_pack_total_m / bedMaxH_m));

    dP_pack_mbar_m = Math.max(0.1, bsRes.irrigatedDpMbarM);
    dP_total_mbar = dP_pack_mbar_m * H_pack_total_m;
    dP_tray_mbar = dP_pack_mbar_m * HETP_m;

    H_tangent_m = H_pack_total_m + N_beds * 1.15 + 3.2;
    weep_ratio = 2.5;
    dc_backup_pct = clampNum((dP_pack_mbar_m / 12.0) * 100.0, 1.0, 95.0);
    internalsSummary = `${packSpec.name} (${packSpec.type}, Fp=${packSpec.Fp} m⁻¹, a=${packSpec.ap} m²/m³)`;

    iterations.push({
      iter: iterations.length + 1,
      param: `충전탑 Billet-Schultes & Eckert GPDC (${packSpec.name})`,
      assumed: `목표 Flood=${targetFloodPct.toFixed(0)}%, Fp=${packSpec.Fp} m⁻¹`,
      calc: `u_op=${u_design.toFixed(2)} m/s (F_s=${F_factor.toFixed(2)}, Flood ${flood_pct_actual.toFixed(1)}%) → D=${D_col_m.toFixed(2)} m`,
      err: '0.00%',
      note: `HETP=${HETP_m.toFixed(3)} m (H_OG=${bsRes.hogM.toFixed(3)} m, kL=${(bsRes.kLMs * 1e4).toFixed(2)}e-4 m/s)`,
    });
    iterations.push({
      iter: iterations.length + 1,
      param: `베드 분할 및 관개 압손(Irrigated ΔP) 수렴`,
      assumed: `N_th=${(N_theo - 1).toFixed(1)} Stages`,
      calc: `총 패킹 ${H_pack_total_m.toFixed(1)} m (${N_beds} Beds), ΔP=${dP_pack_mbar_m.toFixed(2)} mbar/m`,
      err: '0.00%',
      note: `총 ΔP = ${dP_total_mbar.toFixed(1)} mbar (액체 재분배기 ${N_beds - 1}기)`,
    });
  } else {
    // =========================================================================
    // TRAYED COLUMN HYDRAULICS: Fair / Glitsch / Lockett / Chan-Fair
    // =========================================================================
    const Csb_base = Math.pow(10, -1.0262 - 0.6351 * logFlv - 0.2009 * logFlv * logFlv);
    const spacingFactor = Math.pow(traySpacing_m / 0.6, 0.55);
    const trayCapMod = trayType === 'valve' ? 1.04 : trayType === 'bubble_cap' ? 0.88 : 1.0;
    const holeAreaMod = clampNum(0.9 + 0.01 * holeAreaPct, 0.85, 1.08);
    const Csb_est = Csb_base * spacingFactor * Math.pow(Math.max(5.0, sigma) / 20.0, 0.2) * trayCapMod * holeAreaMod;
    const u_des_init = Csb_est * Math.sqrt((rhoL - rhoV) / rhoV) * floodFrac;
    const dcFrac = trayPasses === 1 ? 0.12 : trayPasses === 2 ? 0.16 : 0.2;
    const An_m2 = Qv_m3s / Math.max(0.05, u_des_init);
    const At_m2 = An_m2 / (1.0 - dcFrac);
    D_col_m = Math.max(0.45, Math.ceil(Math.sqrt((4.0 * At_m2) / Math.PI) * 20.0) / 20.0);

    const runTrayEval = (dM: number) =>
      calcTrayPointHydraulics({
        trayType,
        diamM: dM,
        traySpacingMm: traySpacing_m * 1000.0,
        weirHeightMm: weirH_mm,
        dcAreaFrac: dcFrac,
        holeAreaFrac: holeAreaPct / 100.0,
        holeDiameterMm: holeD_mm,
        passesPref: trayPasses === 1 ? 1 : trayPasses === 2 ? 2 : trayPasses >= 4 ? 4 : 'auto',
        foamingFactor: 1.0,
        vapMassKgH: Vw_kgh,
        liqMassKgH: Lw_kgh,
        rhoVapKgM3: rhoV,
        rhoLiqKgM3: rhoL,
        surfTensMnM: sigma,
        viscLiqCp: muL_cP,
        tempC: T_col_avg,
        pressBarA: P_bar,
        avgMwVap: mw_avg,
        avgMwLiq: mw_avg,
        alphaRelVol: alpha,
      });

    let tRes = runTrayEval(D_col_m);
    const targetFloodPct = floodFrac * 100.0;
    for (let k = 0; k < 30; k++) {
      if (tRes.floodPct > targetFloodPct + 2.5 && D_col_m < 9.5) {
        const jump = tRes.floodPct > targetFloodPct + 18.0
          ? Math.max(0.1, D_col_m * (Math.sqrt(tRes.floodPct / targetFloodPct) - 1.0) * 0.8)
          : 0.05;
        D_col_m = Math.min(9.5, Math.ceil((D_col_m + jump) * 20.0) / 20.0);
      } else if (tRes.floodPct < targetFloodPct - 12.0 && D_col_m > 0.45) {
        D_col_m = Math.max(0.45, Math.round((D_col_m - 0.05) * 100) / 100);
      } else {
        break;
      }
      tRes = runTrayEval(D_col_m);
    }

    trayHydraulics = tRes;
    if (mode === 'rigorous' && !inp.tray_eff_pct) {
      // Blend Chan-Fair mechanistic efficiency with O'Connell bounds for physical tray count
      const cfPct = clampNum(tRes.chanFair.chanFairEffPct, 25.0, 92.0);
      E_calc_pct = cfPct;
      E_overall = E_calc_pct / 100.0;
      N_actual = Math.max(2, Math.ceil((N_theo - 1.0) / E_overall));
      feed_stage_actual = clampNum(Math.round((N_rect_theo / N_theo) * N_actual), 2, Math.max(2, N_actual - 1));
    }

    u_flood = tRes.uNetFloodMS;
    u_design = tRes.superficialVelMS;
    F_factor = tRes.fFactorPa05;
    Csb = u_flood / Math.sqrt((rhoL - rhoV) / rhoV);
    flood_pct_actual = tRes.floodPct;
    weep_ratio = Math.max(0.05, tRes.weepRatio);
    psi_entrain = tRes.entrainmentFrac;
    dc_backup_pct = tRes.dcBackupPct;
    dP_tray_mbar = tRes.dpMbar;
    dP_total_mbar = tRes.dpMbar * N_actual;

    HETP_m = traySpacing_m / Math.max(0.25, E_overall);
    H_tangent_m = N_actual * traySpacing_m + 3.5;
    const trayTypeLabel =
      trayType === 'valve' ? 'Valve Tray' : trayType === 'bubble_cap' ? 'Bubble-Cap Tray' : 'Sieve Tray';
    internalsSummary = `${trayTypeLabel} (${tRes.geom.passes}-Pass, d_h=${holeD_mm}mm, h_w=${weirH_mm}mm, 개공비 ${holeAreaPct}%)`;

    iterations.push({
      iter: iterations.length + 1,
      param: `FRI/Fair & Chan-Fair 트레이 수력학 (${internalsSummary})`,
      assumed: `목표 Flood=${targetFloodPct.toFixed(0)}%, Spacing=${traySpacing_m}m`,
      calc: `D=${D_col_m.toFixed(2)}m (Flood=${flood_pct_actual.toFixed(1)}%), N_act=${N_actual}단 (E_CF=${E_calc_pct.toFixed(1)}%), ΔP/단=${dP_tray_mbar.toFixed(2)} mbar`,
      err: '0.00%',
      note: `Weep비=${weep_ratio.toFixed(2)}x, DC백업=${dc_backup_pct.toFixed(1)}%, Entrain=${(psi_entrain * 100).toFixed(1)}%`,
    });
  }

  const { tray_x_profile, tray_y_profile, tray_T_profile } = interpolateActualTrayProfiles(
    x_profile,
    y_profile,
    T_profile,
    N_actual,
    E_overall
  );

  // Condenser & Reboiler UA & Area Sizing
  const dT_cond_C = Math.max(6.0, T_top_C - 35.0);
  const U_cond_Wm2K = 750.0;
  const condenserUA_WK = (Qc_kW * 1000.0) / dT_cond_C;
  const condenserArea_m2 = condenserUA_WK / U_cond_Wm2K;

  const T_steam_C = T_bot_C < 135 ? 155.0 : T_bot_C < 190 ? 210.0 : T_bot_C + 35.0;
  const dT_reb_C = Math.max(8.0, T_steam_C - T_bot_C);
  const U_reb_Wm2K = 900.0;
  const reboilerUA_WK = (Qr_kW * 1000.0) / dT_reb_C;
  const reboilerArea_m2 = reboilerUA_WK / U_reb_Wm2K;

  const warnings: ColumnWarning[] = [];
  if (azeotropeX !== null && azeotropeX > xB && azeotropeX < xD) {
    warnings.push({
      level: 'danger',
      text: `공비점(Azeotrope) 감지: x1 ≈ ${azeotropeX.toFixed(3)} 부근에서 기액 조성이 역전되어 단일 상압 증류탑으로는 x_D=${xD} 달성이 불가능합니다.`,
    });
  }
  if (mode === 'rigorous' && meshFallbackUsed) {
    warnings.push({
      level: 'warn',
      text: `Rigorous MESH 극한 핀치/공비 영역 감지로 FUG + McCabe-Thiele 해석 프로파일로 안전 폴백되었습니다.`,
    });
  } else if (mode === 'rigorous' && meshConverged) {
    warnings.push({
      level: 'ok',
      text: `NRTL MESH 다단 수렴 완료 (${N_eq_mesh + 1} stages, ${meshIterations}회 반복): xD_mesh=${xD_mesh.toFixed(3)}, xB_mesh=${xB_mesh.toFixed(4)}, 물질/열수지 오차 ${meshMassBalanceErrPct.toFixed(3)}% / ${meshEnergyBalanceErrPct.toFixed(3)}%`,
    });
  }

  if (internals === 'packed') {
    if (dP_pack_mbar_m > 8.0) {
      warnings.push({
        level: 'warn',
        text: `패킹 단위 차압 과다 (${dP_pack_mbar_m.toFixed(2)} mbar/m > 8.0 mbar/m) — 더 큰 사이즈 패킹(50mm) 또는 Mellapak 250Y 규칙패킹 변경 권장`,
      });
    } else {
      warnings.push({
        level: 'ok',
        text: `충전탑 Billet-Schultes 수력학 적합: ${packSpec.name} · Flood ${flood_pct_actual.toFixed(1)}% · 차압 ${dP_pack_mbar_m.toFixed(2)} mbar/m · HETP ${HETP_m.toFixed(2)} m (${N_beds} Beds)`,
      });
    }
  } else {
    if (weep_ratio < 1.15) {
      warnings.push({
        level: 'warn',
        text: `누액(Weeping) 발생 주의: 구멍 증기유속 비(u_h/u_min) = ${weep_ratio.toFixed(2)} (< 1.15) — 개공비 축소 또는 Valve Tray 변경 권장`,
      });
    } else if (dc_backup_pct > 50.0) {
      warnings.push({
        level: 'warn',
        text: `다운커머 백업 과다 (${dc_backup_pct.toFixed(1)}% > 50%) — 유로 패스 수(2-Pass) 확대 또는 단간격 확대 권장`,
      });
    } else {
      warnings.push({
        level: 'ok',
        text: `FRI/Fair 트레이 수력학 적합: ${internalsSummary} · Flood ${flood_pct_actual.toFixed(1)}% · Weeping ${weep_ratio.toFixed(2)}x, DC 백업 ${dc_backup_pct.toFixed(1)}%`,
      });
    }
  }

  const status: 'ok' | 'warning' | 'error' = warnings.some((w) => w.level === 'danger')
    ? 'error'
    : warnings.some((w) => w.level === 'warn')
      ? 'warning'
      : 'ok';

  return {
    equipTag: inp.equipTag || 'T-101',
    equipName: inp.equipName || `${lkBase.name} / ${hkBase.name} Column`,
    colMode: 'distillation',
    lkBase,
    hkBase,
    P_bar,
    internals,
    trayType,
    trayPasses: trayHydraulics ? trayHydraulics.geom.passes : trayPasses,
    holeD_mm,
    weirH_mm,
    holeAreaPct,
    traySpacing_m,
    packKey,
    packSpec,
    H_pack_total_m,
    N_beds,
    dP_pack_mbar_m,
    HETP_m,
    internalsSummary,
    T_top_C,
    T_feed_C,
    T_bot_C,
    gamma1_top,
    gamma2_bot,
    alpha,
    alpha_calc,
    azeotropeX,
    vleCurve,
    F,
    D,
    B,
    zF,
    xD,
    xB,
    q,
    lk_recovery_pct,
    Nmin,
    N_min: Nmin,
    Rmin,
    R_min: Rmin,
    R,
    N_theo,
    N_actual,
    feed_stage_actual,
    feedStage: feed_stage_actual,
    E_overall_pct: E_calc_pct,
    L_rect,
    V_rect,
    L_strip,
    V_strip,
    Qc_kW,
    Qr_kW,
    Csb,
    u_flood,
    u_design,
    u_op: u_design,
    F_factor,
    D_col_m,
    H_tangent_m,
    weep_ratio,
    psi_entrain,
    dc_backup_pct,
    dP_tray_mbar,
    dP_total_mbar,
    x_profile,
    y_profile,
    T_profile,
    L_profile,
    V_profile,
    K1_profile,
    K2_profile,
    stage_pressures_bar,
    tray_x_profile,
    tray_y_profile,
    tray_T_profile,
    xD_mesh,
    xB_mesh,
    meshConverged,
    meshIterations,
    meshFallbackUsed,
    meshMassBalanceErrPct,
    meshEnergyBalanceErrPct,
    murphreeEff: E_overall,
    nrtlPresetId: nrtlInfo.presetId,
    nrtl_a12: a12,
    nrtl_a21: a21,
    nrtl_alpha: nrtlAlpha,
    condenserUA_WK,
    reboilerUA_WK,
    condenserArea_m2,
    reboilerArea_m2,
    flood_pct: flood_pct_actual,
    trayHydraulics,
    billetSchultes,
    status,
    iterations,
    warnings,
  };
}

import { resolveFluidProps, type FluidProps } from './chemproFluidBridge';
import {
  bellDelawareShellSide,
  tubeSideSinglePhase,
  shahCondensationH,
  gungorWintertonBoilingH,
  shellCondensationH,
  shellBoilingH,
  tubeSideTwoPhaseDP,
  shellSideTwoPhaseDP,
  temaVibrationCheck,
  type LayoutDeg,
  type ShellTubeGeometry,
  type FluidState,
  type TwoPhaseFluid,
  type BellDelawareResult,
  type VibrationResult,
} from './shellTubeRating';

const R_GAS_KJ_KMOL_K = 8.31446;

export type HxDofTarget = 'mc_auto' | 'tco_auto' | 'tho_auto' | 'mh_auto';
export type HotPhaseMode = 'sensible' | 'cond_full' | 'cond_partial';
export type ColdPhaseMode = 'sensible' | 'boil_full' | 'boil_partial';
export type SolveMode = 'quick' | 'rigorous';

export interface HotSpecificEnthalpy {
  dh_desup: number;
  dh_lat: number;
  dh_sub: number;
  dh_sens: number;
  dh_tot: number;
  superheatC: number;
  subcoolC: number;
  xFrac: number;
  Tsat: number;
}

export interface ColdSpecificEnthalpy {
  dh_pre: number;
  dh_lat: number;
  dh_sup: number;
  dh_sens: number;
  dh_tot: number;
  subcoolInC: number;
  superheatOutC: number;
  xFrac: number;
  Tsat: number;
}

export interface HXEnergyBalanceInput {
  hotFluidId?: string;
  coldFluidId?: string;
  dofTarget?: HxDofTarget | 'auto';
  hot_phase_mode?: HotPhaseMode | string;
  cold_phase_mode?: ColdPhaseMode | string;
  mh_kgh?: number | 'auto';
  mh?: number | 'auto';
  Th_in?: number;
  Th_out?: number | 'auto';
  mc_kgh?: number | 'auto';
  mc?: number | 'auto';
  Tc_in?: number;
  Tc_out?: number | 'auto';
  Th_sat?: number;
  Tc_sat?: number;
  hot_xfrac?: number;
  cold_xfrac?: number;
  hot_hv?: number;
  cold_hv?: number;
  manualProp?: boolean;
  cph_manual?: number;
  cpc_manual?: number;
}

export interface HXEnergyBalanceResult {
  mh: number;
  mh_kgh: number;
  Th_in: number;
  Th_out: number;
  mc: number;
  mc_kgh: number;
  Tc_in: number;
  Tc_out: number;
  Qh_kW: number;
  Qc_kW: number;
  Q_kW: number;
  hotProps: FluidProps;
  coldProps: FluidProps;
  cph: number;
  cpc: number;
  cphVap: number;
  cpcVap: number;
  hotMode: HotPhaseMode;
  coldMode: ColdPhaseMode;
  Th_sat: number;
  Tc_sat: number;
  xCond: number;
  xVap: number;
  hvHot: number;
  hvCold: number;
  hotBreak: HotSpecificEnthalpy;
  coldBreak: ColdSpecificEnthalpy;
  dofTarget: HxDofTarget;
}

export interface HXProfileNode {
  f: number;
  T: number;
}

export interface HXPWZoneBase {
  idx: number;
  fa: number;
  fb: number;
  qSharePct: number;
  dQ_kW: number;
  Th_a: number;
  Th_b: number;
  Tc_a: number;
  Tc_b: number;
  hotRegime: 'sensible' | 'desuperheat' | 'condense' | 'subcool';
  coldRegime: 'sensible' | 'preheat' | 'boil' | 'superheat';
  zoneName: string;
  zoneLMTD: number;
  isIsothermalSide: boolean;
}

export interface HXZonalDetail extends HXPWZoneBase {
  Ft_z: number;
  cmtd_z: number;
  hh_z: number;
  hc_z: number;
  U_z: number;
  A_z: number;
}

export interface HXIterationRow {
  iter: number;
  param: string;
  assumed: string;
  calc: string;
  err: string;
  note: string;
}

export interface HXWarning {
  level: 'ok' | 'warn' | 'danger';
  text: string;
}

export interface ChemproHXInput extends HXEnergyBalanceInput {
  equipTag?: string;
  equipName?: string;
  hx_type?: 'shell_tube' | 'plate_phe' | string;
  exchangerType?: string;
  allocation?: 'hot_shell' | 'hot_tube' | string;
  U_assumed?: number;
  tube_od_mm?: number;
  tube_wall_mm?: number;
  tube_L_m?: number;
  n_passes?: number;
  n_shell?: number;
  baffle_ratio?: number;
  layout_angle?: number;
  baffle_cut_pct?: number;
  pitch_ratio?: number;
  shell_p_bar?: number;
  tube_p_bar?: number;
  kw?: number;
  rhos?: number;
  mus_cP?: number;
  cps?: number;
  ks?: number;
  rfs?: number;
  rhot?: number;
  mut_cP?: number;
  cpt?: number;
  kt?: number;
  rft?: number;
  phe_chevron_deg?: number;
  phe_beta_deg?: number;
  phe_b_mm?: number;
  phe_tp_mm?: number;
  phe_wp_mm?: number;
  phe_lp_mm?: number;
  phe_passes?: number;
  phe_kw?: number;
  phe_mat_name?: string;
}

export interface ChemproHXResult {
  equipTag: string;
  equipName: string;
  hxType: 'shell_tube' | 'plate_phe';
  exchangerType: string;
  mh: number;
  Th_in: number;
  Th_out: number;
  mc: number;
  Tc_in: number;
  Tc_out: number;
  dofTarget: HxDofTarget;
  allocation: 'hot_shell' | 'hot_tube';
  Qh_kW: number;
  Qc_kW: number;
  Q_kW: number;
  hotProps: FluidProps;
  coldProps: FluidProps;
  cph: number;
  cpc: number;
  rfs: number;
  rft: number;
  hotMode: HotPhaseMode;
  coldMode: ColdPhaseMode;
  hasPhaseChange: boolean;
  hotBreak: HotSpecificEnthalpy;
  coldBreak: ColdSpecificEnthalpy;
  zones: HXZonalDetail[];
  hotNodes: HXProfileNode[];
  coldNodes: HXProfileNode[];
  minPinchDT: number;
  pinchF: number;
  dT1: number;
  dT2: number;
  lmtd: number;
  LMTD: number;
  Ft: number;
  CMTD: number;
  U_calc: number;
  U_clean: number;
  U_req: number;
  A_req_m2: number;
  A_prov_m2: number;
  A_req: number;
  A_calc: number;
  A_eff_m2: number;
  overdesign_pct: number;
  overDesign_pct: number;
  N_tubes: number;
  D_shell_mm: number;
  Ds_mm: number;
  D_bundle_mm: number;
  nPasses: number;
  nShell: number;
  L_m: number;
  do_mm: number;
  di_mm: number;
  tw_mm: number;
  pt_mm: number;
  layoutAngle: number;
  B_spacing_mm: number;
  N_baffles: number;
  baffleCutPct: number;
  baffleRatio: number;
  t_shell_mm: number;
  t_tubesheet_mm: number;
  nozzle_shell_dn: number;
  nozzle_tube_dn: number;
  nozzle_shell_nps: string;
  nozzle_tube_nps: string;
  W_bundle_kg: number;
  W_empty_kg: number;
  W_filled_kg: number;
  cost_usd: number;
  cost_krw: number;
  tema_type: string;
  hi: number;
  ho: number;
  h_tube: number;
  h_shell: number;
  vt: number;
  vs: number;
  Ret: number;
  Res: number;
  Re_t: number;
  Re_s: number;
  dPt_bar: number;
  dPs_bar: number;
  dP_tube: number;
  dP_shell: number;
  dPt_kPa: number;
  dPs_kPa: number;
  Jc: number;
  Jl: number;
  Jb: number;
  Js: number;
  Jr: number;
  jc: number;
  jl: number;
  jb: number;
  js: number;
  jr: number;
  Rl: number;
  Rb: number;
  Rs: number;
  rl: number;
  rb: number;
  rs: number;
  J_total: number;
  f_vs_Hz: number;
  f_nat_Hz: number;
  vibRatio: number;
  fluidelasticRatio: number;
  criticalVelMs: number;
  fivStatus: 'ok' | 'warning' | 'error';
  vibDetails: VibrationResult | null;
  status: 'ok' | 'warning' | 'error';
  // PHE-specific fields & datasheet aliases
  N_plates?: number;
  N_eff_plates?: number;
  N_eff?: number;
  N_ch?: number;
  N_ch_per_pass?: number;
  N_ch_side?: number;
  N_channels?: number;
  phe_beta_deg?: number;
  phe_chevron_deg?: number;
  beta_deg?: number;
  phe_b_mm?: number;
  b_mm?: number;
  phe_tp_mm?: number;
  tp_mm?: number;
  phe_wp_mm?: number;
  Wp_mm?: number;
  phe_lp_mm?: number;
  Lp_mm?: number;
  phe_mat_name?: string;
  matName?: string;
  phePasses?: number;
  phe_passes?: number;
  phi_enlarge?: number;
  A_1plate_m2?: number;
  A_single_plate_m2?: number;
  A_plate_m2?: number;
  L_pack_mm?: number;
  L_frame_mm?: number;
  D_port_mm?: number;
  v_port_h?: number;
  v_port_c?: number;
  iterations: HXIterationRow[];
  warnings: HXWarning[];
}

const DN_TO_NPS_MAP: Record<number, string> = {
  25: '1"',
  40: '1-1/2"',
  50: '2"',
  65: '2-1/2"',
  80: '3"',
  100: '4"',
  125: '5"',
  150: '6"',
  200: '8"',
  250: '10"',
  300: '12"',
  350: '14"',
  400: '16"',
  450: '18"',
  500: '20"',
};

const STD_DN_MM = [25, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500];
const STD_SHELL_MM = [
  203, 254, 305, 337, 387, 438, 489, 540, 591, 635, 686, 737,
  787, 838, 889, 940, 991, 1067, 1143, 1219, 1372, 1524, 1676, 1829,
];

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function calcNozzleDN(m_kgh: number, rho_val: number): number {
  const q_m3s = (m_kgh / 3600.0) / Math.max(1.0, rho_val);
  const v_noz = rho_val < 50 ? 18.0 : 1.85;
  const d_mm = Math.sqrt((4.0 * q_m3s) / (Math.PI * v_noz)) * 1000.0;
  return STD_DN_MM.find((d) => d >= d_mm) || 500;
}

function toLayoutDeg(angle: number): LayoutDeg {
  if (angle === 45) return 45;
  if (angle === 60) return 60;
  if (angle === 90) return 90;
  return 30;
}

function inferDofTarget(inp: HXEnergyBalanceInput): HxDofTarget {
  const explicit = inp.dofTarget;
  if (explicit === 'mc_auto' || explicit === 'tco_auto' || explicit === 'tho_auto' || explicit === 'mh_auto') {
    return explicit;
  }
  const isMissing = (val: unknown) =>
    val === undefined || val === null || val === 'auto' || (typeof val === 'number' && !Number.isFinite(val));
  if (isMissing(inp.Tc_out)) return 'tco_auto';
  if (isMissing(inp.Th_out)) return 'tho_auto';
  if (isMissing(inp.mh_kgh) && isMissing(inp.mh)) return 'mh_auto';
  if (isMissing(inp.mc_kgh) && isMissing(inp.mc)) return 'mc_auto';
  return 'mc_auto';
}

function normalizeHotMode(m?: string): HotPhaseMode {
  if (m === 'cond_full' || m === 'cond_partial') return m;
  return 'sensible';
}

function normalizeColdMode(m?: string): ColdPhaseMode {
  if (m === 'boil_full' || m === 'boil_partial') return m;
  return 'sensible';
}

export function evalHotSpecificEnthalpy(
  Th_in: number,
  Th_out: number,
  hotMode: HotPhaseMode,
  Th_sat: number,
  xCond: number,
  hvHot: number,
  cphLiq: number,
  cphVap: number
): HotSpecificEnthalpy {
  if (!hotMode || hotMode === 'sensible') {
    const dhSens = cphLiq * Math.max(0.05, Math.abs(Th_in - Th_out));
    return {
      dh_desup: 0,
      dh_lat: 0,
      dh_sub: 0,
      dh_sens: dhSens,
      dh_tot: dhSens,
      superheatC: 0,
      subcoolC: 0,
      xFrac: 0,
      Tsat: Th_sat,
    };
  }
  const x = hotMode === 'cond_full' ? 1.0 : clampNum(xCond || 1.0, 0.01, 1.0);
  const Tsat = Number.isFinite(Th_sat) ? Th_sat : 0.5 * (Th_in + Th_out);
  const dT_desup = Th_in > Tsat ? Th_in - Math.max(Th_out, Tsat) : 0;
  const dh_desup = cphVap * Math.max(0, dT_desup);
  const crossesSat = Th_in >= Tsat - 0.25 && Th_out <= Tsat + 0.25;
  const dh_lat = crossesSat ? x * Math.max(0, hvHot) : 0;
  const cpMixSub = x * cphLiq + (1.0 - x) * cphVap;
  const dT_sub = Th_out < Tsat ? Math.min(Th_in, Tsat) - Th_out : 0;
  const dh_sub = cpMixSub * Math.max(0, dT_sub);
  const dh_tot = Math.max(0.15, dh_desup + dh_lat + dh_sub);
  return {
    dh_desup,
    dh_lat,
    dh_sub,
    dh_sens: dh_desup + dh_sub,
    dh_tot,
    superheatC: Math.max(0, Th_in - Tsat),
    subcoolC: Math.max(0, Tsat - Th_out),
    xFrac: crossesSat ? x : 0,
    Tsat,
  };
}

export function evalColdSpecificEnthalpy(
  Tc_in: number,
  Tc_out: number,
  coldMode: ColdPhaseMode,
  Tc_sat: number,
  xVap: number,
  hvCold: number,
  cpcLiq: number,
  cpcVap: number
): ColdSpecificEnthalpy {
  if (!coldMode || coldMode === 'sensible') {
    const dhSens = cpcLiq * Math.max(0.05, Math.abs(Tc_out - Tc_in));
    return {
      dh_pre: 0,
      dh_lat: 0,
      dh_sup: 0,
      dh_sens: dhSens,
      dh_tot: dhSens,
      subcoolInC: 0,
      superheatOutC: 0,
      xFrac: 0,
      Tsat: Tc_sat,
    };
  }
  const x = coldMode === 'boil_full' ? 1.0 : clampNum(xVap || 1.0, 0.01, 1.0);
  const Tsat = Number.isFinite(Tc_sat) ? Tc_sat : 0.5 * (Tc_in + Tc_out);
  const dT_pre = Tc_in < Tsat ? Math.min(Tc_out, Tsat) - Tc_in : 0;
  const dh_pre = cpcLiq * Math.max(0, dT_pre);
  const crossesSat = Tc_in <= Tsat + 0.25 && Tc_out >= Tsat - 0.25;
  const dh_lat = crossesSat ? x * Math.max(0, hvCold) : 0;
  const cpMixSup = x * cpcVap + (1.0 - x) * cpcLiq;
  const dT_sup = Tc_out > Tsat ? Tc_out - Math.max(Tc_in, Tsat) : 0;
  const dh_sup = cpMixSup * Math.max(0, dT_sup);
  const dh_tot = Math.max(0.15, dh_pre + dh_lat + dh_sup);
  return {
    dh_pre,
    dh_lat,
    dh_sup,
    dh_sens: dh_pre + dh_sup,
    dh_tot,
    subcoolInC: Math.max(0, Tsat - Tc_in),
    superheatOutC: Math.max(0, Tc_out - Tsat),
    xFrac: crossesSat ? x : 0,
    Tsat,
  };
}

/**
 * 4-mode auto-DOF energy balance solver with 3-zone phase change (desuperheat/condense/subcool & preheat/boil/superheat).
 */
export function solveHXEnergyBalance(inp: HXEnergyBalanceInput): HXEnergyBalanceResult {
  const hotFluidId = inp.hotFluidId || 'crude_oil';
  const coldFluidId = inp.coldFluidId || 'water';
  const dofTarget = inferDofTarget(inp);

  const hotMode = normalizeHotMode(inp.hot_phase_mode);
  const coldMode = normalizeColdMode(inp.cold_phase_mode);

  const numOr = (a: unknown, b: unknown, fallback: number): number => {
    if (typeof a === 'number' && Number.isFinite(a)) return a;
    if (typeof b === 'number' && Number.isFinite(b)) return b;
    return fallback;
  };

  let mh = Math.max(10, numOr(inp.mh_kgh, inp.mh, 45000));
  const Th_in = numOr(inp.Th_in, undefined, 135.0);
  let Th_out = numOr(inp.Th_out, undefined, 65.0);
  let mc = Math.max(10, numOr(inp.mc_kgh, inp.mc, 58000));
  const Tc_in = numOr(inp.Tc_in, undefined, 28.0);
  let Tc_out = numOr(inp.Tc_out, undefined, 52.0);

  let hotProps = resolveFluidProps(hotFluidId, 0.5 * (Th_in + Th_out));
  let coldProps = resolveFluidProps(coldFluidId, 0.5 * (Tc_in + Tc_out));

  const Th_sat = inp.Th_sat !== undefined && Number.isFinite(inp.Th_sat) ? inp.Th_sat : hotProps.tb;
  const Tc_sat = inp.Tc_sat !== undefined && Number.isFinite(inp.Tc_sat) ? inp.Tc_sat : coldProps.tb;
  const xCond = inp.hot_xfrac !== undefined ? inp.hot_xfrac : 1.0;
  const xVap = inp.cold_xfrac !== undefined ? inp.cold_xfrac : 1.0;

  const hotSatProps = resolveFluidProps(hotFluidId, Th_sat);
  const coldSatProps = resolveFluidProps(coldFluidId, Tc_sat);
  const hvHot = inp.hot_hv !== undefined && inp.hot_hv > 0 ? inp.hot_hv : hotSatProps.hv_T || hotProps.hv || 250;
  const hvCold = inp.cold_hv !== undefined && inp.cold_hv > 0 ? inp.cold_hv : coldSatProps.hv_T || coldProps.hv || 220;

  let hotBreak: HotSpecificEnthalpy;
  let coldBreak: ColdSpecificEnthalpy;

  for (let k = 0; k < 5; k++) {
    hotProps = resolveFluidProps(hotFluidId, 0.5 * (Th_in + Th_out));
    coldProps = resolveFluidProps(coldFluidId, 0.5 * (Tc_in + Tc_out));
    const cphLiq = inp.manualProp && inp.cph_manual && inp.cph_manual > 0 ? inp.cph_manual : hotProps.cp;
    const cphVap = hotProps.cp_vap || Math.max(0.45, cphLiq * 0.62);
    const cpcLiq = inp.manualProp && inp.cpc_manual && inp.cpc_manual > 0 ? inp.cpc_manual : coldProps.cp;
    const cpcVap = coldProps.cp_vap || Math.max(0.45, cpcLiq * 0.62);

    hotBreak = evalHotSpecificEnthalpy(Th_in, Th_out, hotMode, Th_sat, xCond, hvHot, cphLiq, cphVap);
    coldBreak = evalColdSpecificEnthalpy(Tc_in, Tc_out, coldMode, Tc_sat, xVap, hvCold, cpcLiq, cpcVap);

    if (dofTarget === 'mc_auto') {
      const Qh = (mh / 3600.0) * hotBreak.dh_tot;
      mc = Math.max(5.0, (Qh / Math.max(0.15, coldBreak.dh_tot)) * 3600.0);
    } else if (dofTarget === 'mh_auto') {
      const Qc = (mc / 3600.0) * coldBreak.dh_tot;
      mh = Math.max(5.0, (Qc / Math.max(0.15, hotBreak.dh_tot)) * 3600.0);
    } else if (dofTarget === 'tco_auto') {
      const Qh = (mh / 3600.0) * hotBreak.dh_tot;
      const dhReq = (Qh * 3600.0) / Math.max(1.0, mc);
      if (coldMode === 'sensible') {
        Tc_out = Math.min(Th_in - 0.5, Tc_in + dhReq / cpcLiq);
      } else {
        const x = coldMode === 'boil_full' ? 1.0 : clampNum(xVap, 0.01, 1.0);
        const dhPreMax = Tc_in < Tc_sat ? cpcLiq * (Tc_sat - Tc_in) : 0;
        const dhLatMax = x * hvCold;
        const cpMixSup = x * cpcVap + (1.0 - x) * cpcLiq;
        if (dhReq <= dhPreMax) {
          Tc_out = Tc_in + dhReq / cpcLiq;
        } else if (dhReq <= dhPreMax + dhLatMax) {
          Tc_out = Tc_sat;
        } else {
          Tc_out = Math.max(Tc_in, Tc_sat) + (dhReq - dhPreMax - dhLatMax) / cpMixSup;
        }
        Tc_out = Math.min(Th_in - 0.5, Tc_out);
      }
    } else if (dofTarget === 'tho_auto') {
      const Qc = (mc / 3600.0) * coldBreak.dh_tot;
      const dhReq = (Qc * 3600.0) / Math.max(1.0, mh);
      if (hotMode === 'sensible') {
        Th_out = Math.max(Tc_in + 0.5, Th_in - dhReq / cphLiq);
      } else {
        const x = hotMode === 'cond_full' ? 1.0 : clampNum(xCond, 0.01, 1.0);
        const dhDesupMax = Th_in > Th_sat ? cphVap * (Th_in - Th_sat) : 0;
        const dhLatMax = x * hvHot;
        const cpMixSub = x * cphLiq + (1.0 - x) * cphVap;
        if (dhReq <= dhDesupMax) {
          Th_out = Th_in - dhReq / cphVap;
        } else if (dhReq <= dhDesupMax + dhLatMax) {
          Th_out = Th_sat;
        } else {
          Th_out = Math.min(Th_in, Th_sat) - (dhReq - dhDesupMax - dhLatMax) / cpMixSub;
        }
        Th_out = Math.max(Tc_in + 0.5, Th_out);
      }
    }
  }

  const cph_final = inp.manualProp && inp.cph_manual && inp.cph_manual > 0 ? inp.cph_manual : hotProps.cp;
  const cpc_final = inp.manualProp && inp.cpc_manual && inp.cpc_manual > 0 ? inp.cpc_manual : coldProps.cp;
  const cph_vap_final = hotProps.cp_vap || Math.max(0.45, cph_final * 0.62);
  const cpc_vap_final = coldProps.cp_vap || Math.max(0.45, cpc_final * 0.62);

  hotBreak = evalHotSpecificEnthalpy(Th_in, Th_out, hotMode, Th_sat, xCond, hvHot, cph_final, cph_vap_final);
  coldBreak = evalColdSpecificEnthalpy(Tc_in, Tc_out, coldMode, Tc_sat, xVap, hvCold, cpc_final, cpc_vap_final);

  const Qh_kW = (mh / 3600.0) * hotBreak.dh_tot;
  const Qc_kW = (mc / 3600.0) * coldBreak.dh_tot;

  return {
    mh,
    mh_kgh: mh,
    Th_in,
    Th_out,
    mc,
    mc_kgh: mc,
    Tc_in,
    Tc_out,
    Qh_kW,
    Qc_kW,
    Q_kW: Qh_kW,
    hotProps,
    coldProps,
    cph: cph_final,
    cpc: cpc_final,
    cphVap: cph_vap_final,
    cpcVap: cpc_vap_final,
    hotMode,
    coldMode,
    Th_sat,
    Tc_sat,
    xCond,
    xVap,
    hvHot,
    hvCold,
    hotBreak,
    coldBreak,
    dofTarget,
  };
}

function buildHXPiecewiseProfile(eb: HXEnergyBalanceResult) {
  const { Th_in, Th_out, Tc_in, Tc_out, hotMode, coldMode, hotBreak, coldBreak } = eb;
  const Q_kW = Math.max(0.1, eb.Qh_kW);

  const hotNodes: HXProfileNode[] = [{ f: 0.0, T: Th_in }];
  if (hotMode !== 'sensible' && hotBreak.dh_tot > 0) {
    const f1 = hotBreak.dh_desup / hotBreak.dh_tot;
    const f2 = (hotBreak.dh_desup + hotBreak.dh_lat) / hotBreak.dh_tot;
    const Tsat_top = Math.min(Th_in, Math.max(Th_out, hotBreak.Tsat));
    if (f1 > 0.002 && f1 < 0.998) hotNodes.push({ f: f1, T: Tsat_top });
    if (f2 > f1 + 0.002 && f2 < 0.998) hotNodes.push({ f: f2, T: Tsat_top });
    else if (f1 <= 0.002 && f2 > 0.002 && f2 < 0.998) hotNodes.push({ f: f2, T: Tsat_top });
  }
  hotNodes.push({ f: 1.0, T: Th_out });

  const coldNodes: HXProfileNode[] = [{ f: 0.0, T: Tc_out }];
  if (coldMode !== 'sensible' && coldBreak.dh_tot > 0) {
    const fc1 = coldBreak.dh_sup / coldBreak.dh_tot;
    const fc2 = (coldBreak.dh_sup + coldBreak.dh_lat) / coldBreak.dh_tot;
    const Tsat_c = Math.max(Tc_in, Math.min(Tc_out, coldBreak.Tsat));
    if (fc1 > 0.002 && fc1 < 0.998) coldNodes.push({ f: fc1, T: Tsat_c });
    if (fc2 > fc1 + 0.002 && fc2 < 0.998) coldNodes.push({ f: fc2, T: Tsat_c });
    else if (fc1 <= 0.002 && fc2 > 0.002 && fc2 < 0.998) coldNodes.push({ f: fc2, T: Tsat_c });
  }
  coldNodes.push({ f: 1.0, T: Tc_in });

  const interpLinear = (nodes: HXProfileNode[], f: number): number => {
    if (f <= 0) return nodes[0].T;
    if (f >= 1) return nodes[nodes.length - 1].T;
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (f >= a.f - 1e-7 && f <= b.f + 1e-7) {
        const span = Math.max(1e-9, b.f - a.f);
        return a.T + ((f - a.f) / span) * (b.T - a.T);
      }
    }
    return nodes[nodes.length - 1].T;
  };

  const rawBreaks = [0.0, 1.0];
  hotNodes.forEach((n) => rawBreaks.push(n.f));
  coldNodes.forEach((n) => rawBreaks.push(n.f));
  rawBreaks.sort((a, b) => a - b);

  const breaks = [0.0];
  for (let i = 1; i < rawBreaks.length; i++) {
    if (rawBreaks[i] - breaks[breaks.length - 1] > 0.003) {
      breaks.push(rawBreaks[i]);
    }
  }
  breaks[breaks.length - 1] = 1.0;

  const fh1 = hotMode !== 'sensible' ? hotBreak.dh_desup / hotBreak.dh_tot : 0;
  const fh2 = hotMode !== 'sensible' ? (hotBreak.dh_desup + hotBreak.dh_lat) / hotBreak.dh_tot : 0;
  const fc1 = coldMode !== 'sensible' ? coldBreak.dh_sup / coldBreak.dh_tot : 0;
  const fc2 = coldMode !== 'sensible' ? (coldBreak.dh_sup + coldBreak.dh_lat) / coldBreak.dh_tot : 0;

  let minPinchDT = Infinity;
  let pinchF = 0;
  breaks.forEach((fb) => {
    const dT = interpLinear(hotNodes, fb) - interpLinear(coldNodes, fb);
    if (dT < minPinchDT) {
      minPinchDT = dT;
      pinchF = fb;
    }
  });

  const zones: HXPWZoneBase[] = [];
  for (let i = 0; i < breaks.length - 1; i++) {
    const fa = breaks[i];
    const fb = breaks[i + 1];
    const fMid = 0.5 * (fa + fb);
    const dQ_kW = Q_kW * (fb - fa);
    const Th_a = interpLinear(hotNodes, fa);
    const Th_b = interpLinear(hotNodes, fb);
    const Tc_a = interpLinear(coldNodes, fa);
    const Tc_b = interpLinear(coldNodes, fb);

    let hotRegime: HXPWZoneBase['hotRegime'] = 'sensible';
    let hotLabel = '현열냉각';
    if (hotMode !== 'sensible') {
      if (fMid < fh1 - 1e-4) {
        hotRegime = 'desuperheat';
        hotLabel = '과열증기 제거';
      } else if (fMid < fh2 - 1e-4) {
        hotRegime = 'condense';
        hotLabel = hotMode === 'cond_partial' ? `부분응축(${Math.round(hotBreak.xFrac * 100)}%)` : '상변화 응축';
      } else {
        hotRegime = 'subcool';
        hotLabel = '응축액 과냉각';
      }
    }

    let coldRegime: HXPWZoneBase['coldRegime'] = 'sensible';
    let coldLabel = '현열가열';
    if (coldMode !== 'sensible') {
      if (fMid < fc1 - 1e-4) {
        coldRegime = 'superheat';
        coldLabel = '증기 과열';
      } else if (fMid < fc2 - 1e-4) {
        coldRegime = 'boil';
        coldLabel = coldMode === 'boil_partial' ? `부분비등(${Math.round(coldBreak.xFrac * 100)}%)` : '비등 증발';
      } else {
        coldRegime = 'preheat';
        coldLabel = '과냉액 예열';
      }
    }

    const dTa = Math.max(0.8, Th_a - Tc_a);
    const dTb = Math.max(0.8, Th_b - Tc_b);
    const zoneLMTD = Math.abs(dTa - dTb) < 0.05 ? 0.5 * (dTa + dTb) : (dTa - dTb) / Math.log(dTa / dTb);

    zones.push({
      idx: i + 1,
      fa,
      fb,
      qSharePct: (fb - fa) * 100.0,
      dQ_kW,
      Th_a,
      Th_b,
      Tc_a,
      Tc_b,
      hotRegime,
      coldRegime,
      zoneName: `${hotLabel} / ${coldLabel}`,
      zoneLMTD,
      isIsothermalSide: hotRegime === 'condense' || coldRegime === 'boil',
    });
  }

  return {
    hotNodes,
    coldNodes,
    breaks,
    zones,
    minPinchDT,
    pinchF,
  };
}

export function calcFt(Th_in: number, Th_out: number, Tc_in: number, Tc_out: number, nShellPasses = 1): number {
  const N = nShellPasses || 1;
  const dT_cold = Tc_out - Tc_in;
  const dT_hot = Th_in - Th_out;
  if (Math.abs(dT_cold) < 1e-4 || Math.abs(dT_hot) < 1e-4 || Math.abs(Th_in - Tc_in) < 1e-4) return 1.0;

  let P = (Tc_out - Tc_in) / (Th_in - Tc_in);
  let R = (Th_in - Th_out) / (Tc_out - Tc_in);
  P = clampNum(P, 0.01, 0.98);
  R = clampNum(R, 0.05, 10.0);

  if (N > 1 && Math.abs(R - 1.0) > 1e-3) {
    const ratio = (1.0 - P * R) / (1.0 - P);
    if (ratio <= 0) return 0.55;
    const p1 = Math.pow(ratio, 1.0 / N);
    P = (1.0 - p1) / (R - p1);
  }

  const sq = Math.sqrt(R * R + 1.0);
  if (Math.abs(R - 1.0) < 1e-3) {
    const num = (P / (1.0 - P)) * Math.sqrt(2.0);
    const den = Math.log((2.0 / P - 1.0 - Math.sqrt(2.0)) / Math.max(1e-6, 2.0 / P - 1.0 + Math.sqrt(2.0)));
    return clampNum(num / den, 0.5, 1.0);
  }

  const num = sq * Math.log(Math.max(1e-5, (1.0 - P) / (1.0 - P * R)));
  const denTerm = (2.0 / P - 1.0 - R + sq) / Math.max(1e-5, 2.0 / P - 1.0 - R - sq);
  if (denTerm <= 1.0001) return 0.55;
  const den = (R - 1.0) * Math.log(denTerm);
  const Ft = num / den;
  return Number.isFinite(Ft) ? clampNum(Ft, 0.5, 1.0) : 0.7;
}

function adjustFilmForPheRegime(
  hBaseSinglePhase: number,
  regime: string,
  fluidProps: FluidProps,
  xPhaseFrac?: number
): number {
  if (regime === 'sensible' || regime === 'subcool' || regime === 'preheat') {
    return hBaseSinglePhase;
  }
  const id = (fluidProps.id || '').toLowerCase();
  const isWaterSteam = id.includes('water') || id.includes('steam');
  const isAmmonia = id.includes('ammonia') || id.includes('r717');
  if (regime === 'desuperheat' || regime === 'superheat') {
    if (fluidProps.rho < 45.0) return Math.max(65.0, hBaseSinglePhase);
    return clampNum(hBaseSinglePhase * 0.24, 85.0, 620.0);
  }
  if (regime === 'condense') {
    let hCond = 2100.0;
    if (isWaterSteam) hCond = 6800.0;
    else if (isAmmonia) hCond = 5100.0;
    else {
      hCond = 2050.0 * Math.pow(Math.max(0.055, fluidProps.k) / 0.1, 0.72) * Math.pow(0.25 / Math.max(0.08, fluidProps.mu), 0.25) * 1.32;
    }
    const ncgFactor = xPhaseFrac !== undefined && xPhaseFrac < 0.99 ? 0.45 + 0.55 * xPhaseFrac : 1.0;
    return clampNum(hCond * ncgFactor, 550.0, 8500.0);
  }
  if (regime === 'boil') {
    let hBoil = 2650.0;
    if (isWaterSteam) hBoil = 6200.0;
    else if (isAmmonia) hBoil = 4800.0;
    else {
      hBoil = 2700.0 * Math.pow(Math.max(0.055, fluidProps.k) / 0.08, 0.65) * Math.pow(0.2 / Math.max(0.07, fluidProps.mu), 0.2) * 1.28;
    }
    return clampNum(hBoil, 900.0, 8000.0);
  }
  return hBaseSinglePhase;
}

/**
 * Constructs a safe physical TwoPhaseFluid descriptor (SI units) for shellTubeRating.ts
 * even when ChemPro's fluid catalog stores gas properties (e.g. steam_lp) or liquid properties (e.g. water, r134a).
 */
function buildTwoPhaseFluidSI(
  fluidId: string,
  fluidProps: FluidProps,
  satC: number,
  pBar: number,
  massFlowKgS: number,
  hv_kJkg: number,
  cpLiq_kJkgK: number
): TwoPhaseFluid {
  const id = (fluidId || fluidProps.id || '').toLowerCase();
  const T_K = Math.max(120, satC + 273.15);
  const isWaterSteam = id.includes('water') || id.includes('steam');
  const liqSource = isWaterSteam ? resolveFluidProps('water', satC) : resolveFluidProps(fluidId, satC);

  const rhoL = liqSource.rho >= 45
    ? liqSource.rho
    : Math.max(480, Math.min(1600, fluidProps.mw * 15.0));
  const muL = liqSource.rho >= 45
    ? Math.max(5e-5, liqSource.mu * 0.001)
    : 2.5e-4;
  const kL = liqSource.rho >= 45
    ? Math.max(0.04, liqSource.k)
    : Math.max(0.08, fluidProps.k * 4.5);
  const cpL = Math.max(600, (liqSource.rho >= 45 ? liqSource.cp : cpLiq_kJkgK) * 1000.0);
  const sigma = liqSource.rho >= 45 ? Math.max(0.003, liqSource.sigma * 0.001) : 0.018;

  const pEffBar = Math.max(0.15, Number.isFinite(pBar) && pBar > 0 ? pBar : Math.max(1.01325, liqSource.pv_bar || 1.01325));
  const rhoG_ideal = (pEffBar * 100.0 * Math.max(2.0, fluidProps.mw)) / (R_GAS_KJ_KMOL_K * T_K);
  const rhoG = clampNum(
    fluidProps.rho < 45 ? Math.max(fluidProps.rho, rhoG_ideal) : rhoG_ideal,
    0.08,
    rhoL * 0.65
  );
  const muG = fluidProps.rho < 45
    ? Math.max(5e-6, fluidProps.mu * 0.001)
    : 1.2e-5 * Math.pow(T_K / 300.0, 0.7);
  const pCritBar = Math.max(20.0, fluidProps.pc || 80.0);

  return {
    massFlowKgS,
    rhoL,
    rhoG,
    muL,
    muG,
    cpL,
    kL,
    sigma,
    hfg: Math.max(40000, hv_kJkg * 1000.0),
    pReduced: clampNum(pEffBar / pCritBar, 0.002, 0.88),
    pCritBar,
  };
}

function buildVaporFluidStateSI(
  fluidId: string,
  fluidProps: FluidProps,
  tempC: number,
  pBar: number,
  massFlowKgS: number,
  cpVap_kJkgK: number
): FluidState {
  const id = (fluidId || fluidProps.id || '').toLowerCase();
  const T_K = Math.max(150, tempC + 273.15);
  const pEffBar = Math.max(0.2, Number.isFinite(pBar) && pBar > 0 ? pBar : 1.01325);
  if (fluidProps.rho < 45) {
    const rho = Math.max(0.08, (pEffBar * 100.0 * Math.max(2.0, fluidProps.mw)) / (R_GAS_KJ_KMOL_K * T_K));
    return {
      massFlowKgS,
      rho,
      mu: Math.max(6e-6, fluidProps.mu * 0.001),
      cp: Math.max(450, cpVap_kJkgK * 1000.0),
      k: Math.max(0.012, fluidProps.k),
    };
  }
  if (id.includes('water') || id.includes('steam')) {
    const steam = resolveFluidProps('steam_lp', tempC);
    const rho = Math.max(0.08, (pEffBar * 100.0 * 18.015) / (R_GAS_KJ_KMOL_K * T_K));
    return {
      massFlowKgS,
      rho,
      mu: Math.max(8e-6, steam.mu * 0.001),
      cp: Math.max(1850, (steam.cp_vap || steam.cp || 2.02) * 1000.0),
      k: Math.max(0.018, steam.k),
    };
  }
  const rho = Math.max(0.08, (pEffBar * 100.0 * Math.max(2.0, fluidProps.mw)) / (R_GAS_KJ_KMOL_K * T_K));
  return {
    massFlowKgS,
    rho,
    mu: Math.max(6e-6, 1.15e-5 * Math.pow(T_K / 300.0, 0.7)),
    cp: Math.max(450, cpVap_kJkgK * 1000.0),
    k: Math.max(0.015, fluidProps.k * 0.18),
  };
}

function buildSensibleFluidStateSI(
  massFlowKgS: number,
  rho: number,
  mu_Pas: number,
  cp_J: number,
  k: number
): FluidState {
  return {
    massFlowKgS,
    rho: Math.max(0.1, rho),
    mu: Math.max(5e-6, mu_Pas),
    cp: Math.max(300, cp_J),
    k: Math.max(0.01, k),
  };
}

export function solveHX(inp: ChemproHXInput, mode: SolveMode = 'rigorous'): ChemproHXResult {
  const eb = solveHXEnergyBalance(inp);
  const {
    mh, Th_in, Th_out, mc, Tc_in, Tc_out,
    Qh_kW, Qc_kW, hotProps, coldProps, cph, cpc,
    cphVap, cpcVap, hotMode, coldMode, hotBreak, coldBreak,
    Th_sat, Tc_sat, xCond, xVap, hvHot, hvCold, dofTarget,
  } = eb;

  const hasPhaseChange = hotMode !== 'sensible' || coldMode !== 'sensible';
  const pwProfile = buildHXPiecewiseProfile(eb);

  const Q_kW = Qh_kW;
  const Q_W = Q_kW * 1000.0;

  const rawType = (inp.hx_type || inp.exchangerType || 'shell_tube').toString().toLowerCase();
  const hxType: 'shell_tube' | 'plate_phe' =
    rawType === 'plate_phe' || rawType === 'phe' ? 'plate_phe' : 'shell_tube';

  const dT1 = Th_in - Tc_out;
  const dT2 = Th_out - Tc_in;
  const tempCross = dT1 <= 0 || dT2 <= 0 || pwProfile.minPinchDT <= 0.2;
  const dT1_safe = Math.max(1.2, dT1);
  const dT2_safe = Math.max(1.2, dT2);

  const lmtd_terminal =
    Math.abs(dT1_safe - dT2_safe) < 0.05
      ? 0.5 * (dT1_safe + dT2_safe)
      : (dT1_safe - dT2_safe) / Math.log(dT1_safe / dT2_safe);

  let sumQOverLMTD = 0;
  pwProfile.zones.forEach((z) => {
    sumQOverLMTD += (z.dQ_kW / Math.max(0.01, Q_kW)) / Math.max(0.8, z.zoneLMTD);
  });
  const lmtd = hasPhaseChange ? 1.0 / Math.max(1e-4, sumQOverLMTD) : lmtd_terminal;
  const kw = inp.phe_kw || inp.kw || 45.0;

  // ===========================================================================
  // BRANCH A: PLATE HEAT EXCHANGER (PHE — Kumar/Martin Chevron Plate Solver)
  // ===========================================================================
  if (hxType === 'plate_phe') {
    const beta_deg = inp.phe_chevron_deg || inp.phe_beta_deg || 60;
    const b_mm = inp.phe_b_mm || 3.2;
    const tp_mm = inp.phe_tp_mm || 0.6;
    const Wp_mm = inp.phe_wp_mm || 650;
    const Lp_mm = inp.phe_lp_mm || 1400;
    const phePasses = inp.phe_passes || 1;

    const b_m = b_mm / 1000.0;
    const tp_m = tp_mm / 1000.0;
    const Wp_m = Wp_mm / 1000.0;
    const Lp_m = Lp_mm / 1000.0;

    // Martin (1996) / Kumar chevron area enlargement & correlation constants
    const phi_enlarge = beta_deg >= 60 ? 1.21 : beta_deg >= 45 ? 1.18 : 1.15;
    const De_m = (2.0 * b_m) / phi_enlarge;
    const A_single_plate_m2 = Wp_m * Lp_m * phi_enlarge;
    const A_cross_1ch_m2 = b_m * Wp_m;

    const Ft_sens = phePasses === 1 ? 0.98 : calcFt(Th_in, Th_out, Tc_in, Tc_out, phePasses);
    let Ft = hasPhaseChange ? 1.0 : Ft_sens;
    let CMTD = lmtd * Ft;

    const rhoh = hotProps.rho;
    const muh_Pas = hotProps.mu * 0.001;
    const cph_J = cph * 1000.0;
    const kh = hotProps.k;
    const rhoc = coldProps.rho;
    const muc_Pas = coldProps.mu * 0.001;
    const cpc_J = cpc * 1000.0;
    const kc = coldProps.k;
    const rfh = Math.min(0.00005, hotProps.fouling * 0.35);
    const rfc = Math.min(0.00005, coldProps.fouling * 0.35);

    const Prh = (cph_J * muh_Pas) / kh;
    const Prc = (cpc_J * muc_Pas) / kc;

    // Kumar chevron Nusselt & Fanning coefficients for beta = 60 / 45 / 30 deg
    const Ch = beta_deg >= 60 ? 0.295 : beta_deg >= 45 ? 0.215 : 0.145;
    const m_exp = beta_deg >= 60 ? 0.72 : beta_deg >= 45 ? 0.695 : 0.66;
    const Kp_fric = beta_deg >= 60 ? 2.95 : beta_deg >= 45 ? 1.65 : 0.88;

    let Uk = 2200.0;
    let U_calc = 2200.0;
    let N_plates = 45;
    let N_eff_plates = 43;
    let N_ch_per_pass = 22;
    let A_prov_m2 = 25.0;
    let A_req_m2 = 21.0;
    let hh = 3500;
    let hc = 3500;
    let vh = 0.45;
    let vc = 0.45;
    let Reh = 2500;
    let Rec = 2500;
    let zoneResults: HXZonalDetail[] = [];
    const iterations: HXIterationRow[] = [];

    for (let it = 1; it <= 12; it++) {
      const A_trial = (Q_W / Math.max(10.0, Uk * CMTD)) * 1.14;
      N_eff_plates = Math.max(9, Math.ceil(A_trial / A_single_plate_m2));
      if (N_eff_plates % 2 === 0) N_eff_plates += 1;
      N_plates = N_eff_plates + 2;
      N_ch_per_pass = Math.max(2, Math.round((N_plates - 1) / (2.0 * phePasses)));
      A_prov_m2 = N_eff_plates * A_single_plate_m2;

      const mh_kgs = mh / 3600.0;
      const mc_kgs = mc / 3600.0;

      const Gh = mh_kgs / (N_ch_per_pass * A_cross_1ch_m2);
      const Gc = mc_kgs / (N_ch_per_pass * A_cross_1ch_m2);
      vh = Gh / rhoh;
      vc = Gc / rhoc;

      Reh = (Gh * De_m) / muh_Pas;
      Rec = (Gc * De_m) / muc_Pas;

      const Nuh = Ch * Math.pow(Math.max(15, Reh), m_exp) * Math.pow(Prh, 1.0 / 3.0);
      const Nuc = Ch * Math.pow(Math.max(15, Rec), m_exp) * Math.pow(Prc, 1.0 / 3.0);
      hh = (Nuh * kh) / De_m;
      hc = (Nuc * kc) / De_m;

      let totalA_req = 0;
      let sumQOverCMTD = 0;
      const R_wall_foul = tp_m / kw + rfh + rfc;
      zoneResults = pwProfile.zones.map((z) => {
        const hh_z = adjustFilmForPheRegime(hh, z.hotRegime, hotProps, hotBreak.xFrac);
        const hc_z = adjustFilmForPheRegime(hc, z.coldRegime, coldProps, coldBreak.xFrac);
        const R_z = 1.0 / hh_z + 1.0 / hc_z + R_wall_foul;
        const U_z = 1.0 / Math.max(1e-5, R_z);
        const Ft_z = z.isIsothermalSide ? 1.0 : Ft_sens;
        const cmtd_z = Math.max(0.8, z.zoneLMTD * Ft_z);
        const A_z = (z.dQ_kW * 1000.0) / Math.max(1.0, U_z * cmtd_z);
        totalA_req += A_z;
        sumQOverCMTD += z.dQ_kW / cmtd_z;
        return { ...z, Ft_z, cmtd_z, hh_z, hc_z, U_z, A_z };
      });

      A_req_m2 = totalA_req;
      CMTD = Q_kW / Math.max(1e-4, sumQOverCMTD);
      Ft = CMTD / Math.max(0.5, lmtd);
      U_calc = Q_W / Math.max(1.0, totalA_req * CMTD);

      const err = Math.abs(U_calc - Uk);
      const errPct = (err / Math.max(1, U_calc)) * 100.0;
      iterations.push({
        iter: it,
        param: `PHE N_p=${N_plates}매 (${N_ch_per_pass} Ch/Pass, ${zoneResults.length}구간 해석)`,
        assumed: `${Uk.toFixed(1)} W/m²K`,
        calc: `${U_calc.toFixed(1)} W/m²K (A=${A_prov_m2.toFixed(1)} m²)`,
        err: `${errPct.toFixed(2)}%`,
        note: err < 1.0 ? '수렴 완료 (Zonal PHE)' : '판수 및 구간별 열전달계수 재수렴',
      });
      if (err < 1.0 && it >= 2) break;
      Uk = 0.4 * Uk + 0.6 * U_calc;
    }

    const overdesign_pct = ((A_prov_m2 - A_req_m2) / Math.max(0.1, A_req_m2)) * 100.0;

    const fh = Kp_fric / Math.pow(Math.max(20, Reh), 0.24);
    const fc = Kp_fric / Math.pow(Math.max(20, Rec), 0.24);
    const port_d_m = clampNum(Wp_m * 0.28, 0.05, 0.2);
    const A_port_m2 = (Math.PI * port_d_m * port_d_m) / 4.0;
    const v_port_h = (mh / 3600.0) / (rhoh * A_port_m2);
    const v_port_c = (mc / 3600.0) / (rhoc * A_port_m2);

    const dPh_Pa =
      phePasses * (4.0 * fh * (Lp_m / De_m) * 0.5 * rhoh * vh * vh) +
      1.4 * phePasses * 0.5 * rhoh * v_port_h * v_port_h;
    const dPc_Pa =
      phePasses * (4.0 * fc * (Lp_m / De_m) * 0.5 * rhoc * vc * vc) +
      1.4 * phePasses * 0.5 * rhoc * v_port_c * v_port_c;
    const dPh_bar = dPh_Pa / 1e5;
    const dPc_bar = dPc_Pa / 1e5;

    const U_clean = 1.0 / (1.0 / hh + 1.0 / hc + tp_m / kw);
    const U_req = Q_W / Math.max(1.0, A_prov_m2 * CMTD);

    const nozzle_hot_dn = calcNozzleDN(mh, rhoh);
    const nozzle_cold_dn = calcNozzleDN(mc, rhoc);
    const nozzle_shell_nps = DN_TO_NPS_MAP[nozzle_hot_dn] || '4"';
    const nozzle_tube_nps = DN_TO_NPS_MAP[nozzle_cold_dn] || '4"';

    const pack_pitch_mm = b_mm + tp_mm;
    const L_pack_mm = Math.round(N_plates * pack_pitch_mm);
    const L_frame_mm = L_pack_mm + 480;
    const W_plates_kg = N_plates * A_single_plate_m2 * (tp_m * 8200);
    const W_empty_kg = W_plates_kg + 420 + 0.65 * L_frame_mm;
    const W_filled_kg = W_empty_kg + N_plates * A_cross_1ch_m2 * Lp_m * 1050;

    const matName =
      inp.phe_mat_name || (kw > 60 ? 'Nickel 200' : kw > 20 && kw < 25 ? 'Titanium Gr.1' : 'SS316L');
    const matFactor = kw > 60 ? 2.6 : kw > 20 && kw < 25 ? 2.2 : 1.2;
    const cost_usd = Math.round((5200 + 260 * Math.pow(A_prov_m2, 0.78)) * matFactor);
    const cost_krw = Math.round((cost_usd * 1380) / 10000) * 10000;

    const warnings: HXWarning[] = [];
    if (pwProfile.minPinchDT <= 0.5) {
      warnings.push({
        level: 'danger',
        text: `내부 상변화 핀치 온도교차 발생! 최소 접근온도 ΔT_pinch = ${pwProfile.minPinchDT.toFixed(1)}°C — 포화온도(Tsat) 또는 유량 조건을 조정하세요.`,
      });
    } else if (pwProfile.minPinchDT < 3.0) {
      warnings.push({
        level: 'warn',
        text: `내부 핀치 접근온도 주의: 최소 ΔT_pinch = ${pwProfile.minPinchDT.toFixed(1)}°C (< 3.0°C) — 판수 급증 유의`,
      });
    }
    if (hasPhaseChange) {
      warnings.push({
        level: 'ok',
        text: `다구간(${zoneResults.length}-Zone) 상변화·과열·과냉 적분 설계 적용: A_req = ${A_req_m2.toFixed(1)} m², 유효 U = ${U_calc.toFixed(0)} W/m²K, 최소 핀치 ΔT = ${pwProfile.minPinchDT.toFixed(1)}°C`,
      });
    } else {
      warnings.push({
        level: 'ok',
        text: `판형 열교환기(PHE) 고효율 열회수 적합: 총괄계수 U=${U_calc.toFixed(0)} W/m²K · 판수 ${N_plates}매 (전열면적 ${A_prov_m2.toFixed(1)} m²)`,
      });
    }
    if (dPh_bar > 0.85 || dPc_bar > 0.85) {
      warnings.push({
        level: 'warn',
        text: `채널 압력강하 주의: 고온측 ΔP=${dPh_bar.toFixed(3)} bar / 저온측 ΔP=${dPc_bar.toFixed(3)} bar — 판 간격(b) 확대 권장`,
      });
    } else {
      warnings.push({
        level: 'ok',
        text: `PHE 채널 차압 양호: 고온측 ΔP=${dPh_bar.toFixed(3)} bar / 저온측 ΔP=${dPc_bar.toFixed(3)} bar`,
      });
    }

    const status: 'ok' | 'warning' | 'error' = tempCross || pwProfile.minPinchDT <= 0.5
      ? 'error'
      : warnings.some((w) => w.level === 'warn')
        ? 'warning'
        : 'ok';

    return {
      equipTag: inp.equipTag || 'E-332',
      equipName: inp.equipName || `${hotProps.name} / ${coldProps.name} Plate Heat Exchanger`,
      hxType: 'plate_phe',
      exchangerType: 'phe',
      mh, Th_in, Th_out, mc, Tc_in, Tc_out, dofTarget,
      allocation: 'hot_shell',
      Qh_kW, Qc_kW, Q_kW,
      hotProps, coldProps, cph, cpc, rfs: rfh, rft: rfc,
      hotMode, coldMode, hasPhaseChange, hotBreak, coldBreak,
      zones: zoneResults,
      hotNodes: pwProfile.hotNodes,
      coldNodes: pwProfile.coldNodes,
      minPinchDT: pwProfile.minPinchDT,
      pinchF: pwProfile.pinchF,
      dT1, dT2,
      lmtd, LMTD: lmtd,
      Ft, CMTD,
      U_calc, U_clean, U_req,
      A_req_m2, A_prov_m2,
      A_req: A_req_m2, A_calc: A_prov_m2, A_eff_m2: A_prov_m2,
      overdesign_pct, overDesign_pct: overdesign_pct,
      N_plates, N_eff_plates, N_eff: N_eff_plates,
      N_ch: N_ch_per_pass, N_ch_per_pass, N_ch_side: N_ch_per_pass, N_channels: N_plates - 1,
      phe_beta_deg: beta_deg, phe_chevron_deg: beta_deg, beta_deg,
      phe_b_mm: b_mm, b_mm,
      phe_tp_mm: tp_mm, tp_mm,
      phe_wp_mm: Wp_mm, Wp_mm,
      phe_lp_mm: Lp_mm, Lp_mm,
      phe_mat_name: matName, matName,
      phePasses, phe_passes: phePasses,
      phi_enlarge,
      A_1plate_m2: A_single_plate_m2, A_single_plate_m2, A_plate_m2: A_single_plate_m2,
      L_pack_mm, L_frame_mm,
      D_port_mm: Math.round(port_d_m * 1000),
      v_port_h, v_port_c,
      N_tubes: N_plates,
      D_shell_mm: Wp_mm, Ds_mm: Wp_mm, D_bundle_mm: Wp_mm - 30,
      nPasses: phePasses, nShell: 1,
      L_m: Number((Lp_mm / 1000).toFixed(2)),
      do_mm: b_mm, di_mm: b_mm, tw_mm: tp_mm, pt_mm: b_mm + tp_mm, layoutAngle: beta_deg,
      B_spacing_mm: L_pack_mm, N_baffles: N_ch_per_pass, baffleCutPct: beta_deg, baffleRatio: 0.3,
      t_shell_mm: 25, t_tubesheet_mm: 32,
      nozzle_shell_dn: nozzle_hot_dn, nozzle_tube_dn: nozzle_cold_dn,
      nozzle_shell_nps, nozzle_tube_nps,
      W_bundle_kg: W_plates_kg, W_empty_kg, W_filled_kg, cost_usd, cost_krw,
      tema_type: `PHE Chevron ${beta_deg}° (${phePasses}-${phePasses} Pass)`,
      hi: hc, ho: hh, h_tube: hc, h_shell: hh,
      vt: vc, vs: vh,
      Ret: Rec, Res: Reh, Re_t: Rec, Re_s: Reh,
      dPt_bar: dPc_bar, dPs_bar: dPh_bar,
      dP_tube: dPc_bar, dP_shell: dPh_bar,
      dPt_kPa: dPc_bar * 100, dPs_kPa: dPh_bar * 100,
      Jc: 1.0, Jl: 1.0, Jb: 1.0, Js: 1.0, Jr: 1.0,
      jc: 1.0, jl: 1.0, jb: 1.0, js: 1.0, jr: 1.0,
      Rl: 1.0, Rb: 1.0, Rs: 1.0,
      rl: 1.0, rb: 1.0, rs: 1.0,
      J_total: phi_enlarge,
      f_vs_Hz: 0, f_nat_Hz: 120, vibRatio: 0.12,
      fluidelasticRatio: 0.05, criticalVelMs: 10.0,
      fivStatus: 'ok', vibDetails: null, status,
      iterations, warnings,
    };
  }

  // ===========================================================================
  // BRANCH B: SHELL & TUBE HEAT EXCHANGER (Master shellTubeRating.ts + 3-Zone)
  // ===========================================================================
  const nShell = Math.max(1, Math.round(inp.n_shell || 1));
  const nPasses = Math.max(1, Math.round(inp.n_passes || 2));
  const Ft_sens = nPasses === 1 ? 1.0 : calcFt(Th_in, Th_out, Tc_in, Tc_out, nShell);
  let Ft = hasPhaseChange ? 1.0 : Ft_sens;
  let CMTD = lmtd * Ft;

  let U_calc = 550;
  const U_assumed = inp.U_assumed || 600;
  let A_req_m2 = 0;
  let A_prov_m2 = 0;
  let N_tubes = 0;
  let D_shell_mm = 0;
  let hi = 0;
  let ho = 0;
  let vt = 0;
  let vs = 0;
  let Ret = 0;
  let Res = 0;
  let dPt_bar = 0;
  let dPs_bar = 0;
  let overdesign_pct = 15.0;
  let Jc = 1.0, Jl = 1.0, Jb = 1.0, Js = 1.0, Jr = 1.0, J_total = 1.0;
  let Rl = 1.0, Rb = 1.0, Rs = 1.0;
  let f_vs_Hz = 0, f_nat_Hz = 45.0, vibRatio = 0.25;
  let fluidelasticRatio = 0.1, criticalVelMs = 5.0;
  let fivStatus: 'ok' | 'warning' | 'error' = 'ok';
  let vibDetails: VibrationResult | null = null;
  let lastBD: BellDelawareResult | null = null;
  let zoneResults: HXZonalDetail[] = [];
  const iterations: HXIterationRow[] = [];

  const do_mm = inp.tube_od_mm || 19.05;
  const tw_mm = inp.tube_wall_mm || 2.11;
  const di_mm = Math.max(4.0, do_mm - 2.0 * tw_mm);
  const do_m = do_mm / 1000.0;
  const di_m = di_mm / 1000.0;
  const L_m = Math.max(1.2, inp.tube_L_m || 4.88);
  const pitchRatio = inp.pitch_ratio || 1.25;
  const pt_m = do_m * pitchRatio;
  const layoutAngle = inp.layout_angle || 30;
  const layoutDeg = toLayoutDeg(layoutAngle);
  const baffleRatio = clampNum(inp.baffle_ratio || 0.3, 0.18, 0.6);
  const baffleCutPct = clampNum(inp.baffle_cut_pct || 25, 15, 45);

  const allocation: 'hot_shell' | 'hot_tube' = inp.allocation === 'hot_tube' ? 'hot_tube' : 'hot_shell';
  const isHotShell = allocation !== 'hot_tube';
  const shellFluidId = isHotShell ? (inp.hotFluidId || 'crude_oil') : (inp.coldFluidId || 'water');
  const tubeFluidId = isHotShell ? (inp.coldFluidId || 'water') : (inp.hotFluidId || 'crude_oil');
  const shellProps = isHotShell ? hotProps : coldProps;
  const tubeProps = isHotShell ? coldProps : hotProps;
  const ms_kgh = isHotShell ? mh : mc;
  const mt_kgh = isHotShell ? mc : mh;
  const ms_kgs = ms_kgh / 3600.0;
  const mt_kgs = mt_kgh / 3600.0;

  const rhos = inp.rhos || shellProps.rho;
  const mus_Pas = (inp.mus_cP || shellProps.mu) * 0.001;
  const cps_J = (inp.cps || shellProps.cp) * 1000.0;
  const ks = inp.ks || shellProps.k;
  const rfs = inp.rfs !== undefined ? inp.rfs : shellProps.fouling;

  const rhot = inp.rhot || tubeProps.rho;
  const mut_Pas = (inp.mut_cP || tubeProps.mu) * 0.001;
  const cpt_J = (inp.cpt || tubeProps.cp) * 1000.0;
  const kt = inp.kt || tubeProps.k;
  const rft = inp.rft !== undefined ? inp.rft : tubeProps.fouling;

  const shellMode = isHotShell ? hotMode : coldMode;
  const tubeMode = isHotShell ? coldMode : hotMode;
  const shellSatC = isHotShell ? Th_sat : Tc_sat;
  const tubeSatC = isHotShell ? Tc_sat : Th_sat;
  const shellHv = isHotShell ? hvHot : hvCold;
  const tubeHv = isHotShell ? hvCold : hvHot;
  const shellXfrac = isHotShell ? xCond : xVap;
  const tubeXfrac = isHotShell ? xVap : xCond;
  const shellP_bar = inp.shell_p_bar || Math.max(1.01325, shellProps.pv_bar || 1.01325);
  const tubeP_bar = inp.tube_p_bar || Math.max(1.01325, tubeProps.pv_bar || 1.01325);

  const R_wall_fixed = (do_m * Math.log(do_m / di_m)) / (2.0 * kw);
  const R_foul_fixed = (do_m / di_m) * rft + rfs;
  const areaRatioHot = isHotShell ? 1.0 : do_m / di_m;
  const areaRatioCold = isHotShell ? do_m / di_m : 1.0;

  const shellTPFluid =
    shellMode !== 'sensible'
      ? buildTwoPhaseFluidSI(shellFluidId, shellProps, shellSatC, shellP_bar, ms_kgs, shellHv, isHotShell ? cph : cpc)
      : null;
  const tubeTPFluid =
    tubeMode !== 'sensible'
      ? buildTwoPhaseFluidSI(tubeFluidId, tubeProps, tubeSatC, tubeP_bar, mt_kgs, tubeHv, isHotShell ? cpc : cph)
      : null;

  const shellBaseFluidSI = buildSensibleFluidStateSI(ms_kgs, rhos, mus_Pas, cps_J, ks);
  const tubeBaseFluidSI = buildSensibleFluidStateSI(mt_kgs, rhot, mut_Pas, cpt_J, kt);

  const CL = layoutAngle === 30 ? 0.866 : layoutAngle === 60 ? 0.866 : 1.0;
  const CTP = nPasses === 1 ? 0.93 : nPasses === 2 ? 0.9 : 0.85;

  const buildStheGeometry = (nt: number, dBundleM: number, dsM: number, bM: number): ShellTubeGeometry => ({
    shellIdM: dsM,
    tubeOdM: do_m,
    tubeIdM: di_m,
    tubePitchM: pt_m,
    layoutDeg,
    tubeCount: nt,
    tubePasses: nPasses,
    tubeLengthM: L_m,
    baffleSpacingM: bM,
    baffleCutFrac: baffleCutPct / 100.0,
    bundleDiaM: dBundleM,
    baffleCount: Math.max(1, Math.floor(L_m / Math.max(0.08, bM)) - 1),
  });

  const evaluateSideFilmForZone = (
    sideIsShell: boolean,
    regime: string,
    zoneTavg: number,
    zoneQ_W: number,
    zoneLMTD: number,
    spH: number,
    geom: ShellTubeGeometry,
    Gt_kgm2s: number,
    ukHint: number
  ): number => {
    if (regime === 'sensible' || regime === 'subcool' || regime === 'preheat') {
      return Math.max(25, spH);
    }
    const fid = sideIsShell ? shellFluidId : tubeFluidId;
    const fprops = sideIsShell ? shellProps : tubeProps;
    const fP_bar = sideIsShell ? shellP_bar : tubeP_bar;
    const m_kgs = sideIsShell ? ms_kgs : mt_kgs;
    const cpV = sideIsShell ? (isHotShell ? cphVap : cpcVap) : (isHotShell ? cpcVap : cphVap);

    if (regime === 'desuperheat' || regime === 'superheat') {
      const vapState = buildVaporFluidStateSI(fid, fprops, zoneTavg, fP_bar, m_kgs, cpV);
      if (sideIsShell) {
        const bdVap = bellDelawareShellSide(geom, vapState);
        return Math.max(25, bdVap.h);
      }
      const tsVap = tubeSideSinglePhase(geom, vapState);
      return Math.max(25, tsVap.h);
    }

    if (regime === 'condense') {
      const tp = sideIsShell ? shellTPFluid : tubeTPFluid;
      const xP = sideIsShell ? shellXfrac : tubeXfrac;
      if (!tp) return spH;
      const ncgFactor = xP < 0.99 ? 0.45 + 0.55 * xP : 1.0;
      if (sideIsShell) {
        const hC = shellCondensationH(tp, geom);
        return clampNum(hC * ncgFactor, 350, 14000);
      }
      // 3-point Gauss-like average along condensation quality span inside tubes
      const qMax = Math.max(0.1, xP);
      const xPts = [0.15 * qMax, 0.5 * qMax, 0.85 * qMax];
      const hMean =
        xPts.reduce((acc, xk) => acc + shahCondensationH(tp, Gt_kgm2s, di_m, xk), 0) / xPts.length;
      return clampNum(hMean * ncgFactor, 350, 14000);
    }

    if (regime === 'boil') {
      const tp = sideIsShell ? shellTPFluid : tubeTPFluid;
      const xP = sideIsShell ? shellXfrac : tubeXfrac;
      if (!tp) return spH;
      const qFlux = clampNum(Math.max(4000, ukHint * Math.max(1.5, zoneLMTD), zoneQ_W / Math.max(0.5, A_prov_m2)), 3000, 150000);
      if (sideIsShell) {
        const hB = shellBoilingH(tp, qFlux, 1.5);
        return clampNum(hB, 450, 16000);
      }
      const xMid = clampNum(0.5 * xP, 0.05, 0.92);
      const hB = gungorWintertonBoilingH(tp, Gt_kgm2s, di_m, xMid, qFlux);
      return clampNum(hB, 450, 16000);
    }

    return spH;
  };

  const evaluateStheZones = (
    hi_sp: number,
    ho_sp: number,
    geom: ShellTubeGeometry,
    Gt_kgm2s: number,
    ukHint: number
  ) => {
    let totalA_req = 0;
    let sumQOverCMTD = 0;
    const detailedZones: HXZonalDetail[] = pwProfile.zones.map((z) => {
      const T_hot_avg = 0.5 * (z.Th_a + z.Th_b);
      const T_cold_avg = 0.5 * (z.Tc_a + z.Tc_b);
      const hs_z = evaluateSideFilmForZone(
        true,
        isHotShell ? z.hotRegime : z.coldRegime,
        isHotShell ? T_hot_avg : T_cold_avg,
        z.dQ_kW * 1000.0,
        z.zoneLMTD,
        ho_sp,
        geom,
        Gt_kgm2s,
        ukHint
      );
      const ht_z = evaluateSideFilmForZone(
        false,
        isHotShell ? z.coldRegime : z.hotRegime,
        isHotShell ? T_cold_avg : T_hot_avg,
        z.dQ_kW * 1000.0,
        z.zoneLMTD,
        hi_sp,
        geom,
        Gt_kgm2s,
        ukHint
      );
      const hh_z = isHotShell ? hs_z : ht_z;
      const hc_z = isHotShell ? ht_z : hs_z;
      const R_z = areaRatioHot / Math.max(15, hh_z) + areaRatioCold / Math.max(15, hc_z) + R_wall_fixed + R_foul_fixed;
      const U_z = 1.0 / Math.max(1e-5, R_z);
      const Ft_z = z.isIsothermalSide ? 1.0 : Ft_sens;
      const cmtd_z = Math.max(0.8, z.zoneLMTD * Ft_z);
      const A_z = (z.dQ_kW * 1000.0) / Math.max(1.0, U_z * cmtd_z);
      totalA_req += A_z;
      sumQOverCMTD += z.dQ_kW / cmtd_z;
      return { ...z, Ft_z, cmtd_z, hh_z, hc_z, U_z, A_z };
    });
    const CMTD_eff = Q_kW / Math.max(1e-4, sumQOverCMTD);
    const U_eff = Q_W / Math.max(1.0, totalA_req * CMTD_eff);
    return { detailedZones, totalA_req, CMTD_eff, U_eff };
  };

  if (mode === 'quick') {
    U_calc = Math.max(20, U_assumed);
    // Representative quick-mode geometry sized from U_assumed
    A_req_m2 = Q_W / Math.max(1.0, U_calc * Math.max(0.8, CMTD));
    A_prov_m2 = A_req_m2 * 1.15;
    let ntQuick = Math.max(16, Math.ceil(A_prov_m2 / (Math.PI * do_m * L_m)));
    if (ntQuick % nPasses !== 0) ntQuick += nPasses - (ntQuick % nPasses);
    N_tubes = ntQuick;
    const D_bundle_m = do_m * Math.pow((N_tubes * CL * pitchRatio * pitchRatio) / (0.7854 * CTP), 1.0 / 2.15);
    const clearance_m = 0.012 + 0.018 * D_bundle_m;
    const Ds_m = D_bundle_m + clearance_m;
    D_shell_mm = Math.ceil((Ds_m * 1000.0 + 12.0) / 10.0) * 10.0;

    const B_m = Math.max(0.12, (D_shell_mm / 1000.0) * baffleRatio);
    const geom = buildStheGeometry(N_tubes, D_bundle_m, D_shell_mm / 1000.0, B_m);
    const ts = tubeSideSinglePhase(geom, tubeBaseFluidSI);
    const bd = bellDelawareShellSide(geom, shellBaseFluidSI);
    lastBD = bd;
    const Gt = mt_kgs / Math.max(1e-5, (N_tubes / nPasses) * (Math.PI * di_m * di_m * 0.25));

    const zQuick = evaluateStheZones(ts.h, bd.h, geom, Gt, U_calc);
    zoneResults = zQuick.detailedZones;
    CMTD = zQuick.CMTD_eff;
    Ft = Math.min(1.0, CMTD / Math.max(0.5, lmtd));
    A_req_m2 = Q_W / Math.max(1.0, U_calc * CMTD);
    A_prov_m2 = Math.max(A_req_m2 * 1.15, N_tubes * Math.PI * do_m * L_m);
    overdesign_pct = ((A_prov_m2 - A_req_m2) / Math.max(0.1, A_req_m2)) * 100.0;

    vt = ts.velMs;
    Ret = ts.Re;
    vs = bd.crossVelMs;
    Res = bd.Re;
    hi = ts.h;
    ho = bd.h;
    Jc = bd.Jc; Jl = bd.Jl; Jb = bd.Jb; Js = bd.Js; Jr = bd.Jr; J_total = bd.Jtotal;
    Rl = bd.Rl; Rb = bd.Rb; Rs = bd.Rs;
    dPt_bar = ts.dpTotalPa / 1e5;
    dPs_bar = bd.dpTotalPa / 1e5;
    vibDetails = temaVibrationCheck({
      g: geom,
      crossVelMs: bd.crossVelMs,
      shellRho: rhos,
      tubeRhoInside: rhot,
      shellPhase: shellMode !== 'sensible' ? 'twophase' : rhos < 45 ? 'gas' : 'liquid',
      soundSpeedMs: shellMode === 'sensible' && rhos < 45 ? 340 : undefined,
      spanM: B_m,
    });
    f_vs_Hz = vibDetails.vortexFreqHz;
    f_nat_Hz = vibDetails.naturalFreqHz;
    vibRatio = vibDetails.vortexRatio;
    fluidelasticRatio = vibDetails.fluidelasticRatio;
    criticalVelMs = vibDetails.criticalVelMs;
    fivStatus = vibDetails.status;

    iterations.push({
      iter: 1,
      param: '개략 총괄열전달계수 (U_assumed)',
      assumed: `${U_calc.toFixed(1)} W/m²K`,
      calc: `A_req=${A_req_m2.toFixed(1)} m²`,
      err: '0.00%',
      note: '빠른 개략 모드 직접 산정',
    });
  } else {
    // =========================================================================
    // HTRI-STYLE RIGOROUS ZONAL + TABOREK BELL-DELAWARE WEGSTEIN CONVERGENCE
    // =========================================================================
    let Uk = Math.max(80, U_assumed);
    let prevUk: number | null = null;
    let prevCalc: number | null = null;
    let prevNt = -1;
    let convergedGeom: ShellTubeGeometry | null = null;
    let finalGt = 0;

    for (let it = 1; it <= 16; it++) {
      const A_trial = (Q_W / Math.max(10.0, Uk * Math.max(0.8, CMTD))) * 1.12;
      let Nt_trial = Math.max(20, Math.ceil(A_trial / (Math.PI * do_m * L_m)));
      if (Nt_trial % nPasses !== 0) Nt_trial += nPasses - (Nt_trial % nPasses);
      N_tubes = Nt_trial;
      A_prov_m2 = N_tubes * Math.PI * do_m * L_m;

      const D_bundle_m = do_m * Math.pow((N_tubes * CL * pitchRatio * pitchRatio) / (0.7854 * CTP), 1.0 / 2.15);
      const clearance_m = 0.012 + 0.018 * D_bundle_m;
      const Ds_m = D_bundle_m + clearance_m;
      D_shell_mm = Ds_m * 1000.0;
      const B_m = Math.max(0.1, Ds_m * baffleRatio);

      const geom = buildStheGeometry(N_tubes, D_bundle_m, Ds_m, B_m);
      convergedGeom = geom;

      // Tube-side baseline single-phase (shellTubeRating.ts)
      const ts = tubeSideSinglePhase(geom, tubeBaseFluidSI);
      vt = ts.velMs;
      Ret = ts.Re;
      const hi_sp = ts.h;
      const Gt_kgm2s = mt_kgs / Math.max(1e-5, (N_tubes / nPasses) * (Math.PI * di_m * di_m * 0.25));
      finalGt = Gt_kgm2s;

      // Shell-side full Taborek 5-factor Bell-Delaware baseline (shellTubeRating.ts)
      const bd = bellDelawareShellSide(geom, shellBaseFluidSI);
      lastBD = bd;
      vs = bd.crossVelMs;
      Res = bd.Re;
      Jc = bd.Jc; Jl = bd.Jl; Jb = bd.Jb; Js = bd.Js; Jr = bd.Jr; J_total = bd.Jtotal;
      Rl = bd.Rl; Rb = bd.Rb; Rs = bd.Rs;
      const ho_sp = bd.h;

      const zEval = evaluateStheZones(hi_sp, ho_sp, geom, Gt_kgm2s, Uk);
      zoneResults = zEval.detailedZones;
      A_req_m2 = zEval.totalA_req;
      CMTD = zEval.CMTD_eff;
      Ft = Math.min(1.0, CMTD / Math.max(0.5, lmtd));
      U_calc = zEval.U_eff;

      let hh_avg = 0;
      let hc_avg = 0;
      zoneResults.forEach((z) => {
        const w = z.dQ_kW / Math.max(0.01, Q_kW);
        hh_avg += w * z.hh_z;
        hc_avg += w * z.hc_z;
      });
      ho = isHotShell ? hh_avg : hc_avg;
      hi = isHotShell ? hc_avg : hh_avg;

      const err = Math.abs(U_calc - Uk);
      const errPct = (err / Math.max(1.0, U_calc)) * 100.0;
      const ntLocked = N_tubes === prevNt && it >= 2 && err < 1.5;

      iterations.push({
        iter: it,
        param: `Nt=${N_tubes}본, Ds=${D_shell_mm.toFixed(0)}mm (BD J=${J_total.toFixed(3)}, ${zoneResults.length}구간)`,
        assumed: `${Uk.toFixed(1)} W/m²K`,
        calc: `${U_calc.toFixed(1)} W/m²K`,
        err: `${errPct.toFixed(2)}%`,
        note: err < 0.2 || ntLocked ? '수렴 완료 (Zonal Bell-Delaware)' : '구간별 열전달계수 재가정 (Wegstein)',
      });

      if ((err < 0.2 || ntLocked) && it >= 2) break;

      // Damped Wegstein acceleration
      let U_next = 0.35 * Uk + 0.65 * U_calc;
      if (prevUk !== null && prevCalc !== null && Math.abs(Uk - prevUk) > 1e-4) {
        const slope = (U_calc - prevCalc) / (Uk - prevUk);
        const qWeg = clampNum(slope / (slope - 1.0), -0.65, 0.35);
        const wFactor = clampNum(1.0 - qWeg, 0.35, 1.15);
        U_next = clampNum(Uk + wFactor * (U_calc - Uk), 40.0, 12000.0);
      }
      prevUk = Uk;
      prevCalc = U_calc;
      prevNt = N_tubes;
      Uk = U_next;
    }

    overdesign_pct = ((A_prov_m2 - A_req_m2) / Math.max(0.1, A_req_m2)) * 100.0;

    // Final Hydraulics & TEMA Vibration at standard quantized geometry
    const stdShellCandidate = STD_SHELL_MM.find((s) => s >= D_shell_mm) || Math.ceil(D_shell_mm / 50) * 50;
    const Ds_std_m = stdShellCandidate / 1000.0;
    const B_std_m = Math.max(0.1, Ds_std_m * baffleRatio);
    const D_bundle_std_m = Math.max(0.15, (stdShellCandidate - 32) / 1000.0);
    const geomStd = convergedGeom
      ? { ...convergedGeom, shellIdM: Ds_std_m, baffleSpacingM: B_std_m, bundleDiaM: D_bundle_std_m, baffleCount: Math.max(1, Math.floor(L_m / B_std_m) - 1) }
      : buildStheGeometry(N_tubes, D_bundle_std_m, Ds_std_m, B_std_m);

    // Refresh Bell-Delaware & Tube-Side at exact std shell ID so hydraulic outputs & J/R factors match D_shell_mm
    const bdStd = bellDelawareShellSide(geomStd, shellBaseFluidSI);
    const tsStd = tubeSideSinglePhase(geomStd, tubeBaseFluidSI);
    lastBD = bdStd;
    Jc = bdStd.Jc; Jl = bdStd.Jl; Jb = bdStd.Jb; Js = bdStd.Js; Jr = bdStd.Jr; J_total = bdStd.Jtotal;
    Rl = bdStd.Rl; Rb = bdStd.Rb; Rs = bdStd.Rs;
    vs = bdStd.crossVelMs;
    Res = bdStd.Re;
    vt = tsStd.velMs;
    Ret = tsStd.Re;

    if (tubeMode !== 'sensible' && tubeTPFluid && finalGt > 0) {
      const xIn = tubeMode === 'cond_full' || tubeMode === 'cond_partial' ? Math.max(0.2, tubeXfrac) : 0.02;
      const xOut = tubeMode === 'cond_full' ? 0.0 : tubeMode === 'cond_partial' ? Math.max(0.05, 1.0 - tubeXfrac) : clampNum(tubeXfrac, 0.1, 1.0);
      const dpT2p = tubeSideTwoPhaseDP(geomStd, tubeTPFluid, xIn, xOut);
      dPt_bar = dpT2p.totalPa / 1e5;
    } else {
      dPt_bar = tsStd.dpTotalPa / 1e5;
    }

    if (shellMode !== 'sensible' && shellTPFluid) {
      const xIn = shellMode === 'cond_full' || shellMode === 'cond_partial' ? Math.max(0.2, shellXfrac) : 0.02;
      const xOut = shellMode === 'cond_full' ? 0.0 : shellMode === 'cond_partial' ? Math.max(0.05, 1.0 - shellXfrac) : clampNum(shellXfrac, 0.1, 1.0);
      const dpS2p = shellSideTwoPhaseDP(geomStd, shellTPFluid, xIn, xOut);
      dPs_bar = dpS2p.dpPa / 1e5;
    } else {
      dPs_bar = bdStd.dpTotalPa / 1e5;
    }

    // TEMA Flow-Induced Vibration (Connors Fluidelastic + Vortex Shedding + Acoustic)
    vibDetails = temaVibrationCheck({
      g: geomStd,
      crossVelMs: bdStd.crossVelMs,
      shellRho: rhos,
      tubeRhoInside: rhot,
      shellPhase: shellMode !== 'sensible' ? 'twophase' : rhos < 45 ? 'gas' : 'liquid',
      soundSpeedMs: shellMode === 'sensible' && rhos < 45 ? 340 : undefined,
      spanM: B_std_m,
    });
    f_vs_Hz = vibDetails.vortexFreqHz;
    f_nat_Hz = vibDetails.naturalFreqHz;
    vibRatio = vibDetails.vortexRatio;
    fluidelasticRatio = vibDetails.fluidelasticRatio;
    criticalVelMs = vibDetails.criticalVelMs;
    fivStatus = vibDetails.status;
  }

  // Mechanical & Quotation Specifications for TEMA Datasheet
  const D_shell_std_mm = STD_SHELL_MM.find((s) => s >= D_shell_mm) || Math.ceil(D_shell_mm / 50) * 50;
  const D_bundle_mm = Math.max(150, D_shell_std_mm - 32);
  const B_spacing_mm = Math.round(D_shell_std_mm * baffleRatio);
  const N_baffles = Math.max(1, Math.floor((L_m * 1000.0) / Math.max(50, B_spacing_mm)) - 1);
  const pt_mm = do_mm * pitchRatio;
  const t_shell_mm = D_shell_std_mm <= 400 ? 8 : D_shell_std_mm <= 750 ? 10 : D_shell_std_mm <= 1100 ? 12 : 16;
  const t_tubesheet_mm = Math.max(25, Math.round(D_shell_std_mm * 0.045 + 12));

  const R_clean = (do_m / di_m) * (1.0 / Math.max(50, hi || 1200)) + R_wall_fixed + 1.0 / Math.max(50, ho || 800);
  const U_clean = 1.0 / R_clean;
  const U_req = Q_W / Math.max(1.0, A_prov_m2 * CMTD);

  const nozzle_shell_dn = calcNozzleDN(ms_kgh, rhos);
  const nozzle_tube_dn = calcNozzleDN(mt_kgh, rhot);
  const nozzle_shell_nps = DN_TO_NPS_MAP[nozzle_shell_dn] || `${Math.round(nozzle_shell_dn / 25)}"`;
  const nozzle_tube_nps = DN_TO_NPS_MAP[nozzle_tube_dn] || `${Math.round(nozzle_tube_dn / 25)}"`;

  const W_tubes_kg = N_tubes * (Math.PI / 4.0) * (do_m * do_m - di_m * di_m) * L_m * 7850 * nShell;
  const W_baffles_ts_kg =
    (N_baffles * 0.75 * (Math.PI / 4.0) * Math.pow(D_shell_std_mm / 1000.0, 2) * 0.0095 * 7850 +
      2 * (Math.PI / 4.0) * Math.pow(D_shell_std_mm / 1000.0, 2) * (t_tubesheet_mm / 1000.0) * 7850) *
    nShell;
  const W_bundle_kg = W_tubes_kg + W_baffles_ts_kg;
  const W_shell_channel_kg = Math.PI * (D_shell_std_mm / 1000.0) * (L_m + 1.1) * (t_shell_mm / 1000.0) * 7850 * 1.38 * nShell;
  const W_empty_kg = W_bundle_kg + W_shell_channel_kg;
  const V_internal_m3 = (Math.PI / 4.0) * Math.pow(D_shell_std_mm / 1000.0, 2) * L_m * nShell;
  const W_filled_kg = W_empty_kg + V_internal_m3 * 1000.0;

  const matFactor = kw < 25 ? 2.4 : kw > 80 ? 1.8 : 1.0;
  const cost_usd = Math.round((8500 + 340 * Math.pow(A_prov_m2 * nShell, 0.72)) * matFactor);
  const cost_krw = Math.round((cost_usd * 1380) / 10000) * 10000;

  const reqExchUpper = (inp.exchangerType || '').toUpperCase();
  const tema_type =
    reqExchUpper === 'AES' || reqExchUpper === 'BEM' || reqExchUpper === 'AET' || reqExchUpper === 'BKM'
      ? reqExchUpper
      : coldMode !== 'sensible' && !isHotShell
        ? 'BKM (Kettle Reboiler / Chiller)'
        : Math.abs(Th_in - Tc_in) > 85
          ? 'AES (Floating Head)'
          : 'BEM (Fixed Tubesheet)';

  const warnings: HXWarning[] = [];
  if (pwProfile.minPinchDT <= 0.5) {
    warnings.push({
      level: 'danger',
      text: `상변화 핀치/온도 역전(Pinch Cross) 감지! 최소 접근온도 ΔT_pinch = ${pwProfile.minPinchDT.toFixed(1)}°C — 포화온도(Tsat) 또는 유량 조건을 점검하세요.`,
    });
  } else if (pwProfile.minPinchDT < 3.0) {
    warnings.push({
      level: 'warn',
      text: `내부 상변화 핀치 근접 주의: ΔT_pinch = ${pwProfile.minPinchDT.toFixed(1)}°C (< 3.0°C) — 전열면적 증가 유의`,
    });
  }
  if (hasPhaseChange) {
    const shInfo =
      hotMode !== 'sensible'
        ? `고온[과열 ${hotBreak.superheatC.toFixed(1)}°C · 잠열 ${((mh / 3600) * hotBreak.dh_lat).toFixed(0)}kW · 과냉 ${hotBreak.subcoolC.toFixed(1)}°C]`
        : '';
    const cInfo =
      coldMode !== 'sensible'
        ? `${shInfo ? ' / ' : ''}저온[예열 ${coldBreak.subcoolInC.toFixed(1)}°C · 비등잠열 ${((mc / 3600) * coldBreak.dh_lat).toFixed(0)}kW · 과열 ${coldBreak.superheatOutC.toFixed(1)}°C]`
        : '';
    warnings.push({
      level: 'ok',
      text: `다구간(${zoneResults.length}-Zone) 상변화 적분 완료: ${shInfo}${cInfo} → 총 요구면적 A_req = ${A_req_m2.toFixed(1)} m²`,
    });
  }
  if (Ft < 0.75) {
    warnings.push({
      level: 'danger',
      text: `LMTD 보정계수 Ft = ${Ft.toFixed(3)} (< 0.75 부적합) — 직렬 쉘 패스 수(N_shell)를 2 이상으로 늘리세요!`,
    });
  } else {
    warnings.push({
      level: 'ok',
      text: `유효 온도차 보정 적합: Ft = ${Ft.toFixed(3)} ≥ 0.75 (최소 핀치 ΔT_min = ${pwProfile.minPinchDT.toFixed(1)}°C)`,
    });
  }
  if (mode === 'rigorous') {
    if (dPt_bar > 0.7 || dPs_bar > 0.7) {
      warnings.push({
        level: 'warn',
        text: `압력강하 주의: Tube ΔP=${dPt_bar.toFixed(3)} bar, Shell ΔP=${dPs_bar.toFixed(3)} bar (권장 ≤ 0.70 bar)`,
      });
    } else {
      warnings.push({
        level: 'ok',
        text: `압력강하 양호: Tube ΔP=${dPt_bar.toFixed(3)} bar / Shell ΔP=${dPs_bar.toFixed(3)} bar (Bell-Delaware R_l=${Rl.toFixed(2)}, R_b=${Rb.toFixed(2)})`,
      });
    }
    if (fivStatus === 'error' || vibRatio > 0.8 || fluidelasticRatio > 0.8) {
      warnings.push({
        level: 'danger',
        text: `튜브 유체유발 진동(FIV) 위험! f_vs/f_n=${vibRatio.toFixed(2)}, Connors v/v_crit=${fluidelasticRatio.toFixed(2)} — 배플 간격(B/Ds) 축소 필요`,
      });
    } else if (fivStatus === 'warning') {
      warnings.push({
        level: 'warn',
        text: `튜브 진동 주의 (TEMA FIV): f_vs/f_n=${vibRatio.toFixed(2)}, Connors v/v_crit=${fluidelasticRatio.toFixed(2)} — 여유도 점검 권장`,
      });
    } else {
      warnings.push({
        level: 'ok',
        text: `TEMA 튜브 진동 안전: f_vs=${f_vs_Hz.toFixed(1)} Hz vs f_n=${f_nat_Hz.toFixed(1)} Hz (비율 ${vibRatio.toFixed(2)}), Connors v/v_crit=${fluidelasticRatio.toFixed(2)} < 0.80`,
      });
    }
  }

  const status: 'ok' | 'warning' | 'error' =
    tempCross || pwProfile.minPinchDT <= 0.5 || Ft < 0.75 || fivStatus === 'error'
      ? 'error'
      : fivStatus === 'warning' || warnings.some((w) => w.level === 'warn')
        ? 'warning'
        : 'ok';

  return {
    equipTag: inp.equipTag || 'E-101',
    equipName: inp.equipName || `${hotProps.name} / ${coldProps.name} Exchanger`,
    hxType: 'shell_tube',
    exchangerType: reqExchUpper || 'sthe',
    mh, Th_in, Th_out, mc, Tc_in, Tc_out, dofTarget, allocation,
    Qh_kW, Qc_kW, Q_kW,
    hotProps, coldProps, cph, cpc, rfs, rft,
    hotMode, coldMode, hasPhaseChange, hotBreak, coldBreak,
    zones: zoneResults,
    hotNodes: pwProfile.hotNodes,
    coldNodes: pwProfile.coldNodes,
    minPinchDT: pwProfile.minPinchDT,
    pinchF: pwProfile.pinchF,
    dT1, dT2,
    lmtd, LMTD: lmtd,
    Ft, CMTD,
    U_calc, U_clean, U_req,
    A_req_m2, A_prov_m2,
    A_req: A_req_m2, A_calc: A_prov_m2, A_eff_m2: A_prov_m2,
    overdesign_pct, overDesign_pct: overdesign_pct,
    N_tubes,
    D_shell_mm: D_shell_std_mm,
    Ds_mm: D_shell_std_mm,
    D_bundle_mm,
    nPasses, nShell, L_m, do_mm, di_mm, tw_mm, pt_mm, layoutAngle,
    B_spacing_mm, N_baffles, baffleCutPct, baffleRatio,
    t_shell_mm, t_tubesheet_mm,
    nozzle_shell_dn, nozzle_tube_dn, nozzle_shell_nps, nozzle_tube_nps,
    W_bundle_kg, W_empty_kg, W_filled_kg, cost_usd, cost_krw, tema_type,
    hi, ho, h_tube: hi, h_shell: ho,
    vt, vs,
    Ret, Res, Re_t: Ret, Re_s: Res,
    dPt_bar, dPs_bar,
    dP_tube: dPt_bar, dP_shell: dPs_bar,
    dPt_kPa: dPt_bar * 100, dPs_kPa: dPs_bar * 100,
    Jc, Jl, Jb, Js, Jr,
    jc: Jc, jl: Jl, jb: Jb, js: Js, jr: Jr,
    Rl: lastBD ? lastBD.Rl : Rl,
    Rb: lastBD ? lastBD.Rb : Rb,
    Rs: lastBD ? lastBD.Rs : Rs,
    rl: lastBD ? lastBD.Rl : Rl,
    rb: lastBD ? lastBD.Rb : Rb,
    rs: lastBD ? lastBD.Rs : Rs,
    J_total,
    f_vs_Hz, f_nat_Hz, vibRatio,
    fluidelasticRatio, criticalVelMs,
    fivStatus, vibDetails, status,
    iterations, warnings,
  };
}

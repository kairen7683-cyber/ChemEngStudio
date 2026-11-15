/**
 * Pressure Vessel & Gas-Liquid Separator Solver (ASME Sec. VIII Div. 1 + Souders-Brown / GPSA)
 *
 * Strictly unifies:
 *   1. ChemPro `solveVessel` (Souders-Brown demister sizing, GPSA high-pressure Kv derating,
 *      holdup / surge residence volume, L/D iterative geometry convergence, weight estimation).
 *   2. `mechanicalDesign.ts` ASME Sec. VIII Div. 1 rigor (temperature-dependent allowable stress,
 *      UG-27 internal cylindrical shell, UG-32 2:1 ellipsoidal head, UG-28/UG-29 external/vacuum
 *      buckling & stiffening rings, UG-33 head external pressure check).
 */

import { resolveAsmeMaterial, resolveFluidProps } from './chemproFluidBridge';
import {
  type HeadType,
  type MechMaterialKey,
  allowableStressMpa,
  ug27ShellThicknessMm,
  ug28CylinderAllowable,
  ug29RequiredInertiaMm4,
  ug32HeadThicknessMm,
  ug33HeadAllowableExtMpa,
  maxStiffenerSpacingMm,
} from './mechanicalDesign';

export type VesselSolverMode = 'quick' | 'rigorous';

export interface VesselDesignInput {
  equipTag?: string;
  equipName?: string;
  orientation?: 'vertical' | 'horizontal' | string;
  Wg_kgh?: number;
  Wl_kgh?: number;
  rhoG?: number;
  rhoG_kgm3?: number;
  rhoL?: number;
  rhoL_kgm3?: number;
  gasFluid?: string;
  liqFluid?: string;
  T_op_C?: number;
  T_des_C?: number;
  holdup_min?: number;
  surge_min?: number;
  P_op_barG?: number;
  /** Absolute operating pressure (barA). Vacuum is inferred if P_op_bar < 1.013. */
  P_op_bar?: number;
  P_des_barG?: number;
  /** External pressure (bar abs/diff) when operating under vacuum or jacket pressure. */
  P_ext_bar?: number;
  is_vacuum?: boolean;
  CA_mm?: number;
  mat_key?: string;
  E_joint?: number;
  has_demister?: boolean;
  head_type?: HeadType;
  stiffenerSpacingM?: number;
}

export interface VesselIterationRow {
  iter: number;
  param: string;
  assumed: string;
  calc: string;
  err: string;
  note: string;
}

export interface VesselVacuumCheck {
  isVacuum: boolean;
  externalPressMpa: number;
  t_shell_ext_mm: number;
  t_head_ext_mm: number;
  stiffenerRequired: boolean;
  stiffenerSpacingM: number;
  stiffenerCount: number;
  stiffenerSection: string;
  stiffenerIsReqCm4: number;
  ug28FactorA: number;
  ug28FactorBMpa: number;
  ug28AllowableMpa: number;
  ug33HeadAllowableMpa: number;
  governingCase: 'internal' | 'external_vacuum';
}

export interface VesselDesignResult {
  // ── Exact ChemPro `solveVessel` contract keys ──────────────────────────
  equipTag: string;
  equipName: string;
  orientation: 'vertical' | 'horizontal';
  hasDemister: boolean;
  D_m: number;
  L_m: number;
  LD_ratio: number;
  Kv_base: number;
  Vt_max_ms: number;
  Vg_des_ms: number;
  V_liq_req_m3: number;
  V_total_m3: number;
  P_op_barG: number;
  P_des_barG: number;
  MAWP_barG: number;
  t_shell_req_mm: number;
  t_head_req_mm: number;
  t_nom_mm: number;
  CA_mm: number;
  W_empty_kg: number;
  W_oper_kg: number;
  W_hydro_kg: number;
  matName: string;
  S_MPa: number;
  iterations: VesselIterationRow[];
  warnings: string[];

  // ── Superset / Alias keys for downstream UI, CAD & mechanical checks ───
  t_shell_mm: number;
  t_head_mm: number;
  t_adopt_mm: number;
  t_head_nom_mm: number;
  MAWP: number;
  P_op_bar: number;
  P_ext_bar: number;
  T_des_C: number;
  E_joint: number;
  mechMatKey: MechMaterialKey;
  mode: VesselSolverMode;
  vacuumCheck: VesselVacuumCheck;
}

const STANDARD_PLATE_MM = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 36, 40, 45, 50, 55, 60];

function mapToMechMaterialKey(matKey: string): MechMaterialKey {
  const k = matKey.toUpperCase();
  if (k.includes('316')) return 'SS316L';
  if (k.includes('304')) return 'SS304';
  if (k.includes('2205') || k.includes('DUPLEX')) return 'DUPLEX_2205';
  if (k.includes('C276') || k.includes('C-276') || k.includes('HASTELLOY')) return 'ALLOY_C276';
  return 'CS_SA516_70';
}

function selectStandardPlateMm(reqMm: number): number {
  const minMm = Math.max(6.0, reqMm);
  return STANDARD_PLATE_MM.find((p) => p >= minMm) ?? Math.ceil(minMm / 2) * 2;
}

function pickStiffenerSection(isReqCm4: number): string {
  if (isReqCm4 <= 45) return 'L65x65x6';
  if (isReqCm4 <= 120) return 'L90x90x9';
  if (isReqCm4 <= 260) return 'L120x120x10';
  if (isReqCm4 <= 550) return 'WT150x22';
  return 'WT200x36';
}

export function solveVessel(
  inp: VesselDesignInput = {},
  mode: VesselSolverMode | string = 'rigorous',
): VesselDesignResult {
  const solverMode: VesselSolverMode = mode === 'quick' ? 'quick' : 'rigorous';
  const orientation: 'vertical' | 'horizontal' =
    inp.orientation === 'horizontal' ? 'horizontal' : 'vertical';
  const hasDemister = inp.has_demister !== false;
  const headType: HeadType = inp.head_type ?? 'ellipsoidal_2_1';

  const Wg_kgh = Math.max(0, inp.Wg_kgh ?? 18000);
  const Wl_kgh = Math.max(0, inp.Wl_kgh ?? 24000);

  const T_op_C = inp.T_op_C ?? 40;
  const T_des_C = inp.T_des_C ?? Math.max(85, T_op_C + 25);

  // Resolve fluid densities if fluid IDs were given without explicit density
  const gasFallback = inp.gasFluid ? resolveFluidProps(inp.gasFluid, T_op_C).rho : 14.2;
  const liqFallback = inp.liqFluid ? resolveFluidProps(inp.liqFluid, T_op_C).rho : 780;

  const rhoG = Math.max(0.05, inp.rhoG ?? inp.rhoG_kgm3 ?? gasFallback);
  const rhoL = Math.max(200, inp.rhoL ?? inp.rhoL_kgm3 ?? liqFallback);
  const holdup_min = Math.max(1.0, (inp.holdup_min ?? 7.0) + (inp.surge_min ?? 0));

  // Operating & vacuum pressure handling (preserve negative P_op_barG & P_op_bar < 1.013!)
  const P_op_barG =
    inp.P_op_barG !== undefined
      ? inp.P_op_barG
      : inp.P_op_bar !== undefined
        ? inp.P_op_bar - 1.01325
        : 12.0;
  const P_op_bar = inp.P_op_bar !== undefined ? inp.P_op_bar : P_op_barG + 1.01325;
  const isVacuum =
    Boolean(inp.is_vacuum) ||
    P_op_bar < 1.012 ||
    P_op_barG < -0.001 ||
    (inp.P_ext_bar !== undefined && inp.P_ext_bar > 0.01);

  const P_des_barG =
    inp.P_des_barG !== undefined
      ? Math.max(0.5, inp.P_des_barG)
      : P_op_barG >= 0
        ? Math.max(P_op_barG + 1.5, Math.max(1.5, P_op_barG * 1.15))
        : 1.5;

  const P_ext_bar = isVacuum ? Math.max(0.1, inp.P_ext_bar ?? 1.01325) : 0;
  const P_ext_MPa = P_ext_bar * 0.1;

  const CA_mm = Math.max(0, inp.CA_mm ?? 3.0);
  const E_joint = Math.min(1.0, Math.max(0.7, inp.E_joint ?? 1.0));

  // ASME Material resolution + temperature-dependent allowable stress
  const matKeyStr = inp.mat_key ?? 'SA-516-70';
  const mat = resolveAsmeMaterial(matKeyStr);
  const mechMatKey = mapToMechMaterialKey(matKeyStr);
  const mechAllowS = allowableStressMpa(mechMatKey, T_des_C);
  // Respect lower allowable stress from SA-285-C / SA-387-11 if distinct, else temperature-corrected ASME stress
  const S_MPa = Number(Math.min(mat.S_MPa, mechAllowS).toFixed(2));

  const warnings: string[] = [];
  if (inp.P_des_barG !== undefined && P_op_barG > 0 && inp.P_des_barG < P_op_barG * 1.1) {
    warnings.push(
      `설계압력(${inp.P_des_barG.toFixed(1)} barG)이 운전압력(${P_op_barG.toFixed(1)} barG)의 110% 미만이므로 안전 여유 확인이 필요합니다.`,
    );
  }
  if (isVacuum) {
    warnings.push(
      `진공/외압 운전 조건(P_op=${P_op_bar.toFixed(3)} barA, P_ext=${P_ext_bar.toFixed(3)} bar) 감지: ASME VIII Div.1 UG-28/29/33 외압 좌굴 검토를 수행했습니다.`,
    );
  }

  // ── 1. Souders-Brown Vapor-Liquid Separation & GPSA Pressure Derating ───
  const Kv_base =
    orientation === 'vertical'
      ? hasDemister
        ? 0.107
        : 0.06
      : hasDemister
        ? 0.125
        : 0.08;

  const P_op_psi = Math.max(0, P_op_barG) * 14.5038;
  const k_press =
    P_op_psi <= 100 ? 1.0 : Math.max(0.7, 1.0 - 0.0005 * (P_op_psi - 100));
  const Kv_eff = Kv_base * k_press;

  const Vt_max_ms = Kv_eff * Math.sqrt(Math.max(0.1, rhoL - rhoG) / rhoG);
  const Vg_des_ms = Vt_max_ms * 0.75; // 75% design margin against droplet entrainment

  const Qg_m3s = Wg_kgh / 3600.0 / rhoG;
  const Ql_m3s = Wl_kgh / 3600.0 / rhoL;
  const V_liq_req_m3 = Ql_m3s * (holdup_min * 60.0);

  // ── 2. Diameter & Length Sizing (Quick vs Rigorous) ─────────────────────
  let D_m = 1.6;
  let L_m = 4.8;
  const iterations: VesselIterationRow[] = [];

  if (solverMode === 'quick') {
    const A_g_req = Qg_m3s > 0 ? Qg_m3s / Math.max(0.05, Vg_des_ms) : 0.25;
    if (orientation === 'vertical') {
      D_m = Math.max(0.5, Math.ceil(Math.sqrt((4.0 * A_g_req) / Math.PI) * 20) / 20);
      const A_cross = (Math.PI * D_m * D_m) / 4.0;
      const H_liq = V_liq_req_m3 / A_cross;
      const H_vapor = Math.max(1.2, 0.9 * D_m);
      L_m = Math.max(2.5 * D_m, H_liq + H_vapor + (hasDemister ? 0.6 : 0.3));
    } else {
      const A_tot_req = Math.max(0.3, A_g_req / 0.5);
      D_m = Math.max(0.6, Math.ceil(Math.sqrt((4.0 * A_tot_req) / Math.PI) * 20) / 20);
      const A_cross = (Math.PI * D_m * D_m) / 4.0;
      const L_from_liq = V_liq_req_m3 / (0.5 * A_cross);
      L_m = Math.max(3.0 * D_m, L_from_liq);
    }
    iterations.push({
      iter: 1,
      param: 'Vessel D x L',
      assumed: 'Quick Estimate',
      calc: `${D_m.toFixed(2)}m x ${L_m.toFixed(2)}m`,
      err: '0.00%',
      note: 'Souders-Brown 단면 및 액체 체류 직접 산정',
    });
  } else {
    const targetLD = orientation === 'vertical' ? 3.2 : 4.0;
    for (let it = 1; it <= 8; it++) {
      const D_prev = D_m;
      if (orientation === 'vertical') {
        const A_g_min = Qg_m3s > 0 ? Qg_m3s / Math.max(0.05, Vg_des_ms) : 0.25;
        const D_gas = Math.sqrt((4.0 * A_g_min) / Math.PI);
        const D_liq = Math.cbrt((4.0 * Math.max(0.2, V_liq_req_m3)) / (Math.PI * 1.4));
        D_m = Math.max(0.6, Math.ceil(Math.max(D_gas, D_liq) * 20) / 20);

        const A_c = (Math.PI * D_m * D_m) / 4.0;
        const H_liq = V_liq_req_m3 / A_c;
        const H_demister = hasDemister ? 0.6 + 0.15 + 0.4 : 0.45;
        const H_inlet = Math.max(0.6, 0.5 * D_m);
        L_m = Math.max(2.5 * D_m, H_liq + H_inlet + H_demister + 0.6);
        if (L_m / D_m > 4.8) {
          D_m = Math.ceil((D_m + 0.1) * 20) / 20;
        }
      } else {
        const A_g_min = Qg_m3s > 0 ? Qg_m3s / Math.max(0.05, Vg_des_ms) : 0.25;
        const D_gas = Math.sqrt((4.0 * A_g_min) / (Math.PI * 0.45));
        const D_liq = Math.cbrt((4.0 * Math.max(0.2, V_liq_req_m3)) / (Math.PI * 0.55 * targetLD));
        D_m = Math.max(0.6, Math.ceil(Math.max(D_gas, D_liq) * 20) / 20);
        const A_c = (Math.PI * D_m * D_m) / 4.0;
        L_m = Math.max(3.0 * D_m, V_liq_req_m3 / (0.55 * A_c));
        if (L_m / D_m > 5.5) {
          D_m = Math.ceil((D_m + 0.15) * 20) / 20;
        }
      }

      const relErr = it === 1 ? 1.0 : Math.abs(D_m - D_prev) / Math.max(0.1, D_m);
      iterations.push({
        iter: it,
        param: 'Diameter / L-D Balance',
        assumed: `${D_prev.toFixed(2)} m`,
        calc: `${D_m.toFixed(2)} m (L=${L_m.toFixed(2)}m, L/D=${(L_m / D_m).toFixed(2)})`,
        err: `${(relErr * 100).toFixed(2)}%`,
        note:
          relErr < 0.005
            ? `Souders-Brown(${(Vt_max_ms * 0.75).toFixed(2)} m/s) & Holdup(${holdup_min}분) 수렴`
            : '기액분리 단면 및 L/D 균형 반복',
      });
      if (it > 1 && relErr < 0.005) break;
    }
  }

  const LD_ratio = L_m / D_m;
  const A_cross = (Math.PI * D_m * D_m) / 4.0;
  const V_cyl_m3 = A_cross * L_m;
  const V_heads_m3 = (Math.PI * Math.pow(D_m, 3)) / 12.0; // Two 2:1 ellipsoidal heads
  const V_total_m3 = V_cyl_m3 + V_heads_m3;

  // ── 3. ASME Sec. VIII Div. 1 Mechanical Thickness (Internal + External UG-28/29/33) ──
  const P_des_MPa = P_des_barG * 0.1;
  const D_i_mm = D_m * 1000.0;
  const R_i_mm = D_i_mm / 2.0;
  const L_tan_mm = L_m * 1000.0;

  // UG-27 Internal pressure shell thickness & UG-32 2:1 ellipsoidal head thickness
  const t_shell_int_corr = ug27ShellThicknessMm(P_des_MPa, R_i_mm, S_MPa, E_joint);
  const t_head_int_corr = ug32HeadThicknessMm(headType, P_des_MPa, D_i_mm, S_MPa, E_joint);
  const t_shell_int_mm = t_shell_int_corr + CA_mm;
  const t_head_int_mm = t_head_int_corr + CA_mm;

  // UG-28 / UG-29 / UG-33 External / Vacuum buckling verification
  let t_shell_ext_mm = 0;
  let t_head_ext_mm = 0;
  let stiffenerRequired = false;
  let stiffenerSpacingM = L_m;
  let stiffenerCount = 0;
  let stiffenerSection = 'None';
  let stiffenerIsReqCm4 = 0;
  let ug28FactorA = 0;
  let ug28FactorBMpa = 0;
  let ug28AllowableMpa = 0;
  let ug33HeadAllowableMpa = 0;
  let governingCase: 'internal' | 'external_vacuum' = 'internal';

  // Effective unsupported length between tangent lines + 1/3 of each 2:1 head depth (D/4 * 2/3 * 2 = D/3)
  const L_eff_no_rings_mm = L_tan_mm + D_i_mm / 3.0;

  if (isVacuum) {
    // Try candidate plate thickness starting at internal thickness up to heavy plate
    let t_nom_try = selectStandardPlateMm(t_shell_int_mm);
    const Do_try = D_i_mm + 2 * t_nom_try;
    const t_corr_try = Math.max(1.5, t_nom_try - CA_mm);

    // Check if unstiffened shell already passes UG-28
    const unstiffened = ug28CylinderAllowable(Do_try, t_corr_try, L_eff_no_rings_mm, mechMatKey, T_des_C);
    if (unstiffened.allowableExtPressMpa >= P_ext_MPa) {
      t_shell_ext_mm = t_nom_try;
      ug28FactorA = unstiffened.factorA;
      ug28FactorBMpa = unstiffened.factorBMpa;
      ug28AllowableMpa = unstiffened.allowableExtPressMpa;
      stiffenerSpacingM = L_m;
    } else {
      // Find minimum plate without stiffeners vs plate + stiffener rings
      let t_no_ring_found = 60 + CA_mm;
      for (const p of STANDARD_PLATE_MM) {
        if (p <= CA_mm + 1.5) continue;
        const r = ug28CylinderAllowable(D_i_mm + 2 * p, p - CA_mm, L_eff_no_rings_mm, mechMatKey, T_des_C);
        if (r.allowableExtPressMpa >= P_ext_MPa) {
          t_no_ring_found = p;
          break;
        }
      }

      if (t_no_ring_found <= t_nom_try + 4 && inp.stiffenerSpacingM === undefined) {
        // Economical to thicken shell plate directly without stiffening rings
        t_shell_ext_mm = t_no_ring_found;
        const r = ug28CylinderAllowable(D_i_mm + 2 * t_no_ring_found, t_no_ring_found - CA_mm, L_eff_no_rings_mm, mechMatKey, T_des_C);
        ug28FactorA = r.factorA;
        ug28FactorBMpa = r.factorBMpa;
        ug28AllowableMpa = r.allowableExtPressMpa;
      } else {
        // Add ASME UG-28/UG-29 external/internal stiffening rings at practical shell thickness
        stiffenerRequired = true;
        const basePlate = Math.max(t_nom_try, 8);
        const Do_ring = D_i_mm + 2 * basePlate;
        const t_corr_ring = Math.max(2.0, basePlate - CA_mm);
        const maxLsMm = maxStiffenerSpacingMm(Do_ring, t_corr_ring, P_ext_MPa, mechMatKey, T_des_C);
        const reqLsMm = inp.stiffenerSpacingM !== undefined
          ? Math.min(maxLsMm, inp.stiffenerSpacingM * 1000)
          : Math.max(350, maxLsMm * 0.85);
        stiffenerCount = Math.max(1, Math.ceil(L_eff_no_rings_mm / Math.max(300, reqLsMm)) - 1);
        const actualLsMm = L_eff_no_rings_mm / (stiffenerCount + 1);
        stiffenerSpacingM = Number((actualLsMm / 1000).toFixed(3));

        const check = ug28CylinderAllowable(Do_ring, t_corr_ring, actualLsMm, mechMatKey, T_des_C);
        if (check.allowableExtPressMpa < P_ext_MPa) {
          // Step up plate by one gauge to ensure margin
          const upPlate = selectStandardPlateMm(basePlate + 2);
          t_shell_ext_mm = upPlate;
          const upCheck = ug28CylinderAllowable(D_i_mm + 2 * upPlate, upPlate - CA_mm, actualLsMm, mechMatKey, T_des_C);
          ug28FactorA = upCheck.factorA;
          ug28FactorBMpa = upCheck.factorBMpa;
          ug28AllowableMpa = upCheck.allowableExtPressMpa;
        } else {
          t_shell_ext_mm = basePlate;
          ug28FactorA = check.factorA;
          ug28FactorBMpa = check.factorBMpa;
          ug28AllowableMpa = check.allowableExtPressMpa;
        }

        const estAsMm2 = 800; // typical angle/tee cross-section area (~8 cm2)
        const inertiaRes = ug29RequiredInertiaMm4(
          D_i_mm + 2 * t_shell_ext_mm,
          t_shell_ext_mm - CA_mm,
          actualLsMm,
          estAsMm2,
          P_ext_MPa,
          mechMatKey,
          T_des_C,
        );
        stiffenerIsReqCm4 = Number((inertiaRes.isReqMm4 / 1e4).toFixed(1));
        stiffenerSection = pickStiffenerSection(stiffenerIsReqCm4);
      }
    }

    // UG-33 Head external pressure thickness check
    t_head_ext_mm = selectStandardPlateMm(t_head_int_mm);
    for (const p of STANDARD_PLATE_MM) {
      if (p < t_head_int_mm || p <= CA_mm + 1.5) continue;
      const pAllowHead = ug33HeadAllowableExtMpa(headType, D_i_mm + 2 * p, p - CA_mm, mechMatKey, T_des_C);
      if (pAllowHead >= P_ext_MPa) {
        t_head_ext_mm = p;
        ug33HeadAllowableMpa = pAllowHead;
        break;
      }
    }
    if (ug33HeadAllowableMpa === 0) {
      ug33HeadAllowableMpa = ug33HeadAllowableExtMpa(
        headType,
        D_i_mm + 2 * t_head_ext_mm,
        Math.max(1.5, t_head_ext_mm - CA_mm),
        mechMatKey,
        T_des_C,
      );
    }

    if (t_shell_ext_mm > t_shell_int_mm || t_head_ext_mm > t_head_int_mm) {
      governingCase = 'external_vacuum';
    }
  } else {
    // Still compute UG-28/UG-33 baseline telemetry even at positive pressure
    const nomCheck = selectStandardPlateMm(t_shell_int_mm);
    const r = ug28CylinderAllowable(D_i_mm + 2 * nomCheck, Math.max(1.5, nomCheck - CA_mm), L_eff_no_rings_mm, mechMatKey, T_des_C);
    ug28FactorA = r.factorA;
    ug28FactorBMpa = r.factorBMpa;
    ug28AllowableMpa = r.allowableExtPressMpa;
    ug33HeadAllowableMpa = ug33HeadAllowableExtMpa(
      headType,
      D_i_mm + 2 * nomCheck,
      Math.max(1.5, nomCheck - CA_mm),
      mechMatKey,
      T_des_C,
    );
  }

  const t_shell_req_mm = Math.max(t_shell_int_mm, t_shell_ext_mm);
  const t_head_req_mm = Math.max(t_head_int_mm, t_head_ext_mm);
  const t_nom_mm = selectStandardPlateMm(t_shell_req_mm);
  const t_head_nom_mm = selectStandardPlateMm(t_head_req_mm);

  // MAWP on corroded nominal thickness (ASME UG-27)
  const t_corr_mm = Math.max(0.5, t_nom_mm - CA_mm);
  const MAWP_barG = ((S_MPa * E_joint * t_corr_mm) / (R_i_mm + 0.6 * t_corr_mm)) * 10.0;

  if (solverMode !== 'quick') {
    iterations.push({
      iter: iterations.length + 1,
      param: governingCase === 'external_vacuum' ? 'ASME UG-27/28/29' : 'ASME UG-27/32',
      assumed: `P_des=${P_des_barG.toFixed(1)} barG`,
      calc: `t_req=${t_shell_req_mm.toFixed(2)}mm -> t_nom=${t_nom_mm}mm`,
      err: '0.00%',
      note:
        governingCase === 'external_vacuum'
          ? `외압(P_ext=${P_ext_bar.toFixed(2)} bar) 지배${stiffenerRequired ? `, 보강링 ${stiffenerCount}개(${stiffenerSection})` : ''}`
          : `내압 MAWP ${MAWP_barG.toFixed(1)} barG (S=${S_MPa} MPa @ ${T_des_C}°C)`,
    });
  }

  // ── 4. Weight Estimation (Empty / Operating / Hydrotest) ────────────────
  const D_mid_m = D_m + t_nom_mm / 1000.0;
  const vol_shell_metal = Math.PI * D_mid_m * (t_nom_mm / 1000.0) * L_m;
  const vol_heads_metal = 2.0 * (1.084 * D_mid_m * D_mid_m * (t_head_nom_mm / 1000.0));
  const W_metal_base = (vol_shell_metal + vol_heads_metal) * mat.rho_kgm3;
  const W_stiffeners = stiffenerRequired ? stiffenerCount * (Math.PI * (D_m + 0.1) * 14.0) : 0;
  const W_empty_kg = (W_metal_base + W_stiffeners) * 1.18 + (hasDemister ? 120 : 0);
  const W_oper_kg = W_empty_kg + V_liq_req_m3 * rhoL;
  const W_hydro_kg = W_empty_kg + V_total_m3 * 1000.0;

  if (LD_ratio < 1.8 || LD_ratio > 6.0) {
    warnings.push(
      `용기 세장비 L/D = ${LD_ratio.toFixed(2)}가 일반 공정 범위(2.0 ~ 5.5)를 벗어났습니다. 드럼 직경 재조정을 권장합니다.`,
    );
  }
  if (!hasDemister && Wg_kgh > 5000) {
    warnings.push(
      'Demister 미설치 시 비말 동반(Entrainment) 방지를 위해 허용 가스 속도(Kv=0.06)가 약 45% 저하되어 드럼 직경이 커집니다.',
    );
  }
  if (P_des_barG > 30) {
    warnings.push(
      `고압 설계(${P_des_barG.toFixed(1)} barG)로 인해 GPSA 가스 밀도 보정이 적용되었습니다 (k_press=${k_press.toFixed(3)}).`,
    );
  }

  return {
    equipTag: inp.equipTag ?? 'V-101',
    equipName: inp.equipName ?? '압력용기 / 기액분리기',
    orientation,
    hasDemister,
    D_m: Number(D_m.toFixed(3)),
    L_m: Number(L_m.toFixed(3)),
    LD_ratio: Number(LD_ratio.toFixed(2)),
    Kv_base,
    Vt_max_ms: Number(Vt_max_ms.toFixed(3)),
    Vg_des_ms: Number(Vg_des_ms.toFixed(3)),
    V_liq_req_m3: Number(V_liq_req_m3.toFixed(2)),
    V_total_m3: Number(V_total_m3.toFixed(2)),
    P_op_barG: Number(P_op_barG.toFixed(2)),
    P_des_barG: Number(P_des_barG.toFixed(2)),
    MAWP_barG: Number(MAWP_barG.toFixed(2)),
    t_shell_req_mm: Number(t_shell_req_mm.toFixed(2)),
    t_head_req_mm: Number(t_head_req_mm.toFixed(2)),
    t_nom_mm,
    CA_mm,
    W_empty_kg: Number(W_empty_kg.toFixed(0)),
    W_oper_kg: Number(W_oper_kg.toFixed(0)),
    W_hydro_kg: Number(W_hydro_kg.toFixed(0)),
    matName: mat.name,
    S_MPa,
    iterations,
    warnings,

    // Aliases & mechanical superset fields
    t_shell_mm: t_nom_mm,
    t_head_mm: t_head_nom_mm,
    t_adopt_mm: t_nom_mm,
    t_head_nom_mm,
    MAWP: Number(MAWP_barG.toFixed(2)),
    P_op_bar: Number(P_op_bar.toFixed(3)),
    P_ext_bar: Number(P_ext_bar.toFixed(3)),
    T_des_C,
    E_joint,
    mechMatKey,
    mode: solverMode,
    vacuumCheck: {
      isVacuum,
      externalPressMpa: Number(P_ext_MPa.toFixed(4)),
      t_shell_ext_mm: Number(t_shell_ext_mm.toFixed(2)),
      t_head_ext_mm: Number(t_head_ext_mm.toFixed(2)),
      stiffenerRequired,
      stiffenerSpacingM,
      stiffenerCount,
      stiffenerSection,
      stiffenerIsReqCm4,
      ug28FactorA: Number(ug28FactorA.toExponential(3)),
      ug28FactorBMpa: Number(ug28FactorBMpa.toFixed(2)),
      ug28AllowableMpa: Number(ug28AllowableMpa.toFixed(4)),
      ug33HeadAllowableMpa: Number(ug33HeadAllowableMpa.toFixed(4)),
      governingCase,
    },
  };
}

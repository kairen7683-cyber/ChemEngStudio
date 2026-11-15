// =====================================================================
// 패킹타워 설계 계산 엔진 (Facade -> lib/calculations/absorptionTowerDesign.ts)
// Billet-Schultes (1999) + Onda (1968) + Eckert GPDC 통합 엔진
// =====================================================================

import {
  PACKING_CATALOG,
  solveAbsorptionColumn,
} from './calculations/absorptionTowerDesign';

// ─────────────────────────────────────────────────────────────────────
// 패킹 물성 데이터 (PACKING_CATALOG 기반 재수출 — 100% 하위 호환)
// ─────────────────────────────────────────────────────────────────────
export interface PackingData {
  key: string;
  name: string;
  size_mm: number;      // 공칭 크기 (mm)
  /** 비표면적 ap (m²/m³) */
  ap: number;
  /** 공극률 ε (void fraction) */
  voidFraction: number;
  /** HETP (m) — 레퍼런스 조건 기준 */
  HETP_ref: number;
  /** Packing factor Fp (ft⁻¹) — GPDC chart용 */
  packingFactor: number;
}

export const PACKING_DB: PackingData[] = Object.values(PACKING_CATALOG).map((spec) => ({
  key: spec.key,
  name: spec.name,
  size_mm: spec.category === 'structured' && spec.key.startsWith('mellapak_') ? 0 : spec.size_mm,
  ap: spec.ap,
  voidFraction: spec.voidFraction,
  HETP_ref: spec.HETP_ref,
  packingFactor: spec.packingFactor,
}));

// ─────────────────────────────────────────────────────────────────────
// 운전 유형
// ─────────────────────────────────────────────────────────────────────
export type TowerMode =
  | 'absorption'   // 기체 → 액체로 성분 흡수
  | 'stripping'    // 액체 → 기체로 성분 탈거
  | 'scrubbing';   // 기체 세정 (불순물 제거)

// ─────────────────────────────────────────────────────────────────────
// 입력 인터페이스
// ─────────────────────────────────────────────────────────────────────
export interface PackingTowerInputs {
  mode: TowerMode;
  /** 운전 온도 (°C) */
  temperature_C: number;
  /** 운전 압력 (kPa abs) */
  pressure_kPa: number;

  // ── 기상 (Gas) ──────────────────────────────────────────────────
  /** 기체 질량유량 (kg/h) */
  gasFlow_kgh: number;
  /** 기체 밀도 (kg/m³) */
  gasDensity_kgm3: number;
  /** 기체 점도 (mPa·s) */
  gasViscosity_mPas: number;

  // ── 액상 (Liquid) ───────────────────────────────────────────────
  /** 액체 질량유량 (kg/h) */
  liquidFlow_kgh: number;
  /** 액체 밀도 (kg/m³) */
  liquidDensity_kgm3: number;
  /** 액체 점도 (mPa·s) */
  liquidViscosity_mPas: number;
  /** 액체 표면장력 (mN/m) */
  surfaceTension_mNm: number;

  // ── 분리 요구사항 ────────────────────────────────────────────────
  /** 이론단수 (theoretical stages) — NTU 대신 사용 가능 */
  theoreticalStages?: number;
  /**
   * 물질전달 단위수 NTU — 이론단수와 병행 입력
   * absorption: NTU = ln((yin/yout)*(1-1/A) + 1/A) / (1-1/A)  [Kremser]
   */
  NTU?: number;
  /** 입구 기체 성분 농도 (mol fraction y1) */
  y_in?: number;
  /** 출구 기체 성분 농도 목표 (mol fraction y2) */
  y_out?: number;
  /** 액상 평형 기상 몰분율 y_i (황산 탈수탑 등 N_OG = ln((y1 - yi)/(y2 - yi)) 계산용) */
  y_eq?: number;
  /** 흡수 인자 A = L*H / (G*mH) — 흡수 평형 상수 기반 */
  absorptionFactor?: number;
  /** 황산탈수탑 등 기준 공탑유속 (m/s) 지정 시 유속 고정 설계 (예: 표 1.39 U = 0.24 m/s) */
  targetSuperficialVelocity_ms?: number;
  /** 기준 충진층고 Z (m) 지정 시 Z 고정 후 H_OG = Z / N_OG 및 K_Ga 역산 (예: 표 1.39 Z = 3.65 m) */
  fixedPackingHeight_m?: number;

  // ── 패킹 선택 ────────────────────────────────────────────────────
  packingKey: string;
  /** 설계 홍수점 비율 (0.65~0.80) */
  floodingFraction: number;
  /** HETP 보정 계수 (1.0 = 기본) */
  HETP_correction: number;
}

// ─────────────────────────────────────────────────────────────────────
// 결과 인터페이스
// ─────────────────────────────────────────────────────────────────────
export interface PackingTowerResults {
  // ── 기본 데이터 ──────────────────────────────────────────────────
  L_G_ratio: number;          // 액/기 질량유량비
  /** Cs 인자 (flooding 기준) */
  Cs_flood: number;
  Cs_operating: number;
  /** 기체 superficial velocity at flood (m/s) */
  u_flood_ms: number;
  u_operating_ms: number;

  // ── 타워 직경 ────────────────────────────────────────────────────
  tower_diameter_m: number;
  tower_diameter_mm: number;
  /** 표준 직경으로 반올림 (mm) */
  tower_diameter_std_mm: number;
  /** 탑 단면적 S (m²) */
  crossSectionArea_m2: number;

  // ── 이론단수 / NTU(N_OG) / H_OG / K_Ga / 패킹 높이 ───────────────
  theoreticalStages: number;
  NTU: number;
  HETP_m: number;
  /** 기상 기준 총괄 물질전달단위높이 H_OG = Z / N_OG (m) */
  H_OG_m: number;
  /** 기체 몰유량 G_M (kmol/h) */
  G_M_kmolh: number;
  /** 기체 비질량유량 G' (kg/m²·h) */
  gasMassFlux_kgm2h: number;
  /** 액체 비질량유량 L' (kg/m²·h) */
  liquidMassFlux_kgm2h: number;
  /** 총괄용량계수 K_Ga = (G_M · N_OG) / (S · Z) (kmol/m³·h) */
  K_Ga_kmolm3h: number;
  packingHeight_m: number;
  /** 총 타워 높이 (패킹 + 상하 분산부 공간) */
  totalHeight_m: number;

  // ── 압력강하 ─────────────────────────────────────────────────────
  /** 패킹 단위높이당 압력강하 (Pa/m) */
  dP_per_m_Pa: number;
  /** 전체 패킹 압력강하 (kPa) */
  dP_total_kPa: number;
  /** 전체 패킹 압력강하 (mmH2O) */
  dP_packing_mmH2O: number;
  /** 다공판(Support Grid / 目皿部) 압력강하 (mmH2O) */
  dP_supportPlate_mmH2O: number;

  // ── 액체 부하율 ──────────────────────────────────────────────────
  /** 액체 superficial velocity (m/s) */
  liquidVelocity_ms: number;
  /** 액체 비표면유량 (m³/m²·h) */
  liquidFlux_m3m2h: number;
}

// ─────────────────────────────────────────────────────────────────────
// 패킹타워 설계 계산 메인 함수 (Routes through Billet-Schultes + Onda + Eckert)
// ─────────────────────────────────────────────────────────────────────
export function calcPackingTower(inputs: PackingTowerInputs): PackingTowerResults {
  const {
    gasFlow_kgh: G,
    liquidFlow_kgh: L,
    gasDensity_kgm3: rhoG,
    liquidDensity_kgm3: rhoL,
  } = inputs;

  const mwGasEst = Math.min(
    180,
    Math.max(2.0, (rhoG * 8.31446 * (inputs.temperature_C + 273.15)) / Math.max(10, inputs.pressure_kPa)),
  );

  // If neither y_in/y_out nor NTU provided, preserve default NTU=3 behavior
  const useDefaultNtu =
    inputs.NTU == null &&
    !(inputs.y_in != null && inputs.y_out != null && (inputs.y_eq != null || inputs.absorptionFactor != null));

  const res = solveAbsorptionColumn(
    {
      abs_service: inputs.mode,
      pack_key: inputs.packingKey,
      P_col_bar: inputs.pressure_kPa / 100.0,
      flood_pct: inputs.floodingFraction * 100.0,
      Wg_kgh: G,
      Wl_kgh: L,
      Tg_C: inputs.temperature_C,
      Tl_C: inputs.temperature_C,
      rhoV_override: rhoG,
      rhoL_override: rhoL,
      muL_cP_override: inputs.liquidViscosity_mPas,
      muG_mPas_override: inputs.gasViscosity_mPas,
      sigma_mNm_override: inputs.surfaceTension_mNm,
      mwGas_override: mwGasEst,
      y_in_frac: inputs.y_in,
      y_out_frac: inputs.y_out,
      y_eq_frac: inputs.y_eq,
      yin_ppm: inputs.y_in != null ? inputs.y_in * 1e6 : undefined,
      yout_ppm: inputs.y_out != null ? Math.max(0.05, inputs.y_out * 1e6) : undefined,
      absorptionFactor_override: inputs.absorptionFactor,
      NTU_override: useDefaultNtu ? 3 : inputs.NTU,
      theoreticalStages_override: inputs.theoreticalStages,
      hetpCorrection: inputs.HETP_correction,
      targetSuperficialVelocity_ms: inputs.targetSuperficialVelocity_ms,
      fixedPackingHeight_m: inputs.fixedPackingHeight_m,
    },
    'rigorous',
  );

  const A_actual = res.crossSectionArea_m2;
  const u_actual = res.u_op;
  const Z_packing = res.H_pack_total_m;
  const G_M_kmolh = G / Math.max(2, mwGasEst);
  const K_Ga_kmolm3h = (G_M_kmolh * res.N_OG) / Math.max(0.01, A_actual * Z_packing);

  const dP_per_m = res.dP_pack_Pa_m;
  const dP_total_kPa = (dP_per_m * Z_packing) / 1000.0;
  const dP_packing_mmH2O = dP_total_kPa * 101.972;
  const dP_supportPlate_mmH2O = Math.max(5, Math.round(15.0 * rhoG * u_actual * u_actual * 10) / 10);

  const L_ms = L / 3600 / rhoL;
  const liquidVelocity = L_ms / A_actual;
  const liquidFlux = liquidVelocity * 3600;
  const rhoTerm = Math.sqrt(rhoG / Math.max(1, rhoL - rhoG));

  return {
    L_G_ratio: L / G,
    Cs_flood: res.u_flood * rhoTerm,
    Cs_operating: u_actual * rhoTerm,
    u_flood_ms: res.u_flood,
    u_operating_ms: u_actual,

    tower_diameter_m: res.D_col_raw_m,
    tower_diameter_mm: res.D_col_raw_m * 1000,
    tower_diameter_std_mm: res.D_std_mm,
    crossSectionArea_m2: A_actual,

    theoreticalStages: inputs.theoreticalStages ?? Math.max(1, Math.round(res.N_OG * 10) / 10),
    NTU: res.N_OG,
    HETP_m: res.HETP_m,
    H_OG_m: res.HTU_OG_m,
    G_M_kmolh,
    gasMassFlux_kgm2h: G / A_actual,
    liquidMassFlux_kgm2h: L / A_actual,
    K_Ga_kmolm3h,
    packingHeight_m: Z_packing,
    totalHeight_m: Z_packing + 4.0,

    dP_per_m_Pa: dP_per_m,
    dP_total_kPa,
    dP_packing_mmH2O,
    dP_supportPlate_mmH2O,

    liquidVelocity_ms: liquidVelocity,
    liquidFlux_m3m2h: liquidFlux,
  };
}

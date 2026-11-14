// =====================================================================
// 패킹타워 설계 계산 엔진 (Packing Tower Design Engine)
// =====================================================================

// ─────────────────────────────────────────────────────────────────────
// 패킹 물성 데이터
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

export const PACKING_DB: PackingData[] = [
  { key: 'tellerette_1b', name: '1B Tellerette (테라렛 45×19mm, PVC/PVDF)', size_mm: 45, ap: 190, voidFraction: 0.87, HETP_ref: 0.55, packingFactor: 18 },
  { key: 'tellerette_2k', name: '2K Tellerette (테라렛 70×25mm, PVC/PVDF)', size_mm: 70, ap: 112, voidFraction: 0.92, HETP_ref: 0.72, packingFactor: 12 },
  { key: 'raschig_50', name: '2B Raschig Ring 50×50mm (라시히링 2")',        size_mm: 50, ap: 95,  voidFraction: 0.79, HETP_ref: 0.95, packingFactor: 37 },
  { key: 'raschig_25', name: '1B Raschig Ring 25×25mm (라시히링 1")',        size_mm: 25, ap: 190, voidFraction: 0.73, HETP_ref: 0.50, packingFactor: 65 },
  { key: 'pall_25',    name: 'Pall Ring 25mm',       size_mm: 25, ap: 205, voidFraction: 0.94, HETP_ref: 0.40, packingFactor: 45 },
  { key: 'pall_38',    name: 'Pall Ring 38mm',       size_mm: 38, ap: 130, voidFraction: 0.95, HETP_ref: 0.55, packingFactor: 28 },
  { key: 'pall_50',    name: 'Pall Ring 50mm',       size_mm: 50, ap: 100, voidFraction: 0.96, HETP_ref: 0.70, packingFactor: 20 },
  { key: 'intx_50',    name: 'Intalox Saddle 50mm',  size_mm: 50, ap: 108, voidFraction: 0.78, HETP_ref: 0.60, packingFactor: 21 },
  { key: 'mellapak_250y', name: 'Mellapak 250Y (structured)', size_mm: 0, ap: 250, voidFraction: 0.97, HETP_ref: 0.28, packingFactor: 9 },
  { key: 'mellapak_125y', name: 'Mellapak 125Y (structured)', size_mm: 0, ap: 125, voidFraction: 0.98, HETP_ref: 0.45, packingFactor: 6 },
];

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
// GPDC (Generalized Pressure Drop Correlation) — Eckert 상관식
// Cs,flood = C1 * (Fp)^(-0.5) based on simplified GPDC
// ─────────────────────────────────────────────────────────────────────
function calcCsFlood(
  packingFactor: number,   // Fp (ft⁻¹)
  liquidDensity: number,   // kg/m³
  gasDensity: number,      // kg/m³
  liquidViscosity: number, // mPa·s
  L_G: number,             // 질량 유량비
): number {
  // Simplified Bain-Hougen GPDC: Cs,flood ≈ f(Fp, liquid/gas ratio)
  // Using empirical fit: Cs,flood = (0.171/√Fp) × (ρL/ρG)^0.3 × μL^(-0.05)
  // Reference: Kister, H.Z., Distillation Design (1992)
  const Cs_base = 0.171 / Math.sqrt(packingFactor);
  const density_correction = Math.pow(liquidDensity / gasDensity, 0.1);
  const viscosity_correction = Math.pow(liquidViscosity, -0.05);
  // Flow parameter correction (from GPDC X-axis)
  const X = L_G * Math.sqrt(gasDensity / liquidDensity);
  const X_corr = Math.pow(1 + 0.25 * X, -0.3);
  return Cs_base * density_correction * viscosity_correction * X_corr;
}

// ─────────────────────────────────────────────────────────────────────
// Ergun 방정식으로 패킹 압력강하 계산
// ─────────────────────────────────────────────────────────────────────
function calcPackingDeltaP(
  u_g: number,        // m/s 기체 superficial velocity
  gasDensity: number, // kg/m³
  gasViscosity: number, // mPa·s
  ap: number,         // m²/m³
  voidFraction: number,
): number {
  // Modified Ergun equation for packed beds
  const mu = gasViscosity / 1000;  // Pa·s
  const eps = voidFraction;
  const Dp = 6 / ap;  // equivalent particle diameter (m)
  const term1 = 150 * mu * u_g * (1 - eps) ** 2 / (Dp * Dp * eps ** 3);
  const term2 = 1.75 * gasDensity * u_g ** 2 * (1 - eps) / (Dp * eps ** 3);
  return term1 + term2;  // Pa/m
}

// ─────────────────────────────────────────────────────────────────────
// 표준 타워 직경 반올림 (100mm 간격)
// ─────────────────────────────────────────────────────────────────────
const STD_TOWER_DIAMETERS = [
  300, 400, 500, 600, 700, 800, 900, 1000,
  1100, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000,
  3200, 3400, 3600, 3800, 4000,
];

function roundToStdDiameter(D_mm: number): number {
  return STD_TOWER_DIAMETERS.find(d => d >= D_mm) ?? Math.ceil(D_mm / 100) * 100;
}

// ─────────────────────────────────────────────────────────────────────
// Kremser 방정식으로 NTU 계산
// ─────────────────────────────────────────────────────────────────────
function kremserNTU(y_in: number, y_out: number, A: number): number {
  if (A === 1.0) {
    return (y_in - y_out) / y_out;
  }
  const numerator = Math.log((y_in / y_out) * (1 - 1 / A) + 1 / A);
  return numerator / Math.log(A);
}

// ─────────────────────────────────────────────────────────────────────
// 패킹타워 설계 계산 메인 함수
// ─────────────────────────────────────────────────────────────────────
export function calcPackingTower(inputs: PackingTowerInputs): PackingTowerResults {
  const packing = PACKING_DB.find(p => p.key === inputs.packingKey) ?? PACKING_DB[0];

  const {
    gasFlow_kgh: G, liquidFlow_kgh: L,
    gasDensity_kgm3: rhoG, liquidDensity_kgm3: rhoL,
    liquidViscosity_mPas: muL, floodingFraction: ff,
  } = inputs;

  const L_G = L / G;

  // ── 홍수점 계산 (GPDC) ──────────────────────────────────────────
  const Cs_flood = calcCsFlood(packing.packingFactor, rhoL, rhoG, muL, L_G);

  // Cs = u_flood * sqrt(rhoG / (rhoL - rhoG))
  const rho_term = Math.sqrt(rhoG / (rhoL - rhoG));
  const u_flood = Cs_flood / rho_term;  // m/s

  const Cs_operating = Cs_flood * ff;
  const u_operating  = (inputs.targetSuperficialVelocity_ms && inputs.targetSuperficialVelocity_ms > 0)
    ? inputs.targetSuperficialVelocity_ms
    : u_flood * ff;

  // ── 타워 직경 ────────────────────────────────────────────────────
  const G_ms = G / 3600;  // kg/s
  const A_tower = G_ms / (rhoG * u_operating);  // m²
  const D_m = Math.sqrt(4 * A_tower / Math.PI);
  const D_mm = D_m * 1000;
  // 기준 공탑유속 지정 시 계산 단면적(예: S = 1.085 m² -> D = 1175 mm) 또는 표준 직경 반영
  const D_std = inputs.targetSuperficialVelocity_ms ? Math.round(D_mm / 5) * 5 : roundToStdDiameter(D_mm);
  const D_actual_m = D_std / 1000;
  const A_actual = inputs.targetSuperficialVelocity_ms ? A_tower : (Math.PI * D_actual_m ** 2 / 4);

  // 실제 유속 재계산
  const u_actual = G_ms / (rhoG * A_actual);

  // ── NTU (N_OG) 계산 ──────────────────────────────────────────────
  let NTU = inputs.NTU ?? 3;  // 기본값
  if (inputs.y_in != null && inputs.y_out != null && inputs.y_eq != null) {
    // 식염전해 프로세스 기술 표 1.39 기준: N_OG = ln((y1 - yi) / (y2 - yi))
    const num = Math.max(1e-9, inputs.y_in - inputs.y_eq);
    const den = Math.max(1e-9, inputs.y_out - inputs.y_eq);
    NTU = Math.max(0.1, Math.log(num / den));
  } else if (inputs.y_in != null && inputs.y_out != null && inputs.absorptionFactor != null) {
    NTU = kremserNTU(inputs.y_in, inputs.y_out, inputs.absorptionFactor);
  }

  // 이론단수: 정수 입력이 있으면 우선 사용, 없으면 NTU로 추정
  const stages = inputs.theoreticalStages ?? Math.max(1, Math.round(NTU * 10) / 10);

  // ── HETP / H_OG 및 패킹 높이 ─────────────────────────────────────
  // HETP 보정: Onda 상관식 근사 — 표면장력, 점도 효과
  const sigma_correction = Math.pow(inputs.surfaceTension_mNm / 72, 0.2);
  const mu_correction    = Math.pow(muL / 1.0, 0.15);
  const HETP = packing.HETP_ref * inputs.HETP_correction * sigma_correction * mu_correction;

  const Z_packing = (inputs.fixedPackingHeight_m && inputs.fixedPackingHeight_m > 0)
    ? inputs.fixedPackingHeight_m
    : stages * HETP;

  const H_OG = Z_packing / Math.max(0.05, NTU);

  // 기체 몰유량 G_M (Cl2 기준 MW=70.906, 일반 기체는 이상기체 밀도 역산) 및 총괄용량계수 K_Ga
  const G_M_kmolh = G / 70.906;
  const gasMassFlux_kgm2h = G / A_actual;
  const liquidMassFlux_kgm2h = L / A_actual;
  const K_Ga_kmolm3h = (G_M_kmolh * NTU) / Math.max(0.01, A_actual * Z_packing);

  // 총 타워 높이: 패킹 + 상부 분산 공간 1.5m + 하부 집액조 1.5m + 입출구 0.5m씩
  const totalHeight = Z_packing + 4.0;

  // ── 압력강하 계산 ────────────────────────────────────────────────
  const dP_per_m = calcPackingDeltaP(u_actual, rhoG, inputs.gasViscosity_mPas, packing.ap, packing.voidFraction);
  const dP_total_kPa = (dP_per_m * Z_packing) / 1000;
  const dP_packing_mmH2O = dP_total_kPa * 101.972;
  const dP_supportPlate_mmH2O = Math.max(5, Math.round((15.0 * rhoG * u_actual * u_actual) * 10) / 10);

  // ── 액체 부하율 ──────────────────────────────────────────────────
  const L_ms  = (L / 3600) / rhoL;  // m³/s
  const liquidVelocity = L_ms / A_actual;
  const liquidFlux = liquidVelocity * 3600;  // m³/m²·h

  return {
    L_G_ratio: L_G,
    Cs_flood,
    Cs_operating,
    u_flood_ms: u_flood,
    u_operating_ms: u_actual,

    tower_diameter_m: D_m,
    tower_diameter_mm: D_mm,
    tower_diameter_std_mm: D_std,
    crossSectionArea_m2: A_actual,

    theoreticalStages: stages,
    NTU,
    HETP_m: HETP,
    H_OG_m: H_OG,
    G_M_kmolh,
    gasMassFlux_kgm2h,
    liquidMassFlux_kgm2h,
    K_Ga_kmolm3h,
    packingHeight_m: Z_packing,
    totalHeight_m: totalHeight,

    dP_per_m_Pa: dP_per_m,
    dP_total_kPa,
    dP_packing_mmH2O,
    dP_supportPlate_mmH2O,

    liquidVelocity_ms: liquidVelocity,
    liquidFlux_m3m2h: liquidFlux,
  };
}

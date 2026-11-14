// =====================================================================
// 전해공장 유체 물성 데이터베이스
// Chlor-Alkali Plant Physical Properties Database
// =====================================================================

export interface FluidProps {
  key: string;
  name: string;
  nameKo: string;
  /** 기준 온도 (°C) */
  T_ref: number;
  /** 밀도 (kg/m³) at T_ref */
  density_ref: number;
  /** 동점도 (mPa·s = cP) at T_ref */
  viscosity_ref: number;
  /** 비열 (kJ/kg·K) */
  Cp: number;
  /** 열전도도 (W/m·K) */
  k_thermal?: number;
  /** 증기압 (kPa) at T_ref */
  vaporPressure_ref?: number;
  /** 증기압 Antoine 계수 (log10 Pv = A - B/(C+T), Pv in kPa, T in °C) */
  antoine?: { A: number; B: number; C: number };
  /** 밀도 온도 계수 (kg/m³/°C, 선형 근사) */
  dRho_dT?: number;
  /** 점도 온도 계수 (mPa·s/°C, 선형 근사) */
  dMu_dT?: number;
  phase: 'L' | 'G';
  /** 분자량 (기체·냉매용) */
  MW?: number;
  /** 대기압 정상 비점 (°C) */
  Tb_C?: number;
  /** 표준 기화잠열 ΔH_vap (kJ/kg @ Tb) */
  latentHeat_kJkg?: number;
  /** 표면장력 (mN/m) at T_ref - 타워 설계용 */
  surfaceTension?: number;
  /** 냉매 여부 구분 */
  isRefrigerant?: boolean;
  /** 염소 다운스트림 확장 타겟 분류 (1A: HCl/AHCl, 1B: 무기염소/에칭재생, 2: ECH 유기염소) */
  downstreamGroup?: '1A_HCL' | '1B_INORG' | '2_ECH';
}

// ─────────────────────────────────────────────────────────────────────
// 온도 보정 함수
// ─────────────────────────────────────────────────────────────────────

/** 밀도 온도 보정 (선형 근사) */
export function densityAtT(fluid: FluidProps, T_C: number): number {
  const dRho = fluid.dRho_dT ?? -0.5;
  return fluid.density_ref + dRho * (T_C - fluid.T_ref);
}

/** 점도 온도 보정 (Andrade 방정식 근사: μ = μ_ref × exp(A×(1/T - 1/T_ref))) */
export function viscosityAtT(fluid: FluidProps, T_C: number): number {
  if (fluid.phase === 'G') {
    // 기체: Sutherland 근사 — 온도 상승 시 점도 증가
    const T_K = T_C + 273.15;
    const T0_K = fluid.T_ref + 273.15;
    return fluid.viscosity_ref * Math.pow(T_K / T0_K, 0.7);
  }
  const dMu = fluid.dMu_dT ?? -0.02;
  const mu = fluid.viscosity_ref + dMu * (T_C - fluid.T_ref);
  return Math.max(0.1, mu);  // 최솟값 보정
}

/** Antoine 방정식으로 증기압 계산 (kPa) */
export function vaporPressure_kPa(fluid: FluidProps, T_C: number): number {
  if (!fluid.antoine) return fluid.vaporPressure_ref ?? 0;
  const { A, B, C } = fluid.antoine;
  return Math.pow(10, A - B / (C + T_C));
}

// ─────────────────────────────────────────────────────────────────────
// 전해공장 유체 물성 데이터
// ─────────────────────────────────────────────────────────────────────

export const FLUID_DB: Record<string, FluidProps> = {
  // ── 액상 ──────────────────────────────────────────────────────────
  brine_25: {
    key: 'brine_25',
    name: 'NaCl brine 25wt%',
    nameKo: '포화브라인 (25%)',
    T_ref: 25, density_ref: 1172, viscosity_ref: 1.80,
    Cp: 3.47, k_thermal: 0.59,
    vaporPressure_ref: 2.8,   // kPa (vapor pressure slightly depressed by NaCl)
    antoine: { A: 8.071, B: 1730.6, C: 233.4 },  // approximate
    dRho_dT: -0.45, dMu_dT: -0.025,
    phase: 'L', surfaceTension: 72.5,
  },
  brine_15: {  // 약 15 wt% NaCl — 포화조 출구, 희박 브라인
    key: 'brine_15',
    name: 'NaCl brine 15wt%',
    nameKo: '희박브라인 (15%)',
    T_ref: 70, density_ref: 1085, viscosity_ref: 0.60,
    Cp: 3.78, k_thermal: 0.62,
    vaporPressure_ref: 31.0,
    dRho_dT: -0.40, dMu_dT: -0.012,
    phase: 'L', surfaceTension: 71.0,
  },
  brine_fed: {  // refined brine to electrolyzer ~26% at 60-70°C
    key: 'brine_fed',
    name: 'Refined brine 26wt%',
    nameKo: '정제브라인 (26%)',
    T_ref: 65, density_ref: 1168, viscosity_ref: 0.90,
    Cp: 3.40, k_thermal: 0.57,
    vaporPressure_ref: 25.0,
    dRho_dT: -0.45, dMu_dT: -0.015,
    phase: 'L', surfaceTension: 70.0,
  },
  naoh_32: {
    key: 'naoh_32',
    name: 'NaOH 32wt%',
    nameKo: '가성소다 32%',
    T_ref: 25, density_ref: 1340, viscosity_ref: 3.50,
    Cp: 3.14, k_thermal: 0.54,
    vaporPressure_ref: 1.8,
    dRho_dT: -0.70, dMu_dT: -0.08,
    phase: 'L', surfaceTension: 68.0,
  },
  naoh_50: {
    key: 'naoh_50',
    name: 'NaOH 50wt%',
    nameKo: '가성소다 50%',
    T_ref: 25, density_ref: 1525, viscosity_ref: 36.0,
    Cp: 2.79, k_thermal: 0.48,
    vaporPressure_ref: 0.4,
    dRho_dT: -0.90, dMu_dT: -0.80,
    phase: 'L', surfaceTension: 65.0,
  },
  h2so4_60: {
    key: 'h2so4_60',
    name: 'H2SO4 60wt%',
    nameKo: '황산 60% (No.1 건조탑)',
    T_ref: 14, density_ref: 1498, viscosity_ref: 6.2,
    Cp: 2.18, k_thermal: 0.43,
    vaporPressure_ref: 0.45,
    dRho_dT: -0.85, dMu_dT: -0.12,
    phase: 'L', surfaceTension: 69.0,
  },
  h2so4_91: {
    key: 'h2so4_91',
    name: 'H2SO4 91wt%',
    nameKo: '황산 91% (No.2 건조탑)',
    T_ref: 19, density_ref: 1820, viscosity_ref: 21.5,
    Cp: 1.55, k_thermal: 0.36,
    vaporPressure_ref: 0.05,
    dRho_dT: -1.05, dMu_dT: -0.45,
    phase: 'L', surfaceTension: 58.0,
  },
  h2so4_94: {
    key: 'h2so4_94',
    name: 'H2SO4 94wt%',
    nameKo: '황산 94% (No.3 건조탑)',
    T_ref: 21, density_ref: 1831, viscosity_ref: 23.8,
    Cp: 1.48, k_thermal: 0.35,
    vaporPressure_ref: 0.03,
    dRho_dT: -1.08, dMu_dT: -0.50,
    phase: 'L', surfaceTension: 56.0,
  },
  h2so4_98: {
    key: 'h2so4_98',
    name: 'H2SO4 98wt%',
    nameKo: '황산 98%',
    T_ref: 25, density_ref: 1836, viscosity_ref: 26.7,
    Cp: 1.42, k_thermal: 0.35,
    vaporPressure_ref: 0.03,
    dRho_dT: -1.10, dMu_dT: -0.55,
    phase: 'L', surfaceTension: 55.0,
  },
  hcl_31: {
    key: 'hcl_31',
    name: 'HCl 31wt%',
    nameKo: '염산 31%',
    T_ref: 25, density_ref: 1152, viscosity_ref: 1.90,
    Cp: 2.55, k_thermal: 0.45,
    vaporPressure_ref: 8.5,
    dRho_dT: -0.45, dMu_dT: -0.03,
    phase: 'L', surfaceTension: 65.0,
  },
  process_water: {
    key: 'process_water',
    name: 'Process water',
    nameKo: '공정수',
    T_ref: 25, density_ref: 997, viscosity_ref: 0.89,
    Cp: 4.18, k_thermal: 0.61,
    vaporPressure_ref: 3.17,
    antoine: { A: 8.0700, B: 1730.6, C: 233.4 },
    dRho_dT: -0.33, dMu_dT: -0.020,
    phase: 'L', surfaceTension: 72.0,
  },
  cooling_water: {
    key: 'cooling_water',
    name: 'Cooling water',
    nameKo: '냉각수',
    T_ref: 30, density_ref: 995, viscosity_ref: 0.80,
    Cp: 4.18, k_thermal: 0.61,
    vaporPressure_ref: 4.24,
    dRho_dT: -0.33, dMu_dT: -0.018,
    phase: 'L', surfaceTension: 71.0,
  },
  catholyte: {   // catholyte out: dilute NaOH ~33% at 87-90°C
    key: 'catholyte',
    name: 'Catholyte (33% NaOH)',
    nameKo: '음극액 (33% NaOH)',
    T_ref: 87, density_ref: 1290, viscosity_ref: 1.20,
    Cp: 3.10, k_thermal: 0.50,
    vaporPressure_ref: 60.0,
    dRho_dT: -0.65, dMu_dT: -0.03,
    phase: 'L', surfaceTension: 60.0,
  },
  anolyte: {     // anolyte: depleted brine ~16% NaCl at 87°C
    key: 'anolyte',
    name: 'Anolyte (depleted brine)',
    nameKo: '양극액 (탈염 브라인)',
    T_ref: 87, density_ref: 1089, viscosity_ref: 0.65,
    Cp: 3.80, k_thermal: 0.60,
    vaporPressure_ref: 55.0,
    dRho_dT: -0.40, dMu_dT: -0.012,
    phase: 'L', surfaceTension: 68.0,
  },
  // ── 기상 ──────────────────────────────────────────────────────────
  cl2_gas: {
    key: 'cl2_gas',
    name: 'Cl2 gas',
    nameKo: '염소 가스',
    T_ref: 25, density_ref: 2.90, viscosity_ref: 0.0134,  // mPa·s
    Cp: 0.48, k_thermal: 0.0090, MW: 70.9,
    phase: 'G',
  },
  h2_gas: {
    key: 'h2_gas',
    name: 'H2 gas',
    nameKo: '수소 가스',
    T_ref: 25, density_ref: 0.082, viscosity_ref: 0.0089,
    Cp: 14.32, k_thermal: 0.182, MW: 2.016,
    phase: 'G',
  },
  n2_gas: {
    key: 'n2_gas',
    name: 'N2 gas',
    nameKo: '질소 가스',
    T_ref: 25, density_ref: 1.145, viscosity_ref: 0.0178,
    Cp: 1.04, k_thermal: 0.026, MW: 28.01,
    phase: 'G',
  },
  air: {
    key: 'air',
    name: 'Air',
    nameKo: '공기',
    T_ref: 25, density_ref: 1.184, viscosity_ref: 0.0185,
    Cp: 1.005, k_thermal: 0.026, MW: 28.97,
    phase: 'G',
  },

  // ── 산업용 냉매 (Refrigerants — 기액 상변화 · 증발/응축 열교환 설계용) ──
  // Antoine 계수: log10(Pv [kPa]) = A - B / (C + T [°C])
  ref_r134a: {
    key: 'ref_r134a',
    name: 'R-134a (CH₂FCF₃)',
    nameKo: '냉매 R-134a (표준 HFC 칠러·액화용)',
    T_ref: 20, density_ref: 1225, viscosity_ref: 0.205,
    Cp: 1.41, k_thermal: 0.083, MW: 102.03,
    Tb_C: -26.1, latentHeat_kJkg: 217.0,
    antoine: { A: 6.1348, B: 865.0, C: 243.0 },
    dRho_dT: -3.15, dMu_dT: -0.0028,
    phase: 'G', surfaceTension: 8.7, isRefrigerant: true,
  },
  ref_r404a: {
    key: 'ref_r404a',
    name: 'R-404A (R-125/143a/134a)',
    nameKo: '냉매 R-404A (염소 심냉 액화기용)',
    T_ref: 20, density_ref: 1066, viscosity_ref: 0.138,
    Cp: 1.54, k_thermal: 0.066, MW: 97.60,
    Tb_C: -46.5, latentHeat_kJkg: 200.0,
    antoine: { A: 6.1120, B: 778.0, C: 246.0 },
    dRho_dT: -3.65, dMu_dT: -0.0024,
    phase: 'G', surfaceTension: 5.1, isRefrigerant: true,
  },
  ref_r507a: {
    key: 'ref_r507a',
    name: 'R-507A (Azeotropic HFC)',
    nameKo: '냉매 R-507A (공비 저온 액화기용)',
    T_ref: 20, density_ref: 1057, viscosity_ref: 0.134,
    Cp: 1.56, k_thermal: 0.065, MW: 98.86,
    Tb_C: -46.7, latentHeat_kJkg: 196.0,
    antoine: { A: 6.1180, B: 776.5, C: 246.2 },
    dRho_dT: -3.70, dMu_dT: -0.0024,
    phase: 'G', surfaceTension: 4.9, isRefrigerant: true,
  },
  ref_r410a: {
    key: 'ref_r410a',
    name: 'R-410A (R-32/125 50:50)',
    nameKo: '냉매 R-410A (고압 고효율 냉동기용)',
    T_ref: 20, density_ref: 1082, viscosity_ref: 0.130,
    Cp: 1.69, k_thermal: 0.091, MW: 72.58,
    Tb_C: -51.4, latentHeat_kJkg: 272.0,
    antoine: { A: 6.1050, B: 760.0, C: 246.0 },
    dRho_dT: -3.55, dMu_dT: -0.0022,
    phase: 'G', surfaceTension: 6.2, isRefrigerant: true,
  },
  ref_r22: {
    key: 'ref_r22',
    name: 'R-22 (CHClF₂ · HCFC-22)',
    nameKo: '냉매 R-22 (기존 화학플랜트 액화 표준)',
    T_ref: 20, density_ref: 1213, viscosity_ref: 0.175,
    Cp: 1.24, k_thermal: 0.086, MW: 86.47,
    Tb_C: -40.8, latentHeat_kJkg: 233.7,
    antoine: { A: 6.1280, B: 815.0, C: 245.5 },
    dRho_dT: -3.20, dMu_dT: -0.0024,
    phase: 'G', surfaceTension: 8.4, isRefrigerant: true,
  },
  ref_r32: {
    key: 'ref_r32',
    name: 'R-32 (CH₂F₂ · Difluoromethane)',
    nameKo: '냉매 R-32 (저GWP 고효율 냉매)',
    T_ref: 20, density_ref: 981, viscosity_ref: 0.122,
    Cp: 1.82, k_thermal: 0.125, MW: 52.02,
    Tb_C: -51.7, latentHeat_kJkg: 381.0,
    antoine: { A: 6.2280, B: 782.0, C: 246.5 },
    dRho_dT: -3.40, dMu_dT: -0.0020,
    phase: 'G', surfaceTension: 7.5, isRefrigerant: true,
  },
  ref_r1234yf: {
    key: 'ref_r1234yf',
    name: 'R-1234yf (CF₃CF=CH₂ · HFO)',
    nameKo: '친환경 냉매 R-1234yf (초저GWP HFO)',
    T_ref: 20, density_ref: 1110, viscosity_ref: 0.160,
    Cp: 1.37, k_thermal: 0.067, MW: 114.04,
    Tb_C: -29.5, latentHeat_kJkg: 180.0,
    antoine: { A: 6.0250, B: 832.0, C: 244.0 },
    dRho_dT: -3.25, dMu_dT: -0.0023,
    phase: 'G', surfaceTension: 6.8, isRefrigerant: true,
  },
  ref_r1234ze: {
    key: 'ref_r1234ze',
    name: 'R-1234ze(E) (trans-CHF=CHCF₃)',
    nameKo: '친환경 냉매 R-1234ze(E) (터보칠러·히트펌프)',
    T_ref: 20, density_ref: 1178, viscosity_ref: 0.195,
    Cp: 1.38, k_thermal: 0.075, MW: 114.04,
    Tb_C: -19.0, latentHeat_kJkg: 195.5,
    antoine: { A: 6.0950, B: 882.0, C: 242.5 },
    dRho_dT: -3.10, dMu_dT: -0.0026,
    phase: 'G', surfaceTension: 8.9, isRefrigerant: true,
  },
  ref_r717: {
    key: 'ref_r717',
    name: 'R-717 (NH₃ · Ammonia)',
    nameKo: '암모니아 냉매 R-717 (대용량 산업냉동)',
    T_ref: 20, density_ref: 610.3, viscosity_ref: 0.135,
    Cp: 4.74, k_thermal: 0.480, MW: 17.03,
    Tb_C: -33.3, latentHeat_kJkg: 1371.0,
    antoine: { A: 6.4853, B: 926.13, C: 240.17 },
    dRho_dT: -1.45, dMu_dT: -0.0018,
    phase: 'G', surfaceTension: 21.1, isRefrigerant: true,
  },
  ref_r1270: {
    key: 'ref_r1270',
    name: 'R-1270 (C₃H₆ · Propylene)',
    nameKo: '프로필렌 냉매 R-1270 (석유화학 심냉용)',
    T_ref: 20, density_ref: 514, viscosity_ref: 0.110,
    Cp: 2.52, k_thermal: 0.100, MW: 42.08,
    Tb_C: -47.6, latentHeat_kJkg: 437.0,
    antoine: { A: 5.9444, B: 785.0, C: 247.0 },
    dRho_dT: -1.35, dMu_dT: -0.0015,
    phase: 'G', surfaceTension: 7.2, isRefrigerant: true,
  },
  ref_r744: {
    key: 'ref_r744',
    name: 'R-744 (CO₂ · Carbon Dioxide)',
    nameKo: '이산화탄소 냉매 R-744 (캐스케이드 초저온)',
    T_ref: -20, density_ref: 1032, viscosity_ref: 0.140,
    Cp: 2.15, k_thermal: 0.132, MW: 44.01,
    Tb_C: -56.6, latentHeat_kJkg: 348.0,
    antoine: { A: 6.7028, B: 861.8, C: 271.9 },
    dRho_dT: -4.20, dMu_dT: -0.0025,
    phase: 'G', surfaceTension: 4.5, isRefrigerant: true,
  },

  // ── 2차 간접 냉매 브라인 (Secondary Brines) ──
  brine_eg40: {
    key: 'brine_eg40',
    name: 'Ethylene Glycol Brine 40 wt%',
    nameKo: '에틸렌글리콜 냉매 브라인 (40 wt% · -24°C)',
    T_ref: 0, density_ref: 1068, viscosity_ref: 4.85,
    Cp: 3.42, k_thermal: 0.425,
    vaporPressure_ref: 0.42,
    antoine: { A: 7.82, B: 1765, C: 231 },
    dRho_dT: -0.58, dMu_dT: -0.085,
    phase: 'L', surfaceTension: 56.0, isRefrigerant: true,
  },
  brine_cacl2_25: {
    key: 'brine_cacl2_25',
    name: 'CaCl₂ Brine 25 wt%',
    nameKo: '염화칼슘 심냉 브라인 (25 wt% · -29°C)',
    T_ref: -10, density_ref: 1246, viscosity_ref: 5.40,
    Cp: 2.85, k_thermal: 0.515,
    vaporPressure_ref: 0.21,
    antoine: { A: 7.75, B: 1780, C: 232 },
    dRho_dT: -0.52, dMu_dT: -0.095,
    phase: 'L', surfaceTension: 81.0, isRefrigerant: true,
  },

  // ── [1A 타겟] 초고순도·무수 염산(AHCl) & 폐염산 공비증류 회수 계통 ──────────────────
  ahcl_gas: {
    key: 'ahcl_gas',
    name: 'Anhydrous HCl Gas (99.999% 5N)',
    nameKo: '무수염화수소 5N 가스 (반도체 에칭급)',
    T_ref: 25, density_ref: 1.49, viscosity_ref: 0.0146,
    Cp: 0.80, k_thermal: 0.0145,
    vaporPressure_ref: 4720.0,
    antoine: { A: 6.556, B: 745.8, C: 258.8 },
    phase: 'G', MW: 36.461, Tb_C: -85.05, latentHeat_kJkg: 443.0,
    downstreamGroup: '1A_HCL',
  },
  ahcl_liq: {
    key: 'ahcl_liq',
    name: 'Liquid Anhydrous HCl (High-Pressure)',
    nameKo: '액화 무수염산 (-20°C · 15 barA 충전)',
    T_ref: -20, density_ref: 1005, viscosity_ref: 0.19,
    Cp: 1.62, k_thermal: 0.24,
    vaporPressure_ref: 1480.0,
    antoine: { A: 6.556, B: 745.8, C: 258.8 },
    dRho_dT: -2.65, dMu_dT: -0.0025,
    phase: 'L', MW: 36.461, Tb_C: -85.05, latentHeat_kJkg: 443.0, surfaceTension: 16.5,
    downstreamGroup: '1A_HCL',
  },
  hcl_35_up: {
    key: 'hcl_35_up',
    name: 'Electronic-Grade HCl 35 wt%',
    nameKo: '초고순도 전자급 염산 (35 wt% · UPW 흡수)',
    T_ref: 25, density_ref: 1174, viscosity_ref: 2.10,
    Cp: 2.43, k_thermal: 0.44,
    vaporPressure_ref: 18.5,
    antoine: { A: 7.42, B: 1580, C: 228.0 },
    dRho_dT: -0.52, dMu_dT: -0.032,
    phase: 'L', MW: 22.2, Tb_C: 61.0, latentHeat_kJkg: 1850.0, surfaceTension: 63.5,
    downstreamGroup: '1A_HCL',
  },
  hcl_20_azeo: {
    key: 'hcl_20_azeo',
    name: 'HCl-H2O Azeotrope 20.2 wt%',
    nameKo: '폐염산 공비조성액 (20.2 wt% · 상압 108.6°C)',
    T_ref: 25, density_ref: 1098, viscosity_ref: 1.38,
    Cp: 3.08, k_thermal: 0.51,
    vaporPressure_ref: 2.1,
    antoine: { A: 7.21, B: 1795, C: 231.0 },
    dRho_dT: -0.42, dMu_dT: -0.022,
    phase: 'L', MW: 20.1, Tb_C: 108.6, latentHeat_kJkg: 2120.0, surfaceTension: 68.0,
    downstreamGroup: '1A_HCL',
  },

  // ── [1B 타겟] 고농도 NaOCl · FeCl₃ 에칭액 염소재생 · PAC 무기염소 유도품 ──────────
  naocl_12: {
    key: 'naocl_12',
    name: 'Sodium Hypochlorite 12 wt%',
    nameKo: '차아염소산소다 표준액 (12 wt% NaOCl)',
    T_ref: 25, density_ref: 1206, viscosity_ref: 2.65,
    Cp: 3.48, k_thermal: 0.55,
    vaporPressure_ref: 2.4,
    dRho_dT: -0.55, dMu_dT: -0.042,
    phase: 'L', surfaceTension: 73.0,
    downstreamGroup: '1B_INORG',
  },
  naocl_25_hs: {
    key: 'naocl_25_hs',
    name: 'High-Strength Low-Salt NaOCl 25 wt%',
    nameKo: '고농도 저염 차아염소산소다 (25 wt% · 탈염 결정화)',
    T_ref: 18, density_ref: 1318, viscosity_ref: 5.40,
    Cp: 3.12, k_thermal: 0.51,
    vaporPressure_ref: 1.6,
    dRho_dT: -0.68, dMu_dT: -0.085,
    phase: 'L', surfaceTension: 75.0,
    downstreamGroup: '1B_INORG',
  },
  naclo3_40: {
    key: 'naclo3_40',
    name: 'Sodium Chlorate 40 wt%',
    nameKo: '염소산소다 수용액 (40 wt% NaClO₃ · 열분해 부생성물)',
    T_ref: 30, density_ref: 1322, viscosity_ref: 2.35,
    Cp: 2.86, k_thermal: 0.50,
    vaporPressure_ref: 2.6,
    dRho_dT: -0.62, dMu_dT: -0.035,
    phase: 'L', surfaceTension: 74.0,
    downstreamGroup: '1B_INORG',
  },
  fecl2_28: {
    key: 'fecl2_28',
    name: 'Spent Ferrous Chloride Etchant 28 wt%',
    nameKo: '염화제일철 에칭 폐액 (28 wt% FeCl₂ · 재생원료)',
    T_ref: 40, density_ref: 1295, viscosity_ref: 2.95,
    Cp: 2.95, k_thermal: 0.52,
    vaporPressure_ref: 5.8,
    dRho_dT: -0.54, dMu_dT: -0.045,
    phase: 'L', surfaceTension: 72.5,
    downstreamGroup: '1B_INORG',
  },
  fecl3_40: {
    key: 'fecl3_40',
    name: 'Regenerated Ferric Chloride 40 wt%',
    nameKo: '염화제이철 재생 에칭액 (40 wt% FeCl₃ · Cl₂ 산화)',
    T_ref: 45, density_ref: 1418, viscosity_ref: 6.80,
    Cp: 2.64, k_thermal: 0.48,
    vaporPressure_ref: 6.1,
    dRho_dT: -0.65, dMu_dT: -0.11,
    phase: 'L', surfaceTension: 74.5,
    downstreamGroup: '1B_INORG',
  },
  pac_17: {
    key: 'pac_17',
    name: 'Polyaluminum Chloride (17% Al2O3)',
    nameKo: '폴리염화알루미늄 수처리 응집제 (PAC 17%)',
    T_ref: 25, density_ref: 1375, viscosity_ref: 18.5,
    Cp: 2.88, k_thermal: 0.49,
    vaporPressure_ref: 2.5,
    dRho_dT: -0.58, dMu_dT: -0.32,
    phase: 'L', surfaceTension: 71.0,
    downstreamGroup: '1B_INORG',
  },

  // ── [2순위 타겟] 에피클로로히드린(ECH) · 글리세린 GTE 염소화 · 다단 진공증류 ───────
  glycerol: {
    key: 'glycerol',
    name: 'Refined Glycerol (C3H8O3)',
    nameKo: '정제 글리세린 (GTE 원료 · Tb 290.0°C)',
    T_ref: 60, density_ref: 1238, viscosity_ref: 81.0,
    Cp: 2.52, k_thermal: 0.286,
    vaporPressure_ref: 0.002,
    antoine: { A: 7.482, B: 2690.0, C: 175.0 },
    dRho_dT: -0.64, dMu_dT: -1.45,
    phase: 'L', MW: 92.094, Tb_C: 290.0, latentHeat_kJkg: 974.0, surfaceTension: 61.5,
    downstreamGroup: '2_ECH',
  },
  mch_3: {
    key: 'mch_3',
    name: '3-Monochloropropanediol (3-MCH)',
    nameKo: '모노클로로히드린 중간체 (3-MCH · Tb 213.0°C)',
    T_ref: 50, density_ref: 1302, viscosity_ref: 14.2,
    Cp: 2.08, k_thermal: 0.22,
    vaporPressure_ref: 0.08,
    antoine: { A: 7.125, B: 2140.0, C: 196.0 },
    dRho_dT: -0.82, dMu_dT: -0.25,
    phase: 'L', MW: 110.54, Tb_C: 213.0, latentHeat_kJkg: 465.0, surfaceTension: 46.0,
    downstreamGroup: '2_ECH',
  },
  dch_13: {
    key: 'dch_13',
    name: '1,3-Dichloro-2-propanol (1,3-DCH)',
    nameKo: '디클로로히드린 반응생성액 (1,3-DCH · Tb 174.3°C)',
    T_ref: 40, density_ref: 1351, viscosity_ref: 4.85,
    Cp: 1.76, k_thermal: 0.165,
    vaporPressure_ref: 0.35,
    antoine: { A: 6.985, B: 1865.0, C: 204.5 },
    dRho_dT: -0.96, dMu_dT: -0.085,
    phase: 'L', MW: 128.985, Tb_C: 174.3, latentHeat_kJkg: 382.0, surfaceTension: 39.5,
    downstreamGroup: '2_ECH',
  },
  ech_pure: {
    key: 'ech_pure',
    name: 'Epichlorohydrin (ECH 99.9%)',
    nameKo: '에피클로로히드린 (ECH · Tb 116.1°C / 공비 88°C)',
    T_ref: 25, density_ref: 1181, viscosity_ref: 1.03,
    Cp: 1.48, k_thermal: 0.138,
    vaporPressure_ref: 2.25,
    antoine: { A: 6.329, B: 1482.5, C: 222.4 },
    dRho_dT: -1.18, dMu_dT: -0.014,
    phase: 'L', MW: 92.525, Tb_C: 116.1, latentHeat_kJkg: 409.0, surfaceTension: 37.0,
    downstreamGroup: '2_ECH',
  },
  dcp_12: {
    key: 'dcp_12',
    name: '1,2-Dichloropropane (Light Organochlorine Impurity)',
    nameKo: '1,2-디클로로프로판 경질불순물 (1,2-DCP · Tb 96.4°C)',
    T_ref: 25, density_ref: 1156, viscosity_ref: 0.84,
    Cp: 1.32, k_thermal: 0.125,
    vaporPressure_ref: 7.10,
    antoine: { A: 6.082, B: 1308.0, C: 225.2 },
    dRho_dT: -1.24, dMu_dT: -0.011,
    phase: 'L', MW: 112.986, Tb_C: 96.4, latentHeat_kJkg: 318.0, surfaceTension: 29.0,
    downstreamGroup: '2_ECH',
  },
  acetic_cat: {
    key: 'acetic_cat',
    name: 'Glacial Acetic Acid Catalyst (C2H4O2)',
    nameKo: '초산 촉매 (GTE 염소화 균일촉매 · Tb 117.9°C)',
    T_ref: 25, density_ref: 1049, viscosity_ref: 1.12,
    Cp: 2.05, k_thermal: 0.158,
    vaporPressure_ref: 2.07,
    antoine: { A: 6.512, B: 1522.0, C: 220.5 },
    dRho_dT: -1.12, dMu_dT: -0.015,
    phase: 'L', MW: 60.052, Tb_C: 117.9, latentHeat_kJkg: 395.0, surfaceTension: 27.4,
    downstreamGroup: '2_ECH',
  },
};

/** 유체 키 → 물성 조회 (없으면 process_water fallback) */
export function getFluidProps(key: string): FluidProps {
  return FLUID_DB[key] ?? FLUID_DB['process_water'];
}

/** 모든 액상 유체 목록 */
export const LIQUID_FLUIDS = Object.values(FLUID_DB).filter(f => f.phase === 'L');
/** 모든 기상 유체 목록 */
export const GAS_FLUIDS = Object.values(FLUID_DB).filter(f => f.phase === 'G');
/** 전체 유체 목록 */
export const ALL_FLUIDS = Object.values(FLUID_DB);

// ─────────────────────────────────────────────────────────────────────
// 이상기체 밀도 계산
// ─────────────────────────────────────────────────────────────────────
export function gasDensity(MW: number, T_C: number, P_kPa: number): number {
  const R = 8314;  // J/kmol·K
  const T_K = T_C + 273.15;
  return (P_kPa * 1000 * MW) / (R * T_K);  // kg/m³
}

// ─────────────────────────────────────────────────────────────────────
// 배관 재질 조도 (Roughness)
// ─────────────────────────────────────────────────────────────────────
export interface PipeMaterial {
  key: string;
  name: string;
  roughness_mm: number;  // absolute roughness ε in mm
}

export const PIPE_MATERIALS: PipeMaterial[] = [
  { key: 'ss316l',    name: 'SS 316L (스테인리스)',   roughness_mm: 0.046 },
  { key: 'ss304',     name: 'SS 304 (스테인리스)',    roughness_mm: 0.046 },
  { key: 'cs',        name: 'Carbon Steel (탄소강)',  roughness_mm: 0.046 },
  { key: 'cs_rust',   name: 'Carbon Steel (녹)',      roughness_mm: 0.20  },
  { key: 'pvc',       name: 'PVC / PP',               roughness_mm: 0.0015 },
  { key: 'frp',       name: 'FRP / GFRP',             roughness_mm: 0.005 },
  { key: 'titanium',  name: 'Titanium',               roughness_mm: 0.046 },
  { key: 'custom',    name: '직접 입력',              roughness_mm: 0.046 },
];

// ─────────────────────────────────────────────────────────────────────
// 배관 호칭 직경 (ANSI / ASME B36.10M & B36.19M NPS 표준 데이터)
// ─────────────────────────────────────────────────────────────────────
export interface PipeSize {
  DN: number;        // 내부 키(mm 등가치, 하위 호환성 유지)
  NPS: string;       // ANSI / ASME NPS (inch 표기: 1/2", 1", 2", 3", 4"...)
  OD_mm: number;     // 외경 (mm)
  schedule: Record<string, number>;  // 스케줄(Sch 10S, Sch 40, Sch 80, Sch 160) → 두께(mm)
}

export const PIPE_SIZES: PipeSize[] = [
  { DN: 15,  NPS: '1/2"',   OD_mm: 21.3,  schedule: { '10S': 2.11, '40': 2.77, '40S': 2.77, '80': 3.73, '80S': 3.73, '160': 4.78 } },
  { DN: 20,  NPS: '3/4"',   OD_mm: 26.7,  schedule: { '10S': 2.11, '40': 2.87, '40S': 2.87, '80': 3.91, '80S': 3.91, '160': 5.56 } },
  { DN: 25,  NPS: '1"',     OD_mm: 33.4,  schedule: { '10S': 2.77, '40': 3.38, '40S': 3.38, '80': 4.55, '80S': 4.55, '160': 6.35 } },
  { DN: 32,  NPS: '1-1/4"', OD_mm: 42.2,  schedule: { '10S': 2.77, '40': 3.56, '40S': 3.56, '80': 4.85, '80S': 4.85, '160': 6.35 } },
  { DN: 40,  NPS: '1-1/2"', OD_mm: 48.3,  schedule: { '10S': 2.77, '40': 3.68, '40S': 3.68, '80': 5.08, '80S': 5.08, '160': 7.14 } },
  { DN: 50,  NPS: '2"',     OD_mm: 60.3,  schedule: { '10S': 2.77, '40': 3.91, '40S': 3.91, '80': 5.54, '80S': 5.54, '160': 8.74 } },
  { DN: 65,  NPS: '2-1/2"', OD_mm: 73.0,  schedule: { '10S': 3.05, '40': 5.16, '40S': 5.16, '80': 7.01, '80S': 7.01, '160': 9.53 } },
  { DN: 80,  NPS: '3"',     OD_mm: 88.9,  schedule: { '10S': 3.05, '40': 5.49, '40S': 5.49, '80': 7.62, '80S': 7.62, '160': 11.13 } },
  { DN: 100, NPS: '4"',     OD_mm: 114.3, schedule: { '10S': 3.05, '40': 6.02, '40S': 6.02, '80': 8.56, '80S': 8.56, '160': 13.49 } },
  { DN: 125, NPS: '5"',     OD_mm: 141.3, schedule: { '10S': 3.40, '40': 6.55, '40S': 6.55, '80': 9.52, '80S': 9.52, '160': 15.88 } },
  { DN: 150, NPS: '6"',     OD_mm: 168.3, schedule: { '10S': 3.40, '40': 7.11, '40S': 7.11, '80': 10.97, '80S': 10.97, '160': 18.26 } },
  { DN: 200, NPS: '8"',     OD_mm: 219.1, schedule: { '10S': 3.76, '40': 8.18, '40S': 8.18, '80': 12.70, '80S': 12.70, '160': 23.01 } },
  { DN: 250, NPS: '10"',    OD_mm: 273.1, schedule: { '10S': 4.19, '40': 9.27, '40S': 9.27, '80': 15.09, '80S': 12.70, '160': 28.58 } },
  { DN: 300, NPS: '12"',    OD_mm: 323.9, schedule: { '10S': 4.57, '40': 10.31, '40S': 9.52, '80': 17.48, '80S': 12.70, '160': 33.32 } },
  { DN: 350, NPS: '14"',    OD_mm: 355.6, schedule: { '10S': 4.78, '40': 11.13, '40S': 9.52, '80': 19.05, '80S': 12.70, '160': 35.71 } },
  { DN: 400, NPS: '16"',    OD_mm: 406.4, schedule: { '10S': 4.78, '40': 12.70, '40S': 9.52, '80': 21.44, '80S': 12.70, '160': 40.49 } },
  { DN: 450, NPS: '18"',    OD_mm: 457.2, schedule: { '10S': 4.78, '40': 14.27, '40S': 9.52, '80': 23.83, '80S': 12.70, '160': 45.24 } },
  { DN: 500, NPS: '20"',    OD_mm: 508.0, schedule: { '10S': 5.54, '40': 15.09, '40S': 9.52, '80': 26.19, '80S': 12.70, '160': 50.01 } },
  { DN: 600, NPS: '24"',    OD_mm: 609.6, schedule: { '10S': 6.35, '40': 17.48, '40S': 9.52, '80': 30.96, '80S': 12.70, '160': 59.54 } },
];

/** ID (내경, mm) 계산 — ASME B36.10M / B36.19M 기준 */
export function pipeID(DN: number, sched = '40'): number {
  const ps = PIPE_SIZES.find(p => p.DN === DN);
  if (!ps) return DN * 0.9;  // 근사
  const t = ps.schedule[sched] ?? ps.schedule['40'] ?? ps.schedule['40S'] ?? 3.5;
  return ps.OD_mm - 2 * t;
}

/** 내경(D_mm)으로부터 가장 가까운 ANSI/ASME NPS 문자열 조회 */
export function pipeNPSFromID(D_mm: number, sched = '40'): string {
  let best = PIPE_SIZES[0];
  let minDiff = Infinity;
  for (const p of PIPE_SIZES) {
    const diff = Math.abs(pipeID(p.DN, sched) - D_mm);
    if (diff < minDiff) {
      minDiff = diff;
      best = p;
    }
  }
  return `NPS ${best.NPS} (Sch ${sched.replace('S', '')})`;
}

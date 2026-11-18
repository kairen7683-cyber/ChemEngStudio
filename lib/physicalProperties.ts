// =====================================================================
// 화학공장 통합 유체 · 물성 데이터베이스
// Chemical Plant Physical Properties & Pure Component Database
// =====================================================================

import { MW } from './calculations/constants';
import { COMP_CATALOG_META } from './calculations/componentCatalog';
import { COMP_META, SIM_COMPS, type SimCompKey } from './calculations/flowsheetSolver';
import { PSAT_DIPPR101 } from './calculations/data/pureComponentDatabank';
import { pureDipprOrAntoineBarA, RIGOROUS_CRIT } from './calculations/rigorousThermo';
import { THERMO_DATA } from './calculations/thermoCore';

export interface FluidProps {
  key: string;
  name: string;
  nameKo: string;
  /** 화학식 (예: CHCl₃, C₆H₅Cl) */
  formula?: string;
  /** CAS 등록번호 */
  cas?: string;
  /** 검색용 공정 약어·별칭 (예: ['CFM', '클로로포름', 'Chloroform']) */
  aliases?: string[];
  /** 플로우시트 시뮬레이터 성분 키 (77종 SIM_COMPS 매핑) */
  simCompKey?: SimCompKey;
  /** 공용 유틸리티 여부 (스팀·냉각수·칠드워터·브라인·열매유·질소/공기 등) */
  isUtility?: boolean;
  /** 표준 농도 공정액 여부 (FLUID_DB 수용액 프리셋) */
  isProcessSolution?: boolean;
  /** 하위 호환 전용 레거시 키 (단품/배관/타워 계산 호환 유지용) */
  isLegacyAlias?: boolean;
  /** 순수성분 DIPPR-101 증기압 우선 사용 여부 */
  useDippr101?: boolean;
  /** 임계물성 (3차 상태방정식 Peng-Robinson / SRK 연동용) */
  Tc_K?: number;
  Pc_bar?: number;
  omega?: number;
  /** 계열 및 설명 */
  familyLabelKo?: string;
  noteKo?: string;
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
  /** 분자량 (g/mol) */
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

/** 밀도 온도 보정 (선형 근사 / 기체 이상기체 온도 스케일링) */
export function densityAtT(fluid: FluidProps, T_C: number): number {
  if (fluid.phase === 'G' && fluid.dRho_dT === undefined) {
    const T_K = Math.max(50, T_C + 273.15);
    const T0_K = Math.max(50, fluid.T_ref + 273.15);
    return Math.max(0.01, fluid.density_ref * (T0_K / T_K));
  }
  const dRho = fluid.dRho_dT ?? -0.5;
  const minFloor = fluid.phase === 'G' ? 0.01 : 50;
  return Math.max(minFloor, fluid.density_ref + dRho * (T_C - fluid.T_ref));
}

/** 점도 온도 보정 (기체: Sutherland 근사 / 액체: 선형 온도보정 + 하한) */
export function viscosityAtT(fluid: FluidProps, T_C: number): number {
  if (fluid.phase === 'G') {
    const T_K = Math.max(50, T_C + 273.15);
    const T0_K = Math.max(50, fluid.T_ref + 273.15);
    return Math.max(0.002, fluid.viscosity_ref * Math.pow(T_K / T0_K, 0.7));
  }
  const dMu = fluid.dMu_dT ?? -0.02;
  const mu = fluid.viscosity_ref + dMu * (T_C - fluid.T_ref);
  return Math.max(0.1, mu);
}

/** DIPPR-101 또는 Antoine 방정식으로 증기압 계산 (kPa) */
export function vaporPressure_kPa(fluid: FluidProps, T_C: number): number {
  if (fluid.useDippr101 && fluid.simCompKey && PSAT_DIPPR101[fluid.simCompKey]) {
    const pBar = pureDipprOrAntoineBarA(fluid.simCompKey, T_C);
    if (Number.isFinite(pBar) && pBar >= 0) {
      return pBar * 100;
    }
  }
  if (!fluid.antoine) return fluid.vaporPressure_ref ?? 0;
  const { A, B, C } = fluid.antoine;
  const denom = C + T_C;
  if (Math.abs(denom) < 1e-3) return fluid.vaporPressure_ref ?? 0;
  const val = Math.pow(10, A - B / denom);
  return Number.isFinite(val) ? val : (fluid.vaporPressure_ref ?? 0);
}

// ─────────────────────────────────────────────────────────────────────
// 기존 공정 유체 · 전해질 수용액 · 냉매 · 공용 유틸리티 기본 사전
// (기존 장치설계·단품계산기 하위 호환성 100% 유지)
// ─────────────────────────────────────────────────────────────────────

const BASE_LEGACY_AND_UTILITY_FLUIDS: Record<string, FluidProps> = {
  // ── 공정 수용액 및 전해액 ──────────────────────────────────────────
  brine_25: {
    key: 'brine_25',
    name: 'NaCl brine 25wt%',
    nameKo: '포화브라인 (25%)',
    formula: 'NaCl(aq) 25%',
    cas: '7647-14-5',
    aliases: ['Brine', '포화브라인', '정제염수', 'NaCl 25%'],
    isProcessSolution: true,
    T_ref: 25, density_ref: 1172, viscosity_ref: 1.80,
    Cp: 3.47, k_thermal: 0.59,
    vaporPressure_ref: 2.8,
    antoine: { A: 8.071, B: 1730.6, C: 233.4 },
    dRho_dT: -0.45, dMu_dT: -0.025,
    phase: 'L', MW: 22.8, Tb_C: 108.5, surfaceTension: 72.5,
  },
  brine_15: {
    key: 'brine_15',
    name: 'NaCl brine 15wt%',
    nameKo: '희박브라인 (15%)',
    formula: 'NaCl(aq) 15%',
    cas: '7647-14-5',
    aliases: ['희박브라인', 'Depleted Brine', 'NaCl 15%'],
    isProcessSolution: true,
    T_ref: 70, density_ref: 1085, viscosity_ref: 0.60,
    Cp: 3.78, k_thermal: 0.62,
    vaporPressure_ref: 31.0,
    dRho_dT: -0.40, dMu_dT: -0.012,
    phase: 'L', MW: 20.6, Tb_C: 104.0, surfaceTension: 71.0,
  },
  brine_fed: {
    key: 'brine_fed',
    name: 'Refined brine 26wt%',
    nameKo: '정제브라인 (26%)',
    formula: 'NaCl(aq) 26%',
    cas: '7647-14-5',
    aliases: ['정제브라인', 'Refined Brine', 'NaCl 26%'],
    isProcessSolution: true,
    T_ref: 65, density_ref: 1168, viscosity_ref: 0.90,
    Cp: 3.40, k_thermal: 0.57,
    vaporPressure_ref: 25.0,
    dRho_dT: -0.45, dMu_dT: -0.015,
    phase: 'L', MW: 23.0, Tb_C: 109.0, surfaceTension: 70.0,
  },
  naoh_20: {
    key: 'naoh_20',
    name: 'NaOH 20wt%',
    nameKo: '가성소다 20% (세정·제해 순환액)',
    formula: 'NaOH(aq) 20%',
    cas: '1310-73-2',
    aliases: ['가성소다 20%', 'NaOH 20%', 'Scrubber Caustic'],
    isProcessSolution: true,
    T_ref: 25, density_ref: 1219, viscosity_ref: 2.25,
    Cp: 3.55, k_thermal: 0.56,
    vaporPressure_ref: 2.3,
    dRho_dT: -0.58, dMu_dT: -0.05,
    phase: 'L', MW: 20.8, Tb_C: 108.0, surfaceTension: 70.5,
  },
  naoh_32: {
    key: 'naoh_32',
    name: 'NaOH 32wt%',
    nameKo: '가성소다 32%',
    formula: 'NaOH(aq) 32%',
    cas: '1310-73-2',
    aliases: ['가성소다', 'Caustic Soda', 'NaOH 32%'],
    isProcessSolution: true,
    T_ref: 25, density_ref: 1340, viscosity_ref: 3.50,
    Cp: 3.14, k_thermal: 0.54,
    vaporPressure_ref: 1.8,
    dRho_dT: -0.70, dMu_dT: -0.08,
    phase: 'L', MW: 23.1, Tb_C: 118.0, surfaceTension: 68.0,
  },
  naoh_50: {
    key: 'naoh_50',
    name: 'NaOH 50wt%',
    nameKo: '가성소다 50%',
    formula: 'NaOH(aq) 50%',
    cas: '1310-73-2',
    aliases: ['가성소다 50%', 'NaOH 50%', 'Caustic Soda 50%'],
    isProcessSolution: true,
    T_ref: 25, density_ref: 1525, viscosity_ref: 36.0,
    Cp: 2.79, k_thermal: 0.48,
    vaporPressure_ref: 0.4,
    dRho_dT: -0.90, dMu_dT: -0.80,
    phase: 'L', MW: 27.6, Tb_C: 144.0, surfaceTension: 65.0,
  },
  h2so4_60: {
    key: 'h2so4_60',
    name: 'H2SO4 60wt%',
    nameKo: '황산 60% (No.1 건조탑)',
    formula: 'H₂SO₄(aq) 60%',
    cas: '7664-93-9',
    aliases: ['황산 60%', 'Sulfuric Acid 60%'],
    isProcessSolution: true,
    T_ref: 14, density_ref: 1498, viscosity_ref: 6.2,
    Cp: 2.18, k_thermal: 0.43,
    vaporPressure_ref: 0.45,
    dRho_dT: -0.85, dMu_dT: -0.12,
    phase: 'L', MW: 35.3, Tb_C: 142.0, surfaceTension: 69.0,
  },
  h2so4_91: {
    key: 'h2so4_91',
    name: 'H2SO4 91wt%',
    nameKo: '황산 91% (No.2 건조탑)',
    formula: 'H₂SO₄(aq) 91%',
    cas: '7664-93-9',
    aliases: ['황산 91%', 'Sulfuric Acid 91%'],
    isProcessSolution: true,
    T_ref: 19, density_ref: 1820, viscosity_ref: 21.5,
    Cp: 1.55, k_thermal: 0.36,
    vaporPressure_ref: 0.05,
    dRho_dT: -1.05, dMu_dT: -0.45,
    phase: 'L', MW: 70.1, Tb_C: 265.0, surfaceTension: 58.0,
  },
  h2so4_94: {
    key: 'h2so4_94',
    name: 'H2SO4 94wt%',
    nameKo: '황산 94% (No.3 건조탑)',
    formula: 'H₂SO₄(aq) 94%',
    cas: '7664-93-9',
    aliases: ['황산 94%', 'Sulfuric Acid 94%'],
    isProcessSolution: true,
    T_ref: 21, density_ref: 1831, viscosity_ref: 23.8,
    Cp: 1.48, k_thermal: 0.35,
    vaporPressure_ref: 0.03,
    dRho_dT: -1.08, dMu_dT: -0.50,
    phase: 'L', MW: 77.4, Tb_C: 288.0, surfaceTension: 56.0,
  },
  h2so4_98: {
    key: 'h2so4_98',
    name: 'H2SO4 98wt%',
    nameKo: '황산 98%',
    formula: 'H₂SO₄(aq) 98%',
    cas: '7664-93-9',
    aliases: ['황산 98%', '진한황산', 'Concentrated Sulfuric Acid'],
    isProcessSolution: true,
    T_ref: 25, density_ref: 1836, viscosity_ref: 26.7,
    Cp: 1.42, k_thermal: 0.35,
    vaporPressure_ref: 0.03,
    dRho_dT: -1.10, dMu_dT: -0.55,
    phase: 'L', MW: 90.0, Tb_C: 310.0, surfaceTension: 55.0,
  },
  hcl_31: {
    key: 'hcl_31',
    name: 'HCl 31wt%',
    nameKo: '염산 31%',
    formula: 'HCl(aq) 31%',
    cas: '7647-01-0',
    aliases: ['염산 31%', 'Hydrochloric Acid 31%'],
    isProcessSolution: true,
    T_ref: 25, density_ref: 1152, viscosity_ref: 1.90,
    Cp: 2.55, k_thermal: 0.45,
    vaporPressure_ref: 8.5,
    dRho_dT: -0.45, dMu_dT: -0.03,
    phase: 'L', MW: 21.4, Tb_C: 84.0, surfaceTension: 65.0,
  },
  catholyte: {
    key: 'catholyte',
    name: 'Catholyte (33% NaOH)',
    nameKo: '음극액 (33% NaOH)',
    formula: 'NaOH(aq) 33%',
    cas: '1310-73-2',
    aliases: ['음극액', 'Catholyte', 'NaOH 33%'],
    isProcessSolution: true,
    T_ref: 87, density_ref: 1290, viscosity_ref: 1.20,
    Cp: 3.10, k_thermal: 0.50,
    vaporPressure_ref: 60.0,
    dRho_dT: -0.65, dMu_dT: -0.03,
    phase: 'L', MW: 23.3, Tb_C: 119.5, surfaceTension: 60.0,
  },
  anolyte: {
    key: 'anolyte',
    name: 'Anolyte (depleted brine)',
    nameKo: '양극액 (탈염 브라인)',
    formula: 'NaCl(aq) 16%',
    cas: '7647-14-5',
    aliases: ['양극액', 'Anolyte', '탈염브라인'],
    isProcessSolution: true,
    T_ref: 87, density_ref: 1089, viscosity_ref: 0.65,
    Cp: 3.80, k_thermal: 0.60,
    vaporPressure_ref: 55.0,
    dRho_dT: -0.40, dMu_dT: -0.012,
    phase: 'L', MW: 20.8, Tb_C: 104.5, surfaceTension: 68.0,
  },

  // ── 공용 유틸리티 (스팀 · 냉각수 · 칠드워터 · 브라인 · 열매유 · 퍼지가스) ──
  process_water: {
    key: 'process_water',
    name: 'Process water',
    nameKo: '공정수 (Process Water)',
    formula: 'H₂O',
    cas: '7732-18-5',
    aliases: ['PW', 'Process Water', '공정수', '순수', 'DIW', 'BFW'],
    isUtility: true,
    T_ref: 25, density_ref: 997, viscosity_ref: 0.89,
    Cp: 4.18, k_thermal: 0.61,
    vaporPressure_ref: 3.17,
    antoine: { A: 8.0700, B: 1730.6, C: 233.4 },
    dRho_dT: -0.33, dMu_dT: -0.020,
    phase: 'L', MW: 18.015, Tb_C: 100.0, latentHeat_kJkg: 2257, surfaceTension: 72.0,
    Tc_K: 647.1, Pc_bar: 220.64, omega: 0.344,
  },
  cooling_water: {
    key: 'cooling_water',
    name: 'Cooling water (CW, 28→36°C)',
    nameKo: '냉각수 (CW)',
    formula: 'H₂O (CW)',
    cas: '7732-18-5',
    aliases: ['CW', 'Cooling Water', '냉각수', 'CWS', 'CWR'],
    isUtility: true,
    T_ref: 30, density_ref: 995.6, viscosity_ref: 0.80,
    Cp: 4.18, k_thermal: 0.615,
    vaporPressure_ref: 4.24,
    antoine: { A: 8.0713, B: 1730.63, C: 233.426 },
    dRho_dT: -0.33, dMu_dT: -0.018,
    phase: 'L', MW: 18.015, Tb_C: 100.0, latentHeat_kJkg: 2257, surfaceTension: 71.0,
    Tc_K: 647.1, Pc_bar: 220.64, omega: 0.344,
  },
  chilled_water: {
    key: 'chilled_water',
    name: 'Chilled water (CHW, 7→12°C)',
    nameKo: '칠드워터 (CHW · 냉수)',
    formula: 'H₂O (CHW)',
    cas: '7732-18-5',
    aliases: ['CHW', 'CCW', 'Chilled Water', '칠드워터', '냉수'],
    isUtility: true,
    T_ref: 7, density_ref: 999.9, viscosity_ref: 1.43,
    Cp: 4.20, k_thermal: 0.575,
    vaporPressure_ref: 1.00,
    antoine: { A: 8.0713, B: 1730.63, C: 233.426 },
    dRho_dT: -0.10, dMu_dT: -0.035,
    phase: 'L', MW: 18.015, Tb_C: 100.0, latentHeat_kJkg: 2485, surfaceTension: 74.6,
    Tc_K: 647.1, Pc_bar: 220.64, omega: 0.344,
  },
  steam_lp: {
    key: 'steam_lp',
    name: 'Low-Pressure Steam (LP Steam, 3.5 kg/cm²G · 148°C)',
    nameKo: '저압 스팀 (LP Steam · 3.5k)',
    formula: 'H₂O(g) LP',
    cas: '7732-18-5',
    aliases: ['LP Steam', 'LPS', '저압스팀', '3.5k Steam', 'Saturated Steam LP'],
    isUtility: true,
    T_ref: 148, density_ref: 2.38, viscosity_ref: 0.0140,
    Cp: 2.28, k_thermal: 0.029,
    vaporPressure_ref: 451.0,
    antoine: { A: 8.0713, B: 1730.63, C: 233.426 },
    phase: 'G', MW: 18.015, Tb_C: 100.0, latentHeat_kJkg: 2120,
    Tc_K: 647.1, Pc_bar: 220.64, omega: 0.344,
  },
  steam_mp: {
    key: 'steam_mp',
    name: 'Medium-Pressure Steam (MP Steam, 10 kg/cm²G · 184°C)',
    nameKo: '중압 스팀 (MP Steam · 10k)',
    formula: 'H₂O(g) MP',
    cas: '7732-18-5',
    aliases: ['MP Steam', 'MPS', '중압스팀', '10k Steam', '13k Steam'],
    isUtility: true,
    T_ref: 184, density_ref: 5.54, viscosity_ref: 0.0153,
    Cp: 2.65, k_thermal: 0.034,
    vaporPressure_ref: 1098.0,
    antoine: { A: 8.0713, B: 1730.63, C: 233.426 },
    phase: 'G', MW: 18.015, Tb_C: 100.0, latentHeat_kJkg: 2000,
    Tc_K: 647.1, Pc_bar: 220.64, omega: 0.344,
  },
  steam_hp: {
    key: 'steam_hp',
    name: 'High-Pressure Steam (HP Steam, 30 kg/cm²G · 235°C)',
    nameKo: '고압 스팀 (HP Steam · 30k)',
    formula: 'H₂O(g) HP',
    cas: '7732-18-5',
    aliases: ['HP Steam', 'HPS', '고압스팀', '30k Steam', '40k Steam'],
    isUtility: true,
    T_ref: 235, density_ref: 15.5, viscosity_ref: 0.0172,
    Cp: 3.45, k_thermal: 0.044,
    vaporPressure_ref: 3060.0,
    antoine: { A: 8.0713, B: 1730.63, C: 233.426 },
    phase: 'G', MW: 18.015, Tb_C: 100.0, latentHeat_kJkg: 1790,
    Tc_K: 647.1, Pc_bar: 220.64, omega: 0.344,
  },
  brine_coolant: {
    key: 'brine_coolant',
    name: 'Brine Coolant (-20°C CaCl2 / MEG)',
    nameKo: '심냉 브라인 유틸리티 (-20°C)',
    formula: 'CaCl₂/MEG(aq)',
    cas: '10043-52-4',
    aliases: ['Brine Coolant', '심냉브라인', '냉매브라인', 'Brine -20C'],
    isUtility: true,
    isRefrigerant: true,
    T_ref: -20, density_ref: 1248, viscosity_ref: 7.20,
    Cp: 2.82, k_thermal: 0.50,
    vaporPressure_ref: 0.10,
    antoine: { A: 7.75, B: 1780, C: 232 },
    dRho_dT: -0.52, dMu_dT: -0.14,
    phase: 'L', MW: 36.0, Tb_C: 107.0, surfaceTension: 81.5,
  },
  dowtherm_a: {
    key: 'dowtherm_a',
    name: 'Dowtherm A Heat Transfer Fluid (Biphenyl / Diphenyl Oxide)',
    nameKo: '열매유 Dowtherm A (고온 열매체 · 257°C)',
    formula: 'C₁₂H₁₀ / C₁₂H₁₀O',
    cas: '8004-13-5',
    aliases: ['Dowtherm A', 'Dowtherm', 'HTM', 'Hot Oil', '열매유', 'Therminol'],
    isUtility: true,
    T_ref: 250, density_ref: 856, viscosity_ref: 0.28,
    Cp: 2.22, k_thermal: 0.105,
    vaporPressure_ref: 89.0,
    antoine: { A: 6.136, B: 1796.0, C: 176.5 },
    dRho_dT: -0.82, dMu_dT: -0.0025,
    phase: 'L', MW: 166.0, Tb_C: 257.1, latentHeat_kJkg: 292.0, surfaceTension: 19.5,
    Tc_K: 770.0, Pc_bar: 31.34, omega: 0.42,
  },
  nitrogen_air: {
    key: 'nitrogen_air',
    name: 'Nitrogen / Instrument Air Utility',
    nameKo: '질소 퍼지 · 계장공기 유틸리티 (N₂ / IA)',
    formula: 'N₂ / IA',
    cas: '7727-37-9',
    aliases: ['IA', 'N2 Utility', 'Instrument Air', 'Plant Air', '계장공기', '질소퍼지'],
    isUtility: true,
    T_ref: 25, density_ref: 1.16, viscosity_ref: 0.0180,
    Cp: 1.02, k_thermal: 0.026,
    phase: 'G', MW: 28.4, Tb_C: -194.0,
    Tc_K: 129.0, Pc_bar: 35.8, omega: 0.036,
  },
  air: {
    key: 'air',
    name: 'Air',
    nameKo: '공기 (압축·계장 공기)',
    formula: 'Air (N₂/O₂)',
    cas: '132259-10-0',
    aliases: ['Air', '공기', '압축공기', '계장공기', 'IA'],
    isUtility: true,
    T_ref: 25, density_ref: 1.184, viscosity_ref: 0.0185,
    Cp: 1.005, k_thermal: 0.026, MW: 28.97, Tb_C: -194.3,
    Tc_K: 132.5, Pc_bar: 37.71, omega: 0.035,
    phase: 'G',
  },

  // ── 산업용 냉매 (Utilities & Refrigerants) ──────────────────────────
  ref_r134a: {
    key: 'ref_r134a',
    name: 'R-134a (CH₂FCF₃)',
    nameKo: '냉매 R-134a (표준 HFC 칠러·액화용)',
    formula: 'CH₂FCF₃',
    cas: '811-97-2',
    aliases: ['R134a', 'R-134a', 'HFC-134a'],
    isUtility: true,
    T_ref: 20, density_ref: 1225, viscosity_ref: 0.205,
    Cp: 1.41, k_thermal: 0.083, MW: 102.03,
    Tb_C: -26.1, latentHeat_kJkg: 217.0,
    antoine: { A: 6.1348, B: 865.0, C: 243.0 },
    dRho_dT: -3.15, dMu_dT: -0.0028,
    phase: 'G', surfaceTension: 8.7, isRefrigerant: true,
    Tc_K: 374.21, Pc_bar: 40.59, omega: 0.3268,
  },
  ref_r404a: {
    key: 'ref_r404a',
    name: 'R-404A (R-125/143a/134a)',
    nameKo: '냉매 R-404A (염소 심냉 액화기용)',
    formula: 'R-404A',
    cas: '354-33-6',
    aliases: ['R404A', 'R-404A'],
    isUtility: true,
    T_ref: 20, density_ref: 1066, viscosity_ref: 0.138,
    Cp: 1.54, k_thermal: 0.066, MW: 97.60,
    Tb_C: -46.5, latentHeat_kJkg: 200.0,
    antoine: { A: 6.1120, B: 778.0, C: 246.0 },
    dRho_dT: -3.65, dMu_dT: -0.0024,
    phase: 'G', surfaceTension: 5.1, isRefrigerant: true,
    Tc_K: 345.20, Pc_bar: 37.29, omega: 0.286,
  },
  ref_r507a: {
    key: 'ref_r507a',
    name: 'R-507A (Azeotropic HFC)',
    nameKo: '냉매 R-507A (공비 저온 액화기용)',
    formula: 'R-507A',
    cas: '420-46-2',
    aliases: ['R507A', 'R-507A'],
    isUtility: true,
    T_ref: 20, density_ref: 1057, viscosity_ref: 0.134,
    Cp: 1.56, k_thermal: 0.065, MW: 98.86,
    Tb_C: -46.7, latentHeat_kJkg: 196.0,
    antoine: { A: 6.1180, B: 776.5, C: 246.2 },
    dRho_dT: -3.70, dMu_dT: -0.0024,
    phase: 'G', surfaceTension: 4.9, isRefrigerant: true,
    Tc_K: 343.77, Pc_bar: 37.05, omega: 0.288,
  },
  ref_r410a: {
    key: 'ref_r410a',
    name: 'R-410A (R-32/125 50:50)',
    nameKo: '냉매 R-410A (고압 고효율 냉동기용)',
    formula: 'R-410A',
    cas: '75-10-5',
    aliases: ['R410A', 'R-410A'],
    isUtility: true,
    T_ref: 20, density_ref: 1082, viscosity_ref: 0.130,
    Cp: 1.69, k_thermal: 0.091, MW: 72.58,
    Tb_C: -51.4, latentHeat_kJkg: 272.0,
    antoine: { A: 6.1050, B: 760.0, C: 246.0 },
    dRho_dT: -3.55, dMu_dT: -0.0022,
    phase: 'G', surfaceTension: 6.2, isRefrigerant: true,
    Tc_K: 344.50, Pc_bar: 49.01, omega: 0.296,
  },
  ref_r22: {
    key: 'ref_r22',
    name: 'R-22 (CHClF₂ · HCFC-22)',
    nameKo: '냉매 R-22 (기존 화학플랜트 액화 표준)',
    formula: 'CHClF₂',
    cas: '75-45-6',
    aliases: ['R22', 'R-22', 'HCFC-22'],
    isUtility: true,
    T_ref: 20, density_ref: 1213, viscosity_ref: 0.175,
    Cp: 1.24, k_thermal: 0.086, MW: 86.47,
    Tb_C: -40.8, latentHeat_kJkg: 233.7,
    antoine: { A: 6.1280, B: 815.0, C: 245.5 },
    dRho_dT: -3.20, dMu_dT: -0.0024,
    phase: 'G', surfaceTension: 8.4, isRefrigerant: true,
    Tc_K: 369.30, Pc_bar: 49.90, omega: 0.2208,
  },
  ref_r32: {
    key: 'ref_r32',
    name: 'R-32 (CH₂F₂ · Difluoromethane)',
    nameKo: '냉매 R-32 (저GWP 고효율 냉매)',
    formula: 'CH₂F₂',
    cas: '75-10-5',
    aliases: ['R32', 'R-32', 'HFC-32'],
    isUtility: true,
    T_ref: 20, density_ref: 981, viscosity_ref: 0.122,
    Cp: 1.82, k_thermal: 0.125, MW: 52.02,
    Tb_C: -51.7, latentHeat_kJkg: 381.0,
    antoine: { A: 6.2280, B: 782.0, C: 246.5 },
    dRho_dT: -3.40, dMu_dT: -0.0020,
    phase: 'G', surfaceTension: 7.5, isRefrigerant: true,
    Tc_K: 351.26, Pc_bar: 57.82, omega: 0.2769,
  },
  ref_r1234yf: {
    key: 'ref_r1234yf',
    name: 'R-1234yf (CF₃CF=CH₂ · HFO)',
    nameKo: '친환경 냉매 R-1234yf (초저GWP HFO)',
    formula: 'C₃H₂F₄',
    cas: '754-12-1',
    aliases: ['R1234yf', 'R-1234yf', 'HFO-1234yf'],
    isUtility: true,
    T_ref: 20, density_ref: 1110, viscosity_ref: 0.160,
    Cp: 1.37, k_thermal: 0.067, MW: 114.04,
    Tb_C: -29.5, latentHeat_kJkg: 180.0,
    antoine: { A: 6.0250, B: 832.0, C: 244.0 },
    dRho_dT: -3.25, dMu_dT: -0.0023,
    phase: 'G', surfaceTension: 6.8, isRefrigerant: true,
    Tc_K: 367.85, Pc_bar: 33.82, omega: 0.276,
  },
  ref_r1234ze: {
    key: 'ref_r1234ze',
    name: 'R-1234ze(E) (trans-CHF=CHCF₃)',
    nameKo: '친환경 냉매 R-1234ze(E) (터보칠러·히트펌프)',
    formula: 'C₃H₂F₄',
    cas: '29118-24-9',
    aliases: ['R1234ze', 'R-1234ze'],
    isUtility: true,
    T_ref: 20, density_ref: 1178, viscosity_ref: 0.195,
    Cp: 1.38, k_thermal: 0.075, MW: 114.04,
    Tb_C: -19.0, latentHeat_kJkg: 195.5,
    antoine: { A: 6.0950, B: 882.0, C: 242.5 },
    dRho_dT: -3.10, dMu_dT: -0.0026,
    phase: 'G', surfaceTension: 8.9, isRefrigerant: true,
    Tc_K: 382.52, Pc_bar: 36.36, omega: 0.313,
  },
  ref_r717: {
    key: 'ref_r717',
    name: 'R-717 (NH₃ · Ammonia)',
    nameKo: '암모니아 냉매 R-717 (대용량 산업냉동)',
    formula: 'NH₃',
    cas: '7664-41-7',
    aliases: ['R717', 'R-717', '암모니아 냉매'],
    isUtility: true,
    T_ref: 20, density_ref: 610.3, viscosity_ref: 0.135,
    Cp: 4.74, k_thermal: 0.480, MW: 17.03,
    Tb_C: -33.3, latentHeat_kJkg: 1371.0,
    antoine: { A: 6.4853, B: 926.13, C: 240.17 },
    dRho_dT: -1.45, dMu_dT: -0.0018,
    phase: 'G', surfaceTension: 21.1, isRefrigerant: true,
    Tc_K: 405.40, Pc_bar: 113.33, omega: 0.256,
  },
  ref_r1270: {
    key: 'ref_r1270',
    name: 'R-1270 (C₃H₆ · Propylene)',
    nameKo: '프로필렌 냉매 R-1270 (석유화학 심냉용)',
    formula: 'C₃H₆',
    cas: '115-07-1',
    aliases: ['R1270', 'R-1270'],
    isUtility: true,
    T_ref: 20, density_ref: 514, viscosity_ref: 0.110,
    Cp: 2.52, k_thermal: 0.100, MW: 42.08,
    Tb_C: -47.6, latentHeat_kJkg: 437.0,
    antoine: { A: 5.9444, B: 785.0, C: 247.0 },
    dRho_dT: -1.35, dMu_dT: -0.0015,
    phase: 'G', surfaceTension: 7.2, isRefrigerant: true,
    Tc_K: 364.90, Pc_bar: 46.00, omega: 0.140,
  },
  ref_r744: {
    key: 'ref_r744',
    name: 'R-744 (CO₂ · Carbon Dioxide)',
    nameKo: '이산화탄소 냉매 R-744 (캐스케이드 초저온)',
    formula: 'CO₂',
    cas: '124-38-9',
    aliases: ['R744', 'R-744'],
    isUtility: true,
    T_ref: -20, density_ref: 1032, viscosity_ref: 0.140,
    Cp: 2.15, k_thermal: 0.132, MW: 44.01,
    Tb_C: -56.6, latentHeat_kJkg: 348.0,
    antoine: { A: 6.7028, B: 861.8, C: 271.9 },
    dRho_dT: -4.20, dMu_dT: -0.0025,
    phase: 'G', surfaceTension: 4.5, isRefrigerant: true,
    Tc_K: 304.13, Pc_bar: 73.77, omega: 0.2239,
  },
  brine_eg40: {
    key: 'brine_eg40',
    name: 'Ethylene Glycol Brine 40 wt%',
    nameKo: '에틸렌글리콜 냉매 브라인 (40 wt% · -24°C)',
    formula: 'MEG 40%',
    cas: '107-21-1',
    aliases: ['MEG40', '에틸렌글리콜 브라인', 'Glycol Brine'],
    isUtility: true,
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
    formula: 'CaCl₂ 25%',
    cas: '10043-52-4',
    aliases: ['CaCl2 Brine', '염화칼슘 브라인'],
    isUtility: true,
    T_ref: -10, density_ref: 1246, viscosity_ref: 5.40,
    Cp: 2.85, k_thermal: 0.515,
    vaporPressure_ref: 0.21,
    antoine: { A: 7.75, B: 1780, C: 232 },
    dRho_dT: -0.52, dMu_dT: -0.095,
    phase: 'L', surfaceTension: 81.0, isRefrigerant: true,
  },

  // ── 하위 호환 레거시 기체/공정 프리셋 키 (단품계산·패킹타워 연동 유지) ──
  cl2_gas: {
    key: 'cl2_gas',
    name: 'Cl2 gas',
    nameKo: '염소 가스',
    formula: 'Cl₂',
    cas: '7782-50-5',
    isLegacyAlias: true,
    T_ref: 25, density_ref: 2.90, viscosity_ref: 0.0134,
    Cp: 0.48, k_thermal: 0.0090, MW: 70.9, Tb_C: -34.0,
    antoine: { A: 6.0628, B: 861.34, C: 246.14 },
    Tc_K: 416.9, Pc_bar: 79.91, omega: 0.073,
    phase: 'G',
  },
  h2_gas: {
    key: 'h2_gas',
    name: 'H2 gas',
    nameKo: '수소 가스',
    formula: 'H₂',
    cas: '1333-74-0',
    isLegacyAlias: true,
    T_ref: 25, density_ref: 0.082, viscosity_ref: 0.0089,
    Cp: 14.32, k_thermal: 0.182, MW: 2.016, Tb_C: -252.9,
    Tc_K: 33.19, Pc_bar: 13.13, omega: -0.216,
    phase: 'G',
  },
  n2_gas: {
    key: 'n2_gas',
    name: 'N2 gas',
    nameKo: '질소 가스',
    formula: 'N₂',
    cas: '7727-37-9',
    isLegacyAlias: true,
    T_ref: 25, density_ref: 1.145, viscosity_ref: 0.0178,
    Cp: 1.04, k_thermal: 0.026, MW: 28.01, Tb_C: -195.8,
    Tc_K: 126.2, Pc_bar: 33.98, omega: 0.037,
    phase: 'G',
  },
  ahcl_gas: {
    key: 'ahcl_gas',
    name: 'Anhydrous HCl Gas (99.999% 5N)',
    nameKo: '무수염화수소 5N 가스 (반도체 에칭급)',
    formula: 'HCl(g)',
    cas: '7647-01-0',
    aliases: ['AHCl', '5N HCl', '무수염산 가스'],
    isLegacyAlias: true,
    T_ref: 25, density_ref: 1.49, viscosity_ref: 0.0146,
    Cp: 0.80, k_thermal: 0.0145,
    vaporPressure_ref: 4720.0,
    antoine: { A: 6.556, B: 745.8, C: 258.8 },
    phase: 'G', MW: 36.461, Tb_C: -85.05, latentHeat_kJkg: 443.0,
    Tc_K: 324.65, Pc_bar: 83.1, omega: 0.132,
    downstreamGroup: '1A_HCL',
  },
  hcl_gas: {
    key: 'hcl_gas',
    name: 'HCl Gas (Synthetic/Stripper Vapor)',
    nameKo: '염화수소 가스 (합성·탈거 증기)',
    formula: 'HCl(g)',
    cas: '7647-01-0',
    isLegacyAlias: true,
    T_ref: 25, density_ref: 1.49, viscosity_ref: 0.0146,
    Cp: 0.80, k_thermal: 0.0145,
    phase: 'G', MW: 36.461, Tb_C: -85.05,
  },
  dcp_vap: {
    key: 'dcp_vap',
    name: '1,2-DCP / H2O Azeotropic Vapor',
    nameKo: '1,2-DCP / 수분 공비 증기 (C-101 탑정)',
    formula: 'C₃H₆Cl₂/H₂O(g)',
    cas: '78-87-5',
    isLegacyAlias: true,
    T_ref: 68, density_ref: 1.45, viscosity_ref: 0.0105,
    Cp: 1.18, k_thermal: 0.016,
    phase: 'G', MW: 94.5, Tb_C: 88.0,
  },
  ech_vap: {
    key: 'ech_vap',
    name: 'ECH Vacuum Overhead Vapor',
    nameKo: '에피클로로히드린(ECH) 진공 증기',
    formula: 'C₃H₅ClO(g)',
    cas: '106-89-8',
    isLegacyAlias: true,
    T_ref: 62, density_ref: 0.37, viscosity_ref: 0.0098,
    Cp: 1.15, k_thermal: 0.015,
    phase: 'G', MW: 92.52, Tb_C: 116.1,
  },
  dcm_vap: {
    key: 'dcm_vap',
    name: 'Methylene Chloride (MCL) Vapor',
    nameKo: '염화메틸렌(MCL) 증류 증기',
    formula: 'CH₂Cl₂(g)',
    cas: '75-09-2',
    isLegacyAlias: true,
    T_ref: 45, density_ref: 3.18, viscosity_ref: 0.011,
    Cp: 0.68, k_thermal: 0.011,
    phase: 'G', MW: 84.93, Tb_C: 39.6,
  },
  cfm_vap: {
    key: 'cfm_vap',
    name: 'Chloroform (CFM) Vapor',
    nameKo: '클로로포름(CFM) 증류 증기',
    formula: 'CHCl₃(g)',
    cas: '67-66-3',
    isLegacyAlias: true,
    T_ref: 68, density_ref: 4.35, viscosity_ref: 0.0115,
    Cp: 0.62, k_thermal: 0.010,
    phase: 'G', MW: 119.38, Tb_C: 61.2,
  },
  aniline_vap: {
    key: 'aniline_vap',
    name: 'Aniline Vacuum Overhead Vapor',
    nameKo: '아닐린 감압 회수 증기 (15 kPa)',
    formula: 'C₆H₅NH₂(g)',
    cas: '62-53-3',
    isLegacyAlias: true,
    T_ref: 118, density_ref: 0.43, viscosity_ref: 0.0095,
    Cp: 1.45, k_thermal: 0.018,
    phase: 'G', MW: 93.13, Tb_C: 184.1,
  },
  mcb_vap: {
    key: 'mcb_vap',
    name: 'Monochlorobenzene (MCB) Vapor',
    nameKo: '모노클로로벤젠(MCB) 진공 증기',
    formula: 'C₆H₅Cl(g)',
    cas: '108-90-7',
    isLegacyAlias: true,
    T_ref: 68, density_ref: 0.40, viscosity_ref: 0.0092,
    Cp: 1.12, k_thermal: 0.014,
    phase: 'G', MW: 112.56, Tb_C: 131.7,
  },
  mdi_vap: {
    key: 'mdi_vap',
    name: "4,4'-Pure MDI Vacuum Vapor (20 mbar)",
    nameKo: "4,4'-Pure MDI 고진공 증기 (20 mbar)",
    formula: 'C₁₅H₁₀N₂O₂(g)',
    cas: '101-68-8',
    isLegacyAlias: true,
    T_ref: 195, density_ref: 0.13, viscosity_ref: 0.009,
    Cp: 1.32, k_thermal: 0.016,
    phase: 'G', MW: 250.26, Tb_C: 314.0,
  },
  ahcl_liq: {
    key: 'ahcl_liq',
    name: 'Liquid Anhydrous HCl (High-Pressure)',
    nameKo: '액화 무수염산 (-20°C · 15 barA 충전)',
    formula: 'HCl(l)',
    cas: '7647-01-0',
    aliases: ['Liquid AHCl', '액화무수염산'],
    isProcessSolution: true,
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
    formula: 'HCl(aq) 35%',
    cas: '7647-01-0',
    aliases: ['전자급 염산 35%', 'Electronic HCl'],
    isProcessSolution: true,
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
    formula: 'HCl(aq) 20.2%',
    cas: '7647-01-0',
    aliases: ['공비염산', 'PSD 폐염산', 'HCl Azeotrope'],
    isProcessSolution: true,
    T_ref: 25, density_ref: 1098, viscosity_ref: 1.38,
    Cp: 3.08, k_thermal: 0.51,
    vaporPressure_ref: 2.1,
    antoine: { A: 7.21, B: 1795, C: 231.0 },
    dRho_dT: -0.42, dMu_dT: -0.022,
    phase: 'L', MW: 20.1, Tb_C: 108.6, latentHeat_kJkg: 2120.0, surfaceTension: 68.0,
    downstreamGroup: '1A_HCL',
  },
  naocl_12: {
    key: 'naocl_12',
    name: 'Sodium Hypochlorite 12 wt%',
    nameKo: '차아염소산소다 표준액 (12 wt% NaOCl)',
    formula: 'NaOCl(aq) 12%',
    cas: '7681-52-9',
    aliases: ['NaOCl 12%', '하이포 12%'],
    isProcessSolution: true,
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
    formula: 'NaOCl(aq) 25%',
    cas: '7681-52-9',
    aliases: ['NaOCl 25%', '고농도 하이포'],
    isProcessSolution: true,
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
    formula: 'NaClO₃(aq) 40%',
    cas: '7775-09-9',
    aliases: ['NaClO3 40%', '염소산소다'],
    isProcessSolution: true,
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
    formula: 'FeCl₂(aq) 28%',
    cas: '7758-94-3',
    aliases: ['FeCl2 28%', '에칭폐액'],
    isProcessSolution: true,
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
    formula: 'FeCl₃(aq) 40%',
    cas: '7705-08-0',
    aliases: ['FeCl3 40%', '재생 에칭액'],
    isProcessSolution: true,
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
    formula: 'PAC 17%',
    cas: '1327-41-9',
    aliases: ['PAC 17%', '폴리염화알루미늄'],
    isProcessSolution: true,
    T_ref: 25, density_ref: 1375, viscosity_ref: 18.5,
    Cp: 2.88, k_thermal: 0.49,
    vaporPressure_ref: 2.5,
    dRho_dT: -0.58, dMu_dT: -0.32,
    phase: 'L', surfaceTension: 71.0,
    downstreamGroup: '1B_INORG',
  },
  glycerol: {
    key: 'glycerol',
    name: 'Refined Glycerol (C3H8O3)',
    nameKo: '정제 글리세린 (GTE 원료 · Tb 290.0°C)',
    formula: 'C₃H₈O₃',
    cas: '56-81-5',
    isLegacyAlias: true,
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
    formula: 'C₃H₇ClO₂',
    cas: '96-24-2',
    isLegacyAlias: true,
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
    formula: 'C₃H₆Cl₂O',
    cas: '96-23-1',
    isLegacyAlias: true,
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
    formula: 'C₃H₅ClO',
    cas: '106-89-8',
    isLegacyAlias: true,
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
    formula: 'C₃H₆Cl₂',
    cas: '78-87-5',
    isLegacyAlias: true,
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
    formula: 'CH₃COOH',
    cas: '64-19-7',
    isLegacyAlias: true,
    T_ref: 25, density_ref: 1049, viscosity_ref: 1.12,
    Cp: 2.05, k_thermal: 0.158,
    vaporPressure_ref: 2.07,
    antoine: { A: 6.512, B: 1522.0, C: 220.5 },
    dRho_dT: -1.12, dMu_dT: -0.015,
    phase: 'L', MW: 60.052, Tb_C: 117.9, latentHeat_kJkg: 395.0, surfaceTension: 27.4,
    downstreamGroup: '2_ECH',
  },
  aibn_initiator: {
    key: 'aibn_initiator',
    name: 'Azobisisobutyronitrile (AIBN Radical Initiator)',
    nameKo: 'AIBN 라디칼 개시제 (CMS 액상 염소화 개시제)',
    formula: 'C₈H₁₂N₄',
    cas: '78-67-1',
    aliases: ['AIBN', 'Azobisisobutyronitrile', 'TMSN', '라디칼개시제', 'CMS 개시제'],
    T_ref: 25, density_ref: 1110, viscosity_ref: 1.85,
    Cp: 1.68, k_thermal: 0.145,
    vaporPressure_ref: 0.01,
    dRho_dT: -0.80, dMu_dT: -0.025,
    phase: 'L', MW: 164.21, Tb_C: 103.0, latentHeat_kJkg: 320.0, surfaceTension: 32.0,
    familyLabelKo: '라디칼 반응 개시제 (CMS)',
    noteKo: 'CH₃Cl/Cl₂ 가압 액상 라디칼 연쇄염소화 개시제 (103°C 반감기 분해 · 350 ppm 주입)',
  },
};

// ─────────────────────────────────────────────────────────────────────
// 77종 SIM_COMPS 전체 물성 보조 테이블 (밀도·점도·열전도도·표면장력·Antoine·별칭)
// ─────────────────────────────────────────────────────────────────────
interface SimCompTransportSpec {
  name: string;
  nameKo: string;
  formula?: string;
  T_ref?: number;
  density_ref: number;
  viscosity_ref: number;
  k_thermal: number;
  surfaceTension?: number;
  dRho_dT?: number;
  dMu_dT?: number;
  antoine?: { A: number; B: number; C: number };
  aliases: string[];
  downstreamGroup?: '1A_HCL' | '1B_INORG' | '2_ECH';
}

const SIM_COMP_TRANSPORT_SPECS: Record<SimCompKey, SimCompTransportSpec> = {
  H2O: {
    name: 'Water',
    nameKo: '물 / 수증기',
    T_ref: 25, density_ref: 997.0, viscosity_ref: 0.890, k_thermal: 0.607, surfaceTension: 72.0,
    dRho_dT: -0.33, dMu_dT: -0.018,
    antoine: { A: 7.1156, B: 1687.5, C: 230.17 },
    aliases: ['H2O', 'Water', 'Steam', '물', '수증기', '순수', 'PW'],
  },
  NaCl: {
    name: 'Sodium Chloride',
    nameKo: '염화나트륨 (원염)',
    T_ref: 25, density_ref: 2165.0, viscosity_ref: 1.80, k_thermal: 0.59, surfaceTension: 72.5,
    dRho_dT: -0.30, dMu_dT: -0.02,
    aliases: ['NaCl', 'Sodium Chloride', 'Salt', 'Brine', '원염', '염화나트륨', '소금'],
  },
  NaOH: {
    name: 'Sodium Hydroxide',
    nameKo: '수산화나트륨 (가성소다)',
    T_ref: 25, density_ref: 2130.0, viscosity_ref: 3.50, k_thermal: 0.54, surfaceTension: 68.0,
    dRho_dT: -0.50, dMu_dT: -0.05,
    aliases: ['NaOH', 'Sodium Hydroxide', 'Caustic Soda', 'Lye', '가성소다', '수산화나트륨'],
  },
  Cl2: {
    name: 'Chlorine',
    nameKo: '염소',
    T_ref: 25, density_ref: 2.95, viscosity_ref: 0.0134, k_thermal: 0.0089, surfaceTension: 18.4,
    antoine: { A: 6.0628, B: 861.34, C: 246.14 },
    aliases: ['Cl2', 'Chlorine', '염소', '염소가스', '액화염소'],
  },
  H2: {
    name: 'Hydrogen',
    nameKo: '수소',
    T_ref: 25, density_ref: 0.0824, viscosity_ref: 0.0089, k_thermal: 0.182,
    aliases: ['H2', 'Hydrogen', '수소', '수소가스'],
  },
  HCl: {
    name: 'Hydrogen Chloride',
    nameKo: '염화수소 / 무수염산',
    T_ref: 25, density_ref: 1.49, viscosity_ref: 0.0146, k_thermal: 0.0145, surfaceTension: 16.5,
    antoine: { A: 6.5292, B: 849.1, C: 272.76 },
    aliases: ['HCl', 'Hydrogen Chloride', 'AHCl', '무수염산', '염화수소', '염산'],
    downstreamGroup: '1A_HCL',
  },
  H2SO4: {
    name: 'Sulfuric Acid',
    nameKo: '황산',
    T_ref: 25, density_ref: 1831.0, viscosity_ref: 24.2, k_thermal: 0.35, surfaceTension: 55.0,
    dRho_dT: -1.05, dMu_dT: -0.45,
    aliases: ['H2SO4', 'Sulfuric Acid', '황산', '건조황산'],
  },
  O2: {
    name: 'Oxygen',
    nameKo: '산소',
    T_ref: 25, density_ref: 1.308, viscosity_ref: 0.0206, k_thermal: 0.0265,
    aliases: ['O2', 'Oxygen', '산소', '산소가스'],
  },
  NaOCl: {
    name: 'Sodium Hypochlorite',
    nameKo: '차아염소산소다',
    T_ref: 25, density_ref: 1206.0, viscosity_ref: 2.65, k_thermal: 0.55, surfaceTension: 73.0,
    dRho_dT: -0.55, dMu_dT: -0.04,
    aliases: ['NaOCl', 'Sodium Hypochlorite', 'Hypo', 'Bleach', '차아염소산소다', '하이포'],
    downstreamGroup: '1B_INORG',
  },
  N2: {
    name: 'Nitrogen',
    nameKo: '질소 (불활성 가스)',
    T_ref: 25, density_ref: 1.145, viscosity_ref: 0.0178, k_thermal: 0.0259,
    aliases: ['N2', 'Nitrogen', '질소', '불활성가스'],
  },
  NaClO3: {
    name: 'Sodium Chlorate',
    nameKo: '염소산소다',
    T_ref: 25, density_ref: 2490.0, viscosity_ref: 2.35, k_thermal: 0.50, surfaceTension: 74.0,
    dRho_dT: -0.60, dMu_dT: -0.03,
    aliases: ['NaClO3', 'Sodium Chlorate', '염소산소다'],
    downstreamGroup: '1B_INORG',
  },
  FeCl2: {
    name: 'Ferrous Chloride',
    nameKo: '염화제1철',
    T_ref: 25, density_ref: 3160.0, viscosity_ref: 2.95, k_thermal: 0.52, surfaceTension: 72.5,
    dRho_dT: -0.54, dMu_dT: -0.04,
    aliases: ['FeCl2', 'Ferrous Chloride', '염화제1철', '염화제일철', '에칭폐액'],
    downstreamGroup: '1B_INORG',
  },
  FeCl3: {
    name: 'Ferric Chloride',
    nameKo: '염화제2철',
    T_ref: 25, density_ref: 2900.0, viscosity_ref: 6.80, k_thermal: 0.48, surfaceTension: 74.5,
    dRho_dT: -0.65, dMu_dT: -0.10,
    aliases: ['FeCl3', 'Ferric Chloride', '염화제2철', '염화제이철', '에칭액'],
    downstreamGroup: '1B_INORG',
  },
  PAC: {
    name: 'Polyaluminum Chloride',
    nameKo: '폴리염화알루미늄 (PAC)',
    T_ref: 25, density_ref: 1375.0, viscosity_ref: 18.5, k_thermal: 0.49, surfaceTension: 71.0,
    dRho_dT: -0.58, dMu_dT: -0.30,
    aliases: ['PAC', 'Polyaluminum Chloride', '폴리염화알루미늄', '수처리응집제'],
    downstreamGroup: '1B_INORG',
  },
  Glycerol: {
    name: 'Glycerol',
    nameKo: '글리세롤 (글리세린)',
    formula: 'C₃H₈O₃',
    T_ref: 60, density_ref: 1238.0, viscosity_ref: 81.0, k_thermal: 0.286, surfaceTension: 61.5,
    dRho_dT: -0.64, dMu_dT: -1.45,
    antoine: { A: 7.482, B: 2690.0, C: 175.0 },
    aliases: ['Glycerol', 'Glycerin', 'C3H8O3', '글리세린', '글리세롤', 'GTE'],
    downstreamGroup: '2_ECH',
  },
  MCH: {
    name: '3-Monochloro-1,2-propanediol (MCH)',
    nameKo: '모노클로로히드린 (3-MCH)',
    formula: 'C₃H₇ClO₂',
    T_ref: 50, density_ref: 1302.0, viscosity_ref: 14.2, k_thermal: 0.220, surfaceTension: 46.0,
    dRho_dT: -0.82, dMu_dT: -0.25,
    antoine: { A: 7.125, B: 2140.0, C: 196.0 },
    aliases: ['MCH', '3-MCH', '3-MCPD', 'Monochlorohydrin', '모노클로로히드린'],
    downstreamGroup: '2_ECH',
  },
  DCH: {
    name: '1,3-Dichloro-2-propanol (DCH)',
    nameKo: '디클로로히드린 (1,3-DCH)',
    formula: 'C₃H₆Cl₂O',
    T_ref: 40, density_ref: 1351.0, viscosity_ref: 4.85, k_thermal: 0.165, surfaceTension: 39.5,
    dRho_dT: -0.96, dMu_dT: -0.085,
    antoine: { A: 6.985, B: 1865.0, C: 204.5 },
    aliases: ['DCH', '1,3-DCH', '2,3-DCH', 'Dichlorohydrin', '디클로로히드린'],
    downstreamGroup: '2_ECH',
  },
  ECH: {
    name: 'Epichlorohydrin (ECH)',
    nameKo: '에피클로로히드린 (ECH)',
    formula: 'C₃H₅ClO',
    T_ref: 25, density_ref: 1181.0, viscosity_ref: 1.03, k_thermal: 0.138, surfaceTension: 37.0,
    dRho_dT: -1.18, dMu_dT: -0.014,
    antoine: { A: 6.329, B: 1482.5, C: 222.4 },
    aliases: ['ECH', 'Epichlorohydrin', '에피클로로히드린', 'C3H5ClO'],
    downstreamGroup: '2_ECH',
  },
  DCP: {
    name: '1,2-Dichloropropane (DCP)',
    nameKo: '1,2-디클로로프로판 (DCP)',
    formula: 'C₃H₆Cl₂',
    T_ref: 25, density_ref: 1156.0, viscosity_ref: 0.84, k_thermal: 0.125, surfaceTension: 29.0,
    dRho_dT: -1.24, dMu_dT: -0.011,
    antoine: { A: 6.082, B: 1308.0, C: 225.2 },
    aliases: ['DCP', '1,2-DCP', '1,2-Dichloropropane', '디클로로프로판'],
    downstreamGroup: '2_ECH',
  },
  CH4: {
    name: 'Methane',
    nameKo: '메탄 (천연가스)',
    T_ref: 25, density_ref: 0.656, viscosity_ref: 0.0111, k_thermal: 0.0341,
    antoine: { A: 5.9895, B: 443.03, C: 272.66 },
    aliases: ['CH4', 'Methane', 'LNG', '메탄', '천연가스'],
  },
  CO: {
    name: 'Carbon Monoxide',
    nameKo: '일산화탄소',
    T_ref: 25, density_ref: 1.145, viscosity_ref: 0.0177, k_thermal: 0.0250,
    aliases: ['CO', 'Carbon Monoxide', 'Syngas', '일산화탄소', '합성가스'],
  },
  CO2: {
    name: 'Carbon Dioxide',
    nameKo: '이산화탄소',
    T_ref: 25, density_ref: 1.799, viscosity_ref: 0.0149, k_thermal: 0.0166,
    antoine: { A: 6.7160, B: 867.2, C: 273.15 },
    aliases: ['CO2', 'Carbon Dioxide', '이산화탄소', '탄산가스'],
  },
  NH3: {
    name: 'Ammonia',
    nameKo: '암모니아',
    T_ref: 25, density_ref: 0.696, viscosity_ref: 0.0101, k_thermal: 0.0244, surfaceTension: 21.0,
    antoine: { A: 6.8689, B: 1115.6, C: 262.71 },
    aliases: ['NH3', 'Ammonia', 'R-717', '암모니아'],
  },
  C2H4: {
    name: 'Ethylene',
    nameKo: '에틸렌',
    T_ref: 25, density_ref: 1.147, viscosity_ref: 0.0103, k_thermal: 0.0205,
    antoine: { A: 5.9970, B: 602.65, C: 254.84 },
    aliases: ['C2H4', 'Ethylene', '에틸렌'],
  },
  C2H6: {
    name: 'Ethane',
    nameKo: '에탄',
    T_ref: 25, density_ref: 1.229, viscosity_ref: 0.0093, k_thermal: 0.0213,
    antoine: { A: 5.9540, B: 663.72, C: 256.68 },
    aliases: ['C2H6', 'Ethane', '에탄'],
  },
  C3H6: {
    name: 'Propylene',
    nameKo: '프로필렌',
    T_ref: 25, density_ref: 1.720, viscosity_ref: 0.0086, k_thermal: 0.0177,
    antoine: { A: 5.9561, B: 787.30, C: 247.00 },
    aliases: ['C3H6', 'Propylene', 'Propene', '프로필렌'],
  },
  C3H8: {
    name: 'Propane',
    nameKo: '프로판',
    T_ref: 25, density_ref: 1.802, viscosity_ref: 0.0082, k_thermal: 0.0181,
    antoine: { A: 5.9829, B: 821.80, C: 248.73 },
    aliases: ['C3H8', 'Propane', 'LPG', '프로판'],
  },
  nC4H10: {
    name: 'n-Butane',
    nameKo: '노르말부탄',
    T_ref: 25, density_ref: 2.376, viscosity_ref: 0.0075, k_thermal: 0.0162,
    antoine: { A: 5.9327, B: 935.77, C: 238.79 },
    aliases: ['nC4H10', 'n-C4H10', 'n-Butane', '부탄', '노르말부탄'],
  },
  nC6H14: {
    name: 'n-Hexane',
    nameKo: '노르말헥산',
    T_ref: 25, density_ref: 655.0, viscosity_ref: 0.297, k_thermal: 0.120, surfaceTension: 17.9,
    dRho_dT: -0.92, dMu_dT: -0.004,
    antoine: { A: 6.0027, B: 1171.53, C: 224.37 },
    aliases: ['nC6H14', 'n-C6H14', 'Hexane', 'n-Hexane', '헥산', '노르말헥산'],
  },
  nC7H16: {
    name: 'n-Heptane',
    nameKo: '노르말헵탄',
    T_ref: 25, density_ref: 680.0, viscosity_ref: 0.390, k_thermal: 0.124, surfaceTension: 19.7,
    dRho_dT: -0.86, dMu_dT: -0.005,
    antoine: { A: 6.0283, B: 1268.64, C: 216.90 },
    aliases: ['nC7H16', 'n-C7H16', 'Heptane', 'n-Heptane', '헵탄', '노르말헵탄'],
  },
  Benzene: {
    name: 'Benzene',
    nameKo: '벤젠',
    T_ref: 25, density_ref: 874.0, viscosity_ref: 0.604, k_thermal: 0.144, surfaceTension: 28.2,
    dRho_dT: -1.06, dMu_dT: -0.009,
    antoine: { A: 6.0181, B: 1203.83, C: 219.89 },
    aliases: ['Benzene', 'C6H6', '벤젠', 'BTX'],
  },
  Toluene: {
    name: 'Toluene',
    nameKo: '톨루엔',
    T_ref: 25, density_ref: 862.0, viscosity_ref: 0.554, k_thermal: 0.131, surfaceTension: 27.9,
    dRho_dT: -0.94, dMu_dT: -0.007,
    antoine: { A: 6.0783, B: 1343.94, C: 219.38 },
    aliases: ['Toluene', 'C7H8', '톨루엔', 'BTX'],
  },
  pXylene: {
    name: 'p-Xylene',
    nameKo: '파라자일렌',
    formula: 'C₈H₁₀',
    T_ref: 25, density_ref: 857.0, viscosity_ref: 0.605, k_thermal: 0.130, surfaceTension: 27.8,
    dRho_dT: -0.88, dMu_dT: -0.007,
    antoine: { A: 6.1114, B: 1452.20, C: 215.31 },
    aliases: ['pXylene', 'p-Xylene', 'PX', '파라자일렌', '자일렌', 'BTX'],
  },
  MeOH: {
    name: 'Methanol',
    nameKo: '메탄올',
    T_ref: 25, density_ref: 787.0, viscosity_ref: 0.544, k_thermal: 0.200, surfaceTension: 22.1,
    dRho_dT: -0.93, dMu_dT: -0.008,
    antoine: { A: 7.2041, B: 1581.34, C: 239.65 },
    aliases: ['MeOH', 'CH3OH', 'Methanol', '메탄올'],
  },
  EtOH: {
    name: 'Ethanol',
    nameKo: '에탄올',
    T_ref: 25, density_ref: 785.0, viscosity_ref: 1.074, k_thermal: 0.167, surfaceTension: 21.9,
    dRho_dT: -0.86, dMu_dT: -0.018,
    antoine: { A: 7.2468, B: 1598.67, C: 226.58 },
    aliases: ['EtOH', 'C2H5OH', 'Ethanol', '에탄올'],
  },
  IPA: {
    name: 'Isopropanol (IPA)',
    nameKo: '이소프로판올 (IPA)',
    formula: 'C₃H₈O',
    T_ref: 25, density_ref: 781.0, viscosity_ref: 2.04, k_thermal: 0.135, surfaceTension: 20.9,
    dRho_dT: -0.84, dMu_dT: -0.040,
    antoine: { A: 6.8610, B: 1357.43, C: 197.34 },
    aliases: ['IPA', 'Isopropanol', '2-Propanol', '이소프로판올'],
  },
  Acetone: {
    name: 'Acetone',
    nameKo: '아세톤',
    formula: 'C₃H₆O',
    T_ref: 25, density_ref: 785.0, viscosity_ref: 0.306, k_thermal: 0.161, surfaceTension: 22.7,
    dRho_dT: -1.12, dMu_dT: -0.004,
    antoine: { A: 6.4245, B: 1312.25, C: 240.71 },
    aliases: ['Acetone', 'C3H6O', 'DMK', '아세톤'],
  },
  AceticAcid: {
    name: 'Acetic Acid',
    nameKo: '초산 (빙초산)',
    T_ref: 25, density_ref: 1044.0, viscosity_ref: 1.12, k_thermal: 0.158, surfaceTension: 27.1,
    dRho_dT: -1.10, dMu_dT: -0.016,
    antoine: { A: 6.6821, B: 1642.54, C: 233.52 },
    aliases: ['AceticAcid', 'Acetic Acid', 'HOAc', 'CH3COOH', '초산', '빙초산', '아세트산'],
  },
  EtOAc: {
    name: 'Ethyl Acetate',
    nameKo: '초산에틸 (EtOAc)',
    formula: 'C₄H₈O₂',
    T_ref: 25, density_ref: 895.0, viscosity_ref: 0.426, k_thermal: 0.144, surfaceTension: 23.4,
    dRho_dT: -1.18, dMu_dT: -0.005,
    antoine: { A: 6.2281, B: 1245.70, C: 217.88 },
    aliases: ['EtOAc', 'EA', 'Ethyl Acetate', '초산에틸', '아세트산에틸'],
  },
  CHCl3: {
    name: 'Chloroform (CFM)',
    nameKo: '클로로포름 (CFM · CHCl₃)',
    T_ref: 25, density_ref: 1480.0, viscosity_ref: 0.542, k_thermal: 0.117, surfaceTension: 26.7,
    dRho_dT: -1.85, dMu_dT: -0.006,
    antoine: { A: 6.2077, B: 1233.13, C: 232.30 },
    aliases: ['CHCl3', 'CFM', 'Chloroform', 'Trichloromethane', '클로로포름', '트리클로로메탄', 'CMS'],
  },
  Ar: {
    name: 'Argon',
    nameKo: '아르곤',
    T_ref: 25, density_ref: 1.633, viscosity_ref: 0.0226, k_thermal: 0.0177,
    aliases: ['Ar', 'Argon', '아르곤'],
  },
  H2S: {
    name: 'Hydrogen Sulfide',
    nameKo: '황화수소',
    T_ref: 25, density_ref: 1.393, viscosity_ref: 0.0126, k_thermal: 0.0147,
    antoine: { A: 6.2280, B: 804.4, C: 249.6 },
    aliases: ['H2S', 'Hydrogen Sulfide', '황화수소', 'Sour Gas'],
  },
  SO2: {
    name: 'Sulfur Dioxide',
    nameKo: '이산화황',
    T_ref: 25, density_ref: 2.619, viscosity_ref: 0.0128, k_thermal: 0.0096,
    antoine: { A: 6.4100, B: 1045.0, C: 242.0 },
    aliases: ['SO2', 'Sulfur Dioxide', '이산화황', '아황산가스'],
  },
  SO3: {
    name: 'Sulfur Trioxide',
    nameKo: '삼산화황',
    T_ref: 25, density_ref: 1900.0, viscosity_ref: 1.65, k_thermal: 0.210, surfaceTension: 34.0,
    dRho_dT: -2.40, dMu_dT: -0.02,
    antoine: { A: 8.1750, B: 1735.0, C: 236.0 },
    aliases: ['SO3', 'Sulfur Trioxide', '삼산화황', '발연황산'],
  },
  iC4H10: {
    name: 'Isobutane',
    nameKo: '이소부탄',
    T_ref: 25, density_ref: 2.376, viscosity_ref: 0.0075, k_thermal: 0.0164,
    antoine: { A: 5.9081, B: 886.42, C: 240.4 },
    aliases: ['iC4H10', 'i-C4H10', 'Isobutane', '이소부탄'],
  },
  C4H8_1: {
    name: '1-Butene',
    nameKo: '1-부텐',
    T_ref: 25, density_ref: 2.293, viscosity_ref: 0.0077, k_thermal: 0.0160,
    antoine: { A: 5.9178, B: 908.8, C: 238.5 },
    aliases: ['C4H8_1', '1-C4H8', '1-Butene', '1-부텐'],
  },
  nC5H12: {
    name: 'n-Pentane',
    nameKo: '노르말펜탄',
    T_ref: 25, density_ref: 621.0, viscosity_ref: 0.224, k_thermal: 0.113, surfaceTension: 15.5,
    dRho_dT: -0.98, dMu_dT: -0.003,
    antoine: { A: 5.9779, B: 1064.84, C: 232.01 },
    aliases: ['nC5H12', 'n-C5H12', 'n-Pentane', '펜탄', '노르말펜탄'],
  },
  nC8H18: {
    name: 'n-Octane',
    nameKo: '노르말옥탄',
    T_ref: 25, density_ref: 698.0, viscosity_ref: 0.508, k_thermal: 0.128, surfaceTension: 21.1,
    dRho_dT: -0.82, dMu_dT: -0.006,
    antoine: { A: 6.0487, B: 1355.13, C: 209.52 },
    aliases: ['nC8H18', 'n-C8H18', 'n-Octane', '옥탄', '노르말옥탄'],
  },
  Cyclohexane: {
    name: 'Cyclohexane',
    nameKo: '시클로헥산',
    T_ref: 25, density_ref: 774.0, viscosity_ref: 0.894, k_thermal: 0.119, surfaceTension: 24.6,
    dRho_dT: -0.95, dMu_dT: -0.014,
    antoine: { A: 5.9699, B: 1201.53, C: 222.65 },
    aliases: ['Cyclohexane', 'C6H12', '시클로헥산', '사이클로헥산'],
  },
  Ethylbenzene: {
    name: 'Ethylbenzene (EB)',
    nameKo: '에틸벤젠 (EB)',
    T_ref: 25, density_ref: 863.0, viscosity_ref: 0.631, k_thermal: 0.130, surfaceTension: 28.7,
    dRho_dT: -0.89, dMu_dT: -0.008,
    antoine: { A: 6.0825, B: 1424.25, C: 213.21 },
    aliases: ['Ethylbenzene', 'EB', 'C8H10', '에틸벤젠'],
  },
  Styrene: {
    name: 'Styrene Monomer (SM)',
    nameKo: '스티렌 모노머 (SM)',
    T_ref: 25, density_ref: 901.0, viscosity_ref: 0.696, k_thermal: 0.137, surfaceTension: 31.8,
    dRho_dT: -0.91, dMu_dT: -0.009,
    antoine: { A: 6.1400, B: 1485.0, C: 214.0 },
    aliases: ['Styrene', 'SM', 'C8H8', '스티렌', '스타이렌'],
  },
  Cumene: {
    name: 'Cumene',
    nameKo: '큐멘',
    T_ref: 25, density_ref: 857.0, viscosity_ref: 0.739, k_thermal: 0.125, surfaceTension: 27.7,
    dRho_dT: -0.85, dMu_dT: -0.009,
    antoine: { A: 6.0790, B: 1460.79, C: 207.78 },
    aliases: ['Cumene', 'C9H12', '큐멘'],
  },
  Phenol: {
    name: 'Phenol',
    nameKo: '페놀',
    T_ref: 45, density_ref: 1054.0, viscosity_ref: 4.05, k_thermal: 0.155, surfaceTension: 38.2,
    dRho_dT: -0.88, dMu_dT: -0.070,
    antoine: { A: 6.2696, B: 1523.42, C: 175.4 },
    aliases: ['Phenol', 'C6H5OH', '페놀'],
  },
  THF: {
    name: 'Tetrahydrofuran (THF)',
    nameKo: '테트라하이드로퓨란 (THF)',
    T_ref: 25, density_ref: 883.0, viscosity_ref: 0.456, k_thermal: 0.141, surfaceTension: 26.4,
    dRho_dT: -1.06, dMu_dT: -0.006,
    antoine: { A: 6.1212, B: 1202.94, C: 226.25 },
    aliases: ['THF', 'Tetrahydrofuran', 'C4H8O', '테트라하이드로퓨란'],
  },
  DMF: {
    name: 'N,N-Dimethylformamide (DMF)',
    nameKo: '디메틸포름아미드 (DMF)',
    T_ref: 25, density_ref: 944.0, viscosity_ref: 0.802, k_thermal: 0.184, surfaceTension: 35.2,
    dRho_dT: -0.95, dMu_dT: -0.010,
    antoine: { A: 6.0935, B: 1400.86, C: 196.43 },
    aliases: ['DMF', 'Dimethylformamide', 'C3H7NO', '디메틸포름아미드'],
  },
  DMSO: {
    name: 'Dimethyl Sulfoxide (DMSO)',
    nameKo: '디메틸설폭사이드 (DMSO)',
    T_ref: 25, density_ref: 1096.0, viscosity_ref: 1.99, k_thermal: 0.179, surfaceTension: 43.0,
    dRho_dT: -0.99, dMu_dT: -0.028,
    antoine: { A: 6.4911, B: 1807.0, C: 210.5 },
    aliases: ['DMSO', 'Dimethyl Sulfoxide', 'C2H6OS', '디메틸설폭사이드'],
  },
  MTBE: {
    name: 'Methyl tert-Butyl Ether (MTBE)',
    nameKo: 'MTBE (메틸터셔리부틸에테르)',
    T_ref: 25, density_ref: 735.0, viscosity_ref: 0.343, k_thermal: 0.126, surfaceTension: 18.3,
    dRho_dT: -1.05, dMu_dT: -0.004,
    antoine: { A: 6.0702, B: 1150.0, C: 226.0 },
    aliases: ['MTBE', 'C5H12O', '메틸터셔리부틸에테르'],
  },
  MEK: {
    name: 'Methyl Ethyl Ketone (MEK)',
    nameKo: '메틸에틸케톤 (MEK)',
    T_ref: 25, density_ref: 800.0, viscosity_ref: 0.405, k_thermal: 0.145, surfaceTension: 24.0,
    dRho_dT: -1.04, dMu_dT: -0.005,
    antoine: { A: 6.1381, B: 1261.34, C: 221.97 },
    aliases: ['MEK', 'Butanone', 'C4H8O', '메틸에틸케톤'],
  },
  DMC: {
    name: 'Dimethyl Carbonate (DMC)',
    nameKo: '디메틸카보네이트 (DMC)',
    T_ref: 25, density_ref: 1063.0, viscosity_ref: 0.585, k_thermal: 0.150, surfaceTension: 31.3,
    dRho_dT: -1.25, dMu_dT: -0.008,
    antoine: { A: 6.3120, B: 1345.0, C: 219.0 },
    aliases: ['DMC', 'Dimethyl Carbonate', 'C3H6O3', '디메틸카보네이트'],
  },
  EG: {
    name: 'Ethylene Glycol (MEG)',
    nameKo: '에틸렌글리콜 (EG · MEG)',
    T_ref: 25, density_ref: 1110.0, viscosity_ref: 16.9, k_thermal: 0.256, surfaceTension: 48.0,
    dRho_dT: -0.71, dMu_dT: -0.32,
    antoine: { A: 6.9701, B: 1914.95, C: 195.0 },
    aliases: ['EG', 'MEG', 'Ethylene Glycol', 'C2H6O2', '에틸렌글리콜'],
  },
  MEA: {
    name: 'Monoethanolamine (MEA)',
    nameKo: '모노에탄올아민 (MEA)',
    T_ref: 25, density_ref: 1012.0, viscosity_ref: 19.3, k_thermal: 0.240, surfaceTension: 48.3,
    dRho_dT: -0.79, dMu_dT: -0.38,
    antoine: { A: 6.9200, B: 1770.0, C: 198.0 },
    aliases: ['MEA', 'Monoethanolamine', 'C2H7NO', '모노에탄올아민'],
  },
  MDEA: {
    name: 'Methyldiethanolamine (MDEA)',
    nameKo: '메틸디에탄올아민 (MDEA)',
    T_ref: 25, density_ref: 1038.0, viscosity_ref: 77.0, k_thermal: 0.210, surfaceTension: 42.0,
    dRho_dT: -0.76, dMu_dT: -1.35,
    antoine: { A: 7.1800, B: 2240.0, C: 190.0 },
    aliases: ['MDEA', 'Methyldiethanolamine', 'C5H13NO2', '메틸디에탄올아민'],
  },
  FormicAcid: {
    name: 'Formic Acid',
    nameKo: '개미산 (포름산)',
    T_ref: 25, density_ref: 1214.0, viscosity_ref: 1.61, k_thermal: 0.268, surfaceTension: 37.1,
    dRho_dT: -1.22, dMu_dT: -0.025,
    antoine: { A: 6.2190, B: 1295.26, C: 218.0 },
    aliases: ['FormicAcid', 'Formic Acid', 'HCOOH', '개미산', '포름산'],
  },
  HNO3: {
    name: 'Nitric Acid',
    nameKo: '질산',
    T_ref: 25, density_ref: 1504.0, viscosity_ref: 0.75, k_thermal: 0.310, surfaceTension: 41.2,
    dRho_dT: -1.80, dMu_dT: -0.012,
    antoine: { A: 6.6850, B: 1486.0, C: 228.0 },
    aliases: ['HNO3', 'Nitric Acid', '질산'],
  },
  CH3Cl: {
    name: 'Methyl Chloride (MC)',
    nameKo: '메틸클로라이드 (MC · CH₃Cl)',
    T_ref: 25, density_ref: 2.064, viscosity_ref: 0.0108, k_thermal: 0.0106, surfaceTension: 16.2,
    antoine: { A: 6.2185, B: 948.50, C: 249.30 },
    aliases: ['CH3Cl', 'MC', 'Methyl Chloride', 'Chloromethane', 'R-40', '메틸클로라이드', '염화메틸', 'CMS', 'AIBN'],
  },
  CH2Cl2: {
    name: 'Methylene Chloride (MCL / DCM)',
    nameKo: '염화메틸렌 (MCL · DCM · CH₂Cl₂)',
    T_ref: 25, density_ref: 1317.0, viscosity_ref: 0.413, k_thermal: 0.139, surfaceTension: 27.2,
    dRho_dT: -1.80, dMu_dT: -0.005,
    antoine: { A: 6.2078, B: 1138.90, C: 231.45 },
    aliases: ['CH2Cl2', 'MCL', 'DCM', 'Methylene Chloride', 'Dichloromethane', '염화메틸렌', '디클로로메탄', 'CMS'],
  },
  CCl4: {
    name: 'Carbon Tetrachloride (CTC)',
    nameKo: '사염화탄소 (CTC · CCl₄)',
    T_ref: 25, density_ref: 1584.0, viscosity_ref: 0.908, k_thermal: 0.103, surfaceTension: 26.2,
    dRho_dT: -1.94, dMu_dT: -0.012,
    antoine: { A: 6.0229, B: 1221.78, C: 227.50 },
    aliases: ['CCl4', 'CTC', 'Carbon Tetrachloride', 'Tetrachloromethane', '사염화탄소', 'CMS'],
  },
  C2Cl4: {
    name: 'Perchloroethylene (PCE)',
    nameKo: '퍼클로로에틸렌 (PCE · C₂Cl₄)',
    T_ref: 25, density_ref: 1614.0, viscosity_ref: 0.844, k_thermal: 0.110, surfaceTension: 31.3,
    dRho_dT: -1.66, dMu_dT: -0.010,
    antoine: { A: 6.1616, B: 1442.50, C: 226.00 },
    aliases: ['C2Cl4', 'PCE', 'PERC', 'Perchloroethylene', 'Tetrachloroethylene', '퍼클로로에틸렌', 'Heavies', 'CMS'],
  },
  COCl2: {
    name: 'Phosgene',
    nameKo: '포스겐 (COCl₂)',
    T_ref: 25, density_ref: 4.043, viscosity_ref: 0.0124, k_thermal: 0.0095, surfaceTension: 20.1,
    antoine: { A: 6.2236, B: 1030.0, C: 236.0 },
    aliases: ['COCl2', 'Phosgene', 'Carbonyl Chloride', '포스겐', 'MDI'],
  },
  HCHO: {
    name: 'Formaldehyde (Formalin)',
    nameKo: '포름알데히드 (HCHO · 포르말린)',
    T_ref: 25, density_ref: 1.227, viscosity_ref: 0.0105, k_thermal: 0.0160,
    antoine: { A: 6.2467, B: 975.0, C: 249.0 },
    aliases: ['HCHO', 'CH2O', 'Formaldehyde', 'Formalin', '포름알데히드', '포르말린', 'MDI'],
  },
  MCB: {
    name: 'Monochlorobenzene (MCB)',
    nameKo: '모노클로로벤젠 (MCB)',
    T_ref: 25, density_ref: 1101.0, viscosity_ref: 0.753, k_thermal: 0.128, surfaceTension: 32.9,
    dRho_dT: -1.08, dMu_dT: -0.009,
    antoine: { A: 6.11653, B: 1435.675, C: 217.52 },
    aliases: ['MCB', 'Chlorobenzene', 'Monochlorobenzene', 'C6H5Cl', '모노클로로벤젠', '클로로벤젠', 'MDI'],
  },
  Aniline: {
    name: 'Aniline',
    nameKo: '아닐린 (Aniline)',
    T_ref: 25, density_ref: 1018.0, viscosity_ref: 3.85, k_thermal: 0.172, surfaceTension: 42.7,
    dRho_dT: -0.87, dMu_dT: -0.065,
    antoine: { A: 6.3454, B: 1661.86, C: 199.1 },
    aliases: ['Aniline', 'C6H5NH2', 'C6H7N', 'Phenylamine', '아닐린', 'MDI'],
  },
  MDA: {
    name: "4,4'-Methylenedianiline (MDA)",
    nameKo: "4,4'-메틸렌디아닐린 (MDA)",
    T_ref: 95, density_ref: 1055.0, viscosity_ref: 8.50, k_thermal: 0.145, surfaceTension: 44.0,
    dRho_dT: -0.78, dMu_dT: -0.11,
    antoine: { A: 6.5781, B: 2620.0, C: 175.0 },
    aliases: ['MDA', '4,4-MDA', "4,4'-MDA", 'Methylenedianiline', 'C13H14N2', '메틸렌디아닐린', 'MDI'],
  },
  MDI: {
    name: "4,4'-Diphenylmethane Diisocyanate (Pure MDI)",
    nameKo: "4,4'-Pure MDI 모노머",
    T_ref: 45, density_ref: 1188.0, viscosity_ref: 4.90, k_thermal: 0.142, surfaceTension: 43.0,
    dRho_dT: -0.84, dMu_dT: -0.07,
    antoine: { A: 8.4900, B: 3041.0, C: 155.0 },
    aliases: ['MDI', 'Pure MDI', "4,4'-MDI", 'C15H10N2O2', '디이소시아네이트'],
  },
  PMDI: {
    name: 'Polymeric MDI (Crude MDI)',
    nameKo: '폴리머릭 MDI (PMDI)',
    T_ref: 25, density_ref: 1230.0, viscosity_ref: 210.0, k_thermal: 0.148, surfaceTension: 45.0,
    dRho_dT: -0.75, dMu_dT: -3.20,
    antoine: { A: 7.8040, B: 3450.0, C: 160.0 },
    aliases: ['PMDI', 'Polymeric MDI', 'Crude MDI', '폴리머릭 MDI', 'MDI'],
  },
  CUSTOM_1: {
    name: 'Custom Component Slot #1 (Default: n-Butanol)',
    nameKo: '사용자 정의 성분 #1 (기본: n-부탄올)',
    formula: 'C₄H₉OH',
    T_ref: 25, density_ref: 806.0, viscosity_ref: 2.54, k_thermal: 0.153, surfaceTension: 24.6,
    dRho_dT: -0.81, dMu_dT: -0.045,
    antoine: { A: 6.5461, B: 1351.56, C: 179.81 },
    aliases: ['CUSTOM_1', 'CUSTOM-1', 'n-Butanol', 'Butanol', '부탄올', 'UNIFAC'],
  },
  CUSTOM_2: {
    name: 'Custom Component Slot #2 (Default: Aniline)',
    nameKo: '사용자 정의 성분 #2 (기본: 아닐린)',
    formula: 'C₆H₅NH₂',
    T_ref: 25, density_ref: 1018.0, viscosity_ref: 3.85, k_thermal: 0.172, surfaceTension: 42.7,
    dRho_dT: -0.87, dMu_dT: -0.065,
    antoine: { A: 6.3454, B: 1661.86, C: 199.1 },
    aliases: ['CUSTOM_2', 'CUSTOM-2', 'Aniline', 'UNIFAC'],
  },
};

function buildSimCompFluidEntry(compKey: SimCompKey): FluidProps {
  const spec = SIM_COMP_TRANSPORT_SPECS[compKey];
  const meta = COMP_META[compKey];
  const cat = COMP_CATALOG_META[compKey];
  const thermo = THERMO_DATA[compKey];
  const crit = RIGOROUS_CRIT[compKey];
  const mw = meta?.mw ?? (MW as Record<string, number>)[compKey] ?? crit?.mw ?? 50;
  const T_ref = spec.T_ref ?? 25;
  const phase: 'L' | 'G' = meta?.isGasAtStd ? 'G' : 'L';
  const cp_kJkgK = phase === 'G'
    ? (meta?.cpGas ?? 0.25) * 4.1868
    : (meta?.cpLiq ?? 0.45) * 4.1868;
  const latentHeat_kJkg =
    thermo?.dHvapRef && mw > 0
      ? Number(((thermo.dHvapRef * 1000) / mw).toFixed(1))
      : undefined;

  const hasDippr = Boolean(PSAT_DIPPR101[compKey]);
  const pBarRef = pureDipprOrAntoineBarA(compKey, T_ref);
  const vaporPressure_ref = Number.isFinite(pBarRef) ? pBarRef * 100 : 0;

  return {
    key: compKey,
    name: spec.name,
    nameKo: spec.nameKo,
    formula: spec.formula ?? meta?.formula ?? compKey,
    cas: cat?.cas,
    aliases: Array.from(new Set([compKey, meta?.formula ?? '', ...spec.aliases].filter(Boolean))),
    simCompKey: compKey,
    useDippr101: hasDippr && !cat?.isElectrolyte && !cat?.isPermanentGas,
    Tc_K: crit?.Tc_K,
    Pc_bar: crit?.Pc_bar,
    omega: crit?.omega,
    familyLabelKo: cat?.familyLabelKo,
    noteKo: cat?.noteKo,
    T_ref,
    density_ref: spec.density_ref,
    viscosity_ref: spec.viscosity_ref,
    Cp: Number(cp_kJkgK.toFixed(3)),
    k_thermal: spec.k_thermal,
    vaporPressure_ref,
    antoine: spec.antoine,
    dRho_dT: spec.dRho_dT,
    dMu_dT: spec.dMu_dT,
    phase,
    MW: mw,
    Tb_C: cat?.tbC,
    latentHeat_kJkg,
    surfaceTension: spec.surfaceTension,
    downstreamGroup: spec.downstreamGroup,
  };
}

function buildUnifiedFluidDb(): Record<string, FluidProps> {
  const db: Record<string, FluidProps> = { ...BASE_LEGACY_AND_UTILITY_FLUIDS };
  for (const compKey of SIM_COMPS) {
    // 모든 77종 SIM_COMPS가 자신의 정확 키(FLUID_DB[compKey])로 100% 조회되도록 보장
    db[compKey] = buildSimCompFluidEntry(compKey);
  }
  return db;
}

export const FLUID_DB: Record<string, FluidProps> = buildUnifiedFluidDb();

/** 유체 키 → 물성 조회 (없으면 process_water fallback) */
export function getFluidProps(key: string): FluidProps {
  return FLUID_DB[key] ?? FLUID_DB['process_water'];
}

/** SimCompKey → 물성 조회 */
export function getFluidBySimCompKey(compKey: SimCompKey): FluidProps {
  return FLUID_DB[compKey] ?? FLUID_DB['H2O'];
}

/** 모든 액상 유체 목록 */
export const LIQUID_FLUIDS = Object.values(FLUID_DB).filter(f => f.phase === 'L');
/** 모든 기상 유체 목록 */
export const GAS_FLUIDS = Object.values(FLUID_DB).filter(f => f.phase === 'G');
/** 전체 유체 목록 (100% SIM_COMPS + 유틸리티 + 레거시 공정액 포함) */
export const ALL_FLUIDS = Object.values(FLUID_DB);

/** 전체 Property DB 엔트리 반환 (중복 없는 고유 key 목록) */
export function getAllPropertyDbEntries(): FluidProps[] {
  return ALL_FLUIDS;
}

const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

/** 아래첨자/대소문자 정규화 검색 문자열 변환 (예: CHCl₃ → chcl3) */
export function normalizeSearchText(input: string): string {
  return (input || '')
    .replace(/[₀-₉]/g, ch => SUBSCRIPT_MAP[ch] ?? ch)
    .toLowerCase()
    .trim();
}

/** 화학식 · 물질명 · 약어 · CAS 통합 검색 (정확 일치 우선 정렬) */
export function searchFluidProps(query: string, pool: FluidProps[] = ALL_FLUIDS): FluidProps[] {
  const q = normalizeSearchText(query);
  if (!q) return pool;
  const scored: Array<{ fluid: FluidProps; score: number }> = [];
  for (const f of pool) {
    const exactCandidates = [f.key, f.simCompKey, f.formula, f.cas, ...(f.aliases ?? [])]
      .filter((v): v is string => Boolean(v))
      .map(normalizeSearchText);
    const partialCandidates = [
      ...exactCandidates,
      normalizeSearchText(f.name),
      normalizeSearchText(f.nameKo),
      normalizeSearchText(f.familyLabelKo ?? ''),
      normalizeSearchText(f.noteKo ?? ''),
    ].filter(Boolean);

    let score = 0;
    if (normalizeSearchText(f.key) === q || normalizeSearchText(f.simCompKey ?? '') === q || normalizeSearchText(f.cas ?? '') === q) {
      score = 100;
    } else if (exactCandidates.some(c => c === q)) {
      score = 90;
    } else if (exactCandidates.some(c => c.startsWith(q))) {
      score = 70;
    } else if (partialCandidates.some(c => c.includes(q))) {
      score = 40;
    }
    if (score > 0) {
      scored.push({ fluid: f, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.fluid);
}

// ─────────────────────────────────────────────────────────────────────
// 이상기체 밀도 계산
// ─────────────────────────────────────────────────────────────────────
export function gasDensity(MW_val: number, T_C: number, P_kPa: number): number {
  const R = 8314;  // J/kmol·K
  const T_K = T_C + 273.15;
  return (P_kPa * 1000 * MW_val) / (R * T_K);  // kg/m³
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

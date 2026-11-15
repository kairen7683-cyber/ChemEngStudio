/**
 * ChemPro Fluid & Standards Bridge
 * ---------------------------------------------------------------------------
 * Unifies physical property & engineering standard lookups across both:
 *  1) Browser runtime (`public/chempro/index.html`), where `chem_db.js` loads
 *     the 178+ industrial compound catalog (`window.FLUID_DB`, `window.getFluidProps`,
 *     `window.NRTL_PRESETS`, `window.ASME_MATERIALS`, `window.API526_ORIFICES`,
 *     `window.PIPE_SCHEDULES`, `window.FITTING_K`) onto `globalThis`.
 *  2) Standalone Node / TypeScript execution (validation scripts, SSR, flowsheet
 *     engine), using exact parity fallbacks for core industrial compounds & tables.
 */

export interface FluidRecord {
  id: string;
  name: string;
  formula: string;
  cas?: string;
  category?: string;
  mw: number;
  tb?: number;
  tc?: number;
  pc?: number;
  omega?: number;
  rho20: number;
  drho: number;
  mu20: number;
  muB: number;
  cp20: number;
  cp_vap?: number;
  k20: number;
  hv?: number;
  sigma: number;
  fouling: number;
  antoine: [number, number, number];
}

export interface FluidProps {
  id: string;
  name: string;
  formula: string;
  cas: string;
  category: string;
  mw: number;
  tb: number;
  tc: number;
  pc: number;
  omega: number;
  rho: number;
  mu: number;
  cp: number;
  cp_vap: number;
  k: number;
  pv_bar: number;
  pr: number;
  hv: number;
  hv_T: number;
  sigma: number;
  fouling: number;
  antoine: [number, number, number];
}

export interface NrtlPreset {
  name: string;
  lk: string;
  hk: string;
  a12: number;
  a21: number;
  alpha: number;
  azeotrope: string;
}

export interface AsmeMaterial {
  name: string;
  S_MPa: number;
  rho_kgm3: number;
  costFactor: number;
}

export interface Api526Orifice {
  letter: string;
  area_in2: number;
  area_mm2: number;
  size: string;
}

export interface PipeScheduleItem {
  nps: string;
  dn: number;
  od: number;
  wall: number;
  id: number;
}

export const CORE_FLUID_FALLBACKS: Record<string, FluidRecord> = {
  water: {
    id: 'water',
    name: '물 (Water, Process)',
    formula: 'H₂O',
    cas: '7732-18-5',
    category: '물/무기질/열매체',
    mw: 18.015,
    tb: 100,
    tc: 373.95,
    pc: 220.64,
    omega: 0.344,
    rho20: 998.2,
    drho: -0.38,
    mu20: 1.002,
    muB: 1820,
    cp20: 4.184,
    k20: 0.598,
    hv: 2257,
    sigma: 72.8,
    fouling: 0.00018,
    antoine: [8.07131, 1730.63, 233.426],
  },
  naoh_32: {
    id: 'naoh_32',
    name: '[전해공장] 32% 가성소다 (NaOH 32wt% Catholyte)',
    formula: 'NaOH(aq)',
    cas: '1310-73-2',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 23.1,
    tb: 118,
    tc: 410,
    pc: 240,
    omega: 0.36,
    rho20: 1348,
    drho: -0.54,
    mu20: 16.5,
    muB: 2800,
    cp20: 3.35,
    k20: 0.56,
    hv: 1850,
    sigma: 86,
    fouling: 0.0002,
    antoine: [7.88, 1760, 230],
  },
  naoh_50: {
    id: 'naoh_50',
    name: '[전해공장] 50% 가성소다 제품 (NaOH 50wt% Product)',
    formula: 'NaOH(aq)',
    cas: '1310-73-2',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 27.6,
    tb: 144,
    tc: 440,
    pc: 250,
    omega: 0.36,
    rho20: 1525,
    drho: -0.62,
    mu20: 55,
    muB: 3350,
    cp20: 3.05,
    k20: 0.52,
    hv: 1720,
    sigma: 94,
    fouling: 0.0003,
    antoine: [7.82, 1820, 225],
  },
  brine_25: {
    id: 'brine_25',
    name: '[전해공장] 포화 정제염수 25.5% (Purified Brine)',
    formula: 'NaCl(aq)',
    cas: '7647-14-5',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 22.8,
    tb: 108.5,
    tc: 395,
    pc: 230,
    omega: 0.35,
    rho20: 1192,
    drho: -0.45,
    mu20: 1.75,
    muB: 1950,
    cp20: 3.31,
    k20: 0.56,
    hv: 1950,
    sigma: 82,
    fouling: 0.00025,
    antoine: [7.99, 1735, 233],
  },
  brine_nacl20: {
    id: 'brine_nacl20',
    name: '염수 20% (NaCl Brine 20wt%)',
    formula: 'NaCl(aq)',
    cas: '7647-14-5',
    category: '물/무기질/열매체',
    mw: 21.6,
    tb: 105,
    tc: 390,
    pc: 230,
    omega: 0.35,
    rho20: 1148,
    drho: -0.44,
    mu20: 1.55,
    muB: 1950,
    cp20: 3.39,
    k20: 0.562,
    hv: 1980,
    sigma: 79,
    fouling: 0.00035,
    antoine: [7.99, 1735, 233],
  },
  cl2_wet_gas: {
    id: 'cl2_wet_gas',
    name: '[전해공장] 습염소 가스 (Wet Cl2 Gas 400 Sec)',
    formula: 'Cl₂/H₂O(g)',
    cas: '7782-50-5',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 58.5,
    tb: -34,
    tc: 143.8,
    pc: 79.9,
    omega: 0.073,
    rho20: 3.15,
    drho: -0.008,
    mu20: 0.015,
    muB: 140,
    cp20: 0.65,
    k20: 0.012,
    hv: 288,
    sigma: 18.4,
    fouling: 0.00035,
    antoine: [6.9379, 861.34, 246.33],
  },
  cl2_dry_gas: {
    id: 'cl2_dry_gas',
    name: '[전해공장] 건조 염소 가스 (Dry Cl₂ Gas — 액화기 유입)',
    formula: 'Cl₂(g)',
    cas: '7782-50-5',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 70.906,
    tb: -34.04,
    tc: 143.75,
    pc: 79.91,
    omega: 0.073,
    rho20: 1408,
    drho: -2.45,
    mu20: 0.35,
    muB: 960,
    cp20: 0.96,
    cp_vap: 0.485,
    k20: 0.134,
    hv: 288,
    sigma: 18.4,
    fouling: 0.00018,
    antoine: [6.9379, 861.34, 246.33],
  },
  liquid_cl2: {
    id: 'liquid_cl2',
    name: '[전해공장] 액화염소 제품 (Liquid Chlorine Product)',
    formula: 'Cl₂(l)',
    cas: '7782-50-5',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 70.906,
    tb: -34.04,
    tc: 143.75,
    pc: 79.91,
    omega: 0.073,
    rho20: 1408,
    drho: -2.45,
    mu20: 0.35,
    muB: 960,
    cp20: 0.96,
    cp_vap: 0.485,
    k20: 0.134,
    hv: 288,
    sigma: 18.4,
    fouling: 0.00018,
    antoine: [6.9379, 861.34, 246.33],
  },
  h2_wet_gas: {
    id: 'h2_wet_gas',
    name: '[전해공장] 습수소 가스 (Wet H2 Gas 600 Sec)',
    formula: 'H₂/H₂O(g)',
    cas: '1333-74-0',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 5.67,
    tb: -252.9,
    tc: -240,
    pc: 12.96,
    omega: -0.216,
    rho20: 1.45,
    drho: -0.004,
    mu20: 0.01,
    muB: 110,
    cp20: 11.2,
    k20: 0.145,
    hv: 446,
    sigma: 0.1,
    fouling: 0.00015,
    antoine: [5.82, 69, 276],
  },
  steam_13k: {
    id: 'steam_13k',
    name: '[전해공장] 13K 가열 스팀 (MP Steam 13 kg/cm²G, 191°C)',
    formula: 'H₂O(g)',
    cas: '7732-18-5',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 18.015,
    tb: 191,
    tc: 373.95,
    pc: 220.64,
    omega: 0.344,
    rho20: 6.8,
    drho: -0.005,
    mu20: 0.016,
    muB: 120,
    cp20: 2.35,
    k20: 0.035,
    hv: 1975,
    sigma: 40,
    fouling: 0.00009,
    antoine: [8.07131, 1730.63, 233.426],
  },
  steam_lp: {
    id: 'steam_lp',
    name: '저압 스팀 (LP Steam 4 barG)',
    formula: 'H₂O(g)',
    cas: '7732-18-5*',
    category: '산업용가스/냉매',
    mw: 18.015,
    tb: 151.8,
    tc: 373.95,
    pc: 220.64,
    omega: 0.344,
    rho20: 2.68,
    drho: -0.005,
    mu20: 0.014,
    muB: 120,
    cp20: 2.15,
    k20: 0.029,
    hv: 2108,
    sigma: 50,
    fouling: 0.00009,
    antoine: [8.07131, 1730.63, 233.426],
  },
  chilled_water_7c: {
    id: 'chilled_water_7c',
    name: '[전해공장] 저온 냉각수 CCW (Chilled Water 7°C)',
    formula: 'H₂O',
    cas: '7732-18-5',
    category: '★ 전해공장 전용 물질 (Chlor-Alkali)',
    mw: 18.015,
    tb: 100,
    tc: 373.95,
    pc: 220.64,
    omega: 0.344,
    rho20: 999.8,
    drho: -0.35,
    mu20: 1.35,
    muB: 1820,
    cp20: 4.19,
    k20: 0.58,
    hv: 2257,
    sigma: 74.2,
    fouling: 0.00018,
    antoine: [8.07131, 1730.63, 233.426],
  },
  ahcl_gas: {
    id: 'ahcl_gas',
    name: '[염소다운스트림] 건조 무수염산 가스 (Dry HCl Gas)',
    formula: 'HCl(g)',
    cas: '7647-01-0',
    category: '★ 염소 다운스트림 전용 물질 (HCl / ECH / 무기염)',
    mw: 36.46,
    tb: -85.05,
    tc: 51.45,
    pc: 83.1,
    omega: 0.132,
    rho20: 1.52,
    drho: -0.005,
    mu20: 0.0145,
    muB: 150,
    cp20: 0.81,
    k20: 0.0145,
    hv: 443,
    sigma: 0.5,
    fouling: 0.00015,
    antoine: [7.4043, 849.1, 272.76],
  },
  hcl_35_up: {
    id: 'hcl_35_up',
    name: '[염소다운스트림] 35% 초고순도 전자급 염산 (Ultrapure HCl 35wt%)',
    formula: 'HCl(aq)',
    cas: '7647-01-0',
    category: '★ 염소 다운스트림 전용 물질 (HCl / ECH / 무기염)',
    mw: 22.15,
    tb: 62,
    tc: 345,
    pc: 185,
    omega: 0.34,
    rho20: 1174,
    drho: -0.58,
    mu20: 1.92,
    muB: 1740,
    cp20: 2.44,
    k20: 0.435,
    hv: 1660,
    sigma: 63.5,
    fouling: 0.00025,
    antoine: [8.15, 1525, 228],
  },
  hcl_20_azeo: {
    id: 'hcl_20_azeo',
    name: '[염소다운스트림] 20.2% 공비 염산 (Azeotropic HCl 20.2wt%)',
    formula: 'HCl(aq)',
    cas: '7647-01-0',
    category: '★ 염소 다운스트림 전용 물질 (HCl / ECH / 무기염)',
    mw: 20.25,
    tb: 108.6,
    tc: 362,
    pc: 205,
    omega: 0.34,
    rho20: 1098,
    drho: -0.48,
    mu20: 1.38,
    muB: 1690,
    cp20: 3.05,
    k20: 0.505,
    hv: 1950,
    sigma: 68.5,
    fouling: 0.00025,
    antoine: [8.11, 1781, 231],
  },
  ech_pure: {
    id: 'ech_pure',
    name: '[염소다운스트림] 에피클로로히드린 (Epichlorohydrin, ECH)',
    formula: 'C₃H₅ClO',
    cas: '106-89-8',
    category: '★ 염소 다운스트림 전용 물질 (HCl / ECH / 무기염)',
    mw: 92.52,
    tb: 116.1,
    tc: 342,
    pc: 48.5,
    omega: 0.312,
    rho20: 1181.2,
    drho: -1.21,
    mu20: 1.12,
    muB: 1520,
    cp20: 1.49,
    k20: 0.136,
    hv: 412,
    sigma: 37,
    fouling: 0.00025,
    antoine: [7.26, 1482.5, 222.4],
  },
  dcp_12: {
    id: 'dcp_12',
    name: '[염소다운스트림] 1,2-디클로로프로판 (1,2-DCP 경질유분)',
    formula: 'C₃H₆Cl₂',
    cas: '78-87-5',
    category: '★ 염소 다운스트림 전용 물질 (HCl / ECH / 무기염)',
    mw: 112.99,
    tb: 96.4,
    tc: 304,
    pc: 44,
    omega: 0.256,
    rho20: 1156,
    drho: -1.32,
    mu20: 0.84,
    muB: 1350,
    cp20: 1.32,
    k20: 0.125,
    hv: 318,
    sigma: 29,
    fouling: 0.00025,
    antoine: [6.953, 1308, 225.2],
  },
  dch_13: {
    id: 'dch_13',
    name: '[염소다운스트림] 1,3-디클로로히드린 (1,3-DCH 중간체)',
    formula: 'C₃H₆Cl₂O',
    cas: '96-23-1',
    category: '★ 염소 다운스트림 전용 물질 (HCl / ECH / 무기염)',
    mw: 128.99,
    tb: 174.3,
    tc: 405,
    pc: 49,
    omega: 0.445,
    rho20: 1364,
    drho: -1.1,
    mu20: 4.85,
    muB: 2350,
    cp20: 1.56,
    k20: 0.152,
    hv: 396,
    sigma: 41.5,
    fouling: 0.00035,
    antoine: [7.804, 1865, 204.5],
  },
  h2so4_98: {
    id: 'h2so4_98',
    name: '황산 98% (Sulfuric Acid 98wt%)',
    formula: 'H₂SO₄',
    cas: '7664-93-9',
    category: '물/무기질/열매체',
    mw: 98.08,
    tb: 337,
    tc: 652,
    pc: 64,
    omega: 0.45,
    rho20: 1836,
    drho: -1.02,
    mu20: 24.5,
    muB: 2950,
    cp20: 1.42,
    k20: 0.36,
    hv: 570,
    sigma: 55.1,
    fouling: 0.00053,
    antoine: [8.45, 2980, 205],
  },
  dowtherm_a: {
    id: 'dowtherm_a',
    name: '다우썸 A (Dowtherm A 열매체유)',
    formula: 'C₁₂H₁₀/C₁₂H₁₀O',
    cas: '8004-13-5',
    category: '물/무기질/열매체',
    mw: 166,
    tb: 257.1,
    tc: 497,
    pc: 31.3,
    omega: 0.41,
    rho20: 1056,
    drho: -0.82,
    mu20: 4.28,
    muB: 2150,
    cp20: 1.59,
    k20: 0.138,
    hv: 296,
    sigma: 40.1,
    fouling: 0.00018,
    antoine: [7.35, 2095, 202],
  },
  methane: {
    id: 'methane',
    name: '메탄 (Methane)',
    formula: 'CH₄',
    cas: '74-82-8',
    category: '파라핀/알칸 탄화수소',
    mw: 16.04,
    tb: -161.5,
    tc: -82.6,
    pc: 45.99,
    omega: 0.011,
    rho20: 422.6,
    drho: -1.5,
    mu20: 0.11,
    muB: 450,
    cp20: 3.48,
    k20: 0.18,
    hv: 510,
    sigma: 13,
    fouling: 0.00018,
    antoine: [6.61184, 389.93, 266],
  },
  hexane: {
    id: 'hexane',
    name: '노말헥산 (n-Hexane)',
    formula: 'C₆H₁₄',
    cas: '110-54-3',
    category: '파라핀/알칸 탄화수소',
    mw: 86.18,
    tb: 68.7,
    tc: 234.5,
    pc: 30.25,
    omega: 0.301,
    rho20: 659.4,
    drho: -0.89,
    mu20: 0.31,
    muB: 980,
    cp20: 2.26,
    k20: 0.12,
    hv: 335,
    sigma: 18.4,
    fouling: 0.00018,
    antoine: [6.87776, 1171.53, 224.366],
  },
  benzene: {
    id: 'benzene',
    name: '벤젠 (Benzene)',
    formula: 'C₆H₆',
    cas: '71-43-2',
    category: '방향족 화합물',
    mw: 78.11,
    tb: 80.1,
    tc: 288.9,
    pc: 48.94,
    omega: 0.212,
    rho20: 878.9,
    drho: -1.06,
    mu20: 0.652,
    muB: 1250,
    cp20: 1.74,
    k20: 0.144,
    hv: 394,
    sigma: 28.9,
    fouling: 0.00018,
    antoine: [6.90565, 1211.033, 220.79],
  },
  toluene: {
    id: 'toluene',
    name: '톨루엔 (Toluene)',
    formula: 'C₇H₈',
    cas: '108-88-3',
    category: '방향족 화합물',
    mw: 92.14,
    tb: 110.6,
    tc: 318.6,
    pc: 41.08,
    omega: 0.264,
    rho20: 866.9,
    drho: -0.93,
    mu20: 0.59,
    muB: 1180,
    cp20: 1.7,
    k20: 0.134,
    hv: 361,
    sigma: 28.5,
    fouling: 0.00018,
    antoine: [6.95464, 1344.8, 219.48],
  },
  ethylbenzene: {
    id: 'ethylbenzene',
    name: '에틸벤젠 (Ethylbenzene)',
    formula: 'C₈H₁₀',
    cas: '100-41-4',
    category: '방향족 화합물',
    mw: 106.17,
    tb: 136.2,
    tc: 344,
    pc: 36.06,
    omega: 0.303,
    rho20: 867,
    drho: -0.88,
    mu20: 0.678,
    muB: 1280,
    cp20: 1.75,
    k20: 0.13,
    hv: 335,
    sigma: 29.2,
    fouling: 0.00018,
    antoine: [6.95719, 1424.255, 213.21],
  },
  styrene: {
    id: 'styrene',
    name: '스티렌 모노머 (Styrene Monomer)',
    formula: 'C₈H₈',
    cas: '100-42-5',
    category: '방향족 화합물',
    mw: 104.15,
    tb: 145.2,
    tc: 362,
    pc: 38.4,
    omega: 0.297,
    rho20: 906,
    drho: -0.88,
    mu20: 0.76,
    muB: 1310,
    cp20: 1.69,
    k20: 0.137,
    hv: 354,
    sigma: 32.1,
    fouling: 0.00053,
    antoine: [6.95706, 1445.58, 209.44],
  },
  methanol: {
    id: 'methanol',
    name: '메탄올 (Methanol)',
    formula: 'CH₃OH',
    cas: '67-56-1',
    category: '알코올/폴리올',
    mw: 32.04,
    tb: 64.7,
    tc: 239.4,
    pc: 80.97,
    omega: 0.565,
    rho20: 791.4,
    drho: -0.94,
    mu20: 0.59,
    muB: 1260,
    cp20: 2.53,
    k20: 0.202,
    hv: 1100,
    sigma: 22.6,
    fouling: 0.00018,
    antoine: [8.08097, 1582.27, 239.726],
  },
  ethanol: {
    id: 'ethanol',
    name: '에탄올 (Ethanol)',
    formula: 'C₂H₅OH',
    cas: '64-17-5',
    category: '알코올/폴리올',
    mw: 46.07,
    tb: 78.37,
    tc: 240.8,
    pc: 61.48,
    omega: 0.644,
    rho20: 789.3,
    drho: -0.85,
    mu20: 1.19,
    muB: 1660,
    cp20: 2.44,
    k20: 0.167,
    hv: 846,
    sigma: 22.3,
    fouling: 0.00018,
    antoine: [8.20417, 1642.89, 230.3],
  },
  ipa: {
    id: 'ipa',
    name: '이소프로판올 (Isopropanol, IPA)',
    formula: 'C₃H₇OH',
    cas: '67-63-0',
    category: '알코올/폴리올',
    mw: 60.1,
    tb: 82.6,
    tc: 235.2,
    pc: 47.6,
    omega: 0.665,
    rho20: 785.5,
    drho: -0.83,
    mu20: 2.4,
    muB: 2050,
    cp20: 2.68,
    k20: 0.14,
    hv: 663,
    sigma: 21.7,
    fouling: 0.00018,
    antoine: [8.11778, 1580.92, 219.61],
  },
  acetone: {
    id: 'acetone',
    name: '아세톤 (Acetone)',
    formula: 'C₃H₆O',
    cas: '67-64-1',
    category: '케톤/알데히드/에테르',
    mw: 58.08,
    tb: 56.05,
    tc: 235,
    pc: 47,
    omega: 0.307,
    rho20: 784.5,
    drho: -1.12,
    mu20: 0.32,
    muB: 960,
    cp20: 2.15,
    k20: 0.161,
    hv: 518,
    sigma: 23.7,
    fouling: 0.00018,
    antoine: [7.02447, 1161, 224],
  },
  thf: {
    id: 'thf',
    name: '테트라하이드로퓨란 (THF)',
    formula: 'C₄H₈O',
    cas: '109-99-9',
    category: '케톤/알데히드/에테르',
    mw: 72.11,
    tb: 66,
    tc: 267,
    pc: 51.9,
    omega: 0.225,
    rho20: 889.2,
    drho: -1.05,
    mu20: 0.48,
    muB: 1120,
    cp20: 1.72,
    k20: 0.14,
    hv: 410,
    sigma: 26.4,
    fouling: 0.00018,
    antoine: [6.99515, 1202.29, 226.25],
  },
  mek: {
    id: 'mek',
    name: '메틸에틸케톤 (MEK, 2-Butanone)',
    formula: 'C₄H₈O',
    cas: '78-93-3',
    category: '케톤/알데히드/에테르',
    mw: 72.11,
    tb: 79.6,
    tc: 262.4,
    pc: 41.5,
    omega: 0.323,
    rho20: 805,
    drho: -1.03,
    mu20: 0.43,
    muB: 1090,
    cp20: 2.19,
    k20: 0.145,
    hv: 433,
    sigma: 24.6,
    fouling: 0.00018,
    antoine: [6.97421, 1209.6, 216],
  },
  acetic_acid: {
    id: 'acetic_acid',
    name: '초산 / 아세트산 (Acetic Acid)',
    formula: 'CH₃COOH',
    cas: '64-19-7',
    category: '유기산/에스테르',
    mw: 60.05,
    tb: 117.9,
    tc: 319.6,
    pc: 57.86,
    omega: 0.467,
    rho20: 1049.2,
    drho: -1.12,
    mu20: 1.22,
    muB: 1580,
    cp20: 2.05,
    k20: 0.168,
    hv: 402,
    sigma: 27.6,
    fouling: 0.00035,
    antoine: [7.38782, 1533.313, 222.309],
  },
  ammonia: {
    id: 'ammonia',
    name: '암모니아 (Ammonia, R-717)',
    formula: 'NH₃',
    cas: '7664-41-7',
    category: '산업용가스/냉매',
    mw: 17.03,
    tb: -33.3,
    tc: 132.25,
    pc: 113.33,
    omega: 0.256,
    rho20: 610.3,
    drho: -1.45,
    mu20: 0.135,
    muB: 710,
    cp20: 4.74,
    k20: 0.48,
    hv: 1371,
    sigma: 21.1,
    fouling: 0.00018,
    antoine: [7.3605, 926.132, 240.17],
  },
  co2_liq: {
    id: 'co2_liq',
    name: '이산화탄소 (Liquid CO₂, R-744)',
    formula: 'CO₂',
    cas: '124-38-9',
    category: '산업용가스/냉매',
    mw: 44.01,
    tb: -56.6,
    tc: 31,
    pc: 73.77,
    omega: 0.224,
    rho20: 773,
    drho: -3.2,
    mu20: 0.07,
    muB: 520,
    cp20: 2.85,
    k20: 0.088,
    hv: 234,
    sigma: 1.5,
    fouling: 0.00018,
    antoine: [7.578, 861.8, 271.9],
  },
  nitrogen_gas: {
    id: 'nitrogen_gas',
    name: '질소 가스 (Nitrogen @ 10 barG)',
    formula: 'N₂',
    cas: '7727-37-9',
    category: '산업용가스/냉매',
    mw: 28.01,
    tb: -195.8,
    tc: -146.9,
    pc: 33.96,
    omega: 0.037,
    rho20: 12.5,
    drho: -0.04,
    mu20: 0.0176,
    muB: 150,
    cp20: 1.04,
    k20: 0.0258,
    hv: 199,
    sigma: 0.1,
    fouling: 0.00009,
    antoine: [6.49457, 255.68, 266.55],
  },
  methyl_chloride: {
    id: 'methyl_chloride',
    name: '메틸클로라이드 / 클로로메탄 (MC)',
    formula: 'CH₃Cl',
    cas: '74-87-3',
    category: '염소계/특수용매',
    mw: 50.488,
    tb: -24.2,
    tc: 143.1,
    pc: 66.8,
    omega: 0.153,
    rho20: 915.0,
    drho: -2.05,
    mu20: 0.18,
    muB: 720,
    cp20: 1.59,
    k20: 0.142,
    hv: 429,
    sigma: 16.2,
    fouling: 0.00018,
    antoine: [7.0937, 948.5, 249.3],
  },
  dcm: {
    id: 'dcm',
    name: '디클로로메탄 / 메틸렌클로라이드 (MDC)',
    formula: 'CH₂Cl₂',
    cas: '75-09-2',
    category: '염소계/특수용매',
    mw: 84.93,
    tb: 39.6,
    tc: 237,
    pc: 60.8,
    omega: 0.199,
    rho20: 1326.6,
    drho: -1.78,
    mu20: 0.44,
    muB: 1050,
    cp20: 1.19,
    k20: 0.14,
    hv: 329,
    sigma: 27.2,
    fouling: 0.00018,
    antoine: [7.0803, 1138.91, 231.45],
  },
  chloroform: {
    id: 'chloroform',
    name: '클로로포름 (Chloroform)',
    formula: 'CHCl₃',
    cas: '67-66-3',
    category: '염소계/특수용매',
    mw: 119.38,
    tb: 61.2,
    tc: 263.2,
    pc: 54.7,
    omega: 0.222,
    rho20: 1483.2,
    drho: -1.85,
    mu20: 0.57,
    muB: 1180,
    cp20: 0.96,
    k20: 0.117,
    hv: 247,
    sigma: 27.1,
    fouling: 0.00018,
    antoine: [6.95465, 1170.966, 226.232],
  },
  ccl4: {
    id: 'ccl4',
    name: '사염화탄소 (Carbon Tetrachloride)',
    formula: 'CCl₄',
    cas: '56-23-5',
    category: '염소계/특수용매',
    mw: 153.82,
    tb: 76.7,
    tc: 283.2,
    pc: 45.6,
    omega: 0.193,
    rho20: 1594,
    drho: -1.91,
    mu20: 0.97,
    muB: 1460,
    cp20: 0.86,
    k20: 0.103,
    hv: 195,
    sigma: 26.8,
    fouling: 0.00018,
    antoine: [6.87926, 1212.021, 226.409],
  },
  pce: {
    id: 'pce',
    name: '퍼클로로에틸렌 (PCE)',
    formula: 'C₂Cl₄',
    cas: '127-18-4',
    category: '염소계/특수용매',
    mw: 165.83,
    tb: 121.1,
    tc: 347.1,
    pc: 44.6,
    omega: 0.233,
    rho20: 1622.7,
    drho: -1.65,
    mu20: 0.89,
    muB: 1410,
    cp20: 0.86,
    k20: 0.11,
    hv: 209,
    sigma: 31.7,
    fouling: 0.00025,
    antoine: [6.97683, 1386.92, 217.53],
  },
};

export const DEFAULT_NRTL_PRESETS: Record<string, NrtlPreset> = {
  ethanol_water: {
    name: '에탄올 / 물 (비이상 공비혼합물, 89.4 mol%)',
    lk: 'ethanol',
    hk: 'water',
    a12: -55.1,
    a21: 670.4,
    alpha: 0.3,
    azeotrope: '78.15°C @ x₁=0.894 (최소공비)',
  },
  methanol_water: {
    name: '메탄올 / 물 (약한 비이상계)',
    lk: 'methanol',
    hk: 'water',
    a12: -175.7,
    a21: 617.2,
    alpha: 0.3,
    azeotrope: '공비점 없음',
  },
  acetone_water: {
    name: '아세톤 / 물 (강한 양의 편차)',
    lk: 'acetone',
    hk: 'water',
    a12: 330.5,
    a21: 890.2,
    alpha: 0.3,
    azeotrope: '고농도 핀치 주의',
  },
  ipa_water: {
    name: '이소프로판올(IPA) / 물 (공비혼합물, 68.5 mol%)',
    lk: 'ipa',
    hk: 'water',
    a12: 75.2,
    a21: 1120.5,
    alpha: 0.3,
    azeotrope: '80.3°C @ x₁=0.685 (최소공비)',
  },
  thf_water: {
    name: 'THF / 물 (강한 비이상 공비계)',
    lk: 'thf',
    hk: 'water',
    a12: 490,
    a21: 1380,
    alpha: 0.3,
    azeotrope: '63.9°C @ x₁=0.82 (최소공비)',
  },
  mek_water: {
    name: 'MEK / 물 (비이상 공비계)',
    lk: 'mek',
    hk: 'water',
    a12: 520,
    a21: 1450,
    alpha: 0.3,
    azeotrope: '73.4°C @ x₁=0.65 (최소공비)',
  },
  benzene_toluene: {
    name: '벤젠 / 톨루엔 (이상용액 기준계)',
    lk: 'benzene',
    hk: 'toluene',
    a12: 0,
    a21: 0,
    alpha: 0.3,
    azeotrope: '이상용액 (γ₁=γ₂=1.0)',
  },
  styrene_eb: {
    name: '에틸벤젠 / 스티렌 (진공 정밀분리 α≈1.38)',
    lk: 'ethylbenzene',
    hk: 'styrene',
    a12: 18,
    a21: -12,
    alpha: 0.3,
    azeotrope: '공비점 없음 (다단 정류 필요)',
  },
  acetic_water: {
    name: '물 / 초산 (수소결합 회합계)',
    lk: 'water',
    hk: 'acetic_acid',
    a12: 412,
    a21: -115,
    alpha: 0.3,
    azeotrope: '탑상 부근 상대휘발도 급감 핀치',
  },
  dcp_ech: {
    name: '1,2-DCP / 에피클로로히드린(ECH) (경질분리 증류탑)',
    lk: 'dcp_12',
    hk: 'ech_pure',
    a12: 118,
    a21: 84,
    alpha: 0.3,
    azeotrope: '공비점 없음 (상대휘발도 α≈1.78)',
  },
  ech_dch: {
    name: '에피클로로히드린(ECH) / 1,3-DCH (진공 정제탑)',
    lk: 'ech_pure',
    hk: 'dch_13',
    a12: 165,
    a21: 92,
    alpha: 0.3,
    azeotrope: '진공 운전으로 열분해 억제 (α≈4.8)',
  },
  water_hcl_azeo: {
    name: '물 / 공비염산(20.2%) (진공·가압 PSD 압력변동 증류)',
    lk: 'water',
    hk: 'hcl_20_azeo',
    a12: -220,
    a21: -180,
    alpha: 0.2,
    azeotrope: '최대공비점 주의 (진공 22.9wt% ↔ 가압 17.5wt%)',
  },
};

export const DEFAULT_ASME_MATERIALS: Record<string, AsmeMaterial> = {
  'SA-516-70': { name: 'SA-516 Gr.70 (탄소강 압력용기 표준)', S_MPa: 138, rho_kgm3: 7850, costFactor: 1.0 },
  'SA-285-C': { name: 'SA-285 Gr.C (일반 저압 탄소강)', S_MPa: 108, rho_kgm3: 7850, costFactor: 0.9 },
  'SA-240-304': { name: 'SA-240 Type 304 (스테인리스강)', S_MPa: 138, rho_kgm3: 7930, costFactor: 2.6 },
  'SA-240-316L': { name: 'SA-240 Type 316L (내식성 스테인리스강)', S_MPa: 115, rho_kgm3: 7990, costFactor: 3.4 },
  'SA-387-11': { name: 'SA-387 Gr.11 Cl.2 (1.25Cr-0.5Mo 고온합금강)', S_MPa: 121, rho_kgm3: 7850, costFactor: 1.8 },
  'SA-240-2205': { name: 'SA-240 UNS S32205 (Duplex 이상 스테인리스)', S_MPa: 172, rho_kgm3: 7800, costFactor: 4.2 },
};

export const DEFAULT_API526_ORIFICES: Api526Orifice[] = [
  { letter: 'D', area_in2: 0.11, area_mm2: 71, size: '1" × 2"' },
  { letter: 'E', area_in2: 0.196, area_mm2: 126.5, size: '1" × 2"' },
  { letter: 'F', area_in2: 0.307, area_mm2: 198.1, size: '1.5" × 2"' },
  { letter: 'G', area_in2: 0.503, area_mm2: 324.5, size: '1.5" × 3"' },
  { letter: 'H', area_in2: 0.785, area_mm2: 506.5, size: '2" × 3"' },
  { letter: 'J', area_in2: 1.287, area_mm2: 830.3, size: '3" × 4"' },
  { letter: 'K', area_in2: 1.838, area_mm2: 1185.8, size: '3" × 4"' },
  { letter: 'L', area_in2: 2.853, area_mm2: 1840.6, size: '4" × 6"' },
  { letter: 'M', area_in2: 3.6, area_mm2: 2322.6, size: '4" × 6"' },
  { letter: 'N', area_in2: 4.34, area_mm2: 2800, size: '4" × 6"' },
  { letter: 'P', area_in2: 6.38, area_mm2: 4116.1, size: '4" × 6"' },
  { letter: 'Q', area_in2: 11.05, area_mm2: 7129, size: '6" × 8"' },
  { letter: 'R', area_in2: 16, area_mm2: 10322.6, size: '6" × 10"' },
  { letter: 'T', area_in2: 26, area_mm2: 16774.2, size: '8" × 10"' },
];

export const DEFAULT_PIPE_SCHEDULES: Record<string, PipeScheduleItem[]> = {
  '40': [
    { nps: '1"', dn: 25, od: 33.4, wall: 3.38, id: 26.64 },
    { nps: '1-1/2"', dn: 40, od: 48.3, wall: 3.68, id: 40.94 },
    { nps: '2"', dn: 50, od: 60.3, wall: 3.91, id: 52.48 },
    { nps: '2-1/2"', dn: 65, od: 73, wall: 5.16, id: 62.68 },
    { nps: '3"', dn: 80, od: 88.9, wall: 5.49, id: 77.92 },
    { nps: '4"', dn: 100, od: 114.3, wall: 6.02, id: 102.26 },
    { nps: '6"', dn: 150, od: 168.3, wall: 7.11, id: 154.08 },
    { nps: '8"', dn: 200, od: 219.1, wall: 8.18, id: 202.74 },
    { nps: '10"', dn: 250, od: 273.1, wall: 9.27, id: 254.56 },
    { nps: '12"', dn: 300, od: 323.8, wall: 10.31, id: 303.18 },
    { nps: '14"', dn: 350, od: 355.6, wall: 11.13, id: 333.34 },
    { nps: '16"', dn: 400, od: 406.4, wall: 12.7, id: 381 },
    { nps: '18"', dn: 450, od: 457, wall: 14.27, id: 428.46 },
    { nps: '20"', dn: 500, od: 508, wall: 15.09, id: 477.82 },
    { nps: '24"', dn: 600, od: 610, wall: 17.48, id: 575.04 },
  ],
  '80': [
    { nps: '1"', dn: 25, od: 33.4, wall: 4.55, id: 24.3 },
    { nps: '1-1/2"', dn: 40, od: 48.3, wall: 5.08, id: 38.14 },
    { nps: '2"', dn: 50, od: 60.3, wall: 5.54, id: 49.22 },
    { nps: '2-1/2"', dn: 65, od: 73, wall: 7.01, id: 58.98 },
    { nps: '3"', dn: 80, od: 88.9, wall: 7.62, id: 73.66 },
    { nps: '4"', dn: 100, od: 114.3, wall: 8.56, id: 97.18 },
    { nps: '6"', dn: 150, od: 168.3, wall: 10.97, id: 146.36 },
    { nps: '8"', dn: 200, od: 219.1, wall: 12.7, id: 193.7 },
    { nps: '10"', dn: 250, od: 273.1, wall: 15.09, id: 242.92 },
    { nps: '12"', dn: 300, od: 323.8, wall: 17.48, id: 288.84 },
    { nps: '14"', dn: 350, od: 355.6, wall: 19.05, id: 317.5 },
    { nps: '16"', dn: 400, od: 406.4, wall: 21.44, id: 363.52 },
  ],
  '10S': [
    { nps: '1"', dn: 25, od: 33.4, wall: 2.77, id: 27.86 },
    { nps: '1-1/2"', dn: 40, od: 48.3, wall: 2.77, id: 42.76 },
    { nps: '2"', dn: 50, od: 60.3, wall: 2.77, id: 54.76 },
    { nps: '3"', dn: 80, od: 88.9, wall: 3.05, id: 82.8 },
    { nps: '4"', dn: 100, od: 114.3, wall: 3.05, id: 108.2 },
    { nps: '6"', dn: 150, od: 168.3, wall: 3.4, id: 161.5 },
    { nps: '8"', dn: 200, od: 219.1, wall: 3.76, id: 211.58 },
    { nps: '10"', dn: 250, od: 273.1, wall: 4.19, id: 264.72 },
    { nps: '12"', dn: 300, od: 323.8, wall: 4.57, id: 314.66 },
  ],
};

export const DEFAULT_FITTING_K: Record<string, number> = {
  elbow90: 0.75,
  elbow45: 0.35,
  teeThru: 0.4,
  teeBranch: 1.5,
  gateValve: 0.17,
  globeValve: 6.0,
  checkValve: 2.0,
  controlValve: 8.5,
  entrance: 0.5,
  exit: 1.0,
};

function getGlobal(): Record<string, any> {
  return globalThis as Record<string, any>;
}

export function getFluidDb(): Record<string, FluidRecord> {
  const g = getGlobal();
  if (g.FLUID_DB && typeof g.FLUID_DB === 'object') {
    return g.FLUID_DB as Record<string, FluidRecord>;
  }
  return CORE_FLUID_FALLBACKS;
}

export function resolveFluidRecord(fluidId?: string): FluidRecord {
  const db = getFluidDb();
  if (fluidId && db[fluidId]) return db[fluidId];
  if (fluidId && CORE_FLUID_FALLBACKS[fluidId]) return CORE_FLUID_FALLBACKS[fluidId];
  return db.water || CORE_FLUID_FALLBACKS.water;
}

export function computeFluidPropsFromRecord(f: FluidRecord, tempC?: number): FluidProps {
  const T = Number.isFinite(tempC as number) ? (tempC as number) : 25;
  const dT = T - 20.0;
  const TK = Math.max(120.0, T + 273.15);

  const rho = Math.max(0.2, f.rho20 + f.drho * dT);
  const mu = Math.max(0.005, f.mu20 * Math.exp(f.muB * (1.0 / TK - 1.0 / 293.15)));
  const cp = Math.max(0.35, f.cp20 * (1.0 + 0.00045 * dT));
  const isAlreadyGas = f.rho20 < 40.0;
  const cp_vap = f.cp_vap
    ? Math.max(0.3, f.cp_vap * (1.0 + 0.0005 * dT))
    : isAlreadyGas
      ? cp
      : Math.max(0.45, cp * 0.62);
  const k = Math.max(0.01, f.k20 * (1.0 - 0.0003 * dT));

  const [A, B, C] = f.antoine;
  const logP = A - B / Math.max(30.0, T + C);
  const p_mmHg = Math.pow(10, Math.min(6.5, logP));
  const pv_bar = p_mmHg * 0.00133322;

  const tc = f.tc !== undefined ? f.tc : (f.tb ?? 25.0) + 180.0;
  const tb = f.tb !== undefined ? f.tb : 25.0;
  const hv_base = f.hv || 250.0;
  const hv_T =
    T >= tc - 1.0
      ? 0.0
      : hv_base * Math.pow(Math.max(0.03, (tc - T) / Math.max(10.0, tc - tb)), 0.38);

  const pr = (cp * mu) / Math.max(0.01, k);

  return {
    id: f.id,
    name: f.name,
    formula: f.formula,
    cas: f.cas || '-',
    category: f.category || '일반',
    mw: f.mw,
    tb,
    tc,
    pc: f.pc || 40.0,
    omega: f.omega || 0.25,
    rho,
    mu,
    cp,
    cp_vap,
    k,
    pv_bar,
    pr,
    hv: hv_base,
    hv_T,
    sigma: f.sigma,
    fouling: f.fouling,
    antoine: f.antoine,
  };
}

export function resolveFluidProps(fluidId?: string, tempC?: number): FluidProps {
  const g = getGlobal();
  if (typeof g.getFluidProps === 'function') {
    const res = g.getFluidProps(fluidId || 'water', tempC);
    if (res && Number.isFinite(res.rho)) {
      return res as FluidProps;
    }
  }
  const f = resolveFluidRecord(fluidId);
  return computeFluidPropsFromRecord(f, tempC);
}

export function getAllNrtlPresets(): Record<string, NrtlPreset> {
  const g = getGlobal();
  if (g.NRTL_PRESETS && typeof g.NRTL_PRESETS === 'object') {
    return g.NRTL_PRESETS as Record<string, NrtlPreset>;
  }
  return DEFAULT_NRTL_PRESETS;
}

export function resolveNrtlPreset(presetId?: string): NrtlPreset | undefined {
  const presets = getAllNrtlPresets();
  if (presetId && presets[presetId]) return presets[presetId];
  return presets.ethanol_water || DEFAULT_NRTL_PRESETS.ethanol_water;
}

export function getAllAsmeMaterials(): Record<string, AsmeMaterial> {
  const g = getGlobal();
  if (g.ASME_MATERIALS && typeof g.ASME_MATERIALS === 'object') {
    return g.ASME_MATERIALS as Record<string, AsmeMaterial>;
  }
  return DEFAULT_ASME_MATERIALS;
}

export function resolveAsmeMaterial(materialId?: string): AsmeMaterial {
  const mats = getAllAsmeMaterials();
  if (materialId && mats[materialId]) return mats[materialId];
  return mats['SA-516-70'] || DEFAULT_ASME_MATERIALS['SA-516-70'];
}

export function getApi526Orifices(): Api526Orifice[] {
  const g = getGlobal();
  if (Array.isArray(g.API526_ORIFICES)) {
    return g.API526_ORIFICES as Api526Orifice[];
  }
  return DEFAULT_API526_ORIFICES;
}

export function getAllPipeSchedules(): Record<string, PipeScheduleItem[]> {
  const g = getGlobal();
  if (g.PIPE_SCHEDULES && typeof g.PIPE_SCHEDULES === 'object') {
    return g.PIPE_SCHEDULES as Record<string, PipeScheduleItem[]>;
  }
  return DEFAULT_PIPE_SCHEDULES;
}

export function getPipeScheduleList(schedule?: string): PipeScheduleItem[] {
  const all = getAllPipeSchedules();
  const key = schedule && all[schedule] ? schedule : '40';
  return all[key] || DEFAULT_PIPE_SCHEDULES['40'];
}

export function getFittingK(): Record<string, number> {
  const g = getGlobal();
  if (g.FITTING_K && typeof g.FITTING_K === 'object') {
    return g.FITTING_K as Record<string, number>;
  }
  return DEFAULT_FITTING_K;
}

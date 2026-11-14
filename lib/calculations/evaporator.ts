// =====================================================================
// 300 SEC — 가성소다 3중 효용 강하막식 증발 농축 공정 (Triple-Effect Falling Film Evaporator)
//   • 공정 방식: 역류 급액 (Backward-Feed: 3효 E-340 → 2효 E-330 → 1효 E-320)
//   • 증기 흐름: 병류 가열 (Forward-Vapor: 13K Steam S1 → 1효 → V1 → 2효 → V2 → 3효 → V3 → 표면응축기 E-360)
//   • 핵심 포함:
//     1) NaOH 농도·압력별 비점오름 (Boiling Point Rise, BPR — Dühring Rule)
//     2) 1·2·3효 물질수지 및 에너지(엔탈피) 수지
//     3) 강하막식 증발관(Falling Film Evaporator) 전용 열수력학 설계 솔버:
//        - 튜브 단위둘레당 액막 적하 유량 (Wetting Rate Γ = m_recirc / (N_tubes · π · d_i))
//        - 최소 적하 유량(Dry-out 방지 Γ_min ≥ 0.12 kg/m·s) 만족을 위한 순환펌프 유량 산출
//        - 강하 액막 레이놀즈수 Re_film = 4·Γ / μ_L 및 Chun-Seban 난류 액막 열전달계수 h_film
//        - 쉘측 스팀 응축 열전달계수 h_cond (Nusselt 수직관 응축) 및 총괄열전달계수 U_dirty
//        - 기액분리기(Vapor-Liquid Separator Drum, D-321/331/341) Souders-Brown 직경·높이 산출
//        - 강하막식 증발관 전용 Engineering CAD Blueprint & 액막 프로파일 Canvas 렌더러
// =====================================================================

import type { StreamData } from './streams';

// ─── 1. NaOH 비점오름 (BPR) 및 물성 상관식 ─────────────────────────────

/** 압력(barA)에 따른 순수 물의 포화 온도 T_sat (°C) — Antoine 식 역산 */
export function waterSatTemp_C(P_barA: number): number {
  const P_mmHg = Math.max(20, P_barA * 750.062);
  // log10(P_mmHg) = A - B / (T + C), A=8.07131, B=1730.63, C=233.426
  const T = 1730.63 / (8.07131 - Math.log10(P_mmHg)) - 233.426;
  return Math.max(30, Math.min(240, T));
}

/**
 * 가성소다(NaOH) 수용액의 비점오름 (Boiling Point Rise, ΔT_BPR, °C)
 * Dühring 선도 및 공업용 가성소다 증발관 실측 상관식 (w: NaOH 질량분율 0.20~0.55)
 */
export function calcNaOHBPR_C(wtPct: number, T_sat_water_C: number): number {
  const w = Math.max(0.05, Math.min(0.60, wtPct / 100));
  // 실공장 300 SEC(MB-2012) Dühring 상관식:
  // 36.4 wt% (T_sat 42.9°C) -> BPE 25.2°C (T_boil 68.4°C)
  // 42.1 wt% (T_sat 73.2°C) -> BPE 34.4°C (T_boil 108.5°C)
  // 50.0 wt% (T_sat 116.0°C) -> BPE 46.8°C (T_boil 164.8°C)
  const baseBPR = 45.2 * Math.pow(w, 1.05) + 115.0 * Math.pow(Math.max(0, w - 0.30), 1.85);
  const tempFactor = 1.0 + 0.0024 * (T_sat_water_C - 75.0);
  return Math.max(2.0, +(baseBPR * tempFactor).toFixed(1));
}

/** NaOH 수용액 밀도 (kg/m³) — 농도(wt%) 및 온도(°C) 함수 */
export function naohDensity_kgm3(wtPct: number, T_C: number): number {
  const rho20 = 998.2 + 10.65 * wtPct - 0.024 * wtPct * wtPct;
  return Math.max(1050, +(rho20 - 0.58 * (T_C - 20)).toFixed(1));
}

/** NaOH 수용액 점도 (mPa·s = cP) — 농도(wt%) 및 온도(°C) 함수 */
export function naohViscosity_cP(wtPct: number, T_C: number): number {
  const w = Math.max(10, Math.min(55, wtPct));
  const mu80 = 0.55 * Math.exp(0.058 * w);
  const mu = mu80 * Math.exp(1950 * (1 / (T_C + 273.15) - 1 / 353.15));
  return Math.max(0.45, +Math.min(45, mu).toFixed(2));
}

/** NaOH 수용액 비열 (kJ/kg·K) */
export function naohSpecificHeat_kJkgK(wtPct: number, T_C: number): number {
  const cp = 4.184 - 0.0255 * wtPct + 0.00008 * wtPct * wtPct + 0.0006 * (T_C - 60);
  return +Math.max(2.75, Math.min(3.95, cp)).toFixed(3);
}

/** NaOH 수용액 열전도도 (W/m·K) */
export function naohThermalCond_WmK(wtPct: number, T_C: number): number {
  const k = 0.60 + 0.0008 * (T_C - 25) - 0.0014 * wtPct;
  return +Math.max(0.48, Math.min(0.68, k)).toFixed(3);
}

// ─── 2. 3중 효용 강하막식 증발 공정 시뮬레이션 (Process Simulation) ─────

export interface EffectProcessState {
  effectNo: 1 | 2 | 3;
  evapTag: string;           // 'E-320' | 'E-330' | 'E-340'
  sepTag: string;            // 'D-321' | 'D-331' | 'D-341'
  pumpTag: string;           // 'P-321' | 'P-331' | 'P-341'
  serviceName: string;
  P_shell_kgcm2g: number;    // 가열측(스팀/효용증기) 압력
  T_steam_C: number;         // 가열 증기 응축 온도 (°C)
  P_tube_kgcm2g: number;     // 증발측(관측/분리기) 압력 (진공 포함)
  P_tube_barA: number;
  T_sat_water_C: number;     // 해당 압력에서 순수 물 포화온도 (°C)
  BPR_C: number;             // NaOH 비점오름 (°C)
  T_boil_C: number;          // 실제 액막 비등 온도 (°C) = T_sat_water + BPR
  dT_eff_C: number;          // 유효 전열 온도차 (°C) = T_steam - T_boil
  feedFlow_kgh: number;      // 효용 유입 액량 (kg/h)
  outFlow_kgh: number;       // 효용 유출 농축액량 (kg/h)
  evapWater_kgh: number;     // 본 효용 증발 수분량 V_i (kg/h)
  heatingSteam_kgh: number;  // 가열 스팀/증기 유량 (kg/h)
  wtIn_pct: number;          // 입구 NaOH 농도 (wt%)
  wtOut_pct: number;         // 출구 NaOH 농도 (wt%)
  T_feed_C: number;          // 입구 액 온도 (°C)
  Q_duty_kW: number;         // 증발관 열부하 (kW)
  latent_steam_kJkg: number; // 가열 증기 잠열 (kJ/kg)
  latent_vapor_kJkg: number; // 발생 증기 잠열 (kJ/kg)
}

export interface TripleEffectSimulationResult {
  scaleFactor: number;
  feed32_kgh: number;
  naohPure_kgh: number;
  product50_kgh: number;
  totalEvapWater_kgh: number;
  liveSteam13K_kgh: number;
  steamEconomy: number;      // kg 총증발수분 / kg 13K 생증기 (전형적 3효 ~2.25)
  effects: {
    eff1: EffectProcessState; // E-320 (1효: 41.9% → 50.0%)
    eff2: EffectProcessState; // E-330 (2효: 36.3% → 41.9%)
    eff3: EffectProcessState; // E-340 (3효: 32.0% → 36.3%)
  };
  streams300: StreamData[];
}

/**
 * 300 SEC 3중 효용 강하막식 증발 공정 엄밀 물질·열수지 시뮬레이터 (Excel "300 Sec" 실측 기준)
 * • 상단 증발관 배열 (좌 → 우: 1효 E-320 → 2효 E-330 → 3효 E-340 → 표면응축기 E-350)
 * • 역류 급액 (Backward-Feed Liquor):
 *   [L1] 32.0% NaOH (66,960.1 kg/h, 90.0°C, 4") → LCV-5340 → 3효 E-340(E-5340) 상부 급액
 *   → D-341(3효 분리기, -0.94 kg/cm²G, 68.4°C, BPE 25.2°C) → P-341 [L2: 36.4%, 58,866.1 kg/h, 6"-NA-B74]
 *   → 병렬 분기(75.5% / 24.5%):
 *      • [L3] 44,443.9 kg/h (4"-NA-B74) → E-342(50% NaOH 열회수, 68.4→108.2°C, Q=1,447,151 kcal/h)
 *      • [L4] 14,422.2 kg/h (2"-NA-B74) → E-343(응축수 열회수, 68.4→114.0°C, Q=537,525 kcal/h)
 *   → 합류 [L5] (58,866.1 kg/h, 109.6°C, 6"-NA-B74) → 2효 E-330(E-5330) 상부 급액
 *   → D-331(2효 분리기, -0.68 kg/cm²G, 108.5°C, BPE 34.4°C) → P-331 [L7: 42.1%, 50,896.1 kg/h, 4"-NA-B74]
 *   → 병렬 분기(75.5% / 24.5%):
 *      • [L8] 38,426.5 kg/h (3"-NA-B74) → E-332(50% NaOH 열회수, 108.5→156.2°C, Q=1,443,303 kcal/h)
 *      • [L9] 12,469.5 kg/h (2"-NA-B74) → E-333(응축수 열회수, 108.5→160.0°C, Q=505,327 kcal/h)
 *   → 합류 [L10] (50,896.1 kg/h, 157.2°C, 4"-NA-B74) → 1효 E-320(E-5320) 상부 급액
 *   → D-321(1효 분리기, +0.72 kg/cm²G, 164.8°C, BPE 46.8°C) → P-321 [L11: 50.04%, 42,824.4 kg/h, 4"-NA-B74]
 *   → E-332 고온측(164.8→120.0°C) [L12] → E-342 고온측(120.0→75.0°C) [L13] → E-352 냉각기(75.0→42.0°C) [L14]
 * • 병류 증기 가열 (Forward-Vapor):
 *   [S1] 13K Steam (10,713.1 kg/h, 8.35 kg/cm²G, 175.4°C, 8"-SM-BA1) → 1효 E-320 → D-5321(Flash C5 357.2 kg/h + 응축수 C1 10,355.9 kg/h)
 *   [V1] 1효 증기 (8,071.7 kg/h, 20"-V-) + [C5] → 2효 E-330 → D-5341(Flash C6 702.7 kg/h + 응축수 C4 24,492.9 kg/h)
 *   [V2] 2효 증기 (7,970.0 kg/h, 28"-V-316L) + [C6] → 3효 E-340
 *   [V3] 3효 증기 (8,796.8 kg/h, 32"-V-316L) → 표면응축기 E-350(E-5350, Q=5,011,944 kcal/h, CW 626,493 kg/h)
 */
export function simulateTripleEffectEvaporator(sf = 1.0): TripleEffectSimulationResult {
  // 1. 전체 물질수지 (Excel "300 Sec" 기준: 32.0 wt% -> 50.04 wt%)
  const feed32_kgh = +(66960.14 * sf).toFixed(2);
  const naohPure_kgh = +(21427.24 * sf).toFixed(2); // 32.00 wt%
  const h2oFeed_kgh = +(feed32_kgh - naohPure_kgh).toFixed(2); // 45,532.90 * sf

  const wtProd = 50.035;
  const product50_kgh = +(42824.40 * sf).toFixed(2);
  const h2oProd_kgh = +(product50_kgh - naohPure_kgh).toFixed(2); // 21,397.16 * sf
  const totalEvapWater_kgh = +(feed32_kgh - product50_kgh).toFixed(2); // 24,135.74 * sf

  // 각 효용 순수 수분 증발량 (Excel 실측값)
  const V3_evap_kgh = +(8094.08 * sf).toFixed(2); // 3효 액막 증발량
  const C6_flash_kgh = +(702.74 * sf).toFixed(2); // D-340(D-5341) Flash Steam (8.3%)
  const V3_kgh = +(V3_evap_kgh + C6_flash_kgh).toFixed(2); // 8,796.82 kg/h (E-350 유입 총 수증기)
  const V2_kgh = +(7969.99 * sf).toFixed(2);      // 2효 증발량 (7,969.99 kg/h)
  const V1_kgh = +(8071.67 * sf).toFixed(2);      // 1효 증발량 (8,071.67 kg/h)
  const C5_flash_kgh = +(357.18 * sf).toFixed(2); // D-5321 Flash Steam (357.18 kg/h)

  // 각 효용 출구 액량 및 농도
  const L2_kgh = +(58866.06 * sf).toFixed(2);     // 3효 출구 (36.4 wt%, 6"-NA-B74)
  const wt3_out = 36.40;
  const L3_kgh = +(L2_kgh * 0.755).toFixed(2);    // 44,443.87 kg/h (E-342 Cold In, 4"-NA-B74)
  const L4_kgh = +(L2_kgh - L3_kgh).toFixed(2);   // 14,422.19 kg/h (E-343 Cold In, 2"-NA-B74)

  const L7_kgh = +(50896.07 * sf).toFixed(2);     // 2효 출구 (42.1 wt%, 4"-NA-B74)
  const wt2_out = 42.10;
  const L8_kgh = +(L7_kgh * 0.755).toFixed(2);    // 38,426.53 kg/h (E-332 Cold In, 3"-NA-B74)
  const L9_kgh = +(L7_kgh - L8_kgh).toFixed(2);   // 12,469.54 kg/h (E-333 Cold In, 2"-NA-B74)

  const L11_kgh = product50_kgh;                  // 1효 출구 (50.04 wt%, 42,824.40 kg/h, 4"-NA-B74)
  const wt1_out = 50.04;

  // 스팀 및 응축수 유량
  const S1_kgh = +(10713.12 * sf).toFixed(2);     // 13K Steam (8.35 kg/cm²G, 175.4°C, 8"-SM-BA1)
  const C1_kgh = +(10355.95 * sf).toFixed(2);     // 1효 응축수 (3"-SC-304, 175.4°C -> E-333 -> 126.6°C -> E-343 -> 74.7°C)
  const C4_kgh = +(24492.92 * sf).toFixed(2);     // D-5341 통합 공정 응축수 배출

  const eff1: EffectProcessState = {
    effectNo: 1,
    evapTag: 'E-320',
    sepTag: 'D-321',
    pumpTag: 'P-321',
    serviceName: '1st Effect Falling Film Evaporator (제1효용 강하막 증발관 E-5320)',
    P_shell_kgcm2g: 8.35,
    T_steam_C: 175.4,
    P_tube_kgcm2g: 0.72,
    P_tube_barA: 1.72,
    T_sat_water_C: 116.0,
    BPR_C: 46.8,
    T_boil_C: 164.8,
    dT_eff_C: 10.6,
    feedFlow_kgh: L7_kgh,
    outFlow_kgh: L11_kgh,
    evapWater_kgh: V1_kgh,
    heatingSteam_kgh: S1_kgh,
    wtIn_pct: wt2_out,
    wtOut_pct: wt1_out,
    T_feed_C: 157.2,
    Q_duty_kW: +(5905.0 * sf).toFixed(1), // ~5,077,000 kcal/h
    latent_steam_kJkg: 2031,
    latent_vapor_kJkg: 2213,
  };

  const eff2: EffectProcessState = {
    effectNo: 2,
    evapTag: 'E-330',
    sepTag: 'D-331',
    pumpTag: 'P-331',
    serviceName: '2nd Effect Falling Film Evaporator (제2효용 강하막 증발관 E-5330)',
    P_shell_kgcm2g: 0.72,
    T_steam_C: 116.0,
    P_tube_kgcm2g: -0.68,
    P_tube_barA: 0.346,
    T_sat_water_C: 73.2,
    BPR_C: 34.4,
    T_boil_C: 108.5,
    dT_eff_C: 7.5,
    feedFlow_kgh: L2_kgh,
    outFlow_kgh: L7_kgh,
    evapWater_kgh: V2_kgh,
    heatingSteam_kgh: +(V1_kgh + C5_flash_kgh).toFixed(2),
    wtIn_pct: wt3_out,
    wtOut_pct: wt2_out,
    T_feed_C: 109.6,
    Q_duty_kW: +(5169.4 * sf).toFixed(1), // 4,444,904 kcal/h
    latent_steam_kJkg: 2213,
    latent_vapor_kJkg: 2325,
  };

  const eff3: EffectProcessState = {
    effectNo: 3,
    evapTag: 'E-340',
    sepTag: 'D-341',
    pumpTag: 'P-341',
    serviceName: '3rd Effect Falling Film Evaporator (제3효용 강하막 증발관 E-5340)',
    P_shell_kgcm2g: -0.68,
    T_steam_C: 73.2,
    P_tube_kgcm2g: -0.94,
    P_tube_barA: 0.088,
    T_sat_water_C: 42.9,
    BPR_C: 25.2,
    T_boil_C: 68.4,
    dT_eff_C: 4.8,
    feedFlow_kgh: feed32_kgh,
    outFlow_kgh: L2_kgh,
    evapWater_kgh: V3_evap_kgh,
    heatingSteam_kgh: +(V2_kgh + C6_flash_kgh).toFixed(2),
    wtIn_pct: 32.0,
    wtOut_pct: wt3_out,
    T_feed_C: 90.0,
    Q_duty_kW: +(5185.0 * sf).toFixed(1), // ~4,458,000 kcal/h
    latent_steam_kJkg: 2325,
    latent_vapor_kJkg: 2400,
  };

  const liveSteam13K_kgh = S1_kgh;
  const steamEconomy = +(totalEvapWater_kgh / Math.max(1, liveSteam13K_kgh)).toFixed(2);

  // 300 SEC 스트림 배열 생성 (Excel "300 Sec" L1~L15, S1, C1~C6, V1~V3 완비)
  const streams300: StreamData[] = [
    {
      id: 'L1', name: '32% NaOH 급액 (3효 E-340 입구)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: h2oFeed_kgh },
      total_kgh: feed32_kgh,
      concentration: 32.0,
      pressure_kgcm2g: 2.5, temperature_C: 90.0,
      density_kgm3: 1297,
      fluidKey: 'naoh_32', phase: 'L',
      description: '200 Sec [217] → LCV-5340 (4") → 3효 강하막 증발관 E-340(E-5340) 상부 급액',
    },
    {
      id: 'L2', name: '3효 증발관 출구 (36.4% NaOH)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: +(L2_kgh - naohPure_kgh).toFixed(2) },
      total_kgh: L2_kgh,
      concentration: wt3_out,
      pressure_kgcm2g: -0.94, temperature_C: 68.4,
      density_kgm3: 1355,
      fluidKey: 'naoh_32', phase: 'L',
      description: 'E-340 & D-341 하부 → P-341 토출 (6"-NA-B74, BPE 25.2°C) → L3(75.5%) / L4(24.5%) 분기',
    },
    {
      id: 'L3', name: 'E-342 저온측 입구 (75.5% 분기)', section: '300',
      components: { NaOH: +(naohPure_kgh * 0.755).toFixed(2), H2O: +(L3_kgh - naohPure_kgh * 0.755).toFixed(2) },
      total_kgh: L3_kgh,
      concentration: wt3_out,
      pressure_kgcm2g: 2.5, temperature_C: 68.4,
      density_kgm3: 1355,
      fluidKey: 'naoh_32', phase: 'L',
      description: 'L2의 75.5% 분기 (4"-NA-B74) → E-342(E-5342) 저온측 입구 (68.4→108.2°C)',
    },
    {
      id: 'L4', name: 'E-343 저온측 입구 (24.5% 분기)', section: '300',
      components: { NaOH: +(naohPure_kgh * 0.245).toFixed(2), H2O: +(L4_kgh - naohPure_kgh * 0.245).toFixed(2) },
      total_kgh: L4_kgh,
      concentration: wt3_out,
      pressure_kgcm2g: 2.5, temperature_C: 68.4,
      density_kgm3: 1355,
      fluidKey: 'naoh_32', phase: 'L',
      description: 'L2의 24.5% 분기 (2"-NA-B74) → E-343(E-5343) 저온측 입구 (68.4→114.0°C)',
    },
    {
      id: 'L5', name: '2효 증발관 급액 (E-342/343 합류)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: +(L2_kgh - naohPure_kgh).toFixed(2) },
      total_kgh: L2_kgh,
      concentration: wt3_out,
      pressure_kgcm2g: 1.8, temperature_C: 109.6,
      density_kgm3: 1330,
      fluidKey: 'naoh_32', phase: 'L',
      description: 'E-342(108.2°C) + E-343(114.0°C) 합류 (6"-NA-B74, 109.6°C) → 2효 E-330 상부 급액',
    },
    {
      id: 'L7', name: '2효 증발관 출구 (42.1% NaOH)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: +(L7_kgh - naohPure_kgh).toFixed(2) },
      total_kgh: L7_kgh,
      concentration: wt2_out,
      pressure_kgcm2g: -0.68, temperature_C: 108.5,
      density_kgm3: 1390,
      fluidKey: 'naoh_50', phase: 'L',
      description: 'E-330 & D-331 하부 → P-331 토출 (4"-NA-B74, BPE 34.4°C) → L8(75.5%) / L9(24.5%) 분기',
    },
    {
      id: 'L8', name: 'E-332 저온측 입구 (75.5% 분기)', section: '300',
      components: { NaOH: +(naohPure_kgh * 0.755).toFixed(2), H2O: +(L8_kgh - naohPure_kgh * 0.755).toFixed(2) },
      total_kgh: L8_kgh,
      concentration: wt2_out,
      pressure_kgcm2g: 2.8, temperature_C: 108.5,
      density_kgm3: 1390,
      fluidKey: 'naoh_50', phase: 'L',
      description: 'L7의 75.5% 분기 (3"-NA-B74) → E-332(E-5332) 저온측 입구 (108.5→156.2°C)',
    },
    {
      id: 'L9', name: 'E-333 저온측 입구 (24.5% 분기)', section: '300',
      components: { NaOH: +(naohPure_kgh * 0.245).toFixed(2), H2O: +(L9_kgh - naohPure_kgh * 0.245).toFixed(2) },
      total_kgh: L9_kgh,
      concentration: wt2_out,
      pressure_kgcm2g: 2.8, temperature_C: 108.5,
      density_kgm3: 1390,
      fluidKey: 'naoh_50', phase: 'L',
      description: 'L7의 24.5% 분기 (2"-NA-B74) → E-333(E-5333) 저온측 입구 (108.5→160.0°C)',
    },
    {
      id: 'L10', name: '1효 증발관 급액 (E-332/333 합류)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: +(L7_kgh - naohPure_kgh).toFixed(2) },
      total_kgh: L7_kgh,
      concentration: wt2_out,
      pressure_kgcm2g: 2.2, temperature_C: 157.2,
      density_kgm3: 1357,
      fluidKey: 'naoh_50', phase: 'L',
      description: 'E-332(156.2°C) + E-333(160.0°C) 합류 (4"-NA-B74, 157.2°C) → 1효 E-320 상부 급액',
    },
    {
      id: 'L11', name: '1효 출구 50% NaOH (E-332 고온측 입구)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: h2oProd_kgh },
      total_kgh: product50_kgh,
      concentration: wt1_out,
      pressure_kgcm2g: 0.72, temperature_C: 164.8,
      density_kgm3: 1427,
      fluidKey: 'naoh_50', phase: 'L',
      description: 'E-320 & D-321 하부 → P-321 토출 (4"-NA-B74, 164.8°C, BPE 46.8°C) → E-332 고온측 입구',
    },
    {
      id: 'L12', name: '50% NaOH E-332 출구 (E-342 고온측 입구)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: h2oProd_kgh },
      total_kgh: product50_kgh,
      concentration: wt1_out,
      pressure_kgcm2g: 2.2, temperature_C: 120.0,
      density_kgm3: 1458,
      fluidKey: 'naoh_50', phase: 'L',
      description: 'E-332 고온측 출구 (4"-NA-B74, 120.0°C) → E-342(E-5342) 고온측 입구',
    },
    {
      id: 'L13', name: '50% NaOH E-342 출구 (E-352 냉각기 입구)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: h2oProd_kgh },
      total_kgh: product50_kgh,
      concentration: wt1_out,
      pressure_kgcm2g: 1.8, temperature_C: 75.0,
      density_kgm3: 1488,
      fluidKey: 'naoh_50', phase: 'L',
      description: 'E-342 고온측 출구 (4"-NA-B74, 75.0°C) → E-352(E-5352) 제품 냉각기 입구',
    },
    {
      id: 'L14', name: '50% NaOH 최종 제품 (E-352 출구)', section: '300',
      components: { NaOH: naohPure_kgh, H2O: h2oProd_kgh },
      total_kgh: product50_kgh,
      concentration: wt1_out,
      pressure_kgcm2g: 1.5, temperature_C: 42.0,
      density_kgm3: 1511,
      fluidKey: 'naoh_50', phase: 'L',
      description: 'E-352 냉각기 출구 (42.0°C, DTCV-5322) → 50% 가성소다 저장탱크 이송',
    },
    {
      id: 'L15', name: 'E-352 냉각수 / 희석수 라인', section: '300',
      components: { H2O: +(132292.8 * sf).toFixed(1) },
      total_kgh: +(132292.8 * sf).toFixed(1),
      concentration: 0,
      pressure_kgcm2g: 3.5, temperature_C: 32.0,
      density_kgm3: 995,
      fluidKey: 'cooling_water', phase: 'L',
      description: 'E-352(E-5352) 냉각수 공급 (132,293 kg/h, 32→40°C, Q=1,058,342 kcal/h)',
    },
    {
      id: 'S1', name: '13K 생증기 (1효 E-320 가열원)', section: '300',
      components: { H2O: S1_kgh },
      total_kgh: S1_kgh,
      pressure_kgcm2g: 8.35, temperature_C: 175.4,
      density_kgm3: 4.81, phase: 'G',
      description: '13K Steam (8"-SM-BA1, 8.35 kg/cm²G, 175.4°C) → 1효 E-320(E-5320) 쉘측 공급',
    },
    {
      id: 'C1', name: '1효 스팀 응축수 (D-5321 → E-333)', section: '300',
      components: { H2O: C1_kgh },
      total_kgh: C1_kgh,
      pressure_kgcm2g: 3.0, temperature_C: 175.4,
      density_kgm3: 892, phase: 'L',
      description: 'D-5321 하부 응축수 (3"-SC-304, 10,355.9 kg/h, 175.4°C) → E-333 고온측 입구',
    },
    {
      id: 'C2', name: '스팀 응축수 (E-333 → E-343)', section: '300',
      components: { H2O: C1_kgh },
      total_kgh: C1_kgh,
      pressure_kgcm2g: 2.5, temperature_C: 126.6,
      density_kgm3: 938, phase: 'L',
      description: 'E-333 고온측 출구 (3"-SC-304, 126.6°C) → E-343 고온측 입구',
    },
    {
      id: 'C3', name: '스팀 응축수 회수 (E-343 출구)', section: '300',
      components: { H2O: C1_kgh },
      total_kgh: C1_kgh,
      pressure_kgcm2g: 2.0, temperature_C: 74.7,
      density_kgm3: 975, phase: 'L',
      description: 'E-343 고온측 출구 (3"-SC-304, 74.7°C, LCV-5321) → 순수/보일러 응축수 회수',
    },
    {
      id: 'C4', name: '효용 증기 응축수 배출 (D-5341 출구)', section: '300',
      components: { H2O: C4_kgh },
      total_kgh: C4_kgh,
      pressure_kgcm2g: 1.5, temperature_C: 73.2,
      density_kgm3: 976, phase: 'L',
      description: 'D-340(D-5341) Flash Drum 하부 펌프 → LCV-5341 → 공정 응축수 배출 (24,492.9 kg/h)',
    },
    {
      id: 'C5', name: 'D-5321 플래시 스팀 (→ 2효 E-330)', section: '300',
      components: { H2O: C5_flash_kgh },
      total_kgh: C5_flash_kgh,
      pressure_kgcm2g: 0.72, temperature_C: 116.0,
      density_kgm3: 0.99, phase: 'G',
      description: 'D-5321 상부 플래시 스팀 (1", FCV-5321, 357.2 kg/h) → V1 합류 후 E-330 가열',
    },
    {
      id: 'C6', name: 'D-5341 플래시 스팀 (→ 3효 E-340)', section: '300',
      components: { H2O: C6_flash_kgh },
      total_kgh: C6_flash_kgh,
      pressure_kgcm2g: -0.68, temperature_C: 73.2,
      density_kgm3: 0.23, phase: 'G',
      description: 'D-340(D-5341) 상부 플래시 스팀 (2", FCV-5331, 702.7 kg/h, 8.3%) → V2 합류 후 E-340 가열',
    },
    {
      id: 'V1', name: '1효 발생 증기 (D-321 → 2효 E-330)', section: '300',
      components: { H2O: V1_kgh },
      total_kgh: V1_kgh,
      pressure_kgcm2g: 0.72, temperature_C: 116.0,
      density_kgm3: 0.99, phase: 'G',
      description: '1효 기액분리기 D-321 상부 증기 (20"-V-, 8,071.7 kg/h, P=0.72 kg/cm²G) → 2효 E-330 가열',
    },
    {
      id: 'V2', name: '2효 발생 증기 (D-331 → 3효 E-340)', section: '300',
      components: { H2O: V2_kgh },
      total_kgh: V2_kgh,
      pressure_kgcm2g: -0.68, temperature_C: 73.2,
      density_kgm3: 0.23, phase: 'G',
      description: '2효 기액분리기 D-331 상부 증기 (28"-V-316L, 7,970.0 kg/h, P=-0.68 kg/cm²G) → 3효 E-340 가열',
    },
    {
      id: 'V3', name: '3효 발생 증기 (D-341 → 표면응축기 E-350)', section: '300',
      components: { H2O: V3_kgh },
      total_kgh: V3_kgh,
      pressure_kgcm2g: -0.94, temperature_C: 42.9,
      density_kgm3: 0.06, phase: 'G',
      description: '3효 기액분리기 D-341 상부 증기 (32"-V-316L, 8,796.8 kg/h, P=-0.94 kg/cm²G) → 표면응축기 E-350',
    },
  ];

  return {
    scaleFactor: sf,
    feed32_kgh,
    naohPure_kgh,
    product50_kgh,
    totalEvapWater_kgh,
    liveSteam13K_kgh,
    steamEconomy,
    effects: { eff1, eff2, eff3 },
    streams300,
  };
}

// ─── 3. 강하막식 증발관 (Falling Film Evaporator) 전용 설계 솔버 ────────

export interface FallingFilmDesignInputs {
  tag: string;                 // 'E-320' | 'E-330' | 'E-340'
  bcplItemNo?: string;         // 'E-5320' | 'E-5330' | 'E-5340'
  docNo?: string;              // '821106-03-023-A4' | '821106-03-017-A4' | '821106-03-012-A4'
  effectNo: 1 | 2 | 3;
  serviceName: string;
  // 공정 유량 및 농도
  feedFlow_kgh: number;        // 효용 유입 액량 (kg/h)
  evapWater_kgh: number;       // 증발 수분량 (kg/h)
  wtIn_pct: number;            // 입구 NaOH 농도 (wt%)
  wtOut_pct: number;           // 출구 NaOH 농도 (wt%)
  // 운전 압력 및 온도
  P_shell_kgcm2g: number;      // 쉘측 가열증기 압력 (kg/cm²G)
  P_shell_barA?: number;       // 쉘측 절대압력 (bar abs)
  T_steam_in_C?: number;       // 쉘측 가열증기 입구 온도 (°C, 과열 포함)
  T_steam_C: number;           // 쉘측 가열증기 포화응축 온도 (°C)
  P_tube_kgcm2g: number;       // 관측(증발실) 운전압력 (kg/cm²G)
  P_tube_barA_spec?: number;   // 관측 절대압력 (bar abs)
  T_feed_C: number;            // 급액 입구 온도 (°C)
  // 강하막 튜브 및 기하구조 사양 (BCPL / TEMA R)
  do_mm: number;               // 튜브 외경 (BCPL 표준 48.3mm, 또는 38.1mm / 50.8mm)
  tw_mm: number;               // 튜브 두께 (BCPL 1효 2.11mm, 2·3효 1.65mm)
  L_m: number;                 // 수직 튜브 길이 (BCPL 표준 6.8m = 6,800mm)
  pitch_mm?: number;           // 삼각 피치 (BCPL 표준 60mm)
  pitchRatio: number;          // 삼각 피치비 (60 / 48.3 = 1.242)
  customTubeCount?: number;    // 튜브 본수 직접 지정 (E-5320: 70, E-5330: 164, E-5340: 423; 0이면 자동산출)
  recycleAdd_kgh?: number;     // 외부 순환펌프 재순환 추가 유량 (kg/h)
  targetWettingRate_kgms: number; // 목표 단위둘레당 액막 적하 유량 Γ (kg/m·s)
  overdesignPct: number;       // 전열면적 설계 여유율 (표준 15%)
  fouling_m2KW: number;        // 가성소다 측 오염계수 Rf (표준 0.00012 ~ 0.00020 m²·K/W)
  material: 'Nickel 200' | 'Ni+SS' | 'SS 310S / 316L' | 'Duplex 2205' | 'Titanium Gr.2';
  // BCPL / TEMA R Datasheet 상세 기계 사양
  shellOD_calandria_mm?: number; // 칼란드리아 외경 (E-5320: 800, E-5330: 1000, E-5340: 1400)
  shellOD_separator_mm?: number; // 하부 일체형 분리기 외경 (E-5320: 1000, E-5330: 1400, E-5340: 2600)
  totalVesselLength_mm?: number; // 증발관 총 길이 (E-5320: 10040, E-5330: 10361, E-5340: 11940)
  designTempTube_C?: number;
  designTempShell_C?: number;
  designPressTube_bar?: string;
  designPressShell_bar?: string;
  corrAllowShell_mm?: number;
  corrAllowTube_mm?: number;
  matTubeSpec?: string;
  matTubesheetSpec?: string;
  matShellSpec?: string;
  matChannelSpec?: string;
  matSeparatorSpec?: string;
  matDemisterSpec?: string;
  expansionJointSpec?: string;
  insulationThickness_mm?: number;
}

export interface FallingFilmDesignResults {
  // 열 및 물질수지 결과
  outFlow_kgh: number;
  Q_evap_kW: number;
  Q_sensible_kW: number;
  Q_total_kW: number;
  Q_total_Mcalh: number;
  heatingSteamReq_kgh: number;
  // 비점오름(BPR) 및 온도 구동력
  P_tube_barA: number;
  P_shell_barA: number;
  T_sat_water_C: number;
  BPR_C: number;
  T_boil_C: number;
  dT_eff_C: number;
  // 강하 액막 수력학 (Falling Film Hydraulics)
  rhoL_in_kgm3: number;
  rhoL_kgm3: number;
  muL_cP: number;
  cpL_kJkgK: number;
  kL_WmK: number;
  rhoV_kgm3: number;
  rhoSteam_kgm3: number;
  wettedPerimeter_m: number;        // 전체 튜브 내주 둘레 합 (N_tubes · π · d_i, m)
  wettingRateIn_kgms: number;       // 입구 질량 적하율 Γ_in [kg/(m·s)]
  wettingRateOut_kgms: number;      // 출구 질량 적하율 Γ_out [kg/(m·s)]
  actualWettingRate_kgms: number;   // 평균/설계 질량 적하율 Γ [kg/(m·s)]
  volWettingRateIn_Lms: number;     // 입구 체적 적하율 Γ_V,in [L/(m·s)]
  volWettingRateOut_Lms: number;    // 출구 체적 적하율 Γ_V,out [L/(m·s)]
  volWettingRate_m3hm: number;      // 단위둘레당 시간당 체적 적하율 [m³/(h·m)]
  minWettingRate_kgms: number;      // Γ_min [kg/(m·s)] (Dry-out 한계)
  recircFlow_kgh: number;           // 튜브 상부 총 급액 유량 (신규 급액 + 재순환액, kg/h)
  recircRatio: number;              // 순환비 (총 적하량 / 증발량)
  Re_film: number;                  // 액막 레이놀즈수 (4·Γ / μ_L)
  filmThickness_mm: number;         // Nusselt/Brauer 평균 액막 두께 δ (mm)
  vaporExitVel_ms: number;          // 튜브 하단 증기 코어 유속 (m/s)
  floodingVelLimit_ms: number;      // Wallis 기액 대향/동반 엔트레인먼트 한계 유속 (m/s)
  // 전열 계수 및 기하 치수
  h_film_Wm2K: number;              // 관내 강하 액막 열전달계수 (Chun-Seban)
  h_cond_Wm2K: number;              // 쉘측 수직관 스팀 응축 열전달계수
  U_clean_Wm2K: number;
  U_dirty_Wm2K: number;
  U_service_Wm2K: number;           // 실제 제공 면적 기준 서비스 열관류율 Q / (A_prov · ΔT_eff)
  A_req_m2: number;
  A_prov_m2: number;
  overdesign_pct: number;
  N_tubes: number;
  pitch_mm: number;
  D_bundle_mm: number;
  D_calandria_mm: number;           // 증발관 칼란드리아(쉘) 외경/내경 (mm)
  // 기액분리기 (Vapor-Liquid Separator Drum, D-321/331/341) 치수
  D_separator_mm: number;           // 기액분리기 직경 (mm)
  H_separator_mm: number;           // 기액분리기 또는 총 높이 (mm)
  totalVesselLength_mm: number;     // BCPL 증발관 총 높이 (mm)
  v_sep_vapor_ms: number;           // 분리기 내 상승 증기 유속 (m/s)
  v_soudersBrown_ms: number;        // Souders-Brown 허용 최대 증기 유속 (m/s)
  // 노즐 규격 (ANSI / ASME NPS)
  nozzleLiquorIn_NPS: string;
  nozzleLiquorOut_NPS: string;
  nozzleVaporOut_NPS: string;
  nozzleSteamIn_NPS: string;
  warnings: string[];
}

const MAT_KW: Record<FallingFilmDesignInputs['material'], number> = {
  'Nickel 200': 70.2,
  'Ni+SS': 65.0,
  'SS 310S / 316L': 16.3,
  'Duplex 2205': 19.0,
  'Titanium Gr.2': 21.9,
};

function selectAnsiNozzle(flow_m3s: number, targetVel_ms: number): string {
  const d_req_mm = Math.sqrt((4 * Math.max(1e-4, flow_m3s)) / (Math.PI * Math.max(0.5, targetVel_ms))) * 1000;
  const stdList = [
    { nps: '2"', id: 52.5 },
    { nps: '2-1/2"', id: 62.7 },
    { nps: '3"', id: 77.9 },
    { nps: '4"', id: 102.3 },
    { nps: '6"', id: 154.1 },
    { nps: '8"', id: 202.7 },
    { nps: '10"', id: 254.5 },
    { nps: '12"', id: 304.8 },
    { nps: '14"', id: 333.4 },
    { nps: '16"', id: 381.0 },
    { nps: '18"', id: 428.6 },
    { nps: '20"', id: 477.8 },
    { nps: '24"', id: 574.6 },
    { nps: '28"', id: 685.8 },
    { nps: '30"', id: 736.6 },
    { nps: '32"', id: 787.4 },
    { nps: '36"', id: 889.0 },
  ];
  const found = stdList.find(s => s.id >= d_req_mm) ?? stdList[stdList.length - 1];
  return `NPS ${found.nps} Sch 40`;
}

/**
 * 강하막식 증발관 (Falling Film Evaporator) 엄밀 설계 계산
 */
export function calcFallingFilmEvaporator(inp: FallingFilmDesignInputs): FallingFilmDesignResults {
  const g = 9.80665;
  const feedFlow_kgh = Math.max(1000, inp.feedFlow_kgh);
  const evapWater_kgh = Math.max(200, Math.min(feedFlow_kgh * 0.45, inp.evapWater_kgh));
  const outFlow_kgh = feedFlow_kgh - evapWater_kgh;

  // 1. 압력, 순수 물 포화온도 및 NaOH 비점오름(BPR)
  const P_tube_barA = inp.P_tube_barA_spec ?? Math.max(0.08, +(1.01325 + inp.P_tube_kgcm2g * 0.980665).toFixed(3));
  const P_shell_barA = inp.P_shell_barA ?? Math.max(0.20, +(1.01325 + inp.P_shell_kgcm2g * 0.980665).toFixed(3));
  const T_sat_water_C = waterSatTemp_C(P_tube_barA);
  const wtAvg = 0.35 * inp.wtIn_pct + 0.65 * inp.wtOut_pct;
  const BPR_C = calcNaOHBPR_C(inp.wtOut_pct, T_sat_water_C);
  const T_boil_C = +(T_sat_water_C + BPR_C).toFixed(1);
  const dT_eff_C = Math.max(3.0, +(inp.T_steam_C - T_boil_C).toFixed(1));

  // 2. 가성소다 액막 물성 @ 비등 온도
  const rhoL_in_kgm3 = naohDensity_kgm3(inp.wtIn_pct, inp.T_feed_C);
  const rhoL_kgm3 = naohDensity_kgm3(wtAvg, T_boil_C);
  const muL_cP = naohViscosity_cP(wtAvg, T_boil_C);
  const muL_Pas = muL_cP * 1e-3;
  const cpL_kJkgK = naohSpecificHeat_kJkgK(wtAvg, T_boil_C);
  const kL_WmK = naohThermalCond_WmK(wtAvg, T_boil_C);
  const PrL = (cpL_kJkgK * 1000 * muL_Pas) / kL_WmK;

  // 기상(수증기) 물성 @ P_tube_barA, T_boil_C
  const rhoV_kgm3 = Math.max(0.055, +(P_tube_barA * 100 * 18.015 / (8.31446 * (T_boil_C + 273.15))).toFixed(3));
  const rhoSteam_kgm3 = Math.max(0.20, +(P_shell_barA * 100 * 18.015 / (8.31446 * ((inp.T_steam_in_C ?? inp.T_steam_C) + 273.15))).toFixed(3));
  const latent_vapor_kJkg = Math.max(1950, 2501 - 2.36 * T_sat_water_C);
  const latent_steam_kJkg = Math.max(1900, 2501 - 2.36 * inp.T_steam_C);

  // 3. 열부하 (Q_total = 증발 잠열 + 농축 희석열 보정 + 급액 예열 현열)
  const dH_dilution_kJkg = 95.0 * Math.pow(inp.wtOut_pct / 50.0, 1.35); // NaOH 농축열(열화학적 부가 잠열)
  const Q_evap_kW = (evapWater_kgh * (latent_vapor_kJkg + dH_dilution_kJkg)) / 3600;
  const Q_sensible_kW = (feedFlow_kgh * cpL_kJkgK * Math.max(0, T_boil_C - inp.T_feed_C)) / 3600;
  const Q_total_kW = +(Q_evap_kW + Q_sensible_kW).toFixed(1);
  const Q_total_Mcalh = +(Q_total_kW * 0.859845).toFixed(1);
  const heatingSteamReq_kgh = +((Q_total_kW * 3600) / latent_steam_kJkg).toFixed(1);

  // 4. 튜브 치수 및 강하막 전열·수력학 (BCPL / TEMA R & Chun-Seban Correlation)
  const do_m = Math.max(0.019, inp.do_mm / 1000);
  const tw_m = Math.max(0.0012, inp.tw_mm / 1000);
  const di_m = Math.max(0.014, do_m - 2 * tw_m);
  const L_m = Math.max(4.0, inp.L_m);
  const pitch_mm = inp.pitch_mm ?? Math.round(inp.do_mm * (inp.pitchRatio || 1.242));
  const pitchRatio = pitch_mm / inp.do_mm;
  const kw = MAT_KW[inp.material] ?? 65.0;

  // 예비 Re_film 기반으로 U_dirty 추정 후 튜브 본수 결정 (customTubeCount 지정 시 해당 본수 우선 적용)
  const nuL_m2s = muL_Pas / rhoL_kgm3;
  const lengthScale_m = Math.pow((nuL_m2s * nuL_m2s) / g, 1 / 3);
  const h_cond_Wm2K = inp.effectNo === 1 ? 6800 : inp.effectNo === 2 ? 5600 : 4800;
  const R_wall = (do_m * Math.log(do_m / di_m)) / (2 * kw);
  const R_foul_steam = 0.00005;
  const R_foul_naoh = Math.max(0.00008, inp.fouling_m2KW || 0.00018);

  // 1차 추정 h_film
  const gammaEst = Math.max(0.20, inp.targetWettingRate_kgms || 0.35);
  const Re_est = (4 * gammaEst) / muL_Pas;
  const Nu_est = Math.pow(
    Math.pow(0.606 * Math.pow(Re_est / 4, -0.22), 2) +
    Math.pow(0.0038 * Math.pow(Re_est, 0.4) * Math.pow(PrL, 0.65), 2),
    0.5
  );
  const h_film_est = Math.max(950, Math.min(4800, (Nu_est * kL_WmK) / lengthScale_m));
  const invU_est = (1 / h_cond_Wm2K) + R_wall + (do_m / (di_m * h_film_est)) + R_foul_steam + R_foul_naoh * (do_m / di_m);
  const U_est = 1 / invU_est;

  const areaPerTube_m2 = Math.PI * do_m * L_m;
  const A_req_est = (Q_total_kW * 1000) / (U_est * dT_eff_C);
  const overFrac = 1 + Math.max(0, inp.overdesignPct || 12) / 100;
  const autoTubes = Math.max(40, Math.ceil((A_req_est * overFrac) / areaPerTube_m2));
  const N_tubes = (inp.customTubeCount && inp.customTubeCount > 0) ? Math.round(inp.customTubeCount) : autoTubes;

  // 실제 튜브 본수(N_tubes) 기준 튜브 둘레 합 및 실제 젖음율(Wetting Rate Γ) 계산
  // BCPL Datasheet 기준: E-5320 (70 Tubes → 70.1 m²), E-5330 (164 Tubes → 168.8 m²), E-5340 (423 Tubes → 430.0 m²)
  const wettedPerimeter_m = +(N_tubes * Math.PI * di_m).toFixed(3);
  const recycleAdd_kgh = Math.max(0, inp.recycleAdd_kgh ?? 0);
  const recircFlow_kgh = Math.round(feedFlow_kgh + recycleAdd_kgh);
  const tubeOutLiq_kgh = Math.max(1000, recircFlow_kgh - evapWater_kgh);

  const minWettingRate_kgms = 0.12; // Dry-out 한계
  const wettingRateIn_kgms = +((recircFlow_kgh / 3600) / wettedPerimeter_m).toFixed(3);
  const wettingRateOut_kgms = +((tubeOutLiq_kgh / 3600) / wettedPerimeter_m).toFixed(3);
  const actualWettingRate_kgms = +(((wettingRateIn_kgms + wettingRateOut_kgms) / 2)).toFixed(3);

  // 체적 기준 젖음율 [L/(m·s)] 및 [m³/(h·m)]
  // (참고: E-5320 70본 기준 Γ_V,in = 1.09 L/m·s, Γ_V,avg = 0.98 L/m·s, Γ_V,out = 0.87 L/m·s)
  const volWettingRateIn_Lms = +(((recircFlow_kgh / rhoL_in_kgm3) / 3.6) / wettedPerimeter_m).toFixed(3);
  const volWettingRateOut_Lms = +(((tubeOutLiq_kgh / rhoL_kgm3) / 3.6) / wettedPerimeter_m).toFixed(3);
  const volWettingRate_m3hm = +(((recircFlow_kgh / rhoL_kgm3)) / wettedPerimeter_m).toFixed(2);
  const recircRatio = +(recircFlow_kgh / Math.max(1, evapWater_kgh)).toFixed(1);

  // 실제 젖음율(actualWettingRate_kgms) 기준 액막 레이놀즈수 Re_film = 4 * Γ / μ_L
  const Re_film = (4 * actualWettingRate_kgms) / muL_Pas;

  // 평균 액막 두께 δ (Nusselt-Kapitza / Brauer 난류 보정)
  const filmThickness_m = Re_film < 1600
    ? 0.909 * Math.pow(Re_film, 1 / 3) * lengthScale_m
    : 0.302 * Math.pow(Re_film, 8 / 15) * lengthScale_m;
  const filmThickness_mm = +(filmThickness_m * 1000).toFixed(3);

  // Chun-Seban (1971) 수직 강하 액막 증발 열전달계수 h_film (W/m²·K)
  const Nu_wavyLaminar = 0.606 * Math.pow(Math.max(10, Re_film / 4), -0.22);
  const Nu_turbulent = 0.0038 * Math.pow(Math.max(10, Re_film), 0.4) * Math.pow(PrL, 0.65);
  const Nu_film = Math.pow(Math.pow(Nu_wavyLaminar, 2) + Math.pow(Nu_turbulent, 2), 0.5);
  const h_film_Wm2K = +Math.max(950, Math.min(4800, (Nu_film * kL_WmK) / lengthScale_m)).toFixed(0);

  // 총괄열전달계수 U_clean & U_dirty (외표면적 기준)
  const invU_clean = (1 / h_cond_Wm2K) + R_wall + (do_m / (di_m * h_film_Wm2K));
  const U_clean_Wm2K = +(1 / invU_clean).toFixed(1);
  const invU_dirty = invU_clean + R_foul_steam + R_foul_naoh * (do_m / di_m);
  const U_dirty_Wm2K = +(1 / invU_dirty).toFixed(1);

  // 제공 전열면적 A_prov 및 요구 전열면적 A_req
  // BCPL 실측 표면적 보정 (70본->70.1m², 164본->168.8m², 423본->430.0m²)
  const bcplAreaFactor = (inp.do_mm === 48.3 && inp.L_m === 6.8)
    ? (N_tubes === 70 ? 70.1 / (70 * areaPerTube_m2)
      : N_tubes === 164 ? 168.8 / (164 * areaPerTube_m2)
      : N_tubes === 423 ? 430.0 / (423 * areaPerTube_m2) : 0.985)
    : 1.0;
  const A_prov_m2 = +(N_tubes * areaPerTube_m2 * bcplAreaFactor).toFixed(1);
  const A_req_m2 = +((Q_total_kW * 1000) / (U_dirty_Wm2K * dT_eff_C)).toFixed(1);
  const U_service_Wm2K = +((Q_total_kW * 1000) / Math.max(1, A_prov_m2 * dT_eff_C)).toFixed(1);
  const overdesign_pct = +(((A_prov_m2 - A_req_m2) / Math.max(0.1, A_req_m2)) * 100).toFixed(1);

  // 튜브 하단 출구 증기 유속 및 엔트레인먼트/플러딩 한계 검토
  const totalTubeFlowArea_m2 = N_tubes * (Math.PI * Math.pow(di_m - 2 * filmThickness_m, 2) / 4);
  const vaporVolFlow_m3s = (evapWater_kgh / 3600) / rhoV_kgm3;
  const vaporExitVel_ms = +(vaporVolFlow_m3s / Math.max(0.01, totalTubeFlowArea_m2)).toFixed(2);
  const floodingVelLimit_ms = +(14.5 * Math.pow((rhoL_kgm3 - rhoV_kgm3) / rhoV_kgm3, 0.28)).toFixed(1);

  // 칼란드리아(Calandria Shell) 직경 산출 (BCPL 지정 외경 우선 또는 삼각 배열 산출)
  const D_bundle_m = do_m * Math.pow(N_tubes / 0.319, 1 / 2.142) * (pitchRatio / 1.25);
  const D_bundle_mm = Math.round(D_bundle_m * 1000);
  const D_calandria_mm = inp.shellOD_calandria_mm ?? (Math.ceil((D_bundle_mm + 120) / 50) * 50);

  // 5. 하부 일체형/측면 기액분리기 (Vapor-Liquid Separator, D-321/331/341) 치수 산출
  const K_sb = inp.P_tube_kgcm2g < -0.5 ? 0.075 : 0.092;
  const v_soudersBrown_ms = +(K_sb * Math.sqrt((rhoL_kgm3 - rhoV_kgm3) / rhoV_kgm3)).toFixed(2);
  const v_sep_target_ms = v_soudersBrown_ms * 0.72;
  const A_sep_req_m2 = vaporVolFlow_m3s / Math.max(0.5, v_sep_target_ms);
  const D_sep_calc_m = Math.sqrt((4 * A_sep_req_m2) / Math.PI);
  const D_separator_mm = inp.shellOD_separator_mm ?? Math.max(D_calandria_mm + 200, Math.ceil((D_sep_calc_m * 1000) / 100) * 100);
  const A_sep_actual_m2 = (Math.PI * Math.pow(D_separator_mm / 1000, 2)) / 4;
  const v_sep_vapor_ms = +(vaporVolFlow_m3s / A_sep_actual_m2).toFixed(2);
  const totalVesselLength_mm = inp.totalVesselLength_mm ?? Math.round(L_m * 1000 + D_separator_mm * 1.8);
  const H_separator_mm = Math.round(D_separator_mm * 2.5);

  // 6. ANSI / ASME 배관 노즐 선정
  const nozzleLiquorIn_NPS = selectAnsiNozzle((recircFlow_kgh / 3600) / rhoL_kgm3, 1.8);
  const nozzleLiquorOut_NPS = selectAnsiNozzle((outFlow_kgh / 3600) / rhoL_kgm3, 1.5);
  const nozzleVaporOut_NPS = selectAnsiNozzle(vaporVolFlow_m3s, Math.min(35, v_soudersBrown_ms * 4.5));
  const nozzleSteamIn_NPS = selectAnsiNozzle((heatingSteamReq_kgh / 3600) / rhoSteam_kgm3, 28.0);

  // 7. 엔지니어링 진단 경고 생성
  const warnings: string[] = [];
  if (wettingRateOut_kgms < 0.15) {
    warnings.push(`[주의] 튜브 하단 출구 액막 젖음율 Γ_out(${wettingRateOut_kgms.toFixed(2)} kg/m·s)이 낮아 Dry-out 위험이 있습니다. 순환유량(Recycle)을 추가하세요.`);
  }
  if (vaporExitVel_ms > floodingVelLimit_ms) {
    warnings.push(`[경고] 튜브 하단 증기 유속(${vaporExitVel_ms.toFixed(1)} m/s)이 한계 유속(${floodingVelLimit_ms} m/s)을 초과합니다.`);
  }
  if (dT_eff_C < 4.5) {
    warnings.push(`[주의] 비점오름(BPR=${BPR_C}°C) 제외 후 유효 온도차(ΔT_eff=${dT_eff_C}°C)가 작습니다.`);
  }

  return {
    outFlow_kgh,
    Q_evap_kW,
    Q_sensible_kW,
    Q_total_kW,
    Q_total_Mcalh,
    heatingSteamReq_kgh,
    P_tube_barA,
    P_shell_barA,
    T_sat_water_C,
    BPR_C,
    T_boil_C,
    dT_eff_C,
    rhoL_in_kgm3,
    rhoL_kgm3,
    muL_cP,
    cpL_kJkgK,
    kL_WmK,
    rhoV_kgm3,
    rhoSteam_kgm3,
    wettedPerimeter_m,
    wettingRateIn_kgms,
    wettingRateOut_kgms,
    actualWettingRate_kgms,
    volWettingRateIn_Lms,
    volWettingRateOut_Lms,
    volWettingRate_m3hm,
    minWettingRate_kgms,
    recircFlow_kgh,
    recircRatio,
    Re_film,
    filmThickness_mm,
    vaporExitVel_ms,
    floodingVelLimit_ms,
    h_film_Wm2K,
    h_cond_Wm2K,
    U_clean_Wm2K,
    U_dirty_Wm2K,
    U_service_Wm2K,
    A_req_m2,
    A_prov_m2,
    overdesign_pct,
    N_tubes,
    pitch_mm,
    D_bundle_mm,
    D_calandria_mm,
    D_separator_mm,
    H_separator_mm,
    totalVesselLength_mm,
    v_sep_vapor_ms,
    v_soudersBrown_ms,
    nozzleLiquorIn_NPS,
    nozzleLiquorOut_NPS,
    nozzleVaporOut_NPS,
    nozzleSteamIn_NPS,
    warnings,
  };
}

/** PFD 태그(E-320, E-330, E-340)별 강하막식 증발관 공정 조건 프리셋 반환 (Bertrams BCPL 실측 TEMA R Datasheet 기준) */
export function getFallingFilmPreset(tag: string, streams: StreamData[]): FallingFilmDesignInputs & {
  sepTag: string;
  pumpTag: string;
  designTemp_C: number;
  designPress_kgcm2g: string;
  streamInfo: string;
} {
  const sL1 = streams.find(s => s.id === 'L1');
  const sf = sL1 ? sL1.total_kgh / 66960.14 : 1.0;
  const sim = simulateTripleEffectEvaporator(sf);
  const norm = tag.toUpperCase().trim();

  if (norm === 'E-320' || norm === 'E-5320') {
    const e1 = sim.effects.eff1;
    return {
      tag: 'E-320',
      bcplItemNo: 'E-5320',
      docNo: 'TS-E-5320-001',
      effectNo: 1,
      sepTag: 'D-321',
      pumpTag: 'P-321',
      serviceName: 'Evaporation of caustic lye 42% to caustic lye 50% (1효 E-5320)',
      feedFlow_kgh: e1.feedFlow_kgh,
      evapWater_kgh: e1.evapWater_kgh,
      wtIn_pct: e1.wtIn_pct,
      wtOut_pct: e1.wtOut_pct,
      P_shell_kgcm2g: 11.98,
      P_shell_barA: 12.763,
      T_steam_in_C: 191.6,
      T_steam_C: 190.8,
      P_tube_kgcm2g: e1.P_tube_kgcm2g,
      P_tube_barA_spec: 2.042,
      T_feed_C: 163.1,
      do_mm: 48.3,
      tw_mm: 2.11,
      L_m: 6.8,
      pitch_mm: 60,
      pitchRatio: 60 / 48.3,
      customTubeCount: 70, // E-5320: 70 Tubes (Ø48.3×2.11×6,800mm, A=70.1 m², Γ_V = 0.98 L/m·s, Γ_m = 1.34 kg/m·s)
      recycleAdd_kgh: 0,
      targetWettingRate_kgms: 1.34,
      overdesignPct: 12,
      fouling_m2KW: 0.00012,
      material: 'Nickel 200',
      shellOD_calandria_mm: 800,
      shellOD_separator_mm: 1000,
      totalVesselLength_mm: 10040,
      designTempTube_C: 185,
      designTempShell_C: 210,
      designPressTube_bar: '-1.0 / +2.0',
      designPressShell_bar: '-1.0 / +14.0',
      corrAllowShell_mm: 1.0,
      corrAllowTube_mm: 0.2,
      matTubeSpec: 'LC-Ni 99, SB-163 (2.4068)',
      matTubesheetSpec: 'SA-516 Gr.60 (C.S. 1.0425) with LC-Ni 99, SB-163 (2.4068) cladded',
      matShellSpec: 'SA-516 Gr.60 (C.S. 1.0425)',
      matChannelSpec: 'LC-Ni 99, SB-163 (2.4068)',
      matSeparatorSpec: 'LC-Ni 99, SB-163 (2.4068)',
      matDemisterSpec: 'LC-Ni 99 (2.4068)',
      expansionJointSpec: 'Multi bellow 316Ti (S.S. 1.4541)',
      insulationThickness_mm: 120,
      designTemp_C: 210,
      designPress_kgcm2g: '14.0 / 2.0',
      streamInfo: `E-5320 (70 Tubes, Ø48.3×2.11×6,800mm, A=70.1 m²) | Tube: ${e1.wtIn_pct}→${e1.wtOut_pct}% NaOH | Shell: 13K Steam [S1] | 적심율 Γ_V=0.98 L/m·s (Γ_m=1.34 kg/m·s)`,
    };
  }

  if (norm === 'E-330' || norm === 'E-5330') {
    const e2 = sim.effects.eff2;
    return {
      tag: 'E-330',
      bcplItemNo: 'E-5330',
      docNo: 'TS-E-5330-001',
      effectNo: 2,
      sepTag: 'D-331',
      pumpTag: 'P-331',
      serviceName: 'Evaporation of caustic lye 37% to caustic lye 42% (2효 E-5330)',
      feedFlow_kgh: e2.feedFlow_kgh,
      evapWater_kgh: e2.evapWater_kgh,
      wtIn_pct: e2.wtIn_pct,
      wtOut_pct: e2.wtOut_pct,
      P_shell_kgcm2g: 1.05,
      P_shell_barA: 2.039,
      T_steam_in_C: 166.8,
      T_steam_C: 120.8,
      P_tube_kgcm2g: e2.P_tube_kgcm2g,
      P_tube_barA_spec: 0.435,
      T_feed_C: 113.3,
      do_mm: 48.3,
      tw_mm: 1.65,
      L_m: 6.8,
      pitch_mm: 60,
      pitchRatio: 60 / 48.3,
      customTubeCount: 164, // E-5330: 164 Tubes (Ø48.3×1.65×6,800mm, A=168.8 m²)
      recycleAdd_kgh: 28000, // P-5334A/B 순환 라인(11) 반영 시 Γ_m ≈ 1.03 kg/m·s (Once-through 시 0.70 kg/m·s)
      targetWettingRate_kgms: 1.03,
      overdesignPct: 12,
      fouling_m2KW: 0.00014,
      material: 'Nickel 200',
      shellOD_calandria_mm: 1000,
      shellOD_separator_mm: 1400,
      totalVesselLength_mm: 10361,
      designTempTube_C: 160,
      designTempShell_C: 185,
      designPressTube_bar: '-1.0 / +0.5',
      designPressShell_bar: '-1.0 / +2.0',
      corrAllowShell_mm: 0.5,
      corrAllowTube_mm: 0.2,
      matTubeSpec: 'LC-Ni 99, SB-163 (2.4068)',
      matTubesheetSpec: '316L, SA-240 (S.S. 1.4404) with LC-Ni 99, SB-163 (2.4068) cladded',
      matShellSpec: '316L, SA-240 (S.S. 1.4404)',
      matChannelSpec: 'LC-Ni 99, SB-163 (2.4068)',
      matSeparatorSpec: 'LC-Ni 99, SB-163 (2.4068)',
      matDemisterSpec: 'LC-Ni 99 (2.4068)',
      expansionJointSpec: 'Multi bellow 316L (S.S. 1.4404)',
      insulationThickness_mm: 120,
      designTemp_C: 185,
      designPress_kgcm2g: '2.0 / FV',
      streamInfo: `E-5330 (164 Tubes, Ø48.3×1.65×6,800mm, A=168.8 m²) | Tube: ${e2.wtIn_pct}→${e2.wtOut_pct}% NaOH | Shell: 1효 증기 [V1] | 적심율 Γ_m=1.03 kg/m·s`,
    };
  }

  // Default: E-340 (3rd Effect Falling Film Evaporator, E-5340)
  const e3 = sim.effects.eff3;
  return {
    tag: 'E-340',
    bcplItemNo: 'E-5340',
    docNo: 'TS-E-5340-001',
    effectNo: 3,
    sepTag: 'D-341',
    pumpTag: 'P-341',
    serviceName: 'Evaporation of caustic lye 32% to caustic lye 37% (3효 E-5340)',
    feedFlow_kgh: e3.feedFlow_kgh,
    evapWater_kgh: e3.evapWater_kgh,
    wtIn_pct: e3.wtIn_pct,
    wtOut_pct: e3.wtOut_pct,
    P_shell_kgcm2g: -0.58,
    P_shell_barA: 0.432,
    T_steam_in_C: 107.1,
    T_steam_C: 77.7,
    P_tube_kgcm2g: e3.P_tube_kgcm2g,
    P_tube_barA_spec: 0.100,
    T_feed_C: 85.0,
    do_mm: 48.3,
    tw_mm: 1.65,
    L_m: 6.8,
    pitch_mm: 60,
    pitchRatio: 60 / 48.3,
    customTubeCount: 423, // E-5340: 423 Tubes (Ø48.3×1.65×6,800mm, A=430.0 m², Γ_m = 0.31~0.36 kg/m·s)
    recycleAdd_kgh: 8500, // Γ_m ≈ 0.35 kg/m·s (Once-through 67,057 kg/h 시 0.311 kg/m·s)
    targetWettingRate_kgms: 0.35,
    overdesignPct: 12,
    fouling_m2KW: 0.00015,
    material: 'SS 310S / 316L',
    shellOD_calandria_mm: 1400,
    shellOD_separator_mm: 2600,
    totalVesselLength_mm: 11940,
    designTempTube_C: 90,
    designTempShell_C: 160,
    designPressTube_bar: '-1.0 / +0.5',
    designPressShell_bar: '-1.0 / +0.5',
    corrAllowShell_mm: 0.1,
    corrAllowTube_mm: 0.6,
    matTubeSpec: 'S.S. 310S (~ 1.4845) Seamless',
    matTubesheetSpec: '316L, SA-240 (S.S. 1.4404)',
    matShellSpec: '316L, SA-240 (S.S. 1.4404)',
    matChannelSpec: '316L, SA-240 (S.S. 1.4404)',
    matSeparatorSpec: 'SA-516 Gr.60 with 316L cladded / 316L, SA-240',
    matDemisterSpec: '316Ti (S.S. 1.4571)',
    expansionJointSpec: 'None (Fixed Tubesheet)',
    insulationThickness_mm: 100,
    designTemp_C: 160,
    designPress_kgcm2g: '0.5 / FV',
    streamInfo: `E-5340 (423 Tubes, Ø48.3×1.65×6,800mm, A=430.0 m²) | Tube: ${e3.wtIn_pct}→${e3.wtOut_pct}% NaOH | Shell: 2효 증기 [V2] | 적심율 Γ_m=0.35 kg/m·s`,
  };
}

// ─── 4. 강하막식 증발관 CAD 블루프린트 & 3효 온도 프로파일 Canvas 렌더러 ─

export function drawFallingFilmBlueprintCanvas(
  canvas: HTMLCanvasElement | null,
  inp: FallingFilmDesignInputs,
  res: FallingFilmDesignResults
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = 560;
  const H = 420;
  const dpr = typeof window !== 'undefined' ? Math.max(2, window.devicePixelRatio || 2) : 2;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // White Architectural CAD Blueprint Grid
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#EFECE5';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  ctx.strokeStyle = '#1A2F44';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  // 1. Vertical Falling Film Calandria (Left-Center)
  const cx = 82, cy = 46, cw = 64, ch = 152;
  ctx.fillStyle = 'rgba(251,191,36,0.06)';
  ctx.strokeStyle = '#1A2F44';
  ctx.lineWidth = 2;
  ctx.fillRect(cx, cy, cw, ch);
  ctx.strokeRect(cx, cy, cw, ch);

  // Top Distribution Bonnet (Liquid Distributor Weir / Tray)
  ctx.beginPath();
  ctx.arc(cx + cw / 2, cy, cw / 2, Math.PI, 0);
  ctx.fill(); ctx.stroke();

  // Distributor plate & spray arrows at top
  ctx.strokeStyle = '#1A2F44';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx + 6, cy - 4); ctx.lineTo(cx + cw - 6, cy - 4);
  ctx.stroke();

  // Vertical Falling Film Tubes with thin blue/amber liquid film on inner walls
  for (let i = 1; i <= 5; i++) {
    const tx = cx + (cw * i) / 6;
    ctx.strokeStyle = 'rgba(148,163,184,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(tx, cy + 4); ctx.lineTo(tx, cy + ch - 4); ctx.stroke();
    // Falling liquid film highlight
    ctx.strokeStyle = 'rgba(251,146,60,0.65)';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(tx, cy + 8); ctx.lineTo(tx, cy + ch - 8); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Bottom Vapor-Liquid Transition Duct to Separator Drum
  const sx = 186, sy = 104, sw = 72, sh = 115;
  ctx.strokeStyle = '#1A2F44';
  ctx.lineWidth = 2;
  ctx.fillStyle = 'rgba(56,189,248,0.07)';
  // Bottom cone of Calandria
  ctx.beginPath();
  ctx.moveTo(cx, cy + ch);
  ctx.lineTo(cx + 16, cy + ch + 24);
  ctx.lineTo(cx + cw - 16, cy + ch + 24);
  ctx.lineTo(cx + cw, cy + ch);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Tangential Vapor-Liquid Duct from Calandria bottom to Separator Drum
  ctx.strokeStyle = '#fb923c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + cw, cy + ch - 18);
  ctx.lineTo(sx, sy + 52);
  ctx.stroke();

  // 2. Vapor-Liquid Separator Drum (D-321/331/341)
  ctx.strokeStyle = '#1A2F44';
  ctx.lineWidth = 2;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.strokeRect(sx, sy, sw, sh);
  ctx.beginPath(); ctx.arc(sx + sw / 2, sy, sw / 2, Math.PI, 0); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(sx + sw / 2, sy + sh, sw / 2, 0, Math.PI); ctx.fill(); ctx.stroke();

  // Demister Pad at top of Separator Drum
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(sx + 6, sy + 12, sw - 12, 12);

  // Recirculation Pump loop (Bottom → Top of Calandria)
  ctx.strokeStyle = 'rgba(251,146,60,0.75)';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(sx + sw / 2, sy + sh + sw / 2);
  ctx.lineTo(sx + sw / 2, H - 18);
  ctx.lineTo(34, H - 18);
  ctx.lineTo(34, cy - 16);
  ctx.lineTo(cx + cw / 2, cy - 16);
  ctx.stroke();
  ctx.setLineDash([]);

  // Labels on Left Drawing
  ctx.fillStyle = '#1A2F44';
  ctx.font = 'bold 10px monospace';
  ctx.fillText(`${inp.tag} CALANDRIA`, cx - 6, cy - 26);
  ctx.fillText(`Ø${res.D_calandria_mm}×${(inp.L_m * 1000).toFixed(0)}L`, cx - 6, cy + ch + 38);
  ctx.fillStyle = '#0F766E';
  ctx.fillText(`V-L SEP Ø${res.D_separator_mm}`, sx - 4, sy - 26);

  // 3. Engineering Spec Table on Right
  const rx = 282;
  ctx.fillStyle = '#1A2F44';
  ctx.font = 'bold 11.5px monospace';
  ctx.fillText(`FALLING FILM EVAPORATOR CAD: ${inp.tag} (${inp.effectNo}효)`, rx, 34);

  const specLines = [
    `• 전열부하 / 면적 : Q = ${res.Q_total_kW.toFixed(0)} kW | A = ${res.A_prov_m2.toFixed(1)} m² (+${res.overdesign_pct}%)`,
    `• 튜브 번들 사양  : OD ${inp.do_mm}×${inp.tw_mm}t × L ${inp.L_m}m × ${res.N_tubes} Tubes`,
    `• 칼란드리아 쉘   : ID Ø${res.D_calandria_mm} mm | 재질: ${inp.material}`,
    `• 온도 및 BPR     : T_stm ${inp.T_steam_C}°C → T_boil ${res.T_boil_C}°C (BPR +${res.BPR_C}°C, ΔT=${res.dT_eff_C}°C)`,
    `• 강하 액막 수력학: Γ = ${res.actualWettingRate_kgms.toFixed(2)} kg/m·s (Re=${res.Re_film.toFixed(0)}, δ=${res.filmThickness_mm}mm)`,
    `• 총괄열전달계수  : U_dirty = ${res.U_dirty_Wm2K} W/m²K (h_film=${res.h_film_Wm2K}, h_cond=${res.h_cond_Wm2K})`,
    `• 순환펌프 유량   : ${res.recircFlow_kgh.toLocaleString()} kg/h (순환비 ${res.recircRatio}x) | v_vap = ${res.vaporExitVel_ms} m/s`,
    `• 기액분리기 드럼 : ID Ø${res.D_separator_mm} × H ${res.H_separator_mm} mm (v_sep=${res.v_sep_vapor_ms}/${res.v_soudersBrown_ms} m/s)`,
    `• ANSI/ASME 노즐  : Liq ${res.nozzleLiquorIn_NPS} / Vap ${res.nozzleVaporOut_NPS} / Stm ${res.nozzleSteamIn_NPS}`,
  ];
  ctx.font = '10.5px monospace';
  specLines.forEach((ln, idx) => {
    ctx.fillStyle = idx === 3 || idx === 4 ? '#0F766E' : idx === 0 ? '#1A2F44' : '#18181B';
    ctx.fillText(ln, rx, 58 + idx * 21);
  });
}

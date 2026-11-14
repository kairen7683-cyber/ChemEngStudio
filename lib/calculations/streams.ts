// ============================================================
// 전공장 스트림 및 유닛 블록 시뮬레이션 엔진 (ELECNRTL 열역학 기반)
// Sequential Modular Mass, Energy & VLE Flash Simulation (100~600 Sec)
// 원본 도면/엑셀 기준: MB-2012 CA NO.3_468TON_R1.XLS + 100/200 Sec PFD
// ============================================================
import {
  ElectrolyzerInputs,
  ElectrolyzerOutputs,
  calculateElectrolyzer,
  waterSatVaporPressureKgcm2A,
} from './electrolyzer';
import { MW } from './constants';
import { FLUID_DB, densityAtT } from '../physicalProperties';
import { simulateTripleEffectEvaporator } from './evaporator';

// ──────────────────────────────────────────────────────────────────────
// 1. 열역학 물성 패키지 (Density, Cp, Enthalpy, VLE Flash, Molar/Vol Flow)
// ──────────────────────────────────────────────────────────────────────

/** 액상/기상 혼합물의 온도·압력·조성 기반 밀도 계산 (kg/m³) */
function calcStreamDensity(
  phase: 'L' | 'G' | 'L/G',
  T_C: number,
  P_kgcm2g: number,
  components: Record<string, number | undefined>,
  fluidKey?: string,
  fallback?: number
): number {
  const totalMass = Object.values(components).reduce<number>((s, v) => s + (v ?? 0), 0);
  if (totalMass <= 0) return fallback ?? 1000;

  if (phase === 'G') {
    let totalKmol = 0;
    for (const [k, m] of Object.entries(components)) {
      const mw = MW[k as keyof typeof MW] ?? 28.0;
      if (m && m > 0) totalKmol += m / mw;
    }
    const avgMW = totalKmol > 0 ? totalMass / totalKmol : 28.0;
    const P_atm = Math.max(0.05, (P_kgcm2g + 1.03323) / 1.03323);
    const T_K = Math.max(200, T_C + 273.15);
    const cl2Frac = (components.Cl2 ?? 0) / totalMass;
    const Z = cl2Frac > 0.5 ? Math.max(0.82, 1 - 0.014 * P_atm * Math.pow(300 / T_K, 1.6)) : 1.0;
    return (P_atm * avgMW) / (Z * 0.082057 * T_K);
  }

  const wNaCl = (components.NaCl ?? 0) / totalMass;
  const wNaOH = (components.NaOH ?? 0) / totalMass;
  const wH2SO4 = (components.H2SO4 ?? 0) / totalMass;

  if (wH2SO4 > 0.3) {
    return Math.max(1300, 1000 + 865 * wH2SO4 - 0.75 * (T_C - 20));
  }
  if (wNaOH > 0.05) {
    return 998.2 + 1085 * wNaOH - 120 * wNaOH * wNaOH - 0.52 * (T_C - 20);
  }
  if (wNaCl > 0.03) {
    return 998.2 + 745 * wNaCl + 140 * wNaCl * wNaCl - 0.44 * (T_C - 20);
  }
  if (fluidKey && FLUID_DB[fluidKey]) {
    return densityAtT(FLUID_DB[fluidKey], T_C);
  }
  return fallback ?? Math.max(950, 1000 - 0.35 * (T_C - 20));
}

/** 혼합물의 비열 Cp (kcal/kg·°C) 및 엔탈피 H (kcal/kg, 기준 25°C 액상 물) */
function calcThermoProps(
  phase: 'L' | 'G' | 'L/G',
  T_C: number,
  components: Record<string, number | undefined>
): { totalKmolH: number; avgMW: number; cp_kcalKgC: number; enthalpy_kcalKg: number } {
  const totalMass = Object.values(components).reduce<number>((s, v) => s + (v ?? 0), 0);
  if (totalMass <= 0) {
    return { totalKmolH: 0, avgMW: 18.015, cp_kcalKgC: 1.0, enthalpy_kcalKg: 0 };
  }

  let totalKmol = 0;
  for (const [k, m] of Object.entries(components)) {
    const mw = MW[k as keyof typeof MW] ?? 30.0;
    if (m && m > 0) totalKmol += m / mw;
  }
  const avgMW = totalKmol > 0 ? totalMass / totalKmol : 18.015;

  const wNaCl = (components.NaCl ?? 0) / totalMass;
  const wNaOH = (components.NaOH ?? 0) / totalMass;
  const wH2SO4 = (components.H2SO4 ?? 0) / totalMass;
  const wCl2 = (components.Cl2 ?? 0) / totalMass;
  const wH2 = (components.H2 ?? 0) / totalMass;
  const wH2O = (components.H2O ?? 0) / totalMass;

  let cp = 1.0;
  let h = 0;

  if (phase === 'G') {
    cp = wCl2 * 0.115 + wH2 * 3.44 + wH2O * 0.45 + (1 - wCl2 - wH2 - wH2O) * 0.22;
    h = cp * (T_C - 25) + wH2O * 583.0;
  } else {
    if (wH2SO4 > 0.2) {
      cp = 1.0 - 0.65 * wH2SO4;
    } else if (wNaOH > 0.05) {
      cp = 1.0 - 0.52 * wNaOH + 0.15 * wNaOH * wNaOH;
    } else if (wNaCl > 0.03) {
      cp = 1.0 - 0.78 * wNaCl + 0.35 * wNaCl * wNaCl;
    } else {
      cp = 1.0;
    }
    h = cp * (T_C - 25);
  }

  return {
    totalKmolH: totalKmol,
    avgMW,
    cp_kcalKgC: Number(cp.toFixed(3)),
    enthalpy_kcalKg: Number(h.toFixed(1)),
  };
}

/**
 * 습윤 가스(Cl2 또는 H2) 등온 기액평형 플래시 시뮬레이션
 * 입구 습윤 가스를 (T_out, P_out) 조건으로 냉각할 때 평형 수증기량과 응축수량 및 열부하 계산
 */
export function flashWetGas(params: {
  dryGasKmolH: number;
  dryGasMassKgH: number;
  dryGasCpKcalKgC: number;
  waterInKgH: number;
  T_in_C: number;
  T_out_C: number;
  P_out_kgcm2g: number;
  waterActivity?: number;
  efficiencyFactor?: number;
}) {
  const {
    dryGasKmolH,
    dryGasMassKgH,
    dryGasCpKcalKgC,
    waterInKgH,
    T_in_C,
    T_out_C,
    P_out_kgcm2g,
    waterActivity = 1.0,
    efficiencyFactor = 1.0,
  } = params;

  const P_abs = Math.max(0.2, P_out_kgcm2g + 1.03323);
  const P_sat = waterSatVaporPressureKgcm2A(T_out_C);
  const y_H2O_eq = Math.min(0.85, ((waterActivity * P_sat) / P_abs) * efficiencyFactor);
  const n_H2O_eq_kmolH = dryGasKmolH * (y_H2O_eq / Math.max(0.05, 1 - y_H2O_eq));
  const m_H2O_eq_kgH = n_H2O_eq_kmolH * MW.H2O;

  const waterVaporOutKgH = Math.min(waterInKgH, m_H2O_eq_kgH);
  const waterCondensedKgH = Math.max(0, waterInKgH - waterVaporOutKgH);

  const deltaT = Math.max(0, T_in_C - T_out_C);
  const latentHeatKcalKg = Math.max(510, 597.3 - 0.56 * T_out_C);
  const qSensibleGasKcalH = dryGasMassKgH * dryGasCpKcalKgC * deltaT;
  const qSensibleVapKcalH = waterVaporOutKgH * 0.45 * deltaT + waterCondensedKgH * 0.75 * deltaT;
  const qLatentCondKcalH  = waterCondensedKgH * latentHeatKcalKg;
  const qTotalKcalH       = qSensibleGasKcalH + qSensibleVapKcalH + qLatentCondKcalH;

  return {
    y_H2O_eq,
    waterVaporOutKgH,
    waterCondensedKgH,
    qSensibleKcalH: qSensibleGasKcalH + qSensibleVapKcalH,
    qLatentKcalH: qLatentCondKcalH,
    qTotalKcalH,
  };
}

// ──────────────────────────────────────────────────────────────────────
// 2. 스트림 및 유닛 블록 인터페이스
// ──────────────────────────────────────────────────────────────────────

export interface StreamData {
  id: string;
  name: string;
  section: '100' | '200' | '300' | '400' | '600';
  components: {
    NaCl?: number; H2O?: number; NaOH?: number; Cl2?: number;
    H2?: number;  HCl?: number; O2?: number;  H2SO4?: number;
    BaCl2?: number; Na2SO3?: number; Na2CO3?: number;
  };
  total_kgh: number;
  concentration?: number;       // 주성분 농도 (wt%)
  moisturePpm?: number;         // 건조 가스 수분 농도 (wt ppm)
  pressure_kgcm2g?: number;
  temperature_C?: number;
  density_kgm3?: number;
  volFlow_m3h?: number;         // 부피유량 (m³/h)
  molarFlow_kmolh?: number;     // 몰유량 (kmol/h)
  avgMW?: number;               // 평균 분자량 (g/mol)
  cp_kcalKgC?: number;          // 정압비열 (kcal/kg·°C)
  enthalpy_kcalKg?: number;     // 비엔탈피 (kcal/kg, ref 25°C)
  enthalpyFlow_Mcalh?: number;  // 엔탈피 유량 (Mcal/h)
  vaporFraction?: number;       // 기상 분율 (0 ~ 1)
  fluidKey?: string;
  phase?: 'L' | 'G' | 'L/G';
  isPerUnit?: boolean;          // true이면 전해조 1기당 스트림 (×5 헤더 합산 전)
  description?: string;
}

export interface UnitOpBlockResult {
  id: string;                   // 기기 태그
  name: string;                 // 기기명
  simBlockType: string;       // 단위공정 해석 모델명
  section: '100' | '200' | '300' | '400' | '600';
  inletStreams: string[];
  outletStreams: string[];
  tempInC: number;
  tempOutC: number;
  pressKgcm2g: number;
  waterRemovedKgH?: number;     // 응축/흡수 수분 제거량 (kg/h)
  cl2RemovedKgH?: number;       // 탈염소 제거량 (kg/h)
  sensibleHeatKcalH: number;    // 현열 부하 (kcal/h)
  latentOrDilutionHeatKcalH: number; // 잠열/희석열/반응열 부하 (kcal/h)
  totalHeatDutyKcalH: number;   // 총 열부하 (kcal/h)
  totalHeatDutyKW: number;      // 총 열부하 (kW)
  coolingMedium?: string;       // 냉각/가열 매체
  coolingFlowM3H?: number;      // 필요 냉각수/유틸리티 유량 (m³/h)
  keySpecSummary: string;       // 핵심 설계 결과 요약
}

export interface PlantMassBalance {
  electrolyzerResult: ElectrolyzerOutputs;
  streams: StreamData[];
  unitBlocks: UnitOpBlockResult[];
  summary: {
    cl2_tonDay: number;
    naoh32_tonDay: number;
    naoh50_tonDay: number;
    h2_tonDay: number;
    naclUsage_tonDay: number;
    saltUsage_tonDay: number;
    dcPower_MW: number;
    totalCoolingDuty_McalH: number;
  };
}

/** 스트림 객체를 생성하면서 밀도·몰유량·부피유량·엔탈피 등 열역학 물성을 자동 계산 */
function makeStream(raw: Omit<StreamData, 'molarFlow_kmolh' | 'avgMW' | 'cp_kcalKgC' | 'enthalpy_kcalKg' | 'enthalpyFlow_Mcalh' | 'volFlow_m3h'>): StreamData {
  const phase = raw.phase ?? 'L';
  const T = raw.temperature_C ?? 25;
  const P = raw.pressure_kgcm2g ?? 0;
  const density = calcStreamDensity(phase, T, P, raw.components, raw.fluidKey, raw.density_kgm3);
  const thermo = calcThermoProps(phase, T, raw.components);
  const volFlow = density > 0 ? raw.total_kgh / density : 0;
  const enthalpyFlow = (raw.total_kgh * thermo.enthalpy_kcalKg) / 1000;
  const vapFrac = raw.vaporFraction ?? (phase === 'G' ? 1.0 : phase === 'L' ? 0.0 : 0.5);

  return {
    ...raw,
    density_kgm3: Number(density.toFixed(phase === 'G' ? 3 : 1)),
    volFlow_m3h: Number(volFlow.toFixed(2)),
    molarFlow_kmolh: Number(thermo.totalKmolH.toFixed(2)),
    avgMW: Number(thermo.avgMW.toFixed(2)),
    cp_kcalKgC: thermo.cp_kcalKgC,
    enthalpy_kcalKg: thermo.enthalpy_kcalKg,
    enthalpyFlow_Mcalh: Number(enthalpyFlow.toFixed(1)),
    vaporFraction: vapFrac,
  };
}

// ──────────────────────────────────────────────────────────────────────
// 3. 전공정 Sequential Modular 시뮬레이터 메인 함수
// ──────────────────────────────────────────────────────────────────────
export function calculatePlantBalance(inputs: ElectrolyzerInputs): PlantMassBalance {
  const elec = calculateElectrolyzer(inputs);
  const pu   = elec.perUnit;
  const N_el = inputs.numElectrolyzers;
  const sf   = elec.cl2ProductionKgH / 19500.0; // 기준 용량(468 T/D = 19,500 kg/h Cl2) 대비 부하율

  const brineFeedTempC = inputs.brineFeedTempC ?? 60.0;
  const cellTempC      = inputs.electrolyzerTempC ?? 89.0;
  const anodeTempC     = inputs.anodeTempC ?? (cellTempC - 2.0); // 87°C
  const cathodeTempC   = inputs.cathodeTempC ?? (cellTempC + 1.0); // 90°C
  const anodePressG    = inputs.anodePressKgcm2g ?? 0.40;
  const cathodePressG  = inputs.cathodePressKgcm2g ?? 0.45;
  const deltaPKgcm2    = cathodePressG - anodePressG;
  const t280VacPressG  = inputs.t280VacuumPressKgcm2g ?? -0.65;
  const cl2Cooler1Temp = inputs.cl2Cooler1TempC ?? 40.0;
  const cl2Cooler2Temp = inputs.cl2Cooler2TempC ?? 20.0;
  const cl2CompPressG  = inputs.cl2CompPressKgcm2g ?? 3.0;
  const h2Cooler1Temp  = inputs.h2Cooler1TempC ?? 41.0;
  const h2Cooler2Temp  = inputs.h2Cooler2TempC ?? 10.0;
  const h2CompPressG   = inputs.h2CompPressKgcm2g ?? 23.0;
  const h2HighPTempC   = inputs.h2HighPCoolTempC ?? 10.0;

  const streams: StreamData[] = [];
  const unitBlocks: UnitOpBlockResult[] = [];

  // ══════════════════════════════════════════════════════════════════
  // BLOCK A: 200 SEC — 전해조 (EL-200 + D-210 + D-220) 1기당 & ×5 헤더 합산
  // ══════════════════════════════════════════════════════════════════

  // [104] 100 Sec 정제 브라인 → 200 Sec 전해조 공통 공급 (5기 합산)
  const s104_NaCl = pu.freshBrine104_NaCl_KgH * N_el;
  const s104_H2O  = pu.freshBrine104_H2O_KgH * N_el;
  const s104_tot  = s104_NaCl + s104_H2O;

  // ── 1기당 (Per Electrolyzer Unit) 스트림: [201], [202], [203], [204], [209], [212], [213], [214] ──
  streams.push(makeStream({
    id: '201', name: '전해조 양극 피드 (1기당)', section: '200', isPerUnit: true,
    components: { NaCl: pu.anodeInlet201_NaCl_KgH, H2O: pu.anodeInlet201_H2O_KgH },
    total_kgh: pu.anodeInlet201_NaCl_KgH + pu.anodeInlet201_H2O_KgH,
    concentration: pu.anodeInlet201_ConcWt,
    pressure_kgcm2g: 2.3, temperature_C: 66.0, fluidKey: 'brine_25', phase: 'L',
    description: `EL-200 1기당 양극 입구 (FCV-231: [104]/${N_el} + 순환[208]/${N_el}, ×${N_el}기 합산 시 ${((pu.anodeInlet201_NaCl_KgH + pu.anodeInlet201_H2O_KgH) * N_el / 1000).toFixed(1)} t/h)`,
  }));

  streams.push(makeStream({
    id: '204', name: 'HCl 산성화 주입 (1기당)', section: '200', isPerUnit: true,
    components: { HCl: pu.hclFeed204_HCl_KgH, H2O: pu.hclFeed204_H2O_KgH },
    total_kgh: pu.hclFeed204_HCl_KgH + pu.hclFeed204_H2O_KgH,
    concentration: 30.0,
    pressure_kgcm2g: 3.0, temperature_C: 25.0, fluidKey: 'hcl_35', phase: 'L',
    description: `FCV-212 양극 산성화용 30% HCl (1기당, ×${N_el}기 합산 시 ${((pu.hclFeed204_HCl_KgH + pu.hclFeed204_H2O_KgH) * N_el).toFixed(0)} kg/h)`,
  }));

  streams.push(makeStream({
    id: '203', name: 'D-210 Cl₂ 기상 출구 (1기당)', section: '200', isPerUnit: true,
    components: { Cl2: pu.d210GasOut203_Cl2_KgH, H2O: pu.d210GasOut203_H2O_KgH, O2: pu.d210GasOut203_O2_KgH },
    total_kgh: pu.d210GasOut203_Cl2_KgH + pu.d210GasOut203_H2O_KgH + pu.d210GasOut203_O2_KgH,
    concentration: (pu.d210GasOut203_Cl2_KgH / (pu.d210GasOut203_Cl2_KgH + pu.d210GasOut203_H2O_KgH + pu.d210GasOut203_O2_KgH)) * 100,
    pressure_kgcm2g: anodePressG, temperature_C: anodeTempC, fluidKey: 'cl2_gas', phase: 'G',
    description: `D-210 양극 기액분리기 상부 습윤 Cl₂ (1기당, ${anodeTempC}°C / ${anodePressG} kg/cm²G) → ×${N_el}기 합산하여 [220] Cl₂ 헤더 형성`,
  }));

  streams.push(makeStream({
    id: '202', name: 'D-210 묽은 브라인 액상 (1기당)', section: '200', isPerUnit: true,
    components: { NaCl: pu.d210LiqOut202_NaCl_KgH, H2O: pu.d210LiqOut202_H2O_KgH, Cl2: pu.d210LiqOut202_Cl2Diss_KgH },
    total_kgh: pu.d210LiqOut202_NaCl_KgH + pu.d210LiqOut202_H2O_KgH + pu.d210LiqOut202_Cl2Diss_KgH,
    concentration: pu.d210LiqOut202_ConcWt,
    pressure_kgcm2g: anodePressG, temperature_C: anodeTempC, fluidKey: 'anolyte', phase: 'L',
    description: `D-210 양극 기액분리기 하부 ~18% 양극액 (1기당) → ×${N_el}기 합산하여 [202a] 양극액 헤더(D-240) 유입`,
  }));

  // [202a] 5기 합산 양극액 복귀 헤더 (D-210 × 5기 → D-240 양극액 순환탱크)
  const s202a_NaCl = pu.d210LiqOut202_NaCl_KgH * N_el;
  const s202a_H2O  = pu.d210LiqOut202_H2O_KgH * N_el;
  const s202a_Cl2  = pu.d210LiqOut202_Cl2Diss_KgH * N_el;
  streams.push(makeStream({
    id: '202a', name: `양극액 복귀 헤더 (${N_el}기 합산 → D-240)`, section: '200',
    components: { NaCl: s202a_NaCl, H2O: s202a_H2O, Cl2: s202a_Cl2 },
    total_kgh: s202a_NaCl + s202a_H2O + s202a_Cl2,
    concentration: pu.d210LiqOut202_ConcWt,
    pressure_kgcm2g: anodePressG, temperature_C: cathodeTempC, fluidKey: 'anolyte', phase: 'L',
    description: `[202] × ${N_el}기 합산 양극액 헤더 → D-240 양극액 탱크 & P-244A/B (176 m³/h)`,
  }));

  // [208] P-244A/B → FCV-240 양극액 내부 재순환 (5기 합산)
  const s208_NaCl = pu.recircAnolyte208_NaCl_KgH * N_el;
  const s208_H2O  = pu.recircAnolyte208_H2O_KgH * N_el;
  streams.push(makeStream({
    id: '208', name: '양극액 재순환 (P-244A/B → FCV-240)', section: '200',
    components: { NaCl: s208_NaCl, H2O: s208_H2O },
    total_kgh: s208_NaCl + s208_H2O,
    concentration: pu.d210LiqOut202_ConcWt,
    pressure_kgcm2g: 3.2, temperature_C: cathodeTempC, fluidKey: 'anolyte', phase: 'L',
    description: 'D-240 / P-244A/B → FCV-240 양극액 내부 재순환 헤더',
  }));

  // [209] 음극 농도 조절용 순수 (SPW, 5기 합산)
  const s209_H2O = pu.spwDilution209_H2O_KgH * N_el;
  streams.push(makeStream({
    id: '209', name: `음극 희석 순수 SPW (${N_el}기 합산)`, section: '200',
    components: { H2O: s209_H2O },
    total_kgh: s209_H2O,
    pressure_kgcm2g: 3.5, temperature_C: 30.0, fluidKey: 'water', phase: 'L',
    description: `FCV-221 32% 가성소다 농도 맞춤용 순수 (1기당 ${pu.spwDilution209_H2O_KgH.toFixed(0)} kg/h × ${N_el}기)`,
  }));

  // [213] 음극액 전해조 입구 (1기당, FCV-232)
  streams.push(makeStream({
    id: '213', name: '음극액 전해조 입구 (1기당, FCV-232)', section: '200', isPerUnit: true,
    components: { NaOH: pu.cathodeInlet213_NaOH_KgH, H2O: pu.cathodeInlet213_H2O_KgH },
    total_kgh: pu.cathodeInlet213_NaOH_KgH + pu.cathodeInlet213_H2O_KgH,
    concentration: (pu.cathodeInlet213_NaOH_KgH / (pu.cathodeInlet213_NaOH_KgH + pu.cathodeInlet213_H2O_KgH)) * 100,
    pressure_kgcm2g: 3.2, temperature_C: 85.0, fluidKey: 'naoh_32', phase: 'L',
    description: `EL-200 1기당 음극 순환액 입구 (×${N_el}기 합산 = [217] 헤더)`,
  }));

  // [214] 전해조 음극 출구 기액혼합 (1기당 → D-220 유입)
  streams.push(makeStream({
    id: '214', name: '음극 출구 2상 흐름 (1기당 → D-220)', section: '200', isPerUnit: true,
    components: {
      NaOH: pu.d220LiqOut_NaOH_KgH,
      H2O: pu.d220LiqOut_H2O_KgH + pu.d220GasOut212_H2O_KgH,
      H2: pu.d220GasOut212_H2_KgH,
    },
    total_kgh: pu.d220LiqOut_NaOH_KgH + pu.d220LiqOut_H2O_KgH + pu.d220GasOut212_H2O_KgH + pu.d220GasOut212_H2_KgH,
    concentration: pu.d220LiqOut_ConcWt,
    pressure_kgcm2g: cathodePressG, temperature_C: cathodeTempC, fluidKey: 'naoh_32', phase: 'L/G',
    description: 'EL-200 1기당 음극 출구 (32% NaOH + H₂ 기포) → D-220 음극 기액분리기',
  }));

  // [212] D-220 H2 기상 출구 (1기당)
  streams.push(makeStream({
    id: '212', name: 'D-220 H₂ 기상 출구 (1기당)', section: '200', isPerUnit: true,
    components: { H2: pu.d220GasOut212_H2_KgH, H2O: pu.d220GasOut212_H2O_KgH },
    total_kgh: pu.d220GasOut212_H2_KgH + pu.d220GasOut212_H2O_KgH,
    concentration: (pu.d220GasOut212_H2_KgH / (pu.d220GasOut212_H2_KgH + pu.d220GasOut212_H2O_KgH)) * 100,
    pressure_kgcm2g: cathodePressG, temperature_C: cathodeTempC, fluidKey: 'h2_gas', phase: 'G',
    description: `D-220 음극 기액분리기 상부 습윤 H₂ (1기당, ${cathodeTempC}°C / ${cathodePressG} kg/cm²G) → ×${N_el}기 합산하여 [221] H₂ 헤더 형성`,
  }));

  // [211] D-220 32% 가성소다 액상 출구 (D-250 유입 헤더)
  const s211_NaOH = (pu.cathodeInlet213_NaOH_KgH / N_el + pu.naohGeneratedKgH) * N_el;
  const s211_H2O  = s211_NaOH * (1 - pu.d220LiqOut_ConcWt / 100) / (pu.d220LiqOut_ConcWt / 100);
  streams.push(makeStream({
    id: '211', name: 'D-220 32% 가성소다 액상 출구 → D-250', section: '200',
    components: { NaOH: s211_NaOH, H2O: s211_H2O },
    total_kgh: s211_NaOH + s211_H2O,
    concentration: pu.d220LiqOut_ConcWt,
    pressure_kgcm2g: cathodePressG, temperature_C: cathodeTempC, fluidKey: 'naoh_32', phase: 'L',
    description: 'D-220 음극 기액분리기 하부 32% NaOH → D-250 음극액 순환탱크 & P-254A/B (325 m³/h)',
  }));

  // [217] P-254A/B → 음극액 냉각기(HCV-223) → 5기 합산 음극 공급 헤더
  const s217_NaOH = pu.cathodeInlet213_NaOH_KgH * N_el;
  const s217_H2O  = pu.cathodeInlet213_H2O_KgH * N_el;
  streams.push(makeStream({
    id: '217', name: `음극액 공급 헤더 (${N_el}기 합산, E-223 후)`, section: '200',
    components: { NaOH: s217_NaOH, H2O: s217_H2O },
    total_kgh: s217_NaOH + s217_H2O,
    concentration: (s217_NaOH / (s217_NaOH + s217_H2O)) * 100,
    pressure_kgcm2g: 4.6, temperature_C: 85.0, fluidKey: 'naoh_32', phase: 'L',
    description: `D-250 / P-254A/B → 음극액 냉각기(E-223) → [213]×${N_el}기 음극 공급 헤더`,
  }));

  // [218] D-240 / P-244A/B → LCV-240 탈염소탑행 묽은 브라인 (5기 합산 알짜 배출)
  const s218_NaCl = (pu.freshBrine104_NaCl_KgH - pu.naclConsumedKgH) * N_el;
  const s218_H2O  = (pu.freshBrine104_H2O_KgH + pu.hclFeed204_H2O_KgH - pu.waterElectroOsmoticKgH - pu.d210GasOut203_H2O_KgH) * N_el;
  const s218_Cl2  = s202a_Cl2;
  streams.push(makeStream({
    id: '218', name: '묽은 양극액 배출 (LCV-240 → T-280)', section: '200',
    components: { NaCl: s218_NaCl, H2O: s218_H2O, Cl2: s218_Cl2 },
    total_kgh: s218_NaCl + s218_H2O + s218_Cl2,
    concentration: (s218_NaCl / (s218_NaCl + s218_H2O)) * 100,
    pressure_kgcm2g: 3.2, temperature_C: cathodeTempC, fluidKey: 'anolyte', phase: 'L',
    description: 'D-240 / P-244A/B → LCV-240 탈염소탑(T-280) 공급 묽은 브라인 (~17.5% NaCl)',
  }));

  // [219] 32% 가성소다 제품 (P-254A/B → LCV-250 → D-310 32% NaOH 탱크 → P-314A/B → 농축공정)
  const s219_NaOH = elec.naohProductionKgH;
  const s219_H2O  = s219_NaOH * (1 - pu.d220LiqOut_ConcWt / 100) / (pu.d220LiqOut_ConcWt / 100);
  streams.push(makeStream({
    id: '219', name: '32% NaOH 제품 (LCV-250 → D-310)', section: '200',
    components: { NaOH: s219_NaOH, H2O: s219_H2O },
    total_kgh: s219_NaOH + s219_H2O,
    concentration: pu.d220LiqOut_ConcWt,
    pressure_kgcm2g: 4.84, temperature_C: cathodeTempC, fluidKey: 'naoh_32', phase: 'L',
    description: 'D-250 / P-254A/B → LCV-250 → D-310 (32% 가성소다 탱크) → P-314A/B (61 m³/h) → 300 Sec 농축공정',
  }));

  // [220] Cl2 가스 공통 헤더 (5기 합산: [203] × 5, PCV-215 후 → 400 Sec T-410)
  const s220_Cl2 = pu.d210GasOut203_Cl2_KgH * N_el;
  const s220_H2O = pu.d210GasOut203_H2O_KgH * N_el;
  const s220_O2  = pu.d210GasOut203_O2_KgH * N_el;
  streams.push(makeStream({
    id: '220', name: `Cl₂ 가스 공통 헤더 (${N_el}기 합산, PCV-215)`, section: '200',
    components: { Cl2: s220_Cl2, H2O: s220_H2O, O2: s220_O2 },
    total_kgh: s220_Cl2 + s220_H2O + s220_O2,
    concentration: (s220_Cl2 / (s220_Cl2 + s220_H2O + s220_O2)) * 100,
    pressure_kgcm2g: anodePressG, temperature_C: anodeTempC, fluidKey: 'cl2_gas', phase: 'G',
    description: `[203] × ${N_el}기 합산 Cl₂ 헤더 (PCV-215 후) → 400 Sec T-410 수세탑`,
  }));

  // [221] H2 가스 공통 헤더 (5기 합산: [212] × 5, PCV-227 후 → 600 Sec)
  const s221_H2  = pu.d220GasOut212_H2_KgH * N_el;
  const s221_H2O = pu.d220GasOut212_H2O_KgH * N_el;
  streams.push(makeStream({
    id: '221', name: `H₂ 가스 공통 헤더 (${N_el}기 합산, PCV-227)`, section: '200',
    components: { H2: s221_H2, H2O: s221_H2O },
    total_kgh: s221_H2 + s221_H2O,
    concentration: (s221_H2 / (s221_H2 + s221_H2O)) * 100,
    pressure_kgcm2g: cathodePressG, temperature_C: cathodeTempC, fluidKey: 'h2_gas', phase: 'G',
    description: `[212] × ${N_el}기 합산 H₂ 헤더 (PCV-227 / 수봉조 PCV-230 후) → 600 Sec E-5613`,
  }));

  // ══════════════════════════════════════════════════════════════════
  // BLOCK B: 400 SEC — Cl2 수세·냉각·황산건조·압축·액화 (VLE Flash & Absorption)
  // ══════════════════════════════════════════════════════════════════
  const cl2DryKmolH = s220_Cl2 / MW.Cl2 + s220_O2 / MW.O2;
  const cl2DryMassKgH = s220_Cl2 + s220_O2;

  // 1) T-410 수세탑 & E-413 1차 냉각기
  const flash410 = flashWetGas({
    dryGasKmolH: cl2DryKmolH,
    dryGasMassKgH: cl2DryMassKgH,
    dryGasCpKcalKgC: 0.115,
    waterInKgH: s220_H2O,
    T_in_C: anodeTempC,
    T_out_C: cl2Cooler1Temp,
    P_out_kgcm2g: 0.27,
    waterActivity: 0.98,
    efficiencyFactor: 0.992,
  });

  const qCircWater410 = 180630 * sf;
  const qE413TotalKcalH = flash410.qTotalKcalH + qCircWater410;

  streams.push(makeStream({
    id: '401', name: 'Cl₂ (T-410 수세탑 출구)', section: '400',
    components: { Cl2: s220_Cl2, O2: s220_O2, H2O: flash410.waterVaporOutKgH },
    total_kgh: s220_Cl2 + s220_O2 + flash410.waterVaporOutKgH,
    concentration: (s220_Cl2 / (s220_Cl2 + s220_O2 + flash410.waterVaporOutKgH)) * 100,
    pressure_kgcm2g: 0.27, temperature_C: cl2Cooler1Temp, fluidKey: 'cl2_gas', phase: 'G',
    description: `T-410 수세탑 / E-413 냉각 출구 (${cl2Cooler1Temp.toFixed(1)}°C, 수분 ${flash410.waterVaporOutKgH.toFixed(1)} kg/h 동반)`,
  }));

  // [402] T-410 수세탑 응축 폐수 → 200 Sec T-280 탈염소탑 합류
  const s402_H2O = (2428.0 * sf) + flash410.waterCondensedKgH;
  const s402_HCl = 21.0 * sf;
  const s402_Cl2 = 0.9 * sf;
  streams.push(makeStream({
    id: '402', name: '수세탑 응축 폐수 (T-410 → T-280)', section: '400',
    components: { H2O: s402_H2O, HCl: s402_HCl, Cl2: s402_Cl2 },
    total_kgh: s402_H2O + s402_HCl + s402_Cl2,
    pressure_kgcm2g: 0.0, temperature_C: 50.0, fluidKey: 'water', phase: 'L',
    description: `T-410 응축 수분(${flash410.waterCondensedKgH.toFixed(0)} kg/h) + 세정수 → 200 Sec [250] T-280 탈염소탑 합류`,
  }));

  streams.push(makeStream({
    id: '403', name: 'Cl₂ (E-413 냉각 후 → T-420)', section: '400',
    components: { Cl2: s220_Cl2, H2O: flash410.waterVaporOutKgH, O2: s220_O2 },
    total_kgh: s220_Cl2 + flash410.waterVaporOutKgH + s220_O2,
    concentration: (s220_Cl2 / (s220_Cl2 + flash410.waterVaporOutKgH + s220_O2)) * 100,
    pressure_kgcm2g: 0.27, temperature_C: cl2Cooler1Temp, fluidKey: 'cl2_gas', phase: 'G',
    description: 'T-410 / E-413 1차 수세·냉각 후 → T-420 직접냉각탑 유입',
  }));

  // 2) T-420 직접냉각탑 & E-423 칠드워터 냉각기
  const flash420 = flashWetGas({
    dryGasKmolH: cl2DryKmolH,
    dryGasMassKgH: cl2DryMassKgH,
    dryGasCpKcalKgC: 0.115,
    waterInKgH: flash410.waterVaporOutKgH,
    T_in_C: cl2Cooler1Temp,
    T_out_C: cl2Cooler2Temp,
    P_out_kgcm2g: 0.27,
    waterActivity: 0.99,
    efficiencyFactor: 0.96,
  });
  const qE423TotalKcalH = flash420.qTotalKcalH + 6033 * sf;

  streams.push(makeStream({
    id: '405', name: `Cl₂ (T-420 / E-423 냉각 후, ${cl2Cooler2Temp}°C)`, section: '400',
    components: { Cl2: s220_Cl2, H2O: flash420.waterVaporOutKgH, O2: s220_O2 },
    total_kgh: s220_Cl2 + flash420.waterVaporOutKgH + s220_O2,
    concentration: (s220_Cl2 / (s220_Cl2 + flash420.waterVaporOutKgH + s220_O2)) * 100,
    moisturePpm: (flash420.waterVaporOutKgH / (s220_Cl2 + flash420.waterVaporOutKgH)) * 1e6,
    pressure_kgcm2g: 0.27, temperature_C: cl2Cooler2Temp, fluidKey: 'cl2_gas', phase: 'G',
    description: `T-420 / E-423 칠드워터 냉각 출구 (수분 ${flash420.waterVaporOutKgH.toFixed(2)} kg/h) → T-430 1차 황산건조탑`,
  }));

  // 3) T-430 / T-440 / T-450 3단 향류 황산 건조탑
  const s409_H2O = Math.max(0.5, flash420.waterVaporOutKgH * (1.017 / 92.36));
  const h2oAbsorbed430 = Math.max(0, flash420.waterVaporOutKgH - s409_H2O);
  const qE433KcalH = h2oAbsorbed430 * 306.7;

  streams.push(makeStream({
    id: '409', name: 'Cl₂ (T-430 1차 황산건조탑 출구)', section: '400',
    components: { Cl2: s220_Cl2, H2O: s409_H2O, O2: s220_O2 },
    total_kgh: s220_Cl2 + s409_H2O + s220_O2,
    concentration: (s220_Cl2 / (s220_Cl2 + s409_H2O + s220_O2)) * 100,
    moisturePpm: (s409_H2O / s220_Cl2) * 1e6,
    pressure_kgcm2g: 0.22, temperature_C: 25.0, fluidKey: 'cl2_gas', phase: 'G',
    description: `T-430 1차 건조탑 출구 (잔류 수분 ${((s409_H2O / s220_Cl2) * 1e6).toFixed(1)} wt ppm) → T-440 2차 건조탑`,
  }));

  const s411_H2O = 0.0013 * sf;
  const h2oAbsorbed440_450 = Math.max(0, s409_H2O - s411_H2O);
  const qE443_453KcalH = h2oAbsorbed440_450 * 494.0;

  streams.push(makeStream({
    id: '411', name: 'Cl₂ (T-440/450 황산건조 완료)', section: '400',
    components: { Cl2: s220_Cl2, H2O: s411_H2O, O2: s220_O2 },
    total_kgh: s220_Cl2 + s411_H2O + s220_O2,
    concentration: (s220_Cl2 / (s220_Cl2 + s220_O2)) * 100,
    moisturePpm: (s411_H2O / s220_Cl2) * 1e6,
    pressure_kgcm2g: 0.20, temperature_C: 25.0, fluidKey: 'cl2_gas', phase: 'G',
    description: 'T-440/T-450 최종 건조 Cl₂ (수분 < 0.1 ppm) → F-424 황산 미스트 제거기',
  }));

  streams.push(makeStream({
    id: '413', name: '건조 Cl₂ (F-424 미스트 제거 후 → C-470)', section: '400',
    components: { Cl2: s220_Cl2, O2: s220_O2 },
    total_kgh: s220_Cl2 + s220_O2,
    concentration: (s220_Cl2 / (s220_Cl2 + s220_O2)) * 100,
    moisturePpm: 0.06,
    pressure_kgcm2g: 0.17, temperature_C: 25.0, fluidKey: 'cl2_gas', phase: 'G',
    description: 'F-424 미스트 제거기 출구 → C-470 염소 압축기 흡입',
  }));

  const totalH2OAbsorbedDrying = flash420.waterVaporOutKgH - s411_H2O;
  const freshAcid98TotalKgH = totalH2OAbsorbedDrying * (0.78 / (0.98 - 0.78));
  const freshAcid_H2SO4 = freshAcid98TotalKgH * 0.98;
  const freshAcid_H2O   = freshAcid98TotalKgH * 0.02;

  streams.push(makeStream({
    id: '416', name: '98% H₂SO₄ 신산 공급 (P-450 → T-450)', section: '400',
    components: { H2SO4: freshAcid_H2SO4, H2O: freshAcid_H2O },
    total_kgh: freshAcid98TotalKgH,
    concentration: 98.0,
    pressure_kgcm2g: 3.8, temperature_C: 20.0, fluidKey: 'h2so4_98', phase: 'L',
    description: `T-450 상부 98% 황산 피드 (흡수수분 ${totalH2OAbsorbedDrying.toFixed(1)} kg/h 처리 후 78% 폐황산 ${(freshAcid98TotalKgH + totalH2OAbsorbedDrying).toFixed(1)} kg/h 배출)`,
  }));

  // 4) C-470 염소 압축기 & E-460 액화기 & 수액기
  streams.push(makeStream({
    id: '415', name: `압축 Cl₂ (C-470 출구, ${cl2CompPressG} kg/cm²G)`, section: '400',
    components: { Cl2: s220_Cl2, O2: s220_O2 },
    total_kgh: s220_Cl2 + s220_O2,
    concentration: (s220_Cl2 / (s220_Cl2 + s220_O2)) * 100,
    pressure_kgcm2g: cl2CompPressG, temperature_C: 40.0, fluidKey: 'cl2_gas', phase: 'G',
    description: `C-470 터보 압축기 토출 (${cl2CompPressG} kg/cm²G, 40°C) → 가스 제품[426] 및 E-460 액화기 분기`,
  }));

  const s426_Cl2 = 8799.9 * sf;
  const s421_Cl2 = 10677.9 * sf;
  const s420_Cl2 = Math.max(10, s220_Cl2 - s426_Cl2 - s421_Cl2);

  streams.push(makeStream({
    id: '418', name: '액화 Cl₂ (E-460 출구, -22°C)', section: '400',
    components: { Cl2: s421_Cl2 + s420_Cl2, O2: s220_O2 * 0.5 },
    total_kgh: s421_Cl2 + s420_Cl2 + s220_O2 * 0.5,
    concentration: 99.88,
    pressure_kgcm2g: cl2CompPressG, temperature_C: -22.0, fluidKey: 'cl2_liq', phase: 'L/G', vaporFraction: 0.04,
    description: 'E-460 염소 액화기 출구 (-22°C) → D-484 수액기',
  }));

  streams.push(makeStream({
    id: '420', name: '액화 테일가스 (D-484 기상 → 제해탑)', section: '400',
    components: { Cl2: s420_Cl2, O2: s220_O2 * 0.35 },
    total_kgh: s420_Cl2 + s220_O2 * 0.35,
    concentration: (s420_Cl2 / (s420_Cl2 + s220_O2 * 0.35)) * 100,
    pressure_kgcm2g: cl2CompPressG, temperature_C: -20.0, fluidKey: 'cl2_gas', phase: 'G',
    description: 'D-484/D-495 비응축 테일가스 → T-730/D-940 가성소다 제해탑(NaOCl 회수)',
  }));

  streams.push(makeStream({
    id: '421', name: '액화 Cl₂ (D-484 → D-496 저장탱크)', section: '400',
    components: { Cl2: s421_Cl2 },
    total_kgh: s421_Cl2,
    concentration: 99.9,
    pressure_kgcm2g: cl2CompPressG, temperature_C: -17.0, fluidKey: 'cl2_liq', phase: 'L',
    description: 'D-484 수액기 액상 → D-496 액화염소 저장탱크',
  }));

  streams.push(makeStream({
    id: '425', name: '액화 Cl₂ 제품 출하 (P-494A/B)', section: '400',
    components: { Cl2: s421_Cl2 },
    total_kgh: s421_Cl2,
    concentration: 99.9,
    pressure_kgcm2g: 24.0, temperature_C: -17.0, fluidKey: 'cl2_liq', phase: 'L',
    description: 'D-496 → P-494A/B 고압 액화염소 출하 라인',
  }));

  streams.push(makeStream({
    id: '426', name: '가스상 Cl₂ 제품 출하 (파이프라인)', section: '400',
    components: { Cl2: s426_Cl2, O2: s220_O2 * 0.5 },
    total_kgh: s426_Cl2 + s220_O2 * 0.5,
    concentration: 99.86,
    pressure_kgcm2g: cl2CompPressG, temperature_C: 40.0, fluidKey: 'cl2_gas', phase: 'G',
    description: 'C-470 후단 기체 Cl₂ 파이프라인 공급 (EDC/VCM 등 수요처)',
  }));

  streams.push(makeStream({
    id: '429', name: '테일가스 퍼지 (D-495 기상)', section: '400',
    components: { Cl2: 6.0 * sf, O2: 1.76 * sf },
    total_kgh: 7.76 * sf,
    pressure_kgcm2g: cl2CompPressG, temperature_C: -20.0, fluidKey: 'cl2_gas', phase: 'G',
    description: 'D-495 기액분리기 기상 퍼지 → 제해탑',
  }));

  // ══════════════════════════════════════════════════════════════════
  // BLOCK C: 200 SEC 후반부 — T-280 진공 탈염소탑 & D-080 브라인 순환 루프 닫기
  // ══════════════════════════════════════════════════════════════════

  const s224_NaCl = 950.70 * sf;
  const s224_H2O  = 4499.30 * sf;
  streams.push(makeStream({
    id: '224', name: '양극 드레인 회수 브라인 (P-264A/B → FCV-264)', section: '200',
    components: { NaCl: s224_NaCl, H2O: s224_H2O },
    total_kgh: s224_NaCl + s224_H2O,
    concentration: (s224_NaCl / (s224_NaCl + s224_H2O)) * 100,
    pressure_kgcm2g: 3.2, temperature_C: 86.0, fluidKey: 'anolyte', phase: 'L',
    description: 'D-260 → P-261 → D-264 → P-264A/B (FCV-264) 회수 브라인 → [218]과 합류',
  }));

  const s250_NaCl = s218_NaCl + s224_NaCl;
  const s250_H2O  = s218_H2O + s224_H2O + s402_H2O;
  const s250_Cl2  = s218_Cl2 + s402_Cl2 + s402_HCl;
  streams.push(makeStream({
    id: '250', name: '탈염소탑 피드 브라인 (PHCV-280 → T-280)', section: '200',
    components: { NaCl: s250_NaCl, H2O: s250_H2O, Cl2: s250_Cl2 },
    total_kgh: s250_NaCl + s250_H2O + s250_Cl2,
    concentration: (s250_NaCl / (s250_NaCl + s250_H2O)) * 100,
    pressure_kgcm2g: 0.40, temperature_C: 88.5, fluidKey: 'anolyte', phase: 'L',
    description: '[218] 양극액 + [224] 회수액 + [402] T-410 수세폐수 합류 → T-280 진공 탈염소탑 상부 인입',
  }));

  const s252_Cl2 = s250_Cl2;
  const s252_H2O = 2.29 * sf * (0.383 / Math.max(0.15, t280VacPressG + 1.03323));
  streams.push(makeStream({
    id: '252', name: '탈염소탑 회수 Cl₂ 가스 (T-280 진공펌프 출구)', section: '200',
    components: { Cl2: s252_Cl2, H2O: s252_H2O },
    total_kgh: s252_Cl2 + s252_H2O,
    concentration: (s252_Cl2 / (s252_Cl2 + s252_H2O)) * 100,
    pressure_kgcm2g: 0.20, temperature_C: 40.0, fluidKey: 'cl2_gas', phase: 'G',
    description: 'T-280 상부 기상 → 응축기 → 진공펌프(PCV-280-1/2) → 400 Sec 회수',
  }));

  streams.push(makeStream({
    id: '257', name: '잔류염소 제거 약품 (PHCV-281 → D-280)', section: '200',
    components: { Na2SO3: 18.5 * sf, H2O: 165.0 * sf },
    total_kgh: 183.5 * sf,
    concentration: 10.0,
    pressure_kgcm2g: 3.5, temperature_C: 25.0, fluidKey: 'water', phase: 'L',
    description: 'PHCV-281 아황산소다(Na₂SO₃)/가성소다 주입 → D-280 하부 잔류 유리염소 완전 제거',
  }));

  const s256_NaCl = s250_NaCl;
  const s256_H2O  = s250_H2O + 165.0 * sf - s252_H2O;
  streams.push(makeStream({
    id: '259', name: '탈염소 브라인 펌프 토출 (D-280 → P-284A/B)', section: '200',
    components: { NaCl: s256_NaCl, H2O: s256_H2O },
    total_kgh: s256_NaCl + s256_H2O,
    concentration: (s256_NaCl / (s256_NaCl + s256_H2O)) * 100,
    pressure_kgcm2g: 3.3, temperature_C: 90.0, fluidKey: 'anolyte', phase: 'L',
    description: 'T-280 하부 D-280 → P-284A/B (157 m³/h, 3.3 kg/cm²G, 90°C) → LCV-280',
  }));

  streams.push(makeStream({
    id: '256', name: '탈염소 브라인 (LCV-280 → D-080 탱크)', section: '200',
    components: { NaCl: s256_NaCl, H2O: s256_H2O },
    total_kgh: s256_NaCl + s256_H2O,
    concentration: (s256_NaCl / (s256_NaCl + s256_H2O)) * 100,
    pressure_kgcm2g: 3.3, temperature_C: 90.0, fluidKey: 'anolyte', phase: 'L',
    description: 'LCV-280 후단 → D-080 묽은 브라인 집수조 (LCV-080 보충수 합류 전)',
  }));

  // ══════════════════════════════════════════════════════════════════
  // BLOCK D: 100 SEC — 브라인 포화·반응·침전·여과·이온교환 (Recycle Loop Closed)
  // ══════════════════════════════════════════════════════════════════

  const makeupWater_D080 = Math.max(0, s104_H2O - s256_H2O);
  const s001_NaCl = s256_NaCl;
  const s001_H2O  = s256_H2O + makeupWater_D080;
  const s001_tot  = s001_NaCl + s001_H2O;
  const s001_conc = (s001_NaCl / s001_tot) * 100;

  streams.push(makeStream({
    id: '001', name: '묽은 브라인 반환 피드 (P-084A/B → FCV-080)', section: '100',
    components: { NaCl: s001_NaCl, H2O: s001_H2O },
    total_kgh: s001_tot,
    concentration: s001_conc,
    pressure_kgcm2g: 3.2, temperature_C: 71.6, fluidKey: 'brine_15', phase: 'L',
    description: `D-080 (보충수 ${makeupWater_D080.toFixed(0)} kg/h 합류) → P-084A/B (186 m³/h) → FCV-080 → D-010A/B 포화조`,
  }));

  const s002_ratio = 16170.0 / 206742.58;
  const s002_NaCl  = s001_NaCl * s002_ratio;
  const s002_H2O   = s001_H2O * s002_ratio;
  streams.push(makeStream({
    id: '002', name: '포화조 보조 분기 (FCV-010 → D-010A/B)', section: '100',
    components: { NaCl: s002_NaCl, H2O: s002_H2O },
    total_kgh: s002_NaCl + s002_H2O,
    concentration: s001_conc,
    pressure_kgcm2g: 3.0, temperature_C: 71.6, fluidKey: 'brine_15', phase: 'L',
    description: 'FCV-010 → D-010A/B 포화조 상부 보조 유입 라인',
  }));

  const s003_NaCl = elec.naclConsumptionKgH;
  streams.push(makeStream({
    id: '003', name: '원료 소금 투입 (Salt Hopper → D-010A/B)', section: '100',
    components: { NaCl: s003_NaCl },
    total_kgh: s003_NaCl,
    concentration: 100.0,
    pressure_kgcm2g: 0.0, temperature_C: 25.0, density_kgm3: 2160, phase: 'L',
    description: `소금 호퍼 → D-010A/B 포화조 원염 용해 (전해조 NaCl 소모량 ${(s003_NaCl * 24 / 1000).toFixed(1)} t/d 보충)`,
  }));

  const s004_NaCl = s001_NaCl + s003_NaCl;
  const s004_H2O  = s001_H2O;
  const s004_tot  = s004_NaCl + s004_H2O;
  const s004_conc = (s004_NaCl / s004_tot) * 100;

  streams.push(makeStream({
    id: '004', name: '포화 조염수 (D-013 → P-014A/B → LCV-013)', section: '100',
    components: { NaCl: s004_NaCl, H2O: s004_H2O },
    total_kgh: s004_tot,
    concentration: s004_conc,
    pressure_kgcm2g: 3.8, temperature_C: 70.0, fluidKey: 'brine_25', phase: 'L',
    description: 'D-010A/B 용해조 → D-013 → P-014A/B (190 m³/h, 3.8 kg/cm²G, 70°C) → D-020 반응조 인입',
  }));

  streams.push(makeStream({
    id: '006', name: 'BaCl₂ 약품 주입 (D-050 → P-054A/B)', section: '100',
    components: { BaCl2: 11.7 * sf, H2O: 105.3 * sf },
    total_kgh: 117.0 * sf,
    concentration: 10.0,
    pressure_kgcm2g: 5.0, temperature_C: 25.0, fluidKey: 'water', phase: 'L',
    description: 'D-050 → P-054A/B (0.2 m³/h, 5 kg/cm²G) 황산이온(SO₄²⁻) 침전 제거용 BaCl₂',
  }));

  streams.push(makeStream({
    id: '008', name: 'NaOH 약품 주입 (PHCV-020 → D-020 전단)', section: '100',
    components: { NaOH: 48.0 * sf, H2O: 102.0 * sf },
    total_kgh: 150.0 * sf,
    concentration: 32.0,
    pressure_kgcm2g: 4.0, temperature_C: 25.0, fluidKey: 'naoh_32', phase: 'L',
    description: 'PHCV-020 마그네슘(Mg²⁺ → Mg(OH)₂↓) 침전 제거 및 pH 조절용 NaOH',
  }));

  streams.push(makeStream({
    id: '009', name: 'Na₂CO₃ 약품 주입 (D-070 → P-074A/B)', section: '100',
    components: { Na2CO3: 45.0 * sf, H2O: 255.0 * sf },
    total_kgh: 300.0 * sf,
    concentration: 15.0,
    pressure_kgcm2g: 5.0, temperature_C: 25.0, fluidKey: 'water', phase: 'L',
    description: 'D-070 → P-074A/B (0.3 m³/h, 5 kg/cm²G) 칼슘(Ca²⁺ → CaCO₃↓) 침전 제거용 탄산소다',
  }));

  streams.push(makeStream({
    id: '013', name: '반응조 출구 브라인 (D-020 → T-030)', section: '100',
    components: { NaCl: s004_NaCl, H2O: s004_H2O },
    total_kgh: s004_tot,
    concentration: s004_conc,
    pressure_kgcm2g: 3.5, temperature_C: 68.0, fluidKey: 'brine_25', phase: 'L',
    description: 'D-020 교반 반응조 출구 → 응집제[014] 혼합 → T-030 침전조(Clarifier) 인입',
  }));

  streams.push(makeStream({
    id: '014', name: '응집제 주입 (D-060 → P-064A/B → T-030 입구)', section: '100',
    components: { H2O: 300.0 * sf },
    total_kgh: 300.0 * sf,
    pressure_kgcm2g: 5.0, temperature_C: 25.0, fluidKey: 'water', phase: 'L',
    description: 'D-060 → P-064A/B (0.3 m³/h, 5 kg/cm²G) 고분자 응집제(Flocculant) 주입',
  }));

  streams.push(makeStream({
    id: '017', name: '침전조 하부 슬러지 (T-030 Bottom → P-033A/B)', section: '100',
    components: { NaCl: 9750.0 * sf, H2O: 29250.0 * sf },
    total_kgh: 39000.0 * sf,
    concentration: 25.0,
    pressure_kgcm2g: 3.0, temperature_C: 65.0, density_kgm3: 1280, phase: 'L',
    description: 'T-030 침전조 하부 슬러지 언더플로우 → P-033A/B (30 m³/h, 3 kg/cm²G, 65°C)',
  }));

  streams.push(makeStream({
    id: '015', name: '슬러지 시드 순환 (P-033A/B → D-020 전단)', section: '100',
    components: { NaCl: 9250.0 * sf, H2O: 27750.0 * sf },
    total_kgh: 37000.0 * sf,
    concentration: 25.0,
    pressure_kgcm2g: 3.0, temperature_C: 65.0, density_kgm3: 1280, phase: 'L',
    description: 'P-033A/B → D-020 입구 결정 성장용 슬러지 시드 재순환',
  }));

  streams.push(makeStream({
    id: '016', name: '브라인 슬러지 퍼지 (P-033A/B → KV-030 배출)', section: '100',
    components: { NaCl: 500.0 * sf, H2O: 1500.0 * sf },
    total_kgh: 2000.0 * sf,
    concentration: 25.0,
    pressure_kgcm2g: 2.5, temperature_C: 65.0, density_kgm3: 1280, phase: 'L',
    description: 'KV-030 침전 슬러지(CaCO₃, Mg(OH)₂, BaSO₄) 폐기 배출',
  }));

  streams.push(makeStream({
    id: '021', name: '침전조 상등액 (T-030 Overflow → D-040)', section: '100',
    components: { NaCl: s004_NaCl, H2O: s004_H2O },
    total_kgh: s004_tot,
    concentration: s004_conc,
    pressure_kgcm2g: 0.2, temperature_C: 62.0, fluidKey: 'brine_25', phase: 'L',
    description: 'T-030 침전조 상부 청정 오버플로우 → D-040 청정 브라인 탱크',
  }));

  streams.push(makeStream({
    id: '022', name: '1차 여과기 피드 (D-040 → P-044A/B → F-140A/B)', section: '100',
    components: { NaCl: s004_NaCl, H2O: s004_H2O },
    total_kgh: s004_tot,
    concentration: s004_conc,
    pressure_kgcm2g: 3.5, temperature_C: brineFeedTempC, fluidKey: 'brine_25', phase: 'L',
    description: `D-040 → P-044A/B (190 m³/h, 3.5 kg/cm²G, ${brineFeedTempC}°C) → F-140A/B 1차 정밀여과기`,
  }));

  streams.push(makeStream({
    id: '101', name: '여과조제 Body Feed (D-130 → P-134A/B → FCV-044)', section: '100',
    components: { NaCl: 54.9 * sf, H2O: 160.7 * sf },
    total_kgh: 215.6 * sf,
    concentration: 25.5,
    pressure_kgcm2g: 2.34, temperature_C: 61.4, fluidKey: 'brine_25', phase: 'L',
    description: 'Body Feed Tank(D-130) → P-134A/B (0.5 m³/h, 2.34 kg/cm²G) → FCV-044 → [022] 합류',
  }));

  streams.push(makeStream({
    id: '110', name: 'Precoat 순환 라인 (D-120 → P-124 → F-140A/B)', section: '100',
    components: { NaCl: 55.0 * sf, H2O: 160.0 * sf },
    total_kgh: 215.0 * sf,
    concentration: 25.6,
    pressure_kgcm2g: 2.9, temperature_C: 61.4, fluidKey: 'brine_25', phase: 'L',
    description: 'Precoat Tank(D-120) → P-124 (188 m³/h 배치 운전) → F-140A/B 프리코팅',
  }));

  streams.push(makeStream({
    id: '102', name: '1차 여과 브라인 (D-150 → P-154A/B → T-160)', section: '100',
    components: { NaCl: s004_NaCl, H2O: s004_H2O },
    total_kgh: s004_tot,
    concentration: s004_conc,
    pressure_kgcm2g: 2.0, temperature_C: brineFeedTempC, fluidKey: 'brine_25', phase: 'L',
    description: `F-140A/B 여과기 → D-150 → P-154A/B (190 m³/h, 2.0 kg/cm²G, ${brineFeedTempC}°C) → T-160 킬레이트 수지탑`,
  }));

  streams.push(makeStream({
    id: '105', name: '킬레이트 수지 재생액 (P-644A/B → FCV-162/PHCV-170)', section: '100',
    components: { NaOH: 32.0 * sf, H2O: 68.0 * sf },
    total_kgh: 100.0 * sf,
    concentration: 32.0,
    pressure_kgcm2g: 3.5, temperature_C: 25.0, fluidKey: 'naoh_32', phase: 'L',
    description: 'P-644A/B → FCV-162 / PHCV-170 수지 재생 및 정제염수 pH 조절',
  }));

  streams.push(makeStream({
    id: '104', name: '초고순도 정제 브라인 (D-170 → P-174A/B → 200 Sec)', section: '100',
    components: { NaCl: s104_NaCl, H2O: s104_H2O },
    total_kgh: s104_tot,
    concentration: (s104_NaCl / s104_tot) * 100,
    pressure_kgcm2g: 4.0, temperature_C: brineFeedTempC, fluidKey: 'brine_25', phase: 'L',
    description: `T-160 킬레이트 수지탑(Ca+Mg < 20 ppb) → D-170 → P-174A/B (190 m³/h, 4.0 kg/cm²G, ${brineFeedTempC}°C) → 200 Sec 전해조 피드`,
  }));

  // ══════════════════════════════════════════════════════════════════
  // BLOCK E: 300 SEC — NaOH 3중효용 증발 농축 (32% → 50%)
  // ══════════════════════════════════════════════════════════════════
  const naoh_sf = s219_NaOH / 22002.82;
  const evapSim = simulateTripleEffectEvaporator(naoh_sf);
  evapSim.streams300.forEach(s => streams.push(makeStream(s)));

  // ══════════════════════════════════════════════════════════════════
  // BLOCK F: 600 SEC — H2 냉각·압축·고압냉각·제습 (VLE Flash & Compr)
  // ══════════════════════════════════════════════════════════════════
  const h2DryKmolH  = s221_H2 / MW.H2;
  const h2DryMassKgH = s221_H2;

  streams.push(makeStream({
    id: '601', name: 'H₂ 헤더 (PCV-227 후 → E-5613)', section: '600',
    components: { H2: s221_H2, H2O: s221_H2O },
    total_kgh: s221_H2 + s221_H2O,
    concentration: (s221_H2 / (s221_H2 + s221_H2O)) * 100,
    pressure_kgcm2g: 0.211, temperature_C: cathodeTempC, fluidKey: 'h2_gas', phase: 'G',
    description: 'PCV-227 후단 습윤 H₂ 헤더 → E-5613 1차 냉각기',
  }));

  // 1) E-5613 1차 수소 냉각기
  const flash5613 = flashWetGas({
    dryGasKmolH: h2DryKmolH,
    dryGasMassKgH: h2DryMassKgH,
    dryGasCpKcalKgC: 3.44,
    waterInKgH: s221_H2O,
    T_in_C: cathodeTempC,
    T_out_C: h2Cooler1Temp,
    P_out_kgcm2g: 0.211,
    waterActivity: 1.0,
    efficiencyFactor: 0.99,
  });
  const qE5613TotalKcalH = flash5613.qLatentKcalH + 267814 * sf * ((cathodeTempC - h2Cooler1Temp) / 49.0);

  streams.push(makeStream({
    id: '602', name: `H₂ (E-5613 1차 냉각 후, ${h2Cooler1Temp}°C)`, section: '600',
    components: { H2: s221_H2, H2O: flash5613.waterVaporOutKgH },
    total_kgh: s221_H2 + flash5613.waterVaporOutKgH,
    concentration: (s221_H2 / (s221_H2 + flash5613.waterVaporOutKgH)) * 100,
    pressure_kgcm2g: 0.211, temperature_C: h2Cooler1Temp, fluidKey: 'h2_gas', phase: 'G',
    description: `E-5613 1차 냉각기 출구 (응축수 ${flash5613.waterCondensedKgH.toFixed(1)} kg/h 제거) → E-5630 2차 냉각기`,
  }));

  // 2) E-5630 2차 수소 냉각기
  const flash5630 = flashWetGas({
    dryGasKmolH: h2DryKmolH,
    dryGasMassKgH: h2DryMassKgH,
    dryGasCpKcalKgC: 3.44,
    waterInKgH: flash5613.waterVaporOutKgH,
    T_in_C: h2Cooler1Temp,
    T_out_C: h2Cooler2Temp,
    P_out_kgcm2g: 0.210,
    waterActivity: 1.0,
    efficiencyFactor: 0.99,
  });
  const qE5630TotalKcalH = flash5630.qLatentKcalH + 46041 * sf * ((h2Cooler1Temp - h2Cooler2Temp) / 31.0);

  streams.push(makeStream({
    id: '603', name: `H₂ (E-5630 2차 냉각 후, ${h2Cooler2Temp}°C)`, section: '600',
    components: { H2: s221_H2, H2O: flash5630.waterVaporOutKgH },
    total_kgh: s221_H2 + flash5630.waterVaporOutKgH,
    concentration: (s221_H2 / (s221_H2 + flash5630.waterVaporOutKgH)) * 100,
    pressure_kgcm2g: 0.210, temperature_C: h2Cooler2Temp, fluidKey: 'h2_gas', phase: 'G',
    description: `E-5630 칠드워터 냉각기 출구 (수분 ${flash5630.waterVaporOutKgH.toFixed(2)} kg/h) → D-610 기액분리기`,
  }));

  streams.push(makeStream({
    id: '604', name: '수분 분리기 배수 (D-610 → T-620)', section: '600',
    components: { H2O: (flash5613.waterCondensedKgH + flash5630.waterCondensedKgH) },
    total_kgh: (flash5613.waterCondensedKgH + flash5630.waterCondensedKgH),
    pressure_kgcm2g: 0.1, temperature_C: 28.0, fluidKey: 'water', phase: 'L',
    description: 'E-5613 + E-5630 + D-610 응축수 회수 라인',
  }));

  const flashComp40 = flashWetGas({
    dryGasKmolH: h2DryKmolH,
    dryGasMassKgH: h2DryMassKgH,
    dryGasCpKcalKgC: 3.44,
    waterInKgH: flash5630.waterVaporOutKgH,
    T_in_C: 40.0,
    T_out_C: 40.0,
    P_out_kgcm2g: h2CompPressG,
    waterActivity: 1.0,
    efficiencyFactor: 0.99,
  });

  streams.push(makeStream({
    id: '607', name: 'H₂ (D-610 분리 후 → C-620 흡입)', section: '600',
    components: { H2: s221_H2, H2O: flashComp40.waterVaporOutKgH },
    total_kgh: s221_H2 + flashComp40.waterVaporOutKgH,
    concentration: (s221_H2 / (s221_H2 + flashComp40.waterVaporOutKgH)) * 100,
    pressure_kgcm2g: 0.210, temperature_C: h2Cooler2Temp, fluidKey: 'h2_gas', phase: 'G',
    description: 'D-610 기상 출구 → C-620 H₂ 압축기 흡입',
  }));

  streams.push(makeStream({
    id: '608', name: `압축 H₂ (C-620 출구, ${h2CompPressG} kg/cm²G)`, section: '600',
    components: { H2: s221_H2, H2O: flashComp40.waterVaporOutKgH },
    total_kgh: s221_H2 + flashComp40.waterVaporOutKgH,
    concentration: (s221_H2 / (s221_H2 + flashComp40.waterVaporOutKgH)) * 100,
    pressure_kgcm2g: h2CompPressG, temperature_C: 40.0, fluidKey: 'h2_gas', phase: 'G',
    description: `C-620 H₂ 압축기 토출 (${h2CompPressG} kg/cm²G, 40°C) → E-5680 고압 냉각기`,
  }));

  // 3) E-5680 고압 수소 냉각기
  const flash5680 = flashWetGas({
    dryGasKmolH: h2DryKmolH,
    dryGasMassKgH: h2DryMassKgH,
    dryGasCpKcalKgC: 3.44,
    waterInKgH: flashComp40.waterVaporOutKgH,
    T_in_C: 40.0,
    T_out_C: h2HighPTempC,
    P_out_kgcm2g: h2CompPressG,
    waterActivity: 1.0,
    efficiencyFactor: 0.99,
  });
  const qE5680TotalKcalH = flash5680.qLatentKcalH + 44556 * sf * ((40.0 - h2HighPTempC) / 30.0);

  streams.push(makeStream({
    id: '609', name: `고압 냉각 H₂ (E-5680 출구, ${h2HighPTempC}°C)`, section: '600',
    components: { H2: s221_H2, H2O: flash5680.waterVaporOutKgH },
    total_kgh: s221_H2 + flash5680.waterVaporOutKgH,
    concentration: (s221_H2 / (s221_H2 + flash5680.waterVaporOutKgH)) * 100,
    moisturePpm: (flash5680.waterVaporOutKgH / s221_H2) * 1e6,
    pressure_kgcm2g: h2CompPressG, temperature_C: h2HighPTempC, fluidKey: 'h2_gas', phase: 'G',
    description: `E-5680 고압 냉각 후 (수분 ${flash5680.waterVaporOutKgH.toFixed(2)} kg/h) → D-650 실리카겔 제습기`,
  }));

  streams.push(makeStream({
    id: '610', name: '제습 건조 H₂ (D-650 → E-5682)', section: '600',
    components: { H2: s221_H2, H2O: flash5680.waterVaporOutKgH * 0.05 },
    total_kgh: s221_H2 + flash5680.waterVaporOutKgH * 0.05,
    concentration: 99.98,
    pressure_kgcm2g: h2CompPressG, temperature_C: 80.0, fluidKey: 'h2_gas', phase: 'G',
    description: 'D-650 제습기 및 E-5682 재생/후단 열교환기 출구',
  }));

  streams.push(makeStream({
    id: '611', name: '고순도 H₂ 제품 (공급 헤더)', section: '600',
    components: { H2: s221_H2 },
    total_kgh: s221_H2,
    concentration: 99.99,
    pressure_kgcm2g: h2CompPressG, temperature_C: 40.0, fluidKey: 'h2_gas', phase: 'G',
    description: `D-680 고압 H₂ 제품 공급 헤더 (${h2CompPressG} kg/cm²G, 40°C)`,
  }));

  const ccwFlow612 = (qE5630TotalKcalH / 7.76);
  streams.push(makeStream({
    id: '612', name: 'CCW 칠드워터 공급 (E-5630)', section: '600',
    components: { H2O: ccwFlow612 },
    total_kgh: ccwFlow612,
    pressure_kgcm2g: 3.5, temperature_C: 7.0, fluidKey: 'water', phase: 'L',
    description: 'E-5630 2차 수소 냉각기용 7°C 칠드워터 공급',
  }));

  streams.push(makeStream({
    id: '613', name: '재생 스팀 응축수 (E-5682 / D-650)', section: '600',
    components: { H2O: 204.92 * sf },
    total_kgh: 204.92 * sf,
    pressure_kgcm2g: 3.0, temperature_C: 143.9, fluidKey: 'steam', phase: 'L',
    description: 'E-5682 / D-650 제습탑 재생용 3k 스팀 응축수',
  }));

  streams.push(makeStream({
    id: '614', name: '고압 응축수 배출 (E-5680 Drain)', section: '600',
    components: { H2O: flash5680.waterCondensedKgH },
    total_kgh: flash5680.waterCondensedKgH,
    pressure_kgcm2g: h2CompPressG, temperature_C: h2HighPTempC, fluidKey: 'water', phase: 'L',
    description: 'E-5680 고압 수소 냉각기 수분 응축 드레인',
  }));

  // ══════════════════════════════════════════════════════════════════
  // UNIT BLOCKS — 섹션 순서대로 체계적 정렬 (100 → 200 → 300 → 400 → 600 Sec)
  // ══════════════════════════════════════════════════════════════════

  // [100 Sec] 브라인 포화·정제 계통
  unitBlocks.push({
    id: 'D-010 / D-020 / T-030 / F-140 / T-160',
    name: '100 Sec 브라인 포화·반응·침전·여과·킬레이트 이온교환 계통',
    simBlockType: '원염 용해 + 침전 정제 + 이온교환 모델',
    section: '100',
    inletStreams: ['001', '003', '006', '008', '009', '014'],
    outletStreams: ['004', '016', '022', '102', '104'],
    tempInC: 71.6,
    tempOutC: brineFeedTempC,
    pressKgcm2g: 4.0,
    sensibleHeatKcalH: 1450000 * sf * ((71.6 - brineFeedTempC) / 11.6),
    latentOrDilutionHeatKcalH: 385000 * sf,
    totalHeatDutyKcalH: 1450000 * sf * ((71.6 - brineFeedTempC) / 11.6) + 385000 * sf,
    totalHeatDutyKW: (1450000 * sf * ((71.6 - brineFeedTempC) / 11.6) + 385000 * sf) / 859.845,
    coolingMedium: `원염 용해 흡열 + 방열 (71.6 → ${brineFeedTempC.toFixed(1)} °C)`,
    keySpecSummary: `원염 용해=${(s003_NaCl / 1000).toFixed(2)} t/h (${s001_conc.toFixed(1)}%→${((s104_NaCl / s104_tot) * 100).toFixed(2)}% NaCl), Ca+Mg < 20 ppb`,
  });

  // [200 Sec - 1] EL-200 이온교환막 전해조 본체 및 D-210 양극 기액분리기
  const qCatholyteCoolerKcalH = Math.max(250000, elec.totalHeatGeneratedKcalH * 0.58);
  const qAnodeVaporLatentKcalH = s220_H2O * 548.0;
  unitBlocks.push({
    id: 'EL-200 & D-210 (×5기)',
    name: `이온교환막 전해조 (${N_el}기×${inputs.cellsPerElectrolyzer}셀) & 양극 기액분리기 (D-210)`,
    simBlockType: '전기화학 반응 + 막 수분수송 + 양극 기액분리(VLE)',
    section: '200',
    inletStreams: ['104', '201', '204', '208'],
    outletStreams: ['202', '202a', '203', '220', '218'],
    tempInC: 66.0,
    tempOutC: anodeTempC,
    pressKgcm2g: anodePressG,
    waterRemovedKgH: s220_H2O,
    sensibleHeatKcalH: Math.max(0, elec.totalHeatGeneratedKcalH - qCatholyteCoolerKcalH - qAnodeVaporLatentKcalH),
    latentOrDilutionHeatKcalH: qAnodeVaporLatentKcalH,
    totalHeatDutyKcalH: elec.totalHeatGeneratedKcalH - qCatholyteCoolerKcalH,
    totalHeatDutyKW: (elec.totalHeatGeneratedKcalH - qCatholyteCoolerKcalH) / 859.845,
    coolingMedium: '양극 수증기 증발 잠열 + 브라인 현열 흡수',
    keySpecSummary: `V_cell=${elec.cellVoltageV.toFixed(2)}V, DC=${elec.totalDcPowerMW.toFixed(2)}MW, D-210 습윤Cl₂ 수분동반=${s220_H2O.toFixed(1)} kg/h, 막수분이동=${(elec.waterToMembraneKgH / 1000).toFixed(2)}t/h`,
  });

  // [200 Sec - 2] D-220 음극 기액분리기 & E-223 음극액 순환 냉각기 (막 차압 ΔP 표시)
  const qCathodeVaporLatentKcalH = s221_H2O * 545.0;
  unitBlocks.push({
    id: 'D-220 / D-250 / E-223 (×5기)',
    name: '음극 기액분리기 (D-220) & 음극액 순환 냉각기 (E-223)',
    simBlockType: `음극 기액분리(VLE) + 순환 냉각 (막 차압 ΔP=${deltaPKgcm2 >= 0 ? '+' : ''}${deltaPKgcm2.toFixed(2)} kg/cm²)`,
    section: '200',
    inletStreams: ['209', '213', '214', '217'],
    outletStreams: ['211', '212', '219', '221'],
    tempInC: cathodeTempC,
    tempOutC: 85.0,
    pressKgcm2g: cathodePressG,
    waterRemovedKgH: s221_H2O,
    sensibleHeatKcalH: qCatholyteCoolerKcalH - qCathodeVaporLatentKcalH,
    latentOrDilutionHeatKcalH: qCathodeVaporLatentKcalH,
    totalHeatDutyKcalH: qCatholyteCoolerKcalH,
    totalHeatDutyKW: qCatholyteCoolerKcalH / 859.845,
    coolingMedium: 'CW (음극액 냉각기 E-223 / HCV-223)',
    coolingFlowM3H: qCatholyteCoolerKcalH / (6.0 * 1000),
    keySpecSummary: `D-220 압력=${cathodePressG.toFixed(2)} kg/cm²G (D-210 대비 ΔP=${(deltaPKgcm2 * 10000).toFixed(0)} mmH₂O), 습윤H₂ 수분동반=${s221_H2O.toFixed(1)} kg/h, 32% NaOH=${(s219_NaOH / (pu.d220LiqOut_ConcWt / 100) / 1000).toFixed(2)} t/h`,
  });

  // [200 Sec - 3] T-280 진공 탈염소탑 & 상부 응축기
  unitBlocks.push({
    id: 'T-280 / D-280 / P-284',
    name: '진공 탈염소탑 (T-280) & 상부 응축기 & 탈염소 펌프 (P-284A/B)',
    simBlockType: '진공 스트리핑 기액평형 + 상부 응축 모델',
    section: '200',
    inletStreams: ['218', '224', '402', '250', '257'],
    outletStreams: ['252', '259', '256'],
    tempInC: 88.5,
    tempOutC: 90.0,
    pressKgcm2g: t280VacPressG,
    cl2RemovedKgH: s252_Cl2,
    waterRemovedKgH: s252_H2O,
    sensibleHeatKcalH: 42500 * sf,
    latentOrDilutionHeatKcalH: 118000 * sf,
    totalHeatDutyKcalH: 160500 * sf,
    totalHeatDutyKW: (160500 * sf) / 859.845,
    coolingMedium: 'CW (상부 Cl₂ 가스 쿨러)',
    coolingFlowM3H: (160500 * sf) / (6.0 * 1000),
    keySpecSummary: `진공압=${t280VacPressG.toFixed(2)} kg/cm²G, 용존 Cl₂ 회수=${s252_Cl2.toFixed(1)} kg/h ([252]), 탈염소 브라인=${(s256_NaCl + s256_H2O).toFixed(0)} kg/h`,
  });

  // [300 Sec] 3중효용 증발농축기
  unitBlocks.push({
    id: 'E-340 / E-330 / E-320',
    name: '3중 효용 강하막 증발농축기 (32% → 50% NaOH, 역류식)',
    simBlockType: '3중 효용 강하막 증발·응축 열수지 모델',
    section: '300',
    inletStreams: ['219', 'L1', 'S1'],
    outletStreams: ['L14', 'L15', 'C6', 'V3'],
    tempInC: 90.0,
    tempOutC: 43.5,
    pressKgcm2g: 7.3,
    waterRemovedKgH: (s219_H2O - 21382.4 * naoh_sf),
    sensibleHeatKcalH: 1120000 * naoh_sf,
    latentOrDilutionHeatKcalH: 7950000 * naoh_sf,
    totalHeatDutyKcalH: 9070000 * naoh_sf,
    totalHeatDutyKW: (9070000 * naoh_sf) / 859.845,
    coolingMedium: '13k Steam (S1) + 표면응축기 CW',
    coolingFlowM3H: (4650000 * naoh_sf) / (8.0 * 1000),
    keySpecSummary: `증발수분=${((s219_H2O - 21382.4 * naoh_sf) / 1000).toFixed(2)} t/h, 50% NaOH 제품=${((42824.4 * naoh_sf) / 1000).toFixed(2)} t/h (D-370 / P-374A/B)`,
  });

  // [400 Sec - 1] T-410 수세탑 & E-413 1차 냉각기
  unitBlocks.push({
    id: 'T-410 / E-413',
    name: '염소 수세탑 (T-410) & 1차 순환 냉각기 (E-413)',
    simBlockType: '직접 접촉 수세 + 기액평형 응축 모델',
    section: '400',
    inletStreams: ['220'],
    outletStreams: ['401', '402', '403'],
    tempInC: anodeTempC,
    tempOutC: cl2Cooler1Temp,
    pressKgcm2g: 0.27,
    waterRemovedKgH: flash410.waterCondensedKgH,
    sensibleHeatKcalH: flash410.qSensibleKcalH + qCircWater410,
    latentOrDilutionHeatKcalH: flash410.qLatentKcalH,
    totalHeatDutyKcalH: qE413TotalKcalH,
    totalHeatDutyKW: qE413TotalKcalH / 859.845,
    coolingMedium: 'CW (32.0 → 38.0 °C)',
    coolingFlowM3H: qE413TotalKcalH / (6.0 * 1000),
    keySpecSummary: `수분 응축 제거=${flash410.waterCondensedKgH.toFixed(1)} kg/h (${s220_H2O.toFixed(0)}→${flash410.waterVaporOutKgH.toFixed(1)} kg/h), A=26.1 m²`,
  });

  // [400 Sec - 2] T-420 직접냉각탑 & E-423 칠드워터 냉각기
  unitBlocks.push({
    id: 'T-420 / E-423',
    name: '염소 직접냉각탑 (T-420) & 칠드워터 냉각기 (E-423)',
    simBlockType: '칠드워터 냉각 + 기액평형 응축 모델',
    section: '400',
    inletStreams: ['403'],
    outletStreams: ['405'],
    tempInC: cl2Cooler1Temp,
    tempOutC: cl2Cooler2Temp,
    pressKgcm2g: 0.27,
    waterRemovedKgH: flash420.waterCondensedKgH,
    sensibleHeatKcalH: flash420.qSensibleKcalH + 6033 * sf,
    latentOrDilutionHeatKcalH: flash420.qLatentKcalH,
    totalHeatDutyKcalH: qE423TotalKcalH,
    totalHeatDutyKW: qE423TotalKcalH / 859.845,
    coolingMedium: 'CCW 칠드워터 (7.0 → 10.0 °C)',
    coolingFlowM3H: qE423TotalKcalH / (3.0 * 1000),
    keySpecSummary: `수분 응축 제거=${flash420.waterCondensedKgH.toFixed(2)} kg/h (${flash410.waterVaporOutKgH.toFixed(1)}→${flash420.waterVaporOutKgH.toFixed(2)} kg/h), A=7.13 m²`,
  });

  // [400 Sec - 3] T-430/440/450 황산 건조탑
  unitBlocks.push({
    id: 'T-430·440·450 / E-433·443·453',
    name: '3단 황산 건조탑 (T-430/440/450) & 산 냉각기 (E-433~453)',
    simBlockType: '향류 황산 흡수 평형 및 희석열 모델 (Table 1.39)',
    section: '400',
    inletStreams: ['405', '416'],
    outletStreams: ['409', '411', '413'],
    tempInC: cl2Cooler2Temp,
    tempOutC: 25.0,
    pressKgcm2g: 0.20,
    waterRemovedKgH: totalH2OAbsorbedDrying,
    sensibleHeatKcalH: 0,
    latentOrDilutionHeatKcalH: qE433KcalH + qE443_453KcalH,
    totalHeatDutyKcalH: qE433KcalH + qE443_453KcalH,
    totalHeatDutyKW: (qE433KcalH + qE443_453KcalH) / 859.845,
    coolingMedium: 'CCW 칠드워터 (7.0 → 10.0 °C)',
    coolingFlowM3H: (qE433KcalH + qE443_453KcalH) / (3.0 * 1000),
    keySpecSummary: `수분 흡수=${totalH2OAbsorbedDrying.toFixed(2)} kg/h (출구 <0.1 ppm), 98% H₂SO₄=${freshAcid98TotalKgH.toFixed(1)} kg/h → 78% 폐산=${(freshAcid98TotalKgH + totalH2OAbsorbedDrying).toFixed(1)} kg/h`,
  });

  // [400 Sec - 4] C-470 염소 압축기 & E-460 액화기
  const qE460LiquefierKcalH = (s421_Cl2 + s420_Cl2) * (68.8 + 0.115 * 62.0);
  unitBlocks.push({
    id: 'C-470 / E-460 / D-484',
    name: '염소 터보 압축기 (C-470) & 염소 액화기 (E-460)',
    simBlockType: '다단 압축 + 저온 냉동 액화 평형 모델',
    section: '400',
    inletStreams: ['413', '415'],
    outletStreams: ['418', '420', '421', '425', '426'],
    tempInC: 25.0,
    tempOutC: -22.0,
    pressKgcm2g: cl2CompPressG,
    sensibleHeatKcalH: (s421_Cl2 + s420_Cl2) * 0.115 * 62.0,
    latentOrDilutionHeatKcalH: (s421_Cl2 + s420_Cl2) * 68.8,
    totalHeatDutyKcalH: qE460LiquefierKcalH,
    totalHeatDutyKW: qE460LiquefierKcalH / 859.845,
    coolingMedium: '프레온 냉동기 (-30 °C Evap) + 단간 CW',
    keySpecSummary: `압축압력=${cl2CompPressG.toFixed(1)} kg/cm²G, 기체 Cl₂ 공급=${(s426_Cl2 / 1000).toFixed(2)} t/h, 액화 Cl₂=${(s421_Cl2 / 1000).toFixed(2)} t/h`,
  });

  // [600 Sec - 1] E-5613 수소 1차 냉각기
  unitBlocks.push({
    id: 'E-5613',
    name: '수소 1차 냉각기 (E-5613, CW)',
    simBlockType: '기액평형 냉각·응축 모델',
    section: '600',
    inletStreams: ['601'],
    outletStreams: ['602'],
    tempInC: cathodeTempC,
    tempOutC: h2Cooler1Temp,
    pressKgcm2g: 0.211,
    waterRemovedKgH: flash5613.waterCondensedKgH,
    sensibleHeatKcalH: qE5613TotalKcalH - flash5613.qLatentKcalH,
    latentOrDilutionHeatKcalH: flash5613.qLatentKcalH,
    totalHeatDutyKcalH: qE5613TotalKcalH,
    totalHeatDutyKW: qE5613TotalKcalH / 859.845,
    coolingMedium: 'CW (32.0 → 38.0 °C)',
    coolingFlowM3H: qE5613TotalKcalH / (6.0 * 1000),
    keySpecSummary: `수분 응축=${flash5613.waterCondensedKgH.toFixed(1)} kg/h (${s221_H2O.toFixed(1)}→${flash5613.waterVaporOutKgH.toFixed(1)} kg/h)`,
  });

  // [600 Sec - 2] E-5630 수소 2차 칠드워터 냉각기 & D-610
  unitBlocks.push({
    id: 'E-5630 / D-610',
    name: '수소 2차 칠드워터 냉각기 (E-5630) & 기액분리기 (D-610)',
    simBlockType: '칠드워터 냉각·기액분리 모델',
    section: '600',
    inletStreams: ['602', '612'],
    outletStreams: ['603', '604', '607'],
    tempInC: h2Cooler1Temp,
    tempOutC: h2Cooler2Temp,
    pressKgcm2g: 0.210,
    waterRemovedKgH: flash5630.waterCondensedKgH,
    sensibleHeatKcalH: qE5630TotalKcalH - flash5630.qLatentKcalH,
    latentOrDilutionHeatKcalH: flash5630.qLatentKcalH,
    totalHeatDutyKcalH: qE5630TotalKcalH,
    totalHeatDutyKW: qE5630TotalKcalH / 859.845,
    coolingMedium: 'CCW 칠드워터 (7.0 → 14.8 °C)',
    coolingFlowM3H: (qE5630TotalKcalH / 7.76) / 1000,
    keySpecSummary: `수분 응축=${flash5630.waterCondensedKgH.toFixed(1)} kg/h (${flash5613.waterVaporOutKgH.toFixed(1)}→${flash5630.waterVaporOutKgH.toFixed(1)} kg/h)`,
  });

  // [600 Sec - 3] C-620 수소 압축기 & E-5680 고압 냉각기 & D-650 제습기
  unitBlocks.push({
    id: 'C-620 / E-5680 / D-650 / E-5682',
    name: '수소 압축기 (C-620) & 고압 냉각기 (E-5680) & 제습기 (D-650)',
    simBlockType: '고압 압축 + 고압 응축 플래시 + 흡착 제습 모델',
    section: '600',
    inletStreams: ['607', '608'],
    outletStreams: ['609', '610', '611', '614'],
    tempInC: 40.0,
    tempOutC: h2HighPTempC,
    pressKgcm2g: h2CompPressG,
    waterRemovedKgH: (flash5630.waterVaporOutKgH - flashComp40.waterVaporOutKgH) + flash5680.waterCondensedKgH + flash5680.waterVaporOutKgH,
    sensibleHeatKcalH: 44556 * sf * ((40.0 - h2HighPTempC) / 30.0),
    latentOrDilutionHeatKcalH: flash5680.qLatentKcalH,
    totalHeatDutyKcalH: qE5680TotalKcalH,
    totalHeatDutyKW: qE5680TotalKcalH / 859.845,
    coolingMedium: 'CCW (E-5680) / 3k Steam (E-5682 재생)',
    coolingFlowM3H: qE5680TotalKcalH / (5.0 * 1000),
    keySpecSummary: `압축비=${((h2CompPressG + 1.033) / 1.243).toFixed(1)}, E-5680(${h2HighPTempC}°C) 응축=${flash5680.waterCondensedKgH.toFixed(2)} kg/h, 최종 H₂=${s221_H2.toFixed(1)} kg/h (99.99%)`,
  });

  // ── 전체 요약 집계 ──
  const s219_total_kgh = s219_NaOH + s219_H2O;
  const L14_NaOH_kgh   = 21442.0 * naoh_sf;
  const L14_H2O_kgh    = 21382.4 * naoh_sf;
  const L14_total_kgh  = L14_NaOH_kgh + L14_H2O_kgh;
  const totalCoolingDuty_McalH = unitBlocks.reduce((acc, b) => acc + b.totalHeatDutyKcalH / 1000, 0);

  const summary = {
    cl2_tonDay:        elec.cl2ProductionTonD,
    naoh32_tonDay:     s219_total_kgh * 24 / 1000,
    naoh50_tonDay:     L14_total_kgh  * 24 / 1000,
    h2_tonDay:         elec.h2ProductionKgH * 24 / 1000,
    naclUsage_tonDay:  elec.naclConsumptionKgH * 24 / 1000,
    saltUsage_tonDay:  elec.naclConsumptionKgH * 24 / 1000 / 0.985,
    dcPower_MW:        elec.totalDcPowerMW,
    totalCoolingDuty_McalH,
  };

  return { electrolyzerResult: elec, streams, unitBlocks, summary };
}

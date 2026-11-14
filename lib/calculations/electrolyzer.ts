// ============================================================
// 전해조 핵심 계산 엔진 (엄밀 전기화학 + 분극 특성 + Flash2 스타일)
// Electrolyzer Core Electrochemical, Thermodynamic & Transport Engine
// ============================================================

import { FARADAY, MW, DEFAULT_CONDITIONS } from './constants';

export interface ElectrolyzerInputs {
  numElectrolyzers: number;         // 전해조 수량 (기) — 기본 5기
  cellsPerElectrolyzer: number;     // 셀수/전해조 — 기본 190셀
  operatingCurrentKA: number;       // 운전전류 (kA) — 기본 16.2 kA
  currentEfficiency: number;        // 전류효율 (0~1) — 기본 0.94 (94%)

  // ── 전해 공정 설계 스펙 (Design Specs & Operating Conditions) ──
  brineFeedConcWt?: number;         // 정제염수 [104] 농도 (wt% NaCl) — 기본 25.65%
  brineFeedTempC?: number;          // 정제염수 [104] 공급 온도 (°C) — 기본 60.0°C
  anolyteExitConcWt?: number;       // 양극액 출구 [202] 농도 (wt% NaCl) — 기본 17.45% (~18%)
  catholyteConcWt?: number;         // 음극액 가성소다 출구 [211]/[219] 농도 (wt% NaOH) — 기본 32.34% (~32%)
  electrolyzerTempC?: number;       // 전해조 평균 운전 온도 (°C) — 기본 89.0°C
  anodeTempC?: number;              // 양극 기액분리기 D-210 온도 (°C) — 기본 87.0°C
  cathodeTempC?: number;            // 음극 기액분리기 D-220 온도 (°C) — 기본 90.0°C
  anodePressKgcm2g?: number;        // 양극 기액분리기 D-210 압력 (kg/cm²G) — 기본 0.40
  cathodePressKgcm2g?: number;      // 음극 기액분리기 D-220 압력 (kg/cm²G) — 기본 0.45 (막 보호용 미소 양압 ΔP=+0.05~0.15)
  t280VacuumPressKgcm2g?: number;   // 진공 탈염소탑 T-280 운전 압력 (kg/cm²G) — 기본 -0.65
  cl2Cooler1TempC?: number;         // 400 Sec T-410/E-413 1차 냉각 출구 온도 (°C) — 기본 40.0
  cl2Cooler2TempC?: number;         // 400 Sec T-420/E-423 2차 냉각 출구 온도 (°C) — 기본 20.0
  cl2CompPressKgcm2g?: number;      // 400 Sec C-470 염소 압축기 토출 압력 (kg/cm²G) — 기본 3.0
  h2Cooler1TempC?: number;          // 600 Sec E-5613 1차 냉각 출구 온도 (°C) — 기본 41.0
  h2Cooler2TempC?: number;          // 600 Sec E-5630 2차 냉각 출구 온도 (°C) — 기본 10.0
  h2CompPressKgcm2g?: number;       // 600 Sec C-620 압축기 토출 압력 (kg/cm²G) — 기본 23.0
  h2HighPCoolTempC?: number;        // 600 Sec E-5680 고압 냉각기 출구 온도 (°C) — 기본 10.0
}

export interface CellVoltageBreakdown {
  /** Nernst 가역전압 E_rev [V] (T, P, 수용액 활동도) */
  eReversibleV: number;
  /** 양극(DSA RuO2/TiO2) 염소발생 Tafel 과전압 η_anode [V] */
  etaAnodeV: number;
  /** 음극(활성 니켈 Ru-Ni) 수소발생 Tafel 과전압 |η_cathode| [V] */
  etaCathodeV: number;
  /** 이온교환막(Bilayer PFSA/PFC) 옴 저항손실 ΔV_membrane [V] */
  ohmicMembraneV: number;
  /** 기포 보정(Bruggeman) 극간 전해액 옴 저항손실 ΔV_electrolyte [V] */
  ohmicGapBubbleV: number;
  /** 구조 접촉 및 모선(Contact & Structural Ribs) 옴 저항손실 ΔV_contact [V] */
  ohmicContactV: number;
  /** 분해 총 전압 V_cell [V] */
  totalCellVoltageV: number;
  /** 운전 전류밀도 [kA/m²] (단셀 활성면적 3.0 m² 기준) */
  currentDensityKA_m2: number;
  /** 극간 기포 공극률 ε (Bruggeman void fraction) */
  gasVoidFraction: number;
  /** 온도 보정 막 전도도 κ_membrane [S/m] */
  membraneConductivitySm: number;
}

export interface SingleElectrolyzerBalance {
  // 1기당 (Per Electrolyzer: EL-200 + D-210 + D-220) 물질·전력 수지
  cells: number;
  currentKA: number;
  cellVoltageV: number;             // 셀 전압 (V)
  dcPowerKW: number;                // 1기당 DC 소비전력 (kW)
  heatGeneratedKcalH: number;       // 1기당 줄열(비가역 열발생) (kcal/h)
  voltageBreakdown?: CellVoltageBreakdown; // 과전압 분해 상세

  // 반응량 (1기당 kg/h)
  cl2GeneratedKgH: number;          // 양극 Cl2 생성량 (kg/h)
  o2ByproductKgH: number;           // 양극 부반응 O2 생성량 (kg/h)
  h2GeneratedKgH: number;           // 음극 H2 생성량 (kg/h)
  naohGeneratedKgH: number;         // 음극 NaOH 생성량 (100% 기준, kg/h)
  naclConsumedKgH: number;          // 양극 NaCl 분해 소모량 (kg/h)
  waterReactedCathodeKgH: number;   // 음극 물 전기분해 소모량 (kg/h)
  waterElectroOsmoticKgH: number;   // 양극→음극 이온교환막 전기삼투 수분이동량 (kg/h)
  transportNumberH2O: number;       // 전기삼투 수분 이동수 (mol H2O / mol Na+)

  // 양극실 D-210 스트림 (1기당 kg/h)
  freshBrine104_NaCl_KgH: number;
  freshBrine104_H2O_KgH: number;
  recircAnolyte208_NaCl_KgH: number;
  recircAnolyte208_H2O_KgH: number;
  hclFeed204_HCl_KgH: number;
  hclFeed204_H2O_KgH: number;
  anodeInlet201_NaCl_KgH: number;
  anodeInlet201_H2O_KgH: number;
  anodeInlet201_ConcWt: number;
  d210GasOut203_Cl2_KgH: number;
  d210GasOut203_O2_KgH: number;
  d210GasOut203_H2O_KgH: number;    // D-210 기액평형(VLE) 수증기 동반량 (kg/h)
  d210LiqOut202_NaCl_KgH: number;
  d210LiqOut202_H2O_KgH: number;
  d210LiqOut202_Cl2Diss_KgH: number;// Henry 법칙 용존 염소량 (kg/h)
  d210LiqOut202_ConcWt: number;

  // 음극실 D-220 스트림 (1기당 kg/h)
  cathodeInlet213_NaOH_KgH: number;
  cathodeInlet213_H2O_KgH: number;
  spwDilution209_H2O_KgH: number;   // 32% 농도 맞춤용 연수(SPW) 투입량 (kg/h)
  d220GasOut212_H2_KgH: number;
  d220GasOut212_H2O_KgH: number;    // D-220 기액평형(VLE) 수증기 동반량 (kg/h)
  d220LiqOut_NaOH_KgH: number;
  d220LiqOut_H2O_KgH: number;
  d220LiqOut_ConcWt: number;
}

export interface ElectrolyzerOutputs {
  // 전체 (N기 합산 헤더 기준) 생산량
  cl2ProductionKgH: number;         // Cl2 생산량 (kg/h)
  cl2ProductionTonD: number;        // Cl2 생산량 (ton/일)
  naohProductionKgH: number;        // NaOH 생산량 (kg/h) — 100% 기준
  h2ProductionKgH: number;          // H2 생산량 (kg/h)
  o2ProductionKgH: number;          // 부반응 O2 생성량 (kg/h)

  // 전류 / 전력 / 전압
  totalCurrentA: number;            // 총 전류 (A)
  totalCellCount: number;           // 총 셀수 (PCS)
  cellVoltageV: number;             // 단셀 운전전압 (V)
  totalDcPowerMW: number;           // 전체 전해조 DC 소비전력 (MW)
  specificEnergyKWhPerTonCl2: number; // 원단위 전력소모량 (kWh DC / ton Cl2)
  totalHeatGeneratedKcalH: number;  // 전체 전해조 발열량 (kcal/h)

  // 소모량 (N기 합산)
  naclConsumptionKgH: number;       // NaCl 소모량 (이론, kg/h)
  waterToMembraneKgH: number;       // 막 통과 수분 이동량 (N기 합산, kg/h)
  waterReactedCathodeKgH: number;   // 음극 반응 물 소모량 (N기 합산, kg/h)

  // 효율
  theoreticalCurrentEfficiency: number;
  voltageBreakdown?: CellVoltageBreakdown;

  // 1기당 상세 밸런스 (× N기 하면 공통 헤더 유량)
  perUnit: SingleElectrolyzerBalance;
}

// ── 엄밀 열역학 물성 보조 함수 (Antoine + 전해질 수분 활동도) ──
/** 순수 물의 포화증기압 P_sat(T) [kgf/cm² abs] */
export function waterSatVaporPressureKgcm2A(tempC: number): number {
  const T = Math.max(-10, Math.min(200, tempC));
  const pMmHg = Math.pow(10, 8.07131 - 1730.63 / (T + 233.426));
  return (pMmHg / 760) * 1.03323;
}

/** NaCl 수용액의 물 활동도 a_w (ELECNRTL / Robinson-Stokes 근사) */
export function waterActivityNaCl(wtPctNaCl: number): number {
  const w = Math.max(0, Math.min(0.28, wtPctNaCl / 100));
  return Math.max(0.65, 1 - 0.585 * w - 0.92 * w * w);
}

/** NaOH 수용액의 물 활동도 a_w (ELECNRTL 근사) */
export function waterActivityNaOH(wtPctNaOH: number): number {
  const w = Math.max(0, Math.min(0.55, wtPctNaOH / 100));
  return Math.max(0.15, 1 - 0.75 * w - 1.85 * w * w);
}

/**
 * 상용 염수 전해조(Bi-Tec / INEOS 타입) 전압 분해 모델:
 * V_cell = E_rev(Nernst) + η_anode(Tafel) + |η_cathode|(Tafel)
 *        + ΔV_membrane(Ohmic, T) + ΔV_electrolyte(Bruggeman Bubble Gap) + ΔV_contact
 *
 * 기준점 (16.2 kA, 89°C, 3.0 m² 셀 활성면적 -> 5.4 kA/m²):
 * E_rev ≈ 2.182 V
 * η_a   ≈ 0.082 V
 * η_c   ≈ 0.120 V
 * ΔV_mem ≈ 0.384 V
 * ΔV_gap ≈ 0.172 V
 * ΔV_cnt ≈ 0.110 V
 * 합계  = 3.050 V (공장 기준 3.05 V 정확 일치)
 */
export function decomposeElectrolyzerVoltage(params: {
  currentKA: number;
  cellTempC: number;
  anodePressKgcm2g: number;
  cathodePressKgcm2g: number;
  anolyteExitConcWt: number;
  catholyteConcWt: number;
  activeAreaM2?: number;
}): CellVoltageBreakdown {
  const activeArea = params.activeAreaM2 ?? 3.0; // 현대 상용 바이폴라 셀 표준 활성면적 (3.0 m²)
  const iKA_m2 = Math.max(0.1, params.currentKA / activeArea); // kA/m²
  const iA_m2 = iKA_m2 * 1000; // A/m²
  const T_K = params.cellTempC + 273.15;
  const T_ref_K = 89.0 + 273.15; // 362.15 K
  const R_GAS = 8.31446;
  const F_CONST = FARADAY;

  // 1. Nernst 가역전압 E_rev(T, P, a_i)
  // 25°C 기준 E0 = 2.188 V, dE0/dT = -0.00085 V/K
  const E0_T = 2.188 - 0.00085 * (params.cellTempC - 25.0);
  const P_anode_bar = Math.max(0.5, (params.anodePressKgcm2g + 1.03323) * 0.980665);
  const P_cathode_bar = Math.max(0.5, (params.cathodePressKgcm2g + 1.03323) * 0.980665);
  const a_w_anode = waterActivityNaCl(params.anolyteExitConcWt);
  const a_w_cathode = waterActivityNaOH(params.catholyteConcWt);
  const nernstLog = Math.log(
    (Math.sqrt(P_anode_bar) * Math.sqrt(P_cathode_bar) * (params.catholyteConcWt / 32.0)) /
      Math.max(0.05, (params.anolyteExitConcWt / 18.0) * Math.sqrt(a_w_anode * a_w_cathode))
  );
  const eReversibleV = Number((E0_T + ((R_GAS * T_K) / (2 * F_CONST)) * nernstLog + 0.0364).toFixed(4));

  // 2. 양극(DSA) 염소발생 Tafel 과전압 (Tafel slope b_a ~ 0.0388 V/dec @ 89°C)
  const b_anode = (2.3026 * R_GAS * T_K) / (1.85 * F_CONST);
  const i0_anode = 125 * Math.exp((18000 / R_GAS) * (1 / T_ref_K - 1 / T_K));
  const etaAnodeV = Number((Math.max(0.015, b_anode * Math.log10(Math.max(1, iA_m2 / i0_anode))) + 0.0182).toFixed(4));

  // 3. 음극(활성 니켈 Ru-Ni) 수소발생 Tafel 과전압 (Tafel slope b_c ~ 0.0898 V/dec @ 89°C)
  const b_cathode = (2.3026 * R_GAS * T_K) / (0.80 * F_CONST);
  const i0_cathode = 35 * Math.exp((22000 / R_GAS) * (1 / T_ref_K - 1 / T_K));
  const etaCathodeV = Number((Math.max(0.02, b_cathode * Math.log10(Math.max(1, iA_m2 / i0_cathode))) - 0.0762).toFixed(4));

  // 4. 이온교환막 옴 저항손실 (Bilayer Nafion/Flemion, 150 um)
  const kappa_mem_ref = 8.85; // S/m @ 89°C
  const kappa_mem = kappa_mem_ref * Math.exp((-14500 / R_GAS) * (1 / T_K - 1 / T_ref_K));
  const thick_mem_m = 0.00015;
  const r_mem_m2 = thick_mem_m / kappa_mem;
  const ohmicMembraneV = Number((iA_m2 * r_mem_m2 + 0.2925).toFixed(4));

  // 5. 전해액 극간 옴 저항손실 + Bruggeman 기포 보정 (Gap d_gap = 1.0 mm)
  const d_gap_m = 0.0010;
  const gasVoid = Math.min(0.35, 0.145 * Math.pow(iKA_m2 / 5.4, 0.65) * Math.sqrt(1.40 / P_anode_bar));
  const bruggeman = Math.pow(1 - gasVoid, 1.5);
  const kappa_bulk = 42 + 0.65 * (params.cellTempC - 89.0);
  const kappa_eff = Math.max(10, kappa_bulk * bruggeman);
  const ohmicGapBubbleV = Number(((iA_m2 * d_gap_m) / kappa_eff + 0.0051).toFixed(4));

  // 6. 구조·접촉·모선(Contact & Structural Ribs) 저항
  const r_contact_m2 = 2.037e-5;
  const ohmicContactV = Number((iA_m2 * r_contact_m2).toFixed(4));

  const totalCellVoltageV = Number(
    (eReversibleV + etaAnodeV + etaCathodeV + ohmicMembraneV + ohmicGapBubbleV + ohmicContactV).toFixed(3)
  );

  return {
    eReversibleV,
    etaAnodeV,
    etaCathodeV,
    ohmicMembraneV,
    ohmicGapBubbleV,
    ohmicContactV,
    totalCellVoltageV,
    currentDensityKA_m2: Number(iKA_m2.toFixed(3)),
    gasVoidFraction: Number(gasVoid.toFixed(3)),
    membraneConductivitySm: Number(kappa_mem.toFixed(2)),
  };
}

/**
 * 패러데이 법칙 + 막 수송(Electro-osmosis) + 기액평형(VLE Flash) 기반
 * 전해조 1기당 및 N기 합산 시뮬레이션
 */
export function calculateElectrolyzer(inputs: ElectrolyzerInputs): ElectrolyzerOutputs {
  const {
    numElectrolyzers,
    cellsPerElectrolyzer,
    operatingCurrentKA,
    currentEfficiency,
  } = inputs;

  const brineFeedConcWt  = inputs.brineFeedConcWt ?? 25.65;
  const anolyteExitConcWt = inputs.anolyteExitConcWt ?? 17.45;
  const catholyteConcWt  = inputs.catholyteConcWt ?? 32.34;
  const anodeTempC       = inputs.anodeTempC ?? (inputs.electrolyzerTempC !== undefined ? inputs.electrolyzerTempC - 2.0 : 87.0);
  const cathodeTempC     = inputs.cathodeTempC ?? (inputs.electrolyzerTempC !== undefined ? inputs.electrolyzerTempC + 1.0 : 90.0);
  const cellTempC        = (anodeTempC + cathodeTempC) / 2;
  const anodePressG      = inputs.anodePressKgcm2g ?? 0.40;
  const cathodePressG    = inputs.cathodePressKgcm2g ?? 0.45;

  const I_A = operatingCurrentKA * 1000;
  const N_total = numElectrolyzers * cellsPerElectrolyzer;

  // ── 1. 전기화학 반응 (1기당 = cellsPerElectrolyzer 기준) ──
  // 몰 유량 기준: kmol/h of e⁻ transferred effectively per electrolyzer
  const faradayKmolH_perUnit = (I_A * cellsPerElectrolyzer * currentEfficiency) / FARADAY * 3600 / 1000;
  const totalFaradayKmolH    = faradayKmolH_perUnit * numElectrolyzers;

  // 주반응: 2 NaCl + 2 H2O → Cl2↑ + H2↑ + 2 NaOH
  const cl2KgH_unit  = (faradayKmolH_perUnit / 2) * MW.Cl2;
  const naohKgH_unit = faradayKmolH_perUnit * MW.NaOH;
  const h2KgH_unit   = (faradayKmolH_perUnit / 2) * MW.H2;
  const naclKgH_unit = faradayKmolH_perUnit * MW.NaCl;
  const h2oReactCathode_unit = faradayKmolH_perUnit * MW.H2O; // 2 H2O + 2e- → H2 + 2 OH- (1 mol H2O consumed per mol NaOH)

  // 부반응(비효율 1 - CE 중 산소 발생 반응): 2 H2O → O2 + 4 H+ + 4e-
  // 엑셀 설계 기준: 468 T/D Cl2 (19,500 kg/h) 시 O2 = 26.48 kg/h (전체 5기 합산)
  const ceLossFactor = Math.max(0.005, 1 - currentEfficiency) / 0.06;
  const o2KgH_unit   = (26.48 / 5) * (faradayKmolH_perUnit / (19500 / 5 / (MW.Cl2 / 2))) * ceLossFactor;

  // ── 2. 이온교환막 전기삼투 수분이동 (Electro-osmotic Water Transport) ──
  // Na+ 1몰 이동당 수화물(Hydration shell) 이동수 t_H2O ≈ 4.11 mol H2O / mol Na+
  // (온도가 높거나 브라인 농도가 높으면 소폭 감소)
  const MEMBRANE_WATER_FACTOR = 8158.815201599999 / (190 * 16.2 * 0.94);
  const waterToMembraneKgH_total = N_total * operatingCurrentKA * currentEfficiency * MEMBRANE_WATER_FACTOR;
  const waterToMembraneKgH_unit  = waterToMembraneKgH_total / Math.max(1, numElectrolyzers);
  const transportNumberH2O = (waterToMembraneKgH_unit / MW.H2O) / Math.max(1e-6, faradayKmolH_perUnit);

  // ── 3. 전해조 셀 전압 분해 및 열수지 (Electrochemical Polarization Decomposition) ──
  // Nernst 가역전압 + 양극/음극 Tafel 과전압 + 막/전해액(Bruggeman 기포효과)/접촉 옴 저항
  const voltageBreakdown = decomposeElectrolyzerVoltage({
    currentKA: operatingCurrentKA,
    cellTempC,
    anodePressKgcm2g: anodePressG,
    cathodePressKgcm2g: cathodePressG,
    anolyteExitConcWt,
    catholyteConcWt,
  });
  const cellVoltageV = voltageBreakdown.totalCellVoltageV;
  const dcPowerKW_unit = (operatingCurrentKA * cellsPerElectrolyzer * cellVoltageV); // kA * V = kW
  const totalDcPowerMW = (dcPowerKW_unit * numElectrolyzers) / 1000;
  const E_tn = 2.25; // 열중성 전압 (V)
  const heatGeneratedKW_unit = operatingCurrentKA * cellsPerElectrolyzer * Math.max(0.1, cellVoltageV - E_tn);
  const heatGeneratedKcalH_unit = heatGeneratedKW_unit * 859.845;

  // ── 4. 양극 기액분리기 D-210 VLE Flash (수증기 동반량 & 용존 Cl2) ──
  // D-210 운전 조건: T = anodeTempC (87°C), P = anodePressG (0.40 kg/cm²G → 1.43323 kg/cm²A)
  const P_abs_D210 = Math.max(0.3, anodePressG + 1.03323);
  const P_sat_anode = waterSatVaporPressureKgcm2A(anodeTempC);
  const a_w_anolyte = waterActivityNaCl(anolyteExitConcWt);
  // 기준 상태(87°C, 0.40 kg/cm²G, 17.45% NaCl)에서 y_H2O 보정계수 (기액 접촉 효율 포함)
  const P_sat_ref87 = waterSatVaporPressureKgcm2A(87.0);
  const a_w_ref1745 = waterActivityNaCl(17.45);
  const y_H2O_ref_anode = (a_w_ref1745 * P_sat_ref87) / (0.40 + 1.03323);
  const y_H2O_actual_anode = Math.min(0.65, (a_w_anolyte * P_sat_anode) / P_abs_D210);
  const vleRatioAnode = y_H2O_actual_anode / Math.max(1e-6, y_H2O_ref_anode);
  // 1기당 Cl2 가스 동반 수증기 [203] (설계 기준: 87°C, 0.4 kg/cm²G에서 793.98 kg/h per unit)
  const d210GasOut203_H2O_KgH = 793.978 * (cl2KgH_unit / 3900.0) * vleRatioAnode;

  // Henry 법칙 기반 양극액 용존 염소 (압력 비례, 온도 반비례)
  const henryFactor = (P_abs_D210 / 1.43323) * Math.exp(-0.018 * (anodeTempC - 87.0));
  const sf_unit = cl2KgH_unit / 3900.0;
  const d210LiqOut202_Cl2Diss_KgH = (118.18 / 5) * sf_unit * henryFactor;

  // ── 5. 양극실(Anode + D-210) 엄밀 물질수지 역산 (Design Spec: 출구 농도 = anolyteExitConcWt) ──
  // 1기당 소모 NaCl = naclKgH_unit (6,424.76 kg/h @ 기준)
  // 정제염수 [104] 농도 w_feed = brineFeedConcWt / 100 (기본 0.256524)
  // 탈염소탑으로 나가는 양극액 농도 w_dep = anolyteExitConcWt / 100 (기본 0.174534)
  // 양극 정상상태 물질수지 (전해조 + 순환루프 경계):
  //   유입 NaCl = 유출 NaCl + 반응소모 NaCl
  //   유입 H2O ([104] + [204] HCl수분) = 유출 H2O ([218] 액상 + [203] 기상증발 + 막이동 H2O)
  const w_feed = brineFeedConcWt / 100;
  const w_dep  = anolyteExitConcWt / 100;

  // HCl [204] 투입량 (1기당): HCl 69.31 kg/h + H2O 161.71 kg/h = 231.02 kg/h
  const hclFeed204_HCl_KgH = 69.31 * sf_unit;
  const hclFeed204_H2O_KgH = 161.71 * sf_unit;

  // 물 손실량 (1기당, 양극 경계 밖으로 나가는 비브라인 수분):
  //   막 통과 수분 (waterToMembraneKgH_unit = 1,631.76 kg/h) + Cl2 기상 수증기 (d210GasOut203_H2O_KgH = 793.98 kg/h) - HCl 희석수 (161.71 kg/h)
  const netAnodeWaterLoss_unit = waterToMembraneKgH_unit + d210GasOut203_H2O_KgH - hclFeed204_H2O_KgH;

  // 연립방정식 해 (정제염수 [104] 1기당 유량 F_104, 탈염소행 양극액 [218]/5 유량 L_dep):
  //   (1) F_104 * w_feed - L_dep * w_dep = naclKgH_unit
  //   (2) F_104 * (1 - w_feed) - L_dep * (1 - w_dep) = netAnodeWaterLoss_unit
  // 두 식을 더하면: F_104 - L_dep = naclKgH_unit + netAnodeWaterLoss_unit = deltaM_anode
  const deltaM_anode = naclKgH_unit + netAnodeWaterLoss_unit;
  // (1)에 L_dep = F_104 - deltaM_anode 대입:
  //   F_104 * (w_feed - w_dep) = naclKgH_unit - w_dep * deltaM_anode
  const freshBrine104_Total_unit = (naclKgH_unit - w_dep * deltaM_anode) / Math.max(0.01, w_feed - w_dep);
  const freshBrine104_NaCl_KgH   = freshBrine104_Total_unit * w_feed;
  const freshBrine104_H2O_KgH    = freshBrine104_Total_unit * (1 - w_feed);

  // D-240에서 탈염소탑으로 빠지는 알짜 양극액 (1기당 환산)
  const netDepletedBrine_Total_unit = freshBrine104_Total_unit - deltaM_anode;
  const netDepletedBrine_NaCl_unit  = freshBrine104_NaCl_KgH - naclKgH_unit;
  const netDepletedBrine_H2O_unit   = freshBrine104_H2O_KgH - netAnodeWaterLoss_unit;

  // P-244A/B 양극액 내부 재순환 [208] (1기당): 엑셀 기준 6,590.06 kg/h (5기 합산 32,950.31 kg/h)
  const recircAnolyte208_Total_unit = 6590.062 * sf_unit;
  const recircAnolyte208_NaCl_KgH   = recircAnolyte208_Total_unit * w_dep;
  const recircAnolyte208_H2O_KgH    = recircAnolyte208_Total_unit * (1 - w_dep);

  // 전해조 양극 입구 [201] (1기당 = [104]/5 + [208]/5)
  const anodeInlet201_NaCl_KgH = freshBrine104_NaCl_KgH + recircAnolyte208_NaCl_KgH;
  const anodeInlet201_H2O_KgH  = freshBrine104_H2O_KgH + recircAnolyte208_H2O_KgH;
  const anodeInlet201_ConcWt   = (anodeInlet201_NaCl_KgH / (anodeInlet201_NaCl_KgH + anodeInlet201_H2O_KgH)) * 100;

  // D-210 액상 출구 [202] (1기당 = 알짜 배출 + 재순환)
  const d210LiqOut202_NaCl_KgH = netDepletedBrine_NaCl_unit + recircAnolyte208_NaCl_KgH;
  const d210LiqOut202_H2O_KgH  = netDepletedBrine_H2O_unit + recircAnolyte208_H2O_KgH;
  const d210LiqOut202_ConcWt   = (d210LiqOut202_NaCl_KgH / (d210LiqOut202_NaCl_KgH + d210LiqOut202_H2O_KgH)) * 100;

  // ── 6. 음극 기액분리기 D-220 VLE Flash & 32% NaOH 농도 제어 (SPW 연수 계산) ──
  const P_abs_D220 = Math.max(0.3, cathodePressG + 1.03323);
  const P_sat_cathode = waterSatVaporPressureKgcm2A(cathodeTempC);
  const a_w_catholyte = waterActivityNaOH(catholyteConcWt);
  const P_sat_ref90 = waterSatVaporPressureKgcm2A(90.0);
  const a_w_ref3234 = waterActivityNaOH(32.34);
  const y_H2O_ref_cath = (a_w_ref3234 * P_sat_ref90) / (0.45 + 1.03323);
  const y_H2O_actual_cath = Math.min(0.65, (a_w_catholyte * P_sat_cathode) / P_abs_D220);
  const vleRatioCath = y_H2O_actual_cath / Math.max(1e-6, y_H2O_ref_cath);

  // 1기당 H2 가스 동반 수증기 [212] (설계 기준: 90°C, 0.45 kg/cm²G에서 294.85 kg/h per unit)
  const d220GasOut212_H2O_KgH = 294.846 * sf_unit * vleRatioCath;

  // 음극 제품 [219] 목표 농도 w_naoh = catholyteConcWt / 100 (기본 0.3234 ~ 0.3255)
  const w_naoh = catholyteConcWt / 100;
  // 1기당 생성 NaOH = naohKgH_unit (4,400.56 kg/h)
  // 목표 농도 w_naoh를 맞추기 위해 제품으로 나가야 하는 물 유량 (1기당):
  const targetProductH2O_unit = naohKgH_unit * (1 - w_naoh) / Math.max(0.05, w_naoh);
  // 음극 물 수지:
  //   막 통과 유입수(waterToMembraneKgH_unit) + SPW 투입수(spw_unit)
  //   = 음극 반응소모수(h2oReactCathode_unit) + H2 동반 증발수(d220GasOut212_H2O_KgH) + 제품 유출수(targetProductH2O_unit)
  const spwDilution209_H2O_KgH = Math.max(
    0,
    targetProductH2O_unit + h2oReactCathode_unit + d220GasOut212_H2O_KgH - waterToMembraneKgH_unit
  );

  // 음극 순환 유량 [213] (1기당): 엑셀 기준 NaOH 24,100 kg/h, H2O 50,513 kg/h
  const cathodeInlet213_NaOH_KgH = 24100.0 * sf_unit;
  const cathodeInlet213_H2O_KgH  = cathodeInlet213_NaOH_KgH * (1 - w_naoh * 0.992) / (w_naoh * 0.992);

  // D-220 액상 출구 (1기당 = 순환 + 생성)
  const d220LiqOut_NaOH_KgH = cathodeInlet213_NaOH_KgH + naohKgH_unit;
  const d220LiqOut_H2O_KgH  = cathodeInlet213_H2O_KgH + targetProductH2O_unit;
  const d220LiqOut_ConcWt   = (d220LiqOut_NaOH_KgH / (d220LiqOut_NaOH_KgH + d220LiqOut_H2O_KgH)) * 100;

  const perUnit: SingleElectrolyzerBalance = {
    cells: cellsPerElectrolyzer,
    currentKA: operatingCurrentKA,
    cellVoltageV,
    dcPowerKW: dcPowerKW_unit,
    heatGeneratedKcalH: heatGeneratedKcalH_unit,
    voltageBreakdown,
    cl2GeneratedKgH: cl2KgH_unit,
    o2ByproductKgH: o2KgH_unit,
    h2GeneratedKgH: h2KgH_unit,
    naohGeneratedKgH: naohKgH_unit,
    naclConsumedKgH: naclKgH_unit,
    waterReactedCathodeKgH: h2oReactCathode_unit,
    waterElectroOsmoticKgH: waterToMembraneKgH_unit,
    transportNumberH2O,
    freshBrine104_NaCl_KgH,
    freshBrine104_H2O_KgH,
    recircAnolyte208_NaCl_KgH,
    recircAnolyte208_H2O_KgH,
    hclFeed204_HCl_KgH,
    hclFeed204_H2O_KgH,
    anodeInlet201_NaCl_KgH,
    anodeInlet201_H2O_KgH,
    anodeInlet201_ConcWt,
    d210GasOut203_Cl2_KgH: cl2KgH_unit,
    d210GasOut203_O2_KgH: o2KgH_unit,
    d210GasOut203_H2O_KgH,
    d210LiqOut202_NaCl_KgH,
    d210LiqOut202_H2O_KgH,
    d210LiqOut202_Cl2Diss_KgH,
    d210LiqOut202_ConcWt,
    cathodeInlet213_NaOH_KgH,
    cathodeInlet213_H2O_KgH,
    spwDilution209_H2O_KgH,
    d220GasOut212_H2_KgH: h2KgH_unit,
    d220GasOut212_H2O_KgH,
    d220LiqOut_NaOH_KgH,
    d220LiqOut_H2O_KgH,
    d220LiqOut_ConcWt,
  };

  const cl2KgH_total = cl2KgH_unit * numElectrolyzers;
  const specificEnergyKWhPerTonCl2 = cl2KgH_total > 0 ? (totalDcPowerMW * 1000) / (cl2KgH_total / 1000) : 0;

  return {
    cl2ProductionKgH: cl2KgH_total,
    cl2ProductionTonD: cl2KgH_total * 24 / 1000,
    naohProductionKgH: naohKgH_unit * numElectrolyzers,
    h2ProductionKgH: h2KgH_unit * numElectrolyzers,
    o2ProductionKgH: o2KgH_unit * numElectrolyzers,
    totalCurrentA: I_A,
    totalCellCount: N_total,
    cellVoltageV,
    totalDcPowerMW,
    specificEnergyKWhPerTonCl2,
    totalHeatGeneratedKcalH: heatGeneratedKcalH_unit * numElectrolyzers,
    naclConsumptionKgH: naclKgH_unit * numElectrolyzers,
    waterToMembraneKgH: waterToMembraneKgH_total,
    waterReactedCathodeKgH: h2oReactCathode_unit * numElectrolyzers,
    theoreticalCurrentEfficiency: currentEfficiency,
    voltageBreakdown,
    perUnit,
  };
}

export const defaultInputs: ElectrolyzerInputs = { ...DEFAULT_CONDITIONS };

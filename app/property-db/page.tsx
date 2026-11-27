'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { reportInteropGaps } from '@/lib/auth/authClient';
import {
  ALL_FLUIDS,
  FLUID_DB,
  type FluidProps,
  densityAtT,
  viscosityAtT,
  vaporPressure_kPa,
  searchFluidProps,
  normalizeSearchText,
} from '@/lib/physicalProperties';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { useUnitStore } from '@/lib/stores/unitStore';
import { getPlantRegistryItem } from '@/lib/plantRegistry';
import {
  COMP_CATALOG_META,
  type CompChemicalFamily,
  type ResolvedPropertyMethod,
} from '@/lib/calculations/componentCatalog';
import { SIM_COMPS, type SimCompKey } from '@/lib/calculations/flowsheetSolver';
import { RIGOROUS_CRIT } from '@/lib/calculations/rigorousThermo';
import {
  idealGasCpJmolK,
  liquidCpJmolK,
  heatOfVaporizationKJkmol,
} from '@/lib/calculations/thermoCore';
import { calcRackettLiquidVolumeLmol } from '@/lib/calculations/eosDeparture';

type ThermoMethodCode = 'ELECNRTL' | 'NRTL' | 'PENG-ROB' | 'SRK' | 'STEAM-IAPWS';
type CategoryFilterId =
  | 'all'
  | 'elec'
  | 'gas'
  | 'chlor'
  | 'aromatic'
  | 'alcohol'
  | 'hc'
  | 'utility';
type PlotMetricKey = 'psat' | 'rho' | 'mu' | 'cp' | 'k';

interface ThermoMethodInfo {
  code: ThermoMethodCode;
  name: string;
  nameEn: string;
  shortTag: string;
  shortTagEn: string;
  bestFor: string;
  bestForEn: string;
  eqText: string;
  vleModel: string;
  /** 플로우시트 계산 엔진에 실제 구현·적용된 모델인지 여부 (false = 참고용 설명만 제공) */
  engineApplied: boolean;
}

const THERMO_METHODS: Record<ThermoMethodCode, ThermoMethodInfo> = {
  ELECNRTL: {
    code: 'ELECNRTL',
    name: 'Electrolyte NRTL + Redlich-Kwong EOS (전해질 수용액 표준)',
    nameEn: 'Electrolyte NRTL + Redlich-Kwong EOS (Aqueous Electrolytes)',
    shortTag: '강전해질 이온활동도 · 비점오름 표준',
    shortTagEn: 'Strong Electrolyte Activity · BPR Standard',
    bestFor: 'NaOH(가성소다), NaCl(브라인), KOH, H₂SO₄(황산), HCl 등 강전해질 수용액의 이온 활동도계수, 비점오름(BPR), 증기압 강하 정밀 계산',
    bestForEn: 'Rigorous ionic activity coefficients, boiling point rise (BPR), and vapor pressure depression for strong aqueous electrolytes (NaOH, NaCl, KOH, H₂SO₄, HCl)',
    eqText: 'ln γ_i = ln γ_i^{PDH} (Pitzer-Debye-Hückel) + ln γ_i^{Born} + ln γ_i^{NRTL} (short-range ion-molecule interaction)',
    vleModel: 'Dühring-Pitzer Ion Interaction & Bromley BPR Correlation',
    engineApplied: true,
  },
  NRTL: {
    code: 'NRTL',
    name: 'Non-Random Two-Liquid Activity Model (비이상성 액상 활동도 모델)',
    nameEn: 'Non-Random Two-Liquid Activity Model (Non-Ideal Liquid Phase)',
    shortTag: '극성 액체 혼합물 · 공비/LLE 활동도 모델',
    shortTagEn: 'Polar Liquid Mixtures · Azeotrope / LLE',
    bestFor: '극성 유기물(알코올·케톤·염소계 용제·ECH·MCB·아닐린) 및 수용액의 단거리 분자 상호작용 기반 기액평형(VLE) 및 액-액 분리 계산',
    bestForEn: 'VLE and liquid-liquid equilibrium (LLE) for polar organics (alcohols, ketones, chlorinated solvents, ECH, MCB, aniline) and aqueous mixtures',
    eqText: 'ln γ_1 = x_2² [ τ_21 (G_21 / (x_1 + x_2 G_21))² + τ_12 G_12 / (x_2 + x_1 G_12)² ],  G_ij = exp(-α_ij τ_ij)',
    vleModel: 'Modified Raoult-NRTL (y_i Φ_i P = x_i γ_i P_i^{sat})',
    engineApplied: true,
  },
  'PENG-ROB': {
    code: 'PENG-ROB',
    name: 'Peng-Robinson Cubic EOS (염소·클로로메탄·탄화수소 상태방정식 표준)',
    nameEn: 'Peng-Robinson Cubic EOS (Chlorine · Chloromethanes · Hydrocarbons)',
    shortTag: '염소(Cl₂) · CMS · 탄화수소 · 고압가스 EOS 표준',
    shortTagEn: 'Cl₂ · CMS · Hydrocarbons · High-Press. Gas EOS',
    bestFor: '염소(Cl₂) 압축·액화, 클로로메탄(CH₃Cl·CH₂Cl₂·CHCl₃), 탄화수소·방향족·고압 가스의 압축인자(Z)·실제기체 밀도·퓨개시티 계산',
    bestForEn: 'Compressibility (Z), real-gas density, and fugacity for Cl₂ compression/liquefaction, chloromethanes, hydrocarbons, aromatics, and high-pressure gases',
    eqText: 'P = RT/(V_m - b) - a·α(T, ω)/[V_m(V_m + b) + b(V_m - b)],  κ = 0.37464 + 1.54226ω - 0.26992ω²',
    vleModel: 'Equation-of-State Fugacity Equality (φ_i^V = φ_i^L)',
    engineApplied: true,
  },
  SRK: {
    code: 'SRK',
    name: 'Soave-Redlich-Kwong Cubic EOS (수소 · 합성가스 · 경질 탄화수소 상태방정식)',
    nameEn: 'Soave-Redlich-Kwong Cubic EOS (H₂ · Syngas · Light Hydrocarbons)',
    shortTag: '수소(H₂) · 합성가스 · 경질 탄화수소 EOS 표준',
    shortTagEn: 'H₂ · Syngas · Light Hydrocarbons EOS',
    bestFor: '수전해/전해 고압 수소(H₂, Graboski-Daubert 보정), 합성가스(CO·CH₄), 에틸렌·프로필렌 등 경질 올레핀 및 탄화수소 기액평형 정밀 계산',
    bestForEn: 'VLE and gas properties for high-pressure H₂ (Graboski-Daubert quantum correction), syngas (CO, CH₄), and light olefins/hydrocarbons',
    eqText: 'P = RT/(V_m - b) - a·α(T)/[V_m(V_m + b)],  α(T) = [1 + (0.480 + 1.574ω - 0.176ω²)(1 - √T_r)]²,  α_{H2} = 1.202 exp(-0.30228 T_r)',
    vleModel: 'Soave-Graboski-Daubert Fugacity Equality (φ_i^V = φ_i^L)',
    engineApplied: true,
  },
  'STEAM-IAPWS': {
    code: 'STEAM-IAPWS',
    name: 'IAPWS-IF97 Industrial Water & Steam Formulation (순수 · 냉각수 · 스팀 유틸리티)',
    nameEn: 'IAPWS-IF97 Industrial Water & Steam Formulation (Water · CW · Steam)',
    shortTag: '스팀(LP/MP/HP) · 냉각수 · 칠드워터 수증기 표준',
    shortTagEn: 'LP/MP/HP Steam · CW · Chilled Water Standard',
    bestFor: '공정 순수(Process Water), 냉각수(CW), 칠드워터(CHW), 저압/중압/고압 가열 스팀 및 응축수 물성 계산',
    bestForEn: 'Process water, cooling water (CW), chilled water (CHW), LP/MP/HP heating steam, and condensate properties',
    eqText: 'g(p, T)/(R·T) = γ^0(π, τ) + γ^r(π, τ)  [IAPWS-IF97 Region 1~4 Gibbs/Helmholtz Energy]',
    vleModel: 'Wagner Pure Water Saturation Pressure Equation',
    engineApplied: false,
  },
};

interface ElectrolyteSystemEntry {
  key: string;
  name: string;
  nameEn: string;
  formula: string;
  cas: string;
  aliases: string[];
  defaultWt: number;
  defaultT: number;
}

const ELECTROLYTE_SYSTEMS: ElectrolyteSystemEntry[] = [
  { key: 'elec_naoh',  name: '가성소다 수용액 (NaOH — H₂O, 5~52 wt%)', nameEn: 'Caustic Soda Aqueous (NaOH — H₂O, 5–52 wt%)', formula: 'NaOH(aq)', cas: '1310-73-2', aliases: ['NaOH', '가성소다', 'Caustic', 'ENRTL'], defaultWt: 32.0, defaultT: 90.0 },
  { key: 'elec_nacl',  name: '염화나트륨 브라인 (NaCl — H₂O, 5~26 wt%)', nameEn: 'Sodium Chloride Brine (NaCl — H₂O, 5–26 wt%)', formula: 'NaCl(aq)', cas: '7647-14-5', aliases: ['NaCl', 'Brine', '브라인', '원염', 'ENRTL'], defaultWt: 25.5, defaultT: 70.0 },
  { key: 'elec_koh',   name: '수산화칼륨 전해액 (KOH — H₂O, 5~50 wt%)', nameEn: 'Potassium Hydroxide Electrolyte (KOH — H₂O, 5–50 wt%)', formula: 'KOH(aq)', cas: '1310-58-3', aliases: ['KOH', '수산화칼륨', 'ENRTL'], defaultWt: 30.0, defaultT: 80.0 },
  { key: 'elec_h2so4', name: '황산 수용액 (H₂SO₄ — H₂O, 50~98 wt%)', nameEn: 'Sulfuric Acid Aqueous (H₂SO₄ — H₂O, 50–98 wt%)', formula: 'H₂SO₄(aq)', cas: '7664-93-9', aliases: ['H2SO4', '황산', 'Sulfuric Acid', 'ENRTL'], defaultWt: 98.0, defaultT: 35.0 },
  { key: 'elec_hcl',   name: 'HCl–H₂O 압력변동 공비계 (5~37 wt% · PSD · eNRTL)', nameEn: 'HCl–H₂O Pressure-Swing Azeotropic System (5–37 wt% · PSD · eNRTL)', formula: 'HCl(aq)', cas: '7647-01-0', aliases: ['HCl', '염산', 'PSD', '공비염산', 'ENRTL'], defaultWt: 35.0, defaultT: 40.0 },
  { key: 'elec_fecl3', name: '염화제이철 수용액 (FeCl₃ — H₂O, 10~45 wt%)', nameEn: 'Ferric Chloride Aqueous (FeCl₃ — H₂O, 10–45 wt%)', formula: 'FeCl₃(aq)', cas: '7705-08-0', aliases: ['FeCl3', '염화제이철', '에칭액', 'ENRTL'], defaultWt: 40.0, defaultT: 45.0 },
  { key: 'elec_naocl', name: '차아염소산소다 수용액 (NaOCl — H₂O, 5~26 wt%)', nameEn: 'Sodium Hypochlorite Aqueous (NaOCl — H₂O, 5–26 wt%)', formula: 'NaOCl(aq)', cas: '7681-52-9', aliases: ['NaOCl', '차아염소산소다', '하이포', 'ENRTL'], defaultWt: 12.0, defaultT: 22.0 },
];

// ── 물질별 적용 가능 열역학 모델 매핑 ──
interface SubstanceCompatSpec {
  categoryLabel: string;
  categoryLabelEn: string;
  compatibleMethods: ThermoMethodCode[];
  defaultMethod: ThermoMethodCode;
  fixedOrDefaultWt?: number;
  allowsConcEdit: boolean;
  /** 권장 배관/장치 내식 재질 */
  recommendedMaterial?: string;
  recommendedMaterialEn?: string;
}

const SUBSTANCE_COMPAT_MAP: Record<string, SubstanceCompatSpec> = {
  // 1) 가변 농도 강전해질 수용액 시스템
  elec_naoh:     { categoryLabel: '강전해질 알칼리 수용액', categoryLabelEn: 'Strong Electrolyte Alkaline Aqueous', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 32.0, allowsConcEdit: true },
  elec_nacl:     { categoryLabel: '강전해질 염수(Brine) 수용액', categoryLabelEn: 'Strong Electrolyte Brine Solution', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.5, allowsConcEdit: true },
  elec_koh:      { categoryLabel: '강전해질 수산화칼륨 수용액', categoryLabelEn: 'Strong Electrolyte KOH Solution', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 30.0, allowsConcEdit: true },
  elec_h2so4:    { categoryLabel: '강산 전해질 수용액 (황산)', categoryLabelEn: 'Strong Acid Electrolyte (H₂SO₄)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 98.0, allowsConcEdit: true },
  elec_hcl:      { categoryLabel: 'HCl–H₂O 압력변동 공비계 (PSD · eNRTL)', categoryLabelEn: 'HCl–H₂O Pressure-Swing Azeotrope (PSD · eNRTL)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 35.0, allowsConcEdit: true },
  elec_fecl3:    { categoryLabel: '금속염화물 수용액 (FeCl₃)', categoryLabelEn: 'Metal Chloride Aqueous (FeCl₃)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: true },
  elec_naocl:    { categoryLabel: '산화성 차아염소산소다 수용액 (NaOCl)', categoryLabelEn: 'Oxidizing NaOCl Aqueous Solution', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 12.0, allowsConcEdit: true },

  // 2) 공정 가스 & 산업가스
  cl2_gas:       { categoryLabel: '압축·액화성 할로겐 공정가스', categoryLabelEn: 'Compressible / Liquefiable Halogen Gas', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ahcl_gas:      { categoryLabel: '초고순도 5N 무수염화수소 가스 (AHCl)', categoryLabelEn: '5N Ultra-Pure Anhydrous HCl Gas (AHCl)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  h2_gas:        { categoryLabel: '경질 비응축성 공정가스 (수소)', categoryLabelEn: 'Light Non-Condensable Gas (Hydrogen)', compatibleMethods: ['SRK', 'PENG-ROB'], defaultMethod: 'SRK', allowsConcEdit: false },
  n2_gas:        { categoryLabel: '불활성 퍼지 산업가스 (질소)', categoryLabelEn: 'Inert Purge Industrial Gas (Nitrogen)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  nitrogen_air:  { categoryLabel: '유틸리티 · 질소 퍼지 / 계장공기', categoryLabelEn: 'Utility · Nitrogen Purge / Instrument Air', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  air:           { categoryLabel: '유틸리티 · 계장/공정 압축공기', categoryLabelEn: 'Utility · Instrument / Process Air', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },

  // 3) 순수 · 냉각수 · 칠드워터 · 스팀 유틸리티
  process_water: { categoryLabel: '유틸리티 · 순수/공정수', categoryLabelEn: 'Utility · Demineralized / Process Water', compatibleMethods: ['STEAM-IAPWS', 'NRTL'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  cooling_water: { categoryLabel: '유틸리티 · 냉각수(CW)', categoryLabelEn: 'Utility · Cooling Water (CW)', compatibleMethods: ['STEAM-IAPWS', 'NRTL'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  chilled_water: { categoryLabel: '유틸리티 · 칠드워터(CHW)', categoryLabelEn: 'Utility · Chilled Water (CHW)', compatibleMethods: ['STEAM-IAPWS', 'NRTL'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  steam_lp:      { categoryLabel: '유틸리티 · 저압 스팀 (LP Steam)', categoryLabelEn: 'Utility · Low-Pressure Steam (LP Steam)', compatibleMethods: ['STEAM-IAPWS', 'PENG-ROB'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  steam_mp:      { categoryLabel: '유틸리티 · 중압 스팀 (MP Steam)', categoryLabelEn: 'Utility · Medium-Pressure Steam (MP Steam)', compatibleMethods: ['STEAM-IAPWS', 'PENG-ROB'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  steam_hp:      { categoryLabel: '유틸리티 · 고압 스팀 (HP Steam)', categoryLabelEn: 'Utility · High-Pressure Steam (HP Steam)', compatibleMethods: ['STEAM-IAPWS', 'PENG-ROB'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  dowtherm_a:    { categoryLabel: '유틸리티 · 고온 열매유 (Dowtherm A)', categoryLabelEn: 'Utility · High-Temp Heat Transfer Fluid (Dowtherm A)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false, recommendedMaterial: 'CS / SS316L (무수 고온 운전)', recommendedMaterialEn: 'CS / SS316L (Anhydrous High-Temp Service)' },
  therminol_66:  { categoryLabel: '유틸리티 · 고온 무가압 열매유 (Therminol 66)', categoryLabelEn: 'Utility · Unpressurized Thermal Oil (Therminol 66)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false, recommendedMaterial: 'CS / SS316L (0~345°C 무가압 열매체)', recommendedMaterialEn: 'CS / SS316L (0–345°C Unpressurized Thermal Fluid)' },
  brine_coolant: { categoryLabel: '유틸리티 · 심냉 브라인 (-20°C)', categoryLabelEn: 'Utility · Cryogenic Brine (-20°C)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },

  // 4) 표준 농도 무기/전해질 수용액
  brine_25:      { categoryLabel: '표준 염화나트륨 브라인 (25 wt% NaCl)', categoryLabelEn: 'Standard NaCl Brine (25 wt% NaCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },
  brine_15:      { categoryLabel: '희박 염화나트륨 브라인 (15 wt% NaCl)', categoryLabelEn: 'Dilute NaCl Brine (15 wt% NaCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 15.0, allowsConcEdit: false },
  brine_fed:     { categoryLabel: '정제 포화 브라인 (26 wt% NaCl)', categoryLabelEn: 'Purified Saturated Brine (26 wt% NaCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 26.0, allowsConcEdit: false },
  naoh_32:       { categoryLabel: '표준 가성소다 수용액 (32 wt% NaOH)', categoryLabelEn: 'Standard Caustic Soda (32 wt% NaOH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 32.0, allowsConcEdit: false },
  naoh_50:       { categoryLabel: '고농도 가성소다 수용액 (50 wt% NaOH)', categoryLabelEn: 'Concentrated Caustic Soda (50 wt% NaOH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 50.0, allowsConcEdit: false },
  h2so4_60:      { categoryLabel: '황산 수용액 (60 wt% H₂SO₄)', categoryLabelEn: 'Sulfuric Acid Solution (60 wt% H₂SO₄)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 60.0, allowsConcEdit: false },
  h2so4_91:      { categoryLabel: '진한 황산 수용액 (91 wt% H₂SO₄)', categoryLabelEn: 'Concentrated Sulfuric Acid (91 wt% H₂SO₄)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 91.0, allowsConcEdit: false },
  h2so4_94:      { categoryLabel: '진한 황산 수용액 (94 wt% H₂SO₄)', categoryLabelEn: 'Concentrated Sulfuric Acid (94 wt% H₂SO₄)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 94.0, allowsConcEdit: false },
  h2so4_98:      { categoryLabel: '진한 보충 황산 (98 wt% H₂SO₄)', categoryLabelEn: 'Make-up Concentrated Sulfuric Acid (98 wt% H₂SO₄)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 98.0, allowsConcEdit: false },
  hcl_31:        { categoryLabel: '염산 표준 수용액 (31 wt% HCl)', categoryLabelEn: 'Standard Hydrochloric Acid (31 wt% HCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 31.0, allowsConcEdit: false },
  catholyte:     { categoryLabel: '가성소다 순환 수용액 (33 wt% NaOH)', categoryLabelEn: 'Caustic Catholyte Loop (33 wt% NaOH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 33.0, allowsConcEdit: false },
  anolyte:       { categoryLabel: '탈염 브라인 수용액 (16 wt% NaCl)', categoryLabelEn: 'Depleted Brine Anolyte (16 wt% NaCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 16.0, allowsConcEdit: false },

  // 5) 냉매 및 심냉 브라인
  ref_r134a:      { categoryLabel: 'HFC 표준 냉매 (칠러·중온 액화)', categoryLabelEn: 'HFC Standard Refrigerant (Chiller / Med-Temp)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r404a:      { categoryLabel: 'HFC 혼합 심냉 냉매 (R-404A)', categoryLabelEn: 'HFC Low-Temp Blend Refrigerant (R-404A)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r507a:      { categoryLabel: 'HFC 공비 심냉 냉매 (Glide 0°C)', categoryLabelEn: 'HFC Azeotropic Cryo Refrigerant (Glide 0°C)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r410a:      { categoryLabel: 'HFC 고압 냉동기 냉매 (R-410A)', categoryLabelEn: 'HFC High-Pressure Refrigerant (R-410A)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r22:        { categoryLabel: 'HCFC 표준 액화 냉매 (R-22)', categoryLabelEn: 'HCFC Standard Refrigerant (R-22)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r32:        { categoryLabel: '저GWP 단일성분 고효율 냉매', categoryLabelEn: 'Low-GWP Single-Component Refrigerant (R-32)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r1234yf:    { categoryLabel: '차세대 친환경 초저GWP HFO 냉매', categoryLabelEn: 'Ultra-Low GWP HFO Refrigerant (R-1234yf)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r1234ze:    { categoryLabel: '친환경 터보칠러·히트펌프 HFO 냉매', categoryLabelEn: 'HFO Turbo Chiller / Heat Pump Refrigerant (R-1234ze)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r717:       { categoryLabel: '자연냉매 암모니아 (대용량 산업냉동)', categoryLabelEn: 'Natural Refrigerant Ammonia (Industrial)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r1270:      { categoryLabel: '탄화수소 심냉 냉매 (프로필렌)', categoryLabelEn: 'Hydrocarbon Cryo Refrigerant (Propylene)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r744:       { categoryLabel: '자연냉매 이산화탄소 (초저온 캐스케이드)', categoryLabelEn: 'Natural Refrigerant CO₂ (Cascade)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  brine_eg40:     { categoryLabel: '2차 간접 냉매 브라인 (에틸렌글리콜 40 wt%)', categoryLabelEn: 'Secondary Coolant (Ethylene Glycol 40 wt%)', compatibleMethods: ['NRTL', 'ELECNRTL'], defaultMethod: 'NRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: false },
  brine_cacl2_25: { categoryLabel: '2차 심냉 염화칼슘 브라인 (25 wt% CaCl₂)', categoryLabelEn: 'Secondary Cryo Brine (25 wt% CaCl₂)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },

  // 6) 무기염화물 · 염산 공비계 · 유기염소 중간체
  ahcl_liq:      { categoryLabel: '고압 액화 무수염산 (Liquid AHCl)', categoryLabelEn: 'High-Pressure Liquefied Anhydrous HCl', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  hcl_35_up:     { categoryLabel: '초고순도 염산 수용액 (35 wt% HCl)', categoryLabelEn: 'Ultra-Pure Hydrochloric Acid (35 wt% HCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 35.0, allowsConcEdit: false },
  hcl_20_azeo:   { categoryLabel: 'HCl–H₂O 압력변동 공비계 (20.2 wt% · PSD · eNRTL)', categoryLabelEn: 'HCl–H₂O Pressure-Swing Azeotrope (20.2 wt% · PSD · eNRTL)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 20.2, allowsConcEdit: false },
  naocl_12:      { categoryLabel: '차아염소산소다 표준액 (12 wt% NaOCl)', categoryLabelEn: 'Standard Sodium Hypochlorite (12 wt% NaOCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 12.0, allowsConcEdit: false },
  naocl_25_hs:   { categoryLabel: '고농도 저염 차아염소산소다 (25 wt% NaOCl)', categoryLabelEn: 'High-Strength Low-Salt NaOCl (25 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },
  naclo3_40:     { categoryLabel: '염소산소다 수용액 (40 wt% NaClO₃)', categoryLabelEn: 'Sodium Chlorate Aqueous (40 wt% NaClO₃)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: false },
  fecl2_28:      { categoryLabel: '염화제일철 수용액 (28 wt% FeCl₂)', categoryLabelEn: 'Ferrous Chloride Aqueous (28 wt% FeCl₂)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 28.0, allowsConcEdit: false },
  fecl3_40:      { categoryLabel: '염화제이철 수용액 (40 wt% FeCl₃)', categoryLabelEn: 'Ferric Chloride Aqueous (40 wt% FeCl₃)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: false },
  pac_17:        { categoryLabel: '폴리염화알루미늄 수용액 (PAC 17%)', categoryLabelEn: 'Polyaluminum Chloride Aqueous (PAC 17%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 17.0, allowsConcEdit: false },
  glycerol:      { categoryLabel: '정제 글리세롤 (Glycerol · NRTL 비이상계)', categoryLabelEn: 'Refined Glycerol (NRTL Non-Ideal)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  mch_3:         { categoryLabel: '모노클로로히드린 중간체 (3-MCH)', categoryLabelEn: 'Monochlorohydrin Intermediate (3-MCH)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  dch_13:        { categoryLabel: '1,3-디클로로히드린 (1,3-DCH)', categoryLabelEn: '1,3-Dichlorohydrin (1,3-DCH)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  ech_pure:      { categoryLabel: '에피클로로히드린 (ECH · 물 불균일공비 88°C)', categoryLabelEn: 'Epichlorohydrin (ECH · Water Heteroazeotrope 88°C)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  dcp_12:        { categoryLabel: '1,2-디클로로프로판 (1,2-DCP)', categoryLabelEn: '1,2-Dichloropropane (1,2-DCP)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  acetic_cat:    { categoryLabel: '빙초산 (Glacial Acetic Acid)', categoryLabelEn: 'Glacial Acetic Acid', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  aibn_initiator:{ categoryLabel: 'AIBN 라디칼 개시제 (Azobisisobutyronitrile)', categoryLabelEn: 'AIBN Radical Initiator (Azobisisobutyronitrile)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },

  // 7) 국내 중소·중견 화학·반도체·이차전지 핵심 공정 약품 (11종 순수성분 + 6종 공업용 표준 수용액)
  H2O2:          { categoryLabel: '산화성 무기액체 · 과산화수소 (H₂O₂)', categoryLabelEn: 'Oxidizing Inorganic Liquid · Hydrogen Peroxide (H₂O₂)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'SS316L / Al (부동태화) · PTFE', recommendedMaterialEn: 'SS316L / Passivated Al · PTFE' },
  H3PO4:         { categoryLabel: '고점도 무기산 · 인산 (H₃PO₄)', categoryLabelEn: 'High-Viscosity Inorganic Acid · Phosphoric Acid (H₃PO₄)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'SS316L / Alloy 904L / PTFE', recommendedMaterialEn: 'SS316L / Alloy 904L / PTFE' },
  HF:            { categoryLabel: '강부식성 할로겐산 · 불화수소 (HF)', categoryLabelEn: 'Corrosive Halogen Acid · Hydrofluoric Acid (HF)', compatibleMethods: ['ELECNRTL', 'NRTL', 'PENG-ROB'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'PTFE / PFA / PVDF / Hastelloy C-276 (유리·SS 엄금)', recommendedMaterialEn: 'PTFE / PFA / PVDF / Hastelloy C-276 (No Glass/SS)' },
  KOH:           { categoryLabel: '강알칼리 전해질 · 수산화칼륨 (KOH)', categoryLabelEn: 'Strong Alkaline Electrolyte · Potassium Hydroxide (KOH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'CS / SS316L / Ni200 (Al·Zn 엄금)', recommendedMaterialEn: 'CS / SS316L / Ni200 (No Al/Zn)' },
  NH4OH:         { categoryLabel: '휘발성 알칼리 수용액 · 암모니아수 (NH₄OH)', categoryLabelEn: 'Volatile Alkaline Aqueous · Ammonium Hydroxide (NH₄OH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'SS316L / FRP / PP (동·황동 엄금)', recommendedMaterialEn: 'SS316L / FRP / PP (No Cu/Brass)' },
  TMAH:          { categoryLabel: '반도체·디스플레이 유기 강알칼리 현상액 (TMAH)', categoryLabelEn: 'Semiconductor/Display Organic Alkaline Developer (TMAH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'SS316L / FRP / PTFE / PFA', recommendedMaterialEn: 'SS316L / FRP / PTFE / PFA' },
  NMP:           { categoryLabel: '이차전지 양극재 슬러리 극성 비양성자 용매 (NMP)', categoryLabelEn: 'Li-Ion Battery Cathode Slurry Polar Aprotic Solvent (NMP)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false, recommendedMaterial: 'CS / SS316L / PTFE (EPDM·Viton 주의)', recommendedMaterialEn: 'CS / SS316L / PTFE (Check EPDM/Viton)' },
  BCS:           { categoryLabel: '글리콜에테르 도료·세정 용제 (부틸셀로솔브 · BCS)', categoryLabelEn: 'Glycol Ether Coating/Cleaning Solvent (Butyl Cellosolve · BCS)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false, recommendedMaterial: 'CS / SS316L / PTFE', recommendedMaterialEn: 'CS / SS316L / PTFE' },
  Na2CO3:        { categoryLabel: '무기 알칼리 염 · 탄산나트륨 (소다회)', categoryLabelEn: 'Inorganic Alkali Salt · Sodium Carbonate (Soda Ash)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'CS / SS316L / FRP', recommendedMaterialEn: 'CS / SS316L / FRP' },
  NaHSO3:        { categoryLabel: '수처리 잔류염소 환원제 · 중아황산나트륨 (NaHSO₃)', categoryLabelEn: 'Dechlorination Reducing Agent · Sodium Bisulfite (NaHSO₃)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'SS316L / FRP / PE', recommendedMaterialEn: 'SS316L / FRP / PE' },
  CaOH2:         { categoryLabel: '폐수 중화·탈황 알칼리 · 수산화칼슘 (소석회)', categoryLabelEn: 'Wastewater Neutralization/FGD · Calcium Hydroxide', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', allowsConcEdit: false, recommendedMaterial: 'CS / SS316L / 고무라이닝 (슬러리 침강 주의)', recommendedMaterialEn: 'CS / SS316L / Rubber-Lined (Prevent Settling)' },
  HCPX:          { categoryLabel: '아라미드 중간체 · 헥사클로로-p-자일렌 (HCPX)', categoryLabelEn: 'Aramid Intermediate · Hexachloro-p-xylene (HCPX)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false, recommendedMaterial: 'GL (Glass-Lined) / Hastelloy C-276 / PTFE', recommendedMaterialEn: 'Glass-Lined / Hastelloy C-276 / PTFE' },
  TPA:           { categoryLabel: '고분자 단량체 · 테레프탈산 (TPA, 고체/슬러리)', categoryLabelEn: 'Polymer Monomer · Terephthalic Acid (TPA, Solid/Slurry)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false, recommendedMaterial: 'SS316L / Ti / Glass-Lined', recommendedMaterialEn: 'SS316L / Titanium / Glass-Lined' },
  TPC:           { categoryLabel: '아라미드 단량체 · 테레프탈로일 클로라이드 (TPC)', categoryLabelEn: 'Aramid Monomer · Terephthaloyl Chloride (TPC)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false, recommendedMaterial: 'Hastelloy C-276 / Glass-Lined / Ni200 (수분 엄금)', recommendedMaterialEn: 'Hastelloy C-276 / Glass-Lined / Ni200 (Moisture-Free)' },
  h2o2_35:       { categoryLabel: '과산화수소수 공업용 표준액 (35 wt% H₂O₂)', categoryLabelEn: 'Industrial Hydrogen Peroxide Solution (35 wt% H₂O₂)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 35.0, allowsConcEdit: false, recommendedMaterial: 'SS316L / Al (부동태화) · PTFE', recommendedMaterialEn: 'SS316L / Passivated Al · PTFE' },
  h3po4_85:      { categoryLabel: '인산 공업용·식각용 표준액 (85 wt% H₃PO₄)', categoryLabelEn: 'Industrial/Etchant Phosphoric Acid (85 wt% H₃PO₄)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 85.0, allowsConcEdit: false, recommendedMaterial: 'SS316L / Alloy 904L / PTFE', recommendedMaterialEn: 'SS316L / Alloy 904L / PTFE' },
  hf_49:         { categoryLabel: '불산 반도체·산세 표준액 (49 wt% HF)', categoryLabelEn: 'Semiconductor/Pickling Hydrofluoric Acid (49 wt% HF)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 49.0, allowsConcEdit: false, recommendedMaterial: 'PTFE / PFA / PVDF / Hastelloy C-276', recommendedMaterialEn: 'PTFE / PFA / PVDF / Hastelloy C-276' },
  koh_45:        { categoryLabel: '액상 수산화칼륨 표준액 (45 wt% KOH)', categoryLabelEn: 'Liquid Potassium Hydroxide Standard (45 wt% KOH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 45.0, allowsConcEdit: false, recommendedMaterial: 'CS / SS316L / Ni200', recommendedMaterialEn: 'CS / SS316L / Ni200' },
  nh4oh_28:      { categoryLabel: '암모니아수 공업용 표준액 (28 wt% NH₄OH)', categoryLabelEn: 'Industrial Ammonium Hydroxide (28 wt% NH₄OH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 28.0, allowsConcEdit: false, recommendedMaterial: 'SS316L / FRP / PP (동·황동 엄금)', recommendedMaterialEn: 'SS316L / FRP / PP (No Cu/Brass)' },
  tmah_25:       { categoryLabel: 'TMAH 반도체·디스플레이 현상액 (25 wt%)', categoryLabelEn: 'TMAH Semiconductor/Display Developer (25 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false, recommendedMaterial: 'SS316L / FRP / PTFE / PFA', recommendedMaterialEn: 'SS316L / FRP / PTFE / PFA' },
};

const COMP_FAMILY_LABELS_EN: Record<CompChemicalFamily, string> = {
  electrolyte_inorg: 'Electrolytes · Acids · Inorganic Salts',
  chlor_ech: 'Chlorine · ECH · Chlorohydrins',
  gas_syngas: 'Industrial Gases · Syngas',
  hydrocarbon: 'Paraffin · Olefin Hydrocarbons',
  aromatic: 'BTX Aromatics & Isocyanates',
  polar_solvent: 'Alcohols · Ketones · Polar Solvents',
};

const CATEGORY_FILTERS: Array<{ id: CategoryFilterId; label: string; labelEn: string }> = [
  { id: 'all', label: '전체', labelEn: 'All' },
  { id: 'elec', label: '전해질 수용액 (eNRTL)', labelEn: 'Electrolyte Aqueous (eNRTL)' },
  { id: 'gas', label: '무기·산업가스', labelEn: 'Inorganic & Industrial Gases' },
  { id: 'chlor', label: '염소화합물·유기용매', labelEn: 'Chlorinated & Organic Solvents' },
  { id: 'aromatic', label: '방향족·이소시아네이트', labelEn: 'Aromatics & Isocyanates' },
  { id: 'alcohol', label: '알코올·케톤·유기산', labelEn: 'Alcohols · Ketones · Acids' },
  { id: 'hc', label: '탄화수소·연료', labelEn: 'Hydrocarbons & Fuels' },
  { id: 'utility', label: '물·스팀·열매·냉매', labelEn: 'Water · Steam · Thermal · Refrig.' },
];

const GAS_SIM_COMPS = new Set<SimCompKey>([
  'Cl2', 'H2', 'HCl', 'O2', 'N2', 'CO', 'CO2', 'NH3', 'Ar', 'H2S', 'SO2', 'SO3',
]);
const ELEC_SIM_COMPS = new Set<SimCompKey>([
  'NaCl', 'NaOH', 'H2SO4', 'NaOCl', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC', 'HNO3',
  'H2O2', 'H3PO4', 'HF', 'KOH', 'NH4OH', 'TMAH', 'Na2CO3', 'NaHSO3', 'CaOH2',
]);
const ALCOHOL_SIM_COMPS = new Set<SimCompKey>([
  'Glycerol', 'MeOH', 'EtOH', 'IPA', 'Acetone', 'AceticAcid', 'EtOAc', 'MEK', 'EG', 'BCS', 'FormicAcid', 'HCHO', 'CUSTOM_1',
]);
const CHLOR_SOLVENT_SIM_COMPS = new Set<SimCompKey>([
  'MCH', 'DCH', 'ECH', 'DCP', 'CH3Cl', 'CH2Cl2', 'CHCl3', 'CCl4', 'C2Cl4', 'COCl2', 'THF', 'DMF', 'DMSO', 'NMP', 'MTBE', 'DMC', 'MEA', 'MDEA', 'HCPX', 'TPC',
]);

function classifyFluidCategory(f: FluidProps): Exclude<CategoryFilterId, 'all'> {
  if (f.key === 'H2O') return 'utility';
  if (f.isUtility) {
    if (f.key === 'nitrogen_air' || f.key === 'air') return 'gas';
    return 'utility';
  }
  if (f.key === 'ahcl_liq') return 'gas';
  if (f.isProcessSolution) return 'elec';
  if (f.simCompKey) {
    if (ELEC_SIM_COMPS.has(f.simCompKey)) return 'elec';
    if (GAS_SIM_COMPS.has(f.simCompKey)) return 'gas';
    if (CHLOR_SOLVENT_SIM_COMPS.has(f.simCompKey)) return 'chlor';
    if (ALCOHOL_SIM_COMPS.has(f.simCompKey)) return 'alcohol';
    const fam = COMP_CATALOG_META[f.simCompKey]?.family;
    if (fam === 'aromatic') return 'aromatic';
    if (fam === 'hydrocarbon' || f.simCompKey === 'CH4') return 'hc';
  }
  return 'chlor';
}

const METHOD_MAP_TO_PAGE: Record<ResolvedPropertyMethod, ThermoMethodCode> = {
  ENRTL: 'ELECNRTL',
  NRTL: 'NRTL',
  PR: 'PENG-ROB',
  SRK: 'SRK',
};

function resolveCompatForKey(sysKey: string): SubstanceCompatSpec {
  if (SUBSTANCE_COMPAT_MAP[sysKey]) {
    return SUBSTANCE_COMPAT_MAP[sysKey];
  }
  const fl = FLUID_DB[sysKey];
  if (fl?.simCompKey && COMP_CATALOG_META[fl.simCompKey]) {
    const cat = COMP_CATALOG_META[fl.simCompKey];
    const mapped = Array.from(
      new Set(cat.reliableMethods.map(m => METHOD_MAP_TO_PAGE[m]))
    );
    if (fl.simCompKey === 'H2O') {
      if (!mapped.includes('STEAM-IAPWS')) mapped.push('STEAM-IAPWS');
    }
    return {
      categoryLabel: cat.familyLabelKo,
      categoryLabelEn: COMP_FAMILY_LABELS_EN[cat.family] ?? 'General Process Fluid',
      compatibleMethods: mapped.length > 0 ? mapped : ['NRTL', 'PENG-ROB'],
      defaultMethod: mapped[0] ?? 'NRTL',
      allowsConcEdit: false,
    };
  }
  return {
    categoryLabel: fl?.familyLabelKo ?? '일반 공정 유체',
    categoryLabelEn: 'General Process Fluid',
    compatibleMethods: ['NRTL', 'PENG-ROB', 'SRK'],
    defaultMethod: 'NRTL',
    allowsConcEdit: false,
  };
}

// 기체 및 냉매 임계 상수 fallback
const GAS_CRITICAL_LEGACY: Record<string, { Tc_K: number; Pc_bar: number; omega: number; MW: number }> = {
  cl2_gas:     { Tc_K: 416.9,  Pc_bar: 79.91,  omega: 0.073,  MW: 70.906 },
  ahcl_gas:    { Tc_K: 324.65, Pc_bar: 83.10,  omega: 0.132,  MW: 36.461 },
  h2_gas:      { Tc_K: 33.19,  Pc_bar: 13.13,  omega: -0.216, MW: 2.016 },
  n2_gas:      { Tc_K: 126.2,  Pc_bar: 33.98,  omega: 0.037,  MW: 28.013 },
  nitrogen_air:{ Tc_K: 129.0,  Pc_bar: 35.80,  omega: 0.036,  MW: 28.40 },
  air:         { Tc_K: 132.5,  Pc_bar: 37.71,  omega: 0.035,  MW: 28.97 },
  steam_lp:    { Tc_K: 647.1,  Pc_bar: 220.64, omega: 0.344,  MW: 18.015 },
  steam_mp:    { Tc_K: 647.1,  Pc_bar: 220.64, omega: 0.344,  MW: 18.015 },
  steam_hp:    { Tc_K: 647.1,  Pc_bar: 220.64, omega: 0.344,  MW: 18.015 },
  ref_r134a:   { Tc_K: 374.21, Pc_bar: 40.59,  omega: 0.3268, MW: 102.03 },
  ref_r404a:   { Tc_K: 345.20, Pc_bar: 37.29,  omega: 0.2860, MW: 97.60 },
  ref_r507a:   { Tc_K: 343.77, Pc_bar: 37.05,  omega: 0.2880, MW: 98.86 },
  ref_r410a:   { Tc_K: 344.50, Pc_bar: 49.01,  omega: 0.2960, MW: 72.58 },
  ref_r22:     { Tc_K: 369.30, Pc_bar: 49.90,  omega: 0.2208, MW: 86.47 },
  ref_r32:     { Tc_K: 351.26, Pc_bar: 57.82,  omega: 0.2769, MW: 52.02 },
  ref_r1234yf: { Tc_K: 367.85, Pc_bar: 33.82,  omega: 0.2760, MW: 114.04 },
  ref_r1234ze: { Tc_K: 382.52, Pc_bar: 36.36,  omega: 0.3130, MW: 114.04 },
  ref_r717:    { Tc_K: 405.40, Pc_bar: 113.33, omega: 0.2560, MW: 17.03 },
  ref_r1270:   { Tc_K: 364.90, Pc_bar: 46.00,  omega: 0.1400, MW: 42.08 },
  ref_r744:    { Tc_K: 304.13, Pc_bar: 73.77,  omega: 0.2239, MW: 44.01 },
};

function getCritForFluid(fl: FluidProps): { Tc_K: number; Pc_bar: number; omega: number; MW: number } {
  if (fl.simCompKey && RIGOROUS_CRIT[fl.simCompKey]) {
    const c = RIGOROUS_CRIT[fl.simCompKey];
    return { Tc_K: c.Tc_K, Pc_bar: c.Pc_bar, omega: c.omega, MW: c.mw };
  }
  if (GAS_CRITICAL_LEGACY[fl.key]) {
    return GAS_CRITICAL_LEGACY[fl.key];
  }
  if (fl.Tc_K && fl.Pc_bar) {
    return {
      Tc_K: fl.Tc_K,
      Pc_bar: fl.Pc_bar,
      omega: fl.omega ?? 0.25,
      MW: fl.MW ?? 40,
    };
  }
  return GAS_CRITICAL_LEGACY.air;
}

// 3차 상태방정식(Peng-Robinson / SRK) 압축인자 Z 및 퓨개시티 계수 근사 계산
function calcCubicEosGas(fl: FluidProps, T_C: number, P_bar: number, model: ThermoMethodCode) {
  const crit = getCritForFluid(fl);
  const T_K = Math.max(80, T_C + 273.15);
  const P = Math.max(0.01, P_bar);
  const Tr = T_K / crit.Tc_K;
  const Pr = P / crit.Pc_bar;

  const isPR = model === 'PENG-ROB';
  const m = isPR
    ? 0.37464 + 1.54226 * crit.omega - 0.26992 * crit.omega * crit.omega
    : 0.480 + 1.574 * crit.omega - 0.176 * crit.omega * crit.omega;
  const alpha = fl.simCompKey === 'H2' && !isPR
    ? 1.202 * Math.exp(-0.30228 * Tr)
    : Math.pow(1 + m * (1 - Math.sqrt(Tr)), 2);

  const omegaA = isPR ? 0.45724 : 0.42748;
  const omegaB = isPR ? 0.07780 : 0.08664;
  const A = (omegaA * alpha * Pr) / (Tr * Tr);
  const B = (omegaB * Pr) / Tr;

  const Z = Math.max(0.35, Math.min(1.25, 1 + B - A / Math.max(0.4, 1 + (isPR ? 2 * B : B))));
  const phi = Math.exp(Math.max(-1.5, Math.min(0.5, (Z - 1) - Math.log(Math.max(0.1, Z - B)) - A / Math.max(0.2, Z + B))));
  const rhoGas = (P * 1e5 * crit.MW) / (Z * 8314.46 * T_K);
  return { Z, phi, rhoGas, crit };
}

function estimateSatTempC(fl: FluidProps, pBar: number): number | undefined {
  const pKpa = Math.max(0.5, pBar * 100);
  if (fl.antoine) {
    const { A, B, C } = fl.antoine;
    const denom = A - Math.log10(pKpa);
    if (denom > 0.35) {
      const tEst = B / denom - C;
      if (Number.isFinite(tEst) && tEst > -260 && tEst < 600) {
        return tEst;
      }
    }
  }
  return fl.Tb_C;
}

const NON_VOLATILE_SIM_SET = new Set<SimCompKey>([
  'NaCl', 'NaOH', 'H2SO4', 'NaOCl', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC',
  'H3PO4', 'KOH', 'Na2CO3', 'NaHSO3', 'CaOH2', 'TPA',
]);

export default function PropertyDbPage() {
  const { activePlantId, lastPlantReturnHref } = useBalanceStore();
  const lang = useUnitStore(s => s.lang);
  const isEn = lang === 'en';
  const t = (ko: string, en: string) => (isEn ? en : ko);
  const returnHref = lastPlantReturnHref || getPlantRegistryItem(activePlantId).defaultHref;

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterId>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sysKey, setSysKey] = useState<string>('elec_naoh');
  const [methodKey, setMethodKey] = useState<ThermoMethodCode>('ELECNRTL');
  const [tempC, setTempC] = useState<number>(90.0);
  const [pressBar, setPressBar] = useState<number>(1.013);
  const [concWt, setConcWt] = useState<number>(32.0);
  const [plotMetric, setPlotMetric] = useState<PlotMetricKey>('psat');

  const compat = useMemo<SubstanceCompatSpec>(() => resolveCompatForKey(sysKey), [sysKey]);

  const activeMethodKey: ThermoMethodCode = compat.compatibleMethods.includes(methodKey)
    ? methodKey
    : compat.defaultMethod;
  const method = THERMO_METHODS[activeMethodKey];

  const selectedSubstanceLabel = useMemo(() => {
    const el = ELECTROLYTE_SYSTEMS.find(s => s.key === sysKey);
    if (el) return isEn ? el.nameEn : el.name;
    const fl = FLUID_DB[sysKey];
    if (!fl) return sysKey;
    const fStr = fl.formula ? ` [${fl.formula}]` : '';
    return isEn ? `${fl.name}${fStr}` : `${fl.nameKo}${fStr} (${fl.name})`;
  }, [isEn, sysKey]);

  const handleSubstanceChange = (newKey: string) => {
    setSysKey(newKey);
    const nextCompat = resolveCompatForKey(newKey);

    const foundElec = ELECTROLYTE_SYSTEMS.find(x => x.key === newKey);
    if (foundElec) {
      setConcWt(foundElec.defaultWt);
      setTempC(foundElec.defaultT);
      setPressBar(1.013);
    } else {
      const fl = FLUID_DB[newKey];
      if (fl) {
        if (newKey.startsWith('ref_')) {
          setTempC(-15.0);
          setPressBar(newKey === 'ref_r744' ? 20.0 : newKey === 'ref_r410a' || newKey === 'ref_r32' ? 5.0 : 2.8);
          setConcWt(100);
        } else if (newKey === 'brine_eg40' || newKey === 'brine_cacl2_25' || newKey === 'brine_coolant') {
          setTempC(-12.0);
          setPressBar(2.5);
          setConcWt(nextCompat.fixedOrDefaultWt ?? 30);
        } else if (newKey === 'steam_lp') {
          setTempC(148.0);
          setPressBar(4.5);
          setConcWt(100);
        } else if (newKey === 'steam_mp') {
          setTempC(184.0);
          setPressBar(11.0);
          setConcWt(100);
        } else if (newKey === 'steam_hp') {
          setTempC(235.0);
          setPressBar(30.6);
          setConcWt(100);
        } else if (newKey === 'dowtherm_a' || newKey === 'therminol_66') {
          setTempC(250.0);
          setPressBar(2.0);
          setConcWt(100);
        } else {
          setTempC(fl.T_ref);
          setPressBar(1.013);
          setConcWt(nextCompat.fixedOrDefaultWt ?? (fl.phase === 'G' ? 100 : 0));
        }
      }
    }

    if (!nextCompat.compatibleMethods.includes(methodKey) || nextCompat.defaultMethod !== compat.defaultMethod) {
      setMethodKey(nextCompat.defaultMethod);
    }
  };

  // 통합 물성 DB 풀 (전 공정 성분 + 유틸리티 + 표준 수용액)
  const allSimCompFluids = useMemo<FluidProps[]>(
    () => SIM_COMPS.map(k => FLUID_DB[k]).filter((f): f is FluidProps => Boolean(f)),
    []
  );

  const utilityFluids = useMemo<FluidProps[]>(
    () => ALL_FLUIDS.filter(f => Boolean(f.isUtility)),
    []
  );

  const processSolutionFluids = useMemo<FluidProps[]>(
    () => ALL_FLUIDS.filter(f => Boolean(f.isProcessSolution)),
    []
  );

  const allUnifiedFluids = useMemo<FluidProps[]>(
    () => [...allSimCompFluids, ...utilityFluids, ...processSolutionFluids],
    [allSimCompFluids, utilityFluids, processSolutionFluids]
  );

  const fluidsByCategory = useMemo(() => {
    const grouped: Record<Exclude<CategoryFilterId, 'all'>, FluidProps[]> = {
      elec: [],
      gas: [],
      chlor: [],
      aromatic: [],
      alcohol: [],
      hc: [],
      utility: [],
    };
    for (const f of allUnifiedFluids) {
      grouped[classifyFluidCategory(f)].push(f);
    }
    return grouped;
  }, [allUnifiedFluids]);

  const categoryCounts = useMemo<Record<CategoryFilterId, number>>(() => ({
    all: ELECTROLYTE_SYSTEMS.length + allUnifiedFluids.length,
    elec: ELECTROLYTE_SYSTEMS.length + fluidsByCategory.elec.length,
    gas: fluidsByCategory.gas.length,
    chlor: fluidsByCategory.chlor.length,
    aromatic: fluidsByCategory.aromatic.length,
    alcohol: fluidsByCategory.alcohol.length,
    hc: fluidsByCategory.hc.length,
    utility: fluidsByCategory.utility.length,
  }), [allUnifiedFluids.length, fluidsByCategory]);

  const searchResults = useMemo(() => {
    const q = normalizeSearchText(searchQuery);
    const elecPool =
      categoryFilter === 'all' || categoryFilter === 'elec' ? ELECTROLYTE_SYSTEMS : [];
    const fluidPool =
      categoryFilter === 'all' ? allUnifiedFluids : fluidsByCategory[categoryFilter];

    if (!q) {
      return {
        primaryFluids: fluidPool,
        elecMatches: elecPool,
      };
    }

    const primaryFluids = searchFluidProps(searchQuery, fluidPool);
    const elecMatches = elecPool.filter(s => {
      const pool = [s.key, s.name, s.formula, s.cas, ...s.aliases];
      return pool.some(v => normalizeSearchText(v).includes(q));
    });

    return { primaryFluids, elecMatches };
  }, [searchQuery, categoryFilter, allUnifiedFluids, fluidsByCategory]);

  const reportedMissingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || q.length > 60) return;
    if (searchResults.primaryFluids.length + searchResults.elecMatches.length > 0) return;
    const normKey = q.toLowerCase();
    if (reportedMissingRef.current.has(normKey)) return;

    const timer = window.setTimeout(() => {
      if (categoryFilter !== 'all') {
        const norm = normalizeSearchText(q);
        const anyFluid = searchFluidProps(q, allUnifiedFluids).length > 0;
        const anyElec = ELECTROLYTE_SYSTEMS.some(s =>
          [s.key, s.name, s.formula, s.cas, ...s.aliases].some(v =>
            normalizeSearchText(v).includes(norm)
          )
        );
        if (anyFluid || anyElec) return;
      }
      if (reportedMissingRef.current.has(normKey)) return;
      reportedMissingRef.current.add(normKey);
      void reportInteropGaps({
        source_type: 'property_db_search',
        missing_searches: [q],
      });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [searchQuery, searchResults, categoryFilter, allUnifiedFluids]);

  // 선택된 물질 + 호환 열역학 모델 기반 물성 계산
  const calcPropsAt = (T: number, wtInput: number, pBar: number) => {
    const wt = compat.allowsConcEdit ? wtInput : (compat.fixedOrDefaultWt ?? 0);
    const w = Math.max(0, Math.min(98, wt)) / 100;
    const psat_water_kPa = Math.pow(10, 7.07406 - 1657.46 / (T + 227.02)) * 0.133322;
    const isNrtlApprox = activeMethodKey === 'NRTL';

    // 1) 가변 농도 전해질 수용액
    if (sysKey.startsWith('elec_')) {
      const nrtlFactor = isNrtlApprox ? 0.91 : 1.0;
      if (sysKey === 'elec_naoh') {
        const rho = 998 + 1085 * w - 0.58 * (T - 20);
        const mu = Math.max(0.22, 0.95 * Math.exp(4.8 * w - 0.022 * (T - 25)));
        const cp = Math.max(2.55, 4.184 * (1 - 0.36 * w) + 0.0015 * (T - 50));
        const k = 0.60 * (1 - 0.12 * w) + 0.0008 * (T - 25);
        const bpr = (0.24 * wt + 0.0128 * wt * wt) * (1 + 0.0018 * (T - 60)) * nrtlFactor;
        const gamma = isNrtlApprox ? 0.78 + 0.95 * w * w : 0.65 + 1.45 * w * w;
        const psat = psat_water_kPa * Math.max(0.10, 1 - 0.95 * w * (1 + 0.5 * w * nrtlFactor));
        return { rho, mu, cp, k, bpr, gamma, psat, phase: t('L (전해질 수용액)', 'L (Electrolyte Aqueous)'), subCoefLabel: `${t('활동도계수', 'Activity coeff.')} γ± = ${gamma.toFixed(3)}` };
      }
      if (sysKey === 'elec_nacl') {
        const rho = 998 + 740 * w - 0.42 * (T - 20);
        const mu = Math.max(0.25, 0.90 * Math.exp(2.1 * w - 0.019 * (T - 25)));
        const cp = 4.184 * (1 - 0.42 * w);
        const k = 0.59 * (1 - 0.08 * w) + 0.001 * (T - 25);
        const bpr = (0.18 * wt + 0.0065 * wt * wt) * nrtlFactor;
        const gamma = isNrtlApprox ? 0.82 + 0.55 * w : 0.72 + 0.85 * w;
        const psat = psat_water_kPa * (1 - 0.62 * w * nrtlFactor);
        return { rho, mu, cp, k, bpr, gamma, psat, phase: t('L (브라인 염수)', 'L (Brine Solution)'), subCoefLabel: `${t('활동도계수', 'Activity coeff.')} γ± = ${gamma.toFixed(3)}` };
      }
      const rho = 1000 + 890 * w - 0.50 * (T - 20);
      const mu = Math.max(0.28, 1.05 * Math.exp(3.2 * w - 0.020 * (T - 25)));
      const cp = 4.184 * (1 - 0.38 * w);
      const k = 0.58 * (1 - 0.15 * w);
      const bpr = (0.21 * wt + 0.0095 * wt * wt) * nrtlFactor;
      const gamma = isNrtlApprox ? 0.85 + 0.80 * w : 0.78 + 1.15 * w;
      const psat = psat_water_kPa * Math.max(0.04, 1 - 0.85 * w * nrtlFactor);
      return { rho, mu, cp, k, bpr, gamma, psat, phase: t('L (전해질 수용액)', 'L (Electrolyte Aqueous)'), subCoefLabel: `${t('활동도계수', 'Activity coeff.')} γ± = ${gamma.toFixed(3)}` };
    }

    const fl = FLUID_DB[sysKey] ?? ALL_FLUIDS[0];

    // 2) 산업용 냉매 (ref_*)
    if (fl.key.startsWith('ref_') && fl.antoine) {
      const { Z, phi, rhoGas, crit } = calcCubicEosGas(fl, T, pBar, activeMethodKey);
      const Tc_C = crit.Tc_K - 273.15;
      const psat_kPa = vaporPressure_kPa(fl, Math.min(T, Tc_C));
      const psat_bar = psat_kPa / 100.0;
      const pKpa = Math.max(5.0, pBar * 100.0);
      const tSatAtP_C = fl.antoine.B / Math.max(0.8, fl.antoine.A - Math.log10(pKpa)) - fl.antoine.C;
      const deltaT_SH = T - tSatAtP_C;

      const tb_C = fl.Tb_C ?? -30.0;
      const hvRef = fl.latentHeat_kJkg ?? 200.0;
      const hvapAtT =
        T >= Tc_C
          ? 0.0
          : hvRef * Math.pow(Math.max(0.02, (Tc_C - T) / Math.max(10.0, Tc_C - tb_C)), 0.38);

      if (T >= Tc_C && pBar >= crit.Pc_bar) {
        return {
          rho: rhoGas,
          mu: Math.max(0.015, 0.022 * Math.pow((T + 273.15) / 298.15, 0.7)),
          cp: fl.Cp * 1.15,
          k: 0.032,
          bpr: 0.0,
          gamma: phi,
          psat: crit.Pc_bar * 100,
          tSatC: Tc_C,
          hvap: 0,
          superheatC: T - Tc_C,
          phase: `${t('초임계', 'Supercritical')} (Z=${Z.toFixed(3)})`,
          subCoefLabel: `${t('임계점 초과', 'Above Critical Pt.')} (Tc=${Tc_C.toFixed(1)}°C, Pc=${crit.Pc_bar.toFixed(1)} bar)`,
        };
      }

      const isSubcooledLiq = pBar >= psat_bar && T < Tc_C;
      if (isSubcooledLiq) {
        const rhoLiq = Math.max(380, densityAtT(fl, T));
        const muLiq = Math.max(0.06, (fl.viscosity_ref ?? 0.16) + (fl.dMu_dT ?? -0.0022) * (T - fl.T_ref));
        const cpLiq = Math.max(0.95, fl.Cp * (1 + 0.0018 * (T - fl.T_ref)));
        const kLiq = Math.max(0.045, (fl.k_thermal ?? 0.08) * (1 - 0.0025 * (T - fl.T_ref)));
        return {
          rho: rhoLiq,
          mu: muLiq,
          cp: cpLiq,
          k: kLiq,
          bpr: 0.0,
          gamma: phi,
          psat: psat_kPa,
          tSatC: tSatAtP_C,
          hvap: hvapAtT,
          superheatC: deltaT_SH,
          phase: isEn
            ? `L (Subcooled Liquid · ΔT_sub ${Math.abs(deltaT_SH).toFixed(1)}°C)`
            : `L (과냉각 액상 · 과냉 ${Math.abs(deltaT_SH).toFixed(1)}°C)`,
          subCoefLabel: isEn
            ? `Sat. T_sat=${tSatAtP_C.toFixed(1)}°C · ΔHv=${hvapAtT.toFixed(0)} kJ/kg`
            : `포화 T_sat=${tSatAtP_C.toFixed(1)}°C · 잠열 ΔHv=${hvapAtT.toFixed(0)} kJ/kg`,
        };
      }

      const muVap = Math.max(0.009, 0.0125 * Math.pow(Math.max(180, T + 273.15) / 293.15, 0.78));
      const cpVap = Math.max(0.68, fl.Cp * 0.62 * (1 + 0.0012 * (T - tb_C)));
      const kVap = Math.max(0.010, 0.014 * Math.pow(Math.max(180, T + 273.15) / 293.15, 0.85));
      return {
        rho: rhoGas,
        mu: muVap,
        cp: cpVap,
        k: kVap,
        bpr: 0.0,
        gamma: phi,
        psat: psat_kPa,
        tSatC: tSatAtP_C,
        hvap: hvapAtT,
        superheatC: deltaT_SH,
        phase: isEn
          ? `G (Superheated Vapor · +${Math.max(0, deltaT_SH).toFixed(1)}°C · Z=${Z.toFixed(3)})`
          : `G (과열 증기 · 과열 +${Math.max(0, deltaT_SH).toFixed(1)}°C · Z=${Z.toFixed(3)})`,
        subCoefLabel: isEn
          ? `Sat. T_sat=${tSatAtP_C.toFixed(1)}°C · ΔHv=${hvapAtT.toFixed(0)} kJ/kg`
          : `포화 T_sat=${tSatAtP_C.toFixed(1)}°C · 잠열 ΔHv=${hvapAtT.toFixed(0)} kJ/kg`,
      };
    }

    // 3) 순수 · 냉각수 · 칠드워터 · LP/MP/HP 스팀 유틸리티
    if (
      fl.key === 'process_water' ||
      fl.key === 'cooling_water' ||
      fl.key === 'chilled_water' ||
      fl.key === 'steam_lp' ||
      fl.key === 'steam_mp' ||
      fl.key === 'steam_hp' ||
      fl.key === 'H2O'
    ) {
      const pKpa = Math.max(1.0, pBar * 100);
      const tSatAtP_C = 1730.63 / Math.max(0.8, 8.07131 - Math.log10(pKpa * 7.50062)) - 233.426;
      const isSteam = psat_water_kPa >= pKpa || T >= tSatAtP_C;
      const crit = getCritForFluid(fl);
      const hvapAtT = T >= 373.9 ? 0 : 2257 * Math.pow(Math.max(0.01, (373.95 - T) / 273.95), 0.35);
      const { Z, phi, rhoGas } = calcCubicEosGas(fl, T, pBar, activeMethodKey);
      const rhoLiq = Math.max(600, 997.0 - 0.38 * (T - 25));
      const muLiq = Math.max(0.12, 0.89 * Math.exp(-0.019 * (T - 25)));
      const muVap = Math.max(0.009, 0.0122 * Math.pow((T + 273.15) / 373.15, 0.85));
      return {
        rho: isSteam ? rhoGas : rhoLiq,
        mu: isSteam ? muVap : muLiq,
        cp: isSteam ? 2.08 + 0.0012 * Math.max(0, T - 100) : 4.184 + 0.0005 * Math.max(0, T - 50),
        k: isSteam ? 0.025 + 0.00008 * Math.max(0, T - 100) : 0.607 + 0.0011 * (T - 25) - 4e-6 * (T - 25) ** 2,
        bpr: 0.0,
        gamma: isSteam ? phi : 1.0,
        psat: psat_water_kPa,
        tSatC: Number.isFinite(tSatAtP_C) ? tSatAtP_C : 100.0,
        hvap: hvapAtT,
        superheatC: T - (Number.isFinite(tSatAtP_C) ? tSatAtP_C : 100.0),
        phase: isSteam
          ? t(`G (수증기 Steam · Z=${Z.toFixed(3)})`, `G (Steam Vapor · Z=${Z.toFixed(3)})`)
          : t('L (액상 물)', 'L (Liquid Water)'),
        subCoefLabel: isEn
          ? `IAPWS T_sat=${(Number.isFinite(tSatAtP_C) ? tSatAtP_C : 100).toFixed(1)}°C · Tc=${(crit.Tc_K - 273.15).toFixed(1)}°C`
          : `IAPWS 포화 T_sat=${(Number.isFinite(tSatAtP_C) ? tSatAtP_C : 100).toFixed(1)}°C · Tc=${(crit.Tc_K - 273.15).toFixed(1)}°C`,
      };
    }

    // 4) 표준 농도 공정액 (brine_25, naoh_32, h2so4_98, hcl_31 등)
    if (fl.isProcessSolution) {
      const rho = densityAtT(fl, T);
      const mu = viscosityAtT(fl, T);
      const psat = vaporPressure_kPa(fl, T);
      const bpr = (0.20 * wt + 0.008 * wt * wt) * (isNrtlApprox ? 0.91 : 1.0);
      const gamma = isNrtlApprox ? 0.84 + 0.65 * w : 0.72 + 1.05 * w;
      return {
        rho,
        mu,
        cp: fl.Cp ?? 3.4,
        k: fl.k_thermal ?? 0.54,
        bpr,
        gamma,
        psat,
        phase: t('L (표준 공정액)', 'L (Standard Solution)'),
        subCoefLabel: isEn
          ? `Activity coeff. γ± = ${gamma.toFixed(3)} · Std. Conc. ${wt.toFixed(1)} wt%`
          : `활동도계수 γ± = ${gamma.toFixed(3)} · 표준농도 ${wt.toFixed(1)} wt%`,
      };
    }

    // 5) 77종 SIM_COMPS 순수성분 & 레거시 순수 기체/액체/유틸리티 통합 해석
    const crit = getCritForFluid(fl);
    const Tc_C = crit.Tc_K - 273.15;
    const T_K = Math.max(60, T + 273.15);
    const simKey = fl.simCompKey;
    const mw = Math.max(2.0, fl.MW ?? crit.MW);

    // 5a) 비휘발성 무기염/고체 전해질 (NaCl, NaOH, H2SO4, FeCl2, FeCl3, NaOCl, NaClO3, PAC)
    if (simKey && NON_VOLATILE_SIM_SET.has(simKey)) {
      const cpVal = Number.isFinite(fl.Cp) ? fl.Cp : 1.0;
      return {
        rho: densityAtT(fl, T),
        mu: viscosityAtT(fl, T),
        cp: cpVal,
        k: fl.k_thermal ?? 0.50,
        bpr: 0.0,
        gamma: 1.0,
        psat: 0.0,
        phase: simKey === 'H2SO4'
          ? t('L (고비점 무기산)', 'L (High-Boiling Inorganic Acid)')
          : t('S / L (비휘발성 무기성분)', 'S / L (Non-Volatile Inorganic)'),
        subCoefLabel: isEn
          ? `Non-volatile pure species · Normal BP ${(fl.Tb_C ?? 300).toFixed(0)}°C · MW=${mw.toFixed(2)}`
          : `비휘발성 순수 성분 · 정상비점 ${(fl.Tb_C ?? 300).toFixed(0)}°C · MW=${mw.toFixed(2)}`,
      };
    }

    const { Z, phi, rhoGas } = calcCubicEosGas(fl, T, pBar, activeMethodKey);
    const psat_kPa = vaporPressure_kPa(fl, T);
    const psat_bar = psat_kPa / 100.0;
    const tSatC = estimateSatTempC(fl, pBar);
    const tb_C = fl.Tb_C ?? tSatC ?? 25.0;

    let hvapAtT = 0;
    if (simKey) {
      const hvKm = heatOfVaporizationKJkmol(simKey, T_K);
      hvapAtT = Number.isFinite(hvKm) && hvKm > 0 ? hvKm / mw : (fl.latentHeat_kJkg ?? 0);
    } else if (fl.latentHeat_kJkg && T < Tc_C) {
      hvapAtT = fl.latentHeat_kJkg * Math.pow(Math.max(0.02, (Tc_C - T) / Math.max(10, Tc_C - tb_C)), 0.38);
    }

    // 영구가스 (H2, N2, O2, CO, Ar) 또는 초임계 영역
    const isPermanent = (simKey && COMP_CATALOG_META[simKey]?.isPermanentGas) || T >= Tc_C;
    if (isPermanent) {
      const muGas = fl.phase === 'G'
        ? viscosityAtT(fl, T)
        : Math.max(0.008, 0.012 * Math.pow(T_K / 298.15, 0.7));
      const cpGas = simKey
        ? Math.max(0.15, idealGasCpJmolK(simKey, T_K) / mw)
        : fl.Cp;
      const kGas = fl.phase === 'G'
        ? Math.max(0.006, (fl.k_thermal ?? 0.022) * Math.pow(T_K / 298.15, 0.8))
        : 0.028;
      return {
        rho: rhoGas,
        mu: muGas,
        cp: Number.isFinite(cpGas) ? cpGas : fl.Cp,
        k: kGas,
        bpr: 0.0,
        gamma: phi,
        psat: Math.min(crit.Pc_bar * 100, Math.max(0, psat_kPa)),
        phase: T >= Tc_C && pBar >= crit.Pc_bar
          ? `${t('초임계', 'Supercritical')} (Z=${Z.toFixed(3)})`
          : t(`G (초임계 기체 · Z=${Z.toFixed(3)})`, `G (Supercritical Gas · Z=${Z.toFixed(3)})`),
        subCoefLabel: `Tc=${Tc_C.toFixed(1)}°C · Pc=${crit.Pc_bar.toFixed(1)} bar · φ=${phi.toFixed(3)}`,
      };
    }

    // 기액 상전이 판별 (pBar >= psat_bar -> 액상, 아니면 기상)
    const isLiquid = pBar >= psat_bar;
    if (isLiquid) {
      let rhoLiq = fl.phase === 'L' ? densityAtT(fl, T) : 850;
      if (fl.phase === 'G' && simKey) {
        const vL = calcRackettLiquidVolumeLmol(simKey, T);
        if (Number.isFinite(vL) && vL > 0.005) {
          rhoLiq = Math.max(300, Math.min(2500, mw / vL));
        }
      }
      const muLiq = fl.phase === 'L'
        ? viscosityAtT(fl, T)
        : Math.max(0.08, 0.25 - 0.0012 * T);
      const cpLiq = simKey
        ? Math.max(0.4, liquidCpJmolK(simKey, T_K) / mw)
        : fl.Cp;
      const kLiq = fl.phase === 'L'
        ? Math.max(0.05, (fl.k_thermal ?? 0.14) * (1 - 0.0015 * (T - fl.T_ref)))
        : 0.12;
      return {
        rho: rhoLiq,
        mu: muLiq,
        cp: Number.isFinite(cpLiq) ? cpLiq : fl.Cp,
        k: kLiq,
        bpr: 0.0,
        gamma: activeMethodKey === 'NRTL' ? 1.0 : phi,
        psat: psat_kPa,
        tSatC,
        hvap: hvapAtT,
        superheatC: tSatC !== undefined ? T - tSatC : undefined,
        phase: fl.downstreamGroup === '2_ECH'
          ? t(`L (유기액상 · Tb=${(tSatC ?? tb_C).toFixed(1)}°C)`, `L (Organic Liquid · Tb=${(tSatC ?? tb_C).toFixed(1)}°C)`)
          : t(`L (액상 · Tb=${(tSatC ?? tb_C).toFixed(1)}°C)`, `L (Liquid · Tb=${(tSatC ?? tb_C).toFixed(1)}°C)`),
        subCoefLabel: isEn
          ? `BP(@P) ${(tSatC ?? tb_C).toFixed(1)}°C · ΔHv=${hvapAtT.toFixed(0)} kJ/kg · MW=${mw.toFixed(2)}`
          : `비점(@P) ${(tSatC ?? tb_C).toFixed(1)}°C · ΔHv=${hvapAtT.toFixed(0)} kJ/kg · MW=${mw.toFixed(2)}`,
      };
    }

    // 기상 (Vapor / Gas)
    const muGas = fl.phase === 'G'
      ? viscosityAtT(fl, T)
      : Math.max(0.006, 0.0105 * Math.pow(T_K / 298.15, 0.75));
    const cpGas = simKey
      ? Math.max(0.25, idealGasCpJmolK(simKey, T_K) / mw)
      : fl.Cp * 0.65;
    const kGas = fl.phase === 'G'
      ? Math.max(0.006, (fl.k_thermal ?? 0.016) * Math.pow(T_K / 298.15, 0.8))
      : Math.max(0.008, (fl.k_thermal ?? 0.12) * 0.14 * Math.pow(T_K / 298.15, 0.8));

    return {
      rho: rhoGas,
      mu: muGas,
      cp: Number.isFinite(cpGas) ? cpGas : fl.Cp,
      k: kGas,
      bpr: 0.0,
      gamma: phi,
      psat: psat_kPa,
      tSatC,
      hvap: hvapAtT,
      superheatC: tSatC !== undefined ? T - tSatC : undefined,
      phase: t(`G (기상 · Z=${Z.toFixed(3)})`, `G (Vapor · Z=${Z.toFixed(3)})`),
      subCoefLabel: `${t('압축인자', 'Compressibility')} Z=${Z.toFixed(3)} · φ=${phi.toFixed(3)} · Tb=${(tSatC ?? tb_C).toFixed(1)}°C`,
    };
  };

  const cur = calcPropsAt(tempC, concWt, pressBar);

  // 물질 특성에 맞는 온도 스윕 범위 자동 설정
  const sweepTemps = useMemo(() => {
    const fl = FLUID_DB[sysKey];
    const isCryo =
      sysKey.startsWith('ref_') ||
      sysKey === 'cl2_gas' ||
      sysKey === 'Cl2' ||
      sysKey === 'CH3Cl' ||
      sysKey === 'HCl' ||
      sysKey === 'COCl2' ||
      sysKey === 'HCHO' ||
      sysKey === 'NH3' ||
      sysKey === 'brine_eg40' ||
      sysKey === 'brine_cacl2_25' ||
      sysKey === 'brine_coolant';
    if (isCryo) {
      return [-45, -35, -25, -15, -5, 10, 25, 45, 65, 85];
    }
    if (
      sysKey === 'MDA' ||
      sysKey === 'MDI' ||
      sysKey === 'PMDI' ||
      sysKey === 'Glycerol' ||
      sysKey === 'glycerol' ||
      sysKey === 'dowtherm_a' ||
      sysKey === 'therminol_66' ||
      (fl?.Tb_C !== undefined && fl.Tb_C > 200)
    ) {
      return [40, 70, 100, 130, 160, 190, 220, 250, 280, 310];
    }
    if (sysKey === 'steam_lp' || sysKey === 'steam_mp' || sysKey === 'steam_hp') {
      return [100, 120, 140, 160, 180, 200, 220, 240, 260, 280];
    }
    return [10, 25, 40, 60, 80, 100, 120, 140, 165, 190];
  }, [sysKey]);

  const sweepRows = useMemo(
    () => sweepTemps.map(t => ({ t, ...calcPropsAt(t, concWt, pressBar) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sweepTemps, sysKey, activeMethodKey, concWt, pressBar, isEn]
  );

  // SVG Plot 포인트 계산
  const chartData = useMemo(() => {
    const metricMeta: Record<PlotMetricKey, { label: string; unit: string; color: string; extract: (r: typeof sweepRows[number]) => number }> = {
      psat: { label: isEn ? 'Vapor Pressure P_sat' : '증기압 P_sat', unit: 'kPa', color: '#2563EB', extract: r => r.psat },
      rho:  { label: isEn ? 'Density ρ' : '밀도 ρ', unit: 'kg/m³', color: '#0F766E', extract: r => r.rho },
      mu:   { label: isEn ? 'Viscosity μ' : '점도 μ', unit: 'cP', color: '#7C3AED', extract: r => r.mu },
      cp:   { label: isEn ? 'Heat Capacity Cp' : '비열 Cp', unit: 'kJ/kg·K', color: '#D97706', extract: r => r.cp },
      k:    { label: isEn ? 'Thermal Cond. λ' : '열전도도 λ', unit: 'W/m·K', color: '#DC2626', extract: r => r.k },
    };
    const meta = metricMeta[plotMetric];
    const rawVals = sweepRows.map(r => ({ t: r.t, val: meta.extract(r) }));
    const minVal = Math.min(...rawVals.map(v => v.val));
    const maxVal = Math.max(...rawVals.map(v => v.val));
    const span = Math.max(1e-9, maxVal - minVal);
    const minT = sweepRows[0]?.t ?? 0;
    const maxT = sweepRows[sweepRows.length - 1]?.t ?? 100;
    const tSpan = Math.max(1, maxT - minT);

    const W = 680;
    const H = 200;
    const padL = 62;
    const padR = 24;
    const padT = 18;
    const padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const points = rawVals.map(p => {
      const x = padL + ((p.t - minT) / tSpan) * plotW;
      const fracY = maxVal === minVal ? 0.5 : (p.val - minVal) / span;
      const y = padT + (1 - fracY) * plotH;
      return { ...p, x, y };
    });

    const curVal = meta.extract({ t: tempC, ...cur });
    const clampedT = Math.max(minT, Math.min(maxT, tempC));
    const curX = padL + ((clampedT - minT) / tSpan) * plotW;
    const curFrac = maxVal === minVal ? 0.5 : Math.max(0, Math.min(1, (curVal - minVal) / span));
    const curY = padT + (1 - curFrac) * plotH;

    return { meta, points, minVal, maxVal, minT, maxT, W, H, padL, padR, padT, padB, plotW, plotH, curX, curY, curVal };
  }, [sweepRows, plotMetric, tempC, cur, isEn]);

  const currentFluidObj = FLUID_DB[sysKey];

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '18px 24px', background: '#F6F7F2', color: '#18181B' }}>
      <div style={{ maxWidth: 1440, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            padding: '15px 20px',
            borderRadius: 10,
            marginBottom: 14,
            background: '#FFFFFF',
            border: '1px solid #DFDCD4',
            borderLeft: '4px solid #1A2F44',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 1px 3px rgba(24,24,27,0.04)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 5,
                  background: '#F1F5F9',
                  border: '1px solid #CBD5E1',
                  color: '#334155',
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                }}
              >
                INTEGRATED PROPERTY DB
              </span>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#1A2F44' }}>
                {isEn
                  ? `Unified Chemical Property DB (${categoryCounts.all} Species) & Thermo Models`
                  : `화학물질 통합 물성 DB (${categoryCounts.all}종) & 열역학 모델`}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#52525B', marginTop: 3 }}>
              {t(
                '화학식 · 물질명 · 약어 · CAS 통합 검색 및 온도·압력별 물성 곡선 (Psat · ρ · μ · Cp · λ)',
                'Search by formula, chemical name, alias, or CAS number and inspect T/P property profiles (Psat · ρ · μ · Cp · λ)'
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link
              href="/unit-equipment"
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                background: '#1A2F44',
                border: '1px solid #1A2F44',
                color: '#FFFFFF',
                textDecoration: 'none',
              }}
            >
              {t('⚡ 단품 숏컷 계산기 →', '⚡ Unit Equipment Sizing →')}
            </Link>
            <Link
              href={returnHref}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                background: '#EFECE5',
                border: '1px solid #1A2F44',
                color: '#1A2F44',
                textDecoration: 'none',
              }}
            >
              {t('← 시뮬레이터로 복귀', '← Back to Simulator')}
            </Link>
          </div>
        </div>

        {/* ── Unified Chemical Database Browser (Live Search + Category Filter Pills) ── */}
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 10,
            marginBottom: 14,
            background: '#FFFFFF',
            border: '1px solid #E5E2DC',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              marginBottom: 10,
            }}
          >
            {/* Unified live search input */}
            <div style={{ flex: '1 1 340px', maxWidth: 520, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t(
                    '화학식 · 물질명 · 약어 · CAS 검색 (예: CHCl3, CFM, 클로로포름, 108-90-7, MDI)',
                    'Search formula, name, alias, or CAS (e.g. CHCl3, CFM, Chloroform, 108-90-7, MDI)'
                  )}
                  style={{
                    width: '100%',
                    height: 36,
                    padding: '0 32px 0 12px',
                    borderRadius: 8,
                    border: '1.5px solid #1A2F44',
                    background: '#F8FAFC',
                    color: '#0F172A',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title={t('검색어 지우기', 'Clear search')}
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      border: 'none',
                      background: '#E2E8F0',
                      color: '#334155',
                      borderRadius: 999,
                      width: 20,
                      height: 20,
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>
              {t('표시 중:', 'Showing:')}{' '}
              <strong style={{ color: '#0F172A' }}>
                {searchResults.elecMatches.length + searchResults.primaryFluids.length}
              </strong>
              {' / '}
              {categoryCounts.all}{isEn ? ' species' : '종'}
            </div>
          </div>

          {/* Quick search sample chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginBottom: 10 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>
              {t('빠른 검색 예시:', 'Quick Examples:')}
            </span>
            {['CFM', 'MCL', 'MCB', 'MDI', 'PMDI', '108-90-7', 'CH3Cl', 'ECH', 'NMP', 'H2O2', 'steam_lp', 'dowtherm_a', 'therminol_66'].map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => setSearchQuery(tag)}
                style={{
                  padding: '2px 7px',
                  borderRadius: 5,
                  border: '1px solid #CBD5E1',
                  background: normalizeSearchText(searchQuery) === normalizeSearchText(tag) ? '#EFF6FF' : '#F8FAFC',
                  color: '#1E293B',
                  fontSize: 10.2,
                  fontWeight: 700,
                  fontFamily: 'JetBrains Mono, monospace',
                  cursor: 'pointer',
                }}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Chemical Category Filter Pills (Monochrome) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            {CATEGORY_FILTERS.map(cat => {
              const active = categoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 999,
                    border: active ? '1px solid #0F172A' : '1px solid #CBD5E1',
                    background: active ? '#0F172A' : '#FFFFFF',
                    color: active ? '#FFFFFF' : '#475569',
                    fontSize: 11,
                    fontWeight: active ? 700 : 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span>{isEn ? cat.labelEn : cat.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      color: active ? '#CBD5E1' : '#64748B',
                      fontFamily: 'monospace',
                    }}
                  >
                    {categoryCounts[cat.id]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Clickable Substance Browser (Clean Monochrome Chips) */}
          <div
            style={{
              maxHeight: searchQuery || categoryFilter !== 'all' ? 240 : 165,
              overflowY: 'auto',
              padding: 8,
              borderRadius: 8,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {searchResults.elecMatches.map(el => {
                const active = sysKey === el.key;
                const elDisplayName = isEn ? el.nameEn : el.name;
                return (
                  <button
                    key={el.key}
                    type="button"
                    onClick={() => handleSubstanceChange(el.key)}
                    title={`${elDisplayName} · CAS ${el.cas}`}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                      background: active ? '#EFF6FF' : '#FFFFFF',
                      color: active ? '#1E3A8A' : '#0F172A',
                      fontSize: 11,
                      fontWeight: active ? 700 : 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{el.formula}</span>
                    <span style={{ color: active ? '#1E3A8A' : '#334155', fontWeight: 500 }}>
                      {elDisplayName.split('(')[0].split('—')[0].trim()}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        padding: '0 4px',
                        borderRadius: 4,
                        border: '1px solid #CBD5E1',
                        color: '#64748B',
                        background: '#F8FAFC',
                        fontFamily: 'monospace',
                      }}
                    >
                      eNRTL
                    </span>
                    <span style={{ color: '#64748B', fontSize: 10, fontFamily: 'monospace' }}>{el.cas}</span>
                  </button>
                );
              })}

              {searchResults.primaryFluids.map(f => {
                const active = sysKey === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => handleSubstanceChange(f.key)}
                    title={`${isEn ? f.name : `${f.nameKo} (${f.name})`}${f.cas ? ` · CAS ${f.cas}` : ''}`}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                      background: active ? '#EFF6FF' : '#FFFFFF',
                      color: active ? '#1E3A8A' : '#0F172A',
                      fontSize: 11,
                      fontWeight: active ? 700 : 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{f.formula || f.key}</span>
                    <span style={{ color: active ? '#1E3A8A' : '#334155', fontWeight: 500 }}>{isEn ? f.name : f.nameKo}</span>
                    {f.cas && <span style={{ color: '#64748B', fontSize: 10, fontFamily: 'monospace' }}>{f.cas}</span>}
                  </button>
                );
              })}

              {searchResults.primaryFluids.length === 0 && searchResults.elecMatches.length === 0 && (
                <div style={{ fontSize: 11.5, color: '#64748B', padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>
                    {isEn
                      ? `No matching items found for "${searchQuery}" under the selected filter.`
                      : `선택한 조건에서 “${searchQuery}” 일치 항목이 없습니다.`}
                  </span>
                  {categoryFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setCategoryFilter('all')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 5,
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#334155',
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {t('전체 카테고리 보기', 'Show All Categories')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 물질 우선 선택(1단계) → 호환 열역학 모델(2단계) → 운전 조건(3단계) ── */}
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 10,
            marginBottom: 16,
            background: '#FFFFFF',
            border: '1px solid #E5E2DC',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: 12,
              marginBottom: 14,
            }}
          >
            {/* [1단계: 물질 먼저 선택] */}
            <div style={{ gridColumn: 'span 2', minWidth: 265 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: '#1A2F44',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 5,
                }}
              >
                <span
                  style={{
                    background: '#1A2F44',
                    color: '#FFFFFF',
                    borderRadius: 4,
                    padding: '1.5px 6px',
                    fontSize: 10,
                    fontWeight: 900,
                  }}
                >
                  {t('1. 물질 선택', '1. Substance')}
                </span>
                {t('계산 대상 화학물질 / 수용액 / 공정가스 / 유틸리티', 'Target Chemical / Solution / Process Gas / Utility')}
              </label>
              <select
                value={sysKey}
                onChange={e => handleSubstanceChange(e.target.value)}
                style={{
                  width: '100%',
                  height: 36,
                  background: '#FFFFFF',
                  color: '#18181B',
                  border: '1.8px solid #1A2F44',
                  borderRadius: 6,
                  padding: '0 10px',
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                <optgroup label={isEn ? `① Electrolyte Aqueous — Adjustable wt% (eNRTL · ${ELECTROLYTE_SYSTEMS.length})` : `① 전해질 수용액 — 농도 wt% 자유 조절 (eNRTL · ${ELECTROLYTE_SYSTEMS.length}종)`}>
                  {ELECTROLYTE_SYSTEMS.map(s => (
                    <option key={s.key} value={s.key}>
                      {isEn ? s.nameEn : s.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={isEn ? `② Electrolyte Aqueous · Acid / Alkali / Salt Presets (${fluidsByCategory.elec.length})` : `② 전해질 수용액 · 산/알칼리/염 프리셋 (${fluidsByCategory.elec.length}종)`}>
                  {fluidsByCategory.elec.map(f => (
                    <option key={f.key} value={f.key}>
                      [{f.formula || f.key}] {isEn ? f.name : `${f.nameKo} (${f.name})`}{f.cas ? ` · CAS ${f.cas}` : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={isEn ? `③ Inorganic & Industrial Gases (${fluidsByCategory.gas.length})` : `③ 무기 · 산업가스 (${fluidsByCategory.gas.length}종)`}>
                  {fluidsByCategory.gas.map(f => (
                    <option key={f.key} value={f.key}>
                      [{f.formula || f.key}] {isEn ? f.name : `${f.nameKo} (${f.name})`}{f.cas ? ` · CAS ${f.cas}` : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={isEn ? `④ Chlorinated & Organic Solvents (${fluidsByCategory.chlor.length})` : `④ 염소화합물 · 유기용매 (${fluidsByCategory.chlor.length}종)`}>
                  {fluidsByCategory.chlor.map(f => (
                    <option key={f.key} value={f.key}>
                      [{f.formula || f.key}] {isEn ? f.name : `${f.nameKo} (${f.name})`}{f.cas ? ` · CAS ${f.cas}` : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={isEn ? `⑤ Aromatics & Isocyanates (${fluidsByCategory.aromatic.length})` : `⑤ 방향족 · 이소시아네이트 (${fluidsByCategory.aromatic.length}종)`}>
                  {fluidsByCategory.aromatic.map(f => (
                    <option key={f.key} value={f.key}>
                      [{f.formula || f.key}] {isEn ? f.name : `${f.nameKo} (${f.name})`}{f.cas ? ` · CAS ${f.cas}` : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={isEn ? `⑥ Alcohols · Ketones · Organic Acids (${fluidsByCategory.alcohol.length})` : `⑥ 알코올 · 케톤 · 유기산 (${fluidsByCategory.alcohol.length}종)`}>
                  {fluidsByCategory.alcohol.map(f => (
                    <option key={f.key} value={f.key}>
                      [{f.formula || f.key}] {isEn ? f.name : `${f.nameKo} (${f.name})`}{f.cas ? ` · CAS ${f.cas}` : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={isEn ? `⑦ Hydrocarbons & Fuels (${fluidsByCategory.hc.length})` : `⑦ 탄화수소 · 연료 (${fluidsByCategory.hc.length}종)`}>
                  {fluidsByCategory.hc.map(f => (
                    <option key={f.key} value={f.key}>
                      [{f.formula || f.key}] {isEn ? f.name : `${f.nameKo} (${f.name})`}{f.cas ? ` · CAS ${f.cas}` : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={isEn ? `⑧ Water · Steam · Thermal Oils · Refrigerants (${fluidsByCategory.utility.length})` : `⑧ 물 · 스팀 · 열매 · 냉매 (${fluidsByCategory.utility.length}종)`}>
                  {fluidsByCategory.utility.map(f => (
                    <option key={f.key} value={f.key}>
                      [{f.formula || f.key}] {isEn ? f.name : `${f.nameKo} (${f.name})`}{f.cas ? ` · CAS ${f.cas}` : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* [2단계: 선택된 물질을 계산할 수 있는 열역학 모델만 출력!] */}
            <div style={{ gridColumn: 'span 2', minWidth: 265 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: '#0F5338',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  marginBottom: 5,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      background: '#0F5338',
                      color: '#FFFFFF',
                      borderRadius: 4,
                      padding: '1.5px 6px',
                      fontSize: 10,
                      fontWeight: 900,
                    }}
                  >
                    {t('2. 열역학 모델', '2. Thermo Model')}
                  </span>
                  {isEn
                    ? `Compatible Models (${compat.compatibleMethods.length})`
                    : `선택 물질 적용 가능 모델 (${compat.compatibleMethods.length}종)`}
                </span>
              </label>
              <select
                value={activeMethodKey}
                onChange={e => setMethodKey(e.target.value as ThermoMethodCode)}
                style={{
                  width: '100%',
                  height: 36,
                  background: '#F0FDF4',
                  color: '#18181B',
                  border: '1.8px solid #0F5338',
                  borderRadius: 6,
                  padding: '0 10px',
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {compat.compatibleMethods.map(mCode => {
                  const m = THERMO_METHODS[mCode];
                  const isRecommended = mCode === compat.defaultMethod;
                  return (
                    <option key={m.code} value={m.code}>
                      {isRecommended ? t('★ [권장] ', '★ [Recommended] ') : t('[호환] ', '[Compatible] ')}
                      {m.code} — {isEn ? m.shortTagEn : m.shortTag}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* [3단계: 온도 / 농도 / 압력 입력] */}
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 5 }}>
                {t('온도 T (°C)', 'Temperature T (°C)')}
              </label>
              <input
                type="number"
                value={tempC}
                step={5}
                onChange={e => setTempC(Number(e.target.value))}
                style={{
                  width: '100%',
                  height: 36,
                  background: '#FFFFFF',
                  color: '#18181B',
                  border: '1px solid #DFDCD4',
                  borderRadius: 6,
                  padding: '0 10px',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 5 }}>
                {compat.allowsConcEdit
                  ? t('농도 C (wt%)', 'Concentration C (wt%)')
                  : compat.fixedOrDefaultWt
                    ? t('표준 농도 (고정)', 'Standard Conc. (Fixed)')
                    : t('순도 (단일성분)', 'Purity (Pure Component)')}
              </label>
              {compat.allowsConcEdit ? (
                <input
                  type="number"
                  value={concWt}
                  step={1}
                  min={1}
                  max={98}
                  onChange={e => setConcWt(Number(e.target.value))}
                  style={{
                    width: '100%',
                    height: 36,
                    background: '#FFFFFF',
                    color: '#18181B',
                    border: '1px solid #DFDCD4',
                    borderRadius: 6,
                    padding: '0 10px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: 36,
                    background: '#F4F4F5',
                    color: '#52525B',
                    border: '1px solid #E4E4E7',
                    borderRadius: 6,
                    padding: '0 10px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {compat.fixedOrDefaultWt
                    ? `${compat.fixedOrDefaultWt.toFixed(0)} ${t('wt% 표준액', 'wt% Std. Soln.')}`
                    : t('100% 순수 성분', '100% Pure Component')}
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 5 }}>
                {t('압력 P (barA)', 'Pressure P (barA)')}
              </label>
              <input
                type="number"
                value={pressBar}
                step={0.2}
                min={0.05}
                onChange={e => setPressBar(Number(e.target.value))}
                style={{
                  width: '100%',
                  height: 36,
                  background: '#FFFFFF',
                  color: '#18181B',
                  border: '1px solid #DFDCD4',
                  borderRadius: 6,
                  padding: '0 10px',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              />
            </div>
          </div>

          {/* 선택된 물질 → 적용 열역학 모델 요약 박스 */}
          <div
            style={{
              padding: '11px 14px',
              borderRadius: 8,
              background: '#F6F7F2',
              border: '1px solid rgba(26, 47, 68, 0.22)',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#1A2F44', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <span>🧪 {t('선택 물질:', 'Selected Substance:')} <span style={{ color: '#0F5338' }}>{selectedSubstanceLabel}</span></span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: '#E2E8F0',
                    color: '#334155',
                    padding: '2px 7px',
                    borderRadius: 999,
                  }}
                >
                  {t('분류:', 'Category:')} {isEn ? compat.categoryLabelEn : compat.categoryLabel}
                </span>
                {currentFluidObj?.cas && (
                  <span style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#475569', background: '#FFFFFF', padding: '2px 7px', borderRadius: 999, border: '1px solid #CBD5E1' }}>
                    CAS {currentFluidObj.cas}
                  </span>
                )}
                {currentFluidObj?.MW && (
                  <span style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#475569', background: '#FFFFFF', padding: '2px 7px', borderRadius: 999, border: '1px solid #CBD5E1' }}>
                    MW {currentFluidObj.MW.toFixed(2)} g/mol
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#0F5338' }}>
                ✓ {t('계산 가능 모델:', 'Compatible Models:')} {compat.compatibleMethods.join(' / ')}
              </div>
            </div>

            {compat.recommendedMaterial && (
              <div style={{ fontSize: 11, color: '#1E3A8A' }}>
                <b>{t('권장 내식 재질:', 'Recommended Corrosion-Resistant Material:')}</b> {isEn ? (compat.recommendedMaterialEn || compat.recommendedMaterial) : compat.recommendedMaterial}
              </div>
            )}

            {!isEn && currentFluidObj?.noteKo && (
              <div style={{ fontSize: 11, color: '#334155' }}>
                <b>공정 비고:</b> {currentFluidObj.noteKo}
              </div>
            )}

            <div style={{ borderTop: '1px dashed #CBD5E1', paddingTop: 5, marginTop: 1 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1A2F44' }}>
                ⚙️ {t('적용 열역학 모델:', 'Applied Thermo Model:')} {method.code} — {isEn ? method.nameEn : method.name}
              </div>
              <div style={{ fontSize: 11, color: '#3F3F46', marginTop: 2 }}>
                <b>{t('특징 및 적용 범위:', 'Scope & Best For:')}</b> {isEn ? method.bestForEn : method.bestFor}
              </div>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#1A2F44', marginTop: 4, fontWeight: 600 }}>
                {t('지배방정식:', 'Governing Eq.:')} {method.eqText} | {t('평형모델:', 'VLE Model:')} {method.vleModel}
              </div>
            </div>
          </div>
        </div>

        {/* Calculated Property KPI Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
          <PropBox label={`${t('밀도', 'Density')} ρ (${tempC}°C · ${pressBar} barA)`} value={`${cur.rho.toFixed(2)} kg/m³`} sub={`${t('상(Phase):', 'Phase:')} ${cur.phase}`} highlight />
          <PropBox label={t('점도 μ (Dynamic Viscosity)', 'Dynamic Viscosity μ')} value={`${cur.mu.toFixed(3)} cP`} sub={`${t('비열', 'Heat Cap.')} Cp: ${cur.cp.toFixed(3)} kJ/kg·K`} />
          <PropBox label={t('열전도도 λ (Thermal Cond.)', 'Thermal Conductivity λ')} value={`${cur.k.toFixed(3)} W/m·K`} sub={`Prandtl: ${((cur.cp * cur.mu) / Math.max(0.005, cur.k)).toFixed(2)}`} />
          <PropBox label={t('포화증기압 P_sat & 열역학 계수', 'Vapor Press. P_sat & Thermo Coeff.')} value={`${cur.psat.toFixed(2)} kPa`} sub={cur.subCoefLabel} />
          {'tSatC' in cur && cur.tSatC !== undefined ? (
            <PropBox
              label={t('포화온도 T_sat(P) & 기화잠열', 'Sat. Temp. T_sat(P) & Latent Heat')}
              value={`${cur.tSatC.toFixed(1)} °C`}
              sub={`${t('잠열', 'Latent Heat')} ΔH_vap: ${(cur.hvap ?? 0).toFixed(1)} kJ/kg · ${
                (cur.superheatC ?? 0) > 0
                  ? `${t('과열도', 'Superheat')} +${(cur.superheatC ?? 0).toFixed(1)}°C`
                  : `${t('과냉도', 'Subcooling')} ${Math.abs(cur.superheatC ?? 0).toFixed(1)}°C`
              }`}
              highlight
            />
          ) : (
            <PropBox
              label={t('끓는점 오름 (BPR) / 정상비점', 'Boiling Point Rise (BPR) / Normal BP')}
              value={sysKey.startsWith('elec_') || currentFluidObj?.isProcessSolution ? `+${cur.bpr.toFixed(2)} °C` : `${(currentFluidObj?.Tb_C ?? 100).toFixed(1)} °C`}
              sub={
                sysKey.startsWith('elec_') || currentFluidObj?.isProcessSolution
                  ? `${t('예상 비점:', 'Est. Boiling Pt.:')} ${(100 + cur.bpr).toFixed(1)} °C`
                  : `${t('임계온도', 'Critical Temp.')} Tc: ${currentFluidObj?.Tc_K ? `${(currentFluidObj.Tc_K - 273.15).toFixed(1)} °C` : 'N/A'}`
              }
              highlight
            />
          )}
        </div>

        {/* Temperature Property Plot (Psat, ρ, μ, Cp, λ) */}
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 10,
            marginBottom: 16,
            background: '#FFFFFF',
            border: '1px solid #E5E2DC',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#1A2F44' }}>
                {t('온도별 물성 프로파일 그래프', 'Temperature-Dependent Property Profile')} — {chartData.meta.label} ({chartData.meta.unit})
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                {selectedSubstanceLabel} · P = {pressBar.toFixed(2)} barA · {t('모델:', 'Model:')} {method.code}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {(
                [
                  { id: 'psat', label: t('Psat (증기압)', 'Psat (Vapor Press.)') },
                  { id: 'rho', label: t('ρ (밀도)', 'ρ (Density)') },
                  { id: 'mu', label: t('μ (점도)', 'μ (Viscosity)') },
                  { id: 'cp', label: t('Cp (비열)', 'Cp (Heat Cap.)') },
                  { id: 'k', label: t('λ (열전도도)', 'λ (Thermal Cond.)') },
                ] as const
              ).map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPlotMetric(m.id)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: plotMetric === m.id ? '1.5px solid #1D4ED8' : '1px solid #CBD5E1',
                    background: plotMetric === m.id ? '#1D4ED8' : '#F8FAFC',
                    color: plotMetric === m.id ? '#FFFFFF' : '#334155',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ width: '100%', overflowX: 'auto' }}>
            <svg
              viewBox={`0 0 ${chartData.W} ${chartData.H}`}
              style={{ width: '100%', maxHeight: 230, display: 'block', background: '#FAFAF9', borderRadius: 8, border: '1px solid #E5E7EB' }}
            >
              {/* Horizontal grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                const y = chartData.padT + frac * chartData.plotH;
                const val = chartData.maxVal - frac * (chartData.maxVal - chartData.minVal);
                return (
                  <g key={frac}>
                    <line
                      x1={chartData.padL}
                      y1={y}
                      x2={chartData.W - chartData.padR}
                      y2={y}
                      stroke="#E5E7EB"
                      strokeDasharray={frac === 1 ? undefined : '3 3'}
                    />
                    <text
                      x={chartData.padL - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      fontSize="9.5"
                      fontFamily="monospace"
                      fill="#64748B"
                    >
                      {val >= 1000 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(3)}
                    </text>
                  </g>
                );
              })}

              {/* X-axis ticks */}
              {chartData.points.map((pt, i) => (
                <g key={pt.t}>
                  <line
                    x1={pt.x}
                    y1={chartData.padT}
                    x2={pt.x}
                    y2={chartData.H - chartData.padB}
                    stroke="#F1F5F9"
                  />
                  {i % 1 === 0 && (
                    <text
                      x={pt.x}
                      y={chartData.H - 10}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontFamily="monospace"
                      fill="#475569"
                    >
                      {pt.t}°C
                    </text>
                  )}
                </g>
              ))}

              {/* Area fill under curve */}
              {chartData.points.length > 1 && (
                <polygon
                  points={`${chartData.points[0].x},${chartData.H - chartData.padB} ${chartData.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} ${chartData.points[chartData.points.length - 1].x},${chartData.H - chartData.padB}`}
                  fill={chartData.meta.color}
                  fillOpacity={0.1}
                />
              )}

              {/* Curve */}
              <polyline
                fill="none"
                stroke={chartData.meta.color}
                strokeWidth="2.5"
                strokeLinejoin="round"
                points={chartData.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              />

              {/* Data points */}
              {chartData.points.map(pt => (
                <circle
                  key={pt.t}
                  cx={pt.x}
                  cy={pt.y}
                  r={3.5}
                  fill="#FFFFFF"
                  stroke={chartData.meta.color}
                  strokeWidth="2"
                >
                  <title>{`${pt.t}°C: ${pt.val.toFixed(3)} ${chartData.meta.unit}`}</title>
                </circle>
              ))}

              {/* Current T marker */}
              <line
                x1={chartData.curX}
                y1={chartData.padT}
                x2={chartData.curX}
                y2={chartData.H - chartData.padB}
                stroke="#0F172A"
                strokeDasharray="4 3"
                strokeWidth="1.2"
              />
              <circle
                cx={chartData.curX}
                cy={chartData.curY}
                r={5.5}
                fill={chartData.meta.color}
                stroke="#0F172A"
                strokeWidth="2"
              />
              <text
                x={Math.min(chartData.W - 110, Math.max(chartData.padL + 6, chartData.curX + 8))}
                y={Math.max(chartData.padT + 14, chartData.curY - 8)}
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
                fill="#0F172A"
              >
                {`${tempC}°C: ${chartData.curVal >= 100 ? chartData.curVal.toFixed(1) : chartData.curVal.toFixed(3)} ${chartData.meta.unit}`}
              </text>
            </svg>
          </div>
        </div>

        {/* Temperature Sweep Table */}
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 10,
            marginBottom: 16,
            background: '#FFFFFF',
            border: '1px solid #E5E2DC',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: '#27272A', marginBottom: 12 }}>
            {t('온도별 물성 변화 테이블', 'Temperature-Dependent Property Table')} ({selectedSubstanceLabel} · {t('적용 모델:', 'Model:')} {method.code} · P = {pressBar.toFixed(2)} barA)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 760 }}>
              <thead>
                <tr style={{ background: '#EFECE5' }}>
                  {[
                    t('온도 T (°C)', 'Temp. T (°C)'),
                    t('상 (Phase)', 'Phase'),
                    t('밀도 ρ (kg/m³)', 'Density ρ (kg/m³)'),
                    t('점도 μ (cP)', 'Viscosity μ (cP)'),
                    t('비열 Cp (kJ/kg·K)', 'Heat Cap. Cp (kJ/kg·K)'),
                    t('열전도도 λ (W/m·K)', 'Thermal Cond. λ (W/m·K)'),
                    t('증기압 P_sat (kPa)', 'Vapor Press. P_sat (kPa)'),
                    sysKey.startsWith('elec_') || currentFluidObj?.isProcessSolution
                      ? t('비점오름 BPR (°C)', 'BPR (°C)')
                      : t('잠열 ΔH_vap (kJ/kg)', 'Latent Heat ΔH_vap (kJ/kg)'),
                  ].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#1A2F44', fontWeight: 700, borderBottom: '1px solid #DFDCD4' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sweepRows.map(p => {
                  const highlight = Math.abs(p.t - tempC) <= 8;
                  return (
                    <tr key={p.t} style={{ background: highlight ? '#EFECE5' : '#FFFFFF', borderBottom: '1px solid #ECEAE4' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 800, color: '#1A2F44' }}>{p.t.toFixed(0)} °C</td>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: p.phase.startsWith('G') ? '#0F5338' : '#0284C7' }}>{p.phase}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{p.rho.toFixed(2)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{p.mu.toFixed(3)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{p.cp.toFixed(3)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{p.k.toFixed(3)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#1A2F44' }}>{p.psat.toFixed(2)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#1A2F44' }}>
                        {sysKey.startsWith('elec_') || currentFluidObj?.isProcessSolution
                          ? `+${p.bpr.toFixed(2)}`
                          : 'hvap' in p && p.hvap !== undefined
                            ? `${p.hvap.toFixed(1)}`
                            : '0.0'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function PropBox({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 8,
        background: highlight ? '#F6F7F2' : '#FFFFFF',
        border: '1px solid #E5E2DC',
        borderLeft: `3px solid ${highlight ? '#1A2F44' : '#A1A1AA'}`,
      }}
    >
      <div style={{ fontSize: 10.5, color: '#52525B', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: highlight ? '#1A2F44' : '#18181B', marginTop: 4, fontFamily: 'monospace' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#71717A', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

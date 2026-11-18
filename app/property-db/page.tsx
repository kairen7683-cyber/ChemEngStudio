'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
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
import { getPlantRegistryItem } from '@/lib/plantRegistry';
import {
  COMP_CATALOG_META,
  getPlantDefaultComponents,
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
type ScopeTab = 'plant' | 'all';
type PlotMetricKey = 'psat' | 'rho' | 'mu' | 'cp' | 'k';

interface ThermoMethodInfo {
  code: ThermoMethodCode;
  name: string;
  shortTag: string;
  bestFor: string;
  eqText: string;
  vleModel: string;
  /** 플로우시트 계산 엔진에 실제 구현·적용된 모델인지 여부 (false = 참고용 설명만 제공) */
  engineApplied: boolean;
}

const THERMO_METHODS: Record<ThermoMethodCode, ThermoMethodInfo> = {
  ELECNRTL: {
    code: 'ELECNRTL',
    name: 'Electrolyte NRTL + Redlich-Kwong EOS (전해질 수용액 표준)',
    shortTag: '강전해질 이온활동도 · 비점오름 표준',
    bestFor: 'NaOH(가성소다), NaCl(브라인), KOH, H₂SO₄(황산), HCl 등 강전해질 수용액의 이온 활동도계수, 비점오름(BPR), 증기압 강하 정밀 계산',
    eqText: 'ln γ_i = ln γ_i^{PDH} (Pitzer-Debye-Hückel 장거리 정전기항) + ln γ_i^{Born} + ln γ_i^{NRTL} (단거리 이온-분자 상호작용항)',
    vleModel: 'Dühring-Pitzer Ion Interaction & Bromley BPR Correlation',
    engineApplied: true,
  },
  NRTL: {
    code: 'NRTL',
    name: 'Non-Random Two-Liquid Activity Model (비이상성 액상 활동도 모델)',
    shortTag: '극성 액체 혼합물 · 공비/LLE 활동도 모델',
    bestFor: '극성 유기물(알코올·케톤·염소계 용제·ECH·MCB·아닐린) 및 수용액의 단거리 분자 상호작용 기반 기액평형(VLE) 및 액-액 분리 계산',
    eqText: 'ln γ_1 = x_2² [ τ_21 (G_21 / (x_1 + x_2 G_21))² + τ_12 G_12 / (x_2 + x_1 G_12)² ],  G_ij = exp(-α_ij τ_ij)',
    vleModel: 'Modified Raoult-NRTL (y_i Φ_i P = x_i γ_i P_i^{sat})',
    engineApplied: true,
  },
  'PENG-ROB': {
    code: 'PENG-ROB',
    name: 'Peng-Robinson Cubic EOS (염소·클로로메탄·탄화수소 상태방정식 표준)',
    shortTag: '염소(Cl₂) · CMS · 탄화수소 · 고압가스 EOS 표준',
    bestFor: '염소(Cl₂) 압축·액화, 클로로메탄(CH₃Cl·CH₂Cl₂·CHCl₃), 탄화수소·방향족·고압 가스의 압축인자(Z)·실제기체 밀도·퓨개시티 계산',
    eqText: 'P = RT/(V_m - b) - a·α(T, ω)/[V_m(V_m + b) + b(V_m - b)],  κ = 0.37464 + 1.54226ω - 0.26992ω²',
    vleModel: 'Equation-of-State Fugacity Equality (φ_i^V = φ_i^L)',
    engineApplied: true,
  },
  SRK: {
    code: 'SRK',
    name: 'Soave-Redlich-Kwong Cubic EOS (수소 · 합성가스 · 경질 탄화수소 상태방정식)',
    shortTag: '수소(H₂) · 합성가스 · 경질 탄화수소 EOS 표준',
    bestFor: '수전해/전해 고압 수소(H₂, Graboski-Daubert 보정), 합성가스(CO·CH₄), 에틸렌·프로필렌 등 경질 올레핀 및 탄화수소 기액평형 정밀 계산',
    eqText: 'P = RT/(V_m - b) - a·α(T)/[V_m(V_m + b)],  α(T) = [1 + (0.480 + 1.574ω - 0.176ω²)(1 - √T_r)]²,  α_{H2} = 1.202 exp(-0.30228 T_r)',
    vleModel: 'Soave-Graboski-Daubert Fugacity Equality (φ_i^V = φ_i^L)',
    engineApplied: true,
  },
  'STEAM-IAPWS': {
    code: 'STEAM-IAPWS',
    name: 'IAPWS-IF97 Industrial Water & Steam Formulation (순수 · 냉각수 · 스팀 유틸리티)',
    shortTag: '스팀(LP/MP/HP) · 냉각수 · 칠드워터 수증기 표준',
    bestFor: '공정 순수(Process Water), 냉각수(CW), 칠드워터(CHW), 저압/중압/고압 가열 스팀 및 응축수 물성 계산',
    eqText: 'g(p, T)/(R·T) = γ^0(π, τ) + γ^r(π, τ)  [IAPWS-IF97 Region 1~4 Gibbs/Helmholtz Energy]',
    vleModel: 'Wagner Pure Water Saturation Pressure Equation',
    engineApplied: false,
  },
};

interface ElectrolyteSystemEntry {
  key: string;
  name: string;
  formula: string;
  cas: string;
  aliases: string[];
  defaultWt: number;
  defaultT: number;
  plants: string[];
}

const ELECTROLYTE_SYSTEMS: ElectrolyteSystemEntry[] = [
  { key: 'elec_naoh',  name: '가성소다 수용액 (NaOH — H₂O, 5~52 wt%)', formula: 'NaOH(aq)', cas: '1310-73-2', aliases: ['NaOH', '가성소다', 'Caustic', 'ENRTL'], defaultWt: 32.0, defaultT: 90.0, plants: ['clorsim', 'clorsim_sim', 'ech_gte', 'cms_plant', 'mdi_plant'] },
  { key: 'elec_nacl',  name: '염화나트륨 브라인 (NaCl — H₂O, 5~26 wt%)', formula: 'NaCl(aq)', cas: '7647-14-5', aliases: ['NaCl', 'Brine', '브라인', '원염', 'ENRTL'], defaultWt: 25.5, defaultT: 70.0, plants: ['clorsim', 'clorsim_sim', 'ech_gte', 'mdi_plant'] },
  { key: 'elec_koh',   name: '수산화칼륨 전해액 (KOH — H₂O, 5~50 wt%)', formula: 'KOH(aq)', cas: '1310-58-3', aliases: ['KOH', '수산화칼륨', 'ENRTL'], defaultWt: 30.0, defaultT: 80.0, plants: ['green_h2'] },
  { key: 'elec_h2so4', name: '황산 건조산 (H₂SO₄ — H₂O, 50~98 wt%)', formula: 'H₂SO₄(aq)', cas: '7664-93-9', aliases: ['H2SO4', '황산', 'Sulfuric Acid', 'ENRTL'], defaultWt: 98.0, defaultT: 35.0, plants: ['clorsim', 'clorsim_sim', 'hcl_synth'] },
  { key: 'elec_hcl',   name: '염산 수용액 (HCl — H₂O, 5~37 wt% · 공비 20.2%)', formula: 'HCl(aq)', cas: '7647-01-0', aliases: ['HCl', '염산', 'PSD', '공비염산', 'ENRTL'], defaultWt: 35.0, defaultT: 40.0, plants: ['clorsim', 'clorsim_sim', 'hcl_synth', 'ech_gte', 'cms_plant', 'mdi_plant'] },
  { key: 'elec_fecl3', name: '[1B] 염화제이철 에칭액 (FeCl₃ — H₂O, 10~45 wt%)', formula: 'FeCl₃(aq)', cas: '7705-08-0', aliases: ['FeCl3', '염화제이철', '에칭액', 'ENRTL'], defaultWt: 40.0, defaultT: 45.0, plants: ['hcl_synth'] },
  { key: 'elec_naocl', name: '[1B] 고농도 차아염소산소다 (NaOCl — H₂O, 5~26 wt%)', formula: 'NaOCl(aq)', cas: '7681-52-9', aliases: ['NaOCl', '차아염소산소다', '하이포', 'ENRTL'], defaultWt: 12.0, defaultT: 22.0, plants: ['clorsim', 'clorsim_sim', 'hcl_synth'] },
];

// ── 물질별 적용 가능 열역학 모델 매핑 ──
interface SubstanceCompatSpec {
  categoryLabel: string;
  compatibleMethods: ThermoMethodCode[];
  defaultMethod: ThermoMethodCode;
  fixedOrDefaultWt?: number;
  allowsConcEdit: boolean;
}

const SUBSTANCE_COMPAT_MAP: Record<string, SubstanceCompatSpec> = {
  // 1) 가변 농도 강전해질 수용액 시스템
  elec_naoh:     { categoryLabel: '강전해질 알칼리 수용액', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 32.0, allowsConcEdit: true },
  elec_nacl:     { categoryLabel: '강전해질 염수(Brine) 수용액', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.5, allowsConcEdit: true },
  elec_koh:      { categoryLabel: '강전해질 수전해 알칼리액', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 30.0, allowsConcEdit: true },
  elec_h2so4:    { categoryLabel: '강산 전해질 수용액 (황산)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 98.0, allowsConcEdit: true },
  elec_hcl:      { categoryLabel: '강산 전해질 수용액 (염산 · 공비계)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 35.0, allowsConcEdit: true },
  elec_fecl3:    { categoryLabel: '[1B] 금속염화물 에칭 재생액 (FeCl₃)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: true },
  elec_naocl:    { categoryLabel: '[1B] 산화성 하이포 수용액 (NaOCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 12.0, allowsConcEdit: true },

  // 2) 레거시 공정 가스 & 유틸리티
  cl2_gas:       { categoryLabel: '압축·액화성 할로겐 공정가스', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ahcl_gas:      { categoryLabel: '[1A] 반도체 5N 무수염화수소 가스 (AHCl)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  h2_gas:        { categoryLabel: '경질 비응축성 공정가스 (수소)', compatibleMethods: ['SRK', 'PENG-ROB'], defaultMethod: 'SRK', allowsConcEdit: false },
  n2_gas:        { categoryLabel: '불활성 퍼지 산업가스 (질소)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  nitrogen_air:  { categoryLabel: '공용 유틸리티 · 질소 퍼지 / 계장공기', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  air:           { categoryLabel: '공용 유틸리티 · 계장/공정 압축공기', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },

  // 3) 순수 · 냉각수 · 칠드워터 · 스팀 유틸리티
  process_water: { categoryLabel: '공용 유틸리티 · 순수/공정수 계통', compatibleMethods: ['STEAM-IAPWS', 'NRTL'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  cooling_water: { categoryLabel: '공용 유틸리티 · 냉각수(CW) 계통', compatibleMethods: ['STEAM-IAPWS', 'NRTL'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  chilled_water: { categoryLabel: '공용 유틸리티 · 칠드워터(CHW) 계통', compatibleMethods: ['STEAM-IAPWS', 'NRTL'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  steam_lp:      { categoryLabel: '공용 유틸리티 · 저압 스팀 (LP Steam)', compatibleMethods: ['STEAM-IAPWS', 'PENG-ROB'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  steam_mp:      { categoryLabel: '공용 유틸리티 · 중압 스팀 (MP Steam)', compatibleMethods: ['STEAM-IAPWS', 'PENG-ROB'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  steam_hp:      { categoryLabel: '공용 유틸리티 · 고압 스팀 (HP Steam)', compatibleMethods: ['STEAM-IAPWS', 'PENG-ROB'], defaultMethod: 'STEAM-IAPWS', allowsConcEdit: false },
  dowtherm_a:    { categoryLabel: '공용 유틸리티 · 고온 열매유 (Dowtherm A)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  brine_coolant: { categoryLabel: '공용 유틸리티 · 심냉 브라인 (-20°C)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },

  // 4) 전해공장 표준 농도 공정액
  brine_25:      { categoryLabel: '전해공장 표준 브라인 (25 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },
  brine_15:      { categoryLabel: '전해공장 희박 브라인 (15 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 15.0, allowsConcEdit: false },
  brine_fed:     { categoryLabel: '전해공장 정제 브라인 (26 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 26.0, allowsConcEdit: false },
  naoh_32:       { categoryLabel: '전해공장 표준 가성소다 (32 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 32.0, allowsConcEdit: false },
  naoh_50:       { categoryLabel: '농축 제품 가성소다 (50 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 50.0, allowsConcEdit: false },
  h2so4_60:      { categoryLabel: 'No.1 염소건조탑 황산 (60 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 60.0, allowsConcEdit: false },
  h2so4_91:      { categoryLabel: 'No.2 염소건조탑 황산 (91 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 91.0, allowsConcEdit: false },
  h2so4_94:      { categoryLabel: 'No.3 염소건조탑 황산 (94 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 94.0, allowsConcEdit: false },
  h2so4_98:      { categoryLabel: '진한 보충 황산 (98 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 98.0, allowsConcEdit: false },
  hcl_31:        { categoryLabel: '합성 염산 표준액 (31 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 31.0, allowsConcEdit: false },
  catholyte:     { categoryLabel: '전해조 음극 순환액 (33 wt% NaOH)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 33.0, allowsConcEdit: false },
  anolyte:       { categoryLabel: '전해조 양극 탈염액 (16 wt% NaCl)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 16.0, allowsConcEdit: false },

  // 5) 냉매 및 심냉 브라인
  ref_r134a:      { categoryLabel: 'HFC 표준 냉매 (칠러·중온 액화)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r404a:      { categoryLabel: 'HFC 혼합 심냉 냉매 (염소 액화기)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r507a:      { categoryLabel: 'HFC 공비 심냉 냉매 (Glide 0°C)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r410a:      { categoryLabel: 'HFC 고압 냉동기 냉매', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r22:        { categoryLabel: 'HCFC 화학플랜트 표준 액화 냉매', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r32:        { categoryLabel: '저GWP 단일성분 고효율 냉매', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r1234yf:    { categoryLabel: '차세대 친환경 초저GWP HFO 냉매', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r1234ze:    { categoryLabel: '친환경 터보칠러·히트펌프 HFO 냉매', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r717:       { categoryLabel: '자연냉매 암모니아 (대용량 산업냉동)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r1270:      { categoryLabel: '탄화수소 심냉 냉매 (프로필렌)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ref_r744:       { categoryLabel: '자연냉매 이산화탄소 (초저온 캐스케이드)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  brine_eg40:     { categoryLabel: '2차 간접 냉매 브라인 (에틸렌글리콜 40 wt%)', compatibleMethods: ['NRTL', 'ELECNRTL'], defaultMethod: 'NRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: false },
  brine_cacl2_25: { categoryLabel: '2차 심냉 염화칼슘 브라인 (25 wt% CaCl₂)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },

  // 6) 1A / 1B / 2순위 레거시 프리셋
  ahcl_liq:      { categoryLabel: '[1A] 고압 액화 무수염산 (Liquid AHCl)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  hcl_35_up:     { categoryLabel: '[1A] 반도체 초고순도 염산 (35 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 35.0, allowsConcEdit: false },
  hcl_20_azeo:   { categoryLabel: '[1A] 폐염산 공비조성액 (20.2 wt% · PSD 회수)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 20.2, allowsConcEdit: false },
  naocl_12:      { categoryLabel: '[1B] 차아염소산소다 표준액 (12 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 12.0, allowsConcEdit: false },
  naocl_25_hs:   { categoryLabel: '[1B] 고농도 저염 차아염소산소다 (25 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },
  naclo3_40:     { categoryLabel: '[1B] 염소산소다 부반응 수용액 (40 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: false },
  fecl2_28:      { categoryLabel: '[1B] 염화제일철 에칭 폐액 (28 wt% FeCl₂)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 28.0, allowsConcEdit: false },
  fecl3_40:      { categoryLabel: '[1B] 염화제이철 재생 에칭액 (40 wt% FeCl₃)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: false },
  pac_17:        { categoryLabel: '[1B] 폴리염화알루미늄 수처리제 (PAC 17%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 17.0, allowsConcEdit: false },
  glycerol:      { categoryLabel: '[ECH] 정제 글리세린 원료 (NRTL 비이상계)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  mch_3:         { categoryLabel: '[ECH] 모노클로로히드린 중간체 (3-MCH)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  dch_13:        { categoryLabel: '[ECH] 1,3-디클로로히드린 (비누화 원료)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  ech_pure:      { categoryLabel: '[ECH] 에피클로로히드린 (물 불균일공비 88°C)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  dcp_12:        { categoryLabel: '[ECH] 1,2-디클로로프로판 경질불순물', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  acetic_cat:    { categoryLabel: '[ECH] 빙초산 GTE 염소화 촉매', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  aibn_initiator:{ categoryLabel: '[CMS] AIBN 라디칼 개시제', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
};

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
      compatibleMethods: mapped.length > 0 ? mapped : ['NRTL', 'PENG-ROB'],
      defaultMethod: mapped[0] ?? 'NRTL',
      allowsConcEdit: false,
    };
  }
  return {
    categoryLabel: fl?.familyLabelKo ?? '일반 공정 유체',
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
]);

export default function PropertyDbPage() {
  const { balance, activePlantId, lastPlantReturnHref } = useBalanceStore();
  const plantMeta = getPlantRegistryItem(activePlantId);

  const [scopeTab, setScopeTab] = useState<ScopeTab>('plant');
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
    if (el) return el.name;
    const fl = FLUID_DB[sysKey];
    if (!fl) return sysKey;
    const fStr = fl.formula ? ` [${fl.formula}]` : '';
    return `${fl.nameKo}${fStr} (${fl.name})`;
  }, [sysKey]);

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
        } else if (newKey === 'dowtherm_a') {
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

  // 현재 공장의 기본 성분 (SIM_COMPS) + 유틸리티 + 전 DB 분류
  const plantDefaultSimKeys = useMemo(() => {
    const keys = getPlantDefaultComponents(activePlantId);
    return new Set<SimCompKey>(keys);
  }, [activePlantId]);

  const plantProcessFluids = useMemo<FluidProps[]>(
    () =>
      SIM_COMPS.filter(k => plantDefaultSimKeys.has(k))
        .map(k => FLUID_DB[k])
        .filter((f): f is FluidProps => Boolean(f)),
    [plantDefaultSimKeys]
  );

  const allSimCompFluids = useMemo<FluidProps[]>(
    () =>
      SIM_COMPS.map(k => FLUID_DB[k]).filter((f): f is FluidProps => Boolean(f)),
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

  const visibleElectrolyteSystems = useMemo(() => {
    if (scopeTab === 'all') return ELECTROLYTE_SYSTEMS;
    const filtered = ELECTROLYTE_SYSTEMS.filter(s => s.plants.includes(activePlantId));
    return filtered.length > 0 ? filtered : ELECTROLYTE_SYSTEMS;
  }, [scopeTab, activePlantId]);

  const visibleProcessSolutions = useMemo(() => {
    if (scopeTab === 'all') return processSolutionFluids;
    if (activePlantId === 'clorsim' || activePlantId === 'clorsim_sim') {
      return processSolutionFluids.filter(f => !f.downstreamGroup || f.downstreamGroup === '1B_INORG');
    }
    if (activePlantId === 'hcl_synth') {
      return processSolutionFluids.filter(f => f.downstreamGroup === '1A_HCL' || f.downstreamGroup === '1B_INORG' || f.key === 'hcl_31');
    }
    if (activePlantId === 'ech_gte') {
      return processSolutionFluids.filter(f => f.key === 'naoh_32' || f.key === 'hcl_31');
    }
    if (activePlantId === 'cms_plant' || activePlantId === 'mdi_plant') {
      return processSolutionFluids.filter(f => f.key === 'naoh_32' || f.key === 'hcl_31' || f.key === 'ahcl_liq');
    }
    return processSolutionFluids;
  }, [scopeTab, activePlantId, processSolutionFluids]);

  // 통합 검색 풀 (중복 레거시 alias 제거된 깔끔한 대표 목록)
  const scopedPrimaryFluids = useMemo<FluidProps[]>(() => {
    if (scopeTab === 'all') {
      return [...allSimCompFluids, ...utilityFluids, ...processSolutionFluids];
    }
    return [...plantProcessFluids, ...utilityFluids, ...visibleProcessSolutions];
  }, [scopeTab, allSimCompFluids, utilityFluids, processSolutionFluids, plantProcessFluids, visibleProcessSolutions]);

  const otherSimCompFluids = useMemo<FluidProps[]>(
    () => allSimCompFluids.filter(f => !plantDefaultSimKeys.has(f.simCompKey!)),
    [allSimCompFluids, plantDefaultSimKeys]
  );

  const searchResults = useMemo(() => {
    const q = normalizeSearchText(searchQuery);
    if (!q) {
      return {
        primaryFluids: scopedPrimaryFluids,
        elecMatches: visibleElectrolyteSystems,
        extraFullDbFluids: [] as FluidProps[],
      };
    }
    const primaryFluids = searchFluidProps(searchQuery, scopedPrimaryFluids);
    const elecMatches = ELECTROLYTE_SYSTEMS.filter(s => {
      const pool = [s.key, s.name, s.formula, s.cas, ...s.aliases];
      return pool.some(v => normalizeSearchText(v).includes(q));
    });

    const primaryKeySet = new Set(primaryFluids.map(f => f.key));
    const extraFullDbFluids =
      scopeTab === 'plant'
        ? searchFluidProps(searchQuery, [...otherSimCompFluids, ...processSolutionFluids]).filter(
            f => !primaryKeySet.has(f.key)
          )
        : [];

    return { primaryFluids, elecMatches, extraFullDbFluids };
  }, [searchQuery, scopedPrimaryFluids, visibleElectrolyteSystems, scopeTab, otherSimCompFluids, processSolutionFluids]);

  // 활성 공장 변경 시 기본 탭 및 대표 물질 동기화
  useEffect(() => {
    if (activePlantId === 'new_builder' || activePlantId === 'classic_sim') {
      setScopeTab('all');
      return;
    }
    setScopeTab('plant');
    if (activePlantId === 'clorsim' || activePlantId === 'clorsim_sim') {
      handleSubstanceChange('elec_naoh');
    } else if (activePlantId === 'hcl_synth') {
      handleSubstanceChange('elec_hcl');
    } else if (activePlantId === 'ech_gte') {
      handleSubstanceChange('ECH');
    } else if (activePlantId === 'cms_plant') {
      handleSubstanceChange('CH2Cl2');
    } else if (activePlantId === 'mdi_plant') {
      handleSubstanceChange('MDI');
    } else if (activePlantId === 'green_h2') {
      handleSubstanceChange('elec_koh');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlantId]);

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
        return { rho, mu, cp, k, bpr, gamma, psat, phase: 'L (전해질 수용액)', subCoefLabel: `활동도계수 γ± = ${gamma.toFixed(3)}` };
      }
      if (sysKey === 'elec_nacl') {
        const rho = 998 + 740 * w - 0.42 * (T - 20);
        const mu = Math.max(0.25, 0.90 * Math.exp(2.1 * w - 0.019 * (T - 25)));
        const cp = 4.184 * (1 - 0.42 * w);
        const k = 0.59 * (1 - 0.08 * w) + 0.001 * (T - 25);
        const bpr = (0.18 * wt + 0.0065 * wt * wt) * nrtlFactor;
        const gamma = isNrtlApprox ? 0.82 + 0.55 * w : 0.72 + 0.85 * w;
        const psat = psat_water_kPa * (1 - 0.62 * w * nrtlFactor);
        return { rho, mu, cp, k, bpr, gamma, psat, phase: 'L (브라인 염수)', subCoefLabel: `활동도계수 γ± = ${gamma.toFixed(3)}` };
      }
      const rho = 1000 + 890 * w - 0.50 * (T - 20);
      const mu = Math.max(0.28, 1.05 * Math.exp(3.2 * w - 0.020 * (T - 25)));
      const cp = 4.184 * (1 - 0.38 * w);
      const k = 0.58 * (1 - 0.15 * w);
      const bpr = (0.21 * wt + 0.0095 * wt * wt) * nrtlFactor;
      const gamma = isNrtlApprox ? 0.85 + 0.80 * w : 0.78 + 1.15 * w;
      const psat = psat_water_kPa * Math.max(0.04, 1 - 0.85 * w * nrtlFactor);
      return { rho, mu, cp, k, bpr, gamma, psat, phase: 'L (전해질 수용액)', subCoefLabel: `활동도계수 γ± = ${gamma.toFixed(3)}` };
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
          phase: `초임계 (Supercritical · Z=${Z.toFixed(3)})`,
          subCoefLabel: `임계점 초과 (Tc=${Tc_C.toFixed(1)}°C, Pc=${crit.Pc_bar.toFixed(1)} bar)`,
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
          phase: `L (과냉각 액상 · 과냉 ${Math.abs(deltaT_SH).toFixed(1)}°C)`,
          subCoefLabel: `포화 T_sat=${tSatAtP_C.toFixed(1)}°C · 잠열 ΔHv=${hvapAtT.toFixed(0)} kJ/kg`,
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
        phase: `G (과열 증기 · 과열 +${Math.max(0, deltaT_SH).toFixed(1)}°C · Z=${Z.toFixed(3)})`,
        subCoefLabel: `포화 T_sat=${tSatAtP_C.toFixed(1)}°C · 잠열 ΔHv=${hvapAtT.toFixed(0)} kJ/kg`,
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
        phase: isSteam ? `G (수증기 Steam · Z=${Z.toFixed(3)})` : 'L (액상 물)',
        subCoefLabel: `IAPWS 포화 T_sat=${(Number.isFinite(tSatAtP_C) ? tSatAtP_C : 100).toFixed(1)}°C · Tc=${(crit.Tc_K - 273.15).toFixed(1)}°C`,
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
        phase: 'L (표준 공정액)',
        subCoefLabel: `활동도계수 γ± = ${gamma.toFixed(3)} · 표준농도 ${wt.toFixed(1)} wt%`,
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
        phase: simKey === 'H2SO4' ? 'L (고비점 무기산)' : 'S / L (비휘발성 무기성분)',
        subCoefLabel: `비휘발성 순수 성분 · 정상비점 ${(fl.Tb_C ?? 300).toFixed(0)}°C · MW=${mw.toFixed(2)}`,
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
          ? `초임계 (Supercritical · Z=${Z.toFixed(3)})`
          : `G (초임계 기체 · Z=${Z.toFixed(3)})`,
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
          ? `L (유기액상 · Tb=${(tSatC ?? tb_C).toFixed(1)}°C)`
          : `L (액상 · Tb=${(tSatC ?? tb_C).toFixed(1)}°C)`,
        subCoefLabel: `비점(@P) ${(tSatC ?? tb_C).toFixed(1)}°C · ΔHv=${hvapAtT.toFixed(0)} kJ/kg · MW=${mw.toFixed(2)}`,
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
      phase: `G (기상 · Z=${Z.toFixed(3)})`,
      subCoefLabel: `압축인자 Z=${Z.toFixed(3)} · φ=${phi.toFixed(3)} · Tb=${(tSatC ?? tb_C).toFixed(1)}°C`,
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
    [sweepTemps, sysKey, activeMethodKey, concWt, pressBar]
  );

  // SVG Plot 포인트 계산
  const chartData = useMemo(() => {
    const metricMeta: Record<PlotMetricKey, { label: string; unit: string; color: string; extract: (r: typeof sweepRows[number]) => number }> = {
      psat: { label: '증기압 P_sat', unit: 'kPa', color: '#2563EB', extract: r => r.psat },
      rho:  { label: '밀도 ρ', unit: 'kg/m³', color: '#0F766E', extract: r => r.rho },
      mu:   { label: '점도 μ', unit: 'cP', color: '#7C3AED', extract: r => r.mu },
      cp:   { label: '비열 Cp', unit: 'kJ/kg·K', color: '#D97706', extract: r => r.cp },
      k:    { label: '열전도도 λ', unit: 'W/m·K', color: '#DC2626', extract: r => r.k },
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
  }, [sweepRows, plotMetric, tempC, cur]);

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
                  background: plantMeta.accentSoftBg,
                  border: `1px solid ${plantMeta.accentBorder}`,
                  color: plantMeta.accent,
                  fontSize: 10.5,
                  fontWeight: 800,
                }}
              >
                {plantMeta.code} · {plantMeta.shortLabel} 연동
              </span>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#1A2F44' }}>
                화학물질 물성 DB ({SIM_COMPS.length}종 공정성분 + 유틸리티 전 물질 개방) &amp; 열역학 모델
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#52525B', marginTop: 3 }}>
              화학식 · 물질명 · 약어 · CAS 통합 검색 및 온도별 물성 곡선 (Psat · ρ · μ · Cp · λ) — 모든 계정 전 물질 열람 가능
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
              ⚡ 단품 숏컷 계산기 →
            </Link>
            <Link
              href={lastPlantReturnHref || plantMeta.defaultHref}
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
              ← [{plantMeta.code}] 공정 화면으로 복귀
            </Link>
          </div>
        </div>

        {/* ── 2-Tab Scope Filter & Unified Live Search Bar ── */}
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
              marginBottom: 12,
            }}
          >
            {/* 2-tab scope switcher */}
            <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setScopeTab('plant')}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: scopeTab === 'plant' ? '1.8px solid #1D4ED8' : '1px solid #CBD5E1',
                  background: scopeTab === 'plant' ? '#EFF6FF' : '#F8FAFC',
                  color: scopeTab === 'plant' ? '#1E3A8A' : '#475569',
                  fontSize: 12,
                  fontWeight: scopeTab === 'plant' ? 900 : 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>내 공장 물질 + 공용 유틸리티</span>
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: scopeTab === 'plant' ? '#1D4ED8' : '#E2E8F0',
                    color: scopeTab === 'plant' ? '#FFFFFF' : '#334155',
                  }}
                >
                  {plantProcessFluids.length} + {utilityFluids.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScopeTab('all')}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: scopeTab === 'all' ? '1.8px solid #0F766E' : '1px solid #CBD5E1',
                  background: scopeTab === 'all' ? '#F0FDFA' : '#F8FAFC',
                  color: scopeTab === 'all' ? '#0F766E' : '#475569',
                  fontSize: 12,
                  fontWeight: scopeTab === 'all' ? 900 : 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>전체 시뮬레이션 물성 DB (전 물질 개방)</span>
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: scopeTab === 'all' ? '#0F766E' : '#E2E8F0',
                    color: scopeTab === 'all' ? '#FFFFFF' : '#334155',
                  }}
                >
                  {allSimCompFluids.length + utilityFluids.length + processSolutionFluids.length}종
                </span>
              </button>
            </div>

            {/* Unified live search input */}
            <div style={{ flex: '1 1 310px', maxWidth: 460, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="화학식 · 물질명 · 약어 · CAS 검색 (예: CHCl3, CFM, 클로로포름, 108-90-7, MDI)"
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
                    title="검색어 지우기"
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
          </div>

          {/* Quick search sample chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginBottom: 10 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>빠른 검색 예시:</span>
            {['CFM', 'MCL', 'MCB', 'MDI', 'PMDI', '108-90-7', 'CH3Cl', 'ECH', 'steam_lp', 'dowtherm_a'].map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => setSearchQuery(tag)}
                style={{
                  padding: '2px 7px',
                  borderRadius: 5,
                  border: '1px solid #CBD5E1',
                  background: normalizeSearchText(searchQuery) === normalizeSearchText(tag) ? '#DBEAFE' : '#F8FAFC',
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

          {/* Clickable Substance Browser */}
          <div
            style={{
              maxHeight: searchQuery ? 240 : 145,
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
                return (
                  <button
                    key={el.key}
                    type="button"
                    onClick={() => handleSubstanceChange(el.key)}
                    style={{
                      padding: '5px 9px',
                      borderRadius: 6,
                      border: active ? '1.8px solid #0F766E' : '1px solid #CBD5E1',
                      background: active ? '#CCFBF1' : '#FFFFFF',
                      color: '#0F172A',
                      fontSize: 11,
                      fontWeight: active ? 900 : 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#0F766E', color: '#FFFFFF', fontWeight: 800 }}>
                      ENRTL 수용액
                    </span>
                    <span>{el.formula}</span>
                    <span style={{ color: '#475569', fontSize: 10 }}>({el.cas})</span>
                  </button>
                );
              })}

              {searchResults.primaryFluids.map(f => {
                const active = sysKey === f.key;
                const badgeInfo = f.isUtility
                  ? { label: '공용 유틸리티', bg: '#0E7490', text: '#FFFFFF' }
                  : f.isProcessSolution
                    ? { label: '표준 공정액', bg: '#64748B', text: '#FFFFFF' }
                    : { label: '공정 물질', bg: '#1D4ED8', text: '#FFFFFF' };
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => handleSubstanceChange(f.key)}
                    title={`${f.nameKo} (${f.name})${f.cas ? ` · CAS ${f.cas}` : ''}`}
                    style={{
                      padding: '5px 9px',
                      borderRadius: 6,
                      border: active ? `1.8px solid ${badgeInfo.bg}` : '1px solid #CBD5E1',
                      background: active ? '#EFF6FF' : '#FFFFFF',
                      color: '#0F172A',
                      fontSize: 11,
                      fontWeight: active ? 900 : 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: badgeInfo.bg, color: badgeInfo.text, fontWeight: 800 }}>
                      {badgeInfo.label}
                    </span>
                    <span>{f.formula || f.key}</span>
                    <span style={{ color: '#334155' }}>{f.nameKo}</span>
                    {f.cas && <span style={{ color: '#64748B', fontSize: 10, fontFamily: 'monospace' }}>{f.cas}</span>}
                  </button>
                );
              })}

              {searchResults.primaryFluids.length === 0 && searchResults.elecMatches.length === 0 && (
                <div style={{ fontSize: 11.5, color: '#64748B', padding: '4px 6px' }}>
                  현재 범위({scopeTab === 'plant' ? '내 공장 물질 + 공용 유틸리티' : '전체 DB'})에서 &ldquo;{searchQuery}&rdquo; 일치 항목이 없습니다.
                </div>
              )}
            </div>

            {/* Cross-DB matches when searching in plant-scoped tab */}
            {scopeTab === 'plant' && searchQuery.trim() && searchResults.extraFullDbFluids.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #CBD5E1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#B45309' }}>
                    🔍 타 공정 · 전체 시뮬레이션 DB 추가 검색 결과 ({searchResults.extraFullDbFluids.length}건)
                  </span>
                  <button
                    type="button"
                    onClick={() => setScopeTab('all')}
                    style={{
                      padding: '3px 9px',
                      borderRadius: 5,
                      border: '1px solid #0F766E',
                      background: '#F0FDFA',
                      color: '#0F766E',
                      fontSize: 10.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    전체 시뮬레이션 물성 DB 탭으로 전환 →
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {searchResults.extraFullDbFluids.map(f => {
                    const active = sysKey === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => handleSubstanceChange(f.key)}
                        style={{
                          padding: '5px 9px',
                          borderRadius: 6,
                          border: active ? '1.8px solid #B45309' : '1px solid #FCD34D',
                          background: active ? '#FEF3C7' : '#FFFBEB',
                          color: '#0F172A',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#B45309', color: '#FFFFFF', fontWeight: 800 }}>
                          전체 DB
                        </span>
                        <span>{f.formula || f.key}</span>
                        <span>{f.nameKo}</span>
                        {f.cas && <span style={{ color: '#78350F', fontSize: 10, fontFamily: 'monospace' }}>{f.cas}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
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
                  1. 물질 선택
                </span>
                계산 대상 화학물질 / 수용액 / 공정가스 / 유틸리티
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
                {scopeTab === 'plant' ? (
                  <>
                    <optgroup label={`① 내 공장 공정물질 (${plantMeta.code} · ${plantProcessFluids.length}종)`}>
                      {plantProcessFluids.map(f => (
                        <option key={f.key} value={f.key}>
                          [{f.formula || f.key}] {f.nameKo} ({f.name}){f.cas ? ` · CAS ${f.cas}` : ''}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={`② 공용 유틸리티 (스팀 · 냉각수 · 칠드워터 · 브라인 · 열매유 · 냉매 ${utilityFluids.length}종)`}>
                      {utilityFluids.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.nameKo} ({f.name})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="③ 내 공장 전해질 수용액 (농도 wt% 자유 조절)">
                      {visibleElectrolyteSystems.map(s => (
                        <option key={s.key} value={s.key}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                    {visibleProcessSolutions.length > 0 && (
                      <optgroup label="④ 표준 농도 공정액 프리셋">
                        {visibleProcessSolutions.map(f => (
                          <option key={f.key} value={f.key}>
                            {f.nameKo} ({f.name})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {!plantProcessFluids.some(f => f.key === sysKey) &&
                      !utilityFluids.some(f => f.key === sysKey) &&
                      !visibleElectrolyteSystems.some(s => s.key === sysKey) &&
                      !visibleProcessSolutions.some(f => f.key === sysKey) &&
                      currentFluidObj && (
                        <optgroup label="⑤ 검색 선택 물질 (전체 시뮬레이션 DB)">
                          <option value={currentFluidObj.key}>
                            [{currentFluidObj.formula || currentFluidObj.key}] {currentFluidObj.nameKo} ({currentFluidObj.name})
                          </option>
                        </optgroup>
                      )}
                  </>
                ) : (
                  <>
                    <optgroup label={`① 내 공장 공정물질 (${plantMeta.code} · ${plantProcessFluids.length}종)`}>
                      {plantProcessFluids.map(f => (
                        <option key={f.key} value={f.key}>
                          [{f.formula || f.key}] {f.nameKo} ({f.name}){f.cas ? ` · CAS ${f.cas}` : ''}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={`② 공용 유틸리티 (스팀 · 냉각수 · 칠드워터 · 브라인 · 열매유 · 냉매 ${utilityFluids.length}종)`}>
                      {utilityFluids.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.nameKo} ({f.name})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={`③ 기타 전체 시뮬레이션 성분 (${otherSimCompFluids.length}종 · 77종 SIM_COMPS 완비)`}>
                      {otherSimCompFluids.map(f => (
                        <option key={f.key} value={f.key}>
                          [{f.formula || f.key}] {f.nameKo} ({f.name}){f.cas ? ` · CAS ${f.cas}` : ''}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="④ 전해질 수용액 (농도 wt% 자유 조절)">
                      {ELECTROLYTE_SYSTEMS.map(s => (
                        <option key={s.key} value={s.key}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="⑤ 표준 농도 공정액 (전해 · 1A · 1B 프리셋)">
                      {processSolutionFluids.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.nameKo} ({f.name})
                        </option>
                      ))}
                    </optgroup>
                  </>
                )}
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
                    2. 열역학 모델
                  </span>
                  선택 물질 적용 가능 모델 ({compat.compatibleMethods.length}종)
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
                      {isRecommended ? '★ [권장] ' : '[호환] '}
                      {m.code} — {m.shortTag}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* [3단계: 온도 / 농도 / 압력 입력] */}
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 5 }}>
                온도 T (°C)
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
                {compat.allowsConcEdit ? '농도 C (wt%)' : compat.fixedOrDefaultWt ? '표준 농도 (고정)' : '순도 (단일성분)'}
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
                  {compat.fixedOrDefaultWt ? `${compat.fixedOrDefaultWt.toFixed(0)} wt% 표준액` : '100% 순수 성분'}
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 5 }}>
                압력 P (barA)
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
                <span>🧪 선택 물질: <span style={{ color: '#0F5338' }}>{selectedSubstanceLabel}</span></span>
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
                  분류: {compat.categoryLabel}
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
                ✓ 계산 가능 모델: {compat.compatibleMethods.join(' / ')}
              </div>
            </div>

            {currentFluidObj?.noteKo && (
              <div style={{ fontSize: 11, color: '#334155' }}>
                <b>공정 비고:</b> {currentFluidObj.noteKo}
              </div>
            )}

            <div style={{ borderTop: '1px dashed #CBD5E1', paddingTop: 5, marginTop: 1 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1A2F44' }}>
                ⚙️ 적용 열역학 모델: {method.code} — {method.name}
              </div>
              <div style={{ fontSize: 11, color: '#3F3F46', marginTop: 2 }}>
                <b>특징 및 적용 범위:</b> {method.bestFor}
              </div>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#1A2F44', marginTop: 4, fontWeight: 600 }}>
                지배방정식: {method.eqText} | 평형모델: {method.vleModel}
              </div>
            </div>
          </div>
        </div>

        {/* Calculated Property KPI Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
          <PropBox label={`밀도 ρ (${tempC}°C · ${pressBar} barA)`} value={`${cur.rho.toFixed(2)} kg/m³`} sub={`상(Phase): ${cur.phase}`} highlight />
          <PropBox label="점도 μ (Dynamic Viscosity)" value={`${cur.mu.toFixed(3)} cP`} sub={`비열 Cp: ${cur.cp.toFixed(3)} kJ/kg·K`} />
          <PropBox label="열전도도 λ (Thermal Cond.)" value={`${cur.k.toFixed(3)} W/m·K`} sub={`Prandtl: ${((cur.cp * cur.mu) / Math.max(0.005, cur.k)).toFixed(2)}`} />
          <PropBox label="포화증기압 P_sat & 열역학 계수" value={`${cur.psat.toFixed(2)} kPa`} sub={cur.subCoefLabel} />
          {'tSatC' in cur && cur.tSatC !== undefined ? (
            <PropBox
              label="포화온도 T_sat(P) & 기화잠열"
              value={`${cur.tSatC.toFixed(1)} °C`}
              sub={`잠열 ΔH_vap: ${(cur.hvap ?? 0).toFixed(1)} kJ/kg · ${
                (cur.superheatC ?? 0) > 0
                  ? `과열도 +${(cur.superheatC ?? 0).toFixed(1)}°C`
                  : `과냉도 ${Math.abs(cur.superheatC ?? 0).toFixed(1)}°C`
              }`}
              highlight
            />
          ) : (
            <PropBox
              label="끓는점 오름 (BPR) / 정상비점"
              value={sysKey.startsWith('elec_') || currentFluidObj?.isProcessSolution ? `+${cur.bpr.toFixed(2)} °C` : `${(currentFluidObj?.Tb_C ?? 100).toFixed(1)} °C`}
              sub={
                sysKey.startsWith('elec_') || currentFluidObj?.isProcessSolution
                  ? `예상 비점: ${(100 + cur.bpr).toFixed(1)} °C`
                  : `임계온도 Tc: ${currentFluidObj?.Tc_K ? `${(currentFluidObj.Tc_K - 273.15).toFixed(1)} °C` : 'N/A'}`
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
                온도별 물성 프로파일 그래프 — {chartData.meta.label} ({chartData.meta.unit})
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                {selectedSubstanceLabel} · P = {pressBar.toFixed(2)} barA · 모델: {method.code}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {(
                [
                  { id: 'psat', label: 'Psat (증기압)' },
                  { id: 'rho', label: 'ρ (밀도)' },
                  { id: 'mu', label: 'μ (점도)' },
                  { id: 'cp', label: 'Cp (비열)' },
                  { id: 'k', label: 'λ (열전도도)' },
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
            온도별 물성 변화 테이블 ({selectedSubstanceLabel} · 적용 모델: {method.code} · P = {pressBar.toFixed(2)} barA)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 760 }}>
              <thead>
                <tr style={{ background: '#EFECE5' }}>
                  {[
                    '온도 T (°C)',
                    '상 (Phase)',
                    '밀도 ρ (kg/m³)',
                    '점도 μ (cP)',
                    '비열 Cp (kJ/kg·K)',
                    '열전도도 λ (W/m·K)',
                    '증기압 P_sat (kPa)',
                    sysKey.startsWith('elec_') || currentFluidObj?.isProcessSolution ? '비점오름 BPR (°C)' : '잠열 ΔH_vap (kJ/kg)',
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

        {/* Live Plant Stream Property Integration Preview (PLANT 01 전용) */}
        {(activePlantId === 'clorsim' || activePlantId === 'clorsim_sim') && (
          <div
            style={{
              padding: '16px 20px',
              borderRadius: 10,
              background: '#FFFFFF',
              border: '1px solid #E5E2DC',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1A2F44', marginBottom: 10 }}>
              [PLANT 01] 전해 기준공장 물질수지 대표 스트림 실시간 물성 연동 ({balance.streams.length}개 스트림 동기화됨)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {['104', '217', 'L1', 'L7', 'L10', '220'].map(sid => {
                const s = balance.streams.find(x => x.id === sid);
                if (!s) return null;
                return (
                  <div key={sid} style={{ padding: 10, borderRadius: 8, background: '#F6F7F2', border: '1px solid #E5E2DC' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1A2F44' }}>
                      Stream [{s.id}] · {s.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#18181B', marginTop: 4 }}>
                      유량: <b>{s.total_kgh.toFixed(0)} kg/h</b> | 농도: <b>{(s.concentration ?? 0).toFixed(1)}%</b>
                    </div>
                    <div style={{ fontSize: 10.5, color: '#52525B', marginTop: 2 }}>
                      T: {s.temperature_C}°C · P: {s.pressure_kgcm2g} kg/cm²G · ρ: <b>{s.density_kgm3?.toFixed(0)} kg/m³</b>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
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

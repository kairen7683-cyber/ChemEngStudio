'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { ALL_FLUIDS, densityAtT, viscosityAtT, vaporPressure_kPa } from '@/lib/physicalProperties';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { getPlantRegistryItem } from '@/lib/plantRegistry';

type ThermoMethodCode = 'ELECNRTL' | 'NRTL' | 'PENG-ROB' | 'SRK' | 'STEAM-IAPWS';

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
    shortTag: '극성 액체 혼합물 활동도 모델',
    bestFor: '극성 액체 혼합물 및 저농도 수용액의 단거리 분자 상호작용 기반 기액평형(VLE) 근사 계산',
    eqText: 'ln γ_1 = x_2² [ τ_21 (G_21 / (x_1 + x_2 G_21))² + τ_12 G_12 / (x_2 + x_1 G_12)² ],  G_ij = exp(-α_ij τ_ij)',
    vleModel: 'Modified Raoult-NRTL (y_i Φ_i P = x_i γ_i P_i^{sat})',
    engineApplied: true,
  },
  'PENG-ROB': {
    code: 'PENG-ROB',
    name: 'Peng-Robinson Cubic EOS (염소 액화 · 산업가스 상태방정식 표준)',
    shortTag: '염소(Cl₂) 액화 · 고압가스 표준',
    bestFor: '염소(Cl₂) 압축·냉동 액화 이슬점 판별, 질소(N₂), 공기(Air), 고압 가스의 압축인자(Z)·실제기체 밀도·퓨개시티 계산',
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
    name: 'IAPWS-IF97 Industrial Water & Steam Formulation (순수 · 수증기 표준) — 참고용 (엔진 미적용)',
    shortTag: '참고용 (엔진 미적용) · 순수 · 냉각수 · 스팀',
    bestFor: '공정 순수(Process Water), 냉각수, 보일러 급수(BFW), 가열 스팀 및 다중효용 증발관 응축수 물성 계산',
    eqText: 'g(p, T)/(R·T) = γ^0(π, τ) + γ^r(π, τ)  [IAPWS-IF97 Region 1~4 Gibbs/Helmholtz Energy]',
    vleModel: 'Wagner Pure Water Saturation Pressure Equation',
    engineApplied: false,
  },
};

const ELECTROLYTE_SYSTEMS = [
  { key: 'elec_naoh',  name: '가성소다 수용액 (NaOH — H₂O, 5~52 wt%)', defaultWt: 32.0, defaultT: 90.0 },
  { key: 'elec_nacl',  name: '염화나트륨 브라인 (NaCl — H₂O, 5~26 wt%)', defaultWt: 25.5, defaultT: 70.0 },
  { key: 'elec_koh',   name: '수산화칼륨 전해액 (KOH — H₂O, 5~50 wt%)', defaultWt: 30.0, defaultT: 80.0 },
  { key: 'elec_h2so4', name: '황산 건조산 (H₂SO₄ — H₂O, 50~98 wt%)',    defaultWt: 98.0, defaultT: 35.0 },
  { key: 'elec_hcl',   name: '염산 수용액 (HCl — H₂O, 5~37 wt% · 공비 20.2%)', defaultWt: 35.0, defaultT: 40.0 },
  { key: 'elec_fecl3', name: '[1B] 염화제이철 에칭액 (FeCl₃ — H₂O, 10~45 wt%)', defaultWt: 40.0, defaultT: 45.0 },
  { key: 'elec_naocl', name: '[1B] 고농도 차아염소산소다 (NaOCl — H₂O, 5~26 wt%)', defaultWt: 12.0, defaultT: 22.0 },
];

// ── 물질별 적용 가능 열역학 모델 매핑 (해당 물질을 계산할 수 있는 열역학 모델만 필터링!) ──
interface SubstanceCompatSpec {
  categoryLabel: string;
  compatibleMethods: ThermoMethodCode[];
  defaultMethod: ThermoMethodCode;
  fixedOrDefaultWt?: number; // 단일성분(가스/순수)이면 undefined, 수용액이면 기본 wt%
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

  // 2) 공정 가스 (3차 상태방정식 PENG-ROB / SRK 전용)
  cl2_gas:       { categoryLabel: '압축·액화성 할로겐 공정가스', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  ahcl_gas:      { categoryLabel: '[1A] 반도체 5N 무수염화수소 가스 (AHCl)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  h2_gas:        { categoryLabel: '경질 비응축성 공정가스 (수소)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  n2_gas:        { categoryLabel: '불활성 퍼지 산업가스 (질소)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  air:           { categoryLabel: '계장·공정 압축공기', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },

  // 3) 순수 · 냉각수 · 스팀 계통 (IAPWS-IF97 국제 수증기표 표준)
  process_water: { categoryLabel: '순수 · 보일러수 · 스팀 계통', compatibleMethods: ['NRTL', 'STEAM-IAPWS'], defaultMethod: 'NRTL', allowsConcEdit: false },
  cooling_water: { categoryLabel: '유틸리티 냉각수 계통', compatibleMethods: ['NRTL', 'STEAM-IAPWS'], defaultMethod: 'NRTL', allowsConcEdit: false },

  // 4) 전해공장 표준 농도 공정액 (FLUID_DB)
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

  // 5) 산업용 냉매 및 심냉 브라인 (기액 상변화 · 증발/응축 · 과열/과냉 계산 지원)
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

  // 6) [1A 타겟] 초고순도·무수 염산(AHCl) & 폐염산 공비회수
  ahcl_liq:      { categoryLabel: '[1A] 고압 액화 무수염산 (Liquid AHCl)', compatibleMethods: ['PENG-ROB', 'SRK'], defaultMethod: 'PENG-ROB', allowsConcEdit: false },
  hcl_35_up:     { categoryLabel: '[1A] 반도체 초고순도 염산 (35 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 35.0, allowsConcEdit: false },
  hcl_20_azeo:   { categoryLabel: '[1A] 폐염산 공비조성액 (20.2 wt% · PSD 회수)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 20.2, allowsConcEdit: false },

  // 7) [1B 타겟] 고농도 NaOCl · FeCl₃ 에칭재생 · PAC 무기염소 유도품
  naocl_12:      { categoryLabel: '[1B] 차아염소산소다 표준액 (12 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 12.0, allowsConcEdit: false },
  naocl_25_hs:   { categoryLabel: '[1B] 고농도 저염 차아염소산소다 (25 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 25.0, allowsConcEdit: false },
  naclo3_40:     { categoryLabel: '[1B] 염소산소다 부반응 수용액 (40 wt%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: false },
  fecl2_28:      { categoryLabel: '[1B] 염화제일철 에칭 폐액 (28 wt% FeCl₂)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 28.0, allowsConcEdit: false },
  fecl3_40:      { categoryLabel: '[1B] 염화제이철 재생 에칭액 (40 wt% FeCl₃)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 40.0, allowsConcEdit: false },
  pac_17:        { categoryLabel: '[1B] 폴리염화알루미늄 수처리제 (PAC 17%)', compatibleMethods: ['ELECNRTL', 'NRTL'], defaultMethod: 'ELECNRTL', fixedOrDefaultWt: 17.0, allowsConcEdit: false },

  // 8) [2순위 타겟] 에피클로로히드린(ECH) · 글리세린 GTE 유기염소 증류 계통 (비이상 액상 NRTL 필수!)
  glycerol:      { categoryLabel: '[2순위 ECH] 정제 글리세린 원료 (NRTL 비이상계)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  mch_3:         { categoryLabel: '[2순위 ECH] 모노클로로히드린 중간체 (3-MCH)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  dch_13:        { categoryLabel: '[2순위 ECH] 1,3-디클로로히드린 (비누화 원료)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  ech_pure:      { categoryLabel: '[2순위 ECH] 에피클로로히드린 (물 불균일공비 88°C)', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  dcp_12:        { categoryLabel: '[2순위 ECH] 1,2-디클로로프로판 경질불순물', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
  acetic_cat:    { categoryLabel: '[2순위 ECH] 빙초산 GTE 염소화 촉매', compatibleMethods: ['NRTL', 'PENG-ROB'], defaultMethod: 'NRTL', allowsConcEdit: false },
};

// 기체 및 냉매 임계 상수 (Peng-Robinson / SRK 상태방정식 실제기체·액화 계산용)
const GAS_CRITICAL: Record<string, { Tc_K: number; Pc_bar: number; omega: number; MW: number }> = {
  cl2_gas:     { Tc_K: 416.9,  Pc_bar: 79.91,  omega: 0.073,  MW: 70.906 },
  ahcl_gas:    { Tc_K: 324.65, Pc_bar: 83.10,  omega: 0.132,  MW: 36.461 },
  h2_gas:      { Tc_K: 33.19,  Pc_bar: 13.13,  omega: -0.216, MW: 2.016 },
  n2_gas:      { Tc_K: 126.2,  Pc_bar: 33.98,  omega: 0.037,  MW: 28.013 },
  air:         { Tc_K: 132.5,  Pc_bar: 37.71,  omega: 0.035,  MW: 28.97 },
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

// 3차 상태방정식(Peng-Robinson / SRK) 압축인자 Z 및 퓨개시티 계수 근사 계산
function calcCubicEosGas(gasKey: string, T_C: number, P_bar: number, model: ThermoMethodCode) {
  const crit = GAS_CRITICAL[gasKey] ?? GAS_CRITICAL.air;
  const T_K = Math.max(180, T_C + 273.15);
  const P = Math.max(0.05, P_bar);
  const Tr = T_K / crit.Tc_K;
  const Pr = P / crit.Pc_bar;

  const isPR = model === 'PENG-ROB';
  const m = isPR
    ? 0.37464 + 1.54226 * crit.omega - 0.26992 * crit.omega * crit.omega
    : 0.480 + 1.574 * crit.omega - 0.176 * crit.omega * crit.omega;
  const alpha = Math.pow(1 + m * (1 - Math.sqrt(Tr)), 2);

  const omegaA = isPR ? 0.45724 : 0.42748;
  const omegaB = isPR ? 0.07780 : 0.08664;
  const A = (omegaA * alpha * Pr) / (Tr * Tr);
  const B = (omegaB * Pr) / Tr;

  // 비리얼-3차 근사로 기상 압축인자 Z 산출 (안정적 실근 보장)
  const Z = Math.max(0.35, Math.min(1.25, 1 + B - A / Math.max(0.4, 1 + (isPR ? 2 * B : B))));
  const phi = Math.exp(Math.max(-1.5, Math.min(0.5, (Z - 1) - Math.log(Math.max(0.1, Z - B)) - A / Math.max(0.2, Z + B))));
  const rhoGas = (P * 1e5 * crit.MW) / (Z * 8314.46 * T_K);
  return { Z, phi, rhoGas, crit };
}

export default function PropertyDbPage() {
  const { balance, activePlantId, lastPlantReturnHref } = useBalanceStore();
  const plantMeta = getPlantRegistryItem(activePlantId);

  // 1순위: 물질(sysKey) 먼저 선택 → 2순위: 해당 물질에 호환되는 열역학 모델(methodKey) 선택
  const [sysKey, setSysKey] = useState<string>('elec_naoh');
  const [methodKey, setMethodKey] = useState<ThermoMethodCode>('ELECNRTL');
  const [tempC, setTempC] = useState<number>(90.0);
  const [pressBar, setPressBar] = useState<number>(1.013);
  const [concWt, setConcWt] = useState<number>(32.0);
  const [plantFilterOnly, setPlantFilterOnly] = useState<boolean>(true);

  const compat = useMemo<SubstanceCompatSpec>(() => {
    return (
      SUBSTANCE_COMPAT_MAP[sysKey] ?? {
        categoryLabel: '일반 공정 유체',
        compatibleMethods: ['ELECNRTL', 'NRTL'],
        defaultMethod: 'ELECNRTL',
        allowsConcEdit: true,
      }
    );
  }, [sysKey]);

  // 현재 선택된 모델이 호환 목록에 없으면 즉시 기본 호환 모델로 보정
  const activeMethodKey: ThermoMethodCode = compat.compatibleMethods.includes(methodKey)
    ? methodKey
    : compat.defaultMethod;
  const method = THERMO_METHODS[activeMethodKey];

  // 선택된 물질의 표시 이름
  const selectedSubstanceLabel = useMemo(() => {
    const el = ELECTROLYTE_SYSTEMS.find(s => s.key === sysKey);
    if (el) return el.name;
    const fl = ALL_FLUIDS.find(f => f.key === sysKey);
    return fl ? `${fl.nameKo} (${fl.name})` : sysKey;
  }, [sysKey]);

  // 물질 변경 시 기본 온도·농도 및 호환 열역학 모델 자동 동기화
  const handleSubstanceChange = (newKey: string) => {
    setSysKey(newKey);
    const nextCompat = SUBSTANCE_COMPAT_MAP[newKey];

    const foundElec = ELECTROLYTE_SYSTEMS.find(x => x.key === newKey);
    if (foundElec) {
      setConcWt(foundElec.defaultWt);
      setTempC(foundElec.defaultT);
    } else {
      const fl = ALL_FLUIDS.find(x => x.key === newKey);
      if (fl) {
        if (newKey.startsWith('ref_')) {
          setTempC(-15.0);
          setPressBar(newKey === 'ref_r744' ? 20.0 : newKey === 'ref_r410a' || newKey === 'ref_r32' ? 5.0 : 2.8);
          setConcWt(100);
        } else if (newKey === 'brine_eg40' || newKey === 'brine_cacl2_25') {
          setTempC(-12.0);
          setPressBar(2.5);
          setConcWt(nextCompat?.fixedOrDefaultWt ?? 30);
        } else {
          setTempC(fl.T_ref);
          setConcWt(nextCompat?.fixedOrDefaultWt ?? (fl.phase === 'G' ? 100 : 0));
        }
      }
    }

    if (nextCompat) {
      // 새 물질과 호환되지 않는 모델이었거나, 물질군(전해질↔가스↔순수)이 바뀌면 최적 권장 모델을 즉시 세팅
      if (!nextCompat.compatibleMethods.includes(methodKey) || nextCompat.defaultMethod !== compat.defaultMethod) {
        setMethodKey(nextCompat.defaultMethod);
      }
    }
  };

  // 공정 유체 그룹 분리 (드롭다운 가독성 극대화)
  const gasFluids = useMemo(() => ALL_FLUIDS.filter(f => f.phase === 'G' && !f.isRefrigerant && !f.downstreamGroup), []);
  const waterFluids = useMemo(() => ALL_FLUIDS.filter(f => f.key === 'process_water' || f.key === 'cooling_water'), []);
  const refrigerantFluids = useMemo(() => ALL_FLUIDS.filter(f => Boolean(f.isRefrigerant)), []);
  const downstream1AFluids = useMemo(() => ALL_FLUIDS.filter(f => f.downstreamGroup === '1A_HCL'), []);
  const downstream1BFluids = useMemo(() => ALL_FLUIDS.filter(f => f.downstreamGroup === '1B_INORG'), []);
  const downstream2EchFluids = useMemo(() => ALL_FLUIDS.filter(f => f.downstreamGroup === '2_ECH'), []);
  const plantElectrolyteFluids = useMemo(
    () =>
      ALL_FLUIDS.filter(
        f => f.phase === 'L' && !f.isRefrigerant && !f.downstreamGroup && f.key !== 'process_water' && f.key !== 'cooling_water'
      ),
    []
  );

  // 선택된 공장(activePlantId)에 맞춰 대표 유체 및 맞춤 필터링 기본값 동기화
  useEffect(() => {
    if (activePlantId === 'clorsim' || activePlantId === 'clorsim_sim') {
      setPlantFilterOnly(true);
      handleSubstanceChange('elec_naoh');
    } else if (activePlantId === 'hcl_synth') {
      setPlantFilterOnly(true);
      handleSubstanceChange('elec_hcl');
    } else if (activePlantId === 'green_h2') {
      setPlantFilterOnly(true);
      handleSubstanceChange('elec_koh');
    } else {
      setPlantFilterOnly(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlantId]);

  const showAllFluids = !plantFilterOnly || activePlantId === 'new_builder';
  const visibleElectrolyteSystems = useMemo(() => {
    if (showAllFluids) return ELECTROLYTE_SYSTEMS;
    if (activePlantId === 'hcl_synth') {
      return ELECTROLYTE_SYSTEMS.filter(s => s.key === 'elec_hcl' || s.key === 'elec_h2so4');
    }
    if (activePlantId === 'green_h2') {
      return ELECTROLYTE_SYSTEMS.filter(s => s.key === 'elec_koh');
    }
    return ELECTROLYTE_SYSTEMS.filter(
      s => s.key === 'elec_naoh' || s.key === 'elec_nacl' || s.key === 'elec_h2so4' || s.key === 'elec_hcl'
    );
  }, [showAllFluids, activePlantId]);

  const visibleGasFluids = useMemo(() => {
    if (showAllFluids) return gasFluids;
    if (activePlantId === 'green_h2') {
      return gasFluids.filter(f => f.key === 'h2_gas' || f.key === 'n2_gas' || f.key === 'air');
    }
    return gasFluids;
  }, [showAllFluids, activePlantId, gasFluids]);

  // 선택된 물질 + 호환 열역학 모델 기반 물성 계산
  const calcPropsAt = (T: number, wtInput: number, pBar: number) => {
    const wt = compat.allowsConcEdit ? wtInput : (compat.fixedOrDefaultWt ?? 0);
    const w = Math.max(0, Math.min(98, wt)) / 100;
    const psat_water_kPa = Math.pow(10, 7.07406 - 1657.46 / (T + 227.02)) * 0.133322;
    const isNrtlApprox = activeMethodKey === 'NRTL';

    // 1) 가변 농도 전해질 수용액 (ELECNRTL vs NRTL 비교 지원)
    if (sysKey.startsWith('elec_')) {
      const nrtlFactor = isNrtlApprox ? 0.91 : 1.0; // NRTL은 장거리 정전기항 생략으로 BPR·이온활동도 보정 차이 반영
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

    const fl = ALL_FLUIDS.find(f => f.key === sysKey) ?? ALL_FLUIDS[0];

    // 2) 산업용 기액 상변화 냉매 (ref_* — 포화증기압, 포화온도 T_sat, 과열도/과냉도, Watson 기화잠열 ΔH_vap 정밀 계산)
    if (fl.key.startsWith('ref_') && fl.antoine) {
      const { Z, phi, rhoGas, crit } = calcCubicEosGas(fl.key, T, pBar, activeMethodKey);
      const Tc_C = crit.Tc_K - 273.15;
      const psat_kPa = vaporPressure_kPa(fl, Math.min(T, Tc_C));
      const psat_bar = psat_kPa / 100.0;
      const pKpa = Math.max(5.0, pBar * 100.0);
      const tSatAtP_C = fl.antoine.B / Math.max(0.8, fl.antoine.A - Math.log10(pKpa)) - fl.antoine.C;
      const deltaT_SH = T - tSatAtP_C; // > 0 과열 증기, <= 0 과냉 액상

      // Watson 기화잠열 온도 보정: Hvap(T) = Hvap(Tb) * ((Tc - T)/(Tc - Tb))^0.38
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

      // 과열 냉매 증기 상태
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

    // 3) 공정 가스 (PENG-ROB / SRK 상태방정식 — 압력·온도 실제기체 밀도 및 염소 액화 상전이 반영!)
    if (fl.phase === 'G') {
      const { Z, phi, rhoGas } = calcCubicEosGas(fl.key, T, pBar, activeMethodKey);
      const muGas = viscosityAtT(fl, T);

      if (fl.key === 'cl2_gas') {
        // 염소(Cl₂) Antoine 포화증기압 (kPa) 및 이슬점 판별
        const T_K = Math.max(195, Math.min(415, T + 273.15));
        const psat_cl2_bar = Math.pow(10, 4.0628 - 861.34 / (T_K - 27.01));
        const psat_cl2_kPa = psat_cl2_bar * 100;
        const isLiquefied = pBar >= psat_cl2_bar && T < 143.7;

        if (isLiquefied) {
          const rhoLiq = Math.max(1150, 1468 - 2.9 * T);
          const muLiq = Math.max(0.25, 0.35 - 0.0022 * T);
          return {
            rho: rhoLiq,
            mu: muLiq,
            cp: 0.96,
            k: 0.13,
            bpr: 0.0,
            gamma: phi,
            psat: psat_cl2_kPa,
            phase: `L (액화 Cl₂ @ ${pBar.toFixed(2)} barA)`,
            subCoefLabel: `퓨개시티 φ = ${phi.toFixed(3)} (액화상태)`,
          };
        }

        return {
          rho: rhoGas,
          mu: muGas,
          cp: fl.Cp,
          k: fl.k_thermal ?? 0.009,
          bpr: 0.0,
          gamma: phi,
          psat: psat_cl2_kPa,
          phase: `G (기상 · Z=${Z.toFixed(3)})`,
          subCoefLabel: `압축인자 Z=${Z.toFixed(3)} · φ=${phi.toFixed(3)}`,
        };
      }

      return {
        rho: rhoGas,
        mu: muGas,
        cp: fl.Cp,
        k: fl.k_thermal ?? 0.026,
        bpr: 0.0,
        gamma: phi,
        psat: pBar * 100,
        phase: `G (기상 · Z=${Z.toFixed(3)})`,
        subCoefLabel: `압축인자 Z=${Z.toFixed(3)} · φ=${phi.toFixed(3)}`,
      };
    }

    // 3) 순수 · 냉각수 (STEAM-IAPWS vs NRTL)
    if (fl.key === 'process_water' || fl.key === 'cooling_water') {
      const pKpa = Math.max(5, pBar * 100);
      const isSteam = psat_water_kPa > pKpa;
      const rho = isSteam ? (pKpa * 18.015) / (8.31446 * (T + 273.15)) : densityAtT(fl, T);
      const mu = isSteam ? 0.012 + 0.00004 * (T - 100) : viscosityAtT(fl, T);
      const cp = isSteam ? 2.04 : activeMethodKey === 'STEAM-IAPWS' ? 4.184 + 0.0006 * Math.max(0, T - 50) : fl.Cp;
      return {
        rho,
        mu,
        cp,
        k: isSteam ? 0.025 : fl.k_thermal ?? 0.61,
        bpr: 0.0,
        gamma: 1.0,
        psat: psat_water_kPa,
        phase: isSteam ? 'G (수증기 Steam)' : 'L (액상 물)',
        subCoefLabel: activeMethodKey === 'STEAM-IAPWS' ? 'IAPWS-IF97 순수 기준 (γ=1.000)' : '순수 액상 기준 (γ=1.000)',
      };
    }

    // 4) [2순위 ECH 등] 비이상 유기염소 액상 물질 (NRTL 활동도·비점·잠열 정밀 반영)
    if (fl.downstreamGroup === '2_ECH') {
      const rho = Math.max(650, densityAtT(fl, T));
      const mu = viscosityAtT(fl, T);
      const psat = vaporPressure_kPa(fl, T);
      const pKpa = Math.max(2.0, pBar * 100.0);
      const tSatAtP_C = fl.antoine
        ? fl.antoine.B / Math.max(0.8, fl.antoine.A - Math.log10(pKpa)) - fl.antoine.C
        : (fl.Tb_C ?? 116.1);
      const gammaAqInf = fl.key === 'ech_pure' ? 24.5 : fl.key === 'dcp_12' ? 185.0 : fl.key === 'dch_13' ? 6.8 : 1.08;
      const isVap = psat >= pKpa;
      return {
        rho: isVap ? (pKpa * (fl.MW ?? 92.5)) / (8.31446 * (T + 273.15)) : rho,
        mu: isVap ? 0.011 : mu,
        cp: fl.Cp ?? 1.65,
        k: fl.k_thermal ?? 0.15,
        bpr: 0.0,
        gamma: activeMethodKey === 'NRTL' ? gammaAqInf : 1.0,
        psat,
        tSatC: tSatAtP_C,
        hvap: fl.latentHeat_kJkg ?? 400,
        phase: isVap ? `G (유기증기 · T_bp=${tSatAtP_C.toFixed(1)}°C)` : `L (유기액상 · T_bp=${tSatAtP_C.toFixed(1)}°C)`,
        subCoefLabel: `비점(@P) ${tSatAtP_C.toFixed(1)}°C · 수중 γ∞(NRTL)=${gammaAqInf.toFixed(2)} · ΔHv=${(fl.latentHeat_kJkg ?? 400).toFixed(0)} kJ/kg`,
      };
    }

    // 5) 전해공장 및 1A/1B 표준 농도 공정액 (FLUID_DB 액상 전해질)
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
      subCoefLabel: `활동도계수 γ± = ${gamma.toFixed(3)}`,
    };
  };

  const cur = calcPropsAt(tempC, concWt, pressBar);
  const isRefOrCryo = sysKey.startsWith('ref_') || sysKey === 'cl2_gas' || sysKey === 'brine_eg40' || sysKey === 'brine_cacl2_25';
  const sweepTemps = isRefOrCryo
    ? [-45, -35, -25, -15, -5, 10, 25, 45]
    : [20, 40, 60, 80, 90, 110, 135, 165];

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '20px 26px', background: '#F6F7F2', color: '#18181B' }}>
      <div style={{ maxWidth: 99999, margin: '0 auto' }}>
        {/* Header — 물질 물성 DB가 먼저 오고 열역학 모델이 뒤따르는 순서로 정렬 */}
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 10,
            marginBottom: 16,
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
                화학물질 물성 DB &amp; 열역학 모델 시뮬레이션
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#52525B', marginTop: 3 }}>
              1단계 물질 선택 → 2단계 해당 물질 계산 가능 열역학 모델 자동 필터링 (ELECNRTL · NRTL · PENG-ROB · SRK · STEAM-IAPWS)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {activePlantId !== 'new_builder' && (
              <button
                type="button"
                onClick={() => setPlantFilterOnly(v => !v)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 800,
                  background: plantFilterOnly ? '#EFF6FF' : '#F8FAFC',
                  border: plantFilterOnly ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                  color: plantFilterOnly ? '#1D4ED8' : '#475569',
                  cursor: 'pointer',
                }}
              >
                {plantFilterOnly
                  ? `✓ [${plantMeta.shortLabel}] 공정 유체만 표시 중 (전체 DB 보기)`
                  : '전체 45종 물질 표시 중 (현재 공장 유체만 보기)'}
              </button>
            )}
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

        {/* ── 물질 우선 선택(1단계) → 호환 열역학 모델 필터링(2단계) → 운전 조건(3단계) ── */}
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
                계산 대상 화학물질 / 수용액 / 공정가스
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
                <optgroup label="① 전해질 수용액 (농도 wt% 자유 조절)">
                  {visibleElectrolyteSystems.map(s => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="② 공정 가스 (Cl₂ · H₂ · N₂ · Air — 상태방정식 EOS)">
                  {visibleGasFluids.map(f => (
                    <option key={f.key} value={f.key}>
                      {f.nameKo} ({f.name})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="③ 순수 · 냉각수 · 스팀 계통 (IAPWS-IF97)">
                  {waterFluids.map(f => (
                    <option key={f.key} value={f.key}>
                      {f.nameKo} ({f.name})
                    </option>
                  ))}
                </optgroup>
                {(showAllFluids || activePlantId === 'clorsim' || activePlantId === 'clorsim_sim') && (
                  <optgroup label="④ 전해공장 표준 농도 공정액 (FLUID_DB)">
                    {plantElectrolyteFluids.map(f => (
                      <option key={f.key} value={f.key}>
                        {f.nameKo} ({f.name})
                      </option>
                    ))}
                  </optgroup>
                )}
                {(showAllFluids || activePlantId !== 'green_h2') && (
                  <optgroup label="⑤ 산업용 냉매 및 심냉 브라인 (R-134a · R-404A · R-507A · R-22 · R-717 · R-1234yf)">
                    {refrigerantFluids.map(f => (
                      <option key={f.key} value={f.key}>
                        {f.nameKo} ({f.name})
                      </option>
                    ))}
                  </optgroup>
                )}
                {(showAllFluids || activePlantId === 'hcl_synth') && (
                  <optgroup label="⑥ [1A 타겟] 초고순도·무수 염산(AHCl) & 폐염산 공비회수 유체">
                    {downstream1AFluids.map(f => (
                      <option key={f.key} value={f.key}>
                        {f.nameKo} ({f.name})
                      </option>
                    ))}
                  </optgroup>
                )}
                {showAllFluids && (
                  <>
                    <optgroup label="⑦ [1B 타겟] 고농도 NaOCl · FeCl₃ 에칭재생 · PAC 무기염소 유도품">
                      {downstream1BFluids.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.nameKo} ({f.name})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="⑧ [2순위 타겟] 에피클로로히드린(ECH) · 글리세린 GTE · 다단 진공증류 (NRTL)">
                      {downstream2EchFluids.map(f => (
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
                      {!m.engineApplied ? '[참고용·엔진 미적용] ' : isRecommended ? '★ [권장] ' : '[호환] '}
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

          {/* 선택된 물질 → 적용 열역학 모델 요약 박스 (순서도 물질 먼저 → 열역학 모델 다음!) */}
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
              <div style={{ fontSize: 12, fontWeight: 900, color: '#1A2F44' }}>
                🧪 선택 물질: <span style={{ color: '#0F5338' }}>{selectedSubstanceLabel}</span>{' '}
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: '#E2E8F0',
                    color: '#334155',
                    padding: '2px 7px',
                    borderRadius: 999,
                    marginLeft: 4,
                  }}
                >
                  분류: {compat.categoryLabel}
                </span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#0F5338' }}>
                ✓ 부적합 모델 자동 제외됨 — 계산 가능 모델: {compat.compatibleMethods.join(' / ')}
              </div>
            </div>

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
          <PropBox label="열전도도 k (Thermal Cond.)" value={`${cur.k.toFixed(3)} W/m·K`} sub={`Prandtl: ${((cur.cp * cur.mu) / Math.max(0.005, cur.k)).toFixed(2)}`} />
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
              label="끓는점 오름 (Dühring BPR)"
              value={`+${cur.bpr.toFixed(2)} °C`}
              sub={`대기압 비점: ${sysKey.includes('cl2') ? '-34.0 °C (Cl₂)' : `${(100 + cur.bpr).toFixed(1)} °C`}`}
              highlight
            />
          )}
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
                    '열전도도 k (W/m·K)',
                    '증기압 P_sat (kPa)',
                    sysKey.startsWith('ref_') ? '잠열 ΔH_vap (kJ/kg)' : '비점오름 BPR (°C)',
                  ].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#1A2F44', fontWeight: 700, borderBottom: '1px solid #DFDCD4' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sweepTemps.map(t => {
                  const p = calcPropsAt(t, concWt, pressBar);
                  const highlight = Math.abs(t - tempC) <= 8;
                  return (
                    <tr key={t} style={{ background: highlight ? '#EFECE5' : '#FFFFFF', borderBottom: '1px solid #ECEAE4' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 800, color: '#1A2F44' }}>{t.toFixed(0)} °C</td>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: p.phase.startsWith('G') ? '#0F5338' : '#0284C7' }}>{p.phase}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{p.rho.toFixed(2)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{p.mu.toFixed(3)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{p.cp.toFixed(3)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{p.k.toFixed(3)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#1A2F44' }}>{p.psat.toFixed(2)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#1A2F44' }}>
                        {'hvap' in p && p.hvap !== undefined ? `${p.hvap.toFixed(1)}` : `+${p.bpr.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Plant Stream Property Integration Preview (PLANT 01 전용) */}
        {activePlantId === 'clorsim' && (
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

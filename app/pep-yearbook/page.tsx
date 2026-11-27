'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import * as XLSX from 'xlsx';
import { ENGINEERING_DISCLAIMER_EN, ENGINEERING_DISCLAIMER_ROWS } from '@/lib/legal/engineeringDisclaimer';
import { useBalanceStore, type PlantId } from '@/lib/stores/balanceStore';
import { useUnitStore } from '@/lib/stores/unitStore';
import { getPlantRegistryItem, isPlantAllowed, isSimulatorOnlyUser, showPlantNumbersForUser } from '@/lib/plantRegistry';
import { useAuth } from '@/components/auth/AuthContext';

const DesignStandards = dynamic(() => import('@/components/DesignStandards'), { ssr: false });

interface UnitItem {
  item: string;
  itemEn: string;
  type: 'RAW' | 'UTIL';
  unit: string;
  qty: number;
  unitCost_krw: number;
}

interface ProcessBlock {
  code: string;
  title: string;
  titleEn: string;
  desc: string;
  descEn: string;
}

interface ProcessEconomicsItem {
  key: string;
  code: string;
  name: string;
  nameEn: string;
  product: string;
  productEn: string;
  licensor: string;
  baseCap_tpy: number;
  baseCapex_musd: number;
  scaleExponent: number;
  productPrice_krw: number;
  byproductCredit_krw: number;
  blocks: ProcessBlock[];
  unitConsumptions: UnitItem[];
}

const PROCESS_ECONOMICS_DB: Record<string, ProcessEconomicsItem> = {
  chlor_alkali: {
    key: 'chlor_alkali',
    code: 'ECON-CA-01',
    name: '클로르-알칼리 이온교환막 전해 플랜트 (Chlor-Alkali Electrolysis)',
    nameEn: 'Chlor-Alkali Ion-Exchange Membrane Electrolysis Plant',
    product: 'Cl₂ 1.0 ton + NaOH 1.128 ton (100% Dry) + H₂ 0.028 ton (1 ECU 기준)',
    productEn: 'Cl₂ 1.0 ton + NaOH 1.128 ton (100% Dry) + H₂ 0.028 ton (per 1 ECU)',
    licensor: 'Asahi Kasei (BiTAC) / Thyssenkrupp Uhde / INEOS',
    baseCap_tpy: 165000,
    baseCapex_musd: 148.0,
    scaleExponent: 0.68,
    productPrice_krw: 890000,
    byproductCredit_krw: 120000,
    blocks: [
      { code: '100 SEC', title: '브라인 정제 (Brine)', titleEn: 'Brine Purification', desc: '원염 포화용해 · 침전 · 캔들 프리코트 여과 · 킬레이트 이온교환 (Ca+Mg < 20 ppb)', descEn: 'Salt saturation · clarification · candle precoat filtration · chelate ion exchange (Ca+Mg < 20 ppb)' },
      { code: '200 SEC', title: '이온교환막 전해 (Cell)', titleEn: 'Membrane Electrolysis', desc: '양극 Cl₂ 발생 · 음극 32% NaOH & H₂ 발생 (DC 3.05V @ 16.2 kA, CE 94~96%)', descEn: 'Anode Cl₂ generation · cathode 32% NaOH & H₂ generation (DC 3.05V @ 16.2 kA, CE 94–96%)' },
      { code: '300 SEC', title: '가성소다 3효 농축 (Evap)', titleEn: 'NaOH Triple-Effect Evap.', desc: '역류식 3중 효용 강하막 증발관 (32 wt% → 50 wt% NaOH, Nickel 200)', descEn: 'Counter-current triple-effect falling-film evaporator (32 wt% → 50 wt% NaOH, Nickel 200)' },
      { code: '400 SEC', title: '염소 건조·액화 (Cl₂)', titleEn: 'Cl₂ Drying & Liquefaction', desc: '수세 냉각탑 → 3단 황산 건조탑(98% H₂SO₄) → 염소 압축 및 액화', descEn: 'Direct-contact water cooling → 3-stage H₂SO₄ drying (98%) → Cl₂ compression & liquefaction' },
      { code: '600 SEC', title: '수소 냉각·정제 (H₂)', titleEn: 'H₂ Cooling & Purification', desc: '수소 가스 가성소다 세정 · 칠러 냉각 · 고압 압축', descEn: 'Caustic scrubbing · chiller cooling · high-pressure H₂ compression' },
    ],
    unitConsumptions: [
      { item: '원료염 (Industrial Salt, NaCl ≥ 97%)', itemEn: 'Industrial Salt (NaCl ≥ 97%)', type: 'RAW', unit: 'ton / t-Cl₂', qty: 1.715, unitCost_krw: 95000 },
      { item: '정제 약품 (BaCl₂, Na₂CO₃, HCl, 아황산소다, 이온교환 재생)', itemEn: 'Purification Chemicals (BaCl₂, Na₂CO₃, HCl, NaHSO₃, Resin Regen.)', type: 'RAW', unit: 'kg / t-Cl₂', qty: 14.5, unitCost_krw: 1200 },
      { item: '전해 직류 전력 (DC Electrolysis Cell Power)', itemEn: 'DC Electrolysis Cell Power', type: 'UTIL', unit: 'kWh / t-Cl₂', qty: 2180.0, unitCost_krw: 135 },
      { item: '동력 및 냉동기 보조 전력 (BOP & Liquefaction)', itemEn: 'BOP & Liquefaction Auxiliary Power', type: 'UTIL', unit: 'kWh / t-Cl₂', qty: 165.0, unitCost_krw: 135 },
      { item: '중압 가열 스팀 (13K Steam, 300 Sec 농축용)', itemEn: 'MP Heating Steam (13K Steam, 300 Sec Concentration)', type: 'UTIL', unit: 'ton / t-Cl₂', qty: 0.550, unitCost_krw: 62000 },
      { item: '공정 순수 및 순환 냉각수 (UPW & Cooling Water)', itemEn: 'UPW & Circulating Cooling Water', type: 'UTIL', unit: 'm³ / t-Cl₂', qty: 48.0, unitCost_krw: 450 },
    ],
  },
  naoh_evap: {
    key: 'naoh_evap',
    code: 'ECON-CA-02',
    name: '가성소다 3중 효용 강하막 증발·농축 공정 (32 wt% → 50 wt% NaOH MEE)',
    nameEn: 'Caustic Soda Triple-Effect Falling-Film Evaporation (32 → 50 wt% NaOH MEE)',
    product: '50 wt% 가성소다 제품 (100% Dry NaOH 1톤 기준)',
    productEn: '50 wt% Caustic Soda Product (per 1 ton 100% Dry NaOH)',
    licensor: 'Bertrams / Sulzer / GEA Falling-Film Evaporator',
    baseCap_tpy: 185000,
    baseCapex_musd: 24.5,
    scaleExponent: 0.62,
    productPrice_krw: 580000,
    byproductCredit_krw: 8500,
    blocks: [
      { code: 'FEED', title: '32% 음극액 예열 (PHE)', titleEn: '32% Catholyte Preheating (PHE)', desc: 'E-342 / E-343 판형 열교환기에서 고온 농축액 및 응축수와 열교환', descEn: 'Heat recovery with hot concentrated NaOH and condensate in E-342 / E-343 PHEs' },
      { code: 'E-340', title: '3효 진공 증발관', titleEn: '3rd-Effect Vacuum Evap.', desc: '0.25 barA 진공 운전 · 32.0% → 36.4% NaOH (68.4°C, SS 310S/316L)', descEn: '0.25 barA vacuum operation · 32.0% → 36.4% NaOH (68.4°C, SS 310S/316L)' },
      { code: 'E-330', title: '2효 중압 증발관', titleEn: '2nd-Effect MP Evap.', desc: '0.60 barA 운전 · 36.4% → 42.1% NaOH (108.5°C, LC-Nickel 99)', descEn: '0.60 barA operation · 36.4% → 42.1% NaOH (108.5°C, LC-Nickel 99)' },
      { code: 'E-320', title: '1효 고온 증발관', titleEn: '1st-Effect High-Temp Evap.', desc: '13K 스팀 가열 · 42.1% → 50.04% NaOH (164.8°C, LC-Nickel 99)', descEn: '13K steam heated · 42.1% → 50.04% NaOH (164.8°C, LC-Nickel 99)' },
      { code: 'COOL', title: '다단 열회수 냉각', titleEn: 'Multi-Stage Heat Recovery Cooling', desc: 'E-332 → E-342 → E-352 판형 냉각기 (164.8°C → 42.0°C 출하)', descEn: 'E-332 → E-342 → E-352 PHE coolers (164.8°C → 42.0°C product rundown)' },
    ],
    unitConsumptions: [
      { item: '32 wt% NaOH 음극액 피드 (100% Dry NaOH 환산)', itemEn: '32 wt% NaOH Catholyte Feed (100% Dry Basis)', type: 'RAW', unit: 'ton / t-NaOH', qty: 1.002, unitCost_krw: 390000 },
      { item: '가열 스팀 (13 kg/cm²G Saturated Steam)', itemEn: 'Heating Steam (13 kg/cm²G Saturated Steam)', type: 'UTIL', unit: 'ton / t-NaOH', qty: 0.499, unitCost_krw: 62000 },
      { item: '진공 표면응축기(E-350) 및 제품 냉각수', itemEn: 'Surface Condenser (E-350) & Product Cooling Water', type: 'UTIL', unit: 'm³ / t-NaOH', qty: 32.0, unitCost_krw: 350 },
      { item: '효용간 이송펌프(P-321/331/341) 및 진공 전력', itemEn: 'Inter-Effect Transfer Pumps & Vacuum Power', type: 'UTIL', unit: 'kWh / t-NaOH', qty: 42.0, unitCost_krw: 135 },
    ],
  },
  hcl_1a: {
    key: 'hcl_1a',
    code: 'ECON-HCL-1A',
    name: '1A 초고순도·무수염산(5N AHCl) & 폐염산 압력변동 공비증류(PSD) 회수 플랜트',
    nameEn: '1A 5N Anhydrous HCl (AHCl) & Spent HCl Pressure-Swing Distillation (PSD) Plant',
    product: '반도체 5N 무수염산(AHCl) + 전자급 35% 염산 패키지',
    productEn: 'Semiconductor 5N Anhydrous HCl (AHCl) + Electronic-Grade 35% HCl Package',
    licensor: 'SGL Carbon (Graphite Synthesis) / Mersen / 자체 PSD 공정',
    baseCap_tpy: 35000,
    baseCapex_musd: 28.5,
    scaleExponent: 0.62,
    productPrice_krw: 1850000,
    byproductCredit_krw: 120000,
    blocks: [
      { code: '100 SEC', title: 'HCl 합성버너 · 흑연 냉각/흡수', titleEn: 'HCl Synthesis Burner & Graphite Absorber', desc: '전해 Cl₂ + H₂ 직접합성 및 불침투성 흑연 등온 흡수(35 wt%)', descEn: 'Direct Cl₂ + H₂ combustion & impervious graphite isothermal absorption (35 wt%)' },
      { code: '200 SEC', title: '5N 무수염산(AHCl) 심냉·정제', titleEn: '5N AHCl Cryogenic Purification', desc: '다단 압축 · 제습(-60°C 노점) · 심냉액화(-22°C) · 스트리핑 정제탑(C-230A)', descEn: 'Multi-stage compression · drying (-60°C DP) · cryo-liquefaction (-22°C) · stripper C-230A' },
      { code: '300 SEC', title: '폐염산 공비증류 회수(PSD)', titleEn: 'Spent HCl PSD Azeotropic Recovery', desc: '진공 농축탑(C-310, 0.15 barA) + 가압 회수탑(C-320) 열통합 순환', descEn: 'Vacuum concentrator (C-310, 0.15 barA) + pressurized recovery column (C-320) heat-integrated loop' },
    ],
    unitConsumptions: [
      { item: '전해 염소가스 원료 (Cl₂ Gas)', itemEn: 'Electrolytic Chlorine Gas (Cl₂)', type: 'RAW', unit: 'ton / t-Prod', qty: 0.975, unitCost_krw: 290000 },
      { item: '전해 수소가스 원료 (H₂ Gas)', itemEn: 'Electrolytic Hydrogen Gas (H₂)', type: 'RAW', unit: 'ton / t-Prod', qty: 0.0285, unitCost_krw: 2200000 },
      { item: '공비증류 리보일러 스팀 (LP/MP Steam)', itemEn: 'Azeotropic Distillation Reboiler Steam (LP/MP)', type: 'UTIL', unit: 'ton / t-Prod', qty: 1.45, unitCost_krw: 62000 },
      { item: '심냉 냉동기 · 다단압축기 전력', itemEn: 'Cryogenic Chiller & Multi-Stage Compressor Power', type: 'UTIL', unit: 'kWh / t-Prod', qty: 410.0, unitCost_krw: 135 },
      { item: '흑연 냉각기 · 응축기 냉각수 (CW)', itemEn: 'Graphite Cooler & Condenser Cooling Water (CW)', type: 'UTIL', unit: 'm³ / t-Prod', qty: 68.0, unitCost_krw: 350 },
    ],
  },
  green_h2: {
    key: 'green_h2',
    code: 'ECON-H2-01',
    name: '알칼라인 / PEM 수전해 그린수소 생산 플랜트 (Green Hydrogen Electrolysis)',
    nameEn: 'Alkaline / PEM Water Electrolysis Green Hydrogen Plant',
    product: '고순도 수소 (H₂ 99.999%, 30 barG) + 부생 산소 (O₂ 7.94 ton/t-H₂)',
    productEn: 'High-Purity H₂ (99.999%, 30 barG) + Byproduct O₂ (7.94 ton/t-H₂)',
    licensor: 'Thyssenkrupp Nucera / Nel Hydrogen / Siemens Energy',
    baseCap_tpy: 4000,
    baseCapex_musd: 32.0,
    scaleExponent: 0.72,
    productPrice_krw: 7800000,
    byproductCredit_krw: 320000,
    blocks: [
      { code: 'UPW', title: '초순수 제조 (RO/EDI)', titleEn: 'Ultra-Pure Water (RO/EDI)', desc: '원수 전처리 및 비저항 18 MΩ·cm 초순수 공급 (9.85 t/t-H₂)', descEn: 'Raw water pretreatment & 18 MΩ·cm UPW feed (9.85 t/t-H₂)' },
      { code: 'STACK', title: '수전해 스택 (KOH 30%)', titleEn: 'Electrolyzer Stack (30% KOH)', desc: 'DC 전력 인가 · 음극 H₂ / 양극 O₂ 발생 (80°C, 15 barG)', descEn: 'DC power applied · cathode H₂ / anode O₂ evolution (80°C, 15 barG)' },
      { code: 'SEP', title: '기액분리 및 전해액 냉각', titleEn: 'Gas-Liquid Sep. & Electrolyte Cooling', desc: 'H₂/O₂ KO Drum 분리 · 판형 열교환기 전해액 순환 냉각', descEn: 'H₂/O₂ KO drum separation · PHE electrolyte loop cooling' },
      { code: 'DEOXO', title: '촉매 탈산소 & PSA 건조', titleEn: 'Catalytic DeOxo & PSA Drying', desc: 'DeOxo 반응기 잔류 O₂ 제거 및 흡착 건조 (이슬점 -70°C)', descEn: 'DeOxo residual O₂ removal & PSA adsorption drying (-70°C dew point)' },
    ],
    unitConsumptions: [
      { item: '초순수 (Demineralized Ultra-Pure Water)', itemEn: 'Demineralized Ultra-Pure Water (UPW)', type: 'RAW', unit: 'ton / t-H₂', qty: 9.85, unitCost_krw: 2200 },
      { item: '전해질 보충 (KOH 및 불활성 퍼지 N₂)', itemEn: 'Electrolyte Make-up (KOH & N₂ Purge)', type: 'RAW', unit: 'kg / t-H₂', qty: 3.2, unitCost_krw: 2800 },
      { item: '수전해 스택 및 BOP 전력 (Renewable Power)', itemEn: 'Electrolyzer Stack & BOP Renewable Power', type: 'UTIL', unit: 'kWh / t-H₂', qty: 51500.0, unitCost_krw: 95 },
      { item: '냉각수 (스택 발열 제거용 CW)', itemEn: 'Cooling Water (Stack Heat Removal CW)', type: 'UTIL', unit: 'm³ / t-H₂', qty: 410.0, unitCost_krw: 350 },
    ],
  },
  ech_gte: {
    key: 'ech_gte',
    code: 'ECON-ECH-02',
    name: '글리세린 염소화 기반 에피클로로히드린(GTE-ECH) 제조 · 다단 진공증류 플랜트',
    nameEn: 'Glycerin-to-Epichlorohydrin (GTE-ECH) Chlorination & Multi-Stage Vacuum Distillation Plant',
    product: '고순도 에피클로로히드린 (ECH ≥ 99.9 wt%)',
    productEn: 'High-Purity Epichlorohydrin (ECH ≥ 99.9 wt%)',
    licensor: 'Solvay Epicerol / Spolchemie GTE Process',
    baseCap_tpy: 70000,
    baseCapex_musd: 79.4,
    scaleExponent: 0.64,
    productPrice_krw: 2150000,
    byproductCredit_krw: 0,
    blocks: [
      { code: 'RXN-1', title: '글리세린 염소화 (DCH 합성)', titleEn: 'Glycerin Hydrochlorination (DCH)', desc: '무수 HCl 촉매 반응으로 디클로로히드린(DCH) 생성 및 반응수 공비제거', descEn: 'Anhydrous HCl catalytic reaction to DCH with azeotropic water removal' },
      { code: 'RXN-2', title: '가성소다 비누화 고리화', titleEn: 'Caustic Saponification & Epoxidation', desc: '32% NaOH 투입에 의한 고리화 반응 및 ECH 스팀 스트리핑', descEn: 'Ring-closure epoxidation with 32% NaOH & ECH steam stripping' },
      { code: 'DIST', title: '진공 정밀증류 2탑 (C-101/C-102)', titleEn: '2-Column Vacuum Distillation (C-101/C-102)', desc: '경질분·수분 디캔터 제거(C-101) 및 중질분 분리 99.9% ECH 회수(C-102)', descEn: 'Lights/water decanter overhead removal (C-101) & heavies separation for 99.9% ECH (C-102)' },
    ],
    unitConsumptions: [
      { item: '정제 글리세린 (Glycerin ≥ 99.5%)', itemEn: 'Refined Glycerin (≥ 99.5%)', type: 'RAW', unit: 'ton / t-ECH', qty: 1.04, unitCost_krw: 920000 },
      { item: '무수 염화가스 (Anhydrous HCl)', itemEn: 'Anhydrous Hydrogen Chloride (HCl)', type: 'RAW', unit: 'ton / t-ECH', qty: 0.83, unitCost_krw: 380000 },
      { item: '가성소다 (NaOH 100% 환산)', itemEn: 'Caustic Soda (100% NaOH Basis)', type: 'RAW', unit: 'ton / t-ECH', qty: 0.46, unitCost_krw: 470000 },
      { item: '스트리핑 · 진공증류 스팀 (Steam)', itemEn: 'Stripping & Vacuum Distillation Steam', type: 'UTIL', unit: 'ton / t-ECH', qty: 2.35, unitCost_krw: 62000 },
      { item: '진공시스템 · 공정펌프 전력', itemEn: 'Vacuum System & Process Pump Power', type: 'UTIL', unit: 'kWh / t-ECH', qty: 165.0, unitCost_krw: 135 },
    ],
  },
  cms_plant: {
    key: 'cms_plant',
    code: 'ECON-CMS-04',
    name: '메틸클로라이드 AIBN 액상 염소화 클로로메탄 공정 (MCL 120 + CFM 80 T/D)',
    nameEn: 'Methyl Chloride AIBN Liquid-Phase Chlorination (CMS: MCL 120 + CFM 80 T/D)',
    product: '고순도 메틸렌클로라이드(MCL 99.99%) 120 T/D + 클로로포름(CFM 99.99%) 80 T/D (합계 200 T/D) + 부생 무수 HCl 0.566 t/t-CMS',
    productEn: 'MCL (99.99%) 120 T/D + CFM (99.99%) 80 T/D (Total 200 T/D) + Byproduct AHCl 0.566 t/t-CMS',
    licensor: 'Solvay / Shin-Etsu / Tokuyama Liquid-Phase AIBN Chlorination',
    baseCap_tpy: 66000,
    baseCapex_musd: 68.5,
    scaleExponent: 0.64,
    productPrice_krw: 1180000,
    byproductCredit_krw: 158500, // 부생 무수염산(Anhydrous HCl 0.566 t/t-CMS @ ₩280,000/t) 크레딧
    blocks: [
      { code: '100 SEC', title: 'Cl₂ 기화 & AIBN 액상 염소화', titleEn: 'Cl₂ Vaporization & AIBN Chlorination', desc: 'E-101 액체염소(220 T/D) 기화 및 R-101(24kG·120°C) MC+Cl₂ AIBN 라디칼 연속 염소화', descEn: 'E-101 liquid Cl₂ (220 T/D) vaporization & R-101 (24kG·120°C) continuous AIBN radical chlorination' },
      { code: '200 SEC', title: '고압 무수 HCl 탈거 · MC 순환 · Azeo 분리', titleEn: 'HP AHCl Stripping · MC Recycle · Azeo Sep.', desc: 'C-201(60단 · 17.5 kG) 무수 HCl 탈거(113 T/D), C-202(50단) 미반응 MC 전량 회수 순환(MCL 무순환), C-203(30단) Azeo 경질·수분 분리', descEn: 'C-201 (60-stage, 17.5 kG) AHCl stripping (113 T/D), C-202 (50-stage) unreacted MC total recycle, C-203 (30-stage) Azeo lights/water removal' },
      { code: '300 SEC', title: 'MCL·CFM 정밀증류 & CTC 폐기', titleEn: 'MCL·CFM Precision Distill. & CTC Purge', desc: 'C-301(80단) MCL 99.99% 정제탑(120 T/D) · C-302(120단) CFM 99.99% 정제탑(80 T/D) 및 잔류 CTC·헤비(18 T/D) 분리', descEn: 'C-301 (80-stage) MCL 99.99% purification (120 T/D) · C-302 (120-stage) CFM 99.99% (80 T/D) & CTC/heavies purge (18 T/D)' },
    ],
    unitConsumptions: [
      { item: '액체 염소 원료 (Liquid Cl₂ 99.9%)', itemEn: 'Liquid Chlorine Feed (Cl₂ 99.9%)', type: 'RAW', unit: 'ton / t-CMS', qty: 1.10, unitCost_krw: 295000 },
      { item: '메틸클로라이드 원료 (Methyl Chloride, Fresh MC)', itemEn: 'Methyl Chloride Feed (Fresh MC)', type: 'RAW', unit: 'ton / t-CMS', qty: 0.555, unitCost_krw: 690000 },
      { item: 'AIBN 개시제 & 촉매약품', itemEn: 'AIBN Initiator & Catalyst Chemicals', type: 'RAW', unit: 'kg / t-CMS', qty: 1.25, unitCost_krw: 14500 },
      { item: '잔류 CTC·헤비 위탁소각 폐기비', itemEn: 'Residual CTC / Heavies Incineration Disposal', type: 'RAW', unit: 'ton / t-CMS', qty: 0.090, unitCost_krw: 240000 },
      { item: '기화기·리보일러 가열 스팀 (LP/MP Steam)', itemEn: 'Vaporizer & Reboiler Heating Steam (LP/MP)', type: 'UTIL', unit: 'ton / t-CMS', qty: 1.65, unitCost_krw: 62000 },
      { item: '증류탑 응축기·반응기 순환 냉각수 (CW)', itemEn: 'Condenser & Reactor Cooling Water (CW)', type: 'UTIL', unit: 'm³ / t-CMS', qty: 58.0, unitCost_krw: 350 },
      { item: 'C-201 심냉 응축기 칠드 브라인 (Chilled Brine -20°C)', itemEn: 'C-201 Cryo Condenser Chilled Brine (-20°C)', type: 'UTIL', unit: 'Gcal / t-CMS', qty: 0.145, unitCost_krw: 85000 },
      { item: '고압 순환펌프·냉동기·계장 전력 (Electricity)', itemEn: 'HP Recycle Pumps, Chiller & Instrument Power', type: 'UTIL', unit: 'kWh / t-CMS', qty: 112.0, unitCost_krw: 135 },
    ],
  },
  mdi_plant: {
    key: 'mdi_plant',
    code: 'ECON-MDI-05',
    name: 'MDI 10만톤 통합 플랜트 (MDA · 포스겐화 · Pure/PMDI)',
    nameEn: '100 kTPA Integrated MDI Plant (MDA · Phosgenation · Pure/PMDI)',
    product: 'Pure 4,4\'-MDI (4,500 kg/h · 36%) + Polymeric MDI (8,000 kg/h · 64%) · 합계 12,500 kg/h (100,000 MT/yr) + 부생 무수 HCl 0.659 t/t-MDI',
    productEn: 'Pure 4,4\'-MDI (4,500 kg/h · 36%) + Polymeric MDI (8,000 kg/h · 64%) · Total 12,500 kg/h (100,000 MT/yr) + Byproduct AHCl 0.659 t/t-MDI',
    licensor: '2-Stage Liquid-Phase Phosgenation Process',
    baseCap_tpy: 100000,
    baseCapex_musd: 145.0,
    scaleExponent: 0.65,
    productPrice_krw: 2702000, // Pure 4,4'-MDI (36% @ ₩3,150,000/t) + PMDI (64% @ ₩2,450,000/t) 가중평균 판가
    byproductCredit_krw: 184500, // 부생 무수 HCl 회수(0.659 t/t-MDI @ ₩280,000/t) 크레딧
    blocks: [
      { code: '100 SEC', title: 'MDA 합성·염수분리·아닐린회수', titleEn: 'MDA Synthesis, Brine Decanting & Aniline Recovery', desc: 'Aniline + Formalin(37%) HCl 촉매 축합(R-101) → NaOH 중화 → 염수 디캔터(D-101) → 진공탈수(S-101) & 아닐린 감압회수(C-101)', descEn: 'Aniline + Formalin (37%) HCl condensation (R-101) → NaOH neutralization → brine decanter (D-101) → vacuum dehydration & aniline recovery (C-101)' },
      { code: '200 SEC', title: '포스겐(COCl₂) 제조·2단 포스겐화', titleEn: 'Phosgene Generation & 2-Stage Phosgenation', desc: 'CO + Cl₂ 활성탄 촉매 포스겐 합성(R-201) → MCB 용매 2단 포스겐화 반응(R-202, 145°C) → 부생 무수 HCl 탈거 분리(S-201)', descEn: 'CO + Cl₂ carbon-catalyzed phosgene synthesis (R-201) → 2-stage phosgenation in MCB (R-202, 145°C) → byproduct AHCl stripping (S-201)' },
      { code: '300 SEC', title: '탈포스겐·MCB 용매 진공 회수', titleEn: 'Dephosgenation & Vacuum MCB Recovery', desc: 'C-301(14단 · 2.0 kG) 잔류 포스겐 탈기 순환 → C-302(16단 · -0.90 kG) MCB 용매 진공 회수 및 순환', descEn: 'C-301 (14-stage, 2.0 kG) residual phosgene stripping → C-302 (16-stage, -0.90 kG) vacuum MCB solvent recovery & recycle' },
      { code: '400 SEC', title: '고진공 Pure 4,4\'-MDI / PMDI 분별', titleEn: 'High-Vacuum Pure 4,4\'-MDI / PMDI Fractionation', desc: '박막예열기(E-401, 190°C) → C-401(16단 · 20 mbar) 고진공 분별탑 → Pure 4,4\'-MDI (4,500 kg/h) + PMDI (8,000 kg/h)', descEn: 'Thin-film preheater (E-401, 190°C) → C-401 (16-stage, 20 mbar) high-vacuum fractionator → Pure 4,4\'-MDI (4,500 kg/h) + PMDI (8,000 kg/h)' },
    ],
    unitConsumptions: [
      { item: '아닐린 원료 (Aniline ≥ 99.8%)', itemEn: 'Aniline Feed (≥ 99.8%)', type: 'RAW', unit: 'ton / t-MDI', qty: 0.754, unitCost_krw: 1650000 },
      { item: '포르말린 수용액 (Formalin 37 wt% HCHO)', itemEn: 'Formalin Solution (37 wt% HCHO)', type: 'RAW', unit: 'ton / t-MDI', qty: 0.327, unitCost_krw: 520000 },
      { item: '일산화탄소 원료 (CO ≥ 99.5%)', itemEn: 'Carbon Monoxide Feed (CO ≥ 99.5%)', type: 'RAW', unit: 'ton / t-MDI', qty: 0.240, unitCost_krw: 420000 },
      { item: '건조 염소 원료 (Dry Cl₂ 99.9%)', itemEn: 'Dry Chlorine Feed (Cl₂ 99.9%)', type: 'RAW', unit: 'ton / t-MDI', qty: 0.608, unitCost_krw: 295000 },
      { item: '중화 가성소다 (NaOH 100% 환산 · 30% 투입)', itemEn: 'Neutralization Caustic (100% NaOH Basis · 30% Soln.)', type: 'RAW', unit: 'ton / t-MDI', qty: 0.105, unitCost_krw: 470000 },
      { item: 'MCB 보충 용매 (Monochlorobenzene Make-up)', itemEn: 'MCB Solvent Make-up (Monochlorobenzene)', type: 'RAW', unit: 'ton / t-MDI', qty: 0.060, unitCost_krw: 1350000 },
      { item: '고압/중압 가열 스팀 (C-101·C-301·C-302·E-401/C-401)', itemEn: 'HP/MP Heating Steam (C-101·C-301·C-302·E-401/C-401)', type: 'UTIL', unit: 'ton / t-MDI', qty: 1.42, unitCost_krw: 62000 },
      { item: '공정 전력 (반응교반·진공펌프·이송펌프·냉동기)', itemEn: 'Process Power (Agitators, Vacuum, Transfer Pumps & Chiller)', type: 'UTIL', unit: 'kWh / t-MDI', qty: 182.0, unitCost_krw: 135 },
      { item: '순환 냉각수 (포스겐화 제열·응축기·제품냉각 CW)', itemEn: 'Cooling Water (Phosgenation Duty, Condensers & Product CW)', type: 'UTIL', unit: 'm³ / t-MDI', qty: 64.0, unitCost_krw: 350 },
    ],
  },
  amine_ccus: {
    key: 'amine_ccus',
    code: 'ECON-CC-01',
    name: '아민계(MEA 30 wt%) 연소후 CO₂ 포집·액화 공정 (Post-Combustion CCUS)',
    nameEn: 'Amine (30 wt% MEA) Post-Combustion CO₂ Capture & Liquefaction',
    product: '액화 고순도 이산화탄소 (L-CO₂ 99.9%, 18 barG, -25°C)',
    productEn: 'Liquefied High-Purity CO₂ (L-CO₂ 99.9%, 18 barG, -25°C)',
    licensor: 'Shell CANSOLV / MHI KM-CDR / Fluor Econamine',
    baseCap_tpy: 100000,
    baseCapex_musd: 58.0,
    scaleExponent: 0.65,
    productPrice_krw: 145000,
    byproductCredit_krw: 0,
    blocks: [
      { code: 'DCC', title: '배가스 직접접촉 냉각탑', titleEn: 'Flue Gas Direct-Contact Cooler', desc: '배가스 130°C → 40°C 냉각 및 SOx 미스트 제거', descEn: 'Flue gas cooling 130°C → 40°C & SOx mist polishing' },
      { code: 'ABS', title: 'CO₂ 흡수탑 (Packing)', titleEn: 'CO₂ Absorber Column (Packed)', desc: '30 wt% MEA 수용액 향류 접촉 (CO₂ 포집률 90%+)', descEn: '30 wt% MEA counter-current absorption (≥ 90% CO₂ capture)' },
      { code: 'HEX', title: 'Rich/Lean 아민 열교환기', titleEn: 'Rich/Lean Amine Heat Exchanger', desc: '고온 Lean Amine과 저온 Rich Amine 열회수 (ΔT_min = 8°C)', descEn: 'Hot lean / cold rich amine heat recovery (ΔT_min = 8°C)' },
      { code: 'STR', title: '아민 재생탑 (Stripper)', titleEn: 'Amine Stripper Column', desc: '120°C 리보일러 스팀 가열 CO₂ 탈거 및 용매 재생', descEn: '120°C reboiler steam stripping & solvent regeneration' },
    ],
    unitConsumptions: [
      { item: '아민 용매 보충 (MEA Makeup & 부식방지제)', itemEn: 'Amine Solvent Make-up (MEA & Corrosion Inhibitor)', type: 'RAW', unit: 'kg / t-CO₂', qty: 1.45, unitCost_krw: 3400 },
      { item: '저압 스팀 (리보일러 재생열, 3.5 barG LP Steam)', itemEn: 'LP Steam (Reboiler Regeneration Duty, 3.5 barG)', type: 'UTIL', unit: 'ton / t-CO₂', qty: 1.18, unitCost_krw: 52000 },
      { item: '압축기·냉동기·블로워 전력 (CO₂ Liquefaction)', itemEn: 'Compressor, Chiller & Blower Power (CO₂ Liquefaction)', type: 'UTIL', unit: 'kWh / t-CO₂', qty: 142.0, unitCost_krw: 135 },
      { item: '순환 냉각수 (Cooling Water)', itemEn: 'Circulating Cooling Water (CW)', type: 'UTIL', unit: 'm³ / t-CO₂', qty: 68.0, unitCost_krw: 350 },
    ],
  },
  methanol_purif: {
    key: 'methanol_purif',
    code: 'ECON-ME-01',
    name: '고순도 전자급 메탄올/용제 2탑 증류 회수 공정 (Solvent Recovery)',
    nameEn: 'Electronic-Grade Methanol / Solvent 2-Column Distillation Recovery',
    product: '고순도 정제 메탄올 (99.95 wt% Grade AA)',
    productEn: 'High-Purity Refined Methanol (99.95 wt% Grade AA)',
    licensor: 'Sulzer Chemtech / Koch-Glitsch Distillation',
    baseCap_tpy: 50000,
    baseCapex_musd: 19.5,
    scaleExponent: 0.60,
    productPrice_krw: 790000,
    byproductCredit_krw: 0,
    blocks: [
      { code: 'PRE', title: '원료 예열 열교환기', titleEn: 'Feed Preheater', desc: '폐용제/조메탄올 피드와 탑저 배출수 열교환', descEn: 'Spent solvent / crude methanol feed preheating with bottoms water' },
      { code: 'C-101', title: '경질분 제거탑 (Topping)', titleEn: 'Lights Topping Column', desc: '저비점 불순물(아세톤, 용존가스) 상부 제거', descEn: 'Overhead removal of low-boiling impurities (acetone, dissolved gases)' },
      { code: 'C-102', title: '주 정제 증류탑 (65단)', titleEn: 'Main Refining Column (65 Stages)', desc: '환류비 R=1.85 운전 · 상부 99.95% 정제 메탄올 회수', descEn: 'Reflux ratio R=1.85 · 99.95% refined methanol overhead recovery' },
    ],
    unitConsumptions: [
      { item: '조 메탄올 / 폐용제 원료 (82 wt% 기준)', itemEn: 'Crude Methanol / Spent Solvent Feed (82 wt% Basis)', type: 'RAW', unit: 'ton / t-MeOH', qty: 1.235, unitCost_krw: 380000 },
      { item: '리보일러 중저압 스팀 (6 barG Steam)', itemEn: 'Reboiler MP/LP Steam (6 barG Steam)', type: 'UTIL', unit: 'ton / t-MeOH', qty: 1.32, unitCost_krw: 56000 },
      { item: '응축기 냉각수 (Condenser CW)', itemEn: 'Condenser Cooling Water (CW)', type: 'UTIL', unit: 'm³ / t-MeOH', qty: 54.0, unitCost_krw: 350 },
      { item: '환류/이송 펌프 전력', itemEn: 'Reflux & Transfer Pump Power', type: 'UTIL', unit: 'kWh / t-MeOH', qty: 28.0, unitCost_krw: 135 },
    ],
  },
};

const ECON_KEY_TO_PLANT_ID: Record<string, string | null> = {
  mdi_plant: 'mdi_plant',
  cms_plant: 'cms_plant',
  ech_gte: 'ech_gte',
  hcl_1a: 'hcl_synth',
  chlor_alkali: 'clorsim_sim',
  naoh_evap: 'clorsim_sim',
  amine_ccus: null,
  methanol_purif: null,
};

const GENERIC_ECONOMICS_KEYS = ['amine_ccus', 'methanol_purif'];

function getPlantEconomicsKeys(
  plantId: PlantId,
  user?: { role?: string; allowed_plants?: string[] | null } | null
): string[] {
  if (isSimulatorOnlyUser(user) || plantId === 'new_builder' || plantId === 'classic_sim') {
    return GENERIC_ECONOMICS_KEYS;
  }
  const baseKeys = (() => {
    switch (plantId) {
      case 'clorsim':
      case 'clorsim_sim':
        return ['chlor_alkali', 'naoh_evap'];
      case 'hcl_synth':
        return ['hcl_1a'];
      case 'ech_gte':
        return ['ech_gte'];
      case 'cms_plant':
        return ['cms_plant'];
      case 'mdi_plant':
        return ['mdi_plant'];
      default:
        return GENERIC_ECONOMICS_KEYS;
    }
  })();

  const filtered = baseKeys.filter(key => {
    const mappedPlant = ECON_KEY_TO_PLANT_ID[key];
    if (!mappedPlant) return true;
    return isPlantAllowed(mappedPlant, user);
  });
  return filtered.length > 0 ? filtered : GENERIC_ECONOMICS_KEYS;
}

export default function ProcessEconomicsPage() {
  const { user } = useAuth();
  const activePlantId = useBalanceStore(s => s.activePlantId);
  const lang = useUnitStore(s => s.lang);
  const isEn = lang === 'en';
  const t = (ko: string, en: string) => (isEn ? en : ko);
  const plantMeta = getPlantRegistryItem(activePlantId);
  const allowedKeys = useMemo(() => getPlantEconomicsKeys(activePlantId, user), [activePlantId, user]);
  const [subMode, setSubMode]         = useState<'econ' | 'standards'>('econ');
  const [procKey, setProcKey]         = useState<string>(() => allowedKeys[0]);
  const [capTpy, setCapTpy]           = useState<number>(() => PROCESS_ECONOMICS_DB[allowedKeys[0]]?.baseCap_tpy ?? 100000);
  const [opHours, setOpHours]         = useState<number>(8000);
  const [fxKrw, setFxKrw]             = useState<number>(1380);
  const [powerCost, setPowerCost]     = useState<number>(135);
  const [steamCost, setSteamCost]     = useState<number>(62000);

  const canViewStandards = !isSimulatorOnlyUser(user) && isPlantAllowed('clorsim_sim', user) && activePlantId === 'clorsim';

  useEffect(() => {
    if (!canViewStandards && subMode === 'standards') {
      setSubMode('econ');
    }
    if (!allowedKeys.includes(procKey)) {
      const nextKey = allowedKeys[0];
      setProcKey(nextKey);
      const p = PROCESS_ECONOMICS_DB[nextKey];
      if (p) setCapTpy(p.baseCap_tpy);
    }
  }, [canViewStandards, allowedKeys, procKey, subMode]);

  const proc = PROCESS_ECONOMICS_DB[procKey] ?? PROCESS_ECONOMICS_DB[allowedKeys[0]] ?? PROCESS_ECONOMICS_DB.amine_ccus;

  const handleProcChange = (newKey: string) => {
    setProcKey(newKey);
    const p = PROCESS_ECONOMICS_DB[newKey];
    if (p) setCapTpy(p.baseCap_tpy);
  };

  const scaleRatio = Math.max(0.05, capTpy / proc.baseCap_tpy);
  const isbl_musd = proc.baseCapex_musd * Math.pow(scaleRatio, proc.scaleExponent);
  const osbl_musd = isbl_musd * 0.32;
  const engContingency_musd = (isbl_musd + osbl_musd) * 0.18;
  const totalCapex_musd = isbl_musd + osbl_musd + engContingency_musd;
  const totalCapex_bkrw = (totalCapex_musd * fxKrw) / 100;
  const prodRate_tph = capTpy / Math.max(100, opHours);

  let rawCostPerTon = 0;
  let utilCostPerTon = 0;

  const computedRows = proc.unitConsumptions.map(u => {
    let appliedCost = u.unitCost_krw;
    if (u.unit.includes('kWh')) appliedCost = powerCost;
    if (u.item.includes('스팀')) appliedCost = steamCost;
    const costPerTon = u.qty * appliedCost;
    const hourlyQty = u.qty * prodRate_tph;
    if (u.type === 'RAW') rawCostPerTon += costPerTon;
    else utilCostPerTon += costPerTon;
    return { ...u, appliedCost, costPerTon, hourlyQty };
  });

  const annualCapex_krw = totalCapex_musd * 1e6 * fxKrw;
  const deprPerTon = (annualCapex_krw * 0.10) / Math.max(1, capTpy);
  const maintLaborPerTon = (annualCapex_krw * 0.055) / Math.max(1, capTpy);
  const fixedOpexPerTon = deprPerTon + maintLaborPerTon;
  const totalMfgCostPerTon = rawCostPerTon + utilCostPerTon + fixedOpexPerTon - proc.byproductCredit_krw;
  const marginPerTon = proc.productPrice_krw - totalMfgCostPerTon;
  const annualEbitda_bkrw = ((marginPerTon + deprPerTon) * capTpy) / 1e8;
  const paybackYrs = annualEbitda_bkrw > 0 ? totalCapex_bkrw / annualEbitda_bkrw : 99.9;

  const exportEconomicsExcel = () => {
    const wb = XLSX.utils.book_new();
    const PLANT_TITLE_EN: Record<string, string> = {
      clorsim: 'Electrolysis Reference Mass Balance (CA 468 T/D)',
      clorsim_sim: 'Chlor-Alkali Electrolysis Integrated Plant',
      hcl_synth: '5N AHCl & Spent HCl PSD Plant',
      ech_gte: 'GTE Epichlorohydrin (ECH) Plant',
      cms_plant: 'Chloromethanes (MCL/CFM) Plant',
      mdi_plant: '100 kTPA Integrated MDI Plant',
      new_builder: 'New Flowsheet Builder',
      classic_sim: 'Classic Process Simulator',
    };
    const plantLabel = isEn ? (PLANT_TITLE_EN[activePlantId] || plantMeta.code) : plantMeta.title;
    const rows = isEn
      ? [
          ['CHEMPLANT STUDIO — Process Unit Consumption & Economics Report'],
          ['Target Plant', showPlantNumbersForUser(user) ? `${plantMeta.code} (${plantLabel})` : plantLabel],
          ['Process Code', proc.code, 'Process Name', proc.nameEn],
          ['Reference Product', proc.productEn, 'Representative Licensors', proc.licensor],
          ['Annual Capacity (t/yr)', capTpy, 'Annual Operating Hours (hr/yr)', opHours],
          ['Total CAPEX (×10⁸ KRW)', +totalCapex_bkrw.toFixed(1), 'Total CAPEX ($M)', +totalCapex_musd.toFixed(2)],
          ['Raw Material Cost (KRW/t)', Math.round(rawCostPerTon), 'Utilities Cost (KRW/t)', Math.round(utilCostPerTon)],
          ['Fixed OPEX / Depr. (KRW/t)', Math.round(fixedOpexPerTon), 'Net Mfg. Cost (KRW/t)', Math.round(totalMfgCostPerTon)],
          ['Annual EBITDA (×10⁸ KRW/yr)', +annualEbitda_bkrw.toFixed(1), 'Simple Payback (yr)', +paybackYrs.toFixed(2)],
          [],
          ['Type', 'Raw Material / Utility Item', 'Unit Consumption', 'Unit', 'Hourly Flow', 'Applied Price (KRW)', 'Cost per Ton (KRW/ton)'],
          ...computedRows.map(r => [
            r.type === 'RAW' ? 'Raw Material' : 'Utility',
            r.itemEn, r.qty, r.unit, +r.hourlyQty.toFixed(2), r.appliedCost, Math.round(r.costPerTon)
          ]),
          [''],
          ['[Engineering Disclaimer]', ENGINEERING_DISCLAIMER_EN],
        ]
      : [
          ['CHEMPLANT STUDIO — 공정 원단위 및 경제성 평가 보고서'],
          ['대상 공장', showPlantNumbersForUser(user) ? `${plantMeta.code} (${plantMeta.title})` : plantMeta.title],
          ['공정 코드', proc.code, '공정명', proc.name],
          ['기준 제품', proc.product, '대표 라이센서', proc.licensor],
          ['연간 생산능력 (t/yr)', capTpy, '연간 가동시간 (hr/yr)', opHours],
          ['총 투자비 CAPEX (억원)', +totalCapex_bkrw.toFixed(1), '총 투자비 CAPEX ($M)', +totalCapex_musd.toFixed(2)],
          ['톤당 원료비 (원/t)', Math.round(rawCostPerTon), '톤당 유틸리티비 (원/t)', Math.round(utilCostPerTon)],
          ['톤당 고정비/감가상각 (원/t)', Math.round(fixedOpexPerTon), '톤당 순 제조원가 (원/t)', Math.round(totalMfgCostPerTon)],
          ['연간 EBITDA (억원/yr)', +annualEbitda_bkrw.toFixed(1), '단순 투자회수기간 (년)', +paybackYrs.toFixed(2)],
          [],
          ['구분', '원료 / 유틸리티 항목', '투입 원단위', '단위', '시간당 투입량', '적용 단가(원)', '제품 1톤당 원가(원/ton)'],
          ...computedRows.map(r => [
            r.type === 'RAW' ? '원료 (Raw Material)' : '유틸리티 (Utility)',
            r.item, r.qty, r.unit, +r.hourlyQty.toFixed(2), r.appliedCost, Math.round(r.costPerTon)
          ]),
          ...ENGINEERING_DISCLAIMER_ROWS,
        ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Process_Economics');
    XLSX.writeFile(wb, `${proc.code}_Process_Economics_Report.xlsx`);
  };

  if (canViewStandards && subMode === 'standards') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#F6F7F2' }}>
        <div
          style={{
            padding: '8px 18px',
            background: '#FFFFFF',
            borderBottom: '1px solid #DFDCD4',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setSubMode('econ')}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid #CBD5E1',
              background: '#F8FAFC',
              color: '#334155',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {t('📊 공정 경제성 · 원단위 분석', '📊 Process Economics & Unit Consumption')}
          </button>
          <button
            type="button"
            onClick={() => setSubMode('standards')}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1.5px solid #0F5338',
              background: '#0F5338',
              color: '#FFFFFF',
              fontSize: 11.5,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            {t('📘 전해공정 설계기준서 (Design Basis)', '📘 Electrolysis Design Basis')}
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <DesignStandards />
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '20px 26px', background: '#F6F7F2', color: '#18181B' }}>
      <div style={{ maxWidth: 99999, margin: '0 auto' }}>
        {/* PLANT 01 전용: 경제성 ↔ 설계기준 전환 서브바 */}
        {activePlantId === 'clorsim' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setSubMode('econ')}
              style={{
                padding: '6px 13px',
                borderRadius: 6,
                border: '1.5px solid #0F5338',
                background: '#0F5338',
                color: '#FFFFFF',
                fontSize: 11.5,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {t('📊 공정 경제성 · 원단위 분석', '📊 Process Economics & Unit Consumption')}
            </button>
            <button
              type="button"
              onClick={() => setSubMode('standards')}
              style={{
                padding: '6px 13px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#334155',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t('📘 전해공정 설계기준서 (Design Basis)', '📘 Electrolysis Design Basis')}
            </button>
          </div>
        )}

        {/* Header Card */}
        <div style={{
          padding: '16px 20px', borderRadius: 10, marginBottom: 16,
          background: '#FFFFFF',
          border: '1px solid #DFDCD4',
          borderLeft: `4px solid ${plantMeta.accent}`,
          display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          boxShadow: '0 1px 3px rgba(24,24,27,0.04)',
        }}>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 900, color: '#0F172A' }}>
              {showPlantNumbersForUser(user) ? `[${plantMeta.code}] ` : ''}
              {isEn ? (
                ({
                  clorsim: 'Electrolysis Reference Mass Balance',
                  clorsim_sim: 'Chlor-Alkali Electrolysis Plant',
                  hcl_synth: '5N AHCl & PSD Recovery Plant',
                  ech_gte: 'GTE Epichlorohydrin Plant',
                  cms_plant: 'Chloromethanes Plant',
                  mdi_plant: 'Integrated MDI Plant',
                  new_builder: 'New Flowsheet Builder',
                  classic_sim: 'Classic Process Simulator',
                } as Record<string, string>)[activePlantId] || plantMeta.code
              ) : plantMeta.title}
              {t(' — 공정 경제성 · 원단위 분석 (Process Economics)', ' — Process Economics & Unit Consumption')}
            </div>
            <div style={{ fontSize: 11.5, color: '#52525B', marginTop: 3 }}>
              {t(
                '선택된 공장의 원료·유틸리티 원단위(Unit Consumption), 설비 투자비(Six-Tenths Rule), 제조원가 및 수익성을 평가합니다.',
                'Evaluate raw material & utility unit consumption, CAPEX (Six-Tenths Rule), manufacturing cost, and profitability for the selected plant.'
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={exportEconomicsExcel}
              style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 800,
                background: '#1A2F44', border: '1px solid #1A2F44', color: '#FFFFFF', cursor: 'pointer',
              }}
            >
              {t('엑셀(.xlsx) 원단위·경제성 리포트 다운로드', 'Download Excel (.xlsx) Economics Report')}
            </button>
            <Link
              href={plantMeta.defaultHref}
              style={{
                padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                background: '#EFECE5', border: '1px solid #1A2F44', color: '#1A2F44', textDecoration: 'none',
              }}
            >
              {t('공정도 · 시뮬레이터로 이동 →', 'Open Flowsheet / Simulator →')}
            </Link>
          </div>
        </div>

        {/* Process Selector & Parameter Controls */}
        <div style={{
          padding: '16px 20px', borderRadius: 10, marginBottom: 16,
          background: '#FFFFFF', border: '1px solid #E5E2DC',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={{ gridColumn: 'span 2', minWidth: 260 }}>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 4 }}>
                {activePlantId === 'new_builder' || activePlantId === 'classic_sim'
                  ? t('신규 프로젝트 벤치마크 공정 선택', 'New Project Benchmark Process')
                  : showPlantNumbersForUser(user)
                    ? t(`${plantMeta.code} 적용 공정 패키지`, `${plantMeta.code} Process Package`)
                    : t(`${plantMeta.shortLabel} 적용 공정 패키지`, 'Applied Process Package')}
              </label>
              <select
                value={proc.key}
                onChange={e => handleProcChange(e.target.value)}
                style={{ width: '100%', height: 34, background: '#FFFFFF', color: '#18181B', border: '1px solid #DFDCD4', borderRadius: 6, padding: '0 10px', fontSize: 12, fontWeight: 700 }}
              >
                {allowedKeys.map(k => {
                  const p = PROCESS_ECONOMICS_DB[k];
                  if (!p) return null;
                  return (
                    <option key={p.key} value={p.key}>[{p.code}] {isEn ? p.nameEn : p.name}</option>
                  );
                })}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 4 }}>
                {t('연간 생산규모 (ton/yr)', 'Annual Capacity (ton/yr)')}
              </label>
              <input type="number" value={capTpy} step={5000} onChange={e => setCapTpy(Number(e.target.value))} style={{ width: '100%', height: 34, background: '#FFFFFF', color: '#18181B', border: '1px solid #DFDCD4', borderRadius: 6, padding: '0 10px', fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 4 }}>
                {t('연간 가동시간 (hr/yr)', 'Operating Hours (hr/yr)')}
              </label>
              <input type="number" value={opHours} step={100} onChange={e => setOpHours(Number(e.target.value))} style={{ width: '100%', height: 34, background: '#FFFFFF', color: '#18181B', border: '1px solid #DFDCD4', borderRadius: 6, padding: '0 10px', fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 4 }}>
                {t('전력 단가 (원/kWh)', 'Power Price (KRW/kWh)')}
              </label>
              <input type="number" value={powerCost} step={5} onChange={e => setPowerCost(Number(e.target.value))} style={{ width: '100%', height: 34, background: '#FFFFFF', color: '#18181B', border: '1px solid #DFDCD4', borderRadius: 6, padding: '0 10px', fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 4 }}>
                {t('스팀 단가 (원/ton)', 'Steam Price (KRW/ton)')}
              </label>
              <input type="number" value={steamCost} step={2000} onChange={e => setSteamCost(Number(e.target.value))} style={{ width: '100%', height: 34, background: '#FFFFFF', color: '#18181B', border: '1px solid #DFDCD4', borderRadius: 6, padding: '0 10px', fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#52525B', display: 'block', marginBottom: 4 }}>
                {t('기준 환율 (KRW/USD)', 'FX Rate (KRW/USD)')}
              </label>
              <input type="number" value={fxKrw} step={10} onChange={e => setFxKrw(Number(e.target.value))} style={{ width: '100%', height: 34, background: '#FFFFFF', color: '#18181B', border: '1px solid #DFDCD4', borderRadius: 6, padding: '0 10px', fontSize: 12 }} />
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#3F3F46', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span><b>{t('기준 제품:', 'Reference Product:')}</b> {isEn ? proc.productEn : proc.product}</span>
            <span><b>{t('대표 상용 라이센서:', 'Representative Licensors:')}</b> {proc.licensor}</span>
          </div>
        </div>

        {/* 5 KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
          <KpiCard
            label={t('총 설비투자비 (Total CAPEX)', 'Total CAPEX')}
            value={isEn ? `${totalCapex_bkrw.toFixed(0)} ×10⁸ ₩` : `${totalCapex_bkrw.toFixed(0)} 억원`}
            sub={`$${totalCapex_musd.toFixed(1)}M (ISBL $${isbl_musd.toFixed(1)}M · OSBL $${osbl_musd.toFixed(1)}M)`}
            highlight
          />
          <KpiCard
            label={t('원료 투입 원가 (Raw Materials)', 'Raw Materials Cost')}
            value={`₩${Math.round(rawCostPerTon).toLocaleString()} /t`}
            sub={t(`시간당 생산량 ${prodRate_tph.toFixed(1)} ton/h`, `Throughput ${prodRate_tph.toFixed(1)} ton/h`)}
          />
          <KpiCard
            label={t('유틸리티 원가 (Utilities)', 'Utilities Cost')}
            value={`₩${Math.round(utilCostPerTon).toLocaleString()} /t`}
            sub={t(
              `전력 ₩${powerCost}/kWh · 스팀 ₩${(steamCost / 1000).toFixed(0)}k/t`,
              `Power ₩${powerCost}/kWh · Steam ₩${(steamCost / 1000).toFixed(0)}k/t`
            )}
          />
          <KpiCard
            label={t('제품 1톤당 순 제조원가', 'Net Manufacturing Cost')}
            value={`₩${Math.round(totalMfgCostPerTon).toLocaleString()} /t`}
            sub={t(
              `$${(totalMfgCostPerTon / fxKrw).toFixed(0)} /ton (감가상각 포함 · 부산물 차감)`,
              `$${(totalMfgCostPerTon / fxKrw).toFixed(0)} /ton (incl. Depr. · net of Byproduct)`
            )}
            highlight
          />
          <KpiCard
            label={t('연간 EBITDA & 투자회수기간', 'Annual EBITDA & Payback')}
            value={isEn ? `${paybackYrs.toFixed(1)} yr` : `${paybackYrs.toFixed(1)} 년`}
            sub={isEn ? `Annual EBITDA ${annualEbitda_bkrw.toFixed(0)} ×10⁸ ₩/yr` : `연간 EBITDA ${annualEbitda_bkrw.toFixed(0)} 억원/yr`}
          />
        </div>

        {proc.key === 'mdi_plant' && (
          <div style={{
            padding: '12px 18px', borderRadius: 10, marginBottom: 16,
            background: '#FFFBEB', border: '1px solid #FCD34D',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#92400E' }}>
                {t('Pure 4,4\'-MDI 매출 (36 wt%)', 'Pure 4,4\'-MDI Revenue (36 wt%)')}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#78350F', fontFamily: 'monospace', marginTop: 2 }}>
                {(prodRate_tph * 1000 * 0.36).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg/h · ₩{((capTpy * 0.36 * 3150000) / 1e8).toFixed(0)} {isEn ? '×10⁸/yr' : '억원/yr'}
              </div>
              <div style={{ fontSize: 10, color: '#92400E' }}>
                {t(`판가 ₩3,150,000 /ton 기준 (${(capTpy * 0.36).toLocaleString()} MT/yr)`, `At ₩3,150,000 /ton (${(capTpy * 0.36).toLocaleString()} MT/yr)`)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#92400E' }}>
                {t('Polymeric MDI (PMDI) 매출 (64 wt%)', 'Polymeric MDI (PMDI) Revenue (64 wt%)')}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#78350F', fontFamily: 'monospace', marginTop: 2 }}>
                {(prodRate_tph * 1000 * 0.64).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg/h · ₩{((capTpy * 0.64 * 2450000) / 1e8).toFixed(0)} {isEn ? '×10⁸/yr' : '억원/yr'}
              </div>
              <div style={{ fontSize: 10, color: '#92400E' }}>
                {t(`판가 ₩2,450,000 /ton 기준 (${(capTpy * 0.64).toLocaleString()} MT/yr)`, `At ₩2,450,000 /ton (${(capTpy * 0.64).toLocaleString()} MT/yr)`)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#065F46' }}>
                {t('부생 무수 HCl 회수 크레딧', 'Byproduct Anhydrous HCl Credit')}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#065F46', fontFamily: 'monospace', marginTop: 2 }}>
                {(prodRate_tph * 0.659 * 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg/h · ₩{((capTpy * proc.byproductCredit_krw) / 1e8).toFixed(1)} {isEn ? '×10⁸/yr' : '억원/yr'}
              </div>
              <div style={{ fontSize: 10, color: '#047857' }}>₩{proc.byproductCredit_krw.toLocaleString()} /t-MDI (0.659 t-HCl/t-MDI @ ₩280k/t)</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#1E3A8A' }}>
                {t('ISBL / OSBL / Eng. CAPEX 세부', 'ISBL / OSBL / Eng. CAPEX Breakdown')}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#1E3A8A', fontFamily: 'monospace', marginTop: 2 }}>
                ISBL ${isbl_musd.toFixed(1)}M · OSBL ${osbl_musd.toFixed(1)}M
              </div>
              <div style={{ fontSize: 10, color: '#334155' }}>
                {t(
                  `설계·예비비 $${engContingency_musd.toFixed(1)}M 포함 총 $${totalCapex_musd.toFixed(1)}M`,
                  `Total $${totalCapex_musd.toFixed(1)}M incl. Eng. & Contingency $${engContingency_musd.toFixed(1)}M`
                )}
              </div>
            </div>
          </div>
        )}

        {/* Standardized Process Block Flow Diagram */}
        <div style={{
          padding: '16px 20px', borderRadius: 10, marginBottom: 16,
          background: '#FFFFFF', border: '1px solid #E5E2DC',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#27272A', marginBottom: 12 }}>
            {t('표준 공정 블록 플로우 다이어그램 (Standardized Process Block PFD)', 'Standardized Process Block Flow Diagram (Block PFD)')}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {proc.blocks.map((b, idx) => (
              <div key={b.code} style={{
                flex: 1, minWidth: 185, background: '#F6F7F2',
                border: '1px solid #E5E2DC', borderTop: `3px solid ${plantMeta.accent}`,
                borderRadius: 8, padding: '12px 14px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: plantMeta.accent }}>STEP {idx + 1} · {b.code}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#18181B', margin: '4px 0' }}>{isEn ? b.titleEn : b.title}</div>
                <div style={{ fontSize: 11, color: '#52525B', lineHeight: 1.45 }}>{isEn ? b.descEn : b.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Raw Material & Utility Unit Consumption Table */}
        <div style={{
          padding: '16px 20px', borderRadius: 10,
          background: '#FFFFFF', border: '1px solid #E5E2DC',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#27272A', marginBottom: 12 }}>
            {t(
              '제품 1톤당 원료 · 유틸리티 투입 원단위 및 제조원가 명세표 (Unit Consumption & Cost Breakdown)',
              'Unit Consumption & Manufacturing Cost Breakdown (Per Ton of Product)'
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 780 }}>
              <thead>
                <tr style={{ background: '#EFECE5' }}>
                  {(isEn
                    ? ['Type', 'Raw Material / Utility Item', 'Unit Consumption', 'Unit', 'Hourly Flow', 'Applied Price (₩)', 'Cost per Ton (₩/ton)']
                    : ['구분', '원료 / 유틸리티 항목', '투입 원단위', '단위', '시간당 소요량', '적용 단가 (₩)', '제품 1톤당 원가 (₩/ton)']
                  ).map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#1A2F44', fontWeight: 700, borderBottom: '1px solid #DFDCD4' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {computedRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #ECEAE4', background: i % 2 === 0 ? '#FFFFFF' : '#F6F7F2' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4,
                        background: '#EFECE5',
                        color: r.type === 'RAW' ? '#1A2F44' : '#3F3F46',
                      }}>
                        {r.type === 'RAW' ? t('원료', 'RAW') : t('유틸리티', 'UTIL')}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#18181B' }}>{isEn ? r.itemEn : r.item}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 800, color: '#1A2F44' }}>{r.qty.toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', color: '#52525B' }}>{r.unit}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#3F3F46' }}>{r.hourlyQty.toFixed(2)} /hr</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#3F3F46' }}>₩{r.appliedCost.toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 800, color: '#1A2F44' }}>₩{Math.round(r.costPerTon).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 계산 방법론 및 출처 고지 (Verified Methodology & References) ── */}
        <details
          open
          style={{
            marginTop: 14,
            background: '#FFFFFF',
            border: '1px solid #E5E2DC',
            borderRadius: 10,
            padding: '14px 16px',
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 900,
              color: '#1A2F44',
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>
              {t(
                '📐 계산 방법론 · 가정치 및 참고 문헌 고지 (AACE Class 4/5 개략 견적)',
                '📐 Calculation Methodology, Assumptions & Verified References (AACE Class 4/5)'
              )}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>
              {t('접기 / 펼치기', 'Toggle')}
            </span>
          </summary>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 14, fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '11px 13px' }}>
              <div style={{ fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>
                {t('1. 적용된 계산 수식 (실제 코드 기준)', '1. Implemented Equations (Code Basis)')}
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#1E293B' }}>
                <li>ISBL = Base_CAPEX × (Cap / Base_Cap)ⁿ  (n = {proc.scaleExponent.toFixed(2)})</li>
                <li>OSBL = 0.32 × ISBL</li>
                <li>Eng. &amp; Contingency = 0.18 × (ISBL + OSBL)</li>
                <li>Total CAPEX = ISBL + OSBL + Contingency</li>
                <li>Depreciation = 10.0%/yr × Total CAPEX (10-yr SL)</li>
                <li>Maint. &amp; Labor = 5.5%/yr × Total CAPEX</li>
                <li>Mfg Cost = Raw + Util + Fixed OPEX − Byproduct Credit</li>
                <li>Simple Payback = Total CAPEX / Annual EBITDA</li>
              </ul>
            </div>

            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '11px 13px' }}>
              <div style={{ fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>
                {t('2. 검증된 표준 참고 문헌 (Methodology Basis)', '2. Verified Engineering References')}
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: '#334155' }}>
                <li>
                  <b>AACE International RP 18R-97</b> — <i>Cost Estimate Classification System for the Process Industries</i> (Class 4 / Class 5 Factored Screening Estimate, typical accuracy −30% to +50%).
                </li>
                <li>
                  <b>Peters, M. S., Timmerhaus, K. D., &amp; West, R. E.</b> — <i>Plant Design and Economics for Chemical Engineers</i>, 5th Ed., McGraw-Hill (2003): Six-Tenths / Capacity-Exponent power-law scaling, OSBL &amp; contingency factoring, and straight-line depreciation / fixed OPEX structure.
                </li>
                <li>
                  <b>Towler, G., &amp; Sinnott, R.</b> — <i>Chemical Engineering Design: Principles, Practice and Economics of Plant and Process Design</i>, Butterworth-Heinemann (2012/2021): ISBL/OSBL factored capital estimation and manufacturing cost breakdown.
                </li>
              </ul>
            </div>
          </div>

          <div
            style={{
              marginTop: 10,
              padding: '9px 12px',
              borderRadius: 7,
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              fontSize: 11.5,
              color: '#92400E',
              lineHeight: 1.55,
            }}
          >
            <b>{t('⚠ 적용 범위 및 한계 고지:', '⚠ Scope & Limitation Notice:')}</b>{' '}
            {t(
              '각 공정의 기준 CAPEX, 원단위(Unit Consumption), 국내 산업용 전력(135원/kWh)·스팀(62,000원/t) 및 원료 단가는 초기 타당성 검토(Conceptual Screening)용 산업 평균 참고치입니다. CEPCI 물가지수 보정, 부지·인허가·금융이자 및 할인현금흐름(NPV/IRR)은 포함되어 있지 않으므로, 실제 투자 의사결정 및 EPC 발주 시에는 벤더 견적서(Vendor Quote) 기반의 상세 견적(Class 2/3)으로 별도 검증해야 합니다.',
              'Base CAPEX, unit consumptions, and reference utility/feedstock prices (135 KRW/kWh power, 62,000 KRW/t steam) are indicative industry benchmarks for conceptual screening only. CEPCI escalation, site-specific civil/permitting costs, financing, and DCF (NPV/IRR) are excluded; actual EPC investment decisions require vendor-quoted Class 2/3 estimates.'
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 8,
      background: highlight ? '#F6F7F2' : '#FFFFFF',
      border: '1px solid #E5E2DC',
      borderLeft: `3px solid ${highlight ? '#1A2F44' : '#A1A1AA'}`,
    }}>
      <div style={{ fontSize: 10.5, color: '#52525B', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: highlight ? '#1A2F44' : '#18181B', marginTop: 4, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#71717A', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

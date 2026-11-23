/**
 * Process Economics & Unit Consumption Handbook (공정 경제성 · 원단위 핸드북)
 *
 * 100% public engineering literature basis:
 * - Ullmann's Encyclopedia of Industrial Chemistry
 * - Kirk-Othmer Encyclopedia of Chemical Technology
 * - Turton et al., Analysis, Synthesis, and Design of Chemical Processes (CEPCI = 800 baseline)
 * - IEA Global Hydrogen Review & CCUS Techno-Economic Reports / NREL H2A
 *
 * Trademark-neutral, open-literature stoichiometry and CAPEX/OPEX scaling model.
 */

import { HANDBOOK_PETROCHEM_EXTRA } from './handbookDataPetrochem';
import { HANDBOOK_POLYMERS_EXTRA } from './handbookDataPolymers';
import { HANDBOOK_INORGANIC_EXTRA } from './handbookDataInorganic';
import { HANDBOOK_BATTERY_GREEN_EXTRA } from './handbookDataBatteryGreen';

export type HandbookCategory =
  | 'petrochem'
  | 'inorganic'
  | 'fine_polymer'
  | 'battery_green';

export interface HandbookFeedItem {
  id: string;
  name: string;
  unit: string;
  consumptionPerT: number;
  defaultPriceUsd: number;
  note?: string;
}

export interface HandbookUtilityItem {
  id: string;
  name: string;
  unit: string;
  consumptionPerT: number;
  defaultPriceUsd: number;
  kind: 'power' | 'steam' | 'cw' | 'fuel' | 'other';
}

export interface HandbookByproductItem {
  id: string;
  name: string;
  unit: string;
  yieldPerT: number;
  creditPriceUsd: number;
}

export interface HandbookProcessEntry {
  id: string;
  productGroup: string;
  category: HandbookCategory;
  nameKo: string;
  nameEn: string;
  formula: string;
  routeNameKo: string;
  routeNameEn: string;
  reactionEq: string;
  operatingSummary: string;
  blockSteps: string[];
  baseCapacityTpa: number;
  /** Base Inside Battery Limits (ISBL) CAPEX in M USD at CEPCI = 800 */
  baseIsblMUsd: number;
  /** OSBL as a ratio of ISBL (e.g., 0.35 = 35% of ISBL) */
  osblRatio: number;
  /** Six-tenths / capacity scaling exponent (e.g., 0.65) */
  scaleExponent: number;
  referenceProductPriceUsdPerT: number;
  rawMaterials: HandbookFeedItem[];
  utilities: HandbookUtilityItem[];
  byproducts: HandbookByproductItem[];
  /** Annual fixed operating cost as % of Total CAPEX (e.g., 4.5 = 4.5%/yr) */
  fixedCostPctCapex: number;
  depreciationYears: number;
  sourceNote: string;
  keywords: string[];
}

export interface HandbookCalcOverrides {
  capacityTpa?: number;
  cepci?: number;
  fxKrwPerUsd?: number;
  productPriceUsd?: number;
  powerPriceUsdPerKwh?: number;
  steamPriceUsdPerT?: number;
  feedPriceOverrides?: Record<string, number>;
  utilPriceOverrides?: Record<string, number>;
  byproductPriceOverrides?: Record<string, number>;
}

export interface HandbookRawMaterialLine {
  id: string;
  name: string;
  unit: string;
  consumptionPerT: number;
  unitPriceUsd: number;
  costUsdPerT: number;
  note?: string;
}

export interface HandbookUtilityLine {
  id: string;
  name: string;
  unit: string;
  kind: HandbookUtilityItem['kind'];
  consumptionPerT: number;
  unitPriceUsd: number;
  costUsdPerT: number;
}

export interface HandbookByproductLine {
  id: string;
  name: string;
  unit: string;
  yieldPerT: number;
  creditPriceUsd: number;
  creditUsdPerT: number;
}

export interface HandbookCalcResult {
  capacityTpa: number;
  cepci: number;
  fxKrwPerUsd: number;
  isblMUsd: number;
  osblMUsd: number;
  totalCapexMUsd: number;
  totalCapexEokKrw: number;
  rawMaterialUsdPerT: number;
  utilityUsdPerT: number;
  byproductCreditUsdPerT: number;
  netVariableUsdPerT: number;
  fixedCostUsdPerT: number;
  depreciationUsdPerT: number;
  totalProdCostUsdPerT: number;
  totalProdCostKrwPerT: number;
  productPriceUsdPerT: number;
  grossMarginUsdPerT: number;
  annualRevenueEokKrw: number;
  annualEbitdaEokKrw: number;
  paybackYears: number;
  roiPct: number;
  rawMaterialLines: HandbookRawMaterialLine[];
  utilityLines: HandbookUtilityLine[];
  byproductLines: HandbookByproductLine[];
}

export const BASE_CEPCI = 800;
export const DEFAULT_FX_KRW_PER_USD = 1380;

export const HANDBOOK_CATEGORIES: {
  id: HandbookCategory;
  nameKo: string;
  nameEn: string;
  descriptionKo: string;
}[] = [
  {
    id: 'petrochem',
    nameKo: '석유화학 기초',
    nameEn: 'Petrochemicals',
    descriptionKo: '올레핀 · 방향족 · C1/C2/C3 유도품',
  },
  {
    id: 'inorganic',
    nameKo: '무기화학 · 산/알칼리',
    nameEn: 'Inorganics & Chlor-Alkali',
    descriptionKo: '전해 · 무기산 · 암모니아 · 소다회',
  },
  {
    id: 'fine_polymer',
    nameKo: '정밀화학 · 고분자 원료',
    nameEn: 'Fine Chemicals & Monomers',
    descriptionKo: '에폭시 · 폴리우레탄 · 폴리카보네이트 · 배터리 용매',
  },
  {
    id: 'battery_green',
    nameKo: '이차전지 · 수소 · CCUS',
    nameEn: 'Battery, H₂ & CCUS',
    descriptionKo: '블루/그린수소 · 리튬 전환 · 탄소포집',
  },
];

export const PROCESS_ECONOMICS_HANDBOOK: HandbookProcessEntry[] = [
  // =========================================================================
  // 1. PETROCHEM (10)
  // =========================================================================
  {
    id: 'ethylene_ncc',
    productGroup: 'Ethylene',
    category: 'petrochem',
    nameKo: '에틸렌',
    nameEn: 'Ethylene',
    formula: 'C₂H₄',
    routeNameKo: '나프타 열분해 (NCC)',
    routeNameEn: 'Naphtha Steam Cracking (NCC)',
    reactionEq: 'Naphtha (C₅–C₁₀) + Steam → C₂H₄ + C₃H₆ + C₄ + Pygas + CH₄/H₂',
    operatingSummary: '800–850°C, 1.5–2.0 bar, 체류시간 0.1–0.3 s, 극저온 분별증류 (-100°C)',
    blockSteps: [
      '나프타 예열 및 열분해로 (Cracking Furnace)',
      '급랭 열교환기 (TLE) 및 오일/워터 켄칭',
      '분해가스 5단 압축 및 산성가스 제거',
      '극저온 탈메탄/탈에탄/탈프로판탑 분별증류',
      '아세틸렌 수소화 및 고순도 에틸렌 정제',
    ],
    baseCapacityTpa: 1_000_000,
    baseIsblMUsd: 950,
    osblRatio: 0.4,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 1050,
    rawMaterials: [
      {
        id: 'naphtha',
        name: '나프타 (Full-Range Naphtha)',
        unit: 't',
        consumptionPerT: 3.15,
        defaultPriceUsd: 640,
        note: '에틸렌 수율 ~31.7 wt% 기준',
      },
      {
        id: 'ncc_chem',
        name: '가성소다 · 촉매 · 억제제',
        unit: 'lot',
        consumptionPerT: 1,
        defaultPriceUsd: 16,
      },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 120, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀 (보충용)', unit: 't', consumptionPerT: 0.3, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'fuel', name: '보충 연료가스 (자가 메탄 외)', unit: 'GJ', consumptionPerT: 1.5, defaultPriceUsd: 8, kind: 'fuel' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 220, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'propylene', name: '프로필렌 (Polymer Grade)', unit: 't', yieldPerT: 0.5, creditPriceUsd: 920 },
      { id: 'crude_c4', name: '조유분 C4 (부타디엔 함유)', unit: 't', yieldPerT: 0.34, creditPriceUsd: 680 },
      { id: 'pygas', name: '열분해 가솔린 (Pygas/BTX)', unit: 't', yieldPerT: 0.68, creditPriceUsd: 740 },
      { id: 'h2_byprod', name: '부생 수소 (95%+)', unit: 't', yieldPerT: 0.04, creditPriceUsd: 1800 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Ethylene, Turton et al. (CEPCI=800)",
    keywords: ['에틸렌', 'ethylene', 'ncc', '나프타', '열분해', '크래커', '올레핀'],
  },
  {
    id: 'propylene_pdh',
    productGroup: 'Propylene',
    category: 'petrochem',
    nameKo: '프로필렌',
    nameEn: 'Propylene',
    formula: 'C₃H₆',
    routeNameKo: '프로판 탈수소화 (PDH)',
    routeNameEn: 'Propane Dehydrogenation (PDH)',
    reactionEq: 'C₃H₈ ⇌ C₃H₆ + H₂  (ΔH° = +124 kJ/mol)',
    operatingSummary: '550–640°C, 0.3–1.5 bar, Pt-Sn/Al₂O₃ 또는 CrOx 촉매, 연속/순환 재생',
    blockSteps: [
      '프로판 탈황 및 예열 기화',
      '흡열 탈수소 반응기 및 촉매 연속 재생',
      '반응가스 압축 및 건조',
      '저온 분리 (수소 회수)',
      'C3 스플리터 (프로판 리사이클 / 고순도 프로필렌)',
    ],
    baseCapacityTpa: 500_000,
    baseIsblMUsd: 360,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 940,
    rawMaterials: [
      {
        id: 'propane',
        name: '프로판 (LPG, >97%)',
        unit: 't',
        consumptionPerT: 1.19,
        defaultPriceUsd: 560,
        note: '이론 1.048 t/t, 상용 선택도 ~88%',
      },
      { id: 'pdh_cat', name: 'Pt/Cr 촉매 및 화학약품', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 18 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 340, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 0.8, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'fuel', name: '연료가스 (반응열 공급)', unit: 'GJ', consumptionPerT: 6.5, defaultPriceUsd: 8, kind: 'fuel' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 110, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'h2_byprod', name: '부생 수소 (고순도)', unit: 't', yieldPerT: 0.038, creditPriceUsd: 1800 },
      { id: 'light_ends', name: '경질 연료유분 (C1–C2)', unit: 't', yieldPerT: 0.08, creditPriceUsd: 320 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Propene, Kirk-Othmer PDH Review (CEPCI=800)",
    keywords: ['프로필렌', 'propylene', 'pdh', '프로판', '탈수소화', 'lpg'],
  },
  {
    id: 'styrene_eb',
    productGroup: 'Styrene',
    category: 'petrochem',
    nameKo: '스티렌 모노머 (SM)',
    nameEn: 'Styrene Monomer',
    formula: 'C₈H₈',
    routeNameKo: '에틸벤젠 알킬화 · 탈수소화',
    routeNameEn: 'Ethylbenzene Alkylation & Dehydrogenation',
    reactionEq: 'C₆H₆ + C₂H₄ → C₆H₅C₂H₅ → C₆H₅CH=CH₂ + H₂',
    operatingSummary: '알킬화 180–220°C (제올라이트) → 탈수소 600–640°C, 0.4–0.7 bar (진공, Fe₂O₃-K₂O 촉매)',
    blockSteps: [
      '벤젠-에틸렌 액상 알킬화 및 트랜스알킬화',
      '에틸벤젠 (EB) 증류 정제',
      '과열 스팀 혼합 및 단열 탈수소 반응',
      '열회수 · 응축 및 유수 분리',
      '진공 증류탑 (미반응 EB 회수 / SM 정제)',
    ],
    baseCapacityTpa: 500_000,
    baseIsblMUsd: 240,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 1180,
    rawMaterials: [
      { id: 'benzene', name: '벤젠 (Benzene)', unit: 't', consumptionPerT: 0.79, defaultPriceUsd: 880, note: '이론 0.750 t/t' },
      { id: 'ethylene', name: '에틸렌 (Ethylene)', unit: 't', consumptionPerT: 0.29, defaultPriceUsd: 1020, note: '이론 0.269 t/t' },
      { id: 'sm_cat', name: '촉매 및 중합금지제 (TBC/DNBP)', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 12 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 110, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '과열 스팀 (희석/가열)', unit: 't', consumptionPerT: 2.1, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'fuel', name: '연료가스', unit: 'GJ', consumptionPerT: 4.2, defaultPriceUsd: 8, kind: 'fuel' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 130, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'toluene_bz', name: '톨루엔/방향족 부산물', unit: 't', yieldPerT: 0.035, creditPriceUsd: 780 },
      { id: 'h2_offgas', name: '수소 풍부 오프가스', unit: 't', yieldPerT: 0.018, creditPriceUsd: 1400 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Styrene, Turton et al. (CEPCI=800)",
    keywords: ['스티렌', 'styrene', 'sm', '에틸벤젠', 'eb', '벤젠', '방향족'],
  },
  {
    id: 'phenol_cumene',
    productGroup: 'Phenol',
    category: 'petrochem',
    nameKo: '페놀 (아세톤 병산)',
    nameEn: 'Phenol (Acetone Co-Product)',
    formula: 'C₆H₅OH',
    routeNameKo: '큐멘 산화 · 분해법 (Hock 공정)',
    routeNameEn: 'Cumene Peroxidation & Cleavage (Hock Process)',
    reactionEq: 'C₆H₆ + C₃H₆ → C₉H₁₂;  C₉H₁₂ + O₂ → C₆H₅OH + (CH₃)₂CO',
    operatingSummary: '큐멘 산화 90–120°C (5 bar) → CHP 농축 → 황산 촉매 분해 50–80°C (아세톤 0.615 t/t 병산)',
    blockSteps: [
      '벤젠-프로필렌 제올라이트 알킬화 (큐멘 제조)',
      '큐멘 공기 산화 (큐멘하이드로퍼옥사이드 CHP 생성)',
      'CHP 진공 농축 (80 wt%)',
      '황산 촉매 분해 반응 및 중화',
      '아세톤 · 페놀 · AMS 다단 증류 정제',
    ],
    baseCapacityTpa: 300_000,
    baseIsblMUsd: 280,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 1120,
    rawMaterials: [
      { id: 'benzene', name: '벤젠 (Benzene)', unit: 't', consumptionPerT: 0.89, defaultPriceUsd: 880, note: '큐멘 통합 기준' },
      { id: 'propylene', name: '프로필렌 (Propylene)', unit: 't', consumptionPerT: 0.48, defaultPriceUsd: 920 },
      { id: 'phenol_chem', name: '황산 · 가성소다 · 촉매', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 15 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 260, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 2.8, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'fuel', name: '연료가스', unit: 'GJ', consumptionPerT: 1.2, defaultPriceUsd: 8, kind: 'fuel' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 180, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'acetone', name: '아세톤 (Acetone)', unit: 't', yieldPerT: 0.615, creditPriceUsd: 780 },
      { id: 'ams', name: 'α-메틸스티렌 (AMS)', unit: 't', yieldPerT: 0.015, creditPriceUsd: 1050 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Phenol, Kirk-Othmer Cumene Process (CEPCI=800)",
    keywords: ['페놀', 'phenol', '큐멘', 'cumene', '아세톤', 'acetone', 'hock'],
  },
  {
    id: 'vcm_balanced',
    productGroup: 'VCM',
    category: 'petrochem',
    nameKo: '염화비닐 모노머 (VCM)',
    nameEn: 'Vinyl Chloride Monomer (VCM)',
    formula: 'C₂H₃Cl',
    routeNameKo: '균형 EDC 직접염소화 · 옥시염소화법',
    routeNameEn: 'Balanced EDC Direct Chlorination / Oxychlorination',
    reactionEq: '2C₂H₄ + Cl₂ + 0.5O₂ → 2C₂H₃Cl + H₂O (via EDC pyrolysis)',
    operatingSummary: '직접염소화 90–120°C + 옥시염소화 220–240°C (CuCl₂) + EDC 열분해 500–530°C (15–25 bar)',
    blockSteps: [
      '에틸렌-염소 직접염소화 (EDC 생성)',
      '에틸렌-HCl-산소 옥시염소화 (HCl 재활용)',
      'EDC 세정 · 건조 및 증류 정제',
      'EDC 고온 열분해로 (전환율 ~55%) 및 급랭',
      'HCl 회수탑 및 VCM 정제 증류',
    ],
    baseCapacityTpa: 400_000,
    baseIsblMUsd: 210,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 840,
    rawMaterials: [
      { id: 'ethylene', name: '에틸렌 (Ethylene)', unit: 't', consumptionPerT: 0.465, defaultPriceUsd: 1020, note: '이론 0.449 t/t' },
      { id: 'chlorine', name: '염소 (Cl₂)', unit: 't', consumptionPerT: 0.585, defaultPriceUsd: 240, note: '이론 0.567 t/t' },
      { id: 'oxygen', name: '산소 (O₂, 99.5%)', unit: 't', consumptionPerT: 0.14, defaultPriceUsd: 85 },
      { id: 'vcm_cat', name: 'CuCl₂ 촉매 및 약품', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 10 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 160, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 0.9, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'fuel', name: '연료가스 (EDC 열분해로)', unit: 'GJ', consumptionPerT: 3.8, defaultPriceUsd: 8, kind: 'fuel' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 120, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'hcl_purge', name: '부산 염산 (32% 퍼지)', unit: 't', yieldPerT: 0.015, creditPriceUsd: 90 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Chlorinated Hydrocarbons (VCM), Turton et al. (CEPCI=800)",
    keywords: ['vcm', '염화비닐', 'edc', 'pvc', '옥시염소화', '염소'],
  },
  {
    id: 'acetic_acid_carbonylation',
    productGroup: 'AceticAcid',
    category: 'petrochem',
    nameKo: '초산 (아세트산)',
    nameEn: 'Acetic Acid',
    formula: 'CH₃COOH',
    routeNameKo: '메탄올 저압 카보닐화법',
    routeNameEn: 'Low-Pressure Methanol Carbonylation',
    reactionEq: 'CH₃OH + CO → CH₃COOH  (Rh/Ir + CH₃I promoter)',
    operatingSummary: '180–200°C, 30–40 bar, Rh 또는 Ir 균일계 촉매, 메탄올 기준 선택도 >99%',
    blockSteps: [
      '메탄올 · 일산화탄소 고압 액상 카보닐화 반응',
      '플래시 탱크 (촉매 용액 순환 분리)',
      '경질유분(CH₃I/초산메틸) 회수탑',
      '탈수탑 (공비 증류 수분 제거)',
      '중질유분(프로피온산) 제거 및 빙초산 정제',
    ],
    baseCapacityTpa: 500_000,
    baseIsblMUsd: 260,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 520,
    rawMaterials: [
      { id: 'methanol', name: '메탄올 (Methanol)', unit: 't', consumptionPerT: 0.545, defaultPriceUsd: 340, note: '이론 0.534 t/t' },
      { id: 'co_gas', name: '일산화탄소 (CO)', unit: 't', consumptionPerT: 0.51, defaultPriceUsd: 210, note: '이론 0.466 t/t (배가스 손실 포함)' },
      { id: 'rh_ir_cat', name: 'Rh/Ir 귀금속 촉매 및 HI 보충', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 14 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 110, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 1.4, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 95, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Acetic Acid, Kirk-Othmer Carbonylation (CEPCI=800)",
    keywords: ['초산', '아세트산', 'acetic', '카보닐화', '메탄올', 'co'],
  },
  {
    id: 'methanol_smr',
    productGroup: 'Methanol',
    category: 'petrochem',
    nameKo: '메탄올',
    nameEn: 'Methanol',
    formula: 'CH₃OH',
    routeNameKo: '천연가스 수증기 개질 (SMR) · 저압합성',
    routeNameEn: 'Natural Gas SMR & Low-Pressure Synthesis',
    reactionEq: 'CH₄ + H₂O ⇌ CO + 3H₂;  CO + 2H₂ ⇌ CH₃OH',
    operatingSummary: '개질 850–900°C (20 bar) → 합성 230–270°C, 50–80 bar (Cu/ZnO/Al₂O₃ 촉매)',
    blockSteps: [
      '천연가스 탈황 (ZnO) 및 예열',
      '수증기 개질로 (SMR) 합성가스 제조',
      '폐열회수 및 합성가스 압축 (60–80 bar)',
      '메탄올 합성 루프 (Cu/ZnO/Al₂O₃ 고정층)',
      '조메탄올 다단 증류 (AA-Grade 99.85%)',
    ],
    baseCapacityTpa: 1_000_000,
    baseIsblMUsd: 480,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 350,
    rawMaterials: [
      { id: 'ng_feed', name: '천연가스 (원료용)', unit: 'GJ', consumptionPerT: 21.5, defaultPriceUsd: 7.5, note: '원료+연료 합계 ~31 GJ/t' },
      { id: 'bfw', name: '공정수 / 보일러 급수', unit: 't', consumptionPerT: 0.95, defaultPriceUsd: 2.0 },
      { id: 'meoh_cat', name: '개질 · 합성 촉매', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 6 },
    ],
    utilities: [
      { id: 'fuel', name: '천연가스 (개질로 연료)', unit: 'GJ', consumptionPerT: 9.5, defaultPriceUsd: 7.5, kind: 'fuel' },
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 85, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 110, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'export_steam', name: '잉여 스팀 (MP 수출)', unit: 't', yieldPerT: 0.4, creditPriceUsd: 22 },
    ],
    fixedCostPctCapex: 4.2,
    depreciationYears: 15,
    sourceNote: "Ullmann's Methanol, IEA Chemicals Reference (CEPCI=800)",
    keywords: ['메탄올', 'methanol', 'smr', '천연가스', '합성가스', 'c1'],
  },
  {
    id: 'eo_eg_o2',
    productGroup: 'EO_EG',
    category: 'petrochem',
    nameKo: '모노에틸렌글리콜 (EO/MEG)',
    nameEn: 'Ethylene Oxide / Monoethylene Glycol (MEG)',
    formula: 'C₂H₆O₂',
    routeNameKo: '에틸렌 산소 직접산화 · 수화법',
    routeNameEn: 'Direct O₂ Oxidation & EO Hydration',
    reactionEq: 'C₂H₄ + 0.5O₂ → C₂H₄O;  C₂H₄O + H₂O → HOCH₂CH₂OH',
    operatingSummary: 'EO 산화 220–260°C, 15–25 bar (Ag/Al₂O₃, 선택도 ~84%) → 비촉매 수화 190°C (MEG 1 t 기준)',
    blockSteps: [
      '에틸렌-순산소 고정층 산화 반응 (Ag 촉매)',
      'CO₂ 흡수 제거 및 EO 수흡수/스트리핑',
      'EO 열수화 반응기 (과잉 물 조건)',
      '다중효용 증발 탈수',
      '진공 증류 (MEG / DEG / TEG 분리)',
    ],
    baseCapacityTpa: 500_000,
    baseIsblMUsd: 380,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 820,
    rawMaterials: [
      { id: 'ethylene', name: '에틸렌 (Ethylene)', unit: 't', consumptionPerT: 0.59, defaultPriceUsd: 950, note: 'MEG 1 t 기준 (EO 선택도 ~84%)' },
      { id: 'oxygen', name: '순산소 (O₂, 99.5%)', unit: 't', consumptionPerT: 0.68, defaultPriceUsd: 85 },
      { id: 'eo_cat', name: '은(Ag) 촉매 및 탄산칼륨 약품', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 12 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 320, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 1.6, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 160, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'deg', name: '디에틸렌글리콜 (DEG)', unit: 't', yieldPerT: 0.085, creditPriceUsd: 760 },
      { id: 'teg', name: '트리에틸렌글리콜 (TEG)', unit: 't', yieldPerT: 0.012, creditPriceUsd: 1100 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Ethylene Oxide & Ethylene Glycol (CEPCI=800)",
    keywords: ['eo', 'eg', 'meg', '에틸렌글리콜', '에틸렌옥사이드', 'pet', '산화'],
  },
  {
    id: 'po_hppo',
    productGroup: 'PO',
    category: 'petrochem',
    nameKo: '프로필렌옥사이드 (PO)',
    nameEn: 'Propylene Oxide',
    formula: 'C₃H₆O',
    routeNameKo: '과산화수소 직접산화 (HPPO)',
    routeNameEn: 'Hydrogen Peroxide to Propylene Oxide (HPPO)',
    reactionEq: 'C₃H₆ + H₂O₂ → C₃H₆O + H₂O  (TS-1 Catalyst)',
    operatingSummary: '40–60°C, 20 bar, 티타늄 실리칼라이트(TS-1) 촉매, 메탄올 용매, 부산물 없음 (물만 생성)',
    blockSteps: [
      '프로필렌 · 과산화수소 · 메탄올 혼합 에폭시화 반응',
      '미반응 프로필렌 플래시 회수 및 재순환',
      '조 PO 분리 및 정제 증류',
      '메탄올 용매 회수 증류탑',
      '폐수 처리 (친환경 무부산물 구조)',
    ],
    baseCapacityTpa: 300_000,
    baseIsblMUsd: 240,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 1580,
    rawMaterials: [
      { id: 'propylene', name: '프로필렌 (Propylene)', unit: 't', consumptionPerT: 0.77, defaultPriceUsd: 920, note: '이론 0.725 t/t' },
      { id: 'h2o2', name: '과산화수소 (H₂O₂, 100% 환산)', unit: 't', consumptionPerT: 0.63, defaultPriceUsd: 620, note: '이론 0.586 t/t' },
      { id: 'hppo_cat', name: 'TS-1 촉매 및 메탄올 보충', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 22 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 220, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 1.9, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 140, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Propylene Oxide (HPPO Route), CEPCI=800",
    keywords: ['po', '프로필렌옥사이드', 'hppo', '과산화수소', 'ts-1', '폴리올'],
  },
  {
    id: 'po_posm',
    productGroup: 'PO',
    category: 'petrochem',
    nameKo: '프로필렌옥사이드 (PO)',
    nameEn: 'Propylene Oxide',
    formula: 'C₃H₆O',
    routeNameKo: '스티렌 병산 과산화법 (PO/SM)',
    routeNameEn: 'PO/Styrene Monomer Co-Product (PO/SM)',
    reactionEq: 'EB + O₂ → EBHP;  EBHP + C₃H₆ → PO + MBA → PO + SM + H₂O',
    operatingSummary: 'EB 산화 130–150°C → Mo/Ti 에폭시화 110°C → MBA 탈수 220°C (SM 2.25 t/t PO 병산)',
    blockSteps: [
      '에틸벤젠 (EB) 공기 산화 (EBHP 생성)',
      'EBHP-프로필렌 촉매 에폭시화 (PO + MBA)',
      '미반응 프로필렌 및 PO 분리 정제',
      'α-메틸벤질알코올 (MBA) 탈수 반응 (SM 생성)',
      '스티렌 모노머 (SM) 진공 증류 정제',
    ],
    baseCapacityTpa: 300_000,
    baseIsblMUsd: 490,
    osblRatio: 0.38,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 1580,
    rawMaterials: [
      { id: 'propylene', name: '프로필렌 (Propylene)', unit: 't', consumptionPerT: 0.78, defaultPriceUsd: 920 },
      { id: 'ethylbenzene', name: '에틸벤젠 (EB)', unit: 't', consumptionPerT: 2.45, defaultPriceUsd: 980, note: 'SM 2.25 t 병산분 포함' },
      { id: 'oxygen', name: '산소 (O₂)', unit: 't', consumptionPerT: 0.55, defaultPriceUsd: 85 },
      { id: 'posm_cat', name: '에폭시화/탈수 촉매 및 가성소다', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 28 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 390, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 4.2, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'fuel', name: '연료가스', unit: 'GJ', consumptionPerT: 2.5, defaultPriceUsd: 8, kind: 'fuel' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 280, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'styrene_co', name: '스티렌 모노머 (SM 병산)', unit: 't', yieldPerT: 2.25, creditPriceUsd: 1180 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Propylene Oxide (PO/SM Route), Kirk-Othmer (CEPCI=800)",
    keywords: ['po', 'posm', 'po/sm', '프로필렌옥사이드', '스티렌', '병산'],
  },

  // =========================================================================
  // 2. INORGANIC (7)
  // =========================================================================
  {
    id: 'chlor_alkali_membrane',
    productGroup: 'ChlorAlkali',
    category: 'inorganic',
    nameKo: '가성소다 · 염소 (전해)',
    nameEn: 'Caustic Soda / Chlorine (Chlor-Alkali)',
    formula: 'NaOH / Cl₂ / H₂',
    routeNameKo: '이온교환막 전해법 (Membrane Cell)',
    routeNameEn: 'Ion-Exchange Membrane Electrolysis',
    reactionEq: '2NaCl + 2H₂O → 2NaOH + Cl₂ + H₂  (E_cell ≈ 3.0–3.2 V)',
    operatingSummary: '85–90°C, 4–6 kA/m², 불소계 이온교환막, NaOH 100% 건조환산 1 t 기준 (Cl₂ 0.886 t + H₂ 0.025 t 병산)',
    blockSteps: [
      '공업용 소금 용해 및 1·2차 염수 정제 (Ca/Mg <20 ppb)',
      '이온교환막 전해조 (DC 정류기 운전)',
      '양극 염소가스 냉각 · 황산 건조 · 액화',
      '음극 수소가스 세정 및 압축',
      '32% 가성소다 다중효용 증발 농축 (50% 제품)',
    ],
    baseCapacityTpa: 300_000,
    baseIsblMUsd: 240,
    osblRatio: 0.35,
    scaleExponent: 0.68,
    referenceProductPriceUsdPerT: 460,
    rawMaterials: [
      { id: 'nacl', name: '공업용 원염 (NaCl, 99.5%)', unit: 't', consumptionPerT: 1.48, defaultPriceUsd: 65, note: '이론 1.461 t/t NaOH' },
      { id: 'brine_chem', name: '염수 정제 약품 (HCl/Na₂CO₃/Na₂SO₃)', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 14 },
      { id: 'di_water', name: '순수 (DI Water)', unit: 't', consumptionPerT: 1.2, defaultPriceUsd: 2.0 },
    ],
    utilities: [
      { id: 'power', name: '전력 (전해 DC + 부대)', unit: 'kWh', consumptionPerT: 2450, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀 (50% 농축)', unit: 't', consumptionPerT: 0.65, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 45, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'chlorine', name: '염소 (Cl₂, ECU 병산)', unit: 't', yieldPerT: 0.886, creditPriceUsd: 240 },
      { id: 'h2_byprod', name: '고순도 부생 수소 (H₂)', unit: 't', yieldPerT: 0.025, creditPriceUsd: 2000 },
    ],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's Chlorine (Membrane Process), Euro Chlor BAT (CEPCI=800)",
    keywords: ['가성소다', '염소', '전해', 'chlor-alkali', 'naoh', 'cl2', '이온교환막', 'ecu'],
  },
  {
    id: 'hcl_synthesis',
    productGroup: 'HCl',
    category: 'inorganic',
    nameKo: '합성 염산 (100% 환산)',
    nameEn: 'Synthetic Hydrochloric Acid (100% Basis)',
    formula: 'HCl',
    routeNameKo: '수소 · 염소 직접 연소 합성법',
    routeNameEn: 'Direct H₂ / Cl₂ Combustion Synthesis',
    reactionEq: 'H₂ + Cl₂ → 2HCl  (ΔH° = -184.6 kJ/mol)',
    operatingSummary: '흑연 합성연소로 (화염 ~2,000°C), 100% HCl 1 t 기준 (35% 염산 약 2.86 t), 반응열 스팀 회수',
    blockSteps: [
      '염소 · 과잉수소(2–5%) 정량 공급 및 안전 차단 제어',
      '흑연 연소합성로 직접 연소 및 열회수',
      '강하경막 흑연 흡수탑 (35 wt% 고순도 염산)',
      '테일가스 스크러버 및 미반응 가스 처리',
      '고순도 염산 저장 및 출하',
    ],
    baseCapacityTpa: 100_000,
    baseIsblMUsd: 22,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 380,
    rawMaterials: [
      { id: 'chlorine', name: '염소 (Cl₂)', unit: 't', consumptionPerT: 0.975, defaultPriceUsd: 240, note: '이론 0.972 t/t HCl' },
      { id: 'hydrogen', name: '수소 (H₂)', unit: 't', consumptionPerT: 0.029, defaultPriceUsd: 2000, note: '이론 0.0276 t/t (+과잉분)' },
      { id: 'di_water', name: '흡수용 순수 (35% 제조)', unit: 't', consumptionPerT: 1.86, defaultPriceUsd: 2.0 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 35, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 35, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'lp_steam', name: '회수 스팀 (발열 회수)', unit: 't', yieldPerT: 0.65, creditPriceUsd: 20 },
    ],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's Hydrochloric Acid, Kirk-Othmer (CEPCI=800)",
    keywords: ['염산', 'hcl', '합성염산', '염소', '수소', '연소합성'],
  },
  {
    id: 'ammonia_hb',
    productGroup: 'Ammonia',
    category: 'inorganic',
    nameKo: '암모니아',
    nameEn: 'Ammonia',
    formula: 'NH₃',
    routeNameKo: '하버-보슈 천연가스 개질법',
    routeNameEn: 'Haber-Bosch Natural Gas SMR Process',
    reactionEq: 'CH₄ + 2H₂O → CO₂ + 4H₂;  N₂ + 3H₂ ⇌ 2NH₃',
    operatingSummary: '1·2차 개질 850–1,000°C → WGS/CO₂ 제거 → 합성 420–480°C, 150–200 bar (Fe 촉매), 총 NG ~29 GJ/t',
    blockSteps: [
      '천연가스 탈황 및 1차 수증기 개질 (SMR)',
      '공기 투입 2차 개질 (질소 도입)',
      '고온/저온 수성가스전환 (HTS/LTS) 및 CO₂ 제거',
      '메탄화 정제 및 합성가스 고압 압축',
      '하버-보슈 합성 루프 및 액체 암모니아 냉동 회수',
    ],
    baseCapacityTpa: 600_000,
    baseIsblMUsd: 450,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 440,
    rawMaterials: [
      { id: 'ng_feed', name: '천연가스 (원료용)', unit: 'GJ', consumptionPerT: 21.0, defaultPriceUsd: 7.5, note: '원료+연료 합계 29 GJ/t NH₃' },
      { id: 'bfw', name: '공정수 / 보일러 급수', unit: 't', consumptionPerT: 1.6, defaultPriceUsd: 2.0 },
      { id: 'nh3_cat', name: '개질 · 철촉매 · CO₂ 흡수제', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 5 },
    ],
    utilities: [
      { id: 'fuel', name: '천연가스 (1차 개질로 연료)', unit: 'GJ', consumptionPerT: 8.0, defaultPriceUsd: 7.5, kind: 'fuel' },
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 55, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 130, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'pure_co2', name: '고순도 CO₂ (요소/식음용)', unit: 't', yieldPerT: 1.25, creditPriceUsd: 18 },
    ],
    fixedCostPctCapex: 4.2,
    depreciationYears: 15,
    sourceNote: "Ullmann's Ammonia, IEA Ammonia Technology Roadmap (CEPCI=800)",
    keywords: ['암모니아', 'ammonia', 'nh3', '하버보슈', 'haber-bosch', '비료', '수소운반체'],
  },
  {
    id: 'sulfuric_acid_dcda',
    productGroup: 'SulfuricAcid',
    category: 'inorganic',
    nameKo: '황산',
    nameEn: 'Sulfuric Acid',
    formula: 'H₂SO₄',
    routeNameKo: '이중접촉 이중흡수법 (DCDA)',
    routeNameEn: 'Double Contact Double Absorption (DCDA)',
    reactionEq: 'S + O₂ → SO₂;  SO₂ + 0.5O₂ ⇌ SO₃;  SO₃ + H₂O → H₂SO₄',
    operatingSummary: '황 연소 1,000°C → 4단 V₂O₅ 촉매 전환 420–600°C (전환율 99.7%), 발열 고압스팀 1.15 t/t 수출',
    blockSteps: [
      '건조 공기 압축 및 액체 황 연소로 (SO₂ 생성)',
      '폐열 보일러 고압 스팀 생산',
      '4단 V₂O₅ 접촉 전환기 (1–3단 → 중간흡수 → 4단)',
      '중간 · 최종 SO₃ 흡수탑 (98.5% 황산 순환)',
      '산 냉각기 및 제품 황산 저장',
    ],
    baseCapacityTpa: 500_000,
    baseIsblMUsd: 85,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 115,
    rawMaterials: [
      { id: 'sulfur', name: '액체 유황 (Molten Sulfur)', unit: 't', consumptionPerT: 0.332, defaultPriceUsd: 155, note: '이론 0.327 t/t H₂SO₄' },
      { id: 'bfw', name: '보일러 급수 · 공정수', unit: 't', consumptionPerT: 1.5, defaultPriceUsd: 2.0 },
      { id: 'v2o5_cat', name: 'V₂O₅ 촉매 보충', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 1.5 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 42, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 45, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'hp_steam', name: '고압 수출 스팀 (40 bar)', unit: 't', yieldPerT: 1.15, creditPriceUsd: 26 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Sulfuric Acid and Sulfur Trioxide (CEPCI=800)",
    keywords: ['황산', 'sulfuric', 'h2so4', 'dcda', '유황', '접촉법'],
  },
  {
    id: 'nitric_acid_ostwald',
    productGroup: 'NitricAcid',
    category: 'inorganic',
    nameKo: '질산 (100% 환산)',
    nameEn: 'Nitric Acid (100% Basis)',
    formula: 'HNO₃',
    routeNameKo: '오스트발트 이중압력법',
    routeNameEn: 'Ostwald Dual-Pressure Process',
    reactionEq: '4NH₃ + 5O₂ → 4NO + 6H₂O;  3NO₂ + H₂O → 2HNO₃ + NO',
    operatingSummary: '산화 880–920°C (4–5 bar, Pt-Rh 망 촉매) → 흡수 10–12 bar (60–68% 제품, 100% 환산 1 t 기준)',
    blockSteps: [
      '액체 암모니아 기화 및 공기 혼합 여과',
      'Pt-Rh 촉매망 암모니아 산화 반응기 (NO 생성)',
      '폐열회수 보일러 및 NO 산화 냉각기',
      '고압 다단 트레이 흡수탑 (60–68% 질산)',
      '배가스 SCR 탈질 (N₂O/NOx 저감) 및 팽창터빈 동력회수',
    ],
    baseCapacityTpa: 300_000,
    baseIsblMUsd: 95,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 245,
    rawMaterials: [
      { id: 'ammonia', name: '액체 암모니아 (NH₃)', unit: 't', consumptionPerT: 0.285, defaultPriceUsd: 440, note: '이론 0.270 t/t HNO₃' },
      { id: 'pt_rh', name: 'Pt-Rh 촉매망 손실 · 탈질 촉매', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 6 },
      { id: 'process_water', name: '흡수용 순수', unit: 't', consumptionPerT: 0.9, defaultPriceUsd: 2.0 },
    ],
    utilities: [
      { id: 'power', name: '전력 (팽창터빈 회수 후 순소비)', unit: 'kWh', consumptionPerT: 15, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 90, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'export_steam', name: '잉여 수출 스팀 (HP/MP)', unit: 't', yieldPerT: 0.75, creditPriceUsd: 24 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Nitric Acid, Kirk-Othmer Ostwald Process (CEPCI=800)",
    keywords: ['질산', 'nitric', 'hno3', '오스트발트', 'ostwald', '암모니아'],
  },
  {
    id: 'h2o2_anthraquinone',
    productGroup: 'H2O2',
    category: 'inorganic',
    nameKo: '과산화수소 (100% 환산)',
    nameEn: 'Hydrogen Peroxide (100% Basis)',
    formula: 'H₂O₂',
    routeNameKo: '안트라퀴논 자동산화법 (AO 공정)',
    routeNameEn: 'Anthraquinone Auto-Oxidation (AO Process)',
    reactionEq: 'EAQ + H₂ → EAQH₂;  EAQH₂ + O₂ → EAQ + H₂O₂',
    operatingSummary: '수소화 40–60°C (Pd 촉매, 3–4 bar) → 공기 산화 50°C → 순수 추출 → 진공 농축 (50–70% 제품)',
    blockSteps: [
      '알킬안트라퀴논 작동용액 수소화 (Pd 촉매)',
      '촉매 여과 및 공기 자동산화탑 (H₂O₂ 생성)',
      '향류 액-액 순수 추출탑 (조 H₂O₂ 30–40%)',
      '작동용액 건조 · 알루미나 재생 및 순환',
      '유기물 정제 및 진공 증류 농축 (50–70%)',
    ],
    baseCapacityTpa: 100_000,
    baseIsblMUsd: 115,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 640,
    rawMaterials: [
      { id: 'hydrogen', name: '수소 (H₂)', unit: 't', consumptionPerT: 0.065, defaultPriceUsd: 2000, note: '이론 0.0593 t/t H₂O₂' },
      { id: 'aq_solvent', name: '안트라퀴논 · 용매 · Pd 촉매 보충', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 48 },
      { id: 'di_water', name: '초순수 (추출용)', unit: 't', consumptionPerT: 1.0, defaultPriceUsd: 2.0 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 420, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀 (진공 농축)', unit: 't', consumptionPerT: 2.4, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 130, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's Hydrogen Peroxide (AO Process), CEPCI=800",
    keywords: ['과산화수소', 'h2o2', '안트라퀴논', '반도체', 'hppo', '표백'],
  },
  {
    id: 'soda_ash_solvay',
    productGroup: 'SodaAsh',
    category: 'inorganic',
    nameKo: '소다회 (탄산나트륨)',
    nameEn: 'Soda Ash (Sodium Carbonate)',
    formula: 'Na₂CO₃',
    routeNameKo: '솔베이 암모니아-소다법',
    routeNameEn: 'Solvay Ammonia-Soda Process',
    reactionEq: '2NaCl + CaCO₃ → Na₂CO₃ + CaCl₂  (NH₃ cyclic intermediate)',
    operatingSummary: '석회석 소성 1,000°C + 암모니아 염수 탄산화 30–60°C + 중조 하소 180–200°C',
    blockSteps: [
      '석회석-코크스 소성로 (CaO 및 CO₂ 생산)',
      '포화 염수 정제 및 암모니아 흡수',
      '솔베이 탄산화탑 (NaHCO₃ 결정 석출)',
      '진공 여과 및 로터리 하소로 (Na₂CO₃ 전환)',
      '석회유 암모니아 회수 증류탑',
    ],
    baseCapacityTpa: 600_000,
    baseIsblMUsd: 290,
    osblRatio: 0.4,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 295,
    rawMaterials: [
      { id: 'nacl_brine', name: '원염 / 염수 (NaCl 환산)', unit: 't', consumptionPerT: 1.5, defaultPriceUsd: 42, note: '이론 1.103 t/t (전환율 ~74%)' },
      { id: 'limestone', name: '석회석 (CaCO₃)', unit: 't', consumptionPerT: 1.22, defaultPriceUsd: 22 },
      { id: 'coke', name: '코크스 (석회로 연료/환원)', unit: 't', consumptionPerT: 0.095, defaultPriceUsd: 240 },
      { id: 'nh3_makeup', name: '암모니아 보충 (NH₃)', unit: 't', consumptionPerT: 0.004, defaultPriceUsd: 440 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 110, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀 (암모니아 회수/하소)', unit: 't', consumptionPerT: 2.1, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 55, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Sodium Carbonates (Solvay Process), CEPCI=800",
    keywords: ['소다회', '탄산나트륨', 'soda ash', 'na2co3', '솔베이', 'solvay', '유리'],
  },

  // =========================================================================
  // 3. FINE & POLYMER (6)
  // =========================================================================
  {
    id: 'ech_propylene',
    productGroup: 'ECH',
    category: 'fine_polymer',
    nameKo: '에피클로로히드린 (ECH)',
    nameEn: 'Epichlorohydrin (ECH)',
    formula: 'C₃H₅ClO',
    routeNameKo: '프로필렌 고온염소화법',
    routeNameEn: 'Propylene High-Temperature Chlorination',
    reactionEq: 'C₃H₆ + 2Cl₂ + NaOH → C₃H₅ClO + HCl + NaCl + H₂O',
    operatingSummary: '고온염소화 500°C (알릴클로라이드) → 차아염소산화 40°C (DCH) → 알칼리 탈염산 폐환 90°C',
    blockSteps: [
      '프로필렌-염소 고온 치환 염소화 (알릴클로라이드)',
      '부산 HCl 흡수 회수 및 알릴클로라이드 정제',
      '수중 차아염소산화 반응 (디클로로히드린 DCH 생성)',
      '소석회/가성소다 탈염산 폐환 (스팀 스트리핑)',
      '조 ECH 탈수 및 정제 증류 (99.9%)',
    ],
    baseCapacityTpa: 100_000,
    baseIsblMUsd: 135,
    osblRatio: 0.38,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 1620,
    rawMaterials: [
      { id: 'propylene', name: '프로필렌 (Propylene)', unit: 't', consumptionPerT: 0.58, defaultPriceUsd: 920, note: '이론 0.455 t/t (총괄 수율 ~78%)' },
      { id: 'chlorine', name: '염소 (Cl₂)', unit: 't', consumptionPerT: 1.72, defaultPriceUsd: 240, note: '이론 1.533 t/t' },
      { id: 'alkali', name: '알칼리제 (Ca(OH)₂ / NaOH 환산)', unit: 't', consumptionPerT: 0.5, defaultPriceUsd: 240 },
      { id: 'process_water', name: '공정수 (차아염소산화)', unit: 't', consumptionPerT: 18, defaultPriceUsd: 1.5 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 340, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 4.5, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 160, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'hcl_32', name: '부산 염산 (32% aq)', unit: 't', yieldPerT: 0.95, creditPriceUsd: 75 },
    ],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's Epoxides (Epichlorohydrin), Kirk-Othmer (CEPCI=800)",
    keywords: ['ech', '에피클로로히드린', '에폭시', '프로필렌', '고온염소화', '알릴클로라이드'],
  },
  {
    id: 'ech_gte',
    productGroup: 'ECH',
    category: 'fine_polymer',
    nameKo: '에피클로로히드린 (ECH)',
    nameEn: 'Epichlorohydrin (ECH)',
    formula: 'C₃H₅ClO',
    routeNameKo: '글리세린 바이오 GTE 공정',
    routeNameEn: 'Glycerol-to-ECH (GTE) Bio-Based Process',
    reactionEq: 'C₃H₈O₃ + 2HCl → C₃H₆Cl₂O + 2H₂O;  C₃H₆Cl₂O + NaOH → C₃H₅ClO + NaCl + H₂O',
    operatingSummary: '염산 치환 110–130°C (카르복실산 촉매, 1,3-DCH 고선택도) → 가성소다 폐환 70–90°C, 폐수량 ~80% 절감',
    blockSteps: [
      '바이오 정제 글리세린 + 무수 HCl 촉매 염소화',
      '반응 생성수 공비 증류 제거 (1,3-DCH 농축)',
      '가성소다 탈염산 폐환 및 반응증류',
      '염수 분리 (전해공정 재활용 가능) 및 상분리',
      '고순도 ECH 진공 정제 증류 (99.9%+)',
    ],
    baseCapacityTpa: 100_000,
    baseIsblMUsd: 98,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 1620,
    rawMaterials: [
      { id: 'glycerol', name: '정제 글리세린 (99.5%)', unit: 't', consumptionPerT: 1.12, defaultPriceUsd: 620, note: '이론 0.995 t/t (수율 ~89%)' },
      { id: 'hcl_gas', name: '무수 염화수소 (HCl, 100%)', unit: 't', consumptionPerT: 0.88, defaultPriceUsd: 340, note: '이론 0.788 t/t' },
      { id: 'naoh', name: '가성소다 (NaOH, 100% 환산)', unit: 't', consumptionPerT: 0.48, defaultPriceUsd: 440, note: '이론 0.432 t/t' },
      { id: 'gte_cat', name: '유기산 촉매 및 약품', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 18 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 220, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 3.2, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 110, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's Epichlorohydrin (GTE Route), Green Chemistry Literature (CEPCI=800)",
    keywords: ['ech', 'gte', '글리세린', '바이오', '에피클로로히드린', '에폭시'],
  },
  {
    id: 'mdi_phosgenation',
    productGroup: 'MDI',
    category: 'fine_polymer',
    nameKo: 'MDI (메틸렌 디페닐 디이소시아네이트)',
    nameEn: 'Methylene Diphenyl Diisocyanate (MDI)',
    formula: 'C₁₅H₁₀N₂O₂',
    routeNameKo: '아닐린-포르말린 축합 · 포스겐화법',
    routeNameEn: 'Aniline-Formaldehyde Condensation & Phosgenation',
    reactionEq: '2C₆H₅NH₂ + CH₂O → MDA + H₂O;  MDA + 2COCl₂ → MDI + 4HCl',
    operatingSummary: '산촉매 축합 80–110°C (MDA) → MCB 용매 포스겐화 60–150°C → 용매/HCl 회수 및 모노머/폴리머 분리',
    blockSteps: [
      '아닐린 · 포르말린 염산 촉매 축합 (MDA 제조)',
      '가성소다 중화 · 세정 및 미반응 아닐린 회수',
      'CO + Cl₂ 포스겐 합성 및 MDA 액상 포스겐화',
      '탈포스겐 · HCl 회수 및 용매(MCB) 증류 회수',
      '폴리머릭/모노머릭 MDI 박막증발 분리 정제',
    ],
    baseCapacityTpa: 300_000,
    baseIsblMUsd: 440,
    osblRatio: 0.4,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 2050,
    rawMaterials: [
      { id: 'aniline', name: '아닐린 (Aniline)', unit: 't', consumptionPerT: 0.78, defaultPriceUsd: 1320, note: '이론 0.744 t/t MDI' },
      { id: 'formalin', name: '포르말린 (37% CH₂O)', unit: 't', consumptionPerT: 0.34, defaultPriceUsd: 360 },
      { id: 'chlorine', name: '염소 (Cl₂, 포스겐 제조)', unit: 't', consumptionPerT: 0.62, defaultPriceUsd: 240 },
      { id: 'co_gas', name: '일산화탄소 (CO, 포스겐 제조)', unit: 't', consumptionPerT: 0.26, defaultPriceUsd: 210 },
      { id: 'mdi_chem', name: 'MCB 용매 보충 · 산/알칼리', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 42 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 420, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 3.8, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 190, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'anhydrous_hcl', name: '무수 염화수소 (HCl, 100%)', unit: 't', yieldPerT: 0.56, creditPriceUsd: 220 },
    ],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's Isocyanates (Organic), Kirk-Othmer Polyurethane Feedstocks (CEPCI=800)",
    keywords: ['mdi', '폴리우레탄', '이소시아네이트', '아닐린', '포스겐', '단열재'],
  },
  {
    id: 'tdi_phosgenation',
    productGroup: 'TDI',
    category: 'fine_polymer',
    nameKo: 'TDI (톨루엔 디이소시아네이트)',
    nameEn: 'Toluene Diisocyanate (TDI)',
    formula: 'C₉H₆N₂O₂',
    routeNameKo: '톨루엔 디니트로화 · 수소화 · 포스겐화법',
    routeNameEn: 'Toluene Dinitration, Hydrogenation & Phosgenation',
    reactionEq: 'C₇H₈ + 2HNO₃ → DNT → TDA;  TDA + 2COCl₂ → TDI + 4HCl',
    operatingSummary: '혼산 2단 니트로화 (DNT) → Pd/Ni 수소화 (TDA) → 기상/액상 포스겐화 (80/20 TDI)',
    blockSteps: [
      '톨루엔 황산/질산 2단 니트로화 (DNT 제조) 및 폐산 농축',
      'DNT 촉매 수소화 반응 (TDA 및 물 생성)',
      'TDA 탈수 및 이성질체 정제',
      'TDA 기상/액상 포스겐화 (o-DCB 용매)',
      'HCl 회수 · 용매 분리 및 TDI 진공 증류',
    ],
    baseCapacityTpa: 200_000,
    baseIsblMUsd: 410,
    osblRatio: 0.4,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 2180,
    rawMaterials: [
      { id: 'toluene', name: '톨루엔 (Toluene)', unit: 't', consumptionPerT: 0.6, defaultPriceUsd: 860, note: '이론 0.529 t/t TDI' },
      { id: 'nitric_acid', name: '질산 (HNO₃, 100% 환산)', unit: 't', consumptionPerT: 0.82, defaultPriceUsd: 245 },
      { id: 'hydrogen', name: '수소 (H₂)', unit: 't', consumptionPerT: 0.08, defaultPriceUsd: 2000 },
      { id: 'chlorine', name: '염소 (Cl₂, 포스겐용)', unit: 't', consumptionPerT: 0.9, defaultPriceUsd: 240 },
      { id: 'co_gas', name: '일산화탄소 (CO)', unit: 't', consumptionPerT: 0.36, defaultPriceUsd: 210 },
      { id: 'tdi_chem', name: 'o-DCB 용매 · 황산 · 수소화 촉매', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 55 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 520, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 5.2, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 240, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'anhydrous_hcl', name: '무수 염화수소 (HCl, 100%)', unit: 't', yieldPerT: 0.8, creditPriceUsd: 220 },
    ],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's Isocyanates (TDI), Kirk-Othmer (CEPCI=800)",
    keywords: ['tdi', '톨루엔', '이소시아네이트', '폴리우레탄', '포스겐', '연질폼'],
  },
  {
    id: 'bpa_phenol_acetone',
    productGroup: 'BPA',
    category: 'fine_polymer',
    nameKo: '비스페놀-A (BPA)',
    nameEn: 'Bisphenol-A (BPA)',
    formula: 'C₁₅H₁₆O₂',
    routeNameKo: '페놀-아세톤 이온교환수지 촉매 축합법',
    routeNameEn: 'Ion-Exchange Resin Catalyzed Phenol-Acetone Condensation',
    reactionEq: '2C₆H₅OH + (CH₃)₂CO → (CH₃)₂C(C₆H₄OH)₂ + H₂O',
    operatingSummary: '60–85°C, 설폰화 이온교환수지 (+티올 조촉매), 과잉 페놀 조건, 부가결정화 (PC-Grade 99.9%)',
    blockSteps: [
      '과잉 페놀 + 아세톤 고정층 이온교환수지 축합 반응',
      '반응수 및 미반응 아세톤 진공 탈수 증류',
      'BPA-페놀 부가물 결정화 및 원심 여과',
      '부가물 재용해 · 탈페놀 박막 증발',
      '용융 프릴링 (PC/에폭시용 고순도 BPA)',
    ],
    baseCapacityTpa: 200_000,
    baseIsblMUsd: 190,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 1540,
    rawMaterials: [
      { id: 'phenol', name: '페놀 (Phenol)', unit: 't', consumptionPerT: 0.86, defaultPriceUsd: 1120, note: '이론 0.824 t/t BPA' },
      { id: 'acetone', name: '아세톤 (Acetone)', unit: 't', consumptionPerT: 0.27, defaultPriceUsd: 780, note: '이론 0.254 t/t BPA' },
      { id: 'bpa_resin', name: '이온교환수지 및 조촉매', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 16 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 240, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 2.9, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 140, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'heavy_phenolics', name: '중질 페놀계 잔사 (연료가치)', unit: 't', yieldPerT: 0.03, creditPriceUsd: 280 },
    ],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: "Ullmann's Phenol Derivatives (Bisphenol A), CEPCI=800",
    keywords: ['bpa', '비스페놀a', '폴리카보네이트', 'pc', '에폭시', '페놀', '아세톤'],
  },
  {
    id: 'nmp_gbl_mma',
    productGroup: 'NMP',
    category: 'fine_polymer',
    nameKo: 'NMP (N-메틸-2-피롤리돈)',
    nameEn: 'N-Methyl-2-Pyrrolidone (NMP)',
    formula: 'C₅H₉NO',
    routeNameKo: 'GBL-모노메틸아민 고압 아민화법',
    routeNameEn: 'GBL + Monomethylamine High-Pressure Amination',
    reactionEq: 'C₄H₆O₂ (GBL) + CH₃NH₂ → C₅H₉NO (NMP) + H₂O',
    operatingSummary: '250–290°C, 40–70 bar, 무촉매/제올라이트 고압 축합, 이차전지 양극재 슬러리용 초고순도 정제',
    blockSteps: [
      'γ-부티로락톤 (GBL) · 모노메틸아민 (MMA) 고압 예열',
      '고압 관형 아민화 반응기 (270°C, 60 bar)',
      '미반응 MMA 플래시 회수 및 재순환',
      '탈수탑 및 경질/중질 불순물 진공 정밀 증류',
      '수분/금속이온 초정밀 폴리싱 (Battery Grade >99.9%)',
    ],
    baseCapacityTpa: 50_000,
    baseIsblMUsd: 52,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 2450,
    rawMaterials: [
      { id: 'gbl', name: 'γ-부티로락톤 (GBL)', unit: 't', consumptionPerT: 0.9, defaultPriceUsd: 1580, note: '이론 0.868 t/t NMP' },
      { id: 'mma', name: '모노메틸아민 (MMA, 100%)', unit: 't', consumptionPerT: 0.33, defaultPriceUsd: 1150, note: '이론 0.313 t/t NMP' },
      { id: 'nmp_chem', name: '정제 흡착제 및 질소 실링', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 24 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 180, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀', unit: 't', consumptionPerT: 2.4, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 110, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's 2-Pyrrolidone & NMP, Battery Solvent Industry Benchmark (CEPCI=800)",
    keywords: ['nmp', 'gbl', 'mma', '이차전지', '양극재', '슬러리', '용매', '피롤리돈'],
  },

  // =========================================================================
  // 4. BATTERY, H2 & CCUS (5)
  // =========================================================================
  {
    id: 'h2_smr_ccus',
    productGroup: 'H2',
    category: 'battery_green',
    nameKo: '수소 (블루수소)',
    nameEn: 'Blue Hydrogen (SMR + CCUS)',
    formula: 'H₂',
    routeNameKo: '천연가스 개질 (SMR) + 90% CCUS',
    routeNameEn: 'Steam Methane Reforming + 90% CO₂ Capture',
    reactionEq: 'CH₄ + 2H₂O → 4H₂ + CO₂ (90% Captured & Compressed)',
    operatingSummary: '개질 850°C (25 bar) → WGS → 아민 CO₂ 포집 (90%) → PSA 정제 (99.99%), 열효율 ~72% (LHV)',
    blockSteps: [
      '천연가스 탈황 및 수증기 개질로 (SMR)',
      '고온/저온 수성가스전환 (WGS)',
      '공정가스 및 배가스 아민 CO₂ 포집 (90%)',
      'PSA 고순도 수소 정제 (99.99%+)',
      '포집 CO₂ 탈수 및 110 bar 초임계 압축',
    ],
    baseCapacityTpa: 100_000,
    baseIsblMUsd: 290,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 2600,
    rawMaterials: [
      { id: 'ng_feed', name: '천연가스 (개질 원료)', unit: 'GJ', consumptionPerT: 128, defaultPriceUsd: 7.5, note: '원료+연료 165 GJ/t H₂' },
      { id: 'di_water', name: '순수 / 보일러 급수', unit: 't', consumptionPerT: 14.0, defaultPriceUsd: 2.0 },
      { id: 'smr_chem', name: '개질 촉매 · 아민 보충', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 35 },
    ],
    utilities: [
      { id: 'fuel', name: '천연가스 (개질로 + CCUS 연료)', unit: 'GJ', consumptionPerT: 37, defaultPriceUsd: 7.5, kind: 'fuel' },
      { id: 'power', name: '전력 (CO₂ 압축 + PSA)', unit: 'kWh', consumptionPerT: 1450, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 280, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [],
    fixedCostPctCapex: 4.5,
    depreciationYears: 20,
    sourceNote: 'IEA Global Hydrogen Review, NETL Blue Hydrogen Baseline (CEPCI=800)',
    keywords: ['수소', 'h2', '블루수소', 'smr', 'ccus', '개질', '청정수소'],
  },
  {
    id: 'h2_alkaline',
    productGroup: 'H2',
    category: 'battery_green',
    nameKo: '수소 (그린수소)',
    nameEn: 'Green Hydrogen (Alkaline Electrolysis)',
    formula: 'H₂',
    routeNameKo: '알칼라인 수전해 (AWE)',
    routeNameEn: 'Alkaline Water Electrolysis (AWE)',
    reactionEq: '2H₂O → 2H₂ + O₂  (52 kWh/kg H₂ system)',
    operatingSummary: '60–80°C, 25–30 wt% KOH 전해액, 1.8–2.1 V, 스택+BoP 전력 52 kWh/kg H₂ (110 MW급 기준)',
    blockSteps: [
      '재생전력 AC/DC 정류기 및 변압 설비',
      '초순수 제조 (RO/EDI) 및 KOH 전해액 순환',
      '알칼라인 수전해 스택 (Ni 전극 / Zirfon 격막)',
      '기액 분리기 및 탈산소 촉매 · 건조 정제',
      '고순도 수소 (99.99%) 압축 저장',
    ],
    baseCapacityTpa: 15_000,
    baseIsblMUsd: 110,
    osblRatio: 0.3,
    scaleExponent: 0.85,
    referenceProductPriceUsdPerT: 4200,
    rawMaterials: [
      { id: 'di_water', name: '초순수 (DI Water)', unit: 't', consumptionPerT: 9.5, defaultPriceUsd: 3.5, note: '이론 8.94 t/t H₂' },
      { id: 'awe_maint', name: 'KOH 보충 · 스택 교체 충당금', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 85 },
    ],
    utilities: [
      { id: 'power', name: '재생전력 (52 kWh/kg H₂)', unit: 'kWh', consumptionPerT: 52000, defaultPriceUsd: 0.05, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 160, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'o2_byprod', name: '고순도 부산 산소 (O₂)', unit: 't', yieldPerT: 7.9, creditPriceUsd: 20 },
    ],
    fixedCostPctCapex: 4.0,
    depreciationYears: 20,
    sourceNote: 'IEA Global Hydrogen Review, IRENA Green Hydrogen Cost Reduction, NREL H2A',
    keywords: ['수소', 'h2', '그린수소', '수전해', '알칼라인', 'awe', '재생에너지'],
  },
  {
    id: 'h2_pem',
    productGroup: 'H2',
    category: 'battery_green',
    nameKo: '수소 (그린수소)',
    nameEn: 'Green Hydrogen (PEM Electrolysis)',
    formula: 'H₂',
    routeNameKo: '고분자전해질 수전해 (PEM)',
    routeNameEn: 'Proton Exchange Membrane (PEM) Electrolysis',
    reactionEq: '2H₂O → 2H₂ + O₂  (55 kWh/kg H₂ system)',
    operatingSummary: '50–70°C, PFSA 고분자막 + Ir/Pt 촉매, 30 bar 가압 출력, 재생에너지 변동성 고속 추종',
    blockSteps: [
      '재생전력 고효율 정류 및 고속 부하추종 제어',
      '초순수 (비저항 >10 MΩ·cm) 공급',
      'PEM 수전해 스택 (고전류밀도 2–3 A/cm²)',
      '가압 기액 분리 (30 bar) 및 탈산소/TSA 건조',
      '초고순도 수소 (99.999%) 출하',
    ],
    baseCapacityTpa: 15_000,
    baseIsblMUsd: 155,
    osblRatio: 0.28,
    scaleExponent: 0.85,
    referenceProductPriceUsdPerT: 4200,
    rawMaterials: [
      { id: 'ultrapure_water', name: '초순수 (Ultrapure Water)', unit: 't', consumptionPerT: 9.8, defaultPriceUsd: 4.0 },
      { id: 'pem_stack', name: 'PGM(Ir/Pt) 막-스택 교체 충당금', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 140 },
    ],
    utilities: [
      { id: 'power', name: '재생전력 (55 kWh/kg H₂)', unit: 'kWh', consumptionPerT: 55000, defaultPriceUsd: 0.05, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 180, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'o2_byprod', name: '고순도 부산 산소 (O₂)', unit: 't', yieldPerT: 7.9, creditPriceUsd: 20 },
    ],
    fixedCostPctCapex: 4.0,
    depreciationYears: 20,
    sourceNote: 'IEA Global Hydrogen Review, NREL H2A PEM Electrolysis Model',
    keywords: ['수소', 'h2', '그린수소', 'pem', '수전해', '고분자전해질', '재생에너지'],
  },
  {
    id: 'lioh_from_li2co3',
    productGroup: 'LiOH',
    category: 'battery_green',
    nameKo: '수산화리튬 일수화물',
    nameEn: 'Battery-Grade Lithium Hydroxide (LiOH·H₂O)',
    formula: 'LiOH·H₂O',
    routeNameKo: '탄산리튬 석회 가성화 전환법',
    routeNameEn: 'Lithium Carbonate Causticization Process',
    reactionEq: 'Li₂CO₃ + Ca(OH)₂ + 2H₂O → 2LiOH·H₂O + CaCO₃↓',
    operatingSummary: '80–95°C 수계 가성화 → CaCO₃ 여과 → 이온교환 정제 → 다단 진공 증발결정 (배터리급 >56.5% LiOH)',
    blockSteps: [
      '공업용 탄산리튬 · 소석회 슬러리 가성화 반응',
      '탄산칼슘 (CaCO₃) 침전 여과 및 다단 세척',
      '중금속/Ca²⁺ 킬레이트 이온교환 정제',
      '다중효용 진공 증발 결정화 (1·2차 재결정)',
      'CO₂ 차단 간접 건조 및 배터리급 포장',
    ],
    baseCapacityTpa: 25_000,
    baseIsblMUsd: 165,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 13200,
    rawMaterials: [
      { id: 'li2co3', name: '공업용 탄산리튬 (Li₂CO₃, 99%)', unit: 't', consumptionPerT: 0.93, defaultPriceUsd: 11500, note: '이론 0.880 t/t LiOH·H₂O' },
      { id: 'lime', name: '소석회 (Ca(OH)₂)', unit: 't', consumptionPerT: 0.95, defaultPriceUsd: 180, note: '이론 0.883 t/t' },
      { id: 'li_chem', name: '순수 · 이온교환수지 재생약품', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 45 },
    ],
    utilities: [
      { id: 'power', name: '전력', unit: 'kWh', consumptionPerT: 1150, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'steam', name: '스팀 (증발결정/건조)', unit: 't', consumptionPerT: 4.8, defaultPriceUsd: 28, kind: 'steam' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 120, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [
      { id: 'caco3_cake', name: '침강 탄산칼슘 (CaCO₃ 케이크)', unit: 't', yieldPerT: 1.15, creditPriceUsd: 15 },
    ],
    fixedCostPctCapex: 5.0,
    depreciationYears: 15,
    sourceNote: "Ullmann's Lithium Compounds, Public Battery Supply Chain Feasibility Studies (CEPCI=800)",
    keywords: ['수산화리튬', 'lioh', '탄산리튬', 'li2co3', '이차전지', '양극재', '하이니켈'],
  },
  {
    id: 'ccus_amine_capture',
    productGroup: 'CO2_Capture',
    category: 'battery_green',
    nameKo: '이산화탄소 포집 (CCUS)',
    nameEn: 'Post-Combustion CO₂ Capture (Amine)',
    formula: 'CO₂',
    routeNameKo: '아민 습식 화학흡수 · 초임계 압축',
    routeNameEn: 'Amine Wet Scrubbing & Supercritical Compression',
    reactionEq: '2RNH₂ + CO₂ ⇌ RNHCOO⁻ + RNH₃⁺  (ΔH_reg ≈ 3.0 GJ/t CO₂)',
    operatingSummary: '흡수탑 40–50°C → 재생탑 115–125°C (30% MEA/개량 아민, 포집률 90%) → 110 bar 압축 (포집 CO₂ 1 t 기준)',
    blockSteps: [
      '배가스 직접접촉 냉각기 (DCC) 및 SOx 전처리',
      '아민 흡수탑 (충진층, CO₂ 90% 포집)',
      '열교환기 및 리보일러 재생탑 (CO₂ 탈거)',
      '아민 리클레이머 (열화물 제거) 및 워터워시',
      '다단 CO₂ 압축 · TEG 탈수 (110 bar 초임계)',
    ],
    baseCapacityTpa: 1_000_000,
    baseIsblMUsd: 140,
    osblRatio: 0.35,
    scaleExponent: 0.65,
    referenceProductPriceUsdPerT: 85,
    rawMaterials: [
      { id: 'amine_solvent', name: '아민 흡수제 보충 (MEA/개량아민)', unit: 'kg', consumptionPerT: 1.2, defaultPriceUsd: 3.2 },
      { id: 'ccus_chem', name: '가성소다 · 부식억제제 · 활성탄', unit: 'lot', consumptionPerT: 1, defaultPriceUsd: 1.8 },
    ],
    utilities: [
      { id: 'steam', name: '저압 스팀 (리보일러 ~3.0 GJ/t)', unit: 't', consumptionPerT: 1.35, defaultPriceUsd: 24, kind: 'steam' },
      { id: 'power', name: '전력 (블로워 + 110 bar 압축)', unit: 'kWh', consumptionPerT: 115, defaultPriceUsd: 0.08, kind: 'power' },
      { id: 'cw', name: '냉각수', unit: 'm³', consumptionPerT: 75, defaultPriceUsd: 0.04, kind: 'cw' },
    ],
    byproducts: [],
    fixedCostPctCapex: 4.5,
    depreciationYears: 15,
    sourceNote: 'IEA CCUS Cost Benchmarks, NETL Post-Combustion Capture Report (CEPCI=800)',
    keywords: ['ccus', 'ccs', 'co2', '탄소포집', '이산화탄소', '아민', 'mea', '탄소중립'],
  },

  // =========================================================================
  // 5. EXPANDED COMMERCIAL CATALOG (+76 → 104 TOTAL PROCESSES)
  // =========================================================================
  ...HANDBOOK_PETROCHEM_EXTRA,
  ...HANDBOOK_POLYMERS_EXTRA,
  ...HANDBOOK_INORGANIC_EXTRA,
  ...HANDBOOK_BATTERY_GREEN_EXTRA,
];

/**
 * Representative 10 flagship commercial processes unlocked in full for
 * Beta (`simulator_only`) preview accounts while the remaining 94 routes
 * display stoichiometry & block-flow previews behind a Pro upgrade gate.
 * Admin and full accounts always have all 104 processes unlocked.
 */
export const BETA_UNLOCKED_HANDBOOK_IDS: ReadonlySet<string> = new Set([
  'ethylene_ncc',
  'methanol_smr',
  'po_hppo',
  'po_posm',
  'ammonia_hb',
  'h2o2_anthraquinone',
  'bpa_phenol_acetone',
  'nmp_gbl_mma',
  'h2_alkaline',
  'ccus_amine_capture',
]);

export function isHandbookProcessUnlockedForUser(
  entryId: string,
  isBetaSimOnly: boolean
): boolean {
  if (!isBetaSimOnly) return true;
  return BETA_UNLOCKED_HANDBOOK_IDS.has(entryId);
}

/**
 * Calculate scaled CAPEX, OPEX, unit production cost, margins, EBITDA, Payback, and ROI
 * for a given HandbookProcessEntry with optional parameter/price overrides.
 */
export function calculateHandbookEconomics(
  entry: HandbookProcessEntry,
  overrides?: HandbookCalcOverrides
): HandbookCalcResult {
  const capacityTpa = Math.max(1, overrides?.capacityTpa ?? entry.baseCapacityTpa);
  const cepci = Math.max(100, overrides?.cepci ?? BASE_CEPCI);
  const fxKrwPerUsd = Math.max(1, overrides?.fxKrwPerUsd ?? DEFAULT_FX_KRW_PER_USD);
  const productPriceUsdPerT =
    overrides?.productPriceUsd ?? entry.referenceProductPriceUsdPerT;

  // 1. CAPEX scaling (six-tenths rule + CEPCI escalation)
  const capacityRatio = capacityTpa / entry.baseCapacityTpa;
  const cepciRatio = cepci / BASE_CEPCI;
  const isblMUsd =
    entry.baseIsblMUsd * Math.pow(capacityRatio, entry.scaleExponent) * cepciRatio;
  const osblMUsd = isblMUsd * entry.osblRatio;
  const totalCapexMUsd = isblMUsd + osblMUsd;
  // 1 M USD = 1,000,000 USD -> (M USD * fx) / 100 = 억원 (10^8 KRW)
  const totalCapexEokKrw = (totalCapexMUsd * fxKrwPerUsd) / 100;

  // 2. Raw materials
  const rawMaterialLines: HandbookRawMaterialLine[] = entry.rawMaterials.map((item) => {
    const unitPriceUsd =
      overrides?.feedPriceOverrides?.[item.id] ?? item.defaultPriceUsd;
    const costUsdPerT = item.consumptionPerT * unitPriceUsd;
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      consumptionPerT: item.consumptionPerT,
      unitPriceUsd,
      costUsdPerT,
      note: item.note,
    };
  });
  const rawMaterialUsdPerT = rawMaterialLines.reduce(
    (sum, line) => sum + line.costUsdPerT,
    0
  );

  // 3. Utilities
  const utilityLines: HandbookUtilityLine[] = entry.utilities.map((item) => {
    let unitPriceUsd = overrides?.utilPriceOverrides?.[item.id];
    if (unitPriceUsd === undefined) {
      if (item.kind === 'power' && overrides?.powerPriceUsdPerKwh !== undefined) {
        unitPriceUsd = overrides.powerPriceUsdPerKwh;
      } else if (item.kind === 'steam' && overrides?.steamPriceUsdPerT !== undefined) {
        unitPriceUsd = overrides.steamPriceUsdPerT;
      } else {
        unitPriceUsd = item.defaultPriceUsd;
      }
    }
    const costUsdPerT = item.consumptionPerT * unitPriceUsd;
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      kind: item.kind,
      consumptionPerT: item.consumptionPerT,
      unitPriceUsd,
      costUsdPerT,
    };
  });
  const utilityUsdPerT = utilityLines.reduce(
    (sum, line) => sum + line.costUsdPerT,
    0
  );

  // 4. Byproduct credits
  const byproductLines: HandbookByproductLine[] = entry.byproducts.map((item) => {
    const creditPriceUsd =
      overrides?.byproductPriceOverrides?.[item.id] ?? item.creditPriceUsd;
    const creditUsdPerT = item.yieldPerT * creditPriceUsd;
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      yieldPerT: item.yieldPerT,
      creditPriceUsd,
      creditUsdPerT,
    };
  });
  const byproductCreditUsdPerT = byproductLines.reduce(
    (sum, line) => sum + line.creditUsdPerT,
    0
  );

  // 5. Variable, Fixed, Depreciation, Total Production Cost
  const netVariableUsdPerT =
    rawMaterialUsdPerT + utilityUsdPerT - byproductCreditUsdPerT;

  const totalCapexUsd = totalCapexMUsd * 1_000_000;
  const annualFixedCostUsd = totalCapexUsd * (entry.fixedCostPctCapex / 100);
  const fixedCostUsdPerT = annualFixedCostUsd / capacityTpa;

  const annualDepreciationUsd = totalCapexUsd / Math.max(1, entry.depreciationYears);
  const depreciationUsdPerT = annualDepreciationUsd / capacityTpa;

  const totalProdCostUsdPerT =
    netVariableUsdPerT + fixedCostUsdPerT + depreciationUsdPerT;
  const totalProdCostKrwPerT = totalProdCostUsdPerT * fxKrwPerUsd;

  // 6. Profitability metrics
  const grossMarginUsdPerT = productPriceUsdPerT - totalProdCostUsdPerT;
  const ebitdaUsdPerT = productPriceUsdPerT - netVariableUsdPerT - fixedCostUsdPerT;

  const annualRevenueUsd = productPriceUsdPerT * capacityTpa;
  const annualEbitdaUsd = ebitdaUsdPerT * capacityTpa;
  const annualEbitUsd = grossMarginUsdPerT * capacityTpa;

  const annualRevenueEokKrw = (annualRevenueUsd * fxKrwPerUsd) / 1e8;
  const annualEbitdaEokKrw = (annualEbitdaUsd * fxKrwPerUsd) / 1e8;

  const paybackYears =
    annualEbitdaUsd > 0 ? totalCapexUsd / annualEbitdaUsd : Number.POSITIVE_INFINITY;
  const roiPct = totalCapexUsd > 0 ? (annualEbitUsd / totalCapexUsd) * 100 : 0;

  return {
    capacityTpa,
    cepci,
    fxKrwPerUsd,
    isblMUsd,
    osblMUsd,
    totalCapexMUsd,
    totalCapexEokKrw,
    rawMaterialUsdPerT,
    utilityUsdPerT,
    byproductCreditUsdPerT,
    netVariableUsdPerT,
    fixedCostUsdPerT,
    depreciationUsdPerT,
    totalProdCostUsdPerT,
    totalProdCostKrwPerT,
    productPriceUsdPerT,
    grossMarginUsdPerT,
    annualRevenueEokKrw,
    annualEbitdaEokKrw,
    paybackYears,
    roiPct,
    rawMaterialLines,
    utilityLines,
    byproductLines,
  };
}

/**
 * Returns all routes in the handbook that produce the same productGroup
 * (e.g., PO: HPPO vs PO/SM; ECH: Propylene vs GTE; H2: SMR+CCUS vs AWE vs PEM).
 */
export function getComparableRoutes(
  entry: HandbookProcessEntry
): HandbookProcessEntry[] {
  return PROCESS_ECONOMICS_HANDBOOK.filter(
    (item) => item.productGroup === entry.productGroup
  );
}

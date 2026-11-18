'use client';

import { create } from 'zustand';
import { ElectrolyzerInputs } from '@/lib/calculations/electrolyzer';
import { PlantMassBalance, calculatePlantBalance } from '@/lib/calculations/streams';
import { DEFAULT_CONDITIONS, MW } from '@/lib/calculations/constants';

export type PlantId = 'clorsim' | 'clorsim_sim' | 'hcl_synth' | 'ech_gte' | 'cms_plant' | 'mdi_plant' | 'green_h2' | 'new_builder' | 'classic_sim';

export const ACTIVE_PLANT_STORAGE_KEY = 'chemplant-active-plant-v1';
export const LAST_COMMERCIAL_PLANT_STORAGE_KEY = 'chemplant-last-commercial-plant-v1';
export const PLANT02_SIDEBAR_INPUTS_KEY = 'chemplant-plant02-sidebar-inputs-v1';
export const PLANT03_SIDEBAR_INPUTS_KEY = 'chemplant-plant03-sidebar-inputs-v1';
export const CMS_SIDEBAR_INPUTS_KEY = 'chemplant-cms-sidebar-inputs-v1';
export const MDI_SIDEBAR_INPUTS_KEY = 'chemplant-mdi-sidebar-inputs-v1';

export interface SimNodeActionRequest {
  sheetId: string;
  nodeIdOrTag: string;
  openWorkbench?: boolean;
  workbenchView?: 'mesh' | 'internals' | 'thermal' | 'mechanical';
  seq: number;
}

export interface Plant03OperatingInputs {
  cl2FeedKgH: number;       // 원료 건조염소 공급량 (kg/h, 기본 3196)
  h2ExcessPct: number;      // 합성버너 수소 과잉률 (%, 기본 4.8)
  ahclSplitPct: number;     // 200 SEC 5N 무수염산 분기율 (%, 기본 42)
  liquefierTempC: number;   // E-225 심냉액화기 출구온도 (°C, 기본 -24)
  spentHclFeedKgH: number;  // 300 SEC 부생 폐염산 유입량 (kg/h, 기본 4000)
  spentHclConcWt: number;   // 부생 폐염산 유입 농도 (wt%, 기본 15.0)
  vacColPressKg: number;    // C-310 진공 농축탑 탑정압력 (kgf/cm²G, 기본 -0.88)
}

export interface Plant03KpiSummary {
  h2FeedKgH: number;
  upwMakeupKgH: number;
  synthHclKgH: number;
  synthHclTonDay: number;
  ahcl5nKgH: number;
  ahcl5nTonDay: number;
  hcl35SolKgH: number;
  hcl35SolTonDay: number;
  hcl35PureTonDay: number;
  psdCleanWaterKgH: number;
  psdCleanWaterTonDay: number;
  psdRecycledHclKgH: number;
  cl2UsageTonDay: number;
  h2UsageTonDay: number;
  spentFeedTonDay: number;
  elecPowerKW: number;
  thermalDutyMW: number;
}

export function calculatePlant03Summary(p3: Plant03OperatingInputs): Plant03KpiSummary {
  const cl2KgH = Math.max(0, p3.cl2FeedKgH);
  const cl2KmolH = cl2KgH / MW.Cl2;
  const stoichH2KgH = cl2KmolH * MW.H2;
  const h2FeedKgH = stoichH2KgH * (1 + Math.max(0, p3.h2ExcessPct) / 100);

  // R-101 합성버너 생성 HCl (전환율 99.9998%)
  const synthHclKgH = 2 * cl2KmolH * MW.HCl * 0.999998;
  const splitFrac = Math.max(0.05, Math.min(0.92, p3.ahclSplitPct / 100));

  // 100 SEC 전자급 35 wt% 고순도 염산 흡수계통
  const hclTo100KgH = synthHclKgH * (1 - splitFrac) * 0.9995;
  const hcl35SolKgH = hclTo100KgH / 0.35;
  const upwMakeupKgH = Math.max(0, hcl35SolKgH - hclTo100KgH);

  // 300 SEC 폐염산 압력변동 공비증류(PSD) 회수계통
  const spentKgH = Math.max(0, p3.spentHclFeedKgH);
  const wSpent = Math.max(0.01, Math.min(0.30, p3.spentHclConcWt / 100));
  const psdRecycledHclKgH = spentKgH * wSpent * 0.992;
  const psdCleanWaterKgH = spentKgH * (1 - wSpent);

  // 200 SEC 반도체 5N 액화 무수염산(AHCl) 정제계통
  const totalDryHclTo200KgH = synthHclKgH * splitFrac + psdRecycledHclKgH;
  const liqYield = Math.max(
    0.72,
    Math.min(0.992, 0.968 + (-24.0 - p3.liquefierTempC) * 0.004)
  );
  const ahcl5nKgH = totalDryHclTo200KgH * liqYield;

  // 압축기·펌프 소요 전력 및 냉동/재비 열부하 추정
  const elecPowerKW = (totalDryHclTo200KgH / 1975.0) * 285.0 + (spentKgH / 4000.0) * 24.0 + 18.0;
  const thermalDutyMW =
    (totalDryHclTo200KgH * 112.0 + spentKgH * 430.0 + synthHclKgH * 185.0) / 859845.0;

  return {
    h2FeedKgH,
    upwMakeupKgH,
    synthHclKgH,
    synthHclTonDay: (synthHclKgH * 24) / 1000,
    ahcl5nKgH,
    ahcl5nTonDay: (ahcl5nKgH * 24) / 1000,
    hcl35SolKgH,
    hcl35SolTonDay: (hcl35SolKgH * 24) / 1000,
    hcl35PureTonDay: (hclTo100KgH * 24) / 1000,
    psdCleanWaterKgH,
    psdCleanWaterTonDay: (psdCleanWaterKgH * 24) / 1000,
    psdRecycledHclKgH,
    cl2UsageTonDay: (cl2KgH * 24) / 1000,
    h2UsageTonDay: (h2FeedKgH * 24) / 1000,
    spentFeedTonDay: (spentKgH * 24) / 1000,
    elecPowerKW,
    thermalDutyMW,
  };
}

export interface CmsPlantOperatingInputs {
  cl2FeedTonDay: number;       // 액체염소 투입량 (T/D, 기본 220.0)
  mcCl2MolarRatio: number;     // 반응기 입구 MC/Cl2 몰비 (기본 2.08, MCL 순환 없음)
  reactorTempC: number;        // R-101 반응온도 (°C, 기본 120.0)
  reactorPressKgcm2g: number;  // R-101 반응압력 (kgf/cm²G, 기본 24.0)
  aibnDosagePpm: number;       // AIBN 자유라디칼 개시제 주입량 (wt ppm, 기본 350)
  hclStripperPressKg: number;  // C-201 고압 HCl 탈거탑 압력 (kgf/cm²G, 기본 17.5)
}

export interface CmsPlantKpiSummary {
  cl2FeedKgH: number;
  freshMcKgH: number;
  freshMcTonDay: number;
  recycleMcKgH: number;
  recycleMcTonDay: number;
  mclProdKgH: number;
  mclProdTonDay: number;
  cfmProdKgH: number;
  cfmProdTonDay: number;
  ahclByprodKgH: number;
  ahclByprodTonDay: number;
  ctcHeavyWasteKgH: number;
  ctcHeavyWasteTonDay: number;
  cl2ConversionPct: number;
  vaporizerDutyMW: number;
  reactorCoolingMW: number;
  reboilerDutyMW: number;
  elecPowerKW: number;
}

export function calculateCmsPlantSummary(cms: CmsPlantOperatingInputs): CmsPlantKpiSummary {
  const cl2TonDay = Math.max(20, cms.cl2FeedTonDay);
  const cl2FeedKgH = (cl2TonDay * 1000) / 24.0;
  const nCl2In = cl2FeedKgH / MW.Cl2; // ~129.28 kmol/h at 220 T/D

  // AIBN 라디칼 농도 √([AIBN]/350) 및 온도 아레니우스 보정으로 연쇄염소화 전환율 추적
  const aibnFactor = Math.sqrt(Math.max(50, cms.aibnDosagePpm) / 350.0);
  const tempFactor = Math.exp(0.018 * (cms.reactorTempC - 120.0));
  const cl2Conv = Math.min(0.9995, Math.max(0.92, 1.0 - 0.0012 / Math.max(0.25, aibnFactor * tempFactor)));
  const nCl2Consumed = nCl2In * cl2Conv;

  // 연속 염소화 상대 속도 (k1:k2:k3 = 1 : 2.14 : 1.08), MC/Cl2 몰비가 높을수록 MCL 선택도 증가
  const ratioRef = Math.max(1.2, Math.min(4.0, cms.mcCl2MolarRatio));
  const mcBias = ratioRef / 2.08;
  // Base selectivity at 2.08 mol/mol, 120C: MCL 58.88 kmol/h (120 T/D), CFM 27.94 kmol/h (80 T/D), CTC+Heavy 4.86 kmol/h (~18 T/D)
  // Cl2 stoic needed = 1*nMCL + 2*nCFM + 3*nCTC = 58.88 + 55.88 + 14.58 = 129.34 kmol/h -> matches 220 T/D Cl2!
  const wMclRaw = 1.0 * mcBias;
  const wCfmRaw = 0.4745 / Math.pow(mcBias, 0.55) * Math.exp(0.0055 * (cms.reactorTempC - 120.0));
  const wCtcRaw = 0.0825 / Math.pow(mcBias, 0.85) * Math.exp(0.011 * (cms.reactorTempC - 120.0));
  const cl2PerNetMc = wMclRaw + 2.0 * wCfmRaw + 3.0 * wCtcRaw;

  const nMcReacted = nCl2Consumed / cl2PerNetMc;
  const nMclProd = nMcReacted * wMclRaw;
  const nCfmProd = nMcReacted * wCfmRaw;
  const nCtcHeavy = nMcReacted * wCtcRaw;

  const freshMcKgH = nMcReacted * MW.CH3Cl / 0.996; // 0.4% HCl/vent loss accounted
  const totalMcReactorIn = nCl2In * ratioRef * MW.CH3Cl;
  const recycleMcKgH = Math.max(0, totalMcReactorIn - freshMcKgH);

  const mclProdKgH = nMclProd * MW.CH2Cl2;
  const cfmProdKgH = nCfmProd * MW.CHCl3;
  const ahclByprodKgH = nCl2Consumed * MW.HCl * 0.998;
  // ~14% of heavy stream is C2Cl4/TMSN heavies from radical coupling + AIBN carrier
  const ctcHeavyWasteKgH = nCtcHeavy * MW.CCl4 * 1.005;

  const vaporizerDutyMW = (cl2FeedKgH * 72.5) / 859845.0; // subcooled Liq Cl2 25C -> 95C Gas
  const reactorCoolingMW = (nCl2Consumed * 24500.0) / 859845.0; // exothermic ~24.5 Mcal/kmol Cl2
  const reboilerDutyMW = ((freshMcKgH + recycleMcKgH + mclProdKgH + cfmProdKgH) * 142.0) / 859845.0;
  const elecPowerKW = 420.0 + (cl2FeedKgH / 9166.7) * 510.0;

  return {
    cl2FeedKgH,
    freshMcKgH,
    freshMcTonDay: (freshMcKgH * 24) / 1000,
    recycleMcKgH,
    recycleMcTonDay: (recycleMcKgH * 24) / 1000,
    mclProdKgH,
    mclProdTonDay: (mclProdKgH * 24) / 1000,
    cfmProdKgH,
    cfmProdTonDay: (cfmProdKgH * 24) / 1000,
    ahclByprodKgH,
    ahclByprodTonDay: (ahclByprodKgH * 24) / 1000,
    ctcHeavyWasteKgH,
    ctcHeavyWasteTonDay: (ctcHeavyWasteKgH * 24) / 1000,
    cl2ConversionPct: cl2Conv * 100,
    vaporizerDutyMW,
    reactorCoolingMW,
    reboilerDutyMW,
    elecPowerKW,
  };
}

export interface MdiPlantOperatingInputs {
  annualCapacityKta: number;  // 연간 MDI 생산규모 (kt/yr, 기본 100.0)
  pureMdiSharePct: number;    // Pure 4,4'-MDI 비율 (wt%, 기본 36.0)
  anilineToHchoRatio: number; // 100 SEC Aniline/HCHO 몰비 (기본 3.2)
  phosgeneExcessPct: number;  // 200 SEC 포스겐 과잉률 (%, 기본 100.0)
  mcbSolventRatio: number;    // MCB 용매/MDA 질량비 (기본 2.5)
  vacColTopMbar: number;      // 400 SEC 고진공 분별탑 압력 (mbar, 기본 20.0)
}

export interface MdiPlantKpiSummary {
  totalMdiKgH: number;
  totalMdiTonDay: number;
  annualCapacityKta: number;
  pureMdiKgH: number;
  pureMdiTonDay: number;
  pmdiKgH: number;
  pmdiTonDay: number;
  anilineFreshKgH: number;
  formalin37KgH: number;
  coFreshKgH: number;
  cl2FreshKgH: number;
  byproductHclKgH: number;
  byproductHclTonDay: number;
  mcbRecycleKgH: number;
  elecPowerKW: number;
  thermalDutyMW: number;
}

export function calculateMdiPlantSummary(mdi: MdiPlantOperatingInputs): MdiPlantKpiSummary {
  const capKta = Math.max(20, mdi.annualCapacityKta);
  const totalMdiKgH = (capKta * 1_000_000) / 8000.0; // 100 kTA -> 12,500 kg/h
  const pureFrac = Math.max(0.15, Math.min(0.65, mdi.pureMdiSharePct / 100));
  const pureMdiKgH = totalMdiKgH * pureFrac;
  const pmdiKgH = Math.max(0, totalMdiKgH - pureMdiKgH);
  const scale = totalMdiKgH / 12500.0;
  const nMdiIso = totalMdiKgH / 250.256; // 49.949 kmol/h at 100 kTA
  const nMdaNeed = nMdiIso / 0.998;
  const anilineFreshKgH = 2.0 * nMdaNeed * 93.128;
  const hchoFreshKgH = (nMdaNeed / 0.995) * 30.026;
  const formalin37KgH = hchoFreshKgH / 0.37;
  const nPhosFresh = 2.0 * nMdaNeed;
  const coFreshKgH = (nPhosFresh / 0.996) * 28.010;
  const cl2FreshKgH = (nPhosFresh / 0.996) * MW.Cl2;
  const byproductHclKgH = 4.0 * nMdiIso * MW.HCl;
  const mcbRecycleKgH = nMdaNeed * 198.268 * Math.max(1.2, mdi.mcbSolventRatio);
  const vacPenalty = mdi.vacColTopMbar < 15 ? 1.12 : 1.0;
  const elecPowerKW = (1950 + (mdi.phosgeneExcessPct / 100) * 320) * scale;
  const thermalDutyMW = (14.8 + (mdi.mcbSolventRatio - 2.0) * 1.9 + (mdi.anilineToHchoRatio - 3.0) * 1.4) * scale * vacPenalty;

  return {
    totalMdiKgH,
    totalMdiTonDay: (totalMdiKgH * 24) / 1000,
    annualCapacityKta: capKta,
    pureMdiKgH,
    pureMdiTonDay: (pureMdiKgH * 24) / 1000,
    pmdiKgH,
    pmdiTonDay: (pmdiKgH * 24) / 1000,
    anilineFreshKgH,
    formalin37KgH,
    coFreshKgH,
    cl2FreshKgH,
    byproductHclKgH,
    byproductHclTonDay: (byproductHclKgH * 24) / 1000,
    mcbRecycleKgH,
    elecPowerKW,
    thermalDutyMW,
  };
}

interface BalanceStore {
  activePlantId: PlantId;
  lastCommercialPlantId: PlantId;
  lastPlantReturnHref: string;
  expansionScaleFactor: number;
  simActiveSheetId: string;
  simRequestedSheetId: { sheetId: string; seq: number } | null;
  simRequestedNodeAction: SimNodeActionRequest | null;

  // PLANT 01 (전해 기준공장 — 독립 보존)
  inputs: ElectrolyzerInputs;
  balance: PlantMassBalance;
  result: PlantMassBalance; // alias for balance
  activeSection: '100' | '200' | '300' | '400' | 'all';

  // PLANT 02 (전해 시뮬레이터 — Plant 01과 동일 대시보드 구조 + 시뮬레이터 연동)
  plant02Inputs: ElectrolyzerInputs;
  plant02Balance: PlantMassBalance;
  plant02SyncSeq: number;

  // PLANT 03 (1A 염산·회수 시뮬레이터 — 전용 Capa 운전변수 + 시뮬레이터 연동)
  plant03Inputs: Plant03OperatingInputs;
  plant03Summary: Plant03KpiSummary;
  plant03SyncSeq: number;

  // PLANT 04 (클로로메탄 CMS 공정 — Cl2 220 T/D, MCL 120 T/D, CFM 80 T/D)
  cmsPlantInputs: CmsPlantOperatingInputs;
  cmsPlantSummary: CmsPlantKpiSummary;
  cmsPlantSyncSeq: number;

  // PLANT 05 (금호미쓰이 MDI 10만톤 공정 — Pure 4,4'-MDI 4,500 kg/h · PMDI 8,000 kg/h)
  mdiPlantInputs: MdiPlantOperatingInputs;
  mdiPlantSummary: MdiPlantKpiSummary;
  mdiPlantSyncSeq: number;

  setActivePlantId: (id: PlantId) => void;
  hydrateActivePlant: () => void;
  setLastPlantReturnHref: (href: string) => void;
  setExpansionScaleFactor: (sf: number) => void;
  setSimActiveSheetId: (sheetId: string) => void;
  requestSimSheet: (sheetId: string) => void;
  requestSimNodeAction: (req: Omit<SimNodeActionRequest, 'seq'>) => void;
  clearSimNodeAction: () => void;

  setInput: (key: keyof ElectrolyzerInputs, value: number) => void;
  resetInputs: () => void;

  setPlant02Input: (key: keyof ElectrolyzerInputs, value: number) => void;
  resetPlant02Inputs: () => void;

  setPlant03Input: (key: keyof Plant03OperatingInputs, value: number) => void;
  resetPlant03Inputs: () => void;

  setCmsPlantInput: (key: keyof CmsPlantOperatingInputs, value: number) => void;
  resetCmsPlantInputs: () => void;

  setMdiPlantInput: (key: keyof MdiPlantOperatingInputs, value: number) => void;
  resetMdiPlantInputs: () => void;

  setActiveSection: (section: '100' | '200' | '300' | '400' | 'all') => void;
  recalculate: () => void;
}

export const defaultElectrolyzerInputs: ElectrolyzerInputs = {
  numElectrolyzers: DEFAULT_CONDITIONS.numElectrolyzers,
  cellsPerElectrolyzer: DEFAULT_CONDITIONS.cellsPerElectrolyzer,
  operatingCurrentKA: DEFAULT_CONDITIONS.operatingCurrentKA,
  currentEfficiency: DEFAULT_CONDITIONS.currentEfficiency,
  brineFeedConcWt: 25.65,
  brineFeedTempC: 60.0,
  anolyteExitConcWt: 17.45,
  catholyteConcWt: 32.34,
  electrolyzerTempC: 89.0,
  anodeTempC: 87.0,
  cathodeTempC: 90.0,
  anodePressKgcm2g: 0.40,
  cathodePressKgcm2g: 0.45,
  t280VacuumPressKgcm2g: -0.65,
  cl2Cooler1TempC: 40.0,
  cl2Cooler2TempC: 20.0,
  cl2CompPressKgcm2g: 3.0,
  h2Cooler1TempC: 41.0,
  h2Cooler2TempC: 10.0,
  h2CompPressKgcm2g: 23.0,
  h2HighPCoolTempC: 10.0,
};

export const defaultPlant03Inputs: Plant03OperatingInputs = {
  cl2FeedKgH: 3196.0,
  h2ExcessPct: 4.8,
  ahclSplitPct: 42.0,
  liquefierTempC: -24.0,
  spentHclFeedKgH: 4000.0,
  spentHclConcWt: 15.0,
  vacColPressKg: -0.88,
};

export const defaultCmsPlantInputs: CmsPlantOperatingInputs = {
  cl2FeedTonDay: 220.0,
  mcCl2MolarRatio: 2.08,
  reactorTempC: 120.0,
  reactorPressKgcm2g: 24.0,
  aibnDosagePpm: 350.0,
  hclStripperPressKg: 17.5,
};

export const defaultMdiPlantInputs: MdiPlantOperatingInputs = {
  annualCapacityKta: 100.0,
  pureMdiSharePct: 36.0,
  anilineToHchoRatio: 3.2,
  phosgeneExcessPct: 100.0,
  mcbSolventRatio: 2.5,
  vacColTopMbar: 20.0,
};

export const useBalanceStore = create<BalanceStore>((set, get) => {
  const initBal = calculatePlantBalance(defaultElectrolyzerInputs);
  const initP2Bal = calculatePlantBalance(defaultElectrolyzerInputs);
  const initP3Sum = calculatePlant03Summary(defaultPlant03Inputs);
  const initCmsSum = calculateCmsPlantSummary(defaultCmsPlantInputs);
  const initMdiSum = calculateMdiPlantSummary(defaultMdiPlantInputs);

  return {
    activePlantId: 'clorsim_sim',
    lastCommercialPlantId: 'clorsim_sim',
    lastPlantReturnHref: '/material-balance',
    expansionScaleFactor: 1.0,
    simActiveSheetId: 'master',
    simRequestedSheetId: null,
    simRequestedNodeAction: null,

    inputs: defaultElectrolyzerInputs,
    balance: initBal,
    result: initBal,
    activeSection: 'all',

    plant02Inputs: { ...defaultElectrolyzerInputs },
    plant02Balance: initP2Bal,
    plant02SyncSeq: 0,

    plant03Inputs: { ...defaultPlant03Inputs },
    plant03Summary: initP3Sum,
    plant03SyncSeq: 0,

    cmsPlantInputs: { ...defaultCmsPlantInputs },
    cmsPlantSummary: initCmsSum,
    cmsPlantSyncSeq: 0,

    mdiPlantInputs: { ...defaultMdiPlantInputs },
    mdiPlantSummary: initMdiSum,
    mdiPlantSyncSeq: 0,

    setActivePlantId: (id) => {
      const isCommercial = id !== 'new_builder' && id !== 'classic_sim';
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(ACTIVE_PLANT_STORAGE_KEY, id);
          if (isCommercial) {
            window.localStorage.setItem(LAST_COMMERCIAL_PLANT_STORAGE_KEY, id);
          }
        } catch {
          // ignore storage quota errors
        }
      }
      set((state) => ({
        activePlantId: id,
        lastCommercialPlantId: isCommercial ? id : state.lastCommercialPlantId,
        simActiveSheetId: state.activePlantId === id ? state.simActiveSheetId : 'master',
      }));
    },

    hydrateActivePlant: () => {
      if (typeof window === 'undefined') return;
      try {
        const saved = window.localStorage.getItem(ACTIVE_PLANT_STORAGE_KEY) as PlantId | null;
        const savedCommercial = window.localStorage.getItem(LAST_COMMERCIAL_PLANT_STORAGE_KEY) as PlantId | null;
        const patch: Partial<BalanceStore> = {};
        if (
          saved === 'clorsim' ||
          saved === 'green_h2'
        ) {
          patch.activePlantId = 'clorsim_sim';
          patch.lastCommercialPlantId = 'clorsim_sim';
        } else if (
          saved === 'clorsim_sim' ||
          saved === 'hcl_synth' ||
          saved === 'ech_gte' ||
          saved === 'cms_plant' ||
          saved === 'mdi_plant' ||
          saved === 'new_builder' ||
          saved === 'classic_sim'
        ) {
          patch.activePlantId = saved;
          if (saved !== 'new_builder' && saved !== 'classic_sim') {
            patch.lastCommercialPlantId = saved;
          }
        }
        if (
          savedCommercial === 'clorsim' ||
          savedCommercial === 'green_h2'
        ) {
          patch.lastCommercialPlantId = 'clorsim_sim';
        } else if (
          savedCommercial === 'clorsim_sim' ||
          savedCommercial === 'hcl_synth' ||
          savedCommercial === 'ech_gte' ||
          savedCommercial === 'cms_plant' ||
          savedCommercial === 'mdi_plant'
        ) {
          patch.lastCommercialPlantId = savedCommercial;
        }
        const rawP2 = window.localStorage.getItem(PLANT02_SIDEBAR_INPUTS_KEY);
        if (rawP2) {
          const parsedP2 = { ...defaultElectrolyzerInputs, ...JSON.parse(rawP2) };
          patch.plant02Inputs = parsedP2;
          patch.plant02Balance = calculatePlantBalance(parsedP2);
        }
        const rawP3 = window.localStorage.getItem(PLANT03_SIDEBAR_INPUTS_KEY);
        if (rawP3) {
          const parsedP3 = { ...defaultPlant03Inputs, ...JSON.parse(rawP3) };
          patch.plant03Inputs = parsedP3;
          patch.plant03Summary = calculatePlant03Summary(parsedP3);
        }
        const rawCms = window.localStorage.getItem(CMS_SIDEBAR_INPUTS_KEY);
        if (rawCms) {
          const parsedCms = { ...defaultCmsPlantInputs, ...JSON.parse(rawCms) };
          patch.cmsPlantInputs = parsedCms;
          patch.cmsPlantSummary = calculateCmsPlantSummary(parsedCms);
        }
        const rawMdi = window.localStorage.getItem(MDI_SIDEBAR_INPUTS_KEY);
        if (rawMdi) {
          const parsedMdi = { ...defaultMdiPlantInputs, ...JSON.parse(rawMdi) };
          patch.mdiPlantInputs = parsedMdi;
          patch.mdiPlantSummary = calculateMdiPlantSummary(parsedMdi);
        }
        if (Object.keys(patch).length > 0) {
          set(patch);
        }
      } catch {
        // ignore
      }
    },

    setLastPlantReturnHref: (href) => set({ lastPlantReturnHref: href }),
    setExpansionScaleFactor: (sf) => set({ expansionScaleFactor: sf }),
    setSimActiveSheetId: (sheetId) => set({ simActiveSheetId: sheetId }),
    requestSimSheet: (sheetId) =>
      set((state) => ({
        simActiveSheetId: sheetId,
        simRequestedSheetId: { sheetId, seq: (state.simRequestedSheetId?.seq ?? 0) + 1 },
      })),
    requestSimNodeAction: (req) =>
      set((state) => ({
        simActiveSheetId: req.sheetId,
        simRequestedNodeAction: {
          ...req,
          seq: (state.simRequestedNodeAction?.seq ?? 0) + 1,
        },
      })),
    clearSimNodeAction: () => set({ simRequestedNodeAction: null }),

    setInput: (key, value) => {
      const newInputs = { ...get().inputs, [key]: value };
      const newBal = calculatePlantBalance(newInputs);
      set({
        inputs: newInputs,
        balance: newBal,
        result: newBal,
      });
    },

    resetInputs: () => {
      const newBal = calculatePlantBalance(defaultElectrolyzerInputs);
      set({
        inputs: { ...defaultElectrolyzerInputs },
        balance: newBal,
        result: newBal,
      });
    },

    setPlant02Input: (key, value) => {
      const nextP2 = { ...get().plant02Inputs, [key]: value };
      const nextBal = calculatePlantBalance(nextP2);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(PLANT02_SIDEBAR_INPUTS_KEY, JSON.stringify(nextP2));
        } catch {
          // ignore
        }
      }
      set((state) => ({
        plant02Inputs: nextP2,
        plant02Balance: nextBal,
        plant02SyncSeq: state.plant02SyncSeq + 1,
      }));
    },

    resetPlant02Inputs: () => {
      const nextP2 = { ...defaultElectrolyzerInputs };
      const nextBal = calculatePlantBalance(nextP2);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(PLANT02_SIDEBAR_INPUTS_KEY, JSON.stringify(nextP2));
        } catch {
          // ignore
        }
      }
      set((state) => ({
        plant02Inputs: nextP2,
        plant02Balance: nextBal,
        plant02SyncSeq: state.plant02SyncSeq + 1,
      }));
    },

    setPlant03Input: (key, value) => {
      const nextP3 = { ...get().plant03Inputs, [key]: value };
      const nextSum = calculatePlant03Summary(nextP3);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(PLANT03_SIDEBAR_INPUTS_KEY, JSON.stringify(nextP3));
        } catch {
          // ignore
        }
      }
      set((state) => ({
        plant03Inputs: nextP3,
        plant03Summary: nextSum,
        plant03SyncSeq: state.plant03SyncSeq + 1,
      }));
    },

    resetPlant03Inputs: () => {
      const nextP3 = { ...defaultPlant03Inputs };
      const nextSum = calculatePlant03Summary(nextP3);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(PLANT03_SIDEBAR_INPUTS_KEY, JSON.stringify(nextP3));
        } catch {
          // ignore
        }
      }
      set((state) => ({
        plant03Inputs: nextP3,
        plant03Summary: nextSum,
        plant03SyncSeq: state.plant03SyncSeq + 1,
      }));
    },

    setCmsPlantInput: (key, value) => {
      const nextCms = { ...get().cmsPlantInputs, [key]: value };
      const nextSum = calculateCmsPlantSummary(nextCms);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(CMS_SIDEBAR_INPUTS_KEY, JSON.stringify(nextCms));
        } catch {
          // ignore
        }
      }
      set((state) => ({
        cmsPlantInputs: nextCms,
        cmsPlantSummary: nextSum,
        cmsPlantSyncSeq: state.cmsPlantSyncSeq + 1,
      }));
    },

    resetCmsPlantInputs: () => {
      const nextCms = { ...defaultCmsPlantInputs };
      const nextSum = calculateCmsPlantSummary(nextCms);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(CMS_SIDEBAR_INPUTS_KEY, JSON.stringify(nextCms));
        } catch {
          // ignore
        }
      }
      set((state) => ({
        cmsPlantInputs: nextCms,
        cmsPlantSummary: nextSum,
        cmsPlantSyncSeq: state.cmsPlantSyncSeq + 1,
      }));
    },

    setMdiPlantInput: (key, value) => {
      const nextMdi = { ...get().mdiPlantInputs, [key]: value };
      const nextSum = calculateMdiPlantSummary(nextMdi);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(MDI_SIDEBAR_INPUTS_KEY, JSON.stringify(nextMdi));
        } catch {
          // ignore
        }
      }
      set((state) => ({
        mdiPlantInputs: nextMdi,
        mdiPlantSummary: nextSum,
        mdiPlantSyncSeq: state.mdiPlantSyncSeq + 1,
      }));
    },

    resetMdiPlantInputs: () => {
      const nextMdi = { ...defaultMdiPlantInputs };
      const nextSum = calculateMdiPlantSummary(nextMdi);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(MDI_SIDEBAR_INPUTS_KEY, JSON.stringify(nextMdi));
        } catch {
          // ignore
        }
      }
      set((state) => ({
        mdiPlantInputs: nextMdi,
        mdiPlantSummary: nextSum,
        mdiPlantSyncSeq: state.mdiPlantSyncSeq + 1,
      }));
    },

    setActiveSection: (section) => set({ activeSection: section }),

    recalculate: () => {
      const newBal = calculatePlantBalance(get().inputs);
      set({ balance: newBal, result: newBal });
    },
  };
});

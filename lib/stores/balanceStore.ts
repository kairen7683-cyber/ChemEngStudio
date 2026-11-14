'use client';

import { create } from 'zustand';
import { ElectrolyzerInputs } from '@/lib/calculations/electrolyzer';
import { PlantMassBalance, calculatePlantBalance } from '@/lib/calculations/streams';
import { DEFAULT_CONDITIONS, MW } from '@/lib/calculations/constants';

export type PlantId = 'clorsim' | 'clorsim_sim' | 'hcl_synth' | 'ech_gte' | 'green_h2' | 'new_builder' | 'classic_sim';

export const ACTIVE_PLANT_STORAGE_KEY = 'chemplant-active-plant-v1';
export const LAST_COMMERCIAL_PLANT_STORAGE_KEY = 'chemplant-last-commercial-plant-v1';
export const PLANT02_SIDEBAR_INPUTS_KEY = 'chemplant-plant02-sidebar-inputs-v1';
export const PLANT03_SIDEBAR_INPUTS_KEY = 'chemplant-plant03-sidebar-inputs-v1';

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

export const useBalanceStore = create<BalanceStore>((set, get) => {
  const initBal = calculatePlantBalance(defaultElectrolyzerInputs);
  const initP2Bal = calculatePlantBalance(defaultElectrolyzerInputs);
  const initP3Sum = calculatePlant03Summary(defaultPlant03Inputs);

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
          savedCommercial === 'ech_gte'
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

    setActiveSection: (section) => set({ activeSection: section }),

    recalculate: () => {
      const newBal = calculatePlantBalance(get().inputs);
      set({ balance: newBal, result: newBal });
    },
  };
});

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { useUnitStore } from '@/lib/stores/unitStore';
import {
  PROJECTS_UPDATED_EVENT,
  getActiveCaseTitle,
  mapFlowUnitTypeToChemProTab,
} from '@/lib/caseManagerBridge';
import {
  FlowEdgeDef,
  FlowNodeDef,
  FlowUnitType,
  SolvedStream,
  SolvedUnitResult,
  createIdleFlowsheetResult,
} from '@/lib/calculations/flowsheetSolver';
import {
  ChemProSimHandoffPayload,
  ChemProTargetTab,
  buildChemProHandoffPayload,
  saveChemProHandoffPayload,
} from '@/lib/calculations/unitDesignHandoff';
import {
  COST_MATERIAL_FACTORS,
  CostMaterialKey,
  DEFAULT_CEPCI,
  DEFAULT_FX_KRW_PER_USD,
  EquipmentCostResult,
  costColumnVessel,
  costCompressor,
  costControlValve,
  costHeatExchanger,
  costProcessVessel,
  costPump,
  formatKrwReadable,
} from '@/lib/calculations/equipmentCostModel';
import type { SheetRuntimeData } from '@/lib/calculations/fullPlantHierarchy';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const BUILDER_SAVE_KEY = 'chemplant-newplant-builder-v1';
const CLASSIC_SAVE_KEY = 'chemplant-classic-sim-auto-v1';
const DELIVERABLES_KEY_PREFIX = 'chemplant-case-deliverables-v1';

const EXCLUDED_UNIT_TYPES = new Set<FlowUnitType>(['feed', 'product', 'mixer', 'splitter']);

const MATERIAL_OPTIONS: Array<{ key: CostMaterialKey; shortLabel: string }> = [
  { key: 'CS', shortLabel: 'CS (탄소강)' },
  { key: 'SS304', shortLabel: 'SS304' },
  { key: 'SS316L', shortLabel: 'SS316L' },
  { key: 'DUPLEX_2205', shortLabel: 'Duplex 2205' },
  { key: 'TI_GR2', shortLabel: 'Ti Gr.2 (티타늄)' },
  { key: 'HASTELLOY_C276', shortLabel: 'Hastelloy C-276' },
  { key: 'PTFE_LINED', shortLabel: 'PTFE-Lined CS' },
];

export interface UnitDeliverableOverride {
  material: CostMaterialKey;
  datasheetSaved?: boolean;
  datasheetSavedAt?: string;
  datasheetSummary?: string;
  customAreaM2?: number;
  customPowerKw?: number;
  customVolumeM3?: number;
}

interface CaseDeliverablesPersist {
  cepci: number;
  fxKrwPerUsd: number;
  contingencyFactor: number;
  unitOverrides: Record<string, UnitDeliverableOverride>;
}

interface LoadedCaseSheet {
  sheetId: string;
  sheetLabel: string;
  simDefs: FlowNodeDef[];
  flowEdges: FlowEdgeDef[];
  solved: ReturnType<typeof createIdleFlowsheetResult>;
}

interface EquipmentRowModel {
  key: string;
  def: FlowNodeDef;
  sheetLabel: string;
  flowEdges: FlowEdgeDef[];
  streams: SolvedStream[];
  uRes?: SolvedUnitResult;
  unitTypeLabel: string;
  sizingKind: 'area' | 'power' | 'volume';
  autoSizingValue: number;
  effectiveSizingValue: number;
  sizingUnit: string;
  inletTempC: number | null;
  outletTempC: number | null;
  operPressKgcm2g: number | null;
  designPressBarG: number;
  massFlowKgH: number;
  volFlowM3H: number;
  heatDutyMcalH: number;
  shaftPowerKw: number;
  stages: number | null;
  detectedFluid: string;
  conditionSummary: string;
  material: CostMaterialKey;
  override: UnitDeliverableOverride;
  cost: EquipmentCostResult;
  chemproTab: ChemProTargetTab;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function getUnitTypeKoLabel(unitType: FlowUnitType): string {
  switch (unitType) {
    case 'hex':
    case 'cooler':
      return '열교환기 (HX)';
    case 'liquefier':
      return '액화기 / 응축기';
    case 'evaporator':
      return '증발관 (Evaporator)';
    case 'pump':
      return '펌프 (Pump)';
    case 'compressor':
      return '압축기 (Compressor)';
    case 'distillation':
      return '증류탑 (Column)';
    case 'absorber':
      return '흡수/세정탑 (Absorber)';
    case 'extractor':
      return '추출탑 (Extractor)';
    case 'desiccant_dryer':
      return '흡착 제습탑 (Dryer)';
    case 'chelate_tower':
      return '킬레이트 수지탑';
    case 'separator':
      return '기액분리기 (Separator)';
    case 'reactor':
      return '반응기 (Reactor)';
    case 'saturator':
      return '포화/침전조';
    case 'electrolyzer':
      return '전해조 (Electrolyzer)';
    case 'valve':
    case 'valve_visual':
      return '제어/감압 밸브';
    case 'h_drum_visual':
      return '수평 드럼';
    case 'tank_visual':
      return '저장 탱크';
    case 'filter_visual':
      return '여과기 (Filter)';
    case 'silo_visual':
      return '사일로 (Silo)';
    default:
      return unitType;
  }
}

function inferDefaultMaterial(def: FlowNodeDef, detectedFluid: string): CostMaterialKey {
  const txt = `${def.name} ${def.tag} ${detectedFluid}`.toLowerCase();
  if (txt.includes('cl2') || txt.includes('염소') || txt.includes('습염소')) {
    return 'TI_GR2';
  }
  if (
    txt.includes('hcl') ||
    txt.includes('염산') ||
    txt.includes('h2so4') ||
    txt.includes('황산') ||
    txt.includes('hf') ||
    txt.includes('phosgene') ||
    txt.includes('포스겐')
  ) {
    return 'HASTELLOY_C276';
  }
  if (
    txt.includes('naoh') ||
    txt.includes('가성') ||
    txt.includes('브라인') ||
    txt.includes('nacl') ||
    txt.includes('acid') ||
    def.unitType === 'reactor' ||
    def.unitType === 'distillation' ||
    def.unitType === 'absorber' ||
    def.unitType === 'extractor'
  ) {
    return 'SS316L';
  }
  if (def.unitType === 'pump' || def.unitType === 'hex' || def.unitType === 'cooler') {
    return 'SS304';
  }
  return 'CS';
}

function formatUsdCompact(usd: number): string {
  if (Math.abs(usd) >= 1e6) {
    return `$${(usd / 1e6).toFixed(2)}M`;
  }
  return `$${Math.round(usd).toLocaleString()}`;
}

function buildFallbackHandoffPayload(
  row: EquipmentRowModel,
  plantId: string,
  caseTitle: string
): ChemProSimHandoffPayload {
  const tab = row.chemproTab;
  const tOp = row.inletTempC ?? row.outletTempC ?? 40;
  const tOut = row.outletTempC ?? (tOp > 50 ? tOp - 20 : tOp + 20);
  const pBarG = Math.max(0.2, (row.operPressKgcm2g ?? 2.0) * 0.980665);
  const massKgH = Math.max(100, row.massFlowKgH || 1000);
  const volM3H = Math.max(1, row.volFlowM3H || massKgH / 1000);

  const base: ChemProSimHandoffPayload = {
    version: 1,
    timestamp: Date.now(),
    plantId,
    sourceLabel: caseTitle || '현재 시뮬레이션 케이스',
    tab,
    equipTag: row.def.tag || row.def.id,
    equipName: row.def.name || row.def.tag,
    detectedFluidSummary: row.detectedFluid || '공정 유체',
  };

  if (tab === 'hx') {
    return {
      ...base,
      hx: {
        hx_type: 'shell_tube',
        hotFluidId: 'water',
        coldFluidId: 'water',
        allocation: 'hot_tube',
        dofTarget: 'mc_auto',
        mh_kgh: Math.round(massKgH),
        Th_in: Number(Math.max(tOp, tOut).toFixed(1)),
        Th_out: Number(Math.min(tOp, tOut).toFixed(1)),
        mc_kgh: Math.round(massKgH * 1.5),
        Tc_in: 28,
        Tc_out: 36,
        hot_mode: 'sensible',
        cold_mode: 'sensible',
        U_assumed: 450,
      },
    };
  }
  if (tab === 'pump') {
    return {
      ...base,
      pump: {
        fluidId: 'water',
        T_C: Number(tOp.toFixed(1)),
        Q_m3h: Number(volM3H.toFixed(1)),
        rho_kgm3: 1000,
        P1_barG: Number(Math.max(0, pBarG * 0.3).toFixed(2)),
        P2_barG: Number(Math.max(1.5, pBarG).toFixed(2)),
        eff_pct: 72,
        dsuc_mm: '100',
        ddis_mm: '80',
      },
    };
  }
  if (tab === 'column') {
    return {
      ...base,
      column: {
        col_mode: row.def.unitType === 'distillation' ? 'distillation' : 'absorption',
        abs_service: 'scrubbing',
        internals: row.def.unitType === 'distillation' ? 'tray' : 'packed',
        pack_key: 'mellapak_250y',
        lkFluidId: 'water',
        hkFluidId: 'water',
        P_col_barA: Number((pBarG + 1.013).toFixed(2)),
        gas_kgh: Math.round(massKgH * 0.5),
        liq_kgh: Math.round(massKgH * 0.5),
        T_gas_in: Number(tOp.toFixed(1)),
        T_liq_in: Number(tOut.toFixed(1)),
        y_in_ppm: 5000,
        y_out_ppm: 50,
      },
    };
  }
  if (tab === 'psv') {
    return {
      ...base,
      psv: {
        fluidId: 'water',
        scenario: 'blocked_outlet',
        phase: 'liquid',
        W_kgh: Math.round(massKgH),
        Pset_barG: Number(Math.max(1.5, row.designPressBarG).toFixed(2)),
        Pback_barG: 0.2,
        T_C: Number(tOp.toFixed(1)),
      },
    };
  }
  return {
    ...base,
    vessel: {
      orientation: row.def.unitType === 'h_drum_visual' ? 'horizontal' : 'vertical',
      gasFluidId: 'nitrogen_gas',
      liqFluidId: 'water',
      Wg_kgh: Math.round(massKgH * 0.2),
      Wl_kgh: Math.round(massKgH * 0.8),
      rhoG: 2.5,
      rhoL: 980,
      P_op_barG: Number(pBarG.toFixed(2)),
      P_des_barG: Number(row.designPressBarG.toFixed(2)),
      mat_key: row.material === 'CS' ? 'sa516_70' : 'ss316l',
    },
  };
}

function loadActiveCaseSheets(plantId: string): LoadedCaseSheet[] {
  if (typeof window === 'undefined') return [];
  const storageKey = plantId === 'classic_sim' ? CLASSIC_SAVE_KEY : BUILDER_SAVE_KEY;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];

    if (parsed.hierarchySheets && Object.keys(parsed.hierarchySheets).length > 0) {
      const sheetsObj = parsed.hierarchySheets as Record<string, SheetRuntimeData>;
      const actId = parsed.activeSheetId || 'master';
      const list: LoadedCaseSheet[] = [];
      for (const sh of Object.values(sheetsObj)) {
        const simDefs = Array.isArray(sh.simDefs) ? sh.simDefs : [];
        const flowEdges = Array.isArray(sh.flowEdges) ? sh.flowEdges : [];
        if (simDefs.length === 0) continue;
        let solved = sh.cachedSolvedMeta?.result;
        if (!solved && sh.id === actId && parsed.lastSolvedMeta?.result) {
          solved = parsed.lastSolvedMeta.result;
        }
        if (!solved || !Array.isArray(solved.streams) || !Array.isArray(solved.units)) {
          solved = createIdleFlowsheetResult(simDefs, flowEdges);
        }
        list.push({
          sheetId: sh.id,
          sheetLabel: sh.shortTabLabel || sh.title || sh.id,
          simDefs,
          flowEdges,
          solved,
        });
      }
      return list;
    }

    const simDefs: FlowNodeDef[] = Array.isArray(parsed.simDefs) ? parsed.simDefs : [];
    const flowEdges: FlowEdgeDef[] = Array.isArray(parsed.flowEdges) ? parsed.flowEdges : [];
    if (simDefs.length === 0) return [];
    const solved =
      parsed.lastSolvedMeta?.result &&
      Array.isArray(parsed.lastSolvedMeta.result.streams) &&
      Array.isArray(parsed.lastSolvedMeta.result.units)
        ? parsed.lastSolvedMeta.result
        : createIdleFlowsheetResult(simDefs, flowEdges);
    return [
      {
        sheetId: 'main',
        sheetLabel: plantId === 'classic_sim' ? '클래식 플로우시트' : '공정 플로우시트',
        simDefs,
        flowEdges,
        solved,
      },
    ];
  } catch {
    return [];
  }
}

function readDeliverablesState(persistKey: string): CaseDeliverablesPersist {
  const defaults: CaseDeliverablesPersist = {
    cepci: DEFAULT_CEPCI,
    fxKrwPerUsd: DEFAULT_FX_KRW_PER_USD,
    contingencyFactor: 1.18,
    unitOverrides: {},
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(persistKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<CaseDeliverablesPersist>;
    return {
      cepci: Number.isFinite(parsed.cepci) ? Number(parsed.cepci) : DEFAULT_CEPCI,
      fxKrwPerUsd: Number.isFinite(parsed.fxKrwPerUsd)
        ? Number(parsed.fxKrwPerUsd)
        : DEFAULT_FX_KRW_PER_USD,
      contingencyFactor: Number.isFinite(parsed.contingencyFactor)
        ? Number(parsed.contingencyFactor)
        : 1.18,
      unitOverrides:
        parsed.unitOverrides && typeof parsed.unitOverrides === 'object'
          ? parsed.unitOverrides
          : {},
    };
  } catch {
    return defaults;
  }
}

export default function CaseEquipmentDeliverables() {
  const router = useRouter();
  const { activePlantId } = useBalanceStore();
  const units = useUnitStore(s => s.units);
  const hydrateUnits = useUnitStore(s => s.hydrate);

  const [caseTitle, setCaseTitle] = useState<string>('');
  const [loadedSheets, setLoadedSheets] = useState<LoadedCaseSheet[]>([]);
  const [persistState, setPersistState] = useState<CaseDeliverablesPersist>({
    cepci: DEFAULT_CEPCI,
    fxKrwPerUsd: DEFAULT_FX_KRW_PER_USD,
    contingencyFactor: 1.18,
    unitOverrides: {},
  });
  const [hydratedKey, setHydratedKey] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Inline Datasheet Generator Modal state
  const [modalRowKey, setModalRowKey] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<ChemProTargetTab>('hx');
  const [modalTs, setModalTs] = useState<number>(0);
  const [modalSizingInput, setModalSizingInput] = useState<string>('');
  const [modalSummaryInput, setModalSummaryInput] = useState<string>('');
  const modalIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    hydrateUnits();
  }, [hydrateUnits]);

  const refreshCaseData = useCallback(() => {
    const activeInfo = getActiveCaseTitle();
    const resolvedTitle =
      activeInfo && activeInfo.plantId === activePlantId ? activeInfo.title.trim() : '';
    setCaseTitle(resolvedTitle);
    setLoadedSheets(loadActiveCaseSheets(activePlantId));
  }, [activePlantId]);

  useEffect(() => {
    refreshCaseData();
    const onUpdated = () => refreshCaseData();
    window.addEventListener(PROJECTS_UPDATED_EVENT, onUpdated);
    window.addEventListener('storage', onUpdated);
    window.addEventListener('focus', onUpdated);
    return () => {
      window.removeEventListener(PROJECTS_UPDATED_EVENT, onUpdated);
      window.removeEventListener('storage', onUpdated);
      window.removeEventListener('focus', onUpdated);
    };
  }, [refreshCaseData]);

  const persistKey = useMemo(
    () => `${DELIVERABLES_KEY_PREFIX}::${activePlantId}::${caseTitle || 'default'}`,
    [activePlantId, caseTitle]
  );

  // Load case-scoped persistence whenever activePlantId or caseTitle changes
  useEffect(() => {
    const loaded = readDeliverablesState(persistKey);
    setPersistState(loaded);
    setHydratedKey(persistKey);
  }, [persistKey]);

  const savePersistState = useCallback(
    (updater: (prev: CaseDeliverablesPersist) => CaseDeliverablesPersist) => {
      setPersistState(prev => {
        const next = updater(prev);
        if (typeof window !== 'undefined' && hydratedKey === persistKey) {
          try {
            window.localStorage.setItem(persistKey, JSON.stringify(next));
          } catch {
            // ignore quota errors
          }
        }
        return next;
      });
    },
    [hydratedKey, persistKey]
  );

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg(prev => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Build equipment list + automatic sizing + CAPEX estimation
  const equipmentRows = useMemo<EquipmentRowModel[]>(() => {
    const rows: EquipmentRowModel[] = [];
    const seenKeys = new Set<string>();
    const { cepci, fxKrwPerUsd, contingencyFactor, unitOverrides } = persistState;

    for (const sheet of loadedSheets) {
      const unitMap = new Map<string, SolvedUnitResult>(
        sheet.solved.units.map(u => [u.nodeId, u])
      );
      const streamByEdgeId = new Map<string, SolvedStream>(
        sheet.solved.streams.map(s => [s.edgeId, s])
      );

      for (const def of sheet.simDefs) {
        if (EXCLUDED_UNIT_TYPES.has(def.unitType)) continue;
        const rowKey = def.id || def.tag;
        if (!rowKey || seenKeys.has(rowKey)) continue;
        seenKeys.add(rowKey);

        const uRes = unitMap.get(def.id);
        const inEdges = sheet.flowEdges.filter(e => e.target === def.id);
        const outEdges = sheet.flowEdges.filter(e => e.source === def.id);
        const inStreams = inEdges
          .map(e => streamByEdgeId.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        const outStreams = outEdges
          .map(e => streamByEdgeId.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));

        const primaryIn = inStreams[0];
        const primaryOut = outStreams[0];

        const inletTempC =
          primaryIn && Number.isFinite(primaryIn.tempC) ? primaryIn.tempC : null;
        const outletTempC =
          primaryOut && Number.isFinite(primaryOut.tempC)
            ? primaryOut.tempC
            : Number.isFinite(def.params?.operTempC)
              ? Number(def.params.operTempC)
              : null;

        const maxPressKgcm2g = Math.max(
          ...inStreams.map(s => s.pressKgcm2g),
          ...outStreams.map(s => s.pressKgcm2g),
          Number.isFinite(def.params?.operPressKgcm2g) ? Number(def.params.operPressKgcm2g) : -99,
          Number.isFinite(def.params?.outletPressKgcm2g)
            ? Number(def.params.outletPressKgcm2g)
            : -99,
          0
        );
        const operPressKgcm2g =
          inStreams.length > 0 || outStreams.length > 0
            ? maxPressKgcm2g
            : Number.isFinite(def.params?.operPressKgcm2g)
              ? Number(def.params.operPressKgcm2g)
              : null;
        const designPressBarG = Math.max(
          3.5,
          Number(((operPressKgcm2g ?? 2.0) * 0.980665 * 1.2).toFixed(2))
        );

        const sumInMass = inStreams.reduce((acc, s) => acc + Math.max(0, s.totalMassKgH || 0), 0);
        const sumOutMass = outStreams.reduce((acc, s) => acc + Math.max(0, s.totalMassKgH || 0), 0);
        const massFlowKgH = Math.max(uRes?.inletMassKgH || 0, sumInMass, sumOutMass);

        const sumInVol = inStreams.reduce((acc, s) => acc + Math.max(0, s.volFlowM3H || 0), 0);
        const sumOutVol = outStreams.reduce((acc, s) => acc + Math.max(0, s.volFlowM3H || 0), 0);
        const volFlowM3H = sumInVol > 0 ? sumInVol : sumOutVol > 0 ? sumOutVol : massFlowKgH / 1000;

        const heatDutyKcalH = uRes?.heatDutyKcalH ?? 0;
        const heatDutyMcalH = heatDutyKcalH / 1000;
        const shaftPowerKw = Math.max(0, uRes?.shaftPowerKW ?? 0);

        const stages =
          uRes?.distillResult?.totalStagesUsed ??
          def.params?.distillConfig?.totalStages ??
          def.params?.columnStages ??
          def.params?.extractorStages ??
          null;

        const detectedFluid =
          uRes?.detectedFluidLabel ||
          primaryIn?.keyConcLabel ||
          primaryOut?.keyConcLabel ||
          '공정 유체';

        const defaultMat = inferDefaultMaterial(def, detectedFluid);
        const existingOverride = unitOverrides[rowKey];
        const material: CostMaterialKey = existingOverride?.material ?? defaultMat;
        const override: UnitDeliverableOverride = existingOverride ?? { material };

        // Sizing & Cost calculation
        let sizingKind: 'area' | 'power' | 'volume' = 'volume';
        let autoSizingValue = 5;
        let effectiveSizingValue = 5;
        let sizingUnit = 'm³';
        let cost: EquipmentCostResult;

        if (
          def.unitType === 'hex' ||
          def.unitType === 'cooler' ||
          def.unitType === 'liquefier' ||
          def.unitType === 'evaporator'
        ) {
          sizingKind = 'area';
          sizingUnit = 'm²';
          const qWatt = Math.abs(heatDutyKcalH) * 1.163;
          autoSizingValue = qWatt > 0 ? Math.max(2, qWatt / (450 * 20)) : 10;
          effectiveSizingValue =
            override.customAreaM2 && override.customAreaM2 > 0
              ? override.customAreaM2
              : autoSizingValue;
          cost = costHeatExchanger({
            areaM2: effectiveSizingValue,
            hxType: def.unitType === 'evaporator' ? 'kettle_reboiler' : 'fixed_tube',
            designPressBarG,
            shellMaterial: material,
            tubeMaterial: material,
            cepci,
            fxKrwPerUsd,
            contingencyFeeFactor: contingencyFactor,
          });
        } else if (def.unitType === 'pump') {
          sizingKind = 'power';
          sizingUnit = 'kW';
          const rho = primaryIn?.densityKgM3 && primaryIn.densityKgM3 > 100 ? primaryIn.densityKgM3 : 1000;
          const qM3H = Math.max(0.5, volFlowM3H || massFlowKgH / rho || 10);
          const pIn = primaryIn?.pressKgcm2g ?? 0.2;
          const pOut = primaryOut?.pressKgcm2g ?? def.params?.outletPressKgcm2g ?? pIn + 3.0;
          const dPBar = Math.max(1.0, (pOut - pIn) * 0.980665);
          const headM = Math.max(10, (dPBar * 1e5) / (rho * 9.80665));
          const estPower = (rho * 9.80665 * (qM3H / 3600) * headM) / (1000 * 0.72);
          autoSizingValue = Math.max(0.75, shaftPowerKw > 0.05 ? shaftPowerKw : estPower);
          effectiveSizingValue =
            override.customPowerKw && override.customPowerKw > 0
              ? override.customPowerKw
              : autoSizingValue;
          cost = costPump({
            shaftPowerKw: effectiveSizingValue,
            flowM3H: qM3H,
            headM,
            densityKgM3: rho,
            dischargePressBarG: Math.max(1.5, pOut * 0.980665),
            material,
            cepci,
            fxKrwPerUsd,
            contingencyFeeFactor: contingencyFactor,
          });
        } else if (def.unitType === 'compressor') {
          sizingKind = 'power';
          sizingUnit = 'kW';
          autoSizingValue = Math.max(
            5,
            shaftPowerKw > 0.1 ? shaftPowerKw : Math.max(10, volFlowM3H * 0.08)
          );
          effectiveSizingValue =
            override.customPowerKw && override.customPowerKw > 0
              ? override.customPowerKw
              : autoSizingValue;
          cost = costCompressor({
            shaftPowerKw: effectiveSizingValue,
            material,
            includeElectricDrive: true,
            cepci,
            fxKrwPerUsd,
            contingencyFeeFactor: contingencyFactor,
          });
        } else if (
          def.unitType === 'distillation' ||
          def.unitType === 'absorber' ||
          def.unitType === 'extractor' ||
          def.unitType === 'desiccant_dryer' ||
          def.unitType === 'chelate_tower'
        ) {
          sizingKind = 'volume';
          sizingUnit = 'm³';
          const nStages = Math.max(
            4,
            stages ?? (def.unitType === 'distillation' ? 20 : def.unitType === 'absorber' ? 12 : 8)
          );
          const vaporVolM3H = [...inStreams, ...outStreams]
            .filter(s => s.phase === 'G' || s.vaporFraction > 0.3)
            .reduce((mx, s) => Math.max(mx, s.volFlowM3H || 0), 0);
          const liqVolM3H = [...inStreams, ...outStreams]
            .filter(s => s.phase === 'L')
            .reduce((mx, s) => Math.max(mx, s.volFlowM3H || 0), 0);
          const areaCross =
            vaporVolM3H > 0
              ? vaporVolM3H / 3600 / 0.85
              : liqVolM3H > 0
                ? liqVolM3H / 3600 / 0.015
                : 0.6;
          let innerDiamM =
            uRes?.distillResult?.estimatedDiameterM && uRes.distillResult.estimatedDiameterM > 0.2
              ? clamp(uRes.distillResult.estimatedDiameterM, 0.4, 8.0)
              : clamp(Math.sqrt((4 * Math.max(0.15, areaCross)) / Math.PI), 0.5, 5.5);
          let tangentHeightM = clamp(nStages * 0.6 + 3.5, 4.5, 45.0);
          autoSizingValue = Math.max(1.5, ((Math.PI * innerDiamM * innerDiamM) / 4) * tangentHeightM);
          effectiveSizingValue =
            override.customVolumeM3 && override.customVolumeM3 > 0
              ? override.customVolumeM3
              : autoSizingValue;

          if (override.customVolumeM3 && override.customVolumeM3 > 0) {
            const ratio = Math.cbrt(override.customVolumeM3 / Math.max(0.5, autoSizingValue));
            innerDiamM = clamp(innerDiamM * ratio, 0.4, 8.0);
            tangentHeightM = clamp(tangentHeightM * ratio, 2.5, 70.0);
          }

          const colCost = costColumnVessel({
            innerDiamM,
            tangentHeightM,
            designPressBarG,
            shellMaterial: material,
            internalsMaterial: material,
            internalsKind: def.unitType === 'distillation' ? 'tray' : 'packed',
            trayCount: nStages,
            cepci,
            fxKrwPerUsd,
            contingencyFeeFactor: contingencyFactor,
          });
          cost = {
            equipmentType: getUnitTypeKoLabel(def.unitType),
            materialLabel: COST_MATERIAL_FACTORS[material]?.label ?? material,
            cepciUsed: colCost.cepciUsed,
            fxKrwPerUsd: colCost.fxKrwPerUsd,
            baseCp0Usd: colCost.baseVesselCp0Usd,
            purchasedUsd: colCost.totalPurchaseUsd,
            bareModuleUsd: colCost.bareModuleUsd,
            totalModuleUsd: colCost.totalModuleUsd,
            purchasedKrw: colCost.totalPurchaseKrw,
            bareModuleKrw: colCost.bareModuleKrw,
            totalModuleKrw: colCost.totalModuleKrw,
            bareModuleEokKrw: colCost.bareModuleEokKrw,
            totalModuleEokKrw: colCost.totalModuleEokKrw,
            factors: {
              fm: colCost.factors.fmVessel,
              fp: colCost.factors.fpVessel,
              fbm: colCost.factors.fbmVessel,
              contingencyFeeFactor: colCost.factors.contingencyFeeFactor,
            },
            basisSummary: `Ø${innerDiamM.toFixed(2)}m × H${tangentHeightM.toFixed(1)}m (${nStages}단)`,
          };
        } else if (def.unitType === 'valve' || def.unitType === 'valve_visual') {
          sizingKind = 'volume';
          sizingUnit = 'm³/h';
          autoSizingValue = Math.max(1, volFlowM3H || 10);
          effectiveSizingValue =
            override.customVolumeM3 && override.customVolumeM3 > 0
              ? override.customVolumeM3
              : autoSizingValue;
          cost = costControlValve({
            flowM3H: effectiveSizingValue,
            designPressBarG,
            material,
            cepci,
            fxKrwPerUsd,
            contingencyFeeFactor: contingencyFactor,
          });
        } else {
          sizingKind = 'volume';
          sizingUnit = 'm³';
          const isReactor = def.unitType === 'reactor' || def.unitType === 'electrolyzer';
          const hasAgitator = isReactor && def.params?.reactorModel === 'cstr';
          const resHr = isReactor
            ? 0.5
            : def.unitType === 'tank_visual' || def.unitType === 'silo_visual'
              ? 2.0
              : 0.15;
          const liqVol = inStreams
            .filter(s => s.phase === 'L')
            .reduce((acc, s) => acc + Math.max(0, s.volFlowM3H || 0), 0);
          const baseVol = liqVol > 0 ? liqVol : volFlowM3H > 0 ? volFlowM3H : massFlowKgH / 1000;
          autoSizingValue =
            def.params?.reactorVolumeM3 && def.params.reactorVolumeM3 > 0
              ? def.params.reactorVolumeM3
              : Math.max(1.5, baseVol * resHr);
          effectiveSizingValue =
            override.customVolumeM3 && override.customVolumeM3 > 0
              ? override.customVolumeM3
              : autoSizingValue;
          cost = costProcessVessel({
            volumeM3: effectiveSizingValue,
            orientation: def.unitType === 'h_drum_visual' ? 'horizontal' : 'vertical',
            isReactor,
            hasAgitator,
            designPressBarG,
            material,
            cepci,
            fxKrwPerUsd,
            contingencyFeeFactor: contingencyFactor,
          });
        }

        const condParts: string[] = [];
        if (inletTempC !== null && outletTempC !== null && Math.abs(inletTempC - outletTempC) > 0.2) {
          condParts.push(`${inletTempC.toFixed(1)}→${outletTempC.toFixed(1)}°C`);
        } else if (inletTempC !== null) {
          condParts.push(`${inletTempC.toFixed(1)}°C`);
        } else if (outletTempC !== null) {
          condParts.push(`${outletTempC.toFixed(1)}°C`);
        }
        if (operPressKgcm2g !== null) {
          condParts.push(`${operPressKgcm2g.toFixed(1)} kG`);
        }
        if (massFlowKgH > 0) {
          condParts.push(`${Math.round(massFlowKgH).toLocaleString()} kg/h`);
        }
        if (Math.abs(heatDutyMcalH) > 0.05) {
          condParts.push(`Q=${heatDutyMcalH.toFixed(1)} Mcal/h`);
        }
        if (shaftPowerKw > 0.05) {
          condParts.push(`W=${shaftPowerKw.toFixed(1)} kW`);
        }
        if (stages) {
          condParts.push(`${stages}단`);
        }

        rows.push({
          key: rowKey,
          def,
          sheetLabel: sheet.sheetLabel,
          flowEdges: sheet.flowEdges,
          streams: sheet.solved.streams,
          uRes,
          unitTypeLabel: getUnitTypeKoLabel(def.unitType),
          sizingKind,
          autoSizingValue,
          effectiveSizingValue,
          sizingUnit,
          inletTempC,
          outletTempC,
          operPressKgcm2g,
          designPressBarG,
          massFlowKgH,
          volFlowM3H,
          heatDutyMcalH,
          shaftPowerKw,
          stages,
          detectedFluid,
          conditionSummary: condParts.length > 0 ? condParts.join(' · ') : '시뮬레이션 미실행 (기본 추정)',
          material,
          override,
          cost,
          chemproTab: mapFlowUnitTypeToChemProTab(def.unitType),
        });
      }
    }

    return rows;
  }, [loadedSheets, persistState]);

  const totals = useMemo(() => {
    let cpUsd = 0;
    let cbmUsd = 0;
    let ctmUsd = 0;
    let cpKrw = 0;
    let cbmKrw = 0;
    let ctmKrw = 0;
    let datasheetsDone = 0;
    for (const r of equipmentRows) {
      cpUsd += r.cost.purchasedUsd;
      cbmUsd += r.cost.bareModuleUsd;
      ctmUsd += r.cost.totalModuleUsd;
      cpKrw += r.cost.purchasedKrw;
      cbmKrw += r.cost.bareModuleKrw;
      ctmKrw += r.cost.totalModuleKrw;
      if (r.override.datasheetSaved) datasheetsDone += 1;
    }
    return {
      count: equipmentRows.length,
      datasheetsDone,
      cpUsd,
      cbmUsd,
      ctmUsd,
      cpKrw,
      cbmKrw,
      ctmKrw,
    };
  }, [equipmentRows]);

  const activeModalRow = useMemo(
    () => (modalRowKey ? equipmentRows.find(r => r.key === modalRowKey) ?? null : null),
    [equipmentRows, modalRowKey]
  );

  // Sync messages to inline datasheet modal iframe
  const postModalSync = useCallback(() => {
    const win = modalIframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'CHEMPRO_SET_PLANT',
        plantId: activePlantId,
        allowedPlants: [],
        skipPresetLoad: true,
      },
      '*'
    );
    win.postMessage({ type: 'CHEMPRO_APPLY_SIM_HANDOFF' }, '*');
    win.postMessage({ type: 'CHEMENG_UNITS_SYNC', units }, '*');
  }, [activePlantId, units]);

  useEffect(() => {
    if (!modalRowKey) return;
    const onMessage = (e: MessageEvent) => {
      const d = e?.data;
      if (d && typeof d === 'object' && d.type === 'CHEMPRO_READY') {
        postModalSync();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [modalRowKey, postModalSync]);

  const handleMaterialChange = (rowKey: string, material: CostMaterialKey) => {
    savePersistState(prev => ({
      ...prev,
      unitOverrides: {
        ...prev.unitOverrides,
        [rowKey]: {
          ...prev.unitOverrides[rowKey],
          material,
        },
      },
    }));
  };

  const handleOpenDatasheetModal = (row: EquipmentRowModel) => {
    const srcLabel = caseTitle || (activePlantId === 'classic_sim' ? '클래식 시뮬레이터 케이스' : '현재 시뮬레이션 케이스');
    const built = buildChemProHandoffPayload(
      row.def,
      row.flowEdges,
      row.streams,
      row.uRes,
      srcLabel
    );
    const payload: ChemProSimHandoffPayload = built
      ? { ...built, plantId: activePlantId }
      : buildFallbackHandoffPayload(row, activePlantId, srcLabel);

    saveChemProHandoffPayload(payload);

    const existingVal =
      row.sizingKind === 'area'
        ? row.override.customAreaM2
        : row.sizingKind === 'power'
          ? row.override.customPowerKw
          : row.override.customVolumeM3;

    setModalTab(payload.tab || row.chemproTab);
    setModalTs(Date.now());
    setModalSizingInput(existingVal && existingVal > 0 ? String(existingVal) : '');
    setModalSummaryInput(row.override.datasheetSummary || '');
    setModalRowKey(row.key);
  };

  const handleSaveDatasheetToCase = () => {
    if (!activeModalRow) return;
    const parsedSize = Number(modalSizingInput);
    const validSize = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : undefined;
    const summaryText =
      modalSummaryInput.trim() ||
      `${activeModalRow.unitTypeLabel} · ${activeModalRow.material} · ${
        validSize
          ? `${validSize.toFixed(1)} ${activeModalRow.sizingUnit}`
          : activeModalRow.cost.basisSummary
      }`;

    savePersistState(prev => {
      const cur = prev.unitOverrides[activeModalRow.key] ?? { material: activeModalRow.material };
      const updated: UnitDeliverableOverride = {
        ...cur,
        material: activeModalRow.material,
        datasheetSaved: true,
        datasheetSavedAt: new Date().toISOString(),
        datasheetSummary: summaryText,
      };
      if (activeModalRow.sizingKind === 'area') {
        updated.customAreaM2 = validSize;
      } else if (activeModalRow.sizingKind === 'power') {
        updated.customPowerKw = validSize;
      } else {
        updated.customVolumeM3 = validSize;
      }
      return {
        ...prev,
        unitOverrides: {
          ...prev.unitOverrides,
          [activeModalRow.key]: updated,
        },
      };
    });

    showToast(`[${activeModalRow.def.tag}] 데이터시트가 현재 케이스에 저장되고 투자비에 반영되었습니다.`);
    setModalRowKey(null);
  };

  const handleExportExcel = () => {
    if (equipmentRows.length === 0) return;

    const sheet1Rows = equipmentRows.map((r, idx) => ({
      No: idx + 1,
      Tag: r.def.tag,
      장치명: r.def.name,
      유형: r.unitTypeLabel,
      '유체 / 서비스': r.detectedFluid,
      '운전조건 (시뮬레이션)': r.conditionSummary,
      '설계압력 (barG)': Number(r.designPressBarG.toFixed(2)),
      '사이징 근거': r.cost.basisSummary,
      '재질 (F_M)': `${r.material} (FM=${r.cost.factors.fm})`,
      '데이터시트 상태': r.override.datasheetSaved ? '저장됨' : '미작성',
      '데이터시트 요약': r.override.datasheetSummary || '-',
      '구매원가 Cp (USD)': r.cost.purchasedUsd,
      '설치투자비 C_BM (USD)': r.cost.bareModuleUsd,
      '총 투자비 C_TM (USD)': r.cost.totalModuleUsd,
      '구매원가 Cp (KRW)': r.cost.purchasedKrw,
      '설치투자비 C_BM (KRW)': r.cost.bareModuleKrw,
      '총 투자비 C_TM (KRW)': r.cost.totalModuleKrw,
    }));

    sheet1Rows.push({
      No: equipmentRows.length + 1,
      Tag: 'TOTAL',
      장치명: `총 ${equipmentRows.length}기 장치 합계`,
      유형: '-',
      '유체 / 서비스': '-',
      '운전조건 (시뮬레이션)': `데이터시트 완료 ${totals.datasheetsDone}/${totals.count}`,
      '설계압력 (barG)': 0,
      '사이징 근거': `CEPCI=${persistState.cepci}, FX=${persistState.fxKrwPerUsd}`,
      '재질 (F_M)': '-',
      '데이터시트 상태': `${totals.datasheetsDone}/${totals.count}`,
      '데이터시트 요약': formatKrwReadable(totals.ctmKrw),
      '구매원가 Cp (USD)': totals.cpUsd,
      '설치투자비 C_BM (USD)': totals.cbmUsd,
      '총 투자비 C_TM (USD)': totals.ctmUsd,
      '구매원가 Cp (KRW)': totals.cpKrw,
      '설치투자비 C_BM (KRW)': totals.cbmKrw,
      '총 투자비 C_TM (KRW)': totals.ctmKrw,
    });

    const basisRows = [
      { 항목: '케이스명', 값: caseTitle || '현재 작업 케이스', 비고: '이 케이스 전용 산출물' },
      {
        항목: '시뮬레이터 모드',
        값: activePlantId === 'classic_sim' ? '클래식 공정 시뮬레이터' : '신규 공정 시뮬레이터',
        비고: activePlantId,
      },
      { 항목: '산출 일시', 값: new Date().toLocaleString('ko-KR'), 비고: '' },
      { 항목: 'CEPCI 지수', 값: persistState.cepci, 비고: 'Turton 기준 397 / Towler 기준 532 환산' },
      { 항목: '환율 (KRW/USD)', 값: persistState.fxKrwPerUsd, 비고: '사용자 설정 환율' },
      {
        항목: '총 모듈 계수 (C_TM / C_BM)',
        값: persistState.contingencyFactor,
        비고: '예비비 15% + 엔지니어링 수수료 3% (Turton 기본 1.18)',
      },
      { 항목: '총 장치 수', 값: `${totals.count} 기`, 비고: `데이터시트 완료 ${totals.datasheetsDone} 기` },
      {
        항목: '총 구매원가 (Cp)',
        값: `${formatUsdCompact(totals.cpUsd)} (${formatKrwReadable(totals.cpKrw)})`,
        비고: `${totals.cpUsd.toLocaleString()} USD`,
      },
      {
        항목: '총 설치투자비 (C_BM)',
        값: `${formatUsdCompact(totals.cbmUsd)} (${formatKrwReadable(totals.cbmKrw)})`,
        비고: `${totals.cbmUsd.toLocaleString()} USD`,
      },
      {
        항목: '총 모듈 투자비 (C_TM)',
        값: `${formatUsdCompact(totals.ctmUsd)} (${formatKrwReadable(totals.ctmKrw)})`,
        비고: `${totals.ctmUsd.toLocaleString()} USD`,
      },
      {
        항목: '산출 문헌 근거',
        값: 'Turton (2018) 5th ed. Appendix A / Towler & Sinnott (2022) Ch.7 / Guthrie Bare-Module',
        비고: 'Class 4 개념설계 추정 (±30%)',
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(sheet1Rows);
    ws1['!cols'] = [
      { wch: 5 },
      { wch: 14 },
      { wch: 24 },
      { wch: 18 },
      { wch: 22 },
      { wch: 30 },
      { wch: 13 },
      { wch: 24 },
      { wch: 18 },
      { wch: 13 },
      { wch: 26 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Equipment_List_CAPEX');

    const ws2 = XLSX.utils.json_to_sheet(basisRows);
    ws2['!cols'] = [{ wch: 28 }, { wch: 42 }, { wch: 44 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Cost_Basis_CEPCI');

    const safeName = (caseTitle || activePlantId).replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 32);
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    XLSX.writeFile(wb, `Equipment_CAPEX_${safeName}_${ymd}.xlsx`);
    showToast('장치목록·투자비 엑셀(.xlsx) 파일을 다운로드했습니다.');
  };

  const backHref = activePlantId === 'classic_sim' ? '/classic-simulator' : '/flowsheet-simulator';
  const displayCaseTitle =
    caseTitle || (activePlantId === 'classic_sim' ? '현재 클래식 케이스' : '현재 시뮬레이터 케이스');

  const modalIframeSrc = useMemo(() => {
    if (!modalRowKey) return '';
    return `${BASE_PATH}/chempro/index.html?embed=1&standalone=1&plant=${encodeURIComponent(
      activePlantId
    )}&tab=${encodeURIComponent(modalTab)}&handoff=1&ts=${modalTs}&v=20261119a`;
  }, [activePlantId, modalRowKey, modalTab, modalTs]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        background: '#F8FAFC',
        color: '#0F172A',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ maxWidth: 1480, margin: '0 auto', padding: '20px 24px 40px' }}>
        {/* Toast notification */}
        {toastMsg && (
          <div
            style={{
              position: 'fixed',
              bottom: 24,
              right: 24,
              zIndex: 1200,
              background: '#0F172A',
              color: '#F8FAFC',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              boxShadow: '0 10px 25px rgba(15, 23, 42, 0.25)',
              border: '1px solid #334155',
            }}
          >
            {toastMsg}
          </div>
        )}

        {/* Top Header */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            marginBottom: 18,
            paddingBottom: 14,
            borderBottom: '1px solid #E2E8F0',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
                장치목록 · 데이터시트 · 투자비 (CAPEX)
              </h1>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  color: '#1E3A8A',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span>📁 {displayCaseTitle}</span>
                <span style={{ color: '#64748B', fontWeight: 500 }}>· 이 케이스 전용 산출물</span>
              </span>
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#475569' }}>
              시뮬레이션 수렴 운전조건 기반으로 주요 공정장치의 사이징·데이터시트·Turton/Guthrie Bare-Module 투자비를 산출합니다.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => router.push(backHref)}
              style={{
                padding: '8px 13px',
                borderRadius: 7,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#334155',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← 시뮬레이션으로 돌아가기
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={equipmentRows.length === 0}
              style={{
                padding: '8px 14px',
                borderRadius: 7,
                border: 'none',
                background: equipmentRows.length === 0 ? '#94A3B8' : '#1E3A8A',
                color: '#FFFFFF',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: equipmentRows.length === 0 ? 'not-allowed' : 'pointer',
                boxShadow: equipmentRows.length === 0 ? 'none' : '0 2px 6px rgba(30,58,138,0.22)',
              }}
            >
              📊 장치목록·투자비 엑셀(.xlsx) 다운로드
            </button>
          </div>
        </div>

        {/* KPI Summary Cards + CEPCI / FX Controls */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              padding: '13px 15px',
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>공정 장치 / 데이터시트</div>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>{totals.count}기</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: totals.datasheetsDone === totals.count && totals.count > 0 ? '#059669' : '#2563EB',
                }}
              >
                시트 {totals.datasheetsDone} / {totals.count}
              </span>
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: '#94A3B8' }}>
              Feed/Product/Mixer/Splitter 제외
            </div>
          </div>

          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              padding: '13px 15px',
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>총 구매원가 (Cp)</div>
            <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
              {formatKrwReadable(totals.cpKrw)}
            </div>
            <div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>
              {formatUsdCompact(totals.cpUsd)}
            </div>
          </div>

          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              padding: '13px 15px',
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>총 설치투자비 (C_BM)</div>
            <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800, color: '#1E3A8A' }}>
              {formatKrwReadable(totals.cbmKrw)}
            </div>
            <div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>
              {formatUsdCompact(totals.cbmUsd)} · Bare-Module
            </div>
          </div>

          <div
            style={{
              background: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 100%)',
              border: '1px solid #1E3A8A',
              borderRadius: 10,
              padding: '13px 15px',
              color: '#FFFFFF',
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#BFDBFE' }}>
              총 모듈 CAPEX (C_TM)
            </div>
            <div style={{ marginTop: 6, fontSize: 21, fontWeight: 800 }}>
              {formatKrwReadable(totals.ctmKrw)}
            </div>
            <div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 600, color: '#DBEAFE' }}>
              {formatUsdCompact(totals.ctmUsd)} (계수 ×{persistState.contingencyFactor.toFixed(2)})
            </div>
          </div>

          {/* CEPCI & FX Controls Card */}
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              padding: '11px 14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: '#334155' }}>CEPCI</label>
              <input
                type="number"
                min={300}
                max={1500}
                step={10}
                value={persistState.cepci}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) {
                    savePersistState(prev => ({ ...prev, cepci: v }));
                  }
                }}
                style={{
                  width: 92,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 12.5,
                  fontWeight: 700,
                  textAlign: 'right',
                  color: '#0F172A',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: '#334155' }}>환율 (₩/$)</label>
              <input
                type="number"
                min={800}
                max={2500}
                step={10}
                value={persistState.fxKrwPerUsd}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) {
                    savePersistState(prev => ({ ...prev, fxKrwPerUsd: v }));
                  }
                }}
                style={{
                  width: 92,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 12.5,
                  fontWeight: 700,
                  textAlign: 'right',
                  color: '#0F172A',
                }}
              />
            </div>
          </div>
        </div>

        {/* Empty State or Equipment Table */}
        {equipmentRows.length === 0 ? (
          <div
            style={{
              background: '#FFFFFF',
              border: '1px dashed #CBD5E1',
              borderRadius: 12,
              padding: '56px 24px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 10 }}>🏭</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1E293B', marginBottom: 6 }}>
              현재 케이스에 등록된 공정 장치가 없습니다
            </div>
            <p style={{ margin: '0 auto 18px', maxWidth: 460, fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
              시뮬레이터 캔버스에 열교환기, 펌프, 압축기, 탑조, 분리기, 반응기 등 공정 장치를 배치하고 계산을 실행하면 이 케이스 전용 장치목록과 CAPEX가 자동으로 산출됩니다.
            </p>
            <button
              type="button"
              onClick={() => router.push(backHref)}
              style={{
                padding: '9px 18px',
                borderRadius: 8,
                border: 'none',
                background: '#1E3A8A',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ← 시뮬레이션으로 돌아가기
            </button>
          </div>
        ) : (
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12.5,
                  minWidth: 1120,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: '#F1F5F9',
                      borderBottom: '1px solid #CBD5E1',
                      color: '#334155',
                      textAlign: 'left',
                    }}
                  >
                    <th style={{ padding: '11px 12px', fontWeight: 700 }}>Tag / 장치명</th>
                    <th style={{ padding: '11px 10px', fontWeight: 700 }}>유형</th>
                    <th style={{ padding: '11px 10px', fontWeight: 700 }}>운전조건 (시뮬레이션)</th>
                    <th style={{ padding: '11px 10px', fontWeight: 700 }}>재질 (F_M)</th>
                    <th style={{ padding: '11px 10px', fontWeight: 700 }}>데이터시트</th>
                    <th style={{ padding: '11px 10px', fontWeight: 700, textAlign: 'right' }}>구매원가 (Cp)</th>
                    <th style={{ padding: '11px 10px', fontWeight: 700, textAlign: 'right' }}>설치투자비 (C_BM)</th>
                    <th style={{ padding: '11px 10px', fontWeight: 700, textAlign: 'right' }}>총 투자비 (C_TM)</th>
                    <th style={{ padding: '11px 12px', fontWeight: 700, textAlign: 'center' }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {equipmentRows.map((row, idx) => (
                    <tr
                      key={row.key}
                      style={{
                        borderBottom: '1px solid #E2E8F0',
                        background: idx % 2 === 0 ? '#FFFFFF' : '#FAFBFD',
                      }}
                    >
                      {/* Tag / Name */}
                      <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 800, color: '#0F172A', fontSize: 13 }}>
                          {row.def.tag}
                        </div>
                        <div style={{ color: '#475569', fontSize: 11.5, marginTop: 2 }}>
                          {row.def.name}
                        </div>
                      </td>

                      {/* Type */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'middle' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: '#F1F5F9',
                            color: '#334155',
                            fontSize: 11.5,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.unitTypeLabel}
                        </span>
                        <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
                          {row.cost.basisSummary}
                        </div>
                      </td>

                      {/* Operating Conditions */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'middle', maxWidth: 260 }}>
                        <div style={{ color: '#0F172A', fontWeight: 600, fontSize: 12 }}>
                          {row.conditionSummary}
                        </div>
                        <div
                          style={{
                            color: '#64748B',
                            fontSize: 11,
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={row.detectedFluid}
                        >
                          {row.detectedFluid}
                        </div>
                      </td>

                      {/* Material Select */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'middle' }}>
                        <select
                          value={row.material}
                          onChange={e =>
                            handleMaterialChange(row.key, e.target.value as CostMaterialKey)
                          }
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#0F172A',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {MATERIAL_OPTIONS.map(opt => (
                            <option key={opt.key} value={opt.key}>
                              {opt.shortLabel}
                            </option>
                          ))}
                        </select>
                        <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>
                          F_M={row.cost.factors.fm.toFixed(2)} · F_BM={row.cost.factors.fbm.toFixed(2)}
                        </div>
                      </td>

                      {/* Datasheet Status */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'middle', maxWidth: 190 }}>
                        {row.override.datasheetSaved ? (
                          <div>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: '#ECFDF5',
                                border: '1px solid #A7F3D0',
                                color: '#047857',
                                fontSize: 11.5,
                                fontWeight: 700,
                              }}
                            >
                              ✅ 저장됨
                            </span>
                            {row.override.datasheetSummary && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#475569',
                                  marginTop: 3,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={row.override.datasheetSummary}
                              >
                                {row.override.datasheetSummary}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: '#F8FAFC',
                              border: '1px solid #E2E8F0',
                              color: '#64748B',
                              fontSize: 11.5,
                              fontWeight: 600,
                            }}
                          >
                            미작성
                          </span>
                        )}
                      </td>

                      {/* Cp */}
                      <td
                        style={{
                          padding: '10px 10px',
                          verticalAlign: 'middle',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#0F172A' }}>
                          {formatKrwReadable(row.cost.purchasedKrw)}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>
                          {formatUsdCompact(row.cost.purchasedUsd)}
                        </div>
                      </td>

                      {/* C_BM */}
                      <td
                        style={{
                          padding: '10px 10px',
                          verticalAlign: 'middle',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#1E3A8A' }}>
                          {formatKrwReadable(row.cost.bareModuleKrw)}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>
                          {formatUsdCompact(row.cost.bareModuleUsd)}
                        </div>
                      </td>

                      {/* C_TM */}
                      <td
                        style={{
                          padding: '10px 10px',
                          verticalAlign: 'middle',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <div style={{ fontWeight: 800, color: '#0F172A' }}>
                          {formatKrwReadable(row.cost.totalModuleKrw)}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>
                          {formatUsdCompact(row.cost.totalModuleUsd)}
                        </div>
                      </td>

                      {/* Action */}
                      <td
                        style={{
                          padding: '10px 12px',
                          verticalAlign: 'middle',
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenDatasheetModal(row)}
                          style={{
                            padding: '6px 11px',
                            borderRadius: 6,
                            border: row.override.datasheetSaved
                              ? '1px solid #059669'
                              : '1px solid #1E3A8A',
                            background: row.override.datasheetSaved ? '#ECFDF5' : '#EFF6FF',
                            color: row.override.datasheetSaved ? '#047857' : '#1E3A8A',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {row.override.datasheetSaved ? '📐 데이터시트 열기' : '📐 데이터시트 생성'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr
                    style={{
                      background: '#F1F5F9',
                      borderTop: '2px solid #CBD5E1',
                      fontWeight: 800,
                    }}
                  >
                    <td colSpan={5} style={{ padding: '12px', color: '#0F172A' }}>
                      합계 ({totals.count}기 장치 · CEPCI {persistState.cepci} · ₩
                      {persistState.fxKrwPerUsd.toLocaleString()}/$)
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div>{formatKrwReadable(totals.cpKrw)}</div>
                      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>
                        {formatUsdCompact(totals.cpUsd)}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: '12px 10px',
                        textAlign: 'right',
                        color: '#1E3A8A',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div>{formatKrwReadable(totals.cbmKrw)}</div>
                      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>
                        {formatUsdCompact(totals.cbmUsd)}
                      </div>
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div>{formatKrwReadable(totals.ctmKrw)}</div>
                      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>
                        {formatUsdCompact(totals.ctmUsd)}
                      </div>
                    </td>
                    <td style={{ padding: '12px' }} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Case-Scoped Inline Datasheet Generator Modal */}
      {activeModalRow && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.72)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Modal Top Bar */}
          <div
            style={{
              background: '#0F172A',
              color: '#F8FAFC',
              padding: '10px 18px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              borderBottom: '1px solid #334155',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: '#FFFFFF' }}>
                [{displayCaseTitle}] › [{activeModalRow.def.tag}] 데이터시트
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#1E3A8A',
                  color: '#DBEAFE',
                }}
              >
                이 케이스 전용
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <label style={{ fontSize: 11.5, color: '#CBD5E1', fontWeight: 600 }}>
                  {activeModalRow.sizingKind === 'area'
                    ? '확정 면적 (m²)'
                    : activeModalRow.sizingKind === 'power'
                      ? '확정 동력 (kW)'
                      : `확정 용량 (${activeModalRow.sizingUnit})`}
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder={activeModalRow.autoSizingValue.toFixed(1)}
                  value={modalSizingInput}
                  onChange={e => setModalSizingInput(e.target.value)}
                  style={{
                    width: 86,
                    padding: '5px 8px',
                    borderRadius: 6,
                    border: '1px solid #475569',
                    background: '#1E293B',
                    color: '#F8FAFC',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'right',
                  }}
                />
              </div>

              <input
                type="text"
                placeholder="데이터시트 메모 (예: TEMA BEM, 설계 확정)"
                value={modalSummaryInput}
                onChange={e => setModalSummaryInput(e.target.value)}
                style={{
                  width: 230,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid #475569',
                  background: '#1E293B',
                  color: '#F8FAFC',
                  fontSize: 12,
                }}
              />

              <button
                type="button"
                onClick={handleSaveDatasheetToCase}
                style={{
                  padding: '6px 13px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#059669',
                  color: '#FFFFFF',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✅ 이 케이스에 데이터시트 저장
              </button>

              <button
                type="button"
                onClick={() => setModalRowKey(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #475569',
                  background: '#1E293B',
                  color: '#E2E8F0',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                닫기
              </button>
            </div>
          </div>

          {/* Embedded ChemPro Datasheet Iframe */}
          <div style={{ flex: 1, minHeight: 0, background: '#F6F7F2' }}>
            <iframe
              ref={modalIframeRef}
              src={modalIframeSrc}
              onLoad={() => {
                postModalSync();
              }}
              title={`${activeModalRow.def.tag} Datasheet Generator`}
              style={{ width: '100%', height: '100%', border: 'none', background: '#F6F7F2' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

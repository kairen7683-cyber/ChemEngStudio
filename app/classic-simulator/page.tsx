'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Connection,
  ConnectionMode,
  Edge,
  Node,
  applyNodeChanges,
  NodeChange,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import {
  SIM_COMPS,
  COMP_META,
  SimCompKey,
  FlowUnitType,
  FlowNodeDef,
  FlowEdgeDef,
  SourcePortId,
  TargetPortId,
  RefrigerantPresetKey,
  emptySimFlows,
  createIdleFlowsheetResult,
  solveFlowsheet,
  type FlowsheetSolveResult,
  type SolvedStream,
  type TearSolverMethod,
} from '@/lib/calculations/flowsheetSolver';
import ClassicBlockNode, {
  CLASSIC_MODEL_CATALOG,
  CLASSIC_MODEL_CATEGORIES,
  ClassicBlockNodeData,
  ClassicUnitSvg,
} from '@/components/classic-sim/ClassicBlockNode';
import ClassicStreamEdge from '@/components/classic-sim/ClassicStreamEdge';
import ClassicRibbon, { type ClassicRibbonTab } from '@/components/classic-sim/ClassicRibbon';
import ClassicExplorerTree, { type ClassicMdiTab } from '@/components/classic-sim/ClassicExplorerTree';
import {
  ClassicControlPanel,
  ClassicStatusBar,
} from '@/components/classic-sim/ClassicControlPanel';
import {
  fetchConvergedBaselinesBundle,
  getClassicPlantPresetOptions,
  getPlantSheetsByGroup,
} from '@/lib/classicPlantPresets';
import {
  consumeUiSwitchHandoff,
  saveUiSwitchHandoff,
  setPreferredSimUiMode,
} from '@/lib/simUiHandoff';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import DistillationWorkbenchModal from '@/components/flowsheet/DistillationWorkbenchModal';
import ComponentPropertySetupModal from '@/components/flowsheet/ComponentPropertySetupModal';
import FlowsheetOptimizationModal from '@/components/flowsheet/FlowsheetOptimizationModal';
import ReactorWorkbenchModal from '@/components/flowsheet/ReactorWorkbenchModal';
import type { DesignSpecDef } from '@/lib/calculations/flowsheetOptimization';
import PlantUnitCopyBox from '@/components/flowsheet/PlantUnitCopyBox';
import ConvergenceReportPanel from '@/components/flowsheet/ConvergenceReportPanel';
import HeatExchangerWorkbenchModal, {
  type HxWorkbenchView,
} from '@/components/flowsheet/HeatExchangerWorkbenchModal';
import {
  type DistillColumnParams,
  type DistillFeedInput,
} from '@/lib/calculations/rigorousDistillation';
import {
  type SimPropertyMethod,
  type ResolvedPropertyMethod,
  PROPERTY_METHOD_INFO,
  COMP_CATALOG_META,
  PLANT_COMPONENT_PRESETS,
  GENERAL_COMPONENT_PACKS,
  getPlantDefaultComponents,
  recommendPropertyMethod,
} from '@/lib/calculations/componentCatalog';

const CLASSIC_AUTO_SAVE_KEY = 'chemplant-classic-sim-auto-v1';
const CLASSIC_PROJECTS_KEY = 'chemplant-classic-sim-projects-v1';

const NODE_TYPES = { classicBlock: ClassicBlockNode };
const EDGE_TYPES = { classicStream: ClassicStreamEdge };

interface ClassicExampleCase {
  id: string;
  label: string;
  nodes: Array<FlowNodeDef & { position: { x: number; y: number } }>;
  edges: FlowEdgeDef[];
}

const CLASSIC_EXAMPLES: ClassicExampleCase[] = [
  {
    id: 'ex_flash_loop',
    label: '기액 플래시 & 열교환기 기초 (Feed → Heater → Flash2)',
    nodes: [
      {
        id: 'cb_feed1',
        tag: 'FEED',
        name: 'Feed Stream',
        unitType: 'feed',
        position: { x: 60, y: 150 },
        params: {
          feedTempC: 85,
          feedPressKgcm2g: 2.0,
          feedFlowsKgH: emptySimFlows({ H2O: 3500, Cl2: 4500, H2: 80 }),
        },
      },
      {
        id: 'cb_hx1',
        tag: 'E-101',
        name: 'Heater / Cooler',
        unitType: 'cooler',
        position: { x: 260, y: 145 },
        params: {
          refrigerantPreset: 'cw' as RefrigerantPresetKey,
          hexSpecMode: 'proc_temp',
          operTempC: 25,
          overallU: 450,
        },
      },
      {
        id: 'cb_flash1',
        tag: 'V-101',
        name: 'Flash2 Separator',
        unitType: 'separator',
        position: { x: 470, y: 138 },
        params: { operTempC: 25, operPressKgcm2g: 1.8 },
      },
      {
        id: 'cb_pgas',
        tag: 'GAS-OUT',
        name: 'Vapor Product',
        unitType: 'product',
        position: { x: 700, y: 65 },
        params: {},
      },
      {
        id: 'cb_pliq',
        tag: 'LIQ-OUT',
        name: 'Liquid Product',
        unitType: 'product',
        position: { x: 700, y: 225 },
        params: {},
      },
    ],
    edges: [
      { id: 'ce_1', streamNo: 'S1', source: 'cb_feed1', target: 'cb_hx1', sourcePort: 'out', targetPort: 'in' },
      { id: 'ce_2', streamNo: 'S2', source: 'cb_hx1', target: 'cb_flash1', sourcePort: 'out', targetPort: 'in' },
      { id: 'ce_3', streamNo: 'S3', source: 'cb_flash1', target: 'cb_pgas', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ce_4', streamNo: 'S4', source: 'cb_flash1', target: 'cb_pliq', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  {
    id: 'ex_ech_distill',
    label: 'ECH 다단 정밀증류 2탑 (RadColumn × 2)',
    nodes: [
      {
        id: 'cd_feed',
        tag: 'CRUDE-ECH',
        name: 'Feed Stream',
        unitType: 'feed',
        position: { x: 40, y: 155 },
        params: {
          feedTempC: 68,
          feedPressKgcm2g: 0.2,
          feedFlowsKgH: emptySimFlows({ ECH: 4820, DCP: 145, DCH: 320, H2O: 45 }),
        },
      },
      {
        id: 'cd_c101',
        tag: 'C-101',
        name: 'RadColumn (경질분 제거)',
        unitType: 'distillation',
        position: { x: 250, y: 120 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            columnCalcMode: 'design_stages',
            thermoModel: 'NRTL',
            designLkComp: 'DCP',
            designHkComp: 'ECH',
            designRefluxMult: 1.25,
            topPressKgcm2g: -0.65,
            murphreeEffPct: 75,
          },
        },
      },
      {
        id: 'cd_light',
        tag: 'LIGHT-OUT',
        name: 'Distillate',
        unitType: 'product',
        position: { x: 490, y: 55 },
        params: {},
      },
      {
        id: 'cd_c102',
        tag: 'C-102',
        name: 'RadColumn (ECH 제품탑)',
        unitType: 'distillation',
        position: { x: 480, y: 205 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            columnCalcMode: 'design_stages',
            thermoModel: 'NRTL',
            designLkComp: 'ECH',
            designHkComp: 'DCH',
            designRefluxMult: 1.25,
            topPressKgcm2g: -0.75,
            murphreeEffPct: 75,
          },
        },
      },
      {
        id: 'cd_ech',
        tag: 'PROD-ECH',
        name: 'ECH 99.9% Product',
        unitType: 'product',
        position: { x: 720, y: 140 },
        params: {},
      },
      {
        id: 'cd_heavy',
        tag: 'HEAVY-OUT',
        name: 'Heavy Residue',
        unitType: 'product',
        position: { x: 720, y: 270 },
        params: {},
      },
    ],
    edges: [
      { id: 'cde_1', streamNo: 'S1', source: 'cd_feed', target: 'cd_c101', sourcePort: 'out', targetPort: 'in' },
      { id: 'cde_2', streamNo: 'S2', source: 'cd_c101', target: 'cd_light', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'cde_3', streamNo: 'S3', source: 'cd_c101', target: 'cd_c102', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'cde_4', streamNo: 'S4', source: 'cd_c102', target: 'cd_ech', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'cde_5', streamNo: 'S5', source: 'cd_c102', target: 'cd_heavy', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
];

interface SavedClassicProject {
  id: string;
  name: string;
  savedAt: string;
  simDefs: FlowNodeDef[];
  positions: Record<string, { x: number; y: number }>;
  flowEdges: FlowEdgeDef[];
  thermoMethod: SimPropertyMethod;
  activeComponents?: SimCompKey[];
}

function normalizePropertyMethod(raw: unknown): SimPropertyMethod {
  if (raw === 'AUTO' || raw === 'ENRTL' || raw === 'NRTL' || raw === 'PR' || raw === 'SRK') return raw;
  if (raw === 'PR-EOS') return 'PR';
  if (raw === 'Pitzer') return 'ENRTL';
  return 'AUTO';
}

function mergeFeedComponents(defs: FlowNodeDef[], base: SimCompKey[]): SimCompKey[] {
  const set = new Set<SimCompKey>(base);
  for (const d of defs) {
    if (d.params?.feedFlowsKgH) {
      for (const [k, v] of Object.entries(d.params.feedFlowsKgH)) {
        if ((v ?? 0) > 0 && SIM_COMPS.includes(k as SimCompKey)) {
          set.add(k as SimCompKey);
        }
      }
    }
    if (d.params?.makeupSolventComp && SIM_COMPS.includes(d.params.makeupSolventComp)) {
      set.add(d.params.makeupSolventComp);
    }
  }
  return Array.from(set);
}

function defaultParamsForClassic(unitType: FlowUnitType): FlowNodeDef['params'] {
  switch (unitType) {
    case 'feed':
      return { feedTempC: 30, feedPressKgcm2g: 1.0, feedFlowsKgH: emptySimFlows({ H2O: 1000 }) };
    case 'cooler':
    case 'liquefier':
      return {
        refrigerantPreset: 'cw' as RefrigerantPresetKey,
        hexSpecMode: 'proc_temp',
        operTempC: 30,
        overallU: 450,
      };
    case 'hex':
      return {
        refrigerantPreset: 'cw' as RefrigerantPresetKey,
        hexSpecMode: 'proc_temp',
        operTempC: 40,
        overallU: 520,
      };
    case 'separator':
      return { operTempC: 30, operPressKgcm2g: 0.5 };
    case 'pump':
      return { outletPressKgcm2g: 4.0, efficiency: 0.72 };
    case 'compressor':
      return { outletPressKgcm2g: 3.5, efficiency: 0.76, intercooledTempC: 40 };
    case 'splitter':
      return { splitRatioTop: 0.5 };
    case 'mixer':
      return { multiplier: 1 };
    case 'absorber':
      return {
        targetComponent: 'H2O' as SimCompKey,
        removalEfficiency: 0.99,
        operTempC: 25,
        solventMode: 'connected_or_manual',
        makeupSolventComp: 'H2SO4' as SimCompKey,
        makeupSolventKgH: 500,
      };
    case 'extractor':
      return {
        calcMode: 'rigorous',
        extractorStages: 6,
        operTempC: 25,
        operPressKgcm2g: 0.5,
        extractorSolventComp: 'EtOAc' as SimCompKey,
        extractorSolventKgH: 800,
      };
    case 'valve':
      return {
        calcMode: 'rigorous',
        outletPressKgcm2g: 1.0,
        pressureDropKgcm2: 2.0,
      };
    case 'reactor':
      return { reactionPreset: 'hcl_burner', conversion: 0.99, operTempC: 180 };
    case 'distillation':
      return {
        calcMode: 'rigorous',
        distillConfig: {
          columnCalcMode: 'design_stages',
          thermoModel: 'NRTL',
          designLkComp: 'DCP',
          designHkComp: 'ECH',
          designRefluxMult: 1.25,
          topPressKgcm2g: 0.0,
          murphreeEffPct: 75,
        },
      };
    default:
      return {};
  }
}

function getModelName(unitType: FlowUnitType): string {
  return CLASSIC_MODEL_CATALOG.find(m => m.unitType === unitType)?.modelName ?? unitType.toUpperCase();
}

export default function ClassicSimulatorPage() {
  const initialEx = CLASSIC_EXAMPLES[0];

  const [simDefs, setSimDefs] = useState<FlowNodeDef[]>(() =>
    initialEx.nodes.map(({ position: _p, ...def }) => ({ ...def, params: { ...def.params } }))
  );
  const [rfNodes, setRfNodes] = useState<Node<ClassicBlockNodeData>[]>(() =>
    initialEx.nodes.map(n => ({
      id: n.id,
      type: 'classicBlock',
      position: { ...n.position },
      data: { tag: n.tag, modelName: getModelName(n.unitType), unitType: n.unitType },
    }))
  );
  const [flowEdges, setFlowEdges] = useState<FlowEdgeDef[]>(() => initialEx.edges.map(e => ({ ...e })));
  const [activeComponents, setActiveComponents] = useState<SimCompKey[]>(() =>
    mergeFeedComponents(initialEx.nodes, getPlantDefaultComponents('clorsim_sim'))
  );
  const [thermoMethod, setThermoMethod] = useState<SimPropertyMethod>('AUTO');
  const [compModalOpen, setCompModalOpen] = useState(false);

  const [selectedKind, setSelectedKind] = useState<'block' | 'stream' | 'setup_comp' | 'setup_method'>('block');
  const [selectedId, setSelectedId] = useState<string | null>(initialEx.nodes[0]?.id ?? null);
  const [bottomView, setBottomView] = useState<'pfd' | 'summary'>('pfd');
  const [paletteCat, setPaletteCat] = useState<string>('all');
  const [treeStreamsOpen, setTreeStreamsOpen] = useState(true);
  const [treeBlocksOpen, setTreeBlocksOpen] = useState(true);
  const [showExplorer, setShowExplorer] = useState(true);
  const [showProjectBar, setShowProjectBar] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedClassicProject[]>([]);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  const [mobilePane, setMobilePane] = useState<'pfd' | 'tree' | 'form' | 'summary'>('pfd');

  // 내장 정밀 워크벤치 모달
  const [distillModalNodeId, setDistillModalNodeId] = useState<string | null>(null);
  const [hxModalNodeId, setHxModalNodeId] = useState<string | null>(null);
  const [hxModalView, setHxModalView] = useState<HxWorkbenchView>('thermal');
  const [reactorModalNodeId, setReactorModalNodeId] = useState<string | null>(null);
  const [optModalOpen, setOptModalOpen] = useState(false);
  const [tearMethod, setTearMethod] = useState<TearSolverMethod>('auto');
  const [designSpecs, setDesignSpecs] = useState<DesignSpecDef[]>([]);
  const [showConvDiag, setShowConvDiag] = useState(false);

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const rfWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const feedSummary = useMemo(() => {
    const flows: Partial<Record<SimCompKey, number>> = {};
    let maxP = 1.0;
    for (const d of simDefs) {
      if (typeof d.params?.feedPressKgcm2g === 'number') maxP = Math.max(maxP, d.params.feedPressKgcm2g);
      if (typeof d.params?.operPressKgcm2g === 'number') maxP = Math.max(maxP, d.params.operPressKgcm2g);
      if (typeof d.params?.outletPressKgcm2g === 'number') maxP = Math.max(maxP, d.params.outletPressKgcm2g);
      if (d.params?.feedFlowsKgH) {
        for (const [k, v] of Object.entries(d.params.feedFlowsKgH)) {
          if ((v ?? 0) > 0) {
            flows[k as SimCompKey] = (flows[k as SimCompKey] ?? 0) + (v ?? 0);
          }
        }
      }
    }
    return { flows, maxP };
  }, [simDefs]);

  const autoRecommended = useMemo(
    () => recommendPropertyMethod(activeComponents, feedSummary.flows, feedSummary.maxP),
    [activeComponents, feedSummary.flows, feedSummary.maxP]
  );

  // 명시적 시뮬레이션 실행 (초기 로드 시 동기 수렴 금지 — 저장된 결과 복원 또는 O(1) 대기 상태로 즉시 오픈)
  const [solvedMeta, setSolvedMeta] = useState<{
    result: FlowsheetSolveResult;
    elapsedMs: number;
    lastRunTime: string;
  }>(() => ({
    result: createIdleFlowsheetResult(
      initialEx.nodes.map(({ position: _p, ...d }) => d),
      initialEx.edges,
      {
        propertyMethod: 'AUTO',
        activeComponents: mergeFeedComponents(initialEx.nodes, getPlantDefaultComponents('clorsim_sim')),
      }
    ),
    elapsedMs: 0,
    lastRunTime: '미실행 (▶ Run 대기)',
  }));
  const [isDirty, setIsDirty] = useState(true);
  const skipDirtyRef = useRef(true);

  useEffect(() => {
    const sync = () => {
      const mob = window.innerWidth <= 768;
      setIsMobile(mob);
      if (mob) setShowExplorer(false);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  // 로컬스토리지 복원 (절대 solveFlowsheet 자동 실행하지 않고 마지막 저장 상태 그대로 복원)
  useEffect(() => {
    try {
      const rawAuto = localStorage.getItem(CLASSIC_AUTO_SAVE_KEY);
      if (rawAuto) {
        const parsed = JSON.parse(rawAuto);
        if (parsed && Array.isArray(parsed.simDefs) && Array.isArray(parsed.flowEdges)) {
          skipDirtyRef.current = true;
          const restoredMethod = normalizePropertyMethod(parsed.thermoMethod);
          const baseComps = Array.isArray(parsed.activeComponents) && parsed.activeComponents.length > 0
            ? (parsed.activeComponents.filter((c: string) => SIM_COMPS.includes(c as SimCompKey)) as SimCompKey[])
            : getPlantDefaultComponents('clorsim_sim');
          const restoredComps = mergeFeedComponents(parsed.simDefs, baseComps);
          setSimDefs(parsed.simDefs);
          setFlowEdges(parsed.flowEdges);
          setRfNodes(
            parsed.simDefs.map((d: FlowNodeDef, i: number) => ({
              id: d.id,
              type: 'classicBlock',
              position: parsed.positions?.[d.id] ?? { x: 80 + i * 170, y: 140 },
              data: { tag: d.tag, modelName: getModelName(d.unitType), unitType: d.unitType },
            }))
          );
          setThermoMethod(restoredMethod);
          setActiveComponents(restoredComps);
          if (
            parsed.lastSolvedMeta?.result &&
            Array.isArray(parsed.lastSolvedMeta.result.streams) &&
            Array.isArray(parsed.lastSolvedMeta.result.units)
          ) {
            setSolvedMeta({
              result: parsed.lastSolvedMeta.result,
              elapsedMs: parsed.lastSolvedMeta.elapsedMs ?? 1,
              lastRunTime: parsed.lastSolvedMeta.lastRunTime ?? '저장본 복원',
            });
            setIsDirty(Boolean(parsed.isDirty));
          } else {
            const idleRes = createIdleFlowsheetResult(parsed.simDefs, parsed.flowEdges, {
              propertyMethod: restoredMethod,
              activeComponents: restoredComps,
            });
            setSolvedMeta({ result: idleRes, elapsedMs: 0, lastRunTime: '미실행 (▶ Run 대기)' });
            setIsDirty(true);
          }
          setSelectedId(parsed.simDefs[0]?.id ?? null);
          setSelectedKind('block');
        }
      }
      const rawProjs = localStorage.getItem(CLASSIC_PROJECTS_KEY);
      if (rawProjs) {
        const arr = JSON.parse(rawProjs);
        if (Array.isArray(arr)) setSavedProjects(arr);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // 도면/입력 변경 시 Dirty 표시
  useEffect(() => {
    if (!hydrated) return;
    if (skipDirtyRef.current) {
      skipDirtyRef.current = false;
    } else {
      setIsDirty(true);
    }
  }, [simDefs, flowEdges, thermoMethod, activeComponents, hydrated]);

  // 자동 저장 (마지막 수렴 상태 스냅샷 함께 보존, 용량 초과 시 도면만 저장)
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      const positions: Record<string, { x: number; y: number }> = {};
      rfNodes.forEach(n => {
        positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      });
      const basePayload = { simDefs, positions, flowEdges, thermoMethod, activeComponents, isDirty };
      const lastSolvedMeta = !solvedMeta.result.convergence.isIdle ? solvedMeta : undefined;
      try {
        localStorage.setItem(
          CLASSIC_AUTO_SAVE_KEY,
          JSON.stringify({ ...basePayload, lastSolvedMeta })
        );
      } catch {
        try {
          localStorage.setItem(CLASSIC_AUTO_SAVE_KEY, JSON.stringify(basePayload));
        } catch {
          /* ignore */
        }
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [simDefs, flowEdges, rfNodes, thermoMethod, activeComponents, solvedMeta, isDirty, hydrated]);

  const router = useRouter();
  const setActivePlantId = useBalanceStore(s => s.setActivePlantId);
  const [ribbonTab, setRibbonTab] = useState<ClassicRibbonTab>('home');
  const [showPalette, setShowPalette] = useState(true);
  const [showControlPanel, setShowControlPanel] = useState(true);
  const [showStreamCallouts, setShowStreamCallouts] = useState(true);
  const [orthogonalEdges, setOrthogonalEdges] = useState(true);
  const [mdiTabs, setMdiTabs] = useState<ClassicMdiTab[]>([
    { key: 'pfd', kind: 'pfd', title: 'Main Flowsheet' },
    { key: 'summary', kind: 'summary', title: 'Stream Summary' },
    { key: 'control', kind: 'control', title: 'Control Panel' },
  ]);
  const [activeMdiKey, setActiveMdiKey] = useState<string>('pfd');
  const plantPresets = useMemo(() => getClassicPlantPresetOptions(), []);

  const [isSimRunning, setIsSimRunning] = useState<boolean>(false);
  const simRunningRef = useRef<boolean>(false);

  const runSimulation = useCallback(
    (
      overrideDefs?: FlowNodeDef[],
      overrideEdges?: FlowEdgeDef[],
      overrideMethod?: SimPropertyMethod,
      overrideComps?: SimCompKey[],
      overrideTearMethod?: TearSolverMethod
    ) => {
      if (simRunningRef.current) return;
      simRunningRef.current = true;
      setIsSimRunning(true);
      const defs = overrideDefs ?? simDefs;
      const eds = overrideEdges ?? flowEdges;
      const mth = overrideMethod ?? thermoMethod;
      const cmps = overrideComps ?? activeComponents;
      const tr = overrideTearMethod ?? tearMethod;

      const executeSolve = () => {
        try {
          const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
          const res = solveFlowsheet(defs, eds, {
            propertyMethod: mth,
            activeComponents: cmps,
            tearMethod: tr,
          });
          const dt = typeof performance !== 'undefined' ? Math.max(1, Math.round(performance.now() - t0)) : 1;
          setSolvedMeta({
            result: res,
            elapsedMs: dt,
            lastRunTime: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
          });
          setIsDirty(false);
        } finally {
          simRunningRef.current = false;
          setIsSimRunning(false);
        }
      };

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          window.setTimeout(executeSolve, 0);
        });
      } else {
        setTimeout(executeSolve, 0);
      }
    },
    [simDefs, flowEdges, thermoMethod, activeComponents, tearMethod]
  );

  // F5 / Ctrl+Enter 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault();
        runSimulation();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runSimulation]);

  // 모던 UI -> 클래식 UI 전환 시 실시간 플로우시트 인계 수신
  useEffect(() => {
    const handoff = consumeUiSwitchHandoff();
    if (!handoff || handoff.fromUi !== 'modern') return;
    const nextDefs = handoff.simDefs.map(d => ({ ...d, params: { ...d.params } }));
    const nextEdges = handoff.flowEdges.map(e => ({ ...e }));
    const nextMethod = normalizePropertyMethod(handoff.thermoMethod);
    const nextComps = mergeFeedComponents(
      nextDefs,
      Array.isArray(handoff.activeComponents) && handoff.activeComponents.length > 0
        ? (handoff.activeComponents.filter(c => SIM_COMPS.includes(c)) as SimCompKey[])
        : getPlantDefaultComponents('classic_sim')
    );
    skipDirtyRef.current = true;
    setSimDefs(nextDefs);
    setFlowEdges(nextEdges);
    setThermoMethod(nextMethod);
    setActiveComponents(nextComps);
    setRfNodes(
      nextDefs.map((d, idx) => ({
        id: d.id,
        type: 'classicBlock',
        position: handoff.positions?.[d.id] ?? { x: 80 + idx * 170, y: 140 },
        data: { tag: d.tag, modelName: getModelName(d.unitType), unitType: d.unitType },
      }))
    );
    setSolvedMeta({
      result: createIdleFlowsheetResult(nextDefs, nextEdges, {
        propertyMethod: nextMethod,
        activeComponents: nextComps,
      }),
      elapsedMs: 0,
      lastRunTime: '모던 UI에서 인계됨 (▶ Run 대기)',
    });
    setIsDirty(true);
    setSelectedKind('block');
    setSelectedId(nextDefs[0]?.id ?? null);
    setActiveMdiKey('pfd');
    setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 220 }), 80);
  }, [rfInstance]);

  const switchToModernUi = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    rfNodes.forEach(n => {
      positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    });
    saveUiSwitchHandoff({
      fromUi: 'classic',
      simDefs,
      flowEdges,
      positions,
      activeComponents,
      thermoMethod,
    });
    setPreferredSimUiMode('modern');
    setActivePlantId('new_builder');
    router.push('/flowsheet-simulator');
  }, [activeComponents, flowEdges, rfNodes, router, setActivePlantId, simDefs, thermoMethod]);

  useEffect(() => {
    const onReqSwitch = (ev: Event) => {
      const detail = (ev as CustomEvent<{ targetUi?: string }>).detail;
      if (detail?.targetUi === 'modern') {
        switchToModernUi();
      }
    };
    window.addEventListener('chemplant:request-ui-switch', onReqSwitch);
    return () => window.removeEventListener('chemplant:request-ui-switch', onReqSwitch);
  }, [switchToModernUi]);

  const handleOpenMdiTab = useCallback((tab: ClassicMdiTab) => {
    setMdiTabs(prev => (prev.some(t => t.key === tab.key) ? prev : [...prev, tab]));
    setActiveMdiKey(tab.key);
    if (tab.kind === 'summary') setBottomView('summary');
    else if (tab.kind === 'pfd') setBottomView('pfd');
    if (tab.kind === 'block' && tab.refId) {
      setSelectedKind('block');
      setSelectedId(tab.refId);
    } else if (tab.kind === 'stream' && tab.refId) {
      setSelectedKind('stream');
      setSelectedId(tab.refId);
    }
  }, []);

  const handleCloseMdiTab = useCallback(
    (key: string) => {
      setMdiTabs(prev => prev.filter(t => t.key !== key));
      if (activeMdiKey === key) {
        setActiveMdiKey('pfd');
        setBottomView('pfd');
      }
    },
    [activeMdiKey]
  );

  const handleResetResults = useCallback(() => {
    setSolvedMeta({
      result: createIdleFlowsheetResult(simDefs, flowEdges, {
        propertyMethod: thermoMethod,
        activeComponents,
      }),
      elapsedMs: 0,
      lastRunTime: '초기화됨 (▶ Run 대기)',
    });
    setIsDirty(true);
  }, [activeComponents, flowEdges, simDefs, thermoMethod]);

  const handleNextStep = useCallback(() => {
    const emptyFeed = simDefs.find(d => {
      if (d.unitType !== 'feed') return false;
      const sum = Object.values(d.params.feedFlowsKgH ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
      return sum <= 0;
    });
    if (emptyFeed) {
      setSelectedKind('block');
      setSelectedId(emptyFeed.id);
      if (isMobile) setMobilePane('form');
      return;
    }
    if (flowEdges.length === 0) {
      setActiveMdiKey('pfd');
      setBottomView('pfd');
      if (isMobile) setMobilePane('pfd');
      return;
    }
    if (isDirty || solvedMeta.result.convergence.isIdle) {
      runSimulation();
      return;
    }
    handleOpenMdiTab({ key: 'summary', kind: 'summary', title: 'Stream Summary' });
  }, [flowEdges.length, handleOpenMdiTab, isDirty, isMobile, runSimulation, simDefs, solvedMeta.result.convergence.isIdle]);

  const handleLoadPlantPreset = useCallback(
    async (presetKey: string) => {
      const [groupRaw, sheetId] = presetKey.split(':');
      const group = (groupRaw === 'hcl1A' || groupRaw === 'ech' ? groupRaw : 'electrolysis') as
        | 'electrolysis'
        | 'hcl1A'
        | 'ech';
      const sheets = getPlantSheetsByGroup(group);
      const rawSheet = sheets[sheetId];
      if (!rawSheet) return;
      const bundle = await fetchConvergedBaselinesBundle();
      const bEntry = bundle?.plants?.[group]?.[sheetId];
      const nextDefs = (bEntry?.simDefs ?? rawSheet.simDefs).map(d => ({ ...d, params: { ...d.params } }));
      const nextEdges = (bEntry?.flowEdges ?? rawSheet.flowEdges).map(e => ({ ...e }));
      const plantContext =
        group === 'hcl1A' ? 'hcl_1a_plant' : group === 'ech' ? 'ech_gte_plant' : 'electrolyzer_plant';
      const nextComps = mergeFeedComponents(nextDefs, getPlantDefaultComponents(plantContext));

      skipDirtyRef.current = true;
      setSimDefs(nextDefs);
      setFlowEdges(nextEdges);
      setActiveComponents(nextComps);
      setRfNodes(
        nextDefs.map((d, idx) => ({
          id: d.id,
          type: 'classicBlock',
          position: rawSheet.positions?.[d.id] ?? { x: 80 + idx * 170, y: 140 },
          data: { tag: d.tag, modelName: getModelName(d.unitType), unitType: d.unitType },
        }))
      );
      if (bEntry?.result && !bEntry.result.convergence?.isIdle) {
        setSolvedMeta({
          result: bEntry.result,
          elapsedMs: bEntry.elapsedMs ?? 1,
          lastRunTime: bEntry.lastRunTime || '사전 수렴 기준케이스',
        });
        setIsDirty(false);
      } else {
        runSimulation(nextDefs, nextEdges, thermoMethod, nextComps, tearMethod);
      }
      setActiveMdiKey('pfd');
      setBottomView('pfd');
      setSelectedKind('block');
      setSelectedId(nextDefs[0]?.id ?? null);
      setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 220 }), 80);
    },
    [rfInstance, runSimulation, tearMethod, thermoMethod]
  );

  const solved = solvedMeta.result;
  const streamResultMap = useMemo(() => {
    const m = new Map<string, (typeof solved.streams)[number]>();
    solved.streams.forEach(s => m.set(s.edgeId, s));
    return m;
  }, [solved.streams]);
  const unitResultMap = useMemo(() => {
    const m = new Map<string, (typeof solved.units)[number]>();
    solved.units.forEach(u => m.set(u.nodeId, u));
    return m;
  }, [solved.units]);

  // 캔버스 표시용 노드 & 엣지 동기화
  const displayNodes = useMemo(() => {
    return rfNodes.map(n => {
      const def = simDefs.find(d => d.id === n.id);
      const uRes = unitResultMap.get(n.id);
      const metric = uRes
        ? uRes.inletMassKgH > 0
          ? `${uRes.inletMassKgH.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg/h`
          : def?.unitType === 'feed' && uRes.outletMassKgH > 0
            ? `${uRes.outletMassKgH.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg/h`
            : ''
        : '';
      const dr = uRes?.distillResult;
      const hasDistillErr = Boolean(
        dr &&
          (!dr.converged ||
            (dr.shortcutDesign && !dr.shortcutDesign.designMet) ||
            (dr.spec1Status?.enabled && !dr.spec1Status.met) ||
            (dr.spec2Status?.enabled && !dr.spec2Status.met))
      );
      const hasMassErr = Boolean(uRes && Math.abs(uRes.massImbalanceKgH) > 1.0);
      const hasFlow = Boolean(uRes && (uRes.inletMassKgH > 0.01 || uRes.outletMassKgH > 0.01));
      const status: 'ok' | 'error' | 'idle' =
        hasMassErr || hasDistillErr ? 'error' : hasFlow ? 'ok' : 'idle';
      const statusTitle =
        hasMassErr
          ? `물질수지 오차 (${uRes!.massImbalanceKgH.toFixed(1)} kg/h)`
          : hasDistillErr
            ? '증류탑 미수렴 또는 목표 스펙 미달'
            : hasFlow
              ? '수렴 완료'
              : '연결 대기';
      return {
        ...n,
        selected: selectedKind === 'block' && selectedId === n.id,
        data: {
          tag: def?.tag ?? n.data.tag,
          modelName: getModelName(def?.unitType ?? n.data.unitType),
          unitType: def?.unitType ?? n.data.unitType,
          status,
          statusTitle,
          liveMetric: metric,
        },
      };
    });
  }, [rfNodes, simDefs, unitResultMap, selectedKind, selectedId]);

  const displayEdges: Edge[] = useMemo(() => {
    return flowEdges.map(e => {
      const st = streamResultMap.get(e.id);
      const isSel = selectedKind === 'stream' && selectedId === e.id;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourcePort || undefined,
        targetHandle: e.targetPort || undefined,
        type: 'classicStream',
        selected: isSel,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: isSel ? '#DC2626' : '#003399',
        },
        data: {
          streamNo: e.streamNo,
          tempC: st?.tempC,
          pressKgcm2g: st?.pressKgcm2g,
          massFlowKgH: st?.totalMassKgH,
          vaporFrac: st?.vaporFraction,
          showCallout: showStreamCallouts,
          isSolved: Boolean(st && !solved.convergence.isIdle),
          orthogonal: orthogonalEdges,
        },
      };
    });
  }, [flowEdges, orthogonalEdges, selectedId, selectedKind, showStreamCallouts, solved.convergence.isIdle, streamResultMap]);

  // 블록 추가 (팔레트 클릭 또는 드래그 드롭)
  const addBlockAt = useCallback(
    (unitType: FlowUnitType, pos?: { x: number; y: number }) => {
      const item = CLASSIC_MODEL_CATALOG.find(m => m.unitType === unitType);
      const prefix = item?.defaultPrefix ?? 'B';
      const count = simDefs.filter(d => d.unitType === unitType).length + 1;
      const id = `blk_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const tag = `${prefix}-${100 + count}`;
      const newDef: FlowNodeDef = {
        id,
        tag,
        name: item ? `${item.modelName} (${item.koName})` : unitType,
        unitType,
        params: defaultParamsForClassic(unitType),
      };
      const finalPos = pos ?? {
        x: 140 + (simDefs.length % 4) * 165,
        y: 100 + Math.floor(simDefs.length / 4) * 120,
      };
      setSimDefs(prev => [...prev, newDef]);
      setRfNodes(prev => [
        ...prev,
        {
          id,
          type: 'classicBlock',
          position: finalPos,
          data: { tag, modelName: getModelName(unitType), unitType },
        },
      ]);
      setSelectedKind('block');
      setSelectedId(id);
    },
    [simDefs]
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const nextNo = `S${flowEdges.length + 1}`;
      const newEdge: FlowEdgeDef = {
        id: `ce_${Date.now()}`,
        streamNo: nextNo,
        source: conn.source,
        target: conn.target,
        sourcePort: (conn.sourceHandle as SourcePortId) || 'out',
        targetPort: (conn.targetHandle as TargetPortId) || 'in',
      };
      setFlowEdges(prev => [...prev, newEdge]);
      setSelectedKind('stream');
      setSelectedId(newEdge.id);
    },
    [flowEdges.length]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const unitType = e.dataTransfer.getData('application/classic-unit') as FlowUnitType;
      if (!unitType || !rfInstance) return;
      const pos = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addBlockAt(unitType, pos);
    },
    [rfInstance, addBlockAt]
  );

  const updateBlockDef = useCallback((nodeId: string, updater: (d: FlowNodeDef) => FlowNodeDef) => {
    setSimDefs(prev => prev.map(d => (d.id === nodeId ? updater(d) : d)));
  }, []);

  const deleteBlock = useCallback((nodeId: string) => {
    setSimDefs(prev => prev.filter(d => d.id !== nodeId));
    setRfNodes(prev => prev.filter(n => n.id !== nodeId));
    setFlowEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedId(null);
  }, []);

  const deleteEdge = useCallback((edgeId: string) => {
    setFlowEdges(prev => prev.filter(e => e.id !== edgeId));
    setSelectedId(null);
  }, []);

  const loadExample = (ex: ClassicExampleCase) => {
    const nextDefs = ex.nodes.map(({ position: _p, ...d }) => ({ ...d, params: { ...d.params } }));
    const nextEdges = ex.edges.map(e => ({ ...e }));
    const nextComps = mergeFeedComponents(nextDefs, activeComponents);
    skipDirtyRef.current = true;
    setSimDefs(nextDefs);
    setActiveComponents(nextComps);
    setRfNodes(
      ex.nodes.map(n => ({
        id: n.id,
        type: 'classicBlock',
        position: { ...n.position },
        data: { tag: n.tag, modelName: getModelName(n.unitType), unitType: n.unitType },
      }))
    );
    setFlowEdges(nextEdges);
    setSolvedMeta({
      result: createIdleFlowsheetResult(nextDefs, nextEdges, {
        propertyMethod: thermoMethod,
        activeComponents: nextComps,
      }),
      elapsedMs: 0,
      lastRunTime: '미실행 (▶ Run 대기)',
    });
    setIsDirty(true);
    setSelectedKind('block');
    setSelectedId(nextDefs[0]?.id ?? null);
    setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 220 }), 80);
  };

  const clearBlank = () => {
    skipDirtyRef.current = true;
    setSimDefs([]);
    setRfNodes([]);
    setFlowEdges([]);
    setSolvedMeta({
      result: createIdleFlowsheetResult([], []),
      elapsedMs: 0,
      lastRunTime: '미실행 (▶ Run 대기)',
    });
    setIsDirty(true);
    setSelectedId(null);
  };

  const saveProject = () => {
    const name = projectNameInput.trim() || `Classic_Sim_${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
    const positions: Record<string, { x: number; y: number }> = {};
    rfNodes.forEach(n => {
      positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    });
    const item: SavedClassicProject = {
      id: `cp_${Date.now()}`,
      name,
      savedAt: new Date().toLocaleString('ko-KR', { hour12: false }),
      simDefs,
      positions,
      flowEdges,
      thermoMethod,
      activeComponents,
    };
    const next = [item, ...savedProjects];
    setSavedProjects(next);
    setProjectNameInput('');
    try {
      localStorage.setItem(CLASSIC_PROJECTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const loadSavedProject = (p: SavedClassicProject) => {
    skipDirtyRef.current = true;
    const nextMethod = normalizePropertyMethod(p.thermoMethod);
    const baseComps = Array.isArray(p.activeComponents) && p.activeComponents.length > 0
      ? (p.activeComponents.filter(c => SIM_COMPS.includes(c)) as SimCompKey[])
      : activeComponents;
    const nextComps = mergeFeedComponents(p.simDefs, baseComps);
    setSimDefs(p.simDefs);
    setFlowEdges(p.flowEdges);
    setThermoMethod(nextMethod);
    setActiveComponents(nextComps);
    setRfNodes(
      p.simDefs.map((d, i) => ({
        id: d.id,
        type: 'classicBlock',
        position: p.positions?.[d.id] ?? { x: 80 + i * 170, y: 130 },
        data: { tag: d.tag, modelName: getModelName(d.unitType), unitType: d.unitType },
      }))
    );
    setSolvedMeta({
      result: createIdleFlowsheetResult(p.simDefs, p.flowEdges, {
        propertyMethod: nextMethod,
        activeComponents: nextComps,
      }),
      elapsedMs: 0,
      lastRunTime: '미실행 (▶ Run 대기)',
    });
    setIsDirty(true);
    setSelectedKind('block');
    setSelectedId(p.simDefs[0]?.id ?? null);
    setShowProjectBar(false);
    setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 220 }), 80);
  };

  const deleteSavedProject = (id: string) => {
    const next = savedProjects.filter(p => p.id !== id);
    setSavedProjects(next);
    try {
      localStorage.setItem(CLASSIC_PROJECTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const exportJson = () => {
    const positions: Record<string, { x: number; y: number }> = {};
    rfNodes.forEach(n => {
      positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    });
    const blob = new Blob([JSON.stringify({ simDefs, positions, flowEdges, thermoMethod, activeComponents }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ClassicSim_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result));
        if (parsed && Array.isArray(parsed.simDefs) && Array.isArray(parsed.flowEdges)) {
          loadSavedProject({
            id: 'import',
            name: f.name,
            savedAt: '',
            simDefs: parsed.simDefs,
            positions: parsed.positions ?? {},
            flowEdges: parsed.flowEdges,
            thermoMethod: normalizePropertyMethod(parsed.thermoMethod),
            activeComponents: Array.isArray(parsed.activeComponents) ? parsed.activeComponents : undefined,
          });
        }
      } catch {
        alert('유효한 시뮬레이션 JSON 파일이 아닙니다.');
      }
    };
    r.readAsText(f);
    e.target.value = '';
  };

  const selectedBlock = selectedKind === 'block' ? simDefs.find(d => d.id === selectedId) ?? null : null;
  const selectedBlockRes = selectedBlock ? unitResultMap.get(selectedBlock.id) : undefined;
  const selectedEdge = selectedKind === 'stream' ? flowEdges.find(e => e.id === selectedId) ?? null : null;
  const selectedStreamRes = selectedEdge ? streamResultMap.get(selectedEdge.id) : undefined;

  const hasFeed = simDefs.some(d => d.unitType === 'feed');
  const convOverall = solved.convergence.overallStatus ?? (solved.convergence.converged ? 'converged' : 'failed');
  const statusState: 'incomplete' | 'ready' | 'ok' | 'warn' | 'fail' = !hasFeed || flowEdges.length === 0
    ? 'incomplete'
    : isDirty || solved.convergence.isIdle
      ? 'ready'
      : convOverall === 'converged'
        ? 'ok'
        : convOverall === 'converged_with_warnings'
          ? 'warn'
          : 'fail';

  const filteredPalette = useMemo(
    () =>
      paletteCat === 'all'
        ? CLASSIC_MODEL_CATALOG
        : CLASSIC_MODEL_CATALOG.filter(m => m.category === paletteCat),
    [paletteCat]
  );

  // 스트림 유입원 Feed 블록 찾기 (스트림 선택 시에도 유량 직접 편집 지원!)
  const selectedEdgeSourceFeed = useMemo(() => {
    if (!selectedEdge) return null;
    const src = simDefs.find(d => d.id === selectedEdge.source);
    return src?.unitType === 'feed' ? src : null;
  }, [selectedEdge, simDefs]);

  const blockStatusMap = useMemo(() => {
    const m = new Map<string, 'ok' | 'err' | 'incomplete'>();
    for (const d of simDefs) {
      if (d.unitType === 'feed') {
        const tot = Object.values(d.params.feedFlowsKgH ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
        m.set(d.id, tot > 0 ? 'ok' : 'err');
        continue;
      }
      const uRes = unitResultMap.get(d.id);
      if (!uRes || solved.convergence.isIdle) {
        m.set(d.id, 'incomplete');
      } else if (
        Math.abs(uRes.massImbalanceKgH) > 1.0 ||
        (uRes.distillResult && !uRes.distillResult.converged)
      ) {
        m.set(d.id, 'err');
      } else if (uRes.inletMassKgH > 0.01 || uRes.outletMassKgH > 0.01) {
        m.set(d.id, 'ok');
      } else {
        m.set(d.id, 'incomplete');
      }
    }
    return m;
  }, [simDefs, unitResultMap, solved.convergence.isIdle]);

  const streamMassMap = useMemo(() => {
    const m = new Map<string, number>();
    solved.streams.forEach(s => m.set(s.edgeId, s.totalMassKgH));
    return m;
  }, [solved.streams]);

  const effectiveMethodLabel =
    thermoMethod === 'AUTO'
      ? `AUTO(${solved.propertyMethodUsed ?? autoRecommended.method})`
      : thermoMethod;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minHeight: 0,
        background: '#F1F5F9',
        color: '#0F172A',
        overflow: 'hidden',
      }}
    >
      {/* ── 상단 클래식 데스크톱 Multi-Tab 리본 툴바 ── */}
      <ClassicRibbon
        ribbonTab={ribbonTab}
        setRibbonTab={setRibbonTab}
        isMobile={isMobile}
        showExplorer={showExplorer}
        setShowExplorer={setShowExplorer}
        showPalette={showPalette}
        setShowPalette={setShowPalette}
        showControlPanel={showControlPanel}
        setShowControlPanel={setShowControlPanel}
        showStreamCallouts={showStreamCallouts}
        setShowStreamCallouts={setShowStreamCallouts}
        orthogonalEdges={orthogonalEdges}
        setOrthogonalEdges={setOrthogonalEdges}
        isSimRunning={isSimRunning}
        onRun={() => runSimulation()}
        onReset={handleResetResults}
        onNextStep={handleNextStep}
        thermoMethod={thermoMethod}
        onChangeThermo={m => setThermoMethod(m)}
        tearMethod={tearMethod}
        onChangeTearMethod={tr => {
          setTearMethod(tr);
          runSimulation(simDefs, flowEdges, thermoMethod, activeComponents, tr);
        }}
        onOpenCompSetup={() => setCompModalOpen(true)}
        onOpenOptModal={() => setOptModalOpen(true)}
        onFitView={() => rfInstance?.fitView({ padding: 0.14, duration: 220 })}
        onClearBlank={clearBlank}
        onOpenSaveBar={() => setShowProjectBar(v => !v)}
        onExportJson={exportJson}
        onSwitchToModernUi={switchToModernUi}
        examples={CLASSIC_EXAMPLES.map(x => ({ id: x.id, label: x.label }))}
        onSelectExample={exId => {
          const found = CLASSIC_EXAMPLES.find(x => x.id === exId);
          if (found) loadExample(found);
        }}
        plantPresets={plantPresets}
        onSelectPlantPreset={key => void handleLoadPlantPreset(key)}
      />

      {/* ── 모바일 뷰 전환 바 + 수렴 상태 배지 ── */}
      {isMobile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            background: '#FFFFFF',
            borderBottom: '1px solid #CBD5E1',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', background: '#E2E8F0', padding: 2, borderRadius: 6, gap: 2 }}>
            {(
              [
                { id: 'pfd', label: '도면' },
                { id: 'tree', label: '트리' },
                { id: 'form', label: '입력' },
                { id: 'summary', label: '요약표' },
              ] as const
            ).map(t => (
              <button
                key={t.id}
                onClick={() => setMobilePane(t.id)}
                style={{
                  padding: '3px 7px',
                  fontSize: 10.5,
                  fontWeight: 800,
                  borderRadius: 4,
                  border: 'none',
                  background: mobilePane === t.id ? '#1E293B' : 'transparent',
                  color: mobilePane === t.id ? '#FFFFFF' : '#475569',
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowProjectBar(v => !v)}
            style={{
              padding: '3px 8px',
              fontSize: 10.5,
              fontWeight: 700,
              borderRadius: 4,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
            }}
          >
            💾 저장·열기
          </button>
        </div>
      )}

      {/* ── 저장/열기 바 ── */}
      {showProjectBar && (
        <div
          style={{
            padding: '8px 12px',
            background: '#F8FAFC',
            borderBottom: '1px solid #CBD5E1',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={projectNameInput}
                onChange={e => setProjectNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveProject();
                }}
                placeholder="시뮬레이션 이름 입력..."
                style={{
                  height: 26,
                  padding: '0 8px',
                  fontSize: 11,
                  borderRadius: 5,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  minWidth: 190,
                }}
              />
              <button
                onClick={saveProject}
                style={{
                  height: 26,
                  padding: '0 10px',
                  fontSize: 11,
                  fontWeight: 800,
                  borderRadius: 5,
                  border: '1px solid #1E293B',
                  background: '#1E293B',
                  color: '#FFFFFF',
                  cursor: 'pointer',
                }}
              >
                + 저장
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={exportJson}
                style={{
                  padding: '3px 8px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 5,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  cursor: 'pointer',
                }}
              >
                ⬇ JSON 내보내기
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '3px 8px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 5,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  cursor: 'pointer',
                }}
              >
                📂 JSON 열기
              </button>
              <input ref={fileInputRef} type="file" accept=".json" onChange={importJson} style={{ display: 'none' }} />
            </div>
          </div>
          {savedProjects.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {savedProjects.map(p => (
                <div
                  key={p.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    background: '#FFFFFF',
                    border: '1px solid #CBD5E1',
                    borderRadius: 5,
                    padding: '2px 7px',
                    fontSize: 11,
                  }}
                >
                  <b>{p.name}</b>
                  <button
                    onClick={() => loadSavedProject(p)}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 4,
                      border: '1px solid #1D4ED8',
                      background: '#EFF6FF',
                      color: '#1D4ED8',
                      cursor: 'pointer',
                    }}
                  >
                    열기
                  </button>
                  <button
                    onClick={() => deleteSavedProject(p.id)}
                    style={{
                      fontSize: 10,
                      border: 'none',
                      background: 'transparent',
                      color: '#94A3B8',
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 메인 3단 워크스페이스: 좌측 탐색 트리 | 중앙 PFD+팔레트 | 우측 입력/결과 폼 ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* 1) 좌측 시뮬레이션 탐색 트리 */}
        {((!isMobile && showExplorer) || (isMobile && mobilePane === 'tree')) && (
          <div
            style={{
              width: isMobile ? '100%' : 230,
              borderRight: isMobile ? 'none' : '1px solid #CBD5E1',
              flexShrink: 0,
              minHeight: 0,
              display: 'flex',
            }}
          >
            <ClassicExplorerTree
              activeComponentsCount={activeComponents.length}
              totalComponentsCount={SIM_COMPS.length}
              effectiveMethodLabel={effectiveMethodLabel}
              simDefs={simDefs}
              flowEdges={flowEdges}
              selectedKind={selectedKind}
              selectedId={selectedId}
              activeTabKey={activeMdiKey}
              blockStatusMap={blockStatusMap}
              streamMassMap={streamMassMap}
              getModelName={getModelName}
              onSelectCompSetup={() => {
                setSelectedKind('setup_comp');
                if (isMobile) setMobilePane('form');
              }}
              onSelectMethodSetup={() => {
                setSelectedKind('setup_method');
                if (isMobile) setMobilePane('form');
              }}
              onOpenMdiTab={tab => {
                handleOpenMdiTab(tab);
                if (isMobile) {
                  setMobilePane(tab.kind === 'summary' ? 'summary' : 'pfd');
                }
              }}
              onSelectStream={edgeId => {
                setSelectedKind('stream');
                setSelectedId(edgeId);
                if (isMobile) setMobilePane('form');
              }}
              onSelectBlock={nodeId => {
                setSelectedKind('block');
                setSelectedId(nodeId);
                if (isMobile) setMobilePane('form');
              }}
            />
          </div>
        )}

        {/* 2) 중앙 MDI 워크스페이스 (Main Flowsheet / Stream Summary / Control Panel / Block·Stream Datasheet) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {!isMobile && (
            <div
              className="no-scrollbar"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: '3px 8px 0',
                background: '#E2E8F0',
                borderBottom: '1px solid #CBD5E1',
                overflowX: 'auto',
                flexShrink: 0,
              }}
            >
              {mdiTabs.map(tab => {
                const isAct = activeMdiKey === tab.key;
                const closable = tab.kind === 'block' || tab.kind === 'stream';
                return (
                  <div
                    key={tab.key}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      borderRadius: '4px 4px 0 0',
                      border: isAct ? '1px solid #CBD5E1' : '1px solid transparent',
                      borderBottom: isAct ? '1px solid #FFFFFF' : 'none',
                      background: isAct ? '#FFFFFF' : '#F1F5F9',
                      color: isAct ? '#003399' : '#475569',
                      fontSize: 11,
                      fontWeight: isAct ? 800 : 600,
                      cursor: 'pointer',
                      marginBottom: -1,
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => handleOpenMdiTab(tab)}
                  >
                    <span>
                      {tab.kind === 'pfd'
                        ? '📐'
                        : tab.kind === 'summary'
                          ? '📊'
                          : tab.kind === 'control'
                            ? '🖥'
                            : tab.kind === 'block'
                              ? '⚙'
                              : '💧'}
                    </span>
                    <span>{tab.title}</span>
                    {closable && (
                      <button
                        type="button"
                        onClick={ev => {
                          ev.stopPropagation();
                          handleCloseMdiTab(tab.key);
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: '#64748B',
                          fontSize: 10,
                          cursor: 'pointer',
                          padding: '0 2px',
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {((!isMobile && activeMdiKey === 'pfd') || (isMobile && mobilePane === 'pfd')) && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              <div
                ref={rfWrapperRef}
                onDrop={handleDrop}
                onDragOver={e => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                style={{ flex: 1, minHeight: 0, position: 'relative', background: '#FFFFFF' }}
              >
                <ReactFlow
                  nodes={displayNodes}
                  edges={displayEdges}
                  nodeTypes={NODE_TYPES}
                  edgeTypes={EDGE_TYPES}
                  connectionMode={ConnectionMode.Loose}
                  onInit={inst => {
                    setRfInstance(inst);
                    setTimeout(() => inst.fitView({ padding: 0.14, duration: 200 }), 100);
                  }}
                  onNodesChange={onNodesChange}
                  onConnect={onConnect}
                  onNodeClick={(_, node) => {
                    setSelectedKind('block');
                    setSelectedId(node.id);
                  }}
                  onNodeDoubleClick={(_, node) => {
                    const def = simDefs.find(d => d.id === node.id);
                    if (def?.unitType === 'distillation') {
                      setDistillModalNodeId(def.id);
                    } else if (
                      def?.unitType === 'hex' ||
                      def?.unitType === 'cooler' ||
                      def?.unitType === 'liquefier'
                    ) {
                      setHxModalView('thermal');
                      setHxModalNodeId(def.id);
                    } else if (def?.unitType === 'reactor') {
                      setReactorModalNodeId(def.id);
                    } else if (def) {
                      handleOpenMdiTab({ key: `block:${def.id}`, kind: 'block', title: def.tag, refId: def.id });
                      if (isMobile) setMobilePane('form');
                    }
                  }}
                  onEdgeClick={(_, edge) => {
                    setSelectedKind('stream');
                    setSelectedId(edge.id);
                  }}
                  onEdgesDelete={deleted => {
                    const setDel = new Set(deleted.map(d => d.id));
                    setFlowEdges(prev => prev.filter(e => !setDel.has(e.id)));
                  }}
                  deleteKeyCode={['Backspace', 'Delete']}
                  fitView
                >
                  <Background color="#E2E8F0" gap={20} />
                  <Controls position="bottom-right" />
                </ReactFlow>

                {simDefs.length === 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '44%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      textAlign: 'center',
                      color: '#64748B',
                      pointerEvents: 'none',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                      빈 플로우시트 캔버스
                    </div>
                    <div style={{ fontSize: 11.5 }}>
                      하단 Model Palette에서 블록을 클릭하거나 드래그하여 공정도를 구성하거나, 상단 Ribbon에서 상용 공정 케이스를 불러오세요.
                    </div>
                  </div>
                )}
              </div>

              {/* 하단 Model Palette */}
              {showPalette && (
                <div
                  style={{
                    background: '#FFFFFF',
                    borderTop: '1px solid #CBD5E1',
                    display: 'flex',
                    flexDirection: 'column',
                    flexShrink: 0,
                  }}
                >
                  <div
                    className="no-scrollbar"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 8px',
                      background: '#F1F5F9',
                      borderBottom: '1px solid #E2E8F0',
                      overflowX: 'auto',
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginRight: 4, whiteSpace: 'nowrap' }}>
                      Model Palette
                    </span>
                {CLASSIC_MODEL_CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setPaletteCat(c.id)}
                    style={{
                      padding: '2px 8px',
                      fontSize: 10.5,
                      fontWeight: paletteCat === c.id ? 800 : 600,
                      borderRadius: 4,
                      border: 'none',
                      background: paletteCat === c.id ? '#1E293B' : 'transparent',
                      color: paletteCat === c.id ? '#FFFFFF' : '#475569',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div
                className="no-scrollbar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  overflowX: 'auto',
                }}
              >
                {filteredPalette.map(item => (
                  <div
                    key={item.unitType}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('application/classic-unit', item.unitType)}
                    onClick={() => addBlockAt(item.unitType)}
                    title={`${item.modelName} (${item.koName}): 클릭 또는 드래그하여 추가`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 74,
                      padding: '5px 7px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      background: '#FFFFFF',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <ClassicUnitSvg unitType={item.unitType} size={34} />
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                      {item.modelName}
                    </span>
                    <span style={{ fontSize: 9, color: '#64748B' }}>{item.koName}</span>
                  </div>
                ))}
              </div>
            </div>
            )}
          </div>
          )}

          {/* Stream Summary 전체 표 뷰 */}
          {((!isMobile && activeMdiKey === 'summary') || (isMobile && mobilePane === 'summary')) && (
          <div style={{ flex: 1, overflow: 'auto', background: '#FFFFFF', padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 8 }}>
              Stream Summary (전체 스트림 물질·열수지 일람표)
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace' }}>
                <thead>
                  <tr style={{ background: '#F1F5F9', borderBottom: '2px solid #CBD5E1' }}>
                    <th style={{ padding: '7px 10px', textAlign: 'left' }}>Stream</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left' }}>From → To</th>
                    <th style={{ padding: '7px 10px', textAlign: 'center' }}>Phase</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right' }}>Temp (°C)</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right' }}>Press (kgf/cm²G)</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right' }}>Mass Flow (kg/h)</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left' }}>Composition (wt%)</th>
                  </tr>
                </thead>
                <tbody>
                  {solved.streams.map(st => {
                    const edge = flowEdges.find(e => e.id === st.edgeId);
                    const srcTag = simDefs.find(d => d.id === edge?.source)?.tag ?? '—';
                    const dstTag = simDefs.find(d => d.id === edge?.target)?.tag ?? '—';
                    const comps = (Object.entries(st.flowsKgH) as [string, number][])
                      .filter(([, v]) => v > 0.05)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([k, v]) => `${k} ${st.totalMassKgH > 0 ? ((v / st.totalMassKgH) * 100).toFixed(1) : '0'}%`)
                      .join(' · ');
                    return (
                      <tr
                        key={st.edgeId}
                        onClick={() => {
                          setSelectedKind('stream');
                          setSelectedId(st.edgeId);
                          if (isMobile) setMobilePane('form');
                        }}
                        style={{
                          borderBottom: '1px solid #E2E8F0',
                          cursor: 'pointer',
                          background: selectedKind === 'stream' && selectedId === st.edgeId ? '#EFF6FF' : '#FFFFFF',
                        }}
                      >
                        <td style={{ padding: '6px 10px', fontWeight: 800, color: '#1D4ED8' }}>{st.streamNo}</td>
                        <td style={{ padding: '6px 10px' }}>{srcTag} → {dstTag}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>{st.phase}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{st.tempC.toFixed(1)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{st.pressKgcm2g.toFixed(2)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 800 }}>
                          {st.totalMassKgH.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                        <td style={{ padding: '6px 10px', fontFamily: 'Inter, sans-serif', color: '#334155' }}>
                          {comps || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

          {/* Control Panel / Convergence Report MDI 탭 뷰 */}
          {!isMobile && activeMdiKey === 'control' && (
            <div style={{ flex: 1, overflow: 'auto', background: '#FFFFFF', padding: 12 }}>
              <ConvergenceReportPanel
                convergence={solved.convergence}
                balance={solved.balance}
                elapsedMs={solvedMeta.elapsedMs}
                onClose={() => handleOpenMdiTab({ key: 'pfd', kind: 'pfd', title: 'Main Flowsheet' })}
                onSelectNode={nodeId => {
                  setSelectedKind('block');
                  setSelectedId(nodeId);
                  handleOpenMdiTab({ key: 'pfd', kind: 'pfd', title: 'Main Flowsheet' });
                }}
              />
            </div>
          )}

          {/* Block MDI Datasheet 탭 뷰 */}
          {!isMobile && activeMdiKey.startsWith('block:') && (() => {
            const bId = activeMdiKey.slice(6);
            const blk = simDefs.find(d => d.id === bId);
            const bRes = unitResultMap.get(bId);
            if (!blk) return null;
            const inEdges = flowEdges.filter(e => e.target === bId);
            const outEdges = flowEdges.filter(e => e.source === bId);
            return (
              <div style={{ flex: 1, overflow: 'auto', background: '#FFFFFF', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid #E2E8F0', paddingBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: '#003399' }}>
                      {blk.tag} — {getModelName(blk.unitType)} Datasheet
                    </div>
                    <div style={{ fontSize: 11, color: '#64748B' }}>{blk.name}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {blk.unitType === 'distillation' && (
                      <button type="button" onClick={() => setDistillModalNodeId(blk.id)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #1D4ED8', background: '#1D4ED8', color: '#FFFFFF', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                        Rigorous Column Workbench
                      </button>
                    )}
                    {(blk.unitType === 'hex' || blk.unitType === 'cooler' || blk.unitType === 'liquefier') && (
                      <button type="button" onClick={() => { setHxModalView('thermal'); setHxModalNodeId(blk.id); }} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #0284C7', background: '#0284C7', color: '#FFFFFF', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                        Heat Exchanger Sizing
                      </button>
                    )}
                    {blk.unitType === 'reactor' && (
                      <button type="button" onClick={() => setReactorModalNodeId(blk.id)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #B91C1C', background: '#B91C1C', color: '#FFFFFF', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                        Reactor Workbench
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
                  <div style={{ padding: 10, border: '1px solid #CBD5E1', borderRadius: 5, background: '#F8FAFC' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>Inlet / Outlet Streams</div>
                    <div style={{ fontSize: 11, color: '#334155' }}>In: {inEdges.map(e => e.streamNo).join(', ') || 'None'}</div>
                    <div style={{ fontSize: 11, color: '#334155', marginTop: 3 }}>Out: {outEdges.map(e => e.streamNo).join(', ') || 'None'}</div>
                  </div>
                  <div style={{ padding: 10, border: '1px solid #CBD5E1', borderRadius: 5, background: '#F8FAFC' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>Block Results</div>
                    <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                      Mass: {bRes ? `${bRes.inletMassKgH.toFixed(1)} -> ${bRes.outletMassKgH.toFixed(1)} kg/h` : '—'}
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                      Duty: {bRes ? `${(bRes.heatDutyKcalH / 1000).toFixed(2)} Mcal/h` : '—'} | Power: {bRes ? `${bRes.shaftPowerKW.toFixed(2)} kW` : '—'}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#475569' }}>
                  세부 입력 파라미터는 우측 Inspector 패널에서 즉시 수정할 수 있습니다.
                </div>
              </div>
            );
          })()}

          {/* Stream MDI Datasheet 탭 뷰 */}
          {!isMobile && activeMdiKey.startsWith('stream:') && (() => {
            const sId = activeMdiKey.slice(7);
            const ed = flowEdges.find(e => e.id === sId);
            const st = streamResultMap.get(sId);
            if (!ed) return null;
            return (
              <div style={{ flex: 1, overflow: 'auto', background: '#FFFFFF', padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: '#003399', marginBottom: 8 }}>
                  Stream {ed.streamNo} — Results &amp; Composition
                </div>
                {st ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace', padding: 10, background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 5 }}>
                      <span>Temp: <b>{st.tempC.toFixed(2)} °C</b></span>
                      <span>Press: <b>{st.pressKgcm2g.toFixed(3)} kgf/cm²G</b></span>
                      <span>Phase: <b>{st.phase}</b></span>
                      <span>Total: <b>{st.totalMassKgH.toFixed(2)} kg/h</b></span>
                    </div>
                    <table style={{ width: '100%', maxWidth: 520, borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                      <thead>
                        <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
                          <th style={{ padding: '5px 8px', textAlign: 'left' }}>Component</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right' }}>Mass Flow (kg/h)</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right' }}>Mass Frac (wt%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(st.flowsKgH)
                          .filter(([, v]) => (v ?? 0) > 1e-4)
                          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                          .map(([c, v]) => (
                            <tr key={c} style={{ borderBottom: '1px solid #F1F5F9' }}>
                              <td style={{ padding: '4px 8px', fontWeight: 700 }}>{c}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{(v ?? 0).toFixed(2)}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                {st.totalMassKgH > 0 ? (((v ?? 0) / st.totalMassKgH) * 100).toFixed(2) : '0.00'}%
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: '#64748B' }}>아직 계산 결과가 없습니다. ▶ Run (F5)을 실행하세요.</div>
                )}
              </div>
            );
          })()}

          {!isMobile && showControlPanel && (
            <ClassicControlPanel
              solved={solved}
              elapsedMs={solvedMeta.elapsedMs}
              lastRunTime={solvedMeta.lastRunTime}
              blockCount={simDefs.length}
              streamCount={flowEdges.length}
            />
          )}
        </div>

        {/* 3) 우측 Object Form (Setup / Stream / Block 스펙 입력 & 결과) */}
        {(!isMobile || mobilePane === 'form') && (
          <aside
            style={{
              width: isMobile ? '100%' : 300,
              background: '#FFFFFF',
              borderLeft: isMobile ? 'none' : '1px solid #CBD5E1',
              padding: '10px 12px',
              overflowY: 'auto',
              flexShrink: 0,
              fontSize: 11.5,
            }}
          >
            {selectedKind === 'setup_comp' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>
                    Components ({activeComponents.length} / {SIM_COMPS.length}종)
                  </div>
                  <button
                    onClick={() => setCompModalOpen(true)}
                    style={{
                      padding: '4px 8px',
                      fontSize: 10.5,
                      fontWeight: 800,
                      borderRadius: 5,
                      border: '1px solid #1D4ED8',
                      background: '#1D4ED8',
                      color: '#FFFFFF',
                      cursor: 'pointer',
                    }}
                  >
                    🧪 전체 설정 창 열기
                  </button>
                </div>
                <div style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.45 }}>
                  상용 공장 프리셋에서 성분을 가져오거나, 범용 공정용 검증 물질(40종)을 자유롭게 선택하세요.
                </div>

                {/* 공장 프리셋 빠른 가져오기 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 7, borderRadius: 6, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#334155' }}>🏭 공장별 성분 가져오기</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {PLANT_COMPONENT_PRESETS.map(p => (
                      <button
                        key={p.plantId}
                        onClick={() => {
                          const merged = mergeFeedComponents(simDefs, p.components);
                          setActiveComponents(merged);
                          runSimulation(simDefs, flowEdges, thermoMethod, merged);
                        }}
                        style={{
                          padding: '4px 6px',
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 4,
                          border: '1px solid #CBD5E1',
                          background: '#FFFFFF',
                          color: '#0F172A',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {p.code.replace('PLANT ', 'P')} · {p.labelKo.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 범용 스타터 팩 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 7, borderRadius: 6, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#334155' }}>🌐 범용 물질 패키지</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {GENERAL_COMPONENT_PACKS.map(pk => (
                      <button
                        key={pk.id}
                        onClick={() => {
                          const merged = mergeFeedComponents(simDefs, pk.components);
                          setActiveComponents(merged);
                          runSimulation(simDefs, flowEdges, thermoMethod, merged);
                        }}
                        style={{
                          padding: '3px 7px',
                          fontSize: 9.5,
                          fontWeight: 700,
                          borderRadius: 4,
                          border: '1px solid #CBD5E1',
                          background: '#FFFFFF',
                          color: '#334155',
                          cursor: 'pointer',
                        }}
                      >
                        {pk.labelKo.split(' (')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 340, overflowY: 'auto' }}>
                  {[...SIM_COMPS]
                    .sort((a, b) => Number(activeComponents.includes(b)) - Number(activeComponents.includes(a)))
                    .map(c => {
                      const checked = activeComponents.includes(c);
                      const cat = COMP_CATALOG_META[c];
                      return (
                        <label
                          key={c}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 6,
                            padding: '5px 8px',
                            borderRadius: 5,
                            background: checked ? '#EFF6FF' : '#F8FAFC',
                            border: checked ? '1px solid #93C5FD' : '1px solid #E2E8F0',
                            fontSize: 10.5,
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? activeComponents.filter(k => k !== c)
                                  : [...activeComponents, c];
                                if (next.length === 0) return;
                                setActiveComponents(next);
                              }}
                            />
                            <b style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0F172A' }}>{c}</b>
                          </span>
                          <span style={{ color: '#475569', fontSize: 10, textAlign: 'right' }}>
                            {COMP_META[c].label} · Tb {cat ? `${cat.tbC.toFixed(0)}°C` : '—'}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}

            {selectedKind === 'setup_method' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>
                    Property Methods (열역학 모델)
                  </div>
                  <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 999, background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0' }}>
                    엔진 실시간 적용
                  </span>
                </div>

                {/* 자동 추천 근거 배너 */}
                <div style={{ padding: '7px 9px', borderRadius: 6, background: '#EEF2FF', border: '1px solid #C7D2FE', fontSize: 10.5, lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 800, color: '#3730A3', marginBottom: 2 }}>
                    🤖 계(System) 추천: {PROPERTY_METHOD_INFO[autoRecommended.method].shortKo}
                  </div>
                  <div style={{ color: '#334155', fontSize: 10 }}>{autoRecommended.reasonKo}</div>
                </div>

                {(['AUTO', 'ENRTL', 'NRTL', 'PR', 'SRK'] as const).map(m => {
                  const info = m === 'AUTO' ? null : PROPERTY_METHOD_INFO[m];
                  const active = thermoMethod === m;
                  return (
                    <label
                      key={m}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: active ? '1.5px solid #1D4ED8' : '1px solid #CBD5E1',
                        background: active ? '#EFF6FF' : '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        checked={active}
                        onChange={() => {
                          setThermoMethod(m);
                          runSimulation(simDefs, flowEdges, m, activeComponents);
                        }}
                        style={{ marginTop: 3 }}
                      />
                      <div>
                        <div style={{ fontWeight: 800, color: '#0F172A', fontSize: 11 }}>
                          {m === 'AUTO' ? `자동 선택 (현재 → ${autoRecommended.method})` : info!.labelKo}
                        </div>
                        <div style={{ fontSize: 9.8, color: '#475569', marginTop: 2, lineHeight: 1.4 }}>
                          {m === 'AUTO'
                            ? '선택된 성분·조성·운전압력을 분석하여 최적 열역학 모델을 자동 선택합니다.'
                            : info!.bestForKo}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {selectedKind === 'stream' && selectedEdge && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 900, color: '#1D4ED8' }}>
                    Stream [{selectedEdge.streamNo}]
                  </span>
                  <button
                    onClick={() => deleteEdge(selectedEdge.id)}
                    style={{
                      padding: '3px 7px',
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 4,
                      border: '1px solid #FCA5A5',
                      background: '#FEF2F2',
                      color: '#B91C1C',
                      cursor: 'pointer',
                    }}
                  >
                    삭제
                  </button>
                </div>

                {selectedEdgeSourceFeed && (
                  <div
                    style={{
                      padding: 8,
                      borderRadius: 6,
                      background: '#F8FAFC',
                      border: '1px solid #CBD5E1',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: '#1E293B' }}>
                      원료 공급 조건 ({selectedEdgeSourceFeed.tag} 연동 입력)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        온도 (°C)
                        <input
                          type="number"
                          value={selectedEdgeSourceFeed.params.feedTempC ?? 25}
                          onChange={e =>
                            updateBlockDef(selectedEdgeSourceFeed.id, d => ({
                              ...d,
                              params: { ...d.params, feedTempC: Number(e.target.value) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                        />
                      </label>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        압력 (kgf/cm²G)
                        <input
                          type="number"
                          step="0.1"
                          value={selectedEdgeSourceFeed.params.feedPressKgcm2g ?? 1.0}
                          onChange={e =>
                            updateBlockDef(selectedEdgeSourceFeed.id, d => ({
                              ...d,
                              params: { ...d.params, feedPressKgcm2g: Number(e.target.value) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                        />
                      </label>
                    </div>
                  </div>
                )}

                {selectedStreamRes ? (
                  <div
                    style={{
                      padding: 9,
                      borderRadius: 6,
                      background: '#F8FAFC',
                      border: '1px solid #CBD5E1',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 11, color: '#0F172A' }}>
                      계산된 스트림 결과
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Phase</span>
                      <b>{selectedStreamRes.phase}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Temperature</span>
                      <b>{selectedStreamRes.tempC.toFixed(1)} °C</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Pressure</span>
                      <b>{selectedStreamRes.pressKgcm2g.toFixed(2)} kgf/cm²G</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Total Mass Flow</span>
                      <b>{selectedStreamRes.totalMassKgH.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg/h</b>
                    </div>
                    <div style={{ borderTop: '1px dashed #CBD5E1', marginTop: 4, paddingTop: 4 }}>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#475569', marginBottom: 3 }}>
                        성분별 유량 (kg/h)
                      </div>
                      {(Object.entries(selectedStreamRes.flowsKgH) as [string, number][])
                        .filter(([, v]) => v > 0.01)
                        .map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                            <span>{k}</span>
                            <span>
                              {v.toFixed(1)} ({selectedStreamRes.totalMassKgH > 0 ? ((v / selectedStreamRes.totalMassKgH) * 100).toFixed(1) : '0'}%)
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    ▶ Run을 실행하면 계산 결과가 표시됩니다.
                  </div>
                )}
              </div>
            )}

            {selectedKind === 'block' && selectedBlock && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                      {selectedBlock.tag}
                    </div>
                    <div style={{ fontSize: 10.5, color: '#475569' }}>
                      Model: {getModelName(selectedBlock.unitType)}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteBlock(selectedBlock.id)}
                    style={{
                      padding: '3px 8px',
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 4,
                      border: '1px solid #FCA5A5',
                      background: '#FEF2F2',
                      color: '#B91C1C',
                      cursor: 'pointer',
                    }}
                  >
                    블록 삭제
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <label style={{ fontSize: 10, color: '#475569' }}>
                    태그 (Tag)
                    <input
                      type="text"
                      value={selectedBlock.tag}
                      onChange={e => updateBlockDef(selectedBlock.id, d => ({ ...d, tag: e.target.value }))}
                      style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                    />
                  </label>
                  <label style={{ fontSize: 10, color: '#475569' }}>
                    명칭
                    <input
                      type="text"
                      value={selectedBlock.name}
                      onChange={e => updateBlockDef(selectedBlock.id, d => ({ ...d, name: e.target.value }))}
                      style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                    />
                  </label>
                </div>

                <PlantUnitCopyBox
                  unitType={selectedBlock.unitType}
                  nodeKey={selectedBlock.id}
                  onCopyParams={(copiedParams, tpl, includeInlet) => {
                    const unitId = selectedBlock.id;
                    updateBlockDef(unitId, d => ({ ...d, params: copiedParams }));
                    if (includeInlet && tpl.inletFeed) {
                      const inlet = tpl.inletFeed;
                      const incomingEdges = flowEdges.filter(e => e.target === unitId);
                      const feedSourceIds = new Set(
                        incomingEdges
                          .map(e => simDefs.find(d => d.id === e.source))
                          .filter((d): d is FlowNodeDef => !!d && d.unitType === 'feed')
                          .map(d => d.id)
                      );
                      if (feedSourceIds.size > 0) {
                        const feedTag = `${tpl.tag}-IN`;
                        setSimDefs(prev =>
                          prev.map(d =>
                            feedSourceIds.has(d.id)
                              ? {
                                  ...d,
                                  tag: feedTag,
                                  name: inlet.label,
                                  params: {
                                    ...d.params,
                                    feedTempC: inlet.tempC,
                                    feedPressKgcm2g: inlet.pressKgcm2g,
                                    feedFlowsKgH: emptySimFlows(inlet.flowsKgH),
                                  },
                                }
                              : d
                          )
                        );
                        setRfNodes(prev =>
                          prev.map(n =>
                            feedSourceIds.has(n.id)
                              ? {
                                  ...n,
                                  data: { ...n.data, tag: feedTag },
                                }
                              : n
                          )
                        );
                      } else if (incomingEdges.length === 0) {
                        const newFeedId = `feed_tpl_${Date.now()}`;
                        const feedTag = `${tpl.tag}-IN`;
                        const streamNo = `S${flowEdges.length + 1}`;
                        const unitRf = rfNodes.find(n => n.id === unitId);
                        const pos = {
                          x: (unitRf?.position.x ?? 320) - 220,
                          y: unitRf?.position.y ?? 200,
                        };
                        const newFeedDef: FlowNodeDef = {
                          id: newFeedId,
                          tag: feedTag,
                          name: inlet.label,
                          unitType: 'feed',
                          params: {
                            feedTempC: inlet.tempC,
                            feedPressKgcm2g: inlet.pressKgcm2g,
                            feedFlowsKgH: emptySimFlows(inlet.flowsKgH),
                          },
                        };
                        const newEdge: FlowEdgeDef = {
                          id: `ce_tpl_${Date.now()}`,
                          streamNo,
                          source: newFeedId,
                          target: unitId,
                          sourcePort: 'out',
                          targetPort: 'in',
                        };
                        setSimDefs(prev => [...prev, newFeedDef]);
                        setRfNodes(prev => [
                          ...prev,
                          {
                            id: newFeedId,
                            type: 'classicBlock',
                            position: pos,
                            data: { tag: feedTag, modelName: getModelName('feed'), unitType: 'feed' },
                          },
                        ]);
                        setFlowEdges(prev => [...prev, newEdge]);
                      }
                    }
                  }}
                />

                {/* Feed 블록 입력 */}
                {selectedBlock.unitType === 'feed' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1E293B' }}>Feed Specifications</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        온도 (°C)
                        <input
                          type="number"
                          value={selectedBlock.params.feedTempC ?? 25}
                          onChange={e =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, feedTempC: Number(e.target.value) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                        />
                      </label>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        압력 (kgf/cm²G)
                        <input
                          type="number"
                          step="0.1"
                          value={selectedBlock.params.feedPressKgcm2g ?? 1.0}
                          onChange={e =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, feedPressKgcm2g: Number(e.target.value) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                        />
                      </label>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#334155' }}>
                        성분별 질량유량 (kg/h)
                      </span>
                      <button
                        type="button"
                        onClick={() => setCompModalOpen(true)}
                        style={{
                          padding: '2px 7px',
                          fontSize: 9.5,
                          fontWeight: 800,
                          borderRadius: 4,
                          border: '1px solid #93C5FD',
                          background: '#EFF6FF',
                          color: '#1D4ED8',
                          cursor: 'pointer',
                        }}
                      >
                        + 성분 추가/설정 ({activeComponents.length}종)
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, maxHeight: 240, overflowY: 'auto' }}>
                      {SIM_COMPS.filter(
                        comp => activeComponents.includes(comp) || (selectedBlock.params.feedFlowsKgH?.[comp] ?? 0) > 0
                      ).map(comp => {
                        const val = selectedBlock.params.feedFlowsKgH?.[comp] ?? 0;
                        return (
                          <label key={comp} style={{ fontSize: 10, color: '#475569' }} title={COMP_META[comp].label}>
                            {comp}
                            <input
                              type="number"
                              min={0}
                              value={val || ''}
                              placeholder="0"
                              onChange={e => {
                                const num = Number(e.target.value) || 0;
                                updateBlockDef(selectedBlock.id, d => ({
                                  ...d,
                                  params: {
                                    ...d.params,
                                    feedFlowsKgH: { ...(d.params.feedFlowsKgH ?? {}), [comp]: num },
                                  },
                                }));
                              }}
                              style={{
                                width: '100%',
                                height: 24,
                                marginTop: 1,
                                padding: '0 5px',
                                borderRadius: 4,
                                border: val > 0 ? '1px solid #1D4ED8' : '1px solid #CBD5E1',
                                background: '#FFFFFF',
                                fontFamily: 'JetBrains Mono, monospace',
                              }}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Flash2 / Separator / Cooler / HEX */}
                {(selectedBlock.unitType === 'separator' ||
                  selectedBlock.unitType === 'cooler' ||
                  selectedBlock.unitType === 'hex' ||
                  selectedBlock.unitType === 'liquefier') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1E293B' }}>Operating Specifications</div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      목표 온도 (°C)
                      <input
                        type="number"
                        value={selectedBlock.params.operTempC ?? 30}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, operTempC: Number(e.target.value) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                    {selectedBlock.unitType === 'separator' && (
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        운전 압력 (kgf/cm²G)
                        <input
                          type="number"
                          step="0.1"
                          value={selectedBlock.params.operPressKgcm2g ?? 0.5}
                          onChange={e =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, operPressKgcm2g: Number(e.target.value) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                        />
                      </label>
                    )}
                    {(selectedBlock.unitType === 'hex' ||
                      selectedBlock.unitType === 'cooler' ||
                      selectedBlock.unitType === 'liquefier') && (
                      <button
                        onClick={() => {
                          setHxModalView('thermal');
                          setHxModalNodeId(selectedBlock.id);
                        }}
                        style={{
                          marginTop: 4,
                          padding: '6px 10px',
                          fontSize: 11,
                          fontWeight: 800,
                          borderRadius: 5,
                          border: '1px solid #1D4ED8',
                          background: '#EFF6FF',
                          color: '#1D4ED8',
                          cursor: 'pointer',
                        }}
                      >
                        열교환기 정밀 설계 & TEMA 열기 →
                      </button>
                    )}
                  </div>
                )}

                {/* Pump / Compressor */}
                {(selectedBlock.unitType === 'pump' || selectedBlock.unitType === 'compressor') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1E293B' }}>Pressure / Efficiency</div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      토출 압력 (kgf/cm²G)
                      <input
                        type="number"
                        step="0.1"
                        value={selectedBlock.params.outletPressKgcm2g ?? 3.5}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, outletPressKgcm2g: Number(e.target.value) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      효율 (0~1)
                      <input
                        type="number"
                        step="0.02"
                        min={0.1}
                        max={0.99}
                        value={selectedBlock.params.efficiency ?? 0.75}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, efficiency: Number(e.target.value) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                  </div>
                )}

                {/* FSplit */}
                {selectedBlock.unitType === 'splitter' && (
                  <div style={{ padding: 8, background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      상부(Top) 분배율 (0~1)
                      <input
                        type="number"
                        step="0.05"
                        min={0}
                        max={1}
                        value={selectedBlock.params.splitRatioTop ?? 0.5}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, splitRatioTop: Number(e.target.value) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                  </div>
                )}

                {/* RadColumn (다단 증류탑) */}
                {selectedBlock.unitType === 'distillation' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1E293B' }}>
                      RadColumn Specifications
                    </div>
                    {selectedBlockRes?.distillResult && (
                      <div style={{ fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace', color: '#0F172A' }}>
                        단수: {selectedBlockRes.distillResult.totalStagesUsed}단 (F:{selectedBlockRes.distillResult.feedStageUsed}단) · RR={selectedBlockRes.distillResult.actualRefluxRatio.toFixed(2)}
                      </div>
                    )}
                    <button
                      onClick={() => setDistillModalNodeId(selectedBlock.id)}
                      style={{
                        padding: '7px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        borderRadius: 5,
                        border: '1px solid #1D4ED8',
                        background: '#1D4ED8',
                        color: '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      다단 증류 시뮬레이터 & 인터널 설계 열기 →
                    </button>
                  </div>
                )}

                {/* Reactor (화학반응기) */}
                {selectedBlock.unitType === 'reactor' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#FEF2F2', borderRadius: 6, border: '1px solid #FECACA' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#991B1B' }}>
                      Reactor Specifications
                    </div>
                    {selectedBlock.params.reactorConfig && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: '#991B1B', fontWeight: 800 }}>
                        <span>
                          정밀 반응기 활성 ({String(selectedBlock.params.reactorConfig.model ?? 'stoic').toUpperCase()})
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, reactorConfig: undefined },
                            }))
                          }
                          style={{
                            padding: '2px 6px',
                            fontSize: 9.5,
                            fontWeight: 800,
                            borderRadius: 4,
                            border: '1px solid #FCA5A5',
                            background: '#FFFFFF',
                            color: '#B91C1C',
                            cursor: 'pointer',
                          }}
                        >
                          프리셋 복귀
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setReactorModalNodeId(selectedBlock.id)}
                      style={{
                        padding: '7px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        borderRadius: 5,
                        border: '1px solid #B91C1C',
                        background: '#B91C1C',
                        color: '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      ⚗️ 반응기 정밀설계 워크벤치 열기 →
                    </button>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      운전 온도 (°C)
                      <input
                        type="number"
                        step="1"
                        value={selectedBlock.params.operTempC ?? 180}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, operTempC: Number(e.target.value) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      전환율 (0~1)
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={1}
                        value={selectedBlock.params.conversion ?? 0.99}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, conversion: Number(e.target.value) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                  </div>
                )}

                {/* Absorber (흡수탑 · 스트리퍼) */}
                {selectedBlock.unitType === 'absorber' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#FAF5FF', borderRadius: 6, border: '1px solid #E9D5FF' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#5B21B6' }}>
                      Absorber / Stripper Specifications
                    </div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      해석 알고리즘
                      <select
                        value={selectedBlock.params.absorberCalcMode ?? 'kremser'}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: {
                              ...d.params,
                              absorberCalcMode: e.target.value as 'kremser' | 'rigorous_mesh',
                            },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', fontSize: 10.5 }}
                      >
                        <option value="kremser">Kremser / 화학흡수 수지</option>
                        <option value="rigorous_mesh">엄밀 다단 MESH 향류 기액평형</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      이론 단수 N (단)
                      <input
                        type="number"
                        step="1"
                        min={2}
                        max={50}
                        value={selectedBlock.params.columnStages ?? 8}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, columnStages: Math.max(2, Math.round(Number(e.target.value))) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                  </div>
                )}

                {/* Extractor (향류 액-액 추출탑) */}
                {selectedBlock.unitType === 'extractor' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#F5F3FF', borderRadius: 6, border: '1px solid #DDD6FE' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#6D28D9' }}>
                      LLE Extractor Specifications
                    </div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      이론 추출 단수 N
                      <input
                        type="number"
                        step="1"
                        min={1}
                        max={50}
                        value={selectedBlock.params.extractorStages ?? 6}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, extractorStages: Math.max(1, Math.min(50, Math.round(Number(e.target.value)))) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      운전 온도 (°C)
                      <input
                        type="number"
                        step="1"
                        value={selectedBlock.params.operTempC ?? 25}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, operTempC: Number(e.target.value) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                  </div>
                )}

                {/* Valve (단열 등엔탈피 감압·교축 밸브) */}
                {selectedBlock.unitType === 'valve' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#FFFBEB', borderRadius: 6, border: '1px solid #FDE68A' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#B45309' }}>
                      JT Expansion Valve (H_out = H_in)
                    </div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      후단 토출 압력 P_out (kgf/cm²G)
                      <input
                        type="number"
                        step="0.2"
                        min={-0.98}
                        value={selectedBlock.params.outletPressKgcm2g ?? 1.0}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, outletPressKgcm2g: Number(e.target.value) },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                      />
                    </label>
                  </div>
                )}

                {/* 계산 결과 요약 */}
                {selectedBlockRes && (
                  <div
                    style={{
                      padding: 9,
                      borderRadius: 6,
                      background: '#F8FAFC',
                      border: '1px solid #CBD5E1',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      fontSize: 10.5,
                    }}
                  >
                    <div style={{ fontWeight: 800, color: '#0F172A' }}>Block Results</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>유입 / 유출</span>
                      <b style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        {selectedBlockRes.inletMassKgH.toFixed(1)} / {selectedBlockRes.outletMassKgH.toFixed(1)} kg/h
                      </b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>열부하 (Duty)</span>
                      <b style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        {(selectedBlockRes.heatDutyKcalH / 1000).toFixed(1)} Mcal/h
                      </b>
                    </div>
                    {selectedBlockRes.shaftPowerKW > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>축동력 (Power)</span>
                        <b style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                          {selectedBlockRes.shaftPowerKW.toFixed(2)} kW
                        </b>
                      </div>
                    )}
                    <div style={{ color: '#475569', marginTop: 2, lineHeight: 1.4 }}>
                      {selectedBlockRes.statusNote}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!selectedBlock && !selectedEdge && selectedKind !== 'setup_comp' && selectedKind !== 'setup_method' && (
              <div style={{ fontSize: 11, color: '#64748B', padding: 12 }}>
                좌측 탐색 트리 또는 캔버스에서 스트림이나 블록을 선택하면 입력·결과 폼이 표시됩니다.
              </div>
            )}
          </aside>
        )}
      </div>

      {!isMobile && (
        <ClassicStatusBar
          statusState={statusState}
          propertyMethodLabel={effectiveMethodLabel}
          blockCount={simDefs.length}
          streamCount={flowEdges.length}
          lastRunTime={solvedMeta.lastRunTime}
          elapsedMs={solvedMeta.elapsedMs}
          activeComponentsCount={activeComponents.length}
        />
      )}

      {/* ── 내장 다단 MESH 정밀증류 워크벤치 모달 ── */}
      {distillModalNodeId && (() => {
        const modalDef = simDefs.find(d => d.id === distillModalNodeId);
        if (!modalDef || modalDef.unitType !== 'distillation') return null;
        const modalRes = unitResultMap.get(modalDef.id)?.distillResult;
        const modalCfg: DistillColumnParams = modalDef.params.distillConfig ?? {};
        const nSt = Math.max(4, Math.min(120, Math.round(modalCfg.totalStages ?? 24)));
        const defFeedSt = Math.max(2, Math.min(nSt - 1, Math.round(modalCfg.feedStage ?? Math.round(nSt * 0.5))));
        const modalFeeds: DistillFeedInput[] = flowEdges
          .filter(e => e.target === modalDef.id)
          .map(e => {
            const st = streamResultMap.get(e.id);
            return {
              edgeId: e.id,
              streamNo: e.streamNo,
              stage: defFeedSt,
              tempC: st?.tempC ?? 25,
              pressKgcm2g: st?.pressKgcm2g ?? 0.5,
              flowsKgH: st ? { ...st.flowsKgH } : ({} as DistillFeedInput['flowsKgH']),
            };
          });
        return (
          <DistillationWorkbenchModal
            open
            onClose={() => setDistillModalNodeId(null)}
            unitTag={modalDef.tag}
            unitLabel={modalDef.name}
            initialView="simulation"
            config={modalCfg}
            feeds={modalFeeds}
            result={modalRes}
            isSimDirty={isDirty}
            onRunSimulation={() => runSimulation()}
            onChangeConfig={patch => {
              const nextDefs = simDefs.map(d =>
                d.id === modalDef.id
                  ? {
                      ...d,
                      params: {
                        ...d.params,
                        calcMode: 'rigorous' as const,
                        distillConfig: { ...modalCfg, ...patch },
                      },
                    }
                  : d
              );
              setSimDefs(nextDefs);
            }}
          />
        );
      })()}

      {/* ── 내장 열교환기 워크벤치 모달 ── */}
      {hxModalNodeId && (() => {
        const modalDef = simDefs.find(d => d.id === hxModalNodeId);
        if (!modalDef) return null;
        const uRes = unitResultMap.get(modalDef.id);
        const inEdges = flowEdges.filter(e => e.target === modalDef.id);
        const outEdges = flowEdges.filter(e => e.source === modalDef.id);
        const procInStreams: SolvedStream[] = inEdges
          .filter(e => e.targetPort !== 'util_in')
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        const procOutStreams: SolvedStream[] = outEdges
          .filter(e => e.sourcePort !== 'util_out')
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        const utilInStreams: SolvedStream[] = inEdges
          .filter(e => e.targetPort === 'util_in')
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        const utilOutStreams: SolvedStream[] = outEdges
          .filter(e => e.sourcePort === 'util_out')
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        return (
          <HeatExchangerWorkbenchModal
            open
            onClose={() => setHxModalNodeId(null)}
            unitTag={modalDef.tag}
            unitLabel={modalDef.name}
            unitType={modalDef.unitType}
            initialView={hxModalView}
            params={modalDef.params}
            procInStreams={procInStreams}
            procOutStreams={procOutStreams}
            utilInStreams={utilInStreams}
            utilOutStreams={utilOutStreams}
            unitResult={uRes}
            isSimDirty={isDirty}
            onChangeParams={patch => {
              const nextDefs = simDefs.map(d =>
                d.id === modalDef.id ? { ...d, params: { ...d.params, ...patch } } : d
              );
              setSimDefs(nextDefs);
            }}
            onRunSimulation={() => runSimulation()}
          />
        );
      })()}

      {/* ── 공정 성분 & 열역학 물성 모델 설정 모달 ── */}
      <ComponentPropertySetupModal
        open={compModalOpen}
        onClose={() => setCompModalOpen(false)}
        activeComponents={activeComponents}
        propertyMethod={thermoMethod}
        currentFeedFlows={feedSummary.flows}
        maxPressKgcm2g={feedSummary.maxP}
        currentPlantContext="classic_sim"
        onApply={(nextComps, nextMethod) => {
          const merged = mergeFeedComponents(simDefs, nextComps);
          setActiveComponents(merged);
          setThermoMethod(nextMethod);
          setCompModalOpen(false);
          runSimulation(simDefs, flowEdges, nextMethod, merged);
        }}
      />

      {/* ── 플로우시트 목표역산(Design Spec) · 민감도(Sensitivity) · Broyden 수렴기 모달 ── */}
      <FlowsheetOptimizationModal
        open={optModalOpen}
        onClose={() => setOptModalOpen(false)}
        nodes={simDefs}
        edges={flowEdges}
        currentResult={solved}
        activeComponents={activeComponents}
        propertyMethod={thermoMethod}
        tearMethod={tearMethod}
        onChangeTearMethod={nextTear => {
          setTearMethod(nextTear);
          runSimulation(simDefs, flowEdges, thermoMethod, activeComponents, nextTear);
        }}
        designSpecs={designSpecs}
        onChangeDesignSpecs={setDesignSpecs}
        onApplyAdjustedNodes={adjustedNodes => {
          setSimDefs(adjustedNodes);
          runSimulation(adjustedNodes, flowEdges, thermoMethod, activeComponents, tearMethod);
        }}
      />

      {/* ── 화학반응기 5종 정밀설계 워크벤치 모달 ── */}
      {reactorModalNodeId && (() => {
        const rxDef = simDefs.find(d => d.id === reactorModalNodeId);
        if (!rxDef || rxDef.unitType !== 'reactor') return null;
        const rxInStreams = flowEdges
          .filter(e => e.target === rxDef.id)
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        const rxInFlows: Partial<Record<SimCompKey, number>> = {};
        let rxMass = 0;
        let rxWeightedT = 0;
        let rxMinP = Infinity;
        for (const s of rxInStreams) {
          rxMass += s.totalMassKgH;
          rxWeightedT += s.tempC * s.totalMassKgH;
          if (s.pressKgcm2g < rxMinP) rxMinP = s.pressKgcm2g;
          for (const c of SIM_COMPS) {
            const v = s.flowsKgH[c] ?? 0;
            if (v > 0) rxInFlows[c] = (rxInFlows[c] ?? 0) + v;
          }
        }
        const resolvedProp: ResolvedPropertyMethod =
          thermoMethod !== 'AUTO'
            ? thermoMethod
            : (solved.propertyMethodUsed ?? autoRecommended.method);
        return (
          <ReactorWorkbenchModal
            open={true}
            onClose={() => setReactorModalNodeId(null)}
            unitTag={rxDef.tag}
            unitName={rxDef.name}
            inletFlowsKgH={rxInFlows}
            inletTempC={rxMass > 1e-6 ? rxWeightedT / rxMass : (rxDef.params.operTempC ?? 120)}
            inletPressKgcm2g={Number.isFinite(rxMinP) ? rxMinP : (rxDef.params.operPressKgcm2g ?? 1.0)}
            activeComponents={activeComponents}
            propertyMethod={resolvedProp}
            initialConfig={rxDef.params.reactorConfig}
            onApplyConfig={cfg => {
              const nextDefs = simDefs.map(d =>
                d.id === rxDef.id
                  ? {
                      ...d,
                      params: {
                        ...d.params,
                        operTempC: cfg.operTempC ?? d.params.operTempC,
                        operPressKgcm2g: cfg.operPressKgcm2g ?? d.params.operPressKgcm2g,
                        reactorConfig: cfg,
                      },
                    }
                  : d
              );
              setSimDefs(nextDefs);
              setReactorModalNodeId(null);
              runSimulation(nextDefs, flowEdges, thermoMethod, activeComponents, tearMethod);
            }}
          />
        );
      })()}
    </div>
  );
}

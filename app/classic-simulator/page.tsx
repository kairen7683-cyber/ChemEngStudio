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
  SelectionMode,
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
  THERMAL_SPEC_MODE_OPTIONS,
  ELECTROLYZER_PRESET_SPECS,
  PUBLIC_REACTOR_PRESET_SPECS,
  type ThermalSpecMode,
  type ElectrolyzerPresetId,
  type PublicReactorPresetId,
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
  SaveArchiveIcon,
  FolderOpenIcon,
  DownloadFileIcon,
  PfdSchematicIcon,
  TableGridIcon,
  SlidersParamIcon,
  VesselEquipIcon,
  StreamFlowIcon,
  FlaskCompIcon,
} from '@/components/ui/EngIcons';
import {
  parseProcessTextFile,
  exportProcessTextFile,
} from '@/lib/interop/processTextInterop';
import {
  consumeUiSwitchHandoff,
  saveUiSwitchHandoff,
  setPreferredSimUiMode,
} from '@/lib/simUiHandoff';
import {
  PENDING_CASE_LOAD_KEY,
  LOAD_SAVED_CASE_EVENT,
  PROJECTS_UPDATED_EVENT,
  OPEN_SHORTCUT_CALC_EVENT,
  OPEN_SAVE_CASE_EVENT,
  consumePendingCaseLoad,
  getActiveCaseTitle,
  setActiveCaseTitle,
  notifyProjectsUpdated,
  mapFlowUnitTypeToChemProTab,
  type PendingCaseLoadPayload,
} from '@/lib/caseManagerBridge';
import CaseOutputsMenu from '@/components/layout/CaseOutputsMenu';
import {
  buildChemProHandoffPayload,
  saveChemProHandoffPayload,
} from '@/lib/calculations/unitDesignHandoff';
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
  type DistillSideCutConfig,
} from '@/lib/calculations/rigorousDistillation';
import { useAuth } from '@/components/auth/AuthContext';
import { PLANT_GROUP_TO_ID, isPlantAllowed, isSimulatorOnlyUser, showPlantNumbersForUser } from '@/lib/plantRegistry';
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
import {
  UnitNumberInput,
  UnitSelect,
  useLocalUnit,
} from '@/components/units/UnitControls';
import {
  formatCanonicalValue,
  getUnitLabel,
} from '@/lib/units/unitSystem';
import { useUnitStore } from '@/lib/stores/unitStore';
import {
  getDefaultTagPrefix,
  formatEquipmentTag,
} from '@/lib/units/tagNaming';

const CLASSIC_AUTO_SAVE_KEY = 'chemplant-classic-sim-auto-v1';
const CLASSIC_PROJECTS_KEY = 'chemplant-classic-sim-projects-v1';

const NODE_TYPES = { classicBlock: ClassicBlockNode };
const EDGE_TYPES = { classicStream: ClassicStreamEdge };

const CLASSIC_EXAMPLE_LABELS_EN: Record<string, string> = {
  ex_flash_loop: 'Vapor-Liquid Flash & Heat Exchanger Basics (Feed → Heater → Flash2)',
  ex_bt_distill: 'Benzene–Toluene Rigorous Distillation Column (Peng-Robinson · 20 Stages)',
  ex_ech_distill: 'ECH Dual Rigorous Distillation Columns (RadColumn × 2)',
};

const UNIT_EN_NAMES: Partial<Record<FlowUnitType, string>> = {
  feed: 'Feed Stream',
  product: 'Product Stream',
  mixer: 'Stream Mixer',
  splitter: 'Flow Splitter',
  separator: '2-Phase Flash',
  hex: '2-Stream HEX',
  cooler: 'Heater / Cooler',
  distillation: 'Rigorous Column',
  absorber: 'Absorber / Stripper',
  extractor: 'LLE Extractor',
  reactor: 'Chemical Reactor',
  pump: 'Centrifugal Pump',
  compressor: 'Compressor',
  valve: 'JT Expansion Valve',
  evaporator: 'Multi-Effect Evap',
  liquefier: 'Cryo Condenser',
  desiccant_dryer: 'Desiccant Dryer',
  saturator: 'Brine Saturator',
  chelate_tower: 'Chelate Resin Tower',
  electrolyzer: 'Membrane Cell',
};

const PROPERTY_METHOD_EN: Record<ResolvedPropertyMethod, { label: string; short: string; bestFor: string }> = {
  ENRTL: {
    label: 'ENRTL (Electrolyte Aqueous · Multi-Phase Activity)',
    short: 'Electrolyte · Acid/Base Aqueous',
    bestFor: 'Brine electrolysis (NaCl·NaOH), HCl azeotrope/absorption, H₂SO₄ drying, aqueous NH₃, chlorinated organics–brine LLE',
  },
  NRTL: {
    label: 'NRTL (Non-Ideal Liquid Activity γ-φ)',
    short: 'Polar Organics · Azeotrope/LLE',
    bestFor: 'Alcohol (MeOH·EtOH·IPA)–water azeotropic distillation, acetone/acetic acid/EtOAc, chloroform, ECH/chlorohydrin, LLE',
  },
  PR: {
    label: 'PR (Peng-Robinson Cubic EOS)',
    short: 'Hydrocarbons · Aromatics · Liquefied Gas',
    bestFor: 'Natural gas (CH₄), LPG (C2–C4), hexane/heptane, BTX aromatics (benzene/toluene/xylene), liquid Cl₂/CO₂/anhydrous HCl',
  },
  SRK: {
    label: 'SRK (Soave-Redlich-Kwong Cubic EOS)',
    short: 'Hydrogen · Syngas · Light Olefins',
    bestFor: 'High-pressure H₂, syngas (CO·H₂·CH₄·N₂), ethylene/propylene olefin separation, petrochemical gas processing',
  },
};

const PLANT_PRESET_SHORT_EN: Record<string, string> = {
  clorsim_sim: 'Chlor-Alkali',
  hcl_synth: '1A HCl/PSD',
  ech_gte: 'ECH (GTE)',
  cms_plant: 'CMS',
  mdi_plant: 'MDI',
};

const GENERAL_PACK_LABEL_EN: Record<string, string> = {
  polar_solvents: 'Alcohols · Ketones · Solvents',
  btx_refinery: 'BTX Aromatics · Naphtha',
  light_hc_lpg: 'Natural Gas · Olefins · LPG',
  syngas_h2_nh3: 'Syngas · H₂ · NH₃ · CO₂',
  chlorinated_org: 'Chlorinated Solvents · CMS · ECH',
  sm_cumene_aromatics: 'Styrene (SM) · Cumene · Phenol',
  amine_sour_gas: 'Amine Acid Gas (CO₂·H₂S)',
  battery_semi_solvents: 'Battery Carbonates · Semi Solvents',
  electronic_battery_water: 'Electronics · Battery · Water',
};

const ELECTROLYZER_NOTE_EN: Record<ElectrolyzerPresetId, string> = {
  nacl_chlor_alkali: 'Ion-exchange membrane chlor-alkali cell for NaOH, Cl₂, and H₂ (E_rev ≈ 2.19 V)',
  kcl_koh: 'Ion-exchange membrane cell for KOH production (E_rev ≈ 2.19 V, supports NaCl surrogate feed)',
  awe_water: '30 wt% KOH circulating alkaline water electrolyzer (E_rev ≈ 1.23 V, ~50–52 kWh/kg H₂)',
  pem_water: 'High-pressure PEM green hydrogen electrolyzer with ultrapure water feed (30 kG H₂, ~52–54 kWh/kg H₂)',
  hcl_electrolysis: 'By-product HCl chlorine recovery electrolyzer (E_rev ≈ 1.36 V, low voltage / high efficiency)',
  naclo3_chlorate: 'Diaphragm-free sodium chlorate (NaClO₃) cell (6e⁻/mol NaClO₃, by-product H₂ recovery)',
};

interface ClassicExampleCase {
  id: string;
  label: string;
  nodes: Array<FlowNodeDef & { position: { x: number; y: number } }>;
  edges: FlowEdgeDef[];
}

const CLASSIC_GENERIC_DEFAULT_COMPS: SimCompKey[] = [
  'H2O',
  'MeOH',
  'EtOH',
  'Benzene',
  'Toluene',
  'N2',
  'CH4',
];

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
          feedFlowsKgH: emptySimFlows({ MeOH: 3000, H2O: 5000, N2: 150 }),
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
        tag: 'D-101',
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
    id: 'ex_bt_distill',
    label: '벤젠–톨루엔 다단 정밀증류탑 (Peng-Robinson · 20단)',
    nodes: [
      {
        id: 'cbt_feed',
        tag: 'FEED-101',
        name: 'Benzene-Toluene Feed',
        unitType: 'feed',
        position: { x: 50, y: 155 },
        params: {
          feedTempC: 85,
          feedPressKgcm2g: 0.8,
          feedFlowsKgH: emptySimFlows({ Benzene: 5000, Toluene: 5000 }),
        },
      },
      {
        id: 'cbt_t101',
        tag: 'T-101',
        name: 'B/T Column (20 Stages)',
        unitType: 'distillation',
        position: { x: 340, y: 130 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            columnCalcMode: 'rigorous_mesh',
            thermoModel: 'PENG_ROB',
            totalStages: 20,
            feedStage: 10,
            topPressKgcm2g: 0.5,
            murphreeEffPct: 80,
            topSpecType: 'reflux_ratio',
            topSpecValue: 2.0,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.5,
          },
        },
      },
      { id: 'cbt_top', tag: 'PROD-BZ', name: 'Benzene Distillate', unitType: 'product', position: { x: 640, y: 70 }, params: {} },
      { id: 'cbt_bot', tag: 'PROD-TOL', name: 'Toluene Bottoms', unitType: 'product', position: { x: 640, y: 210 }, params: {} },
    ],
    edges: [
      { id: 'cbte_1', streamNo: 'S1', source: 'cbt_feed', target: 'cbt_t101', sourcePort: 'out', targetPort: 'in' },
      { id: 'cbte_2', streamNo: 'S2', source: 'cbt_t101', target: 'cbt_top', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'cbte_3', streamNo: 'S3', source: 'cbt_t101', target: 'cbt_bot', sourcePort: 'liquid', targetPort: 'in' },
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
        tag: 'T-101',
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
        tag: 'T-102',
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

interface ClassicUndoSnapshot {
  simDefs: FlowNodeDef[];
  positions: Record<string, { x: number; y: number }>;
  flowEdges: FlowEdgeDef[];
}

const MAX_UNDO_HISTORY = 40;

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
      return {
        reactionPreset: 'custom' as unknown as FlowNodeDef['params']['reactionPreset'],
        conversion: 0.99,
        operTempC: 180,
      };
    case 'distillation':
      return {
        calcMode: 'rigorous',
        distillConfig: {
          columnCalcMode: 'design_stages',
          thermoModel: 'NRTL',
          designLkComp: 'Benzene',
          designHkComp: 'Toluene',
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
    mergeFeedComponents(initialEx.nodes, CLASSIC_GENERIC_DEFAULT_COMPS)
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
  const [activeClassicCaseName, setActiveClassicCaseName] = useState<string | null>(null);
  const [projectNameInput, setProjectNameInput] = useState('');
  const processTextInputRef = useRef<HTMLInputElement | null>(null);
  const [interopNotice, setInteropNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
    warnings?: string[];
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  const [mobilePane, setMobilePane] = useState<'pfd' | 'tree' | 'form' | 'summary'>('pfd');

  // 전역 기본 단위 연동 + 인라인 단위 선택 상태
  const lang = useUnitStore(s => s.lang);
  const isEn = lang === 'en';
  const tagStandard = useUnitStore(s => s.tagStandard);
  const [tempUnit, setTempUnit] = useLocalUnit('temp');
  const [pressUnit, setPressUnit] = useLocalUnit('pressG');
  const [massFlowUnit, setMassFlowUnit] = useLocalUnit('massFlow');
  const [heatDutyUnit, setHeatDutyUnit] = useLocalUnit('heatDuty');
  const [powerUnit, setPowerUnit] = useLocalUnit('power');
  const [feedFlowUnit, setFeedFlowUnit] = useLocalUnit('massFlow');

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

  // Undo / Redo 히스토리 스택 (최대 40스냅샷) 및 우클릭 드래그 다중선택 상태
  const undoPastRef = useRef<ClassicUndoSnapshot[]>([]);
  const undoFutureRef = useRef<ClassicUndoSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const simDefsRef = useRef(simDefs);
  const rfNodesRef = useRef(rfNodes);
  const flowEdgesRef = useRef(flowEdges);
  simDefsRef.current = simDefs;
  rfNodesRef.current = rfNodes;
  flowEdgesRef.current = flowEdges;
  const dragStartSnapRef = useRef<ClassicUndoSnapshot | null>(null);
  const lastParamPushRef = useRef<{ nodeId: string; ts: number }>({ nodeId: '', ts: 0 });
  const lastDeleteBatchTsRef = useRef<number>(0);

  const [rmbBox, setRmbBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const suppressContextMenuRef = useRef(false);

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
        activeComponents: mergeFeedComponents(initialEx.nodes, CLASSIC_GENERIC_DEFAULT_COMPS),
      }
    ),
    elapsedMs: 0,
    lastRunTime: isEn ? 'Not run (▶ Ready to Run)' : '미실행 (▶ Run 대기)',
  }));
  const [isDirty, setIsDirty] = useState(true);
  const skipDirtyRef = useRef(true);
  const loadedPendingOnMountRef = useRef(false);

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
      let pending: PendingCaseLoadPayload | null = null;
      const rawPendingStr = window.sessionStorage.getItem(PENDING_CASE_LOAD_KEY);
      if (rawPendingStr) {
        try {
          const peek = JSON.parse(rawPendingStr) as Partial<PendingCaseLoadPayload>;
          if (
            peek &&
            peek.uiMode === 'classic' &&
            (!peek.targetPlantId || peek.targetPlantId === 'classic_sim')
          ) {
            pending = consumePendingCaseLoad('classic');
          }
        } catch {
          pending = consumePendingCaseLoad('classic');
        }
      }

      if (pending) {
        if (pending.action === 'load_project' && pending.rawProject) {
          const rawProj = pending.rawProject.state ?? pending.rawProject;
          if (rawProj && Array.isArray(rawProj.simDefs) && Array.isArray(rawProj.flowEdges)) {
            loadedPendingOnMountRef.current = true;
            skipDirtyRef.current = true;
            const restoredMethod = normalizePropertyMethod(rawProj.thermoMethod ?? rawProj.propertyMethod);
            const baseComps =
              Array.isArray(rawProj.activeComponents) && rawProj.activeComponents.length > 0
                ? (rawProj.activeComponents.filter((c: string) => SIM_COMPS.includes(c as SimCompKey)) as SimCompKey[])
                : getPlantDefaultComponents('classic_sim');
            const restoredComps = mergeFeedComponents(rawProj.simDefs, baseComps);
            setSimDefs(rawProj.simDefs);
            setFlowEdges(rawProj.flowEdges);
            setRfNodes(
              rawProj.simDefs.map((d: FlowNodeDef, i: number) => ({
                id: d.id,
                type: 'classicBlock',
                position: rawProj.positions?.[d.id] ?? { x: 80 + i * 170, y: 140 },
                data: { tag: d.tag, modelName: getModelName(d.unitType), unitType: d.unitType },
              }))
            );
            setThermoMethod(restoredMethod);
            setActiveComponents(restoredComps);
            const idleRes = createIdleFlowsheetResult(rawProj.simDefs, rawProj.flowEdges, {
              propertyMethod: restoredMethod,
              activeComponents: restoredComps,
            });
            setSolvedMeta({ result: idleRes, elapsedMs: 0, lastRunTime: isEn ? 'Not run (▶ Ready to Run)' : '미실행 (▶ Run 대기)' });
            setIsDirty(true);
            setSelectedId(rawProj.simDefs[0]?.id ?? null);
            setSelectedKind('block');
            setActiveCaseTitle(pending.caseName || pending.rawProject.name || null, 'classic_sim');
          }
        } else if (pending.action === 'new_blank') {
          loadedPendingOnMountRef.current = true;
          skipDirtyRef.current = true;
          const defaultComps = getPlantDefaultComponents('classic_sim');
          setSimDefs([]);
          setRfNodes([]);
          setFlowEdges([]);
          setThermoMethod('AUTO');
          setActiveComponents(defaultComps);
          setSolvedMeta({
            result: createIdleFlowsheetResult([], [], {
              propertyMethod: 'AUTO',
              activeComponents: defaultComps,
            }),
            elapsedMs: 0,
            lastRunTime: isEn ? 'Not run (▶ Ready to Run)' : '미실행 (▶ Run 대기)',
          });
          setIsDirty(true);
          setSelectedId(null);
          setSelectedKind('block');
          setActiveCaseTitle(null, 'classic_sim');
        }
      }

      if (!loadedPendingOnMountRef.current) {
        const rawAuto = localStorage.getItem(CLASSIC_AUTO_SAVE_KEY);
        if (rawAuto) {
          const parsed = JSON.parse(rawAuto);
          if (parsed && Array.isArray(parsed.simDefs) && Array.isArray(parsed.flowEdges)) {
            skipDirtyRef.current = true;
            const restoredMethod = normalizePropertyMethod(parsed.thermoMethod);
            const baseComps = Array.isArray(parsed.activeComponents) && parsed.activeComponents.length > 0
              ? (parsed.activeComponents.filter((c: string) => SIM_COMPS.includes(c as SimCompKey)) as SimCompKey[])
              : CLASSIC_GENERIC_DEFAULT_COMPS;
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
                lastRunTime: parsed.lastSolvedMeta.lastRunTime ?? (isEn ? 'Restored from save' : '저장본 복원'),
              });
              setIsDirty(Boolean(parsed.isDirty));
            } else {
              const idleRes = createIdleFlowsheetResult(parsed.simDefs, parsed.flowEdges, {
                propertyMethod: restoredMethod,
                activeComponents: restoredComps,
              });
              setSolvedMeta({ result: idleRes, elapsedMs: 0, lastRunTime: isEn ? 'Not run (▶ Ready to Run)' : '미실행 (▶ Run 대기)' });
              setIsDirty(true);
            }
            setSelectedId(parsed.simDefs[0]?.id ?? null);
            setSelectedKind('block');
          }
        }
      }
      const rawProjs = localStorage.getItem(CLASSIC_PROJECTS_KEY);
      if (rawProjs) {
        const arr = JSON.parse(rawProjs);
        if (Array.isArray(arr)) setSavedProjects(arr);
      }
      const curTitle = getActiveCaseTitle();
      setActiveClassicCaseName(curTitle && curTitle.plantId === 'classic_sim' ? curTitle.title : null);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    const syncClassicProjects = () => {
      try {
        const rawProjs = localStorage.getItem(CLASSIC_PROJECTS_KEY);
        if (rawProjs) {
          const arr = JSON.parse(rawProjs);
          setSavedProjects(Array.isArray(arr) ? arr : []);
        } else {
          setSavedProjects([]);
        }
      } catch {
        // ignore
      }
      const curTitle = getActiveCaseTitle();
      setActiveClassicCaseName(curTitle && curTitle.plantId === 'classic_sim' ? curTitle.title : null);
    };
    window.addEventListener(PROJECTS_UPDATED_EVENT, syncClassicProjects);
    return () => window.removeEventListener(PROJECTS_UPDATED_EVENT, syncClassicProjects);
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
  const { user } = useAuth();
  const activePlantId = useBalanceStore(s => s.activePlantId);
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
  const plantPresets = useMemo(
    () =>
      getClassicPlantPresetOptions().filter(opt =>
        isPlantAllowed(PLANT_GROUP_TO_ID[opt.plantGroup], user)
      ),
    [user]
  );

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

  // ── Undo / Redo 스냅샷 캡처 · 복원 및 단축키 (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) ──
  const captureSnapshot = useCallback((): ClassicUndoSnapshot => {
    const positions: Record<string, { x: number; y: number }> = {};
    rfNodesRef.current.forEach(n => {
      positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    });
    const clone = <T,>(v: T): T =>
      typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
    return {
      simDefs: clone(simDefsRef.current),
      positions,
      flowEdges: clone(flowEdgesRef.current),
    };
  }, []);

  const pushUndoSnapshot = useCallback(
    (snap?: ClassicUndoSnapshot) => {
      const entry = snap ?? captureSnapshot();
      const nextPast = [...undoPastRef.current, entry];
      if (nextPast.length > MAX_UNDO_HISTORY) {
        nextPast.splice(0, nextPast.length - MAX_UNDO_HISTORY);
      }
      undoPastRef.current = nextPast;
      undoFutureRef.current = [];
      setCanUndo(undoPastRef.current.length > 0);
      setCanRedo(false);
    },
    [captureSnapshot]
  );

  const pushParamEditSnapshot = useCallback(
    (nodeId: string) => {
      const now = Date.now();
      const prev = lastParamPushRef.current;
      if (prev.nodeId !== nodeId || now - prev.ts > 600) {
        pushUndoSnapshot();
      }
      lastParamPushRef.current = { nodeId, ts: now };
    },
    [pushUndoSnapshot]
  );

  const restoreSnapshot = useCallback((snap: ClassicUndoSnapshot) => {
    const clone = <T,>(v: T): T =>
      typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
    const nextDefs = clone(snap.simDefs);
    const nextEdges = clone(snap.flowEdges);
    const nextNodes: Node<ClassicBlockNodeData>[] = nextDefs.map((d, i) => ({
      id: d.id,
      type: 'classicBlock',
      position: snap.positions[d.id] ? { ...snap.positions[d.id] } : { x: 80 + i * 170, y: 140 },
      data: { tag: d.tag, modelName: getModelName(d.unitType), unitType: d.unitType },
    }));
    lastParamPushRef.current = { nodeId: '', ts: 0 };
    setSimDefs(nextDefs);
    setRfNodes(nextNodes);
    setFlowEdges(nextEdges);
    setIsDirty(true);
    setSelectedId(prev => {
      if (!prev) return null;
      const existsInDefs = nextDefs.some(d => d.id === prev);
      const existsInEdges = nextEdges.some(e => e.id === prev);
      return existsInDefs || existsInEdges ? prev : null;
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (undoPastRef.current.length === 0) return;
    const prevSnap = undoPastRef.current[undoPastRef.current.length - 1];
    const currentSnap = captureSnapshot();
    undoPastRef.current = undoPastRef.current.slice(0, -1);
    const nextFuture = [...undoFutureRef.current, currentSnap];
    if (nextFuture.length > MAX_UNDO_HISTORY) {
      nextFuture.splice(0, nextFuture.length - MAX_UNDO_HISTORY);
    }
    undoFutureRef.current = nextFuture;
    setCanUndo(undoPastRef.current.length > 0);
    setCanRedo(undoFutureRef.current.length > 0);
    restoreSnapshot(prevSnap);
  }, [captureSnapshot, restoreSnapshot]);

  const handleRedo = useCallback(() => {
    if (undoFutureRef.current.length === 0) return;
    const nextSnap = undoFutureRef.current[undoFutureRef.current.length - 1];
    const currentSnap = captureSnapshot();
    undoFutureRef.current = undoFutureRef.current.slice(0, -1);
    const nextPast = [...undoPastRef.current, currentSnap];
    if (nextPast.length > MAX_UNDO_HISTORY) {
      nextPast.splice(0, nextPast.length - MAX_UNDO_HISTORY);
    }
    undoPastRef.current = nextPast;
    setCanUndo(undoPastRef.current.length > 0);
    setCanRedo(undoFutureRef.current.length > 0);
    restoreSnapshot(nextSnap);
  }, [captureSnapshot, restoreSnapshot]);

  useEffect(() => {
    const onUndoRedoKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (undoPastRef.current.length > 0) {
          e.preventDefault();
          handleUndo();
        }
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (undoFutureRef.current.length > 0) {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', onUndoRedoKey);
    return () => window.removeEventListener('keydown', onUndoRedoKey);
  }, [handleUndo, handleRedo]);

  const onNodeDragStart = useCallback(() => {
    dragStartSnapRef.current = captureSnapshot();
  }, [captureSnapshot]);

  const onNodeDragStop = useCallback(() => {
    const startSnap = dragStartSnapRef.current;
    dragStartSnapRef.current = null;
    if (!startSnap) return;
    const moved = rfNodesRef.current.some(n => {
      const prevPos = startSnap.positions[n.id];
      if (!prevPos) return false;
      return Math.abs(Math.round(n.position.x) - prevPos.x) > 1 || Math.abs(Math.round(n.position.y) - prevPos.y) > 1;
    });
    if (moved) {
      pushUndoSnapshot(startSnap);
    }
  }, [pushUndoSnapshot]);

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const delIds = new Set(deleted.map(d => d.id));
      if (delIds.size === 0) return;
      pushUndoSnapshot();
      lastDeleteBatchTsRef.current = Date.now();
      setSimDefs(prev => prev.filter(d => !delIds.has(d.id)));
      setRfNodes(prev => prev.filter(n => !delIds.has(n.id)));
      setFlowEdges(prev => prev.filter(e => !delIds.has(e.source) && !delIds.has(e.target)));
      setSelectedId(prev => (prev && delIds.has(prev) ? null : prev));
    },
    [pushUndoSnapshot]
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const setDel = new Set(deleted.map(d => d.id));
      if (setDel.size === 0) return;
      if (Date.now() - lastDeleteBatchTsRef.current >= 80) {
        pushUndoSnapshot();
      }
      setFlowEdges(prev => prev.filter(e => !setDel.has(e.id)));
      setSelectedId(prev => (prev && setDel.has(prev) ? null : prev));
    },
    [pushUndoSnapshot]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selNodes }: { nodes: Node[]; edges: Edge[] }) => {
      if (selNodes.length > 0) {
        setSelectedKind('block');
        setSelectedId(prev => (prev && selNodes.some(n => n.id === prev) ? prev : selNodes[0].id));
      }
    },
    []
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 2) return;
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      let didDrag = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        if (!didDrag && Math.hypot(dx, dy) > 6) {
          didDrag = true;
          suppressContextMenuRef.current = true;
        }
        if (didDrag && rfWrapperRef.current) {
          const rect = rfWrapperRef.current.getBoundingClientRect();
          setRmbBox({
            left: Math.min(startClientX, ev.clientX) - rect.left,
            top: Math.min(startClientY, ev.clientY) - rect.top,
            width: Math.abs(ev.clientX - startClientX),
            height: Math.abs(ev.clientY - startClientY),
          });
        }
      };

      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setRmbBox(null);

        if (didDrag && rfInstance) {
          const p1 = rfInstance.screenToFlowPosition({
            x: Math.min(startClientX, ev.clientX),
            y: Math.min(startClientY, ev.clientY),
          });
          const p2 = rfInstance.screenToFlowPosition({
            x: Math.max(startClientX, ev.clientX),
            y: Math.max(startClientY, ev.clientY),
          });
          const boxMinX = Math.min(p1.x, p2.x);
          const boxMaxX = Math.max(p1.x, p2.x);
          const boxMinY = Math.min(p1.y, p2.y);
          const boxMaxY = Math.max(p1.y, p2.y);
          const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;

          const hitIds: string[] = [];
          setRfNodes(prev =>
            prev.map(n => {
              const nw = typeof n.width === 'number' && n.width > 0 ? n.width : 120;
              const nh = typeof n.height === 'number' && n.height > 0 ? n.height : 72;
              const hit =
                n.position.x <= boxMaxX &&
                n.position.x + nw >= boxMinX &&
                n.position.y <= boxMaxY &&
                n.position.y + nh >= boxMinY;
              const nextSelected = additive ? Boolean(n.selected) || hit : hit;
              if (nextSelected) hitIds.push(n.id);
              return n.selected === nextSelected ? n : { ...n, selected: nextSelected };
            })
          );
          if (hitIds.length > 0) {
            setSelectedKind('block');
            setSelectedId(hitIds[0]);
          } else if (!additive) {
            setSelectedId(null);
          }

          window.setTimeout(() => {
            suppressContextMenuRef.current = false;
          }, 120);
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [rfInstance]
  );

  // 모던 UI -> 클래식 UI 전환 시 실시간 플로우시트 인계 수신
  useEffect(() => {
    if (loadedPendingOnMountRef.current) {
      loadedPendingOnMountRef.current = false;
      consumeUiSwitchHandoff();
      setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 220 }), 80);
      return;
    }
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
      lastRunTime: isEn ? 'Handed off from Modern UI (▶ Ready to Run)' : '모던 UI에서 인계됨 (▶ Run 대기)',
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
      lastRunTime: isEn ? 'Reset (▶ Ready to Run)' : '초기화됨 (▶ Run 대기)',
    });
    setIsDirty(true);
  }, [activeComponents, flowEdges, isEn, simDefs, thermoMethod]);

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
      const group = (
        groupRaw === 'hcl1A' || groupRaw === 'ech' || groupRaw === 'cms' || groupRaw === 'mdi'
          ? groupRaw
          : 'electrolysis'
      ) as 'electrolysis' | 'hcl1A' | 'ech' | 'cms' | 'mdi';
      const bundle = await fetchConvergedBaselinesBundle();
      const bEntry = bundle?.plants?.[group]?.[sheetId];
      const sheets = getPlantSheetsByGroup(group, { syncMasterOnInit: !bEntry && sheetId !== 'master' });
      const rawSheet = sheets[sheetId];
      if (!rawSheet) return;
      const nextDefs = (bEntry?.simDefs ?? rawSheet.simDefs).map(d => ({ ...d, params: { ...d.params } }));
      const nextEdges = (bEntry?.flowEdges ?? rawSheet.flowEdges).map(e => ({ ...e }));
      const plantContext =
        group === 'hcl1A'
          ? 'hcl_1a_plant'
          : group === 'ech'
            ? 'ech_gte_plant'
            : group === 'cms'
              ? 'cms_plant'
              : group === 'mdi'
                ? 'mdi_plant'
                : 'electrolyzer_plant';
      const nextComps = mergeFeedComponents(nextDefs, getPlantDefaultComponents(plantContext));
      const nextMethod: SimPropertyMethod =
        group === 'cms' ? 'PR' : group === 'mdi' ? 'NRTL' : thermoMethod;

      skipDirtyRef.current = true;
      setSimDefs(nextDefs);
      setFlowEdges(nextEdges);
      setActiveComponents(nextComps);
      if (nextMethod !== thermoMethod) {
        setThermoMethod(nextMethod);
      }
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
          lastRunTime: bEntry.lastRunTime || (isEn ? 'Pre-converged baseline' : '사전 수렴 기준케이스'),
        });
        setIsDirty(false);
      } else {
        runSimulation(nextDefs, nextEdges, nextMethod, nextComps, tearMethod);
      }
      setActiveMdiKey('pfd');
      setBottomView('pfd');
      setSelectedKind('block');
      setSelectedId(nextDefs[0]?.id ?? null);
      setActiveCaseTitle(null, 'classic_sim');
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

  // Explorer Tree 표시용 태그 표준화 목록
  const displaySimDefs = useMemo(
    () =>
      simDefs.map(d => ({
        ...d,
        tag: formatEquipmentTag(d.tag, d.unitType, tagStandard),
      })),
    [simDefs, tagStandard]
  );

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
          ? isEn
            ? `Mass balance error (${uRes!.massImbalanceKgH.toFixed(1)} kg/h)`
            : `물질수지 오차 (${uRes!.massImbalanceKgH.toFixed(1)} kg/h)`
          : hasDistillErr
            ? isEn
              ? 'Column not converged or spec not met'
              : '증류탑 미수렴 또는 목표 스펙 미달'
            : hasFlow
              ? isEn
                ? 'Converged'
                : '수렴 완료'
              : isEn
                ? 'Awaiting connection'
                : '연결 대기';
      const resolvedType = def?.unitType ?? n.data.unitType;
      return {
        ...n,
        selected: Boolean(n.selected) || (selectedKind === 'block' && selectedId === n.id),
        data: {
          tag: formatEquipmentTag(def?.tag ?? n.data.tag, resolvedType, tagStandard),
          modelName: getModelName(resolvedType),
          unitType: resolvedType,
          status,
          statusTitle,
          liveMetric: metric,
        },
      };
    });
  }, [rfNodes, simDefs, unitResultMap, selectedKind, selectedId, tagStandard, isEn]);

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
      pushUndoSnapshot();
      const item = CLASSIC_MODEL_CATALOG.find(m => m.unitType === unitType);
      const stdPrefix = getDefaultTagPrefix(unitType, tagStandard);
      const prefix = stdPrefix !== 'U' ? stdPrefix : (item?.defaultPrefix ?? 'B');
      const count = simDefs.filter(d => d.unitType === unitType).length + 1;
      const id = `blk_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const tag = `${prefix}-${100 + count}`;
      const newDef: FlowNodeDef = {
        id,
        tag,
        name: item ? `${item.modelName} (${isEn ? (UNIT_EN_NAMES[unitType] ?? item.modelName) : item.koName})` : unitType,
        unitType,
        params: defaultParamsForClassic(unitType),
      };
      const finalPos = pos ?? {
        x: 140 + (simDefs.length % 4) * 165,
        y: 100 + Math.floor(simDefs.length / 4) * 120,
      };
      setSimDefs(prev => [...prev, newDef]);
      setRfNodes(prev => [
        ...prev.map(n => (n.selected ? { ...n, selected: false } : n)),
        {
          id,
          type: 'classicBlock',
          position: finalPos,
          selected: true,
          data: { tag, modelName: getModelName(unitType), unitType },
        },
      ]);
      setSelectedKind('block');
      setSelectedId(id);
    },
    [isEn, pushUndoSnapshot, simDefs, tagStandard]
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      pushUndoSnapshot();
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
    [flowEdges.length, pushUndoSnapshot]
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

  const updateBlockDef = useCallback(
    (nodeId: string, updater: (d: FlowNodeDef) => FlowNodeDef) => {
      pushParamEditSnapshot(nodeId);
      setSimDefs(prev => prev.map(d => (d.id === nodeId ? updater(d) : d)));
    },
    [pushParamEditSnapshot]
  );

  const deleteBlock = useCallback(
    (nodeId: string) => {
      pushUndoSnapshot();
      setSimDefs(prev => prev.filter(d => d.id !== nodeId));
      setRfNodes(prev => prev.filter(n => n.id !== nodeId));
      setFlowEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
      setSelectedId(null);
    },
    [pushUndoSnapshot]
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      pushUndoSnapshot();
      setFlowEdges(prev => prev.filter(e => e.id !== edgeId));
      setSelectedId(null);
    },
    [pushUndoSnapshot]
  );

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
      lastRunTime: isEn ? 'Not run (▶ Ready to Run)' : '미실행 (▶ Run 대기)',
    });
    setIsDirty(true);
    setSelectedKind('block');
    setSelectedId(nextDefs[0]?.id ?? null);
    setActiveCaseTitle(null, 'classic_sim');
    setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 220 }), 80);
  };

  const clearBlank = () => {
    if (simDefs.length > 0 || flowEdges.length > 0) {
      pushUndoSnapshot();
    }
    skipDirtyRef.current = true;
    const defaultComps = getPlantDefaultComponents('classic_sim');
    setSimDefs([]);
    setRfNodes([]);
    setFlowEdges([]);
    setThermoMethod('AUTO');
    setActiveComponents(defaultComps);
    setSolvedMeta({
      result: createIdleFlowsheetResult([], [], {
        propertyMethod: 'AUTO',
        activeComponents: defaultComps,
      }),
      elapsedMs: 0,
      lastRunTime: isEn ? 'Not run (▶ Ready to Run)' : '미실행 (▶ Run 대기)',
    });
    setIsDirty(true);
    setSelectedKind('block');
    setSelectedId(null);
    setActiveCaseTitle(null, 'classic_sim');
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
    setActiveCaseTitle(item.name, 'classic_sim');
    setActiveClassicCaseName(item.name);
    notifyProjectsUpdated();
    setShowProjectBar(false);
  };

  const overwriteClassicProject = (projId: string) => {
    const positions: Record<string, { x: number; y: number }> = {};
    rfNodes.forEach(n => {
      positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    });
    const targetProj = savedProjects.find(p => p.id === projId);
    const next = savedProjects.map(p =>
      p.id === projId
        ? {
            ...p,
            savedAt: new Date().toLocaleString('ko-KR', { hour12: false }),
            simDefs,
            positions,
            flowEdges,
            thermoMethod,
            activeComponents,
          }
        : p
    );
    setSavedProjects(next);
    try {
      localStorage.setItem(CLASSIC_PROJECTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (targetProj) {
      setActiveCaseTitle(targetProj.name, 'classic_sim');
      setActiveClassicCaseName(targetProj.name);
    }
    notifyProjectsUpdated();
    setShowProjectBar(false);
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
      lastRunTime: isEn ? 'Not run (▶ Ready to Run)' : '미실행 (▶ Run 대기)',
    });
    setIsDirty(true);
    setSelectedKind('block');
    setSelectedId(p.simDefs[0]?.id ?? null);
    setShowProjectBar(false);
    setActiveCaseTitle(p.name || null, 'classic_sim');
    setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 220 }), 80);
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

  const handleImportProcessText = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      const res = parseProcessTextFile(rawText, file.name);
      const importedDefs: FlowNodeDef[] = Array.isArray(res.defs) ? res.defs : Object.values(res.defs ?? {});
      if (importedDefs.length === 0) {
        setInteropNotice({
          kind: 'error',
          text: isEn
            ? `No importable process unit blocks were found in "${file.name}".`
            : `"${file.name}" 파일에서 가져올 수 있는 공정 장치 블록을 찾지 못했습니다.`,
          warnings: res.warnings,
        });
        return;
      }

      skipDirtyRef.current = true;
      const nextMethod = normalizePropertyMethod(res.propertyMethod);
      const baseComps =
        Array.isArray(res.activeComponents) && res.activeComponents.length > 0
          ? (res.activeComponents.filter(c => SIM_COMPS.includes(c)) as SimCompKey[])
          : activeComponents;
      const nextComps = mergeFeedComponents(importedDefs, baseComps);

      const posMap = new Map<string, { x: number; y: number }>();
      (res.rfNodes ?? []).forEach(n => {
        if (n?.id && n.position) {
          posMap.set(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) });
        }
      });

      const nextRfNodes: Node<ClassicBlockNodeData>[] = importedDefs.map((d, i) => {
        const pos = posMap.get(d.id) ?? { x: 80 + i * 170, y: 130 };
        return {
          id: d.id,
          type: 'classicBlock',
          position: { x: Math.round(pos.x), y: Math.round(pos.y) },
          data: { tag: d.tag, modelName: getModelName(d.unitType), unitType: d.unitType },
        };
      });

      const importedTitle =
        (res.title || file.name.replace(/\.(bkp|inp|txt)$/i, '') || 'imported_case').trim();

      setSimDefs(importedDefs);
      setFlowEdges(res.edges);
      setThermoMethod(nextMethod);
      setActiveComponents(nextComps);
      setRfNodes(nextRfNodes);
      setSolvedMeta({
        result: createIdleFlowsheetResult(importedDefs, res.edges, {
          propertyMethod: nextMethod,
          activeComponents: nextComps,
        }),
        elapsedMs: 0,
        lastRunTime: isEn ? 'Not run (▶ Ready to Run)' : '미실행 (▶ Run 대기)',
      });
      setIsDirty(true);
      setSelectedKind('block');
      setSelectedId(res.defs[0]?.id ?? null);
      setActiveCaseTitle(importedTitle, 'classic_sim');
      setActiveClassicCaseName(importedTitle);
      setProjectNameInput(importedTitle);

      const unmapped = res.summary?.unmappedComps ?? [];
      const unmappedSuffix =
        unmapped.length > 0
          ? isEn
            ? ` · ${unmapped.length} unmapped (${unmapped.slice(0, 6).join(', ')}${unmapped.length > 6 ? ' +' : ''})`
            : ` · 미매핑 성분 ${unmapped.length}종(${unmapped.slice(0, 6).join(', ')}${unmapped.length > 6 ? ' 외' : ''})`
          : '';
      setInteropNotice({
        kind: 'success',
        text: isEn
          ? `Imported "${importedTitle}" — ${res.summary?.unitCount ?? res.defs.length} units · ${res.summary?.edgeCount ?? res.edges.length} streams · ${res.summary?.mappedCompCount ?? nextComps.length} components${unmappedSuffix}`
          : `"${importedTitle}" 가져오기 완료 — 장치 ${res.summary?.unitCount ?? res.defs.length}개 · 스트림 ${res.summary?.edgeCount ?? res.edges.length}개 · 성분 ${res.summary?.mappedCompCount ?? nextComps.length}종${unmappedSuffix}`,
        warnings: res.warnings && res.warnings.length > 0 ? res.warnings : undefined,
      });
      setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 220 }), 80);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : (isEn ? 'Unknown error' : '알 수 없는 오류');
      setInteropNotice({
        kind: 'error',
        text: isEn ? `Failed to import process text file: ${errMsg}` : `공정 텍스트 파일 가져오기 실패: ${errMsg}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleExportProcessText = () => {
    try {
      const rawTitle = (activeClassicCaseName || projectNameInput || 'chemplant_case').trim();
      const inpText = exportProcessTextFile({
        title: rawTitle,
        defs: simDefs,
        edges: flowEdges,
        activeComponents,
        propertyMethod: thermoMethod,
      });
      const safeName =
        rawTitle.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'chemplant_case';
      const blob = new Blob([inpText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.inp`;
      a.click();
      URL.revokeObjectURL(url);
      setInteropNotice({
        kind: 'success',
        text: isEn
          ? `Exported "${safeName}.inp" (${simDefs.length} units · ${flowEdges.length} streams)`
          : `"${safeName}.inp" 공정 텍스트 파일 내보내기 완료 (장치 ${simDefs.length}개 · 스트림 ${flowEdges.length}개)`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : (isEn ? 'Unknown error' : '알 수 없는 오류');
      setInteropNotice({
        kind: 'error',
        text: isEn ? `Failed to export process text file: ${errMsg}` : `공정 텍스트 파일 내보내기 실패: ${errMsg}`,
      });
    }
  };

  const selectedBlock = selectedKind === 'block' ? simDefs.find(d => d.id === selectedId) ?? null : null;
  const selectedBlockRes = selectedBlock ? unitResultMap.get(selectedBlock.id) : undefined;
  const selectedEdge = selectedKind === 'stream' ? flowEdges.find(e => e.id === selectedId) ?? null : null;
  const selectedStreamRes = selectedEdge ? streamResultMap.get(selectedEdge.id) : undefined;

  const applyPendingClassicRef = useRef<(pending: PendingCaseLoadPayload) => void>(() => {});
  useEffect(() => {
    applyPendingClassicRef.current = (pending: PendingCaseLoadPayload) => {
      if (pending.action === 'load_project' && pending.rawProject) {
        const raw = pending.rawProject.state ?? pending.rawProject;
        if (raw && Array.isArray(raw.simDefs) && Array.isArray(raw.flowEdges)) {
          loadSavedProject({
            id: String(pending.rawProject.id || `loaded_${Date.now()}`),
            name: String(pending.caseName || pending.rawProject.name || (isEn ? 'Loaded Case' : '불러온 케이스')),
            savedAt: String(pending.rawProject.savedAt || ''),
            simDefs: raw.simDefs,
            positions: raw.positions ?? {},
            flowEdges: raw.flowEdges,
            thermoMethod: normalizePropertyMethod(raw.thermoMethod ?? raw.propertyMethod),
            activeComponents: Array.isArray(raw.activeComponents)
              ? raw.activeComponents.filter((c: unknown): c is SimCompKey => typeof c === 'string' && SIM_COMPS.includes(c as SimCompKey))
              : undefined,
          });
          if (pending.caseName || pending.rawProject.name) {
            setActiveCaseTitle(pending.caseName || pending.rawProject.name, 'classic_sim');
          }
        }
      } else if (pending.action === 'new_blank') {
        clearBlank();
        setShowProjectBar(false);
      }
    };
  });

  useEffect(() => {
    const onLoadSavedCase = (ev: Event) => {
      const customEv = ev as CustomEvent<Partial<PendingCaseLoadPayload> | undefined>;
      const detail = customEv?.detail;
      if (detail && detail.action) {
        if (detail.uiMode && detail.uiMode !== 'classic') return;
        if (detail.targetPlantId && detail.targetPlantId !== 'classic_sim') return;
        try {
          const rawStr = window.sessionStorage.getItem(PENDING_CASE_LOAD_KEY);
          if (rawStr) {
            const peek = JSON.parse(rawStr) as Partial<PendingCaseLoadPayload>;
            if (!peek?.targetPlantId || peek.targetPlantId === 'classic_sim') {
              consumePendingCaseLoad('classic');
            }
          }
        } catch {
          consumePendingCaseLoad('classic');
        }
        applyPendingClassicRef.current(detail as PendingCaseLoadPayload);
        return;
      }

      try {
        const rawStr = window.sessionStorage.getItem(PENDING_CASE_LOAD_KEY);
        if (!rawStr) return;
        const peek = JSON.parse(rawStr) as Partial<PendingCaseLoadPayload>;
        if (!peek || peek.uiMode !== 'classic') return;
        if (peek.targetPlantId && peek.targetPlantId !== 'classic_sim') return;
        const pending = consumePendingCaseLoad('classic');
        if (pending) {
          applyPendingClassicRef.current(pending);
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener(LOAD_SAVED_CASE_EVENT, onLoadSavedCase);
    return () => window.removeEventListener(LOAD_SAVED_CASE_EVENT, onLoadSavedCase);
  }, []);

  const openShortcutCalcRef = useRef<() => void>(() => {});
  useEffect(() => {
    openShortcutCalcRef.current = () => {
      if (!selectedBlock) {
        router.push('/unit-equipment');
        return;
      }
      const payload = buildChemProHandoffPayload(
        selectedBlock,
        flowEdges,
        solved.streams,
        selectedBlockRes,
        isEn ? 'Classic Process Simulator' : '클래식 공정 시뮬레이터'
      );
      if (payload) {
        saveChemProHandoffPayload({ ...payload, plantId: 'classic_sim' });
        router.push(`/unit-equipment?tab=${encodeURIComponent(payload.tab)}&handoff=1&ts=${payload.timestamp}`);
      } else {
        router.push(`/unit-equipment?tab=${encodeURIComponent(mapFlowUnitTypeToChemProTab(selectedBlock.unitType))}`);
      }
    };
  });

  useEffect(() => {
    const onOpenShortcutCalc = () => {
      openShortcutCalcRef.current();
    };
    window.addEventListener(OPEN_SHORTCUT_CALC_EVENT, onOpenShortcutCalc);
    return () => window.removeEventListener(OPEN_SHORTCUT_CALC_EVENT, onOpenShortcutCalc);
  }, []);

  const quickSaveRef = useRef<() => boolean>(() => false);
  quickSaveRef.current = () => {
    const matched = activeClassicCaseName
      ? savedProjects.find(p => p.name === activeClassicCaseName) ?? null
      : null;
    if (matched) {
      overwriteClassicProject(matched.id);
      setInteropNotice({
        kind: 'success',
        text: isEn ? `Saved directly to case "${matched.name}".` : `"${matched.name}" 케이스에 바로 저장되었습니다.`,
        warnings: [],
      });
      return true;
    }
    return false;
  };

  useEffect(() => {
    const onOpenSaveCase = (ev: Event) => {
      const mode = (ev as CustomEvent<{ mode?: string }>).detail?.mode;
      if (mode === 'quick_save') {
        if (!quickSaveRef.current()) {
          setShowProjectBar(true);
        }
        return;
      }
      setShowProjectBar(v => !v);
    };
    window.addEventListener(OPEN_SAVE_CASE_EVENT, onOpenSaveCase);
    return () => window.removeEventListener(OPEN_SAVE_CASE_EVENT, onOpenSaveCase);
  }, []);

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

  // 스트림 유입원 블록 & Feed 블록 찾기 (포트 역할 변경 및 유량 직접 편집 지원)
  const selectedEdgeSourceNode = useMemo(() => {
    if (!selectedEdge) return null;
    return simDefs.find(d => d.id === selectedEdge.source) ?? null;
  }, [selectedEdge, simDefs]);

  const selectedEdgeSourceFeed = useMemo(() => {
    return selectedEdgeSourceNode?.unitType === 'feed' ? selectedEdgeSourceNode : null;
  }, [selectedEdgeSourceNode]);

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
        examples={CLASSIC_EXAMPLES.filter(x => !isSimulatorOnlyUser(user) || x.id !== 'ex_ech_distill').map(x => ({
          id: x.id,
          label: isEn ? (CLASSIC_EXAMPLE_LABELS_EN[x.id] ?? x.label) : x.label,
        }))}
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
                { id: 'pfd', label: isEn ? 'PFD' : '도면' },
                { id: 'tree', label: isEn ? 'Tree' : '트리' },
                { id: 'form', label: isEn ? 'Input' : '입력' },
                { id: 'summary', label: isEn ? 'Summary' : '요약표' },
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              title={isEn ? 'Undo (Ctrl+Z)' : '실행취소 (Ctrl+Z)'}
              aria-label={isEn ? 'Undo (Ctrl+Z)' : '실행취소 (Ctrl+Z)'}
              style={{
                height: 24,
                minWidth: 26,
                padding: '0 6px',
                borderRadius: 4,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                fontSize: 13,
                fontWeight: 800,
                lineHeight: 1,
                cursor: canUndo ? 'pointer' : 'not-allowed',
                opacity: canUndo ? 1 : 0.4,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ↶
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              title={isEn ? 'Redo (Ctrl+Y)' : '다시실행 (Ctrl+Y)'}
              aria-label={isEn ? 'Redo (Ctrl+Y)' : '다시실행 (Ctrl+Y)'}
              style={{
                height: 24,
                minWidth: 26,
                padding: '0 6px',
                borderRadius: 4,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                fontSize: 13,
                fontWeight: 800,
                lineHeight: 1,
                cursor: canRedo ? 'pointer' : 'not-allowed',
                opacity: canRedo ? 1 : 0.4,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ↷
            </button>
            <CaseOutputsMenu compact unitCount={simDefs.length} />
          </div>
        </div>
      )}

      {/* ── 공정 텍스트(.bkp/.inp) 파일 가져오기 숨김 입력 ── */}
      <input
        type="file"
        accept=".bkp,.inp,.txt"
        ref={processTextInputRef}
        onChange={handleImportProcessText}
        style={{ display: 'none' }}
      />

      {/* ── 다른 이름으로 저장 및 파일 내보내기 바 ── */}
      {showProjectBar && (
        <div
          style={{
            padding: '8px 12px',
            background: '#F8FAFC',
            borderBottom: '1px solid #CBD5E1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#1E293B', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <SaveArchiveIcon size={12} /> {isEn ? 'Save As' : '다른 이름으로 저장'}
            </span>
            <input
              type="text"
              value={projectNameInput}
              onChange={e => setProjectNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveProject();
              }}
              placeholder={isEn ? 'Enter new case name...' : '새 케이스 이름 입력...'}
              style={{
                height: 26,
                padding: '0 8px',
                fontSize: 11,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#0F172A',
                minWidth: 200,
              }}
            />
            <button
              type="button"
              onClick={saveProject}
              style={{
                height: 26,
                padding: '0 12px',
                fontSize: 11,
                fontWeight: 800,
                borderRadius: 5,
                border: '1px solid #1E3A8A',
                background: '#1E3A8A',
                color: '#FFFFFF',
                cursor: 'pointer',
              }}
            >
              {isEn ? 'Save' : '저장'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleExportProcessText}
              title={isEn ? 'Export current process flowsheet as text (.inp)' : '현재 공정 플로우시트를 텍스트(.inp) 파일로 내보내기'}
              style={{
                height: 26,
                padding: '0 9px',
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                whiteSpace: 'nowrap',
              }}
            >
              <DownloadFileIcon size={12} /> {isEn ? 'Export .inp' : '.inp 내보내기'}
            </button>
            <button
              type="button"
              onClick={exportJson}
              style={{
                height: 26,
                padding: '0 9px',
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                whiteSpace: 'nowrap',
              }}
            >
              <DownloadFileIcon size={12} /> {isEn ? 'Export JSON' : 'JSON 파일 내보내기'}
            </button>
            <button
              type="button"
              onClick={() => setShowProjectBar(false)}
              title={isEn ? 'Close save bar' : '저장 바 닫기'}
              style={{
                height: 26,
                padding: '0 8px',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#64748B',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── 공정 텍스트 파일 입출력 알림 배너 ── */}
      {interopNotice && (
        <div
          style={{
            padding: '6px 12px',
            background: interopNotice.kind === 'error' ? '#FEF2F2' : '#EFF6FF',
            borderBottom: `1px solid ${interopNotice.kind === 'error' ? '#FECACA' : '#BFDBFE'}`,
            color: interopNotice.kind === 'error' ? '#991B1B' : '#1E3A8A',
            fontSize: 11,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 700 }}>{interopNotice.text}</span>
            {interopNotice.warnings && interopNotice.warnings.length > 0 && (
              <span style={{ fontSize: 10.5, color: '#92400E' }}>
                {isEn ? 'Note: ' : '참고: '}
                {interopNotice.warnings.slice(0, 3).join(' / ')}
                {interopNotice.warnings.length > 3
                  ? isEn
                    ? ` (+${interopNotice.warnings.length - 3} more)`
                    : ` 외 ${interopNotice.warnings.length - 3}건`
                  : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setInteropNotice(null)}
            title={isEn ? 'Dismiss notice' : '알림 닫기'}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              fontWeight: 800,
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              padding: '2px 4px',
            }}
          >
            ✕
          </button>
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
              simDefs={displaySimDefs}
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
                setRfNodes(prev => prev.map(n => (n.selected ? { ...n, selected: false } : n)));
                if (isMobile) setMobilePane('form');
              }}
              onSelectBlock={nodeId => {
                setSelectedKind('block');
                setSelectedId(nodeId);
                setRfNodes(prev =>
                  prev.map(n => {
                    const nextSel = n.id === nodeId;
                    return Boolean(n.selected) === nextSel ? n : { ...n, selected: nextSel };
                  })
                );
                if (isMobile) setMobilePane('form');
              }}
            />
          </div>
        )}

        {/* 2) 중앙 MDI 워크스페이스 (Main Flowsheet / Stream Summary / Control Panel / Block·Stream Datasheet) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {!isMobile && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '3px 8px 0',
                background: '#E2E8F0',
                borderBottom: '1px solid #CBD5E1',
                flexShrink: 0,
              }}
            >
              <div
                className="no-scrollbar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  overflowX: 'auto',
                  minWidth: 0,
                  flex: '1 1 auto',
                }}
              >
                {mdiTabs.map(tab => {
                  const isAct = activeMdiKey === tab.key;
                  const closable = tab.kind === 'block' || tab.kind === 'stream';
                  const tabBlk = tab.kind === 'block' && tab.refId ? simDefs.find(d => d.id === tab.refId) : undefined;
                  const displayTabTitle = tabBlk
                    ? formatEquipmentTag(tabBlk.tag, tabBlk.unitType, tagStandard)
                    : tab.title;
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
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        {tab.kind === 'pfd' ? (
                          <PfdSchematicIcon size={12} />
                        ) : tab.kind === 'summary' ? (
                          <TableGridIcon size={12} />
                        ) : tab.kind === 'control' ? (
                          <SlidersParamIcon size={12} />
                        ) : tab.kind === 'block' ? (
                          <VesselEquipIcon size={12} />
                        ) : (
                          <StreamFlowIcon size={12} />
                        )}
                      </span>
                      <span>{displayTabTitle}</span>
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
              <div style={{ flexShrink: 0, paddingBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title={isEn ? 'Undo (Ctrl+Z)' : '실행취소 (Ctrl+Z)'}
                  aria-label={isEn ? 'Undo (Ctrl+Z)' : '실행취소 (Ctrl+Z)'}
                  style={{
                    height: 24,
                    minWidth: 28,
                    padding: '0 7px',
                    borderRadius: 4,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#1E293B',
                    fontSize: 13,
                    fontWeight: 800,
                    lineHeight: 1,
                    cursor: canUndo ? 'pointer' : 'not-allowed',
                    opacity: canUndo ? 1 : 0.4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ↶
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title={isEn ? 'Redo (Ctrl+Y)' : '다시실행 (Ctrl+Y)'}
                  aria-label={isEn ? 'Redo (Ctrl+Y)' : '다시실행 (Ctrl+Y)'}
                  style={{
                    height: 24,
                    minWidth: 28,
                    padding: '0 7px',
                    borderRadius: 4,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#1E293B',
                    fontSize: 13,
                    fontWeight: 800,
                    lineHeight: 1,
                    cursor: canRedo ? 'pointer' : 'not-allowed',
                    opacity: canRedo ? 1 : 0.4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ↷
                </button>
                <CaseOutputsMenu compact unitCount={simDefs.length} />
              </div>
            </div>
          )}

          {((!isMobile && activeMdiKey === 'pfd') || (isMobile && mobilePane === 'pfd')) && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              <div
                ref={rfWrapperRef}
                onMouseDown={handleCanvasMouseDown}
                onContextMenu={e => {
                  if (suppressContextMenuRef.current) {
                    e.preventDefault();
                    suppressContextMenuRef.current = false;
                  }
                }}
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
                  selectionKeyCode={['Control', 'Meta', 'Shift']}
                  multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
                  selectionMode={SelectionMode.Partial}
                  onInit={inst => {
                    setRfInstance(inst);
                    setTimeout(() => inst.fitView({ padding: 0.14, duration: 200 }), 100);
                  }}
                  onNodesChange={onNodesChange}
                  onNodeDragStart={onNodeDragStart}
                  onNodeDragStop={onNodeDragStop}
                  onSelectionChange={onSelectionChange}
                  onPaneClick={() => {
                    if (selectedKind === 'block' || selectedKind === 'stream') {
                      setSelectedId(null);
                    }
                  }}
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
                      handleOpenMdiTab({
                        key: `block:${def.id}`,
                        kind: 'block',
                        title: formatEquipmentTag(def.tag, def.unitType, tagStandard),
                        refId: def.id,
                      });
                      if (isMobile) setMobilePane('form');
                    }
                  }}
                  onEdgeClick={(_, edge) => {
                    setSelectedKind('stream');
                    setSelectedId(edge.id);
                  }}
                  onNodesDelete={onNodesDelete}
                  onEdgesDelete={onEdgesDelete}
                  deleteKeyCode={['Backspace', 'Delete']}
                  fitView
                >
                  <Background color="#E2E8F0" gap={20} />
                  <Controls position="bottom-right" />
                </ReactFlow>

                {rmbBox && (
                  <div
                    style={{
                      position: 'absolute',
                      left: rmbBox.left,
                      top: rmbBox.top,
                      width: rmbBox.width,
                      height: rmbBox.height,
                      background: 'rgba(37, 99, 235, 0.12)',
                      border: '1.5px solid #2563EB',
                      borderRadius: 2,
                      pointerEvents: 'none',
                      zIndex: 50,
                    }}
                  />
                )}

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
                      {isEn ? 'Empty Flowsheet Canvas' : '빈 플로우시트 캔버스'}
                    </div>
                    <div style={{ fontSize: 11.5 }}>
                      {isEn
                        ? 'Click or drag blocks from the Model Palette below to build a flowsheet, or load a commercial process case from the Ribbon above.'
                        : '하단 Model Palette에서 블록을 클릭하거나 드래그하여 공정도를 구성하거나, 상단 Ribbon에서 상용 공정 케이스를 불러오세요.'}
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
                    title={
                      isEn
                        ? `${item.modelName} (${UNIT_EN_NAMES[item.unitType] ?? item.modelName}): Click or drag to add`
                        : `${item.modelName} (${item.koName}): 클릭 또는 드래그하여 추가`
                    }
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
                    <span style={{ fontSize: 9, color: '#64748B' }}>
                      {isEn ? (UNIT_EN_NAMES[item.unitType] ?? item.modelName) : item.koName}
                    </span>
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
              {isEn ? 'Stream Summary (Material & Energy Balance Table)' : 'Stream Summary (전체 스트림 물질·열수지 일람표)'}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace' }}>
                <thead>
                  <tr style={{ background: '#F1F5F9', borderBottom: '2px solid #CBD5E1' }}>
                    <th style={{ padding: '7px 10px', textAlign: 'left' }}>Stream</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left' }}>From → To</th>
                    <th style={{ padding: '7px 10px', textAlign: 'center' }}>Phase</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Temp
                        <UnitSelect quantity="temp" value={tempUnit} onChange={setTempUnit} size="xs" />
                      </span>
                    </th>
                    <th style={{ padding: '7px 10px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Press
                        <UnitSelect quantity="pressG" value={pressUnit} onChange={setPressUnit} size="xs" />
                      </span>
                    </th>
                    <th style={{ padding: '7px 10px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Mass Flow
                        <UnitSelect quantity="massFlow" value={massFlowUnit} onChange={setMassFlowUnit} size="xs" />
                      </span>
                    </th>
                    <th style={{ padding: '7px 10px', textAlign: 'left' }}>Composition (wt%)</th>
                  </tr>
                </thead>
                <tbody>
                  {solved.streams.map(st => {
                    const edge = flowEdges.find(e => e.id === st.edgeId);
                    const srcDef = simDefs.find(d => d.id === edge?.source);
                    const dstDef = simDefs.find(d => d.id === edge?.target);
                    const srcTag = srcDef ? formatEquipmentTag(srcDef.tag, srcDef.unitType, tagStandard) : '—';
                    const dstTag = dstDef ? formatEquipmentTag(dstDef.tag, dstDef.unitType, tagStandard) : '—';
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
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                          {formatCanonicalValue('temp', st.tempC, tempUnit, 1)}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                          {formatCanonicalValue('pressG', st.pressKgcm2g, pressUnit, 2)}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 800 }}>
                          {formatCanonicalValue('massFlow', st.totalMassKgH, massFlowUnit)}
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
                      {formatEquipmentTag(blk.tag, blk.unitType, tagStandard)} — {getModelName(blk.unitType)} Datasheet
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
                    <div style={{ fontSize: 11, color: '#334155', marginTop: 3 }}>
                      Out:{' '}
                      {outEdges
                        .map(e =>
                          e.sourcePort === 'side_cut'
                            ? `${e.streamNo}(${isEn ? 'Side-Cut S' : '측류 S'})`
                            : e.sourcePort === 'decanter'
                              ? `${e.streamNo}(${isEn ? 'Decanter' : '디캔터'})`
                              : e.streamNo
                        )
                        .join(', ') || 'None'}
                    </div>
                  </div>
                  <div style={{ padding: 10, border: '1px solid #CBD5E1', borderRadius: 5, background: '#F8FAFC' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#0F172A' }}>Block Results</div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <UnitSelect quantity="massFlow" value={massFlowUnit} onChange={setMassFlowUnit} size="xs" />
                        <UnitSelect quantity="heatDuty" value={heatDutyUnit} onChange={setHeatDutyUnit} size="xs" />
                        <UnitSelect quantity="power" value={powerUnit} onChange={setPowerUnit} size="xs" />
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                      Mass:{' '}
                      {bRes
                        ? `${formatCanonicalValue('massFlow', bRes.inletMassKgH, massFlowUnit)} -> ${formatCanonicalValue('massFlow', bRes.outletMassKgH, massFlowUnit)} ${getUnitLabel('massFlow', massFlowUnit)}`
                        : '—'}
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>
                      Duty:{' '}
                      {bRes
                        ? `${formatCanonicalValue('heatDuty', bRes.heatDutyKcalH / 1000, heatDutyUnit)} ${getUnitLabel('heatDuty', heatDutyUnit)}`
                        : '—'}{' '}
                      | Power:{' '}
                      {bRes
                        ? `${formatCanonicalValue('power', bRes.shaftPowerKW, powerUnit)} ${getUnitLabel('power', powerUnit)}`
                        : '—'}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#475569' }}>
                  {isEn
                    ? 'Detailed input parameters can be edited directly in the Inspector panel on the right.'
                    : '세부 입력 파라미터는 우측 Inspector 패널에서 즉시 수정할 수 있습니다.'}
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
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace', padding: 10, background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 5 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Temp: <b>{formatCanonicalValue('temp', st.tempC, tempUnit, 2)}</b>
                        <UnitSelect quantity="temp" value={tempUnit} onChange={setTempUnit} size="xs" />
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Press: <b>{formatCanonicalValue('pressG', st.pressKgcm2g, pressUnit, 3)}</b>
                        <UnitSelect quantity="pressG" value={pressUnit} onChange={setPressUnit} size="xs" />
                      </span>
                      <span>Phase: <b>{st.phase}</b></span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Total: <b>{formatCanonicalValue('massFlow', st.totalMassKgH, massFlowUnit)}</b>
                        <UnitSelect quantity="massFlow" value={massFlowUnit} onChange={setMassFlowUnit} size="xs" />
                      </span>
                    </div>
                    <table style={{ width: '100%', maxWidth: 520, borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                      <thead>
                        <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
                          <th style={{ padding: '5px 8px', textAlign: 'left' }}>Component</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right' }}>
                            Mass Flow ({getUnitLabel('massFlow', massFlowUnit)})
                          </th>
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
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                {formatCanonicalValue('massFlow', v ?? 0, massFlowUnit)}
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                {st.totalMassKgH > 0 ? (((v ?? 0) / st.totalMassKgH) * 100).toFixed(2) : '0.00'}%
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: '#64748B' }}>
                    {isEn ? 'No calculation results yet. Press ▶ Run (F5) to solve.' : '아직 계산 결과가 없습니다. ▶ Run (F5)을 실행하세요.'}
                  </div>
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
                    Components ({activeComponents.length} / {SIM_COMPS.length}{isEn ? '' : '종'})
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <FlaskCompIcon size={12} /> {isEn ? 'Open Full Setup' : '전체 설정 창 열기'}
                  </button>
                </div>
                <div style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.45 }}>
                  {isEn
                    ? 'Import components from commercial plant presets or freely select from 40+ validated general process components.'
                    : '상용 공장 프리셋에서 성분을 가져오거나, 범용 공정용 검증 물질(40종)을 자유롭게 선택하세요.'}
                </div>

                {/* 공장 프리셋 빠른 가져오기 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 7, borderRadius: 6, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#334155' }}>
                    {isEn ? 'Import by Plant Preset' : '공장별 성분 가져오기'}
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {PLANT_COMPONENT_PRESETS.filter(p => isPlantAllowed(p.plantId, user)).map(p => {
                      const shortName = isEn
                        ? (PLANT_PRESET_SHORT_EN[p.plantId] ?? p.plantId)
                        : p.labelKo.split(' ')[0];
                      return (
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
                          {showPlantNumbersForUser(user)
                            ? `${p.code.replace('PLANT ', 'P')} · ${shortName}`
                            : shortName}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 범용 스타터 팩 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 7, borderRadius: 6, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#334155' }}>
                    {isEn ? '🌐 General Component Packs' : '🌐 범용 물질 패키지'}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {GENERAL_COMPONENT_PACKS.filter(pk => !isSimulatorOnlyUser(user) || pk.id !== 'chlorinated_org').map(pk => (
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
                        {isEn ? (GENERAL_PACK_LABEL_EN[pk.id] ?? pk.id) : pk.labelKo.split(' (')[0]}
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
                            {isEn ? COMP_META[c].formula : COMP_META[c].label} · Tb {cat ? `${cat.tbC.toFixed(0)}°C` : '—'}
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
                    {isEn ? 'Property Methods (Thermodynamics)' : 'Property Methods (열역학 모델)'}
                  </div>
                  <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 999, background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0' }}>
                    {isEn ? 'Live Engine Sync' : '엔진 실시간 적용'}
                  </span>
                </div>

                {/* 자동 추천 근거 배너 */}
                <div style={{ padding: '7px 9px', borderRadius: 6, background: '#EEF2FF', border: '1px solid #C7D2FE', fontSize: 10.5, lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 800, color: '#3730A3', marginBottom: 2 }}>
                    {isEn
                      ? `🤖 System Recommended: ${PROPERTY_METHOD_EN[autoRecommended.method].short}`
                      : `🤖 계(System) 추천: ${PROPERTY_METHOD_INFO[autoRecommended.method].shortKo}`}
                  </div>
                  <div style={{ color: '#334155', fontSize: 10 }}>
                    {isEn ? PROPERTY_METHOD_EN[autoRecommended.method].bestFor : autoRecommended.reasonKo}
                  </div>
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
                          {m === 'AUTO'
                            ? isEn
                              ? `Auto Select (Current → ${autoRecommended.method})`
                              : `자동 선택 (현재 → ${autoRecommended.method})`
                            : isEn
                              ? PROPERTY_METHOD_EN[m].label
                              : info!.labelKo}
                        </div>
                        <div style={{ fontSize: 9.8, color: '#475569', marginTop: 2, lineHeight: 1.4 }}>
                          {m === 'AUTO'
                            ? isEn
                              ? 'Automatically selects the optimal thermodynamic model from active components, composition, and operating pressure.'
                              : '선택된 성분·조성·운전압력을 분석하여 최적 열역학 모델을 자동 선택합니다.'
                            : isEn
                              ? PROPERTY_METHOD_EN[m].bestFor
                              : info!.bestForKo}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {selectedKind === 'stream' && selectedEdge && (() => {
              const srcType = selectedEdgeSourceNode?.unitType;
              const basePortOptions: Array<{ value: SourcePortId; label: string }> =
                srcType === 'distillation'
                  ? [
                      { value: 'vapor', label: isEn ? 'Distillate / Vapor (Top)' : '탑정 제품 (Distillate / Vapor)' },
                      { value: 'side_cut', label: isEn ? 'Side-Cut Draw (S)' : '사이드컷 (중간발출 Side-Cut)' },
                      { value: 'liquid', label: isEn ? 'Bottoms / Liquid' : '탑저 제품 (Bottoms / Liquid)' },
                      { value: 'decanter', label: isEn ? 'Decanter Aqueous' : '공비 디캔터 수층 (Decanter Aqueous)' },
                    ]
                  : srcType === 'separator' ||
                      srcType === 'absorber' ||
                      srcType === 'extractor' ||
                      srcType === 'evaporator' ||
                      srcType === 'liquefier' ||
                      srcType === 'saturator' ||
                      srcType === 'desiccant_dryer'
                    ? [
                        { value: 'vapor', label: isEn ? 'Light / Vapor / Raffinate (Top)' : '경질 / 기상 / 추잔상 (Top)' },
                        { value: 'liquid', label: isEn ? 'Heavy / Liquid / Extract (Bottom)' : '중질 / 액상 / 추출상 (Bottom)' },
                        ...(srcType === 'separator'
                          ? [{ value: 'decanter' as SourcePortId, label: isEn ? 'Aqueous Layer (Decanter)' : '수층 분리 (Aqueous)' }]
                          : []),
                      ]
                    : srcType === 'splitter'
                      ? [
                          { value: 'vapor', label: isEn ? 'Branch 1 (Top / Ratio)' : '분기 1 (Top / Ratio)' },
                          { value: 'liquid', label: isEn ? 'Branch 2 (Bottom / 1-Ratio)' : '분기 2 (Bottom / 1-Ratio)' },
                        ]
                      : srcType === 'electrolyzer'
                        ? [
                            { value: 'anode_out', label: isEn ? 'Anode Out' : '양극 유출 (Anode Out)' },
                            { value: 'cathode_out', label: isEn ? 'Cathode Out' : '음극 유출 (Cathode Out)' },
                          ]
                        : srcType === 'hex' || srcType === 'cooler'
                          ? [
                              { value: 'out', label: isEn ? 'Process Out' : '주 출구 (Process Out)' },
                              { value: 'util_out', label: isEn ? 'Utility Out' : '유틸리티 출구 (Utility Out)' },
                              { value: 'vapor', label: isEn ? 'Vapor Out' : '기상 출구 (Vapor)' },
                              { value: 'liquid', label: isEn ? 'Liquid Out' : '액상 출구 (Liquid)' },
                            ]
                          : [{ value: 'out', label: isEn ? 'Main Outlet' : '주 출구 (Main Outlet)' }];
              const curPort = (selectedEdge.sourcePort ?? basePortOptions[0]?.value ?? 'out') as SourcePortId;
              const portOptions = basePortOptions.some(o => o.value === curPort)
                ? basePortOptions
                : [...basePortOptions, { value: curPort, label: isEn ? `Current Port (${curPort})` : `현재 포트 (${curPort})` }];

              return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 900, color: '#1D4ED8' }}>
                    Stream [{selectedEdge.streamNo}]
                    {selectedEdge.sourcePort === 'side_cut'
                      ? isEn ? ' · Side-Cut (S)' : ' · 사이드컷 측류(S)'
                      : selectedEdge.sourcePort === 'decanter'
                        ? isEn ? ' · Decanter Aqueous' : ' · 디캔터 수층'
                        : ''}
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
                    {isEn ? 'Delete' : '삭제'}
                  </button>
                </div>

                <div
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    background: '#F8FAFC',
                    border: '1px solid #CBD5E1',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: '#1E293B' }}>
                    {isEn ? 'Source Port Assignment' : '출구 포트 역할 변경 (Source Port)'}
                  </label>
                  <select
                    value={curPort}
                    onChange={e => {
                      pushUndoSnapshot();
                      const newPort = e.target.value as SourcePortId;
                      const nextEdges = flowEdges.map(ed =>
                        ed.id === selectedEdge.id ? { ...ed, sourcePort: newPort } : ed
                      );
                      setFlowEdges(nextEdges);

                      let nextDefs = simDefs;
                      if (
                        newPort === 'side_cut' &&
                        selectedEdgeSourceNode?.unitType === 'distillation' &&
                        !selectedEdgeSourceNode.params.distillConfig?.sideCut?.enabled
                      ) {
                        const baseDistCfg = selectedEdgeSourceNode.params.distillConfig ?? {};
                        const totalSt = baseDistCfg.totalStages ?? 20;
                        const autoSideCut: DistillSideCutConfig = {
                          ...(baseDistCfg.sideCut ?? {}),
                          id: baseDistCfg.sideCut?.id ?? 'SC-1',
                          enabled: true,
                          label: baseDistCfg.sideCut?.label ?? (isEn ? 'Side-Cut S' : '사이드컷 S'),
                          phase: baseDistCfg.sideCut?.phase ?? 'liquid',
                          autoOptimizeStage: false,
                          stage: baseDistCfg.sideCut?.stage ?? Math.max(3, Math.round(totalSt * 0.45)),
                          specType: baseDistCfg.sideCut?.specType ?? 's_over_f_mass',
                          specValue: baseDistCfg.sideCut?.specValue ?? 0.15,
                        };
                        nextDefs = simDefs.map(d =>
                          d.id === selectedEdgeSourceNode.id
                            ? {
                                ...d,
                                params: {
                                  ...d.params,
                                  calcMode: 'rigorous' as const,
                                  distillConfig: {
                                    ...baseDistCfg,
                                    sideCut: autoSideCut,
                                  },
                                },
                              }
                            : d
                        );
                        setSimDefs(nextDefs);
                      }

                      runSimulation(nextDefs, nextEdges);
                    }}
                    style={{
                      width: '100%',
                      height: 28,
                      padding: '0 6px',
                      borderRadius: 4,
                      border: '1px solid #94A3B8',
                      background: '#FFFFFF',
                      color: '#0F172A',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {portOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {selectedEdgeSourceNode && (
                    <div style={{ fontSize: 9.8, color: '#64748B' }}>
                      {isEn ? 'Connected Block: ' : '연결 블록: '}
                      <b>{formatEquipmentTag(selectedEdgeSourceNode.tag, selectedEdgeSourceNode.unitType, tagStandard)}</b> ({getModelName(selectedEdgeSourceNode.unitType)})
                    </div>
                  )}
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
                      {isEn
                        ? `Feed Conditions (${formatEquipmentTag(selectedEdgeSourceFeed.tag, selectedEdgeSourceFeed.unitType, tagStandard)} linked)`
                        : `원료 공급 조건 (${formatEquipmentTag(selectedEdgeSourceFeed.tag, selectedEdgeSourceFeed.unitType, tagStandard)} 연동 입력)`}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10, color: '#475569' }}>
                        <div style={{ marginBottom: 2 }}>{isEn ? 'Temperature' : '온도'}</div>
                        <UnitNumberInput
                          quantity="temp"
                          syncKey={`${selectedEdgeSourceFeed.id}:feedTempC`}
                          value={selectedEdgeSourceFeed.params.feedTempC ?? 25}
                          onValueChange={v =>
                            updateBlockDef(selectedEdgeSourceFeed.id, d => ({
                              ...d,
                              params: { ...d.params, feedTempC: v },
                            }))
                          }
                          inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                        />
                      </div>
                      <div style={{ fontSize: 10, color: '#475569' }}>
                        <div style={{ marginBottom: 2 }}>{isEn ? 'Pressure' : '압력'}</div>
                        <UnitNumberInput
                          quantity="pressG"
                          syncKey={`${selectedEdgeSourceFeed.id}:feedPress`}
                          value={selectedEdgeSourceFeed.params.feedPressKgcm2g ?? 1.0}
                          onValueChange={v =>
                            updateBlockDef(selectedEdgeSourceFeed.id, d => ({
                              ...d,
                              params: { ...d.params, feedPressKgcm2g: v },
                            }))
                          }
                          inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                        />
                      </div>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 11, color: '#0F172A' }}>
                        {isEn ? 'Calculated Stream Results' : '계산된 스트림 결과'}
                      </div>
                      <div style={{ display: 'inline-flex', gap: 3 }}>
                        <UnitSelect quantity="temp" value={tempUnit} onChange={setTempUnit} size="xs" />
                        <UnitSelect quantity="pressG" value={pressUnit} onChange={setPressUnit} size="xs" />
                        <UnitSelect quantity="massFlow" value={massFlowUnit} onChange={setMassFlowUnit} size="xs" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Source Port</span>
                      <b
                        style={{
                          fontFamily: 'Inter, sans-serif',
                          color:
                            selectedEdge.sourcePort === 'side_cut'
                              ? '#6D28D9'
                              : selectedEdge.sourcePort === 'decanter'
                                ? '#0284C7'
                                : '#0F172A',
                        }}
                      >
                        {selectedEdge.sourcePort === 'side_cut'
                          ? isEn ? 'Side-Cut (S)' : '사이드컷 측류(S)'
                          : selectedEdge.sourcePort === 'decanter'
                            ? isEn ? 'Decanter Aqueous' : '공비 디캔터 수층'
                            : selectedStreamRes.portRole || (isEn ? 'Main Line' : '주배관')}
                      </b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Phase</span>
                      <b>{selectedStreamRes.phase}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Temperature</span>
                      <b>{formatCanonicalValue('temp', selectedStreamRes.tempC, tempUnit, 1)} {getUnitLabel('temp', tempUnit)}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Pressure</span>
                      <b>{formatCanonicalValue('pressG', selectedStreamRes.pressKgcm2g, pressUnit, 2)} {getUnitLabel('pressG', pressUnit)}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Total Mass Flow</span>
                      <b>{formatCanonicalValue('massFlow', selectedStreamRes.totalMassKgH, massFlowUnit)} {getUnitLabel('massFlow', massFlowUnit)}</b>
                    </div>
                    <div style={{ borderTop: '1px dashed #CBD5E1', marginTop: 4, paddingTop: 4 }}>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#475569', marginBottom: 3 }}>
                        {isEn ? `Component Flows (${getUnitLabel('massFlow', massFlowUnit)})` : `성분별 유량 (${getUnitLabel('massFlow', massFlowUnit)})`}
                      </div>
                      {(Object.entries(selectedStreamRes.flowsKgH) as [string, number][])
                        .filter(([, v]) => v > 0.01)
                        .map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                            <span>{k}</span>
                            <span>
                              {formatCanonicalValue('massFlow', v, massFlowUnit)} ({selectedStreamRes.totalMassKgH > 0 ? ((v / selectedStreamRes.totalMassKgH) * 100).toFixed(1) : '0'}%)
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    {isEn ? 'Press ▶ Run to display calculation results.' : '▶ Run을 실행하면 계산 결과가 표시됩니다.'}
                  </div>
                )}
              </div>
              );
            })()}

            {selectedKind === 'block' && selectedBlock && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                      {formatEquipmentTag(selectedBlock.tag, selectedBlock.unitType, tagStandard)}
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
                    {isEn ? 'Delete Block' : '블록 삭제'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <label style={{ fontSize: 10, color: '#475569' }}>
                    {isEn ? 'Tag' : '태그 (Tag)'}
                    <input
                      type="text"
                      value={selectedBlock.tag}
                      onChange={e => updateBlockDef(selectedBlock.id, d => ({ ...d, tag: e.target.value }))}
                      style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1' }}
                    />
                  </label>
                  <label style={{ fontSize: 10, color: '#475569' }}>
                    {isEn ? 'Name' : '명칭'}
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
                  activePlantId={
                    activePlantId !== 'new_builder' && activePlantId !== 'classic_sim'
                      ? activePlantId
                      : undefined
                  }
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
                {selectedBlock.unitType === 'feed' && (() => {
                  const feedThermalMode: ThermalSpecMode = selectedBlock.params.thermalSpecMode ?? 'tp';
                  return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1E293B' }}>Feed Specifications</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        {isEn ? 'Thermal Spec Mode' : '열역학 지정 모드'}
                        <select
                          value={feedThermalMode}
                          onChange={e =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, thermalSpecMode: e.target.value as ThermalSpecMode },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 10.5 }}
                        >
                          {THERMAL_SPEC_MODE_OPTIONS.map(opt => (
                            <option key={opt.id} value={opt.id}>{isEn ? opt.labelEn : opt.labelKo}</option>
                          ))}
                        </select>
                      </label>
                      {feedThermalMode === 'tp' && (
                        <div style={{ fontSize: 10, color: '#475569' }}>
                          <div style={{ marginBottom: 2 }}>{isEn ? 'Temperature' : '온도'}</div>
                          <UnitNumberInput
                            quantity="temp"
                            syncKey={`${selectedBlock.id}:feedTempC`}
                            value={selectedBlock.params.feedTempC ?? 25}
                            onValueChange={v =>
                              updateBlockDef(selectedBlock.id, d => ({
                                ...d,
                                params: { ...d.params, feedTempC: v },
                              }))
                            }
                            inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                          />
                        </div>
                      )}
                      {feedThermalMode === 'subcool' && (
                        <label style={{ fontSize: 10, color: '#475569' }}>
                          {isEn ? 'Subcooling ΔT (°C, Bubble - ΔT)' : '과냉도 ΔT (°C, Bubble - ΔT)'}
                          <input
                            type="number"
                            step="0.5"
                            min={0}
                            value={selectedBlock.params.subcoolDeltaC ?? 5}
                            onChange={e =>
                              updateBlockDef(selectedBlock.id, d => ({
                                ...d,
                                params: { ...d.params, subcoolDeltaC: Math.max(0, Number(e.target.value)) },
                              }))
                            }
                            style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                          />
                        </label>
                      )}
                      {feedThermalMode === 'superheat' && (
                        <label style={{ fontSize: 10, color: '#475569' }}>
                          {isEn ? 'Superheat ΔT (°C, Dew + ΔT)' : '과열도 ΔT (°C, Dew + ΔT)'}
                          <input
                            type="number"
                            step="0.5"
                            min={0}
                            value={selectedBlock.params.superheatDeltaC ?? 10}
                            onChange={e =>
                              updateBlockDef(selectedBlock.id, d => ({
                                ...d,
                                params: { ...d.params, superheatDeltaC: Math.max(0, Number(e.target.value)) },
                              }))
                            }
                            style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                          />
                        </label>
                      )}
                      {feedThermalMode === 'vf' && (
                        <label style={{ fontSize: 10, color: '#475569' }}>
                          {isEn ? 'Target Vapor Fraction VF (0–1)' : '목표 기상분율 VF (0~1)'}
                          <input
                            type="number"
                            step="0.05"
                            min={0}
                            max={1}
                            value={selectedBlock.params.targetVaporFraction ?? 0.5}
                            onChange={e =>
                              updateBlockDef(selectedBlock.id, d => ({
                                ...d,
                                params: { ...d.params, targetVaporFraction: Math.min(1, Math.max(0, Number(e.target.value))) },
                              }))
                            }
                            style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                          />
                        </label>
                      )}
                      {(feedThermalMode === 'sat_liq' || feedThermalMode === 'sat_vap') && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#0369A1', background: '#E0F2FE', border: '1px solid #BAE6FD', borderRadius: 4, padding: '4px 6px' }}>
                          {feedThermalMode === 'sat_liq'
                            ? isEn
                              ? 'Saturated Liquid (Bubble Point): auto-calculated at P'
                              : '포화액 (Bubble Point): 압력 P 기준 자동 산출'
                            : isEn
                              ? 'Saturated Vapor (Dew Point): auto-calculated at P'
                              : '포화증기 (Dew Point): 압력 P 기준 자동 산출'}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: '#475569' }}>
                        <div style={{ marginBottom: 2 }}>{isEn ? 'Pressure' : '압력'}</div>
                        <UnitNumberInput
                          quantity="pressG"
                          syncKey={`${selectedBlock.id}:feedPress`}
                          value={selectedBlock.params.feedPressKgcm2g ?? 1.0}
                          onValueChange={v =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, feedPressKgcm2g: v },
                            }))
                          }
                          inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#334155' }}>
                        {isEn ? 'Component Mass Flows' : '성분별 질량유량'}
                        <UnitSelect quantity="massFlow" value={feedFlowUnit} onChange={setFeedFlowUnit} size="xs" />
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
                        {isEn ? `+ Add/Setup Components (${activeComponents.length})` : `+ 성분 추가/설정 (${activeComponents.length}종)`}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 240, overflowY: 'auto' }}>
                      {SIM_COMPS.filter(
                        comp => activeComponents.includes(comp) || (selectedBlock.params.feedFlowsKgH?.[comp] ?? 0) > 0
                      ).map(comp => {
                        const val = selectedBlock.params.feedFlowsKgH?.[comp] ?? 0;
                        return (
                          <div key={comp} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#475569' }} title={isEn ? COMP_META[comp].formula : COMP_META[comp].label}>
                            <span style={{ width: 64, flexShrink: 0, fontWeight: 700, color: val > 0 ? '#0F172A' : '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {comp}
                            </span>
                            <UnitNumberInput
                              quantity="massFlow"
                              syncKey={`${selectedBlock.id}:feedFlow:${comp}`}
                              value={val}
                              unitId={feedFlowUnit}
                              onUnitChange={setFeedFlowUnit}
                              minCanonical={0}
                              placeholder="0"
                              onValueChange={num => {
                                updateBlockDef(selectedBlock.id, d => ({
                                  ...d,
                                  params: {
                                    ...d.params,
                                    feedFlowsKgH: { ...(d.params.feedFlowsKgH ?? {}), [comp]: Math.max(0, num) },
                                  },
                                }));
                              }}
                              inputStyle={{
                                height: 24,
                                padding: '0 5px',
                                borderRadius: 4,
                                border: val > 0 ? '1px solid #1D4ED8' : '1px solid #CBD5E1',
                                background: '#FFFFFF',
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: 11,
                              }}
                              selectStyle={{ minWidth: 50, fontSize: 9.5 }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  );
                })()}

                {/* Flash2 / Separator / Cooler / HEX */}
                {(selectedBlock.unitType === 'separator' ||
                  selectedBlock.unitType === 'cooler' ||
                  selectedBlock.unitType === 'hex' ||
                  selectedBlock.unitType === 'liquefier') && (() => {
                  const showThermalSpec =
                    selectedBlock.unitType === 'separator'
                      ? selectedBlock.params.flashMode !== 'adiabatic'
                      : selectedBlock.params.hexSpecMode !== 'heat_duty';
                  const unitThermalMode: ThermalSpecMode = selectedBlock.params.thermalSpecMode ?? 'tp';
                  return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1E293B' }}>Operating Specifications</div>
                    {showThermalSpec && (
                      <>
                        <label style={{ fontSize: 10, color: '#475569' }}>
                          {isEn ? 'Thermal Spec Mode' : '열역학 지정 모드'}
                          <select
                            value={unitThermalMode}
                            onChange={e =>
                              updateBlockDef(selectedBlock.id, d => ({
                                ...d,
                                params: { ...d.params, thermalSpecMode: e.target.value as ThermalSpecMode },
                              }))
                            }
                            style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 10.5 }}
                          >
                            {THERMAL_SPEC_MODE_OPTIONS.map(opt => (
                              <option key={opt.id} value={opt.id}>{isEn ? opt.labelEn : opt.labelKo}</option>
                            ))}
                          </select>
                        </label>
                        {unitThermalMode === 'tp' && (
                          <div style={{ fontSize: 10, color: '#475569' }}>
                            <div style={{ marginBottom: 2 }}>{isEn ? 'Target Temperature' : '목표 온도'}</div>
                            <UnitNumberInput
                              quantity="temp"
                              syncKey={`${selectedBlock.id}:operTempC`}
                              value={selectedBlock.params.operTempC ?? 30}
                              onValueChange={v =>
                                updateBlockDef(selectedBlock.id, d => ({
                                  ...d,
                                  params: { ...d.params, operTempC: v },
                                }))
                              }
                              inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                            />
                          </div>
                        )}
                        {unitThermalMode === 'subcool' && (
                          <label style={{ fontSize: 10, color: '#475569' }}>
                            {isEn ? 'Subcooling ΔT (°C, Bubble - ΔT)' : '과냉도 ΔT (°C, Bubble - ΔT)'}
                            <input
                              type="number"
                              step="0.5"
                              min={0}
                              value={selectedBlock.params.subcoolDeltaC ?? 5}
                              onChange={e =>
                                updateBlockDef(selectedBlock.id, d => ({
                                  ...d,
                                  params: { ...d.params, subcoolDeltaC: Math.max(0, Number(e.target.value)) },
                                }))
                              }
                              style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                            />
                          </label>
                        )}
                        {unitThermalMode === 'superheat' && (
                          <label style={{ fontSize: 10, color: '#475569' }}>
                            {isEn ? 'Superheat ΔT (°C, Dew + ΔT)' : '과열도 ΔT (°C, Dew + ΔT)'}
                            <input
                              type="number"
                              step="0.5"
                              min={0}
                              value={selectedBlock.params.superheatDeltaC ?? 10}
                              onChange={e =>
                                updateBlockDef(selectedBlock.id, d => ({
                                  ...d,
                                  params: { ...d.params, superheatDeltaC: Math.max(0, Number(e.target.value)) },
                                }))
                              }
                              style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                            />
                          </label>
                        )}
                        {unitThermalMode === 'vf' && (
                          <label style={{ fontSize: 10, color: '#475569' }}>
                            {isEn ? 'Target Vapor Fraction VF (0–1)' : '목표 기상분율 VF (0~1)'}
                            <input
                              type="number"
                              step="0.05"
                              min={0}
                              max={1}
                              value={selectedBlock.params.targetVaporFraction ?? 0.5}
                              onChange={e =>
                                updateBlockDef(selectedBlock.id, d => ({
                                  ...d,
                                  params: { ...d.params, targetVaporFraction: Math.min(1, Math.max(0, Number(e.target.value))) },
                                }))
                              }
                              style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                            />
                          </label>
                        )}
                        {(unitThermalMode === 'sat_liq' || unitThermalMode === 'sat_vap') && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#0369A1', background: '#E0F2FE', border: '1px solid #BAE6FD', borderRadius: 4, padding: '4px 6px' }}>
                            {unitThermalMode === 'sat_liq'
                              ? isEn
                                ? 'Saturated Liquid (Bubble Point): auto-calculated at P'
                                : '포화액 (Bubble Point): 압력 P 기준 자동 산출'
                              : isEn
                                ? 'Saturated Vapor (Dew Point): auto-calculated at P'
                                : '포화증기 (Dew Point): 압력 P 기준 자동 산출'}
                          </div>
                        )}
                      </>
                    )}
                    {selectedBlock.unitType === 'separator' && (
                      <div style={{ fontSize: 10, color: '#475569' }}>
                        <div style={{ marginBottom: 2 }}>{isEn ? 'Operating Pressure' : '운전 압력'}</div>
                        <UnitNumberInput
                          quantity="pressG"
                          syncKey={`${selectedBlock.id}:operPress`}
                          value={selectedBlock.params.operPressKgcm2g ?? 0.5}
                          onValueChange={v =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, operPressKgcm2g: v },
                            }))
                          }
                          inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                        />
                      </div>
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
                        {isEn ? 'Open Rigorous HX Design & TEMA →' : '열교환기 정밀 설계 & TEMA 열기 →'}
                      </button>
                    )}
                  </div>
                  );
                })()}

                {/* Pump / Compressor */}
                {(selectedBlock.unitType === 'pump' || selectedBlock.unitType === 'compressor') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#F8FAFC', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1E293B' }}>Pressure / Efficiency</div>
                    <div style={{ fontSize: 10, color: '#475569' }}>
                      <div style={{ marginBottom: 2 }}>{isEn ? 'Discharge Pressure' : '토출 압력'}</div>
                      <UnitNumberInput
                        quantity="pressG"
                        syncKey={`${selectedBlock.id}:outletPress`}
                        value={selectedBlock.params.outletPressKgcm2g ?? 3.5}
                        onValueChange={v =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, outletPressKgcm2g: v },
                          }))
                        }
                        inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                      />
                    </div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      {isEn ? 'Efficiency (0–1)' : '효율 (0~1)'}
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
                      {isEn ? 'Top Split Fraction (0–1)' : '상부(Top) 분배율 (0~1)'}
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
                        {isEn
                          ? `Stages: ${selectedBlockRes.distillResult.totalStagesUsed} (F:${selectedBlockRes.distillResult.feedStageUsed}) · RR=${selectedBlockRes.distillResult.actualRefluxRatio.toFixed(2)}`
                          : `단수: ${selectedBlockRes.distillResult.totalStagesUsed}단 (F:${selectedBlockRes.distillResult.feedStageUsed}단) · RR=${selectedBlockRes.distillResult.actualRefluxRatio.toFixed(2)}`}
                      </div>
                    )}
                    {selectedBlock.params.distillConfig?.sideCut?.enabled && (() => {
                      const sc = selectedBlock.params.distillConfig!.sideCut!;
                      const dr = selectedBlockRes?.distillResult;
                      const scMass = dr?.sideCutMassKgH ?? 0;
                      const scStage = dr?.sideCutStageUsed ?? sc.stage;
                      const scPhase = dr?.sideCutPhase
                        ? (dr.sideCutPhase === 'G' ? (isEn ? 'Vapor' : '기상') : (isEn ? 'Liquid' : '액상'))
                        : (sc.phase === 'vapor' ? (isEn ? 'Vapor' : '기상') : (isEn ? 'Liquid' : '액상'));
                      return (
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: '#6D28D9',
                            fontWeight: 700,
                            background: '#F5F3FF',
                            border: '1px solid #DDD6FE',
                            borderRadius: 4,
                            padding: '4px 6px',
                          }}
                        >
                          {isEn ? `Side-Cut S: Stage ${scStage} (${scPhase})` : `사이드컷 측류 S: ${scStage}단 (${scPhase})`}
                          {scMass > 1e-4
                            ? ` · ${formatCanonicalValue('massFlow', scMass, massFlowUnit)} ${getUnitLabel('massFlow', massFlowUnit)} (S/F ${((dr?.actualSOverFMass ?? 0) * 100).toFixed(1)}%)`
                            : ` · ${sc.specType}=${sc.specValue}`}
                        </div>
                      );
                    })()}
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
                      {isEn ? 'Open Rigorous Column & Internals Workbench →' : '다단 증류 시뮬레이터 & 인터널 설계 열기 →'}
                    </button>
                  </div>
                )}

                {/* Reactor (화학반응기) */}
                {selectedBlock.unitType === 'reactor' && (() => {
                  const activePublicRx = PUBLIC_REACTOR_PRESET_SPECS.find(
                    s => s.id === selectedBlock.params.reactionPreset
                  );
                  return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#FEF2F2', borderRadius: 6, border: '1px solid #FECACA' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#991B1B' }}>
                      Reactor Specifications
                    </div>
                    {selectedBlock.params.reactorConfig && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: '#991B1B', fontWeight: 800 }}>
                        <span>
                          {isEn
                            ? `Rigorous Reactor Active (${String(selectedBlock.params.reactorConfig.model ?? 'stoic').toUpperCase()})`
                            : `정밀 반응기 활성 (${String(selectedBlock.params.reactorConfig.model ?? 'stoic').toUpperCase()})`}
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
                          {isEn ? 'Revert to Preset' : '프리셋 복귀'}
                        </button>
                      </div>
                    )}
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      {isEn ? 'Reaction Preset' : '반응 프리셋'}
                      <select
                        value={selectedBlock.params.reactionPreset ?? 'hcl_burner'}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: {
                              ...d.params,
                              reactionPreset: e.target.value as NonNullable<FlowNodeDef['params']['reactionPreset']>,
                            },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #FCA5A5', background: '#FFFFFF', fontSize: 10.5 }}
                      >
                        <optgroup label={isEn ? 'General Chemical Reaction Presets (6)' : '범용 화학 반응 프리셋 (6종)'}>
                          {PUBLIC_REACTOR_PRESET_SPECS.map(spec => (
                            <option key={spec.id} value={spec.id}>{isEn ? spec.labelEn : spec.labelKo}</option>
                          ))}
                        </optgroup>
                        <optgroup label={isEn ? 'Core Process Reactions' : '기본 공정 반응'}>
                          <option value="hcl_burner">{isEn ? 'HCl Synthesis Burner (Cl₂ + H₂ → 2HCl)' : '염산 합성로 (Cl₂ + H₂ → 2HCl)'}</option>
                          <option value="caustic_scrub">{isEn ? 'Caustic Neutralization Scrubber' : '가성소다 중화 스크러버'}</option>
                          <option value="brine_electrolysis">{isEn ? 'Brine Electrolysis (NaCl → NaOH+Cl₂+H₂)' : '염수 전해 반응 (NaCl → NaOH+Cl₂+H₂)'}</option>
                        </optgroup>
                      </select>
                    </label>
                    {activePublicRx && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '6px 7px', borderRadius: 5, background: '#FFFFFF', border: '1px solid #FECACA' }}>
                        <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#7F1D1D', lineHeight: 1.35 }}>
                          {activePublicRx.reactionEq}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 9.5, color: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}>
                            {activePublicRx.defaultTempC}°C · {activePublicRx.defaultPressKgcm2g} kG · {activePublicRx.defaultConvPct}%
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const spec = activePublicRx;
                              updateBlockDef(selectedBlock.id, d => ({
                                ...d,
                                params: {
                                  ...d.params,
                                  reactionPreset: spec.id as PublicReactorPresetId,
                                  operTempC: spec.defaultTempC,
                                  operPressKgcm2g: spec.defaultPressKgcm2g,
                                  conversion: Number((spec.defaultConvPct / 100).toFixed(4)),
                                },
                              }));
                            }}
                            style={{
                              padding: '3px 7px',
                              fontSize: 9.5,
                              fontWeight: 800,
                              borderRadius: 4,
                              border: '1px solid #DC2626',
                              background: '#DC2626',
                              color: '#FFFFFF',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            {isEn ? 'Apply Recommended' : '권장 조건 적용'}
                          </button>
                        </div>
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
                        border: '1px solid #1E293B',
                        background: '#1E293B',
                        color: '#FFFFFF',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                      }}
                    >
                      <FlaskCompIcon size={12} /> {isEn ? 'Open Rigorous Reactor Workbench →' : '반응기 정밀설계 워크벤치 열기 →'}
                    </button>
                    <div style={{ fontSize: 10, color: '#475569' }}>
                      <div style={{ marginBottom: 2 }}>{isEn ? 'Operating Temperature' : '운전 온도'}</div>
                      <UnitNumberInput
                        quantity="temp"
                        syncKey={`${selectedBlock.id}:reactorOperTempC`}
                        value={selectedBlock.params.operTempC ?? 180}
                        onValueChange={v =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, operTempC: v },
                          }))
                        }
                        inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: '#475569' }}>
                      <div style={{ marginBottom: 2 }}>{isEn ? 'Operating Pressure' : '운전 압력'}</div>
                      <UnitNumberInput
                        quantity="pressG"
                        syncKey={`${selectedBlock.id}:reactorOperPress`}
                        value={selectedBlock.params.operPressKgcm2g ?? 1.0}
                        onValueChange={v =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, operPressKgcm2g: v },
                          }))
                        }
                        inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                      />
                    </div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      {isEn ? 'Conversion (0–1)' : '전환율 (0~1)'}
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
                  );
                })()}

                {/* Electrolyzer (전해조 6종 프리셋) */}
                {selectedBlock.unitType === 'electrolyzer' && (() => {
                  const presetId: ElectrolyzerPresetId =
                    selectedBlock.params.electrolyzerPreset ?? 'nacl_chlor_alkali';
                  const presetSpec =
                    ELECTROLYZER_PRESET_SPECS.find(s => s.id === presetId) ?? ELECTROLYZER_PRESET_SPECS[0];
                  return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#EFF6FF', borderRadius: 6, border: '1px solid #BFDBFE' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1E40AF' }}>
                      Electrolyzer Specifications
                    </div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      {isEn ? 'Electrolysis Process Presets (6)' : '전해 공정 프리셋 (6종)'}
                      <select
                        value={presetId}
                        onChange={e =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: {
                              ...d.params,
                              electrolyzerPreset: e.target.value as ElectrolyzerPresetId,
                            },
                          }))
                        }
                        style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #93C5FD', background: '#FFFFFF', fontSize: 10.5 }}
                      >
                        {ELECTROLYZER_PRESET_SPECS.map(spec => (
                          <option key={spec.id} value={spec.id}>{isEn ? spec.labelEn : spec.labelKo}</option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 7px', borderRadius: 5, background: '#FFFFFF', border: '1px solid #BFDBFE' }}>
                      <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: '#1E3A8A' }}>
                        {presetSpec.reactionEq}
                      </div>
                      <div style={{ fontSize: 9.5, color: '#475569', lineHeight: 1.35 }}>
                        {isEn ? ELECTROLYZER_NOTE_EN[presetSpec.id] : presetSpec.noteKo}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 9.5, color: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}>
                          {presetSpec.defaultVoltageV}V · {presetSpec.defaultCurrentKA}kA · {presetSpec.defaultCells}{isEn ? ' cells' : '셀'} · {presetSpec.defaultEffPct}%
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: {
                                ...d.params,
                                electrolyzerPreset: presetSpec.id,
                                cellVoltageV: presetSpec.defaultVoltageV,
                                currentKA: presetSpec.defaultCurrentKA,
                                cellCount: presetSpec.defaultCells,
                                operTempC: presetSpec.defaultTempC,
                                operPressKgcm2g: presetSpec.defaultPressKgcm2g,
                                currentEffPct: presetSpec.defaultEffPct,
                              },
                            }))
                          }
                          style={{
                            padding: '3px 7px',
                            fontSize: 9.5,
                            fontWeight: 800,
                            borderRadius: 4,
                            border: '1px solid #1D4ED8',
                            background: '#1D4ED8',
                            color: '#FFFFFF',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {isEn ? 'Apply Recommended' : '권장 조건 적용'}
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        {isEn ? 'Cell Voltage (V)' : '셀 전압 (V)'}
                        <input
                          type="number"
                          step="0.05"
                          min={1.0}
                          max={6.0}
                          value={selectedBlock.params.cellVoltageV ?? presetSpec.defaultVoltageV}
                          onChange={e =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, cellVoltageV: Number(e.target.value) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                        />
                      </label>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        {isEn ? 'Current (kA)' : '전류 (kA)'}
                        <input
                          type="number"
                          step="0.2"
                          min={0.1}
                          value={selectedBlock.params.currentKA ?? presetSpec.defaultCurrentKA}
                          onChange={e =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, currentKA: Math.max(0.1, Number(e.target.value)) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                        />
                      </label>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        {isEn ? 'Cell Count (cells)' : '셀 수 (cells)'}
                        <input
                          type="number"
                          step="1"
                          min={1}
                          value={selectedBlock.params.cellCount ?? presetSpec.defaultCells}
                          onChange={e =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, cellCount: Math.max(1, Math.round(Number(e.target.value))) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                        />
                      </label>
                      <label style={{ fontSize: 10, color: '#475569' }}>
                        {isEn ? 'Current Efficiency (%)' : '전류 효율 (%)'}
                        <input
                          type="number"
                          step="0.5"
                          min={50}
                          max={100}
                          value={selectedBlock.params.currentEffPct ?? presetSpec.defaultEffPct}
                          onChange={e =>
                            updateBlockDef(selectedBlock.id, d => ({
                              ...d,
                              params: { ...d.params, currentEffPct: Math.min(100, Math.max(50, Number(e.target.value))) },
                            }))
                          }
                          style={{ width: '100%', height: 26, marginTop: 2, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                        />
                      </label>
                    </div>
                    <div style={{ fontSize: 10, color: '#475569' }}>
                      <div style={{ marginBottom: 2 }}>{isEn ? 'Operating Temperature' : '운전 온도'}</div>
                      <UnitNumberInput
                        quantity="temp"
                        syncKey={`${selectedBlock.id}:elOperTempC`}
                        value={selectedBlock.params.operTempC ?? presetSpec.defaultTempC}
                        onValueChange={v =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, operTempC: v },
                          }))
                        }
                        inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: '#475569' }}>
                      <div style={{ marginBottom: 2 }}>{isEn ? 'Operating Pressure' : '운전 압력'}</div>
                      <UnitNumberInput
                        quantity="pressG"
                        syncKey={`${selectedBlock.id}:elOperPress`}
                        value={selectedBlock.params.operPressKgcm2g ?? presetSpec.defaultPressKgcm2g}
                        onValueChange={v =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, operPressKgcm2g: v },
                          }))
                        }
                        inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                      />
                    </div>
                  </div>
                  );
                })()}

                {/* Absorber (흡수탑 · 스트리퍼) */}
                {selectedBlock.unitType === 'absorber' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#FAF5FF', borderRadius: 6, border: '1px solid #E9D5FF' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#5B21B6' }}>
                      Absorber / Stripper Specifications
                    </div>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      {isEn ? 'Calculation Algorithm' : '해석 알고리즘'}
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
                        <option value="kremser">{isEn ? 'Kremser / Chemical Absorption Balance' : 'Kremser / 화학흡수 수지'}</option>
                        <option value="rigorous_mesh">{isEn ? 'Rigorous Multi-Stage MESH Counter-Current VLE' : '엄밀 다단 MESH 향류 기액평형'}</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 10, color: '#475569' }}>
                      {isEn ? 'Theoretical Stages N' : '이론 단수 N (단)'}
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
                      {isEn ? 'Theoretical Extraction Stages N' : '이론 추출 단수 N'}
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
                    <div style={{ fontSize: 10, color: '#475569' }}>
                      <div style={{ marginBottom: 2 }}>{isEn ? 'Operating Temperature' : '운전 온도'}</div>
                      <UnitNumberInput
                        quantity="temp"
                        syncKey={`${selectedBlock.id}:extractorOperTempC`}
                        value={selectedBlock.params.operTempC ?? 25}
                        onValueChange={v =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, operTempC: v },
                          }))
                        }
                        inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                      />
                    </div>
                  </div>
                )}

                {/* Valve (단열 등엔탈피 감압·교축 밸브) */}
                {selectedBlock.unitType === 'valve' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, background: '#FFFBEB', borderRadius: 6, border: '1px solid #FDE68A' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#B45309' }}>
                      JT Expansion Valve (H_out = H_in)
                    </div>
                    <div style={{ fontSize: 10, color: '#475569' }}>
                      <div style={{ marginBottom: 2 }}>{isEn ? 'Outlet Pressure P_out' : '후단 토출 압력 P_out'}</div>
                      <UnitNumberInput
                        quantity="pressG"
                        syncKey={`${selectedBlock.id}:valveOutletPress`}
                        minCanonical={-0.98}
                        value={selectedBlock.params.outletPressKgcm2g ?? 1.0}
                        onValueChange={v =>
                          updateBlockDef(selectedBlock.id, d => ({
                            ...d,
                            params: { ...d.params, outletPressKgcm2g: v },
                          }))
                        }
                        inputStyle={{ height: 26, padding: '0 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 11 }}
                      />
                    </div>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800, color: '#0F172A' }}>Block Results</div>
                      <div style={{ display: 'inline-flex', gap: 3 }}>
                        <UnitSelect quantity="massFlow" value={massFlowUnit} onChange={setMassFlowUnit} size="xs" />
                        <UnitSelect quantity="heatDuty" value={heatDutyUnit} onChange={setHeatDutyUnit} size="xs" />
                        <UnitSelect quantity="power" value={powerUnit} onChange={setPowerUnit} size="xs" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{isEn ? 'Inlet / Outlet' : '유입 / 유출'}</span>
                      <b style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        {formatCanonicalValue('massFlow', selectedBlockRes.inletMassKgH, massFlowUnit)} /{' '}
                        {formatCanonicalValue('massFlow', selectedBlockRes.outletMassKgH, massFlowUnit)}{' '}
                        {getUnitLabel('massFlow', massFlowUnit)}
                      </b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{isEn ? 'Heat Duty' : '열부하 (Duty)'}</span>
                      <b style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        {formatCanonicalValue('heatDuty', selectedBlockRes.heatDutyKcalH / 1000, heatDutyUnit)}{' '}
                        {getUnitLabel('heatDuty', heatDutyUnit)}
                      </b>
                    </div>
                    {selectedBlockRes.shaftPowerKW > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{isEn ? 'Shaft Power' : '축동력 (Power)'}</span>
                        <b style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                          {formatCanonicalValue('power', selectedBlockRes.shaftPowerKW, powerUnit)}{' '}
                          {getUnitLabel('power', powerUnit)}
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
                {isEn
                  ? 'Select a stream or block from the Explorer Tree or Canvas to view and edit specifications and results.'
                  : '좌측 탐색 트리 또는 캔버스에서 스트림이나 블록을 선택하면 입력·결과 폼이 표시됩니다.'}
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
        const nSt = Math.max(4, Math.min(200, Math.round(modalCfg.totalStages ?? 24)));
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
              pushParamEditSnapshot(modalDef.id);
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
              pushParamEditSnapshot(modalDef.id);
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
          pushUndoSnapshot();
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
              pushUndoSnapshot();
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

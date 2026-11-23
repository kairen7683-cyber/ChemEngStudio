'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  Connection,
  ConnectionMode,
  SelectionMode,
  Edge,
  Node,
  NodeProps,
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
  UnitCalcMode,
  SourcePortId,
  TargetPortId,
  RefrigerantPresetKey,
  REFRIGERANT_PRESETS,
  isVisualOnlyUnit,
  cl2DewPointTempC,
  emptySimFlows,
  createIdleFlowsheetResult,
  solveFlowsheet,
  type SolvedStream,
  type TearSolverMethod,
} from '@/lib/calculations/flowsheetSolver';

type FlowsheetSolveResult = ReturnType<typeof solveFlowsheet>;
import HorizontalFlowsheetStreamTable from '@/components/pfd/HorizontalFlowsheetStreamTable';
import DistillationWorkbenchModal from '@/components/flowsheet/DistillationWorkbenchModal';
import ComponentPropertySetupModal from '@/components/flowsheet/ComponentPropertySetupModal';
import FlowsheetOptimizationModal from '@/components/flowsheet/FlowsheetOptimizationModal';
import ReactorWorkbenchModal from '@/components/flowsheet/ReactorWorkbenchModal';
import type { DesignSpecDef } from '@/lib/calculations/flowsheetOptimization';
import PlantUnitCopyBox from '@/components/flowsheet/PlantUnitCopyBox';
import FlowsheetBalanceSummary from '@/components/flowsheet/FlowsheetBalanceSummary';
import ConvergenceReportPanel from '@/components/flowsheet/ConvergenceReportPanel';
import HeatExchangerWorkbenchModal, {
  type HxWorkbenchView,
} from '@/components/flowsheet/HeatExchangerWorkbenchModal';
import { ClassicUnitSvg } from '@/components/classic-sim/ClassicBlockNode';
import BufferedNumberInput from '@/components/common/BufferedNumberInput';
import {
  type DistillColumnParams,
  type DistillFeedInput,
} from '@/lib/calculations/rigorousDistillation';
import {
  type SimPropertyMethod,
  type ResolvedPropertyMethod,
  getPlantDefaultComponents,
  recommendPropertyMethod,
} from '@/lib/calculations/componentCatalog';
import {
  SheetRuntimeData,
  createInitialHierarchySheets,
  applyMasterBoundaryToSubDefs,
  rollupSubSheetToMasterDefs,
} from '@/lib/calculations/fullPlantHierarchy';
import { createInitialHcl1AHierarchySheets } from '@/lib/calculations/hcl1AHierarchy';
import { createInitialEchHierarchySheets } from '@/lib/calculations/echPlantHierarchy';
import {
  createInitialCmsHierarchySheets,
  syncCmsSubDefsFromMaster,
} from '@/lib/calculations/cmsPlantHierarchy';
import {
  createInitialMdiHierarchySheets,
  syncMdiSubDefsFromMaster,
} from '@/lib/calculations/mdiPlantHierarchy';
import { useAuth } from '@/components/auth/AuthContext';
import { PLANT_GROUP_TO_ID, isPlantAllowed, isSimulatorOnlyUser, formatPlantLabelForUser } from '@/lib/plantRegistry';
import { useBalanceStore, type PlantId } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { useUnitStore } from '@/lib/stores/unitStore';
import {
  UnitNumberInput,
  UnitNullableNumberInput,
  UnitSelect,
  useLocalUnit,
} from '@/components/units/UnitControls';
import {
  formatCanonicalValue,
  getUnitLabel,
} from '@/lib/units/unitSystem';
import {
  getDefaultTagPrefix,
  formatEquipmentTag,
} from '@/lib/units/tagNaming';
import {
  PfdSchematicIcon,
  StreamFlowIcon,
  VesselEquipIcon,
  FitFrameIcon,
  PlusSquareIcon,
  FlaskCompIcon,
  SpecControlIcon,
  SaveArchiveIcon,
  ColumnInternalIcon,
  HexCircleIcon,
  SlidersParamIcon,
  SubprocessTreeIcon,
  FolderOpenIcon,
  DownloadFileIcon,
  TableGridIcon,
  CardsStackIcon,
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
  getUnitDesignRouteInfo,
  buildChemProHandoffPayload,
  saveChemProHandoffPayload,
} from '@/lib/calculations/unitDesignHandoff';

// ── 모드별 분리 영구 자동저장 키 (PLANT 01 ↔ PLANT 02 ↔ PLANT 03 ↔ PLANT 04 ↔ PLANT 05 ↔ 공정 시뮬레이터 완전 격리) ──
const PLANT02_AUTO_SAVE_KEY = 'chemplant-plant02-electrolyzer-v2';
const PLANT03_AUTO_SAVE_KEY = 'chemplant-plant03-hcl1a-v2';
const PLANT04_AUTO_SAVE_KEY = 'chemplant-plant04-ech-v1';
const PLANT05_AUTO_SAVE_KEY = 'chemplant-plant05-cms-v2';
const PLANT06_AUTO_SAVE_KEY = 'chemplant-plant06-mdi-v1';
const BUILDER_AUTO_SAVE_KEY = 'chemplant-newplant-builder-v1';

// ── 포트 방향 판별 (양방향 드래그 연결 시 자동 입·출구 정렬용) ──
const INLET_PORT_SET = new Set<string>(['in', 'anode_in', 'cathode_in', 'liq_in', 'util_in', 'solvent']);
const OUTLET_PORT_SET = new Set<string>(['out', 'vapor', 'liquid', 'side_cut', 'decanter', 'anode_out', 'cathode_out', 'util_out', 'out1', 'out2']);

// ── 장치 카탈로그 메타데이터 ──────────────────────────────────
interface UnitCatalogItem {
  type: FlowUnitType;
  category: 'calc' | 'visual';
  label: string;
  tagPrefix: string;
  color: string;
  badge: string;
  desc: string;
}

const UNIT_CATALOG: UnitCatalogItem[] = [
  // ① 시뮬레이션 수지·상평형 계산 장치 및 물질 흐름 블록 (Active Units & Material Streams)
  { type: 'feed',            category: 'calc', label: '유입 스트림 (Feed)',     tagPrefix: 'S-IN',  color: '#059669', badge: '유입류➔', desc: '장치 없이 단독 유입 유량·조성·온도·압력을 지정하는 물질 유입 흐름 블록' },
  { type: 'saturator',       category: 'calc', label: '포화조 · 1차 침전정제', tagPrefix: 'D',    color: '#0369A1', badge: '1차정제', desc: '원염 자동 포화(25.6 wt%) 및 약품침전 슬러지 분리' },
  { type: 'chelate_tower',   category: 'calc', label: '2차 킬레이트 수지탑',   tagPrefix: 'T',    color: '#0D9488', badge: '2차수지', desc: '이온교환 킬레이트 수지 정제 (Ca+Mg < 20 ppb 초고순도 염수)' },
  { type: 'electrolyzer',    category: 'calc', label: '이온교환막 전해조',     tagPrefix: 'EL',   color: '#0F766E', badge: '전해',    desc: '양극 In/Out · 음극 In/Out 패러데이 전해 수지' },
  { type: 'separator',       category: 'calc', label: '기액분리기 (Flash)',    tagPrefix: 'D',    color: '#1E3A8A', badge: 'VLE',     desc: '상부 기상(G↑) / 하부 액상(L↓) 상평형 자동 분리' },
  { type: 'distillation',    category: 'calc', label: '다단 정밀증류탑',       tagPrefix: 'C',    color: '#4338CA', badge: '정밀증류', desc: '목표순도 기반 단수·유량 자동설계 및 단별 MESH 기액평형 증류탑' },
  { type: 'absorber',        category: 'calc', label: '건조탑 · 흡수탑',       tagPrefix: 'T',    color: '#5B21B6', badge: '컬럼',    desc: 'H₂O 황산건조 / HCl 흡수 / Cl₂ 가성제해 및 엄밀 MESH 흡수탑' },
  { type: 'extractor',       category: 'calc', label: '액-액 추출탑 (LLE)',    tagPrefix: 'EX',   color: '#7C3AED', badge: 'LLE추출', desc: '향류 다단 액-액 추출탑 (추출상 Extract↑ / 추잔상 Raffinate↓)' },
  { type: 'desiccant_dryer', category: 'calc', label: '실리카겔 흡착 제습탑',   tagPrefix: 'D',    color: '#4338CA', badge: '제습탑',  desc: '고압 수소 등 수분 흡착 제습 (노점 -60°C 이하)' },
  { type: 'compressor',      category: 'calc', label: '가스 압축기',          tagPrefix: 'C',    color: '#0369A1', badge: '승압',    desc: '염소·수소 승압 및 압축 후 Cl₂ 액화 이슬점 계산' },
  { type: 'liquefier',       category: 'calc', label: '염소/가스 액화기',      tagPrefix: 'LQ',   color: '#0284C7', badge: '액화',    desc: '프레온·브라인 냉매 기반 Cl₂ 이슬점 판별 및 상평형 액화' },
  { type: 'hex',             category: 'calc', label: '열교환기 · 냉각기',     tagPrefix: 'E',    color: '#B45309', badge: '열수지',  desc: '냉각수·칠드워터·스팀 열교환 및 수증기 응축 계산' },
  { type: 'pump',            category: 'calc', label: '원심 펌프',            tagPrefix: 'P',    color: '#1D4ED8', badge: '이송',    desc: '액상 브라인·가성소다 승압 및 축동력 산출' },
  { type: 'valve',           category: 'calc', label: '감압·교축 밸브 (JT)',   tagPrefix: 'PCV',  color: '#D97706', badge: 'JT감압',  desc: '단열 등엔탈피(PH) 감압·교축 및 Joule-Thomson 2상 플래시 밸브' },
  { type: 'evaporator',      category: 'calc', label: '강하막 증발관',         tagPrefix: 'EV',   color: '#9A3412', badge: '농축',    desc: '가성소다 등 목표 wt% 농축 및 증발 수증기 계산' },
  { type: 'reactor',         category: 'calc', label: '합성로 · 반응기',       tagPrefix: 'R',    color: '#991B1B', badge: '반응',    desc: 'HCl 합성 / 가성소다 제해 화학양론 반응' },
  { type: 'mixer',           category: 'calc', label: '배관 혼합기 (Mixer)',   tagPrefix: 'M',    color: '#374151', badge: '합류',    desc: '복수 배관 유량·엔탈피 합산 및 헤더 배수' },
  { type: 'splitter',        category: 'calc', label: '배관 분기기 (Tee)',     tagPrefix: 'SP',   color: '#4B5563', badge: '분기',    desc: '지정 분기비(%)로 2개 배관 분할' },
  { type: 'product',         category: 'calc', label: '유출 스트림 (Out)',      tagPrefix: 'S-OUT', color: '#1D4ED8', badge: '➔유출류', desc: '장치 출구 유량·순도·온도 결과를 수취하거나 후단으로 전달하는 물질 유출 흐름 블록' },

  // ② 단순 도면 표기 전용 장치 (Visual Pass-Through Icons)
  { type: 'tank_visual',   category: 'visual', label: '수직 저장탱크',      tagPrefix: 'TK',  color: '#64748B', badge: '도면', desc: '단순 도면 표기용 수직 저장조 (유량·조성 그대로 통과)' },
  { type: 'h_drum_visual', category: 'visual', label: '수평 저장드럼',      tagPrefix: 'V',   color: '#64748B', badge: '도면', desc: '액화염소 수평 저장드럼 등 도면 표기용 (그대로 통과)' },
  { type: 'filter_visual', category: 'visual', label: '여과기 · 수지탑',    tagPrefix: 'F',   color: '#64748B', badge: '도면', desc: '단순 도면 표기용 필터·여과기 (유량 그대로 통과)' },
  { type: 'valve_visual',  category: 'visual', label: '조절 밸브',          tagPrefix: 'XV',  color: '#64748B', badge: '도면', desc: '단순 도면 표기용 감압·차단 밸브' },
];

type PaletteGroupKey = 'column_sep' | 'heat_evap' | 'press_move' | 'react_elec' | 'io_pipe' | 'visual_aux';

const PALETTE_GROUPS: Array<{ key: PaletteGroupKey; label: string; types: FlowUnitType[] }> = [
  { key: 'column_sep', label: '증류·흡수·추출탑', types: ['distillation', 'absorber', 'extractor', 'separator', 'desiccant_dryer'] },
  { key: 'heat_evap',  label: '열교환·액화·증발', types: ['hex', 'liquefier', 'evaporator'] },
  { key: 'press_move', label: '펌프·압축·감압',   types: ['pump', 'compressor', 'valve'] },
  { key: 'react_elec', label: '반응·전해·정제',   types: ['reactor', 'electrolyzer', 'saturator', 'chelate_tower'] },
  { key: 'io_pipe',    label: '공급·혼합·출구',   types: ['feed', 'mixer', 'splitter', 'product'] },
  { key: 'visual_aux', label: '탱크·밸브(도면)',  types: ['tank_visual', 'h_drum_visual', 'filter_visual', 'valve_visual'] },
];

const SHORT_CLASSIC_PALETTE_LABEL: Partial<Record<FlowUnitType, string>> = {
  feed: '유입',
  product: '유출',
  distillation: '증류탑',
  absorber: '흡수·건조탑',
  extractor: '추출탑',
  separator: '기액분리기',
  desiccant_dryer: '제습탑',
  hex: '열교환기',
  cooler: '냉각기',
  liquefier: '액화기',
  evaporator: '증발관',
  pump: '펌프',
  compressor: '압축기',
  valve: '감압밸브',
  reactor: '반응기',
  electrolyzer: '전해조',
  saturator: '포화조',
  chelate_tower: '수지탑',
  mixer: '혼합기',
  splitter: '분기기',
  tank_visual: '저장탱크',
  h_drum_visual: '저장드럼',
  filter_visual: '여과기',
  valve_visual: '조절밸브',
};

// ── 전해 PFD(EquipmentNodes.tsx)와 100% 동일한 CAD SVG 심볼 렌더러 ──
function PfdEquipmentSvg({
  type,
  strokeColor,
  scale = 1,
}: {
  type: FlowUnitType;
  strokeColor: string;
  scale?: number;
}) {
  const s = strokeColor;
  const visual = isVisualOnlyUnit(type);
  const fillBg = visual ? '#F8FAFC' : '#FFFFFF';
  const subStroke = visual ? '#94A3B8' : '#64748B';

  switch (type) {
    // 1. 이온교환막 전해조 (Electrolyzer — 96×62)
    case 'electrolyzer':
      return (
        <svg width={Math.round(88 * scale)} height={Math.round(56 * scale)} viewBox="0 0 96 62">
          <rect x={4} y={5} width={5} height={46} rx={1} fill={s} />
          <rect x={87} y={5} width={5} height={46} rx={1} fill={s} />
          <line x1={9} y1={11} x2={87} y2={11} stroke={s} strokeWidth={1.3} />
          <line x1={9} y1={45} x2={87} y2={45} stroke={s} strokeWidth={1.3} />
          <rect x={9} y={8} width={78} height={40} fill={fillBg} stroke={s} strokeWidth={1.8} />
          {[19, 28, 37, 59, 68, 77].map(x => (
            <line key={x} x1={x} y1={9} x2={x} y2={47} stroke="#CBD5E1" strokeWidth={0.9} />
          ))}
          <line x1={48} y1={8} x2={48} y2={48} stroke="#0284C7" strokeWidth={2.2} strokeDasharray="4,2" />
          <rect x={13} y={13} width={22} height={11} rx={2} fill="#ECFDF5" stroke="#059669" strokeWidth={0.9} />
          <text x={24} y={21} textAnchor="middle" fontSize={7.5} fontWeight={800} fill="#059669">AN+</text>
          <rect x={61} y={13} width={22} height={11} rx={2} fill="#FFF7ED" stroke="#EA580C" strokeWidth={0.9} />
          <text x={72} y={21} textAnchor="middle" fontSize={7.5} fontWeight={800} fill="#EA580C">CA-</text>
          <path d="M16 48 L12 58 M24 48 L24 58 M72 48 L72 58 M80 48 L84 58" stroke={s} strokeWidth={1.6} />
          <line x1={8} y1={58} x2={88} y2={58} stroke={s} strokeWidth={1.6} />
        </svg>
      );

    // 2. 기액분리기 (Separator — 38×70)
    case 'separator':
      return (
        <svg width={Math.round(36 * scale)} height={Math.round(64 * scale)} viewBox="0 0 38 70">
          <line x1={19} y1={1} x2={19} y2={5} stroke={s} strokeWidth={2} />
          <line x1={15} y1={1} x2={23} y2={1} stroke={s} strokeWidth={2} />
          <path d="M5 11 A14 6 0 0 1 33 11 L33 56 A14 6 0 0 1 5 56 Z" fill={fillBg} stroke={s} strokeWidth={1.8} />
          <rect x={6} y={16} width={26} height={7} fill="#F1F5F9" stroke={subStroke} strokeWidth={0.9} />
          <path d="M6 16 L13 23 M13 16 L20 23 M20 16 L27 23 M27 16 L32 21 M13 16 L6 23 M20 16 L13 23 M27 16 L20 23" stroke={subStroke} strokeWidth={0.8} />
          <path d="M5 33 L16 33 L16 38" fill="none" stroke={s} strokeWidth={1.4} />
          <line x1={6} y1={44} x2={32} y2={44} stroke="#0284C7" strokeWidth={1.3} strokeDasharray="3,2" />
          <polygon points="19,44 16,39 22,39" fill="none" stroke="#0284C7" strokeWidth={1} />
          <path d="M9 60 L7 68 M29 60 L31 68 M5 68 L33 68" stroke={s} strokeWidth={1.6} />
        </svg>
      );

    // 3-A. 엄밀 다단 정밀증류탑 (Rigorous Multi-Stage Tray Column + Condenser & Reboiler — 48×86)
    case 'distillation':
      return (
        <svg width={Math.round(46 * scale)} height={Math.round(78 * scale)} viewBox="0 0 48 86">
          {/* 탑정 오버헤드 응축 라인 + 환류 드럼 */}
          <path d="M20 7 L20 2 L41 2 L41 10" fill="none" stroke="#4338CA" strokeWidth={1.4} />
          <circle cx={41} cy={13} r={4} fill="#EEF2FF" stroke="#4338CA" strokeWidth={1.3} />
          <path d="M37 13 L29 13" stroke="#4338CA" strokeWidth={1.2} />
          {/* 본체 타워 쉘 */}
          <path d="M9 11 A11 5.5 0 0 1 31 11 L31 69 A11 5.5 0 0 1 9 69 Z" fill="#F8FAFC" stroke={s} strokeWidth={1.8} />
          {/* 다단 시브 트레이 + 다운커머 표현 */}
          {[19, 27, 35, 43, 51, 59].map((ty, idx) => (
            <g key={ty}>
              <line
                x1={idx % 2 === 0 ? 10 : 13}
                x2={idx % 2 === 0 ? 27 : 30}
                y1={ty}
                y2={ty}
                stroke="#4338CA"
                strokeWidth={1.25}
                strokeDasharray="2.5,1.5"
              />
              <line
                x1={idx % 2 === 0 ? 27 : 13}
                x2={idx % 2 === 0 ? 27 : 13}
                y1={ty}
                y2={ty + 4.5}
                stroke="#6366F1"
                strokeWidth={1.1}
              />
            </g>
          ))}
          {/* 탑저 리보일러 루프 */}
          <path d="M31 64 L41 64 L41 56 L31 56" fill="none" stroke="#DC2626" strokeWidth={1.3} />
          <circle cx={41} cy={60} r={4} fill="#FEF2F2" stroke="#DC2626" strokeWidth={1.3} />
          {/* 스커트 지지대 */}
          <path d="M11 73 L9 83 L31 83 L29 73" fill="none" stroke={s} strokeWidth={1.6} />
        </svg>
      );

    // 3. 건조탑 · 흡수탑 (TowerPacking — 34×84)
    case 'absorber':
      return (
        <svg width={Math.round(34 * scale)} height={Math.round(74 * scale)} viewBox="0 0 34 84">
          <line x1={17} y1={1} x2={17} y2={5} stroke={s} strokeWidth={1.8} />
          <path d="M5 11 A12 6 0 0 1 29 11 L29 68 A12 6 0 0 1 5 68 Z" fill={fillBg} stroke={s} strokeWidth={1.8} />
          <line x1={8} y1={15} x2={26} y2={15} stroke={subStroke} strokeWidth={1.2} />
          <path d="M11 15 L11 18 M17 15 L17 18 M23 15 L23 18" stroke={subStroke} strokeWidth={1} />
          <rect x={6} y={19} width={22} height={20} fill="#FAF5FF" stroke={subStroke} strokeWidth={0.9} />
          <line x1={6} y1={19} x2={28} y2={39} stroke={subStroke} strokeWidth={0.9} />
          <line x1={28} y1={19} x2={6} y2={39} stroke={subStroke} strokeWidth={0.9} />
          <rect x={6} y={44} width={22} height={20} fill="#FAF5FF" stroke={subStroke} strokeWidth={0.9} />
          <line x1={6} y1={44} x2={28} y2={64} stroke={subStroke} strokeWidth={0.9} />
          <line x1={28} y1={44} x2={6} y2={64} stroke={subStroke} strokeWidth={0.9} />
          <path d="M7 72 L5 82 L29 82 L27 72" fill="none" stroke={s} strokeWidth={1.6} />
        </svg>
      );

    // 4. 가스 압축기 (Compressor — ISO 10628 사다리꼴 — 42×42)
    case 'compressor':
      return (
        <svg width={Math.round(44 * scale)} height={Math.round(44 * scale)} viewBox="0 0 42 42">
          <path d="M12 31 L8 39 L34 39 L30 35" fill="none" stroke={s} strokeWidth={1.6} />
          <polygon points="4,12 38,6 38,34 4,28" fill={fillBg} stroke={s} strokeWidth={1.9} strokeLinejoin="round" />
          <circle cx={18} cy={20} r={4.5} fill="none" stroke={subStroke} strokeWidth={1.2} />
          <path d="M11 20 L32 20 M27 16 L32 20 L27 24" fill="none" stroke="#0284C7" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    // 5. 염소/가스 액화기 (Liquefier — TEMA 열교환기 + 냉매 코일 + 액화 액위 심볼 — 56×44)
    case 'liquefier':
      return (
        <svg width={Math.round(58 * scale)} height={Math.round(46 * scale)} viewBox="0 0 56 44">
          <path d="M16 35 L13 41 M40 35 L43 41 M10 41 L46 41" stroke={s} strokeWidth={1.5} />
          <path d="M10 8 L46 8 A6 13.5 0 0 1 46 35 L10 35 A6 13.5 0 0 1 10 8 Z" fill="#F0F9FF" stroke={s} strokeWidth={1.9} />
          {/* 하부 액화 염소 액위 음영 */}
          <path d="M11 28 L45 28 L45 34 L11 34 Z" fill="#BAE6FD" opacity={0.85} />
          <line x1={12} y1={8} x2={12} y2={35} stroke={s} strokeWidth={1.4} />
          <line x1={44} y1={8} x2={44} y2={35} stroke={s} strokeWidth={1.4} />
          {/* 냉매 지그재그 튜브 */}
          <polyline
            points="4,21 12,21 17,12 24,29 32,12 39,29 44,21 52,21"
            fill="none"
            stroke="#0284C7"
            strokeWidth={1.7}
            strokeLinejoin="round"
          />
          <line x1={20} y1={3} x2={20} y2={8} stroke="#0284C7" strokeWidth={1.8} />
          <line x1={36} y1={35} x2={36} y2={40} stroke="#0284C7" strokeWidth={1.8} />
          <text x={28} y={7} textAnchor="middle" fontSize={6.5} fontWeight={900} fill="#0369A1">❄LIQ</text>
        </svg>
      );

    // 6. 일반 열교환기 · 냉각기 (HeatExchanger — 54×42)
    case 'hex':
    case 'cooler':
      return (
        <svg width={Math.round(54 * scale)} height={Math.round(42 * scale)} viewBox="0 0 54 42">
          <path d="M15 34 L12 40 M39 34 L42 40 M9 40 L45 40" stroke={s} strokeWidth={1.5} />
          <path d="M9 8 L45 8 A6 13 0 0 1 45 34 L9 34 A6 13 0 0 1 9 8 Z" fill={fillBg} stroke={s} strokeWidth={1.8} />
          <line x1={11} y1={8} x2={11} y2={34} stroke={s} strokeWidth={1.4} />
          <line x1={43} y1={8} x2={43} y2={34} stroke={s} strokeWidth={1.4} />
          <polyline
            points="4,21 11,21 16,13 23,29 31,13 38,29 43,21 50,21"
            fill="none"
            stroke="#EA580C"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          <line x1={19} y1={3} x2={19} y2={8} stroke={s} strokeWidth={1.8} />
          <line x1={35} y1={34} x2={35} y2={39} stroke={s} strokeWidth={1.8} />
        </svg>
      );

    // 7. 원심 펌프 (Pump — 32×32)
    case 'pump':
      return (
        <svg width={Math.round(36 * scale)} height={Math.round(36 * scale)} viewBox="0 0 32 32">
          <polygon points="15,17 7,29 23,29" fill="#E2E8F0" stroke={s} strokeWidth={1.6} strokeLinejoin="round" />
          <line x1={4} y1={29} x2={26} y2={29} stroke={s} strokeWidth={1.8} />
          <path d="M15 5.5 L28 5.5 L28 11 L23 11" fill={fillBg} stroke={s} strokeWidth={1.6} strokeLinejoin="round" />
          <circle cx={15} cy={16} r={10.5} fill={fillBg} stroke={s} strokeWidth={1.8} />
          <circle cx={15} cy={16} r={2.5} fill={s} />
          <polyline points="11,12 18,16 11,20" fill="none" stroke={s} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    // 8. 강하막 증발관 (Evaporator — 34×84)
    case 'evaporator':
      return (
        <svg width={Math.round(34 * scale)} height={Math.round(72 * scale)} viewBox="0 0 34 84">
          <path d="M5 11 A12 6 0 0 1 29 11 L29 68 L21 78 L13 78 L5 68 Z" fill={fillBg} stroke={s} strokeWidth={1.8} strokeLinejoin="round" />
          <line x1={5} y1={21} x2={29} y2={21} stroke={s} strokeWidth={1.4} />
          <line x1={5} y1={62} x2={29} y2={62} stroke={s} strokeWidth={1.4} />
          {[10, 14.5, 19.5, 24].map(x => (
            <line key={x} x1={x} y1={21} x2={x} y2={62} stroke={subStroke} strokeWidth={1} />
          ))}
          <line x1={17} y1={78} x2={17} y2={83} stroke={s} strokeWidth={1.8} />
        </svg>
      );

    // 9. 합성로 · 교반 반응기 (AgitatedDrum — 48×62)
    case 'reactor':
      return (
        <svg width={Math.round(44 * scale)} height={Math.round(58 * scale)} viewBox="0 0 48 62">
          <rect x={17} y={1} width={14} height={10} rx={1.5} fill={fillBg} stroke={s} strokeWidth={1.5} />
          <text x={24} y={8.5} textAnchor="middle" fontSize={7.5} fontWeight={800} fill={s}>M</text>
          <line x1={24} y1={11} x2={24} y2={45} stroke={s} strokeWidth={1.5} />
          <path d="M8 21 A16 5.5 0 0 1 40 21 L40 49 A16 5.5 0 0 1 8 49 Z" fill={fillBg} stroke={s} strokeWidth={1.8} />
          <path d="M16 33 L32 37 M16 37 L32 33" stroke={s} strokeWidth={1.4} strokeLinecap="round" />
          <path d="M14 44 C19 41, 29 47, 34 44" fill="none" stroke={s} strokeWidth={1.6} strokeLinecap="round" />
          <path d="M12 52 L9 60 M36 52 L39 60 M6 60 L42 60" stroke={s} strokeWidth={1.6} />
        </svg>
      );

    // 10. 배관 혼합기 (Mixer — 34×34)
    case 'mixer':
      return (
        <svg width={Math.round(34 * scale)} height={Math.round(34 * scale)} viewBox="0 0 34 34">
          <circle cx={17} cy={17} r={13} fill={fillBg} stroke={s} strokeWidth={1.8} />
          <path d="M9 9 L25 25 M25 9 L9 25" stroke={s} strokeWidth={1.6} />
        </svg>
      );

    // 11. 배관 분기기 (Branch — 34×34)
    case 'splitter':
      return (
        <svg width={Math.round(34 * scale)} height={Math.round(34 * scale)} viewBox="0 0 34 34">
          <circle cx={17} cy={17} r={12} fill={fillBg} stroke={s} strokeWidth={1.8} />
          <path d="M8 17 L18 17 M18 17 L24 11 M18 17 L24 23" fill="none" stroke={s} strokeWidth={1.8} strokeLinecap="round" />
        </svg>
      );

    // 12. 원료 공급 플래그 (PFD Battery-Limit Feed Arrow)
    case 'feed':
      return (
        <svg width={Math.round(52 * scale)} height={Math.round(28 * scale)} viewBox="0 0 54 28">
          <polygon points="3,4 38,4 50,14 38,24 3,24" fill="#ECFDF5" stroke={s} strokeWidth={1.8} strokeLinejoin="round" />
          <text x={22} y={17} textAnchor="middle" fontSize={8.5} fontWeight={900} fill={s}>FEED</text>
        </svg>
      );

    // 13. 제품/중간헤더 플래그 (PFD Battery-Limit Product Flag)
    case 'product':
      return (
        <svg width={Math.round(52 * scale)} height={Math.round(28 * scale)} viewBox="0 0 54 28">
          <polygon points="3,4 40,4 51,14 40,24 3,24 10,14" fill="#F1F5F9" stroke={s} strokeWidth={1.8} strokeLinejoin="round" />
          <text x={26} y={17} textAnchor="middle" fontSize={8} fontWeight={900} fill={s}>OUT</text>
        </svg>
      );

    // 14. [도면 전용] 수직 저장탱크 (Tank — 48×60)
    case 'tank_visual':
    case 'silo_visual':
      return (
        <svg width={Math.round(42 * scale)} height={Math.round(52 * scale)} viewBox="0 0 48 60">
          <path d="M7 13 A17 6 0 0 1 41 13 L41 47 A17 5 0 0 1 7 47 Z" fill={fillBg} stroke={s} strokeWidth={1.7} />
          <line x1={8} y1={28} x2={40} y2={28} stroke="#94A3B8" strokeWidth={1.1} strokeDasharray="3,2" />
          <polygon points="24,28 21,23 27,23" fill="none" stroke="#94A3B8" strokeWidth={1} />
          <path d="M41 18 L45 18 L45 42 L41 42" fill="none" stroke={subStroke} strokeWidth={1} />
          <path d="M11 50 L9 58 M37 50 L39 58 M6 58 L42 58" stroke={s} strokeWidth={1.5} />
        </svg>
      );

    // 15. [도면 전용] 수평 저장드럼 (DrumHorizontal — 액화염소 저장드럼 등 — 70×36)
    case 'h_drum_visual':
      return (
        <svg width={Math.round(64 * scale)} height={Math.round(34 * scale)} viewBox="0 0 70 36">
          <path d="M12 4 L58 4 A9 11 0 0 1 58 26 L12 26 A9 11 0 0 1 12 4 Z" fill={fillBg} stroke={s} strokeWidth={1.7} />
          <line x1={7} y1={18} x2={63} y2={18} stroke="#0284C7" strokeWidth={1} strokeDasharray="3,2" />
          <path d="M18 26 L15 33 L25 33 L22 26 M48 26 L45 33 L55 33 L52 26" fill="none" stroke={s} strokeWidth={1.5} />
          <line x1={11} y1={33} x2={59} y2={33} stroke={s} strokeWidth={1.5} />
        </svg>
      );

    // 16. [도면 전용] 여과기 (Filter — 46×54)
    case 'filter_visual':
      return (
        <svg width={Math.round(40 * scale)} height={Math.round(48 * scale)} viewBox="0 0 46 54">
          <path d="M8 10 A15 5 0 0 1 38 10 L38 36 L26 46 L20 46 L8 36 Z" fill={fillBg} stroke={s} strokeWidth={1.7} />
          <rect x={13} y={14} width={6} height={18} fill="#F1F5F9" stroke={subStroke} strokeWidth={1} strokeDasharray="2,1.5" />
          <rect x={27} y={14} width={6} height={18} fill="#F1F5F9" stroke={subStroke} strokeWidth={1} strokeDasharray="2,1.5" />
        </svg>
      );

    // 17. [계산 장치] 원염 포화조 · 1차 침전정제 (Saturator / Clarifier — 58×58)
    case 'saturator':
      return (
        <svg width={Math.round(52 * scale)} height={Math.round(52 * scale)} viewBox="0 0 58 58">
          <path d="M8 12 L50 12 L50 34 L34 49 L24 49 L8 34 Z" fill="#F0F9FF" stroke={s} strokeWidth={1.7} />
          <line x1={8} y1={18} x2={50} y2={18} stroke="#0284C7" strokeWidth={1.2} strokeDasharray="3,2" />
          {/* 교반기 임펠러 */}
          <line x1={29} y1={5} x2={29} y2={35} stroke={s} strokeWidth={1.5} />
          <path d="M20 33 L38 33 M22 26 L36 26" stroke="#0369A1" strokeWidth={1.5} />
          {/* 하부 슬러지 콘 배출 */}
          <line x1={29} y1={49} x2={29} y2={55} stroke={s} strokeWidth={1.6} />
        </svg>
      );

    // 18. [계산 장치] 2차 킬레이트 이온교환 수지탑 (Chelate Resin Tower — 44×64)
    case 'chelate_tower':
      return (
        <svg width={Math.round(40 * scale)} height={Math.round(58 * scale)} viewBox="0 0 44 64">
          <path d="M10 12 A12 6 0 0 1 34 12 L34 50 A12 6 0 0 1 10 50 Z" fill="#F0FDFA" stroke={s} strokeWidth={1.7} />
          <rect x={12} y={19} width={20} height={24} fill="#CCFBF1" stroke="#0D9488" strokeWidth={1} />
          <circle cx={17} cy={25} r={1.6} fill="#0F766E" />
          <circle cx={23} cy={25} r={1.6} fill="#0F766E" />
          <circle cx={28} cy={25} r={1.6} fill="#0F766E" />
          <circle cx={19} cy={31} r={1.6} fill="#0F766E" />
          <circle cx={26} cy={31} r={1.6} fill="#0F766E" />
          <circle cx={17} cy={37} r={1.6} fill="#0F766E" />
          <circle cx={23} cy={37} r={1.6} fill="#0F766E" />
          <circle cx={28} cy={37} r={1.6} fill="#0F766E" />
          <path d="M13 53 L11 61 M31 53 L33 61" stroke={s} strokeWidth={1.5} />
        </svg>
      );

    // 19. [계산 장치] 실리카겔 2탑식 흡착 제습탑 (Twin Desiccant Dryer — 56×60)
    case 'desiccant_dryer':
      return (
        <svg width={Math.round(50 * scale)} height={Math.round(54 * scale)} viewBox="0 0 56 60">
          <path d="M7 12 A8 4.5 0 0 1 23 12 L23 48 A8 4.5 0 0 1 7 48 Z" fill="#EEF2FF" stroke={s} strokeWidth={1.6} />
          <path d="M33 12 A8 4.5 0 0 1 49 12 L49 48 A8 4.5 0 0 1 33 48 Z" fill="#EEF2FF" stroke={s} strokeWidth={1.6} />
          <line x1={9} y1={20} x2={21} y2={40} stroke="#4338CA" strokeWidth={1} />
          <line x1={21} y1={20} x2={9} y2={40} stroke="#4338CA" strokeWidth={1} />
          <line x1={35} y1={20} x2={47} y2={40} stroke="#4338CA" strokeWidth={1} />
          <line x1={47} y1={20} x2={35} y2={40} stroke="#4338CA" strokeWidth={1} />
          <path d="M15 8 L15 4 L41 4 L41 8 M15 52 L15 56 L41 56 L41 52" fill="none" stroke={subStroke} strokeWidth={1.3} />
        </svg>
      );

    // 20. [계산 장치] 향류 다단 액-액 추출탑 (LLE Extractor — 44×68)
    case 'extractor':
      return (
        <svg width={Math.round(42 * scale)} height={Math.round(62 * scale)} viewBox="0 0 44 68">
          <path d="M10 12 A12 6 0 0 1 34 12 L34 54 A12 6 0 0 1 10 54 Z" fill="#F5F3FF" stroke={s} strokeWidth={1.7} />
          <line x1={11} y1={22} x2={27} y2={22} stroke="#7C3AED" strokeWidth={1.3} />
          <line x1={17} y1={31} x2={33} y2={31} stroke="#7C3AED" strokeWidth={1.3} />
          <line x1={11} y1={40} x2={27} y2={40} stroke="#7C3AED" strokeWidth={1.3} />
          <line x1={17} y1={49} x2={33} y2={49} stroke="#7C3AED" strokeWidth={1.3} />
          <circle cx={29} cy={26} r={1.4} fill="#8B5CF6" />
          <circle cx={15} cy={35} r={1.4} fill="#8B5CF6" />
          <circle cx={29} cy={44} r={1.4} fill="#8B5CF6" />
          <path d="M13 57 L11 65 M31 57 L33 65" stroke={s} strokeWidth={1.5} />
        </svg>
      );

    // 21. [계산 장치] 단열 등엔탈피 감압·교축 밸브 (Adiabatic JT Expansion Valve — 36×34)
    case 'valve':
      return (
        <svg width={Math.round(38 * scale)} height={Math.round(36 * scale)} viewBox="0 0 36 34">
          <path d="M11 8 A7 5 0 0 1 25 8 Z" fill="#FEF3C7" stroke="#D97706" strokeWidth={1.5} />
          <line x1={18} y1={8} x2={18} y2={20} stroke="#D97706" strokeWidth={1.6} />
          <polygon points="4,13 18,20 4,27" fill="#FFFBEB" stroke={s} strokeWidth={1.7} strokeLinejoin="round" />
          <polygon points="32,13 18,20 32,27" fill="#EFF6FF" stroke={s} strokeWidth={1.7} strokeLinejoin="round" />
        </svg>
      );

    // 22. [도면 전용] 조절 밸브 (Valve — 28×28)
    case 'valve_visual':
    default:
      return (
        <svg width={Math.round(32 * scale)} height={Math.round(32 * scale)} viewBox="0 0 28 28">
          <path d="M9 6 A5 4 0 0 1 19 6 Z" fill="#E2E8F0" stroke={s} strokeWidth={1.4} />
          <line x1={14} y1={6} x2={14} y2={15} stroke={s} strokeWidth={1.4} />
          <polygon points="3,10 14,16 3,22" fill={fillBg} stroke={s} strokeWidth={1.6} strokeLinejoin="round" />
          <polygon points="25,10 14,16 25,22" fill={fillBg} stroke={s} strokeWidth={1.6} strokeLinejoin="round" />
        </svg>
      );
  }
}

// ── 커스텀 ReactFlow 노드 (전해 PFD CAD 심볼 + 양방향 넉넉한 연결 포트 + 더블클릭 하위공정 진입) ──
interface FlowCanvasNodeData {
  tag: string;
  name: string;
  unitType: FlowUnitType;
  calcMode?: UnitCalcMode;
  liveSummary: string;
  detectedFluid?: string;
  simStatus?: 'converged' | 'error' | 'idle';
  simStatusMsg?: string;
  subSheetId?: string;
  subSheetBadge?: string;
  onOpenSubSheet?: (subSheetId: string) => void;
}

function FlowUnitNode({ data, selected }: NodeProps<FlowCanvasNodeData>) {
  const unitType = data.unitType;
  const meta = UNIT_CATALOG.find(u => u.type === unitType) ?? UNIT_CATALOG[2];
  const visualOnly = isVisualOnlyUnit(unitType);
  const supportsRigorous =
    !visualOnly &&
    unitType !== 'feed' &&
    unitType !== 'product' &&
    unitType !== 'mixer' &&
    unitType !== 'splitter';
  const isRigorous = supportsRigorous && data.calcMode === 'rigorous';
  const hasSubSheet = Boolean(data.subSheetId);

  const isFeed = unitType === 'feed';
  const isElectrolyzer = unitType === 'electrolyzer';
  const isHexOrLiq = unitType === 'hex' || unitType === 'cooler' || unitType === 'liquefier';
  const isAbsorber = unitType === 'absorber';
  const isExtractor = unitType === 'extractor';
  const hasDualPhaseOut =
    unitType === 'separator' ||
    unitType === 'distillation' ||
    unitType === 'absorber' ||
    unitType === 'extractor' ||
    unitType === 'liquefier' ||
    unitType === 'evaporator' ||
    unitType === 'splitter' ||
    unitType === 'saturator' ||
    unitType === 'desiccant_dryer';

  // ConnectionMode.Loose에서는 모든 Handle을 type="source"로 통일하면
  // 어느 방향(출구→입구 또는 입구→출구)으로 드래그해도 항상 배관이 매끄럽게 연결됩니다!
  const portStyle = (bg: string): React.CSSProperties => ({
    width: 13,
    height: 13,
    borderRadius: '50%',
    border: '2.2px solid #FFFFFF',
    background: bg,
    boxShadow: '0 1px 4px rgba(15,23,42,0.35)',
    zIndex: 45,
    cursor: 'crosshair',
  });

  const topPortLabel =
    unitType === 'distillation'
      ? '탑정D↑'
      : unitType === 'extractor'
        ? '추출E↑'
        : unitType === 'splitter'
          ? '분기1'
          : unitType === 'saturator'
            ? '정제액'
            : unitType === 'desiccant_dryer'
              ? '건조H₂'
              : 'G↑';

  const botPortLabel =
    unitType === 'distillation'
      ? '탑저B↓'
      : unitType === 'extractor'
        ? '추잔R↓'
        : unitType === 'splitter'
          ? '분기2'
          : unitType === 'saturator'
            ? '슬러지'
            : unitType === 'desiccant_dryer'
              ? '수분'
              : 'L↓';

  const isStreamBlock = unitType === 'feed' || unitType === 'product';
  const useClassicIcon =
    unitType === 'feed' ||
    unitType === 'product' ||
    unitType === 'mixer' ||
    unitType === 'splitter' ||
    unitType === 'separator' ||
    unitType === 'hex' ||
    unitType === 'cooler' ||
    unitType === 'liquefier' ||
    unitType === 'distillation' ||
    unitType === 'absorber' ||
    unitType === 'reactor' ||
    unitType === 'pump' ||
    unitType === 'compressor';

  return (
    <div
      title={
        data.simStatusMsg
          ? `[${data.tag}] ${data.simStatusMsg}`
          : hasSubSheet
            ? `더블클릭하면 [${data.name}] 내부 세부 공정 시뮬레이션 도면으로 이동합니다!`
            : isStreamBlock
              ? `물질 흐름 블록 [${data.tag}] — 클릭하여 유량·조성·온도·압력을 확인/편집하세요`
              : undefined
      }
      style={{
        minWidth: isStreamBlock
          ? 90
          : isElectrolyzer
            ? 138
            : hasSubSheet
              ? 120
              : unitType === 'distillation'
                ? 112
                : 96,
        background: selected ? 'rgba(239, 246, 255, 0.92)' : 'rgba(255, 255, 255, 0.92)',
        border: selected
          ? '1.5px dashed #1D4ED8'
          : visualOnly
            ? '1px dashed #CBD5E1'
            : '1px solid #E2E8F0',
        borderRadius: 6,
        boxShadow: selected
          ? '0 0 0 3px rgba(29, 78, 216, 0.14)'
          : '0 1px 4px rgba(15, 23, 42, 0.06)',
        fontFamily: "'Inter', system-ui, sans-serif",
        position: 'relative',
        padding: '6px 10px 5px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      {/* ── 우상단 수렴(✓) / 에러(!) 상태 배지 ── */}
      {data.simStatus === 'converged' && (
        <span
          title={data.simStatusMsg || '수렴 완료'}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: '#059669',
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: 900,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid #FFFFFF',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            zIndex: 20,
          }}
        >
          ✓
        </span>
      )}
      {data.simStatus === 'error' && (
        <span
          title={data.simStatusMsg || '미수렴 또는 수지 오차 발생'}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: '#DC2626',
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: 900,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid #FFFFFF',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            zIndex: 20,
          }}
        >
          !
        </span>
      )}

      {/* ── 표준 엔지니어링 단색 선화 SVG 심볼 본체 ── */}
      <div style={{ padding: '2px 2px 1px 2px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {useClassicIcon ? (
          <ClassicUnitSvg unitType={unitType} size={46} />
        ) : (
          <PfdEquipmentSvg type={unitType} strokeColor={visualOnly ? '#64748B' : '#1E293B'} scale={0.92} />
        )}
      </div>

      {/* ── 태그명 (단정하고 선명하게) ── */}
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10.5,
          fontWeight: 900,
          color: visualOnly ? '#64748B' : '#0F172A',
          whiteSpace: 'nowrap',
        }}
      >
        {data.tag}
      </div>

      {/* ── 장치명 ── */}
      <div
        style={{
          fontSize: 9.2,
          fontWeight: 600,
          color: '#475569',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          maxWidth: 132,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {data.name}
      </div>

      {/* ── 간결한 핵심 수치 1줄 ── */}
      {data.liveSummary && (
        <div
          style={{
            fontSize: 8.5,
            color: '#1D4ED8',
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {data.liveSummary}
        </div>
      )}

      {/* ── 하위 세부 공정 진입 링크 ── */}
      {hasSubSheet && data.subSheetId && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            data.onOpenSubSheet?.(data.subSheetId!);
          }}
          title="더블클릭하거나 클릭하여 내부 세부 공정 도면으로 이동합니다."
          style={{
            marginTop: 1,
            padding: '1px 5px',
            border: 'none',
            background: 'transparent',
            color: '#1D4ED8',
            fontSize: 8.5,
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            textDecoration: 'underline',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <SubprocessTreeIcon size={10} /> {data.subSheetBadge || '세부공정'}
          </span>
        </button>
      )}

      {/* ── 좌측 유입 포트 (모두 type="source" + ConnectionMode.Loose로 양방향 연결 지원) ── */}
      {isElectrolyzer ? (
        <>
          <Handle
            type="source"
            position={Position.Left}
            id="anode_in"
            title="양극 입구 (포화염수 Anode In)"
            style={{ ...portStyle('#0F766E'), left: -7, top: '36%' }}
          />
          <span style={{ position: 'absolute', left: 5, top: '28%', fontSize: 7.5, fontWeight: 800, color: '#0F766E', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            양극In
          </span>
          <Handle
            type="source"
            position={Position.Left}
            id="cathode_in"
            title="음극 입구 (가성소다/순수 Cathode In)"
            style={{ ...portStyle('#EA580C'), left: -7, top: '74%' }}
          />
          <span style={{ position: 'absolute', left: 5, top: '66%', fontSize: 7.5, fontWeight: 800, color: '#C2410C', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            음극In
          </span>
        </>
      ) : isAbsorber || isExtractor ? (
        <>
          <Handle
            type="source"
            position={Position.Left}
            id={isExtractor ? 'solvent' : 'liq_in'}
            title={isExtractor ? '추출 용매 유입 (Solvent Inlet)' : '상부 흡수액/황산 유입 (선택사항)'}
            style={{ ...portStyle(isExtractor ? '#7C3AED' : '#0284C7'), left: -7, top: '30%' }}
          />
          <span style={{ position: 'absolute', left: 5, top: '22%', fontSize: 7.5, fontWeight: 800, color: isExtractor ? '#7C3AED' : '#0284C7', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            {isExtractor ? '용매In' : '액In'}
          </span>
          <Handle
            type="source"
            position={Position.Left}
            id="in"
            title={isExtractor ? '추출 대상 원료액 유입 (Feed Inlet)' : '하부 원료가스 유입 (Gas Inlet)'}
            style={{ ...portStyle('#5B21B6'), left: -7, top: '72%' }}
          />
          <span style={{ position: 'absolute', left: 5, top: '64%', fontSize: 7.5, fontWeight: 800, color: '#5B21B6', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            {isExtractor ? '원료In' : '가스In'}
          </span>
        </>
      ) : !isFeed ? (
        <Handle
          type="source"
          position={Position.Left}
          id="in"
          title="유입 배관 연결점 (Inlet — 드래그하여 연결)"
          style={{ ...portStyle(meta.color), left: -7, top: '52%' }}
        />
      ) : null}

      {/* ── 열교환기·액화기·포화조·압축기·증류탑 상/하단 보조 포트 (선택 연결) ── */}
      {isHexOrLiq && (
        <>
          <Handle
            type="source"
            position={Position.Top}
            id="util_in"
            title="냉매/열매 유입 (선택사항 — 미연결 시에도 선택 냉매 기준으로 유량 자동 계산)"
            style={{ ...portStyle('#0284C7'), top: -7, left: '50%' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="util_out"
            title="냉매/열매 배출 (선택사항)"
            style={{ ...portStyle('#DC2626'), bottom: -7, left: '50%' }}
          />
        </>
      )}
      {unitType === 'saturator' && (
        <Handle
          type="source"
          position={Position.Top}
          id="solvent"
          title="원염(NaCl) / 약품 투입 포트"
          style={{ ...portStyle('#0284C7'), top: -7, left: '50%' }}
        />
      )}
      {unitType === 'compressor' && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="liquid"
          title="단간·후단 응축수 녹아웃 드레인 (KO Liquid)"
          style={{ ...portStyle('#0284C7'), bottom: -7, left: '50%' }}
        />
      )}
      {unitType === 'distillation' && (
        <Handle
          type="source"
          position={Position.Top}
          id="decanter"
          title="공비 디캔터 수층 분리 배출 (Decanter Water)"
          style={{ ...portStyle('#0284C7'), top: -7, left: '50%' }}
        />
      )}

      {/* ── 우측 유출 포트 (제품/헤더단 포함 모든 장치에 후단 연결점 제공!) ── */}
      {isElectrolyzer ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="anode_out"
            title="양극 출구 (습윤 Cl₂ + 묽은 브라인)"
            style={{ ...portStyle('#0F766E'), right: -7, top: '36%' }}
          />
          <span style={{ position: 'absolute', right: 5, top: '28%', fontSize: 7.5, fontWeight: 800, color: '#0F766E', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            Cl₂출
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="cathode_out"
            title="음극 출구 (습윤 H₂ + 32% 가성소다)"
            style={{ ...portStyle('#EA580C'), right: -7, top: '74%' }}
          />
          <span style={{ position: 'absolute', right: 5, top: '66%', fontSize: 7.5, fontWeight: 800, color: '#C2410C', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            H₂출
          </span>
        </>
      ) : hasDualPhaseOut ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="vapor"
            title={
              unitType === 'splitter'
                ? '1번 분기 출구'
                : unitType === 'liquefier'
                  ? '상부 미응축 스니프 가스 출구 (Sniff Gas G↑)'
                  : '상부 정제가스/기상 출구 (Vapor G↑ — 압축기·후단 연결점)'
            }
            style={{ ...portStyle('#0F766E'), right: -7, top: unitType === 'distillation' ? '26%' : '30%' }}
          />
          <span style={{ position: 'absolute', right: 5, top: unitType === 'distillation' ? '18%' : '22%', fontSize: 7.5, fontWeight: 900, color: '#0F766E', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            {topPortLabel}
          </span>
          {unitType === 'distillation' && (
            <>
              <Handle
                type="source"
                position={Position.Right}
                id="side_cut"
                title="사이드컷 측류 출구 (Side-Cut S→ — 액상/기상 중간단 인출)"
                style={{ ...portStyle('#7C3AED'), right: -7, top: '52%' }}
              />
              <span style={{ position: 'absolute', right: 5, top: '44%', fontSize: 7.2, fontWeight: 900, color: '#7C3AED', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
                측류S→
              </span>
            </>
          )}
          <Handle
            type="source"
            position={Position.Right}
            id="liquid"
            title={
              unitType === 'splitter'
                ? '2번 분기 출구'
                : unitType === 'saturator'
                  ? '하부 침전 슬러지 배출 (Sludge L↓)'
                  : unitType === 'liquefier'
                    ? '하부 액화염소/응축액 출구 (Liquid Cl₂ L↓)'
                    : '하부 액상/배출액 출구 (Liquid L↓)'
            }
            style={{ ...portStyle('#0284C7'), right: -7, top: unitType === 'distillation' ? '78%' : '74%' }}
          />
          <span style={{ position: 'absolute', right: 5, top: unitType === 'distillation' ? '70%' : '66%', fontSize: 7.5, fontWeight: 900, color: '#0284C7', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            {botPortLabel}
          </span>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          title="후단 배관 연결점 (Outlet — 드래그하여 다음 장치와 연결)"
          style={{ ...portStyle(meta.color), right: -7, top: '52%' }}
        />
      )}
    </div>
  );
}

const NODE_TYPES = { flowUnit: FlowUnitNode };

// ── 프리셋 시나리오 ──────────────────────────────────────────
interface PresetScenario {
  id: string;
  group?: 'general' | 'plant02' | 'plant03' | 'plant04' | 'plant05' | 'plant06';
  isPublicTextbook?: boolean;
  btnLabel: string;
  title: string;
  nodes: Array<FlowNodeDef & { position: { x: number; y: number } }>;
  edges: FlowEdgeDef[];
}

const PRESETS: PresetScenario[] = [
  {
    id: 'new_plant_starter',
    isPublicTextbook: true,
    btnLabel: '기초 1: 원료공급 → 열교환기(E-101) → 기액분리기(D-101) 기본 공정',
    title: '기본 자유설계 예제: FEED-101(MeOH/H₂O/N₂) → E-101 냉각기 → D-101 기액분리기 → 기상/액상 제품 분리',
    nodes: [
      {
        id: 'np_feed1', tag: 'FEED-101', name: '혼합 원료 공급', unitType: 'feed',
        position: { x: 60, y: 120 },
        params: { feedTempC: 95.0, feedPressKgcm2g: 2.0, feedFlowsKgH: { MeOH: 3000, H2O: 5000, N2: 200 } },
      },
      {
        id: 'np_hex1', tag: 'E-101', name: '공정 냉각기', unitType: 'hex',
        position: { x: 320, y: 112 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'cw', operTempC: 35.0, overallU: 460 },
      },
      {
        id: 'np_sep1', tag: 'D-101', name: '기액 분리기', unitType: 'separator',
        position: { x: 590, y: 105 },
        params: { operTempC: 35.0, operPressKgcm2g: 1.9 },
      },
      {
        id: 'np_pvap', tag: 'PROD-GAS', name: '상부 가스 제품(G)', unitType: 'product',
        position: { x: 860, y: 35 },
        params: {},
      },
      {
        id: 'np_pliq', tag: 'PROD-LIQ', name: '하부 응축액 제품(L)', unitType: 'product',
        position: { x: 860, y: 195 },
        params: {},
      },
    ],
    edges: [
      { id: 'np_e1', streamNo: 'S-101', source: 'np_feed1', target: 'np_hex1', sourcePort: 'out', targetPort: 'in' },
      { id: 'np_e2', streamNo: 'S-102', source: 'np_hex1', target: 'np_sep1', sourcePort: 'out', targetPort: 'in' },
      { id: 'np_e3', streamNo: 'S-103', source: 'np_sep1', target: 'np_pvap', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'np_e4', streamNo: 'S-104', source: 'np_sep1', target: 'np_pliq', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  {
    id: 'textbook_bt_distillation',
    isPublicTextbook: true,
    btnLabel: '기초 2: 벤젠–톨루엔(B/T) 다단 정밀증류탑 (Peng-Robinson · 20단)',
    title: '교과서 표준 2성분 증류: FEED-101(Benzene 50% / Toluene 50%, 10 t/h) → E-101 예열기 → T-101 20단 정밀증류탑 (PR)',
    nodes: [
      {
        id: 'bt_feed', tag: 'FEED-101', name: '벤젠-톨루엔 원료', unitType: 'feed',
        position: { x: 50, y: 155 },
        params: { feedTempC: 75.0, feedPressKgcm2g: 0.8, feedFlowsKgH: { Benzene: 5000, Toluene: 5000 } },
      },
      {
        id: 'bt_hx', tag: 'E-101', name: '원료 예열기', unitType: 'hex',
        position: { x: 290, y: 150 },
        params: { hexSpecMode: 'proc_temp', operTempC: 92.0, overallU: 520 },
      },
      {
        id: 'bt_col', tag: 'T-101', name: 'B/T 정밀증류탑 (20단)', unitType: 'distillation',
        position: { x: 545, y: 120 },
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
      {
        id: 'bt_top', tag: 'PROD-BZ', name: '탑정 벤젠 제품', unitType: 'product',
        position: { x: 830, y: 55 },
        params: {},
      },
      {
        id: 'bt_bot', tag: 'PROD-TOL', name: '탑저 톨루엔 제품', unitType: 'product',
        position: { x: 830, y: 215 },
        params: {},
      },
    ],
    edges: [
      { id: 'bt_e1', streamNo: 'S-101', source: 'bt_feed', target: 'bt_hx', sourcePort: 'out', targetPort: 'in' },
      { id: 'bt_e2', streamNo: 'S-102', source: 'bt_hx', target: 'bt_col', sourcePort: 'out', targetPort: 'in' },
      { id: 'bt_e3', streamNo: 'S-103', source: 'bt_col', target: 'bt_top', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'bt_e4', streamNo: 'S-104', source: 'bt_col', target: 'bt_bot', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  {
    id: 'textbook_etoh_h2o_nrtl',
    isPublicTextbook: true,
    btnLabel: '기초 3: 에탄올–물 공비 증류탑 (NRTL · 24단)',
    title: '비이상 공비계 증류: FEED-101(EtOH 25 wt% / H₂O 75 wt%, 8 t/h) → T-101 24단 NRTL 정밀증류탑',
    nodes: [
      {
        id: 'ew_feed', tag: 'FEED-101', name: '에탄올 수용액 원료', unitType: 'feed',
        position: { x: 70, y: 155 },
        params: { feedTempC: 65.0, feedPressKgcm2g: 0.3, feedFlowsKgH: { EtOH: 2000, H2O: 6000 } },
      },
      {
        id: 'ew_col', tag: 'T-101', name: '에탄올 정류탑 (24단)', unitType: 'distillation',
        position: { x: 380, y: 120 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            columnCalcMode: 'rigorous_mesh',
            thermoModel: 'NRTL',
            totalStages: 24,
            feedStage: 16,
            topPressKgcm2g: 0.05,
            murphreeEffPct: 75,
            topSpecType: 'reflux_ratio',
            topSpecValue: 2.5,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.27,
          },
        },
      },
      {
        id: 'ew_top', tag: 'PROD-ETOH', name: '탑정 농축 에탄올', unitType: 'product',
        position: { x: 700, y: 55 },
        params: {},
      },
      {
        id: 'ew_bot', tag: 'PROD-H2O', name: '탑저 폐수(H₂O)', unitType: 'product',
        position: { x: 700, y: 215 },
        params: {},
      },
    ],
    edges: [
      { id: 'ew_e1', streamNo: 'S-101', source: 'ew_feed', target: 'ew_col', sourcePort: 'out', targetPort: 'in' },
      { id: 'ew_e2', streamNo: 'S-102', source: 'ew_col', target: 'ew_top', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ew_e3', streamNo: 'S-103', source: 'ew_col', target: 'ew_bot', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  {
    id: 'chlor_alkali_liquefaction',
    btnLabel: '▶ 템플릿 1: 반응/전해 → 건조탑 → 압축기(3.5kG) → 냉매액화기(-22°C)',
    title: 'EL-200 전해조 → D-210 분리 → E-413 냉각 → T-430 황산건조탑 → C-470 염소압축기(3.5kG) → LQ-440 프레온 액화기(-22°C) → V-450 액화염소 저장드럼',
    nodes: [
      {
        id: 'el_f_an', tag: 'FEED-104', name: '정제 포화염수', unitType: 'feed',
        position: { x: 20, y: 55 },
        params: { feedTempC: 66.0, feedPressKgcm2g: 1.5, feedFlowsKgH: { NaCl: 54500, H2O: 158000 } },
      },
      {
        id: 'el_f_ca', tag: 'FEED-213', name: '음극 순환액+순수', unitType: 'feed',
        position: { x: 20, y: 225 },
        params: { feedTempC: 74.0, feedPressKgcm2g: 1.5, feedFlowsKgH: { NaOH: 145000, H2O: 353000 } },
      },
      {
        id: 'el_200', tag: 'EL-200', name: '전해조 (5기×190셀)', unitType: 'electrolyzer',
        position: { x: 215, y: 115 },
        params: {
          currentKA: 16.2, cellCount: 190, unitCount: 5, currentEffPct: 94.0,
          waterTransportNumber: 4.2, cellVoltageV: 3.05, operTempC: 89.0, operPressKgcm2g: 0.40, cathodeDeltaP: 0.15,
        },
      },
      {
        id: 'el_d210', tag: 'D-210', name: '양극 기액분리기', unitType: 'separator',
        position: { x: 455, y: 25 },
        params: { operTempC: 88.0 },
      },
      {
        id: 'el_d220', tag: 'D-220', name: '음극 기액분리기', unitType: 'separator',
        position: { x: 455, y: 235 },
        params: { operTempC: 89.0 },
      },
      {
        id: 'el_tank_brine', tag: 'D-240', name: '묽은브라인 탱크', unitType: 'tank_visual',
        position: { x: 660, y: 145 },
        params: { visualSpecNote: '탈염소탑 이송 대기조' },
      },
      {
        id: 'el_e413', tag: 'E-413', name: '염소가스 냉각기', unitType: 'hex',
        position: { x: 660, y: 10 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'chw', operTempC: 18.0, overallU: 420 },
      },
      {
        id: 'el_t430', tag: 'T-430', name: '황산 건조탑', unitType: 'absorber',
        position: { x: 865, y: 5 },
        params: { targetComponent: 'H2O', removalEfficiency: 0.9995, operTempC: 22.0, solventMode: 'connected_or_manual', makeupSolventComp: 'H2SO4', makeupSolventKgH: 1800 },
      },
      {
        id: 'el_c470', tag: 'C-470', name: '염소 터보압축기', unitType: 'compressor',
        position: { x: 1075, y: 10 },
        params: { outletPressKgcm2g: 3.5, efficiency: 0.76, intercooledTempC: 42.0 },
      },
      {
        id: 'el_lq440', tag: 'LQ-440', name: '염소 냉매액화기', unitType: 'liquefier',
        position: { x: 1280, y: 10 },
        params: { refrigerantPreset: 'freon_m35', hexSpecMode: 'proc_temp', operTempC: -22.0, overallU: 420 },
      },
      {
        id: 'el_sniff', tag: 'SNIFF-G', name: '스니프가스(제해탑행)', unitType: 'product',
        position: { x: 1510, y: -25 },
        params: {},
      },
      {
        id: 'el_v450', tag: 'V-450', name: '액화염소 저장드럼', unitType: 'h_drum_visual',
        position: { x: 1510, y: 85 },
        params: { visualSpecNote: '액화 Cl₂ 가압 수평드럼' },
      },
      {
        id: 'el_p_liqcl2', tag: 'PROD-LCL2', name: '액화염소 제품(L)', unitType: 'product',
        position: { x: 1705, y: 92 },
        params: {},
      },
      {
        id: 'el_p_h2', tag: 'PROD-H2', name: '습윤 H₂ 헤더', unitType: 'product',
        position: { x: 665, y: 245 },
        params: {},
      },
      {
        id: 'el_p_naoh', tag: 'PROD-32%', name: '32 wt% 가성소다', unitType: 'product',
        position: { x: 665, y: 340 },
        params: {},
      },
    ],
    edges: [
      { id: 'ee1', streamNo: 'S-01', source: 'el_f_an', target: 'el_200', sourcePort: 'out', targetPort: 'anode_in' },
      { id: 'ee2', streamNo: 'S-02', source: 'el_f_ca', target: 'el_200', sourcePort: 'out', targetPort: 'cathode_in' },
      { id: 'ee3', streamNo: 'S-03', source: 'el_200', target: 'el_d210', sourcePort: 'anode_out', targetPort: 'in' },
      { id: 'ee4', streamNo: 'S-04', source: 'el_200', target: 'el_d220', sourcePort: 'cathode_out', targetPort: 'in' },
      { id: 'ee5', streamNo: 'S-05', source: 'el_d210', target: 'el_e413', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ee6', streamNo: 'S-06', source: 'el_d210', target: 'el_tank_brine', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'ee7', streamNo: 'S-07', source: 'el_e413', target: 'el_t430', sourcePort: 'out', targetPort: 'in' },
      { id: 'ee8', streamNo: 'S-08', source: 'el_t430', target: 'el_c470', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ee9', streamNo: 'S-09', source: 'el_c470', target: 'el_lq440', sourcePort: 'out', targetPort: 'in' },
      { id: 'ee10', streamNo: 'S-10', source: 'el_lq440', target: 'el_sniff', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ee11', streamNo: 'S-11', source: 'el_lq440', target: 'el_v450', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'ee12', streamNo: 'S-12', source: 'el_v450', target: 'el_p_liqcl2', sourcePort: 'out', targetPort: 'in' },
      { id: 'ee13', streamNo: 'S-13', source: 'el_d220', target: 'el_p_h2', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ee14', streamNo: 'S-14', source: 'el_d220', target: 'el_p_naoh', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  {
    id: 'hcl_synthesis',
    btnLabel: '▶ 예제 2: HCl 합성 · 35% 농도 자동맞춤 흡수탑',
    title: 'Cl₂ + H₂ 합성로(R-501) → 가스 냉각기(E-501) → 흑연 흡수탑(C-502, 목표 35 wt% HCl 흡수수 자동역산)',
    nodes: [
      {
        id: 'h_cl2', tag: 'FEED-CL2', name: '원료 Cl₂ 가스', unitType: 'feed',
        position: { x: 35, y: 55 },
        params: { feedTempC: 35, feedPressKgcm2g: 2.5, feedFlowsKgH: { Cl2: 3200 } },
      },
      {
        id: 'h_h2', tag: 'FEED-H2', name: '원료 H₂ (5% 과잉)', unitType: 'feed',
        position: { x: 35, y: 185 },
        params: { feedTempC: 35, feedPressKgcm2g: 2.5, feedFlowsKgH: { H2: 95.5 } },
      },
      {
        id: 'h_mix', tag: 'M-501', name: '원료 혼합기', unitType: 'mixer',
        position: { x: 245, y: 115 },
        params: { multiplier: 1 },
      },
      {
        id: 'h_rx', tag: 'R-501', name: '염산 합성로', unitType: 'reactor',
        position: { x: 445, y: 105 },
        params: { reactionPreset: 'hcl_burner', conversion: 0.999, operTempC: 220.0, operPressKgcm2g: 1.8 },
      },
      {
        id: 'h_hex', tag: 'E-501', name: '합성가스 냉각기', unitType: 'hex',
        position: { x: 660, y: 110 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'cw', operTempC: 55.0, overallU: 320 },
      },
      {
        id: 'h_abs', tag: 'C-502', name: '흑연 흡수탑 (35% 맞춤)', unitType: 'absorber',
        position: { x: 880, y: 95 },
        params: {
          targetComponent: 'HCl', removalEfficiency: 0.999, operTempC: 38.0,
          solventMode: 'auto_target_wt', makeupSolventComp: 'H2O', targetBottomWtPct: 35.0,
        },
      },
      {
        id: 'h_vent', tag: 'VENT-503', name: '미반응 H₂ 테일가스', unitType: 'product',
        position: { x: 1125, y: 40 },
        params: {},
      },
      {
        id: 'h_tank', tag: 'TK-510', name: '염산 제품 저장조', unitType: 'tank_visual',
        position: { x: 1125, y: 175 },
        params: { visualSpecNote: 'FRP/고무라이닝 저장탱크' },
      },
      {
        id: 'h_prod', tag: 'PROD-HCL', name: '35 wt% 고순도 염산', unitType: 'product',
        position: { x: 1320, y: 185 },
        params: {},
      },
    ],
    edges: [
      { id: 'he1', streamNo: 'S-01', source: 'h_cl2', target: 'h_mix', sourcePort: 'out', targetPort: 'in' },
      { id: 'he2', streamNo: 'S-02', source: 'h_h2', target: 'h_mix', sourcePort: 'out', targetPort: 'in' },
      { id: 'he3', streamNo: 'S-03', source: 'h_mix', target: 'h_rx', sourcePort: 'out', targetPort: 'in' },
      { id: 'he4', streamNo: 'S-04', source: 'h_rx', target: 'h_hex', sourcePort: 'out', targetPort: 'in' },
      { id: 'he5', streamNo: 'S-05', source: 'h_hex', target: 'h_abs', sourcePort: 'out', targetPort: 'in' },
      { id: 'he6', streamNo: 'S-06', source: 'h_abs', target: 'h_vent', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'he7', streamNo: 'S-07', source: 'h_abs', target: 'h_tank', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'he8', streamNo: 'S-08', source: 'h_tank', target: 'h_prod', sourcePort: 'out', targetPort: 'in' },
    ],
  },
  {
    id: 'catholyte_recycle_wegstein',
    btnLabel: '▶ 예제 3: 음극액 순환루프(Recycle) · 50% 농축 (Wegstein)',
    title: 'SP-220(78% 순환 피드백) → M-210 → E-210 → EL-200 전해조 → D-220 → SP-220 폐루프 수렴 + EV-300 50 wt% 가성소다 농축 (정밀 열역학 활성)',
    nodes: [
      {
        id: 'rc_f_an',
        tag: 'FEED-104',
        name: '포화염수 공급',
        unitType: 'feed',
        position: { x: 40, y: 55 },
        params: {
          feedTempC: 65,
          feedPressKgcm2g: 1.2,
          feedFlowsKgH: { NaCl: 78000, H2O: 226600, NaOH: 0, Cl2: 0, H2: 0, HCl: 0, H2SO4: 0, O2: 0 },
        },
      },
      {
        id: 'rc_f_pw',
        tag: 'FEED-PW',
        name: '음극 보충 순수',
        unitType: 'feed',
        position: { x: 40, y: 245 },
        params: {
          feedTempC: 40,
          feedPressKgcm2g: 1.5,
          feedFlowsKgH: { NaCl: 0, H2O: 15400, NaOH: 0, Cl2: 0, H2: 0, HCl: 0, H2SO4: 0, O2: 0 },
        },
      },
      {
        id: 'rc_m210',
        tag: 'M-210',
        name: '음극 순환 혼합기',
        unitType: 'mixer',
        position: { x: 245, y: 245 },
        params: { multiplier: 1 },
      },
      {
        id: 'rc_e210',
        tag: 'E-210',
        name: '음극액 열교환기',
        unitType: 'hex',
        position: { x: 435, y: 245 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 76,
          foulingFactor: 0.0002,
        },
      },
      {
        id: 'rc_el200',
        tag: 'EL-200',
        name: '이온교환막 전해조',
        unitType: 'electrolyzer',
        position: { x: 645, y: 125 },
        params: {
          calcMode: 'rigorous',
          currentKA: 16.2,
          cellCount: 190,
          unitCount: 5,
          currentEffPct: 94.0,
          membraneAreaM2: 2.72,
          operTempC: 89.0,
          operPressKgcm2g: 0.40,
          cathodeDeltaP: 0.15,
          waterTransportNumber: 4.2,
        },
      },
      {
        id: 'rc_d210',
        tag: 'D-210',
        name: '양극 기액분리기',
        unitType: 'separator',
        position: { x: 890, y: 45 },
        params: { calcMode: 'rigorous', operTempC: 88, operPressKgcm2g: 0.25 },
      },
      {
        id: 'rc_p_cl2',
        tag: 'PROD-CL2',
        name: '습윤 염소 가스',
        unitType: 'product',
        position: { x: 1135, y: 15 },
        params: {},
      },
      {
        id: 'rc_p_brine',
        tag: 'PROD-BRINE',
        name: '탈염 브라인',
        unitType: 'product',
        position: { x: 1135, y: 100 },
        params: {},
      },
      {
        id: 'rc_d220',
        tag: 'D-220',
        name: '음극 기액분리기',
        unitType: 'separator',
        position: { x: 890, y: 235 },
        params: { calcMode: 'rigorous', operTempC: 88, operPressKgcm2g: 0.40 },
      },
      {
        id: 'rc_p_h2',
        tag: 'PROD-H2',
        name: '수소 가스 헤더',
        unitType: 'product',
        position: { x: 1135, y: 195 },
        params: {},
      },
      {
        id: 'rc_sp220',
        tag: 'SP-220',
        name: '음극액 순환 분기기',
        unitType: 'splitter',
        position: { x: 890, y: 390 },
        params: { splitRatioTop: 0.78 },
      },
      {
        id: 'rc_ev300',
        tag: 'EV-300',
        name: '3효 가성소다 농축관',
        unitType: 'evaporator',
        position: { x: 1135, y: 385 },
        params: { calcMode: 'rigorous', evapTargetConcWt: 50.0, operTempC: 112.0, operPressKgcm2g: 0.0 },
      },
      {
        id: 'rc_p_cond',
        tag: 'PROD-COND',
        name: '증발 응축수증기',
        unitType: 'product',
        position: { x: 1365, y: 325 },
        params: {},
      },
      {
        id: 'rc_p_50',
        tag: 'PROD-50%',
        name: '50 wt% 가성소다 제품',
        unitType: 'product',
        position: { x: 1365, y: 425 },
        params: {},
      },
    ],
    edges: [
      { id: 're1', streamNo: 'S-01', source: 'rc_f_an', target: 'rc_el200', sourcePort: 'out', targetPort: 'anode_in' },
      { id: 're2', streamNo: 'S-02', source: 'rc_f_pw', target: 'rc_m210', sourcePort: 'out', targetPort: 'in' },
      { id: 're3', streamNo: 'S-03', source: 'rc_m210', target: 'rc_e210', sourcePort: 'out', targetPort: 'in' },
      { id: 're4', streamNo: 'S-04', source: 'rc_e210', target: 'rc_el200', sourcePort: 'out', targetPort: 'cathode_in' },
      { id: 're5', streamNo: 'S-05', source: 'rc_el200', target: 'rc_d210', sourcePort: 'anode_out', targetPort: 'in' },
      { id: 're6', streamNo: 'S-06', source: 'rc_d210', target: 'rc_p_cl2', sourcePort: 'vapor', targetPort: 'in' },
      { id: 're7', streamNo: 'S-07', source: 'rc_d210', target: 'rc_p_brine', sourcePort: 'liquid', targetPort: 'in' },
      { id: 're8', streamNo: 'S-08', source: 'rc_el200', target: 'rc_d220', sourcePort: 'cathode_out', targetPort: 'in' },
      { id: 're9', streamNo: 'S-09', source: 'rc_d220', target: 'rc_p_h2', sourcePort: 'vapor', targetPort: 'in' },
      { id: 're10', streamNo: 'S-10', source: 'rc_d220', target: 'rc_sp220', sourcePort: 'liquid', targetPort: 'in' },
      { id: 're11', streamNo: 'S-11', source: 'rc_sp220', target: 'rc_m210', sourcePort: 'vapor', targetPort: 'in' },
      { id: 're12', streamNo: 'S-12', source: 'rc_sp220', target: 'rc_ev300', sourcePort: 'liquid', targetPort: 'in' },
      { id: 're13', streamNo: 'S-13', source: 'rc_ev300', target: 'rc_p_cond', sourcePort: 'vapor', targetPort: 'in' },
      { id: 're14', streamNo: 'S-14', source: 'rc_ev300', target: 'rc_p_50', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  // ── 5) ECH 진공 다단 정밀증류 2탑 테스트 (NRTL · 경질 DCP 제거 + 99.9% ECH 제품탑) ──
  {
    id: 'ech_vacuum_distillation',
    btnLabel: '[다단증류 1] ECH 진공 정밀증류 2탑 (NRTL · DCP ppm 제어)',
    title: '글리세린 기반 ECH 진공 다단 정밀증류 계통 (경질 DCP 제거탑 + 99.9% 고순도 ECH 제품탑)',
    nodes: [
      {
        id: 'ech_f1',
        tag: 'FEED-CRUDE-ECH',
        name: '조(Crude) ECH 유기층 원료',
        unitType: 'feed',
        position: { x: 50, y: 185 },
        params: {
          feedTempC: 62.0,
          feedPressKgcm2g: 0.2,
          feedFlowsKgH: { ECH: 4650, DCP: 95, DCH: 215, MCH: 32, H2O: 8 },
        },
      },
      {
        id: 'ech_c101',
        tag: 'C-101',
        name: '경질분(DCP·수분) 제거 증류탑',
        unitType: 'distillation',
        position: { x: 345, y: 170 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            thermoModel: 'NRTL',
            totalStages: 24,
            feedStage: 10,
            condenserType: 'decanter_ech',
            reboilerType: 'thermosyphon',
            topPressKgcm2g: -0.65,
            stageDeltaPKgcm2: 0.0025,
            murphreeEffPct: 75,
            topSpecType: 'reflux_ratio',
            topSpecValue: 4.8,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.024,
          },
        },
      },
      {
        id: 'ech_p_light',
        tag: 'OUT-LIGHT-DCP',
        name: '경질 유기염소(DCP) 제거유분',
        unitType: 'product',
        position: { x: 645, y: 70 },
        params: {},
      },
      {
        id: 'ech_c102',
        tag: 'C-102',
        name: '고순도 ECH 진공 제품탑(85 Torr)',
        unitType: 'distillation',
        position: { x: 660, y: 245 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            thermoModel: 'NRTL',
            totalStages: 28,
            feedStage: 14,
            condenserType: 'total',
            reboilerType: 'kettle',
            topPressKgcm2g: -0.92,
            stageDeltaPKgcm2: 0.0018,
            murphreeEffPct: 78,
            topSpecType: 'reflux_ratio',
            topSpecValue: 3.2,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.946,
            spec1: {
              enabled: true,
              streamTarget: 'distillate',
              component: 'ECH',
              metric: 'purity_wt_pct',
              targetValue: 99.9,
              varyParam: 'd_over_f',
              varyMin: 0.85,
              varyMax: 0.97,
            },
          },
        },
      },
      {
        id: 'ech_p_prod',
        tag: 'PROD-ECH-99.9%',
        name: '에폭시급 고순도 ECH 제품',
        unitType: 'product',
        position: { x: 985, y: 165 },
        params: {},
      },
      {
        id: 'ech_p_heavy',
        tag: 'REC-HEAVY-DCH',
        name: '미반응 DCH·중질분 회수액',
        unitType: 'product',
        position: { x: 985, y: 330 },
        params: {},
      },
    ],
    edges: [
      { id: 'eche1', streamNo: 'E-01', source: 'ech_f1', target: 'ech_c101', sourcePort: 'out', targetPort: 'in' },
      { id: 'eche2', streamNo: 'E-02', source: 'ech_c101', target: 'ech_p_light', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'eche3', streamNo: 'E-03', source: 'ech_c101', target: 'ech_c102', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'eche4', streamNo: 'E-04', source: 'ech_c102', target: 'ech_p_prod', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'eche5', streamNo: 'E-05', source: 'ech_c102', target: 'ech_p_heavy', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  // ── 6) 폐염산 압력변동 공비증류 (PSD 진공+가압 2탑 순환루프) 테스트 ──
  {
    id: 'hcl_psd_azeotropic',
    btnLabel: '[다단증류 2] 폐염산 진공·가압 압력변동 공비증류 (PSD 루프)',
    title: '15 wt% 희박 폐염산 진공(0.15 barA)·가압(7.0 barA) 압력변동 공비증류(PSD) 회수 시뮬레이션',
    nodes: [
      {
        id: 'psd_f1',
        tag: 'FEED-SPENT-15%',
        name: '15 wt% 부생 폐염산 원료',
        unitType: 'feed',
        position: { x: 45, y: 185 },
        params: {
          feedTempC: 35.0,
          feedPressKgcm2g: 1.2,
          feedFlowsKgH: { HCl: 600, H2O: 3400 },
        },
      },
      {
        id: 'psd_m1',
        tag: 'M-300',
        name: '폐염산·순환액 합류기',
        unitType: 'mixer',
        position: { x: 280, y: 185 },
        params: {},
      },
      {
        id: 'psd_c310',
        tag: 'C-310',
        name: '진공 농축탑(0.15 barA)',
        unitType: 'distillation',
        position: { x: 525, y: 175 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            thermoModel: 'ELEC_HCL_AZEO',
            totalStages: 22,
            feedStage: 10,
            condenserType: 'total',
            reboilerType: 'thermosyphon',
            topPressKgcm2g: -0.88,
            stageDeltaPKgcm2: 0.002,
            murphreeEffPct: 75,
            topSpecType: 'reflux_ratio',
            topSpecValue: 1.8,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.221,
            spec1: {
              enabled: true,
              streamTarget: 'bottoms',
              component: 'HCl',
              metric: 'purity_wt_pct',
              targetValue: 22.0,
              varyParam: 'd_over_f',
              varyMin: 0.05,
              varyMax: 0.45,
            },
          },
        },
      },
      {
        id: 'psd_h2o',
        tag: 'PROD-CLEAN-H2O',
        name: '청정 회수수 배출',
        unitType: 'product',
        position: { x: 790, y: 80 },
        params: {},
      },
      {
        id: 'psd_p315',
        tag: 'P-315',
        name: '가압 이송펌프(6.5 kG)',
        unitType: 'pump',
        position: { x: 790, y: 245 },
        params: { outletPressKgcm2g: 6.5, efficiency: 0.72 },
      },
      {
        id: 'psd_c320',
        tag: 'C-320',
        name: '가압 공비탈기탑(7 barA)',
        unitType: 'distillation',
        position: { x: 1045, y: 215 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            thermoModel: 'ELEC_HCL_AZEO',
            totalStages: 22,
            feedStage: 9,
            condenserType: 'partial',
            reboilerType: 'thermosyphon',
            topPressKgcm2g: 6.0,
            stageDeltaPKgcm2: 0.005,
            murphreeEffPct: 75,
            topSpecType: 'reflux_ratio',
            topSpecValue: 2.0,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.046,
            spec1: {
              enabled: true,
              streamTarget: 'bottoms',
              component: 'HCl',
              metric: 'purity_wt_pct',
              targetValue: 18.2,
              varyParam: 'd_over_f',
              varyMin: 0.005,
              varyMax: 0.16,
            },
          },
        },
      },
      {
        id: 'psd_hcl',
        tag: 'PROD-HCL-VAPOR',
        name: '회수 고농도 HCl 증기',
        unitType: 'product',
        position: { x: 1320, y: 120 },
        params: {},
      },
      {
        id: 'psd_e325',
        tag: 'E-325',
        name: '순환 공비액 냉각기',
        unitType: 'hex',
        position: { x: 660, y: 390 },
        params: { calcMode: 'rigorous', refrigerantPreset: 'cw', operTempC: 58.0, operPressKgcm2g: 1.2 },
      },
    ],
    edges: [
      { id: 'psde1', streamNo: 'P-01', source: 'psd_f1', target: 'psd_m1' },
      { id: 'psde2', streamNo: 'P-02', source: 'psd_m1', target: 'psd_c310' },
      { id: 'psde3', streamNo: 'P-03', source: 'psd_c310', target: 'psd_h2o', sourcePort: 'vapor' },
      { id: 'psde4', streamNo: 'P-04', source: 'psd_c310', target: 'psd_p315', sourcePort: 'liquid' },
      { id: 'psde5', streamNo: 'P-05', source: 'psd_p315', target: 'psd_c320' },
      { id: 'psde6', streamNo: 'P-06', source: 'psd_c320', target: 'psd_hcl', sourcePort: 'vapor' },
      { id: 'psde7', streamNo: 'P-07', source: 'psd_c320', target: 'psd_e325', sourcePort: 'liquid' },
      { id: 'psde8', streamNo: 'P-08', source: 'psd_e325', target: 'psd_m1' },
    ],
  },
];

interface BaselineSheetEntry {
  result: FlowsheetSolveResult;
  elapsedMs: number;
  runCount: number;
  lastRunTime: string;
  simDefs: FlowNodeDef[];
  flowEdges: FlowEdgeDef[];
}

interface ConvergedBaselinesBundle {
  version: number;
  generatedAt: string;
  plants: {
    electrolysis: Record<string, BaselineSheetEntry>;
    hcl1A: Record<string, BaselineSheetEntry>;
    ech: Record<string, BaselineSheetEntry>;
    cms?: Record<string, BaselineSheetEntry>;
    mdi?: Record<string, BaselineSheetEntry>;
  };
}

let _baselinesPromise: Promise<ConvergedBaselinesBundle | null> | null = null;
function loadConvergedBaselines(): Promise<ConvergedBaselinesBundle | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (_baselinesPromise) return _baselinesPromise;
  _baselinesPromise = (async () => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    const urls = base
      ? [`${base}/data/converged-baselines.json`, '/data/converged-baselines.json']
      : ['/data/converged-baselines.json', '/ChemEngStudio/data/converged-baselines.json'];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          return (await res.json()) as ConvergedBaselinesBundle;
        }
      } catch {
        // try fallback URL
      }
    }
    return null;
  })();
  return _baselinesPromise;
}

function sheetToStandalonePreset(
  sheet: SheetRuntimeData,
  group: 'plant02' | 'plant03' | 'plant04' | 'plant05' | 'plant06',
  prefix: string
): PresetScenario {
  return {
    id: `${group}_${sheet.id}`,
    group,
    btnLabel: `[${sheet.sectionCode}] ${sheet.shortTabLabel}`,
    title: `${prefix} ${sheet.title}`,
    nodes: sheet.simDefs.map((d, idx) => ({
      ...d,
      subSheetId: undefined,
      subSheetBadge: undefined,
      params: { ...d.params },
      position: { ...(sheet.positions?.[d.id] ?? { x: 80 + idx * 190, y: 120 }) },
    })),
    edges: sheet.flowEdges.map(e => ({ ...e })),
  };
}

let _cachedAllPresets: PresetScenario[] | null = null;
function getAllPresets(): PresetScenario[] {
  if (_cachedAllPresets) return _cachedAllPresets;
  const p2Sheets = createInitialHierarchySheets();
  const p2Order = [
    'master',
    'sub_100_primary',
    'sub_100_secondary',
    'sub_200_cell',
    'sub_200_dechlor',
    'sub_300_evap',
    'sub_400_cooling',
    'sub_400_drying',
    'sub_400_liquefaction',
    'sub_600_h2',
    'sub_500_700_hcl_hypo',
  ];
  const p2Presets = p2Order
    .filter(k => p2Sheets[k])
    .map(k => sheetToStandalonePreset(p2Sheets[k], 'plant02', 'PLANT 01 전해 ·'));

  const p3Sheets = createInitialHcl1AHierarchySheets();
  const p3Order = ['master', 'sub_1a_100_synth', 'sub_1a_200_ahcl', 'sub_1a_300_psd'];
  const p3Presets = p3Order
    .filter(k => p3Sheets[k])
    .map(k => sheetToStandalonePreset(p3Sheets[k], 'plant03', 'PLANT 02 1A ·'));

  const p4Sheets = createInitialEchHierarchySheets();
  const p4Order = ['master', ...Object.keys(p4Sheets).filter(k => k !== 'master')];
  const p4Presets = p4Order
    .filter(k => p4Sheets[k])
    .map(k => sheetToStandalonePreset(p4Sheets[k], 'plant04', 'PLANT 03 ECH ·'));

  const p5Sheets = createInitialCmsHierarchySheets();
  const p5Order = ['master', 'sub_cms_100_rxn', 'sub_cms_200_rec', 'sub_cms_300_purif'];
  const p5Presets = p5Order
    .filter(k => p5Sheets[k])
    .map(k => sheetToStandalonePreset(p5Sheets[k], 'plant05', 'PLANT 04 CMS ·'));

  const p6Sheets = createInitialMdiHierarchySheets();
  const p6Order = ['master', 'sub_mdi_100_mda', 'sub_mdi_200_phos', 'sub_mdi_300_mcb', 'sub_mdi_400_purif'];
  const p6Presets = p6Order
    .filter(k => p6Sheets[k])
    .map(k => sheetToStandalonePreset(p6Sheets[k], 'plant06', 'PLANT 05 MDI ·'));

  _cachedAllPresets = [
    ...PRESETS.map(p => ({ ...p, group: 'general' as const })),
    ...p2Presets,
    ...p3Presets,
    ...p4Presets,
    ...p5Presets,
    ...p6Presets,
  ];
  return _cachedAllPresets;
}

// 저장 포맷 타입 (v5: 계층형 전공정 마스터 + 모든 하위 세부시트 통합 보존)
interface SavedFlowsheetState {
  version: number;
  savedAt: string;
  presetId: string;
  simDefs: FlowNodeDef[];
  positions: Record<string, { x: number; y: number }>;
  flowEdges: FlowEdgeDef[];
  hierarchySheets?: Record<string, SheetRuntimeData>;
  activeSheetId?: string;
  boundarySyncEnabled?: boolean;
  activeComponents?: SimCompKey[];
  propertyMethod?: SimPropertyMethod;
  isSimDirty?: boolean;
  lastSolvedMeta?: {
    result: FlowsheetSolveResult;
    elapsedMs: number;
    runCount: number;
    lastRunTime: string;
    solvedSheetId?: string;
  };
}

function mergeSheetFeedComponents(defs: FlowNodeDef[], base: SimCompKey[]): SimCompKey[] {
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

interface NamedProjectItem {
  id: string;
  name: string;
  savedAt: string;
  nodeCount: number;
  edgeCount: number;
  state: SavedFlowsheetState;
}

// 기본 신규 장치 초기 파라미터 생성기
function createDefaultParamsForType(type: FlowUnitType, useGenericDefault = false) {
  switch (type) {
    case 'feed':
      return useGenericDefault
        ? { feedTempC: 30, feedPressKgcm2g: 0.3, feedFlowsKgH: { MeOH: 3000, H2O: 5000 } }
        : { feedTempC: 30, feedPressKgcm2g: 0.3, feedFlowsKgH: { Cl2: 5000, O2: 25 } };
    case 'saturator':
      return {
        calcMode: 'rigorous' as const,
        targetBrineWtPct: 25.6,
        autoSaltMakeup: true,
        operTempC: 67.0,
        sludgePurgePct: 0.25,
      };
    case 'chelate_tower':
      return {
        calcMode: 'rigorous' as const,
        resinVolM3: 18.0,
        inletHardnessPpb: 1500,
        columnDeltaPKgcm2: 0.8,
        operTempC: 65.0,
      };
    case 'electrolyzer':
      return {
        currentKA: 16.2, cellCount: 190, unitCount: 5, currentEffPct: 94.0,
        waterTransportNumber: 4.2, cellVoltageV: 3.05, operTempC: 89.0, operPressKgcm2g: 0.40, cathodeDeltaP: 0.15,
      };
    case 'separator':
      return { operTempC: 40.0 };
    case 'distillation':
      return {
        calcMode: 'rigorous' as const,
        distillConfig: {
          thermoModel: 'AUTO' as const,
          totalStages: 24,
          feedStage: 12,
          condenserType: 'total' as const,
          reboilerType: 'kettle' as const,
          topPressKgcm2g: 0.05,
          stageDeltaPKgcm2: 0.004,
          murphreeEffPct: 75,
          topSpecType: 'reflux_ratio' as const,
          topSpecValue: 2.8,
          splitSpecType: 'd_over_f_mass' as const,
          splitSpecValue: 0.5,
        },
      };
    case 'absorber':
      return {
        targetComponent: 'H2O' as SimCompKey, removalEfficiency: 0.999, operTempC: 24.0,
        solventMode: 'connected_or_manual' as const, makeupSolventComp: 'H2SO4' as SimCompKey, makeupSolventKgH: 800,
      };
    case 'extractor':
      return {
        calcMode: 'rigorous' as const,
        extractorStages: 6,
        operTempC: 25.0,
        operPressKgcm2g: 0.5,
        extractorSolventComp: 'EtOAc' as SimCompKey,
        extractorSolventKgH: 800,
      };
    case 'desiccant_dryer':
      return {
        calcMode: 'rigorous' as const,
        targetDewPointC: -60.0,
        columnDeltaPKgcm2: 0.35,
      };
    case 'compressor':
      return { outletPressKgcm2g: 3.5, efficiency: 0.76, intercooledTempC: 40.0 };
    case 'liquefier':
      return {
        refrigerantPreset: 'freon_m35' as RefrigerantPresetKey,
        hexSpecMode: 'proc_temp' as const,
        operTempC: -22.0,
        overallU: 420,
      };
    case 'hex':
    case 'cooler':
      return {
        refrigerantPreset: 'cw' as RefrigerantPresetKey,
        hexSpecMode: 'proc_temp' as const,
        operTempC: 32.0,
        overallU: 450,
      };
    case 'pump':
      return { outletPressKgcm2g: 4.0, efficiency: 0.72 };
    case 'valve':
      return { calcMode: 'rigorous' as const, outletPressKgcm2g: 1.0, pressureDropKgcm2: 2.0 };
    case 'evaporator':
      return { evapTargetConcWt: 50.0, operTempC: 112.0, operPressKgcm2g: 0.0 };
    case 'reactor':
      return {
        reactionPreset: (useGenericDefault
          ? 'custom'
          : 'hcl_burner') as FlowNodeDef['params']['reactionPreset'],
        conversion: 0.995,
        operTempC: 180.0,
      };
    case 'mixer':
      return { multiplier: 1 };
    case 'splitter':
      return { splitRatioTop: 0.5 };
    default:
      return isVisualOnlyUnit(type) ? { visualSpecNote: '단순 도면 표기 설비', pressureDropKgcm2: 0 } : {};
  }
}

export interface FlowsheetWorkspaceProps {
  workspaceMode?: 'new_plant_builder' | 'electrolyzer_plant' | 'hcl_1a_plant' | 'ech_gte_plant' | 'cms_plant' | 'mdi_plant';
  embeddedInPlant?: boolean;
}

export default function FlowsheetSimulatorPage() {
  return <FlowsheetWorkspace workspaceMode="new_plant_builder" embeddedInPlant={false} />;
}

export function FlowsheetWorkspace({
  workspaceMode = 'new_plant_builder',
  embeddedInPlant = false,
}: FlowsheetWorkspaceProps) {
  const { user } = useAuth();
  const useGenericDefault = isSimulatorOnlyUser(user) || workspaceMode === 'new_plant_builder';
  const isElectrolyzerMode = workspaceMode === 'electrolyzer_plant';
  const isHcl1AMode = workspaceMode === 'hcl_1a_plant';
  const isEchGteMode = workspaceMode === 'ech_gte_plant';
  const isCmsMode = workspaceMode === 'cms_plant';
  const isMdiMode = workspaceMode === 'mdi_plant';
  const isPlantSimMode = isElectrolyzerMode || isHcl1AMode || isEchGteMode || isCmsMode || isMdiMode;
  const workspacePlantId: PlantId = isElectrolyzerMode
    ? 'clorsim_sim'
    : isHcl1AMode
      ? 'hcl_synth'
      : isEchGteMode
        ? 'ech_gte'
        : isCmsMode
          ? 'cms_plant'
          : isMdiMode
            ? 'mdi_plant'
            : 'new_builder';
  const AUTO_SAVE_KEY = isElectrolyzerMode
    ? PLANT02_AUTO_SAVE_KEY
    : isHcl1AMode
      ? PLANT03_AUTO_SAVE_KEY
      : isEchGteMode
        ? PLANT04_AUTO_SAVE_KEY
        : isCmsMode
          ? PLANT05_AUTO_SAVE_KEY
          : isMdiMode
            ? PLANT06_AUTO_SAVE_KEY
            : BUILDER_AUTO_SAVE_KEY;
  const PROJECTS_SAVE_KEY = isElectrolyzerMode
    ? 'chemplant-plant02-projects-v1'
    : isHcl1AMode
      ? 'chemplant-plant03-projects-v1'
      : isEchGteMode
        ? 'chemplant-plant04-projects-v1'
        : isCmsMode
          ? 'chemplant-plant05-projects-v1'
          : isMdiMode
            ? 'chemplant-plant06-projects-v1'
            : 'chemplant-builder-projects-v1';

  const router = useRouter();

  // 전역 기본 단위 구독 및 로컬 오버라이드 단위 상태
  const globalUnits = useUnitStore(s => s.units);
  const tagStandard = useUnitStore(s => s.tagStandard);
  const hydrateUnits = useUnitStore(s => s.hydrate);
  useEffect(() => {
    hydrateUnits();
  }, [hydrateUnits]);

  const [mobileTempUnit, setMobileTempUnit] = useLocalUnit('temp');
  const [mobilePressUnit, setMobilePressUnit] = useLocalUnit('pressG');
  const [mobileMassUnit, setMobileMassUnit] = useLocalUnit('massFlow');
  const [unitSummaryMassUnit, setUnitSummaryMassUnit] = useLocalUnit('massFlow');
  const [unitSummaryDutyUnit, setUnitSummaryDutyUnit] = useLocalUnit('heatDuty');
  const [unitSummaryPowerUnit, setUnitSummaryPowerUnit] = useLocalUnit('power');
  const [feedFlowUnit, setFeedFlowUnit] = useLocalUnit('massFlow');
  const setSimActiveSheetId = useBalanceStore(s => s.setSimActiveSheetId);
  const simRequestedSheetId = useBalanceStore(s => s.simRequestedSheetId);
  const simRequestedNodeAction = useBalanceStore(s => s.simRequestedNodeAction);
  const clearSimNodeAction = useBalanceStore(s => s.clearSimNodeAction);
  const plant02Inputs = useBalanceStore(s => s.plant02Inputs);
  const plant02SyncSeq = useBalanceStore(s => s.plant02SyncSeq);
  const plant03Inputs = useBalanceStore(s => s.plant03Inputs);
  const plant03SyncSeq = useBalanceStore(s => s.plant03SyncSeq);
  const cmsPlantInputs = useBalanceStore(s => s.cmsPlantInputs);
  const cmsPlantSummary = useBalanceStore(s => s.cmsPlantSummary);
  const cmsPlantSyncSeq = useBalanceStore(s => s.cmsPlantSyncSeq);
  const mdiPlantInputs = useBalanceStore(s => s.mdiPlantInputs);
  const mdiPlantSummary = useBalanceStore(s => s.mdiPlantSummary);
  const mdiPlantSyncSeq = useBalanceStore(s => s.mdiPlantSyncSeq);
  const setActivePlantId = useBalanceStore(s => s.setActivePlantId);
  const requestSimSheet = useBalanceStore(s => s.requestSimSheet);
  const setEquipSubTab = usePFDStore(s => s.setEquipSubTab);
  const setActiveDesignRequest = usePFDStore(s => s.setActiveDesignRequest);

  const defaultModePresetId = isElectrolyzerMode
    ? 'full_electrolyzer_plant'
    : isHcl1AMode
      ? 'full_hcl_1a_plant'
      : isEchGteMode
        ? 'full_ech_gte_plant'
        : isCmsMode
          ? 'full_cms_plant'
          : isMdiMode
            ? 'full_mdi_plant'
            : 'blank';
  const defaultSelectedNodeId = isElectrolyzerMode
    ? 'fp_t430'
    : isHcl1AMode
      ? 'h1a_c310'
      : isEchGteMode
        ? 'ech_c102'
        : isCmsMode
          ? 'cms_m_r101'
          : isMdiMode
            ? 'mdi_c401'
            : null;
  const defaultModePropertyMethod: SimPropertyMethod = isCmsMode
    ? 'PR'
    : isMdiMode
      ? 'NRTL'
      : 'AUTO';

  // 초기 상태 분기:
  // - PLANT 01 (electrolyzer_plant): 전해공장 전공정 풀패키지(100~700 SEC) 마스터 + 10개 하위 세부공정 시트
  // - PLANT 02 (hcl_1a_plant): 1A 초고순도·무수염산 & 폐염산 공비증류(PSD) 마스터 + 3개 하위 세부공정 시트
  // - PLANT 03 (ech_gte_plant): ECH 70,000 TPA (GTE 글리세린 공정) 마스터 + 3개 하위 세부공정 시트
  // - PLANT 04 (cms_plant): 클로로메탄(CMS · MCL 120 + CFM 80 T/D) 마스터 + 3개 하위 세부공정 시트
  // - PLANT 05 (mdi_plant): MDI 10만톤 통합 공정 마스터 + 4개 하위 세부공정 시트
  // - 공정 시뮬레이터 (new_plant_builder): 깔끔한 빈 캔버스로 시작 (상단 프리셋/저장 프로젝트에서 선택 불러오기 가능)
  const [initialSheets] = useState<Record<string, SheetRuntimeData>>(() => {
    if (isElectrolyzerMode) {
      return createInitialHierarchySheets();
    }
    if (isHcl1AMode) {
      return createInitialHcl1AHierarchySheets();
    }
    if (isEchGteMode) {
      return createInitialEchHierarchySheets();
    }
    if (isCmsMode) {
      return createInitialCmsHierarchySheets();
    }
    if (isMdiMode) {
      return createInitialMdiHierarchySheets();
    }
    return {
      master: {
        id: 'master',
        sectionCode: 'NEW-PLANT',
        shortTabLabel: '기본 시뮬레이션 시트',
        title: '공정 시뮬레이터',
        subtitle: '하단 팔레트에서 장치를 배치하거나 상단 프리셋·저장 프로젝트를 불러와 시뮬레이션하세요.',
        parentMasterNodeIds: [],
        simDefs: [],
        positions: {},
        flowEdges: [],
      },
    };
  });

  const [presetId, setPresetId] = useState<string>(defaultModePresetId);
  const [hierarchySheets, setHierarchySheets] = useState<Record<string, SheetRuntimeData>>(() => initialSheets);
  const [activeSheetId, setActiveSheetId] = useState<string>('master');
  const [boundarySyncEnabled, setBoundarySyncEnabled] = useState<boolean>(true);
  const [boundarySyncBanner, setBoundarySyncBanner] = useState<string[]>([]);
  const [distillModalNodeId, setDistillModalNodeId] = useState<string | null>(null);
  const [distillModalInitialView, setDistillModalInitialView] = useState<'simulation' | 'internals'>('simulation');
  const [hxModalNodeId, setHxModalNodeId] = useState<string | null>(null);
  const [hxModalInitialView, setHxModalInitialView] = useState<HxWorkbenchView>('thermal');

  const [simDefs, setSimDefs] = useState<FlowNodeDef[]>(() =>
    initialSheets.master.simDefs.map(d => ({ ...d, params: { ...d.params } }))
  );
  const [rfNodes, setRfNodes] = useState<Node<FlowCanvasNodeData>[]>(() =>
    initialSheets.master.simDefs.map(d => ({
      id: d.id,
      type: 'flowUnit',
      position: { ...(initialSheets.master.positions[d.id] ?? { x: 100, y: 120 }) },
      data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
    }))
  );
  const [flowEdges, setFlowEdges] = useState<FlowEdgeDef[]>(() =>
    initialSheets.master.flowEdges.map(e => ({ ...e }))
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(defaultSelectedNodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<'streams' | 'units'>('streams');
  const [layoutMode, setLayoutMode] = useState<'split' | 'canvas' | 'table'>('split');
  const [streamHeightPct, setStreamHeightPct] = useState<number>(38);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(true);
  const [paletteCategory, setPaletteCategory] = useState<PaletteGroupKey>('column_sep');
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [mobileCardView, setMobileCardView] = useState<boolean>(true);
  const [mobileSearch, setMobileSearch] = useState<string>('');
  const prevMobileRef = useRef<boolean | null>(null);
  const centerSplitRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const syncViewport = () => {
      const mob = window.innerWidth <= 768;
      setIsMobile(mob);
      if (prevMobileRef.current !== mob) {
        prevMobileRef.current = mob;
        if (mob) {
          setLayoutMode('canvas');
          setPaletteOpen(false);
          setInspectorOpen(false);
        } else {
          setLayoutMode('split');
          setInspectorOpen(true);
        }
      }
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  // ── 공정 성분(Active Components) & 열역학 물성 모델(Property Method) 설정 상태 ──
  const [activeComponents, setActiveComponents] = useState<SimCompKey[]>(() =>
    mergeSheetFeedComponents(initialSheets.master.simDefs, getPlantDefaultComponents(workspaceMode))
  );
  const [propertyMethod, setPropertyMethod] = useState<SimPropertyMethod>(defaultModePropertyMethod);
  const [compSetupModalOpen, setCompSetupModalOpen] = useState<boolean>(false);
  const [optModalOpen, setOptModalOpen] = useState<boolean>(false);
  const [tearMethod, setTearMethod] = useState<TearSolverMethod>('auto');
  const [designSpecs, setDesignSpecs] = useState<DesignSpecDef[]>([]);
  const [reactorModalNodeId, setReactorModalNodeId] = useState<string | null>(null);

  const feedSummaryForThermo = useMemo(() => {
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

  const autoPropertyRecommendation = useMemo(
    () => recommendPropertyMethod(activeComponents, feedSummaryForThermo.flows, feedSummaryForThermo.maxP),
    [activeComponents, feedSummaryForThermo.flows, feedSummaryForThermo.maxP]
  );

  // ── 명시적 시뮬레이션 실행([▶ RUN]) & 수렴 진단 상태 (초기 로드 시 동기 수렴 금지 · 즉시 오픈) ──
  const [solvedMeta, setSolvedMeta] = useState<{
    result: FlowsheetSolveResult;
    elapsedMs: number;
    runCount: number;
    lastRunTime: string;
  }>(() => ({
    result: createIdleFlowsheetResult(initialSheets.master.simDefs, initialSheets.master.flowEdges, {
      propertyMethod: defaultModePropertyMethod,
      activeComponents: mergeSheetFeedComponents(
        initialSheets.master.simDefs,
        getPlantDefaultComponents(workspaceMode)
      ),
    }),
    elapsedMs: 0,
    runCount: 0,
    lastRunTime: '미실행 (▶ RUN 대기)',
  }));
  const [isSimDirty, setIsSimDirty] = useState<boolean>(true);
  const [isSimRunning, setIsSimRunning] = useState<boolean>(false);
  const simRunningRef = useRef<boolean>(false);
  const convergedBaselinesRef = useRef<ConvergedBaselinesBundle | null>(null);
  const [showConvDiag, setShowConvDiag] = useState<boolean>(false);
  const skipNextDirtyRef = useRef<boolean>(true);

  const runSimulationNow = useCallback(
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
      const targetDefs = overrideDefs ?? simDefs;
      const targetEdges = overrideEdges ?? flowEdges;
      const targetMethod = overrideMethod ?? propertyMethod;
      const targetComps = overrideComps ?? activeComponents;
      const targetTear = overrideTearMethod ?? tearMethod;
      const sheetIdSnap = activeSheetId;
      const baseRunCount = solvedMeta.runCount;

      const executeSolve = () => {
        try {
          const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
          const nextRes = solveFlowsheet(targetDefs, targetEdges, {
            propertyMethod: targetMethod,
            activeComponents: targetComps,
            tearMethod: targetTear,
          });
          const dt = typeof performance !== 'undefined' ? Math.max(1, Math.round(performance.now() - t0)) : 1;
          const nowStr = new Date().toLocaleTimeString('ko-KR', { hour12: false });
          const nextRunCount = baseRunCount + 1;
          setSolvedMeta({
            result: nextRes,
            elapsedMs: dt,
            runCount: nextRunCount,
            lastRunTime: nowStr,
          });
          setHierarchySheets(prev => {
            const cur = prev[sheetIdSnap];
            if (!cur) return prev;
            return {
              ...prev,
              [sheetIdSnap]: {
                ...cur,
                simDefs: targetDefs,
                flowEdges: targetEdges,
                cachedSolvedMeta: {
                  result: nextRes,
                  elapsedMs: dt,
                  lastRunTime: nowStr,
                  runCount: nextRunCount,
                },
              },
            };
          });
          setIsSimDirty(false);
        } finally {
          simRunningRef.current = false;
          setIsSimRunning(false);
        }
      };

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.setTimeout(executeSolve, 0);
          });
        });
      } else {
        setTimeout(executeSolve, 0);
      }
    },
    [simDefs, flowEdges, propertyMethod, activeComponents, tearMethod, solvedMeta.runCount, activeSheetId]
  );

  const startResizeSplit = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = centerSplitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const fromBottom = rect.bottom - ev.clientY;
      const pct = Math.max(18, Math.min(78, (fromBottom / Math.max(200, rect.height)) * 100));
      setStreamHeightPct(pct);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // 전체 계산 장치 일괄 모드 전환 (간편 발란스 vs 정밀 열역학)
  const setAllUnitsCalcMode = useCallback((mode: UnitCalcMode) => {
    setSimDefs(prev =>
      prev.map(d => {
        if (
          isVisualOnlyUnit(d.unitType) ||
          d.unitType === 'feed' ||
          d.unitType === 'product' ||
          d.unitType === 'mixer' ||
          d.unitType === 'splitter'
        ) {
          return d;
        }
        return { ...d, params: { ...d.params, calcMode: mode } };
      })
    );
  }, []);

  // 자동저장 상태 및 케이스 저장 모달 상태
  const [hydrated, setHydrated] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string>('');
  const [namedProjects, setNamedProjects] = useState<NamedProjectItem[]>([]);
  const [activeCaseName, setActiveCaseName] = useState<string | null>(null);
  const [projectNameInput, setProjectNameInput] = useState<string>('');
  const [showStorageBar, setShowStorageBar] = useState(false);
  const processTextInputRef = useRef<HTMLInputElement | null>(null);
  const [interopNotice, setInteropNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
    warnings?: string[];
  } | null>(null);

  const rfWrapperRef = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  // 현재 캔버스 위치를 추출하는 헬퍼
  const extractCurrentPositions = useCallback((nodes: Node<FlowCanvasNodeData>[]) => {
    const pos: Record<string, { x: number; y: number }> = {};
    nodes.forEach(n => {
      pos[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    });
    return pos;
  }, []);

  // ── Undo / Redo 히스토리 스택 (최대 40 스냅샷) ──────────────────────────
  type FlowsheetHistorySnapshot = {
    simDefs: FlowNodeDef[];
    positions: Record<string, { x: number; y: number }>;
    flowEdges: FlowEdgeDef[];
  };
  const MAX_UNDO_HISTORY = 40;
  const undoPastRef = useRef<FlowsheetHistorySnapshot[]>([]);
  const undoFutureRef = useRef<FlowsheetHistorySnapshot[]>([]);
  const [undoDepth, setUndoDepth] = useState<number>(0);
  const [redoDepth, setRedoDepth] = useState<number>(0);
  const canUndo = undoDepth > 0;
  const canRedo = redoDepth > 0;

  const liveSimDefsRef = useRef(simDefs);
  liveSimDefsRef.current = simDefs;
  const liveRfNodesRef = useRef(rfNodes);
  liveRfNodesRef.current = rfNodes;
  const liveFlowEdgesRef = useRef(flowEdges);
  liveFlowEdgesRef.current = flowEdges;
  const liveActiveSheetIdRef = useRef(activeSheetId);
  liveActiveSheetIdRef.current = activeSheetId;

  const dragStartSnapshotRef = useRef<FlowsheetHistorySnapshot | null>(null);
  const paramEditCooldownRef = useRef<number>(0);
  const lastDeleteUndoTsRef = useRef<number>(0);

  const cloneHistorySnapshot = useCallback(
    (
      defs: FlowNodeDef[],
      positions: Record<string, { x: number; y: number }>,
      edges: FlowEdgeDef[]
    ): FlowsheetHistorySnapshot => ({
      simDefs: defs.map(d => ({
        ...d,
        params: d.params
          ? {
              ...d.params,
              ...(d.params.feedFlowsKgH ? { feedFlowsKgH: { ...d.params.feedFlowsKgH } } : {}),
              ...(d.params.distillConfig ? { distillConfig: structuredClone(d.params.distillConfig) } : {}),
            }
          : {},
      })),
      positions: Object.fromEntries(
        Object.entries(positions).map(([k, v]) => [k, { x: Math.round(v.x), y: Math.round(v.y) }])
      ),
      flowEdges: edges.map(e => ({ ...e })),
    }),
    []
  );

  const pushUndoSnapshot = useCallback(
    (explicitSnap?: FlowsheetHistorySnapshot) => {
      const snap =
        explicitSnap ??
        cloneHistorySnapshot(
          liveSimDefsRef.current,
          extractCurrentPositions(liveRfNodesRef.current),
          liveFlowEdgesRef.current
        );
      undoPastRef.current.push(snap);
      if (undoPastRef.current.length > MAX_UNDO_HISTORY) {
        undoPastRef.current.shift();
      }
      undoFutureRef.current = [];
      setUndoDepth(undoPastRef.current.length);
      setRedoDepth(0);
    },
    [cloneHistorySnapshot, extractCurrentPositions]
  );

  // 파라미터 연속 입력 시 매 키입력마다 스택이 쌓이지 않도록 500ms 단위 그룹핑
  const recordParamEditSnapshot = useCallback(() => {
    const now = Date.now();
    if (now - paramEditCooldownRef.current > 500) {
      pushUndoSnapshot();
    }
    paramEditCooldownRef.current = now;
  }, [pushUndoSnapshot]);

  const clearUndoHistory = useCallback(() => {
    undoPastRef.current = [];
    undoFutureRef.current = [];
    setUndoDepth(0);
    setRedoDepth(0);
  }, []);

  const restoreHistorySnapshot = useCallback(
    (snap: FlowsheetHistorySnapshot) => {
      const cloned = cloneHistorySnapshot(snap.simDefs, snap.positions, snap.flowEdges);
      setSimDefs(cloned.simDefs);
      setRfNodes(
        cloned.simDefs.map((d, idx) => ({
          id: d.id,
          type: 'flowUnit',
          position: cloned.positions[d.id] ?? { x: 80 + idx * 175, y: 140 },
          data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
        }))
      );
      setFlowEdges(cloned.flowEdges);

      const curSheetId = liveActiveSheetIdRef.current;
      setHierarchySheets(prev => {
        const existing = prev[curSheetId];
        if (!existing) return prev;
        return {
          ...prev,
          [curSheetId]: {
            ...existing,
            simDefs: cloned.simDefs.map(d => ({ ...d, params: { ...d.params } })),
            positions: cloned.positions,
            flowEdges: cloned.flowEdges.map(e => ({ ...e })),
          },
        };
      });
      setIsSimDirty(true);
      setSelectedNodeId(prevId => (prevId && cloned.simDefs.some(d => d.id === prevId) ? prevId : null));
      setSelectedEdgeId(prevId => (prevId && cloned.flowEdges.some(e => e.id === prevId) ? prevId : null));
    },
    [cloneHistorySnapshot]
  );

  const handleUndo = useCallback(() => {
    if (undoPastRef.current.length === 0) return;
    const prevSnap = undoPastRef.current.pop()!;
    const curSnap = cloneHistorySnapshot(
      liveSimDefsRef.current,
      extractCurrentPositions(liveRfNodesRef.current),
      liveFlowEdgesRef.current
    );
    undoFutureRef.current.push(curSnap);
    if (undoFutureRef.current.length > MAX_UNDO_HISTORY) {
      undoFutureRef.current.shift();
    }
    setUndoDepth(undoPastRef.current.length);
    setRedoDepth(undoFutureRef.current.length);
    restoreHistorySnapshot(prevSnap);
  }, [cloneHistorySnapshot, extractCurrentPositions, restoreHistorySnapshot]);

  const handleRedo = useCallback(() => {
    if (undoFutureRef.current.length === 0) return;
    const nextSnap = undoFutureRef.current.pop()!;
    const curSnap = cloneHistorySnapshot(
      liveSimDefsRef.current,
      extractCurrentPositions(liveRfNodesRef.current),
      liveFlowEdgesRef.current
    );
    undoPastRef.current.push(curSnap);
    if (undoPastRef.current.length > MAX_UNDO_HISTORY) {
      undoPastRef.current.shift();
    }
    setUndoDepth(undoPastRef.current.length);
    setRedoDepth(undoFutureRef.current.length);
    restoreHistorySnapshot(nextSnap);
  }, [cloneHistorySnapshot, extractCurrentPositions, restoreHistorySnapshot]);

  const onNodeDragStart = useCallback(() => {
    dragStartSnapshotRef.current = cloneHistorySnapshot(
      liveSimDefsRef.current,
      extractCurrentPositions(liveRfNodesRef.current),
      liveFlowEdgesRef.current
    );
  }, [cloneHistorySnapshot, extractCurrentPositions]);

  const onNodeDragStop = useCallback(() => {
    const before = dragStartSnapshotRef.current;
    dragStartSnapshotRef.current = null;
    if (!before) return;
    const afterPos = extractCurrentPositions(liveRfNodesRef.current);
    const moved = Object.keys(afterPos).some(id => {
      const b = before.positions[id];
      const a = afterPos[id];
      return !b || Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1;
    });
    if (moved) {
      pushUndoSnapshot(before);
    }
  }, [extractCurrentPositions, pushUndoSnapshot]);

  useEffect(() => {
    const onUndoRedoKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onUndoRedoKeyDown);
    return () => window.removeEventListener('keydown', onUndoRedoKeyDown);
  }, [handleUndo, handleRedo]);

  // ── 우클릭 드래그 마키(Box) 다중선택 상태 및 핸들러 ────────────────────────
  const [rmbSelectBox, setRmbSelectBox] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const suppressContextMenuRef = useRef<boolean>(false);

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 2) return;
      const wrapper = rfWrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startRelX = startClientX - rect.left;
      const startRelY = startClientY - rect.top;
      let dragging = false;

      const onMouseMove = (ev: MouseEvent) => {
        const dx = Math.abs(ev.clientX - startClientX);
        const dy = Math.abs(ev.clientY - startClientY);
        if (!dragging && (dx > 6 || dy > 6)) {
          dragging = true;
          suppressContextMenuRef.current = true;
        }
        if (dragging) {
          setRmbSelectBox({
            startX: startRelX,
            startY: startRelY,
            curX: ev.clientX - rect.left,
            curY: ev.clientY - rect.top,
          });
        }
      };

      const onMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (dragging && rfInstance) {
          const minClientX = Math.min(startClientX, ev.clientX);
          const maxClientX = Math.max(startClientX, ev.clientX);
          const minClientY = Math.min(startClientY, ev.clientY);
          const maxClientY = Math.max(startClientY, ev.clientY);
          const topLeft = rfInstance.screenToFlowPosition({ x: minClientX, y: minClientY });
          const bottomRight = rfInstance.screenToFlowPosition({ x: maxClientX, y: maxClientY });
          const boxMinX = Math.min(topLeft.x, bottomRight.x);
          const boxMaxX = Math.max(topLeft.x, bottomRight.x);
          const boxMinY = Math.min(topLeft.y, bottomRight.y);
          const boxMaxY = Math.max(topLeft.y, bottomRight.y);

          const hitIds = new Set<string>();
          for (const n of liveRfNodesRef.current) {
            const nx1 = n.position.x;
            const ny1 = n.position.y;
            const nx2 = nx1 + (n.width ?? 150);
            const ny2 = ny1 + (n.height ?? 75);
            if (nx2 >= boxMinX && nx1 <= boxMaxX && ny2 >= boxMinY && ny1 <= boxMaxY) {
              hitIds.add(n.id);
            }
          }
          setRfNodes(prev => prev.map(n => ({ ...n, selected: hitIds.has(n.id) })));
          const firstHit = hitIds.values().next().value as string | undefined;
          setSelectedNodeId(firstHit ?? null);
          setSelectedEdgeId(null);
          setTimeout(() => {
            suppressContextMenuRef.current = false;
          }, 150);
        }
        setRmbSelectBox(null);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [rfInstance]
  );

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressContextMenuRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressContextMenuRef.current = false;
    }
  }, []);

  // ── 계층형 시트 전환 (자동 수렴 실행 없이 마지막 저장/캐시 상태로 0ms 즉시 이동) ──
  const navigateToHierarchySheet = useCallback(
    (targetSheetId: string) => {
      if (targetSheetId === activeSheetId) return;
      const curPositions = extractCurrentPositions(rfNodes);
      const curCached =
        !isSimDirty && !solvedMeta.result.convergence.isIdle
          ? {
              result: solvedMeta.result,
              elapsedMs: solvedMeta.elapsedMs,
              lastRunTime: solvedMeta.lastRunTime,
              runCount: solvedMeta.runCount,
            }
          : hierarchySheets[activeSheetId]?.cachedSolvedMeta;

      const nextSheets: Record<string, SheetRuntimeData> = {
        ...hierarchySheets,
        [activeSheetId]: {
          ...(hierarchySheets[activeSheetId] ?? {
            id: activeSheetId,
            sectionCode: activeSheetId.toUpperCase(),
            shortTabLabel: activeSheetId,
            title: activeSheetId,
            subtitle: '',
            parentMasterNodeIds: [],
          }),
          simDefs: simDefs.map(d => ({ ...d, params: { ...d.params } })),
          positions: curPositions,
          flowEdges: flowEdges.map(e => ({ ...e })),
          cachedSolvedMeta: curCached,
        },
      };

      // 1) 하위 세부공정에서 이미 실행된 결과가 있을 때만 마스터 블록 파라미터에 역반영 (동기 재계산 없음)
      if (activeSheetId !== 'master' && nextSheets.master && curCached && !curCached.result.convergence.isIdle) {
        const rolledMasterDefs = rollupSubSheetToMasterDefs(
          activeSheetId,
          simDefs,
          curCached.result,
          nextSheets.master.simDefs
        );
        nextSheets.master = {
          ...nextSheets.master,
          simDefs: rolledMasterDefs,
        };
      }

      const targetSheet = nextSheets[targetSheetId];
      if (!targetSheet) return;

      let nextTargetDefs = targetSheet.simDefs.map(d => ({ ...d, params: { ...d.params } }));
      let boundaryUpdated = false;

      // 2) 마스터가 이미 수렴된 캐시를 보유한 경우에만 하위 경계 Feed에 주입 (동기 재계산 없음)
      const masterCached = nextSheets.master?.cachedSolvedMeta;
      if (
        targetSheetId !== 'master' &&
        boundarySyncEnabled &&
        nextSheets.master &&
        masterCached &&
        !masterCached.result.convergence.isIdle
      ) {
        const { syncedDefs, syncedDescriptions } = isCmsMode
          ? syncCmsSubDefsFromMaster(
              targetSheetId,
              nextTargetDefs,
              nextSheets.master.flowEdges,
              masterCached.result.streams
            )
          : isMdiMode
            ? syncMdiSubDefsFromMaster(
                targetSheetId,
                nextTargetDefs,
                nextSheets.master.flowEdges,
                masterCached.result.streams
              )
            : applyMasterBoundaryToSubDefs(
                nextTargetDefs,
                nextSheets.master.flowEdges,
                masterCached.result.streams
              );
        nextTargetDefs = syncedDefs;
        boundaryUpdated = syncedDescriptions.length > 0;
        nextSheets[targetSheetId] = { ...targetSheet, simDefs: nextTargetDefs };
        setBoundarySyncBanner(syncedDescriptions);
      } else {
        setBoundarySyncBanner([]);
      }

      const nextEdges = targetSheet.flowEdges.map(e => ({ ...e }));
      clearUndoHistory();
      skipNextDirtyRef.current = true;
      setHierarchySheets(nextSheets);
      setActiveSheetId(targetSheetId);
      setSimDefs(nextTargetDefs);
      setRfNodes(
        nextTargetDefs.map((d, idx) => ({
          id: d.id,
          type: 'flowUnit',
          position: { ...(targetSheet.positions[d.id] ?? { x: 80 + idx * 175, y: 140 }) },
          data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
        }))
      );
      setFlowEdges(nextEdges);

      const targetCached = !boundaryUpdated ? targetSheet.cachedSolvedMeta : undefined;
      if (targetCached && !targetCached.result.convergence.isIdle) {
        setSolvedMeta({
          result: targetCached.result,
          elapsedMs: targetCached.elapsedMs,
          runCount: Math.max(1, targetCached.runCount),
          lastRunTime: targetCached.lastRunTime,
        });
        setIsSimDirty(false);
      } else {
        setSolvedMeta({
          result: createIdleFlowsheetResult(nextTargetDefs, nextEdges, {
            propertyMethod,
            activeComponents,
          }),
          elapsedMs: 0,
          runCount: 0,
          lastRunTime: '미실행 (▶ RUN 대기)',
        });
        setIsSimDirty(true);
      }

      const preferredSelect =
        targetSheetId === 'master'
          ? defaultSelectedNodeId
          : nextTargetDefs.find(d => d.unitType !== 'feed' && d.unitType !== 'product')?.id ??
            nextTargetDefs[0]?.id ??
            null;
      setSelectedNodeId(preferredSelect);
      setSelectedEdgeId(null);

      setTimeout(() => {
        rfInstance?.fitView({ padding: 0.14, duration: 240 });
      }, 60);
    },
    [activeComponents, activeSheetId, boundarySyncEnabled, defaultSelectedNodeId, extractCurrentPositions, flowEdges, hierarchySheets, isCmsMode, isMdiMode, isSimDirty, propertyMethod, rfInstance, rfNodes, simDefs, solvedMeta]
  );

  // 전공정 풀패키지 모드 활성화 또는 공장 초기화 (자동 수렴 실행 금지 — 즉시 오픈)
  const activateFullPlantPackage = useCallback(
    (resetToFactory = false) => {
      const sheetsRaw =
        resetToFactory || !hierarchySheets.master
          ? isHcl1AMode
            ? createInitialHcl1AHierarchySheets()
            : isEchGteMode
              ? createInitialEchHierarchySheets()
              : isCmsMode
                ? createInitialCmsHierarchySheets()
                : isMdiMode
                  ? createInitialMdiHierarchySheets()
                  : createInitialHierarchySheets()
          : isPlantSimMode && activeSheetId !== 'master'
            ? (() => {
                const curPos = extractCurrentPositions(rfNodes);
                const hasSubResult = !isSimDirty && !solvedMeta.result.convergence.isIdle;
                const rolledMaster = hasSubResult
                  ? rollupSubSheetToMasterDefs(
                      activeSheetId,
                      simDefs,
                      solvedMeta.result,
                      hierarchySheets.master.simDefs
                    )
                  : hierarchySheets.master.simDefs;
                return {
                  ...hierarchySheets,
                  [activeSheetId]: {
                    ...hierarchySheets[activeSheetId],
                    simDefs,
                    positions: curPos,
                    flowEdges,
                    cachedSolvedMeta: hasSubResult
                      ? {
                          result: solvedMeta.result,
                          elapsedMs: solvedMeta.elapsedMs,
                          lastRunTime: solvedMeta.lastRunTime,
                          runCount: solvedMeta.runCount,
                        }
                      : hierarchySheets[activeSheetId]?.cachedSolvedMeta,
                  },
                  master: {
                    ...hierarchySheets.master,
                    simDefs: rolledMaster,
                  },
                };
              })()
            : hierarchySheets;

      const pKey: 'electrolysis' | 'hcl1A' | 'ech' | 'cms' | 'mdi' = isHcl1AMode
        ? 'hcl1A'
        : isEchGteMode
          ? 'ech'
          : isCmsMode
            ? 'cms'
            : isMdiMode
              ? 'mdi'
              : 'electrolysis';
      const baselinePlant = resetToFactory ? convergedBaselinesRef.current?.plants[pKey] : undefined;
      const sheets: Record<string, SheetRuntimeData> = { ...sheetsRaw };
      if (baselinePlant) {
        for (const [sid, sh] of Object.entries(sheets)) {
          const bEntry = baselinePlant[sid];
          if (bEntry) {
            sheets[sid] = {
              ...sh,
              simDefs: bEntry.simDefs.map(d => ({ ...d, params: { ...d.params } })),
              flowEdges: bEntry.flowEdges.map(e => ({ ...e })),
              cachedSolvedMeta: {
                result: bEntry.result,
                elapsedMs: bEntry.elapsedMs,
                lastRunTime: bEntry.lastRunTime,
                runCount: bEntry.runCount,
              },
            };
          }
        }
      }

      const master = sheets.master;
      const nextDefs = master.simDefs.map(d => ({ ...d, params: { ...d.params } }));
      const nextEdges = master.flowEdges.map(e => ({ ...e }));
      skipNextDirtyRef.current = true;
      setPresetId(defaultModePresetId);
      setHierarchySheets(sheets);
      setActiveSheetId('master');
      setBoundarySyncBanner([]);
      setSimDefs(nextDefs);
      setRfNodes(
        master.simDefs.map((d, idx) => ({
          id: d.id,
          type: 'flowUnit',
          position: { ...(master.positions[d.id] ?? { x: 80 + idx * 175, y: 140 }) },
          data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
        }))
      );
      setFlowEdges(nextEdges);
      if (master.cachedSolvedMeta && !master.cachedSolvedMeta.result.convergence.isIdle) {
        setSolvedMeta({
          result: master.cachedSolvedMeta.result,
          elapsedMs: master.cachedSolvedMeta.elapsedMs,
          runCount: Math.max(1, master.cachedSolvedMeta.runCount),
          lastRunTime: master.cachedSolvedMeta.lastRunTime,
        });
        setIsSimDirty(false);
      } else {
        setSolvedMeta({
          result: createIdleFlowsheetResult(nextDefs, nextEdges, {
            propertyMethod,
            activeComponents,
          }),
          elapsedMs: 0,
          runCount: 0,
          lastRunTime: '미실행 (▶ RUN 대기)',
        });
        setIsSimDirty(true);
      }
      setSelectedNodeId(defaultSelectedNodeId);
      setSelectedEdgeId(null);
      if (resetToFactory) {
        setActiveCaseTitle(null, workspacePlantId);
      }
      setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 240 }), 60);
    },
    [activeComponents, activeSheetId, defaultModePresetId, defaultSelectedNodeId, extractCurrentPositions, flowEdges, hierarchySheets, isCmsMode, isEchGteMode, isHcl1AMode, isMdiMode, isPlantSimMode, isSimDirty, propertyMethod, rfInstance, rfNodes, simDefs, solvedMeta, workspacePlantId]
  );

  // 사용자가 마스터 도면에 새로 추가한 커스텀 블록에도 내부 세부 시트를 생성해 진입할 수 있게 지원
  const createCustomSubSheetForNode = useCallback(
    (nodeDef: FlowNodeDef) => {
      const newSubId = `sub_custom_${nodeDef.id}`;
      const updatedMasterDefs = simDefs.map(d =>
        d.id === nodeDef.id ? { ...d, subSheetId: newSubId, subSheetBadge: '사용자 세부공정' } : d
      );
      const curPos = extractCurrentPositions(rfNodes);
      const customSubSheet: SheetRuntimeData = {
        id: newSubId,
        sectionCode: nodeDef.tag,
        shortTabLabel: `${nodeDef.tag} 세부공정`,
        title: `${nodeDef.tag} (${nodeDef.name}) 세부 공정 시뮬레이션`,
        subtitle: '상위 마스터 도면에서 전달된 경계 유입 유량을 기반으로 내부 장치를 자유롭게 구성하세요.',
        parentMasterNodeIds: [nodeDef.id],
        simDefs: [
          {
            id: `${newSubId}_in`,
            tag: `BOUND-${nodeDef.tag}`,
            name: `${nodeDef.name} 경계 유입`,
            unitType: 'feed',
            params: {
              boundaryFromMasterNodeId: nodeDef.id,
              boundaryPortRole: 'in',
              feedTempC: 35,
              feedPressKgcm2g: 1.0,
              feedFlowsKgH: { H2O: 5000, NaCl: 1000 },
            },
          },
          {
            id: `${newSubId}_u1`,
            tag: `${nodeDef.tag}-A`,
            name: `${nodeDef.name} 주기기`,
            unitType: nodeDef.unitType,
            params: { ...nodeDef.params },
          },
          {
            id: `${newSubId}_out`,
            tag: `OUT-${nodeDef.tag}`,
            name: `${nodeDef.name} 출구 헤더`,
            unitType: 'product',
            params: {},
          },
        ],
        positions: {
          [`${newSubId}_in`]: { x: 60, y: 180 },
          [`${newSubId}_u1`]: { x: 340, y: 170 },
          [`${newSubId}_out`]: { x: 640, y: 180 },
        },
        flowEdges: [
          { id: `${newSubId}_e1`, streamNo: 'SUB-01', source: `${newSubId}_in`, target: `${newSubId}_u1`, sourcePort: 'out', targetPort: 'in' },
          { id: `${newSubId}_e2`, streamNo: 'SUB-02', source: `${newSubId}_u1`, target: `${newSubId}_out`, sourcePort: 'out', targetPort: 'in' },
        ],
      };

      let syncedDescriptions: string[] = [];
      if (activeSheetId === 'master' && !solvedMeta.result.convergence.isIdle) {
        const synced = applyMasterBoundaryToSubDefs(
          customSubSheet.simDefs,
          flowEdges,
          solvedMeta.result.streams
        );
        customSubSheet.simDefs = synced.syncedDefs;
        syncedDescriptions = synced.syncedDescriptions;
      }

      const nextSheets: Record<string, SheetRuntimeData> = {
        ...hierarchySheets,
        master: {
          ...hierarchySheets.master,
          simDefs: updatedMasterDefs,
          positions: curPos,
          flowEdges: flowEdges.map(e => ({ ...e })),
        },
        [newSubId]: customSubSheet,
      };

      skipNextDirtyRef.current = true;
      setHierarchySheets(nextSheets);
      setActiveSheetId(newSubId);
      setBoundarySyncBanner(syncedDescriptions);
      setSimDefs(customSubSheet.simDefs);
      setRfNodes(
        customSubSheet.simDefs.map(d => ({
          id: d.id,
          type: 'flowUnit',
          position: { ...customSubSheet.positions[d.id] },
          data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
        }))
      );
      setFlowEdges(customSubSheet.flowEdges);
      setSolvedMeta({
        result: createIdleFlowsheetResult(customSubSheet.simDefs, customSubSheet.flowEdges, {
          propertyMethod,
          activeComponents,
        }),
        elapsedMs: 0,
        runCount: 0,
        lastRunTime: '미실행 (▶ RUN 대기)',
      });
      setIsSimDirty(true);
      setSelectedNodeId(`${newSubId}_u1`);
      setSelectedEdgeId(null);
      setTimeout(() => rfInstance?.fitView({ padding: 0.16, duration: 240 }), 60);
    },
    [activeComponents, activeSheetId, extractCurrentPositions, flowEdges, hierarchySheets, propertyMethod, rfInstance, rfNodes, simDefs, solvedMeta.result]
  );

  // ── 1) 페이지 재접속 시 모드별 격리 localStorage에서 마지막 작업 자동 복원 (동기 solveFlowsheet 절대 호출 안 함) ──
  useEffect(() => {
    let alive = true;
    let restoredSheetId = 'master';
    let hadSavedSolved = false;
    let skipBaselineOverride = false;
    let savedNodeCount = initialSheets.master.simDefs.length;
    try {
      let pending: PendingCaseLoadPayload | null = null;
      const rawPendingStr = window.sessionStorage.getItem(PENDING_CASE_LOAD_KEY);
      if (rawPendingStr) {
        try {
          const peek = JSON.parse(rawPendingStr) as Partial<PendingCaseLoadPayload>;
          const normTarget = peek?.targetPlantId === 'clorsim' ? 'clorsim_sim' : peek?.targetPlantId;
          if (
            peek &&
            peek.uiMode === 'modern' &&
            (!normTarget || normTarget === workspacePlantId || workspacePlantId === 'new_builder')
          ) {
            pending = consumePendingCaseLoad('modern');
          }
        } catch {
          pending = consumePendingCaseLoad('modern');
        }
      }

      if (pending) {
        skipBaselineOverride = true;
        if (pending.action === 'load_project' && pending.rawProject?.state) {
          const parsed: SavedFlowsheetState = pending.rawProject.state;
          if (parsed && Array.isArray(parsed.simDefs) && Array.isArray(parsed.flowEdges)) {
            savedNodeCount = parsed.simDefs.length;
            skipNextDirtyRef.current = true;
            const restoredMethod: SimPropertyMethod =
              parsed.propertyMethod === 'ENRTL' ||
              parsed.propertyMethod === 'NRTL' ||
              parsed.propertyMethod === 'PR' ||
              parsed.propertyMethod === 'SRK' ||
              parsed.propertyMethod === 'AUTO'
                ? parsed.propertyMethod
                : defaultModePropertyMethod;
            const baseComps =
              Array.isArray(parsed.activeComponents) && parsed.activeComponents.length > 0
                ? (parsed.activeComponents.filter(c => SIM_COMPS.includes(c)) as SimCompKey[])
                : getPlantDefaultComponents(workspaceMode);
            const restoredComps = mergeSheetFeedComponents(parsed.simDefs, baseComps);
            restoredSheetId = parsed.activeSheetId || 'master';
            setPropertyMethod(restoredMethod);
            setActiveComponents(restoredComps);
            setPresetId(parsed.presetId || defaultModePresetId);
            if (parsed.hierarchySheets && Object.keys(parsed.hierarchySheets).length > 0) {
              setHierarchySheets(parsed.hierarchySheets);
            } else if (!isPlantSimMode) {
              setHierarchySheets({
                master: {
                  id: 'master',
                  sectionCode: 'NEW-PLANT',
                  shortTabLabel: '기본 시뮬레이션 시트',
                  title: '공정 시뮬레이터',
                  subtitle: '하단 팔레트에서 장치를 배치하거나 상단 프리셋·저장 프로젝트를 불러와 시뮬레이션하세요.',
                  parentMasterNodeIds: [],
                  simDefs: parsed.simDefs,
                  positions: parsed.positions ?? {},
                  flowEdges: parsed.flowEdges,
                },
              });
            }
            setActiveSheetId(restoredSheetId);
            if (typeof parsed.boundarySyncEnabled === 'boolean') {
              setBoundarySyncEnabled(parsed.boundarySyncEnabled);
            }
            setBoundarySyncBanner([]);
            setSimDefs(parsed.simDefs);
            setRfNodes(
              parsed.simDefs.map((d, idx) => ({
                id: d.id,
                type: 'flowUnit',
                position: parsed.positions?.[d.id] ?? { x: 80 + idx * 180, y: 120 },
                data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
              }))
            );
            setFlowEdges(parsed.flowEdges);

            const savedMetaCandidate =
              parsed.lastSolvedMeta?.result &&
              Array.isArray(parsed.lastSolvedMeta.result.streams) &&
              (!parsed.lastSolvedMeta.solvedSheetId || parsed.lastSolvedMeta.solvedSheetId === restoredSheetId)
                ? parsed.lastSolvedMeta
                : parsed.hierarchySheets?.[restoredSheetId]?.cachedSolvedMeta;

            if (savedMetaCandidate?.result && !savedMetaCandidate.result.convergence?.isIdle) {
              hadSavedSolved = true;
              setSolvedMeta({
                result: savedMetaCandidate.result,
                elapsedMs: savedMetaCandidate.elapsedMs ?? 1,
                runCount: Math.max(1, savedMetaCandidate.runCount ?? 1),
                lastRunTime: savedMetaCandidate.lastRunTime || parsed.savedAt || '저장 케이스 복원',
              });
              setIsSimDirty(Boolean(parsed.isSimDirty));
            } else {
              setSolvedMeta({
                result: createIdleFlowsheetResult(parsed.simDefs, parsed.flowEdges, {
                  propertyMethod: restoredMethod,
                  activeComponents: restoredComps,
                }),
                elapsedMs: 0,
                runCount: 0,
                lastRunTime: '미실행 (▶ RUN 대기)',
              });
              setIsSimDirty(true);
            }
            setSelectedNodeId(parsed.simDefs[0]?.id ?? null);
            setSelectedEdgeId(null);
            setLastSavedTime(parsed.savedAt || '저장 케이스 불러옴');
            setActiveCaseTitle(pending.caseName || pending.rawProject.name || null, workspacePlantId);
          }
        } else if (pending.action === 'new_blank') {
          savedNodeCount = 0;
          skipNextDirtyRef.current = true;
          const defaultComps = getPlantDefaultComponents(workspaceMode);
          setPropertyMethod(defaultModePropertyMethod);
          setActiveComponents(defaultComps);
          setPresetId('blank');
          setActiveSheetId('master');
          setBoundarySyncBanner([]);
          if (!isPlantSimMode) {
            setHierarchySheets({
              master: {
                id: 'master',
                sectionCode: 'NEW-PLANT',
                shortTabLabel: '기본 시뮬레이션 시트',
                title: '공정 시뮬레이터',
                subtitle: '하단 팔레트에서 장치를 배치하거나 상단 프리셋·저장 프로젝트를 불러와 시뮬레이션하세요.',
                parentMasterNodeIds: [],
                simDefs: [],
                positions: {},
                flowEdges: [],
              },
            });
          }
          setSimDefs([]);
          setRfNodes([]);
          setFlowEdges([]);
          setSolvedMeta({
            result: createIdleFlowsheetResult([], [], {
              propertyMethod: defaultModePropertyMethod,
              activeComponents: defaultComps,
            }),
            elapsedMs: 0,
            runCount: 0,
            lastRunTime: '미실행 (▶ RUN 대기)',
          });
          setIsSimDirty(true);
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setActiveCaseTitle(null, workspacePlantId);
        }
      } else {
        const handoff = workspaceMode === 'new_plant_builder' ? consumeUiSwitchHandoff() : null;
        if (handoff && handoff.fromUi === 'classic') {
          skipNextDirtyRef.current = true;
          const nextMethod: SimPropertyMethod = handoff.thermoMethod ?? 'AUTO';
          const baseComps =
            Array.isArray(handoff.activeComponents) && handoff.activeComponents.length > 0
              ? (handoff.activeComponents.filter(c => SIM_COMPS.includes(c)) as SimCompKey[])
              : getPlantDefaultComponents(workspaceMode);
          const restoredComps = mergeSheetFeedComponents(handoff.simDefs, baseComps);
          setPropertyMethod(nextMethod);
          setActiveComponents(restoredComps);
          setPresetId('blank');
          setSimDefs(handoff.simDefs);
          setRfNodes(
            handoff.simDefs.map((d, idx) => ({
              id: d.id,
              type: 'flowUnit',
              position: handoff.positions?.[d.id] ?? { x: 80 + idx * 180, y: 120 },
              data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
            }))
          );
          setFlowEdges(handoff.flowEdges);
          setSolvedMeta({
            result: createIdleFlowsheetResult(handoff.simDefs, handoff.flowEdges, {
              propertyMethod: nextMethod,
              activeComponents: restoredComps,
            }),
            elapsedMs: 0,
            runCount: 0,
            lastRunTime: '클래식 UI에서 인계됨 (▶ RUN 대기)',
          });
          setIsSimDirty(true);
          setSelectedNodeId(handoff.simDefs[0]?.id ?? null);
          setHydrated(true);
          return () => {
            alive = false;
          };
        }
        const raw = localStorage.getItem(AUTO_SAVE_KEY);
        if (raw) {
          const parsed: SavedFlowsheetState = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.simDefs) && Array.isArray(parsed.flowEdges)) {
            savedNodeCount = parsed.simDefs.length;
            skipNextDirtyRef.current = true;
            const restoredMethod: SimPropertyMethod =
              parsed.propertyMethod === 'ENRTL' ||
              parsed.propertyMethod === 'NRTL' ||
              parsed.propertyMethod === 'PR' ||
              parsed.propertyMethod === 'SRK' ||
              parsed.propertyMethod === 'AUTO'
                ? parsed.propertyMethod
                : defaultModePropertyMethod;
            const baseComps =
              Array.isArray(parsed.activeComponents) && parsed.activeComponents.length > 0
                ? (parsed.activeComponents.filter(c => SIM_COMPS.includes(c)) as SimCompKey[])
                : getPlantDefaultComponents(workspaceMode);
            const restoredComps = mergeSheetFeedComponents(parsed.simDefs, baseComps);
            restoredSheetId = parsed.activeSheetId || 'master';
            setPropertyMethod(restoredMethod);
            setActiveComponents(restoredComps);
            setPresetId(parsed.presetId || defaultModePresetId);
            if (parsed.hierarchySheets && Object.keys(parsed.hierarchySheets).length > 0) {
              setHierarchySheets(parsed.hierarchySheets);
            }
            if (parsed.activeSheetId) {
              setActiveSheetId(parsed.activeSheetId);
            }
            if (typeof parsed.boundarySyncEnabled === 'boolean') {
              setBoundarySyncEnabled(parsed.boundarySyncEnabled);
            }
            setSimDefs(parsed.simDefs);
            setRfNodes(
              parsed.simDefs.map((d, idx) => ({
                id: d.id,
                type: 'flowUnit',
                position: parsed.positions?.[d.id] ?? { x: 80 + idx * 180, y: 120 },
                data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
              }))
            );
            setFlowEdges(parsed.flowEdges);

            const savedMetaCandidate =
              parsed.lastSolvedMeta?.result &&
              Array.isArray(parsed.lastSolvedMeta.result.streams) &&
              (!parsed.lastSolvedMeta.solvedSheetId || parsed.lastSolvedMeta.solvedSheetId === restoredSheetId)
                ? parsed.lastSolvedMeta
                : parsed.hierarchySheets?.[restoredSheetId]?.cachedSolvedMeta;

            if (savedMetaCandidate?.result && !savedMetaCandidate.result.convergence?.isIdle) {
              hadSavedSolved = true;
              setSolvedMeta({
                result: savedMetaCandidate.result,
                elapsedMs: savedMetaCandidate.elapsedMs ?? 1,
                runCount: Math.max(1, savedMetaCandidate.runCount ?? 1),
                lastRunTime: savedMetaCandidate.lastRunTime || parsed.savedAt || '저장본 복원',
              });
              setIsSimDirty(Boolean(parsed.isSimDirty));
            } else {
              setSolvedMeta({
                result: createIdleFlowsheetResult(parsed.simDefs, parsed.flowEdges, {
                  propertyMethod: restoredMethod,
                  activeComponents: restoredComps,
                }),
                elapsedMs: 0,
                runCount: 0,
                lastRunTime: '미실행 (▶ RUN 대기)',
              });
              setIsSimDirty(true);
            }
            setSelectedNodeId(
              parsed.simDefs.find(x => x.id === defaultSelectedNodeId)?.id ??
                parsed.simDefs[0]?.id ??
                null
            );
            setLastSavedTime(parsed.savedAt || '복원됨');
          }
        }
      }
      const rawProjects = localStorage.getItem(PROJECTS_SAVE_KEY);
      if (rawProjects) {
        const parsedProjs = JSON.parse(rawProjects);
        if (Array.isArray(parsedProjs)) {
          setNamedProjects(parsedProjs);
        }
      }
      const curTitle = getActiveCaseTitle();
      setActiveCaseName(curTitle && curTitle.plantId === workspacePlantId ? curTitle.title : null);
    } catch {
      // 파싱 실패 시 기본값 유지
    }
    setHydrated(true);

    // 19개 전 시트 사전 수렴 기본 케이스 비동기 로드 (UI 무블로킹)
    loadConvergedBaselines().then(bundle => {
      if (!alive || !bundle) return;
      convergedBaselinesRef.current = bundle;
      if (skipBaselineOverride) return;
      const pKey: 'electrolysis' | 'hcl1A' | 'ech' | 'cms' | 'mdi' | null = isHcl1AMode
        ? 'hcl1A'
        : isEchGteMode
          ? 'ech'
          : isCmsMode
            ? 'cms'
            : isMdiMode
              ? 'mdi'
              : isElectrolyzerMode
                ? 'electrolysis'
                : null;
      if (!pKey) return;
      const pBaselines = bundle.plants[pKey];
      if (!pBaselines) return;

      setHierarchySheets(prev => {
        let changed = false;
        const next: Record<string, SheetRuntimeData> = { ...prev };
        for (const [sid, sh] of Object.entries(prev)) {
          const bEntry = pBaselines[sid];
          if (
            bEntry &&
            (!sh.cachedSolvedMeta || sh.cachedSolvedMeta.result?.convergence?.isIdle) &&
            sh.simDefs.length === bEntry.simDefs.length
          ) {
            changed = true;
            next[sid] = {
              ...sh,
              simDefs: bEntry.simDefs.map(d => ({ ...d, params: { ...d.params } })),
              flowEdges: bEntry.flowEdges.map(e => ({ ...e })),
              cachedSolvedMeta: {
                result: bEntry.result,
                elapsedMs: bEntry.elapsedMs,
                lastRunTime: bEntry.lastRunTime,
                runCount: bEntry.runCount,
              },
            };
          }
        }
        return changed ? next : prev;
      });

      const activeEntry = pBaselines[restoredSheetId];
      if (!hadSavedSolved && activeEntry && savedNodeCount === activeEntry.simDefs.length) {
        skipNextDirtyRef.current = true;
        setSimDefs(activeEntry.simDefs.map(d => ({ ...d, params: { ...d.params } })));
        setFlowEdges(activeEntry.flowEdges.map(e => ({ ...e })));
        setSolvedMeta({
          result: activeEntry.result,
          elapsedMs: activeEntry.elapsedMs,
          runCount: activeEntry.runCount,
          lastRunTime: activeEntry.lastRunTime,
        });
        setIsSimDirty(false);
      }
    });

    return () => {
      alive = false;
    };
  }, [AUTO_SAVE_KEY, PROJECTS_SAVE_KEY, defaultModePresetId, defaultModePropertyMethod, defaultSelectedNodeId, initialSheets.master.simDefs.length, isCmsMode, isEchGteMode, isElectrolyzerMode, isHcl1AMode, isMdiMode, isPlantSimMode, workspaceMode, workspacePlantId]);

  // 상단 [내 케이스] 드롭다운 삭제·전환 시 현재 저장 목록 및 활성 케이스명 즉시 동기화
  useEffect(() => {
    const syncProjectsAndTitle = () => {
      try {
        const rawProjects = localStorage.getItem(PROJECTS_SAVE_KEY);
        if (rawProjects) {
          const parsedProjs = JSON.parse(rawProjects);
          if (Array.isArray(parsedProjs)) {
            setNamedProjects(parsedProjs);
          }
        } else {
          setNamedProjects([]);
        }
      } catch {
        // ignore
      }
      const curTitle = getActiveCaseTitle();
      setActiveCaseName(curTitle && curTitle.plantId === workspacePlantId ? curTitle.title : null);
    };
    window.addEventListener(PROJECTS_UPDATED_EVENT, syncProjectsAndTitle);
    return () => window.removeEventListener(PROJECTS_UPDATED_EVENT, syncProjectsAndTitle);
  }, [PROJECTS_SAVE_KEY, workspacePlantId]);

  const switchToClassicUi = useCallback(() => {
    const positions = extractCurrentPositions(rfNodes);
    saveUiSwitchHandoff({
      fromUi: 'modern',
      title: workspaceMode,
      simDefs,
      flowEdges,
      positions,
      activeComponents,
      thermoMethod: propertyMethod,
    });
    setPreferredSimUiMode('classic');
    setActivePlantId('classic_sim');
    router.push('/classic-simulator');
  }, [activeComponents, extractCurrentPositions, flowEdges, propertyMethod, rfNodes, router, setActivePlantId, simDefs, workspaceMode]);

  useEffect(() => {
    const onRequestUiSwitch = (ev: Event) => {
      const detail = (ev as CustomEvent<{ targetUi?: string }>).detail;
      if (detail?.targetUi === 'classic') {
        switchToClassicUi();
      }
    };
    window.addEventListener('chemplant:request-ui-switch', onRequestUiSwitch);
    return () => window.removeEventListener('chemplant:request-ui-switch', onRequestUiSwitch);
  }, [switchToClassicUi]);

  // ── 조건 변경 감지 (키 입력 시 솔버 실행 없이 0.1ms 내 '재실행 필요' 상태만 표시) ──
  useEffect(() => {
    if (!hydrated) return;
    if (skipNextDirtyRef.current) {
      skipNextDirtyRef.current = false;
      return;
    }
    setIsSimDirty(true);
  }, [hydrated, simDefs, flowEdges]);

  // ── 단축키 지원: F5 또는 Ctrl+Enter 입력 시 즉시 [▶ RUN 시뮬레이션 실행] ──
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'F5' || ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter')) {
        ev.preventDefault();
        runSimulationNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runSimulationNow]);

  // ── PLANT 02 / PLANT 03 모드: 좌측 Sidebar 공정 섹션 클릭 ↔ 현재 활성 시트 양방향 동기화 ──
  useEffect(() => {
    if (isPlantSimMode) {
      setSimActiveSheetId(activeSheetId);
    }
  }, [activeSheetId, isPlantSimMode, setSimActiveSheetId]);

  // ── PLANT 02: 좌측 사이드바 Capa 운전변수 변경 시 전해조·피드 시뮬레이션 실시간 동기화 ──
  const lastP2SyncRef = useRef<number>(plant02SyncSeq);
  useEffect(() => {
    if (!hydrated || !isElectrolyzerMode) return;
    if (plant02SyncSeq === lastP2SyncRef.current) return;
    lastP2SyncRef.current = plant02SyncSeq;

    const baseLoad = 5 * 190 * 16.2 * 0.94;
    const curLoad =
      plant02Inputs.numElectrolyzers *
      plant02Inputs.cellsPerElectrolyzer *
      plant02Inputs.operatingCurrentKA *
      plant02Inputs.currentEfficiency;
    const scale = Math.max(0.05, curLoad / baseLoad);

    const patchDefs = (defs: FlowNodeDef[]): FlowNodeDef[] =>
      defs.map(d => {
        if (d.unitType === 'electrolyzer') {
          return {
            ...d,
            params: {
              ...d.params,
              unitCount: plant02Inputs.numElectrolyzers,
              cellCount: plant02Inputs.cellsPerElectrolyzer,
              currentKA: plant02Inputs.operatingCurrentKA,
              currentEffPct: Number((plant02Inputs.currentEfficiency * 100).toFixed(2)),
              operTempC: plant02Inputs.electrolyzerTempC ?? 89.0,
            },
          };
        }
        if (d.id === 'fp_b110') {
          return {
            ...d,
            params: {
              ...d.params,
              targetBrineWtPct: plant02Inputs.brineFeedConcWt ?? 25.65,
            },
          };
        }
        if (d.id === 'fp_f_bw') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: emptySimFlows({ H2O: Math.round(45900 * scale) }),
            },
          };
        }
        if (d.id === 'fp_f_pw' || d.id === 'c2_in_pw') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: emptySimFlows({ H2O: Math.round(15525 * scale) }),
            },
          };
        }
        if (d.id === 'c2_in_brine') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: emptySimFlows({
                NaCl: Math.round(57493 * scale),
                H2O: Math.round(166651 * scale),
              }),
            },
          };
        }
        return d;
      });

    const nextActiveDefs = patchDefs(simDefs);
    setSimDefs(nextActiveDefs);
    setHierarchySheets(prev => {
      const next: Record<string, SheetRuntimeData> = {};
      for (const [k, sh] of Object.entries(prev)) {
        next[k] = {
          ...sh,
          simDefs: k === activeSheetId ? nextActiveDefs : patchDefs(sh.simDefs),
          cachedSolvedMeta: undefined,
        };
      }
      return next;
    });
    if (solvedMeta.result.convergence.isIdle) {
      setSolvedMeta({
        result: createIdleFlowsheetResult(nextActiveDefs, flowEdges, {
          propertyMethod,
          activeComponents,
        }),
        elapsedMs: 0,
        runCount: 0,
        lastRunTime: '미실행 (▶ RUN 대기)',
      });
    }
    setIsSimDirty(true);
  }, [
    activeComponents,
    activeSheetId,
    flowEdges,
    hydrated,
    isElectrolyzerMode,
    plant02Inputs,
    plant02SyncSeq,
    propertyMethod,
    simDefs,
    solvedMeta.result.convergence.isIdle,
  ]);

  // ── PLANT 03: 좌측 사이드바 1A Capa 운전변수 변경 시 합성·액화·PSD 시뮬레이션 실시간 동기화 ──
  const lastP3SyncRef = useRef<number>(plant03SyncSeq);
  useEffect(() => {
    if (!hydrated || !isHcl1AMode) return;
    if (plant03SyncSeq === lastP3SyncRef.current) return;
    lastP3SyncRef.current = plant03SyncSeq;

    const cl2KgH = Math.max(10, plant03Inputs.cl2FeedKgH);
    const o2ImpKgH = Number((cl2KgH * 0.00125).toFixed(2));
    const h2KgH = Number(
      ((cl2KgH / 70.906) * 2.016 * (1 + Math.max(0, plant03Inputs.h2ExcessPct) / 100)).toFixed(2)
    );
    const splitFrac = Number(
      Math.max(0.05, Math.min(0.92, plant03Inputs.ahclSplitPct / 100)).toFixed(3)
    );
    const synthHclKgH = 2 * (cl2KgH / 70.906) * 36.461 * 0.999998;
    const upwKgH = Number(
      Math.max(50, synthHclKgH * (1 - splitFrac) * 0.9995 * (0.65 / 0.35)).toFixed(1)
    );
    const spentKgH = Math.max(0, plant03Inputs.spentHclFeedKgH);
    const wSpent = Math.max(0.01, Math.min(0.30, plant03Inputs.spentHclConcWt / 100));

    const patchP3Defs = (defs: FlowNodeDef[]): FlowNodeDef[] =>
      defs.map(d => {
        if (d.id === 'h1a_f_cl2') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: emptySimFlows({ Cl2: Number(cl2KgH.toFixed(1)), O2: o2ImpKgH }),
            },
          };
        }
        if (d.id === 'h1a_f_h2') {
          return {
            ...d,
            params: { ...d.params, feedFlowsKgH: emptySimFlows({ H2: h2KgH }) },
          };
        }
        if (d.id === 's100_in_mix') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: emptySimFlows({
                Cl2: Number(cl2KgH.toFixed(1)),
                H2: h2KgH,
                O2: o2ImpKgH,
              }),
            },
          };
        }
        if (d.id === 'h1a_sp105' || d.id === 's100_sp') {
          return {
            ...d,
            params: { ...d.params, splitRatioTop: splitFrac },
          };
        }
        if (d.id === 'h1a_f_upw') {
          return {
            ...d,
            params: { ...d.params, feedFlowsKgH: emptySimFlows({ H2O: upwKgH }) },
          };
        }
        if (d.id === 'h1a_e225' || d.id === 's200_e225') {
          return {
            ...d,
            params: { ...d.params, operTempC: plant03Inputs.liquefierTempC },
          };
        }
        if (d.id === 'h1a_f_spent' || d.id === 's300_feed') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: emptySimFlows({
                HCl: Number((spentKgH * wSpent).toFixed(1)),
                H2O: Number((spentKgH * (1 - wSpent)).toFixed(1)),
              }),
            },
          };
        }
        if (d.id === 'h1a_c310' || d.id === 's300_c310') {
          return {
            ...d,
            params: {
              ...d.params,
              distillConfig: {
                ...(d.params.distillConfig ?? {}),
                topPressKgcm2g: plant03Inputs.vacColPressKg,
              },
            },
          };
        }
        return d;
      });

    const nextActiveDefs = patchP3Defs(simDefs);
    setSimDefs(nextActiveDefs);
    setHierarchySheets(prev => {
      const next: Record<string, SheetRuntimeData> = {};
      for (const [k, sh] of Object.entries(prev)) {
        next[k] = {
          ...sh,
          simDefs: k === activeSheetId ? nextActiveDefs : patchP3Defs(sh.simDefs),
          cachedSolvedMeta: undefined,
        };
      }
      return next;
    });
    if (solvedMeta.result.convergence.isIdle) {
      setSolvedMeta({
        result: createIdleFlowsheetResult(nextActiveDefs, flowEdges, {
          propertyMethod,
          activeComponents,
        }),
        elapsedMs: 0,
        runCount: 0,
        lastRunTime: '미실행 (▶ RUN 대기)',
      });
    }
    setIsSimDirty(true);
  }, [
    activeComponents,
    activeSheetId,
    flowEdges,
    hydrated,
    isHcl1AMode,
    plant03Inputs,
    plant03SyncSeq,
    propertyMethod,
    simDefs,
    solvedMeta.result.convergence.isIdle,
  ]);

  // Live sync: PLANT 04 CMS (Sidebar 운전조건 변경 -> R-101, C-201, FEED-LIQ-CL2/MC 동기화 후 활성 시트 재계산)
  const lastCmsSyncRef = useRef<number>(0);
  const cmsBaseK0Ref = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!hydrated || !isCmsMode) return;
    if (cmsPlantSyncSeq === lastCmsSyncRef.current) return;
    lastCmsSyncRef.current = cmsPlantSyncSeq;

    const cl2FeedKgH = Number(((Math.max(20, cmsPlantInputs.cl2FeedTonDay) * 1000) / 24).toFixed(2));
    const freshMcKgH = Number(cmsPlantSummary.freshMcKgH.toFixed(2));
    const totalMcKgH = Number((cmsPlantSummary.freshMcKgH + cmsPlantSummary.recycleMcKgH).toFixed(2));
    const aibnScale = Math.sqrt(Math.max(50, cmsPlantInputs.aibnDosagePpm) / 350);

    const patchCmsDefs = (defs: FlowNodeDef[]): FlowNodeDef[] =>
      defs.map(d => {
        if (d.id === 'cms_m_cl2' || d.id === 'cms1_cl2') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: { ...(d.params.feedFlowsKgH ?? {}), Cl2: cl2FeedKgH },
            },
          };
        }
        if (d.id === 'cms_m_mc' || d.id === 'cms1_mc') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                CH3Cl: d.id === 'cms1_mc' ? totalMcKgH : freshMcKgH,
              },
            },
          };
        }
        if (d.id === 'cms_m_r101' || d.id === 'cms1_r101') {
          const prevRxCfg = d.params.reactorConfig;
          const nextReactions = prevRxCfg?.reactions
            ? prevRxCfg.reactions.map((rx, idx) => {
                const k0Key = `${d.id}::${rx.id || idx}`;
                if (cmsBaseK0Ref.current[k0Key] == null) {
                  const initNode = Object.values(initialSheets)
                    .flatMap(s => s.simDefs)
                    .find(n => n.id === d.id);
                  const initRx =
                    initNode?.params.reactorConfig?.reactions?.find(r => r.id === rx.id) ??
                    initNode?.params.reactorConfig?.reactions?.[idx];
                  if (initRx?.k0Forward != null) {
                    cmsBaseK0Ref.current[k0Key] = initRx.k0Forward;
                  } else if (rx.k0Forward != null) {
                    cmsBaseK0Ref.current[k0Key] = rx.k0Forward;
                  }
                }
                const baseK0 = cmsBaseK0Ref.current[k0Key] ?? rx.k0Forward;
                return baseK0 != null
                  ? { ...rx, k0Forward: Number((baseK0 * aibnScale).toPrecision(6)) }
                  : rx;
              })
            : undefined;
          return {
            ...d,
            params: {
              ...d.params,
              operTempC: cmsPlantInputs.reactorTempC,
              operPressKgcm2g: cmsPlantInputs.reactorPressKgcm2g,
              ...(prevRxCfg
                ? {
                    reactorConfig: {
                      ...prevRxCfg,
                      operTempC: cmsPlantInputs.reactorTempC,
                      operPressKgcm2g: cmsPlantInputs.reactorPressKgcm2g,
                      ...(nextReactions ? { reactions: nextReactions } : {}),
                    },
                  }
                : {}),
            },
          };
        }
        if (d.id === 'cms_m_c201' || d.id === 'cms2_c201') {
          return {
            ...d,
            params: {
              ...d.params,
              operPressKgcm2g: cmsPlantInputs.hclStripperPressKg,
              ...(d.params.distillConfig
                ? {
                    distillConfig: {
                      ...d.params.distillConfig,
                      topPressKgcm2g: cmsPlantInputs.hclStripperPressKg,
                    },
                  }
                : {}),
            },
          };
        }
        return d;
      });

    const nextActiveDefs = patchCmsDefs(simDefs);
    setSimDefs(nextActiveDefs);
    setHierarchySheets(prev => {
      const next: typeof prev = {};
      for (const [sid, s] of Object.entries(prev)) {
        next[sid] = {
          ...s,
          simDefs: sid === activeSheetId ? nextActiveDefs : patchCmsDefs(s.simDefs),
          cachedSolvedMeta: undefined,
        };
      }
      return next;
    });
    setIsSimDirty(true);
    runSimulationNow(nextActiveDefs, flowEdges, propertyMethod, activeComponents);
  }, [
    activeComponents,
    activeSheetId,
    cmsPlantInputs,
    cmsPlantSummary.freshMcKgH,
    cmsPlantSummary.recycleMcKgH,
    cmsPlantSyncSeq,
    flowEdges,
    hydrated,
    initialSheets,
    isCmsMode,
    propertyMethod,
    simDefs,
  ]);

  // Live sync: PLANT 05 MDI (Sidebar 운전조건 변경 -> 원료 Feed, C-302, C-401 동기화 후 활성 시트 재계산)
  const lastMdiSyncRef = useRef<number>(0);
  useEffect(() => {
    if (!hydrated || !isMdiMode) return;
    if (mdiPlantSyncSeq === lastMdiSyncRef.current) return;
    lastMdiSyncRef.current = mdiPlantSyncSeq;

    const capScale = Math.max(20, mdiPlantInputs.annualCapacityKta) / 100.0;
    const pureShareFrac = Math.max(0.15, Math.min(0.65, mdiPlantInputs.pureMdiSharePct / 100));
    const anilRatioScale = Math.max(0.5, mdiPlantInputs.anilineToHchoRatio / 3.2);
    const phosScale = Math.max(0.5, (1 + mdiPlantInputs.phosgeneExcessPct / 100) / 2.0);
    const mcbScale = Math.max(0.5, mdiPlantInputs.mcbSolventRatio / 2.5);
    const vacTopKgcm2g = Math.max(
      -0.99,
      Math.min(-0.8, Number((mdiPlantInputs.vacColTopMbar / 1000 - 1.01325).toFixed(3)))
    );

    const patchMdiDefs = (defs: FlowNodeDef[]): FlowNodeDef[] =>
      defs.map(d => {
        if (d.id === 'mdi_f_anil' || d.id === 'mdi1_anil') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                Aniline: Number((mdiPlantSummary.anilineFreshKgH * (0.98 + 0.03 * anilRatioScale)).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_f_hcho' || d.id === 'mdi1_hcho') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                HCHO: Number((mdiPlantSummary.formalin37KgH * 0.37).toFixed(1)),
                H2O: Number((mdiPlantSummary.formalin37KgH * 0.63).toFixed(1)),
                HCl: Number((1200.0 * capScale).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_f_naoh' || d.id === 'mdi1_naoh') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                NaOH: Number((1316.4 * capScale).toFixed(1)),
                H2O: Number((3071.6 * capScale).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_f_co' || d.id === 'mdi2_co') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                CO: Number((mdiPlantSummary.coFreshKgH * phosScale).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_f_cl2' || d.id === 'mdi2_cl2') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                Cl2: Number((mdiPlantSummary.cl2FreshKgH * phosScale).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_f_mcb_mu') {
          return {
            ...d,
            params: {
              ...d.params,
              feedFlowsKgH: {
                ...(d.params.feedFlowsKgH ?? {}),
                MCB: Number((1100.0 * capScale * mcbScale).toFixed(1)),
              },
            },
          };
        }
        if ((d.id === 'mdi_c302' || d.id === 'mdi3_c302') && d.params.distillConfig?.splitSpecType === 'bottoms_kgh') {
          return {
            ...d,
            params: {
              ...d.params,
              distillConfig: {
                ...d.params.distillConfig,
                splitSpecValue: Number((12320.0 * capScale).toFixed(1)),
              },
            },
          };
        }
        if (d.id === 'mdi_c401' || d.id === 'mdi4_c401') {
          return {
            ...d,
            params: {
              ...d.params,
              operPressKgcm2g: vacTopKgcm2g,
              ...(d.params.distillConfig
                ? {
                    distillConfig: {
                      ...d.params.distillConfig,
                      topPressKgcm2g: vacTopKgcm2g,
                      ...(d.params.distillConfig.splitSpecType === 'd_over_f_mass'
                        ? { splitSpecValue: Number(pureShareFrac.toFixed(3)) }
                        : {}),
                    },
                  }
                : {}),
            },
          };
        }
        return d;
      });

    const nextActiveDefs = patchMdiDefs(simDefs);
    setSimDefs(nextActiveDefs);
    setHierarchySheets(prev => {
      const next: typeof prev = {};
      for (const [sid, s] of Object.entries(prev)) {
        next[sid] = {
          ...s,
          simDefs: sid === activeSheetId ? nextActiveDefs : patchMdiDefs(s.simDefs),
          cachedSolvedMeta: undefined,
        };
      }
      return next;
    });
    setIsSimDirty(true);
    runSimulationNow(nextActiveDefs, flowEdges, propertyMethod, activeComponents);
  }, [
    activeComponents,
    activeSheetId,
    flowEdges,
    hydrated,
    isMdiMode,
    mdiPlantInputs,
    mdiPlantSummary,
    mdiPlantSyncSeq,
    propertyMethod,
    simDefs,
  ]);

  const lastHandledReqSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!hydrated || !isPlantSimMode || !simRequestedSheetId) return;
    if (simRequestedSheetId.seq === lastHandledReqSeqRef.current) return;
    lastHandledReqSeqRef.current = simRequestedSheetId.seq;
    if (simRequestedSheetId.sheetId !== activeSheetId && hierarchySheets[simRequestedSheetId.sheetId]) {
      navigateToHierarchySheet(simRequestedSheetId.sheetId);
    }
  }, [activeSheetId, hierarchySheets, hydrated, isPlantSimMode, navigateToHierarchySheet, simRequestedSheetId]);

  // ── 장치목록 / 상세설계 허브에서 특정 장치 포커스 또는 내장 상세설계 워크벤치 직행 연동 ──
  const lastHandledNodeActionSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!hydrated || !simRequestedNodeAction) return;
    if (simRequestedNodeAction.seq === lastHandledNodeActionSeqRef.current) return;

    if (
      simRequestedNodeAction.sheetId &&
      simRequestedNodeAction.sheetId !== activeSheetId &&
      hierarchySheets[simRequestedNodeAction.sheetId]
    ) {
      navigateToHierarchySheet(simRequestedNodeAction.sheetId);
      return;
    }

    lastHandledNodeActionSeqRef.current = simRequestedNodeAction.seq;
    const keyUp = simRequestedNodeAction.nodeIdOrTag.toUpperCase();
    const targetDef = simDefs.find(
      d => d.id === simRequestedNodeAction.nodeIdOrTag || d.tag.toUpperCase() === keyUp
    );
    if (targetDef) {
      setSelectedNodeId(targetDef.id);
      setSelectedEdgeId(null);
      setInspectorOpen(true);
      window.setTimeout(() => {
        try {
          rfInstance?.fitView({
            nodes: [{ id: targetDef.id }],
            padding: 0.65,
            maxZoom: 1.15,
            duration: 240,
          });
        } catch {
          // ignore fitView before viewport ready
        }
      }, 80);

      if (simRequestedNodeAction.openWorkbench) {
        if (targetDef.unitType === 'distillation') {
          setDistillModalInitialView(
            simRequestedNodeAction.workbenchView === 'internals' ? 'internals' : 'simulation'
          );
          setDistillModalNodeId(targetDef.id);
        } else if (
          targetDef.unitType === 'hex' ||
          targetDef.unitType === 'cooler' ||
          targetDef.unitType === 'liquefier'
        ) {
          setHxModalInitialView(
            simRequestedNodeAction.workbenchView === 'mechanical' ? 'mechanical' : 'thermal'
          );
          setHxModalNodeId(targetDef.id);
        }
      }
    }
    clearSimNodeAction();
  }, [
    activeSheetId,
    clearSimNodeAction,
    hierarchySheets,
    hydrated,
    navigateToHierarchySheet,
    rfInstance,
    simDefs,
    simRequestedNodeAction,
  ]);

  const isMultiSheetMode =
    isPlantSimMode ||
    presetId === 'full_electrolyzer_plant' ||
    presetId === 'full_hcl_1a_plant' ||
    presetId === 'full_ech_gte_plant' ||
    presetId === 'full_cms_plant' ||
    presetId === 'full_mdi_plant' ||
    Object.keys(hierarchySheets).length > 1;

  // ── 2) 노드·배관·속성·계층시트 변경 시 450ms 디바운스 저장 + 탭 전환/언마운트 시 즉시 플러시 ──
  const flushSaveRef = useRef<(() => void) | null>(null);
  const pendingSaveRef = useRef<boolean>(false);

  useEffect(() => {
    if (!hydrated) return;
    const performSave = () => {
      const positions = extractCurrentPositions(rfNodes);
      const activeCached =
        !isSimDirty && !solvedMeta.result.convergence.isIdle
          ? {
              result: solvedMeta.result,
              elapsedMs: solvedMeta.elapsedMs,
              lastRunTime: solvedMeta.lastRunTime,
              runCount: solvedMeta.runCount,
            }
          : hierarchySheets[activeSheetId]?.cachedSolvedMeta;
      const syncedSheets: Record<string, SheetRuntimeData> | undefined = isMultiSheetMode
        ? {
            ...hierarchySheets,
            [activeSheetId]: {
              ...(hierarchySheets[activeSheetId] ?? initialSheets.master),
              simDefs,
              positions,
              flowEdges,
              cachedSolvedMeta: activeCached,
            },
          }
        : hierarchySheets;
      const nowStr = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      const payload: SavedFlowsheetState = {
        version: 5,
        savedAt: nowStr,
        presetId,
        simDefs,
        positions,
        flowEdges,
        hierarchySheets: syncedSheets,
        activeSheetId,
        boundarySyncEnabled,
        activeComponents,
        propertyMethod,
        isSimDirty,
        lastSolvedMeta: !solvedMeta.result.convergence.isIdle
          ? {
              result: solvedMeta.result,
              elapsedMs: solvedMeta.elapsedMs,
              runCount: solvedMeta.runCount,
              lastRunTime: solvedMeta.lastRunTime,
              solvedSheetId: activeSheetId,
            }
          : undefined,
      };
      try {
        localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(payload));
        pendingSaveRef.current = false;
      } catch {
        // localStorage 용량 부족 시 수렴 캐시를 제외한 순수 도면·파라미터만 안전 저장
        try {
          const slimSheets: Record<string, SheetRuntimeData> | undefined = syncedSheets
            ? Object.fromEntries(
                Object.entries(syncedSheets).map(([k, v]) => [k, { ...v, cachedSolvedMeta: undefined }])
              )
            : undefined;
          const slimPayload: SavedFlowsheetState = {
            ...payload,
            hierarchySheets: slimSheets,
            lastSolvedMeta: undefined,
          };
          localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(slimPayload));
          pendingSaveRef.current = false;
        } catch {
          // 용량 초과 예외 무시
        }
      }
    };

    flushSaveRef.current = performSave;
    pendingSaveRef.current = true;

    const timer = window.setTimeout(() => {
      performSave();
      setLastSavedTime(new Date().toLocaleTimeString('ko-KR', { hour12: false }));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    hydrated,
    isMultiSheetMode,
    presetId,
    simDefs,
    rfNodes,
    flowEdges,
    hierarchySheets,
    activeSheetId,
    boundarySyncEnabled,
    activeComponents,
    propertyMethod,
    isSimDirty,
    solvedMeta,
    extractCurrentPositions,
    initialSheets.master,
    AUTO_SAVE_KEY,
  ]);

  useEffect(() => {
    return () => {
      if (pendingSaveRef.current && flushSaveRef.current) {
        flushSaveRef.current();
      }
    };
  }, []);

  // ── 케이스 이름 지정 저장 / 덮어쓰기 / JSON 내보내기 ──
  const buildCurrentSavedState = (nowStr: string): SavedFlowsheetState => {
    const positions = extractCurrentPositions(rfNodes);
    const activeCached =
      !isSimDirty && !solvedMeta.result.convergence.isIdle
        ? {
            result: solvedMeta.result,
            elapsedMs: solvedMeta.elapsedMs,
            lastRunTime: solvedMeta.lastRunTime,
            runCount: solvedMeta.runCount,
          }
        : hierarchySheets[activeSheetId]?.cachedSolvedMeta;
    const syncedSheets = isMultiSheetMode
      ? {
          ...hierarchySheets,
          [activeSheetId]: {
            ...(hierarchySheets[activeSheetId] ?? initialSheets.master),
            simDefs,
            positions,
            flowEdges,
            cachedSolvedMeta: activeCached,
          },
        }
      : hierarchySheets;
    return {
      version: 5,
      savedAt: nowStr,
      presetId,
      simDefs,
      positions,
      flowEdges,
      hierarchySheets: syncedSheets,
      activeSheetId,
      boundarySyncEnabled,
      activeComponents,
      propertyMethod,
      isSimDirty,
      lastSolvedMeta:
        !solvedMeta.result.convergence.isIdle
          ? {
              result: solvedMeta.result,
              elapsedMs: solvedMeta.elapsedMs,
              runCount: solvedMeta.runCount,
              lastRunTime: solvedMeta.lastRunTime,
              solvedSheetId: activeSheetId,
            }
          : undefined,
    };
  };

  const saveNamedProject = () => {
    const trimmed = projectNameInput.trim() || `시뮬레이션_${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
    const nowStr = new Date().toLocaleString('ko-KR', { hour12: false });
    const item: NamedProjectItem = {
      id: `proj_${Date.now()}`,
      name: trimmed,
      savedAt: nowStr,
      nodeCount: simDefs.length,
      edgeCount: flowEdges.length,
      state: buildCurrentSavedState(nowStr),
    };
    const next = [item, ...namedProjects];
    setNamedProjects(next);
    setProjectNameInput('');
    try {
      localStorage.setItem(PROJECTS_SAVE_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
    setActiveCaseTitle(item.name, workspacePlantId);
    setActiveCaseName(item.name);
    notifyProjectsUpdated();
    setShowStorageBar(false);
  };

  const overwriteNamedProject = (projId: string) => {
    const nowStr = new Date().toLocaleString('ko-KR', { hour12: false });
    const targetProj = namedProjects.find(p => p.id === projId);
    const next = namedProjects.map(p =>
      p.id === projId
        ? {
            ...p,
            savedAt: nowStr,
            nodeCount: simDefs.length,
            edgeCount: flowEdges.length,
            state: buildCurrentSavedState(nowStr),
          }
        : p
    );
    setNamedProjects(next);
    try {
      localStorage.setItem(PROJECTS_SAVE_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
    if (targetProj) {
      setActiveCaseTitle(targetProj.name, workspacePlantId);
      setActiveCaseName(targetProj.name);
    }
    notifyProjectsUpdated();
    setShowStorageBar(false);
  };

  const loadFromStateObject = (st: SavedFlowsheetState) => {
    skipNextDirtyRef.current = true;
    const nextMethod: SimPropertyMethod =
      st.propertyMethod === 'ENRTL' ||
      st.propertyMethod === 'NRTL' ||
      st.propertyMethod === 'PR' ||
      st.propertyMethod === 'SRK' ||
      st.propertyMethod === 'AUTO'
        ? st.propertyMethod
        : propertyMethod;
    const baseComps =
      Array.isArray(st.activeComponents) && st.activeComponents.length > 0
        ? (st.activeComponents.filter(c => SIM_COMPS.includes(c)) as SimCompKey[])
        : activeComponents;
    const nextComps = mergeSheetFeedComponents(st.simDefs, baseComps);
    setPropertyMethod(nextMethod);
    setActiveComponents(nextComps);
    setPresetId(st.presetId || 'custom');
    if (st.hierarchySheets && Object.keys(st.hierarchySheets).length > 0) {
      setHierarchySheets(st.hierarchySheets);
    } else if (!isPlantSimMode) {
      setHierarchySheets({
        master: {
          ...initialSheets.master,
          simDefs: st.simDefs,
          positions: st.positions ?? {},
          flowEdges: st.flowEdges,
        },
      });
    }
    setActiveSheetId(st.activeSheetId || 'master');
    if (typeof st.boundarySyncEnabled === 'boolean') {
      setBoundarySyncEnabled(st.boundarySyncEnabled);
    }
    setBoundarySyncBanner([]);
    setSimDefs(st.simDefs);
    setRfNodes(
      st.simDefs.map((d, idx) => ({
        id: d.id,
        type: 'flowUnit',
        position: st.positions?.[d.id] ?? { x: 80 + idx * 180, y: 120 },
        data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
      }))
    );
    setFlowEdges(st.flowEdges);
    const targetId = st.activeSheetId || 'master';
    const candidate =
      st.lastSolvedMeta?.result &&
      Array.isArray(st.lastSolvedMeta.result.streams) &&
      (!st.lastSolvedMeta.solvedSheetId || st.lastSolvedMeta.solvedSheetId === targetId)
        ? st.lastSolvedMeta
        : st.hierarchySheets?.[targetId]?.cachedSolvedMeta;
    if (candidate?.result && !candidate.result.convergence?.isIdle) {
      setSolvedMeta({
        result: candidate.result,
        elapsedMs: candidate.elapsedMs ?? 1,
        runCount: Math.max(1, candidate.runCount ?? 1),
        lastRunTime: candidate.lastRunTime || st.savedAt || '저장본 복원',
      });
      setIsSimDirty(Boolean(st.isSimDirty));
    } else {
      setSolvedMeta({
        result: createIdleFlowsheetResult(st.simDefs, st.flowEdges, {
          propertyMethod: nextMethod,
          activeComponents: nextComps,
        }),
        elapsedMs: 0,
        runCount: 0,
        lastRunTime: '미실행 (▶ RUN 대기)',
      });
      setIsSimDirty(true);
    }
    setSelectedNodeId(st.simDefs[0]?.id ?? null);
    setSelectedEdgeId(null);
  };

  const exportJsonFile = () => {
    const payload = buildCurrentSavedState(new Date().toISOString());
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ChemPlant_FullPackage_${new Date().toISOString().slice(0, 10)}.json`;
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
          text: `"${file.name}" 파일에서 가져올 수 있는 공정 장치 블록을 찾지 못했습니다.`,
          warnings: res.warnings,
        });
        return;
      }

      skipNextDirtyRef.current = true;
      const nextMethod: SimPropertyMethod =
        res.propertyMethod === 'ENRTL' ||
        res.propertyMethod === 'NRTL' ||
        res.propertyMethod === 'PR' ||
        res.propertyMethod === 'SRK' ||
        res.propertyMethod === 'AUTO'
          ? res.propertyMethod
          : propertyMethod;

      const baseComps =
        Array.isArray(res.activeComponents) && res.activeComponents.length > 0
          ? (res.activeComponents.filter(c => SIM_COMPS.includes(c)) as SimCompKey[])
          : activeComponents;
      const nextComps = mergeSheetFeedComponents(importedDefs, baseComps);

      const posMap = new Map<string, { x: number; y: number }>();
      (res.rfNodes ?? []).forEach(n => {
        if (n?.id && n.position) {
          posMap.set(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) });
        }
      });

      const nextPositions: Record<string, { x: number; y: number }> = {};
      const nextRfNodes: Node<FlowCanvasNodeData>[] = importedDefs.map((d, idx) => {
        const pos = posMap.get(d.id) ?? { x: 80 + idx * 180, y: 120 };
        nextPositions[d.id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
        return {
          id: d.id,
          type: 'flowUnit',
          position: { x: Math.round(pos.x), y: Math.round(pos.y) },
          data: { tag: d.tag, name: d.name, unitType: d.unitType, liveSummary: '' },
        };
      });

      const importedTitle =
        (res.title || file.name.replace(/\.(bkp|inp|txt)$/i, '') || 'imported_case').trim();

      setPropertyMethod(nextMethod);
      setActiveComponents(nextComps);
      setPresetId('custom');
      setActiveSheetId('master');
      setHierarchySheets(prev => ({
        ...prev,
        master: {
          ...(prev.master ?? initialSheets.master),
          simDefs: importedDefs,
          positions: nextPositions,
          flowEdges: res.edges,
          cachedSolvedMeta: undefined,
        },
      }));
      setBoundarySyncBanner([]);
      setSimDefs(importedDefs);
      setRfNodes(nextRfNodes);
      setFlowEdges(res.edges);
      setSolvedMeta({
        result: createIdleFlowsheetResult(importedDefs, res.edges, {
          propertyMethod: nextMethod,
          activeComponents: nextComps,
        }),
        elapsedMs: 0,
        runCount: 0,
        lastRunTime: '미실행 (▶ RUN 대기)',
      });
      setIsSimDirty(true);
      setSelectedNodeId(res.defs[0]?.id ?? null);
      setSelectedEdgeId(null);
      setActiveCaseTitle(importedTitle, workspacePlantId);
      setActiveCaseName(importedTitle);
      setProjectNameInput(importedTitle);

      const unmapped = res.summary?.unmappedComps ?? [];
      const unmappedSuffix =
        unmapped.length > 0
          ? ` · 미매핑 성분 ${unmapped.length}종(${unmapped.slice(0, 6).join(', ')}${unmapped.length > 6 ? ' 외' : ''})`
          : '';
      setInteropNotice({
        kind: 'success',
        text: `"${importedTitle}" 가져오기 완료 — 장치 ${res.summary?.unitCount ?? res.defs.length}개 · 스트림 ${res.summary?.edgeCount ?? res.edges.length}개 · 성분 ${res.summary?.mappedCompCount ?? nextComps.length}종${unmappedSuffix}`,
        warnings: res.warnings && res.warnings.length > 0 ? res.warnings : undefined,
      });
      setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 240 }), 80);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '알 수 없는 오류';
      setInteropNotice({
        kind: 'error',
        text: `공정 텍스트 파일 가져오기 실패: ${errMsg}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleExportProcessText = () => {
    try {
      const rawTitle = (activeCaseName || projectNameInput || 'chemplant_case').trim();
      const inpText = exportProcessTextFile({
        title: rawTitle,
        defs: simDefs,
        edges: flowEdges,
        activeComponents,
        propertyMethod,
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
        text: `"${safeName}.inp" 공정 텍스트 파일 내보내기 완료 (장치 ${simDefs.length}개 · 스트림 ${flowEdges.length}개)`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '알 수 없는 오류';
      setInteropNotice({
        kind: 'error',
        text: `공정 텍스트 파일 내보내기 실패: ${errMsg}`,
      });
    }
  };

  // 단위 예제 프리셋 로드
  const loadPreset = (p: PresetScenario) => {
    const nextDefs = p.nodes.map(({ position: _pos, ...def }) => ({ ...def, params: { ...def.params } }));
    const nextEdges = p.edges.map(e => ({ ...e }));
    const nextPositions: Record<string, { x: number; y: number }> = {};
    p.nodes.forEach(n => {
      nextPositions[n.id] = { ...n.position };
    });
    const presetPlantBase =
      p.group === 'plant02'
        ? getPlantDefaultComponents('electrolyzer_plant')
        : p.group === 'plant03'
          ? getPlantDefaultComponents('hcl_1a_plant')
          : p.group === 'plant04'
            ? getPlantDefaultComponents('ech_gte_plant')
            : p.group === 'plant05'
              ? getPlantDefaultComponents('cms_plant')
              : p.group === 'plant06'
                ? getPlantDefaultComponents('mdi_plant')
                : activeComponents;
    const nextComps = mergeSheetFeedComponents(nextDefs, presetPlantBase);
    const nextMethod: SimPropertyMethod =
      p.group === 'plant05'
        ? 'PR'
        : p.group === 'plant06'
          ? 'NRTL'
          : propertyMethod === 'PR' && (p.group === 'plant02' || p.group === 'plant03' || p.group === 'plant04')
            ? 'AUTO'
            : propertyMethod;

    const bKey: 'electrolysis' | 'hcl1A' | 'ech' | 'cms' | 'mdi' | null =
      p.group === 'plant02'
        ? 'electrolysis'
        : p.group === 'plant03'
          ? 'hcl1A'
          : p.group === 'plant04'
            ? 'ech'
            : p.group === 'plant05'
              ? 'cms'
              : p.group === 'plant06'
                ? 'mdi'
                : null;
    const bSheetId = bKey ? p.id.replace(/^plant0[23456]_/, '') : '';
    const cachedEntry = bKey ? convergedBaselinesRef.current?.plants[bKey]?.[bSheetId] : undefined;

    skipNextDirtyRef.current = true;
    setActiveComponents(nextComps);
    if (nextMethod !== propertyMethod) setPropertyMethod(nextMethod);
    setPresetId(p.id);
    setActiveSheetId('master');
    setHierarchySheets({
      master: {
        id: 'master',
        sectionCode: 'PRESET',
        shortTabLabel: p.btnLabel,
        title: p.title,
        subtitle: '단위공정 프리셋',
        parentMasterNodeIds: [],
        simDefs: cachedEntry ? cachedEntry.simDefs.map(d => ({ ...d, params: { ...d.params } })) : nextDefs,
        positions: nextPositions,
        flowEdges: cachedEntry ? cachedEntry.flowEdges.map(e => ({ ...e })) : nextEdges,
        cachedSolvedMeta: cachedEntry
          ? {
              result: cachedEntry.result,
              elapsedMs: cachedEntry.elapsedMs,
              lastRunTime: cachedEntry.lastRunTime,
              runCount: cachedEntry.runCount,
            }
          : undefined,
      },
    });
    setBoundarySyncBanner([]);
    setSimDefs(cachedEntry ? cachedEntry.simDefs.map(d => ({ ...d, params: { ...d.params } })) : nextDefs);
    setRfNodes(
      p.nodes.map(n => ({
        id: n.id,
        type: 'flowUnit',
        position: { ...n.position },
        data: { tag: n.tag, name: n.name, unitType: n.unitType, liveSummary: '' },
      }))
    );
    setFlowEdges(cachedEntry ? cachedEntry.flowEdges.map(e => ({ ...e })) : nextEdges);
    if (cachedEntry) {
      setSolvedMeta({
        result: cachedEntry.result,
        elapsedMs: cachedEntry.elapsedMs,
        runCount: cachedEntry.runCount,
        lastRunTime: cachedEntry.lastRunTime,
      });
      setIsSimDirty(false);
    } else {
      setSolvedMeta({
        result: createIdleFlowsheetResult(nextDefs, nextEdges, {
          propertyMethod: nextMethod,
          activeComponents: nextComps,
        }),
        elapsedMs: 0,
        runCount: 0,
        lastRunTime: '미실행 (▶ RUN 대기)',
      });
      setIsSimDirty(true);
      if (bKey) {
        loadConvergedBaselines().then(bundle => {
          if (!bundle) return;
          convergedBaselinesRef.current = bundle;
          const lateEntry = bundle.plants[bKey]?.[bSheetId];
          if (!lateEntry) return;
          skipNextDirtyRef.current = true;
          setSimDefs(lateEntry.simDefs.map(d => ({ ...d, params: { ...d.params } })));
          setFlowEdges(lateEntry.flowEdges.map(e => ({ ...e })));
          setSolvedMeta({
            result: lateEntry.result,
            elapsedMs: lateEntry.elapsedMs,
            runCount: lateEntry.runCount,
            lastRunTime: lateEntry.lastRunTime,
          });
          setIsSimDirty(false);
        });
      }
    }
    setSelectedNodeId(p.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    setActiveCaseTitle(null, workspacePlantId);
    setTimeout(() => rfInstance?.fitView({ padding: 0.16, duration: 240 }), 60);
  };

  const clearCanvas = () => {
    skipNextDirtyRef.current = true;
    setPresetId('blank');
    setBoundarySyncBanner([]);
    if (!isPlantSimMode) {
      setHierarchySheets({
        master: {
          ...initialSheets.master,
          simDefs: [],
          positions: {},
          flowEdges: [],
        },
      });
      setActiveSheetId('master');
    }
    if (simDefs.length > 0 || flowEdges.length > 0) {
      pushUndoSnapshot();
    }
    setSimDefs([]);
    setRfNodes([]);
    setFlowEdges([]);
    setSolvedMeta({
      result: createIdleFlowsheetResult([], []),
      elapsedMs: 0,
      runCount: 0,
      lastRunTime: '미실행 (▶ RUN 대기)',
    });
    setIsSimDirty(true);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setActiveCaseTitle(null, workspacePlantId);
  };

  // ── 명시적 [▶ RUN] 수렴 스냅샷 결과 ─────────────────────────
  const solved = solvedMeta.result;

  const unitResultMap = useMemo(() => {
    const m = new Map<string, (typeof solved.units)[number]>();
    solved.units.forEach(u => m.set(u.nodeId, u));
    return m;
  }, [solved]);

  const streamResultMap = useMemo(() => {
    const m = new Map<string, (typeof solved.streams)[number]>();
    solved.streams.forEach(s => m.set(s.edgeId, s));
    return m;
  }, [solved]);

  // 노드 라이브 요약 주입
  const displayNodes: Node<FlowCanvasNodeData>[] = useMemo(() => {
    return rfNodes.map(n => {
      const def = simDefs.find(d => d.id === n.id);
      const uRes = unitResultMap.get(n.id);
      let summary = '';
      if (def && uRes) {
        if (isVisualOnlyUnit(def.unitType)) {
          summary = uRes.inletMassKgH > 0 ? `통과 ${uRes.inletMassKgH.toFixed(0)} kg/h` : '도면 표기';
        } else if (def.unitType === 'feed') {
          const fSum = Object.values(def.params.feedFlowsKgH ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
          summary = `${fSum.toFixed(0)} kg/h · ${def.params.feedTempC ?? 25}°C`;
        } else if (def.unitType === 'product') {
          summary = `${uRes.inletMassKgH.toFixed(0)} kg/h`;
        } else if (def.unitType === 'saturator') {
          summary = `${def.params.targetBrineWtPct ?? 25.6} wt% · ${uRes.outletMassKgH.toFixed(0)} kg/h`;
        } else if (def.unitType === 'chelate_tower') {
          summary = `Ca+Mg <20ppb · ${uRes.outletMassKgH.toFixed(0)} kg/h`;
        } else if (def.unitType === 'desiccant_dryer') {
          summary = `노점 ${def.params.targetDewPointC ?? -60}°C · 건조H₂`;
        } else if (def.unitType === 'electrolyzer') {
          summary = `${def.params.currentKA ?? 16.2}kA · ${(Math.abs(uRes.heatDutyKcalH) / 1000).toFixed(0)}Mcal/h`;
        } else if (def.unitType === 'liquefier') {
          summary =
            uRes.condensedOrRemovedKgH > 0
              ? `액화 ${uRes.condensedOrRemovedKgH.toFixed(0)} kg/h (${def.params.operTempC ?? -22}°C)`
              : `미액화 (${def.params.operTempC ?? -22}°C)`;
        } else if (def.unitType === 'hex' || def.unitType === 'cooler') {
          summary = `Q=${(uRes.heatDutyKcalH / 1000).toFixed(0)} Mcal/h`;
        } else if (def.unitType === 'absorber') {
          const ppmTxt = uRes.extraMetrics?.['건조 Cl₂ 출구 수분'];
          summary = ppmTxt ? `출구수분 ${ppmTxt}` : `제거 ${uRes.condensedOrRemovedKgH.toFixed(1)} kg/h`;
        } else if (def.unitType === 'separator') {
          summary = `액분리 ${uRes.condensedOrRemovedKgH.toFixed(0)} kg/h`;
        } else if (def.unitType === 'distillation') {
          const dr = uRes.distillResult;
          const nSt = dr?.totalStagesUsed ?? def.params.distillConfig?.totalStages ?? 24;
          if (dr && uRes.inletMassKgH > 0.01) {
            const dKg = SIM_COMPS.reduce((s, k) => s + (dr.distillateFlowsKgH[k] || 0), 0);
            const bKg = SIM_COMPS.reduce((s, k) => s + (dr.bottomsFlowsKgH[k] || 0), 0);
            summary = `${nSt}단 · RR=${dr.actualRefluxRatio.toFixed(1)} · D:${dKg.toFixed(0)}/B:${bKg.toFixed(0)}`;
          } else {
            summary = `${nSt}단 정밀증류`;
          }
        } else if (def.unitType === 'compressor') {
          summary = `${def.params.outletPressKgcm2g ?? 3.5}kG · ${uRes.shaftPowerKW.toFixed(1)}kW`;
        } else if (def.unitType === 'pump') {
          summary = `${uRes.shaftPowerKW.toFixed(1)} kW`;
        } else if (def.unitType === 'evaporator') {
          summary = `${def.params.evapTargetConcWt ?? 50}% 농축 · 증발 ${uRes.condensedOrRemovedKgH.toFixed(0)}kg/h`;
        } else {
          summary = `${uRes.outletMassKgH.toFixed(0)} kg/h`;
        }
      }
      const dr = uRes?.distillResult;
      const hasDistillErr = Boolean(
        dr &&
          (!dr.converged ||
            (dr.shortcutDesign && !dr.shortcutDesign.designMet) ||
            (dr.spec1Status?.enabled && !dr.spec1Status.met) ||
            (dr.spec2Status?.enabled && !dr.spec2Status.met))
      );
      const hasMassErr = Boolean(uRes && !uRes.isVisualOnly && Math.abs(uRes.massImbalanceKgH) > 1.0);
      const hasFlow = Boolean(uRes && !uRes.isVisualOnly && (uRes.inletMassKgH > 0.01 || uRes.outletMassKgH > 0.01));
      const simStatus: 'converged' | 'error' | 'idle' =
        hasMassErr || hasDistillErr ? 'error' : hasFlow ? 'converged' : 'idle';
      const simStatusMsg =
        hasMassErr
          ? `수지 오차 (${uRes!.massImbalanceKgH.toFixed(1)} kg/h)`
          : hasDistillErr
            ? '증류탑 미수렴 또는 목표 스펙 미달'
            : hasFlow
              ? '수렴 완료'
              : '연결 대기';

      const allowSubSheet = isPlantSimMode || Object.keys(hierarchySheets).length > 1;
      const resolvedType = def?.unitType ?? n.data.unitType;
      return {
        ...n,
        selected: n.selected !== undefined ? n.selected : n.id === selectedNodeId,
        data: {
          tag: formatEquipmentTag(def?.tag ?? n.data.tag, resolvedType, tagStandard),
          name: def?.name ?? n.data.name,
          unitType: resolvedType,
          calcMode: def?.params.calcMode ?? 'simple',
          liveSummary: summary,
          detectedFluid: uRes?.detectedFluidLabel,
          simStatus,
          simStatusMsg,
          subSheetId: allowSubSheet ? def?.subSheetId : undefined,
          subSheetBadge: def?.subSheetBadge,
          onOpenSubSheet: allowSubSheet ? navigateToHierarchySheet : undefined,
        },
      };
    });
  }, [rfNodes, simDefs, unitResultMap, selectedNodeId, isPlantSimMode, hierarchySheets, navigateToHierarchySheet, tagStandard]);

  // 엣지(배관) 스타일 및 라벨 — 깔끔한 슬레이트 중심 + 선택(블루) + 순환Tear(보라)
  const displayEdges: Edge[] = useMemo(() => {
    return flowEdges.map(e => {
      const s = streamResultMap.get(e.id);
      const isSelected = e.id === selectedEdgeId;
      const isTear = Boolean(s?.isTearStream);
      const phaseColor = isSelected
        ? '#1D4ED8'
        : isTear
          ? '#7C3AED'
          : '#475569';

      const labelText = s
        ? `${isTear ? '[순환] ' : ''}[${e.streamNo}] ${formatCanonicalValue('massFlow', s.totalMassKgH, globalUnits.massFlow)} ${getUnitLabel('massFlow', globalUnits.massFlow)} · ${formatCanonicalValue('temp', s.tempC, globalUnits.temp, 1)}${getUnitLabel('temp', globalUnits.temp)} · ${formatCanonicalValue('pressG', s.pressKgcm2g, globalUnits.pressG, 2)}${getUnitLabel('pressG', globalUnits.pressG)} (${s.phase})`
        : `[${e.streamNo}]`;

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourcePort ?? 'out',
        targetHandle: e.targetPort ?? 'in',
        type: 'smoothstep',
        animated: isTear || s?.phase === 'G' || s?.phase === 'L/G',
        selected: isSelected,
        label: labelText,
        labelStyle: {
          fontSize: 9.5,
          fontWeight: 800,
          fill: isSelected ? '#92400E' : isTear ? '#5B21B6' : '#1A2F44',
          fontFamily: 'JetBrains Mono, monospace',
        },
        labelBgStyle: {
          fill: isSelected ? '#FEF3C7' : isTear ? '#F5F3FF' : '#FFFFFF',
          fillOpacity: 0.95,
          stroke: isSelected ? '#D97706' : isTear ? '#8B5CF6' : '#CBD5E1',
          strokeWidth: isSelected || isTear ? 1.5 : 1,
        },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          stroke: phaseColor,
          strokeWidth: isSelected ? 3.4 : isTear ? 2.8 : 2.3,
          strokeDasharray: isTear ? '8 4' : s?.phase === 'G' ? '6 3' : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: phaseColor, width: 15, height: 15 },
      };
    });
  }, [flowEdges, streamResultMap, selectedEdgeId, globalUnits.massFlow, globalUnits.temp, globalUnits.pressG]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  // ── 양방향 포트 자동 정규화 헬퍼 ───────────────────────────
  const normalizeConnection = useCallback(
    (conn: Connection): { source: string; target: string; sourcePort: SourcePortId; targetPort: TargetPortId } | null => {
      if (!conn.source || !conn.target || conn.source === conn.target) return null;
      let src = conn.source;
      let tgt = conn.target;
      let sPort = conn.sourceHandle || 'out';
      let tPort = conn.targetHandle || 'in';

      // 사용자가 역방향(후단 입구 → 전단 출구)으로 드래그한 경우 자동으로 전단→후단으로 뒤집어 줌!
      if (INLET_PORT_SET.has(sPort) && OUTLET_PORT_SET.has(tPort)) {
        src = conn.target;
        tgt = conn.source;
        sPort = conn.targetHandle || 'out';
        tPort = conn.sourceHandle || 'in';
      } else if (INLET_PORT_SET.has(sPort) && INLET_PORT_SET.has(tPort)) {
        // 둘 다 입구 포트를 잡은 경우: 시작 노드의 기본 출구로 보정
        const srcDef = simDefs.find(d => d.id === src);
        sPort =
          srcDef?.unitType === 'absorber' || srcDef?.unitType === 'separator' || srcDef?.unitType === 'distillation'
            ? 'vapor'
            : srcDef?.unitType === 'liquefier'
              ? 'liquid'
              : 'out';
      } else if (OUTLET_PORT_SET.has(sPort) && OUTLET_PORT_SET.has(tPort)) {
        tPort = 'in';
      }

      return {
        source: src,
        target: tgt,
        sourcePort: sPort as SourcePortId,
        targetPort: tPort as TargetPortId,
      };
    },
    [simDefs]
  );

  const connectStartRef = useRef<{ nodeId: string; handleId: string | null } | null>(null);
  const didConnectRef = useRef<boolean>(false);

  // 배관 신규 연결
  const onConnect = useCallback(
    (conn: Connection) => {
      didConnectRef.current = true;
      const norm = normalizeConnection(conn);
      if (!norm) return;
      pushUndoSnapshot();
      const nextIdx = flowEdges.length + 1;
      const streamNo = `S-${String(nextIdx).padStart(2, '0')}`;
      const newEdgeId = `e_${Date.now()}`;
      setFlowEdges(eds => [
        ...eds,
        {
          id: newEdgeId,
          streamNo,
          source: norm.source,
          target: norm.target,
          sourcePort: norm.sourcePort,
          targetPort: norm.targetPort,
        },
      ]);
      setSelectedEdgeId(newEdgeId);
      setSelectedNodeId(null);
    },
    [flowEdges.length, normalizeConnection, pushUndoSnapshot]
  );

  const onConnectStart = useCallback(
    (_: React.MouseEvent | React.TouchEvent, params: { nodeId: string | null; handleId: string | null }) => {
      didConnectRef.current = false;
      if (params.nodeId) {
        connectStartRef.current = { nodeId: params.nodeId, handleId: params.handleId };
      }
    },
    []
  );

  // 빈 캔버스 허공에 배관 끝점을 놓으면 출발/목표 장치 없이도 자동으로 유입/유출 스트림 블록을 생성·연결!
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const start = connectStartRef.current;
      connectStartRef.current = null;
      if (!start || didConnectRef.current) return;

      const targetEl = event.target as HTMLElement | null;
      if (!targetEl || !targetEl.closest('.react-flow__pane')) return;

      const originDef = simDefs.find(d => d.id === start.nodeId);
      if (!originDef || !rfInstance) return;

      const clientX = 'changedTouches' in event ? event.changedTouches[0]?.clientX ?? 300 : event.clientX;
      const clientY = 'changedTouches' in event ? event.changedTouches[0]?.clientY ?? 200 : event.clientY;
      const dropPos = rfInstance.screenToFlowPosition({ x: clientX, y: clientY });

      const rawH = start.handleId || (originDef.unitType === 'feed' ? 'out' : 'out');
      const isFromInlet = originDef.unitType !== 'feed' && INLET_PORT_SET.has(rawH);

      const nextStreamIdx = flowEdges.length + 1;
      const streamNo = `S-${String(nextStreamIdx).padStart(2, '0')}`;
      const newEdgeId = `e_${Date.now()}_${Math.floor(Math.random() * 999)}`;
      const newNodeId = `u_${Date.now()}_${Math.floor(Math.random() * 999)}`;

      if (isFromInlet) {
        pushUndoSnapshot();
        const feedCount = simDefs.filter(d => d.unitType === 'feed').length + 1;
        const feedTag = `S-IN-${String(feedCount).padStart(2, '0')}`;
        const defaultParams =
          originDef.unitType === 'distillation'
            ? {
                feedTempC: 65,
                feedPressKgcm2g: 0.2,
                feedFlowsKgH: (useGenericDefault
                  ? { Benzene: 5000, Toluene: 5000 }
                  : { ECH: 5000, DCH: 5000 }) as Partial<Record<SimCompKey, number>>,
              }
            : rawH === 'liq_in' && originDef.unitType === 'absorber'
              ? {
                  feedTempC: 25,
                  feedPressKgcm2g: 1.0,
                  feedFlowsKgH: { H2SO4: 980, H2O: 20 } as Partial<Record<SimCompKey, number>>,
                }
              : createDefaultParamsForType('feed', useGenericDefault);

        const newFeedDef: FlowNodeDef = {
          id: newNodeId,
          tag: feedTag,
          name: originDef.unitType === 'distillation' ? `${originDef.tag} 원료 유입` : '유입 스트림',
          unitType: 'feed',
          params: defaultParams,
        };
        const pos = { x: dropPos.x - 108, y: dropPos.y - 26 };
        const newEdge: FlowEdgeDef = {
          id: newEdgeId,
          streamNo,
          source: newNodeId,
          target: originDef.id,
          sourcePort: 'out',
          targetPort: rawH as TargetPortId,
        };

        setSimDefs(prev => [...prev, newFeedDef]);
        setRfNodes(prev => [
          ...prev,
          {
            id: newNodeId,
            type: 'flowUnit',
            position: pos,
            data: { tag: feedTag, name: newFeedDef.name, unitType: 'feed', liveSummary: '' },
          },
        ]);
        setFlowEdges(prev => [...prev, newEdge]);
        setSelectedNodeId(newNodeId);
        setSelectedEdgeId(null);
      } else {
        pushUndoSnapshot();
        const outCount = simDefs.filter(d => d.unitType === 'product').length + 1;
        const outTag = `S-OUT-${String(outCount).padStart(2, '0')}`;
        const outName =
          originDef.unitType === 'distillation' && rawH === 'vapor'
            ? `${originDef.tag} 탑정 유출(D)`
            : originDef.unitType === 'distillation' && rawH === 'side_cut'
              ? `${originDef.tag} 사이드컷 측류(S)`
              : originDef.unitType === 'distillation' && rawH === 'liquid'
                ? `${originDef.tag} 탑저 관출(B)`
                : rawH === 'vapor'
                  ? `${originDef.tag} 상부 기상(G)`
                  : rawH === 'liquid'
                    ? `${originDef.tag} 하부 액상(L)`
                    : '유출 스트림';

        const newOutDef: FlowNodeDef = {
          id: newNodeId,
          tag: outTag,
          name: outName,
          unitType: 'product',
          params: {},
        };
        const pos = { x: dropPos.x - 12, y: dropPos.y - 26 };
        const srcPort: SourcePortId = OUTLET_PORT_SET.has(rawH) ? (rawH as SourcePortId) : 'out';
        const newEdge: FlowEdgeDef = {
          id: newEdgeId,
          streamNo,
          source: originDef.id,
          target: newNodeId,
          sourcePort: srcPort,
          targetPort: 'in',
        };

        setSimDefs(prev => [...prev, newOutDef]);
        setRfNodes(prev => [
          ...prev,
          {
            id: newNodeId,
            type: 'flowUnit',
            position: pos,
            data: { tag: outTag, name: outName, unitType: 'product', liveSummary: '' },
          },
        ]);
        setFlowEdges(prev => [...prev, newEdge]);
        setSelectedEdgeId(newEdgeId);
        setSelectedNodeId(null);
      }
    },
    [flowEdges.length, rfInstance, simDefs]
  );

  // 단독 장치(예: 증류탑 1기)의 미연결 입·출구 포트에 유입/유출 스트림 블록을 원클릭으로 일괄 생성 + 즉시 수렴 실행!
  const autoAttachMissingStreams = useCallback(
    (targetId?: string) => {
      const nodeId = targetId ?? selectedNodeId;
      if (!nodeId) return;
      const targetDef = simDefs.find(d => d.id === nodeId);
      const targetRf = rfNodes.find(n => n.id === nodeId);
      if (!targetDef || !targetRf || targetDef.unitType === 'feed' || targetDef.unitType === 'product') return;

      const basePos = targetRf.position;
      const addedDefs: FlowNodeDef[] = [];
      const addedRfNodes: Node<FlowCanvasNodeData>[] = [];
      const addedEdges: FlowEdgeDef[] = [];
      let feedSeq = simDefs.filter(d => d.unitType === 'feed').length;
      let prodSeq = simDefs.filter(d => d.unitType === 'product').length;
      let edgeSeq = flowEdges.length;

      // 1) 유입 포트 점검
      const reqInPorts: Array<{ port: TargetPortId; dy: number; label: string }> =
        targetDef.unitType === 'electrolyzer'
          ? [
              { port: 'anode_in', dy: -45, label: '양극 염수 유입' },
              { port: 'cathode_in', dy: 45, label: '음극 순수 유입' },
            ]
          : [{ port: 'in', dy: 12, label: `${targetDef.tag} 원료 유입` }];

      for (const inp of reqInPorts) {
        const hasIn = flowEdges.some(
          e => e.target === nodeId && (e.targetPort === inp.port || (!e.targetPort && inp.port === 'in'))
        );
        if (!hasIn) {
          feedSeq++;
          edgeSeq++;
          const fid = `u_in_${Date.now()}_${feedSeq}`;
          const ftag = `S-IN-${String(feedSeq).padStart(2, '0')}`;
          const fParams =
            targetDef.unitType === 'distillation'
              ? {
                  feedTempC: 65,
                  feedPressKgcm2g: 0.2,
                  feedFlowsKgH: { ECH: 5000, DCH: 5000 } as Partial<Record<SimCompKey, number>>,
                }
              : inp.port === 'anode_in'
                ? {
                    feedTempC: 65,
                    feedPressKgcm2g: 1.2,
                    feedFlowsKgH: { NaCl: 7680, H2O: 22320 } as Partial<Record<SimCompKey, number>>,
                  }
                : inp.port === 'cathode_in'
                  ? {
                      feedTempC: 80,
                      feedPressKgcm2g: 1.2,
                      feedFlowsKgH: { NaOH: 9000, H2O: 21000 } as Partial<Record<SimCompKey, number>>,
                    }
                  : createDefaultParamsForType('feed', useGenericDefault);

          addedDefs.push({ id: fid, tag: ftag, name: inp.label, unitType: 'feed', params: fParams });
          addedRfNodes.push({
            id: fid,
            type: 'flowUnit',
            position: { x: basePos.x - 225, y: basePos.y + inp.dy },
            data: { tag: ftag, name: inp.label, unitType: 'feed', liveSummary: '' },
          });
          addedEdges.push({
            id: `e_auto_${Date.now()}_${edgeSeq}`,
            streamNo: `S-${String(edgeSeq).padStart(2, '0')}`,
            source: fid,
            target: nodeId,
            sourcePort: 'out',
            targetPort: inp.port,
          });
        }
      }

      // 2) 유출 포트 점검
      const isDualOut =
        targetDef.unitType === 'distillation' ||
        targetDef.unitType === 'separator' ||
        targetDef.unitType === 'absorber' ||
        targetDef.unitType === 'liquefier' ||
        targetDef.unitType === 'splitter' ||
        targetDef.unitType === 'saturator' ||
        targetDef.unitType === 'desiccant_dryer';

      const reqOutPorts: Array<{ port: SourcePortId; dy: number; label: string }> =
        targetDef.unitType === 'electrolyzer'
          ? [
              { port: 'anode_out', dy: -45, label: '양극 출구류' },
              { port: 'cathode_out', dy: 45, label: '음극 출구류' },
            ]
          : isDualOut
            ? [
                {
                  port: 'vapor',
                  dy: -38,
                  label: targetDef.unitType === 'distillation' ? `${targetDef.tag} 탑정 유출(D)` : `${targetDef.tag} 상부 출구`,
                },
                ...(targetDef.unitType === 'distillation' && targetDef.params.distillConfig?.sideCut?.enabled
                  ? [
                      {
                        port: 'side_cut' as SourcePortId,
                        dy: 10,
                        label: `${targetDef.tag} 사이드컷 측류(S)`,
                      },
                    ]
                  : []),
                {
                  port: 'liquid',
                  dy: 58,
                  label: targetDef.unitType === 'distillation' ? `${targetDef.tag} 탑저 관출(B)` : `${targetDef.tag} 하부 출구`,
                },
              ]
            : [{ port: 'out', dy: 12, label: `${targetDef.tag} 유출 스트림` }];

      for (const outp of reqOutPorts) {
        const hasOut = flowEdges.some(
          e => e.source === nodeId && (e.sourcePort === outp.port || (!e.sourcePort && outp.port === 'out'))
        );
        if (!hasOut) {
          prodSeq++;
          edgeSeq++;
          const pid = `u_out_${Date.now()}_${prodSeq}`;
          const ptag = `S-OUT-${String(prodSeq).padStart(2, '0')}`;
          addedDefs.push({ id: pid, tag: ptag, name: outp.label, unitType: 'product', params: {} });
          addedRfNodes.push({
            id: pid,
            type: 'flowUnit',
            position: { x: basePos.x + 235, y: basePos.y + outp.dy },
            data: { tag: ptag, name: outp.label, unitType: 'product', liveSummary: '' },
          });
          addedEdges.push({
            id: `e_auto_${Date.now()}_${edgeSeq}`,
            streamNo: `S-${String(edgeSeq).padStart(2, '0')}`,
            source: nodeId,
            target: pid,
            sourcePort: outp.port,
            targetPort: 'in',
          });
        }
      }

      if (addedDefs.length === 0 && addedEdges.length === 0) return;

      pushUndoSnapshot();
      const nextDefs = [...simDefs, ...addedDefs];
      const nextEdges = [...flowEdges, ...addedEdges];
      skipNextDirtyRef.current = true;
      setSimDefs(nextDefs);
      setRfNodes(prev => [...prev, ...addedRfNodes]);
      setFlowEdges(nextEdges);
      runSimulationNow(nextDefs, nextEdges);
    },
    [flowEdges, rfNodes, runSimulationNow, selectedNodeId, simDefs]
  );

  // 기존 배관 끝점 드래그 재연결 (예: 건조탑→제품 배관을 건조탑→압축기로 바로 옮기기!)
  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, newConn: Connection) => {
      const norm = normalizeConnection(newConn);
      if (!norm) return;
      pushUndoSnapshot();
      setFlowEdges(eds =>
        eds.map(e =>
          e.id === oldEdge.id
            ? {
                ...e,
                source: norm.source,
                target: norm.target,
                sourcePort: norm.sourcePort,
                targetPort: norm.targetPort,
              }
            : e
        )
      );
    },
    [normalizeConnection, pushUndoSnapshot]
  );

  // 장치 신규 추가 (드래그 앤 드롭 또는 클릭)
  const spawnUnitAtPosition = useCallback(
    (type: FlowUnitType, pos?: { x: number; y: number }) => {
      pushUndoSnapshot();
      const meta = UNIT_CATALOG.find(u => u.type === type)!;
      const countOfType = simDefs.filter(d => d.unitType === type).length + 1;
      const id = `u_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const prefix =
        type === 'feed' ||
        type === 'product' ||
        type === 'filter_visual' ||
        type === 'valve_visual' ||
        type === 'valve'
          ? meta.tagPrefix
          : getDefaultTagPrefix(type, tagStandard);
      const tag = `${prefix}-${100 + countOfType * 10}`;
      const position = pos ?? {
        x: 240 + (simDefs.length % 5) * 185,
        y: 120 + Math.floor(simDefs.length / 5) * 130,
      };

      const newDef: FlowNodeDef = {
        id,
        tag,
        name: meta.label.split(' (')[0],
        unitType: type,
        params: createDefaultParamsForType(type, useGenericDefault),
      };

      setSimDefs(prev => [...prev, newDef]);
      setRfNodes(prev => [
        ...prev.map(n => (n.selected ? { ...n, selected: false } : n)),
        {
          id,
          type: 'flowUnit',
          position,
          selected: true,
          data: { tag, name: newDef.name, unitType: type, liveSummary: '' },
        },
      ]);
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
    },
    [pushUndoSnapshot, simDefs, tagStandard, useGenericDefault]
  );

  const handleDragStart = (e: React.DragEvent, unitType: FlowUnitType) => {
    e.dataTransfer.setData('application/chemplant-unit', unitType);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const unitType = e.dataTransfer.getData('application/chemplant-unit') as FlowUnitType;
      if (!unitType) return;
      if (rfInstance && rfWrapperRef.current) {
        const position = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        spawnUnitAtPosition(unitType, { x: position.x - 65, y: position.y - 35 });
      } else {
        spawnUnitAtPosition(unitType);
      }
    },
    [rfInstance, spawnUnitAtPosition]
  );

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    pushUndoSnapshot();
    setSimDefs(prev => prev.filter(d => d.id !== selectedNodeId));
    setRfNodes(prev => prev.filter(n => n.id !== selectedNodeId));
    setFlowEdges(prev => prev.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  };

  const deleteEdgeById = (edgeId: string) => {
    pushUndoSnapshot();
    setFlowEdges(prev => prev.filter(e => e.id !== edgeId));
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
  };

  const selectedDef = useMemo(() => simDefs.find(d => d.id === selectedNodeId) ?? null, [simDefs, selectedNodeId]);
  const selectedUnitRes = selectedNodeId ? unitResultMap.get(selectedNodeId) : undefined;
  const selectedEdgeDef = useMemo(() => flowEdges.find(e => e.id === selectedEdgeId) ?? null, [flowEdges, selectedEdgeId]);
  const selectedStreamRes = selectedEdgeId ? streamResultMap.get(selectedEdgeId) : undefined;

  const selectedUnitDesignRoute = useMemo(() => {
    if (!selectedDef) return null;
    const route = getUnitDesignRouteInfo(selectedDef, isElectrolyzerMode, activeSheetId);
    if (
      route &&
      isSimulatorOnlyUser(user) &&
      (route.kind === 'plant_brine' || route.kind === 'electrolyzer_sub')
    ) {
      return null;
    }
    return route;
  }, [selectedDef, isElectrolyzerMode, activeSheetId, user]);

  const handleOpenUnitDesign = useCallback((overrideNodeId?: unknown) => {
    const explicitId = typeof overrideNodeId === 'string' ? overrideNodeId : undefined;
    const targetDef = explicitId ? simDefs.find(d => d.id === explicitId) : selectedDef;
    const targetRoute = targetDef
      ? getUnitDesignRouteInfo(targetDef, isElectrolyzerMode, activeSheetId)
      : null;
    if (!targetDef || !targetRoute) return;

    // 정밀증류탑(distillation) 및 열교환기·액화기(hex/cooler/liquefier)는 외부 페이지 이탈 없이 빌더 내장 설계 워크벤치를 오픈
    if (targetDef.unitType === 'distillation') {
      setDistillModalInitialView('internals');
      setDistillModalNodeId(targetDef.id);
      return;
    }
    if (
      targetDef.unitType === 'hex' ||
      targetDef.unitType === 'cooler' ||
      targetDef.unitType === 'liquefier'
    ) {
      setHxModalInitialView('mechanical');
      setHxModalNodeId(targetDef.id);
      return;
    }

    const targetUnitRes = unitResultMap.get(targetDef.id);

    if (targetRoute.kind === 'chempro') {
      const sourceLabel = isElectrolyzerMode
        ? `PLANT 01 전해공장 시뮬레이터 (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
        : isHcl1AMode
          ? `PLANT 02 초고순도·무수염산 & 폐염산회수 (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
          : isEchGteMode
            ? `PLANT 03 ECH (7만톤 GTE) (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
            : isCmsMode
              ? `PLANT 04 클로로메탄(CMS) (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
              : isMdiMode
                ? `PLANT 05 MDI (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
                : '공정 시뮬레이터';
      const payload = buildChemProHandoffPayload(
        targetDef,
        flowEdges,
        solved.streams,
        targetUnitRes,
        sourceLabel
      );
      if (payload) {
        saveChemProHandoffPayload({ ...payload, plantId: workspacePlantId });
        router.push(`/unit-equipment?tab=${encodeURIComponent(payload.tab)}&handoff=1&ts=${payload.timestamp}`);
      } else if (targetRoute.chemproTab) {
        router.push(`/unit-equipment?tab=${encodeURIComponent(targetRoute.chemproTab)}`);
      }
      return;
    }

    if (targetRoute.kind === 'plant_evap') {
      setEquipSubTab('evap');
      setActiveDesignRequest({ tab: 'evap', tag: targetDef.tag });
      router.push('/equipment-design?tab=evap');
      return;
    }

    if (targetRoute.kind === 'evap_special') {
      router.push('/special-process');
      return;
    }

    if (targetRoute.kind === 'plant_brine') {
      if (isSimulatorOnlyUser(user)) {
        setBoundarySyncBanner(['범용 시뮬레이터 모드에서는 전용 공장 설계 모듈로 이동하지 않습니다. 시뮬레이터 내에서 직접 운전 조건을 설정하세요.']);
        return;
      }
      setEquipSubTab('brine');
      setActiveDesignRequest({ tab: 'brine', tag: targetDef.tag });
      router.push('/equipment-design?tab=brine');
      return;
    }

    if (targetRoute.kind === 'electrolyzer_sub') {
      if (isSimulatorOnlyUser(user)) {
        setBoundarySyncBanner(['범용 시뮬레이터 모드에서는 전용 공장 설계 모듈로 이동하지 않습니다. 시뮬레이터 내에서 직접 운전 조건을 설정하세요.']);
        return;
      }
      setActivePlantId('clorsim_sim');
      requestSimSheet('sub_200_cell');
      router.push('/material-balance');
    }
  }, [
    simDefs,
    selectedDef,
    unitResultMap,
    isElectrolyzerMode,
    isHcl1AMode,
    isEchGteMode,
    isCmsMode,
    isMdiMode,
    activeSheetId,
    workspacePlantId,
    flowEdges,
    solved.streams,
    router,
    setEquipSubTab,
    setActiveDesignRequest,
    setActivePlantId,
    requestSimSheet,
    user,
  ]);

  const handlePendingCaseRef = useRef<(pending: PendingCaseLoadPayload) => void>(() => {});
  useEffect(() => {
    handlePendingCaseRef.current = (pending: PendingCaseLoadPayload) => {
      if (pending.action === 'load_project' && pending.rawProject?.state) {
        loadFromStateObject(pending.rawProject.state as SavedFlowsheetState);
        setActiveCaseTitle(pending.caseName || pending.rawProject.name || null, workspacePlantId);
        setShowStorageBar(false);
        setTimeout(() => rfInstance?.fitView({ padding: 0.14, duration: 240 }), 60);
      } else if (pending.action === 'new_blank') {
        skipNextDirtyRef.current = true;
        const defaultComps = getPlantDefaultComponents(workspaceMode);
        setPropertyMethod(defaultModePropertyMethod);
        setActiveComponents(defaultComps);
        setPresetId('blank');
        setActiveSheetId('master');
        setBoundarySyncBanner([]);
        if (!isPlantSimMode) {
          setHierarchySheets({
            master: {
              ...initialSheets.master,
              simDefs: [],
              positions: {},
              flowEdges: [],
            },
          });
        }
        clearUndoHistory();
        setSimDefs([]);
        setRfNodes([]);
        setFlowEdges([]);
        setSolvedMeta({
          result: createIdleFlowsheetResult([], [], {
            propertyMethod: defaultModePropertyMethod,
            activeComponents: defaultComps,
          }),
          elapsedMs: 0,
          runCount: 0,
          lastRunTime: '미실행 (▶ RUN 대기)',
        });
        setIsSimDirty(true);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setShowStorageBar(false);
        setActiveCaseTitle(null, workspacePlantId);
      }
    };
  });

  useEffect(() => {
    const onLoadSavedCase = (ev: Event) => {
      const customEv = ev as CustomEvent<Partial<PendingCaseLoadPayload> | undefined>;
      const detail = customEv?.detail;
      if (detail && detail.action) {
        if (detail.uiMode && detail.uiMode !== 'modern') return;
        const normTarget = detail.targetPlantId === 'clorsim' ? 'clorsim_sim' : detail.targetPlantId;
        if (normTarget && normTarget !== workspacePlantId) return;
        try {
          const rawStr = window.sessionStorage.getItem(PENDING_CASE_LOAD_KEY);
          if (rawStr) {
            const peek = JSON.parse(rawStr) as Partial<PendingCaseLoadPayload>;
            const peekTarget = peek?.targetPlantId === 'clorsim' ? 'clorsim_sim' : peek?.targetPlantId;
            if (!peekTarget || peekTarget === workspacePlantId) {
              consumePendingCaseLoad('modern');
            }
          }
        } catch {
          consumePendingCaseLoad('modern');
        }
        handlePendingCaseRef.current(detail as PendingCaseLoadPayload);
        return;
      }

      try {
        const rawStr = window.sessionStorage.getItem(PENDING_CASE_LOAD_KEY);
        if (!rawStr) return;
        const peek = JSON.parse(rawStr) as Partial<PendingCaseLoadPayload>;
        if (!peek || peek.uiMode !== 'modern') return;
        const normTarget = peek.targetPlantId === 'clorsim' ? 'clorsim_sim' : peek.targetPlantId;
        if (normTarget && normTarget !== workspacePlantId) return;
        const pending = consumePendingCaseLoad('modern');
        if (pending) {
          handlePendingCaseRef.current(pending);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener(LOAD_SAVED_CASE_EVENT, onLoadSavedCase);
    return () => window.removeEventListener(LOAD_SAVED_CASE_EVENT, onLoadSavedCase);
  }, [workspacePlantId]);

  const openShortcutCalcRef = useRef<() => void>(() => {});
  useEffect(() => {
    openShortcutCalcRef.current = () => {
      if (!selectedDef) {
        router.push('/unit-equipment');
        return;
      }
      const sourceLabel = isElectrolyzerMode
        ? `PLANT 01 전해공장 시뮬레이터 (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
        : isHcl1AMode
          ? `PLANT 02 초고순도·무수염산 & 폐염산회수 (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
          : isEchGteMode
            ? `PLANT 03 ECH (7만톤 GTE) (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
            : isCmsMode
              ? `PLANT 04 클로로메탄(CMS) (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
              : isMdiMode
                ? `PLANT 05 MDI (${activeSheetId === 'master' ? '전공정 마스터' : activeSheetId})`
                : '공정 시뮬레이터';
      const payload = buildChemProHandoffPayload(
        selectedDef,
        flowEdges,
        solved.streams,
        unitResultMap.get(selectedDef.id),
        sourceLabel
      );
      if (payload) {
        saveChemProHandoffPayload({ ...payload, plantId: workspacePlantId });
        router.push(`/unit-equipment?tab=${encodeURIComponent(payload.tab)}&handoff=1&ts=${payload.timestamp}`);
      } else {
        router.push(`/unit-equipment?tab=${encodeURIComponent(mapFlowUnitTypeToChemProTab(selectedDef.unitType))}`);
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
    const matched = activeCaseName
      ? namedProjects.find(p => p.name === activeCaseName) ?? null
      : null;
    if (matched) {
      overwriteNamedProject(matched.id);
      setInteropNotice({
        kind: 'success',
        text: `"${matched.name}" 케이스에 바로 저장되었습니다.`,
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
          setShowStorageBar(true);
        }
        return;
      }
      setShowStorageBar(v => !v);
    };
    window.addEventListener(OPEN_SAVE_CASE_EVENT, onOpenSaveCase);
    return () => window.removeEventListener(OPEN_SAVE_CASE_EVENT, onOpenSaveCase);
  }, []);

  const updateSelectedDef = (patch: Partial<FlowNodeDef>) => {
    if (!selectedNodeId) return;
    recordParamEditSnapshot();
    setSimDefs(prev => prev.map(d => (d.id === selectedNodeId ? { ...d, ...patch } : d)));
  };

  const updateParam = (key: keyof FlowNodeDef['params'], val: unknown) => {
    if (!selectedNodeId) return;
    recordParamEditSnapshot();
    setSimDefs(prev =>
      prev.map(d => (d.id === selectedNodeId ? { ...d, params: { ...d.params, [key]: val } } : d))
    );
  };

  const updateFeedComp = (comp: SimCompKey, kgH: number) => {
    if (!selectedNodeId) return;
    recordParamEditSnapshot();
    setSimDefs(prev =>
      prev.map(d => {
        if (d.id !== selectedNodeId) return d;
        const nextFlows = { ...(d.params.feedFlowsKgH ?? {}), [comp]: Math.max(0, kgH) };
        return { ...d, params: { ...d.params, feedFlowsKgH: nextFlows } };
      })
    );
  };

  // 냉매 프리셋 선택 시 운전 온도 및 총괄열전달계수도 함께 추천 세팅
  const applyRefrigerantPreset = (presetKey: RefrigerantPresetKey) => {
    if (!selectedDef) return;
    pushUndoSnapshot();
    const presetMeta = REFRIGERANT_PRESETS[presetKey];
    const suggestedOperTemp =
      presetKey === 'freon_m35'
        ? -26.0
        : presetKey === 'r404a_m32'
          ? -24.0
          : presetKey === 'nh3_m33'
            ? -23.0
            : presetKey === 'r22_m30'
              ? -22.0
              : presetKey === 'brine_m20'
                ? -14.0
                : presetKey === 'r134a_chiller' || presetKey === 'meg_brine'
                  ? -4.0
                  : presetKey === 'chw'
                    ? 14.0
                    : presetKey === 'cw'
                      ? 35.0
                      : presetKey === 'steam_lp'
                        ? 120.0
                        : selectedDef.params.operTempC ?? 25.0;

    setSimDefs(prev =>
      prev.map(d =>
        d.id === selectedDef.id
          ? {
              ...d,
              params: {
                ...d.params,
                refrigerantPreset: presetKey,
                operTempC: presetKey === 'custom' ? d.params.operTempC : suggestedOperTemp,
                utilInTempC: presetMeta.inTempC,
                utilOutTempC: presetMeta.outTempC,
                utilCp: presetMeta.cp,
                overallU: presetMeta.defaultU,
              },
            }
          : d
      )
    );
  };

  const activePaletteGroup = PALETTE_GROUPS.find(g => g.key === paletteCategory) ?? PALETTE_GROUPS[0];
  const activePaletteItems = activePaletteGroup.types
    .map(tp => UNIT_CATALOG.find(u => u.type === tp))
    .filter((u): u is UnitCatalogItem => Boolean(u));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minHeight: 0,
        background: '#F6F7F2',
        color: '#1A2F44',
        overflow: 'hidden',
      }}
    >
      {/* ── 단일 행 컴팩트 컨트롤 바 (모바일 전용 3탭 바 / 데스크톱 툴바 분리) ── */}
      {isMobile ? (
        <div
          className="no-scrollbar"
          style={{
            height: 38,
            minHeight: 38,
            padding: '0 8px',
            background: '#FFFFFF',
            borderBottom: '1px solid #E5E2DC',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexWrap: 'nowrap',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            flexShrink: 0,
          }}
        >
          {activeSheetId !== 'master' && (
            <button
              onClick={() => navigateToHierarchySheet('master')}
              style={{
                padding: '4px 8px',
                fontSize: 10.5,
                fontWeight: 800,
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              ⬅ 상위
            </button>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#F1F5F9',
              border: '1px solid #E2E8F0',
              padding: 2,
              borderRadius: 7,
              gap: 2,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => {
                setLayoutMode('canvas');
                setInspectorOpen(false);
                setTimeout(() => rfInstance?.fitView({ padding: 0.1, duration: 200 }), 80);
              }}
              style={{
                padding: '4px 8px',
                fontSize: 10.5,
                fontWeight: 800,
                borderRadius: 5,
                border: 'none',
                background: layoutMode !== 'table' ? '#1E3A8A' : 'transparent',
                color: layoutMode !== 'table' ? '#FFFFFF' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><PfdSchematicIcon size={12} /> 도면</span>
            </button>
            <button
              onClick={() => {
                setLayoutMode('table');
                setBottomTab('streams');
                setInspectorOpen(false);
                setPaletteOpen(false);
              }}
              style={{
                padding: '4px 8px',
                fontSize: 10.5,
                fontWeight: 800,
                borderRadius: 5,
                border: 'none',
                background: layoutMode === 'table' && bottomTab === 'streams' ? '#1E3A8A' : 'transparent',
                color: layoutMode === 'table' && bottomTab === 'streams' ? '#FFFFFF' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><StreamFlowIcon size={12} /> 스트림({solved.streams.length})</span>
            </button>
            <button
              onClick={() => {
                setLayoutMode('table');
                setBottomTab('units');
                setInspectorOpen(false);
                setPaletteOpen(false);
              }}
              style={{
                padding: '4px 8px',
                fontSize: 10.5,
                fontWeight: 800,
                borderRadius: 5,
                border: 'none',
                background: layoutMode === 'table' && bottomTab === 'units' ? '#1E3A8A' : 'transparent',
                color: layoutMode === 'table' && bottomTab === 'units' ? '#FFFFFF' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><VesselEquipIcon size={12} /> 장치({solved.units.length})</span>
            </button>
          </div>

          <button
            disabled={isSimRunning}
            onClick={() => runSimulationNow()}
            style={{
              padding: '4px 9px',
              fontSize: 10.5,
              fontWeight: 800,
              borderRadius: 6,
              border: '1px solid #1E3A8A',
              background: isSimRunning ? '#475569' : '#1E3A8A',
              color: '#FFFFFF',
              cursor: isSimRunning ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {isSimRunning ? (
              '계산중...'
            ) : (
              <>
                <span>▶ RUN</span>
                {isSimDirty && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#F59E0B',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                )}
              </>
            )}
          </button>

          {layoutMode !== 'table' && (
            <button
              onClick={() => rfInstance?.fitView({ padding: 0.1, duration: 220 })}
              style={{
                padding: '4px 7px',
                fontSize: 10.5,
                fontWeight: 800,
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><FitFrameIcon size={12} /> 맞춤</span>
            </button>
          )}

          <button
            onClick={() => {
              if (layoutMode === 'table') setLayoutMode('canvas');
              setPaletteOpen(v => !v);
            }}
            style={{
              padding: '4px 7px',
              fontSize: 10.5,
              fontWeight: 800,
              borderRadius: 6,
              border: paletteOpen ? '1px solid #64748B' : '1px solid #CBD5E1',
              background: paletteOpen ? '#F1F5F9' : '#FFFFFF',
              color: '#1E293B',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {paletteOpen ? '▼ 팔레트' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><PlusSquareIcon size={11} /> 장치추가</span>}
          </button>

          {!isPlantSimMode && (
            <select
              value={getAllPresets().some(p => p.id === presetId) ? presetId : ''}
              onChange={e => {
                const found = getAllPresets().find(p => p.id === e.target.value);
                if (found) loadPreset(found);
              }}
              style={{
                padding: '4px 6px',
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 6,
                maxWidth: 135,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                flexShrink: 0,
              }}
            >
              <option value="" disabled>
                프리셋 불러오기...
              </option>
              <optgroup label="기본 자유설계">
                {getAllPresets()
                  .filter(p => p.group === 'general' && (!isSimulatorOnlyUser(user) || p.isPublicTextbook))
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.btnLabel}
                    </option>
                  ))}
              </optgroup>
              {isPlantAllowed(PLANT_GROUP_TO_ID.electrolysis, user) && (
                <optgroup label={formatPlantLabelForUser('PLANT 01 전해 단위공정', user)}>
                  {getAllPresets()
                    .filter(p => p.group === 'plant02')
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.btnLabel}
                      </option>
                    ))}
                </optgroup>
              )}
              {isPlantAllowed(PLANT_GROUP_TO_ID.hcl1A, user) && (
                <optgroup label={formatPlantLabelForUser('PLANT 02 1A 단위공정', user)}>
                  {getAllPresets()
                    .filter(p => p.group === 'plant03')
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.btnLabel}
                      </option>
                    ))}
                </optgroup>
              )}
              {isPlantAllowed(PLANT_GROUP_TO_ID.ech, user) && (
                <optgroup label={formatPlantLabelForUser('PLANT 03 바이오 ECH 단위공정', user)}>
                  {getAllPresets()
                    .filter(p => p.group === 'plant04')
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.btnLabel}
                      </option>
                    ))}
                </optgroup>
              )}
              {isPlantAllowed(PLANT_GROUP_TO_ID.cms, user) && (
                <optgroup label={formatPlantLabelForUser('PLANT 04 클로로메탄(CMS) 단위공정', user)}>
                  {getAllPresets()
                    .filter(p => p.group === 'plant05')
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.btnLabel}
                      </option>
                    ))}
                </optgroup>
              )}
              {isPlantAllowed(PLANT_GROUP_TO_ID.mdi, user) && (
                <optgroup label={formatPlantLabelForUser('PLANT 05 · MDI 통합 공정', user)}>
                  {getAllPresets()
                    .filter(p => p.group === 'plant06')
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.btnLabel}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
          )}

          <button
            type="button"
            onClick={() => setCompSetupModalOpen(true)}
            title={`공정 성분 및 열역학 모델 설정 — 추천: ${autoPropertyRecommendation.method} (${autoPropertyRecommendation.reasonKo})`}
            style={{
              padding: '3px 9px',
              fontSize: 10.5,
              fontWeight: 700,
              borderRadius: 5,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#1E293B',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FlaskCompIcon size={11} /> 성분 ({activeComponents.length}종)</span>
            <span style={{ color: '#CBD5E1' }}>|</span>
            <span>
              <SlidersParamIcon size={11} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 4 }} />
              {propertyMethod === 'AUTO'
                ? `자동(${solved.propertyMethodUsed ?? autoPropertyRecommendation.method})`
                : propertyMethod}{' '}
              ▾
            </span>
          </button>

          <button
            type="button"
            onClick={() => setOptModalOpen(true)}
            title="플로우시트 목표역산 제어기(Design Spec), 다변수 민감도 분석(Sensitivity), Broyden/Wegstein 리사이클 수렴기 설정"
            style={{
              padding: '3px 9px',
              fontSize: 10.5,
              fontWeight: 700,
              borderRadius: 5,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#1E293B',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><SpecControlIcon size={11} /> 목표역산 · 민감도</span>
            {designSpecs.filter(s => s.enabled).length > 0 && (
              <span
                style={{
                  padding: '0 5px',
                  borderRadius: 999,
                  background: '#1E3A8A',
                  color: '#FFFFFF',
                  fontSize: 9.5,
                  fontWeight: 900,
                }}
              >
                {designSpecs.filter(s => s.enabled).length}
              </span>
            )}
          </button>

          <CaseOutputsMenu compact unitCount={simDefs.length} />
        </div>
      ) : (
      <div
        className="no-scrollbar"
        style={{
          height: 36,
          minHeight: 36,
          padding: '0 10px',
          background: '#FFFFFF',
          borderBottom: '1px solid #E5E2DC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', flexShrink: 0 }}>
          {/* 세부공정 진입 상태일 때 마스터 복귀 버튼 + 현재 시트 위치 표시 */}
          {activeSheetId !== 'master' && (
            <>
              <button
                onClick={() => navigateToHierarchySheet('master')}
                title="변경된 운전 결과를 상위 전공정 마스터 도면에 반영하고 복귀합니다."
                style={{
                  padding: '3px 8px',
                  fontSize: 10.5,
                  fontWeight: 800,
                  borderRadius: 5,
                  cursor: 'pointer',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#1E293B',
                  whiteSpace: 'nowrap',
                }}
              >
                ⬅ 마스터 도면
              </button>
              <span
                title={boundarySyncBanner.length > 0 ? `경계 동기화: ${boundarySyncBanner.join(' | ')}` : undefined}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#334155',
                  whiteSpace: 'nowrap',
                }}
              >
                {hierarchySheets[activeSheetId]?.shortTabLabel ?? activeSheetId}
              </span>
            </>
          )}

          {/* 화면 분할 모드 전환 (박스 없이 깔끔한 텍스트/밑줄 탭) */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {([
              { id: 'canvas', label: '도면 크게' },
              { id: 'split', label: '도면+스트림' },
              { id: 'table', label: '스트림 전체' },
            ] as const).map(v => {
              const active = layoutMode === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => setLayoutMode(v.id)}
                  style={{
                    fontSize: 11,
                    fontWeight: active ? 800 : 600,
                    padding: '4px 7px',
                    border: 'none',
                    borderBottom: active ? '2px solid #1E3A8A' : '2px solid transparent',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: active ? '#1E3A8A' : '#475569',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {v.label}
                </button>
              );
            })}
          </div>

          {/* ── 명시적 [▶ RUN 시뮬레이션 실행] 버튼 & 수렴 진단 배지/팝오버 ── */}
          {(() => {
            const colUnits = solved.units.filter(u => u.unitType === 'distillation' && u.inletMassKgH > 0.01);
            const allColsOk = colUnits.every(u => {
              const dr = u.distillResult;
              if (!dr) return true;
              if (!dr.converged) return false;
              if (dr.shortcutDesign && !dr.shortcutDesign.designMet) return false;
              if (dr.spec1Status?.enabled && !dr.spec1Status.met) return false;
              if (dr.spec2Status?.enabled && !dr.spec2Status.met) return false;
              return true;
            });
            const convOverall = solved.convergence.overallStatus ?? (solved.convergence.converged ? 'converged' : 'failed');
            const hasColIssue = !allColsOk;
            const effectiveStatus: 'dirty' | 'converged' | 'warning' | 'failed' =
              isSimDirty || solved.convergence.isIdle
                ? 'dirty'
                : convOverall === 'failed'
                  ? 'failed'
                  : convOverall === 'converged_with_warnings' || hasColIssue
                    ? 'warning'
                    : 'converged';

            return (
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  disabled={isSimRunning}
                  onClick={() => runSimulationNow()}
                  title="변경된 유량·온도·순도·환류비 조건으로 공정 전체 물질수지 및 다단 MESH 증류를 수렴 실행합니다 (단축키: F5 또는 Ctrl+Enter)"
                  style={{
                    padding: '4px 11px',
                    borderRadius: 5,
                    border: '1px solid #1E3A8A',
                    background: isSimRunning ? '#475569' : '#1E3A8A',
                    color: '#FFFFFF',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: isSimRunning ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {isSimRunning ? (
                    '계산 중...'
                  ) : (
                    <>
                      <span>▶ RUN (F5)</span>
                      {isSimDirty && (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: '#F59E0B',
                            display: 'inline-block',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowConvDiag(v => !v)}
                  title="클릭하여 장치별 수렴 판정, 순환 루프(Tear) 잔차, 보충 유입 및 종합 수지 상세 보고서를 확인합니다."
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: '#1E293B',
                    background: '#F8FAFC',
                    border: '1px solid #CBD5E1',
                    borderRadius: 5,
                    padding: '3px 8px',
                    fontFamily: 'JetBrains Mono, monospace',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background:
                        effectiveStatus === 'converged'
                          ? '#10B981'
                          : effectiveStatus === 'failed'
                            ? '#DC2626'
                            : '#D97706',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span>
                    {effectiveStatus === 'dirty'
                      ? solved.convergence.isIdle
                        ? '실행 대기 (▶ RUN)'
                        : '조건 변경됨'
                      : effectiveStatus === 'converged'
                        ? `수렴 (${solved.convergence.iterations}회·${solvedMeta.elapsedMs}ms) ▾`
                        : effectiveStatus === 'warning'
                          ? `경고 동반 수렴 (${solved.convergence.warningUnitCount ?? 0}건) ▾`
                          : `미수렴 (${solved.convergence.failedUnitCount ?? 1}건 실패) ▾`}
                  </span>
                </button>

                {showConvDiag && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      left: 0,
                      zIndex: 1200,
                      width: 'min(92vw, 440px)',
                    }}
                  >
                    <ConvergenceReportPanel
                      convergence={solved.convergence}
                      balance={solved.balance}
                      elapsedMs={solvedMeta.elapsedMs}
                      onClose={() => setShowConvDiag(false)}
                      onSelectNode={id => setSelectedNodeId(id)}
                    />
                  </div>
                )}
              </div>
            );
          })()}

          {/* 전체 장치 일괄 모드 전환 스위치 */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
            }}
            title="모든 공정 계산 장치를 간편 발란스 모드 또는 정밀 열역학(Rigorous) 모드로 일괄 전환합니다"
          >
            <button
              onClick={() => setAllUnitsCalcMode('simple')}
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: '3px 6px',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: '#475569',
                whiteSpace: 'nowrap',
              }}
            >
              간편
            </button>
            <span style={{ color: '#CBD5E1', fontSize: 10 }}>|</span>
            <button
              onClick={() => setAllUnitsCalcMode('rigorous')}
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: '3px 6px',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: '#1E3A8A',
                whiteSpace: 'nowrap',
              }}
            >
              정밀
            </button>
          </div>

          {(isPlantSimMode || Object.keys(hierarchySheets).length > 1) && (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10.5,
                fontWeight: 700,
                color: boundarySyncEnabled ? '#0F172A' : '#64748B',
                padding: '2px 4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="활성화 시 상위 도면의 유입 유량·온도·압력이 하위 세부공정 입구(BOUND-*)에 실시간 주입됩니다."
            >
              <input
                type="checkbox"
                checked={boundarySyncEnabled}
                onChange={e => setBoundarySyncEnabled(e.target.checked)}
                style={{ margin: 0 }}
              />
              상하위연동
            </label>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', flexShrink: 0 }}>
          {/* 실행취소(↶) / 다시실행(↷) 버튼 */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <button
              type="button"
              disabled={!canUndo}
              onClick={handleUndo}
              title="실행취소 (Ctrl+Z)"
              aria-label="실행취소 (Ctrl+Z)"
              style={{
                padding: '3px 7px',
                fontSize: 13,
                lineHeight: 1.1,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: canUndo ? '#FFFFFF' : '#F8FAFC',
                color: canUndo ? '#1E293B' : '#94A3B8',
                opacity: canUndo ? 1 : 0.45,
                cursor: canUndo ? 'pointer' : 'not-allowed',
              }}
            >
              ↶
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={handleRedo}
              title="다시실행 (Ctrl+Y)"
              aria-label="다시실행 (Ctrl+Y)"
              style={{
                padding: '3px 7px',
                fontSize: 13,
                lineHeight: 1.1,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: canRedo ? '#FFFFFF' : '#F8FAFC',
                color: canRedo ? '#1E293B' : '#94A3B8',
                opacity: canRedo ? 1 : 0.45,
                cursor: canRedo ? 'pointer' : 'not-allowed',
              }}
            >
              ↷
            </button>
          </div>

          {lastSavedTime && (
            <span
              title={`로컬 자동저장 완료 (${lastSavedTime})`}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#64748B',
                fontFamily: 'JetBrains Mono, monospace',
                whiteSpace: 'nowrap',
              }}
            >
              저장됨
            </span>
          )}

          <button
            onClick={() => setPaletteOpen(v => !v)}
            title="공정도 하단에 종류별로 정리된 가로형 장치 모델 팔레트 바를 열거나 접습니다."
            style={{
              padding: '3px 8px',
              fontSize: 10.5,
              fontWeight: 700,
              borderRadius: 5,
              cursor: 'pointer',
              border: paletteOpen ? '1px solid #64748B' : '1px solid #CBD5E1',
              background: paletteOpen ? '#F1F5F9' : '#FFFFFF',
              color: '#1E293B',
              whiteSpace: 'nowrap',
            }}
          >
            {paletteOpen ? '▼ 팔레트' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><PlusSquareIcon size={11} /> 팔레트</span>}
          </button>

          {isPlantSimMode ? (
            <button
              onClick={() => activateFullPlantPackage(true)}
              title={
                isHcl1AMode
                  ? '1A 초고순도·무수 염산 및 폐염산 PSD 회수 전공정 도면을 초기 설계값으로 복원합니다.'
                  : isEchGteMode
                    ? '70,000 TPA (8.75 t/h) ECH (GTE 글리세린 공정) 전공정 도면을 초기 설계값으로 복원합니다.'
                    : isCmsMode
                      ? '66,000 TPA (MCL 120 + CFM 80 T/D) 클로로메탄(CMS) 전공정 도면을 초기 설계값으로 복원합니다.'
                      : isMdiMode
                        ? '100,000 TPA (Pure MDI 108 + PMDI 192 T/D) MDI 전공정 도면을 초기 설계값으로 복원합니다.'
                        : '468 T/D 전해공장 마스터 및 10개 세부 공정 도면을 초기 설계값으로 복원합니다.'
              }
              style={{
                padding: '3px 8px',
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 5,
                cursor: 'pointer',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                whiteSpace: 'nowrap',
              }}
            >
              ↺ 초기값 복원
            </button>
          ) : (
            <>
              <select
                value={getAllPresets().some(p => p.id === presetId) ? presetId : ''}
                onChange={e => {
                  const found = getAllPresets().find(p => p.id === e.target.value);
                  if (found) loadPreset(found);
                }}
                style={{
                  padding: '3px 7px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 5,
                  maxWidth: 235,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#1E293B',
                  cursor: 'pointer',
                }}
              >
                <option value="" disabled>
                  공정 프리셋 불러오기...
                </option>
                <optgroup label="기본 자유설계 템플릿">
                  {getAllPresets()
                    .filter(p => p.group === 'general' && (!isSimulatorOnlyUser(user) || p.isPublicTextbook))
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.btnLabel}
                      </option>
                    ))}
                </optgroup>
                {isPlantAllowed(PLANT_GROUP_TO_ID.electrolysis, user) && (
                  <optgroup label={formatPlantLabelForUser('PLANT 01 전해공장 — 단위공정 단독 프리셋', user)}>
                    {getAllPresets()
                      .filter(p => p.group === 'plant02')
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.btnLabel}
                        </option>
                      ))}
                  </optgroup>
                )}
                {isPlantAllowed(PLANT_GROUP_TO_ID.hcl1A, user) && (
                  <optgroup label={formatPlantLabelForUser('PLANT 02 1A 염산·회수 — 단위공정 단독 프리셋', user)}>
                    {getAllPresets()
                      .filter(p => p.group === 'plant03')
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.btnLabel}
                        </option>
                      ))}
                  </optgroup>
                )}
                {isPlantAllowed(PLANT_GROUP_TO_ID.ech, user) && (
                  <optgroup label={formatPlantLabelForUser('PLANT 03 바이오 ECH — 단위공정 단독 프리셋', user)}>
                    {getAllPresets()
                      .filter(p => p.group === 'plant04')
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.btnLabel}
                        </option>
                      ))}
                  </optgroup>
                )}
                {isPlantAllowed(PLANT_GROUP_TO_ID.cms, user) && (
                  <optgroup label={formatPlantLabelForUser('PLANT 04 클로로메탄(CMS) — 단위공정 단독 프리셋', user)}>
                    {getAllPresets()
                      .filter(p => p.group === 'plant05')
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.btnLabel}
                        </option>
                      ))}
                  </optgroup>
                )}
                {isPlantAllowed(PLANT_GROUP_TO_ID.mdi, user) && (
                  <optgroup label={formatPlantLabelForUser('PLANT 05 · MDI 통합 공정 — 단위공정 단독 프리셋', user)}>
                    {getAllPresets()
                      .filter(p => p.group === 'plant06')
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {p.btnLabel}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>

              <button
                onClick={clearCanvas}
                style={{
                  padding: '3px 8px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 5,
                  cursor: 'pointer',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#1E293B',
                  whiteSpace: 'nowrap',
                }}
              >
                + 빈 캔버스
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setCompSetupModalOpen(true)}
            title={`공정 성분 및 열역학 모델 설정 — 추천: ${autoPropertyRecommendation.method} (${autoPropertyRecommendation.reasonKo})`}
            style={{
              padding: '3px 9px',
              fontSize: 10.5,
              fontWeight: 700,
              borderRadius: 5,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#1E293B',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FlaskCompIcon size={11} /> 성분 ({activeComponents.length}종)</span>
            <span style={{ color: '#CBD5E1' }}>|</span>
            <span>
              <SlidersParamIcon size={11} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 4 }} />
              {propertyMethod === 'AUTO'
                ? `자동(${solved.propertyMethodUsed ?? autoPropertyRecommendation.method})`
                : propertyMethod}{' '}
              ▾
            </span>
          </button>

          <button
            type="button"
            onClick={() => setOptModalOpen(true)}
            title="플로우시트 목표역산 제어기(Design Spec), 다변수 민감도 분석(Sensitivity), Broyden/Wegstein 리사이클 수렴기 설정"
            style={{
              padding: '3px 9px',
              fontSize: 10.5,
              fontWeight: 700,
              borderRadius: 5,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#1E293B',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><SpecControlIcon size={11} /> 목표역산 · 민감도</span>
            {designSpecs.filter(s => s.enabled).length > 0 && (
              <span
                style={{
                  padding: '0 5px',
                  borderRadius: 999,
                  background: '#1E3A8A',
                  color: '#FFFFFF',
                  fontSize: 9.5,
                  fontWeight: 900,
                }}
              >
                {designSpecs.filter(s => s.enabled).length}
              </span>
            )}
          </button>

          <CaseOutputsMenu compact unitCount={simDefs.length} />

          <button
            onClick={() => setInspectorOpen(v => !v)}
            title="우측 장치/배관 상세 속성 편집 패널을 열거나 접어 도면 화면을 넓힙니다."
            style={{
              padding: '3px 8px',
              fontSize: 10.5,
              fontWeight: 700,
              borderRadius: 5,
              cursor: 'pointer',
              border: inspectorOpen ? '1px solid #64748B' : '1px solid #CBD5E1',
              background: inspectorOpen ? '#F1F5F9' : '#FFFFFF',
              color: '#1E293B',
              whiteSpace: 'nowrap',
            }}
          >
            {inspectorOpen ? '속성창 ▸' : '◂ 속성창'}
          </button>
        </div>
      </div>
      )}

      {/* ── 단독 플로우시트 빌더에서만 사용자가 커스텀 하위시트를 만든 경우 1줄 탭 표시 (PLANT 02는 좌측 사이드 패널과 중복되므로 생략!) ── */}
      {!embeddedInPlant && Object.keys(hierarchySheets).length > 1 && (
        <div
          className="no-scrollbar"
          style={{
            height: 28,
            padding: '0 12px',
            background: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'nowrap',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            flexShrink: 0,
          }}
        >
          {Object.keys(hierarchySheets).map(sheetId => {
            const sh = hierarchySheets[sheetId];
            const isActive = activeSheetId === sheetId;
            return (
              <button
                key={sheetId}
                onClick={() => navigateToHierarchySheet(sheetId)}
                style={{
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: isActive ? 900 : 700,
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: isActive ? '1.5px solid #4338CA' : '1px solid #CBD5E1',
                  background: isActive ? '#4338CA' : '#FFFFFF',
                  color: isActive ? '#FFFFFF' : '#334155',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {sh.shortTabLabel}
              </button>
            );
          })}
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
      {showStorageBar && (
        <div
          style={{
            padding: '8px 14px',
            background: '#F8FAFC',
            borderBottom: '1px solid #CBD5E1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#1E293B' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SaveArchiveIcon size={13} /> 다른 이름으로 저장</span>
            </span>
            <input
              type="text"
              value={projectNameInput}
              onChange={e => setProjectNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveNamedProject();
              }}
              placeholder="새 케이스 이름 입력 (예: ECH 2탑 테스트)"
              style={{
                height: 27,
                padding: '0 9px',
                fontSize: 11,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#0F172A',
                minWidth: 220,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={saveNamedProject}
              style={{
                height: 27,
                padding: '0 12px',
                fontSize: 11,
                fontWeight: 800,
                borderRadius: 5,
                border: '1px solid #1E3A8A',
                background: '#1E3A8A',
                color: '#FFFFFF',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              저장
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleExportProcessText}
              title="현재 공정 플로우시트를 텍스트(.inp) 파일로 내보내기"
              style={{
                height: 27,
                padding: '0 9px',
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><DownloadFileIcon size={12} /> .inp 내보내기</span>
            </button>
            <button
              type="button"
              onClick={exportJsonFile}
              style={{
                height: 27,
                padding: '0 9px',
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#1E293B',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><DownloadFileIcon size={12} /> JSON 파일 내보내기</span>
            </button>
            <button
              type="button"
              onClick={() => setShowStorageBar(false)}
              title="저장 바 닫기"
              style={{
                height: 27,
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
            padding: '6px 14px',
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
                참고: {interopNotice.warnings.slice(0, 3).join(' / ')}
                {interopNotice.warnings.length > 3 ? ` 외 ${interopNotice.warnings.length - 3}건` : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setInteropNotice(null)}
            title="알림 닫기"
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

      {/* ── 메인 워크스페이스 (중앙 풀폭 캔버스 + 하단 가로형 장치모델 팔레트 + 스트림표 | 우측 슬림 속성창) ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 1) 중앙: 플로우시트 캔버스 + 하단 가로형 카테고리 장치 팔레트 + 드래그 분할바 + 스트림 테이블 */}
        <div
          ref={centerSplitRef}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
        >
          {layoutMode !== 'table' && (
            <div
              ref={rfWrapperRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onMouseDown={handleCanvasMouseDown}
              onContextMenu={handleCanvasContextMenu}
              style={{ flex: '1 1 0%', minHeight: 0, position: 'relative', overflow: 'hidden' }}
            >
              <ReactFlow
                nodes={displayNodes}
                edges={displayEdges}
                nodeTypes={NODE_TYPES}
                connectionMode={ConnectionMode.Loose}
                selectionKeyCode={['Control', 'Meta', 'Shift']}
                multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
                selectionMode={SelectionMode.Partial}
                edgesUpdatable
                onInit={inst => {
                  setRfInstance(inst);
                  if (typeof window !== 'undefined' && window.innerWidth <= 768) {
                    setTimeout(() => inst.fitView({ padding: 0.1, duration: 220 }), 140);
                  }
                }}
                onNodesChange={onNodesChange}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onEdgeUpdate={onEdgeUpdate}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId(null);
                }}
                onNodeDoubleClick={(_, node) => {
                  const d = simDefs.find(x => x.id === node.id);
                  if (d?.subSheetId && hierarchySheets[d.subSheetId]) {
                    navigateToHierarchySheet(d.subSheetId);
                  } else if (d?.unitType === 'distillation') {
                    setSelectedNodeId(d.id);
                    setSelectedEdgeId(null);
                    setDistillModalInitialView('simulation');
                    setDistillModalNodeId(d.id);
                  } else if (
                    d?.unitType === 'hex' ||
                    d?.unitType === 'cooler' ||
                    d?.unitType === 'liquefier'
                  ) {
                    setSelectedNodeId(d.id);
                    setSelectedEdgeId(null);
                    setHxModalInitialView('thermal');
                    setHxModalNodeId(d.id);
                  }
                }}
                onEdgeClick={(_, edge) => {
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeId(null);
                }}
                onPaneClick={() => {
                  setSelectedEdgeId(null);
                }}
                onNodesDelete={deleted => {
                  if (deleted.length === 0) return;
                  const beforePos = extractCurrentPositions(liveRfNodesRef.current);
                  deleted.forEach(n => {
                    if (!beforePos[n.id]) {
                      beforePos[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
                    }
                  });
                  const beforeSnap = cloneHistorySnapshot(
                    liveSimDefsRef.current,
                    beforePos,
                    liveFlowEdgesRef.current
                  );
                  pushUndoSnapshot(beforeSnap);
                  lastDeleteUndoTsRef.current = Date.now();
                  const delSet = new Set(deleted.map(n => n.id));
                  setSimDefs(prev => prev.filter(d => !delSet.has(d.id)));
                  setFlowEdges(prev => prev.filter(e => !delSet.has(e.source) && !delSet.has(e.target)));
                  setSelectedNodeId(prev => (prev && delSet.has(prev) ? null : prev));
                }}
                onEdgesDelete={deleted => {
                  if (deleted.length === 0) return;
                  if (Date.now() - lastDeleteUndoTsRef.current >= 80) {
                    pushUndoSnapshot();
                  }
                  const delSet = new Set(deleted.map(d => d.id));
                  setFlowEdges(prev => prev.filter(e => !delSet.has(e.id)));
                  setSelectedEdgeId(null);
                }}
                deleteKeyCode={['Delete', 'Backspace']}
                fitView
                fitViewOptions={{ padding: 0.14 }}
              >
                <Background color="#E2E8F0" gap={22} />
                <Controls
                  position="bottom-right"
                  style={
                    isMobile
                      ? { marginBottom: (selectedDef || selectedEdgeDef) && !inspectorOpen ? 68 : 28 }
                      : undefined
                  }
                />
              </ReactFlow>

              {/* 우클릭 드래그 마키(Box) 다중선택 사각형 */}
              {rmbSelectBox && (
                <div
                  style={{
                    position: 'absolute',
                    left: Math.min(rmbSelectBox.startX, rmbSelectBox.curX),
                    top: Math.min(rmbSelectBox.startY, rmbSelectBox.curY),
                    width: Math.abs(rmbSelectBox.curX - rmbSelectBox.startX),
                    height: Math.abs(rmbSelectBox.curY - rmbSelectBox.startY),
                    background: 'rgba(37, 99, 235, 0.12)',
                    border: '1.5px solid #2563EB',
                    borderRadius: 2,
                    pointerEvents: 'none',
                    zIndex: 40,
                  }}
                />
              )}

              {/* 모바일 전용: 미선택 시 하단 터치 안내 배지 */}
              {isMobile && !inspectorOpen && !selectedDef && !selectedEdgeDef && !paletteOpen && (
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 8,
                    transform: 'translateX(-50%)',
                    zIndex: 25,
                    background: 'rgba(26, 47, 68, 0.86)',
                    color: '#F8FAFC',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    boxShadow: '0 4px 12px rgba(15,23,42,0.22)',
                  }}
                >
                  장치·배관 터치 시 하단 운전조건 시트 열림 · 두 손가락 확대/이동
                </div>
              )}

              {/* 모바일 전용: 장치/배관 선택 시 하단 플로팅 퀵 액션 바 (도면을 가리지 않고 1탭으로 시트/설계 오픈) */}
              {isMobile && !inspectorOpen && (selectedDef || selectedEdgeDef) && (() => {
                const selEdgeSt = selectedEdgeDef ? streamResultMap.get(selectedEdgeDef.id) : undefined;
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: 8,
                      right: 8,
                      bottom: 8,
                      zIndex: 35,
                      background: '#FFFFFF',
                      border: '1.5px solid #1A2F44',
                      borderRadius: 12,
                      padding: '8px 10px',
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.24)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div
                      onClick={() => setInspectorOpen(true)}
                      style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    >
                      {selectedDef ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                            <span
                              style={{
                                background: '#1A2F44',
                                color: '#FFFFFF',
                                fontSize: 10,
                                fontWeight: 900,
                                fontFamily: 'JetBrains Mono, monospace',
                                padding: '1px 6px',
                                borderRadius: 4,
                                flexShrink: 0,
                              }}
                            >
                              {formatEquipmentTag(selectedDef.tag, selectedDef.unitType, tagStandard)}
                            </span>
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 800,
                                color: '#0F172A',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {selectedDef.name}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: '#475569',
                              marginTop: 2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {selectedUnitRes
                              ? `${selectedUnitRes.detectedFluidLabel} · 유입 ${formatCanonicalValue('massFlow', selectedUnitRes.inletMassKgH, globalUnits.massFlow)} ${getUnitLabel('massFlow', globalUnits.massFlow)}`
                              : '터치하여 운전조건 및 설계 열기'}
                          </div>
                        </>
                      ) : selectedEdgeDef ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                            <span
                              style={{
                                background: '#92400E',
                                color: '#FFFFFF',
                                fontSize: 10,
                                fontWeight: 900,
                                fontFamily: 'JetBrains Mono, monospace',
                                padding: '1px 6px',
                                borderRadius: 4,
                                flexShrink: 0,
                              }}
                            >
                              {selectedEdgeDef.streamNo}
                            </span>
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 800,
                                color: '#0F172A',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {selectedEdgeDef.name || '공정 배관 스트림'}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: '#475569',
                              fontFamily: 'JetBrains Mono, monospace',
                              marginTop: 2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {selEdgeSt
                              ? `${formatCanonicalValue('massFlow', selEdgeSt.totalMassKgH, globalUnits.massFlow)} ${getUnitLabel('massFlow', globalUnits.massFlow)} · ${formatCanonicalValue('temp', selEdgeSt.tempC, globalUnits.temp, 1)}${getUnitLabel('temp', globalUnits.temp)} · ${formatCanonicalValue('pressG', selEdgeSt.pressKgcm2g, globalUnits.pressG, 2)} ${getUnitLabel('pressG', globalUnits.pressG)}`
                              : '터치하여 배관 속성 열기'}
                          </div>
                        </>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {selectedDef?.subSheetId && hierarchySheets[selectedDef.subSheetId] && (
                        <button
                          onClick={() => navigateToHierarchySheet(selectedDef.subSheetId!)}
                          style={{
                            padding: '6px 8px',
                            fontSize: 10.5,
                            fontWeight: 800,
                            borderRadius: 7,
                            border: '1px solid #94A3B8',
                            background: '#FFFFFF',
                            color: '#0F172A',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><SubprocessTreeIcon size={11} /> 세부공정</span>
                        </button>
                      )}
                      {selectedDef?.unitType === 'distillation' && (
                        <button
                          onClick={() => {
                            setDistillModalInitialView('simulation');
                            setDistillModalNodeId(selectedDef.id);
                          }}
                          style={{
                            padding: '6px 8px',
                            fontSize: 10.5,
                            fontWeight: 800,
                            borderRadius: 7,
                            border: '1px solid #94A3B8',
                            background: '#FFFFFF',
                            color: '#0F172A',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><ColumnInternalIcon size={11} /> 컬럼설계</span>
                        </button>
                      )}
                      {(selectedDef?.unitType === 'hex' ||
                        selectedDef?.unitType === 'cooler' ||
                        selectedDef?.unitType === 'liquefier') && (
                        <button
                          onClick={() => {
                            setHxModalInitialView('thermal');
                            setHxModalNodeId(selectedDef.id);
                          }}
                          style={{
                            padding: '6px 8px',
                            fontSize: 10.5,
                            fontWeight: 800,
                            borderRadius: 7,
                            border: '1px solid #94A3B8',
                            background: '#FFFFFF',
                            color: '#0F172A',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><HexCircleIcon size={11} /> 열교환설계</span>
                        </button>
                      )}
                      <button
                        onClick={() => setInspectorOpen(true)}
                        style={{
                          padding: '6px 10px',
                          fontSize: 10.5,
                          fontWeight: 900,
                          borderRadius: 7,
                          border: 'none',
                          background: '#1A2F44',
                          color: '#FFFFFF',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><SlidersParamIcon size={11} /> 조건 ▲</span>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedNodeId(null);
                          setSelectedEdgeId(null);
                        }}
                        style={{
                          padding: '5px 7px',
                          fontSize: 11,
                          fontWeight: 800,
                          borderRadius: 7,
                          border: '1px solid #CBD5E1',
                          background: '#F8FAFC',
                          color: '#64748B',
                          cursor: 'pointer',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* 공정도 하단 가로형 카테고리 장치 모델 팔레트 독 (Model Palette Dock) */}
          {paletteOpen && layoutMode !== 'table' && (
            <div
              style={{
                flexShrink: 0,
                background: '#FFFFFF',
                borderTop: '1.5px solid #D8D5CD',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: isMobile ? '38dvh' : undefined,
                overflowY: isMobile ? 'auto' : undefined,
              }}
            >
              {/* 상단 카테고리 탭 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  padding: '3px 10px',
                  background: '#F3F1EC',
                  borderBottom: '1px solid #E5E2DC',
                  overflowX: 'auto',
                  scrollbarWidth: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', flexShrink: 0 }}>
                  {PALETTE_GROUPS.map(g => {
                    const active = paletteCategory === g.key;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setPaletteCategory(g.key)}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 5,
                          fontSize: 10.5,
                          fontWeight: active ? 900 : 700,
                          color: active ? '#FFFFFF' : '#334155',
                          background: active ? '#1A2F44' : '#FFFFFF',
                          border: active ? '1px solid #1A2F44' : '1px solid #D5D2C9',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(false)}
                  title="장치 팔레트 접기"
                  style={{
                    padding: '1.5px 7px',
                    borderRadius: 4,
                    fontSize: 9.5,
                    fontWeight: 800,
                    color: '#475569',
                    background: '#E2E8F0',
                    border: '1px solid #CBD5E1',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  ✕ 접기
                </button>
              </div>

              {/* 클래식 CAD 아이콘 팔레트 스트립 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 10px',
                  overflowX: 'auto',
                  background: '#FAF9F5',
                }}
              >
                <div
                  draggable
                  onDragStart={e => handleDragStart(e, 'feed')}
                  onClick={() => spawnUnitAtPosition('feed')}
                  title="유입 물질 스트림"
                  style={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    minWidth: 50,
                    padding: '3px 7px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    cursor: 'grab',
                    flexShrink: 0,
                    userSelect: 'none',
                  }}
                >
                  <ClassicUnitSvg unitType="feed" size={26} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', whiteSpace: 'nowrap', lineHeight: 1.1 }}>유입</span>
                </div>

                <div
                  draggable
                  onDragStart={e => handleDragStart(e, 'product')}
                  onClick={() => spawnUnitAtPosition('product')}
                  title="유출 물질 스트림"
                  style={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    minWidth: 50,
                    padding: '3px 7px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    cursor: 'grab',
                    flexShrink: 0,
                    userSelect: 'none',
                  }}
                >
                  <ClassicUnitSvg unitType="product" size={26} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', whiteSpace: 'nowrap', lineHeight: 1.1 }}>유출</span>
                </div>

                <div style={{ width: 1, height: 34, background: '#CBD5E1', margin: '0 2px', flexShrink: 0 }} />

                {activePaletteItems
                  .filter(u => u.type !== 'feed' && u.type !== 'product')
                  .map(u => {
                    const isVis = u.category === 'visual';
                    return (
                      <div
                        key={u.type}
                        draggable
                        onDragStart={e => handleDragStart(e, u.type)}
                        onClick={() => spawnUnitAtPosition(u.type)}
                        title={u.desc}
                        style={{
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 2,
                          minWidth: 56,
                          padding: '3px 8px',
                          borderRadius: 6,
                          border: isVis ? '1px dashed #CBD5E1' : '1px solid #CBD5E1',
                          background: '#FFFFFF',
                          cursor: 'grab',
                          flexShrink: 0,
                          userSelect: 'none',
                        }}
                      >
                        <ClassicUnitSvg unitType={u.type} size={26} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: isVis ? '#64748B' : '#1E293B', whiteSpace: 'nowrap', lineHeight: 1.1 }}>
                          {SHORT_CLASSIC_PALETTE_LABEL[u.type] ?? u.label}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* 상·하단 드래그 높이 조절 분할 핸들 (분할 모드일 때 활성화) */}
          {layoutMode === 'split' && (
            <div
              onMouseDown={startResizeSplit}
              title="위·아래로 드래그하여 공정도와 스트림 테이블 높이를 자유롭게 조절하세요"
              style={{
                height: 7,
                background: '#1A2F44',
                cursor: 'ns-resize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              <div style={{ width: 38, height: 2.5, borderRadius: 2, background: '#94A3B8' }} />
            </div>
          )}

          {/* 하단 실시간 스트림 테이블 & 장치 수지 요약 */}
          <div
            style={{
              height:
                layoutMode === 'canvas'
                  ? 30
                  : layoutMode === 'table'
                    ? '100%'
                    : `${streamHeightPct}%`,
              flex: layoutMode === 'table' ? 1 : undefined,
              minHeight: layoutMode === 'canvas' ? 30 : 140,
              maxHeight: layoutMode === 'split' ? '78%' : undefined,
              background: '#FFFFFF',
              borderTop: layoutMode === 'split' ? 'none' : '2px solid #1A2F44',
              display: isMobile && layoutMode === 'canvas' ? 'none' : 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            <div
              className="no-scrollbar"
              style={{
                height: 30,
                minHeight: 30,
                padding: '0 10px',
                background: '#EFF1EC',
                borderBottom: layoutMode === 'canvas' ? 'none' : '1px solid #E5E2DC',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'nowrap',
                overflowX: 'auto',
                scrollbarWidth: 'none',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={() => {
                    setBottomTab('streams');
                    if (layoutMode === 'canvas') setLayoutMode('split');
                  }}
                  style={{
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 800,
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: 'none',
                    background: bottomTab === 'streams' ? '#1A2F44' : 'transparent',
                    color: bottomTab === 'streams' ? '#FFFFFF' : '#475569',
                    whiteSpace: 'nowrap',
                  }}
                >
                  가로형 H&MB 스트림 테이블 ({solved.streams.length})
                </button>
                <button
                  onClick={() => {
                    setBottomTab('units');
                    if (layoutMode === 'canvas') setLayoutMode('split');
                  }}
                  style={{
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 800,
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: 'none',
                    background: bottomTab === 'units' ? '#1A2F44' : 'transparent',
                    color: bottomTab === 'units' ? '#FFFFFF' : '#475569',
                    whiteSpace: 'nowrap',
                  }}
                >
                  장치 요약 ({solved.units.length})
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() =>
                    setLayoutMode(prev => (prev === 'canvas' ? 'split' : prev === 'split' ? 'table' : 'split'))
                  }
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    fontWeight: 800,
                    borderRadius: 4,
                    border: '1px solid #94A3B8',
                    background: layoutMode === 'table' ? '#1A2F44' : '#FFFFFF',
                    color: layoutMode === 'table' ? '#FFFFFF' : '#1A2F44',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {layoutMode === 'canvas' ? '시트 펼치기 ▲' : layoutMode === 'table' ? '분할 보기로 복귀 ▼' : '시트 전체화면 ▲'}
                </button>
              </div>
            </div>

            {layoutMode !== 'canvas' && (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: !isMobile && bottomTab === 'streams' ? 'hidden' : 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {isMobile && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 8px',
                      background: '#F8FAFC',
                      borderBottom: '1px solid #E2E8F0',
                      flexShrink: 0,
                    }}
                  >
                    <input
                      type="text"
                      value={mobileSearch}
                      onChange={e => setMobileSearch(e.target.value)}
                      placeholder={
                        bottomTab === 'streams'
                          ? '스트림 번호 · 연결장치 · 성분 검색...'
                          : '장치 태그 · 장치명 · 유체 검색...'
                      }
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: 30,
                        padding: '0 9px',
                        fontSize: 11.5,
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#0F172A',
                        outline: 'none',
                      }}
                    />
                    <div
                      style={{
                        display: 'flex',
                        background: '#E2E8F0',
                        borderRadius: 6,
                        padding: 2,
                        flexShrink: 0,
                      }}
                    >
                      <button
                        onClick={() => setMobileCardView(true)}
                        style={{
                          padding: '4px 7px',
                          fontSize: 10.5,
                          fontWeight: 800,
                          borderRadius: 4,
                          border: 'none',
                          background: mobileCardView ? '#1A2F44' : 'transparent',
                          color: mobileCardView ? '#FFFFFF' : '#475569',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CardsStackIcon size={11} /> 카드형</span>
                      </button>
                      <button
                        onClick={() => setMobileCardView(false)}
                        style={{
                          padding: '4px 7px',
                          fontSize: 10.5,
                          fontWeight: 800,
                          borderRadius: 4,
                          border: 'none',
                          background: !mobileCardView ? '#1A2F44' : 'transparent',
                          color: !mobileCardView ? '#FFFFFF' : '#475569',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><TableGridIcon size={11} /> 표 보기</span>
                      </button>
                    </div>
                  </div>
                )}

                {isMobile && mobileCardView ? (
                  bottomTab === 'streams' ? (
                    <div
                      style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: '8px 8px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        background: '#F6F7F2',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          flexWrap: 'wrap',
                          padding: '5px 8px',
                          background: '#FFFFFF',
                          border: '1px solid #D8D5CD',
                          borderRadius: 8,
                        }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>표시 단위</span>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <UnitSelect quantity="massFlow" value={mobileMassUnit} onChange={setMobileMassUnit} size="xs" />
                          <UnitSelect quantity="temp" value={mobileTempUnit} onChange={setMobileTempUnit} size="xs" />
                          <UnitSelect quantity="pressG" value={mobilePressUnit} onChange={setMobilePressUnit} size="xs" />
                        </div>
                      </div>
                      {solved.streams
                        .filter(st => {
                          const q = mobileSearch.trim().toLowerCase();
                          if (!q) return true;
                          const ed = flowEdges.find(e => e.id === st.edgeId);
                          const srcDefF = ed ? simDefs.find(d => d.id === ed.source) : undefined;
                          const dstDefF = ed ? simDefs.find(d => d.id === ed.target) : undefined;
                          const srcTag = srcDefF ? formatEquipmentTag(srcDefF.tag, srcDefF.unitType, tagStandard) : (ed?.source ?? '');
                          const dstTag = dstDefF ? formatEquipmentTag(dstDefF.tag, dstDefF.unitType, tagStandard) : (ed?.target ?? '');
                          const comps = Object.entries(st.flowsKgH)
                            .filter(([, v]) => v > 0.05)
                            .map(([k]) => k)
                            .join(' ');
                          return `${st.streamNo} ${ed?.name ?? ''} ${srcTag} ${dstTag} ${comps}`
                            .toLowerCase()
                            .includes(q);
                        })
                        .map(st => {
                          const ed = flowEdges.find(e => e.id === st.edgeId);
                          const srcDef = ed ? simDefs.find(d => d.id === ed.source) : undefined;
                          const dstDef = ed ? simDefs.find(d => d.id === ed.target) : undefined;
                          const topComps = (Object.entries(st.flowsKgH) as [string, number][])
                            .filter(([, v]) => v > 0.05)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 6);
                          const isSel = st.edgeId === selectedEdgeId;
                          return (
                            <div
                              key={st.edgeId}
                              style={{
                                background: '#FFFFFF',
                                border: isSel ? '2px solid #92400E' : '1px solid #D8D5CD',
                                borderRadius: 10,
                                padding: '9px 10px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                boxShadow: '0 1px 4px rgba(15,23,42,0.05)',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                  <span
                                    style={{
                                      background: '#92400E',
                                      color: '#FFFFFF',
                                      fontSize: 10.5,
                                      fontWeight: 900,
                                      fontFamily: 'JetBrains Mono, monospace',
                                      padding: '2px 7px',
                                      borderRadius: 5,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {st.streamNo}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 800,
                                      color: '#1E293B',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {srcDef ? formatEquipmentTag(srcDef.tag, srcDef.unitType, tagStandard) : 'IN'} → {dstDef ? formatEquipmentTag(dstDef.tag, dstDef.unitType, tagStandard) : 'OUT'}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 9.5,
                                      fontWeight: 800,
                                      padding: '1px 5px',
                                      borderRadius: 4,
                                      background: st.phase === 'G' ? '#FEF3C7' : st.phase === 'L/G' ? '#E0E7FF' : '#E0F2FE',
                                      color: st.phase === 'G' ? '#92400E' : st.phase === 'L/G' ? '#3730A3' : '#0369A1',
                                      flexShrink: 0,
                                    }}
                                  >
                                    {st.phase}상
                                  </span>
                                </div>
                                <button
                                  onClick={() => {
                                    setSelectedEdgeId(st.edgeId);
                                    setSelectedNodeId(null);
                                    setInspectorOpen(true);
                                  }}
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    borderRadius: 6,
                                    border: '1px solid #CBD5E1',
                                    background: '#F8FAFC',
                                    color: '#1A2F44',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                  }}
                                >
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><StreamFlowIcon size={11} /> 배관속성</span>
                                </button>
                              </div>

                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                  gap: 5,
                                  background: '#F8FAFC',
                                  border: '1px solid #E2E8F0',
                                  borderRadius: 7,
                                  padding: '5px 7px',
                                  fontFamily: 'JetBrains Mono, monospace',
                                }}
                              >
                                <div>
                                  <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'Inter, sans-serif' }}>총 질량유량</div>
                                  <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                                    {formatCanonicalValue('massFlow', st.totalMassKgH, mobileMassUnit)} {getUnitLabel('massFlow', mobileMassUnit)}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'Inter, sans-serif' }}>온도</div>
                                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#B91C1C' }}>
                                    {formatCanonicalValue('temp', st.tempC, mobileTempUnit, 1)} {getUnitLabel('temp', mobileTempUnit)}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'Inter, sans-serif' }}>압력</div>
                                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1E3A8A' }}>
                                    {formatCanonicalValue('pressG', st.pressKgcm2g, mobilePressUnit, 2)} {getUnitLabel('pressG', mobilePressUnit)}
                                  </div>
                                </div>
                              </div>

                              {topComps.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {topComps.map(([comp, flow]) => {
                                    const wtPct = st.totalMassKgH > 0 ? (flow / st.totalMassKgH) * 100 : 0;
                                    return (
                                      <span
                                        key={comp}
                                        style={{
                                          fontSize: 10,
                                          fontFamily: 'JetBrains Mono, monospace',
                                          background: '#EFF6FF',
                                          border: '1px solid #BFDBFE',
                                          color: '#1E3A8A',
                                          padding: '2px 6px',
                                          borderRadius: 4,
                                          fontWeight: 700,
                                        }}
                                      >
                                        {comp} {wtPct.toFixed(1)}% ({formatCanonicalValue('massFlow', flow, mobileMassUnit)} {getUnitLabel('massFlow', mobileMassUnit)})
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: '8px 8px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        background: '#F6F7F2',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          flexWrap: 'wrap',
                          padding: '5px 8px',
                          background: '#FFFFFF',
                          border: '1px solid #D8D5CD',
                          borderRadius: 8,
                        }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>장치 단위</span>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <UnitSelect quantity="massFlow" value={unitSummaryMassUnit} onChange={setUnitSummaryMassUnit} size="xs" />
                          <UnitSelect quantity="heatDuty" value={unitSummaryDutyUnit} onChange={setUnitSummaryDutyUnit} size="xs" />
                          <UnitSelect quantity="power" value={unitSummaryPowerUnit} onChange={setUnitSummaryPowerUnit} size="xs" />
                        </div>
                      </div>
                      {solved.units
                        .filter(u => {
                          const q = mobileSearch.trim().toLowerCase();
                          if (!q) return true;
                          const nDef = simDefs.find(d => d.id === u.nodeId);
                          const fmtTag = formatEquipmentTag(u.tag, nDef?.unitType, tagStandard);
                          return `${fmtTag} ${u.tag} ${nDef?.name ?? ''} ${u.detectedFluidLabel} ${u.statusNote}`
                            .toLowerCase()
                            .includes(q);
                        })
                        .map(u => {
                          const nDef = simDefs.find(d => d.id === u.nodeId);
                          const fmtTag = formatEquipmentTag(u.tag, nDef?.unitType, tagStandard);
                          const isSel = u.nodeId === selectedNodeId;
                          return (
                            <div
                              key={u.nodeId}
                              style={{
                                background: '#FFFFFF',
                                border: isSel ? '2px solid #0F5338' : '1px solid #D8D5CD',
                                borderRadius: 10,
                                padding: '9px 10px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                boxShadow: '0 1px 4px rgba(15,23,42,0.05)',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                  <span
                                    style={{
                                      background: '#1A2F44',
                                      color: '#FFFFFF',
                                      fontSize: 10.5,
                                      fontWeight: 900,
                                      fontFamily: 'JetBrains Mono, monospace',
                                      padding: '2px 7px',
                                      borderRadius: 5,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {fmtTag}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 11.5,
                                      fontWeight: 800,
                                      color: '#0F172A',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {nDef?.name ?? fmtTag}
                                  </span>
                                </div>
                                <span
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: 800,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: u.isVisualOnly ? '#F1F5F9' : u.calcMode === 'rigorous' ? '#F3E8FF' : '#ECFDF5',
                                    color: u.isVisualOnly ? '#64748B' : u.calcMode === 'rigorous' ? '#5B21B6' : '#0F5338',
                                    flexShrink: 0,
                                  }}
                                >
                                  {u.isVisualOnly ? '도면' : u.calcMode === 'rigorous' ? '정밀열역학' : '간편발란스'}
                                </span>
                              </div>

                              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#0369A1' }}>
                                유입 물질: {u.detectedFluidLabel}
                              </div>

                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                  gap: 5,
                                  background: '#F8FAFC',
                                  border: '1px solid #E2E8F0',
                                  borderRadius: 7,
                                  padding: '5px 7px',
                                  fontFamily: 'JetBrains Mono, monospace',
                                }}
                              >
                                <div>
                                  <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'Inter, sans-serif' }}>
                                    유입 / 유출 ({getUnitLabel('massFlow', unitSummaryMassUnit)})
                                  </div>
                                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#0F172A' }}>
                                    {formatCanonicalValue('massFlow', u.inletMassKgH, unitSummaryMassUnit)} / {formatCanonicalValue('massFlow', u.outletMassKgH, unitSummaryMassUnit)}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'Inter, sans-serif' }}>
                                    열부하 ({getUnitLabel('heatDuty', unitSummaryDutyUnit)})
                                  </div>
                                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#0F172A' }}>
                                    {u.heatDutyKcalH !== 0 ? formatCanonicalValue('heatDuty', u.heatDutyKcalH / 1000, unitSummaryDutyUnit) : '—'}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'Inter, sans-serif' }}>
                                    축동력 ({getUnitLabel('power', unitSummaryPowerUnit)})
                                  </div>
                                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#0F172A' }}>
                                    {u.shaftPowerKW > 0 ? formatCanonicalValue('power', u.shaftPowerKW, unitSummaryPowerUnit) : '—'}
                                  </div>
                                </div>
                              </div>

                              {u.statusNote && (
                                <div style={{ fontSize: 10.5, color: '#334155', lineHeight: 1.4 }}>
                                  {u.statusNote}
                                </div>
                              )}

                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 2 }}>
                                {nDef?.unitType === 'distillation' && (
                                  <button
                                    onClick={() => {
                                      setSelectedNodeId(u.nodeId);
                                      setSelectedEdgeId(null);
                                      setDistillModalInitialView('simulation');
                                      setDistillModalNodeId(u.nodeId);
                                    }}
                                    style={{
                                      padding: '5px 9px',
                                      fontSize: 10.5,
                                      fontWeight: 800,
                                      borderRadius: 6,
                                      border: '1px solid #1D4ED8',
                                      background: '#EFF6FF',
                                      color: '#1E3A8A',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ColumnInternalIcon size={12} /> 내장 컬럼설계</span>
                                  </button>
                                )}
                                {(nDef?.unitType === 'hex' ||
                                  nDef?.unitType === 'cooler' ||
                                  nDef?.unitType === 'liquefier') && (
                                  <button
                                    onClick={() => {
                                      setSelectedNodeId(u.nodeId);
                                      setSelectedEdgeId(null);
                                      setHxModalInitialView('thermal');
                                      setHxModalNodeId(u.nodeId);
                                    }}
                                    style={{
                                      padding: '5px 9px',
                                      fontSize: 10.5,
                                      fontWeight: 800,
                                      borderRadius: 6,
                                      border: '1px solid #0F766E',
                                      background: '#F0FDFA',
                                      color: '#115E59',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><HexCircleIcon size={12} /> 내장 열교환설계</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setSelectedNodeId(u.nodeId);
                                    setSelectedEdgeId(null);
                                    setInspectorOpen(true);
                                  }}
                                  style={{
                                    padding: '5px 10px',
                                    fontSize: 10.5,
                                    fontWeight: 800,
                                    borderRadius: 6,
                                    border: 'none',
                                    background: '#1A2F44',
                                    color: '#FFFFFF',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><SlidersParamIcon size={11} /> 운전조건·속성</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )
                ) : bottomTab === 'streams' ? (
                  <HorizontalFlowsheetStreamTable
                    streams={solved.streams.map(st => {
                      const ed = flowEdges.find(e => e.id === st.edgeId);
                      const srcDef = ed ? simDefs.find(d => d.id === ed.source) : undefined;
                      const dstDef = ed ? simDefs.find(d => d.id === ed.target) : undefined;
                      return {
                        ...st,
                        fromTag: srcDef ? formatEquipmentTag(st.fromTag, srcDef.unitType, tagStandard) : st.fromTag,
                        toTag: dstDef ? formatEquipmentTag(st.toTag, dstDef.unitType, tagStandard) : st.toTag,
                      };
                    })}
                    configuredComps={activeComponents}
                    selectedEdgeId={selectedEdgeId}
                    onSelectStream={edgeId => {
                      setSelectedEdgeId(edgeId);
                      setSelectedNodeId(null);
                    }}
                    onDeleteStream={deleteEdgeById}
                  />
                ) : (
                  <>
                  <FlowsheetBalanceSummary
                    balance={solved.balance}
                    onSelectNode={nid => {
                      setSelectedNodeId(nid);
                      setSelectedEdgeId(null);
                    }}
                  />
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', borderBottom: '1.5px solid #CBD5E1', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>태그</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>계산 모드</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>자동 인식 유입물질</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          유입
                          <UnitSelect quantity="massFlow" value={unitSummaryMassUnit} onChange={setUnitSummaryMassUnit} size="xs" />
                        </span>
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>
                        유출({getUnitLabel('massFlow', unitSummaryMassUnit)})
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>
                        수지오차({getUnitLabel('massFlow', unitSummaryMassUnit)})
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          열부하
                          <UnitSelect quantity="heatDuty" value={unitSummaryDutyUnit} onChange={setUnitSummaryDutyUnit} size="xs" />
                        </span>
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          동력
                          <UnitSelect quantity="power" value={unitSummaryPowerUnit} onChange={setUnitSummaryPowerUnit} size="xs" />
                        </span>
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>운전 · 액화 · 정밀 열역학 진단 요약</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solved.units.map(u => {
                      const nDef = simDefs.find(d => d.id === u.nodeId);
                      return (
                      <tr
                        key={u.nodeId}
                        onClick={() => {
                          setSelectedNodeId(u.nodeId);
                          setSelectedEdgeId(null);
                        }}
                        style={{
                          borderBottom: '1px solid #F1F5F9',
                          cursor: 'pointer',
                          background: u.nodeId === selectedNodeId ? '#F0FDF4' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '5px 10px', fontWeight: 800 }}>
                          {formatEquipmentTag(u.tag, nDef?.unitType, tagStandard)}
                        </td>
                        <td
                          style={{
                            padding: '5px 10px',
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 11,
                            fontWeight: 800,
                            color: u.isVisualOnly ? '#64748B' : u.calcMode === 'rigorous' ? '#5B21B6' : '#0F5338',
                          }}
                        >
                          {u.isVisualOnly ? '도면' : u.calcMode === 'rigorous' ? '정밀 열역학' : '간편 발란스'}
                        </td>
                        <td style={{ padding: '5px 10px', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, color: '#0369A1' }}>
                          {u.detectedFluidLabel}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                          {formatCanonicalValue('massFlow', u.inletMassKgH, unitSummaryMassUnit)}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                          {formatCanonicalValue('massFlow', u.outletMassKgH, unitSummaryMassUnit)}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 800, color: Math.abs(u.massImbalanceKgH) < 0.5 ? '#0F5338' : '#DC2626' }}>
                          {formatCanonicalValue('massFlow', u.massImbalanceKgH, unitSummaryMassUnit)}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                          {u.heatDutyKcalH !== 0 ? formatCanonicalValue('heatDuty', u.heatDutyKcalH / 1000, unitSummaryDutyUnit) : '—'}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                          {u.shaftPowerKW > 0 ? formatCanonicalValue('power', u.shaftPowerKW, unitSummaryPowerUnit) : '—'}
                        </td>
                        <td style={{ padding: '5px 10px', fontFamily: 'Inter, sans-serif', color: '#334155' }}>{u.statusNote}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                  </>
              )}
            </div>
            )}
          </div>
        </div>

        {/* 3) 우측 장치 / 배관 속성 편집 및 물질 자동인식 패널 (데스크톱: 우측 258px 도킹 / 모바일: 하단 슬라이드업 바텀시트) */}
        {inspectorOpen && (
        <>
          {isMobile && (
            <div
              onClick={() => setInspectorOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.42)',
                zIndex: 129,
              }}
            />
          )}
          <div
            style={
              isMobile
                ? {
                    position: 'fixed',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100%',
                    maxHeight: '82dvh',
                    background: '#FFFFFF',
                    borderRadius: '16px 16px 0 0',
                    borderTop: '2.5px solid #1A2F44',
                    boxShadow: '0 -12px 36px rgba(15, 23, 42, 0.32)',
                    padding: '0 12px 26px',
                    overflowY: 'auto',
                    zIndex: 130,
                    boxSizing: 'border-box',
                  }
                : {
                    width: 258,
                    background: '#FFFFFF',
                    borderLeft: '1px solid #E5E2DC',
                    padding: '9px 10px',
                    overflowY: 'auto',
                    flexShrink: 0,
                  }
            }
          >
            {isMobile && (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  background: '#FFFFFF',
                  padding: '8px 0 8px',
                  marginBottom: 8,
                  borderBottom: '1px solid #E2E8F0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 4,
                    borderRadius: 999,
                    background: '#CBD5E1',
                    alignSelf: 'center',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#1A2F44', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedDef
                      ? `[${formatEquipmentTag(selectedDef.tag, selectedDef.unitType, tagStandard)}] ${selectedDef.name}`
                      : selectedEdgeDef
                        ? `[${selectedEdgeDef.streamNo}] 배관 속성`
                        : '장치 · 배관 운전조건 시트'}
                  </span>
                  <button
                    onClick={() => setInspectorOpen(false)}
                    style={{
                      padding: '5px 10px',
                      fontSize: 11,
                      fontWeight: 900,
                      borderRadius: 7,
                      border: '1px solid #1A2F44',
                      background: '#1A2F44',
                      color: '#FFFFFF',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    ▼ 닫고 도면 보기
                  </button>
                </div>
              </div>
            )}
          {/* 선택된 배관(Edge) 인스펙터 */}
          {selectedEdgeDef ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><StreamFlowIcon size={12} /> 선택 배관 [{selectedEdgeDef.streamNo}]</span>
                </span>
                <button
                  onClick={() => deleteEdgeById(selectedEdgeDef.id)}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: '#B91C1C',
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: 5,
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                >
                  ✕ 이 배관 삭제
                </button>
              </div>

              <div style={{ padding: '9px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11.5 }}>
                {selectedStreamRes?.isTearStream && (
                  <div
                    style={{
                      marginBottom: 6,
                      padding: '4px 7px',
                      borderRadius: 5,
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      color: '#475569',
                      fontSize: 10.5,
                      fontWeight: 800,
                    }}
                  >
                    순환 절단 배관 (Tear Stream) · Bounded Wegstein 다변수 가속 수렴 적용
                  </div>
                )}
                <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
                  구간: {(() => {
                    const srcD = simDefs.find(d => d.id === selectedEdgeDef.source);
                    const dstD = simDefs.find(d => d.id === selectedEdgeDef.target);
                    const fTag = selectedStreamRes?.fromTag
                      ? formatEquipmentTag(selectedStreamRes.fromTag, srcD?.unitType, tagStandard)
                      : undefined;
                    const tTag = selectedStreamRes?.toTag
                      ? formatEquipmentTag(selectedStreamRes.toTag, dstD?.unitType, tagStandard)
                      : undefined;
                    return `${fTag ?? ''} → ${tTag ?? ''}`;
                  })()}{selectedStreamRes?.portRole ? ` (${selectedStreamRes.portRole})` : ''}
                </div>
                <div style={{ color: '#475569', fontSize: 11 }}>
                  인식 유체: <b style={{ color: '#0F172A' }}>{selectedStreamRes?.keyConcLabel ?? '—'}</b>
                </div>
                <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
                  상태: <b style={{ color: '#0F172A' }}>{selectedStreamRes?.phase}</b> ·{' '}
                  {selectedStreamRes ? `${formatCanonicalValue('temp', selectedStreamRes.tempC, globalUnits.temp, 1)}${getUnitLabel('temp', globalUnits.temp)}` : '—'} ·{' '}
                  {selectedStreamRes ? `${formatCanonicalValue('pressG', selectedStreamRes.pressKgcm2g, globalUnits.pressG, 2)} ${getUnitLabel('pressG', globalUnits.pressG)}` : '—'} ·{' '}
                  {selectedStreamRes ? `${formatCanonicalValue('massFlow', selectedStreamRes.totalMassKgH, globalUnits.massFlow)} ${getUnitLabel('massFlow', globalUnits.massFlow)}` : '—'}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 10.5, fontWeight: 800, color: '#475569' }}>배관 번호 (Stream No.)</label>
                <input
                  value={selectedEdgeDef.streamNo}
                  onChange={e =>
                    setFlowEdges(eds => eds.map(ed => (ed.id === selectedEdgeDef.id ? { ...ed, streamNo: e.target.value } : ed)))
                  }
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 10.5, fontWeight: 800, color: '#475569' }}>출구 포트 역할 변경 (기상 G↑ / 액상 L↓)</label>
                <select
                  value={selectedEdgeDef.sourcePort ?? 'out'}
                  onChange={e =>
                    setFlowEdges(eds =>
                      eds.map(ed => (ed.id === selectedEdgeDef.id ? { ...ed, sourcePort: e.target.value as SourcePortId } : ed))
                    )
                  }
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 11.5, marginTop: 3 }}
                >
                  <option value="out">주배관 (out)</option>
                  <option value="vapor">상부 기상/정제가스 출구 (vapor · G↑)</option>
                  <option value="side_cut">증류탑 사이드컷 측류 출구 (side_cut · 측류 S)</option>
                  <option value="liquid">하부 액화액/배출액 출구 (liquid · L↓)</option>
                  <option value="decanter">증류탑 공비 디캔터 수층 출구 (decanter)</option>
                  <option value="anode_out">전해조 양극 출구 (anode_out)</option>
                  <option value="cathode_out">전해조 음극 출구 (cathode_out)</option>
                </select>
              </div>
            </div>
          ) : !selectedDef ? (
            <div style={{ fontSize: 12, color: '#64748B', paddingTop: 20, lineHeight: 1.6 }}>
              캔버스에서 장치 또는 배관을 클릭하면 유입 물질 자동인식 정보와 냉매·압력·온도 운전 변수를 편집할 수 있습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>
                  {isVisualOnlyUnit(selectedDef.unitType)
                    ? '도면 장치 속성'
                    : selectedDef.unitType === 'feed' || selectedDef.unitType === 'product'
                      ? '➔ 물질 스트림 조건 · 발란스'
                      : '장치 운전조건 · 발란스'}
                </span>
                <button
                  onClick={deleteSelectedNode}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: '#B91C1C',
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: 5,
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                >
                  삭제
                </button>
              </div>

              {/* ── 우측 패널 상단 즉시 [▶ RUN 시뮬레이션 실행] 알림 바 ── */}
              <div
                style={{
                  padding: '7px 9px',
                  borderRadius: 6,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    color: isSimDirty ? '#D97706' : '#059669',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: isSimDirty ? '#D97706' : '#059669',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  {isSimDirty ? '미수렴 (변경됨)' : `수렴 (${solvedMeta.elapsedMs}ms)`}
                </span>
                <button
                  type="button"
                  disabled={isSimRunning}
                  onClick={() => runSimulationNow()}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 5,
                    border: '1px solid #1E3A8A',
                    background: isSimRunning ? '#475569' : '#1E3A8A',
                    color: '#FFFFFF',
                    fontSize: 10.5,
                    fontWeight: 800,
                    cursor: isSimRunning ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isSimRunning ? '계산 중...' : '▶ RUN 실행'}
                </button>
              </div>

              {/* ── 단독 장치 미연결 입·출구 스트림 원클릭 자동생성 버튼 ── */}
              {selectedDef.unitType !== 'feed' &&
                selectedDef.unitType !== 'product' &&
                (() => {
                  const hasIn = flowEdges.some(e => e.target === selectedDef.id);
                  const outCount = flowEdges.filter(e => e.source === selectedDef.id).length;
                  const needDualOut =
                    selectedDef.unitType === 'distillation' ||
                    selectedDef.unitType === 'separator' ||
                    selectedDef.unitType === 'absorber' ||
                    selectedDef.unitType === 'liquefier' ||
                    selectedDef.unitType === 'splitter' ||
                    selectedDef.unitType === 'electrolyzer';
                  const missingAny = !hasIn || outCount < (needDualOut ? 2 : 1);
                  if (!missingAny) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => autoAttachMissingStreams(selectedDef.id)}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: 6,
                        border: '1px solid #1E3A8A',
                        background: '#1E3A8A',
                        color: '#FFFFFF',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                      }}
                      title="전·후단 연결 장치가 없어도 미연결 입·출구 포트에 물질 유입/유출 스트림을 자동 연결하여 단독 시뮬레이션을 즉시 실행합니다."
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><StreamFlowIcon size={12} /> 입·출구 스트림 자동생성</span>
                    </button>
                  );
                })()}

              {/* 유입 배관 물질 자동 인식 배너 */}
              {selectedDef.unitType !== 'feed' && selectedUnitRes && (
                <div
                  style={{
                    padding: '8px 10px',
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FlaskCompIcon size={12} /> 유입 배관 물질 자동 인식</span>
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                    {selectedUnitRes.detectedFluidLabel}
                  </div>
                </div>
              )}

              {/* 태그 & 장치명 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>태그 (Tag)</label>
                  <input
                    value={selectedDef.tag}
                    onChange={e => updateSelectedDef({ tag: e.target.value })}
                    style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>명칭</label>
                  <input
                    value={selectedDef.name}
                    onChange={e => updateSelectedDef({ name: e.target.value })}
                    style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12, fontWeight: 700 }}
                  />
                </div>
              </div>

              <PlantUnitCopyBox
                unitType={selectedDef.unitType}
                nodeKey={selectedDef.id}
                activePlantId={isPlantSimMode ? workspacePlantId : undefined}
                onCopyParams={(copiedParams, tpl, includeInlet) => {
                  const unitId = selectedDef.id;
                  updateSelectedDef({ params: copiedParams });
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
                                data: { ...n.data, tag: feedTag, name: inlet.label },
                              }
                            : n
                        )
                      );
                    } else if (incomingEdges.length === 0) {
                      const newFeedId = `feed_tpl_${Date.now()}`;
                      const feedTag = `${tpl.tag}-IN`;
                      const feedCount = simDefs.filter(d => d.unitType === 'feed').length + 1;
                      const streamNo = `S-IN-${String(feedCount).padStart(2, '0')}`;
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
                        id: `edge_tpl_${Date.now()}`,
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
                          type: 'flowUnit',
                          position: pos,
                          data: { tag: feedTag, name: inlet.label, unitType: 'feed', liveSummary: '' },
                        },
                      ]);
                      setFlowEdges(prev => [...prev, newEdge]);
                    }
                  }
                }}
              />

              {/* ── 계층형 내부 세부 공정 시뮬레이션 진입 / 생성 카드 ── */}
              {isMultiSheetMode && selectedDef.subSheetId && (
                <div
                  style={{
                    padding: '9px 10px',
                    borderRadius: 6,
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 900, color: '#0F172A' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SubprocessTreeIcon size={12} /> 계층형 세부 공정 패키지 블록 ({selectedDef.subSheetBadge || '내부 상세 도면'})</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.4 }}>
                    캔버스에서 이 블록을 <b>더블클릭</b>하거나 아래 버튼을 누르면 내부 단위기기 시뮬레이션 화면으로 즉시 이동합니다.
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateToHierarchySheet(selectedDef.subSheetId!)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid #1E3A8A',
                      background: '#1E3A8A',
                      color: '#FFFFFF',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SubprocessTreeIcon size={12} /> 내부 세부 공정 시뮬레이션 열기 →</span>
                  </button>
                </div>
              )}

              {/* ── 단위 장치 상세설계 실시간 유체조건 연동 카드 (펌프·용기·증발관·브라인·건조탑 등 외부 전용 계산기 연동; 증류탑·열교환기는 하단 단일 내장 워크벤치로 통합) ── */}
              {selectedUnitDesignRoute &&
                selectedDef.unitType !== 'distillation' &&
                selectedDef.unitType !== 'hex' &&
                selectedDef.unitType !== 'cooler' &&
                selectedDef.unitType !== 'liquefier' && (
                <div
                  style={{
                    padding: '9px 10px',
                    borderRadius: 6,
                    background: selectedUnitDesignRoute.bgGradient,
                    border: `1px solid ${selectedUnitDesignRoute.borderColor}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 900, color: '#0F172A' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><VesselEquipIcon size={12} /> 단위 장치 상세설계 연동 (유체조건 자동전달)</span>
                    </span>
                    {selectedUnitRes && selectedUnitRes.inletMassKgH > 0 && (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: '#475569',
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          padding: '1px 5px',
                          borderRadius: 4,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        {selectedUnitRes.inletMassKgH.toFixed(0)} kg/h
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.4 }}>
                    {selectedUnitDesignRoute.subHint}
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenUnitDesign}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: `1px solid ${selectedUnitDesignRoute.accentColor}`,
                      background: selectedUnitDesignRoute.accentColor,
                      color: '#FFFFFF',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    {selectedUnitDesignRoute.buttonLabel}
                  </button>
                  {selectedUnitDesignRoute.secondaryAction && (
                    <button
                      type="button"
                      onClick={() => {
                        const sec = selectedUnitDesignRoute.secondaryAction!;
                        if (sec.equipSubTab) {
                          setEquipSubTab(sec.equipSubTab);
                          setActiveDesignRequest({ tab: sec.equipSubTab as 'packing', tag: selectedDef.tag });
                        }
                        router.push(sec.href);
                      }}
                      style={{
                        padding: '5px 8px',
                        borderRadius: 5,
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#1E293B',
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {selectedUnitDesignRoute.secondaryAction.label}
                    </button>
                  )}
                </div>
              )}

              {isMultiSheetMode &&
                activeSheetId === 'master' &&
                !selectedDef.subSheetId &&
                selectedDef.unitType !== 'feed' &&
                selectedDef.unitType !== 'product' && (
                  <button
                    type="button"
                    onClick={() => createCustomSubSheetForNode(selectedDef)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px dashed #CBD5E1',
                      background: '#FFFFFF',
                      color: '#1E293B',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><PlusSquareIcon size={12} /> 이 블록의 내부 세부 플로우시트 새로 만들기</span>
                  </button>
                )}

              {/* 하위 세부공정 경계 유입(BOUND-*) 안내 배너 */}
              {selectedDef.unitType === 'feed' && selectedDef.params.boundaryFromMasterNodeId && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    fontSize: 10.5,
                    color: '#475569',
                    lineHeight: 1.45,
                  }}
                >
                  <b style={{ color: '#0F172A', display: 'inline-flex', alignItems: 'center', gap: 4 }}><StreamFlowIcon size={12} /> 상위 풀패키지 연동 경계 스트림</b>
                  <br />
                  상위 전공정 마스터 블록(<code>{selectedDef.params.boundaryFromMasterNodeId}</code>)의 유입 유량·온도·압력이 자동 전달됩니다. 아래 값을 직접 수정하여 단독 민감도 테스트를 수행할 수도 있습니다.
                </div>
              )}

              {/* ── 장치별 2단 해석 모드 전환 스위치 (간편 발란스 ↔ 정밀 열역학; 다단 정밀증류탑은 상시 엄밀 MESH 수행) ── */}
              {!isVisualOnlyUnit(selectedDef.unitType) &&
                selectedDef.unitType !== 'distillation' &&
                selectedDef.unitType !== 'feed' &&
                selectedDef.unitType !== 'product' &&
                selectedDef.unitType !== 'mixer' &&
                selectedDef.unitType !== 'splitter' && (
                  <div
                    style={{
                      padding: '8px 9px',
                      borderRadius: 6,
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 900, color: '#0F172A' }}>
                      해석 정밀도 모드 (장치별 독립 전환)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                      <button
                        type="button"
                        onClick={() => updateParam('calcMode', 'simple')}
                        style={{
                          padding: '6px 6px',
                          borderRadius: 5,
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          border: (selectedDef.params.calcMode ?? 'simple') === 'simple' ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                          background: (selectedDef.params.calcMode ?? 'simple') === 'simple' ? '#1E3A8A' : '#FFFFFF',
                          color: (selectedDef.params.calcMode ?? 'simple') === 'simple' ? '#FFFFFF' : '#1E293B',
                        }}
                      >
                        간편 발란스
                      </button>
                      <button
                        type="button"
                        onClick={() => updateParam('calcMode', 'rigorous')}
                        style={{
                          padding: '6px 6px',
                          borderRadius: 5,
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          border: (selectedDef.params.calcMode ?? 'simple') === 'rigorous' ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                          background: (selectedDef.params.calcMode ?? 'simple') === 'rigorous' ? '#1E3A8A' : '#FFFFFF',
                          color: (selectedDef.params.calcMode ?? 'simple') === 'rigorous' ? '#FFFFFF' : '#1E293B',
                        }}
                      >
                        정밀 열역학
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.35 }}>
                      {(selectedDef.params.calcMode ?? 'simple') === 'rigorous'
                        ? 'PR-EOS 실재기체 · Pitzer 전해질 활동도 · Nernst-Tafel 셀전압 · 3-Zone 상변화 · Kremser 다단 평형이 반영됩니다.'
                        : '빠른 기본 물질·열수지 모드로 직관적인 개념 설계에 적합합니다.'}
                    </div>
                  </div>
                )}

              {/* ── 0) 도면 전용 장치 ── */}
              {isVisualOnlyUnit(selectedDef.unitType) && (
                <div style={{ padding: 10, background: '#F8FAFC', borderRadius: 6, border: '1px dashed #CBD5E1', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
                    유입된 스트림(액화염소·염수·염산 등)을 변화 없이 후단 배관으로 그대로 통과시킵니다.
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>도면 사양 메모</label>
                    <input
                      value={selectedDef.params.visualSpecNote ?? ''}
                      onChange={e => updateParam('visualSpecNote', e.target.value)}
                      style={{ width: '100%', padding: '5px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 11.5 }}
                    />
                  </div>
                </div>
              )}

              {/* ── A) 유입 물질 스트림 (Feed) — 0ms 초저지연 즉시 입력 ── */}
              {selectedDef.unitType === 'feed' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>공급 온도</div>
                      <UnitNumberInput
                        quantity="temp"
                        syncKey={`${selectedDef.id}-ftemp`}
                        value={selectedDef.params.feedTempC ?? 25}
                        onValueChange={v => updateParam('feedTempC', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>공급 압력</div>
                      <UnitNumberInput
                        quantity="pressG"
                        syncKey={`${selectedDef.id}-fpress`}
                        value={selectedDef.params.feedPressKgcm2g ?? 0.5}
                        onValueChange={v => updateParam('feedPressKgcm2g', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}
                      />
                    </div>
                  </div>
                  <div style={{ background: '#F8FAFC', padding: 9, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 6, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#0F172A' }}>성분별 질량유량</span>
                        <UnitSelect quantity="massFlow" value={feedFlowUnit} onChange={setFeedFlowUnit} size="xs" />
                        <button
                          type="button"
                          onClick={() => setCompSetupModalOpen(true)}
                          style={{
                            padding: '2px 7px',
                            fontSize: 9.5,
                            fontWeight: 700,
                            borderRadius: 4,
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#1E293B',
                            cursor: 'pointer',
                          }}
                        >
                          + 성분 설정 ({activeComponents.length}종)
                        </button>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 900, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                        합계{' '}
                        {formatCanonicalValue(
                          'massFlow',
                          Object.values(selectedDef.params.feedFlowsKgH ?? {}).reduce((a, b) => a + (Number(b) || 0), 0),
                          feedFlowUnit
                        )}{' '}
                        {getUnitLabel('massFlow', feedFlowUnit)}
                      </span>
                    </div>
                    {SIM_COMPS.filter(
                      comp => activeComponents.includes(comp) || (selectedDef.params.feedFlowsKgH?.[comp] ?? 0) > 0
                    ).map(comp => {
                      const val = selectedDef.params.feedFlowsKgH?.[comp] ?? 0;
                      return (
                        <div key={comp} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: val > 0 ? 800 : 600, color: val > 0 ? '#0F172A' : '#475569', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {COMP_META[comp].label}
                          </span>
                          <UnitNumberInput
                            quantity="massFlow"
                            unitId={feedFlowUnit}
                            onUnitChange={setFeedFlowUnit}
                            syncKey={`${selectedDef.id}-fc-${comp}`}
                            minCanonical={0}
                            value={val}
                            onValueChange={v => updateFeedComp(comp, Math.max(0, v))}
                            onEnterRun={() => runSimulationNow()}
                            containerStyle={{ width: 132, flexShrink: 0 }}
                            inputStyle={{
                              padding: '3px 6px',
                              textAlign: 'right',
                              border: val > 0 ? '1px solid #64748B' : '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#0F172A',
                              borderRadius: 4,
                              fontSize: 11.5,
                              fontWeight: val > 0 ? 800 : 600,
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                            selectStyle={{ minWidth: 46, fontSize: 9.5 }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* ── B) 이온교환막 전해조 (Electrolyzer) ── */}
              {selectedDef.unitType === 'electrolyzer' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 5 }}><VesselEquipIcon size={12} /> 전해조 양극·음극 동시 수지</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>운전 전류 (kA)</label>
                      <BufferedNumberInput syncKey={`${selectedDef.id}-eka`} step={0.2} value={selectedDef.params.currentKA ?? 16.2} onValueChange={v => updateParam('currentKA', v)} onEnterRun={() => runSimulationNow()} style={{ width: '100%', padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>전류 효율 (%)</label>
                      <BufferedNumberInput syncKey={`${selectedDef.id}-eeff`} step={0.5} value={selectedDef.params.currentEffPct ?? 94.0} onValueChange={v => updateParam('currentEffPct', v)} onEnterRun={() => runSimulationNow()} style={{ width: '100%', padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>셀 수량 (개/기)</label>
                      <BufferedNumberInput syncKey={`${selectedDef.id}-ecell`} step={1} value={selectedDef.params.cellCount ?? 190} onValueChange={v => updateParam('cellCount', v)} onEnterRun={() => runSimulationNow()} style={{ width: '100%', padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>전해조 기수</label>
                      <BufferedNumberInput syncKey={`${selectedDef.id}-eunit`} step={1} value={selectedDef.params.unitCount ?? 5} onValueChange={v => updateParam('unitCount', v)} onEnterRun={() => runSimulationNow()} style={{ width: '100%', padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>운전 온도</div>
                      <UnitNumberInput quantity="temp" syncKey={`${selectedDef.id}-etemp`} value={selectedDef.params.operTempC ?? 89.0} onValueChange={v => updateParam('operTempC', v)} onEnterRun={() => runSimulationNow()} inputStyle={{ padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>양극 압력</div>
                      <UnitNumberInput quantity="pressG" syncKey={`${selectedDef.id}-epress`} value={selectedDef.params.operPressKgcm2g ?? 0.40} onValueChange={v => updateParam('operPressKgcm2g', v)} onEnterRun={() => runSimulationNow()} inputStyle={{ padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }} />
                    </div>
                  </div>
                  {(selectedDef.params.calcMode ?? 'simple') === 'rigorous' && (
                    <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px dashed #CBD5E1' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>
                        셀당 이온교환막 유효면적 (전류밀도·셀전압 자동 산출)
                      </div>
                      <UnitNumberInput
                        quantity="area"
                        syncKey={`${selectedDef.id}-ememb`}
                        value={selectedDef.params.membraneAreaM2 ?? 2.72}
                        onValueChange={v => updateParam('membraneAreaM2', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ── C) 염소/가스 액화기 (Liquefier) & 열교환기 (HEX / Cooler) + 내장 설계 워크벤치 ── */}
              {(selectedDef.unitType === 'liquefier' || selectedDef.unitType === 'hex' || selectedDef.unitType === 'cooler') && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    background: '#F8FAFC',
                    padding: 10,
                    borderRadius: 6,
                    border: '1px solid #E2E8F0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <HexCircleIcon size={12} />
                      {selectedDef.unitType === 'liquefier'
                        ? '냉매 액화기 운전 · 열수지'
                        : '열교환기 · 냉각기 운전 · 열수지'}
                    </div>
                    {selectedDef.params.overallU ? (
                      <span
                        style={{
                          fontSize: 9.2,
                          fontWeight: 800,
                          padding: '1.5px 6px',
                          borderRadius: 999,
                          background: '#FFFFFF',
                          color: '#475569',
                          border: '1px solid #E2E8F0',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        U={selectedDef.params.overallU}
                      </span>
                    ) : null}
                  </div>

                  <div>
                    <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>사용 냉매 / 열매 종류</label>
                    <select
                      value={selectedDef.params.refrigerantPreset ?? (selectedDef.unitType === 'liquefier' ? 'freon_m35' : 'cw')}
                      onChange={e => applyRefrigerantPreset(e.target.value as RefrigerantPresetKey)}
                      style={{ width: '100%', padding: '5px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 11.5, fontWeight: 700, marginTop: 2, background: '#FFFFFF', color: '#0F172A' }}
                    >
                      {(Object.keys(REFRIGERANT_PRESETS) as RefrigerantPresetKey[]).map(rk => (
                        <option key={rk} value={rk}>
                          {REFRIGERANT_PRESETS[rk].label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>계산 기준 모드</label>
                    <select
                      value={selectedDef.params.hexSpecMode ?? 'proc_temp'}
                      onChange={e => updateParam('hexSpecMode', e.target.value)}
                      style={{ width: '100%', padding: '5px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 11.5, marginTop: 2, background: '#FFFFFF', color: '#0F172A' }}
                    >
                      <option value="proc_temp">출구 목표 온도 지정 → 액화량·냉동부하 계산</option>
                      <option value="heat_duty">교환 열량(Mcal/h) 지정 → 출구 온도 역산</option>
                    </select>
                  </div>

                  {(selectedDef.params.hexSpecMode ?? 'proc_temp') === 'proc_temp' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>공정 출구 온도</div>
                        <UnitNumberInput
                          quantity="temp"
                          syncKey={`${selectedDef.id}-hxtemp`}
                          value={selectedDef.params.operTempC ?? (selectedDef.unitType === 'liquefier' ? -22 : 25)}
                          onValueChange={v => updateParam('operTempC', v)}
                          onEnterRun={() => runSimulationNow()}
                          inputStyle={{ padding: '5px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12, fontWeight: 800, background: '#FFFFFF', color: '#0F172A' }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>운전압(비우면 전단추종)</div>
                        <UnitNullableNumberInput
                          quantity="pressG"
                          placeholder="전단압 자동"
                          value={selectedDef.params.operPressKgcm2g}
                          onValueChange={v => updateParam('operPressKgcm2g', v)}
                          inputStyle={{ padding: '5px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12, background: '#FFFFFF', color: '#0F172A' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>교환 열량 (냉각은 음수 -)</div>
                      <UnitNumberInput
                        quantity="heatDuty"
                        syncKey={`${selectedDef.id}-hxduty`}
                        value={selectedDef.params.specifiedDutyMcalH ?? -500}
                        onValueChange={v => updateParam('specifiedDutyMcalH', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12, background: '#FFFFFF', color: '#0F172A' }}
                      />
                    </div>
                  )}

                  {selectedDef.params.refrigerantPreset === 'custom' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>냉매 입구</div>
                        <UnitNumberInput quantity="temp" syncKey={`${selectedDef.id}-uin`} value={selectedDef.params.utilInTempC ?? -25} onValueChange={v => updateParam('utilInTempC', v)} onEnterRun={() => runSimulationNow()} inputStyle={{ padding: '4px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 11.5, background: '#FFFFFF', color: '#0F172A' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>냉매 출구</div>
                        <UnitNumberInput quantity="temp" syncKey={`${selectedDef.id}-uout`} value={selectedDef.params.utilOutTempC ?? -18} onValueChange={v => updateParam('utilOutTempC', v)} onEnterRun={() => runSimulationNow()} inputStyle={{ padding: '4px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 11.5, background: '#FFFFFF', color: '#0F172A' }} />
                      </div>
                    </div>
                  )}

                  {(selectedDef.params.calcMode ?? 'simple') === 'rigorous' && (
                    <div style={{ paddingTop: 6, borderTop: '1px dashed #CBD5E1' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>
                        총괄 오염계수 R_f (3-Zone 전열면적 산출)
                      </div>
                      <UnitNumberInput
                        quantity="fouling"
                        syncKey={`${selectedDef.id}-rfoul`}
                        value={selectedDef.params.foulingFactor ?? 0.0002}
                        onValueChange={v => updateParam('foulingFactor', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '4px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 11.5, background: '#FFFFFF', color: '#0F172A' }}
                      />
                    </div>
                  )}

                  {/* 내장 열교환기 개념·상세설계 워크벤치 단일 런처 (외부 페이지 이탈 없음) */}
                  <div
                    style={{
                      marginTop: 2,
                      paddingTop: 8,
                      borderTop: '1px solid #E2E8F0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <div style={{ fontSize: 9.8, fontWeight: 800, color: '#475569' }}>
                      내장 열교환기 워크벤치 (T-Q 핀치 · TEMA 다관형 / 쉐브론 판형 · 도면)
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setHxModalInitialView('thermal');
                        setHxModalNodeId(selectedDef.id);
                      }}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: 6,
                        border: '1px solid #1E3A8A',
                        background: '#1E3A8A',
                        color: '#FFFFFF',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><HexCircleIcon size={12} /> ① 열수지 · 상변화 T-Q 프로파일 열기 →</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHxModalInitialView('mechanical');
                        setHxModalNodeId(selectedDef.id);
                      }}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#1E293B',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><PfdSchematicIcon size={12} /> ② TEMA/판형 사이징 · 수력학 · 도면 설계 →</span>
                    </button>
                  </div>
                </div>
              )}

              {/* ── D) 가스 압축기 & 원심 펌프 ── */}
              {(selectedDef.unitType === 'compressor' || selectedDef.unitType === 'pump') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: '#0F172A' }}>
                    {selectedDef.unitType === 'compressor' ? '가스 압축기 승압 · 이슬점 조건' : '원심 펌프 토출 조건'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>토출 압력</div>
                      <UnitNumberInput
                        quantity="pressG"
                        syncKey={`${selectedDef.id}-cpress`}
                        value={selectedDef.params.outletPressKgcm2g ?? 3.5}
                        onValueChange={v => updateParam('outletPressKgcm2g', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12, fontWeight: 800 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>기계 효율 (0~1)</label>
                      <BufferedNumberInput
                        syncKey={`${selectedDef.id}-ceff`}
                        step={0.02}
                        value={selectedDef.params.efficiency ?? 0.76}
                        onValueChange={v => updateParam('efficiency', v)}
                        onEnterRun={() => runSimulationNow()}
                        style={{ width: '100%', padding: '5px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }}
                      />
                    </div>
                  </div>
                  {selectedDef.unitType === 'compressor' && (
                    <>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>인터쿨러 후단 토출온도 (0°C이면 단열압축)</div>
                        <UnitNumberInput
                          quantity="temp"
                          syncKey={`${selectedDef.id}-cic`}
                          value={selectedDef.params.intercooledTempC ?? 42}
                          onValueChange={v => updateParam('intercooledTempC', v)}
                          onEnterRun={() => runSimulationNow()}
                          inputStyle={{ padding: '5px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }}
                        />
                      </div>
                      {(selectedDef.params.calcMode ?? 'simple') === 'rigorous' && (
                        <div style={{ paddingTop: 5, borderTop: '1px dashed #CBD5E1' }}>
                          <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>
                            다단 압축 단수 (1~4단 · PR-EOS Z 및 Cl₂ 발화한계 110°C 검토)
                          </label>
                          <BufferedNumberInput
                            syncKey={`${selectedDef.id}-cstg`}
                            min={1}
                            max={4}
                            step={1}
                            value={selectedDef.params.compStages ?? 2}
                            onValueChange={v => updateParam('compStages', v)}
                            onEnterRun={() => runSimulationNow()}
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12, marginTop: 2 }}
                          />
                        </div>
                      )}
                      <div style={{ fontSize: 10.5, color: '#475569', fontWeight: 700 }}>
                        토출압 {formatCanonicalValue('pressG', selectedDef.params.outletPressKgcm2g ?? 3.5, globalUnits.pressG, 2)} {getUnitLabel('pressG', globalUnits.pressG)} 기준 순수 Cl₂ 액화 이슬점:{' '}
                        <b style={{ color: '#0F172A' }}>
                          {formatCanonicalValue('temp', cl2DewPointTempC((selectedDef.params.outletPressKgcm2g ?? 3.5) + 1.03323), globalUnits.temp, 1)} {getUnitLabel('temp', globalUnits.temp)}
                        </b>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── D-2) 내장 정밀증류탑 워크벤치 (중복 인라인 폼·중복 버튼 제거 → 요약 KPI + 단일 2탭 런처) ── */}
              {selectedDef.unitType === 'distillation' && (() => {
                const dCfg: DistillColumnParams = selectedDef.params.distillConfig ?? {};
                const dRes = selectedUnitRes?.distillResult;
                const isDesignStages = (dCfg.columnCalcMode ?? 'rigorous_mesh') === 'design_stages';
                const patchDistill = (patch: Partial<DistillColumnParams>) => {
                  updateParam('distillConfig', { ...dCfg, ...patch });
                };

                const distTotalKgH = dRes
                  ? Object.values(dRes.distillateFlowsKgH).reduce((a, b) => a + (b || 0), 0)
                  : 0;
                const botTotalKgH = dRes
                  ? Object.values(dRes.bottomsFlowsKgH).reduce((a, b) => a + (b || 0), 0)
                  : 0;

                const diagLvl = dRes?.diagnostics?.level ?? (dRes?.converged ? 'ok' : 'error');
                const badgeFg = isSimDirty
                  ? '#D97706'
                  : diagLvl === 'ok'
                  ? '#059669'
                  : diagLvl === 'warning'
                  ? '#D97706'
                  : '#B91C1C';
                const badgeTxt = isSimDirty
                  ? '조건변경 · RUN 대기'
                  : dRes
                  ? `${diagLvl === 'ok' ? '정상 수렴' : diagLvl === 'warning' ? '스펙한계 점검' : '미수렴·조건부족'} · ${dRes.thermoModelUsed}`
                  : dCfg.thermoModel ?? 'AUTO';

                return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      background: '#F8FAFC',
                      padding: 10,
                      borderRadius: 6,
                      border: '1px solid #E2E8F0',
                    }}
                  >
                    {/* 1행: 헤더 + 수렴 배지 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: '#0F172A', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><ColumnInternalIcon size={13} /> 정밀증류탑 워크벤치</span>
                      </span>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 800,
                          padding: '1.5px 6px',
                          borderRadius: 999,
                          background: '#FFFFFF',
                          color: badgeFg,
                          border: '1px solid #E2E8F0',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: badgeFg,
                            display: 'inline-block',
                            flexShrink: 0,
                          }}
                        />
                        {badgeTxt}
                      </span>
                    </div>

                    {/* 진단 경고/오류 시 원클릭 보정 박스 */}
                    {!isSimDirty && dRes?.diagnostics && dRes.diagnostics.level !== 'ok' && (
                      <div
                        style={{
                          padding: '6px 8px',
                          borderRadius: 6,
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          fontSize: 9.8,
                          lineHeight: 1.4,
                          color: dRes.diagnostics.level === 'error' ? '#B91C1C' : '#D97706',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>{dRes.diagnostics.headline}</div>
                        {dRes.diagnostics.remedies.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {dRes.diagnostics.remedies.map((rem, rIdx) => (
                              <button
                                key={rIdx}
                                type="button"
                                onClick={() => {
                                  patchDistill(rem.patch);
                                  setTimeout(() => runSimulationNow(), 15);
                                }}
                                style={{
                                  padding: '3px 7px',
                                  borderRadius: 4,
                                  border: '1px solid #1E3A8A',
                                  background: '#1E3A8A',
                                  color: '#FFFFFF',
                                  fontSize: 9.5,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {rem.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 현재 설정 · 수렴 요약 KPI 카드 (읽기 전용 요약) */}
                    <div
                      style={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: 6,
                        padding: '8px 9px',
                        fontSize: 10.4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#475569', fontSize: 9.8 }}>
                        <span>해석 방식</span>
                        <b style={{ color: '#0F172A' }}>
                          {isDesignStages ? '목표순도 → 단수·유량 자동설계' : '고정단수 → 다단 정밀모사'}
                        </b>
                      </div>

                      {dRes ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: '#475569', whiteSpace: 'nowrap', flexShrink: 0, fontSize: 9.8 }}>단수·RR</span>
                            <b style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0F172A', textAlign: 'right', fontSize: 10, whiteSpace: 'nowrap' }}>
                              {dRes.totalStagesUsed}단(실제 {dRes.actualTrayCount} · F:{dRes.feedStageUsed}) · RR={dRes.actualRefluxRatio.toFixed(2)}
                            </b>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono, monospace', color: '#0F172A', fontWeight: 800, fontSize: 10, whiteSpace: 'nowrap' }}>
                            <span>D: {distTotalKgH.toFixed(1)} kg/h</span>
                            <span>B: {botTotalKgH.toFixed(1)} kg/h</span>
                          </div>
                          {(dRes.sideCutMassKgH ?? 0) > 1e-4 && (
                            <div
                              style={{
                                fontSize: 9.6,
                                fontFamily: 'JetBrains Mono, monospace',
                                color: '#475569',
                                fontWeight: 800,
                                background: '#F8FAFC',
                                border: '1px solid #E2E8F0',
                                borderRadius: 4,
                                padding: '3px 6px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <span>
                                측류 S ({dRes.sideCutStageUsed ?? '-'}단·{dRes.sideCutPhase === 'G' ? '기상' : '액상'}): {(dRes.sideCutMassKgH ?? 0).toFixed(1)} kg/h
                              </span>
                              <span>S/F {((dRes.actualSOverFMass ?? 0) * 100).toFixed(1)}%</span>
                            </div>
                          )}
                          {dRes.decanterWaterDrawKgH > 0.005 && (
                            <div style={{ fontSize: 9.6, fontFamily: 'JetBrains Mono, monospace', color: '#475569', fontWeight: 800 }}>
                              탑정 디캔터 수층 분리 W: {dRes.decanterWaterDrawKgH.toFixed(2)} kg/h
                            </div>
                          )}
                          {dRes.shortcutDesign && (
                            <div style={{ paddingTop: 3, borderTop: '1px dashed #E2E8F0', display: 'flex', flexDirection: 'column', gap: 1.5, fontSize: 9.6, color: '#475569' }}>
                              <div>
                                탑정 {dRes.shortcutDesign.lkComp}: <b style={{ color: '#0F172A' }}>{dRes.shortcutDesign.topLkPurityWtPct.toFixed(2)} wt%</b> (회수 {dRes.shortcutDesign.topLkRecoveryPct}%)
                              </div>
                              <div>
                                탑저 {dRes.shortcutDesign.hkComp}: <b style={{ color: '#0F172A' }}>{dRes.shortcutDesign.botHkPurityWtPct.toFixed(2)} wt%</b> (회수 {dRes.shortcutDesign.botHkRecoveryPct}%)
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 10, color: '#475569' }}>
                          탑정압 {(dCfg.topPressKgcm2g ?? 0.05).toFixed(2)} kG · 상단 <b>▶ RUN 실행</b> 또는 아래 워크벤치를 열어 조건을 설정하세요.
                        </div>
                      )}
                    </div>

                    {/* 통합 2-탭 워크벤치 실행 버튼 (사이드패널 내 중복 버튼 없음) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setDistillModalInitialView('simulation');
                          setDistillModalNodeId(selectedDef.id);
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: '1px solid #1E3A8A',
                          background: '#1E3A8A',
                          color: '#FFFFFF',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SlidersParamIcon size={12} /> ① 시뮬레이션 · 프로파일 설정 →</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDistillModalInitialView('internals');
                          setDistillModalNodeId(selectedDef.id);
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: '1px solid #CBD5E1',
                          background: '#FFFFFF',
                          color: '#1E293B',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><ColumnInternalIcon size={12} /> ② 컬럼 사이징 · 인터널 설계 →</span>
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* ── E) 건조탑 · 흡수탑 (Absorber) ── */}
              {selectedDef.unitType === 'absorber' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 5 }}><ColumnInternalIcon size={12} /> 건조탑 · 흡수탑 발란스</div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>흡수탑 열역학 해석 알고리즘</label>
                    <select
                      value={selectedDef.params.absorberCalcMode ?? 'kremser'}
                      onChange={e => updateParam('absorberCalcMode', e.target.value as 'kremser' | 'rigorous_mesh')}
                      style={{ width: '100%', padding: '5px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 11.5, fontWeight: 700, background: '#FFFFFF', color: '#0F172A' }}
                    >
                      <option value="kremser">Kremser / 화학반응 흡수 수지 (기본 · 황산건조/가성제해)</option>
                      <option value="rigorous_mesh">엄밀 다단 MESH 향류 기액평형 흡수·스트리퍼</option>
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 7 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>제거/흡수 대상 성분</label>
                      <select
                        value={selectedDef.params.targetComponent ?? 'H2O'}
                        onChange={e => updateParam('targetComponent', e.target.value as SimCompKey)}
                        style={{ width: '100%', padding: '5px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 11.5 }}
                      >
                        <option value="H2O">H₂O (황산 염소건조탑)</option>
                        <option value="HCl">HCl (염산 흡수탑)</option>
                        <option value="Cl2">Cl₂ (가성소다 제해탑)</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>
                        {(selectedDef.params.calcMode ?? 'simple') === 'rigorous' ? '이론 단수 N (단)' : '제거 효율 (0~1)'}
                      </label>
                      {(selectedDef.params.calcMode ?? 'simple') === 'rigorous' ? (
                        <BufferedNumberInput
                          syncKey={`${selectedDef.id}-absn`}
                          min={1}
                          max={40}
                          step={1}
                          value={selectedDef.params.columnStages ?? 8}
                          onValueChange={v => updateParam('columnStages', Math.round(v))}
                          onEnterRun={() => runSimulationNow()}
                          style={{ width: '100%', padding: '5px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12, fontWeight: 800 }}
                        />
                      ) : (
                        <BufferedNumberInput
                          syncKey={`${selectedDef.id}-abseff`}
                          step={0.001}
                          min={0}
                          max={0.9999}
                          value={selectedDef.params.removalEfficiency ?? 0.999}
                          onValueChange={v => updateParam('removalEfficiency', v)}
                          onEnterRun={() => runSimulationNow()}
                          style={{ width: '100%', padding: '5px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }}
                        />
                      )}
                    </div>
                  </div>
                  {(selectedDef.params.calcMode ?? 'simple') === 'rigorous' && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>
                        탑 압력강하 ΔP (Kremser 흡수율 및 탑경 자동 산출)
                      </div>
                      <UnitNumberInput
                        quantity="deltaP"
                        syncKey={`${selectedDef.id}-absdp`}
                        minCanonical={0}
                        value={selectedDef.params.columnDeltaPKgcm2 ?? 0.08}
                        onValueChange={v => updateParam('columnDeltaPKgcm2', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '4px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 11.5 }}
                      />
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>흡수액 공급 방식</label>
                    <select
                      value={selectedDef.params.solventMode ?? 'connected_or_manual'}
                      onChange={e => updateParam('solventMode', e.target.value)}
                      style={{ width: '100%', padding: '5px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 11.5 }}
                    >
                      <option value="connected_or_manual">보충 유량 직접 입력 (황산 등)</option>
                      <option value="auto_target_wt">탑저 목표 농도(wt%) 지정 → 흡수액 자동역산</option>
                    </select>
                  </div>
                  {(selectedDef.params.solventMode ?? 'connected_or_manual') === 'auto_target_wt' ? (
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>탑저 배출액 목표 농도 (wt%)</label>
                      <BufferedNumberInput
                        syncKey={`${selectedDef.id}-abswt`}
                        step={1}
                        min={0.1}
                        max={99.9}
                        value={selectedDef.params.targetBottomWtPct ?? 35}
                        onValueChange={v => updateParam('targetBottomWtPct', v)}
                        onEnterRun={() => runSimulationNow()}
                        style={{ width: '100%', padding: '5px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 12 }}
                      />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>보충 성분</label>
                        <select value={selectedDef.params.makeupSolventComp ?? 'H2SO4'} onChange={e => updateParam('makeupSolventComp', e.target.value as SimCompKey)} style={{ width: '100%', padding: '5px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 11.5 }}>
                          <option value="H2SO4">H₂SO₄ (진한황산)</option>
                          <option value="H2O">H₂O (순수)</option>
                          <option value="NaOH">NaOH (가성소다)</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 2 }}>보충량</div>
                        <UnitNumberInput
                          quantity="massFlow"
                          syncKey={`${selectedDef.id}-absmu`}
                          minCanonical={0}
                          value={selectedDef.params.makeupSolventKgH ?? 1800}
                          onValueChange={v => updateParam('makeupSolventKgH', v)}
                          onEnterRun={() => runSimulationNow()}
                          inputStyle={{ padding: '5px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 4, fontSize: 11.5 }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── F) 기액분리기 / 증발관 / 반응기 / 분기기 ── */}
              {selectedDef.unitType === 'separator' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>분리 온도</div>
                      <UnitNumberInput
                        quantity="temp"
                        syncKey={`${selectedDef.id}-sept`}
                        value={selectedDef.params.operTempC ?? 40}
                        onValueChange={v => updateParam('operTempC', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>압력(비우면 전단추종)</div>
                      <UnitNullableNumberInput
                        quantity="pressG"
                        placeholder="전단압 자동"
                        value={selectedDef.params.operPressKgcm2g}
                        onValueChange={v => updateParam('operPressKgcm2g', v)}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                  </div>
                  {(selectedDef.params.calcMode ?? 'simple') === 'rigorous' && (
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>정밀 플래시 열조건</label>
                      <select
                        value={selectedDef.params.flashMode ?? 'isothermal'}
                        onChange={e => updateParam('flashMode', e.target.value)}
                        style={{ width: '100%', padding: '5px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 11.5, marginTop: 2 }}
                      >
                        <option value="isothermal">등온 플래시 (PR-EOS + Pitzer 활동도 VLE)</option>
                        <option value="adiabatic">단열 감압 플래시 (줄-톰슨 온도 변화 반영)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {selectedDef.unitType === 'saturator' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 800 }}>목표 포화염수 농도 (wt%)</label>
                      <BufferedNumberInput
                        syncKey={`${selectedDef.id}-satwt`}
                        step={0.1}
                        min={1}
                        max={30}
                        value={selectedDef.params.targetBrineWtPct ?? 25.6}
                        onValueChange={v => updateParam('targetBrineWtPct', v)}
                        onEnterRun={() => runSimulationNow()}
                        style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 800 }}>침전 슬러지 배출율 (%)</label>
                      <BufferedNumberInput
                        syncKey={`${selectedDef.id}-satsl`}
                        step={0.05}
                        min={0}
                        max={20}
                        value={selectedDef.params.sludgePurgePct ?? 0.25}
                        onValueChange={v => updateParam('sludgePurgePct', v)}
                        onEnterRun={() => runSimulationNow()}
                        style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>포화 운전온도</div>
                    <UnitNumberInput
                      quantity="temp"
                      syncKey={`${selectedDef.id}-satt`}
                      value={selectedDef.params.operTempC ?? 67}
                      onValueChange={v => updateParam('operTempC', v)}
                      onEnterRun={() => runSimulationNow()}
                      inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 2 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedDef.params.autoSaltMakeup !== false}
                        onChange={e => updateParam('autoSaltMakeup', e.target.checked)}
                      />
                      원염(NaCl) 자동보충
                    </label>
                  </div>
                </div>
              )}

              {selectedDef.unitType === 'chelate_tower' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>킬레이트 수지 충진량</div>
                    <UnitNumberInput
                      quantity="volume"
                      syncKey={`${selectedDef.id}-chvol`}
                      minCanonical={0.5}
                      value={selectedDef.params.resinVolM3 ?? 18}
                      onValueChange={v => updateParam('resinVolM3', v)}
                      onEnterRun={() => runSimulationNow()}
                      inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 800 }}>입구 경도 Ca+Mg (ppb)</label>
                    <BufferedNumberInput
                      syncKey={`${selectedDef.id}-chppb`}
                      step={100}
                      min={0}
                      value={selectedDef.params.inletHardnessPpb ?? 1500}
                      onValueChange={v => updateParam('inletHardnessPpb', v)}
                      onEnterRun={() => runSimulationNow()}
                      style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>수지탑 차압 ΔP</div>
                    <UnitNumberInput
                      quantity="deltaP"
                      syncKey={`${selectedDef.id}-chdp`}
                      minCanonical={0}
                      value={selectedDef.params.columnDeltaPKgcm2 ?? 0.8}
                      onValueChange={v => updateParam('columnDeltaPKgcm2', v)}
                      onEnterRun={() => runSimulationNow()}
                      inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>운전 온도</div>
                    <UnitNumberInput
                      quantity="temp"
                      syncKey={`${selectedDef.id}-cht`}
                      value={selectedDef.params.operTempC ?? 65}
                      onValueChange={v => updateParam('operTempC', v)}
                      onEnterRun={() => runSimulationNow()}
                      inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                </div>
              )}

              {selectedDef.unitType === 'desiccant_dryer' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>목표 출구 노점</div>
                    <UnitNumberInput
                      quantity="temp"
                      syncKey={`${selectedDef.id}-dddew`}
                      maxCanonical={20}
                      value={selectedDef.params.targetDewPointC ?? -60}
                      onValueChange={v => updateParam('targetDewPointC', v)}
                      onEnterRun={() => runSimulationNow()}
                      inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>흡착탑 차압 ΔP</div>
                    <UnitNumberInput
                      quantity="deltaP"
                      syncKey={`${selectedDef.id}-dddp`}
                      minCanonical={0}
                      value={selectedDef.params.columnDeltaPKgcm2 ?? 0.35}
                      onValueChange={v => updateParam('columnDeltaPKgcm2', v)}
                      onEnterRun={() => runSimulationNow()}
                      inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                </div>
              )}

              {selectedDef.unitType === 'evaporator' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 800 }}>목표 농축 농도 (wt%)</label>
                    <BufferedNumberInput
                      syncKey={`${selectedDef.id}-evapwt`}
                      step={1}
                      min={1}
                      max={99}
                      value={selectedDef.params.evapTargetConcWt ?? 50}
                      onValueChange={v => updateParam('evapTargetConcWt', v)}
                      onEnterRun={() => runSimulationNow()}
                      style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 2 }}>운전 온도</div>
                    <UnitNumberInput
                      quantity="temp"
                      syncKey={`${selectedDef.id}-evapt`}
                      value={selectedDef.params.operTempC ?? 112}
                      onValueChange={v => updateParam('operTempC', v)}
                      onEnterRun={() => runSimulationNow()}
                      inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 }}
                    />
                  </div>
                </div>
              )}

              {selectedDef.unitType === 'extractor' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 5 }}><FlaskCompIcon size={12} /> 향류 다단 액-액 추출탑 (LLE)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>이론 추출 단수 N (단)</label>
                      <BufferedNumberInput
                        syncKey={`${selectedDef.id}-extst`}
                        step={1}
                        min={1}
                        max={50}
                        value={selectedDef.params.extractorStages ?? 6}
                        onValueChange={v => updateParam('extractorStages', Math.max(1, Math.min(50, Math.round(v))))}
                        onEnterRun={() => runSimulationNow()}
                        style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12, fontWeight: 800 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>추출 운전 온도</div>
                      <UnitNumberInput
                        quantity="temp"
                        syncKey={`${selectedDef.id}-extt`}
                        value={selectedDef.params.operTempC ?? 25}
                        onValueChange={v => updateParam('operTempC', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>보충 추출용매 성분 (미연결 시)</label>
                      <select
                        value={selectedDef.params.extractorSolventComp ?? 'EtOAc'}
                        onChange={e => updateParam('extractorSolventComp', e.target.value as SimCompKey)}
                        style={{ width: '100%', padding: '5px 6px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 11.5 }}
                      >
                        {activeComponents.map(c => (
                          <option key={c} value={c}>
                            {c} ({COMP_META[c]?.label ?? c})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>보충 용매 유량</div>
                      <UnitNumberInput
                        quantity="massFlow"
                        syncKey={`${selectedDef.id}-extsolv`}
                        minCanonical={0}
                        value={selectedDef.params.extractorSolventKgH ?? 800}
                        onValueChange={v => updateParam('extractorSolventKgH', Math.max(0, v))}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedDef.unitType === 'valve' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 5 }}><StreamFlowIcon size={12} /> 단열 등엔탈피 감압·교축 밸브 (H_out = H_in)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>목표 후단 압력 P_out</div>
                      <UnitNumberInput
                        quantity="pressG"
                        syncKey={`${selectedDef.id}-vlvpout`}
                        minCanonical={-0.98}
                        value={selectedDef.params.outletPressKgcm2g ?? 1.0}
                        onValueChange={v => updateParam('outletPressKgcm2g', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12, fontWeight: 800 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>설계 차압 ΔP 참고</div>
                      <UnitNumberInput
                        quantity="deltaP"
                        syncKey={`${selectedDef.id}-vlvdp`}
                        minCanonical={0}
                        value={selectedDef.params.pressureDropKgcm2 ?? 2.0}
                        onValueChange={v => updateParam('pressureDropKgcm2', Math.max(0, v))}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedDef.unitType === 'reactor' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                  {selectedDef.params.reactorConfig && (
                    <div
                      style={{
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: '#0F172A' }}>
                        정밀 반응기 모델 활성 ({String(selectedDef.params.reactorConfig.model ?? 'stoic').toUpperCase()} · {selectedDef.params.reactorConfig.thermalMode ?? 'isothermal'})
                      </span>
                      <button
                        type="button"
                        onClick={() => updateParam('reactorConfig', undefined)}
                        style={{
                          padding: '2px 6px',
                          fontSize: 9.5,
                          fontWeight: 700,
                          borderRadius: 4,
                          border: '1px solid #CBD5E1',
                          background: '#FFFFFF',
                          color: '#1E293B',
                          cursor: 'pointer',
                        }}
                      >
                        프리셋 복귀
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setReactorModalNodeId(selectedDef.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #1E3A8A',
                      background: '#1E3A8A',
                      color: '#FFFFFF',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FlaskCompIcon size={12} /> 반응기 정밀설계 워크벤치 열기 (STOIC·평형·Gibbs·CSTR·PFR) →</span>
                  </button>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>반응 모델</label>
                    <select
                      value={
                        isSimulatorOnlyUser(user)
                          ? 'custom'
                          : (selectedDef.params.reactionPreset ?? (useGenericDefault ? 'custom' : 'hcl_burner'))
                      }
                      onChange={e => updateParam('reactionPreset', e.target.value)}
                      style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 11.5 }}
                    >
                      <option value="custom">사용자 지정 반응식 / 워크벤치 설정</option>
                      {!isSimulatorOnlyUser(user) && (
                        <>
                          <option value="hcl_burner">염산 합성 (Cl₂ + H₂ → 2HCl)</option>
                          <option value="caustic_scrub">폐염소 가성제해 · 차아염소산소다 생성 (Cl₂ + 2NaOH → NaOCl + NaCl + H₂O)</option>
                          <option value="fecl3_chlorination">1B 에칭폐액 염소화 재생 (2FeCl₂ + Cl₂ → 2FeCl₃)</option>
                          <option value="gte_hydrochlorination">2순위 ECH 1단계 글리세린 염소화 (Glycerol + 2HCl → DCH + 2H₂O)</option>
                          <option value="ech_saponification">2순위 ECH 2단계 비누화 고리화 (DCH + NaOH → ECH + NaCl + H₂O)</option>
                          <option value="brine_electrolysis">염수 전해 총괄반응</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>반응기 해석 방식</label>
                    <select
                      value={selectedDef.params.reactorModel ?? 'conversion'}
                      onChange={e => updateParam('reactorModel', e.target.value)}
                      style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 11.5 }}
                    >
                      <option value="conversion">전환율 지정 (화학양론 / 2단계 연속반응)</option>
                      <option value="cstr">연속교반 반응기 (CSTR · Arrhenius 반응속도)</option>
                      <option value="pfr">관형 반응기 (PFR · Arrhenius 반응속도)</option>
                    </select>
                  </div>
                  {(selectedDef.params.reactorModel ?? 'conversion') === 'conversion' ? (
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>목표 전환율 (0~1 또는 %)</label>
                      <BufferedNumberInput
                        syncKey={`${selectedDef.id}-rxnconv`}
                        step={0.005}
                        min={0}
                        max={100}
                        value={selectedDef.params.conversion ?? 0.995}
                        onValueChange={v => updateParam('conversion', v)}
                        onEnterRun={() => runSimulationNow()}
                        style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', marginBottom: 2 }}>유효 반응체적 V</div>
                      <UnitNumberInput
                        quantity="volume"
                        syncKey={`${selectedDef.id}-rxnvol`}
                        minCanonical={0.2}
                        maxCanonical={500}
                        value={selectedDef.params.reactorVolumeM3 ?? 24}
                        onValueChange={v => updateParam('reactorVolumeM3', v)}
                        onEnterRun={() => runSimulationNow()}
                        inputStyle={{ padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12 }}
                      />
                    </div>
                  )}
                </div>
              )}

              {selectedDef.unitType === 'splitter' && (
                <div>
                  <label style={{ fontSize: 10, fontWeight: 800, color: '#475569' }}>1번 출구 분기 비율 (0.01 ~ 0.99)</label>
                  <BufferedNumberInput
                    syncKey={`${selectedDef.id}-splitr`}
                    step={0.05}
                    min={0.001}
                    max={0.999}
                    value={selectedDef.params.splitRatioTop ?? 0.5}
                    onValueChange={v => updateParam('splitRatioTop', v)}
                    onEnterRun={() => runSimulationNow()}
                    style={{ width: '100%', padding: '5px 7px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', borderRadius: 5, fontSize: 12 }}
                  />
                </div>
              )}

              {/* ── 실시간 계산 지표 결과 카드 ── */}
              {selectedUnitRes && (
                <div style={{ marginTop: 2, padding: 10, background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0', fontSize: 11.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                    <div style={{ fontWeight: 900, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <TableGridIcon size={12} /> 실시간 계산 결과
                    </div>
                    <div style={{ display: 'inline-flex', gap: 3 }}>
                      <UnitSelect quantity="massFlow" value={unitSummaryMassUnit} onChange={setUnitSummaryMassUnit} size="xs" />
                      <UnitSelect quantity="heatDuty" value={unitSummaryDutyUnit} onChange={setUnitSummaryDutyUnit} size="xs" />
                      <UnitSelect quantity="power" value={unitSummaryPowerUnit} onChange={setUnitSummaryPowerUnit} size="xs" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: '#475569' }}>
                    <span>유입 / 유출 유량:</span>
                    <b style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0F172A' }}>
                      {formatCanonicalValue('massFlow', selectedUnitRes.inletMassKgH, unitSummaryMassUnit)} /{' '}
                      {formatCanonicalValue('massFlow', selectedUnitRes.outletMassKgH, unitSummaryMassUnit)}{' '}
                      {getUnitLabel('massFlow', unitSummaryMassUnit)}
                    </b>
                  </div>
                  {selectedUnitRes.heatDutyKcalH !== 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: '#475569' }}>
                      <span>열부하 (Duty):</span>
                      <b style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0F172A' }}>
                        {formatCanonicalValue('heatDuty', selectedUnitRes.heatDutyKcalH / 1000, unitSummaryDutyUnit)}{' '}
                        {getUnitLabel('heatDuty', unitSummaryDutyUnit)}
                      </b>
                    </div>
                  )}
                  {selectedUnitRes.shaftPowerKW > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: '#475569' }}>
                      <span>축동력 (Power):</span>
                      <b style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0F172A' }}>
                        {formatCanonicalValue('power', selectedUnitRes.shaftPowerKW, unitSummaryPowerUnit)}{' '}
                        {getUnitLabel('power', unitSummaryPowerUnit)}
                      </b>
                    </div>
                  )}
                  {selectedUnitRes.extraMetrics &&
                    Object.entries(selectedUnitRes.extraMetrics)
                      .filter(([k]) => k !== '인식 유체')
                      .map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 3, fontSize: 11 }}>
                          <span style={{ color: '#475569' }}>{k}:</span>
                          <b style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0F172A', textAlign: 'right' }}>{v}</b>
                        </div>
                      ))}
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #CBD5E1', fontSize: 11, color: '#475569', lineHeight: 1.45 }}>
                      {selectedUnitRes.statusNote}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
        )}
      </div>

      {/* ── Tier-2 엄밀 다단 MESH 정밀증류 워크벤치 모달 ── */}
      {distillModalNodeId && (() => {
        const modalDef = simDefs.find(d => d.id === distillModalNodeId);
        if (!modalDef || modalDef.unitType !== 'distillation') return null;
        const modalRes = unitResultMap.get(modalDef.id)?.distillResult;
        const modalCfg: DistillColumnParams = modalDef.params.distillConfig ?? {};
        const nSt = Math.max(4, Math.min(200, Math.round(modalCfg.totalStages ?? 24)));
        const defFeedSt = Math.max(2, Math.min(nSt - 1, Math.round(modalCfg.feedStage ?? Math.round(nSt * 0.5))));
        const modalFeeds: DistillFeedInput[] = flowEdges
          .filter(e => e.target === modalDef.id)
          .map((e, idx) => {
            const st = streamResultMap.get(e.id);
            const srcDef = simDefs.find(d => d.id === e.source);
            let liveFlows: DistillFeedInput['flowsKgH'] = st
              ? { ...st.flowsKgH }
              : ({} as DistillFeedInput['flowsKgH']);
            let liveTemp = st?.tempC ?? 25;
            let livePress = st?.pressKgcm2g ?? 0.5;
            if (srcDef?.unitType === 'feed') {
              const rawFlows = srcDef.params.feedFlowsKgH ?? {};
              const built = {} as DistillFeedInput['flowsKgH'];
              SIM_COMPS.forEach(c => {
                built[c] = Number(rawFlows[c] ?? 0);
              });
              liveFlows = built;
              liveTemp = srcDef.params.feedTempC ?? liveTemp;
              livePress = srcDef.params.feedPressKgcm2g ?? livePress;
            }
            return {
              edgeId: e.id,
              streamNo: e.streamNo,
              stage: modalCfg.feedStageMap?.[e.id] ?? (idx === 0 ? defFeedSt : Math.min(nSt - 1, defFeedSt + idx * 2)),
              flowsKgH: liveFlows,
              tempC: liveTemp,
              pressKgcm2g: livePress,
            };
          });

        return (
          <DistillationWorkbenchModal
            open={true}
            onClose={() => setDistillModalNodeId(null)}
            unitTag={modalDef.tag}
            unitLabel={modalDef.name}
            config={modalCfg}
            feeds={modalFeeds}
            result={modalRes}
            isSimDirty={isSimDirty}
            initialView={distillModalInitialView}
            onRunSimulation={() => runSimulationNow()}
            onChangeConfig={patch => {
              setSimDefs(prev =>
                prev.map(d =>
                  d.id === modalDef.id
                    ? {
                        ...d,
                        params: {
                          ...d.params,
                          distillConfig: { ...(d.params.distillConfig ?? {}), ...patch },
                        },
                      }
                    : d
                )
              );
            }}
            onOpenChemProDesign={() => {
              setSelectedNodeId(modalDef.id);
              setDistillModalNodeId(null);
              handleOpenUnitDesign(modalDef.id);
            }}
          />
        );
      })()}

      {/* ── 내장 열교환기 · 응축기 · 심냉 액화기 설계 워크벤치 모달 ── */}
      {hxModalNodeId && (() => {
        const hxDef = simDefs.find(d => d.id === hxModalNodeId);
        if (
          !hxDef ||
          (hxDef.unitType !== 'hex' && hxDef.unitType !== 'cooler' && hxDef.unitType !== 'liquefier')
        ) {
          return null;
        }
        const procInStreams = flowEdges
          .filter(e => e.target === hxDef.id && e.targetPort !== 'util_in')
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        const utilInStreams = flowEdges
          .filter(e => e.target === hxDef.id && e.targetPort === 'util_in')
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        const procOutStreams = flowEdges
          .filter(e => e.source === hxDef.id && e.sourcePort !== 'util_out')
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));
        const utilOutStreams = flowEdges
          .filter(e => e.source === hxDef.id && e.sourcePort === 'util_out')
          .map(e => streamResultMap.get(e.id))
          .filter((s): s is SolvedStream => Boolean(s));

        return (
          <HeatExchangerWorkbenchModal
            open={true}
            onClose={() => setHxModalNodeId(null)}
            unitTag={hxDef.tag}
            unitLabel={hxDef.name}
            unitType={hxDef.unitType}
            params={hxDef.params}
            procInStreams={procInStreams}
            procOutStreams={procOutStreams}
            utilInStreams={utilInStreams}
            utilOutStreams={utilOutStreams}
            unitResult={unitResultMap.get(hxDef.id)}
            isSimDirty={isSimDirty}
            initialView={hxModalInitialView}
            onRunSimulation={() => runSimulationNow()}
            onOpenChemProDesign={() => {
              const payload = buildChemProHandoffPayload(
                hxDef,
                flowEdges,
                solved.streams,
                unitResultMap.get(hxDef.id),
                isPlantSimMode ? workspaceMode : '6. 공정 시뮬레이터'
              );
              setHxModalNodeId(null);
              if (payload) {
                saveChemProHandoffPayload(payload);
                router.push(`/unit-equipment?tab=${encodeURIComponent(payload.tab)}&handoff=1&ts=${payload.timestamp}`);
              } else {
                router.push('/unit-equipment?tab=hx');
              }
            }}
            onChangeParams={patch => {
              setSimDefs(prev =>
                prev.map(d =>
                  d.id === hxDef.id
                    ? { ...d, params: { ...d.params, ...patch } }
                    : d
                )
              );
            }}
          />
        );
      })()}

      {/* ── 공정 성분 & 열역학 물성 패키지(AUTO / ENRTL / NRTL / PR / SRK) 설정 모달 ── */}
      <ComponentPropertySetupModal
        open={compSetupModalOpen}
        onClose={() => setCompSetupModalOpen(false)}
        activeComponents={activeComponents}
        propertyMethod={propertyMethod}
        currentFeedFlows={feedSummaryForThermo.flows}
        maxPressKgcm2g={feedSummaryForThermo.maxP}
        currentPlantContext={workspaceMode}
        onApply={(nextComps, nextMethod) => {
          const merged = mergeSheetFeedComponents(simDefs, nextComps);
          setActiveComponents(merged);
          setPropertyMethod(nextMethod);
          setCompSetupModalOpen(false);
          runSimulationNow(simDefs, flowEdges, nextMethod, merged);
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
        propertyMethod={propertyMethod}
        tearMethod={tearMethod}
        onChangeTearMethod={nextTear => {
          setTearMethod(nextTear);
          runSimulationNow(simDefs, flowEdges, propertyMethod, activeComponents, nextTear);
        }}
        designSpecs={designSpecs}
        onChangeDesignSpecs={setDesignSpecs}
        onApplyAdjustedNodes={adjustedNodes => {
          setSimDefs(adjustedNodes);
          runSimulationNow(adjustedNodes, flowEdges, propertyMethod, activeComponents, tearMethod);
        }}
      />

      {/* ── 화학반응기 5종 정밀설계 워크벤치 모달 (STOIC / EQUIL / GIBBS / CSTR / PFR) ── */}
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
          propertyMethod !== 'AUTO'
            ? propertyMethod
            : (solved.propertyMethodUsed ?? autoPropertyRecommendation.method);
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
              runSimulationNow(nextDefs, flowEdges, propertyMethod, activeComponents, tearMethod);
            }}
          />
        );
      })()}
    </div>
  );
}

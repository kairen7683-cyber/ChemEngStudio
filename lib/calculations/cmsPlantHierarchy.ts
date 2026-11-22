// ============================================================================
// PLANT 04 — 클로로메탄 (CMS: MC → MCL · CFM · CTC) 4-Sheet 5탑 상용 계층 공정
// ============================================================================
// Master : 액화염소 기화(E-101) → MC 액상 자유라디칼 염소화(R-101) → 냉각(E-102)
//          → HCl 탈기탑(T-201, 60단) → MC 순환탑(T-202, 50단, NO MCL 재순환)
//          → 순환 펌프(P-202) → Azeo 공비·경질 분리탑(T-203, 30단)
//          → MCL 정제탑(T-301, 80단, 99.99%) → CFM/CTC 분리탑(T-302, 120단, 99.99%)
// Sub 100: 염소 기화 · 자유라디칼 반응 섹션 (sub_cms_100_rxn)
// Sub 200: HCl(60단) · MC(50단) 순환 · Azeo(30단) 분리 섹션 (sub_cms_200_rec)
// Sub 300: MCL(80단) · CFM(120단) 고순도 정제 및 헤비 폐기 섹션 (sub_cms_300_purif)
// ============================================================================

import {
  emptySimFlows,
  solveFlowsheet,
  type FlowEdgeDef,
  type FlowNodeDef,
  type SolvedStream,
} from './flowsheetSolver';
import { type ReactorConfig } from './chemicalReactor';
import {
  applyMasterBoundaryToSubDefs,
  type SheetRuntimeData,
  type SubSheetTemplate,
} from './fullPlantHierarchy';

// ── R-101 고압 액상 자유라디칼 염소화(AIBN 개시) 반응기 공통 설정 ──
export const CMS_REACTOR_CONFIG: ReactorConfig = {
  presetId: 'cms_aibn_liquid_chlorination',
  model: 'pfr',
  thermalMode: 'isothermal',
  operTempC: 120.0,
  operPressKgcm2g: 24.0,
  phaseMode: 'liquid',
  propertyMethod: 'PR',
  tubeCount: 60,
  tubeDiamM: 0.25,
  tubeLengthM: 12.0,
  reactions: [
    {
      id: 'R1_MC_MCL',
      name: 'R1: CH3Cl + Cl2 -> CH2Cl2 + HCl',
      stoic: { CH3Cl: -1, Cl2: -1, CH2Cl2: 1, HCl: 1 },
      keyComp: 'CH3Cl',
      k0Forward: 8.16e3,
      EaForwardKJmol: 58.0,
    },
    {
      id: 'R2_MCL_CFM',
      name: 'R2: CH2Cl2 + Cl2 -> CHCl3 + HCl',
      stoic: { CH2Cl2: -1, Cl2: -1, CHCl3: 1, HCl: 1 },
      keyComp: 'CH2Cl2',
      k0Forward: 1.517e4,
      EaForwardKJmol: 57.5,
    },
    {
      id: 'R3_CFM_CTC',
      name: 'R3: CHCl3 + Cl2 -> CCl4 + HCl',
      stoic: { CHCl3: -1, Cl2: -1, CCl4: 1, HCl: 1 },
      keyComp: 'CHCl3',
      k0Forward: 1.278e4,
      EaForwardKJmol: 59.5,
    },
    {
      id: 'R4_HEAVY_PCE',
      name: 'R4: CH2Cl2 + CHCl3 + Cl2 -> C2Cl4 + 3 HCl',
      stoic: { CH2Cl2: -1, CHCl3: -1, Cl2: -1, C2Cl4: 1, HCl: 3 },
      keyComp: 'CHCl3',
      k0Forward: 2.117e3,
      EaForwardKJmol: 64.0,
    },
  ],
};

// ── 증류탑 공통 엄밀 설계 사양 (T-201 60단 · T-202 50단 · T-203 30단 · T-301 80단 · T-302 120단 실제 트레이 기준) ──
const C201_DISTILL_CONFIG = {
  thermoModel: 'PENG_ROB' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'partial' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 62,
  feedStage: 26,
  topPressKgcm2g: 17.5,
  stageDeltaPKgcm2: 0.008,
  murphreeEffPct: 68,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 3.2,
  splitSpecType: 'd_over_f_mole' as const,
  splitSpecValue: 0.323,
  spec1: {
    enabled: true,
    streamTarget: 'distillate' as const,
    component: 'HCl' as const,
    metric: 'recovery_pct' as const,
    targetValue: 99.99,
    varyParam: 'd_over_f' as const,
    varyMin: 0.25,
    varyMax: 0.42,
  },
};

const C202_DISTILL_CONFIG = {
  thermoModel: 'PENG_ROB' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'total' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 52,
  feedStage: 22,
  topPressKgcm2g: 6.5,
  stageDeltaPKgcm2: 0.010,
  murphreeEffPct: 68,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 3.0,
  splitSpecType: 'd_over_f_mole' as const,
  splitSpecValue: 0.65,
  spec1: {
    enabled: true,
    streamTarget: 'distillate' as const,
    component: 'CH3Cl' as const,
    metric: 'recovery_pct' as const,
    targetValue: 99.98,
    varyParam: 'd_over_f' as const,
    varyMin: 0.55,
    varyMax: 0.72,
  },
};

const C203_DISTILL_CONFIG = {
  thermoModel: 'NRTL' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'total' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 32,
  feedStage: 6,
  topPressKgcm2g: 0.6,
  stageDeltaPKgcm2: 0.006,
  murphreeEffPct: 68,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 20.0,
  splitSpecType: 'd_over_f_mole' as const,
  splitSpecValue: 0.008,
};

const C301_DISTILL_CONFIG = {
  thermoModel: 'NRTL' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'total' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 82,
  feedStage: 40,
  topPressKgcm2g: 0.8,
  stageDeltaPKgcm2: 0.005,
  murphreeEffPct: 68,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 3.8,
  splitSpecType: 'd_over_f_mole' as const,
  splitSpecValue: 0.638,
  spec1: {
    enabled: true,
    streamTarget: 'distillate' as const,
    component: 'CH2Cl2' as const,
    metric: 'purity_wt_pct' as const,
    targetValue: 99.99,
    varyParam: 'd_over_f' as const,
    varyMin: 0.620,
    varyMax: 0.652,
  },
};

const C302_DISTILL_CONFIG = {
  thermoModel: 'NRTL' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'total' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 122,
  feedStage: 55,
  topPressKgcm2g: 0.3,
  stageDeltaPKgcm2: 0.0045,
  murphreeEffPct: 68,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 4.0,
  splitSpecType: 'd_over_f_mole' as const,
  splitSpecValue: 0.854,
  spec1: {
    enabled: true,
    streamTarget: 'distillate' as const,
    component: 'CHCl3' as const,
    metric: 'purity_wt_pct' as const,
    targetValue: 99.99,
    varyParam: 'd_over_f' as const,
    varyMin: 0.840,
    varyMax: 0.856,
  },
};

// ============================================================================
// 1. MASTER CMS TEMPLATE (전공정 마스터)
// ============================================================================
export const MASTER_CMS_TEMPLATE: SubSheetTemplate = {
  id: 'master',
  sectionCode: 'MASTER',
  shortTabLabel: 'CMS 전공정 마스터',
  title: 'PLANT 04 · 클로로메탄(CMS) 상용 5탑 공정 마스터 (Cl₂ 220 · MCL 120 · CFM 80 T/D)',
  subtitle:
    '액화염소 기화(E-101) → AIBN 염소화(R-101) → HCl 탈기(T-201 60단) → MC 순환(T-202 50단) → Azeo 분리(T-203 30단) → MCL(T-301 80단)·CFM(T-302 120단) 99.99%',
  parentMasterNodeIds: [],
  nodes: [
    {
      id: 'cms_m_cl2',
      tag: 'FEED-LIQ-CL2',
      name: '액화염소 원료 (220 T/D)',
      unitType: 'feed',
      position: { x: 40, y: 110 },
      params: {
        feedTempC: 25.0,
        feedPressKgcm2g: 25.5,
        feedFlowsKgH: emptySimFlows({ Cl2: 9166.7 }),
      },
    },
    {
      id: 'cms_m_e101',
      tag: 'E-101',
      name: '액화염소 기화기 (95°C 기상 공급)',
      unitType: 'hex',
      subSheetId: 'sub_cms_100_rxn',
      subSheetBadge: '100 SEC',
      position: { x: 250, y: 110 },
      params: {
        calcMode: 'rigorous',
        operTempC: 95.0,
        operPressKgcm2g: 24.8,
        refrigerantPreset: 'steam_lp',
      },
    },
    {
      id: 'cms_m_mc',
      tag: 'FEED-MC',
      name: '신규 메틸클로라이드 (MC) 원료',
      unitType: 'feed',
      position: { x: 40, y: 260 },
      params: {
        feedTempC: 35.0,
        feedPressKgcm2g: 25.0,
        feedFlowsKgH: emptySimFlows({ CH3Cl: 4620.0, H2O: 0.25 }),
      },
    },
    {
      id: 'cms_m_aibn',
      tag: 'FEED-AIBN',
      name: 'AIBN 라디칼 개시제 주입 (350 ppm)',
      unitType: 'feed',
      position: { x: 40, y: 400 },
      params: {
        feedTempC: 25.0,
        feedPressKgcm2g: 25.0,
        feedFlowsKgH: emptySimFlows({ CH2Cl2: 105.0, N2: 0.6, C2Cl4: 3.4 }),
      },
    },
    {
      id: 'cms_m_mix1',
      tag: 'A-101',
      name: '반응기 원료·순환 MC 혼합기',
      unitType: 'mixer',
      subSheetId: 'sub_cms_100_rxn',
      subSheetBadge: '100 SEC',
      position: { x: 460, y: 250 },
      params: {},
    },
    {
      id: 'cms_m_r101',
      tag: 'R-101',
      name: '고압 액상 자유라디칼 염소화 반응기',
      unitType: 'reactor',
      subSheetId: 'sub_cms_100_rxn',
      subSheetBadge: '100 SEC',
      position: { x: 670, y: 250 },
      params: {
        calcMode: 'rigorous',
        operTempC: 120.0,
        operPressKgcm2g: 24.0,
        reactorConfig: structuredClone(CMS_REACTOR_CONFIG),
      },
    },
    {
      id: 'cms_m_e102',
      tag: 'E-102',
      name: '반응 생성물 냉각기 (58°C)',
      unitType: 'cooler',
      subSheetId: 'sub_cms_100_rxn',
      subSheetBadge: '100 SEC',
      position: { x: 880, y: 250 },
      params: {
        calcMode: 'rigorous',
        operTempC: 58.0,
        operPressKgcm2g: 23.2,
      },
    },
    {
      id: 'cms_m_c201',
      tag: 'T-201',
      name: '고압 무수염산(HCl) 스트리퍼 (60단)',
      unitType: 'distillation',
      subSheetId: 'sub_cms_200_rec',
      subSheetBadge: '200 SEC',
      position: { x: 1100, y: 240 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C201_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms_m_ahcl',
      tag: 'PROD-AHCL',
      name: '고순도 부생 무수염산 (AHCl)',
      unitType: 'product',
      position: { x: 1330, y: 80 },
      params: {},
    },
    {
      id: 'cms_m_c202',
      tag: 'T-202',
      name: '미반응 MC 순환 분리탑 (50단)',
      unitType: 'distillation',
      subSheetId: 'sub_cms_200_rec',
      subSheetBadge: '200 SEC',
      position: { x: 1330, y: 280 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C202_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms_m_p202',
      tag: 'P-202',
      name: '미반응 MC 고압 순환 펌프 (25 kG)',
      unitType: 'pump',
      subSheetId: 'sub_cms_200_rec',
      subSheetBadge: '200 SEC',
      position: { x: 1120, y: 450 },
      params: {
        outletPressKgcm2g: 25.0,
        efficiency: 0.72,
      },
    },
    {
      id: 'cms_m_c203',
      tag: 'T-203',
      name: 'Azeo 공비·경질 분리탑 (30단)',
      unitType: 'distillation',
      subSheetId: 'sub_cms_200_rec',
      subSheetBadge: '200 SEC',
      position: { x: 1560, y: 290 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C203_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms_m_azeo',
      tag: 'OUT-AZEO-PURGE',
      name: '공비·경질 불순물 퍼지',
      unitType: 'product',
      position: { x: 1790, y: 110 },
      params: {},
    },
    {
      id: 'cms_m_c301',
      tag: 'T-301',
      name: '메틸렌클로라이드(MCL) 고순도 정제탑 (80단 · 99.99%)',
      unitType: 'distillation',
      subSheetId: 'sub_cms_300_purif',
      subSheetBadge: '300 SEC',
      position: { x: 1800, y: 310 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C301_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms_m_mcl',
      tag: 'PROD-MCL',
      name: '고순도 디클로로메탄 제품 (CH₂Cl₂ ≥99.99% · 120 T/D)',
      unitType: 'product',
      position: { x: 2040, y: 170 },
      params: {},
    },
    {
      id: 'cms_m_c302',
      tag: 'T-302',
      name: '클로로포름(CFM) 정제 및 CTC 분리탑 (120단 · 99.99%)',
      unitType: 'distillation',
      subSheetId: 'sub_cms_300_purif',
      subSheetBadge: '300 SEC',
      position: { x: 2040, y: 390 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C302_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms_m_cfm',
      tag: 'PROD-CFM',
      name: '고순도 클로로포름 제품 (CHCl₃ ≥99.99% · 80 T/D)',
      unitType: 'product',
      position: { x: 2280, y: 270 },
      params: {},
    },
    {
      id: 'cms_m_waste',
      tag: 'OUT-CTC-WASTE',
      name: '잔류 CTC·헤비물질 폐기',
      unitType: 'product',
      position: { x: 2280, y: 460 },
      params: {},
    },
  ],
  edges: [
    { id: 'cms_e1', streamNo: '101', name: '액화 Cl2 원료', source: 'cms_m_cl2', target: 'cms_m_e101', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms_e2', streamNo: '102', name: '기화 Cl2 가스', source: 'cms_m_e101', target: 'cms_m_mix1', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms_e3', streamNo: '103', name: '신규 MC 원료', source: 'cms_m_mc', target: 'cms_m_mix1', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms_e4', streamNo: '104', name: 'AIBN 개시제', source: 'cms_m_aibn', target: 'cms_m_mix1', sourcePort: 'out', targetPort: 'in' },
    {
      id: 'cms_e5',
      streamNo: '214',
      name: '순환 미반응 MC',
      source: 'cms_m_p202',
      target: 'cms_m_mix1',
      sourcePort: 'out',
      targetPort: 'in',
      tearGuess: {
        flowsKgH: { CH3Cl: 9085.0 },
        tempC: 41.5,
        pressKgcm2g: 25.0,
      },
    },
    { id: 'cms_e6', streamNo: '105', name: '반응기 원료', source: 'cms_m_mix1', target: 'cms_m_r101', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms_e7', streamNo: '106', name: '반응기 유출물', source: 'cms_m_r101', target: 'cms_m_e102', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms_e8', streamNo: '201', name: '냉각 반응물', source: 'cms_m_e102', target: 'cms_m_c201', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms_e9', streamNo: '202', name: '부생 무수염산 (AHCl)', source: 'cms_m_c201', target: 'cms_m_ahcl', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms_e10', streamNo: '203', name: '탈염산 클로로메탄액', source: 'cms_m_c201', target: 'cms_m_c202', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'cms_e11', streamNo: '211', name: '회수 미반응 MC', source: 'cms_m_c202', target: 'cms_m_p202', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms_e11b', streamNo: '204', name: '조 MCL/CFM/CTC·공비액', source: 'cms_m_c202', target: 'cms_m_c203', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'cms_e11c', streamNo: '205', name: '공비·경질 퍼지', source: 'cms_m_c203', target: 'cms_m_azeo', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms_e12', streamNo: '301', name: '탈수 조 MCL/CFM/CTC', source: 'cms_m_c203', target: 'cms_m_c301', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'cms_e13', streamNo: '302', name: '정제 MCL 제품', source: 'cms_m_c301', target: 'cms_m_mcl', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms_e14', streamNo: '303', name: '조 CFM/CTC액', source: 'cms_m_c301', target: 'cms_m_c302', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'cms_e15', streamNo: '304', name: '정제 CFM 제품', source: 'cms_m_c302', target: 'cms_m_cfm', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms_e16', streamNo: '305', name: '잔류 CTC/PCE 폐기', source: 'cms_m_c302', target: 'cms_m_waste', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

// ============================================================================
// 2. SUB 100 — 염소 기화 · AIBN 액상 자유라디칼 반응 섹션
// ============================================================================
export const SUB_CMS_100_TEMPLATE: SubSheetTemplate = {
  id: 'sub_cms_100_rxn',
  sectionCode: '100',
  shortTabLabel: '🔥 100 염소 기화·반응',
  title: '100 SEC 세부공정 — 액화염소 기화(E-101) · MC 액상 자유라디칼 염소화(R-101) · 냉각(E-102)',
  subtitle:
    '액화 Cl₂ 기화(25°C L → 95°C G) + 신규·순환 CH₃Cl 합산 공급 + AIBN 350 ppm → 120°C·24kG 가압 PFR 반응 → 58°C 냉각',
  parentMasterNodeIds: ['cms_m_e101', 'cms_m_mix1', 'cms_m_r101', 'cms_m_e102'],
  nodes: [
    {
      id: 'cms1_cl2',
      tag: 'FEED-LIQ-CL2',
      name: '액화염소 원료 (220 T/D)',
      unitType: 'feed',
      position: { x: 60, y: 110 },
      params: {
        boundaryFromMasterNodeId: 'cms_m_e101',
        feedTempC: 25.0,
        feedPressKgcm2g: 25.5,
        feedFlowsKgH: emptySimFlows({ Cl2: 9166.7 }),
      },
    },
    {
      id: 'cms1_e101',
      tag: 'E-101',
      name: '액화염소 기화기 (95°C 기상 공급)',
      unitType: 'hex',
      position: { x: 280, y: 110 },
      params: {
        calcMode: 'rigorous',
        operTempC: 95.0,
        operPressKgcm2g: 24.8,
        refrigerantPreset: 'steam_lp',
      },
    },
    {
      id: 'cms1_mc',
      tag: 'FEED-MC-COMB',
      name: '신규 + 순환 메틸클로라이드 (MC 합산)',
      unitType: 'feed',
      position: { x: 60, y: 260 },
      params: {
        feedTempC: 55.4,
        feedPressKgcm2g: 25.0,
        feedFlowsKgH: emptySimFlows({ CH3Cl: 13706.5, Cl2: 6.1, HCl: 0.1 }),
      },
    },
    {
      id: 'cms1_aibn',
      tag: 'FEED-AIBN',
      name: 'AIBN 라디칼 개시제 주입 (350 ppm)',
      unitType: 'feed',
      position: { x: 60, y: 400 },
      params: {
        feedTempC: 25.0,
        feedPressKgcm2g: 25.0,
        feedFlowsKgH: emptySimFlows({ CH2Cl2: 105.0, N2: 0.6, C2Cl4: 3.4 }),
      },
    },
    {
      id: 'cms1_mix1',
      tag: 'A-101',
      name: '반응기 원료·순환 MC 혼합기',
      unitType: 'mixer',
      position: { x: 500, y: 250 },
      params: {},
    },
    {
      id: 'cms1_r101',
      tag: 'R-101',
      name: '고압 액상 자유라디칼 염소화 반응기',
      unitType: 'reactor',
      position: { x: 720, y: 250 },
      params: {
        calcMode: 'rigorous',
        operTempC: 120.0,
        operPressKgcm2g: 24.0,
        reactorConfig: structuredClone(CMS_REACTOR_CONFIG),
      },
    },
    {
      id: 'cms1_e102',
      tag: 'E-102',
      name: '반응 생성물 냉각기 (58°C)',
      unitType: 'cooler',
      position: { x: 940, y: 250 },
      params: {
        calcMode: 'rigorous',
        operTempC: 58.0,
        operPressKgcm2g: 23.2,
      },
    },
    {
      id: 'cms1_out',
      tag: 'TO-200-SEC',
      name: '냉각 반응 생성물 (→ 200 SEC)',
      unitType: 'product',
      position: { x: 1160, y: 250 },
      params: {},
    },
  ],
  edges: [
    { id: 'cms1_e1', streamNo: '101', name: '액화 Cl2', source: 'cms1_cl2', target: 'cms1_e101', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms1_e2', streamNo: '102', name: '기화 Cl2', source: 'cms1_e101', target: 'cms1_mix1', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms1_e3', streamNo: '103M', name: '합산 MC 원료', source: 'cms1_mc', target: 'cms1_mix1', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms1_e4', streamNo: '104', name: 'AIBN 개시제', source: 'cms1_aibn', target: 'cms1_mix1', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms1_e5', streamNo: '105', name: '반응기 원료', source: 'cms1_mix1', target: 'cms1_r101', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms1_e6', streamNo: '106', name: '반응기 유출물', source: 'cms1_r101', target: 'cms1_e102', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms1_e7', streamNo: '201', name: '200 SEC 공급', source: 'cms1_e102', target: 'cms1_out', sourcePort: 'out', targetPort: 'in' },
  ],
};

// ============================================================================
// 3. SUB 200 — 무수염산(HCl) · 미반응 MC 순환 회수 섹션
// ============================================================================
export const SUB_CMS_200_TEMPLATE: SubSheetTemplate = {
  id: 'sub_cms_200_rec',
  sectionCode: '200',
  shortTabLabel: '❄️ 200 HCl·MC·Azeo 분리',
  title: '200 SEC 세부공정 — HCl 탈거(T-201 60단) · MC 순환(T-202 50단 · P-202) · Azeo 분리(T-203 30단)',
  subtitle:
    '17.5kG 무수 HCl 회수(T-201 60단) → 6.5kG CH₃Cl 전용 회수(T-202 50단, NO MCL 재순환) → T-203(30단) 공비·수분/경질 퍼지',
  parentMasterNodeIds: ['cms_m_c201', 'cms_m_c202', 'cms_m_p202', 'cms_m_c203'],
  nodes: [
    {
      id: 'cms2_feed',
      tag: 'FROM-100-E102',
      name: '냉각 반응 생성물 (E-102 유출)',
      unitType: 'feed',
      position: { x: 60, y: 240 },
      params: {
        boundaryFromMasterNodeId: 'cms_m_c201',
        feedTempC: 58.0,
        feedPressKgcm2g: 23.2,
        feedFlowsKgH: emptySimFlows({
          HCl: 4736.2,
          CH3Cl: 9088.6,
          CH2Cl2: 5047.8,
          CHCl3: 3371.1,
          CCl4: 685.9,
          C2Cl4: 53.6,
          Cl2: 6.7,
          N2: 0.6,
          H2O: 0.25,
        }),
      },
    },
    {
      id: 'cms2_c201',
      tag: 'T-201',
      name: '고압 무수염산(HCl) 스트리퍼 (60단)',
      unitType: 'distillation',
      position: { x: 310, y: 240 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C201_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms2_ahcl',
      tag: 'PROD-AHCL',
      name: '고순도 부생 무수염산 (AHCl)',
      unitType: 'product',
      position: { x: 560, y: 100 },
      params: {},
    },
    {
      id: 'cms2_c202',
      tag: 'T-202',
      name: '미반응 MC 순환 분리탑 (50단)',
      unitType: 'distillation',
      position: { x: 560, y: 290 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C202_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms2_p202',
      tag: 'P-202',
      name: '미반응 MC 고압 순환 펌프 (25 kG)',
      unitType: 'pump',
      position: { x: 810, y: 140 },
      params: {
        outletPressKgcm2g: 25.0,
        efficiency: 0.72,
      },
    },
    {
      id: 'cms2_rec_mc',
      tag: 'TO-100-MIX101',
      name: '순환 미반응 MC (→ 100 SEC A-101)',
      unitType: 'product',
      position: { x: 1080, y: 140 },
      params: {},
    },
    {
      id: 'cms2_c203',
      tag: 'T-203',
      name: 'Azeo 공비·경질 분리탑 (30단)',
      unitType: 'distillation',
      position: { x: 810, y: 340 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C203_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms2_azeo_purge',
      tag: 'OUT-AZEO-PURGE',
      name: '공비·경질 불순물 퍼지',
      unitType: 'product',
      position: { x: 1080, y: 260 },
      params: {},
    },
    {
      id: 'cms2_crude_mcl',
      tag: 'TO-300-SEC',
      name: '탈수 조 MCL/CFM/CTC 혼합액 (→ 300 SEC)',
      unitType: 'product',
      position: { x: 1080, y: 400 },
      params: {},
    },
  ],
  edges: [
    { id: 'cms2_e1', streamNo: '201', name: '반응 생성물', source: 'cms2_feed', target: 'cms2_c201', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms2_e2', streamNo: '202', name: '부생 무수염산', source: 'cms2_c201', target: 'cms2_ahcl', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms2_e3', streamNo: '203', name: '탈염산액', source: 'cms2_c201', target: 'cms2_c202', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'cms2_e4', streamNo: '211', name: '미반응 MC 회수액', source: 'cms2_c202', target: 'cms2_p202', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms2_e5', streamNo: '214', name: '승압 순환 MC', source: 'cms2_p202', target: 'cms2_rec_mc', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms2_e5b', streamNo: '204', name: '조 MCL/CFM/CTC·공비액', source: 'cms2_c202', target: 'cms2_c203', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'cms2_e5c', streamNo: '205', name: '공비·경질 퍼지', source: 'cms2_c203', target: 'cms2_azeo_purge', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms2_e6', streamNo: '301', name: '300 SEC 공급', source: 'cms2_c203', target: 'cms2_crude_mcl', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

// ============================================================================
// 4. SUB 300 — MCL · CFM 고순도 정제 및 CTC/헤비 폐기 섹션
// ============================================================================
export const SUB_CMS_300_TEMPLATE: SubSheetTemplate = {
  id: 'sub_cms_300_purif',
  sectionCode: '300',
  shortTabLabel: '🧪 300 MCL·CFM 정제',
  title: '300 SEC 세부공정 — MCL 정제탑(T-301 80단) · 제품 냉각기(E-301) · CFM/CTC 분리탑(T-302 120단)',
  subtitle:
    'NRTL 정밀 분별증류: T-301(80단 · 0.8kG, CH₂Cl₂ ≥99.99% · 120 T/D) + E-301(35°C) / T-302(120단 · 0.3kG, CHCl₃ ≥99.99% · 80 T/D) · CTC 폐기',
  parentMasterNodeIds: ['cms_m_c301', 'cms_m_c302'],
  nodes: [
    {
      id: 'cms3_feed',
      tag: 'FROM-200-C203',
      name: '탈수 조 MCL/CFM/CTC 혼합액',
      unitType: 'feed',
      position: { x: 60, y: 260 },
      params: {
        boundaryFromMasterNodeId: 'cms_m_c301',
        feedTempC: 55.0,
        feedPressKgcm2g: 0.8,
        feedFlowsKgH: emptySimFlows({
          CH2Cl2: 4988.0,
          CHCl3: 3371.0,
          CCl4: 686.0,
          C2Cl4: 53.6,
        }),
      },
    },
    {
      id: 'cms3_c301',
      tag: 'T-301',
      name: '메틸렌클로라이드(MCL) 고순도 정제탑 (80단 · 99.99%)',
      unitType: 'distillation',
      position: { x: 320, y: 260 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C301_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms3_e301',
      tag: 'E-301',
      name: 'MCL 제품 냉각기 (35°C 저장)',
      unitType: 'cooler',
      position: { x: 580, y: 120 },
      params: {
        calcMode: 'rigorous',
        operTempC: 35.0,
        operPressKgcm2g: 0.6,
      },
    },
    {
      id: 'cms3_mcl',
      tag: 'PROD-MCL',
      name: '고순도 디클로로메탄 제품 (CH₂Cl₂ ≥99.99% · 120 T/D)',
      unitType: 'product',
      position: { x: 840, y: 120 },
      params: {},
    },
    {
      id: 'cms3_c302',
      tag: 'T-302',
      name: '클로로포름(CFM) 정제 및 CTC 분리탑 (120단 · 99.99%)',
      unitType: 'distillation',
      position: { x: 580, y: 340 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C302_DISTILL_CONFIG),
      },
    },
    {
      id: 'cms3_cfm',
      tag: 'PROD-CFM',
      name: '고순도 클로로포름 제품 (CHCl₃ ≥99.99% · 80 T/D)',
      unitType: 'product',
      position: { x: 840, y: 260 },
      params: {},
    },
    {
      id: 'cms3_waste',
      tag: 'OUT-CTC-WASTE',
      name: '잔류 CTC·헤비물질 폐기',
      unitType: 'product',
      position: { x: 840, y: 420 },
      params: {},
    },
  ],
  edges: [
    { id: 'cms3_e1', streamNo: '301', name: '조 MCL/CFM/CTC', source: 'cms3_feed', target: 'cms3_c301', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms3_e2', streamNo: '302A', name: 'T-301 탑정 MCL', source: 'cms3_c301', target: 'cms3_e301', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms3_e3', streamNo: '302', name: '냉각 정제 MCL', source: 'cms3_e301', target: 'cms3_mcl', sourcePort: 'out', targetPort: 'in' },
    { id: 'cms3_e4', streamNo: '303', name: '조 CFM/CTC액', source: 'cms3_c301', target: 'cms3_c302', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'cms3_e5', streamNo: '304', name: '정제 CFM 제품', source: 'cms3_c302', target: 'cms3_cfm', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'cms3_e6', streamNo: '305', name: '잔류 CTC/PCE 폐기', source: 'cms3_c302', target: 'cms3_waste', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

export const ALL_CMS_HIERARCHY_TEMPLATES: SubSheetTemplate[] = [
  MASTER_CMS_TEMPLATE,
  SUB_CMS_100_TEMPLATE,
  SUB_CMS_200_TEMPLATE,
  SUB_CMS_300_TEMPLATE,
];

function templateToRuntime(tpl: SubSheetTemplate): SheetRuntimeData {
  const positions: Record<string, { x: number; y: number }> = {};
  const simDefs: FlowNodeDef[] = tpl.nodes.map(n => {
    positions[n.id] = { x: n.position.x, y: n.position.y };
    return {
      id: n.id,
      tag: n.tag,
      name: n.name,
      unitType: n.unitType,
      subSheetId: n.subSheetId,
      subSheetBadge: n.subSheetBadge,
      params: structuredClone(n.params),
    };
  });
  return {
    id: tpl.id,
    sectionCode: tpl.sectionCode,
    shortTabLabel: tpl.shortTabLabel,
    title: tpl.title,
    subtitle: tpl.subtitle,
    parentMasterNodeIds: [...tpl.parentMasterNodeIds],
    simDefs,
    positions,
    flowEdges: structuredClone(tpl.edges),
  };
}

export function syncCmsSubDefsFromMaster(
  targetSheetId: string,
  subDefs: FlowNodeDef[],
  masterEdges: FlowEdgeDef[],
  masterStreams: SolvedStream[],
): { syncedDefs: FlowNodeDef[]; syncedDescriptions: string[] } {
  const { syncedDefs, syncedDescriptions } = applyMasterBoundaryToSubDefs(
    subDefs,
    masterEdges,
    masterStreams,
  );
  if (targetSheetId !== 'sub_cms_100_rxn') {
    return { syncedDefs, syncedDescriptions };
  }

  const freshMcEdge = masterEdges.find(
    e => e.source === 'cms_m_mc' && e.target === 'cms_m_mix1',
  );
  const recMcEdge = masterEdges.find(
    e => e.source === 'cms_m_p202' && e.target === 'cms_m_mix1',
  );
  const freshAibnEdge = masterEdges.find(
    e => e.source === 'cms_m_aibn' && e.target === 'cms_m_mix1',
  );
  const freshMcStream = freshMcEdge
    ? masterStreams.find(s => s.edgeId === freshMcEdge.id)
    : undefined;
  const recMcStream = recMcEdge
    ? masterStreams.find(s => s.edgeId === recMcEdge.id)
    : undefined;
  const freshAibnStream = freshAibnEdge
    ? masterStreams.find(s => s.edgeId === freshAibnEdge.id)
    : undefined;

  const extraDescs = [...syncedDescriptions];
  const finalDefs = syncedDefs.map(def => {
    if (def.id === 'cms1_mc' && (freshMcStream || recMcStream)) {
      const combined = emptySimFlows();
      let totMass = 0;
      let weightedT = 0;
      if (freshMcStream) {
        const m1 = freshMcStream.totalMassKgH || 0;
        totMass += m1;
        weightedT += (freshMcStream.tempC ?? 35) * m1;
        for (const k of Object.keys(combined) as Array<keyof typeof combined>) {
          combined[k] += freshMcStream.flowsKgH?.[k] || 0;
        }
      }
      if (recMcStream) {
        const m2 = recMcStream.totalMassKgH || 0;
        totMass += m2;
        weightedT += (recMcStream.tempC ?? 50) * m2;
        for (const k of Object.keys(combined) as Array<keyof typeof combined>) {
          combined[k] += recMcStream.flowsKgH?.[k] || 0;
        }
      }
      const nextT = totMass > 0 ? weightedT / totMass : 35.0;
      extraDescs.push(
        `FEED-MC-COMB ← 마스터 [FEED-MC + P-202 순환 MC] 합산 ${totMass.toFixed(1)} kg/h (${nextT.toFixed(1)}°C)`,
      );
      return {
        ...def,
        params: {
          ...def.params,
          feedTempC: nextT,
          feedPressKgcm2g: recMcStream?.pressKgcm2g ?? freshMcStream?.pressKgcm2g ?? 25.0,
          feedFlowsKgH: combined,
        },
      };
    }
    if (def.id === 'cms1_aibn' && freshAibnStream) {
      extraDescs.push(
        `FEED-AIBN ← 마스터 [FEED-AIBN] ${freshAibnStream.totalMassKgH.toFixed(1)} kg/h`,
      );
      return {
        ...def,
        params: {
          ...def.params,
          feedTempC: freshAibnStream.tempC,
          feedPressKgcm2g: freshAibnStream.pressKgcm2g,
          feedFlowsKgH: emptySimFlows(freshAibnStream.flowsKgH),
        },
      };
    }
    return def;
  });

  return { syncedDefs: finalDefs, syncedDescriptions: extraDescs };
}

export function createInitialCmsHierarchySheets(opts?: {
  syncMasterOnInit?: boolean;
}): Record<string, SheetRuntimeData> {
  const map: Record<string, SheetRuntimeData> = {};
  for (const tpl of ALL_CMS_HIERARCHY_TEMPLATES) {
    map[tpl.id] = templateToRuntime(tpl);
  }
  if (opts?.syncMasterOnInit && map.master) {
    const masterSolved = solveFlowsheet(map.master.simDefs, map.master.flowEdges);
    for (const key of Object.keys(map)) {
      if (key === 'master') continue;
      const { syncedDefs } = syncCmsSubDefsFromMaster(
        key,
        map[key].simDefs,
        map.master.flowEdges,
        masterSolved.streams,
      );
      map[key] = { ...map[key], simDefs: syncedDefs };
    }
  }
  return map;
}

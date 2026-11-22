// ============================================================================
// PLANT 05 — 액상 2단 포스겐화 통합 공정 MDI 10만톤 (100,000 TPA · 12,500 kg/h) 5-Sheet 상용 계층 공정
// ============================================================================
// Master : Aniline + Formalin(37%) + HCl/NaOH → MDA 합성·중화(R-101) → 염수분리(D-101)
//          → 진공 아닐린 회수(T-101) → CO+Cl2 포스겐 합성(R-201)
//          → MCB 용매 2단 포스겐화(R-202) → HCl 탈거(D-201/S-202)
//          → 탈포스겐(T-301) → MCB 진공 용매회수(T-302)
//          → 고진공 Pure 4,4'-MDI / Polymeric MDI 정밀분별(T-401: 4,500 + 8,000 kg/h)
// Sub 100: MDA 합성 · 가성중화 · 염수 디캔터 · 아닐린 진공회수 (sub_mdi_100_mda)
// Sub 200: 포스겐(COCl2) 제조 · 2단 포스겐화 · 부생 HCl 회수 (sub_mdi_200_phos)
// Sub 300: 잔류 포스겐 탈거 · MCB 진공 용매 회수 (sub_mdi_300_mcb)
// Sub 400: 고진공 Pure 4,4'-MDI (4,500 kg/h) · PMDI (8,000 kg/h) 분별정제 (sub_mdi_400_purif)
// ============================================================================

import {
  emptySimFlows,
  solveFlowsheet,
  type FlowEdgeDef,
  type FlowNodeDef,
  type SolvedStream,
} from './flowsheetSolver';
import {
  applyMasterBoundaryToSubDefs,
  type SheetRuntimeData,
  type SubSheetTemplate,
} from './fullPlantHierarchy';

// ── 5개 공통 정밀증류탑 사양 ──
const C101_MDI_ANILINE_REC_CONFIG = {
  thermoModel: 'NRTL' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'total' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 14,
  feedStage: 7,
  topPressKgcm2g: -0.88,
  stageDeltaPKgcm2: 0.004,
  murphreeEffPct: 75,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 1.5,
  splitSpecType: 'd_over_f_mass' as const,
  splitSpecValue: 0.020,
  spec1: {
    enabled: false,
    streamTarget: 'bottoms' as const,
    component: 'MDA' as const,
    metric: 'purity_wt_pct' as const,
    targetValue: 99.3,
    varyParam: 'd_over_f' as const,
    varyMin: 0.005,
    varyMax: 0.72,
  },
};

const C301_MDI_DEPHOS_CONFIG = {
  thermoModel: 'NRTL' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'partial' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 14,
  feedStage: 7,
  topPressKgcm2g: 2.0,
  stageDeltaPKgcm2: 0.005,
  murphreeEffPct: 72,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 1.6,
  splitSpecType: 'distillate_kgh' as const,
  splitSpecValue: 2200.0,
  spec1: {
    enabled: false,
    streamTarget: 'distillate' as const,
    component: 'COCl2' as const,
    metric: 'recovery_pct' as const,
    targetValue: 99.6,
    varyParam: 'd_over_f' as const,
    varyMin: 0.005,
    varyMax: 0.65,
  },
};

const C302_MDI_MCB_REC_CONFIG = {
  thermoModel: 'NRTL' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'total' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 16,
  feedStage: 8,
  topPressKgcm2g: -0.90,
  stageDeltaPKgcm2: 0.004,
  murphreeEffPct: 75,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 1.5,
  splitSpecType: 'bottoms_kgh' as const,
  splitSpecValue: 12320.0,
  spec1: {
    enabled: false,
    streamTarget: 'bottoms' as const,
    component: 'MCB' as const,
    metric: 'impurity_wt_ppm' as const,
    targetValue: 500,
    varyParam: 'd_over_f' as const,
    varyMin: 0.05,
    varyMax: 0.96,
  },
};

const C401_MDI_FRACT_CONFIG = {
  thermoModel: 'NRTL' as const,
  stageInputBasis: 'actual_murphree' as const,
  condenserType: 'total' as const,
  reboilerType: 'thermosyphon' as const,
  totalStages: 16,
  feedStage: 8,
  topPressKgcm2g: -0.99,
  stageDeltaPKgcm2: 0.002,
  murphreeEffPct: 78,
  topSpecType: 'reflux_ratio' as const,
  topSpecValue: 1.5,
  splitSpecType: 'd_over_f_mass' as const,
  splitSpecValue: 0.360,
  spec1: {
    enabled: false,
    streamTarget: 'distillate' as const,
    component: 'MDI' as const,
    metric: 'purity_wt_pct' as const,
    targetValue: 99.2,
    varyParam: 'd_over_f' as const,
    varyMin: 0.25,
    varyMax: 0.65,
  },
};

// ============================================================================
// 1. MASTER MDI TEMPLATE (전공정 마스터 — 100,000 MT/yr)
// ============================================================================
export const MASTER_MDI_TEMPLATE: SubSheetTemplate = {
  id: 'master',
  sectionCode: 'MASTER MDI',
  shortTabLabel: '전체 통합 공정 (Master)',
  title: 'PLANT 05 — MDI 10만톤 통합 공정 (Pure MDI 108 · PMDI 192 T/D)',
  subtitle: '100 SEC(MDA 축합·염수디캔터·아닐린회수) → 200 SEC(포스겐 합성·2단 포스겐화) → 300 SEC(탈포스겐·MCB 회수) → 400 SEC(Pure/Polymeric MDI 진공 분별)',
  parentMasterNodeIds: [],
  nodes: [
    // 100 SEC: MDA 합성 및 정제
    {
      id: 'mdi_f_anil',
      tag: 'FEED-ANIL',
      name: '신규 아닐린 원료 (9,420 kg/h)',
      unitType: 'feed',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 40, y: 120 },
      params: {
        feedTempC: 30.0,
        feedPressKgcm2g: 2.5,
        feedFlowsKgH: emptySimFlows({ Aniline: 9420.0 }),
      },
    },
    {
      id: 'mdi_f_hcho',
      tag: 'FEED-FORM',
      name: '포르말린(37%) + HCl 촉매',
      unitType: 'feed',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 40, y: 260 },
      params: {
        feedTempC: 30.0,
        feedPressKgcm2g: 2.5,
        feedFlowsKgH: emptySimFlows({ HCHO: 1510.3, H2O: 2571.6, HCl: 1200.0 }),
      },
    },
    {
      id: 'mdi_f_naoh',
      tag: 'FEED-NAOH',
      name: '중화 가성소다 수용액 (30 wt%)',
      unitType: 'feed',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 40, y: 400 },
      params: {
        feedTempC: 35.0,
        feedPressKgcm2g: 2.5,
        feedFlowsKgH: emptySimFlows({ NaOH: 1316.4, H2O: 3071.6 }),
      },
    },
    {
      id: 'mdi_mix1',
      tag: 'A-100',
      name: 'MDA 원료 혼합조 (신규+순환 아닐린)',
      unitType: 'mixer',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 260, y: 220 },
      params: {},
    },
    {
      id: 'mdi_r101',
      tag: 'R-101',
      name: 'MDA 축합·전위 및 가성중화 반응기',
      unitType: 'reactor',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 480, y: 260 },
      params: {
        calcMode: 'rigorous',
        reactionPreset: 'mda_condensation',
        operTempC: 95.0,
        operPressKgcm2g: 2.5,
        conversion: 0.995,
      },
    },
    {
      id: 'mdi_d101',
      tag: 'D-101',
      name: '염수 수세 유수분리 디캔터 (LLE)',
      unitType: 'separator',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 700, y: 260 },
      params: {
        calcMode: 'rigorous',
        operTempC: 75.0,
        operPressKgcm2g: 0.5,
      },
    },
    {
      id: 'mdi_brine',
      tag: 'OUT-BRINE',
      name: '폐염수 배출 (NaCl 수용액)',
      unitType: 'product',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 700, y: 440 },
      params: {},
    },
    {
      id: 'mdi_s101',
      tag: 'D-102',
      name: '유기층 진공 탈수 드럼 (Flash)',
      unitType: 'separator',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 810, y: 260 },
      params: {
        calcMode: 'rigorous',
        operTempC: 140.0,
        operPressKgcm2g: -0.80,
      },
    },
    {
      id: 'mdi_cond_h2o',
      tag: 'OUT-COND-H2O',
      name: '진공 탈수 응축수 배출',
      unitType: 'product',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 810, y: 80 },
      params: {},
    },
    {
      id: 'mdi_c101',
      tag: 'T-101',
      name: '아닐린 감압 회수탑 (14단 · -0.88 kG)',
      unitType: 'distillation',
      subSheetId: 'sub_mdi_100_mda',
      subSheetBadge: '100 SEC',
      position: { x: 920, y: 260 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C101_MDI_ANILINE_REC_CONFIG),
      },
    },

    // 200 SEC: 포스겐 합성 & MCB 용매 포스겐화
    {
      id: 'mdi_f_co',
      tag: 'FEED-CO',
      name: '일산화탄소 원료 (CO 3,000 kg/h)',
      unitType: 'feed',
      subSheetId: 'sub_mdi_200_phos',
      subSheetBadge: '200 SEC',
      position: { x: 920, y: 50 },
      params: {
        feedTempC: 30.0,
        feedPressKgcm2g: 4.0,
        feedFlowsKgH: emptySimFlows({ CO: 3000.0 }),
      },
    },
    {
      id: 'mdi_f_cl2',
      tag: 'FEED-CL2',
      name: '건조 염소 원료 (Cl₂ 7,600 kg/h)',
      unitType: 'feed',
      subSheetId: 'sub_mdi_200_phos',
      subSheetBadge: '200 SEC',
      position: { x: 920, y: -60 },
      params: {
        feedTempC: 25.0,
        feedPressKgcm2g: 4.0,
        feedFlowsKgH: emptySimFlows({ Cl2: 7600.0 }),
      },
    },
    {
      id: 'mdi_r201',
      tag: 'R-201',
      name: '포스겐(COCl₂) 활성탄 촉매 반응기',
      unitType: 'reactor',
      subSheetId: 'sub_mdi_200_phos',
      subSheetBadge: '200 SEC',
      position: { x: 1140, y: 20 },
      params: {
        calcMode: 'rigorous',
        reactionPreset: 'phosgene_synthesis',
        operTempC: 90.0,
        operPressKgcm2g: 3.5,
        conversion: 0.996,
      },
    },
    {
      id: 'mdi_f_mcb_mu',
      tag: 'FEED-MCB-MU',
      name: 'MCB 보충 용매 (Make-up)',
      unitType: 'feed',
      subSheetId: 'sub_mdi_200_phos',
      subSheetBadge: '200 SEC',
      position: { x: 1140, y: 440 },
      params: {
        feedTempC: 40.0,
        feedPressKgcm2g: 3.5,
        feedFlowsKgH: emptySimFlows({ MCB: 1100.0 }),
      },
    },
    {
      id: 'mdi_r202',
      tag: 'R-202',
      name: 'MDA 2단 연속 포스겐화 반응기 (MCB 용매)',
      unitType: 'reactor',
      subSheetId: 'sub_mdi_200_phos',
      subSheetBadge: '200 SEC',
      position: { x: 1360, y: 260 },
      params: {
        calcMode: 'rigorous',
        reactionPreset: 'mdi_phosgenation',
        operTempC: 145.0,
        operPressKgcm2g: 3.0,
        conversion: 0.998,
      },
    },
    {
      id: 'mdi_s201',
      tag: 'D-201',
      name: '부생 HCl · 포스겐 냉각 기액분리기',
      unitType: 'separator',
      subSheetId: 'sub_mdi_200_phos',
      subSheetBadge: '200 SEC',
      position: { x: 1580, y: 260 },
      params: {
        calcMode: 'rigorous',
        operTempC: 38.0,
        operPressKgcm2g: 2.0,
      },
    },
    {
      id: 'mdi_hcl_out',
      tag: 'BYPROD-HCL',
      name: '부생 HCl 회수 가스 (Plant 02 연계)',
      unitType: 'product',
      subSheetId: 'sub_mdi_200_phos',
      subSheetBadge: '200 SEC',
      position: { x: 1580, y: 60 },
      params: {},
    },

    // 300 SEC: 탈포스겐 및 MCB 용매 회수
    {
      id: 'mdi_c301',
      tag: 'T-301',
      name: '탈포스겐(COCl₂) 회수 스트리퍼 (18단)',
      unitType: 'distillation',
      subSheetId: 'sub_mdi_300_mcb',
      subSheetBadge: '300 SEC',
      position: { x: 1800, y: 260 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C301_MDI_DEPHOS_CONFIG),
      },
    },
    {
      id: 'mdi_c302',
      tag: 'T-302',
      name: 'MCB 용매 진공 회수탑 (16단 · -0.90 kG)',
      unitType: 'distillation',
      subSheetId: 'sub_mdi_300_mcb',
      subSheetBadge: '300 SEC',
      position: { x: 2020, y: 260 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C302_MDI_MCB_REC_CONFIG),
      },
    },
    {
      id: 'mdi_spl302',
      tag: 'SPL-302',
      name: 'MCB 순환/재생 분기 (96%/4%)',
      unitType: 'splitter',
      subSheetId: 'sub_mdi_300_mcb',
      subSheetBadge: '300 SEC',
      position: { x: 2020, y: 80 },
      params: {
        splitRatioTop: 0.96,
      },
    },
    {
      id: 'mdi_mcb_purge',
      tag: 'OUT-MCB-REGEN',
      name: 'MCB 용매 재생·퍼지 드레인 (4%)',
      unitType: 'product',
      subSheetId: 'sub_mdi_300_mcb',
      subSheetBadge: '300 SEC',
      position: { x: 2020, y: -60 },
      params: {},
    },

    // 400 SEC: 고진공 Pure / Polymeric MDI 정밀 분별증류
    {
      id: 'mdi_c401',
      tag: 'T-401',
      name: '고진공 Pure 4,4\'-MDI / PMDI 정제탑 (16단 · 20 mbar)',
      unitType: 'distillation',
      subSheetId: 'sub_mdi_400_purif',
      subSheetBadge: '400 SEC',
      position: { x: 2240, y: 260 },
      params: {
        calcMode: 'rigorous',
        distillConfig: structuredClone(C401_MDI_FRACT_CONFIG),
      },
    },
    {
      id: 'mdi_p_pure',
      tag: 'PROD-PURE-MDI',
      name: 'Pure 4,4\'-MDI 제품 (4,500 kg/h · 108 T/D)',
      unitType: 'product',
      subSheetId: 'sub_mdi_400_purif',
      subSheetBadge: '400 SEC',
      position: { x: 2470, y: 150 },
      params: {},
    },
    {
      id: 'mdi_p_pmdi',
      tag: 'PROD-PMDI',
      name: 'Polymeric MDI (PMDI 8,000 kg/h · 192 T/D)',
      unitType: 'product',
      subSheetId: 'sub_mdi_400_purif',
      subSheetBadge: '400 SEC',
      position: { x: 2470, y: 370 },
      params: {},
    },
  ],
  edges: [
    { id: 'mdi_e1', streamNo: '101', name: '신규 아닐린', source: 'mdi_f_anil', target: 'mdi_mix1', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi_e2', streamNo: '102', name: '포르말린+HCl', source: 'mdi_f_hcho', target: 'mdi_mix1', sourcePort: 'out', targetPort: 'in' },
    {
      id: 'mdi_e_rec_anil',
      streamNo: '112',
      name: '순환 미반응 아닐린',
      source: 'mdi_c101',
      target: 'mdi_mix1',
      sourcePort: 'vapor',
      targetPort: 'in',
      tearGuess: { flowsKgH: { Aniline: 77.0, H2O: 19.0 }, tempC: 55.0, pressKgcm2g: -0.88 },
    },
    { id: 'mdi_e3', streamNo: '103', name: 'MDA 반응기 입구', source: 'mdi_mix1', target: 'mdi_r101', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi_e4', streamNo: '104', name: '중화 NaOH 용액', source: 'mdi_f_naoh', target: 'mdi_r101', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi_e5', streamNo: '105', name: '중화 MDA 혼합액', source: 'mdi_r101', target: 'mdi_d101', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi_e6', streamNo: '106', name: '폐염수 배출', source: 'mdi_d101', target: 'mdi_brine', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi_e7', streamNo: '107', name: '함수 MDA/아닐린 유기층', source: 'mdi_d101', target: 'mdi_s101', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi_e7b', streamNo: '107V', name: '탈수 증기(응축수)', source: 'mdi_s101', target: 'mdi_cond_h2o', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi_e7c', streamNo: '108', name: '탈수 조 MDA/아닐린', source: 'mdi_s101', target: 'mdi_c101', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi_e8', streamNo: '201', name: 'CO 원료가스', source: 'mdi_f_co', target: 'mdi_r201', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi_e9', streamNo: '202', name: 'Cl₂ 원료가스', source: 'mdi_f_cl2', target: 'mdi_r201', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi_e10', streamNo: '203', name: '합성 포스겐(COCl₂)', source: 'mdi_r201', target: 'mdi_r202', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi_e11', streamNo: '204', name: '정제 Crude MDA', source: 'mdi_c101', target: 'mdi_r202', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi_e12', streamNo: '205', name: '보충 MCB 용매', source: 'mdi_f_mcb_mu', target: 'mdi_r202', sourcePort: 'out', targetPort: 'in' },
    {
      id: 'mdi_e_rec_phos',
      streamNo: '311',
      name: '순환 과잉 포스겐',
      source: 'mdi_c301',
      target: 'mdi_r202',
      sourcePort: 'vapor',
      targetPort: 'in',
      tearGuess: { flowsKgH: { COCl2: 1538.0, HCl: 609.0 }, tempC: 35.0, pressKgcm2g: 2.0 },
    },
    { id: 'mdi_e_spl302_in', streamNo: '312A', name: '회수 MCB 증류유출액', source: 'mdi_c302', target: 'mdi_spl302', sourcePort: 'vapor', targetPort: 'in' },
    {
      id: 'mdi_e_rec_mcb',
      streamNo: '312',
      name: '순환 MCB 용매 (96%)',
      source: 'mdi_spl302',
      target: 'mdi_r202',
      sourcePort: 'vapor',
      targetPort: 'in',
      tearGuess: { flowsKgH: { COCl2: 22.0, MCB: 18040.0 }, tempC: 68.0, pressKgcm2g: -0.90 },
    },
    { id: 'mdi_e_mcb_purge', streamNo: '312B', name: 'MCB 용매 재생 퍼지 (4%)', source: 'mdi_spl302', target: 'mdi_mcb_purge', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi_e13', streamNo: '206', name: '포스겐화 유출물', source: 'mdi_r202', target: 'mdi_s201', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi_e14', streamNo: '207', name: '부생 HCl 오프가스', source: 'mdi_s201', target: 'mdi_hcl_out', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi_e15', streamNo: '301', name: '조 MDI/MCB/COCl₂ 액', source: 'mdi_s201', target: 'mdi_c301', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi_e16', streamNo: '302', name: '탈포스겐 MDI/MCB 액', source: 'mdi_c301', target: 'mdi_c302', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi_e17', streamNo: '401', name: '무용매 Crude MDI', source: 'mdi_c302', target: 'mdi_c401', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi_e18', streamNo: '402', name: 'Pure 4,4\'-MDI 제품', source: 'mdi_c401', target: 'mdi_p_pure', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi_e19', streamNo: '403', name: 'Polymeric MDI 제품', source: 'mdi_c401', target: 'mdi_p_pmdi', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

// ============================================================================
// 2. SUB 100 — MDA 축합·중화·수세 디캔터·아닐린 감압 회수 섹션
// ============================================================================
export const SUB_MDI_100_TEMPLATE: SubSheetTemplate = {
  id: 'sub_mdi_100_mda',
  sectionCode: '100 SEC',
  shortTabLabel: '100 MDA 합성·회수',
  title: '100 SEC — MDA 합성 · 가성중화 · 염수 디캔터 & 아닐린 진공회수',
  subtitle: '2 Aniline + HCHO (HCl 촉매) → NaOH 중화 → LLE 염수분리(D-101) → T-101(24단 · -0.88 kG) 미반응 아닐린 회수',
  parentMasterNodeIds: ['mdi_f_anil', 'mdi_f_hcho', 'mdi_f_naoh', 'mdi_mix1', 'mdi_r101', 'mdi_d101', 'mdi_s101', 'mdi_c101'],
  nodes: [
    {
      id: 'mdi1_anil',
      tag: 'FEED-ANIL',
      name: '신규 아닐린 (9,420 kg/h)',
      unitType: 'feed',
      position: { x: 60, y: 120 },
      params: { feedTempC: 30, feedPressKgcm2g: 2.5, feedFlowsKgH: emptySimFlows({ Aniline: 9420.0 }) },
    },
    {
      id: 'mdi1_hcho',
      tag: 'FEED-FORM',
      name: '포르말린(37%) + HCl 촉매',
      unitType: 'feed',
      position: { x: 60, y: 260 },
      params: { feedTempC: 30, feedPressKgcm2g: 2.5, feedFlowsKgH: emptySimFlows({ HCHO: 1510.3, H2O: 2571.6, HCl: 1200.0 }) },
    },
    {
      id: 'mdi1_naoh',
      tag: 'FEED-NAOH',
      name: '중화 NaOH (30 wt%)',
      unitType: 'feed',
      position: { x: 280, y: 400 },
      params: { feedTempC: 35, feedPressKgcm2g: 2.5, feedFlowsKgH: emptySimFlows({ NaOH: 1316.4, H2O: 3071.6 }) },
    },
    {
      id: 'mdi1_mix',
      tag: 'A-100',
      name: '원료·순환 아닐린 혼합조',
      unitType: 'mixer',
      position: { x: 280, y: 190 },
      params: {},
    },
    {
      id: 'mdi1_r101',
      tag: 'R-101',
      name: 'MDA 축합·중화 반응기 (95°C)',
      unitType: 'reactor',
      position: { x: 500, y: 240 },
      params: { calcMode: 'rigorous', reactionPreset: 'mda_condensation', operTempC: 95, operPressKgcm2g: 2.5, conversion: 0.995 },
    },
    {
      id: 'mdi1_d101',
      tag: 'D-101',
      name: '염수 디캔터 (LLE Settler)',
      unitType: 'separator',
      position: { x: 720, y: 240 },
      params: { calcMode: 'rigorous', operTempC: 75, operPressKgcm2g: 0.5 },
    },
    {
      id: 'mdi1_brine',
      tag: 'OUT-BRINE',
      name: '폐염수 배출 (NaCl 수용액)',
      unitType: 'product',
      position: { x: 720, y: 420 },
      params: {},
    },
    {
      id: 'mdi1_s101',
      tag: 'D-102',
      name: '유기층 진공 탈수 드럼 (Flash)',
      unitType: 'separator',
      position: { x: 840, y: 240 },
      params: { calcMode: 'rigorous', operTempC: 140.0, operPressKgcm2g: -0.80 },
    },
    {
      id: 'mdi1_cond_h2o',
      tag: 'OUT-COND-H2O',
      name: '진공 탈수 응축수',
      unitType: 'product',
      position: { x: 840, y: 70 },
      params: {},
    },
    {
      id: 'mdi1_c101',
      tag: 'T-101',
      name: '아닐린 감압 회수탑 (14단 · -0.88 kG)',
      unitType: 'distillation',
      position: { x: 960, y: 240 },
      params: { calcMode: 'rigorous', distillConfig: structuredClone(C101_MDI_ANILINE_REC_CONFIG) },
    },
    {
      id: 'mdi1_mda_out',
      tag: 'TO-200-MDA',
      name: '정제 Crude MDA (포스겐화 공급)',
      unitType: 'product',
      position: { x: 1180, y: 280 },
      params: {},
    },
  ],
  edges: [
    { id: 'mdi1_e1', streamNo: '101', source: 'mdi1_anil', target: 'mdi1_mix', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi1_e2', streamNo: '102', source: 'mdi1_hcho', target: 'mdi1_mix', sourcePort: 'out', targetPort: 'in' },
    {
      id: 'mdi1_e_rec',
      streamNo: '112',
      name: '순환 아닐린',
      source: 'mdi1_c101',
      target: 'mdi1_mix',
      sourcePort: 'vapor',
      targetPort: 'in',
      tearGuess: { flowsKgH: { Aniline: 150.0 }, tempC: 118.0, pressKgcm2g: -0.88 },
    },
    { id: 'mdi1_e3', streamNo: '103', source: 'mdi1_mix', target: 'mdi1_r101', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi1_e4', streamNo: '104', source: 'mdi1_naoh', target: 'mdi1_r101', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi1_e5', streamNo: '105', source: 'mdi1_r101', target: 'mdi1_d101', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi1_e6', streamNo: '106', source: 'mdi1_d101', target: 'mdi1_brine', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi1_e7', streamNo: '107', source: 'mdi1_d101', target: 'mdi1_s101', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi1_e7b', streamNo: '107V', source: 'mdi1_s101', target: 'mdi1_cond_h2o', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi1_e7c', streamNo: '108', source: 'mdi1_s101', target: 'mdi1_c101', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi1_e8', streamNo: '204', source: 'mdi1_c101', target: 'mdi1_mda_out', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

// ============================================================================
// 3. SUB 200 — 포스겐(COCl2) 제조 및 MDA 2단 포스겐화 반응 섹션
// ============================================================================
export const SUB_MDI_200_TEMPLATE: SubSheetTemplate = {
  id: 'sub_mdi_200_phos',
  sectionCode: '200 SEC',
  shortTabLabel: '200 포스겐화 반응',
  title: '200 SEC — CO + Cl₂ 포스겐(COCl₂) 합성 · MCB 용매 MDA 포스겐화 & HCl 회수',
  subtitle: 'R-201(활성탄 고정층 COCl₂ 합성 90°C) → R-202(저온·고온 2단 포스겐화 145°C) → D-201 부생 무수 HCl 가스 분리',
  parentMasterNodeIds: ['mdi_f_co', 'mdi_f_cl2', 'mdi_r201', 'mdi_r202', 'mdi_s201'],
  nodes: [
    {
      id: 'mdi2_co',
      tag: 'FEED-CO',
      name: 'CO 원료 (3,000 kg/h)',
      unitType: 'feed',
      position: { x: 60, y: 90 },
      params: { feedTempC: 30, feedPressKgcm2g: 4.0, feedFlowsKgH: emptySimFlows({ CO: 3000.0 }) },
    },
    {
      id: 'mdi2_cl2',
      tag: 'FEED-CL2',
      name: 'Cl₂ 원료 (7,600 kg/h)',
      unitType: 'feed',
      position: { x: 60, y: 200 },
      params: { feedTempC: 25, feedPressKgcm2g: 4.0, feedFlowsKgH: emptySimFlows({ Cl2: 7600.0 }) },
    },
    {
      id: 'mdi2_r201',
      tag: 'R-201',
      name: '포스겐(COCl₂) 촉매 반응기',
      unitType: 'reactor',
      position: { x: 280, y: 145 },
      params: { calcMode: 'rigorous', reactionPreset: 'phosgene_synthesis', operTempC: 90, operPressKgcm2g: 3.5, conversion: 0.996 },
    },
    {
      id: 'mdi2_mda_in',
      tag: 'FROM-100-MDA',
      name: '정제 MDA 유입 (100 SEC)',
      unitType: 'feed',
      position: { x: 60, y: 330 },
      params: {
        feedTempC: 120,
        feedPressKgcm2g: 3.0,
        feedFlowsKgH: emptySimFlows({ MDA: 9910.0, Aniline: 15.0 }),
      },
    },
    {
      id: 'mdi2_solv_in',
      tag: 'REC-COCl2-MCB',
      name: '순환 포스겐/MCB 용매 루프',
      unitType: 'feed',
      position: { x: 60, y: 440 },
      params: {
        feedTempC: 60,
        feedPressKgcm2g: 3.0,
        feedFlowsKgH: emptySimFlows({ COCl2: 600.0, HCl: 600.0, MCB: 23500.0 }),
      },
    },
    {
      id: 'mdi2_r202',
      tag: 'R-202',
      name: 'MDA 2단 연속 포스겐화 반응기 (145°C)',
      unitType: 'reactor',
      position: { x: 520, y: 280 },
      params: { calcMode: 'rigorous', reactionPreset: 'mdi_phosgenation', operTempC: 145, operPressKgcm2g: 3.0, conversion: 0.998 },
    },
    {
      id: 'mdi2_s201',
      tag: 'D-201',
      name: '부생 HCl · 포스겐 냉각 플래시 드럼',
      unitType: 'separator',
      position: { x: 760, y: 280 },
      params: { calcMode: 'rigorous', operTempC: 38.0, operPressKgcm2g: 2.0 },
    },
    {
      id: 'mdi2_hcl_out',
      tag: 'BYPROD-HCL',
      name: '부생 무수 HCl 회수 (Plant 02)',
      unitType: 'product',
      position: { x: 990, y: 150 },
      params: {},
    },
    {
      id: 'mdi2_to_300',
      tag: 'TO-300-CRUDE',
      name: '조 MDI/MCB/COCl₂ 용액',
      unitType: 'product',
      position: { x: 990, y: 360 },
      params: {},
    },
  ],
  edges: [
    { id: 'mdi2_e1', streamNo: '201', source: 'mdi2_co', target: 'mdi2_r201', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi2_e2', streamNo: '202', source: 'mdi2_cl2', target: 'mdi2_r201', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi2_e3', streamNo: '203', source: 'mdi2_r201', target: 'mdi2_r202', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi2_e4', streamNo: '204', source: 'mdi2_mda_in', target: 'mdi2_r202', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi2_e5', streamNo: '311/312', source: 'mdi2_solv_in', target: 'mdi2_r202', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi2_e6', streamNo: '206', source: 'mdi2_r202', target: 'mdi2_s201', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi2_e7', streamNo: '207', source: 'mdi2_s201', target: 'mdi2_hcl_out', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi2_e8', streamNo: '301', source: 'mdi2_s201', target: 'mdi2_to_300', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

// ============================================================================
// 4. SUB 300 — 탈포스겐 및 MCB 용매 진공 회수 섹션
// ============================================================================
export const SUB_MDI_300_TEMPLATE: SubSheetTemplate = {
  id: 'sub_mdi_300_mcb',
  sectionCode: '300 SEC',
  shortTabLabel: '300 탈포스겐·MCB 회수',
  title: '300 SEC — 잔류 포스겐(COCl₂) 탈기 및 MCB 용매 진공 회수',
  subtitle: 'T-301(18단 · 1.6 kG 탈포스겐 스트리핑 → COCl₂ 순환) → T-302(22단 · -0.90 kG MCB 진공 회수) → 무용매 Crude MDI',
  parentMasterNodeIds: ['mdi_c301', 'mdi_c302'],
  nodes: [
    {
      id: 'mdi3_feed',
      tag: 'FROM-200-CRUDE',
      name: '조 MDI / MCB / 과잉 COCl₂ 액',
      unitType: 'feed',
      position: { x: 60, y: 240 },
      params: {
        boundaryFromMasterNodeId: 'mdi_c301',
        feedTempC: 85.0,
        feedPressKgcm2g: 2.2,
        feedFlowsKgH: emptySimFlows({ COCl2: 6500.0, MCB: 24500.0, MDI: 4500.0, PMDI: 8000.0 }),
      },
    },
    {
      id: 'mdi3_c301',
      tag: 'T-301',
      name: '탈포스겐(COCl₂) 회수탑 (18단)',
      unitType: 'distillation',
      position: { x: 320, y: 240 },
      params: { calcMode: 'rigorous', distillConfig: structuredClone(C301_MDI_DEPHOS_CONFIG) },
    },
    {
      id: 'mdi3_rec_phos',
      tag: 'REC-COCl2',
      name: '회수 포스겐 (R-202 순환)',
      unitType: 'product',
      position: { x: 560, y: 90 },
      params: {},
    },
    {
      id: 'mdi3_c302',
      tag: 'T-302',
      name: 'MCB 진공 용매 회수탑 (22단 · -0.90 kG)',
      unitType: 'distillation',
      position: { x: 580, y: 310 },
      params: { calcMode: 'rigorous', distillConfig: structuredClone(C302_MDI_MCB_REC_CONFIG) },
    },
    {
      id: 'mdi3_rec_mcb',
      tag: 'REC-MCB',
      name: '회수 MCB 용매 (R-202 순환)',
      unitType: 'product',
      position: { x: 840, y: 190 },
      params: {},
    },
    {
      id: 'mdi3_to_400',
      tag: 'TO-400-MDI',
      name: '무용매 Crude MDI (12,500 kg/h)',
      unitType: 'product',
      position: { x: 840, y: 380 },
      params: {},
    },
  ],
  edges: [
    { id: 'mdi3_e1', streamNo: '301', source: 'mdi3_feed', target: 'mdi3_c301', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi3_e2', streamNo: '311', source: 'mdi3_c301', target: 'mdi3_rec_phos', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi3_e3', streamNo: '302', source: 'mdi3_c301', target: 'mdi3_c302', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi3_e4', streamNo: '312', source: 'mdi3_c302', target: 'mdi3_rec_mcb', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi3_e5', streamNo: '401', source: 'mdi3_c302', target: 'mdi3_to_400', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

// ============================================================================
// 5. SUB 400 — 고진공 Pure 4,4'-MDI / Polymeric MDI 정밀 분별증류 섹션
// ============================================================================
export const SUB_MDI_400_TEMPLATE: SubSheetTemplate = {
  id: 'sub_mdi_400_purif',
  sectionCode: '400 SEC',
  shortTabLabel: '400 Pure/PMDI 정제',
  title: '400 SEC — 고진공 박막예열 및 Pure 4,4\'-MDI / PMDI 정밀 분별 (100,000 TPA)',
  subtitle: 'E-401(고진공 예열기) → T-401(16단 Mellapak 고진공 분별탑) → Pure 4,4\'-MDI (4,500 kg/h) + Polymeric MDI (8,000 kg/h)',
  parentMasterNodeIds: ['mdi_c401'],
  nodes: [
    {
      id: 'mdi4_feed',
      tag: 'FROM-300-MDI',
      name: '무용매 Crude MDI (12,500 kg/h)',
      unitType: 'feed',
      position: { x: 60, y: 240 },
      params: {
        boundaryFromMasterNodeId: 'mdi_c401',
        feedTempC: 165.0,
        feedPressKgcm2g: -0.90,
        feedFlowsKgH: emptySimFlows({ MDI: 4500.0, PMDI: 8000.0 }),
      },
    },
    {
      id: 'mdi4_e401',
      tag: 'E-401',
      name: '박막 예열기 (TFE Preheater · 190°C)',
      unitType: 'hex',
      position: { x: 290, y: 240 },
      params: { calcMode: 'rigorous', operTempC: 190.0, operPressKgcm2g: -0.985 },
    },
    {
      id: 'mdi4_c401',
      tag: 'T-401',
      name: '고진공 Pure/PMDI 분별탑 (16단 · -0.99 kG)',
      unitType: 'distillation',
      position: { x: 540, y: 240 },
      params: { calcMode: 'rigorous', distillConfig: structuredClone(C401_MDI_FRACT_CONFIG) },
    },
    {
      id: 'mdi4_e402',
      tag: 'E-402',
      name: 'Pure MDI 제품 냉각기 (48°C 출하)',
      unitType: 'cooler',
      position: { x: 780, y: 120 },
      params: { calcMode: 'rigorous', operTempC: 48.0, operPressKgcm2g: 0.2 },
    },
    {
      id: 'mdi4_pure',
      tag: 'PROD-PURE-MDI',
      name: 'Pure 4,4\'-MDI (4,500 kg/h · 108 T/D)',
      unitType: 'product',
      position: { x: 1020, y: 120 },
      params: {},
    },
    {
      id: 'mdi4_e403',
      tag: 'E-403',
      name: 'Polymeric MDI 제품 냉각기 (55°C 출하)',
      unitType: 'cooler',
      position: { x: 780, y: 360 },
      params: { calcMode: 'rigorous', operTempC: 55.0, operPressKgcm2g: 0.2 },
    },
    {
      id: 'mdi4_pmdi',
      tag: 'PROD-PMDI',
      name: 'Polymeric MDI (8,000 kg/h · 192 T/D)',
      unitType: 'product',
      position: { x: 1020, y: 360 },
      params: {},
    },
  ],
  edges: [
    { id: 'mdi4_e1', streamNo: '401', source: 'mdi4_feed', target: 'mdi4_e401', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi4_e2', streamNo: '401A', source: 'mdi4_e401', target: 'mdi4_c401', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi4_e3', streamNo: '402A', source: 'mdi4_c401', target: 'mdi4_e402', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'mdi4_e4', streamNo: '402', source: 'mdi4_e402', target: 'mdi4_pure', sourcePort: 'out', targetPort: 'in' },
    { id: 'mdi4_e5', streamNo: '403A', source: 'mdi4_c401', target: 'mdi4_e403', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'mdi4_e6', streamNo: '403', source: 'mdi4_e403', target: 'mdi4_pmdi', sourcePort: 'out', targetPort: 'in' },
  ],
};

export const ALL_MDI_HIERARCHY_TEMPLATES: SubSheetTemplate[] = [
  MASTER_MDI_TEMPLATE,
  SUB_MDI_100_TEMPLATE,
  SUB_MDI_200_TEMPLATE,
  SUB_MDI_300_TEMPLATE,
  SUB_MDI_400_TEMPLATE,
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

export function syncMdiSubDefsFromMaster(
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
  if (targetSheetId !== 'sub_mdi_200_phos') {
    return { syncedDefs, syncedDescriptions };
  }
  const mdaStream = masterStreams.find(s => s.edgeId === 'mdi_e11');
  const mcbMuStream = masterStreams.find(s => s.edgeId === 'mdi_e12');
  const phosRecStream = masterStreams.find(s => s.edgeId === 'mdi_e_rec_phos');
  const mcbRecStream = masterStreams.find(s => s.edgeId === 'mdi_e_rec_mcb');

  const extraDescs = [...syncedDescriptions];
  const combined = emptySimFlows();
  let totMass = 0;
  let weightedT = 0;
  for (const st of [mcbMuStream, phosRecStream, mcbRecStream]) {
    if (!st) continue;
    const m = st.totalMassKgH || 0;
    totMass += m;
    weightedT += (st.tempC ?? 55) * m;
    for (const k of Object.keys(combined) as Array<keyof typeof combined>) {
      combined[k] += st.flowsKgH?.[k] || 0;
    }
  }
  const finalDefs = syncedDefs.map(def => {
    if (def.id === 'mdi2_mda_in' && mdaStream && mdaStream.totalMassKgH > 0) {
      extraDescs.push(`FROM-100-MDA ← 마스터 [T-101 204] ${mdaStream.totalMassKgH.toFixed(1)} kg/h`);
      return {
        ...def,
        params: {
          ...def.params,
          feedTempC: mdaStream.tempC ?? 120,
          feedPressKgcm2g: mdaStream.pressKgcm2g ?? 3.0,
          feedFlowsKgH: { ...emptySimFlows(), ...mdaStream.flowsKgH },
        },
      };
    }
    if (def.id === 'mdi2_solv_in' && totMass > 0) {
      extraDescs.push(`REC-COCl2-MCB ← 마스터 [보충·순환] ${totMass.toFixed(1)} kg/h`);
      return {
        ...def,
        params: {
          ...def.params,
          feedTempC: weightedT / totMass,
          feedPressKgcm2g: 3.0,
          feedFlowsKgH: combined,
        },
      };
    }
    return def;
  });
  return { syncedDefs: finalDefs, syncedDescriptions: extraDescs };
}

export function createInitialMdiHierarchySheets(opts?: {
  syncMasterOnInit?: boolean;
}): Record<string, SheetRuntimeData> {
  const map: Record<string, SheetRuntimeData> = {};
  for (const tpl of ALL_MDI_HIERARCHY_TEMPLATES) {
    map[tpl.id] = templateToRuntime(tpl);
  }
  if (opts?.syncMasterOnInit && map.master) {
    const masterSolved = solveFlowsheet(map.master.simDefs, map.master.flowEdges, { propertyMethod: 'NRTL' });
    for (const key of Object.keys(map)) {
      if (key === 'master') continue;
      const { syncedDefs } = syncMdiSubDefsFromMaster(
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

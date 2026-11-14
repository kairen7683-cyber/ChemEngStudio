// ============================================================================
// PLANT 04: 글리세린 기반 에피클로로히드린 (GTE-ECH 70,000 TPA = 8,750 kg/h)
// - Master Flowsheet + 3개 하위 세부공정 시트 (100 염소화 / 200 비누화·염수 / 300 진공정제)
// - 기준 Capa: 70,000 TPA (연 8,000시간 기준 8,750 kg/h 고순도 ECH 99.9%)
// ============================================================================

import {
  emptySimFlows,
  solveFlowsheet,
  type FlowEdgeDef,
  type FlowNodeDef,
} from './flowsheetSolver';
import {
  applyMasterBoundaryToSubDefs,
  type SheetRuntimeData,
  type SubSheetTemplate,
} from './fullPlantHierarchy';

const f = emptySimFlows;

export const MASTER_ECH_TEMPLATE: SubSheetTemplate = {
  id: 'master',
  sectionCode: 'MASTER',
  shortTabLabel: 'ECH 전공정 마스터',
  title: 'PLANT 03 · 글리세린 GTE-ECH 전공정 마스터 (70,000 TPA)',
  subtitle: '100 글리세린 염소화 → 200 NaOH 비누화·염수분리 → 300 NRTL 진공 정밀증류 (8,750 kg/h)',
  parentMasterNodeIds: [],
  nodes: [
    {
      id: 'ech_m_gly',
      tag: 'FEED-GLY',
      name: '정제 글리세린 원료 (99.5%)',
      unitType: 'feed',
      position: { x: 40, y: 120 },
      params: {
        feedTempC: 45,
        feedPressKgcm2g: 2.0,
        feedFlowsKgH: f({ Glycerol: 9070, H2O: 45 }),
      },
    },
    {
      id: 'ech_m_hcl',
      tag: 'FEED-AHCL',
      name: '무수염산 가스 (PLANT 02 연계)',
      unitType: 'feed',
      position: { x: 40, y: 270 },
      params: {
        feedTempC: 35,
        feedPressKgcm2g: 3.5,
        feedFlowsKgH: f({ HCl: 7402 }),
      },
    },
    {
      id: 'ech_m_mix1',
      tag: 'MIX-101',
      name: '염소화 원료 혼합기',
      unitType: 'mixer',
      position: { x: 240, y: 190 },
      params: {},
    },
    {
      id: 'ech_m_r101',
      tag: 'R-101',
      name: '글리세린 염소화 반응기 (1단계 DCH)',
      unitType: 'reactor',
      subSheetId: 'sub_ech_100_hydro',
      subSheetBadge: '100 Sec 상세',
      position: { x: 430, y: 190 },
      params: {
        calcMode: 'rigorous',
        reactionPreset: 'gte_hydrochlorination',
        conversion: 97.5,
        operTempC: 112,
        operPressKgcm2g: 2.2,
      },
    },
    {
      id: 'ech_m_naoh',
      tag: 'FEED-NAOH',
      name: '25 wt% 가성소다 수용액',
      unitType: 'feed',
      position: { x: 430, y: 360 },
      params: {
        feedTempC: 40,
        feedPressKgcm2g: 2.5,
        feedFlowsKgH: f({ NaOH: 4300, H2O: 12900 }),
      },
    },
    {
      id: 'ech_m_mix2',
      tag: 'MIX-201',
      name: '비누화 반응물 혼합기',
      unitType: 'mixer',
      position: { x: 640, y: 250 },
      params: {},
    },
    {
      id: 'ech_m_r201',
      tag: 'R-201',
      name: '비누화 고리화 반응기 (2단계 ECH)',
      unitType: 'reactor',
      subSheetId: 'sub_ech_200_sapon',
      subSheetBadge: '200 Sec 상세',
      position: { x: 830, y: 250 },
      params: {
        calcMode: 'rigorous',
        reactionPreset: 'ech_saponification',
        conversion: 98.5,
        operTempC: 68,
        operPressKgcm2g: 0.4,
      },
    },
    {
      id: 'ech_m_sep2',
      tag: 'V-202',
      name: '유기층/폐염수 유수분리기',
      unitType: 'separator',
      position: { x: 1030, y: 250 },
      params: {
        calcMode: 'rigorous',
        operTempC: 55,
        operPressKgcm2g: 0.2,
      },
    },
    {
      id: 'ech_m_brine',
      tag: 'OUT-BRINE',
      name: '부생 폐염수 (전해공장 회수)',
      unitType: 'product',
      position: { x: 1220, y: 390 },
      params: {},
    },
    {
      id: 'ech_m_c101',
      tag: 'C-101',
      name: '경질분(DCP)·탈수 증류탑',
      unitType: 'distillation',
      subSheetId: 'sub_ech_300_purif',
      subSheetBadge: '300 Sec 상세',
      position: { x: 1220, y: 180 },
      params: {
        calcMode: 'rigorous',
        distillConfig: {
          thermoModel: 'NRTL',
          condenserType: 'decanter_ech',
          reboilerType: 'thermosyphon',
          totalStages: 20,
          feedStage: 10,
          topPressKgcm2g: -0.65,
          stageDeltaPKgcm2: 0.004,
          murphreeEffPct: 75,
          topSpecType: 'reflux_ratio',
          topSpecValue: 2.2,
          splitSpecType: 'd_over_f_mass',
          splitSpecValue: 0.068,
        },
      },
    },
    {
      id: 'ech_m_dec_h2o',
      tag: 'OUT-DEC-H2O',
      name: '공비 디캔터 분리 수층',
      unitType: 'product',
      position: { x: 1430, y: 15 },
      params: {},
    },
    {
      id: 'ech_m_light',
      tag: 'OUT-LIGHT',
      name: '탑정 수분·경질 부산물',
      unitType: 'product',
      position: { x: 1430, y: 80 },
      params: {},
    },
    {
      id: 'ech_m_c102',
      tag: 'C-102',
      name: '고순도 ECH 진공 제품탑 (99.9%)',
      unitType: 'distillation',
      subSheetId: 'sub_ech_300_purif',
      subSheetBadge: '300 Sec 상세',
      position: { x: 1440, y: 260 },
      params: {
        calcMode: 'rigorous',
        distillConfig: {
          thermoModel: 'NRTL',
          condenserType: 'total',
          reboilerType: 'thermosyphon',
          totalStages: 26,
          feedStage: 14,
          topPressKgcm2g: -0.92,
          stageDeltaPKgcm2: 0.003,
          murphreeEffPct: 75,
          topSpecType: 'reflux_ratio',
          topSpecValue: 2.4,
          splitSpecType: 'd_over_f_mass',
          splitSpecValue: 0.955,
        },
      },
    },
    {
      id: 'ech_m_prod',
      tag: 'PROD-ECH',
      name: '에폭시급 ECH 제품 (70,000 TPA)',
      unitType: 'product',
      position: { x: 1660, y: 180 },
      params: {},
    },
    {
      id: 'ech_m_heavy',
      tag: 'REC-HEAVY',
      name: '미반응 DCH/중질분 회수',
      unitType: 'product',
      position: { x: 1660, y: 340 },
      params: {},
    },
  ],
  edges: [
    { id: 'em_e1', streamNo: 'E-101', source: 'ech_m_gly', target: 'ech_m_mix1', sourcePort: 'out', targetPort: 'in' },
    { id: 'em_e2', streamNo: 'E-102', source: 'ech_m_hcl', target: 'ech_m_mix1', sourcePort: 'out', targetPort: 'in' },
    { id: 'em_e3', streamNo: 'E-103', source: 'ech_m_mix1', target: 'ech_m_r101', sourcePort: 'out', targetPort: 'in' },
    { id: 'em_e4', streamNo: 'E-104', source: 'ech_m_r101', target: 'ech_m_mix2', sourcePort: 'out', targetPort: 'in' },
    { id: 'em_e5', streamNo: 'E-201', source: 'ech_m_naoh', target: 'ech_m_mix2', sourcePort: 'out', targetPort: 'in' },
    { id: 'em_e6', streamNo: 'E-202', source: 'ech_m_mix2', target: 'ech_m_r201', sourcePort: 'out', targetPort: 'in' },
    { id: 'em_e7', streamNo: 'E-203', source: 'ech_m_r201', target: 'ech_m_sep2', sourcePort: 'out', targetPort: 'in' },
    { id: 'em_e8', streamNo: 'E-204', source: 'ech_m_sep2', target: 'ech_m_c101', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'em_e9', streamNo: 'E-205', source: 'ech_m_sep2', target: 'ech_m_brine', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'em_e10_dec', streamNo: 'E-300W', source: 'ech_m_c101', target: 'ech_m_dec_h2o', sourcePort: 'decanter', targetPort: 'in' },
    { id: 'em_e10', streamNo: 'E-301', source: 'ech_m_c101', target: 'ech_m_light', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'em_e11', streamNo: 'E-302', source: 'ech_m_c101', target: 'ech_m_c102', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'em_e12', streamNo: 'E-303', source: 'ech_m_c102', target: 'ech_m_prod', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'em_e13', streamNo: 'E-304', source: 'ech_m_c102', target: 'ech_m_heavy', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

export const SUB_ECH_100_TEMPLATE: SubSheetTemplate = {
  id: 'sub_ech_100_hydro',
  sectionCode: '100 Sec',
  shortTabLabel: '100 염소화 반응',
  title: '100 Sec · 글리세린 염소화 반응 계통 (Glycerol + 2HCl → DCH + 2H₂O)',
  subtitle: '반응기 R-101 · 반응열 회수 냉각기 E-102 · 중간 DCH 드럼 V-105',
  parentMasterNodeIds: ['ech_m_r101'],
  nodes: [
    {
      id: 'es1_gly',
      tag: 'FEED-GLY',
      name: '정제 글리세린 원료',
      unitType: 'feed',
      position: { x: 60, y: 120 },
      params: { feedTempC: 45, feedPressKgcm2g: 2.0, feedFlowsKgH: f({ Glycerol: 9070, H2O: 45 }) },
    },
    {
      id: 'es1_hcl',
      tag: 'FEED-AHCL',
      name: '무수염산 가스',
      unitType: 'feed',
      position: { x: 60, y: 270 },
      params: { feedTempC: 35, feedPressKgcm2g: 3.5, feedFlowsKgH: f({ HCl: 7402 }) },
    },
    {
      id: 'es1_mix',
      tag: 'MIX-101',
      name: '예열·혼합기',
      unitType: 'mixer',
      position: { x: 260, y: 195 },
      params: {},
    },
    {
      id: 'es1_r101',
      tag: 'R-101',
      name: '글리세린 염소화 반응기',
      unitType: 'reactor',
      position: { x: 470, y: 195 },
      params: {
        calcMode: 'rigorous',
        reactionPreset: 'gte_hydrochlorination',
        conversion: 97.5,
        operTempC: 112,
        operPressKgcm2g: 2.2,
      },
    },
    {
      id: 'es1_e102',
      tag: 'E-102',
      name: '반응물 냉각기 (112→55°C)',
      unitType: 'hex',
      position: { x: 690, y: 195 },
      params: { calcMode: 'rigorous', operTempC: 55, operPressKgcm2g: 1.8, refrigerantPreset: 'cw' },
    },
    {
      id: 'es1_out',
      tag: 'TO-200-SAPON',
      name: '조 DCH 중간 제품 (200 Sec 이송)',
      unitType: 'product',
      position: { x: 910, y: 195 },
      params: {},
    },
  ],
  edges: [
    { id: 'es1_e1', streamNo: 'E-101', source: 'es1_gly', target: 'es1_mix', sourcePort: 'out', targetPort: 'in' },
    { id: 'es1_e2', streamNo: 'E-102', source: 'es1_hcl', target: 'es1_mix', sourcePort: 'out', targetPort: 'in' },
    { id: 'es1_e3', streamNo: 'E-103', source: 'es1_mix', target: 'es1_r101', sourcePort: 'out', targetPort: 'in' },
    { id: 'es1_e4', streamNo: 'E-104', source: 'es1_r101', target: 'es1_e102', sourcePort: 'out', targetPort: 'in' },
    { id: 'es1_e5', streamNo: 'E-105', source: 'es1_e102', target: 'es1_out', sourcePort: 'out', targetPort: 'in' },
  ],
};

export const SUB_ECH_200_TEMPLATE: SubSheetTemplate = {
  id: 'sub_ech_200_sapon',
  sectionCode: '200 Sec',
  shortTabLabel: '200 비누화·염수',
  title: '200 Sec · NaOH 비누화 고리화 & 부생 폐염수 분리',
  subtitle: 'DCH + NaOH → ECH + NaCl + H₂O (R-201) · 유수분리기 V-202',
  parentMasterNodeIds: ['ech_m_r201'],
  nodes: [
    {
      id: 'es2_dch',
      tag: 'FROM-100-DCH',
      name: '100 Sec 조 DCH 반응액',
      unitType: 'feed',
      position: { x: 60, y: 120 },
      params: { feedTempC: 55, feedPressKgcm2g: 1.8, feedFlowsKgH: f({ DCH: 12383, Glycerol: 227, H2O: 3504 }) },
    },
    {
      id: 'es2_naoh',
      tag: 'FEED-NAOH',
      name: '25 wt% NaOH 수용액',
      unitType: 'feed',
      position: { x: 60, y: 270 },
      params: { feedTempC: 40, feedPressKgcm2g: 2.5, feedFlowsKgH: f({ NaOH: 4032, H2O: 12096 }) },
    },
    {
      id: 'es2_mix',
      tag: 'MIX-201',
      name: '비누화 혼합기',
      unitType: 'mixer',
      position: { x: 270, y: 195 },
      params: {},
    },
    {
      id: 'es2_r201',
      tag: 'R-201',
      name: '비누화 고리화 반응기',
      unitType: 'reactor',
      position: { x: 480, y: 195 },
      params: {
        calcMode: 'rigorous',
        reactionPreset: 'ech_saponification',
        conversion: 98.5,
        operTempC: 68,
        operPressKgcm2g: 0.4,
      },
    },
    {
      id: 'es2_v202',
      tag: 'V-202',
      name: 'ECH/염수 유수분리기',
      unitType: 'separator',
      position: { x: 700, y: 195 },
      params: { calcMode: 'rigorous', operTempC: 55, operPressKgcm2g: 0.2 },
    },
    {
      id: 'es2_org',
      tag: 'TO-300-ECH',
      name: '조 ECH 유기층 (300 Sec)',
      unitType: 'product',
      position: { x: 920, y: 120 },
      params: {},
    },
    {
      id: 'es2_brine',
      tag: 'OUT-BRINE',
      name: '부생 폐염수 (NaCl 회수)',
      unitType: 'product',
      position: { x: 920, y: 270 },
      params: {},
    },
  ],
  edges: [
    { id: 'es2_e1', streamNo: 'E-201', source: 'es2_dch', target: 'es2_mix', sourcePort: 'out', targetPort: 'in' },
    { id: 'es2_e2', streamNo: 'E-202', source: 'es2_naoh', target: 'es2_mix', sourcePort: 'out', targetPort: 'in' },
    { id: 'es2_e3', streamNo: 'E-203', source: 'es2_mix', target: 'es2_r201', sourcePort: 'out', targetPort: 'in' },
    { id: 'es2_e4', streamNo: 'E-204', source: 'es2_r201', target: 'es2_v202', sourcePort: 'out', targetPort: 'in' },
    { id: 'es2_e5', streamNo: 'E-205', source: 'es2_v202', target: 'es2_org', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'es2_e6', streamNo: 'E-206', source: 'es2_v202', target: 'es2_brine', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

export const SUB_ECH_300_TEMPLATE: SubSheetTemplate = {
  id: 'sub_ech_300_purif',
  sectionCode: '300 Sec',
  shortTabLabel: '300 ECH 진공정제',
  title: '300 Sec · NRTL 진공 다단 정밀증류 2탑 (C-101 · C-102)',
  subtitle: '경질 DCP·수분 디캔터 제거(C-101) + 85 Torr 에폭시급 99.9% ECH 정제(C-102)',
  parentMasterNodeIds: ['ech_m_c101', 'ech_m_c102'],
  nodes: [
    {
      id: 'es3_feed',
      tag: 'FEED-CRUDE-ECH',
      name: '조 ECH 유기층 유입',
      unitType: 'feed',
      position: { x: 60, y: 200 },
      params: {
        feedTempC: 55,
        feedPressKgcm2g: 0.2,
        feedFlowsKgH: f({ ECH: 8820, DCP: 165, DCH: 380, H2O: 140 }),
      },
    },
    {
      id: 'es3_c101',
      tag: 'C-101',
      name: '경질분(DCP)·탈수 증류탑',
      unitType: 'distillation',
      position: { x: 300, y: 200 },
      params: {
        calcMode: 'rigorous',
        distillConfig: {
          thermoModel: 'NRTL',
          condenserType: 'decanter_ech',
          reboilerType: 'thermosyphon',
          totalStages: 20,
          feedStage: 10,
          topPressKgcm2g: -0.65,
          stageDeltaPKgcm2: 0.004,
          murphreeEffPct: 75,
          topSpecType: 'reflux_ratio',
          topSpecValue: 2.2,
          splitSpecType: 'd_over_f_mass',
          splitSpecValue: 0.068,
        },
      },
    },
    {
      id: 'es3_dec_h2o',
      tag: 'OUT-DEC-H2O',
      name: '공비 디캔터 분리 수층',
      unitType: 'product',
      position: { x: 540, y: 15 },
      params: {},
    },
    {
      id: 'es3_light',
      tag: 'OUT-LIGHT-DCP',
      name: '탑정 수분·DCP 유분',
      unitType: 'product',
      position: { x: 540, y: 95 },
      params: {},
    },
    {
      id: 'es3_c102',
      tag: 'C-102',
      name: '고순도 ECH 진공 제품탑',
      unitType: 'distillation',
      position: { x: 560, y: 260 },
      params: {
        calcMode: 'rigorous',
        distillConfig: {
          thermoModel: 'NRTL',
          condenserType: 'total',
          reboilerType: 'thermosyphon',
          totalStages: 26,
          feedStage: 14,
          topPressKgcm2g: -0.92,
          stageDeltaPKgcm2: 0.003,
          murphreeEffPct: 75,
          topSpecType: 'reflux_ratio',
          topSpecValue: 2.4,
          splitSpecType: 'd_over_f_mass',
          splitSpecValue: 0.955,
        },
      },
    },
    {
      id: 'es3_prod',
      tag: 'PROD-ECH-99.9%',
      name: '에폭시급 ECH 제품 (99.9%)',
      unitType: 'product',
      position: { x: 820, y: 170 },
      params: {},
    },
    {
      id: 'es3_heavy',
      tag: 'REC-HEAVY-DCH',
      name: '미반응 DCH 중질분 회수',
      unitType: 'product',
      position: { x: 820, y: 340 },
      params: {},
    },
  ],
  edges: [
    { id: 'es3_e1', streamNo: 'E-300', source: 'es3_feed', target: 'es3_c101', sourcePort: 'out', targetPort: 'in' },
    { id: 'es3_e2d', streamNo: 'E-301W', source: 'es3_c101', target: 'es3_dec_h2o', sourcePort: 'decanter', targetPort: 'in' },
    { id: 'es3_e2', streamNo: 'E-301', source: 'es3_c101', target: 'es3_light', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'es3_e3', streamNo: 'E-302', source: 'es3_c101', target: 'es3_c102', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'es3_e4', streamNo: 'E-303', source: 'es3_c102', target: 'es3_prod', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'es3_e5', streamNo: 'E-304', source: 'es3_c102', target: 'es3_heavy', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

export const ALL_ECH_HIERARCHY_TEMPLATES: SubSheetTemplate[] = [
  MASTER_ECH_TEMPLATE,
  SUB_ECH_100_TEMPLATE,
  SUB_ECH_200_TEMPLATE,
  SUB_ECH_300_TEMPLATE,
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

export function createInitialEchHierarchySheets(opts?: {
  syncMasterOnInit?: boolean;
}): Record<string, SheetRuntimeData> {
  const map: Record<string, SheetRuntimeData> = {};
  for (const tpl of ALL_ECH_HIERARCHY_TEMPLATES) {
    map[tpl.id] = templateToRuntime(tpl);
  }
  if (opts?.syncMasterOnInit && map.master) {
    const masterSolved = solveFlowsheet(map.master.simDefs, map.master.flowEdges);
    for (const key of Object.keys(map)) {
      if (key === 'master') continue;
      const { syncedDefs } = applyMasterBoundaryToSubDefs(
        map[key].simDefs,
        map.master.flowEdges,
        masterSolved.streams
      );
      map[key] = { ...map[key], simDefs: syncedDefs };
    }
  }
  return map;
}

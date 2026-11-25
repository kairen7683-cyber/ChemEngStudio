// ============================================================
// 전해공장 풀패키지 계층형 시뮬레이션 아키텍처 (Hierarchical Full-Plant Model)
// - 기존 /material-balance 전해 PFD는 100% 보존하면서 /flowsheet-simulator 에서
//   468 T/D 전해공장 7대 전공정(100~700 SEC) 마스터 도면 + 블록 더블클릭 하위 세부공정(Sub-Flowsheet) 제공
// - 상위 풀패키지 유입 유량 → 하위 서브플로우시트 경계 Feed 실시간 주입 (Parent -> Child)
// - 하위 서브플로우시트 운전 변경 → 상위 마스터 블록 성능 파라미터 자동 반영 (Child -> Parent)
// ============================================================

import {
  FlowNodeDef,
  FlowEdgeDef,
  FlowsheetSolveResult,
  SimCompKey,
  SolvedStream,
  SolvedUnitResult,
  FlowsheetConvergenceInfo,
  emptySimFlows,
  solveFlowsheet,
} from './flowsheetSolver';

export interface PositionedFlowNodeDef extends FlowNodeDef {
  position: { x: number; y: number };
}

export interface SubSheetTemplate {
  id: string;
  sectionCode: string;
  shortTabLabel: string;
  title: string;
  subtitle: string;
  parentMasterNodeIds: string[]; // 이 서브시트와 연결된 마스터 블록 노드 ID들
  nodes: PositionedFlowNodeDef[];
  edges: FlowEdgeDef[];
}

export interface SheetRuntimeData {
  id: string;
  sectionCode: string;
  shortTabLabel: string;
  title: string;
  subtitle: string;
  parentMasterNodeIds: string[];
  simDefs: FlowNodeDef[];
  positions: Record<string, { x: number; y: number }>;
  flowEdges: FlowEdgeDef[];
  cachedSolvedMeta?: {
    result: FlowsheetSolveResult;
    elapsedMs: number;
    lastRunTime: string;
    runCount: number;
  };
}

const zeroFlows = (overrides: Partial<Record<SimCompKey, number>>): Partial<Record<SimCompKey, number>> =>
  emptySimFlows(overrides);

// ============================================================================
// 1. 상위 마스터 시트: 468 T/D 전해공장 전공정 풀패키지 (100 ~ 700 SEC 완결 루프)
// ============================================================================
export const MASTER_FULL_PLANT_TEMPLATE: SubSheetTemplate = {
  id: 'master',
  sectionCode: 'MASTER',
  shortTabLabel: '🏭 전공정 풀패키지 (마스터)',
  title: '전해공장 전공정 풀패키지 시뮬레이션 (468 T/D Cl₂ · 100~700 SEC 폐루프 통합)',
  subtitle:
    '각 공정 블록(1차/2차 브라인정제 · 전해조 · 탈염소 · 3효농축 · 염소냉각 · 황산건조탑 · 염소액화 · 수소정제 · 염산/제해)을 더블클릭하면 내부 세부 기기 시뮬레이션 화면으로 이동합니다.',
  parentMasterNodeIds: [],
  nodes: [
    // ── [100 SEC] 브라인 포화 · 1차정제 · 2차 킬레이트 정제 ──
    {
      id: 'fp_f_bw',
      tag: 'FEED-101',
      name: '브라인 보충수 공급',
      unitType: 'feed',
      position: { x: 25, y: 125 },
      params: {
        feedTempC: 45,
        feedPressKgcm2g: 1.5,
        feedFlowsKgH: zeroFlows({ H2O: 46110.71 }),
      },
    },
    {
      id: 'fp_f_salt',
      tag: 'FEED-102',
      name: '원염(NaCl) 공급',
      unitType: 'feed',
      position: { x: 235, y: -15 },
      params: {
        feedTempC: 25,
        feedPressKgcm2g: 1.0,
        feedFlowsKgH: zeroFlows({ NaCl: 31544.95 }),
      },
    },
    {
      id: 'fp_b110',
      tag: 'PKG-110',
      name: '원염포화 · 1차 브라인정제',
      unitType: 'saturator',
      subSheetId: 'sub_100_primary',
      subSheetBadge: '포화·반응·침전·캔들필터',
      position: { x: 235, y: 115 },
      params: {
        calcMode: 'rigorous',
        targetBrineWtPct: 25.65,
        autoSaltMakeup: true,
        autoWaterMakeup: true,
        targetDepletedBrineWtPct: 17.45,
        operTempC: 67,
        operPressKgcm2g: 2.2,
      },
    },
    {
      id: 'fp_t160',
      tag: 'PKG-160',
      name: '2차 킬레이트 수지정제',
      unitType: 'chelate_tower',
      subSheetId: 'sub_100_secondary',
      subSheetBadge: '킬레이트 수지탑 2기·공급펌프',
      position: { x: 455, y: 115 },
      params: {
        calcMode: 'rigorous',
        resinVolM3: 9.9,
        inletHardnessPpb: 2200,
        columnDeltaPKgcm2: 0.35,
        operTempC: 70,
        operPressKgcm2g: 3.5,
      },
    },

    // ── [200 SEC] 이온교환막 전해조 5기 & 진공 감압 탈염소 순환 ──
    {
      id: 'fp_f_pw',
      tag: 'FEED-201',
      name: '음극 보충 순수(PW)',
      unitType: 'feed',
      position: { x: 455, y: 305 },
      params: {
        feedTempC: 45,
        feedPressKgcm2g: 2.0,
        feedFlowsKgH: zeroFlows({ H2O: 15525 }),
      },
    },
    {
      id: 'fp_el200',
      tag: 'EL-200',
      name: '이온교환막 전해조 (5기)',
      unitType: 'electrolyzer',
      subSheetId: 'sub_200_cell',
      subSheetBadge: '전해조 5기·음극순환루프',
      position: { x: 690, y: 195 },
      params: {
        calcMode: 'rigorous',
        currentKA: 16.2,
        cellCount: 190,
        unitCount: 5,
        currentEffPct: 94.0,
        membraneAreaM2: 2.72,
        waterTransportNumber: 4.195,
        operTempC: 89.0,
        operPressKgcm2g: 0.40,
        cathodeDeltaP: 0.15,
      },
    },
    {
      id: 'fp_d210',
      tag: 'D-210',
      name: '양극액 기액분리기',
      unitType: 'separator',
      subSheetId: 'sub_200_cell',
      position: { x: 920, y: 95 },
      params: { calcMode: 'rigorous', operTempC: 87, operPressKgcm2g: 0.38 },
    },
    {
      id: 'fp_t280',
      tag: 'PKG-280',
      name: '진공 감압 탈염소·환원',
      unitType: 'separator',
      subSheetId: 'sub_200_dechlor',
      subSheetBadge: '진공탈염소탑·환원조·반송',
      position: { x: 580, y: -15 },
      params: {
        calcMode: 'rigorous',
        flashMode: 'adiabatic',
        chemicalDechlorination: true,
        operTempC: 78,
        operPressKgcm2g: -0.65,
      },
    },
    {
      id: 'fp_d220',
      tag: 'D-220',
      name: '음극액 기액분리기',
      unitType: 'separator',
      subSheetId: 'sub_200_cell',
      position: { x: 920, y: 315 },
      params: { calcMode: 'rigorous', operTempC: 89, operPressKgcm2g: 0.45 },
    },

    // ── [300 SEC] 3중 효용 강하막 가성소다 증발농축 (32% → 50%) ──
    {
      id: 'fp_ev300',
      tag: 'PKG-300',
      name: '3효 가성소다 증발농축',
      unitType: 'evaporator',
      subSheetId: 'sub_300_evap',
      subSheetBadge: '3효→2효→1효 강하막 증발관',
      position: { x: 1150, y: 420 },
      params: {
        calcMode: 'rigorous',
        evapTargetConcWt: 50.0,
        operTempC: 112.0,
        operPressKgcm2g: 0.0,
      },
    },
    {
      id: 'fp_p_cond',
      tag: 'PROD-COND',
      name: '증발 응축수 회수',
      unitType: 'product',
      position: { x: 1410, y: 375 },
      params: {},
    },
    {
      id: 'fp_p_naoh50',
      tag: 'PROD-50%NaOH',
      name: '50 wt% 가성소다 출하',
      unitType: 'product',
      position: { x: 1410, y: 465 },
      params: {},
    },

    // ── [400 SEC] 염소가스 수세·냉각 → 3단 황산건조탑 → 압축 → 프레온 액화 ──
    {
      id: 'fp_e410',
      tag: 'PKG-410',
      name: '염소 수세 · 3단 냉각',
      unitType: 'hex',
      subSheetId: 'sub_400_cooling',
      subSheetBadge: '수세탑 + 3단 티타늄냉각',
      position: { x: 1150, y: 80 },
      params: {
        calcMode: 'rigorous',
        refrigerantPreset: 'chw',
        hexSpecMode: 'proc_temp',
        operTempC: 14.0,
        operPressKgcm2g: 0.25,
      },
    },
    {
      id: 'fp_d420',
      tag: 'D-420',
      name: '염소 응축수 분리드럼',
      unitType: 'separator',
      subSheetId: 'sub_400_cooling',
      position: { x: 1365, y: 80 },
      params: { calcMode: 'rigorous', operTempC: 14.0, operPressKgcm2g: 0.22 },
    },
    {
      id: 'fp_p_cl2cond',
      tag: 'DRN-CL2-COND',
      name: '염소 냉각 응축수 배출',
      unitType: 'product',
      position: { x: 1365, y: 190 },
      params: {},
    },
    {
      id: 'fp_t430',
      tag: 'PKG-430',
      name: '황산건조탑 패키지 (3탑)',
      unitType: 'absorber',
      subSheetId: 'sub_400_drying',
      subSheetBadge: '황산건조탑 3기(T-430~450)',
      position: { x: 1575, y: 75 },
      params: {
        calcMode: 'rigorous',
        targetComponent: 'H2O',
        removalEfficiency: 0.9995,
        columnStages: 12,
        columnDeltaPKgcm2: 0.09,
        solventMode: 'connected_or_manual',
        makeupSolventComp: 'H2SO4',
        makeupSolventKgH: 255,
        operTempC: 19.0,
      },
    },
    {
      id: 'fp_p_acid',
      tag: 'PROD-78%H2SO4',
      name: '78% 희석폐황산 출하',
      unitType: 'product',
      position: { x: 1800, y: -15 },
      params: {},
    },
    {
      id: 'fp_c470',
      tag: 'C-470',
      name: '염소 터보압축기 (3.5kG)',
      unitType: 'compressor',
      subSheetId: 'sub_400_liquefaction',
      position: { x: 1800, y: 90 },
      params: {
        calcMode: 'rigorous',
        outletPressKgcm2g: 3.5,
        efficiency: 0.78,
        compStages: 2,
        intercooledTempC: 38.0,
      },
    },
    {
      id: 'fp_sp475',
      tag: 'SP-475',
      name: '건조Cl₂ 분배 (액화/염산)',
      unitType: 'splitter',
      position: { x: 2010, y: 110 },
      params: { splitRatioTop: 0.84 },
    },
    {
      id: 'fp_lq484',
      tag: 'PKG-484',
      name: '프레온 염소액화 패키지',
      unitType: 'liquefier',
      subSheetId: 'sub_400_liquefaction',
      subSheetBadge: '2단 프레온액화·저장·출하',
      position: { x: 2230, y: 55 },
      params: {
        calcMode: 'rigorous',
        refrigerantPreset: 'freon_m35',
        hexSpecMode: 'proc_temp',
        operTempC: -24.0,
        foulingFactor: 0.0002,
      },
    },
    {
      id: 'fp_p_liqcl2',
      tag: 'PROD-LIQ-CL2',
      name: '액체염소 저장·출하',
      unitType: 'product',
      position: { x: 2480, y: 95 },
      params: {},
    },

    // ── [700 SEC] 폐염소 2단 가성제해 & 12% 차아염소산소다(NaOCl) 제조 ──
    {
      id: 'fp_t730',
      tag: 'PKG-730',
      name: '폐염소 제해 · 차아염소산',
      unitType: 'absorber',
      subSheetId: 'sub_500_700_hcl_hypo',
      subSheetBadge: '2단 가성제해탑·12% NaOCl',
      position: { x: 2480, y: -25 },
      params: {
        calcMode: 'rigorous',
        targetComponent: 'Cl2',
        columnStages: 8,
        removalEfficiency: 0.9998,
        solventMode: 'auto_target_wt',
        targetBottomWtPct: 12.0,
        makeupSolventComp: 'NaOH',
        operTempC: 28.0,
      },
    },
    {
      id: 'fp_p_hypo',
      tag: 'PROD-12%NaOCl',
      name: '12% 차아염소산소다 제품',
      unitType: 'product',
      position: { x: 2715, y: -20 },
      params: {},
    },

    // ── [600 SEC] 수소가스 세정 · 냉각 · 23kG 압축 · 실리카겔 제습 ──
    {
      id: 'fp_sp605',
      tag: 'SP-605',
      name: '수소 분배 (출하/염산합성)',
      unitType: 'splitter',
      position: { x: 1150, y: 265 },
      params: { splitRatioTop: 0.82 },
    },
    {
      id: 'fp_pk600',
      tag: 'PKG-600',
      name: '수소 냉각·23kG압축 패키지',
      unitType: 'compressor',
      subSheetId: 'sub_600_h2',
      subSheetBadge: '세정·칠러·23kG압축·제습',
      position: { x: 1575, y: 235 },
      params: {
        calcMode: 'rigorous',
        outletPressKgcm2g: 23.0,
        efficiency: 0.76,
        compStages: 3,
        intercooledTempC: 25.0,
      },
    },
    {
      id: 'fp_d650',
      tag: 'D-650',
      name: '실리카겔 수소제습탑',
      unitType: 'desiccant_dryer',
      subSheetId: 'sub_600_h2',
      subSheetBadge: '실리카겔 제습(노점 -60°C)',
      position: { x: 1800, y: 235 },
      params: {
        calcMode: 'rigorous',
        targetDewPointC: -60,
        columnDeltaPKgcm2: 0.25,
        operTempC: 25.0,
      },
    },
    {
      id: 'fp_p_h2',
      tag: 'PROD-H2-23K',
      name: '99.99% 고압수소 출하',
      unitType: 'product',
      position: { x: 2025, y: 235 },
      params: {},
    },
    {
      id: 'fp_p_h2ko',
      tag: 'DRN-H2-KO',
      name: '수소 압축 응축수 배출',
      unitType: 'product',
      position: { x: 1575, y: 350 },
      params: {},
    },
    {
      id: 'fp_p_h2reg',
      tag: 'DRN-D650-H2O',
      name: '제습탑 재생수 배출',
      unitType: 'product',
      position: { x: 1800, y: 350 },
      params: {},
    },

    // ── [500 SEC] 불침투성 흑연 염산합성로 & 35 wt% 흡수탑 ──
    {
      id: 'fp_m500',
      tag: 'A-500',
      name: '염산합성 원료혼합',
      unitType: 'mixer',
      position: { x: 2010, y: 345 },
      params: { multiplier: 1 },
    },
    {
      id: 'fp_r500',
      tag: 'PKG-500',
      name: '흑연 염산합성로 (R-501)',
      unitType: 'reactor',
      subSheetId: 'sub_500_700_hcl_hypo',
      subSheetBadge: '흑연 합성로·35% 염산흡수',
      position: { x: 2230, y: 345 },
      params: {
        calcMode: 'rigorous',
        reactionPreset: 'hcl_burner',
        conversion: 0.999,
        operTempC: 65.0,
      },
    },
    {
      id: 'fp_f_hclw',
      tag: 'FEED-501',
      name: '염산흡수 순수 공급',
      unitType: 'feed',
      position: { x: 2480, y: 215 },
      params: {
        feedTempC: 35,
        feedPressKgcm2g: 1.5,
        feedFlowsKgH: zeroFlows({ H2O: 5495.78 }),
      },
    },
    {
      id: 'fp_c502',
      tag: 'T-502',
      name: '35% 고순도 염산흡수탑',
      unitType: 'absorber',
      subSheetId: 'sub_500_700_hcl_hypo',
      position: { x: 2480, y: 340 },
      params: {
        calcMode: 'rigorous',
        targetComponent: 'HCl',
        columnStages: 10,
        removalEfficiency: 0.999,
        solventMode: 'auto_target_wt',
        targetBottomWtPct: 35.0,
        makeupSolventComp: 'H2O',
        operTempC: 40.0,
      },
    },
    {
      id: 'fp_p_hclvent',
      tag: 'VENT-C502',
      name: '염산흡수탑 테일벤트',
      unitType: 'product',
      position: { x: 2715, y: 265 },
      params: {},
    },
    {
      id: 'fp_p_hcl',
      tag: 'PROD-35%HCl',
      name: '35 wt% 고순도 염산 제품',
      unitType: 'product',
      position: { x: 2715, y: 350 },
      params: {},
    },
  ],
  edges: [
    // 100 -> 200 브라인 공급 및 진공탈염소 폐루프 순환 (Wegstein Tear Stream!)
    { id: 'me01', streamNo: 'M-01', source: 'fp_f_bw', target: 'fp_b110', sourcePort: 'out', targetPort: 'in' },
    { id: 'me01s', streamNo: 'M-01S', source: 'fp_f_salt', target: 'fp_b110', sourcePort: 'out', targetPort: 'solvent' },
    { id: 'me02', streamNo: 'M-02', source: 'fp_b110', target: 'fp_t160', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me03', streamNo: 'M-03', source: 'fp_t160', target: 'fp_el200', sourcePort: 'out', targetPort: 'anode_in' },
    { id: 'me04', streamNo: 'M-04', source: 'fp_f_pw', target: 'fp_el200', sourcePort: 'out', targetPort: 'cathode_in' },
    { id: 'me05', streamNo: 'M-05', source: 'fp_el200', target: 'fp_d210', sourcePort: 'anode_out', targetPort: 'in' },
    { id: 'me06', streamNo: 'M-06', source: 'fp_d210', target: 'fp_t280', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me07', streamNo: 'M-07', source: 'fp_t280', target: 'fp_b110', sourcePort: 'liquid', targetPort: 'in' }, // ♻ 희박염수 순환!
    { id: 'me08', streamNo: 'M-08', source: 'fp_t280', target: 'fp_e410', sourcePort: 'vapor', targetPort: 'in' },  // 탈염소 회수 Cl2

    // 200 음극 -> 300 3효 증발관
    { id: 'me09', streamNo: 'M-09', source: 'fp_el200', target: 'fp_d220', sourcePort: 'cathode_out', targetPort: 'in' },
    { id: 'me10', streamNo: 'M-10', source: 'fp_d220', target: 'fp_ev300', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me11', streamNo: 'M-11', source: 'fp_ev300', target: 'fp_p_cond', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me12', streamNo: 'M-12', source: 'fp_ev300', target: 'fp_p_naoh50', sourcePort: 'liquid', targetPort: 'in' },

    // 400 염소 냉각 -> 3단 황산건조 -> 압축 -> 액화 / 700 제해
    { id: 'me13', streamNo: 'M-13', source: 'fp_d210', target: 'fp_e410', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me14', streamNo: 'M-14', source: 'fp_e410', target: 'fp_d420', sourcePort: 'out', targetPort: 'in' },
    { id: 'me15', streamNo: 'M-15', source: 'fp_d420', target: 'fp_t430', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me15d', streamNo: 'M-15D', source: 'fp_d420', target: 'fp_p_cl2cond', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me16', streamNo: 'M-16', source: 'fp_t430', target: 'fp_p_acid', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me17', streamNo: 'M-17', source: 'fp_t430', target: 'fp_c470', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me18', streamNo: 'M-18', source: 'fp_c470', target: 'fp_sp475', sourcePort: 'out', targetPort: 'in' },
    { id: 'me19', streamNo: 'M-19', source: 'fp_sp475', target: 'fp_lq484', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me20', streamNo: 'M-20', source: 'fp_lq484', target: 'fp_p_liqcl2', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me21', streamNo: 'M-21', source: 'fp_lq484', target: 'fp_t730', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me22', streamNo: 'M-22', source: 'fp_t730', target: 'fp_p_hypo', sourcePort: 'liquid', targetPort: 'in' },

    // 600 수소 정제 & 500 염산 합성
    { id: 'me23', streamNo: 'M-23', source: 'fp_d220', target: 'fp_sp605', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me24', streamNo: 'M-24', source: 'fp_sp605', target: 'fp_pk600', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me25', streamNo: 'M-25', source: 'fp_pk600', target: 'fp_d650', sourcePort: 'out', targetPort: 'in' },
    { id: 'me25d', streamNo: 'M-25D', source: 'fp_pk600', target: 'fp_p_h2ko', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me26', streamNo: 'M-26', source: 'fp_d650', target: 'fp_p_h2', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me26d', streamNo: 'M-26D', source: 'fp_d650', target: 'fp_p_h2reg', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me27', streamNo: 'M-27', source: 'fp_sp475', target: 'fp_m500', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me28', streamNo: 'M-28', source: 'fp_sp605', target: 'fp_m500', sourcePort: 'liquid', targetPort: 'in' },
    { id: 'me29', streamNo: 'M-29', source: 'fp_m500', target: 'fp_r500', sourcePort: 'out', targetPort: 'in' },
    { id: 'me30', streamNo: 'M-30', source: 'fp_r500', target: 'fp_c502', sourcePort: 'out', targetPort: 'in' },
    { id: 'me30w', streamNo: 'M-30W', source: 'fp_f_hclw', target: 'fp_c502', sourcePort: 'out', targetPort: 'liq_in' },
    { id: 'me31v', streamNo: 'M-31V', source: 'fp_c502', target: 'fp_p_hclvent', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'me31', streamNo: 'M-31', source: 'fp_c502', target: 'fp_p_hcl', sourcePort: 'liquid', targetPort: 'in' },
  ],
};

// ============================================================================
// 2. 하위 세부 플로우시트(Sub-Flowsheets) 9종 — 더블클릭 시 즉시 진입하여 시뮬레이션!
// ============================================================================
export const SUB_FLOWSHEET_TEMPLATES: SubSheetTemplate[] = [
  // ── [400-B] ★ 사용자 핵심 요청: 황산건조탑 3기 직렬·향류 시뮬레이션 (T-430 · T-440 · T-450) ──
  {
    id: 'sub_400_drying',
    sectionCode: '400-B SEC',
    shortTabLabel: '🗼 400-B 황산건조탑 (3탑)',
    title: '[400-B 세부공정] 3단 향류 황산건조탑 패키지 (T-430 1차 → T-440 2차 → T-450 3차 최종건조 + F-424 미스트제거)',
    subtitle:
      '가스(Cl₂)는 1차→2차→3차로 직렬 통과하며 건조되고, 98% 농황산은 3차→2차→1차로 향류 순환(Wegstein 자동수렴)하며 수분을 < 2 wt ppm 이하로 제거합니다.',
    parentMasterNodeIds: ['fp_t430'],
    nodes: [
      {
        id: 'dry_in_cl2',
        tag: 'BOUND-CL2',
        name: '냉각 습윤 Cl₂ 인입 (상위연동)',
        unitType: 'feed',
        position: { x: 35, y: 210 },
        params: {
          boundaryFromMasterNodeId: 'fp_t430',
          boundaryPortRole: 'in',
          feedTempC: 14.0,
          feedPressKgcm2g: 0.22,
          feedFlowsKgH: zeroFlows({ Cl2: 19090, O2: 26, H2O: 94.0 }),
        },
      },
      {
        id: 'dry_t430',
        tag: 'T-430',
        name: '1차 황산건조탑 (~76% H₂SO₄)',
        unitType: 'absorber',
        position: { x: 295, y: 175 },
        params: {
          calcMode: 'rigorous',
          targetComponent: 'H2O',
          columnStages: 4,
          removalEfficiency: 0.90,
          columnDeltaPKgcm2: 0.03,
          solventMode: 'connected_or_manual',
          makeupSolventComp: 'H2SO4',
          makeupSolventKgH: 0,
          operTempC: 15.0,
        },
      },
      {
        id: 'dry_t440',
        tag: 'T-440',
        name: '2차 황산건조탑 (~90% H₂SO₄)',
        unitType: 'absorber',
        position: { x: 640, y: 175 },
        params: {
          calcMode: 'rigorous',
          targetComponent: 'H2O',
          columnStages: 4,
          removalEfficiency: 0.92,
          columnDeltaPKgcm2: 0.03,
          solventMode: 'connected_or_manual',
          makeupSolventComp: 'H2SO4',
          makeupSolventKgH: 0,
          operTempC: 18.0,
        },
      },
      {
        id: 'dry_t450',
        tag: 'T-450',
        name: '3차 최종 황산건조탑 (98% 신산)',
        unitType: 'absorber',
        position: { x: 985, y: 175 },
        params: {
          calcMode: 'rigorous',
          targetComponent: 'H2O',
          columnStages: 5,
          removalEfficiency: 0.96,
          columnDeltaPKgcm2: 0.03,
          solventMode: 'connected_or_manual',
          makeupSolventComp: 'H2SO4',
          makeupSolventKgH: 0,
          operTempC: 20.0,
        },
      },
      {
        id: 'dry_f_acid',
        tag: 'FEED-98%H2SO4',
        name: '98% 농황산 신산 공급 (P-450)',
        unitType: 'feed',
        position: { x: 985, y: 15 },
        params: {
          feedTempC: 20.0,
          feedPressKgcm2g: 2.5,
          feedFlowsKgH: zeroFlows({ H2SO4: 249.9, H2O: 5.1 }),
        },
      },
      {
        id: 'dry_e445',
        tag: 'E-445',
        name: '3→2단 황산 냉각기',
        unitType: 'hex',
        position: { x: 810, y: 345 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'chw',
          hexSpecMode: 'proc_temp',
          operTempC: 17.0,
        },
      },
      {
        id: 'dry_e435',
        tag: 'E-435',
        name: '2→1단 황산 냉각기',
        unitType: 'hex',
        position: { x: 465, y: 345 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'chw',
          hexSpecMode: 'proc_temp',
          operTempC: 14.0,
        },
      },
      {
        id: 'dry_p_spent',
        tag: 'OUT-78%H2SO4',
        name: '희석 폐황산 배출 (~76~78%)',
        unitType: 'product',
        position: { x: 295, y: 375 },
        params: {},
      },
      {
        id: 'dry_f424',
        tag: 'F-424',
        name: '브링크 황산미스트 제거기',
        unitType: 'filter_visual',
        position: { x: 1245, y: 185 },
        params: {
          pressureDropKgcm2: 0.02,
          visualSpecNote: '유리섬유 캔들 데미스터 (황산 미스트 0 ppm 보증)',
        },
      },
      {
        id: 'dry_out_cl2',
        tag: 'OUT-DRY-CL2',
        name: '초건조 Cl₂ 출구 (→ C-470 압축기)',
        unitType: 'product',
        position: { x: 1465, y: 185 },
        params: {},
      },
    ],
    edges: [
      // 전진 Cl2 가스 라인 (1차 -> 2차 -> 3차 -> 미스트제거기 -> 출구)
      { id: 'de1', streamNo: 'D-01', source: 'dry_in_cl2', target: 'dry_t430', sourcePort: 'out', targetPort: 'in' },
      { id: 'de2', streamNo: 'D-02', source: 'dry_t430', target: 'dry_t440', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'de3', streamNo: 'D-03', source: 'dry_t440', target: 'dry_t450', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'de4', streamNo: 'D-04', source: 'dry_t450', target: 'dry_f424', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'de5', streamNo: 'D-05', source: 'dry_f424', target: 'dry_out_cl2', sourcePort: 'out', targetPort: 'in' },
      // 향류 황산 캐스케이드 (98% 신산 -> T-450 -> E-445 -> T-440 -> E-435 -> T-430 -> 폐황산)
      { id: 'de6', streamNo: 'D-06', source: 'dry_f_acid', target: 'dry_t450', sourcePort: 'out', targetPort: 'liq_in' },
      { id: 'de7', streamNo: 'D-07', source: 'dry_t450', target: 'dry_e445', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'de8', streamNo: 'D-08', source: 'dry_e445', target: 'dry_t440', sourcePort: 'out', targetPort: 'liq_in' },
      { id: 'de9', streamNo: 'D-09', source: 'dry_t440', target: 'dry_e435', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'de10', streamNo: 'D-10', source: 'dry_e435', target: 'dry_t430', sourcePort: 'out', targetPort: 'liq_in' },
      { id: 'de11', streamNo: 'D-11', source: 'dry_t430', target: 'dry_p_spent', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },

  // ── [100-A] 원염 용해 · 브라인 1차 정제 · 침전조 · 캔들필터 ──
  {
    id: 'sub_100_primary',
    sectionCode: '100-A SEC',
    shortTabLabel: '🧂 100-A 브라인 1차정제',
    title: '[100-A 세부공정] 원염 포화조(D-010) · 약품반응조(TK-020) · 침전조(T-030) · 캔들 프리코트 필터(F-140A/B/C)',
    subtitle:
      '탈염소 반환 희박염수(17.5% NaCl)에 원염을 용해하여 25.6 wt%(310 g/L)로 포화시키고, Na₂CO₃·NaOH·BaCl₂ 침전 및 캔들필터 여과로 SS < 0.2 ppm을 달성합니다.',
    parentMasterNodeIds: ['fp_b110'],
    nodes: [
      {
        id: 'b1_in_lean',
        tag: 'BOUND-LEAN',
        name: '반환 희박염수+보충수 (상위연동)',
        unitType: 'feed',
        position: { x: 35, y: 155 },
        params: {
          boundaryFromMasterNodeId: 'fp_b110',
          boundaryPortRole: 'in',
          feedTempC: 68,
          feedPressKgcm2g: 1.5,
          feedFlowsKgH: zeroFlows({ NaCl: 25950, H2O: 166650 }),
        },
      },
      {
        id: 'b1_f_salt',
        tag: 'FEED-SALT',
        name: '원염(NaCl) 공급 (상위연동)',
        unitType: 'feed',
        position: { x: 270, y: 20 },
        params: {
          boundaryFromMasterNodeId: 'fp_b110',
          boundaryPortRole: 'solvent',
          feedTempC: 25,
          feedPressKgcm2g: 1.0,
          feedFlowsKgH: zeroFlows({ NaCl: 31544.95 }),
        },
      },
      {
        id: 'b1_d010',
        tag: 'D-010A/B',
        name: '원염 상향류 포화조 (310 g/L)',
        unitType: 'saturator',
        position: { x: 270, y: 150 },
        params: {
          calcMode: 'rigorous',
          targetBrineWtPct: 25.65,
          autoSaltMakeup: true,
          operTempC: 67,
          operPressKgcm2g: 1.4,
        },
      },
      {
        id: 'b1_d020',
        tag: 'TK-020',
        name: '약품 정제반응조 (Ba/CO₃/OH)',
        unitType: 'tank_visual',
        position: { x: 510, y: 155 },
        params: {
          pressureDropKgcm2: 0.05,
          visualSpecNote: 'Na₂CO₃(Ca침전) + NaOH(Mg침전) + BaCl₂(SO₄침전) 체류 60분',
        },
      },
      {
        id: 'b1_t030',
        tag: 'T-030',
        name: '침전 정제조 (Clarifier)',
        unitType: 'saturator',
        position: { x: 740, y: 150 },
        params: {
          calcMode: 'rigorous',
          targetBrineWtPct: 25.65,
          autoSaltMakeup: false,
          sludgePurgePct: 0.2,
          operTempC: 66,
          operPressKgcm2g: 1.2,
        },
      },
      {
        id: 'b1_sludge',
        tag: 'OUT-SLUDGE',
        name: '침전 슬러지 케이크 배출',
        unitType: 'product',
        position: { x: 980, y: 295 },
        params: {},
      },
      {
        id: 'b1_p154',
        tag: 'P-154A/B',
        name: '캔들여과 공급펌프',
        unitType: 'pump',
        position: { x: 980, y: 135 },
        params: { outletPressKgcm2g: 3.9, efficiency: 0.75 },
      },
      {
        id: 'b1_f140',
        tag: 'F-140A/B/C',
        name: '캔들 프리코트 필터 (2운전+1대기)',
        unitType: 'filter_visual',
        position: { x: 1210, y: 135 },
        params: {
          pressureDropKgcm2: 0.55,
          visualSpecNote: 'PVDF 캔들 248본×2기 (α-셀룰로오스 프리코트 · SS 18 → <0.2 ppm)',
        },
      },
      {
        id: 'b1_out',
        tag: 'OUT-1ST-BRINE',
        name: '1차 여과염수 (→ 2차 수지탑)',
        unitType: 'product',
        position: { x: 1450, y: 135 },
        params: {},
      },
    ],
    edges: [
      { id: 'b1e1', streamNo: 'B1-01', source: 'b1_in_lean', target: 'b1_d010', sourcePort: 'out', targetPort: 'in' },
      { id: 'b1e1s', streamNo: 'B1-01S', source: 'b1_f_salt', target: 'b1_d010', sourcePort: 'out', targetPort: 'solvent' },
      { id: 'b1e2', streamNo: 'B1-02', source: 'b1_d010', target: 'b1_d020', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'b1e3', streamNo: 'B1-03', source: 'b1_d020', target: 'b1_t030', sourcePort: 'out', targetPort: 'in' },
      { id: 'b1e4', streamNo: 'B1-04', source: 'b1_t030', target: 'b1_p154', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'b1e5', streamNo: 'B1-05', source: 'b1_t030', target: 'b1_sludge', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'b1e6', streamNo: 'B1-06', source: 'b1_p154', target: 'b1_f140', sourcePort: 'out', targetPort: 'in' },
      { id: 'b1e7', streamNo: 'B1-07', source: 'b1_f140', target: 'b1_out', sourcePort: 'out', targetPort: 'in' },
    ],
  },

  // ── [100-B] 브라인 2차 킬레이트 이온교환수지탑 (Lead-Lag 2탑 직렬) ──
  {
    id: 'sub_100_secondary',
    sectionCode: '100-B SEC',
    shortTabLabel: '🧪 100-B 2차 킬레이트수지',
    title: '[100-B 세부공정] 브라인 2차 정제 킬레이트 수지탑 (T-160A Lead → T-160B Lag) · 전해공급펌프(P-084)',
    subtitle:
      'Lewatit TP-208 킬레이트 수지탑 2기 직렬(Lead-Lag) 운전으로 Ca²⁺+Mg²⁺ 경도를 2,200 ppb → < 12 ppb로 초고순도 정제하여 이온교환막 영구 손상을 방지합니다.',
    parentMasterNodeIds: ['fp_t160'],
    nodes: [
      {
        id: 'b2_in',
        tag: 'BOUND-1ST-BRINE',
        name: '1차 여과염수 인입 (상위연동)',
        unitType: 'feed',
        position: { x: 35, y: 165 },
        params: {
          boundaryFromMasterNodeId: 'fp_t160',
          boundaryPortRole: 'in',
          feedTempC: 67,
          feedPressKgcm2g: 3.2,
          feedFlowsKgH: zeroFlows({ NaCl: 57493, H2O: 166651 }),
        },
      },
      {
        id: 'b2_d150',
        tag: 'TK-150',
        name: '2차 정제 완충조 (100 m³)',
        unitType: 'tank_visual',
        position: { x: 255, y: 165 },
        params: { pressureDropKgcm2: 0.05, visualSpecNote: 'pH 9.5~10.5 조정 완충탱크' },
      },
      {
        id: 'b2_t160a',
        tag: 'T-160A (Lead)',
        name: '1차 킬레이트 수지탑 (주흡착)',
        unitType: 'chelate_tower',
        position: { x: 480, y: 160 },
        params: {
          calcMode: 'rigorous',
          resinVolM3: 9.9,
          inletHardnessPpb: 2200,
          columnDeltaPKgcm2: 0.40,
          operTempC: 66,
        },
      },
      {
        id: 'b2_t160b',
        tag: 'T-160B (Lag)',
        name: '2차 킬레이트 수지탑 (폴리싱)',
        unitType: 'chelate_tower',
        position: { x: 720, y: 160 },
        params: {
          calcMode: 'rigorous',
          resinVolM3: 9.9,
          inletHardnessPpb: 45,
          columnDeltaPKgcm2: 0.40,
          operTempC: 66,
        },
      },
      {
        id: 'b2_d170',
        tag: 'TK-170',
        name: '초순수 정제염수 저장조',
        unitType: 'tank_visual',
        position: { x: 955, y: 165 },
        params: { pressureDropKgcm2: 0.0, visualSpecNote: 'Ca+Mg < 12 ppb 보증 완료 브라인 버퍼' },
      },
      {
        id: 'b2_p084',
        tag: 'P-084A/B',
        name: '전해조 티타늄 공급펌프',
        unitType: 'pump',
        position: { x: 1170, y: 160 },
        params: { outletPressKgcm2g: 4.5, efficiency: 0.78 },
      },
      {
        id: 'b2_e180',
        tag: 'E-180',
        name: '정제염수 스팀 예열기',
        unitType: 'hex',
        position: { x: 1385, y: 160 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'steam_lp',
          hexSpecMode: 'proc_temp',
          operTempC: 74.0,
        },
      },
      {
        id: 'b2_out',
        tag: 'OUT-PURE-BRINE',
        name: '초고순도 염수 (→ EL-200 양극)',
        unitType: 'product',
        position: { x: 1600, y: 165 },
        params: {},
      },
    ],
    edges: [
      { id: 'b2e1', streamNo: 'B2-01', source: 'b2_in', target: 'b2_d150', sourcePort: 'out', targetPort: 'in' },
      { id: 'b2e2', streamNo: 'B2-02', source: 'b2_d150', target: 'b2_t160a', sourcePort: 'out', targetPort: 'in' },
      { id: 'b2e3', streamNo: 'B2-03', source: 'b2_t160a', target: 'b2_t160b', sourcePort: 'out', targetPort: 'in' },
      { id: 'b2e4', streamNo: 'B2-04', source: 'b2_t160b', target: 'b2_d170', sourcePort: 'out', targetPort: 'in' },
      { id: 'b2e5', streamNo: 'B2-05', source: 'b2_d170', target: 'b2_p084', sourcePort: 'out', targetPort: 'in' },
      { id: 'b2e6', streamNo: 'B2-06', source: 'b2_p084', target: 'b2_e180', sourcePort: 'out', targetPort: 'in' },
      { id: 'b2e7', streamNo: 'B2-07', source: 'b2_e180', target: 'b2_out', sourcePort: 'out', targetPort: 'in' },
    ],
  },

  // ── [200-A] 이온교환막 전해조 5기 & 음극액 순환 루프 ──
  {
    id: 'sub_200_cell',
    sectionCode: '200-A SEC',
    shortTabLabel: '⚡ 200-A 전해조·순환루프',
    title: '[200-A 세부공정] BiTAC 이온교환막 전해조(EL-201~205) · 양극분리(D-210) · 음극순환 냉각루프(D-220 · E-223)',
    subtitle:
      '음극액 78%를 P-254 및 E-223 냉각기로 순환시켜 셀 입구 농도를 30.3% → 출구 32.3 wt% NaOH로 정밀 유지하며 셀 발열을 제거합니다.',
    parentMasterNodeIds: ['fp_el200', 'fp_d210', 'fp_d220'],
    nodes: [
      {
        id: 'c2_in_brine',
        tag: 'BOUND-BRINE',
        name: '초고순도 정제염수 (상위연동)',
        unitType: 'feed',
        position: { x: 40, y: 65 },
        params: {
          boundaryFromMasterNodeId: 'fp_el200',
          boundaryPortRole: 'anode_in',
          feedTempC: 70,
          feedPressKgcm2g: 3.5,
          feedFlowsKgH: zeroFlows({ NaCl: 57493, H2O: 166651 }),
        },
      },
      {
        id: 'c2_in_pw',
        tag: 'BOUND-PW',
        name: '음극 보충 순수 (상위연동)',
        unitType: 'feed',
        position: { x: 40, y: 265 },
        params: {
          boundaryFromMasterNodeId: 'fp_el200',
          boundaryPortRole: 'cathode_in',
          feedTempC: 45,
          feedPressKgcm2g: 2.0,
          feedFlowsKgH: zeroFlows({ H2O: 15525 }),
        },
      },
      {
        id: 'c2_m210',
        tag: 'A-210',
        name: '음극 순환액 혼합헤더',
        unitType: 'mixer',
        position: { x: 255, y: 265 },
        params: { multiplier: 1 },
      },
      {
        id: 'c2_p254',
        tag: 'P-254A/B',
        name: '음극액 순환펌프 (Ni)',
        unitType: 'pump',
        position: { x: 425, y: 265 },
        params: { outletPressKgcm2g: 3.2, efficiency: 0.78 },
      },
      {
        id: 'c2_e223',
        tag: 'E-223',
        name: '음극액 순환 냉각기 (CW)',
        unitType: 'hex',
        position: { x: 595, y: 265 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 83.0,
        },
      },
      {
        id: 'c2_el200',
        tag: 'EL-201~205',
        name: '이온교환막 전해조 (5기×190셀)',
        unitType: 'electrolyzer',
        position: { x: 800, y: 140 },
        params: {
          calcMode: 'rigorous',
          currentKA: 16.2,
          cellCount: 190,
          unitCount: 5,
          currentEffPct: 94.0,
          membraneAreaM2: 2.72,
          waterTransportNumber: 4.195,
          operTempC: 89.0,
          operPressKgcm2g: 0.40,
          cathodeDeltaP: 0.15,
        },
      },
      {
        id: 'c2_d210',
        tag: 'D-210',
        name: '양극 기액분리기',
        unitType: 'separator',
        position: { x: 1055, y: 55 },
        params: { calcMode: 'rigorous', operTempC: 87, operPressKgcm2g: 0.38 },
      },
      {
        id: 'c2_out_cl2',
        tag: 'OUT-WET-CL2',
        name: '습윤 Cl₂ 가스 (→ 400 SEC)',
        unitType: 'product',
        position: { x: 1310, y: 15 },
        params: {},
      },
      {
        id: 'c2_out_anolyte',
        tag: 'OUT-ANOLYTE',
        name: '희박 브라인 (→ T-280 탈염소)',
        unitType: 'product',
        position: { x: 1310, y: 105 },
        params: {},
      },
      {
        id: 'c2_d220',
        tag: 'D-220',
        name: '음극 기액분리기',
        unitType: 'separator',
        position: { x: 1055, y: 245 },
        params: { calcMode: 'rigorous', operTempC: 89, operPressKgcm2g: 0.45 },
      },
      {
        id: 'c2_out_h2',
        tag: 'OUT-WET-H2',
        name: '습윤 H₂ 가스 (→ 600 SEC)',
        unitType: 'product',
        position: { x: 1310, y: 210 },
        params: {},
      },
      {
        id: 'c2_sp220',
        tag: 'SP-220',
        name: '음극액 순환 분기기 (78% 순환)',
        unitType: 'splitter',
        position: { x: 1055, y: 395 },
        params: { splitRatioTop: 0.78 },
      },
      {
        id: 'c2_out_naoh32',
        tag: 'OUT-32%NaOH',
        name: '32.3% NaOH (→ 300 3효농축)',
        unitType: 'product',
        position: { x: 1310, y: 405 },
        params: {},
      },
    ],
    edges: [
      { id: 'c2e1', streamNo: 'C2-01', source: 'c2_in_brine', target: 'c2_el200', sourcePort: 'out', targetPort: 'anode_in' },
      { id: 'c2e2', streamNo: 'C2-02', source: 'c2_in_pw', target: 'c2_m210', sourcePort: 'out', targetPort: 'in' },
      { id: 'c2e3', streamNo: 'C2-03', source: 'c2_m210', target: 'c2_p254', sourcePort: 'out', targetPort: 'in' },
      { id: 'c2e4', streamNo: 'C2-04', source: 'c2_p254', target: 'c2_e223', sourcePort: 'out', targetPort: 'in' },
      { id: 'c2e5', streamNo: 'C2-05', source: 'c2_e223', target: 'c2_el200', sourcePort: 'out', targetPort: 'cathode_in' },
      { id: 'c2e6', streamNo: 'C2-06', source: 'c2_el200', target: 'c2_d210', sourcePort: 'anode_out', targetPort: 'in' },
      { id: 'c2e7', streamNo: 'C2-07', source: 'c2_d210', target: 'c2_out_cl2', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'c2e8', streamNo: 'C2-08', source: 'c2_d210', target: 'c2_out_anolyte', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'c2e9', streamNo: 'C2-09', source: 'c2_el200', target: 'c2_d220', sourcePort: 'cathode_out', targetPort: 'in' },
      { id: 'c2e10', streamNo: 'C2-10', source: 'c2_d220', target: 'c2_out_h2', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'c2e11', streamNo: 'C2-11', source: 'c2_d220', target: 'c2_sp220', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'c2e12', streamNo: 'C2-12', source: 'c2_sp220', target: 'c2_m210', sourcePort: 'vapor', targetPort: 'in' }, // ♻ 순환!
      { id: 'c2e13', streamNo: 'C2-13', source: 'c2_sp220', target: 'c2_out_naoh32', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },

  // ── [200-B] 진공 감압 탈염소탑(T-280) & 아황산 환원조(TK-280) ──
  {
    id: 'sub_200_dechlor',
    sectionCode: '200-B SEC',
    shortTabLabel: '🫧 200-B 진공 탈염소',
    title: '[200-B 세부공정] 진공 감압 탈염소탑(T-280, -0.65 kG) · 회수염소 냉각기(E-282) · 아황산 완전환원조(TK-280)',
    subtitle:
      '양극 배출 희박염수(17.5% NaCl) 내 용존 염소를 -0.65 kG 진공 플래시로 회수하고, 잔류 유리염소를 Na₂SO₃로 0 ppm 중화하여 100 SEC 포화조로 반송합니다.',
    parentMasterNodeIds: ['fp_t280'],
    nodes: [
      {
        id: 'dc_in',
        tag: 'BOUND-ANOLYTE',
        name: '용존Cl₂ 함유 희박염수 (상위연동)',
        unitType: 'feed',
        position: { x: 40, y: 175 },
        params: {
          boundaryFromMasterNodeId: 'fp_t280',
          boundaryPortRole: 'in',
          feedTempC: 87,
          feedPressKgcm2g: 0.38,
          feedFlowsKgH: zeroFlows({ NaCl: 25950, H2O: 122755, Cl2: 115 }),
        },
      },
      {
        id: 'dc_v280',
        tag: 'PCV-280',
        name: '진공 감압 밸브',
        unitType: 'valve_visual',
        position: { x: 265, y: 180 },
        params: { pressureDropKgcm2: 0.95, visualSpecNote: '0.38 kG → -0.65 kG 감압 플래시 유도' },
      },
      {
        id: 'dc_t280',
        tag: 'T-280',
        name: '진공 감압 탈염소탑 (-0.65 kG)',
        unitType: 'separator',
        position: { x: 475, y: 165 },
        params: {
          calcMode: 'rigorous',
          flashMode: 'adiabatic',
          operTempC: 78,
          operPressKgcm2g: -0.65,
        },
      },
      {
        id: 'dc_e282',
        tag: 'E-282',
        name: '회수 Cl₂ 진공냉각기',
        unitType: 'hex',
        position: { x: 735, y: 65 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 38,
        },
      },
      {
        id: 'dc_out_cl2',
        tag: 'OUT-REC-CL2',
        name: '회수 Cl₂ 가스 (→ 400 SEC 합류)',
        unitType: 'product',
        position: { x: 985, y: 65 },
        params: {},
      },
      {
        id: 'dc_d280',
        tag: 'TK-280',
        name: 'Na₂SO₃ 잔류염소 완전환원조',
        unitType: 'tank_visual',
        position: { x: 735, y: 255 },
        params: {
          pressureDropKgcm2: 0,
          chemicalDechlorination: true,
          visualSpecNote: '10% 아황산소다 투입 → 유리염소 0.0 ppm 완전 제거(ORP 제어)',
        },
      },
      {
        id: 'dc_p374',
        tag: 'P-374A/B',
        name: '희박염수 반송펌프 (Ti)',
        unitType: 'pump',
        position: { x: 985, y: 250 },
        params: { outletPressKgcm2g: 3.8, efficiency: 0.77 },
      },
      {
        id: 'dc_out_brine',
        tag: 'OUT-RETURN-BRINE',
        name: '탈염소 브라인 (→ 100 SEC 포화조)',
        unitType: 'product',
        position: { x: 1225, y: 255 },
        params: {},
      },
    ],
    edges: [
      { id: 'dce1', streamNo: 'DC-01', source: 'dc_in', target: 'dc_v280', sourcePort: 'out', targetPort: 'in' },
      { id: 'dce2', streamNo: 'DC-02', source: 'dc_v280', target: 'dc_t280', sourcePort: 'out', targetPort: 'in' },
      { id: 'dce3', streamNo: 'DC-03', source: 'dc_t280', target: 'dc_e282', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'dce4', streamNo: 'DC-04', source: 'dc_e282', target: 'dc_out_cl2', sourcePort: 'out', targetPort: 'in' },
      { id: 'dce5', streamNo: 'DC-05', source: 'dc_t280', target: 'dc_d280', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'dce6', streamNo: 'DC-06', source: 'dc_d280', target: 'dc_p374', sourcePort: 'out', targetPort: 'in' },
      { id: 'dce7', streamNo: 'DC-07', source: 'dc_p374', target: 'dc_out_brine', sourcePort: 'out', targetPort: 'in' },
    ],
  },

  // ── [300 SEC] 가성소다 3중 효용 강하막식 증발농축 (실공장 기준: E-340→E-330→E-320 역류 + E-332/342 50% NaOH 열회수 + E-333/343 1효 스팀응축수 열회수) ──
  {
    id: 'sub_300_evap',
    sectionCode: '300 SEC',
    shortTabLabel: '🔥 300 3효 증발농축',
    title: '[300 세부공정] 실공장 3중 효용 증발농축 (E-340·E-330·E-320 + E-332/342 제품열회수 + E-333/343 응축수열회수)',
    subtitle:
      '3효(36.3%)→2효(41.9%)→1효(50.0%) 역류 급액(75.5%/24.5% 병렬 분기 예열), 증기 순류 캐스케이드(13K 생스팀→1효→2효→3효→E-350), 50% NaOH 열회수(E-332→E-342→E-352) 및 1효 고온 스팀응축수 열회수(E-333→E-343→보일러)를 실공장 그대로 반영했습니다.',
    parentMasterNodeIds: ['fp_ev300'],
    nodes: [
      // ── 상단 행 (좌 → 우: 13K 스팀 → 1효 E-320 → 2효 E-330 → 3효 E-340 → 표면응축기 E-350) ──
      {
        id: 'ev_steam_in',
        tag: 'FEED-13K-STM',
        name: '13K 생스팀 (8.35 kG · 175.4°C)',
        unitType: 'feed',
        position: { x: 20, y: 85 },
        params: {
          feedTempC: 175.4,
          feedPressKgcm2g: 8.35,
          feedFlowsKgH: zeroFlows({ H2O: 10713 }),
        },
      },
      {
        id: 'ev_e320',
        tag: 'E-320 (1효)',
        name: '1효 고온 강하막 증발관 (13K 스팀)',
        unitType: 'evaporator',
        position: { x: 240, y: 75 },
        params: {
          calcMode: 'rigorous',
          evapTargetConcWt: 50.0,
          operTempC: 164.8,
          operPressKgcm2g: 0.72,
        },
      },
      {
        id: 'ev_e330',
        tag: 'E-330 (2효)',
        name: '2효 강하막 증발관 (-0.68 kG)',
        unitType: 'evaporator',
        position: { x: 680, y: 75 },
        params: {
          calcMode: 'rigorous',
          evapTargetConcWt: 41.9,
          operTempC: 108.5,
          operPressKgcm2g: -0.68,
        },
      },
      {
        id: 'ev_e340',
        tag: 'E-340 (3효)',
        name: '3효 강하막 증발관 (-0.94 kG)',
        unitType: 'evaporator',
        position: { x: 1120, y: 75 },
        params: {
          calcMode: 'rigorous',
          evapTargetConcWt: 36.3,
          operTempC: 68.4,
          operPressKgcm2g: -0.94,
        },
      },
      {
        id: 'ev_in',
        tag: 'BOUND-32%NaOH',
        name: '32.0% 가성소다 급액 (L1 · 상위연동)',
        unitType: 'feed',
        position: { x: 1350, y: 10 },
        params: {
          boundaryFromMasterNodeId: 'fp_ev300',
          boundaryPortRole: 'in',
          feedTempC: 90.0,
          feedPressKgcm2g: 2.0,
          feedFlowsKgH: zeroFlows({ NaOH: 21427, H2O: 45533 }),
        },
      },
      {
        id: 'ev_e350',
        tag: 'E-350',
        name: '진공 표면응축기 (3효 증기 응축)',
        unitType: 'hex',
        position: { x: 1580, y: 75 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 45.0,
        },
      },
      {
        id: 'ev_m_vap',
        tag: 'A-350',
        name: '2·3효·표면응축수 회수헤더',
        unitType: 'mixer',
        position: { x: 1350, y: 215 },
        params: { multiplier: 1 },
      },
      {
        id: 'ev_out_cond',
        tag: 'OUT-CONDENSATE',
        name: '회수 공정응축수 (C4 → 순수조)',
        unitType: 'product',
        position: { x: 1580, y: 215 },
        params: {},
      },

      // ── 중단 행 (50% NaOH 제품 열회수: E-320 → E-332 → E-342 → E-352 → L14) ──
      {
        id: 'ev_mx330',
        tag: 'MX-330',
        name: '1효 급액 합류 (L10 · 157.2°C)',
        unitType: 'mixer',
        position: { x: 350, y: 280 },
        params: { multiplier: 1 },
      },
      {
        id: 'ev_e332',
        tag: 'E-332',
        name: '1효 예열기 (50% NaOH 열회수)',
        unitType: 'hex',
        position: { x: 520, y: 340 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'steam_lp',
          hexSpecMode: 'proc_temp',
          operTempC: 156.2,
        },
      },
      {
        id: 'ev_sp330',
        tag: 'SP-330',
        name: '2효 출구 분기 (L7 · 75.5% / 24.5%)',
        unitType: 'splitter',
        position: { x: 690, y: 395 },
        params: { splitRatioTop: 0.755 },
      },
      {
        id: 'ev_mx340',
        tag: 'MX-340',
        name: '2효 급액 합류 (L5 · 109.6°C)',
        unitType: 'mixer',
        position: { x: 850, y: 280 },
        params: { multiplier: 1 },
      },
      {
        id: 'ev_e342',
        tag: 'E-342',
        name: '2효 예열기 (50% NaOH 열회수)',
        unitType: 'hex',
        position: { x: 1020, y: 340 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'steam_lp',
          hexSpecMode: 'proc_temp',
          operTempC: 108.2,
        },
      },
      {
        id: 'ev_sp340',
        tag: 'SP-340',
        name: '3효 출구 분기 (L2 · 75.5% / 24.5%)',
        unitType: 'splitter',
        position: { x: 1190, y: 395 },
        params: { splitRatioTop: 0.755 },
      },
      {
        id: 'ev_e352',
        tag: 'E-352',
        name: '50% NaOH 제품냉각기 (75→42°C)',
        unitType: 'hex',
        position: { x: 1380, y: 340 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 42.0,
        },
      },
      {
        id: 'ev_out_50',
        tag: 'OUT-50%NaOH',
        name: '50.0 wt% 가성소다 제품 (L14)',
        unitType: 'product',
        position: { x: 1600, y: 340 },
        params: {},
      },

      // ── 하단 행 (1효 고온 생스팀 콘덴세이트 열회수: E-320 → C1 → E-333 → C2 → E-343 → C3 보일러) ──
      {
        id: 'ev_e333',
        tag: 'E-333',
        name: '1효 예열기 (스팀응축수 열회수)',
        unitType: 'hex',
        position: { x: 520, y: 500 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'steam_lp',
          hexSpecMode: 'proc_temp',
          operTempC: 160.0,
        },
      },
      {
        id: 'ev_e343',
        tag: 'E-343',
        name: '2효 예열기 (스팀응축수 열회수)',
        unitType: 'hex',
        position: { x: 1020, y: 500 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'steam_lp',
          hexSpecMode: 'proc_temp',
          operTempC: 114.0,
        },
      },
      {
        id: 'ev_out_stm_cond',
        tag: 'OUT-STM-COND',
        name: '1효 생스팀 응축수 회수 (C3 → 보일러)',
        unitType: 'product',
        position: { x: 1380, y: 505 },
        params: {},
      },
    ],
    edges: [
      // ① 3효→2효 액상 병렬 예열 (L1 → E-340 → SP-340 → E-342[75.5%] + E-343[24.5%] → MX-340 → E-330)
      { id: 'eve1', streamNo: 'L1', source: 'ev_in', target: 'ev_e340', sourcePort: 'out', targetPort: 'in' },
      { id: 'eve2', streamNo: 'L2', source: 'ev_e340', target: 'ev_sp340', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'eve3a', streamNo: 'L3 (75.5%)', source: 'ev_sp340', target: 'ev_e342', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'eve3b', streamNo: 'L4 (24.5%)', source: 'ev_sp340', target: 'ev_e343', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'eve4a', streamNo: 'L5A', source: 'ev_e342', target: 'ev_mx340', sourcePort: 'out', targetPort: 'in' },
      { id: 'eve4b', streamNo: 'L5B', source: 'ev_e343', target: 'ev_mx340', sourcePort: 'out', targetPort: 'in' },
      { id: 'eve5', streamNo: 'L5', source: 'ev_mx340', target: 'ev_e330', sourcePort: 'out', targetPort: 'in' },
      // ② 2효→1효 액상 병렬 예열 (E-330 → SP-330 → E-332[75.5%] + E-333[24.5%] → MX-330 → E-320)
      { id: 'eve6', streamNo: 'L7', source: 'ev_e330', target: 'ev_sp330', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'eve7a', streamNo: 'L8 (75.5%)', source: 'ev_sp330', target: 'ev_e332', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'eve7b', streamNo: 'L9 (24.5%)', source: 'ev_sp330', target: 'ev_e333', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'eve8a', streamNo: 'L10A', source: 'ev_e332', target: 'ev_mx330', sourcePort: 'out', targetPort: 'in' },
      { id: 'eve8b', streamNo: 'L10B', source: 'ev_e333', target: 'ev_mx330', sourcePort: 'out', targetPort: 'in' },
      { id: 'eve9', streamNo: 'L10', source: 'ev_mx330', target: 'ev_e320', sourcePort: 'out', targetPort: 'in' },
      // ③ 1효 출구 50% NaOH 고온 제품 열회수 체인 (E-320 → E-332[고온측] → E-342[고온측] → E-352 냉각기 → 50% NaOH 제품)
      { id: 'eve10', streamNo: 'L11 (50%)', source: 'ev_e320', target: 'ev_e332', sourcePort: 'liquid', targetPort: 'util_in' },
      { id: 'eve11', streamNo: 'L12 (50%)', source: 'ev_e332', target: 'ev_e342', sourcePort: 'util_out', targetPort: 'util_in' },
      { id: 'eve12', streamNo: 'L13 (50%)', source: 'ev_e342', target: 'ev_e352', sourcePort: 'util_out', targetPort: 'in' },
      { id: 'eve13', streamNo: 'L14 (50%)', source: 'ev_e352', target: 'ev_out_50', sourcePort: 'out', targetPort: 'in' },
      // ④ 증기 순류 열원 캐스케이드 (13K 생스팀 → E-320, 1효증기 → E-330, 2효증기 → E-340, 3효증기 → E-350 표면응축기)
      { id: 'eve14', streamNo: 'S1 (13K)', source: 'ev_steam_in', target: 'ev_e320', sourcePort: 'out', targetPort: 'util_in' },
      { id: 'eve15', streamNo: 'V1 (1→2효)', source: 'ev_e320', target: 'ev_e330', sourcePort: 'vapor', targetPort: 'util_in' },
      { id: 'eve16', streamNo: 'V2 (2→3효)', source: 'ev_e330', target: 'ev_e340', sourcePort: 'vapor', targetPort: 'util_in' },
      { id: 'eve17', streamNo: 'V3 (3효→SC)', source: 'ev_e340', target: 'ev_e350', sourcePort: 'vapor', targetPort: 'in' },
      // ⑤ 1효 고온 생스팀 콘덴세이트 열회수 체인 (E-320 → E-333[고온측] → E-343[고온측] → 보일러 응축수 회수)
      { id: 'eve18', streamNo: 'C1 (1효응축)', source: 'ev_e320', target: 'ev_e333', sourcePort: 'util_out', targetPort: 'util_in' },
      { id: 'eve19', streamNo: 'C2 (E-333출)', source: 'ev_e333', target: 'ev_e343', sourcePort: 'util_out', targetPort: 'util_in' },
      { id: 'eve20', streamNo: 'C3 (→보일러)', source: 'ev_e343', target: 'ev_out_stm_cond', sourcePort: 'util_out', targetPort: 'in' },
      // ⑥ 2·3효 가열증기 응축수 + E-350 표면응축수 → A-350 회수헤더 → 순수조
      { id: 'eve21', streamNo: 'C-E2', source: 'ev_e330', target: 'ev_m_vap', sourcePort: 'util_out', targetPort: 'in' },
      { id: 'eve22', streamNo: 'C-E3', source: 'ev_e340', target: 'ev_m_vap', sourcePort: 'util_out', targetPort: 'in' },
      { id: 'eve23', streamNo: 'C-SC', source: 'ev_e350', target: 'ev_m_vap', sourcePort: 'out', targetPort: 'in' },
      { id: 'eve24', streamNo: 'COND-OUT', source: 'ev_m_vap', target: 'ev_out_cond', sourcePort: 'out', targetPort: 'in' },
    ],
  },

  // ── [400-A] 염소가스 직접수세(T-410) & 3단 티타늄 냉각(E-413 → E-423 → E-433) ──
  {
    id: 'sub_400_cooling',
    sectionCode: '400-A SEC',
    shortTabLabel: '🌡️ 400-A 염소 수세·3단냉각',
    title: '[400-A 세부공정] 습윤 염소가스 직접수세탑(T-410) · 3단 티타늄 냉각기(E-413 CW → E-423 냉수 → E-433 칠러 14°C)',
    subtitle:
      '87°C 포화 습윤 염소가스를 염소 하이드레이트 결정 생성 한계(12°C) 직상인 14°C까지 다단 냉각하여 수분의 97% 이상을 사전 응축 분리합니다.',
    parentMasterNodeIds: ['fp_e410', 'fp_d420'],
    nodes: [
      {
        id: 'cl_in',
        tag: 'BOUND-WET-CL2',
        name: '87°C 습윤 Cl₂ 인입 (상위연동)',
        unitType: 'feed',
        position: { x: 35, y: 170 },
        params: {
          boundaryFromMasterNodeId: 'fp_e410',
          boundaryPortRole: 'in',
          feedTempC: 87,
          feedPressKgcm2g: 0.36,
          feedFlowsKgH: zeroFlows({ Cl2: 19135, O2: 26, H2O: 3970 }),
        },
      },
      {
        id: 'cl_t410',
        tag: 'T-410',
        name: 'Cl₂ 직접수세 냉각탑 (87→58°C)',
        unitType: 'hex',
        position: { x: 265, y: 165 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 58.0,
          operPressKgcm2g: 0.32,
        },
      },
      {
        id: 'cl_e413',
        tag: 'E-413',
        name: '1차 티타늄 CW 냉각기 (38°C)',
        unitType: 'hex',
        position: { x: 500, y: 165 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 38.0,
          operPressKgcm2g: 0.29,
        },
      },
      {
        id: 'cl_e423',
        tag: 'E-423',
        name: '2차 티타늄 냉수냉각기 (22°C)',
        unitType: 'hex',
        position: { x: 735, y: 165 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'chw',
          hexSpecMode: 'proc_temp',
          operTempC: 22.0,
          operPressKgcm2g: 0.26,
        },
      },
      {
        id: 'cl_e433',
        tag: 'E-433',
        name: '3차 티타늄 칠러냉각기 (14°C)',
        unitType: 'hex',
        position: { x: 970, y: 165 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'chw',
          hexSpecMode: 'proc_temp',
          operTempC: 14.0,
          operPressKgcm2g: 0.23,
        },
      },
      {
        id: 'cl_d420',
        tag: 'D-420',
        name: '염소 응축수 기액분리기',
        unitType: 'separator',
        position: { x: 1205, y: 165 },
        params: { calcMode: 'rigorous', operTempC: 14.0, operPressKgcm2g: 0.22 },
      },
      {
        id: 'cl_out_gas',
        tag: 'OUT-COOLED-CL2',
        name: '14°C 냉각 Cl₂ (→ T-430 건조탑)',
        unitType: 'product',
        position: { x: 1445, y: 105 },
        params: {},
      },
      {
        id: 'cl_out_cond',
        tag: 'OUT-CL2-WATER',
        name: '염소수 응축액 (→ 탈염소탑 회수)',
        unitType: 'product',
        position: { x: 1445, y: 245 },
        params: {},
      },
    ],
    edges: [
      { id: 'cle1', streamNo: 'CL-01', source: 'cl_in', target: 'cl_t410', sourcePort: 'out', targetPort: 'in' },
      { id: 'cle2', streamNo: 'CL-02', source: 'cl_t410', target: 'cl_e413', sourcePort: 'out', targetPort: 'in' },
      { id: 'cle3', streamNo: 'CL-03', source: 'cl_e413', target: 'cl_e423', sourcePort: 'out', targetPort: 'in' },
      { id: 'cle4', streamNo: 'CL-04', source: 'cl_e423', target: 'cl_e433', sourcePort: 'out', targetPort: 'in' },
      { id: 'cle5', streamNo: 'CL-05', source: 'cl_e433', target: 'cl_d420', sourcePort: 'out', targetPort: 'in' },
      { id: 'cle6', streamNo: 'CL-06', source: 'cl_d420', target: 'cl_out_gas', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'cle7', streamNo: 'CL-07', source: 'cl_d420', target: 'cl_out_cond', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },

  // ── [400-C] 염소 다단 터보압축(C-470) & 2단 프레온 액화기(D-484 · D-485) · 저장탱크(D-496) ──
  {
    id: 'sub_400_liquefaction',
    sectionCode: '400-C SEC',
    shortTabLabel: '❄️ 400-C 염소압축·액화',
    title: '[400-C 세부공정] 염소 다단 터보압축기(C-470) · 1차/2차 프레온 액화기(D-484 · D-485) · 가압저장탱크(D-496)',
    subtitle:
      '초건조 염소를 3.5 kg/cm²G로 다단 압축 후 1차(-16°C) 및 2차(-28°C) R-507A 프레온 액화기로 총 98% 이상 액화하여 D-496 탱크에 저장합니다.',
    parentMasterNodeIds: ['fp_lq484', 'fp_c470'],
    nodes: [
      {
        id: 'lq_in',
        tag: 'BOUND-DRY-CL2',
        name: '건조 Cl₂ 유입 (상위연동)',
        unitType: 'feed',
        position: { x: 35, y: 175 },
        params: {
          boundaryFromMasterNodeId: 'fp_lq484',
          boundaryPortRole: 'in',
          feedTempC: 38.0,
          feedPressKgcm2g: 3.5,
          feedFlowsKgH: zeroFlows({ Cl2: 16300, O2: 45, H2O: 0.03 }),
        },
      },
      {
        id: 'lq_d484',
        tag: 'D-484 (1차 액화기)',
        name: '1차 브라인/프레온 염소액화기 (-16°C)',
        unitType: 'liquefier',
        position: { x: 300, y: 165 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'freon_m35',
          hexSpecMode: 'proc_temp',
          operTempC: -16.0,
          foulingFactor: 0.0002,
        },
      },
      {
        id: 'lq_d485',
        tag: 'D-485 (2차 액화기)',
        name: '2차 심냉 프레온 염소액화기 (-28°C)',
        unitType: 'liquefier',
        position: { x: 600, y: 65 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'freon_m35',
          hexSpecMode: 'proc_temp',
          operTempC: -28.0,
          foulingFactor: 0.0002,
        },
      },
      {
        id: 'lq_out_sniff',
        tag: 'OUT-SNIFF-GAS',
        name: '비응축 테일가스 (→ T-730 제해탑)',
        unitType: 'product',
        position: { x: 915, y: 25 },
        params: {},
      },
      {
        id: 'lq_m490',
        tag: 'D-495',
        name: '액체염소 수액기 합류 (Accumulator)',
        unitType: 'mixer',
        position: { x: 915, y: 215 },
        params: { multiplier: 1 },
      },
      {
        id: 'lq_d496',
        tag: 'D-496A/B',
        name: '액체염소 수평 가압저장탱크 (2,000m³)',
        unitType: 'h_drum_visual',
        position: { x: 1145, y: 215 },
        params: { pressureDropKgcm2: 0, visualSpecNote: 'LTCS 저온탄소강 1,000 m³ × 2기 (-20°C, 3.5 kG)' },
      },
      {
        id: 'lq_p496',
        tag: 'P-496A/B',
        name: '캔드모터 무누설 출하펌프',
        unitType: 'pump',
        position: { x: 1375, y: 210 },
        params: { outletPressKgcm2g: 12.0, efficiency: 0.72 },
      },
      {
        id: 'lq_out_prod',
        tag: 'OUT-LIQ-CL2',
        name: '고순도 액체염소 출하',
        unitType: 'product',
        position: { x: 1595, y: 215 },
        params: {},
      },
    ],
    edges: [
      { id: 'lqe1', streamNo: 'LQ-01', source: 'lq_in', target: 'lq_d484', sourcePort: 'out', targetPort: 'in' },
      { id: 'lqe2', streamNo: 'LQ-02', source: 'lq_d484', target: 'lq_d485', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'lqe3', streamNo: 'LQ-03', source: 'lq_d484', target: 'lq_m490', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'lqe4', streamNo: 'LQ-04', source: 'lq_d485', target: 'lq_out_sniff', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'lqe5', streamNo: 'LQ-05', source: 'lq_d485', target: 'lq_m490', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'lqe6', streamNo: 'LQ-06', source: 'lq_m490', target: 'lq_d496', sourcePort: 'out', targetPort: 'in' },
      { id: 'lqe7', streamNo: 'LQ-07', source: 'lq_d496', target: 'lq_p496', sourcePort: 'out', targetPort: 'in' },
      { id: 'lqe8', streamNo: 'LQ-08', source: 'lq_p496', target: 'lq_out_prod', sourcePort: 'out', targetPort: 'in' },
    ],
  },

  // ── [600 SEC] 수소가스 세정 · 냉각 · 23kG 왕복동 압축 · 실리카겔 제습 ──
  {
    id: 'sub_600_h2',
    sectionCode: '600 SEC',
    shortTabLabel: '💨 600 수소 23kG·제습',
    title: '[600 세부공정] 수소가스 세정(T-610) · CW/칠러냉각(E-5613/5630) · 23kG 압축기(C-620) · 실리카겔 제습탑(D-650)',
    subtitle:
      '음극 수소가스의 알칼리 미스트를 세정 후 10°C 냉각·23 kg/cm²G 압축·고압 냉각 및 실리카겔 흡착제습(노점 -60°C)을 거쳐 99.99% 초고순도 수소를 출하합니다.',
    parentMasterNodeIds: ['fp_pk600', 'fp_d650'],
    nodes: [
      {
        id: 'h2_in',
        tag: 'BOUND-WET-H2',
        name: '89°C 습윤 H₂ 인입 (상위연동)',
        unitType: 'feed',
        position: { x: 30, y: 175 },
        params: {
          boundaryFromMasterNodeId: 'fp_pk600',
          boundaryPortRole: 'in',
          feedTempC: 89,
          feedPressKgcm2g: 0.42,
          feedFlowsKgH: zeroFlows({ H2: 446, H2O: 1186 }),
        },
      },
      {
        id: 'h2_e5613',
        tag: 'T-610 / E-5613',
        name: '수소 세정 & 1차 CW 냉각기 (41°C)',
        unitType: 'hex',
        position: { x: 255, y: 170 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 41.0,
          operPressKgcm2g: 0.32,
        },
      },
      {
        id: 'h2_e5630',
        tag: 'E-5630',
        name: '수소 2차 칠러냉각기 (10°C)',
        unitType: 'hex',
        position: { x: 485, y: 170 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'chw',
          hexSpecMode: 'proc_temp',
          operTempC: 10.0,
          operPressKgcm2g: 0.25,
        },
      },
      {
        id: 'h2_d610',
        tag: 'D-610',
        name: '수소 응축수 분리드럼',
        unitType: 'separator',
        position: { x: 705, y: 170 },
        params: { calcMode: 'rigorous', operTempC: 10.0, operPressKgcm2g: 0.22 },
      },
      {
        id: 'h2_out_cond',
        tag: 'OUT-H2-COND',
        name: '수소 응축수 회수',
        unitType: 'product',
        position: { x: 925, y: 305 },
        params: {},
      },
      {
        id: 'h2_c620',
        tag: 'C-620A/B',
        name: '무급유 2단 왕복동 압축기 (23kG)',
        unitType: 'compressor',
        position: { x: 925, y: 155 },
        params: {
          calcMode: 'rigorous',
          outletPressKgcm2g: 23.0,
          efficiency: 0.76,
          compStages: 3,
          intercooledTempC: 40.0,
        },
      },
      {
        id: 'h2_e5680',
        tag: 'E-5680',
        name: '고압 수소 칠러 애프터쿨러 (10°C)',
        unitType: 'hex',
        position: { x: 1155, y: 155 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'chw',
          hexSpecMode: 'proc_temp',
          operTempC: 10.0,
        },
      },
      {
        id: 'h2_d650',
        tag: 'D-650A/B',
        name: '실리카겔 스윙 제습탑 (노점 -60°C)',
        unitType: 'desiccant_dryer',
        position: { x: 1385, y: 155 },
        params: {
          calcMode: 'rigorous',
          targetDewPointC: -60,
          columnDeltaPKgcm2: 0.25,
          operTempC: 25.0,
        },
      },
      {
        id: 'h2_out_prod',
        tag: 'D-680 (H₂ 출하)',
        name: '99.99% 고압 수소 헤더 (22.7 kG)',
        unitType: 'product',
        position: { x: 1615, y: 155 },
        params: {},
      },
      {
        id: 'h2_out_ko',
        tag: 'DRN-C620-KO',
        name: '압축 단간 응축수 드레인',
        unitType: 'product',
        position: { x: 925, y: 295 },
        params: {},
      },
      {
        id: 'h2_out_reg',
        tag: 'DRN-D650-H2O',
        name: '제습탑 재생수 배출',
        unitType: 'product',
        position: { x: 1385, y: 295 },
        params: {},
      },
    ],
    edges: [
      { id: 'h2e1', streamNo: 'H2-01', source: 'h2_in', target: 'h2_e5613', sourcePort: 'out', targetPort: 'in' },
      { id: 'h2e2', streamNo: 'H2-02', source: 'h2_e5613', target: 'h2_e5630', sourcePort: 'out', targetPort: 'in' },
      { id: 'h2e3', streamNo: 'H2-03', source: 'h2_e5630', target: 'h2_d610', sourcePort: 'out', targetPort: 'in' },
      { id: 'h2e4', streamNo: 'H2-04', source: 'h2_d610', target: 'h2_c620', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'h2e5', streamNo: 'H2-05', source: 'h2_d610', target: 'h2_out_cond', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'h2e6', streamNo: 'H2-06', source: 'h2_c620', target: 'h2_e5680', sourcePort: 'out', targetPort: 'in' },
      { id: 'h2e6d', streamNo: 'H2-06D', source: 'h2_c620', target: 'h2_out_ko', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'h2e7', streamNo: 'H2-07', source: 'h2_e5680', target: 'h2_d650', sourcePort: 'out', targetPort: 'in' },
      { id: 'h2e8', streamNo: 'H2-08', source: 'h2_d650', target: 'h2_out_prod', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'h2e8d', streamNo: 'H2-08D', source: 'h2_d650', target: 'h2_out_reg', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },

  // ── [500 & 700 SEC] 흑연 염산 합성(35% HCl) & 폐염소 2단 가성제해(12% NaOCl) ──
  {
    id: 'sub_500_700_hcl_hypo',
    sectionCode: '500·700 SEC',
    shortTabLabel: '🧪 500·700 염산·제해탑',
    title: '[500 & 700 세부공정] 불침투성 흑연 염산합성(R-501 · T-502, 35% HCl) & 폐염소 2단 가성제해(T-730 · T-760, 12% NaOCl)',
    subtitle:
      '상단은 Cl₂+H₂ 연소 합성 및 35% 고순도 염산 흡수 계통이며, 하단은 액화 테일가스를 2단 가성소다 타워로 완벽 제해(<1 ppm Cl₂)하여 12% 차아염소산소다를 생산합니다.',
    parentMasterNodeIds: ['fp_r500', 'fp_c502', 'fp_t730'],
    nodes: [
      // 상단: 500 SEC 염산합성
      {
        id: 'hy_in_hcl_feed',
        tag: 'BOUND-HCL-GAS',
        name: 'Cl₂ + 과잉 H₂ 원료가스 (상위연동)',
        unitType: 'feed',
        position: { x: 40, y: 75 },
        params: {
          boundaryFromMasterNodeId: 'fp_r500',
          boundaryPortRole: 'in',
          feedTempC: 35,
          feedPressKgcm2g: 1.5,
          feedFlowsKgH: zeroFlows({ Cl2: 3120, H2: 98 }),
        },
      },
      {
        id: 'hy_r501',
        tag: 'R-501',
        name: '흑연 염산합성 버너로',
        unitType: 'reactor',
        position: { x: 295, y: 70 },
        params: {
          calcMode: 'rigorous',
          reactionPreset: 'hcl_burner',
          conversion: 0.999,
          operTempC: 185,
          operPressKgcm2g: 1.2,
        },
      },
      {
        id: 'hy_e501',
        tag: 'E-501',
        name: '흑연 블록 가스냉각기',
        unitType: 'hex',
        position: { x: 545, y: 70 },
        params: {
          calcMode: 'rigorous',
          refrigerantPreset: 'cw',
          hexSpecMode: 'proc_temp',
          operTempC: 52,
        },
      },
      {
        id: 'hy_in_hcl_w',
        tag: 'FEED-501',
        name: '염산흡수 순수 (상위연동)',
        unitType: 'feed',
        position: { x: 800, y: -45 },
        params: {
          boundaryFromMasterNodeId: 'fp_c502',
          boundaryPortRole: 'liq_in',
          feedTempC: 35,
          feedPressKgcm2g: 1.5,
          feedFlowsKgH: zeroFlows({ H2O: 5495.78 }),
        },
      },
      {
        id: 'hy_c502',
        tag: 'T-502',
        name: '흑연 강하막 35% 염산흡수탑',
        unitType: 'absorber',
        position: { x: 800, y: 65 },
        params: {
          calcMode: 'rigorous',
          targetComponent: 'HCl',
          columnStages: 10,
          removalEfficiency: 0.999,
          solventMode: 'auto_target_wt',
          targetBottomWtPct: 35.0,
          makeupSolventComp: 'H2O',
          operTempC: 38,
        },
      },
      {
        id: 'hy_out_hcl_vent',
        tag: 'VENT-C502',
        name: '염산흡수탑 테일벤트',
        unitType: 'product',
        position: { x: 1090, y: 15 },
        params: {},
      },
      {
        id: 'hy_out_hcl',
        tag: 'TK-510 (35% HCl)',
        name: '35.0 wt% 고순도 염산 저장·출하',
        unitType: 'product',
        position: { x: 1090, y: 95 },
        params: {},
      },

      // 하단: 700 SEC 2단 폐염소 제해탑 (T-730 -> T-760)
      {
        id: 'hy_in_sniff',
        tag: 'BOUND-SNIFF',
        name: '액화 테일가스 Cl₂ 인입 (상위연동)',
        unitType: 'feed',
        position: { x: 40, y: 295 },
        params: {
          boundaryFromMasterNodeId: 'fp_t730',
          boundaryPortRole: 'in',
          feedTempC: -18,
          feedPressKgcm2g: 1.2,
          feedFlowsKgH: zeroFlows({ Cl2: 680, O2: 45 }),
        },
      },
      {
        id: 'hy_in_naoh730',
        tag: 'FEED-730-NAOH',
        name: '희석 가성소다 공급 (16.3%)',
        unitType: 'feed',
        position: { x: 345, y: 170 },
        params: {
          feedTempC: 28,
          feedPressKgcm2g: 1.2,
          feedFlowsKgH: zeroFlows({ NaOH: 859.17, H2O: 4409.98 }),
        },
      },
      {
        id: 'hy_t730',
        tag: 'T-730 (1차 제해탑)',
        name: '1차 가성소다 제해탑 (12% NaOCl)',
        unitType: 'absorber',
        position: { x: 345, y: 285 },
        params: {
          calcMode: 'rigorous',
          targetComponent: 'Cl2',
          columnStages: 6,
          removalEfficiency: 0.985,
          solventMode: 'auto_target_wt',
          targetBottomWtPct: 12.0,
          makeupSolventComp: 'NaOH',
          operTempC: 28,
        },
      },
      {
        id: 'hy_t760',
        tag: 'T-760 (2차 제해탑)',
        name: '2차 최종 안전 제해탑 (<1 ppm Cl₂)',
        unitType: 'absorber',
        position: { x: 700, y: 245 },
        params: {
          calcMode: 'rigorous',
          targetComponent: 'Cl2',
          columnStages: 6,
          removalEfficiency: 0.999,
          solventMode: 'connected_or_manual',
          makeupSolventComp: 'NaOH',
          makeupSolventKgH: 80,
          operTempC: 25,
        },
      },
      {
        id: 'hy_out_vent',
        tag: 'SAFE-VENT',
        name: '청정 배기가스 대기방출 (Cl₂ <1ppm)',
        unitType: 'product',
        position: { x: 1090, y: 205 },
        params: {},
      },
      {
        id: 'hy_out_t760_liq',
        tag: 'OUT-SCRUB-LIQ',
        name: '2차 제해탑 배출액',
        unitType: 'product',
        position: { x: 1090, y: 280 },
        params: {},
      },
      {
        id: 'hy_out_hypo',
        tag: 'OUT-12%NaOCl',
        name: '12% 차아염소산소다(락스 원액) 출하',
        unitType: 'product',
        position: { x: 1090, y: 365 },
        params: {},
      },
    ],
    edges: [
      { id: 'hye1', streamNo: 'HY-01', source: 'hy_in_hcl_feed', target: 'hy_r501', sourcePort: 'out', targetPort: 'in' },
      { id: 'hye2', streamNo: 'HY-02', source: 'hy_r501', target: 'hy_e501', sourcePort: 'out', targetPort: 'in' },
      { id: 'hye3', streamNo: 'HY-03', source: 'hy_e501', target: 'hy_c502', sourcePort: 'out', targetPort: 'in' },
      { id: 'hye3w', streamNo: 'HY-03W', source: 'hy_in_hcl_w', target: 'hy_c502', sourcePort: 'out', targetPort: 'liq_in' },
      { id: 'hye4v', streamNo: 'HY-04V', source: 'hy_c502', target: 'hy_out_hcl_vent', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'hye4', streamNo: 'HY-04', source: 'hy_c502', target: 'hy_out_hcl', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'hye5', streamNo: 'HY-05', source: 'hy_in_sniff', target: 'hy_t730', sourcePort: 'out', targetPort: 'in' },
      { id: 'hye5n', streamNo: 'HY-05N', source: 'hy_in_naoh730', target: 'hy_t730', sourcePort: 'out', targetPort: 'liq_in' },
      { id: 'hye6', streamNo: 'HY-06', source: 'hy_t730', target: 'hy_t760', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'hye7', streamNo: 'HY-07', source: 'hy_t760', target: 'hy_out_vent', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'hye7l', streamNo: 'HY-07L', source: 'hy_t760', target: 'hy_out_t760_liq', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'hye8', streamNo: 'HY-08', source: 'hy_t730', target: 'hy_out_hypo', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
];

export const ALL_HIERARCHY_TEMPLATES: SubSheetTemplate[] = [
  MASTER_FULL_PLANT_TEMPLATE,
  ...SUB_FLOWSHEET_TEMPLATES,
];

export function createInitialHierarchySheets(opts?: {
  syncMasterOnInit?: boolean;
}): Record<string, SheetRuntimeData> {
  const map: Record<string, SheetRuntimeData> = {};
  for (const tpl of ALL_HIERARCHY_TEMPLATES) {
    const positions: Record<string, { x: number; y: number }> = {};
    const simDefs: FlowNodeDef[] = tpl.nodes.map(({ position, ...def }) => {
      positions[def.id] = { ...position };
      return {
        ...def,
        params: {
          ...def.params,
          feedFlowsKgH: def.params.feedFlowsKgH ? { ...def.params.feedFlowsKgH } : undefined,
        },
      };
    });
    map[tpl.id] = {
      id: tpl.id,
      sectionCode: tpl.sectionCode,
      shortTabLabel: tpl.shortTabLabel,
      title: tpl.title,
      subtitle: tpl.subtitle,
      parentMasterNodeIds: [...tpl.parentMasterNodeIds],
      simDefs,
      positions,
      flowEdges: tpl.edges.map(e => ({ ...e })),
    };
  }

  // 초기 생성 시 동기 수렴 연산을 생략하여 즉시 오픈하고, 명시적 syncMasterOnInit 요청(회귀 검증 등) 시에만 마스터 경계 동기화 수행
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

/**
 * 상위 마스터 시트(masterSolved)에서 계산된 실제 유입 배관 유량·온도·압력을
 * 하위 서브-플로우시트의 경계 Feed 노드(boundaryFromMasterNodeId 지정 노드)에 자동 주입한다.
 */
export function applyMasterBoundaryToSubDefs(
  subDefs: FlowNodeDef[],
  masterEdges: FlowEdgeDef[],
  masterSolvedStreams: SolvedStream[]
): { syncedDefs: FlowNodeDef[]; syncedDescriptions: string[] } {
  const streamByEdgeId = new Map(masterSolvedStreams.map(s => [s.edgeId, s]));
  const syncedDescriptions: string[] = [];

  const syncedDefs = subDefs.map(def => {
    const masterNodeId = def.params.boundaryFromMasterNodeId;
    if (def.unitType !== 'feed' || !masterNodeId) return def;

    const portRole = def.params.boundaryPortRole;
    const incomingEdges = masterEdges.filter(e => {
      if (e.target !== masterNodeId) return false;
      if (!portRole) return true;
      if (portRole === 'in') return !e.targetPort || e.targetPort === 'in';
      return e.targetPort === portRole;
    });

    if (incomingEdges.length === 0) return def;

    const sumF: Record<SimCompKey, number> = emptySimFlows();
    let totM = 0;
    let tWeighted = 0;
    let minP = Infinity;

    for (const ie of incomingEdges) {
      const st = streamByEdgeId.get(ie.id);
      if (!st || st.totalMassKgH <= 0) continue;
      (Object.keys(sumF) as SimCompKey[]).forEach(k => {
        sumF[k] += st.flowsKgH[k] || 0;
      });
      totM += st.totalMassKgH;
      tWeighted += st.tempC * st.totalMassKgH;
      if (st.pressKgcm2g < minP) minP = st.pressKgcm2g;
    }

    if (totM <= 0.01) return def;

    const newT = Number((tWeighted / totM).toFixed(1));
    const newP = Number((Number.isFinite(minP) ? minP : 1.0).toFixed(2));
    const roundedFlows: Partial<Record<SimCompKey, number>> = {};
    (Object.keys(sumF) as SimCompKey[]).forEach(k => {
      roundedFlows[k] = Number(sumF[k].toFixed(3));
    });

    syncedDescriptions.push(`${def.tag} ← ${totM.toFixed(0)} kg/h (${newT}°C, ${newP} kG)`);

    return {
      ...def,
      params: {
        ...def.params,
        feedTempC: newT,
        feedPressKgcm2g: newP,
        feedFlowsKgH: roundedFlows,
      },
    };
  });

  return { syncedDefs, syncedDescriptions };
}

/**
 * 하위 세부 플로우시트(Sub-Flowsheet)에서 사용자가 조작한 결과를 상위 마스터 블록 파라미터에 역반영(Roll-Up)한다!
 * 예: sub_400_drying에서 황산건조탑 3기의 단수/신산량을 바꾸면 상위 PKG-430의 총괄 수분제거율·신산량이 자동 갱신됨!
 */
export function rollupSubSheetToMasterDefs(
  subSheetId: string,
  subDefs: FlowNodeDef[],
  subSolved: { streams: SolvedStream[]; units: SolvedUnitResult[]; convergence: FlowsheetConvergenceInfo },
  masterDefs: FlowNodeDef[]
): FlowNodeDef[] {
  if (subSheetId === 'sub_400_drying') {
    const inS = subSolved.streams.find(s => s.fromTag === 'BOUND-CL2');
    const outS = subSolved.streams.find(s => s.toTag === 'OUT-DRY-CL2');
    const acidFeed = subDefs.find(d => d.id === 'dry_f_acid');
    const acidKgH = (acidFeed?.params.feedFlowsKgH?.H2SO4 ?? 1764) + (acidFeed?.params.feedFlowsKgH?.H2O ?? 36);
    if (inS && outS && inS.flowsKgH.H2O > 0.001) {
      const overallEff = Math.max(0.5, Math.min(0.99998, 1.0 - outS.flowsKgH.H2O / inS.flowsKgH.H2O));
      const outPpm = outS.moistureWtPpm ?? 2.0;
      return masterDefs.map(md =>
        md.id === 'fp_t430'
          ? {
              ...md,
              subSheetBadge: `3탑 출구수분 ${outPpm} ppm`,
              params: {
                ...md.params,
                calcMode: 'simple', // 하위 3탑 정밀 수렴 제거율을 그대로 반영!
                removalEfficiency: Number(overallEff.toFixed(6)),
                makeupSolventKgH: Math.round(acidKgH),
                operTempC: outS.tempC,
              },
            }
          : md
      );
    }
  } else if (subSheetId === 'sub_300_evap') {
    const e1 = subDefs.find(d => d.id === 'ev_e320');
    if (e1?.params.evapTargetConcWt) {
      return masterDefs.map(md =>
        md.id === 'fp_ev300'
          ? {
              ...md,
              subSheetBadge: `3효→2효→1효 (${e1.params.evapTargetConcWt}% 농축)`,
              params: { ...md.params, evapTargetConcWt: e1.params.evapTargetConcWt },
            }
          : md
      );
    }
  } else if (subSheetId === 'sub_100_primary') {
    const sat = subDefs.find(d => d.id === 'b1_d010');
    if (sat?.params.targetBrineWtPct) {
      return masterDefs.map(md =>
        md.id === 'fp_b110'
          ? {
              ...md,
              params: { ...md.params, targetBrineWtPct: sat.params.targetBrineWtPct, operTempC: sat.params.operTempC },
            }
          : md
      );
    }
  } else if (subSheetId === 'sub_400_liquefaction') {
    const lq2 = subDefs.find(d => d.id === 'lq_d485');
    if (lq2?.params.operTempC !== undefined) {
      return masterDefs.map(md =>
        md.id === 'fp_lq484'
          ? {
              ...md,
              subSheetBadge: `2단 프레온액화 (${lq2.params.operTempC}°C)`,
              params: { ...md.params, operTempC: lq2.params.operTempC },
            }
          : md
      );
    }
  } else if (subSheetId === 'sub_600_h2') {
    const comp = subDefs.find(d => d.id === 'h2_c620');
    const dryer = subDefs.find(d => d.id === 'h2_d650');
    return masterDefs.map(md => {
      if (md.id === 'fp_pk600' && comp?.params.outletPressKgcm2g !== undefined) {
        return { ...md, params: { ...md.params, outletPressKgcm2g: comp.params.outletPressKgcm2g } };
      }
      if (md.id === 'fp_d650' && dryer?.params.targetDewPointC !== undefined) {
        return { ...md, params: { ...md.params, targetDewPointC: dryer.params.targetDewPointC } };
      }
      return md;
    });
  } else if (subSheetId === 'sub_200_cell') {
    const el = subDefs.find(d => d.id === 'c2_el200');
    if (el) {
      return masterDefs.map(md =>
        md.id === 'fp_el200'
          ? {
              ...md,
              params: {
                ...md.params,
                currentKA: el.params.currentKA,
                cellCount: el.params.cellCount,
                unitCount: el.params.unitCount,
                currentEffPct: el.params.currentEffPct,
                operTempC: el.params.operTempC,
              },
            }
          : md
      );
    }
  }
  return masterDefs;
}

import type {
  FlowEdgeDef,
  FlowNodeDef,
} from '@/lib/calculations/flowsheetSolver';
import type { SimPropertyMethod } from '@/lib/calculations/componentCatalog';

export type PublicMiniExampleNode = FlowNodeDef & {
  nameEn: string;
  position: { x: number; y: number };
};

export interface PublicMiniExample {
  id: string;
  isPublicTextbook: true;
  btnLabel: string;
  btnLabelEn: string;
  title: string;
  titleEn: string;
  recommendedMethod?: SimPropertyMethod;
  nodes: PublicMiniExampleNode[];
  edges: FlowEdgeDef[];
}

/**
 * 공개 문헌 · 화공 교과서 기반 공개용 미니 예제 5종 (특정 상용 라이선서/실공정과 무관)
 * Modern Simulator & Classic Simulator 공용.
 */
export const PUBLIC_MINI_EXAMPLES: PublicMiniExample[] = [
  {
    id: 'new_plant_starter',
    isPublicTextbook: true,
    btnLabel: '미니 1: 혼합원료 냉각 · 기액분리 (MeOH/H₂O/N₂)',
    btnLabelEn: 'Mini 1: Cooler & Flash Separator (MeOH/H₂O/N₂)',
    title: '기본 자유설계 예제: FEED-101(MeOH/H₂O/N₂) → E-101 냉각기 → D-101 기액분리기 → 기상/액상 제품 분리',
    titleEn: 'Starter Example: FEED-101 (MeOH/H₂O/N₂) → E-101 Cooler → D-101 Flash Separator',
    recommendedMethod: 'AUTO',
    nodes: [
      {
        id: 'np_feed1', tag: 'FEED-101', name: '혼합 원료 공급', nameEn: 'Mixed Feed', unitType: 'feed',
        position: { x: 60, y: 120 },
        params: { feedTempC: 95.0, feedPressKgcm2g: 2.0, feedFlowsKgH: { MeOH: 3000, H2O: 5000, N2: 200 } },
      },
      {
        id: 'np_hex1', tag: 'E-101', name: '공정 냉각기', nameEn: 'Process Cooler', unitType: 'hex',
        position: { x: 320, y: 112 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'cw', operTempC: 35.0, overallU: 460 },
      },
      {
        id: 'np_sep1', tag: 'D-101', name: '기액 분리기', nameEn: 'Flash Separator', unitType: 'separator',
        position: { x: 590, y: 105 },
        params: { operTempC: 35.0, operPressKgcm2g: 1.9 },
      },
      {
        id: 'np_pvap', tag: 'PROD-GAS', name: '상부 가스 제품(G)', nameEn: 'Overhead Vapor (G)', unitType: 'product',
        position: { x: 860, y: 35 },
        params: {},
      },
      {
        id: 'np_pliq', tag: 'PROD-LIQ', name: '하부 응축액 제품(L)', nameEn: 'Bottoms Liquid (L)', unitType: 'product',
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
    btnLabel: '미니 2: 벤젠–톨루엔(B/T) 20단 정밀증류탑 (PR)',
    btnLabelEn: 'Mini 2: Benzene–Toluene 20-Stage Distillation (PR)',
    title: '교과서 표준 2성분 증류: FEED-101(Benzene 50% / Toluene 50%, 10 t/h) → E-101 예열기 → T-101 20단 정밀증류탑 (PR)',
    titleEn: 'Textbook Binary Distillation: Benzene/Toluene (50/50, 10 t/h) → E-101 Preheater → T-101 20-Stage Column (PR)',
    recommendedMethod: 'PR',
    nodes: [
      {
        id: 'bt_feed', tag: 'FEED-101', name: '벤젠-톨루엔 원료', nameEn: 'Benzene–Toluene Feed', unitType: 'feed',
        position: { x: 50, y: 155 },
        params: { feedTempC: 75.0, feedPressKgcm2g: 0.8, feedFlowsKgH: { Benzene: 5000, Toluene: 5000 } },
      },
      {
        id: 'bt_hx', tag: 'E-101', name: '원료 예열기', nameEn: 'Feed Preheater', unitType: 'hex',
        position: { x: 290, y: 150 },
        params: { hexSpecMode: 'proc_temp', operTempC: 92.0, overallU: 520 },
      },
      {
        id: 'bt_col', tag: 'T-101', name: 'B/T 정밀증류탑 (20단)', nameEn: 'B/T Distillation Column (20-Stage)', unitType: 'distillation',
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
        id: 'bt_top', tag: 'PROD-BZ', name: '탑정 벤젠 제품', nameEn: 'Benzene Distillate', unitType: 'product',
        position: { x: 830, y: 55 },
        params: {},
      },
      {
        id: 'bt_bot', tag: 'PROD-TOL', name: '탑저 톨루엔 제품', nameEn: 'Toluene Bottoms', unitType: 'product',
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
    btnLabel: '미니 3: 에탄올–물 공비 증류탑 (NRTL · 24단)',
    btnLabelEn: 'Mini 3: Ethanol–Water Azeotropic Column (NRTL · 24-Stage)',
    title: '비이상 공비계 증류: FEED-101(EtOH 25 wt% / H₂O 75 wt%, 8 t/h) → T-101 24단 NRTL 정밀증류탑',
    titleEn: 'Non-Ideal Azeotropic Distillation: EtOH 25 wt% / H₂O 75 wt% (8 t/h) → T-101 24-Stage NRTL Column',
    recommendedMethod: 'NRTL',
    nodes: [
      {
        id: 'ew_feed', tag: 'FEED-101', name: '에탄올 수용액 원료', nameEn: 'Aqueous Ethanol Feed', unitType: 'feed',
        position: { x: 70, y: 155 },
        params: { feedTempC: 65.0, feedPressKgcm2g: 0.3, feedFlowsKgH: { EtOH: 2000, H2O: 6000 } },
      },
      {
        id: 'ew_col', tag: 'T-101', name: '에탄올 정류탑 (24단)', nameEn: 'Ethanol Rectifying Column (24-Stage)', unitType: 'distillation',
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
        id: 'ew_top', tag: 'PROD-ETOH', name: '탑정 농축 에탄올', nameEn: 'Concentrated Ethanol', unitType: 'product',
        position: { x: 700, y: 55 },
        params: {},
      },
      {
        id: 'ew_bot', tag: 'PROD-H2O', name: '탑저 폐수(H₂O)', nameEn: 'Bottoms Water (H₂O)', unitType: 'product',
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
    id: 'textbook_awe_green_h2',
    isPublicTextbook: true,
    btnLabel: '미니 4: 그린수소 알칼라인 수전해 (AWE · H₂/O₂)',
    btnLabelEn: 'Mini 4: Green H₂ Alkaline Water Electrolysis (AWE)',
    title: '그린수소 수전해 미니 공정: 순수(H₂O) → EL-101 알칼라인 수전해조(2H₂O→2H₂+O₂) → E-101 수소 냉각기 → H₂/O₂ 제품',
    titleEn: 'Green H₂ Mini Flowsheet: Pure Water → EL-101 AWE Stack (2H₂O→2H₂+O₂) → E-101 H₂ Cooler → H₂/O₂ Products',
    recommendedMethod: 'AUTO',
    nodes: [
      {
        id: 'awe_feed', tag: 'FEED-H2O', name: '순수 공급 (DI Water)', nameEn: 'DI Water Feed', unitType: 'feed',
        position: { x: 50, y: 145 },
        params: { feedTempC: 60.0, feedPressKgcm2g: 5.0, feedFlowsKgH: { H2O: 2500, KOH: 500 } },
      },
      {
        id: 'awe_el', tag: 'EL-101', name: 'AWE 수전해 스택', nameEn: 'AWE Electrolyzer Stack', unitType: 'electrolyzer',
        position: { x: 310, y: 120 },
        params: {
          electrolyzerPreset: 'awe_water',
          currentKA: 10.0,
          cellCount: 200,
          unitCount: 1,
          currentEffPct: 98.0,
          cellVoltageV: 1.9,
          operTempC: 75.0,
          operPressKgcm2g: 5.0,
        },
      },
      {
        id: 'awe_hx', tag: 'E-101', name: '수소 가스 냉각기', nameEn: 'H₂ Product Cooler', unitType: 'hex',
        position: { x: 610, y: 40 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'cw', operTempC: 35.0, overallU: 350 },
      },
      {
        id: 'awe_h2', tag: 'PROD-H2', name: '그린수소 제품 (H₂)', nameEn: 'Green H₂ Product', unitType: 'product',
        position: { x: 870, y: 40 },
        params: {},
      },
      {
        id: 'awe_o2', tag: 'PROD-O2', name: '부산 산소 (O₂)', nameEn: 'Byproduct O₂', unitType: 'product',
        position: { x: 610, y: 165 },
        params: {},
      },
      {
        id: 'awe_liq', tag: 'RET-KOH', name: '순환 전해액 (KOH/H₂O)', nameEn: 'Electrolyte Return (KOH/H₂O)', unitType: 'product',
        position: { x: 610, y: 270 },
        params: {},
      },
    ],
    edges: [
      { id: 'awe_e1', streamNo: 'S-101', source: 'awe_feed', target: 'awe_el', sourcePort: 'out', targetPort: 'in' },
      { id: 'awe_e2', streamNo: 'S-102', source: 'awe_el', target: 'awe_hx', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'awe_e3', streamNo: 'S-103', source: 'awe_hx', target: 'awe_h2', sourcePort: 'out', targetPort: 'in' },
      { id: 'awe_e4', streamNo: 'S-104', source: 'awe_el', target: 'awe_o2', sourcePort: 'side_cut', targetPort: 'in' },
      { id: 'awe_e5', streamNo: 'S-105', source: 'awe_el', target: 'awe_liq', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  {
    id: 'textbook_meoh_synthesis',
    isPublicTextbook: true,
    btnLabel: '미니 5: 합성가스 메탄올 촉매합성 · 냉각분리 (CO+2H₂→MeOH)',
    btnLabelEn: 'Mini 5: Syngas-to-Methanol Reactor & Flash Separation',
    title: '메탄올 합성 미니 공정: 합성가스(CO+H₂) → R-101 촉매 반응기(250°C, 50 bar) → E-101 응축 냉각기 → D-101 고압 분리기',
    titleEn: 'Methanol Synthesis Mini Flowsheet: Syngas (CO+H₂) → R-101 Reactor (250°C, 50 bar) → E-101 Cooler → D-101 Flash Drum',
    recommendedMethod: 'PR',
    nodes: [
      {
        id: 'ms_feed', tag: 'FEED-SYN', name: '합성가스 원료 (CO/H₂)', nameEn: 'Syngas Feed (CO/H₂)', unitType: 'feed',
        position: { x: 40, y: 145 },
        params: { feedTempC: 220.0, feedPressKgcm2g: 50.0, feedFlowsKgH: { CO: 2800, H2: 420, N2: 120 } },
      },
      {
        id: 'ms_rxn', tag: 'R-101', name: '메탄올 촉매 반응기', nameEn: 'Methanol Synthesis Reactor', unitType: 'reactor',
        position: { x: 285, y: 135 },
        params: {
          reactionPreset: 'methanol_synthesis',
          conversion: 0.65,
          operTempC: 250.0,
          operPressKgcm2g: 49.0,
          reactorThermalMode: 'isothermal',
        },
      },
      {
        id: 'ms_hx', tag: 'E-101', name: '반응물 응축 냉각기', nameEn: 'Reactor Effluent Cooler', unitType: 'hex',
        position: { x: 540, y: 135 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'cw', operTempC: 40.0, overallU: 450 },
      },
      {
        id: 'ms_sep', tag: 'D-101', name: '고압 기액 분리기', nameEn: 'HP Flash Separator', unitType: 'separator',
        position: { x: 790, y: 128 },
        params: { operTempC: 40.0, operPressKgcm2g: 48.0 },
      },
      {
        id: 'ms_gas', tag: 'OFF-GAS', name: '미반응 가스 (CO/H₂)', nameEn: 'Unreacted Syngas (CO/H₂)', unitType: 'product',
        position: { x: 1030, y: 55 },
        params: {},
      },
      {
        id: 'ms_meoh', tag: 'PROD-MEOH', name: '조메탄올 제품 (MeOH)', nameEn: 'Crude Methanol (MeOH)', unitType: 'product',
        position: { x: 1030, y: 205 },
        params: {},
      },
    ],
    edges: [
      { id: 'ms_e1', streamNo: 'S-101', source: 'ms_feed', target: 'ms_rxn', sourcePort: 'out', targetPort: 'in' },
      { id: 'ms_e2', streamNo: 'S-102', source: 'ms_rxn', target: 'ms_hx', sourcePort: 'out', targetPort: 'in' },
      { id: 'ms_e3', streamNo: 'S-103', source: 'ms_hx', target: 'ms_sep', sourcePort: 'out', targetPort: 'in' },
      { id: 'ms_e4', streamNo: 'S-104', source: 'ms_sep', target: 'ms_gas', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ms_e5', streamNo: 'S-105', source: 'ms_sep', target: 'ms_meoh', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
  {
    id: 'hda_toluene_benzene_recycle',
    isPublicTextbook: true,
    btnLabel: 'HDA Process (Toluene → Benzene Recycle, PR)',
    btnLabelEn: 'HDA Process (Toluene → Benzene Recycle, PR)',
    title: 'HDA Process (Toluene Hydrodealkylation): Gas & Toluene Dual-Loop Recycle + Stabilizer + Benzene Column (PR)',
    titleEn: 'HDA Process (Toluene Hydrodealkylation): Gas & Toluene Dual-Loop Recycle + Stabilizer + Benzene Column (PR)',
    recommendedMethod: 'PR',
    nodes: [
      {
        id: 'hda_feed_tol', tag: 'FEED-TOL', name: 'Fresh Toluene Feed', nameEn: 'Fresh Toluene Feed', unitType: 'feed',
        position: { x: 20, y: 120 },
        params: { feedTempC: 25.0, feedPressKgcm2g: 26.0, feedFlowsKgH: { Toluene: 9214 } },
      },
      {
        id: 'hda_feed_h2', tag: 'FEED-H2', name: 'Fresh H₂ Makeup', nameEn: 'Fresh H₂ Makeup', unitType: 'feed',
        position: { x: 20, y: 260 },
        params: { feedTempC: 35.0, feedPressKgcm2g: 26.0, feedFlowsKgH: { H2: 340, CH4: 180 } },
      },
      {
        id: 'hda_mix', tag: 'M-101', name: 'Reactor Feed Mixer', nameEn: 'Reactor Feed Mixer', unitType: 'mixer',
        position: { x: 240, y: 185 },
        params: {},
      },
      {
        id: 'hda_furn', tag: 'E-101', name: 'Feed Preheater / Furnace', nameEn: 'Feed Preheater / Furnace', unitType: 'hex',
        position: { x: 430, y: 185 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'custom', utilInTempC: 950, utilOutTempC: 680, operTempC: 600.0, overallU: 180 },
      },
      {
        id: 'hda_rxn', tag: 'R-101', name: 'HDA Reactor (C₇H₈+H₂→C₆H₆+CH₄)', nameEn: 'HDA Reactor (C₇H₈+H₂→C₆H₆+CH₄)', unitType: 'reactor',
        position: { x: 640, y: 180 },
        params: {
          reactionPreset: 'toluene_hda',
          conversion: 0.75,
          operTempC: 620.0,
          operPressKgcm2g: 24.5,
          reactorThermalMode: 'isothermal',
        },
      },
      {
        id: 'hda_cool', tag: 'E-102', name: 'Effluent Quench Cooler', nameEn: 'Effluent Quench Cooler', unitType: 'hex',
        position: { x: 860, y: 185 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'cw', operTempC: 40.0, overallU: 420 },
      },
      {
        id: 'hda_sep', tag: 'V-101', name: 'HP Flash Separator', nameEn: 'HP Flash Separator', unitType: 'separator',
        position: { x: 1080, y: 178 },
        params: { operTempC: 40.0, operPressKgcm2g: 23.5 },
      },
      {
        id: 'hda_split', tag: 'SP-101', name: 'Gas Recycle / Purge Splitter', nameEn: 'Gas Recycle / Purge Splitter', unitType: 'splitter',
        position: { x: 1080, y: 20 },
        params: { splitRatioTop: 0.75 },
      },
      {
        id: 'hda_comp', tag: 'K-101', name: 'H₂ Recycle Compressor', nameEn: 'H₂ Recycle Compressor', unitType: 'compressor',
        position: { x: 640, y: 15 },
        params: { outletPressKgcm2g: 26.0, efficiency: 0.78, flipX: true },
      },
      {
        id: 'hda_purge', tag: 'OUT-FUEL', name: 'Fuel Gas Purge', nameEn: 'Fuel Gas Purge', unitType: 'product',
        position: { x: 1320, y: 20 },
        params: {},
      },
      {
        id: 'hda_vlv', tag: 'LV-101', name: 'Flash Letdown Valve', nameEn: 'Flash Letdown Valve', unitType: 'valve',
        position: { x: 1300, y: 215 },
        params: { outletPressKgcm2g: 1.5 },
      },
      {
        id: 'hda_stab', tag: 'T-101', name: 'Stabilizer Column', nameEn: 'Stabilizer Column', unitType: 'distillation',
        position: { x: 1490, y: 205 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            thermoModel: 'PR',
            totalStages: 12,
            feedStage: 6,
            condenserType: 'partial',
            reboilerType: 'kettle',
            topPressKgcm2g: 1.2,
            stageDeltaPKgcm2: 0.005,
            murphreeEffPct: 80,
            topSpecType: 'reflux_ratio',
            topSpecValue: 1.2,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.012,
          },
        },
      },
      {
        id: 'hda_offgas', tag: 'OUT-OFFGAS', name: 'Stabilizer Off-Gas', nameEn: 'Stabilizer Off-Gas', unitType: 'product',
        position: { x: 1730, y: 120 },
        params: {},
      },
      {
        id: 'hda_bzcol', tag: 'T-102', name: 'Benzene Product Column', nameEn: 'Benzene Product Column', unitType: 'distillation',
        position: { x: 1730, y: 265 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            thermoModel: 'PR',
            totalStages: 24,
            feedStage: 12,
            condenserType: 'total',
            reboilerType: 'kettle',
            topPressKgcm2g: 0.3,
            stageDeltaPKgcm2: 0.005,
            murphreeEffPct: 80,
            topSpecType: 'reflux_ratio',
            topSpecValue: 2.2,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.72,
          },
        },
      },
      {
        id: 'hda_prodbz', tag: 'PROD-BZ', name: 'Pure Benzene Product', nameEn: 'Pure Benzene Product', unitType: 'product',
        position: { x: 1980, y: 215 },
        params: {},
      },
      {
        id: 'hda_pump', tag: 'P-101', name: 'Toluene Recycle Pump', nameEn: 'Toluene Recycle Pump', unitType: 'pump',
        position: { x: 1080, y: 390 },
        params: { outletPressKgcm2g: 26.0, efficiency: 0.75, flipX: true },
      },
    ],
    edges: [
      { id: 'hda_e1', streamNo: 'S-101', source: 'hda_feed_tol', target: 'hda_mix', sourcePort: 'out', targetPort: 'in' },
      { id: 'hda_e2', streamNo: 'S-102', source: 'hda_feed_h2', target: 'hda_mix', sourcePort: 'out', targetPort: 'in' },
      { id: 'hda_e3', streamNo: 'S-103', source: 'hda_mix', target: 'hda_furn', sourcePort: 'out', targetPort: 'in' },
      { id: 'hda_e4', streamNo: 'S-104', source: 'hda_furn', target: 'hda_rxn', sourcePort: 'out', targetPort: 'in' },
      { id: 'hda_e5', streamNo: 'S-105', source: 'hda_rxn', target: 'hda_cool', sourcePort: 'out', targetPort: 'in' },
      { id: 'hda_e6', streamNo: 'S-106', source: 'hda_cool', target: 'hda_sep', sourcePort: 'out', targetPort: 'in' },
      { id: 'hda_e7', streamNo: 'S-107', source: 'hda_sep', target: 'hda_split', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'hda_e8', streamNo: 'S-108', source: 'hda_split', target: 'hda_comp', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'hda_e9', streamNo: 'S-109', source: 'hda_comp', target: 'hda_mix', sourcePort: 'out', targetPort: 'in' },
      { id: 'hda_e10', streamNo: 'S-110', source: 'hda_split', target: 'hda_purge', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'hda_e11', streamNo: 'S-111', source: 'hda_sep', target: 'hda_vlv', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'hda_e12', streamNo: 'S-112', source: 'hda_vlv', target: 'hda_stab', sourcePort: 'out', targetPort: 'in' },
      { id: 'hda_e13', streamNo: 'S-113', source: 'hda_stab', target: 'hda_offgas', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'hda_e14', streamNo: 'S-114', source: 'hda_stab', target: 'hda_bzcol', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'hda_e15', streamNo: 'S-115', source: 'hda_bzcol', target: 'hda_prodbz', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'hda_e16', streamNo: 'S-116', source: 'hda_bzcol', target: 'hda_pump', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'hda_e17', streamNo: 'S-117', source: 'hda_pump', target: 'hda_mix', sourcePort: 'out', targetPort: 'in' },
    ],
  },
  {
    id: 'mea_co2_capture_ccus',
    isPublicTextbook: true,
    btnLabel: 'MEA CO₂ Capture (CCUS — Absorber + Stripper Recycle, NRTL)',
    btnLabelEn: 'MEA CO₂ Capture (CCUS — Absorber + Stripper Recycle, NRTL)',
    title: 'MEA CO₂ Capture (CCUS): 30 wt% Amine Absorber (90% Capture) + Stripper Regenerator + Closed Solvent Recycle (NRTL)',
    titleEn: 'MEA CO₂ Capture (CCUS): 30 wt% Amine Absorber (90% Capture) + Stripper Regenerator + Closed Solvent Recycle (NRTL)',
    recommendedMethod: 'NRTL',
    nodes: [
      {
        id: 'ccus_flue', tag: 'FEED-FLUE', name: 'Flue Gas Feed (16.8% CO₂)', nameEn: 'Flue Gas Feed (16.8% CO₂)', unitType: 'feed',
        position: { x: 20, y: 245 },
        params: { feedTempC: 42.0, feedPressKgcm2g: 0.2, feedFlowsKgH: { N2: 20000, CO2: 4400, O2: 1600, H2O: 200 } },
      },
      {
        id: 'ccus_mkp', tag: 'FEED-MEA', name: 'MEA / Water Makeup', nameEn: 'MEA / Water Makeup', unitType: 'feed',
        position: { x: 20, y: 80 },
        params: { feedTempC: 40.0, feedPressKgcm2g: 0.5, feedFlowsKgH: { MEA: 240, H2O: 560 } },
      },
      {
        id: 'ccus_mix', tag: 'M-101', name: 'Lean Amine Surge Mixer', nameEn: 'Lean Amine Surge Mixer', unitType: 'mixer',
        position: { x: 245, y: 80 },
        params: {},
      },
      {
        id: 'ccus_abs', tag: 'T-101', name: 'CO₂ Absorber (30% MEA)', nameEn: 'CO₂ Absorber (30% MEA)', unitType: 'absorber',
        position: { x: 470, y: 185 },
        params: {
          calcMode: 'simple',
          targetComponent: 'CO2',
          removalEfficiency: 0.90,
          operTempC: 42.0,
          operPressKgcm2g: 0.15,
          solventMode: 'connected_or_manual',
        },
      },
      {
        id: 'ccus_clean', tag: 'OUT-FLUE', name: 'Treated Clean Flue Gas', nameEn: 'Treated Clean Flue Gas', unitType: 'product',
        position: { x: 720, y: 110 },
        params: {},
      },
      {
        id: 'ccus_pump', tag: 'P-101', name: 'Rich Amine Pump', nameEn: 'Rich Amine Pump', unitType: 'pump',
        position: { x: 720, y: 240 },
        params: { outletPressKgcm2g: 2.0, efficiency: 0.75 },
      },
      {
        id: 'ccus_preh', tag: 'E-101', name: 'Lean/Rich Amine Preheater', nameEn: 'Lean/Rich Amine Preheater', unitType: 'hex',
        position: { x: 930, y: 240 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'steam_lp', operTempC: 105.0, overallU: 520 },
      },
      {
        id: 'ccus_strip', tag: 'T-102', name: 'Amine Stripper / Regenerator', nameEn: 'Amine Stripper / Regenerator', unitType: 'distillation',
        position: { x: 1150, y: 225 },
        params: {
          calcMode: 'rigorous',
          distillConfig: {
            thermoModel: 'NRTL',
            totalStages: 14,
            feedStage: 4,
            condenserType: 'none',
            reboilerType: 'kettle',
            topPressKgcm2g: 0.8,
            stageDeltaPKgcm2: 0.005,
            murphreeEffPct: 75,
            topSpecType: 'reflux_ratio',
            topSpecValue: 0.5,
            splitSpecType: 'd_over_f_mass',
            splitSpecValue: 0.095,
          },
        },
      },
      {
        id: 'ccus_ovhd', tag: 'E-103', name: 'CO₂ Overhead Condenser', nameEn: 'CO₂ Overhead Condenser', unitType: 'hex',
        position: { x: 1410, y: 155 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'cw', operTempC: 40.0, overallU: 450 },
      },
      {
        id: 'ccus_co2', tag: 'PROD-CO2', name: 'Captured CO₂ Product', nameEn: 'Captured CO₂ Product', unitType: 'product',
        position: { x: 1640, y: 155 },
        params: {},
      },
      {
        id: 'ccus_cool', tag: 'E-102', name: 'Lean Amine Cooler', nameEn: 'Lean Amine Cooler', unitType: 'hex',
        position: { x: 930, y: 390 },
        params: { hexSpecMode: 'proc_temp', refrigerantPreset: 'cw', operTempC: 40.0, overallU: 480, flipX: true },
      },
      {
        id: 'ccus_split', tag: 'SP-101', name: 'Reclaimer Bleed Splitter', nameEn: 'Reclaimer Bleed Splitter', unitType: 'splitter',
        position: { x: 470, y: 390 },
        params: { splitRatioTop: 0.98, flipX: true },
      },
      {
        id: 'ccus_bleed', tag: 'OUT-BLEED', name: 'Amine Reclaimer Bleed (2%)', nameEn: 'Amine Reclaimer Bleed (2%)', unitType: 'product',
        position: { x: 245, y: 420 },
        params: {},
      },
    ],
    edges: [
      { id: 'ccus_e1', streamNo: 'S-201', source: 'ccus_flue', target: 'ccus_abs', sourcePort: 'out', targetPort: 'in' },
      { id: 'ccus_e2', streamNo: 'S-202', source: 'ccus_mkp', target: 'ccus_mix', sourcePort: 'out', targetPort: 'in' },
      { id: 'ccus_e3', streamNo: 'S-203', source: 'ccus_mix', target: 'ccus_abs', sourcePort: 'out', targetPort: 'liq_in' },
      { id: 'ccus_e4', streamNo: 'S-204', source: 'ccus_abs', target: 'ccus_clean', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ccus_e5', streamNo: 'S-205', source: 'ccus_abs', target: 'ccus_pump', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'ccus_e6', streamNo: 'S-206', source: 'ccus_pump', target: 'ccus_preh', sourcePort: 'out', targetPort: 'in' },
      { id: 'ccus_e7', streamNo: 'S-207', source: 'ccus_preh', target: 'ccus_strip', sourcePort: 'out', targetPort: 'in' },
      { id: 'ccus_e8', streamNo: 'S-208', source: 'ccus_strip', target: 'ccus_ovhd', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ccus_e8b', streamNo: 'S-208B', source: 'ccus_ovhd', target: 'ccus_co2', sourcePort: 'out', targetPort: 'in' },
      { id: 'ccus_e9', streamNo: 'S-209', source: 'ccus_strip', target: 'ccus_cool', sourcePort: 'liquid', targetPort: 'in' },
      { id: 'ccus_e10', streamNo: 'S-210', source: 'ccus_cool', target: 'ccus_split', sourcePort: 'out', targetPort: 'in' },
      { id: 'ccus_e11', streamNo: 'S-211', source: 'ccus_split', target: 'ccus_mix', sourcePort: 'vapor', targetPort: 'in' },
      { id: 'ccus_e12', streamNo: 'S-212', source: 'ccus_split', target: 'ccus_bleed', sourcePort: 'liquid', targetPort: 'in' },
    ],
  },
];

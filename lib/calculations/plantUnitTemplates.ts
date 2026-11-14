import {
  type FlowNodeDef,
  type FlowUnitType,
  type SimCompKey,
  emptySimFlows,
} from './flowsheetSolver';

export interface PlantUnitInletFeed {
  label: string;
  tempC: number;
  pressKgcm2g: number;
  flowsKgH: Partial<Record<SimCompKey, number>>;
}

export interface PlantUnitTemplate {
  id: string;
  plantLabel: string;
  tag: string;
  name: string;
  unitType: FlowUnitType;
  summary: string;
  params: FlowNodeDef['params'];
  inletFeed?: PlantUnitInletFeed;
}

export const PLANT_UNIT_TEMPLATES: PlantUnitTemplate[] = [
  // ── 1. 증류탑 / 정밀분리 (distillation) ─────────────────────────
  {
    id: 'tpl_c230_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'C-230A',
    name: '5N AHCl 다단 스트리핑 정제탑',
    unitType: 'distillation',
    summary: 'PENG_ROB · 17.6 kG · O₂/HCl 5N 정제',
    params: {
      calcMode: 'rigorous',
      distillConfig: {
        columnCalcMode: 'design_stages',
        thermoModel: 'PENG_ROB',
        designLkComp: 'O2',
        designHkComp: 'HCl',
        designTopBasis: 'recovery_pct',
        designTopRecoveryPct: 99.99,
        designBotBasis: 'purity_wt_pct',
        designBotPurityWtPct: 99.999,
        designRefluxMult: 1.25,
        topPressKgcm2g: 17.6,
        murphreeEffPct: 80,
      },
    },
    inletFeed: {
      label: 'E-225A 액화 AHCl 유입 (S2-05)',
      tempC: -13.0,
      pressKgcm2g: 17.7,
      flowsKgH: { HCl: 1976.0, O2: 0.45, H2: 0.05 },
    },
  },
  {
    id: 'tpl_c310_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'C-310',
    name: '폐염산 진공 농축탑 (0.15 barA)',
    unitType: 'distillation',
    summary: 'ELEC_HCL_AZEO · 진공 -0.85 kG · 공비 22.9%',
    params: {
      calcMode: 'rigorous',
      distillConfig: {
        columnCalcMode: 'rigorous_mesh',
        thermoModel: 'ELEC_HCL_AZEO',
        totalStages: 22,
        feedStage: 10,
        topPressKgcm2g: -0.85,
        murphreeEffPct: 75,
        topSpecType: 'reflux_ratio',
        topSpecValue: 1.8,
        splitSpecType: 'd_over_f_mass',
        splitSpecValue: 0.21,
      },
    },
    inletFeed: {
      label: '15 wt% 부생 폐염산 원료 (S3-01)',
      tempC: 35.0,
      pressKgcm2g: 0.5,
      flowsKgH: { HCl: 1500.0, H2O: 8500.0 },
    },
  },
  {
    id: 'tpl_c320_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'C-320',
    name: '가압 공비탈기 증류탑 (7.0 barA)',
    unitType: 'distillation',
    summary: 'ELEC_HCL_AZEO · 가압 6.0 kG · 공비 17.5%',
    params: {
      calcMode: 'rigorous',
      distillConfig: {
        columnCalcMode: 'rigorous_mesh',
        thermoModel: 'ELEC_HCL_AZEO',
        totalStages: 24,
        feedStage: 12,
        topPressKgcm2g: 6.0,
        murphreeEffPct: 75,
        topSpecType: 'reflux_ratio',
        topSpecValue: 2.2,
        splitSpecType: 'd_over_f_mass',
        splitSpecValue: 0.28,
      },
    },
    inletFeed: {
      label: 'C-310 탑저 농축염산 22% (S3-04)',
      tempC: 68.0,
      pressKgcm2g: 7.5,
      flowsKgH: { HCl: 1500.0, H2O: 5300.0 },
    },
  },
  {
    id: 'tpl_c101_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'C-101',
    name: 'ECH 경질분·수분 공비탈수탑 (디캔터)',
    unitType: 'distillation',
    summary: 'NRTL · 진공 -0.65 kG · 20단 · R=2.2 · D/F=0.068',
    params: {
      calcMode: 'rigorous',
      distillConfig: {
        columnCalcMode: 'rigorous_mesh',
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
    inletFeed: {
      label: '조 ECH 유기층 원료 (ECH/DCP/DCH/H₂O)',
      tempC: 55.0,
      pressKgcm2g: 0.2,
      flowsKgH: { ECH: 8820, DCP: 165, DCH: 380, H2O: 140 },
    },
  },
  {
    id: 'tpl_c102_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'C-102',
    name: 'ECH 제품 진공 정제탑 (99.9% ECH)',
    unitType: 'distillation',
    summary: 'NRTL · 진공 -0.92 kG · 26단 · R=2.4 · D/F=0.955',
    params: {
      calcMode: 'rigorous',
      distillConfig: {
        columnCalcMode: 'rigorous_mesh',
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
    inletFeed: {
      label: 'C-101 탑저 탈경질 ECH (ECH/DCH)',
      tempC: 74.0,
      pressKgcm2g: -0.57,
      flowsKgH: { ECH: 8685, DCH: 380 },
    },
  },

  // ── 2. 흡수·제해·건조탑 (absorber) ─────────────────────────────
  {
    id: 'tpl_c110_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'C-110',
    name: '흑연 강하막 염산 흡수탑 (35% HCl)',
    unitType: 'absorber',
    summary: 'HCl 99.8% 흡수 · 출구 45°C · ΔP 0.08 kG',
    params: {
      calcMode: 'rigorous',
      targetComponent: 'HCl',
      removalEfficiency: 99.8,
      operTempC: 45,
      columnDeltaPKgcm2: 0.08,
    },
    inletFeed: {
      label: '합성 HCl 가스 유입 (SP-105A)',
      tempC: 45.0,
      pressKgcm2g: 0.25,
      flowsKgH: { HCl: 4200, H2O: 120, H2: 4.0, O2: 2.0 },
    },
  },
  {
    id: 'tpl_t130_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'T-130',
    name: '테일가스 알칼리 제해탑 (20% NaOH)',
    unitType: 'absorber',
    summary: 'HCl 99.95% 제거 · 출구 35°C · 상압',
    params: {
      calcMode: 'rigorous',
      targetComponent: 'HCl',
      removalEfficiency: 99.95,
      operTempC: 35,
      columnDeltaPKgcm2: 0.03,
    },
    inletFeed: {
      label: 'C-110 테일가스 유입 (S1-08)',
      tempC: 42.0,
      pressKgcm2g: 0.1,
      flowsKgH: { HCl: 45, H2O: 30, H2: 4.0, N2: 250 },
    },
  },
  {
    id: 'tpl_t210_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'T-210',
    name: '98% 황산 초정밀 제습탑 (<1 ppm H₂O)',
    unitType: 'absorber',
    summary: 'H₂O 99.99% 제거 · 출구 25°C · 2.5 kG',
    params: {
      calcMode: 'rigorous',
      targetComponent: 'H2O',
      removalEfficiency: 99.99,
      operTempC: 25,
      columnDeltaPKgcm2: 0.1,
    },
    inletFeed: {
      label: '조 HCl 가스 유입 (S2-01)',
      tempC: 48.0,
      pressKgcm2g: 3.1,
      flowsKgH: { HCl: 1978.0, H2O: 9.8, H2: 1.85, O2: 1.68 },
    },
  },
  {
    id: 'tpl_t410_elec',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'T-410',
    name: 'Cl₂ 1차 수세·직접냉각탑',
    unitType: 'absorber',
    summary: 'H₂O 65% 응축 · 출구 55°C · ΔP 0.05 kG',
    params: {
      calcMode: 'rigorous',
      targetComponent: 'H2O',
      removalEfficiency: 65,
      operTempC: 55,
      columnDeltaPKgcm2: 0.05,
    },
  },
  {
    id: 'tpl_t430_elec',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'T-430',
    name: 'Cl₂ 황산 건조탑 (98% H₂SO₄)',
    unitType: 'absorber',
    summary: 'H₂O 99.9% 제습 · 출구 21°C · ΔP 0.08 kG',
    params: {
      calcMode: 'rigorous',
      targetComponent: 'H2O',
      removalEfficiency: 99.9,
      operTempC: 21,
      columnDeltaPKgcm2: 0.08,
    },
  },
  {
    id: 'tpl_t280_elec',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'T-280',
    name: '감압 탈염소탑 (Vacuum Dechlorinator)',
    unitType: 'absorber',
    summary: 'Cl₂ 98.5% 탈기 · 출구 78°C · ΔP 0.10 kG',
    params: {
      calcMode: 'rigorous',
      targetComponent: 'Cl2',
      removalEfficiency: 98.5,
      operTempC: 78,
      columnDeltaPKgcm2: 0.1,
    },
  },

  // ── 3. 열교환기 / 냉각기 / 응축기 (hex) ─────────────────────────
  {
    id: 'tpl_e413_elec',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'E-413',
    name: 'Cl₂ 1차 냉각기 (냉각수 CW)',
    unitType: 'hex',
    summary: 'cw · 목표 35°C · 0.2 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 35,
      operPressKgcm2g: 0.2,
      refrigerantPreset: 'cw',
    },
    inletFeed: {
      label: 'T-410 습윤 Cl₂ 가스 유입 (401)',
      tempC: 55.0,
      pressKgcm2g: 0.3,
      flowsKgH: { Cl2: 19800, H2O: 820, O2: 120, N2: 40 },
    },
  },
  {
    id: 'tpl_e423_elec',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'E-423',
    name: 'Cl₂ 2차 냉수 칠러 (CHW 7°C)',
    unitType: 'hex',
    summary: 'chw · 목표 14°C · 0.15 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 14,
      operPressKgcm2g: 0.15,
      refrigerantPreset: 'chw',
    },
    inletFeed: {
      label: 'E-413 냉각 Cl₂ 가스 (403)',
      tempC: 35.0,
      pressKgcm2g: 0.2,
      flowsKgH: { Cl2: 19800, H2O: 310, O2: 120, N2: 40 },
    },
  },
  {
    id: 'tpl_d484_elec',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'D-484',
    name: 'Cl₂ 프레온 냉동 액화기 (-35°C)',
    unitType: 'liquefier',
    summary: 'freon_m35 · 목표 -28°C · 상변화 VLE',
    params: {
      calcMode: 'rigorous',
      operTempC: -28,
      operPressKgcm2g: 2.0,
      refrigerantPreset: 'freon_m35',
    },
    inletFeed: {
      label: '건조 압축 Cl₂ 가스 (415)',
      tempC: 25.0,
      pressKgcm2g: 2.2,
      flowsKgH: { Cl2: 19800, O2: 120, N2: 40 },
    },
  },
  {
    id: 'tpl_e102_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'E-102',
    name: 'HCl 합성로 급냉 가스 냉각기',
    unitType: 'hex',
    summary: 'cw · 280°C → 65°C 급냉 · 0.25 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 65,
      operPressKgcm2g: 0.25,
      refrigerantPreset: 'cw',
    },
    inletFeed: {
      label: 'R-101 합성 HCl 고온 가스 (S1-02)',
      tempC: 280.0,
      pressKgcm2g: 0.35,
      flowsKgH: { HCl: 4200, H2: 4.0, O2: 2.0 },
    },
  },
  {
    id: 'tpl_e225_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'E-225',
    name: '무수염산 저온 응축기 (브라인 -20°C)',
    unitType: 'hex',
    summary: 'brine_m20 · 목표 -22°C · 17.6 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: -22,
      operPressKgcm2g: 17.6,
      refrigerantPreset: 'brine_m20',
    },
    inletFeed: {
      label: 'C-220 고압 건조 HCl 가스 (S2-04)',
      tempC: 35.0,
      pressKgcm2g: 17.8,
      flowsKgH: { HCl: 1978.0, H2: 1.85, O2: 1.68 },
    },
  },
  {
    id: 'tpl_hx_h2',
    plantLabel: '수전해 참고 모델',
    tag: 'HX-H2',
    name: '수소 가스 쿨러 (CHW)',
    unitType: 'hex',
    summary: 'chw · 목표 25°C · 1.0 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 25,
      operPressKgcm2g: 1.0,
      refrigerantPreset: 'chw',
    },
    inletFeed: {
      label: '수전해 발생 습윤 H₂ 가스',
      tempC: 70.0,
      pressKgcm2g: 1.1,
      flowsKgH: { H2: 45.0, H2O: 12.0 },
    },
  },
  {
    id: 'tpl_e102_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'E-102',
    name: '글리세린 염소화 반응물 냉각기 (112→55°C)',
    unitType: 'hex',
    summary: 'cw · 목표 55°C · 1.8 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 55,
      operPressKgcm2g: 1.8,
      refrigerantPreset: 'cw',
    },
    inletFeed: {
      label: 'R-101 염소화 조 DCH 반응액',
      tempC: 112.0,
      pressKgcm2g: 2.2,
      flowsKgH: { DCH: 12383, Glycerol: 227, H2O: 3504, HCl: 403 },
    },
  },
  {
    id: 'tpl_e301_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'E-301',
    name: '정제 ECH 제품 냉각기 (62→35°C)',
    unitType: 'hex',
    summary: 'cw · 목표 35°C · 0.3 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 35,
      operPressKgcm2g: 0.3,
      refrigerantPreset: 'cw',
    },
    inletFeed: {
      label: 'C-102 탑정 99.9% ECH 정제 제품',
      tempC: 62.0,
      pressKgcm2g: -0.92,
      flowsKgH: { ECH: 8640, DCP: 8 },
    },
  },

  // ── 4. 펌프 (pump) ──────────────────────────────────────────────
  {
    id: 'tpl_p084_elec',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'P-084A/B',
    name: '전해조 포화염수 공급펌프',
    unitType: 'pump',
    summary: '출구 3.5 kG · 효율 75%',
    params: {
      outletPressKgcm2g: 3.5,
      efficiency: 75,
    },
    inletFeed: {
      label: '포화 정제염수 유입 (25.5 wt% NaCl)',
      tempC: 65.0,
      pressKgcm2g: 0.2,
      flowsKgH: { NaCl: 3060, H2O: 8940 },
    },
  },
  {
    id: 'tpl_p115_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'P-115',
    name: '35% 전자급 염산 제품 이송펌프',
    unitType: 'pump',
    summary: '출구 4.2 kG · 효율 72%',
    params: {
      outletPressKgcm2g: 4.2,
      efficiency: 72,
    },
    inletFeed: {
      label: 'T-130 탑저 35% 고순도 염산',
      tempC: 35.0,
      pressKgcm2g: 0.1,
      flowsKgH: { HCl: 2450, H2O: 4550 },
    },
  },
  {
    id: 'tpl_p315_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'P-315',
    name: '폐염산 가압 공비탑 이송펌프',
    unitType: 'pump',
    summary: '출구 7.5 kG · 효율 70%',
    params: {
      outletPressKgcm2g: 7.5,
      efficiency: 70,
    },
    inletFeed: {
      label: '31% 폐염산 (공비회수 유입)',
      tempC: 30.0,
      pressKgcm2g: 0.1,
      flowsKgH: { HCl: 1240, H2O: 2760 },
    },
  },
  {
    id: 'tpl_p101_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'P-101',
    name: 'DCH 반응액 200 Sec 이송 펌프',
    unitType: 'pump',
    summary: '출구 3.2 kG · 효율 72%',
    params: {
      outletPressKgcm2g: 3.2,
      efficiency: 0.72,
    },
    inletFeed: {
      label: 'E-102 냉각 조 DCH 반응액 (55°C)',
      tempC: 55.0,
      pressKgcm2g: 1.8,
      flowsKgH: { DCH: 12383, Glycerol: 227, H2O: 3504 },
    },
  },
  {
    id: 'tpl_p301_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'P-301',
    name: '고순도 99.9% ECH 제품 이송 펌프',
    unitType: 'pump',
    summary: '출구 4.5 kG · 효율 74%',
    params: {
      outletPressKgcm2g: 4.5,
      efficiency: 0.74,
    },
    inletFeed: {
      label: 'C-102 탑정 99.9% ECH 정제 제품',
      tempC: 35.0,
      pressKgcm2g: -0.92,
      flowsKgH: { ECH: 8640 },
    },
  },

  // ── 5. 압축기 / 블로워 (compressor) ─────────────────────────────
  {
    id: 'tpl_k471_elec',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'K-471',
    name: '건조 Cl₂ 가스 액화 압축기',
    unitType: 'compressor',
    summary: '출구 7.5 kG · 효율 78%',
    params: {
      calcMode: 'rigorous',
      outletPressKgcm2g: 7.5,
      efficiency: 78,
    },
    inletFeed: {
      label: '건조 Cl₂ 가스 (황산건조탑 출구)',
      tempC: 25.0,
      pressKgcm2g: 0.1,
      flowsKgH: { Cl2: 19800, O2: 120, N2: 40 },
    },
  },
  {
    id: 'tpl_comp_h2',
    plantLabel: '수전해 참고 모델',
    tag: 'COMP-H2',
    name: '고순도 수소 다단 압축기',
    unitType: 'compressor',
    summary: '출구 30.0 kG · 효율 75%',
    params: {
      calcMode: 'rigorous',
      outletPressKgcm2g: 30.0,
      efficiency: 75,
    },
    inletFeed: {
      label: '정제 건조 H₂ 가스 (99.99%)',
      tempC: 25.0,
      pressKgcm2g: 0.8,
      flowsKgH: { H2: 45.0, H2O: 0.05 },
    },
  },

  // ── 6. 반응기 (reactor) ─────────────────────────────────────────
  {
    id: 'tpl_r101_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'R-101',
    name: 'HCl 합성로 (Cl₂ + H₂ → 2HCl)',
    unitType: 'reactor',
    summary: '전환율 99.9% · 출구 280°C · 0.35 kG',
    params: {
      calcMode: 'rigorous',
      reactionPreset: 'hcl_burner',
      conversion: 99.9,
      operTempC: 280,
      operPressKgcm2g: 0.35,
    },
    inletFeed: {
      label: '원료 Cl₂ + 과잉 H₂ 혼합가스 (S1-01)',
      tempC: 35.0,
      pressKgcm2g: 0.6,
      flowsKgH: { Cl2: 4085, H2: 120 },
    },
  },
  {
    id: 'tpl_r101_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'R-101',
    name: '글리세린 염소화 반응기 (DCH 합성)',
    unitType: 'reactor',
    summary: '전환율 97.5% · 112°C · 2.2 kG',
    params: {
      calcMode: 'rigorous',
      reactionPreset: 'gte_hydrochlorination',
      conversion: 97.5,
      operTempC: 112,
      operPressKgcm2g: 2.2,
    },
    inletFeed: {
      label: '정제 글리세린 + 무수 HCl 반응물',
      tempC: 41.0,
      pressKgcm2g: 2.5,
      flowsKgH: { Glycerol: 9070, HCl: 7402, H2O: 45 },
    },
  },
  {
    id: 'tpl_r201_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'R-201',
    name: 'DCH 비누화 고리화 반응기 (ECH 합성)',
    unitType: 'reactor',
    summary: '전환율 98.5% · 68°C · 0.4 kG',
    params: {
      calcMode: 'rigorous',
      reactionPreset: 'ech_saponification',
      conversion: 98.5,
      operTempC: 68,
      operPressKgcm2g: 0.4,
    },
    inletFeed: {
      label: '조 DCH 반응액 + 25 wt% NaOH 수용액',
      tempC: 48.0,
      pressKgcm2g: 1.8,
      flowsKgH: { DCH: 12383, Glycerol: 227, NaOH: 4032, H2O: 15600 },
    },
  },

  // ── 7. 전해조 (electrolyzer) ────────────────────────────────────
  {
    id: 'tpl_elec_100',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'ELEC-100',
    name: '이온교환막 식염전해조 (32% NaOH)',
    unitType: 'electrolyzer',
    summary: '30 kA · 24 셀 · 전류효율 96.5% · 88°C',
    params: {
      calcMode: 'rigorous',
      currentKA: 30.0,
      cellCount: 24,
      currentEffPct: 96.5,
      operTempC: 88,
    },
    inletFeed: {
      label: '초정제 포화염수 (25.5 wt% NaCl)',
      tempC: 65.0,
      pressKgcm2g: 1.5,
      flowsKgH: { NaCl: 3060, H2O: 8940 },
    },
  },
  {
    id: 'tpl_pem_h2',
    plantLabel: '수전해 참고 모델',
    tag: 'WE-101',
    name: 'PEM 수전해 스택 (그린수소)',
    unitType: 'electrolyzer',
    summary: '25 kA · 180 셀 · 전류효율 98% · 70°C',
    params: {
      calcMode: 'rigorous',
      currentKA: 25.0,
      cellCount: 180,
      currentEffPct: 98.0,
      operTempC: 70,
    },
    inletFeed: {
      label: '초순수(UPW) 공급수',
      tempC: 60.0,
      pressKgcm2g: 2.0,
      flowsKgH: { H2O: 2500 },
    },
  },

  // ── 8. 증발관 (evaporator) ──────────────────────────────────────
  {
    id: 'tpl_evap_300',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'EVAP-300',
    name: '가성소다 3중효용 강하막 농축관 (32→50%)',
    unitType: 'evaporator',
    summary: '목표 50 wt% NaOH · 115°C',
    params: {
      evapTargetConcWt: 50,
      operTempC: 115,
    },
    inletFeed: {
      label: '전해조 32 wt% 가성소다 액',
      tempC: 88.0,
      pressKgcm2g: 1.0,
      flowsKgH: { NaOH: 3200, H2O: 6800 },
    },
  },

  // ── 9. 기액 분리기 (separator) ──────────────────────────────────
  {
    id: 'tpl_flash_cl2',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'V-485',
    name: '액화염소 기액 분리기',
    unitType: 'separator',
    summary: '등온 -28°C · 2.0 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: -28,
      operPressKgcm2g: 2.0,
    },
    inletFeed: {
      label: '냉각 액화 Cl₂ 2상 혼합물',
      tempC: -28.0,
      pressKgcm2g: 2.1,
      flowsKgH: { Cl2: 19800, O2: 120, N2: 40 },
    },
  },
  {
    id: 'tpl_flash_hcl',
    plantLabel: 'PLANT 02 1A 염산·회수',
    tag: 'SP-105',
    name: '합성 HCl 급냉 기액 분리기',
    unitType: 'separator',
    summary: '등온 45°C · 0.25 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 45,
      operPressKgcm2g: 0.25,
    },
    inletFeed: {
      label: 'E-102 냉각 합성 HCl 가스',
      tempC: 65.0,
      pressKgcm2g: 0.25,
      flowsKgH: { HCl: 4200, H2: 4.0, O2: 2.0, H2O: 15.0 },
    },
  },
  {
    id: 'tpl_v102_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'V-102',
    name: '염소화 반응 배가스 기액 분리기',
    unitType: 'separator',
    summary: '등온 55°C · 1.8 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 55,
      operPressKgcm2g: 1.8,
    },
    inletFeed: {
      label: 'E-102 냉각 조 DCH 반응액 + 미반응 HCl',
      tempC: 55.0,
      pressKgcm2g: 1.8,
      flowsKgH: { DCH: 12383, Glycerol: 227, H2O: 3504, HCl: 403 },
    },
  },
  {
    id: 'tpl_v202_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'V-202',
    name: 'ECH/염수 유수분리기 (Decanter)',
    unitType: 'separator',
    summary: '등온 55°C · 0.2 kG',
    params: {
      calcMode: 'rigorous',
      operTempC: 55,
      operPressKgcm2g: 0.2,
    },
    inletFeed: {
      label: 'R-201 비누화 반응 유출액 (ECH/폐염수)',
      tempC: 68.0,
      pressKgcm2g: 0.4,
      flowsKgH: { ECH: 8820, DCP: 165, DCH: 380, NaCl: 6150, H2O: 16720 },
    },
  },

  // ── 10. 원료 공급 (feed) ────────────────────────────────────────
  {
    id: 'tpl_feed_brine',
    plantLabel: 'PLANT 01 전해 시뮬레이터',
    tag: 'FEED-BRINE',
    name: '포화 정제염수 (25.5 wt% NaCl)',
    unitType: 'feed',
    summary: '65°C · 1.5 kG · 12,000 kg/h',
    params: {
      feedTempC: 65,
      feedPressKgcm2g: 1.5,
      feedFlowsKgH: emptySimFlows({ NaCl: 3060, H2O: 8940 }),
    },
  },
  {
    id: 'tpl_feed_gly_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'FEED-GLY',
    name: '정제 글리세린 원료 (Glycerol)',
    unitType: 'feed',
    summary: '45°C · 2.0 kG · 9,115 kg/h',
    params: {
      feedTempC: 45,
      feedPressKgcm2g: 2.0,
      feedFlowsKgH: emptySimFlows({ Glycerol: 9070, H2O: 45 }),
    },
  },
  {
    id: 'tpl_feed_ahcl_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'FEED-AHCL',
    name: '무수염산(AHCl) 반응 가스 원료',
    unitType: 'feed',
    summary: '35°C · 3.5 kG · 7,402 kg/h',
    params: {
      feedTempC: 35,
      feedPressKgcm2g: 3.5,
      feedFlowsKgH: emptySimFlows({ HCl: 7402 }),
    },
  },
  {
    id: 'tpl_feed_naoh_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'FEED-NAOH',
    name: '25 wt% 가성소다(NaOH) 비누화 수용액',
    unitType: 'feed',
    summary: '40°C · 2.5 kG · 17,200 kg/h',
    params: {
      feedTempC: 40,
      feedPressKgcm2g: 2.5,
      feedFlowsKgH: emptySimFlows({ NaOH: 4300, H2O: 12900 }),
    },
  },
  {
    id: 'tpl_feed_ech',
    plantLabel: 'PLANT 03 바이오 ECH',
    tag: 'FEED-CRUDE-ECH',
    name: '조 ECH 유기층 원료 (ECH/DCP/DCH/H₂O)',
    unitType: 'feed',
    summary: '55°C · 0.2 kG · 9,505 kg/h',
    params: {
      feedTempC: 55,
      feedPressKgcm2g: 0.2,
      feedFlowsKgH: emptySimFlows({ ECH: 8820, DCP: 165, DCH: 380, H2O: 140 }),
    },
  },
];

export function getPlantTemplatesForUnitType(unitType: FlowUnitType): PlantUnitTemplate[] {
  return PLANT_UNIT_TEMPLATES.filter((t) => {
    if (t.unitType === unitType) return true;
    if (unitType === 'cooler' && t.unitType === 'hex') return true;
    return false;
  });
}

export function cloneUnitParams(params: FlowNodeDef['params']): FlowNodeDef['params'] {
  return JSON.parse(JSON.stringify(params));
}

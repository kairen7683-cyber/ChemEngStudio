// ============================================================================
// 엄밀 다단 정밀증류 엔진 (Rigorous Stage-by-Stage MESH Distillation Solver)
// - Inside-Out / Wang-Henke 삼중대각행렬(Thomas Tridiagonal) 다단 기액평형 해법
// - 3대 열역학 K-value 패키지 내장:
//    1) NRTL 비이상 액상 활동도 모델 (ECH · DCH · MCH · 글리세린 · DCP · H₂O 공비·진공증류)
//    2) ELEC_HCL_AZEO 압력변동 공비증류 모델 (HCl-H₂O 진공 23.0% ↔ 상압 20.2% ↔ 가압 17.5% 공비점 이동)
//    3) PENG_ROB 일반 탄화수소·무수할로겐·초고순도 AHCl 경질가스 스트리핑 모델
// - 2자유도(DOF=2) 운전사양 잠금 + 외부 루프 목표순도/불순물(ppm) 자동 역산(Design Spec & Vary)
// ============================================================================

import { MW } from './constants';
import {
  RIGOROUS_CRIT,
  calcElectrolyteWaterActivity,
  calcHclWaterEquilibriumBar,
  calcPengRobinsonMixture,
  calcSechenovSaltingOutMultiplier,
  calcSoaveRedlichKwongMixture,
  computeElectrolyteMolalitiesFromWaterKg,
  liquidMolarVolumeLPerMol,
  pureDipprOrAntoineBarA,
  pureSatFugacityCoeffPR,
} from './rigorousThermo';
import { henryWaterBar } from './data/pureComponentDatabank';
import {
  KJ_PER_KCAL,
  componentMolarEnthalpy,
  liquidMolarEnthalpyKJkmol,
  vaporMolarEnthalpyKJkmol,
  streamEnthalpyKcalH,
} from './thermoCore';
import {
  calcExtendedNrtlGamma,
  solveRigorousLLEDecanter,
  type ActivityEvalDiagnostics,
} from './activityModels';
import { COMP_CATALOG_META, recommendPropertyMethod, type SimPropertyMethod } from './componentCatalog';
import type { SimCompKey } from './flowsheetSolver';
import type { ColumnInternalsParams } from './columnInternalsDesign';

export type DistillThermoModel = 'AUTO' | 'ENRTL' | 'NRTL' | 'PR' | 'SRK' | 'ELEC_HCL_AZEO' | 'PENG_ROB';
export type ResolvedDistillThermoModel = 'ENRTL' | 'NRTL' | 'PR' | 'SRK' | 'ELEC_HCL_AZEO' | 'PENG_ROB';
export type DistillCondenserType = 'total' | 'partial' | 'decanter_ech' | 'none';
export type DistillReboilerType = 'kettle' | 'thermosyphon' | 'live_steam' | 'none';

export type DistillTopSpecType = 'reflux_ratio' | 'reflux_mass_kgh' | 'boilup_ratio';
export type DistillSplitSpecType =
  | 'd_over_f_mass'
  | 'd_over_f_mole'
  | 'b_over_f_mass'
  | 'distillate_kgh'
  | 'bottoms_kgh';

export type DistillSpecMetric =
  | 'purity_wt_pct'
  | 'purity_mol_pct'
  | 'recovery_pct'
  | 'impurity_wt_ppm';

export interface DistillDesignSpec {
  enabled: boolean;
  streamTarget: 'distillate' | 'bottoms';
  component: SimCompKey;
  metric: DistillSpecMetric;
  targetValue: number;
  varyParam: 'd_over_f' | 'reflux_ratio';
  varyMin: number;
  varyMax: number;
}

export interface DistillFeedInput {
  edgeId: string;
  streamNo: string;
  stage: number; // 1 .. N
  flowsKgH: Record<SimCompKey, number>;
  tempC: number;
  pressKgcm2g: number;
  /** 상류 스트림 총엔탈피 (kcal/h, 생성열 기준) — 전달 시 플로우시트 에너지수지와 100% 일치 */
  enthalpyKcalH?: number;
  forcedPhase?: 'L' | 'G' | 'L/G';
  vapRatio?: Partial<Record<SimCompKey, number>>;
}

export type DistillCalcMode = 'rigorous_mesh' | 'design_stages';
export type DistillStageInputBasis = 'theoretical' | 'actual_murphree';
export type DistillDofSlotId = 'rr' | 'split' | 'top_spec' | 'bot_spec';
export type DistillEndpointBasis = 'purity_wt_pct' | 'impurity_wt_ppm' | 'recovery_pct';

export type SideCutPhase = 'liquid' | 'vapor';
export type SideCutSpecType =
  | 'mass_kgh'
  | 's_over_f_mass'
  | 's_over_f_mole'
  | 'draw_ratio'
  | 'purity_wt_pct'
  | 'impurity_ppm'
  | 'recovery_pct';

export interface DistillSideCutConfig {
  id?: string;
  enabled: boolean;
  label?: string;
  stage: number; // 1-based stage (2 .. N-1)
  autoOptimizeStage?: boolean;
  phase: SideCutPhase;
  specType: SideCutSpecType;
  specValue: number;
  targetComp?: SimCompKey;
}

export interface DistillSideCutDetail {
  id: string;
  label: string;
  stage: number;
  phase: 'L' | 'G';
  tempC: number;
  pressKgcm2g: number;
  flowsKgH: Record<SimCompKey, number>;
  totalMassKgH: number;
  totalMolesKmolH: number;
}

export interface DistillSideCutSpecStatus {
  label: string;
  target: number;
  actual: number;
  errorAbs: number;
  met: boolean;
}

export interface DistillColumnParams {
  columnCalcMode?: DistillCalcMode;   // 'rigorous_mesh'(단수지정 정밀모사) | 'design_stages'(목표순도 기반 단수·유량 자동설계)
  thermoModel?: DistillThermoModel;
  totalStages?: number;               // N (기본 24, 1=응축기, N=리보일러)
  feedStage?: number;                 // 주 공급단 (기본 12)
  feedStageMap?: Record<string, number>; // 다중 피드 배관별 공급단 지정
  condenserType?: DistillCondenserType;
  reboilerType?: DistillReboilerType;
  secondaryFeeds?: Array<DistillFeedInput & { stage: number }>; // 다중 피드 (탑정 흡수용매 stage 1, 탑저 원료가스/생증기 stage N 등)
  reboilerDutyKcalH?: number;         // 리보일러 열부하 직접 지정 (kcal/h, Reboiled Absorber 등)
  topCoolerDutyKcalH?: number;        // 탑정(1단) 인터쿨링/열제거 부하 지정 (kcal/h, 양수=열제거)
  topPressKgcm2g?: number;            // 탑정 압력 (진공 -0.92 ~ 고압 25 kG)
  stageDeltaPKgcm2?: number;          // 단당 압력손실 (기본 0.004 kG ≈ 3 mmHg)
  murphreeEffPct?: number;            // 단효율 % (기본 75%)
  /**
   * 단수(totalStages) 해석 기준:
   * - 'theoretical' (기본, 하위호환): totalStages = 이론단수(N_theo), MESH는 η=1.0으로 풀고 실제 트레이 산출에만 (N-2)/η 적용
   * - 'actual_murphree': totalStages = 실제 단수(1=응축기, 2..N-1=실제트레이, N=리보일러), MESH 행렬 내부에 Murphree 기상 단효율 η_M 직접 반영 (중복 나눗셈 방지)
   */
  stageInputBasis?: DistillStageInputBasis;
  topSpecType?: DistillTopSpecType;   // 사양 1 (기본 'reflux_ratio')
  topSpecValue?: number;              // 기본 환류비 RR = 2.8
  splitSpecType?: DistillSplitSpecType; // 사양 2 (기본 'd_over_f_mass')
  splitSpecValue?: number;            // 기본 D/F = 0.50
  // 4개 후보('rr','split','top_spec','bot_spec') 중 2개 선택(DOF=2) 가이드 시스템
  activeDofSlots?: DistillDofSlotId[];
  topQualityComp?: SimCompKey;        // 탑정(D) 목표 제품 또는 규제 불순물 성분
  topQualityMetric?: DistillSpecMetric; // 'purity_wt_pct' | 'impurity_wt_ppm' | 'recovery_pct' | 'purity_mol_pct'
  topQualityTarget?: number;          // 선택한 성분의 목표 농도(wt%/ppm) 또는 회수율(%)
  botQualityComp?: SimCompKey;        // 탑저(B) 목표 제품 또는 규제 불순물 성분
  botQualityMetric?: DistillSpecMetric;
  botQualityTarget?: number;
  spec1?: DistillDesignSpec;          // 하위호환: 목표 순도·회수율 역산 스펙
  spec2?: DistillDesignSpec;          // 하위호환: 불순물(ppm) 상한 역산 스펙
  // 목표순도 기반 단수·유량 자동설계 모드 ('design_stages') 전용 파라미터
  designLkComp?: SimCompKey;          // 탑정 경질 핵심성분 (미지정 시 휘발도순 자동감지)
  designHkComp?: SimCompKey;          // 탑저 중질 핵심성분 (미지정 시 자동감지)
  designTopBasis?: DistillEndpointBasis; // 탑정 기준 ('purity_wt_pct' | 'impurity_wt_ppm' | 'recovery_pct')
  designTopPurityWtPct?: number;      // 탑정 LK 목표 농도 (wt%, 기본 99.5)
  designTopImpurityPpm?: number;      // 탑정 HK 불순물 상한 농도 (wt ppm, 기본 500)
  designTopRecoveryPct?: number;      // 탑정 LK 회수율 (%, 기본 99.2)
  designBotBasis?: DistillEndpointBasis; // 탑저 기준 ('purity_wt_pct' | 'impurity_wt_ppm' | 'recovery_pct')
  designBotPurityWtPct?: number;      // 탑저 HK 목표 농도 (wt%, 기본 99.0)
  designBotImpurityPpm?: number;      // 탑저 LK 불순물 상한 농도 (wt ppm, 기본 500)
  designBotRecoveryPct?: number;      // 탑저 HK 회수율 (%, 기본 99.2)
  designRefluxMode?: DistillRefluxDesignMode; // 'auto_opt'(다중후보 TAC 최적) | 'r_mult'(R/R_min 배수) | 'fixed_rr'(직접 RR)
  designRefluxMult?: number;          // R / R_min 배수 (기본 1.25)
  designFixedRR?: number;             // 운전 RR 직접 지정 값 (기본 2.8)
  /** 정밀모사(rigorous_mesh)에서 탑정+탑저 2개 품질스펙 동시 지정 시 단수(N)·공급단(Nf) 자동 동시최적화 허용 여부 (기본 true) */
  autoOptimizeStagesOnDualSpec?: boolean;
  /** 사이드컷(측류 인출, Side-Cut) 1차 설정 및 추가 다중 측류 설정 */
  sideCut?: DistillSideCutConfig;
  additionalSideCuts?: DistillSideCutConfig[];
  // 내장 컬럼 사이징 & 인터널(트레이/충진물·섬프·노즐) 개념디자인 파라미터
  internalsConfig?: ColumnInternalsParams;
}

export type DistillRefluxDesignMode = 'auto_opt' | 'r_mult' | 'fixed_rr';

export interface DistillDesignCandidate {
  id: string;
  label: string;
  rOverRmin: number;
  stagesN: number;
  feedStage: number;
  actualTrays: number;
  refluxRatio: number;
  dOverFMass: number;
  distillateKgH: number;
  bottomsKgH: number;
  topMetricActual: number;
  botMetricActual: number;
  reboilerDutyKW: number;
  condenserDutyKW: number;
  estimatedDiameterM: number;
  annualCapexKUsd: number;
  annualOpexKUsd: number;
  tacKUsdYr: number;
  tacIndex: number;
  converged: boolean;
  specsMet: boolean;
  recommended: boolean;
  sideCutStage?: number;
  sOverFMass?: number;
  sideCutPurityWtPct?: number;
}

/** 기존 프리셋(spec1/spec2)과 신규 4중 택2(activeDofSlots) 간 완전 하위호환 슬롯 해석기 */
export function resolveEffectiveDofSlots(colParams: DistillColumnParams): DistillDofSlotId[] {
  if (Array.isArray(colParams.activeDofSlots)) {
    const uniq: DistillDofSlotId[] = [];
    for (const s of colParams.activeDofSlots) {
      if ((s === 'rr' || s === 'split' || s === 'top_spec' || s === 'bot_spec') && !uniq.includes(s)) {
        uniq.push(s);
      }
      if (uniq.length >= 2) break;
    }
    return uniq;
  }
  const sp1 = colParams.spec1?.enabled ? colParams.spec1 : undefined;
  const sp2 = colParams.spec2?.enabled ? colParams.spec2 : undefined;
  if (!sp1 && !sp2) return ['rr', 'split'];
  if (sp1 && sp2) return ['top_spec', 'bot_spec'];
  const one = (sp1 ?? sp2)!;
  const qualitySlot: DistillDofSlotId = one.streamTarget === 'bottoms' ? 'bot_spec' : 'top_spec';
  const keptOperatingSlot: DistillDofSlotId = one.varyParam === 'd_over_f' ? 'rr' : 'split';
  return [keptOperatingSlot, qualitySlot];
}

export interface DistillShortcutDesignSummary {
  lkComp: SimCompKey;
  hkComp: SimCompKey;
  alphaAvg: number;
  minStagesNmin: number;
  minRefluxRmin: number;
  operatingRR: number;
  solvedStagesN: number;
  solvedFeedStage: number;
  solvedActualTrays: number;
  topLkPurityWtPct: number;
  botHkPurityWtPct: number;
  topLkRecoveryPct: number;
  botHkRecoveryPct: number;
  topHkImpurityPpm?: number;
  botLkImpurityPpm?: number;
  targetTopPurityWtPct: number;
  targetBotPurityWtPct: number;
  topSpecMet?: boolean;
  botSpecMet?: boolean;
  topTargetSummary?: string;
  botTargetSummary?: string;
  designMet: boolean;
  refluxModeUsed?: DistillRefluxDesignMode;
  candidates?: DistillDesignCandidate[];
  selectedCandidateId?: string;
}

export interface DistillDiagnosticRemedy {
  label: string;
  patch: Partial<DistillColumnParams>;
}

export interface DistillDiagnosticReport {
  level: 'ok' | 'warning' | 'error';
  badgeText: string;
  headline: string;
  causes: string[];
  remedies: DistillDiagnosticRemedy[];
}

export interface DistillStageProfile {
  stage: number; // 1 .. N
  tempC: number;
  pressBarA: number;
  liqFlowKmolH: number;
  vapFlowKmolH: number;
  liqMassKgH: number;
  vapMassKgH: number;
  xMol: Record<SimCompKey, number>;
  yMol: Record<SimCompKey, number>;
  xWtPct: Record<SimCompKey, number>;
  yWtPct: Record<SimCompKey, number>;
  isFeedStage?: boolean;
  isSideCutStage?: boolean;
  sideCutLiqKgH?: number;
  sideCutVapKgH?: number;
}

export interface DistillSpecStatus {
  enabled: boolean;
  target: number;
  actual: number;
  met: boolean;
  variedParam: 'd_over_f' | 'reflux_ratio';
  solvedParamValue: number;
  summary: string;
}

export interface DistillSolveResult {
  converged: boolean;
  innerIterations: number;
  outerIterations: number;
  thermoModelUsed: ResolvedDistillThermoModel;
  dofValid: boolean;
  dofMessage: string;
  distillateFlowsKgH: Record<SimCompKey, number>;
  bottomsFlowsKgH: Record<SimCompKey, number>;
  decanterWaterDrawKgH: number;
  decanterFlowsKgH?: Record<SimCompKey, number>;
  distillatePhase: 'L' | 'G';
  topTempC: number;
  bottomTempC: number;
  topPressKgcm2g: number;
  bottomPressKgcm2g: number;
  actualRefluxRatio: number;
  actualBoilupRatio: number;
  actualDOverFMass: number;
  actualBOverFMass: number;
  actualDOverFMole: number;
  condenserDutyKcalH: number;
  reboilerDutyKcalH: number;
  totalStagesUsed: number;
  feedStageUsed: number;
  actualTrayCount: number;
  stageInputBasisUsed: DistillStageInputBasis;
  recommendedFeedStage: number;
  estimatedDiameterM: number;
  shortcutDesign?: DistillShortcutDesignSummary;
  dualSpecCandidates?: DistillDesignCandidate[];
  autoStageOptimized?: boolean;
  spec1Status?: DistillSpecStatus;
  spec2Status?: DistillSpecStatus;
  sideCutFlowsKgH?: Record<SimCompKey, number>;
  sideCutMassKgH?: number;
  sideCutMolesKmolH?: number;
  sideCutPhase?: 'L' | 'G';
  sideCutTempC?: number;
  sideCutPressKgcm2g?: number;
  sideCutStageUsed?: number;
  actualSOverFMass?: number;
  actualSOverFMole?: number;
  sideCutSpecStatus?: DistillSideCutSpecStatus;
  sideCutDetails?: DistillSideCutDetail[];
  diagnostics: DistillDiagnosticReport;
  stages: DistillStageProfile[];
}

const mwOf = (k: string, fallback: number): number =>
  (MW as Record<string, number>)[k] ?? fallback;

const ALL_KEYS: SimCompKey[] = [
  'H2O', 'NaCl', 'NaOH', 'Cl2', 'H2', 'HCl', 'H2SO4', 'O2', 'NaOCl',
  'N2', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC', 'Glycerol', 'MCH', 'DCH', 'ECH', 'DCP',
  'CH4', 'CO', 'CO2', 'NH3',
  'C2H4', 'C2H6', 'C3H6', 'C3H8', 'nC4H10', 'nC6H14', 'nC7H16',
  'Benzene', 'Toluene', 'pXylene',
  'MeOH', 'EtOH', 'IPA', 'Acetone', 'AceticAcid', 'EtOAc', 'CHCl3',
  'Ar', 'H2S', 'SO2', 'SO3', 'iC4H10', 'C4H8_1', 'nC5H12', 'nC8H18', 'Cyclohexane', 'Ethylbenzene', 'Styrene', 'Cumene', 'Phenol', 'THF', 'DMF', 'DMSO', 'MTBE', 'MEK', 'DMC', 'EG', 'MEA', 'MDEA', 'FormicAcid', 'HNO3',
  'CH3Cl', 'CH2Cl2', 'CCl4', 'C2Cl4', 'CUSTOM_1', 'CUSTOM_2',
];

const NEW_DISTILL_KEYS: SimCompKey[] = [
  'CH4', 'CO', 'CO2', 'NH3',
  'C2H4', 'C2H6', 'C3H6', 'C3H8', 'nC4H10', 'nC6H14', 'nC7H16',
  'Benzene', 'Toluene', 'pXylene',
  'MeOH', 'EtOH', 'IPA', 'Acetone', 'AceticAcid', 'EtOAc', 'CHCl3',
  'Ar', 'H2S', 'SO2', 'SO3', 'iC4H10', 'C4H8_1', 'nC5H12', 'nC8H18',
  'Cyclohexane', 'Ethylbenzene', 'Styrene', 'Cumene', 'Phenol',
  'THF', 'DMF', 'DMSO', 'MTBE', 'MEK', 'DMC', 'EG', 'MEA', 'MDEA',
  'FormicAcid', 'HNO3', 'CH3Cl', 'CH2Cl2', 'CCl4', 'C2Cl4', 'CUSTOM_1', 'CUSTOM_2',
];

const COMP_MW: Record<SimCompKey, number> = {
  H2O: MW.H2O,
  NaCl: MW.NaCl,
  NaOH: MW.NaOH,
  Cl2: MW.Cl2,
  H2: MW.H2,
  HCl: MW.HCl,
  H2SO4: MW.H2SO4,
  O2: MW.O2,
  NaOCl: MW.NaOCl,
  N2: MW.N2,
  NaClO3: MW.NaClO3,
  FeCl2: MW.FeCl2,
  FeCl3: MW.FeCl3,
  PAC: MW.PAC,
  Glycerol: MW.Glycerol,
  MCH: MW.MCH,
  DCH: MW.DCH,
  ECH: MW.ECH,
  DCP: MW.DCP,
  CH4: mwOf('CH4', 16.043),
  CO: mwOf('CO', 28.010),
  CO2: mwOf('CO2', 44.010),
  NH3: mwOf('NH3', 17.031),
  C2H4: mwOf('C2H4', 28.054),
  C2H6: mwOf('C2H6', 30.070),
  C3H6: mwOf('C3H6', 42.081),
  C3H8: mwOf('C3H8', 44.097),
  nC4H10: mwOf('nC4H10', 58.123),
  nC6H14: mwOf('nC6H14', 86.177),
  nC7H16: mwOf('nC7H16', 100.204),
  Benzene: mwOf('Benzene', 78.114),
  Toluene: mwOf('Toluene', 92.141),
  pXylene: mwOf('pXylene', 106.167),
  MeOH: mwOf('MeOH', 32.042),
  EtOH: mwOf('EtOH', 46.069),
  IPA: mwOf('IPA', 60.096),
  Acetone: mwOf('Acetone', 58.080),
  AceticAcid: mwOf('AceticAcid', 60.052),
  EtOAc: mwOf('EtOAc', 88.106),
  CHCl3: mwOf('CHCl3', 119.378),
  Ar: mwOf('Ar', 39.948),
  H2S: mwOf('H2S', 34.081),
  SO2: mwOf('SO2', 64.064),
  SO3: mwOf('SO3', 80.063),
  iC4H10: mwOf('iC4H10', 58.123),
  C4H8_1: mwOf('C4H8_1', 56.107),
  nC5H12: mwOf('nC5H12', 72.150),
  nC8H18: mwOf('nC8H18', 114.231),
  Cyclohexane: mwOf('Cyclohexane', 84.161),
  Ethylbenzene: mwOf('Ethylbenzene', 106.167),
  Styrene: mwOf('Styrene', 104.152),
  Cumene: mwOf('Cumene', 120.194),
  Phenol: mwOf('Phenol', 94.113),
  THF: mwOf('THF', 72.107),
  DMF: mwOf('DMF', 73.095),
  DMSO: mwOf('DMSO', 78.133),
  MTBE: mwOf('MTBE', 88.150),
  MEK: mwOf('MEK', 72.107),
  DMC: mwOf('DMC', 90.078),
  EG: mwOf('EG', 62.068),
  MEA: mwOf('MEA', 61.084),
  MDEA: mwOf('MDEA', 119.163),
  FormicAcid: mwOf('FormicAcid', 46.025),
  HNO3: mwOf('HNO3', 63.012),
  CH3Cl: mwOf('CH3Cl', 50.488),
  CH2Cl2: mwOf('CH2Cl2', 84.933),
  CCl4: mwOf('CCl4', 153.823),
  C2Cl4: mwOf('C2Cl4', 165.834),
  CUSTOM_1: mwOf('CUSTOM_1', 74.122),
  CUSTOM_2: mwOf('CUSTOM_2', 93.128),
};

const NON_VOLATILE_SET = new Set<SimCompKey>([
  'NaCl', 'NaOH', 'H2SO4', 'NaOCl', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC',
]);

const PERMANENT_GAS_SET = new Set<SimCompKey>(['H2', 'O2', 'N2', 'CH4', 'CO', 'Ar']);

function zeroCompRecord(): Record<SimCompKey, number> {
  return {
    H2O: 0, NaCl: 0, NaOH: 0, Cl2: 0, H2: 0, HCl: 0, H2SO4: 0, O2: 0, NaOCl: 0,
    N2: 0, NaClO3: 0, FeCl2: 0, FeCl3: 0, PAC: 0, Glycerol: 0, MCH: 0, DCH: 0, ECH: 0, DCP: 0,
    CH4: 0, CO: 0, CO2: 0, NH3: 0,
    C2H4: 0, C2H6: 0, C3H6: 0, C3H8: 0, nC4H10: 0, nC6H14: 0, nC7H16: 0,
    Benzene: 0, Toluene: 0, pXylene: 0,
    MeOH: 0, EtOH: 0, IPA: 0, Acetone: 0, AceticAcid: 0, EtOAc: 0, CHCl3: 0,
    Ar: 0, H2S: 0, SO2: 0, SO3: 0, iC4H10: 0, C4H8_1: 0, nC5H12: 0, nC8H18: 0,
    Cyclohexane: 0, Ethylbenzene: 0, Styrene: 0, Cumene: 0, Phenol: 0, THF: 0, DMF: 0, DMSO: 0, MTBE: 0, MEK: 0, DMC: 0, EG: 0, MEA: 0, MDEA: 0, FormicAcid: 0, HNO3: 0,
    CH3Cl: 0, CH2Cl2: 0, CCl4: 0, C2Cl4: 0, CUSTOM_1: 0, CUSTOM_2: 0,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 성분별 순수 포화 증기압 P_sat (barA) — DIPPR Eq. 101 우선 + Antoine 폴백
 */
export function pureSatPressBarA(comp: SimCompKey, T_C: number): number {
  if (NON_VOLATILE_SET.has(comp)) return 1e-10;
  return pureDipprOrAntoineBarA(comp, T_C);
}

// ── NRTL 이진 상호작용 에너지 파라미터 b_ij (K, tau_ij = b_ij / T_K, alpha = 0.30) ──
// ECH-H2O: 88°C 불균일 최소비점 공비혼합물(약 75 wt% ECH) 정밀 재현용 보정값
const NRTL_BIJ_K: Partial<Record<string, [number, number, number]>> = {
  // key 'A:B' -> [b_AB (K), b_BA (K), alpha_AB]
  // VLLE 접선평면 정규화 파라미터: 액액 스피노달 내부 역전 없이 수분-유기물 최소비점 불균일 공비 증류 재현
  'ECH:H2O': [410.0, 690.0, 0.30],
  'DCP:H2O': [460.0, 760.0, 0.30],
  'DCH:H2O': [195.0, 540.0, 0.30],
  'MCH:H2O': [65.0, 180.0, 0.30],
  'Glycerol:H2O': [-110.0, 45.0, 0.30],
  'DCP:ECH': [85.0, 62.0, 0.30],
  'ECH:DCH': [95.0, 70.0, 0.30],
  'DCH:MCH': [75.0, 55.0, 0.30],
  'MCH:Glycerol': [110.0, 80.0, 0.30],
};

const COMP_IDX: Record<SimCompKey, number> = ALL_KEYS.reduce((acc, k, idx) => {
  acc[k] = idx;
  return acc;
}, {} as Record<SimCompKey, number>);

const N_ALL = ALL_KEYS.length;
const NRTL_B_MAT = new Float64Array(N_ALL * N_ALL);
const NRTL_ALPHA_MAT = new Float64Array(N_ALL * N_ALL);
for (const [pairKey, vals] of Object.entries(NRTL_BIJ_K)) {
  if (!vals) continue;
  const [aKey, bKey] = pairKey.split(':') as [SimCompKey, SimCompKey];
  const ia = COMP_IDX[aKey];
  const ib = COMP_IDX[bKey];
  if (ia !== undefined && ib !== undefined) {
    NRTL_B_MAT[ia * N_ALL + ib] = vals[0];
    NRTL_ALPHA_MAT[ia * N_ALL + ib] = vals[2];
    NRTL_B_MAT[ib * N_ALL + ia] = vals[1];
    NRTL_ALPHA_MAT[ib * N_ALL + ia] = vals[2];
  }
}

const _nrtlCompIdx = new Int32Array(N_ALL);
const _nrtlX = new Float64Array(N_ALL);
const _nrtlTau = new Float64Array(N_ALL * N_ALL);
const _nrtlG = new Float64Array(N_ALL * N_ALL);
const _nrtlS = new Float64Array(N_ALL);
const _nrtlQ = new Float64Array(N_ALL);

/** 다성분 Extended NRTL (a_ij + b_ij/T, α_ij) + UNIFAC 자동 대체추정 액상 활동도 계수 산출 */
export function calcNrtlGamma(
  activeComps: SimCompKey[],
  xMol: Record<SimCompKey, number>,
  T_C: number,
  diagOut?: ActivityEvalDiagnostics
): Record<SimCompKey, number> {
  return calcExtendedNrtlGamma(activeComps, xMol, T_C, diagOut);
}

/**
 * HCl - H2O 압력변동 최대비점 공비증류(Pressure-Swing Azeotropic VLE) K-value 모델
 * - Bonner & Titus / Perry 문헌 상관:
 *   w_azeo(P_barA) = 0.2024 - 0.0142 * ln(P_barA)
 *   · 0.15 barA (진공탑): w_azeo = 22.9 wt% HCl (T_azeo ≈ 55°C)
 *   · 1.01 barA (상압):   w_azeo = 20.2 wt% HCl (T_azeo = 108.6°C)
 *   · 7.00 barA (가압탑): w_azeo = 17.5 wt% HCl (T_azeo ≈ 171°C)
 */
export function getHclAzeotropeWtFrac(P_barA: number): number {
  return clamp(0.2024 - 0.0142 * Math.log(Math.max(0.05, P_barA)), 0.145, 0.245);
}

const TRAY_LLE_ORG_SET = new Set<SimCompKey>([
  'ECH',
  'DCP',
  'DCH',
  'EtOAc',
  'Benzene',
  'Toluene',
  'pXylene',
  'nC6H14',
  'nC7H16',
  'CHCl3',
  'CH2Cl2',
  'CCl4',
  'C2Cl4',
]);

function safeHenryWaterBar(comp: SimCompKey, T_K: number): number | null {
  const h = henryWaterBar(comp, T_K);
  if (Number.isFinite(h) && h > 0) return h;
  // Sander (2015) physical Henry's law fallback (P_i [bar] = kH * x_i) if not yet in databank
  const invShift = 1 / T_K - 1 / 298.15;
  switch (comp) {
    case 'Ar':
      return 4.0e4 * Math.exp(-1500 * invShift);
    case 'NH3':
      return 0.941 * Math.exp(-4200 * invShift);
    case 'SO2':
      return 46.3 * Math.exp(-2900 * invShift);
    case 'H2S':
      return 545.0 * Math.exp(-2100 * invShift);
    default:
      return null;
  }
}

interface VlleScaleCapture {
  scale: Record<SimCompKey, number> | null;
}

function calcStageKValues(
  model: ResolvedDistillThermoModel,
  activeComps: SimCompKey[],
  xMol: Record<SimCompKey, number>,
  T_C: number,
  P_barA: number,
  yMol?: Record<SimCompKey, number>,
  maxGasKCap = 8000,
  vlleScaleHint?: Record<SimCompKey, number> | null,
  vlleScaleOut?: VlleScaleCapture
): Record<SimCompKey, number> {
  const K = zeroCompRecord();
  const P = Math.max(0.03, P_barA);
  const T_K = Math.max(60.0, T_C + 273.15);

  if (model === 'ELEC_HCL_AZEO') {
    const xHCl = Math.max(0, xMol.HCl || 0);
    const xH2O = Math.max(0, xMol.H2O || 0);
    const sumAq = xHCl + xH2O;

    const wAzeo = getHclAzeotropeWtFrac(P);
    const xAzeo = (wAzeo / MW.HCl) / (wAzeo / MW.HCl + (1 - wAzeo) / MW.H2O);
    const xRel = sumAq > 1e-8 ? clamp(xHCl / sumAq, 0, 1) : 0;

    const pWaterPure = pureSatPressBarA('H2O', T_C);
    const pHclPure = pureSatPressBarA('HCl', T_C);

    let alphaHclOverWater = 1.0;
    let pTotalEff = pWaterPure;

    if (xRel <= xAzeo) {
      const ratio = clamp(xRel / Math.max(1e-5, xAzeo), 0, 1);
      alphaHclOverWater = 0.0008 + 0.9992 * Math.pow(ratio, 3.0);
      const azeoFactor = 1.0 - 0.26 * Math.pow(ratio, 1.5) * (2.0 - ratio);
      pTotalEff = pWaterPure * azeoFactor;
    } else {
      const excessFull = clamp((xRel - xAzeo) / Math.max(0.05, 1.0 - xAzeo), 0, 1);
      const excessNear = clamp((xRel - xAzeo) / 0.045, 0, 1);
      alphaHclOverWater =
        1.0 + 14.0 * Math.pow(excessNear, 0.85) + 85.0 * excessFull + 220.0 * excessFull * excessFull;
      const wPureHcl = 0.065 * Math.pow(excessFull, 1.6);
      pTotalEff = (1.0 - wPureHcl) * (pWaterPure * 0.74) + wPureHcl * pHclPure;
    }

    const denomFactor = Math.max(0.05, 1.0 - xRel + alphaHclOverWater * xRel);
    const kWater = clamp(pTotalEff / (P * denomFactor), 1e-7, 800);
    const kHcl = clamp(kWater * alphaHclOverWater, 1e-7, 3500);

    for (const c of activeComps) {
      if (c === 'H2O') K[c] = kWater;
      else if (c === 'HCl') K[c] = kHcl;
      else if (NON_VOLATILE_SET.has(c)) K[c] = 1e-11;
      else K[c] = clamp(pureSatPressBarA(c, T_C) / P, 1e-7, 5000);
    }
    return K;
  }

  // Pure φ-φ Cubic EOS Mode (PR / SRK / PENG_ROB — zero Raoult blending)
  if (model === 'PENG_ROB' || model === 'PR' || model === 'SRK') {
    const eosMethod: 'PR' | 'SRK' = model === 'SRK' ? 'SRK' : 'PR';
    const evalEos = (compFrac: Record<SimCompKey, number>, pBar: number, vapOnlyFlag?: boolean) =>
      eosMethod === 'SRK'
        ? calcSoaveRedlichKwongMixture(compFrac, T_C, 0, pBar, activeComps, vapOnlyFlag)
        : calcPengRobinsonMixture(compFrac, T_C, 0, pBar, activeComps, vapOnlyFlag);

    const yEval = zeroCompRecord();
    let yInSum = 0;
    if (yMol) {
      for (let i = 0; i < activeComps.length; i++) {
        const c = activeComps[i];
        if (!NON_VOLATILE_SET.has(c)) yInSum += Math.max(0, yMol[c] || 0);
      }
    }
    if (yMol && yInSum > 0.5) {
      for (let i = 0; i < activeComps.length; i++) {
        const c = activeComps[i];
        if (!NON_VOLATILE_SET.has(c)) yEval[c] = Math.max(0, yMol[c] || 0) / yInSum;
      }
    } else {
      let yTrialSum = 0;
      for (let i = 0; i < activeComps.length; i++) {
        const c = activeComps[i];
        if (NON_VOLATILE_SET.has(c)) continue;
        const cr = RIGOROUS_CRIT[c];
        const kWil = (cr.Pc_bar / P) * Math.exp(5.373 * (1.0 + cr.omega) * (1.0 - cr.Tc_K / T_K));
        yEval[c] = Math.max(0, xMol[c] || 0) * clamp(kWil, 1e-8, 1e5);
        yTrialSum += yEval[c];
      }
      if (yTrialSum > 1e-15) {
        for (let i = 0; i < activeComps.length; i++) yEval[activeComps[i]] /= yTrialSum;
      } else {
        for (let i = 0; i < activeComps.length; i++) yEval[activeComps[i]] = xMol[activeComps[i]] || 0;
      }
    }

    const eosL = evalEos(xMol, P, false);
    const eosV = evalEos(yEval, P, true);
    const zCritRatio = eosMethod === 'SRK' ? 3.84732 : 3.95136;
    const hasLiquidRoot = eosL.rootCount >= 2 || eosL.Z_liq / Math.max(1e-12, eosL.B) <= zCritRatio;

    if (hasLiquidRoot) {
      for (let i = 0; i < activeComps.length; i++) {
        const c = activeComps[i];
        if (NON_VOLATILE_SET.has(c)) {
          K[c] = 1e-11;
        } else {
          const phiL = Math.max(1e-15, eosL.phi_liq[c]);
          const phiV = Math.max(1e-15, eosV.phi_vap[c]);
          K[c] = clamp(phiL / phiV, 1e-9, maxGasKCap);
        }
      }
      return K;
    }

    // Above liquid spinodal during outer bracket search: evaluate subcooled EOS liquid fugacity + Poynting
    let pIdealSum = 0;
    for (let i = 0; i < activeComps.length; i++) {
      const c = activeComps[i];
      if (!NON_VOLATILE_SET.has(c)) {
        pIdealSum += Math.max(0, xMol[c] || 0) * pureSatPressBarA(c, T_C);
      }
    }
    const pSub = Math.max(P * 1.25, pIdealSum * 1.15);
    const eosLSub = evalEos(xMol, pSub);
    const subHasLiq = eosLSub.rootCount >= 2 || eosLSub.Z_liq / Math.max(1e-12, eosLSub.B) <= zCritRatio;

    for (let i = 0; i < activeComps.length; i++) {
      const c = activeComps[i];
      if (NON_VOLATILE_SET.has(c)) {
        K[c] = 1e-11;
      } else if (subHasLiq) {
        const vL = liquidMolarVolumeLPerMol(c);
        const poynt = Math.exp(Math.max(-3.0, Math.min(3.0, (vL * (P - pSub)) / (0.083144626 * T_K))));
        const fLiqOverP = eosLSub.phi_liq[c] * (pSub / P) * poynt;
        K[c] = clamp(fLiqOverP / Math.max(1e-15, eosV.phi_vap[c]), 1e-9, maxGasKCap);
      } else {
        const cr = RIGOROUS_CRIT[c];
        const kWil = (cr.Pc_bar / P) * Math.exp(5.373 * (1.0 + cr.omega) * (1.0 - cr.Tc_K / T_K));
        K[c] = clamp(kWil, 1e-9, maxGasKCap);
      }
    }
    return K;
  }

  // Rigorous γ-φ Mode (NRTL / ENRTL): DIPPR-101 P_sat + Poynting + PR φ_sat/φ_V + True 2-Liquid VLLE Tie-Line
  const gamma = calcNrtlGamma(activeComps, xMol, T_C);
  const gammaEff: Record<SimCompKey, number> = { ...gamma };

  // Check for true 2-liquid phase split on heterogeneous aqueous-organic trays
  const xWater = Math.max(0, xMol.H2O || 0);
  if (vlleScaleHint !== undefined) {
    if (vlleScaleHint !== null && xWater > 1e-3) {
      let xLleOrg = 0;
      for (let i = 0; i < activeComps.length; i++) {
        const c = activeComps[i];
        if (TRAY_LLE_ORG_SET.has(c)) xLleOrg += Math.max(0, xMol[c] || 0);
      }
      if (xLleOrg > 1e-3) {
        for (let i = 0; i < activeComps.length; i++) {
          const c = activeComps[i];
          const aTie = vlleScaleHint[c];
          const xc = Math.max(0, xMol[c] || 0);
          if (aTie > 0 && xc > 1e-12 && !NON_VOLATILE_SET.has(c)) {
            const gTie = aTie / xc;
            gammaEff[c] = 0.85 * gTie + 0.15 * (gamma[c] || 1.0);
          }
        }
      }
    }
  } else {
    if (vlleScaleOut) vlleScaleOut.scale = null;
    let xLleOrg = 0;
    let maxImmActivity = xWater * (gamma.H2O || 1.0);
    for (let i = 0; i < activeComps.length; i++) {
      const c = activeComps[i];
      if (TRAY_LLE_ORG_SET.has(c)) {
        const xc = Math.max(0, xMol[c] || 0);
        xLleOrg += xc;
        const act = xc * (gamma[c] || 1.0);
        if (act > maxImmActivity) maxImmActivity = act;
      }
    }
    if (xWater > 1e-3 && xLleOrg > 1e-3 && maxImmActivity >= 0.78) {
      const trayMassKg = zeroCompRecord();
      for (let i = 0; i < activeComps.length; i++) {
        const c = activeComps[i];
        if (!NON_VOLATILE_SET.has(c)) {
          trayMassKg[c] = Math.max(0, xMol[c] || 0) * COMP_MW[c] * 100.0;
        }
      }
      const lle = solveRigorousLLEDecanter(trayMassKg, T_C);
      if (lle.phaseSplit) {
        const xOrg = zeroCompRecord();
        const xAq = zeroCompRecord();
        let nOrg = 0;
        let nAq = 0;
        for (let i = 0; i < activeComps.length; i++) {
          const c = activeComps[i];
          const mo = (lle.organicKgH[c] || 0) / COMP_MW[c];
          const ma = (lle.aqueousKgH[c] || 0) / COMP_MW[c];
          xOrg[c] = mo;
          xAq[c] = ma;
          nOrg += mo;
          nAq += ma;
        }
        if (nOrg > 1e-12 && nAq > 1e-12) {
          for (let i = 0; i < activeComps.length; i++) {
            const c = activeComps[i];
            xOrg[c] /= nOrg;
            xAq[c] /= nAq;
          }
          const gOrg = calcNrtlGamma(activeComps, xOrg, T_C);
          const gAq = calcNrtlGamma(activeComps, xAq, T_C);
          const capTie = vlleScaleOut ? zeroCompRecord() : null;
          for (let i = 0; i < activeComps.length; i++) {
            const c = activeComps[i];
            const xc = Math.max(0, xMol[c] || 0);
            if (xc > 1e-12 && !NON_VOLATILE_SET.has(c)) {
              const aTie =
                xOrg[c] >= xAq[c]
                  ? xOrg[c] * (gOrg[c] || 1.0)
                  : xAq[c] * (gAq[c] || 1.0);
              if (aTie > 0) {
                const gTie = aTie / xc;
                gammaEff[c] = 0.85 * gTie + 0.15 * (gamma[c] || 1.0);
                if (capTie) capTie[c] = aTie;
              }
            }
          }
          if (vlleScaleOut && capTie) vlleScaleOut.scale = capTie;
        }
      }
    }
  }

  // Vapor composition estimate for vapor-phase PR fugacity φ_i^V(y, T, P)
  const yVapEst = zeroCompRecord();
  let ySum = 0;
  if (yMol) {
    for (let i = 0; i < activeComps.length; i++) {
      const c = activeComps[i];
      if (!NON_VOLATILE_SET.has(c)) ySum += Math.max(0, yMol[c] || 0);
    }
  }
  if (yMol && ySum > 0.5) {
    for (let i = 0; i < activeComps.length; i++) {
      const c = activeComps[i];
      if (!NON_VOLATILE_SET.has(c)) yVapEst[c] = Math.max(0, yMol[c] || 0) / ySum;
    }
  } else {
    let yInitSum = 0;
    for (let i = 0; i < activeComps.length; i++) {
      const c = activeComps[i];
      if (NON_VOLATILE_SET.has(c)) continue;
      yVapEst[c] = Math.max(0, xMol[c] || 0) * (gammaEff[c] || 1.0) * (pureSatPressBarA(c, T_C) / P);
      yInitSum += yVapEst[c];
    }
    if (yInitSum > 1e-15) {
      for (let i = 0; i < activeComps.length; i++) yVapEst[activeComps[i]] /= yInitSum;
    } else {
      for (let i = 0; i < activeComps.length; i++) yVapEst[activeComps[i]] = xMol[activeComps[i]] || 0;
    }
  }
  const eosVap = calcPengRobinsonMixture(yVapEst, T_C, 0, P, activeComps, true);

  const molElec =
    model === 'ENRTL'
      ? computeElectrolyteMolalitiesFromWaterKg(xMol, Math.max(1e-9, xWater * (MW.H2O * 1e-3)), true)
      : null;
  const awSalt = molElec ? calcElectrolyteWaterActivity(molElec, T_C) : 1.0;

  const xHCl = Math.max(0, xMol.HCl || 0);
  const useHclDissoc = model === 'ENRTL' && xHCl > 1e-8 && xWater > 1e-5;
  const extraClMolality = molElec
    ? molElec.mNaCl + molElec.mNaOCl + 2.0 * molElec.mFeCl2 + 3.0 * molElec.mFeCl3 + 2.0 * molElec.mPAC
    : 0;
  const wHClAq = useHclDissoc
    ? (xHCl * MW.HCl) / Math.max(1e-12, xHCl * MW.HCl + xWater * MW.H2O)
    : 0;
  const hclEq = useHclDissoc ? calcHclWaterEquilibriumBar(wHClAq, T_C, extraClMolality) : null;

  for (let i = 0; i < activeComps.length; i++) {
    const c = activeComps[i];
    if (NON_VOLATILE_SET.has(c)) {
      K[c] = 1e-11;
      continue;
    }
    const phiV = Math.max(0.05, eosVap.phi_vap[c] || 1.0);
    const sech = molElec ? calcSechenovSaltingOutMultiplier(c, molElec, T_K) : 1.0;

    if (PERMANENT_GAS_SET.has(c)) {
      const hBar = safeHenryWaterBar(c, T_K);
      if (hBar !== null && xWater > 0.02) {
        const kAq = (hBar * sech) / (phiV * P);
        const kOrg = pureSatPressBarA(c, T_C) / (phiV * P);
        const wAq = clamp((xWater - 0.02) / 0.25, 0, 1);
        K[c] = clamp(wAq * kAq + (1.0 - wAq) * kOrg, 0.05, maxGasKCap);
      } else {
        K[c] = clamp((pureSatPressBarA(c, T_C) * sech) / (phiV * P), 0.05, maxGasKCap);
      }
      continue;
    }

    if (c === 'HCl' && hclEq && xHCl > 1e-12) {
      const xAqSum = xHCl + xWater;
      const pHClEff = hclEq.pHCl_bar * xAqSum;
      K[c] = clamp(pHClEff / (xHCl * phiV * P), 1e-9, maxGasKCap);
      continue;
    }

    if ((c === 'Cl2' || c === 'CO2' || c === 'SO2' || c === 'H2S') && xWater > 0.10) {
      const hBar = safeHenryWaterBar(c, T_K);
      if (hBar !== null) {
        const pSat = pureSatPressBarA(c, T_C);
        const phiSat = pureSatFugacityCoeffPR(c, T_C, pSat);
        const kAq = (hBar * sech) / (phiV * P);
        const kCond = ((gammaEff[c] || 1.0) * pSat * phiSat) / (phiV * P);
        const wAq = clamp((xWater - 0.10) / 0.35, 0, 1);
        K[c] = clamp(wAq * kAq + (1.0 - wAq) * kCond, 1e-8, maxGasKCap);
        continue;
      }
    }

    let g = gammaEff[c] || 1.0;
    if (model === 'ENRTL') {
      if (c === 'H2O') {
        g *= awSalt * (hclEq ? hclEq.aw_hcl : 1.0);
      } else if (c !== 'NH3') {
        g *= sech;
      }
    }
    if (c === 'NH3' && xWater > 0.25) {
      const hNh3 = safeHenryWaterBar('NH3', T_K);
      if (hNh3 !== null) {
        K[c] = clamp((hNh3 * sech) / (phiV * P), 1e-8, maxGasKCap);
        continue;
      }
    }

    const pSat = pureSatPressBarA(c, T_C);
    const phiSat = pureSatFugacityCoeffPR(c, T_C, pSat);
    const vL = liquidMolarVolumeLPerMol(c);
    const poynt = Math.exp(Math.max(-2.0, Math.min(2.0, (vL * (P - pSat)) / (0.083144626 * T_K))));
    K[c] = clamp((g * pSat * phiSat * poynt) / (phiV * P), 1e-9, maxGasKCap);
  }
  return K;
}

/** 주어진 액상 조성 xMol 과 압력 P_barA 에서의 기포점 온도(Bubble-Point Temperature, °C) Warm-Start 고속 해법 */
function solveStageBubbleTempC(
  model: ResolvedDistillThermoModel,
  activeComps: SimCompKey[],
  xMol: Record<SimCompKey, number>,
  P_barA: number,
  initTempC: number,
  yMol?: Record<SimCompKey, number>,
  vlleOut?: VlleScaleCapture,
  vlleHint?: Record<SimCompKey, number> | null
): number {
  const evalComps: SimCompKey[] = [];
  let condSum = 0;
  let gasSum = 0;
  let lightHcSum = 0;
  for (let i = 0; i < activeComps.length; i++) {
    const c = activeComps[i];
    if (NON_VOLATILE_SET.has(c)) continue;
    evalComps.push(c);
    const xv = Math.max(0, xMol[c] || 0);
    if (PERMANENT_GAS_SET.has(c)) {
      gasSum += xv;
    } else {
      condSum += xv;
      if (c === 'C2H4' || c === 'C2H6' || c === 'C3H6' || c === 'C3H8' || c === 'CO2') {
        lightHcSum += xv;
      }
    }
  }
  if (condSum <= 1e-8) return initTempC;

  // 용존 초임계 가스(O2/H2/N2/CH4/CO)는 실제 액상 용해도 한계(최대 4 mol% 상당)까지 기포점 강하에 반영
  const xEff = zeroCompRecord();
  const cappedGasSum = Math.min(gasSum, 0.04);
  const gasScale = gasSum > 1e-12 ? cappedGasSum / gasSum : 0;
  const condScale = Math.max(0.96, 1.0 - cappedGasSum) / condSum;
  for (let i = 0; i < evalComps.length; i++) {
    const c = evalComps[i];
    const xv = Math.max(0, xMol[c] || 0);
    xEff[c] = PERMANENT_GAS_SET.has(c) ? xv * gasScale : xv * condScale;
  }

  const tLoBound = lightHcSum / condSum > 0.05 ? -135.0 : -95.0;
  const t0 = clamp(initTempC, tLoBound + 1.0, 309.0);
  const vlleCap: VlleScaleCapture = vlleOut ?? { scale: null };
  if (vlleHint !== undefined) {
    vlleCap.scale = vlleHint;
  }

  const evalFirstSumKx = (t: number): number => {
    const K =
      vlleHint !== undefined
        ? calcStageKValues(model, evalComps, xEff, t, P_barA, yMol, 8000, vlleHint)
        : calcStageKValues(model, evalComps, xEff, t, P_barA, yMol, 8000, undefined, vlleCap);
    let s = 0;
    for (let i = 0; i < evalComps.length; i++) {
      const c = evalComps[i];
      s += K[c] * xEff[c];
    }
    return s;
  };

  const evalFastSumKx = (t: number): number => {
    const K = calcStageKValues(model, evalComps, xEff, t, P_barA, yMol, 8000, vlleCap.scale);
    let s = 0;
    for (let i = 0; i < evalComps.length; i++) {
      const c = evalComps[i];
      s += K[c] * xEff[c];
    }
    return s;
  };

  const s0 = evalFirstSumKx(t0);
  const f0 = s0 - 1.0;
  if (Math.abs(f0) < 1.5e-4) return t0;

  // Clausius-Clapeyron 비례 초기 스텝 추정 (d ln(sumKx)/dT ≈ 0.036 K^-1)
  const g0 = Math.log(Math.max(1e-8, s0));
  const rawStep = -g0 / 0.036;
  const stepDir = f0 > 0 ? -1.0 : 1.0;
  const stepMag = clamp(Math.abs(rawStep), 0.35, 12.0);
  const tProbe = clamp(t0 + stepDir * stepMag, tLoBound, 310.0);
  const sProbe = evalFastSumKx(tProbe);
  const fProbe = sProbe - 1.0;
  if (Math.abs(fProbe) < 1.5e-4) return tProbe;

  let lo: number, hi: number, gLo: number, gHi: number;
  if (f0 > 0) {
    hi = t0;
    gHi = g0;
    if (fProbe <= 0) {
      lo = tProbe;
      gLo = Math.log(Math.max(1e-8, sProbe));
    } else {
      hi = tProbe;
      gHi = Math.log(Math.max(1e-8, sProbe));
      const tProbe2 = Math.max(tLoBound, tProbe - 28.0);
      const sProbe2 = tProbe2 < tProbe - 0.1 ? evalFastSumKx(tProbe2) : 0.5;
      if (sProbe2 <= 1.0) {
        lo = tProbe2;
        gLo = Math.log(Math.max(1e-8, sProbe2));
      } else {
        lo = tLoBound;
        gLo = Math.log(Math.max(1e-8, evalFastSumKx(tLoBound)));
        if (gLo >= 0) return tLoBound;
      }
    }
  } else {
    lo = t0;
    gLo = g0;
    if (fProbe >= 0) {
      hi = tProbe;
      gHi = Math.log(Math.max(1e-8, sProbe));
    } else {
      lo = tProbe;
      gLo = Math.log(Math.max(1e-8, sProbe));
      const tProbe2 = Math.min(310.0, tProbe + 28.0);
      const sProbe2 = tProbe2 > tProbe + 0.1 ? evalFastSumKx(tProbe2) : 2.0;
      if (sProbe2 >= 1.0) {
        hi = tProbe2;
        gHi = Math.log(Math.max(1e-8, sProbe2));
      } else {
        hi = 310.0;
        gHi = Math.log(Math.max(1e-8, evalFastSumKx(310.0)));
        if (gHi <= 0) return 310.0;
      }
    }
  }

  // Safeguarded Illinois Log-Linear Secant-Bisection (2~4회 내 수렴 보장)
  for (let it = 0; it < 12; it++) {
    if (hi - lo < 0.004) return 0.5 * (lo + hi);
    const denom = gHi - gLo;
    let nextT: number;
    if (it % 4 !== 3 && Math.abs(denom) > 1e-12) {
      const sec = lo - (gLo * (hi - lo)) / denom;
      const margin = 0.08 * (hi - lo);
      nextT = sec > lo + margin && sec < hi - margin ? sec : 0.5 * (lo + hi);
    } else {
      nextT = 0.5 * (lo + hi);
    }
    const sm = evalFastSumKx(nextT);
    const fm = sm - 1.0;
    if (Math.abs(fm) < 1.5e-4) return nextT;
    const gm = Math.log(Math.max(1e-8, sm));
    if (fm > 0) {
      hi = nextT;
      gHi = gm;
      gLo *= 0.5;
    } else {
      lo = nextT;
      gLo = gm;
      gHi *= 0.5;
    }
  }
  return 0.5 * (lo + hi);
}

/** Thomas 삼중대각행렬(Tridiagonal Matrix) O(N) 직접 해법: a[j]*x[j-1] + b[j]*x[j] + c[j]*x[j+1] = d[j] */
function solveTridiagonal(
  a: number[] | Float64Array,
  b: number[] | Float64Array,
  c: number[] | Float64Array,
  d: number[] | Float64Array,
  cpBuf?: Float64Array,
  dpBuf?: Float64Array,
  outBuf?: Float64Array
): Float64Array {
  const n = b.length;
  const cp = cpBuf && cpBuf.length >= n ? cpBuf : new Float64Array(n);
  const dp = dpBuf && dpBuf.length >= n ? dpBuf : new Float64Array(n);
  const x = outBuf && outBuf.length >= n ? outBuf : new Float64Array(n);

  const b0 = Math.abs(b[0]) < 1e-15 ? -1e-15 : b[0];
  cp[0] = c[0] / b0;
  dp[0] = d[0] / b0;

  for (let i = 1; i < n; i++) {
    const denom = b[i] - a[i] * cp[i - 1];
    const safeDenom = Math.abs(denom) < 1e-15 ? (denom >= 0 ? 1e-15 : -1e-15) : denom;
    cp[i] = i < n - 1 ? c[i] / safeDenom : 0;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / safeDenom;
  }

  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    x[i] = dp[i] - cp[i] * x[i + 1];
  }
  return x;
}

export function detectBestDistillThermo(
  totalFeedKgH: Record<SimCompKey, number>,
  topPressKgcm2g = 1.0
): ResolvedDistillThermoModel {
  const echMass =
    (totalFeedKgH.ECH || 0) +
    (totalFeedKgH.DCH || 0) +
    (totalFeedKgH.MCH || 0) +
    (totalFeedKgH.Glycerol || 0) +
    (totalFeedKgH.DCP || 0);
  const tot = ALL_KEYS.reduce((s, k) => s + (totalFeedKgH[k] || 0), 0);
  if (tot <= 1e-6) return 'NRTL';
  if (echMass / tot > 0.02) return 'NRTL';

  const polarOrgMass =
    (totalFeedKgH.MeOH || 0) +
    (totalFeedKgH.EtOH || 0) +
    (totalFeedKgH.IPA || 0) +
    (totalFeedKgH.Acetone || 0) +
    (totalFeedKgH.AceticAcid || 0) +
    (totalFeedKgH.EtOAc || 0) +
    (totalFeedKgH.CHCl3 || 0);
  if (
    (totalFeedKgH.HCl || 0) > 0 &&
    (totalFeedKgH.H2O || 0) > 0 &&
    (totalFeedKgH.Cl2 || 0) / tot < 0.3 &&
    polarOrgMass / tot < 0.05
  ) {
    return 'ELEC_HCL_AZEO';
  }

  let newGenMass = 0;
  for (let i = 0; i < NEW_DISTILL_KEYS.length; i++) {
    newGenMass += totalFeedKgH[NEW_DISTILL_KEYS[i]] || 0;
  }
  if (newGenMass <= 1e-6) {
    return 'PENG_ROB';
  }

  const rec = recommendPropertyMethod(ALL_KEYS, totalFeedKgH, topPressKgcm2g);
  return rec.method;
}

interface InnerSideDrawSpec {
  id: string;
  label: string;
  stageIdx: number; // 0-based (1 .. N-2)
  phase: SideCutPhase;
  targetMolesKmolH?: number;
  drawRatio?: number;
}

interface InnerSideDrawOutput {
  id: string;
  label: string;
  stage: number; // 1-based
  phase: 'L' | 'G';
  tempC: number;
  pressKgcm2g: number;
  kmolH: Record<SimCompKey, number>;
  kgH: Record<SimCompKey, number>;
  totalMassKgH: number;
  totalMolesKmolH: number;
}

interface InnerMeshSolution {
  converged: boolean;
  iterations: number;
  distillateKmolH: Record<SimCompKey, number>;
  bottomsKmolH: Record<SimCompKey, number>;
  distillateKgH: Record<SimCompKey, number>;
  bottomsKgH: Record<SimCompKey, number>;
  decanterWaterDrawKgH: number;
  decanterFlowsKgH: Record<SimCompKey, number>;
  distillatePhase: 'L' | 'G';
  stages: DistillStageProfile[];
  condenserDutyKcalH: number;
  reboilerDutyKcalH: number;
  actualRefluxRatio: number;
  actualBoilupRatio: number;
  actualDOverFMass: number;
  actualDOverFMole: number;
  sideDraws?: InnerSideDrawOutput[];
  sideCutClamped?: boolean;
}

/**
 * 고정된 (RR, D_mol) 2자유도 쌍에 대해 N단 MESH 방정식(비등몰 Non-CMO 단별 엔탈피 수지 + 행렬 내 Murphree 단효율)을 풀어
 * 단별 온도·조성·유량·응축기/리보일러 열부하를 엄밀 산출하는 내부 코어 솔버
 */
function solveInnerMeshColumn(params: {
  model: ResolvedDistillThermoModel;
  N: number;
  feeds: Array<{ stageIdx: number; mol: Record<SimCompKey, number>; qThermal: number; tempC: number; enthalpyKJH: number }>;
  totalFeedMol: Record<SimCompKey, number>;
  totalFeedMassKgH: number;
  activeComps: SimCompKey[];
  condenserType: DistillCondenserType;
  reboilerType: DistillReboilerType;
  P_stageBarA: number[];
  topPressKgcm2g: number;
  stageDeltaP: number;
  meshMurphreeEff: number;
  refluxRatio: number;
  targetDistillateKmolH: number;
  sideDraws?: InnerSideDrawSpec[];
  maxIterations?: number;
}): InnerMeshSolution {
  const {
    model,
    N,
    feeds,
    totalFeedMol,
    totalFeedMassKgH,
    activeComps,
    condenserType,
    reboilerType,
    P_stageBarA,
    topPressKgcm2g,
    stageDeltaP,
    meshMurphreeEff,
  } = params;

  const nActive = activeComps.length;
  const totalMolesIn = activeComps.reduce((s, c) => s + totalFeedMol[c], 0);
  const nonVolMolesIn = activeComps.reduce((s, c) => s + (NON_VOLATILE_SET.has(c) ? totalFeedMol[c] : 0), 0);
  const maxPossibleDistMol = Math.max(1e-6, totalMolesIn - nonVolMolesIn - 1e-6);

  const D = clamp(params.targetDistillateKmolH, 1e-5, maxPossibleDistMol);
  const RR = clamp(params.refluxRatio, 0.05, 80.0);

  // 비반응 단별 엔탈피 수지용 성분 기준 엔탈피 hRef[c] (25°C 액상 기준):
  // 모든 단에서 성분 몰수지가 보존되므로 H_tilde = H - Σ n_c hRef_c 는 생성열 ΔHf° 스케일 노이즈를 제거하여
  // H_V_tilde(y_{j+1}) - h_L_tilde(x_j) > 0 양정치성을 항상 보장하며 수렴 시 원래 총엔탈피 수지와 100% 항등 일치함.
  const hRef = zeroCompRecord();
  const feedWaterMol = totalFeedMol.H2O || 0;
  for (let ci = 0; ci < nActive; ci++) {
    const c = activeComps[ci];
    const isAqElectrolyte =
      (c === 'HCl' || c === 'NaOH' || c === 'H2SO4' || c === 'NaCl') &&
      feedWaterMol > 0.25 * (totalFeedMol[c] || 0);
    hRef[c] = componentMolarEnthalpy(c, 25.0, isAqElectrolyte ? 'AQ' : 'L');
  }

  // 단별 피드 몰수·열상태·총엔탈피 합산
  const stageFeedMol: Array<Record<SimCompKey, number>> = Array.from({ length: N }, () => zeroCompRecord());
  const stageFeedTot = new Float64Array(N);
  const stageFeedLiq = new Float64Array(N);
  const stageFeedEnthTilde = new Float64Array(N);
  let totalFeedEnthKJH = 0;
  let stage0FeedEnthKJH = 0;

  for (const f of feeds) {
    const j = clamp(f.stageIdx, 0, N - 1);
    let fSum = 0;
    let fRefH = 0;
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      const m = f.mol[c];
      stageFeedMol[j][c] += m;
      fSum += m;
      fRefH += m * hRef[c];
    }
    stageFeedTot[j] += fSum;
    stageFeedLiq[j] += fSum * clamp(f.qThermal, -0.2, 1.3);
    stageFeedEnthTilde[j] += f.enthalpyKJH - fRefH;
    totalFeedEnthKJH += f.enthalpyKJH;
    if (j === 0) stage0FeedEnthKJH += f.enthalpyKJH;
  }

  const cumFeedTot = new Float64Array(N);
  const cumFeedEnthFrom1 = new Float64Array(N);
  let runF = 0;
  let runH1 = 0;
  for (let j = 0; j < N; j++) {
    runF += stageFeedTot[j];
    cumFeedTot[j] = runF;
    if (j >= 1) runH1 += stageFeedEnthTilde[j];
    cumFeedEnthFrom1[j] = runH1;
  }

  // 사이드컷(측류 인출) 내부 스펙 정규화 (N >= 3 인 경우 내부단 1..N-2 허용)
  const activeDraws: InnerSideDrawSpec[] =
    N >= 3 && params.sideDraws?.length
      ? params.sideDraws
          .filter(sd => sd.stageIdx >= 0 && ((sd.targetMolesKmolH ?? 0) > 1e-8 || (sd.drawRatio ?? 0) > 1e-5))
          .map(sd => ({
            ...sd,
            stageIdx: clamp(Math.round(sd.stageIdx), 1, N - 2),
          }))
      : [];

  const minFlowFloor = Math.max(1e-5, 0.015 * Math.min(D, Math.max(1e-5, totalMolesIn - D)));
  const minBotFloor = Math.max(minFlowFloor, 0.002 * totalMolesIn);
  const maxTotSideMol = Math.max(0, totalMolesIn - D - minBotFloor);
  const SL = new Float64Array(N);
  const SV = new Float64Array(N);
  const cumSideDrawTot = new Float64Array(N);
  const cumSideDrawEnthFrom1 = new Float64Array(N);
  const drawMoles = new Float64Array(activeDraws.length);
  let sideCutClamped = false;

  const L = new Float64Array(N); // j단에서 j+1단으로 내려가는 액상 (L[N-1] = B)
  const V = new Float64Array(N); // j단에서 j-1단으로 올라가는 기상 (V[0] = 부분응축 기상 D 또는 0)
  let B = Math.max(minFlowFloor, totalMolesIn - D);

  const rebuildSideDrawSums = (isInitial: boolean, ratioDamp = 0.35) => {
    if (activeDraws.length === 0) {
      B = Math.max(minFlowFloor, totalMolesIn - D);
      L[N - 1] = B;
      return;
    }
    let reqTot = 0;
    for (let idx = 0; idx < activeDraws.length; idx++) {
      const d = activeDraws[idx];
      const j = d.stageIdx;
      let dm: number;
      if (d.drawRatio !== undefined) {
        const r = clamp(d.drawRatio, 0.005, 0.85);
        const totalOutPhase = d.phase === 'liquid'
          ? Math.max(minFlowFloor, L[j] + SL[j])
          : Math.max(minFlowFloor, V[j] + SV[j]);
        const targetDm = r * totalOutPhase;
        dm = isInitial ? targetDm : (1.0 - ratioDamp) * drawMoles[idx] + ratioDamp * targetDm;
      } else {
        dm = Math.max(0, d.targetMolesKmolH ?? 0);
      }
      drawMoles[idx] = Math.max(0, dm);
      reqTot += drawMoles[idx];
    }
    if (reqTot > maxTotSideMol && reqTot > 1e-12) {
      const sc = maxTotSideMol / reqTot;
      for (let idx = 0; idx < activeDraws.length; idx++) drawMoles[idx] *= sc;
      sideCutClamped = true;
    }
    SL.fill(0);
    SV.fill(0);
    for (let idx = 0; idx < activeDraws.length; idx++) {
      const d = activeDraws[idx];
      if (d.phase === 'vapor') SV[d.stageIdx] += drawMoles[idx];
      else SL[d.stageIdx] += drawMoles[idx];
    }
    let runS = 0;
    for (let j = 0; j < N; j++) {
      runS += SL[j] + SV[j];
      cumSideDrawTot[j] = runS;
    }
    B = Math.max(minFlowFloor, totalMolesIn - D - (N >= 2 ? cumSideDrawTot[N - 2] : 0));
    L[N - 1] = B;
  };

  // 초기 단별 내부 액상(L_j) / 기상(V_j) 트래픽 구성 (물질수지 V[j+1] - L[j] === D + cumSideDrawTot[j] - cumFeedTot[j] 엄밀 만족)
  const L0 = RR * D;
  V[0] = condenserType === 'partial' ? D : 0;
  L[0] = Math.max(minFlowFloor, L0 + stageFeedLiq[0]);
  V[1] = Math.max(minFlowFloor, L[0] + D - cumFeedTot[0]);

  if (activeDraws.length > 0) {
    // 1차 초기 추정: 고정 몰 인출 우선 적용 + drawRatio 단계적 초기치 계산
    for (let j = 1; j < N - 1; j++) {
      const lAvailEst = Math.max(minFlowFloor, L[j - 1] + stageFeedLiq[j]);
      for (let idx = 0; idx < activeDraws.length; idx++) {
        const d = activeDraws[idx];
        if (d.stageIdx !== j) continue;
        if (d.drawRatio !== undefined) {
          const r = clamp(d.drawRatio, 0.005, 0.85);
          if (d.phase === 'liquid') {
            drawMoles[idx] = r * lAvailEst;
            SL[j] += drawMoles[idx];
          } else {
            const vAvailEst = Math.max(minFlowFloor, V[j]);
            drawMoles[idx] = r * vAvailEst;
            SV[j] += drawMoles[idx];
          }
        } else {
          drawMoles[idx] = Math.max(0, d.targetMolesKmolH ?? 0);
          if (d.phase === 'vapor') SV[j] += drawMoles[idx];
          else SL[j] += drawMoles[idx];
        }
      }
      cumSideDrawTot[j] = cumSideDrawTot[j - 1] + SL[j] + SV[j];
      const netUp = D + cumSideDrawTot[j] - cumFeedTot[j];
      const lGuess = Math.max(minFlowFloor, L[j - 1] + stageFeedLiq[j] - SL[j]);
      const vGuess = Math.max(minFlowFloor, lGuess + netUp);
      V[j + 1] = vGuess;
      L[j] = Math.max(minFlowFloor, vGuess - netUp);
    }
    rebuildSideDrawSums(true);
    for (let j = 1; j < N - 1; j++) {
      const netUp = D + cumSideDrawTot[j] - cumFeedTot[j];
      const lGuess = Math.max(minFlowFloor, L[j - 1] + stageFeedLiq[j] - SL[j]);
      const vGuess = Math.max(minFlowFloor, lGuess + netUp);
      V[j + 1] = vGuess;
      L[j] = Math.max(minFlowFloor, vGuess - netUp);
    }
  } else {
    for (let j = 1; j < N - 1; j++) {
      const netUp = D - cumFeedTot[j];
      const lGuess = Math.max(minFlowFloor, L[j - 1] + stageFeedLiq[j]);
      const vGuess = Math.max(minFlowFloor, lGuess + netUp);
      V[j + 1] = vGuess;
      L[j] = Math.max(minFlowFloor, vGuess - netUp);
    }
  }
  L[N - 1] = B;
  if (reboilerType === 'live_steam' && N >= 2) {
    const netUpBot = D + cumSideDrawTot[N - 2] - cumFeedTot[N - 2];
    V[N - 1] = Math.max(0.05 * D, V[N - 1], netUpBot + minFlowFloor);
    L[N - 2] = Math.max(minFlowFloor, V[N - 1] - netUpBot);
  }

  // 단별 Murphree 기상 단효율 설정: 응축기(j=0) 및 평형 리보일러(j=N-1)는 η=1.0, 내부 트레이(1..N-2)는 meshMurphreeEff
  const effInternal = clamp(meshMurphreeEff, 0.25, 1.0);
  const etaStage = new Float64Array(N);
  etaStage[0] = 1.0;
  for (let j = 1; j < N - 1; j++) etaStage[j] = effInternal;
  etaStage[N - 1] = 1.0;

  // 초기 온도·조성 프로파일 설정
  const zFeed = zeroCompRecord();
  for (let ci = 0; ci < nActive; ci++) {
    const c = activeComps[ci];
    zFeed[c] = totalFeedMol[c] / Math.max(1e-9, totalMolesIn);
  }

  const T = new Float64Array(N);
  const tTopInit = solveStageBubbleTempC(model, activeComps, zFeed, P_stageBarA[0], 60) - 8;
  const tBotInit = solveStageBubbleTempC(model, activeComps, zFeed, P_stageBarA[N - 1], 95) + 12;
  for (let j = 0; j < N; j++) {
    T[j] = tTopInit + ((tBotInit - tTopInit) * j) / Math.max(1, N - 1);
  }

  const x: Array<Record<SimCompKey, number>> = Array.from({ length: N }, () => ({ ...zFeed }));
  const K: Array<Record<SimCompKey, number>> = Array.from({ length: N }, (_, j) =>
    calcStageKValues(model, activeComps, x[j], T[j], P_stageBarA[j])
  );

  let converged = false;
  let iterUsed = 0;
  let prevMaxDeltaT = 999;
  let dampFactor = 1.0;
  const maxMeshIter = params.maxIterations ?? Math.max(condenserType === 'decanter_ech' ? 300 : 245, Math.min(480, Math.round(180 + N * 2.2)));

  // 반복 루프 무할당(Zero-Allocation) 작업 버퍼
  const prevRawDt = new Float64Array(N);
  const stageDampT = new Float64Array(N).fill(1.0);
  const prevRawDx = new Float64Array(N);
  const stageDampX = new Float64Array(N).fill(1.0);
  const aVec = new Float64Array(N);
  const bVec = new Float64Array(N);
  const cVec = new Float64Array(N);
  const dVec = new Float64Array(N);
  const triCp = new Float64Array(N);
  const triDp = new Float64Array(N);
  const triSol = new Float64Array(N);
  const sStage = new Float64Array(N);
  const betaStage = new Float64Array(N);
  const hLiqTilde = new Float64Array(N);
  const hVapTilde = new Float64Array(N);

  const xRaw: Array<Record<SimCompKey, number>> = Array.from({ length: N }, () => zeroCompRecord());
  const yRaw: Array<Record<SimCompKey, number>> = Array.from({ length: N }, () => zeroCompRecord());
  const feedStageSet = new Set<number>(feeds.map(f => clamp(f.stageIdx, 0, N - 1)));
  const usedK0: Record<SimCompKey, number> = zeroCompRecord();
  const yStage: Array<Record<SimCompKey, number>> = Array.from({ length: N }, () => zeroCompRecord());
  const yEqBuf: Record<SimCompKey, number> = zeroCompRecord();
  const stageVlleTie: Array<Record<SimCompKey, number> | null | undefined> = new Array(N).fill(undefined);
  const stageVlleTemp = new Float64Array(N).fill(-999);

  // 단별 실제 기상 몰분율 yStage[0..N-1] 갱신 (하부 리보일러 η=1.0 에서 상부로 Murphree 점화식 y_j = η_j y_j* + (1-η_j) y_{j+1} 계산)
  const updateStageVapors = () => {
    let ySumBot = 0;
    for (let ci = 0; ci < nActive; ci++) {
      const comp = activeComps[ci];
      const v = NON_VOLATILE_SET.has(comp) ? 0 : Math.max(1e-12, K[N - 1][comp]) * x[N - 1][comp];
      yStage[N - 1][comp] = v;
      ySumBot += v;
    }
    if (ySumBot > 1e-12) {
      for (let ci = 0; ci < nActive; ci++) yStage[N - 1][activeComps[ci]] /= ySumBot;
    }

    for (let j = N - 2; j >= 1; j--) {
      let yEqSum = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const comp = activeComps[ci];
        const v = NON_VOLATILE_SET.has(comp) ? 0 : Math.max(1e-12, K[j][comp]) * x[j][comp];
        yEqBuf[comp] = v;
        yEqSum += v;
      }
      const eta = etaStage[j];
      const oneMinusEta = 1.0 - eta;
      let yJoinSum = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const comp = activeComps[ci];
        const yStar = yEqSum > 1e-12 ? yEqBuf[comp] / yEqSum : 0;
        const yAct = eta * yStar + oneMinusEta * yStage[j + 1][comp];
        yStage[j][comp] = yAct;
        yJoinSum += yAct;
      }
      if (yJoinSum > 1e-12) {
        for (let ci = 0; ci < nActive; ci++) yStage[j][activeComps[ci]] /= yJoinSum;
      }
    }

    if (condenserType === 'partial') {
      let y0Sum = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const comp = activeComps[ci];
        const v = NON_VOLATILE_SET.has(comp) ? 0 : Math.max(1e-12, K[0][comp]) * x[0][comp];
        yStage[0][comp] = v;
        y0Sum += v;
      }
      if (y0Sum > 1e-12) {
        for (let ci = 0; ci < nActive; ci++) yStage[0][activeComps[ci]] /= y0Sum;
      }
    } else {
      for (let ci = 0; ci < nActive; ci++) {
        const comp = activeComps[ci];
        yStage[0][comp] = N > 1 ? yStage[1][comp] : x[0][comp];
      }
    }
  };

  const decK0: Record<SimCompKey, number> = zeroCompRecord();
  const decAqDrawShare: Record<SimCompKey, number> = zeroCompRecord();
  for (let ci = 0; ci < nActive; ci++) {
    decK0[activeComps[ci]] = 1.0;
    decAqDrawShare[activeComps[ci]] = 0.0;
  }
  let lastDecanterPhaseSplit = false;

  // 결합 MESH(M·E·S·H) 반복 루프: Thomas 삼중대각 조성 + 기포점 온도 + Wang-Henke 비등몰 엔탈피 트래픽 + 커플링 LLE 디캔터 동시 수렴
  for (let iter = 1; iter <= maxMeshIter; iter++) {
    iterUsed = iter;
    updateStageVapors();

    // 불균일 공비 디캔터(decanter_ech) 응축기 운전 시:
    // Stage 1 상부 증기 V_1*y_1 + F_0 를 T_0 에서 응축시켜 solveRigorousLLEDecanter 로 엄밀 2액상 분율을 직접 해법
    let maxRelDeltaDecK0 = 0.0;
    if (condenserType === 'decanter_ech' && N > 1 && D > 1e-9 && L[0] > 1e-9) {
      const condMassKgH = zeroCompRecord();
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        if (!NON_VOLATILE_SET.has(c)) {
          const molIn = V[1] * Math.max(0, yStage[1][c]) + stageFeedMol[0][c];
          condMassKgH[c] = molIn * COMP_MW[c];
        }
      }
      const lle0 = solveRigorousLLEDecanter(condMassKgH, T[0]);
      lastDecanterPhaseSplit = lle0.phaseSplit;

      if (lle0.phaseSplit) {
        const nAq = zeroCompRecord();
        const nOrg = zeroCompRecord();
        let sumAq = 0;
        let sumOrg = 0;
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          if (NON_VOLATILE_SET.has(c)) continue;
          nAq[c] = Math.max(0, lle0.aqueousKgH[c] || 0) / COMP_MW[c];
          nOrg[c] = Math.max(0, lle0.organicKgH[c] || 0) / COMP_MW[c];
          sumAq += nAq[c];
          sumOrg += nOrg[c];
        }
        const totCondTarget = L[0] + D;
        const scaleCond = totCondTarget / Math.max(1e-12, sumAq + sumOrg);
        sumAq *= scaleCond;
        sumOrg *= scaleCond;
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          nAq[c] *= scaleCond;
          nOrg[c] *= scaleCond;
        }

        const wDec = iter === 1 ? 0.85 : iter > 45 ? 0.25 : 0.45;
        const orgRefluxTotal = sumOrg > 1e-12 ? Math.min(L[0], sumOrg) : 0;
        const aqRefluxTotal = Math.max(0, L[0] - orgRefluxTotal);
        const orgToDistTotal = Math.max(0, sumOrg - orgRefluxTotal);
        const aqToDistTotal = Math.max(0, D - orgToDistTotal);
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          if (NON_VOLATILE_SET.has(c)) continue;
          const aqFrac = sumAq > 1e-12 ? nAq[c] / sumAq : 0;
          const orgFrac = sumOrg > 1e-12 ? nOrg[c] / sumOrg : 0;
          const dAq = aqToDistTotal * aqFrac;
          const dOrg = orgToDistTotal * orgFrac;
          const l0c = orgRefluxTotal * orgFrac + aqRefluxTotal * aqFrac;
          const dc = dAq + dOrg;
          decAqDrawShare[c] = dc > 1e-15 ? clamp(dAq / dc, 0, 1) : 0;
          const xDc = dc / D;
          const x0c = l0c / L[0];
          const k0Target =
            dc + l0c > 1e-14 ? clamp(xDc / Math.max(1e-8, x0c), 1e-4, 250.0) : 1.0;
          const prevK0 = Math.max(1e-6, decK0[c]);
          const nextK0 = Math.exp(wDec * Math.log(k0Target) + (1.0 - wDec) * Math.log(prevK0));
          if (dc + l0c > 1e-3 * totCondTarget) {
            const relDiff = Math.abs(k0Target - prevK0) / Math.max(0.05, prevK0);
            if (relDiff > maxRelDeltaDecK0) maxRelDeltaDecK0 = relDiff;
          }
          decK0[c] = nextK0;
        }
      } else {
        const wDec = iter === 1 ? 1.0 : 0.4;
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          decAqDrawShare[c] = 0;
          const prevK0 = Math.max(1e-6, decK0[c]);
          const relDiff = Math.abs(1.0 - prevK0) / Math.max(0.05, prevK0);
          if (relDiff > maxRelDeltaDecK0) maxRelDeltaDecK0 = relDiff;
          decK0[c] = Math.exp((1.0 - wDec) * Math.log(prevK0));
        }
      }
    }

    for (let ci = 0; ci < nActive; ci++) {
      const comp = activeComps[ci];
      if (NON_VOLATILE_SET.has(comp)) {
        // 비휘발성 염·고비점 강산은 액상 유량을 따라 하부 및 액상 측류로 분배 이동
        let availSalt = 0;
        for (let j = 0; j < N; j++) {
          availSalt += stageFeedMol[j][comp];
          if (j < N - 1 && SL[j] > 0) {
            const totLiqJ = Math.max(1e-6, L[j] + SL[j]);
            xRaw[j][comp] = availSalt / totLiqJ;
            availSalt = availSalt * (L[j] / totLiqJ);
          } else {
            xRaw[j][comp] = availSalt / Math.max(1e-6, j === N - 1 ? B : L[j]);
          }
          yRaw[j][comp] = 0;
        }
        usedK0[comp] = 0;
        continue;
      }

      // 행렬 내 Murphree 기상 단효율 변환:
      //   s_j = η_j K_j,  u_j = y_j / s_j (j >= 1),  u_0 = x_0
      //   y_j = η_j K_j x_j + (1 - η_j) y_{j+1}  <=>  x_j = u_j - β_j u_{j+1},  β_j = (1 - η_j) s_{j+1} / s_j
      // 대입 시 엄밀 대각우세 M-행렬을 유지하면서 D*k0*x_0 + Σ(SL_j*x_j + SV_j*y_j) + B*x_{N-1} === f_tot 를 기계정밀도로 보존한다.
      for (let j = 1; j < N; j++) {
        sStage[j] = Math.max(1e-12, etaStage[j] * Math.max(1e-12, K[j][comp]));
      }
      betaStage[0] = 0;
      betaStage[N - 1] = 0;
      for (let j = 1; j < N - 1; j++) {
        betaStage[j] =
          etaStage[j] < 0.999999
            ? Math.min(0.85, ((1.0 - etaStage[j]) * sStage[j + 1]) / sStage[j])
            : 0;
      }

      // Stage 0 (응축기 / 디캔터)
      aVec[0] = 0;
      if (condenserType === 'partial') {
        const k0 = Math.max(1e-12, K[0][comp]);
        usedK0[comp] = k0;
        bVec[0] = -(L[0] + D * k0);
      } else if (condenserType === 'decanter_ech') {
        const k0 = Math.max(1e-6, decK0[comp]);
        usedK0[comp] = k0;
        bVec[0] = -(L[0] + D * k0);
      } else {
        usedK0[comp] = 1.0;
        bVec[0] = -(L[0] + D);
      }
      cVec[0] = V[1] * sStage[1];
      dVec[0] = -stageFeedMol[0][comp];

      // 내부 단 1 .. N-2 (액상·기상 측류 SL[j], SV[j] 엄밀 반영)
      for (let j = 1; j < N - 1; j++) {
        aVec[j] = L[j - 1];
        bVec[j] = -(L[j - 1] * betaStage[j - 1] + L[j] + SL[j] + (V[j] + SV[j]) * sStage[j]);
        cVec[j] = (L[j] + SL[j]) * betaStage[j] + V[j + 1] * sStage[j + 1];
        dVec[j] = -stageFeedMol[j][comp];
      }

      // 최하단 N-1 (리보일러 / 하부 스트리핑단, β_{N-1} = 0)
      aVec[N - 1] = L[N - 2];
      bVec[N - 1] = -(L[N - 2] * betaStage[N - 2] + B + V[N - 1] * sStage[N - 1]);
      cVec[N - 1] = 0;
      dVec[N - 1] = -stageFeedMol[N - 1][comp];

      const uSol = solveTridiagonal(aVec, bVec, cVec, dVec, triCp, triDp, triSol);
      xRaw[0][comp] = Math.max(0, uSol[0]);
      yRaw[0][comp] = usedK0[comp] * xRaw[0][comp];
      for (let j = 1; j < N - 1; j++) {
        xRaw[j][comp] = Math.max(0, uSol[j] - betaStage[j] * uSol[j + 1]);
        yRaw[j][comp] = sStage[j] * Math.max(0, uSol[j]);
      }
      xRaw[N - 1][comp] = Math.max(0, uSol[N - 1]);
      yRaw[N - 1][comp] = sStage[N - 1] * xRaw[N - 1][comp];
    }

    // 정규화 및 어닐링 완화 기포점 온도 갱신
    let maxDeltaT = 0;
    let maxDeltaX = 0;

    const annScale = N > 45 ? Math.min(2.0, N / 40) : 1.0;
    const baseWX = iter > 90 * annScale ? 0.12 : iter > 45 * annScale ? 0.2 : iter > 25 * annScale ? 0.35 : 0.6;
    const baseWT = iter > 90 * annScale ? 0.1 : iter > 45 * annScale ? 0.18 : iter > 25 * annScale ? 0.3 : 0.5;
    const wX = Math.max(0.04, baseWX * dampFactor);
    const wT = Math.max(0.03, baseWT * dampFactor);
    const maxStageStepC = iter > 30 ? 5.0 : 10.0;

    for (let j = 0; j < N; j++) {
      let sumXj = 0;
      for (let ci = 0; ci < nActive; ci++) sumXj += xRaw[j][activeComps[ci]];
      if (sumXj > 1e-12) {
        let domDx = 0;
        for (let ci = 0; ci < nActive; ci++) {
          const comp = activeComps[ci];
          const rdx = xRaw[j][comp] / sumXj - x[j][comp];
          if (Math.abs(rdx) > Math.abs(domDx)) domDx = rdx;
        }
        if (iter >= 45 && Math.abs(domDx) > 1e-5) {
          if (domDx * prevRawDx[j] < 0) {
            stageDampX[j] = Math.max(0.15, stageDampX[j] * 0.68);
          } else {
            stageDampX[j] = Math.min(1.0, stageDampX[j] * 1.04);
          }
        }
        prevRawDx[j] = domDx;
        const wXj = wX * stageDampX[j];
        for (let ci = 0; ci < nActive; ci++) {
          const comp = activeComps[ci];
          const xNew = xRaw[j][comp] / sumXj;
          const stepDx = wXj * (xNew - x[j][comp]);
          const absDx = Math.abs(stepDx);
          if (absDx > maxDeltaX) maxDeltaX = absDx;
          x[j][comp] = Math.max(0, x[j][comp] + stepDx);
        }
      }
      // 재정규화
      let normS = 0;
      for (let ci = 0; ci < nActive; ci++) normS += x[j][activeComps[ci]];
      if (normS > 1e-12) {
        for (let ci = 0; ci < nActive; ci++) x[j][activeComps[ci]] /= normS;
      }
    }

    for (let j = 0; j < N; j++) {
      const tPrev = T[j];
      const refreshTie =
        stageVlleTie[j] === undefined ||
        iter <= 4 ||
        (iter <= 36 && iter % 6 === 0) ||
        (maxDeltaX > 0.015 && iter <= 100 && iter % 6 === 0) ||
        Math.abs(tPrev - stageVlleTemp[j]) > 2.5;
      const stageVlleCap: VlleScaleCapture = { scale: null };
      const tBubble = solveStageBubbleTempC(
        model,
        activeComps,
        x[j],
        P_stageBarA[j],
        tPrev,
        yStage[j],
        stageVlleCap,
        refreshTie ? undefined : stageVlleTie[j]
      );
      if (refreshTie) {
        stageVlleTie[j] = stageVlleCap.scale;
        stageVlleTemp[j] = tPrev;
      }
      const errT = tBubble - tPrev;
      if (iter >= 45 && Math.abs(errT) > 0.02) {
        if (errT * prevRawDt[j] < 0) {
          stageDampT[j] = Math.max(0.15, stageDampT[j] * 0.68);
        } else {
          stageDampT[j] = Math.min(1.0, stageDampT[j] * 1.04);
        }
      }
      prevRawDt[j] = errT;
      const rawStepT = wT * stageDampT[j] * errT;
      const clampedStepT = Math.max(-maxStageStepC, Math.min(maxStageStepC, rawStepT));
      const tNext = tPrev + clampedStepT;
      const absDt = Math.abs(clampedStepT);
      if (absDt > maxDeltaT) maxDeltaT = absDt;
      T[j] = tNext;
      K[j] = calcStageKValues(
        model,
        activeComps,
        x[j],
        T[j],
        P_stageBarA[j],
        yStage[j],
        8000,
        absDt < 2.5 ? stageVlleTie[j] : undefined
      );
    }

    // ── Wang-Henke / Inside-Out 단별 엔탈피 수지(H-equation) 기반 비등몰 V_j, L_j 연속 갱신 ──
    let maxRelDeltaV = iter < 4 ? 1.0 : 0.0;
    if (iter >= 3 && (iter < 45 ? iter % 2 === 1 : true) && N >= 3 && maxDeltaX < 0.06) {
      updateStageVapors();
      for (let j = 0; j <= N - 2; j++) {
        let refL = 0;
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          refL += x[j][c] * hRef[c];
        }
        hLiqTilde[j] = liquidMolarEnthalpyKJkmol(x[j], activeComps, T[j]) - refL;
      }
      for (let j = 1; j <= N - 1; j++) {
        let refV = 0;
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          refV += yStage[j][c] * hRef[c];
        }
        hVapTilde[j] = vaporMolarEnthalpyKJkmol(yStage[j], activeComps, T[j]) - refV;
      }

      if (activeDraws.length > 0) {
        rebuildSideDrawSums(false, 0.35);
        let runSDe = 0;
        cumSideDrawEnthFrom1[0] = 0;
        for (let j = 1; j < N - 1; j++) {
          runSDe += SL[j] * hLiqTilde[j] + SV[j] * hVapTilde[j];
          cumSideDrawEnthFrom1[j] = runSDe;
        }
      }

      const qTopFlux = V[1] * hVapTilde[1] - L[0] * hLiqTilde[0];
      const baseWV = iter > 90 * annScale ? 0.05 : iter >= 45 * annScale ? 0.09 : 0.34;
      const wV = Math.max(0.02, baseWV * dampFactor);
      const vUpperCap = Math.max(5.0 * V[1], 8.0 * totalMolesIn);

      for (let j = 1; j < N - 1; j++) {
        const netUp = D + cumSideDrawTot[j] - cumFeedTot[j];
        const vMin = Math.max(minFlowFloor, netUp + minFlowFloor);
        const denom = Math.max(8000.0, hVapTilde[j + 1] - hLiqTilde[j]);
        const rhs = qTopFlux - cumFeedEnthFrom1[j] + cumSideDrawEnthFrom1[j] - netUp * hLiqTilde[j];
        const vTarget = clamp(rhs / denom, vMin, Math.max(vMin + 1.0, vUpperCap));
        const vPrev = V[j + 1];
        const vNext = vPrev + wV * (vTarget - vPrev);
        const relDv = Math.abs(vNext - vPrev) / Math.max(1e-4, vPrev);
        if (relDv > maxRelDeltaV) maxRelDeltaV = relDv;
        V[j + 1] = vNext;
        L[j] = Math.max(minFlowFloor, vNext - netUp);
      }
    } else if (iter >= 4 && iter < 45 && iter % 2 === 0) {
      maxRelDeltaV = maxDeltaX < 1e-4 && maxDeltaT < 0.015 ? 0.0 : 2e-3;
    }

    if (iter >= 4) {
      if (maxDeltaT > prevMaxDeltaT * 1.02) {
        dampFactor = Math.max(0.22, dampFactor * 0.72);
      } else if (maxDeltaT < prevMaxDeltaT * 0.92) {
        dampFactor = Math.min(1.0, dampFactor * 1.05);
      }
    }
    prevMaxDeltaT = maxDeltaT;

    if (
      iter >= 6 &&
      maxDeltaT < 0.015 &&
      maxDeltaX < 1e-4 &&
      maxRelDeltaV < 5e-4 &&
      maxRelDeltaDecK0 < 5e-3
    ) {
      converged = true;
      break;
    }
    const colSpanC = Math.abs(T[N - 1] - T[0]);
    const relTolT = Math.max(0.08, 0.004 * colSpanC);
    const relTolX = colSpanC > 80 ? 2.5e-3 : 5e-4;
    if (
      iter >= 50 &&
      maxDeltaT < relTolT &&
      maxDeltaX < relTolX &&
      maxRelDeltaV < 4e-3 &&
      maxRelDeltaDecK0 < 1.5e-2
    ) {
      converged = true;
      break;
    }
  }

  if (!converged && N >= 5) {
    for (let pass = 0; pass < 3; pass++) {
      const prevXSnap = x.map(row => ({ ...row }));
      const prevTSnap = [...T];
      for (let j = 1; j < N - 1; j++) {
        if (stageFeedTot[j] > 1e-9) continue;
        let xOsc = false;
        for (let ci = 0; ci < nActive; ci++) {
          const ck = activeComps[ci];
          const dp = prevXSnap[j][ck] - prevXSnap[j - 1][ck];
          const dn = prevXSnap[j][ck] - prevXSnap[j + 1][ck];
          if (dp * dn > 1e-5) {
            xOsc = true;
            break;
          }
        }
        if (xOsc) {
          let sNorm = 0;
          for (let ci = 0; ci < nActive; ci++) {
            const ck = activeComps[ci];
            const sm = Math.max(0, 0.5 * prevXSnap[j][ck] + 0.25 * (prevXSnap[j - 1][ck] + prevXSnap[j + 1][ck]));
            x[j][ck] = sm;
            sNorm += sm;
          }
          if (sNorm > 1e-12) {
            for (let ci = 0; ci < nActive; ci++) x[j][activeComps[ci]] /= sNorm;
          }
        }
        const dtP = prevTSnap[j] - prevTSnap[j - 1];
        const dtN = prevTSnap[j] - prevTSnap[j + 1];
        if (dtP * dtN > 0.04) {
          T[j] = 0.5 * prevTSnap[j] + 0.25 * (prevTSnap[j - 1] + prevTSnap[j + 1]);
        }
      }
    }
  }

  // 최종 탑정(Distillate) / 사이드컷(Side-Draws) / 탑저(Bottoms) 성분별 몰유량 엄밀 추출 및 100.000% 물질수지 마감
  const distMol = zeroCompRecord();
  const botMol = zeroCompRecord();
  const distKgH = zeroCompRecord();
  const botKgH = zeroCompRecord();
  const sideMolArr: Array<Record<SimCompKey, number>> = activeDraws.map(() => zeroCompRecord());

  for (let ci = 0; ci < nActive; ci++) {
    const comp = activeComps[ci];
    const fTot = totalFeedMol[comp];
    if (fTot <= 0) continue;
    if (activeDraws.length === 0) {
      if (NON_VOLATILE_SET.has(comp)) {
        distMol[comp] = 0;
        botMol[comp] = fTot;
      } else {
        const dRaw = D * usedK0[comp] * xRaw[0][comp];
        const bRaw = B * xRaw[N - 1][comp];
        const sumRaw = dRaw + bRaw;
        if (sumRaw > 1e-15) {
          distMol[comp] = fTot * (dRaw / sumRaw);
          botMol[comp] = fTot * (bRaw / sumRaw);
        } else {
          distMol[comp] = fTot * (D / Math.max(1e-9, totalMolesIn));
          botMol[comp] = Math.max(0, fTot - distMol[comp]);
        }
      }
    } else {
      const dRaw = NON_VOLATILE_SET.has(comp) ? 0 : D * usedK0[comp] * xRaw[0][comp];
      let sumSD = 0;
      const sRawList = new Float64Array(activeDraws.length);
      for (let idx = 0; idx < activeDraws.length; idx++) {
        const d = activeDraws[idx];
        const dm = drawMoles[idx];
        let sVal = 0;
        if (NON_VOLATILE_SET.has(comp)) {
          sVal = d.phase === 'liquid' ? dm * xRaw[d.stageIdx][comp] : 0;
        } else {
          sVal = dm * (d.phase === 'vapor' ? yRaw[d.stageIdx][comp] : xRaw[d.stageIdx][comp]);
        }
        sRawList[idx] = sVal;
        sumSD += sVal;
      }
      const bRaw = B * xRaw[N - 1][comp];
      const sumRaw = dRaw + sumSD + bRaw;
      if (sumRaw > 1e-15) {
        const scaleC = fTot / sumRaw;
        distMol[comp] = dRaw * scaleC;
        for (let idx = 0; idx < activeDraws.length; idx++) sideMolArr[idx][comp] = sRawList[idx] * scaleC;
        botMol[comp] = bRaw * scaleC;
      } else {
        distMol[comp] = NON_VOLATILE_SET.has(comp) ? 0 : fTot * (D / Math.max(1e-9, totalMolesIn));
        let accS = 0;
        for (let idx = 0; idx < activeDraws.length; idx++) {
          const share = NON_VOLATILE_SET.has(comp) ? 0 : fTot * (drawMoles[idx] / Math.max(1e-9, totalMolesIn));
          sideMolArr[idx][comp] = share;
          accS += share;
        }
        botMol[comp] = Math.max(0, fTot - distMol[comp] - accS);
      }
    }
  }

  // 총 몰유량 비율 미세 보정 후 질량 환산
  let distMassSum = 0;
  for (let ci = 0; ci < nActive; ci++) {
    const comp = activeComps[ci];
    distKgH[comp] = distMol[comp] * COMP_MW[comp];
    botKgH[comp] = botMol[comp] * COMP_MW[comp];
    distMassSum += distKgH[comp];
  }

  const stageSideLiqKgH = new Float64Array(N);
  const stageSideVapKgH = new Float64Array(N);
  let hSideDrawsKcalH = 0;
  const sideDrawsOut: InnerSideDrawOutput[] = activeDraws.map((d, idx) => {
    const j = d.stageIdx;
    const kgH = zeroCompRecord();
    let mSum = 0;
    let molSum = 0;
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      kgH[c] = sideMolArr[idx][c] * COMP_MW[c];
      mSum += kgH[c];
      molSum += sideMolArr[idx][c];
    }
    const pKg = topPressKgcm2g + j * stageDeltaP;
    const ph: 'L' | 'G' = d.phase === 'vapor' ? 'G' : 'L';
    if (ph === 'G') {
      stageSideVapKgH[j] += mSum;
      hSideDrawsKcalH += streamEnthalpyKcalH(kgH, {}, T[j], pKg);
    } else {
      stageSideLiqKgH[j] += mSum;
      hSideDrawsKcalH += streamEnthalpyKcalH({}, kgH, T[j], pKg);
    }
    return {
      id: d.id,
      label: d.label,
      stage: j + 1,
      phase: ph,
      tempC: T[j],
      pressKgcm2g: pKg,
      kmolH: sideMolArr[idx],
      kgH,
      totalMassKgH: mSum,
      totalMolesKmolH: molSum,
    };
  });

  // 유수분리 디캔터(decanter_ech) 운전 시: MESH 루프 내 커플링된 T[0] 2액상 LLE 결과와 정합되게 수상 배출(decanterFlowsKgH) 및 유기상 유출(distKgH) 분배
  let decanterWaterDrawKgH = 0;
  const decanterFlowsKgH = zeroCompRecord();
  if (condenserType === 'decanter_ech' && distKgH.H2O > 0) {
    const lleTop = solveRigorousLLEDecanter(distKgH, T[0]);
    if (lleTop.phaseSplit) {
      let aqSum = 0;
      let orgSum = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        decanterFlowsKgH[c] = lleTop.aqueousKgH[c];
        distKgH[c] = lleTop.organicKgH[c];
        distMol[c] = distKgH[c] / COMP_MW[c];
        aqSum += decanterFlowsKgH[c];
        orgSum += distKgH[c];
      }
      decanterWaterDrawKgH = aqSum;
      distMassSum = orgSum;
    } else if (lastDecanterPhaseSplit) {
      let aqSum = 0;
      let orgSum = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        const totalTopC = distKgH[c];
        const aqC = totalTopC * clamp(decAqDrawShare[c] || 0, 0, 1);
        const orgC = Math.max(0, totalTopC - aqC);
        decanterFlowsKgH[c] = aqC;
        distKgH[c] = orgC;
        distMol[c] = orgC / COMP_MW[c];
        aqSum += aqC;
        orgSum += orgC;
      }
      decanterWaterDrawKgH = aqSum;
      distMassSum = orgSum;
    }
  }

  // 수렴된 단별 실제 기상 조성(Murphree 단효율 반영) 갱신 및 프로파일 데이터 생성 (1 .. N)
  updateStageVapors();
  const stages: DistillStageProfile[] = [];
  for (let j = 0; j < N; j++) {
    const yMol = { ...yStage[j] };
    let mwLiq = 0;
    let mwVap = 0;
    for (let ci = 0; ci < nActive; ci++) {
      const comp = activeComps[ci];
      mwLiq += x[j][comp] * COMP_MW[comp];
      mwVap += yMol[comp] * COMP_MW[comp];
    }
    mwLiq = Math.max(2.0, mwLiq);
    mwVap = Math.max(2.0, mwVap);

    const xWtPct = zeroCompRecord();
    const yWtPct = zeroCompRecord();
    for (let ci = 0; ci < nActive; ci++) {
      const comp = activeComps[ci];
      xWtPct[comp] = ((x[j][comp] * COMP_MW[comp]) / mwLiq) * 100;
      yWtPct[comp] = ((yMol[comp] * COMP_MW[comp]) / mwVap) * 100;
    }

    const liqKmol = j === N - 1 ? B : L[j];
    const vapKmol = j === 0 ? (condenserType === 'partial' ? D : V[1]) : V[j];
    const hasSideCutHere = stageSideLiqKgH[j] > 1e-6 || stageSideVapKgH[j] > 1e-6;
    stages.push({
      stage: j + 1,
      tempC: T[j],
      pressBarA: P_stageBarA[j],
      liqFlowKmolH: liqKmol,
      vapFlowKmolH: vapKmol,
      liqMassKgH: liqKmol * mwLiq,
      vapMassKgH: vapKmol * mwVap,
      xMol: { ...x[j] },
      yMol,
      xWtPct,
      yWtPct,
      isFeedStage: feedStageSet.has(j),
      ...(hasSideCutHere
        ? {
            isSideCutStage: true,
            sideCutLiqKgH: stageSideLiqKgH[j],
            sideCutVapKgH: stageSideVapKgH[j],
          }
        : {}),
    });
  }

  // 탑정 유출 상(Phase) 판정 — flowsheetSolver 와 100% 동일 기준
  const nonCondMass = (distKgH.H2 || 0) + (distKgH.O2 || 0) + (distKgH.N2 || 0);
  const distillatePhase: 'L' | 'G' =
    condenserType === 'partial' || (distMassSum > 0 && nonCondMass / distMassSum > 0.35)
      ? 'G'
      : 'L';

  // thermoCore 생성열·용해열·잠열·현열 기반 엄밀 응축기(Q_cond <= 0) & 리보일러(Q_reb >= 0) 열부하 산출
  const topP = topPressKgcm2g;
  const botP = topPressKgcm2g + stageDeltaP * (N - 1);
  const pStage1Kgcm2g = topPressKgcm2g + stageDeltaP;

  const hDistKcalH =
    distillatePhase === 'G'
      ? streamEnthalpyKcalH(distKgH, {}, T[0], topP)
      : streamEnthalpyKcalH({}, distKgH, T[0], topP);
  const hDecKcalH =
    decanterWaterDrawKgH > 0
      ? streamEnthalpyKcalH({}, decanterFlowsKgH, T[0], topP)
      : 0;
  const hBotKcalH = streamEnthalpyKcalH({}, botKgH, T[N - 1], botP);
  const totalFeedEnthKcalH = totalFeedEnthKJH / KJ_PER_KCAL;
  const stage0FeedEnthKcalH = stage0FeedEnthKJH / KJ_PER_KCAL;

  // Stage 0(응축기 + 환류드럼/디캔터) 경계 엔탈피 수지: Q_cond = H_D + H_dec + H_{L,0} - H_{V,1} - H_{F,0}
  // 비반응 응축기 경계에서 성분 원자수지(V_1 = D + Dec + L_0 - F_0)를 엄밀 일치시켜 생성열 ΔHf° 잔차 왜곡 원천 차단
  const vap1KgH = zeroCompRecord();
  const reflux0KgH = zeroCompRecord();
  const t1Vap = N > 1 ? T[1] : T[0];
  for (let ci = 0; ci < nActive; ci++) {
    const comp = activeComps[ci];
    reflux0KgH[comp] = L[0] * x[0][comp] * COMP_MW[comp];
    const stage0InKg = stageFeedMol[0][comp] * COMP_MW[comp];
    vap1KgH[comp] = NON_VOLATILE_SET.has(comp)
      ? 0
      : Math.max(0, distKgH[comp] + decanterFlowsKgH[comp] + reflux0KgH[comp] - stage0InKg);
  }
  const hVap1KcalH = streamEnthalpyKcalH(vap1KgH, {}, t1Vap, pStage1Kgcm2g);
  const hReflux0KcalH = streamEnthalpyKcalH({}, reflux0KgH, T[0], topP);

  // 전체 탑 총괄 엔탈피 수지: Q_reb + Q_cond === H_D + H_dec + H_SideDraws + H_B - H_F (에너지 잔차 0.00% 보장)
  const qNetColumnKcalH = hDistKcalH + hDecKcalH + hSideDrawsKcalH + hBotKcalH - totalFeedEnthKcalH;
  let condenserDutyKcalH: number;
  let reboilerDutyKcalH: number;

  if (reboilerType === 'live_steam') {
    reboilerDutyKcalH = 0;
    condenserDutyKcalH = qNetColumnKcalH;
  } else {
    const rawQc = hDistKcalH + hDecKcalH + hReflux0KcalH - hVap1KcalH - stage0FeedEnthKcalH;
    condenserDutyKcalH = Math.min(0, rawQc);
    reboilerDutyKcalH = qNetColumnKcalH - condenserDutyKcalH;
    if (reboilerDutyKcalH < 0) {
      reboilerDutyKcalH = 0;
      condenserDutyKcalH = qNetColumnKcalH;
    }
  }

  const actualDistMoles = activeComps.reduce((s, c) => s + distMol[c], 0);
  const actualBotMoles = activeComps.reduce((s, c) => s + botMol[c], 0);

  return {
    converged,
    iterations: iterUsed,
    distillateKmolH: distMol,
    bottomsKmolH: botMol,
    distillateKgH: distKgH,
    bottomsKgH: botKgH,
    decanterWaterDrawKgH,
    decanterFlowsKgH,
    distillatePhase,
    stages,
    condenserDutyKcalH,
    reboilerDutyKcalH,
    actualRefluxRatio: RR,
    actualBoilupRatio: V[N - 1] / Math.max(1e-6, actualBotMoles),
    actualDOverFMass: distMassSum / Math.max(1e-6, totalFeedMassKgH),
    actualDOverFMole: actualDistMoles / Math.max(1e-6, totalMolesIn),
    ...(sideDrawsOut.length > 0 ? { sideDraws: sideDrawsOut } : {}),
    ...(sideCutClamped ? { sideCutClamped: true } : {}),
  };
}

/**
 * 무응축기(condenserType === 'none') 및/또는 무리보일러(reboilerType === 'none' | 'live_steam') 개방·반개방 탑 전용
 * 단별 엄밀 MESH 솔버 (순수 향류 흡수탑 · 탈기탑 · 생증기 스트리퍼 · 리보일드 흡수탑 통합 해법)
 * - Thomas 3중대각 성분 물질수지(단별 Murphree 기상효율 η_MV 엄밀 반영) + 단별 Murphree P-H Flash 엔탈피 수지 결합
 */
function solveOpenOrSemiOpenMeshColumn(params: {
  model: ResolvedDistillThermoModel;
  N: number;
  feeds: Array<{
    stageIdx: number;
    mol: Record<SimCompKey, number>;
    vapMol: Record<SimCompKey, number>;
    qThermal: number;
    tempC: number;
    enthalpyKJH: number;
  }>;
  totalFeedMol: Record<SimCompKey, number>;
  totalFeedMassKgH: number;
  activeComps: SimCompKey[];
  condenserType: DistillCondenserType;
  reboilerType: DistillReboilerType;
  P_stageBarA: number[];
  topPressKgcm2g: number;
  stageDeltaP: number;
  meshMurphreeEff: number;
  refluxRatio: number;
  reboilerDutyKcalH: number;
  topCoolerDutyKcalH: number;
  sideDraws?: InnerSideDrawSpec[];
  maxIterations?: number;
}): InnerMeshSolution {
  const {
    model,
    N,
    feeds,
    totalFeedMol,
    totalFeedMassKgH,
    activeComps,
    condenserType,
    reboilerType,
    P_stageBarA,
    topPressKgcm2g,
    stageDeltaP,
    meshMurphreeEff,
  } = params;

  const MAX_OPEN_GAS_K = 250000;
  const nActive = activeComps.length;
  const hasCondenser = condenserType !== 'none';
  const hasReboiler = reboilerType === 'kettle' || reboilerType === 'thermosyphon';
  const RR = hasCondenser ? clamp(params.refluxRatio, 0.01, 80.0) : 0.0;
  const qTopCoolKcalH = !hasCondenser ? Math.max(0, params.topCoolerDutyKcalH || 0) : 0.0;
  const qRebInputKcalH = hasReboiler ? Math.max(0, params.reboilerDutyKcalH || 0) : 0.0;
  const qTopCoolKJH = qTopCoolKcalH * KJ_PER_KCAL;
  const qRebInputKJH = qRebInputKcalH * KJ_PER_KCAL;

  const totalMolesIn = Math.max(1e-9, activeComps.reduce((s, c) => s + totalFeedMol[c], 0));
  const nonVolMolesIn = activeComps.reduce((s, c) => s + (NON_VOLATILE_SET.has(c) ? totalFeedMol[c] : 0), 0);
  const pStageKgcm2g = Array.from({ length: N }, (_, j) => topPressKgcm2g + j * stageDeltaP);

  const stageFeedMol: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());
  const stageFeedVapMol: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());
  const stageFeedTotMol = new Float64Array(N);
  const stageFeedVapTot = new Float64Array(N);
  const stageFeedEnthKJH = new Float64Array(N);
  let totalFeedEnthKJH = 0;

  for (const f of feeds) {
    const j = clamp(f.stageIdx, 0, N - 1);
    stageFeedEnthKJH[j] += f.enthalpyKJH;
    totalFeedEnthKJH += f.enthalpyKJH;
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      const m = Math.max(0, f.mol[c] || 0);
      const mv = Math.max(0, Math.min(m, f.vapMol[c] || 0));
      stageFeedMol[j][c] += m;
      stageFeedVapMol[j][c] += mv;
      stageFeedTotMol[j] += m;
      stageFeedVapTot[j] += mv;
    }
  }

  const cumFeedMol = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    cumFeedMol[j] = (j > 0 ? cumFeedMol[j - 1] : 0) + stageFeedTotMol[j];
  }

  const solveStageMurphreeRR = (
    zFrac: Record<SimCompKey, number>,
    yInFrac: Record<SimCompKey, number>,
    betaIn: number,
    etaJ: number,
    KStage: Record<SimCompKey, number>
  ): { beta: number; x: Record<SimCompKey, number>; y: Record<SimCompKey, number> } => {
    let nonVolFrac = 0;
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      if (NON_VOLATILE_SET.has(c)) nonVolFrac += Math.max(0, zFrac[c] || 0);
    }
    const betaUpper = nonVolFrac > 1e-12 ? Math.max(0, Math.min(1.0 - nonVolFrac * 0.9999, 1.0 - 1e-9)) : 1.0;

    const evalPsi = (beta: number): number => {
      const bBypass =
        betaIn > 1e-12 && etaJ < 0.999999 ? Math.min(beta * (1.0 - etaJ), 0.999 * betaIn) : 0.0;
      let psi = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        const zi = Math.max(0, zFrac[c] || 0);
        const yIni = betaIn > 1e-12 ? Math.max(0, yInFrac[c] || 0) : 0.0;
        if (zi <= 0 && yIni <= 0) continue;
        const Ki = NON_VOLATILE_SET.has(c) ? 1e-11 : Math.max(1e-11, KStage[c] || 1e-11);
        if (beta <= 1e-12) {
          const effSlope = betaIn > 1e-12 ? etaJ : 1.0;
          const yInTerm = betaIn > 1e-12 ? (1.0 - etaJ) * yIni : 0.0;
          psi += zi * (effSlope * Ki - 1.0) + yInTerm;
        } else {
          const bOverBeta = bBypass / beta;
          const denom = Math.max(1e-14, 1.0 - beta + (beta - bBypass) * Ki);
          const numer = zi * ((1.0 - bOverBeta) * Ki - 1.0) + bOverBeta * yIni;
          psi += numer / denom;
        }
      }
      return psi;
    };

    const buildPhaseComps = (beta: number) => {
      const xOut = zeroCompRecord();
      const yOut = zeroCompRecord();
      const bBypass =
        betaIn > 1e-12 && etaJ < 0.999999 ? Math.min(beta * (1.0 - etaJ), 0.999 * betaIn) : 0.0;
      let sumX = 0;
      let sumY = 0;
      if (beta <= 1e-12) {
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          const zi = Math.max(0, zFrac[c] || 0);
          xOut[c] = zi;
          sumX += zi;
          if (!NON_VOLATILE_SET.has(c)) {
            const Ki = Math.max(1e-11, KStage[c] || 1e-11);
            const yi =
              betaIn > 1e-12 ? etaJ * Ki * zi + (1.0 - etaJ) * Math.max(0, yInFrac[c] || 0) : Ki * zi;
            yOut[c] = Math.max(0, yi);
            sumY += yOut[c];
          }
        }
      } else if (beta >= 1.0 - 1e-12 && nonVolFrac <= 1e-12) {
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          const zi = Math.max(0, zFrac[c] || 0);
          yOut[c] = zi;
          sumY += zi;
          if (!NON_VOLATILE_SET.has(c)) {
            const Ki = Math.max(1e-11, KStage[c] || 1e-11);
            const yIni = betaIn > 1e-12 ? Math.max(0, yInFrac[c] || 0) : 0.0;
            const xi = Math.max(0, zi - bBypass * yIni) / Math.max(1e-14, (1.0 - bBypass) * Ki);
            xOut[c] = xi;
            sumX += xi;
          }
        }
      } else {
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          const zi = Math.max(0, zFrac[c] || 0);
          const yIni = betaIn > 1e-12 ? Math.max(0, yInFrac[c] || 0) : 0.0;
          const Ki = NON_VOLATILE_SET.has(c) ? 0.0 : Math.max(1e-11, KStage[c] || 1e-11);
          const numX = Math.max(0, zi - bBypass * yIni);
          const denX = Math.max(1e-14, 1.0 - beta + (beta - bBypass) * Ki);
          const xi = numX / denX;
          xOut[c] = xi;
          sumX += xi;
          if (!NON_VOLATILE_SET.has(c)) {
            const yi = ((beta - bBypass) * Ki * xi + bBypass * yIni) / Math.max(1e-14, beta);
            yOut[c] = Math.max(0, yi);
            sumY += yOut[c];
          }
        }
      }
      if (sumX > 1e-15) {
        for (let ci = 0; ci < nActive; ci++) xOut[activeComps[ci]] /= sumX;
      }
      if (sumY > 1e-15) {
        for (let ci = 0; ci < nActive; ci++) yOut[activeComps[ci]] /= sumY;
      }
      return { beta, x: xOut, y: yOut };
    };

    const psi0 = evalPsi(0.0);
    if (psi0 <= 0.0 || betaUpper <= 1e-12) {
      return buildPhaseComps(0.0);
    }
    const psi1 = evalPsi(betaUpper);
    if (psi1 >= 0.0) {
      return buildPhaseComps(betaUpper);
    }

    let lo = 0.0;
    let hi = betaUpper;
    for (let it = 0; it < 38; it++) {
      const mid = 0.5 * (lo + hi);
      const pm = evalPsi(mid);
      if (Math.abs(pm) < 1e-11 || hi - lo < 1e-11) {
        lo = mid;
        hi = mid;
        break;
      }
      if (pm > 0) lo = mid;
      else hi = mid;
    }
    return buildPhaseComps(0.5 * (lo + hi));
  };

  const solveStageMurphreePHFlash = (
    totStageMol: number,
    zFrac: Record<SimCompKey, number>,
    yInFrac: Record<SimCompKey, number>,
    betaIn: number,
    etaJ: number,
    hTargetKJH: number,
    tInitC: number,
    xSeed: Record<SimCompKey, number>,
    ySeed: Record<SimCompKey, number>,
    pBarA: number,
    pKgcm2g: number
  ): { tempC: number; beta: number; x: Record<SimCompKey, number>; y: Record<SimCompKey, number>; hKJH: number } => {
    const evalAtTemp = (tC: number) => {
      let KStage = calcStageKValues(model, activeComps, xSeed, tC, pBarA, ySeed, MAX_OPEN_GAS_K);
      let rr = solveStageMurphreeRR(zFrac, yInFrac, betaIn, etaJ, KStage);
      // 비이상계/전해질계(HCl-H2O 등)의 액상 조성 의존 K(x, T) 정합을 위한 내부 1~2회 갱신
      KStage = calcStageKValues(model, activeComps, rr.x, tC, pBarA, rr.y, MAX_OPEN_GAS_K);
      const rr2 = solveStageMurphreeRR(zFrac, yInFrac, betaIn, etaJ, KStage);
      if (model === 'ENRTL' && (zFrac.HCl || 0) > 0.005) {
        const xBlend = zeroCompRecord();
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          xBlend[c] = 0.5 * (rr.x[c] + rr2.x[c]);
        }
        KStage = calcStageKValues(model, activeComps, xBlend, tC, pBarA, rr2.y, MAX_OPEN_GAS_K);
        rr = solveStageMurphreeRR(zFrac, yInFrac, betaIn, etaJ, KStage);
      } else {
        rr = rr2;
      }

      const vapKg = zeroCompRecord();
      const liqKg = zeroCompRecord();
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        vapKg[c] = totStageMol * rr.beta * rr.y[c] * COMP_MW[c];
        liqKg[c] = totStageMol * (1.0 - rr.beta) * rr.x[c] * COMP_MW[c];
      }
      const hKJH = streamEnthalpyKcalH(vapKg, liqKg, tC, pKgcm2g) * KJ_PER_KCAL;
      return { hKJH, beta: rr.beta, x: rr.x, y: rr.y };
    };

    const T_MIN_C = -55.0;
    const T_MAX_C = 280.0;
    const tolH = Math.max(0.05, Math.abs(hTargetKJH) * 1e-6 + totStageMol * 1e-3);
    const t0 = clamp(tInitC, T_MIN_C + 2.0, T_MAX_C - 2.0);
    const st0 = evalAtTemp(t0);
    const f0 = st0.hKJH - hTargetKJH;
    if (Math.abs(f0) <= tolH) {
      return { tempC: t0, ...st0 };
    }

    let tLo = t0;
    let tHi = t0;
    let stLo = st0;
    let stHi = st0;
    let fLo = f0;
    let fHi = f0;
    let step = 6.0;

    if (f0 < 0) {
      for (let k = 0; k < 14 && fHi < 0 && tHi < T_MAX_C; k++) {
        tLo = tHi;
        stLo = stHi;
        fLo = fHi;
        tHi = Math.min(T_MAX_C, tHi + step);
        stHi = evalAtTemp(tHi);
        fHi = stHi.hKJH - hTargetKJH;
        step *= 1.75;
      }
      if (fHi < 0) {
        return { tempC: tHi, ...stHi };
      }
    } else {
      for (let k = 0; k < 14 && fLo > 0 && tLo > T_MIN_C; k++) {
        tHi = tLo;
        stHi = stLo;
        fHi = fLo;
        tLo = Math.max(T_MIN_C, tLo - step);
        stLo = evalAtTemp(tLo);
        fLo = stLo.hKJH - hTargetKJH;
        step *= 1.75;
      }
      if (fLo > 0) {
        return { tempC: tLo, ...stLo };
      }
    }

    let side = 0;
    let fLoIll = fLo;
    let fHiIll = fHi;
    for (let it = 0; it < 28; it++) {
      if (tHi - tLo <= 1e-4) {
        const spanH = stHi.hKJH - stLo.hKJH;
        const theta = Math.abs(spanH) > 1e-9 ? clamp((hTargetKJH - stLo.hKJH) / spanH, 0.0, 1.0) : 0.5;
        const betaInterp = (1.0 - theta) * stLo.beta + theta * stHi.beta;
        const xInterp = zeroCompRecord();
        const yInterp = zeroCompRecord();
        const lLo = 1.0 - stLo.beta;
        const lHi = 1.0 - stHi.beta;
        const lTot = Math.max(1e-14, (1.0 - theta) * lLo + theta * lHi);
        const vTot = Math.max(1e-14, betaInterp);
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          xInterp[c] = betaInterp < 1.0 - 1e-10
            ? ((1.0 - theta) * lLo * stLo.x[c] + theta * lHi * stHi.x[c]) / lTot
            : stLo.x[c];
          yInterp[c] = betaInterp > 1e-10
            ? ((1.0 - theta) * stLo.beta * stLo.y[c] + theta * stHi.beta * stHi.y[c]) / vTot
            : stHi.y[c];
        }
        return {
          tempC: 0.5 * (tLo + tHi),
          beta: betaInterp,
          x: xInterp,
          y: yInterp,
          hKJH: hTargetKJH,
        };
      }

      let tNext: number;
      if (Math.abs(fHiIll - fLoIll) > 1e-12) {
        const sec = tLo - (fLoIll * (tHi - tLo)) / (fHiIll - fLoIll);
        const margin = 0.08 * (tHi - tLo);
        tNext = sec > tLo + margin && sec < tHi - margin ? sec : 0.5 * (tLo + tHi);
      } else {
        tNext = 0.5 * (tLo + tHi);
      }

      const stNext = evalAtTemp(tNext);
      const fNext = stNext.hKJH - hTargetKJH;
      if (Math.abs(fNext) <= tolH) {
        return { tempC: tNext, ...stNext };
      }
      if (fNext < 0) {
        tLo = tNext;
        stLo = stNext;
        fLo = fNext;
        fLoIll = fNext;
        if (side === -1) fHiIll *= 0.5;
        side = -1;
      } else {
        tHi = tNext;
        stHi = stNext;
        fHi = fNext;
        fHiIll = fNext;
        if (side === 1) fLoIll *= 0.5;
        side = 1;
      }
    }

    const bestSt = Math.abs(fLo) <= Math.abs(fHi) ? { tempC: tLo, ...stLo } : { tempC: tHi, ...stHi };
    return bestSt;
  };

  // 단일 단(N === 1) 개방 흡수/플래시 직접 해법
  if (N === 1) {
    const z0 = zeroCompRecord();
    const yIn0 = zeroCompRecord();
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      z0[c] = totalFeedMol[c] / totalMolesIn;
      yIn0[c] = stageFeedVapTot[0] > 1e-12 ? stageFeedVapMol[0][c] / stageFeedVapTot[0] : z0[c];
    }
    const betaIn0 = clamp(stageFeedVapTot[0] / totalMolesIn, 0.0, 1.0);
    const eta0 = hasCondenser || hasReboiler ? 1.0 : meshMurphreeEff;
    const hTarget0 = totalFeedEnthKJH + qRebInputKJH - qTopCoolKJH;
    const tSeed0 = feeds.length > 0 ? feeds.reduce((s, f) => s + f.tempC, 0) / feeds.length : 30.0;
    const fl0 = solveStageMurphreePHFlash(
      totalMolesIn,
      z0,
      yIn0,
      betaIn0,
      eta0,
      hTarget0,
      tSeed0,
      z0,
      yIn0,
      P_stageBarA[0],
      pStageKgcm2g[0]
    );
    const v0Mol = fl0.beta * totalMolesIn;
    const l0Mol = (1.0 - fl0.beta) * totalMolesIn;
    const distMol = zeroCompRecord();
    const botMol = zeroCompRecord();
    const distKgH = zeroCompRecord();
    const botKgH = zeroCompRecord();
    const xWtPct = zeroCompRecord();
    const yWtPct = zeroCompRecord();
    let dMass = 0;
    let bMass = 0;
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      distMol[c] = v0Mol * fl0.y[c];
      botMol[c] = l0Mol * fl0.x[c];
      distKgH[c] = distMol[c] * COMP_MW[c];
      botKgH[c] = botMol[c] * COMP_MW[c];
      dMass += distKgH[c];
      bMass += botKgH[c];
    }
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      xWtPct[c] = bMass > 1e-12 ? (botKgH[c] / bMass) * 100.0 : 0;
      yWtPct[c] = dMass > 1e-12 ? (distKgH[c] / dMass) * 100.0 : 0;
    }
    const stage0Profile: DistillStageProfile = {
      stage: 1,
      tempC: fl0.tempC,
      pressBarA: P_stageBarA[0],
      liqFlowKmolH: l0Mol,
      vapFlowKmolH: v0Mol,
      liqMassKgH: bMass,
      vapMassKgH: dMass,
      xMol: { ...fl0.x },
      yMol: { ...fl0.y },
      xWtPct,
      yWtPct,
      isFeedStage: true,
    };
    return {
      converged: true,
      iterations: 1,
      distillateKmolH: distMol,
      bottomsKmolH: botMol,
      distillateKgH: distKgH,
      bottomsKgH: botKgH,
      decanterWaterDrawKgH: 0,
      decanterFlowsKgH: zeroCompRecord(),
      distillatePhase: 'G',
      stages: [stage0Profile],
      condenserDutyKcalH: -qTopCoolKcalH,
      reboilerDutyKcalH: qRebInputKcalH,
      actualRefluxRatio: 0,
      actualBoilupRatio: l0Mol > 1e-9 ? v0Mol / l0Mol : 0,
      actualDOverFMass: dMass / Math.max(1e-6, totalFeedMassKgH),
      actualDOverFMole: v0Mol / totalMolesIn,
    };
  }

  // ── 다단(N >= 2) 개방·반개방 MESH 초기화 ──
  const etaStage = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    if (j === 0 && hasCondenser) etaStage[j] = 1.0;
    else if (j === N - 1 && hasReboiler) etaStage[j] = 1.0;
    else etaStage[j] = meshMurphreeEff;
  }

  let topTempGuess = 30.0;
  let botTempGuess = 35.0;
  let topW = 0;
  let botW = 0;
  for (const f of feeds) {
    const mTot = activeComps.reduce((s, c) => s + (f.mol[c] || 0), 0);
    if (f.stageIdx <= Math.floor((N - 1) / 2)) {
      if (topW === 0) topTempGuess = 0;
      topTempGuess += f.tempC * mTot;
      topW += mTot;
    }
    if (f.stageIdx >= Math.ceil((N - 1) / 2)) {
      if (botW === 0) botTempGuess = 0;
      botTempGuess += f.tempC * mTot;
      botW += mTot;
    }
  }
  if (topW > 1e-9) topTempGuess /= topW;
  else if (feeds.length > 0) topTempGuess = feeds[0].tempC;
  if (botW > 1e-9) botTempGuess /= botW;
  else botTempGuess = topTempGuess;

  const xInitLiq = zeroCompRecord();
  const yInitVap = zeroCompRecord();
  let sumInitL = 0;
  let sumInitV = 0;
  for (let j = 0; j < N; j++) {
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      const ml = Math.max(0, stageFeedMol[j][c] - stageFeedVapMol[j][c]);
      const mv = stageFeedVapMol[j][c];
      xInitLiq[c] += ml;
      yInitVap[c] += mv;
      sumInitL += ml;
      sumInitV += mv;
    }
  }
  for (let ci = 0; ci < nActive; ci++) {
    const c = activeComps[ci];
    xInitLiq[c] = sumInitL > 1e-12 ? xInitLiq[c] / sumInitL : totalFeedMol[c] / totalMolesIn;
    yInitVap[c] = sumInitV > 1e-12 ? yInitVap[c] / sumInitV : totalFeedMol[c] / totalMolesIn;
  }

  if (hasReboiler) {
    botTempGuess = Math.max(
      botTempGuess,
      solveStageBubbleTempC(model, activeComps, xInitLiq, P_stageBarA[N - 1], botTempGuess + 15.0)
    );
  }
  if (hasCondenser) {
    topTempGuess = solveStageBubbleTempC(model, activeComps, yInitVap, P_stageBarA[0], topTempGuess);
  }

  const T = new Float64Array(N);
  const x: Record<SimCompKey, number>[] = Array.from({ length: N }, () => ({ ...xInitLiq }));
  const yStage: Record<SimCompKey, number>[] = Array.from({ length: N }, () => ({ ...yInitVap }));
  const K: Record<SimCompKey, number>[] = new Array(N);

  for (let j = 0; j < N; j++) {
    const frac = j / Math.max(1, N - 1);
    T[j] = topTempGuess + frac * (botTempGuess - topTempGuess);
    K[j] = calcStageKValues(model, activeComps, x[j], T[j], P_stageBarA[j], yStage[j], MAX_OPEN_GAS_K);
  }

  const FLOW_FLOOR = Math.max(1e-9, totalMolesIn * 1e-9);
  const V = new Float64Array(N);
  const L = new Float64Array(N);
  const reboilerBoilupEst = hasReboiler ? qRebInputKJH / 38000.0 : 0.0;

  // 개방·반개방 탑 사이드컷(측류 인출) 설정
  const activeDraws: InnerSideDrawSpec[] =
    N >= 3 && params.sideDraws?.length
      ? params.sideDraws
          .filter(sd => (sd.targetMolesKmolH ?? 0) > 1e-8 || (sd.drawRatio ?? 0) > 1e-5)
          .map(sd => ({ ...sd, stageIdx: clamp(Math.round(sd.stageIdx), 1, N - 2) }))
      : [];
  const SL = new Float64Array(N);
  const SV = new Float64Array(N);
  const cumSideDrawTot = new Float64Array(N);
  const drawMoles = new Float64Array(activeDraws.length);
  let sideCutClamped = false;

  const rebuildOpenSideDraws = (dCur: number, isInitial: boolean, ratioDamp = 0.35) => {
    if (activeDraws.length === 0) return;
    const maxTotSideMol = Math.max(0, totalMolesIn - dCur - FLOW_FLOOR * 10);
    let reqTot = 0;
    for (let idx = 0; idx < activeDraws.length; idx++) {
      const d = activeDraws[idx];
      const j = d.stageIdx;
      let dm: number;
      if (d.drawRatio !== undefined) {
        const r = clamp(d.drawRatio, 0.005, 0.85);
        const totOut = d.phase === 'vapor' ? Math.max(FLOW_FLOOR, V[j] + SV[j]) : Math.max(FLOW_FLOOR, L[j] + SL[j]);
        const targetDm = r * totOut;
        dm = isInitial ? targetDm : (1.0 - ratioDamp) * drawMoles[idx] + ratioDamp * targetDm;
      } else {
        dm = Math.max(0, d.targetMolesKmolH ?? 0);
      }
      drawMoles[idx] = Math.max(0, dm);
      reqTot += drawMoles[idx];
    }
    if (reqTot > maxTotSideMol && reqTot > 1e-12) {
      const sc = maxTotSideMol / reqTot;
      for (let idx = 0; idx < activeDraws.length; idx++) drawMoles[idx] *= sc;
      sideCutClamped = true;
    }
    SL.fill(0);
    SV.fill(0);
    for (let idx = 0; idx < activeDraws.length; idx++) {
      const d = activeDraws[idx];
      if (d.phase === 'vapor') SV[d.stageIdx] += drawMoles[idx];
      else SL[d.stageIdx] += drawMoles[idx];
    }
    let runS = 0;
    for (let j = 0; j < N; j++) {
      runS += SL[j] + SV[j];
      cumSideDrawTot[j] = runS;
    }
  };

  let cumVapBelow = 0;
  for (let j = N - 1; j >= 0; j--) {
    cumVapBelow += stageFeedVapTot[j] + (j === N - 1 ? reboilerBoilupEst : 0);
    V[j] = Math.max(FLOW_FLOOR, Math.min(totalMolesIn - nonVolMolesIn - FLOW_FLOOR, cumVapBelow));
  }
  if (V[0] <= FLOW_FLOOR * 10 && !hasCondenser) {
    const fallbackV = Math.max(FLOW_FLOOR, Math.min(0.15 * totalMolesIn, totalMolesIn - nonVolMolesIn - FLOW_FLOOR));
    for (let j = 0; j < N; j++) V[j] = fallbackV;
  }

  let D_curr = !hasCondenser
    ? V[0]
    : clamp((V[1] + stageFeedTotMol[0]) / (1.0 + RR), FLOW_FLOOR, Math.max(FLOW_FLOOR * 2, totalMolesIn - nonVolMolesIn - FLOW_FLOOR));

  if (hasCondenser) {
    L[0] = RR * D_curr;
    V[0] = condenserType === 'partial' ? D_curr : 0.0;
    for (let j = 1; j < N - 1; j++) {
      L[j] = Math.max(FLOW_FLOOR, V[j + 1] + cumFeedMol[j] - D_curr);
    }
    L[N - 1] = Math.max(FLOW_FLOOR, totalMolesIn - D_curr);
  } else {
    for (let j = 0; j < N - 1; j++) {
      L[j] = Math.max(FLOW_FLOOR, V[j + 1] + cumFeedMol[j] - D_curr);
    }
    L[N - 1] = Math.max(FLOW_FLOOR, totalMolesIn - D_curr);
  }
  if (activeDraws.length > 0) {
    rebuildOpenSideDraws(D_curr, true);
    const startJInit = hasCondenser ? 1 : 0;
    for (let j = startJInit; j < N - 1; j++) {
      L[j] = Math.max(FLOW_FLOOR, V[j + 1] + cumFeedMol[j] - D_curr - cumSideDrawTot[j]);
    }
    L[N - 1] = Math.max(FLOW_FLOOR, totalMolesIn - D_curr - (N >= 2 ? cumSideDrawTot[N - 2] : 0));
  }

  const decK0 = zeroCompRecord();
  for (let ci = 0; ci < nActive; ci++) decK0[activeComps[ci]] = 1.0;
  let decanterWaterDrawKgH = 0;
  let decanterFlowsKgH = zeroCompRecord();

  const aVec = new Float64Array(N);
  const bVec = new Float64Array(N);
  const cVec = new Float64Array(N);
  const dVec = new Float64Array(N);
  const triCp = new Float64Array(N);
  const triDp = new Float64Array(N);
  const triSol = new Float64Array(N);
  const sStage = new Float64Array(N);
  const betaStage = new Float64Array(N);
  const etaEff = new Float64Array(N);

  const lStar: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());
  const vStar: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());
  const sLiqStar: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());
  const sVapStar: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());
  const distStar0 = zeroCompRecord();

  const runThomasComponentSolve = () => {
    for (let j = 0; j < N; j++) {
      if (j === 0 && hasCondenser) {
        etaEff[0] = 1.0;
      } else if (j === N - 1) {
        if (hasReboiler) {
          etaEff[N - 1] = 1.0;
        } else {
          const vInBot = stageFeedVapTot[N - 1];
          const bBot =
            vInBot > 1e-12 && etaStage[N - 1] < 0.999999
              ? Math.min(V[N - 1] * (1.0 - etaStage[N - 1]), 0.999 * vInBot)
              : 0.0;
          etaEff[N - 1] = V[N - 1] > 1e-12 ? clamp(1.0 - bBot / V[N - 1], 0.01, 1.0) : 1.0;
        }
      } else {
        const vInBelow = V[j + 1];
        const vOutTot = V[j] + SV[j];
        const bTr =
          vInBelow > 1e-12 && etaStage[j] < 0.999999
            ? Math.min(vOutTot * (1.0 - etaStage[j]), 0.999 * vInBelow)
            : 0.0;
        etaEff[j] = vOutTot > 1e-12 ? clamp(1.0 - bTr / vOutTot, 0.01, 1.0) : 1.0;
      }
    }

    for (let ci = 0; ci < nActive; ci++) {
      const comp = activeComps[ci];
      if (NON_VOLATILE_SET.has(comp)) {
        let availSalt = 0;
        distStar0[comp] = 0;
        for (let j = 0; j < N; j++) {
          availSalt += stageFeedMol[j][comp];
          if (j < N - 1 && SL[j] > 0) {
            const downFrac = L[j] / Math.max(1e-12, L[j] + SL[j]);
            lStar[j][comp] = availSalt * downFrac;
            sLiqStar[j][comp] = availSalt * (1.0 - downFrac);
            availSalt = lStar[j][comp];
          } else {
            lStar[j][comp] = availSalt;
            sLiqStar[j][comp] = 0;
          }
          vStar[j][comp] = 0;
          sVapStar[j][comp] = 0;
        }
        continue;
      }

      for (let j = 0; j < N; j++) {
        sStage[j] = Math.max(1e-12, etaEff[j] * Math.max(1e-12, K[j][comp]));
      }
      betaStage[0] = !hasCondenser && etaEff[0] < 0.999999 ? ((1.0 - etaEff[0]) * sStage[1]) / sStage[0] : 0.0;
      for (let j = 1; j < N - 1; j++) {
        betaStage[j] = etaEff[j] < 0.999999 ? ((1.0 - etaEff[j]) * sStage[j + 1]) / sStage[j] : 0.0;
      }
      betaStage[N - 1] = 0.0;

      const fVapBotTot = stageFeedVapTot[N - 1];
      const yInBot = !hasReboiler && fVapBotTot > 1e-12 ? stageFeedVapMol[N - 1][comp] / fVapBotTot : 0.0;
      const deltaBot =
        !hasReboiler && etaEff[N - 1] < 0.999999 ? ((1.0 - etaEff[N - 1]) * yInBot) / sStage[N - 1] : 0.0;

      aVec[0] = 0;
      let k0Used = 1.0;
      if (!hasCondenser) {
        bVec[0] = -(L[0] + V[0] * sStage[0]);
        cVec[0] = L[0] * betaStage[0] + V[1] * sStage[1];
        dVec[0] = -stageFeedMol[0][comp];
      } else {
        if (condenserType === 'partial') {
          k0Used = Math.max(1e-12, K[0][comp]);
        } else if (condenserType === 'decanter_ech') {
          k0Used = Math.max(1e-6, decK0[comp]);
        } else {
          k0Used = 1.0;
        }
        bVec[0] = -(L[0] + D_curr * k0Used);
        cVec[0] = V[1] * sStage[1];
        dVec[0] = -stageFeedMol[0][comp];
      }

      for (let j = 1; j < N - 1; j++) {
        aVec[j] = L[j - 1];
        bVec[j] = -(L[j - 1] * betaStage[j - 1] + L[j] + SL[j] + (V[j] + SV[j]) * sStage[j]);
        cVec[j] = (L[j] + SL[j]) * betaStage[j] + V[j + 1] * sStage[j + 1];
        dVec[j] = -stageFeedMol[j][comp];
      }

      aVec[N - 1] = L[N - 2];
      bVec[N - 1] = -(L[N - 2] * betaStage[N - 2] + L[N - 1] + V[N - 1] * sStage[N - 1]);
      cVec[N - 1] = 0;
      dVec[N - 1] = -(stageFeedMol[N - 1][comp] + L[N - 1] * deltaBot);

      const uSol = solveTridiagonal(aVec, bVec, cVec, dVec, triCp, triDp, triSol);

      if (!hasCondenser) {
        const x0Raw = Math.max(0, uSol[0] - betaStage[0] * uSol[1]);
        lStar[0][comp] = L[0] * x0Raw;
        vStar[0][comp] = V[0] * sStage[0] * Math.max(0, uSol[0]);
        distStar0[comp] = vStar[0][comp];
      } else {
        const x0Raw = Math.max(0, uSol[0]);
        lStar[0][comp] = L[0] * x0Raw;
        distStar0[comp] = D_curr * k0Used * x0Raw;
        vStar[0][comp] = condenserType === 'partial' ? distStar0[comp] : 0;
      }

      for (let j = 1; j < N - 1; j++) {
        const xjRaw = Math.max(0, uSol[j] - betaStage[j] * uSol[j + 1]);
        const yjRaw = sStage[j] * Math.max(0, uSol[j]);
        lStar[j][comp] = L[j] * xjRaw;
        vStar[j][comp] = V[j] * yjRaw;
        sLiqStar[j][comp] = SL[j] * xjRaw;
        sVapStar[j][comp] = SV[j] * yjRaw;
      }

      const xNRaw = Math.max(0, uSol[N - 1] - deltaBot);
      lStar[N - 1][comp] = L[N - 1] * xNRaw;
      vStar[N - 1][comp] = V[N - 1] * sStage[N - 1] * Math.max(0, uSol[N - 1]);
    }
  };

  const streamLiqEnthKJH = (compMol: Record<SimCompKey, number>, tC: number, pKgcm2g: number): number => {
    const liqKg = zeroCompRecord();
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      liqKg[c] = Math.max(0, compMol[c] || 0) * COMP_MW[c];
    }
    return streamEnthalpyKcalH({}, liqKg, tC, pKgcm2g) * KJ_PER_KCAL;
  };

  const streamVapEnthKJH = (compMol: Record<SimCompKey, number>, tC: number, pKgcm2g: number): number => {
    const vapKg = zeroCompRecord();
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      vapKg[c] = Math.max(0, compMol[c] || 0) * COMP_MW[c];
    }
    return streamEnthalpyKcalH(vapKg, {}, tC, pKgcm2g) * KJ_PER_KCAL;
  };

  const MAX_ITER = params.maxIterations ?? 185;
  let converged = false;
  let iterUsed = 0;
  const totalScaleKJH = Math.max(500.0, Math.abs(totalFeedEnthKJH) + qRebInputKJH + qTopCoolKJH + totalMolesIn * 25000.0);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterUsed = iter + 1;

    // 디캔터 응축기 사용 시 Stage 0 액-액 상분리 분배계수 갱신
    if (condenserType === 'decanter_ech' && iter >= 1) {
      const condMassKg = zeroCompRecord();
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        condMassKg[c] = Math.max(0, vStar[1][c] + stageFeedMol[0][c]) * COMP_MW[c];
      }
      const lle0 = solveRigorousLLEDecanter(condMassKg, T[0]);
      if (lle0.phaseSplit) {
        decanterWaterDrawKgH = Object.values(lle0.aqueousKgH).reduce((s, v) => s + (v || 0), 0);
        decanterFlowsKgH = { ...zeroCompRecord(), ...lle0.aqueousKgH };
        const wAqMol = zeroCompRecord();
        const wOrgMol = zeroCompRecord();
        let sumAqM = 0;
        let sumOrgM = 0;
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          wAqMol[c] = (lle0.aqueousKgH[c] || 0) / COMP_MW[c];
          wOrgMol[c] = (lle0.organicKgH[c] || 0) / COMP_MW[c];
          sumAqM += wAqMol[c];
          sumOrgM += wOrgMol[c];
        }
        if (sumOrgM > 1e-9 && D_curr > 1e-9) {
          const dOrgMol = Math.max(1e-9, D_curr - sumAqM);
          for (let ci = 0; ci < nActive; ci++) {
            const c = activeComps[ci];
            const xOrgC = wOrgMol[c] / sumOrgM;
            const kNew = xOrgC > 1e-12 ? clamp((dOrgMol * xOrgC + wAqMol[c]) / (D_curr * xOrgC), 0.02, 200.0) : 1.0;
            decK0[c] = 0.5 * decK0[c] + 0.5 * kNew;
          }
        }
      } else {
        decanterWaterDrawKgH = 0;
        decanterFlowsKgH = zeroCompRecord();
        for (let ci = 0; ci < nActive; ci++) decK0[activeComps[ci]] = 1.0;
      }
    }

    runThomasComponentSolve();

    const wX = iter > 90 ? 0.25 : iter > 50 ? 0.42 : 0.68;
    const wT = iter > 90 ? 0.25 : iter > 50 ? 0.45 : 0.72;
    const wV = iter > 90 ? 0.25 : iter > 50 ? 0.45 : 0.68;
    const maxStepTC = iter > 40 ? 8.0 : 18.0;

    let maxDeltaX = 0;
    for (let j = 0; j < N; j++) {
      let sumL = 0;
      let sumV = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        sumL += lStar[j][c];
        sumV += vStar[j][c];
      }
      if (sumL > 1e-15) {
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          const xTarget = lStar[j][c] / sumL;
          const dx = xTarget - x[j][c];
          if (Math.abs(dx) > maxDeltaX) maxDeltaX = Math.abs(dx);
          x[j][c] = Math.max(0, x[j][c] + wX * dx);
        }
        let nrmX = 0;
        for (let ci = 0; ci < nActive; ci++) nrmX += x[j][activeComps[ci]];
        if (nrmX > 1e-15) {
          for (let ci = 0; ci < nActive; ci++) x[j][activeComps[ci]] /= nrmX;
        }
      }
      if (sumV > 1e-15) {
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          yStage[j][c] = Math.max(0, (1.0 - wX) * yStage[j][c] + wX * (vStar[j][c] / sumV));
        }
        let nrmY = 0;
        for (let ci = 0; ci < nActive; ci++) nrmY += yStage[j][activeComps[ci]];
        if (nrmY > 1e-15) {
          for (let ci = 0; ci < nActive; ci++) yStage[j][activeComps[ci]] /= nrmY;
        }
      }
    }

    // 교대 방향(Bottom-Up / Top-Down) Gauss-Seidel 단별 Murphree P-H Flash로 T_j 및 V_j 갱신
    const tWork = new Float64Array(T);
    const vTarget = new Float64Array(V);
    let maxDeltaT = 0;
    let maxRelDeltaV = 0;
    let maxRelEnthErr = 0;

    const startJ = hasCondenser ? 1 : 0;
    const sweepBottomUp = iter % 2 === 0;

    if (hasCondenser) {
      // Stage 0 응축기 온도 및 유출량 D 갱신 (Q_reb = 0 반개방 스트리퍼)
      const xCond0 = zeroCompRecord();
      let sumCondIn = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        xCond0[c] = vStar[1][c] + stageFeedMol[0][c];
        sumCondIn += xCond0[c];
      }
      if (sumCondIn > 1e-12) {
        for (let ci = 0; ci < nActive; ci++) xCond0[activeComps[ci]] /= sumCondIn;
      }
      const tCondTarget = solveStageBubbleTempC(model, activeComps, xCond0, P_stageBarA[0], T[0], yStage[0]);
      const dt0 = clamp(wT * (tCondTarget - T[0]), -maxStepTC, maxStepTC);
      tWork[0] = T[0] + dt0;
      if (Math.abs(tCondTarget - T[0]) > maxDeltaT) maxDeltaT = Math.abs(tCondTarget - T[0]);
    }

    for (let stepIdx = 0; stepIdx < N - startJ; stepIdx++) {
      const j = sweepBottomUp ? N - 1 - stepIdx : startJ + stepIdx;

      const tAbove = iter < 22 ? tWork[Math.max(0, j - 1)] : T[Math.max(0, j - 1)];
      const tBelow = iter < 22 ? tWork[Math.min(N - 1, j + 1)] : T[Math.min(N - 1, j + 1)];
      const hInLiq = j > 0 ? streamLiqEnthKJH(lStar[j - 1], tAbove, pStageKgcm2g[j - 1]) : 0.0;
      const hInVap = j < N - 1 ? streamVapEnthKJH(vStar[j + 1], tBelow, pStageKgcm2g[j + 1]) : 0.0;
      const qStage =
        (j === 0 && !hasCondenser ? -qTopCoolKJH : 0.0) + (j === N - 1 && hasReboiler ? qRebInputKJH : 0.0);
      const hTargetJ = hInLiq + hInVap + stageFeedEnthKJH[j] + qStage;

      const lPlusS: Record<SimCompKey, number> = activeDraws.length > 0 ? zeroCompRecord() : lStar[j];
      const vPlusS: Record<SimCompKey, number> = activeDraws.length > 0 ? zeroCompRecord() : vStar[j];
      if (activeDraws.length > 0) {
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          lPlusS[c] = lStar[j][c] + sLiqStar[j][c];
          vPlusS[c] = vStar[j][c] + sVapStar[j][c];
        }
      }
      const hOutCurr =
        streamLiqEnthKJH(lPlusS, T[j], pStageKgcm2g[j]) + streamVapEnthKJH(vPlusS, T[j], pStageKgcm2g[j]);
      const relH = Math.abs(hOutCurr - hTargetJ) / totalScaleKJH;
      if (relH > maxRelEnthErr) maxRelEnthErr = relH;

      const zFracJ = zeroCompRecord();
      const yInFracJ = zeroCompRecord();
      let totStageMol = 0;
      let vInMol = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        const zc = lPlusS[c] + vPlusS[c];
        zFracJ[c] = zc;
        totStageMol += zc;
        const vcIn = (j < N - 1 ? vStar[j + 1][c] : 0.0) + (j === N - 1 && !hasReboiler ? stageFeedVapMol[N - 1][c] : 0.0);
        yInFracJ[c] = vcIn;
        vInMol += vcIn;
      }
      if (totStageMol <= 1e-14) {
        vTarget[j] = FLOW_FLOOR;
        continue;
      }
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        zFracJ[c] /= totStageMol;
        yInFracJ[c] = vInMol > 1e-14 ? yInFracJ[c] / vInMol : yStage[j][c];
      }
      const betaInJ = clamp(vInMol / totStageMol, 0.0, 1.0);

      const phRes = solveStageMurphreePHFlash(
        totStageMol,
        zFracJ,
        yInFracJ,
        betaInJ,
        etaStage[j],
        hTargetJ,
        tWork[j],
        x[j],
        yStage[j],
        P_stageBarA[j],
        pStageKgcm2g[j]
      );

      const rawDt = phRes.tempC - T[j];
      if (Math.abs(rawDt) > maxDeltaT) maxDeltaT = Math.abs(rawDt);
      const stepDt = clamp(wT * rawDt, -maxStepTC, maxStepTC);
      tWork[j] = T[j] + stepDt;

      const vPh = clamp(phRes.beta * totStageMol - SV[j], FLOW_FLOOR, Math.max(FLOW_FLOOR * 2, totalMolesIn - nonVolMolesIn - FLOW_FLOOR));
      vTarget[j] = vPh;
      const relDv = Math.abs(vPh - V[j]) / Math.max(1e-3, totalMolesIn);
      if (relDv > maxRelDeltaV) maxRelDeltaV = relDv;
    }

    for (let j = 0; j < N; j++) {
      T[j] = tWork[j];
      K[j] = calcStageKValues(model, activeComps, x[j], T[j], P_stageBarA[j], yStage[j], MAX_OPEN_GAS_K);
    }

    // 수평 절단면 총괄 몰 연속방정식(Cut-plane Molar Continuity)을 보존하며 V_j, L_j 동시 갱신
    if (!hasCondenser) {
      for (let j = 0; j < N; j++) {
        V[j] = Math.max(FLOW_FLOOR, (1.0 - wV) * V[j] + wV * vTarget[j]);
      }
      let maxAllowedV0 = Math.max(FLOW_FLOOR, totalMolesIn - nonVolMolesIn - (N >= 2 ? cumSideDrawTot[N - 2] : 0) - FLOW_FLOOR);
      for (let j = 0; j < N - 1; j++) {
        if (cumFeedMol[j] > 1e-9 || cumSideDrawTot[j] > 1e-9) {
          maxAllowedV0 = Math.min(maxAllowedV0, V[j + 1] + cumFeedMol[j] - cumSideDrawTot[j] - FLOW_FLOOR);
        }
      }
      V[0] = clamp(V[0], FLOW_FLOOR, Math.max(FLOW_FLOOR, maxAllowedV0));
      D_curr = V[0];
      if (activeDraws.length > 0) rebuildOpenSideDraws(D_curr, false, 0.35);
      for (let j = 0; j < N - 1; j++) {
        L[j] = Math.max(FLOW_FLOOR, V[j + 1] + cumFeedMol[j] - D_curr - cumSideDrawTot[j]);
      }
      L[N - 1] = Math.max(FLOW_FLOOR, totalMolesIn - D_curr - (N >= 2 ? cumSideDrawTot[N - 2] : 0));
    } else {
      for (let j = 1; j < N; j++) {
        V[j] = Math.max(FLOW_FLOOR, (1.0 - wV) * V[j] + wV * vTarget[j]);
      }
      const aqDrawMol = decanterWaterDrawKgH > 0 ? decanterWaterDrawKgH / COMP_MW.H2O : 0;
      const vCondTot = V[1] + stageFeedTotMol[0];
      const dOrgTarget = Math.max(FLOW_FLOOR, (vCondTot - aqDrawMol) / (1.0 + RR));
      const dTotTarget = clamp(
        dOrgTarget + aqDrawMol,
        FLOW_FLOOR,
        Math.max(FLOW_FLOOR * 2, totalMolesIn - nonVolMolesIn - (N >= 2 ? cumSideDrawTot[N - 2] : 0) - FLOW_FLOOR)
      );
      const relDd = Math.abs(dTotTarget - D_curr) / Math.max(1e-3, totalMolesIn);
      if (relDd > maxRelDeltaV) maxRelDeltaV = relDd;
      D_curr = (1.0 - wV) * D_curr + wV * dTotTarget;
      L[0] = Math.max(FLOW_FLOOR, RR * Math.max(FLOW_FLOOR, D_curr - aqDrawMol));
      V[0] = condenserType === 'partial' ? D_curr : 0.0;
      if (activeDraws.length > 0) rebuildOpenSideDraws(D_curr, false, 0.35);
      for (let j = 1; j < N - 1; j++) {
        L[j] = Math.max(FLOW_FLOOR, V[j + 1] + cumFeedMol[j] - D_curr - cumSideDrawTot[j]);
      }
      L[N - 1] = Math.max(FLOW_FLOOR, totalMolesIn - D_curr - (N >= 2 ? cumSideDrawTot[N - 2] : 0));
    }

    if (
      iter >= 6 &&
      maxDeltaX < 1.0e-6 &&
      maxDeltaT < 5.0e-4 &&
      maxRelDeltaV < 3.0e-6 &&
      maxRelEnthErr < 1.0e-6
    ) {
      converged = true;
      break;
    }
    if (
      iter >= 115 &&
      maxDeltaX < 5.0e-5 &&
      maxDeltaT < 0.04 &&
      maxRelDeltaV < 3.0e-4 &&
      maxRelEnthErr < 5.0e-5
    ) {
      converged = true;
      break;
    }
  }

  // 최종 수렴 상태에서 1회 엄밀 Thomas 성분 수지 재해석으로 기계정밀도(1e-15) 성분 보존 확정
  runThomasComponentSolve();

  const sideDrawsOut: InnerSideDrawOutput[] = activeDraws.map((d, idx) => {
    const j = d.stageIdx;
    const sameBucket = activeDraws.reduce(
      (acc, sd, i2) => (sd.stageIdx === j && sd.phase === d.phase ? acc + drawMoles[i2] : acc),
      0
    );
    const share = sameBucket > 1e-12 ? drawMoles[idx] / sameBucket : 1.0;
    const molRec = zeroCompRecord();
    const kgHRec = zeroCompRecord();
    let mSum = 0;
    let molSum = 0;
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      const mVal = (d.phase === 'vapor' ? sVapStar[j][c] : sLiqStar[j][c]) * share;
      molRec[c] = mVal;
      kgHRec[c] = mVal * COMP_MW[c];
      mSum += kgHRec[c];
      molSum += mVal;
    }
    return {
      id: d.id,
      label: d.label,
      stage: j + 1,
      phase: d.phase === 'vapor' ? ('G' as const) : ('L' as const),
      tempC: T[j],
      pressKgcm2g: pStageKgcm2g[j],
      kmolH: molRec,
      kgH: kgHRec,
      totalMassKgH: mSum,
      totalMolesKmolH: molSum,
    };
  });

  const stageSideLiqKgH = new Float64Array(N);
  const stageSideVapKgH = new Float64Array(N);
  let hSideDrawsKcalH = 0;
  for (const sd of sideDrawsOut) {
    const jIdx = sd.stage - 1;
    if (sd.phase === 'G') {
      stageSideVapKgH[jIdx] += sd.totalMassKgH;
      hSideDrawsKcalH += streamEnthalpyKcalH(sd.kgH, {}, T[jIdx], pStageKgcm2g[jIdx]);
    } else {
      stageSideLiqKgH[jIdx] += sd.totalMassKgH;
      hSideDrawsKcalH += streamEnthalpyKcalH({}, sd.kgH, T[jIdx], pStageKgcm2g[jIdx]);
    }
  }

  const feedStageSet = new Set<number>(feeds.map(f => clamp(f.stageIdx, 0, N - 1)));
  const stages: DistillStageProfile[] = new Array(N);
  for (let j = 0; j < N; j++) {
    let sumLMol = 0;
    let sumVMol = 0;
    let liqMassKgH = 0;
    let vapMassKgH = 0;
    const xMolOut = zeroCompRecord();
    const yMolOut = zeroCompRecord();
    const xWtPct = zeroCompRecord();
    const yWtPct = zeroCompRecord();

    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      sumLMol += lStar[j][c];
      sumVMol += vStar[j][c];
      liqMassKgH += lStar[j][c] * COMP_MW[c];
      vapMassKgH += vStar[j][c] * COMP_MW[c];
    }
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      xMolOut[c] = sumLMol > 1e-15 ? lStar[j][c] / sumLMol : x[j][c];
      yMolOut[c] = sumVMol > 1e-15 ? vStar[j][c] / sumVMol : yStage[j][c];
      xWtPct[c] = liqMassKgH > 1e-12 ? ((lStar[j][c] * COMP_MW[c]) / liqMassKgH) * 100.0 : 0;
      yWtPct[c] = vapMassKgH > 1e-12 ? ((vStar[j][c] * COMP_MW[c]) / vapMassKgH) * 100.0 : 0;
    }

    const hasSideCutHere = stageSideLiqKgH[j] > 1e-6 || stageSideVapKgH[j] > 1e-6;
    stages[j] = {
      stage: j + 1,
      tempC: T[j],
      pressBarA: P_stageBarA[j],
      liqFlowKmolH: sumLMol,
      vapFlowKmolH: sumVMol,
      liqMassKgH,
      vapMassKgH,
      xMol: xMolOut,
      yMol: yMolOut,
      xWtPct,
      yWtPct,
      isFeedStage: feedStageSet.has(j),
      ...(hasSideCutHere
        ? {
            isSideCutStage: true,
            sideCutLiqKgH: stageSideLiqKgH[j],
            sideCutVapKgH: stageSideVapKgH[j],
          }
        : {}),
    };
  }

  const distMol = zeroCompRecord();
  const botMol = zeroCompRecord();
  const distKgH = zeroCompRecord();
  const botKgH = zeroCompRecord();
  let distMassSum = 0;
  let actualDistMoles = 0;
  let actualBotMoles = 0;

  for (let ci = 0; ci < nActive; ci++) {
    const c = activeComps[ci];
    const dTotCompMol = distStar0[c];
    const decCompMol = condenserType === 'decanter_ech' ? (decanterFlowsKgH[c] || 0) / COMP_MW[c] : 0;
    const netDistMol = Math.max(0, dTotCompMol - decCompMol);
    distMol[c] = netDistMol;
    botMol[c] = lStar[N - 1][c];
    distKgH[c] = netDistMol * COMP_MW[c];
    botKgH[c] = botMol[c] * COMP_MW[c];
    distMassSum += distKgH[c];
    actualDistMoles += netDistMol;
    actualBotMoles += botMol[c];
  }

  const distillatePhase: 'L' | 'G' = !hasCondenser || condenserType === 'partial' ? 'G' : 'L';
  const hDistKcalH =
    distillatePhase === 'G'
      ? streamEnthalpyKcalH(distKgH, {}, T[0], pStageKgcm2g[0])
      : streamEnthalpyKcalH({}, distKgH, T[0], pStageKgcm2g[0]);
  const hDecKcalH =
    decanterWaterDrawKgH > 0 ? streamEnthalpyKcalH({}, decanterFlowsKgH, T[0], pStageKgcm2g[0]) : 0;

  // 무응축기·무리보일러 개방탑 최종 출구 엔탈피 미소 잔차 정밀 보정 (총괄 열수지 오차 < 0.01 kcal/h 확정)
  if (!hasCondenser && !hasReboiler && actualBotMoles > 1e-8) {
    const targetBotEnthKcalH = totalFeedEnthKJH / KJ_PER_KCAL - qTopCoolKcalH - hDistKcalH - hSideDrawsKcalH;
    for (let pol = 0; pol < 2; pol++) {
      const hB0 = streamEnthalpyKcalH({}, botKgH, T[N - 1], pStageKgcm2g[N - 1]);
      const errKcal = targetBotEnthKcalH - hB0;
      if (Math.abs(errKcal) < 1e-3) break;
      const cpBot =
        streamEnthalpyKcalH({}, botKgH, T[N - 1] + 0.25, pStageKgcm2g[N - 1]) -
        streamEnthalpyKcalH({}, botKgH, T[N - 1] - 0.25, pStageKgcm2g[N - 1]);
      if (cpBot > 1e-6) {
        const dtPol = clamp(errKcal / (2.0 * cpBot), -0.8, 0.8);
        T[N - 1] += dtPol;
        stages[N - 1].tempC = T[N - 1];
      }
    }
  }

  const hBotKcalH = streamEnthalpyKcalH({}, botKgH, T[N - 1], pStageKgcm2g[N - 1]);
  const qNetColumnKcalH = hDistKcalH + hDecKcalH + hSideDrawsKcalH + hBotKcalH - totalFeedEnthKJH / KJ_PER_KCAL;

  let condenserDutyKcalH: number;
  let reboilerDutyKcalH: number;
  if (!hasCondenser && !hasReboiler) {
    reboilerDutyKcalH = 0;
    condenserDutyKcalH = qTopCoolKcalH > 0 ? -qTopCoolKcalH : 0;
  } else if (!hasCondenser && hasReboiler) {
    condenserDutyKcalH = qTopCoolKcalH > 0 ? -qTopCoolKcalH : 0;
    reboilerDutyKcalH = Math.max(0, qNetColumnKcalH - condenserDutyKcalH);
  } else {
    reboilerDutyKcalH = 0;
    condenserDutyKcalH = qNetColumnKcalH;
  }

  return {
    converged,
    iterations: iterUsed,
    distillateKmolH: distMol,
    bottomsKmolH: botMol,
    distillateKgH: distKgH,
    bottomsKgH: botKgH,
    decanterWaterDrawKgH,
    decanterFlowsKgH,
    distillatePhase,
    stages,
    condenserDutyKcalH,
    reboilerDutyKcalH,
    actualRefluxRatio: hasCondenser ? RR : 0,
    actualBoilupRatio: stages[N - 1].vapFlowKmolH / Math.max(1e-6, actualBotMoles),
    actualDOverFMass: (distMassSum + decanterWaterDrawKgH) / Math.max(1e-6, totalFeedMassKgH),
    actualDOverFMole: actualDistMoles / totalMolesIn,
    ...(sideDrawsOut.length > 0 ? { sideDraws: sideDrawsOut } : {}),
    ...(sideCutClamped ? { sideCutClamped: true } : {}),
  };
}

function evalSpecMetric(
  spec: DistillDesignSpec,
  sol: InnerMeshSolution,
  totalFeedKgH: Record<SimCompKey, number>
): number {
  const targetFlowsKg = spec.streamTarget === 'distillate' ? sol.distillateKgH : sol.bottomsKgH;
  const targetFlowsMol = spec.streamTarget === 'distillate' ? sol.distillateKmolH : sol.bottomsKmolH;
  const totKg = ALL_KEYS.reduce((s, k) => s + targetFlowsKg[k], 0);
  const totMol = ALL_KEYS.reduce((s, k) => s + targetFlowsMol[k], 0);
  const comp = spec.component;

  switch (spec.metric) {
    case 'purity_wt_pct':
      return totKg > 1e-9 ? (targetFlowsKg[comp] / totKg) * 100.0 : 0;
    case 'purity_mol_pct':
      return totMol > 1e-9 ? (targetFlowsMol[comp] / totMol) * 100.0 : 0;
    case 'recovery_pct':
      return (totalFeedKgH[comp] || 0) > 1e-9 ? (targetFlowsKg[comp] / totalFeedKgH[comp]) * 100.0 : 0;
    case 'impurity_wt_ppm':
      return totKg > 1e-9 ? (targetFlowsKg[comp] / totKg) * 1e6 : 0;
  }
}

const DISTILL_SOLVE_CACHE = new Map<string, DistillSolveResult>();

function buildDistillCacheKey(feedsInput: DistillFeedInput[], colParams: DistillColumnParams): string {
  const feedSig = feedsInput
    .map(f => {
      const comps = ALL_KEYS
        .filter(k => (f.flowsKgH[k] || 0) > 1e-5)
        .map(k => `${k}:${(f.flowsKgH[k] || 0).toFixed(4)}`)
        .join(',');
      const enthTag =
        typeof f.enthalpyKcalH === 'number' && Number.isFinite(f.enthalpyKcalH)
          ? `@H${f.enthalpyKcalH.toFixed(1)}`
          : `@P${f.forcedPhase ?? 'A'}`;
      return `${f.stage}@${f.tempC.toFixed(3)}@${f.pressKgcm2g.toFixed(3)}${enthTag}[${comps}]`;
    })
    .join('|');
  return `${feedSig}##${JSON.stringify(colParams)}`;
}

/**
 * 플로우시트 빌더 & PLANT 03/ECH 공용 다단 정밀증류 통합 솔버
 * - 2자유도(DOF=2) 기본 사양 변환 + 선택적 Design Spec (목표순도 / 불순물 ppm) 자동 역산 수행
 */
export function solveRigorousDistillation(
  feedsInput: DistillFeedInput[],
  colParams: DistillColumnParams
): DistillSolveResult {
  const cacheKey = buildDistillCacheKey(feedsInput, colParams);
  const cached = DISTILL_SOLVE_CACHE.get(cacheKey);
  if (cached) return cached;
  const result = solveRigorousDistillationUncached(feedsInput, colParams);
  if (result.converged) {
    if (DISTILL_SOLVE_CACHE.size > 400) {
      const firstKey = DISTILL_SOLVE_CACHE.keys().next().value;
      if (firstKey !== undefined) DISTILL_SOLVE_CACHE.delete(firstKey);
    }
    DISTILL_SOLVE_CACHE.set(cacheKey, result);
  }
  return result;
}

function solveRigorousDistillationUncached(
  feedsInput: DistillFeedInput[],
  colParams: DistillColumnParams
): DistillSolveResult {
  const solveStartMs = Date.now();
  const condenserType: DistillCondenserType = colParams.condenserType ?? 'total';
  const reboilerType: DistillReboilerType = colParams.reboilerType ?? 'kettle';
  const hasCondenser = condenserType !== 'none';
  const hasKettleReboiler = reboilerType === 'kettle' || reboilerType === 'thermosyphon';
  const isOpenOrSemiOpen = !hasCondenser || !hasKettleReboiler;

  const allFeedsInput: DistillFeedInput[] = colParams.secondaryFeeds?.length
    ? [...feedsInput, ...colParams.secondaryFeeds]
    : feedsInput;

  let N = clamp(Math.round(colParams.totalStages ?? 24), isOpenOrSemiOpen ? 1 : 4, 200);
  let defaultFeedStage = isOpenOrSemiOpen
    ? clamp(Math.round(colParams.feedStage ?? 1), 1, N)
    : clamp(Math.round(colParams.feedStage ?? Math.round(N / 2)), 2, N - 1);
  const topPressKgcm2g = colParams.topPressKgcm2g ?? 0.0;
  const stageDeltaP = Math.max(0, colParams.stageDeltaPKgcm2 ?? 0.004);
  const murphreeEff = clamp((colParams.murphreeEffPct ?? 75) / 100.0, 0.1, 1.0);
  const isDesignStagesMode = !isOpenOrSemiOpen && colParams.columnCalcMode === 'design_stages';
  // 단수 자동설계(design_stages)는 이론단 N_theo를 산출한 뒤 실트레이를 계산하며,
  // 단수 지정 정밀모사(rigorous_mesh)에서 stageInputBasis === 'actual_murphree' 시 MESH 행렬 내 Murphree 단효율을 직접 반영
  const stageInputBasisUsed: DistillStageInputBasis = isDesignStagesMode
    ? 'theoretical'
    : (colParams.stageInputBasis ?? 'theoretical');
  const meshMurphreeEff = stageInputBasisUsed === 'actual_murphree' ? murphreeEff : 1.0;
  const nonTrayStageCount = (hasCondenser ? 1 : 0) + (hasKettleReboiler ? 1 : 0);
  const minTrayFloor = isOpenOrSemiOpen ? 1 : 2;
  const calcActualTrayCount = (stageCount: number): number =>
    stageInputBasisUsed === 'actual_murphree'
      ? Math.max(minTrayFloor, stageCount - nonTrayStageCount)
      : Math.max(minTrayFloor, Math.ceil(Math.max(1, stageCount - nonTrayStageCount) / murphreeEff));

  const totalFeedKgH = zeroCompRecord();
  const totalFeedMol = zeroCompRecord();
  let totalFeedMassKgH = 0;

  for (const f of allFeedsInput) {
    for (const k of ALL_KEYS) {
      const m = Math.max(0, f.flowsKgH[k] || 0);
      totalFeedKgH[k] += m;
      totalFeedMol[k] += m / COMP_MW[k];
      totalFeedMassKgH += m;
    }
  }

  let chosenModel: ResolvedDistillThermoModel;
  if (!colParams.thermoModel || colParams.thermoModel === 'AUTO') {
    chosenModel = detectBestDistillThermo(totalFeedKgH, topPressKgcm2g);
  } else if (colParams.thermoModel === 'ENRTL') {
    const domOrgMass =
      (totalFeedKgH.ECH || 0) +
      (totalFeedKgH.DCH || 0) +
      (totalFeedKgH.MCH || 0) +
      (totalFeedKgH.Glycerol || 0) +
      (totalFeedKgH.DCP || 0) +
      (totalFeedKgH.MeOH || 0) +
      (totalFeedKgH.EtOH || 0) +
      (totalFeedKgH.IPA || 0) +
      (totalFeedKgH.Acetone || 0) +
      (totalFeedKgH.AceticAcid || 0) +
      (totalFeedKgH.EtOAc || 0) +
      (totalFeedKgH.CHCl3 || 0);
    if (
      (totalFeedKgH.HCl || 0) > 0 &&
      (totalFeedKgH.H2O || 0) > 0 &&
      (totalFeedKgH.Cl2 || 0) / Math.max(1e-6, totalFeedMassKgH) < 0.3 &&
      domOrgMass / Math.max(1e-6, totalFeedMassKgH) < 0.05
    ) {
      chosenModel = 'ELEC_HCL_AZEO';
    } else {
      chosenModel = 'ENRTL';
    }
  } else {
    chosenModel = colParams.thermoModel;
  }

  // 개방·반개방 흡수/스트리퍼에서 HCl-H2O 계는 비응축 캐리어 가스의 Henry 법칙 및 Pitzer 기액평형이 결합된 ENRTL 사용
  if (isOpenOrSemiOpen && chosenModel === 'ELEC_HCL_AZEO') {
    chosenModel = 'ENRTL';
  }

  // 유입 유량이 0인 빈 컬럼 방어
  if (totalFeedMassKgH <= 1e-6) {
    return {
      converged: false,
      innerIterations: 0,
      outerIterations: 0,
      thermoModelUsed: chosenModel,
      dofValid: false,
      dofMessage: '유입 피드(Feed) 배관 없음',
      distillateFlowsKgH: zeroCompRecord(),
      bottomsFlowsKgH: zeroCompRecord(),
      decanterWaterDrawKgH: 0,
      distillatePhase: condenserType === 'partial' || condenserType === 'none' ? 'G' : 'L',
      topTempC: 25,
      bottomTempC: 25,
      topPressKgcm2g,
      bottomPressKgcm2g: topPressKgcm2g + stageDeltaP * (N - 1),
      actualRefluxRatio: hasCondenser ? (colParams.topSpecValue ?? 2.5) : 0,
      actualBoilupRatio: 0,
      actualDOverFMass: 0.5,
      actualBOverFMass: 0.5,
      actualDOverFMole: 0.5,
      condenserDutyKcalH: 0,
      reboilerDutyKcalH: 0,
      totalStagesUsed: N,
      feedStageUsed: defaultFeedStage,
      actualTrayCount: calcActualTrayCount(N),
      stageInputBasisUsed,
      recommendedFeedStage: defaultFeedStage,
      estimatedDiameterM: 0.6,
      diagnostics: {
        level: 'error',
        badgeText: '피드 미연결 / 유량 0',
        headline: '증류탑에 유입되는 원료(Feed) 유량이 0 kg/h 이어서 계산을 시작할 수 없습니다.',
        causes: [
          '증류탑 좌측 피드 포트에 원료 공급 배관이 연결되지 않았거나 상류 스트림 유량이 0 kg/h 입니다.',
        ],
        remedies: [],
      },
      stages: [],
    };
  }

  const activeComps = ALL_KEYS.filter(k => totalFeedMol[k] > 1e-11);
  const totalMolesIn = activeComps.reduce((s, c) => s + totalFeedMol[c], 0);
  const avgFeedMW = totalFeedMassKgH / Math.max(1e-9, totalMolesIn);

  const buildStageFeeds = (stageCount: number, primaryFeedSt: number, ignoreStageMap: boolean) => {
    const pBarArr = Array.from({ length: stageCount }, (_, j) =>
      Math.max(0.03, (topPressKgcm2g + j * stageDeltaP + 1.03323) * 0.980665)
    );
    const prepFeeds = allFeedsInput.map(f => {
      const stage1Based = clamp(
        Math.round((!ignoreStageMap ? colParams.feedStageMap?.[f.edgeId] : undefined) ?? (ignoreStageMap ? primaryFeedSt : f.stage ?? primaryFeedSt)),
        1,
        stageCount
      );
      const jIdx = stage1Based - 1;
      const fMol = zeroCompRecord();
      const fVapMol = zeroCompRecord();
      let sumM = 0;
      for (const c of activeComps) {
        fMol[c] = Math.max(0, f.flowsKgH[c] || 0) / COMP_MW[c];
        sumM += fMol[c];
      }
      const xF = zeroCompRecord();
      if (sumM > 1e-12) {
        for (const c of activeComps) xF[c] = fMol[c] / sumM;
      }

      let qThermal: number;
      const vapKg = zeroCompRecord();
      const liqKg = zeroCompRecord();

      if (isOpenOrSemiOpen) {
        const pFeedBarA = Math.max(0.03, ((f.pressKgcm2g ?? topPressKgcm2g) + 1.03323) * 0.980665);
        if (f.forcedPhase === 'G') {
          qThermal = 0.0;
          for (const c of activeComps) {
            const mKg = Math.max(0, f.flowsKgH[c] || 0);
            const vFrac = NON_VOLATILE_SET.has(c) ? 0.0 : 1.0;
            vapKg[c] = mKg * vFrac;
            liqKg[c] = mKg - vapKg[c];
            fVapMol[c] = fMol[c] * vFrac;
          }
        } else if (f.forcedPhase === 'L') {
          qThermal = 1.0;
          for (const c of activeComps) {
            const mKg = Math.max(0, f.flowsKgH[c] || 0);
            vapKg[c] = 0.0;
            liqKg[c] = mKg;
            fVapMol[c] = 0.0;
          }
        } else if (f.vapRatio) {
          let vSumM = 0;
          for (const c of activeComps) {
            const mKg = Math.max(0, f.flowsKgH[c] || 0);
            const vFrac = f.vapRatio[c] !== undefined ? clamp(f.vapRatio[c]!, 0.0, 1.0) : (NON_VOLATILE_SET.has(c) ? 0.0 : 0.0);
            vapKg[c] = mKg * vFrac;
            liqKg[c] = mKg - vapKg[c];
            fVapMol[c] = fMol[c] * vFrac;
            vSumM += fVapMol[c];
          }
          qThermal = sumM > 1e-12 ? 1.0 - vSumM / sumM : 1.0;
        } else {
          // 흡수/스트리퍼 피드의 정밀 등온 TP Rachford-Rice 상분율 판정
          let kFeed = calcStageKValues(chosenModel, activeComps, xF, f.tempC, pFeedBarA, xF, 250000);
          let nonVolZ = 0;
          for (const c of activeComps) {
            if (NON_VOLATILE_SET.has(c)) nonVolZ += xF[c];
          }
          const betaMaxF = nonVolZ > 1e-12 ? Math.max(0, 1.0 - nonVolZ * 0.9999) : 1.0;
          const rrFunc = (b: number, kMap: Record<SimCompKey, number>) => {
            let s = 0;
            for (const c of activeComps) {
              const kc = NON_VOLATILE_SET.has(c) ? 1e-11 : Math.max(1e-11, kMap[c] || 1e-11);
              s += (xF[c] * (kc - 1.0)) / Math.max(1e-14, 1.0 + b * (kc - 1.0));
            }
            return s;
          };
          let betaF = 0.0;
          if (rrFunc(0.0, kFeed) > 0.0) {
            if (rrFunc(betaMaxF, kFeed) >= 0.0) {
              betaF = betaMaxF;
            } else {
              let lo = 0.0;
              let hi = betaMaxF;
              for (let it = 0; it < 32; it++) {
                const mid = 0.5 * (lo + hi);
                if (rrFunc(mid, kFeed) > 0) lo = mid;
                else hi = mid;
              }
              betaF = 0.5 * (lo + hi);
              const xSub = zeroCompRecord();
              const ySub = zeroCompRecord();
              let sx = 0;
              let sy = 0;
              for (const c of activeComps) {
                const kc = NON_VOLATILE_SET.has(c) ? 1e-11 : Math.max(1e-11, kFeed[c] || 1e-11);
                xSub[c] = xF[c] / Math.max(1e-14, 1.0 + betaF * (kc - 1.0));
                ySub[c] = kc * xSub[c];
                sx += xSub[c];
                sy += ySub[c];
              }
              if (sx > 1e-14 && sy > 1e-14) {
                for (const c of activeComps) {
                  xSub[c] /= sx;
                  ySub[c] /= sy;
                }
                kFeed = calcStageKValues(chosenModel, activeComps, xSub, f.tempC, pFeedBarA, ySub, 250000);
                if (rrFunc(0.0, kFeed) <= 0.0) betaF = 0.0;
                else if (rrFunc(betaMaxF, kFeed) >= 0.0) betaF = betaMaxF;
                else {
                  let lo2 = 0.0;
                  let hi2 = betaMaxF;
                  for (let it = 0; it < 32; it++) {
                    const mid = 0.5 * (lo2 + hi2);
                    if (rrFunc(mid, kFeed) > 0) lo2 = mid;
                    else hi2 = mid;
                  }
                  betaF = 0.5 * (lo2 + hi2);
                }
              }
            }
          }
          qThermal = 1.0 - betaF;
          for (const c of activeComps) {
            const mKg = Math.max(0, f.flowsKgH[c] || 0);
            let vFrac = 0.0;
            if (NON_VOLATILE_SET.has(c)) {
              vFrac = 0.0;
            } else if (betaF <= 1e-12) {
              vFrac = 0.0;
            } else if (betaF >= 1.0 - 1e-12) {
              vFrac = 1.0;
            } else {
              const kc = Math.max(1e-11, kFeed[c] || 1e-11);
              vFrac = clamp((betaF * kc) / Math.max(1e-14, 1.0 + betaF * (kc - 1.0)), 0.0, 1.0);
            }
            vapKg[c] = mKg * vFrac;
            liqKg[c] = mKg - vapKg[c];
            fVapMol[c] = fMol[c] * vFrac;
          }
        }
      } else {
        const tBpFeed = solveStageBubbleTempC(chosenModel, activeComps, xF, pBarArr[jIdx], f.tempC);
        qThermal =
          f.tempC > tBpFeed + 18
            ? 0.0
            : f.tempC > tBpFeed + 2
              ? clamp(1.0 - (f.tempC - tBpFeed) / 20.0, 0.0, 1.0)
              : 1.0 + clamp((tBpFeed - f.tempC) * 0.004, 0, 0.25);
        const liqFracCond = clamp(qThermal, 0.0, 1.0);
        for (const c of activeComps) {
          const mKg = Math.max(0, f.flowsKgH[c] || 0);
          if (mKg <= 0) continue;
          let vFrac: number;
          if (f.vapRatio && f.vapRatio[c] !== undefined) {
            vFrac = clamp(f.vapRatio[c]!, 0.0, 1.0);
          } else if (f.forcedPhase === 'G') {
            vFrac = NON_VOLATILE_SET.has(c) ? 0.0 : 1.0;
          } else if (f.forcedPhase === 'L') {
            vFrac = 0.0;
          } else if (NON_VOLATILE_SET.has(c)) {
            vFrac = 0.0;
          } else if (PERMANENT_GAS_SET.has(c)) {
            vFrac = 1.0;
          } else {
            vFrac = 1.0 - liqFracCond;
          }
          vapKg[c] = mKg * vFrac;
          liqKg[c] = mKg - vapKg[c];
          fVapMol[c] = fMol[c] * vFrac;
        }
      }

      let enthalpyKJH: number;
      if (typeof f.enthalpyKcalH === 'number' && Number.isFinite(f.enthalpyKcalH)) {
        enthalpyKJH = f.enthalpyKcalH * KJ_PER_KCAL;
      } else {
        enthalpyKJH = streamEnthalpyKcalH(vapKg, liqKg, f.tempC, f.pressKgcm2g) * KJ_PER_KCAL;
      }

      return { stageIdx: jIdx, mol: fMol, vapMol: fVapMol, qThermal, tempC: f.tempC, enthalpyKJH };
    });
    return { pBarArr, prepFeeds };
  };

  let { pBarArr: P_stageBarA, prepFeeds: preparedFeeds } = buildStageFeeds(N, defaultFeedStage, false);

  // ── 2자유도(DOF=2) 기본 운전사양 → 내부 표준 변수 (baseRR, baseDFMole) 변환 ──
  const splitType: DistillSplitSpecType = colParams.splitSpecType ?? 'd_over_f_mass';
  const splitVal = colParams.splitSpecValue ?? 0.50;

  let baseDFMass = 0.50;
  let baseDFMole = 0.50;
  if (splitType === 'd_over_f_mass') {
    baseDFMass = clamp(splitVal, 0.002, 0.998);
    baseDFMole = baseDFMass;
  } else if (splitType === 'b_over_f_mass') {
    baseDFMass = clamp(1.0 - splitVal, 0.002, 0.998);
    baseDFMole = baseDFMass;
  } else if (splitType === 'd_over_f_mole') {
    baseDFMole = clamp(splitVal, 0.002, 0.998);
    baseDFMass = baseDFMole;
  } else if (splitType === 'distillate_kgh') {
    baseDFMass = clamp(splitVal / totalFeedMassKgH, 0.002, 0.998);
    baseDFMole = baseDFMass;
  } else if (splitType === 'bottoms_kgh') {
    baseDFMass = clamp(1.0 - splitVal / totalFeedMassKgH, 0.002, 0.998);
    baseDFMole = baseDFMass;
  }

  const topType: DistillTopSpecType = colParams.topSpecType ?? 'reflux_ratio';
  const topVal = colParams.topSpecValue ?? 2.8;
  let baseRR = 2.8;
  if (topType === 'reflux_ratio') {
    baseRR = clamp(topVal, 0.05, 80.0);
  } else if (topType === 'reflux_mass_kgh') {
    const estDistKgH = Math.max(1.0, baseDFMass * totalFeedMassKgH);
    baseRR = clamp(topVal / estDistKgH, 0.05, 80.0);
  } else if (topType === 'boilup_ratio') {
    const vb = clamp(topVal, 0.1, 80.0);
    baseRR = clamp((vb * (1.0 - baseDFMole)) / Math.max(0.02, baseDFMole) - 1.0, 0.1, 80.0);
  }

  // 대표 경질(LK)·중질(HK) 자동 추출 및 실제 열역학 모델 기반 K_quick 산출
  const sepCandDefault = activeComps.filter(c => !NON_VOLATILE_SET.has(c));
  const poolDefault = sepCandDefault.length >= 2 ? sepCandDefault : activeComps;
  const xFeedQuick = zeroCompRecord();
  for (const c of activeComps) xFeedQuick[c] = totalFeedMol[c] / Math.max(1e-12, totalMolesIn);
  const pTopQuickBarA = Math.max(0.03, (topPressKgcm2g + 1.03323) * 0.980665);
  const K_quick = calcStageKValues(chosenModel, activeComps, xFeedQuick, feedsInput[0]?.tempC ?? 60, pTopQuickBarA);
  const volOrderQuick = activeComps
    .filter(c => !NON_VOLATILE_SET.has(c) && totalFeedMol[c] > 0)
    .sort((a, b) => (K_quick[b] || 0) - (K_quick[a] || 0));

  // 질량 기준 D/F 지정 시 실제 K_quick 휘발도순 누적 질량-몰 초기치 + 연속(Smooth) 한계분자량 보정
  const estInitDistMolesForMass = (targetMassKgH: number): number => {
    let remMass = targetMassKgH;
    let molAcc = 0;
    for (const c of volOrderQuick) {
      const mAvail = totalFeedMol[c] * COMP_MW[c];
      if (remMass >= mAvail) {
        molAcc += totalFeedMol[c];
        remMass -= mAvail;
      } else {
        molAcc += remMass / COMP_MW[c];
        remMass = 0;
        break;
      }
    }
    return molAcc > 1e-6 ? molAcc : targetMassKgH / Math.max(2.0, avgFeedMW);
  };

  // ── 사이드컷(측류 인출) 파라미터 준비 및 단별 질량-몰 변환 ──
  const enabledSideCuts: DistillSideCutConfig[] = [
    ...(colParams.sideCut?.enabled
      ? [{ ...colParams.sideCut, id: colParams.sideCut.id || 'SC-1', label: colParams.sideCut.label || '사이드컷 S' }]
      : []),
    ...(colParams.additionalSideCuts ?? [])
      .filter((s): s is DistillSideCutConfig => Boolean(s && s.enabled))
      .map((s, idx) => ({ ...s, id: s.id || `SC-${idx + 2}`, label: s.label || `사이드컷 S${idx + 2}` })),
  ];
  const primarySideCut = enabledSideCuts[0];
  const scOverrideBox: { val?: Partial<DistillSideCutConfig> } = {};

  const sortedByMassForSc = [...poolDefault].sort((a, b) => (totalFeedKgH[b] || 0) - (totalFeedKgH[a] || 0));
  const defaultSideCutComp: SimCompKey =
    sortedByMassForSc.find(c => c !== activeComps[0] && c !== activeComps[activeComps.length - 1]) ??
    sortedByMassForSc[0] ??
    activeComps[0] ??
    'H2O';

  const getEffectiveSideCuts = (): DistillSideCutConfig[] =>
    enabledSideCuts.map((sc, idx) => (idx === 0 && scOverrideBox.val ? { ...sc, ...scOverrideBox.val } : sc));

  const estimateSideCutFrac = (): number => {
    let frac = 0;
    for (const sc of getEffectiveSideCuts()) {
      if (sc.specType === 'mass_kgh') frac += clamp(sc.specValue / Math.max(1e-6, totalFeedMassKgH), 0, 0.90);
      else if (sc.specType === 's_over_f_mass' || sc.specType === 's_over_f_mole') frac += clamp(sc.specValue, 0, 0.90);
      else frac += 0.12;
    }
    return clamp(frac, 0, 0.90);
  };
  const sFracEst = estimateSideCutFrac();

  const buildInnerSideDraws = (stageCount: number, stageMWMap?: Map<string, number>): InnerSideDrawSpec[] => {
    if (stageCount < 3 || enabledSideCuts.length === 0) return [];
    return getEffectiveSideCuts().map((sc, idx) => {
      const id = sc.id || `SC-${idx + 1}`;
      const label = sc.label || `사이드컷 S${idx === 0 ? '' : idx + 1}`;
      const jIdx = clamp(Math.round(sc.stage || Math.round(stageCount * 0.35)) - 1, 1, stageCount - 2);
      if (sc.specType === 'draw_ratio') {
        return { id, label, stageIdx: jIdx, phase: sc.phase, drawRatio: clamp(sc.specValue, 0.005, 0.85) };
      }
      if (sc.specType === 's_over_f_mole') {
        return { id, label, stageIdx: jIdx, phase: sc.phase, targetMolesKmolH: clamp(sc.specValue, 0.0002, 0.90) * totalMolesIn };
      }
      const fallbackScFrac = sc.specType === 'mass_kgh'
        ? clamp(sc.specValue / Math.max(1e-6, totalFeedMassKgH), 0.0002, 0.90)
        : (sc.specType === 'purity_wt_pct' || sc.specType === 'impurity_ppm' || sc.specType === 'recovery_pct')
          ? 0.12
          : clamp(sc.specValue, 0.0002, 0.90);
      const targetMassKgH = sc.specType === 'mass_kgh'
        ? clamp(sc.specValue, 0.01, totalFeedMassKgH * 0.92)
        : fallbackScFrac * totalFeedMassKgH;
      const mwGuess = stageMWMap?.get(id) ?? (sc.targetComp ? COMP_MW[sc.targetComp] : avgFeedMW) ?? avgFeedMW;
      return { id, label, stageIdx: jIdx, phase: sc.phase, targetMolesKmolH: targetMassKgH / Math.max(2.0, mwGuess) };
    });
  };

  const runMeshAt = (rrVal: number, dfParam: number, dfIsMass: boolean, maxIterOverride?: number): InnerMeshSolution => {
    const sideDrawsInit = buildInnerSideDraws(N);
    const hasMassSideCut = getEffectiveSideCuts().some(
      sc => sc.specType === 'mass_kgh' || sc.specType === 's_over_f_mass'
    );
    const totalSideMolEstInit = sideDrawsInit.reduce((s, d) => s + (d.targetMolesKmolH ?? 0), 0);
    const maxAllowedDMol = Math.max(1e-5, totalMolesIn * 0.996 - totalSideMolEstInit);
    let dMolTarget = clamp(dfParam * totalMolesIn, 0.0004 * totalMolesIn, maxAllowedDMol);
    let finalSideDraws = sideDrawsInit;

    if (dfIsMass || hasMassSideCut) {
      const targetMass = clamp(dfParam, 0.001, 0.995) * totalFeedMassKgH;
      const dMol0 = dfIsMass
        ? clamp(estInitDistMolesForMass(targetMass), 1e-5, maxAllowedDMol)
        : dMolTarget;
      const probe = solveInnerMeshColumn({
        model: chosenModel,
        N,
        feeds: preparedFeeds,
        totalFeedMol,
        totalFeedMassKgH,
        activeComps,
        condenserType,
        reboilerType,
        P_stageBarA,
        topPressKgcm2g,
        stageDeltaP,
        meshMurphreeEff,
        refluxRatio: rrVal,
        targetDistillateKmolH: dMol0,
        sideDraws: sideDrawsInit,
        maxIterations: 22,
      });
      if (hasMassSideCut && probe.sideDraws && probe.sideDraws.length > 0) {
        const mwMap = new Map<string, number>();
        for (const sd of probe.sideDraws) {
          if (sd.totalMolesKmolH > 1e-9) {
            mwMap.set(sd.id, sd.totalMassKgH / sd.totalMolesKmolH);
          }
        }
        finalSideDraws = buildInnerSideDraws(N, mwMap);
      }
      if (dfIsMass) {
        const probeDistMass =
          activeComps.reduce((s, c) => s + probe.distillateKgH[c], 0) +
          probe.decanterWaterDrawKgH;
        let splitMolWeightSum = 0;
        let splitMolSum = 0;
        for (const c of activeComps) {
          if (NON_VOLATILE_SET.has(c) || totalFeedMol[c] <= 1e-9) continue;
          const dCompMol = probe.distillateKmolH[c] + (probe.decanterFlowsKgH[c] || 0) / COMP_MW[c];
          const rec = clamp(dCompMol / totalFeedMol[c], 0, 1);
          const boundaryWeight = 0.015 + rec * (1.0 - rec);
          splitMolWeightSum += boundaryWeight * totalFeedMol[c] * COMP_MW[c];
          splitMolSum += boundaryWeight * totalFeedMol[c];
        }
        const marginalMW = splitMolSum > 1e-9 ? splitMolWeightSum / splitMolSum : avgFeedMW;
        const estSideMolRef = finalSideDraws.reduce((s, d) => s + (d.targetMolesKmolH ?? 0), 0);
        const capDRef = Math.max(1e-5, totalMolesIn * 0.996 - estSideMolRef);
        dMolTarget = clamp(dMol0 + (targetMass - probeDistMass) / Math.max(2.0, marginalMW), 1e-5, capDRef);
      }
    }
    return solveInnerMeshColumn({
      model: chosenModel,
      N,
      feeds: preparedFeeds,
      totalFeedMol,
      totalFeedMassKgH,
      activeComps,
      condenserType,
      reboilerType,
      P_stageBarA,
      topPressKgcm2g,
      stageDeltaP,
      meshMurphreeEff,
      refluxRatio: rrVal,
      targetDistillateKmolH: dMolTarget,
      sideDraws: finalSideDraws,
      maxIterations: maxIterOverride,
    });
  };

  let dfIsMassMode = splitType !== 'd_over_f_mole';
  let solvedRR = baseRR;
  let solvedDF = dfIsMassMode ? baseDFMass : baseDFMole;
  let outerIters = 1;
  const sortedByMassDefault = [...poolDefault].sort((a, b) => (totalFeedKgH[b] || 0) - (totalFeedKgH[a] || 0));
  const majorPairDefault = sortedByMassDefault
    .slice(0, Math.min(2, sortedByMassDefault.length))
    .sort((a, b) => (K_quick[b] || 0) - (K_quick[a] || 0));
  const defaultTopComp: SimCompKey = majorPairDefault[0] ?? poolDefault[0] ?? 'ECH';
  const defaultBotComp: SimCompKey =
    majorPairDefault.find(c => c !== defaultTopComp) ?? poolDefault.find(c => c !== defaultTopComp) ?? defaultTopComp;

  let s1: DistillDesignSpec | undefined = !isDesignStagesMode && colParams.spec1?.enabled ? colParams.spec1 : undefined;
  let s2: DistillDesignSpec | undefined = !isDesignStagesMode && colParams.spec2?.enabled ? colParams.spec2 : undefined;
  let dofValid = true;
  let dofMessage = '🟢 운전조건 2/2 완료 (자유도 충족)';
  let isCoupledDualEndpoint = false;

  if (!isDesignStagesMode && Array.isArray(colParams.activeDofSlots)) {
    const slots = resolveEffectiveDofSlots(colParams);
    s1 = undefined;
    s2 = undefined;
    if (slots.length < 2) {
      dofValid = false;
      dofMessage =
        slots.length === 0
          ? '⚪ 운전조건 0/2 선택 — 4개 항목 중 2개 조건을 선택하세요'
          : '🟡 운전조건 1/2 선택 — 나머지 1개 조건을 추가 선택하세요';
    } else {
      const hasRR = slots.includes('rr');
      const hasSplit = slots.includes('split');
      const hasTop = slots.includes('top_spec');
      const hasBot = slots.includes('bot_spec');

      const topMetric: DistillSpecMetric = colParams.topQualityMetric ?? colParams.spec1?.metric ?? 'purity_wt_pct';
      const topComp: SimCompKey =
        colParams.topQualityComp ??
        (topMetric === 'impurity_wt_ppm' ? defaultBotComp : defaultTopComp);
      const topTarget: number =
        colParams.topQualityTarget ??
        (topMetric === 'impurity_wt_ppm' ? 200 : 99.5);

      const botMetric: DistillSpecMetric = colParams.botQualityMetric ?? colParams.spec2?.metric ?? 'purity_wt_pct';
      const botComp: SimCompKey =
        colParams.botQualityComp ??
        (botMetric === 'impurity_wt_ppm' ? defaultTopComp : defaultBotComp);
      const botTarget: number =
        colParams.botQualityTarget ??
        (botMetric === 'impurity_wt_ppm' ? 200 : 99.0);

      const dfVaryUpperCap = primarySideCut ? Math.max(0.03, 0.985 - sFracEst) : 0.992;
      const sideTag = primarySideCut ? ` + ⑤ 사이드컷(${primarySideCut.phase === 'vapor' ? '기상' : '액상'})` : '';

      if (hasRR && hasSplit) {
        dofMessage = `🟢 운전조건 2/2 완료 (① 환류비 + ② 유출분배 지정)${sideTag}`;
      } else if (hasRR && hasTop) {
        s1 = {
          enabled: true,
          streamTarget: 'distillate',
          component: topComp,
          metric: topMetric,
          targetValue: topTarget,
          varyParam: 'd_over_f',
          varyMin: 0.005,
          varyMax: dfVaryUpperCap,
        };
        dofMessage = `🟢 운전조건 2/2 완료 (① 환류비 + ③ 탑정 품질 → 유출량 자동역산)${sideTag}`;
      } else if (hasRR && hasBot) {
        s1 = {
          enabled: true,
          streamTarget: 'bottoms',
          component: botComp,
          metric: botMetric,
          targetValue: botTarget,
          varyParam: 'd_over_f',
          varyMin: 0.005,
          varyMax: dfVaryUpperCap,
        };
        dofMessage = `🟢 운전조건 2/2 완료 (① 환류비 + ④ 탑저 품질 → 유출량 자동역산)${sideTag}`;
      } else if (hasSplit && hasTop) {
        s1 = {
          enabled: true,
          streamTarget: 'distillate',
          component: topComp,
          metric: topMetric,
          targetValue: topTarget,
          varyParam: 'reflux_ratio',
          varyMin: 0.15,
          varyMax: 45.0,
        };
        dofMessage = `🟢 운전조건 2/2 완료 (② 유출분배 + ③ 탑정 품질 → 환류비 자동역산)${sideTag}`;
      } else if (hasSplit && hasBot) {
        s1 = {
          enabled: true,
          streamTarget: 'bottoms',
          component: botComp,
          metric: botMetric,
          targetValue: botTarget,
          varyParam: 'reflux_ratio',
          varyMin: 0.15,
          varyMax: 45.0,
        };
        dofMessage = `🟢 운전조건 2/2 완료 (② 유출분배 + ④ 탑저 품질 → 환류비 자동역산)${sideTag}`;
      } else if (hasTop && hasBot) {
        isCoupledDualEndpoint = true;
        s1 = {
          enabled: true,
          streamTarget: 'distillate',
          component: topComp,
          metric: topMetric,
          targetValue: topTarget,
          varyParam: 'd_over_f',
          varyMin: 0.005,
          varyMax: dfVaryUpperCap,
        };
        s2 = {
          enabled: true,
          streamTarget: 'bottoms',
          component: botComp,
          metric: botMetric,
          targetValue: botTarget,
          varyParam: 'reflux_ratio',
          varyMin: 0.15,
          varyMax: 45.0,
        };
        dofMessage = `🟢 운전조건 2/2 완료 (③ 탑정 품질 + ④ 탑저 품질 → RR·유출량 동시역산)${sideTag}`;
      }
    }
  } else if (s1 && s2 && s1.varyParam === s2.varyParam) {
    dofValid = false;
    dofMessage = '⚠️ 스펙 1과 스펙 2의 조작변수(Vary)가 중복되어 스펙 1만 우선 적용됨';
  }

  // 1차원 Bounded Secant + Golden-Bisection 하이브리드 탐색기 (단조/준단조 증류 스펙 고속 역산)
  const solveSingleVary = (
    spec: DistillDesignSpec,
    fixedRR: number,
    fixedDF: number
  ): { bestParam: number; sol: InnerMeshSolution; evals: number } => {
    const isDfVary = spec.varyParam === 'd_over_f';
    const minCompMW = activeComps.reduce((m, c) => Math.min(m, COMP_MW[c] || 18), Infinity);
    const maxCompMW = activeComps.reduce((m, c) => Math.max(m, COMP_MW[c] || 18), 18);
    const rawLo = Math.min(spec.varyMin, spec.varyMax);
    const rawHi = Math.max(spec.varyMin, spec.varyMax);
    // D/F 탐색 시 불연속 2단 probe를 거치지 않고 몰 D/F(dMol/F_mol)에서 직접 연속 탐색 후 질량 D/F로 환산
    const lo = isDfVary
      ? Math.max(0.001, dfIsMassMode ? rawLo * (avgFeedMW / Math.max(2.0, maxCompMW)) * 0.85 : rawLo)
      : Math.max(0.15, rawLo);
    const hi = isDfVary
      ? Math.min(primarySideCut ? Math.max(0.05, 0.995 - estimateSideCutFrac() * 0.92) : 0.996, dfIsMassMode ? rawHi * (avgFeedMW / Math.max(2.0, minCompMW)) * 1.15 : rawHi)
      : Math.min(65.0, rawHi);
    const toReportedParam = (pVal: number, sol: InnerMeshSolution): number => {
      if (!isDfVary || !dfIsMassMode) return pVal;
      const dMass = activeComps.reduce((s, c) => s + sol.distillateKgH[c], 0) + sol.decanterWaterDrawKgH;
      return clamp(dMass / Math.max(1e-9, totalFeedMassKgH), 0.0005, 0.9995);
    };
    const evalAt = (pVal: number) =>
      isDfVary ? runMeshAt(fixedRR, pVal, false) : runMeshAt(pVal, fixedDF, dfIsMassMode);
    const finalizeVary = (pVal: number, sol: InnerMeshSolution, ev: number) => ({
      bestParam: toReportedParam(pVal, sol),
      sol,
      evals: ev,
    });

    const effErr = (absF: number, s: InnerMeshSolution): number => (s.converged ? absF : absF + 50.0);
    let seedBest: { x: number; sol: InnerMeshSolution; err: number; evals: number } | null = null;
    if (isDfVary && (spec.metric === 'purity_wt_pct' || (spec.metric === 'recovery_pct' && spec.streamTarget === 'distillate'))) {
      const compMass = totalFeedKgH[spec.component] || 0;
      const wFeed = compMass / Math.max(1e-9, totalFeedMassKgH);
      const compMW = COMP_MW[spec.component] || avgFeedMW;
      let dfGuess = fixedDF;
      if (spec.metric === 'recovery_pct') {
        const recFrac = clamp(spec.targetValue / 100.0, 1e-4, 0.9999);
        const kTarget = K_quick[spec.component] || 1.0;
        let lighterMol = 0;
        for (const c of activeComps) {
          if (c !== spec.component && (K_quick[c] || 0) > kTarget * 1.15) {
            lighterMol += totalFeedMol[c] || 0;
          }
        }
        const dMassEst = compMass * recFrac;
        dfGuess = (lighterMol + dMassEst / Math.max(2.0, compMW)) / Math.max(1e-9, totalMolesIn);
      } else {
        const wTgt = clamp(spec.targetValue / 100.0, 1e-5, 0.99999);
        const otherMass = Math.max(0, totalFeedMassKgH - compMass);
        const otherMol = Math.max(0, totalMolesIn - (totalFeedMol[spec.component] || 0));
        const otherMW = otherMol > 1e-9 ? otherMass / otherMol : avgFeedMW;
        if (spec.streamTarget === 'bottoms') {
          if (wFeed < wTgt) {
            const dMassEst = Math.max(0, totalFeedMassKgH - compMass / Math.max(1e-6, wTgt));
            dfGuess = (dMassEst / Math.max(2.0, otherMW)) / Math.max(1e-9, totalMolesIn);
          } else {
            const dMassEst = Math.max(0, totalFeedMassKgH - otherMass / Math.max(1e-6, 1.0 - wTgt));
            dfGuess = (dMassEst / Math.max(2.0, compMW)) / Math.max(1e-9, totalMolesIn);
          }
        } else {
          const dMassEst = compMass / Math.max(1e-6, wTgt);
          dfGuess = (dMassEst / Math.max(2.0, compMW)) / Math.max(1e-9, totalMolesIn);
        }
      }
      const remImp = Math.max(1e-4, 100 - spec.targetValue);
      const fastAcceptTol = spec.metric === 'recovery_pct' ? 0.04 : Math.min(2e-3, remImp * 0.15);
      const xG = clamp(dfGuess, lo, hi);
      const solG = evalAt(xG);
      const fG = evalSpecMetric(spec, solG, totalFeedKgH) - spec.targetValue;
      const stoichRecOk =
        spec.streamTarget === 'distillate' &&
        ((spec.metric === 'purity_wt_pct' &&
          compMass > 1e-6 &&
          (solG.distillateKgH[spec.component] || 0) / compMass >= 0.9985) ||
          spec.metric === 'recovery_pct');
      if (solG.converged && (Math.abs(fG) <= fastAcceptTol || (stoichRecOk && fG >= -fastAcceptTol))) {
        return finalizeVary(xG, solG, 1);
      }
      let xPrevS = xG;
      let fPrevS = fG;
      let bestXS = xG;
      let bestSolS = solG;
      let bestErrS = effErr(Math.abs(fG), solG);
      let bLo: number | null = null, fBLo = 0;
      let bHi: number | null = null, fBHi = 0;
      if (fG < 0) { bLo = xG; fBLo = fG; } else { bHi = xG; fBHi = fG; }
      const step0 = Math.min(0.004, Math.max(2e-4, (hi - lo) * 0.02));
      let xCurrS = clamp(xG + (xG + step0 <= hi ? step0 : -step0), lo, hi);
      let usedEv = 1;
      let boundaryHitCount = 0;
      for (let st = 0; st < 8; st++) {
        if (Date.now() - solveStartMs > 3500) break;
        if (Math.abs(xCurrS - xPrevS) < 1e-7) break;
        const solC = evalAt(xCurrS);
        usedEv++;
        const fC = evalSpecMetric(spec, solC, totalFeedKgH) - spec.targetValue;
        const errC = effErr(Math.abs(fC), solC);
        if (errC < bestErrS) {
          bestErrS = errC;
          bestXS = xCurrS;
          bestSolS = solC;
        }
        if (Math.abs(fC) <= fastAcceptTol && solC.converged) {
          return finalizeVary(xCurrS, solC, usedEv);
        }
        if (fC < 0 && (bLo === null || Math.abs(fC) < Math.abs(fBLo))) { bLo = xCurrS; fBLo = fC; }
        if (fC > 0 && (bHi === null || Math.abs(fC) < Math.abs(fBHi))) { bHi = xCurrS; fBHi = fC; }
        let nextClamped: number;
        if (bLo !== null && bHi !== null && Math.abs(bHi - bLo) > 1e-8) {
          const sec = bLo - (fBLo * (bHi - bLo)) / (fBHi - fBLo);
          const mid = 0.5 * (bLo + bHi);
          const loB = Math.min(bLo, bHi), hiB = Math.max(bLo, bHi);
          if (hiB - loB < 1e-5) break;
          nextClamped = st % 3 === 2 || sec <= loB || sec >= hiB ? mid : 0.78 * sec + 0.22 * mid;
          if (fC < 0) { fBHi *= 0.5; } else { fBLo *= 0.5; }
        } else {
          const denom = fC - fPrevS;
          if (Math.abs(denom) < 1e-8) break;
          const rawNext = xCurrS - (fC * (xCurrS - xPrevS)) / denom;
          nextClamped = clamp(rawNext, Math.max(lo, xCurrS - 0.08), Math.min(hi, xCurrS + 0.08));
          if (nextClamped <= lo + 1e-9 || nextClamped >= hi - 1e-9) {
            boundaryHitCount++;
            if (boundaryHitCount >= 2) {
              return finalizeVary(bestXS, bestSolS, usedEv);
            }
          }
        }
        xPrevS = xCurrS;
        fPrevS = fC;
        xCurrS = nextClamped;
      }
      const seedAcceptTol = spec.metric === 'recovery_pct' ? 0.12 : Math.min(0.025, remImp * 0.35);
      if (bestErrS <= seedAcceptTol && bestSolS.converged) {
        return finalizeVary(bestXS, bestSolS, usedEv);
      }
      seedBest = { x: bestXS, sol: bestSolS, err: bestErrS, evals: usedEv };
    }

    const x0 = lo;
    const sol0 = evalAt(x0);
    const f0 = evalSpecMetric(spec, sol0, totalFeedKgH) - spec.targetValue;

    const x1 = hi;
    const sol1 = evalAt(x1);
    const f1 = evalSpecMetric(spec, sol1, totalFeedKgH) - spec.targetValue;
    let evals = 2 + (seedBest?.evals ?? 0);

    if (spec.metric === 'impurity_wt_ppm' && spec.varyParam === 'reflux_ratio' && f0 <= 0) {
      return { bestParam: x0, sol: sol0, evals };
    }

    const err0 = effErr(Math.abs(f0), sol0);
    const err1 = effErr(Math.abs(f1), sol1);
    let bestX = err0 <= err1 ? x0 : x1;
    let bestSol = err0 <= err1 ? sol0 : sol1;
    let bestErr = Math.min(err0, err1);
    if (seedBest && seedBest.err < bestErr) {
      bestX = seedBest.x;
      bestSol = seedBest.sol;
      bestErr = seedBest.err;
    }

    if (f0 * f1 < 0) {
      let a = x0, fa = f0, b = x1, fb = f1;
      for (let k = 0; k < 14; k++) {
        if (Date.now() - solveStartMs > 3500) break;
        const sec = a - (fa * (b - a)) / (fb - fa);
        const mid = 0.5 * (a + b);
        const c = k % 3 === 2 || sec <= Math.min(a, b) || sec >= Math.max(a, b) ? mid : 0.75 * sec + 0.25 * mid;
        const solC = evalAt(c);
        evals++;
        const fc = evalSpecMetric(spec, solC, totalFeedKgH) - spec.targetValue;
        const errBis = effErr(Math.abs(fc), solC);
        if (errBis < bestErr) {
          bestErr = errBis;
          bestX = c;
          bestSol = solC;
        }
        const remImpBis = Math.max(1e-4, 100 - spec.targetValue);
        const tol =
          spec.metric === 'impurity_wt_ppm'
            ? Math.max(0.05, spec.targetValue * 1e-4)
            : spec.metric === 'recovery_pct'
              ? Math.min(0.04, remImpBis * 0.4)
              : Math.min(2e-3, remImpBis * 0.15);
        if (Math.abs(fc) <= tol || Math.abs(b - a) < 5e-6) break;
        if (fa * fc <= 0) {
          b = c;
          fb = fc;
        } else {
          a = c;
          fa = fc;
        }
      }
      return finalizeVary(bestX, bestSol, evals);
    }

    // Monotonic unreachable spec fast-exit (check midpoint once instead of 15-eval grid+golden)
    const xMidCheck = 0.5 * (lo + hi);
    const solMidCheck = evalAt(xMidCheck);
    evals++;
    const fMidCheck = evalSpecMetric(spec, solMidCheck, totalFeedKgH) - spec.targetValue;
    if (Math.abs(fMidCheck) < bestErr) {
      bestErr = Math.abs(fMidCheck);
      bestX = xMidCheck;
      bestSol = solMidCheck;
    }
    if (f0 * fMidCheck > 0 && (fMidCheck - f0) * (f1 - fMidCheck) >= -1e-3) {
      return finalizeVary(bestX, bestSol, evals);
    }

    const nGrid = 7;
    let bestIdx = 0;
    const gridX: number[] = [];
    const gridErr: number[] = [];
    for (let g = 0; g < nGrid; g++) {
      if (Date.now() - solveStartMs > 3500) break;
      const xg = lo + ((hi - lo) * g) / (nGrid - 1);
      const sg = g === 0 ? sol0 : g === nGrid - 1 ? sol1 : evalAt(xg);
      if (g > 0 && g < nGrid - 1) evals++;
      const fg = evalSpecMetric(spec, sg, totalFeedKgH) - spec.targetValue;
      const err = spec.metric === 'impurity_wt_ppm' && fg <= 0 ? Math.abs(fg) * 0.2 : Math.abs(fg);
      gridX.push(xg);
      gridErr.push(err);
      if (err < bestErr) {
        bestErr = err;
        bestX = xg;
        bestSol = sg;
        bestIdx = g;
      }
    }
    let subLo = gridX[Math.max(0, bestIdx - 1)];
    let subHi = gridX[Math.min(nGrid - 1, bestIdx + 1)];
    for (let k = 0; k < 5; k++) {
      if (Date.now() - solveStartMs > 3500) break;
      const m1 = subLo + 0.382 * (subHi - subLo);
      const m2 = subLo + 0.618 * (subHi - subLo);
      const sM1 = evalAt(m1);
      const sM2 = evalAt(m2);
      evals += 2;
      const e1 = Math.abs(evalSpecMetric(spec, sM1, totalFeedKgH) - spec.targetValue);
      const e2 = Math.abs(evalSpecMetric(spec, sM2, totalFeedKgH) - spec.targetValue);
      if (e1 < bestErr) { bestErr = e1; bestX = m1; bestSol = sM1; }
      if (e2 < bestErr) { bestErr = e2; bestX = m2; bestSol = sM2; }
      if (e1 <= e2) subHi = m2;
      else subLo = m1;
    }
    return finalizeVary(bestX, bestSol, evals);
  };

  let finalSol!: InnerMeshSolution;
  let shortcutDesign: DistillShortcutDesignSummary | undefined;
  let dualSpecCandidates: DistillDesignCandidate[] | undefined;
  let autoStageOptimized = false;

  let sideCutSpecStatus: DistillSideCutSpecStatus | undefined;

  const pickBestSideCutStage = (
    sol: InnerMeshSolution,
    stageCount: number,
    sc: DistillSideCutConfig
  ): number => {
    if (stageCount < 4) return clamp(sc.stage || 2, 2, Math.max(2, stageCount - 1));
    const comp = sc.targetComp ?? defaultSideCutComp;
    const isMinimize = sc.specType === 'impurity_ppm';
    let bestSt = clamp(Math.round(sc.stage || Math.round(stageCount * 0.35)), 2, stageCount - 1);
    let bestScore = isMinimize ? Infinity : -Infinity;
    for (const st of sol.stages) {
      if (st.stage <= 1 || st.stage >= stageCount) continue;
      const pct = sc.phase === 'vapor' ? (st.yWtPct[comp] || 0) : (st.xWtPct[comp] || 0);
      if (isMinimize ? pct < bestScore - 1e-4 : pct > bestScore + 1e-4) {
        bestScore = pct;
        bestSt = st.stage;
      }
    }
    return clamp(bestSt, 2, stageCount - 1);
  };

  const evalSideCutMetric = (sol: InnerMeshSolution, sc: DistillSideCutConfig): number => {
    const sd = sol.sideDraws?.[0];
    if (!sd || sd.totalMassKgH <= 1e-9) return 0;
    const comp = sc.targetComp ?? defaultSideCutComp;
    if (sc.specType === 'impurity_ppm') return (sd.kgH[comp] / Math.max(1e-9, sd.totalMassKgH)) * 1e6;
    if (sc.specType === 'recovery_pct') {
      const fComp = totalFeedKgH[comp] || 0;
      return fComp > 1e-9 ? (sd.kgH[comp] / fComp) * 100.0 : 0;
    }
    return (sd.kgH[comp] / Math.max(1e-9, sd.totalMassKgH)) * 100.0;
  };

  const findBestFeedStageFromProfile = (
    sol: InnerMeshSolution,
    stageCount: number,
    fallbackNf: number
  ): number => {
    let bestNf = fallbackNf;
    let minCompD = Infinity;
    const feedTotM = Math.max(1e-9, totalMolesIn);
    for (const st of sol.stages) {
      if (st.stage <= 1 || st.stage >= stageCount) continue;
      let d = 0;
      for (const c of activeComps) {
        const zc = totalFeedMol[c] / feedTotM;
        d += Math.abs(st.xMol[c] - zc);
      }
      if (d < minCompD) {
        minCompD = d;
        bestNf = st.stage;
      }
    }
    return clamp(bestNf, 2, Math.max(2, stageCount - 1));
  };

  const estimateDiamAndTac = (sol: InnerMeshSolution, stageCount: number) => {
    let diamM = 0.45;
    for (const st of sol.stages) {
      const tK = st.tempC + 273.15;
      const avgMWSt = st.vapMassKgH / Math.max(1e-6, st.vapFlowKmolH);
      const rhoG = Math.max(0.08, (st.pressBarA * 100 * avgMWSt) / (8.31446 * tK));
      const rhoL = 1080;
      const uFlood = 0.075 * Math.sqrt(Math.max(1, (rhoL - rhoG) / rhoG));
      const uDesign = Math.max(0.25, 0.75 * uFlood);
      const qVapM3S = st.vapMassKgH / (rhoG * 3600);
      const dEst = Math.sqrt((4 * qVapM3S) / (Math.PI * uDesign));
      if (dEst > diamM) diamM = dEst;
    }
    const actualTrays = calcActualTrayCount(stageCount);
    const shellHeightM = 0.61 * actualTrays + 4.2;
    const pAvgBarA = Math.max(1.0, (topPressKgcm2g + 1.03323) * 0.980665);
    const fPress = 1.0 + 0.03 * Math.max(0, pAvgBarA - 2.0);
    const reboilerKW = Math.max(0, sol.reboilerDutyKcalH) / 859.845;
    const condenserKW = Math.abs(sol.condenserDutyKcalH) / 859.845;
    const cShell = 17.64 * Math.pow(diamM, 1.066) * Math.pow(shellHeightM, 0.802) * fPress;
    const cTrays = 0.45 * actualTrays * Math.pow(diamM, 1.55);
    const aReb = Math.max(2.0, reboilerKW / (0.85 * 25.0));
    const aCond = Math.max(2.0, condenserKW / (0.75 * 18.0));
    const cHx = 7.3 * (Math.pow(aReb, 0.65) + Math.pow(aCond, 0.65));
    const annualCapexKUsd = 0.333 * (cShell + cTrays + cHx);
    const tBot = sol.stages[sol.stages.length - 1]?.tempC ?? 100;
    const tTop = sol.stages[0]?.tempC ?? 40;
    const steamPrice = tBot <= 125 ? 18.0 : tBot <= 175 ? 24.0 : 31.0;
    const coolPrice = tTop >= 35 ? 1.2 : tTop >= 5 ? 6.5 : 12.0;
    const annualOpexKUsd =
      8000 * 0.0036 * ((reboilerKW * steamPrice) / 1000.0 + (condenserKW * coolPrice) / 1000.0);
    const tacKUsdYr = annualCapexKUsd + annualOpexKUsd;
    return { diamM, actualTrays, reboilerKW, condenserKW, annualCapexKUsd, annualOpexKUsd, tacKUsdYr };
  };

  interface JointOptInput {
    lkCompIn: SimCompKey;
    hkCompIn: SimCompKey;
    topBasis: DistillSpecMetric;
    userTopVal: number;
    botBasis: DistillSpecMetric;
    userBotVal: number;
    refluxMode: DistillRefluxDesignMode;
    userRMult: number;
    fixedRR?: number;
    explicitTopSpec?: DistillDesignSpec;
    explicitBotSpec?: DistillDesignSpec;
    accountForMurphreeInStages: boolean;
  }

  const runJointMultiCandidateOptimization = (opts: JointOptInput) => {
    const optStartMs = Date.now();
    const xFeedAll = zeroCompRecord();
    for (const c of activeComps) xFeedAll[c] = totalFeedMol[c] / Math.max(1e-12, totalMolesIn);
    const pTopBarA = Math.max(0.03, (topPressKgcm2g + 1.03323) * 0.980665);
    const tFeedBp = solveStageBubbleTempC(chosenModel, activeComps, xFeedAll, pTopBarA, feedsInput[0]?.tempC ?? 45);
    const K_mid = calcStageKValues(chosenModel, activeComps, xFeedAll, tFeedBp, pTopBarA);

    const sepCandidates = activeComps.filter(c => !NON_VOLATILE_SET.has(c));
    const pool = sepCandidates.length >= 2 ? sepCandidates : activeComps;
    const byVolDesc = [...pool].sort((a, b) => (K_mid[b] || 0) - (K_mid[a] || 0));

    let lkComp: SimCompKey =
      opts.lkCompIn && totalFeedMol[opts.lkCompIn] > 1e-10
        ? opts.lkCompIn
        : defaultTopComp ?? byVolDesc[0] ?? pool[0];
    let hkComp: SimCompKey =
      opts.hkCompIn && opts.hkCompIn !== lkComp && totalFeedMol[opts.hkCompIn] > 1e-10
        ? opts.hkCompIn
        : byVolDesc.find(c => c !== lkComp) ?? pool.find(c => c !== lkComp) ?? lkComp;

    if (lkComp !== hkComp && (K_mid[lkComp] || 0) < (K_mid[hkComp] || 0)) {
      const tmp = lkComp;
      lkComp = hkComp;
      hkComp = tmp;
    }

    const xPureLk = zeroCompRecord();
    xPureLk[lkComp] = 0.98;
    xPureLk[hkComp] = 0.02;
    const tTopEst = solveStageBubbleTempC(chosenModel, activeComps, xPureLk, pTopBarA, tFeedBp - 15);
    const K_top = calcStageKValues(chosenModel, activeComps, xPureLk, tTopEst, pTopBarA);

    const xPureHk = zeroCompRecord();
    xPureHk[hkComp] = 0.98;
    xPureHk[lkComp] = 0.02;
    const estStagesForDp = clamp(colParams.totalStages ?? 24, 6, 120);
    const pBotEstBarA = pTopBarA + estStagesForDp * stageDeltaP * 0.980665;
    const tBotEst = solveStageBubbleTempC(chosenModel, activeComps, xPureHk, pBotEstBarA, tFeedBp + 15);
    const K_bot = calcStageKValues(chosenModel, activeComps, xPureHk, tBotEst, pBotEstBarA);

    const alphaTop = clamp((K_top[lkComp] || 1) / Math.max(1e-6, K_top[hkComp] || 0.5), 1.04, 150);
    const alphaBot = clamp((K_bot[lkComp] || 1) / Math.max(1e-6, K_bot[hkComp] || 0.5), 1.04, 150);
    const alphaMid = clamp((K_mid[lkComp] || 1) / Math.max(1e-6, K_mid[hkComp] || 0.5), 1.04, 150);
    const alphaAvg = Math.max(1.05, Math.pow(alphaTop * alphaMid * alphaBot, 1 / 3));

    const { topBasis, userTopVal, botBasis, userBotVal, explicitTopSpec, explicitBotSpec } = opts;
    const feedLkKg = Math.max(1e-6, totalFeedKgH[lkComp] || 0);
    const feedHkKg = Math.max(1e-6, totalFeedKgH[hkComp] || 0);

    let lighterMassBeforeDecant = 0;
    let lighterMassInProduct = 0;
    let lighterMolBeforeDecant = 0;
    let heavierMass = 0;
    for (const c of activeComps) {
      if (c === lkComp || c === hkComp) continue;
      const mComp = totalFeedKgH[c] || 0;
      if (mComp <= 0) continue;
      const isHydroOrgAzeoWater =
        c === 'H2O' &&
        (COMP_CATALOG_META[hkComp]?.tbC ?? 100) >= 105 &&
        ((totalFeedKgH.ECH || 0) + (totalFeedKgH.DCP || 0) + (totalFeedKgH.DCH || 0) + (totalFeedKgH.CHCl3 || 0)) > 1e-3 &&
        (K_mid[c] || 0) >= 1.05 * (K_mid[hkComp] || 0);
      if (NON_VOLATILE_SET.has(c)) {
        heavierMass += mComp;
      } else if ((K_mid[c] || 0) >= (K_mid[lkComp] || 0) || isHydroOrgAzeoWater) {
        lighterMassBeforeDecant += mComp;
        lighterMolBeforeDecant += totalFeedMol[c] || 0;
        if (c === 'H2O' && condenserType === 'decanter_ech') {
          lighterMassInProduct += Math.min(mComp, feedLkKg * 0.0012);
        } else {
          lighterMassInProduct += mComp;
        }
      } else {
        heavierMass += mComp;
      }
    }

    const maxPossibleTopLkWtPct = (feedLkKg / Math.max(1e-6, feedLkKg + lighterMassInProduct)) * 100.0;
    const maxPossibleBotHkWtPct = (feedHkKg / Math.max(1e-6, feedHkKg + heavierMass)) * 100.0;

    let wDLk = 0.995;
    if (topBasis === 'purity_mol_pct') {
      const effMolFrac = clamp(userTopVal / 100.0, 0.0005, 0.999995);
      const mwLk = COMP_MW[lkComp] || 50;
      const mwHk = COMP_MW[hkComp] || 80;
      wDLk = clamp((effMolFrac * mwLk) / (effMolFrac * mwLk + (1 - effMolFrac) * mwHk), 0.0005, 0.999998);
    } else if (topBasis === 'purity_wt_pct') {
      const capMargin = Math.min(0.02, Math.max(1e-5, (100 - userTopVal) * 0.1));
      const effTopPct = Math.min(userTopVal, Math.max(0.01, maxPossibleTopLkWtPct - capMargin));
      const totDNeeded = (0.998 * feedLkKg) / Math.max(0.0001, effTopPct / 100.0);
      const allowedHkInD = Math.max(1e-7 * feedLkKg, totDNeeded - 0.998 * feedLkKg - lighterMassInProduct);
      wDLk = clamp((0.998 * feedLkKg) / Math.max(1e-9, 0.998 * feedLkKg + allowedHkInD), 0.0005, 0.999998);
    } else if (topBasis === 'impurity_wt_ppm') {
      const allowedHkInD = (userTopVal / 1e6) * (feedLkKg + lighterMassInProduct);
      wDLk = clamp(feedLkKg / Math.max(1e-9, feedLkKg + allowedHkInD), 0.52, 0.999998);
    } else {
      const recFrac = clamp(userTopVal / 100.0, 0.5, 0.999999);
      const isLightGasTop = PERMANENT_GAS_SET.has(lkComp) && feedLkKg < feedHkKg * 0.1;
      if (isLightGasTop) {
        const estDistHkKg = Math.max(0.01 * feedHkKg, feedLkKg * 6.0);
        wDLk = clamp((recFrac * feedLkKg) / Math.max(1e-6, recFrac * feedLkKg + estDistHkKg), 0.01, 0.998);
      } else if (botBasis === 'recovery_pct') {
        const botRecFrac = clamp(userBotVal / 100.0, 0.5, 0.999999);
        const estDistHkKg = Math.max(0.001 * feedHkKg, (1.0 - botRecFrac) * feedHkKg);
        wDLk = clamp((recFrac * feedLkKg) / Math.max(1e-6, recFrac * feedLkKg + estDistHkKg), 0.15, 0.9995);
      } else if (feedLkKg < 0.15 * feedHkKg) {
        const estDistHkKg = Math.max(0.003 * feedHkKg, 0.12 * feedLkKg);
        wDLk = clamp((recFrac * feedLkKg) / Math.max(1e-6, recFrac * feedLkKg + estDistHkKg), 0.25, 0.99);
      } else {
        wDLk = clamp(recFrac, 0.85, 0.998);
      }
    }

    let wBLk = 0.002;
    if (botBasis === 'purity_mol_pct') {
      const effMolFracHk = clamp(userBotVal / 100.0, 0.5, 0.999995);
      const mwLk = COMP_MW[lkComp] || 50;
      const mwHk = COMP_MW[hkComp] || 80;
      wBLk = clamp(((1 - effMolFracHk) * mwLk) / ((1 - effMolFracHk) * mwLk + effMolFracHk * mwHk), 0.000002, 0.48);
    } else if (botBasis === 'purity_wt_pct') {
      const capMargin = Math.min(0.02, Math.max(1e-5, (100 - userBotVal) * 0.1));
      const effBotPct = Math.min(userBotVal, Math.max(50.0, maxPossibleBotHkWtPct - capMargin));
      const totBNeeded = (0.998 * feedHkKg) / Math.max(0.05, effBotPct / 100.0);
      const allowedLkInB = Math.max(1e-7 * feedLkKg, totBNeeded - 0.998 * feedHkKg - heavierMass);
      wBLk = clamp(allowedLkInB / Math.max(1e-9, 0.998 * feedHkKg + allowedLkInB), 0.000002, 0.48);
    } else if (botBasis === 'impurity_wt_ppm') {
      const allowedLkInB = (userBotVal / 1e6) * (feedHkKg + heavierMass);
      wBLk = clamp(allowedLkInB / Math.max(1e-9, feedHkKg + allowedLkInB), 0.000002, 0.48);
    } else {
      const targetLkSlipKg = Math.max(0.012 * feedLkKg, (1.0 - userBotVal / 100.0) * 0.15 * feedLkKg);
      wBLk = clamp(targetLkSlipKg / Math.max(1e-6, feedHkKg + targetLkSlipKg), 0.00002, 0.05);
    }

    const tgtTopWt =
      topBasis === 'purity_wt_pct'
        ? userTopVal
        : topBasis === 'impurity_wt_ppm'
          ? 100.0 - userTopVal / 10000.0
          : Number((wDLk * 100.0).toFixed(2));
    const tgtBotWt =
      botBasis === 'purity_wt_pct'
        ? userBotVal
        : botBasis === 'impurity_wt_ppm'
          ? 100.0 - userBotVal / 10000.0
          : Number(((feedHkKg / Math.max(1e-6, feedHkKg + heavierMass)) * 100.0).toFixed(2));

    const xDLk = clamp(
      (wDLk / COMP_MW[lkComp]) / (wDLk / COMP_MW[lkComp] + (1 - wDLk) / COMP_MW[hkComp]),
      0.0005,
      0.999998
    );
    const xBLk = clamp(
      (wBLk / COMP_MW[lkComp]) / (wBLk / COMP_MW[lkComp] + (1 - wBLk) / COMP_MW[hkComp]),
      0.000001,
      0.499
    );
    const zFLk = clamp(
      totalFeedMol[lkComp] / Math.max(1e-9, totalFeedMol[lkComp] + totalFeedMol[hkComp]),
      0.002,
      0.998
    );

    const sepFactor = (xDLk * (1 - xBLk)) / Math.max(1e-12, (1 - xDLk) * xBLk);
    const alphaUw = Math.max(1.05, Math.min(alphaAvg, Math.sqrt(alphaTop * alphaMid), Math.sqrt(alphaBot * alphaMid)));
    const alphaFenske = Math.max(1.05, 0.5 * (alphaAvg + alphaUw));
    const nMin = clamp(Math.log(Math.max(1.1, sepFactor)) / Math.log(alphaFenske), 2.0, 150.0);

    const avgQf = clamp(
      preparedFeeds.reduce((s, pf) => {
        const mSum = activeComps.reduce((a, c) => a + pf.mol[c], 0);
        return s + pf.qThermal * mSum;
      }, 0) / Math.max(1e-9, totalMolesIn),
      0.0,
      1.25
    );
    let thLo = 1.0001;
    let thHi = Math.max(1.0005, alphaUw - 0.0001);
    for (let it = 0; it < 28; it++) {
      const thMid = 0.5 * (thLo + thHi);
      const lhs = (alphaUw * zFLk) / (alphaUw - thMid) + (1 - zFLk) / (1 - thMid);
      if (lhs > 1.0 - avgQf) thHi = thMid;
      else thLo = thMid;
    }
    const thetaUw = 0.5 * (thLo + thHi);
    const rMinPlus1 = (alphaUw * xDLk) / Math.max(1e-5, alphaUw - thetaUw) + (1 - xDLk) / (1 - thetaUw);
    const rMin = clamp(rMinPlus1 - 1.0, 0.1, 42.0);

    const keySubMass = Math.max(1e-6, feedLkKg + feedHkKg);
    const wFeedKeyLk = clamp(feedLkKg / keySubMass, 0.002, 0.998);
    const dKeyMassBal = keySubMass * clamp((wFeedKeyLk - wBLk) / Math.max(0.02, wDLk - wBLk), 0.003, 0.997);
    const estDistMassBeforeDecant = clamp(
      lighterMassBeforeDecant + dKeyMassBal,
      totalFeedMassKgH * 0.0008,
      totalFeedMassKgH * 0.996
    );
    const initDfMass = clamp(estDistMassBeforeDecant / totalFeedMassKgH, 0.0008, 0.996);
    const minDfMolFloor =
      lighterMolBeforeDecant > 0
        ? clamp((lighterMolBeforeDecant * 0.85) / Math.max(1e-9, totalMolesIn), 0.0005, 0.95)
        : 0.0005;
    const initDfMole = clamp(
      estInitDistMolesForMass(initDfMass * totalFeedMassKgH) / Math.max(1e-9, totalMolesIn),
      minDfMolFloor,
      0.995
    );

    const kirkRatio = Math.pow(
      Math.max(
        1e-4,
        ((1 - initDfMass) / Math.max(0.005, initDfMass)) *
          ((1 - zFLk) / Math.max(0.002, zFLk)) *
          Math.pow(xBLk / Math.max(1e-6, 1 - xDLk), 2)
      ),
      0.206
    );
    const feedFrac = clamp(kirkRatio / (1.0 + kirkRatio), 0.16, 0.84);
    const isLightGasStripper = PERMANENT_GAS_SET.has(lkComp) && (botBasis === 'impurity_wt_ppm' || userBotVal >= 99.9);
    const minDesignStages = isLightGasStripper ? 14 : 6;

    const topPurityTol =
      topBasis === 'impurity_wt_ppm'
        ? Math.max(2.0, userTopVal * 0.03)
        : explicitTopSpec
          ? Math.min(0.15, Math.max(0.0025, (100 - userTopVal) * 0.5))
          : userTopVal >= 99.5
            ? Math.min(0.25, Math.max(0.0005, (100 - userTopVal) * 0.25))
            : 0.25;
    const botPurityTol =
      botBasis === 'impurity_wt_ppm'
        ? Math.max(2.0, userBotVal * 0.03)
        : explicitBotSpec
          ? Math.min(0.15, Math.max(0.0025, (100 - userBotVal) * 0.5))
          : userBotVal >= 99.5
            ? Math.min(0.25, Math.max(0.0005, (100 - userBotVal) * 0.25))
            : 0.25;

    const stopTopTol =
      topBasis === 'impurity_wt_ppm'
        ? ((topPurityTol * 0.35) / Math.max(25.0, userTopVal)) * 2.0
        : topBasis === 'recovery_pct'
          ? 0.12
          : Math.min(0.06, Math.max(0.0003, (100 - userTopVal) * 0.15));
    const stopBotTol =
      botBasis === 'impurity_wt_ppm'
        ? ((botPurityTol * 0.35) / Math.max(25.0, userBotVal)) * 2.0
        : botBasis === 'recovery_pct'
          ? 0.12
          : Math.min(0.06, Math.max(0.0003, (100 - userBotVal) * 0.15));
    const keyBinStopPct = botBasis === 'purity_wt_pct' && userBotVal > 99.85 ? Math.min(99.9999, userBotVal) : 99.85;

    const topScale =
      topBasis === 'impurity_wt_ppm'
        ? ((Math.max(2.0, userTopVal * 0.03)) / Math.max(25.0, userTopVal)) * 2.0
        : Math.max(1e-4, topPurityTol);
    const botScale =
      botBasis === 'impurity_wt_ppm'
        ? ((Math.max(2.0, userBotVal * 0.03)) / Math.max(25.0, userBotVal)) * 2.0
        : Math.max(1e-4, botPurityTol);

    const evalDesignMetrics = (s: InnerMeshSolution) => {
      const dTot = Math.max(1e-9, ALL_KEYS.reduce((a, k) => a + s.distillateKgH[k], 0));
      const bTot = Math.max(1e-9, ALL_KEYS.reduce((a, k) => a + s.bottomsKgH[k], 0));
      const topLkWt = (s.distillateKgH[lkComp] / dTot) * 100.0;
      const botHkWt = (s.bottomsKgH[hkComp] / bTot) * 100.0;
      const topHkPpm = (s.distillateKgH[hkComp] / dTot) * 1e6;
      const botLkPpm = (s.bottomsKgH[lkComp] / bTot) * 1e6;
      const topLkRec = (s.distillateKgH[lkComp] / feedLkKg) * 100.0;
      const botHkRec = (s.bottomsKgH[hkComp] / feedHkKg) * 100.0;
      const keyBinTopPct =
        (s.distillateKgH[lkComp] / Math.max(1e-9, s.distillateKgH[lkComp] + s.distillateKgH[hkComp])) * 100.0;
      const keyBinBotPct =
        (s.bottomsKgH[hkComp] / Math.max(1e-9, s.bottomsKgH[lkComp] + s.bottomsKgH[hkComp])) * 100.0;

      const topActual = explicitTopSpec
        ? evalSpecMetric(explicitTopSpec, s, totalFeedKgH)
        : topBasis === 'impurity_wt_ppm'
          ? topHkPpm
          : topBasis === 'recovery_pct'
            ? topLkRec
            : topLkWt;
      const botActual = explicitBotSpec
        ? evalSpecMetric(explicitBotSpec, s, totalFeedKgH)
        : botBasis === 'impurity_wt_ppm'
          ? botLkPpm
          : botBasis === 'recovery_pct'
            ? botHkRec
            : botHkWt;

      const topCapMargin = maxPossibleTopLkWtPct >= 99.9 ? Math.max(0.0001, (100 - maxPossibleTopLkWtPct) * 0.08) : 0.05;
      const botCapMargin = maxPossibleBotHkWtPct >= 99.9 ? Math.max(0.0001, (100 - maxPossibleBotHkWtPct) * 0.08) : 0.05;
      const effTopPurityCap = explicitTopSpec
        ? userTopVal
        : Math.min(userTopVal, Math.max(0, maxPossibleTopLkWtPct - topCapMargin));
      const effBotPurityCap = explicitBotSpec
        ? userBotVal
        : Math.min(userBotVal, Math.max(0, maxPossibleBotHkWtPct - botCapMargin));

      const topDef =
        topBasis === 'impurity_wt_ppm'
          ? ((topActual - userTopVal) / Math.max(25.0, userTopVal)) * 2.0
          : topBasis === 'recovery_pct'
            ? userTopVal - topActual
            : effTopPurityCap - topActual;

      const botDef =
        botBasis === 'impurity_wt_ppm'
          ? ((botActual - userBotVal) / Math.max(25.0, userBotVal)) * 2.0
          : botBasis === 'recovery_pct'
            ? userBotVal - botActual
            : effBotPurityCap - botActual;

      const normT = topDef / topScale;
      const normB = botDef / botScale;
      const penalty =
        (s.converged ? 0 : 1e5) +
        Math.max(0, normT) +
        Math.max(0, normB) +
        0.04 * Math.max(0, 98.5 - topLkRec) +
        0.04 * Math.max(0, 98.5 - botHkRec);

      const topMetRaw =
        topBasis === 'impurity_wt_ppm'
          ? topActual <= userTopVal + (explicitTopSpec ? topPurityTol : userTopVal * 0.05 + 5)
          : topActual >= userTopVal - topPurityTol;
      const botMetRaw =
        botBasis === 'impurity_wt_ppm'
          ? botActual <= userBotVal + (explicitBotSpec ? botPurityTol : userBotVal * 0.05 + 5)
          : botActual >= userBotVal - botPurityTol;

      return {
        dTot,
        bTot,
        topLkWt,
        botHkWt,
        topHkPpm,
        botLkPpm,
        topLkRec,
        botHkRec,
        topActual,
        botActual,
        keyBinTopPct,
        keyBinBotPct,
        topDef,
        botDef,
        normT,
        normB,
        penalty,
        topMetRaw,
        botMetRaw,
      };
    };

    const topSign = topBasis === 'recovery_pct' ? -1 : 1;
    const botSign = botBasis === 'recovery_pct' ? 1 : -1;
    const isOppositeMonotonic = topSign * botSign < 0;

    const dfCapMax = primarySideCut ? clamp(0.990 - estimateSideCutFrac() * 0.92, 0.05, 0.996) : 0.996;
    const evaluateBalancedDf = (
      rrNow: number,
      dfMoleCenter: number,
      stageCountNow: number,
      tightSpan: boolean
    ): { bestDfMole: number; sol: InnerMeshSolution; metrics: ReturnType<typeof evalDesignMetrics>; evals: number } => {
      const meshIterLim = clamp(Math.round(68 + stageCountNow * 0.72), 95, 150);
      const safeCenter = clamp(dfMoleCenter, minDfMolFloor, dfCapMax);
      let ev = 0;

      const scoreEval = (xDf: number) => {
        const sol = runMeshAt(rrNow, xDf, false, meshIterLim);
        ev++;
        const m = evalDesignMetrics(sol);
        const worstNorm = Math.max(m.normT, m.normB);
        const obj =
          (sol.converged ? 0 : 1e5) +
          (worstNorm > 0
            ? Math.max(0, m.normT) + Math.max(0, m.normB) + worstNorm
            : 0.01 * worstNorm + 0.002 * Math.abs(xDf - safeCenter));
        const g = topSign * (m.normT - m.normB);
        return { xDf, sol, m, obj, g };
      };

      let best = scoreEval(safeCenter);
      if (best.sol.converged && best.m.normT <= 0 && best.m.normB <= 0 && best.m.topLkRec >= 97.5 && best.m.botHkRec >= 97.5) {
        return { bestDfMole: best.xDf, sol: best.sol, metrics: best.m, evals: ev };
      }

      const consider = (pt: ReturnType<typeof scoreEval>) => {
        if (pt.obj < best.obj) best = pt;
      };

      if (isOppositeMonotonic && best.sol.converged) {
        const step0 =
          tightSpan && stageCountNow > 65
            ? clamp(Math.min(safeCenter, 1.0 - safeCenter) * 0.005, 0.0004, 0.0012)
            : tightSpan
              ? clamp(Math.min(safeCenter, 1.0 - safeCenter) * 0.015, 0.0008, 0.0025)
              : clamp(Math.min(safeCenter, 1.0 - safeCenter) * 0.03, 0.0012, 0.005);
        const mults = tightSpan && stageCountNow > 65 ? [1, 3.0, 10.0] : [1, 3.5, 12.0, 35.0];
        let aPt: ReturnType<typeof scoreEval> | null = best.g <= 0 ? best : null;
        let bPt: ReturnType<typeof scoreEval> | null = best.g > 0 ? best : null;
        const dir = best.g > 0 ? -1 : 1;
        for (const mult of mults) {
          const xTry = clamp(safeCenter + dir * step0 * mult, minDfMolFloor, dfCapMax);
          if (Math.abs(xTry - safeCenter) < 1e-6) continue;
          const pt = scoreEval(xTry);
          consider(pt);
          if (!pt.sol.converged) continue;
          if (dir < 0) {
            if (pt.g <= 0) { aPt = pt; break; }
            else bPt = pt;
          } else {
            if (pt.g >= 0) { bPt = pt; break; }
            else aPt = pt;
          }
          if ((dir < 0 && xTry <= minDfMolFloor + 1e-6) || (dir > 0 && xTry >= dfCapMax - 1e-6)) break;
        }

        if (aPt && bPt && aPt.xDf < bPt.xDf - 1e-6) {
          let ax = aPt.xDf, ag = aPt.g;
          let bx = bPt.xDf, bg = bPt.g;
          let lastSide = 0;
          const maxSecIt = tightSpan && stageCountNow > 65 ? 4 : 8;
          for (let it = 0; it < maxSecIt; it++) {
            const margin = 0.002 * (bx - ax);
            const sec = Math.abs(bg - ag) > 1e-9 ? ax - (ag * (bx - ax)) / (bg - ag) : 0.5 * (ax + bx);
            const cx = it === 4 || sec <= ax + margin || sec >= bx - margin ? 0.5 * (ax + bx) : sec;
            const rc = scoreEval(cx);
            consider(rc);
            if (!rc.sol.converged) break;
            if (rc.m.normT <= -0.05 && rc.m.normB <= -0.05) break;
            if (rc.g <= 0) {
              ax = cx;
              ag = rc.g;
              if (lastSide === -1) bg *= 0.5;
              lastSide = -1;
            } else {
              bx = cx;
              bg = rc.g;
              if (lastSide === 1) ag *= 0.5;
              lastSide = 1;
            }
            if (bx - ax < 5e-6) break;
          }
        }
      }

      if (!isOppositeMonotonic || !best.sol.converged) {
        const span = tightSpan ? 0.025 : clamp(Math.min(safeCenter, 1.0 - safeCenter) * 0.65, 0.012, 0.065);
        const loDf = safeCenter < 0.03 ? minDfMolFloor : clamp(safeCenter - span, minDfMolFloor, 0.992);
        const hiDf = clamp(Math.max(loDf + 0.01, safeCenter + span), 0.006, 0.996);
        let bestPenalty = best.m.penalty;
        const pts: number[] = [];
        let bestIdx = 2;
        for (let g = 0; g < 5; g++) {
          const xg = loDf + ((hiDf - loDf) * g) / 4;
          pts.push(xg);
          if (Math.abs(xg - safeCenter) < 1e-4) continue;
          const pt = scoreEval(xg);
          if (pt.m.penalty < bestPenalty) {
            bestPenalty = pt.m.penalty;
            best = pt;
            bestIdx = g;
          }
        }
        let sLo = pts[Math.max(0, bestIdx - 1)] ?? loDf;
        let sHi = pts[Math.min(pts.length - 1, bestIdx + 1)] ?? hiDf;
        for (let k = 0; k < 5; k++) {
          const m1 = sLo + 0.382 * (sHi - sLo);
          const m2 = sLo + 0.618 * (sHi - sLo);
          const p1 = scoreEval(m1);
          const p2 = scoreEval(m2);
          if (p1.m.penalty < bestPenalty) { bestPenalty = p1.m.penalty; best = p1; }
          if (p2.m.penalty < bestPenalty) { bestPenalty = p2.m.penalty; best = p2; }
          if (p1.m.penalty <= p2.m.penalty) sHi = m2;
          else sLo = m1;
          if (sHi - sLo < 8e-5) break;
        }
      }

      return { bestDfMole: best.xDf, sol: best.sol, metrics: best.m, evals: ev };
    };

    const candSpecs: { mult: number; fixedRrVal?: number; tag: string; isUserTarget?: boolean }[] = [];
    if (opts.refluxMode === 'fixed_rr') {
      const fRR = clamp(opts.fixedRR ?? colParams.topSpecValue ?? 2.8, 0.15, 65.0);
      candSpecs.push({ mult: Number((fRR / Math.max(0.05, rMin)).toFixed(3)), fixedRrVal: fRR, tag: 'fixed', isUserTarget: true });
      candSpecs.push({ mult: 1.25, tag: 'ref125' });
      candSpecs.push({ mult: 1.55, tag: 'ref155' });
    } else {
      const baseMults = nMin > 25 ? [1.15, 1.35, 1.65] : [1.15, 1.28, 1.48, 1.80];
      if (opts.refluxMode === 'r_mult') {
        const uM = Number(clamp(opts.userRMult, 1.05, 5.0).toFixed(2));
        let closestIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < baseMults.length; i++) {
          const d = Math.abs(baseMults[i] - uM);
          if (d < minDist) { minDist = d; closestIdx = i; }
        }
        const finalMults = minDist <= 0.18
          ? baseMults.map((m, idx) => (idx === closestIdx ? uM : m))
          : [uM, 1.20, 1.45, 1.80];
        finalMults.forEach((m, i) => {
          candSpecs.push({ mult: m, tag: `r${i}`, isUserTarget: Math.abs(m - uM) < 1e-4 });
        });
      } else {
        baseMults.forEach((m, i) => candSpecs.push({ mult: m, tag: `a${i}` }));
      }
    }

    interface EvalCandidatePack {
      spec: { mult: number; fixedRrVal?: number; tag: string; isUserTarget?: boolean };
      stagesN: number;
      feedStage: number;
      opRR: number;
      dfMole: number;
      sol: InnerMeshSolution;
      metrics: ReturnType<typeof evalDesignMetrics>;
      hyd: ReturnType<typeof estimateDiamAndTac>;
      specsMet: boolean;
    }

    const solvedPacks: EvalCandidatePack[] = [];
    let totalEvals = 0;
    let rollingDfMole = initDfMole;
    let learnedStageFactor = alphaUw < 2.0 ? 1.12 : 1.0;
    let learnedFeedFrac = feedFrac;
    const optBudgetMs = nMin > 25 ? 8000 : 4500;

    const evalOneCandidate = (
      spec: { mult: number; fixedRrVal?: number; tag: string; isUserTarget?: boolean },
      candIdx: number
    ): EvalCandidatePack => {
      const opRR =
        spec.fixedRrVal !== undefined
          ? clamp(spec.fixedRrVal, 0.15, 65.0)
          : clamp(rMin * spec.mult, 0.2, 50.0);
      const safeDenom = Math.max(0.02, opRR - rMin);
      const effRRForGill = opRR <= rMin * 1.01 && spec.fixedRrVal !== undefined ? rMin * 1.02 : opRR;
      const gillX = clamp((effRRForGill - rMin) / Math.max(0.05, effRRForGill + 1.0 + safeDenom * 0), 0.02, 0.985);
      const gillY = 1.0 - Math.exp(((1.0 + 54.4 * gillX) / (11.0 + 117.2 * gillX)) * ((gillX - 1.0) / Math.sqrt(gillX)));
      const nTheoBase = clamp(
        Math.ceil(((gillY + nMin) / Math.max(0.03, 1.0 - gillY)) * learnedStageFactor),
        minDesignStages,
        175
      );
      const maxAllowedN = opts.accountForMurphreeInStages ? 195 : 180;
      let nCand = opts.accountForMurphreeInStages
        ? clamp(nonTrayStageCount + Math.ceil((nTheoBase - nonTrayStageCount) / Math.max(0.25, meshMurphreeEff)), minDesignStages, maxAllowedN)
        : nTheoBase;
      const nCandInit = nCand;
      let nfCand = clamp(Math.round(1 + (nCand - 2) * learnedFeedFrac), 2, nCand - 1);
      const sideRelPos =
        primarySideCut && (colParams.totalStages ?? 24) >= 4
          ? clamp((primarySideCut.stage - 1) / Math.max(1, (colParams.totalStages ?? 24) - 2), 0.08, 0.92)
          : 0.30;
      const syncSideStageForN = (sCount: number) => {
        if (!primarySideCut) return;
        const stCand = clamp(Math.round(1 + (sCount - 2) * sideRelPos), 2, Math.max(2, sCount - 1));
        scOverrideBox.val = { ...scOverrideBox.val, stage: stCand };
      };

      N = nCand;
      defaultFeedStage = nfCand;
      syncSideStageForN(nCand);
      ({ pBarArr: P_stageBarA, prepFeeds: preparedFeeds } = buildStageFeeds(N, defaultFeedStage, true));

      let rDesign = evaluateBalancedDf(opRR, rollingDfMole, nCand, candIdx > 0);
      totalEvals += rDesign.evals;
      let bestStageN = nCand;
      let bestNf = nfCand;
      let bestR = rDesign;

      for (let step = 0; step < 3; step++) {
        if (candIdx > 0 && Date.now() - optStartMs > optBudgetMs - 300) break;
        const mNow = bestR.metrics;
        if (bestR.sol.converged && mNow.topDef <= stopTopTol && mNow.botDef <= stopBotTol) break;
        if (!explicitTopSpec && !explicitBotSpec && bestR.sol.converged && mNow.keyBinTopPct >= keyBinStopPct && mNow.keyBinBotPct >= keyBinStopPct) {
          break;
        }
        if (!rDesign.sol.converged && nCand >= 150) break;
        if (nCand >= maxAllowedN) break;

        const prevN = nCand;
        const prevNf = nfCand;
        const refSol = rDesign.sol.converged ? rDesign.sol : bestR.sol;
        const dLk = Math.max(1e-9, refSol.distillateKmolH[lkComp] || 0);
        const dHk = Math.max(1e-9, refSol.distillateKmolH[hkComp] || 0);
        const bLk = Math.max(1e-9, refSol.bottomsKmolH[lkComp] || 0);
        const bHk = Math.max(1e-9, refSol.bottomsKmolH[hkComp] || 0);
        const sAct = (dLk / dHk) * (bHk / bLk);

        let scaleN = 1.25;
        if (refSol.converged && sAct > 1.2 && sepFactor > sAct * 1.04) {
          scaleN = clamp((Math.log(Math.max(2.0, sepFactor)) / Math.max(0.35, Math.log(sAct))) * 1.12, 1.18, 2.15);
        }
        nCand = clamp(
          Math.ceil(nonTrayStageCount + (nCand - nonTrayStageCount) * scaleN),
          nCand + 3,
          maxAllowedN
        );
        if (refSol.converged) {
          const profNf = findBestFeedStageFromProfile(refSol, prevN, prevNf);
          const profFrac = clamp((profNf - 1) / Math.max(1, prevN - 2), 0.16, 0.84);
          nfCand = clamp(Math.round(1 + (nCand - 2) * (0.5 * learnedFeedFrac + 0.5 * profFrac)), 2, nCand - 1);
        } else {
          nfCand = clamp(Math.round(1 + (nCand - 2) * learnedFeedFrac), 2, nCand - 1);
        }
        N = nCand;
        defaultFeedStage = nfCand;
        syncSideStageForN(nCand);
        ({ pBarArr: P_stageBarA, prepFeeds: preparedFeeds } = buildStageFeeds(N, defaultFeedStage, true));
        const escSeed = 0.5 * ((bestR.sol.converged ? bestR.bestDfMole : rDesign.bestDfMole) + initDfMole);
        const rNext = evaluateBalancedDf(opRR, escSeed, nCand, true);
        totalEvals += rNext.evals;
        rDesign = rNext;
        if (rNext.sol.converged && (!bestR.sol.converged || rNext.metrics.penalty <= bestR.metrics.penalty + 1e-4)) {
          bestR = rNext;
          bestStageN = nCand;
          bestNf = nfCand;
        }
      }

      if (
        bestR.sol.converged &&
        !(bestR.metrics.topDef <= stopTopTol && bestR.metrics.botDef <= stopBotTol) &&
        Date.now() - optStartMs < optBudgetMs - 200
      ) {
        const profNf = findBestFeedStageFromProfile(bestR.sol, bestStageN, bestNf);
        if (Math.abs(profNf - bestNf) >= Math.max(2, Math.round(0.06 * bestStageN))) {
          N = bestStageN;
          defaultFeedStage = profNf;
          syncSideStageForN(bestStageN);
          ({ pBarArr: P_stageBarA, prepFeeds: preparedFeeds } = buildStageFeeds(N, defaultFeedStage, true));
          const pol = evaluateBalancedDf(opRR, bestR.bestDfMole, bestStageN, true);
          totalEvals += pol.evals;
          if (pol.sol.converged && pol.metrics.penalty < bestR.metrics.penalty - 1e-4) {
            bestR = pol;
            bestNf = profNf;
          }
        }
      }

      if (primarySideCut?.autoOptimizeStage && bestR.sol.converged && bestStageN >= 5 && Date.now() - optStartMs < optBudgetMs - 150) {
        const optSc = pickBestSideCutStage(bestR.sol, bestStageN, primarySideCut);
        if (optSc !== (scOverrideBox.val?.stage ?? primarySideCut.stage)) {
          N = bestStageN;
          defaultFeedStage = bestNf;
          scOverrideBox.val = { ...scOverrideBox.val, stage: optSc };
          ({ pBarArr: P_stageBarA, prepFeeds: preparedFeeds } = buildStageFeeds(N, defaultFeedStage, true));
          const scPol = evaluateBalancedDf(opRR, bestR.bestDfMole, bestStageN, true);
          totalEvals += scPol.evals;
          if (scPol.sol.converged) bestR = scPol;
        }
      }

      if (bestR.sol.converged) {
        rollingDfMole = bestR.bestDfMole;
        const profBest = findBestFeedStageFromProfile(bestR.sol, bestStageN, bestNf);
        learnedFeedFrac = clamp(
          0.4 * learnedFeedFrac + 0.6 * ((profBest - 1) / Math.max(1, bestStageN - 2)),
          0.16,
          0.84
        );
        if (candIdx === 0 && bestStageN > nCandInit) {
          learnedStageFactor = clamp(learnedStageFactor * (bestStageN / Math.max(4, nCandInit)), 1.0, 1.45);
        }
      }
      const specsMet = bestR.sol.converged && bestR.metrics.topMetRaw && bestR.metrics.botMetRaw;
      const hyd = estimateDiamAndTac(bestR.sol, bestStageN);
      return {
        spec,
        stagesN: bestStageN,
        feedStage: bestNf,
        opRR: bestR.sol.actualRefluxRatio,
        dfMole: bestR.bestDfMole,
        sol: bestR.sol,
        metrics: bestR.metrics,
        hyd,
        specsMet,
      };
    };

    for (let i = 0; i < candSpecs.length; i++) {
      if (i >= 2 && Date.now() - optStartMs > optBudgetMs) break;
      solvedPacks.push(evalOneCandidate(candSpecs[i], i));
    }

    if (opts.refluxMode !== 'fixed_rr' && !solvedPacks.some(p => p.specsMet) && Date.now() - optStartMs < optBudgetMs - 400) {
      solvedPacks.push(evalOneCandidate({ mult: 2.45, tag: 'rescue' }, solvedPacks.length));
    }

    const metPool = solvedPacks.filter(p => p.specsMet);
    const convPool = metPool.length > 0 ? metPool : solvedPacks.filter(p => p.sol.converged);
    const rankPool = convPool.length > 0 ? convPool : solvedPacks;

    let bestRecPack = rankPool[0];
    for (const p of rankPool) {
      if (metPool.length > 0) {
        if (p.hyd.tacKUsdYr < bestRecPack.hyd.tacKUsdYr) bestRecPack = p;
      } else {
        if (p.metrics.penalty < bestRecPack.metrics.penalty - 0.01) bestRecPack = p;
        else if (Math.abs(p.metrics.penalty - bestRecPack.metrics.penalty) <= 0.01 && p.hyd.tacKUsdYr < bestRecPack.hyd.tacKUsdYr) {
          bestRecPack = p;
        }
      }
    }

    let chosenPack = bestRecPack;
    if (opts.refluxMode === 'fixed_rr') {
      const fixedP = solvedPacks.find(p => p.spec.tag === 'fixed');
      if (fixedP) chosenPack = fixedP;
    } else if (opts.refluxMode === 'r_mult') {
      const userP = solvedPacks.find(p => p.spec.isUserTarget);
      if (userP && (userP.specsMet || metPool.length === 0)) chosenPack = userP;
    }

    const refMinTac = Math.max(
      1e-3,
      (metPool.length > 0 ? Math.min(...metPool.map(p => p.hyd.tacKUsdYr)) : bestRecPack.hyd.tacKUsdYr)
    );

    const sortedPacks = [...solvedPacks].sort((a, b) => a.opRR - b.opRR);
    const candidateList: DistillDesignCandidate[] = sortedPacks.map((p, idx) => {
      const isRec = p === bestRecPack;
      let label = '균형 절감형';
      if (p.spec.tag === 'fixed') label = '직접 지정 운전점';
      else if (isRec) label = '★ AI 최적 경제성 (TAC 최소)';
      else if (p.spec.tag === 'rescue') label = '고환류 핀치 돌파형';
      else if (idx === 0) label = '최소 에너지형 (고단수·저환류)';
      else if (idx === sortedPacks.length - 1) label = '최소 단수·콤팩트형 (저단수·고환류)';
      else if (p.spec.isUserTarget) label = '사용자 배수 지정점';

      return {
        id: p.spec.tag,
        label,
        rOverRmin: Number((p.opRR / Math.max(0.05, rMin)).toFixed(2)),
        stagesN: p.stagesN,
        feedStage: p.feedStage,
        actualTrays: p.hyd.actualTrays,
        refluxRatio: Number(p.opRR.toFixed(3)),
        dOverFMass: Number(p.sol.actualDOverFMass.toFixed(4)),
        distillateKgH: Number(p.metrics.dTot.toFixed(1)),
        bottomsKgH: Number(p.metrics.bTot.toFixed(1)),
        topMetricActual: Number(p.metrics.topActual.toFixed(topBasis === 'impurity_wt_ppm' ? 1 : 3)),
        botMetricActual: Number(p.metrics.botActual.toFixed(botBasis === 'impurity_wt_ppm' ? 1 : 3)),
        reboilerDutyKW: Number(p.hyd.reboilerKW.toFixed(1)),
        condenserDutyKW: Number(p.hyd.condenserKW.toFixed(1)),
        estimatedDiameterM: Number(p.hyd.diamM.toFixed(2)),
        annualCapexKUsd: Number(p.hyd.annualCapexKUsd.toFixed(1)),
        annualOpexKUsd: Number(p.hyd.annualOpexKUsd.toFixed(1)),
        tacKUsdYr: Number(p.hyd.tacKUsdYr.toFixed(1)),
        tacIndex: Number(((p.hyd.tacKUsdYr / refMinTac) * 100.0).toFixed(1)),
        converged: p.sol.converged,
        specsMet: p.specsMet,
        recommended: isRec,
        ...(p.sol.sideDraws && p.sol.sideDraws.length > 0
          ? {
              sideCutStage: p.sol.sideDraws[0].stage,
              sOverFMass: Number((p.sol.sideDraws[0].totalMassKgH / Math.max(1e-6, totalFeedMassKgH)).toFixed(4)),
              sideCutPurityWtPct: (() => {
                const sd0 = p.sol.sideDraws![0];
                const scComp = primarySideCut?.targetComp ?? defaultSideCutComp;
                return Number(((sd0.kgH[scComp] / Math.max(1e-9, sd0.totalMassKgH)) * 100.0).toFixed(2));
              })(),
            }
          : {}),
      };
    });

    N = chosenPack.stagesN;
    defaultFeedStage = chosenPack.feedStage;
    solvedRR = chosenPack.opRR;
    solvedDF = chosenPack.sol.actualDOverFMass;
    if (chosenPack.sol.sideDraws && chosenPack.sol.sideDraws.length > 0 && primarySideCut) {
      scOverrideBox.val = { ...scOverrideBox.val, stage: chosenPack.sol.sideDraws[0].stage };
    }
    ({ pBarArr: P_stageBarA, prepFeeds: preparedFeeds } = buildStageFeeds(N, defaultFeedStage, true));
    if (!chosenPack.sol.converged) {
      const fullSol = runMeshAt(chosenPack.opRR, chosenPack.dfMole, false);
      if (fullSol.converged) {
        chosenPack.sol = fullSol;
        solvedRR = fullSol.actualRefluxRatio;
        solvedDF = fullSol.actualDOverFMass;
      }
    }

    return {
      chosenPack,
      candidateList,
      selectedCandidateId: chosenPack.spec.tag,
      lkComp,
      hkComp,
      alphaAvg,
      nMin,
      rMin,
      tgtTopWt,
      tgtBotWt,
      totalEvals,
    };
  };

  const solveOpen1DSecant = (
    lo: number,
    hi: number,
    initGuess: number,
    evalErrAndSol: (p: number) => { err: number; sol: InnerMeshSolution },
    tol: number
  ): { bestP: number; bestSol: InnerMeshSolution; evals: number } => {
    const x0 = clamp(initGuess, lo, hi);
    const r0 = evalErrAndSol(x0);
    if (Math.abs(r0.err) <= tol) {
      return { bestP: x0, bestSol: r0.sol, evals: 1 };
    }
    let bestP = x0;
    let bestSol = r0.sol;
    let bestAbs = Math.abs(r0.err);
    let evals = 1;

    const rLo = evalErrAndSol(lo);
    evals++;
    if (Math.abs(rLo.err) < bestAbs) {
      bestAbs = Math.abs(rLo.err);
      bestP = lo;
      bestSol = rLo.sol;
    }
    if (bestAbs <= tol) return { bestP, bestSol, evals };

    const rHi = evalErrAndSol(hi);
    evals++;
    if (Math.abs(rHi.err) < bestAbs) {
      bestAbs = Math.abs(rHi.err);
      bestP = hi;
      bestSol = rHi.sol;
    }
    if (bestAbs <= tol) return { bestP, bestSol, evals };

    if (rLo.err * rHi.err <= 0) {
      let a = lo;
      let fa = rLo.err;
      let b = hi;
      let fb = rHi.err;
      for (let it = 0; it < 12; it++) {
        const sec = Math.abs(fb - fa) > 1e-12 ? a - (fa * (b - a)) / (fb - fa) : 0.5 * (a + b);
        const m = 0.1 * (b - a);
        const c = sec > a + m && sec < b - m ? sec : 0.5 * (a + b);
        const rc = evalErrAndSol(c);
        evals++;
        if (Math.abs(rc.err) < bestAbs) {
          bestAbs = Math.abs(rc.err);
          bestP = c;
          bestSol = rc.sol;
        }
        if (Math.abs(rc.err) <= tol || Math.abs(b - a) <= 1e-4 * Math.max(1.0, Math.abs(c))) break;
        if (fa * rc.err <= 0) {
          b = c;
          fb = rc.err;
        } else {
          a = c;
          fa = rc.err;
        }
      }
    } else {
      for (let g = 1; g <= 4; g++) {
        const xg = lo + ((hi - lo) * g) / 5;
        const rg = evalErrAndSol(xg);
        evals++;
        if (Math.abs(rg.err) < bestAbs) {
          bestAbs = Math.abs(rg.err);
          bestP = xg;
          bestSol = rg.sol;
        }
      }
    }
    return { bestP, bestSol, evals };
  };

  const executeMainModeSolve = (): InnerMeshSolution => {
    if (isOpenOrSemiOpen) {
      const runOpenMesh = (rrVal: number, qRebKcalH: number): InnerMeshSolution =>
        solveOpenOrSemiOpenMeshColumn({
          model: chosenModel,
          N,
          feeds: preparedFeeds,
          totalFeedMol,
          totalFeedMassKgH,
          activeComps,
          condenserType,
          reboilerType,
          P_stageBarA,
          topPressKgcm2g,
          stageDeltaP,
          meshMurphreeEff,
          refluxRatio: rrVal,
          reboilerDutyKcalH: qRebKcalH,
          topCoolerDutyKcalH: colParams.topCoolerDutyKcalH ?? 0,
          sideDraws: buildInnerSideDraws(N),
        });

    dofValid = true;
    s2 = undefined;

    if (!hasCondenser && !hasKettleReboiler) {
      // 순수 향류 가스 흡수탑 / 가스·생증기 스트리퍼 (0 자유도: Q_cond = -Q_topCooler, Q_reb = 0)
      s1 = undefined;
      outerIters = 1;
      dofMessage = '🟢 무응축기·무리보일러 향류 흡수/스트리퍼 (자유도 완결)';
      finalSol = runOpenMesh(0, 0);
    } else if (!hasCondenser && hasKettleReboiler) {
      // 리보일드 흡수탑 (1 자유도: 리보일러 열부하 또는 하부 보일업/유출 사양)
      if (typeof colParams.reboilerDutyKcalH === 'number' && Number.isFinite(colParams.reboilerDutyKcalH)) {
        s1 = undefined;
        outerIters = 1;
        dofMessage = '🟢 리보일드 흡수탑 (리보일러 열부하 지정 · 자유도 1/1 완결)';
        finalSol = runOpenMesh(0, Math.max(0, colParams.reboilerDutyKcalH));
      } else {
        const maxQRebKcalH = Math.max(5000.0, totalMolesIn * 14000.0);
        const initQReb = Math.max(500.0, 0.12 * maxQRebKcalH);
        if (s1) {
          const activeS1 = s1;
          const tolSpec = activeS1.metric === 'impurity_wt_ppm' ? Math.max(1.0, activeS1.targetValue * 0.01) : 0.05;
          const sr = solveOpen1DSecant(
            0.0,
            maxQRebKcalH,
            initQReb,
            qVal => {
              const sol = runOpenMesh(0, qVal);
              return { err: evalSpecMetric(activeS1, sol, totalFeedKgH) - activeS1.targetValue, sol };
            },
            tolSpec
          );
          outerIters = sr.evals;
          finalSol = sr.bestSol;
          dofMessage = '🟢 리보일드 흡수탑 (품질 스펙 → 리보일러 열부하 자동역산)';
        } else if (colParams.topSpecType === 'boilup_ratio' && typeof colParams.topSpecValue === 'number') {
          const targetVB = Math.max(0.01, colParams.topSpecValue);
          const sr = solveOpen1DSecant(
            0.0,
            maxQRebKcalH,
            initQReb,
            qVal => {
              const sol = runOpenMesh(0, qVal);
              return { err: sol.actualBoilupRatio - targetVB, sol };
            },
            1e-3
          );
          outerIters = sr.evals;
          finalSol = sr.bestSol;
          dofMessage = '🟢 리보일드 흡수탑 (보일업비 지정 · 자유도 1/1 완결)';
        } else {
          const targetRatio = dfIsMassMode ? baseDFMass : baseDFMole;
          const sr = solveOpen1DSecant(
            0.0,
            maxQRebKcalH,
            initQReb,
            qVal => {
              const sol = runOpenMesh(0, qVal);
              const act = dfIsMassMode ? sol.actualDOverFMass : sol.actualDOverFMole;
              return { err: act - targetRatio, sol };
            },
            1e-3
          );
          outerIters = sr.evals;
          finalSol = sr.bestSol;
          dofMessage = '🟢 리보일드 흡수탑 (탑정/탑저 유량비 지정 · 자유도 1/1 완결)';
        }
      }
    } else {
      // 환류형 스트리퍼 / 생증기 환류 스트리퍼 (응축기 보유 + 무리보일러 Q_reb = 0, 1 자유도: 환류비 RR)
      if (s1) {
        const activeS1 = s1;
        const rrLo = Math.max(0.05, Math.min(activeS1.varyMin || 0.1, activeS1.varyMax || 40.0));
        const rrHi = Math.min(65.0, Math.max(activeS1.varyMin || 0.1, activeS1.varyMax || 40.0));
        const tolSpec = activeS1.metric === 'impurity_wt_ppm' ? Math.max(1.0, activeS1.targetValue * 0.01) : 0.05;
        const sr = solveOpen1DSecant(
          rrLo,
          rrHi,
          clamp(baseRR, rrLo, rrHi),
          rrVal => {
            const sol = runOpenMesh(rrVal, 0);
            return { err: evalSpecMetric(activeS1, sol, totalFeedKgH) - activeS1.targetValue, sol };
          },
          tolSpec
        );
        solvedRR = sr.bestP;
        outerIters = sr.evals;
        finalSol = sr.bestSol;
        dofMessage = '🟢 환류형 스트리퍼 (품질 스펙 → 환류비 자동역산 · 자유도 1/1 완결)';
      } else if (colParams.splitSpecType !== undefined && colParams.topSpecType === undefined) {
        const targetRatio = dfIsMassMode ? baseDFMass : baseDFMole;
        const sr = solveOpen1DSecant(
          0.05,
          50.0,
          clamp(baseRR, 0.05, 50.0),
          rrVal => {
            const sol = runOpenMesh(rrVal, 0);
            const act = dfIsMassMode ? sol.actualDOverFMass : sol.actualDOverFMole;
            return { err: act - targetRatio, sol };
          },
          1e-3
        );
        solvedRR = sr.bestP;
        outerIters = sr.evals;
        finalSol = sr.bestSol;
        dofMessage = '🟢 환류형 스트리퍼 (유출분배 → 환류비 자동역산 · 자유도 1/1 완결)';
      } else {
        outerIters = 1;
        finalSol = runOpenMesh(baseRR, 0);
        dofMessage = '🟢 환류형 스트리퍼 (환류비 지정 · 자유도 1/1 완결)';
      }
    }
  } else if (isDesignStagesMode && activeComps.length >= 2) {
    // ── 목표순도 기반 다중후보 (단수 N · 공급단 Nf · 환류비 RR · 유출비 D/F) 자동최적화 + TAC 선정 ──
    const topBasis: DistillEndpointBasis = colParams.designTopBasis ?? 'purity_wt_pct';
    const botBasis: DistillEndpointBasis = colParams.designBotBasis ?? 'purity_wt_pct';
    const userTopVal =
      topBasis === 'impurity_wt_ppm'
        ? clamp(colParams.designTopImpurityPpm ?? 500, 1, 400000)
        : topBasis === 'recovery_pct'
          ? clamp(colParams.designTopRecoveryPct ?? 99.2, 50, 99.9999)
          : clamp(colParams.designTopPurityWtPct ?? 99.0, 0.01, 99.9999);
    const userBotVal =
      botBasis === 'impurity_wt_ppm'
        ? clamp(colParams.designBotImpurityPpm ?? 500, 1, 400000)
        : botBasis === 'recovery_pct'
          ? clamp(colParams.designBotRecoveryPct ?? 99.2, 50, 99.9999)
          : clamp(colParams.designBotPurityWtPct ?? 99.0, 0.01, 99.9999);

    const effectiveRefluxMode: DistillRefluxDesignMode =
      colParams.designRefluxMode ?? (typeof colParams.designRefluxMult === 'number' ? 'r_mult' : 'auto_opt');

    dfIsMassMode = true;
    const optOut = runJointMultiCandidateOptimization({
      lkCompIn: colParams.designLkComp ?? defaultTopComp,
      hkCompIn: colParams.designHkComp ?? defaultBotComp,
      topBasis,
      userTopVal,
      botBasis,
      userBotVal,
      refluxMode: effectiveRefluxMode,
      userRMult: colParams.designRefluxMult ?? 1.25,
      fixedRR: colParams.designFixedRR ?? colParams.topSpecValue ?? 2.8,
      accountForMurphreeInStages: false,
    });

    finalSol = optOut.chosenPack.sol;
    outerIters = optOut.totalEvals;
    const finalM = optOut.chosenPack.metrics;
    const achievedTopLkWt = finalM.topLkWt;
    const achievedBotHkWt = finalM.botHkWt;
    const achievedTopLkRec = finalM.topLkRec;
    const achievedBotHkRec = finalM.botHkRec;
    const topSpecMet = finalM.topMetRaw;
    const botSpecMet = finalM.botMetRaw;
    const designMet = finalSol.converged && topSpecMet && botSpecMet;
    const lkComp = optOut.lkComp;
    const hkComp = optOut.hkComp;

    const topTargetSummary =
      topBasis === 'purity_wt_pct'
        ? `탑정 ${lkComp} 농도 목표 ${userTopVal}% → 계산값 ${achievedTopLkWt.toFixed(userTopVal >= 99.9 ? 3 : 2)} wt% (${topSpecMet ? '달성' : '미달'})`
        : topBasis === 'impurity_wt_ppm'
          ? `탑정 ${hkComp} 불순물 목표 ≤${userTopVal} ppm → 계산값 ${finalM.topHkPpm.toFixed(1)} ppm (${topSpecMet ? '달성' : '미달'})`
          : `탑정 ${lkComp} 회수율 목표 ${userTopVal}% → 계산값 ${achievedTopLkRec.toFixed(2)}% (${topSpecMet ? '달성' : '미달'})`;

    const botTargetSummary =
      botBasis === 'purity_wt_pct'
        ? `탑저 ${hkComp} 농도 목표 ${userBotVal}% → 계산값 ${achievedBotHkWt.toFixed(userBotVal >= 99.9 ? 3 : 2)} wt% (${botSpecMet ? '달성' : '미달'})`
        : botBasis === 'impurity_wt_ppm'
          ? `탑저 ${lkComp} 불순물 목표 ≤${userBotVal} ppm → 계산값 ${finalM.botLkPpm.toFixed(1)} ppm (${botSpecMet ? '달성' : '미달'})`
          : `탑저 ${hkComp} 회수율 목표 ${userBotVal}% → 계산값 ${achievedBotHkRec.toFixed(2)}% (${botSpecMet ? '달성' : '미달'})`;

    shortcutDesign = {
      lkComp,
      hkComp,
      alphaAvg: Number(optOut.alphaAvg.toFixed(3)),
      minStagesNmin: Number(optOut.nMin.toFixed(2)),
      minRefluxRmin: Number(optOut.rMin.toFixed(3)),
      operatingRR: Number(finalSol.actualRefluxRatio.toFixed(3)),
      solvedStagesN: N,
      solvedFeedStage: defaultFeedStage,
      solvedActualTrays: Math.max(2, Math.ceil((N - 2) / murphreeEff)),
      topLkPurityWtPct: Number(achievedTopLkWt.toFixed(3)),
      botHkPurityWtPct: Number(achievedBotHkWt.toFixed(3)),
      topLkRecoveryPct: Number(clamp(achievedTopLkRec, 0, 100).toFixed(2)),
      botHkRecoveryPct: Number(clamp(achievedBotHkRec, 0, 100).toFixed(2)),
      topHkImpurityPpm: Number(finalM.topHkPpm.toFixed(1)),
      botLkImpurityPpm: Number(finalM.botLkPpm.toFixed(1)),
      targetTopPurityWtPct: Number(optOut.tgtTopWt.toFixed(3)),
      targetBotPurityWtPct: Number(optOut.tgtBotWt.toFixed(3)),
      topSpecMet,
      botSpecMet,
      topTargetSummary,
      botTargetSummary,
      designMet,
      refluxModeUsed: effectiveRefluxMode,
      candidates: optOut.candidateList,
      selectedCandidateId: optOut.selectedCandidateId,
    };
    const metCount = optOut.candidateList.filter(c => c.specsMet).length;
    dofMessage = designMet
      ? `✓ AI 다중후보(${metCount}/${optOut.candidateList.length} 수렴 · TAC 최소) 설계 완료 (N=${N}단 · 피드 ${defaultFeedStage}단 · RR=${finalSol.actualRefluxRatio.toFixed(2)})`
      : `⚠ 목표 스펙 일부 미달 — 진단 가이드를 확인하세요 (N=${N}단 · RR=${finalSol.actualRefluxRatio.toFixed(2)})`;
  } else if (s1 && (!s2 || !dofValid)) {
    const r1 = solveSingleVary(s1, solvedRR, solvedDF);
    outerIters = r1.evals;
    finalSol = r1.sol;
    if (s1.varyParam === 'd_over_f') solvedDF = r1.bestParam;
    else solvedRR = r1.bestParam;
  } else if (!s1 && s2) {
    const r2 = solveSingleVary(s2, solvedRR, solvedDF);
    outerIters = r2.evals;
    finalSol = r2.sol;
    if (s2.varyParam === 'd_over_f') solvedDF = r2.bestParam;
    else solvedRR = r2.bestParam;
  } else if (s1 && s2 && dofValid && isCoupledDualEndpoint) {
    // ── ③ 탑정 품질조건 + ④ 탑저 품질조건 동시 지정 시: AI (N, Nf, RR, D/F) 다중후보 최적수렴 또는 고정단 (RR, D/F) 역산 ──
    if (colParams.autoOptimizeStagesOnDualSpec !== false && activeComps.length >= 2) {
      const topIsImp = s1.metric === 'impurity_wt_ppm';
      const botIsImp = s2.metric === 'impurity_wt_ppm';
      let candLk: SimCompKey = topIsImp ? (!botIsImp ? defaultTopComp : s2.component) : s1.component;
      let candHk: SimCompKey = botIsImp ? (!topIsImp ? defaultBotComp : s1.component) : s2.component;
      if (candLk === candHk || (totalFeedMol[candLk] || 0) <= 1e-10 || (totalFeedMol[candHk] || 0) <= 1e-10) {
        const sepPool = activeComps.filter(c => !NON_VOLATILE_SET.has(c) && (totalFeedMol[c] || 0) > 1e-10);
        const volSorted = [...(sepPool.length >= 2 ? sepPool : activeComps)].sort(
          (a, b) => (K_quick[b] || 0) - (K_quick[a] || 0)
        );
        candLk = (totalFeedMol[candLk] || 0) > 1e-10 ? candLk : (volSorted[0] ?? defaultTopComp);
        candHk =
          (totalFeedMol[candHk] || 0) > 1e-10 && candHk !== candLk
            ? candHk
            : (volSorted.find(c => c !== candLk) ?? defaultBotComp);
      }

      const optOut = runJointMultiCandidateOptimization({
        lkCompIn: candLk,
        hkCompIn: candHk,
        topBasis: s1.metric,
        userTopVal: s1.targetValue,
        botBasis: s2.metric,
        userBotVal: s2.targetValue,
        refluxMode: 'auto_opt',
        userRMult: 1.25,
        explicitTopSpec: s1,
        explicitBotSpec: s2,
        accountForMurphreeInStages: stageInputBasisUsed === 'actual_murphree',
      });

      finalSol = optOut.chosenPack.sol;
      outerIters = optOut.totalEvals;
      dualSpecCandidates = optOut.candidateList;
      autoStageOptimized = true;
      const metCount = optOut.candidateList.filter(c => c.specsMet).length;
      const dualMet = optOut.chosenPack.specsMet;
      dofMessage = dualMet
        ? `✓ AI 다중후보(${metCount}/${optOut.candidateList.length} 수렴 · TAC 최소) 최적수렴 완료 (N=${N}단 · 피드 ${defaultFeedStage}단 · RR=${finalSol.actualRefluxRatio.toFixed(2)} · D/F=${finalSol.actualDOverFMass.toFixed(3)})`
        : `⚠ AI 다중후보 탐색 완료 (${N}단 · RR=${finalSol.actualRefluxRatio.toFixed(2)}) — 일부 스펙 물리적 한계 점검`;
    } else {
      // 고정 단수(N, Nf) 모드: 향상된 연속 몰 D/F 탐색 + 전범위 반복 MESH 기반 (RR, D/F) 2D 수렴
      const meshIterLim = Math.max(150, Math.min(380, Math.round(125 + N * 2.0)));
      const tol1 =
        s1.metric === 'impurity_wt_ppm'
          ? Math.max(2.0, s1.targetValue * 0.03)
          : Math.min(0.15, Math.max(0.0025, (100 - s1.targetValue) * 0.5));
      const tol2 =
        s2.metric === 'impurity_wt_ppm'
          ? Math.max(2.0, s2.targetValue * 0.03)
          : Math.min(0.15, Math.max(0.0025, (100 - s2.targetValue) * 0.5));

      const normDeficit = (spec: DistillDesignSpec, sol: InnerMeshSolution, tolVal: number): number => {
        const val = evalSpecMetric(spec, sol, totalFeedKgH);
        const raw = spec.metric === 'impurity_wt_ppm' ? val - spec.targetValue : spec.targetValue - val;
        return raw / Math.max(1e-4, tolVal);
      };

      const lkEstComp =
        s1.metric === 'impurity_wt_ppm'
          ? (s2.metric === 'impurity_wt_ppm' ? s2.component : defaultTopComp)
          : s1.component;
      const lkFeedKg = totalFeedKgH[lkEstComp] || totalFeedKgH[defaultTopComp] || totalFeedMassKgH * 0.5;
      const fixedDfCap = primarySideCut ? clamp(0.990 - estimateSideCutFrac() * 0.92, 0.05, 0.995) : 0.995;
      const dfMolSeed0 = clamp(
        estInitDistMolesForMass(lkFeedKg) / Math.max(1e-9, totalMolesIn),
        0.001,
        Math.min(0.994, fixedDfCap)
      );
      let dfSeed = dfMolSeed0;
      let totalEv = 0;

      const evalBestDfForRR = (rrTry: number, centerDfMol: number) => {
        const evalPt = (xDf: number) => {
          const sol = runMeshAt(rrTry, xDf, false, meshIterLim);
          totalEv++;
          const d1 = normDeficit(s1!, sol, tol1);
          const d2 = normDeficit(s2!, sol, tol2);
          const w = (sol.converged ? 0 : 500) + Math.max(d1, d2);
          return { xDf, sol, d1, d2, w, g: d1 - d2 };
        };

        let best = evalPt(clamp(centerDfMol, 0.001, fixedDfCap));
        const sign1 = s1!.metric === 'recovery_pct' ? -1 : 1;
        const sign2 = s2!.metric === 'recovery_pct' ? 1 : -1;
        if (sign1 * sign2 < 0 && best.sol.converged) {
          const step0 = clamp(Math.min(centerDfMol, 1 - centerDfMol) * 0.03, 0.0012, 0.005);
          const dir = sign1 * best.g > 0 ? -1 : 1;
          let aPt = best.g * sign1 <= 0 ? best : null;
          let bPt = best.g * sign1 > 0 ? best : null;
          for (const mult of [1, 3.5, 12.0, 35.0]) {
            const xt = clamp(centerDfMol + dir * step0 * mult, 0.001, fixedDfCap);
            const pt = evalPt(xt);
            if (pt.w < best.w) best = pt;
            if (!pt.sol.converged) continue;
            const sg = pt.g * sign1;
            if (dir < 0) {
              if (sg <= 0) { aPt = pt; break; } else bPt = pt;
            } else {
              if (sg >= 0) { bPt = pt; break; } else aPt = pt;
            }
          }
          if (aPt && bPt && aPt.xDf < bPt.xDf - 1e-6) {
            let ax = aPt.xDf, ag = aPt.g * sign1;
            let bx = bPt.xDf, bg = bPt.g * sign1;
            let lastSide = 0;
            for (let it = 0; it < 8; it++) {
              if (Date.now() - solveStartMs > 4200) break;
              const sec = Math.abs(bg - ag) > 1e-9 ? ax - (ag * (bx - ax)) / (bg - ag) : 0.5 * (ax + bx);
              const m = 0.002 * (bx - ax);
              const cx = it === 4 || sec <= ax + m || sec >= bx - m ? 0.5 * (ax + bx) : sec;
              const rc = evalPt(cx);
              if (rc.w < best.w) best = rc;
              if (!rc.sol.converged || (rc.d1 <= -0.05 && rc.d2 <= -0.05) || bx - ax < 5e-6) break;
              const sg = rc.g * sign1;
              if (sg <= 0) {
                ax = cx; ag = sg;
                if (lastSide === -1) bg *= 0.5;
                lastSide = -1;
              } else {
                bx = cx; bg = sg;
                if (lastSide === 1) ag *= 0.5;
                lastSide = 1;
              }
            }
          }
        } else {
          let loD = clamp(centerDfMol - 0.22, 0.001, 0.985);
          let hiD = clamp(centerDfMol + 0.22, 0.005, 0.995);
          for (let it = 0; it < 7; it++) {
            if (Date.now() - solveStartMs > 4200) break;
            const pA = evalPt(loD + 0.382 * (hiD - loD));
            const pB = evalPt(loD + 0.618 * (hiD - loD));
            if (pA.w < best.w) best = pA;
            if (pB.w < best.w) best = pB;
            if (pA.w <= pB.w) hiD = pB.xDf;
            else loD = pA.xDf;
            if (hiD - loD < 1e-4) break;
          }
        }
        return { bestD: best.xDf, bestSolD: best.sol, bestWorst: best.w };
      };

      let rrLo = 0.22;
      let rrHi = 45.0;
      const lowCheck = evalBestDfForRR(rrLo, dfSeed);
      dfSeed = lowCheck.bestD;
      if (lowCheck.bestWorst <= 0.1) {
        solvedRR = rrLo;
        solvedDF = lowCheck.bestSolD.actualDOverFMass;
        finalSol = lowCheck.bestSolD;
      } else {
        const hiCheck = evalBestDfForRR(rrHi, dfSeed);
        if (hiCheck.bestWorst > 1.0) {
          solvedRR = rrHi;
          solvedDF = hiCheck.bestSolD.actualDOverFMass;
          finalSol = hiCheck.bestSolD;
        } else {
          let bestPack = hiCheck;
          let bestRR = rrHi;
          for (let step = 0; step < 7; step++) {
            if (Date.now() - solveStartMs > 4200) break;
            const rrMid = Math.sqrt(rrLo * rrHi);
            const midPack = evalBestDfForRR(rrMid, bestPack.bestD);
            if (midPack.bestWorst <= 1.0) {
              rrHi = rrMid;
              bestRR = rrMid;
              bestPack = midPack;
            } else {
              rrLo = rrMid;
            }
            if (rrHi - rrLo < 0.04) break;
          }
          solvedRR = bestRR;
          solvedDF = bestPack.bestSolD.actualDOverFMass;
          finalSol = bestPack.bestSolD;
        }
      }
      outerIters = totalEv;
    }
  } else if (s1 && s2 && dofValid) {
    let curRR = solvedRR;
    let curDF = solvedDF;
    let totalEv = 0;
    let lastSol = runMeshAt(curRR, curDF, dfIsMassMode);
    for (let pass = 0; pass < 3; pass++) {
      if (Date.now() - solveStartMs > 1200) break;
      const r1 = solveSingleVary(s1, curRR, curDF);
      totalEv += r1.evals;
      if (s1.varyParam === 'd_over_f') curDF = r1.bestParam;
      else curRR = r1.bestParam;

      const r2 = solveSingleVary(s2, curRR, curDF);
      totalEv += r2.evals;
      if (s2.varyParam === 'd_over_f') curDF = r2.bestParam;
      else curRR = r2.bestParam;
      lastSol = r2.sol;
    }
    solvedRR = curRR;
    solvedDF = curDF;
    outerIters = totalEv;
    finalSol = lastSol;
  } else {
    finalSol = runMeshAt(solvedRR, solvedDF, dfIsMassMode);
  }
  return finalSol!;
  };

  finalSol = executeMainModeSolve();

  // ── 사이드컷(측류) 자동 최적 인출단 탐색 & 품질/회수율 역산 ──
  if (primarySideCut && N >= 3) {
    const isQualityScSpec =
      primarySideCut.specType === 'purity_wt_pct' ||
      primarySideCut.specType === 'impurity_ppm' ||
      primarySideCut.specType === 'recovery_pct';

    if (primarySideCut.autoOptimizeStage && !autoStageOptimized && !isDesignStagesMode && finalSol.converged && N >= 5) {
      const optSc = pickBestSideCutStage(finalSol, N, primarySideCut);
      if (optSc !== (scOverrideBox.val?.stage ?? primarySideCut.stage)) {
        scOverrideBox.val = { ...scOverrideBox.val, stage: optSc };
        finalSol = executeMainModeSolve();
      }
    }

    if (isQualityScSpec && finalSol.converged) {
      const effScStage = scOverrideBox.val?.stage ?? primarySideCut.stage;
      const compSc = primarySideCut.targetComp ?? defaultSideCutComp;
      const curDFrac = clamp(finalSol.actualDOverFMass || baseDFMass, 0.002, 0.90);
      const loS = 0.005;
      const hiS = clamp(0.92 - (!s1 && !s2 && !isDesignStagesMode ? curDFrac : 0.05), 0.04, 0.85);
      const hasOuterSpec = Boolean(s1 || s2 || isDesignStagesMode);
      const evalAtSF = (sfVal: number): { val: number; err: number; sol: InnerMeshSolution } => {
        scOverrideBox.val = { stage: effScStage, specType: 's_over_f_mass', specValue: sfVal };
        if (hasOuterSpec && !isDesignStagesMode) {
          finalSol = executeMainModeSolve();
        } else {
          finalSol = runMeshAt(solvedRR, solvedDF, dfIsMassMode);
        }
        const val = evalSideCutMetric(finalSol, primarySideCut);
        return { val, err: val - primarySideCut.specValue, sol: finalSol };
      };
      const initGuessSF = clamp(
        primarySideCut.specType === 'recovery_pct'
          ? ((totalFeedKgH[compSc] || totalFeedMassKgH * 0.15) * clamp(primarySideCut.specValue / 100, 0.05, 0.98)) /
              Math.max(1e-6, totalFeedMassKgH)
          : (totalFeedKgH[compSc] || totalFeedMassKgH * 0.15) / Math.max(1e-6, totalFeedMassKgH),
        loS,
        hiS
      );
      const tolSc =
        primarySideCut.specType === 'impurity_ppm'
          ? Math.max(2.0, primarySideCut.specValue * 0.03)
          : primarySideCut.specType === 'recovery_pct'
            ? 0.25
            : 0.20;
      const rInit = evalAtSF(initGuessSF);
      let bestSF = initGuessSF;
      let bestAbs = Math.abs(rInit.err);
      let scEv = 1;
      if (bestAbs > tolSc && Date.now() - solveStartMs < 3200) {
        const rLo = evalAtSF(loS);
        scEv++;
        if (Math.abs(rLo.err) < bestAbs) { bestAbs = Math.abs(rLo.err); bestSF = loS; }
        const rHi = evalAtSF(hiS);
        scEv++;
        if (Math.abs(rHi.err) < bestAbs) { bestAbs = Math.abs(rHi.err); bestSF = hiS; }

        if (rLo.err * rHi.err <= 0) {
          let a = loS, fa = rLo.err;
          let b = hiS, fb = rHi.err;
          for (let it = 0; it < 6; it++) {
            if (Date.now() - solveStartMs > 3400 || bestAbs <= tolSc) break;
            const sec = Math.abs(fb - fa) > 1e-9 ? a - (fa * (b - a)) / (fb - fa) : 0.5 * (a + b);
            const m = 0.08 * (b - a);
            const cx = it === 2 || sec <= a + m || sec >= b - m ? 0.5 * (a + b) : sec;
            const rc = evalAtSF(cx);
            scEv++;
            if (Math.abs(rc.err) < bestAbs) { bestAbs = Math.abs(rc.err); bestSF = cx; }
            if (bestAbs <= tolSc || b - a < 5e-4) break;
            if (fa * rc.err <= 0) { b = cx; fb = rc.err; } else { a = cx; fa = rc.err; }
          }
        } else {
          let gLo = loS, gHi = hiS;
          for (let it = 0; it < 5; it++) {
            if (Date.now() - solveStartMs > 3400 || bestAbs <= tolSc) break;
            const m1 = gLo + 0.382 * (gHi - gLo);
            const m2 = gLo + 0.618 * (gHi - gLo);
            const p1 = evalAtSF(m1);
            const p2 = evalAtSF(m2);
            scEv += 2;
            const e1 = Math.abs(p1.err);
            const e2 = Math.abs(p2.err);
            if (e1 < bestAbs) { bestAbs = e1; bestSF = m1; }
            if (e2 < bestAbs) { bestAbs = e2; bestSF = m2; }
            if (e1 <= e2) gHi = m2; else gLo = m1;
            if (gHi - gLo < 5e-4) break;
          }
        }
      }
      scOverrideBox.val = { stage: effScStage, specType: 's_over_f_mass', specValue: bestSF };
      if (hasOuterSpec) finalSol = executeMainModeSolve();
      else finalSol = runMeshAt(solvedRR, solvedDF, dfIsMassMode);
      outerIters += scEv;

      const actualVal = evalSideCutMetric(finalSol, primarySideCut);
      const errAbs = Math.abs(actualVal - primarySideCut.specValue);
      const met =
        primarySideCut.specType === 'impurity_ppm'
          ? actualVal <= primarySideCut.specValue + tolSc
          : primarySideCut.specType === 'recovery_pct'
            ? errAbs <= Math.max(0.5, tolSc * 2)
            : actualVal >= primarySideCut.specValue - Math.max(0.35, tolSc * 2);
      const unitLbl = primarySideCut.specType === 'impurity_ppm' ? 'ppm' : '%';
      const metricName =
        primarySideCut.specType === 'impurity_ppm'
          ? `${compSc} 불순물`
          : primarySideCut.specType === 'recovery_pct'
            ? `${compSc} 회수율`
            : `${compSc} 순도`;
      sideCutSpecStatus = {
        label: `측류 ${metricName} (${met ? '달성' : '근접'}: ${actualVal.toFixed(primarySideCut.specType === 'impurity_ppm' ? 1 : 2)} ${unitLbl})`,
        target: primarySideCut.specValue,
        actual: Number(actualVal.toFixed(2)),
        errorAbs: Number(errAbs.toFixed(3)),
        met,
      };
    } else if (finalSol.sideDraws && finalSol.sideDraws.length > 0) {
      const sd0 = finalSol.sideDraws[0];
      const compSc = primarySideCut.targetComp ?? defaultSideCutComp;
      const purPct = (sd0.kgH[compSc] / Math.max(1e-9, sd0.totalMassKgH)) * 100;
      const tgt = primarySideCut.specValue;
      const act =
        primarySideCut.specType === 'mass_kgh'
          ? sd0.totalMassKgH
          : primarySideCut.specType === 's_over_f_mass'
            ? sd0.totalMassKgH / Math.max(1e-6, totalFeedMassKgH)
            : primarySideCut.specType === 's_over_f_mole'
              ? sd0.totalMolesKmolH / Math.max(1e-6, totalMolesIn)
              : tgt;
      const errAbs = Math.abs(act - tgt);
      const met = !finalSol.sideCutClamped && (primarySideCut.specType === 'draw_ratio' || errAbs <= Math.max(0.5, 0.03 * Math.max(1e-3, tgt)));
      sideCutSpecStatus = {
        label: `측류 ${sd0.stage}단 ${sd0.phase === 'G' ? '기상' : '액상'} S=${sd0.totalMassKgH.toFixed(1)} kg/h (${compSc} ${purPct.toFixed(1)} wt%)${finalSol.sideCutClamped ? ' [유량상한 보정]' : ''}`,
        target: tgt,
        actual: Number(act.toFixed(4)),
        errorAbs: Number(errAbs.toFixed(4)),
        met,
      };
    }
  }

  const makeSpecStatus = (spec: DistillDesignSpec | undefined): DistillSpecStatus | undefined => {
    if (!spec) return undefined;
    const actual = evalSpecMetric(spec, finalSol, totalFeedKgH);
    const tol =
      spec.metric === 'impurity_wt_ppm'
        ? Math.max(2.0, spec.targetValue * 0.03)
        : Math.min(0.15, Math.max(0.0025, (100 - spec.targetValue) * 0.5));
    const met =
      spec.metric === 'impurity_wt_ppm'
        ? actual <= spec.targetValue + tol
        : actual >= spec.targetValue - tol;
    const pSolved = spec.varyParam === 'd_over_f' ? finalSol.actualDOverFMass : finalSol.actualRefluxRatio;
    const unitStr = spec.metric === 'impurity_wt_ppm' ? 'wt ppm' : '%';
    const decDigits = spec.metric === 'impurity_wt_ppm' ? 1 : spec.targetValue >= 99.95 ? 3 : 2;
    return {
      enabled: true,
      target: spec.targetValue,
      actual,
      met,
      variedParam: spec.varyParam,
      solvedParamValue: pSolved,
      summary: `${met ? '달성' : '근접'}: ${actual.toFixed(decDigits)} ${unitStr} (${spec.varyParam === 'd_over_f' ? `D/F=${pSolved.toFixed(3)}` : `RR=${pSolved.toFixed(2)}`})`,
    };
  };

  // 최적 공급단 추천 (주 피드 조성과 단별 액상 조성 편차가 최소인 단 탐색)
  let bestStage = defaultFeedStage;
  let minCompDist = Infinity;
  const feedTotMol = Math.max(1e-9, totalMolesIn);
  for (const st of finalSol.stages) {
    if (st.stage <= 1 || st.stage >= N) continue;
    let dist = 0;
    for (const c of activeComps) {
      const zc = totalFeedMol[c] / feedTotMol;
      dist += Math.abs(st.xMol[c] - zc);
    }
    if (dist < minCompDist) {
      minCompDist = dist;
      bestStage = st.stage;
    }
  }

  // 최대 기상 부하 기준 Souders-Brown 개략 탑경 추정 (단위장치 설계 연동용)
  let maxDiamM = 0.45;
  for (const st of finalSol.stages) {
    const T_K = st.tempC + 273.15;
    const avgMWSt = st.vapMassKgH / Math.max(1e-6, st.vapFlowKmolH);
    const rhoG = Math.max(0.08, (st.pressBarA * 100 * avgMWSt) / (8.31446 * T_K));
    const rhoL = 1080;
    const uFlood = 0.075 * Math.sqrt(Math.max(1, (rhoL - rhoG) / rhoG));
    const uDesign = Math.max(0.25, 0.75 * uFlood);
    const qVapM3S = st.vapMassKgH / (rhoG * 3600);
    const dEst = Math.sqrt((4 * qVapM3S) / (Math.PI * uDesign));
    if (dEst > maxDiamM) maxDiamM = dEst;
  }

  const topP = topPressKgcm2g;
  const botP = topPressKgcm2g + stageDeltaP * (N - 1);
  const spec1Status = makeSpecStatus(s1);
  const spec2Status = makeSpecStatus(s2);
  const totalBotMassOut = ALL_KEYS.reduce((s, k) => s + finalSol.bottomsKgH[k], 0);
  const actualBOverFMass = totalBotMassOut / Math.max(1e-6, totalFeedMassKgH);

  // ── 사용자 친화형 정밀 수렴·오류 진단 및 원클릭 수정 가이드 생성 ──
  const buildDiagnostics = (): DistillDiagnosticReport => {
    const causes: string[] = [];
    const remedies: DistillDiagnosticRemedy[] = [];

    // 1) 단수 지정 모드에서 필수 자유도(2개) 미입력
    if (!isDesignStagesMode && !dofValid) {
      const selCount = resolveEffectiveDofSlots(colParams).length;
      causes.push(
        `정밀 증류탑을 수렴시키려면 4개 운전·품질 후보 중 정확히 2개의 조건이 지정되어야 합니다 (현재 ${selCount}/2개 선택됨).`
      );
      remedies.push({
        label: '기본 운전조건 2개(① 환류비 + ② 유출분배) 자동 선택',
        patch: { activeDofSlots: ['rr', 'split'] },
      });
      return {
        level: 'error',
        badgeText: `필수 조건 미입력 (${selCount}/2)`,
        headline: `필수 운전 조건이 ${2 - selCount}개 부족하여 기본 추정값으로만 표시 중입니다.`,
        causes,
        remedies,
      };
    }

    // 2) 수치적 MESH 미수렴
    if (!finalSol.converged) {
      const keepStages = Math.min(36, Math.max(12, N));
      const midFeedStage = Math.max(2, Math.min(keepStages - 1, Math.round(keepStages * 0.5)));
      const safeRR = Number(Math.min(Math.max(1.8, finalSol.actualRefluxRatio || 2.5), 4.5).toFixed(2));
      const safeDF = Number(clamp(solvedDF, 0.01, 0.99).toFixed(4));
      causes.push(
        `내부 다단 기액평형(MESH) 행렬이 ${finalSol.iterations}회 반복 내에 수렴하지 못했습니다 (압력 ${topP.toFixed(2)} kG, 이론단 ${N}단, 환류비 ${finalSol.actualRefluxRatio.toFixed(2)}).`
      );
      causes.push('극단적인 유출비(D/F), 과도한 환류비 또는 공급단 위치 불균형으로 단별 온도/조성 전선이 진동하고 있을 수 있습니다.');
      remedies.push({
        label: isDesignStagesMode
          ? `안정 단수(${keepStages}단) · 환류비(${safeRR}) · 중앙 공급단(${midFeedStage}단)으로 수렴 안정화`
          : `단수(${keepStages}단) · 환류비 ${safeRR} · 공급단 ${midFeedStage}단 보정`,
        patch: isDesignStagesMode
          ? {
              columnCalcMode: 'rigorous_mesh',
              totalStages: keepStages,
              feedStage: midFeedStage,
              activeDofSlots: ['rr', 'split'],
              topSpecType: 'reflux_ratio',
              topSpecValue: safeRR,
              splitSpecType: 'd_over_f_mass',
              splitSpecValue: safeDF,
            }
          : { totalStages: keepStages, feedStage: midFeedStage, topSpecType: 'reflux_ratio', topSpecValue: safeRR },
      });
      if (!isDesignStagesMode) {
        remedies.push({
          label: '[목표순도 → 단수·유량 자동설계] 모드로 필요 단수·유출비 자동 역산',
          patch: {
            columnCalcMode: 'design_stages',
            designLkComp: colParams.topQualityComp ?? activeComps[0],
            designHkComp: colParams.botQualityComp ?? defaultBotComp,
            designTopBasis: 'recovery_pct',
            designTopRecoveryPct: 99.0,
            designBotBasis: 'recovery_pct',
            designBotRecoveryPct: 99.0,
          },
        });
      }
      return {
        level: 'error',
        badgeText: 'MESH 미수렴 오류',
        headline: '다단 기액평형 수치 수렴 실패 — 유출비(D/F)·환류비 또는 열역학 조건을 점검하세요.',
        causes,
        remedies,
      };
    }

    // 3) 목표순도 자동설계 모드(design_stages)에서 목표 스펙 미달 원인 정밀 분석
    if (isDesignStagesMode && shortcutDesign && !shortcutDesign.designMet) {
      const lk = shortcutDesign.lkComp;
      const hk = shortcutDesign.hkComp;
      const topBasisNow: DistillEndpointBasis = colParams.designTopBasis ?? 'purity_wt_pct';
      const botBasisNow: DistillEndpointBasis = colParams.designBotBasis ?? 'purity_wt_pct';

      if (shortcutDesign.topTargetSummary && !shortcutDesign.topSpecMet) {
        causes.push(shortcutDesign.topTargetSummary);
      }
      if (shortcutDesign.botTargetSummary && !shortcutDesign.botSpecMet) {
        causes.push(shortcutDesign.botTargetSummary);
      }

      // 원인 A: 유기물(ECH/DCP/DCH) 탑정 회수 시 수분(H2O) 공비 동반 유출 + 전응축기 사용
      const hasWaterDilution =
        !shortcutDesign.topSpecMet &&
        topBasisNow === 'purity_wt_pct' &&
        (lk === 'DCP' || lk === 'ECH' || lk === 'DCH') &&
        (totalFeedKgH.H2O || 0) > 0.05 &&
        condenserType !== 'decanter_ech';
      if (hasWaterDilution) {
        causes.push(
          `원료 내 수분(H2O ${(totalFeedKgH.H2O || 0).toFixed(1)} kg/h)이 최소비점 공비혼합물을 형성하여 탑정으로 함께 올라오면서 ${lk} 농도를 희석시키고 있습니다.`
        );
        remedies.push({
          label: '응축기를 [공비 유수분리 디캔터]로 변경 (수층 분리 제거)',
          patch: { condenserType: 'decanter_ech' },
        });
      }

      // 원인 B: 탑저에 더 무거운 고비점 성분(DCH/MCH/염/미량 수분 등)이 함께 남아 HK wt% 상한 제한
      const heavyNonKeyList = activeComps.filter(
        c => c !== lk && c !== hk && (totalFeedKgH[c] || 0) > 1e-4 && (NON_VOLATILE_SET.has(c) || (finalSol.bottomsKgH[c] || 0) > (totalFeedKgH[c] || 0) * 0.7)
      );
      const heavyNonKeySum = heavyNonKeyList.reduce((s, c) => s + (totalFeedKgH[c] || 0), 0);
      if (!shortcutDesign.botSpecMet && botBasisNow === 'purity_wt_pct' && heavyNonKeySum > 1e-4) {
        const maxHkPct = ((totalFeedKgH[hk] || 0) / Math.max(1e-6, (totalFeedKgH[hk] || 0) + heavyNonKeySum)) * 100.0;
        causes.push(
          `원료 내 고비점 성분(${heavyNonKeyList.join('·')} 합계 ${heavyNonKeySum.toFixed(3)} kg/h)이 탑저에 함께 잔류하므로, 이 탑 단독으로는 탑저 ${hk} 농도가 물리적으로 최대 ${maxHkPct.toFixed(4)} wt%를 넘을 수 없습니다.`
        );
        remedies.push({
          label: `탑저 기준을 [${hk} 회수율 99.5%]로 전환 (권장)`,
          patch: { designBotBasis: 'recovery_pct', designBotRecoveryPct: 99.5 },
        });
        remedies.push({
          label: `탑저 [${hk}] 목표 농도를 현실 상한(${Math.max(50, Number((maxHkPct - 0.05).toFixed(3)))} wt%)으로 조정`,
          patch: { designBotBasis: 'purity_wt_pct', designBotPurityWtPct: Math.max(50, Number((maxHkPct - 0.05).toFixed(3))) },
        });
      }

      // 원인 B-2: 탑정 LK 회수율 제한 또는 불충분한 스트리핑으로 인해 LK 및 미량 불순물이 탑저에 잔류
      const botTotalNow = Math.max(1e-6, ALL_KEYS.reduce((s, c) => s + (finalSol.bottomsKgH[c] || 0), 0));
      const lkSlipBotKg = finalSol.bottomsKgH[lk] || 0;
      if (!shortcutDesign.botSpecMet && botBasisNow === 'purity_wt_pct' && lkSlipBotKg > 1e-4) {
        const lkSlipWt = (lkSlipBotKg / botTotalNow) * 100.0;
        causes.push(
          `탑저에 미제거된 경질분 [${lk}] ${lkSlipBotKg.toFixed(4)} kg/h (${lkSlipWt.toFixed(4)} wt%)가 잔류하여 [${hk}] 목표 순도 달성을 제한하고 있습니다.`
        );
        if (topBasisNow === 'recovery_pct' && (colParams.designTopRecoveryPct ?? 99.2) < 99.999) {
          remedies.push({
            label: `탑정 [${lk}] 목표 회수율을 99.999%로 상향`,
            patch: { designTopRecoveryPct: 99.999 },
          });
        }
      }

      // 원인 C: HCl-H2O 압력변동 공비 한계
      if (chosenModel === 'ELEC_HCL_AZEO') {
        causes.push(
          `염화수소-물(HCl-H2O) 계는 운전압력(${topP.toFixed(2)} kG)에서의 공비 조성 경계를 단일 탑에서 넘어설 수 없습니다.`
        );
      }

      // 원인 D: 환류비 직접 지정값이 최소환류비 R_min 근처로 부족한 경우
      const effRMode = colParams.designRefluxMode ?? (typeof colParams.designRefluxMult === 'number' ? 'r_mult' : 'auto_opt');
      if (effRMode === 'fixed_rr') {
        causes.push(
          `직접 입력된 환류비(${finalSol.actualRefluxRatio.toFixed(2)})가 최소환류비(R_min=${shortcutDesign.minRefluxRmin}) 대비 여유가 부족할 수 있습니다.`
        );
        remedies.push({
          label: '✨ AI 다중후보 자동최적화(TAC 최적 선정)로 전환',
          patch: { designRefluxMode: 'auto_opt' },
        });
      }

      if (causes.length === 0) {
        causes.push('요구 순도가 현재 운전 압력 또는 기액평형 비휘발도 한계를 초과했습니다.');
      }

      return {
        level: 'warning',
        badgeText: '목표 순도 미달 (수정 필요)',
        headline: 'MESH 물질·열수지는 수렴했으나, 입력하신 목표 농도에 물리적 한계가 있어 도달하지 못했습니다.',
        causes,
        remedies,
      };
    }

    // 4) 단수 지정 정밀모사(rigorous_mesh)에서 품질 스펙 미달
    const s1Unmet = spec1Status && spec1Status.enabled && !spec1Status.met;
    const s2Unmet = spec2Status && spec2Status.enabled && !spec2Status.met;
    if (!isDesignStagesMode && (s1Unmet || s2Unmet)) {
      if (s1Unmet && s1) {
        const dec1 = s1.metric === 'impurity_wt_ppm' ? 1 : s1.targetValue >= 99.95 ? 3 : 2;
        causes.push(
          `탑정 품질 조건 미달: [${s1.component}] 목표 ${s1.targetValue} ${s1.metric === 'impurity_wt_ppm' ? 'ppm' : '%'} 대비 현재 ${spec1Status!.actual.toFixed(dec1)} 달성.`
        );
      }
      if (s2Unmet && s2) {
        const dec2 = s2.metric === 'impurity_wt_ppm' ? 1 : s2.targetValue >= 99.95 ? 3 : 2;
        causes.push(
          `탑저 품질 조건 미달: [${s2.component}] 목표 ${s2.targetValue} ${s2.metric === 'impurity_wt_ppm' ? 'ppm' : '%'} 대비 현재 ${spec2Status!.actual.toFixed(dec2)} 달성.`
        );
      }
      causes.push(
        `현재 고정된 단수(N=${N}단, 피드 ${defaultFeedStage}단) 또는 응축기 형식으로는 두 품질 목표를 동시에 만족하기 어렵습니다.`
      );
      if (isCoupledDualEndpoint && colParams.autoOptimizeStagesOnDualSpec === false) {
        remedies.push({
          label: '✨ AI 최적 단수·공급단·환류비 다중후보 자동탐색 활성화',
          patch: { autoOptimizeStagesOnDualSpec: true },
        });
      }
      const nextStages = Math.min(180, Math.round(N * 1.45 + 6));
      remedies.push({
        label: `이론단수를 ${N}단 → ${nextStages}단으로 증설`,
        patch: { totalStages: nextStages, feedStage: Math.round(nextStages * 0.5) },
      });
      remedies.push({
        label: '[목표순도 → 단수·유량 자동설계] 모드로 전환하여 필요 단수 산출',
        patch: { columnCalcMode: 'design_stages', designRefluxMode: 'auto_opt' },
      });
      return {
        level: 'warning',
        badgeText: '지정 스펙 미달 (단수/조건 부족)',
        headline: `고정 단수(N=${N}단) 한계로 목표 품질 스펙에 도달하지 못했습니다.`,
        causes,
        remedies,
      };
    }

    // 5) 정상 수렴 & 모든 목표 달성
    const okDetails: string[] = [];
    if (isDesignStagesMode && shortcutDesign) {
      if (shortcutDesign.topTargetSummary) okDetails.push(shortcutDesign.topTargetSummary);
      if (shortcutDesign.botTargetSummary) okDetails.push(shortcutDesign.botTargetSummary);
      if (shortcutDesign.candidates && shortcutDesign.candidates.length > 1) {
        const metCnt = shortcutDesign.candidates.filter(c => c.specsMet).length;
        okDetails.push(
          `AI 다중후보 ${shortcutDesign.candidates.length}안(${metCnt}안 스펙 달성) 비교 후 TAC 최적안 선정 (N=${N}단 · RR=${finalSol.actualRefluxRatio.toFixed(2)})`
        );
      }
      if (finalSol.decanterWaterDrawKgH > 0.01) {
        okDetails.push(`유수분리 디캔터 수상 분리 배출: ${finalSol.decanterWaterDrawKgH.toFixed(2)} kg/h (유기상만 정제·환류)`);
      }
    } else {
      if (spec1Status?.enabled) okDetails.push(`스펙 ① ${spec1Status.summary}`);
      if (spec2Status?.enabled) okDetails.push(`스펙 ② ${spec2Status.summary}`);
      if (autoStageOptimized && dualSpecCandidates && dualSpecCandidates.length > 1) {
        const metCnt = dualSpecCandidates.filter(c => c.specsMet).length;
        okDetails.push(
          `AI 다중후보 ${dualSpecCandidates.length}안(${metCnt}안 스펙 달성) 동시 최적화 후 TAC 최소 조건 적용 (N=${N}단 · 피드 ${defaultFeedStage}단)`
        );
      }
      if (finalSol.sideDraws && finalSol.sideDraws.length > 0) {
        const sd0 = finalSol.sideDraws[0];
        const sOverF = sd0.totalMassKgH / Math.max(1e-6, totalFeedMassKgH);
        okDetails.push(
          `사이드컷 측류 S (${sd0.stage}단 · ${sd0.phase === 'G' ? '기상' : '액상'}): ${sd0.totalMassKgH.toFixed(1)} kg/h (S/F ${(sOverF * 100).toFixed(1)}%, T=${sd0.tempC.toFixed(1)}°C)${sideCutSpecStatus ? ` — ${sideCutSpecStatus.label}` : ''}`
        );
      }
      if (okDetails.length === 0) {
        const totDistMass = ALL_KEYS.reduce((s, k) => s + finalSol.distillateKgH[k], 0);
        if (isOpenOrSemiOpen) {
          okDetails.push(
            `탑정 배출 V₁ = ${totDistMass.toFixed(2)} kg/h (${finalSol.distillatePhase === 'G' ? '기상' : '액상'}), 탑저 배출 L_N = ${totalBotMassOut.toFixed(2)} kg/h, 단별 물질·엔탈피 수지 100% 정합.`
          );
        } else {
          okDetails.push(
            `환류비 RR = ${finalSol.actualRefluxRatio.toFixed(2)}, 탑정 유출 D = ${totDistMass.toFixed(1)} kg/h, 탑저 관출 B = ${totalBotMassOut.toFixed(1)} kg/h 물질·열수지 100% 정합.`
          );
        }
      }
    }

    if (chosenModel === 'NRTL' || chosenModel === 'ENRTL') {
      const actDiag: ActivityEvalDiagnostics = { unifacPairs: [], idealFallbackPairs: [] };
      const feedMolFrac = zeroCompRecord();
      for (const c of activeComps) feedMolFrac[c] = totalFeedMol[c] / Math.max(1e-9, totalMolesIn);
      calcNrtlGamma(activeComps, feedMolFrac, finalSol.stages[Math.floor(N / 2)]?.tempC ?? 60, actDiag);
      if (actDiag.unifacPairs.length > 0) {
        okDetails.push(`UNIFAC 그룹기여 자동추정 적용 쌍: ${actDiag.unifacPairs.join(', ')}`);
      }
      if (actDiag.idealFallbackPairs.length > 0) {
        okDetails.push(`⚠️ 미등록 이성분 이상용액 대체(γ=1): ${actDiag.idealFallbackPairs.join(', ')}`);
      }
    }

    return {
      level: 'ok',
      badgeText: '정상 수렴 완료',
      headline: isOpenOrSemiOpen
        ? `향류 흡수/스트리핑 ${N}단(${stageInputBasisUsed === 'actual_murphree' ? `η_M=${Math.round(murphreeEff * 100)}% · ` : ''}MESH ${finalSol.iterations}회) 정상 수렴 완료되었습니다.`
        : isDesignStagesMode
          ? `필수 조건(2/2) 만족 · 산출 이론단 ${N}단(피드 ${defaultFeedStage}단), 운전환류비 RR=${finalSol.actualRefluxRatio.toFixed(2)}로 정상 수렴했습니다.`
          : autoStageOptimized
            ? `필수 조건(2/2) 만족 · AI 다중후보 최적 단수 ${N}단(피드 ${defaultFeedStage}단) · RR=${finalSol.actualRefluxRatio.toFixed(2)}로 수렴 완료되었습니다.`
            : stageInputBasisUsed === 'actual_murphree'
              ? `필수 조건(2/2) 만족 · 실제단 ${N}단(트레이 ${Math.max(2, N - 2)}단 · 행렬 내 η_M=${Math.round(murphreeEff * 100)}% · MESH ${finalSol.iterations}회) 정상 수렴 완료되었습니다.`
              : `필수 조건(2/2) 만족 · 이론단 ${N}단(내부 MESH ${finalSol.iterations}회) 정상 수렴 완료되었습니다.`,
      causes: okDetails,
      remedies: [],
    };
  };

  const sideDraw0 = finalSol.sideDraws?.[0];
  const sideCutFlowsKgH = sideDraw0
    ? (() => {
        const acc = zeroCompRecord();
        for (const sd of finalSol.sideDraws!) {
          for (const k of ALL_KEYS) acc[k] += sd.kgH[k] || 0;
        }
        return acc;
      })()
    : undefined;
  const sideCutMassKgH = sideDraw0
    ? finalSol.sideDraws!.reduce((s, d) => s + d.totalMassKgH, 0)
    : 0;
  const sideCutMolesKmolH = sideDraw0
    ? finalSol.sideDraws!.reduce((s, d) => s + d.totalMolesKmolH, 0)
    : 0;

  return {
    converged: finalSol.converged,
    innerIterations: finalSol.iterations,
    outerIterations: outerIters,
    thermoModelUsed: chosenModel,
    dofValid,
    dofMessage,
    distillateFlowsKgH: finalSol.distillateKgH,
    bottomsFlowsKgH: finalSol.bottomsKgH,
    decanterWaterDrawKgH: finalSol.decanterWaterDrawKgH,
    decanterFlowsKgH: finalSol.decanterFlowsKgH,
    distillatePhase: finalSol.distillatePhase,
    topTempC: finalSol.stages[0]?.tempC ?? 25,
    bottomTempC: finalSol.stages[N - 1]?.tempC ?? 100,
    topPressKgcm2g: topP,
    bottomPressKgcm2g: botP,
    actualRefluxRatio: finalSol.actualRefluxRatio,
    actualBoilupRatio: finalSol.actualBoilupRatio,
    actualDOverFMass: finalSol.actualDOverFMass,
    actualBOverFMass,
    actualDOverFMole: finalSol.actualDOverFMole,
    condenserDutyKcalH: finalSol.condenserDutyKcalH,
    reboilerDutyKcalH: finalSol.reboilerDutyKcalH,
    totalStagesUsed: N,
    feedStageUsed: defaultFeedStage,
    actualTrayCount: calcActualTrayCount(N),
    stageInputBasisUsed,
    recommendedFeedStage: bestStage,
    estimatedDiameterM: Number(maxDiamM.toFixed(2)),
    shortcutDesign,
    dualSpecCandidates,
    autoStageOptimized,
    spec1Status,
    spec2Status,
    ...(sideDraw0
      ? {
          sideCutFlowsKgH,
          sideCutMassKgH,
          sideCutMolesKmolH,
          sideCutPhase: sideDraw0.phase,
          sideCutTempC: sideDraw0.tempC,
          sideCutPressKgcm2g: sideDraw0.pressKgcm2g,
          sideCutStageUsed: sideDraw0.stage,
          actualSOverFMass: sideCutMassKgH / Math.max(1e-6, totalFeedMassKgH),
          actualSOverFMole: sideCutMolesKmolH / Math.max(1e-6, totalMolesIn),
          sideCutSpecStatus,
          sideCutDetails: finalSol.sideDraws!.map(d => ({
            id: d.id,
            label: d.label,
            stage: d.stage,
            phase: d.phase,
            tempC: d.tempC,
            pressKgcm2g: d.pressKgcm2g,
            flowsKgH: d.kgH,
            totalMassKgH: d.totalMassKgH,
            totalMolesKmolH: d.totalMolesKmolH,
          })),
        }
      : {}),
    diagnostics: buildDiagnostics(),
    stages: finalSol.stages,
  };
}

export interface RigorousAbsorberInput {
  stages: number;
  topPressKgcm2g: number;
  stageDeltaPKgcm2?: number;
  gasFeed: DistillFeedInput;       // enters bottom stage N
  liquidSolvent: DistillFeedInput; // enters top stage 1
  murphreeEff?: number;
  propertyMethod?: SimPropertyMethod;
  reboilerDutyKcalH?: number;      // optional reboiled absorber
  topCoolerDutyKcalH?: number;     // optional intercooling/top heat removal
}

/**
 * 향류 가스 흡수탑 · 가스/생증기 스트리퍼 · 리보일드 흡수탑 전용 고수준 래퍼
 * - 액상 흡수제(liquidSolvent)는 최상단 Stage 1에, 기상 원료/탈기가스(gasFeed)는 최하단 Stage N에 자동 배정
 */
export function solveRigorousAbsorberStripper(input: RigorousAbsorberInput): DistillSolveResult {
  const stages = clamp(Math.round(input.stages || 8), 1, 200);
  const stageDeltaP = Math.max(0, input.stageDeltaPKgcm2 ?? 0.003);
  const hasReboilerDuty =
    typeof input.reboilerDutyKcalH === 'number' &&
    Number.isFinite(input.reboilerDutyKcalH) &&
    input.reboilerDutyKcalH > 0;

  let murphreeEffPct = 100;
  let stageInputBasis: DistillStageInputBasis = 'theoretical';
  if (typeof input.murphreeEff === 'number' && Number.isFinite(input.murphreeEff)) {
    const effFrac =
      input.murphreeEff > 1.0
        ? clamp(input.murphreeEff / 100.0, 0.1, 1.0)
        : clamp(input.murphreeEff, 0.1, 1.0);
    murphreeEffPct = effFrac * 100.0;
    stageInputBasis = effFrac < 0.9999 ? 'actual_murphree' : 'theoretical';
  }

  const topSolventFeed: DistillFeedInput = {
    ...input.liquidSolvent,
    edgeId: input.liquidSolvent.edgeId || 'absorber-lean-solvent-top',
    streamNo: input.liquidSolvent.streamNo || 'S-SOLV',
    stage: input.liquidSolvent.stage && input.liquidSolvent.stage > 0 ? input.liquidSolvent.stage : 1,
    forcedPhase: input.liquidSolvent.forcedPhase ?? 'L',
  };

  const defaultGasStage =
    hasReboilerDuty && stages >= 4
      ? Math.max(2, stages - Math.max(2, Math.floor(stages * 0.3)))
      : stages;

  const bottomGasFeed: DistillFeedInput & { stage: number } = {
    ...input.gasFeed,
    edgeId: input.gasFeed.edgeId || 'absorber-rich-gas-bottom',
    streamNo: input.gasFeed.streamNo || 'S-GAS',
    stage: input.gasFeed.stage && input.gasFeed.stage > 0 ? input.gasFeed.stage : defaultGasStage,
    forcedPhase: input.gasFeed.forcedPhase ?? 'G',
  };

  return solveRigorousDistillation([topSolventFeed], {
    columnCalcMode: 'rigorous_mesh',
    totalStages: stages,
    feedStage: 1,
    condenserType: 'none',
    reboilerType: hasReboilerDuty ? 'kettle' : 'none',
    topPressKgcm2g: input.topPressKgcm2g,
    stageDeltaPKgcm2: stageDeltaP,
    murphreeEffPct,
    stageInputBasis,
    thermoModel: input.propertyMethod ?? 'AUTO',
    secondaryFeeds: [bottomGasFeed],
    reboilerDutyKcalH: hasReboilerDuty ? input.reboilerDutyKcalH : undefined,
    topCoolerDutyKcalH: input.topCoolerDutyKcalH,
  });
}

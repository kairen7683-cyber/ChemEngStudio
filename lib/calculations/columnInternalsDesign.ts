import type { SimCompKey } from './flowsheetSolver';
import type {
  DistillColumnParams,
  DistillFeedInput,
  DistillSolveResult,
  DistillStageProfile,
} from './rigorousDistillation';
import {
  designTowerMechanical,
  type MechMaterialKey,
  type TowerMechanicalResult,
  type WindExposure,
} from './mechanicalDesign';
import {
  costColumnVessel,
  costHeatExchanger,
  type ColumnCostBreakdown,
  type ColumnVesselCostInput,
  type CostMaterialKey,
  type EquipmentCostResult,
} from './equipmentCostModel';
import { friedelTwoPhaseGradient } from './twoPhaseHydraulics';

export type ColumnInternalsKind = 'tray' | 'packed';
export type TrayDeckType = 'sieve' | 'valve' | 'bubble_cap';
export type ShellSectionMode = 'uniform' | 'swaged';
export type PackingKey =
  | 'mellapak_250y'
  | 'mellapak_350y'
  | 'corrpak_ptfe_250y'
  | 'graphite_struct_250'
  | 'imtp_40_metal'
  | 'pall_ring_38_ss'
  | 'pall_ring_25_ss'
  | 'ceramic_intalox_38';

export type ShellMaterialCode =
  | 'AUTO'
  | 'CS_A516_70'
  | 'SS316L'
  | 'DUPLEX_2205'
  | 'PTFE_LINED_CS'
  | 'ALLOY_C276';

export interface ColumnInternalsParams {
  internalsKind?: ColumnInternalsKind;       // 'tray' | 'packed'
  shellSectionMode?: ShellSectionMode;       // 'uniform'(단일 직경) | 'swaged'(정류부/스트리핑부 이단 직경)
  designFloodTargetPct?: number;             // 설계 범람율 목표 % (기본 76%, 권장 65~82%)
  foamingFactor?: number;                    // 발포 보정계수 Φ_foam (0.65 ~ 1.00, 기본 0.90)
  manualRectDiamM?: number;                  // 정류부(또는 전체) 수동 지정 내경 m (0 또는 미지정 시 자동 산출)
  manualStripDiamM?: number;                 // 스트리핑부 수동 지정 내경 m (swaged 시)
  // 트레이 상세 파라미터
  trayType?: TrayDeckType;                   // 'sieve' | 'valve' | 'bubble_cap'
  traySpacingMm?: number;                    // 단 간격 (300 / 450 / 500 / 600 / 750 mm, 기본 500)
  flowPasses?: 'auto' | 1 | 2 | 4;           // 유로 패스 수 (기본 'auto')
  downcomerAreaPct?: number;                 // 다운코머 단면적 비율 Ad/AT % (기본 12%)
  weirHeightMm?: number;                     // 출구 위어 높이 hw mm (기본 50 mm)
  holeDiameterMm?: number;                   // 천공/밸브 오리피스 직경 dh mm (기본 5.0 mm, 밸브 시 38 mm)
  holeAreaPct?: number;                      // 개구율 Ah/Aa % (기본 10%)
  // 충진물 상세 파라미터
  packingKey?: PackingKey;                   // 충진물 규격 키
  maxBedHeightM?: number;                    // 베드당 최대 허용 높이 m (재분배기 간격, 기본 5.5 m)
  // 용기 기계·섬프·원가 설계 파라미터
  sumpResidenceMin?: number;                 // 탑저 섬프 체류시간 분 (기본 4.0 분)
  shellMaterial?: ShellMaterialCode;         // 동체 재질 ('AUTO' 시 부식성 자동 판별)
  windSpeedMS?: number;                      // 설계 기본풍속 m/s (기본 38 m/s)
  windExposure?: WindExposure;               // 풍하중 노풍도 ('B' | 'C' | 'D', 기본 'C')
  seismicSds?: number;                       // 단주기 지진 스펙트럼 가속도 g (기본 0.50)
  cepci?: number;                            // 장치원가 CEPCI 지수 (기본 800)
  fxKrwPerUsd?: number;                      // 환율 KRW/USD (기본 1380)
}

export interface PackingCatalogSpec {
  key: PackingKey;
  name: string;
  nominalSizeLabel?: string;     // 실무 공칭 규격 / 크림프 기하
  category: 'structured' | 'random';
  materialNote: string;
  packingFactorFpM1: number;     // Fp (1/m, ft^2/ft^3 * 3.28084)
  surfaceAreaM2M3: number;       // 비표면적 ap (m²/m³)
  voidFraction: number;          // 공극률 ε
  baseHetpM: number;             // 기준 경험식 HETP (m, 교차검증용)
  minWettingM3M2H: number;       // 최소 적심 유량 (m³/(m²·h))
  // Billet–Schultes (1999) 고유 충진물 상수
  bsCp: number;                  // 건식 압손 저항 상수 C_p
  bsCh: number;                  // 수력학 적심면적 상수 C_h
  bsCL: number;                  // 액상 물질전달 상수 C_L
  bsCV: number;                  // 기상 물질전달 상수 C_V
  bsCfl: number;                 // 범람 용량 상수 C_Fl
}

export const PACKING_CATALOG: Record<PackingKey, PackingCatalogSpec> = {
  mellapak_250y: {
    key: 'mellapak_250y',
    name: '규칙 충진물 250Y (Structured Sheet 250 m²/m³)',
    nominalSizeLabel: '250 m²/m³ · Crimp H=11.9 mm (45° Y-Channel)',
    category: 'structured',
    materialNote: 'SS316L / Duplex / Alloy C-276 — 저압손 진공 정밀증류(ECH/DCH) 표준',
    packingFactorFpM1: 66,
    surfaceAreaM2M3: 250,
    voidFraction: 0.97,
    baseHetpM: 0.41,
    minWettingM3M2H: 0.8,
    bsCp: 0.355,
    bsCh: 0.554,
    bsCL: 1.476,
    bsCV: 0.385,
    bsCfl: 1.10,
  },
  mellapak_350y: {
    key: 'mellapak_350y',
    name: '규칙 충진물 350Y (Structured Sheet 350 m²/m³)',
    nominalSizeLabel: '350 m²/m³ · Crimp H=8.5 mm (45° Y-Channel)',
    category: 'structured',
    materialNote: 'SS316L / Alloy C-276 — 고순도 박막 정제 (단수 절감형)',
    packingFactorFpM1: 95,
    surfaceAreaM2M3: 350,
    voidFraction: 0.95,
    baseHetpM: 0.31,
    minWettingM3M2H: 1.0,
    bsCp: 0.33,
    bsCh: 0.52,
    bsCL: 1.44,
    bsCV: 0.37,
    bsCfl: 1.06,
  },
  corrpak_ptfe_250y: {
    key: 'corrpak_ptfe_250y',
    name: '불소수지(PTFE/PVDF) 규칙 충진물 250Y',
    nominalSizeLabel: '240 m²/m³ · PTFE Crimp H=12 mm (45° Y)',
    category: 'structured',
    materialNote: 'PTFE / PVDF — 무수염산(AHCl)·폐염산(HCl-H₂O) 강부식 진공증류 전용',
    packingFactorFpM1: 78,
    surfaceAreaM2M3: 240,
    voidFraction: 0.94,
    baseHetpM: 0.5,
    minWettingM3M2H: 1.8,
    bsCp: 0.42,
    bsCh: 0.49,
    bsCL: 1.18,
    bsCV: 0.36,
    bsCfl: 1.02,
  },
  graphite_struct_250: {
    key: 'graphite_struct_250',
    name: '불침투 흑연(Graphite) 규칙 충진물 220Y',
    nominalSizeLabel: '220 m²/m³ · Carbon Block/Plate 45° Channel',
    category: 'structured',
    materialNote: '불침투 카본/그라파이트 — 고온 비등 염산(110°C+)·유기염소계 내부식',
    packingFactorFpM1: 88,
    surfaceAreaM2M3: 220,
    voidFraction: 0.92,
    baseHetpM: 0.48,
    minWettingM3M2H: 1.5,
    bsCp: 0.45,
    bsCh: 0.58,
    bsCL: 1.32,
    bsCV: 0.375,
    bsCfl: 1.00,
  },
  imtp_40_metal: {
    key: 'imtp_40_metal',
    name: '고성능 슬롯 링 #40 (Random Slotted Ring 40mm)',
    nominalSizeLabel: '#40 · 40 mm Nominal (1.5 in Saddle-Ring)',
    category: 'random',
    materialNote: 'SS316L / CS — 범용 증류·스트리핑 고부하 저차압 불규칙 충진물',
    packingFactorFpM1: 79,
    surfaceAreaM2M3: 151,
    voidFraction: 0.97,
    baseHetpM: 0.56,
    minWettingM3M2H: 1.2,
    bsCp: 0.632,
    bsCh: 0.68,
    bsCL: 1.42,
    bsCV: 0.415,
    bsCfl: 0.80,
  },
  pall_ring_38_ss: {
    key: 'pall_ring_38_ss',
    name: '금속 폴링 38mm (Metal Slotted Ring 38mm)',
    nominalSizeLabel: '38 mm Nominal (1.5 in · 0.6mmt)',
    category: 'random',
    materialNote: 'SS316L / Alloy — 파울링(고비점 타르/염) 저항성 우수 스트리핑부 표준',
    packingFactorFpM1: 131,
    surfaceAreaM2M3: 128,
    voidFraction: 0.95,
    baseHetpM: 0.65,
    minWettingM3M2H: 1.5,
    bsCp: 0.763,
    bsCh: 0.784,
    bsCL: 1.227,
    bsCV: 0.395,
    bsCfl: 0.66,
  },
  pall_ring_25_ss: {
    key: 'pall_ring_25_ss',
    name: '금속 폴링 25mm (Metal Slotted Ring 25mm)',
    nominalSizeLabel: '25 mm Nominal (1.0 in · 0.5mmt)',
    category: 'random',
    materialNote: 'SS316L — 중소구경 탑(Ø1.2m 이하) 범용 불규칙 충진물',
    packingFactorFpM1: 183,
    surfaceAreaM2M3: 205,
    voidFraction: 0.94,
    baseHetpM: 0.48,
    minWettingM3M2H: 1.4,
    bsCp: 0.749,
    bsCh: 0.719,
    bsCL: 1.412,
    bsCV: 0.41,
    bsCfl: 0.64,
  },
  ceramic_intalox_38: {
    key: 'ceramic_intalox_38',
    name: '세라믹 새들 38mm (Ceramic Acid Saddle 38mm)',
    nominalSizeLabel: '38 mm Nominal (1.5 in Acid Saddle)',
    category: 'random',
    materialNote: '내산 세라믹 — 습식 염소(Cl₂)·진한 염산·황산 건조/흡수/증류 내부식',
    packingFactorFpM1: 170,
    surfaceAreaM2M3: 190,
    voidFraction: 0.78,
    baseHetpM: 0.62,
    minWettingM3M2H: 2.2,
    bsCp: 0.68,
    bsCh: 0.72,
    bsCL: 1.38,
    bsCV: 0.405,
    bsCfl: 0.66,
  },
};

export type StageHydraulicStatus = 'optimal' | 'high' | 'flooding' | 'low' | 'weeping';

export interface StageHydraulicRow {
  stage: number;                   // 2 .. N-1 (내부 물질전달 단)
  section: 'rectifying' | 'stripping';
  tempC: number;
  pressBarA: number;
  vapMassKgH: number;
  liqMassKgH: number;
  rhoVapKgM3: number;
  rhoLiqKgM3: number;
  surfTensMnM: number;
  viscLiqCp: number;
  flowParamFlv: number;            // F_LV = (L/V) * sqrt(rhoV/rhoL)
  fFactorPa05: number;             // Fs = u_s * sqrt(rhoV) (Pa^0.5)
  superficialVelMS: number;        // 공탑 기상 유속 u_s (m/s)
  floodVelMS: number;              // 범람 한계 유속 (m/s)
  floodPct: number;                // 지배 % Flood (max(jetFlood, dcChokeFlood) 또는 BS flood)
  dpMmH2O: number;                 // 단당(또는 등가단 패킹) 압손 (mmH2O)
  dpMbar: number;                  // 단당(또는 등가단 패킹) 압손 (mbar)
  // 트레이 전용 지표
  jetFloodPct: number;             // Fair 제트 범람율 (%)
  dcChokeFloodPct: number;         // Glitsch 다운코머 입구 초크 범람율 (%)
  dcResidenceTimeSec: number;      // 다운코머 외관 체류시간 (s, 권장 ≥ 3~5 s)
  weirLoadM3HM: number;            // 위어 액부하 (m³/(h·m))
  weirCrestMm: number;             // 위어 월류 수두 how (mm)
  dryDropMmLiq: number;            // 건식 압손 hd (mm liq)
  valveRegime: 'closed' | 'partially_open' | 'fully_open' | 'n/a';
  dcBackupPct: number;             // 다운코머 백업율 (%)
  weepRatio: number;               // u_hole / u_weep (>1.0 이면 위핑 안전)
  weepFraction: number;            // Lockett 위핑 액누설 분율 (0 ~ 1)
  holeFroudeNumber: number;        // 천공 Froude 수 Fr_h
  entrainmentFrac: number;         // Fair 비말동반율 ψ (mol/mol gross L)
  pointEffPct: number;             // Chan–Fair 점효율 E_OG (%)
  chanFairEffPct: number;          // Chan–Fair + Lewis 혼합·비말보정 단효율 E_MV* (%)
  oconnellEffPct: number;          // O'Connell 경험식 단효율 (%)
  predictedMurphreeEffPct: number; // 대표 예측 단효율 (Chan–Fair 기반, %)
  // 충진탑 전용 지표 (Billet–Schultes 1999 + Eckert GPDC 교차검증)
  bsFloodPct: number;              // Billet–Schultes 범람율 (%)
  gpdcFloodPct: number;            // Eckert–Kister GPDC 범람율 (%)
  dryDpMbarM: number;              // 건식 단위높이 압손 ΔP_dry (mbar/m)
  specificDpMbarM: number;         // 적심 단위높이 압손 ΔP_irr (mbar/m)
  liquidHoldupFrac: number;        // Billet–Schultes 액체 홀드업 h_L (m³/m³)
  effectiveAreaRatio: number;      // 유효 물질전달 계면적비 a_e / a_p (-)
  kLMmS: number;                   // 액상 물질전달계수 k_L (mm/s)
  kGMs: number;                    // 기상 물질전달계수 k_G (m/s)
  hogM: number;                    // 총괄 기상 전달단위 높이 H_OG (m)
  wettingRateM3M2H: number;        // 액체 적심 유량 (m³/(m²·h))
  localHetpM: number;              // Billet–Schultes 국소 HETP (m)
  gpdcHetpM: number;               // 경험식 교차검증 HETP (m)
  status: StageHydraulicStatus;
  statusNote: string;
}

export interface PackedBedSpec {
  bedNumber: number;               // Top-down industrial bed numbering (1..K)
  section: 'rectifying' | 'stripping';
  sectionLabel: string;
  diameterMm: number;
  bedHeightM: number;
  bedHeightMm: number;
  hetpM: number;
  hetpMm: number;
  eqTheoreticalStages: number;
  botElMm: number;                 // Bottom elevation from Base Ring (EL 0)
  topElMm: number;                 // Top elevation from Base Ring (EL 0)
  bedDpMbar: number;
  maxFloodPct: number;
}

export interface PackingHardwareSchedule {
  topDistributor: {
    tag: string;                   // 'LD-1'
    type: string;
    dripPointsPerM2: number;
    totalDripPoints: number;
    turndownSpec: string;
    elevationMm: number;
    material: string;
  };
  redistributors: {
    count: number;
    items: Array<{
      tag: string;                 // 'RD-1', 'RD-2', ...
      location: string;
      collectorType: string;
      redistributorType: string;
      dripPointsPerM2: number;
      freeGasAreaPct: number;
      interBedHeightMm: number;
      elevationMm: number;
    }>;
  };
  supportPlates: {
    count: number;
    type: string;
    freeAreaPct: number;
    allowableLoadKgM2: number;
    elevationsMm: number[];
    material: string;
  };
  holdDownGrids: {
    count: number;
    type: string;
    freeAreaPct: number;
    elevationsMm: number[];
    material: string;
  };
  demister: {
    tag: string;                   // 'ME-1'
    type: string;
    thicknessMm: number;
    densityKgM3: number;
    elevationMm: number;
    material: string;
  };
}

export interface ColumnManholeSpec {
  tag: string;                     // 'M1', 'M2', 'M3'
  sizeDn: string;                  // 'DN500 (20")'
  flangeRating: string;            // 'ASME 150# RF'
  service: string;
  elevationMm: number;
  elevationFromBtlMm: number;
  orientationDeg: number;
}

export interface ColumnElevationMap {
  baseElMm: number;                // Base Ring EL +0
  btlElMm: number;                 // Bottom Tangent Line
  lllElMm: number;                 // Low Liquid Level (Sump)
  nllElMm: number;                 // Normal Liquid Level (Sump)
  hllElMm: number;                 // High Liquid Level (Sump)
  stripBotElMm: number;            // Bottom Tray or Bottom Bed Support Grid
  stripTopElMm: number;            // Top of Stripping Internals
  feedNozzleElMm: number;          // Feed Nozzle N3 Centerline
  sideCutNozzleElMm?: number;      // Side-Cut Nozzle N7 Centerline (if active)
  rectBotElMm: number;             // Bottom of Rectifying Internals
  rectTopElMm: number;             // Top Tray #1 or Top of Bed #1
  demisterElMm: number;            // Mist Eliminator Centerline
  ttlElMm: number;                 // Top Tangent Line
  oalElMm: number;                 // Overall Top Elevation (Top Nozzle / Crown)
}

export interface SectionGeometrySummary {
  section: 'rectifying' | 'stripping';
  label: string;
  stageStart: number;
  stageEnd: number;
  theoreticalStages: number;
  actualTraysOrBeds: number;
  requiredMinDiamM: number;
  selectedNominalDiamM: number;
  crossSectionAreaM2: number;
  activeAreaM2: number;
  downcomerAreaM2: number;
  holeAreaM2: number;
  weirLengthM: number;
  flowPathLengthM: number;
  flowPasses: 1 | 2 | 4;
  // 실무 트레이 기하·수력 상세 필드
  holeDiameterMm: number;
  holePitchMm: number;
  openAreaPctOfActive: number;
  openAreaPctOfTower: number;
  deckThicknessMm: number;
  weirType: string;
  weirHeightMm: number;
  weirLengthMm: number;
  avgWeirCrestMm: number;
  dcType: string;
  dcWidthTopMm: number;
  dcWidthBotMm: number;
  dcAreaPctOfTower: number;
  dcClearanceMm: number;
  sealPanSpec: string;
  avgDryDropMmLiq: number;
  avgTrayDpMbar: number;
  avgWeepSafetyRatio: number;
  maxDcBackupPct: number;
  maxEntrainmentPsi: number;
  operatingLoadMinPct: number;
  operatingLoadMaxPct: number;
  sectionTurndownRatio: number;
  // 실무 패킹 유체역학·적심률 상세 필드
  avgWettingRateM3M2H: number;
  minWettingRateM3M2H: number;
  wettingSafetyRatio: number;
  avgIrrigatedDpMbarM: number;
  avgDryDpMbarM: number;
  // 기존 핵심 집계 지표
  maxFloodPct: number;
  maxJetFloodPct: number;
  maxDcChokeFloodPct: number;
  minDcResidenceSec: number;
  avgChanFairEffPct: number;
  avgLiquidHoldupPct: number;
  avgHogM: number;
  gpdcFloodMaxPct: number;
  distributorDripPointsPerM2: number;
  distributorTotalDripPoints: number;
  controllingStage: number;
  sectionHeightM: number;
  sectionDpMbar: number;
  hetpAvgM: number;
}
export type SectionSizingSummary = SectionGeometrySummary;

export interface ColumnNozzleSpec {
  nozzleTag: string;
  service: string;
  phase: 'Gas/Vapor' | 'Liquid' | 'Two-Phase';
  massFlowKgH: number;
  densityKgM3: number;
  designVelMS: number;
  calcIdMm: number;
  selectedDn: string;              // 예: DN150 (6")
  rhoV2Pa: number;                 // 운동량 ρv² (Pa)
  elevationMm: number;             // Base Ring(EL +0) 기준 설치 고도 (mm)
  elevationFromBtlMm: number;      // B.T.L. 기준 상대 고도 (mm)
  orientationDeg: number;          // 노즐 방위각 (0/90/180/270°)
  flangeRating: string;            // 예: ASME 150# RFWN
  vaporQuality?: number;           // 2상 노즐 기상 질량분율 x (0..1)
  friedelDpPaPerM?: number;        // Friedel 2상 마찰압손 구배 (Pa/m)
  friedelPhiLO2?: number;          // Friedel 2상 배율 φ²_LO
  estLineDpKpa?: number;           // 인입/반송 배관(5m 등가길이)+노즐 출입 손실 (kPa)
}

export interface ColumnAuxSummary {
  condenserDutyKw: number;
  condenserEstAreaM2: number;
  reboilerDutyKw: number;
  reboilerEstAreaM2: number;
  refluxDrumDiamM: number;
  refluxDrumLengthM: number;
  refluxDrumHoldupM3: number;
  condenserCost?: EquipmentCostResult;
  reboilerCost?: EquipmentCostResult;
}

export interface ColumnInternalsSolveResult {
  internalsKind: ColumnInternalsKind;
  shellSectionMode: ShellSectionMode;
  trayType: TrayDeckType;
  trayTypeLabel: string;
  traySpacingMm: number;
  packingSpec: PackingCatalogSpec;
  rectifying: SectionGeometrySummary;
  stripping: SectionGeometrySummary;
  // 전체 집계 지표
  governingDiamM: number;
  maxFloodPct: number;
  maxJetFloodPct: number;
  maxDcChokeFloodPct: number;
  minDcResidenceTimeSec: number;
  maxFloodStage: number;
  minTurndownRatio: number;        // 운전가능 최대:최소 턴다운 비 (예: 2.8 : 1)
  operatingLoadMinPct: number;     // 최소 허용 부하율 (% of Design)
  operatingLoadMaxPct: number;     // 최대 허용 부하율 (% of Design @ 85% Flood)
  totalInternalsDpMbar: number;
  totalInternalsDpKgcm2: number;
  avgStageDpKgcm2: number;         // MESH 역반영용 단당 평균 ΔP (kgf/cm²)
  predictedOverallEffPct: number;  // MESH 역반영용 예측 평균 단효율 (Chan–Fair 기반 %)
  avgChanFairEffPct: number;
  avgOconnellEffPct: number;
  avgPackedHoldupPct: number;
  avgPackedHogM: number;
  distributorDripPointsPerM2: number;
  distributorTotalDripPoints: number;
  actualTotalTrays: number;
  packedBedCount: number;          // 충진 베드 분할 개수
  totalPackedHeightM: number;
  packedBeds: PackedBedSpec[];
  packingHardware: PackingHardwareSchedule;
  // 탑 기계·높이·고도·중량·원가 요약
  sumpResidenceMin: number;
  topDisengageHeightM: number;
  feedFlashZoneHeightM: number;
  sumpLiquidHeightM: number;
  sumpTotalHeightM: number;
  tangentToTangentHeightM: number;
  skirtHeightM: number;
  totalElevationM: number;
  elevations: ColumnElevationMap;
  lengthToDiamRatio: number;
  recommendedMaterialCode: Exclude<ShellMaterialCode, 'AUTO'>;
  recommendedMaterialLabel: string;
  materialReason: string;
  designPressBarG: number;
  designTempC: number;
  shellWallThicknessMm: number;
  vacuumStiffenerRequired: boolean;
  estimatedDryWeightTon: number;
  mechanical: TowerMechanicalResult;
  costEstimate: ColumnCostBreakdown;
  nozzles: ColumnNozzleSpec[];
  manholes: ColumnManholeSpec[];
  sideCutSummary?: {
    stage: number;
    phase: 'L' | 'G';
    massKgH: number;
    tempC: number;
    nozzleTag: string;
    elevationMm: number;
    sOverFPct: number;
  };
  auxiliaries: ColumnAuxSummary;
  stageRows: StageHydraulicRow[];
  designWarnings: string[];
  overallStatus: 'ok' | 'warning' | 'critical';
}
export type ColumnInternalsDesignResult = ColumnInternalsSolveResult;

const G_ACC = 9.80665;

// ── 표준 탑 내경 규격 테이블 (m) ──
const STANDARD_SHELL_DIAMS_M = [
  0.45, 0.55, 0.65, 0.75, 0.90, 1.05, 1.20, 1.35, 1.50, 1.65, 1.80,
  2.00, 2.20, 2.40, 2.60, 2.80, 3.00, 3.20, 3.40, 3.60, 3.80, 4.00,
  4.20, 4.50, 4.80, 5.20, 5.60, 6.00,
];

// ── 표준 배관 노즐 규격 (내경 mm → DN / NPS 표기) ──
const STANDARD_PIPE_NOZZLES: { idMm: number; label: string }[] = [
  { idMm: 26.6, label: 'DN25 (1")' },
  { idMm: 40.9, label: 'DN40 (1.5")' },
  { idMm: 52.5, label: 'DN50 (2")' },
  { idMm: 77.9, label: 'DN80 (3")' },
  { idMm: 102.3, label: 'DN100 (4")' },
  { idMm: 154.1, label: 'DN150 (6")' },
  { idMm: 202.7, label: 'DN200 (8")' },
  { idMm: 254.5, label: 'DN250 (10")' },
  { idMm: 303.2, label: 'DN300 (12")' },
  { idMm: 333.4, label: 'DN350 (14")' },
  { idMm: 381.0, label: 'DN400 (16")' },
  { idMm: 428.6, label: 'DN450 (18")' },
  { idMm: 477.8, label: 'DN500 (20")' },
  { idMm: 574.6, label: 'DN600 (24")' },
  { idMm: 679.4, label: 'DN700 (28")' },
  { idMm: 781.0, label: 'DN800 (32")' },
  { idMm: 876.0, label: 'DN900 (36")' },
];

// ── 40종 순수 성분 액상 물성 (20°C 기준 밀도 kg/m³, 표면장력 mN/m, 점도 cP) ──
interface PureLiqProps {
  rho20: number;
  dRhoDT: number;     // kg/(m³·K)
  sigma20: number;    // mN/m @ 20°C
  visc20Cp: number;   // cP @ 20°C
  viscActK: number;   // 점도 온도계수 B (K)
}

const PURE_LIQ_DB: Record<SimCompKey, PureLiqProps> = {
  H2O:        { rho20: 998,  dRhoDT: 0.42, sigma20: 72.8, visc20Cp: 1.00, viscActK: 1650 },
  HCl:        { rho20: 830,  dRhoDT: 1.60, sigma20: 23.0, visc20Cp: 0.18, viscActK: 750 },
  Cl2:        { rho20: 1408, dRhoDT: 2.35, sigma20: 18.4, visc20Cp: 0.35, viscActK: 820 },
  ECH:        { rho20: 1181, dRhoDT: 1.18, sigma20: 37.0, visc20Cp: 1.12, viscActK: 1380 },
  DCH:        { rho20: 1362, dRhoDT: 1.12, sigma20: 41.5, visc20Cp: 4.80, viscActK: 2350 },
  DCP:        { rho20: 1156, dRhoDT: 1.24, sigma20: 29.0, visc20Cp: 0.85, viscActK: 1220 },
  MCH:        { rho20: 1326, dRhoDT: 1.05, sigma20: 45.2, visc20Cp: 18.5, viscActK: 2900 },
  Glycerol:   { rho20: 1261, dRhoDT: 0.65, sigma20: 63.4, visc20Cp: 950,  viscActK: 4800 },
  NaCl:       { rho20: 2160, dRhoDT: 0.10, sigma20: 82.0, visc20Cp: 2.20, viscActK: 1500 },
  NaOH:       { rho20: 1525, dRhoDT: 0.50, sigma20: 86.0, visc20Cp: 4.50, viscActK: 1950 },
  H2SO4:      { rho20: 1830, dRhoDT: 1.02, sigma20: 55.1, visc20Cp: 24.2, viscActK: 2650 },
  NaOCl:      { rho20: 1210, dRhoDT: 0.48, sigma20: 74.0, visc20Cp: 1.80, viscActK: 1600 },
  NaClO3:     { rho20: 1650, dRhoDT: 0.30, sigma20: 78.0, visc20Cp: 2.40, viscActK: 1650 },
  FeCl2:      { rho20: 1930, dRhoDT: 0.20, sigma20: 75.0, visc20Cp: 2.50, viscActK: 1600 },
  FeCl3:      { rho20: 1850, dRhoDT: 0.25, sigma20: 75.0, visc20Cp: 2.80, viscActK: 1650 },
  PAC:        { rho20: 1350, dRhoDT: 0.35, sigma20: 74.0, visc20Cp: 8.50, viscActK: 2000 },
  H2:         { rho20: 71,   dRhoDT: 0.25, sigma20: 2.0,  visc20Cp: 0.02, viscActK: 150 },
  O2:         { rho20: 1140, dRhoDT: 1.80, sigma20: 13.2, visc20Cp: 0.15, viscActK: 500 },
  N2:         { rho20: 808,  dRhoDT: 1.70, sigma20: 8.9,  visc20Cp: 0.14, viscActK: 480 },
  CH4:        { rho20: 422,  dRhoDT: 1.60, sigma20: 10.0, visc20Cp: 0.09, viscActK: 320 },
  CO:         { rho20: 789,  dRhoDT: 1.70, sigma20: 9.0,  visc20Cp: 0.15, viscActK: 450 },
  CO2:        { rho20: 770,  dRhoDT: 2.20, sigma20: 4.5,  visc20Cp: 0.07, viscActK: 420 },
  NH3:        { rho20: 610,  dRhoDT: 1.42, sigma20: 21.0, visc20Cp: 0.14, viscActK: 680 },
  C2H4:       { rho20: 380,  dRhoDT: 1.85, sigma20: 4.2,  visc20Cp: 0.07, viscActK: 370 },
  C2H6:       { rho20: 360,  dRhoDT: 1.80, sigma20: 4.0,  visc20Cp: 0.07, viscActK: 380 },
  C3H6:       { rho20: 514,  dRhoDT: 1.48, sigma20: 7.8,  visc20Cp: 0.10, viscActK: 500 },
  C3H8:       { rho20: 500,  dRhoDT: 1.45, sigma20: 7.5,  visc20Cp: 0.11, viscActK: 520 },
  nC4H10:     { rho20: 579,  dRhoDT: 1.15, sigma20: 12.4, visc20Cp: 0.17, viscActK: 640 },
  nC6H14:     { rho20: 659,  dRhoDT: 0.90, sigma20: 18.4, visc20Cp: 0.31, viscActK: 890 },
  nC7H16:     { rho20: 684,  dRhoDT: 0.85, sigma20: 20.1, visc20Cp: 0.41, viscActK: 980 },
  Benzene:    { rho20: 876,  dRhoDT: 1.06, sigma20: 28.9, visc20Cp: 0.65, viscActK: 1250 },
  Toluene:    { rho20: 867,  dRhoDT: 0.93, sigma20: 28.4, visc20Cp: 0.59, viscActK: 1080 },
  pXylene:    { rho20: 861,  dRhoDT: 0.88, sigma20: 28.3, visc20Cp: 0.64, viscActK: 1120 },
  MeOH:       { rho20: 792,  dRhoDT: 0.94, sigma20: 22.5, visc20Cp: 0.59, viscActK: 1260 },
  EtOH:       { rho20: 789,  dRhoDT: 0.85, sigma20: 22.1, visc20Cp: 1.20, viscActK: 1680 },
  IPA:        { rho20: 786,  dRhoDT: 0.83, sigma20: 21.7, visc20Cp: 2.40, viscActK: 2150 },
  Acetone:    { rho20: 785,  dRhoDT: 1.12, sigma20: 23.7, visc20Cp: 0.32, viscActK: 860 },
  AceticAcid: { rho20: 1049, dRhoDT: 1.12, sigma20: 27.6, visc20Cp: 1.22, viscActK: 1420 },
  EtOAc:      { rho20: 900,  dRhoDT: 1.21, sigma20: 23.9, visc20Cp: 0.45, viscActK: 980 },
  CHCl3:      { rho20: 1489, dRhoDT: 1.86, sigma20: 27.1, visc20Cp: 0.56, viscActK: 920 },
  Ar: { rho20: 1395, dRhoDT: 2.5, sigma20: 11.0, visc20Cp: 0.25, viscActK: 420 },
  H2S: { rho20: 790, dRhoDT: 1.65, sigma20: 11.3, visc20Cp: 0.15, viscActK: 560 },
  SO2: { rho20: 1380, dRhoDT: 2.1, sigma20: 26.5, visc20Cp: 0.36, viscActK: 780 },
  SO3: { rho20: 1920, dRhoDT: 2.3, sigma20: 34.0, visc20Cp: 1.6, viscActK: 1450 },
  iC4H10: { rho20: 557, dRhoDT: 1.2, sigma20: 11.9, visc20Cp: 0.16, viscActK: 620 },
  C4H8_1: { rho20: 595, dRhoDT: 1.18, sigma20: 12.6, visc20Cp: 0.17, viscActK: 630 },
  nC5H12: { rho20: 626, dRhoDT: 0.98, sigma20: 16.0, visc20Cp: 0.23, viscActK: 760 },
  nC8H18: { rho20: 703, dRhoDT: 0.81, sigma20: 21.6, visc20Cp: 0.54, viscActK: 1120 },
  Cyclohexane: { rho20: 779, dRhoDT: 0.95, sigma20: 25.2, visc20Cp: 0.98, viscActK: 1450 },
  Ethylbenzene: { rho20: 867, dRhoDT: 0.88, sigma20: 29.2, visc20Cp: 0.68, viscActK: 1150 },
  Styrene: { rho20: 906, dRhoDT: 0.89, sigma20: 32.0, visc20Cp: 0.76, viscActK: 1210 },
  Cumene: { rho20: 862, dRhoDT: 0.86, sigma20: 28.2, visc20Cp: 0.79, viscActK: 1200 },
  Phenol: { rho20: 1071, dRhoDT: 0.82, sigma20: 40.9, visc20Cp: 8.5, viscActK: 2650 },
  THF: { rho20: 889, dRhoDT: 1.02, sigma20: 26.4, visc20Cp: 0.48, viscActK: 920 },
  DMF: { rho20: 948, dRhoDT: 0.95, sigma20: 37.1, visc20Cp: 0.8, viscActK: 1280 },
  DMSO: { rho20: 1100, dRhoDT: 1.0, sigma20: 43.5, visc20Cp: 2.0, viscActK: 1780 },
  MTBE: { rho20: 740, dRhoDT: 1.08, sigma20: 19.4, visc20Cp: 0.36, viscActK: 860 },
  MEK: { rho20: 805, dRhoDT: 1.05, sigma20: 24.6, visc20Cp: 0.41, viscActK: 950 },
  DMC: { rho20: 1069, dRhoDT: 1.25, sigma20: 29.1, visc20Cp: 0.59, viscActK: 1150 },
  EG: { rho20: 1113, dRhoDT: 0.7, sigma20: 47.7, visc20Cp: 19.9, viscActK: 3100 },
  MEA: { rho20: 1012, dRhoDT: 0.79, sigma20: 48.9, visc20Cp: 24.1, viscActK: 3250 },
  MDEA: { rho20: 1040, dRhoDT: 0.75, sigma20: 39.0, visc20Cp: 101.0, viscActK: 4100 },
  FormicAcid: { rho20: 1220, dRhoDT: 1.24, sigma20: 37.6, visc20Cp: 1.78, viscActK: 1650 },
  HNO3: { rho20: 1513, dRhoDT: 1.8, sigma20: 41.2, visc20Cp: 0.88, viscActK: 1250 },
  CH3Cl: { rho20: 920, dRhoDT: 2.10, sigma20: 16.2, visc20Cp: 0.24, viscActK: 650 },
  CH2Cl2: { rho20: 1326, dRhoDT: 1.80, sigma20: 28.1, visc20Cp: 0.44, viscActK: 850 },
  CCl4: { rho20: 1594, dRhoDT: 1.90, sigma20: 26.8, visc20Cp: 0.97, viscActK: 1250 },
  C2Cl4: { rho20: 1623, dRhoDT: 1.70, sigma20: 31.7, visc20Cp: 0.89, viscActK: 1200 },
  COCl2: { rho20: 1381, dRhoDT: 2.15, sigma20: 20.1, visc20Cp: 0.42, viscActK: 920 },
  HCHO: { rho20: 815, dRhoDT: 1.65, sigma20: 22.0, visc20Cp: 0.25, viscActK: 760 },
  MCB: { rho20: 1106, dRhoDT: 1.07, sigma20: 33.2, visc20Cp: 0.80, viscActK: 1240 },
  Aniline: { rho20: 1022, dRhoDT: 0.85, sigma20: 42.9, visc20Cp: 4.40, viscActK: 2400 },
  MDA: { rho20: 1150, dRhoDT: 0.72, sigma20: 44.5, visc20Cp: 8.50, viscActK: 2700 },
  MDI: { rho20: 1190, dRhoDT: 0.78, sigma20: 41.2, visc20Cp: 4.80, viscActK: 2450 },
  PMDI: { rho20: 1235, dRhoDT: 0.75, sigma20: 43.0, visc20Cp: 195.0, viscActK: 3900 },
  CUSTOM_1: { rho20: 810, dRhoDT: 0.8, sigma20: 24.6, visc20Cp: 2.95, viscActK: 2250 },
  CUSTOM_2: { rho20: 1022, dRhoDT: 0.85, sigma20: 42.9, visc20Cp: 4.4, viscActK: 2400 },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pickStandardDiam(reqDiamM: number): number {
  for (const d of STANDARD_SHELL_DIAMS_M) {
    if (d >= reqDiamM - 1e-4) return d;
  }
  return Math.ceil(reqDiamM * 5) / 5;
}

function pickNozzleDn(calcIdMm: number): { idMm: number; label: string } {
  for (const p of STANDARD_PIPE_NOZZLES) {
    if (p.idMm >= calcIdMm) return p;
  }
  const dn = Math.ceil(calcIdMm / 100) * 100;
  return { idMm: dn, label: `DN${dn}` };
}

/** 단별 다성분 액상·기상 물성 추산 */
function calcStageMixtureProps(st: DistillStageProfile): {
  rhoVapKgM3: number;
  rhoLiqKgM3: number;
  surfTensMnM: number;
  viscLiqCp: number;
  viscVapPaS: number;
  avgMwVap: number;
  avgMwLiq: number;
} {
  const T_K = clamp(st.tempC + 273.15, 190, 580);
  const dT = st.tempC - 20.0;

  const avgMwVap = clamp(
    st.vapFlowKmolH > 1e-8 ? st.vapMassKgH / st.vapFlowKmolH : 55.0,
    2.0,
    220.0
  );
  const avgMwLiq = clamp(
    st.liqFlowKmolH > 1e-8 ? st.liqMassKgH / st.liqFlowKmolH : 60.0,
    12.0,
    240.0
  );
  const zCompress = clamp(1.0 - 0.0085 * st.pressBarA * Math.pow(320 / T_K, 1.6), 0.72, 1.0);
  const rhoVapKgM3 = clamp(
    (st.pressBarA * 100.0 * avgMwVap) / (zCompress * 8.31446 * T_K),
    0.04,
    180.0
  );
  // 기상 점도 추산 (Lucas / 저압 기체 근사, Pa·s)
  const viscVapPaS = clamp(9.5e-6 * Math.pow(T_K / 300, 0.72) * Math.pow(44 / avgMwVap, 0.15), 5e-6, 2.8e-5);

  let invRhoSum = 0;
  let wtSum = 0;
  let sigmaMolSum = 0;
  let lnViscMolSum = 0;
  let molSum = 0;

  const wH2O = (st.xWtPct.H2O || 0) / 100.0;
  const wHCl = (st.xWtPct.HCl || 0) / 100.0;
  const isAqueousHCl = wH2O > 0.25 && wHCl > 0.005;

  (Object.keys(PURE_LIQ_DB) as SimCompKey[]).forEach((k) => {
    const w = Math.max(0, (st.xWtPct[k] || 0) / 100.0);
    const x = Math.max(0, st.xMol[k] || 0);
    const db = PURE_LIQ_DB[k];
    if (w > 1e-6) {
      let rhoCompT = clamp(db.rho20 - db.dRhoDT * dT, 300, 2300);
      if (k === 'HCl' && isAqueousHCl) {
        rhoCompT = clamp(1490 - 0.85 * dT, 1080, 1550);
      }
      invRhoSum += w / rhoCompT;
      wtSum += w;
    }
    if (x > 1e-6) {
      let sigT = clamp(db.sigma20 * (1.0 - 0.00165 * dT), 3.0, 90.0);
      let muT = db.visc20Cp * Math.exp(db.viscActK * (1.0 / T_K - 1.0 / 293.15));
      if (k === 'HCl' && isAqueousHCl) {
        sigT = clamp(65.0 * (1.0 - 0.0015 * dT), 28.0, 75.0);
        muT = clamp(1.35 * Math.exp(1550 * (1.0 / T_K - 1.0 / 293.15)), 0.25, 4.0);
      }
      sigmaMolSum += x * sigT;
      lnViscMolSum += x * Math.log(clamp(muT, 0.03, 1500));
      molSum += x;
    }
  });

  const rhoLiqKgM3 = wtSum > 1e-5 ? clamp(wtSum / invRhoSum, 320, 1950) : 1050;
  const surfTensMnM = molSum > 1e-5 ? clamp(sigmaMolSum / molSum, 3.5, 82.0) : 32.0;
  const viscLiqCp = molSum > 1e-5 ? clamp(Math.exp(lnViscMolSum / molSum), 0.04, 120.0) : 0.65;

  return { rhoVapKgM3, rhoLiqKgM3, surfTensMnM, viscLiqCp, viscVapPaS, avgMwVap, avgMwLiq };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 엄밀 트레이 수력학 & Chan–Fair (1984) 단효율 엔진
// ─────────────────────────────────────────────────────────────────────────────

/** 원의 활꼴(segment) 면적비 A_seg / A_circle = (θ − sin θ)/(2π) 역산 → 현 높이 h/D 및 현 길이 Lw/D */
function solveChordSegment(areaFrac: number): { heightOverD: number; chordOverD: number } {
  const target = clamp(areaFrac, 0.01, 0.45) * 2 * Math.PI;
  let lo = 0.05;
  let hi = Math.PI - 0.05;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid - Math.sin(mid) < target) lo = mid;
    else hi = mid;
  }
  const theta = 0.5 * (lo + hi);
  return {
    heightOverD: 0.5 * (1 - Math.cos(theta / 2)),
    chordOverD: Math.sin(theta / 2),
  };
}

/** 다중 패스(1 / 2 / 4-Pass) 트레이 정밀 기하 단면 계산 */
export function calcMultiPassTrayGeometry(
  diamM: number,
  dcAreaFrac: number,
  holeAreaFrac: number,
  passesPref: 'auto' | 1 | 2 | 4,
  peakLiqM3H: number
): {
  areaTotalM2: number;
  areaNetM2: number;
  areaActiveM2: number;
  areaDcM2: number;
  areaHoleM2: number;
  weirLengthM: number;
  flowPathLengthM: number;
  passes: 1 | 2 | 4;
  dcWidthTopMm: number;
  dcWidthBotMm: number;
  sideHeightOverD: number;
} {
  const D = Math.max(0.3, diamM);
  const areaTotalM2 = (Math.PI * D * D) / 4.0;
  const adFrac = clamp(dcAreaFrac, 0.05, 0.24);
  const seg1 = solveChordSegment(adFrac);

  let passes: 1 | 2 | 4 = 1;
  if (passesPref === 'auto') {
    const weirLoad1Pass = peakLiqM3H / Math.max(0.2, seg1.chordOverD * D);
    if (D >= 3.4 || weirLoad1Pass > 120) passes = 4;
    else if (D >= 1.85 || weirLoad1Pass > 60) passes = 2;
    else passes = 1;
  } else {
    passes = passesPref;
  }

  const areaDcM2 = areaTotalM2 * adFrac;
  const areaNetM2 = areaTotalM2 - areaDcM2;
  const areaActiveM2 = Math.max(0.44 * areaTotalM2, areaTotalM2 - 2.0 * areaDcM2);
  const areaHoleM2 = areaActiveM2 * clamp(holeAreaFrac, 0.04, 0.18);

  let weirLengthM: number;
  let flowPathLengthM: number;
  let sideHeightOverD = seg1.heightOverD;
  if (passes === 1) {
    weirLengthM = seg1.chordOverD * D;
    flowPathLengthM = Math.max(0.18, D * (1 - 2 * seg1.heightOverD));
  } else if (passes === 2) {
    // 2-Pass: 측면 다운코머 2개(합계 면적 adFrac) ↔ 중앙 다운코머(폭 ≈ adFrac·D/1.25) 교번 평균 위어길이
    const sideSeg = solveChordSegment(adFrac / 2);
    sideHeightOverD = sideSeg.heightOverD;
    const centerDcWidthOverD = (adFrac * Math.PI) / 4;
    weirLengthM = 0.5 * (2 * sideSeg.chordOverD * D + 2 * 0.96 * D);
    flowPathLengthM = Math.max(0.16, 0.5 * D * (1 - 2 * sideSeg.heightOverD - centerDcWidthOverD));
  } else {
    // 4-Pass: 측면 + 오프센터 + 센터 다운코머 조합
    const sideSeg = solveChordSegment(adFrac / 4);
    sideHeightOverD = sideSeg.heightOverD;
    weirLengthM = (2 * sideSeg.chordOverD + 2 * 0.88 + 0.98) * 0.62 * D;
    flowPathLengthM = Math.max(0.14, 0.25 * D * (1 - 2 * sideSeg.heightOverD - 2 * ((adFrac * Math.PI) / 8)));
  }

  const dcWidthTopMm = Math.max(75, Math.round(sideHeightOverD * D * 1000));
  const dcWidthBotMm = D >= 1.2 ? Math.max(55, Math.round(0.72 * dcWidthTopMm)) : dcWidthTopMm;

  return {
    areaTotalM2,
    areaNetM2,
    areaActiveM2,
    areaDcM2,
    areaHoleM2,
    weirLengthM: Math.max(0.24, weirLengthM),
    flowPathLengthM,
    passes,
    dcWidthTopMm,
    dcWidthBotMm,
    sideHeightOverD,
  };
}

/** Fair Souders-Brown 제트 범람 용량계수 C_sb,flood (m/s, net area 기준) */
export function calcFairCsbFlood(
  flowParamFlv: number,
  traySpacingMm: number,
  surfTensMnM: number,
  foamingFactor: number,
  holeAreaFrac: number
): number {
  const flv = clamp(flowParamFlv, 0.015, 2.0);
  const lnF = clamp(Math.log10(flv), -1.75, 0.30);
  // 24-in (610mm) 기준 Fair (1961) / Kister 곡선 다항 피팅 (ft/s → m/s 변환 ×0.3048)
  const csb600 = 0.3048 * Math.pow(10, -0.945 - 0.703 * lnF - 0.226 * lnF * lnF);
  const spacingFactor = Math.pow(clamp(traySpacingMm, 200, 950) / 610.0, 0.54);
  const sigmaFactor = Math.pow(clamp(surfTensMnM, 5, 85) / 20.0, 0.20);
  const holeFactor =
    holeAreaFrac >= 0.10
      ? 1.0
      : holeAreaFrac <= 0.06
      ? 0.86
      : 0.86 + ((holeAreaFrac - 0.06) / 0.04) * 0.14;
  return clamp(csb600 * spacingFactor * sigmaFactor * clamp(foamingFactor, 0.55, 1.0) * holeFactor, 0.015, 0.16);
}

/**
 * Fair (1961) 비말동반 곡선 수치 피팅 ψ(F_LV, % Flood)
 * 정의: ψ = e / (L + e) [mol entrained liquid / mol gross downflowing liquid]
 * Seader–Henley Fig. 6.17 / Kister Fig. 4.16 전 구간(F_LV 0.01~2.0, Flood 30~100%) 정합
 */
export function calcFairEntrainmentPsi(flowParamFlv: number, jetFloodPct: number): number {
  const flv = clamp(flowParamFlv, 0.01, 2.0);
  const f = clamp(jetFloodPct / 100.0, 0.15, 1.15);
  const x = Math.log10(flv);
  // 80% Flood 기준 곡선 + (% Flood - 80%) 기울기 보정
  const logPsiAt80 = -1.94 - 0.88 * x - 0.12 * x * x;
  const slopeFlood = 3.1 - 0.35 * x;
  const logPsi = logPsiAt80 + slopeFlood * (f - 0.80);
  return clamp(Math.pow(10, logPsi), 1e-4, 0.48);
}

/** Glitsch Bulletin 4900 다운코머 입구 최대 허용 청액 유속 v_dc,max (m/s) */
export function calcGlitschDcChokeVelMS(
  rhoLiqKgM3: number,
  rhoVapKgM3: number,
  traySpacingMm: number,
  foamingFactor: number
): number {
  const dRho = Math.max(20, rhoLiqKgM3 - rhoVapKgM3);
  const tsM = clamp(traySpacingMm, 200, 1000) / 1000.0;
  const v1 = 0.17; // 250 GPM/ft² 상한
  const v2 = 0.007 * Math.sqrt(dRho);
  const v3 = 0.00807 * Math.sqrt(tsM * dRho);
  return clamp(foamingFactor, 0.5, 1.0) * Math.min(v1, v2, v3);
}

export interface ChanFairInput {
  uActiveMS: number;        // 활성면적 기준 기상 공탑유속 u_a = Q_V / A_a (m/s)
  jetFloodFrac: number;     // 제트 범람 분율 f = %Flood / 100
  qLiqM3S: number;          // 액상 체적유량 Q_L (m³/s)
  areaActiveM2: number;     // 활성면적 A_a (m²)
  weirLengthM: number;      // 총 출구 위어 길이 L_w (m)
  weirHeightM: number;      // 출구 위어 높이 h_w (m)
  flowPathLengthM: number;  // 패스당 액체 유로 길이 FPL (m)
  rhoVapKgM3: number;
  rhoLiqKgM3: number;
  viscLiqCp: number;
  tempK: number;
  pressBarA: number;
  avgMwVap: number;
  avgMwLiq: number;
  strippingFactorLambda: number; // λ = m·V/L
  entrainmentPsi: number;        // Fair 비말동반율 ψ
  weepFraction: number;          // 위핑 바이패스 분율 (0..1)
  diffLiqM2S?: number;           // 지정 시 우선 적용 액상 확산계수 D_L (m²/s)
  diffVapM2S?: number;           // 지정 시 우선 적용 기상 확산계수 D_G (m²/s)
}

export interface ChanFairResult {
  frothDensityAlphaE: number;
  clearLiqHeightMm: number;
  nG: number;
  nL: number;
  nOG: number;
  pecletNumber: number;
  pointEffPct: number;           // E_OG (%)
  murphreeDryEffPct: number;     // E_MV (혼합 반영, 비말 미보정, %)
  chanFairEffPct: number;        // E_MV* (Lewis 비말동반 + 위핑 보정 최종 단효율, %)
}

/**
 * Chan & Fair (1984, Ind. Eng. Chem. Process Des. Dev. 23, 814) 점효율 →
 * AIChE 와류확산(Peclet) → Lewis Case 1 Murphree 단효율 → Colburn/Lewis 비말동반 보정
 */
export function calcChanFairEfficiency(inp: ChanFairInput): ChanFairResult {
  const ua = Math.max(0.05, inp.uActiveMS);
  const f = clamp(inp.jetFloodFrac, 0.15, 0.98);
  const dRho = Math.max(10, inp.rhoLiqKgM3 - inp.rhoVapKgM3);
  const ks = ua * Math.sqrt(inp.rhoVapKgM3 / dRho);

  // 1) Bennett, Agrawal & Cook (1983) 기포층 유효 액체 홀드업 분율 α_e 및 청액 높이 h_L (m)
  const alphaE = clamp(Math.exp(-12.55 * Math.pow(ks, 0.91)), 0.08, 0.78);
  const qPerWeir = Math.max(1e-5, inp.qLiqM3S / Math.max(0.2, inp.weirLengthM));
  const hLiqM = clamp(alphaE * (inp.weirHeightM + 0.5 * Math.pow(qPerWeir / alphaE, 2 / 3)), 0.008, 0.12);

  // 기상·액상 체류시간 (s)
  const tVapSec = ((1 - alphaE) * hLiqM) / Math.max(1e-4, alphaE * ua);
  const tLiqSec = (hLiqM * inp.areaActiveM2) / Math.max(1e-6, inp.qLiqM3S);

  // 2) 분자 확산계수 D_G, D_L (미지정 시 Fuller-Schettler-Giddings 및 Wilke-Chang 추산)
  const mwV = clamp(inp.avgMwVap, 2, 220);
  const mwL = clamp(inp.avgMwLiq, 15, 240);
  const vMolCm3 = clamp((mwL / Math.max(350, inp.rhoLiqKgM3)) * 1000, 18, 260);
  const diffLiq =
    inp.diffLiqM2S ??
    clamp(
      (7.4e-12 * Math.sqrt(1.15 * mwL) * inp.tempK) / (Math.max(0.05, inp.viscLiqCp) * Math.pow(vMolCm3, 0.6)),
      1.5e-10,
      1.2e-8
    );
  const diffVap =
    inp.diffVapM2S ??
    clamp(
      (1.05e-5 * Math.pow(inp.tempK / 298.15, 1.75)) /
        Math.max(0.05, inp.pressBarA) *
        Math.sqrt(60 / mwV),
      8e-7,
      1.5e-4
    );

  // 3) Chan–Fair (1984) 기상/액상 물질전달 단위수 N_G, N_L
  // k_G·a = 1000 · D_G^0.5 · (10.3·f − 8.67·f²) / h_L^0.5  [s⁻¹, SI: D_G in m²/s, h_L in m]
  const cFactor = Math.max(0.35, 10.3 * f - 8.67 * f * f);
  const kGa = (1000.0 * Math.sqrt(diffVap) * cFactor) / Math.sqrt(hLiqM);
  const nG = clamp(kGa * tVapSec, 0.15, 12.0);

  // k_L·a = (3.875e8 · D_L)^0.5 · (0.40 · F_va + 0.17)  [s⁻¹]
  const fva = ua * Math.sqrt(inp.rhoVapKgM3);
  const kLa = Math.sqrt(3.875e8 * diffLiq) * (0.4 * fva + 0.17);
  const nL = clamp(kLa * tLiqSec, 0.15, 18.0);

  const lambda = clamp(inp.strippingFactorLambda, 0.2, 5.0);
  const nOG = 1.0 / (1.0 / nG + lambda / nL);
  const eOG = clamp(1.0 - Math.exp(-nOG), 0.08, 0.98);

  // 4) AIChE 액상 축방향 혼합(Eddy Diffusion) Peclet 수 → E_MV / E_OG 변환
  const eddyDiffM2S = Math.max(0.002, 0.00378 + 0.0171 * ua + 3.67 * qPerWeir + 0.18 * inp.weirHeightM);
  const pe = clamp((inp.flowPathLengthM * inp.flowPathLengthM) / (eddyDiffM2S * Math.max(0.1, tLiqSec)), 0.2, 60.0);
  const eta = 0.5 * pe * (Math.sqrt(1.0 + (4.0 * lambda * eOG) / pe) - 1.0);
  let emvOverEog = 1.0;
  if (eta > 1e-4) {
    const term1 = (1.0 - Math.exp(-(eta + pe))) / ((eta + pe) * (1.0 + (eta + pe) / eta));
    const term2 = (Math.exp(eta) - 1.0) / (eta * (1.0 + eta / (eta + pe)));
    emvOverEog = clamp(term1 + term2, 1.0, 1.45);
  }
  const eMV = clamp(eOG * emvOverEog, 0.08, 1.25);

  // 5) Colburn / Lewis 비말동반 보정: E_MV* = E_MV / (1 + E_MV · ψ / (1 − ψ)) 및 위핑 보정
  const psi = clamp(inp.entrainmentPsi, 0, 0.48);
  const eWet = eMV / (1.0 + (eMV * psi) / Math.max(0.2, 1.0 - psi));
  const weepDegrade = 1.0 - 0.75 * clamp(inp.weepFraction, 0, 0.85);
  const eFinal = clamp(eWet * weepDegrade, 0.12, 1.15);

  return {
    frothDensityAlphaE: alphaE,
    clearLiqHeightMm: hLiqM * 1000.0,
    nG,
    nL,
    nOG,
    pecletNumber: pe,
    pointEffPct: eOG * 100.0,
    murphreeDryEffPct: eMV * 100.0,
    chanFairEffPct: eFinal * 100.0,
  };
}

export interface TrayPointInput {
  trayType: TrayDeckType;
  diamM: number;
  traySpacingMm: number;
  weirHeightMm: number;
  dcAreaFrac: number;
  holeAreaFrac: number;
  holeDiameterMm: number;
  passesPref: 'auto' | 1 | 2 | 4;
  foamingFactor: number;
  vapMassKgH: number;
  liqMassKgH: number;
  rhoVapKgM3: number;
  rhoLiqKgM3: number;
  surfTensMnM: number;
  viscLiqCp: number;
  tempC?: number;
  pressBarA?: number;
  avgMwVap?: number;
  avgMwLiq?: number;
  alphaRelVol?: number;
  strippingFactorLambda?: number;
  diffLiqM2S?: number;
  diffVapM2S?: number;
}

export interface TrayPointResult {
  geom: ReturnType<typeof calcMultiPassTrayGeometry>;
  flowParamFlv: number;
  superficialVelMS: number;
  fFactorPa05: number;
  uNetFloodMS: number;
  jetFloodPct: number;
  dcChokeFloodPct: number;
  floodPct: number;
  dcResidenceTimeSec: number;
  weirLoadM3HM: number;
  weirCrestMm: number;
  dryDropMmLiq: number;
  valveRegime: 'closed' | 'partially_open' | 'fully_open' | 'n/a';
  clearLiqMm: number;
  totalHeadMmLiq: number;
  dpMmH2O: number;
  dpMbar: number;
  dcBackupPct: number;
  holeFroudeNumber: number;
  weepRatio: number;
  weepFraction: number;
  entrainmentFrac: number;
  chanFair: ChanFairResult;
  oconnellEffPct: number;
}

/** 단일 트레이 단의 전체 수력학 + 위핑 + 비말동반 + Chan–Fair 단효율 평가 */
export function calcTrayPointHydraulics(inp: TrayPointInput): TrayPointResult {
  const qVapM3S = inp.vapMassKgH / (Math.max(0.04, inp.rhoVapKgM3) * 3600.0);
  const qLiqM3H = inp.liqMassKgH / Math.max(300, inp.rhoLiqKgM3);
  const qLiqM3S = qLiqM3H / 3600.0;
  const geom = calcMultiPassTrayGeometry(inp.diamM, inp.dcAreaFrac, inp.holeAreaFrac, inp.passesPref, qLiqM3H);

  const flv = clamp(
    (inp.liqMassKgH / Math.max(1e-3, inp.vapMassKgH)) * Math.sqrt(inp.rhoVapKgM3 / inp.rhoLiqKgM3),
    0.01,
    2.0
  );
  const uSupMS = qVapM3S / Math.max(0.02, geom.areaTotalM2);
  const uActiveMS = qVapM3S / Math.max(0.02, geom.areaActiveM2);
  const fFactorPa05 = uSupMS * Math.sqrt(inp.rhoVapKgM3);

  // 1) Fair 제트 범람 & Glitsch 다운코머 초크 범람 + 다운코머 체류시간
  const csbFlood = calcFairCsbFlood(flv, inp.traySpacingMm, inp.surfTensMnM, inp.foamingFactor, inp.holeAreaFrac);
  const uNetFloodMS = csbFlood * Math.sqrt(Math.max(1.0, (inp.rhoLiqKgM3 - inp.rhoVapKgM3) / inp.rhoVapKgM3));
  const uNetActual = qVapM3S / Math.max(0.02, geom.areaNetM2);
  const jetFloodPct = clamp((uNetActual / Math.max(0.08, uNetFloodMS)) * 100.0, 0.5, 180.0);

  const vDcActual = qLiqM3S / Math.max(0.002, geom.areaDcM2);
  const vDcMax = calcGlitschDcChokeVelMS(inp.rhoLiqKgM3, inp.rhoVapKgM3, inp.traySpacingMm, inp.foamingFactor);
  const dcChokeFloodPct = clamp((vDcActual / Math.max(0.02, vDcMax)) * 100.0, 0.5, 180.0);
  const dcResidenceTimeSec = clamp(
    (geom.areaDcM2 * (inp.traySpacingMm / 1000.0)) / Math.max(1e-5, qLiqM3S),
    0.5,
    120.0
  );
  const floodPct = Math.max(jetFloodPct, dcChokeFloodPct);

  // 2) Francis 위어 월류 수두 how (mm)
  const weirLoadM3HM = qLiqM3H / geom.weirLengthM;
  const weirCrestMm = clamp(664.0 * Math.pow(qLiqM3S / geom.weirLengthM, 2 / 3), 1.5, 95.0);

  // 3) 건식 압손 hd (mm liquid) — Sieve vs Valve (3-Regime) vs Bubble-Cap
  const uHoleMS = qVapM3S / Math.max(0.002, geom.areaHoleM2);
  let dryDropMmLiq = 15.0;
  let valveRegime: TrayPointResult['valveRegime'] = 'n/a';
  const rhoRatio = inp.rhoVapKgM3 / inp.rhoLiqKgM3;

  if (inp.trayType === 'sieve') {
    const tDeckMm = 2.0; // 표준 14Ga 데크 판두께
    const cOrifice = clamp(
      0.72 + 0.14 * Math.min(1.2, tDeckMm / Math.max(2.0, inp.holeDiameterMm)) + 0.35 * inp.holeAreaFrac,
      0.70,
      0.86
    );
    dryDropMmLiq = 50.99 * Math.pow(uHoleMS / cOrifice, 2) * rhoRatio;
  } else if (inp.trayType === 'valve') {
    // Klein / Bolles / Glitsch 부상식 밸브 3-Regime 모델 (폐쇄 → 부분개방 평형수두 → 완전개방)
    const hdClosed = 215.0 * uHoleMS * uHoleMS * rhoRatio;
    const hdBalance = (14.5 * 1000.0) / inp.rhoLiqKgM3 + 12.0 * uHoleMS * uHoleMS * rhoRatio;
    const cValveOpen = 0.74;
    const hdFullOpen = (50.99 / (cValveOpen * cValveOpen)) * uHoleMS * uHoleMS * rhoRatio;

    if (hdClosed < hdBalance) {
      dryDropMmLiq = hdClosed;
      valveRegime = 'closed';
    } else if (hdFullOpen <= hdBalance) {
      dryDropMmLiq = hdBalance;
      valveRegime = 'partially_open';
    } else {
      dryDropMmLiq = hdFullOpen;
      valveRegime = 'fully_open';
    }
  } else {
    const uRiserMS = qVapM3S / Math.max(0.003, geom.areaActiveM2 * Math.max(inp.holeAreaFrac, 0.11));
    dryDropMmLiq = 22.0 + 58.0 * Math.pow(uRiserMS / 0.76, 2) * rhoRatio;
  }
  dryDropMmLiq = clamp(dryDropMmLiq, 2.5, 180.0);

  // 4) 기포층 등가 청액 수두 + 표면장력 잔류 수두 → 총 단 압손
  const fva = uActiveMS * Math.sqrt(inp.rhoVapKgM3);
  const betaAeration = clamp(0.64 - 0.075 * Math.min(3.0, fva), 0.38, 0.7);
  const clearLiqMm = betaAeration * (inp.weirHeightMm + weirCrestMm);
  const residSigmaMm =
    inp.trayType === 'sieve'
      ? (6.0 * inp.surfTensMnM) / (inp.rhoLiqKgM3 * G_ACC * (inp.holeDiameterMm / 1000.0))
      : 2.0;

  const totalHeadMmLiq = dryDropMmLiq + clearLiqMm + residSigmaMm;
  const dpMmH2O = totalHeadMmLiq * (inp.rhoLiqKgM3 / 1000.0);
  const dpMbar = dpMmH2O * 0.0980665;

  // 5) 다운코머 백업율 (%)
  const hapMm = Math.max(20, inp.weirHeightMm - 12);
  const apronAreaM2 = Math.max(0.006, geom.weirLengthM * (hapMm / 1000.0));
  const dcApronLossMm = 165.0 * Math.pow(qLiqM3S / apronAreaM2, 2);
  const dcClearLiqMm = inp.weirHeightMm + weirCrestMm + totalHeadMmLiq + dcApronLossMm;
  const frothDensityDc = clamp(0.55 * inp.foamingFactor, 0.35, 0.6);
  const dcFrothHeightMm = dcClearLiqMm / frothDensityDc;
  const dcBackupPct = clamp((dcFrothHeightMm / (inp.traySpacingMm + inp.weirHeightMm)) * 100.0, 4.0, 145.0);

  // 6) Lockett & Banik (1986) / Hsieh–McNulty 위핑 임계 Froude 수 & 위핑 분율
  const dhM = inp.holeDiameterMm / 1000.0;
  const dRho = Math.max(10, inp.rhoLiqKgM3 - inp.rhoVapKgM3);
  const holeFroudeNumber = uHoleMS * Math.sqrt(inp.rhoVapKgM3 / (G_ACC * dhM * dRho));
  let frCrit: number;
  if (inp.trayType === 'sieve') {
    frCrit = 0.5 * Math.pow(clamp(clearLiqMm / 35.0, 0.4, 2.5), 0.25);
  } else if (inp.trayType === 'valve') {
    frCrit = 0.22 * Math.pow(clamp(clearLiqMm / 35.0, 0.4, 2.5), 0.2);
  } else {
    frCrit = 0.06;
  }
  const weepRatio = clamp(holeFroudeNumber / Math.max(0.04, frCrit), 0.1, 15.0);
  let weepFraction = 0;
  if (holeFroudeNumber < frCrit) {
    // Lockett (1986) 위핑 유량 분율 추산
    const jWeep = 0.022 * Math.pow(frCrit / Math.max(0.03, holeFroudeNumber) - 1.0, 1.15);
    const qWeepM3S = jWeep * geom.areaHoleM2 * Math.sqrt((G_ACC * dhM * dRho) / inp.rhoLiqKgM3) * 18.0;
    weepFraction = clamp(qWeepM3S / Math.max(1e-6, qLiqM3S), 0.01, 0.95);
  }

  // 7) Fair 비말동반율 ψ & Chan–Fair (1984) + O'Connell 단효율
  const entrainmentFrac = calcFairEntrainmentPsi(flv, jetFloodPct);
  const alpha = clamp(inp.alphaRelVol ?? 2.2, 1.05, 15.0);
  const oconnellEffPct = clamp(50.3 * Math.pow(Math.max(0.08, alpha * inp.viscLiqCp), -0.226), 25.0, 92.0);

  const chanFair = calcChanFairEfficiency({
    uActiveMS,
    jetFloodFrac: jetFloodPct / 100.0,
    qLiqM3S,
    areaActiveM2: geom.areaActiveM2,
    weirLengthM: geom.weirLengthM,
    weirHeightM: inp.weirHeightMm / 1000.0,
    flowPathLengthM: geom.flowPathLengthM,
    rhoVapKgM3: inp.rhoVapKgM3,
    rhoLiqKgM3: inp.rhoLiqKgM3,
    viscLiqCp: inp.viscLiqCp,
    tempK: (inp.tempC ?? 80) + 273.15,
    pressBarA: inp.pressBarA ?? 1.013,
    avgMwVap: inp.avgMwVap ?? 60,
    avgMwLiq: inp.avgMwLiq ?? 65,
    strippingFactorLambda: inp.strippingFactorLambda ?? 1.0,
    entrainmentPsi: entrainmentFrac,
    weepFraction,
    diffLiqM2S: inp.diffLiqM2S,
    diffVapM2S: inp.diffVapM2S,
  });

  return {
    geom,
    flowParamFlv: flv,
    superficialVelMS: uSupMS,
    fFactorPa05,
    uNetFloodMS,
    jetFloodPct,
    dcChokeFloodPct,
    floodPct,
    dcResidenceTimeSec,
    weirLoadM3HM,
    weirCrestMm,
    dryDropMmLiq,
    valveRegime,
    clearLiqMm,
    totalHeadMmLiq,
    dpMmH2O,
    dpMbar,
    dcBackupPct,
    holeFroudeNumber,
    weepRatio,
    weepFraction,
    entrainmentFrac,
    chanFair,
    oconnellEffPct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 엄밀 충진탑 수력학 & 물질전달 엔진 — Billet & Schultes (1999) + GPDC 교차검증
// ─────────────────────────────────────────────────────────────────────────────

export interface BilletSchultesInput {
  spec: PackingCatalogSpec;
  diamM: number;
  vapMassKgH: number;
  liqMassKgH: number;
  rhoVapKgM3: number;
  rhoLiqKgM3: number;
  viscLiqCp: number;
  viscVapPaS?: number;
  surfTensMnM: number;
  foamingFactor?: number;
  tempC?: number;
  pressBarA?: number;
  avgMwVap?: number;
  avgMwLiq?: number;
  strippingFactorLambda?: number;
  diffLiqM2S?: number;
  diffVapM2S?: number;
}

export interface BilletSchultesResult {
  uSupMS: number;
  uLoadMS: number;
  uFloodMS: number;
  bsFloodPct: number;
  gpdcFloodVelMS: number;
  gpdcFloodPct: number;
  dryDpMbarM: number;
  irrigatedDpMbarM: number;
  dpRatioIrrToDry: number;
  holdupPreLoad: number;
  holdupFlood: number;
  liquidHoldupFrac: number;
  wettingRateM3M2H: number;
  effectiveAreaRatio: number;
  kLMs: number;
  kGMs: number;
  hLM: number;
  hGM: number;
  hogM: number;
  hetpM: number;
  gpdcHetpM: number;
}

/** Eckert–Kister GPDC 교차검증 범람 유속 및 경험식 HETP */
export function calcEckertGpdcPacking(
  vapMassKgH: number,
  liqMassKgH: number,
  rhoV: number,
  rhoL: number,
  viscCp: number,
  surfTensMnM: number,
  diamM: number,
  spec: PackingCatalogSpec,
  foamingFactor: number
): { uFloodMS: number; floodPct: number; gpdcDpMbarM: number; gpdcHetpM: number } {
  const areaM2 = (Math.PI * diamM * diamM) / 4.0;
  const qVapM3S = vapMassKgH / (Math.max(0.04, rhoV) * 3600.0);
  const uSupMS = qVapM3S / Math.max(0.02, areaM2);
  const flv = clamp((liqMassKgH / Math.max(1e-3, vapMassKgH)) * Math.sqrt(rhoV / rhoL), 0.01, 2.0);

  const fpImp = spec.packingFactorFpM1 / 3.28084;
  const lnFlv = Math.log10(flv);
  const logYFlood = -1.668 - 1.085 * lnFlv - 0.297 * lnFlv * lnFlv;
  const yFlood = clamp(Math.pow(10, logYFlood), 0.004, 0.32);

  const uFloodFtS =
    Math.sqrt((yFlood * 32.174 * Math.max(1, rhoL - rhoV)) / (Math.max(0.04, rhoV) * Math.max(6, fpImp) * Math.pow(viscCp, 0.1))) *
    clamp(foamingFactor, 0.6, 1.0) *
    (spec.category === 'structured' ? 1.12 : 1.0);
  const uFloodMS = clamp(uFloodFtS * 0.3048, 0.25, 7.0);
  const floodRatio = uSupMS / Math.max(0.1, uFloodMS);
  const dpFloodMbarM = spec.category === 'structured' ? 12.5 : 17.5;
  const gpdcDpMbarM = clamp(dpFloodMbarM * Math.pow(clamp(floodRatio, 0.05, 1.35), 2.35), 0.04, 45.0);

  const wettingRateM3M2H = liqMassKgH / Math.max(350, rhoL) / Math.max(0.02, areaM2);
  const propHetpFactor = clamp(Math.pow(viscCp / 0.5, 0.1) * Math.pow(surfTensMnM / 28.0, 0.08), 0.82, 1.42);
  const underWetPenalty =
    wettingRateM3M2H < spec.minWettingM3M2H
      ? clamp(1.0 + 0.35 * (1.0 - wettingRateM3M2H / spec.minWettingM3M2H), 1.0, 1.4)
      : 1.0;
  const gpdcHetpM = clamp(spec.baseHetpM * propHetpFactor * underWetPenalty, 0.22, 1.25);

  return {
    uFloodMS,
    floodPct: floodRatio * 100.0,
    gpdcDpMbarM,
    gpdcHetpM,
  };
}

/**
 * Billet & Schultes (1999) 엄밀 충진탑 모델:
 *  - 범람 홀드업 h_L,Fl 및 범람 기상유속 u_V,Fl, 로딩 유속 u_V,S
 *  - 건식 압손 ΔP_0/Z 및 적심 압손 ΔP_irr/Z, 액체 홀드업 h_L
 *  - 유효 계면적비 a_e/a_p, 이상 물질전달계수 k_L · k_G → H_OG → HETP = H_OG · ln(λ)/(λ − 1)
 */
export function calcBilletSchultesPacking(inp: BilletSchultesInput): BilletSchultesResult {
  const { spec } = inp;
  const D = Math.max(0.25, inp.diamM);
  const areaM2 = (Math.PI * D * D) / 4.0;
  const a = spec.surfaceAreaM2M3;
  const eps = spec.voidFraction;
  const dh = (4.0 * eps) / a;
  const foam = clamp(inp.foamingFactor ?? 0.92, 0.55, 1.0);

  const rhoV = Math.max(0.03, inp.rhoVapKgM3);
  const rhoL = Math.max(320, inp.rhoLiqKgM3);
  const muL = Math.max(4e-5, inp.viscLiqCp * 1e-3); // Pa·s
  const nuL = muL / rhoL;
  const muV = clamp(inp.viscVapPaS ?? 1.05e-5, 5e-6, 3e-5);
  const nuV = muV / rhoV;
  const sigma = clamp(inp.surfTensMnM, 3.0, 85.0) * 1e-3; // N/m

  const uV = Math.max(0.01, inp.vapMassKgH / (rhoV * 3600.0 * areaM2));
  const uL = Math.max(1e-5, inp.liqMassKgH / (rhoL * 3600.0 * areaM2));
  const wettingRateM3M2H = uL * 3600.0;
  const flv = clamp((inp.liqMassKgH / Math.max(1e-3, inp.vapMassKgH)) * Math.sqrt(rhoV / rhoL), 0.008, 2.5);

  // 1) 수력학 적심면적비 a_h/a 및 로딩 전 액체 홀드업 h_L,S (B&S Eqs. 3–4)
  const reLFilm = (uL * 1.0) / Math.max(1e-9, a * nuL);
  const frLFilm = (uL * uL * a) / G_ACC;
  const ahOverA =
    reLFilm < 5.0
      ? spec.bsCh * Math.pow(reLFilm, 0.15) * Math.pow(frLFilm, 0.1)
      : 0.85 * spec.bsCh * Math.pow(reLFilm, 0.25) * Math.pow(frLFilm, 0.1);
  const holdupPreLoad = clamp(
    Math.pow((12.0 * nuL * uL * a * a) / G_ACC, 1 / 3) * Math.pow(clamp(ahOverA, 0.15, 1.35), 2 / 3),
    0.005,
    0.35 * eps
  );

  // 2) 범람 홀드업 h_L,Fl 및 범람 유속 u_V,Fl 연립 해법 (B&S Eqs. 18–20)
  const xiFl = flv * Math.pow(muL / muV, 0.2);
  const invSqrtPsiFl =
    flv <= 0.4
      ? spec.bsCfl * Math.pow(Math.max(1e-3, xiFl), -0.194)
      : spec.bsCfl * 0.624 * Math.pow(Math.max(1e-3, xiFl), -0.708);

  const uLOverUV = uL / Math.max(0.02, uV);
  let hFl = Math.max(eps / 3.0 + 0.004, holdupPreLoad * 2.2);
  let uFloodMS = 2.0;
  for (let it = 0; it < 18; it++) {
    uFloodMS =
      Math.sqrt(2.0 * G_ACC) *
      invSqrtPsiFl *
      (Math.pow(Math.max(0.05, eps - hFl), 1.5) / Math.sqrt(eps)) *
      Math.sqrt(hFl / a) *
      Math.sqrt(Math.max(1.0, (rhoL - rhoV) / rhoV)) *
      foam;
    const rhs = (6.0 / G_ACC) * a * a * eps * nuL * (uLOverUV * uFloodMS);
    // hFl^3 * (3*hFl - eps) = rhs (이분법으로 hFl ∈ (eps/3, 0.88*eps) 갱신)
    let lo = eps / 3.0 + 1e-5;
    let hi = 0.88 * eps;
    for (let k = 0; k < 25; k++) {
      const mid = 0.5 * (lo + hi);
      if (mid * mid * mid * (3 * mid - eps) < rhs) lo = mid;
      else hi = mid;
    }
    hFl = 0.5 * (lo + hi);
  }
  uFloodMS = clamp(uFloodMS, 0.25, 7.5);
  const uLoadMS = 0.65 * uFloodMS;
  const bsFloodPct = clamp((uV / uFloodMS) * 100.0, 0.5, 180.0);

  // 로딩 영역 액체 홀드업 h_L (B&S Eq. 24)
  let liquidHoldupFrac = holdupPreLoad;
  if (uV > uLoadMS) {
    const loadProg = clamp((uV - uLoadMS) / Math.max(0.05, uFloodMS - uLoadMS), 0, 1.15);
    liquidHoldupFrac = clamp(holdupPreLoad + (hFl - holdupPreLoad) * Math.pow(loadProg, 2.2), holdupPreLoad, 0.85 * eps);
  }

  // 3) 건식 압손 ΔP_0/Z 및 적심 압손 ΔP_irr/Z (B&S Eqs. 26–31)
  const invWallK = 1.0 + 4.0 / (a * D);
  const wallK = 1.0 / invWallK;
  const reVap = Math.max(10.0, ((6.0 * uV) / (a * nuV)) * wallK);
  const psi0 = spec.bsCp * (64.0 / reVap + 1.8 / Math.pow(reVap, 0.08));
  const dryDpPaM = psi0 * (a / Math.pow(eps, 3)) * (0.5 * rhoV * uV * uV) * invWallK;
  const dryDpMbarM = clamp(dryDpPaM / 100.0, 0.01, 45.0);

  const dpRatioIrrToDry = clamp(
    Math.pow(eps / Math.max(0.08, eps - liquidHoldupFrac), 1.5) * Math.exp(Math.min(reLFilm, 320.0) / 200.0),
    1.02,
    18.0
  );
  const irrigatedDpMbarM = clamp(dryDpMbarM * dpRatioIrrToDry, 0.02, 55.0);

  // 4) 유효 계면적 a_e/a_p 및 물질전달계수 k_L, k_G → H_OG, HETP (B&S 1993/1999 Eqs. 4, 5, 7)
  // 수력학 적심면적비 a_h/a 기반 + 표면장력 적심 보정 (불소수지는 저표면장력 접촉각 감소 반영)
  const surfWetFactor =
    spec.key === 'corrpak_ptfe_250y'
      ? clamp(Math.pow(0.028 / sigma, 0.22), 0.55, 0.95)
      : clamp(Math.pow(0.055 / sigma, 0.14), 0.78, 1.22);
  let aeRatio = ahOverA * surfWetFactor;
  if (wettingRateM3M2H < spec.minWettingM3M2H) {
    aeRatio *= clamp(0.65 + 0.35 * (wettingRateM3M2H / spec.minWettingM3M2H), 0.45, 1.0);
  }
  if (uV > uLoadMS && aeRatio < 1.0) {
    const wLoad = clamp((liquidHoldupFrac - holdupPreLoad) / Math.max(0.02, hFl - holdupPreLoad), 0, 1.0);
    aeRatio = aeRatio + (1.0 - aeRatio) * 0.55 * wLoad;
  }
  const effectiveAreaRatio = clamp(aeRatio, 0.15, 1.1);
  const ae = effectiveAreaRatio * a;

  const tempK = (inp.tempC ?? 80) + 273.15;
  const pressBarA = Math.max(0.05, inp.pressBarA ?? 1.013);
  const mwV = clamp(inp.avgMwVap ?? 60, 2, 220);
  const mwL = clamp(inp.avgMwLiq ?? 65, 15, 240);
  const vMolCm3 = clamp((mwL / rhoL) * 1000, 18, 260);
  const diffLiq =
    inp.diffLiqM2S ??
    clamp(
      (7.4e-12 * Math.sqrt(1.15 * mwL) * tempK) / (Math.max(0.05, inp.viscLiqCp) * Math.pow(vMolCm3, 0.6)),
      1.5e-10,
      1.2e-8
    );
  // Fuller–Schettler–Giddings 기상 확산계수 스케일링 (확산몰부피 v_diff ∝ MW 반영: MW^-1.12)
  const diffVap =
    inp.diffVapM2S ??
    clamp((5.4e-6 * Math.pow(tempK / 298.15, 1.75)) / pressBarA * Math.pow(60 / mwV, 1.12), 5e-7, 1.5e-4);

  const kLMs =
    spec.bsCL *
    Math.pow(G_ACC / nuL, 1 / 6) *
    Math.sqrt(diffLiq / dh) *
    Math.pow(uL / a, 1 / 3);

  // Billet & Schultes (1999) 기상 물질전달계수 (채널 대표길이 d_h 기준 + 증류 정격 말단분포 계수)
  const scVap = clamp(nuV / diffVap, 0.2, 5.0);
  const dCharG = spec.category === 'structured' ? dh : dh * 1.45;
  const kGMs =
    spec.bsCV *
    (1.0 / Math.sqrt(Math.max(0.08, eps - liquidHoldupFrac))) *
    Math.sqrt(a / dCharG) *
    diffVap *
    Math.pow((uV * 1.0) / (a * nuV), 0.75) *
    Math.pow(scVap, 1 / 3) *
    0.68;

  // 실규모 탑 액체 재분배·벽류(maldistribution) 표준 설계여유 반영
  const maldistFactor = clamp(1.12 + 0.04 * Math.max(0, D - 0.8), 1.12, 1.28);
  const hLM = clamp((uL / Math.max(1e-7, kLMs * ae)) * maldistFactor, 0.04, 1.2);
  const hGM = clamp((uV / Math.max(1e-6, kGMs * ae)) * maldistFactor, 0.08, 1.6);
  const lambda = clamp(inp.strippingFactorLambda ?? 1.0, 0.25, 4.0);
  const hogM = clamp(hGM + lambda * hLM, 0.18, 1.8);
  const lnLambdaFactor = Math.abs(lambda - 1.0) < 1e-3 ? 1.0 : Math.log(lambda) / (lambda - 1.0);
  const hetpM = clamp(hogM * lnLambdaFactor, 0.22, 1.6);

  // GPDC 교차검증
  const gpdc = calcEckertGpdcPacking(
    inp.vapMassKgH,
    inp.liqMassKgH,
    rhoV,
    rhoL,
    inp.viscLiqCp,
    inp.surfTensMnM,
    D,
    spec,
    foam
  );

  return {
    uSupMS: uV,
    uLoadMS,
    uFloodMS,
    bsFloodPct,
    gpdcFloodVelMS: gpdc.uFloodMS,
    gpdcFloodPct: gpdc.floodPct,
    dryDpMbarM,
    irrigatedDpMbarM,
    dpRatioIrrToDry,
    holdupPreLoad,
    holdupFlood: hFl,
    liquidHoldupFrac,
    wettingRateM3M2H,
    effectiveAreaRatio,
    kLMs,
    kGMs,
    hLM,
    hGM,
    hogM,
    hetpM,
    gpdcHetpM: gpdc.gpdcHetpM,
  };
}

/** 부식성 유체(HCl / Cl2 / 고온 유기염소계) 자동 재질 선정 */
function resolveShellMaterial(
  pref: ShellMaterialCode,
  result: DistillSolveResult,
  feeds: DistillFeedInput[]
): {
  code: Exclude<ShellMaterialCode, 'AUTO'>;
  label: string;
  reason: string;
} {
  const LABELS: Record<Exclude<ShellMaterialCode, 'AUTO'>, string> = {
    CS_A516_70: '탄소강 (SA-516 Gr.70 Killed CS)',
    SS316L: '오스테나이트 스테인리스강 (SUS 316L)',
    DUPLEX_2205: '듀플렉스 스테인리스강 (UNS S32205)',
    PTFE_LINED_CS: '불소수지 라이닝 강관 (PTFE/PFA-Lined CS)',
    ALLOY_C276: '니켈-몰리브덴 초합금 (Alloy C-276)',
  };

  let maxHClWt = 0;
  let maxH2OWt = 0;
  let maxCl2Wt = 0;
  let maxOrganoClWt = 0;
  for (const st of result.stages) {
    maxHClWt = Math.max(maxHClWt, st.xWtPct.HCl || 0, st.yWtPct.HCl || 0);
    maxH2OWt = Math.max(maxH2OWt, st.xWtPct.H2O || 0);
    maxCl2Wt = Math.max(maxCl2Wt, st.xWtPct.Cl2 || 0, st.yWtPct.Cl2 || 0);
    maxOrganoClWt = Math.max(
      maxOrganoClWt,
      (st.xWtPct.ECH || 0) + (st.xWtPct.DCH || 0) + (st.xWtPct.DCP || 0) + (st.xWtPct.MCH || 0)
    );
  }
  const feedWaterKg = feeds.reduce((s, f) => s + (f.flowsKgH.H2O || 0), 0);
  const feedTotalKg = Math.max(
    1e-6,
    feeds.reduce((s, f) => s + Object.values(f.flowsKgH).reduce((a, b) => a + (b || 0), 0), 0)
  );
  const feedWaterPpm = (feedWaterKg / feedTotalKg) * 1e6;

  if (pref !== 'AUTO') {
    return {
      code: pref,
      label: LABELS[pref],
      reason: '사용자 직접 지정 재질 적용',
    };
  }

  if (maxHClWt > 0.5 && (maxH2OWt > 0.05 || feedWaterPpm > 100)) {
    if (result.bottomTempC > 135) {
      return {
        code: 'ALLOY_C276',
        label: LABELS.ALLOY_C276,
        reason: `습식 HCl(${maxHClWt.toFixed(1)} wt%) + 고온(${result.bottomTempC.toFixed(0)}°C) 부식 환경 — 내산 초합금(Alloy C-276) 또는 내산벽돌 라이닝 필수`,
      };
    }
    return {
      code: 'PTFE_LINED_CS',
      label: LABELS.PTFE_LINED_CS,
      reason: `함수 염산(HCl ${maxHClWt.toFixed(1)} wt% + H₂O) 강부식 영역 — 일반 SUS316L 공식(Pitting) 방지를 위해 PTFE/PFA 라이닝 자동 선정`,
    };
  }

  if (maxHClWt > 5.0 && feedWaterPpm <= 100 && result.bottomTempC < 40) {
    return {
      code: 'SS316L',
      label: LABELS.SS316L,
      reason: `수분 ${feedWaterPpm.toFixed(0)} ppm 이하 극건조 무수염산(AHCl, 저온 ${result.topTempC.toFixed(0)}°C) — 저온 인성 및 청정도 확보용 SUS316L 적용`,
    };
  }

  if (maxCl2Wt > 0.1 && maxH2OWt > 0.02) {
    return {
      code: 'PTFE_LINED_CS',
      label: LABELS.PTFE_LINED_CS,
      reason: '습식 염소(Wet Cl₂) 부식 환경 — PTFE 라이닝 또는 티타늄(Ti Gr.2) 필수',
    };
  }

  if (maxOrganoClWt > 5.0) {
    if (maxH2OWt > 0.2 && result.bottomTempC > 115) {
      return {
        code: 'DUPLEX_2205',
        label: LABELS.DUPLEX_2205,
        reason: `유기염소계(ECH/DCH/DCP) + 수분 가수분해 미량 Cl⁻ 응력부식균열(SCC) 방지용 Duplex 2205 권장`,
      };
    }
    return {
      code: 'SS316L',
      label: LABELS.SS316L,
      reason: '유기염소계(ECH/DCH/DCP) 정밀증류 공정 표준 내식 재질 (SUS 316L)',
    };
  }

  return {
    code: 'SS316L',
    label: LABELS.SS316L,
    reason: '화학플랜트 다성분 정밀증류 범용 표준 재질 (SUS 316L)',
  };
}

function mapToMechMaterial(code: Exclude<ShellMaterialCode, 'AUTO'>): MechMaterialKey {
  switch (code) {
    case 'CS_A516_70':
    case 'PTFE_LINED_CS':
      return 'CS_SA516_70';
    case 'DUPLEX_2205':
      return 'DUPLEX_2205';
    case 'ALLOY_C276':
      return 'ALLOY_C276';
    default:
      return 'SS316L';
  }
}

function mapToCostMaterial(code: Exclude<ShellMaterialCode, 'AUTO'>): CostMaterialKey {
  switch (code) {
    case 'CS_A516_70':
      return 'CS';
    case 'PTFE_LINED_CS':
      return 'PTFE_LINED';
    case 'DUPLEX_2205':
      return 'DUPLEX_2205';
    case 'ALLOY_C276':
      return 'ALLOY_C276';
    default:
      return 'SS316L';
  }
}

function mapPackingCostCategory(key: PackingKey): NonNullable<ColumnVesselCostInput['packingCategory']> {
  switch (key) {
    case 'mellapak_350y':
      return 'structured_350y';
    case 'corrpak_ptfe_250y':
      return 'structured_ptfe';
    case 'graphite_struct_250':
      return 'structured_graphite';
    case 'imtp_40_metal':
    case 'pall_ring_38_ss':
    case 'pall_ring_25_ss':
      return 'random_metal';
    case 'ceramic_intalox_38':
      return 'random_ceramic';
    default:
      return 'structured_250y';
  }
}

function recommendedDripPointsPerM2(spec: PackingCatalogSpec): number {
  if (spec.key === 'mellapak_350y') return 140;
  if (spec.category === 'structured') return 100;
  if (spec.surfaceAreaM2M3 >= 195) return 80;
  return 60;
}

/**
 * 다단 MESH 시뮬레이션 결과(DistillSolveResult)로부터
 * 트레이(Fair/Glitsch/Lockett/Chan–Fair) · 충진탑(Billet–Schultes 1999) ·
 * ASME VIII Div.1 기계설계(내압/진공외압/풍/지진/스커트/노즐보강) ·
 * Guthrie/Turton Bare-Module 장치원가를 일괄 산출
 */
export function solveColumnInternalsDesign(
  colConfig: DistillColumnParams,
  feeds: DistillFeedInput[],
  simResult: DistillSolveResult
): ColumnInternalsSolveResult {
  const ic: ColumnInternalsParams = colConfig.internalsConfig ?? {};
  const internalsKind: ColumnInternalsKind = ic.internalsKind ?? 'tray';
  const shellSectionMode: ShellSectionMode = ic.shellSectionMode ?? 'uniform';
  const targetFloodRatio = clamp((ic.designFloodTargetPct ?? 76) / 100.0, 0.45, 0.88);
  const foamingFactor = clamp(ic.foamingFactor ?? 0.90, 0.60, 1.0);

  const trayType: TrayDeckType = ic.trayType ?? 'valve';
  const traySpacingMm = clamp(ic.traySpacingMm ?? 500, 250, 900);
  const dcAreaFrac = clamp((ic.downcomerAreaPct ?? 12) / 100.0, 0.06, 0.22);
  const weirHeightMm = clamp(ic.weirHeightMm ?? 50, 25, 100);
  const holeDiameterMm = clamp(
    ic.holeDiameterMm ?? (trayType === 'valve' ? 38 : trayType === 'bubble_cap' ? 75 : 5.0),
    3.0,
    100.0
  );
  const holeAreaFrac = clamp((ic.holeAreaPct ?? 10) / 100.0, 0.05, 0.16);
  const passesPref = ic.flowPasses ?? 'auto';

  const packingKey: PackingKey = ic.packingKey ?? 'mellapak_250y';
  const packingSpec = PACKING_CATALOG[packingKey] ?? PACKING_CATALOG.mellapak_250y;
  const maxBedHeightM = clamp(ic.maxBedHeightM ?? 5.5, 2.5, 9.0);

  const stages = simResult.stages;
  const N = stages.length;
  const feedStage = clamp(simResult.feedStageUsed || Math.round(N / 2), 2, Math.max(2, N - 1));
  const murphreeUserEff = clamp((colConfig.murphreeEffPct ?? 75) / 100.0, 0.25, 1.0);
  const alphaEst = clamp(simResult.shortcutDesign?.alphaAvg ?? 2.35, 1.15, 12.0);

  const internalStages = stages.length >= 3 ? stages.slice(1, stages.length - 1) : stages;

  // 1단계: 단별 물성 및 최소 필요 내경 D_req 산출 (트레이: Jet Flood + Glitsch DC Choke 동시 검토; 충진탑: Billet–Schultes 범람 기준)
  let reqRectDiamM = 0.42;
  let reqStripDiamM = 0.42;
  let peakRectLiqM3H = 0.5;
  let peakStripLiqM3H = 0.5;

  const stagePropsCache = internalStages.map((st) => {
    const props = calcStageMixtureProps(st);
    const section: 'rectifying' | 'stripping' = st.stage < feedStage ? 'rectifying' : 'stripping';
    const qVapM3S = st.vapMassKgH / (Math.max(0.04, props.rhoVapKgM3) * 3600.0);
    const qLiqM3H = st.liqMassKgH / Math.max(350, props.rhoLiqKgM3);
    const qLiqM3S = qLiqM3H / 3600.0;
    const flv = clamp(
      (st.liqMassKgH / Math.max(1e-3, st.vapMassKgH)) * Math.sqrt(props.rhoVapKgM3 / props.rhoLiqKgM3),
      0.012,
      2.0
    );

    // 국소 탈거인자 λ = m·(V_mol / L_mol), m ≈ √α 평형기울기 근사
    const vOverLMol = st.vapFlowKmolH / Math.max(1e-4, st.liqFlowKmolH);
    const mEqApprox = section === 'rectifying' ? 1.0 / Math.pow(alphaEst, 0.35) : Math.pow(alphaEst, 0.35);
    const lambdaStage = clamp(mEqApprox * vOverLMol, 0.35, 3.2);

    let dReqStage = 0.42;
    if (internalsKind === 'tray') {
      const csbFlood = calcFairCsbFlood(flv, traySpacingMm, props.surfTensMnM, foamingFactor, holeAreaFrac);
      const uNetFlood = csbFlood * Math.sqrt(Math.max(1.0, (props.rhoLiqKgM3 - props.rhoVapKgM3) / props.rhoVapKgM3));
      const uNetDesign = Math.max(0.18, targetFloodRatio * uNetFlood);
      const areaNetReq = qVapM3S / uNetDesign;
      const areaTotJet = areaNetReq / Math.max(0.74, 1.0 - dcAreaFrac);

      const vDcMax = calcGlitschDcChokeVelMS(props.rhoLiqKgM3, props.rhoVapKgM3, traySpacingMm, foamingFactor);
      const areaDcReq = qLiqM3S / Math.max(0.02, targetFloodRatio * vDcMax);
      const areaTotDc = areaDcReq / dcAreaFrac;

      dReqStage = Math.sqrt((4.0 * Math.max(areaTotJet, areaTotDc)) / Math.PI);
    } else {
      let dGuess = 1.0;
      for (let it = 0; it < 4; it++) {
        const bs = calcBilletSchultesPacking({
          spec: packingSpec,
          diamM: dGuess,
          vapMassKgH: st.vapMassKgH,
          liqMassKgH: st.liqMassKgH,
          rhoVapKgM3: props.rhoVapKgM3,
          rhoLiqKgM3: props.rhoLiqKgM3,
          viscLiqCp: props.viscLiqCp,
          viscVapPaS: props.viscVapPaS,
          surfTensMnM: props.surfTensMnM,
          foamingFactor,
          tempC: st.tempC,
          pressBarA: st.pressBarA,
          avgMwVap: props.avgMwVap,
          avgMwLiq: props.avgMwLiq,
          strippingFactorLambda: lambdaStage,
        });
        const uDes = Math.max(0.18, targetFloodRatio * bs.uFloodMS);
        const aReq = qVapM3S / uDes;
        dGuess = Math.max(0.40, Math.sqrt((4.0 * aReq) / Math.PI));
      }
      dReqStage = dGuess;
    }

    if (section === 'rectifying') {
      reqRectDiamM = Math.max(reqRectDiamM, dReqStage);
      peakRectLiqM3H = Math.max(peakRectLiqM3H, qLiqM3H);
    } else {
      reqStripDiamM = Math.max(reqStripDiamM, dReqStage);
      peakStripLiqM3H = Math.max(peakStripLiqM3H, qLiqM3H);
    }

    return { st, props, section, qVapM3S, qLiqM3H, flv, lambdaStage, dReqStage };
  });

  // 2단계: 공칭 내경 선정 (Uniform vs Swaged + 수동 오버라이드 반영)
  const overallReqDiam = Math.max(reqRectDiamM, reqStripDiamM);
  let rectDiamM: number;
  let stripDiamM: number;

  if (shellSectionMode === 'swaged') {
    rectDiamM =
      ic.manualRectDiamM && ic.manualRectDiamM >= 0.35
        ? ic.manualRectDiamM
        : pickStandardDiam(reqRectDiamM);
    stripDiamM =
      ic.manualStripDiamM && ic.manualStripDiamM >= 0.35
        ? ic.manualStripDiamM
        : pickStandardDiam(reqStripDiamM);
  } else {
    const uniD =
      ic.manualRectDiamM && ic.manualRectDiamM >= 0.35
        ? ic.manualRectDiamM
        : pickStandardDiam(overallReqDiam);
    rectDiamM = uniD;
    stripDiamM = uniD;
  }

  const rectTrayGeom = calcMultiPassTrayGeometry(rectDiamM, dcAreaFrac, holeAreaFrac, passesPref, peakRectLiqM3H);
  const stripTrayGeom = calcMultiPassTrayGeometry(stripDiamM, dcAreaFrac, holeAreaFrac, passesPref, peakStripLiqM3H);

  // 3단계: 선정된 공칭 내경 기준 단별 수력학·물질전달 정밀 평가
  const stageRows: StageHydraulicRow[] = [];
  let maxFloodPct = 0;
  let maxJetFloodPct = 0;
  let maxDcChokeFloodPct = 0;
  let minDcResidenceTimeSec = 999;
  let maxFloodStage = 2;
  let rectMaxFlood = 0;
  let rectCtrlStage = 2;
  let stripMaxFlood = 0;
  let stripCtrlStage = feedStage;
  let minWeepSafety = 99.0;
  let sumChanFairPct = 0;
  let sumOconnellPct = 0;

  for (const item of stagePropsCache) {
    const { st, props, section, flv, lambdaStage } = item;
    const diamM = section === 'rectifying' ? rectDiamM : stripDiamM;

    if (internalsKind === 'tray') {
      const tr = calcTrayPointHydraulics({
        trayType,
        diamM,
        traySpacingMm,
        weirHeightMm,
        dcAreaFrac,
        holeAreaFrac,
        holeDiameterMm,
        passesPref,
        foamingFactor,
        vapMassKgH: st.vapMassKgH,
        liqMassKgH: st.liqMassKgH,
        rhoVapKgM3: props.rhoVapKgM3,
        rhoLiqKgM3: props.rhoLiqKgM3,
        surfTensMnM: props.surfTensMnM,
        viscLiqCp: props.viscLiqCp,
        tempC: st.tempC,
        pressBarA: st.pressBarA,
        avgMwVap: props.avgMwVap,
        avgMwLiq: props.avgMwLiq,
        alphaRelVol: alphaEst,
        strippingFactorLambda: lambdaStage,
      });

      sumChanFairPct += tr.chanFair.chanFairEffPct;
      sumOconnellPct += tr.oconnellEffPct;
      minWeepSafety = Math.min(minWeepSafety, tr.weepRatio);
      maxJetFloodPct = Math.max(maxJetFloodPct, tr.jetFloodPct);
      maxDcChokeFloodPct = Math.max(maxDcChokeFloodPct, tr.dcChokeFloodPct);
      minDcResidenceTimeSec = Math.min(minDcResidenceTimeSec, tr.dcResidenceTimeSec);

      let status: StageHydraulicStatus = 'optimal';
      let statusNote = '정상 운전영역';
      if (tr.floodPct >= 88 || tr.dcBackupPct >= 85) {
        status = 'flooding';
        statusNote =
          tr.dcChokeFloodPct >= 88
            ? '다운코머 초크(Choke) 범람 초과 — DC 면적 또는 탑경 확대 필요'
            : tr.jetFloodPct >= 88
            ? '제트 범람(Jet Flood) 초과 — 탑경 확대 필요'
            : '다운코머 백업 범람 위험';
      } else if (tr.weepRatio < 1.0) {
        status = 'weeping';
        statusNote = `Lockett 위핑 발생 (누설 ${(tr.weepFraction * 100).toFixed(0)}%) — 개구율 축소 또는 밸브트레이 권장`;
      } else if (tr.floodPct >= 82 || tr.dcBackupPct >= 70 || tr.dcResidenceTimeSec < 3.0) {
        status = 'high';
        statusNote = tr.dcResidenceTimeSec < 3.0 ? `DC 체류시간 부족 (${tr.dcResidenceTimeSec.toFixed(1)}s < 3s)` : '고부하 운전 (>82% Flood)';
      } else if (tr.floodPct < 42) {
        status = 'low';
        statusNote = '저부하 여유 과다 (<42% Flood)';
      }

      stageRows.push({
        stage: st.stage,
        section,
        tempC: st.tempC,
        pressBarA: st.pressBarA,
        vapMassKgH: st.vapMassKgH,
        liqMassKgH: st.liqMassKgH,
        rhoVapKgM3: props.rhoVapKgM3,
        rhoLiqKgM3: props.rhoLiqKgM3,
        surfTensMnM: props.surfTensMnM,
        viscLiqCp: props.viscLiqCp,
        flowParamFlv: tr.flowParamFlv,
        fFactorPa05: tr.fFactorPa05,
        superficialVelMS: tr.superficialVelMS,
        floodVelMS: tr.uNetFloodMS * (tr.geom.areaNetM2 / tr.geom.areaTotalM2),
        floodPct: tr.floodPct,
        dpMmH2O: tr.dpMmH2O,
        dpMbar: tr.dpMbar,
        jetFloodPct: tr.jetFloodPct,
        dcChokeFloodPct: tr.dcChokeFloodPct,
        dcResidenceTimeSec: tr.dcResidenceTimeSec,
        weirLoadM3HM: tr.weirLoadM3HM,
        weirCrestMm: tr.weirCrestMm,
        dryDropMmLiq: tr.dryDropMmLiq,
        valveRegime: tr.valveRegime,
        dcBackupPct: tr.dcBackupPct,
        weepRatio: tr.weepRatio,
        weepFraction: tr.weepFraction,
        holeFroudeNumber: tr.holeFroudeNumber,
        entrainmentFrac: tr.entrainmentFrac,
        pointEffPct: tr.chanFair.pointEffPct,
        chanFairEffPct: tr.chanFair.chanFairEffPct,
        oconnellEffPct: tr.oconnellEffPct,
        predictedMurphreeEffPct: tr.chanFair.chanFairEffPct,
        bsFloodPct: 0,
        gpdcFloodPct: 0,
        dryDpMbarM: 0,
        specificDpMbarM: tr.dpMbar / (traySpacingMm / 1000.0),
        liquidHoldupFrac: 0,
        effectiveAreaRatio: 0,
        kLMmS: 0,
        kGMs: 0,
        hogM: 0,
        wettingRateM3M2H: (st.liqMassKgH / props.rhoLiqKgM3) / tr.geom.areaTotalM2,
        localHetpM: (traySpacingMm / 1000.0) / Math.max(0.25, tr.chanFair.chanFairEffPct / 100.0),
        gpdcHetpM: (traySpacingMm / 1000.0) / murphreeUserEff,
        status,
        statusNote,
      });

      if (tr.floodPct > maxFloodPct) {
        maxFloodPct = tr.floodPct;
        maxFloodStage = st.stage;
      }
      if (section === 'rectifying' && tr.floodPct > rectMaxFlood) {
        rectMaxFlood = tr.floodPct;
        rectCtrlStage = st.stage;
      }
      if (section === 'stripping' && tr.floodPct > stripMaxFlood) {
        stripMaxFlood = tr.floodPct;
        stripCtrlStage = st.stage;
      }
    } else {
      // 충진탑 모드 단별 Billet–Schultes (1999) + GPDC 교차검증
      const bs = calcBilletSchultesPacking({
        spec: packingSpec,
        diamM,
        vapMassKgH: st.vapMassKgH,
        liqMassKgH: st.liqMassKgH,
        rhoVapKgM3: props.rhoVapKgM3,
        rhoLiqKgM3: props.rhoLiqKgM3,
        viscLiqCp: props.viscLiqCp,
        viscVapPaS: props.viscVapPaS,
        surfTensMnM: props.surfTensMnM,
        foamingFactor,
        tempC: st.tempC,
        pressBarA: st.pressBarA,
        avgMwVap: props.avgMwVap,
        avgMwLiq: props.avgMwLiq,
        strippingFactorLambda: lambdaStage,
      });

      const dpMbar = bs.irrigatedDpMbarM * bs.hetpM;
      const dpMmH2O = dpMbar / 0.0980665;
      const wetRatio = bs.wettingRateM3M2H / Math.max(0.2, packingSpec.minWettingM3M2H);
      const fFactorPa05 = bs.uSupMS * Math.sqrt(props.rhoVapKgM3);
      minWeepSafety = Math.min(minWeepSafety, wetRatio);

      const oconnellPct = clamp(50.3 * Math.pow(Math.max(0.08, alphaEst * props.viscLiqCp), -0.226), 25.0, 92.0);
      const eqEffPct = clamp((packingSpec.baseHetpM / bs.hetpM) * 78.0, 40.0, 95.0);
      sumChanFairPct += eqEffPct;
      sumOconnellPct += oconnellPct;

      let status: StageHydraulicStatus = 'optimal';
      let statusNote = '정상 적심·부하 영역 (Billet–Schultes)';
      if (bs.bsFloodPct >= 86 || bs.irrigatedDpMbarM >= 15.0) {
        status = 'flooding';
        statusNote = '충진층 범람(Flooding) 임계 초과';
      } else if (wetRatio < 0.85) {
        status = 'weeping';
        statusNote = '액체 적심유량(Wetting Rate) 부족 — 채널링 주의';
      } else if (bs.bsFloodPct >= 80) {
        status = 'high';
        statusNote = '고부하 로딩 영역 (>80% Flood)';
      } else if (bs.bsFloodPct < 38) {
        status = 'low';
        statusNote = '저부하 영역 (<38% Flood)';
      }

      stageRows.push({
        stage: st.stage,
        section,
        tempC: st.tempC,
        pressBarA: st.pressBarA,
        vapMassKgH: st.vapMassKgH,
        liqMassKgH: st.liqMassKgH,
        rhoVapKgM3: props.rhoVapKgM3,
        rhoLiqKgM3: props.rhoLiqKgM3,
        surfTensMnM: props.surfTensMnM,
        viscLiqCp: props.viscLiqCp,
        flowParamFlv: flv,
        fFactorPa05,
        superficialVelMS: bs.uSupMS,
        floodVelMS: bs.uFloodMS,
        floodPct: bs.bsFloodPct,
        dpMmH2O,
        dpMbar,
        jetFloodPct: 0,
        dcChokeFloodPct: 0,
        dcResidenceTimeSec: 0,
        weirLoadM3HM: 0,
        weirCrestMm: 0,
        dryDropMmLiq: 0,
        valveRegime: 'n/a',
        dcBackupPct: 0,
        weepRatio: wetRatio,
        weepFraction: 0,
        holeFroudeNumber: 0,
        entrainmentFrac: 0.001,
        pointEffPct: eqEffPct,
        chanFairEffPct: eqEffPct,
        oconnellEffPct: oconnellPct,
        predictedMurphreeEffPct: eqEffPct,
        bsFloodPct: bs.bsFloodPct,
        gpdcFloodPct: bs.gpdcFloodPct,
        dryDpMbarM: bs.dryDpMbarM,
        specificDpMbarM: bs.irrigatedDpMbarM,
        liquidHoldupFrac: bs.liquidHoldupFrac,
        effectiveAreaRatio: bs.effectiveAreaRatio,
        kLMmS: bs.kLMs * 1000.0,
        kGMs: bs.kGMs,
        hogM: bs.hogM,
        wettingRateM3M2H: bs.wettingRateM3M2H,
        localHetpM: bs.hetpM,
        gpdcHetpM: bs.gpdcHetpM,
        status,
        statusNote,
      });

      if (bs.bsFloodPct > maxFloodPct) {
        maxFloodPct = bs.bsFloodPct;
        maxFloodStage = st.stage;
      }
      if (section === 'rectifying' && bs.bsFloodPct > rectMaxFlood) {
        rectMaxFlood = bs.bsFloodPct;
        rectCtrlStage = st.stage;
      }
      if (section === 'stripping' && bs.bsFloodPct > stripMaxFlood) {
        stripMaxFlood = bs.bsFloodPct;
        stripCtrlStage = st.stage;
      }
    }
  }

  if (minDcResidenceTimeSec > 900) minDcResidenceTimeSec = 0;

  // 4단계: 정류부(Rectifying) / 스트리핑부(Stripping) 섹션 높이 및 압손 집계
  const isActualMurphreeMesh =
    simResult.stageInputBasisUsed === 'actual_murphree' ||
    (colConfig.columnCalcMode !== 'design_stages' && colConfig.stageInputBasis === 'actual_murphree');

  const rectRows = stageRows.filter((r) => r.section === 'rectifying');
  const stripRows = stageRows.filter((r) => r.section === 'stripping');

  const rectSimulatedN = Math.max(1, rectRows.length);
  const stripSimulatedN = Math.max(1, stripRows.length);

  const rectTheorN = isActualMurphreeMesh
    ? Math.max(1, Math.round(rectSimulatedN * murphreeUserEff))
    : rectSimulatedN;
  const stripTheorN = isActualMurphreeMesh
    ? Math.max(1, Math.round(stripSimulatedN * murphreeUserEff))
    : stripSimulatedN;

  const rectTrays = isActualMurphreeMesh
    ? rectSimulatedN
    : Math.max(1, Math.ceil(rectSimulatedN / murphreeUserEff));
  const stripTrays = isActualMurphreeMesh
    ? stripSimulatedN
    : Math.max(1, Math.ceil(stripSimulatedN / murphreeUserEff));

  const avgOf = (arr: StageHydraulicRow[], fn: (r: StageHydraulicRow) => number, fallback: number) =>
    arr.length > 0 ? arr.reduce((s, r) => s + fn(r), 0) / arr.length : fallback;

  const rectHetpAvg = avgOf(rectRows, (r) => r.localHetpM, packingSpec.baseHetpM);
  const stripHetpAvg = avgOf(stripRows, (r) => r.localHetpM, packingSpec.baseHetpM);

  const rectHeightM =
    internalsKind === 'tray'
      ? rectTrays * (traySpacingMm / 1000.0)
      : Number((rectTheorN * rectHetpAvg).toFixed(2));
  const stripHeightM =
    internalsKind === 'tray'
      ? stripTrays * (traySpacingMm / 1000.0)
      : Number((stripTheorN * stripHetpAvg).toFixed(2));

  const rectDpMbar =
    internalsKind === 'tray'
      ? avgOf(rectRows, (r) => r.dpMbar, 4.0) * rectTrays
      : rectRows.reduce((s, r) => s + r.dpMbar, 0);
  const stripDpMbar =
    internalsKind === 'tray'
      ? avgOf(stripRows, (r) => r.dpMbar, 4.0) * stripTrays
      : stripRows.reduce((s, r) => s + r.dpMbar, 0);

  const rectBeds = internalsKind === 'packed' ? Math.max(1, Math.ceil(rectHeightM / maxBedHeightM)) : 0;
  const stripBeds = internalsKind === 'packed' ? Math.max(1, Math.ceil(stripHeightM / maxBedHeightM)) : 0;
  const packedBedCount = rectBeds + stripBeds;

  const dripPtsPerM2 = internalsKind === 'packed' ? recommendedDripPointsPerM2(packingSpec) : 0;
  const rectDripTotal = internalsKind === 'packed' ? Math.ceil(dripPtsPerM2 * rectTrayGeom.areaTotalM2) : 0;
  const stripDripTotal = internalsKind === 'packed' ? Math.ceil(dripPtsPerM2 * stripTrayGeom.areaTotalM2) : 0;

  const matInfo = resolveShellMaterial(ic.shellMaterial ?? 'AUTO', simResult, feeds);
  const deckThicknessMm = matInfo.code === 'CS_A516_70' ? 3.4 : 2.0;
  const holePitchMm =
    trayType === 'sieve'
      ? Number((holeDiameterMm * Math.sqrt(0.907 / Math.max(0.04, holeAreaFrac))).toFixed(1))
      : trayType === 'valve'
      ? 76.0
      : 125.0;
  const dcClearanceMm = Math.round(Math.min(weirHeightMm - 5, clamp(weirHeightMm - 12, 18, 65)));
  const weirTypeLabel =
    trayType === 'bubble_cap' ? 'Straight Notched Overflow Weir' : 'Vertical Chordal Outlet Weir';
  const sealPanSpecLabel = `Recessed Seal Pan (Pos. Seal ${(weirHeightMm - dcClearanceMm).toFixed(0)} mm)`;
  const trayTypeLabel =
    trayType === 'valve'
      ? 'Moving Valve Tray (Glitsch V-1 / Float Type)'
      : trayType === 'bubble_cap'
      ? 'Bubble-Cap Tray (Bell-Type Riser & Cap)'
      : 'Perforated Sieve Tray (Cross-Flow)';

  const dcTypeOf = (passes: 1 | 2 | 4) =>
    passes === 1
      ? '1-Pass Chordal Segmental Downcomer (Sloped)'
      : passes === 2
      ? '2-Pass Alternating Chordal + Center Downcomer'
      : '4-Pass Chordal + Off-Center + Center Downcomer';

  const buildSectionExtra = (
    rows: StageHydraulicRow[],
    geom: ReturnType<typeof calcMultiPassTrayGeometry>,
    sectionMaxFlood: number,
    sectionDripTotal: number
  ) => {
    const minWeepSec = rows.length > 0 ? Math.min(...rows.map((r) => r.weepRatio)) : 1.8;
    const sectionTurndown = Number(
      clamp(
        internalsKind === 'packed'
          ? Math.max(1.2, minWeepSec * 1.15)
          : trayType === 'bubble_cap'
          ? Math.max(2.5, minWeepSec * 1.6)
          : trayType === 'valve'
          ? Math.max(1.5, minWeepSec * 1.25)
          : Math.max(1.05, minWeepSec),
        0.8,
        8.0
      ).toFixed(2)
    );
    const operatingLoadMinPct = Math.round(clamp(100.0 / Math.max(1.05, sectionTurndown), 18, 95));
    const operatingLoadMaxPct = Math.round(clamp(100.0 * (85.0 / Math.max(25.0, sectionMaxFlood)), 70, 220));
    const avgWetting = Number(avgOf(rows, (r) => r.wettingRateM3M2H, 5.0).toFixed(2));
    return {
      holeDiameterMm,
      holePitchMm,
      openAreaPctOfActive: Number((holeAreaFrac * 100.0).toFixed(1)),
      openAreaPctOfTower: Number(((geom.areaHoleM2 / Math.max(0.05, geom.areaTotalM2)) * 100.0).toFixed(1)),
      deckThicknessMm,
      weirType: weirTypeLabel,
      weirHeightMm,
      weirLengthMm: Math.round(geom.weirLengthM * 1000),
      avgWeirCrestMm: Number(avgOf(rows, (r) => r.weirCrestMm, 18.0).toFixed(1)),
      dcType: dcTypeOf(geom.passes),
      dcWidthTopMm: geom.dcWidthTopMm,
      dcWidthBotMm: geom.dcWidthBotMm,
      dcAreaPctOfTower: Number(((geom.areaDcM2 / Math.max(0.05, geom.areaTotalM2)) * 100.0).toFixed(1)),
      dcClearanceMm,
      sealPanSpec: sealPanSpecLabel,
      avgDryDropMmLiq: Number(avgOf(rows, (r) => r.dryDropMmLiq, 18.0).toFixed(1)),
      avgTrayDpMbar: Number(avgOf(rows, (r) => r.dpMbar, 4.5).toFixed(2)),
      avgWeepSafetyRatio: Number(avgOf(rows, (r) => r.weepRatio, 1.5).toFixed(2)),
      maxDcBackupPct: Number((rows.length > 0 ? Math.max(...rows.map((r) => r.dcBackupPct)) : 30).toFixed(1)),
      maxEntrainmentPsi: Number((rows.length > 0 ? Math.max(...rows.map((r) => r.entrainmentFrac)) : 0.02).toFixed(4)),
      operatingLoadMinPct,
      operatingLoadMaxPct,
      sectionTurndownRatio: sectionTurndown,
      avgWettingRateM3M2H: avgWetting,
      minWettingRateM3M2H: packingSpec.minWettingM3M2H,
      wettingSafetyRatio: Number((avgWetting / Math.max(0.2, packingSpec.minWettingM3M2H)).toFixed(2)),
      avgIrrigatedDpMbarM: Number(avgOf(rows, (r) => r.specificDpMbarM, 2.0).toFixed(2)),
      avgDryDpMbarM: Number(avgOf(rows, (r) => r.dryDpMbarM, 1.0).toFixed(2)),
      distributorTotalDripPoints: sectionDripTotal,
    };
  };

  const rectExtra = buildSectionExtra(rectRows, rectTrayGeom, rectMaxFlood, rectDripTotal);
  const stripExtra = buildSectionExtra(stripRows, stripTrayGeom, stripMaxFlood, stripDripTotal);

  const rectifying: SectionGeometrySummary = {
    section: 'rectifying',
    label: '상부 정류부 (Rectifying Section)',
    stageStart: 2,
    stageEnd: Math.max(2, feedStage - 1),
    theoreticalStages: rectTheorN,
    actualTraysOrBeds: internalsKind === 'tray' ? rectTrays : rectBeds,
    requiredMinDiamM: Number(reqRectDiamM.toFixed(2)),
    selectedNominalDiamM: Number(rectDiamM.toFixed(2)),
    crossSectionAreaM2: Number(rectTrayGeom.areaTotalM2.toFixed(3)),
    activeAreaM2: Number(rectTrayGeom.areaActiveM2.toFixed(3)),
    downcomerAreaM2: Number(rectTrayGeom.areaDcM2.toFixed(3)),
    holeAreaM2: Number(rectTrayGeom.areaHoleM2.toFixed(3)),
    weirLengthM: Number(rectTrayGeom.weirLengthM.toFixed(2)),
    flowPathLengthM: Number(rectTrayGeom.flowPathLengthM.toFixed(2)),
    flowPasses: rectTrayGeom.passes,
    ...rectExtra,
    maxFloodPct: Number(rectMaxFlood.toFixed(1)),
    maxJetFloodPct: Number(Math.max(0, ...rectRows.map((r) => r.jetFloodPct)).toFixed(1)),
    maxDcChokeFloodPct: Number(Math.max(0, ...rectRows.map((r) => r.dcChokeFloodPct)).toFixed(1)),
    minDcResidenceSec: Number(
      (rectRows.length > 0 ? Math.min(...rectRows.map((r) => r.dcResidenceTimeSec)) : 0).toFixed(2)
    ),
    avgChanFairEffPct: Number(avgOf(rectRows, (r) => r.chanFairEffPct, 75).toFixed(1)),
    avgLiquidHoldupPct: Number((avgOf(rectRows, (r) => r.liquidHoldupFrac, 0) * 100).toFixed(2)),
    avgHogM: Number(avgOf(rectRows, (r) => r.hogM, 0).toFixed(3)),
    gpdcFloodMaxPct: Number(Math.max(0, ...rectRows.map((r) => r.gpdcFloodPct)).toFixed(1)),
    distributorDripPointsPerM2: dripPtsPerM2,
    controllingStage: rectCtrlStage,
    sectionHeightM: Number(rectHeightM.toFixed(2)),
    sectionDpMbar: Number(rectDpMbar.toFixed(1)),
    hetpAvgM: Number(rectHetpAvg.toFixed(2)),
  };

  const stripping: SectionGeometrySummary = {
    section: 'stripping',
    label: '하부 스트리핑부 (Stripping Section)',
    stageStart: feedStage,
    stageEnd: Math.max(feedStage, N - 1),
    theoreticalStages: stripTheorN,
    actualTraysOrBeds: internalsKind === 'tray' ? stripTrays : stripBeds,
    requiredMinDiamM: Number(reqStripDiamM.toFixed(2)),
    selectedNominalDiamM: Number(stripDiamM.toFixed(2)),
    crossSectionAreaM2: Number(stripTrayGeom.areaTotalM2.toFixed(3)),
    activeAreaM2: Number(stripTrayGeom.areaActiveM2.toFixed(3)),
    downcomerAreaM2: Number(stripTrayGeom.areaDcM2.toFixed(3)),
    holeAreaM2: Number(stripTrayGeom.areaHoleM2.toFixed(3)),
    weirLengthM: Number(stripTrayGeom.weirLengthM.toFixed(2)),
    flowPathLengthM: Number(stripTrayGeom.flowPathLengthM.toFixed(2)),
    flowPasses: stripTrayGeom.passes,
    ...stripExtra,
    maxFloodPct: Number(stripMaxFlood.toFixed(1)),
    maxJetFloodPct: Number(Math.max(0, ...stripRows.map((r) => r.jetFloodPct)).toFixed(1)),
    maxDcChokeFloodPct: Number(Math.max(0, ...stripRows.map((r) => r.dcChokeFloodPct)).toFixed(1)),
    minDcResidenceSec: Number(
      (stripRows.length > 0 ? Math.min(...stripRows.map((r) => r.dcResidenceTimeSec)) : 0).toFixed(2)
    ),
    avgChanFairEffPct: Number(avgOf(stripRows, (r) => r.chanFairEffPct, 75).toFixed(1)),
    avgLiquidHoldupPct: Number((avgOf(stripRows, (r) => r.liquidHoldupFrac, 0) * 100).toFixed(2)),
    avgHogM: Number(avgOf(stripRows, (r) => r.hogM, 0).toFixed(3)),
    gpdcFloodMaxPct: Number(Math.max(0, ...stripRows.map((r) => r.gpdcFloodPct)).toFixed(1)),
    distributorDripPointsPerM2: dripPtsPerM2,
    controllingStage: stripCtrlStage,
    sectionHeightM: Number(stripHeightM.toFixed(2)),
    sectionDpMbar: Number(stripDpMbar.toFixed(1)),
    hetpAvgM: Number(stripHetpAvg.toFixed(2)),
  };

  // 5단계: 탑 기계 치수(섬프 체류시간, 전체 T-T 높이 및 절대 EL 맵) 산출
  const governingDiamM = Math.max(rectDiamM, stripDiamM);
  const sumpResMin = clamp(ic.sumpResidenceMin ?? 4.0, 1.5, 15.0);
  const botStage = stages[stages.length - 1];
  const botProps = botStage
    ? calcStageMixtureProps(botStage)
    : { rhoLiqKgM3: 1100, rhoVapKgM3: 2.0, surfTensMnM: 30, viscLiqCp: 0.8, viscVapPaS: 1e-5, avgMwVap: 60, avgMwLiq: 65 };
  const botDrawKgH = Object.values(simResult.bottomsFlowsKgH).reduce((a, b) => a + (b || 0), 0);
  const botInternalLiqKgH = Math.max(botDrawKgH, stageRows[stageRows.length - 1]?.liqMassKgH ?? botDrawKgH);
  const sumpLiqVolM3 = ((botDrawKgH + 0.22 * botInternalLiqKgH) / Math.max(500, botProps.rhoLiqKgM3)) * (sumpResMin / 60.0);
  const stripAreaM2 = Math.max(0.15, stripTrayGeom.areaTotalM2);
  const sumpLiquidHeightM = clamp(sumpLiqVolM3 / stripAreaM2, 0.8, 4.2);
  const reboilerReturnClearanceM = Math.max(0.9, 0.45 * stripDiamM);
  const sumpTotalHeightM = Number((sumpLiquidHeightM + reboilerReturnClearanceM).toFixed(2));

  const topDisengageHeightM = Number(Math.max(1.1, 0.55 * rectDiamM).toFixed(2));
  const redistributorAllowanceM =
    internalsKind === 'packed' ? Math.max(0, packedBedCount - 2) * 0.85 : 0;
  const swageTransitionM =
    shellSectionMode === 'swaged' && Math.abs(rectDiamM - stripDiamM) >= 0.12 ? 0.75 : 0;
  const feedFlashZoneHeightM = Number((Math.max(0.9, 0.45 * governingDiamM) + swageTransitionM).toFixed(2));

  const hasSideCut =
    (simResult.sideCutMassKgH ?? 0) > 1e-3 &&
    (simResult.sideCutStageUsed ?? 0) >= 2 &&
    Boolean(simResult.sideCutFlowsKgH);
  const sideCutStage = clamp(simResult.sideCutStageUsed ?? feedStage, 2, Math.max(2, N - 1));
  const sideCutChimneyAllowanceM =
    hasSideCut && internalsKind === 'tray' && simResult.sideCutPhase !== 'G' ? 0.6 : 0;
  const sideCutChimneyMm = Math.round(sideCutChimneyAllowanceM * 1000);
  const sideCutInStrip = hasSideCut && sideCutStage >= feedStage;
  const sideCutInRect = hasSideCut && sideCutStage < feedStage;

  const tangentToTangentHeightM = Number(
    (
      topDisengageHeightM +
      rectHeightM +
      feedFlashZoneHeightM +
      stripHeightM +
      redistributorAllowanceM +
      sideCutChimneyAllowanceM +
      sumpTotalHeightM
    ).toFixed(2)
  );
  const skirtHeightM = colConfig.reboilerType === 'thermosyphon' ? 3.5 : 2.8;
  const totalElevationM = Number((tangentToTangentHeightM + skirtHeightM + 0.6 * governingDiamM).toFixed(2));
  const lengthToDiamRatio = Number((tangentToTangentHeightM / Math.max(0.4, governingDiamM)).toFixed(1));

  // 절대 고도 맵 (EL +xxxx mm from Base Ring EL 0)
  const btlElMm = Math.round(skirtHeightM * 1000);
  const ttlElMm = btlElMm + Math.round(tangentToTangentHeightM * 1000);
  const sumpTotMm = Math.round(sumpTotalHeightM * 1000);
  const sumpLiqMm = Math.min(sumpTotMm - 250, Math.round(sumpLiquidHeightM * 1000));
  const lllElMm = btlElMm + Math.max(150, Math.round(0.25 * sumpLiqMm));
  const nllElMm = btlElMm + Math.max(lllElMm - btlElMm + 150, Math.round(0.62 * sumpLiqMm));
  const hllElMm = btlElMm + Math.max(nllElMm - btlElMm + 150, sumpLiqMm);
  const stripBotElMm = btlElMm + sumpTotMm;
  const stripInterBedCount = internalsKind === 'packed' ? Math.max(0, stripBeds - 1) : 0;
  const stripSpanMm = Math.max(
    250,
    Math.round(stripHeightM * 1000) + stripInterBedCount * 850 + (sideCutInStrip ? sideCutChimneyMm : 0)
  );
  const stripTopElMm = stripBotElMm + stripSpanMm;
  const feedFlashMm = Math.max(450, Math.round(feedFlashZoneHeightM * 1000));
  const feedNozzleElMm = stripTopElMm + Math.round(0.5 * feedFlashMm);
  const rectBotElMm = stripTopElMm + feedFlashMm;
  const rectInterBedCount = internalsKind === 'packed' ? Math.max(0, rectBeds - 1) : 0;
  const rectSpanMm = Math.max(
    250,
    Math.min(
      ttlElMm - rectBotElMm - 600,
      Math.round(rectHeightM * 1000) + rectInterBedCount * 850 + (sideCutInRect ? sideCutChimneyMm : 0)
    )
  );
  const rectTopElMm = rectBotElMm + rectSpanMm;
  const demisterElMm = rectTopElMm + Math.max(250, Math.round(0.62 * (ttlElMm - rectTopElMm)));
  const oalElMm = Math.max(ttlElMm + Math.round(0.25 * rectDiamM * 1000) + 350, Math.round(totalElevationM * 1000));

  let sideCutNozzleElMm: number | undefined;
  if (hasSideCut) {
    let rawSideElMm: number;
    if (sideCutStage < feedStage) {
      const rStart = 2;
      const rEnd = Math.max(2, feedStage - 1);
      const frac = rEnd > rStart ? clamp((sideCutStage - rStart) / (rEnd - rStart), 0, 1) : 0.5;
      rawSideElMm = rectTopElMm - frac * (rectTopElMm - rectBotElMm);
    } else {
      const sStart = feedStage;
      const sEnd = Math.max(feedStage, N - 1);
      const frac = sEnd > sStart ? clamp((sideCutStage - sStart) / (sEnd - sStart), 0, 1) : 0.5;
      rawSideElMm = stripTopElMm - frac * (stripTopElMm - stripBotElMm);
    }
    sideCutNozzleElMm = Math.round(clamp(rawSideElMm, btlElMm + 300, ttlElMm - 300));
  }

  const elevations: ColumnElevationMap = {
    baseElMm: 0,
    btlElMm,
    lllElMm,
    nllElMm,
    hllElMm,
    stripBotElMm,
    stripTopElMm,
    feedNozzleElMm,
    ...(sideCutNozzleElMm !== undefined ? { sideCutNozzleElMm } : {}),
    rectBotElMm,
    rectTopElMm,
    demisterElMm,
    ttlElMm,
    oalElMm,
  };

  // 패킹 베드 및 내부 하드웨어 스케줄 (Top -> Bottom 베드 넘버링 Bed #1 .. Bed #K)
  const packedBeds: PackedBedSpec[] = [];
  const internalsMatLabel =
    matInfo.code === 'CS_A516_70' ? 'SS316L / Carbon Steel' : matInfo.label.split('(')[0].trim();

  if (internalsKind === 'packed') {
    const interGapMm = 850;
    const rectSingleH = Math.max(0.25, Number((rectHeightM / Math.max(1, rectBeds)).toFixed(2)));
    for (let b = 0; b < rectBeds; b++) {
      const topEl = rectTopElMm - b * (Math.round(rectSingleH * 1000) + interGapMm);
      const botEl =
        b === rectBeds - 1
          ? rectBotElMm
          : Math.max(rectBotElMm, topEl - Math.round(rectSingleH * 1000));
      const hMm = Math.max(250, topEl - botEl);
      packedBeds.push({
        bedNumber: b + 1,
        section: 'rectifying',
        sectionLabel: `상부 정류부 Bed #${b + 1}`,
        diameterMm: Math.round(rectDiamM * 1000),
        bedHeightM: Number((hMm / 1000).toFixed(2)),
        bedHeightMm: hMm,
        hetpM: rectifying.hetpAvgM,
        hetpMm: Math.round(rectifying.hetpAvgM * 1000),
        eqTheoreticalStages: Number((rectTheorN / Math.max(1, rectBeds)).toFixed(1)),
        botElMm: botEl,
        topElMm: topEl,
        bedDpMbar: Number((rectDpMbar / Math.max(1, rectBeds)).toFixed(1)),
        maxFloodPct: rectifying.maxFloodPct,
      });
    }
    const stripSingleH = Math.max(0.25, Number((stripHeightM / Math.max(1, stripBeds)).toFixed(2)));
    for (let b = 0; b < stripBeds; b++) {
      const topEl = stripTopElMm - b * (Math.round(stripSingleH * 1000) + interGapMm);
      const botEl =
        b === stripBeds - 1
          ? stripBotElMm
          : Math.max(stripBotElMm, topEl - Math.round(stripSingleH * 1000));
      const hMm = Math.max(250, topEl - botEl);
      packedBeds.push({
        bedNumber: rectBeds + b + 1,
        section: 'stripping',
        sectionLabel: `하부 스트리핑부 Bed #${rectBeds + b + 1}`,
        diameterMm: Math.round(stripDiamM * 1000),
        bedHeightM: Number((hMm / 1000).toFixed(2)),
        bedHeightMm: hMm,
        hetpM: stripping.hetpAvgM,
        hetpMm: Math.round(stripping.hetpAvgM * 1000),
        eqTheoreticalStages: Number((stripTheorN / Math.max(1, stripBeds)).toFixed(1)),
        botElMm: botEl,
        topElMm: topEl,
        bedDpMbar: Number((stripDpMbar / Math.max(1, stripBeds)).toFixed(1)),
        maxFloodPct: stripping.maxFloodPct,
      });
    }
  }

  const redistributorItems: PackingHardwareSchedule['redistributors']['items'] = [];
  if (internalsKind === 'packed' && packedBeds.length > 1) {
    for (let i = 0; i < packedBeds.length - 1; i++) {
      const upperBed = packedBeds[i];
      const lowerBed = packedBeds[i + 1];
      const isFeedInter = upperBed.section === 'rectifying' && lowerBed.section === 'stripping';
      const elMm = Math.round((upperBed.botElMm + lowerBed.topElMm) / 2);
      redistributorItems.push({
        tag: `RD-${i + 1}`,
        location: isFeedInter
          ? `Feed Zone (Bed #${upperBed.bedNumber} ↔ #${lowerBed.bedNumber})`
          : `Inter-Bed (Bed #${upperBed.bedNumber} ↔ #${lowerBed.bedNumber})`,
        collectorType: 'Venetian-Blind Chimney Tray Collector',
        redistributorType:
          packingSpec.category === 'structured'
            ? 'Narrow-Trough Gravity Redistributor'
            : 'Orifice Pan + Riser Liquid Redistributor',
        dripPointsPerM2: dripPtsPerM2,
        freeGasAreaPct: 35,
        interBedHeightMm: Math.max(650, upperBed.botElMm - lowerBed.topElMm),
        elevationMm: elMm,
      });
    }
  }

  const packingHardware: PackingHardwareSchedule = {
    topDistributor: {
      tag: 'LD-1',
      type:
        packingSpec.category === 'structured'
          ? 'Narrow-Trough Gravity Orifice Distributor w/ Parting Box'
          : 'Orifice Pan Gravity Distributor w/ Vapor Risers',
      dripPointsPerM2: dripPtsPerM2,
      totalDripPoints: rectDripTotal,
      turndownSpec: '2.5 : 1 (Gravity Head)',
      elevationMm: rectTopElMm + 280,
      material: internalsMatLabel,
    },
    redistributors: {
      count: redistributorItems.length,
      items: redistributorItems,
    },
    supportPlates: {
      count: packedBeds.length,
      type:
        packingSpec.category === 'structured'
          ? 'Corrugated Strip Support Grid (Open ≥88%)'
          : 'Gas-Injection Multi-Beam Support Plate (Open ≥85%)',
      freeAreaPct: packingSpec.category === 'structured' ? 88 : 85,
      allowableLoadKgM2: 1500,
      elevationsMm: packedBeds.map((b) => b.botElMm),
      material: internalsMatLabel,
    },
    holdDownGrids: {
      count: packedBeds.length,
      type:
        packingSpec.category === 'structured'
          ? 'Bolted Bed Limiter Grid (Anti-Uplift)'
          : 'Weighted Hold-Down Grid (Anti-Fluidization)',
      freeAreaPct: 92,
      elevationsMm: packedBeds.map((b) => b.topElMm),
      material: internalsMatLabel,
    },
    demister: {
      tag: 'ME-1',
      type: 'Knitted Wire-Mesh Mist Eliminator Pad',
      thicknessMm: 150,
      densityKgM3: 144,
      elevationMm: demisterElMm,
      material: internalsMatLabel,
    },
  };

  const vacuumStiffenerRequired = (colConfig.topPressKgcm2g ?? 0.05) < -0.05;
  const maxOpPressBarG = Math.max(
    (colConfig.topPressKgcm2g ?? 0.05) * 0.980665,
    (simResult.bottomPressKgcm2g ?? 0.2) * 0.980665
  );
  const designPressBarG = Math.max(3.5, maxOpPressBarG + 1.8, maxOpPressBarG * 1.15);
  const defaultFlangeRating = designPressBarG > 16.0 ? 'ASME 300# RFWN' : 'ASME 150# RFWN';

  // 6단계: 주요 노즐 6개 사이징 + Friedel (1979) 2상 노즐 압손 + 설치 고도 EL
  const topStage = stages[0];
  const topProps = topStage ? calcStageMixtureProps(topStage) : botProps;
  const feedStageObj = stages[Math.min(stages.length - 1, Math.max(0, feedStage - 1))] ?? botStage;
  const feedProps = feedStageObj ? calcStageMixtureProps(feedStageObj) : botProps;

  const ovhdVapKgH = Math.max(10, stageRows[0]?.vapMassKgH ?? botDrawKgH * 2);
  const distKgH = Object.values(simResult.distillateFlowsKgH).reduce((a, b) => a + (b || 0), 0);
  const refluxKgH = Math.max(5, distKgH * simResult.actualRefluxRatio);
  const totalFeedKgH = Math.max(
    10,
    feeds.reduce((s, f) => s + Object.values(f.flowsKgH).reduce((a, b) => a + (b || 0), 0), 0)
  );
  const rebVapKgH = Math.max(10, stageRows[stageRows.length - 1]?.vapMassKgH ?? ovhdVapKgH);

  // 피드 2상 기상 질량분율 x_feed 판정 (명시 vapRatio / forcedPhase 또는 과열 플래시 추산)
  let feedVapKgH = 0;
  for (const f of feeds) {
    const fTot = Object.values(f.flowsKgH).reduce((a, b) => a + (b || 0), 0);
    if (f.forcedPhase === 'G') {
      feedVapKgH += fTot;
    } else if (f.vapRatio && Object.keys(f.vapRatio).length > 0) {
      for (const [k, flow] of Object.entries(f.flowsKgH)) {
        feedVapKgH += (flow || 0) * clamp(f.vapRatio[k as SimCompKey] ?? 0, 0, 1);
      }
    } else if (f.forcedPhase === 'L/G') {
      feedVapKgH += 0.25 * fTot;
    } else if (feedStageObj && f.tempC > feedStageObj.tempC + 2.5) {
      // 밸브 감압 플래시 열량 추산: c_p·ΔT / ΔH_vap ≈ 0.0045·ΔT
      feedVapKgH += fTot * clamp(0.0045 * (f.tempC - feedStageObj.tempC), 0, 0.65);
    }
  }
  const feedQualityX = clamp(feedVapKgH / Math.max(1e-3, totalFeedKgH), 0, 1);

  const buildNozzle = (
    nozzleTag: string,
    service: string,
    phase: ColumnNozzleSpec['phase'],
    massFlowKgH: number,
    rhoL: number,
    rhoG: number,
    muLPas: number,
    muGPas: number,
    sigmaNm: number,
    targetVelMS: number,
    elevationMm: number,
    orientationDeg: number,
    twoPhaseQuality?: number
  ): ColumnNozzleSpec => {
    const x = clamp(twoPhaseQuality ?? (phase === 'Gas/Vapor' ? 1 : 0), 0, 1);
    const densityKgM3 =
      phase === 'Gas/Vapor'
        ? rhoG
        : phase === 'Liquid' || x <= 1e-4
        ? rhoL
        : 1.0 / (x / Math.max(0.04, rhoG) + (1 - x) / Math.max(300, rhoL));

    const qM3S = Math.max(1e-5, massFlowKgH / (Math.max(0.05, densityKgM3) * 3600.0));
    const calcIdMm = Math.sqrt((4.0 * qM3S) / (Math.PI * targetVelMS)) * 1000.0;
    const picked = pickNozzleDn(calcIdMm);
    const actualIdM = picked.idMm / 1000.0;
    const areaNoz = (Math.PI * actualIdM * actualIdM) / 4.0;
    const actualVel = qM3S / areaNoz;
    const rhoV2Pa = Math.round(densityKgM3 * actualVel * actualVel);

    let friedelDpPaPerM: number | undefined;
    let friedelPhiLO2: number | undefined;
    let estLineDpKpa: number | undefined;
    if (phase === 'Two-Phase' && x > 1e-4 && x < 0.9999) {
      const massFlux = massFlowKgH / 3600.0 / areaNoz;
      const fr = friedelTwoPhaseGradient({
        massFluxKgM2s: massFlux,
        quality: x,
        rhoL,
        rhoG: Math.max(0.04, rhoG),
        muL: Math.max(4e-5, muLPas),
        muG: Math.max(5e-6, muGPas),
        sigma: Math.max(1e-3, sigmaNm),
        diamM: actualIdM,
      });
      friedelDpPaPerM = Number(fr.dPdzPaPerM.toFixed(1));
      friedelPhiLO2 = Number(fr.phiLO2.toFixed(2));
      // 등가 인입배관 5 m + 노즐 입출구 국소손실(K=1.8) 합산 ΔP (kPa)
      estLineDpKpa = Number(((fr.dPdzPaPerM * 5.0 + 1.8 * 0.5 * rhoV2Pa) / 1000.0).toFixed(2));
    }

    return {
      nozzleTag,
      service,
      phase,
      massFlowKgH: Number(massFlowKgH.toFixed(1)),
      densityKgM3: Number(densityKgM3.toFixed(2)),
      designVelMS: Number(actualVel.toFixed(2)),
      calcIdMm: Number(calcIdMm.toFixed(1)),
      selectedDn: picked.label,
      rhoV2Pa,
      elevationMm,
      elevationFromBtlMm: elevationMm - btlElMm,
      orientationDeg,
      flangeRating: defaultFlangeRating,
      vaporQuality: phase === 'Two-Phase' ? Number(x.toFixed(3)) : undefined,
      friedelDpPaPerM,
      friedelPhiLO2,
      estLineDpKpa,
    };
  };

  const uOvhdTarget = clamp(32.0 / Math.sqrt(Math.max(0.08, topProps.rhoVapKgM3)), 8.0, 28.0);
  const feedRhoMix =
    feedQualityX > 0.005
      ? 1.0 / (feedQualityX / Math.max(0.05, feedProps.rhoVapKgM3) + (1 - feedQualityX) / feedProps.rhoLiqKgM3)
      : feedProps.rhoLiqKgM3;
  const uFeedTarget = feedQualityX > 0.005 ? clamp(48.0 / Math.sqrt(Math.max(0.5, feedRhoMix)), 1.8, 18.0) : 1.8;
  // 써모사이펀 리보일러 반송(일반 기상분율 x ≈ 0.25) vs 케틀 리보일러 반송(x ≈ 0.92)
  const rebRetQuality = colConfig.reboilerType === 'thermosyphon' ? 0.25 : 0.95;
  const rebRetFlowKgH = colConfig.reboilerType === 'thermosyphon' ? rebVapKgH / 0.25 : rebVapKgH;
  const rebRetRhoMix = 1.0 / (rebRetQuality / Math.max(0.05, botProps.rhoVapKgM3) + (1 - rebRetQuality) / botProps.rhoLiqKgM3);
  const uRebRetTarget = clamp(42.0 / Math.sqrt(Math.max(0.15, rebRetRhoMix)), 4.0, 22.0);

  const n1ElMm = ttlElMm + Math.round(0.25 * rectDiamM * 1000) + 250;
  const n2ElMm = Math.min(ttlElMm - 250, rectTopElMm + 280);
  const n4ElMm = Math.max(btlElMm - Math.round(0.22 * stripDiamM * 1000), btlElMm - 280);
  const n5ElMm = Math.min(stripBotElMm - 180, Math.round((hllElMm + stripBotElMm) * 0.5));
  const n6ElMm = Math.max(btlElMm + 180, Math.round((btlElMm + lllElMm) * 0.65));

  const nozzles: ColumnNozzleSpec[] = [
    buildNozzle(
      'N1',
      '탑정 증기 출구 (Overhead Vapor)',
      'Gas/Vapor',
      ovhdVapKgH,
      topProps.rhoLiqKgM3,
      topProps.rhoVapKgM3,
      topProps.viscLiqCp * 1e-3,
      topProps.viscVapPaS,
      topProps.surfTensMnM * 1e-3,
      uOvhdTarget,
      n1ElMm,
      0
    ),
    buildNozzle(
      'N2',
      internalsKind === 'packed' ? '환류 분배기 인입 (Reflux Distributor)' : '환류액 인입 (Reflux Return)',
      'Liquid',
      refluxKgH,
      topProps.rhoLiqKgM3,
      topProps.rhoVapKgM3,
      topProps.viscLiqCp * 1e-3,
      topProps.viscVapPaS,
      topProps.surfTensMnM * 1e-3,
      1.8,
      n2ElMm,
      90
    ),
    buildNozzle(
      'N3',
      `주 원료 공급단 (Feed @ #${feedStage}단)`,
      feedQualityX > 0.002 ? 'Two-Phase' : 'Liquid',
      totalFeedKgH,
      feedProps.rhoLiqKgM3,
      feedProps.rhoVapKgM3,
      feedProps.viscLiqCp * 1e-3,
      feedProps.viscVapPaS,
      feedProps.surfTensMnM * 1e-3,
      uFeedTarget,
      feedNozzleElMm,
      270,
      feedQualityX > 0.002 ? feedQualityX : 0
    ),
    buildNozzle(
      'N4',
      '탑저 관출액 출구 (Bottoms Draw)',
      'Liquid',
      Math.max(5, botDrawKgH),
      botProps.rhoLiqKgM3,
      botProps.rhoVapKgM3,
      botProps.viscLiqCp * 1e-3,
      botProps.viscVapPaS,
      botProps.surfTensMnM * 1e-3,
      1.5,
      n4ElMm,
      0
    ),
    buildNozzle(
      'N5',
      '리보일러 증기 반송 (Reboiler Return)',
      rebRetQuality < 0.99 ? 'Two-Phase' : 'Gas/Vapor',
      rebRetFlowKgH,
      botProps.rhoLiqKgM3,
      botProps.rhoVapKgM3,
      botProps.viscLiqCp * 1e-3,
      botProps.viscVapPaS,
      botProps.surfTensMnM * 1e-3,
      uRebRetTarget,
      n5ElMm,
      90,
      rebRetQuality
    ),
    buildNozzle(
      'N6',
      '리보일러 액 공급 (Reboiler Supply)',
      'Liquid',
      rebVapKgH * 3.5,
      botProps.rhoLiqKgM3,
      botProps.rhoVapKgM3,
      botProps.viscLiqCp * 1e-3,
      botProps.viscVapPaS,
      botProps.surfTensMnM * 1e-3,
      1.3,
      n6ElMm,
      90
    ),
  ];

  let sideCutSummary: ColumnInternalsSolveResult['sideCutSummary'];
  if (hasSideCut && sideCutNozzleElMm !== undefined) {
    const scPhase: 'L' | 'G' = simResult.sideCutPhase === 'G' ? 'G' : 'L';
    const isGasSc = scPhase === 'G';
    const scMassKgH = Math.max(
      1,
      simResult.sideCutMassKgH ??
        Object.values(simResult.sideCutFlowsKgH ?? {}).reduce((a, b) => a + (b || 0), 0)
    );
    const sideStageObj =
      stages.find((s) => s.stage === sideCutStage) ??
      stages[clamp(sideCutStage - 1, 0, stages.length - 1)] ??
      feedStageObj;
    const scTempC = simResult.sideCutTempC ?? sideStageObj?.tempC ?? feedStageObj?.tempC ?? 80;
    const sideProps = sideStageObj
      ? calcStageMixtureProps({
          ...sideStageObj,
          tempC: scTempC,
        })
      : feedProps;

    nozzles.push(
      buildNozzle(
        'N7',
        isGasSc ? 'Side-Cut Vapor Draw' : 'Side-Cut Liquid Draw (Chimney Sump)',
        isGasSc ? 'Gas/Vapor' : 'Liquid',
        scMassKgH,
        sideProps.rhoLiqKgM3,
        sideProps.rhoVapKgM3,
        sideProps.viscLiqCp * 1e-3,
        sideProps.viscVapPaS,
        sideProps.surfTensMnM * 1e-3,
        isGasSc ? 18.0 : 1.2,
        sideCutNozzleElMm,
        90
      )
    );

    const sOverFPct = Number(
      ((simResult.actualSOverFMass ?? scMassKgH / Math.max(1e-3, totalFeedKgH)) * 100.0).toFixed(1)
    );
    sideCutSummary = {
      stage: sideCutStage,
      phase: scPhase,
      massKgH: Number(scMassKgH.toFixed(1)),
      tempC: Number(scTempC.toFixed(1)),
      nozzleTag: 'N7',
      elevationMm: sideCutNozzleElMm,
      sOverFPct,
    };
  }

  const mhRating = defaultFlangeRating.replace(' RFWN', ' RF');
  const mhSize = governingDiamM >= 1.2 ? 'DN500 (20")' : 'DN450 (18")';
  const manholes: ColumnManholeSpec[] = [
    {
      tag: 'M1',
      sizeDn: mhSize,
      flangeRating: mhRating,
      service: '상부 정류부 / 미스트제거기 점검 맨홀 (Top Manway)',
      elevationMm: Math.round((rectTopElMm + ttlElMm) * 0.5),
      elevationFromBtlMm: Math.round((rectTopElMm + ttlElMm) * 0.5) - btlElMm,
      orientationDeg: 180,
    },
    {
      tag: 'M2',
      sizeDn: mhSize,
      flangeRating: mhRating,
      service: internalsKind === 'packed' ? '중간 재분배기·피드존 맨홀 (Inter-Bed Manway)' : '피드존 점검 맨홀 (Feed Zone Manway)',
      elevationMm: feedNozzleElMm,
      elevationFromBtlMm: feedNozzleElMm - btlElMm,
      orientationDeg: 180,
    },
    {
      tag: 'M3',
      sizeDn: mhSize,
      flangeRating: mhRating,
      service: '탑저 섬프 점검 맨홀 (Bottom Sump Manway)',
      elevationMm: Math.min(stripBotElMm - 250, hllElMm + 350),
      elevationFromBtlMm: Math.min(stripBotElMm - 250, hllElMm + 350) - btlElMm,
      orientationDeg: 180,
    },
  ];

  // 7단계: ASME Sec. VIII Div.1 통합 기계설계 (내압 · 외압/진공보강링 · ASCE 7 풍하중/지진 · 스커트/앵커볼트 · UG-37 노즐보강)
  const internalsMassTon =
    internalsKind === 'tray'
      ? (rectTrays * rectTrayGeom.areaTotalM2 + stripTrays * stripTrayGeom.areaTotalM2) * 0.068
      : (rectHeightM * rectTrayGeom.areaTotalM2 + stripHeightM * stripTrayGeom.areaTotalM2) *
        (packingSpec.key === 'ceramic_intalox_38' ? 0.62 : 0.24);
  const internalsWeightKN = internalsMassTon * G_ACC;

  const packedLiqVolM3 =
    internalsKind === 'packed'
      ? rectHeightM * rectTrayGeom.areaTotalM2 * avgOf(rectRows, (r) => r.liquidHoldupFrac, 0.05) +
        stripHeightM * stripTrayGeom.areaTotalM2 * avgOf(stripRows, (r) => r.liquidHoldupFrac, 0.06)
      : (rectTrays * rectTrayGeom.areaActiveM2 + stripTrays * stripTrayGeom.areaActiveM2) * 0.045;
  const operatingLiquidKN = ((sumpLiqVolM3 + packedLiqVolM3) * botProps.rhoLiqKgM3 * G_ACC) / 1000.0;

  const designPressMpaG = designPressBarG * 0.1;
  const designTempC = Math.max(50, Math.max(simResult.topTempC, simResult.bottomTempC) + 25);
  const corrAllowanceMm =
    matInfo.code === 'CS_A516_70' ? 3.0 : matInfo.code === 'PTFE_LINED_CS' ? 2.0 : 1.5;

  const nozzleInputs = nozzles.map((nz) => {
    const m = STANDARD_PIPE_NOZZLES.find((p) => p.label === nz.selectedDn);
    return { tag: nz.nozzleTag, idMm: m?.idMm ?? nz.calcIdMm };
  });

  let mechanical = designTowerMechanical({
    innerDiamM: governingDiamM,
    tangentHeightM: tangentToTangentHeightM,
    designPressMpaG,
    externalPressMpa: vacuumStiffenerRequired ? 0.1013 : 0,
    designTempC,
    material: mapToMechMaterial(matInfo.code),
    corrosionAllowanceMm: corrAllowanceMm,
    jointEfficiency: 0.85,
    skirtHeightM,
    internalsWeightKN,
    operatingLiquidKN,
    windSpeedMS: ic.windSpeedMS ?? 38,
    exposure: ic.windExposure ?? 'C',
    sds: ic.seismicSds ?? 0.5,
    nozzles: nozzleInputs,
  });

  // 대구경 진공탑에서 무보강 두꺼운 동체 대신 경제적 보강링 간격(3.0~4.0 m) 자동 적용
  if (vacuumStiffenerRequired && mechanical.stiffenerCount === 0 && mechanical.shellExternalReqMm > 14) {
    mechanical = designTowerMechanical({
      innerDiamM: governingDiamM,
      tangentHeightM: tangentToTangentHeightM,
      designPressMpaG,
      externalPressMpa: 0.1013,
      designTempC,
      material: mapToMechMaterial(matInfo.code),
      corrosionAllowanceMm: corrAllowanceMm,
      jointEfficiency: 0.85,
      skirtHeightM,
      internalsWeightKN,
      operatingLiquidKN,
      windSpeedMS: ic.windSpeedMS ?? 38,
      exposure: ic.windExposure ?? 'C',
      sds: ic.seismicSds ?? 0.5,
      stiffenerSpacingM: Number(clamp(1.5 * governingDiamM, 2.8, 4.2).toFixed(2)),
      nozzles: nozzleInputs,
    });
  }

  const shellWallThicknessMm = mechanical.selectedShellMm;
  const estimatedDryWeightTon = Number((mechanical.emptyWeightKN / G_ACC).toFixed(1));

  // 8단계: 응축기·리보일러·환류드럼 개념 사이징 + Turton/Guthrie 장치원가 산출
  const qCondKw = Math.abs(simResult.condenserDutyKcalH) / 860.0;
  const qRebKw = Math.abs(simResult.reboilerDutyKcalH) / 860.0;
  const condenserEstAreaM2 = Number(Math.max(2.0, (qCondKw * 1000.0) / (620.0 * 18.0)).toFixed(1));
  const reboilerEstAreaM2 = Number(Math.max(2.0, (qRebKw * 1000.0) / (780.0 * 22.0)).toFixed(1));

  const drumLiqFlowM3H = (distKgH + refluxKgH) / Math.max(500, topProps.rhoLiqKgM3);
  const drumTotalVolM3 = Math.max(0.25, (drumLiqFlowM3H * (5.0 / 60.0)) / 0.50);
  const drumD = clamp(Math.cbrt((4.0 * drumTotalVolM3) / (3.0 * Math.PI)), 0.50, 3.20);
  const refluxDrumDiamM = Number((Math.ceil(drumD * 10) / 10).toFixed(2));
  const refluxDrumLengthM = Number((refluxDrumDiamM * 3.0).toFixed(2));

  const costMat = mapToCostMaterial(matInfo.code);
  const avgTrayDiamM =
    rectTrays + stripTrays > 0
      ? Math.sqrt(
          (rectTrays * rectDiamM * rectDiamM + stripTrays * stripDiamM * stripDiamM) /
            Math.max(1, rectTrays + stripTrays)
        )
      : governingDiamM;
  const totalPackVolM3 = rectHeightM * rectTrayGeom.areaTotalM2 + stripHeightM * stripTrayGeom.areaTotalM2;

  const costEstimate = costColumnVessel({
    cepci: ic.cepci ?? 800,
    fxKrwPerUsd: ic.fxKrwPerUsd ?? 1380,
    innerDiamM: governingDiamM,
    tangentHeightM: tangentToTangentHeightM,
    skirtHeightM,
    designPressBarG,
    isVacuum: vacuumStiffenerRequired,
    shellMaterial: costMat,
    internalsMaterial: costMat,
    shellThicknessMm: mechanical.selectedShellMm,
    headThicknessMm: mechanical.selectedHeadMm,
    skirtThicknessMm: mechanical.skirtThicknessMm,
    stiffenerCount: mechanical.stiffenerCount,
    vesselShellHeadsMassKg: ((mechanical.shellWeightKN + mechanical.headsWeightKN) * 1000) / G_ACC,
    skirtMassKg: (mechanical.skirtWeightKN * 1000) / G_ACC,
    internalsKind,
    trayCount: rectTrays + stripTrays,
    trayType,
    trayDiamM: avgTrayDiamM,
    packingVolumeM3: totalPackVolM3,
    packingCategory: mapPackingCostCategory(packingSpec.key),
    packedBedCount,
  });

  const condenserCost = costHeatExchanger({
    cepci: ic.cepci ?? 800,
    fxKrwPerUsd: ic.fxKrwPerUsd ?? 1380,
    areaM2: condenserEstAreaM2,
    hxType: 'fixed_tube',
    designPressBarG,
    shellMaterial: 'CS',
    tubeMaterial: costMat,
  });
  const reboilerCost = costHeatExchanger({
    cepci: ic.cepci ?? 800,
    fxKrwPerUsd: ic.fxKrwPerUsd ?? 1380,
    areaM2: reboilerEstAreaM2,
    hxType: colConfig.reboilerType === 'kettle' ? 'kettle_reboiler' : 'u_tube',
    designPressBarG: Math.max(designPressBarG, 8.0),
    shellMaterial: costMat,
    tubeMaterial: costMat,
  });

  // 9단계: 총 압력손실, 턴다운비 및 엔지니어링 경고 생성
  const totalInternalsDpMbar = Number((rectDpMbar + stripDpMbar).toFixed(1));
  const totalInternalsDpKgcm2 = Number((totalInternalsDpMbar / 980.665).toFixed(4));
  const avgStageDpKgcm2 = Number((totalInternalsDpKgcm2 / Math.max(1, N - 1)).toFixed(5));
  const avgChanFairEffPct = Number(
    (stageRows.length > 0 ? sumChanFairPct / stageRows.length : 75.0).toFixed(1)
  );
  const avgOconnellEffPct = Number(
    (stageRows.length > 0 ? sumOconnellPct / stageRows.length : 72.0).toFixed(1)
  );
  const predictedOverallEffPct = avgChanFairEffPct;
  const avgPackedHoldupPct = Number((avgOf(stageRows, (r) => r.liquidHoldupFrac, 0) * 100).toFixed(2));
  const avgPackedHogM = Number(avgOf(stageRows, (r) => r.hogM, 0).toFixed(3));

  const minTurndownRatio = Number(
    clamp(
      internalsKind === 'packed'
        ? Math.max(1.2, minWeepSafety * 1.15)
        : trayType === 'bubble_cap'
        ? Math.max(2.5, minWeepSafety * 1.6)
        : trayType === 'valve'
        ? Math.max(1.5, minWeepSafety * 1.25)
        : Math.max(1.05, minWeepSafety),
      0.8,
      8.0
    ).toFixed(2)
  );
  const operatingLoadMinPct = Math.round(clamp(100.0 / Math.max(1.05, minTurndownRatio), 18, 95));
  const operatingLoadMaxPct = Math.round(clamp(100.0 * (85.0 / Math.max(25.0, maxFloodPct)), 70, 220));

  const designWarnings: string[] = [];
  if (maxFloodPct > 85) {
    designWarnings.push(
      `제${maxFloodStage}단 최대 범람율이 ${maxFloodPct.toFixed(1)}%로 설계 상한(85%)을 초과합니다. 내경 확대 또는 단간격 상향이 필요합니다.`
    );
  }
  if (internalsKind === 'tray' && maxDcChokeFloodPct > 82) {
    designWarnings.push(
      `다운코머 입구 초크 범람율이 최대 ${maxDcChokeFloodPct.toFixed(1)}%에 달합니다. 다운코머 면적비(Ad/AT) 상향 또는 다중 패스(2/4-Pass) 전환을 권장합니다.`
    );
  }
  if (internalsKind === 'tray' && minDcResidenceTimeSec > 0 && minDcResidenceTimeSec < 3.5) {
    designWarnings.push(
      `최소 다운코머 체류시간이 ${minDcResidenceTimeSec.toFixed(2)}s로 기액 분리 권장 기준(3.5~5.0s) 미만입니다.`
    );
  }
  if (internalsKind === 'tray' && stageRows.some((r) => r.weepRatio < 1.0)) {
    designWarnings.push(
      `일부 단에서 Lockett 위핑(Weeping) 임계 유속 미달이 감지되었습니다. 부상식 밸브 트레이 전환 또는 천공 개구율(Ah/Aa) 축소를 권장합니다.`
    );
  }
  if (internalsKind === 'tray' && Math.abs(reqRectDiamM - reqStripDiamM) / Math.max(0.5, overallReqDiam) > 0.28 && shellSectionMode === 'uniform') {
    designWarnings.push(
      `정류부(${reqRectDiamM.toFixed(2)}m)와 스트리핑부(${reqStripDiamM.toFixed(2)}m) 필요 직경 편차가 28% 이상입니다. [이단 직경(Swaged)] 적용 시 투자비를 절감할 수 있습니다.`
    );
  }
  if (vacuumStiffenerRequired && internalsKind === 'tray' && totalInternalsDpMbar > 90) {
    designWarnings.push(
      `진공 운전 탑에서 트레이 총 압력손실(${totalInternalsDpMbar.toFixed(0)} mbar)이 커서 탑저 비등온도가 상승합니다. 규칙 충진물(250Y) 전환을 검토하세요.`
    );
  }
  if (lengthToDiamRatio > 24) {
    designWarnings.push(
      `탑 세장비(L/D = ${lengthToDiamRatio})가 24를 초과하여 풍하중·지진 모멘트 보강이 필요합니다.`
    );
  }
  for (const mw of mechanical.warnings) {
    designWarnings.push(`[ASME 기계] ${mw}`);
  }

  const hasCritical = stageRows.some((r) => r.status === 'flooding' || r.status === 'weeping');
  const overallStatus: ColumnInternalsSolveResult['overallStatus'] = hasCritical
    ? 'critical'
    : designWarnings.length > 0
    ? 'warning'
    : 'ok';

  return {
    internalsKind,
    shellSectionMode,
    trayType,
    trayTypeLabel,
    traySpacingMm,
    packingSpec,
    rectifying,
    stripping,
    governingDiamM: Number(governingDiamM.toFixed(2)),
    maxFloodPct: Number(maxFloodPct.toFixed(1)),
    maxJetFloodPct: Number(maxJetFloodPct.toFixed(1)),
    maxDcChokeFloodPct: Number(maxDcChokeFloodPct.toFixed(1)),
    minDcResidenceTimeSec: Number(minDcResidenceTimeSec.toFixed(2)),
    maxFloodStage,
    minTurndownRatio,
    operatingLoadMinPct,
    operatingLoadMaxPct,
    totalInternalsDpMbar,
    totalInternalsDpKgcm2,
    avgStageDpKgcm2,
    predictedOverallEffPct,
    avgChanFairEffPct,
    avgOconnellEffPct,
    avgPackedHoldupPct,
    avgPackedHogM,
    distributorDripPointsPerM2: dripPtsPerM2,
    distributorTotalDripPoints: rectDripTotal + stripDripTotal,
    actualTotalTrays: rectTrays + stripTrays,
    packedBedCount,
    totalPackedHeightM: Number((rectHeightM + stripHeightM).toFixed(2)),
    packedBeds,
    packingHardware,
    sumpResidenceMin: sumpResMin,
    topDisengageHeightM,
    feedFlashZoneHeightM,
    sumpLiquidHeightM: Number(sumpLiquidHeightM.toFixed(2)),
    sumpTotalHeightM,
    tangentToTangentHeightM,
    skirtHeightM,
    totalElevationM,
    elevations,
    lengthToDiamRatio,
    recommendedMaterialCode: matInfo.code,
    recommendedMaterialLabel: matInfo.label,
    materialReason: matInfo.reason,
    designPressBarG: Number(designPressBarG.toFixed(2)),
    designTempC: Number(designTempC.toFixed(1)),
    shellWallThicknessMm,
    vacuumStiffenerRequired,
    estimatedDryWeightTon,
    mechanical,
    costEstimate,
    nozzles,
    manholes,
    ...(sideCutSummary ? { sideCutSummary } : {}),
    auxiliaries: {
      condenserDutyKw: Number(qCondKw.toFixed(1)),
      condenserEstAreaM2,
      reboilerDutyKw: Number(qRebKw.toFixed(1)),
      reboilerEstAreaM2,
      refluxDrumDiamM,
      refluxDrumLengthM,
      refluxDrumHoldupM3: Number(drumTotalVolM3.toFixed(2)),
      condenserCost,
      reboilerCost,
    },
    stageRows,
    designWarnings,
    overallStatus,
  };
}

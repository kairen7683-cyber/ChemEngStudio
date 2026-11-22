// ============================================================================
// 플로우시트 내장형 열교환기 · 응축기 · 액화기 개념/상세 설계 엔진
// (Embedded Heat Exchanger, Condenser & Liquefier Thermal-Hydraulic Design)
// - 플로우시트 빌더 및 Plant 02 / Plant 03 실시간 스트림(유량·온도·압력·상변화·조성) 자동 연동
// - TEMA 다관원통형 (BEM / AES / BKM / BEU) Bell-Delaware 수력학 · 진동(FIV) · 노즐 사이징
// - 판형 열교환기 (Chevron PHE) Kumar 상관식 채널 유속 · 압력손실 · 판수 산출
// - 3-Zone 상변화(과열제거 · 잠열응축/비등 · 과냉각) T-Q 온도 프로파일 & 핀치(Pinch) 진단
// - 염소(습/건조 발화 인터록) · 염산 · 가성소다 · ECH/DCH 공정별 재질 적합성 자동 검증
// ============================================================================

import {
  COMP_META,
  REFRIGERANT_PRESETS,
  SIM_COMPS,
  type FlowUnitParams,
  type FlowUnitType,
  type RefrigerantPresetKey,
  type SimCompKey,
  type SolvedStream,
  type SolvedUnitResult,
} from './flowsheetSolver';
import {
  bellDelawareShellSide,
  defaultPassLaneWidthM,
  kernShellSide,
  tubeSideSinglePhase,
  shahCondensationH,
  gungorWintertonBoilingH,
  shellCondensationH,
  shellBoilingH,
  silverBellGhalyCondensationH,
  integratedPhaseChangeH,
  zuberPalenSmallChfWm2,
  checkTemaImpingement,
  tubeSideTwoPhaseDP,
  shellSideTwoPhaseDP,
  temaVibrationCheck,
  type BellDelawareResult,
  type ChfCheckResult,
  type FluidState,
  type LayoutDeg,
  type ShellTubeGeometry,
  type TwoPhaseFluid,
  type VibrationResult,
} from './shellTubeRating';

export type HxEquipmentKind = 'shell_tube' | 'plate_phe';
export type TemaConfiguration = 'BEM' | 'AES' | 'BKM' | 'BEU';
export type HxTubeAllocation = 'process_tube' | 'process_shell';
export type TubeLayoutAngle = 30 | 45 | 90;

export type HxMaterialCode =
  | 'CS_A179'
  | 'LTCS_A334'
  | 'SS316L'
  | 'DUPLEX_2205'
  | 'TI_GR2'
  | 'NI_200'
  | 'HASTELLOY_C276'
  | 'IMPERVIOUS_GRAPHITE';

export interface HxMaterialSpec {
  code: HxMaterialCode;
  label: string;
  shortLabel: string;
  kwWmK: number; // 벽면 열전도도 W/(m·K)
  serviceNote: string;
}

export const HX_MATERIAL_CATALOG: Record<HxMaterialCode, HxMaterialSpec> = {
  CS_A179: {
    code: 'CS_A179',
    label: '탄소강 (Carbon Steel, SA-179 / SA-516-70)',
    shortLabel: 'CS (SA-179)',
    kwWmK: 48.5,
    serviceNote: '일반 냉각수 · 스팀 · 비부식성 유기물 상온 운전',
  },
  LTCS_A334: {
    code: 'LTCS_A334',
    label: '저온탄소강 (LTCS, SA-334 Gr.6 / SA-516-60N)',
    shortLabel: 'LTCS (-45°C)',
    kwWmK: 46.0,
    serviceNote: '수분 50 ppm 미만 건조 염소(Dry Cl₂) · 무수염산 심냉 액화기(-20~-40°C) 표준',
  },
  SS316L: {
    code: 'SS316L',
    label: '스테인리스강 (SS 316L, SA-213 TP316L)',
    shortLabel: 'SS 316L',
    kwWmK: 16.3,
    serviceNote: 'ECH · DCP · 글리세린 정제 응축기, 수소 냉각기, 저온 희박 가성소다',
  },
  DUPLEX_2205: {
    code: 'DUPLEX_2205',
    label: '듀플렉스 스텐레스 (Duplex S32205)',
    shortLabel: 'Duplex 2205',
    kwWmK: 19.0,
    serviceNote: '염화물 응력부식균열(Cl-SCC) 저항 · 유기염소(DCH/MCH) 공정 냉각기',
  },
  TI_GR2: {
    code: 'TI_GR2',
    label: '순티타늄 (Titanium Gr.2, SB-338 Gr.2)',
    shortLabel: 'Titanium Gr.2',
    kwWmK: 21.9,
    serviceNote: '습염소 가스(Wet Cl₂) 냉각기 · 포화/탈염소 브라인 · 차아염소산 표준 (건조염소 절대 금지!)',
  },
  NI_200: {
    code: 'NI_200',
    label: '순니켈 (Nickel 200, SB-163 UNS N02200)',
    shortLabel: 'Nickel 200',
    kwWmK: 70.2,
    serviceNote: '고온·고농도(32~50 wt%) 가성소다(NaOH) 냉각·가열기 가성취성 방지 표준',
  },
  HASTELLOY_C276: {
    code: 'HASTELLOY_C276',
    label: '하스텔로이 (Hastelloy C-276, UNS N10276)',
    shortLabel: 'Hastelloy C-276',
    kwWmK: 10.8,
    serviceNote: '고온 염산(HCl) · DCH/글리세린 염소화 반응 열교환 · 염화철 부식 환경',
  },
  IMPERVIOUS_GRAPHITE: {
    code: 'IMPERVIOUS_GRAPHITE',
    label: '불침투성 흑연 (Impervious Graphite / Karbate)',
    shortLabel: '흑연 (Graphite)',
    kwWmK: 115.0,
    serviceNote: '폐염산 농축·공비증류 리보일러 및 고농도 염산 흡수 냉각기 초내식·고전열 표준',
  },
};

export interface HxDesignParams {
  hxKind?: HxEquipmentKind;
  temaType?: TemaConfiguration;
  allocation?: HxTubeAllocation;
  material?: HxMaterialCode;
  shellCount?: number; // 직렬 동체 수 (1~4)
  tubePasses?: 1 | 2 | 4 | 6;
  tubeOdMm?: 15.88 | 19.05 | 25.4;
  tubeWallMm?: 1.24 | 1.65 | 2.11;
  tubeLengthM?: 2.44 | 3.05 | 3.66 | 4.88 | 6.1;
  pitchAngle?: TubeLayoutAngle;
  baffleCutPct?: number; // 15 ~ 45 %
  baffleSpacingRatio?: number; // B / Ds (0.22 ~ 0.95)
  designMarginPct?: number; // 여유율 % (기본 15%)
  foulingProcM2HKcal?: number; // 공정측 오염계수 (m²·h·°C/kcal)
  foulingUtilM2HKcal?: number; // 유틸리티측 오염계수 (m²·h·°C/kcal)

  // 판형 열교환기(PHE) 전용 파라미터
  pheChevronDeg?: 30 | 45 | 60;
  pheGapMm?: number; // 판간격 b (2.5 ~ 5.0 mm)
  phePlateWidthM?: number; // 유효 판폭 W (0.3 ~ 1.2 m)
  phePlateLengthM?: number; // 유효 판길이 L (0.8 ~ 2.6 m)
  phePlateThickMm?: 0.5 | 0.6 | 0.8;

  // ── 정격(Rating) 모드 & Bell–Delaware 상세 기하 (선택) ──
  /** 'design' (기본): 요구면적으로 기하 산출 / 'rating': 주어진 기하로 성능·여유율·ΔP 평가 */
  designMode?: 'design' | 'rating';
  ratingShellIdMm?: number;
  ratingTubeCount?: number; // 동체당 튜브 수
  ratingTubeLengthM?: number;
  ratingBaffleSpacingMm?: number;
  inletBaffleSpacingMm?: number;
  outletBaffleSpacingMm?: number;
  sealingStripPairs?: number;
  shellBaffleClearanceMm?: number; // 직경 기준 (TEMA 기본값 자동)
  tubeBaffleClearanceMm?: number; // 직경 기준 (TEMA 기본값 자동)
}

export interface HxSideFluidSummary {
  roleLabel: string;
  fluidName: string;
  phaseRegime: 'sensible_liq' | 'sensible_gas' | 'condensing' | 'boiling';
  phaseLabel: string;
  massFlowKgH: number;
  inTempC: number;
  outTempC: number;
  pressKgcm2g: number;
  densityKgM3: number;
  cpKcalKgC: number;
  viscosityCp: number;
  conductivityWmK: number;
  latentHeatKcalKg: number;
  phaseChangeMassKgH: number;
  nonCondensableMolFrac: number;
  foulingM2HKcal: number;
  /** 상변화 측 상별 물성 (선택; 미지정 시 추정) */
  rhoLiqKgM3?: number;
  rhoVapKgM3?: number;
  muVapCp?: number;
  sigmaNm?: number;
}

export interface HxTQPoint {
  fracQ: number; // 0 ~ 1
  cumDutyMcalH: number;
  hotTempC: number;
  coldTempC: number;
  deltaTC: number;
  zoneLabel: string;
}

export interface HxNozzleSpec {
  id: string;
  service: string;
  side: 'Shell' | 'Tube';
  dnMm: number;
  npsInch: string;
  velocityMs: number;
  rhoV2Pa: number;
  impingementRequired?: boolean;
  rhoV2LimitPa?: number;
  rhoV2Status?: 'OK' | 'IMPINGEMENT_REQ' | 'OVERSIZE_NOZZLE';
}

export interface HxDiagnosticItem {
  level: 'ok' | 'warning' | 'error';
  code: string;
  message: string;
  remedyLabel?: string;
  remedyPatch?: Partial<HxDesignParams>;
}

export interface HxDesignSolveResult {
  valid: boolean;
  hxKind: HxEquipmentKind;
  temaType: TemaConfiguration;
  allocation: HxTubeAllocation;
  material: HxMaterialSpec;
  recommendedMaterial: HxMaterialCode;

  // 열수지 및 온도 추진력
  dutyKcalH: number;
  dutyMcalH: number;
  dutyKW: number;
  usrt: number;
  isHeatingProcess: boolean; // true: 스팀 등으로 공정 가열, false: 냉각/응축/액화
  processSide: HxSideFluidSummary;
  utilitySide: HxSideFluidSummary;
  hotSide: HxSideFluidSummary;
  coldSide: HxSideFluidSummary;

  dewPointC: number | null;
  desupDutyMcalH: number;
  latentDutyMcalH: number;
  subcoolDutyMcalH: number;

  lmtdCounterC: number;
  ftFactor: number;
  cmtdC: number;
  minPinchDeltaTC: number;
  tqProfile: HxTQPoint[];

  // 총괄 열전달계수 & 전열면적
  hTubeWm2K: number;
  hShellWm2K: number;
  uCleanWm2K: number;
  uCalcWm2K: number;
  uCalcKcalM2HC: number; // 플로우시트 역반영용 단위 (kcal/m²·h·°C)
  areaReqM2: number;
  areaProvM2: number;
  actualOverdesignPct: number;

  // 기하 치수 (Shell & Tube 또는 PHE 공통 요약)
  shellCount: number;
  tubePasses: number;
  tubeCountPerShell: number;
  tubeOdMm: number;
  tubeIdMm: number;
  tubeLengthM: number;
  tubePitchMm: number;
  pitchAngle: TubeLayoutAngle;
  bundleDiaMm: number;
  shellIdMm: number;
  baffleCutPct: number;
  baffleSpacingMm: number;
  baffleCount: number;

  // PHE 기하 치수
  phePlateCount: number;
  pheChannelsPerSide: number;
  pheChevronDeg: number;
  pheGapMm: number;
  phePackLengthMm: number;
  phePlateWidthMm: number;
  phePlateHeightMm: number;

  // 유속 · 압력손실 · 진동 검증
  velTubeMs: number;
  velShellMs: number;
  reTube: number;
  reShell: number;
  dpTubeBar: number;
  dpShellBar: number;
  dpProcessKgcm2: number;
  dpUtilityKgcm2: number;
  vortexFreqHz: number;
  naturalFreqHz: number;
  vibRatio: number;

  nozzles: HxNozzleSpec[];
  diagnostics: HxDiagnosticItem[];
  overallStatus: 'ok' | 'warning' | 'error';

  // ── 상세 정격 결과 (Shell & Tube, 선택) ──
  designMode?: 'design' | 'rating';
  shellMethodLabel?: string;
  tubeMethodLabel?: string;
  bellDelaware?: BellDelawareResult;
  kernCheck?: { hWm2K: number; dpBar: number; re: number };
  vibration?: VibrationResult;
  zoneRating?: HxZoneRatingRow[];
  dutyCapabilityKW?: number;
  tubeDpBreakdown?: { frictionBar: number; accelerationBar: number; returnBar: number; model: string };
  shellDpBreakdown?: { crossBar: number; windowBar: number; endBar: number; twoPhaseMultiplier?: number };
  chfCheck?: ChfCheckResult;
  impingementRequired?: boolean;
  rhoV2LimitPa?: number;
  rhoV2Status?: 'OK' | 'IMPINGEMENT_REQ' | 'OVERSIZE_NOZZLE';
}

export interface HxZoneRatingRow {
  zone: string;
  dutyKW: number;
  dtC: number;
  hTubeWm2K: number;
  hShellWm2K: number;
  uWm2K: number;
  areaM2: number;
}

const KCAL_TO_KW = 1 / 859.845;
const WM2K_TO_KCAL = 0.859845;

const STD_PIPE_SIZES: { dn: number; nps: string; idMm: number }[] = [
  { dn: 25, nps: '1"', idMm: 26.6 },
  { dn: 40, nps: '1-1/2"', idMm: 40.9 },
  { dn: 50, nps: '2"', idMm: 52.5 },
  { dn: 80, nps: '3"', idMm: 77.9 },
  { dn: 100, nps: '4"', idMm: 102.3 },
  { dn: 150, nps: '6"', idMm: 154.1 },
  { dn: 200, nps: '8"', idMm: 202.7 },
  { dn: 250, nps: '10"', idMm: 254.5 },
  { dn: 300, nps: '12"', idMm: 303.2 },
  { dn: 350, nps: '14"', idMm: 333.4 },
  { dn: 400, nps: '16"', idMm: 381.0 },
  { dn: 500, nps: '20"', idMm: 477.8 },
];

function sizeNozzle(
  id: string,
  service: string,
  side: 'Shell' | 'Tube',
  massKgH: number,
  rhoKgM3: number,
  isGasOrTwoPhase: boolean,
  isTwoPhaseOrCorrosive = false
): HxNozzleSpec {
  const mDot = Math.max(0.01, massKgH / 3600);
  const rho = Math.max(0.25, rhoKgM3);
  const qM3S = mDot / rho;
  // 권장 노즐 유속: 액상 ~ 1.8 m/s, 기상/2상 ~ min(22 m/s, sqrt(2200/rho))
  const vTarget = isGasOrTwoPhase ? Math.min(22, Math.max(8, Math.sqrt(2000 / rho))) : 1.85;
  const areaTarget = qM3S / vTarget;
  const dTargetMm = Math.sqrt((4 * areaTarget) / Math.PI) * 1000;

  let chosen = STD_PIPE_SIZES[STD_PIPE_SIZES.length - 1];
  for (const cand of STD_PIPE_SIZES) {
    if (cand.idMm >= dTargetMm) {
      chosen = cand;
      break;
    }
  }
  const actualArea = (Math.PI * Math.pow(chosen.idMm / 1000, 2)) / 4;
  const vel = qM3S / Math.max(1e-6, actualArea);
  const imp = checkTemaImpingement(rho, vel, isTwoPhaseOrCorrosive);
  return {
    id,
    service,
    side,
    dnMm: chosen.dn,
    npsInch: chosen.nps,
    velocityMs: Number(vel.toFixed(2)),
    rhoV2Pa: Math.round(imp.rhoV2Pa),
    impingementRequired: imp.impingementRequired,
    rhoV2LimitPa: imp.limitPa,
    rhoV2Status: imp.status,
  };
}

function calcSafeLmtd(dt1: number, dt2: number): number {
  const a = Math.max(0.35, dt1);
  const b = Math.max(0.35, dt2);
  if (Math.abs(a - b) < 0.05) return 0.5 * (a + b);
  return (a - b) / Math.log(a / b);
}

/**
 * 다관원통형 TEMA Ft 온도 보정계수 (N 직렬 동체, 짝수 튜브 패스)
 */
function calcTemaFt(
  ThIn: number,
  ThOut: number,
  TcIn: number,
  TcOut: number,
  nShells: number,
  nTubePasses: number,
  temaType: TemaConfiguration,
  hasIsothermalPhaseChange: boolean
): number {
  if (nTubePasses === 1 || temaType === 'BKM' || hasIsothermalPhaseChange) {
    return 1.0;
  }
  const dTc = Math.abs(TcOut - TcIn);
  const dTh = Math.abs(ThIn - ThOut);
  const denomP = Math.abs(ThIn - TcIn);
  if (dTc < 0.2 || dTh < 0.2 || denomP < 0.5) return 0.99;

  const R = dTh / dTc;
  const P0 = dTc / denomP;
  if (P0 <= 0.01) return 1.0;
  if (P0 >= 0.995) return 0.55;

  // N개 직렬 쉘 보정 P_1
  let P = P0;
  const N = Math.max(1, Math.round(nShells));
  if (N > 1) {
    if (Math.abs(R - 1) < 1e-3) {
      P = P0 / (N - P0 * (N - 1));
    } else {
      const ratio = Math.max(0.001, (1 - P0 * R) / Math.max(0.001, 1 - P0));
      const root = Math.pow(ratio, 1 / N);
      P = (root - 1) / Math.max(1e-4, root - R);
    }
  }
  P = Math.max(0.01, Math.min(0.98, P));

  const sqrtTerm = Math.sqrt(R * R + 1);
  if (Math.abs(R - 1) < 1e-3) {
    const num = (P * sqrtTerm) / Math.max(0.02, 1 - P);
    const denBody = (2 / P - 1 - sqrtTerm) / Math.max(0.01, 2 / P - 1 + sqrtTerm);
    if (denBody <= 0.01) return 0.55;
    return Math.max(0.5, Math.min(1.0, num / Math.log(1 / denBody)));
  }

  const numBody = (1 - P) / Math.max(0.01, 1 - P * R);
  const denA = 2 / P - 1 - R + sqrtTerm;
  const denB = 2 / P - 1 - R - sqrtTerm;
  if (numBody <= 0.01 || denB <= 0.01 || denA / denB <= 1.0001) return 0.55;
  const ft = (sqrtTerm * Math.log(1 / numBody)) / ((R - 1) * Math.log(denA / denB));
  return Number.isFinite(ft) ? Math.max(0.5, Math.min(1.0, ft)) : 0.85;
}

/**
 * 공정 스트림 조성으로부터 권장 재질 및 부식·안전 특성 판별
 */
export function recommendHxMaterial(
  flows: Record<SimCompKey, number>,
  minTempC: number,
  maxTempC: number
): {
  recommended: HxMaterialCode;
  isWetCl2: boolean;
  isDryCl2: boolean;
  isStrongHcl: boolean;
  isHotCaustic: boolean;
  moistureWtPpm: number;
} {
  const totalMass = SIM_COMPS.reduce((s, k) => s + (flows[k] || 0), 0);
  if (totalMass <= 1e-6) {
    return {
      recommended: 'SS316L',
      isWetCl2: false,
      isDryCl2: false,
      isStrongHcl: false,
      isHotCaustic: false,
      moistureWtPpm: 0,
    };
  }
  const w = (k: SimCompKey) => ((flows[k] || 0) / totalMass) * 100;
  const moistureWtPpm = ((flows.H2O || 0) / totalMass) * 1_000_000;

  const cl2Pct = w('Cl2');
  const hclPct = w('HCl');
  const naohPct = w('NaOH');
  const naclPct = w('NaCl');
  const fePct = w('FeCl2') + w('FeCl3');
  const orgChloroPct = w('ECH') + w('DCH') + w('MCH') + w('DCP');

  const isDryCl2 = cl2Pct > 15 && moistureWtPpm < 4000; // H2O < 0.4 wt% 건조염소 (Ti 발화 영역!)
  const isWetCl2 = cl2Pct > 5 && !isDryCl2;
  const isStrongHcl = hclPct > 1.5 || fePct > 2.0;
  const isHotCaustic = naohPct > 15 && maxTempC > 58;

  let recommended: HxMaterialCode = 'SS316L';
  if (isDryCl2) {
    recommended = minTempC < -10 ? 'LTCS_A334' : 'CS_A179';
  } else if (isWetCl2 || w('NaOCl') > 1.0 || (naclPct > 8 && cl2Pct > 0.01)) {
    recommended = 'TI_GR2';
  } else if (isStrongHcl) {
    // 무수염산 심냉 액화기(수분 < 100 ppm)는 LTCS/Hastelloy, 습식 염산은 불침투성 흑연 또는 Hastelloy C-276
    if (hclPct > 95 && moistureWtPpm < 200 && minTempC < -5) {
      recommended = 'LTCS_A334';
    } else {
      recommended = maxTempC > 135 ? 'HASTELLOY_C276' : 'IMPERVIOUS_GRAPHITE';
    }
  } else if (isHotCaustic) {
    recommended = 'NI_200';
  } else if (naclPct > 10) {
    recommended = 'TI_GR2';
  } else if (orgChloroPct > 10) {
    recommended = w('HCl') > 0.2 ? 'HASTELLOY_C276' : 'SS316L';
  }

  return {
    recommended,
    isWetCl2,
    isDryCl2,
    isStrongHcl,
    isHotCaustic,
    moistureWtPpm,
  };
}

/**
 * 공정측 물성 및 상변화 추정
 */
function buildProcessSideSummary(
  unitType: FlowUnitType,
  procInStreams: SolvedStream[],
  procOutStreams: SolvedStream[],
  unitRes: SolvedUnitResult | undefined,
  params: FlowUnitParams,
  hxCfg: HxDesignParams
): {
  summary: HxSideFluidSummary;
  flows: Record<SimCompKey, number>;
  dewPointC: number | null;
  desupMcalH: number;
  latentMcalH: number;
  subcoolMcalH: number;
  dutyKcalH: number;
} {
  const flows: Record<SimCompKey, number> = Object.fromEntries(
    SIM_COMPS.map((k) => [k, 0])
  ) as Record<SimCompKey, number>;

  let inMass = 0;
  let weightedTIn = 0;
  let weightedPIn = 0;
  let inVapMass = 0;
  let rhoInSum = 0;
  let cpInSum = 0;

  for (const s of procInStreams) {
    const vf = Number.isFinite(s.vaporFraction)
      ? s.vaporFraction
      : s.phase === 'G'
      ? 1
      : s.phase === 'L/G'
      ? 0.5
      : 0;
    const cpVal = Number.isFinite(s.cpKcalKgC) && s.cpKcalKgC > 0 ? s.cpKcalKgC : vf > 0.5 ? 0.22 : 0.65;
    const rhoVal = Number.isFinite(s.densityKgM3) && s.densityKgM3 > 0 ? s.densityKgM3 : vf > 0.5 ? 3.2 : 1050;
    inMass += s.totalMassKgH;
    weightedTIn += s.tempC * s.totalMassKgH;
    weightedPIn += s.pressKgcm2g * s.totalMassKgH;
    inVapMass += s.totalMassKgH * vf;
    rhoInSum += rhoVal * s.totalMassKgH;
    cpInSum += cpVal * s.totalMassKgH;
    for (const k of SIM_COMPS) {
      flows[k] += s.flowsKgH[k] || 0;
    }
  }

  // 연결된 배관이 없을 때도 개념설계 테스트가 가능하도록 기본 운전값 제공
  if (inMass <= 1e-3) {
    inMass = 5000;
    flows.ECH = 4750;
    flows.DCH = 250;
    weightedTIn = 85 * inMass;
    weightedPIn = 0.5 * inMass;
    rhoInSum = 1160 * inMass;
    cpInSum = 0.43 * inMass;
  }

  const T_in = weightedTIn / inMass;
  const P_in = weightedPIn / inMass;

  let outMass = 0;
  let weightedTOut = 0;
  let outLiqMass = 0;
  for (const s of procOutStreams) {
    const vfOut = Number.isFinite(s.vaporFraction)
      ? s.vaporFraction
      : s.phase === 'G'
      ? 1
      : s.phase === 'L/G'
      ? 0.5
      : 0;
    outMass += s.totalMassKgH;
    weightedTOut += s.tempC * s.totalMassKgH;
    outLiqMass += s.totalMassKgH * (1 - vfOut);
  }
  const T_out =
    outMass > 1e-3
      ? weightedTOut / outMass
      : params.operTempC ?? (unitType === 'liquefier' ? -22 : 35);

  const inLiqMass = inMass - inVapMass;
  const condensedKgH = Math.max(
    unitRes?.condensedOrRemovedKgH ?? 0,
    outMass > 1e-3 ? Math.max(0, outLiqMass - inLiqMass) : 0
  );
  const vaporizedKgH =
    outMass > 1e-3 ? Math.max(0, (outMass - outLiqMass) - inVapMass) : 0;

  // 대표 유체 물성(점도·열전도도·밀도) 혼합 추정
  const w = (k: SimCompKey) => (flows[k] || 0) / inMass;
  const isGasDominant = inVapMass > inMass * 0.45 && condensedKgH < inMass * 0.15;

  let rhoAvg = rhoInSum / inMass;
  if (!Number.isFinite(rhoAvg) || rhoAvg <= 0) {
    rhoAvg = isGasDominant ? 3.2 : 1050;
  }
  // 응축기/액화기의 경우 기액 평균 유효 밀도 보정
  let rhoLiqEst: number | undefined;
  let rhoVapEst: number | undefined;
  if (condensedKgH > inMass * 0.1) {
    const P_abs = Math.max(0.15, P_in + 1.03323);
    const rhoGas = Math.max(0.35, (P_abs * 48) / (0.0848 * (T_in + 273.15)));
    const rhoLiq =
      w('Cl2') > 0.4 ? 1510 : w('ECH') + w('DCH') > 0.3 ? 1180 : w('HCl') > 0.4 ? 1050 : 995;
    rhoAvg = 0.45 * rhoGas + 0.55 * rhoLiq;
    rhoLiqEst = rhoLiq;
    rhoVapEst = rhoGas;
  }

  let muCp = isGasDominant ? 0.015 : 0.85;
  let kWmK = isGasDominant ? 0.018 : 0.42;

  if (!isGasDominant) {
    if (w('NaOH') > 0.2) {
      muCp = T_in > 60 ? 3.4 : 6.8;
      kWmK = 0.56;
    } else if (w('Glycerol') > 0.2) {
      muCp = T_in > 90 ? 12.0 : 45.0;
      kWmK = 0.29;
    } else if (w('ECH') + w('DCH') + w('MCH') + w('DCP') > 0.25) {
      muCp = 0.78;
      kWmK = 0.145;
    } else if (w('H2SO4') > 0.5) {
      muCp = 11.5;
      kWmK = 0.36;
    } else if (w('Cl2') > 0.4) {
      muCp = 0.35;
      kWmK = 0.15;
    } else if (w('NaCl') > 0.1) {
      muCp = 1.15;
      kWmK = 0.58;
    } else {
      muCp = Math.max(0.28, 1.0 * Math.exp(-0.016 * (0.5 * (T_in + T_out) - 20)));
      kWmK = 0.61;
    }
  } else {
    if (w('H2') > 0.2) {
      muCp = 0.0095;
      kWmK = 0.175;
    } else if (w('Cl2') > 0.3) {
      muCp = 0.014;
      kWmK = 0.0095;
    } else {
      muCp = 0.016;
      kWmK = 0.024;
    }
  }

  const cpAvg = Math.max(0.12, cpInSum / inMass);
  const latentAvg =
    w('Cl2') > 0.4
      ? 68.8
      : w('HCl') > 0.5 && w('H2O') < 0.05
      ? 105.8
      : w('ECH') + w('DCP') + w('DCH') > 0.4
      ? 92.0
      : 540.0;

  // 비응축성 가스 몰분율 (Cl2 액화기 N2/O2/H2 또는 습가스 냉각기)
  const totalMoles = SIM_COMPS.reduce(
    (s, k) => s + (flows[k] || 0) / COMP_META[k].mw,
    0
  );
  const ncMoles =
    (flows.N2 || 0) / COMP_META.N2.mw +
    (flows.O2 || 0) / COMP_META.O2.mw +
    (flows.H2 || 0) / COMP_META.H2.mw;
  const yNonCond = totalMoles > 0 ? ncMoles / totalMoles : 0;

  let phaseRegime: HxSideFluidSummary['phaseRegime'] = isGasDominant
    ? 'sensible_gas'
    : 'sensible_liq';
  let phaseLabel = isGasDominant ? '기상 현열 (Gas)' : '액상 현열 (Liquid)';
  let phaseChangeMassKgH = 0;

  if (condensedKgH > inMass * 0.03 || unitType === 'liquefier') {
    phaseRegime = 'condensing';
    phaseChangeMassKgH = condensedKgH;
    phaseLabel =
      yNonCond > 0.02
        ? `부분응축·액화 (비응축가스 ${(yNonCond * 100).toFixed(1)} mol%)`
        : '응축·액화 상변화 (Condensing)';
  } else if (vaporizedKgH > inMass * 0.05) {
    phaseRegime = 'boiling';
    phaseChangeMassKgH = vaporizedKgH;
    phaseLabel = '비등·증발 상변화 (Boiling)';
  }

  // 열부하 결정
  const sensibleKcalH = inMass * cpAvg * (T_out - T_in);
  const calcDutyFallback =
    sensibleKcalH - condensedKgH * latentAvg + vaporizedKgH * latentAvg;
  const dutyKcalH =
    unitRes && Math.abs(unitRes.heatDutyKcalH) > 10
      ? unitRes.heatDutyKcalH
      : calcDutyFallback;

  // 3-Zone 분해 (응축 시)
  let dewPointC: number | null = null;
  let desupMcalH = 0;
  let latentMcalH = 0;
  let subcoolMcalH = 0;

  const absDutyMcalH = Math.abs(dutyKcalH) / 1000;
  if (phaseRegime === 'condensing' && phaseChangeMassKgH > 0.5) {
    const P_abs = Math.max(0.15, P_in + 1.03323);
    if (w('Cl2') > 0.3) {
      const yCl2 = Math.max(0.05, ((flows.Cl2 || 0) / COMP_META.Cl2.mw) / Math.max(1e-6, totalMoles));
      const pCl2Bar = Math.max(0.05, P_abs * 0.980665 * yCl2);
      dewPointC = 906.7 / (4.0628 - Math.log10(pCl2Bar)) - 250.0;
      dewPointC = Math.max(T_out + 0.5, Math.min(T_in, dewPointC));
    } else {
      dewPointC = Math.min(T_in, Math.max(T_out + 1.0, 0.65 * T_in + 0.35 * T_out));
    }
    const rawLatMcal = (phaseChangeMassKgH * latentAvg) / 1000;
    const rawDesupMcal =
      T_in > dewPointC ? (inMass * 0.22 * (T_in - dewPointC)) / 1000 : 0;
    latentMcalH = Math.min(absDutyMcalH * 0.92, rawLatMcal);
    desupMcalH = Math.min(Math.max(0, absDutyMcalH - latentMcalH), rawDesupMcal);
    subcoolMcalH = Math.max(0, absDutyMcalH - latentMcalH - desupMcalH);
  } else {
    desupMcalH = absDutyMcalH;
  }

  const fluidName =
    unitRes?.detectedFluidLabel && unitRes.detectedFluidLabel !== '-'
      ? unitRes.detectedFluidLabel
      : (() => {
          const top = SIM_COMPS.slice().sort((a, b) => (flows[b] || 0) - (flows[a] || 0))[0];
          return `${COMP_META[top].formula} 혼합유체`;
        })();

  const defaultFouling =
    w('NaCl') > 0.08 || w('Glycerol') > 0.1 || w('FeCl3') > 0.05 ? 0.0003 : 0.00018;

  return {
    summary: {
      roleLabel: '공정 유체 (Process)',
      fluidName,
      phaseRegime,
      phaseLabel,
      massFlowKgH: inMass,
      inTempC: T_in,
      outTempC: T_out,
      pressKgcm2g: P_in,
      densityKgM3: rhoAvg,
      cpKcalKgC: cpAvg,
      viscosityCp: muCp,
      conductivityWmK: kWmK,
      latentHeatKcalKg: latentAvg,
      phaseChangeMassKgH,
      nonCondensableMolFrac: yNonCond,
      foulingM2HKcal: hxCfg.foulingProcM2HKcal ?? params.foulingFactor ?? defaultFouling,
      rhoLiqKgM3: rhoLiqEst,
      rhoVapKgM3: rhoVapEst,
      sigmaNm: w('H2O') > 0.6 ? 0.06 : w('Cl2') > 0.4 ? 0.018 : 0.025,
    },
    flows,
    dewPointC,
    desupMcalH,
    latentMcalH,
    subcoolMcalH,
    dutyKcalH,
  };
}

/**
 * 유틸리티측(냉각수 / 칠드워터 / 브라인 / 증발냉매 / 스팀 / 연결된 유틸리티 배관) 요약 생성
 */
function buildUtilitySideSummary(
  unitType: FlowUnitType,
  dutyKcalH: number,
  utilInStreams: SolvedStream[],
  utilOutStreams: SolvedStream[],
  params: FlowUnitParams,
  hxCfg: HxDesignParams
): HxSideFluidSummary {
  const isHeatingProcess = dutyKcalH > 0;
  let refKey: RefrigerantPresetKey =
    params.refrigerantPreset ??
    (isHeatingProcess ? 'steam_lp' : unitType === 'liquefier' ? 'freon_m35' : 'cw');

  // 공정 가열(Q > 0)인데 냉각수 프리셋이 선택되어 있으면 스팀으로 자동 보정하지 않고 사용자 설정을 존중하되 온도역전 진단에 맡김
  const fallbackRefKey: RefrigerantPresetKey =
    isHeatingProcess ? 'steam_lp' : unitType === 'liquefier' ? 'freon_m35' : 'cw';
  if (!(refKey in REFRIGERANT_PRESETS)) {
    refKey = fallbackRefKey;
  }
  const refMeta = REFRIGERANT_PRESETS[refKey];

  let uMass = 0;
  let uInT = refKey === 'custom' ? params.utilInTempC ?? 20 : refMeta.inTempC;
  let uOutT = refKey === 'custom' ? params.utilOutTempC ?? 30 : refMeta.outTempC;
  let uPress = refKey === 'steam_lp' ? 3.2 : 3.5;
  const uCp = refKey === 'custom' ? Math.max(0.15, params.utilCp ?? 1.0) : refMeta.cp;

  if (utilInStreams.length > 0) {
    uMass = utilInStreams.reduce((s, st) => s + st.totalMassKgH, 0);
    if (uMass > 0.1) {
      uInT =
        utilInStreams.reduce((s, st) => s + st.tempC * st.totalMassKgH, 0) / uMass;
      uPress =
        utilInStreams.reduce((s, st) => s + st.pressKgcm2g * st.totalMassKgH, 0) / uMass;
    }
    if (utilOutStreams.length > 0) {
      const uOutMass = utilOutStreams.reduce((s, st) => s + st.totalMassKgH, 0);
      if (uOutMass > 0.1) {
        uOutT =
          utilOutStreams.reduce((s, st) => s + st.tempC * st.totalMassKgH, 0) / uOutMass;
      }
    } else if (uMass > 0.1) {
      uOutT = uInT + (-dutyKcalH) / Math.max(1, uMass * uCp);
    }
  } else {
    const absQ = Math.max(100, Math.abs(dutyKcalH));
    if (refMeta.latentKcalKg) {
      const sup = uCp * Math.abs(uOutT - uInT);
      uMass = absQ / (refMeta.latentKcalKg + sup);
    } else {
      uMass = absQ / (uCp * Math.max(0.5, Math.abs(uOutT - uInT)));
    }
  }

  let phaseRegime: HxSideFluidSummary['phaseRegime'] = 'sensible_liq';
  let phaseLabel = '액상 현열 순환';
  let rho = 996;
  let mu = 0.85;
  let kWmK = 0.60;
  let latent = 0;

  if (refKey === 'steam_lp') {
    phaseRegime = 'condensing';
    phaseLabel = '포화스팀 잠열 응축';
    rho = 2.2;
    mu = 0.22;
    kWmK = 0.68;
    latent = refMeta.latentKcalKg ?? 508;
  } else if (refMeta.latentKcalKg) {
    phaseRegime = 'boiling';
    phaseLabel = '냉매 증발 잠열 흡수';
    rho = refKey === 'nh3_m33' ? 680 : 1240;
    mu = 0.24;
    kWmK = refKey === 'nh3_m33' ? 0.52 : 0.088;
    latent = refMeta.latentKcalKg;
  } else if (refKey === 'meg_brine' || refKey === 'brine_m20') {
    rho = refKey === 'brine_m20' ? 1235 : 1065;
    mu = refKey === 'brine_m20' ? 5.8 : 4.6;
    kWmK = 0.43;
  } else if (refKey === 'chw') {
    rho = 999;
    mu = 1.32;
    kWmK = 0.58;
  }

  const defaultUtilFouling = refKey === 'cw' ? 0.00025 : 0.00012;

  return {
    roleLabel: '유틸리티/열매 (Utility)',
    fluidName: refMeta.label,
    phaseRegime,
    phaseLabel,
    massFlowKgH: Math.max(1, uMass),
    inTempC: uInT,
    outTempC: uOutT,
    pressKgcm2g: uPress,
    densityKgM3: rho,
    cpKcalKgC: uCp,
    viscosityCp: mu,
    conductivityWmK: kWmK,
    latentHeatKcalKg: latent,
    phaseChangeMassKgH: latent > 0 ? uMass : 0,
    nonCondensableMolFrac: 0,
    foulingM2HKcal: hxCfg.foulingUtilM2HKcal ?? defaultUtilFouling,
  };
}

/**
 * 25점 구간별 T-Q 열교환 프로파일 생성 & 최소 접근온도(Pinch ΔT) 산출
 */
function buildPiecewiseTQProfile(
  hot: HxSideFluidSummary,
  cold: HxSideFluidSummary,
  totalDutyMcalH: number,
  dewPointC: number | null,
  desupMcalH: number,
  latentMcalH: number
): { points: HxTQPoint[]; minPinchDeltaTC: number } {
  const Q = Math.max(0.1, totalDutyMcalH);
  const f1 = dewPointC !== null && latentMcalH > 0.01 ? Math.min(0.85, desupMcalH / Q) : 0;
  const f2 =
    dewPointC !== null && latentMcalH > 0.01
      ? Math.min(0.99, (desupMcalH + latentMcalH) / Q)
      : 0;

  const hotTempAt = (f: number): { T: number; zone: string } => {
    // f = 0 (고온 입구, Q = 0) -> f = 1 (고온 출구, Q = Total)
    if (dewPointC !== null && latentMcalH > 0.01 && hot.phaseRegime === 'condensing') {
      const tDewEnd = Math.max(hot.outTempC, dewPointC - (hot.nonCondensableMolFrac > 0.02 ? 4.5 : 0.8));
      if (f <= f1 && f1 > 1e-4) {
        return {
          T: hot.inTempC - (hot.inTempC - dewPointC) * (f / f1),
          zone: '과열제거 (Desuperheat)',
        };
      }
      if (f <= f2 && f2 > f1) {
        return {
          T: dewPointC - (dewPointC - tDewEnd) * ((f - f1) / Math.max(1e-4, f2 - f1)),
          zone: '잠열응축 (Condensing)',
        };
      }
      return {
        T: tDewEnd - (tDewEnd - hot.outTempC) * ((f - f2) / Math.max(1e-4, 1 - f2)),
        zone: '액상과냉 (Subcooling)',
      };
    }
    return {
      T: hot.inTempC - (hot.inTempC - hot.outTempC) * f,
      zone: hot.phaseRegime === 'condensing' ? '등온응축' : '현열교환',
    };
  };

  const coldTempAt = (f: number): number => {
    // 향류(Countercurrent): f = 0 일 때 저온 유체 출구(Tc_out), f = 1 일 때 저온 유체 입구(Tc_in)
    if (cold.phaseRegime === 'boiling') {
      // f = 1(냉매 입구 포화온도) -> f = 0.12 까지 정온 비등 후 약간의 출구 과열
      const boilT = cold.inTempC;
      if (f >= 0.12) return boilT;
      return cold.outTempC - (cold.outTempC - boilT) * (f / 0.12);
    }
    return cold.outTempC - (cold.outTempC - cold.inTempC) * f;
  };

  const points: HxTQPoint[] = [];
  let minPinch = 9999;
  const N_PTS = 24;
  for (let i = 0; i <= N_PTS; i++) {
    const f = i / N_PTS;
    const hInfo = hotTempAt(f);
    const cT = coldTempAt(f);
    const dT = hInfo.T - cT;
    if (dT < minPinch) minPinch = dT;
    points.push({
      fracQ: f,
      cumDutyMcalH: Number((f * Q).toFixed(2)),
      hotTempC: Number(hInfo.T.toFixed(2)),
      coldTempC: Number(cT.toFixed(2)),
      deltaTC: Number(dT.toFixed(2)),
      zoneLabel: hInfo.zone,
    });
  }

  return { points, minPinchDeltaTC: Number(minPinch.toFixed(2)) };
}

/** 측 요약 → 단상 물성 (SI) */
function sideToFluidState(s: HxSideFluidSummary, phase?: 'liq' | 'vap'): FluidState {
  const tp = buildTwoPhaseFluid(s);
  if (phase === 'liq') return { massFlowKgS: tp.massFlowKgS, rho: tp.rhoL, mu: tp.muL, cp: tp.cpL, k: tp.kL };
  if (phase === 'vap')
    return { massFlowKgS: tp.massFlowKgS, rho: tp.rhoG, mu: tp.muG, cp: 1900 * 0.55, k: 0.025 };
  return {
    massFlowKgS: Math.max(1e-4, s.massFlowKgH / 3600),
    rho: Math.max(0.25, s.densityKgM3),
    mu: Math.max(8e-6, s.viscosityCp * 1e-3),
    cp: Math.max(450, s.cpKcalKgC * 4184),
    k: Math.max(0.008, s.conductivityWmK),
  };
}

/** 측 요약 → 2상 물성 (SI). 상별 물성 미지정 시 압력·유체명 기반 추정 */
function buildTwoPhaseFluid(s: HxSideFluidSummary): TwoPhaseFluid {
  const isSteam = /steam|스팀|수증기/i.test(s.fluidName);
  const pAbsBar = Math.max(0.05, (s.pressKgcm2g + 1.03323) * 0.980665);
  const tSatK = (s.phaseRegime === 'boiling' ? s.inTempC : Math.max(s.outTempC, s.inTempC - 5)) + 273.15;
  const mw = isSteam ? 18.015 : 50;
  const rhoG = s.rhoVapKgM3 ?? Math.max(0.05, (pAbsBar * 1e5 * mw) / (8314.46 * tSatK));
  const rhoL = s.rhoLiqKgM3 ?? (isSteam ? 940 : s.densityKgM3 > 300 ? s.densityKgM3 : 1000);
  const liquidLike = s.densityKgM3 > 300;
  const muL = isSteam ? 2.3e-4 : liquidLike ? Math.max(1e-4, s.viscosityCp * 1e-3) : 3e-4;
  const muG = (s.muVapCp ?? (isSteam ? 0.013 : 0.012)) * 1e-3;
  const cpL = isSteam ? 4250 : liquidLike ? Math.max(900, s.cpKcalKgC * 4184) : 1600;
  const kL = isSteam ? 0.68 : s.conductivityWmK > 0.08 ? s.conductivityWmK : 0.14;
  const pCritBar = isSteam ? 220.6 : 45;
  return {
    massFlowKgS: Math.max(1e-4, s.massFlowKgH / 3600),
    rhoL,
    rhoG: Math.min(rhoG, rhoL * 0.5),
    muL,
    muG,
    cpL,
    kL,
    sigma: s.sigmaNm ?? (isSteam ? 0.055 : 0.02),
    hfg: Math.max(5e4, s.latentHeatKcalKg * 4184),
    pCritBar,
    pReduced: Math.min(0.9, pAbsBar / pCritBar),
  };
}

/** 상변화 측 증기건도 범위 (입구→출구) */
function phaseQualityRange(s: HxSideFluidSummary): { xIn: number; xOut: number } {
  const frac = Math.min(1, Math.max(0, s.phaseChangeMassKgH / Math.max(1e-6, s.massFlowKgH)));
  if (s.phaseRegime === 'condensing') return { xIn: 1, xOut: Math.max(0, 1 - frac) };
  if (s.phaseRegime === 'boiling') return { xIn: 0, xOut: Math.min(0.95, frac) };
  return { xIn: 0, xOut: 0 };
}

/**
 * 열교환기 개념·상세설계 메인 해석 함수
 */
export function solveHeatExchangerDesign(
  unitType: FlowUnitType,
  params: FlowUnitParams,
  hxCfg: HxDesignParams,
  procInStreams: SolvedStream[],
  procOutStreams: SolvedStream[],
  utilInStreams: SolvedStream[],
  utilOutStreams: SolvedStream[],
  unitRes?: SolvedUnitResult
): HxDesignSolveResult {
  const procPack = buildProcessSideSummary(
    unitType,
    procInStreams,
    procOutStreams,
    unitRes,
    params,
    hxCfg
  );
  const proc = procPack.summary;
  const util = buildUtilitySideSummary(
    unitType,
    procPack.dutyKcalH,
    utilInStreams,
    utilOutStreams,
    params,
    hxCfg
  );

  const isHeatingProcess = procPack.dutyKcalH > 0;
  const hotSide = isHeatingProcess ? util : proc;
  const coldSide = isHeatingProcess ? proc : util;

  const dutyKcalH = Math.max(100, Math.abs(procPack.dutyKcalH));
  const dutyMcalH = dutyKcalH / 1000;
  const dutyKW = dutyKcalH * KCAL_TO_KW;
  const usrt = dutyKcalH / 3024.0;

  // 재질 추천 및 검증
  const minT = Math.min(proc.inTempC, proc.outTempC, util.inTempC, util.outTempC);
  const maxT = Math.max(proc.inTempC, proc.outTempC, util.inTempC, util.outTempC);
  const matInfo = recommendHxMaterial(procPack.flows, minT, maxT);
  const matCode: HxMaterialCode = hxCfg.material ?? matInfo.recommended;
  const material = HX_MATERIAL_CATALOG[matCode];

  const hxKind: HxEquipmentKind = hxCfg.hxKind ?? 'shell_tube';
  const defaultTema: TemaConfiguration =
    unitType === 'liquefier' || util.phaseRegime === 'boiling'
      ? 'BKM'
      : Math.abs(hotSide.inTempC - coldSide.inTempC) > 80
      ? 'AES'
      : 'BEM';
  const temaType: TemaConfiguration = hxCfg.temaType ?? defaultTema;

  // 부식성·오염성 유체는 관측(Tube) 배치가 기본 (단, 케틀형 BKM에서 냉매가 동체 비등할 때도 공정유체 관측 배치와 일치)
  const allocation: HxTubeAllocation = hxCfg.allocation ?? 'process_tube';
  const tubeSide = allocation === 'process_tube' ? proc : util;
  const shellSide = allocation === 'process_tube' ? util : proc;

  // T-Q 프로파일 및 핀치 계산
  const { points: tqProfile, minPinchDeltaTC } = buildPiecewiseTQProfile(
    hotSide,
    coldSide,
    dutyMcalH,
    !isHeatingProcess ? procPack.dewPointC : null,
    !isHeatingProcess ? procPack.desupMcalH : dutyMcalH,
    !isHeatingProcess ? procPack.latentMcalH : 0
  );

  const dtEndA = hotSide.inTempC - coldSide.outTempC;
  const dtEndB = hotSide.outTempC - coldSide.inTempC;
  const lmtdCounterC = calcSafeLmtd(dtEndA, dtEndB);

  const shellCount = Math.max(1, Math.min(4, Math.round(hxCfg.shellCount ?? 1)));
  const tubePasses = hxCfg.tubePasses ?? (temaType === 'BEM' && proc.phaseRegime === 'condensing' ? 1 : 2);
  const hasIsoPhase =
    hotSide.phaseRegime === 'condensing' || coldSide.phaseRegime === 'boiling';

  const ftFactor =
    hxKind === 'plate_phe'
      ? 0.96
      : calcTemaFt(
          hotSide.inTempC,
          hotSide.outTempC,
          coldSide.inTempC,
          coldSide.outTempC,
          shellCount,
          tubePasses,
          temaType,
          hasIsoPhase
        );

  // 다구간 응축 시 가중 평균 추진력 보정
  const avgZoneDt =
    tqProfile.reduce((s, pt) => s + Math.max(0.5, pt.deltaTC), 0) /
    Math.max(1, tqProfile.length);
  const effectiveBaseDt =
    !isHeatingProcess && procPack.latentMcalH > 0.05
      ? Math.min(lmtdCounterC, 0.55 * lmtdCounterC + 0.45 * avgZoneDt)
      : lmtdCounterC;
  const cmtdC = Math.max(0.8, effectiveBaseDt * ftFactor);

  const designMarginPct = Math.max(0, Math.min(60, hxCfg.designMarginPct ?? 15));
  const rfTubeWm2K = tubeSide.foulingM2HKcal / WM2K_TO_KCAL;
  const rfShellWm2K = shellSide.foulingM2HKcal / WM2K_TO_KCAL;

  const Q_Watts = dutyKW * 1000;

  // 기본 변수 초기화
  let hTubeWm2K = 1200;
  let hShellWm2K = 1200;
  let uCleanWm2K = 600;
  let uCalcWm2K = 480;
  let areaReqM2 = 15;
  let areaProvM2 = 18;
  let tubeCountPerShell = 80;
  const tubeOdMm = hxCfg.tubeOdMm ?? 19.05;
  const tubeWallMm =
    hxCfg.tubeWallMm ?? (matCode === 'TI_GR2' || matCode === 'HASTELLOY_C276' ? 1.24 : 1.65);
  const tubeIdMm = Math.max(8, tubeOdMm - 2 * tubeWallMm);
  const tubeLengthM = hxCfg.tubeLengthM ?? 3.66;
  const pitchAngle: TubeLayoutAngle = hxCfg.pitchAngle ?? (shellSide.foulingM2HKcal > 0.00028 ? 90 : 30);
  const tubePitchMm = Number((1.25 * tubeOdMm).toFixed(2));
  let bundleDiaMm = 450;
  let shellIdMm = 500;
  const baffleCutPct = Math.max(15, Math.min(45, hxCfg.baffleCutPct ?? 25));
  let baffleSpacingMm = 220;
  let baffleCount = 12;

  let phePlateCount = 0;
  let pheChannelsPerSide = 0;
  const pheChevronDeg = hxCfg.pheChevronDeg ?? 45;
  const pheGapMm = Math.max(2.0, Math.min(5.5, hxCfg.pheGapMm ?? 3.2));
  let phePackLengthMm = 0;
  const phePlateWidthM = Math.max(0.25, Math.min(1.2, hxCfg.phePlateWidthM ?? 0.55));
  const phePlateLengthM = Math.max(0.6, Math.min(2.6, hxCfg.phePlateLengthM ?? 1.45));

  let velTubeMs = 1.2;
  let velShellMs = 0.7;
  let reTube = 12000;
  let reShell = 8500;
  let dpTubeBar = 0.18;
  let dpShellBar = 0.14;
  let vortexFreqHz = 12;
  let naturalFreqHz = 48;
  let vibRatio = 0.25;

  let bdResDetail: BellDelawareResult | undefined;
  let kernCheckDetail: { hWm2K: number; dpBar: number; re: number } | undefined;
  let vibResDetail: VibrationResult | undefined;
  let tubeDpBreakdownDetail: { frictionBar: number; accelerationBar: number; returnBar: number; model: string } | undefined;
  let shellDpBreakdownDetail: { crossBar: number; windowBar: number; endBar: number; twoPhaseMultiplier?: number } | undefined;
  let zoneRatingRows: HxZoneRatingRow[] | undefined;
  let dutyCapabilityKWVal: number | undefined;
  let chfCheckDetail: ChfCheckResult | undefined;

  const isRatingMode = hxCfg.designMode === 'rating' || (hxCfg.ratingTubeCount !== undefined && hxCfg.ratingTubeCount > 0);

  // Estimate process gas MW for true acoustic speed when shell side is gas
  const procTotalMoles = SIM_COMPS.reduce((s, k) => s + (procPack.flows[k] || 0) / COMP_META[k].mw, 0);
  const procTotalMass = SIM_COMPS.reduce((s, k) => s + (procPack.flows[k] || 0), 0);
  const procAvgMw = procTotalMoles > 1e-6 ? procTotalMass / procTotalMoles : 28.97;
  const shellGasMw = allocation === 'process_shell' ? procAvgMw : 28.97;
  const shellGasTempK = 0.5 * (shellSide.inTempC + shellSide.outTempC) + 273.15;

  const applySbgIfNeeded = (
    hCondRaw: number,
    side: HxSideFluidSummary,
    isShell: boolean,
    geom: ShellTubeGeometry,
  ): number => {
    const isProcSide = (isShell && allocation === 'process_shell') || (!isShell && allocation === 'process_tube');
    const hasDesup = !isHeatingProcess && isProcSide && procPack.desupMcalH > 0.01;
    const qSensFrac = hasDesup && dutyMcalH > 0 ? Math.min(0.85, procPack.desupMcalH / dutyMcalH) : 0;
    if (side.nonCondensableMolFrac > 0 || qSensFrac > 0) {
      const vapFl = sideToFluidState(side, 'vap');
      const hGas = isShell ? bellDelawareShellSide(geom, vapFl).h : tubeSideSinglePhase(geom, vapFl).h;
      return silverBellGhalyCondensationH(hCondRaw, hGas, qSensFrac, side.nonCondensableMolFrac);
    }
    return hCondRaw;
  };

  if (hxKind === 'shell_tube') {
    const doM = tubeOdMm / 1000;
    const diM = tubeIdMm / 1000;
    const rWall = (doM * Math.log(doM / diM)) / (2 * material.kwWmK);
    const layoutDeg: LayoutDeg = pitchAngle === 90 ? 90 : pitchAngle === 45 ? 45 : 30;
    let dpShellPa = 0;
    let dpTubePa = 0;

    if (isRatingMode) {
      // ── 레이팅(Rating) 모드: 고정된 기존 기하형상에서 성능·용량·차압 해석 ──
      tubeCountPerShell = hxCfg.ratingTubeCount ?? 80;
      shellIdMm = hxCfg.ratingShellIdMm ?? 500;
      const rL = hxCfg.ratingTubeLengthM ?? hxCfg.tubeLengthM ?? tubeLengthM;
      const bRatio = Math.max(0.2, Math.min(0.95, hxCfg.baffleSpacingRatio ?? 0.45));
      baffleSpacingMm = hxCfg.ratingBaffleSpacingMm ?? Math.max(65, Math.round(shellIdMm * bRatio));
      baffleCount = Math.max(1, Math.floor((rL * 1000) / baffleSpacingMm) - 1);
      const areaPerTube = Math.PI * doM * rL;
      areaProvM2 = tubeCountPerShell * areaPerTube * shellCount;

      const geom: ShellTubeGeometry = {
        shellIdM: shellIdMm / 1000,
        tubeOdM: doM,
        tubeIdM: diM,
        tubePitchM: tubePitchMm / 1000,
        layoutDeg,
        tubeCount: tubeCountPerShell,
        tubePasses,
        tubeLengthM: rL,
        baffleSpacingM: baffleSpacingMm / 1000,
        baffleCutFrac: baffleCutPct / 100,
        inletBaffleSpacingM: hxCfg.inletBaffleSpacingMm ? hxCfg.inletBaffleSpacingMm / 1000 : undefined,
        outletBaffleSpacingM: hxCfg.outletBaffleSpacingMm ? hxCfg.outletBaffleSpacingMm / 1000 : undefined,
        sealingStripPairs: hxCfg.sealingStripPairs ?? 0,
        passLaneWidthM: defaultPassLaneWidthM(tubePasses, doM),
        shellBaffleClearanceM: hxCfg.shellBaffleClearanceMm ? hxCfg.shellBaffleClearanceMm / 1000 : undefined,
        tubeBaffleClearanceM: hxCfg.tubeBaffleClearanceMm ? hxCfg.tubeBaffleClearanceMm / 1000 : undefined,
        baffleCount,
      };

      // Shell-side
      const flShell = sideToFluidState(shellSide);
      const bdRes = bellDelawareShellSide(geom, flShell);
      bdResDetail = bdRes;
      velShellMs = bdRes.crossVelMs;
      reShell = bdRes.Re;

      if (shellSide.phaseRegime === 'condensing') {
        const tpS = buildTwoPhaseFluid(shellSide);
        hShellWm2K = applySbgIfNeeded(shellCondensationH(tpS, geom), shellSide, true, geom);
        const qr = phaseQualityRange(shellSide);
        const sdp = shellSideTwoPhaseDP(geom, tpS, qr.xIn, qr.xOut);
        dpShellPa = shellCount * sdp.dpPa;
        shellDpBreakdownDetail = {
          crossBar: (shellCount * sdp.liquidOnly.dpCrossPa * sdp.phiCross) / 1e5,
          windowBar: (shellCount * sdp.liquidOnly.dpWindowPa * sdp.phiWindow) / 1e5,
          endBar: (shellCount * sdp.liquidOnly.dpEndPa * sdp.phiCross) / 1e5,
          twoPhaseMultiplier: sdp.phiCross,
        };
      } else if (shellSide.phaseRegime === 'boiling') {
        const tpS = buildTwoPhaseFluid(shellSide);
        const qFlux = Q_Watts / Math.max(1, areaProvM2);
        hShellWm2K = shellBoilingH(tpS, qFlux);
        const qr = phaseQualityRange(shellSide);
        const sdp = shellSideTwoPhaseDP(geom, tpS, qr.xIn, qr.xOut);
        dpShellPa = shellCount * sdp.dpPa;
        shellDpBreakdownDetail = {
          crossBar: (shellCount * sdp.liquidOnly.dpCrossPa * sdp.phiCross) / 1e5,
          windowBar: (shellCount * sdp.liquidOnly.dpWindowPa * sdp.phiWindow) / 1e5,
          endBar: (shellCount * sdp.liquidOnly.dpEndPa * sdp.phiCross) / 1e5,
          twoPhaseMultiplier: sdp.phiCross,
        };
      } else {
        hShellWm2K = bdRes.h;
        dpShellPa = shellCount * bdRes.dpTotalPa;
        shellDpBreakdownDetail = {
          crossBar: (shellCount * bdRes.dpCrossPa) / 1e5,
          windowBar: (shellCount * bdRes.dpWindowPa) / 1e5,
          endBar: (shellCount * bdRes.dpEndPa) / 1e5,
        };
      }
      dpShellBar = dpShellPa / 1e5;

      // Tube-side
      if (tubeSide.phaseRegime === 'condensing') {
        const tpT = buildTwoPhaseFluid(tubeSide);
        const nPerPass = tubeCountPerShell / tubePasses;
        const G_t = tpT.massFlowKgS / Math.max(1e-6, nPerPass * (Math.PI / 4) * diM * diM);
        const qr = phaseQualityRange(tubeSide);
        const hCondInt = integratedPhaseChangeH(qr.xIn, qr.xOut, (x) => shahCondensationH(tpT, G_t, diM, x), 10);
        hTubeWm2K = applySbgIfNeeded(hCondInt, tubeSide, false, geom);
        const tdp = tubeSideTwoPhaseDP(geom, tpT, qr.xIn, qr.xOut);
        dpTubePa = shellCount * tdp.totalPa;
        tubeDpBreakdownDetail = {
          frictionBar: (shellCount * tdp.frictionPa) / 1e5,
          accelerationBar: (shellCount * tdp.accelerationPa) / 1e5,
          returnBar: (shellCount * tdp.returnPa) / 1e5,
          model: 'Friedel (1979)',
        };
        velTubeMs = G_t / tpT.rhoL;
        reTube = (G_t * diM) / tpT.muL;
      } else if (tubeSide.phaseRegime === 'boiling') {
        const tpT = buildTwoPhaseFluid(tubeSide);
        const nPerPass = tubeCountPerShell / tubePasses;
        const G_t = tpT.massFlowKgS / Math.max(1e-6, nPerPass * (Math.PI / 4) * diM * diM);
        const qr = phaseQualityRange(tubeSide);
        const qFlux = Q_Watts / Math.max(1, areaProvM2);
        hTubeWm2K = integratedPhaseChangeH(qr.xIn, qr.xOut, (x) => gungorWintertonBoilingH(tpT, G_t, diM, x, qFlux), 10);
        const tdp = tubeSideTwoPhaseDP(geom, tpT, qr.xIn, qr.xOut);
        dpTubePa = shellCount * tdp.totalPa;
        tubeDpBreakdownDetail = {
          frictionBar: (shellCount * tdp.frictionPa) / 1e5,
          accelerationBar: (shellCount * tdp.accelerationPa) / 1e5,
          returnBar: (shellCount * tdp.returnPa) / 1e5,
          model: 'Friedel (1979)',
        };
        velTubeMs = G_t / tpT.rhoL;
        reTube = (G_t * diM) / tpT.muL;
      } else {
        const flTube = sideToFluidState(tubeSide);
        const tRes = tubeSideSinglePhase(geom, flTube);
        hTubeWm2K = tRes.h;
        velTubeMs = tRes.velMs;
        reTube = tRes.Re;
        dpTubePa = shellCount * tRes.dpTotalPa;
        tubeDpBreakdownDetail = {
          frictionBar: (shellCount * tRes.dpStraightPa) / 1e5,
          accelerationBar: 0,
          returnBar: (shellCount * tRes.dpReturnPa) / 1e5,
          model: 'Gnielinski / Churchill',
        };
      }
      dpTubeBar = dpTubePa / 1e5;

      const invUClean = (doM / diM) / hTubeWm2K + rWall + 1 / hShellWm2K;
      uCleanWm2K = 1 / invUClean;
      const invUFouled = invUClean + (doM / diM) * rfTubeWm2K + rfShellWm2K;
      uCalcWm2K = 1 / invUFouled;
      areaReqM2 = Q_Watts / Math.max(25, uCalcWm2K * cmtdC);
      dutyCapabilityKWVal = (uCalcWm2K * areaProvM2 * cmtdC) / 1000;

      // Kern check
      const kRes = kernShellSide(geom, flShell);
      kernCheckDetail = { hWm2K: kRes.h, dpBar: (shellCount * kRes.dpPa) / 1e5, re: kRes.Re };

      // Vibration
      vibResDetail = temaVibrationCheck({
        g: geom,
        crossVelMs: velShellMs,
        shellRho: Math.max(0.25, shellSide.densityKgM3),
        tubeRhoInside: Math.max(0.25, tubeSide.densityKgM3),
        shellPhase: shellSide.phaseRegime === 'sensible_gas' ? 'gas' : shellSide.phaseRegime === 'sensible_liq' ? 'liquid' : 'twophase',
        gasMw: shellSide.phaseRegime === 'sensible_gas' ? shellGasMw : undefined,
        gasK: shellSide.phaseRegime === 'sensible_gas' ? 1.3 : undefined,
        gasTempK: shellSide.phaseRegime === 'sensible_gas' ? shellGasTempK : undefined,
      });
      vortexFreqHz = vibResDetail.vortexFreqHz;
      naturalFreqHz = vibResDetail.naturalFreqHz;
      vibRatio = vibResDetail.vortexRatio;
    } else {
      // ── 설계(Design) 모드: Bell-Delaware 반복 수렴으로 최적 번들/동체 사이징 ──
      uCalcWm2K = 460;
      for (let iter = 0; iter < 8; iter++) {
        areaReqM2 = Q_Watts / Math.max(25, uCalcWm2K * cmtdC);
        const targetArea = areaReqM2 * (1 + designMarginPct / 100);
        const areaPerTube = Math.PI * doM * tubeLengthM;
        const rawNt = Math.max(12, Math.ceil(targetArea / (areaPerTube * shellCount)));
        tubeCountPerShell = Math.ceil(rawNt / tubePasses) * tubePasses;
        areaProvM2 = tubeCountPerShell * areaPerTube * shellCount;

        const k1 = tubePasses === 1 ? (pitchAngle === 30 ? 0.319 : 0.215) : pitchAngle === 30 ? 0.249 : 0.158;
        const n1 = tubePasses === 1 ? 2.142 : 2.207;
        bundleDiaMm = tubeOdMm * Math.pow(tubeCountPerShell / k1, 1 / n1);
        const clearanceMm =
          temaType === 'AES' ? 38 : temaType === 'BKM' ? Math.max(140, bundleDiaMm * 0.32) : 16;
        shellIdMm = Math.ceil((bundleDiaMm + clearanceMm) / 10) * 10;

        const bRatio = Math.max(0.22, Math.min(0.95, hxCfg.baffleSpacingRatio ?? 0.45));
        baffleSpacingMm = Math.max(65, Math.round(shellIdMm * bRatio));
        baffleCount = Math.max(2, Math.floor((tubeLengthM * 1000) / baffleSpacingMm) - 1);

        const geom: ShellTubeGeometry = {
          shellIdM: shellIdMm / 1000,
          tubeOdM: doM,
          tubeIdM: diM,
          tubePitchM: tubePitchMm / 1000,
          layoutDeg,
          tubeCount: tubeCountPerShell,
          tubePasses,
          tubeLengthM,
          baffleSpacingM: baffleSpacingMm / 1000,
          baffleCutFrac: baffleCutPct / 100,
          inletBaffleSpacingM: hxCfg.inletBaffleSpacingMm ? hxCfg.inletBaffleSpacingMm / 1000 : undefined,
          outletBaffleSpacingM: hxCfg.outletBaffleSpacingMm ? hxCfg.outletBaffleSpacingMm / 1000 : undefined,
          sealingStripPairs: hxCfg.sealingStripPairs ?? 0,
          passLaneWidthM: defaultPassLaneWidthM(tubePasses, doM),
          shellBaffleClearanceM: hxCfg.shellBaffleClearanceMm ? hxCfg.shellBaffleClearanceMm / 1000 : undefined,
          tubeBaffleClearanceM: hxCfg.tubeBaffleClearanceMm ? hxCfg.tubeBaffleClearanceMm / 1000 : undefined,
          baffleCount,
        };

        // Shell-side Bell-Delaware
        const flShell = sideToFluidState(shellSide);
        const bd = bellDelawareShellSide(geom, flShell);
        bdResDetail = bd;
        velShellMs = bd.crossVelMs;
        reShell = bd.Re;

        if (shellSide.phaseRegime === 'condensing') {
          const tpS = buildTwoPhaseFluid(shellSide);
          hShellWm2K = applySbgIfNeeded(shellCondensationH(tpS, geom), shellSide, true, geom);
          const qr = phaseQualityRange(shellSide);
          const sdp = shellSideTwoPhaseDP(geom, tpS, qr.xIn, qr.xOut);
          dpShellPa = shellCount * sdp.dpPa;
          shellDpBreakdownDetail = {
            crossBar: (shellCount * sdp.liquidOnly.dpCrossPa * sdp.phiCross) / 1e5,
            windowBar: (shellCount * sdp.liquidOnly.dpWindowPa * sdp.phiWindow) / 1e5,
            endBar: (shellCount * sdp.liquidOnly.dpEndPa * sdp.phiCross) / 1e5,
            twoPhaseMultiplier: sdp.phiCross,
          };
        } else if (shellSide.phaseRegime === 'boiling') {
          const tpS = buildTwoPhaseFluid(shellSide);
          const qFlux = Q_Watts / Math.max(1, areaProvM2);
          hShellWm2K = shellBoilingH(tpS, qFlux);
          const qr = phaseQualityRange(shellSide);
          const sdp = shellSideTwoPhaseDP(geom, tpS, qr.xIn, qr.xOut);
          dpShellPa = shellCount * sdp.dpPa;
          shellDpBreakdownDetail = {
            crossBar: (shellCount * sdp.liquidOnly.dpCrossPa * sdp.phiCross) / 1e5,
            windowBar: (shellCount * sdp.liquidOnly.dpWindowPa * sdp.phiWindow) / 1e5,
            endBar: (shellCount * sdp.liquidOnly.dpEndPa * sdp.phiCross) / 1e5,
            twoPhaseMultiplier: sdp.phiCross,
          };
        } else {
          hShellWm2K = bd.h;
          dpShellPa = shellCount * bd.dpTotalPa;
          shellDpBreakdownDetail = {
            crossBar: (shellCount * bd.dpCrossPa) / 1e5,
            windowBar: (shellCount * bd.dpWindowPa) / 1e5,
            endBar: (shellCount * bd.dpEndPa) / 1e5,
          };
        }
        dpShellBar = dpShellPa / 1e5;

        // Tube-side
        if (tubeSide.phaseRegime === 'condensing') {
          const tpT = buildTwoPhaseFluid(tubeSide);
          const nPerPass = tubeCountPerShell / tubePasses;
          const G_t = tpT.massFlowKgS / Math.max(1e-6, nPerPass * (Math.PI / 4) * diM * diM);
          const qr = phaseQualityRange(tubeSide);
          const hCondInt = integratedPhaseChangeH(qr.xIn, qr.xOut, (x) => shahCondensationH(tpT, G_t, diM, x), 10);
          hTubeWm2K = applySbgIfNeeded(hCondInt, tubeSide, false, geom);
          const tdp = tubeSideTwoPhaseDP(geom, tpT, qr.xIn, qr.xOut);
          dpTubePa = shellCount * tdp.totalPa;
          tubeDpBreakdownDetail = {
            frictionBar: (shellCount * tdp.frictionPa) / 1e5,
            accelerationBar: (shellCount * tdp.accelerationPa) / 1e5,
            returnBar: (shellCount * tdp.returnPa) / 1e5,
            model: 'Friedel (1979)',
          };
          velTubeMs = G_t / tpT.rhoL;
          reTube = (G_t * diM) / tpT.muL;
        } else if (tubeSide.phaseRegime === 'boiling') {
          const tpT = buildTwoPhaseFluid(tubeSide);
          const nPerPass = tubeCountPerShell / tubePasses;
          const G_t = tpT.massFlowKgS / Math.max(1e-6, nPerPass * (Math.PI / 4) * diM * diM);
          const qr = phaseQualityRange(tubeSide);
          const qFlux = Q_Watts / Math.max(1, areaProvM2);
          hTubeWm2K = integratedPhaseChangeH(qr.xIn, qr.xOut, (x) => gungorWintertonBoilingH(tpT, G_t, diM, x, qFlux), 10);
          const tdp = tubeSideTwoPhaseDP(geom, tpT, qr.xIn, qr.xOut);
          dpTubePa = shellCount * tdp.totalPa;
          tubeDpBreakdownDetail = {
            frictionBar: (shellCount * tdp.frictionPa) / 1e5,
            accelerationBar: (shellCount * tdp.accelerationPa) / 1e5,
            returnBar: (shellCount * tdp.returnPa) / 1e5,
            model: 'Friedel (1979)',
          };
          velTubeMs = G_t / tpT.rhoL;
          reTube = (G_t * diM) / tpT.muL;
        } else {
          const flTube = sideToFluidState(tubeSide);
          const tRes = tubeSideSinglePhase(geom, flTube);
          hTubeWm2K = tRes.h;
          velTubeMs = tRes.velMs;
          reTube = tRes.Re;
          dpTubePa = shellCount * tRes.dpTotalPa;
          tubeDpBreakdownDetail = {
            frictionBar: (shellCount * tRes.dpStraightPa) / 1e5,
            accelerationBar: 0,
            returnBar: (shellCount * tRes.dpReturnPa) / 1e5,
            model: 'Gnielinski / Churchill',
          };
        }
        dpTubeBar = dpTubePa / 1e5;

        const invUClean = (doM / diM) / hTubeWm2K + rWall + 1 / hShellWm2K;
        uCleanWm2K = 1 / invUClean;
        const invUFouled = invUClean + (doM / diM) * rfTubeWm2K + rfShellWm2K;
        uCalcWm2K = 0.4 * uCalcWm2K + 0.6 * (1 / invUFouled);
      }

      areaReqM2 = Q_Watts / Math.max(25, uCalcWm2K * cmtdC);

      const finalGeom: ShellTubeGeometry = {
        shellIdM: shellIdMm / 1000,
        tubeOdM: doM,
        tubeIdM: diM,
        tubePitchM: tubePitchMm / 1000,
        layoutDeg,
        tubeCount: tubeCountPerShell,
        tubePasses,
        tubeLengthM,
        baffleSpacingM: baffleSpacingMm / 1000,
        baffleCutFrac: baffleCutPct / 100,
        inletBaffleSpacingM: hxCfg.inletBaffleSpacingMm ? hxCfg.inletBaffleSpacingMm / 1000 : undefined,
        outletBaffleSpacingM: hxCfg.outletBaffleSpacingMm ? hxCfg.outletBaffleSpacingMm / 1000 : undefined,
        bundleDiaM: bundleDiaMm / 1000,
        shellBaffleClearanceM: hxCfg.shellBaffleClearanceMm ? hxCfg.shellBaffleClearanceMm / 1000 : undefined,
        tubeBaffleClearanceM: hxCfg.tubeBaffleClearanceMm ? hxCfg.tubeBaffleClearanceMm / 1000 : undefined,
        sealingStripPairs: hxCfg.sealingStripPairs ?? 0,
        passLaneWidthM: defaultPassLaneWidthM(tubePasses, doM),
        baffleCount,
      };

      // Kern check
      const flShell = sideToFluidState(shellSide);
      const kRes = kernShellSide(finalGeom, flShell);
      kernCheckDetail = { hWm2K: kRes.h, dpBar: (shellCount * kRes.dpPa) / 1e5, re: kRes.Re };

      // TEMA Vibration
      vibResDetail = temaVibrationCheck({
        g: finalGeom,
        crossVelMs: velShellMs,
        shellRho: Math.max(0.25, shellSide.densityKgM3),
        tubeRhoInside: Math.max(0.25, tubeSide.densityKgM3),
        shellPhase: shellSide.phaseRegime === 'sensible_gas' ? 'gas' : shellSide.phaseRegime === 'sensible_liq' ? 'liquid' : 'twophase',
        gasMw: shellSide.phaseRegime === 'sensible_gas' ? shellGasMw : undefined,
        gasK: shellSide.phaseRegime === 'sensible_gas' ? 1.3 : undefined,
        gasTempK: shellSide.phaseRegime === 'sensible_gas' ? shellGasTempK : undefined,
      });
      vortexFreqHz = vibResDetail.vortexFreqHz;
      naturalFreqHz = vibResDetail.naturalFreqHz;
      vibRatio = vibResDetail.vortexRatio;
    }

    // Critical Heat Flux (CHF / Dryout) check when boiling/evaporating is active
    if (shellSide.phaseRegime === 'boiling' || tubeSide.phaseRegime === 'boiling') {
      const boilSide = shellSide.phaseRegime === 'boiling' ? shellSide : tubeSide;
      const tpB = buildTwoPhaseFluid(boilSide);
      const qFlux = Q_Watts / Math.max(1, areaProvM2);
      chfCheckDetail = zuberPalenSmallChfWm2({
        rhoL: tpB.rhoL,
        rhoV: tpB.rhoG,
        sigmaNm: tpB.sigma,
        hfgJkg: tpB.hfg,
        pitchRatio: tubePitchMm / tubeOdMm,
        bundleDiaM: bundleDiaMm / 1000,
        heatFluxWm2: qFlux,
      });
    }

    // Zone-by-zone incremental rating
    const zRows: HxZoneRatingRow[] = [];
    if (!isHeatingProcess && procPack.desupMcalH > 0.01) {
      const zDutyKW = procPack.desupMcalH * 1000 * KCAL_TO_KW;
      const zDt = Math.max(1, proc.inTempC - (procPack.dewPointC ?? proc.outTempC));
      const zU = Math.min(uCalcWm2K, 380);
      zRows.push({
        zone: '과열저감 (Desuperheating)',
        dutyKW: Number(zDutyKW.toFixed(1)),
        dtC: Number(zDt.toFixed(1)),
        hTubeWm2K: Math.round(hTubeWm2K * 0.45),
        hShellWm2K: Math.round(hShellWm2K),
        uWm2K: Math.round(zU),
        areaM2: Number(((zDutyKW * 1000) / (zU * zDt)).toFixed(2)),
      });
    }
    if (procPack.latentMcalH > 0.01) {
      const zDutyKW = procPack.latentMcalH * 1000 * KCAL_TO_KW;
      const zDt = Math.max(1, (procPack.dewPointC ?? proc.inTempC) - util.outTempC);
      zRows.push({
        zone: '잠열 응축/증발 (Condensing/Boiling)',
        dutyKW: Number(zDutyKW.toFixed(1)),
        dtC: Number(zDt.toFixed(1)),
        hTubeWm2K: Math.round(hTubeWm2K),
        hShellWm2K: Math.round(hShellWm2K),
        uWm2K: Math.round(uCalcWm2K),
        areaM2: Number(((zDutyKW * 1000) / (uCalcWm2K * zDt)).toFixed(2)),
      });
    }
    if (!isHeatingProcess && procPack.subcoolMcalH > 0.01) {
      const zDutyKW = procPack.subcoolMcalH * 1000 * KCAL_TO_KW;
      const zDt = Math.max(1, (procPack.dewPointC ?? proc.inTempC) - proc.outTempC);
      const zU = Math.min(uCalcWm2K, 480);
      zRows.push({
        zone: '과냉각 (Subcooling)',
        dutyKW: Number(zDutyKW.toFixed(1)),
        dtC: Number(zDt.toFixed(1)),
        hTubeWm2K: Math.round(hTubeWm2K * 0.75),
        hShellWm2K: Math.round(hShellWm2K),
        uWm2K: Math.round(zU),
        areaM2: Number(((zDutyKW * 1000) / (zU * zDt)).toFixed(2)),
      });
    }
    if (zRows.length > 0) zoneRatingRows = zRows;
  } else {
    // ── 판형 열교환기 (Chevron PHE) Kumar 상관식 해석 ──
    const phiEnlarge = 1.18; // 주름 전열면적 확대계수
    const bM = pheGapMm / 1000;
    const dePhe = (2 * bM) / phiEnlarge;
    const plateWallM = (hxCfg.phePlateThickMm ?? 0.6) / 1000;
    const rWallPhe = plateWallM / material.kwWmK;
    const areaPerPlate = phePlateWidthM * phePlateLengthM * phiEnlarge;

    const chCoeff = pheChevronDeg === 60 ? 0.348 : pheChevronDeg === 45 ? 0.255 : 0.165;
    const chExp = pheChevronDeg === 60 ? 0.663 : pheChevronDeg === 45 ? 0.65 : 0.63;
    const kpFric = pheChevronDeg === 60 ? 28.0 : pheChevronDeg === 45 ? 11.5 : 4.8;

    uCalcWm2K = 2200;
    for (let iter = 0; iter < 8; iter++) {
      areaReqM2 = Q_Watts / Math.max(50, uCalcWm2K * cmtdC);
      const targetArea = areaReqM2 * (1 + designMarginPct / 100);
      const effectivePlates = Math.max(6, Math.ceil(targetArea / areaPerPlate));
      // 홀수 판수 정렬로 양측 채널 수 균등화
      phePlateCount = effectivePlates % 2 === 1 ? effectivePlates + 2 : effectivePlates + 3;
      pheChannelsPerSide = Math.max(3, Math.floor((phePlateCount - 1) / 2));
      areaProvM2 = (phePlateCount - 2) * areaPerPlate;

      const chFlowArea = pheChannelsPerSide * phePlateWidthM * bM;
      velTubeMs =
        tubeSide.massFlowKgH / 3600 / Math.max(0.5, tubeSide.densityKgM3) / chFlowArea;
      velShellMs =
        shellSide.massFlowKgH / 3600 / Math.max(0.5, shellSide.densityKgM3) / chFlowArea;

      const calcPheH = (fl: HxSideFluidSummary, vCh: number) => {
        const rho = Math.max(0.5, fl.densityKgM3);
        const mu = Math.max(1e-5, fl.viscosityCp * 1e-3);
        const cpJ = Math.max(500, fl.cpKcalKgC * 4184);
        const k = Math.max(0.015, fl.conductivityWmK);
        const re = (rho * Math.max(0.03, vCh) * dePhe) / mu;
        const pr = Math.max(0.6, (cpJ * mu) / k);
        if (fl.phaseRegime === 'condensing') return { h: 4200, re };
        if (fl.phaseRegime === 'boiling') return { h: 3800, re };
        const nu = chCoeff * Math.pow(Math.max(20, re), chExp) * Math.pow(pr, 0.333);
        return { h: Math.max(220, (nu * k) / dePhe), re };
      };

      const tP = calcPheH(tubeSide, velTubeMs);
      const sP = calcPheH(shellSide, velShellMs);
      hTubeWm2K = tP.h;
      hShellWm2K = sP.h;
      reTube = tP.re;
      reShell = sP.re;

      const invUClean = 1 / hTubeWm2K + rWallPhe + 1 / hShellWm2K;
      uCleanWm2K = 1 / invUClean;
      const invUFouled = invUClean + 0.55 * (rfTubeWm2K + rfShellWm2K);
      uCalcWm2K = 0.5 * uCalcWm2K + 0.5 * (1 / invUFouled);
    }

    areaReqM2 = Q_Watts / Math.max(50, uCalcWm2K * cmtdC);
    phePackLengthMm = Math.round(
      phePlateCount * ((hxCfg.phePlateThickMm ?? 0.6) + pheGapMm)
    );

    const calcPheDpBar = (fl: HxSideFluidSummary, vCh: number, re: number) => {
      const f = kpFric / Math.pow(Math.max(25, re), 0.24);
      const rho = Math.max(0.5, fl.densityKgM3);
      const dpCh = 2 * f * (phePlateLengthM / dePhe) * rho * vCh * vCh;
      const dpPort = 1.4 * 0.5 * rho * Math.pow(Math.min(4.5, vCh * 2.4), 2);
      return (dpCh + dpPort) / 1e5;
    };
    dpTubeBar = calcPheDpBar(tubeSide, velTubeMs, reTube);
    dpShellBar = calcPheDpBar(shellSide, velShellMs, reShell);
    vibRatio = 0; // 판형 열교환기는 튜브 번들 와류 진동 없음
  }

  const actualOverdesignPct =
    areaReqM2 > 0 ? ((areaProvM2 - areaReqM2) / areaReqM2) * 100 : designMarginPct;
  const uCalcKcalM2HC = uCalcWm2K * WM2K_TO_KCAL;

  const dpProcessBar = allocation === 'process_tube' ? dpTubeBar : dpShellBar;
  const dpUtilityBar = allocation === 'process_tube' ? dpShellBar : dpTubeBar;
  const dpProcessKgcm2 = dpProcessBar * 1.01972;
  const dpUtilityKgcm2 = dpUtilityBar * 1.01972;

  // 4개 주 노즐 사이징 (N1/N2 동체측 입출구, N3/N4 관측 입출구)
  const isShellTwoPhaseOrCorrosive =
    shellSide.phaseRegime === 'condensing' ||
    shellSide.phaseRegime === 'boiling' ||
    (allocation === 'process_shell' && (matInfo.isWetCl2 || matInfo.isStrongHcl));
  const isTubeTwoPhaseOrCorrosive =
    tubeSide.phaseRegime === 'condensing' ||
    tubeSide.phaseRegime === 'boiling' ||
    (allocation === 'process_tube' && (matInfo.isWetCl2 || matInfo.isStrongHcl));

  const nozzles: HxNozzleSpec[] = [
    sizeNozzle(
      'N1',
      `${hxKind === 'plate_phe' ? '유로 B' : '동체(Shell)'} 입구 — ${shellSide.roleLabel.split(' ')[0]}`,
      'Shell',
      shellSide.massFlowKgH,
      shellSide.densityKgM3,
      shellSide.phaseRegime === 'sensible_gas' || shellSide.phaseRegime === 'condensing',
      isShellTwoPhaseOrCorrosive
    ),
    sizeNozzle(
      'N2',
      `${hxKind === 'plate_phe' ? '유로 B' : '동체(Shell)'} 출구`,
      'Shell',
      shellSide.massFlowKgH,
      shellSide.phaseRegime === 'condensing' ? Math.max(850, shellSide.densityKgM3) : shellSide.densityKgM3,
      shellSide.phaseRegime === 'sensible_gas' || shellSide.phaseRegime === 'boiling',
      isShellTwoPhaseOrCorrosive
    ),
    sizeNozzle(
      'N3',
      `${hxKind === 'plate_phe' ? '유로 A' : '관측(Tube)'} 입구 — ${tubeSide.roleLabel.split(' ')[0]}`,
      'Tube',
      tubeSide.massFlowKgH,
      tubeSide.densityKgM3,
      tubeSide.phaseRegime === 'sensible_gas' || tubeSide.phaseRegime === 'condensing',
      isTubeTwoPhaseOrCorrosive
    ),
    sizeNozzle(
      'N4',
      `${hxKind === 'plate_phe' ? '유로 A' : '관측(Tube)'} 출구`,
      'Tube',
      tubeSide.massFlowKgH,
      tubeSide.phaseRegime === 'condensing' ? Math.max(850, tubeSide.densityKgM3) : tubeSide.densityKgM3,
      tubeSide.phaseRegime === 'sensible_gas' || tubeSide.phaseRegime === 'boiling',
      isTubeTwoPhaseOrCorrosive
    ),
  ];

  // TEMA RCB-4.6 shell nozzle impingement summary (governing between N1 inlet and N2 outlet)
  const shellNozGov = nozzles[0].rhoV2Pa >= nozzles[1].rhoV2Pa ? nozzles[0] : nozzles[1];
  const topImpingementRequired = Boolean(nozzles[0].impingementRequired || nozzles[1].impingementRequired);
  const topRhoV2LimitPa = shellNozGov.rhoV2LimitPa ?? (isShellTwoPhaseOrCorrosive ? 740 : 2230);
  const topRhoV2Status: 'OK' | 'IMPINGEMENT_REQ' | 'OVERSIZE_NOZZLE' =
    nozzles[0].rhoV2Status === 'OVERSIZE_NOZZLE' || nozzles[1].rhoV2Status === 'OVERSIZE_NOZZLE'
      ? 'OVERSIZE_NOZZLE'
      : topImpingementRequired
        ? 'IMPINGEMENT_REQ'
        : 'OK';

  // 엔지니어링 진단 및 원클릭 보정 제안
  const diagnostics: HxDiagnosticItem[] = [];

  if (minPinchDeltaTC <= 0.5) {
    diagnostics.push({
      level: 'error',
      code: 'TEMP_CROSS_PINCH',
      message: `온도 역전(Pinch ΔT = ${minPinchDeltaTC.toFixed(1)}°C ≤ 0°C)이 발생했습니다. 선택된 유틸리티 온도(${util.inTempC}→${util.outTempC}°C)로는 공정 목표온도(${proc.outTempC.toFixed(1)}°C) 달성이 열역학적으로 불가능합니다. 더 낮은 냉매(칠드워터·브라인·증발냉매) 또는 고온 스팀으로 변경하세요.`,
    });
  } else if (minPinchDeltaTC < 3.5) {
    diagnostics.push({
      level: 'warning',
      code: 'TIGHT_PINCH',
      message: `최소 접근온도(Pinch ΔT = ${minPinchDeltaTC.toFixed(1)}°C)가 3.5°C 미만으로 매우 좁아 전열면적이 급격히 커집니다 (일반 권장 ≥ 5°C).`,
    });
  }

  // 염소·염산·가성소다 안전/부식 인터록
  if (matInfo.isDryCl2 && matCode === 'TI_GR2') {
    diagnostics.push({
      level: 'error',
      code: 'DRY_CL2_TI_FIRE_HAZARD',
      message: `치명적 안전 경고: 수분 ${matInfo.moistureWtPpm.toFixed(0)} ppm 미만의 건조 염소(Dry Cl₂)에 티타늄(Ti Gr.2)을 적용하면 격렬한 발열 자연발화 위험이 있습니다! 저온탄소강(LTCS) 또는 탄소강(CS)으로 즉시 변경하세요.`,
      remedyLabel: '안전 재질(LTCS 저온탄소강)로 즉시 전환',
      remedyPatch: { material: 'LTCS_A334' },
    });
  } else if (matInfo.isWetCl2 && (matCode === 'CS_A179' || matCode === 'LTCS_A334' || matCode === 'SS316L')) {
    diagnostics.push({
      level: 'error',
      code: 'WET_CL2_CORROSION',
      message: `부식 경고: 습염소(Wet Cl₂) 및 염소수 환경에서 탄소강·SS316L은 급격한 전면/공식 부식이 발생합니다. 티타늄(Titanium Gr.2) 적용이 필수입니다.`,
      remedyLabel: '내식 재질(Titanium Gr.2)로 전환',
      remedyPatch: { material: 'TI_GR2' },
    });
  } else if (matInfo.isStrongHcl && (matCode === 'CS_A179' || matCode === 'SS316L' || matCode === 'TI_GR2')) {
    diagnostics.push({
      level: 'error',
      code: 'HCL_ACID_CORROSION',
      message: `부식 경고: 염산(HCl)·염화철 산성 환경에서 선택된 재질(${material.shortLabel})은 수소취성 및 산 부식에 취약합니다. 불침투성 흑연(Graphite) 또는 하스텔로이(C-276)를 권장합니다.`,
      remedyLabel: '불침투성 흑연(Graphite) 재질 적용',
      remedyPatch: { material: 'IMPERVIOUS_GRAPHITE' },
    });
  } else if (matInfo.isHotCaustic && (matCode === 'CS_A179' || matCode === 'SS316L')) {
    diagnostics.push({
      level: 'warning',
      code: 'CAUSTIC_SCC',
      message: `고온(≥58°C)·고농도 가성소다(NaOH) 환경에서 탄소강·오스테나이트 스텐레스는 가성취성(Caustic SCC) 우려가 있습니다. 순니켈(Nickel 200)을 권장합니다.`,
      remedyLabel: '순니켈(Nickel 200) 재질 적용',
      remedyPatch: { material: 'NI_200' },
    });
  }

  if (hxKind === 'shell_tube' && ftFactor < 0.75) {
    const nextShells = Math.min(4, shellCount + 1);
    diagnostics.push({
      level: 'warning',
      code: 'LOW_FT_FACTOR',
      message: `다패스 온도 보정계수 Ft = ${ftFactor.toFixed(3)} (< 0.75)로 열교환 효율 저하 구간입니다. 직렬 동체 수를 ${nextShells}기로 늘리거나 1-패스 대향류 구성을 권장합니다.`,
      remedyLabel: `직렬 동체 ${nextShells}기로 상향`,
      remedyPatch: { shellCount: nextShells },
    });
  }

  if (dpTubeBar > 0.75) {
    const nextPasses = tubePasses > 2 ? ((tubePasses / 2) as 1 | 2 | 4) : 1;
    diagnostics.push({
      level: 'warning',
      code: 'HIGH_TUBE_DP',
      message: `${hxKind === 'plate_phe' ? '유로 A' : '관측(Tube)'} 압력손실이 ${dpTubeBar.toFixed(2)} bar (허용 권장 ≤ 0.70 bar)로 높습니다.`,
      ...(hxKind === 'shell_tube' && tubePasses > 1
        ? {
            remedyLabel: `튜브 패스를 ${nextPasses}패스로 축소`,
            remedyPatch: { tubePasses: nextPasses },
          }
        : hxKind === 'plate_phe' && pheGapMm < 4.5
        ? {
            remedyLabel: '판간격을 4.2 mm로 확대',
            remedyPatch: { pheGapMm: 4.2, pheChevronDeg: 30 },
          }
        : {}),
    });
  }

  if (dpShellBar > 0.75) {
    diagnostics.push({
      level: 'warning',
      code: 'HIGH_SHELL_DP',
      message: `${hxKind === 'plate_phe' ? '유로 B' : '동체측(Shell)'} 압력손실이 ${dpShellBar.toFixed(2)} bar (허용 권장 ≤ 0.70 bar)로 높습니다.`,
      ...(hxKind === 'shell_tube'
        ? {
            remedyLabel: '배플 간격비(0.65) 및 컷율(32%) 확대',
            remedyPatch: { baffleSpacingRatio: 0.65, baffleCutPct: 32 },
          }
        : {}),
    });
  }

  if (hxKind === 'shell_tube' && vibResDetail && vibResDetail.status !== 'ok') {
    diagnostics.push({
      level: vibResDetail.status === 'error' ? 'error' : 'warning',
      code: 'TEMA_VIBRATION_ALERT',
      message: `TEMA 진동 검토 알림: ${vibResDetail.notes.join('; ')}`,
      remedyLabel: '배플 간격 축소 또는 튜브 지지 간격 강화',
      remedyPatch: { baffleSpacingRatio: Math.max(0.2, (hxCfg.baffleSpacingRatio ?? 0.45) * 0.75) },
    });
  } else if (hxKind === 'shell_tube' && vibRatio >= 0.8) {
    diagnostics.push({
      level: 'warning',
      code: 'FIV_VIBRATION_RISK',
      message: `동체측 와류 진동비(f_vs / f_nat = ${vibRatio.toFixed(2)} ≥ 0.80)가 공진 위험 영역입니다. 배플 간격을 줄이거나 외경 25.4 mm 튜브 적용이 필요합니다.`,
      remedyLabel: '튜브 외경 25.4mm & 배플 지지 강화',
      remedyPatch: { tubeOdMm: 25.4, baffleSpacingRatio: 0.32 },
    });
  }

  if (hxKind === 'shell_tube' && bdResDetail && bdResDetail.Jb < 0.68) {
    diagnostics.push({
      level: 'warning',
      code: 'HIGH_BUNDLE_BYPASS',
      message: `동체측 번들 우회 흐름이 큽니다 (우회 보정계수 Jb = ${bdResDetail.Jb.toFixed(2)} < 0.68). 실링 스트립(Sealing Strips) 추가를 권장합니다.`,
      remedyLabel: '실링 스트립 2쌍 적용',
      remedyPatch: { sealingStripPairs: 2 },
    });
  }

  if (hxKind === 'shell_tube' && chfCheckDetail && chfCheckDetail.status !== 'OK') {
    diagnostics.push({
      level: chfCheckDetail.status === 'CRITICAL' ? 'error' : 'warning',
      code: 'CHF_DRYOUT_RISK',
      message: `비등 임계열유속(CHF/Dryout) 주의: q/q_CHF = ${(chfCheckDetail.chfRatio * 100).toFixed(1)}% (열유속 ${(chfCheckDetail.heatFluxWm2 / 1000).toFixed(1)} vs 번들 한계 ${(chfCheckDetail.qChfBundleWm2 / 1000).toFixed(1)} kW/m²) — 전열면적 확대 또는 피치비 상향 검토`,
    });
  }

  if (hxKind === 'shell_tube' && topRhoV2Status === 'OVERSIZE_NOZZLE') {
    diagnostics.push({
      level: 'warning',
      code: 'TEMA_NOZZLE_OVERSIZE',
      message: `동체 노즐 ρv² = ${shellNozGov.rhoV2Pa} Pa > 5950 Pa (TEMA RCB-4.6 한계 초과) — 충격판 설치와 함께 노즐 구경 확대 필요`,
    });
  } else if (hxKind === 'shell_tube' && topRhoV2Status === 'IMPINGEMENT_REQ') {
    diagnostics.push({
      level: 'ok',
      code: 'TEMA_IMPINGEMENT_REQ',
      message: `동체 노즐 ρv² = ${shellNozGov.rhoV2Pa} Pa > ${topRhoV2LimitPa} Pa (TEMA RCB-4.6) — 충격방지판(Impingement Plate) 설치 필수`,
    });
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      level: 'ok',
      code: 'HX_DESIGN_OK',
      message: `열수지 · 핀치 접근온도(ΔT_min = ${minPinchDeltaTC.toFixed(1)}°C) · 수력학 압력손실 · 재질 적합성(${material.shortLabel}) 모두 설계 기준을 만족합니다.`,
    });
  }

  const overallStatus: 'ok' | 'warning' | 'error' = diagnostics.some((d) => d.level === 'error')
    ? 'error'
    : diagnostics.some((d) => d.level === 'warning')
    ? 'warning'
    : 'ok';

  return {
    valid: true,
    hxKind,
    temaType,
    allocation,
    material,
    recommendedMaterial: matInfo.recommended,
    dutyKcalH,
    dutyMcalH,
    dutyKW,
    usrt,
    isHeatingProcess,
    processSide: proc,
    utilitySide: util,
    hotSide,
    coldSide,
    dewPointC: procPack.dewPointC,
    desupDutyMcalH: procPack.desupMcalH,
    latentDutyMcalH: procPack.latentMcalH,
    subcoolDutyMcalH: procPack.subcoolMcalH,
    lmtdCounterC,
    ftFactor,
    cmtdC,
    minPinchDeltaTC,
    tqProfile,
    hTubeWm2K,
    hShellWm2K,
    uCleanWm2K,
    uCalcWm2K,
    uCalcKcalM2HC,
    areaReqM2,
    areaProvM2,
    actualOverdesignPct,
    shellCount,
    tubePasses,
    tubeCountPerShell,
    tubeOdMm,
    tubeIdMm,
    tubeLengthM,
    tubePitchMm,
    pitchAngle,
    bundleDiaMm,
    shellIdMm,
    baffleCutPct,
    baffleSpacingMm,
    baffleCount,
    phePlateCount,
    pheChannelsPerSide,
    pheChevronDeg,
    pheGapMm,
    phePackLengthMm,
    phePlateWidthMm: Math.round(phePlateWidthM * 1000),
    phePlateHeightMm: Math.round(phePlateLengthM * 1000),
    velTubeMs,
    velShellMs,
    reTube,
    reShell,
    dpTubeBar,
    dpShellBar,
    dpProcessKgcm2,
    dpUtilityKgcm2,
    vortexFreqHz,
    naturalFreqHz,
    vibRatio,
    nozzles,
    diagnostics,
    overallStatus,
    designMode: isRatingMode ? 'rating' : 'design',
    shellMethodLabel: hxKind === 'shell_tube' ? 'Bell–Delaware (Taborek)' : 'Kumar (Chevron PHE)',
    tubeMethodLabel:
      hxKind === 'shell_tube'
        ? tubeSide.phaseRegime === 'condensing' || tubeSide.phaseRegime === 'boiling'
          ? 'Friedel (1979) / Shah (1979)'
          : 'Gnielinski / Churchill'
        : 'Kumar (Chevron PHE)',
    bellDelaware: bdResDetail,
    kernCheck: kernCheckDetail,
    vibration: vibResDetail,
    zoneRating: zoneRatingRows,
    dutyCapabilityKW: dutyCapabilityKWVal,
    tubeDpBreakdown: tubeDpBreakdownDetail,
    shellDpBreakdown: shellDpBreakdownDetail,
    chfCheck: chfCheckDetail,
    impingementRequired: topImpingementRequired,
    rhoV2LimitPa: topRhoV2LimitPa,
    rhoV2Status: topRhoV2Status,
  };
}

// ============================================================================
// 범용 화학 반응기 엔진 (Universal Chemical Reactor Suite — W6)
// ----------------------------------------------------------------------------
// 5종 엄밀 반응기 해석 모델:
//   1) 'stoic'       : 다중 반응 양론/전환율 반응기 (비음수 몰수 경계 + 엄밀 엔탈피/VLE 플래시)
//   2) 'equilibrium' : 다중 반응 화학평형 반응기 (Gibbs-Helmholtz ΔG°(T) + 실제기체 φ_i / 액상 γ_i)
//   3) 'gibbs'       : 원소 보존 깁스 자유에너지 최소화 반응기 (Rand / Lagrange 승수 Newton 해법)
//   4) 'cstr'        : 정상상태 다중 반응 연속교반탱크 반응기 (Arrhenius 속도식 + 열매체 UA 결합)
//   5) 'pfr'         : 60-구간 RK4 축방향 적분 관형/충전층 반응기 (벽면 열전달 + Ergun 압력강하)
// ============================================================================

import { MW } from './constants';
import type { SimCompKey } from './flowsheetSolver';
import type { ResolvedPropertyMethod } from './componentCatalog';
import {
  THERMO_DATA,
  KJ_PER_KCAL,
  T_REF_K,
  idealGasCpJmolK,
  idealGasSensibleKJkmol,
  liquidCpJmolK,
  componentMolarEnthalpy,
  streamEnthalpyKcalH,
  phFlash,
} from './thermoCore';
import {
  RIGOROUS_CRIT,
  calcPengRobinsonMixture,
  calcSoaveRedlichKwongMixture,
  solveRigorousFlashVLE,
  liquidActivityCoefficients,
} from './rigorousThermo';
import { dippr101Pa } from './data/pureComponentDatabank';

// ── 공개 타입 정의 (Exact Contract) ─────────────────────────────────────────

export type ReactorModelType = 'stoic' | 'equilibrium' | 'gibbs' | 'cstr' | 'pfr';
export type ReactorThermalMode = 'isothermal' | 'adiabatic' | 'specified_duty' | 'jacket_ua';

export interface StoicReactionSpec {
  id: string;
  name?: string;
  /** Stoichiometric coefficients ν_i (negative for reactants, positive for products) */
  stoic: Partial<Record<SimCompKey, number>>;
  /** For 'stoic': limiting/reference reactant and fractional conversion X in [0, 1] */
  keyComp?: SimCompKey;
  conversion?: number;
  /** Optional user override ln(Keq) = A + B/T_K + C*ln(T_K) + D*T_K */
  keqOverride?: { A: number; B: number; C?: number; D?: number };
  /** Kinetics for CSTR / PFR: r = k0f*exp(-Eaf/RT)*Π C_i^α_i - k0r*exp(-Ear/RT)*Π C_j^β_j [kmol/(m³·s)] */
  k0Forward?: number;
  EaForwardKJmol?: number;
  ordersForward?: Partial<Record<SimCompKey, number>>;
  reversible?: boolean;
  k0Reverse?: number;
  EaReverseKJmol?: number;
  ordersReverse?: Partial<Record<SimCompKey, number>>;
}

export interface ReactorConfig {
  model: ReactorModelType;
  thermalMode: ReactorThermalMode;
  operTempC?: number;
  operPressKgcm2g?: number;
  specifiedDutyKcalH?: number;
  reactions?: StoicReactionSpec[];
  presetId?: string;
  gibbsSpeciesPool?: SimCompKey[];
  gibbsInertSet?: SimCompKey[];
  volumeM3?: number;
  phaseMode?: 'vapor' | 'liquid' | 'vle';
  tubeCount?: number;
  tubeDiamM?: number;
  tubeLengthM?: number;
  jacketTempC?: number;
  overallU_KcalM2HC?: number;
  catalystVoidage?: number;
  particleDiamMm?: number;
  catalystBulkDensityKgM3?: number;
  propertyMethod?: ResolvedPropertyMethod;
}

export interface ReactorAxialPoint {
  zFrac: number;
  lengthM: number;
  volumeM3: number;
  tempC: number;
  pressKgcm2g: number;
  conversion: number;
  totalMolarKmolH: number;
}

export interface ReactorSolveResult {
  converged: boolean;
  iterations: number;
  model: ReactorModelType;
  outletFlowsKgH: Record<SimCompKey, number>;
  vapFlowsKgH: Record<SimCompKey, number>;
  liqFlowsKgH: Record<SimCompKey, number>;
  outletTempC: number;
  outletPressKgcm2g: number;
  pressureDropBar: number;
  heatDutyKcalH: number;
  reactionEnthalpy298KJmol: number[];
  extentsKmolH: number[];
  keyConversions: Record<string, number>;
  atomBalanceMaxRelErr: number;
  massBalanceRelErr: number;
  axialProfile?: ReactorAxialPoint[];
  hotspotTempC?: number;
  equilibriumConstants?: Record<string, number>;
  statusNote: string;
  warnings: string[];
}

// ── 물리 상수 및 전체 성분 키 목록 ───────────────────────────────────────────

const R_J_MOLK = 8.314462618;
const R_BAR_M3_KMOLK = 0.08314462618;

export const ALL_REACTOR_COMPS: SimCompKey[] = Object.keys(THERMO_DATA) as SimCompKey[];

const NONVOLATILE_ELECTROLYTES = new Set<SimCompKey>([
  'NaCl',
  'NaOH',
  'H2SO4',
  'NaOCl',
  'NaClO3',
  'FeCl2',
  'FeCl3',
  'PAC',
]);

export type ElementSymbol = 'C' | 'H' | 'O' | 'N' | 'Cl' | 'S' | 'Na' | 'Fe' | 'Al' | 'Ar';

export const ELEMENT_SYMBOLS: readonly ElementSymbol[] = [
  'C',
  'H',
  'O',
  'N',
  'Cl',
  'S',
  'Na',
  'Fe',
  'Al',
  'Ar',
];

/**
 * 66종 전체 표준 성분의 원소 조성 행렬 (Elemental Composition Matrix)
 */
export const ELEMENT_COMPOSITION: Record<SimCompKey, Partial<Record<ElementSymbol, number>>> = {
  H2O: { H: 2, O: 1 },
  NaCl: { Na: 1, Cl: 1 },
  NaOH: { Na: 1, O: 1, H: 1 },
  Cl2: { Cl: 2 },
  H2: { H: 2 },
  HCl: { H: 1, Cl: 1 },
  H2SO4: { H: 2, S: 1, O: 4 },
  O2: { O: 2 },
  NaOCl: { Na: 1, O: 1, Cl: 1 },
  N2: { N: 2 },
  NaClO3: { Na: 1, Cl: 1, O: 3 },
  FeCl2: { Fe: 1, Cl: 2 },
  FeCl3: { Fe: 1, Cl: 3 },
  PAC: { Al: 2, O: 3, H: 3, Cl: 3 },
  Glycerol: { C: 3, H: 8, O: 3 },
  MCH: { C: 3, H: 7, Cl: 1, O: 2 },
  DCH: { C: 3, H: 6, Cl: 2, O: 1 },
  ECH: { C: 3, H: 5, Cl: 1, O: 1 },
  DCP: { C: 3, H: 6, Cl: 2 },
  CH4: { C: 1, H: 4 },
  CO: { C: 1, O: 1 },
  CO2: { C: 1, O: 2 },
  NH3: { N: 1, H: 3 },
  C2H4: { C: 2, H: 4 },
  C2H6: { C: 2, H: 6 },
  C3H6: { C: 3, H: 6 },
  C3H8: { C: 3, H: 8 },
  nC4H10: { C: 4, H: 10 },
  nC6H14: { C: 6, H: 14 },
  nC7H16: { C: 7, H: 16 },
  Benzene: { C: 6, H: 6 },
  Toluene: { C: 7, H: 8 },
  pXylene: { C: 8, H: 10 },
  MeOH: { C: 1, H: 4, O: 1 },
  EtOH: { C: 2, H: 6, O: 1 },
  IPA: { C: 3, H: 8, O: 1 },
  Acetone: { C: 3, H: 6, O: 1 },
  AceticAcid: { C: 2, H: 4, O: 2 },
  EtOAc: { C: 4, H: 8, O: 2 },
  CHCl3: { C: 1, H: 1, Cl: 3 },
  Ar: { Ar: 1 },
  H2S: { H: 2, S: 1 },
  SO2: { S: 1, O: 2 },
  SO3: { S: 1, O: 3 },
  iC4H10: { C: 4, H: 10 },
  C4H8_1: { C: 4, H: 8 },
  nC5H12: { C: 5, H: 12 },
  nC8H18: { C: 8, H: 18 },
  Cyclohexane: { C: 6, H: 12 },
  Ethylbenzene: { C: 8, H: 10 },
  Styrene: { C: 8, H: 8 },
  Cumene: { C: 9, H: 12 },
  Phenol: { C: 6, H: 6, O: 1 },
  THF: { C: 4, H: 8, O: 1 },
  DMF: { C: 3, H: 7, N: 1, O: 1 },
  DMSO: { C: 2, H: 6, O: 1, S: 1 },
  MTBE: { C: 5, H: 12, O: 1 },
  MEK: { C: 4, H: 8, O: 1 },
  DMC: { C: 3, H: 6, O: 3 },
  EG: { C: 2, H: 6, O: 2 },
  MEA: { C: 2, H: 7, N: 1, O: 1 },
  MDEA: { C: 5, H: 13, N: 1, O: 2 },
  FormicAcid: { C: 1, H: 2, O: 2 },
  HNO3: { H: 1, N: 1, O: 3 },
  CH3Cl: { C: 1, H: 3, Cl: 1 },
  CH2Cl2: { C: 1, H: 2, Cl: 2 },
  CCl4: { C: 1, Cl: 4 },
  C2Cl4: { C: 2, Cl: 4 },
  COCl2: { C: 1, O: 1, Cl: 2 },
  HCHO: { C: 1, H: 2, O: 1 },
  MCB: { C: 6, H: 5, Cl: 1 },
  Aniline: { C: 6, H: 7, N: 1 },
  MDA: { C: 13, H: 14, N: 2 },
  MDI: { C: 15, H: 10, N: 2, O: 2 },
  PMDI: { C: 23, H: 16, N: 3, O: 3 },
  CUSTOM_1: { C: 4, H: 10, O: 1 },
  CUSTOM_2: { C: 6, H: 7, N: 1 },
};

/**
 * 표준 깁스 생성 자유에너지 ΔGf°(298.15 K, 1 bar) [kJ/mol]
 * - dGfIg: 이상기체 기준상태 (NIST WebBook / Perry's 9th Ed. / Smith-Van Ness-Abbott)
 * - dGfLiq: 순수 액체 또는 무한희석 수용액 기준상태 (액상 반응 평형용)
 */
export const GIBBS_FORMATION_298: Record<SimCompKey, { dGfIg: number; dGfLiq?: number }> = {
  H2O: { dGfIg: -228.572, dGfLiq: -237.129 },
  NaCl: { dGfIg: -201.3, dGfLiq: -393.13 },
  NaOH: { dGfIg: -200.5, dGfLiq: -419.15 },
  Cl2: { dGfIg: 0.0, dGfLiq: 4.8 },
  H2: { dGfIg: 0.0 },
  HCl: { dGfIg: -95.299, dGfLiq: -131.228 },
  H2SO4: { dGfIg: -653.4, dGfLiq: -744.53 },
  O2: { dGfIg: 0.0 },
  NaOCl: { dGfIg: -298.7, dGfLiq: -298.7 },
  N2: { dGfIg: 0.0 },
  NaClO3: { dGfIg: -262.3, dGfLiq: -262.3 },
  FeCl2: { dGfIg: -302.3, dGfLiq: -341.0 },
  FeCl3: { dGfIg: -334.0, dGfLiq: -370.0 },
  PAC: { dGfIg: 0.0, dGfLiq: 0.0 },
  Glycerol: { dGfIg: -447.1, dGfLiq: -477.0 },
  MCH: { dGfIg: -335.0, dGfLiq: -358.0 },
  DCH: { dGfIg: -228.0, dGfLiq: -245.0 },
  ECH: { dGfIg: -36.5, dGfLiq: -45.2 },
  DCP: { dGfIg: -83.1, dGfLiq: -88.0 },
  CH4: { dGfIg: -50.53 },
  CO: { dGfIg: -137.168 },
  CO2: { dGfIg: -394.359 },
  NH3: { dGfIg: -16.45 },
  C2H4: { dGfIg: 68.15 },
  C2H6: { dGfIg: -32.84 },
  C3H6: { dGfIg: 62.78 },
  C3H8: { dGfIg: -23.49 },
  nC4H10: { dGfIg: -17.15 },
  nC6H14: { dGfIg: -0.25, dGfLiq: -4.0 },
  nC7H16: { dGfIg: 8.03, dGfLiq: 1.0 },
  Benzene: { dGfIg: 129.66, dGfLiq: 124.5 },
  Toluene: { dGfIg: 122.05, dGfLiq: 113.8 },
  pXylene: { dGfIg: 121.13, dGfLiq: 110.1 },
  MeOH: { dGfIg: -162.32, dGfLiq: -166.6 },
  EtOH: { dGfIg: -168.49, dGfLiq: -174.78 },
  IPA: { dGfIg: -173.39, dGfLiq: -180.3 },
  Acetone: { dGfIg: -153.05, dGfLiq: -155.4 },
  AceticAcid: { dGfIg: -374.2, dGfLiq: -389.9 },
  EtOAc: { dGfIg: -327.4, dGfLiq: -337.66 },
  CHCl3: { dGfIg: -70.34, dGfLiq: -73.7 },
  Ar: { dGfIg: 0.0 },
  H2S: { dGfIg: -33.56 },
  SO2: { dGfIg: -300.194 },
  SO3: { dGfIg: -371.06 },
  iC4H10: { dGfIg: -20.88 },
  C4H8_1: { dGfIg: 71.30, dGfLiq: 73.6 },
  nC5H12: { dGfIg: -8.37, dGfLiq: -9.5 },
  nC8H18: { dGfIg: 16.40, dGfLiq: 6.4 },
  Cyclohexane: { dGfIg: 31.76, dGfLiq: 26.7 },
  Ethylbenzene: { dGfIg: 130.89, dGfLiq: 119.7 },
  Styrene: { dGfIg: 213.80, dGfLiq: 202.4 },
  Cumene: { dGfIg: 137.00, dGfLiq: 124.3 },
  Phenol: { dGfIg: -32.89, dGfLiq: -50.4 },
  THF: { dGfIg: -81.2, dGfLiq: -85.6 },
  DMF: { dGfIg: -88.4, dGfLiq: -96.5 },
  DMSO: { dGfIg: -82.0, dGfLiq: -99.1 },
  MTBE: { dGfIg: -125.4, dGfLiq: -130.2 },
  MEK: { dGfIg: -146.1, dGfLiq: -151.4 },
  DMC: { dGfIg: -463.0, dGfLiq: -471.0 },
  EG: { dGfIg: -304.5, dGfLiq: -323.2 },
  MEA: { dGfIg: -103.5, dGfLiq: -118.0 },
  MDEA: { dGfIg: -214.0, dGfLiq: -235.0 },
  FormicAcid: { dGfIg: -351.0, dGfLiq: -361.4 },
  HNO3: { dGfIg: -73.51, dGfLiq: -111.25 },
  CH3Cl: { dGfIg: -58.5, dGfLiq: -56.2 },
  CH2Cl2: { dGfIg: -68.9, dGfLiq: -70.4 },
  CCl4: { dGfIg: -60.6, dGfLiq: -65.2 },
  C2Cl4: { dGfIg: 18.8, dGfLiq: 13.4 },
  COCl2: { dGfIg: -204.9, dGfLiq: -204.0 },
  HCHO: { dGfIg: -102.5, dGfLiq: -110.0 },
  MCB: { dGfIg: 99.17, dGfLiq: 89.2 },
  Aniline: { dGfIg: 166.7, dGfLiq: 149.1 },
  MDA: { dGfIg: 352.0, dGfLiq: 315.0 },
  MDI: { dGfIg: 48.0, dGfLiq: 22.0 },
  PMDI: { dGfIg: 35.0, dGfLiq: 8.0 },
  CUSTOM_1: { dGfIg: -150.8, dGfLiq: -162.5 },
  CUSTOM_2: { dGfIg: 166.7, dGfLiq: 149.1 },
};

// ── 유틸리티 함수 ───────────────────────────────────────────────────────────

function zeroFlows(): Record<SimCompKey, number> {
  const rec = {} as Record<SimCompKey, number>;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    rec[ALL_REACTOR_COMPS[i]] = 0;
  }
  return rec;
}

function mwOf(comp: SimCompKey): number {
  return (MW as Record<string, number>)[comp] ?? THERMO_DATA[comp]?.mw ?? 50;
}

function kgcm2gToBarA(pKgcm2g: number): number {
  return Math.max(0.01, (pKgcm2g + 1.03323) * 0.980665);
}

function barAToKgcm2g(pBarA: number): number {
  return pBarA / 0.980665 - 1.03323;
}

function sumRecord(rec: Partial<Record<SimCompKey, number>>): number {
  let s = 0;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const v = rec[ALL_REACTOR_COMPS[i]] ?? 0;
    if (v > 0) s += v;
  }
  return s;
}

/**
 * 화학양론식 원소 및 분자량 균형 검증
 */
export function checkStoichiometryBalance(stoic: Partial<Record<SimCompKey, number>>): {
  balanced: boolean;
  mwResidualGmol: number;
  elementResiduals: Record<string, number>;
} {
  const elementResiduals: Record<string, number> = {};
  let mwRes = 0;
  let maxElemAbs = 0;

  for (const sym of ELEMENT_SYMBOLS) {
    let sumElem = 0;
    let used = false;
    for (const [k, nu] of Object.entries(stoic) as [SimCompKey, number][]) {
      if (!nu || !ELEMENT_COMPOSITION[k]) continue;
      const count = ELEMENT_COMPOSITION[k][sym] ?? 0;
      if (count !== 0) {
        used = true;
        sumElem += nu * count;
      }
    }
    if (used || Math.abs(sumElem) > 1e-12) {
      const cleaned = Math.abs(sumElem) < 1e-12 ? 0 : Number(sumElem.toFixed(10));
      elementResiduals[sym] = cleaned;
      if (Math.abs(sumElem) > maxElemAbs) maxElemAbs = Math.abs(sumElem);
    }
  }

  for (const [k, nu] of Object.entries(stoic) as [SimCompKey, number][]) {
    if (!nu) continue;
    mwRes += nu * mwOf(k);
  }

  // 원소 보존이 정확하면 분자량 표 3자리 반올림 오차(≤0.05 g/mol)는 허용
  const balanced = maxElemAbs < 1e-6 && Math.abs(mwRes) < 0.05;
  return {
    balanced,
    mwResidualGmol: Number(mwRes.toFixed(6)),
    elementResiduals,
  };
}

// ── 표준 깁스 에너지 / 반응 엔탈피 / 평형상수 (Gibbs-Helmholtz 엄밀 적분) ──

/**
 * 이상기체 엔트로피 적분 ∫_{298.15}^{T} (Cp_ig / T') dT' [J/(mol·K)]
 */
function idealGasEntropyIntegralJmolK(comp: SimCompKey, T_K: number): number {
  const [a, b, c, d] = THERMO_DATA[comp].cpIg;
  const T0 = T_REF_K;
  const T = Math.max(150, Math.min(1500, T_K));
  let s =
    a * Math.log(T / T0) +
    b * (T - T0) +
    (c / 2) * (T * T - T0 * T0) +
    (d / 3) * (T * T * T - T0 * T0 * T0);
  if (T_K > 1500) {
    const cp1500 = idealGasCpJmolK(comp, 1500);
    s += cp1500 * Math.log(T_K / 1500);
  }
  return s;
}

/**
 * 이상기체 현열 적분 (1500 K 초과 고온 화염 시 경계 Cp 연속 외삽) [J/mol]
 */
function idealGasSensibleExtendedJmol(comp: SimCompKey, T_K: number): number {
  let hJmol = idealGasSensibleKJkmol(comp, T_K); // kJ/kmol === J/mol
  if (T_K > 1500) {
    hJmol += idealGasCpJmolK(comp, 1500) * (T_K - 1500);
  }
  return hJmol;
}

/**
 * 성분 표준 화학퍼텐셜 μ_i°(T) [J/mol]
 * - phase === 'vapor': 이상기체 1 bar 기준상태 (Gibbs-Helmholtz 엄밀 적분)
 * - phase === 'liquid': 순수 액체 / 수용액 기준상태
 */
export function standardSpeciesGibbsJmol(
  comp: SimCompKey,
  T_K: number,
  phase: 'vapor' | 'liquid'
): number {
  const T0 = T_REF_K;
  const T = Math.max(180, Math.min(3500, T_K));
  const gf = GIBBS_FORMATION_298[comp];
  const th = THERMO_DATA[comp];

  if (phase === 'vapor') {
    const dHf0 = th.dHfIg * 1000; // J/mol
    const dGf0 = gf.dGfIg * 1000; // J/mol
    const dSf0 = (dHf0 - dGf0) / T0; // J/(mol·K)
    const dHT = dHf0 + idealGasSensibleExtendedJmol(comp, T);
    const dST = dSf0 + idealGasEntropyIntegralJmolK(comp, T);
    return dHT - T * dST;
  }

  // 액상 기준상태: dGfLiq 우선 사용, 미지정 시 dGfIg + RT0 ln(Psat(T0)/1 bar)
  let dGf0Liq: number;
  if (gf.dGfLiq !== undefined) {
    dGf0Liq = gf.dGfLiq * 1000;
  } else {
    const psatPa = dippr101Pa(comp, T0, true);
    if (Number.isFinite(psatPa) && psatPa > 0) {
      dGf0Liq = gf.dGfIg * 1000 + R_J_MOLK * T0 * Math.log(psatPa / 1e5);
    } else {
      dGf0Liq = gf.dGfIg * 1000;
    }
  }

  const dHf0Liq = componentMolarEnthalpy(comp, 25.0, NONVOLATILE_ELECTROLYTES.has(comp) ? 'AQ' : 'L'); // kJ/kmol === J/mol
  const dSf0Liq = (dHf0Liq - dGf0Liq) / T0;

  // 4점 Gauss-Legendre 구적법으로 ∫ Cp_L dT 및 ∫ (Cp_L / T) dT 적분
  const nodes = [-0.8611363116, -0.3399810436, 0.3399810436, 0.8611363116];
  const weights = [0.3478548451, 0.6521451549, 0.6521451549, 0.3478548451];
  const mid = 0.5 * (T + T0);
  const half = 0.5 * (T - T0);
  let intH = 0;
  let intS = 0;
  for (let q = 0; q < 4; q++) {
    const Tq = mid + half * nodes[q];
    const cpL = liquidCpJmolK(comp, Tq);
    intH += weights[q] * cpL;
    intS += weights[q] * (cpL / Tq);
  }
  intH *= half;
  intS *= half;

  const dHT = dHf0Liq + intH;
  const dST = dSf0Liq + intS;
  return dHT - T * dST;
}

/**
 * 단일 반응의 표준 열역학 물성 계산 (ΔH°298, ΔG°(T), ln Keq(T))
 */
export function calcReactionStdThermo(
  rxn: StoicReactionSpec,
  T_C: number,
  phase: 'vapor' | 'liquid' = 'vapor'
): {
  dH298KJmol: number;
  dGT_KJmol: number;
  lnKeq: number;
  Keq: number;
} {
  const T_K = Math.max(180, T_C + 273.15);
  let dH298Jmol = 0;
  let dGT_Jmol = 0;

  for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
    if (!nu) continue;
    const isElec = NONVOLATILE_ELECTROLYTES.has(k);
    const hPhase = phase === 'vapor' && !isElec ? 'V' : isElec ? 'AQ' : 'L';
    dH298Jmol += nu * componentMolarEnthalpy(k, 25.0, hPhase);
    dGT_Jmol += nu * standardSpeciesGibbsJmol(k, T_K, phase === 'vapor' && !isElec ? 'vapor' : 'liquid');
  }

  let lnKeq: number;
  if (rxn.keqOverride) {
    const { A, B, C = 0, D = 0 } = rxn.keqOverride;
    lnKeq = A + B / T_K + C * Math.log(T_K) + D * T_K;
  } else {
    lnKeq = -dGT_Jmol / (R_J_MOLK * T_K);
  }

  const lnClamped = Math.max(-80, Math.min(80, lnKeq));
  return {
    dH298KJmol: dH298Jmol / 1000,
    dGT_KJmol: dGT_Jmol / 1000,
    lnKeq,
    Keq: Math.exp(lnClamped),
  };
}

// ── 스트림 상평형 플래시 & 고온 연속 엔탈피 래퍼 ───────────────────────────

function flashReactorStream(
  flowsKgH: Record<SimCompKey, number>,
  T_C: number,
  P_kgcm2g: number,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod
): { vap: Record<SimCompKey, number>; liq: Record<SimCompKey, number>; Z_vap: number; betaVap: number } {
  if (phaseMode === 'vapor') {
    const vap = zeroFlows();
    const liq = zeroFlows();
    let vapMol = 0;
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      const m = Math.max(0, flowsKgH[k] ?? 0);
      if (m <= 0) continue;
      if (NONVOLATILE_ELECTROLYTES.has(k)) {
        liq[k] = m;
      } else {
        vap[k] = m;
        vapMol += m / mwOf(k);
      }
    }
    let Z_vap = 1.0;
    if (vapMol > 1e-12) {
      const y = zeroFlows();
      for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
        const k = ALL_REACTOR_COMPS[i];
        if (vap[k] > 0) y[k] = vap[k] / mwOf(k) / vapMol;
      }
      const eos =
        propMethod === 'SRK'
          ? calcSoaveRedlichKwongMixture(y, T_C, P_kgcm2g)
          : calcPengRobinsonMixture(y, T_C, P_kgcm2g);
      Z_vap = eos.Z_vap;
    }
    return { vap, liq, Z_vap, betaVap: 1.0 };
  }

  if (phaseMode === 'liquid') {
    const vap = zeroFlows();
    const liq = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      liq[k] = Math.max(0, flowsKgH[k] ?? 0);
    }
    return { vap, liq, Z_vap: 1.0, betaVap: 0.0 };
  }

  const res = solveRigorousFlashVLE(flowsKgH, T_C, P_kgcm2g, 1.0, undefined, undefined, propMethod);
  return { vap: res.vap, liq: res.liq, Z_vap: res.Z_vap, betaVap: res.betaVapMole };
}

/**
 * streamEnthalpyKcalH 와 1500 K 이하에서 100% 동일하며,
 * 1500 K(1226.85 °C) 초과 고온 연소/버너 운전 시 기상 Cp(1500 K) 선형 외삽을 추가
 */
function reactorEnthalpyKcalH(
  vapKgH: Record<SimCompKey, number>,
  liqKgH: Record<SimCompKey, number>,
  T_C: number,
  P_kgcm2g: number
): number {
  const baseKcalH = streamEnthalpyKcalH(vapKgH, liqKgH, T_C, P_kgcm2g);
  const T_K = T_C + 273.15;
  if (T_K <= 1500) return baseKcalH;

  let extraKJH = 0;
  const dT = T_K - 1500;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    if (NONVOLATILE_ELECTROLYTES.has(k)) continue;
    const m = vapKgH[k] ?? 0;
    if (m <= 0) continue;
    const nKmolH = m / mwOf(k);
    extraKJH += nKmolH * idealGasCpJmolK(k, 1500) * dT;
  }
  return baseKcalH + extraKJH / KJ_PER_KCAL;
}

/**
 * 고정 조성 스트림의 목표 엔탈피 PH 해법 (고온 ~2800 °C 까지 단조 수렴)
 */
function solveOutletTempForTargetEnthalpy(
  flowsKgH: Record<SimCompKey, number>,
  P_kgcm2g: number,
  targetKcalH: number,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod,
  T_guess: number
): { T_C: number; vap: Record<SimCompKey, number>; liq: Record<SimCompKey, number>; iterations: number; converged: boolean } {
  // 1200 °C 이하 구간에서는 thermoCore.phFlash 우선 활용 가능 여부 확인
  const fHighCheck = flashReactorStream(flowsKgH, 1200, P_kgcm2g, phaseMode, propMethod);
  const hAt1200 = reactorEnthalpyKcalH(fHighCheck.vap, fHighCheck.liq, 1200, P_kgcm2g);

  if (targetKcalH <= hAt1200) {
    const ph = phFlash(
      flowsKgH,
      P_kgcm2g,
      targetKcalH,
      (T) => {
        const fl = flashReactorStream(flowsKgH, T, P_kgcm2g, phaseMode, propMethod);
        return { vap: fl.vap, liq: fl.liq };
      },
      {
        T_guess: Math.min(1150, Math.max(-60, T_guess)),
        T_min: -80,
        T_max: 1220,
        tolKcalH: 1e-4,
      }
    );
    return {
      T_C: ph.T_C,
      vap: ph.vap,
      liq: ph.liq,
      iterations: ph.iterations,
      converged: ph.converged,
    };
  }

  // 1200 °C ~ 3200 °C 고온 영역 (예: H2 + Cl2 단열 버너) 이분/할선 결합 해법
  let lo = 1200;
  let hi = 3200;
  let hLo = hAt1200 - targetKcalH;
  let flHi = flashReactorStream(flowsKgH, hi, P_kgcm2g, phaseMode, propMethod);
  let hHi = reactorEnthalpyKcalH(flHi.vap, flHi.liq, hi, P_kgcm2g) - targetKcalH;

  if (hHi < 0) {
    return { T_C: hi, vap: flHi.vap, liq: flHi.liq, iterations: 2, converged: false };
  }

  let T = lo + ((hi - lo) * -hLo) / Math.max(1e-6, hHi - hLo);
  let vap = flHi.vap;
  let liq = flHi.liq;
  let iter = 0;
  for (iter = 1; iter <= 45; iter++) {
    const fl = flashReactorStream(flowsKgH, T, P_kgcm2g, phaseMode, propMethod);
    vap = fl.vap;
    liq = fl.liq;
    const res = reactorEnthalpyKcalH(vap, liq, T, P_kgcm2g) - targetKcalH;
    if (Math.abs(res) < 1e-3 || Math.abs(hi - lo) < 1e-5) {
      return { T_C: T, vap, liq, iterations: iter, converged: true };
    }
    if (res < 0) {
      lo = T;
      hLo = res;
    } else {
      hi = T;
      hHi = res;
    }
    const sec = lo + ((hi - lo) * -hLo) / Math.max(1e-9, hHi - hLo);
    T = sec > lo + 0.05 * (hi - lo) && sec < hi - 0.05 * (hi - lo) ? sec : 0.5 * (lo + hi);
  }
  return { T_C: T, vap, liq, iterations: iter, converged: true };
}

// ── 선형대수 솔버 (가우스 부분 피벗 소거 & 행계수 축소) ──────────────────────

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, idx) => [...row, b[idx]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = r;
      }
    }
    if (maxVal < 1e-15) return null;
    if (maxRow !== col) {
      const tmp = M[col];
      M[col] = M[maxRow];
      M[maxRow] = tmp;
    }
    const piv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / piv;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = sum / M[i][i];
  }
  return x;
}

function reduceFullRowRank(A: number[][], b: number[]): { Ar: number[][]; br: number[] } {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  if (m === 0 || n === 0) return { Ar: [], br: [] };

  const work = A.map((row, i) => [...row, b[i]]);
  const pivotRows: number[] = [];
  let r = 0;

  for (let col = 0; col < n && r < m; col++) {
    let piv = r;
    let maxAbs = Math.abs(work[r][col]);
    for (let i = r + 1; i < m; i++) {
      const v = Math.abs(work[i][col]);
      if (v > maxAbs) {
        maxAbs = v;
        piv = i;
      }
    }
    if (maxAbs < 1e-10) continue;
    if (piv !== r) {
      const tmp = work[r];
      work[r] = work[piv];
      work[piv] = tmp;
    }
    const pv = work[r][col];
    for (let j = col; j <= n; j++) work[r][j] /= pv;
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const f = work[i][col];
      if (Math.abs(f) < 1e-14) continue;
      for (let j = col; j <= n; j++) work[i][j] -= f * work[r][j];
    }
    pivotRows.push(r);
    r++;
  }

  const Ar: number[][] = [];
  const br: number[] = [];
  for (const idx of pivotRows) {
    Ar.push(work[idx].slice(0, n));
    br.push(work[idx][n]);
  }
  return { Ar, br };
}

// ── 액체 몰부피 & 기체/액체 점도 & 부피유량/농도 (CSTR / PFR / Ergun) ───────

function pureLiquidMolarVolumeM3Kmol(comp: SimCompKey, T_K: number): number {
  if (comp === 'H2O') return 0.018068;
  const mw = mwOf(comp);
  if (NONVOLATILE_ELECTROLYTES.has(comp)) return mw / 1850;
  const crit = RIGOROUS_CRIT[comp];
  if (!crit || crit.Tc_K <= 100 || crit.Pc_bar <= 0) return mw / 800;
  const zra = Math.max(0.21, Math.min(0.31, 0.29056 - 0.08775 * crit.omega));
  const tr = Math.min(0.98, Math.max(0.25, T_K / crit.Tc_K));
  const vL_Lmol = ((R_BAR_M3_KMOLK * crit.Tc_K) / crit.Pc_bar) * Math.pow(zra, 1 + Math.pow(1 - tr, 2 / 7));
  return Math.max(mw / 2200, Math.min(mw / 450, vL_Lmol));
}

function calcFluidStateAndConcentrations(
  nKmolH: Record<SimCompKey, number>,
  T_C: number,
  P_barA: number,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod
): {
  concKmolM3: Record<SimCompKey, number>;
  volFlowM3H: number;
  densityKgM3: number;
  viscosityPaS: number;
  effPhase: 'vapor' | 'liquid';
} {
  const T_K = Math.max(200, T_C + 273.15);
  const P_kgcm2g = barAToKgcm2g(P_barA);
  let totMol = 0;
  let totMassKgH = 0;
  let nonElecMol = 0;

  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    const n = Math.max(0, nKmolH[k] ?? 0);
    if (n <= 0) continue;
    totMol += n;
    totMassKgH += n * mwOf(k);
    if (!NONVOLATILE_ELECTROLYTES.has(k)) nonElecMol += n;
  }

  const conc = zeroFlows();
  if (totMol <= 1e-15) {
    return {
      concKmolM3: conc,
      volFlowM3H: 1e-9,
      densityKgM3: 1.0,
      viscosityPaS: 1.8e-5,
      effPhase: phaseMode === 'liquid' ? 'liquid' : 'vapor',
    };
  }

  let effPhase: 'vapor' | 'liquid' = 'vapor';
  if (phaseMode === 'liquid' || nonElecMol <= 1e-12) {
    effPhase = 'liquid';
  } else if (phaseMode === 'vle') {
    const flowsKgH = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      if (nKmolH[k] > 0) flowsKgH[k] = nKmolH[k] * mwOf(k);
    }
    const fl = solveRigorousFlashVLE(flowsKgH, T_C, P_kgcm2g, 1.0, undefined, undefined, propMethod);
    effPhase = fl.betaVapMole >= 0.5 ? 'vapor' : 'liquid';
  }

  if (effPhase === 'vapor') {
    const y = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      if (!NONVOLATILE_ELECTROLYTES.has(k) && nKmolH[k] > 0) {
        y[k] = nKmolH[k] / nonElecMol;
      }
    }
    const eos =
      propMethod === 'SRK'
        ? calcSoaveRedlichKwongMixture(y, T_C, P_kgcm2g, P_barA)
        : calcPengRobinsonMixture(y, T_C, P_kgcm2g, P_barA);
    const Z = Math.max(0.25, Math.min(2.5, eos.Z_vap || 1.0));
    const volFlowM3H = Math.max(1e-12, (nonElecMol * Z * R_BAR_M3_KMOLK * T_K) / Math.max(1e-4, P_barA));

    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      if (nKmolH[k] > 0) conc[k] = nKmolH[k] / volFlowM3H;
    }

    // Lucas 저압 기체 점도 + Herning-Zipperer 혼합 규칙 [Pa·s]
    let numMu = 0;
    let denMu = 0;
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      const yi = y[k];
      if (yi <= 1e-8) continue;
      const crit = RIGOROUS_CRIT[k];
      const mw = mwOf(k);
      const Tc = crit?.Tc_K ?? 300;
      const Pc = crit?.Pc_bar ?? 40;
      const Tr = Math.max(0.3, T_K / Tc);
      // Lucas 대응상태 무차원 점도 ξ·μ [μP] -> Pa·s
      const xi = 0.176 * Math.pow(Tc / (Math.pow(mw, 3) * Math.pow(Pc, 4)), 1 / 6);
      const fp0 =
        0.807 * Math.pow(Tr, 0.618) -
        0.357 * Math.exp(-0.449 * Tr) +
        0.34 * Math.exp(-4.058 * Tr) +
        0.018;
      const muPaS = Math.max(5e-6, Math.min(8e-5, (fp0 / Math.max(1e-6, xi)) * 1e-7));
      const rootM = Math.sqrt(mw);
      numMu += yi * muPaS * rootM;
      denMu += yi * rootM;
    }
    const viscosityPaS = denMu > 0 ? numMu / denMu : 1.8e-5;
    return {
      concKmolM3: conc,
      volFlowM3H,
      densityKgM3: totMassKgH / volFlowM3H,
      viscosityPaS,
      effPhase: 'vapor',
    };
  }

  // 액상 부피유량 및 농도
  let volFlowM3H = 0;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    const n = Math.max(0, nKmolH[k] ?? 0);
    if (n <= 0) continue;
    volFlowM3H += n * pureLiquidMolarVolumeM3Kmol(k, T_K);
  }
  volFlowM3H = Math.max(1e-12, volFlowM3H);
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    if (nKmolH[k] > 0) conc[k] = nKmolH[k] / volFlowM3H;
  }

  // 액상 점도 (Andrade 상관 근사: 25°C ~0.89 mPa·s 기준 온도 의존)
  const viscosityPaS = Math.max(1.2e-4, Math.min(0.02, 2.414e-5 * Math.pow(10, 247.8 / Math.max(160, T_K - 140))));
  return {
    concKmolM3: conc,
    volFlowM3H,
    densityKgM3: totMassKgH / volFlowM3H,
    viscosityPaS,
    effPhase: 'liquid',
  };
}

/**
 * 단일 반응의 Arrhenius 생성속도 r_r [kmol/(m³·s)]
 */
function evalKineticRateKmolM3S(
  rxn: StoicReactionSpec,
  concKmolM3: Record<SimCompKey, number>,
  T_C: number,
  effPhase: 'vapor' | 'liquid'
): number {
  const T_K = Math.max(200, T_C + 273.15);
  const k0f = rxn.k0Forward ?? 0;
  if (k0f <= 0) return 0;

  const EafJmol = (rxn.EaForwardKJmol ?? 0) * 1000;
  const kf = k0f * Math.exp(-EafJmol / (R_J_MOLK * T_K));

  let prodFwd = 1.0;
  const hasCustomFwd = rxn.ordersForward && Object.keys(rxn.ordersForward).length > 0;
  if (hasCustomFwd) {
    for (const [k, alpha] of Object.entries(rxn.ordersForward!) as [SimCompKey, number][]) {
      if (!alpha) continue;
      const c = Math.max(0, concKmolM3[k] ?? 0);
      if (c <= 0 && alpha > 0) {
        prodFwd = 0;
        break;
      }
      prodFwd *= Math.pow(Math.max(1e-30, c), alpha);
    }
  } else {
    for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
      if (!nu || nu >= 0) continue;
      const alpha = -nu;
      const c = Math.max(0, concKmolM3[k] ?? 0);
      if (c <= 0) {
        prodFwd = 0;
        break;
      }
      prodFwd *= Math.pow(c, alpha);
    }
  }

  let rNet = kf * prodFwd;

  if (rxn.reversible) {
    let kr = 0;
    if (rxn.k0Reverse !== undefined && rxn.k0Reverse > 0) {
      const EarJmol = (rxn.EaReverseKJmol ?? 0) * 1000;
      kr = rxn.k0Reverse * Math.exp(-EarJmol / (R_J_MOLK * T_K));
    } else {
      // 열역학 평형상수 Keq(T) 로부터 역반응 속도상수 일관 산출
      const std = calcReactionStdThermo(rxn, T_C, effPhase);
      let deltaNu = 0;
      for (const nu of Object.values(rxn.stoic)) deltaNu += nu ?? 0;
      // 기상 기준: Kc = Kp / (R_bar * T_K)^Δν (1 bar 기준)
      const Kc =
        effPhase === 'vapor'
          ? std.Keq * Math.pow(1.0 / (R_BAR_M3_KMOLK * T_K), deltaNu)
          : std.Keq * Math.pow(55.5, deltaNu);
      kr = kf / Math.max(1e-30, Kc);
    }

    let prodRev = 1.0;
    const hasCustomRev = rxn.ordersReverse && Object.keys(rxn.ordersReverse).length > 0;
    if (hasCustomRev) {
      for (const [k, beta] of Object.entries(rxn.ordersReverse!) as [SimCompKey, number][]) {
        if (!beta) continue;
        const c = Math.max(0, concKmolM3[k] ?? 0);
        if (c <= 0 && beta > 0) {
          prodRev = 0;
          break;
        }
        prodRev *= Math.pow(Math.max(1e-30, c), beta);
      }
    } else {
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (!nu || nu <= 0) continue;
        const c = Math.max(0, concKmolM3[k] ?? 0);
        if (c <= 0) {
          prodRev = 0;
          break;
        }
        prodRev *= Math.pow(c, nu);
      }
    }
    rNet -= kr * prodRev;
  }

  return rNet;
}

// ── 1) 'stoic' 솔버 ─────────────────────────────────────────────────────────

function solveStoicModel(
  nIn: Record<SimCompKey, number>,
  reactions: StoicReactionSpec[],
  warnings: string[]
): { nOut: Record<SimCompKey, number>; extents: number[] } {
  const nCurr = { ...nIn };
  const extents: number[] = [];

  for (let r = 0; r < reactions.length; r++) {
    const rxn = reactions[r];
    const conv = Math.max(0, Math.min(1, rxn.conversion ?? 0.9));

    let key: SimCompKey | undefined = rxn.keyComp;
    if (!key || !(rxn.stoic[key] && rxn.stoic[key]! < 0)) {
      // 한계 반응물 자동 선택
      let minMaxExt = Infinity;
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (!nu || nu >= 0) continue;
        const extLim = (nCurr[k] ?? 0) / -nu;
        if (extLim < minMaxExt) {
          minMaxExt = extLim;
          key = k;
        }
      }
    }

    if (!key || !rxn.stoic[key] || rxn.stoic[key]! >= 0) {
      extents.push(0);
      continue;
    }

    const nuKey = -rxn.stoic[key]!;
    let xi = (conv * (nCurr[key] ?? 0)) / nuKey;

    // 모든 반응물 비음수 경계 확인
    let maxFeasibleXi = Infinity;
    let limitingComp: SimCompKey = key;
    for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
      if (!nu || nu >= 0) continue;
      const avail = (nCurr[k] ?? 0) / -nu;
      if (avail < maxFeasibleXi) {
        maxFeasibleXi = avail;
        limitingComp = k;
      }
    }

    if (xi > maxFeasibleXi + 1e-12) {
      warnings.push(
        `반응 '${rxn.name ?? rxn.id}': 공동 반응물(${limitingComp}) 고갈로 전환 진행도가 ${xi.toFixed(4)} → ${maxFeasibleXi.toFixed(4)} kmol/h 로 제한되었습니다.`
      );
      xi = Math.max(0, maxFeasibleXi);
    }

    for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
      if (!nu) continue;
      nCurr[k] = Math.max(0, (nCurr[k] ?? 0) + nu * xi);
    }
    extents.push(xi);
  }

  return { nOut: nCurr, extents };
}

// ── 2) 'equilibrium' 솔버 (실제기체 φ_i / 액상 γ_i 화학평형) ────────────────

function evalReactionActivitiesAndPhase(
  nVec: Record<SimCompKey, number>,
  T_C: number,
  P_kgcm2g: number,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod,
  participatingComps: SimCompKey[]
): { lnAct: Record<SimCompKey, number>; effPhase: 'vapor' | 'liquid' } {
  const P_barA = kgcm2gToBarA(P_kgcm2g);
  const lnAct = zeroFlows();

  let hasElectrolyte = false;
  for (const k of participatingComps) {
    if (NONVOLATILE_ELECTROLYTES.has(k)) {
      hasElectrolyte = true;
      break;
    }
  }

  let effPhase: 'vapor' | 'liquid' = 'vapor';
  if (phaseMode === 'liquid' || hasElectrolyte) {
    effPhase = 'liquid';
  } else if (phaseMode === 'vle') {
    const flowsKgH = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      if (nVec[k] > 0) flowsKgH[k] = nVec[k] * mwOf(k);
    }
    const fl = solveRigorousFlashVLE(flowsKgH, T_C, P_kgcm2g, 1.0, undefined, undefined, propMethod);
    effPhase = fl.betaVapMole >= 0.25 ? 'vapor' : 'liquid';
  }

  if (effPhase === 'vapor') {
    let totVap = 0;
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      if (!NONVOLATILE_ELECTROLYTES.has(k) && nVec[k] > 0) totVap += nVec[k];
    }
    totVap = Math.max(1e-18, totVap);
    const y = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      if (!NONVOLATILE_ELECTROLYTES.has(k) && nVec[k] > 0) y[k] = nVec[k] / totVap;
    }
    const eos =
      propMethod === 'SRK'
        ? calcSoaveRedlichKwongMixture(y, T_C, P_kgcm2g, P_barA)
        : calcPengRobinsonMixture(y, T_C, P_kgcm2g, P_barA);

    for (const k of participatingComps) {
      const yi = Math.max(1e-30, (nVec[k] ?? 0) / totVap);
      const phi = Math.max(0.02, Math.min(30, eos.phi_vap[k] || 1.0));
      lnAct[k] = Math.log(phi * yi * P_barA);
    }
    return { lnAct, effPhase: 'vapor' };
  }

  // 액상 활동도 a_i = γ_i * x_i
  let totLiq = 0;
  const activeLiq: SimCompKey[] = [];
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    if (nVec[k] > 0) {
      totLiq += nVec[k];
      activeLiq.push(k);
    }
  }
  totLiq = Math.max(1e-18, totLiq);
  const x = zeroFlows();
  for (const k of activeLiq) {
    x[k] = nVec[k] / totLiq;
  }
  const gamma = liquidActivityCoefficients(activeLiq, x, T_C, propMethod);
  for (const k of participatingComps) {
    const xi = Math.max(1e-30, (nVec[k] ?? 0) / totLiq);
    const gi = Math.max(1e-4, Math.min(1e4, gamma[k] || 1.0));
    lnAct[k] = Math.log(gi * xi);
  }
  return { lnAct, effPhase: 'liquid' };
}

function solveEquilibriumAtTemp(
  nIn: Record<SimCompKey, number>,
  reactions: StoicReactionSpec[],
  T_C: number,
  P_kgcm2g: number,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod
): {
  nOut: Record<SimCompKey, number>;
  extents: number[];
  keqMap: Record<string, number>;
  iterations: number;
  converged: boolean;
} {
  const R = reactions.length;
  if (R === 0) {
    return { nOut: { ...nIn }, extents: [], keqMap: {}, iterations: 0, converged: true };
  }

  const partSet = new Set<SimCompKey>();
  for (const rxn of reactions) {
    for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
      if (nu) partSet.add(k);
    }
  }
  const participating = Array.from(partSet);

  let nTotScale = 0;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) nTotScale += nIn[ALL_REACTOR_COMPS[i]] ?? 0;
  nTotScale = Math.max(1e-6, nTotScale);

  // 단일 반응(R = 1) 안전 보장 Newton-Bisection 해법
  if (R === 1) {
    const rxn = reactions[0];
    let xiMin = -Infinity;
    let xiMax = Infinity;
    for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
      if (!nu) continue;
      const n0 = nIn[k] ?? 0;
      if (nu > 0) xiMin = Math.max(xiMin, -n0 / nu);
      if (nu < 0) xiMax = Math.min(xiMax, -n0 / nu);
    }
    if (!Number.isFinite(xiMin) || !Number.isFinite(xiMax) || xiMax - xiMin <= 1e-14 * nTotScale) {
      const xiFixed = Number.isFinite(xiMin) && Number.isFinite(xiMax) ? 0.5 * (xiMin + xiMax) : 0;
      const nOut = { ...nIn };
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu) nOut[k] = Math.max(0, (nIn[k] ?? 0) + nu * xiFixed);
      }
      const std = calcReactionStdThermo(rxn, T_C, phaseMode === 'liquid' ? 'liquid' : 'vapor');
      return { nOut, extents: [xiFixed], keqMap: { [rxn.id]: std.Keq }, iterations: 1, converged: true };
    }

    const span = xiMax - xiMin;
    const eps = 1e-13 * span;
    let lo = xiMin + eps;
    let hi = xiMax - eps;

    const evalG = (xi: number) => {
      const nTest = { ...nIn };
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu) nTest[k] = Math.max(1e-28 * nTotScale, (nIn[k] ?? 0) + nu * xi);
      }
      const { lnAct, effPhase } = evalReactionActivitiesAndPhase(
        nTest,
        T_C,
        P_kgcm2g,
        phaseMode,
        propMethod,
        participating
      );
      const std = calcReactionStdThermo(rxn, T_C, effPhase);
      const lnTarget = Math.max(-34, Math.min(34, std.lnKeq));
      let sumNuLnA = 0;
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu) sumNuLnA += nu * lnAct[k];
      }
      return { g: sumNuLnA - lnTarget, Keq: std.Keq, nTest };
    };

    const gLoRes = evalG(lo);
    if (gLoRes.g >= 0) {
      return { nOut: gLoRes.nTest, extents: [lo], keqMap: { [rxn.id]: gLoRes.Keq }, iterations: 2, converged: true };
    }
    const gHiRes = evalG(hi);
    if (gHiRes.g <= 0) {
      return { nOut: gHiRes.nTest, extents: [hi], keqMap: { [rxn.id]: gHiRes.Keq }, iterations: 2, converged: true };
    }

    let xi = 0.5 * (lo + hi);
    let gLo = gLoRes.g;
    let lastRes = gLoRes;
    let iter = 0;
    for (iter = 1; iter <= 60; iter++) {
      lastRes = evalG(xi);
      const g = lastRes.g;
      if (Math.abs(g) < 1e-9 || Math.abs(hi - lo) < 1e-13 * span) {
        return {
          nOut: lastRes.nTest,
          extents: [xi],
          keqMap: { [rxn.id]: lastRes.Keq },
          iterations: iter,
          converged: true,
        };
      }
      if (g < 0) {
        lo = xi;
        gLo = g;
      } else {
        hi = xi;
      }

      // 해석적 이상부 미분 dg/dξ ≈ Σ ν_i² / n_i 로 빠른 Newton 제안
      let dgIdeal = 0;
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu) dgIdeal += (nu * nu) / Math.max(1e-18, lastRes.nTest[k]);
      }
      const xiNewt = dgIdeal > 0 ? xi - g / dgIdeal : 0.5 * (lo + hi);
      if (xiNewt > lo + 0.02 * (hi - lo) && xiNewt < hi - 0.02 * (hi - lo)) {
        xi = xiNewt;
      } else {
        // False-position / Bisection 혼합
        const xiSec = lo + ((hi - lo) * -gLo) / Math.max(1e-12, (g > 0 ? g : lastRes.g) - gLo);
        xi = xiSec > lo + 0.1 * (hi - lo) && xiSec < hi - 0.1 * (hi - lo) ? xiSec : 0.5 * (lo + hi);
      }
    }

    return {
      nOut: lastRes.nTest,
      extents: [xi],
      keqMap: { [rxn.id]: lastRes.Keq },
      iterations: iter,
      converged: Math.abs(lastRes.g) < 1e-4,
    };
  }

  // 다중 반응(R >= 2) 내부점 감쇠 Newton 해법 (예: SMR + WGS)
  const xi = new Array(R).fill(0);
  const nSeed = { ...nIn };
  const activeMask = new Array(R).fill(true);

  for (let r = 0; r < R; r++) {
    const rxn = reactions[r];
    let rMin = -Infinity;
    let rMax = Infinity;
    for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
      if (!nu) continue;
      const nk = nSeed[k] ?? 0;
      if (nu > 0) rMin = Math.max(rMin, -nk / nu);
      if (nu < 0) rMax = Math.min(rMax, -nk / nu);
    }
    if (!Number.isFinite(rMin) || !Number.isFinite(rMax) || rMax - rMin <= 1e-14 * nTotScale) {
      activeMask[r] = false;
      xi[r] = 0;
      continue;
    }
    xi[r] = rMin + 0.35 * (rMax - rMin);
    for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
      if (nu) nSeed[k] = Math.max(0, (nSeed[k] ?? 0) + nu * xi[r]);
    }
  }

  const buildN = (xiVec: number[]) => {
    const nOut = { ...nIn };
    for (let r = 0; r < R; r++) {
      if (!activeMask[r]) continue;
      for (const [k, nu] of Object.entries(reactions[r].stoic) as [SimCompKey, number][]) {
        if (nu) nOut[k] = (nOut[k] ?? 0) + nu * xiVec[r];
      }
    }
    return nOut;
  };

  let keqMap: Record<string, number> = {};
  const evalResidual = (xiVec: number[]) => {
    const nCurr = buildN(xiVec);
    for (const k of participating) {
      if ((nCurr[k] ?? 0) <= 0) nCurr[k] = 1e-26 * nTotScale;
    }
    const { lnAct, effPhase } = evalReactionActivitiesAndPhase(
      nCurr,
      T_C,
      P_kgcm2g,
      phaseMode,
      propMethod,
      participating
    );
    const g = new Array(R).fill(0);
    const kMap: Record<string, number> = {};
    for (let r = 0; r < R; r++) {
      const std = calcReactionStdThermo(reactions[r], T_C, effPhase);
      kMap[reactions[r].id] = std.Keq;
      if (!activeMask[r]) {
        g[r] = 0;
        continue;
      }
      const lnTarget = Math.max(-34, Math.min(34, std.lnKeq));
      let sumNu = 0;
      for (const [k, nu] of Object.entries(reactions[r].stoic) as [SimCompKey, number][]) {
        if (nu) sumNu += nu * lnAct[k];
      }
      g[r] = sumNu - lnTarget;
    }
    return { g, nCurr, kMap };
  };

  let iter = 0;
  let converged = false;
  let currEval = evalResidual(xi);
  keqMap = currEval.kMap;

  for (iter = 1; iter <= 80; iter++) {
    let maxAbsG = 0;
    for (let r = 0; r < R; r++) {
      if (activeMask[r] && Math.abs(currEval.g[r]) > maxAbsG) maxAbsG = Math.abs(currEval.g[r]);
    }
    if (maxAbsG < 1e-8) {
      converged = true;
      break;
    }

    // 수치 미분 야코비안 + 대각 안정화
    const J: number[][] = Array.from({ length: R }, () => new Array(R).fill(0));
    for (let s = 0; s < R; s++) {
      if (!activeMask[s]) {
        J[s][s] = 1.0;
        continue;
      }
      const hStep = Math.max(1e-9 * nTotScale, 1e-6 * Math.abs(xi[s]));
      const xiPlus = [...xi];
      xiPlus[s] += hStep;
      const nPlus = buildN(xiPlus);
      let validPlus = true;
      for (const k of participating) {
        if ((nPlus[k] ?? 0) <= 1e-24 * nTotScale) {
          validPlus = false;
          break;
        }
      }
      if (validPlus) {
        const evalP = evalResidual(xiPlus);
        for (let r = 0; r < R; r++) {
          J[r][s] = (evalP.g[r] - currEval.g[r]) / hStep;
        }
      } else {
        const xiMinus = [...xi];
        xiMinus[s] -= hStep;
        const evalM = evalResidual(xiMinus);
        for (let r = 0; r < R; r++) {
          J[r][s] = (currEval.g[r] - evalM.g[r]) / hStep;
        }
      }
      J[s][s] += 1e-10;
    }

    const negG = currEval.g.map((v) => -v);
    let dXi = solveLinearSystem(J, negG);
    if (!dXi) {
      // 대칭 양정치 이상부 야코비안 폴백
      const Jid: number[][] = Array.from({ length: R }, () => new Array(R).fill(0));
      for (let r = 0; r < R; r++) {
        if (!activeMask[r]) {
          Jid[r][r] = 1;
          continue;
        }
        for (let s = 0; s < R; s++) {
          if (!activeMask[s]) continue;
          let sum = 0;
          for (const k of participating) {
            const nur = reactions[r].stoic[k] ?? 0;
            const nus = reactions[s].stoic[k] ?? 0;
            if (nur && nus) sum += (nur * nus) / Math.max(1e-18, currEval.nCurr[k]);
          }
          Jid[r][s] = sum + (r === s ? 1e-8 : 0);
        }
      }
      dXi = solveLinearSystem(Jid, negG) ?? negG.map((v) => 0.05 * v);
    }

    // 경계까지의 거리 비율 제한 (Fraction-to-the-Boundary: n_i > 0 유지)
    let alphaMax = 1.0;
    for (const k of participating) {
      let dnK = 0;
      for (let r = 0; r < R; r++) {
        if (activeMask[r]) dnK += (reactions[r].stoic[k] ?? 0) * dXi[r];
      }
      const nkCurr = currEval.nCurr[k] ?? 0;
      if (dnK < 0) {
        const lim = (0.96 * Math.max(0, nkCurr - 1e-15 * nTotScale)) / -dnK;
        if (lim < alphaMax) alphaMax = lim;
      }
    }
    alphaMax = Math.max(1e-6, Math.min(1.0, alphaMax));

    // Armijo 백트래킹 선탐색
    const norm0 = currEval.g.reduce((acc, v) => acc + v * v, 0);
    let alpha = alphaMax;
    let accepted = false;
    for (let ls = 0; ls < 10; ls++) {
      const xiCand = xi.map((v, r) => (activeMask[r] ? v + alpha * dXi![r] : v));
      const candEval = evalResidual(xiCand);
      const normCand = candEval.g.reduce((acc, v) => acc + v * v, 0);
      if (normCand <= (1 - 1e-4 * alpha) * norm0 || ls === 9) {
        for (let r = 0; r < R; r++) xi[r] = xiCand[r];
        currEval = candEval;
        keqMap = candEval.kMap;
        accepted = true;
        break;
      }
      alpha *= 0.5;
    }
    if (!accepted) break;
  }

  const nFinal = buildN(xi);
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    nFinal[k] = Math.max(0, nFinal[k] ?? 0);
  }
  return { nOut: nFinal, extents: xi, keqMap, iterations: iter, converged };
}

// ── 3) 'gibbs' 솔버 (Rand / Lagrange 승수 원소 보존 Gibbs 자유에너지 최소화) ─

function solveGibbsAtTemp(
  nIn: Record<SimCompKey, number>,
  config: ReactorConfig,
  T_C: number,
  P_kgcm2g: number,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod
): { nOut: Record<SimCompKey, number>; iterations: number; converged: boolean } {
  const T_K = Math.max(200, T_C + 273.15);
  const P_barA = kgcm2gToBarA(P_kgcm2g);
  const inertSet = new Set<SimCompKey>(config.gibbsInertSet ?? []);

  // 후보 반응 성분 풀 구성 (유입 성분 + gibbsSpeciesPool + reactions 내 등장 성분)
  const candSet = new Set<SimCompKey>();
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    if ((nIn[k] ?? 0) > 1e-15 && !inertSet.has(k) && k !== 'PAC') {
      candSet.add(k);
    }
  }
  if (config.gibbsSpeciesPool && config.gibbsSpeciesPool.length > 0) {
    for (const k of config.gibbsSpeciesPool) {
      if (!inertSet.has(k) && k !== 'PAC') candSet.add(k);
    }
  } else if (config.reactions && config.reactions.length > 0) {
    for (const rxn of config.reactions) {
      for (const [k, nu] of Object.entries(rxn.stoic) as [SimCompKey, number][]) {
        if (nu && !inertSet.has(k) && k !== 'PAC') candSet.add(k);
      }
    }
  }

  // 비불활성 유입 원소 총량 계산
  const elemTotals: Record<ElementSymbol, number> = {
    C: 0,
    H: 0,
    O: 0,
    N: 0,
    Cl: 0,
    S: 0,
    Na: 0,
    Fe: 0,
    Al: 0,
    Ar: 0,
  };
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    if (inertSet.has(k) || k === 'PAC') continue;
    const nk = nIn[k] ?? 0;
    if (nk <= 1e-16) continue;
    for (const sym of ELEMENT_SYMBOLS) {
      elemTotals[sym] += nk * (ELEMENT_COMPOSITION[k][sym] ?? 0);
    }
  }

  // 유입에 존재하지 않는 원소를 포함한 후보 성분 자동 제외
  const activeSpecies: SimCompKey[] = [];
  for (const k of candSet) {
    const compElems = ELEMENT_COMPOSITION[k];
    let feasible = true;
    let hasAnyElem = false;
    for (const sym of ELEMENT_SYMBOLS) {
      const cnt = compElems[sym] ?? 0;
      if (cnt > 0) {
        hasAnyElem = true;
        if (elemTotals[sym] <= 1e-15) {
          feasible = false;
          break;
        }
      }
    }
    if (feasible && hasAnyElem) activeSpecies.push(k);
  }

  const N = activeSpecies.length;
  if (N <= 1) {
    return { nOut: { ...nIn }, iterations: 0, converged: true };
  }

  // 원소 행렬 구성 및 독립 행 축소 (Full Row Rank 보장)
  const presentElems = ELEMENT_SYMBOLS.filter((sym) => elemTotals[sym] > 1e-15);
  const Araw = presentElems.map((sym) => activeSpecies.map((k) => ELEMENT_COMPOSITION[k][sym] ?? 0));
  const braw = presentElems.map((sym) => elemTotals[sym]);
  const { Ar, br } = reduceFullRowRank(Araw, braw);
  const Re = Ar.length;

  // 화학반응 자유도 (N - Re <= 0 이면 반응 불가)
  if (Re === 0 || N <= Re) {
    return { nOut: { ...nIn }, iterations: 0, converged: true };
  }

  // 동일 상 내 불활성 기체/액체 몰수 합산
  let hasElec = false;
  for (const k of activeSpecies) {
    if (NONVOLATILE_ELECTROLYTES.has(k)) hasElec = true;
  }
  const effPhase: 'vapor' | 'liquid' = phaseMode === 'liquid' || hasElec ? 'liquid' : 'vapor';

  let nInertPhase = 0;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    if (!inertSet.has(k) && k !== 'PAC') continue;
    const nk = nIn[k] ?? 0;
    if (nk <= 0) continue;
    if (effPhase === 'vapor' && !NONVOLATILE_ELECTROLYTES.has(k)) nInertPhase += nk;
    if (effPhase === 'liquid') nInertPhase += nk;
  }

  const bScale = Math.max(1e-9, Math.max(...br.map((v) => Math.abs(v))));
  const seedEps = 1e-3 * (bScale / N);
  const n = activeSpecies.map((k) => Math.max(seedEps, (nIn[k] ?? 0) + 0.02 * seedEps));

  // 무차원 기준 화학퍼텐셜 μ_i° / RT 사전 계산
  const mu0RT = activeSpecies.map(
    (k) => standardSpeciesGibbsJmol(k, T_K, effPhase) / (R_J_MOLK * T_K)
  );

  // 비이상 퓨개시티/활동도 계수 ln(θ_i) (기상: ln(φ_i * P_barA), 액상: ln(γ_i))
  const lnTheta = new Array(N).fill(effPhase === 'vapor' ? Math.log(P_barA) : 0);

  const updateNonIdeality = (nVec: number[], blend = 0.6) => {
    const sumAct = nVec.reduce((s, v) => s + v, 0);
    const nTot = Math.max(1e-18, sumAct + nInertPhase);
    if (effPhase === 'vapor') {
      const y = zeroFlows();
      for (let i = 0; i < N; i++) y[activeSpecies[i]] = nVec[i] / nTot;
      for (const k of inertSet) {
        if (!NONVOLATILE_ELECTROLYTES.has(k) && (nIn[k] ?? 0) > 0) y[k] = nIn[k] / nTot;
      }
      const eos =
        propMethod === 'SRK'
          ? calcSoaveRedlichKwongMixture(y, T_C, P_kgcm2g, P_barA)
          : calcPengRobinsonMixture(y, T_C, P_kgcm2g, P_barA);
      for (let i = 0; i < N; i++) {
        const phi = Math.max(0.02, Math.min(30, eos.phi_vap[activeSpecies[i]] || 1.0));
        const target = Math.log(phi * P_barA);
        lnTheta[i] = (1 - blend) * lnTheta[i] + blend * target;
      }
    } else {
      const x = zeroFlows();
      const liqKeys: SimCompKey[] = [...activeSpecies];
      for (let i = 0; i < N; i++) x[activeSpecies[i]] = nVec[i] / nTot;
      for (const k of inertSet) {
        if ((nIn[k] ?? 0) > 0) {
          x[k] = nIn[k] / nTot;
          liqKeys.push(k);
        }
      }
      const gamma = liquidActivityCoefficients(liqKeys, x, T_C, propMethod);
      for (let i = 0; i < N; i++) {
        const gi = Math.max(1e-4, Math.min(1e4, gamma[activeSpecies[i]] || 1.0));
        const target = Math.log(gi);
        lnTheta[i] = (1 - blend) * lnTheta[i] + blend * target;
      }
    }
  };

  updateNonIdeality(n, 1.0);

  let iter = 0;
  let converged = false;
  let psi = new Array(Re).fill(0);

  for (iter = 1; iter <= 120; iter++) {
    if (iter <= 20 || iter % 2 === 0) {
      updateNonIdeality(n, iter < 8 ? 0.8 : 0.5);
    }

    const sumAct = n.reduce((s, v) => s + v, 0);
    const nTot = Math.max(1e-18, sumAct + nInertPhase);
    const muHat = new Array(N);
    for (let i = 0; i < N; i++) {
      muHat[i] = mu0RT[i] + Math.log(Math.max(1e-35, n[i] / nTot)) + lnTheta[i];
    }

    // 원소 잔차 r_k = b_k - Σ A_{k,i} n_i
    const elemRes = new Array(Re).fill(0);
    let maxElemRel = 0;
    for (let k = 0; k < Re; k++) {
      let sumAn = 0;
      for (let i = 0; i < N; i++) sumAn += Ar[k][i] * n[i];
      elemRes[k] = br[k] - sumAn;
      const rel = Math.abs(elemRes[k]) / Math.max(1e-12, Math.abs(br[k]), bScale);
      if (rel > maxElemRel) maxElemRel = rel;
    }

    // Rand (Re + 1) x (Re + 1) 선형 시스템 구성
    const dim = Re + 1;
    const KKT: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
    const rhs = new Array(dim).fill(0);

    for (let k = 0; k < Re; k++) {
      for (let e = 0; e < Re; e++) {
        let mke = 0;
        for (let i = 0; i < N; i++) mke += Ar[k][i] * Ar[e][i] * n[i];
        KKT[k][e] = mke + (k === e ? 1e-14 * bScale : 0);
      }
      let ck = 0;
      let sumAMu = 0;
      for (let i = 0; i < N; i++) {
        ck += Ar[k][i] * n[i];
        sumAMu += Ar[k][i] * n[i] * muHat[i];
      }
      KKT[k][Re] = ck;
      KKT[Re][k] = ck;
      rhs[k] = elemRes[k] + sumAMu;
    }

    KKT[Re][Re] = sumAct - nTot; // -nInertPhase
    let sumNMu = 0;
    for (let i = 0; i < N; i++) sumNMu += n[i] * muHat[i];
    rhs[Re] = sumNMu;

    const sol = solveLinearSystem(KKT, rhs);
    if (!sol) break;

    psi = sol.slice(0, Re);
    const u = sol[Re];

    const dn = new Array(N).fill(0);
    let maxKktErr = 0;
    for (let i = 0; i < N; i++) {
      let aPsi = 0;
      for (let e = 0; e < Re; e++) aPsi += Ar[e][i] * psi[e];
      const grad = aPsi + u - muHat[i];
      dn[i] = n[i] * grad;
      if (n[i] > 1e-11 * nTot && Math.abs(grad) > maxKktErr) {
        maxKktErr = Math.abs(grad);
      }
    }

    if (maxElemRel < 1e-11 && maxKktErr < 1e-8 && iter >= 4) {
      converged = true;
      break;
    }

    // NASA CEA 스타일 스텝 제어 (로그 점프 제한 + 비음수 보장)
    let lambda = 1.0;
    for (let i = 0; i < N; i++) {
      if (dn[i] < 0) {
        const fracLim = (0.92 * n[i]) / -dn[i];
        const logLim = (0.86466 * n[i]) / -dn[i]; // |Δln n| <= 2
        const lim = maxElemRel < 1e-5 && maxKktErr < 1e-2 ? fracLim : Math.min(fracLim, logLim);
        if (lim < lambda) lambda = lim;
      } else if (dn[i] > 0 && n[i] < 1e-7 * nTot) {
        const upLim = (5.0 * Math.max(n[i], 1e-12 * nTot)) / dn[i];
        if (upLim < lambda) lambda = upLim;
      }
    }
    lambda = Math.max(1e-4, Math.min(1.0, lambda));

    const floorN = 1e-20 * bScale;
    for (let i = 0; i < N; i++) {
      n[i] = Math.max(floorN, n[i] + lambda * dn[i]);
    }
  }

  // 최종 가중 최소제곱 원소 보존 정밀 투영 (||Ar*n - br|| < 1e-15 보장)
  for (let proj = 0; proj < 3; proj++) {
    const rVec = new Array(Re).fill(0);
    let maxR = 0;
    for (let k = 0; k < Re; k++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += Ar[k][i] * n[i];
      rVec[k] = br[k] - s;
      if (Math.abs(rVec[k]) > maxR) maxR = Math.abs(rVec[k]);
    }
    if (maxR < 1e-15 * bScale) break;
    const M: number[][] = Array.from({ length: Re }, () => new Array(Re).fill(0));
    for (let k = 0; k < Re; k++) {
      for (let e = 0; e < Re; e++) {
        let s = 0;
        for (let i = 0; i < N; i++) s += Ar[k][i] * Ar[e][i] * n[i];
        M[k][e] = s;
      }
    }
    const mult = solveLinearSystem(M, rVec);
    if (!mult) break;
    let minNext = Infinity;
    const nCand = [...n];
    for (let i = 0; i < N; i++) {
      let corr = 0;
      for (let e = 0; e < Re; e++) corr += Ar[e][i] * mult[e];
      nCand[i] = n[i] + n[i] * corr;
      if (nCand[i] < minNext) minNext = nCand[i];
    }
    if (minNext >= -1e-16 * bScale) {
      for (let i = 0; i < N; i++) n[i] = Math.max(0, nCand[i]);
    } else {
      break;
    }
  }

  const nOut = { ...nIn };
  for (let i = 0; i < N; i++) {
    nOut[activeSpecies[i]] = n[i] < 1e-18 * bScale ? 0 : n[i];
  }
  return { nOut, iterations: iter, converged };
}

// ── 'equilibrium' / 'gibbs' 비등온 외측 열수지 루프 ─────────────────────────

function solveReactiveThermalOuterLoop(
  evalChemistryAtT: (T_C: number) => {
    nOut: Record<SimCompKey, number>;
    extents: number[];
    keqMap: Record<string, number>;
    iterations: number;
    converged: boolean;
  },
  H_inKcalH: number,
  Q_specKcalH: number,
  P_outKgcm2g: number,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod,
  T_guess: number
): {
  T_outC: number;
  nOut: Record<SimCompKey, number>;
  vap: Record<SimCompKey, number>;
  liq: Record<SimCompKey, number>;
  extents: number[];
  keqMap: Record<string, number>;
  iterations: number;
  converged: boolean;
} {
  const targetH = H_inKcalH + Q_specKcalH;
  let totalIters = 0;

  const evalPsi = (T_C: number) => {
    const chem = evalChemistryAtT(T_C);
    totalIters += Math.max(1, chem.iterations);
    const flows = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      if (chem.nOut[k] > 0) flows[k] = chem.nOut[k] * mwOf(k);
    }
    const fl = flashReactorStream(flows, T_C, P_outKgcm2g, phaseMode, propMethod);
    const hOut = reactorEnthalpyKcalH(fl.vap, fl.liq, T_C, P_outKgcm2g);
    return { psi: hOut - targetH, chem, vap: fl.vap, liq: fl.liq };
  };

  // 먼저 초기 추정 온도 주변 좁은 구간 브래킷 탐색 후 필요 시 확장
  let lo = Math.max(-60, T_guess - 250);
  let hi = Math.min(2600, T_guess + 450);
  let resLo = evalPsi(lo);
  while (resLo.psi > 0 && lo > -60) {
    hi = lo;
    lo = Math.max(-60, lo - 300);
    resLo = evalPsi(lo);
    if (lo <= -60) break;
  }
  let resHi = evalPsi(hi);
  while (resHi.psi < 0 && hi < 2800) {
    lo = hi;
    resLo = resHi;
    hi = Math.min(2800, hi + 500);
    resHi = evalPsi(hi);
    if (hi >= 2800) break;
  }

  if (resLo.psi >= 0) {
    return {
      T_outC: lo,
      nOut: resLo.chem.nOut,
      vap: resLo.vap,
      liq: resLo.liq,
      extents: resLo.chem.extents,
      keqMap: resLo.chem.keqMap,
      iterations: totalIters,
      converged: Math.abs(resLo.psi) < 1.0,
    };
  }
  if (resHi.psi <= 0) {
    return {
      T_outC: hi,
      nOut: resHi.chem.nOut,
      vap: resHi.vap,
      liq: resHi.liq,
      extents: resHi.chem.extents,
      keqMap: resHi.chem.keqMap,
      iterations: totalIters,
      converged: Math.abs(resHi.psi) < 1.0,
    };
  }

  let T = lo + ((hi - lo) * -resLo.psi) / Math.max(1e-6, resHi.psi - resLo.psi);
  let best = resLo;
  const tolKcal = Math.max(1e-3, 1e-6 * Math.abs(targetH));

  for (let outIter = 1; outIter <= 35; outIter++) {
    best = evalPsi(T);
    if (Math.abs(best.psi) <= tolKcal || Math.abs(hi - lo) < 1e-4) {
      return {
        T_outC: T,
        nOut: best.chem.nOut,
        vap: best.vap,
        liq: best.liq,
        extents: best.chem.extents,
        keqMap: best.chem.keqMap,
        iterations: totalIters,
        converged: best.chem.converged,
      };
    }
    if (best.psi < 0) {
      lo = T;
      resLo = best;
    } else {
      hi = T;
      resHi = best;
    }
    const sec = lo + ((hi - lo) * -resLo.psi) / Math.max(1e-9, resHi.psi - resLo.psi);
    T = sec > lo + 0.08 * (hi - lo) && sec < hi - 0.08 * (hi - lo) ? sec : 0.5 * (lo + hi);
  }

  return {
    T_outC: T,
    nOut: best.chem.nOut,
    vap: best.vap,
    liq: best.liq,
    extents: best.chem.extents,
    keqMap: best.chem.keqMap,
    iterations: totalIters,
    converged: Math.abs(best.psi) <= 0.1,
  };
}

// ── 반응기 기하 치수 및 전열면적 산정 도우미 ─────────────────────────────────

function resolveReactorGeometry(config: ReactorConfig): {
  volumeM3: number;
  lengthM: number;
  diamM: number;
  tubeCount: number;
  flowAreaM2: number;
  heatTransferAreaM2: number;
} {
  const tubeCount = Math.max(1, Math.round(config.tubeCount ?? 1));
  const hasTubeDims = (config.tubeDiamM ?? 0) > 0 && (config.tubeLengthM ?? 0) > 0;

  if (hasTubeDims) {
    const D = config.tubeDiamM!;
    const L = config.tubeLengthM!;
    const area1 = (Math.PI / 4) * D * D;
    const flowAreaM2 = tubeCount * area1;
    const geomVol = flowAreaM2 * L;
    const volumeM3 = (config.volumeM3 ?? 0) > 0 ? config.volumeM3! : geomVol;
    const effL = volumeM3 / Math.max(1e-9, flowAreaM2);
    const heatTransferAreaM2 = tubeCount * Math.PI * D * effL;
    return { volumeM3, lengthM: effL, diamM: D, tubeCount, flowAreaM2, heatTransferAreaM2 };
  }

  const volumeM3 = Math.max(1e-4, config.volumeM3 ?? 2.0);
  if ((config.tubeDiamM ?? 0) > 0) {
    const D = config.tubeDiamM!;
    const flowAreaM2 = tubeCount * (Math.PI / 4) * D * D;
    const L = volumeM3 / Math.max(1e-9, flowAreaM2);
    const heatTransferAreaM2 = tubeCount * Math.PI * D * L;
    return { volumeM3, lengthM: L, diamM: D, tubeCount, flowAreaM2, heatTransferAreaM2 };
  }

  // 기본 원통형 용기/관 치수 (PFR: L/D = 5, CSTR: L/D = 2)
  const ldRatio = config.model === 'pfr' ? 5.0 : 2.0;
  const volPerTube = volumeM3 / tubeCount;
  const D = Math.pow((4 * volPerTube) / (Math.PI * ldRatio), 1 / 3);
  const L = ldRatio * D;
  const flowAreaM2 = tubeCount * (Math.PI / 4) * D * D;
  const heatTransferAreaM2 = tubeCount * Math.PI * D * L;
  return { volumeM3, lengthM: L, diamM: D, tubeCount, flowAreaM2, heatTransferAreaM2 };
}

// ── 4) 'cstr' 솔버 (연속교반탱크 반응기: Homotopy τ = 0 → τ_full + Damped Newton) ─

function solveCstrModel(
  nIn: Record<SimCompKey, number>,
  H_inKcalH: number,
  T_inC: number,
  P_outKgcm2g: number,
  config: ReactorConfig,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod
): {
  nOut: Record<SimCompKey, number>;
  T_outC: number;
  vap: Record<SimCompKey, number>;
  liq: Record<SimCompKey, number>;
  extents: number[];
  heatDutyKcalH: number;
  iterations: number;
  converged: boolean;
} {
  const reactions = config.reactions ?? [];
  const R = reactions.length;
  const geom = resolveReactorGeometry(config);
  const V_full = geom.volumeM3;
  const P_barA = kgcm2gToBarA(P_outKgcm2g);
  const thermalMode = config.thermalMode;

  let nScale = 0;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) nScale += nIn[ALL_REACTOR_COMPS[i]] ?? 0;
  nScale = Math.max(1e-6, nScale);

  if (R === 0) {
    const T_out = thermalMode === 'isothermal' ? (config.operTempC ?? T_inC) : T_inC;
    const flows = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      flows[k] = (nIn[k] ?? 0) * mwOf(k);
    }
    const fl = flashReactorStream(flows, T_out, P_outKgcm2g, phaseMode, propMethod);
    const hOut = reactorEnthalpyKcalH(fl.vap, fl.liq, T_out, P_outKgcm2g);
    return {
      nOut: { ...nIn },
      T_outC: T_out,
      vap: fl.vap,
      liq: fl.liq,
      extents: [],
      heatDutyKcalH: hOut - H_inKcalH,
      iterations: 1,
      converged: true,
    };
  }

  // 주어진 온도 T_C 와 유효 부피 V_step 에서 반응 진행도 ξ (R 차원) 해법
  const solveExtentsAtTemp = (T_C: number, V_step: number, xiSeed: number[]) => {
    const xi = [...xiSeed];

    const buildN = (xiVec: number[]) => {
      const nOut = { ...nIn };
      for (let r = 0; r < R; r++) {
        for (const [k, nu] of Object.entries(reactions[r].stoic) as [SimCompKey, number][]) {
          if (nu) nOut[k] = (nOut[k] ?? 0) + nu * xiVec[r];
        }
      }
      return nOut;
    };

    const evalF = (xiVec: number[]) => {
      const nCurr = buildN(xiVec);
      for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
        const k = ALL_REACTOR_COMPS[i];
        if (nCurr[k] < 0) nCurr[k] = 0;
      }
      const flState = calcFluidStateAndConcentrations(nCurr, T_C, P_barA, phaseMode, propMethod);
      const f = new Array(R).fill(0);
      for (let r = 0; r < R; r++) {
        const rate = evalKineticRateKmolM3S(reactions[r], flState.concKmolM3, T_C, flState.effPhase);
        f[r] = xiVec[r] - 3600 * V_step * rate;
      }
      return { f, nCurr };
    };

    let evalCurr = evalF(xi);
    let it = 0;
    let ok = false;

    for (it = 1; it <= 50; it++) {
      let maxErr = 0;
      for (let r = 0; r < R; r++) {
        if (Math.abs(evalCurr.f[r]) > maxErr) maxErr = Math.abs(evalCurr.f[r]);
      }
      if (maxErr < 1e-10 * nScale) {
        ok = true;
        break;
      }

      const J: number[][] = Array.from({ length: R }, () => new Array(R).fill(0));
      for (let s = 0; s < R; s++) {
        const h = Math.max(1e-9 * nScale, 1e-6 * Math.abs(xi[s]));
        const xiP = [...xi];
        xiP[s] += h;
        const evP = evalF(xiP);
        for (let r = 0; r < R; r++) {
          J[r][s] = (evP.f[r] - evalCurr.f[r]) / h;
        }
        J[s][s] += 1e-12;
      }

      const dXi = solveLinearSystem(
        J,
        evalCurr.f.map((v) => -v)
      );
      if (!dXi) break;

      // 모든 성분의 비음수 경계 조건 유지
      let alphaMax = 1.0;
      for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
        const k = ALL_REACTOR_COMPS[i];
        let dnK = 0;
        for (let r = 0; r < R; r++) dnK += (reactions[r].stoic[k] ?? 0) * dXi[r];
        if (dnK < -1e-18) {
          const nk = Math.max(0, evalCurr.nCurr[k] ?? 0);
          const lim = nk > 1e-14 * nScale ? (0.98 * nk) / -dnK : 0.0;
          if (lim > 0 && lim < alphaMax) alphaMax = lim;
        }
      }
      alphaMax = Math.max(1e-5, Math.min(1.0, alphaMax));

      const norm0 = evalCurr.f.reduce((s, v) => s + v * v, 0);
      let alpha = alphaMax;
      for (let ls = 0; ls < 8; ls++) {
        const xiCand = xi.map((v, r) => v + alpha * dXi[r]);
        const nTest = buildN(xiCand);
        let minComp = 0;
        for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
          const v = nTest[ALL_REACTOR_COMPS[i]];
          if (v < minComp) minComp = v;
        }
        if (minComp < -1e-11 * nScale && ls < 7) {
          alpha *= 0.5;
          continue;
        }
        const evCand = evalF(xiCand);
        const normCand = evCand.f.reduce((s, v) => s + v * v, 0);
        if (normCand <= (1 - 1e-4 * alpha) * norm0 || ls === 7) {
          for (let r = 0; r < R; r++) xi[r] = xiCand[r];
          evalCurr = evCand;
          break;
        }
        alpha *= 0.5;
      }
    }

    return { xi, nOut: evalCurr.nCurr, iterations: it, converged: ok || Math.max(...evalCurr.f.map(Math.abs)) < 1e-6 * nScale };
  };

  // τ = 0 → τ_full 연속법 (Homotopy continuation)
  const homotopySteps = [0.05, 0.25, 0.6, 1.0];
  let totalIters = 0;

  if (thermalMode === 'isothermal') {
    const T_oper = config.operTempC ?? T_inC;
    let xiSeed = new Array(R).fill(0);
    let last = { xi: xiSeed, nOut: { ...nIn }, iterations: 0, converged: true };
    for (const eta of homotopySteps) {
      last = solveExtentsAtTemp(T_oper, eta * V_full, xiSeed);
      xiSeed = last.xi;
      totalIters += last.iterations;
    }
    const flows = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      flows[k] = Math.max(0, last.nOut[k] ?? 0) * mwOf(k);
    }
    const fl = flashReactorStream(flows, T_oper, P_outKgcm2g, phaseMode, propMethod);
    const hOut = reactorEnthalpyKcalH(fl.vap, fl.liq, T_oper, P_outKgcm2g);
    return {
      nOut: last.nOut,
      T_outC: T_oper,
      vap: fl.vap,
      liq: fl.liq,
      extents: last.xi,
      heatDutyKcalH: hOut - H_inKcalH,
      iterations: totalIters,
      converged: last.converged,
    };
  }

  // 비등온 CSTR (adiabatic / specified_duty / jacket_ua): 에너지 수지 결합 근 탐색
  const UA_KcalHC = (config.overallU_KcalM2HC ?? 250) * geom.heatTransferAreaM2;
  const T_jacket = config.jacketTempC ?? T_inC;
  const Q_spec = thermalMode === 'adiabatic' ? 0 : (config.specifiedDutyKcalH ?? 0);

  const evalEnergyResidual = (T_C: number) => {
    let xiSeed = new Array(R).fill(0);
    let inner = { xi: xiSeed, nOut: { ...nIn }, iterations: 0, converged: true };
    for (const eta of [0.2, 1.0]) {
      inner = solveExtentsAtTemp(T_C, eta * V_full, xiSeed);
      xiSeed = inner.xi;
      totalIters += inner.iterations;
    }
    const flows = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      flows[k] = Math.max(0, inner.nOut[k] ?? 0) * mwOf(k);
    }
    const fl = flashReactorStream(flows, T_C, P_outKgcm2g, phaseMode, propMethod);
    const hOut = reactorEnthalpyKcalH(fl.vap, fl.liq, T_C, P_outKgcm2g);
    const qTransferred = thermalMode === 'jacket_ua' ? UA_KcalHC * (T_jacket - T_C) : Q_spec;
    const psi = hOut - (H_inKcalH + qTransferred);
    return { psi, inner, vap: fl.vap, liq: fl.liq, qTransferred };
  };

  // 다중 정상상태 가능성을 고려하여 T_in 근처에서 연속 스캔 후 이분/할선 수렴
  let lo = Math.max(-50, Math.min(T_inC, T_jacket) - 120);
  let hi = Math.min(2200, Math.max(T_inC, T_jacket) + 600);
  let rLo = evalEnergyResidual(lo);
  let rHi = evalEnergyResidual(hi);
  if (rLo.psi * rHi.psi > 0) {
    hi = 2500;
    rHi = evalEnergyResidual(hi);
  }

  let T = 0.5 * (lo + hi);
  if (rLo.psi < 0 && rHi.psi > 0) {
    T = lo + ((hi - lo) * -rLo.psi) / Math.max(1e-6, rHi.psi - rLo.psi);
  }
  let best = rLo;
  for (let k = 1; k <= 35; k++) {
    best = evalEnergyResidual(T);
    if (Math.abs(best.psi) < 1e-2 || Math.abs(hi - lo) < 1e-4) {
      return {
        nOut: best.inner.nOut,
        T_outC: T,
        vap: best.vap,
        liq: best.liq,
        extents: best.inner.xi,
        heatDutyKcalH: best.qTransferred,
        iterations: totalIters,
        converged: best.inner.converged,
      };
    }
    if (best.psi < 0) {
      lo = T;
      rLo = best;
    } else {
      hi = T;
      rHi = best;
    }
    const sec = lo + ((hi - lo) * -rLo.psi) / Math.max(1e-9, rHi.psi - rLo.psi);
    T = sec > lo + 0.1 * (hi - lo) && sec < hi - 0.1 * (hi - lo) ? sec : 0.5 * (lo + hi);
  }

  return {
    nOut: best.inner.nOut,
    T_outC: T,
    vap: best.vap,
    liq: best.liq,
    extents: best.inner.xi,
    heatDutyKcalH: best.qTransferred,
    iterations: totalIters,
    converged: Math.abs(best.psi) < 1.0,
  };
}

// ── 5) 'pfr' 솔버 (60-구간 RK4 적분 + 다관식 열전달 + Ergun 압력강하) ────────

function solvePfrModel(
  nIn: Record<SimCompKey, number>,
  H_inKcalH: number,
  T_inC: number,
  P_inKgcm2g: number,
  config: ReactorConfig,
  phaseMode: 'vapor' | 'liquid' | 'vle',
  propMethod: ResolvedPropertyMethod,
  warnings: string[]
): {
  nOut: Record<SimCompKey, number>;
  T_outC: number;
  P_outKgcm2g: number;
  pressureDropBar: number;
  vap: Record<SimCompKey, number>;
  liq: Record<SimCompKey, number>;
  extents: number[];
  heatDutyKcalH: number;
  axialProfile: ReactorAxialPoint[];
  hotspotTempC: number;
  iterations: number;
  converged: boolean;
} {
  const reactions = config.reactions ?? [];
  const R = reactions.length;
  const geom = resolveReactorGeometry(config);
  const V_tot = geom.volumeM3;
  const L_tot = geom.lengthM;
  const Ac = geom.flowAreaM2;
  const D_tube = geom.diamM;
  const N_STEPS = 60;
  const dV = V_tot / N_STEPS;

  const thermalMode = config.thermalMode;
  const T_start = thermalMode === 'isothermal' ? (config.operTempC ?? T_inC) : T_inC;
  const P_inBarA = kgcm2gToBarA(config.operPressKgcm2g ?? P_inKgcm2g);
  const minPBarA = Math.max(0.15, 0.12 * P_inBarA);

  const hasErgun = (config.particleDiamMm ?? 0) > 0;
  const dpM = Math.max(1e-4, (config.particleDiamMm ?? 5) * 1e-3);
  const eps = Math.max(0.15, Math.min(0.95, config.catalystVoidage ?? 0.4));

  const U_kcal = config.overallU_KcalM2HC ?? 200;
  const T_jacket = config.jacketTempC ?? T_inC;
  const Q_specKJH = (config.specifiedDutyKcalH ?? 0) * KJ_PER_KCAL;

  // 전환율 프로파일 추적용 기준 성분 선정
  let refComp: SimCompKey | undefined = reactions[0]?.keyComp;
  if (!refComp && R > 0) {
    for (const [k, nu] of Object.entries(reactions[0].stoic) as [SimCompKey, number][]) {
      if (nu && nu < 0 && (nIn[k] ?? 0) > 0) {
        refComp = k;
        break;
      }
    }
  }
  const nRefIn = refComp ? Math.max(0, nIn[refComp] ?? 0) : 0;

  const buildMoles = (xiVec: number[]): Record<SimCompKey, number> => {
    const rec = { ...nIn };
    for (let r = 0; r < R; r++) {
      for (const [k, nu] of Object.entries(reactions[r].stoic) as [SimCompKey, number][]) {
        if (nu) rec[k] = Math.max(0, (rec[k] ?? 0) + nu * xiVec[r]);
      }
    }
    return rec;
  };

  // 미분방정식 우변 d/dV [ξ_1..ξ_R, T_C, P_barA]
  const evalRhs = (xiVec: number[], T_C: number, P_barA: number) => {
    const nCurr = buildMoles(xiVec);
    const fl = calcFluidStateAndConcentrations(nCurr, T_C, P_barA, phaseMode, propMethod);

    const dXi_dV = new Array(R).fill(0);
    for (let r = 0; r < R; r++) {
      let rate = evalKineticRateKmolM3S(reactions[r], fl.concKmolM3, T_C, fl.effPhase);
      // 반응물 소진 임박 시 음수 오버슈트 방지 매끄러운 감쇠
      if (rate > 0) {
        for (const [k, nu] of Object.entries(reactions[r].stoic) as [SimCompKey, number][]) {
          if (nu && nu < 0 && (nCurr[k] ?? 0) <= 1e-14) rate = 0;
        }
      } else if (rate < 0) {
        for (const [k, nu] of Object.entries(reactions[r].stoic) as [SimCompKey, number][]) {
          if (nu && nu > 0 && (nCurr[k] ?? 0) <= 1e-14) rate = 0;
        }
      }
      dXi_dV[r] = 3600 * rate; // kmol/(h·m³)
    }

    // Ergun 방정식 압력강하 dP_bar / dV = (1 / Ac) * dP_bar / dz
    let dP_dV = 0;
    if (hasErgun && P_barA > minPBarA) {
      const us = fl.volFlowM3H / 3600 / Math.max(1e-9, Ac); // m/s
      const oneMinusEps = 1 - eps;
      const eps3 = eps * eps * eps;
      const viscousPaM = (150 * fl.viscosityPaS * oneMinusEps * oneMinusEps * us) / (dpM * dpM * eps3);
      const inertialPaM = (1.75 * fl.densityKgM3 * oneMinusEps * us * us) / (dpM * eps3);
      const dP_bar_dz = -(viscousPaM + inertialPaM) * 1e-5;
      dP_dV = dP_bar_dz / Math.max(1e-9, Ac);
    }

    // 축방향 에너지 수지 dT / dV
    let dT_dV = 0;
    if (thermalMode !== 'isothermal') {
      let qWallKJHm3 = 0;
      if (thermalMode === 'specified_duty') {
        qWallKJHm3 = Q_specKJH / Math.max(1e-9, V_tot);
      } else if (thermalMode === 'jacket_ua') {
        const aHt = 4.0 / Math.max(1e-4, D_tube); // m²/m³
        qWallKJHm3 = U_kcal * KJ_PER_KCAL * aHt * (T_jacket - T_C);
      }

      // 반응열 생성항 Σ ΔH_rxn,r(T) * (dξ_r/dV) [kJ/(h·m³)] 및 혼합물 열용량 유량 Cp_tot [kJ/(h·K)]
      const T_K = Math.max(200, T_C + 273.15);
      let cpStreamKJH_K = 0;
      for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
        const k = ALL_REACTOR_COMPS[i];
        const nk = nCurr[k] ?? 0;
        if (nk <= 0) continue;
        const cpMolar =
          fl.effPhase === 'vapor' && !NONVOLATILE_ELECTROLYTES.has(k)
            ? idealGasCpJmolK(k, T_K)
            : liquidCpJmolK(k, T_K);
        cpStreamKJH_K += nk * cpMolar; // kmol/h * kJ/(kmol·K) = kJ/(h·K)
      }

      let rxnHeatSinkKJHm3 = 0;
      for (let r = 0; r < R; r++) {
        if (Math.abs(dXi_dV[r]) <= 1e-20) continue;
        let dHrKJkmol = 0;
        for (const [k, nu] of Object.entries(reactions[r].stoic) as [SimCompKey, number][]) {
          if (!nu) continue;
          const isEl = NONVOLATILE_ELECTROLYTES.has(k);
          const ph = fl.effPhase === 'vapor' && !isEl ? 'V' : isEl ? 'AQ' : 'L';
          dHrKJkmol += nu * componentMolarEnthalpy(k, T_C, ph);
        }
        rxnHeatSinkKJHm3 += dHrKJkmol * dXi_dV[r];
      }

      dT_dV = (qWallKJHm3 - rxnHeatSinkKJHm3) / Math.max(1e-3, cpStreamKJH_K);
    }

    return { dXi_dV, dT_dV, dP_dV };
  };

  // 반응물 소진 시 스텝 내 진행도 클램핑 도우미
  const clampXi = (xiCand: number[]): number[] => {
    const out = [...xiCand];
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
        const k = ALL_REACTOR_COMPS[i];
        let nk = nIn[k] ?? 0;
        for (let r = 0; r < R; r++) nk += (reactions[r].stoic[k] ?? 0) * out[r];
        if (nk < 0) {
          // 음수를 유발한 반응 진행도를 비례 축소
          let consumeSum = 0;
          for (let r = 0; r < R; r++) {
            const contrib = (reactions[r].stoic[k] ?? 0) * out[r];
            if (contrib < 0) consumeSum += -contrib;
          }
          if (consumeSum > 1e-20) {
            const excess = -nk;
            const factor = Math.max(0, 1 - (1.000001 * excess) / consumeSum);
            for (let r = 0; r < R; r++) {
              if ((reactions[r].stoic[k] ?? 0) * out[r] < 0) out[r] *= factor;
            }
          }
        }
      }
    }
    return out;
  };

  let xi = new Array(R).fill(0);
  let T = T_start;
  let P_barA = P_inBarA;
  let hotspotTempC = T;
  let hitMinP = false;

  const axialProfile: ReactorAxialPoint[] = [];

  const pushNode = (stepIdx: number) => {
    const zFrac = stepIdx / N_STEPS;
    const nNode = buildMoles(xi);
    let totMol = 0;
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) totMol += nNode[ALL_REACTOR_COMPS[i]] ?? 0;
    const conv =
      refComp && nRefIn > 1e-15
        ? Math.max(0, Math.min(1, (nRefIn - (nNode[refComp] ?? 0)) / nRefIn))
        : 0;
    if (T > hotspotTempC) hotspotTempC = T;
    axialProfile.push({
      zFrac: Number(zFrac.toFixed(6)),
      lengthM: zFrac * L_tot,
      volumeM3: zFrac * V_tot,
      tempC: T,
      pressKgcm2g: barAToKgcm2g(P_barA),
      conversion: conv,
      totalMolarKmolH: totMol,
    });
  };

  pushNode(0);

  for (let step = 1; step <= N_STEPS; step++) {
    const k1 = evalRhs(xi, T, P_barA);

    const xi2 = clampXi(xi.map((v, r) => v + 0.5 * dV * k1.dXi_dV[r]));
    const T2 = Math.max(-80, Math.min(3200, T + 0.5 * dV * k1.dT_dV));
    const P2 = Math.max(minPBarA, P_barA + 0.5 * dV * k1.dP_dV);
    const k2 = evalRhs(xi2, T2, P2);

    const xi3 = clampXi(xi.map((v, r) => v + 0.5 * dV * k2.dXi_dV[r]));
    const T3 = Math.max(-80, Math.min(3200, T + 0.5 * dV * k2.dT_dV));
    const P3 = Math.max(minPBarA, P_barA + 0.5 * dV * k2.dP_dV);
    const k3 = evalRhs(xi3, T3, P3);

    const xi4 = clampXi(xi.map((v, r) => v + dV * k3.dXi_dV[r]));
    const T4 = Math.max(-80, Math.min(3200, T + dV * k3.dT_dV));
    const P4 = Math.max(minPBarA, P_barA + dV * k3.dP_dV);
    const k4 = evalRhs(xi4, T4, P4);

    xi = clampXi(
      xi.map(
        (v, r) => v + (dV / 6) * (k1.dXi_dV[r] + 2 * k2.dXi_dV[r] + 2 * k3.dXi_dV[r] + k4.dXi_dV[r])
      )
    );
    T = Math.max(-80, Math.min(3200, T + (dV / 6) * (k1.dT_dV + 2 * k2.dT_dV + 2 * k3.dT_dV + k4.dT_dV)));
    const nextP = P_barA + (dV / 6) * (k1.dP_dV + 2 * k2.dP_dV + 2 * k3.dP_dV + k4.dP_dV);
    if (nextP <= minPBarA) hitMinP = true;
    P_barA = Math.max(minPBarA, nextP);

    pushNode(step);
  }

  if (hitMinP) {
    warnings.push(
      `충전층 Ergun 압력강하가 과도하여 출구 압력이 최소 하한(${minPBarA.toFixed(2)} barA)에 도달했습니다. 관경·관수 또는 입자경을 키워 주세요.`
    );
  }

  const nOut = buildMoles(xi);
  const P_outKgcm2g = barAToKgcm2g(P_barA);
  const pressureDropBar = Math.max(0, P_inBarA - P_barA);

  const flowsOut = zeroFlows();
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    flowsOut[k] = (nOut[k] ?? 0) * mwOf(k);
  }

  // 단열 및 지정 열량 모드는 출구 PH 플래시 정밀 보정으로 총엔탈피 보존 오차를 0 으로 마감
  if (thermalMode === 'adiabatic' || thermalMode === 'specified_duty') {
    const Q_spec = thermalMode === 'adiabatic' ? 0 : (config.specifiedDutyKcalH ?? 0);
    const ph = solveOutletTempForTargetEnthalpy(
      flowsOut,
      P_outKgcm2g,
      H_inKcalH + Q_spec,
      phaseMode,
      propMethod,
      T
    );
    T = ph.T_C;
    if (T > hotspotTempC) hotspotTempC = T;
    axialProfile[axialProfile.length - 1].tempC = T;
    return {
      nOut,
      T_outC: T,
      P_outKgcm2g,
      pressureDropBar,
      vap: ph.vap,
      liq: ph.liq,
      extents: xi,
      heatDutyKcalH: Q_spec,
      axialProfile,
      hotspotTempC,
      iterations: N_STEPS,
      converged: true,
    };
  }

  const flOut = flashReactorStream(flowsOut, T, P_outKgcm2g, phaseMode, propMethod);
  const H_outKcalH = reactorEnthalpyKcalH(flOut.vap, flOut.liq, T, P_outKgcm2g);
  return {
    nOut,
    T_outC: T,
    P_outKgcm2g,
    pressureDropBar,
    vap: flOut.vap,
    liq: flOut.liq,
    extents: xi,
    heatDutyKcalH: H_outKcalH - H_inKcalH,
    axialProfile,
    hotspotTempC,
    iterations: N_STEPS,
    converged: true,
  };
}

// ── 통합 메인 반응기 솔버 (`solveChemicalReactor`) ──────────────────────────

export function solveChemicalReactor(
  inletFlowsKgH: Partial<Record<SimCompKey, number>>,
  inletTempC: number,
  inletPressKgcm2g: number,
  config: ReactorConfig
): ReactorSolveResult {
  const warnings: string[] = [];
  const model: ReactorModelType = config.model ?? 'stoic';
  const thermalMode: ReactorThermalMode = config.thermalMode ?? 'isothermal';
  const phaseMode: 'vapor' | 'liquid' | 'vle' = config.phaseMode ?? 'vle';
  const propMethod: ResolvedPropertyMethod = config.propertyMethod ?? 'ENRTL';
  const reactions = config.reactions ?? [];

  // 유입 질량/몰 유량 정리
  const cleanInKgH = zeroFlows();
  const nIn = zeroFlows();
  let totalMassIn = 0;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    const m = Math.max(0, inletFlowsKgH[k] ?? 0);
    cleanInKgH[k] = m;
    totalMassIn += m;
    nIn[k] = m > 0 ? m / mwOf(k) : 0;
  }

  // 빈 피드 처리
  if (totalMassIn <= 1e-12) {
    return {
      converged: true,
      iterations: 0,
      model,
      outletFlowsKgH: zeroFlows(),
      vapFlowsKgH: zeroFlows(),
      liqFlowsKgH: zeroFlows(),
      outletTempC: config.operTempC ?? inletTempC,
      outletPressKgcm2g: config.operPressKgcm2g ?? inletPressKgcm2g,
      pressureDropBar: 0,
      heatDutyKcalH: 0,
      reactionEnthalpy298KJmol: reactions.map(
        (rxn) => calcReactionStdThermo(rxn, 25, phaseMode === 'liquid' ? 'liquid' : 'vapor').dH298KJmol
      ),
      extentsKmolH: reactions.map(() => 0),
      keyConversions: {},
      atomBalanceMaxRelErr: 0,
      massBalanceRelErr: 0,
      statusNote: '유입 유량이 0 이므로 반응을 생략했습니다.',
      warnings: [],
    };
  }

  // 양론 균형 사전 진단 (gibbs 제외)
  if (model !== 'gibbs') {
    for (const rxn of reactions) {
      const bal = checkStoichiometryBalance(rxn.stoic);
      if (!bal.balanced) {
        warnings.push(
          `반응 '${rxn.name ?? rxn.id}' 화학양론 불균형 감지 (ΔMW = ${bal.mwResidualGmol.toFixed(3)} g/mol).`
        );
      }
    }
  }

  // 유입 스트림 엔탈피 계산
  const inFlash = flashReactorStream(cleanInKgH, inletTempC, inletPressKgcm2g, phaseMode, propMethod);
  const H_inKcalH = reactorEnthalpyKcalH(inFlash.vap, inFlash.liq, inletTempC, inletPressKgcm2g);

  const P_operKgcm2g = config.operPressKgcm2g ?? inletPressKgcm2g;
  const P_inBarA = kgcm2gToBarA(inletPressKgcm2g);

  let nOut = { ...nIn };
  let vapFlowsKgH = zeroFlows();
  let liqFlowsKgH = zeroFlows();
  let outletTempC = config.operTempC ?? inletTempC;
  let outletPressKgcm2g = P_operKgcm2g;
  let pressureDropBar = Math.max(0, P_inBarA - kgcm2gToBarA(P_operKgcm2g));
  let heatDutyKcalH = 0;
  let extentsKmolH: number[] = [];
  let iterations = 1;
  let converged = true;
  let axialProfile: ReactorAxialPoint[] | undefined;
  let hotspotTempC: number | undefined;
  let equilibriumConstants: Record<string, number> | undefined;

  if (model === 'stoic') {
    const st = solveStoicModel(nIn, reactions, warnings);
    nOut = st.nOut;
    extentsKmolH = st.extents;
    const rawFlows = zeroFlows();
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      rawFlows[k] = (nOut[k] ?? 0) * mwOf(k);
    }

    if (thermalMode === 'isothermal') {
      outletTempC = config.operTempC ?? inletTempC;
      const fl = flashReactorStream(rawFlows, outletTempC, outletPressKgcm2g, phaseMode, propMethod);
      vapFlowsKgH = fl.vap;
      liqFlowsKgH = fl.liq;
      heatDutyKcalH = reactorEnthalpyKcalH(vapFlowsKgH, liqFlowsKgH, outletTempC, outletPressKgcm2g) - H_inKcalH;
      iterations = 1;
    } else {
      const Q_spec =
        thermalMode === 'adiabatic'
          ? 0
          : thermalMode === 'specified_duty'
          ? (config.specifiedDutyKcalH ?? 0)
          : 0;
      const ph = solveOutletTempForTargetEnthalpy(
        rawFlows,
        outletPressKgcm2g,
        H_inKcalH + Q_spec,
        phaseMode,
        propMethod,
        inletTempC
      );
      outletTempC = ph.T_C;
      vapFlowsKgH = ph.vap;
      liqFlowsKgH = ph.liq;
      heatDutyKcalH = Q_spec;
      iterations = ph.iterations;
      converged = ph.converged;
    }
  } else if (model === 'equilibrium') {
    if (thermalMode === 'isothermal') {
      outletTempC = config.operTempC ?? inletTempC;
      const eq = solveEquilibriumAtTemp(nIn, reactions, outletTempC, outletPressKgcm2g, phaseMode, propMethod);
      nOut = eq.nOut;
      extentsKmolH = eq.extents;
      equilibriumConstants = eq.keqMap;
      iterations = eq.iterations;
      converged = eq.converged;
      const rawFlows = zeroFlows();
      for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
        const k = ALL_REACTOR_COMPS[i];
        rawFlows[k] = (nOut[k] ?? 0) * mwOf(k);
      }
      const fl = flashReactorStream(rawFlows, outletTempC, outletPressKgcm2g, phaseMode, propMethod);
      vapFlowsKgH = fl.vap;
      liqFlowsKgH = fl.liq;
      heatDutyKcalH = reactorEnthalpyKcalH(vapFlowsKgH, liqFlowsKgH, outletTempC, outletPressKgcm2g) - H_inKcalH;
    } else {
      const Q_spec = thermalMode === 'adiabatic' ? 0 : (config.specifiedDutyKcalH ?? 0);
      const outer = solveReactiveThermalOuterLoop(
        (T) => solveEquilibriumAtTemp(nIn, reactions, T, outletPressKgcm2g, phaseMode, propMethod),
        H_inKcalH,
        Q_spec,
        outletPressKgcm2g,
        phaseMode,
        propMethod,
        config.operTempC ?? inletTempC
      );
      outletTempC = outer.T_outC;
      nOut = outer.nOut;
      vapFlowsKgH = outer.vap;
      liqFlowsKgH = outer.liq;
      extentsKmolH = outer.extents;
      equilibriumConstants = outer.keqMap;
      heatDutyKcalH = Q_spec;
      iterations = outer.iterations;
      converged = outer.converged;
    }
  } else if (model === 'gibbs') {
    if (thermalMode === 'isothermal') {
      outletTempC = config.operTempC ?? inletTempC;
      const gb = solveGibbsAtTemp(nIn, config, outletTempC, outletPressKgcm2g, phaseMode, propMethod);
      nOut = gb.nOut;
      iterations = gb.iterations;
      converged = gb.converged;
      const rawFlows = zeroFlows();
      for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
        const k = ALL_REACTOR_COMPS[i];
        rawFlows[k] = (nOut[k] ?? 0) * mwOf(k);
      }
      const fl = flashReactorStream(rawFlows, outletTempC, outletPressKgcm2g, phaseMode, propMethod);
      vapFlowsKgH = fl.vap;
      liqFlowsKgH = fl.liq;
      heatDutyKcalH = reactorEnthalpyKcalH(vapFlowsKgH, liqFlowsKgH, outletTempC, outletPressKgcm2g) - H_inKcalH;
    } else {
      const Q_spec = thermalMode === 'adiabatic' ? 0 : (config.specifiedDutyKcalH ?? 0);
      const outer = solveReactiveThermalOuterLoop(
        (T) => {
          const gb = solveGibbsAtTemp(nIn, config, T, outletPressKgcm2g, phaseMode, propMethod);
          return { nOut: gb.nOut, extents: [], keqMap: {}, iterations: gb.iterations, converged: gb.converged };
        },
        H_inKcalH,
        Q_spec,
        outletPressKgcm2g,
        phaseMode,
        propMethod,
        config.operTempC ?? inletTempC
      );
      outletTempC = outer.T_outC;
      nOut = outer.nOut;
      vapFlowsKgH = outer.vap;
      liqFlowsKgH = outer.liq;
      heatDutyKcalH = Q_spec;
      iterations = outer.iterations;
      converged = outer.converged;
    }
  } else if (model === 'cstr') {
    const cs = solveCstrModel(nIn, H_inKcalH, inletTempC, outletPressKgcm2g, config, phaseMode, propMethod);
    nOut = cs.nOut;
    outletTempC = cs.T_outC;
    vapFlowsKgH = cs.vap;
    liqFlowsKgH = cs.liq;
    extentsKmolH = cs.extents;
    heatDutyKcalH = cs.heatDutyKcalH;
    iterations = cs.iterations;
    converged = cs.converged;
  } else if (model === 'pfr') {
    const pf = solvePfrModel(
      nIn,
      H_inKcalH,
      inletTempC,
      inletPressKgcm2g,
      config,
      phaseMode,
      propMethod,
      warnings
    );
    nOut = pf.nOut;
    outletTempC = pf.T_outC;
    outletPressKgcm2g = pf.P_outKgcm2g;
    pressureDropBar = pf.pressureDropBar;
    vapFlowsKgH = pf.vap;
    liqFlowsKgH = pf.liq;
    extentsKmolH = pf.extents;
    heatDutyKcalH = pf.heatDutyKcalH;
    axialProfile = pf.axialProfile;
    hotspotTempC = pf.hotspotTempC;
    iterations = pf.iterations;
    converged = pf.converged;
  }

  // 원소 보존 상대 오차 산출 (엄밀 몰수 기준)
  let atomBalanceMaxRelErr = 0;
  for (const sym of ELEMENT_SYMBOLS) {
    let elemIn = 0;
    let elemOut = 0;
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      const cnt = ELEMENT_COMPOSITION[k][sym] ?? 0;
      if (cnt === 0) continue;
      elemIn += (nIn[k] ?? 0) * cnt;
      elemOut += (nOut[k] ?? 0) * cnt;
    }
    if (elemIn > 1e-15 || elemOut > 1e-15) {
      const rel = Math.abs(elemOut - elemIn) / Math.max(1e-15, elemIn);
      if (rel > atomBalanceMaxRelErr) atomBalanceMaxRelErr = rel;
    }
  }

  // 출구 질량 유량 구성 및 MW 소수점 3자리 표 반올림에 의한 미세 차감 보정 (원소 균형 반응에 한함)
  const outletFlowsKgH = zeroFlows();
  let rawTotalMassOut = 0;
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    const m = Math.max(0, (vapFlowsKgH[k] ?? 0) + (liqFlowsKgH[k] ?? 0));
    outletFlowsKgH[k] = m;
    rawTotalMassOut += m;
  }

  if (
    atomBalanceMaxRelErr < 1e-6 &&
    rawTotalMassOut > 1e-12 &&
    Math.abs(totalMassIn - rawTotalMassOut) / totalMassIn < 1e-3
  ) {
    const massCorrFactor = totalMassIn / rawTotalMassOut;
    for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
      const k = ALL_REACTOR_COMPS[i];
      vapFlowsKgH[k] *= massCorrFactor;
      liqFlowsKgH[k] *= massCorrFactor;
      outletFlowsKgH[k] = vapFlowsKgH[k] + liqFlowsKgH[k];
    }
  }

  const finalMassOut = sumRecord(outletFlowsKgH);
  const massBalanceRelErr = Math.abs(finalMassOut - totalMassIn) / Math.max(1e-15, totalMassIn);

  // 주요 반응물 총괄 전환율 계산
  const keyConversions: Record<string, number> = {};
  for (let i = 0; i < ALL_REACTOR_COMPS.length; i++) {
    const k = ALL_REACTOR_COMPS[i];
    if ((nIn[k] ?? 0) > 1e-12 && (nOut[k] ?? 0) < nIn[k] - 1e-13) {
      keyConversions[k] = Math.max(0, Math.min(1, (nIn[k] - nOut[k]) / nIn[k]));
    }
  }

  const reactionEnthalpy298KJmol = reactions.map(
    (rxn) => calcReactionStdThermo(rxn, 25.0, phaseMode === 'liquid' ? 'liquid' : 'vapor').dH298KJmol
  );

  // 평형상수 정보가 비어 있으면 표시용으로 산출
  if (!equilibriumConstants && reactions.length > 0) {
    const kMap: Record<string, number> = {};
    for (const rxn of reactions) {
      kMap[rxn.id] = calcReactionStdThermo(
        rxn,
        outletTempC,
        phaseMode === 'liquid' ? 'liquid' : 'vapor'
      ).Keq;
    }
    equilibriumConstants = kMap;
  }

  const modelLabelMap: Record<ReactorModelType, string> = {
    stoic: '양론/전환 반응기',
    equilibrium: '화학평형 반응기',
    gibbs: 'Gibbs 자유에너지 최소화 반응기',
    cstr: '연속교반탱크 반응기(CSTR)',
    pfr: '관형 플러그흐름 반응기(PFR)',
  };

  const statusNote = converged
    ? `${modelLabelMap[model]} 수렴 완료 (${iterations} iter, T_out = ${outletTempC.toFixed(1)} °C, Q = ${heatDutyKcalH.toFixed(0)} kcal/h)`
    : `${modelLabelMap[model]} 수렴 한계 도달 (${iterations} iter) — 운전조건 및 속도상수를 확인하세요.`;

  return {
    converged,
    iterations,
    model,
    outletFlowsKgH,
    vapFlowsKgH,
    liqFlowsKgH,
    outletTempC,
    outletPressKgcm2g,
    pressureDropBar,
    heatDutyKcalH,
    reactionEnthalpy298KJmol,
    extentsKmolH,
    keyConversions,
    atomBalanceMaxRelErr,
    massBalanceRelErr,
    axialProfile,
    hotspotTempC,
    equilibriumConstants,
    statusNote,
    warnings,
  };
}

// ── 14종 대표 산업 화학반응 템플릿 (INDUSTRIAL_REACTION_TEMPLATES) ───────────

export const INDUSTRIAL_REACTION_TEMPLATES: Array<{
  id: string;
  labelKo: string;
  category: string;
  descKo: string;
  defaultConfig: ReactorConfig;
}> = [
  {
    id: 'wgs_hts',
    labelKo: '수성가스 전이 반응 (Water-Gas Shift, HTS)',
    category: '합성가스 · 수소',
    descKo: 'CO + H₂O ⇌ CO₂ + H₂ 고온 전이 촉매 평형 반응 (Fe₃O₄/Cr₂O₃, 350~450 °C)',
    defaultConfig: {
      presetId: 'wgs_hts',
      model: 'equilibrium',
      thermalMode: 'isothermal',
      operTempC: 426.85,
      operPressKgcm2g: 25.0,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      reactions: [
        {
          id: 'R1_WGS',
          name: 'Water-Gas Shift',
          stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 },
          keyComp: 'CO',
          conversion: 0.85,
        },
      ],
    },
  },
  {
    id: 'smr_reformer',
    labelKo: '메탄 수증기 개질 (Steam Methane Reforming)',
    category: '합성가스 · 수소',
    descKo: 'CH₄ + H₂O ⇌ CO + 3H₂ 및 WGS 동시 다중 화학평형 개질기 (Ni/Al₂O₃, 800~900 °C)',
    defaultConfig: {
      presetId: 'smr_reformer',
      model: 'equilibrium',
      thermalMode: 'isothermal',
      operTempC: 850.0,
      operPressKgcm2g: 20.0,
      phaseMode: 'vapor',
      propertyMethod: 'SRK',
      gibbsSpeciesPool: ['CH4', 'H2O', 'CO', 'CO2', 'H2', 'N2'],
      reactions: [
        {
          id: 'R1_SMR',
          name: 'Steam Methane Reforming',
          stoic: { CH4: -1, H2O: -1, CO: 1, H2: 3 },
          keyComp: 'CH4',
        },
        {
          id: 'R2_WGS',
          name: 'Water-Gas Shift',
          stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 },
          keyComp: 'CO',
        },
      ],
    },
  },
  {
    id: 'nh3_haber_bosch',
    labelKo: '암모니아 고압 합성 (NH₃ Synthesis)',
    category: '합성가스 · 비료',
    descKo: 'N₂ + 3H₂ ⇌ 2NH₃ 고압 실제기체(SRK) 평형 합성 반응기 (Fe 촉매, 150~250 bar)',
    defaultConfig: {
      presetId: 'nh3_haber_bosch',
      model: 'equilibrium',
      thermalMode: 'isothermal',
      operTempC: 450.0,
      operPressKgcm2g: 150.0,
      phaseMode: 'vapor',
      propertyMethod: 'SRK',
      reactions: [
        {
          id: 'R1_NH3',
          name: 'Ammonia Synthesis',
          stoic: { N2: -1, H2: -3, NH3: 2 },
          keyComp: 'N2',
        },
      ],
    },
  },
  {
    id: 'meoh_synthesis',
    labelKo: '메탄올 촉매 합성 (Methanol Synthesis)',
    category: '합성가스 · C1 화학',
    descKo: 'CO + 2H₂ ⇌ CH₃OH 및 CO₂ 수소화 동시 평형 반응 (Cu/ZnO/Al₂O₃, 240~270 °C)',
    defaultConfig: {
      presetId: 'meoh_synthesis',
      model: 'equilibrium',
      thermalMode: 'isothermal',
      operTempC: 250.0,
      operPressKgcm2g: 70.0,
      phaseMode: 'vapor',
      propertyMethod: 'SRK',
      reactions: [
        {
          id: 'R1_MEOH',
          name: 'CO Hydrogenation to Methanol',
          stoic: { CO: -1, H2: -2, MeOH: 1 },
          keyComp: 'CO',
        },
        {
          id: 'R2_RWGS',
          name: 'Reverse Water-Gas Shift',
          stoic: { CO2: -1, H2: -1, CO: 1, H2O: 1 },
          keyComp: 'CO2',
        },
      ],
    },
  },
  {
    id: 'styrene_eb_dehydro',
    labelKo: '에틸벤젠 탈수소 스티렌 합성 (EB → Styrene + H₂)',
    category: '석유화학 · 방향족',
    descKo: '스팀 희석 단열 충전층 PFR 탈수소 반응기 (K-Fe₂O₃ 촉매, 600~650 °C, Ergun ΔP 포함)',
    defaultConfig: {
      presetId: 'styrene_eb_dehydro',
      model: 'pfr',
      thermalMode: 'adiabatic',
      operTempC: 630.0,
      operPressKgcm2g: 0.6,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      volumeM3: 12.0,
      tubeCount: 1,
      tubeDiamM: 2.2,
      tubeLengthM: 3.16,
      catalystVoidage: 0.42,
      particleDiamMm: 4.8,
      reactions: [
        {
          id: 'R1_EB_STYRENE',
          name: 'Ethylbenzene Dehydrogenation',
          stoic: { Ethylbenzene: -1, Styrene: 1, H2: 1 },
          keyComp: 'Ethylbenzene',
          k0Forward: 1.25e6,
          EaForwardKJmol: 91.0,
          reversible: true,
        },
      ],
    },
  },
  {
    id: 'etoac_esterification',
    labelKo: '초산에틸 에스테르화 반응 (Ethyl Acetate Esterification)',
    category: '정밀화학 · 용제',
    descKo: 'CH₃COOH + C₂H₅OH ⇌ EtOAc + H₂O 비이상 액상(NRTL γ_i) 가역 평형 반응',
    defaultConfig: {
      presetId: 'etoac_esterification',
      model: 'equilibrium',
      thermalMode: 'isothermal',
      operTempC: 75.0,
      operPressKgcm2g: 0.5,
      phaseMode: 'liquid',
      propertyMethod: 'NRTL',
      reactions: [
        {
          id: 'R1_ETOAC',
          name: 'Ethyl Acetate Esterification',
          stoic: { AceticAcid: -1, EtOH: -1, EtOAc: 1, H2O: 1 },
          keyComp: 'AceticAcid',
        },
      ],
    },
  },
  {
    id: 'so2_contact_oxidation',
    labelKo: '이산화황 접촉 산화 (SO₂ + 0.5 O₂ ⇌ SO₃)',
    category: '무기산 · 황산',
    descKo: 'V₂O₅ 충전층 촉매 반응기 발열 산화 및 가역 평형 제한 모사 (Ergun ΔP 포함)',
    defaultConfig: {
      presetId: 'so2_contact_oxidation',
      model: 'pfr',
      thermalMode: 'adiabatic',
      operTempC: 430.0,
      operPressKgcm2g: 0.8,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      volumeM3: 8.5,
      tubeCount: 1,
      tubeDiamM: 2.4,
      tubeLengthM: 1.88,
      catalystVoidage: 0.45,
      particleDiamMm: 6.0,
      reactions: [
        {
          id: 'R1_SO2_OX',
          name: 'SO2 Contact Oxidation',
          stoic: { SO2: -1, O2: -0.5, SO3: 1 },
          keyComp: 'SO2',
          k0Forward: 3.6e4,
          EaForwardKJmol: 76.0,
          reversible: true,
        },
      ],
    },
  },
  {
    id: 'cumene_alkylation',
    labelKo: '큐멘 알킬화 합성 (Benzene + C₃H₆ → Cumene)',
    category: '석유화학 · 방향족',
    descKo: '다관식 열매체 냉각(Jacket UA) 충전층 PFR 발열 반응 및 축방향 Hotspot 온도 피크 해석',
    defaultConfig: {
      presetId: 'cumene_alkylation',
      model: 'pfr',
      thermalMode: 'jacket_ua',
      operTempC: 320.0,
      operPressKgcm2g: 24.0,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      tubeCount: 180,
      tubeDiamM: 0.05,
      tubeLengthM: 6.0,
      jacketTempC: 320.0,
      overallU_KcalM2HC: 185,
      catalystVoidage: 0.4,
      particleDiamMm: 3.5,
      reactions: [
        {
          id: 'R1_CUMENE',
          name: 'Propylene Benzene Alkylation',
          stoic: { Benzene: -1, C3H6: -1, Cumene: 1 },
          keyComp: 'C3H6',
          k0Forward: 1.8e5,
          EaForwardKJmol: 68.0,
          reversible: false,
        },
      ],
    },
  },
  {
    id: 'mtbe_etherification',
    labelKo: 'MTBE 액상 에테르화 합성 (C₄H₈ + MeOH ⇌ MTBE)',
    category: '석유화학 · 연료첨가제',
    descKo: '이온교환수지 촉매 액상 냉각 CSTR 반응기 (NRTL 활동도 및 자켓 제열 연동)',
    defaultConfig: {
      presetId: 'mtbe_etherification',
      model: 'cstr',
      thermalMode: 'jacket_ua',
      operTempC: 65.0,
      operPressKgcm2g: 8.0,
      phaseMode: 'liquid',
      propertyMethod: 'NRTL',
      volumeM3: 4.5,
      jacketTempC: 55.0,
      overallU_KcalM2HC: 320,
      reactions: [
        {
          id: 'R1_MTBE',
          name: 'MTBE Etherification',
          stoic: { C4H8_1: -1, MeOH: -1, MTBE: 1 },
          keyComp: 'C4H8_1',
          k0Forward: 4.5e4,
          EaForwardKJmol: 62.0,
          reversible: true,
        },
      ],
    },
  },
  {
    id: 'hcl_synthesis_burner',
    labelKo: '무수 염산 합성 단열 버너 (H₂ + Cl₂ → 2HCl)',
    category: '클로르알칼리 · 무기염소',
    descKo: '과잉 수소 하 염소 완전 연소 단열 반응기 (ΔH°₂₉₈ = -184.6 kJ/mol 고온 단열 화염 온도 산출)',
    defaultConfig: {
      presetId: 'hcl_synthesis_burner',
      model: 'stoic',
      thermalMode: 'adiabatic',
      operPressKgcm2g: 1.2,
      phaseMode: 'vapor',
      propertyMethod: 'PR',
      reactions: [
        {
          id: 'R1_HCL_BURN',
          name: 'HCl Synthesis Combustion',
          stoic: { H2: -1, Cl2: -1, HCl: 2 },
          keyComp: 'Cl2',
          conversion: 0.9995,
        },
      ],
    },
  },
  {
    id: 'cl2_caustic_scrubbing',
    labelKo: '염소 가성소다 흡수 중화 · 차아염소산 합성 (Cl₂ Scrubbing)',
    category: '클로르알칼리 · 환경안전',
    descKo: 'Cl₂ + 2NaOH → NaOCl + NaCl + H₂O 전해질 수용액 발열 중화 반응 (ENRTL 수용액 열수지)',
    defaultConfig: {
      presetId: 'cl2_caustic_scrubbing',
      model: 'stoic',
      thermalMode: 'adiabatic',
      operPressKgcm2g: 0.2,
      phaseMode: 'vle',
      propertyMethod: 'ENRTL',
      reactions: [
        {
          id: 'R1_NAOCL',
          name: 'Chlorine Caustic Scrubbing',
          stoic: { Cl2: -1, NaOH: -2, NaOCl: 1, NaCl: 1, H2O: 1 },
          keyComp: 'Cl2',
          conversion: 0.999,
        },
      ],
    },
  },
  {
    id: 'gte_glycerol_hydrochlorination',
    labelKo: 'GTE 글리세롤 염소화 연속 반응 (Glycerol → MCH → DCH)',
    category: '바이오 ECH · 정밀화학',
    descKo: '글리세롤 + 무수 HCl 2단계 연속 직렬 액상 CSTR 염소화 속도론 반응기',
    defaultConfig: {
      presetId: 'gte_glycerol_hydrochlorination',
      model: 'cstr',
      thermalMode: 'isothermal',
      operTempC: 110.0,
      operPressKgcm2g: 4.5,
      phaseMode: 'liquid',
      propertyMethod: 'NRTL',
      volumeM3: 8.0,
      reactions: [
        {
          id: 'R1_GTE_MCH',
          name: 'Glycerol to MCH',
          stoic: { Glycerol: -1, HCl: -1, MCH: 1, H2O: 1 },
          keyComp: 'Glycerol',
          k0Forward: 8.2e3,
          EaForwardKJmol: 58.0,
        },
        {
          id: 'R2_GTE_DCH',
          name: 'MCH to DCH',
          stoic: { MCH: -1, HCl: -1, DCH: 1, H2O: 1 },
          keyComp: 'MCH',
          k0Forward: 2.4e3,
          EaForwardKJmol: 61.5,
        },
      ],
    },
  },
  {
    id: 'ech_saponification',
    labelKo: '에피클로로히드린 비누화 고리화 반응 (DCH + NaOH → ECH)',
    category: '바이오 ECH · 정밀화학',
    descKo: '디클로로히드린 가성소다 비누화 반응 및 염수/유기상 기액평형 플래시 연계',
    defaultConfig: {
      presetId: 'ech_saponification',
      model: 'stoic',
      thermalMode: 'adiabatic',
      operPressKgcm2g: 0.3,
      phaseMode: 'vle',
      propertyMethod: 'ENRTL',
      reactions: [
        {
          id: 'R1_ECH_SAP',
          name: 'DCH Saponification to ECH',
          stoic: { DCH: -1, NaOH: -1, ECH: 1, NaCl: 1, H2O: 1 },
          keyComp: 'DCH',
          conversion: 0.985,
        },
      ],
    },
  },
  {
    id: 'ipa_acetone_dehydro',
    labelKo: '이소프로판올 탈수소 아세톤 합성 (IPA ⇌ Acetone + H₂)',
    category: '정밀화학 · 용제',
    descKo: '열매체 가열 다관식 촉매 PFR 흡열 탈수소 반응기 (축방향 냉점 Cold-spot 및 전환율 프로파일)',
    defaultConfig: {
      presetId: 'ipa_acetone_dehydro',
      model: 'pfr',
      thermalMode: 'jacket_ua',
      operTempC: 260.0,
      operPressKgcm2g: 1.5,
      phaseMode: 'vapor',
      propertyMethod: 'NRTL',
      tubeCount: 120,
      tubeDiamM: 0.04,
      tubeLengthM: 5.0,
      jacketTempC: 310.0,
      overallU_KcalM2HC: 160,
      catalystVoidage: 0.42,
      particleDiamMm: 4.0,
      reactions: [
        {
          id: 'R1_IPA_ACETONE',
          name: 'IPA Dehydrogenation to Acetone',
          stoic: { IPA: -1, Acetone: 1, H2: 1 },
          keyComp: 'IPA',
          k0Forward: 6.5e5,
          EaForwardKJmol: 72.5,
          reversible: true,
        },
      ],
    },
  },
  {
    id: 'cms_aibn_liquid_chlorination',
    labelKo: '메틸클로라이드 AIBN 개시 액상 염소화 (MC → MCL → CFM → CTC)',
    category: '염소 다운스트림 · 클로로메탄(CMS)',
    descKo: '24 kgf/cm²G · 120°C 가압 액상 PFR 반응기 (AIBN 자유라디칼 개시제 연속 연쇄염소화: MCL/CFM/CTC/C₂Cl₄ 생성)',
    defaultConfig: {
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
          name: 'MC Chlorination to MCL',
          stoic: { CH3Cl: -1, Cl2: -1, CH2Cl2: 1, HCl: 1 },
          keyComp: 'CH3Cl',
          k0Forward: 4.25e3,
          EaForwardKJmol: 58.0,
        },
        {
          id: 'R2_MCL_CFM',
          name: 'MCL Chlorination to CFM',
          stoic: { CH2Cl2: -1, Cl2: -1, CHCl3: 1, HCl: 1 },
          keyComp: 'CH2Cl2',
          k0Forward: 7.90e3,
          EaForwardKJmol: 57.5,
        },
        {
          id: 'R3_CFM_CTC',
          name: 'CFM Chlorination to CTC',
          stoic: { CHCl3: -1, Cl2: -1, CCl4: 1, HCl: 1 },
          keyComp: 'CHCl3',
          k0Forward: 6.40e3,
          EaForwardKJmol: 59.5,
        },
        {
          id: 'R4_HEAVY_PCE',
          name: 'Radical Coupling Heavies (C2Cl4)',
          stoic: { CH2Cl2: -1, CHCl3: -1, Cl2: -1, C2Cl4: 1, HCl: 3 },
          keyComp: 'CHCl3',
          k0Forward: 1.05e3,
          EaForwardKJmol: 64.0,
        },
      ],
    },
  },
];

// ============================================================================
// Stage 4 + W7: 다성분 액상 활동도 (Extended NRTL τ_ij = a_ij + b_ij/T, pair α_ij)
//               + Hansen (1991) 다성분 UNIFAC 그룹기여법 (ln γ_i = ln γ_i^C + ln γ_i^R)
//               + 동적 CUSTOM_1/CUSTOM_2 분자 그룹 런타임 주입
//               + 엄밀 액-액 상평형(LLE / VLLE 디캔터) & Michelsen 접평면 안정성 판정
// ============================================================================

import type { SimCompKey } from './flowsheetSolver';
import { NRTL_BIP_DATABANK } from './data/nrtlBinaryDatabank';
import { SECHENOV_DATABANK } from './data/pureComponentDatabank';

const COMP_MW: Record<SimCompKey, number> = {
  H2O: 18.015,
  NaCl: 58.443,
  NaOH: 39.997,
  Cl2: 70.906,
  H2: 2.016,
  HCl: 36.461,
  H2SO4: 98.079,
  O2: 31.998,
  NaOCl: 74.442,
  N2: 28.014,
  NaClO3: 106.44,
  FeCl2: 126.751,
  FeCl3: 162.204,
  PAC: 174.45,
  Glycerol: 92.094,
  MCH: 110.54,
  DCH: 128.986,
  ECH: 92.525,
  DCP: 110.971,
  CH4: 16.043,
  CO: 28.010,
  CO2: 44.010,
  NH3: 17.031,
  C2H4: 28.054,
  C2H6: 30.070,
  C3H6: 42.080,
  C3H8: 44.096,
  nC4H10: 58.122,
  nC6H14: 86.175,
  nC7H16: 100.202,
  Benzene: 78.112,
  Toluene: 92.138,
  pXylene: 106.165,
  MeOH: 32.042,
  EtOH: 46.068,
  IPA: 60.095,
  Acetone: 58.079,
  AceticAcid: 60.052,
  EtOAc: 88.105,
  CHCl3: 119.378,
  Ar: 39.948,
  H2S: 34.081,
  SO2: 64.064,
  SO3: 80.063,
  iC4H10: 58.123,
  C4H8_1: 56.107,
  nC5H12: 72.150,
  nC8H18: 114.231,
  Cyclohexane: 84.161,
  Ethylbenzene: 106.167,
  Styrene: 104.152,
  Cumene: 120.194,
  Phenol: 94.113,
  THF: 72.107,
  DMF: 73.095,
  DMSO: 78.133,
  MTBE: 88.150,
  MEK: 72.107,
  DMC: 90.078,
  EG: 62.068,
  MEA: 61.084,
  MDEA: 119.163,
  FormicAcid: 46.025,
  HNO3: 63.012,
  CH3Cl: 50.488,
  CH2Cl2: 84.933,
  CCl4: 153.823,
  C2Cl4: 165.834,
  COCl2: 98.916,
  HCHO: 30.026,
  MCB: 112.558,
  Aniline: 93.128,
  MDA: 198.268,
  MDI: 250.256,
  PMDI: 381.400,
  CUSTOM_1: 74.122,
  CUSTOM_2: 93.128,
  H2O2: 34.0147,
  H3PO4: 97.9952,
  HF: 20.0063,
  KOH: 56.1056,
  NH4OH: 35.0458,
  TMAH: 91.152,
  NMP: 99.131,
  BCS: 118.174,
  Na2CO3: 105.9888,
  NaHSO3: 104.061,
  CaOH2: 74.093,
  HCPX: 312.833,
  TPA: 166.132,
  TPC: 203.022,
  Si: 28.085,
  DCS: 101.006,
  TCS: 135.452,
  STC: 169.898,
};

const ALL_KEYS: SimCompKey[] = [
  'H2O', 'NaCl', 'NaOH', 'Cl2', 'H2', 'HCl', 'H2SO4', 'O2', 'NaOCl', 'N2',
  'NaClO3', 'FeCl2', 'FeCl3', 'PAC', 'Glycerol', 'MCH', 'DCH', 'ECH', 'DCP',
  'CH4', 'CO', 'CO2', 'NH3', 'C2H4', 'C2H6', 'C3H6', 'C3H8', 'nC4H10', 'nC6H14', 'nC7H16',
  'Benzene', 'Toluene', 'pXylene', 'MeOH', 'EtOH', 'IPA', 'Acetone', 'AceticAcid', 'EtOAc', 'CHCl3',
  'Ar', 'H2S', 'SO2', 'SO3', 'iC4H10', 'C4H8_1', 'nC5H12', 'nC8H18', 'Cyclohexane',
  'Ethylbenzene', 'Styrene', 'Cumene', 'Phenol', 'THF', 'DMF', 'DMSO', 'MTBE', 'MEK',
  'DMC', 'EG', 'MEA', 'MDEA', 'FormicAcid', 'HNO3',
  'CH3Cl', 'CH2Cl2', 'CCl4', 'C2Cl4',
  'COCl2', 'HCHO', 'MCB', 'Aniline', 'MDA', 'MDI', 'PMDI',
  'CUSTOM_1', 'CUSTOM_2',
  'H2O2', 'H3PO4', 'HF', 'KOH', 'NH4OH', 'TMAH', 'NMP', 'BCS', 'Na2CO3', 'NaHSO3', 'CaOH2',
  'HCPX', 'TPA', 'TPC', 'Si', 'DCS', 'TCS', 'STC',
];
const N_ALL = ALL_KEYS.length;
const COMP_IDX: Record<SimCompKey, number> = {} as Record<SimCompKey, number>;
ALL_KEYS.forEach((k, idx) => { COMP_IDX[k] = idx; });

const NON_VOLATILE_SET = new Set<SimCompKey>([
  'NaCl', 'NaOH', 'H2SO4', 'NaOCl', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC',
  'KOH', 'TMAH', 'Na2CO3', 'NaHSO3', 'CaOH2', 'TPA', 'Si',
]);
const PERMANENT_GAS_SET = new Set<SimCompKey>(['H2', 'O2', 'N2', 'CH4', 'CO', 'Ar']);
const HYDROPHOBIC_ORGS = new Set<SimCompKey>([
  'ECH', 'DCP', 'DCH',
  'EtOAc', 'Benzene', 'Toluene', 'pXylene', 'nC6H14', 'nC7H16', 'CHCl3',
  'CH3Cl', 'CH2Cl2', 'CCl4', 'C2Cl4',
  'MCB', 'Aniline', 'MDA', 'MDI', 'PMDI',
  'nC5H12', 'nC8H18', 'Cyclohexane', 'Ethylbenzene', 'Styrene', 'Cumene',
  'MTBE', 'MEK', 'DMC', 'CUSTOM_1', 'CUSTOM_2',
  'HCPX', 'TPC', 'DCS', 'TCS', 'STC',
]);

// ----------------------------------------------------------------------------
// 1. Extended NRTL Binary Interaction Parameters: τ_ij = a_ij + b_ij / T_K
//    출처: DECHEMA VLE/LLE Data Collection / NIST ThermoData Engine
// ----------------------------------------------------------------------------
export interface NrtlBinaryEntry {
  i: SimCompKey;
  j: SimCompKey;
  aij: number;
  aji: number;
  bijK: number;
  bjiK: number;
  alpha: number;
}

export const EXTENDED_NRTL_BIPS: NrtlBinaryEntry[] = [
  // 부분 혼화성(LLE) 유기-수계 쌍 (Michelsen TPD < 0 액-액 분리 재현)
  { i: 'ECH', j: 'H2O', aij: -0.42, aji: 1.18, bijK: 760.0, bjiK: 890.0, alpha: 0.25 },
  { i: 'DCP', j: 'H2O', aij: 0.15, aji: 1.65, bijK: 1180.0, bjiK: 1420.0, alpha: 0.22 },
  { i: 'DCH', j: 'H2O', aij: -0.35, aji: 0.72, bijK: 560.0, bjiK: 685.0, alpha: 0.28 },
  { i: 'MCH', j: 'H2O', aij: -0.28, aji: 0.34, bijK: 165.0, bjiK: 240.0, alpha: 0.30 },
  { i: 'Glycerol', j: 'H2O', aij: -0.55, aji: 0.22, bijK: -95.0, bjiK: 115.0, alpha: 0.30 },
  // 유기-유기 이성분 쌍 (클로로히드린계)
  { i: 'ECH', j: 'DCH', aij: -0.08, aji: 0.11, bijK: 92.0, bjiK: 68.0, alpha: 0.30 },
  { i: 'ECH', j: 'DCP', aij: 0.04, aji: -0.02, bijK: 48.0, bjiK: 55.0, alpha: 0.30 },
  { i: 'DCH', j: 'MCH', aij: -0.05, aji: 0.07, bijK: 62.0, bjiK: 78.0, alpha: 0.30 },
  { i: 'DCH', j: 'Glycerol', aij: 0.12, aji: 0.18, bijK: 215.0, bjiK: 265.0, alpha: 0.30 },
  { i: 'MCH', j: 'Glycerol', aij: -0.10, aji: 0.08, bijK: 55.0, bjiK: 70.0, alpha: 0.30 },

  // DECHEMA / NIST 범용 용매·탄화수소·수계 이성분 쌍
  { i: 'MeOH', j: 'H2O', aij: -0.693, aji: 2.732, bijK: 173.0, bjiK: -617.0, alpha: 0.30 },
  { i: 'EtOH', j: 'H2O', aij: -0.801, aji: 3.458, bijK: 246.2, bjiK: -586.1, alpha: 0.30 },
  { i: 'IPA', j: 'H2O', aij: -1.120, aji: 4.180, bijK: 412.0, bjiK: -610.0, alpha: 0.30 },
  { i: 'Acetone', j: 'H2O', aij: 0.054, aji: 1.845, bijK: 215.0, bjiK: -85.0, alpha: 0.30 },
  { i: 'AceticAcid', j: 'H2O', aij: -0.450, aji: 1.120, bijK: 95.0, bjiK: -110.0, alpha: 0.30 },
  { i: 'EtOAc', j: 'H2O', aij: -0.350, aji: 1.820, bijK: 820.0, bjiK: 960.0, alpha: 0.24 },
  { i: 'CHCl3', j: 'H2O', aij: 0.180, aji: 1.750, bijK: 1210.0, bjiK: 1480.0, alpha: 0.22 },
  { i: 'Benzene', j: 'H2O', aij: 0.250, aji: 1.950, bijK: 1380.0, bjiK: 1620.0, alpha: 0.20 },
  { i: 'Toluene', j: 'H2O', aij: 0.310, aji: 2.120, bijK: 1520.0, bjiK: 1780.0, alpha: 0.20 },
  { i: 'nC6H14', j: 'H2O', aij: 0.420, aji: 2.350, bijK: 1750.0, bjiK: 2050.0, alpha: 0.20 },
  { i: 'Acetone', j: 'CHCl3', aij: -0.180, aji: -0.120, bijK: -245.0, bjiK: -185.0, alpha: 0.30 },
  { i: 'Acetone', j: 'MeOH', aij: 0.020, aji: 0.030, bijK: 92.0, bjiK: 98.0, alpha: 0.30 },
  { i: 'EtOH', j: 'EtOAc', aij: 0.050, aji: 0.040, bijK: 142.0, bjiK: 128.0, alpha: 0.30 },
  { i: 'Benzene', j: 'Toluene', aij: 0.0, aji: 0.0, bijK: 8.0, bjiK: -6.0, alpha: 0.30 },
  { i: 'Toluene', j: 'pXylene', aij: 0.0, aji: 0.0, bijK: 10.0, bjiK: -8.0, alpha: 0.30 },
  { i: 'nC6H14', j: 'Benzene', aij: 0.02, aji: 0.03, bijK: 75.0, bjiK: 88.0, alpha: 0.30 },
];

const NRTL_HAS_MAT = new Uint8Array(N_ALL * N_ALL);
const NRTL_A_MAT = new Float64Array(N_ALL * N_ALL);
const NRTL_B_MAT = new Float64Array(N_ALL * N_ALL);
const NRTL_ALPHA_MAT = new Float64Array(N_ALL * N_ALL).fill(0.30);

for (const e of EXTENDED_NRTL_BIPS) {
  const ii = COMP_IDX[e.i];
  const jj = COMP_IDX[e.j];
  const idx1 = ii * N_ALL + jj;
  const idx2 = jj * N_ALL + ii;
  NRTL_HAS_MAT[idx1] = 1;
  NRTL_HAS_MAT[idx2] = 1;
  NRTL_A_MAT[idx1] = e.aij;
  NRTL_A_MAT[idx2] = e.aji;
  NRTL_B_MAT[idx1] = e.bijK;
  NRTL_B_MAT[idx2] = e.bjiK;
  NRTL_ALPHA_MAT[idx1] = e.alpha;
  NRTL_ALPHA_MAT[idx2] = e.alpha;
}

for (const e of NRTL_BIP_DATABANK) {
  const ii = COMP_IDX[e.i];
  const jj = COMP_IDX[e.j];
  if (ii === undefined || jj === undefined) continue;
  if (Math.abs(e.bij) > 20000 || Math.abs(e.bji) > 20000) continue;
  const idx1 = ii * N_ALL + jj;
  const idx2 = jj * N_ALL + ii;
  NRTL_HAS_MAT[idx1] = 1;
  NRTL_HAS_MAT[idx2] = 1;
  NRTL_A_MAT[idx1] = e.aij;
  NRTL_A_MAT[idx2] = e.aji;
  NRTL_B_MAT[idx1] = e.bij;
  NRTL_B_MAT[idx2] = e.bji;
  NRTL_ALPHA_MAT[idx1] = e.alpha;
  NRTL_ALPHA_MAT[idx2] = e.alpha;
}

// ----------------------------------------------------------------------------
// 2. Full Multi-Component Hansen et al. (1991) UNIFAC Group-Contribution Engine
//    (Fredenslund, Jones & Prausnitz 1975; Hansen, Rasmussen, Fredenslund,
//     Schiller & Gmehling, Ind. Eng. Chem. Res. 1991, 30, 2352-2355)
//    ln γ_i = ln γ_i^C + ln γ_i^R
// ----------------------------------------------------------------------------
export type UnifacSubGroup =
  | 'CH3'
  | 'CH2'
  | 'CH'
  | 'C'
  | 'CH2=CH'
  | 'CH=CH'
  | 'CH2=C'
  | 'ACH'
  | 'AC'
  | 'ACCH3'
  | 'ACCH2'
  | 'ACCH'
  | 'OH'
  | 'CH3OH'
  | 'H2O'
  | 'ACOH'
  | 'CH3CO'
  | 'CH2CO'
  | 'CHO'
  | 'CH3COO'
  | 'CH2COO'
  | 'HCOO'
  | 'CH3O'
  | 'CH2O'
  | 'CH2O_cyclic'
  | 'CHOCH2'
  | 'CH3NH2'
  | 'CH2NH2'
  | 'CH3NH'
  | 'CH2NH'
  | 'CH3N'
  | 'CH2N'
  | 'ACNH2'
  | 'CH3CN'
  | 'CH2CN'
  | 'COOH'
  | 'HCOOH'
  | 'CH2Cl'
  | 'CHCl'
  | 'ACCl'
  | 'CH2Cl2'
  | 'CHCl2'
  | 'CHCl3_g'
  | 'CCl4_g'
  | 'DMF_g'
  | 'CON(CH2)2'
  | 'DMSO_g'
  | 'OCOO'
  | 'C5H5N';

interface SgDef {
  id: UnifacSubGroup;
  main: number;
  R: number;
  Q: number;
  labelKo: string;
}

// Main Group indices (0 .. 24):
// 0: CH2 (Alkane), 1: C=C (Alkene), 2: ACH (Aromatic CH), 3: ACCH2 (Aromatic alkyl),
// 4: OH (Alcohol), 5: CH3OH (Methanol), 6: H2O (Water), 7: ACOH (Phenol),
// 8: CH2CO (Ketone), 9: CHO (Aldehyde), 10: CCOO (Ester), 11: CH2O (Ether / THF / Epoxide),
// 12: CNH2 (Primary amine), 13: CNH (Secondary amine), 14: (C)3N (Tertiary amine),
// 15: ACNH2 (Aniline), 16: CCN (Nitrile), 17: COOH (Carboxylic acid),
// 18: CCl (Monochloro), 19: CCl2 (Dichloro), 20: CCl3 (Trichloro/Tetrachloro),
// 21: DMF (Dialkylamide / NMP), 22: DMSO (Sulfoxide), 23: CCOO_carbonate (Dialkyl/Cyclic Carbonate),
// 24: PYRIDINE (Pyridine)
const SG_DEFS: SgDef[] = [
  { id: 'CH3', main: 0, R: 0.9011, Q: 0.8480, labelKo: '-CH₃ (메틸)' },
  { id: 'CH2', main: 0, R: 0.6744, Q: 0.5400, labelKo: '-CH₂- (메틸렌/환형)' },
  { id: 'CH', main: 0, R: 0.4469, Q: 0.2280, labelKo: '>CH- (메틴)' },
  { id: 'C', main: 0, R: 0.2195, Q: 0.0000, labelKo: '>C< (4급 탄소)' },
  { id: 'CH2=CH', main: 1, R: 1.3454, Q: 1.1760, labelKo: 'CH₂=CH- (비닐/올레핀)' },
  { id: 'CH=CH', main: 1, R: 1.1167, Q: 0.8670, labelKo: '-CH=CH- (내부 올레핀)' },
  { id: 'CH2=C', main: 1, R: 1.1173, Q: 0.9880, labelKo: 'CH₂=C< (이소부텐형)' },
  { id: 'ACH', main: 2, R: 0.5313, Q: 0.4000, labelKo: 'ACH (방향족 CH)' },
  { id: 'AC', main: 2, R: 0.3652, Q: 0.1200, labelKo: 'AC (방향족 치환 C)' },
  { id: 'ACCH3', main: 3, R: 1.2663, Q: 0.9680, labelKo: 'AC-CH₃ (방향족 메틸)' },
  { id: 'ACCH2', main: 3, R: 1.0396, Q: 0.6600, labelKo: 'AC-CH₂- (방향족 에틸/벤질)' },
  { id: 'ACCH', main: 3, R: 0.8121, Q: 0.3480, labelKo: 'AC-CH< (큐멘형)' },
  { id: 'OH', main: 4, R: 1.0000, Q: 1.2000, labelKo: '-OH (알코올 하이드록시)' },
  { id: 'CH3OH', main: 5, R: 1.4311, Q: 1.4320, labelKo: 'CH₃OH (메탄올)' },
  { id: 'H2O', main: 6, R: 0.9200, Q: 1.4000, labelKo: 'H₂O (물)' },
  { id: 'ACOH', main: 7, R: 0.8952, Q: 0.6800, labelKo: 'AC-OH (페놀성 OH)' },
  { id: 'CH3CO', main: 8, R: 1.6724, Q: 1.4880, labelKo: 'CH₃C=O (메틸케톤)' },
  { id: 'CH2CO', main: 8, R: 1.4457, Q: 1.1800, labelKo: '-CH₂C=O (사슬/환형 케톤)' },
  { id: 'CHO', main: 9, R: 0.9980, Q: 0.9480, labelKo: '-CHO (알데하이드)' },
  { id: 'CH3COO', main: 10, R: 1.9031, Q: 1.7280, labelKo: 'CH₃COO- (아세테이트 에스터)' },
  { id: 'CH2COO', main: 10, R: 1.6764, Q: 1.4200, labelKo: '-CH₂COO- (에스터/락톤)' },
  { id: 'HCOO', main: 10, R: 1.2420, Q: 1.1880, labelKo: 'HCOO- (포르메이트)' },
  { id: 'CH3O', main: 11, R: 1.1450, Q: 1.0880, labelKo: 'CH₃O- (메톡시 에테르)' },
  { id: 'CH2O', main: 11, R: 0.9183, Q: 0.7800, labelKo: '-CH₂O- (사슬 에테르)' },
  { id: 'CH2O_cyclic', main: 11, R: 0.9183, Q: 1.1000, labelKo: '-CH₂O- (THF/다이옥산 환형에테르)' },
  { id: 'CHOCH2', main: 11, R: 1.1450, Q: 0.8640, labelKo: '-CH(O)CH₂ (에폭사이드)' },
  { id: 'CH3NH2', main: 12, R: 1.5959, Q: 1.5440, labelKo: 'CH₃NH₂ (메틸아민)' },
  { id: 'CH2NH2', main: 12, R: 1.3692, Q: 1.2360, labelKo: '-CH₂NH₂ (1급 아민)' },
  { id: 'CH3NH', main: 13, R: 1.4337, Q: 1.2440, labelKo: 'CH₃NH- (2급 메틸아민)' },
  { id: 'CH2NH', main: 13, R: 1.2070, Q: 0.9360, labelKo: '-CH₂NH- (2급 아민)' },
  { id: 'CH3N', main: 14, R: 1.1865, Q: 0.9400, labelKo: 'CH₃N< (3급 메틸아민)' },
  { id: 'CH2N', main: 14, R: 0.9597, Q: 0.6320, labelKo: '-CH₂N< (3급 아민)' },
  { id: 'ACNH2', main: 15, R: 1.0600, Q: 0.8160, labelKo: 'AC-NH₂ (아닐린)' },
  { id: 'CH3CN', main: 16, R: 1.8701, Q: 1.7240, labelKo: 'CH₃CN (아세토니트릴)' },
  { id: 'CH2CN', main: 16, R: 1.6434, Q: 1.4160, labelKo: '-CH₂CN / =CHCN (니트릴)' },
  { id: 'COOH', main: 17, R: 1.3013, Q: 1.2240, labelKo: '-COOH (카르복실산)' },
  { id: 'HCOOH', main: 17, R: 1.5280, Q: 1.5320, labelKo: 'HCOOH (포름산)' },
  { id: 'CH2Cl', main: 18, R: 1.4654, Q: 1.2640, labelKo: '-CH₂Cl (1급 염화알킬)' },
  { id: 'CHCl', main: 18, R: 1.2380, Q: 0.9520, labelKo: '>CHCl (2급 염화알킬)' },
  { id: 'ACCl', main: 18, R: 1.1562, Q: 0.8440, labelKo: 'AC-Cl (클로로벤젠)' },
  { id: 'CH2Cl2', main: 19, R: 2.2564, Q: 1.9880, labelKo: 'CH₂Cl₂ (디클로로메탄)' },
  { id: 'CHCl2', main: 19, R: 2.0606, Q: 1.6840, labelKo: '-CHCl₂ (디클로로알킬)' },
  { id: 'CHCl3_g', main: 20, R: 2.8700, Q: 2.4100, labelKo: 'CHCl₃ (클로로포름)' },
  { id: 'CCl4_g', main: 20, R: 3.3900, Q: 2.9100, labelKo: 'CCl₄ (사염화탄소)' },
  { id: 'DMF_g', main: 21, R: 3.0856, Q: 2.7360, labelKo: 'DMF (디메틸포름아마이드)' },
  { id: 'CON(CH2)2', main: 21, R: 2.6322, Q: 2.1200, labelKo: '-CON(CH₂)₂ (NMP/아마이드)' },
  { id: 'DMSO_g', main: 22, R: 2.8266, Q: 2.4720, labelKo: 'DMSO (디메틸설폭사이드)' },
  { id: 'OCOO', main: 23, R: 1.7560, Q: 1.5800, labelKo: '-O-CO-O- (카보네이트: DMC/EC/PC)' },
  { id: 'C5H5N', main: 24, R: 2.9993, Q: 2.1130, labelKo: 'C₅H₅N (피리딘)' },
];

export const UNIFAC_SUBGROUP_META: ReadonlyArray<SgDef> = SG_DEFS;

const SUBGROUPS: UnifacSubGroup[] = SG_DEFS.map(d => d.id);
const N_SG = SUBGROUPS.length;
const SG_R: Float64Array = new Float64Array(SG_DEFS.map(d => d.R));
const SG_Q: Float64Array = new Float64Array(SG_DEFS.map(d => d.Q));
const SG_MAIN: Int32Array = new Int32Array(SG_DEFS.map(d => d.main));
const N_MAIN = 25;

// Hansen et al. (1991, Ind. Eng. Chem. Res. 30, 2352) & Wittig/Gmehling UNIFAC main-group a_mn [K]
const UNIFAC_AMN_FLAT = new Float64Array(N_MAIN * N_MAIN);
function setAmn(m: number, n: number, amn: number, anm: number): void {
  UNIFAC_AMN_FLAT[m * N_MAIN + n] = amn;
  UNIFAC_AMN_FLAT[n * N_MAIN + m] = anm;
}

// 0: CH2 (Alkane) with all main groups
setAmn(0, 1, 86.02, -35.36);
setAmn(0, 2, 61.13, -11.12);
setAmn(0, 3, 76.50, -69.70);
setAmn(0, 4, 986.5, 156.4);
setAmn(0, 5, 697.2, 16.51);
setAmn(0, 6, 1318.0, 300.0);
setAmn(0, 7, 1333.0, 275.8);
setAmn(0, 8, 476.4, 26.76);
setAmn(0, 9, 677.0, 505.7);
setAmn(0, 10, 232.1, 114.8);
setAmn(0, 11, 251.5, 83.36);
setAmn(0, 12, 391.5, -30.48);
setAmn(0, 13, 255.7, 65.33);
setAmn(0, 14, 206.6, -83.98);
setAmn(0, 15, 920.7, 1139.0);
setAmn(0, 16, 597.0, 24.82);
setAmn(0, 17, 663.5, 315.3);
setAmn(0, 18, 35.93, 91.46);
setAmn(0, 19, 53.76, 34.01);
setAmn(0, 20, 24.90, 36.70);
setAmn(0, 21, 485.3, -31.95);
setAmn(0, 22, 526.5, 50.49);
setAmn(0, 23, 385.0, 125.0);
setAmn(0, 24, 287.8, -101.6);

// 1: C=C (Alkene)
setAmn(1, 2, 38.81, 3.446);
setAmn(1, 3, 74.15, -113.6);
setAmn(1, 4, 524.1, 457.0);
setAmn(1, 5, 787.6, -12.52);
setAmn(1, 6, 270.6, 496.1);
setAmn(1, 7, 526.1, 217.5);
setAmn(1, 8, 182.6, 42.92);
setAmn(1, 9, 448.8, 56.30);
setAmn(1, 10, 37.85, 139.4);
setAmn(1, 11, 214.5, 26.51);
setAmn(1, 12, 240.9, 1.163);
setAmn(1, 13, 163.9, -28.70);
setAmn(1, 14, 61.11, -25.38);
setAmn(1, 16, 336.9, 34.78);
setAmn(1, 17, 318.9, 330.0);
setAmn(1, 18, 58.55, 40.25);
setAmn(1, 19, 58.31, -23.50);
setAmn(1, 20, 55.70, -30.48);
setAmn(1, 21, 320.4, -61.70);
setAmn(1, 22, 365.0, 42.0);
setAmn(1, 23, 215.0, 88.0);

// 2: ACH (Aromatic CH)
setAmn(2, 3, 167.0, -146.8);
setAmn(2, 4, 636.1, 89.60);
setAmn(2, 5, 637.4, -50.00);
setAmn(2, 6, 903.8, 362.3);
setAmn(2, 7, 1329.0, 25.34);
setAmn(2, 8, 25.77, 140.1);
setAmn(2, 9, 347.3, 23.39);
setAmn(2, 10, 5.994, 85.84);
setAmn(2, 11, 32.14, 52.13);
setAmn(2, 12, 161.7, -44.85);
setAmn(2, 13, 122.8, -22.31);
setAmn(2, 14, 90.49, -223.9);
setAmn(2, 15, 650.4, -212.5);
setAmn(2, 16, 212.5, -22.97);
setAmn(2, 17, 537.4, 62.32);
setAmn(2, 18, -18.81, 4.68);
setAmn(2, 19, -144.4, 121.3);
setAmn(2, 20, -231.9, 114.2);
setAmn(2, 21, 245.6, -133.9);
setAmn(2, 22, 169.9, -25.87);
setAmn(2, 23, 85.0, 45.0);
setAmn(2, 24, -4.449, 31.87);

// 3: ACCH2 (Aromatic alkyl)
setAmn(3, 4, 803.2, 25.82);
setAmn(3, 5, 603.3, -44.50);
setAmn(3, 6, 1150.0, 377.6);
setAmn(3, 7, 884.9, 244.2);
setAmn(3, 8, -52.10, 365.8);
setAmn(3, 9, 586.8, -106.0);
setAmn(3, 10, 110.0, 42.0);
setAmn(3, 11, 213.1, 65.69);
setAmn(3, 12, 296.4, -29.80);
setAmn(3, 13, 220.0, -15.0);
setAmn(3, 15, 762.8, -181.0);
setAmn(3, 16, 609.6, -138.4);
setAmn(3, 17, 872.3, 89.86);
setAmn(3, 18, -114.1, 122.9);
setAmn(3, 19, -111.0, 140.8);
setAmn(3, 20, -80.25, 141.3);
setAmn(3, 21, 562.9, -240.2);
setAmn(3, 22, 428.4, -143.2);
setAmn(3, 23, 135.0, 32.0);
setAmn(3, 24, 52.80, 49.80);

// 4: OH (Alcohol) with polar groups
setAmn(4, 5, -137.1, 249.1);
setAmn(4, 6, 353.5, -229.1);
setAmn(4, 7, -259.7, -451.6);
setAmn(4, 8, 84.00, 164.5);
setAmn(4, 9, -203.6, 529.0);
setAmn(4, 10, 101.1, 245.4);
setAmn(4, 11, 28.06, 237.7);
setAmn(4, 12, 8.642, -242.8);
setAmn(4, 13, 42.70, -150.0);
setAmn(4, 14, -323.0, 28.60);
setAmn(4, 15, -52.39, 17.97);
setAmn(4, 16, 6.712, 185.4);
setAmn(4, 17, 199.0, -151.0);
setAmn(4, 18, 75.62, 562.2);
setAmn(4, 19, 65.28, 747.7);
setAmn(4, 20, -98.12, 742.1);
setAmn(4, 21, -143.9, 64.16);
setAmn(4, 22, -202.1, -25.87);
setAmn(4, 23, 145.0, 210.0);
setAmn(4, 24, -154.5, 170.0);

// 5: CH3OH (Methanol)
setAmn(5, 6, -181.0, 289.6);
setAmn(5, 7, -101.7, -265.2);
setAmn(5, 8, 23.39, 108.7);
setAmn(5, 9, 306.4, -340.2);
setAmn(5, 10, -10.72, 249.6);
setAmn(5, 11, -128.6, 238.4);
setAmn(5, 12, 359.3, -481.7);
setAmn(5, 13, -20.98, -370.3);
setAmn(5, 14, 53.90, -406.8);
setAmn(5, 15, 489.7, -118.1);
setAmn(5, 16, 53.28, 162.6);
setAmn(5, 17, -202.0, 339.8);
setAmn(5, 18, -38.32, 529.0);
setAmn(5, 19, -102.5, 669.9);
setAmn(5, 20, -139.4, 649.1);
setAmn(5, 21, -172.4, 172.2);
setAmn(5, 22, -399.3, 695.0);
setAmn(5, 23, 52.0, 285.0);
setAmn(5, 24, -58.04, 378.2);

// 6: H2O (Water) with remaining polar/organic groups
setAmn(6, 7, 324.5, -601.8);
setAmn(6, 8, -195.4, 472.5);
setAmn(6, 9, -116.0, 480.8);
setAmn(6, 10, 72.87, 200.8);
setAmn(6, 11, 540.5, -314.7);
setAmn(6, 12, -330.4, 48.89);
setAmn(6, 13, -448.2, 168.0);
setAmn(6, 14, -598.8, 304.0);
setAmn(6, 15, -341.6, 243.2);
setAmn(6, 16, 112.6, 242.8);
setAmn(6, 17, -14.09, -66.17);
setAmn(6, 18, 497.5, 798.4);
setAmn(6, 19, 370.4, 708.7);
setAmn(6, 20, 353.7, 826.8);
setAmn(6, 21, 319.0, -287.1);
setAmn(6, 22, -139.0, -240.0);
setAmn(6, 23, 185.0, 265.0);
setAmn(6, 24, -332.9, 459.0);

// 7..24 Cross-interactions among polar groups (Hansen 1991)
setAmn(7, 8, -356.1, -133.1);
setAmn(7, 10, -449.4, -36.72);
setAmn(7, 11, -162.9, -178.5);
setAmn(7, 17, 408.9, -11.00);
setAmn(8, 9, -37.36, 128.0);
setAmn(8, 10, -213.7, 372.2);
setAmn(8, 11, -103.6, 191.7);
setAmn(8, 16, 481.7, -287.5);
setAmn(8, 17, 669.4, -297.8);
setAmn(8, 18, -191.7, 286.3);
setAmn(8, 19, -130.3, 82.86);
setAmn(8, 20, -354.6, 39.63);
setAmn(8, 21, 97.04, -61.70);
setAmn(8, 22, -44.58, 110.4);
setAmn(8, 23, -65.0, 120.0);
setAmn(10, 11, -235.7, 461.3);
setAmn(10, 16, 494.6, -266.6);
setAmn(10, 17, 660.2, -256.3);
setAmn(10, 18, 35.38, 108.9);
setAmn(10, 19, -132.9, 108.9);
setAmn(10, 20, -209.7, 54.57);
setAmn(10, 21, 85.33, -82.12);
setAmn(10, 23, -25.0, 48.0);
setAmn(11, 12, -78.36, 222.1);
setAmn(11, 16, -18.51, 95.18);
setAmn(11, 17, 664.6, -338.5);
setAmn(11, 18, 301.1, -18.5);
setAmn(11, 19, 137.8, -98.2);
setAmn(11, 20, -154.3, -22.0);
setAmn(11, 21, 254.8, -158.2);
setAmn(11, 23, 62.0, 35.0);
setAmn(17, 18, 13.41, 519.9);
setAmn(17, 19, -44.7, 543.3);
setAmn(17, 20, 39.63, 504.2);
setAmn(17, 21, -295.0, -98.0);
setAmn(18, 19, 108.3, -84.5);
setAmn(18, 20, 108.3, -68.55);
setAmn(21, 22, 136.6, -97.97);
setAmn(21, 23, -45.0, 65.0);
setAmn(22, 23, -38.0, 55.0);

// 성분별 UNIFAC 작용기 분해 정의 (66종 중 유기물·수계·사용자정의 슬롯 전수 매핑)
const COMP_UNIFAC_GROUPS: Partial<Record<SimCompKey, Partial<Record<UnifacSubGroup, number>>>> = {
  H2O: { H2O: 1 },
  Glycerol: { CH2: 2, CH: 1, OH: 3 },
  MCH: { CH2Cl: 1, CH: 1, CH2: 1, OH: 2 },
  DCH: { CH2Cl: 2, CH: 1, OH: 1 },
  ECH: { CH2Cl: 1, CHOCH2: 1 },
  DCP: { CH2Cl: 1, CHCl: 1, CH2: 1 },
  C2H4: { 'CH2=CH': 1 },
  C2H6: { CH3: 2 },
  C3H6: { CH3: 1, 'CH2=CH': 1 },
  C3H8: { CH3: 2, CH2: 1 },
  nC4H10: { CH3: 2, CH2: 2 },
  nC6H14: { CH3: 2, CH2: 4 },
  nC7H16: { CH3: 2, CH2: 5 },
  Benzene: { ACH: 6 },
  Toluene: { ACH: 5, ACCH3: 1 },
  pXylene: { ACH: 4, ACCH3: 2 },
  MeOH: { CH3OH: 1 },
  EtOH: { CH3: 1, CH2: 1, OH: 1 },
  IPA: { CH3: 2, CH: 1, OH: 1 },
  Acetone: { CH3: 1, CH3CO: 1 },
  AceticAcid: { CH3: 1, COOH: 1 },
  EtOAc: { CH3: 1, CH2: 1, CH3COO: 1 },
  CHCl3: { CHCl3_g: 1 },
  // 2차 확장 26종 유기/수계 매핑
  iC4H10: { CH3: 3, CH: 1 },
  C4H8_1: { CH3: 1, CH2: 1, 'CH2=CH': 1 },
  nC5H12: { CH3: 2, CH2: 3 },
  nC8H18: { CH3: 2, CH2: 6 },
  Cyclohexane: { CH2: 6 },
  Ethylbenzene: { ACH: 5, ACCH2: 1, CH3: 1 },
  Styrene: { ACH: 5, AC: 1, 'CH2=CH': 1 },
  Cumene: { ACH: 5, ACCH: 1, CH3: 2 },
  Phenol: { ACH: 5, ACOH: 1 },
  THF: { CH2: 3, CH2O_cyclic: 1 },
  DMF: { DMF_g: 1 },
  DMSO: { DMSO_g: 1 },
  MTBE: { CH3: 3, C: 1, CH3O: 1 },
  MEK: { CH3: 1, CH2: 1, CH3CO: 1 },
  DMC: { CH3: 2, OCOO: 1 },
  EG: { CH2: 2, OH: 2 },
  MEA: { CH2: 1, OH: 1, CH2NH2: 1 },
  MDEA: { CH2: 4, OH: 2, CH3N: 1 },
  FormicAcid: { HCOOH: 1 },
  CH3Cl: { CH2Cl: 1 },
  CH2Cl2: { CH2Cl2: 1 },
  CCl4: { CCl4_g: 1 },
  C2Cl4: { 'CH=CH': 1, CCl4_g: 1 },
  COCl2: { CHCl2: 1 },
  MCB: { ACH: 5, ACCl: 1 },
  Aniline: { ACH: 5, ACNH2: 1 },
  MDA: { ACH: 8, ACCH2: 1, ACNH2: 2 },
  // 기본 CUSTOM_1 = 1-Butanol, CUSTOM_2 = Aniline (런타임 동적 교체 가능)
  CUSTOM_1: { CH3: 1, CH2: 3, OH: 1 },
  CUSTOM_2: { ACH: 5, ACNH2: 1 },
  // 전자소재/반도체 습식 케미컬 유기 용매
  NMP: { CH3: 1, CH2: 1, 'CON(CH2)2': 1 },
  BCS: { CH3: 1, CH2: 4, CH2O: 1, OH: 1 },
  // 아라미드 TPC 염소화 공정 3종
  HCPX: { ACH: 4, AC: 2, CCl4_g: 2 },
  TPA: { ACH: 4, AC: 2, COOH: 2 },
  TPC: { ACH: 4, AC: 2, CH2CO: 2, CHCl2: 1 },
};

// 성분별 사전 계산된 r_i, q_i 및 ν_k^(i)
const COMP_HAS_UNIFAC = new Uint8Array(N_ALL);
const COMP_R = new Float64Array(N_ALL);
const COMP_Q = new Float64Array(N_ALL);
const COMP_NU = new Float64Array(N_ALL * N_SG);

function rebuildUnifacCompRow(ci: number): void {
  const k = ALL_KEYS[ci];
  const grp = COMP_UNIFAC_GROUPS[k];
  COMP_NU.fill(0, ci * N_SG, (ci + 1) * N_SG);
  if (!grp) {
    COMP_HAS_UNIFAC[ci] = 0;
    COMP_R[ci] = 0;
    COMP_Q[ci] = 0;
    return;
  }
  let rSum = 0;
  let qSum = 0;
  for (let si = 0; si < N_SG; si++) {
    const sg = SUBGROUPS[si];
    const nu = grp[sg] ?? 0;
    COMP_NU[ci * N_SG + si] = nu;
    rSum += nu * SG_R[si];
    qSum += nu * SG_Q[si];
  }
  if (rSum > 1e-9 && qSum > 1e-9) {
    COMP_HAS_UNIFAC[ci] = 1;
    COMP_R[ci] = rSum;
    COMP_Q[ci] = qSum;
  } else {
    COMP_HAS_UNIFAC[ci] = 0;
    COMP_R[ci] = 0;
    COMP_Q[ci] = 0;
  }
}

for (let ci = 0; ci < N_ALL; ci++) rebuildUnifacCompRow(ci);

/** 런타임에 CUSTOM_1 / CUSTOM_2 등의 UNIFAC 작용기 구성을 갱신 */
export function setComponentUnifacGroups(
  comp: SimCompKey,
  groups: Partial<Record<UnifacSubGroup, number>> | undefined
): { r: number; q: number } {
  const ci = COMP_IDX[comp];
  if (ci === undefined) return { r: 0, q: 0 };
  if (groups && Object.keys(groups).length > 0) {
    COMP_UNIFAC_GROUPS[comp] = { ...groups };
  } else {
    delete COMP_UNIFAC_GROUPS[comp];
  }
  rebuildUnifacCompRow(ci);
  return { r: COMP_R[ci], q: COMP_Q[ci] };
}

export function getComponentUnifacGroups(
  comp: SimCompKey
): Partial<Record<UnifacSubGroup, number>> | undefined {
  return COMP_UNIFAC_GROUPS[comp];
}

export function setComponentHydrophobic(comp: SimCompKey, isHydrophobic: boolean): void {
  if (isHydrophobic) HYDROPHOBIC_ORGS.add(comp);
  else HYDROPHOBIC_ORGS.delete(comp);
}

export function updateActivityCompMW(comp: SimCompKey, mw: number): void {
  if (mw > 0) COMP_MW[comp] = mw;
}

export function clearNrtlBipForSlot(slot: SimCompKey): void {
  const ci = COMP_IDX[slot];
  if (ci === undefined) return;
  for (let j = 0; j < N_ALL; j++) {
    NRTL_HAS_MAT[ci * N_ALL + j] = 0;
    NRTL_HAS_MAT[j * N_ALL + ci] = 0;
  }
}

// UNIFAC Zero-Allocation 버퍼
const _ufPsi = new Float64Array(N_SG * N_SG);
const _ufPsiInvTK = new Float64Array(N_SG * N_SG).fill(-1);
const _ufThetaMix = new Float64Array(N_SG);
const _ufDenomMix = new Float64Array(N_SG);
const _ufLnGkMix = new Float64Array(N_SG);
const _ufThetaPure = new Float64Array(N_SG);
const _ufDenomPure = new Float64Array(N_SG);
const _ufLnGkPure = new Float64Array(N_SG);
const _ufActiveSg = new Int32Array(N_SG);

function _ensureUnifacPsiActive(actSg: Int32Array, nSgAct: number, invTK: number): void {
  for (let idx = 0; idx < nSgAct; idx++) {
    const m = actSg[idx];
    const mm = SG_MAIN[m] * N_MAIN;
    const rowOff = m * N_SG;
    for (let jdx = 0; jdx < nSgAct; jdx++) {
      const n = actSg[jdx];
      const cell = rowOff + n;
      if (_ufPsiInvTK[cell] !== invTK) {
        _ufPsi[cell] = Math.exp(-UNIFAC_AMN_FLAT[mm + SG_MAIN[n]] * invTK);
        _ufPsiInvTK[cell] = invTK;
      }
    }
  }
}

function _calcPureGroupLnGammaActive(
  compIdx: number,
  actSg: Int32Array,
  nSgAct: number,
  outArr: Float64Array
): void {
  const qTot = COMP_Q[compIdx];
  if (qTot <= 1e-12) {
    for (let idx = 0; idx < nSgAct; idx++) outArr[actSg[idx]] = 0;
    return;
  }
  const cOff = compIdx * N_SG;
  for (let idx = 0; idx < nSgAct; idx++) {
    const m = actSg[idx];
    _ufThetaPure[m] = (COMP_NU[cOff + m] * SG_Q[m]) / qTot;
  }
  for (let idx = 0; idx < nSgAct; idx++) {
    const m = actSg[idx];
    let d = 0;
    for (let jdx = 0; jdx < nSgAct; jdx++) {
      const n = actSg[jdx];
      if (_ufThetaPure[n] > 0) d += _ufThetaPure[n] * _ufPsi[n * N_SG + m];
    }
    _ufDenomPure[m] = d;
  }
  for (let idx = 0; idx < nSgAct; idx++) {
    const k = actSg[idx];
    if (COMP_NU[cOff + k] <= 0) {
      outArr[k] = 0;
      continue;
    }
    const sum1 = _ufDenomPure[k];
    let sum2 = 0;
    const kOff = k * N_SG;
    for (let jdx = 0; jdx < nSgAct; jdx++) {
      const m = actSg[jdx];
      const th = _ufThetaPure[m];
      if (th > 0 && _ufDenomPure[m] > 1e-15) {
        sum2 += (th * _ufPsi[kOff + m]) / _ufDenomPure[m];
      }
    }
    outArr[k] = SG_Q[k] * (1.0 - Math.log(Math.max(1e-15, sum1)) - sum2);
  }
}

/**
 * 다성분 Hansen (1991) UNIFAC 엄밀 활동도 계수 계산 (Zero-Allocation 내부 커널):
 *   ln γ_i = ln γ_i^C + ln γ_i^R
 */
function _evalMultiCompUnifacLnGamma(
  compIndices: Int32Array,
  xNorm: Float64Array,
  nComp: number,
  invTK: number,
  lnGammaOut: Float64Array
): void {
  let rBar = 0;
  let qBar = 0;
  for (let i = 0; i < nComp; i++) {
    const ci = compIndices[i];
    const xi = xNorm[i];
    rBar += xi * COMP_R[ci];
    qBar += xi * COMP_Q[ci];
  }
  rBar = Math.max(1e-12, rBar);
  qBar = Math.max(1e-12, qBar);

  // Collect active subgroups present in any of the nComp components (even if x_i == 0 for infinite dilution!)
  let nSgAct = 0;
  for (let s = 0; s < N_SG; s++) {
    let present = false;
    let qMixS = 0;
    for (let i = 0; i < nComp; i++) {
      const nu = COMP_NU[compIndices[i] * N_SG + s];
      if (nu > 0) {
        present = true;
        qMixS += xNorm[i] * nu * SG_Q[s];
      }
    }
    if (present) {
      _ufActiveSg[nSgAct++] = s;
      _ufThetaMix[s] = qMixS / qBar;
    }
  }

  _ensureUnifacPsiActive(_ufActiveSg, nSgAct, invTK);

  // Mixture group denominators Σ_n Θ_n Ψ_{n,m}
  for (let idx = 0; idx < nSgAct; idx++) {
    const m = _ufActiveSg[idx];
    let d = 0;
    for (let jdx = 0; jdx < nSgAct; jdx++) {
      const n = _ufActiveSg[jdx];
      const thN = _ufThetaMix[n];
      if (thN > 0) d += thN * _ufPsi[n * N_SG + m];
    }
    _ufDenomMix[m] = d;
  }

  // Mixture group residual ln Γ_k
  for (let idx = 0; idx < nSgAct; idx++) {
    const k = _ufActiveSg[idx];
    const sum1 = _ufDenomMix[k];
    let sum2 = 0;
    const kOff = k * N_SG;
    for (let jdx = 0; jdx < nSgAct; jdx++) {
      const m = _ufActiveSg[jdx];
      const thM = _ufThetaMix[m];
      if (thM > 0 && _ufDenomMix[m] > 1e-15) {
        sum2 += (thM * _ufPsi[kOff + m]) / _ufDenomMix[m];
      }
    }
    _ufLnGkMix[k] = SG_Q[k] * (1.0 - Math.log(Math.max(1e-15, sum1)) - sum2);
  }

  // Component combinatorial + residual ln γ_i = ln γ_i^C + ln γ_i^R
  for (let i = 0; i < nComp; i++) {
    const ci = compIndices[i];
    const ri = COMP_R[ci];
    const qi = COMP_Q[ci];
    const vOverX = Math.max(1e-12, ri / rBar);
    const vOverF = Math.max(1e-12, (ri * qBar) / (rBar * Math.max(1e-12, qi)));

    // Exact Staverman-Guggenheim combinatorial part (z = 10):
    const lnGammaC =
      Math.log(vOverX) +
      1.0 -
      vOverX -
      5.0 * qi * (Math.log(vOverF) + 1.0 - vOverF);

    _calcPureGroupLnGammaActive(ci, _ufActiveSg, nSgAct, _ufLnGkPure);

    let lnGammaR = 0;
    const cOff = ci * N_SG;
    for (let idx = 0; idx < nSgAct; idx++) {
      const k = _ufActiveSg[idx];
      const nu = COMP_NU[cOff + k];
      if (nu > 0) {
        lnGammaR += nu * (_ufLnGkMix[k] - _ufLnGkPure[k]);
      }
    }
    lnGammaOut[i] = Math.max(-12.0, Math.min(14.0, lnGammaC + lnGammaR));
  }
}

const _pairIdx = new Int32Array(2);
const _pairX = new Float64Array(2);
const _pairLnG = new Float64Array(2);
const _ufPairReady = new Uint8Array(N_ALL * N_ALL);
const _ufPairA = new Float64Array(N_ALL * N_ALL);
const _ufPairB = new Float64Array(N_ALL * N_ALL);

function estimateUnifacTauPairRaw(ci: number, cj: number, invTK: number): [number, number] {
  _pairIdx[0] = ci;
  _pairIdx[1] = cj;

  _pairX[0] = 1e-4;
  _pairX[1] = 1.0 - 1e-4;
  _evalMultiCompUnifacLnGamma(_pairIdx, _pairX, 2, invTK, _pairLnG);
  const lnG1Inf = Math.max(-8.0, Math.min(12.0, _pairLnG[0]));

  _pairX[0] = 1.0 - 1e-4;
  _pairX[1] = 1e-4;
  _evalMultiCompUnifacLnGamma(_pairIdx, _pairX, 2, invTK, _pairLnG);
  const lnG2Inf = Math.max(-8.0, Math.min(12.0, _pairLnG[1]));

  const alpha = 0.30;
  let tau12 = 0.5 * lnG2Inf;
  let tau21 = 0.5 * lnG1Inf;
  for (let it = 0; it < 5; it++) {
    tau21 = Math.max(-6.0, Math.min(10.0, lnG1Inf - tau12 * Math.exp(-alpha * tau12)));
    tau12 = Math.max(-6.0, Math.min(10.0, lnG2Inf - tau21 * Math.exp(-alpha * tau21)));
  }
  return [tau12, tau21];
}

/** 하이브리드 다성분계(일부 NRTL 보정쌍 + 일부 UNIFAC 미보정쌍 공존)용 UNIFAC → 등가 NRTL τ_ij(T) 고속 캐시 추출 */
function estimateUnifacTauPair(ci: number, cj: number, invTK: number): [number, number] {
  if (!COMP_HAS_UNIFAC[ci] || !COMP_HAS_UNIFAC[cj]) return [0, 0];
  const m12 = ci * N_ALL + cj;
  const m21 = cj * N_ALL + ci;
  if (!_ufPairReady[m12]) {
    const invT1 = 1.0 / 313.15;
    const invT2 = 1.0 / 393.15;
    const [t12_1, t21_1] = estimateUnifacTauPairRaw(ci, cj, invT1);
    const [t12_2, t21_2] = estimateUnifacTauPairRaw(ci, cj, invT2);
    const dInv = invT1 - invT2;
    const b12 = (t12_1 - t12_2) / dInv;
    const a12 = t12_1 - b12 * invT1;
    const b21 = (t21_1 - t21_2) / dInv;
    const a21 = t21_1 - b21 * invT1;
    _ufPairA[m12] = a12;
    _ufPairB[m12] = b12;
    _ufPairA[m21] = a21;
    _ufPairB[m21] = b21;
    _ufPairReady[m12] = 1;
    _ufPairReady[m21] = 1;
  }
  const tau12 = Math.max(-6.0, Math.min(10.0, _ufPairA[m12] + _ufPairB[m12] * invTK));
  const tau21 = Math.max(-6.0, Math.min(10.0, _ufPairA[m21] + _ufPairB[m21] * invTK));
  return [tau12, tau21];
}

// Zero-Allocation 행렬 버퍼
const _idxBuf = new Int32Array(N_ALL);
const _nrtlSlotBuf = new Int32Array(N_ALL);
const _xBuf = new Float64Array(N_ALL);
const _lnGUnifacBuf = new Float64Array(N_ALL);
const _gammaDenseBuf = new Float64Array(N_ALL);
const _tauBuf = new Float64Array(N_ALL * N_ALL);
const _gBuf = new Float64Array(N_ALL * N_ALL);
const _sBuf = new Float64Array(N_ALL);
const _qBuf = new Float64Array(N_ALL);
let _nrtlLastInvTK = -1;
let _nrtlLastN = -1;
const _nrtlLastIdx = new Int32Array(N_ALL);

export interface ActivityEvalDiagnostics {
  unifacPairs: string[];
  idealFallbackPairs: string[];
}

/**
 * 순수 다성분 Hansen (1991) UNIFAC 활동도 계수 직접 평가기 (검증 및 그룹기여 예측용)
 *   γ_i = exp(ln γ_i^C + ln γ_i^R)
 */
export function calcUnifacGamma(
  activeComps: readonly SimCompKey[],
  xMol: Partial<Record<SimCompKey, number>>,
  T_C: number
): Record<SimCompKey, number> {
  const gamma: Record<SimCompKey, number> = {} as Record<SimCompKey, number>;
  for (let i = 0; i < N_ALL; i++) gamma[ALL_KEYS[i]] = 1.0;

  const T_K = Math.max(200, Math.min(700, T_C + 273.15));
  let n = 0;
  let xSum = 0;
  for (let idx = 0; idx < activeComps.length; idx++) {
    const c = activeComps[idx];
    const ci = COMP_IDX[c];
    if (ci === undefined || !COMP_HAS_UNIFAC[ci]) continue;
    const xv = Math.max(0, xMol[c] || 0);
    _idxBuf[n] = ci;
    _xBuf[n] = xv;
    xSum += xv;
    n++;
  }
  if (n <= 1 || xSum <= 1e-12) return gamma;
  for (let i = 0; i < n; i++) _xBuf[i] /= xSum;

  _evalMultiCompUnifacLnGamma(_idxBuf, _xBuf, n, 1.0 / T_K, _lnGUnifacBuf);
  for (let i = 0; i < n; i++) {
    gamma[ALL_KEYS[_idxBuf[i]]] = Math.exp(_lnGUnifacBuf[i]);
  }
  return gamma;
}

/**
 * Extended NRTL (τ_ij = a_ij + b_ij/T, α_ij) + 다성분 Hansen (1991) UNIFAC 직접 폴백 활동도 계수 계산기
 * - 모든 유기 쌍이 NRTL_BIP_DATABANK에 있으면 보정된 Extended NRTL 수행
 * - 보정된 NRTL 쌍이 없고 UNIFAC 그룹이 완비된 혼합물(신규 유기계 · CUSTOM_1/2 포함)은
 *   근사 없이 직접 다성분 UNIFAC (ln γ_i = ln γ_i^C + ln γ_i^R) 평가!
 * - 보정 쌍과 미보정 쌍이 섞인 다성분계는 보정 쌍은 NRTL 유지 + 미보정 쌍은 UNIFAC 투영 결합
 */
const ZERO_ACT_TEMPLATE: Record<SimCompKey, number> = {
  H2O: 0, NaCl: 0, NaOH: 0, Cl2: 0, H2: 0, HCl: 0, H2SO4: 0, O2: 0, NaOCl: 0,
  N2: 0, NaClO3: 0, FeCl2: 0, FeCl3: 0, PAC: 0, Glycerol: 0, MCH: 0, DCH: 0, ECH: 0, DCP: 0,
  CH4: 0, CO: 0, CO2: 0, NH3: 0,
  C2H4: 0, C2H6: 0, C3H6: 0, C3H8: 0, nC4H10: 0, nC6H14: 0, nC7H16: 0,
  Benzene: 0, Toluene: 0, pXylene: 0,
  MeOH: 0, EtOH: 0, IPA: 0, Acetone: 0, AceticAcid: 0, EtOAc: 0, CHCl3: 0,
  Ar: 0, H2S: 0, SO2: 0, SO3: 0, iC4H10: 0, C4H8_1: 0, nC5H12: 0, nC8H18: 0,
  Cyclohexane: 0, Ethylbenzene: 0, Styrene: 0, Cumene: 0, Phenol: 0, THF: 0, DMF: 0, DMSO: 0,
  MTBE: 0, MEK: 0, DMC: 0, EG: 0, MEA: 0, MDEA: 0, FormicAcid: 0, HNO3: 0,
  CH3Cl: 0, CH2Cl2: 0, CCl4: 0, C2Cl4: 0,
  COCl2: 0, HCHO: 0, MCB: 0, Aniline: 0, MDA: 0, MDI: 0, PMDI: 0, CUSTOM_1: 0, CUSTOM_2: 0,
  H2O2: 0, H3PO4: 0, HF: 0, KOH: 0, NH4OH: 0, TMAH: 0, NMP: 0, BCS: 0, Na2CO3: 0, NaHSO3: 0, CaOH2: 0,
  HCPX: 0, TPA: 0, TPC: 0, Si: 0, DCS: 0, TCS: 0, STC: 0,
};

const ONE_ACT_TEMPLATE: Record<SimCompKey, number> = {
  H2O: 1, NaCl: 1, NaOH: 1, Cl2: 1, H2: 1, HCl: 1, H2SO4: 1, O2: 1, NaOCl: 1,
  N2: 1, NaClO3: 1, FeCl2: 1, FeCl3: 1, PAC: 1, Glycerol: 1, MCH: 1, DCH: 1, ECH: 1, DCP: 1,
  CH4: 1, CO: 1, CO2: 1, NH3: 1,
  C2H4: 1, C2H6: 1, C3H6: 1, C3H8: 1, nC4H10: 1, nC6H14: 1, nC7H16: 1,
  Benzene: 1, Toluene: 1, pXylene: 1,
  MeOH: 1, EtOH: 1, IPA: 1, Acetone: 1, AceticAcid: 1, EtOAc: 1, CHCl3: 1,
  Ar: 1, H2S: 1, SO2: 1, SO3: 1, iC4H10: 1, C4H8_1: 1, nC5H12: 1, nC8H18: 1,
  Cyclohexane: 1, Ethylbenzene: 1, Styrene: 1, Cumene: 1, Phenol: 1, THF: 1, DMF: 1, DMSO: 1,
  MTBE: 1, MEK: 1, DMC: 1, EG: 1, MEA: 1, MDEA: 1, FormicAcid: 1, HNO3: 1,
  CH3Cl: 1, CH2Cl2: 1, CCl4: 1, C2Cl4: 1,
  COCl2: 1, HCHO: 1, MCB: 1, Aniline: 1, MDA: 1, MDI: 1, PMDI: 1, CUSTOM_1: 1, CUSTOM_2: 1,
  H2O2: 1, H3PO4: 1, HF: 1, KOH: 1, NH4OH: 1, TMAH: 1, NMP: 1, BCS: 1, Na2CO3: 1, NaHSO3: 1, CaOH2: 1,
  HCPX: 1, TPA: 1, TPC: 1, Si: 1, DCS: 1, TCS: 1, STC: 1,
};

function _evalExtendedNrtlDenseCore(
  n: number,
  allHaveUnifac: boolean,
  T_K: number,
  invTK: number,
  xH2O: number,
  xSalt: number,
  gammaDenseOut: Float64Array,
  diagOut?: ActivityEvalDiagnostics
): void {
  const saltMolality = xH2O > 0.02 && xSalt > 1e-5 ? Math.min(8.0, (xSalt / xH2O) * 55.508) : 0;

  let hasAnyCalibratedNrtl = false;
  for (let i = 0; i < n && !hasAnyCalibratedNrtl; i++) {
    const ci = _idxBuf[i];
    for (let j = i + 1; j < n; j++) {
      if (NRTL_HAS_MAT[ci * N_ALL + _idxBuf[j]]) {
        hasAnyCalibratedNrtl = true;
        break;
      }
    }
  }

  const applySaltingOut = (key: SimCompKey, baseLnGamma: number): number => {
    let saltShift = 0;
    if (saltMolality > 0) {
      const se = SECHENOV_DATABANK[key];
      const ksBase = se ? (se.ks_NaCl_298 ?? se.ks_NaOH_298) : null;
      if (ksBase !== null && ksBase !== undefined) {
        const ksT = Math.max(0.02, ksBase + (se?.dKs_dT ?? 0) * (T_K - 298.15));
        saltShift = Math.LN10 * ksT * saltMolality;
      } else if (HYDROPHOBIC_ORGS.has(key)) {
        saltShift = 0.21 * saltMolality;
      }
    }
    return Math.exp(Math.max(-12.0, Math.min(14.0, baseLnGamma + saltShift)));
  };

  if (!hasAnyCalibratedNrtl && allHaveUnifac) {
    if (diagOut) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const label = `${ALL_KEYS[_idxBuf[i]]}-${ALL_KEYS[_idxBuf[j]]}`;
          if (!diagOut.unifacPairs.includes(label)) diagOut.unifacPairs.push(label);
        }
      }
    }
    _evalMultiCompUnifacLnGamma(_idxBuf, _xBuf, n, invTK, _lnGUnifacBuf);
    for (let i = 0; i < n; i++) {
      gammaDenseOut[i] = applySaltingOut(ALL_KEYS[_idxBuf[i]], _lnGUnifacBuf[i]);
    }
    return;
  }

  let sameAsLastT = !diagOut && _nrtlLastInvTK === invTK && _nrtlLastN === n;
  if (sameAsLastT) {
    for (let i = 0; i < n; i++) {
      if (_idxBuf[i] !== _nrtlLastIdx[i]) {
        sameAsLastT = false;
        break;
      }
    }
  }

  if (!sameAsLastT) {
    for (let i = 0; i < n; i++) {
      const ci = _idxBuf[i];
      const rowOff = i * n;
      _tauBuf[rowOff + i] = 0;
      _gBuf[rowOff + i] = 1.0;
      for (let j = i + 1; j < n; j++) {
        const cj = _idxBuf[j];
        const m12 = ci * N_ALL + cj;
        const m21 = cj * N_ALL + ci;
        let tau12 = 0;
        let tau21 = 0;
        let alpha = 0.30;

        if (NRTL_HAS_MAT[m12]) {
          tau12 = NRTL_A_MAT[m12] + NRTL_B_MAT[m12] * invTK;
          tau21 = NRTL_A_MAT[m21] + NRTL_B_MAT[m21] * invTK;
          alpha = NRTL_ALPHA_MAT[m12];
        } else if (COMP_HAS_UNIFAC[ci] && COMP_HAS_UNIFAC[cj]) {
          [tau12, tau21] = estimateUnifacTauPair(ci, cj, invTK);
          if (diagOut) {
            const label = `${ALL_KEYS[ci]}-${ALL_KEYS[cj]}`;
            if (!diagOut.unifacPairs.includes(label)) diagOut.unifacPairs.push(label);
          }
        } else if (diagOut && _xBuf[i] > 1e-4 && _xBuf[j] > 1e-4) {
          const label = `${ALL_KEYS[ci]}-${ALL_KEYS[cj]}`;
          if (!diagOut.idealFallbackPairs.includes(label)) diagOut.idealFallbackPairs.push(label);
        }

        _tauBuf[rowOff + j] = tau12;
        _gBuf[rowOff + j] = Math.exp(Math.max(-30, Math.min(30, -alpha * tau12)));
        _tauBuf[j * n + i] = tau21;
        _gBuf[j * n + i] = Math.exp(Math.max(-30, Math.min(30, -alpha * tau21)));
      }
    }
    _nrtlLastInvTK = invTK;
    _nrtlLastN = n;
    for (let i = 0; i < n; i++) _nrtlLastIdx[i] = _idxBuf[i];
  }

  for (let j = 0; j < n; j++) {
    let sj = 0;
    let qj = 0;
    for (let k = 0; k < n; k++) {
      const xk = _xBuf[k];
      const off = k * n + j;
      const xg = xk * _gBuf[off];
      sj += xg;
      qj += xg * _tauBuf[off];
    }
    _sBuf[j] = sj > 1e-12 ? sj : 1e-12;
    _qBuf[j] = qj;
  }

  for (let i = 0; i < n; i++) {
    const term1 = _qBuf[i] / _sBuf[i];
    const iOff = i * n;
    let term2 = 0;
    for (let j = 0; j < n; j++) {
      const sj = _sBuf[j];
      term2 += ((_xBuf[j] * _gBuf[iOff + j]) / sj) * (_tauBuf[iOff + j] - _qBuf[j] / sj);
    }
    gammaDenseOut[i] = applySaltingOut(ALL_KEYS[_idxBuf[i]], term1 + term2);
  }
}

/**
 * Zero-allocation dense Extended NRTL + UNIFAC fallback activity coefficient evaluator.
 * Writes gamma[slot] aligned 1:1 with comps[0..nComps-1].
 */
export function calcExtendedNrtlGammaInto(
  comps: readonly SimCompKey[],
  xArr: ArrayLike<number>,
  nComps: number,
  T_C: number,
  gammaOut: Float64Array,
  diagOut?: ActivityEvalDiagnostics,
  xH2OOverride?: number,
  xSaltOverride?: number
): void {
  const T_K = Math.max(220, Math.min(650, T_C + 273.15));
  const invTK = 1.0 / T_K;

  let n = 0;
  let xSum = 0;
  let allHaveUnifac = true;
  let xH2O = xH2OOverride ?? 0;
  let xSalt = xSaltOverride ?? 0;
  const readAqFromArr = xH2OOverride === undefined;

  for (let slot = 0; slot < nComps; slot++) {
    gammaOut[slot] = 1.0;
    const c = comps[slot];
    const xv = Math.max(0, xArr[slot] || 0);
    if (readAqFromArr) {
      if (c === 'H2O') xH2O = xv;
      else if (c === 'NaCl' || c === 'NaOH') xSalt += xv;
    }
    if (PERMANENT_GAS_SET.has(c) || NON_VOLATILE_SET.has(c)) continue;
    const ci = COMP_IDX[c];
    _idxBuf[n] = ci;
    _nrtlSlotBuf[n] = slot;
    _xBuf[n] = xv;
    if (!COMP_HAS_UNIFAC[ci]) allHaveUnifac = false;
    xSum += xv;
    n++;
  }
  if (n <= 1 || xSum <= 1e-9) return;
  for (let i = 0; i < n; i++) _xBuf[i] /= xSum;

  _evalExtendedNrtlDenseCore(n, allHaveUnifac, T_K, invTK, xH2O, xSalt, _gammaDenseBuf, diagOut);
  for (let i = 0; i < n; i++) {
    gammaOut[_nrtlSlotBuf[i]] = _gammaDenseBuf[i];
  }
}

export function calcExtendedNrtlGamma(
  activeComps: readonly SimCompKey[],
  xMol: Partial<Record<SimCompKey, number>>,
  T_C: number,
  diagOut?: ActivityEvalDiagnostics
): Record<SimCompKey, number> {
  const gamma: Record<SimCompKey, number> = { ...ONE_ACT_TEMPLATE };

  const T_K = Math.max(220, Math.min(650, T_C + 273.15));
  const invTK = 1.0 / T_K;

  // 용존 전해질(NaCl, NaOH) 염석 효과(Sechenov salting-out) 몰랄농도 계산
  const xH2O = Math.max(0, xMol.H2O || 0);
  const xSalt = Math.max(0, (xMol.NaCl || 0) + (xMol.NaOH || 0));

  let n = 0;
  let xSum = 0;
  let allHaveUnifac = true;
  for (let idx = 0; idx < activeComps.length; idx++) {
    const c = activeComps[idx];
    if (PERMANENT_GAS_SET.has(c) || NON_VOLATILE_SET.has(c)) continue;
    const xv = Math.max(0, xMol[c] || 0);
    const ci = COMP_IDX[c];
    _idxBuf[n] = ci;
    _xBuf[n] = xv;
    if (!COMP_HAS_UNIFAC[ci]) allHaveUnifac = false;
    xSum += xv;
    n++;
  }
  if (n <= 1 || xSum <= 1e-9) return gamma;
  for (let i = 0; i < n; i++) _xBuf[i] /= xSum;

  _evalExtendedNrtlDenseCore(n, allHaveUnifac, T_K, invTK, xH2O, xSalt, _gammaDenseBuf, diagOut);
  for (let i = 0; i < n; i++) {
    gamma[ALL_KEYS[_idxBuf[i]]] = _gammaDenseBuf[i];
  }
  return gamma;
}

// ----------------------------------------------------------------------------
// 3. Michelsen Tangent-Plane Stability + Rigorous 2-Liquid LLE Decanter Solver
// ----------------------------------------------------------------------------
export interface LLETieWarmStart {
  beta: number;
  xOrg: Partial<Record<SimCompKey, number>>;
  xAq: Partial<Record<SimCompKey, number>>;
}

export interface LLEDecanterResult {
  phaseSplit: boolean;
  tpdMin: number;
  organicKgH: Record<SimCompKey, number>;
  aqueousKgH: Record<SimCompKey, number>;
  waterInOrgWtPct: number;
  orgInAqWtPct: number;
  iterations: number;
  diagnostics: ActivityEvalDiagnostics;
  tieState?: LLETieWarmStart;
}

const _lleComps: SimCompKey[] = new Array<SimCompKey>(N_ALL);
const _lleIsNonVol = new Uint8Array(N_ALL);
const _lleIsPermGas = new Uint8Array(N_ALL);
const _lleIsHydro = new Uint8Array(N_ALL);
const _lleFeedMass = new Float64Array(N_ALL);
const _lleFeedMol = new Float64Array(N_ALL);
const _lleZ = new Float64Array(N_ALL);
const _lleGFeed = new Float64Array(N_ALL);
const _lleW = new Float64Array(N_ALL);
const _lleGw = new Float64Array(N_ALL);
const _lleXOrg = new Float64Array(N_ALL);
const _lleXAq = new Float64Array(N_ALL);
const _lleKLL = new Float64Array(N_ALL);
const _lleGOrg = new Float64Array(N_ALL);
const _lleGAq = new Float64Array(N_ALL);

export function solveRigorousLLEDecanter(
  feedLiqKgH: Record<SimCompKey, number>,
  T_C: number,
  initTie?: LLETieWarmStart
): LLEDecanterResult {
  const emptyRec = (): Record<SimCompKey, number> => ({ ...ZERO_ACT_TEMPLATE });

  const diag: ActivityEvalDiagnostics = { unifacPairs: [], idealFallbackPairs: [] };
  let nAct = 0;
  let volatileLiqMol = 0;
  let saltMol = 0;
  let hydroOrgKg = 0;
  const h2oKg = Math.max(0, feedLiqKgH.H2O || 0);
  let h2oSlot = -1;

  for (let idx = 0; idx < N_ALL; idx++) {
    const k = ALL_KEYS[idx];
    const m = Math.max(0, feedLiqKgH[k] || 0);
    if (m <= 1e-12) continue;
    const isNv = NON_VOLATILE_SET.has(k) ? 1 : 0;
    const isPg = PERMANENT_GAS_SET.has(k) ? 1 : 0;
    const isHy = HYDROPHOBIC_ORGS.has(k) ? 1 : 0;
    _lleComps[nAct] = k;
    _lleIsNonVol[nAct] = isNv;
    _lleIsPermGas[nAct] = isPg;
    _lleIsHydro[nAct] = isHy;
    _lleFeedMass[nAct] = m;
    const mol = m / COMP_MW[k];
    _lleFeedMol[nAct] = mol;
    if (k === 'H2O') h2oSlot = nAct;
    if (isNv) {
      saltMol += mol;
    } else if (!isPg) {
      volatileLiqMol += mol;
    }
    if (isHy) hydroOrgKg += m;
    nAct++;
  }

  if (hydroOrgKg < 1e-3 || h2oKg < 1e-3 || volatileLiqMol < 1e-6) {
    return {
      phaseSplit: false,
      tpdMin: 0,
      organicKgH: { ...emptyRec(), ...(hydroOrgKg >= h2oKg ? feedLiqKgH : {}) },
      aqueousKgH: { ...emptyRec(), ...(hydroOrgKg < h2oKg ? feedLiqKgH : {}) },
      waterInOrgWtPct: 0,
      orgInAqWtPct: 0,
      iterations: 0,
      diagnostics: diag,
    };
  }

  const totMolAll = volatileLiqMol + saltMol;
  let zH2O = 0;
  let zSalt = 0;
  for (let i = 0; i < nAct; i++) {
    const zVal = _lleFeedMol[i] / totMolAll;
    _lleZ[i] = zVal;
    if (i === h2oSlot) zH2O = zVal;
    else if (_lleComps[i] === 'NaCl' || _lleComps[i] === 'NaOH') zSalt += zVal;
  }
  calcExtendedNrtlGammaInto(_lleComps, _lleZ, nAct, T_C, _lleGFeed, diag, zH2O, zSalt);

  const evalTPD = (trialOrgRich: boolean): number => {
    let wSum = 0;
    for (let i = 0; i < nAct; i++) {
      if (_lleIsNonVol[i] || _lleIsPermGas[i]) {
        _lleW[i] = 0;
        continue;
      }
      let wk: number;
      if (trialOrgRich) {
        wk = _lleIsHydro[i] ? Math.max(1e-5, _lleFeedMol[i]) : i === h2oSlot ? 0.04 * volatileLiqMol : 0.2 * _lleFeedMol[i];
      } else {
        wk = i === h2oSlot ? Math.max(1e-5, _lleFeedMol[i]) : _lleIsHydro[i] ? 0.008 * _lleFeedMol[i] : 0.8 * _lleFeedMol[i];
      }
      _lleW[i] = wk;
      wSum += wk;
    }
    if (!trialOrgRich && saltMol > 0) {
      for (let i = 0; i < nAct; i++) {
        if (_lleIsNonVol[i]) {
          _lleW[i] = _lleFeedMol[i];
          wSum += _lleFeedMol[i];
        }
      }
    }
    if (wSum <= 1e-12) return 0;
    for (let i = 0; i < nAct; i++) _lleW[i] /= wSum;

    for (let st = 0; st < 3; st++) {
      let wH2O = h2oSlot >= 0 ? _lleW[h2oSlot] : 0;
      let wSalt = 0;
      for (let i = 0; i < nAct; i++) {
        if (_lleComps[i] === 'NaCl' || _lleComps[i] === 'NaOH') wSalt += _lleW[i];
      }
      calcExtendedNrtlGammaInto(_lleComps, _lleW, nAct, T_C, _lleGw, undefined, wH2O, wSalt);
      let nextSum = 0;
      for (let i = 0; i < nAct; i++) {
        if (_lleIsNonVol[i] || _lleIsPermGas[i]) continue;
        const zi = Math.max(1e-12, _lleFeedMol[i] / volatileLiqMol);
        _lleW[i] = (zi * _lleGFeed[i]) / Math.max(0.05, _lleGw[i]);
        nextSum += _lleW[i];
      }
      if (!trialOrgRich && saltMol > 0) {
        const scaleSalt = saltMol / Math.max(1e-6, volatileLiqMol);
        for (let i = 0; i < nAct; i++) {
          if (_lleIsNonVol[i]) {
            _lleW[i] = (_lleFeedMol[i] / Math.max(1e-9, saltMol)) * scaleSalt;
            nextSum += _lleW[i];
          }
        }
      }
      const invS = 1.0 / Math.max(1e-12, nextSum);
      for (let i = 0; i < nAct; i++) _lleW[i] *= invS;
    }

    let wH2Of = h2oSlot >= 0 ? _lleW[h2oSlot] : 0;
    let wSaltf = 0;
    for (let i = 0; i < nAct; i++) {
      if (_lleComps[i] === 'NaCl' || _lleComps[i] === 'NaOH') wSaltf += _lleW[i];
    }
    calcExtendedNrtlGammaInto(_lleComps, _lleW, nAct, T_C, _lleGw, undefined, wH2Of, wSaltf);

    let tpd = 0;
    let volWSum = 0;
    for (let i = 0; i < nAct; i++) {
      if (!_lleIsNonVol[i] && !_lleIsPermGas[i]) volWSum += _lleW[i];
    }
    const invVol = 1.0 / Math.max(1e-12, volWSum);
    for (let i = 0; i < nAct; i++) {
      if (_lleIsNonVol[i] || _lleIsPermGas[i]) continue;
      const wi = Math.max(1e-12, _lleW[i] * invVol);
      const zi = Math.max(1e-12, _lleFeedMol[i] / volatileLiqMol);
      tpd += wi * (Math.log(wi) + Math.log(_lleGw[i]) - Math.log(zi) - Math.log(_lleGFeed[i]));
    }
    return tpd;
  };

  const tpdMin = Math.min(evalTPD(true), evalTPD(false));
  if (tpdMin >= -1e-4) {
    const mostlyOrg = hydroOrgKg >= h2oKg;
    return {
      phaseSplit: false,
      tpdMin,
      organicKgH: mostlyOrg ? { ...emptyRec(), ...feedLiqKgH } : emptyRec(),
      aqueousKgH: mostlyOrg ? emptyRec() : { ...emptyRec(), ...feedLiqKgH },
      waterInOrgWtPct: mostlyOrg ? (h2oKg / Math.max(1e-6, hydroOrgKg + h2oKg)) * 100 : 0,
      orgInAqWtPct: !mostlyOrg ? (hydroOrgKg / Math.max(1e-6, hydroOrgKg + h2oKg)) * 100 : 0,
      iterations: 3,
      diagnostics: diag,
    };
  }

  let orgInitMol = 0;
  let warmValid = Boolean(initTie && initTie.beta > 0.002 && initTie.beta < 0.998);
  if (warmValid) {
    let warmOrgSum = 0;
    let warmAqSum = 0;
    for (let i = 0; i < nAct; i++) {
      if (_lleIsNonVol[i] || _lleIsPermGas[i]) continue;
      const k = _lleComps[i];
      const xo = Math.max(0, initTie!.xOrg[k] || 0);
      const xa = Math.max(0, initTie!.xAq[k] || 0);
      _lleXOrg[i] = xo;
      _lleXAq[i] = xa;
      warmOrgSum += xo;
      warmAqSum += xa;
    }
    if (warmOrgSum <= 0.1 || warmAqSum <= 0.1) warmValid = false;
  }
  if (!warmValid) {
    for (let i = 0; i < nAct; i++) {
      if (_lleIsNonVol[i] || _lleIsPermGas[i]) {
        _lleXOrg[i] = 0;
        _lleXAq[i] = 0;
        continue;
      }
      _lleXOrg[i] = _lleIsHydro[i]
        ? Math.max(1e-6, _lleFeedMol[i] * 0.96)
        : i === h2oSlot
          ? _lleFeedMol[i] * 0.02
          : _lleFeedMol[i] * 0.15;
      _lleXAq[i] = _lleFeedMol[i] - _lleXOrg[i];
      orgInitMol += _lleXOrg[i];
    }
  }
  const normalizePhaseArr = (ph: Float64Array, includeSalt: boolean) => {
    let s = 0;
    for (let i = 0; i < nAct; i++) {
      if (_lleIsPermGas[i]) { ph[i] = 0; continue; }
      if (_lleIsNonVol[i]) ph[i] = includeSalt ? _lleFeedMol[i] : 0;
      s += ph[i];
    }
    if (s > 1e-12) {
      const invS = 1.0 / s;
      for (let i = 0; i < nAct; i++) ph[i] *= invS;
    }
  };
  normalizePhaseArr(_lleXOrg, false);
  normalizePhaseArr(_lleXAq, true);

  let beta = warmValid
    ? initTie!.beta
    : Math.max(0.002, Math.min(0.998, orgInitMol / volatileLiqMol));
  let iterUsed = 0;
  for (let i = 0; i < nAct; i++) _lleKLL[i] = 0;

  const rrFunc = (b: number): number => {
    let f = 0;
    for (let i = 0; i < nAct; i++) {
      if (_lleIsNonVol[i] || _lleIsPermGas[i]) continue;
      const zi = _lleFeedMol[i] / volatileLiqMol;
      const km1 = _lleKLL[i] - 1.0;
      f += (zi * km1) / Math.max(1e-9, 1.0 + b * km1);
    }
    return f;
  };

  for (let it = 0; it < 35; it++) {
    iterUsed = it + 1;
    const orgH2O = h2oSlot >= 0 ? _lleXOrg[h2oSlot] : 0;
    const aqH2O = h2oSlot >= 0 ? _lleXAq[h2oSlot] : 0;
    let aqSalt = 0;
    if (saltMol > 0) {
      for (let i = 0; i < nAct; i++) {
        if (_lleComps[i] === 'NaCl' || _lleComps[i] === 'NaOH') aqSalt += _lleXAq[i];
      }
    }
    calcExtendedNrtlGammaInto(_lleComps, _lleXOrg, nAct, T_C, _lleGOrg, undefined, orgH2O, 0);
    calcExtendedNrtlGammaInto(_lleComps, _lleXAq, nAct, T_C, _lleGAq, undefined, aqH2O, aqSalt);

    let maxRelK = 0;
    for (let i = 0; i < nAct; i++) {
      if (_lleIsNonVol[i] || _lleIsPermGas[i]) continue;
      const kNew = Math.max(1e-7, Math.min(1e7, _lleGAq[i] / Math.max(1e-6, _lleGOrg[i])));
      const prev = _lleKLL[i] > 0 ? _lleKLL[i] : kNew;
      const damped = it === 0 ? kNew : Math.exp(0.65 * Math.log(kNew) + 0.35 * Math.log(prev));
      const rel = Math.abs(damped - prev) / Math.max(1e-6, prev);
      if (rel > maxRelK) maxRelK = rel;
      _lleKLL[i] = damped;
    }

    const f0 = rrFunc(1e-6);
    const f1 = rrFunc(1.0 - 1e-6);
    if (f0 <= 0) {
      beta = 0.0;
    } else if (f1 >= 0) {
      beta = 1.0;
    } else {
      let lo = 1e-6;
      let hi = 1.0 - 1e-6;
      for (let bi = 0; bi < 24; bi++) {
        const mid = 0.5 * (lo + hi);
        const fm = rrFunc(mid);
        if (Math.abs(fm) < 1e-9) { lo = hi = mid; break; }
        if (fm > 0) lo = mid; else hi = mid;
      }
      beta = 0.5 * (lo + hi);
    }

    for (let i = 0; i < nAct; i++) {
      if (_lleIsNonVol[i] || _lleIsPermGas[i]) continue;
      const zi = _lleFeedMol[i] / volatileLiqMol;
      const denom = Math.max(1e-9, 1.0 + beta * (_lleKLL[i] - 1.0));
      const xAqVol = zi / denom;
      _lleXOrg[i] = _lleKLL[i] * xAqVol;
      _lleXAq[i] = xAqVol * (1.0 - beta) * volatileLiqMol;
    }
    normalizePhaseArr(_lleXOrg, false);
    normalizePhaseArr(_lleXAq, true);

    if (it >= 3 && maxRelK < 5e-4) break;
  }

  if (beta <= 1e-5 || beta >= 1.0 - 1e-5) {
    const allOrg = beta >= 0.5 && saltMol < 1e-6;
    return {
      phaseSplit: false,
      tpdMin,
      organicKgH: allOrg ? { ...emptyRec(), ...feedLiqKgH } : emptyRec(),
      aqueousKgH: allOrg ? emptyRec() : { ...emptyRec(), ...feedLiqKgH },
      waterInOrgWtPct: 0,
      orgInAqWtPct: 0,
      iterations: iterUsed,
      diagnostics: diag,
    };
  }

  const organicKgH = emptyRec();
  const aqueousKgH = emptyRec();
  const tieXOrg: Partial<Record<SimCompKey, number>> = {};
  const tieXAq: Partial<Record<SimCompKey, number>> = {};
  let orgTotKg = 0;
  let aqTotKg = 0;
  let hydroInAqKg = 0;

  for (let i = 0; i < nAct; i++) {
    const k = _lleComps[i];
    const totKg = _lleFeedMass[i];
    tieXOrg[k] = _lleXOrg[i];
    tieXAq[k] = _lleXAq[i];
    if (_lleIsNonVol[i]) {
      organicKgH[k] = 0;
      aqueousKgH[k] = totKg;
      aqTotKg += totKg;
    } else if (_lleIsPermGas[i]) {
      organicKgH[k] = totKg;
      aqueousKgH[k] = 0;
      orgTotKg += totKg;
    } else {
      const denom = Math.max(1e-9, 1.0 + beta * (_lleKLL[i] - 1.0));
      const fracOrg = Math.max(0, Math.min(1, (beta * _lleKLL[i]) / denom));
      organicKgH[k] = totKg * fracOrg;
      aqueousKgH[k] = totKg - organicKgH[k];
      orgTotKg += organicKgH[k];
      aqTotKg += aqueousKgH[k];
      if (_lleIsHydro[i]) hydroInAqKg += aqueousKgH[k];
    }
  }

  return {
    phaseSplit: true,
    tpdMin,
    organicKgH,
    aqueousKgH,
    waterInOrgWtPct: orgTotKg > 1e-6 ? (organicKgH.H2O / orgTotKg) * 100 : 0,
    orgInAqWtPct: aqTotKg > 1e-6 ? (hydroInAqKg / aqTotKg) * 100 : 0,
    iterations: iterUsed,
    diagnostics: diag,
    tieState: { beta, xOrg: tieXOrg, xAq: tieXAq },
  };
}

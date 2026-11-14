// ============================================================================
// Joback & Reid (1987) Group-Contribution Engine + 128-Species Extended Library
//   - Predicts Tb, Tc, Pc, Vc, ω (Lee–Kesler), ΔHf°(g,298K), ΔGf°(g,298K),
//     Cp,ig(T), ΔHvap(Tb & 298K), liquid viscosity μ_L(298K), DIPPR-101 Psat,
//     and Hansen (1991) UNIFAC functional subgroup counts.
//   - Provides 128 curated industrial species across Petrochemicals, C4–C16 HCs,
//     Battery Carbonates, Semiconductor/Display Solvents, Chlorinated Organics,
//     Alcohols/Glycols/Ethers/Aldehydes/Acrylates/Amines/Nitriles/Organic Acids.
//   - Mutates CUSTOM_1 / CUSTOM_2 runtime property slots in-place across all
//     thermodynamic & flowsheet databanks without touching solver core files.
//
// References:
//   - Joback, K. G. & Reid, R. C., Chem. Eng. Commun. 57 (1987) 233–243
//   - Poling, Prausnitz & O'Connell, "The Properties of Gases and Liquids", 5th ed.
//   - Hansen et al., Ind. Eng. Chem. Res. 30 (1991) 2352–2355 (UNIFAC)
// ============================================================================

import { MW } from './constants';
import { COMP_META, type SimCompKey } from './flowsheetSolver';
import { THERMO_DATA, invalidateThermoCache, KJ_PER_KCAL } from './thermoCore';
import { RIGOROUS_CRIT, rebuildRigorousKijCache } from './rigorousThermo';
import { PSAT_DIPPR101, type Dippr101Entry } from './data/pureComponentDatabank';
import {
  COMP_CATALOG_META,
  COMP_FAMILY_LABELS,
  type CompChemicalFamily,
  type ResolvedPropertyMethod,
} from './componentCatalog';
import {
  setComponentUnifacGroups,
  setComponentHydrophobic,
  updateActivityCompMW,
  clearNrtlBipForSlot,
  type UnifacSubGroup,
} from './activityModels';
import { invalidateDepartureKijCache } from './eosDeparture';

export type CustomSlotKey = 'CUSTOM_1' | 'CUSTOM_2';

// ----------------------------------------------------------------------------
// 1. Joback & Reid (1987) Functional Group Table (33 Groups)
// ----------------------------------------------------------------------------
export type JobackGroupId =
  | 'CH3'
  | 'CH2_chain'
  | 'CH_chain'
  | 'C_chain'
  | 'CH2_alkene'
  | 'CH_alkene'
  | 'C_alkene'
  | 'CH_alkyne'
  | 'C_alkyne'
  | 'CH2_ring'
  | 'CH_ring'
  | 'C_ring'
  | 'ACH_arom'
  | 'AC_arom'
  | 'F'
  | 'Cl'
  | 'Br'
  | 'OH_alcohol'
  | 'OH_phenol'
  | 'O_chain'
  | 'O_ring'
  | 'CO_chain'
  | 'CO_ring'
  | 'CHO_ald'
  | 'COOH_acid'
  | 'COO_ester'
  | 'OCOO_carb'
  | 'NH2_amine'
  | 'NH_chain'
  | 'NH_ring'
  | 'N_chain'
  | 'N_ring_arom'
  | 'CN_nitrile'
  | 'NO2_nitro'
  | 'SH_thiol'
  | 'S_chain'
  | 'SO_sulfoxide';

export interface JobackGroupDef {
  id: JobackGroupId;
  symbol: string;
  labelKo: string;
  category: '탄화수소(사슬)' | '고리·방향족' | '산소 작용기' | '할로겐' | '질소·황 작용기';
  mw: number;
  atoms: number;
  dTb: number;
  dTc: number;
  dPc: number;
  dVc: number;
  dHf: number;
  dGf: number;
  da: number;
  db: number;
  dc: number;
  dd: number;
  dHv: number;
  dEtaA: number;
  dEtaB: number;
}

export const JOBACK_GROUPS: Record<JobackGroupId, JobackGroupDef> = {
  CH3:          { id: 'CH3',          symbol: '-CH₃',         labelKo: '메틸기 (-CH₃)',             category: '탄화수소(사슬)', mw: 15.035, atoms: 4, dTb: 23.58,  dTc: 0.0141, dPc: -0.0012, dVc: 65,  dHf: -76.45,  dGf: -43.96,  da: 19.5,   db: -8.08e-3, dc: 1.53e-4,  dd: -9.67e-8, dHv: 2.373,  dEtaA: -597.82,  dEtaB: 0.3494 },
  CH2_chain:    { id: 'CH2_chain',    symbol: '-CH₂-',        labelKo: '사슬 메틸렌 (-CH₂-)',        category: '탄화수소(사슬)', mw: 14.027, atoms: 3, dTb: 22.88,  dTc: 0.0189, dPc: 0.0000,  dVc: 56,  dHf: -20.64,  dGf: 8.42,    da: -0.909, db: 9.50e-2,  dc: -5.44e-5, dd: 1.19e-8,  dHv: 2.226,  dEtaA: -94.16,   dEtaB: 0.1991 },
  CH_chain:     { id: 'CH_chain',     symbol: '>CH-',         labelKo: '사슬 메틴 (>CH-)',           category: '탄화수소(사슬)', mw: 13.019, atoms: 2, dTb: 21.74,  dTc: 0.0164, dPc: 0.0020,  dVc: 41,  dHf: 29.89,   dGf: 58.36,   da: -23.0,  db: 2.04e-1,  dc: -2.65e-4, dd: 1.20e-7,  dHv: 1.691,  dEtaA: -322.15,  dEtaB: 1.1872 },
  C_chain:      { id: 'C_chain',      symbol: '>C<',          labelKo: '4차 탄소 (>C<)',             category: '탄화수소(사슬)', mw: 12.011, atoms: 1, dTb: 18.25,  dTc: 0.0067, dPc: 0.0043,  dVc: 27,  dHf: 82.23,   dGf: 116.02,  da: -66.2,  db: 4.27e-1,  dc: -6.41e-4, dd: 3.01e-7,  dHv: 0.636,  dEtaA: -573.56,  dEtaB: 2.3075 },
  CH2_alkene:   { id: 'CH2_alkene',   symbol: '=CH₂',         labelKo: '말단 이중결합 (=CH₂)',       category: '탄화수소(사슬)', mw: 14.027, atoms: 3, dTb: 18.18,  dTc: 0.0113, dPc: -0.0028, dVc: 56,  dHf: -9.63,   dGf: 3.77,    da: 23.6,   db: -3.81e-2, dc: 1.72e-4,  dd: -1.03e-7, dHv: 1.724,  dEtaA: -495.01,  dEtaB: 0.2531 },
  CH_alkene:    { id: 'CH_alkene',    symbol: '=CH-',         labelKo: '내부 이중결합 (=CH-)',       category: '탄화수소(사슬)', mw: 13.019, atoms: 2, dTb: 24.96,  dTc: 0.0129, dPc: -0.0006, dVc: 46,  dHf: 37.97,   dGf: 48.53,   da: -8.00,  db: 1.05e-1,  dc: -9.63e-5, dd: 3.56e-8,  dHv: 2.205,  dEtaA: -255.70,  dEtaB: 0.1290 },
  C_alkene:     { id: 'C_alkene',     symbol: '=C<',          labelKo: '분지 이중결합 (=C<)',        category: '탄화수소(사슬)', mw: 12.011, atoms: 1, dTb: 24.14,  dTc: 0.0117, dPc: 0.0011,  dVc: 38,  dHf: 83.99,   dGf: 92.36,   da: -28.1,  db: 2.08e-1,  dc: -3.06e-4, dd: 1.46e-7,  dHv: 2.138,  dEtaA: -150.00,  dEtaB: 0.2000 },
  CH_alkyne:    { id: 'CH_alkyne',    symbol: '≡CH',          labelKo: '말단 삼중결합 (≡CH)',        category: '탄화수소(사슬)', mw: 13.019, atoms: 2, dTb: 9.20,   dTc: 0.0027, dPc: -0.0008, dVc: 46,  dHf: 79.30,   dGf: 77.71,   da: 24.5,   db: -2.71e-2, dc: 1.11e-4,  dd: -6.78e-8, dHv: 1.155,  dEtaA: -300.00,  dEtaB: 0.2000 },
  C_alkyne:     { id: 'C_alkyne',     symbol: '≡C-',          labelKo: '내부 삼중결합 (≡C-)',        category: '탄화수소(사슬)', mw: 12.011, atoms: 1, dTb: 27.38,  dTc: 0.0020, dPc: 0.0016,  dVc: 37,  dHf: 115.51,  dGf: 109.82,  da: 7.87,   db: 2.01e-2,  dc: -8.33e-6, dd: 1.39e-9,  dHv: 3.302,  dEtaA: -200.00,  dEtaB: 0.1500 },

  CH2_ring:     { id: 'CH2_ring',     symbol: 'ring-CH₂-',    labelKo: '고리 메틸렌 (ring -CH₂-)',   category: '고리·방향족',   mw: 14.027, atoms: 3, dTb: 27.15,  dTc: 0.0100, dPc: 0.0025,  dVc: 48,  dHf: -26.80,  dGf: -3.68,   da: -6.03,  db: 8.54e-2,  dc: -8.00e-6, dd: -1.80e-8, dHv: 2.398,  dEtaA: -307.53,  dEtaB: 0.4220 },
  CH_ring:      { id: 'CH_ring',      symbol: 'ring>CH-',     labelKo: '고리 메틴 (ring >CH-)',      category: '고리·방향족',   mw: 13.019, atoms: 2, dTb: 21.78,  dTc: 0.0122, dPc: 0.0004,  dVc: 38,  dHf: 8.67,    dGf: 40.99,   da: -20.5,  db: 1.62e-1,  dc: -1.60e-4, dd: 6.24e-8,  dHv: 1.942,  dEtaA: -394.29,  dEtaB: 1.2683 },
  C_ring:       { id: 'C_ring',       symbol: 'ring>C<',      labelKo: '고리 4차탄소 (ring >C<)',    category: '고리·방향족',   mw: 12.011, atoms: 1, dTb: 21.32,  dTc: 0.0042, dPc: 0.0061,  dVc: 27,  dHf: 79.72,   dGf: 87.88,   da: -90.9,  db: 5.57e-1,  dc: -9.00e-4, dd: 4.69e-7,  dHv: 0.644,  dEtaA: -300.00,  dEtaB: 1.1000 },
  ACH_arom:     { id: 'ACH_arom',     symbol: 'arom=CH-',     labelKo: '방향족 CH (벤젠고리 =CH-)',   category: '고리·방향족',   mw: 13.019, atoms: 2, dTb: 26.73,  dTc: 0.0082, dPc: 0.0011,  dVc: 41,  dHf: 2.09,    dGf: 11.30,   da: -2.14,  db: 5.74e-2,  dc: -1.64e-6, dd: -1.59e-8, dHv: 2.544,  dEtaA: -215.56,  dEtaB: 0.3550 },
  AC_arom:      { id: 'AC_arom',      symbol: 'arom=C<',      labelKo: '치환 방향족 C (벤젠 =C<)',    category: '고리·방향족',   mw: 12.011, atoms: 1, dTb: 31.01,  dTc: 0.0143, dPc: 0.0008,  dVc: 32,  dHf: 46.43,   dGf: 54.05,   da: -8.25,  db: 1.01e-1,  dc: -1.42e-4, dd: 6.78e-8,  dHv: 3.059,  dEtaA: -621.25,  dEtaB: 1.4375 },

  F:            { id: 'F',            symbol: '-F',           labelKo: '플루오로 (-F)',               category: '할로겐',        mw: 18.998, atoms: 1, dTb: -0.03,  dTc: 0.0111, dPc: -0.0057, dVc: 27,  dHf: -251.92, dGf: -247.19, da: 26.5,   db: -9.13e-2, dc: 1.91e-4,  dd: -1.03e-7, dHv: -0.670, dEtaA: -538.40,  dEtaB: 0.5000 },
  Cl:           { id: 'Cl',           symbol: '-Cl',          labelKo: '클로로 (-Cl)',                category: '할로겐',        mw: 35.453, atoms: 1, dTb: 38.13,  dTc: 0.0105, dPc: -0.0049, dVc: 58,  dHf: -71.55,  dGf: -64.31,  da: 33.3,   db: -9.63e-2, dc: 1.87e-4,  dd: -9.96e-8, dHv: 4.532,  dEtaA: -625.45,  dEtaB: 0.6311 },
  Br:           { id: 'Br',           symbol: '-Br',          labelKo: '브로모 (-Br)',                category: '할로겐',        mw: 79.904, atoms: 1, dTb: 66.86,  dTc: 0.0133, dPc: 0.0057,  dVc: 71,  dHf: -29.48,  dGf: -38.06,  da: 28.6,   db: -6.49e-2, dc: 1.36e-4,  dd: -7.45e-8, dHv: 6.582,  dEtaA: -738.90,  dEtaB: 0.8000 },

  OH_alcohol:   { id: 'OH_alcohol',   symbol: '-OH (알코올)',  labelKo: '하이드록시기 (-OH 알코올)',    category: '산소 작용기',   mw: 17.007, atoms: 2, dTb: 92.88,  dTc: 0.0741, dPc: 0.0112,  dVc: 28,  dHf: -208.04, dGf: -189.20, da: 25.7,   db: -6.91e-2, dc: 1.77e-4,  dd: -9.88e-8, dHv: 16.826, dEtaA: -2173.72, dEtaB: 5.0570 },
  OH_phenol:    { id: 'OH_phenol',    symbol: '-OH (페놀)',    labelKo: '페놀성 OH (방향족 -OH)',      category: '산소 작용기',   mw: 17.007, atoms: 2, dTb: 76.34,  dTc: 0.0240, dPc: 0.0184,  dVc: -25, dHf: -221.65, dGf: -197.37, da: -2.81,  db: 1.11e-1,  dc: -1.16e-4, dd: 4.94e-8,  dHv: 12.499, dEtaA: -3018.17, dEtaB: 7.3142 },
  O_chain:      { id: 'O_chain',      symbol: '-O- (에테르)',  labelKo: '사슬 에테르 산소 (-O-)',      category: '산소 작용기',   mw: 15.999, atoms: 1, dTb: 22.42,  dTc: 0.0168, dPc: 0.0015,  dVc: 18,  dHf: -132.22, dGf: -105.00, da: 25.5,   db: -6.32e-2, dc: 1.11e-4,  dd: -5.48e-8, dHv: 2.410,  dEtaA: -122.09,  dEtaB: 0.3865 },
  O_ring:       { id: 'O_ring',       symbol: 'ring-O-',      labelKo: '고리 에테르 산소 (THF/EO)',   category: '산소 작용기',   mw: 15.999, atoms: 1, dTb: 31.22,  dTc: 0.0098, dPc: 0.0048,  dVc: 13,  dHf: -138.16, dGf: -98.22,  da: 12.2,   db: -1.26e-2, dc: 6.03e-5,  dd: -3.86e-8, dHv: 4.682,  dEtaA: -440.24,  dEtaB: 0.9531 },
  CO_chain:     { id: 'CO_chain',     symbol: '>C=O (케톤)',   labelKo: '사슬 케톤기 (>C=O)',          category: '산소 작용기',   mw: 28.010, atoms: 2, dTb: 76.75,  dTc: 0.0380, dPc: 0.0031,  dVc: 62,  dHf: -133.22, dGf: -120.50, da: 6.45,   db: 6.70e-2,  dc: -3.57e-5, dd: 2.86e-9,  dHv: 8.972,  dEtaA: -340.35,  dEtaB: 0.3504 },
  CO_ring:      { id: 'CO_ring',      symbol: 'ring>C=O',     labelKo: '고리 케톤기 (사이클로헥사논)', category: '산소 작용기',   mw: 28.010, atoms: 2, dTb: 94.97,  dTc: 0.0284, dPc: 0.0028,  dVc: 55,  dHf: -164.50, dGf: -126.27, da: 30.4,   db: -8.29e-2, dc: 2.36e-4,  dd: -1.31e-7, dHv: 6.645,  dEtaA: -500.00,  dEtaB: 0.8000 },
  CHO_ald:      { id: 'CHO_ald',      symbol: '-CH=O',        labelKo: '알데하이드기 (-CHO)',          category: '산소 작용기',   mw: 29.018, atoms: 3, dTb: 72.24,  dTc: 0.0379, dPc: 0.0030,  dVc: 82,  dHf: -162.03, dGf: -143.48, da: 30.9,   db: -3.36e-2, dc: 1.60e-4,  dd: -9.88e-8, dHv: 9.093,  dEtaA: -740.92,  dEtaB: 1.1613 },
  COOH_acid:    { id: 'COOH_acid',    symbol: '-COOH',        labelKo: '카르복실산기 (-COOH)',         category: '산소 작용기',   mw: 45.017, atoms: 4, dTb: 169.09, dTc: 0.0791, dPc: 0.0077,  dVc: 89,  dHf: -426.72, dGf: -387.87, da: 24.1,   db: 4.27e-2,  dc: 8.04e-5,  dd: -6.87e-8, dHv: 19.537, dEtaA: -1317.23, dEtaB: 2.5782 },
  COO_ester:    { id: 'COO_ester',    symbol: '-COO-',        labelKo: '에스터기 (-COO-)',            category: '산소 작용기',   mw: 44.010, atoms: 3, dTb: 81.10,  dTc: 0.0481, dPc: 0.0005,  dVc: 82,  dHf: -337.92, dGf: -301.95, da: 24.5,   db: 4.02e-2,  dc: 4.02e-5,  dd: -4.52e-8, dHv: 9.633,  dEtaA: -483.88,  dEtaB: 0.9665 },
  OCOO_carb:    { id: 'OCOO_carb',    symbol: '-OC(=O)O-',    labelKo: '카보네이트기 (-OCOO- 배터리)', category: '산소 작용기',   mw: 60.009, atoms: 4, dTb: 103.52, dTc: 0.0649, dPc: 0.0020,  dVc: 100, dHf: -470.14, dGf: -406.95, da: 50.0,   db: -2.30e-2, dc: 1.51e-4,  dd: -1.00e-7, dHv: 12.043, dEtaA: -605.97,  dEtaB: 1.3530 },

  NH2_amine:    { id: 'NH2_amine',    symbol: '-NH₂',         labelKo: '1차 아민기 (-NH₂)',           category: '질소·황 작용기', mw: 16.023, atoms: 3, dTb: 73.23,  dTc: 0.0243, dPc: 0.0109,  dVc: 38,  dHf: -22.02,  dGf: 14.07,   da: 26.9,   db: -4.12e-2, dc: 1.64e-4,  dd: -9.76e-8, dHv: 10.788, dEtaA: -1500.0,  dEtaB: 3.2000 },
  NH_chain:     { id: 'NH_chain',     symbol: '>NH (사슬)',    labelKo: '2차 아민기 (>NH)',            category: '질소·황 작용기', mw: 15.015, atoms: 2, dTb: 50.17,  dTc: 0.0295, dPc: 0.0077,  dVc: 35,  dHf: 53.47,   dGf: 89.39,   da: -1.21,  db: 7.62e-2,  dc: -4.86e-5, dd: 1.05e-8,  dHv: 6.436,  dEtaA: -1000.0,  dEtaB: 2.1000 },
  NH_ring:      { id: 'NH_ring',      symbol: 'ring>NH',      labelKo: '고리 2차 아민 (피페라진 등)',   category: '질소·황 작용기', mw: 15.015, atoms: 2, dTb: 52.82,  dTc: 0.0130, dPc: 0.0114,  dVc: 29,  dHf: 31.65,   dGf: 75.61,   da: 11.8,   db: -2.30e-2, dc: 1.07e-4,  dd: -6.28e-8, dHv: 6.930,  dEtaA: -1100.0,  dEtaB: 2.3000 },
  N_chain:      { id: 'N_chain',      symbol: '>N-',          labelKo: '3차 아민기 (>N-)',            category: '질소·황 작용기', mw: 14.007, atoms: 1, dTb: 11.74,  dTc: 0.0169, dPc: 0.0074,  dVc: 9,   dHf: 123.34,  dGf: 163.16,  da: -31.1,  db: 2.27e-1,  dc: -3.20e-4, dd: 1.46e-7,  dHv: 1.896,  dEtaA: -400.00,  dEtaB: 0.9000 },
  N_ring_arom:  { id: 'N_ring_arom',  symbol: '-N= (피리딘)',  labelKo: '방향족 고리 질소 (-N=)',       category: '질소·황 작용기', mw: 14.007, atoms: 1, dTb: 74.60,  dTc: 0.0085, dPc: 0.0076,  dVc: 34,  dHf: 55.52,   dGf: 79.93,   da: 8.83,   db: -3.84e-3, dc: 4.35e-5,  dd: -2.60e-8, dHv: 3.335,  dEtaA: -450.00,  dEtaB: 0.9500 },
  CN_nitrile:   { id: 'CN_nitrile',   symbol: '-C≡N',         labelKo: '나이트릴기 (-CN)',            category: '질소·황 작용기', mw: 26.018, atoms: 2, dTb: 125.66, dTc: 0.0496, dPc: -0.0101, dVc: 91,  dHf: 88.43,   dGf: 89.22,   da: 36.5,   db: -7.33e-2, dc: 1.84e-4,  dd: -1.03e-7, dHv: 12.851, dEtaA: -550.00,  dEtaB: 0.9000 },
  NO2_nitro:    { id: 'NO2_nitro',    symbol: '-NO₂',         labelKo: '나이트로기 (-NO₂)',           category: '질소·황 작용기', mw: 46.006, atoms: 3, dTb: 152.54, dTc: 0.0437, dPc: 0.0064,  dVc: 91,  dHf: -66.57,  dGf: -16.83,  da: 25.9,   db: -3.74e-3, dc: 1.29e-4,  dd: -8.88e-8, dHv: 16.738, dEtaA: -750.00,  dEtaB: 1.4000 },
  SH_thiol:     { id: 'SH_thiol',     symbol: '-SH',          labelKo: '싸이올기 (-SH)',              category: '질소·황 작용기', mw: 33.073, atoms: 2, dTb: 63.56,  dTc: 0.0031, dPc: 0.0084,  dVc: 63,  dHf: -17.33,  dGf: -22.99,  da: 35.3,   db: -7.58e-2, dc: 1.85e-4,  dd: -1.03e-7, dHv: 6.884,  dEtaA: -500.00,  dEtaB: 0.8000 },
  S_chain:      { id: 'S_chain',      symbol: '-S-',          labelKo: '설파이드 (-S-)',              category: '질소·황 작용기', mw: 32.065, atoms: 1, dTb: 68.78,  dTc: 0.0119, dPc: 0.0049,  dVc: 54,  dHf: 41.87,   dGf: 33.12,   da: 19.6,   db: -5.61e-3, dc: 4.02e-5,  dd: -2.76e-8, dHv: 6.817,  dEtaA: -350.00,  dEtaB: 0.6000 },
  SO_sulfoxide: { id: 'SO_sulfoxide', symbol: '>S=O',         labelKo: '설폭사이드 (>S=O)',           category: '질소·황 작용기', mw: 48.064, atoms: 2, dTb: 145.00, dTc: 0.0320, dPc: 0.0075,  dVc: 68,  dHf: -166.00, dGf: -102.00, da: 18.5,   db: 2.10e-2,  dc: 6.00e-5,  dd: -4.20e-8, dHv: 17.500, dEtaA: -950.00,  dEtaB: 2.1000 },
};

// ----------------------------------------------------------------------------
// 2. Monotonic Lee–Kesler DIPPR-101 Curve Fitter
// ----------------------------------------------------------------------------
function leeKeslerLnPr(Tr: number, omega: number): number {
  const f0 = 5.92714 - 6.09648 / Tr - 1.28862 * Math.log(Tr) + 0.169347 * Math.pow(Tr, 6);
  const f1 = 15.2518 - 15.6875 / Tr - 13.4721 * Math.log(Tr) + 0.43577 * Math.pow(Tr, 6);
  return f0 + omega * f1;
}

function solveLinear4x4(M: number[][], rhs: number[]): number[] | null {
  const A = M.map((r, i) => [...r, rhs[i]]);
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let row = col + 1; row < 4; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    }
    if (Math.abs(A[pivot][col]) < 1e-14) return null;
    if (pivot !== col) {
      const tmp = A[col];
      A[col] = A[pivot];
      A[pivot] = tmp;
    }
    const div = A[col][col];
    for (let j = col; j <= 4; j++) A[col][j] /= div;
    for (let row = 0; row < 4; row++) {
      if (row === col) continue;
      const factor = A[row][col];
      for (let j = col; j <= 4; j++) A[row][j] -= factor * A[col][j];
    }
  }
  return [A[0][4], A[1][4], A[2][4], A[3][4]];
}

export function fitDippr101Curve(
  Tb_K: number,
  Tc_K: number,
  Pc_bar: number,
  omega: number
): Dippr101Entry {
  const Tc = Math.max(Tb_K + 25.0, Tc_K);
  const Pc_Pa = Math.max(1.5e5, Pc_bar * 1e5);
  const Tmin = Math.max(120, Math.round(0.45 * Tc));
  const Tmax = Math.round(Tc);

  const pts: { T: number; lnP: number; w: number }[] = [];
  const trGrid = [0.48, 0.56, 0.64, 0.72, 0.80, 0.88, 0.95];
  for (const tr of trGrid) {
    const T = tr * Tc;
    pts.push({ T, lnP: Math.log(Pc_Pa) + leeKeslerLnPr(tr, omega), w: 1.0 });
  }
  pts.push({ T: Tb_K, lnP: Math.log(101325.0), w: 60.0 });
  pts.push({ T: Tc, lnP: Math.log(Pc_Pa), w: 40.0 });

  // Fit ln P = A + B/T + C*ln(T) + D*T^2  (E = 2)
  const XtWX = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const XtWy = [0, 0, 0, 0];
  for (const p of pts) {
    const phi = [1.0, 1.0 / p.T, Math.log(p.T), p.T * p.T];
    for (let i = 0; i < 4; i++) {
      XtWy[i] += p.w * phi[i] * p.lnP;
      for (let j = 0; j < 4; j++) {
        XtWX[i][j] += p.w * phi[i] * phi[j];
      }
    }
  }
  // Mild Tikhonov regularization on D and C for smoothness
  XtWX[2][2] += 1e-4;
  XtWX[3][3] += 1e-14;

  const sol = solveLinear4x4(XtWX, XtWy);
  if (sol) {
    const [A, B, C, D] = sol;
    // Check strict monotonicity d(ln P)/dT = -B/T² + C/T + 2*D*T > 0 across [Tmin, Tmax]
    let monotone = B < -100 && Number.isFinite(A);
    if (monotone) {
      for (let k = 0; k <= 12; k++) {
        const T = Tmin + ((Tmax - Tmin) * k) / 12;
        const dlnP = -B / (T * T) + C / T + 2.0 * D * T;
        if (dlnP <= 0) {
          monotone = false;
          break;
        }
      }
    }
    if (monotone) {
      return { A, B, C, D, E: 2, TminK: Tmin, TmaxK: Tmax, source: 'Lee-Kesler + Joback/NIST Tb-Tc-Pc anchored DIPPR-101' };
    }
  }

  // Analytical guaranteed-monotone fallback anchored identically at (Tb, 101325 Pa) and (Tc, Pc_Pa)
  const C_fb = -0.65;
  const yB = Math.log(101325.0) - C_fb * Math.log(Tb_K);
  const yC = Math.log(Pc_Pa) - C_fb * Math.log(Tc);
  const B_fb = (yB - yC) / (1.0 / Tb_K - 1.0 / Tc);
  const A_fb = yB - B_fb / Tb_K;
  return { A: A_fb, B: B_fb, C: C_fb, D: 0, E: 2, TminK: Tmin, TmaxK: Tmax, source: 'Analytical Clausius-Kirchhoff Tb-Tc-Pc anchored DIPPR-101' };
}

// ----------------------------------------------------------------------------
// 3. Automatic Joback -> Hansen (1991) UNIFAC Group Mapper
// ----------------------------------------------------------------------------
export function deriveUnifacGroupsFromJoback(
  groups: Partial<Record<JobackGroupId, number>>
): {
  unifacGroups: Partial<Record<UnifacSubGroup, number>>;
  hydrophobic: boolean;
  family: CompChemicalFamily;
} {
  let ch3 = Math.max(0, groups.CH3 ?? 0);
  let ch2 = Math.max(0, (groups.CH2_chain ?? 0) + (groups.CH2_ring ?? 0));
  let ch = Math.max(0, (groups.CH_chain ?? 0) + (groups.CH_ring ?? 0));
  let c4 = Math.max(0, (groups.C_chain ?? 0) + (groups.C_ring ?? 0));
  let ach = Math.max(0, groups.ACH_arom ?? 0);
  let ac = Math.max(0, groups.AC_arom ?? 0);
  let ch2Alk = Math.max(0, groups.CH2_alkene ?? 0);
  let chAlk = Math.max(0, groups.CH_alkene ?? 0);
  let cAlk = Math.max(0, groups.C_alkene ?? 0);

  let cl = Math.max(0, groups.Cl ?? 0);
  let oh = Math.max(0, groups.OH_alcohol ?? 0);
  let ohPhenol = Math.max(0, groups.OH_phenol ?? 0);
  let oChain = Math.max(0, groups.O_chain ?? 0);
  let oRing = Math.max(0, groups.O_ring ?? 0);
  let co = Math.max(0, (groups.CO_chain ?? 0) + (groups.CO_ring ?? 0));
  let cho = Math.max(0, groups.CHO_ald ?? 0);
  let cooh = Math.max(0, groups.COOH_acid ?? 0);
  let coo = Math.max(0, groups.COO_ester ?? 0);
  let ocoo = Math.max(0, groups.OCOO_carb ?? 0);
  let nh2 = Math.max(0, groups.NH2_amine ?? 0);
  let nh = Math.max(0, (groups.NH_chain ?? 0) + (groups.NH_ring ?? 0));
  let n3 = Math.max(0, groups.N_chain ?? 0);
  let nPyr = Math.max(0, groups.N_ring_arom ?? 0);
  let cn = Math.max(0, groups.CN_nitrile ?? 0);
  let so = Math.max(0, groups.SO_sulfoxide ?? 0);

  const out: Partial<Record<UnifacSubGroup, number>> = {};
  const addU = (g: UnifacSubGroup, n: number) => {
    if (n > 0) out[g] = (out[g] ?? 0) + n;
  };

  // Pyridine ring
  if (nPyr > 0 && ach >= 5) {
    const nP = Math.min(nPyr, Math.floor(ach / 5));
    addU('C5H5N', nP);
    nPyr -= nP;
    ach -= 5 * nP;
  }

  // Phenol: AC + OH_phenol -> ACOH
  if (ohPhenol > 0) {
    const usedAc = Math.min(ac, ohPhenol);
    ac -= usedAc;
    addU('ACOH', ohPhenol);
    ohPhenol = 0;
  }

  // Aromatic amine & aryl chloride: AC + NH2 -> ACNH2, AC + Cl -> ACCl
  if (ac > 0 && nh2 > 0) {
    const m = Math.min(ac, nh2);
    addU('ACNH2', m);
    ac -= m;
    nh2 -= m;
  }
  if (ac > 0 && cl > 0) {
    const m = Math.min(ac, cl);
    addU('ACCl', m);
    ac -= m;
    cl -= m;
  }

  // Alkyl aromatics: AC + CH3 -> ACCH3, AC + CH2 -> ACCH2, AC + CH -> ACCH
  if (ac > 0 && ch3 > 0 && ch2 === 0 && ch === 0) {
    const m = Math.min(ac, ch3);
    addU('ACCH3', m);
    ac -= m;
    ch3 -= m;
  }
  if (ac > 0 && ch2 > 0) {
    const m = Math.min(ac, ch2);
    addU('ACCH2', m);
    ac -= m;
    ch2 -= m;
  }
  if (ac > 0 && ch > 0) {
    const m = Math.min(ac, ch);
    addU('ACCH', m);
    ac -= m;
    ch -= m;
  }

  // Ketones: CO + CH3 -> CH3CO, CO + CH2 -> CH2CO
  if (co > 0) {
    const m3 = Math.min(co, ch3);
    addU('CH3CO', m3);
    co -= m3;
    ch3 -= m3;
    const m2 = Math.min(co, ch2);
    addU('CH2CO', m2);
    co -= m2;
    ch2 -= m2;
    if (co > 0) addU('CH2CO', co);
  }

  // Esters: COO + CH3 -> CH3COO, COO + CH2 -> CH2COO
  if (coo > 0) {
    const m3 = Math.min(coo, ch3);
    addU('CH3COO', m3);
    coo -= m3;
    ch3 -= m3;
    const m2 = Math.min(coo, ch2);
    addU('CH2COO', m2);
    coo -= m2;
    ch2 -= m2;
    if (coo > 0) addU('CH2COO', coo);
  }

  // Cyclic & chain ethers
  if (oRing > 0) {
    const m = Math.min(oRing, ch2);
    addU('CH2O_cyclic', oRing);
    ch2 -= m;
    oRing = 0;
  }
  if (oChain > 0) {
    const m2 = Math.min(oChain, ch2);
    addU('CH2O', m2);
    oChain -= m2;
    ch2 -= m2;
    const m3 = Math.min(oChain, ch3);
    addU('CH3O', m3);
    oChain -= m3;
    ch3 -= m3;
    const m1 = Math.min(oChain, ch);
    addU('CHOCH2', m1);
    oChain -= m1;
    ch -= m1;
    if (oChain > 0) addU('CH2O', oChain);
  }

  // Nitriles
  if (cn > 0) {
    const m2 = Math.min(cn, ch2);
    addU('CH2CN', m2);
    cn -= m2;
    ch2 -= m2;
    const m3 = Math.min(cn, ch3);
    addU('CH3CN', m3);
    cn -= m3;
    ch3 -= m3;
    if (cn > 0) addU('CH2CN', cn);
  }

  // Amines
  if (nh2 > 0) {
    const m2 = Math.min(nh2, ch2);
    addU('CH2NH2', m2);
    nh2 -= m2;
    ch2 -= m2;
    const m3 = Math.min(nh2, ch3);
    addU('CH3NH2', m3);
    nh2 -= m3;
    ch3 -= m3;
    if (nh2 > 0) addU('CH2NH2', nh2);
  }
  if (nh > 0) {
    const m2 = Math.min(nh, ch2);
    addU('CH2NH', m2);
    nh -= m2;
    ch2 -= m2;
    const m3 = Math.min(nh, ch3);
    addU('CH3NH', m3);
    nh -= m3;
    ch3 -= m3;
    if (nh > 0) addU('CH2NH', nh);
  }
  if (n3 > 0) {
    const m2 = Math.min(n3, ch2);
    addU('CH2N', m2);
    n3 -= m2;
    ch2 -= m2;
    const m3 = Math.min(n3, ch3);
    addU('CH3N', m3);
    n3 -= m3;
    ch3 -= m3;
    if (n3 > 0) addU('CH3N', n3);
  }

  // Chlorinated alkanes
  if (cl >= 4 && c4 >= 1) {
    addU('CCl4_g', 1);
    cl -= 4;
    c4 -= 1;
  }
  if (cl >= 3 && ch >= 1) {
    addU('CHCl3_g', 1);
    cl -= 3;
    ch -= 1;
  }
  if (cl >= 2 && ch2 >= 1 && ch2 === 1 && ch3 === 0) {
    addU('CH2Cl2', 1);
    cl -= 2;
    ch2 -= 1;
  }
  if (cl >= 2 && ch >= 1) {
    addU('CHCl2', 1);
    cl -= 2;
    ch -= 1;
  }
  if (cl > 0) {
    const m2 = Math.min(cl, ch2);
    addU('CH2Cl', m2);
    cl -= m2;
    ch2 -= m2;
    const m1 = Math.min(cl, ch);
    addU('CHCl', m1);
    cl -= m1;
    ch -= m1;
    if (cl > 0) addU('CH2Cl', cl);
  }

  // Alkenes
  while (ch2Alk > 0 && chAlk > 0) {
    addU('CH2=CH', 1);
    ch2Alk--;
    chAlk--;
  }
  while (ch2Alk > 0 && cAlk > 0) {
    addU('CH2=C', 1);
    ch2Alk--;
    cAlk--;
  }
  while (chAlk >= 2) {
    addU('CH=CH', 1);
    chAlk -= 2;
  }
  if (ch2Alk > 0) addU('CH2', ch2Alk);
  if (chAlk > 0) addU('CH', chAlk);
  if (cAlk > 0) addU('C', cAlk);

  //Sulfoxide (DMSO-like)
  if (so > 0) {
    const m = Math.min(so, Math.floor(ch3 / 2));
    if (m > 0) {
      addU('DMSO_g', m);
      ch3 -= 2 * m;
      so -= m;
    }
    if (so > 0) addU('DMSO_g', so);
  }

  // Standalone polar & hydrocarbon subgroups
  addU('OH', oh);
  addU('COOH', cooh);
  addU('OCOO', ocoo);
  addU('CHO', cho);
  addU('ACH', ach);
  addU('AC', ac);
  addU('CH3', ch3);
  addU('CH2', ch2);
  addU('CH', ch);
  addU('C', c4);

  if (Object.keys(out).length === 0) {
    out.CH2 = 2;
  }

  const hydrophilicCount =
    (out.OH ?? 0) +
    (out.ACOH ?? 0) +
    (out.COOH ?? 0) +
    (out.CH2O_cyclic ?? 0) +
    (out.DMSO_g ?? 0) +
    (out.CH2NH2 ?? 0) +
    (out.CH3NH2 ?? 0) +
    (out.CH2NH ?? 0) +
    (out.C5H5N ?? 0) +
    (out.CH3CN ?? 0);
  const carbonBackbone =
    (out.CH3 ?? 0) +
    (out.CH2 ?? 0) +
    (out.CH ?? 0) +
    (out.C ?? 0) +
    (out.ACH ?? 0) +
    (out.AC ?? 0) +
    (out.ACCH3 ?? 0) +
    (out.ACCH2 ?? 0) +
    (out.ACCl ?? 0);

  const hydrophobic = hydrophilicCount === 0 || (hydrophilicCount === 1 && carbonBackbone >= 5);

  let family: CompChemicalFamily = 'polar_solvent';
  if ((groups.Cl ?? 0) > 0 || (groups.F ?? 0) > 0 || (groups.Br ?? 0) > 0) {
    family = 'chlor_ech';
  } else if ((groups.ACH_arom ?? 0) + (groups.AC_arom ?? 0) >= 4 && hydrophilicCount === 0) {
    family = 'aromatic';
  } else if (
    hydrophilicCount === 0 &&
    (groups.CO_chain ?? 0) + (groups.COO_ester ?? 0) + (groups.OCOO_carb ?? 0) + (groups.O_chain ?? 0) === 0
  ) {
    family = 'hydrocarbon';
  }

  return { unifacGroups: out, hydrophobic, family };
}

// ----------------------------------------------------------------------------
// 4. Joback Property Predictor
// ----------------------------------------------------------------------------
export interface JobackPredictionOptions {
  /** Optional experimental normal boiling point (°C) — reduces Tc error from ~2.5% to <0.8%! */
  tbExpC?: number;
  mwOverride?: number;
}

export interface JobackPredictionResult {
  mw: number;
  atoms: number;
  tbJoback_K: number;
  tbUsed_K: number;
  tbC: number;
  tc_K: number;
  tcC: number;
  pc_bar: number;
  vc_cm3_mol: number;
  omega: number;
  dHfIg298_kJ_mol: number;
  dGfIg298_kJ_mol: number;
  cpIg: [number, number, number, number];
  dHvapTb_kJ_mol: number;
  dHvap298_kJ_mol: number;
  cpLiq298_J_molK: number;
  viscLiq298_cP: number;
  dippr101: Dippr101Entry;
  unifacGroups: Partial<Record<UnifacSubGroup, number>>;
  hydrophobic: boolean;
  family: CompChemicalFamily;
}

export function predictPropertiesFromJobackGroups(
  groups: Partial<Record<JobackGroupId, number>>,
  opts: JobackPredictionOptions = {}
): JobackPredictionResult {
  let mw = 0;
  let atoms = 0;
  let sumTb = 0;
  let sumTc = 0;
  let sumPc = 0;
  let sumVc = 0;
  let sumHf = 0;
  let sumGf = 0;
  let sumA = 0;
  let sumB = 0;
  let sumC = 0;
  let sumD = 0;
  let sumHv = 0;
  let sumEtaA = 0;
  let sumEtaB = 0;

  for (const [gid, rawN] of Object.entries(groups) as [JobackGroupId, number][]) {
    const n = Math.max(0, rawN ?? 0);
    if (n <= 0) continue;
    const def = JOBACK_GROUPS[gid];
    if (!def) continue;
    mw += n * def.mw;
    atoms += n * def.atoms;
    sumTb += n * def.dTb;
    sumTc += n * def.dTc;
    sumPc += n * def.dPc;
    sumVc += n * def.dVc;
    sumHf += n * def.dHf;
    sumGf += n * def.dGf;
    sumA += n * def.da;
    sumB += n * def.db;
    sumC += n * def.dc;
    sumD += n * def.dd;
    sumHv += n * def.dHv;
    sumEtaA += n * def.dEtaA;
    sumEtaB += n * def.dEtaB;
  }

  if (mw <= 0) {
    mw = 74.12;
    atoms = 15;
    sumTb = 193.0;
    sumTc = 0.145;
    sumPc = 0.008;
    sumVc = 260;
  }
  if (opts.mwOverride && opts.mwOverride > 1) mw = opts.mwOverride;

  const tbJoback_K = Math.max(110.0, 198.2 + sumTb);
  const tbUsed_K =
    opts.tbExpC !== undefined && Number.isFinite(opts.tbExpC)
      ? Math.max(90.0, opts.tbExpC + 273.15)
      : tbJoback_K;
  const tbC = tbUsed_K - 273.15;

  const tcDenom = Math.max(0.22, Math.min(0.92, 0.584 + 0.965 * sumTc - sumTc * sumTc));
  const tc_K = Math.max(tbUsed_K + 22.0, tbUsed_K / tcDenom);
  const tcC = tc_K - 273.15;

  const pcTerm = Math.max(0.06, 0.113 + 0.0032 * atoms - sumPc);
  const pc_bar = Math.max(5.0, Math.min(250.0, 1.0 / (pcTerm * pcTerm)));
  const vc_cm3_mol = Math.max(40.0, 17.5 + sumVc);

  // Lee–Kesler acentric factor ω
  const theta = Math.max(0.35, Math.min(0.92, tbUsed_K / tc_K));
  const lkNum =
    -Math.log(pc_bar / 1.01325) -
    5.92714 +
    6.09648 / theta +
    1.28862 * Math.log(theta) -
    0.169347 * Math.pow(theta, 6);
  const lkDen =
    15.2518 - 15.6875 / theta - 13.4721 * Math.log(theta) + 0.43577 * Math.pow(theta, 6);
  const omega = Math.max(-0.05, Math.min(1.25, lkNum / Math.max(0.5, lkDen)));

  const dHfIg298_kJ_mol = 68.29 + sumHf;
  const dGfIg298_kJ_mol = 53.88 + sumGf;

  const cpIg: [number, number, number, number] = [
    sumA - 37.93,
    sumB + 0.210,
    sumC - 3.91e-4,
    sumD + 2.06e-7,
  ];

  // Riedel + Joback hybrid enthalpy of vaporization at Tb & Watson scaling to 298.15 K
  const dHvRiedel =
    (1.092 * 8.314462e-3 * tbUsed_K * (Math.log(pc_bar) - 1.013)) /
    Math.max(0.08, 0.930 - theta);
  const dHvJoback = Math.max(8.0, 15.30 + sumHv);
  const dHvapTb_kJ_mol = opts.tbExpC !== undefined ? dHvRiedel : 0.65 * dHvRiedel + 0.35 * dHvJoback;
  const watsonRatio = Math.max(0.05, (tc_K - 298.15) / Math.max(10.0, tc_K - tbUsed_K));
  const dHvap298_kJ_mol =
    tc_K > 305.0 ? dHvapTb_kJ_mol * Math.pow(watsonRatio, 0.38) : dHvapTb_kJ_mol;

  const T0 = 298.15;
  const cpIg298 = Math.max(
    28.0,
    cpIg[0] + cpIg[1] * T0 + cpIg[2] * T0 * T0 + cpIg[3] * T0 * T0 * T0
  );
  const cpLiq298_J_molK =
    tc_K > 310.0
      ? cpIg298 + (0.38 * dHvap298_kJ_mol * 1000.0) / Math.max(25.0, tc_K - T0) + 18.0
      : cpIg298 + 25.0;

  // Joback liquid viscosity at 298.15 K [cP = mPa·s]
  const lnEta = (sumEtaA - 597.82) / T0 + sumEtaB - 11.202;
  const viscRawCp = mw * Math.exp(Math.max(-18.0, Math.min(4.0, lnEta))) * 1000.0;
  const viscLiq298_cP = Math.max(0.12, Math.min(250.0, viscRawCp));

  const dippr101 = fitDippr101Curve(tbUsed_K, tc_K, pc_bar, omega);
  const { unifacGroups, hydrophobic, family } = deriveUnifacGroupsFromJoback(groups);

  return {
    mw,
    atoms,
    tbJoback_K,
    tbUsed_K,
    tbC,
    tc_K,
    tcC,
    pc_bar,
    vc_cm3_mol,
    omega,
    dHfIg298_kJ_mol,
    dGfIg298_kJ_mol,
    cpIg,
    dHvapTb_kJ_mol,
    dHvap298_kJ_mol,
    cpLiq298_J_molK,
    viscLiq298_cP,
    dippr101,
    unifacGroups,
    hydrophobic,
    family,
  };
}

// ----------------------------------------------------------------------------
// 5. Custom Component Specification & Extended 128-Species Chemical Library
// ----------------------------------------------------------------------------
export type ExtendedLibCategory =
  | 'hydrocarbon'
  | 'aromatic_petrochem'
  | 'battery_carbonate'
  | 'electronic_solvent'
  | 'chlorinated_organic'
  | 'oxygenate_amine_nitrile';

export const EXTENDED_LIB_CATEGORY_LABELS: Record<ExtendedLibCategory, string> = {
  hydrocarbon: 'C4~C16 파라핀·올레핀·나프텐',
  aromatic_petrochem: '방향족 · 석유화학 단량체',
  battery_carbonate: '이차전지 전해액 카보네이트·글라임',
  electronic_solvent: '반도체 · 디스플레이 전자재료 용제',
  chlorinated_organic: '염소계 유기화합물 · 단량체',
  oxygenate_amine_nitrile: '알코올 · 글리콜 · 아민 · 나이트릴 · 유기산',
};

export interface CustomComponentSpec {
  id: string;
  formula: string;
  nameKo: string;
  nameEn: string;
  cas: string;
  category: ExtendedLibCategory;
  family: CompChemicalFamily;
  mw: number;
  tbC: number;
  tcK: number;
  pcBar: number;
  omega: number;
  dHfIg298_kJ_mol: number;
  cpIg: [number, number, number, number];
  dHvap298_kJ_mol: number;
  cpLiq298_J_molK: number;
  dippr101: Dippr101Entry;
  unifacGroups: Partial<Record<UnifacSubGroup, number>>;
  hydrophobic: boolean;
  source: 'extended_library' | 'joback_unifac';
}

function libChem(
  id: string,
  formula: string,
  nameKo: string,
  nameEn: string,
  cas: string,
  category: ExtendedLibCategory,
  family: CompChemicalFamily,
  mw: number,
  tbC: number,
  tcK: number,
  pcBar: number,
  omega: number,
  dHfIg: number,
  cpIg: [number, number, number, number],
  unifacGroups: Partial<Record<UnifacSubGroup, number>>,
  hydrophobic: boolean
): CustomComponentSpec {
  const tbK = tbC + 273.15;
  const theta = Math.max(0.35, Math.min(0.92, tbK / tcK));
  const dHvTb =
    (1.092 * 8.314462e-3 * tbK * (Math.log(Math.max(2.0, pcBar)) - 1.013)) /
    Math.max(0.08, 0.930 - theta);
  const wRatio = Math.max(0.05, (tcK - 298.15) / Math.max(10.0, tcK - tbK));
  const dHvap298 = tcK > 305.0 ? dHvTb * Math.pow(wRatio, 0.38) : dHvTb;
  const T0 = 298.15;
  const cpIg298 = Math.max(28, cpIg[0] + cpIg[1] * T0 + cpIg[2] * T0 * T0 + cpIg[3] * T0 ** 3);
  const cpLiq298 =
    tcK > 310.0 ? cpIg298 + (0.38 * dHvap298 * 1000) / Math.max(25, tcK - T0) + 16.0 : cpIg298 + 22.0;

  return {
    id,
    formula,
    nameKo,
    nameEn,
    cas,
    category,
    family,
    mw,
    tbC,
    tcK,
    pcBar,
    omega,
    dHfIg298_kJ_mol: dHfIg,
    cpIg,
    dHvap298_kJ_mol: dHvap298,
    cpLiq298_J_molK: cpLiq298,
    dippr101: fitDippr101Curve(tbK, tcK, pcBar, omega),
    unifacGroups,
    hydrophobic,
    source: 'extended_library',
  };
}

export const EXTENDED_CHEMICAL_LIBRARY: CustomComponentSpec[] = [
  // ── 1) C4–C16 Hydrocarbons (22 species) ────────────────────────────────────
  libChem('Isobutene', 'C₄H₈', '이소부텐', 'Isobutene', '115-11-7', 'hydrocarbon', 'hydrocarbon', 56.106, -6.9, 417.9, 40.0, 0.194, -16.9, [16.05, 0.2804, -1.091e-4, 9.098e-9], { CH3: 2, 'CH2=C': 1 }, true),
  libChem('1,3-Butadiene', 'C₄H₆', '1,3-부타디엔', '1,3-Butadiene', '106-99-0', 'hydrocarbon', 'hydrocarbon', 54.090, -4.4, 425.2, 42.77, 0.190, 110.0, [-1.69, 0.3419, -2.340e-4, 6.335e-8], { 'CH2=CH': 2 }, true),
  libChem('Isoprene', 'C₅H₈', '이소프렌', 'Isoprene', '78-79-5', 'hydrocarbon', 'hydrocarbon', 68.117, 34.1, 484.0, 38.5, 0.158, 75.5, [6.04, 0.398, -2.31e-4, 5.12e-8], { CH3: 1, 'CH2=CH': 1, 'CH2=C': 1 }, true),
  libChem('Isopentane', 'i-C₅H₁₂', '이소펜탄', 'Isopentane', '78-78-4', 'hydrocarbon', 'hydrocarbon', 72.149, 27.8, 460.4, 33.81, 0.227, -153.7, [-9.52, 0.446, -2.14e-4, 3.82e-8], { CH3: 3, CH2: 1, CH: 1 }, true),
  libChem('Neopentane', 'C₅H₁₂', '네오펜탄', 'Neopentane', '463-82-1', 'hydrocarbon', 'hydrocarbon', 72.149, 9.5, 433.8, 31.96, 0.197, -168.0, [-16.6, 0.489, -2.69e-4, 5.62e-8], { CH3: 4, C: 1 }, true),
  libChem('1-Pentene', 'C₅H₁₀', '1-펜텐', '1-Pentene', '109-67-1', 'hydrocarbon', 'hydrocarbon', 70.133, 30.0, 464.8, 35.6, 0.233, -21.3, [-0.13, 0.433, -2.32e-4, 4.86e-8], { CH3: 1, CH2: 2, 'CH2=CH': 1 }, true),
  libChem('Cyclopentane', 'C₅H₁₀', '사이클로펜탄', 'Cyclopentane', '287-92-3', 'hydrocarbon', 'hydrocarbon', 70.133, 49.3, 511.7, 45.08, 0.196, -77.1, [-53.6, 0.543, -3.03e-4, 6.48e-8], { CH2: 5 }, true),
  libChem('2-Methylpentane', 'C₆H₁₄', '2-메틸펜탄', '2-Methylpentane', '107-83-5', 'hydrocarbon', 'hydrocarbon', 86.175, 60.3, 497.7, 30.4, 0.279, -174.8, [-10.6, 0.548, -2.76e-4, 5.15e-8], { CH3: 3, CH2: 2, CH: 1 }, true),
  libChem('3-Methylpentane', 'C₆H₁₄', '3-메틸펜탄', '3-Methylpentane', '96-14-0', 'hydrocarbon', 'hydrocarbon', 86.175, 63.3, 504.4, 31.24, 0.273, -172.1, [-10.0, 0.545, -2.72e-4, 5.02e-8], { CH3: 3, CH2: 2, CH: 1 }, true),
  libChem('1-Hexene', 'C₆H₁₂', '1-헥센', '1-Hexene', '592-41-6', 'hydrocarbon', 'hydrocarbon', 84.159, 63.5, 504.0, 32.1, 0.285, -42.0, [-1.75, 0.531, -2.90e-4, 6.05e-8], { CH3: 1, CH2: 3, 'CH2=CH': 1 }, true),
  libChem('Methylcyclopentane', 'C₆H₁₂', '메틸사이클로펜탄', 'Methylcyclopentane', '96-37-7', 'hydrocarbon', 'hydrocarbon', 84.159, 71.8, 532.8, 37.85, 0.230, -106.2, [-50.1, 0.638, -3.64e-4, 8.01e-8], { CH3: 1, CH2: 4, CH: 1 }, true),
  libChem('Methylcyclohexane', 'C₇H₁₄', '메틸사이클로헥산', 'Methylcyclohexane', '108-87-2', 'hydrocarbon', 'hydrocarbon', 98.186, 100.9, 572.1, 34.71, 0.236, -154.8, [-61.9, 0.784, -4.44e-4, 9.36e-8], { CH3: 1, CH2: 5, CH: 1 }, true),
  libChem('Ethylcyclohexane', 'C₈H₁₆', '에틸사이클로헥산', 'Ethylcyclohexane', '1678-91-7', 'hydrocarbon', 'hydrocarbon', 112.21, 131.8, 609.0, 30.4, 0.246, -171.7, [-63.9, 0.889, -5.01e-4, 1.05e-7], { CH3: 1, CH2: 6, CH: 1 }, true),
  libChem('Isooctane', 'C₈H₁₈', '이소옥탄 (2,2,4-TMP)', 'Isooctane', '540-84-1', 'hydrocarbon', 'hydrocarbon', 114.23, 99.2, 543.8, 25.68, 0.303, -224.1, [-7.46, 0.746, -3.96e-4, 8.08e-8], { CH3: 5, CH2: 1, CH: 1, C: 1 }, true),
  libChem('1-Octene', 'C₈H₁₆', '1-옥텐', '1-Octene', '111-66-0', 'hydrocarbon', 'hydrocarbon', 112.21, 121.3, 567.0, 26.8, 0.386, -82.9, [-4.10, 0.724, -3.99e-4, 8.38e-8], { CH3: 1, CH2: 5, 'CH2=CH': 1 }, true),
  libChem('1-Decene', 'C₁₀H₂₀', '1-데센', '1-Decene', '872-05-9', 'hydrocarbon', 'hydrocarbon', 140.27, 170.6, 616.6, 22.2, 0.481, -124.1, [-6.45, 0.916, -5.08e-4, 1.07e-7], { CH3: 1, CH2: 7, 'CH2=CH': 1 }, true),
  libChem('n-Nonane', 'C₉H₂₀', '노르말노난', 'n-Nonane', '111-84-2', 'hydrocarbon', 'hydrocarbon', 128.26, 150.8, 594.6, 22.88, 0.445, -228.3, [-8.37, 0.873, -4.82e-4, 1.03e-7], { CH3: 2, CH2: 7 }, true),
  libChem('n-Decane', 'C₁₀H₂₂', '노르말데칸', 'n-Decane', '124-18-5', 'hydrocarbon', 'hydrocarbon', 142.28, 174.1, 617.7, 21.1, 0.490, -249.5, [-7.91, 0.961, -5.29e-4, 1.13e-7], { CH3: 2, CH2: 8 }, true),
  libChem('n-Undecane', 'C₁₁H₂₄', '노르말운데칸', 'n-Undecane', '1120-21-4', 'hydrocarbon', 'hydrocarbon', 156.31, 195.9, 639.0, 19.8, 0.537, -270.3, [-8.40, 1.057, -5.83e-4, 1.25e-7], { CH3: 2, CH2: 9 }, true),
  libChem('n-Dodecane', 'C₁₂H₂₆', '노르말도데칸', 'n-Dodecane', '112-40-3', 'hydrocarbon', 'hydrocarbon', 170.33, 216.3, 658.0, 18.2, 0.576, -290.9, [-9.33, 1.149, -6.35e-4, 1.36e-7], { CH3: 2, CH2: 10 }, true),
  libChem('n-Tetradecane', 'C₁₄H₃₀', '노르말테트라데칸', 'n-Tetradecane', '629-59-4', 'hydrocarbon', 'hydrocarbon', 198.39, 253.5, 693.0, 15.7, 0.643, -332.1, [-10.9, 1.339, -7.42e-4, 1.59e-7], { CH3: 2, CH2: 12 }, true),
  libChem('n-Hexadecane', 'C₁₆H₃₄', '노르말헥사데칸 (세탄)', 'n-Hexadecane', '544-76-3', 'hydrocarbon', 'hydrocarbon', 226.44, 286.9, 723.0, 14.0, 0.718, -373.3, [-12.8, 1.530, -8.50e-4, 1.82e-7], { CH3: 2, CH2: 14 }, true),

  // ── 2) Aromatics & Petrochemical Monomers (16 species) ─────────────────────
  libChem('o-Xylene', 'C₈H₁₀', '오르토자일렌', 'o-Xylene', '95-47-6', 'aromatic_petrochem', 'aromatic', 106.165, 144.4, 630.3, 37.32, 0.310, 19.1, [-15.85, 0.596, -3.44e-4, 7.53e-8], { ACH: 4, ACCH3: 2 }, true),
  libChem('m-Xylene', 'C₈H₁₀', '메타자일렌', 'm-Xylene', '108-38-3', 'aromatic_petrochem', 'aromatic', 106.165, 139.1, 617.0, 35.41, 0.326, 17.3, [-29.17, 0.629, -3.75e-4, 8.48e-8], { ACH: 4, ACCH3: 2 }, true),
  libChem('1,2,4-Trimethylbenzene', 'C₉H₁₂', '1,2,4-트리메틸벤젠', '1,2,4-Trimethylbenzene', '95-63-6', 'aromatic_petrochem', 'aromatic', 120.19, 169.4, 649.1, 32.32, 0.377, -13.9, [-26.2, 0.720, -4.16e-4, 9.05e-8], { ACH: 3, ACCH3: 3 }, true),
  libChem('Mesitylene', 'C₉H₁₂', '메시틸렌 (1,3,5-TMB)', 'Mesitylene', '108-67-8', 'aromatic_petrochem', 'aromatic', 120.19, 164.7, 637.3, 31.27, 0.399, -16.1, [-30.6, 0.735, -4.31e-4, 9.55e-8], { ACH: 3, ACCH3: 3 }, true),
  libChem('n-Propylbenzene', 'C₉H₁₂', '노르말프로필벤젠', 'n-Propylbenzene', '103-65-1', 'aromatic_petrochem', 'aromatic', 120.19, 159.2, 638.3, 32.0, 0.344, 7.8, [-31.2, 0.749, -4.50e-4, 1.03e-7], { ACH: 5, ACCH2: 1, CH2: 1, CH3: 1 }, true),
  libChem('alpha-Methylstyrene', 'C₉H₁₀', '알파메틸스타이렌 (AMS)', 'alpha-Methylstyrene', '98-83-9', 'aromatic_petrochem', 'aromatic', 118.18, 165.4, 654.0, 34.0, 0.319, 113.0, [-24.3, 0.693, -4.22e-4, 9.65e-8], { ACH: 5, AC: 1, 'CH2=C': 1, CH3: 1 }, true),
  libChem('Divinylbenzene', 'C₁₀H₁₀', '디비닐벤젠 (DVB)', 'Divinylbenzene', '1321-74-0', 'aromatic_petrochem', 'aromatic', 130.19, 195.0, 692.0, 30.8, 0.365, 224.0, [-28.0, 0.745, -4.60e-4, 1.05e-7], { ACH: 4, AC: 2, 'CH2=CH': 2 }, true),
  libChem('Indene', 'C₉H₈', '인덴', 'Indene', '95-13-6', 'aromatic_petrochem', 'aromatic', 116.16, 182.6, 687.0, 38.2, 0.292, 163.4, [-42.0, 0.672, -4.18e-4, 9.75e-8], { ACH: 4, AC: 1, ACCH2: 1, 'CH=CH': 1 }, true),
  libChem('Tetralin', 'C₁₀H₁₂', '테트랄린', 'Tetralin', '119-64-2', 'aromatic_petrochem', 'aromatic', 132.20, 207.6, 720.0, 36.5, 0.328, 27.6, [-55.4, 0.835, -5.02e-4, 1.13e-7], { ACH: 4, ACCH2: 2, CH2: 2 }, true),
  libChem('Decalin', 'C₁₀H₁₈', '데칼린', 'Decalin', '91-17-8', 'aromatic_petrochem', 'hydrocarbon', 138.25, 191.0, 695.0, 31.4, 0.290, -175.0, [-95.0, 1.080, -6.20e-4, 1.32e-7], { CH2: 8, CH: 2 }, true),
  libChem('Naphthalene', 'C₁₀H₈', '나프탈렌', 'Naphthalene', '91-20-3', 'aromatic_petrochem', 'aromatic', 128.17, 218.0, 748.4, 40.5, 0.302, 150.6, [-68.8, 0.850, -6.51e-4, 1.98e-7], { ACH: 8, AC: 2 }, true),
  libChem('Biphenyl', 'C₁₂H₁₀', '바이페닐', 'Biphenyl', '92-52-4', 'aromatic_petrochem', 'aromatic', 154.21, 255.0, 789.0, 38.5, 0.366, 182.0, [-97.1, 1.106, -8.86e-4, 2.79e-7], { ACH: 10, AC: 2 }, true),
  libChem('o-Cresol', 'C₇H₈O', '오르토크레졸', 'o-Cresol', '95-48-7', 'aromatic_petrochem', 'polar_solvent', 108.14, 191.0, 697.6, 50.1, 0.435, -128.6, [-32.3, 0.629, -4.16e-4, 1.04e-7], { ACH: 4, ACCH3: 1, ACOH: 1 }, false),
  libChem('m-Cresol', 'C₇H₈O', '메타크레졸', 'm-Cresol', '108-39-4', 'aromatic_petrochem', 'polar_solvent', 108.14, 202.2, 705.8, 45.6, 0.452, -132.3, [-45.0, 0.659, -4.40e-4, 1.10e-7], { ACH: 4, ACCH3: 1, ACOH: 1 }, false),
  libChem('p-Cresol', 'C₇H₈O', '파라크레졸', 'p-Cresol', '106-44-5', 'aromatic_petrochem', 'polar_solvent', 108.14, 201.9, 704.6, 51.5, 0.505, -125.4, [-40.6, 0.650, -4.35e-4, 1.08e-7], { ACH: 4, ACCH3: 1, ACOH: 1 }, false),
  libChem('BenzylAlcohol', 'C₇H₈O', '벤질알코올', 'Benzyl Alcohol', '100-51-6', 'aromatic_petrochem', 'polar_solvent', 108.14, 205.3, 715.0, 43.0, 0.390, -100.4, [-28.5, 0.642, -4.15e-4, 1.01e-7], { ACH: 5, ACCH2: 1, OH: 1 }, false),

  // ── 3) Battery Electrolyte Carbonates & Glymes (10 species) ────────────────
  libChem('EC', 'C₃H₄O₃', '에틸렌카보네이트 (EC)', 'Ethylene Carbonate', '96-49-1', 'battery_carbonate', 'polar_solvent', 88.062, 248.2, 806.0, 67.7, 0.440, -503.0, [-18.2, 0.425, -2.55e-4, 5.80e-8], { CH2: 2, OCOO: 1 }, false),
  libChem('PC', 'C₄H₆O₃', '프로필렌카보네이트 (PC)', 'Propylene Carbonate', '108-32-7', 'battery_carbonate', 'polar_solvent', 102.09, 242.0, 778.0, 56.3, 0.460, -556.0, [-14.0, 0.520, -3.10e-4, 6.95e-8], { CH3: 1, CH: 1, CH2: 1, OCOO: 1 }, false),
  libChem('EMC', 'C₄H₈O₃', '에틸메틸카보네이트 (EMC)', 'Ethyl Methyl Carbonate', '623-53-0', 'battery_carbonate', 'polar_solvent', 104.10, 107.5, 591.0, 39.2, 0.405, -605.0, [8.5, 0.485, -2.68e-4, 5.75e-8], { CH3: 2, CH2: 1, OCOO: 1 }, true),
  libChem('DEC', 'C₅H₁₀O₃', '디에틸카보네이트 (DEC)', 'Diethyl Carbonate', '105-58-8', 'battery_carbonate', 'polar_solvent', 118.13, 126.8, 576.0, 33.9, 0.485, -638.0, [6.2, 0.582, -3.22e-4, 6.90e-8], { CH3: 2, CH2: 2, OCOO: 1 }, true),
  libChem('VC', 'C₃H₂O₃', '비닐렌카보네이트 (VC)', 'Vinylene Carbonate', '872-36-6', 'battery_carbonate', 'polar_solvent', 86.046, 162.0, 678.0, 62.0, 0.395, -392.0, [-12.0, 0.365, -2.10e-4, 4.65e-8], { 'CH=CH': 1, OCOO: 1 }, false),
  libChem('FEC', 'C₃H₃FO₃', '플루오로에틸렌카보네이트 (FEC)', 'Fluoroethylene Carbonate', '114435-02-8', 'battery_carbonate', 'polar_solvent', 106.05, 212.0, 738.0, 58.5, 0.470, -685.0, [-6.0, 0.445, -2.60e-4, 5.80e-8], { CH2: 1, CH: 1, OCOO: 1 }, false),
  libChem('1,2-DME', 'C₄H₁₀O₂', '1,2-디메톡시에탄 (DME)', '1,2-Dimethoxyethane', '110-71-4', 'battery_carbonate', 'polar_solvent', 90.121, 85.0, 536.2, 38.7, 0.346, -340.2, [12.4, 0.468, -2.42e-4, 4.90e-8], { CH3O: 1, CH3: 1, CH2O: 1, CH2: 1 }, false),
  libChem('Diglyme', 'C₆H₁₄O₃', '디글라임 (DEGDME)', 'Diglyme', '111-96-6', 'battery_carbonate', 'polar_solvent', 134.17, 162.0, 606.0, 28.9, 0.502, -496.0, [18.5, 0.680, -3.55e-4, 7.20e-8], { CH3O: 1, CH3: 1, CH2O: 2, CH2: 2 }, false),
  libChem('Triglyme', 'C₈H₁₈O₄', '트리글라임 (TEGDME)', 'Triglyme', '112-49-2', 'battery_carbonate', 'polar_solvent', 178.23, 216.0, 651.0, 23.1, 0.640, -652.0, [24.0, 0.895, -4.70e-4, 9.55e-8], { CH3O: 1, CH3: 1, CH2O: 3, CH2: 3 }, false),
  libChem('MethylPropionate', 'C₄H₈O₂', '프로피온산메틸 (MP)', 'Methyl Propionate', '554-12-1', 'battery_carbonate', 'polar_solvent', 88.105, 79.8, 530.6, 40.04, 0.349, -429.0, [18.1, 0.388, -1.96e-4, 3.85e-8], { CH3: 2, CH2COO: 1 }, true),

  // ── 4) Semiconductor & Display Electronic Solvents (16 species) ────────────
  libChem('NMP', 'C₅H₉NO', 'N-메틸-2-피롤리돈 (NMP)', 'N-Methyl-2-pyrrolidone', '872-50-4', 'electronic_solvent', 'polar_solvent', 99.131, 202.0, 721.6, 45.2, 0.358, -196.0, [-26.5, 0.535, -3.12e-4, 6.85e-8], { DMF_g: 1, CH2: 2 }, false),
  libChem('DMAc', 'C₄H₉NO', '디메틸아세트아마이드 (DMAc)', 'N,N-Dimethylacetamide', '127-19-5', 'electronic_solvent', 'polar_solvent', 87.120, 165.0, 658.0, 40.3, 0.364, -238.0, [4.2, 0.462, -2.52e-4, 5.30e-8], { DMF_g: 1, CH3: 1 }, false),
  libChem('PGMEA', 'C₆H₁₂O₃', 'PGMEA (프로필렌글리콜메틸에테르아세테이트)', 'PGMEA', '108-65-6', 'electronic_solvent', 'polar_solvent', 132.16, 145.8, 597.9, 28.5, 0.432, -598.0, [14.5, 0.645, -3.45e-4, 7.15e-8], { CH3CO: 0, CH3COO: 1, CH: 1, CH3: 1, CH2O: 1 }, false),
  libChem('PGME', 'C₄H₁₀O₂', 'PGME (프로필렌글리콜모노메틸에테르)', 'PGME', '107-98-2', 'electronic_solvent', 'polar_solvent', 90.121, 120.1, 579.8, 41.7, 0.456, -422.0, [8.8, 0.456, -2.38e-4, 4.82e-8], { CH3: 1, CH: 1, OH: 1, CH2O: 1, CH3O: 0 }, false),
  libChem('GBL', 'C₄H₆O₂', '감마부티로락톤 (GBL)', 'gamma-Butyrolactone', '96-48-0', 'electronic_solvent', 'polar_solvent', 86.089, 204.0, 730.7, 51.8, 0.369, -365.0, [-19.4, 0.435, -2.58e-4, 5.82e-8], { CH2COO: 1, CH2: 2 }, false),
  libChem('Cyclohexanone', 'C₆H₁₀O', '사이클로헥사논', 'Cyclohexanone', '108-94-1', 'electronic_solvent', 'polar_solvent', 98.143, 155.6, 653.0, 40.0, 0.299, -226.1, [-38.1, 0.618, -3.55e-4, 7.62e-8], { CH2CO: 1, CH2: 4 }, false),
  libChem('Cyclopentanone', 'C₅H₈O', '사이클로펜타논', 'Cyclopentanone', '120-92-3', 'electronic_solvent', 'polar_solvent', 84.116, 130.6, 624.5, 46.0, 0.288, -192.6, [-34.0, 0.512, -2.92e-4, 6.25e-8], { CH2CO: 1, CH2: 3 }, false),
  libChem('Anisole', 'C₇H₈O', '아니솔 (메톡시벤젠)', 'Anisole', '100-66-3', 'electronic_solvent', 'polar_solvent', 108.14, 153.8, 645.6, 42.5, 0.347, -67.9, [-29.0, 0.625, -3.82e-4, 8.85e-8], { ACH: 5, AC: 1, CH3O: 1 }, true),
  libChem('EL', 'C₅H₁₀O₃', '에틸락테이트 (EL)', 'Ethyl Lactate', '97-64-3', 'electronic_solvent', 'polar_solvent', 118.13, 154.5, 605.0, 37.5, 0.562, -625.0, [11.2, 0.548, -2.92e-4, 6.02e-8], { CH3: 2, CH: 1, OH: 1, CH2COO: 1 }, false),
  libChem('ButylAcetate', 'C₆H₁₂O₂', '초산부틸 (n-Butyl Acetate)', 'n-Butyl Acetate', '123-86-4', 'electronic_solvent', 'polar_solvent', 116.16, 126.1, 579.2, 30.9, 0.417, -485.6, [11.8, 0.585, -3.12e-4, 6.45e-8], { CH3COO: 1, CH2: 3, CH3: 1 }, true),
  libChem('IsobutylAcetate', 'C₆H₁₂O₂', '초산이소부틸', 'Isobutyl Acetate', '110-19-0', 'electronic_solvent', 'polar_solvent', 116.16, 117.2, 561.0, 30.2, 0.414, -494.0, [10.2, 0.588, -3.15e-4, 6.52e-8], { CH3COO: 1, CH2: 1, CH: 1, CH3: 2 }, true),
  libChem('n-PropylAcetate', 'C₅H₁₀O₂', '초산프로필', 'n-Propyl Acetate', '109-60-4', 'electronic_solvent', 'polar_solvent', 102.13, 101.5, 549.7, 33.6, 0.389, -465.0, [14.0, 0.488, -2.56e-4, 5.20e-8], { CH3COO: 1, CH2: 2, CH3: 1 }, true),
  libChem('MIBK', 'C₆H₁₂O', '메틸이소부틸케톤 (MIBK)', 'Methyl Isobutyl Ketone', '108-10-1', 'electronic_solvent', 'polar_solvent', 100.16, 116.5, 574.6, 32.7, 0.356, -291.2, [5.8, 0.562, -2.95e-4, 5.95e-8], { CH3CO: 1, CH2: 1, CH: 1, CH3: 2 }, true),
  libChem('DIBK', 'C₉H₁₈O', '디이소부틸케톤 (DIBK)', 'Diisobutyl Ketone', '108-83-8', 'electronic_solvent', 'polar_solvent', 142.24, 168.2, 628.0, 25.3, 0.451, -358.0, [-2.5, 0.848, -4.55e-4, 9.35e-8], { CH2CO: 1, CH2: 1, CH: 2, CH3: 4 }, true),
  libChem('Sulfolane', 'C₄H₈O₂S', '설폴란 (Sulfolane)', 'Sulfolane', '126-33-0', 'electronic_solvent', 'polar_solvent', 120.17, 285.0, 855.0, 50.3, 0.384, -372.0, [-22.0, 0.542, -3.12e-4, 6.80e-8], { DMSO_g: 1, CH2: 4 }, false),
  libChem('3-Methoxypropionitrile', 'C₄H₇NO', '3-메톡시프로피오나이트릴 (MPN)', '3-Methoxypropionitrile', '110-67-8', 'electronic_solvent', 'polar_solvent', 85.105, 165.0, 638.0, 38.8, 0.445, -52.0, [14.2, 0.415, -2.18e-4, 4.45e-8], { CH3O: 1, CH2: 1, CH2CN: 1 }, false),

  // ── 5) Chlorinated Organics & Monomers (16 species) ────────────────────────
  libChem('DCM', 'CH₂Cl₂', '디클로로메탄 (염화메틸렌)', 'Dichloromethane', '75-09-2', 'chlorinated_organic', 'chlor_ech', 84.933, 39.8, 510.0, 60.8, 0.199, -95.4, [12.95, 0.1623, -1.302e-4, 4.208e-8], { CH2Cl2: 1 }, true),
  libChem('EDC', 'C₂H₄Cl₂', '1,2-디클로로에탄 (EDC)', '1,2-Dichloroethane', '107-06-2', 'chlorinated_organic', 'chlor_ech', 98.959, 83.5, 561.6, 53.7, 0.286, -129.7, [20.49, 0.2310, -1.438e-4, 3.388e-8], { CH2Cl: 2 }, true),
  libChem('1,1-Dichloroethane', 'C₂H₄Cl₂', '1,1-디클로로에탄', '1,1-Dichloroethane', '75-34-3', 'chlorinated_organic', 'chlor_ech', 98.959, 57.3, 523.0, 50.7, 0.234, -129.9, [12.47, 0.269, -1.85e-4, 4.86e-8], { CH3: 1, CHCl2: 1 }, true),
  libChem('VCM', 'C₂H₃Cl', '염화비닐 단량체 (VCM)', 'Vinyl Chloride', '75-01-4', 'chlorinated_organic', 'chlor_ech', 62.498, -13.4, 429.7, 56.0, 0.122, 28.5, [5.95, 0.2118, -1.281e-4, 3.05e-8], { 'CH2=CH': 1, CH2Cl: 1 }, true),
  libChem('VinylideneChloride', 'C₂H₂Cl₂', '염화비닐리덴 (VDC)', 'Vinylidene Chloride', '75-35-4', 'chlorinated_organic', 'chlor_ech', 96.943, 31.6, 489.0, 51.9, 0.165, 2.6, [18.9, 0.205, -1.38e-4, 3.45e-8], { 'CH2=C': 1, CH2Cl2: 1 }, true),
  libChem('TCE', 'C₂HCl₃', '트리클로로에틸렌 (TCE)', 'Trichloroethylene', '79-01-6', 'chlorinated_organic', 'chlor_ech', 131.39, 87.2, 571.0, 49.1, 0.213, -7.8, [30.17, 0.2287, -1.78e-4, 4.92e-8], { 'CH=CH': 1, CHCl3_g: 1 }, true),
  libChem('PCE', 'C₂Cl₄', '테트라클로로에틸렌 (PCE)', 'Perchloroethylene', '127-18-4', 'chlorinated_organic', 'chlor_ech', 165.83, 121.1, 620.2, 47.6, 0.254, -12.1, [45.97, 0.2256, -1.96e-4, 5.82e-8], { 'CH=CH': 1, CCl4_g: 1 }, true),
  libChem('CCl4', 'CCl₄', '사염화탄소 (CCl₄)', 'Carbon Tetrachloride', '56-23-5', 'chlorinated_organic', 'chlor_ech', 153.82, 76.7, 556.4, 45.6, 0.193, -95.9, [40.72, 0.2049, -2.27e-4, 8.84e-8], { CCl4_g: 1 }, true),
  libChem('MethylChloride', 'CH₃Cl', '염화메틸 (MeCl)', 'Methyl Chloride', '74-87-3', 'chlorinated_organic', 'chlor_ech', 50.488, -24.2, 416.3, 66.8, 0.153, -81.9, [13.88, 0.1014, -3.89e-5, 2.56e-9], { CH2Cl: 1 }, true),
  libChem('EthylChloride', 'C₂H₅Cl', '염화에틸 (EtCl)', 'Ethyl Chloride', '75-00-3', 'chlorinated_organic', 'chlor_ech', 64.514, 12.3, 460.4, 52.7, 0.190, -112.2, [-0.55, 0.2606, -1.84e-4, 5.55e-8], { CH3: 1, CH2Cl: 1 }, true),
  libChem('AllylChloride', 'C₃H₅Cl', '염화알릴 (Allyl Chloride)', 'Allyl Chloride', '107-05-1', 'chlorinated_organic', 'chlor_ech', 76.525, 45.1, 514.0, 47.1, 0.154, -0.6, [2.52, 0.3046, -1.92e-4, 4.85e-8], { 'CH2=CH': 1, CH2Cl: 1 }, true),
  libChem('1,2,3-Trichloropropane', 'C₃H₅Cl₃', '1,2,3-트리클로로프로판 (TCP)', '1,2,3-Trichloropropane', '96-18-4', 'chlorinated_organic', 'chlor_ech', 147.43, 156.8, 652.0, 39.5, 0.315, -182.9, [26.5, 0.362, -2.45e-4, 6.20e-8], { CH2Cl: 2, CHCl: 1 }, true),
  libChem('Chlorobenzene', 'C₆H₅Cl', '클로로벤젠 (MCB)', 'Chlorobenzene', '108-90-7', 'chlorinated_organic', 'chlor_ech', 112.56, 131.7, 632.4, 45.2, 0.249, 51.8, [-33.89, 0.563, -4.52e-4, 1.43e-7], { ACH: 5, ACCl: 1 }, true),
  libChem('o-Dichlorobenzene', 'C₆H₄Cl₂', '오르토디클로로벤젠 (o-DCB)', 'o-Dichlorobenzene', '95-50-1', 'chlorinated_organic', 'chlor_ech', 147.00, 180.5, 705.0, 40.7, 0.272, 30.2, [-14.2, 0.552, -4.50e-4, 1.42e-7], { ACH: 4, ACCl: 2 }, true),
  libChem('p-Dichlorobenzene', 'C₆H₄Cl₂', '파라디클로로벤젠 (p-DCB)', 'p-Dichlorobenzene', '106-46-7', 'chlorinated_organic', 'chlor_ech', 147.00, 174.1, 684.8, 41.1, 0.270, 22.5, [-14.5, 0.554, -4.52e-4, 1.43e-7], { ACH: 4, ACCl: 2 }, true),
  libChem('BenzylChloride', 'C₇H₇Cl', '벤질클로라이드', 'Benzyl Chloride', '100-44-7', 'chlorinated_organic', 'chlor_ech', 126.58, 179.3, 685.0, 39.1, 0.298, 18.8, [-28.0, 0.620, -4.25e-4, 1.12e-7], { ACH: 5, AC: 1, CH2Cl: 1 }, true),

  // ── 6) Alcohols, Glycols, Ethers, Aldehydes, Acrylates, Amines & Nitriles (48 species) ──
  libChem('1-Propanol', 'C₃H₈O', '1-프로판올 (n-Propanol)', '1-Propanol', '71-23-8', 'oxygenate_amine_nitrile', 'polar_solvent', 60.095, 97.2, 536.8, 51.75, 0.622, -255.1, [2.47, 0.3325, -1.855e-4, 4.296e-8], { CH3: 1, CH2: 2, OH: 1 }, false),
  libChem('1-Butanol', 'C₄H₁₀O', '1-부탄올 (n-Butanol)', '1-Butanol', '71-36-3', 'oxygenate_amine_nitrile', 'polar_solvent', 74.122, 117.7, 563.1, 44.23, 0.594, -274.6, [3.266, 0.4180, -2.242e-4, 4.685e-8], { CH3: 1, CH2: 3, OH: 1 }, false),
  libChem('2-Butanol', 'C₄H₁₀O', '2-부탄올 (sec-Butanol)', '2-Butanol', '78-92-2', 'oxygenate_amine_nitrile', 'polar_solvent', 74.122, 99.5, 536.1, 41.79, 0.574, -292.9, [5.75, 0.425, -2.32e-4, 4.92e-8], { CH3: 2, CH2: 1, CH: 1, OH: 1 }, false),
  libChem('Isobutanol', 'C₄H₁₀O', '이소부탄올 (i-Butanol)', 'Isobutanol', '78-83-1', 'oxygenate_amine_nitrile', 'polar_solvent', 74.122, 107.9, 547.8, 43.0, 0.592, -283.9, [-7.71, 0.468, -2.85e-4, 6.85e-8], { CH3: 2, CH: 1, CH2: 1, OH: 1 }, false),
  libChem('t-Butanol', 'C₄H₁₀O', '터셔리부탄올 (TBA)', 'tert-Butanol', '75-65-0', 'oxygenate_amine_nitrile', 'polar_solvent', 74.122, 82.4, 506.2, 39.73, 0.612, -312.5, [-48.6, 0.717, -7.08e-4, 2.92e-7], { CH3: 3, C: 1, OH: 1 }, false),
  libChem('1-Pentanol', 'C₅H₁₂O', '1-펜탄올 (n-Amyl Alcohol)', '1-Pentanol', '71-41-0', 'oxygenate_amine_nitrile', 'polar_solvent', 88.148, 137.9, 588.1, 39.09, 0.579, -298.7, [3.87, 0.504, -2.64e-4, 5.30e-8], { CH3: 1, CH2: 4, OH: 1 }, true),
  libChem('IsoamylAlcohol', 'C₅H₁₂O', '이소아밀알코올', 'Isoamyl Alcohol', '123-51-3', 'oxygenate_amine_nitrile', 'polar_solvent', 88.148, 131.1, 579.4, 39.1, 0.583, -302.2, [-2.5, 0.525, -2.82e-4, 5.85e-8], { CH3: 2, CH: 1, CH2: 2, OH: 1 }, true),
  libChem('1-Hexanol', 'C₆H₁₄O', '1-헥산올', '1-Hexanol', '111-27-3', 'oxygenate_amine_nitrile', 'polar_solvent', 102.17, 157.5, 611.4, 34.46, 0.560, -317.6, [4.81, 0.589, -3.01e-4, 5.86e-8], { CH3: 1, CH2: 5, OH: 1 }, true),
  libChem('Cyclohexanol', 'C₆H₁₂O', '사이클로헥산올', 'Cyclohexanol', '108-93-0', 'oxygenate_amine_nitrile', 'polar_solvent', 100.16, 161.1, 650.0, 42.6, 0.369, -286.2, [-55.5, 0.728, -4.35e-4, 9.85e-8], { CH2: 5, CH: 1, OH: 1 }, false),
  libChem('2-Ethylhexanol', 'C₈H₁₈O', '2-에틸헥산올 (2-EH)', '2-Ethylhexanol', '104-76-7', 'oxygenate_amine_nitrile', 'polar_solvent', 130.23, 184.6, 640.2, 27.6, 0.558, -365.3, [2.10, 0.778, -4.12e-4, 8.42e-8], { CH3: 2, CH2: 5, CH: 1, OH: 1 }, true),
  libChem('1-Octanol', 'C₈H₁₈O', '1-옥탄올 (n-Octanol)', '1-Octanol', '111-87-5', 'oxygenate_amine_nitrile', 'polar_solvent', 130.23, 195.2, 652.5, 27.77, 0.587, -355.5, [6.17, 0.761, -3.80e-4, 7.12e-8], { CH3: 1, CH2: 7, OH: 1 }, true),
  libChem('1,2-Propanediol', 'C₃H₈O₂', '프로필렌글리콜 (MPG)', '1,2-Propanediol', '57-55-6', 'oxygenate_amine_nitrile', 'polar_solvent', 76.094, 187.6, 626.0, 61.0, 1.107, -421.5, [0.63, 0.370, -1.95e-4, 3.92e-8], { CH3: 1, CH: 1, CH2: 1, OH: 2 }, false),
  libChem('1,3-Propanediol', 'C₃H₈O₂', '1,3-프로판디올 (PDO)', '1,3-Propanediol', '504-63-2', 'oxygenate_amine_nitrile', 'polar_solvent', 76.094, 214.4, 658.0, 59.5, 1.150, -408.8, [3.20, 0.362, -1.88e-4, 3.75e-8], { CH2: 3, OH: 2 }, false),
  libChem('1,4-Butanediol', 'C₄H₁₀O₂', '1,4-부탄디올 (BDO)', '1,4-Butanediol', '110-63-4', 'oxygenate_amine_nitrile', 'polar_solvent', 90.121, 230.0, 667.0, 48.8, 1.189, -426.7, [4.50, 0.456, -2.38e-4, 4.82e-8], { CH2: 4, OH: 2 }, false),
  libChem('DEG', 'C₄H₁₀O₃', '디에틸렌글리콜 (DEG)', 'Diethylene Glycol', '111-46-6', 'oxygenate_amine_nitrile', 'polar_solvent', 106.12, 245.0, 680.0, 46.0, 1.040, -571.0, [21.0, 0.445, -2.25e-4, 4.45e-8], { CH2O: 1, CH2: 3, OH: 2 }, false),
  libChem('TEG', 'C₆H₁₄O₄', '트리에틸렌글리콜 (TEG)', 'Triethylene Glycol', '112-27-6', 'oxygenate_amine_nitrile', 'polar_solvent', 150.17, 285.0, 700.0, 33.2, 1.210, -725.0, [32.0, 0.655, -3.35e-4, 6.75e-8], { CH2O: 2, CH2: 4, OH: 2 }, false),
  libChem('DiethylEther', 'C₄H₁₀O', '디에틸에테르 (DEE)', 'Diethyl Ether', '60-29-7', 'oxygenate_amine_nitrile', 'polar_solvent', 74.122, 34.5, 466.7, 36.4, 0.281, -252.2, [21.42, 0.3359, -1.035e-4, -9.357e-9], { CH3: 2, CH2: 1, CH2O: 1 }, true),
  libChem('DiisopropylEther', 'C₆H₁₄O', '디이소프로필에테르 (DIPE)', 'Diisopropyl Ether', '108-20-3', 'oxygenate_amine_nitrile', 'polar_solvent', 102.17, 68.3, 500.0, 28.8, 0.331, -319.2, [7.52, 0.565, -2.98e-4, 6.12e-8], { CH3: 4, CH: 1, CHOCH2: 1 }, true),
  libChem('1,4-Dioxane', 'C₄H₈O₂', '1,4-디옥산', '1,4-Dioxane', '123-91-1', 'oxygenate_amine_nitrile', 'polar_solvent', 88.105, 101.1, 587.0, 52.1, 0.281, -315.8, [-53.57, 0.5987, -4.09e-4, 1.06e-7], { CH2O_cyclic: 2, CH2: 2 }, false),
  libChem('EthyleneOxide', 'C₂H₄O', '산화에틸렌 (EO)', 'Ethylene Oxide', '75-21-8', 'oxygenate_amine_nitrile', 'polar_solvent', 44.053, 10.7, 469.2, 71.9, 0.202, -52.6, [-7.52, 0.2222, -1.256e-4, 2.59e-8], { CH2O_cyclic: 1, CH2: 1 }, false),
  libChem('PropyleneOxide', 'C₃H₆O', '산화프로필렌 (PO)', 'Propylene Oxide', '75-56-9', 'oxygenate_amine_nitrile', 'polar_solvent', 58.079, 34.2, 482.2, 49.2, 0.271, -94.7, [-8.46, 0.323, -1.83e-4, 3.88e-8], { CH2O_cyclic: 1, CH: 1, CH3: 1 }, false),
  libChem('Acetaldehyde', 'C₂H₄O', '아세트알데하이드', 'Acetaldehyde', '75-07-0', 'oxygenate_amine_nitrile', 'polar_solvent', 44.053, 20.2, 466.0, 55.7, 0.291, -166.2, [7.72, 0.1823, -1.007e-4, 2.38e-8], { CH3: 1, CHO: 1 }, false),
  libChem('Propionaldehyde', 'C₃H₆O', '프로피온알데하이드', 'Propionaldehyde', '123-38-6', 'oxygenate_amine_nitrile', 'polar_solvent', 58.079, 48.0, 504.4, 49.2, 0.313, -185.6, [11.7, 0.261, -1.30e-4, 2.48e-8], { CH3: 1, CH2: 1, CHO: 1 }, false),
  libChem('n-Butyraldehyde', 'C₄H₈O', '노르말부티르알데하이드', 'n-Butyraldehyde', '123-72-8', 'oxygenate_amine_nitrile', 'polar_solvent', 72.106, 74.8, 537.2, 43.2, 0.345, -204.8, [14.1, 0.346, -1.72e-4, 3.25e-8], { CH3: 1, CH2: 2, CHO: 1 }, true),
  libChem('Isobutyraldehyde', 'C₄H₈O', '이소부티르알데하이드', 'Isobutyraldehyde', '78-84-2', 'oxygenate_amine_nitrile', 'polar_solvent', 72.106, 64.1, 519.0, 41.5, 0.345, -215.8, [9.8, 0.362, -1.86e-4, 3.65e-8], { CH3: 2, CH: 1, CHO: 1 }, true),
  libChem('Benzaldehyde', 'C₇H₆O', '벤즈알데하이드', 'Benzaldehyde', '100-52-7', 'oxygenate_amine_nitrile', 'polar_solvent', 106.12, 178.8, 695.0, 46.5, 0.316, -36.7, [-12.2, 0.498, -3.21e-4, 7.82e-8], { ACH: 5, AC: 1, CHO: 1 }, true),
  libChem('Furfural', 'C₅H₄O₂', '푸르푸랄', 'Furfural', '98-01-1', 'oxygenate_amine_nitrile', 'polar_solvent', 96.084, 161.7, 670.2, 56.6, 0.368, -151.0, [-8.5, 0.415, -2.58e-4, 6.10e-8], { 'CH=CH': 2, CH2O_cyclic: 1, CHO: 1 }, false),
  libChem('MethylFormate', 'C₂H₄O₂', '포름산메틸', 'Methyl Formate', '107-31-3', 'oxygenate_amine_nitrile', 'polar_solvent', 60.052, 31.7, 487.2, 60.0, 0.257, -355.5, [1.43, 0.270, -1.48e-4, 3.12e-8], { CH3: 1, CH2COO: 1 }, false),
  libChem('MethylAcetate', 'C₃H₆O₂', '초산메틸', 'Methyl Acetate', '79-20-9', 'oxygenate_amine_nitrile', 'polar_solvent', 74.079, 56.9, 506.6, 47.5, 0.331, -411.9, [16.55, 0.2245, -4.34e-5, -2.91e-8], { CH3: 1, CH3COO: 1 }, false),
  libChem('VinylAcetate', 'C₄H₆O₂', '초산비닐 단량체 (VAM)', 'Vinyl Acetate', '108-05-4', 'oxygenate_amine_nitrile', 'polar_solvent', 86.089, 72.7, 519.1, 39.6, 0.351, -314.9, [15.0, 0.308, -1.48e-4, 2.65e-8], { 'CH2=CH': 1, CH3COO: 1 }, true),
  libChem('MethylAcrylate', 'C₄H₆O₂', '메틸아크릴레이트 (MA)', 'Methyl Acrylate', '96-33-3', 'oxygenate_amine_nitrile', 'polar_solvent', 86.089, 80.1, 536.0, 42.5, 0.348, -333.0, [14.2, 0.312, -1.52e-4, 2.75e-8], { 'CH2=CH': 1, CH2COO: 1, CH3: 1 }, true),
  libChem('ButylAcrylate', 'C₇H₁₂O₂', '부틸아크릴레이트 (BA)', 'n-Butyl Acrylate', '141-32-2', 'oxygenate_amine_nitrile', 'polar_solvent', 128.17, 145.7, 598.0, 29.2, 0.455, -395.0, [11.5, 0.605, -3.22e-4, 6.55e-8], { 'CH2=CH': 1, CH2COO: 1, CH2: 3, CH3: 1 }, true),
  libChem('MMA', 'C₅H₈O₂', '메틸메타크릴레이트 (MMA)', 'Methyl Methacrylate', '80-62-6', 'oxygenate_amine_nitrile', 'polar_solvent', 100.12, 100.5, 564.0, 36.8, 0.355, -332.0, [10.8, 0.415, -2.12e-4, 4.18e-8], { 'CH2=C': 1, CH3: 2, CH2COO: 1 }, true),
  libChem('PropionicAcid', 'C₃H₆O₂', '프로피온산', 'Propionic Acid', '79-09-4', 'oxygenate_amine_nitrile', 'polar_solvent', 74.079, 141.2, 600.8, 46.6, 0.536, -453.5, [5.67, 0.369, -2.28e-4, 5.56e-8], { CH3: 1, CH2: 1, COOH: 1 }, false),
  libChem('ButyricAcid', 'C₄H₈O₂', '뷰티르산 (낙산)', 'n-Butyric Acid', '107-92-6', 'oxygenate_amine_nitrile', 'polar_solvent', 88.105, 163.7, 615.7, 40.6, 0.681, -475.8, [11.7, 0.443, -2.51e-4, 5.58e-8], { CH3: 1, CH2: 2, COOH: 1 }, false),
  libChem('AcrylicAcid', 'C₃H₄O₂', '아크릴산 (AA)', 'Acrylic Acid', '79-10-7', 'oxygenate_amine_nitrile', 'polar_solvent', 72.063, 141.0, 615.0, 56.6, 0.518, -336.2, [1.74, 0.319, -2.35e-4, 6.98e-8], { 'CH2=CH': 1, COOH: 1 }, false),
  libChem('MethacrylicAcid', 'C₄H₆O₂', '메타크릴산 (MAA)', 'Methacrylic Acid', '79-41-4', 'oxygenate_amine_nitrile', 'polar_solvent', 86.089, 161.0, 643.0, 47.0, 0.532, -367.0, [4.50, 0.405, -2.62e-4, 6.85e-8], { 'CH2=C': 1, CH3: 1, COOH: 1 }, false),
  libChem('Acetonitrile', 'C₂H₃N', '아세토나이트릴 (ACN)', 'Acetonitrile', '75-05-8', 'oxygenate_amine_nitrile', 'polar_solvent', 41.052, 81.6, 545.5, 48.3, 0.338, 74.0, [20.48, 0.1196, -4.49e-5, 3.20e-9], { CH3CN: 1 }, false),
  libChem('Propionitrile', 'C₃H₅N', '프로피오나이트릴', 'Propionitrile', '107-12-0', 'oxygenate_amine_nitrile', 'polar_solvent', 55.079, 97.4, 564.4, 41.8, 0.325, 51.5, [15.4, 0.225, -1.10e-4, 1.96e-8], { CH3: 1, CH2CN: 1 }, false),
  libChem('Acrylonitrile', 'C₃H₃N', '아크릴로나이트릴 (AN)', 'Acrylonitrile', '107-13-1', 'oxygenate_amine_nitrile', 'polar_solvent', 53.063, 77.3, 535.0, 45.4, 0.350, 184.9, [10.69, 0.2208, -1.565e-4, 4.60e-8], { 'CH2=CH': 1, CH2CN: 1 }, false),
  libChem('Adiponitrile', 'C₆H₈N₂', '아디포나이트릴 (ADN)', 'Adiponitrile', '111-69-3', 'oxygenate_amine_nitrile', 'polar_solvent', 108.14, 295.0, 781.0, 28.0, 0.612, 149.0, [18.5, 0.495, -2.65e-4, 5.45e-8], { CH2: 2, CH2CN: 2 }, false),
  libChem('Aniline', 'C₆H₇N', '아닐린', 'Aniline', '62-53-3', 'oxygenate_amine_nitrile', 'aromatic', 93.127, 184.1, 699.0, 53.1, 0.384, 87.0, [-40.5, 0.638, -5.13e-4, 1.63e-7], { ACH: 5, ACNH2: 1 }, false),
  libChem('Pyridine', 'C₅H₅N', '피리딘', 'Pyridine', '110-86-1', 'oxygenate_amine_nitrile', 'polar_solvent', 79.100, 115.2, 620.0, 56.3, 0.243, 140.4, [-39.79, 0.4928, -3.558e-4, 1.005e-7], { C5H5N: 1 }, false),
  libChem('DEA', 'C₄H₁₁NO₂', '디에탄올아민 (DEA)', 'Diethanolamine', '111-42-2', 'oxygenate_amine_nitrile', 'polar_solvent', 105.14, 268.8, 736.6, 49.4, 1.046, -396.0, [11.2, 0.512, -2.68e-4, 5.42e-8], { CH2NH: 1, CH2: 3, OH: 2 }, false),
  libChem('TEA', 'C₆H₁₅NO₃', '트리에탄올아민 (TEA)', 'Triethanolamine', '102-71-6', 'oxygenate_amine_nitrile', 'polar_solvent', 149.19, 335.4, 772.1, 36.2, 1.240, -562.0, [18.5, 0.725, -3.82e-4, 7.75e-8], { CH2N: 1, CH2: 5, OH: 3 }, false),
  libChem('Piperazine', 'C₄H₁₀N₂', '피페라진 (PZ 흡수촉진제)', 'Piperazine', '110-85-0', 'oxygenate_amine_nitrile', 'polar_solvent', 86.136, 146.0, 638.0, 55.3, 0.414, 16.5, [-35.0, 0.560, -3.32e-4, 7.25e-8], { CH2NH: 2, CH2: 2 }, false),
  libChem('Morpholine', 'C₄H₉NO', '모폴린', 'Morpholine', '110-91-8', 'oxygenate_amine_nitrile', 'polar_solvent', 87.120, 128.9, 618.0, 53.4, 0.358, -151.0, [-42.0, 0.548, -3.28e-4, 7.18e-8], { CH2O_cyclic: 1, CH2NH: 1, CH2: 2 }, false),
  libChem('Cyclohexylamine', 'C₆H₁₃N', '사이클로헥실아민', 'Cyclohexylamine', '108-91-8', 'oxygenate_amine_nitrile', 'polar_solvent', 99.174, 134.5, 614.2, 42.0, 0.335, -104.9, [-52.0, 0.745, -4.35e-4, 9.55e-8], { CH2: 5, CH: 1, CH2NH2: 1 }, false),
  libChem('Triethylamine', 'C₆H₁₅N', '트리에틸아민 (TEA-amine)', 'Triethylamine', '121-44-8', 'oxygenate_amine_nitrile', 'polar_solvent', 101.19, 88.8, 535.2, 30.3, 0.320, -92.8, [-18.4, 0.716, -4.40e-4, 1.05e-7], { CH3: 3, CH2: 2, CH2N: 1 }, true),
];

// ----------------------------------------------------------------------------
// 6. Runtime Slot Mutator for CUSTOM_1 & CUSTOM_2
// ----------------------------------------------------------------------------
function familyToCompMetaGroup(
  family: CompChemicalFamily
): 'core' | '1B_inorg' | '2_ech' | 'gas_syngas' | 'hydrocarbon' | 'aromatic' | 'polar_solvent' {
  if (family === 'chlor_ech') return '2_ech';
  if (family === 'gas_syngas') return 'gas_syngas';
  if (family === 'hydrocarbon') return 'hydrocarbon';
  if (family === 'aromatic') return 'aromatic';
  return 'polar_solvent';
}

function reliableMethodsForFamily(family: CompChemicalFamily): ResolvedPropertyMethod[] {
  if (family === 'hydrocarbon') return ['PR', 'SRK', 'NRTL'];
  if (family === 'aromatic') return ['PR', 'SRK', 'NRTL'];
  return ['NRTL', 'PR', 'SRK', 'ENRTL'];
}

export const DEFAULT_CUSTOM_SLOTS: Record<CustomSlotKey, CustomComponentSpec> = {
  CUSTOM_1: EXTENDED_CHEMICAL_LIBRARY.find(c => c.id === '1-Butanol')!,
  CUSTOM_2: EXTENDED_CHEMICAL_LIBRARY.find(c => c.id === 'Aniline')!,
};

export const ACTIVE_CUSTOM_SLOTS: Record<CustomSlotKey, CustomComponentSpec> = {
  CUSTOM_1: DEFAULT_CUSTOM_SLOTS.CUSTOM_1,
  CUSTOM_2: DEFAULT_CUSTOM_SLOTS.CUSTOM_2,
};

export function getActiveCustomSlotSpec(slot: CustomSlotKey): CustomComponentSpec {
  return ACTIVE_CUSTOM_SLOTS[slot];
}

/**
 * Mutates all runtime thermodynamic, EOS, UNIFAC, catalog, and flowsheet metadata
 * tables in-place for `CUSTOM_1` or `CUSTOM_2`.
 */
export function applyCustomSpecToSlot(slot: CustomSlotKey, spec: CustomComponentSpec): CustomComponentSpec {
  ACTIVE_CUSTOM_SLOTS[slot] = spec;

  // 1) Molecular weight table
  (MW as Record<string, number>)[slot] = spec.mw;
  updateActivityCompMW(slot, spec.mw);

  // 2) Formation-basis Thermo Core (Cp_ig, ΔHf°, Tc, Watson ΔHvap, Cp_L)
  const isGasStd = spec.tbC < 15.0;
  THERMO_DATA[slot] = {
    mw: spec.mw,
    kind: spec.tcK < 190.0 ? 'permanent_gas' : 'molecular',
    dHfIg: spec.dHfIg298_kJ_mol,
    cpIg: [...spec.cpIg] as [number, number, number, number],
    Tc: spec.tcK,
    TvapRef: 298.15,
    dHvapRef: spec.dHvap298_kJ_mol,
    cpLiq298: spec.cpLiq298_J_molK,
  };
  invalidateThermoCache(slot);

  // 3) Cubic EOS critical parameters + rebuild PR/SRK k_ij cache
  RIGOROUS_CRIT[slot] = {
    Tc_K: spec.tcK,
    Pc_bar: spec.pcBar,
    omega: spec.omega,
    mw: spec.mw,
  };
  rebuildRigorousKijCache();
  invalidateDepartureKijCache();

  // 4) Monotonic DIPPR-101 vapor pressure curve
  PSAT_DIPPR101[slot] = { ...spec.dippr101 };

  // 5) Hansen (1991) UNIFAC functional subgroup counts + hydrophobicity + clear stale BIPs
  clearNrtlBipForSlot(slot);
  setComponentUnifacGroups(slot, spec.unifacGroups);
  setComponentHydrophobic(slot, spec.hydrophobic);

  // 6) Component Catalog metadata (Carlson property recommender + UI badges)
  COMP_CATALOG_META[slot] = {
    cas: spec.cas || 'CUSTOM',
    tbC: Number(spec.tbC.toFixed(1)),
    family: spec.family,
    familyLabelKo: COMP_FAMILY_LABELS[spec.family],
    reliableMethods: reliableMethodsForFamily(spec.family),
    isPolarOrganic: !spec.hydrophobic || spec.family === 'polar_solvent',
    isHydrocarbon: spec.family === 'hydrocarbon' || spec.family === 'aromatic',
    noteKo:
      spec.source === 'joback_unifac'
        ? `[Joback+UNIFAC 분자설계] ${spec.nameKo} (${spec.nameEn}) · Tb ${spec.tbC.toFixed(1)}°C`
        : `[확장 라이브러리] ${spec.nameKo} (${spec.nameEn}) · Tb ${spec.tbC.toFixed(1)}°C`,
  };

  // 7) Flowsheet COMP_META (in-place mutation on exported runtime record)
  const T0 = 298.15;
  const cpGasJmolK = Math.max(
    25.0,
    spec.cpIg[0] + spec.cpIg[1] * T0 + spec.cpIg[2] * T0 * T0 + spec.cpIg[3] * T0 ** 3
  );
  const cpGasKcalKgC = cpGasJmolK / (spec.mw * KJ_PER_KCAL);
  const cpLiqKcalKgC = spec.cpLiq298_J_molK / (spec.mw * KJ_PER_KCAL);

  COMP_META[slot] = {
    formula: spec.formula || slot,
    label: `${spec.nameKo} [${slot === 'CUSTOM_1' ? '확장#1' : '확장#2'}]`,
    mw: Number(spec.mw.toFixed(3)),
    isGasAtStd: isGasStd,
    cpLiq: Number(Math.max(0.18, Math.min(1.10, cpLiqKcalKgC)).toFixed(3)),
    cpGas: Number(Math.max(0.12, Math.min(0.95, cpGasKcalKgC)).toFixed(3)),
    group: familyToCompMetaGroup(spec.family),
  };

  return spec;
}

export function applyExtendedChemicalToSlot(
  slot: CustomSlotKey,
  chemId: string
): CustomComponentSpec | null {
  const found = EXTENDED_CHEMICAL_LIBRARY.find(c => c.id === chemId);
  if (!found) return null;
  return applyCustomSpecToSlot(slot, found);
}

export function buildSpecFromJobackGroups(
  groups: Partial<Record<JobackGroupId, number>>,
  meta: {
    id?: string;
    formula: string;
    nameKo: string;
    nameEn?: string;
    cas?: string;
    tbExpC?: number;
  }
): { spec: CustomComponentSpec; prediction: JobackPredictionResult } {
  const pred = predictPropertiesFromJobackGroups(groups, { tbExpC: meta.tbExpC });
  const spec: CustomComponentSpec = {
    id: meta.id || `JOBACK_${Date.now()}`,
    formula: meta.formula.trim() || 'Custom',
    nameKo: meta.nameKo.trim() || '사용자 설계 분자',
    nameEn: (meta.nameEn || meta.nameKo || 'Custom Molecule').trim(),
    cas: (meta.cas || 'Joback-UNIFAC').trim(),
    category: 'oxygenate_amine_nitrile',
    family: pred.family,
    mw: Number(pred.mw.toFixed(3)),
    tbC: Number(pred.tbC.toFixed(2)),
    tcK: Number(pred.tc_K.toFixed(2)),
    pcBar: Number(pred.pc_bar.toFixed(2)),
    omega: Number(pred.omega.toFixed(4)),
    dHfIg298_kJ_mol: Number(pred.dHfIg298_kJ_mol.toFixed(2)),
    cpIg: pred.cpIg,
    dHvap298_kJ_mol: Number(pred.dHvap298_kJ_mol.toFixed(2)),
    cpLiq298_J_molK: Number(pred.cpLiq298_J_molK.toFixed(2)),
    dippr101: pred.dippr101,
    unifacGroups: pred.unifacGroups,
    hydrophobic: pred.hydrophobic,
    source: 'joback_unifac',
  };
  return { spec, prediction: pred };
}

export function resetCustomSlot(slot: CustomSlotKey): CustomComponentSpec {
  return applyCustomSpecToSlot(slot, DEFAULT_CUSTOM_SLOTS[slot]);
}

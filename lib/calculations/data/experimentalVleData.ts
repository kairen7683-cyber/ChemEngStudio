// ============================================================================
// Experimental Thermodynamic Validation Benchmark Databank (W2)
//   Contains >=18 published reference datasets spanning:
//     - Isobaric T-x-y VLE (10 binary systems: polar aqueous, minimum-boiling &
//       maximum-boiling azeotropes, associating carboxylic acid, aromatics/alkanes)
//     - High-pressure isothermal P-x-y VLE (3 hydrocarbon / CO2 systems)
//     - Aqueous electrolyte Boiling Point Elevation & HCl-H2O max-boiling azeotrope
//     - Mutual Liquid-Liquid Equilibrium (LLE) solubilities at 25 C
//     - Infinite-dilution activity coefficients (gamma_i^inf) in water at 25 C
// ============================================================================

import type { SimCompKey } from '../flowsheetSolver';
import type { ResolvedPropertyMethod } from '../componentCatalog';

export interface IsobaricVlePoint {
  x1: number;
  T_C: number;
  y1: number;
}

export interface IsobaricVleDataset {
  id: string;
  comp1: SimCompKey;
  comp2: SimCompKey;
  P_bar: number;
  recommendedMethod: ResolvedPropertyMethod;
  azeotrope?: {
    type: 'minimum-boiling' | 'maximum-boiling';
    x1: number;
    T_C: number;
  };
  source: string;
  points: IsobaricVlePoint[];
}

export interface IsothermalVlePoint {
  x1: number;
  P_bar: number;
  y1: number;
}

export interface IsothermalVleDataset {
  id: string;
  comp1: SimCompKey;
  comp2: SimCompKey;
  T_C: number;
  recommendedMethod: ResolvedPropertyMethod;
  source: string;
  points: IsothermalVlePoint[];
}

export interface ElectrolyteBpePoint {
  wtPctSolute: number;
  T_boil_C: number;
  bpe_K: number;
}

export interface ElectrolyteBpeDataset {
  id: string;
  solute: SimCompKey;
  solvent: 'H2O';
  P_bar: number;
  recommendedMethod: ResolvedPropertyMethod;
  azeotrope?: {
    wtPctSolute: number;
    xSoluteMoleFrac: number;
    T_C: number;
  };
  source: string;
  points: ElectrolyteBpePoint[];
}

export interface MutualLlePoint {
  id: string;
  organic: SimCompKey;
  T_C: number;
  orgInAqWtPct: number;
  waterInOrgWtPct: number;
  xOrgInAq: number;
  xWaterInOrg: number;
  source: string;
}

export interface InfiniteDilutionGammaEntry {
  solute: SimCompKey;
  solvent: 'H2O';
  T_C: number;
  gammaInfExp: number;
  source: string;
}

// ----------------------------------------------------------------------------
// 1. Isobaric Binary T-x-y VLE Benchmarks (Datasets 1 - 10)
// ----------------------------------------------------------------------------
export const ISOBARIC_VLE_DATASETS: IsobaricVleDataset[] = [
  {
    id: 'vle-01-etoh-h2o',
    comp1: 'EtOH',
    comp2: 'H2O',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    azeotrope: { type: 'minimum-boiling', x1: 0.8943, T_C: 78.15 },
    source: 'Kurihara, Nakamichi & Kojima, J. Chem. Eng. Data 38 (1993) 446; Gmehling DECHEMA VLE Data Collection Vol. I/1',
    points: [
      { x1: 0.05, T_C: 89.45, y1: 0.337 },
      { x1: 0.10, T_C: 85.30, y1: 0.442 },
      { x1: 0.20, T_C: 82.00, y1: 0.531 },
      { x1: 0.30, T_C: 80.65, y1: 0.579 },
      { x1: 0.40, T_C: 79.80, y1: 0.618 },
      { x1: 0.50, T_C: 79.20, y1: 0.656 },
      { x1: 0.60, T_C: 78.75, y1: 0.699 },
      { x1: 0.70, T_C: 78.41, y1: 0.753 },
      { x1: 0.80, T_C: 78.21, y1: 0.820 },
      { x1: 0.894, T_C: 78.15, y1: 0.894 },
      { x1: 0.95, T_C: 78.22, y1: 0.946 },
    ],
  },
  {
    id: 'vle-02-meoh-h2o',
    comp1: 'MeOH',
    comp2: 'H2O',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    source: 'Kurihara, Minoura, Takeda & Kojima, Fluid Phase Equilib. 108 (1995) 289; Gmehling DECHEMA Vol. I/1',
    points: [
      { x1: 0.05, T_C: 92.30, y1: 0.268 },
      { x1: 0.10, T_C: 87.70, y1: 0.418 },
      { x1: 0.20, T_C: 81.70, y1: 0.579 },
      { x1: 0.30, T_C: 78.00, y1: 0.665 },
      { x1: 0.40, T_C: 75.30, y1: 0.729 },
      { x1: 0.50, T_C: 73.10, y1: 0.779 },
      { x1: 0.60, T_C: 71.20, y1: 0.825 },
      { x1: 0.70, T_C: 69.30, y1: 0.870 },
      { x1: 0.80, T_C: 67.60, y1: 0.915 },
      { x1: 0.90, T_C: 66.00, y1: 0.958 },
    ],
  },
  {
    id: 'vle-03-ipa-h2o',
    comp1: 'IPA',
    comp2: 'H2O',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    azeotrope: { type: 'minimum-boiling', x1: 0.685, T_C: 80.32 },
    source: 'Wilson & Simons, Ind. Eng. Chem. 44 (1952) 2214; Gmehling DECHEMA Vol. I/1b',
    points: [
      { x1: 0.05, T_C: 87.00, y1: 0.415 },
      { x1: 0.10, T_C: 83.85, y1: 0.502 },
      { x1: 0.20, T_C: 82.10, y1: 0.548 },
      { x1: 0.30, T_C: 81.45, y1: 0.571 },
      { x1: 0.40, T_C: 81.00, y1: 0.594 },
      { x1: 0.50, T_C: 80.65, y1: 0.621 },
      { x1: 0.60, T_C: 80.40, y1: 0.654 },
      { x1: 0.685, T_C: 80.32, y1: 0.685 },
      { x1: 0.80, T_C: 80.55, y1: 0.755 },
      { x1: 0.90, T_C: 81.25, y1: 0.849 },
    ],
  },
  {
    id: 'vle-04-acetone-h2o',
    comp1: 'Acetone',
    comp2: 'H2O',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    source: 'Othmer & Morley, Ind. Eng. Chem. 38 (1946) 751; Kojima et al., Kagaku Kogaku 32 (1968) 337; Gmehling Vol. I/1b',
    points: [
      { x1: 0.05, T_C: 78.40, y1: 0.612 },
      { x1: 0.10, T_C: 69.80, y1: 0.728 },
      { x1: 0.20, T_C: 63.70, y1: 0.802 },
      { x1: 0.30, T_C: 61.20, y1: 0.828 },
      { x1: 0.40, T_C: 59.90, y1: 0.844 },
      { x1: 0.50, T_C: 59.00, y1: 0.858 },
      { x1: 0.60, T_C: 58.30, y1: 0.873 },
      { x1: 0.70, T_C: 57.65, y1: 0.892 },
      { x1: 0.80, T_C: 57.05, y1: 0.918 },
      { x1: 0.90, T_C: 56.50, y1: 0.953 },
    ],
  },
  {
    id: 'vle-05-acetone-chcl3',
    comp1: 'Acetone',
    comp2: 'CHCl3',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    azeotrope: { type: 'maximum-boiling', x1: 0.339, T_C: 64.43 },
    source: 'Mueller & Kearns, J. Chem. Eng. Data 3 (1958) 21; Gmehling DECHEMA Vol. I/3a',
    points: [
      { x1: 0.10, T_C: 62.65, y1: 0.062 },
      { x1: 0.20, T_C: 63.85, y1: 0.156 },
      { x1: 0.30, T_C: 64.38, y1: 0.285 },
      { x1: 0.339, T_C: 64.43, y1: 0.339 },
      { x1: 0.40, T_C: 64.32, y1: 0.426 },
      { x1: 0.50, T_C: 63.65, y1: 0.566 },
      { x1: 0.60, T_C: 62.45, y1: 0.693 },
      { x1: 0.70, T_C: 60.95, y1: 0.798 },
      { x1: 0.80, T_C: 59.35, y1: 0.881 },
      { x1: 0.90, T_C: 57.75, y1: 0.947 },
    ],
  },
  {
    id: 'vle-06-acetone-meoh',
    comp1: 'Acetone',
    comp2: 'MeOH',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    azeotrope: { type: 'minimum-boiling', x1: 0.780, T_C: 55.50 },
    source: 'Freshwater & Pike, J. Chem. Eng. Data 12 (1967) 179; Gmehling DECHEMA Vol. I/2a',
    points: [
      { x1: 0.10, T_C: 61.80, y1: 0.228 },
      { x1: 0.20, T_C: 59.50, y1: 0.369 },
      { x1: 0.30, T_C: 57.95, y1: 0.472 },
      { x1: 0.40, T_C: 56.90, y1: 0.553 },
      { x1: 0.50, T_C: 56.20, y1: 0.622 },
      { x1: 0.60, T_C: 55.78, y1: 0.684 },
      { x1: 0.70, T_C: 55.56, y1: 0.742 },
      { x1: 0.78, T_C: 55.50, y1: 0.780 },
      { x1: 0.90, T_C: 55.72, y1: 0.875 },
    ],
  },
  {
    id: 'vle-07-etoac-etoh',
    comp1: 'EtOAc',
    comp2: 'EtOH',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    azeotrope: { type: 'minimum-boiling', x1: 0.540, T_C: 71.80 },
    source: 'Murti & Van Winkle, Chem. Eng. Data Ser. 3 (1958) 72; Griswold, Chu & Winsauer (1949); Gmehling Vol. I/2b',
    points: [
      { x1: 0.10, T_C: 75.50, y1: 0.205 },
      { x1: 0.20, T_C: 73.75, y1: 0.326 },
      { x1: 0.30, T_C: 72.68, y1: 0.408 },
      { x1: 0.40, T_C: 72.08, y1: 0.469 },
      { x1: 0.50, T_C: 71.83, y1: 0.520 },
      { x1: 0.54, T_C: 71.80, y1: 0.540 },
      { x1: 0.60, T_C: 71.88, y1: 0.572 },
      { x1: 0.70, T_C: 72.25, y1: 0.633 },
      { x1: 0.80, T_C: 73.05, y1: 0.712 },
      { x1: 0.90, T_C: 74.55, y1: 0.825 },
    ],
  },
  {
    id: 'vle-08-benzene-toluene',
    comp1: 'Benzene',
    comp2: 'Toluene',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    source: 'Griswold, Andres & Klein, Trans. AIChE 39 (1943) 223; Gmehling DECHEMA Vol. I/7',
    points: [
      { x1: 0.10, T_C: 106.15, y1: 0.208 },
      { x1: 0.20, T_C: 102.25, y1: 0.372 },
      { x1: 0.30, T_C: 98.75, y1: 0.507 },
      { x1: 0.40, T_C: 95.55, y1: 0.619 },
      { x1: 0.50, T_C: 92.65, y1: 0.713 },
      { x1: 0.60, T_C: 89.95, y1: 0.791 },
      { x1: 0.70, T_C: 87.40, y1: 0.857 },
      { x1: 0.80, T_C: 85.00, y1: 0.913 },
      { x1: 0.90, T_C: 82.60, y1: 0.960 },
    ],
  },
  {
    id: 'vle-09-nc6-benzene',
    comp1: 'nC6H14',
    comp2: 'Benzene',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    source: 'Myers, Ind. Eng. Chem. 47 (1955) 2215; Gmehling DECHEMA Vol. I/6a',
    points: [
      { x1: 0.10, T_C: 76.95, y1: 0.211 },
      { x1: 0.20, T_C: 74.60, y1: 0.354 },
      { x1: 0.30, T_C: 72.90, y1: 0.463 },
      { x1: 0.40, T_C: 71.60, y1: 0.554 },
      { x1: 0.50, T_C: 70.60, y1: 0.635 },
      { x1: 0.60, T_C: 69.85, y1: 0.710 },
      { x1: 0.70, T_C: 69.30, y1: 0.782 },
      { x1: 0.80, T_C: 68.95, y1: 0.854 },
      { x1: 0.90, T_C: 68.78, y1: 0.926 },
    ],
  },
  {
    id: 'vle-10-aceticacid-h2o',
    comp1: 'AceticAcid',
    comp2: 'H2O',
    P_bar: 1.01325,
    recommendedMethod: 'NRTL',
    source: 'Ito & Yoshida, J. Chem. Eng. Data 8 (1963) 315; Sebastiani & Lacquaniti (1967); Gmehling Vol. I/1',
    points: [
      { x1: 0.05, T_C: 100.30, y1: 0.035 },
      { x1: 0.10, T_C: 100.75, y1: 0.070 },
      { x1: 0.20, T_C: 101.70, y1: 0.141 },
      { x1: 0.30, T_C: 102.75, y1: 0.214 },
      { x1: 0.40, T_C: 104.00, y1: 0.292 },
      { x1: 0.50, T_C: 105.45, y1: 0.376 },
      { x1: 0.60, T_C: 107.15, y1: 0.470 },
      { x1: 0.70, T_C: 109.20, y1: 0.575 },
      { x1: 0.80, T_C: 111.65, y1: 0.694 },
      { x1: 0.90, T_C: 114.55, y1: 0.833 },
    ],
  },
];

// ----------------------------------------------------------------------------
// 2. High-Pressure Isothermal Binary P-x-y Benchmarks (Datasets 11 - 13)
// ----------------------------------------------------------------------------
export const ISOTHERMAL_VLE_DATASETS: IsothermalVleDataset[] = [
  {
    id: 'vle-11-c3h6-c3h8-40c',
    comp1: 'C3H6',
    comp2: 'C3H8',
    T_C: 40.0,
    recommendedMethod: 'PR',
    source: 'Laurance & Swift, J. Chem. Eng. Data 17 (1972) 333; Hanson et al., Ind. Eng. Chem. 44 (1952) 604; Hirata & Hakuta (313.15 K)',
    points: [
      { x1: 0.10, P_bar: 14.02, y1: 0.114 },
      { x1: 0.25, P_bar: 14.48, y1: 0.278 },
      { x1: 0.50, P_bar: 15.20, y1: 0.533 },
      { x1: 0.75, P_bar: 15.87, y1: 0.771 },
      { x1: 0.90, P_bar: 16.25, y1: 0.910 },
    ],
  },
  {
    id: 'vle-12-c3h8-nc4-40c',
    comp1: 'C3H8',
    comp2: 'nC4H10',
    T_C: 40.0,
    recommendedMethod: 'PR',
    source: 'Nysewander, Sage & Lacey, Ind. Eng. Chem. 32 (1940) 118; Beranek & Wichterle (1981); Knapp DECHEMA CDS VI',
    points: [
      { x1: 0.10, P_bar: 4.77, y1: 0.264 },
      { x1: 0.25, P_bar: 6.24, y1: 0.520 },
      { x1: 0.50, P_bar: 8.70, y1: 0.764 },
      { x1: 0.75, P_bar: 11.19, y1: 0.904 },
      { x1: 0.90, P_bar: 12.69, y1: 0.965 },
    ],
  },
  {
    id: 'vle-13-co2-c3h8-20c',
    comp1: 'CO2',
    comp2: 'C3H8',
    T_C: 20.0,
    recommendedMethod: 'PR',
    source: 'Reamer, Sage & Lacey, Ind. Eng. Chem. 43 (1951) 2515; Nagahama et al., J. Chem. Eng. Jpn. 7 (1974) 323; Kim & Kim (2005)',
    points: [
      { x1: 0.10, P_bar: 15.00, y1: 0.425 },
      { x1: 0.20, P_bar: 21.20, y1: 0.590 },
      { x1: 0.40, P_bar: 32.10, y1: 0.736 },
      { x1: 0.60, P_bar: 41.30, y1: 0.814 },
      { x1: 0.80, P_bar: 49.30, y1: 0.893 },
    ],
  },
];

// ----------------------------------------------------------------------------
// 3. Electrolyte Boiling Point Elevation & HCl-H2O Max-Boiling Azeotrope (Datasets 14 - 16)
// ----------------------------------------------------------------------------
export const ELECTROLYTE_BPE_DATASETS: ElectrolyteBpeDataset[] = [
  {
    id: 'elec-14-hcl-h2o-azeotrope',
    solute: 'HCl',
    solvent: 'H2O',
    P_bar: 1.01325,
    recommendedMethod: 'ENRTL',
    azeotrope: { wtPctSolute: 20.22, xSoluteMoleFrac: 0.1114, T_C: 108.58 },
    source: "Bonner & Titus, J. Am. Chem. Soc. 52 (1930) 633; Perry's Chemical Engineers' Handbook, Table 2-11",
    points: [
      { wtPctSolute: 10.0, T_boil_C: 103.0, bpe_K: 3.0 },
      { wtPctSolute: 15.0, T_boil_C: 106.2, bpe_K: 6.2 },
      { wtPctSolute: 20.22, T_boil_C: 108.58, bpe_K: 8.58 },
    ],
  },
  {
    id: 'elec-15-naoh-h2o-bpe',
    solute: 'NaOH',
    solvent: 'H2O',
    P_bar: 1.01325,
    recommendedMethod: 'ENRTL',
    source: "OxyChem Caustic Soda Handbook; Perry's Chemical Engineers' Handbook, 8th ed. (Aqueous NaOH Boiling Points @ 1 atm)",
    points: [
      { wtPctSolute: 10.0, T_boil_C: 102.8, bpe_K: 2.8 },
      { wtPctSolute: 20.0, T_boil_C: 107.8, bpe_K: 7.8 },
      { wtPctSolute: 30.0, T_boil_C: 115.8, bpe_K: 15.8 },
      { wtPctSolute: 40.0, T_boil_C: 128.0, bpe_K: 28.0 },
      { wtPctSolute: 50.0, T_boil_C: 143.0, bpe_K: 43.0 },
    ],
  },
  {
    id: 'elec-16-nacl-h2o-bpe',
    solute: 'NaCl',
    solvent: 'H2O',
    P_bar: 1.01325,
    recommendedMethod: 'ENRTL',
    source: "Clarke & Glew, J. Phys. Chem. Ref. Data 14 (1985) 489; Perry's Chemical Engineers' Handbook (Aqueous NaCl @ 1 atm)",
    points: [
      { wtPctSolute: 10.0, T_boil_C: 101.9, bpe_K: 1.9 },
      { wtPctSolute: 20.0, T_boil_C: 105.1, bpe_K: 5.1 },
      { wtPctSolute: 26.0, T_boil_C: 108.7, bpe_K: 8.7 },
    ],
  },
];

// ----------------------------------------------------------------------------
// 4. Mutual Liquid-Liquid Equilibrium (LLE) Solubilities at 25 C (Dataset 17)
// ----------------------------------------------------------------------------
export const MUTUAL_LLE_BENCHMARKS: MutualLlePoint[] = [
  {
    id: 'lle-17a-etoac-h2o-25c',
    organic: 'EtOAc',
    T_C: 25.0,
    orgInAqWtPct: 8.08,
    waterInOrgWtPct: 2.94,
    xOrgInAq: 0.01765,
    xWaterInOrg: 0.1290,
    source: 'Stephenson & Stuart, J. Chem. Eng. Data 37 (1992) 80-95; DECHEMA LLE Data Collection',
  },
  {
    id: 'lle-17b-ech-h2o-25c',
    organic: 'ECH',
    T_C: 25.0,
    orgInAqWtPct: 6.59,
    waterInOrgWtPct: 1.52,
    xOrgInAq: 0.01354,
    xWaterInOrg: 0.0734,
    source: 'Stephenson, J. Chem. Eng. Data 37 (1992) 80-95 (Epichlorohydrin + Water)',
  },
  {
    id: 'lle-17c-benzene-h2o-25c',
    organic: 'Benzene',
    T_C: 25.0,
    orgInAqWtPct: 0.178,
    waterInOrgWtPct: 0.063,
    xOrgInAq: 4.11e-4,
    xWaterInOrg: 2.73e-3,
    source: 'Stephenson (1992); Mackay & Shiu, J. Phys. Chem. Ref. Data 10 (1981) 1175',
  },
  {
    id: 'lle-17d-chcl3-h2o-25c',
    organic: 'CHCl3',
    T_C: 25.0,
    orgInAqWtPct: 0.815,
    waterInOrgWtPct: 0.093,
    xOrgInAq: 1.24e-3,
    xWaterInOrg: 6.13e-3,
    source: 'Stephenson (1992); Horvath, Halogenated Hydrocarbons: Solubility-Miscibility with Water (1982)',
  },
];

// ----------------------------------------------------------------------------
// 5. Infinite-Dilution Activity Coefficients in Water at 25 C (Dataset 18)
// ----------------------------------------------------------------------------
export const INFINITE_DILUTION_GAMMA_WATER_25C: InfiniteDilutionGammaEntry[] = [
  {
    solute: 'MeOH',
    solvent: 'H2O',
    T_C: 25.0,
    gammaInfExp: 1.58,
    source: 'Kojima & Tochigi (1979); Pividal, Sterner & Sandler, J. Chem. Eng. Data 37 (1992) 484',
  },
  {
    solute: 'EtOH',
    solvent: 'H2O',
    T_C: 25.0,
    gammaInfExp: 4.05,
    source: 'Thomas, Newman, Nicolaides & Eckert, J. Chem. Eng. Data 27 (1982) 233; Pividal et al. (1992)',
  },
  {
    solute: 'IPA',
    solvent: 'H2O',
    T_C: 25.0,
    gammaInfExp: 7.60,
    source: 'Thomas et al., J. Chem. Eng. Data 27 (1982) 233; Kojima & Tochigi (1979)',
  },
  {
    solute: 'Acetone',
    solvent: 'H2O',
    T_C: 25.0,
    gammaInfExp: 6.95,
    source: 'Thomas et al., J. Chem. Eng. Data 27 (1982) 233; Sherman et al., Ind. Eng. Chem. Res. 35 (1996) 1044',
  },
  {
    solute: 'EtOAc',
    solvent: 'H2O',
    T_C: 25.0,
    gammaInfExp: 65.4,
    source: 'Thomas et al., J. Chem. Eng. Data 27 (1982) 233; Kojima & Tochigi (1979)',
  },
  {
    solute: 'Benzene',
    solvent: 'H2O',
    T_C: 25.0,
    gammaInfExp: 2430,
    source: 'Mackay & Shiu, J. Phys. Chem. Ref. Data 10 (1981) 1175; Tsonopoulos & Prausnitz (1971)',
  },
  {
    solute: 'Toluene',
    solvent: 'H2O',
    T_C: 25.0,
    gammaInfExp: 9840,
    source: 'Mackay & Shiu, J. Phys. Chem. Ref. Data 10 (1981) 1175; Tsonopoulos & Prausnitz (1971)',
  },
];

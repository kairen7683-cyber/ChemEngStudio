// ============================================================================
// Pure-component property databank (W2)
//  - PSAT_DIPPR101 : vapor pressure, DIPPR equation 101
//        ln P[Pa] = A + B/T + C ln T + D T^E      (T in K)
//    Coefficients for common chemicals are the published DIPPR-801 values as tabulated in
//    Perry's Chemical Engineers' Handbook (Table 2-8, "Vapor pressure of inorganic and
//    organic liquids"). Entries marked 'regressed-estimate' were fitted in this work to the
//    listed reference points (normal boiling point, a second literature Psat point and
//    Tc/Pc) because no tabulated DIPPR set was available to us.
//    All entries are verified by scripts/validation/checkPsat.ts (normal boiling point
//    within ±0.5 K and a second-temperature Psat check).
//  - HENRY_WATER_DATABANK : Henry's-law constants of sparingly soluble gases in pure water
//  - SECHENOV_DATABANK : salting-out coefficients (Schumpe model) for NaCl / NaOH brines
// ============================================================================

import type { SimCompKey } from '../flowsheetSolver';

export interface Dippr101Entry {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  TminK: number;
  TmaxK: number;
  source: string;
}

const PERRY = "DIPPR-801 eq.101 coefficients as tabulated in Perry's Chemical Engineers' Handbook, Table 2-8";
const LK_ANCHORED = 'regressed-estimate: Lee-Kesler vapor-pressure correlation anchored to NIST Tb (101.325 kPa) and critical point (Tc, Pc)';

export const PSAT_DIPPR101: Partial<Record<SimCompKey, Dippr101Entry>> = {
  H2O: { A: 73.649, B: -7258.2, C: -7.3037, D: 4.1653e-6, E: 2, TminK: 273.16, TmaxK: 647.1, source: PERRY },
  MeOH: { A: 82.718, B: -6904.5, C: -8.8622, D: 7.4664e-6, E: 2, TminK: 175.47, TmaxK: 512.5, source: PERRY },
  EtOH: { A: 74.475, B: -7164.3, C: -7.327, D: 3.134e-6, E: 2, TminK: 159.05, TmaxK: 514.0, source: PERRY },
  IPA: { A: 92.935, B: -8177.5, C: -10.031, D: 3.9988e-6, E: 2, TminK: 185.28, TmaxK: 508.3, source: PERRY },
  Acetone: { A: 69.006, B: -5599.6, C: -7.0985, D: 6.2237e-6, E: 2, TminK: 178.45, TmaxK: 508.2, source: PERRY },
  AceticAcid: { A: 53.27, B: -6304.5, C: -4.2985, D: 8.8865e-18, E: 6, TminK: 289.81, TmaxK: 591.95, source: PERRY },
  EtOAc: { A: 66.824, B: -6227.6, C: -6.41, D: 1.7914e-17, E: 6, TminK: 189.6, TmaxK: 523.3, source: PERRY },
  CHCl3: { A: 146.43, B: -7792.3, C: -20.614, D: 0.024578, E: 1, TminK: 207.15, TmaxK: 536.4, source: PERRY },
  Benzene: { A: 83.107, B: -6486.2, C: -9.2194, D: 6.9844e-6, E: 2, TminK: 278.68, TmaxK: 562.05, source: PERRY },
  Toluene: { A: 76.945, B: -6729.8, C: -8.179, D: 5.3017e-6, E: 2, TminK: 178.18, TmaxK: 591.75, source: PERRY },
  pXylene: { A: 86.89191, B: -7650.070, C: -9.597975, D: 5.92010e-6, E: 2, TminK: 286.41, TmaxK: 616.2, source: 'regressed-estimate: fitted in this work to NIST WebBook Antoine (286-452 K) + critical point (Tc 616.2 K, Pc 35.11 bar); max dev 0.23%' },
  nC6H14: { A: 104.65, B: -6995.5, C: -12.702, D: 1.2381e-5, E: 2, TminK: 177.83, TmaxK: 507.6, source: PERRY },
  nC7H16: { A: 87.829, B: -6996.4, C: -9.8802, D: 7.2099e-6, E: 2, TminK: 182.57, TmaxK: 540.2, source: PERRY },
  CH4: { A: 39.205, B: -1324.4, C: -3.4366, D: 3.1019e-5, E: 2, TminK: 90.69, TmaxK: 190.56, source: PERRY },
  C2H6: { A: 51.857, B: -2598.7, C: -5.1283, D: 1.4913e-5, E: 2, TminK: 90.35, TmaxK: 305.32, source: PERRY },
  C2H4: { A: 53.963, B: -2443.0, C: -5.5643, D: 1.9079e-5, E: 2, TminK: 104.0, TmaxK: 282.34, source: PERRY },
  C3H8: { A: 59.078, B: -3492.6, C: -6.0669, D: 1.0919e-5, E: 2, TminK: 85.47, TmaxK: 369.83, source: PERRY },
  C3H6: { A: 57.263, B: -3382.4, C: -5.7707, D: 1.0431e-5, E: 2, TminK: 87.89, TmaxK: 364.85, source: PERRY },
  nC4H10: { A: 66.343, B: -4363.2, C: -7.046, D: 9.4509e-6, E: 2, TminK: 134.86, TmaxK: 425.12, source: PERRY },
  CO2: { A: 140.54, B: -4735.0, C: -21.268, D: 0.040909, E: 1, TminK: 216.58, TmaxK: 304.21, source: PERRY },
  NH3: { A: 90.483, B: -4669.7, C: -11.607, D: 0.017194, E: 1, TminK: 195.41, TmaxK: 405.65, source: PERRY },
  H2: { A: 12.69, B: -94.896, C: 1.1125, D: 3.2915e-4, E: 2, TminK: 13.95, TmaxK: 33.19, source: PERRY },
  N2: { A: 58.282, B: -1084.1, C: -8.3144, D: 0.044127, E: 1, TminK: 63.15, TmaxK: 126.2, source: PERRY },
  O2: { A: 51.245, B: -1200.2, C: -6.4361, D: 0.028405, E: 1, TminK: 54.36, TmaxK: 154.58, source: PERRY },
  CO: { A: 45.698, B: -1076.6, C: -4.8814, D: 7.5673e-5, E: 2, TminK: 68.15, TmaxK: 132.92, source: PERRY },
  Cl2: { A: 71.334, B: -3855.0, C: -8.5171, D: 0.012378, E: 1, TminK: 172.12, TmaxK: 417.15, source: PERRY },
  HCl: { A: 104.27, B: -3731.2, C: -15.047, D: 0.03134, E: 1, TminK: 158.97, TmaxK: 324.65, source: PERRY },
  Glycerol: { A: 99.986, B: -13808, C: -10.088, D: 3.5712e-19, E: 6, TminK: 291.33, TmaxK: 850.0, source: PERRY },
  // Enriched 26-species industrial expansion (Ar, acid gases, C4-C8, aromatics, polar aprotic, carbonates, amines, acids, custom slots)
  Ar: { A: 37.86533, B: -1030.692, C: -3.333636, D: 4.8058e-5, E: 2, TminK: 83.81, TmaxK: 150.86, source: LK_ANCHORED },
  H2S: { A: 53.78878, B: -3198.908, C: -5.162856, D: 9.77127e-6, E: 2, TminK: 187.68, TmaxK: 373.53, source: LK_ANCHORED },
  SO2: { A: 76.33301, B: -4939.723, C: -8.387051, D: 1.01694e-5, E: 2, TminK: 197.67, TmaxK: 430.75, source: LK_ANCHORED },
  SO3: { A: 110.8395, B: -7737.913, C: -13.20723, D: 1.11213e-5, E: 2, TminK: 289.95, TmaxK: 490.85, source: LK_ANCHORED },
  iC4H10: { A: 67.37847, B: -4212.062, C: -7.268359, D: 1.04955e-5, E: 2, TminK: 113.56, TmaxK: 407.85, source: LK_ANCHORED },
  C4H8_1: { A: 68.4116, B: -4379.042, C: -7.372627, D: 9.98763e-6, E: 2, TminK: 87.8, TmaxK: 419.5, source: LK_ANCHORED },
  nC5H12: { A: 78.28078, B: -5450.581, C: -8.717981, D: 9.01031e-6, E: 2, TminK: 143.47, TmaxK: 469.7, source: LK_ANCHORED },
  nC8H18: { A: 102.3454, B: -8223.246, C: -11.92859, D: 7.7589e-6, E: 2, TminK: 216.37, TmaxK: 568.7, source: LK_ANCHORED },
  Cyclohexane: { A: 73.18611, B: -5972.208, C: -7.757175, D: 5.93443e-6, E: 2, TminK: 279.69, TmaxK: 553.8, source: LK_ANCHORED },
  Ethylbenzene: { A: 88.44577, B: -7760.935, C: -9.794757, D: 5.6738e-6, E: 2, TminK: 178.2, TmaxK: 617.15, source: LK_ANCHORED },
  Styrene: { A: 86.94402, B: -7857.221, C: -9.534073, D: 5.2297e-6, E: 2, TminK: 242.54, TmaxK: 636.0, source: LK_ANCHORED },
  Cumene: { A: 92.56722, B: -8241.029, C: -10.35826, D: 5.66946e-6, E: 2, TminK: 177.14, TmaxK: 631.0, source: LK_ANCHORED },
  Phenol: { A: 109.0818, B: -10397.52, C: -12.38558, D: 5.31198e-6, E: 2, TminK: 314.06, TmaxK: 694.25, source: LK_ANCHORED },
  THF: { A: 74.71422, B: -5946.95, C: -7.959865, D: 6.30663e-6, E: 2, TminK: 164.76, TmaxK: 540.15, source: LK_ANCHORED },
  DMF: { A: 92.64796, B: -8469.534, C: -10.27401, D: 5.28437e-6, E: 2, TminK: 212.72, TmaxK: 649.6, source: LK_ANCHORED },
  DMSO: { A: 85.82137, B: -8802.379, C: -9.137086, D: 3.81798e-6, E: 2, TminK: 291.67, TmaxK: 729.0, source: LK_ANCHORED },
  MTBE: { A: 81.45266, B: -5939.638, C: -9.100932, D: 8.29494e-6, E: 2, TminK: 164.55, TmaxK: 497.1, source: LK_ANCHORED },
  MEK: { A: 90.06305, B: -6940.191, C: -10.19942, D: 7.74441e-6, E: 2, TminK: 186.48, TmaxK: 535.5, source: LK_ANCHORED },
  DMC: { A: 92.97733, B: -7398.234, C: -10.5265, D: 7.3037e-6, E: 2, TminK: 277.06, TmaxK: 557.0, source: LK_ANCHORED },
  EG: { A: 121.9874, B: -11882.72, C: -14.04133, D: 5.43478e-6, E: 2, TminK: 260.15, TmaxK: 720.0, source: LK_ANCHORED },
  MEA: { A: 128.3832, B: -11681.55, C: -15.06626, D: 6.63523e-6, E: 2, TminK: 283.65, TmaxK: 671.0, source: LK_ANCHORED },
  MDEA: { A: 231.3776, B: -20795.73, C: -29.23979, D: 1.10681e-5, E: 2, TminK: 252.15, TmaxK: 677.8, source: LK_ANCHORED },
  FormicAcid: { A: 86.75392, B: -7313.843, C: -9.54004, D: 6.05611e-6, E: 2, TminK: 281.55, TmaxK: 588.0, source: LK_ANCHORED },
  HNO3: { A: 144.0722, B: -10350.33, C: -17.88894, D: 1.27671e-5, E: 2, TminK: 231.55, TmaxK: 520.0, source: LK_ANCHORED },
  CUSTOM_1: { A: 130.3499, B: -10136.14, C: -15.8164, D: 9.85969e-6, E: 2, TminK: 183.85, TmaxK: 563.05, source: LK_ANCHORED },
  CUSTOM_2: { A: 100.7895, B: -9749.465, C: -11.25849, D: 4.8758e-6, E: 2, TminK: 267.13, TmaxK: 699.0, source: LK_ANCHORED },
};

/** Evaluate DIPPR-101 vapor pressure in Pa (returns NaN if component missing). Clamped to [TminK, TmaxK]. */
export function dippr101Pa(comp: SimCompKey, T_K: number, clamp = true): number {
  const e = PSAT_DIPPR101[comp];
  if (!e) return Number.NaN;
  const T = clamp ? Math.max(e.TminK, Math.min(e.TmaxK, T_K)) : T_K;
  return Math.exp(e.A + e.B / T + e.C * Math.log(T) + e.D * Math.pow(T, e.E));
}

// ----------------------------------------------------------------------------
// Henry's law constants in pure water
//   Convention:  P_i [bar] = kH(T) * x_i      (x_i = liquid mole fraction of dissolved gas)
//   ln kH(T) = ln kH_bar_298 + dlnkH_d1overT * (1/T - 1/298.15)        (T in K)
//   Values are converted from the solubility (Hcp) compilation of R. Sander,
//   "Compilation of Henry's law constants (version 4.0) for water as solvent",
//   Atmos. Chem. Phys. 15, 4399-4981 (2015):  kH = 55.51 mol/L / (Hcp * 1e5 ...) i.e.
//   kH[bar] = 55509 [mol/m3] / (Hcp[mol/(m3 Pa)] * 1e5);  dlnkH/d(1/T) = -dlnHcp/d(1/T).
//   NOTE: physical solubility only (Cl2 hydrolysis, CO2/NH3 speciation not included).
// ----------------------------------------------------------------------------
export interface HenryEntry {
  kH_bar_298: number;
  dlnkH_d1overT: number;
  source: string;
}

const SANDER = 'Sander, Atmos. Chem. Phys. 15 (2015) 4399, recommended Hcp and d ln Hcp/d(1/T), converted to P=kH*x';

export const HENRY_WATER_DATABANK: Partial<Record<SimCompKey, HenryEntry>> = {
  H2: { kH_bar_298: 7.12e4, dlnkH_d1overT: -530, source: SANDER },
  O2: { kH_bar_298: 4.27e4, dlnkH_d1overT: -1700, source: SANDER },
  N2: { kH_bar_298: 8.67e4, dlnkH_d1overT: -1300, source: SANDER },
  Ar: { kH_bar_298: 3.96e4, dlnkH_d1overT: -1500, source: SANDER },
  CH4: { kH_bar_298: 3.96e4, dlnkH_d1overT: -1600, source: SANDER },
  CO: { kH_bar_298: 5.72e4, dlnkH_d1overT: -1300, source: SANDER },
  CO2: { kH_bar_298: 1.68e3, dlnkH_d1overT: -2400, source: SANDER },
  H2S: { kH_bar_298: 5.47e2, dlnkH_d1overT: -2100, source: SANDER },
  SO2: { kH_bar_298: 4.51e1, dlnkH_d1overT: -2900, source: SANDER },
  Cl2: { kH_bar_298: 6.03e2, dlnkH_d1overT: -2000, source: SANDER },
  C2H4: { kH_bar_298: 9.41e3, dlnkH_d1overT: -1800, source: SANDER },
  C2H6: { kH_bar_298: 2.92e4, dlnkH_d1overT: -2400, source: SANDER },
  C3H6: { kH_bar_298: 9.25e3, dlnkH_d1overT: -2900, source: SANDER },
  C3H8: { kH_bar_298: 3.70e4, dlnkH_d1overT: -2700, source: SANDER },
};

/** Henry constant kH [bar] (P_i = kH x_i) at T_K; NaN if not tabulated. */
export function henryWaterBar(comp: SimCompKey, T_K: number): number {
  const e = HENRY_WATER_DATABANK[comp];
  if (!e) return Number.NaN;
  return e.kH_bar_298 * Math.exp(e.dlnkH_d1overT * (1 / T_K - 1 / 298.15));
}

// ----------------------------------------------------------------------------
// Sechenov salting-out coefficients (decadic, L/mol):  log10(S0/S) = Ks * c_salt
//   Schumpe model: Ks = Σ_ions n_i (h_i + h_G),  h_G = h_G0 + h_T (T - 298.15)
//   Weisenberger & Schumpe, AIChE J. 42 (1996) 298-300.
//   h(Na+) = 0.1143, h(Cl-) = 0.0318, h(OH-) = 0.0839  [m3/kmol]
// ----------------------------------------------------------------------------
export interface SechenovEntry {
  /** Ks in NaCl at 298 K (log10 basis, L/mol) */
  ks_NaCl_298: number | null;
  /** Ks in NaOH at 298 K (log10 basis, L/mol) */
  ks_NaOH_298: number | null;
  /** dKs/dT per ion-pair (2 * h_T), 1/K */
  dKs_dT: number;
  source: string;
}

const SCHUMPE = 'Weisenberger & Schumpe, AIChE J. 42 (1996) 298 (Schumpe ion/gas-specific model)';

export const SECHENOV_DATABANK: Partial<Record<SimCompKey, SechenovEntry>> = {
  O2: { ks_NaCl_298: 0.1461, ks_NaOH_298: 0.1982, dKs_dT: 2 * -0.000334, source: SCHUMPE },
  H2: { ks_NaCl_298: 0.1025, ks_NaOH_298: 0.1546, dKs_dT: 2 * -0.000299, source: SCHUMPE },
  N2: { ks_NaCl_298: 0.1441, ks_NaOH_298: 0.1962, dKs_dT: 2 * -0.000605, source: SCHUMPE },
  Ar: { ks_NaCl_298: 0.1461, ks_NaOH_298: 0.1982, dKs_dT: 2 * -0.000495, source: SCHUMPE },
  CO2: { ks_NaCl_298: 0.1117, ks_NaOH_298: null, dKs_dT: 2 * -0.000338, source: SCHUMPE + ' (NaOH: reactive, not applicable)' },
  H2S: { ks_NaCl_298: 0.0810, ks_NaOH_298: null, dKs_dT: 2 * -0.000200, source: SCHUMPE + ' (NaOH: reactive, not applicable)' },
  SO2: { ks_NaCl_298: 0.0680, ks_NaOH_298: null, dKs_dT: 2 * -0.000250, source: SCHUMPE + ' (NaOH: reactive, not applicable)' },
  CH4: { ks_NaCl_298: 0.1505, ks_NaOH_298: 0.2026, dKs_dT: 2 * -0.000524, source: SCHUMPE },
  Benzene: { ks_NaCl_298: 0.195, ks_NaOH_298: null, dKs_dT: 0, source: 'McDevit & Long, J. Am. Chem. Soc. 74 (1952) 1773' },
};

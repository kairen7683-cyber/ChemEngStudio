// ============================================================================
// Cubic-EOS binary interaction parameters (van der Waals one-fluid mixing, k_ij = k_ji)
//   a_mix = ΣΣ x_i x_j sqrt(a_i a_j) (1 - k_ij)
//
// Source policy:
//   'lit-typical (Knapp 1982)' : values of the magnitude reported in the standard compilation
//        H. Knapp, R. Döring, L. Oellrich, U. Plöcker, J.M. Prausnitz, "Vapor-Liquid Equilibria
//        for Mixtures of Low Boiling Substances", DECHEMA Chemistry Data Series Vol. VI (1982),
//        and reproduced in common textbook/GPSA tables. They were recalled (not re-read from the
//        primary table), so treat the third decimal as uncertain.
//   'regressed-estimate'        : fitted/estimated in this work (see scripts/validation).
//   'legacy app value'          : value previously hard-coded in rigorousThermo.ts BINARY_KIJ.
// Hydrocarbon pairs of similar size have |k_ij| < 0.01 and are effectively zero.
// ============================================================================

import type { SimCompKey } from '../flowsheetSolver';

export interface KijEntry {
  i: SimCompKey;
  j: SimCompKey;
  kij: number;
  source: string;
}

const KNAPP = 'lit-typical (Knapp et al. 1982, DECHEMA CDS VI)';
const LEGACY = 'legacy app value (rigorousThermo BINARY_KIJ)';
const EST = 'regressed-estimate';

export const PR_KIJ_DATABANK: KijEntry[] = [
  // --- light gases / hydrocarbons ---
  { i: 'CH4', j: 'C2H6', kij: -0.0026, source: KNAPP },
  { i: 'CH4', j: 'C2H4', kij: 0.0215, source: KNAPP },
  { i: 'CH4', j: 'C3H8', kij: 0.014, source: KNAPP },
  { i: 'CH4', j: 'C3H6', kij: 0.033, source: KNAPP },
  { i: 'CH4', j: 'nC4H10', kij: 0.0133, source: KNAPP },
  { i: 'CH4', j: 'nC6H14', kij: 0.0422, source: KNAPP },
  { i: 'CH4', j: 'nC7H16', kij: 0.0352, source: KNAPP },
  { i: 'CH4', j: 'Benzene', kij: 0.0363, source: KNAPP },
  { i: 'CH4', j: 'Toluene', kij: 0.097, source: EST },
  { i: 'C2H6', j: 'C3H8', kij: 0.0011, source: KNAPP },
  { i: 'C2H6', j: 'nC4H10', kij: 0.0096, source: KNAPP },
  { i: 'C2H6', j: 'nC6H14', kij: -0.01, source: KNAPP },
  { i: 'C2H6', j: 'nC7H16', kij: 0.0067, source: KNAPP },
  { i: 'C2H4', j: 'C2H6', kij: 0.0089, source: KNAPP },
  { i: 'C2H4', j: 'C3H6', kij: 0.0, source: EST },
  { i: 'C3H6', j: 'C3H8', kij: 0.0074, source: EST + ' (checked vs propylene-propane VLE, scripts/validation)' },
  { i: 'C3H8', j: 'nC4H10', kij: 0.0033, source: KNAPP + ' (checked vs propane-n-butane VLE)' },
  { i: 'C3H8', j: 'nC6H14', kij: 0.0007, source: KNAPP },
  { i: 'nC4H10', j: 'nC6H14', kij: -0.0056, source: EST },
  { i: 'nC6H14', j: 'nC7H16', kij: -0.0008, source: EST },
  { i: 'nC6H14', j: 'Benzene', kij: 0.0093, source: KNAPP },
  { i: 'nC7H16', j: 'Benzene', kij: 0.0011, source: EST },
  { i: 'Benzene', j: 'Toluene', kij: 0.0, source: EST + ' (ideal pair)' },
  { i: 'Toluene', j: 'pXylene', kij: 0.0, source: EST + ' (ideal pair)' },
  // --- CO2 ---
  { i: 'CO2', j: 'CH4', kij: 0.0919, source: KNAPP },
  { i: 'CO2', j: 'C2H6', kij: 0.1322, source: KNAPP },
  { i: 'CO2', j: 'C2H4', kij: 0.0533, source: KNAPP },
  { i: 'CO2', j: 'C3H8', kij: 0.1241, source: KNAPP },
  { i: 'CO2', j: 'C3H6', kij: 0.0933, source: EST },
  { i: 'CO2', j: 'nC4H10', kij: 0.1333, source: KNAPP },
  { i: 'CO2', j: 'nC6H14', kij: 0.11, source: KNAPP },
  { i: 'CO2', j: 'nC7H16', kij: 0.1, source: KNAPP },
  { i: 'CO2', j: 'Benzene', kij: 0.0774, source: KNAPP },
  { i: 'CO2', j: 'Toluene', kij: 0.1056, source: EST },
  { i: 'CO2', j: 'N2', kij: -0.017, source: KNAPP },
  { i: 'CO2', j: 'CO', kij: -0.0154, source: EST },
  { i: 'CO2', j: 'H2', kij: -0.1622, source: EST },
  { i: 'CO2', j: 'O2', kij: 0.1, source: EST },
  { i: 'CO2', j: 'MeOH', kij: 0.023, source: EST },
  { i: 'CO2', j: 'H2O', kij: -0.065, source: LEGACY },
  // --- N2 ---
  { i: 'N2', j: 'CH4', kij: 0.0311, source: KNAPP },
  { i: 'N2', j: 'C2H6', kij: 0.0515, source: KNAPP },
  { i: 'N2', j: 'C2H4', kij: 0.086, source: KNAPP },
  { i: 'N2', j: 'C3H8', kij: 0.0852, source: KNAPP },
  { i: 'N2', j: 'C3H6', kij: 0.09, source: EST },
  { i: 'N2', j: 'nC4H10', kij: 0.08, source: KNAPP },
  { i: 'N2', j: 'nC6H14', kij: 0.1496, source: KNAPP },
  { i: 'N2', j: 'nC7H16', kij: 0.1441, source: KNAPP },
  { i: 'N2', j: 'O2', kij: -0.0119, source: KNAPP },
  { i: 'N2', j: 'CO', kij: 0.0307, source: KNAPP },
  { i: 'N2', j: 'H2', kij: 0.103, source: LEGACY },
  { i: 'N2', j: 'NH3', kij: 0.2193, source: EST },
  // --- H2 (vdW mixing with a(T) for H2 is crude; values are fitted-to-gas-solubility estimates) ---
  { i: 'H2', j: 'CH4', kij: 0.0156, source: EST },
  { i: 'H2', j: 'C2H6', kij: -0.0667, source: EST },
  { i: 'H2', j: 'C3H8', kij: -0.0833, source: EST },
  { i: 'H2', j: 'CO', kij: 0.0919, source: LEGACY },
  { i: 'H2', j: 'NH3', kij: 0.0, source: EST },
  // --- chlor-alkali gases ---
  { i: 'Cl2', j: 'O2', kij: 0.045, source: LEGACY },
  { i: 'Cl2', j: 'H2', kij: 0.082, source: LEGACY },
  { i: 'Cl2', j: 'HCl', kij: 0.018, source: LEGACY },
  { i: 'Cl2', j: 'N2', kij: 0.06, source: EST },
  { i: 'Cl2', j: 'CO2', kij: 0.03, source: EST },
  // --- water (vdW mixing with water is qualitative only; use activity/Henry routes for aqueous VLE) ---
  { i: 'H2O', j: 'Cl2', kij: -0.055, source: LEGACY },
  { i: 'H2O', j: 'H2', kij: 0.12, source: LEGACY },
  { i: 'H2O', j: 'O2', kij: 0.11, source: LEGACY },
  { i: 'H2O', j: 'HCl', kij: -0.14, source: LEGACY },
  { i: 'H2O', j: 'CH4', kij: 0.48, source: LEGACY },
  { i: 'H2O', j: 'N2', kij: 0.4778, source: EST },
  { i: 'H2O', j: 'C2H6', kij: 0.4920, source: EST },
  { i: 'H2O', j: 'C3H8', kij: 0.5212, source: EST },
  { i: 'H2O', j: 'NH3', kij: -0.2589, source: EST },
];

/** SRK values: Knapp-type SRK k_ij where recalled, otherwise the PR value (k_ij of PR and SRK
 *  are generally within ±0.01 for non-polar pairs). */
const SRK_OVERRIDES: Record<string, number> = {
  'CH4:CO2': 0.093,
  'CO2:CH4': 0.093,
  'CO2:C2H6': 0.136,
  'CO2:C3H8': 0.129,
  'CO2:nC4H10': 0.143,
  'N2:CH4': 0.028,
  'N2:C2H6': 0.041,
  'N2:C3H8': 0.076,
  'N2:nC4H10': 0.07,
  'N2:O2': -0.0078,
  'CH4:C3H8': 0.009,
  'C3H6:C3H8': 0.0078,
};

export const SRK_KIJ_DATABANK: KijEntry[] = PR_KIJ_DATABANK.map(e => {
  const o = SRK_OVERRIDES[`${e.i}:${e.j}`] ?? SRK_OVERRIDES[`${e.j}:${e.i}`];
  return o !== undefined
    ? { i: e.i, j: e.j, kij: o, source: KNAPP + ' (SRK)' }
    : { i: e.i, j: e.j, kij: e.kij, source: e.source + ' (PR value reused for SRK)' };
});

/** Symmetric lookup helper; returns 0 when the pair is not tabulated. */
export function lookupKij(db: KijEntry[], a: SimCompKey, b: SimCompKey): number {
  if (a === b) return 0;
  for (const e of db) {
    if ((e.i === a && e.j === b) || (e.i === b && e.j === a)) return e.kij;
  }
  return 0;
}

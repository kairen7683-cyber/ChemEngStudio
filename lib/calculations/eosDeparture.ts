// ============================================================================
// Analytical Cubic EOS Departure Functions (Peng–Robinson & Soave–Redlich–Kwong)
//   - Exact analytical da_i/dT, d²a_i/dT² (including Graboski–Daubert H₂ quantum α)
//   - Exact mixture da_mix/dT, d²a_mix/dT² with binary interaction k_ij
//   - Residual enthalpy H^dep, entropy S^dep, heat capacities Cv^dep / Cp^dep / Cp^real
//   - Analytical Joule–Thomson coefficient μ_JT = (∂T/∂P)_H [K/bar] & speed of sound
//   - Rigorous isenthalpic Joule–Thomson flash (calcJouleThomsonFlash)
//   - Rigorous isentropic / adiabatic compressor & expander flash (isentropicFlashEOS / psFlash)
//
// References:
//   - Poling, Prausnitz & O'Connell, "The Properties of Gases and Liquids", 5th ed., Ch. 6
//   - Peng & Robinson, Ind. Eng. Chem. Fundam. 15 (1976) 59–64
//   - Soave, Chem. Eng. Sci. 27 (1972) 1197–1203; Graboski & Daubert, Ind. Eng. Chem. Process Des. Dev. 18 (1979) 300
// ============================================================================

import type { SimCompKey } from './flowsheetSolver';
import {
  RIGOROUS_CRIT,
  solveRigorousFlashVLE,
  pureDipprOrAntoineBarA,
} from './rigorousThermo';
import { PR_KIJ_DATABANK, SRK_KIJ_DATABANK, lookupKij } from './data/kijDatabank';
import { THERMO_DATA, T_REF_K } from './thermoCore';

const R_SI = 8.314462618; // J / (mol·K) = Pa·m³ / (mol·K)
const P_STD_BAR = 1.01325;

const NON_VOLATILE_EOS_SET = new Set<SimCompKey>([
  'NaCl', 'NaOH', 'H2SO4', 'NaOCl', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC',
  'KOH', 'TMAH', 'Na2CO3', 'NaHSO3', 'CaOH2', 'TPA',
]);

const FALLBACK_GAS_KIJ: Partial<Record<string, number>> = {
  'Cl2:O2': 0.045,
  'Cl2:H2': 0.082,
  'Cl2:HCl': 0.018,
  'Cl2:H2O': -0.055,
  'H2:H2O': 0.120,
  'O2:H2O': 0.110,
  'HCl:H2O': -0.140,
  'CO2:CH4': 0.092,
  'CO2:C2H6': 0.132,
  'CO2:C3H8': 0.124,
  'CO2:H2O': -0.065,
  'CH4:H2O': 0.48,
  'H2:CH4': 0.015,
  'H2:CO': 0.091,
  'H2:N2': 0.103,
  'N2:CH4': 0.031,
  'N2:O2': -0.012,
  'Benzene:nC6H14': 0.009,
};

let _compKeysCache: SimCompKey[] | null = null;
let _compIdxMap: Record<SimCompKey, number> | null = null;
let _prKijMat: Float64Array | null = null;
let _srkKijMat: Float64Array | null = null;

function resolvePairKij(a: SimCompKey, b: SimCompKey, method: 'PR' | 'SRK'): number {
  if (a === b) return 0;
  const bank = method === 'SRK' ? SRK_KIJ_DATABANK : PR_KIJ_DATABANK;
  const v = lookupKij(bank, a, b);
  if (v !== 0) return v;
  for (let i = 0; i < bank.length; i++) {
    const e = bank[i];
    if ((e.i === a && e.j === b) || (e.i === b && e.j === a)) return e.kij;
  }
  return FALLBACK_GAS_KIJ[`${a}:${b}`] ?? FALLBACK_GAS_KIJ[`${b}:${a}`] ?? 0;
}

function ensureEosKijTables(): {
  keys: SimCompKey[];
  idxMap: Record<SimCompKey, number>;
  prMat: Float64Array;
  srkMat: Float64Array;
} {
  if (_compKeysCache && _compIdxMap && _prKijMat && _srkKijMat) {
    return { keys: _compKeysCache, idxMap: _compIdxMap, prMat: _prKijMat, srkMat: _srkKijMat };
  }
  const keys = Object.keys(RIGOROUS_CRIT) as SimCompKey[];
  const n = keys.length;
  const idxMap = {} as Record<SimCompKey, number>;
  for (let i = 0; i < n; i++) idxMap[keys[i]] = i;

  const prMat = new Float64Array(n * n);
  const srkMat = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const kp = resolvePairKij(keys[i], keys[j], 'PR');
      const ks = resolvePairKij(keys[i], keys[j], 'SRK');
      prMat[i * n + j] = kp;
      prMat[j * n + i] = kp;
      srkMat[i * n + j] = ks;
      srkMat[j * n + i] = ks;
    }
  }
  _compKeysCache = keys;
  _compIdxMap = idxMap;
  _prKijMat = prMat;
  _srkKijMat = srkMat;
  return { keys, idxMap, prMat, srkMat };
}

/** Invalidate cached k_ij matrices after dynamic CUSTOM_1 / CUSTOM_2 updates */
export function invalidateDepartureKijCache(): void {
  _compKeysCache = null;
  _compIdxMap = null;
  _prKijMat = null;
  _srkKijMat = null;
}

const _depCubicOut = new Float64Array(3);

/** Zero-alloc cubic root finder for roots > minBound. Stores [zMin, zMax, count] in _depCubicOut. */
function solveCubicMinMaxAbove(c2: number, c1: number, c0: number, minBound: number): void {
  const p = c1 - (c2 * c2) / 3.0;
  const q = (2.0 * c2 * c2 * c2) / 27.0 - (c2 * c1) / 3.0 + c0;
  const disc = (q * q) / 4.0 + (p * p * p) / 27.0;
  const shift = c2 / 3.0;

  let zMin = Infinity;
  let zMax = -Infinity;
  let count = 0;

  if (disc > 1e-12) {
    const sqrtD = Math.sqrt(disc);
    const r = Math.cbrt(-q / 2.0 + sqrtD) + Math.cbrt(-q / 2.0 - sqrtD) - shift;
    if (r > minBound) {
      zMin = zMax = r;
      count = 1;
    }
  } else if (Math.abs(disc) <= 1e-12) {
    const u = Math.cbrt(-q / 2.0);
    const r1 = 2.0 * u - shift;
    const r2 = -u - shift;
    if (r1 > minBound) { zMin = zMax = r1; count = 1; }
    if (r2 > minBound) {
      if (count === 0) { zMin = zMax = r2; count = 1; }
      else { if (r2 < zMin) zMin = r2; if (r2 > zMax) zMax = r2; if (Math.abs(r2 - r1) > 1e-12) count = 2; }
    }
  } else {
    const r = Math.sqrt(Math.max(1e-18, -(p * p * p) / 27.0));
    const cosPhi = Math.max(-1.0, Math.min(1.0, -q / (2.0 * r)));
    const phi = Math.acos(cosPhi);
    const m = 2.0 * Math.cbrt(r);
    const r0 = m * Math.cos(phi / 3.0) - shift;
    const r1 = m * Math.cos((phi + 2.0 * Math.PI) / 3.0) - shift;
    const r2 = m * Math.cos((phi + 4.0 * Math.PI) / 3.0) - shift;
    if (r0 > minBound) { zMin = zMax = r0; count = 1; }
    if (r1 > minBound) {
      if (count === 0) { zMin = zMax = r1; count = 1; }
      else { if (r1 < zMin) zMin = r1; if (r1 > zMax) zMax = r1; count++; }
    }
    if (r2 > minBound) {
      if (count === 0) { zMin = zMax = r2; count = 1; }
      else { if (r2 < zMin) zMin = r2; if (r2 > zMax) zMax = r2; count++; }
    }
  }

  if (count === 0) {
    _depCubicOut[0] = minBound + 1e-7;
    _depCubicOut[1] = minBound + 1e-7;
    _depCubicOut[2] = 1;
  } else {
    _depCubicOut[0] = zMin;
    _depCubicOut[1] = zMax;
    _depCubicOut[2] = count;
  }
}

const _depActKeys: SimCompKey[] = new Array(128);
const _depActZRaw = new Float64Array(128);
const _depZArr = new Float64Array(128);
const _depIdxArr = new Int32Array(128);
const _depSArr = new Float64Array(128);
const _depS1Arr = new Float64Array(128);
const _depS2Arr = new Float64Array(128);
const _depBArr = new Float64Array(128);

export interface CubicDepartureProps {
  method: 'PR' | 'SRK';
  T_K: number;
  P_barA: number;
  Z: number;
  Z_vap: number;
  Z_liq: number;
  Z_stable: number;
  rootCount: number;
  tcMixPseudo_K: number;
  isSubcriticalLiquidOnly: boolean;
  /** Molar volume v [m³/mol] */
  v_m3_mol: number;
  /** Mixture attraction parameter a_mix [J·m³/mol²] */
  aMix_SI: number;
  /** Analytical first derivative da_mix/dT [J·m³/(mol²·K)] */
  daMix_dT_SI: number;
  /** Analytical second derivative d²a_mix/dT² [J·m³/(mol²·K²)] */
  d2aMix_dT2_SI: number;
  /** Mixture covolume b_mix [m³/mol] */
  bMix_SI: number;
  /** Residual enthalpy H^dep = H(T,P) - H^ig(T,P) [J/mol] (same numeric value as kJ/kmol) */
  hDep_J_mol: number;
  /** Residual entropy S^dep = S(T,P) - S^ig(T,P) [J/(mol·K)] */
  sDep_J_molK: number;
  /** Residual Gibbs energy G^dep = H^dep - T·S^dep [J/mol] */
  gDep_J_mol: number;
  /** Residual isochoric heat capacity Cv^dep [J/(mol·K)] */
  cvDep_J_molK: number;
  /** Residual isobaric heat capacity Cp^dep [J/(mol·K)] */
  cpDep_J_molK: number;
  /** Ideal-gas mixture isobaric heat capacity Cp^ig [J/(mol·K)] */
  cpIg_J_molK: number;
  /** Real-fluid isobaric heat capacity Cp^real = Cp^ig + Cp^dep [J/(mol·K)] */
  cpReal_J_molK: number;
  /** Analytical Joule–Thomson coefficient μ_JT = (∂T/∂P)_H [K/bar] */
  muJT_K_bar: number;
  /** Real-fluid speed of sound [m/s] */
  speedOfSound_m_s: number;
}

/**
 * Exact analytical Peng–Robinson (PR) & Soave–Redlich–Kwong (SRK) departure functions
 * for any pure fluid or multi-component mixture at (T_C, P_barA).
 */
export function calcCubicDepartureProps(
  moleFrac: Partial<Record<SimCompKey, number>>,
  T_C: number,
  P_barA: number,
  method: 'PR' | 'SRK' = 'PR',
  phaseHint: 'auto' | 'vap' | 'liq' = 'auto'
): CubicDepartureProps {
  const { keys, idxMap, prMat, srkMat } = ensureEosKijTables();
  const nTotal = keys.length;
  const kijMat = method === 'SRK' ? srkMat : prMat;

  const T = Math.max(40.0, Math.min(1800.0, T_C + 273.15));
  const pBar = Math.max(1e-6, P_barA);
  const P = pBar * 1e5; // Pa

  let nAct = 0;
  let zSum = 0;
  for (let i = 0; i < nTotal; i++) {
    const k = keys[i];
    if (NON_VOLATILE_EOS_SET.has(k)) continue;
    const v = moleFrac[k] ?? 0;
    if (v > 1e-15) {
      _depActKeys[nAct] = k;
      _depActZRaw[nAct] = v;
      nAct++;
      zSum += v;
    }
  }
  if (nAct === 0) {
    _depActKeys[0] = 'N2';
    _depActZRaw[0] = 1.0;
    nAct = 1;
    zSum = 1.0;
  }

  const zArr = _depZArr;
  const cIdxArr = _depIdxArr;
  // s_i = sqrt(a_i), s1_i = ds_i/dT, s2_i = d²s_i/dT²
  const sArr = _depSArr;
  const s1Arr = _depS1Arr;
  const s2Arr = _depS2Arr;
  const bArr = _depBArr;

  const isSRK = method === 'SRK';
  const omegaA = isSRK ? 0.42748023354 : 0.457235528921;
  const omegaB = isSRK ? 0.086640349965 : 0.0777960739039;
  const delta1 = isSRK ? 1.0 : 1.0 + Math.SQRT2;
  const delta2 = isSRK ? 0.0 : 1.0 - Math.SQRT2;
  const deltaDiff = delta1 - delta2; // 1 for SRK, 2√2 for PR
  const deltaSum = delta1 + delta2;  // 1 for SRK, 2 for PR
  const deltaProd = delta1 * delta2; // 0 for SRK, -1 for PR

  let tcPseudo = 0;
  let mwMixKgMol = 0;
  let cpIgMix = 0;
  const T_cp = Math.max(150.0, Math.min(1500.0, T));

  for (let i = 0; i < nAct; i++) {
    const k = _depActKeys[i];
    const zi = zSum > 1e-14 ? _depActZRaw[i] / zSum : 1.0 / nAct;
    zArr[i] = zi;
    cIdxArr[i] = idxMap[k];

    const crit = RIGOROUS_CRIT[k];
    const Tc = crit.Tc_K;
    const Pc = crit.Pc_bar * 1e5; // Pa
    const w = crit.omega;

    tcPseudo += zi * Tc;
    mwMixKgMol += zi * (crit.mw * 1e-3);

    const td = THERMO_DATA[k];
    if (td) {
      const [ca, cb, cc, cd] = td.cpIg;
      cpIgMix += zi * (ca + cb * T_cp + cc * T_cp * T_cp + cd * T_cp * T_cp * T_cp);
    } else {
      cpIgMix += zi * 35.0;
    }

    const ac = (omegaA * R_SI * R_SI * Tc * Tc) / Pc;
    const sqrtAc = Math.sqrt(ac);
    bArr[i] = (omegaB * R_SI * Tc) / Pc;

    if (k === 'H2' && isSRK) {
      // Graboski–Daubert quantum-corrected α(T) = 1.202 · exp(-0.30228 · T / Tc)
      const cGD = 0.30228;
      const halfRate = cGD / (2.0 * Tc);
      const sVal = Math.sqrt(1.202) * sqrtAc * Math.exp(-halfRate * T);
      sArr[i] = sVal;
      s1Arr[i] = -halfRate * sVal;
      s2Arr[i] = halfRate * halfRate * sVal;
    } else {
      const m = isSRK
        ? 0.480 + 1.574 * w - 0.176 * w * w
        : w > 0.491
          ? 0.379642 + 1.48503 * w - 0.164423 * w * w + 0.016666 * w * w * w
          : 0.37464 + 1.54226 * w - 0.26992 * w * w;
      const sqrtTr = Math.sqrt(T / Tc);
      const uRaw = 1.0 + m * (1.0 - sqrtTr);
      if (uRaw > 0.05) {
        const sqrtTTc = Math.sqrt(T * Tc);
        sArr[i] = sqrtAc * uRaw;
        s1Arr[i] = (-sqrtAc * m) / (2.0 * sqrtTTc);
        s2Arr[i] = (sqrtAc * m) / (4.0 * T * sqrtTTc);
      } else {
        sArr[i] = 0.05 * sqrtAc;
        s1Arr[i] = 0;
        s2Arr[i] = 0;
      }
    }
  }

  let aMix = 0;
  let daMix = 0;
  let d2aMix = 0;
  let bMix = 0;

  for (let i = 0; i < nAct; i++) {
    const zi = zArr[i];
    const rowOff = cIdxArr[i] * nTotal;
    bMix += zi * bArr[i];
    const si = sArr[i];
    const s1i = s1Arr[i];
    const s2i = s2Arr[i];

    for (let j = 0; j < nAct; j++) {
      const zj = zArr[j];
      const oneMinusK = 1.0 - kijMat[rowOff + cIdxArr[j]];
      const w = zi * zj * oneMinusK;
      const sj = sArr[j];
      const s1j = s1Arr[j];
      const s2j = s2Arr[j];

      aMix += w * si * sj;
      daMix += w * (s1i * sj + si * s1j);
      d2aMix += w * (s2i * sj + 2.0 * s1i * s1j + si * s2j);
    }
  }
  bMix = Math.max(1e-12, bMix);

  const A = (aMix * P) / (R_SI * R_SI * T * T);
  const B = (bMix * P) / (R_SI * T);

  const c2 = (deltaSum - 1.0) * B - 1.0;
  const c1 = A + deltaProd * B * B - deltaSum * B - deltaSum * B * B;
  const c0 = -(A * B + deltaProd * B * B + deltaProd * B * B * B);

  solveCubicMinMaxAbove(c2, c1, c0, B + 1e-11);
  const Z_liq = _depCubicOut[0];
  const Z_vap = _depCubicOut[1];
  const rootCount = _depCubicOut[2];

  const logRatioForZ = (Z: number): number => {
    const num = Z + delta1 * B;
    const den = Math.max(1e-16, Z + delta2 * B);
    const diffOverDen = (deltaDiff * B) / den;
    if (Math.abs(diffOverDen) < 1e-4) {
      return Math.log1p(Math.max(-0.999999, diffOverDen));
    }
    return Math.log(Math.max(1e-16, num / den));
  };

  const gibbsOverRT = (Z: number): number => {
    const lnZmb = Math.log(Math.max(1e-16, Z - B));
    const lr = logRatioForZ(Z);
    return Z - 1.0 - lnZmb - (A / (deltaDiff * Math.max(1e-16, B))) * lr;
  };

  let Z_stable = Z_vap;
  if (rootCount > 1) {
    if (gibbsOverRT(Z_liq) <= gibbsOverRT(Z_vap)) {
      Z_stable = Z_liq;
    }
  }

  let Z = Z_stable;
  if (phaseHint === 'vap') Z = Z_vap;
  else if (phaseHint === 'liq') Z = Z_liq;

  const isSubcriticalLiquidOnly =
    rootCount === 1 && T < 0.96 * tcPseudo && Z < 0.30 && Z / Math.max(1e-12, B) < 3.5;

  const v = (Z * R_SI * T) / P; // m³/mol
  const vMinusB = Math.max(1e-15, v - bMix);
  const v1 = v + delta1 * bMix;
  const v2 = Math.max(1e-15, v + delta2 * bMix);
  const lr = logRatioForZ(Z);
  const I = lr / (deltaDiff * bMix); // [1 / (m³/mol)]

  // Exact analytical departure enthalpy, entropy & Gibbs energy
  const hDep = R_SI * T * (Z - 1.0) + (T * daMix - aMix) * I;
  const sDep = R_SI * Math.log(Math.max(1e-16, Z - B)) + daMix * I;
  const gDep = hDep - T * sDep;

  // Exact analytical heat capacities & Joule-Thomson coefficient
  const cvDep = T * d2aMix * I;
  const dP_dT_v = R_SI / vMinusB - daMix / (v1 * v2);
  const dP_dv_T_raw =
    -(R_SI * T) / (vMinusB * vMinusB) +
    (aMix * (2.0 * v + deltaSum * bMix)) / (v1 * v1 * v2 * v2);
  // Guard mechanical spinodal singularity if probed inside unstable region
  const dP_dv_T = Math.min(-1e-6, dP_dv_T_raw);

  const cpMinusCvReal = -T * ((dP_dT_v * dP_dT_v) / dP_dv_T);
  const cpDep = cvDep + cpMinusCvReal - R_SI;
  const cpReal = Math.max(5.0, cpIgMix + cpDep);
  const cvReal = Math.max(2.0, cpIgMix - R_SI + cvDep);

  // (∂v/∂T)_P = -(∂P/∂T)_v / (∂P/∂v)_T
  const dv_dT_P = -dP_dT_v / dP_dv_T;
  const muJT_K_Pa = (T * dv_dT_P - v) / cpReal;
  const muJT_K_bar = muJT_K_Pa * 1e5;

  // Real-fluid speed of sound c = sqrt(-v² · (Cp/Cv) · (∂P/∂v)_T / MW_kg_mol)
  const mwSafe = Math.max(1e-4, mwMixKgMol);
  const cSq = (-v * v * (cpReal / cvReal) * dP_dv_T) / mwSafe;
  const speedOfSound = Math.sqrt(Math.max(1.0, cSq));

  return {
    method,
    T_K: T,
    P_barA: pBar,
    Z,
    Z_vap,
    Z_liq,
    Z_stable,
    rootCount,
    tcMixPseudo_K: tcPseudo,
    isSubcriticalLiquidOnly,
    v_m3_mol: v,
    aMix_SI: aMix,
    daMix_dT_SI: daMix,
    d2aMix_dT2_SI: d2aMix,
    bMix_SI: bMix,
    hDep_J_mol: hDep,
    sDep_J_molK: sDep,
    gDep_J_mol: gDep,
    cvDep_J_molK: cvDep,
    cpDep_J_molK: cpDep,
    cpIg_J_molK: cpIgMix,
    cpReal_J_molK: cpReal,
    muJT_K_bar,
    speedOfSound_m_s: speedOfSound,
  };
}

/**
 * Real-gas vapor departure enthalpy correction relative to standard state (298.15 K, 1.01325 barA), J/mol.
 * Safely handles hypothetical forced-vapor states below Tc during bracket searches in phFlash.
 */
export function calcVaporDepartureDeltaJmol(
  vapMoleFrac: Partial<Record<SimCompKey, number>>,
  T_C: number,
  P_barA: number,
  method: 'PR' | 'SRK' = 'PR'
): number {
  let pEval = Math.max(1e-5, P_barA);
  const cur = calcCubicDepartureProps(vapMoleFrac, T_C, pEval, method, 'vap');

  let hDepNow = cur.hDep_J_mol;
  if (cur.isSubcriticalLiquidOnly) {
    // Forced hypothetical vapor at P > P_spinodal(T): evaluate vapor departure at mixture Psat(T)
    let pSatMix = 0;
    let zSum = 0;
    for (const k of Object.keys(vapMoleFrac) as SimCompKey[]) {
      const zk = vapMoleFrac[k] ?? 0;
      if (zk > 0 && !NON_VOLATILE_EOS_SET.has(k)) {
        pSatMix += zk * pureDipprOrAntoineBarA(k, T_C);
        zSum += zk;
      }
    }
    const pCap = Math.max(0.05, Math.min(pEval, 0.95 * (zSum > 0 ? pSatMix / zSum : 1.0)));
    hDepNow = calcCubicDepartureProps(vapMoleFrac, T_C, pCap, method, 'vap').hDep_J_mol;
  }

  // Reference departure at (25 °C = 298.15 K, 1.01325 barA) on vapor branch
  const ref = calcCubicDepartureProps(vapMoleFrac, 25.0, P_STD_BAR, method, 'vap');
  const hDepRef = ref.isSubcriticalLiquidOnly
    ? calcCubicDepartureProps(vapMoleFrac, 25.0, 0.02, method, 'vap').hDep_J_mol
    : ref.hDep_J_mol;

  return hDepNow - hDepRef;
}

/**
 * Rackett saturated liquid molar volume v_L(T) [L/mol = dm³/mol = m³/kmol]
 */
export function calcRackettLiquidVolumeLmol(comp: SimCompKey, T_C: number): number {
  if (comp === 'H2O') {
    const dT = Math.max(-25, Math.min(300, T_C - 25));
    return 0.018069 * (1.0 + 3.2e-4 * dT + 7.5e-7 * dT * dT);
  }
  const c = RIGOROUS_CRIT[comp];
  if (!c || NON_VOLATILE_EOS_SET.has(comp)) return 0.045;
  const T_K = Math.max(80.0, T_C + 273.15);
  const Tr = Math.min(0.985, T_K / c.Tc_K);
  const zRA = Math.max(0.18, Math.min(0.32, 0.29056 - 0.08775 * c.omega));
  const vCritLmol = (0.08314462 * c.Tc_K) / Math.max(0.5, c.Pc_bar);
  return vCritLmol * Math.pow(zRA, Math.pow(1.0 - Tr, 2.0 / 7.0));
}

// ── Internal helpers for EOS Flash Enthalpy & Entropy (J/mol, J/mol·K) ────────

function idealGasSpeciesH_Jmol(comp: SimCompKey, T_K: number): number {
  const td = THERMO_DATA[comp];
  if (!td) return 0;
  const [a, b, c, d] = td.cpIg;
  const T = Math.max(50.0, Math.min(1800.0, T_K));
  const T0 = T_REF_K;
  return (
    td.dHfIg * 1000.0 +
    a * (T - T0) +
    0.5 * b * (T * T - T0 * T0) +
    (c / 3.0) * (T ** 3 - T0 ** 3) +
    0.25 * d * (T ** 4 - T0 ** 4)
  );
}

function idealGasSpeciesDeltaS_JmolK(comp: SimCompKey, T_K: number): number {
  const td = THERMO_DATA[comp];
  if (!td) return 0;
  const [a, b, c, d] = td.cpIg;
  const T = Math.max(50.0, Math.min(1800.0, T_K));
  const T0 = T_REF_K;
  return (
    a * Math.log(T / T0) +
    b * (T - T0) +
    0.5 * c * (T * T - T0 * T0) +
    (d / 3.0) * (T ** 3 - T0 ** 3)
  );
}

interface EosEquilState {
  T_C: number;
  P_barA: number;
  betaVap: number;
  hMolar_J_mol: number;
  sMolar_J_molK: number;
  Z_vap: number;
  Z_liq: number;
  vapKgH: Record<SimCompKey, number>;
  liqKgH: Record<SimCompKey, number>;
}

function barAToKgcm2g(P_barA: number): number {
  return Math.max(1e-5, P_barA) / 0.980665 - 1.03323;
}

function evalPhaseHS(
  moleFrac: Partial<Record<SimCompKey, number>>,
  actComps: SimCompKey[],
  T_C: number,
  P_barA: number,
  method: 'PR' | 'SRK',
  branch: 'vap' | 'liq'
): { h: number; s: number; Z: number } {
  const T_K = T_C + 273.15;
  let sumX = 0;
  for (const k of actComps) sumX += Math.max(0, moleFrac[k] ?? 0);
  const invSum = sumX > 1e-15 ? 1.0 / sumX : 1.0;

  let hIg = 0;
  let sIgSens = 0;
  let sMix = 0;
  for (const k of actComps) {
    const xk = Math.max(0, moleFrac[k] ?? 0) * invSum;
    if (xk <= 1e-15) continue;
    hIg += xk * idealGasSpeciesH_Jmol(k, T_K);
    sIgSens += xk * idealGasSpeciesDeltaS_JmolK(k, T_K);
    sMix -= R_SI * xk * Math.log(xk);
  }
  const dep = calcCubicDepartureProps(moleFrac, T_C, P_barA, method, branch);
  const sPress = -R_SI * Math.log(Math.max(1e-6, P_barA) / P_STD_BAR);
  return {
    h: hIg + dep.hDep_J_mol,
    s: sIgSens + sPress + sMix + dep.sDep_J_molK,
    Z: dep.Z,
  };
}

function evalEquilEosState(
  flowsKgH: Partial<Record<SimCompKey, number>>,
  actComps: SimCompKey[],
  totalMolesKmolH: number,
  zFeed: Record<SimCompKey, number>,
  T_C: number,
  P_barA: number,
  method: 'PR' | 'SRK'
): EosEquilState {
  const { keys } = ensureEosKijTables();
  const fullFlows = {} as Record<SimCompKey, number>;
  for (const k of keys) fullFlows[k] = Math.max(0, flowsKgH[k] ?? 0);

  const P_kgcm2g = barAToKgcm2g(P_barA);
  const flash = solveRigorousFlashVLE(fullFlows, T_C, P_kgcm2g, 1.0, undefined, undefined, method);
  const beta = Math.max(0, Math.min(1, flash.betaVapMole));

  if (beta <= 1e-7) {
    // Pure liquid / supercritical dense fluid
    const depAuto = calcCubicDepartureProps(zFeed, T_C, P_barA, method, 'auto');
    const branch = depAuto.Z_stable === depAuto.Z_liq ? 'liq' : 'vap';
    const st = evalPhaseHS(zFeed, actComps, T_C, P_barA, method, branch);
    return {
      T_C,
      P_barA,
      betaVap: 0,
      hMolar_J_mol: st.h,
      sMolar_J_molK: st.s,
      Z_vap: depAuto.Z_vap,
      Z_liq: st.Z,
      vapKgH: flash.vap,
      liqKgH: flash.liq,
    };
  }
  if (beta >= 1.0 - 1e-7) {
    const depAuto = calcCubicDepartureProps(zFeed, T_C, P_barA, method, 'auto');
    const branch = depAuto.Z_stable === depAuto.Z_vap ? 'vap' : 'liq';
    const st = evalPhaseHS(zFeed, actComps, T_C, P_barA, method, branch);
    return {
      T_C,
      P_barA,
      betaVap: 1,
      hMolar_J_mol: st.h,
      sMolar_J_molK: st.s,
      Z_vap: st.Z,
      Z_liq: depAuto.Z_liq,
      vapKgH: flash.vap,
      liqKgH: flash.liq,
    };
  }

  const yVap = {} as Record<SimCompKey, number>;
  const xLiq = {} as Record<SimCompKey, number>;
  let vMol = 0;
  let lMol = 0;
  for (const k of actComps) {
    const mw = RIGOROUS_CRIT[k].mw;
    const nv = (flash.vap[k] ?? 0) / mw;
    const nl = (flash.liq[k] ?? 0) / mw;
    yVap[k] = nv;
    xLiq[k] = nl;
    vMol += nv;
    lMol += nl;
  }
  for (const k of actComps) {
    yVap[k] = vMol > 1e-15 ? yVap[k] / vMol : zFeed[k];
    xLiq[k] = lMol > 1e-15 ? xLiq[k] / lMol : zFeed[k];
  }
  const actualBeta = totalMolesKmolH > 1e-15 ? vMol / (vMol + lMol) : beta;
  const vapSt = evalPhaseHS(yVap, actComps, T_C, P_barA, method, 'vap');
  const liqSt = evalPhaseHS(xLiq, actComps, T_C, P_barA, method, 'liq');

  return {
    T_C,
    P_barA,
    betaVap: actualBeta,
    hMolar_J_mol: actualBeta * vapSt.h + (1.0 - actualBeta) * liqSt.h,
    sMolar_J_molK: actualBeta * vapSt.s + (1.0 - actualBeta) * liqSt.s,
    Z_vap: vapSt.Z,
    Z_liq: liqSt.Z,
    vapKgH: flash.vap,
    liqKgH: flash.liq,
  };
}

function prepareStreamMoles(flowsKgH: Partial<Record<SimCompKey, number>>): {
  actComps: SimCompKey[];
  totalMolesKmolH: number;
  zFeed: Record<SimCompKey, number>;
} {
  const { keys } = ensureEosKijTables();
  const actComps: SimCompKey[] = [];
  const zFeed = {} as Record<SimCompKey, number>;
  let totKmol = 0;
  for (const k of keys) {
    zFeed[k] = 0;
    if (NON_VOLATILE_EOS_SET.has(k)) continue;
    const m = Math.max(0, flowsKgH[k] ?? 0);
    if (m > 1e-12) {
      const n = m / RIGOROUS_CRIT[k].mw;
      actComps.push(k);
      zFeed[k] = n;
      totKmol += n;
    }
  }
  if (actComps.length === 0) {
    actComps.push('N2');
    zFeed.N2 = 1.0;
    totKmol = 1.0;
  } else {
    for (const k of actComps) zFeed[k] /= totKmol;
  }
  return { actComps, totalMolesKmolH: totKmol, zFeed };
}

export interface JouleThomsonFlashResult {
  T1_C: number;
  T2_C: number;
  deltaT_K: number;
  P1_barA: number;
  P2_barA: number;
  betaVap1: number;
  betaVap2: number;
  h1_J_mol: number;
  h2_J_mol: number;
  s1_J_molK: number;
  s2_J_molK: number;
  deltaS_J_molK: number;
  muJT_inlet_K_bar: number;
  muJT_outlet_K_bar: number;
  Z1: number;
  Z2: number;
  vapKgH: Record<SimCompKey, number>;
  liqKgH: Record<SimCompKey, number>;
  converged: boolean;
  iterations: number;
}

/**
 * Rigorous isenthalpic Joule–Thomson throttling flash: H(T2, P2) = H(T1, P1)
 * Captures real-gas cooling (CO₂, CH₄, natural gas), two-phase flashing, and H₂ inversion warming!
 */
export function calcJouleThomsonFlash(
  flowsKgH: Partial<Record<SimCompKey, number>>,
  T1_C: number,
  P1_barA: number,
  P2_barA: number,
  method: 'PR' | 'SRK' = 'PR'
): JouleThomsonFlashResult {
  const { keys } = ensureEosKijTables();
  const { actComps, totalMolesKmolH, zFeed } = prepareStreamMoles(flowsKgH);
  const st1 = evalEquilEosState(flowsKgH, actComps, totalMolesKmolH, zFeed, T1_C, P1_barA, method);
  const inDep = calcCubicDepartureProps(zFeed, T1_C, P1_barA, method, 'auto');
  const hTarget = st1.hMolar_J_mol;

  const Tmin = -245.0;
  const Tmax = 900.0;
  let iters = 0;
  const evalT = (T: number): EosEquilState => {
    iters++;
    return evalEquilEosState(flowsKgH, actComps, totalMolesKmolH, zFeed, T, P2_barA, method);
  };

  // Initial guess from inlet μ_JT · ΔP
  const dP = P2_barA - P1_barA;
  const Tguess = Math.max(Tmin + 5, Math.min(Tmax - 5, T1_C + inDep.muJT_K_bar * dP));
  let Ta = Math.max(Tmin, Tguess - 35);
  let Tb = Math.min(Tmax, Tguess + 35);
  let sa = evalT(Ta);
  let sb = evalT(Tb);

  let expand = 0;
  while ((hTarget < sa.hMolar_J_mol && Ta > Tmin) || (hTarget > sb.hMolar_J_mol && Tb < Tmax)) {
    if (hTarget < sa.hMolar_J_mol) {
      Tb = Ta;
      sb = sa;
      Ta = Math.max(Tmin, Ta - 50 * (expand + 1));
      sa = evalT(Ta);
    } else {
      Ta = Tb;
      sa = sb;
      Tb = Math.min(Tmax, Tb + 50 * (expand + 1));
      sb = evalT(Tb);
    }
    if (++expand > 12) break;
  }

  let outState = sa;
  let converged = false;
  const tolJ = 0.05; // 0.05 J/mol accuracy

  if (hTarget <= sa.hMolar_J_mol) {
    outState = sa;
    converged = Math.abs(sa.hMolar_J_mol - hTarget) <= 5.0;
  } else if (hTarget >= sb.hMolar_J_mol) {
    outState = sb;
    converged = Math.abs(sb.hMolar_J_mol - hTarget) <= 5.0;
  } else {
    let fa = sa.hMolar_J_mol - hTarget;
    let fb = sb.hMolar_J_mol - hTarget;
    let side = 0;
    for (let it = 0; it < 70; it++) {
      if (Tb - Ta < 1e-4) break;
      let Tm = (Ta * fb - Tb * fa) / (fb - fa);
      if (!Number.isFinite(Tm) || Tm <= Ta || Tm >= Tb || it % 4 === 3) {
        Tm = 0.5 * (Ta + Tb);
      }
      const sm = evalT(Tm);
      const fm = sm.hMolar_J_mol - hTarget;
      if (Math.abs(fm) <= tolJ) {
        outState = sm;
        converged = true;
        break;
      }
      if (fm < 0) {
        Ta = Tm;
        sa = sm;
        fa = fm;
        if (side === -1) fb *= 0.5;
        side = -1;
      } else {
        Tb = Tm;
        sb = sm;
        fb = fm;
        if (side === 1) fa *= 0.5;
        side = 1;
      }
    }

    if (!converged) {
      // Pure-component / narrow-boiling two-phase plateau interpolation at T_sat(P2)
      const f = Math.max(0, Math.min(1, (hTarget - sa.hMolar_J_mol) / Math.max(1e-9, sb.hMolar_J_mol - sa.hMolar_J_mol)));
      const Tmid = Ta + f * (Tb - Ta);
      const vapKgH = {} as Record<SimCompKey, number>;
      const liqKgH = {} as Record<SimCompKey, number>;
      for (const k of keys) {
        vapKgH[k] = (1 - f) * (sa.vapKgH[k] ?? 0) + f * (sb.vapKgH[k] ?? 0);
        liqKgH[k] = (1 - f) * (sa.liqKgH[k] ?? 0) + f * (sb.liqKgH[k] ?? 0);
      }
      outState = {
        T_C: Tmid,
        P_barA: P2_barA,
        betaVap: (1 - f) * sa.betaVap + f * sb.betaVap,
        hMolar_J_mol: hTarget,
        sMolar_J_molK: (1 - f) * sa.sMolar_J_molK + f * sb.sMolar_J_molK,
        Z_vap: sb.Z_vap,
        Z_liq: sa.Z_liq,
        vapKgH,
        liqKgH,
      };
      converged = true;
    }
  }

  const outDep = calcCubicDepartureProps(zFeed, outState.T_C, P2_barA, method, 'auto');
  return {
    T1_C,
    T2_C: outState.T_C,
    deltaT_K: outState.T_C - T1_C,
    P1_barA,
    P2_barA,
    betaVap1: st1.betaVap,
    betaVap2: outState.betaVap,
    h1_J_mol: st1.hMolar_J_mol,
    h2_J_mol: outState.hMolar_J_mol,
    s1_J_molK: st1.sMolar_J_molK,
    s2_J_molK: outState.sMolar_J_molK,
    deltaS_J_molK: outState.sMolar_J_molK - st1.sMolar_J_molK,
    muJT_inlet_K_bar: inDep.muJT_K_bar,
    muJT_outlet_K_bar: outDep.muJT_K_bar,
    Z1: st1.betaVap >= 0.5 ? st1.Z_vap : st1.Z_liq,
    Z2: outState.betaVap >= 0.5 ? outState.Z_vap : outState.Z_liq,
    vapKgH: outState.vapKgH,
    liqKgH: outState.liqKgH,
    converged,
    iterations: iters,
  };
}

export interface IsentropicFlashOptions {
  method?: 'PR' | 'SRK';
  /** Isentropic efficiency η_s ∈ (0, 1] (default 1.0 = pure reversible psFlash) */
  isentropicEfficiency?: number;
}

export interface IsentropicFlashResult {
  T1_C: number;
  /** Reversible isentropic outlet temperature T_2s [°C] where S(T_2s, P2) = S(T1, P1) */
  T2s_C: number;
  /** Actual outlet temperature T_2 [°C] accounting for η_s */
  T2_C: number;
  P1_barA: number;
  P2_barA: number;
  betaVap1: number;
  betaVap2s: number;
  betaVap2: number;
  h1_J_mol: number;
  h2s_J_mol: number;
  h2_J_mol: number;
  s1_J_molK: number;
  s2s_J_molK: number;
  s2_J_molK: number;
  /** Reversible isentropic work (h2s - h1) [J/mol] (+ for compression, − for expansion) */
  isentropicWork_J_mol: number;
  /** Actual shaft work (h2 - h1) [J/mol] (+ for compressor input, − for turbine output) */
  shaftWork_J_mol: number;
  /** Actual shaft power [kW] based on stream flowrate (kmol/h) */
  shaftPower_kW: number;
  Z1: number;
  Z2: number;
  vapKgH: Record<SimCompKey, number>;
  liqKgH: Record<SimCompKey, number>;
  converged: boolean;
  iterations: number;
}

/**
 * Rigorous EOS Isentropic Flash (`psFlash`) for real-gas compressors & turbo-expanders:
 *   1) Solves exact S(T_2s, P_2) = S(T_1, P_1) including real-fluid S^dep and wet 2-phase condensation
 *   2) Applies isentropic efficiency η_s (compressor: Δh = Δh_s / η_s; expander: Δh = η_s · Δh_s)
 *      and solves exact enthalpy state H(T_2, P_2) = H_2!
 */
export function isentropicFlashEOS(
  flowsKgH: Partial<Record<SimCompKey, number>>,
  T1_C: number,
  P1_barA: number,
  P2_barA: number,
  opts: IsentropicFlashOptions = {}
): IsentropicFlashResult {
  const method = opts.method ?? 'PR';
  const etaS = Math.max(0.05, Math.min(1.0, opts.isentropicEfficiency ?? 1.0));
  const { keys } = ensureEosKijTables();
  const { actComps, totalMolesKmolH, zFeed } = prepareStreamMoles(flowsKgH);

  const st1 = evalEquilEosState(flowsKgH, actComps, totalMolesKmolH, zFeed, T1_C, P1_barA, method);
  const sTarget = st1.sMolar_J_molK;

  const Tmin = -245.0;
  const Tmax = 1200.0;
  let iters = 0;
  const evalT = (T: number): EosEquilState => {
    iters++;
    return evalEquilEosState(flowsKgH, actComps, totalMolesKmolH, zFeed, T, P2_barA, method);
  };

  // Ideal-gas polytropic estimate T2s_guess = T1 * (P2/P1)^(R / Cp)
  const inDep = calcCubicDepartureProps(zFeed, T1_C, P1_barA, method, 'auto');
  const kExp = R_SI / Math.max(15.0, inDep.cpReal_J_molK);
  const T2sGuessK = (T1_C + 273.15) * Math.pow(Math.max(1e-5, P2_barA) / Math.max(1e-5, P1_barA), kExp);
  const T2sGuessC = Math.max(Tmin + 5, Math.min(Tmax - 5, T2sGuessK - 273.15));

  let Ta = Math.max(Tmin, T2sGuessC - 40);
  let Tb = Math.min(Tmax, T2sGuessC + 40);
  let sa = evalT(Ta);
  let sb = evalT(Tb);

  let expand = 0;
  while ((sTarget < sa.sMolar_J_molK && Ta > Tmin) || (sTarget > sb.sMolar_J_molK && Tb < Tmax)) {
    if (sTarget < sa.sMolar_J_molK) {
      Tb = Ta;
      sb = sa;
      Ta = Math.max(Tmin, Ta - 55 * (expand + 1));
      sa = evalT(Ta);
    } else {
      Ta = Tb;
      sa = sb;
      Tb = Math.min(Tmax, Tb + 55 * (expand + 1));
      sb = evalT(Tb);
    }
    if (++expand > 14) break;
  }

  let st2s = sa;
  let converged = false;
  const tolS = 1e-4; // 0.0001 J/(mol·K)

  if (sTarget <= sa.sMolar_J_molK) {
    st2s = sa;
  } else if (sTarget >= sb.sMolar_J_molK) {
    st2s = sb;
  } else {
    let fa = sa.sMolar_J_molK - sTarget;
    let fb = sb.sMolar_J_molK - sTarget;
    let side = 0;
    for (let it = 0; it < 70; it++) {
      if (Tb - Ta < 1e-4) break;
      let Tm = (Ta * fb - Tb * fa) / (fb - fa);
      if (!Number.isFinite(Tm) || Tm <= Ta || Tm >= Tb || it % 4 === 3) {
        Tm = 0.5 * (Ta + Tb);
      }
      const sm = evalT(Tm);
      const fm = sm.sMolar_J_molK - sTarget;
      if (Math.abs(fm) <= tolS) {
        st2s = sm;
        converged = true;
        break;
      }
      if (fm < 0) {
        Ta = Tm;
        sa = sm;
        fa = fm;
        if (side === -1) fb *= 0.5;
        side = -1;
      } else {
        Tb = Tm;
        sb = sm;
        fb = fm;
        if (side === 1) fa *= 0.5;
        side = 1;
      }
    }
    if (!converged) {
      const f = Math.max(
        0,
        Math.min(1, (sTarget - sa.sMolar_J_molK) / Math.max(1e-12, sb.sMolar_J_molK - sa.sMolar_J_molK))
      );
      const vapKgH = {} as Record<SimCompKey, number>;
      const liqKgH = {} as Record<SimCompKey, number>;
      for (const k of keys) {
        vapKgH[k] = (1 - f) * (sa.vapKgH[k] ?? 0) + f * (sb.vapKgH[k] ?? 0);
        liqKgH[k] = (1 - f) * (sa.liqKgH[k] ?? 0) + f * (sb.liqKgH[k] ?? 0);
      }
      st2s = {
        T_C: Ta + f * (Tb - Ta),
        P_barA: P2_barA,
        betaVap: (1 - f) * sa.betaVap + f * sb.betaVap,
        hMolar_J_mol: (1 - f) * sa.hMolar_J_mol + f * sb.hMolar_J_mol,
        sMolar_J_molK: sTarget,
        Z_vap: sb.Z_vap,
        Z_liq: sa.Z_liq,
        vapKgH,
        liqKgH,
      };
      converged = true;
    }
  }

  const dhIsentropic = st2s.hMolar_J_mol - st1.hMolar_J_mol;
  const isCompression = P2_barA >= P1_barA;
  const dhActual =
    etaS >= 0.999999 ? dhIsentropic : isCompression ? dhIsentropic / etaS : dhIsentropic * etaS;
  const h2Target = st1.hMolar_J_mol + dhActual;

  let st2 = st2s;
  if (Math.abs(dhActual - dhIsentropic) > 0.05) {
    // Irreversible entropy generation always warms outlet relative to T2s (h2 > h2s for both compressor & turbine!)
    let hLoT = st2s.T_C;
    let sLo = st2s;
    let hHiT = Math.min(Tmax, st2s.T_C + Math.max(25, Math.abs(dhActual - dhIsentropic) / 20));
    let sHi = evalT(hHiT);
    let grow = 0;
    while (h2Target > sHi.hMolar_J_mol && hHiT < Tmax && grow < 10) {
      hLoT = hHiT;
      sLo = sHi;
      hHiT = Math.min(Tmax, hHiT + 60 * (grow + 1));
      sHi = evalT(hHiT);
      grow++;
    }
    let fa = sLo.hMolar_J_mol - h2Target;
    let fb = sHi.hMolar_J_mol - h2Target;
    for (let it = 0; it < 50; it++) {
      if (hHiT - hLoT < 1e-4) break;
      let Tm = (hLoT * fb - hHiT * fa) / (fb - fa);
      if (!Number.isFinite(Tm) || Tm <= hLoT || Tm >= hHiT || it % 4 === 3) {
        Tm = 0.5 * (hLoT + hHiT);
      }
      const sm = evalT(Tm);
      const fm = sm.hMolar_J_mol - h2Target;
      if (Math.abs(fm) <= 0.05) {
        st2 = sm;
        break;
      }
      if (fm < 0) {
        hLoT = Tm;
        sLo = sm;
        fa = fm;
      } else {
        hHiT = Tm;
        sHi = sm;
        fb = fm;
      }
      st2 = sm;
    }
  }

  // totalMolesKmolH [kmol/h] * shaftWork [J/mol = kJ/kmol] / 3600 [s/h] = kW
  const shaftWorkJmol = st2.hMolar_J_mol - st1.hMolar_J_mol;
  const shaftPowerKW = (totalMolesKmolH * shaftWorkJmol) / 3600.0;

  return {
    T1_C,
    T2s_C: st2s.T_C,
    T2_C: st2.T_C,
    P1_barA,
    P2_barA,
    betaVap1: st1.betaVap,
    betaVap2s: st2s.betaVap,
    betaVap2: st2.betaVap,
    h1_J_mol: st1.hMolar_J_mol,
    h2s_J_mol: st2s.hMolar_J_mol,
    h2_J_mol: st2.hMolar_J_mol,
    s1_J_molK: st1.sMolar_J_molK,
    s2s_J_molK: st2s.sMolar_J_molK,
    s2_J_molK: st2.sMolar_J_molK,
    isentropicWork_J_mol: dhIsentropic,
    shaftWork_J_mol: shaftWorkJmol,
    shaftPower_kW: shaftPowerKW,
    Z1: st1.betaVap >= 0.5 ? st1.Z_vap : st1.Z_liq,
    Z2: st2.betaVap >= 0.5 ? st2.Z_vap : st2.Z_liq,
    vapKgH: st2.vapKgH,
    liqKgH: st2.liqKgH,
    converged,
    iterations: iters,
  };
}

/** Alias for `isentropicFlashEOS` (P-S flash for compressors & expanders) */
export const psFlash = isentropicFlashEOS;

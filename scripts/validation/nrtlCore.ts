// Reference (stand-alone) NRTL + modified-Raoult engine used to regress/validate the W2 databanks
// independently of the simulator engine. Convention identical to lib/calculations/activityModels.ts:
//   τ_ij = a_ij + b_ij / T[K],   G_ij = exp(-α_ij τ_ij),
//   ln γ_i = Σ_j x_j τ_ji G_ji / Σ_k x_k G_ki + Σ_j [x_j G_ij / Σ_k x_k G_kj] (τ_ij − Σ_m x_m τ_mj G_mj / Σ_k x_k G_kj)
import type { SimCompKey } from '../../lib/calculations/flowsheetSolver';
import { dippr101Pa } from '../../lib/calculations/data/pureComponentDatabank';

export interface PairParams { aij: number; aji: number; bij: number; bji: number; alpha: number }

export function tauPair(p: PairParams, T_K: number): [number, number] {
  return [p.aij + p.bij / T_K, p.aji + p.bji / T_K];
}

/** Binary NRTL: returns [lnγ1, lnγ2]; pair parameters given with i = comp 1, j = comp 2. */
export function nrtlBinaryLnGamma(x1: number, p: PairParams, T_K: number): [number, number] {
  const x2 = 1 - x1;
  const [t12, t21] = tauPair(p, T_K);
  const G12 = Math.exp(-p.alpha * t12);
  const G21 = Math.exp(-p.alpha * t21);
  const d1 = x1 + x2 * G21;
  const d2 = x2 + x1 * G12;
  const ln1 = x2 * x2 * (t21 * (G21 / d1) ** 2 + (t12 * G12) / (d2 * d2));
  const ln2 = x1 * x1 * (t12 * (G12 / d2) ** 2 + (t21 * G21) / (d1 * d1));
  return [ln1, ln2];
}

/** Multicomponent NRTL with τ/G matrices. */
export function nrtlMultiLnGamma(x: number[], tau: number[][], G: number[][]): number[] {
  const n = x.length;
  const S = new Array(n).fill(0);
  const C = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < n; k++) {
      S[j] += x[k] * G[k][j];
      C[j] += x[k] * G[k][j] * tau[k][j];
    }
  }
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = C[i] / S[i];
    for (let j = 0; j < n; j++) s += ((x[j] * G[i][j]) / S[j]) * (tau[i][j] - C[j] / S[j]);
    out[i] = s;
  }
  return out;
}

export function psatKPa(c: SimCompKey, T_C: number): number {
  return dippr101Pa(c, T_C + 273.15, false) / 1000;
}

/** Binary bubble pressure (modified Raoult) */
export function bubbleP(c: [SimCompKey, SimCompKey], x1: number, T_C: number, p: PairParams): { P: number; y1: number } {
  const T = T_C + 273.15;
  const [l1, l2] = nrtlBinaryLnGamma(x1, p, T);
  const p1 = x1 * Math.exp(l1) * psatKPa(c[0], T_C);
  const p2 = (1 - x1) * Math.exp(l2) * psatKPa(c[1], T_C);
  return { P: p1 + p2, y1: p1 / (p1 + p2) };
}

/** Binary bubble temperature at P (kPa), secant on ln P. */
export function bubbleT(c: [SimCompKey, SimCompKey], x1: number, P_kPa: number, p: PairParams, Tguess = 80): { T: number; y1: number; ok: boolean } {
  let T0 = Tguess;
  let T1 = Tguess + 5;
  let f0 = Math.log(bubbleP(c, x1, T0, p).P / P_kPa);
  let f1 = Math.log(bubbleP(c, x1, T1, p).P / P_kPa);
  for (let it = 0; it < 60; it++) {
    if (!Number.isFinite(f1) || Math.abs(f1 - f0) < 1e-14) break;
    let T2 = T1 - (f1 * (T1 - T0)) / (f1 - f0);
    T2 = Math.max(T1 - 40, Math.min(T1 + 40, T2));
    T0 = T1; f0 = f1; T1 = T2;
    f1 = Math.log(bubbleP(c, x1, T1, p).P / P_kPa);
    if (Math.abs(f1) < 1e-9) break;
  }
  const r = bubbleP(c, x1, T1, p);
  return { T: T1, y1: r.y1, ok: Math.abs(Math.log(r.P / P_kPa)) < 1e-6 };
}

/** Simple Levenberg-Marquardt with numerical Jacobian. */
export function levenbergMarquardt(
  resid: (p: number[]) => number[],
  p0: number[],
  maxIter = 200
): { p: number[]; ssr: number } {
  let p = p0.slice();
  let r = resid(p);
  let ssr = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-2;
  const n = p.length;
  for (let it = 0; it < maxIter; it++) {
    const J: number[][] = [];
    for (let k = 0; k < n; k++) {
      const h = Math.max(1e-4, Math.abs(p[k]) * 1e-5);
      const pp = p.slice(); pp[k] += h;
      const rp = resid(pp);
      J.push(rp.map((v, idx) => (v - r[idx]) / h));
    }
    const JTJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a].reduce((s, v, idx) => s + v * J[b][idx], 0)));
    const JTr = Array.from({ length: n }, (_, a) => J[a].reduce((s, v, idx) => s + v * r[idx], 0));
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const dp = solveLinear(A, JTr.map(v => -v));
      if (!dp) { lambda *= 10; continue; }
      const pn = p.map((v, k) => v + dp[k]);
      const rn = resid(pn);
      const sn = rn.reduce((s, v) => s + v * v, 0);
      if (Number.isFinite(sn) && sn < ssr) {
        const rel = (ssr - sn) / Math.max(1e-30, ssr);
        p = pn; r = rn; ssr = sn; lambda = Math.max(1e-9, lambda / 5); improved = true;
        if (rel < 1e-10) return { p, ssr };
        break;
      }
      lambda *= 8;
    }
    if (!improved) break;
  }
  return { p, ssr };
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    if (Math.abs(M[piv][i]) < 1e-300) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

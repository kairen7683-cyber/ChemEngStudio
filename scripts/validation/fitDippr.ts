// Linear least-squares fit of DIPPR-101 (ln P = A + B/T + C lnT + D T^E, E fixed) to (T[K], P[Pa]) points.
// Usage: npx.cmd tsx scripts/validation/fitDippr.ts
type Pt = [number, number];

export function fitDippr(points: Pt[], E: number, weights?: number[]): { A: number; B: number; C: number; D: number; E: number; maxDevPct: number } {
  const n = 4;
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  const v = new Array(n).fill(0);
  points.forEach(([T, P], k) => {
    const w = weights ? weights[k] : 1;
    const f = [1, 1 / T, Math.log(T), Math.pow(T, E)];
    const y = Math.log(P);
    for (let i = 0; i < n; i++) {
      v[i] += w * f[i] * y;
      for (let j = 0; j < n; j++) M[i][j] += w * f[i] * f[j];
    }
  });
  // Gaussian elimination
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    [v[i], v[p]] = [v[p], v[i]];
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c < n; c++) M[r][c] -= f * M[i][c];
      v[r] -= f * v[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = v[i];
    for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  let maxDev = 0;
  for (const [T, P] of points) {
    const pm = Math.exp(x[0] + x[1] / T + x[2] * Math.log(T) + x[3] * Math.pow(T, E));
    maxDev = Math.max(maxDev, Math.abs(pm / P - 1) * 100);
  }
  return { A: x[0], B: x[1], C: x[2], D: x[3], E, maxDevPct: maxDev };
}

const nistAntoine = (A: number, B: number, C: number) => (T: number) => Math.pow(10, A - B / (T + C)) * 1e5;

function report(name: string, pts: Pt[], E: number, w?: number[]) {
  const r = fitDippr(pts, E, w);
  console.log(`${name}: A=${r.A.toPrecision(7)} B=${r.B.toPrecision(7)} C=${r.C.toPrecision(7)} D=${r.D.toPrecision(6)} E=${E}  maxDev=${r.maxDevPct.toFixed(2)}%`);
}

const args = process.argv.slice(2);
if (args.includes('--pxylene') || args.length === 0) {
  // p-xylene: NIST WebBook Antoine (log10 P/bar = 4.14553 - 1474.403/(T - 55.377), 286-452 K) + critical point
  const f = nistAntoine(4.14553, 1474.403, -55.377);
  const pts: Pt[] = [];
  for (let T = 290; T <= 450; T += 10) pts.push([T, f(T)]);
  pts.push([616.2, 3.511e6]);
  report('pXylene', pts, 2);
}

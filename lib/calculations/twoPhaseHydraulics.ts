/**
 * Two-phase pressure-drop utilities (shared).
 *
 * Models:
 *  - Friedel (1979) separated-flow correlation for frictional gradient (horizontal/vertical up)
 *  - Lockhart–Martinelli (1949) with Chisholm C-constant (1967)
 *  - Homogeneous equilibrium model (McAdams viscosity)
 *  - Chisholm B-coefficient method (1973) — also used for shell-side (Grant/Chisholm two-phase multiplier)
 *  - Void fraction (Zivi / Rouhani–Axelsson), acceleration and gravity gradients
 *
 * Units: SI throughout (kg/m²s, kg/m³, Pa·s, N/m, m, Pa/m).
 */

export interface TwoPhaseInput {
  /** total mass flux G [kg/m²s] */
  massFluxKgM2s: number;
  /** vapour mass quality x [-] (0..1) */
  quality: number;
  rhoL: number;
  rhoG: number;
  muL: number;
  muG: number;
  /** surface tension [N/m] */
  sigma: number;
  /** hydraulic diameter [m] */
  diamM: number;
  /** absolute roughness [m] (default 4.5e-5 commercial steel) */
  roughnessM?: number;
}

const G_ACC = 9.80665;

/** Churchill (1977) Darcy friction factor – valid laminar → turbulent with roughness. */
export function churchillDarcy(Re: number, relRough = 0): number {
  const re = Math.max(Re, 1e-6);
  const A = Math.pow(-2.457 * Math.log(Math.pow(7 / re, 0.9) + 0.27 * relRough), 16);
  const B = Math.pow(37530 / re, 16);
  return 8 * Math.pow(Math.pow(8 / re, 12) + 1 / Math.pow(A + B, 1.5), 1 / 12);
}

/** Single-phase frictional gradient for mass flux G flowing with properties (rho, mu). */
export function singlePhaseGradient(G: number, rho: number, mu: number, D: number, rough = 4.5e-5): number {
  if (G <= 0 || D <= 0) return 0;
  const Re = (G * D) / Math.max(mu, 1e-9);
  const f = churchillDarcy(Re, rough / D);
  return (f * G * G) / (2 * D * rho);
}

function clampX(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

/**
 * Friedel (1979) frictional pressure gradient.
 * φ²_LO = E + 3.24·F·H / (Fr^0.045 · We^0.035)
 */
export function friedelTwoPhaseGradient(p: TwoPhaseInput): { dPdzPaPerM: number; phiLO2: number } {
  const G = Math.max(p.massFluxKgM2s, 0);
  const x = clampX(p.quality);
  const D = Math.max(p.diamM, 1e-6);
  const rough = p.roughnessM ?? 4.5e-5;
  const { rhoL, rhoG, muL, muG } = p;
  const sigma = Math.max(p.sigma, 1e-5);
  if (G === 0) return { dPdzPaPerM: 0, phiLO2: 1 };

  const ReLO = (G * D) / muL;
  const ReGO = (G * D) / muG;
  const fLO = churchillDarcy(ReLO, rough / D);
  const fGO = churchillDarcy(ReGO, rough / D);

  const E = (1 - x) ** 2 + x * x * (rhoL * fGO) / (rhoG * fLO);
  const F = Math.pow(x, 0.78) * Math.pow(1 - x, 0.224);
  const H = Math.pow(rhoL / rhoG, 0.91) * Math.pow(muG / muL, 0.19) * Math.pow(1 - muG / muL, 0.7);
  const rhoH = 1 / (x / rhoG + (1 - x) / rhoL);
  const Fr = (G * G) / (G_ACC * D * rhoH * rhoH);
  const We = (G * G * D) / (rhoH * sigma);
  const phiLO2 = E + (3.24 * F * H) / (Math.pow(Math.max(Fr, 1e-12), 0.045) * Math.pow(Math.max(We, 1e-12), 0.035));
  const dPLO = (fLO * G * G) / (2 * D * rhoL);
  return { dPdzPaPerM: phiLO2 * dPLO, phiLO2 };
}

/**
 * Lockhart–Martinelli with Chisholm (1967) C constant.
 * φ²_L = 1 + C/X + 1/X²
 */
export function lockhartMartinelliGradient(p: TwoPhaseInput): {
  dPdzPaPerM: number;
  X: number;
  phiL2: number;
  C: number;
  regime: string;
} {
  const G = Math.max(p.massFluxKgM2s, 0);
  const x = clampX(p.quality);
  const D = Math.max(p.diamM, 1e-6);
  const rough = p.roughnessM ?? 4.5e-5;
  if (G === 0) return { dPdzPaPerM: 0, X: Infinity, phiL2: 1, C: 0, regime: 'none' };
  const GL = G * (1 - x);
  const GG = G * x;
  const dPL = singlePhaseGradient(GL, p.rhoL, p.muL, D, rough);
  const dPG = singlePhaseGradient(GG, p.rhoG, p.muG, D, rough);
  if (dPL <= 0) return { dPdzPaPerM: dPG, X: 0, phiL2: Infinity, C: 0, regime: 'gas only' };
  if (dPG <= 0) return { dPdzPaPerM: dPL, X: Infinity, phiL2: 1, C: 0, regime: 'liquid only' };
  const ReL = (GL * D) / p.muL;
  const ReG = (GG * D) / p.muG;
  const lt = ReL > 2000 ? 't' : 'v';
  const gt = ReG > 2000 ? 't' : 'v';
  const Ctab: Record<string, number> = { tt: 20, vt: 12, tv: 10, vv: 5 };
  const C = Ctab[lt + gt];
  const X = Math.sqrt(dPL / dPG);
  const phiL2 = 1 + C / X + 1 / (X * X);
  return { dPdzPaPerM: phiL2 * dPL, X, phiL2, C, regime: lt + gt };
}

/** Homogeneous equilibrium model, McAdams mixture viscosity. */
export function homogeneousGradient(p: TwoPhaseInput): { dPdzPaPerM: number; rhoH: number; muH: number } {
  const G = Math.max(p.massFluxKgM2s, 0);
  const x = clampX(p.quality);
  const D = Math.max(p.diamM, 1e-6);
  const rhoH = 1 / (x / p.rhoG + (1 - x) / p.rhoL);
  const muH = 1 / (x / p.muG + (1 - x) / p.muL);
  return { dPdzPaPerM: singlePhaseGradient(G, rhoH, muH, D, p.roughnessM ?? 4.5e-5), rhoH, muH };
}

/**
 * Chisholm (1973) B-coefficient method.
 * φ²_LO = 1 + (Γ²−1)[B·x^((2−n)/2)(1−x)^((2−n)/2) + x^(2−n)],  Γ² = (dP/dz)_GO/(dP/dz)_LO
 */
export function chisholmBGradient(p: TwoPhaseInput, n = 0.25): { dPdzPaPerM: number; phiLO2: number; Gamma: number; B: number } {
  const G = Math.max(p.massFluxKgM2s, 0);
  const x = clampX(p.quality);
  const D = Math.max(p.diamM, 1e-6);
  const rough = p.roughnessM ?? 4.5e-5;
  const dPLO = singlePhaseGradient(G, p.rhoL, p.muL, D, rough);
  const dPGO = singlePhaseGradient(G, p.rhoG, p.muG, D, rough);
  if (dPLO <= 0) return { dPdzPaPerM: 0, phiLO2: 1, Gamma: 1, B: 0 };
  const Gamma = Math.sqrt(dPGO / dPLO);
  let B: number;
  if (Gamma <= 9.5) B = G <= 500 ? 4.8 : G < 1900 ? 2400 / G : 55 / Math.sqrt(G);
  else if (Gamma < 28) B = G <= 600 ? 520 / (Gamma * Math.sqrt(G)) : 21 / Gamma;
  else B = 15000 / (Gamma * Gamma * Math.sqrt(G));
  const e = (2 - n) / 2;
  const phiLO2 = 1 + (Gamma * Gamma - 1) * (B * Math.pow(x, e) * Math.pow(1 - x, e) + Math.pow(x, 2 - n));
  return { dPdzPaPerM: phiLO2 * dPLO, phiLO2, Gamma, B };
}

/**
 * Shell-side two-phase multiplier (Grant & Chisholm 1979 form) applied to a liquid-only
 * shell-side ΔP: φ²_LO = 1 + (Γ²−1)[B·x^(1−n/2)(1−x)^(1−n/2) + x^(2−n)]
 *   crossflow (vertical/horizontal): B ≈ 0.75 (spray/bubbly), 0.25 (stratified horizontal); window B = 2/(Γ+1)
 * Γ² taken as ρL/ρG·(μG/μL)^n.
 */
export function chisholmShellMultiplier(
  x: number,
  rhoL: number,
  rhoG: number,
  muL: number,
  muG: number,
  zone: 'crossflow' | 'window' = 'crossflow',
  n = 0.46,
): number {
  const xx = clampX(x);
  const Gamma2 = (rhoL / rhoG) * Math.pow(muG / muL, n);
  const Gamma = Math.sqrt(Gamma2);
  const B = zone === 'window' ? 2 / (Gamma + 1) : 0.75;
  const e = 1 - n / 2;
  return 1 + (Gamma2 - 1) * (B * Math.pow(xx, e) * Math.pow(1 - xx, e) + Math.pow(xx, 2 - n));
}

/** Rouhani–Axelsson (1970) drift-flux void fraction (horizontal form). */
export function voidFractionRouhani(p: TwoPhaseInput): number {
  const x = clampX(p.quality);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const G = Math.max(p.massFluxKgM2s, 1e-9);
  const Ud = (1.18 * (1 - x) * Math.pow(G_ACC * p.sigma * (p.rhoL - p.rhoG), 0.25)) / Math.sqrt(p.rhoL);
  const C0 = 1 + 0.12 * (1 - x);
  return (x / p.rhoG) / (C0 * (x / p.rhoG + (1 - x) / p.rhoL) + Ud / G);
}

/** Zivi (1964) slip-ratio void fraction. */
export function voidFractionZivi(x: number, rhoL: number, rhoG: number): number {
  const xx = clampX(x);
  if (xx <= 0) return 0;
  if (xx >= 1) return 1;
  return 1 / (1 + ((1 - xx) / xx) * Math.pow(rhoG / rhoL, 2 / 3));
}

/** Separated-flow momentum flux term G²[x²/(ρGα) + (1−x)²/(ρL(1−α))] */
function momentumFlux(G: number, x: number, rhoL: number, rhoG: number, alpha: number): number {
  const a = Math.min(Math.max(alpha, 1e-6), 1 - 1e-6);
  return G * G * ((x * x) / (rhoG * a) + ((1 - x) * (1 - x)) / (rhoL * (1 - a)));
}

/**
 * Integrated pressure drop over a tube length with linear quality change xIn → xOut.
 * Returns frictional, acceleration and static components [Pa].
 */
export function integratedTwoPhaseDP(
  base: Omit<TwoPhaseInput, 'quality'>,
  xIn: number,
  xOut: number,
  lengthM: number,
  opts: { model?: 'friedel' | 'lm' | 'homogeneous' | 'chisholm'; inclinationDeg?: number; steps?: number } = {},
): { frictionPa: number; accelerationPa: number; staticPa: number; totalPa: number } {
  const steps = Math.max(opts.steps ?? 20, 2);
  const model = opts.model ?? 'friedel';
  const sinT = Math.sin(((opts.inclinationDeg ?? 0) * Math.PI) / 180);
  let fr = 0;
  let st = 0;
  const dz = lengthM / steps;
  for (let i = 0; i < steps; i++) {
    const x = xIn + ((i + 0.5) / steps) * (xOut - xIn);
    const inp = { ...base, quality: x };
    let g: number;
    if (model === 'lm') g = lockhartMartinelliGradient(inp).dPdzPaPerM;
    else if (model === 'homogeneous') g = homogeneousGradient(inp).dPdzPaPerM;
    else if (model === 'chisholm') g = chisholmBGradient(inp).dPdzPaPerM;
    else g = friedelTwoPhaseGradient(inp).dPdzPaPerM;
    fr += g * dz;
    if (sinT !== 0) {
      const a = voidFractionRouhani(inp);
      st += (a * base.rhoG + (1 - a) * base.rhoL) * G_ACC * sinT * dz;
    }
  }
  const aIn = voidFractionRouhani({ ...base, quality: xIn });
  const aOut = voidFractionRouhani({ ...base, quality: xOut });
  const acc =
    momentumFlux(base.massFluxKgM2s, clampX(xOut), base.rhoL, base.rhoG, aOut) -
    momentumFlux(base.massFluxKgM2s, clampX(xIn), base.rhoL, base.rhoG, aIn);
  return { frictionPa: fr, accelerationPa: acc, staticPa: st, totalPa: fr + acc + st };
}

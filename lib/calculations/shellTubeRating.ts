/**
 * Shell-and-tube thermal/hydraulic rating library.
 *
 *  - Bell–Delaware (Taborek, HEDH 3.3.2 / Kakaç–Liu / Serth) shell-side heat transfer & pressure drop
 *    with ideal tube-bank j/f curves and full Jc·Jl·Jb·Js·Jr, Rl·Rb·Rs corrections
 *  - Kern (1950) shell-side method (reference/cross-check)
 *  - Tube-side single phase (Gnielinski / Hausen laminar, Churchill friction, return losses)
 *  - Tube-side condensation (Shah 1979) & flow boiling (Gungor–Winterton 1987 simplified)
 *  - Shell-side condensation (Nusselt–Kern bundle loading) & shell-side boiling (Mostinski + bundle factor)
 *  - TEMA RCB-V flow-induced vibration: natural frequency (hydrodynamic mass), vortex shedding amplitude,
 *    fluidelastic instability (Connors), acoustic resonance (gas)
 *
 * All SI units.
 */

import {
  churchillDarcy,
  integratedTwoPhaseDP,
  chisholmShellMultiplier,
} from './twoPhaseHydraulics';

const G_ACC = 9.80665;

export type LayoutDeg = 30 | 45 | 60 | 90;

export interface ShellTubeGeometry {
  shellIdM: number;
  tubeOdM: number;
  tubeIdM: number;
  tubePitchM: number;
  layoutDeg: LayoutDeg;
  tubeCount: number;
  tubePasses: number;
  /** effective tube length between tubesheets [m] */
  tubeLengthM: number;
  /** central baffle spacing Lb [m] */
  baffleSpacingM: number;
  /** baffle cut as fraction of Ds (0.15–0.45) */
  baffleCutFrac: number;
  inletBaffleSpacingM?: number;
  outletBaffleSpacingM?: number;
  /** outer tube limit diameter Dotl [m] (default Ds − Lbb with Lbb from TEMA) */
  bundleDiaM?: number;
  /** diametral shell-to-baffle clearance Lsb [m] (default TEMA: 3.1 mm + 0.004·Ds) */
  shellBaffleClearanceM?: number;
  /** diametral tube-to-baffle-hole clearance Ltb [m] (default TEMA: 0.8 mm, 0.4 mm if span > 914 mm) */
  tubeBaffleClearanceM?: number;
  /** sealing strip pairs Nss */
  sealingStripPairs?: number;
  /** pass-partition lane width in the crossflow direction [m] (0 if lanes parallel to flow) */
  passLaneWidthM?: number;
  /** number of baffles Nb (default from spacing) */
  baffleCount?: number;
}

export interface FluidState {
  massFlowKgS: number;
  rho: number;
  /** Pa·s */
  mu: number;
  /** wall viscosity Pa·s (optional, default = mu) */
  muWall?: number;
  /** J/kg·K */
  cp: number;
  /** W/m·K */
  k: number;
}

export interface BellDelawareResult {
  Sm: number;
  Gs: number;
  Re: number;
  Pr: number;
  jIdeal: number;
  fIdeal: number;
  hIdeal: number;
  Jc: number;
  Jl: number;
  Jb: number;
  Js: number;
  Jr: number;
  Jtotal: number;
  h: number;
  Fc: number;
  Fw: number;
  Ssb: number;
  Stb: number;
  Sb: number;
  Sw: number;
  rs: number;
  rlm: number;
  Fsbp: number;
  Ntcc: number;
  Ntcw: number;
  Nb: number;
  Lbi: number;
  Lbo: number;
  Lsb: number;
  Ltb: number;
  Rl: number;
  Rb: number;
  Rs: number;
  dpIdealCrossPa: number;
  dpIdealWindowPa: number;
  dpCrossPa: number;
  dpWindowPa: number;
  dpEndPa: number;
  dpTotalPa: number;
  crossVelMs: number;
  windowVelMs: number;
}

// Taborek ideal tube-bank coefficients (HEDH): ranges Re ≥1e4, 1e3–1e4, 1e2–1e3, 10–1e2, <10
type CoefRow = [number, number];
interface BankCoefs {
  a: CoefRow[];
  a3: number;
  a4: number;
  b: CoefRow[];
  b3: number;
  b4: number;
}
const BANK: Record<30 | 45 | 90, BankCoefs> = {
  30: {
    a: [[0.321, -0.388], [0.321, -0.388], [0.593, -0.477], [1.36, -0.657], [1.4, -0.667]],
    a3: 1.45,
    a4: 0.519,
    b: [[0.372, -0.123], [0.486, -0.152], [4.57, -0.476], [45.1, -0.973], [48.0, -1.0]],
    b3: 7.0,
    b4: 0.5,
  },
  45: {
    a: [[0.37, -0.396], [0.37, -0.396], [0.73, -0.5], [0.498, -0.656], [1.55, -0.667]],
    a3: 1.93,
    a4: 0.5,
    b: [[0.303, -0.126], [0.333, -0.136], [3.5, -0.476], [26.2, -0.913], [32.0, -1.0]],
    b3: 6.59,
    b4: 0.52,
  },
  90: {
    a: [[0.37, -0.395], [0.107, -0.266], [0.408, -0.46], [0.9, -0.631], [0.97, -0.667]],
    a3: 1.187,
    a4: 0.37,
    b: [[0.391, -0.148], [0.0815, 0.022], [6.09, -0.602], [32.1, -0.963], [35.0, -1.0]],
    b3: 6.3,
    b4: 0.378,
  },
};

function bankKey(deg: LayoutDeg): 30 | 45 | 90 {
  return deg === 45 ? 45 : deg === 90 ? 90 : 30;
}

function reRow(Re: number): number {
  return Re >= 1e4 ? 0 : Re >= 1e3 ? 1 : Re >= 1e2 ? 2 : Re >= 10 ? 3 : 4;
}

/** Ideal tube bank Colburn j and Fanning-type f (Taborek curve fits). */
export function idealTubeBankJF(Re: number, pitchRatio: number, deg: LayoutDeg): { j: number; f: number } {
  const c = BANK[bankKey(deg)];
  const r = reRow(Re);
  const re = Math.max(Re, 1);
  const aExp = c.a3 / (1 + 0.14 * Math.pow(re, c.a4));
  const bExp = c.b3 / (1 + 0.14 * Math.pow(re, c.b4));
  const j = c.a[r][0] * Math.pow(1.33 / pitchRatio, aExp) * Math.pow(re, c.a[r][1]);
  const f = c.b[r][0] * Math.pow(1.33 / pitchRatio, bExp) * Math.pow(re, c.b[r][1]);
  return { j, f };
}

/** TEMA-style default pass-partition lane width Lpl [m] in crossflow direction. */
export function defaultPassLaneWidthM(tubePasses: number, tubeOdM: number): number {
  return tubePasses > 1 ? Math.max(0.012, tubeOdM * 0.75) : 0;
}

/** TEMA-style default clearances. */
export function temaDefaultClearances(shellIdM: number, maxSpanM: number): { Lsb: number; Ltb: number; Lbb: number } {
  const DsMm = shellIdM * 1000;
  const Lsb = (3.1 + 0.004 * DsMm) / 1000;
  const Ltb = maxSpanM > 0.914 ? 0.0004 : 0.0008;
  // bundle-to-shell diametral clearance for fixed tubesheet / U-tube (Taborek fit)
  const Lbb = (12 + 0.005 * DsMm) / 1000;
  return { Lsb, Ltb, Lbb };
}

function pitchComponents(Ltp: number, deg: LayoutDeg): { Lpn: number; Lpp: number; LtpEff: number } {
  if (deg === 90) return { Lpn: Ltp, Lpp: Ltp, LtpEff: Ltp };
  if (deg === 45) return { Lpn: 0.707 * Ltp, Lpp: 0.707 * Ltp, LtpEff: 0.707 * Ltp };
  if (deg === 60) return { Lpn: 0.866 * Ltp, Lpp: 0.5 * Ltp, LtpEff: Ltp };
  return { Lpn: 0.5 * Ltp, Lpp: 0.866 * Ltp, LtpEff: Ltp };
}

/**
 * Full Bell–Delaware shell-side rating (single-phase).
 */
export function bellDelawareShellSide(g: ShellTubeGeometry, fl: FluidState): BellDelawareResult {
  const Ds = g.shellIdM;
  const d = g.tubeOdM;
  const Ltp = g.tubePitchM;
  const Lb = g.baffleSpacingM;
  const Bc = Math.min(Math.max(g.baffleCutFrac, 0.1), 0.49);
  const L = g.tubeLengthM;
  const Nt = g.tubeCount;
  const tema = temaDefaultClearances(Ds, Lb * 2);
  const Dotl = g.bundleDiaM ?? Ds - tema.Lbb;
  const Lsb = g.shellBaffleClearanceM ?? tema.Lsb;
  const Ltb = g.tubeBaffleClearanceM ?? tema.Ltb;
  const Nss = g.sealingStripPairs ?? 0;
  const Lpl =
    g.passLaneWidthM !== undefined && g.passLaneWidthM > 0
      ? g.passLaneWidthM
      : g.tubePasses > 1
        ? defaultPassLaneWidthM(g.tubePasses, d)
        : 0;
  const Dctl = Dotl - d;
  const { Lpp, LtpEff } = pitchComponents(Ltp, g.layoutDeg);

  // baffle count & end spacings
  let Nb = g.baffleCount ?? Math.max(1, Math.floor(L / Lb) - 1);
  let Lbi = g.inletBaffleSpacingM ?? 0;
  let Lbo = g.outletBaffleSpacingM ?? 0;
  if (!g.inletBaffleSpacingM && !g.outletBaffleSpacingM) {
    const rest = L - (Nb - 1) * Lb;
    Lbi = Lbo = Math.max(rest / 2, 0.3 * Lb);
  } else if (!g.inletBaffleSpacingM) {
    Lbi = Math.max(L - (Nb - 1) * Lb - Lbo, 0.3 * Lb);
  } else if (!g.outletBaffleSpacingM) {
    Lbo = Math.max(L - (Nb - 1) * Lb - Lbi, 0.3 * Lb);
  }
  if (g.baffleCount === undefined && g.inletBaffleSpacingM && g.outletBaffleSpacingM) {
    Nb = Math.max(1, Math.round((L - Lbi - Lbo) / Lb) + 1);
  }

  // crossflow area
  const Sm = Lb * (Ds - Dotl + (Dctl / LtpEff) * (Ltp - d));
  const Gs = fl.massFlowKgS / Sm;
  const mu = fl.mu;
  const muW = fl.muWall ?? mu;
  const phiVisc = Math.pow(mu / muW, 0.14);
  const Re = (d * Gs) / mu;
  const Pr = (fl.cp * mu) / fl.k;
  const { j, f } = idealTubeBankJF(Re, Ltp / d, g.layoutDeg);
  const hIdeal = j * fl.cp * Gs * Math.pow(Pr, -2 / 3) * phiVisc;

  // window geometry
  const thetaCtl = 2 * Math.acos(Math.min(1, (Ds * (1 - 2 * Bc)) / Dctl));
  const Fw = thetaCtl / (2 * Math.PI) - Math.sin(thetaCtl) / (2 * Math.PI);
  const Fc = 1 - 2 * Fw;
  const Jc = 0.55 + 0.72 * Fc;

  // leakage
  const thetaDs = 2 * Math.acos(1 - 2 * Bc);
  const Ssb = ((Math.PI * Ds * Lsb) / 2) * (1 - thetaDs / (2 * Math.PI));
  const Stb = (Math.PI / 4) * ((d + Ltb) ** 2 - d * d) * Nt * (1 - Fw);
  const rs = Ssb / (Ssb + Stb);
  const rlm = (Ssb + Stb) / Sm;
  const Jl = 0.44 * (1 - rs) + (1 - 0.44 * (1 - rs)) * Math.exp(-2.2 * rlm);

  // bypass
  const Sb = Lb * (Ds - Dotl + Lpl);
  const Fsbp = Sb / Sm;
  const Ntcc = (Ds / Lpp) * (1 - 2 * Bc);
  const rss = Nss / Math.max(Ntcc, 1e-6);
  const Cbh = Re < 100 ? 1.35 : 1.25;
  const Jb = rss >= 0.5 ? 1 : Math.exp(-Cbh * Fsbp * (1 - Math.cbrt(2 * rss)));

  // unequal end spacing
  const nJ = Re < 100 ? 1 / 3 : 0.6;
  const Li = Lbi / Lb;
  const Lo = Lbo / Lb;
  const Js = (Nb - 1 + Math.pow(Li, 1 - nJ) + Math.pow(Lo, 1 - nJ)) / (Nb - 1 + Li + Lo);

  // window rows & laminar correction
  const Ntcw = (0.8 / Lpp) * (Ds * Bc - (Ds - Dctl) / 2);
  const Nc = (Ntcc + Ntcw) * (Nb + 1);
  const JrStar = Math.pow(10 / Math.max(Nc, 1), 0.18);
  let Jr = 1;
  if (Re <= 20) Jr = JrStar;
  else if (Re < 100) Jr = JrStar + ((20 - Re) / 80) * (JrStar - 1);
  Jr = Math.max(Jr, 0.4);

  const Jtotal = Jc * Jl * Jb * Js * Jr;
  const h = hIdeal * Jtotal;

  // pressure drop
  const dpIdealCross = (2 * f * Ntcc * Gs * Gs) / fl.rho / phiVisc;
  const pRl = -0.15 * (1 + rs) + 0.8;
  const Rl = Math.exp(-1.33 * (1 + rs) * Math.pow(rlm, pRl));
  const Cbp = Re < 100 ? 4.5 : 3.7;
  const Rb = rss >= 0.5 ? 1 : Math.exp(-Cbp * Fsbp * (1 - Math.cbrt(2 * rss)));
  const Swg = ((Math.PI / 4) * Ds * Ds) * (thetaDs / (2 * Math.PI) - Math.sin(thetaDs) / (2 * Math.PI));
  const Swt = Nt * Fw * (Math.PI / 4) * d * d;
  const Sw = Math.max(Swg - Swt, 1e-6);
  const Dw = (4 * Sw) / (Math.PI * d * Nt * Fw + (Ds * thetaDs) / 2);
  const Gw = fl.massFlowKgS / Math.sqrt(Sm * Sw);
  let dpIdealWindow: number;
  if (Re >= 100) dpIdealWindow = ((2 + 0.6 * Ntcw) * Gw * Gw) / (2 * fl.rho);
  else
    dpIdealWindow =
      ((26 * mu * Gw) / fl.rho) * (Ntcw / (Ltp - d) + Lb / (Dw * Dw)) + (Gw * Gw) / fl.rho;
  const nR = Re < 100 ? 1 : 0.2;
  const Rs = 0.5 * (Math.pow(Lb / Lbo, 2 - nR) + Math.pow(Lb / Lbi, 2 - nR));
  const dpCross = dpIdealCross * (Nb - 1) * Rb * Rl;
  const dpWindow = Nb * dpIdealWindow * Rl;
  const dpEnd = 2 * dpIdealCross * (1 + Ntcw / Ntcc) * Rb * Rs;

  return {
    Sm,
    Gs,
    Re,
    Pr,
    jIdeal: j,
    fIdeal: f,
    hIdeal,
    Jc,
    Jl,
    Jb,
    Js,
    Jr,
    Jtotal,
    h,
    Fc,
    Fw,
    Ssb,
    Stb,
    Sb,
    Sw,
    rs,
    rlm,
    Fsbp,
    Ntcc,
    Ntcw,
    Nb,
    Lbi,
    Lbo,
    Lsb,
    Ltb,
    Rl,
    Rb,
    Rs,
    dpIdealCrossPa: dpIdealCross,
    dpIdealWindowPa: dpIdealWindow,
    dpCrossPa: dpCross,
    dpWindowPa: dpWindow,
    dpEndPa: dpEnd,
    dpTotalPa: dpCross + dpWindow + dpEnd,
    crossVelMs: Gs / fl.rho,
    windowVelMs: Gw / fl.rho,
  };
}

/** Kern (1950) shell-side method (25 % cut segmental baffles), SI form. */
export function kernShellSide(
  g: ShellTubeGeometry,
  fl: FluidState,
): { As: number; De: number; Gs: number; Re: number; h: number; dpPa: number; f: number } {
  const Ds = g.shellIdM;
  const d = g.tubeOdM;
  const pt = g.tubePitchM;
  const B = g.baffleSpacingM;
  const As = (Ds * B * (pt - d)) / pt;
  const De =
    g.layoutDeg === 90 || g.layoutDeg === 45
      ? (4 * (pt * pt - (Math.PI * d * d) / 4)) / (Math.PI * d)
      : (4 * ((Math.sqrt(3) / 4) * pt * pt - (Math.PI * d * d) / 8)) / ((Math.PI * d) / 2);
  const Gs = fl.massFlowKgS / As;
  const Re = (Gs * De) / fl.mu;
  const Pr = (fl.cp * fl.mu) / fl.k;
  const phi = Math.pow(fl.mu / (fl.muWall ?? fl.mu), 0.14);
  const h = ((0.36 * fl.k) / De) * Math.pow(Re, 0.55) * Math.pow(Pr, 1 / 3) * phi;
  const Nb = g.baffleCount ?? Math.max(1, Math.floor(g.tubeLengthM / B) - 1);
  const f = Math.exp(0.576 - 0.19 * Math.log(Math.max(Re, 1)));
  const dpPa = (f * Gs * Gs * (Nb + 1) * Ds) / (2 * fl.rho * De * phi);
  return { As, De, Gs, Re, h, dpPa, f };
}

/** Tube side single-phase: Gnielinski (turbulent/transition), Hausen (laminar); Churchill friction. */
export function tubeSideSinglePhase(
  g: ShellTubeGeometry,
  fl: FluidState,
  roughnessM = 4.5e-5,
): { velMs: number; Re: number; Pr: number; h: number; fDarcy: number; dpStraightPa: number; dpReturnPa: number; dpTotalPa: number } {
  const di = g.tubeIdM;
  const nPerPass = g.tubeCount / g.tubePasses;
  const area = nPerPass * (Math.PI / 4) * di * di;
  const G = fl.massFlowKgS / area;
  const vel = G / fl.rho;
  const Re = (G * di) / fl.mu;
  const Pr = (fl.cp * fl.mu) / fl.k;
  const fD = churchillDarcy(Re, roughnessM / di);
  const phi = Math.pow(fl.mu / (fl.muWall ?? fl.mu), 0.14);
  let Nu: number;
  const NuLam = 3.66 + (0.0668 * (di / g.tubeLengthM) * Re * Pr) / (1 + 0.04 * Math.pow((di / g.tubeLengthM) * Re * Pr, 2 / 3));
  if (Re >= 3000) {
    const fG = Math.pow(0.79 * Math.log(Re) - 1.64, -2);
    Nu = ((fG / 8) * (Re - 1000) * Pr) / (1 + 12.7 * Math.sqrt(fG / 8) * (Math.pow(Pr, 2 / 3) - 1));
  } else if (Re <= 2300) {
    Nu = NuLam;
  } else {
    const fG = Math.pow(0.79 * Math.log(3000) - 1.64, -2);
    const Nu3000 = ((fG / 8) * 2000 * Pr) / (1 + 12.7 * Math.sqrt(fG / 8) * (Math.pow(Pr, 2 / 3) - 1));
    const w = (Re - 2300) / 700;
    Nu = (1 - w) * NuLam + w * Nu3000;
  }
  const h = ((Nu * fl.k) / di) * phi;
  const dyn = 0.5 * fl.rho * vel * vel;
  const dpStraight = ((fD * g.tubeLengthM * g.tubePasses) / di) * dyn / phi;
  const dpReturn = 4 * g.tubePasses * dyn;
  return { velMs: vel, Re, Pr, h, fDarcy: fD, dpStraightPa: dpStraight, dpReturnPa: dpReturn, dpTotalPa: dpStraight + dpReturn };
}

export interface TwoPhaseFluid {
  massFlowKgS: number;
  rhoL: number;
  rhoG: number;
  muL: number;
  muG: number;
  cpL: number;
  kL: number;
  sigma: number;
  /** latent heat J/kg */
  hfg: number;
  /** reduced pressure P/Pc (default 0.05) */
  pReduced?: number;
  /** critical pressure bar (default 45) */
  pCritBar?: number;
}

/** Shah (1979) in-tube condensation local h at quality x. */
export function shahCondensationH(fl: TwoPhaseFluid, G: number, di: number, x: number): number {
  const ReLO = (G * di) / fl.muL;
  const PrL = (fl.cpL * fl.muL) / fl.kL;
  const hLO = 0.023 * Math.pow(ReLO, 0.8) * Math.pow(PrL, 0.4) * (fl.kL / di);
  const pr = Math.min(Math.max(fl.pReduced ?? 0.05, 0.002), 0.9);
  const xx = Math.min(Math.max(x, 0), 1);
  return hLO * (Math.pow(1 - xx, 0.8) + (3.8 * Math.pow(xx, 0.76) * Math.pow(1 - xx, 0.04)) / Math.pow(pr, 0.38));
}

/** Gungor–Winterton (1987) simplified flow boiling local h; q heat flux W/m². */
export function gungorWintertonBoilingH(fl: TwoPhaseFluid, G: number, di: number, x: number, qWm2: number): number {
  const xx = Math.min(Math.max(x, 0), 0.95);
  const ReL = (G * (1 - xx) * di) / fl.muL;
  const PrL = (fl.cpL * fl.muL) / fl.kL;
  const hL = 0.023 * Math.pow(Math.max(ReL, 100), 0.8) * Math.pow(PrL, 0.4) * (fl.kL / di);
  const Bo = qWm2 / (G * fl.hfg);
  const E = 1 + 3000 * Math.pow(Math.max(Bo, 0), 0.86) + 1.12 * Math.pow(xx / (1 - xx), 0.75) * Math.pow(fl.rhoL / fl.rhoG, 0.41);
  return E * hL;
}

/** Shell-side condensation on horizontal tube bundle (Nusselt with Kern Nr^-1/6 row correction). */
export function shellCondensationH(fl: TwoPhaseFluid, g: ShellTubeGeometry): number {
  const Gamma = fl.massFlowKgS / (g.tubeLengthM * g.tubeCount); // kg/s·m per tube (Kern loading)
  const Nr = Math.max(1, (2 / 3) * (g.bundleDiaM ?? g.shellIdM) / g.tubePitchM);
  const hNu =
    0.95 * fl.kL * Math.cbrt((fl.rhoL * (fl.rhoL - fl.rhoG) * G_ACC) / (fl.muL * Gamma)) * Math.pow(Nr, -1 / 6);
  return hNu;
}

/** Shell-side (kettle/pool) boiling – Mostinski with bundle convective factor Fb. */
export function shellBoilingH(fl: TwoPhaseFluid, qWm2: number, bundleFactor = 1.5): number {
  const Pc = fl.pCritBar ?? 45;
  const pr = Math.min(Math.max(fl.pReduced ?? 0.05, 0.001), 0.95);
  const Fp = 1.8 * Math.pow(pr, 0.17) + 4 * Math.pow(pr, 1.2) + 10 * Math.pow(pr, 10);
  return 0.104 * Math.pow(Pc, 0.69) * Math.pow(Math.max(qWm2, 100), 0.7) * Fp * bundleFactor;
}

/**
 * Silver–Bell–Ghaly (SBG) condensation film coefficient correction for
 * non-condensable gases (NCG) and/or sensible vapor-phase cooling resistance.
 */
export function silverBellGhalyCondensationH(
  hCondWm2K: number,
  hGasSensibleWm2K: number,
  qSensibleFrac: number,
  ncgMolFrac = 0,
): number {
  const hCond = Math.max(50, hCondWm2K);
  const hGas = Math.max(15, hGasSensibleWm2K);
  const yNcg = Math.min(1, Math.max(0, ncgMolFrac || 0));
  const qSens = Math.min(1, Math.max(0, qSensibleFrac || 0));
  const Zg = Math.min(0.98, Math.max(0, qSens + 0.85 * yNcg));
  const hEff = 1 / (1 / hCond + Zg / hGas);
  return Math.min(hCond, Math.max(20, hEff));
}

/**
 * N-segment composite midpoint integration of local phase-change heat transfer
 * coefficient along vapor quality xIn -> xOut (clamping local x to [0.02, 0.98]).
 */
export function integratedPhaseChangeH(
  xIn: number,
  xOut: number,
  evalLocalH: (x: number) => number,
  segments = 10,
): number {
  const N = Math.max(1, Math.round(segments));
  const a = Math.min(0.98, Math.max(0.02, xIn));
  const b = Math.min(0.98, Math.max(0.02, xOut));
  if (Math.abs(b - a) < 1e-5) {
    return Math.max(20, evalLocalH(0.5 * (a + b)));
  }
  let sumH = 0;
  for (let i = 0; i < N; i++) {
    const xMid = a + ((i + 0.5) / N) * (b - a);
    const xClamped = Math.min(0.98, Math.max(0.02, xMid));
    sumH += Math.max(20, evalLocalH(xClamped));
  }
  return sumH / N;
}

export interface ChfCheckInput {
  rhoL: number;
  rhoV: number;
  sigmaNm?: number;
  hfgJkg: number;
  pitchRatio?: number;
  bundleDiaM?: number;
  heatFluxWm2: number;
}

export interface ChfCheckResult {
  qChfPoolWm2: number;
  qChfBundleWm2: number;
  heatFluxWm2: number;
  chfRatio: number;
  status: 'OK' | 'WARN' | 'CRITICAL';
}

/**
 * Zuber pool-boiling Critical Heat Flux (CHF) with Palen–Small bundle correction.
 */
export function zuberPalenSmallChfWm2(params: ChfCheckInput): ChfCheckResult {
  const rhoL = Math.max(10, params.rhoL);
  const rhoV = Math.max(0.05, Math.min(params.rhoV, rhoL * 0.85));
  const sigma = Math.max(0.001, params.sigmaNm ?? 0.02);
  const hfg = Math.max(1e4, params.hfgJkg);
  const qChfPoolWm2 =
    0.131 * hfg * Math.sqrt(rhoV) * Math.pow(sigma * G_ACC * Math.max(1, rhoL - rhoV), 0.25);

  const pr = Math.max(1.1, params.pitchRatio ?? 1.25);
  const db = params.bundleDiaM && params.bundleDiaM > 0 ? params.bundleDiaM : 0.6;
  const phiB = Math.min(0.85, Math.max(0.65, 0.75 + 0.18 * (pr - 1.25) - 0.06 * (db - 0.6)));
  const qChfBundleWm2 = qChfPoolWm2 * phiB;
  const heatFluxWm2 = Math.max(0, params.heatFluxWm2);
  const chfRatio = heatFluxWm2 / Math.max(1, qChfBundleWm2);
  const status: 'OK' | 'WARN' | 'CRITICAL' =
    chfRatio > 0.85 ? 'CRITICAL' : chfRatio > 0.7 ? 'WARN' : 'OK';

  return {
    qChfPoolWm2,
    qChfBundleWm2,
    heatFluxWm2,
    chfRatio,
    status,
  };
}

export interface TemaImpingementResult {
  rhoV2Pa: number;
  limitPa: number;
  impingementRequired: boolean;
  status: 'OK' | 'IMPINGEMENT_REQ' | 'OVERSIZE_NOZZLE';
}

/**
 * TEMA RCB-4.6 shell-side nozzle ρv² & impingement protection check.
 */
export function checkTemaImpingement(
  rhoKgM3: number,
  nozzleVelMs: number,
  isTwoPhaseOrCorrosive = false,
): TemaImpingementResult {
  const rho = Math.max(0.05, rhoKgM3);
  const vel = Math.max(0, nozzleVelMs);
  const rhoV2Pa = rho * vel * vel;
  const limitPa = isTwoPhaseOrCorrosive ? 740 : 2230;
  const impingementRequired = rhoV2Pa > limitPa;
  const status: 'OK' | 'IMPINGEMENT_REQ' | 'OVERSIZE_NOZZLE' =
    rhoV2Pa > 5950 ? 'OVERSIZE_NOZZLE' : impingementRequired ? 'IMPINGEMENT_REQ' : 'OK';

  return {
    rhoV2Pa,
    limitPa,
    impingementRequired,
    status,
  };
}

/** Tube-side two-phase pressure drop (Friedel), all passes, plus return losses on homogeneous basis. */
export function tubeSideTwoPhaseDP(
  g: ShellTubeGeometry,
  fl: TwoPhaseFluid,
  xIn: number,
  xOut: number,
): { frictionPa: number; accelerationPa: number; returnPa: number; totalPa: number; massFlux: number } {
  const di = g.tubeIdM;
  const nPerPass = g.tubeCount / g.tubePasses;
  const G = fl.massFlowKgS / (nPerPass * (Math.PI / 4) * di * di);
  const base = { massFluxKgM2s: G, rhoL: fl.rhoL, rhoG: fl.rhoG, muL: fl.muL, muG: fl.muG, sigma: fl.sigma, diamM: di };
  let fr = 0;
  let acc = 0;
  let ret = 0;
  for (let p = 0; p < g.tubePasses; p++) {
    const a = xIn + ((xOut - xIn) * p) / g.tubePasses;
    const b = xIn + ((xOut - xIn) * (p + 1)) / g.tubePasses;
    const r = integratedTwoPhaseDP(base, a, b, g.tubeLengthM, { model: 'friedel', steps: 10 });
    fr += r.frictionPa;
    acc += r.accelerationPa;
    const rhoH = 1 / (b / fl.rhoG + (1 - b) / fl.rhoL);
    ret += (4 * G * G) / (2 * rhoH);
  }
  return { frictionPa: fr, accelerationPa: acc, returnPa: ret, totalPa: fr + Math.max(acc, 0) + ret, massFlux: G };
}

/** Shell-side two-phase ΔP: Bell–Delaware liquid-only ΔP × averaged Chisholm multipliers. */
export function shellSideTwoPhaseDP(
  g: ShellTubeGeometry,
  fl: TwoPhaseFluid,
  xIn: number,
  xOut: number,
): { dpPa: number; phiCross: number; phiWindow: number; liquidOnly: BellDelawareResult } {
  const lo = bellDelawareShellSide(g, { massFlowKgS: fl.massFlowKgS, rho: fl.rhoL, mu: fl.muL, cp: fl.cpL, k: fl.kL });
  const N = 10;
  let pc = 0;
  let pw = 0;
  for (let i = 0; i < N; i++) {
    const x = xIn + ((i + 0.5) / N) * (xOut - xIn);
    pc += chisholmShellMultiplier(x, fl.rhoL, fl.rhoG, fl.muL, fl.muG, 'crossflow') / N;
    pw += chisholmShellMultiplier(x, fl.rhoL, fl.rhoG, fl.muL, fl.muG, 'window') / N;
  }
  return { dpPa: (lo.dpCrossPa + lo.dpEndPa) * pc + lo.dpWindowPa * pw, phiCross: pc, phiWindow: pw, liquidOnly: lo };
}

// ─────────────────────────────── TEMA RCB-V vibration ───────────────────────────────

export interface VibrationInput {
  g: ShellTubeGeometry;
  /** crossflow reference velocity [m/s] */
  crossVelMs: number;
  shellRho: number;
  tubeRhoInside: number;
  /** tube metal density [kg/m³] */
  metalRho?: number;
  /** Young's modulus [Pa] */
  eModPa?: number;
  shellPhase: 'liquid' | 'gas' | 'twophase';
  /** speed of sound in shell gas [m/s] (acoustic check) */
  soundSpeedMs?: number;
  /** gas molecular weight [kg/kmol] for acoustic speed c = sqrt(k·R·T/MW) */
  gasMw?: number;
  /** gas heat capacity ratio cp/cv (default 1.3) */
  gasK?: number;
  /** gas absolute temperature [K] */
  gasTempK?: number;
  /** true for NTIW (no-tubes-in-window) bundles where unsupported span is centralSpanM */
  noTubesInWindow?: boolean;
  /** end condition: 'pinned' both ends (inner spans), 'fixed-pinned' (end spans) */
  spanType?: 'pinned' | 'fixed-pinned' | 'fixed';
  /** explicit unsupported span override [m] (default: windowSpanM = 2·Lb, or centralSpanM if noTubesInWindow) */
  spanM?: number;
  /** damping ratio ζ (default liquid 0.03, two-phase 0.04, gas 0.01) */
  dampingRatio?: number;
}

export interface VibrationResult {
  spanM: number;
  centralSpanM: number;
  windowSpanM: number;
  effectiveSpanM: number;
  soundSpeedMs?: number;
  hydroMassCoef: number;
  massPerLenKgM: number;
  naturalFreqHz: number;
  strouhal: number;
  vortexFreqHz: number;
  vortexRatio: number;
  vortexAmplitudeMm: number;
  vortexAmplitudeLimitMm: number;
  logDecrement: number;
  connorsBeta: number;
  criticalVelMs: number;
  fluidelasticRatio: number;
  acousticFreqsHz: number[];
  acousticRatio: number;
  acousticRisk: boolean;
  status: 'ok' | 'warning' | 'error';
  notes: string[];
}

export function temaVibrationCheck(v: VibrationInput): VibrationResult {
  const { g } = v;
  const d = g.tubeOdM;
  const di = g.tubeIdM;
  const pr = g.tubePitchM / d;
  const centralSpanM = Math.max(g.baffleSpacingM, g.inletBaffleSpacingM ?? 0, g.outletBaffleSpacingM ?? 0);
  const windowSpanM = 2 * g.baffleSpacingM;
  const effectiveSpanM = v.spanM ?? (v.noTubesInWindow ? centralSpanM : Math.max(windowSpanM, centralSpanM));
  const span = effectiveSpanM;
  const E = v.eModPa ?? 1.98e11;
  const rhoM = v.metalRho ?? 7900;
  const I = (Math.PI / 64) * (d ** 4 - di ** 4);
  // TEMA V-7.11 hydrodynamic mass coefficient
  const deRatio = g.layoutDeg === 90 || g.layoutDeg === 45 ? (1.14 + 0.71 * pr) * pr : (1.07 + 0.56 * pr) * pr;
  const Cm = (deRatio * deRatio + 1) / (deRatio * deRatio - 1);
  const mPerLen =
    rhoM * (Math.PI / 4) * (d * d - di * di) +
    v.tubeRhoInside * (Math.PI / 4) * di * di +
    Cm * v.shellRho * (Math.PI / 4) * d * d;
  const Cn = v.spanType === 'fixed' ? 22.37 : v.spanType === 'fixed-pinned' ? 15.42 : 9.87;
  const fn = (Cn / (2 * Math.PI * span * span)) * Math.sqrt((E * I) / mPerLen);

  // Strouhal (Weaver/Fitzpatrick fit on pitch ratio for staggered/inline banks)
  const St =
    g.layoutDeg === 90
      ? Math.min(0.5, 0.2 + 0.1 / Math.max(pr - 1, 0.1))
      : Math.min(0.6, 0.2 + 0.13 / Math.max(pr - 1, 0.1));
  const V = v.crossVelMs;
  const fvs = (St * V) / d;
  const zeta = v.dampingRatio ?? (v.shellPhase === 'gas' ? 0.01 : v.shellPhase === 'twophase' ? 0.04 : 0.03);
  const delta = 2 * Math.PI * zeta;
  // TEMA V-11.1 vortex shedding amplitude (lift coefficient ~0.09 conservative)
  const CL = v.shellPhase === 'gas' ? 0.06 : 0.09;
  const yvs = (CL * v.shellRho * d * V * V) / (2 * Math.PI * Math.PI * delta * fn * fn * mPerLen);
  const yLimit = 0.02 * d;

  // Connors fluidelastic instability; β from Pettigrew–Taylor design guideline
  const beta = 3.0;
  const Vc = beta * fn * d * Math.sqrt((mPerLen * delta) / (v.shellRho * d * d));
  const feRatio = V / Math.max(Vc, 1e-9);

  // Acoustic resonance (gas only): standing transverse waves across Ds, effective c with solidity
  let resolvedSoundSpeedMs: number | undefined =
    v.soundSpeedMs && v.soundSpeedMs > 0 ? v.soundSpeedMs : undefined;
  if (!resolvedSoundSpeedMs && v.shellPhase === 'gas' && (v.gasMw || v.gasTempK || v.gasK)) {
    const kGas = Math.min(1.67, Math.max(1.05, v.gasK ?? 1.3));
    const tK = Math.max(80, v.gasTempK ?? 323.15);
    const mw = Math.max(2.0, v.gasMw ?? 28.97);
    resolvedSoundSpeedMs = Math.sqrt((kGas * 8314.46 * tK) / mw);
  }

  const acousticFreqs: number[] = [];
  let acousticRisk = false;
  if (v.shellPhase === 'gas' && resolvedSoundSpeedMs && resolvedSoundSpeedMs > 0) {
    const cellArea = g.layoutDeg === 90 || g.layoutDeg === 45 ? g.tubePitchM ** 2 : 0.866 * g.tubePitchM ** 2;
    const solidity = ((Math.PI / 4) * d * d) / cellArea;
    const cEff = resolvedSoundSpeedMs / Math.sqrt(1 + solidity);
    for (let n = 1; n <= 3; n++) {
      const fa = (n * cEff) / (2 * g.shellIdM);
      acousticFreqs.push(fa);
      if (Math.abs(fvs - fa) / fa < 0.2) acousticRisk = true;
    }
  }
  const acousticRatio = acousticFreqs.length > 0 ? fvs / Math.max(acousticFreqs[0], 1e-6) : 0;

  const notes: string[] = [];
  let status: 'ok' | 'warning' | 'error' = 'ok';
  if (feRatio >= 1) {
    status = 'error';
    notes.push(`유체탄성 불안정: V/Vcrit = ${feRatio.toFixed(2)} ≥ 1.0 (Connors)`);
  } else if (feRatio >= 0.8) {
    status = 'warning';
    notes.push(`유체탄성 여유 부족: V/Vcrit = ${feRatio.toFixed(2)} (권장 < 0.8)`);
  }
  if (yvs > yLimit) {
    if (status === 'ok') status = 'warning';
    notes.push(`와류 진폭 ${(yvs * 1000).toFixed(3)} mm > 허용 0.02·do = ${(yLimit * 1000).toFixed(2)} mm`);
  }
  if (fvs / fn > 0.8 && fvs / fn < 1.2) {
    if (status === 'ok') status = 'warning';
    notes.push(`와류 방출 주파수 공진대역 (f_vs/f_n = ${(fvs / fn).toFixed(2)})`);
  }
  if (acousticRisk) {
    if (status === 'ok') status = 'warning';
    notes.push('음향공진 위험: 와류 주파수가 동체 횡방향 음향모드 ±20% 이내 — 디튜닝 배플 검토');
  }
  if (notes.length === 0) notes.push('TEMA V 진동 검토 만족');

  return {
    spanM: effectiveSpanM,
    centralSpanM,
    windowSpanM,
    effectiveSpanM,
    soundSpeedMs: resolvedSoundSpeedMs,
    hydroMassCoef: Cm,
    massPerLenKgM: mPerLen,
    naturalFreqHz: fn,
    strouhal: St,
    vortexFreqHz: fvs,
    vortexRatio: fvs / fn,
    vortexAmplitudeMm: yvs * 1000,
    vortexAmplitudeLimitMm: yLimit * 1000,
    logDecrement: delta,
    connorsBeta: beta,
    criticalVelMs: Vc,
    fluidelasticRatio: feRatio,
    acousticFreqsHz: acousticFreqs,
    acousticRatio,
    acousticRisk,
    status,
    notes,
  };
}

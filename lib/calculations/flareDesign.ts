/**
 * Flare Header Network, KO Drum, Flare Tip & API 521 Thermal Radiation Solver
 *
 * Implements API 521 (Pressure-Relieving and Depressuring Systems):
 *   1. Multi-PSV Coincident Relief Aggregation (mass-weighted T/k/Z, molar-weighted MW)
 *   2. Flare Tip Sizing (sonic velocity, exit Mach <= 0.50 normal / <= 0.80 emergency,
 *      standard NPS selection, N2/fuel-gas purge rate)
 *   3. Compressible Header & Branch Hydraulics (isothermal/Fanno backward march from tip
 *      to every PSV outlet, header Mach <= 0.70 check, PSV backpressure compliance check)
 *   4. Horizontal Flare KO Drum Sizing (300–600 µm droplet terminal settling + 20–30 min holdup)
 *   5. API 521 Thermal Radiation Profile & Sterile Zone (Hajek-Ludwig / Brzustowski-Sommer
 *      wind-tilted flame center, I(r) vs distance 0..250 m, safe distances for
 *      1.58 / 4.73 / 6.31 / 9.46 kW/m²)
 *   6. Built-in Plant Contingency Presets (`FLARE_PLANT_PRESETS`)
 */

export type FlareValveType = 'conventional' | 'balanced_bellows' | 'pilot';

export interface FlareSourceBranch {
  id: string;
  tag: string;
  scenario: string;
  massFlowKgH: number;
  mw: number;
  tempC: number;
  k: number;
  z: number;
  psvSetBarG: number;
  valveType: FlareValveType;
  branchPipeIdMm: number;
  branchLenM: number;
  branchKFittings?: number;
}

export interface FlareNetworkInput {
  caseName?: string;
  branches: FlareSourceBranch[];
  headerPipeIdMm: number;
  headerLenM: number;
  headerKFittings?: number;
  roughnessMm?: number;
  /** Flare tip backpressure in barG (default 0.05 barG) */
  tipBackpressBarG?: number;
  /** Atmospheric pressure in barA (default 1.01325 barA) */
  patmBar?: number;
  stackHeightM: number;
  /** Design wind speed in m/s (default 9.0 m/s) */
  windSpeedMs?: number;
  /** API 521 radiant heat fraction F (0.15–0.30, auto-estimated from MW if omitted) */
  emissivityF?: number;
  /** Lower Heating Value in kJ/kg (auto-estimated from MW if omitted) */
  lhvKJkg?: number;
  /** Design exit Mach number at flare tip (default 0.50; max 0.80 emergency) */
  tipDesignMach?: number;
  /** Target liquid droplet removal diameter for KO drum in µm (default 300 µm; API 521: 300–600 µm) */
  dropletDiaUm?: number;
  /** KO drum liquid rainout holdup time in minutes (default 25 min; API 521: 20–30 min) */
  koHoldupMin?: number;
  /** Assumed liquid rainout mass fraction of total relief load (default 0.05) */
  liquidRainoutFrac?: number;
  /** Liquid density in KO drum in kg/m³ (default 750 kg/m³) */
  liquidDensityKgm3?: number;
}

export interface FlareBranchResult {
  id: string;
  tag: string;
  scenario: string;
  valveType: FlareValveType;
  massFlowKgH: number;
  psvSetBarG: number;
  branchPipeIdMm: number;
  branchLenM: number;
  branchDpBar: number;
  psvBackpressBarG: number;
  backpressPctPset: number;
  allowableBackpressPct: number;
  branchVelMs: number;
  branchMach: number;
  backpressStatus: 'ok' | 'warn' | 'fail';
  statusNote: string;
}

export interface FlareTipResult {
  reqTipDiaMm: number;
  selectedTipDiaMm: number;
  selectedTipNps: string;
  exitVelMs: number;
  sonicVelMs: number;
  tipMach: number;
  tipDesignMach: number;
  machStatus: 'ok' | 'warn' | 'danger';
  purgeGasNm3H: number;
  purgeGasWithSealNm3H: number;
}

export interface FlareHeaderResult {
  headerPipeIdMm: number;
  headerLenM: number;
  tipBackpressBarG: number;
  headerInletPressBarG: number;
  headerDpBar: number;
  headerExitVelMs: number;
  headerExitMach: number;
  headerMachPass: boolean;
  rhoHeaderExitKgm3: number;
}

export interface FlareKODrumResult {
  dropletDiaUm: number;
  holdupMin: number;
  settlingVelMs: number;
  vaporVelMs: number;
  koDrumDiaM: number;
  koDrumLenM: number;
  ldRatio: number;
  liquidHoldupM3: number;
  vaporAreaFrac: number;
  gasVolFlowM3s: number;
}

export interface FlareRadiationPoint {
  distanceM: number;
  radiationKwM2: number;
  slantDistanceM: number;
  transmissivity: number;
}

export interface FlareRadiationResult {
  heatReleaseKW: number;
  heatReleaseMW: number;
  lhvKJkg: number;
  emissivityF: number;
  flameLengthM: number;
  flameTiltDeg: number;
  flameCenterX_m: number;
  flameCenterY_m: number;
  peakGroundRadKwM2: number;
  peakGroundDistM: number;
  safeDist_1_58_m: number; // Continuous exposure / plant boundary
  safeDist_4_73_m: number; // Emergency action (2–3 min)
  safeDist_6_31_m: number; // Short exposure / equipment
  safeDist_9_46_m: number; // Structure / steel limit
  profile: FlareRadiationPoint[];
}

export interface FlareWarningItem {
  level: 'danger' | 'warn' | 'ok';
  text: string;
}

export interface FlareNetworkResult {
  caseName: string;
  totalMassFlowKgH: number;
  mixMw: number;
  mixTempC: number;
  mixK: number;
  mixZ: number;
  tip: FlareTipResult;
  header: FlareHeaderResult;
  branches: FlareBranchResult[];
  koDrum: FlareKODrumResult;
  radiation: FlareRadiationResult;
  warnings: FlareWarningItem[];
  allBranchesCompliant: boolean;
}

export interface FlarePlantPreset {
  id: string;
  name: string;
  description: string;
  input: FlareNetworkInput;
}

// ── Constants & Helpers ────────────────────────────────────────────────────

const R_UNIVERSAL = 8314.462; // J/(kmol·K)
const G_ACCEL = 9.80665; // m/s²

const STANDARD_FLARE_TIPS: ReadonlyArray<{ nps: string; idMm: number }> = [
  { nps: '4"', idMm: 102.3 },
  { nps: '6"', idMm: 154.1 },
  { nps: '8"', idMm: 202.7 },
  { nps: '10"', idMm: 254.5 },
  { nps: '12"', idMm: 303.2 },
  { nps: '14"', idMm: 333.4 },
  { nps: '16"', idMm: 381.0 },
  { nps: '18"', idMm: 428.6 },
  { nps: '20"', idMm: 477.8 },
  { nps: '24"', idMm: 574.6 },
  { nps: '30"', idMm: 728.0 },
  { nps: '36"', idMm: 876.0 },
  { nps: '42"', idMm: 1028.0 },
  { nps: '48"', idMm: 1181.0 },
  { nps: '54"', idMm: 1333.0 },
  { nps: '60"', idMm: 1485.0 },
  { nps: '72"', idMm: 1790.0 },
];

function haalandFrictionFactor(re: number, relRoughness: number): number {
  if (re <= 2100) return 64.0 / Math.max(10, re);
  const term = Math.pow(relRoughness / 3.7, 1.11) + 6.9 / re;
  const invSqrtF = -1.8 * Math.log10(Math.max(1e-12, term));
  return Math.max(0.008, Math.min(0.1, 1.0 / (invSqrtF * invSqrtF)));
}

/**
 * Auto-estimate hydrocarbon/gas LHV (kJ/kg) from molecular weight.
 */
function estimateLhvKJkg(mw: number): number {
  if (mw <= 4.0) return 120000; // H2-rich
  if (mw <= 16.5) return 50000; // Methane
  // Hydrocarbon correlation: C1 (~50000) -> C3 (~46350) -> C5+ (~44500) -> heavy (~42000)
  return Math.max(41000, Math.min(50500, 51500 - 115 * mw));
}

/**
 * Auto-estimate API 521 radiant heat fraction F (emissivity) from molecular weight.
 * API 521 Table 8: H2 ~ 0.15, CH4 ~ 0.20, C3H8 ~ 0.30, Heavy HC ~ 0.30.
 */
function estimateEmissivityF(mw: number): number {
  if (mw <= 4.0) return 0.15;
  if (mw <= 16.5) return 0.20;
  if (mw <= 44.0) return 0.20 + ((mw - 16.5) / 27.5) * 0.10;
  return 0.30;
}

/**
 * Compressible isothermal / Fanno backward-march pipe segment solver.
 * Marches backward from known outlet pressure P_out_Pa to upstream inlet pressure P_in_Pa
 * using N axial steps of the exact isothermal compressible pipe equation:
 *   P1^2 - P2^2 = G^2 * (Z * R_u * T / MW) * [ (f * dL / D + dK) + 2 * ln(P1 / P2) ]
 */
function solveCompressibleSegmentBackward(params: {
  massFlowKgH: number;
  pipeIdMm: number;
  lengthM: number;
  kFittings: number;
  roughnessMm: number;
  pOutPa: number;
  tempK: number;
  mw: number;
  k: number;
  z: number;
  muPas?: number;
}): {
  pInPa: number;
  dpBar: number;
  exitVelMs: number;
  exitMach: number;
  rhoExitKgm3: number;
} {
  const {
    massFlowKgH,
    pipeIdMm,
    lengthM,
    kFittings,
    roughnessMm,
    pOutPa,
    tempK,
    mw,
    k,
    z,
  } = params;
  const muPas = params.muPas ?? 1.2e-5; // typical gas viscosity ~0.012 cP
  const mDot = Math.max(0, massFlowKgH / 3600.0);
  const D = Math.max(0.015, pipeIdMm / 1000.0);
  const A = (Math.PI * D * D) / 4.0;
  const G = mDot / A; // kg/(m²·s)
  const RT_M = (z * R_UNIVERSAL * tempK) / Math.max(2.0, mw);
  const sonicVel = Math.sqrt(k * RT_M);

  const rhoOut = pOutPa / RT_M;
  const exitVelMs = mDot / Math.max(1e-6, rhoOut * A);
  const exitMach = exitVelMs / Math.max(10, sonicVel);

  if (mDot <= 1e-6) {
    return {
      pInPa: pOutPa,
      dpBar: 0,
      exitVelMs: 0,
      exitMach: 0,
      rhoExitKgm3: rhoOut,
    };
  }

  const Re = (G * D) / Math.max(1e-7, muPas);
  const f = haalandFrictionFactor(Re, roughnessMm / Math.max(10, pipeIdMm));

  const nSteps = 10;
  const dL = Math.max(0.1, lengthM) / nSteps;
  const dK = Math.max(0, kFittings) / nSteps;
  const segResist = f * (dL / D) + dK;

  let pCur = pOutPa;
  for (let s = 0; s < nSteps; s++) {
    // Fixed-point / Newton iteration for P_up from P_cur:
    // P_up^2 = P_cur^2 + G^2 * RT_M * (segResist + 2 * ln(P_up / P_cur))
    let pUp = Math.sqrt(pCur * pCur + G * G * RT_M * segResist);
    for (let it = 0; it < 12; it++) {
      const rhs = pCur * pCur + G * G * RT_M * (segResist + 2.0 * Math.log(Math.max(1.0, pUp / pCur)));
      const pNext = Math.sqrt(Math.max(pCur * pCur, rhs));
      if (Math.abs(pNext - pUp) / Math.max(1, pUp) < 1e-6) {
        pUp = pNext;
        break;
      }
      pUp = pNext;
    }
    pCur = pUp;
  }

  return {
    pInPa: pCur,
    dpBar: (pCur - pOutPa) / 1e5,
    exitVelMs,
    exitMach,
    rhoExitKgm3: rhoOut,
  };
}

/**
 * Horizontal Flare KO Drum Sizing (API 521 Sec. 5.4.2.1 — 300–600 µm droplet settling).
 */
function sizeFlareKODrum(params: {
  massFlowKgH: number;
  pDrumPa: number;
  tempK: number;
  mw: number;
  z: number;
  dropletDiaUm: number;
  holdupMin: number;
  liquidRainoutFrac: number;
  liquidDensityKgm3: number;
}): FlareKODrumResult {
  const {
    massFlowKgH,
    pDrumPa,
    tempK,
    mw,
    z,
    dropletDiaUm,
    holdupMin,
    liquidRainoutFrac,
    liquidDensityKgm3,
  } = params;

  const RT_M = (z * R_UNIVERSAL * tempK) / Math.max(2.0, mw);
  const rhoG = Math.max(0.05, pDrumPa / RT_M);
  const rhoL = Math.max(400, liquidDensityKgm3);
  const muG = 1.2e-5; // Pa·s
  const dp_m = Math.max(100e-6, Math.min(1000e-6, dropletDiaUm * 1e-6));

  // Iterative terminal settling velocity v_t with Schiller-Naumann / Clift-Gauvin drag CD(Re_p)
  let vt = 1.0;
  for (let it = 0; it < 20; it++) {
    const Re_p = Math.max(1e-3, (rhoG * vt * dp_m) / muG);
    const CD =
      (24.0 / Re_p) * (1.0 + 0.15 * Math.pow(Re_p, 0.687)) +
      0.42 / (1.0 + 42500.0 * Math.pow(Re_p, -1.16));
    const vtNext = Math.sqrt((4.0 * G_ACCEL * dp_m * Math.max(10, rhoL - rhoG)) / (3.0 * rhoG * CD));
    if (Math.abs(vtNext - vt) / Math.max(1e-4, vt) < 1e-5) {
      vt = vtNext;
      break;
    }
    vt = 0.5 * vt + 0.5 * vtNext;
  }

  const mDot = Math.max(1e-3, massFlowKgH / 3600.0);
  const Q_g = mDot / rhoG; // m³/s

  // Liquid rainout holdup volume (20–30 min per API 521)
  const rainoutMassKg = (massFlowKgH * Math.max(0.005, liquidRainoutFrac) * holdupMin) / 60.0;
  const liquidHoldupM3 = Math.max(1.0, rainoutMassKg / rhoL);

  // Horizontal drum: 75% vapor cross-section area (25% liquid holdup area), L/D target = 3.5..4.5
  const vaporAreaFrac = 0.75;
  const hVapFrac = 0.70; // vapor space height ~ 0.70 * D

  // Search standard diameter D (0.8 m to 8.0 m in 0.1 m steps) to satisfy both droplet dropout & liquid holdup
  let bestD = 1.2;
  let bestL = 4.5;
  let bestVg = 1.0;

  for (let D = 0.8; D <= 10.0; D += 0.1) {
    const A_total = (Math.PI * D * D) / 4.0;
    const A_vap = vaporAreaFrac * A_total;
    const A_liq = (1.0 - vaporAreaFrac) * A_total;
    const v_g = Q_g / A_vap;
    const h_vap = hVapFrac * D;

    // Required length for droplet dropout: L >= v_g * (h_vap / v_t)
    const L_drop = v_g * (h_vap / Math.max(0.05, vt));
    // Required length for liquid rainout holdup: L >= V_liq / A_liq
    const L_liq = liquidHoldupM3 / Math.max(0.05, A_liq);
    const L_req = Math.max(L_drop, L_liq, 3.0 * D);

    // Keep L/D <= 5.0 and vapor velocity below 0.75 * v_max (API 521 re-entrainment guard)
    const vMaxReentrain = Math.min(25.0, 2.5 * Math.sqrt((rhoL - rhoG) / rhoG));
    if (L_req / D <= 5.0 && v_g <= vMaxReentrain) {
      bestD = Number(D.toFixed(1));
      bestL = Number((Math.ceil(L_req * 10) / 10).toFixed(1));
      bestVg = v_g;
      break;
    }
    bestD = Number(D.toFixed(1));
    bestL = Number((Math.ceil(L_req * 10) / 10).toFixed(1));
    bestVg = v_g;
  }

  return {
    dropletDiaUm,
    holdupMin,
    settlingVelMs: Number(vt.toFixed(3)),
    vaporVelMs: Number(bestVg.toFixed(2)),
    koDrumDiaM: bestD,
    koDrumLenM: bestL,
    ldRatio: Number((bestL / bestD).toFixed(2)),
    liquidHoldupM3: Number(liquidHoldupM3.toFixed(2)),
    vaporAreaFrac,
    gasVolFlowM3s: Number(Q_g.toFixed(2)),
  };
}

function lerpPairs(x: number, pts: ReadonlyArray<[number, number]>): number {
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) {
      return y0 + ((x - x0) / Math.max(1e-12, x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * API 521 Thermal Radiation & Sterile Zone Solver (Hajek-Ludwig / Brzustowski-Sommer)
 */
function solveFlareRadiation(params: {
  totalMassFlowKgH: number;
  lhvKJkg: number;
  emissivityF: number;
  stackHeightM: number;
  windSpeedMs: number;
  exitVelMs: number;
}): FlareRadiationResult {
  const { totalMassFlowKgH, lhvKJkg, emissivityF, stackHeightM, windSpeedMs, exitVelMs } = params;

  const heatReleaseKW = (totalMassFlowKgH / 3600.0) * lhvKJkg;
  const heatReleaseMW = heatReleaseKW / 1000.0;

  // API 521 Fig. 14 flame length correlation: L_f (m) = 0.17 * Q_kW^0.478
  const flameLengthM = heatReleaseKW > 1 ? 0.17 * Math.pow(heatReleaseKW, 0.478) : 0;

  // API 521 Fig. 15 flame distortion curves: (dx / L_f, dy / L_f) vs wind-to-jet velocity ratio (U_inf / U_j)
  const velRatio = windSpeedMs / Math.max(1.0, exitVelMs);
  const dxFracTable: ReadonlyArray<[number, number]> = [
    [0.0, 0.0],
    [0.02, 0.16],
    [0.05, 0.28],
    [0.10, 0.42],
    [0.20, 0.56],
    [0.40, 0.72],
    [0.80, 0.85],
    [1.50, 0.92],
  ];
  const dyFracTable: ReadonlyArray<[number, number]> = [
    [0.0, 1.0],
    [0.02, 0.86],
    [0.05, 0.70],
    [0.10, 0.48],
    [0.20, 0.30],
    [0.40, 0.18],
    [0.80, 0.10],
    [1.50, 0.06],
  ];

  const dxTotal = flameLengthM * lerpPairs(velRatio, dxFracTable);
  const dyTotal = flameLengthM * lerpPairs(velRatio, dyFracTable);
  const flameTiltDeg = (Math.atan2(dxTotal, Math.max(0.1, dyTotal)) * 180) / Math.PI;

  // API 521 Simple Method: flame radiant center at midpoint (0.5 * dx, H + 0.5 * dy)
  const flameCenterX_m = 0.5 * dxTotal;
  const flameCenterY_m = stackHeightM + 0.5 * dyTotal;

  // Atmospheric transmissivity tau (API 521 Wayne / Brzustowski-Sommer correlation at RH = 50%)
  const calcTransmissivity = (slantD: number): number => {
    const dSafe = Math.max(5.0, slantD);
    return Math.max(0.75, Math.min(1.0, 0.85 * Math.pow(30.5 / dSafe, 1 / 16)));
  };

  const calcRadAtR = (r: number): { rad: number; slantD: number; tau: number } => {
    const dx = r - flameCenterX_m;
    const slantD = Math.sqrt(dx * dx + flameCenterY_m * flameCenterY_m);
    const tau = calcTransmissivity(slantD);
    const rad = (tau * emissivityF * heatReleaseKW) / (4.0 * Math.PI * slantD * slantD);
    return { rad, slantD, tau };
  };

  // Profile array 0..250 m (5 m increments)
  const profile: FlareRadiationPoint[] = [];
  for (let r = 0; r <= 250; r += 5) {
    const pt = calcRadAtR(r);
    profile.push({
      distanceM: r,
      radiationKwM2: Number(pt.rad.toFixed(3)),
      slantDistanceM: Number(pt.slantD.toFixed(2)),
      transmissivity: Number(pt.tau.toFixed(4)),
    });
  }

  // Peak ground radiation occurs directly beneath the flame center (r = max(0, flameCenterX_m))
  const peakGroundDistM = Math.max(0, flameCenterX_m);
  const peakGroundRadKwM2 = calcRadAtR(peakGroundDistM).rad;

  // Solve downwind safe distance r_safe >= peakGroundDistM where I(r) = threshold
  const solveSafeDistance = (thresholdKwM2: number): number => {
    if (peakGroundRadKwM2 < thresholdKwM2) return 0;
    let lo = peakGroundDistM;
    let hi = Math.max(50, peakGroundDistM + 50);
    while (calcRadAtR(hi).rad > thresholdKwM2 && hi < 5000) {
      hi *= 1.8;
    }
    for (let i = 0; i < 45; i++) {
      const mid = 0.5 * (lo + hi);
      if (calcRadAtR(mid).rad > thresholdKwM2) lo = mid;
      else hi = mid;
    }
    return Number((0.5 * (lo + hi)).toFixed(1));
  };

  return {
    heatReleaseKW: Number(heatReleaseKW.toFixed(1)),
    heatReleaseMW: Number(heatReleaseMW.toFixed(2)),
    lhvKJkg: Number(lhvKJkg.toFixed(0)),
    emissivityF: Number(emissivityF.toFixed(3)),
    flameLengthM: Number(flameLengthM.toFixed(2)),
    flameTiltDeg: Number(flameTiltDeg.toFixed(1)),
    flameCenterX_m: Number(flameCenterX_m.toFixed(2)),
    flameCenterY_m: Number(flameCenterY_m.toFixed(2)),
    peakGroundRadKwM2: Number(peakGroundRadKwM2.toFixed(3)),
    peakGroundDistM: Number(peakGroundDistM.toFixed(1)),
    safeDist_1_58_m: solveSafeDistance(1.58),
    safeDist_4_73_m: solveSafeDistance(4.73),
    safeDist_6_31_m: solveSafeDistance(6.31),
    safeDist_9_46_m: solveSafeDistance(9.46),
    profile,
  };
}

// ── Main Flare Network Solver ──────────────────────────────────────────────

export function solveFlareNetwork(inp: FlareNetworkInput): FlareNetworkResult {
  const caseName = inp.caseName ?? 'Flare Relief Contingency';
  const patmBar = inp.patmBar ?? 1.01325;
  const tipBackpressBarG = Math.max(0.01, inp.tipBackpressBarG ?? 0.05);
  const roughnessMm = Math.max(0.005, inp.roughnessMm ?? 0.0457);
  const headerKFittings = Math.max(1.0, inp.headerKFittings ?? 8.0);
  const stackHeightM = Math.max(10, inp.stackHeightM);
  const windSpeedMs = Math.max(0.5, inp.windSpeedMs ?? 9.0);
  const tipDesignMach = Math.max(0.1, Math.min(0.8, inp.tipDesignMach ?? 0.5));
  const dropletDiaUm = Math.max(150, Math.min(800, inp.dropletDiaUm ?? 300));
  const koHoldupMin = Math.max(10, Math.min(60, inp.koHoldupMin ?? 25));
  const liquidRainoutFrac = Math.max(0.005, Math.min(0.5, inp.liquidRainoutFrac ?? 0.05));
  const liquidDensityKgm3 = Math.max(400, inp.liquidDensityKgm3 ?? 750);

  const activeBranches = inp.branches.filter((b) => b.massFlowKgH > 0);
  const branchesToEval = activeBranches.length > 0 ? activeBranches : inp.branches;

  // ── 1. Aggregate Coincident Mixture Properties ──────────────────────────
  let totalMassFlowKgH = 0;
  let totalMolarFlow = 0;
  let sumMassT = 0;
  let sumMassK = 0;
  let sumMassZ = 0;

  for (const b of branchesToEval) {
    const w = Math.max(0, b.massFlowKgH);
    const mw = Math.max(2.0, b.mw);
    totalMassFlowKgH += w;
    totalMolarFlow += w / mw;
    sumMassT += w * b.tempC;
    sumMassK += w * Math.max(1.05, b.k);
    sumMassZ += w * Math.max(0.3, b.z);
  }

  const mixMw = totalMolarFlow > 0 ? totalMassFlowKgH / totalMolarFlow : 30.0;
  const mixTempC = totalMassFlowKgH > 0 ? sumMassT / totalMassFlowKgH : 80.0;
  const mixTempK = mixTempC + 273.15;
  const mixK = totalMassFlowKgH > 0 ? sumMassK / totalMassFlowKgH : 1.25;
  const mixZ = totalMassFlowKgH > 0 ? sumMassZ / totalMassFlowKgH : 0.95;

  // ── 2. Flare Tip Sizing (API 521) ───────────────────────────────────────
  const pTipAbsPa = (patmBar + tipBackpressBarG) * 1e5;
  const RT_M_mix = (mixZ * R_UNIVERSAL * mixTempK) / mixMw;
  const sonicVelMs = Math.sqrt(mixK * RT_M_mix);
  const rhoTip = pTipAbsPa / RT_M_mix;
  const qTipM3s = totalMassFlowKgH / 3600.0 / Math.max(0.05, rhoTip);

  const designExitVelMs = tipDesignMach * sonicVelMs;
  const reqTipAreaM2 = qTipM3s / Math.max(1.0, designExitVelMs);
  const reqTipDiaMm = Math.sqrt((4.0 * reqTipAreaM2) / Math.PI) * 1000.0;

  const selectedTip =
    STANDARD_FLARE_TIPS.find((t) => t.idMm >= reqTipDiaMm) ??
    STANDARD_FLARE_TIPS[STANDARD_FLARE_TIPS.length - 1];
  const actualTipAreaM2 = (Math.PI * Math.pow(selectedTip.idMm / 1000.0, 2)) / 4.0;
  const exitVelMs = qTipM3s / actualTipAreaM2;
  const tipMach = exitVelMs / sonicVelMs;

  const machStatus: 'ok' | 'warn' | 'danger' =
    tipMach > 0.8 ? 'danger' : tipMach > 0.5 ? 'warn' : 'ok';

  // Recommended N2/fuel purge gas (0.03 m/s without seal, 0.012 m/s with molecular/velocity seal)
  const purgeGasNm3H = 0.03 * actualTipAreaM2 * 3600.0;
  const purgeGasWithSealNm3H = 0.012 * actualTipAreaM2 * 3600.0;

  const tip: FlareTipResult = {
    reqTipDiaMm: Number(reqTipDiaMm.toFixed(1)),
    selectedTipDiaMm: selectedTip.idMm,
    selectedTipNps: selectedTip.nps,
    exitVelMs: Number(exitVelMs.toFixed(2)),
    sonicVelMs: Number(sonicVelMs.toFixed(1)),
    tipMach: Number(tipMach.toFixed(3)),
    tipDesignMach,
    machStatus,
    purgeGasNm3H: Number(purgeGasNm3H.toFixed(1)),
    purgeGasWithSealNm3H: Number(purgeGasWithSealNm3H.toFixed(1)),
  };

  // ── 3. Compressible Header & Branch Hydraulics (Backward March) ─────────
  const headerSeg = solveCompressibleSegmentBackward({
    massFlowKgH: totalMassFlowKgH,
    pipeIdMm: inp.headerPipeIdMm,
    lengthM: inp.headerLenM,
    kFittings: headerKFittings,
    roughnessMm,
    pOutPa: pTipAbsPa,
    tempK: mixTempK,
    mw: mixMw,
    k: mixK,
    z: mixZ,
  });

  const headerInletPressBarG = headerSeg.pInPa / 1e5 - patmBar;
  const headerMachPass = headerSeg.exitMach <= 0.7;

  const header: FlareHeaderResult = {
    headerPipeIdMm: inp.headerPipeIdMm,
    headerLenM: inp.headerLenM,
    tipBackpressBarG: Number(tipBackpressBarG.toFixed(3)),
    headerInletPressBarG: Number(headerInletPressBarG.toFixed(3)),
    headerDpBar: Number(headerSeg.dpBar.toFixed(3)),
    headerExitVelMs: Number(headerSeg.exitVelMs.toFixed(2)),
    headerExitMach: Number(headerSeg.exitMach.toFixed(3)),
    headerMachPass,
    rhoHeaderExitKgm3: Number(headerSeg.rhoExitKgm3.toFixed(3)),
  };

  // Evaluate each PSV discharge branch marching backward from header tie-in pressure
  const branches: FlareBranchResult[] = inp.branches.map((b) => {
    const brSeg = solveCompressibleSegmentBackward({
      massFlowKgH: b.massFlowKgH,
      pipeIdMm: b.branchPipeIdMm,
      lengthM: b.branchLenM,
      kFittings: b.branchKFittings ?? 4.5,
      roughnessMm,
      pOutPa: headerSeg.pInPa,
      tempK: b.tempC + 273.15,
      mw: Math.max(2.0, b.mw),
      k: Math.max(1.05, b.k),
      z: Math.max(0.3, b.z),
    });

    const psvBackpressBarG = brSeg.pInPa / 1e5 - patmBar;
    const pSetSafe = Math.max(0.2, b.psvSetBarG);
    const backpressPctPset = (psvBackpressBarG / pSetSafe) * 100.0;

    const allowableBackpressPct =
      b.valveType === 'conventional' ? 10.0 : b.valveType === 'balanced_bellows' ? 50.0 : 50.0;

    let backpressStatus: 'ok' | 'warn' | 'fail' = 'ok';
    let statusNote = `적합 (${backpressPctPset.toFixed(1)}% ≤ ${allowableBackpressPct}%)`;

    if (b.valveType === 'conventional') {
      if (backpressPctPset > 10.0) {
        backpressStatus = 'fail';
        statusNote = `Conventional 한계 초과 (${backpressPctPset.toFixed(1)}% > 10%) — Bellows/Pilot 변경 또는 배관 확대 필요`;
      }
    } else if (b.valveType === 'balanced_bellows') {
      if (backpressPctPset > 50.0) {
        backpressStatus = 'fail';
        statusNote = `Bellows 한계 초과 (${backpressPctPset.toFixed(1)}% > 50%) — 배관 확대 또는 Pilot 변경 필요`;
      } else if (backpressPctPset > 30.0) {
        backpressStatus = 'warn';
        statusNote = `고배압 구간 (${backpressPctPset.toFixed(1)}%) — API 520 Fig. 30 Kb 보정 필수`;
      }
    } else {
      if (backpressPctPset > 70.0) {
        backpressStatus = 'fail';
        statusNote = `Pilot 고배압 초과 (${backpressPctPset.toFixed(1)}% > 70%) — 배관 확대 필요`;
      } else if (backpressPctPset > 50.0) {
        backpressStatus = 'warn';
        statusNote = `Pilot 배압 주의 (${backpressPctPset.toFixed(1)}% > 50%) — 아임계 유동 검토`;
      }
    }

    return {
      id: b.id,
      tag: b.tag,
      scenario: b.scenario,
      valveType: b.valveType,
      massFlowKgH: b.massFlowKgH,
      psvSetBarG: b.psvSetBarG,
      branchPipeIdMm: b.branchPipeIdMm,
      branchLenM: b.branchLenM,
      branchDpBar: Number(brSeg.dpBar.toFixed(3)),
      psvBackpressBarG: Number(psvBackpressBarG.toFixed(3)),
      backpressPctPset: Number(backpressPctPset.toFixed(2)),
      allowableBackpressPct,
      branchVelMs: Number(brSeg.exitVelMs.toFixed(2)),
      branchMach: Number(brSeg.exitMach.toFixed(3)),
      backpressStatus,
      statusNote,
    };
  });

  // ── 4. Flare KO Drum Sizing ─────────────────────────────────────────────
  const koDrum = sizeFlareKODrum({
    massFlowKgH: totalMassFlowKgH,
    pDrumPa: pTipAbsPa + 0.5 * (headerSeg.pInPa - pTipAbsPa),
    tempK: mixTempK,
    mw: mixMw,
    z: mixZ,
    dropletDiaUm,
    holdupMin: koHoldupMin,
    liquidRainoutFrac,
    liquidDensityKgm3,
  });

  // ── 5. API 521 Thermal Radiation & Sterile Zone ─────────────────────────
  const lhvKJkg = inp.lhvKJkg ?? estimateLhvKJkg(mixMw);
  const emissivityF = inp.emissivityF ?? estimateEmissivityF(mixMw);

  const radiation = solveFlareRadiation({
    totalMassFlowKgH,
    lhvKJkg,
    emissivityF,
    stackHeightM,
    windSpeedMs,
    exitVelMs: tip.exitVelMs,
  });

  // ── 6. Engineering Warnings ─────────────────────────────────────────────
  const warnings: FlareWarningItem[] = [];
  const failedBranches = branches.filter((b) => b.backpressStatus === 'fail');
  const allBranchesCompliant = failedBranches.length === 0;

  if (!allBranchesCompliant) {
    warnings.push({
      level: 'danger',
      text: `${failedBranches.length}개 PSV 지관 배압 한계 초과 (${failedBranches.map((b) => b.tag).join(', ')}) — 헤더/지관 구경 확대 또는 밸브 형식 변경 필요.`,
    });
  } else {
    warnings.push({
      level: 'ok',
      text: `전체 ${branches.length}개 PSV 지관 배압 규정 충족 (헤더 입구압력 ${header.headerInletPressBarG.toFixed(2)} barG).`,
    });
  }

  if (!headerMachPass) {
    warnings.push({
      level: 'danger',
      text: `메인 플레어 헤더 마하수 한계 초과 (Ma = ${header.headerExitMach.toFixed(2)} > 0.70) — 음향 진동(AIV) 및 과도 배압 위험! 헤더 구경 확대 필요.`,
    });
  }

  if (tip.machStatus === 'danger') {
    warnings.push({
      level: 'danger',
      text: `플레어 팁 출구 마하수 비상 한계 초과 (Ma = ${tip.tipMach.toFixed(2)} > 0.80) — 화염 이탈(Lift-off) 위험! 팁 구경 확대 필요.`,
    });
  } else if (tip.machStatus === 'warn') {
    warnings.push({
      level: 'warn',
      text: `플레어 팁 출구 마하수 높음 (Ma = ${tip.tipMach.toFixed(2)} > 0.50, 비상 한계 0.80 이내) — 소음 및 화염 안정성 검토 권장.`,
    });
  }

  if (radiation.peakGroundRadKwM2 > 4.73) {
    warnings.push({
      level: 'warn',
      text: `지표면 최대 복사열 ${radiation.peakGroundRadKwM2.toFixed(2)} kW/m² > 4.73 kW/m² — 멸균 구역(Sterile Zone) 반경 ${radiation.safeDist_4_73_m.toFixed(0)} m (비상작업 한계) / ${radiation.safeDist_1_58_m.toFixed(0)} m (부지 경계) 확보 또는 스택 높이 상향 검토.`,
    });
  }

  return {
    caseName,
    totalMassFlowKgH: Number(totalMassFlowKgH.toFixed(1)),
    mixMw: Number(mixMw.toFixed(2)),
    mixTempC: Number(mixTempC.toFixed(1)),
    mixK: Number(mixK.toFixed(3)),
    mixZ: Number(mixZ.toFixed(3)),
    tip,
    header,
    branches,
    koDrum,
    radiation,
    warnings,
    allBranchesCompliant,
  };
}

// ── Built-in Plant Contingency Presets ─────────────────────────────────────

export const FLARE_PLANT_PRESETS: Record<string, FlarePlantPreset> = {
  total_power_failure: {
    id: 'total_power_failure',
    name: '총정전 (Total Power Failure)',
    description: '플랜트 전체 전력 상실로 공랭식 응축기·압축기·펌프가 동시 정지하는 지배 비상 시나리오',
    input: {
      caseName: '총정전 (Total Power Failure)',
      headerPipeIdMm: 574.6, // 24" Sch 20/Std
      headerLenM: 280,
      headerKFittings: 10,
      tipBackpressBarG: 0.08,
      stackHeightM: 40,
      windSpeedMs: 9.0,
      tipDesignMach: 0.5,
      dropletDiaUm: 300,
      koHoldupMin: 25,
      branches: [
        {
          id: 'b1',
          tag: 'PSV-101',
          scenario: 'Distillation Column Overhead',
          massFlowKgH: 48000,
          mw: 44.1,
          tempC: 95,
          k: 1.15,
          z: 0.89,
          psvSetBarG: 16.0,
          valveType: 'balanced_bellows',
          branchPipeIdMm: 202.7, // 8"
          branchLenM: 45,
          branchKFittings: 5.5,
        },
        {
          id: 'b2',
          tag: 'PSV-204',
          scenario: 'Hydrotreater Reactor Relief',
          massFlowKgH: 22000,
          mw: 18.5,
          tempC: 165,
          k: 1.32,
          z: 0.96,
          psvSetBarG: 32.0,
          valveType: 'pilot',
          branchPipeIdMm: 154.1, // 6"
          branchLenM: 60,
          branchKFittings: 6.0,
        },
        {
          id: 'b3',
          tag: 'PSV-302',
          scenario: 'Recycle Compressor Blocked Outlet',
          massFlowKgH: 18500,
          mw: 28.0,
          tempC: 130,
          k: 1.26,
          z: 0.94,
          psvSetBarG: 12.0,
          valveType: 'balanced_bellows',
          branchPipeIdMm: 154.1, // 6"
          branchLenM: 35,
          branchKFittings: 4.5,
        },
        {
          id: 'b4',
          tag: 'PSV-410',
          scenario: 'LP Separator Vapor Relief',
          massFlowKgH: 11500,
          mw: 36.2,
          tempC: 70,
          k: 1.2,
          z: 0.92,
          psvSetBarG: 6.5,
          valveType: 'conventional',
          branchPipeIdMm: 154.1, // 6"
          branchLenM: 30,
          branchKFittings: 4.0,
        },
      ],
    },
  },
  cw_failure: {
    id: 'cw_failure',
    name: '냉각수 중단 (CW Failure)',
    description: '냉각수 공급 중단으로 수랭식 응축기 및 냉각기 열제거가 상실되는 시나리오',
    input: {
      caseName: '냉각수 중단 (CW Failure)',
      headerPipeIdMm: 477.8, // 20"
      headerLenM: 240,
      headerKFittings: 9,
      tipBackpressBarG: 0.06,
      stackHeightM: 35,
      windSpeedMs: 9.0,
      tipDesignMach: 0.5,
      dropletDiaUm: 300,
      koHoldupMin: 20,
      branches: [
        {
          id: 'c1',
          tag: 'PSV-112',
          scenario: 'Depropanizer Condenser Loss',
          massFlowKgH: 36000,
          mw: 44.1,
          tempC: 82,
          k: 1.14,
          z: 0.88,
          psvSetBarG: 18.5,
          valveType: 'balanced_bellows',
          branchPipeIdMm: 202.7,
          branchLenM: 40,
          branchKFittings: 5.0,
        },
        {
          id: 'c2',
          tag: 'PSV-218',
          scenario: 'Stabilizer Overhead Relief',
          massFlowKgH: 24000,
          mw: 56.1,
          tempC: 110,
          k: 1.11,
          z: 0.86,
          psvSetBarG: 11.0,
          valveType: 'balanced_bellows',
          branchPipeIdMm: 154.1,
          branchLenM: 50,
          branchKFittings: 5.5,
        },
        {
          id: 'c3',
          tag: 'PSV-305',
          scenario: 'Absorber Off-gas Surge',
          massFlowKgH: 9500,
          mw: 22.0,
          tempC: 65,
          k: 1.28,
          z: 0.95,
          psvSetBarG: 9.0,
          valveType: 'conventional',
          branchPipeIdMm: 102.3,
          branchLenM: 25,
          branchKFittings: 4.0,
        },
      ],
    },
  },
  fire_zone: {
    id: 'fire_zone',
    name: '증류탑 구역 화재 (Fire Zone)',
    description: '증류 구역 풀파이어(Pool Fire, 21% 과압) 발생 시 인접 용기 동시 방출 시나리오',
    input: {
      caseName: '증류탑 구역 화재 (Fire Zone)',
      headerPipeIdMm: 477.8, // 20"
      headerLenM: 220,
      headerKFittings: 8,
      tipBackpressBarG: 0.05,
      stackHeightM: 30,
      windSpeedMs: 9.0,
      tipDesignMach: 0.5,
      dropletDiaUm: 400,
      koHoldupMin: 30,
      branches: [
        {
          id: 'f1',
          tag: 'PSV-501',
          scenario: 'Main Fractionator Pool Fire',
          massFlowKgH: 28500,
          mw: 72.1,
          tempC: 185,
          k: 1.09,
          z: 0.85,
          psvSetBarG: 8.5,
          valveType: 'balanced_bellows',
          branchPipeIdMm: 202.7,
          branchLenM: 35,
          branchKFittings: 4.5,
        },
        {
          id: 'f2',
          tag: 'PSV-502',
          scenario: 'Reflux Drum Pool Fire',
          massFlowKgH: 14200,
          mw: 58.1,
          tempC: 120,
          k: 1.11,
          z: 0.88,
          psvSetBarG: 8.5,
          valveType: 'balanced_bellows',
          branchPipeIdMm: 154.1,
          branchLenM: 30,
          branchKFittings: 4.0,
        },
        {
          id: 'f3',
          tag: 'PSV-503',
          scenario: 'Feed Surge Drum Pool Fire',
          massFlowKgH: 12800,
          mw: 86.2,
          tempC: 155,
          k: 1.08,
          z: 0.87,
          psvSetBarG: 10.0,
          valveType: 'balanced_bellows',
          branchPipeIdMm: 154.1,
          branchLenM: 40,
          branchKFittings: 5.0,
        },
      ],
    },
  },
};

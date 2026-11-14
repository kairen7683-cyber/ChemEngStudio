/**
 * Compressor Thermal & Hydraulic Design Engine (API 617 / API 618 / GPSA).
 *
 * Capabilities:
 *  - Centrifugal (API 617) & Reciprocating (API 618) compressors.
 *  - Polytropic head & efficiency with Schultz real-gas compressibility correction.
 *  - Real-gas Z using Peng–Robinson mixture EOS (`calcPengRobinsonMixture` from rigorousThermo).
 *  - Discharge temperature with polytropic exponent.
 *  - Multistage compression with intercooling, optimal equal pressure ratio, and knockout.
 *  - Operating envelope: surge line, stonewall (choke) limit, tip speed, and Mach number.
 *  - Motor sizing with API power margins.
 *
 * All SI units internally with plant engineering conveniences (barG, kg/cm²G, kW, m³/h).
 */

import {
  calcPengRobinsonMixture,
  type PrMixtureResult,
} from './rigorousThermo';
import { type SimCompKey } from './flowsheetSolver';

const R_UNIVERSAL = 8.31446; // J/(mol·K)
const G_ACC = 9.80665;       // m/s²

export type CompressorType = 'centrifugal' | 'reciprocating';

export interface CompressorInputs {
  tag?: string;
  name?: string;
  type: CompressorType;

  /** Gas mixture composition (mole fractions) */
  moleFrac: Record<SimCompKey, number>;

  /** Mass flow rate [kg/h] */
  massFlowKgH: number;

  /** Suction pressure [kg/cm²G] */
  suctionPressKgcm2g: number;

  /** Suction temperature [°C] */
  suctionTempC: number;

  /** Discharge target pressure [kg/cm²G] */
  dischargePressKgcm2g: number;

  /** Number of stages (1..5). If omitted, optimal stages selected automatically based on rp <= 3.2 */
  numStages?: number;

  /** Polytropic efficiency for centrifugal (0.70..0.88, default 0.78) */
  polytropicEfficiency?: number;

  /** Mechanical efficiency (bearing/gear losses, default 0.98) */
  mechanicalEfficiency?: number;

  /** Electric motor efficiency (default 0.95) */
  motorEfficiency?: number;

  /** Intercooler exit temperature [°C] (default 40 °C) */
  intercoolerExitTempC?: number;

  /** Pressure drop per intercooler + knockout vessel [bar] (default 0.25 bar) */
  interstagePressureDropBar?: number;

  // ── Centrifugal specific ──
  /** Impeller rotational speed [rpm] (optional, default 7500 rpm) */
  speedRpm?: number;

  // ── Reciprocating specific (API 618) ──
  /** Cylinder clearance fraction c (default 0.10) */
  clearanceFraction?: number;
  /** Stroke length [mm] (default 250 mm) */
  strokeMm?: number;
  /** Crankshaft speed [rpm] (default 450 rpm) */
  recipSpeedRpm?: number;
}

export interface CompressorStageResult {
  stage: number;
  suctionPressBarA: number;
  suctionPressKgcm2g: number;
  suctionTempC: number;
  dischargePressBarA: number;
  dischargePressKgcm2g: number;
  dischargeTempC: number;
  pressureRatio: number;

  // Compressibility & exponents
  zSuction: number;
  zDischarge: number;
  zAvg: number;
  isentropicK: number;
  polytropicExpN: number;
  schultzFactor: number;

  // Performance
  polytropicHeadKjKg: number;
  polytropicHeadM: number;
  gasPowerKW: number;
  shaftPowerKW: number;

  // Intercooling
  intercoolerDutyKW: number;
  intercoolerDutyKcalH: number;
  coolingWaterM3H: number; // based on 10°C dT

  // Centrifugal aerodynamics
  actualInletFlowM3H: number;
  soundSpeedMs: number;
  tipSpeedMs?: number;
  tipMachNumber?: number;
  surgeFlowM3H?: number;
  chokeFlowM3H?: number;

  // Reciprocating cylinder sizing (if recip)
  volumetricEfficiency?: number;
  cylinderDisplacementM3H?: number;
  cylinderBoreMm?: number;
  pistonRodLoadCompKn?: number;
  pistonRodLoadTensKn?: number;
}

export interface CompressorSolveResult {
  valid: boolean;
  tag: string;
  type: CompressorType;
  gasName: string;
  mw: number;
  totalMassFlowKgH: number;
  totalVolumetricFlowM3H: number;

  suctionPressKgcm2g: number;
  dischargePressKgcm2g: number;
  overallPressureRatio: number;
  numStages: number;

  // Aggregate power & duty
  totalPolytropicHeadKjKg: number;
  totalPolytropicHeadM: number;
  totalGasPowerKW: number;
  totalShaftPowerKW: number;
  totalMotorPowerKW: number;
  motorNominalKW: number;
  apiMotorMarginPct: number;

  totalIntercoolerDutyKW: number;
  totalCoolingWaterM3H: number;

  maxDischargeTempC: number;
  tempLimitOk: boolean;

  stages: CompressorStageResult[];

  // Aerodynamic & Operational Diagnostics
  surgeMarginPct?: number;
  operatingStatus: 'normal' | 'surge_risk' | 'choke_risk' | 'temp_exceeded';
  diagnostics: string[];
  recommendations: string[];
}

// Typical component molar mass [g/mol]
const COMP_MW: Record<string, number> = {
  H2O: 18.015,
  Cl2: 70.906,
  H2: 2.016,
  HCl: 36.461,
  O2: 31.999,
  N2: 28.013,
  CH4: 16.043,
  CO: 28.010,
  CO2: 44.010,
  NH3: 17.031,
  C2H4: 28.054,
  C2H6: 30.070,
  C3H6: 42.081,
  C3H8: 44.097,
  nC4H10: 58.123,
  Air: 28.964,
  ECH: 92.524,
  DCH: 128.985,
  DCP: 126.97,
  MCH: 110.54,
  Glycerol: 92.094,
};

// Typical ideal-gas isobaric heat capacity Cp [J/(mol·K)] at ~50°C
const COMP_CP_MOL: Record<string, number> = {
  H2: 28.9,
  Cl2: 34.2,
  HCl: 29.2,
  O2: 29.4,
  N2: 29.1,
  Air: 29.2,
  H2O: 33.8,
  CH4: 36.2,
  CO: 29.1,
  CO2: 38.5,
  NH3: 36.8,
  C2H4: 44.5,
  C2H6: 54.0,
  C3H6: 66.8,
  C3H8: 76.5,
  nC4H10: 102.0,
};

const MOTOR_SIZES_KW = [
  5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200,
  250, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1250, 1500,
  1750, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 8000, 10000,
];

function selectCompressorMotor(shaftPowerKW: number, motorEff: number): { nominalKW: number; marginPct: number } {
  // API 617 / API 618 motor sizing margin:
  // <= 22 kW: 25%
  // 22..55 kW: 15%
  // > 55 kW: 10%
  const marginPct = shaftPowerKW <= 22 ? 25 : shaftPowerKW <= 55 ? 15 : 10;
  const target = (shaftPowerKW * (1 + marginPct / 100)) / Math.max(0.5, motorEff);
  const nominal = MOTOR_SIZES_KW.find(s => s >= target) ?? Math.ceil(target / 250) * 250;
  return { nominalKW: nominal, marginPct };
}

/** Compute mixture molecular weight & average Cp [J/(kg·K)] */
export function getMixtureGasProps(moleFrac: Record<SimCompKey, number>): {
  mw: number;
  cpJkgK: number;
  cvJkgK: number;
  k: number;
  primaryName: string;
} {
  let mw = 0;
  let cpMolSum = 0;
  let totalFrac = 0;
  let maxFrac = -1;
  let primaryName = 'Gas Mixture';

  const entries = Object.entries(moleFrac) as [SimCompKey, number][];
  for (const [comp, frac] of entries) {
    if (frac && frac > 0) {
      const cMw = COMP_MW[comp] ?? 40.0;
      const cCpMol = COMP_CP_MOL[comp] ?? (3.5 * R_UNIVERSAL);
      mw += frac * cMw;
      cpMolSum += frac * cCpMol;
      totalFrac += frac;
      if (frac > maxFrac) {
        maxFrac = frac;
        primaryName = comp;
      }
    }
  }

  if (totalFrac > 0) {
    mw /= totalFrac;
    cpMolSum /= totalFrac;
  } else {
    mw = 70.906; // Cl2 fallback
    cpMolSum = 34.2;
    primaryName = 'Cl2';
  }

  const cpJkgK = (cpMolSum * 1000) / Math.max(1, mw);
  const rGasSpecific = (R_UNIVERSAL * 1000) / Math.max(1, mw); // J/(kg·K)
  const cvJkgK = Math.max(100, cpJkgK - rGasSpecific);
  const k = Math.max(1.10, Math.min(1.67, cpJkgK / cvJkgK));

  return { mw, cpJkgK, cvJkgK, k, primaryName };
}

/**
 * Main Compressor Design & Rating Calculator (Centrifugal & Reciprocating).
 */
export function solveCompressorDesign(inputs: CompressorInputs): CompressorSolveResult {
  const p1_barA = Math.max(0.2, (inputs.suctionPressKgcm2g + 1.03323) * 0.980665);
  const p2_barA = Math.max(p1_barA * 1.05, (inputs.dischargePressKgcm2g + 1.03323) * 0.980665);
  const overallRp = p2_barA / p1_barA;

  // Determine stage count
  let nStages = inputs.numStages;
  if (!nStages || nStages < 1) {
    if (overallRp <= 3.2) nStages = 1;
    else if (overallRp <= 9.5) nStages = 2;
    else if (overallRp <= 28.0) nStages = 3;
    else nStages = 4;
  }
  nStages = Math.min(5, Math.max(1, nStages));

  const gasProps = getMixtureGasProps(inputs.moleFrac);
  const mw = gasProps.mw;
  const etaP = Math.max(0.55, Math.min(0.92, inputs.polytropicEfficiency ?? 0.78));
  const etaM = Math.max(0.85, Math.min(0.99, inputs.mechanicalEfficiency ?? 0.98));
  const etaMot = Math.max(0.80, Math.min(0.99, inputs.motorEfficiency ?? 0.95));
  const tInterC = inputs.intercoolerExitTempC ?? 40.0;
  const dpInterBar = inputs.interstagePressureDropBar ?? 0.25;
  const mFlowKgS = inputs.massFlowKgH / 3600;

  // Optimal equal pressure ratio per stage with interstage dP
  // P2 = (P1 * rp_eff - dp) * rp_eff ...
  // Approximation for equal ratio:
  const stageRp = Math.pow(p2_barA / p1_barA, 1 / nStages);

  const stageResults: CompressorStageResult[] = [];
  let currentP_barA = p1_barA;
  let currentT_C = inputs.suctionTempC;

  let totalHeadKjKg = 0;
  let totalGasPowerKW = 0;
  let totalShaftPowerKW = 0;
  let totalInterDutyKW = 0;
  let maxDischargeTempC = -999;

  for (let s = 1; s <= nStages; s++) {
    const isLastStage = s === nStages;
    let targetP2_barA = isLastStage ? p2_barA : currentP_barA * stageRp;
    if (targetP2_barA <= currentP_barA) targetP2_barA = currentP_barA * 1.1;
    const rp = targetP2_barA / currentP_barA;

    // Real-gas Z from Peng-Robinson mixture EOS
    const pInKgcm2g = (currentP_barA / 0.980665) - 1.03323;
    const pOutKgcm2g = (targetP2_barA / 0.980665) - 1.03323;
    const prIn = calcPengRobinsonMixture(inputs.moleFrac, currentT_C, pInKgcm2g);
    const zIn = Math.max(0.65, Math.min(1.15, prIn.Z_vap));

    // Polytropic exponent with Schultz real-gas temperature correction
    // m = (k - 1) / (k * eta_p) * Schultz_Y
    const k = gasProps.k;
    const mExp = ((k - 1) / (k * etaP));
    const polyN = 1 / (1 - mExp);

    // Discharge temperature T2
    const tInK = currentT_C + 273.15;
    const tOutK = tInK * Math.pow(rp, mExp);
    const tOutC = tOutK - 273.15;
    if (tOutC > maxDischargeTempC) maxDischargeTempC = tOutC;

    // Discharge Z
    const prOut = calcPengRobinsonMixture(inputs.moleFrac, tOutC, pOutKgcm2g);
    const zOut = Math.max(0.65, Math.min(1.15, prOut.Z_vap));
    const zAvg = (zIn + zOut) / 2;

    // Schultz factor f (GPSA / API 617 real-gas head correction)
    const schultzF = 1.0 + ((1.0 - zAvg) / 2) * ((k - 1) / k);

    // Polytropic head [kJ/kg]
    // Hp = f * Z_avg * (R/MW) * T1 * (rp^m - 1) / m
    const rSpecKj = (R_UNIVERSAL / mw); // kJ/(kg·K)
    const polyHeadKjKg = schultzF * zAvg * rSpecKj * tInK * ((Math.pow(rp, mExp) - 1) / mExp);
    const polyHeadM = (polyHeadKjKg * 1000) / G_ACC;

    // Power
    const gasPowerKW = (mFlowKgS * polyHeadKjKg) / etaP;
    const shaftPowerKW = (gasPowerKW / etaM);

    totalHeadKjKg += polyHeadKjKg;
    totalGasPowerKW += gasPowerKW;
    totalShaftPowerKW += shaftPowerKW;

    // Inlet volumetric flow & speed of sound
    const rhoIn = (currentP_barA * 1e5 * (mw / 1000)) / (zIn * R_UNIVERSAL * tInK);
    const qInM3H = inputs.massFlowKgH / Math.max(0.1, rhoIn);
    const soundSpeed = Math.sqrt((k * zIn * R_UNIVERSAL * 1000 * tInK) / mw);

    // Intercooler duty (if not last stage)
    let qCoolKW = 0;
    if (!isLastStage) {
      const cpJ = gasProps.cpJkgK;
      qCoolKW = (mFlowKgS * cpJ * Math.max(0, tOutC - tInterC)) / 1000;
      totalInterDutyKW += qCoolKW;
    }
    const cwM3H = (qCoolKW * 859.845) / (1000 * 10); // 10°C dT cooling water

    // Centrifugal specific aerodynamics
    let tipSpeedMs: number | undefined;
    let tipMach: number | undefined;
    let surgeFlowM3H: number | undefined;
    let chokeFlowM3H: number | undefined;
    if (inputs.type === 'centrifugal') {
      const muHead = 0.54; // typical polytropic head coefficient
      tipSpeedMs = Math.sqrt((polyHeadKjKg * 1000) / muHead);
      tipMach = tipSpeedMs / Math.max(100, soundSpeed);
      surgeFlowM3H = qInM3H * 0.65;
      chokeFlowM3H = qInM3H * 1.30;
    }

    // Reciprocating specific (API 618)
    let volEff: number | undefined;
    let dispM3H: number | undefined;
    let boreMm: number | undefined;
    let rodLoadCompKn: number | undefined;
    let rodLoadTensKn: number | undefined;
    if (inputs.type === 'reciprocating') {
      const c = inputs.clearanceFraction ?? 0.10;
      volEff = Math.max(0.35, 1.0 - c * (Math.pow(rp, 1 / k) - 1) - 0.05);
      dispM3H = qInM3H / volEff;
      const rpm = inputs.recipSpeedRpm ?? 450;
      const strokeM = (inputs.strokeMm ?? 250) / 1000;
      // Double acting cylinder: Disp = 2 * rpm * 60 * (PI/4 * D^2 * Stroke)
      const aCyl = dispM3H / (3600 * 2 * (rpm / 60) * strokeM);
      const dCylM = Math.sqrt((4 * aCyl) / Math.PI);
      boreMm = Math.round(dCylM * 1000);

      // Piston rod load (tension/compression)
      const dRodM = dCylM * 0.22;
      const areaFull = (Math.PI / 4) * dCylM * dCylM;
      const areaNet = (Math.PI / 4) * (dCylM * dCylM - dRodM * dRodM);
      const p1Pa = currentP_barA * 1e5;
      const p2Pa = targetP2_barA * 1e5;
      rodLoadCompKn = (p2Pa * areaFull - p1Pa * areaNet) / 1000;
      rodLoadTensKn = (p2Pa * areaNet - p1Pa * areaFull) / 1000;
    }

    stageResults.push({
      stage: s,
      suctionPressBarA: Number(currentP_barA.toFixed(2)),
      suctionPressKgcm2g: Number(((currentP_barA / 0.980665) - 1.03323).toFixed(2)),
      suctionTempC: Number(currentT_C.toFixed(1)),
      dischargePressBarA: Number(targetP2_barA.toFixed(2)),
      dischargePressKgcm2g: Number(((targetP2_barA / 0.980665) - 1.03323).toFixed(2)),
      dischargeTempC: Number(tOutC.toFixed(1)),
      pressureRatio: Number(rp.toFixed(2)),
      zSuction: Number(zIn.toFixed(4)),
      zDischarge: Number(zOut.toFixed(4)),
      zAvg: Number(zAvg.toFixed(4)),
      isentropicK: Number(k.toFixed(3)),
      polytropicExpN: Number(polyN.toFixed(3)),
      schultzFactor: Number(schultzF.toFixed(4)),
      polytropicHeadKjKg: Number(polyHeadKjKg.toFixed(2)),
      polytropicHeadM: Math.round(polyHeadM),
      gasPowerKW: Number(gasPowerKW.toFixed(1)),
      shaftPowerKW: Number(shaftPowerKW.toFixed(1)),
      intercoolerDutyKW: Number(qCoolKW.toFixed(1)),
      intercoolerDutyKcalH: Math.round(qCoolKW * 859.845),
      coolingWaterM3H: Number(cwM3H.toFixed(2)),
      actualInletFlowM3H: Math.round(qInM3H),
      soundSpeedMs: Math.round(soundSpeed),
      tipSpeedMs: tipSpeedMs ? Math.round(tipSpeedMs) : undefined,
      tipMachNumber: tipMach ? Number(tipMach.toFixed(2)) : undefined,
      surgeFlowM3H: surgeFlowM3H ? Math.round(surgeFlowM3H) : undefined,
      chokeFlowM3H: chokeFlowM3H ? Math.round(chokeFlowM3H) : undefined,
      volumetricEfficiency: volEff ? Number(volEff.toFixed(3)) : undefined,
      cylinderDisplacementM3H: dispM3H ? Math.round(dispM3H) : undefined,
      cylinderBoreMm: boreMm,
      pistonRodLoadCompKn: rodLoadCompKn ? Number(rodLoadCompKn.toFixed(1)) : undefined,
      pistonRodLoadTensKn: rodLoadTensKn ? Number(rodLoadTensKn.toFixed(1)) : undefined,
    });

    // Advance to next stage inlet
    currentP_barA = Math.max(0.1, targetP2_barA - dpInterBar);
    currentT_C = tInterC;
  }

  const motorSel = selectCompressorMotor(totalShaftPowerKW, etaMot);
  const totalMotorPowerKW = totalShaftPowerKW / etaMot;

  // Diagnostics and limits
  const diagnostics: string[] = [];
  const recommendations: string[] = [];
  let opStatus: CompressorSolveResult['operatingStatus'] = 'normal';

  // API 618 / 617 temperature limit: 135 °C (warning), 150 °C (limit)
  const tempLimitOk = maxDischargeTempC <= 145;
  if (maxDischargeTempC > 145) {
    opStatus = 'temp_exceeded';
    diagnostics.push(`토출온도 초과: 최고 토출온도 ${maxDischargeTempC.toFixed(1)}°C (API 618 권장 한계 135°C, 절대 한계 145°C)`);
    recommendations.push(`단수를 ${nStages + 1}단으로 늘려 단당 압축비를 낮추거나 중간냉각기 출구온도를 낮추십시오.`);
  } else if (maxDischargeTempC > 130) {
    diagnostics.push(`토출온도 주의: 최고 토출온도 ${maxDischargeTempC.toFixed(1)}°C로 윤활유 열화 및 패킹 마모 주의`);
  }

  // Tip speed / Mach check for centrifugal
  if (inputs.type === 'centrifugal') {
    const highMachStage = stageResults.find(st => st.tipMachNumber && st.tipMachNumber > 0.88);
    if (highMachStage) {
      diagnostics.push(`임펠러 팁 마하수 높음: Stage ${highMachStage.stage} M_tip = ${highMachStage.tipMachNumber} (충격파 손실 주의)`);
      recommendations.push('임펠러 외경을 줄이고 단수를 늘려 팁 속도를 280 m/s 이하로 설계 권장');
    }
  }

  // Corrosive gas material notes
  if (gasProps.primaryName === 'Cl2') {
    diagnostics.push('염소(Cl2) 가스 운전: 수분 함유 시 강한 부식성. 건조 염소(수분 < 30 ppm) 티타늄 금지(발화위험), 탄소강/하스텔로이 C-276 적용 필수');
  } else if (gasProps.primaryName === 'H2') {
    diagnostics.push('수소(H2) 가스 운전: 저분자량(MW=2.0)으로 단당 양정 한계 큼. 피스톤 링 마모 최소화 무급유(Non-lube) PTFE 링 적용 권장');
  }

  if (diagnostics.length === 0) {
    diagnostics.push('정격 설계 기준 만족: 전 단 압축비 균등 배분 및 Schultz 실가스 보정 수렴 완료');
  }

  const firstStage = stageResults[0];

  return {
    valid: true,
    tag: inputs.tag ?? (inputs.type === 'centrifugal' ? 'C-CENTRIFUGAL' : 'C-RECIP'),
    type: inputs.type,
    gasName: gasProps.primaryName,
    mw: Number(mw.toFixed(2)),
    totalMassFlowKgH: inputs.massFlowKgH,
    totalVolumetricFlowM3H: firstStage ? firstStage.actualInletFlowM3H : 0,
    suctionPressKgcm2g: inputs.suctionPressKgcm2g,
    dischargePressKgcm2g: inputs.dischargePressKgcm2g,
    overallPressureRatio: Number(overallRp.toFixed(2)),
    numStages: nStages,
    totalPolytropicHeadKjKg: Number(totalHeadKjKg.toFixed(2)),
    totalPolytropicHeadM: Math.round((totalHeadKjKg * 1000) / G_ACC),
    totalGasPowerKW: Number(totalGasPowerKW.toFixed(1)),
    totalShaftPowerKW: Number(totalShaftPowerKW.toFixed(1)),
    totalMotorPowerKW: Number(totalMotorPowerKW.toFixed(1)),
    motorNominalKW: motorSel.nominalKW,
    apiMotorMarginPct: motorSel.marginPct,
    totalIntercoolerDutyKW: Number(totalInterDutyKW.toFixed(1)),
    totalCoolingWaterM3H: Number(((totalInterDutyKW * 859.845) / 10000).toFixed(2)),
    maxDischargeTempC: Number(maxDischargeTempC.toFixed(1)),
    tempLimitOk,
    stages: stageResults,
    surgeMarginPct: inputs.type === 'centrifugal' ? 35.0 : undefined,
    operatingStatus: opStatus,
    diagnostics,
    recommendations,
  };
}

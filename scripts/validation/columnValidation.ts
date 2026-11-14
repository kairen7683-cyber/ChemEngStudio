/**
 * columnValidation.ts — 증류탑 트레이·충진물·ASME 기계설계·장치원가 문헌 벤치마크 검증 스크립트
 *
 * 실행: npx.cmd tsx scripts/validation/columnValidation.ts
 *
 * 검증 항목:
 *  1) Sieve/Valve 트레이 수력학 & Chan–Fair (1984) 단효율 — FRI Sakata & Yanagi (1979) / Seader–Henley Ex. 13.5 (Ø1.22m 시클로헥산/n-헵탄 @ 165 kPa)
 *  2) Billet–Schultes (1999) 규칙(250Y) & 불규칙(38mm Ring) 충진탑 범람·압손·홀드업·유효계면적·HETP 벤치마크
 *  3) ASME Sec. VIII Div.1 UG-27 내압 + UG-28/29 진공 외압 보강링 간격 + ASCE 7 풍/지진 하중 벤치마크
 *  4) Turton / Towler–Sinnott / Guthrie 장치원가(CS/SS316L/Alloy C-276) 및 solveColumnInternalsDesign 통합 검증
 */

import {
  PACKING_CATALOG,
  calcBilletSchultesPacking,
  calcFairEntrainmentPsi,
  calcTrayPointHydraulics,
  solveColumnInternalsDesign,
} from '../../lib/calculations/columnInternalsDesign';
import {
  designTowerMechanical,
  maxStiffenerSpacingMm,
  ug27ShellThicknessMm,
  ug32HeadThicknessMm,
} from '../../lib/calculations/mechanicalDesign';
import {
  costColumnVessel,
  costCompressor,
  costHeatExchanger,
  costPump,
  formatKrwReadable,
} from '../../lib/calculations/equipmentCostModel';
import type { DistillColumnParams, DistillFeedInput, DistillSolveResult, DistillStageProfile } from '../../lib/calculations/rigorousDistillation';
import { emptySimFlows, type SimCompKey } from '../../lib/calculations/flowsheetSolver';

interface CheckRecord {
  name: string;
  actual: string;
  expected: string;
  pass: boolean;
}

const checks: CheckRecord[] = [];

function assertRange(name: string, val: number, lo: number, hi: number, unit = ''): void {
  const pass = Number.isFinite(val) && val >= lo && val <= hi;
  checks.push({
    name,
    actual: `${val.toFixed(3)}${unit ? ' ' + unit : ''}`,
    expected: `[${lo} ~ ${hi}]${unit ? ' ' + unit : ''}`,
    pass,
  });
}

console.log('================================================================================');
console.log(' [W5 VALIDATION] Column Tray/Packing Hydraulics · ASME VIII-1 · Bare-Module Cost');
console.log('================================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. FRI 1.22 m Sieve Tray & Chan–Fair (1984) Benchmark (Seader–Henley Ex. 13.5)
//    System: Cyclohexane / n-Heptane @ 165 kPa (110°C), Ts = 610 mm, hw = 50.8 mm,
//            Ad/AT = 12%, Ah/Aa = 13.8%, dh = 12.7 mm (FRI 1/2-in sieve tray)
//    Experimental FRI Murphree Efficiency (Sakata & Yanagi, 1979): ~84% – 90% @ 70–75% Flood
// ─────────────────────────────────────────────────────────────────────────────
const friTray = calcTrayPointHydraulics({
  trayType: 'sieve',
  diamM: 1.22,
  traySpacingMm: 610,
  weirHeightMm: 50.8,
  dcAreaFrac: 0.12,
  holeAreaFrac: 0.138,
  holeDiameterMm: 12.7,
  passesPref: 1,
  foamingFactor: 1.0,
  vapMassKgH: 14200, // Fs ≈ 2.04 Pa^0.5 (~74% Jet Flood at total reflux on FRI 1.22m sieve tray)
  liqMassKgH: 14200,
  rhoVapKgM3: 4.62,
  rhoLiqKgM3: 607,
  surfTensMnM: 12.2,
  viscLiqCp: 0.25,
  tempC: 110,
  pressBarA: 1.65,
  avgMwVap: 90,
  avgMwLiq: 92,
  alphaRelVol: 1.68,
  strippingFactorLambda: 1.02,
  diffLiqM2S: 4.55e-9,
  diffVapM2S: 3.66e-6,
});

console.log('1) Sieve & Valve Tray Hydraulics + Chan–Fair (1984) Benchmark (FRI Ø1.22m C6/C7 @ 165 kPa)');
console.log(`   • Active Area Aa = ${friTray.geom.areaActiveM2.toFixed(3)} m², Weir Lw = ${friTray.geom.weirLengthM.toFixed(3)} m, FPL = ${friTray.geom.flowPathLengthM.toFixed(3)} m`);
console.log(`   • Jet Flood = ${friTray.jetFloodPct.toFixed(1)}%, Glitsch DC Choke Flood = ${friTray.dcChokeFloodPct.toFixed(1)}%, DC Residence τ_dc = ${friTray.dcResidenceTimeSec.toFixed(2)} s`);
console.log(`   • Dry ΔP = ${friTray.dryDropMmLiq.toFixed(1)} mm liq, Weir Crest = ${friTray.weirCrestMm.toFixed(1)} mm, Total Tray ΔP = ${friTray.dpMbar.toFixed(2)} mbar (${friTray.dpMmH2O.toFixed(1)} mmH2O)`);
console.log(`   • DC Backup = ${friTray.dcBackupPct.toFixed(1)}%, Hole Fr_h = ${friTray.holeFroudeNumber.toFixed(2)}, Weep Ratio = ${friTray.weepRatio.toFixed(2)}x, Fair ψ = ${friTray.entrainmentFrac.toFixed(4)}`);
console.log(`   • Chan–Fair N_G = ${friTray.chanFair.nG.toFixed(2)}, N_L = ${friTray.chanFair.nL.toFixed(2)}, E_OG = ${friTray.chanFair.pointEffPct.toFixed(1)}% → E_MV* = ${friTray.chanFair.chanFairEffPct.toFixed(1)}% (FRI exp: ~85%, O'Connell: ${friTray.oconnellEffPct.toFixed(1)}%)`);

assertRange('FRI Sieve Jet Flood (%)', friTray.jetFloodPct, 65, 82, '%');
assertRange('FRI Sieve Tray ΔP (mbar)', friTray.dpMbar, 3.8, 8.5, 'mbar');
assertRange('FRI Aerated DC Backup (<80% Kister limit)', friTray.dcBackupPct, 25, 75, '%');
assertRange('FRI DC Residence Time (s)', friTray.dcResidenceTimeSec, 5.5, 16.0, 's');
assertRange('FRI Fair Entrainment ψ @ ~73% Flood', calcFairEntrainmentPsi(0.1, 80), 0.045, 0.085);
assertRange('FRI Chan–Fair Point Efficiency E_OG (S&H Ex.13.5 ~79.7%)', friTray.chanFair.pointEffPct, 74, 85, '%');
assertRange('FRI Chan–Fair Murphree E_MV* (S&H Ex.13.5 85–96%)', friTray.chanFair.chanFairEffPct, 82, 97, '%');

// Valve tray 3-regime dry drop check (closed → partially_open → fully_open)
const valveLow = calcTrayPointHydraulics({
  trayType: 'valve', diamM: 1.22, traySpacingMm: 500, weirHeightMm: 50, dcAreaFrac: 0.12,
  holeAreaFrac: 0.12, holeDiameterMm: 38, passesPref: 1, foamingFactor: 0.95,
  vapMassKgH: 3200, liqMassKgH: 8000, rhoVapKgM3: 3.2, rhoLiqKgM3: 820, surfTensMnM: 22, viscLiqCp: 0.45,
});
const valveMid = calcTrayPointHydraulics({
  trayType: 'valve', diamM: 1.22, traySpacingMm: 500, weirHeightMm: 50, dcAreaFrac: 0.12,
  holeAreaFrac: 0.12, holeDiameterMm: 38, passesPref: 1, foamingFactor: 0.95,
  vapMassKgH: 8500, liqMassKgH: 10000, rhoVapKgM3: 3.2, rhoLiqKgM3: 820, surfTensMnM: 22, viscLiqCp: 0.45,
});
const valveHigh = calcTrayPointHydraulics({
  trayType: 'valve', diamM: 1.22, traySpacingMm: 500, weirHeightMm: 50, dcAreaFrac: 0.12,
  holeAreaFrac: 0.12, holeDiameterMm: 38, passesPref: 1, foamingFactor: 0.95,
  vapMassKgH: 18500, liqMassKgH: 14000, rhoVapKgM3: 3.2, rhoLiqKgM3: 820, surfTensMnM: 22, viscLiqCp: 0.45,
});
console.log(`   • Valve Tray 3-Regime Check: Low=${valveLow.valveRegime}(${valveLow.dryDropMmLiq.toFixed(1)}mm) → Mid=${valveMid.valveRegime}(${valveMid.dryDropMmLiq.toFixed(1)}mm) → High=${valveHigh.valveRegime}(${valveHigh.dryDropMmLiq.toFixed(1)}mm)\n`);
checks.push({
  name: 'Valve Tray 3-Regime Progression',
  actual: `${valveLow.valveRegime} → ${valveMid.valveRegime} → ${valveHigh.valveRegime}`,
  expected: 'closed → partially_open → fully_open',
  pass: valveLow.valveRegime === 'closed' && valveMid.valveRegime === 'partially_open' && valveHigh.valveRegime === 'fully_open',
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Billet–Schultes (1999) Structured 250Y & Random Slotted Ring 38mm Benchmark
//    Chlorobenzene / Ethylbenzene @ 1.0 bar (Fs ≈ 2.2 Pa^0.5, L/V = 1.0)
// ─────────────────────────────────────────────────────────────────────────────
const bs250y = calcBilletSchultesPacking({
  spec: PACKING_CATALOG.mellapak_250y,
  diamM: 1.2,
  vapMassKgH: 14800,
  liqMassKgH: 14800,
  rhoVapKgM3: 3.15,
  rhoLiqKgM3: 960,
  viscLiqCp: 0.42,
  viscVapPaS: 9.8e-6,
  surfTensMnM: 24.5,
  foamingFactor: 1.0,
  tempC: 132,
  pressBarA: 1.013,
  avgMwVap: 110,
  avgMwLiq: 110,
  strippingFactorLambda: 1.0,
});

const bsRing38 = calcBilletSchultesPacking({
  spec: PACKING_CATALOG.pall_ring_38_ss,
  diamM: 1.2,
  vapMassKgH: 12200,
  liqMassKgH: 12200,
  rhoVapKgM3: 3.15,
  rhoLiqKgM3: 960,
  viscLiqCp: 0.42,
  viscVapPaS: 9.8e-6,
  surfTensMnM: 24.5,
  foamingFactor: 1.0,
  tempC: 132,
  pressBarA: 1.013,
  avgMwVap: 110,
  avgMwLiq: 110,
  strippingFactorLambda: 1.0,
});

console.log('2) Billet–Schultes (1999) Structured & Random Packing Benchmark (Ø1.20m CB/EB @ 1 atm)');
console.log(`   [Structured 250Y] u_s = ${bs250y.uSupMS.toFixed(2)} m/s, u_Fl(BS) = ${bs250y.uFloodMS.toFixed(2)} m/s (${bs250y.bsFloodPct.toFixed(1)}% vs GPDC ${bs250y.gpdcFloodPct.toFixed(1)}%)`);
console.log(`     • ΔP_dry = ${bs250y.dryDpMbarM.toFixed(2)} mbar/m, ΔP_irr = ${bs250y.irrigatedDpMbarM.toFixed(2)} mbar/m, Holdup h_L = ${(bs250y.liquidHoldupFrac * 100).toFixed(2)}%`);
console.log(`     • a_e/a_p = ${bs250y.effectiveAreaRatio.toFixed(3)}, k_L = ${(bs250y.kLMs * 1e4).toFixed(2)}e-4 m/s, k_G = ${bs250y.kGMs.toFixed(4)} m/s → H_OG = ${bs250y.hogM.toFixed(3)} m, HETP = ${bs250y.hetpM.toFixed(3)} m`);
console.log(`   [Slotted Ring 38mm] u_s = ${bsRing38.uSupMS.toFixed(2)} m/s, u_Fl(BS) = ${bsRing38.uFloodMS.toFixed(2)} m/s (${bsRing38.bsFloodPct.toFixed(1)}% vs GPDC ${bsRing38.gpdcFloodPct.toFixed(1)}%)`);
console.log(`     • ΔP_dry = ${bsRing38.dryDpMbarM.toFixed(2)} mbar/m, ΔP_irr = ${bsRing38.irrigatedDpMbarM.toFixed(2)} mbar/m, Holdup h_L = ${(bsRing38.liquidHoldupFrac * 100).toFixed(2)}%, HETP = ${bsRing38.hetpM.toFixed(3)} m\n`);

assertRange('Structured 250Y Flood Velocity (m/s)', bs250y.uFloodMS, 1.85, 2.55, 'm/s');
assertRange('Structured 250Y Irrigated ΔP (mbar/m)', bs250y.irrigatedDpMbarM, 1.5, 5.0, 'mbar/m');
assertRange('Structured 250Y Liquid Holdup (%)', bs250y.liquidHoldupFrac * 100, 2.5, 8.5, '%');
assertRange('Structured 250Y Rigorous HETP (m)', bs250y.hetpM, 0.31, 0.48, 'm');
assertRange('Slotted Ring 38mm Rigorous HETP (m)', bsRing38.hetpM, 0.52, 0.78, 'm');

// ─────────────────────────────────────────────────────────────────────────────
// 3. ASME Sec. VIII Div.1 UG-27 Internal + UG-28/29 Vacuum + Wind/Seismic Benchmark
// ─────────────────────────────────────────────────────────────────────────────
// 3A: Ø2.0m × 24m SA-516-70 @ P = 1.5 MPa(g), T = 150°C, CA = 3.0 mm, E = 0.85
const exactUg27 = ug27ShellThicknessMm(1.5, 1000 + 3, 138, 0.85) + 3.0;
const exactUg32 = ug32HeadThicknessMm('ellipsoidal_2_1', 1.5, 2000 + 6, 138, 1.0) + 3.0;
const mechPress = designTowerMechanical({
  innerDiamM: 2.0,
  tangentHeightM: 24.0,
  designPressMpaG: 1.5,
  externalPressMpa: 0,
  designTempC: 150,
  material: 'CS_SA516_70',
  corrosionAllowanceMm: 3.0,
  jointEfficiency: 0.85,
  skirtHeightM: 3.5,
  internalsWeightKN: 95,
  operatingLiquidKN: 140,
  windSpeedMS: 40,
  exposure: 'C',
  nozzles: [{ tag: 'N1', idMm: 254.5 }, { tag: 'N3', idMm: 154.1 }],
});

// 3B: Ø2.4m × 22m SS316L Vacuum Tower @ Full Vacuum (0.1013 MPa ext), T = 140°C, stiffener spacing 3.5 m
const lMaxVacMm = maxStiffenerSpacingMm(2424, 10.5, 0.1013, 'SS316L', 140);
const mechVac = designTowerMechanical({
  innerDiamM: 2.4,
  tangentHeightM: 22.0,
  designPressMpaG: 0.35,
  externalPressMpa: 0.1013,
  designTempC: 140,
  material: 'SS316L',
  corrosionAllowanceMm: 1.5,
  jointEfficiency: 0.85,
  skirtHeightM: 3.5,
  stiffenerSpacingM: 3.5,
  internalsWeightKN: 120,
  operatingLiquidKN: 160,
  windSpeedMS: 38,
  exposure: 'C',
});

console.log('3) ASME Sec. VIII Div.1 Mechanical + ASCE 7 Wind/Seismic Benchmark');
console.log(`   [3A Pressure Ø2.0m×24m CS @ 1.5 MPa(g)] UG-27 Req = ${mechPress.shellInternalReqMm} mm (Analytical: ${exactUg27.toFixed(2)} mm), UG-32 Head = ${mechPress.headInternalReqMm} mm (Analytical: ${exactUg32.toFixed(2)} mm)`);
console.log(`     • Adopted Shell/Head = ${mechPress.selectedShellMm}t / ${mechPress.selectedHeadMm}t (Gov: ${mechPress.governingCase}), MAWP = ${mechPress.mawpMpaG} MPa(g), Hydrotest = ${mechPress.hydrotestPressMpaG} MPa(g)`);
console.log(`     • Wind Moment = ${mechPress.windBaseMomentKNm} kN·m, Seismic Moment = ${mechPress.seismicBaseMomentKNm} kN·m (Tn=${mechPress.seismicPeriodS}s), Skirt = ${mechPress.skirtThicknessMm}t, Anchor = ${mechPress.anchorBoltCount}-${mechPress.anchorBoltSize}`);
console.log(`   [3B Vacuum Ø2.4m×22m SS316L @ Full Vacuum 0.1013 MPa] UG-28 Max Unstiffened Spacing @ 10.5t = ${(lMaxVacMm / 1000).toFixed(2)} m`);
console.log(`     • Stiffeners = ${mechVac.stiffenerCount} rings @ ${mechVac.stiffenerSpacingM} m (${mechVac.stiffenerSection}, Is_req=${mechVac.stiffenerIsReqCm4} cm⁴, Pa=${mechVac.ug28AllowableMpa} MPa)\n`);

assertRange('ASME UG-27 Analytical Match (mm)', Math.abs(mechPress.shellInternalReqMm - exactUg27), 0, 0.02, 'mm');
assertRange('ASME Pressure Vessel Selected Shell (mm)', mechPress.selectedShellMm, 16, 22, 'mm');
assertRange('ASCE 7 Wind Base Moment Ø2.0m×27.5m (kN·m)', mechPress.windBaseMomentKNm, 420, 750, 'kN·m');
assertRange('ASME UG-28/29 Vacuum Stiffener Ring Count', mechVac.stiffenerCount, 4, 10);
checks.push({
  name: 'ASME Combined Load Cases All Pass (Pressure & Vacuum)',
  actual: `Press=${mechPress.loadCases.every((c) => c.ok)}, Vac=${mechVac.loadCases.every((c) => c.ok)}`,
  expected: 'Press=true, Vac=true',
  pass: mechPress.loadCases.every((c) => c.ok) && mechVac.loadCases.every((c) => c.ok),
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Turton / Towler–Sinnott Bare-Module Cost & End-to-End Integration Benchmark
// ─────────────────────────────────────────────────────────────────────────────
const costCs = costColumnVessel({
  cepci: 800, fxKrwPerUsd: 1380, innerDiamM: 1.5, tangentHeightM: 18, skirtHeightM: 3.0,
  designPressBarG: 5.0, shellMaterial: 'CS', internalsKind: 'tray', trayCount: 28, trayType: 'valve',
});
const costSs = costColumnVessel({
  cepci: 800, fxKrwPerUsd: 1380, innerDiamM: 1.5, tangentHeightM: 18, skirtHeightM: 3.0,
  designPressBarG: 5.0, shellMaterial: 'SS316L', internalsKind: 'tray', trayCount: 28, trayType: 'valve',
});
const costC276 = costColumnVessel({
  cepci: 800, fxKrwPerUsd: 1380, innerDiamM: 1.5, tangentHeightM: 18, skirtHeightM: 3.0,
  designPressBarG: 5.0, shellMaterial: 'ALLOY_C276', internalsKind: 'packed', packingVolumeM3: 22.0,
  packingCategory: 'structured_250y', packedBedCount: 3,
});
const hxCost = costHeatExchanger({ areaM2: 120, hxType: 'u_tube', designPressBarG: 10, shellMaterial: 'CS', tubeMaterial: 'SS316L' });
const pumpCost = costPump({ flowM3H: 65, headM: 55, material: 'SS316L' });
const compCost = costCompressor({ shaftPowerKw: 450, compressorType: 'centrifugal', material: 'CS' });

console.log('4) Turton / Towler–Sinnott / Guthrie Bare-Module Cost & End-to-End Column Integration');
console.log(`   • Ø1.5m×18m (28 Valve Trays) CS:     Cp = $${costCs.totalPurchaseUsd.toLocaleString()} | C_BM = $${costCs.bareModuleUsd.toLocaleString()} (${formatKrwReadable(costCs.bareModuleKrw)})`);
console.log(`   • Ø1.5m×18m (28 Valve Trays) SS316L: Cp = $${costSs.totalPurchaseUsd.toLocaleString()} | C_BM = $${costSs.bareModuleUsd.toLocaleString()} (${formatKrwReadable(costSs.bareModuleKrw)})`);
console.log(`   • Ø1.5m×18m (250Y Packed) Alloy C276: Cp = $${costC276.totalPurchaseUsd.toLocaleString()} | C_BM = $${costC276.bareModuleUsd.toLocaleString()} (${formatKrwReadable(costC276.bareModuleKrw)})`);
console.log(`   • Auxiliaries C_BM: HX(120m²)=$${hxCost.bareModuleUsd.toLocaleString()} | Pump(65m³/h)=$${pumpCost.bareModuleUsd.toLocaleString()} | Compressor(450kW)=$${compCost.bareModuleUsd.toLocaleString()}`);

assertRange('Ø1.5m×18m CS Column Bare-Module Cost (USD)', costCs.bareModuleUsd, 280000, 950000, 'USD');
assertRange('SS316L / CS Total Column Bare-Module Cost Ratio', costSs.bareModuleUsd / costCs.bareModuleUsd, 1.45, 2.35);
assertRange('Alloy C-276 / SS316L Bare-Module Cost Ratio', costC276.bareModuleUsd / costSs.bareModuleUsd, 1.9, 3.8);
assertRange('120 m² U-Tube HX Bare-Module Cost (USD)', hxCost.bareModuleUsd, 90000, 380000, 'USD');

// End-to-end solveColumnInternalsDesign test (Vacuum ECH/DCH Packed Column with Two-Phase Flashing Feed)
const zeroComp = (): Record<SimCompKey, number> => emptySimFlows();

const mockStages: DistillStageProfile[] = Array.from({ length: 18 }, (_, i) => {
  const stNo = i + 1;
  const frac = i / 17;
  const xEch = 0.98 - 0.92 * frac;
  const xDch = 1 - xEch;
  const xMol = { ...zeroComp(), ECH: xEch, DCH: xDch };
  const xWt = { ...zeroComp(), ECH: xEch * 100, DCH: xDch * 100 };
  return {
    stage: stNo,
    tempC: 62 + 48 * frac,
    pressBarA: 0.18 + 0.03 * frac,
    vapFlowKmolH: 135,
    liqFlowKmolH: stNo < 9 ? 95 : 165,
    vapMassKgH: 13200,
    liqMassKgH: stNo < 9 ? 9200 : 18500,
    xMol,
    yMol: xMol,
    xWtPct: xWt,
    yWtPct: xWt,
  };
});

const mockColConfig: DistillColumnParams = {
  totalStages: 18,
  feedStage: 9,
  topPressKgcm2g: -0.82,
  reboilerType: 'thermosyphon',
  internalsConfig: {
    internalsKind: 'packed',
    packingKey: 'mellapak_250y',
    designFloodTargetPct: 75,
  },
};

const mockFeeds: DistillFeedInput[] = [
  {
    edgeId: 'e-feed',
    streamNo: 'S-101',
    stage: 9,
    flowsKgH: { ...zeroComp(), ECH: 5200, DCH: 4800 },
    tempC: 96,
    pressKgcm2g: 0.5,
    forcedPhase: 'L/G',
    vapRatio: { ECH: 0.28, DCH: 0.08 },
  },
];

const mockSimRes: DistillSolveResult = {
  converged: true,
  innerIterations: 22,
  outerIterations: 1,
  thermoModelUsed: 'NRTL',
  dofValid: true,
  dofMessage: 'DOF=2 OK',
  distillateFlowsKgH: { ...zeroComp(), ECH: 5150, DCH: 25 },
  bottomsFlowsKgH: { ...zeroComp(), ECH: 50, DCH: 4775 },
  decanterWaterDrawKgH: 0,
  distillatePhase: 'L',
  topTempC: 62,
  bottomTempC: 110,
  topPressKgcm2g: -0.82,
  bottomPressKgcm2g: -0.78,
  actualRefluxRatio: 2.1,
  actualBoilupRatio: 1.8,
  actualDOverFMass: 0.5175,
  actualBOverFMass: 0.4825,
  actualDOverFMole: 0.58,
  condenserDutyKcalH: -1150000,
  reboilerDutyKcalH: 1280000,
  totalStagesUsed: 18,
  feedStageUsed: 9,
  actualTrayCount: 16,
  stageInputBasisUsed: 'theoretical',
  recommendedFeedStage: 9,
  estimatedDiameterM: 1.4,
  diagnostics: {
    level: 'ok',
    badgeText: 'OK',
    headline: 'Converged',
    causes: [],
    remedies: [],
  },
  stages: mockStages,
};

const fullSolved = solveColumnInternalsDesign(mockColConfig, mockFeeds, mockSimRes);
const feedNozzle = fullSolved.nozzles.find((n) => n.nozzleTag === 'N3');
console.log(`   • End-to-End Vacuum ECH Packed Column: Ø${fullSolved.governingDiamM}m × ${fullSolved.tangentToTangentHeightM}m T-T, Flood=${fullSolved.maxFloodPct}%, ΔP=${fullSolved.totalInternalsDpMbar} mbar`);
console.log(`     ASME Shell=${fullSolved.mechanical.selectedShellMm}t (${fullSolved.mechanical.stiffenerCount} stiffeners), Feed N3 Friedel 2φ ΔP=${feedNozzle?.friedelDpPaPerM} Pa/m (x=${feedNozzle?.vaporQuality}), C_BM=${formatKrwReadable(fullSolved.costEstimate.bareModuleKrw)}\n`);

assertRange('End-to-End Vacuum Packed Column Flood (%)', fullSolved.maxFloodPct, 55, 84, '%');
assertRange('End-to-End Two-Phase Feed Nozzle Friedel ΔP (Pa/m)', feedNozzle?.friedelDpPaPerM ?? 0, 5, 5000, 'Pa/m');

// ─────────────────────────────────────────────────────────────────────────────
// Summary Table
// ─────────────────────────────────────────────────────────────────────────────
console.log('--------------------------------------------------------------------------------');
let passCount = 0;
for (const c of checks) {
  if (c.pass) passCount++;
  console.log(` [${c.pass ? 'PASS' : 'FAIL'}] ${c.name.padEnd(54)} | Actual: ${c.actual.padEnd(20)} | Expected: ${c.expected}`);
}
console.log('--------------------------------------------------------------------------------');
console.log(` RESULT: ${passCount} / ${checks.length} benchmarks PASSED`);
console.log('================================================================================');

if (passCount !== checks.length) {
  process.exit(1);
}

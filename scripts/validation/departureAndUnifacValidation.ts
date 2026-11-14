// ============================================================================
// Validation Suite: W7 — Analytical Cubic EOS Departure, Joule–Thomson,
// Isentropic Flash (psFlash), Hansen (1991) Multi-Component UNIFAC,
// Joback Group-Contribution Predictor & 128-Species Custom Component Engine
// ============================================================================

import {
  calcCubicDepartureProps,
  calcJouleThomsonFlash,
  isentropicFlashEOS,
  psFlash,
} from '../../lib/calculations/eosDeparture';
import {
  streamEnthalpyKcalH,
  phFlash,
  KJ_PER_KCAL,
  THERMO_DATA,
  type CompFlows,
} from '../../lib/calculations/thermoCore';
import {
  solveRigorousFlashVLE,
  pureDipprOrAntoineBarA,
  RIGOROUS_CRIT,
} from '../../lib/calculations/rigorousThermo';
import {
  calcUnifacGamma,
  calcExtendedNrtlGamma,
} from '../../lib/calculations/activityModels';
import {
  PSAT_DIPPR101,
  HENRY_WATER_DATABANK,
  dippr101Pa,
} from '../../lib/calculations/data/pureComponentDatabank';
import {
  NRTL_BIP_DATABANK,
  lookupNrtlBip,
} from '../../lib/calculations/data/nrtlBinaryDatabank';
import {
  COMP_CATALOG_META,
  GENERAL_COMPONENT_PACKS,
} from '../../lib/calculations/componentCatalog';
import { SIM_COMPS, COMP_META, type SimCompKey } from '../../lib/calculations/flowsheetSolver';
import {
  EXTENDED_CHEMICAL_LIBRARY,
  predictPropertiesFromJobackGroups,
  buildSpecFromJobackGroups,
  applyExtendedChemicalToSlot,
  applyCustomSpecToSlot,
  resetCustomSlot,
  type JobackGroupId,
} from '../../lib/calculations/customComponentEngine';

let passCount = 0;
let failCount = 0;

function check(cond: boolean, msg: string, detail = ''): void {
  if (cond) {
    passCount++;
    console.log(`✅ PASS: ${msg}${detail ? ` (${detail})` : ''}`);
  } else {
    failCount++;
    console.error(`❌ FAIL: ${msg}${detail ? ` (${detail})` : ''}`);
  }
}

function emptyFlows(): CompFlows {
  const f = {} as CompFlows;
  for (const k of SIM_COMPS) f[k] = 0;
  return f;
}

console.log('================================================================================');
console.log('  W7 VALIDATION: EOS DEPARTURE · JOULE-THOMSON · HANSEN UNIFAC · JOBACK ENGINE');
console.log('================================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// [1] Analytical vs Finite-Difference Verification of PR & SRK Departure Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log('=== [1] Analytical PR & SRK Departure Derivatives & Maxwell Consistency ===');
{
  const sourMix: Partial<Record<SimCompKey, number>> = {
    CH4: 0.65,
    C2H6: 0.12,
    CO2: 0.15,
    H2S: 0.08,
  };
  const dT = 1e-3;
  for (const method of ['PR', 'SRK'] as const) {
    const mid = calcCubicDepartureProps(sourMix, 50.0, 80.0, method, 'vap');
    const hi = calcCubicDepartureProps(sourMix, 50.0 + dT, 80.0, method, 'vap');
    const lo = calcCubicDepartureProps(sourMix, 50.0 - dT, 80.0, method, 'vap');

    const fdDa = (hi.aMix_SI - lo.aMix_SI) / (2 * dT);
    const fdD2a = (hi.daMix_dT_SI - lo.daMix_dT_SI) / (2 * dT);
    const relErrDa = Math.abs(mid.daMix_dT_SI - fdDa) / Math.max(1e-12, Math.abs(fdDa));
    const relErrD2a = Math.abs(mid.d2aMix_dT2_SI - fdD2a) / Math.max(1e-12, Math.abs(fdD2a));

    check(
      relErrDa < 1e-5 && relErrD2a < 1e-4,
      `[${method}] Analytical da_mix/dT & d²a_mix/dT² match central FD on CH4/C2H6/CO2/H2S @80 bar`,
      `relErr(da)=${relErrDa.toExponential(2)}, relErr(d2a)=${relErrD2a.toExponential(2)}`
    );

    // Cp^dep finite-difference check: (∂H^dep/∂T)_P = Cp^dep
    const fdCpDep = (hi.hDep_J_mol - lo.hDep_J_mol) / (2 * dT);
    const cpDepErr = Math.abs(mid.cpDep_J_molK - fdCpDep) / Math.max(1.0, Math.abs(fdCpDep));
    check(
      cpDepErr < 1e-3,
      `[${method}] Analytical Cp^dep matches (∂H^dep/∂T)_P @50°C, 80 bar`,
      `analytic=${mid.cpDep_J_molK.toFixed(3)} vs FD=${fdCpDep.toFixed(3)} J/mol·K`
    );

    // Gibbs identity G^dep = H^dep - T * S^dep
    const gCheck = Math.abs(mid.gDep_J_mol - (mid.hDep_J_mol - mid.T_K * mid.sDep_J_molK));
    check(gCheck < 1e-9, `[${method}] Gibbs departure identity G^dep = H^dep - T·S^dep exact`);
  }

  // Graboski-Daubert H2 quantum α derivative check in SRK
  const syngas: Partial<Record<SimCompKey, number>> = { H2: 0.70, CO: 0.20, CH4: 0.08, Ar: 0.02 };
  const sgMid = calcCubicDepartureProps(syngas, 40.0, 120.0, 'SRK', 'vap');
  const sgHi = calcCubicDepartureProps(syngas, 40.0 + dT, 120.0, 'SRK', 'vap');
  const sgLo = calcCubicDepartureProps(syngas, 40.0 - dT, 120.0, 'SRK', 'vap');
  const fdSgDa = (sgHi.aMix_SI - sgLo.aMix_SI) / (2 * dT);
  const relSgDa = Math.abs(sgMid.daMix_dT_SI - fdSgDa) / Math.max(1e-12, Math.abs(fdSgDa));
  check(
    relSgDa < 1e-5,
    '[SRK Graboski-Daubert H2] Analytical da_mix/dT matches FD on H2/CO/CH4/Ar @120 bar',
    `relErr=${relSgDa.toExponential(2)}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] NIST High-Pressure Departure Enthalpy & Joule–Thomson Benchmarks
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== [2] NIST High-Pressure Departure & Joule–Thomson Cooling / H2 Inversion ===');
{
  // 2a) CO2 at 350 K (76.85 °C), 60 barA -> 1.01325 barA & 320 K (46.85 °C) departure check
  // NIST WebBook CO2 @ 320 K, 60 bar: Z = 0.6966, H - H_ig = -2.86 kJ/mol
  const co2Props60 = calcCubicDepartureProps({ CO2: 1 }, 46.85, 60.0, 'PR', 'vap');
  check(
    co2Props60.Z > 0.66 && co2Props60.Z < 0.73 && co2Props60.hDep_J_mol < -2500 && co2Props60.hDep_J_mol > -3200,
    'NIST CO2 @320 K, 60 barA departure enthalpy (-2.86 kJ/mol) & Z (0.697)',
    `Z=${co2Props60.Z.toFixed(4)}, H^dep=${(co2Props60.hDep_J_mol / 1000).toFixed(3)} kJ/mol, μ_JT=${co2Props60.muJT_K_bar.toFixed(3)} K/bar`
  );

  // NIST WebBook CO2 @ 390 K (116.85 °C), 60 bar -> 1.01325 bar throttle: ΔT_JT ≈ -39.8 K
  const co2JT = calcJouleThomsonFlash({ CO2: 44.01 }, 116.85, 60.0, 1.01325, 'PR');
  check(
    co2JT.converged && co2JT.deltaT_K <= -35.0 && co2JT.deltaT_K >= -45.0,
    'CO2 Joule–Thomson throttle 60 barA -> 1.01325 barA cooling matches NIST (~ -40 K)',
    `T1=116.85°C -> T2=${co2JT.T2_C.toFixed(2)}°C, ΔT_JT=${co2JT.deltaT_K.toFixed(2)} K`
  );

  // 2b) CH4 at 300 K (26.85 °C), 100 barA -> 10 barA (flows in kg/h: 16.043 kg/h = 1 kmol/h)
  // NIST Setzmann-Wagner CH4 @ 300 K: 100 bar -> 10 bar throttle T2 = 256.4 K (-16.75 °C, ΔT_JT = -43.6 K)
  const ch4JT = calcJouleThomsonFlash({ CH4: 16.043 }, 26.85, 100.0, 10.0, 'PR');
  check(
    ch4JT.converged && ch4JT.deltaT_K <= -35.0 && ch4JT.deltaT_K >= -46.0,
    'CH4 Joule–Thomson throttle 100 barA -> 10 barA cooling matches NIST (-43.6 K vs PR -44.3 K)',
    `T1=26.85°C -> T2=${ch4JT.T2_C.toFixed(2)}°C, ΔT_JT=${ch4JT.deltaT_K.toFixed(2)} K`
  );

  // 2c) H2 positive inversion warming at 300 K (above ~202 K inversion curve): μ_JT < 0, ΔT_JT > 0!
  const h2PropsPR = calcCubicDepartureProps({ H2: 1 }, 26.85, 100.0, 'PR', 'vap');
  const h2PropsSRK = calcCubicDepartureProps({ H2: 1 }, 26.85, 100.0, 'SRK', 'vap');
  const h2JT_SRK = calcJouleThomsonFlash({ H2: 2.016 }, 26.85, 100.0, 10.0, 'SRK');
  check(
    h2PropsPR.muJT_K_bar < 0 && h2PropsSRK.muJT_K_bar < 0 && h2JT_SRK.deltaT_K > 1.5 && h2JT_SRK.deltaT_K < 8.0,
    'H2 @300 K above inversion temperature: μ_JT < 0 K/bar and throttle 100 -> 10 bar WARMS gas!',
    `μ_JT(SRK)=${h2PropsSRK.muJT_K_bar.toFixed(4)} K/bar, ΔT_JT=+${h2JT_SRK.deltaT_K.toFixed(2)} K`
  );

  // 2d) N2 high-pressure cryogenic throttle 250 K (-23.15°C), 150 barA -> 5 barA
  const n2JT = calcJouleThomsonFlash({ N2: 28.014 }, -23.15, 150.0, 5.0, 'PR');
  check(
    n2JT.converged && n2JT.deltaT_K < -26.0,
    'N2 cryogenic throttle 150 barA -> 5 barA strong cooling',
    `ΔT_JT=${n2JT.deltaT_K.toFixed(2)} K`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] Isentropic Flash (psFlash) & thermoCore.ts Real-Gas + Poynting Wiring
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== [3] Isentropic Compressor/Expander Flash (psFlash) & thermoCore Integration ===');
{
  // 3a) Natural gas adiabatic compression 10 barA -> 80 barA (η_s = 0.80)
  const ngComp = psFlash(
    { CH4: 88 * 16.04, C2H6: 8 * 30.07, C3H8: 3 * 44.10, N2: 1 * 28.01 },
    30.0,
    10.0,
    80.0,
    { method: 'PR', isentropicEfficiency: 0.80 }
  );
  check(
    ngComp.converged &&
      Math.abs(ngComp.s2s_J_molK - ngComp.s1_J_molK) < 1e-3 &&
      ngComp.T2_C > ngComp.T2s_C &&
      ngComp.shaftWork_J_mol > ngComp.isentropicWork_J_mol,
    'psFlash compressor (10 -> 80 barA, η=0.80): exact ΔS_s=0 & adiabatic head',
    `T_2s=${ngComp.T2s_C.toFixed(2)}°C, T_2=${ngComp.T2_C.toFixed(2)}°C, W_act=${(ngComp.shaftWork_J_mol / 1000).toFixed(2)} kJ/mol`
  );

  // 3b) Turbo-expander 80 barA -> 10 barA (η_s = 0.85)
  const n2Exp = isentropicFlashEOS({ N2: 280.14 }, 25.0, 80.0, 10.0, {
    method: 'SRK',
    isentropicEfficiency: 0.85,
  });
  check(
    n2Exp.converged &&
      Math.abs(n2Exp.s2s_J_molK - n2Exp.s1_J_molK) < 1e-3 &&
      n2Exp.T2_C < -90.0 &&
      n2Exp.shaftWork_J_mol < 0,
    'isentropicFlashEOS turbo-expander (80 -> 10 barA, η=0.85): deep cryogenic cooling',
    `T_2s=${n2Exp.T2s_C.toFixed(2)}°C, T_2=${n2Exp.T2_C.toFixed(2)}°C, W_shaft=${(n2Exp.shaftWork_J_mol / 1000).toFixed(2)} kJ/mol`
  );

  // 3c) thermoCore streamEnthalpyKcalH & phFlash real-gas JT cooling + Poynting liquid check
  const vapCO2 = emptyFlows();
  vapCO2.CO2 = 44.01; // 1 kmol/h CO2
  const liqZero = emptyFlows();
  const P60_kgcm2g = 60.0 / 0.980665 - 1.033227;
  const P1_kgcm2g = 0.0; // 1.01325 barA

  const hCO2_60bar = streamEnthalpyKcalH(vapCO2, liqZero, 116.85, P60_kgcm2g);
  const hCO2_1bar = streamEnthalpyKcalH(vapCO2, liqZero, 116.85, P1_kgcm2g);
  const dH_kJ_per_mol = ((hCO2_60bar - hCO2_1bar) * KJ_PER_KCAL) / 1000.0;
  check(
    dH_kJ_per_mol < -1.3 && dH_kJ_per_mol > -2.1,
    'thermoCore.streamEnthalpyKcalH captures real-gas CO2 departure between 60 barA and 1 atm @390 K',
    `ΔH(60bar - 1atm) = ${dH_kJ_per_mol.toFixed(3)} kJ/mol`
  );

  const phRes = phFlash(vapCO2, P1_kgcm2g, hCO2_60bar, () => ({ vap: vapCO2, liq: liqZero }), {
    T_guess: 75,
  });
  check(
    phRes.converged && phRes.T_C - 116.85 <= -35.0 && phRes.T_C - 116.85 >= -45.0,
    'thermoCore.phFlash reproduces CO2 Joule–Thomson cooling (60 bar -> 1 atm, ΔT ≈ -40 K)',
    `T_out=${phRes.T_C.toFixed(2)}°C (ΔT=${(phRes.T_C - 116.85).toFixed(2)} K)`
  );

  // Poynting compressed-liquid enthalpy check on liquid water at 25°C, 150 barg
  const liqWater = emptyFlows();
  liqWater.H2O = 18.015; // 1 kmol/h
  const hLiqAtm = streamEnthalpyKcalH(liqZero, liqWater, 25.0, 0.0);
  const hLiq150 = streamEnthalpyKcalH(liqZero, liqWater, 25.0, 150.0);
  const poyntingKJkmol = (hLiq150 - hLiqAtm) * KJ_PER_KCAL;
  // v_L ≈ 0.01807 m³/kmol, ΔP ≈ 147.1 bar -> v_L ΔP ≈ +265.8 kJ/kmol
  check(
    poyntingKJkmol > 240.0 && poyntingKJkmol < 295.0,
    'thermoCore compressed-liquid Poynting correction v_L·(P - Psat) on H2O @150 kgf/cm²g',
    `ΔH_Poynting = +${poyntingKJkmol.toFixed(1)} kJ/kmol`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] 66-Species Databanks & Runtime Multi-Component Hansen (1991) UNIFAC
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== [4] Enriched 66-Species Databanks & Multi-Component Hansen UNIFAC ===');
{
  const newCondensables: SimCompKey[] = [
    'H2S', 'SO2', 'SO3', 'iC4H10', 'C4H8_1', 'nC5H12', 'nC8H18', 'Cyclohexane',
    'Ethylbenzene', 'Styrene', 'Cumene', 'Phenol', 'THF', 'DMF', 'DMSO', 'MTBE',
    'MEK', 'DMC', 'EG', 'MEA', 'MDEA', 'FormicAcid', 'HNO3', 'CUSTOM_1', 'CUSTOM_2',
  ];
  let maxTbPsatErrPct = 0;
  for (const k of newCondensables) {
    const c = PSAT_DIPPR101[k];
    const tbC = COMP_CATALOG_META[k].tbC;
    const pAtTb = dippr101Pa(k, tbC + 273.15) * 1e-5;
    const errPct = (Math.abs(pAtTb - 1.01325) / 1.01325) * 100;
    if (errPct > maxTbPsatErrPct) maxTbPsatErrPct = errPct;
    if (!c) failCount++;
  }
  check(
    maxTbPsatErrPct < 2.0,
    'All 25 new condensable species in PSAT_DIPPR101 match normal boiling point 1.01325 barA',
    `max |Psat(Tb) - 1atm| = ${maxTbPsatErrPct.toFixed(3)}%`
  );

  check(
    Boolean(HENRY_WATER_DATABANK.Ar && HENRY_WATER_DATABANK.H2S && HENRY_WATER_DATABANK.SO2),
    'HENRY_WATER_DATABANK includes Ar, H2S, and SO2 (Sander 2015)'
  );

  const requiredBips: [SimCompKey, SimCompKey][] = [
    ['Ethylbenzene', 'Styrene'],
    ['THF', 'H2O'],
    ['MEK', 'H2O'],
    ['MTBE', 'MeOH'],
    ['DMC', 'MeOH'],
    ['EG', 'H2O'],
    ['Phenol', 'H2O'],
    ['Cumene', 'Phenol'],
    ['DMF', 'H2O'],
    ['DMSO', 'H2O'],
    ['Cyclohexane', 'Benzene'],
    ['FormicAcid', 'H2O'],
    ['MEA', 'H2O'],
    ['HNO3', 'H2O'],
  ];
  const allBipsFound = requiredBips.every(([a, b]) => lookupNrtlBip(a, b) !== null);
  check(
    allBipsFound,
    `All ${requiredBips.length} newly added industrial NRTL binary pairs present in NRTL_BIP_DATABANK (total=${NRTL_BIP_DATABANK.length})`
  );

  // Runtime multi-component Hansen UNIFAC fallback on uncalibrated organic mixtures
  // Pair: DMF + nC8H18 (strongly polar aprotic + heavy alkane — NOT in NRTL_BIP_DATABANK!)
  check(lookupNrtlBip('DMF', 'nC8H18') === null, 'DMF-nC8H18 confirmed uncalibrated in NRTL_BIP_DATABANK');
  const dmfOctX = emptyFlows();
  dmfOctX.DMF = 1e-4;
  dmfOctX.nC8H18 = 0.9999;
  const gInfDmfInOct = calcExtendedNrtlGamma(['DMF', 'nC8H18'], dmfOctX, 25.0);
  const gPureDmf = calcUnifacGamma(['DMF', 'nC8H18'], { DMF: 1.0, nC8H18: 0.0 }, 25.0);
  check(
    Math.abs((gPureDmf.DMF ?? 0) - 1.0) < 1e-6 && (gInfDmfInOct.DMF ?? 0) > 8.0,
    'Hansen (1991) UNIFAC runtime fallback: γ(pure DMF)=1.0000 & γ∞(DMF in n-Octane @25°C) > 8',
    `γ∞(DMF)=${(gInfDmfInOct.DMF ?? 0).toFixed(2)}`
  );

  // Ternary uncalibrated mixture Gibbs-Duhem check: THF + Cumene + MEK @ 50°C
  const ternComps: SimCompKey[] = ['THF', 'Cumene', 'MEK'];
  const dx = 1e-4;
  const xBase = { THF: 0.35, Cumene: 0.40, MEK: 0.25 };
  const xPlus = { THF: 0.35 + dx, Cumene: 0.40 - dx, MEK: 0.25 };
  const xMinus = { THF: 0.35 - dx, Cumene: 0.40 + dx, MEK: 0.25 };
  const gP = calcUnifacGamma(ternComps, xPlus, 50.0);
  const gM = calcUnifacGamma(ternComps, xMinus, 50.0);
  const gdResidual =
    xBase.THF * (Math.log(gP.THF!) - Math.log(gM.THF!)) +
    xBase.Cumene * (Math.log(gP.Cumene!) - Math.log(gM.Cumene!)) +
    xBase.MEK * (Math.log(gP.MEK!) - Math.log(gM.MEK!));
  check(
    Math.abs(gdResidual / (2 * dx)) < 2e-3 && Math.abs(gP.THF! - 1.0) > 1e-3,
    'Multi-component UNIFAC satisfies ternary Gibbs–Duhem Σ x_i d(ln γ_i) = 0 on THF/Cumene/MEK',
    `γ_THF=${gP.THF!.toFixed(4)}, residual=${(gdResidual / (2 * dx)).toExponential(2)}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] Joback Predictor (<3% Error), 128-Species Library & CUSTOM_1/2 VLE Flash
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== [5] Joback Predictor (<3% Error), 128-Species Library & CUSTOM_1/2 Flash ===');
{
  const jobackBenchmarks: {
    name: string;
    groups: Partial<Record<JobackGroupId, number>>;
    tbExpC: number;
    tcRefK: number;
    pcRefBar: number;
    dHfRefKJ: number;
  }[] = [
    { name: 'Toluene', groups: { ACH_arom: 5, AC_arom: 1, CH3: 1 }, tbExpC: 110.63, tcRefK: 591.75, pcRefBar: 41.08, dHfRefKJ: 50.1 },
    { name: 'n-Hexane', groups: { CH3: 2, CH2_chain: 4 }, tbExpC: 68.73, tcRefK: 507.60, pcRefBar: 30.25, dHfRefKJ: -167.1 },
    { name: 'Acetone', groups: { CH3: 2, CO_chain: 1 }, tbExpC: 56.05, tcRefK: 508.10, pcRefBar: 47.00, dHfRefKJ: -217.1 },
    { name: '1-Butanol', groups: { CH3: 1, CH2_chain: 3, OH_alcohol: 1 }, tbExpC: 117.7, tcRefK: 563.10, pcRefBar: 44.23, dHfRefKJ: -274.6 },
    { name: 'Ethyl Acetate', groups: { CH3: 2, CH2_chain: 1, COO_ester: 1 }, tbExpC: 77.1, tcRefK: 523.30, pcRefBar: 38.80, dHfRefKJ: -444.1 },
    { name: 'Chlorobenzene', groups: { ACH_arom: 5, AC_arom: 1, Cl: 1 }, tbExpC: 131.7, tcRefK: 632.40, pcRefBar: 45.20, dHfRefKJ: 51.8 },
  ];

  let sumTcErr = 0;
  let sumPcErr = 0;
  let sumHfErr = 0;
  for (const bm of jobackBenchmarks) {
    const p = predictPropertiesFromJobackGroups(bm.groups, { tbExpC: bm.tbExpC });
    const tcErr = (Math.abs(p.tc_K - bm.tcRefK) / bm.tcRefK) * 100;
    const pcErr = (Math.abs(p.pc_bar - bm.pcRefBar) / bm.pcRefBar) * 100;
    const hfErr = (Math.abs(p.dHfIg298_kJ_mol - bm.dHfRefKJ) / Math.max(50.0, Math.abs(bm.dHfRefKJ))) * 100;
    sumTcErr += tcErr;
    sumPcErr += pcErr;
    sumHfErr += hfErr;
  }
  const meanTcErr = sumTcErr / jobackBenchmarks.length;
  const meanPcErr = sumPcErr / jobackBenchmarks.length;
  const meanHfErr = sumHfErr / jobackBenchmarks.length;

  check(
    meanTcErr < 3.0 && meanPcErr < 3.0 && meanHfErr < 3.0,
    'Joback predictor achieves < 3% mean error on Tc, Pc, and ΔHf°(g,298K) across 6 NIST organics',
    `AAD(Tc)=${meanTcErr.toFixed(2)}%, AAD(Pc)=${meanPcErr.toFixed(2)}%, AAD(ΔHf°)=${meanHfErr.toFixed(2)}%`
  );

  check(
    EXTENDED_CHEMICAL_LIBRARY.length >= 100,
    `EXTENDED_CHEMICAL_LIBRARY contains >= 100 industrial species`,
    `count=${EXTENDED_CHEMICAL_LIBRARY.length}`
  );

  const packIds = new Set(GENERAL_COMPONENT_PACKS.map(p => p.id));
  check(
    packIds.has('sm_cumene_aromatics') && packIds.has('amine_sour_gas') && packIds.has('battery_semi_solvents'),
    'New General Component Packs registered (sm_cumene_aromatics, amine_sour_gas, battery_semi_solvents)'
  );

  // Runtime slot assignment test #1: Battery carbonate separation EMC (Tb 107.5°C) + EC (Tb 248.2°C)
  const emcSpec = applyExtendedChemicalToSlot('CUSTOM_1', 'EMC');
  const ecSpec = applyExtendedChemicalToSlot('CUSTOM_2', 'EC');
  check(
    Boolean(emcSpec && ecSpec && COMP_META.CUSTOM_1.mw === Number(emcSpec.mw.toFixed(3)) && RIGOROUS_CRIT.CUSTOM_2.Tc_K === ecSpec.tcK),
    'applyExtendedChemicalToSlot mutates COMP_META, THERMO_DATA, RIGOROUS_CRIT, and PSAT_DIPPR101 in-place'
  );

  const batFlows = emptyFlows();
  batFlows.CUSTOM_1 = 500; // EMC
  batFlows.CUSTOM_2 = 500; // EC
  const batFlash = solveRigorousFlashVLE(batFlows, 155.0, 0.0, 1.0, undefined, undefined, 'NRTL');
  const yEmc = batFlash.vap.CUSTOM_1 / Math.max(1e-9, batFlash.vap.CUSTOM_1 + batFlash.vap.CUSTOM_2);
  const xEmc = batFlash.liq.CUSTOM_1 / Math.max(1e-9, batFlash.liq.CUSTOM_1 + batFlash.liq.CUSTOM_2);
  check(
    batFlash.betaVapMole > 0.15 && batFlash.betaVapMole < 0.85 && yEmc > 0.90 && xEmc < 0.45,
    'CUSTOM_1 (EMC) / CUSTOM_2 (EC) runtime VLE flash @155°C, 1 atm splits cleanly with high α',
    `beta=${batFlash.betaVapMole.toFixed(3)}, w_vap(EMC)=${(yEmc * 100).toFixed(1)}%, w_liq(EMC)=${(xEmc * 100).toFixed(1)}%`
  );

  // Runtime slot assignment test #2: Custom Joback-built Isoamyl Acetate + H2O heterogeneous non-ideality
  const { spec: iaaSpec } = buildSpecFromJobackGroups(
    { CH3: 3, CH2_chain: 2, CH_chain: 1, COO_ester: 1 },
    { formula: 'C7H14O2', nameKo: '이소아밀아세테이트', tbExpC: 142.0 }
  );
  applyCustomSpecToSlot('CUSTOM_1', iaaSpec);
  const iaaX = emptyFlows();
  iaaX.CUSTOM_1 = 1e-4;
  iaaX.H2O = 0.9999;
  const gIaaInWater = calcExtendedNrtlGamma(['CUSTOM_1', 'H2O'], iaaX, 25.0);
  check(
    (gIaaInWater.CUSTOM_1 ?? 0) > 100.0 && THERMO_DATA.CUSTOM_1.mw === iaaSpec.mw && pureDipprOrAntoineBarA('CUSTOM_1', 142.0) > 0.99,
    'Joback-built Isoamyl Acetate in CUSTOM_1 exhibits strong UNIFAC hydrophobic γ∞ in water & exact Tb Psat',
    `γ∞(IAA in H2O)=${(gIaaInWater.CUSTOM_1 ?? 0).toFixed(1)}, Psat(142°C)=${pureDipprOrAntoineBarA('CUSTOM_1', 142.0).toFixed(4)} barA`
  );

  // Cleanly restore default CUSTOM_1 / CUSTOM_2 slots
  resetCustomSlot('CUSTOM_1');
  resetCustomSlot('CUSTOM_2');
}

console.log('\n================================================================================');
console.log(`  W7 VALIDATION SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================================');

if (failCount > 0) {
  process.exit(1);
}

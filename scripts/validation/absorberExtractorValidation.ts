import {
  solveRigorousAbsorberStripper,
  solveRigorousDistillation,
} from '../../lib/calculations/rigorousDistillation';
import { solveMultistageExtractor } from '../../lib/calculations/liquidLiquidExtractor';
import { MW } from '../../lib/calculations/constants';
import { streamEnthalpyKcalH } from '../../lib/calculations/thermoCore';
import type { SimCompKey } from '../../lib/calculations/flowsheetSolver';

let passed = 0;
let failed = 0;

function assertCond(name: string, cond: boolean, detail: string): void {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name} — ${detail}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name} — ${detail}`);
  }
}

function fullFlows(partial: Partial<Record<SimCompKey, number>>): Record<SimCompKey, number> {
  const out = {} as Record<SimCompKey, number>;
  for (const k of Object.keys(MW) as SimCompKey[]) {
    out[k] = partial[k] ?? 0;
  }
  return out;
}

function totalMass(flows: Partial<Record<SimCompKey, number>>): number {
  let s = 0;
  for (const k of Object.keys(flows) as SimCompKey[]) {
    s += flows[k] || 0;
  }
  return s;
}

function massBalanceRelError(
  inStreams: Array<Partial<Record<SimCompKey, number>>>,
  outStreams: Array<Partial<Record<SimCompKey, number>>>
): number {
  const keys = Object.keys(MW) as SimCompKey[];
  let totIn = 0;
  let absErr = 0;
  for (const k of keys) {
    let mIn = 0;
    let mOut = 0;
    for (const st of inStreams) mIn += st[k] || 0;
    for (const st of outStreams) mOut += st[k] || 0;
    totIn += mIn;
    absErr += Math.abs(mOut - mIn);
  }
  return absErr / Math.max(1e-12, totIn);
}

console.log('======================================================================');
console.log(' W8 VALIDATION: RIGOROUS MESH ABSORBER/STRIPPER & MULTISTAGE EXTRACTOR');
console.log('======================================================================\n');

// ============================================================================
// TEST 1: Acetone-Air-Water 8-Stage Countercurrent Absorber
//         (a) Dilute limit vs Analytical Kremser Equation
//         (b) Higher-concentration adiabatic temperature bulge + Murphree eff
// ============================================================================
console.log('--- [1] Acetone-Air-Water 8-Stage Countercurrent Absorber ---');
{
  // 1A: Dilute isothermal limit (pre-humidified air + trace Acetone at 25 °C, 1 atm)
  const topPressKgcm2g = 0.0; // ~1.01325 barA
  const stages = 8;
  // Pre-humidify N2/O2 at 25 °C (~3.12 mol% H2O) so evaporative cooling is minimal (< 0.15 °C)
  const gasN2Mol = 38.0;
  const gasO2Mol = 10.0;
  const gasH2OMol = 1.56;
  const gasAcetoneMol = 0.08; // ~0.16 mol% dilute Acetone
  const diluteGasFlows: Partial<Record<SimCompKey, number>> = {
    N2: gasN2Mol * MW.N2,
    O2: gasO2Mol * MW.O2,
    H2O: gasH2OMol * MW.H2O,
    Acetone: gasAcetoneMol * MW.Acetone,
  };
  // Choose liquid water rate so absorption factor A = L / (K * V) is ~ 1.25 (sensitive Kremser regime!)
  const liqH2OMol = 115.0;
  const diluteLiqFlows: Partial<Record<SimCompKey, number>> = {
    H2O: liqH2OMol * MW.H2O,
  };

  const resDilute = solveRigorousAbsorberStripper({
    stages,
    topPressKgcm2g,
    stageDeltaPKgcm2: 0.0,
    gasFeed: {
      edgeId: 'dilute-air-acetone',
      streamNo: 'S-101',
      stage: stages,
      flowsKgH: fullFlows(diluteGasFlows),
      tempC: 25.0,
      pressKgcm2g: topPressKgcm2g,
    },
    liquidSolvent: {
      edgeId: 'lean-water',
      streamNo: 'S-102',
      stage: 1,
      flowsKgH: fullFlows(diluteLiqFlows),
      tempC: 25.0,
      pressKgcm2g: topPressKgcm2g,
    },
    murphreeEff: 1.0,
    propertyMethod: 'NRTL',
  });

  const acetoneInKg = diluteGasFlows.Acetone!;
  const acetoneAbsorbedKg = resDilute.bottomsFlowsKgH.Acetone || 0;
  const meshRecFrac = acetoneAbsorbedKg / acetoneInKg;

  // Compute effective dilute absorption factor A = avg(L_j / (K_j * V_j)) across the 8 stages
  let sumA = 0;
  let maxStageDT = 0;
  for (const st of resDilute.stages) {
    const kStage = st.yMol.Acetone / Math.max(1e-15, st.xMol.Acetone);
    sumA += st.liqFlowKmolH / (kStage * st.vapFlowKmolH);
    maxStageDT = Math.max(maxStageDT, Math.abs(st.tempC - 25.0));
  }
  const avgA = sumA / stages;
  const kremserRecFrac =
    Math.abs(avgA - 1.0) < 1e-6
      ? stages / (stages + 1)
      : (Math.pow(avgA, stages + 1) - avgA) / (Math.pow(avgA, stages + 1) - 1.0);

  const mbErrDilute = massBalanceRelError(
    [diluteGasFlows, diluteLiqFlows],
    [resDilute.distillateFlowsKgH, resDilute.bottomsFlowsKgH]
  );

  assertCond(
    '1A.1 Dilute Acetone absorber converged (G overhead, Q_cond=0, Q_reb=0)',
    resDilute.converged &&
      resDilute.distillatePhase === 'G' &&
      resDilute.condenserDutyKcalH === 0 &&
      resDilute.reboilerDutyKcalH === 0,
    `iters=${resDilute.innerIterations}, phase=${resDilute.distillatePhase}, max|ΔT|=${maxStageDT.toFixed(3)} °C`
  );
  assertCond(
    '1A.2 Dilute Acetone MESH recovery matches analytical Kremser within 1.0%p',
    Math.abs(meshRecFrac - kremserRecFrac) < 0.01 && meshRecFrac > 0.75 && meshRecFrac < 0.99,
    `MESH=${(meshRecFrac * 100).toFixed(2)}%, Kremser=${(kremserRecFrac * 100).toFixed(2)}% (A=${avgA.toFixed(3)})`
  );
  assertCond(
    '1A.3 Dilute Acetone absorber exact mass balance (< 1e-10)',
    mbErrDilute < 1e-10,
    `relErr=${mbErrDilute.toExponential(3)}`
  );

  // 1B: Concentrated Acetone gas (10 mol% Acetone in Air) -> Adiabatic exothermic temperature rise & Murphree efficiency test
  const richGasFlows: Partial<Record<SimCompKey, number>> = {
    N2: 35.0 * MW.N2,
    O2: 9.5 * MW.O2,
    H2O: 1.4 * MW.H2O,
    Acetone: 5.2 * MW.Acetone,
  };
  const leanWaterFlows: Partial<Record<SimCompKey, number>> = {
    H2O: 130.0 * MW.H2O,
  };

  const resRichIdeal = solveRigorousAbsorberStripper({
    stages: 8,
    topPressKgcm2g: 0.2,
    gasFeed: {
      edgeId: 'rich-air-acetone',
      streamNo: 'S-103',
      stage: 8,
      flowsKgH: fullFlows(richGasFlows),
      tempC: 25.0,
      pressKgcm2g: 0.22,
    },
    liquidSolvent: {
      edgeId: 'lean-water-rich',
      streamNo: 'S-104',
      stage: 1,
      flowsKgH: fullFlows(leanWaterFlows),
      tempC: 25.0,
      pressKgcm2g: 0.2,
    },
    murphreeEff: 1.0,
    propertyMethod: 'NRTL',
  });

  const resRichMurphree = solveRigorousAbsorberStripper({
    stages: 8,
    topPressKgcm2g: 0.2,
    gasFeed: {
      edgeId: 'rich-air-acetone',
      streamNo: 'S-103',
      stage: 8,
      flowsKgH: fullFlows(richGasFlows),
      tempC: 25.0,
      pressKgcm2g: 0.22,
    },
    liquidSolvent: {
      edgeId: 'lean-water-rich',
      streamNo: 'S-104',
      stage: 1,
      flowsKgH: fullFlows(leanWaterFlows),
      tempC: 25.0,
      pressKgcm2g: 0.2,
    },
    murphreeEff: 0.65,
    propertyMethod: 'NRTL',
  });

  const maxTempRich = Math.max(...resRichIdeal.stages.map(s => s.tempC));
  const recRich100 = (resRichIdeal.bottomsFlowsKgH.Acetone / richGasFlows.Acetone!) * 100;
  const recRich65 = (resRichMurphree.bottomsFlowsKgH.Acetone / richGasFlows.Acetone!) * 100;

  const hInRich =
    streamEnthalpyKcalH(richGasFlows, {}, 25.0, 0.22) +
    streamEnthalpyKcalH({}, leanWaterFlows, 25.0, 0.2);
  const hOutRich =
    streamEnthalpyKcalH(resRichIdeal.distillateFlowsKgH, {}, resRichIdeal.topTempC, resRichIdeal.topPressKgcm2g) +
    streamEnthalpyKcalH({}, resRichIdeal.bottomsFlowsKgH, resRichIdeal.bottomTempC, resRichIdeal.bottomPressKgcm2g);
  const enthDiffKcalH = Math.abs(hOutRich - hInRich);

  assertCond(
    '1B.1 Concentrated Acetone adiabatic absorption exhibits exothermic temperature rise',
    resRichIdeal.converged && maxTempRich > 29.0 && resRichIdeal.bottomTempC > 28.0,
    `T_top=${resRichIdeal.topTempC.toFixed(2)} °C, T_max=${maxTempRich.toFixed(2)} °C, T_bot=${resRichIdeal.bottomTempC.toFixed(2)} °C`
  );
  assertCond(
    '1B.2 Adiabatic enthalpy balance closure (< 50 kcal/h) & Murphree η_MV=0.65 lowers recovery',
    enthDiffKcalH < 50.0 && resRichMurphree.converged && recRich100 > recRich65 + 2.0,
    `|ΔH|=${enthDiffKcalH.toFixed(2)} kcal/h, Rec(η=1.0)=${recRich100.toFixed(2)}% > Rec(η=0.65)=${recRich65.toFixed(2)}%`
  );
}

// ============================================================================
// TEST 2: High-Pressure Light Hydrocarbon Oil Absorber & Reboiled Absorber
//         (C3H8 / nC4H10 absorbed from CH4 / C2H6 into nC8H18 at 25 bar, PR EOS)
// ============================================================================
console.log('\n--- [2] High-Pressure Hydrocarbon Oil Absorber (25 bar, PR EOS) ---');
{
  const press25BarKgcm2g = 24.48; // ~25.0 barA
  const hcGasFlows: Partial<Record<SimCompKey, number>> = {
    CH4: 80.0 * MW.CH4,
    C2H6: 12.0 * MW.C2H6,
    C3H8: 7.0 * MW.C3H8,
    nC4H10: 4.5 * MW.nC4H10,
  };
  const leanOilFlows: Partial<Record<SimCompKey, number>> = {
    nC8H18: 65.0 * MW.nC8H18,
  };

  const resOilAbs = solveRigorousAbsorberStripper({
    stages: 10,
    topPressKgcm2g: press25BarKgcm2g,
    stageDeltaPKgcm2: 0.01,
    gasFeed: {
      edgeId: 'wet-natural-gas',
      streamNo: 'S-201',
      stage: 10,
      flowsKgH: fullFlows(hcGasFlows),
      tempC: 30.0,
      pressKgcm2g: press25BarKgcm2g + 0.09,
    },
    liquidSolvent: {
      edgeId: 'lean-n-octane',
      streamNo: 'S-202',
      stage: 1,
      flowsKgH: fullFlows(leanOilFlows),
      tempC: 28.0,
      pressKgcm2g: press25BarKgcm2g,
    },
    murphreeEff: 1.0,
    propertyMethod: 'PR',
  });

  const recCH4 = (resOilAbs.bottomsFlowsKgH.CH4 / hcGasFlows.CH4!) * 100;
  const recC2 = (resOilAbs.bottomsFlowsKgH.C2H6 / hcGasFlows.C2H6!) * 100;
  const recC3 = (resOilAbs.bottomsFlowsKgH.C3H8 / hcGasFlows.C3H8!) * 100;
  const recNC4 = (resOilAbs.bottomsFlowsKgH.nC4H10 / hcGasFlows.nC4H10!) * 100;
  const oilLossPct = (resOilAbs.distillateFlowsKgH.nC8H18 / leanOilFlows.nC8H18!) * 100;
  const maxOilT = Math.max(...resOilAbs.stages.map(s => s.tempC));
  const mbOil = massBalanceRelError(
    [hcGasFlows, leanOilFlows],
    [resOilAbs.distillateFlowsKgH, resOilAbs.bottomsFlowsKgH]
  );

  assertCond(
    '2.1 PR EOS 25-bar hydrocarbon oil absorber converged with strict volatility selectivity',
    resOilAbs.converged &&
      resOilAbs.thermoModelUsed === 'PR' &&
      recNC4 > 85.0 &&
      recC3 > 45.0 &&
      recNC4 > recC3 &&
      recC3 > recC2 &&
      recC2 > recCH4 &&
      recCH4 < 15.0 &&
      oilLossPct < 0.5,
    `Rec: nC4=${recNC4.toFixed(1)}% > C3=${recC3.toFixed(1)}% > C2=${recC2.toFixed(1)}% > CH4=${recCH4.toFixed(1)}%, C8 slip=${oilLossPct.toFixed(3)}%`
  );
  assertCond(
    '2.2 Hydrocarbon oil absorber shows condensation heat rise & < 1e-10 mass error',
    maxOilT > 31.5 && mbOil < 1e-10,
    `T_max=${maxOilT.toFixed(2)} °C, T_bot=${resOilAbs.bottomTempC.toFixed(2)} °C, mbErr=${mbOil.toExponential(3)}`
  );

  // Reboiled Absorber check: adding reboiler heat rejects co-absorbed CH4/C2H6 from rich oil
  const resReboiledAbs = solveRigorousAbsorberStripper({
    stages: 10,
    topPressKgcm2g: press25BarKgcm2g,
    stageDeltaPKgcm2: 0.01,
    gasFeed: {
      edgeId: 'wet-natural-gas-mid',
      streamNo: 'S-203',
      stage: 7,
      flowsKgH: fullFlows(hcGasFlows),
      tempC: 30.0,
      pressKgcm2g: press25BarKgcm2g + 0.09,
    },
    liquidSolvent: {
      edgeId: 'lean-n-octane-top',
      streamNo: 'S-204',
      stage: 1,
      flowsKgH: fullFlows(leanOilFlows),
      tempC: 28.0,
      pressKgcm2g: press25BarKgcm2g,
    },
    propertyMethod: 'PR',
    reboilerDutyKcalH: 360000,
  });

  const ch4InRichOilPure = resOilAbs.bottomsFlowsKgH.CH4;
  const ch4InRichOilReb = resReboiledAbs.bottomsFlowsKgH.CH4;
  assertCond(
    '2.3 Reboiled Absorber (condenser=none, reboiler=kettle) strips co-absorbed CH4 while keeping Q_cond=0',
    resReboiledAbs.converged &&
      resReboiledAbs.condenserDutyKcalH === 0 &&
      resReboiledAbs.reboilerDutyKcalH > 80000 &&
      ch4InRichOilReb < ch4InRichOilPure * 0.65,
    `CH4 in bottoms: pure=${ch4InRichOilPure.toFixed(2)} kg/h -> reboiled=${ch4InRichOilReb.toFixed(2)} kg/h, T_bot=${resReboiledAbs.bottomTempC.toFixed(1)} °C`
  );
}

// ============================================================================
// TEST 3: Live-Steam Stripper (reboilerType: 'none' / 'live_steam' + Bottom Steam)
// ============================================================================
console.log('\n--- [3] Live-Steam Stripper (VOC & Solvent Stripping by Direct Steam) ---');
{
  // 3A: Benzene & Toluene stripped from contaminated water by direct live steam (no condenser, no reboiler)
  const wasteWaterFeed: Partial<Record<SimCompKey, number>> = {
    H2O: 1000.0,
    Benzene: 4.0,
    Toluene: 4.0,
  };
  const liveSteamFeed: Partial<Record<SimCompKey, number>> = {
    H2O: 110.0,
  };

  const resSteamStrip = solveRigorousDistillation(
    [
      {
        edgeId: 'contaminated-water-top',
        streamNo: 'S-301',
        stage: 1,
        flowsKgH: fullFlows(wasteWaterFeed),
        tempC: 95.0,
        pressKgcm2g: 0.05,
        forcedPhase: 'L',
      },
    ],
    {
      columnCalcMode: 'rigorous_mesh',
      totalStages: 10,
      feedStage: 1,
      condenserType: 'none',
      reboilerType: 'none',
      topPressKgcm2g: 0.05,
      stageDeltaPKgcm2: 0.005,
      thermoModel: 'NRTL',
      secondaryFeeds: [
        {
          edgeId: 'live-steam-bottom',
          streamNo: 'S-302',
          stage: 10,
          flowsKgH: fullFlows(liveSteamFeed),
          tempC: 115.0,
          pressKgcm2g: 0.12,
          forcedPhase: 'G',
        },
      ],
    }
  );

  const benzStrippedPct = (resSteamStrip.distillateFlowsKgH.Benzene / wasteWaterFeed.Benzene!) * 100;
  const tolStrippedPct = (resSteamStrip.distillateFlowsKgH.Toluene / wasteWaterFeed.Toluene!) * 100;
  const mbSteam = massBalanceRelError(
    [wasteWaterFeed, liveSteamFeed],
    [resSteamStrip.distillateFlowsKgH, resSteamStrip.bottomsFlowsKgH]
  );

  assertCond(
    '3A.1 Open Live-Steam Stripper strips > 99% of Benzene & Toluene with Q_reb=0, Q_cond=0',
    resSteamStrip.converged &&
      resSteamStrip.reboilerDutyKcalH === 0 &&
      resSteamStrip.condenserDutyKcalH === 0 &&
      resSteamStrip.distillatePhase === 'G' &&
      benzStrippedPct > 99.0 &&
      tolStrippedPct > 99.0 &&
      mbSteam < 1e-10,
    `Benzene stripped=${benzStrippedPct.toFixed(2)}%, Toluene stripped=${tolStrippedPct.toFixed(2)}%, T_top=${resSteamStrip.topTempC.toFixed(2)} °C, T_bot=${resSteamStrip.bottomTempC.toFixed(2)} °C`
  );

  // 3B: Refluxed Steam Stripper (condenserType: 'total', reboilerType: 'live_steam') for Aqueous Acetone/EtOH
  const aqSolventFeed: Partial<Record<SimCompKey, number>> = {
    H2O: 900.0,
    Acetone: 50.0,
    EtOH: 50.0,
  };
  const steamBottom: Partial<Record<SimCompKey, number>> = {
    H2O: 240.0,
  };
  const resRefluxSteam = solveRigorousDistillation(
    [
      {
        edgeId: 'aq-acetone-etoh',
        streamNo: 'S-303',
        stage: 3,
        flowsKgH: fullFlows(aqSolventFeed),
        tempC: 88.0,
        pressKgcm2g: 0.05,
        forcedPhase: 'L',
      },
    ],
    {
      columnCalcMode: 'rigorous_mesh',
      totalStages: 12,
      feedStage: 3,
      condenserType: 'total',
      reboilerType: 'live_steam',
      topPressKgcm2g: 0.05,
      stageDeltaPKgcm2: 0.004,
      topSpecType: 'reflux_ratio',
      topSpecValue: 1.6,
      thermoModel: 'NRTL',
      secondaryFeeds: [
        {
          edgeId: 'direct-steam-in',
          streamNo: 'S-304',
          stage: 12,
          flowsKgH: fullFlows(steamBottom),
          tempC: 115.0,
          pressKgcm2g: 0.12,
          forcedPhase: 'G',
        },
      ],
    }
  );

  const distTot3B = totalMass(resRefluxSteam.distillateFlowsKgH);
  const orgWtInDist =
    ((resRefluxSteam.distillateFlowsKgH.Acetone + resRefluxSteam.distillateFlowsKgH.EtOH) /
      Math.max(1e-9, distTot3B)) *
    100;
  const acetoneRecovery3B = (resRefluxSteam.distillateFlowsKgH.Acetone / aqSolventFeed.Acetone!) * 100;

  assertCond(
    '3B.1 Refluxed Live-Steam Stripper enriches overhead organics with Q_reb=0 & Q_cond<0',
    resRefluxSteam.converged &&
      resRefluxSteam.reboilerDutyKcalH === 0 &&
      resRefluxSteam.condenserDutyKcalH < -10000 &&
      orgWtInDist > 60.0 &&
      acetoneRecovery3B > 95.0,
    `Acetone rec=${acetoneRecovery3B.toFixed(2)}%, Distillate organics=${orgWtInDist.toFixed(1)} wt%, Q_cond=${resRefluxSteam.condenserDutyKcalH.toFixed(0)} kcal/h`
  );
}

// ============================================================================
// TEST 4: HCl-Water Exothermic Adiabatic Absorption (Heat of Solution ΔH_s)
// ============================================================================
console.log('\n--- [4] HCl-Water Exothermic Adiabatic Absorber (ENRTL + ΔH_s) ---');
{
  const hclGasFeed: Partial<Record<SimCompKey, number>> = {
    HCl: 140.0,
    N2: 360.0,
  };
  const waterSolvent: Partial<Record<SimCompKey, number>> = {
    H2O: 860.0,
  };

  const resHCl = solveRigorousAbsorberStripper({
    stages: 8,
    topPressKgcm2g: 0.1,
    stageDeltaPKgcm2: 0.004,
    gasFeed: {
      edgeId: 'hcl-tail-gas',
      streamNo: 'S-401',
      stage: 8,
      flowsKgH: fullFlows(hclGasFeed),
      tempC: 30.0,
      pressKgcm2g: 0.13,
    },
    liquidSolvent: {
      edgeId: 'scrubbing-water',
      streamNo: 'S-402',
      stage: 1,
      flowsKgH: fullFlows(waterSolvent),
      tempC: 25.0,
      pressKgcm2g: 0.1,
    },
    murphreeEff: 1.0,
    propertyMethod: 'ENRTL',
  });

  const hclRecoveryPct = (resHCl.bottomsFlowsKgH.HCl / hclGasFeed.HCl!) * 100;
  const productAcidWtPct =
    (resHCl.bottomsFlowsKgH.HCl / Math.max(1e-9, totalMass(resHCl.bottomsFlowsKgH))) * 100;
  const maxStageTempHCl = Math.max(...resHCl.stages.map(s => s.tempC));
  const mbHCl = massBalanceRelError(
    [hclGasFeed, waterSolvent],
    [resHCl.distillateFlowsKgH, resHCl.bottomsFlowsKgH]
  );

  const hInHCl =
    streamEnthalpyKcalH(hclGasFeed, {}, 30.0, 0.13) +
    streamEnthalpyKcalH({}, waterSolvent, 25.0, 0.1);
  const hOutHCl =
    streamEnthalpyKcalH(resHCl.distillateFlowsKgH, {}, resHCl.topTempC, resHCl.topPressKgcm2g) +
    streamEnthalpyKcalH({}, resHCl.bottomsFlowsKgH, resHCl.bottomTempC, resHCl.bottomPressKgcm2g);
  const hErrHCl = Math.abs(hOutHCl - hInHCl);

  assertCond(
    '4.1 HCl-Water absorber achieves > 99.5% HCl recovery via ENRTL Gibbs-Duhem VLE',
    resHCl.converged &&
      resHCl.thermoModelUsed === 'ENRTL' &&
      hclRecoveryPct > 99.5 &&
      productAcidWtPct > 12.0 &&
      mbHCl < 1e-10,
    `HCl recovery=${hclRecoveryPct.toFixed(4)}%, Bottoms acid=${productAcidWtPct.toFixed(2)} wt%, mbErr=${mbHCl.toExponential(3)}`
  );
  assertCond(
    '4.2 HCl heat of solution (-74.85 kJ/mol) drives realistic adiabatic temperature rise (+25~65 °C)',
    maxStageTempHCl > 55.0 && maxStageTempHCl < 108.0 && resHCl.bottomTempC > 50.0 && hErrHCl < 50.0,
    `T_top=${resHCl.topTempC.toFixed(1)} °C, T_max=${maxStageTempHCl.toFixed(1)} °C, T_bot=${resHCl.bottomTempC.toFixed(1)} °C, |ΔH|=${hErrHCl.toFixed(1)} kcal/h`
  );
}

// ============================================================================
// TEST 5: Rigorous Multistage Countercurrent Liquid-Liquid Extraction
//         (a) AceticAcid from H2O using EtOAc (1 vs 5 vs 10 stages > 90%)
//         (b) Acetone from H2O using Toluene and CHCl3
//         (c) Single-phase miscible washout detection (H2O + Acetone + MeOH)
// ============================================================================
console.log('\n--- [5] Multistage Countercurrent Liquid-Liquid Extraction (NRTL / UNIFAC) ---');
{
  // 5A: AceticAcid extracted from Water using Ethyl Acetate (EtOAc): 1 vs 5 vs 10 stages
  // Ensure molar extraction factor E_fac = K_LL * (E_mol / R_mol) > 1.3 (MW_EtOAc=88.1 vs MW_H2O=18.0)
  const aaFeed: Partial<Record<SimCompKey, number>> = {
    H2O: 200.0,
    AceticAcid: 20.0,
  };
  const etoacSolvent: Partial<Record<SimCompKey, number>> = {
    EtOAc: 1350.0,
  };

  const ext1 = solveMultistageExtractor(aaFeed, 25.0, etoacSolvent, 25.0, {
    stages: 1,
    operTempC: 25.0,
    operPressKgcm2g: 0.5,
    propertyMethod: 'NRTL',
  });
  const ext5 = solveMultistageExtractor(aaFeed, 25.0, etoacSolvent, 25.0, {
    stages: 5,
    operTempC: 25.0,
    operPressKgcm2g: 0.5,
    propertyMethod: 'NRTL',
  });
  const ext10 = solveMultistageExtractor(aaFeed, 25.0, etoacSolvent, 25.0, {
    stages: 10,
    operTempC: 25.0,
    operPressKgcm2g: 0.5,
    propertyMethod: 'NRTL',
  });

  assertCond(
    '5A.1 AceticAcid / H2O / EtOAc 1, 5, 10 stages all converge with massBalanceRelErr < 1e-8',
    ext1.converged &&
      ext5.converged &&
      ext10.converged &&
      ext10.soluteKey === 'AceticAcid' &&
      ext1.massBalanceRelErr < 1e-8 &&
      ext5.massBalanceRelErr < 1e-8 &&
      ext10.massBalanceRelErr < 1e-8,
    `iters=[${ext1.iterations}, ${ext5.iterations}, ${ext10.iterations}], maxMbErr=${Math.max(
      ext1.massBalanceRelErr,
      ext5.massBalanceRelErr,
      ext10.massBalanceRelErr
    ).toExponential(3)}`
  );
  assertCond(
    '5A.2 AceticAcid recovery increases strictly monotonically (1 < 5 < 10 stages) and exceeds 90% at 10 stages',
    ext1.soluteRecoveryPct < ext5.soluteRecoveryPct &&
      ext5.soluteRecoveryPct < ext10.soluteRecoveryPct &&
      ext10.soluteRecoveryPct > 90.0,
    `Rec(1)=${ext1.soluteRecoveryPct.toFixed(2)}% < Rec(5)=${ext5.soluteRecoveryPct.toFixed(2)}% < Rec(10)=${ext10.soluteRecoveryPct.toFixed(2)}%`
  );

  // 5B: Acetone extracted from Water using Toluene AND Chloroform (CHCl3)
  const acetoneAqFeed: Partial<Record<SimCompKey, number>> = {
    H2O: 940.0,
    Acetone: 60.0,
  };
  const tolueneSolvent: Partial<Record<SimCompKey, number>> = {
    Toluene: 1100.0,
  };
  const chcl3Solvent: Partial<Record<SimCompKey, number>> = {
    CHCl3: 1100.0,
  };

  const extTol = solveMultistageExtractor(acetoneAqFeed, 22.0, tolueneSolvent, 36.0, {
    stages: 8,
    operTempC: 28.0,
    operPressKgcm2g: 0.5,
    propertyMethod: 'NRTL',
  });
  const extChcl3 = solveMultistageExtractor(acetoneAqFeed, 25.0, chcl3Solvent, 25.0, {
    stages: 6,
    operTempC: 25.0,
    operPressKgcm2g: 0.5,
    propertyMethod: 'NRTL',
  });
  const extChcl3Eff = solveMultistageExtractor(acetoneAqFeed, 25.0, chcl3Solvent, 25.0, {
    stages: 6,
    operTempC: 25.0,
    operPressKgcm2g: 0.5,
    propertyMethod: 'NRTL',
    stageEfficiency: 0.6,
  });

  assertCond(
    '5B.1 Acetone / H2O / Toluene 8-stage countercurrent extractor converges with non-isothermal T profile',
    extTol.converged &&
      extTol.soluteKey === 'Acetone' &&
      extTol.soluteRecoveryPct > 80.0 &&
      extTol.massBalanceRelErr < 1e-8 &&
      extTol.raffinateTempC > extTol.extractTempC,
    `Rec=${extTol.soluteRecoveryPct.toFixed(2)}%, T_ext=${extTol.extractTempC.toFixed(2)} °C, T_raf=${extTol.raffinateTempC.toFixed(2)} °C, mbErr=${extTol.massBalanceRelErr.toExponential(3)}`
  );
  assertCond(
    '5B.2 Acetone / H2O / CHCl3 6-stage extractor achieves > 92% recovery & Murphree LLE eff reduces recovery',
    extChcl3.converged &&
      extChcl3Eff.converged &&
      extChcl3.soluteRecoveryPct > 92.0 &&
      extChcl3.soluteRecoveryPct > extChcl3Eff.soluteRecoveryPct &&
      extChcl3.massBalanceRelErr < 1e-8,
    `CHCl3 Rec(η=1.0)=${extChcl3.soluteRecoveryPct.toFixed(2)}% > Rec(η=0.6)=${extChcl3Eff.soluteRecoveryPct.toFixed(2)}%`
  );

  // 5C: Completely miscible solvent (MeOH with H2O) -> Honest single-phase washout detection
  const extMiscible = solveMultistageExtractor(
    { H2O: 900.0, Acetone: 50.0 },
    25.0,
    { MeOH: 900.0 },
    25.0,
    {
      stages: 5,
      operTempC: 25.0,
      operPressKgcm2g: 0.5,
      propertyMethod: 'NRTL',
    }
  );

  assertCond(
    '5C.1 Completely miscible H2O + MeOH feed+solvent honestly reports converged=false with washout warning',
    !extMiscible.converged && extMiscible.warnings.length > 0 && extMiscible.massBalanceRelErr < 1e-8,
    `converged=${extMiscible.converged}, warning="${extMiscible.warnings[0]}"`
  );
}

console.log('\n======================================================================');
console.log(` TOTAL: ${passed} passed, ${failed} failed`);
console.log('======================================================================');

if (failed > 0) {
  process.exit(1);
}

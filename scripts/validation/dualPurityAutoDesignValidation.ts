import assert from 'node:assert/strict';
import {
  solveRigorousDistillation,
  type DistillFeedInput,
  type DistillSolveResult,
} from '../../lib/calculations/rigorousDistillation';
import { autoFixDistillationSimulationAsync } from '../../lib/calculations/aiEquipmentAdvisor';
import { PLANT_UNIT_TEMPLATES } from '../../lib/calculations/plantUnitTemplates';
import type { SimCompKey } from '../../lib/calculations/flowsheetSolver';

function zeroFlows(partial: Partial<Record<SimCompKey, number>>): Record<SimCompKey, number> {
  return {
    H2O: 0, NaCl: 0, NaOH: 0, Cl2: 0, H2: 0, HCl: 0, H2SO4: 0, O2: 0, NaOCl: 0,
    N2: 0, NaClO3: 0, FeCl2: 0, FeCl3: 0, PAC: 0, Glycerol: 0, MCH: 0, DCH: 0, ECH: 0, DCP: 0,
    CH4: 0, CO: 0, CO2: 0, NH3: 0,
    C2H4: 0, C2H6: 0, C3H6: 0, C3H8: 0, nC4H10: 0, nC6H14: 0, nC7H16: 0,
    Benzene: 0, Toluene: 0, pXylene: 0,
    MeOH: 0, EtOH: 0, IPA: 0, Acetone: 0, AceticAcid: 0, EtOAc: 0, CHCl3: 0,
    Ar: 0, H2S: 0, SO2: 0, SO3: 0, iC4H10: 0, C4H8_1: 0, nC5H12: 0, nC8H18: 0,
    Cyclohexane: 0, Ethylbenzene: 0, Styrene: 0, Cumene: 0, Phenol: 0,
    THF: 0, DMF: 0, DMSO: 0, MTBE: 0, MEK: 0, DMC: 0, EG: 0, MEA: 0, MDEA: 0,
    FormicAcid: 0, HNO3: 0, CH3Cl: 0, CH2Cl2: 0, CCl4: 0, C2Cl4: 0, CUSTOM_1: 0, CUSTOM_2: 0,
    ...partial,
  };
}

function totFlow(f: Record<SimCompKey, number>): number {
  return Object.values(f).reduce((a, b) => a + (b || 0), 0);
}

function wtPct(f: Record<SimCompKey, number>, c: SimCompKey): number {
  const t = totFlow(f);
  return t > 1e-9 ? ((f[c] || 0) / t) * 100 : 0;
}

function wtPpm(f: Record<SimCompKey, number>, c: SimCompKey): number {
  const t = totFlow(f);
  return t > 1e-9 ? ((f[c] || 0) / t) * 1e6 : 0;
}

function logCase(name: string, ms: number, res: DistillSolveResult, topSummary: string, botSummary: string) {
  const cands = res.shortcutDesign?.candidates ?? res.dualSpecCandidates ?? [];
  console.log(
    `[PASS] ${name} (${ms} ms) | conv=${res.converged} | N=${res.totalStagesUsed} Nf=${res.feedStageUsed} | RR=${res.actualRefluxRatio.toFixed(2)} | D/F=${res.actualDOverFMass.toFixed(4)} | cands=${cands.length} | ${topSummary} | ${botSummary}`
  );
  for (const c of cands) {
    console.log(
      `       cand[${c.id}] ${c.recommended ? '*' : ' '} N=${c.stagesN} Nf=${c.feedStage} RR=${c.refluxRatio.toFixed(2)} (${c.rOverRmin}x) Q=${c.reboilerDutyKW.toFixed(0)}kW D=${c.estimatedDiameterM.toFixed(2)}m TAC=${c.tacKUsdYr}k$/yr (idx=${c.tacIndex}) met=${c.specsMet} :: ${c.label}`
    );
  }
}

async function main() {
  // ── Case 1A: MeOH / H2O Dual-Purity (99.9 / 99.9 wt%, NRTL, design_stages auto_opt) ──
  const meohFeed: DistillFeedInput[] = [{
    edgeId: 'f1',
    streamNo: 'S1',
    stage: 12,
    tempC: 72,
    pressKgcm2g: 0.3,
    flowsKgH: zeroFlows({ MeOH: 5000, H2O: 5000 }),
  }];
  let t0 = Date.now();
  const r1a = solveRigorousDistillation(meohFeed, {
    columnCalcMode: 'design_stages',
    designRefluxMode: 'auto_opt',
    thermoModel: 'NRTL',
    topPressKgcm2g: 0.1,
    murphreeEffPct: 75,
    designLkComp: 'MeOH',
    designHkComp: 'H2O',
    designTopBasis: 'purity_wt_pct',
    designTopPurityWtPct: 99.9,
    designBotBasis: 'purity_wt_pct',
    designBotPurityWtPct: 99.9,
  });
  let ms = Date.now() - t0;
  assert.ok(ms < 3500, `Case 1A slow: ${ms}ms`);
  assert.equal(r1a.converged, true, 'Case 1A converged');
  assert.equal(r1a.shortcutDesign?.designMet, true, 'Case 1A designMet');
  assert.ok((r1a.shortcutDesign?.candidates?.length ?? 0) >= 3, 'Case 1A >= 3 candidates');
  const rec1a = r1a.shortcutDesign?.candidates?.find(c => c.recommended);
  assert.ok(rec1a && Math.abs(rec1a.tacIndex - 100) < 0.2, 'Case 1A recommended tacIndex = 100');
  assert.ok(wtPct(r1a.distillateFlowsKgH, 'MeOH') >= 99.85, 'Case 1A MeOH top >= 99.85');
  assert.ok(wtPct(r1a.bottomsFlowsKgH, 'H2O') >= 99.85, 'Case 1A H2O bot >= 99.85');
  logCase('1A MeOH/H2O design_stages auto_opt', ms, r1a, `MeOH=${wtPct(r1a.distillateFlowsKgH, 'MeOH').toFixed(3)}%`, `H2O=${wtPct(r1a.bottomsFlowsKgH, 'H2O').toFixed(3)}%`);

  // ── Case 1B: MeOH / H2O Dual-Purity in rigorous_mesh starting with infeasible totalStages=10 ──
  t0 = Date.now();
  const r1b = solveRigorousDistillation(meohFeed, {
    columnCalcMode: 'rigorous_mesh',
    thermoModel: 'NRTL',
    topPressKgcm2g: 0.1,
    totalStages: 10,
    feedStage: 5,
    activeDofSlots: ['top_spec', 'bot_spec'],
    topQualityComp: 'MeOH',
    topQualityMetric: 'purity_wt_pct',
    topQualityTarget: 99.9,
    botQualityComp: 'H2O',
    botQualityMetric: 'purity_wt_pct',
    botQualityTarget: 99.9,
  });
  ms = Date.now() - t0;
  assert.ok(ms < 3500, `Case 1B slow: ${ms}ms`);
  assert.equal(r1b.converged, true, 'Case 1B converged');
  assert.equal(r1b.autoStageOptimized, true, 'Case 1B autoStageOptimized');
  assert.ok(r1b.totalStagesUsed > 10, 'Case 1B raised N above 10');
  assert.equal(r1b.spec1Status?.met, true, 'Case 1B spec1 met');
  assert.equal(r1b.spec2Status?.met, true, 'Case 1B spec2 met');
  assert.ok((r1b.dualSpecCandidates?.length ?? 0) >= 3, 'Case 1B >= 3 dualSpecCandidates');
  logCase('1B MeOH/H2O rigorous_mesh dual-spec (init N=10)', ms, r1b, `MeOH=${wtPct(r1b.distillateFlowsKgH, 'MeOH').toFixed(3)}%`, `H2O=${wtPct(r1b.bottomsFlowsKgH, 'H2O').toFixed(3)}%`);

  // ── Case 2: CH2Cl2 / CHCl3 Ultra-High Purity (99.99 / 99.95 wt%, NRTL, 2.0 kG) ──
  const dcmCfFeed: DistillFeedInput[] = [{
    edgeId: 'f2',
    streamNo: 'S2',
    stage: 20,
    tempC: 70,
    pressKgcm2g: 2.2,
    flowsKgH: zeroFlows({ CH2Cl2: 5000, CHCl3: 3333 }),
  }];
  t0 = Date.now();
  const r2 = solveRigorousDistillation(dcmCfFeed, {
    columnCalcMode: 'rigorous_mesh',
    thermoModel: 'NRTL',
    topPressKgcm2g: 2.0,
    totalStages: 24,
    feedStage: 12,
    activeDofSlots: ['top_spec', 'bot_spec'],
    topQualityComp: 'CH2Cl2',
    topQualityMetric: 'purity_wt_pct',
    topQualityTarget: 99.99,
    botQualityComp: 'CHCl3',
    botQualityMetric: 'purity_wt_pct',
    botQualityTarget: 99.95,
  });
  ms = Date.now() - t0;
  assert.ok(ms < 3500, `Case 2 slow: ${ms}ms`);
  assert.equal(r2.converged, true, 'Case 2 converged');
  assert.equal(r2.spec1Status?.met, true, 'Case 2 spec1 met');
  assert.equal(r2.spec2Status?.met, true, 'Case 2 spec2 met');
  assert.ok(wtPct(r2.distillateFlowsKgH, 'CH2Cl2') >= 99.985, `Case 2 CH2Cl2=${wtPct(r2.distillateFlowsKgH, 'CH2Cl2')}`);
  assert.ok(wtPct(r2.bottomsFlowsKgH, 'CHCl3') >= 99.94, `Case 2 CHCl3=${wtPct(r2.bottomsFlowsKgH, 'CHCl3')}`);
  logCase('2 CH2Cl2/CHCl3 99.99/99.95%', ms, r2, `DCM=${wtPct(r2.distillateFlowsKgH, 'CH2Cl2').toFixed(4)}%`, `CFM=${wtPct(r2.bottomsFlowsKgH, 'CHCl3').toFixed(4)}%`);

  // ── Case 3: CHCl3 / CCl4 Close-Boiling (low alpha ~1.6, 99.95 / 99.90 wt%, NRTL, breaks N=56 cap!) ──
  const cfCtcFeed: DistillFeedInput[] = [{
    edgeId: 'f3',
    streamNo: 'S3',
    stage: 20,
    tempC: 75,
    pressKgcm2g: 0.6,
    flowsKgH: zeroFlows({ CHCl3: 3400, CCl4: 600 }),
  }];
  t0 = Date.now();
  const r3 = solveRigorousDistillation(cfCtcFeed, {
    columnCalcMode: 'design_stages',
    designRefluxMode: 'auto_opt',
    thermoModel: 'NRTL',
    topPressKgcm2g: 0.5,
    murphreeEffPct: 68,
    designLkComp: 'CHCl3',
    designHkComp: 'CCl4',
    designTopBasis: 'purity_wt_pct',
    designTopPurityWtPct: 99.95,
    designBotBasis: 'purity_wt_pct',
    designBotPurityWtPct: 99.9,
  });
  ms = Date.now() - t0;
  assert.ok(ms < 8500, `Case 3 slow: ${ms}ms`);
  assert.equal(r3.converged, true, 'Case 3 converged');
  assert.equal(r3.shortcutDesign?.designMet, true, 'Case 3 designMet');
  assert.ok((r3.shortcutDesign?.candidates?.length ?? 0) >= 3, 'Case 3 >= 3 candidates');
  assert.ok(r3.totalStagesUsed > 56, `Case 3 N=${r3.totalStagesUsed} should exceed old 56 cap`);
  assert.ok(wtPct(r3.distillateFlowsKgH, 'CHCl3') >= 99.93, `Case 3 CHCl3=${wtPct(r3.distillateFlowsKgH, 'CHCl3')}`);
  assert.ok(wtPct(r3.bottomsFlowsKgH, 'CCl4') >= 99.85, `Case 3 CCl4=${wtPct(r3.bottomsFlowsKgH, 'CCl4')}`);
  logCase('3 CHCl3/CCl4 low-alpha (N>56)', ms, r3, `CHCl3=${wtPct(r3.distillateFlowsKgH, 'CHCl3').toFixed(3)}%`, `CCl4=${wtPct(r3.bottomsFlowsKgH, 'CCl4').toFixed(3)}%`);

  // ── Case 4: Benzene / Toluene Dual-Impurity PPM (<= 500 ppm Toluene in Top, <= 500 ppm Benzene in Bot, PENG_ROB) ──
  const btxFeed: DistillFeedInput[] = [{
    edgeId: 'f4',
    streamNo: 'S4',
    stage: 10,
    tempC: 92,
    pressKgcm2g: 0.2,
    flowsKgH: zeroFlows({ Benzene: 4500, Toluene: 4500 }),
  }];
  t0 = Date.now();
  const r4 = solveRigorousDistillation(btxFeed, {
    columnCalcMode: 'rigorous_mesh',
    thermoModel: 'PENG_ROB',
    topPressKgcm2g: 0.1,
    totalStages: 12,
    feedStage: 6,
    activeDofSlots: ['top_spec', 'bot_spec'],
    topQualityComp: 'Toluene',
    topQualityMetric: 'impurity_wt_ppm',
    topQualityTarget: 500,
    botQualityComp: 'Benzene',
    botQualityMetric: 'impurity_wt_ppm',
    botQualityTarget: 500,
  });
  ms = Date.now() - t0;
  assert.ok(ms < 3500, `Case 4 slow: ${ms}ms`);
  assert.equal(r4.converged, true, 'Case 4 converged');
  assert.equal(r4.spec1Status?.met, true, 'Case 4 top ppm spec met');
  assert.equal(r4.spec2Status?.met, true, 'Case 4 bot ppm spec met');
  assert.ok(wtPpm(r4.distillateFlowsKgH, 'Toluene') <= 515, `Case 4 top Tol ppm=${wtPpm(r4.distillateFlowsKgH, 'Toluene')}`);
  assert.ok(wtPpm(r4.bottomsFlowsKgH, 'Benzene') <= 515, `Case 4 bot Bz ppm=${wtPpm(r4.bottomsFlowsKgH, 'Benzene')}`);
  logCase('4 Benzene/Toluene dual-ppm', ms, r4, `TolInTop=${wtPpm(r4.distillateFlowsKgH, 'Toluene').toFixed(1)}ppm`, `BzInBot=${wtPpm(r4.bottomsFlowsKgH, 'Benzene').toFixed(1)}ppm`);

  // ── Case 5: tpl_c230_hcl preset backward-compatibility check ──
  const tplHcl = PLANT_UNIT_TEMPLATES.find(t => t.id === 'tpl_c230_hcl')!;
  const tplHclFeed = tplHcl.inletFeed!;
  assert.ok(tplHcl && tplHclFeed, 'tpl_c230_hcl exists');
  t0 = Date.now();
  const r5 = solveRigorousDistillation(
    [{
      edgeId: 'f5',
      streamNo: 'S2-05',
      stage: 6,
      tempC: tplHclFeed.tempC,
      pressKgcm2g: tplHclFeed.pressKgcm2g,
      flowsKgH: zeroFlows(tplHclFeed.flowsKgH),
    }],
    tplHcl.params.distillConfig!
  );
  ms = Date.now() - t0;
  assert.equal(r5.converged, true, 'Case 5 tpl_c230_hcl converged');
  assert.equal(r5.shortcutDesign?.designMet, true, 'Case 5 tpl_c230_hcl designMet');
  logCase('5 tpl_c230_hcl mixed recovery+purity', ms, r5, `O2rec=${r5.shortcutDesign?.topLkRecoveryPct}%`, `HCl=${r5.shortcutDesign?.botHkPurityWtPct}%`);

  // ── Case 6: AI Auto-Fix preserves dual purity specs when fixed-N fails ──
  const fixOut = await autoFixDistillationSimulationAsync(meohFeed, {
    columnCalcMode: 'rigorous_mesh',
    thermoModel: 'NRTL',
    topPressKgcm2g: 0.1,
    totalStages: 8,
    feedStage: 4,
    autoOptimizeStagesOnDualSpec: false,
    activeDofSlots: ['top_spec', 'bot_spec'],
    topQualityComp: 'MeOH',
    topQualityMetric: 'purity_wt_pct',
    topQualityTarget: 99.9,
    botQualityComp: 'H2O',
    botQualityMetric: 'purity_wt_pct',
    botQualityTarget: 99.9,
  });
  assert.equal(fixOut.resolved, true, `Case 6 AI AutoFix resolved: ${fixOut.headline}`);
  assert.equal(fixOut.solvedAfter.diagnostics.level, 'ok', 'Case 6 diagnostics ok');
  assert.notDeepEqual(fixOut.patch.activeDofSlots, ['rr', 'split'], 'Case 6 must not erase dual purity specs to [rr, split]');
  console.log(`[PASS] 6 AI AutoFix dual-purity preserved | resolved=${fixOut.resolved} | N=${fixOut.solvedAfter.totalStagesUsed} | ${fixOut.headline}`);

  console.log('\nALL DUAL-PURITY MULTI-CANDIDATE AUTO-DESIGN VALIDATIONS PASSED!');
}

main().catch((err) => {
  console.error('VALIDATION FAILED:', err);
  process.exit(1);
});

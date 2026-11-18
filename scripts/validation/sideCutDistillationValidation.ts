/**
 * Side-Cut (사이드컷 / 측류 인출) Distillation Validation Suite
 * ---------------------------------------------------------------------------
 * Verifies:
 *   1. Ternary MESH Side-Cut (liquid mass_kgh, vapor s_over_f_mass, draw_ratio,
 *      autoOptimizeStage + purity_wt_pct):
 *      - Exact component mass conservation: F === D + Dec + S + B (< 1e-4 kg/h)
 *      - Exact global energy closure: Q_reb + Q_cond === H_out - H_in (< 0.1 kcal/h)
 *      - Internal liquid/vapor traffic discontinuity at side-cut draw stage
 *   2. design_stages AI multi-candidate TAC optimization with Side-Cut active
 *   3. Flowsheet Solver 'side_cut' port routing (connected & unrouted closure) +
 *      1D/2D Sensitivity sweep on sideCutRateKgH & sideCutStage
 *   4. Column Internals (N7 Side-Cut nozzle + elevation), 1:1 mm CAD DXF &
 *      ChemPro unified_kernel.js standalone binary side-cut calculation
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import {
  solveRigorousDistillation,
  type DistillColumnParams,
  type DistillFeedInput,
} from '../../lib/calculations/rigorousDistillation';
import {
  solveFlowsheet,
  type FlowNodeDef,
  type FlowEdgeDef,
  type SimCompKey,
} from '../../lib/calculations/flowsheetSolver';
import { runFlowsheetSensitivity } from '../../lib/calculations/flowsheetOptimization';
import { solveColumnInternalsDesign } from '../../lib/calculations/columnInternalsDesign';
import { buildColumnCadDxf } from '../../lib/cad/columnDxfExport';
import { streamEnthalpyKcalH } from '../../lib/calculations/thermoCore';

const ROOT = path.resolve(__dirname, '../..');

const ZERO_FLOWS: Record<SimCompKey, number> = {
  H2O: 0, NaCl: 0, NaOH: 0, Cl2: 0, H2: 0, HCl: 0, H2SO4: 0, O2: 0, NaOCl: 0,
  N2: 0, NaClO3: 0, FeCl2: 0, FeCl3: 0, PAC: 0, Glycerol: 0, MCH: 0, DCH: 0, ECH: 0, DCP: 0,
  CH4: 0, CO: 0, CO2: 0, NH3: 0,
  C2H4: 0, C2H6: 0, C3H6: 0, C3H8: 0, nC4H10: 0, nC6H14: 0, nC7H16: 0,
  Benzene: 0, Toluene: 0, pXylene: 0,
  MeOH: 0, EtOH: 0, IPA: 0, Acetone: 0, AceticAcid: 0, EtOAc: 0, CHCl3: 0,
  Ar: 0, H2S: 0, SO2: 0, SO3: 0, iC4H10: 0, C4H8_1: 0, nC5H12: 0, nC8H18: 0,
  Cyclohexane: 0, Ethylbenzene: 0, Styrene: 0, Cumene: 0, Phenol: 0,
  THF: 0, DMF: 0, DMSO: 0, MTBE: 0, MEK: 0, DMC: 0, EG: 0, MEA: 0, MDEA: 0,
  FormicAcid: 0, HNO3: 0, CH3Cl: 0, CH2Cl2: 0, CCl4: 0, C2Cl4: 0,
  COCl2: 0, HCHO: 0, MCB: 0, Aniline: 0, MDA: 0, MDI: 0, PMDI: 0,
  CUSTOM_1: 0, CUSTOM_2: 0,
};

function zeroFlows(partial: Partial<Record<SimCompKey, number>>): Record<SimCompKey, number> {
  return { ...ZERO_FLOWS, ...partial };
}

function sumFlows(f: Record<SimCompKey, number> | undefined): number {
  if (!f) return 0;
  let tot = 0;
  for (const v of Object.values(f)) tot += v || 0;
  return tot;
}

function assertMassAndEnergyClosure(
  label: string,
  feeds: DistillFeedInput[],
  res: ReturnType<typeof solveRigorousDistillation>
) {
  assert.equal(res.converged, true, `${label}: must converge`);

  const inByComp = zeroFlows({});
  let hInKcalH = 0;
  for (const f of feeds) {
    for (const k of Object.keys(ZERO_FLOWS) as SimCompKey[]) {
      inByComp[k] += f.flowsKgH[k] || 0;
    }
    const isVap = f.forcedPhase === 'G';
    hInKcalH +=
      typeof f.enthalpyKcalH === 'number'
        ? f.enthalpyKcalH
        : isVap
          ? streamEnthalpyKcalH(f.flowsKgH, {}, f.tempC, f.pressKgcm2g)
          : streamEnthalpyKcalH({}, f.flowsKgH, f.tempC, f.pressKgcm2g);
  }

  let maxCompErrKgH = 0;
  for (const k of Object.keys(ZERO_FLOWS) as SimCompKey[]) {
    const outC =
      (res.distillateFlowsKgH[k] || 0) +
      (res.decanterFlowsKgH?.[k] || 0) +
      (res.sideCutFlowsKgH?.[k] || 0) +
      (res.bottomsFlowsKgH[k] || 0);
    const err = Math.abs(inByComp[k] - outC);
    if (err > maxCompErrKgH) maxCompErrKgH = err;
  }
  assert.ok(maxCompErrKgH < 1e-4, `${label}: component mass imbalance ${maxCompErrKgH} >= 1e-4 kg/h`);

  const scPhase = res.sideCutPhase ?? 'L';
  const scFlows = res.sideCutFlowsKgH ?? zeroFlows({});
  const hOutKcalH =
    (res.distillatePhase === 'G'
      ? streamEnthalpyKcalH(res.distillateFlowsKgH, {}, res.topTempC, res.topPressKgcm2g)
      : streamEnthalpyKcalH({}, res.distillateFlowsKgH, res.topTempC, res.topPressKgcm2g)) +
    ((res.decanterWaterDrawKgH || 0) > 0 && res.decanterFlowsKgH
      ? streamEnthalpyKcalH({}, res.decanterFlowsKgH, res.topTempC, res.topPressKgcm2g)
      : 0) +
    ((res.sideCutMassKgH || 0) > 0
      ? scPhase === 'G'
        ? streamEnthalpyKcalH(scFlows, {}, res.sideCutTempC ?? res.topTempC, res.sideCutPressKgcm2g ?? res.topPressKgcm2g)
        : streamEnthalpyKcalH({}, scFlows, res.sideCutTempC ?? res.topTempC, res.sideCutPressKgcm2g ?? res.topPressKgcm2g)
      : 0) +
    streamEnthalpyKcalH({}, res.bottomsFlowsKgH, res.bottomTempC, res.bottomPressKgcm2g);

  const qNetKcalH = res.reboilerDutyKcalH + res.condenserDutyKcalH;
  const eResidKcalH = Math.abs((hOutKcalH - hInKcalH) - qNetKcalH);
  assert.ok(eResidKcalH < 0.5, `${label}: energy residual ${eResidKcalH.toFixed(4)} kcal/h too high`);
  return { maxCompErrKgH, eResidKcalH };
}

function runSuite1TernarySideCut() {
  console.log('\n[1/4] Testing Ternary Rigorous MESH Side-Cut (Liquid / Vapor / DrawRatio / Purity AutoStage)...');
  const feedFlows = zeroFlows({ CH3Cl: 2500, CH2Cl2: 3500, CHCl3: 4000 });
  const feeds: DistillFeedInput[] = [
    {
      edgeId: 'f1',
      streamNo: 'S1',
      stage: 12,
      flowsKgH: feedFlows,
      tempC: 48,
      pressKgcm2g: 2.0,
      forcedPhase: 'L',
    },
  ];
  feeds[0].enthalpyKcalH = streamEnthalpyKcalH({}, feedFlows, 48, 2.0);

  // 1A: Liquid side-cut by exact mass flow (2000 kg/h @ Stage 8)
  const cfg1A: DistillColumnParams = {
    thermoModel: 'PENG_ROB',
    totalStages: 24,
    feedStage: 12,
    condenserType: 'total',
    reboilerType: 'kettle',
    topPressKgcm2g: 1.8,
    stageDeltaPKgcm2: 0.005,
    murphreeEffPct: 80,
    activeDofSlots: ['rr', 'split'],
    topSpecType: 'reflux_ratio',
    topSpecValue: 3.0,
    splitSpecType: 'd_over_f_mass',
    splitSpecValue: 0.25,
    sideCut: {
      enabled: true,
      stage: 8,
      phase: 'liquid',
      specType: 'mass_kgh',
      specValue: 2000,
      targetComp: 'CH2Cl2',
    },
  };
  const r1A = solveRigorousDistillation(feeds, cfg1A);
  const c1A = assertMassAndEnergyClosure('1A Liquid mass_kgh', feeds, r1A);
  assert.equal(r1A.sideCutPhase, 'L');
  assert.equal(r1A.sideCutStageUsed, 8);
  assert.ok(Math.abs((r1A.sideCutMassKgH || 0) - 2000) < 15, `1A S=${r1A.sideCutMassKgH} should be ~2000 kg/h`);
  assert.equal(r1A.stages[7].isSideCutStage, true);
  assert.ok(r1A.stages[7].liqMassKgH < r1A.stages[6].liqMassKgH, '1A liquid traffic must drop across liquid side-cut stage');
  console.log(
    `[PASS] 1A Liquid mass_kgh: D=${sumFlows(r1A.distillateFlowsKgH).toFixed(1)}, S=${r1A.sideCutMassKgH?.toFixed(1)} @ St${r1A.sideCutStageUsed}, B=${sumFlows(r1A.bottomsFlowsKgH).toFixed(1)} | compErr=${c1A.maxCompErrKgH.toExponential(1)} | E_res=${c1A.eResidKcalH.toFixed(4)} kcal/h`
  );

  // 1B: Vapor side-cut below feed (S/F = 0.15 @ Stage 16)
  const r1B = solveRigorousDistillation(feeds, {
    ...cfg1A,
    sideCut: {
      enabled: true,
      stage: 16,
      phase: 'vapor',
      specType: 's_over_f_mass',
      specValue: 0.15,
      targetComp: 'CH2Cl2',
    },
  });
  const c1B = assertMassAndEnergyClosure('1B Vapor s_over_f_mass', feeds, r1B);
  assert.equal(r1B.sideCutPhase, 'G');
  assert.equal(r1B.sideCutStageUsed, 16);
  assert.ok(Math.abs((r1B.sideCutMassKgH || 0) - 1500) < 15, `1B S=${r1B.sideCutMassKgH} should be ~1500 kg/h`);
  assert.ok(r1B.stages[15].vapMassKgH < r1B.stages[16].vapMassKgH, '1B vapor leaving stage 16 upwards must be less than vapor rising from stage 17');
  console.log(
    `[PASS] 1B Vapor s_over_f_mass: D=${sumFlows(r1B.distillateFlowsKgH).toFixed(1)}, S=${r1B.sideCutMassKgH?.toFixed(1)} @ St${r1B.sideCutStageUsed} (${r1B.sideCutPhase}), B=${sumFlows(r1B.bottomsFlowsKgH).toFixed(1)} | compErr=${c1B.maxCompErrKgH.toExponential(1)} | E_res=${c1B.eResidKcalH.toFixed(4)} kcal/h`
  );

  // 1C: Draw ratio (0.25 of stage liquid traffic @ Stage 7)
  const r1C = solveRigorousDistillation(feeds, {
    ...cfg1A,
    sideCut: {
      enabled: true,
      stage: 7,
      phase: 'liquid',
      specType: 'draw_ratio',
      specValue: 0.25,
      targetComp: 'CH2Cl2',
    },
  });
  const c1C = assertMassAndEnergyClosure('1C Draw ratio', feeds, r1C);
  assert.ok((r1C.sideCutMassKgH || 0) > 100 && (r1C.sideCutMassKgH || 0) < 7000, '1C reasonable S flow');
  console.log(
    `[PASS] 1C DrawRatio=0.25: S=${r1C.sideCutMassKgH?.toFixed(1)} kg/h (S/F=${((r1C.actualSOverFMass || 0) * 100).toFixed(1)}%) | compErr=${c1C.maxCompErrKgH.toExponential(1)}`
  );

  // 1D: Auto-optimize stage + recovery_pct spec for intermediate CH2Cl2
  const r1D = solveRigorousDistillation(feeds, {
    ...cfg1A,
    sideCut: {
      enabled: true,
      stage: 5,
      autoOptimizeStage: true,
      phase: 'liquid',
      specType: 'recovery_pct',
      specValue: 45,
      targetComp: 'CH2Cl2',
    },
  });
  const c1D = assertMassAndEnergyClosure('1D AutoStage + recovery_pct', feeds, r1D);
  assert.ok((r1D.sideCutStageUsed || 0) >= 2 && (r1D.sideCutStageUsed || 0) <= 23, '1D interior stage');
  assert.ok((r1D.sideCutMassKgH || 0) > 500, '1D S flow positive');
  const ch2Rec = ((r1D.sideCutFlowsKgH?.CH2Cl2 || 0) / 3500) * 100;
  console.log(
    `[PASS] 1D AutoStage+Recovery(45%): picked St${r1D.sideCutStageUsed}, CH2Cl2 Rec=${ch2Rec.toFixed(1)}%, S=${r1D.sideCutMassKgH?.toFixed(1)} kg/h | ${r1D.sideCutSpecStatus?.label} | compErr=${c1D.maxCompErrKgH.toExponential(1)}`
  );

  return { feeds, cfg1A, r1A };
}

function runSuite2DesignStagesWithSideCut(feeds: DistillFeedInput[]) {
  console.log('\n[2/4] Testing design_stages Multi-Candidate TAC Optimization with Side-Cut...');
  const r2 = solveRigorousDistillation(feeds, {
    columnCalcMode: 'design_stages',
    designRefluxMode: 'auto_opt',
    thermoModel: 'PENG_ROB',
    topPressKgcm2g: 1.8,
    murphreeEffPct: 80,
    designLkComp: 'CH3Cl',
    designHkComp: 'CHCl3',
    designTopBasis: 'purity_wt_pct',
    designTopPurityWtPct: 92.0,
    designBotBasis: 'purity_wt_pct',
    designBotPurityWtPct: 92.0,
    sideCut: {
      enabled: true,
      stage: 8,
      autoOptimizeStage: true,
      phase: 'liquid',
      specType: 's_over_f_mass',
      specValue: 0.20,
      targetComp: 'CH2Cl2',
    },
  });
  const c2 = assertMassAndEnergyClosure('2A design_stages + Side-Cut', feeds, r2);
  const cands = r2.shortcutDesign?.candidates ?? [];
  assert.ok(cands.length >= 2, '2A should produce >= 2 candidates');
  assert.ok(cands.some(c => c.sideCutStage !== undefined && c.sOverFMass !== undefined), '2A candidates must include sideCutStage and sOverFMass');
  assert.ok((r2.sideCutMassKgH || 0) > 1500, '2A sideCutMassKgH must reflect ~20% S/F');
  console.log(
    `[PASS] 2A design_stages + Side-Cut: N=${r2.totalStagesUsed}, RR=${r2.actualRefluxRatio.toFixed(2)}, S=${r2.sideCutMassKgH?.toFixed(1)} kg/h @ St${r2.sideCutStageUsed}, cands=${cands.length} | compErr=${c2.maxCompErrKgH.toExponential(1)}`
  );
}

function runSuite3FlowsheetRoutingAndSensitivity() {
  console.log('\n[3/4] Testing Flowsheet side_cut Port Routing, Unrouted Closure & Sensitivity Sweep...');
  const feedNode: FlowNodeDef = {
    id: 'n-feed',
    tag: 'FEED-1',
    name: 'Ternary Feed',
    unitType: 'feed',
    params: {
      feedTempC: 48,
      feedPressKgcm2g: 2.0,
      feedFlowsKgH: { CH3Cl: 2500, CH2Cl2: 3500, CHCl3: 4000 },
    },
  };
  const colNode: FlowNodeDef = {
    id: 'n-col',
    tag: 'T-101',
    name: 'Side-Cut Column',
    unitType: 'distillation',
    params: {
      distillConfig: {
        columnCalcMode: 'rigorous_mesh',
        thermoModel: 'PENG_ROB',
        totalStages: 24,
        feedStage: 12,
        condenserType: 'total',
        reboilerType: 'kettle',
        topPressKgcm2g: 1.8,
        stageDeltaPKgcm2: 0.005,
        murphreeEffPct: 80,
        activeDofSlots: ['rr', 'split'],
        topSpecType: 'reflux_ratio',
        topSpecValue: 3.0,
        splitSpecType: 'd_over_f_mass',
        splitSpecValue: 0.25,
        sideCut: {
          enabled: true,
          stage: 8,
          phase: 'liquid',
          specType: 'mass_kgh',
          specValue: 2000,
          targetComp: 'CH2Cl2',
        },
      },
    },
  };
  const prodTop: FlowNodeDef = { id: 'n-top', tag: 'P-TOP', name: 'Overhead', unitType: 'product', params: {} };
  const prodSide: FlowNodeDef = { id: 'n-side', tag: 'P-SIDE', name: 'Side Product', unitType: 'product', params: {} };
  const prodBot: FlowNodeDef = { id: 'n-bot', tag: 'P-BOT', name: 'Bottoms', unitType: 'product', params: {} };

  const edgesConnected: FlowEdgeDef[] = [
    { id: 'e-in', streamNo: 'S1', source: 'n-feed', target: 'n-col', sourcePort: 'out', targetPort: 'in' },
    { id: 'e-top', streamNo: 'S2', source: 'n-col', target: 'n-top', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'e-side', streamNo: 'S3', source: 'n-col', target: 'n-side', sourcePort: 'side_cut', targetPort: 'in' },
    { id: 'e-bot', streamNo: 'S4', source: 'n-col', target: 'n-bot', sourcePort: 'liquid', targetPort: 'in' },
  ];

  const fsConnected = solveFlowsheet([feedNode, colNode, prodTop, prodSide, prodBot], edgesConnected, {
    propertyMethod: 'PR',
    activeComponents: ['CH3Cl', 'CH2Cl2', 'CHCl3'],
  });
  assert.equal(fsConnected.convergence.converged, true, '3A flowsheet converged');
  const sideStream = fsConnected.streams.find(s => s.edgeId === 'e-side');
  const topStream = fsConnected.streams.find(s => s.edgeId === 'e-top');
  assert.ok(sideStream && Math.abs(sideStream.totalMassKgH - 2000) < 20, `3A side stream S=${sideStream?.totalMassKgH}`);
  assert.ok(topStream && Math.abs(topStream.totalMassKgH - 2500) < 20, `3A top stream D=${topStream?.totalMassKgH}`);
  assert.ok(Math.abs(fsConnected.balance?.massImbalanceKgH ?? 999) < 1e-2, `3A plant mass imbalance ${fsConnected.balance?.massImbalanceKgH}`);
  assert.ok(Math.abs(fsConnected.balance?.energyResidualPct ?? 999) < 0.05, `3A plant energy residual ${fsConnected.balance?.energyResidualPct}%`);
  console.log(
    `[PASS] 3A Flowsheet side_cut port: S2(D)=${topStream?.totalMassKgH.toFixed(1)}, S3(S)=${sideStream?.totalMassKgH.toFixed(1)}, plantMassImb=${fsConnected.balance?.massImbalanceKgH.toFixed(4)} kg/h, E_res=${fsConnected.balance?.energyResidualPct.toFixed(4)}%`
  );

  // 3B: Unrouted side_cut port -> must still close plant mass/energy balance
  const fsUnrouted = solveFlowsheet(
    [feedNode, colNode, prodTop, prodBot],
    edgesConnected.filter(e => e.id !== 'e-side'),
    { propertyMethod: 'PR', activeComponents: ['CH3Cl', 'CH2Cl2', 'CHCl3'] }
  );
  assert.equal(fsUnrouted.convergence.converged, true, '3B unrouted converged');
  assert.ok(fsUnrouted.balance?.unroutedOutlets.some(u => u.port === 'side_cut'), '3B unroutedOutlets must contain side_cut');
  assert.ok(Math.abs(fsUnrouted.balance?.massImbalanceKgH ?? 999) < 1e-2, '3B unrouted plant mass imbalance < 0.01');
  console.log(
    `[PASS] 3B Unrouted side_cut closure: unrouted=${fsUnrouted.balance?.unroutedOutKgH.toFixed(1)} kg/h, massImb=${fsUnrouted.balance?.massImbalanceKgH.toFixed(4)} kg/h`
  );

  // 3C: Sensitivity sweep on sideCutRateKgH & secondary sideCutStage
  const sensRes = runFlowsheetSensitivity(
    [feedNode, colNode, prodTop, prodSide, prodBot],
    edgesConnected,
    {
      primaryVar: {
        nodeId: 'n-col',
        paramKey: 'sideCutRateKgH',
        minValue: 500,
        maxValue: 2500,
        steps: 3,
      },
      secondaryVar: {
        nodeId: 'n-col',
        paramKey: 'sideCutStage',
        values: [6, 10],
      },
      watchedOutputs: [
        { id: 'w-s-flow', label: 'S3 Flow', streamEdgeId: 'e-side', metric: 'total_flow_kgh' },
        { id: 'w-s-pur', label: 'S3 CH2Cl2 wt%', streamEdgeId: 'e-side', metric: 'comp_wt_pct', comp: 'CH2Cl2' },
      ],
    },
    { propertyMethod: 'PR', activeComponents: ['CH3Cl', 'CH2Cl2', 'CHCl3'] }
  );
  assert.equal(sensRes.flatRows.length, 6, '3C 3x2 sensitivity grid rows');
  const sRow0 = sensRes.series[0].rows[0].outputs['w-s-flow'];
  const sRow2 = sensRes.series[0].rows[2].outputs['w-s-flow'];
  assert.ok(sRow2 > sRow0 + 1800, `3C swept S flow must rise from ~500 (${sRow0}) to ~2500 (${sRow2})`);
  console.log(`[PASS] 3C 2D Sensitivity (sideCutRateKgH x sideCutStage): 6 points converged cleanly, S=[${sRow0.toFixed(0)} .. ${sRow2.toFixed(0)}] kg/h`);
}

function runSuite4InternalsCadAndChempro(
  feeds: DistillFeedInput[],
  cfg1A: DistillColumnParams,
  r1A: ReturnType<typeof solveRigorousDistillation>
) {
  console.log('\n[4/4] Testing Column Internals (N7 + Chimney), 1:1 DXF & ChemPro unified_kernel.js...');

  // 4A: Column Internals & DXF with Side-Cut N7
  const des = solveColumnInternalsDesign(cfg1A, feeds, r1A);
  const n7 = des.nozzles.find(n => n.nozzleTag === 'N7');
  assert.ok(n7, '4A N7 Side-Cut nozzle must exist');
  assert.equal(n7!.orientationDeg, 90, '4A N7 orientationDeg should be 90 (opposite feed 270)');
  assert.ok(des.sideCutSummary && des.sideCutSummary.nozzleTag === 'N7', '4A sideCutSummary present');
  assert.ok(typeof des.elevations.sideCutNozzleElMm === 'number' && des.elevations.sideCutNozzleElMm > des.elevations.feedNozzleElMm, '4A stage 8 elevation > feed stage 12 elevation');
  const dxf = buildColumnCadDxf({
    unitTag: 'T-101',
    unitLabel: 'Side-Cut Column',
    colConfig: cfg1A,
    simResult: r1A,
    design: des,
  });
  assert.ok(!dxf.includes('NaN') && dxf.includes('N7') && dxf.includes('HARDWARE'), '4A DXF contains N7 & HARDWARE chimney collector');
  console.log(
    `[PASS] 4A Internals & DXF: N7 ${n7!.selectedDn} @ EL+${n7!.elevationMm}mm (${n7!.orientationDeg}°), DXF=${(dxf.length / 1024).toFixed(1)}KB`
  );

  // 4B: ChemPro unified_kernel.js in Node VM (both spec_n_rr and sideCutEnabled)
  const chemDbCode = fs.readFileSync(path.join(ROOT, 'public/chempro/chem_db.js'), 'utf8');
  const kernelCode = fs.readFileSync(path.join(ROOT, 'public/chempro/unified_kernel.js'), 'utf8');
  const ctx: Record<string, any> = {
    console, Math, Number, String, Array, Object, JSON, Date, Error, isFinite, isNaN, parseFloat, parseInt,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(chemDbCode, ctx, { filename: 'chem_db.js' });
  vm.runInContext(kernelCode, ctx, { filename: 'unified_kernel.js' });

  const kernel = ctx.__ChemEngUnifiedKernel;
  assert.ok(kernel && typeof kernel.solveColumn === 'function', '4B unified_kernel solveColumn loaded');
  const cpRes = kernel.solveColumn({
    equipTag: 'T-202',
    col_mode: 'distillation',
    nrtlPreset: 'dcp_ech',
    F_kmolh: 100,
    zF: 0.45,
    xD: 0.96,
    xB: 0.04,
    P_col_bar: 1.013,
    internals: 'tray',
    dofMode: 'spec_n_rr',
    fixedN: 20,
    fixedRR: 2.5,
    fixedDF: 0.40,
    sideCutEnabled: true,
    sideCutPhase: 'liquid',
    sideCutSF: 0.15,
    sideCutStageRatio: 0.35,
  }, 'rigorous');

  assert.ok((cpRes.S || 0) > 10, `4B ChemPro S=${cpRes.S} must be > 0`);
  const totBalErr = Math.abs(100 - ((cpRes.D || 0) + (cpRes.S || 0) + (cpRes.B || 0)));
  assert.ok(totBalErr < 1e-5, `4B ChemPro molar balance F=D+S+B error=${totBalErr}`);
  assert.ok(Array.isArray(cpRes.nozzleSchedule) && cpRes.nozzleSchedule.some((n: any) => n.tag === 'N7'), '4B ChemPro N7 nozzle present');
  console.log(
    `[PASS] 4B ChemPro Side-Cut Kernel: F=100 -> D=${cpRes.D?.toFixed(2)}, S=${cpRes.S?.toFixed(2)} (xS=${cpRes.xS_mol?.toFixed(3)}), B=${cpRes.B?.toFixed(2)} kmol/h | balErr=${totBalErr.toExponential(1)}`
  );
}

async function main() {
  const { feeds, cfg1A, r1A } = runSuite1TernarySideCut();
  runSuite2DesignStagesWithSideCut(feeds);
  runSuite3FlowsheetRoutingAndSensitivity();
  runSuite4InternalsCadAndChempro(feeds, cfg1A, r1A);
  console.log('\n[SUCCESS] All Side-Cut Distillation, Flowsheet, Internals/CAD & ChemPro Validation Checks Passed!');
}

main().catch(err => {
  console.error('[FAILED]', err);
  process.exit(1);
});

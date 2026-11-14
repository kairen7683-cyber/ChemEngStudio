/**
 * Phase 2 W9 Validation Suite:
 * 1. Simultaneous Multi-Tear Broyden vs Bounded Wegstein on Coupled 2-Loop Recycle Flowsheet
 * 2. 1D Design Spec (Secant + Brent Hybrid):
 *    - 2a: Recycle loop Splitter purge ratio -> inert Ar = 5.00 wt% (|achieved - 5.0| < 0.01)
 *    - 2b: HEX operTempC -> downstream Separator vapor recovery = 85.0%
 * 3. 2D Simultaneous Design Spec (Bounded Damped Broyden Jacobian):
 *    - Simultaneous 2-parameter control -> total product flow = 1000.0 kg/h AND concentration = 32.0 wt%
 * 4. 1D/2D Sensitivity Analysis:
 *    - 10-step condenser/flash HEX operTempC sweep -> strictly monotonic vapor recovery & heat duty curve
 * 5. Rigorous Adiabatic Joule-Thomson Expansion Valve:
 *    - High-pressure C3H8/CO2 stream throttled 25 -> 2 kgf/cm²G flashes & cools (T_out < T_in - 15 °C, |ΔH/H| < 0.05%)
 */

import {
  solveFlowsheet,
  type FlowNodeDef,
  type FlowEdgeDef,
} from '../../lib/calculations/flowsheetSolver';
import {
  BroydenTearAccelerator,
  solveFlowsheetWithDesignSpecs,
  runFlowsheetSensitivity,
  type DesignSpecDef,
} from '../../lib/calculations/flowsheetOptimization';

let passed = 0;
let failed = 0;

function assertCond(name: string, cond: boolean, detail: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ [PASS] ${name} — ${detail}`);
  } else {
    failed += 1;
    console.error(`  ❌ [FAIL] ${name} — ${detail}`);
  }
}

console.log('================================================================================');
console.log('  W9 VALIDATION: BROYDEN MULTI-TEAR, DESIGN SPEC, SENSITIVITY & JT VALVE');
console.log('================================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 0: Direct Mathematical Verification of BroydenTearAccelerator
// ─────────────────────────────────────────────────────────────────────────────
console.log('▶ [Test 0] BroydenTearAccelerator Sherman-Morrison & Spike Reset Unit Check');
{
  const accel = new BroydenTearAccelerator({ alpha0: 0.65, spikeResetFactor: 3.0 });
  // Strongly coupled 3D linear-nonlinear fixed point: g(x) = A x + b
  const A = [
    [0.62, 0.24, -0.08],
    [0.28, 0.58, 0.10],
    [0.05, 0.18, 0.65],
  ];
  const b = [120, 85, 40];
  let x = [50, 30, 15];
  let convIter = -1;
  for (let k = 1; k <= 30; k++) {
    const g = [
      A[0][0] * x[0] + A[0][1] * x[1] + A[0][2] * x[2] + b[0],
      A[1][0] * x[0] + A[1][1] * x[1] + A[1][2] * x[2] + b[1],
      A[2][0] * x[0] + A[2][1] * x[1] + A[2][2] * x[2] + b[2],
    ];
    const maxRel = Math.max(
      Math.abs(g[0] - x[0]) / Math.max(1, g[0]),
      Math.abs(g[1] - x[1]) / Math.max(1, g[1]),
      Math.abs(g[2] - x[2]) / Math.max(1, g[2])
    );
    if (maxRel < 1e-8) {
      convIter = k;
      break;
    }
    const step = accel.stepVector(x, g, {
      scales: [100, 100, 50],
      nonNegativeMask: [true, true, true],
      tempMask: [false, false, false],
    });
    x = step.nextX;
  }
  assertCond(
    '3D Coupled Broyden Vector Superlinear Convergence',
    convIter > 0 && convIter <= 12,
    `converged to <1e-8 in ${convIter} iterations (x* = [${x.map(v => v.toFixed(2)).join(', ')}])`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Coupled 2-Loop Recycle Flowsheet (Simultaneous Broyden vs Wegstein)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▶ [Test 1] Coupled 2-Loop Recycle Flowsheet: Simultaneous Broyden vs Wegstein');
{
  // Two strongly cross-coupled recycle loops exchanging both mass and thermal energy:
  // Feed1 -> M-101 -> E-101 -> SP-101 --(vapor 78% recycle Loop 1)--> M-101
  //                                   --(liquid 22% forward)--------> M-102
  // Feed2 -------------------> M-102 -> SP-102 --(vapor 76% cross-recycle to M-101!)
  //                                            --(liquid 24%)--> SP-103 --(vapor 72% Loop 2 recycle to M-102)
  //                                                                     --(liquid 28% final product P-100)
  const nodes: FlowNodeDef[] = [
    {
      id: 'f1',
      tag: 'F-101',
      name: '1차 합성가스 공급',
      unitType: 'feed',
      params: {
        feedTempC: 30,
        feedPressKgcm2g: 15,
        feedFlowsKgH: { MeOH: 400, H2O: 150, Acetone: 80 },
      },
    },
    {
      id: 'f2',
      tag: 'F-102',
      name: '2차 용매 공급',
      unitType: 'feed',
      params: {
        feedTempC: 65,
        feedPressKgcm2g: 15,
        feedFlowsKgH: { EtOH: 220, H2O: 100 },
      },
    },
    {
      id: 'm1',
      tag: 'M-101',
      name: '1차 루프 혼합기',
      unitType: 'mixer',
      params: {},
    },
    {
      id: 'sp1',
      tag: 'SP-101',
      name: '1차 순환 분기기',
      unitType: 'splitter',
      params: { splitRatioTop: 0.62 },
    },
    {
      id: 'm2',
      tag: 'M-102',
      name: '2차 루프 혼합기',
      unitType: 'mixer',
      params: {},
    },
    {
      id: 'sp2',
      tag: 'SP-102',
      name: '교차 순환 분기기',
      unitType: 'splitter',
      params: { splitRatioTop: 0.55 },
    },
    {
      id: 'sp3',
      tag: 'SP-103',
      name: '2차 내부순환 분기기',
      unitType: 'splitter',
      params: { splitRatioTop: 0.55 },
    },
    {
      id: 'p1',
      tag: 'P-100',
      name: '최종 회수 제품',
      unitType: 'product',
      params: {},
    },
  ];

  const edges: FlowEdgeDef[] = [
    { id: 'e-f1', streamNo: 'S-01', source: 'f1', target: 'm1' },
    { id: 'e-m1-sp1', streamNo: 'S-02', source: 'm1', target: 'sp1' },
    { id: 'e-rec1', streamNo: 'S-03', source: 'sp1', sourcePort: 'vapor', target: 'm1' },
    { id: 'e-1to2', streamNo: 'S-04', source: 'sp1', sourcePort: 'liquid', target: 'm2' },
    { id: 'e-f2', streamNo: 'S-05', source: 'f2', target: 'm2' },
    { id: 'e-m2-sp2', streamNo: 'S-06', source: 'm2', target: 'sp2' },
    { id: 'e-cross', streamNo: 'S-07', source: 'sp2', sourcePort: 'vapor', target: 'm1' },
    { id: 'e-sp2-sp3', streamNo: 'S-08', source: 'sp2', sourcePort: 'liquid', target: 'sp3' },
    { id: 'e-rec2', streamNo: 'S-09', source: 'sp3', sourcePort: 'vapor', target: 'm2' },
    { id: 'e-prod', streamNo: 'S-10', source: 'sp3', sourcePort: 'liquid', target: 'p1' },
  ];

  const wegRes = solveFlowsheet(nodes, edges, {
    propertyMethod: 'NRTL',
    tearMethod: 'wegstein',
    relTolerance: 1e-4,
    maxIterations: 150,
  });

  const broyRes = solveFlowsheet(nodes, edges, {
    propertyMethod: 'NRTL',
    tearMethod: 'broyden',
    relTolerance: 1e-4,
    maxIterations: 150,
  });

  const autoRes = solveFlowsheet(nodes, edges, {
    propertyMethod: 'NRTL',
    tearMethod: 'auto',
    relTolerance: 1e-4,
    maxIterations: 150,
  });

  const maxBroyTearRel = Math.max(
    0,
    ...(broyRes.convergence.tearResiduals ?? []).map(t => t.maxRel)
  );

  assertCond(
    '2+ Tear Streams Detected',
    broyRes.convergence.tearEdgeIds.length >= 2,
    `tearEdgeIds = [${broyRes.convergence.tearStreamNos.join(', ')}] (count=${broyRes.convergence.tearEdgeIds.length})`
  );
  assertCond(
    'Simultaneous Broyden Converged Strictly (< 1e-4)',
    broyRes.convergence.converged && maxBroyTearRel < 1e-4,
    `converged=${broyRes.convergence.converged}, maxTearRel=${maxBroyTearRel.toExponential(2)}`
  );
  assertCond(
    'Broyden Converges in Fewer Iterations than Wegstein',
    broyRes.convergence.iterations < wegRes.convergence.iterations,
    `Broyden=${broyRes.convergence.iterations} iters vs Wegstein=${wegRes.convergence.iterations} iters`
  );
  assertCond(
    'AUTO Mode Selects Simultaneous Broyden on Multi-Tear Flowsheet',
    autoRes.convergence.methodUsed === 'broyden',
    `auto methodUsed=${autoRes.convergence.methodUsed} (${autoRes.convergence.iterations} iters)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: 1D Design Specs (Recycle Inert Ar Purge = 5.0 wt% & HEX Vapor Recovery = 85.0%)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▶ [Test 2a] 1D Design Spec: Recycle Purge Control for Inert Ar = 5.0 wt%');
{
  // Industrial HCl synthesis + absorption recycle loop with trace inert Ar:
  // Fresh feed (Cl2 700 kg/h + H2 25 kg/h + Ar 0.8 kg/h) + Gas Recycle -> Mixer
  //   -> HCl Reactor (80% per-pass conversion) -> HCl Absorber (absorbs 99.5% HCl into water)
  //   -> Overhead Gas (unreacted H2/Cl2 + inert Ar) -> Purge Splitter:
  //        * vapor (splitRatioTop): Purge Offgas
  //        * liquid (1 - splitRatioTop): Recycle Gas back to Mixer
  const nodes: FlowNodeDef[] = [
    {
      id: 'f-syn',
      tag: 'F-201',
      name: '염소·수소·아르곤 원료',
      unitType: 'feed',
      params: {
        feedTempC: 30,
        feedPressKgcm2g: 2.0,
        feedFlowsKgH: { Cl2: 700, H2: 25, Ar: 0.8 },
      },
    },
    { id: 'm-syn', tag: 'M-201', name: '루프 혼합기', unitType: 'mixer', params: {} },
    {
      id: 'r-syn',
      tag: 'R-201',
      name: '염산 합성 반응기',
      unitType: 'reactor',
      params: {
        reactionPreset: 'hcl_burner',
        reactorModel: 'conversion',
        conversion: 0.80,
        operTempC: 160,
        operPressKgcm2g: 1.9,
      },
    },
    {
      id: 'abs-hcl',
      tag: 'T-201',
      name: '염산 흡수탑',
      unitType: 'absorber',
      params: {
        targetComponent: 'HCl',
        removalEfficiency: 0.995,
        operTempC: 35,
        operPressKgcm2g: 1.8,
        solventMode: 'connected_or_manual',
        makeupSolventComp: 'H2O',
        makeupSolventKgH: 1400,
      },
    },
    {
      id: 'sp-purge',
      tag: 'SP-201',
      name: '불활성 가스 퍼지 분기기',
      unitType: 'splitter',
      params: { splitRatioTop: 0.25 },
    },
    { id: 'p-liq', tag: 'P-201', name: '합성 염산 수용액 제품', unitType: 'product', params: {} },
    { id: 'p-purge', tag: 'P-202', name: '퍼지 오프가스', unitType: 'product', params: {} },
  ];

  const edges: FlowEdgeDef[] = [
    { id: 'e-fs', streamNo: 'S-201', source: 'f-syn', target: 'm-syn' },
    { id: 'e-mr', streamNo: 'S-202', source: 'm-syn', target: 'r-syn' },
    { id: 'e-ra', streamNo: 'S-203', source: 'r-syn', target: 'abs-hcl' },
    { id: 'e-vliq', streamNo: 'S-204', source: 'abs-hcl', sourcePort: 'liquid', target: 'p-liq' },
    { id: 'e-vvap', streamNo: 'S-205', source: 'abs-hcl', sourcePort: 'vapor', target: 'sp-purge' },
    { id: 'e-purge', streamNo: 'S-206', source: 'sp-purge', sourcePort: 'vapor', target: 'p-purge' },
    { id: 'e-rec', streamNo: 'S-207', source: 'sp-purge', sourcePort: 'liquid', target: 'm-syn' },
  ];

  const arSpec: DesignSpecDef = {
    id: 'ds-ar-purge',
    name: '순환가스 Ar 불활성 농도 5.0 wt% 유지',
    enabled: true,
    measured: {
      streamEdgeId: 'e-rec',
      metric: 'comp_wt_pct',
      comp: 'Ar',
      targetValue: 5.0,
      tolerance: 1e-3,
    },
    manipulated: {
      nodeId: 'sp-purge',
      paramKey: 'splitRatioTop',
      minBound: 0.02,
      maxBound: 0.90,
      initialGuess: 0.25,
    },
  };

  const dsOut = solveFlowsheetWithDesignSpecs(nodes, edges, [arSpec], {
    propertyMethod: 'ENRTL',
    activeComponents: ['Cl2', 'H2', 'HCl', 'H2O', 'Ar'],
    tearMethod: 'auto',
  });
  const sr = dsOut.specResults[0];

  assertCond(
    'Recycle Inert Ar 1D Design Spec Converged',
    dsOut.converged && sr.converged && Math.abs(sr.achievedValue - 5.0) < 0.01,
    `achieved Ar = ${sr.achievedValue.toFixed(4)} wt% (target 5.00 wt%), purge ratio = ${sr.finalManipulatedValue.toFixed(4)} in ${sr.iterations} evals`
  );
}

console.log('\n▶ [Test 2b] 1D Design Spec: Adjust HEX operTempC for 85.0% Separator Vapor Recovery');
{
  const nodes: FlowNodeDef[] = [
    {
      id: 'f-hc',
      tag: 'F-210',
      name: '경질 탄화수소 원료',
      unitType: 'feed',
      params: {
        feedTempC: 15,
        feedPressKgcm2g: 3.0,
        feedFlowsKgH: { C3H8: 650, nC5H12: 350 },
      },
    },
    {
      id: 'e-hc',
      tag: 'E-210',
      name: '예열 열교환기',
      unitType: 'hex',
      params: { calcMode: 'rigorous', operTempC: 35, operPressKgcm2g: 3.0 },
    },
    {
      id: 'v-hc',
      tag: 'V-210',
      name: '기액 플래시 드럼',
      unitType: 'separator',
      params: { calcMode: 'rigorous', operPressKgcm2g: 3.0 },
    },
    { id: 'p-vap', tag: 'P-211', name: '상부 기상 회수', unitType: 'product', params: {} },
    { id: 'p-bot', tag: 'P-212', name: '하부 액상 회수', unitType: 'product', params: {} },
  ];

  const edges: FlowEdgeDef[] = [
    { id: 'e-1', streamNo: 'S-211', source: 'f-hc', target: 'e-hc' },
    { id: 'e-2', streamNo: 'S-212', source: 'e-hc', target: 'v-hc' },
    { id: 'e-vap', streamNo: 'S-213', source: 'v-hc', sourcePort: 'vapor', target: 'p-vap' },
    { id: 'e-liq', streamNo: 'S-214', source: 'v-hc', sourcePort: 'liquid', target: 'p-bot' },
  ];

  const hexSpec: DesignSpecDef = {
    id: 'ds-hex-rec',
    name: '플래시 상부 기상 프로판 회수율 85.0%',
    enabled: true,
    measured: {
      streamEdgeId: 'e-vap',
      metric: 'comp_recovery_pct',
      comp: 'C3H8',
      refFeedNodeId: 'f-hc',
      targetValue: 85.0,
      tolerance: 5e-3,
    },
    manipulated: {
      nodeId: 'e-hc',
      paramKey: 'operTempC',
      minBound: -10,
      maxBound: 110,
      initialGuess: 35,
    },
  };

  const dsHex = solveFlowsheetWithDesignSpecs(nodes, edges, [hexSpec], {
    propertyMethod: 'PR',
    activeComponents: ['C3H8', 'nC5H12'],
  });
  const srHex = dsHex.specResults[0];

  assertCond(
    'HEX operTempC -> 85.0% Vapor Recovery Converged',
    dsHex.converged && srHex.converged && Math.abs(srHex.achievedValue - 85.0) < 0.02,
    `achieved recovery = ${srHex.achievedValue.toFixed(4)}% (target 85.0%), HEX operTempC = ${srHex.finalManipulatedValue.toFixed(3)} °C in ${srHex.iterations} evals`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: 2D Simultaneous Design Spec (Product Flow = 1000 kg/h & Conc = 32.0 wt%)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▶ [Test 3] 2D Simultaneous Design Spec: Total Product 1000 kg/h AND 32.0 wt% NaOH');
{
  // Concentrated 50 wt% caustic feed (scaled by feed_total_scale) + Dilution Water feed (H2O kg/h)
  // blended in Mixer -> Cooler -> Final 32.0 wt% NaOH Product at exact 1000.0 kg/h!
  const nodes: FlowNodeDef[] = [
    {
      id: 'f-caustic50',
      tag: 'F-301',
      name: '50% 고농도 가성소다 원액',
      unitType: 'feed',
      params: {
        feedTempC: 45,
        feedPressKgcm2g: 2.0,
        feedFlowsKgH: { NaOH: 250, H2O: 250 }, // base 500 kg/h (scale=1.0)
      },
    },
    {
      id: 'f-dilwater',
      tag: 'F-302',
      name: '순수 희석수 공급',
      unitType: 'feed',
      params: {
        feedTempC: 25,
        feedPressKgcm2g: 2.0,
        feedFlowsKgH: { H2O: 200 },
      },
    },
    { id: 'm-blend', tag: 'M-301', name: '가성 희석 혼합기', unitType: 'mixer', params: {} },
    {
      id: 'e-cool',
      tag: 'E-301',
      name: '제품 냉각기',
      unitType: 'cooler',
      params: { operTempC: 30, operPressKgcm2g: 1.8 },
    },
    { id: 'p-naoh32', tag: 'P-301', name: '32% 가성소다 제품', unitType: 'product', params: {} },
  ];

  const edges: FlowEdgeDef[] = [
    { id: 'e-c1', streamNo: 'S-301', source: 'f-caustic50', target: 'm-blend' },
    { id: 'e-c2', streamNo: 'S-302', source: 'f-dilwater', target: 'm-blend' },
    { id: 'e-c3', streamNo: 'S-303', source: 'm-blend', target: 'e-cool' },
    { id: 'e-prod32', streamNo: 'S-304', source: 'e-cool', target: 'p-naoh32' },
  ];

  const specs2D: DesignSpecDef[] = [
    {
      id: 'ds-flow-1000',
      name: '제품 총유량 1000.0 kg/h',
      enabled: true,
      measured: {
        streamEdgeId: 'e-prod32',
        metric: 'total_flow_kgh',
        targetValue: 1000.0,
        tolerance: 1e-2,
      },
      manipulated: {
        nodeId: 'f-caustic50',
        paramKey: 'feed_total_scale',
        minBound: 0.2,
        maxBound: 3.0,
        initialGuess: 1.0,
      },
    },
    {
      id: 'ds-conc-32',
      name: '제품 NaOH 농도 32.0 wt%',
      enabled: true,
      measured: {
        streamEdgeId: 'e-prod32',
        metric: 'comp_wt_pct',
        comp: 'NaOH',
        targetValue: 32.0,
        tolerance: 1e-3,
      },
      manipulated: {
        nodeId: 'f-dilwater',
        paramKey: 'feed_comp_kgh',
        comp: 'H2O',
        minBound: 10,
        maxBound: 900,
        initialGuess: 200,
      },
    },
  ];

  const ds2D = solveFlowsheetWithDesignSpecs(nodes, edges, specs2D, {
    propertyMethod: 'ENRTL',
    activeComponents: ['NaOH', 'H2O'],
  });

  const rFlow = ds2D.specResults[0];
  const rConc = ds2D.specResults[1];

  assertCond(
    '2D Simultaneous Design Spec Converged (Flow = 1000 kg/h & NaOH = 32.0 wt%)',
    ds2D.converged &&
      Math.abs(rFlow.achievedValue - 1000.0) < 0.05 &&
      Math.abs(rConc.achievedValue - 32.0) < 0.01,
    `flow=${rFlow.achievedValue.toFixed(3)} kg/h, conc=${rConc.achievedValue.toFixed(4)} wt% (scale=${rFlow.finalManipulatedValue.toFixed(4)}, dilH2O=${rConc.finalManipulatedValue.toFixed(2)} kg/h, outerIters=${ds2D.outerIterations})`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: 10-Step Sensitivity Analysis (Monotonic Recovery vs Condenser/HEX Duty)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▶ [Test 4] 10-Step Sensitivity Sweep: Flash HEX Temperature vs Vapor Recovery & Heat Duty');
{
  const nodes: FlowNodeDef[] = [
    {
      id: 'f-sens',
      tag: 'F-401',
      name: '혼합 탄화수소 공급',
      unitType: 'feed',
      params: {
        feedTempC: 25,
        feedPressKgcm2g: 2.5,
        feedFlowsKgH: { C3H8: 400, nC5H12: 400, nC7H16: 200 },
      },
    },
    {
      id: 'e-sens',
      tag: 'E-401',
      name: '온도제어 열교환기',
      unitType: 'hex',
      params: { calcMode: 'rigorous', operTempC: 0, operPressKgcm2g: 2.5 },
    },
    {
      id: 'v-sens',
      tag: 'V-401',
      name: '기액분리 드럼',
      unitType: 'separator',
      params: { calcMode: 'rigorous', operPressKgcm2g: 2.5 },
    },
    { id: 'p-svap', tag: 'P-401', name: '기상 출구', unitType: 'product', params: {} },
    { id: 'p-sliq', tag: 'P-402', name: '응축 액상 출구', unitType: 'product', params: {} },
  ];

  const edges: FlowEdgeDef[] = [
    { id: 'es-1', streamNo: 'S-401', source: 'f-sens', target: 'e-sens' },
    { id: 'es-2', streamNo: 'S-402', source: 'e-sens', target: 'v-sens' },
    { id: 'es-vap', streamNo: 'S-403', source: 'v-sens', sourcePort: 'vapor', target: 'p-svap' },
    { id: 'es-liq', streamNo: 'S-404', source: 'v-sens', sourcePort: 'liquid', target: 'p-sliq' },
  ];

  const sensOut = runFlowsheetSensitivity(
    nodes,
    edges,
    {
      primaryVar: {
        nodeId: 'e-sens',
        paramKey: 'operTempC',
        minValue: 0,
        maxValue: 90,
        steps: 10,
      },
      watchedOutputs: [
        {
          id: 'vap_rec',
          label: '기상 총 질량 회수율 (%)',
          streamEdgeId: 'es-vap',
          metric: 'comp_recovery_pct',
          refFeedNodeId: 'f-sens',
        },
        {
          id: 'hex_duty',
          label: '열교환기 열부하 (Mcal/h)',
          unitNodeId: 'e-sens',
          unitMetric: 'heat_duty_mcalh',
        },
      ],
    },
    { propertyMethod: 'PR', activeComponents: ['C3H8', 'nC5H12', 'nC7H16'] }
  );

  const rows = sensOut.flatRows;
  const allConv = rows.length === 10 && rows.every(r => r.converged);
  let recNonDecreasing = true;
  let dutyStrictlyIncreasing = true;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].outputs.vap_rec + 1e-6 < rows[i - 1].outputs.vap_rec) {
      recNonDecreasing = false;
    }
    if (rows[i].outputs.hex_duty <= rows[i - 1].outputs.hex_duty) {
      dutyStrictlyIncreasing = false;
    }
  }
  const recSpan = rows[rows.length - 1].outputs.vap_rec - rows[0].outputs.vap_rec;

  assertCond(
    '10-Step Sensitivity Sweep All Points Converged & Monotonic',
    allConv && recNonDecreasing && dutyStrictlyIncreasing && recSpan > 30,
    `10/10 converged, vapRec ${rows[0].outputs.vap_rec.toFixed(1)}% -> ${rows[9].outputs.vap_rec.toFixed(1)}%, duty ${rows[0].outputs.hex_duty.toFixed(2)} -> ${rows[9].outputs.hex_duty.toFixed(2)} Mcal/h`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Rigorous Adiabatic Joule-Thomson Expansion Valve (25 -> 2 kgf/cm²G)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▶ [Test 5] Rigorous Adiabatic Joule-Thomson Expansion Valve (25 -> 2 kgf/cm²G)');
{
  const nodes: FlowNodeDef[] = [
    {
      id: 'f-hp',
      tag: 'F-501',
      name: '고압 프로판·CO₂ 혼합 공급',
      unitType: 'feed',
      params: {
        feedTempC: 30.0,
        feedPressKgcm2g: 25.0,
        feedFlowsKgH: { C3H8: 850, CO2: 150 },
      },
    },
    {
      id: 'vlv-jt',
      tag: 'JT-501',
      name: '단열 교축 팽창 밸브',
      unitType: 'valve',
      params: {
        calcMode: 'rigorous',
        outletPressKgcm2g: 2.0,
      },
    },
    { id: 'p-lp', tag: 'P-501', name: '저압 냉각 2상 스트림', unitType: 'product', params: {} },
  ];

  const edges: FlowEdgeDef[] = [
    { id: 'e-hp-in', streamNo: 'S-501', source: 'f-hp', target: 'vlv-jt' },
    { id: 'e-lp-out', streamNo: 'S-502', source: 'vlv-jt', target: 'p-lp' },
  ];

  const jtRes = solveFlowsheet(nodes, edges, {
    propertyMethod: 'PR',
    activeComponents: ['C3H8', 'CO2'],
  });

  const sIn = jtRes.streams.find(s => s.edgeId === 'e-hp-in')!;
  const sOut = jtRes.streams.find(s => s.edgeId === 'e-lp-out')!;
  const T_in = sIn.exactTempC ?? sIn.tempC;
  const T_out = sOut.exactTempC ?? sOut.tempC;
  const H_in = sIn.exactEnthalpyKcalH ?? sIn.enthalpyKcalH;
  const H_out = sOut.exactEnthalpyKcalH ?? sOut.enthalpyKcalH;
  const hRelDiffPct = (Math.abs(H_out - H_in) / Math.max(1.0, Math.abs(H_in))) * 100;

  assertCond(
    'Adiabatic JT Valve Significant Flashing & Cooling (T_out < T_in - 15 °C)',
    jtRes.convergence.converged && T_out < T_in - 15.0 && sOut.vaporFraction > 0.1,
    `T_in=${T_in.toFixed(2)} °C -> T_out=${T_out.toFixed(2)} °C (ΔT=${(T_out - T_in).toFixed(2)} °C, β_vap=${sOut.vaporFraction.toFixed(3)})`
  );
  assertCond(
    'Adiabatic JT Valve Strict Isenthalpic Conservation (< 0.05%)',
    hRelDiffPct < 0.05 && Math.abs(sOut.totalMassKgH - sIn.totalMassKgH) < 0.01,
    `H_in=${H_in.toFixed(1)} kcal/h vs H_out=${H_out.toFixed(1)} kcal/h (error=${hRelDiffPct.toExponential(2)} % < 0.05%)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: End-to-End Flowsheet Wiring of W6 ReactorConfig & W8 LLE Extractor / MESH Absorber
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▶ [Test 6] End-to-End Flowsheet Wiring: Rigorous ReactorConfig, MESH Absorber & LLE Extractor');
{
  // 6a) Multistage LLE Extractor (Acetic Acid extracted from H2O using EtOAc)
  const extNodes: FlowNodeDef[] = [
    {
      id: 'f-aq',
      tag: 'F-601',
      name: '초산 수용액 공급',
      unitType: 'feed',
      params: { feedTempC: 25, feedPressKgcm2g: 0.5, feedFlowsKgH: { H2O: 850, AceticAcid: 150 } },
    },
    {
      id: 'f-solv',
      tag: 'F-602',
      name: '초산에틸 용매 공급',
      unitType: 'feed',
      params: { feedTempC: 25, feedPressKgcm2g: 0.5, feedFlowsKgH: { EtOAc: 1200 } },
    },
    {
      id: 'ex-601',
      tag: 'EX-601',
      name: '향류 다단 액-액 추출탑',
      unitType: 'extractor',
      params: { calcMode: 'rigorous', extractorStages: 6, operTempC: 25, operPressKgcm2g: 0.5 },
    },
    { id: 'p-ext', tag: 'P-601', name: '추출상(Extract)', unitType: 'product', params: {} },
    { id: 'p-raf', tag: 'P-602', name: '추출잔류상(Raffinate)', unitType: 'product', params: {} },
  ];
  const extEdges: FlowEdgeDef[] = [
    { id: 'e-601', streamNo: 'S-601', source: 'f-aq', target: 'ex-601', targetPort: 'in' },
    { id: 'e-602', streamNo: 'S-602', source: 'f-solv', target: 'ex-601', targetPort: 'solvent' },
    { id: 'e-603', streamNo: 'S-603', source: 'ex-601', sourcePort: 'vapor', target: 'p-ext' },
    { id: 'e-604', streamNo: 'S-604', source: 'ex-601', sourcePort: 'liquid', target: 'p-raf' },
  ];
  const extSolved = solveFlowsheet(extNodes, extEdges, {
    propertyMethod: 'NRTL',
    activeComponents: ['H2O', 'AceticAcid', 'EtOAc'],
  });
  const sExt = extSolved.streams.find(s => s.edgeId === 'e-603')!;
  const sRaf = extSolved.streams.find(s => s.edgeId === 'e-604')!;
  const uExt = extSolved.units.find(u => u.nodeId === 'ex-601')!;
  assertCond(
    'Multistage LLE Extractor Wired & Mass Balanced',
    Boolean(uExt.extractorResult) &&
      Math.abs(sExt.totalMassKgH + sRaf.totalMassKgH - 2200) < 0.5 &&
      (sExt.flowsKgH.AceticAcid ?? 0) > 50,
    `Extract=${sExt.totalMassKgH.toFixed(1)} kg/h (AceticAcid=${(sExt.flowsKgH.AceticAcid ?? 0).toFixed(1)} kg/h), Raffinate=${sRaf.totalMassKgH.toFixed(1)} kg/h`
  );

  // 6b) Rigorous ReactorConfig (Equilibrium WGS) wired into solveFlowsheet
  const rxNodes: FlowNodeDef[] = [
    {
      id: 'f-rx',
      tag: 'F-611',
      name: '수성가스 전화 원료',
      unitType: 'feed',
      params: { feedTempC: 350, feedPressKgcm2g: 15, feedFlowsKgH: { CO: 280.1, H2O: 360.3 } },
    },
    {
      id: 'r-611',
      tag: 'R-611',
      name: '평형 WGS 반응기',
      unitType: 'reactor',
      params: {
        operTempC: 350,
        operPressKgcm2g: 15,
        reactorConfig: {
          model: 'equilibrium',
          thermalMode: 'isothermal',
          operTempC: 350,
          operPressKgcm2g: 15,
          reactions: [
            {
              id: 'wgs',
              name: 'Water-Gas Shift',
              stoic: { CO: -1, H2O: -1, CO2: 1, H2: 1 },
            },
          ],
        },
      },
    },
    { id: 'p-rx', tag: 'P-611', name: '반응 생성물', unitType: 'product', params: {} },
  ];
  const rxEdges: FlowEdgeDef[] = [
    { id: 'e-611', streamNo: 'S-611', source: 'f-rx', target: 'r-611' },
    { id: 'e-612', streamNo: 'S-612', source: 'r-611', target: 'p-rx' },
  ];
  const rxSolved = solveFlowsheet(rxNodes, rxEdges, {
    propertyMethod: 'PR',
    activeComponents: ['CO', 'H2O', 'CO2', 'H2'],
  });
  const sRxOut = rxSolved.streams.find(s => s.edgeId === 'e-612')!;
  const uRx = rxSolved.units.find(u => u.nodeId === 'r-611')!;
  assertCond(
    'Rigorous ReactorConfig (Equilibrium WGS) Wired & Mass Balanced',
    Boolean(uRx.reactorResult?.converged) &&
      (sRxOut.flowsKgH.H2 ?? 0) > 10 &&
      Math.abs(sRxOut.totalMassKgH - 640.4) < 0.5,
    `H2 produced=${(sRxOut.flowsKgH.H2 ?? 0).toFixed(2)} kg/h, CO2=${(sRxOut.flowsKgH.CO2 ?? 0).toFixed(1)} kg/h, totalOut=${sRxOut.totalMassKgH.toFixed(2)} kg/h`
  );
}

console.log('\n================================================================================');
console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}

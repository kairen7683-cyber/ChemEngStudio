/**
 * 4대 열역학 물성 패키지(SRK, PR, NRTL, ENRTL) + 40종 범용 물질 + AUTO 추천 엔진 통합 검증 스크립트
 * 실행: npx.cmd tsx scripts/regression/testThermoMethods.ts
 */
import {
  SIM_COMPS,
  COMP_META,
  emptySimFlows,
  solveFlowsheet,
  flashGasLiquid,
  type FlowNodeDef,
  type FlowEdgeDef,
} from '../../lib/calculations/flowsheetSolver';
import { MW } from '../../lib/calculations/constants';
import { THERMO_DATA } from '../../lib/calculations/thermoCore';
import { calcExtendedNrtlGamma } from '../../lib/calculations/activityModels';
import {
  solveRigorousFlashVLE,
  calcSoaveRedlichKwongMixture,
  calcPengRobinsonMixture,
  bubblePressureBarA,
  bubbleTemperatureC,
  liquidActivityCoefficients,
} from '../../lib/calculations/rigorousThermo';
import {
  COMP_CATALOG_META,
  recommendPropertyMethod,
} from '../../lib/calculations/componentCatalog';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('=== [1] 전 성분 카탈로그 & 물성 DB 완전성 검증 ===');
assert(SIM_COMPS.length === 77, `SIM_COMPS length === 77 (got ${SIM_COMPS.length})`);
for (const k of SIM_COMPS) {
  if (!COMP_META[k] || !(MW[k] > 0) || !THERMO_DATA[k] || !COMP_CATALOG_META[k]) {
    assert(false, `Missing metadata for component ${k}`);
  }
}
assert(true, 'All 40 components registered across SIM_COMPS, COMP_META, MW, THERMO_DATA, COMP_CATALOG_META');

console.log('\n=== [2] 열역학 모델 자동 추천(AUTO) 의사결정 트리 검증 ===');
const recBrine = recommendPropertyMethod(['H2O', 'NaCl', 'NaOH'], { H2O: 7000, NaCl: 2500 });
assert(recBrine.method === 'ENRTL', `Brine system -> ENRTL (got ${recBrine.method})`);

const recPolar = recommendPropertyMethod(['EtOH', 'H2O'], { EtOH: 400, H2O: 600 });
assert(recPolar.method === 'NRTL', `EtOH-H2O polar system -> NRTL (got ${recPolar.method})`);

const recLle = recommendPropertyMethod(['EtOAc', 'H2O', 'AceticAcid'], { EtOAc: 500, H2O: 500, AceticAcid: 100 });
assert(recLle.method === 'NRTL', `EtOAc-H2O extraction system -> NRTL (got ${recLle.method})`);

const recHc = recommendPropertyMethod(['C3H8', 'nC4H10', 'nC6H14'], { C3H8: 400, nC4H10: 400, nC6H14: 200 }, 14);
assert(recHc.method === 'PR', `Paraffin hydrocarbon system -> PR (got ${recHc.method})`);

const recOlefin = recommendPropertyMethod(['C2H4', 'C3H6'], { C2H4: 500, C3H6: 500 }, 16);
assert(recOlefin.method === 'SRK', `Light olefin splitter system -> SRK (got ${recOlefin.method})`);

const recSyngas = recommendPropertyMethod(['H2', 'CO', 'CH4', 'CO2'], { H2: 120, CO: 800, CH4: 100 }, 28);
assert(recSyngas.method === 'SRK', `H2/CO syngas high-P system -> SRK (got ${recSyngas.method})`);

console.log('\n=== [3] SRK & PR 상태방정식(EOS) 기액평형 검증 ===');
const lpgFlows = emptySimFlows({ C3H8: 500, nC4H10: 500 });
const srkLpg = solveRigorousFlashVLE(lpgFlows, 45, 8.0, 1.0, undefined, undefined, 'SRK');
const prLpg = solveRigorousFlashVLE(lpgFlows, 45, 8.0, 1.0, undefined, undefined, 'PR');
const calcAlphaLpg = (fl: typeof srkLpg) => {
  const y1 = fl.vap.C3H8 / MW.C3H8;
  const y2 = fl.vap.nC4H10 / MW.nC4H10;
  const x1 = fl.liq.C3H8 / MW.C3H8;
  const x2 = fl.liq.nC4H10 / MW.nC4H10;
  return (y1 / Math.max(1e-9, x1)) / Math.max(1e-9, y2 / Math.max(1e-9, x2));
};
const alphaSrk = calcAlphaLpg(srkLpg);
const alphaPr = calcAlphaLpg(prLpg);
assert(
  srkLpg.betaVapMole > 0.1 && srkLpg.betaVapMole < 0.9 && alphaSrk > 2.2 && alphaSrk < 4.5,
  `SRK C3H8/nC4H10 flash two-phase (beta=${srkLpg.betaVapMole.toFixed(3)}, alpha=${alphaSrk.toFixed(3)})`
);
assert(
  prLpg.betaVapMole > 0.1 && prLpg.betaVapMole < 0.9 && alphaPr > 2.2 && alphaPr < 4.5,
  `PR C3H8/nC4H10 flash two-phase (beta=${prLpg.betaVapMole.toFixed(3)}, alpha=${alphaPr.toFixed(3)})`
);

const syngasMoleFrac = emptySimFlows({ H2: 0.65, CO: 0.25, CH4: 0.1 });
const syngasSrk = calcSoaveRedlichKwongMixture(syngasMoleFrac, -40, 30);
const syngasPr = calcPengRobinsonMixture(syngasMoleFrac, -40, 30);
assert(
  syngasSrk.Z_vap > 0.92 && syngasSrk.Z_vap < 1.15 && syngasSrk.phi_vap.H2 > 1.0,
  `SRK Graboski-Daubert H2/CO/CH4 Z_vap=${syngasSrk.Z_vap.toFixed(4)}, phi_vap(H2)=${syngasSrk.phi_vap.H2.toFixed(4)}`
);
assert(
  syngasPr.Z_vap > 0.90 && syngasPr.Z_vap < 1.15,
  `PR H2/CO/CH4 Z_vap=${syngasPr.Z_vap.toFixed(4)}`
);

// C3H6 / C3H8 50/50 wt% tight two-phase envelope & NIST 42°C bubble pressure (~15.9 barA ± 3%)
const c3Flows = emptySimFlows({ C3H6: 500, C3H8: 500 });
const nC3H6 = 500 / MW.C3H6;
const nC3H8 = 500 / MW.C3H8;
const zC3 = { C3H6: nC3H6 / (nC3H6 + nC3H8), C3H8: nC3H8 / (nC3H6 + nC3H8) };
const calcAlphaC3 = (fl: typeof srkLpg) => {
  const y1 = fl.vap.C3H6 / MW.C3H6;
  const y2 = fl.vap.C3H8 / MW.C3H8;
  const x1 = fl.liq.C3H6 / MW.C3H6;
  const x2 = fl.liq.C3H8 / MW.C3H8;
  return (y1 / Math.max(1e-12, x1)) / Math.max(1e-12, y2 / Math.max(1e-12, x2));
};

const bpC3Pr = bubblePressureBarA(['C3H6', 'C3H8'], zC3, 42, 'PR');
const bpC3Srk = bubblePressureBarA(['C3H6', 'C3H8'], zC3, 42, 'SRK');
assert(
  bpC3Pr.converged && bpC3Pr.P_barA >= 15.9 * 0.97 && bpC3Pr.P_barA <= 15.9 * 1.03,
  `PR C3H6/C3H8 50/50 wt% bubble P @42°C = ${bpC3Pr.P_barA.toFixed(3)} barA (NIST ~15.9 barA ±3%)`
);
assert(
  bpC3Srk.converged && bpC3Srk.P_barA >= 15.9 * 0.97 && bpC3Srk.P_barA <= 15.9 * 1.03,
  `SRK C3H6/C3H8 50/50 wt% bubble P @42°C = ${bpC3Srk.P_barA.toFixed(3)} barA (NIST ~15.9 barA ±3%)`
);

const c3PrLens42 = solveRigorousFlashVLE(c3Flows, 42, 15.32, 1.0, undefined, undefined, 'PR');
const c3SrkLens42 = solveRigorousFlashVLE(c3Flows, 42, 15.50, 1.0, undefined, undefined, 'SRK');
const alphaC3Pr42 = calcAlphaC3(c3PrLens42);
const alphaC3Srk42 = calcAlphaC3(c3SrkLens42);
assert(
  c3PrLens42.converged &&
    c3PrLens42.betaVapMole > 0.05 &&
    c3PrLens42.betaVapMole < 0.95 &&
    alphaC3Pr42 > 1.10 &&
    alphaC3Pr42 < 1.22,
  `PR C3H6/C3H8 two-phase lens @42°C, 15.32 kgf/cm²G (beta=${c3PrLens42.betaVapMole.toFixed(4)}, alpha=${alphaC3Pr42.toFixed(4)}, iter=${c3PrLens42.iterations})`
);
assert(
  c3SrkLens42.converged &&
    c3SrkLens42.betaVapMole > 0.05 &&
    c3SrkLens42.betaVapMole < 0.95 &&
    alphaC3Srk42 > 1.10 &&
    alphaC3Srk42 < 1.22,
  `SRK C3H6/C3H8 two-phase lens @42°C, 15.50 kgf/cm²G (beta=${c3SrkLens42.betaVapMole.toFixed(4)}, alpha=${alphaC3Srk42.toFixed(4)}, iter=${c3SrkLens42.iterations})`
);

const c3PrLens145 = solveRigorousFlashVLE(c3Flows, 39.75, 14.5, 1.0, undefined, undefined, 'PR');
const c3SrkLens145 = solveRigorousFlashVLE(c3Flows, 39.28, 14.5, 1.0, undefined, undefined, 'SRK');
const alphaC3Pr145 = calcAlphaC3(c3PrLens145);
const alphaC3Srk145 = calcAlphaC3(c3SrkLens145);
assert(
  c3PrLens145.converged &&
    c3PrLens145.betaVapMole > 0.05 &&
    c3PrLens145.betaVapMole < 0.95 &&
    alphaC3Pr145 > 1.10 &&
    alphaC3Pr145 < 1.22,
  `PR C3H6/C3H8 two-phase lens @39.75°C, 14.5 kgf/cm²G (beta=${c3PrLens145.betaVapMole.toFixed(4)}, alpha=${alphaC3Pr145.toFixed(4)})`
);
assert(
  c3SrkLens145.converged &&
    c3SrkLens145.betaVapMole > 0.05 &&
    c3SrkLens145.betaVapMole < 0.95 &&
    alphaC3Srk145 > 1.10 &&
    alphaC3Srk145 < 1.22,
  `SRK C3H6/C3H8 two-phase lens @39.28°C, 14.5 kgf/cm²G (beta=${c3SrkLens145.betaVapMole.toFixed(4)}, alpha=${alphaC3Srk145.toFixed(4)})`
);

// Single-phase boundary honesty at 42°C
for (const m of ['PR', 'SRK'] as const) {
  const flSuper = solveRigorousFlashVLE(c3Flows, 42, 14.5, 1.0, undefined, undefined, m);
  const flSub = solveRigorousFlashVLE(c3Flows, 42, 16.5, 1.0, undefined, undefined, m);
  assert(
    flSuper.converged && flSuper.betaVapMole === 1,
    `${m} C3H6/C3H8 @42°C, 14.5 kgf/cm²G superheated vapor (betaVapMole=${flSuper.betaVapMole})`
  );
  assert(
    flSub.converged && flSub.betaVapMole === 0,
    `${m} C3H6/C3H8 @42°C, 16.5 kgf/cm²G subcooled liquid (betaVapMole=${flSub.betaVapMole})`
  );
}

console.log('\n=== [4] NRTL 비이상 활동도(DECHEMA + UNIFAC) & LLE 디캔터 검증 ===');
const xDilEtOH = emptySimFlows({ EtOH: 0.005, H2O: 0.995 });
const gammaEtOH = calcExtendedNrtlGamma(['EtOH', 'H2O'], xDilEtOH, 25);
assert(
  gammaEtOH.EtOH > 3.2 && gammaEtOH.EtOH < 9.5,
  `NRTL infinite-dilution gamma(EtOH in H2O @25°C) = ${gammaEtOH.EtOH.toFixed(3)}`
);

const xAcetChcl3 = emptySimFlows({ Acetone: 0.5, CHCl3: 0.5 });
const gammaNeg = calcExtendedNrtlGamma(['Acetone', 'CHCl3'], xAcetChcl3, 55);
assert(
  gammaNeg.Acetone < 0.92 && gammaNeg.CHCl3 < 0.92,
  `NRTL negative-deviation Acetone-CHCl3 (gamma_Ac=${gammaNeg.Acetone.toFixed(3)}, gamma_CF=${gammaNeg.CHCl3.toFixed(3)})`
);

// EtOAc - H2O LLE Decanter Flowsheet Test
const lleNodes: FlowNodeDef[] = [
  {
    id: 'f1',
    tag: 'F-101',
    name: 'EtOAc-Water Feed',
    unitType: 'feed',
    params: {
      feedTempC: 25,
      feedPressKgcm2g: 0.5,
      feedFlowsKgH: emptySimFlows({ EtOAc: 1000, H2O: 1000 }),
    },
  },
  {
    id: 'dec1',
    tag: 'V-101',
    name: 'LLE Decanter',
    unitType: 'separator',
    params: { operTempC: 25, operPressKgcm2g: 0.5 },
  },
  { id: 'p_org', tag: 'ORG', name: 'Organic Phase', unitType: 'product', params: {} },
  { id: 'p_aq', tag: 'AQ', name: 'Aqueous Phase', unitType: 'product', params: {} },
];
const lleEdges: FlowEdgeDef[] = [
  { id: 'e1', streamNo: '1', source: 'f1', target: 'dec1', sourcePort: 'out', targetPort: 'in' },
  { id: 'e2', streamNo: '2', source: 'dec1', target: 'p_org', sourcePort: 'vapor', targetPort: 'in' },
  { id: 'e3', streamNo: '3', source: 'dec1', target: 'p_aq', sourcePort: 'liquid', targetPort: 'in' },
];
const lleSolved = solveFlowsheet(lleNodes, lleEdges, { propertyMethod: 'AUTO', activeComponents: ['EtOAc', 'H2O'] });
const sOrg = lleSolved.streams.find(s => s.edgeId === 'e2')!;
const sAq = lleSolved.streams.find(s => s.edgeId === 'e3')!;
assert(
  lleSolved.propertyMethodUsed === 'NRTL',
  `LLE flowsheet AUTO resolved to NRTL (got ${lleSolved.propertyMethodUsed})`
);
assert(
  sOrg.flowsKgH.EtOAc > 800 && sAq.flowsKgH.H2O > 850,
  `EtOAc-H2O LLE phase split: Organic EtOAc=${sOrg.flowsKgH.EtOAc.toFixed(1)} kg/h, Aqueous H2O=${sAq.flowsKgH.H2O.toFixed(1)} kg/h`
);

console.log('\n=== [5] ENRTL 전해질 비점상승(BPE), 순수 물 완전기화 및 공비 기포점 검증 ===');
const pureWaterGasFl = flashGasLiquid(emptySimFlows({ H2O: 1000, N2: 50 }), 95, 0.0, true, 'ENRTL');
const causticGasFl = flashGasLiquid(emptySimFlows({ H2O: 600, NaOH: 400, N2: 50 }), 95, 0.0, true, 'ENRTL');
assert(
  pureWaterGasFl.vap.H2O > 100 && causticGasFl.vap.H2O < pureWaterGasFl.vap.H2O * 0.25,
  `ENRTL 40wt% NaOH Pitzer-DH activity depression @95°C (pure H2O vap=${pureWaterGasFl.vap.H2O.toFixed(1)} kg/h vs 40% NaOH vap=${causticGasFl.vap.H2O.toFixed(1)} kg/h)`
);

// Pure water @ 105°C, 0.0 kgf/cm²G (no carrier gas) -> complete vaporization
const pureWater105 = flashGasLiquid(emptySimFlows({ H2O: 1000 }), 105, 0.0, true, 'ENRTL');
assert(
  pureWater105.converged && pureWater105.vap.H2O > 995 && pureWater105.liq.H2O === 0,
  `Pure H2O (1000 kg/h) @105°C, 0.0 kgf/cm²G complete vaporization: vap.H2O=${pureWater105.vap.H2O.toFixed(2)} kg/h, liq.H2O=${pureWater105.liq.H2O.toFixed(2)} kg/h`
);

// 40 wt% NaOH @ 105°C, 0.0 kgf/cm²G (NO carrier gas) -> subcooled below ~128°C BPE -> vap.H2O === 0
const naoh40At105 = flashGasLiquid(emptySimFlows({ H2O: 600, NaOH: 400 }), 105, 0.0, true, 'ENRTL');
assert(
  naoh40At105.converged && naoh40At105.vap.H2O === 0,
  `40 wt% NaOH (no carrier gas) @105°C, 0.0 kgf/cm²G subcooled: vap.H2O=${naoh40At105.vap.H2O} kg/h`
);

// 40 wt% NaOH @ 135°C, 0.0 kgf/cm²G (NO carrier gas) -> concentrative boiling until liquid reaches 135°C BPE
const naoh40At135 = flashGasLiquid(emptySimFlows({ H2O: 600, NaOH: 400 }), 135, 0.0, true, 'ENRTL');
assert(
  naoh40At135.converged && naoh40At135.vap.H2O > 50,
  `40 wt% NaOH (no carrier gas) @135°C, 0.0 kgf/cm²G concentrative boil: vap.H2O=${naoh40At135.vap.H2O.toFixed(2)} kg/h`
);

// Hydrophobic infinite-dilution gamma check (widened lnGamma clamp [-12, 14])
const gammaTolDil = liquidActivityCoefficients(['Toluene', 'H2O'], { Toluene: 1e-5, H2O: 0.99999 }, 25, 'NRTL');
assert(
  gammaTolDil.Toluene > 2000,
  `NRTL hydrophobic infinite-dilution gamma(Toluene in H2O @25°C) = ${gammaTolDil.Toluene.toFixed(1)} (>2000)`
);

// Bubble temperature checks: EtOH-H2O azeotrope, HCl-H2O max-boiling azeotrope, 40 wt% NaOH BPE
const btEtohAzeo = bubbleTemperatureC(['EtOH', 'H2O'], { EtOH: 0.894, H2O: 0.106 }, 1.01325, 'NRTL');
assert(
  btEtohAzeo.converged &&
    btEtohAzeo.T_C >= 77.5 &&
    btEtohAzeo.T_C <= 78.8 &&
    Math.abs(btEtohAzeo.y.EtOH - 0.894) < 0.015,
  `EtOH-H2O azeotrope @1.01325 barA [NRTL]: T=${btEtohAzeo.T_C.toFixed(2)}°C, y_EtOH=${btEtohAzeo.y.EtOH.toFixed(4)}`
);

const nHclAz = 20.22 / MW.HCl;
const nH2oAz = 79.78 / MW.H2O;
const xHclAz = { HCl: nHclAz / (nHclAz + nH2oAz), H2O: nH2oAz / (nHclAz + nH2oAz) };
const btHclAzeo = bubbleTemperatureC(['HCl', 'H2O'], xHclAz, 1.01325, 'ENRTL');
assert(
  btHclAzeo.converged && btHclAzeo.T_C >= 107.5 && btHclAzeo.T_C <= 109.8,
  `HCl-H2O 20.22 wt% max-boiling azeotrope @1.01325 barA [ENRTL]: T=${btHclAzeo.T_C.toFixed(2)}°C, y_HCl=${btHclAzeo.y.HCl.toFixed(4)}`
);

const nNaoh40 = 400 / MW.NaOH;
const nH2o60 = 600 / MW.H2O;
const xNaoh40 = { NaOH: nNaoh40 / (nNaoh40 + nH2o60), H2O: nH2o60 / (nNaoh40 + nH2o60) };
const btNaoh40 = bubbleTemperatureC(['H2O', 'NaOH'], xNaoh40, 1.01325, 'ENRTL');
assert(
  btNaoh40.converged && btNaoh40.T_C >= 125 && btNaoh40.T_C <= 132,
  `40 wt% NaOH bubble temperature @1.01325 barA [ENRTL]: T=${btNaoh40.T_C.toFixed(2)}°C`
);

console.log('\n=== [6] 다단 정밀 증류(MESH) Benzene-Toluene (SRK / PR / NRTL) 비교 검증 ===');
for (const method of ['SRK', 'PR', 'NRTL'] as const) {
  const btxNodes: FlowNodeDef[] = [
    {
      id: 'bf',
      tag: 'F-BTX',
      name: 'BT Feed',
      unitType: 'feed',
      params: {
        feedTempC: 92,
        feedPressKgcm2g: 0.2,
        feedFlowsKgH: emptySimFlows({ Benzene: 1000, Toluene: 1000 }),
      },
    },
    {
      id: 'bcol',
      tag: 'C-BTX',
      name: 'BT Splitter',
      unitType: 'distillation',
      params: {
        calcMode: 'rigorous',
        distillConfig: {
          columnCalcMode: 'rigorous_mesh',
          thermoModel: method,
          totalStages: 22,
          feedStage: 11,
          topSpecType: 'reflux_ratio',
          topSpecValue: 2.2,
          splitSpecType: 'd_over_f_mole',
          splitSpecValue: 0.54,
          topPressKgcm2g: 0.1,
          stageDeltaPKgcm2: 0.005,
        },
      },
    },
    { id: 'bd', tag: 'DIST', name: 'Benzene Top', unitType: 'product', params: {} },
    { id: 'bb', tag: 'BOT', name: 'Toluene Bot', unitType: 'product', params: {} },
  ];
  const btxEdges: FlowEdgeDef[] = [
    { id: 'be1', streamNo: '1', source: 'bf', target: 'bcol', sourcePort: 'out', targetPort: 'in' },
    { id: 'be2', streamNo: '2', source: 'bcol', target: 'bd', sourcePort: 'vapor', targetPort: 'in' },
    { id: 'be3', streamNo: '3', source: 'bcol', target: 'bb', sourcePort: 'liquid', targetPort: 'in' },
  ];
  const res = solveFlowsheet(btxNodes, btxEdges, {
    propertyMethod: method,
    activeComponents: ['Benzene', 'Toluene'],
  });
  const topS = res.streams.find(s => s.edgeId === 'be2')!;
  const botS = res.streams.find(s => s.edgeId === 'be3')!;
  const bzPurity = (topS.flowsKgH.Benzene / Math.max(1e-6, topS.totalMassKgH)) * 100;
  const tolPurity = (botS.flowsKgH.Toluene / Math.max(1e-6, botS.totalMassKgH)) * 100;
  assert(
    res.convergence.converged && bzPurity > 95 && tolPurity > 95 && Math.abs(res.balance.energyResidualPct) < 0.05,
    `MESH BT Splitter [${method}]: converged=${res.convergence.converged}, Top Bz=${bzPurity.toFixed(2)}wt%, Bot Tol=${tolPurity.toFixed(2)}wt%, EnergyRes=${res.balance.energyResidualPct.toFixed(3)}%`
  );
}

console.log('\n=== [7] ECH C-101 불균일 공비 디캔터 증류탑(decanter_ech) MESH 수렴 검증 ===');
const c101Nodes: FlowNodeDef[] = [
  {
    id: 'es3_feed',
    tag: 'F-301',
    name: 'Crude ECH',
    unitType: 'feed',
    params: {
      feedTempC: 55,
      feedPressKgcm2g: 0.2,
      feedFlowsKgH: emptySimFlows({ ECH: 8820, DCP: 165, DCH: 380, H2O: 140 }),
    },
  },
  {
    id: 'es3_c101',
    tag: 'C-101',
    name: '경질분(DCP)·탈수 증류탑',
    unitType: 'distillation',
    params: {
      calcMode: 'rigorous',
      distillConfig: {
        columnCalcMode: 'rigorous_mesh',
        thermoModel: 'NRTL',
        condenserType: 'decanter_ech',
        reboilerType: 'thermosyphon',
        totalStages: 20,
        feedStage: 10,
        topPressKgcm2g: -0.65,
        stageDeltaPKgcm2: 0.004,
        murphreeEffPct: 75,
        topSpecType: 'reflux_ratio',
        topSpecValue: 2.2,
        splitSpecType: 'd_over_f_mass',
        splitSpecValue: 0.068,
      },
    },
  },
  { id: 'c101_d', tag: 'DIST', name: 'Light Ends', unitType: 'product', params: {} },
  { id: 'c101_b', tag: 'BOT', name: 'Dehydrated ECH', unitType: 'product', params: {} },
];
const c101Edges: FlowEdgeDef[] = [
  { id: 'ce1', streamNo: '1', source: 'es3_feed', target: 'es3_c101', sourcePort: 'out', targetPort: 'in' },
  { id: 'ce2', streamNo: '2', source: 'es3_c101', target: 'c101_d', sourcePort: 'vapor', targetPort: 'in' },
  { id: 'ce3', streamNo: '3', source: 'es3_c101', target: 'c101_b', sourcePort: 'liquid', targetPort: 'in' },
];
const c101Res = solveFlowsheet(c101Nodes, c101Edges, { propertyMethod: 'NRTL' });
const c101Unit = c101Res.units.find(u => u.nodeId === 'es3_c101')!;
assert(
  Boolean(c101Unit.distillResult?.converged) && c101Unit.distillResult?.diagnostics?.level !== 'error',
  `ECH C-101 decanter_ech MESH converged=${c101Unit.distillResult?.converged} (iter=${c101Unit.distillResult?.innerIterations}, badge=${c101Unit.distillResult?.diagnostics?.badgeText})`
);

console.log('\n🎉 모든 열역학 패키지 및 40종 범용 물질 검증 완료!');

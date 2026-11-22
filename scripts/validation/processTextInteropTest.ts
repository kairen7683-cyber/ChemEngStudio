// ============================================================================
// 공정 텍스트 파일(.bkp / .inp) 양방향 호환 파서 & 내보내기 검증 스크립트
// ============================================================================

import assert from 'node:assert/strict';
import {
  parseProcessTextFile,
  exportProcessTextFile,
} from '../../lib/interop/processTextInterop';
import { MW } from '../../lib/calculations/constants';

function approxEqual(actual: number, expected: number, tol: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ~${expected} (±${tol}), got ${actual}`
  );
}

// ----------------------------------------------------------------------------
// Test 1: Realistic multi-unit .bkp/.inp import (Feed -> Pump -> Heater -> Flash2 -> RadFrac + Products)
// ----------------------------------------------------------------------------
const SAMPLE_BKP = `
; Multi-unit solvent recovery process sample (.bkp / .inp text section)
TITLE 'MeOH-EtOH-Water Solvent Recovery Process'

IN-UNITS MET PRESSURE=bar TEMPERATURE=C

COMPONENTS
    WATER H2O
    MEOH METHANOL
    ETOH C2H6O-2
    BCS 2-BUTOXYETHANOL
    MYSTERY UNKNOWN-COMP-999

PROPERTIES NRTL-RK

FLOWSHEET
    BLOCK P-101 IN=F1 OUT=S2
    BLOCK E-101 IN=S2 OUT=S3
    BLOCK V-101 IN=S3 &
        OUT=S-VAP S-LIQ
    BLOCK T-101 IN=S-LIQ OUT=S-DIST S-BOT

STREAM F1
    SUBSTREAM MIXED TEMP=35.0 PRES=1.5
    MOLE-FLOW
        MEOH 100.0
        ETOH 50.0
        WATER 200.0
        BCS 10.0

BLOCK P-101 PUMP
    PARAM PRES=4.0 EFF=0.78

BLOCK E-101 HEATER
    PARAM TEMP=92.5 PRES=3.8

BLOCK V-101 FLASH2
    PARAM TEMP=90.0 PRES=2.2

BLOCK T-101 RADFRAC
    PARAM NSTAGE=24 RR=2.5 D:F=0.45
    FEEDS S-LIQ 12
    P-SPEC 1 1.2

STREAM-RESULTS
    ; Simulated report & binary trailer that must be ignored
    F1 TOTAL=360.0
\x00\x01\x02BINARY_TRAILER_DATA
`;

console.log('--- [Test 1] Multi-unit .bkp/.inp import ---');
const parsed = parseProcessTextFile(SAMPLE_BKP, 'solvent_recovery.bkp');

assert.equal(parsed.title, 'MeOH-EtOH-Water Solvent Recovery Process');
assert.equal(parsed.propertyMethod, 'NRTL');
assert.deepEqual(parsed.activeComponents, ['H2O', 'MeOH', 'EtOH', 'BCS']);
assert.equal(parsed.summary.mappedCompCount, 4);
assert.deepEqual(parsed.summary.unmappedComps, ['MYSTERY']);
assert.ok(parsed.warnings.length >= 1, 'Expected Korean warning for unmapped component');

// 1 feed (F1) + 4 blocks (P-101, E-101, V-101, T-101) + 3 products (S-VAP, S-DIST, S-BOT) = 8 units
assert.equal(parsed.summary.unitCount, 8);
assert.equal(Object.keys(parsed.defs).length, 8);
assert.equal(parsed.rfNodes.length, 8);

// 7 edges: F1, S2, S3, S-VAP, S-LIQ, S-DIST, S-BOT
assert.equal(parsed.summary.edgeCount, 7);
assert.equal(parsed.edges.length, 7);

// Check unit types
const byTag = Object.fromEntries(Object.values(parsed.defs).map((d) => [d.tag, d]));
assert.equal(byTag['F1'].unitType, 'feed');
assert.equal(byTag['P-101'].unitType, 'pump');
assert.equal(byTag['E-101'].unitType, 'hex');
assert.equal(byTag['V-101'].unitType, 'separator');
assert.equal(byTag['T-101'].unitType, 'distillation');
assert.equal(byTag['S-VAP'].unitType, 'product');
assert.equal(byTag['S-DIST'].unitType, 'product');
assert.equal(byTag['S-BOT'].unitType, 'product');

// Check feed mole-to-mass conversion (kmol/hr * MW = kg/hr)
const feedFlows = byTag['F1'].params.feedFlowsKgH!;
approxEqual(feedFlows.MeOH ?? 0, 100.0 * MW.MeOH, 0.05, 'F1 MeOH kg/h');
approxEqual(feedFlows.EtOH ?? 0, 50.0 * MW.EtOH, 0.05, 'F1 EtOH kg/h');
approxEqual(feedFlows.H2O ?? 0, 200.0 * MW.H2O, 0.05, 'F1 H2O kg/h');
approxEqual(feedFlows.BCS ?? 0, 10.0 * MW.BCS, 0.05, 'F1 BCS kg/h');
approxEqual(byTag['F1'].params.feedTempC ?? 0, 35.0, 0.01, 'F1 tempC');

// Check block parameters
approxEqual(byTag['P-101'].params.efficiency ?? 0, 0.78, 0.001, 'P-101 eff');
approxEqual(byTag['E-101'].params.operTempC ?? 0, 92.5, 0.01, 'E-101 tempC');
approxEqual(byTag['V-101'].params.operTempC ?? 0, 90.0, 0.01, 'V-101 tempC');
assert.equal(byTag['T-101'].params.distillConfig?.totalStages, 24);
assert.equal(byTag['T-101'].params.distillConfig?.feedStage, 12);
approxEqual(byTag['T-101'].params.distillConfig?.topSpecValue ?? 0, 2.5, 0.001, 'T-101 RR');
approxEqual(byTag['T-101'].params.distillConfig?.splitSpecValue ?? 0, 0.45, 0.001, 'T-101 D:F');

// Check Flash2 & RadFrac sourcePort mapping
const edgeByStream = Object.fromEntries(parsed.edges.map((e) => [e.streamNo, e]));
assert.equal(edgeByStream['S-VAP'].sourcePort, 'vapor');
assert.equal(edgeByStream['S-LIQ'].sourcePort, 'liquid');
assert.equal(edgeByStream['S-DIST'].sourcePort, 'vapor');
assert.equal(edgeByStream['S-BOT'].sourcePort, 'liquid');

// Check topological left-to-right layout
const posById = Object.fromEntries(parsed.rfNodes.map((n) => [n.id, n.position]));
assert.ok(
  posById[byTag['F1'].id].x < posById[byTag['P-101'].id].x &&
    posById[byTag['P-101'].id].x < posById[byTag['E-101'].id].x &&
    posById[byTag['E-101'].id].x < posById[byTag['V-101'].id].x &&
    posById[byTag['V-101'].id].x < posById[byTag['T-101'].id].x &&
    posById[byTag['T-101'].id].x < posById[byTag['S-DIST'].id].x,
  'Expected strictly increasing x coordinates along flowsheet'
);

console.log('Test 1 PASSED!');

// ----------------------------------------------------------------------------
// Test 2: Round-trip exportProcessTextFile -> parseProcessTextFile
// ----------------------------------------------------------------------------
console.log('--- [Test 2] Round-trip export -> parse ---');
const exportedInp = exportProcessTextFile({
  title: parsed.title,
  defs: parsed.defs,
  edges: parsed.edges,
  activeComponents: parsed.activeComponents,
  propertyMethod: parsed.propertyMethod,
});

assert.ok(exportedInp.includes('IN-UNITS MET PRESSURE=bar TEMPERATURE=C'));
assert.ok(exportedInp.includes('PROPERTIES NRTL'));
assert.ok(exportedInp.includes('BLOCK T-101 RADFRAC'));

const reParsed = parseProcessTextFile(exportedInp, 'roundtrip.inp');

assert.equal(reParsed.title, parsed.title);
assert.equal(reParsed.propertyMethod, parsed.propertyMethod);
assert.equal(reParsed.summary.unitCount, parsed.summary.unitCount);
assert.equal(reParsed.summary.edgeCount, parsed.summary.edgeCount);
assert.equal(reParsed.summary.mappedCompCount, parsed.summary.mappedCompCount);
assert.deepEqual(reParsed.activeComponents, parsed.activeComponents);

const reByTag = Object.fromEntries(Object.values(reParsed.defs).map((d) => [d.tag, d]));
const origFlows = byTag['F1'].params.feedFlowsKgH!;
const rtFlows = reByTag['F1'].params.feedFlowsKgH!;

let origTotal = 0;
let rtTotal = 0;
for (const c of parsed.activeComponents) {
  const oVal = origFlows[c] ?? 0;
  const rVal = rtFlows[c] ?? 0;
  approxEqual(rVal, oVal, 0.05, `Round-trip flow ${c}`);
  origTotal += oVal;
  rtTotal += rVal;
}
approxEqual(rtTotal, origTotal, 0.1, 'Round-trip total mass flow conservation');
approxEqual(
  reByTag['F1'].params.feedTempC ?? 0,
  byTag['F1'].params.feedTempC ?? 0,
  0.02,
  'Round-trip feed tempC'
);
approxEqual(
  reByTag['F1'].params.feedPressKgcm2g ?? 0,
  byTag['F1'].params.feedPressKgcm2g ?? 0,
  0.01,
  'Round-trip feed pressKgcm2g'
);
assert.equal(
  reByTag['T-101'].params.distillConfig?.totalStages,
  byTag['T-101'].params.distillConfig?.totalStages
);
assert.equal(
  reByTag['T-101'].params.distillConfig?.feedStage,
  byTag['T-101'].params.distillConfig?.feedStage
);

console.log('Test 2 PASSED!');

// ----------------------------------------------------------------------------
// Test 3: ENG units + MOLE-FRAC + PENG-ROB + FSPLIT
// ----------------------------------------------------------------------------
console.log('--- [Test 3] ENG units + MOLE-FRAC + PENG-ROB + FSPLIT ---');
const ENG_INP = `
TITLE 'BTX Splitter ENG Units'
IN-UNITS ENG
COMPONENTS
    BENZ BENZENE
    TOL TOLUENE
PROPERTIES PENG-ROB
FLOWSHEET
    BLOCK SP-1 IN=FEED1 OUT=OUT-A OUT-B
STREAM FEED1
    SUBSTREAM MIXED TEMP=212.0 PRES=29.3919 MOLE-FLOW=100.0
    MOLE-FRAC BENZ 0.6 TOL 0.4
BLOCK SP-1 FSPLIT
    FRAC OUT-A 0.35
`;

const engParsed = parseProcessTextFile(ENG_INP);
assert.equal(engParsed.propertyMethod, 'PR');
assert.deepEqual(engParsed.activeComponents, ['Benzene', 'Toluene']);
const engByTag = Object.fromEntries(Object.values(engParsed.defs).map((d) => [d.tag, d]));
approxEqual(engByTag['FEED1'].params.feedTempC ?? 0, 100.0, 0.05, '212 F -> 100 C');
// 29.3919 psia ≈ 2.0265 barA ≈ 1.0332 kg/cm2G
approxEqual(engByTag['FEED1'].params.feedPressKgcm2g ?? 0, 1.0332, 0.02, '29.3919 psia -> kg/cm2G');
// 100 lbmol/hr = 45.359237 kmol/hr -> 60% Benzene, 40% Toluene
approxEqual(
  engByTag['FEED1'].params.feedFlowsKgH?.Benzene ?? 0,
  45.359237 * 0.6 * MW.Benzene,
  0.1,
  'ENG Benzene kg/h'
);
approxEqual(engByTag['SP-1'].params.splitRatioTop ?? 0, 0.35, 0.001, 'FSPLIT ratio');

console.log('Test 3 PASSED!');
console.log('\nALL PROCESS TEXT INTEROP TESTS PASSED!');

// ============================================================
// 경량 고정밀 화학공학 수치해석 & 열역학 코어 (Rigorous Thermo & Recycle Engine)
// - 외부 무거운 라이브러리(0 MB) 없이 순수 TypeScript로 구현한 상용급 수치해석 모듈
// - 1) Tarjan 강연결성분(SCC) 기반 순환 루프(Recycle) & Tear Stream 자동 탐색
// - 2) Bounded Wegstein 다변수 가속 수렴기 (순환 루프 고속·안정 수렴)
// - 3) Peng-Robinson 3차 상태방정식(Cardano 실근 해법 + 이진 상호작용 k_ij) + Rachford-Rice 플래시
// - 4) 장치별 정밀 열역학(Rigorous) 서브모델:
//      · 전해조 Nernst + Tafel + 막 저항(IR) 전압·열수지 모델
//      · 열교환기/액화기 3-Zone 상변화 구간 분할 적분 (과열감온 / 응축액화 / 과냉각)
//      · 흡수·건조탑 다단(N-Stage) 기액평형 흡수인자(Kremser-MESH) 모델
//      · 다단 폴리트로픽 실제기체(Z) 압축 + 인터쿨러 열부하 및 Cl₂ 안전온도 진단
// ============================================================

import { MW } from './constants';
import type { SimCompKey } from './flowsheetSolver';
import type { ResolvedPropertyMethod } from './componentCatalog';
import { chlorAlkaliThermoneutralVoltage } from './thermoCore';
import { calcExtendedNrtlGamma } from './activityModels';
import { PR_KIJ_DATABANK, SRK_KIJ_DATABANK, lookupKij } from './data/kijDatabank';
import {
  PSAT_DIPPR101,
  HENRY_WATER_DATABANK,
  henryWaterBar,
  SECHENOV_DATABANK,
} from './data/pureComponentDatabank';

const R_GAS_BAR = 0.08314462; // L·bar / (mol·K)
const R_J_MOLK = 8.314462;    // J / (mol·K)

const mwOf = (k: string, fallback: number): number =>
  (MW as Record<string, number>)[k] ?? fallback;

export interface CritProps {
  Tc_K: number;
  Pc_bar: number;
  omega: number;
  mw: number;
}

export const RIGOROUS_CRIT: Record<SimCompKey, CritProps> = {
  H2O:        { Tc_K: 647.10, Pc_bar: 220.64, omega: 0.344,  mw: MW.H2O },
  Cl2:        { Tc_K: 416.90, Pc_bar: 79.91,  omega: 0.073,  mw: MW.Cl2 },
  H2:         { Tc_K: 33.19,  Pc_bar: 13.13,  omega: -0.216, mw: MW.H2 },
  HCl:        { Tc_K: 324.65, Pc_bar: 83.10,  omega: 0.132,  mw: MW.HCl },
  O2:         { Tc_K: 154.58, Pc_bar: 50.43,  omega: 0.022,  mw: MW.O2 },
  N2:         { Tc_K: 126.20, Pc_bar: 33.98,  omega: 0.037,  mw: MW.N2 },
  NaCl:       { Tc_K: 1500.0, Pc_bar: 350.0,  omega: 0.180,  mw: MW.NaCl },
  NaOH:       { Tc_K: 1550.0, Pc_bar: 360.0,  omega: 0.200,  mw: MW.NaOH },
  H2SO4:      { Tc_K: 924.00, Pc_bar: 64.00,  omega: 0.650,  mw: MW.H2SO4 },
  NaOCl:      { Tc_K: 1200.0, Pc_bar: 280.0,  omega: 0.320,  mw: MW.NaOCl },
  NaClO3:     { Tc_K: 1250.0, Pc_bar: 290.0,  omega: 0.340,  mw: MW.NaClO3 },
  FeCl2:      { Tc_K: 1420.0, Pc_bar: 310.0,  omega: 0.250,  mw: MW.FeCl2 },
  FeCl3:      { Tc_K: 950.0,  Pc_bar: 180.0,  omega: 0.280,  mw: MW.FeCl3 },
  PAC:        { Tc_K: 1450.0, Pc_bar: 300.0,  omega: 0.300,  mw: MW.PAC },
  Glycerol:   { Tc_K: 850.0,  Pc_bar: 75.00,  omega: 0.513,  mw: MW.Glycerol },
  MCH:        { Tc_K: 715.0,  Pc_bar: 58.00,  omega: 0.480,  mw: MW.MCH },
  DCH:        { Tc_K: 668.0,  Pc_bar: 51.20,  omega: 0.435,  mw: MW.DCH },
  ECH:        { Tc_K: 610.0,  Pc_bar: 48.50,  omega: 0.335,  mw: MW.ECH },
  DCP:        { Tc_K: 572.0,  Pc_bar: 42.40,  omega: 0.256,  mw: MW.DCP },
  CH4:        { Tc_K: 190.56, Pc_bar: 45.99,  omega: 0.011,  mw: mwOf('CH4', 16.043) },
  CO:         { Tc_K: 132.85, Pc_bar: 34.94,  omega: 0.045,  mw: mwOf('CO', 28.010) },
  CO2:        { Tc_K: 304.13, Pc_bar: 73.77,  omega: 0.224,  mw: mwOf('CO2', 44.010) },
  NH3:        { Tc_K: 405.40, Pc_bar: 113.33, omega: 0.256,  mw: mwOf('NH3', 17.031) },
  C2H4:       { Tc_K: 282.34, Pc_bar: 50.41,  omega: 0.087,  mw: mwOf('C2H4', 28.054) },
  C2H6:       { Tc_K: 305.32, Pc_bar: 48.72,  omega: 0.099,  mw: mwOf('C2H6', 30.070) },
  C3H6:       { Tc_K: 364.90, Pc_bar: 46.00,  omega: 0.142,  mw: mwOf('C3H6', 42.081) },
  C3H8:       { Tc_K: 369.83, Pc_bar: 42.48,  omega: 0.152,  mw: mwOf('C3H8', 44.097) },
  nC4H10:     { Tc_K: 425.12, Pc_bar: 37.96,  omega: 0.200,  mw: mwOf('nC4H10', 58.123) },
  nC6H14:     { Tc_K: 507.60, Pc_bar: 30.25,  omega: 0.301,  mw: mwOf('nC6H14', 86.177) },
  nC7H16:     { Tc_K: 540.20, Pc_bar: 27.40,  omega: 0.350,  mw: mwOf('nC7H16', 100.204) },
  Benzene:    { Tc_K: 562.05, Pc_bar: 48.95,  omega: 0.210,  mw: mwOf('Benzene', 78.114) },
  Toluene:    { Tc_K: 591.75, Pc_bar: 41.08,  omega: 0.264,  mw: mwOf('Toluene', 92.141) },
  pXylene:    { Tc_K: 616.20, Pc_bar: 35.11,  omega: 0.322,  mw: mwOf('pXylene', 106.167) },
  MeOH:       { Tc_K: 512.64, Pc_bar: 80.97,  omega: 0.564,  mw: mwOf('MeOH', 32.042) },
  EtOH:       { Tc_K: 513.92, Pc_bar: 61.48,  omega: 0.645,  mw: mwOf('EtOH', 46.069) },
  IPA:        { Tc_K: 508.30, Pc_bar: 47.62,  omega: 0.665,  mw: mwOf('IPA', 60.096) },
  Acetone:    { Tc_K: 508.20, Pc_bar: 47.01,  omega: 0.307,  mw: mwOf('Acetone', 58.080) },
  AceticAcid: { Tc_K: 592.71, Pc_bar: 57.86,  omega: 0.467,  mw: mwOf('AceticAcid', 60.052) },
  EtOAc:      { Tc_K: 523.30, Pc_bar: 38.80,  omega: 0.366,  mw: mwOf('EtOAc', 88.106) },
  CHCl3:      { Tc_K: 536.40, Pc_bar: 54.72,  omega: 0.222,  mw: mwOf('CHCl3', 119.378) },
  Ar: { Tc_K: 150.86, Pc_bar: 48.98, omega: -0.002, mw: mwOf('Ar', 39.948) },
  H2S: { Tc_K: 373.53, Pc_bar: 89.63, omega: 0.094, mw: mwOf('H2S', 34.081) },
  SO2: { Tc_K: 430.75, Pc_bar: 78.84, omega: 0.245, mw: mwOf('SO2', 64.064) },
  SO3: { Tc_K: 490.85, Pc_bar: 82.1, omega: 0.424, mw: mwOf('SO3', 80.063) },
  iC4H10: { Tc_K: 407.85, Pc_bar: 36.4, omega: 0.184, mw: mwOf('iC4H10', 58.123) },
  C4H8_1: { Tc_K: 419.5, Pc_bar: 40.2, omega: 0.191, mw: mwOf('C4H8_1', 56.107) },
  nC5H12: { Tc_K: 469.7, Pc_bar: 33.7, omega: 0.252, mw: mwOf('nC5H12', 72.150) },
  nC8H18: { Tc_K: 568.7, Pc_bar: 24.9, omega: 0.399, mw: mwOf('nC8H18', 114.231) },
  Cyclohexane: { Tc_K: 553.8, Pc_bar: 40.8, omega: 0.21, mw: mwOf('Cyclohexane', 84.161) },
  Ethylbenzene: { Tc_K: 617.15, Pc_bar: 36.09, omega: 0.304, mw: mwOf('Ethylbenzene', 106.167) },
  Styrene: { Tc_K: 636.0, Pc_bar: 38.4, omega: 0.297, mw: mwOf('Styrene', 104.152) },
  Cumene: { Tc_K: 631.0, Pc_bar: 32.09, omega: 0.326, mw: mwOf('Cumene', 120.194) },
  Phenol: { Tc_K: 694.25, Pc_bar: 61.3, omega: 0.444, mw: mwOf('Phenol', 94.113) },
  THF: { Tc_K: 540.15, Pc_bar: 51.9, omega: 0.225, mw: mwOf('THF', 72.107) },
  DMF: { Tc_K: 649.6, Pc_bar: 44.2, omega: 0.318, mw: mwOf('DMF', 73.095) },
  DMSO: { Tc_K: 729.0, Pc_bar: 56.5, omega: 0.281, mw: mwOf('DMSO', 78.133) },
  MTBE: { Tc_K: 497.1, Pc_bar: 34.3, omega: 0.266, mw: mwOf('MTBE', 88.150) },
  MEK: { Tc_K: 535.5, Pc_bar: 41.5, omega: 0.323, mw: mwOf('MEK', 72.107) },
  DMC: { Tc_K: 557.0, Pc_bar: 49.09, omega: 0.476, mw: mwOf('DMC', 90.078) },
  EG: { Tc_K: 720.0, Pc_bar: 82.0, omega: 0.487, mw: mwOf('EG', 62.068) },
  MEA: { Tc_K: 671.0, Pc_bar: 80.3, omega: 0.586, mw: mwOf('MEA', 61.084) },
  MDEA: { Tc_K: 677.8, Pc_bar: 38.8, omega: 1.242, mw: mwOf('MDEA', 119.163) },
  FormicAcid: { Tc_K: 588.0, Pc_bar: 58.1, omega: 0.316, mw: mwOf('FormicAcid', 46.025) },
  HNO3: { Tc_K: 520.0, Pc_bar: 68.9, omega: 0.714, mw: mwOf('HNO3', 63.012) },
  CH3Cl: { Tc_K: 416.30, Pc_bar: 66.80, omega: 0.153, mw: mwOf('CH3Cl', 50.488) },
  CH2Cl2: { Tc_K: 510.00, Pc_bar: 60.80, omega: 0.199, mw: mwOf('CH2Cl2', 84.933) },
  CCl4: { Tc_K: 556.40, Pc_bar: 45.60, omega: 0.193, mw: mwOf('CCl4', 153.823) },
  C2Cl4: { Tc_K: 620.20, Pc_bar: 47.60, omega: 0.254, mw: mwOf('C2Cl4', 165.834) },
  COCl2: { Tc_K: 455.00, Pc_bar: 56.70, omega: 0.204, mw: mwOf('COCl2', 98.916) },
  HCHO: { Tc_K: 408.00, Pc_bar: 65.90, omega: 0.282, mw: mwOf('HCHO', 30.026) },
  MCB: { Tc_K: 632.40, Pc_bar: 45.20, omega: 0.249, mw: mwOf('MCB', 112.558) },
  Aniline: { Tc_K: 699.00, Pc_bar: 53.09, omega: 0.384, mw: mwOf('Aniline', 93.128) },
  MDA: { Tc_K: 882.00, Pc_bar: 28.20, omega: 0.685, mw: mwOf('MDA', 198.268) },
  MDI: { Tc_K: 802.00, Pc_bar: 23.40, omega: 0.610, mw: mwOf('MDI', 250.256) },
  PMDI: { Tc_K: 945.00, Pc_bar: 16.50, omega: 0.850, mw: mwOf('PMDI', 381.400) },
  CUSTOM_1: { Tc_K: 563.05, Pc_bar: 44.23, omega: 0.59, mw: mwOf('CUSTOM_1', 74.122) },
  CUSTOM_2: { Tc_K: 699.0, Pc_bar: 53.09, omega: 0.384, mw: mwOf('CUSTOM_2', 93.128) },
  // 3차 확장: 국내 중견/중소 전자소재 · 이차전지 · 수처리 핵심 11종
  H2O2:   { Tc_K: 730.15, Pc_bar: 216.8, omega: 0.340, mw: mwOf('H2O2', 34.0147) },
  H3PO4:  { Tc_K: 1030.0, Pc_bar: 130.0, omega: 0.720, mw: mwOf('H3PO4', 97.9952) },
  HF:     { Tc_K: 461.15, Pc_bar: 64.8,  omega: 0.372, mw: mwOf('HF', 20.0063) },
  KOH:    { Tc_K: 1600.0, Pc_bar: 350.0, omega: 0.220, mw: mwOf('KOH', 56.1056) },
  NH4OH:  { Tc_K: 415.0,  Pc_bar: 113.0, omega: 0.280, mw: mwOf('NH4OH', 35.0458) },
  TMAH:   { Tc_K: 780.0,  Pc_bar: 48.0,  omega: 0.550, mw: mwOf('TMAH', 91.152) },
  NMP:    { Tc_K: 721.6,  Pc_bar: 45.2,  omega: 0.358, mw: mwOf('NMP', 99.131) },
  BCS:    { Tc_K: 633.9,  Pc_bar: 32.7,  omega: 0.562, mw: mwOf('BCS', 118.174) },
  Na2CO3: { Tc_K: 1850.0, Pc_bar: 350.0, omega: 0.250, mw: mwOf('Na2CO3', 105.9888) },
  NaHSO3: { Tc_K: 1200.0, Pc_bar: 250.0, omega: 0.350, mw: mwOf('NaHSO3', 104.061) },
  CaOH2:  { Tc_K: 1500.0, Pc_bar: 300.0, omega: 0.300, mw: mwOf('CaOH2', 74.093) },
};

// 문헌 기반 주요 가스·탄화수소·극성 성분 이진 상호작용 파라미터 (k_ij = k_ji)
const BINARY_KIJ: Partial<Record<string, number>> = {
  'Cl2:O2': 0.045,
  'O2:Cl2': 0.045,
  'Cl2:H2': 0.082,
  'H2:Cl2': 0.082,
  'Cl2:HCl': 0.018,
  'HCl:Cl2': 0.018,
  'Cl2:H2O': -0.055,
  'H2O:Cl2': -0.055,
  'H2:H2O': 0.120,
  'H2O:H2': 0.120,
  'O2:H2O': 0.110,
  'H2O:O2': 0.110,
  'HCl:H2O': -0.140,
  'H2O:HCl': -0.140,
  'CO2:CH4': 0.092,
  'CH4:CO2': 0.092,
  'CO2:C2H6': 0.132,
  'C2H6:CO2': 0.132,
  'CO2:C3H8': 0.124,
  'C3H8:CO2': 0.124,
  'CO2:H2O': -0.065,
  'H2O:CO2': -0.065,
  'CH4:H2O': 0.48,
  'H2O:CH4': 0.48,
  'H2:CH4': 0.015,
  'CH4:H2': 0.015,
  'H2:CO': 0.091,
  'CO:H2': 0.091,
  'H2:N2': 0.103,
  'N2:H2': 0.103,
  'N2:CH4': 0.031,
  'CH4:N2': 0.031,
  'N2:O2': -0.012,
  'O2:N2': -0.012,
  'Benzene:nC6H14': 0.009,
  'nC6H14:Benzene': 0.009,
  'HCl:CH3Cl': 0.025,
  'CH3Cl:HCl': 0.025,
  'Cl2:CH3Cl': 0.015,
  'CH3Cl:Cl2': 0.015,
  'CH3Cl:CH2Cl2': 0.005,
  'CH2Cl2:CH3Cl': 0.005,
  'CH2Cl2:CHCl3': 0.003,
  'CHCl3:CH2Cl2': 0.003,
  'CHCl3:CCl4': 0.004,
  'CCl4:CHCl3': 0.004,
};

function getKij(a: SimCompKey, b: SimCompKey, method: 'PR' | 'SRK' = 'PR'): number {
  if (a === b) return 0;
  const dbVal = lookupKij(method === 'SRK' ? SRK_KIJ_DATABANK : PR_KIJ_DATABANK, a, b);
  if (dbVal !== 0) return dbVal;
  // Check explicit zero entry in databank before falling back to chlor-alkali gas pairs
  const bank = method === 'SRK' ? SRK_KIJ_DATABANK : PR_KIJ_DATABANK;
  for (let idx = 0; idx < bank.length; idx++) {
    const e = bank[idx];
    if ((e.i === a && e.j === b) || (e.i === b && e.j === a)) return e.kij;
  }
  return BINARY_KIJ[`${a}:${b}`] ?? BINARY_KIJ[`${b}:${a}`] ?? 0;
}

// ── 1) 순환 루프(Recycle) & Tear Stream 자동 탐색기 ─────────────────────────
export interface TearAnalysisResult {
  orderedNodeIds: string[];
  tearEdgeIds: string[];
  loopCount: number;
}

export function analyzeFlowsheetTopology(
  nodeIds: string[],
  edges: Array<{ id: string; source: string; target: string }>
): TearAnalysisResult {
  const validSet = new Set(nodeIds);
  const validEdges = edges.filter(e => validSet.has(e.source) && validSet.has(e.target));

  // Tarjan SCC로 실제 순환 루프 개수 파악
  let idx = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let sccCycleCount = 0;

  const adj = new Map<string, Array<{ target: string; edgeId: string }>>();
  nodeIds.forEach(id => adj.set(id, []));
  validEdges.forEach(e => adj.get(e.source)!.push({ target: e.target, edgeId: e.id }));

  function strongConnect(v: string) {
    indices.set(v, idx);
    lowlink.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);

    for (const { target: w } of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      let w = '';
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccCycleCount++;
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) strongConnect(id);
  }

  // Greedy FAS (Feedback Arc Set) + DFS Back-Edge 탐지로 최적 Tear Stream 선정 및 위상 정렬 생성
  const visited = new Set<string>();
  const activeStack = new Set<string>();
  const tearEdgeIds: string[] = [];
  const postOrder: string[] = [];

  function dfsOrder(u: string) {
    visited.add(u);
    activeStack.add(u);
    for (const { target: v, edgeId } of adj.get(u) ?? []) {
      if (activeStack.has(v)) {
        // 순환 피드백 배관(Tear Stream) 발견!
        tearEdgeIds.push(edgeId);
      } else if (!visited.has(v)) {
        dfsOrder(v);
      }
    }
    activeStack.delete(u);
    postOrder.push(u);
  }

  // 진입 차수 0인 원료/상류 노드부터 탐색 시작하여 자연스러운 상류→하류 순서 보장
  const inDeg = new Map<string, number>();
  nodeIds.forEach(id => inDeg.set(id, 0));
  validEdges.forEach(e => inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1));

  const roots = [...nodeIds].sort((a, b) => (inDeg.get(a) ?? 0) - (inDeg.get(b) ?? 0));
  for (const r of roots) {
    if (!visited.has(r)) dfsOrder(r);
  }

  return {
    orderedNodeIds: postOrder.reverse(),
    tearEdgeIds: Array.from(new Set(tearEdgeIds)),
    loopCount: sccCycleCount,
  };
}

// ── 2) Bounded Wegstein 수치 가속 업데이트 ───────────────────────────────────
/**
 * x_prev: 이전 반복에서의 Tear 입력값 x^(k-1)
 * g_prev: 이전 반복에서의 Tear 계산 결과 g(x^(k-1))
 * x_curr: 현재 반복에서의 Tear 입력값 x^(k)
 * g_curr: 현재 반복에서의 Tear 계산 결과 g(x^(k))
 * 반환값: 가속 적용된 다음 입력값 x^(k+1)
 */
export function wegsteinAccelerate(
  x_prev: number,
  g_prev: number,
  x_curr: number,
  g_curr: number,
  minBound = 0
): number {
  const dx = x_curr - x_prev;
  if (Math.abs(dx) < 1e-7) {
    return Math.max(minBound, g_curr);
  }
  const s = (g_curr - g_prev) / dx;
  // s >= 1 이면 단순 치환이 발산할 수 있으므로 Bounded Wegstein (-4.0 <= q <= 0)으로 안정 가속
  let q = 0;
  if (Math.abs(s - 1.0) > 1e-5) {
    q = s / (s - 1.0);
    // 0 < s < 1: 가속(-3.5 <= q < 0), s < 0 (진동성 루프): 감쇠(0 < q <= 0.75) 모두 지원
    q = Math.max(-3.5, Math.min(0.75, q));
  }
  const nextVal = (1.0 - q) * g_curr + q * x_curr;
  return Math.max(minBound, Number.isFinite(nextVal) ? nextVal : g_curr);
}

// ── 3) Cardano 3차 방정식 해석해 + Peng-Robinson 다성분 Z 및 퓨개시티 ─────────
function solveCubicRealRoots(c2: number, c1: number, c0: number): number[] {
  // Z^3 + c2 Z^2 + c1 Z + c0 = 0
  const p = c1 - (c2 * c2) / 3.0;
  const q = (2.0 * c2 * c2 * c2) / 27.0 - (c2 * c1) / 3.0 + c0;
  const disc = (q * q) / 4.0 + (p * p * p) / 27.0;

  if (disc > 1e-12) {
    const sqrtD = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2.0 + sqrtD);
    const v = Math.cbrt(-q / 2.0 - sqrtD);
    return [u + v - c2 / 3.0];
  } else if (Math.abs(disc) <= 1e-12) {
    const u = Math.cbrt(-q / 2.0);
    return [2.0 * u - c2 / 3.0, -u - c2 / 3.0];
  } else {
    const r = Math.sqrt(Math.max(1e-16, -(p * p * p) / 27.0));
    const cosPhi = Math.max(-1.0, Math.min(1.0, -q / (2.0 * r)));
    const phi = Math.acos(cosPhi);
    const m = 2.0 * Math.cbrt(r);
    return [
      m * Math.cos(phi / 3.0) - c2 / 3.0,
      m * Math.cos((phi + 2.0 * Math.PI) / 3.0) - c2 / 3.0,
      m * Math.cos((phi + 4.0 * Math.PI) / 3.0) - c2 / 3.0,
    ];
  }
}

const _cubicOutBuf = new Float64Array(3);
function solveCubicMinMaxAbove(c2: number, c1: number, c0: number, minBound: number, out: Float64Array): void {
  const p = c1 - (c2 * c2) / 3.0;
  const q = (2.0 * c2 * c2 * c2) / 27.0 - (c2 * c1) / 3.0 + c0;
  const disc = (q * q) / 4.0 + (p * p * p) / 27.0;
  const shift = c2 / 3.0;
  let zMin = Infinity;
  let zMax = -Infinity;
  let count = 0;

  if (disc > 1e-12) {
    const sqrtD = Math.sqrt(disc);
    const r1 = Math.cbrt(-q / 2.0 + sqrtD) + Math.cbrt(-q / 2.0 - sqrtD) - shift;
    if (r1 > minBound) {
      zMin = r1;
      zMax = r1;
      count = 1;
    }
  } else if (Math.abs(disc) <= 1e-12) {
    const u = Math.cbrt(-q / 2.0);
    const r1 = 2.0 * u - shift;
    const r2 = -u - shift;
    if (r1 > minBound) { zMin = r1; zMax = r1; count++; }
    if (r2 > minBound) {
      if (r2 < zMin) zMin = r2;
      if (r2 > zMax) zMax = r2;
      count++;
    }
  } else {
    const r = Math.sqrt(Math.max(1e-16, -(p * p * p) / 27.0));
    const cosPhi = Math.max(-1.0, Math.min(1.0, -q / (2.0 * r)));
    const phi = Math.acos(cosPhi);
    const m = 2.0 * Math.cbrt(r);
    const r1 = m * Math.cos(phi / 3.0) - shift;
    const r2 = m * Math.cos((phi + 2.0 * Math.PI) / 3.0) - shift;
    const r3 = m * Math.cos((phi + 4.0 * Math.PI) / 3.0) - shift;
    if (r1 > minBound) { zMin = r1; zMax = r1; count++; }
    if (r2 > minBound) { if (r2 < zMin) zMin = r2; if (r2 > zMax) zMax = r2; count++; }
    if (r3 > minBound) { if (r3 < zMin) zMin = r3; if (r3 > zMax) zMax = r3; count++; }
  }

  if (count === 0) {
    const fb = minBound - 1e-9 + 1e-6;
    out[0] = fb;
    out[1] = fb;
    out[2] = 1;
  } else {
    out[0] = zMin;
    out[1] = zMax;
    out[2] = count;
  }
}

export interface PrMixtureResult {
  Z_vap: number;
  Z_liq: number;
  Z_stable: number;
  rootCount: number;
  B: number;
  phi_vap: Record<SimCompKey, number>;
  phi_liq: Record<SimCompKey, number>;
  phi_stable: Record<SimCompKey, number>;
}

const VOLATILE_KEYS: SimCompKey[] = [
  'H2O', 'Cl2', 'H2', 'HCl', 'O2', 'N2', 'ECH', 'DCP', 'DCH', 'MCH', 'Glycerol',
  'CH4', 'CO', 'CO2', 'NH3',
  'C2H4', 'C2H6', 'C3H6', 'C3H8', 'nC4H10', 'nC6H14', 'nC7H16',
  'Benzene', 'Toluene', 'pXylene',
  'MeOH', 'EtOH', 'IPA', 'Acetone', 'AceticAcid', 'EtOAc', 'CHCl3',
  'Ar', 'H2S', 'SO2', 'SO3', 'iC4H10', 'C4H8_1', 'nC5H12', 'nC8H18', 'Cyclohexane', 'Ethylbenzene', 'Styrene', 'Cumene', 'Phenol', 'THF', 'DMF', 'DMSO', 'MTBE', 'MEK', 'DMC', 'EG', 'MEA', 'MDEA', 'FormicAcid', 'HNO3',
  'CH3Cl', 'CH2Cl2', 'CCl4', 'C2Cl4', 'COCl2', 'HCHO', 'MCB', 'Aniline', 'MDA', 'MDI', 'PMDI', 'CUSTOM_1', 'CUSTOM_2',
  'H2O2', 'H3PO4', 'HF', 'NH4OH', 'NMP', 'BCS',
];
const PERMANENT_SUPERCRIT_SET = new Set<SimCompKey>(['H2', 'O2', 'N2', 'CH4', 'CO', 'Ar']);
const AQUEOUS_HENRY_CONDENSABLE_SET = new Set<SimCompKey>(['Cl2', 'CO2', 'H2S', 'SO2', 'C2H4', 'C2H6', 'C3H6', 'C3H8']);
const NON_VOLATILE_RIG_SET = new Set<SimCompKey>([
  'NaCl', 'NaOH', 'H2SO4', 'NaOCl', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC',
  'KOH', 'TMAH', 'Na2CO3', 'NaHSO3', 'CaOH2',
]);
const ALL_RIG_KEYS: SimCompKey[] = [
  'H2O', 'NaCl', 'NaOH', 'Cl2', 'H2', 'HCl', 'H2SO4', 'O2', 'NaOCl',
  'N2', 'NaClO3', 'FeCl2', 'FeCl3', 'PAC', 'Glycerol', 'MCH', 'DCH', 'ECH', 'DCP',
  'CH4', 'CO', 'CO2', 'NH3',
  'C2H4', 'C2H6', 'C3H6', 'C3H8', 'nC4H10', 'nC6H14', 'nC7H16',
  'Benzene', 'Toluene', 'pXylene',
  'MeOH', 'EtOH', 'IPA', 'Acetone', 'AceticAcid', 'EtOAc', 'CHCl3',
  'Ar', 'H2S', 'SO2', 'SO3', 'iC4H10', 'C4H8_1', 'nC5H12', 'nC8H18', 'Cyclohexane', 'Ethylbenzene', 'Styrene', 'Cumene', 'Phenol', 'THF', 'DMF', 'DMSO', 'MTBE', 'MEK', 'DMC', 'EG', 'MEA', 'MDEA', 'FormicAcid', 'HNO3',
  'CH3Cl', 'CH2Cl2', 'CCl4', 'C2Cl4', 'COCl2', 'HCHO', 'MCB', 'Aniline', 'MDA', 'MDI', 'PMDI', 'CUSTOM_1', 'CUSTOM_2',
  'H2O2', 'H3PO4', 'HF', 'KOH', 'NH4OH', 'TMAH', 'NMP', 'BCS', 'Na2CO3', 'NaHSO3', 'CaOH2',
];
const N_RIG = ALL_RIG_KEYS.length;
const RIG_COMP_IDX: Record<SimCompKey, number> = {} as Record<SimCompKey, number>;
ALL_RIG_KEYS.forEach((k, idx) => {
  RIG_COMP_IDX[k] = idx;
});

const PR_KIJ_MAT = new Float64Array(N_RIG * N_RIG);
const SRK_KIJ_MAT = new Float64Array(N_RIG * N_RIG);
for (let i = 0; i < N_RIG; i++) {
  for (let j = i + 1; j < N_RIG; j++) {
    const a = ALL_RIG_KEYS[i];
    const b = ALL_RIG_KEYS[j];
    const kp = getKij(a, b, 'PR');
    const ks = getKij(a, b, 'SRK');
    PR_KIJ_MAT[i * N_RIG + j] = kp;
    PR_KIJ_MAT[j * N_RIG + i] = kp;
    SRK_KIJ_MAT[i * N_RIG + j] = ks;
    SRK_KIJ_MAT[j * N_RIG + i] = ks;
  }
}

export function rebuildRigorousKijCache(): void {
  PR_KIJ_MAT.fill(0);
  SRK_KIJ_MAT.fill(0);
  for (let i = 0; i < N_RIG; i++) {
    for (let j = i + 1; j < N_RIG; j++) {
      const a = ALL_RIG_KEYS[i];
      const b = ALL_RIG_KEYS[j];
      const kp = getKij(a, b, 'PR');
      const ks = getKij(a, b, 'SRK');
      PR_KIJ_MAT[i * N_RIG + j] = kp;
      PR_KIJ_MAT[j * N_RIG + i] = kp;
      SRK_KIJ_MAT[i * N_RIG + j] = ks;
      SRK_KIJ_MAT[j * N_RIG + i] = ks;
    }
  }
}
rebuildRigorousKijCache();

const ZERO_RIG_TEMPLATE: Record<SimCompKey, number> = {
  H2O: 0, NaCl: 0, NaOH: 0, Cl2: 0, H2: 0, HCl: 0, H2SO4: 0, O2: 0, NaOCl: 0,
  N2: 0, NaClO3: 0, FeCl2: 0, FeCl3: 0, PAC: 0, Glycerol: 0, MCH: 0, DCH: 0, ECH: 0, DCP: 0,
  CH4: 0, CO: 0, CO2: 0, NH3: 0,
  C2H4: 0, C2H6: 0, C3H6: 0, C3H8: 0, nC4H10: 0, nC6H14: 0, nC7H16: 0,
  Benzene: 0, Toluene: 0, pXylene: 0,
  MeOH: 0, EtOH: 0, IPA: 0, Acetone: 0, AceticAcid: 0, EtOAc: 0, CHCl3: 0,
  Ar: 0, H2S: 0, SO2: 0, SO3: 0, iC4H10: 0, C4H8_1: 0, nC5H12: 0, nC8H18: 0,
  Cyclohexane: 0, Ethylbenzene: 0, Styrene: 0, Cumene: 0, Phenol: 0, THF: 0, DMF: 0, DMSO: 0,
  MTBE: 0, MEK: 0, DMC: 0, EG: 0, MEA: 0, MDEA: 0, FormicAcid: 0, HNO3: 0,
  CH3Cl: 0, CH2Cl2: 0, CCl4: 0, C2Cl4: 0,
  COCl2: 0, HCHO: 0, MCB: 0, Aniline: 0, MDA: 0, MDI: 0, PMDI: 0, CUSTOM_1: 0, CUSTOM_2: 0,
  H2O2: 0, H3PO4: 0, HF: 0, KOH: 0, NH4OH: 0, TMAH: 0, NMP: 0, BCS: 0, Na2CO3: 0, NaHSO3: 0, CaOH2: 0,
};

const ONE_RIG_TEMPLATE: Record<SimCompKey, number> = {
  H2O: 1, NaCl: 1, NaOH: 1, Cl2: 1, H2: 1, HCl: 1, H2SO4: 1, O2: 1, NaOCl: 1,
  N2: 1, NaClO3: 1, FeCl2: 1, FeCl3: 1, PAC: 1, Glycerol: 1, MCH: 1, DCH: 1, ECH: 1, DCP: 1,
  CH4: 1, CO: 1, CO2: 1, NH3: 1,
  C2H4: 1, C2H6: 1, C3H6: 1, C3H8: 1, nC4H10: 1, nC6H14: 1, nC7H16: 1,
  Benzene: 1, Toluene: 1, pXylene: 1,
  MeOH: 1, EtOH: 1, IPA: 1, Acetone: 1, AceticAcid: 1, EtOAc: 1, CHCl3: 1,
  Ar: 1, H2S: 1, SO2: 1, SO3: 1, iC4H10: 1, C4H8_1: 1, nC5H12: 1, nC8H18: 1,
  Cyclohexane: 1, Ethylbenzene: 1, Styrene: 1, Cumene: 1, Phenol: 1, THF: 1, DMF: 1, DMSO: 1,
  MTBE: 1, MEK: 1, DMC: 1, EG: 1, MEA: 1, MDEA: 1, FormicAcid: 1, HNO3: 1,
  CH3Cl: 1, CH2Cl2: 1, CCl4: 1, C2Cl4: 1,
  COCl2: 1, HCHO: 1, MCB: 1, Aniline: 1, MDA: 1, MDI: 1, PMDI: 1, CUSTOM_1: 1, CUSTOM_2: 1,
  H2O2: 1, H3PO4: 1, HF: 1, KOH: 1, NH4OH: 1, TMAH: 1, NMP: 1, BCS: 1, Na2CO3: 1, NaHSO3: 1, CaOH2: 1,
};

const PHI_DEFAULT_TEMPLATE: Record<SimCompKey, number> = {
  H2O: 1, NaCl: 1e-12, NaOH: 1e-12, Cl2: 1, H2: 1, HCl: 1, H2SO4: 1e-12, O2: 1, NaOCl: 1e-12,
  N2: 1, NaClO3: 1e-12, FeCl2: 1e-12, FeCl3: 1e-12, PAC: 1e-12, Glycerol: 1, MCH: 1, DCH: 1, ECH: 1, DCP: 1,
  CH4: 1, CO: 1, CO2: 1, NH3: 1,
  C2H4: 1, C2H6: 1, C3H6: 1, C3H8: 1, nC4H10: 1, nC6H14: 1, nC7H16: 1,
  Benzene: 1, Toluene: 1, pXylene: 1,
  MeOH: 1, EtOH: 1, IPA: 1, Acetone: 1, AceticAcid: 1, EtOAc: 1, CHCl3: 1,
  Ar: 1, H2S: 1, SO2: 1, SO3: 1, iC4H10: 1, C4H8_1: 1, nC5H12: 1, nC8H18: 1,
  Cyclohexane: 1, Ethylbenzene: 1, Styrene: 1, Cumene: 1, Phenol: 1, THF: 1, DMF: 1, DMSO: 1,
  MTBE: 1, MEK: 1, DMC: 1, EG: 1, MEA: 1, MDEA: 1, FormicAcid: 1, HNO3: 1,
  CH3Cl: 1, CH2Cl2: 1, CCl4: 1, C2Cl4: 1,
  COCl2: 1, HCHO: 1, MCB: 1, Aniline: 1, MDA: 1, MDI: 1, PMDI: 1, CUSTOM_1: 1, CUSTOM_2: 1,
  H2O2: 1, H3PO4: 1, HF: 1, KOH: 1e-12, NH4OH: 1, TMAH: 1e-12, NMP: 1, BCS: 1, Na2CO3: 1e-12, NaHSO3: 1e-12, CaOH2: 1e-12,
};

const _eosActKeys: SimCompKey[] = new Array<SimCompKey>(N_RIG);
const _eosActSlot = new Int32Array(N_RIG);
const _eosActIdx = new Int32Array(N_RIG);
const _eosYNorm = new Float64Array(N_RIG);
const _eosSqrtAi = new Float64Array(N_RIG);
const _eosBi = new Float64Array(N_RIG);
const _eosSumAij = new Float64Array(N_RIG);

function zeroRigRecord(defaultVal = 0): Record<SimCompKey, number> {
  if (defaultVal === 0) return { ...ZERO_RIG_TEMPLATE };
  if (defaultVal === 1) return { ...ONE_RIG_TEMPLATE };
  if (defaultVal === 1e-12) return { ...PHI_DEFAULT_TEMPLATE };
  const r = { ...ZERO_RIG_TEMPLATE };
  for (let i = 0; i < N_RIG; i++) r[ALL_RIG_KEYS[i]] = defaultVal;
  return r;
}

/**
 * 성분별 순수 포화 증기압 P_sat (barA) — NIST / Perry Antoine 상관식 (순환 참조 방지 공유 헬퍼)
 */
export function pureAntoineBarA(comp: SimCompKey, T_C: number): number {
  if (NON_VOLATILE_RIG_SET.has(comp)) return 1e-10;
  const T = Math.max(-110, Math.min(360, T_C));
  const Tc = Math.max(-185, Math.min(360, T_C));
  switch (comp) {
    case 'H2':
      return 1050.0 * Math.exp(0.004 * T);
    case 'N2':
      return 510.0 * Math.exp(0.005 * T);
    case 'O2':
      return 375.0 * Math.exp(0.0055 * T);
    case 'CO':
      return 620.0 * Math.exp(0.0048 * T);
    case 'CH4':
      return Math.pow(10, 3.9895 - 443.03 / Math.max(40, Tc + 272.66));
    case 'CO2':
      return Math.pow(10, 4.7160 - 867.2 / Math.max(60, Tc + 273.15));
    case 'NH3':
      return Math.pow(10, 4.8689 - 1115.6 / Math.max(60, Tc + 262.71));
    case 'C2H4':
      return Math.pow(10, 3.9970 - 602.65 / Math.max(50, Tc + 254.84));
    case 'C2H6':
      return Math.pow(10, 3.9540 - 663.72 / Math.max(50, Tc + 256.68));
    case 'C3H6':
      return Math.pow(10, 3.9561 - 787.30 / Math.max(50, Tc + 247.00));
    case 'C3H8':
      return Math.pow(10, 3.9829 - 821.80 / Math.max(50, Tc + 248.73));
    case 'nC4H10':
      return Math.pow(10, 3.9327 - 935.77 / Math.max(50, Tc + 238.79));
    case 'nC6H14':
      return Math.pow(10, 4.0027 - 1171.53 / Math.max(50, T + 224.37));
    case 'nC7H16':
      return Math.pow(10, 4.0283 - 1268.64 / Math.max(50, T + 216.90));
    case 'Benzene':
      return Math.pow(10, 4.0181 - 1203.83 / Math.max(50, T + 219.89));
    case 'Toluene':
      return Math.pow(10, 4.0783 - 1343.94 / Math.max(50, T + 219.38));
    case 'pXylene':
      return Math.pow(10, 4.1114 - 1452.20 / Math.max(50, T + 215.31));
    case 'MeOH':
      return Math.pow(10, 5.2041 - 1581.34 / Math.max(50, T + 239.65));
    case 'EtOH':
      return Math.pow(10, 5.2468 - 1598.67 / Math.max(50, T + 226.58));
    case 'IPA':
      return Math.pow(10, 4.8610 - 1357.43 / Math.max(50, T + 197.34));
    case 'Acetone':
      return Math.pow(10, 4.4245 - 1312.25 / Math.max(50, T + 240.71));
    case 'AceticAcid':
      return Math.pow(10, 4.6821 - 1642.54 / Math.max(50, T + 233.52));
    case 'EtOAc':
      return Math.pow(10, 4.2281 - 1245.70 / Math.max(50, T + 217.88));
    case 'CHCl3':
      return Math.pow(10, 4.2077 - 1233.13 / Math.max(50, T + 232.30));
    case 'CH3Cl':
      return Math.pow(10, 4.2185 - 948.50 / Math.max(50, T + 249.30));
    case 'CH2Cl2':
      return Math.pow(10, 4.2078 - 1138.90 / Math.max(50, T + 231.45));
    case 'CCl4':
      return Math.pow(10, 4.0229 - 1221.78 / Math.max(50, T + 227.50));
    case 'C2Cl4':
      return Math.pow(10, 4.1616 - 1442.50 / Math.max(50, T + 226.00));
    case 'Ar':
      return 420.0 * Math.exp(0.0052 * T);
    case 'H2S':
      return Math.pow(10, 4.228 - 804.4 / Math.max(50, T + 249.6));
    case 'SO2':
      return Math.pow(10, 4.41 - 1045.0 / Math.max(50, T + 242.0));
    case 'SO3':
      return Math.pow(10, 6.175 - 1735.0 / Math.max(50, T + 236.0));
    case 'iC4H10':
      return Math.pow(10, 3.9081 - 886.42 / Math.max(50, T + 240.4));
    case 'C4H8_1':
      return Math.pow(10, 3.9178 - 908.8 / Math.max(50, T + 238.5));
    case 'nC5H12':
      return Math.pow(10, 3.9779 - 1064.84 / Math.max(50, T + 232.01));
    case 'nC8H18':
      return Math.pow(10, 4.0487 - 1355.13 / Math.max(50, T + 209.52));
    case 'Cyclohexane':
      return Math.pow(10, 3.9699 - 1201.53 / Math.max(50, T + 222.65));
    case 'Ethylbenzene':
      return Math.pow(10, 4.0825 - 1424.25 / Math.max(50, T + 213.21));
    case 'Styrene':
      return Math.pow(10, 4.14 - 1485.0 / Math.max(50, T + 214.0));
    case 'Cumene':
      return Math.pow(10, 4.079 - 1460.79 / Math.max(50, T + 207.78));
    case 'Phenol':
      return Math.pow(10, 4.2696 - 1523.42 / Math.max(50, T + 175.4));
    case 'THF':
      return Math.pow(10, 4.1212 - 1202.94 / Math.max(50, T + 226.25));
    case 'DMF':
      return Math.pow(10, 4.0935 - 1400.86 / Math.max(50, T + 196.43));
    case 'DMSO':
      return Math.pow(10, 4.4911 - 1807.0 / Math.max(50, T + 210.5));
    case 'MTBE':
      return Math.pow(10, 4.0702 - 1150.0 / Math.max(50, T + 226.0));
    case 'MEK':
      return Math.pow(10, 4.1381 - 1261.34 / Math.max(50, T + 221.97));
    case 'DMC':
      return Math.pow(10, 4.312 - 1345.0 / Math.max(50, T + 219.0));
    case 'EG':
      return Math.pow(10, 4.9701 - 1914.95 / Math.max(50, T + 195.0));
    case 'MEA':
      return Math.pow(10, 4.92 - 1770.0 / Math.max(50, T + 198.0));
    case 'MDEA':
      return Math.pow(10, 5.18 - 2240.0 / Math.max(50, T + 190.0));
    case 'FormicAcid':
      return Math.pow(10, 4.219 - 1295.26 / Math.max(50, T + 218.0));
    case 'HNO3':
      return Math.pow(10, 4.685 - 1486.0 / Math.max(50, T + 228.0));
    case 'COCl2':
      return Math.pow(10, 4.2236 - 1030.0 / Math.max(50, T + 236.0));
    case 'HCHO':
      return Math.pow(10, 4.2467 - 975.0 / Math.max(40, T + 249.0));
    case 'MCB':
      return Math.pow(10, 4.11653 - 1435.675 / Math.max(50, T + 217.52));
    case 'Aniline':
      return Math.pow(10, 4.3454 - 1661.86 / Math.max(50, T + 199.1));
    case 'MDA':
      return Math.pow(10, 4.5781 - 2620.0 / Math.max(50, T + 175.0));
    case 'MDI':
      return Math.pow(10, 6.490 - 3041.0 / Math.max(60, T + 155.0));
    case 'PMDI':
      return Math.pow(10, 5.804 - 3450.0 / Math.max(60, T + 160.0));
    case 'CUSTOM_1':
      return Math.pow(10, 4.5461 - 1351.56 / Math.max(50, T + 179.81));
    case 'CUSTOM_2':
      return Math.pow(10, 4.3454 - 1661.86 / Math.max(50, T + 199.1));
    case 'H2O2':
      return Math.pow(10, 5.0598 - 1791.17 / Math.max(50, T + 204.2));
    case 'H3PO4':
      return Math.pow(10, 5.1500 - 2119.44 / Math.max(50, T + 199.0));
    case 'HF':
      return Math.pow(10, 4.8120 - 1280.87 / Math.max(40, T + 247.0));
    case 'NH4OH':
      return Math.pow(10, 4.8500 - 1340.41 / Math.max(40, T + 239.0));
    case 'NMP':
      return Math.pow(10, 4.3550 - 1783.21 / Math.max(50, T + 208.0));
    case 'BCS':
      return Math.pow(10, 4.5850 - 1695.25 / Math.max(50, T + 199.0));
    case 'HCl': {
      const logP = 4.5292 - 849.1 / Math.max(40, T + 272.76);
      return Math.pow(10, logP);
    }
    case 'Cl2': {
      const logP = 4.0628 - 861.34 / Math.max(50, T + 246.14);
      return Math.pow(10, logP);
    }
    case 'DCP':
      return Math.pow(10, 4.082 - 1308.0 / Math.max(60, T + 225.2));
    case 'H2O':
      return Math.pow(10, 5.1156 - 1687.5 / Math.max(60, T + 230.17));
    case 'ECH':
      return Math.pow(10, 4.329 - 1482.5 / Math.max(60, T + 222.4));
    case 'DCH':
      return Math.pow(10, 4.985 - 1865.0 / Math.max(60, T + 204.5));
    case 'MCH':
      return Math.pow(10, 5.125 - 2140.0 / Math.max(60, T + 196.0));
    case 'Glycerol':
      return Math.pow(10, 5.482 - 2690.0 / Math.max(60, T + 175.0));
    default:
      return 1e-9;
  }
}

/**
 * DIPPR Eq. 101 primary pure-component vapor pressure [barA] with C^1 Clausius-Clapeyron
 * tangent extrapolation outside [Tmin_K, Tmax_K], and Antoine fallback for chlorohydrins.
 */
export function pureDipprOrAntoineBarA(comp: SimCompKey, T_C: number): number {
  if (NON_VOLATILE_RIG_SET.has(comp)) return 1e-12;
  const c = PSAT_DIPPR101[comp];
  if (!c) return pureAntoineBarA(comp, T_C);

  const T_K = Math.max(25.0, Math.min(950.0, T_C + 273.15));
  if (T_K >= c.TminK && T_K <= c.TmaxK) {
    const lnP = c.A + c.B / T_K + c.C * Math.log(T_K) + c.D * Math.pow(T_K, c.E);
    return Math.max(1e-12, Math.min(2e4, Math.exp(lnP) * 1e-5));
  }
  const Tb = T_K < c.TminK ? c.TminK : c.TmaxK;
  const lnPb = c.A + c.B / Tb + c.C * Math.log(Tb) + c.D * Math.pow(Tb, c.E);
  const dLnP_dInvT = Math.min(-120.0, c.B - c.C * Tb - c.D * c.E * Math.pow(Tb, c.E + 1));
  const lnP = lnPb + dLnP_dInvT * (1.0 / T_K - 1.0 / Tb);
  return Math.max(1e-12, Math.min(2e4, Math.exp(Math.max(-35, Math.min(28, lnP))) * 1e-5));
}

export function calcPengRobinsonMixture(
  moleFrac: Record<SimCompKey, number>,
  T_C: number,
  P_kgcm2g: number,
  P_barA_override?: number,
  activeKeysHint?: readonly SimCompKey[],
  vapOnly?: boolean
): PrMixtureResult {
  const T_K = Math.max(60, Math.min(1200, T_C + 273.15));
  const P_bar =
    P_barA_override !== undefined
      ? Math.max(1e-5, P_barA_override)
      : Math.max(1e-4, (P_kgcm2g + 1.03323) * 0.980665);

  let nAct = 0;
  let ySum = 0;
  if (activeKeysHint) {
    for (let idx = 0; idx < activeKeysHint.length; idx++) {
      const k = activeKeysHint[idx];
      if (NON_VOLATILE_RIG_SET.has(k)) continue;
      const v = moleFrac[k] || 0;
      if (v > 1e-15) {
        _eosActKeys[nAct++] = k;
        ySum += v;
      }
    }
  } else {
    for (let idx = 0; idx < VOLATILE_KEYS.length; idx++) {
      const k = VOLATILE_KEYS[idx];
      const v = moleFrac[k] || 0;
      if (v > 1e-15) {
        _eosActKeys[nAct++] = k;
        ySum += v;
      }
    }
  }
  if (nAct === 0) {
    _eosActKeys[0] = 'H2O';
    nAct = 1;
    ySum = 1.0;
  }

  const sqrtTK = Math.sqrt(T_K);
  for (let i = 0; i < nAct; i++) {
    const k = _eosActKeys[i];
    _eosActIdx[i] = RIG_COMP_IDX[k];
    _eosYNorm[i] = ySum > 1e-14 ? Math.max(0, moleFrac[k] || 0) / ySum : 1.0 / nAct;
    const c = RIGOROUS_CRIT[k];
    const sqrtTr = sqrtTK / Math.sqrt(c.Tc_K);
    const kappa =
      c.omega > 0.491
        ? 0.379642 + 1.48503 * c.omega - 0.164423 * c.omega * c.omega + 0.016666 * c.omega * c.omega * c.omega
        : 0.37464 + 1.54226 * c.omega - 0.26992 * c.omega * c.omega;
    const rootTerm = Math.max(0.05, 1.0 + kappa * (1.0 - sqrtTr));
    const alpha = rootTerm * rootTerm;
    const aVal = (0.45723553 * R_GAS_BAR * R_GAS_BAR * c.Tc_K * c.Tc_K * alpha) / c.Pc_bar;
    _eosSqrtAi[i] = Math.sqrt(Math.max(0, aVal));
    _eosBi[i] = (0.07779607 * R_GAS_BAR * c.Tc_K) / c.Pc_bar;
  }

  let a_mix = 0;
  let b_mix = 0;
  for (let i = 0; i < nAct; i++) {
    const ii = _eosActIdx[i] * N_RIG;
    const yi = _eosYNorm[i];
    const sai = _eosSqrtAi[i];
    b_mix += yi * _eosBi[i];
    let rowSum = 0;
    for (let j = 0; j < nAct; j++) {
      const kij = PR_KIJ_MAT[ii + _eosActIdx[j]];
      const aij = sai * _eosSqrtAi[j] * (1.0 - kij);
      rowSum += _eosYNorm[j] * aij;
      a_mix += yi * _eosYNorm[j] * aij;
    }
    _eosSumAij[i] = rowSum;
  }
  b_mix = Math.max(1e-9, b_mix);

  const A = (a_mix * P_bar) / (R_GAS_BAR * R_GAS_BAR * T_K * T_K);
  const B = (b_mix * P_bar) / (R_GAS_BAR * T_K);

  const c2 = -(1.0 - B);
  const c1 = A - 3.0 * B * B - 2.0 * B;
  const c0 = -(A * B - B * B - B * B * B);

  solveCubicMinMaxAbove(c2, c1, c0, B + 1e-9, _cubicOutBuf);
  const Z_liq = _cubicOutBuf[0];
  const Z_vap = _cubicOutBuf[1];
  const rootCount = _cubicOutBuf[2];
  const sqrt2 = Math.SQRT2;

  const computePhi = (Z: number): Record<SimCompKey, number> => {
    const res: Record<SimCompKey, number> = { ...PHI_DEFAULT_TEMPLATE };
    const logTerm = Math.log(
      Math.max(1e-15, (Z + (1.0 + sqrt2) * B) / Math.max(1e-15, Z + (1.0 - sqrt2) * B))
    );
    const invAMix = 1.0 / Math.max(1e-15, a_mix);
    const factor = A / (2.0 * sqrt2 * Math.max(1e-15, B));
    const lnZMinusB = Math.log(Math.max(1e-15, Z - B));
    for (let i = 0; i < nAct; i++) {
      const Bi_ratio = _eosBi[i] / b_mix;
      const lnPhi =
        Bi_ratio * (Z - 1.0) -
        lnZMinusB -
        factor * (2.0 * _eosSumAij[i] * invAMix - Bi_ratio) * logTerm;
      res[_eosActKeys[i]] = Math.exp(Math.max(-40, Math.min(40, lnPhi)));
    }
    return res;
  };

  if (vapOnly) {
    const phi_vap = computePhi(Z_vap);
    return {
      Z_vap,
      Z_liq,
      Z_stable: Z_vap,
      rootCount,
      B,
      phi_vap,
      phi_liq: phi_vap,
      phi_stable: phi_vap,
    };
  }

  const phi_liq = computePhi(Z_liq);
  const phi_vap = rootCount > 1 ? computePhi(Z_vap) : phi_liq;

  let Z_stable = Z_vap;
  let phi_stable = phi_vap;
  if (rootCount > 1) {
    const zmbL = Math.max(1e-15, Z_liq - B);
    const logL = Math.log(Math.max(1e-15, (Z_liq + (1.0 + sqrt2) * B) / Math.max(1e-15, Z_liq + (1.0 - sqrt2) * B)));
    const gLiq = Z_liq - 1.0 - Math.log(zmbL) - (A / (2.0 * sqrt2 * Math.max(1e-15, B))) * logL;

    const zmbV = Math.max(1e-15, Z_vap - B);
    const logV = Math.log(Math.max(1e-15, (Z_vap + (1.0 + sqrt2) * B) / Math.max(1e-15, Z_vap + (1.0 - sqrt2) * B)));
    const gVap = Z_vap - 1.0 - Math.log(zmbV) - (A / (2.0 * sqrt2 * Math.max(1e-15, B))) * logV;
    if (gLiq <= gVap) {
      Z_stable = Z_liq;
      phi_stable = phi_liq;
    }
  }

  return {
    Z_vap,
    Z_liq,
    Z_stable,
    rootCount,
    B,
    phi_vap,
    phi_liq,
    phi_stable,
  };
}

/**
 * Soave-Redlich-Kwong (SRK) 다성분 3차 상태방정식 + Graboski-Daubert H₂ 양자보정 + 최소 깁스 자유에너지 근 선택
 */
export function calcSoaveRedlichKwongMixture(
  moleFrac: Record<SimCompKey, number>,
  T_C: number,
  P_kgcm2g: number,
  P_barA_override?: number,
  activeKeysHint?: readonly SimCompKey[],
  vapOnly?: boolean
): PrMixtureResult {
  const T_K = Math.max(60, Math.min(1200, T_C + 273.15));
  const P_bar =
    P_barA_override !== undefined
      ? Math.max(1e-5, P_barA_override)
      : Math.max(1e-4, (P_kgcm2g + 1.03323) * 0.980665);

  let nAct = 0;
  let ySum = 0;
  if (activeKeysHint) {
    for (let idx = 0; idx < activeKeysHint.length; idx++) {
      const k = activeKeysHint[idx];
      if (NON_VOLATILE_RIG_SET.has(k)) continue;
      const v = moleFrac[k] || 0;
      if (v > 1e-15) {
        _eosActKeys[nAct++] = k;
        ySum += v;
      }
    }
  } else {
    for (let idx = 0; idx < VOLATILE_KEYS.length; idx++) {
      const k = VOLATILE_KEYS[idx];
      const v = moleFrac[k] || 0;
      if (v > 1e-15) {
        _eosActKeys[nAct++] = k;
        ySum += v;
      }
    }
  }
  if (nAct === 0) {
    _eosActKeys[0] = 'H2O';
    nAct = 1;
    ySum = 1.0;
  }

  const sqrtTK = Math.sqrt(T_K);
  for (let i = 0; i < nAct; i++) {
    const k = _eosActKeys[i];
    _eosActIdx[i] = RIG_COMP_IDX[k];
    _eosYNorm[i] = ySum > 1e-14 ? Math.max(0, moleFrac[k] || 0) / ySum : 1.0 / nAct;
    const c = RIGOROUS_CRIT[k];
    const Tr = T_K / c.Tc_K;
    let alpha: number;
    if (k === 'H2') {
      alpha = 1.202 * Math.exp(-0.30228 * Tr);
    } else {
      const mSrk = 0.480 + 1.574 * c.omega - 0.176 * c.omega * c.omega;
      const rt = Math.max(0.05, 1.0 + mSrk * (1.0 - sqrtTK / Math.sqrt(c.Tc_K)));
      alpha = rt * rt;
    }
    const aVal = (0.42748023 * R_GAS_BAR * R_GAS_BAR * c.Tc_K * c.Tc_K * alpha) / c.Pc_bar;
    _eosSqrtAi[i] = Math.sqrt(Math.max(0, aVal));
    _eosBi[i] = (0.08664035 * R_GAS_BAR * c.Tc_K) / c.Pc_bar;
  }

  let a_mix = 0;
  let b_mix = 0;
  for (let i = 0; i < nAct; i++) {
    const ii = _eosActIdx[i] * N_RIG;
    const yi = _eosYNorm[i];
    const sai = _eosSqrtAi[i];
    b_mix += yi * _eosBi[i];
    let rowSum = 0;
    for (let j = 0; j < nAct; j++) {
      const kij = SRK_KIJ_MAT[ii + _eosActIdx[j]];
      const aij = sai * _eosSqrtAi[j] * (1.0 - kij);
      rowSum += _eosYNorm[j] * aij;
      a_mix += yi * _eosYNorm[j] * aij;
    }
    _eosSumAij[i] = rowSum;
  }
  b_mix = Math.max(1e-9, b_mix);

  const A = (a_mix * P_bar) / (R_GAS_BAR * R_GAS_BAR * T_K * T_K);
  const B = (b_mix * P_bar) / (R_GAS_BAR * T_K);

  const c2 = -1.0;
  const c1 = A - B - B * B;
  const c0 = -A * B;

  solveCubicMinMaxAbove(c2, c1, c0, B + 1e-9, _cubicOutBuf);
  const Z_liq = _cubicOutBuf[0];
  const Z_vap = _cubicOutBuf[1];
  const rootCount = _cubicOutBuf[2];

  const computePhi = (Z: number): Record<SimCompKey, number> => {
    const res: Record<SimCompKey, number> = { ...PHI_DEFAULT_TEMPLATE };
    const zSafe = Math.max(1e-15, Z);
    const logTerm = Math.log(Math.max(1e-15, 1.0 + B / zSafe));
    const invAMix = 1.0 / Math.max(1e-15, a_mix);
    const factor = A / Math.max(1e-15, B);
    const lnZMinusB = Math.log(Math.max(1e-15, Z - B));
    for (let i = 0; i < nAct; i++) {
      const Bi_ratio = _eosBi[i] / b_mix;
      const lnPhi =
        Bi_ratio * (Z - 1.0) -
        lnZMinusB -
        factor * (2.0 * _eosSumAij[i] * invAMix - Bi_ratio) * logTerm;
      res[_eosActKeys[i]] = Math.exp(Math.max(-40, Math.min(40, lnPhi)));
    }
    return res;
  };

  if (vapOnly) {
    const phi_vap = computePhi(Z_vap);
    return {
      Z_vap,
      Z_liq,
      Z_stable: Z_vap,
      rootCount,
      B,
      phi_vap,
      phi_liq: phi_vap,
      phi_stable: phi_vap,
    };
  }

  const phi_liq = computePhi(Z_liq);
  const phi_vap = rootCount > 1 ? computePhi(Z_vap) : phi_liq;

  let Z_stable = Z_vap;
  let phi_stable = phi_vap;
  if (rootCount > 1) {
    const gLiq = Z_liq - 1.0 - Math.log(Math.max(1e-15, Z_liq - B)) - (A / Math.max(1e-15, B)) * Math.log(Math.max(1e-15, 1.0 + B / Math.max(1e-15, Z_liq)));
    const gVap = Z_vap - 1.0 - Math.log(Math.max(1e-15, Z_vap - B)) - (A / Math.max(1e-15, B)) * Math.log(Math.max(1e-15, 1.0 + B / Math.max(1e-15, Z_vap)));
    if (gLiq <= gVap) {
      Z_stable = Z_liq;
      phi_stable = phi_liq;
    }
  }

  return {
    Z_vap,
    Z_liq,
    Z_stable,
    rootCount,
    B,
    phi_vap,
    phi_liq,
    phi_stable,
  };
}

/**
 * Zero-allocation dense mixture fugacity coefficient evaluator for PR / SRK.
 * Writes fugacity coefficients indexed by active component slot [0..nComps-1].
 */
export function calcCubicMixtureDenseInto(
  method: 'PR' | 'SRK',
  comps: readonly SimCompKey[],
  xArr: ArrayLike<number>,
  nComps: number,
  T_C: number,
  P_barA: number,
  phiVapOut: Float64Array,
  phiLiqOut?: Float64Array | null,
  vapOnly = false
): { Z_vap: number; Z_liq: number; rootCount: number; B: number } {
  const T_K = Math.max(60, Math.min(1200, T_C + 273.15));
  const P_bar = Math.max(1e-5, P_barA);
  const isSRK = method === 'SRK';
  const kijMat = isSRK ? SRK_KIJ_MAT : PR_KIJ_MAT;

  let nAct = 0;
  let ySum = 0;
  for (let slot = 0; slot < nComps; slot++) {
    const k = comps[slot];
    const isNv = NON_VOLATILE_RIG_SET.has(k);
    phiVapOut[slot] = isNv ? 1e-12 : 1.0;
    if (phiLiqOut) phiLiqOut[slot] = isNv ? 1e-12 : 1.0;
    if (isNv) continue;
    const v = xArr[slot] || 0;
    if (v > 1e-15) {
      _eosActKeys[nAct] = k;
      _eosActSlot[nAct] = slot;
      nAct++;
      ySum += v;
    }
  }
  let hasDummyFallback = false;
  if (nAct === 0) {
    _eosActKeys[0] = 'H2O';
    _eosActSlot[0] = -1;
    nAct = 1;
    ySum = 1.0;
    hasDummyFallback = true;
  }

  const sqrtTK = Math.sqrt(T_K);
  for (let i = 0; i < nAct; i++) {
    const k = _eosActKeys[i];
    const slot = _eosActSlot[i];
    _eosActIdx[i] = RIG_COMP_IDX[k];
    _eosYNorm[i] = hasDummyFallback ? 1.0 : ySum > 1e-14 ? Math.max(0, xArr[slot] || 0) / ySum : 1.0 / nAct;
    const c = RIGOROUS_CRIT[k];
    if (isSRK) {
      let alpha: number;
      if (k === 'H2') {
        alpha = 1.202 * Math.exp(-0.30228 * (T_K / c.Tc_K));
      } else {
        const mSrk = 0.480 + 1.574 * c.omega - 0.176 * c.omega * c.omega;
        const rt = Math.max(0.05, 1.0 + mSrk * (1.0 - sqrtTK / Math.sqrt(c.Tc_K)));
        alpha = rt * rt;
      }
      const aVal = (0.42748023 * R_GAS_BAR * R_GAS_BAR * c.Tc_K * c.Tc_K * alpha) / c.Pc_bar;
      _eosSqrtAi[i] = Math.sqrt(Math.max(0, aVal));
      _eosBi[i] = (0.08664035 * R_GAS_BAR * c.Tc_K) / c.Pc_bar;
    } else {
      const sqrtTr = sqrtTK / Math.sqrt(c.Tc_K);
      const kappa =
        c.omega > 0.491
          ? 0.379642 + 1.48503 * c.omega - 0.164423 * c.omega * c.omega + 0.016666 * c.omega * c.omega * c.omega
          : 0.37464 + 1.54226 * c.omega - 0.26992 * c.omega * c.omega;
      const rootTerm = Math.max(0.05, 1.0 + kappa * (1.0 - sqrtTr));
      const aVal = (0.45723553 * R_GAS_BAR * R_GAS_BAR * c.Tc_K * c.Tc_K * rootTerm * rootTerm) / c.Pc_bar;
      _eosSqrtAi[i] = Math.sqrt(Math.max(0, aVal));
      _eosBi[i] = (0.07779607 * R_GAS_BAR * c.Tc_K) / c.Pc_bar;
    }
  }

  let a_mix = 0;
  let b_mix = 0;
  for (let i = 0; i < nAct; i++) {
    const ii = _eosActIdx[i] * N_RIG;
    const yi = _eosYNorm[i];
    const sai = _eosSqrtAi[i];
    b_mix += yi * _eosBi[i];
    let rowSum = 0;
    for (let j = 0; j < nAct; j++) {
      const aij = sai * _eosSqrtAi[j] * (1.0 - kijMat[ii + _eosActIdx[j]]);
      rowSum += _eosYNorm[j] * aij;
      a_mix += yi * _eosYNorm[j] * aij;
    }
    _eosSumAij[i] = rowSum;
  }
  b_mix = Math.max(1e-9, b_mix);

  const A = (a_mix * P_bar) / (R_GAS_BAR * R_GAS_BAR * T_K * T_K);
  const B = (b_mix * P_bar) / (R_GAS_BAR * T_K);

  const c2 = isSRK ? -1.0 : -(1.0 - B);
  const c1 = isSRK ? A - B - B * B : A - 3.0 * B * B - 2.0 * B;
  const c0 = isSRK ? -A * B : -(A * B - B * B - B * B * B);

  solveCubicMinMaxAbove(c2, c1, c0, B + 1e-9, _cubicOutBuf);
  const Z_liq = _cubicOutBuf[0];
  const Z_vap = _cubicOutBuf[1];
  const rootCount = _cubicOutBuf[2];

  const writePhi = (Z: number, outArr: Float64Array) => {
    const logTerm = isSRK
      ? Math.log(Math.max(1e-15, 1.0 + B / Math.max(1e-15, Z)))
      : Math.log(
          Math.max(1e-15, (Z + (1.0 + Math.SQRT2) * B) / Math.max(1e-15, Z + (1.0 - Math.SQRT2) * B))
        );
    const invAMix = 1.0 / Math.max(1e-15, a_mix);
    const factor = isSRK ? A / Math.max(1e-15, B) : A / (2.0 * Math.SQRT2 * Math.max(1e-15, B));
    const lnZMinusB = Math.log(Math.max(1e-15, Z - B));
    for (let i = 0; i < nAct; i++) {
      const slot = _eosActSlot[i];
      if (slot < 0) continue;
      const Bi_ratio = _eosBi[i] / b_mix;
      const lnPhi =
        Bi_ratio * (Z - 1.0) -
        lnZMinusB -
        factor * (2.0 * _eosSumAij[i] * invAMix - Bi_ratio) * logTerm;
      outArr[slot] = Math.exp(Math.max(-40, Math.min(40, lnPhi)));
    }
  };

  if (vapOnly) {
    writePhi(Z_vap, phiVapOut);
  } else {
    if (phiLiqOut) writePhi(Z_liq, phiLiqOut);
    if (rootCount > 1) {
      writePhi(Z_vap, phiVapOut);
    } else if (phiLiqOut) {
      for (let slot = 0; slot < nComps; slot++) phiVapOut[slot] = phiLiqOut[slot];
    } else {
      writePhi(Z_liq, phiVapOut);
    }
  }

  return { Z_vap, Z_liq, rootCount, B };
}

function evalCubicEosBar(
  method: 'PR' | 'SRK',
  moleFrac: Record<SimCompKey, number>,
  T_C: number,
  P_bar: number
): PrMixtureResult {
  return method === 'SRK'
    ? calcSoaveRedlichKwongMixture(moleFrac, T_C, 0, P_bar)
    : calcPengRobinsonMixture(moleFrac, T_C, 0, P_bar);
}

function solveRachfordRiceBeta(
  keys: readonly SimCompKey[],
  z: Record<SimCompKey, number>,
  K: Record<SimCompKey, number>
): number {
  let f0 = 0;
  let f1 = 0;
  for (let idx = 0; idx < keys.length; idx++) {
    const k = keys[idx];
    const zk = z[k] || 0;
    if (zk <= 0) continue;
    const kk = Math.max(1e-12, K[k] || 1e-12);
    f0 += zk * (kk - 1.0);
    f1 += zk * (1.0 - 1.0 / kk);
  }
  if (f0 <= 0) return 0.0;
  if (f1 >= 0) return 1.0;

  let lo = 0.0;
  let hi = 1.0;
  let beta = 0.5;
  for (let it = 0; it < 50; it++) {
    let f = 0;
    let df = 0;
    for (let idx = 0; idx < keys.length; idx++) {
      const k = keys[idx];
      const zk = z[k] || 0;
      if (zk <= 0) continue;
      const km1 = (K[k] || 0) - 1.0;
      const denom = 1.0 + beta * km1;
      f += (zk * km1) / denom;
      df -= (zk * km1 * km1) / (denom * denom);
    }
    if (Math.abs(f) < 1e-12 || hi - lo < 1e-13) break;
    if (f > 0) lo = beta;
    else hi = beta;
    const newton = beta - f / Math.min(-1e-15, df);
    beta = newton > lo && newton < hi ? newton : 0.5 * (lo + hi);
  }
  return beta;
}

// ── Electrolyte Osmotic Water Activity, Sechenov Salting-Out & HCl-H2O Dissociation VLE ──
export interface ElectrolyteMolalities {
  mNaOH: number;
  mNaCl: number;
  mH2SO4: number;
  mNaOCl: number;
  mNaClO3: number;
  mFeCl2: number;
  mFeCl3: number;
  mPAC: number;
  totalMolality: number;
}

export function computeElectrolyteMolalitiesFromWaterKg(
  liqFlowsOrMoles: Partial<Record<SimCompKey, number>>,
  waterKg: number,
  inputIsMoles: boolean
): ElectrolyteMolalities {
  if (waterKg <= 1e-12) {
    const hasSalt =
      (liqFlowsOrMoles.NaOH || 0) +
        (liqFlowsOrMoles.NaCl || 0) +
        (liqFlowsOrMoles.H2SO4 || 0) +
        (liqFlowsOrMoles.NaOCl || 0) +
        (liqFlowsOrMoles.NaClO3 || 0) +
        (liqFlowsOrMoles.FeCl2 || 0) +
        (liqFlowsOrMoles.FeCl3 || 0) +
        (liqFlowsOrMoles.PAC || 0) >
      1e-12;
    if (!hasSalt) {
      return { mNaOH: 0, mNaCl: 0, mH2SO4: 0, mNaOCl: 0, mNaClO3: 0, mFeCl2: 0, mFeCl3: 0, mPAC: 0, totalMolality: 0 };
    }
  }
  const wSafe = Math.max(1e-9, waterKg);
  const toMol = (k: SimCompKey): number => {
    const v = Math.max(0, liqFlowsOrMoles[k] || 0);
    return inputIsMoles ? v : v / RIGOROUS_CRIT[k].mw;
  };
  const mNaOH = Math.min(80.0, toMol('NaOH') / wSafe);
  const mNaCl = Math.min(40.0, toMol('NaCl') / wSafe);
  const mH2SO4 = Math.min(120.0, toMol('H2SO4') / wSafe);
  const mNaOCl = Math.min(40.0, toMol('NaOCl') / wSafe);
  const mNaClO3 = Math.min(40.0, toMol('NaClO3') / wSafe);
  const mFeCl2 = Math.min(30.0, toMol('FeCl2') / wSafe);
  const mFeCl3 = Math.min(30.0, toMol('FeCl3') / wSafe);
  const mPAC = Math.min(20.0, toMol('PAC') / wSafe);
  const totalMolality = mNaOH + mNaCl + mH2SO4 + mNaOCl + mNaClO3 + mFeCl2 + mFeCl3 + mPAC;
  return { mNaOH, mNaCl, mH2SO4, mNaOCl, mNaClO3, mFeCl2, mFeCl3, mPAC, totalMolality };
}

/**
 * Calibrated Pitzer / Pabalan-Pitzer / Clarke-Glew osmotic water activity a_w(T, m_i).
 * Reproduces Perry's & OxyChem boiling points at 1 atm:
 *   - NaOH: 10% -> 102.9°C, 20% -> 107.8°C, 30% -> 115.7°C, 40% -> 128.0°C, 50% -> 143.2°C
 *   - NaCl: 10% -> 101.9°C, 20% -> 105.2°C, 26% -> 108.7°C
 *   - H2SO4: 50% -> ~123°C, 75% -> ~185°C, 95-98% drying acid -> a_w ~ 1e-4
 */
export function calcElectrolyteWaterActivity(mol: ElectrolyteMolalities, T_C: number): number {
  if (mol.totalMolality <= 1e-9) return 1.0;
  const Mw = 0.01801528;
  const TC = Math.max(-20, Math.min(260, T_C));
  const I =
    mol.mNaOH +
    mol.mNaCl +
    3.0 * mol.mH2SO4 +
    mol.mNaOCl +
    mol.mNaClO3 +
    3.0 * mol.mFeCl2 +
    6.0 * mol.mFeCl3 +
    3.0 * mol.mPAC;
  const sI = Math.sqrt(Math.max(1e-12, I));
  const Aphi = 0.3915 + 0.000685 * (TC - 25.0) + 3.1e-6 * (TC - 25.0) * (TC - 25.0);
  const fPhi = (-Aphi * sI) / (1.0 + 1.2 * sI);

  let lnAw = 0;
  if (mol.mNaOH > 0) {
    const mE = mol.mNaOH / (1.0 + 0.070 * mol.mNaOH);
    const b0 = 0.128 - 0.00024 * (TC - 25.0);
    const b1 = 0.253;
    const cPhi = 0.00045;
    const phi = 1.0 + fPhi + mE * (b0 + b1 * Math.exp(-2.0 * sI)) + cPhi * mE * mE;
    lnAw -= 2.0 * mol.mNaOH * Mw * phi;
  }
  if (mol.mNaCl > 0) {
    const b0 = 0.0765 + 0.00025 * (TC - 25.0);
    const b1 = 0.2664;
    const cPhi = 0.00127;
    const phi = 1.0 + fPhi + mol.mNaCl * (b0 + b1 * Math.exp(-2.0 * sI)) + cPhi * mol.mNaCl * mol.mNaCl;
    lnAw -= 2.0 * mol.mNaCl * Mw * phi;
  }
  if (mol.mH2SO4 > 0) {
    const mE = mol.mH2SO4 / (1.0 + 0.032 * mol.mH2SO4);
    const b0 = 0.145 - 0.0002 * (TC - 25.0);
    const b1 = 0.38;
    const cPhi = 0.0018;
    const phi = 1.0 + fPhi + mE * (b0 + b1 * Math.exp(-2.0 * sI)) + cPhi * mE * mE;
    lnAw -= 2.35 * mol.mH2SO4 * Mw * phi;
    if (mol.mH2SO4 > 14.0) {
      const wAcid = (mol.mH2SO4 * 0.098079) / (1.0 + mol.mH2SO4 * 0.098079);
      if (wAcid > 0.60) {
        lnAw -= 18.5 * Math.pow((wAcid - 0.60) / 0.40, 2.2);
      }
    }
  }
  const mOther11 = mol.mNaOCl + mol.mNaClO3;
  if (mOther11 > 0) {
    const phi = 1.0 + fPhi + mOther11 * (0.068 + 0.24 * Math.exp(-2.0 * sI));
    lnAw -= 2.0 * mOther11 * Mw * phi;
  }
  if (mol.mFeCl2 > 0) {
    const mE = mol.mFeCl2 / (1.0 + 0.04 * mol.mFeCl2);
    const phi = 1.0 + fPhi + mE * (0.31 + 1.45 * Math.exp(-2.0 * sI));
    lnAw -= 3.0 * mol.mFeCl2 * Mw * phi;
  }
  if (mol.mFeCl3 + mol.mPAC > 0) {
    const m3 = mol.mFeCl3 + mol.mPAC;
    const mE = m3 / (1.0 + 0.05 * m3);
    const phi = 1.0 + fPhi + mE * (0.45 + 2.2 * Math.exp(-2.0 * sI));
    lnAw -= 4.0 * m3 * Mw * phi;
  }

  return Math.exp(Math.max(-18.0, Math.min(0.0, lnAw)));
}

export function calcSechenovSaltingOutMultiplier(
  comp: SimCompKey,
  mol: ElectrolyteMolalities,
  T_K: number
): number {
  if (mol.totalMolality <= 1e-6 || comp === 'H2O' || comp === 'HCl') return 1.0;
  const se = SECHENOV_DATABANK[comp];
  const dT = T_K - 298.15;
  let log10Gamma = 0;
  if (se) {
    const ksNaCl = Math.max(0.02, (se.ks_NaCl_298 ?? 0.135) + se.dKs_dT * dT);
    const ksNaOH = Math.max(0.02, (se.ks_NaOH_298 ?? ksNaCl * 1.25) + se.dKs_dT * dT);
    const mChlorideEq =
      mol.mNaCl + mol.mNaOCl + mol.mNaClO3 + 1.5 * mol.mH2SO4 + 2.0 * mol.mFeCl2 + 3.0 * mol.mFeCl3 + 2.0 * mol.mPAC;
    log10Gamma = ksNaCl * Math.min(10.0, mChlorideEq) + ksNaOH * Math.min(12.0, mol.mNaOH);
  } else {
    const ksDefault = comp === 'Cl2' ? 0.138 : comp === 'CO' ? 0.135 : 0.145;
    log10Gamma = ksDefault * Math.min(12.0, mol.totalMolality);
  }
  return Math.pow(10, Math.min(4.0, Math.max(0, log10Gamma)));
}

/**
 * Gibbs-Duhem-consistent Pitzer chemical dissociation VLE for HCl(g) <-> H+(aq) + Cl-(aq).
 * Reproduces the 1 atm maximum-boiling azeotrope at 20.22 wt% HCl (x = 0.11134), T = 108.6 °C,
 * concentrated 30-37 wt% HCl stripping, pressure-swing azeotrope shift, and anhydrous HCl limit.
 */
export function calcHclWaterEquilibriumBar(
  wHClAq: number,
  T_C: number,
  extraChlorideMolality = 0
): { pHCl_bar: number; pH2O_bar: number; aw_hcl: number } {
  const TC = Math.max(-60, Math.min(240, T_C));
  const T_K = TC + 273.15;
  const psatW = pureDipprOrAntoineBarA('H2O', TC);
  const psatHCl = pureDipprOrAntoineBarA('HCl', TC);

  if (wHClAq <= 1e-12) {
    return { pHCl_bar: 0, pH2O_bar: psatW, aw_hcl: 1.0 };
  }
  if (wHClAq >= 0.999) {
    return { pHCl_bar: psatHCl, pH2O_bar: 0, aw_hcl: 0 };
  }

  const Mw = 0.01801528;
  const Mh = 0.036461;
  const mHCl = (wHClAq / Mh) / Math.max(1e-6, 1.0 - wHClAq);
  const mClTotal = mHCl + Math.max(0, extraChlorideMolality);
  const I = Math.max(1e-12, 0.5 * (mHCl + mClTotal));
  const sI = Math.sqrt(I);

  const Aphi = 0.3915 + 0.000685 * (TC - 25.0) + 3.1e-6 * (TC - 25.0) * (TC - 25.0);
  const b0 = 0.1635 - 0.00038 * (TC - 25.0);
  const b1 = 0.2945;
  const cPhi = 0.00032 - 0.000015 * (TC - 25.0);

  const fPhi = (-Aphi * sI) / (1.0 + 1.2 * sI);
  const fGam = -Aphi * (sI / (1.0 + 1.2 * sI) + (2.0 / 1.2) * Math.log(1.0 + 1.2 * sI));
  const xPitz = 2.0 * sI;
  const gPitz = xPitz > 1e-5 ? (2.0 * (1.0 - (1.0 + xPitz) * Math.exp(-xPitz))) / (xPitz * xPitz) : 1.0;

  const Bphi = b0 + b1 * Math.exp(-xPitz);
  const Bgam = 2.0 * b0 + b1 * gPitz;

  const phiOsm = 1.0 + fPhi + I * Bphi + I * I * cPhi;
  const lnGamPm = Math.min(14.0, fGam + I * Bgam + 1.5 * I * I * cPhi);

  const lnKdiss = -16.20 + 8875.0 / T_K;
  let pHCl_bar = Math.exp(
    Math.min(18.0, Math.log(Math.max(1e-20, mHCl * mClTotal)) + 2.0 * lnGamPm - lnKdiss)
  );

  const aw_hcl = Math.exp(Math.max(-18.0, Math.min(0.0, -2.0 * mHCl * Mw * phiOsm)));
  let pH2O_bar = aw_hcl * psatW;

  if (wHClAq > 0.44) {
    const s = Math.min(1.0, (wHClAq - 0.44) / 0.48);
    const xHCl = (wHClAq / Mh) / (wHClAq / Mh + (1.0 - wHClAq) / Mw);
    const pRaoultHCl = Math.max(1e-6, xHCl * psatHCl);
    pHCl_bar = Math.exp((1.0 - s) * Math.log(Math.max(1e-12, pHCl_bar)) + s * Math.log(pRaoultHCl));
    pH2O_bar = (1.0 - s) * pH2O_bar + s * (1.0 - xHCl) * psatW * 0.15;
  }

  return { pHCl_bar, pH2O_bar, aw_hcl };
}

// ── Pure φ-φ EOS Flash with Michelsen Tangent-Plane Stability + GDEM Acceleration ──
function solvePureEosFlash(
  activeComps: SimCompKey[],
  z: Record<SimCompKey, number>,
  nMol: Record<SimCompKey, number>,
  T_C: number,
  P_bar: number,
  method: 'PR' | 'SRK'
): {
  vap: Record<SimCompKey, number>;
  liq: Record<SimCompKey, number>;
  betaVapMole: number;
  Z_vap: number;
  converged: boolean;
  iterations: number;
} {
  const vap = zeroRigRecord(0);
  const liq = zeroRigRecord(0);
  const T_K = Math.max(60, T_C + 273.15);
  const zCritOverBCrit = method === 'SRK' ? 3.84732 : 3.95136;

  const classifySinglePhaseBeta = (eosFeed: PrMixtureResult): number => {
    if (eosFeed.rootCount >= 2) {
      return Math.abs(eosFeed.Z_stable - eosFeed.Z_liq) <= Math.abs(eosFeed.Z_stable - eosFeed.Z_vap) ? 0.0 : 1.0;
    }
    let tpc = 0;
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      tpc += z[k] * RIGOROUS_CRIT[k].Tc_K;
    }
    if (T_K > tpc * 1.05) return 1.0;
    const zOverB = eosFeed.Z_stable / Math.max(1e-12, eosFeed.B);
    return zOverB < zCritOverBCrit ? 0.0 : 1.0;
  };

  const eosZ = evalCubicEosBar(method, z, T_C, P_bar);

  if (activeComps.length === 1) {
    const c0 = activeComps[0];
    let beta1 = classifySinglePhaseBeta(eosZ);
    if (eosZ.rootCount === 1 && T_K < RIGOROUS_CRIT[c0].Tc_K) {
      beta1 = P_bar < pureDipprOrAntoineBarA(c0, T_C) ? 1.0 : 0.0;
    }
    if (beta1 >= 0.5) {
      vap[c0] = nMol[c0] * RIGOROUS_CRIT[c0].mw;
    } else {
      liq[c0] = nMol[c0] * RIGOROUS_CRIT[c0].mw;
    }
    return { vap, liq, betaVapMole: beta1, Z_vap: eosZ.Z_vap, converged: true, iterations: 1 };
  }

  const kWilson = zeroRigRecord(1.0);
  let lightKey = activeComps[0];
  let heavyKey = activeComps[0];
  for (let i = 0; i < activeComps.length; i++) {
    const k = activeComps[i];
    const c = RIGOROUS_CRIT[k];
    const kw = (c.Pc_bar / P_bar) * Math.exp(5.373 * (1.0 + c.omega) * (1.0 - c.Tc_K / T_K));
    kWilson[k] = Math.max(1e-10, Math.min(1e8, kw));
    if (kWilson[k] > kWilson[lightKey]) lightKey = k;
    if (kWilson[k] < kWilson[heavyKey]) heavyKey = k;
  }

  const dRef = zeroRigRecord(-50);
  for (let i = 0; i < activeComps.length; i++) {
    const k = activeComps[i];
    dRef[k] = Math.log(Math.max(1e-30, z[k])) + Math.log(Math.max(1e-30, eosZ.phi_stable[k]));
  }

  const runTpdSearch = (
    wInit: Record<SimCompKey, number>,
    branch: 'vap' | 'liq'
  ): { tpd: number; w: Record<SimCompKey, number>; trivial: boolean } => {
    const w = zeroRigRecord(0);
    let wSum = 0;
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      w[k] = Math.max(1e-15, wInit[k]);
      wSum += w[k];
    }
    for (let i = 0; i < activeComps.length; i++) w[activeComps[i]] /= wSum;

    const prevDelta = new Float64Array(activeComps.length);
    const currDelta = new Float64Array(activeComps.length);

    for (let it = 0; it < 40; it++) {
      const eosW = evalCubicEosBar(method, w, T_C, P_bar);
      const phiW = branch === 'vap' ? eosW.phi_vap : eosW.phi_liq;

      let S = 0;
      const Wraw = new Float64Array(activeComps.length);
      for (let i = 0; i < activeComps.length; i++) {
        const k = activeComps[i];
        Wraw[i] = Math.exp(Math.max(-60, Math.min(60, dRef[k] - Math.log(Math.max(1e-30, phiW[k])))));
        S += Wraw[i];
      }
      if (S <= 1e-30) return { tpd: 0, w, trivial: true };

      let maxStep = 0;
      for (let i = 0; i < activeComps.length; i++) {
        const k = activeComps[i];
        const wNext = Wraw[i] / S;
        const lnOld = Math.log(Math.max(1e-30, w[k]));
        const lnNew = Math.log(Math.max(1e-30, wNext));
        currDelta[i] = lnNew - lnOld;
        maxStep = Math.max(maxStep, Math.abs(wNext - w[k]));
        w[k] = wNext;
      }

      if (maxStep < 1e-10 && it >= 2) break;

      if (it >= 3 && it % 4 === 3) {
        let num = 0;
        let den = 0;
        for (let i = 0; i < activeComps.length; i++) {
          num += currDelta[i] * prevDelta[i];
          den += prevDelta[i] * prevDelta[i];
        }
        if (den > 1e-20) {
          const lambda = num / den;
          if (lambda > 0.05 && lambda < 0.985) {
            const promo = Math.min(6.0, 1.0 / (1.0 - lambda) - 1.0);
            let sAcc = 0;
            for (let i = 0; i < activeComps.length; i++) {
              const k = activeComps[i];
              w[k] = Math.exp(Math.max(-50, Math.min(5, Math.log(Math.max(1e-30, w[k])) + promo * currDelta[i])));
              sAcc += w[k];
            }
            for (let i = 0; i < activeComps.length; i++) w[activeComps[i]] /= sAcc;
          }
        }
      }
      for (let i = 0; i < activeComps.length; i++) prevDelta[i] = currDelta[i];
    }

    const eosFinal = evalCubicEosBar(method, w, T_C, P_bar);
    let tpdExact = 0;
    let maxDiffZ = 0;
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      maxDiffZ = Math.max(maxDiffZ, Math.abs(w[k] - z[k]));
      if (w[k] > 1e-30) {
        tpdExact +=
          w[k] *
          (Math.log(w[k]) + Math.log(Math.max(1e-30, eosFinal.phi_stable[k])) - dRef[k]);
      }
    }
    return {
      tpd: tpdExact,
      w,
      trivial:
        maxDiffZ < 1e-5 &&
        eosFinal.rootCount === eosZ.rootCount &&
        Math.abs(eosFinal.Z_stable - eosZ.Z_stable) < 1e-4,
    };
  };

  const trialVapWilson = zeroRigRecord(0);
  const trialLiqWilson = zeroRigRecord(0);
  const trialLight = zeroRigRecord(0);
  const trialHeavy = zeroRigRecord(0);
  for (let i = 0; i < activeComps.length; i++) {
    const k = activeComps[i];
    trialVapWilson[k] = z[k] * kWilson[k];
    trialLiqWilson[k] = z[k] / kWilson[k];
    trialLight[k] = k === lightKey ? 0.92 : (0.08 * z[k]) / Math.max(1e-12, 1.0 - z[lightKey] + 1e-6);
    trialHeavy[k] = k === heavyKey ? 0.92 : (0.08 * z[k]) / Math.max(1e-12, 1.0 - z[heavyKey] + 1e-6);
  }

  const tpdV1 = runTpdSearch(trialVapWilson, 'vap');
  const tpdL1 = runTpdSearch(trialLiqWilson, 'liq');
  let bestVapTpd = tpdV1;
  let bestLiqTpd = tpdL1;

  if (Math.min(tpdV1.tpd, tpdL1.tpd) >= -1e-9) {
    const tpdV2 = runTpdSearch(trialLight, 'vap');
    const tpdL2 = runTpdSearch(trialHeavy, 'liq');
    if (tpdV2.tpd < bestVapTpd.tpd) bestVapTpd = tpdV2;
    if (tpdL2.tpd < bestLiqTpd.tpd) bestLiqTpd = tpdL2;
  }

  const minTpd = Math.min(bestVapTpd.tpd, bestLiqTpd.tpd);
  const feedHasTwoEqualRoots = eosZ.rootCount >= 2 && Math.abs(eosZ.Z_vap - eosZ.Z_liq) > 1e-4;

  if (minTpd >= -1e-9) {
    let unstableFrom3Roots = false;
    if (feedHasTwoEqualRoots) {
      for (let i = 0; i < activeComps.length; i++) {
        const k = activeComps[i];
        if (Math.abs(Math.log(eosZ.phi_liq[k] / eosZ.phi_vap[k])) > 1e-4) {
          const kTest = zeroRigRecord(1);
          for (const c of activeComps) kTest[c] = eosZ.phi_liq[c] / Math.max(1e-20, eosZ.phi_vap[c]);
          const bTest = solveRachfordRiceBeta(activeComps, z, kTest);
          if (bTest > 1e-6 && bTest < 1.0 - 1e-6) unstableFrom3Roots = true;
          break;
        }
      }
    }
    if (!unstableFrom3Roots) {
      const betaSingle = classifySinglePhaseBeta(eosZ);
      for (let i = 0; i < activeComps.length; i++) {
        const k = activeComps[i];
        const mKg = nMol[k] * RIGOROUS_CRIT[k].mw;
        if (betaSingle >= 0.5) vap[k] = mKg;
        else liq[k] = mKg;
      }
      return {
        vap,
        liq,
        betaVapMole: betaSingle,
        Z_vap: betaSingle >= 0.5 ? eosZ.Z_stable : eosZ.Z_vap,
        converged: true,
        iterations: 4,
      };
    }
  }

  const K = zeroRigRecord(1.0);
  if (bestVapTpd.tpd < -1e-9 && bestLiqTpd.tpd < -1e-9 && !bestVapTpd.trivial && !bestLiqTpd.trivial) {
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      K[k] = Math.max(1e-10, Math.min(1e8, bestVapTpd.w[k] / Math.max(1e-20, bestLiqTpd.w[k])));
    }
  } else if (bestVapTpd.tpd <= bestLiqTpd.tpd && bestVapTpd.tpd < -1e-9) {
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      K[k] = Math.max(1e-10, Math.min(1e8, bestVapTpd.w[k] / Math.max(1e-20, z[k])));
    }
  } else if (bestLiqTpd.tpd < -1e-9) {
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      K[k] = Math.max(1e-10, Math.min(1e8, z[k] / Math.max(1e-20, bestLiqTpd.w[k])));
    }
  } else {
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      K[k] = feedHasTwoEqualRoots
        ? Math.max(1e-10, Math.min(1e8, eosZ.phi_liq[k] / Math.max(1e-20, eosZ.phi_vap[k])))
        : kWilson[k];
    }
  }

  const xMol = zeroRigRecord(0);
  const yMol = zeroRigRecord(0);
  const prevDeltaLnK = new Float64Array(activeComps.length);
  const currDeltaLnK = new Float64Array(activeComps.length);

  let beta = 0.5;
  let lastZvap = eosZ.Z_vap;
  let converged = false;
  let iterUsed = 0;

  for (let it = 0; it < 100; it++) {
    iterUsed = it + 1;
    beta = solveRachfordRiceBeta(activeComps, z, K);

    let xSum = 0;
    let ySum = 0;
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      const xi = z[k] / Math.max(1e-15, 1.0 + beta * (K[k] - 1.0));
      const yi = K[k] * xi;
      xMol[k] = xi;
      yMol[k] = yi;
      xSum += xi;
      ySum += yi;
    }
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      xMol[k] = xSum > 1e-15 ? xMol[k] / xSum : z[k];
      yMol[k] = ySum > 1e-15 ? yMol[k] / ySum : z[k];
    }

    const eosLiq = evalCubicEosBar(method, xMol, T_C, P_bar);
    const eosVap = evalCubicEosBar(method, yMol, T_C, P_bar);
    lastZvap = eosVap.Z_vap;

    let maxFugResid = 0;
    let maxLnKAbs = 0;
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      const lnKNew = Math.log(Math.max(1e-30, eosLiq.phi_liq[k])) - Math.log(Math.max(1e-30, eosVap.phi_vap[k]));
      const lnKOld = Math.log(Math.max(1e-30, K[k]));
      const resid = lnKNew - lnKOld;
      currDeltaLnK[i] = resid;
      if (z[k] > 1e-12 && Math.abs(resid) > maxFugResid) maxFugResid = Math.abs(resid);
      if (Math.abs(lnKNew) > maxLnKAbs) maxLnKAbs = Math.abs(lnKNew);
      K[k] = Math.exp(Math.max(-30, Math.min(30, lnKNew)));
    }

    if (maxFugResid < 1e-8 && it >= 1) {
      converged = true;
      beta = solveRachfordRiceBeta(activeComps, z, K);
      break;
    }

    if (maxLnKAbs < 1e-6 && it >= 5) {
      const betaSingle = classifySinglePhaseBeta(eosZ);
      for (let i = 0; i < activeComps.length; i++) {
        const k = activeComps[i];
        const mKg = nMol[k] * RIGOROUS_CRIT[k].mw;
        if (betaSingle >= 0.5) vap[k] = mKg;
        else liq[k] = mKg;
      }
      return { vap, liq, betaVapMole: betaSingle, Z_vap: eosZ.Z_vap, converged: true, iterations: iterUsed };
    }

    if (it >= 3 && it % 4 === 3) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < activeComps.length; i++) {
        num += currDeltaLnK[i] * prevDeltaLnK[i];
        den += prevDeltaLnK[i] * prevDeltaLnK[i];
      }
      if (den > 1e-22) {
        const lambda = num / den;
        if (lambda > 0.08 && lambda < 0.985) {
          const promo = Math.min(6.0, 1.0 / (1.0 - lambda) - 1.0);
          for (let i = 0; i < activeComps.length; i++) {
            const k = activeComps[i];
            const lnKAcc = Math.log(Math.max(1e-30, K[k])) + promo * currDeltaLnK[i];
            K[k] = Math.exp(Math.max(-30, Math.min(30, lnKAcc)));
          }
        }
      }
    }
    for (let i = 0; i < activeComps.length; i++) prevDeltaLnK[i] = currDeltaLnK[i];
  }

  if (beta <= 1e-9 || beta >= 1.0 - 1e-9) {
    const betaSingle = beta >= 0.5 ? 1.0 : 0.0;
    for (let i = 0; i < activeComps.length; i++) {
      const k = activeComps[i];
      const mKg = nMol[k] * RIGOROUS_CRIT[k].mw;
      if (betaSingle >= 0.5) vap[k] = mKg;
      else liq[k] = mKg;
    }
    return { vap, liq, betaVapMole: betaSingle, Z_vap: lastZvap, converged: true, iterations: iterUsed };
  }

  for (let i = 0; i < activeComps.length; i++) {
    const k = activeComps[i];
    const denom = Math.max(1e-15, 1.0 + beta * (K[k] - 1.0));
    const lMol = (nMol[k] * (1.0 - beta)) / denom;
    const vMol = Math.max(0, nMol[k] - lMol);
    liq[k] = lMol * RIGOROUS_CRIT[k].mw;
    vap[k] = vMol * RIGOROUS_CRIT[k].mw;
  }

  return { vap, liq, betaVapMole: beta, Z_vap: lastZvap, converged, iterations: iterUsed };
}

export function pureSatFugacityCoeffPR(comp: SimCompKey, T_C: number, pSatBar: number): number {
  const c = RIGOROUS_CRIT[comp];
  if (!c || pSatBar <= 1e-5) return 1.0;
  const P_bar = Math.max(1e-5, Math.min(pSatBar, 0.92 * c.Pc_bar));
  const T_K = Math.max(60, Math.min(1200, T_C + 273.15));
  const Tr = T_K / c.Tc_K;
  const kappa =
    c.omega > 0.491
      ? 0.379642 + 1.48503 * c.omega - 0.164423 * c.omega * c.omega + 0.016666 * c.omega * c.omega * c.omega
      : 0.37464 + 1.54226 * c.omega - 0.26992 * c.omega * c.omega;
  const rootTerm = Math.max(0.05, 1.0 + kappa * (1.0 - Math.sqrt(Tr)));
  const aVal = (0.45723553 * R_GAS_BAR * R_GAS_BAR * c.Tc_K * c.Tc_K * rootTerm * rootTerm) / c.Pc_bar;
  const bVal = Math.max(1e-9, (0.07779607 * R_GAS_BAR * c.Tc_K) / c.Pc_bar);
  const A = (aVal * P_bar) / (R_GAS_BAR * R_GAS_BAR * T_K * T_K);
  const B = (bVal * P_bar) / (R_GAS_BAR * T_K);
  const c2 = -(1.0 - B);
  const c1 = A - 3.0 * B * B - 2.0 * B;
  const c0 = -(A * B - B * B - B * B * B);
  solveCubicMinMaxAbove(c2, c1, c0, B + 1e-9, _cubicOutBuf);
  const Z = _cubicOutBuf[1];
  const sqrt2 = Math.SQRT2;
  const logTerm = Math.log(
    Math.max(1e-15, (Z + (1.0 + sqrt2) * B) / Math.max(1e-15, Z + (1.0 - sqrt2) * B))
  );
  const lnPhi = (Z - 1.0) - Math.log(Math.max(1e-15, Z - B)) - (A / (2.0 * sqrt2 * Math.max(1e-15, B))) * logTerm;
  return Math.max(0.15, Math.min(2.5, Math.exp(Math.max(-40, Math.min(40, lnPhi)))));
}

export function liquidMolarVolumeLPerMol(comp: SimCompKey): number {
  switch (comp) {
    case 'H2O': return 0.01807;
    case 'MeOH': return 0.0407;
    case 'EtOH': return 0.0587;
    case 'IPA': return 0.0769;
    case 'Acetone': return 0.0740;
    case 'AceticAcid': return 0.0575;
    case 'EtOAc': return 0.0985;
    case 'CHCl3': return 0.0807;
    case 'Benzene': return 0.0894;
    case 'Toluene': return 0.1068;
    case 'pXylene': return 0.1239;
    case 'nC6H14': return 0.1316;
    case 'nC7H16': return 0.1475;
    case 'ECH': return 0.0784;
    case 'DCP': return 0.0960;
    case 'DCH': return 0.0950;
    case 'MCH': return 0.0835;
    case 'Glycerol': return 0.0730;
    case 'Cl2': return 0.0506;
    case 'NH3': return 0.0282;
    case 'HCl': return 0.0450;
    default: {
      const c = RIGOROUS_CRIT[comp];
      const zra = Math.max(0.20, 0.29056 - 0.08775 * c.omega);
      return ((R_GAS_BAR * c.Tc_K) / c.Pc_bar) * Math.pow(zra, 1.2);
    }
  }
}

// ── 4) 다중 열역학 패키지(ENRTL / NRTL / PR / SRK) + 엄밀 γ-φ / φ-φ 플래시 ──
export function solveRigorousFlashVLE(
  flowsKgH: Record<SimCompKey, number>,
  T_C: number,
  P_kgcm2g: number,
  waterActivity = 1.0,
  _psatWaterKgcm2A?: number,
  _psatCl2Kgcm2A?: number,
  propertyMethod: ResolvedPropertyMethod = 'ENRTL'
): {
  vap: Record<SimCompKey, number>;
  liq: Record<SimCompKey, number>;
  betaVapMole: number;
  Z_vap: number;
  converged: boolean;
  iterations: number;
} {
  const empty = (): Record<SimCompKey, number> => zeroRigRecord(0);
  const vap = empty();
  const liq = empty();

  liq.NaCl = Math.max(0, flowsKgH.NaCl ?? 0);
  liq.NaOH = Math.max(0, flowsKgH.NaOH ?? 0);
  liq.H2SO4 = Math.max(0, flowsKgH.H2SO4 ?? 0);
  liq.NaOCl = Math.max(0, flowsKgH.NaOCl ?? 0);
  liq.NaClO3 = Math.max(0, flowsKgH.NaClO3 ?? 0);
  liq.FeCl2 = Math.max(0, flowsKgH.FeCl2 ?? 0);
  liq.FeCl3 = Math.max(0, flowsKgH.FeCl3 ?? 0);
  liq.PAC = Math.max(0, flowsKgH.PAC ?? 0);

  const totalSaltMass =
    liq.NaCl + liq.NaOH + liq.H2SO4 + liq.NaOCl + liq.NaClO3 + liq.FeCl2 + liq.FeCl3 + liq.PAC;

  const nMol: Record<SimCompKey, number> = empty();
  let totVolMoles = 0;
  const activeVolComps: SimCompKey[] = [];
  for (let idx = 0; idx < VOLATILE_KEYS.length; idx++) {
    const k = VOLATILE_KEYS[idx];
    const m = Math.max(0, flowsKgH[k] || 0);
    if (m > 1e-15) {
      const nk = m / RIGOROUS_CRIT[k].mw;
      nMol[k] = nk;
      totVolMoles += nk;
      activeVolComps.push(k);
    }
  }

  if (totVolMoles <= 1e-12 || activeVolComps.length === 0) {
    return { vap, liq, betaVapMole: 0, Z_vap: 1.0, converged: true, iterations: 0 };
  }

  const z: Record<SimCompKey, number> = empty();
  for (let i = 0; i < activeVolComps.length; i++) {
    const k = activeVolComps[i];
    z[k] = nMol[k] / totVolMoles;
  }

  const P_bar = Math.max(1e-4, (P_kgcm2g + 1.03323) * 0.980665);

  if ((propertyMethod === 'PR' || propertyMethod === 'SRK') && totalSaltMass <= 1e-6) {
    return solvePureEosFlash(activeVolComps, z, nMol, T_C, P_bar, propertyMethod);
  }

  const T_K = Math.max(150.0, Math.min(900.0, T_C + 273.15));
  const useElectrolytes = propertyMethod !== 'NRTL' && totalSaltMass > 1e-9;

  const pSatMap = empty();
  const f0LiqBase = empty();
  const kHenryPure = empty();
  for (let i = 0; i < activeVolComps.length; i++) {
    const k = activeVolComps[i];
    const ps = pureDipprOrAntoineBarA(k, T_C);
    pSatMap[k] = ps;
    const vLiq = liquidMolarVolumeLPerMol(k);
    const poynt = Math.exp(Math.max(-0.5, Math.min(1.5, (vLiq * (P_bar - ps)) / (R_GAS_BAR * T_K))));
    const phiSat = PERMANENT_SUPERCRIT_SET.has(k) ? 1.0 : pureSatFugacityCoeffPR(k, T_C, ps);
    f0LiqBase[k] = ps * phiSat * poynt;
    if (HENRY_WATER_DATABANK[k]) {
      kHenryPure[k] = henryWaterBar(k, T_K);
    }
  }

  const xMol = empty();
  const yMol = empty();
  const baseK = empty();
  const effK = empty();
  const lastPhiVap: Record<SimCompKey, number> = { ...ONE_RIG_TEMPLATE };

  for (let i = 0; i < activeVolComps.length; i++) {
    const k = activeVolComps[i];
    xMol[k] = z[k];
    yMol[k] = z[k];
    if (PERMANENT_SUPERCRIT_SET.has(k)) {
      baseK[k] = Math.max(1e-6, Math.min(1e7, (kHenryPure[k] || pSatMap[k]) / P_bar));
    } else {
      baseK[k] = Math.max(1e-10, Math.min(1e7, f0LiqBase[k] / P_bar));
    }
  }

  const fillConcentrativeK = (betaTrial: number, outK: Record<SimCompKey, number>): void => {
    if (!useElectrolytes) {
      const awOverride =
        propertyMethod === 'ENRTL' && waterActivity > 0 && waterActivity < 0.9999 ? waterActivity : 1.0;
      for (let i = 0; i < activeVolComps.length; i++) {
        const k = activeVolComps[i];
        outK[k] = k === 'H2O' ? baseK[k] * awOverride : baseK[k];
      }
      return;
    }
    const lWaterMol = Math.max(0, totVolMoles * Math.max(0, 1.0 - betaTrial) * Math.max(1e-12, xMol.H2O || 0));
    const waterKg = lWaterMol * 0.01801528;
    const mol = computeElectrolyteMolalitiesFromWaterKg(liq, waterKg, false);
    const aw = calcElectrolyteWaterActivity(mol, T_C);
    const xWaterFrac = Math.max(0, Math.min(1, xMol.H2O || 0));

    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      if (k === 'H2O') {
        outK[k] = baseK[k] * aw;
      } else if (k === 'HCl') {
        if (xWaterFrac > 0.02) {
          const mClExtra = mol.mNaCl + 2.0 * mol.mFeCl2 + 3.0 * mol.mFeCl3 + 2.0 * mol.mPAC;
          const wHclAq =
            (xMol.HCl * RIGOROUS_CRIT.HCl.mw) /
            Math.max(1e-15, xMol.HCl * RIGOROUS_CRIT.HCl.mw + xMol.H2O * RIGOROUS_CRIT.H2O.mw);
          const hclEq = calcHclWaterEquilibriumBar(wHclAq, T_C, mClExtra);
          const xDen = Math.max(1e-15, xMol.HCl + xMol.H2O);
          const xHclInAq = xMol.HCl / xDen;
          outK[k] = Math.max(1e-12, Math.min(1e7, hclEq.pHCl_bar / Math.max(1e-15, xHclInAq * P_bar)));
        } else {
          outK[k] = baseK[k];
        }
      } else {
        const sech = calcSechenovSaltingOutMultiplier(k, mol, T_K);
        const mult = xWaterFrac > 1e-4 ? Math.pow(sech, xWaterFrac) : 1.0;
        let kEff = Math.min(1e8, baseK[k] * mult);
        if (
          xWaterFrac > 0.05 &&
          !PERMANENT_SUPERCRIT_SET.has(k) &&
          !AQUEOUS_HENRY_CONDENSABLE_SET.has(k) &&
          k !== 'NH3' &&
          T_K < 0.98 * RIGOROUS_CRIT[k].Tc_K &&
          (xMol[k] || 0) > 1e-8
        ) {
          const phiVk = Math.max(1e-6, lastPhiVap[k] || 1.0);
          const kLleCeil = (1.02 * f0LiqBase[k]) / Math.max(1e-15, xMol[k] * phiVk * P_bar);
          if (kEff > kLleCeil) kEff = kLleCeil;
        }
        outK[k] = kEff;
      }
    }
  };

  const solveConcentrativeBeta = (): number => {
    fillConcentrativeK(0.0, effK);
    let f0 = 0;
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      f0 += z[k] * (effK[k] - 1.0);
    }
    if (f0 <= 0) return 0.0;

    if (!useElectrolytes || (nMol.H2O || 0) <= 1e-12) {
      let f1 = 0;
      for (let i = 0; i < activeVolComps.length; i++) {
        const k = activeVolComps[i];
        f1 += z[k] * (1.0 - 1.0 / Math.max(1e-12, effK[k]));
      }
      if (f1 >= 0) return 1.0;
      return solveRachfordRiceBeta(activeVolComps, z, effK);
    }

    const betaHiBound = 1.0 - 1e-9;
    fillConcentrativeK(betaHiBound, effK);
    let fHi = 0;
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      const km1 = effK[k] - 1.0;
      fHi += (z[k] * km1) / Math.max(1e-14, 1.0 + betaHiBound * km1);
    }
    if (fHi >= 0) return 1.0;

    let lo = 0.0;
    let hi = betaHiBound;
    for (let bi = 0; bi < 52; bi++) {
      const mid = 0.5 * (lo + hi);
      fillConcentrativeK(mid, effK);
      let fm = 0;
      for (let i = 0; i < activeVolComps.length; i++) {
        const k = activeVolComps[i];
        const km1 = effK[k] - 1.0;
        fm += (z[k] * km1) / Math.max(1e-14, 1.0 + mid * km1);
      }
      if (Math.abs(fm) < 1e-11 || hi - lo < 1e-12) {
        lo = hi = mid;
        break;
      }
      if (fm > 0) lo = mid;
      else hi = mid;
    }
    const betaFinal = 0.5 * (lo + hi);
    fillConcentrativeK(betaFinal, effK);
    return betaFinal;
  };

  let beta = 0.0;
  let lastZvap = 1.0;
  let converged = false;
  let iterUsed = 0;
  const eosMethodForVap: 'PR' | 'SRK' = propertyMethod === 'SRK' ? 'SRK' : 'PR';
  const prevX = empty();
  const prevGx = empty();
  const prevY = empty();
  const prevGy = empty();
  const dampX: Record<SimCompKey, number> = { ...ONE_RIG_TEMPLATE };
  const dampY: Record<SimCompKey, number> = { ...ONE_RIG_TEMPLATE };
  for (let i = 0; i < activeVolComps.length; i++) {
    const k = activeVolComps[i];
    dampX[k] = 0.75;
    dampY[k] = 0.75;
  }

  for (let outer = 0; outer < 80; outer++) {
    iterUsed = outer + 1;

    const gamma = calcExtendedNrtlGamma(activeVolComps, xMol, T_C);
    let eosVap = evalCubicEosBar(eosMethodForVap, yMol, T_C, P_bar);
    if (eosVap.rootCount === 1 && eosVap.Z_vap < 0.28) {
      let pSatMix = 0;
      let yCondSum = 0;
      for (let i = 0; i < activeVolComps.length; i++) {
        const k = activeVolComps[i];
        if (!PERMANENT_SUPERCRIT_SET.has(k) && T_K < 0.99 * RIGOROUS_CRIT[k].Tc_K) {
          const yk = Math.max(0, yMol[k] || 0);
          pSatMix += yk * pSatMap[k];
          yCondSum += yk;
        }
      }
      if (yCondSum > 0.5) {
        const pVapRef = Math.max(0.05, pSatMix / yCondSum);
        if (P_bar > pVapRef * 1.05) {
          const eosAtSat = evalCubicEosBar(eosMethodForVap, yMol, T_C, pVapRef);
          if (eosAtSat.Z_vap >= 0.28) {
            eosVap = eosAtSat;
          }
        }
      }
    }
    const eosLiqNonAq = evalCubicEosBar(eosMethodForVap, xMol, T_C, P_bar);
    lastZvap = eosVap.Z_vap;
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      lastPhiVap[k] = Math.max(1e-6, eosVap.phi_vap[k]);
    }

    const xWater = Math.max(0, Math.min(1, xMol.H2O || 0));
    const hasBothHclAndWater = (nMol.HCl || 0) > 1e-15 && xWater > 0.01;
    let hclAqRes: { pHCl_bar: number; pH2O_bar: number; aw_hcl: number } | null = null;
    if (hasBothHclAndWater) {
      const wHclAq =
        (xMol.HCl * RIGOROUS_CRIT.HCl.mw) /
        Math.max(1e-15, xMol.HCl * RIGOROUS_CRIT.HCl.mw + xWater * RIGOROUS_CRIT.H2O.mw);
      hclAqRes = calcHclWaterEquilibriumBar(wHclAq, T_C, 0);
    }

    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      const phiV = Math.max(1e-6, eosVap.phi_vap[k]);

      if (PERMANENT_SUPERCRIT_SET.has(k)) {
        const hAq = Math.max(1.0, kHenryPure[k] || pSatMap[k]);
        const hNonAq = Math.max(1.0, eosLiqNonAq.phi_liq[k] * P_bar);
        const hEff =
          xWater >= 0.999
            ? hAq
            : xWater <= 1e-4
              ? hNonAq
              : Math.exp(xWater * Math.log(hAq) + (1.0 - xWater) * Math.log(hNonAq));
        baseK[k] = Math.max(1e-6, Math.min(1e8, hEff / (phiV * P_bar)));
      } else if (k === 'HCl' && hclAqRes) {
        const xAqPair = Math.max(1e-15, (xMol.HCl || 0) + xWater);
        const xHclLocal = Math.max(1e-15, (xMol.HCl || 0) / xAqPair);
        const fHclAq = hclAqRes.pHCl_bar / xHclLocal;
        const fHclOrg = (gamma.HCl || 1.0) * f0LiqBase.HCl;
        const wAq = Math.min(1.0, xAqPair);
        const fEff =
          wAq >= 0.999
            ? fHclAq
            : Math.exp(wAq * Math.log(Math.max(1e-15, fHclAq)) + (1.0 - wAq) * Math.log(Math.max(1e-15, fHclOrg)));
        baseK[k] = Math.max(1e-12, Math.min(1e7, fEff / (phiV * P_bar)));
      } else if (k === 'H2O' && hclAqRes) {
        const xAqPair = Math.max(1e-15, (xMol.HCl || 0) + xWater);
        const xWLocal = Math.max(1e-15, xWater / xAqPair);
        const gammaHclFactor = hclAqRes.aw_hcl / xWLocal;
        const gW = (gamma.H2O || 1.0) * gammaHclFactor;
        baseK[k] = Math.max(1e-12, Math.min(1e7, (gW * f0LiqBase.H2O) / (phiV * P_bar)));
      } else if (AQUEOUS_HENRY_CONDENSABLE_SET.has(k) && xWater > 1e-4) {
        const hAq = Math.max(0.1, kHenryPure[k]);
        const fSym = Math.max(1e-8, (gamma[k] || 1.0) * f0LiqBase[k]);
        const fEff =
          xWater >= 0.999
            ? hAq
            : Math.exp(xWater * Math.log(hAq) + (1.0 - xWater) * Math.log(fSym));
        baseK[k] = Math.max(1e-10, Math.min(1e7, fEff / (phiV * P_bar)));
      } else {
        let gVal = gamma[k] || 1.0;
        if (
          xWater > 0.05 &&
          k !== 'H2O' &&
          k !== 'NH3' &&
          T_K < 0.98 * RIGOROUS_CRIT[k].Tc_K &&
          (xMol[k] || 0) > 1e-8 &&
          xMol[k] * gVal > 1.02
        ) {
          gVal = 1.02 / xMol[k];
        }
        baseK[k] = Math.max(1e-12, Math.min(1e7, (gVal * f0LiqBase[k]) / (phiV * P_bar)));
      }
    }

    const prevBeta = beta;
    beta = solveConcentrativeBeta();

    let xSum = 0;
    let ySum = 0;
    const xRaw = empty();
    const yRaw = empty();
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      const xi = z[k] / Math.max(1e-15, 1.0 + beta * (effK[k] - 1.0));
      const yi = effK[k] * xi;
      xRaw[k] = xi;
      yRaw[k] = yi;
      xSum += xi;
      ySum += yi;
    }

    let maxDiff = Math.abs(beta - prevBeta);
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      const xn = xSum > 1e-15 ? xRaw[k] / xSum : z[k];
      const yn = ySum > 1e-15 ? yRaw[k] / ySum : z[k];
      maxDiff = Math.max(maxDiff, Math.abs(xn - xMol[k]), Math.abs(yn - yMol[k]));
      xRaw[k] = xn;
      yRaw[k] = yn;
    }

    if (outer >= 1 && maxDiff < 1e-7) {
      for (let i = 0; i < activeVolComps.length; i++) {
        const k = activeVolComps[i];
        xMol[k] = xRaw[k];
        yMol[k] = yRaw[k];
      }
      converged = true;
      break;
    }

    let xNormSum = 0;
    let yNormSum = 0;
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      const xn = xRaw[k];
      const yn = yRaw[k];
      const xc = xMol[k];
      const yc = yMol[k];
      let nextX: number;
      let nextY: number;
      if (outer === 0) {
        nextX = xn;
        nextY = yn;
      } else {
        const dx = xc - prevX[k];
        const dgx = xn - prevGx[k];
        if ((xn - xc) * (prevGx[k] - prevX[k]) < 0) {
          dampX[k] = Math.max(0.05, dampX[k] * 0.6);
        } else {
          dampX[k] = Math.min(0.82, dampX[k] * 1.05);
        }
        let wx = dampX[k];
        if (Math.abs(dx) > 1e-13) {
          const sx = dgx / dx;
          if (sx < 0.86) {
            wx = Math.max(0.03, Math.min(0.88, 1.0 / (1.0 - sx)));
          }
        }
        nextX = Math.max(0, wx * xn + (1.0 - wx) * xc);

        const dy = yc - prevY[k];
        const dgy = yn - prevGy[k];
        if ((yn - yc) * (prevGy[k] - prevY[k]) < 0) {
          dampY[k] = Math.max(0.05, dampY[k] * 0.6);
        } else {
          dampY[k] = Math.min(0.82, dampY[k] * 1.05);
        }
        let wy = dampY[k];
        if (Math.abs(dy) > 1e-13) {
          const sy = dgy / dy;
          if (sy < 0.86) {
            wy = Math.max(0.03, Math.min(0.88, 1.0 / (1.0 - sy)));
          }
        }
        nextY = Math.max(0, wy * yn + (1.0 - wy) * yc);
      }
      prevX[k] = xc;
      prevGx[k] = xn;
      prevY[k] = yc;
      prevGy[k] = yn;
      xMol[k] = nextX;
      yMol[k] = nextY;
      xNormSum += nextX;
      yNormSum += nextY;
    }
    if (xNormSum > 1e-15) {
      for (let i = 0; i < activeVolComps.length; i++) xMol[activeVolComps[i]] /= xNormSum;
    }
    if (yNormSum > 1e-15) {
      for (let i = 0; i < activeVolComps.length; i++) yMol[activeVolComps[i]] /= yNormSum;
    }
  }

  if (beta <= 1e-11) {
    beta = 0.0;
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      liq[k] = nMol[k] * RIGOROUS_CRIT[k].mw;
      vap[k] = 0;
    }
  } else if (beta >= 1.0 - 1e-11 && !useElectrolytes) {
    beta = 1.0;
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      vap[k] = nMol[k] * RIGOROUS_CRIT[k].mw;
      liq[k] = 0;
    }
  } else {
    for (let i = 0; i < activeVolComps.length; i++) {
      const k = activeVolComps[i];
      const denom = Math.max(1e-15, 1.0 + beta * (effK[k] - 1.0));
      const lMol = (nMol[k] * (1.0 - beta)) / denom;
      const vMol = Math.max(0, nMol[k] - lMol);
      liq[k] = lMol * RIGOROUS_CRIT[k].mw;
      vap[k] = vMol * RIGOROUS_CRIT[k].mw;
    }
  }

  return { vap, liq, betaVapMole: beta, Z_vap: lastZvap, converged, iterations: iterUsed };
}

// ── Public Thermodynamic Validation & Equilibrium APIs (W1 / W2 Contract) ────
function unpackValidationArgs<TLast>(
  arg0: SimCompKey[] | Partial<Record<SimCompKey, number>>,
  arg1: Partial<Record<SimCompKey, number>> | number,
  arg2: number | TLast,
  arg3?: TLast,
  defaultMethod?: TLast
): { comps: SimCompKey[]; xMol: Partial<Record<SimCompKey, number>>; scalar: number; method: TLast } {
  if (Array.isArray(arg0)) {
    return {
      comps: arg0,
      xMol: arg1 as Partial<Record<SimCompKey, number>>,
      scalar: arg2 as number,
      method: (arg3 ?? defaultMethod) as TLast,
    };
  }
  const xObj = arg0 as Partial<Record<SimCompKey, number>>;
  const comps = ALL_RIG_KEYS.filter(k => (xObj[k] ?? 0) > 0);
  return {
    comps,
    xMol: xObj,
    scalar: arg1 as number,
    method: ((arg2 as TLast | undefined) ?? defaultMethod) as TLast,
  };
}

export function liquidActivityCoefficients(
  comps: SimCompKey[],
  xMol: Partial<Record<SimCompKey, number>>,
  T_C: number,
  method: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): Record<SimCompKey, number>;
export function liquidActivityCoefficients(
  xMol: Partial<Record<SimCompKey, number>>,
  T_C: number,
  method?: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): Record<SimCompKey, number>;
export function liquidActivityCoefficients(
  arg0: SimCompKey[] | Partial<Record<SimCompKey, number>>,
  arg1: Partial<Record<SimCompKey, number>> | number,
  arg2?: number | ('PR' | 'SRK' | 'NRTL' | 'ENRTL'),
  arg3?: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): Record<SimCompKey, number> {
  const { comps, xMol, scalar: T_C, method } = unpackValidationArgs<'PR' | 'SRK' | 'NRTL' | 'ENRTL'>(
    arg0,
    arg1,
    arg2 as number,
    arg3,
    'NRTL'
  );
  const fullX = zeroRigRecord(0);
  let xSum = 0;
  for (let i = 0; i < ALL_RIG_KEYS.length; i++) {
    const k = ALL_RIG_KEYS[i];
    const v = Math.max(0, xMol[k] ?? 0);
    fullX[k] = v;
    xSum += v;
  }
  if (xSum > 1e-15) {
    for (let i = 0; i < ALL_RIG_KEYS.length; i++) fullX[ALL_RIG_KEYS[i]] /= xSum;
  }
  const active = comps.length > 0 ? comps : ALL_RIG_KEYS.filter(k => fullX[k] > 0);

  if (method === 'PR' || method === 'SRK') {
    const gammaOut = zeroRigRecord(1.0);
    let pRef = 0;
    for (const k of active) {
      if (!NON_VOLATILE_RIG_SET.has(k)) pRef += fullX[k] * pureDipprOrAntoineBarA(k, T_C);
    }
    pRef = Math.max(1.01325, pRef);
    const eosMix = evalCubicEosBar(method, fullX, T_C, pRef);
    for (const k of active) {
      if (NON_VOLATILE_RIG_SET.has(k)) continue;
      const pureMap = zeroRigRecord(0);
      pureMap[k] = 1.0;
      const eosPure = evalCubicEosBar(method, pureMap, T_C, pRef);
      gammaOut[k] = Math.max(1e-8, Math.min(1e8, eosMix.phi_liq[k] / Math.max(1e-20, eosPure.phi_liq[k])));
    }
    return gammaOut;
  }

  const gamma = calcExtendedNrtlGamma(active, fullX, T_C);
  if (method === 'ENRTL') {
    const xW = fullX.H2O || 0;
    if (xW > 1e-9) {
      const waterKg = xW * 0.01801528;
      const mol = computeElectrolyteMolalitiesFromWaterKg(fullX, waterKg, true);
      if (mol.totalMolality > 1e-8) {
        const aw = calcElectrolyteWaterActivity(mol, T_C);
        let volSum = 0;
        for (const k of active) {
          if (!NON_VOLATILE_RIG_SET.has(k) && !PERMANENT_SUPERCRIT_SET.has(k)) volSum += fullX[k];
        }
        const xWSaltFree = volSum > 1e-12 ? xW / volSum : 1.0;
        gamma.H2O = (gamma.H2O || 1.0) * (aw / Math.max(1e-9, xWSaltFree));
      }
      if ((fullX.HCl || 0) > 1e-12) {
        const wHcl =
          (fullX.HCl * RIGOROUS_CRIT.HCl.mw) /
          Math.max(1e-15, fullX.HCl * RIGOROUS_CRIT.HCl.mw + xW * RIGOROUS_CRIT.H2O.mw);
        const mClExtra = mol.mNaCl + 2.0 * mol.mFeCl2 + 3.0 * mol.mFeCl3 + 2.0 * mol.mPAC;
        const hclEq = calcHclWaterEquilibriumBar(wHcl, T_C, mClExtra);
        const psatHCl = pureDipprOrAntoineBarA('HCl', T_C);
        gamma.HCl = hclEq.pHCl_bar / Math.max(1e-15, fullX.HCl * psatHCl);
        gamma.H2O = (gamma.H2O || 1.0) * (hclEq.aw_hcl / Math.max(1e-9, xW / Math.max(1e-12, xW + fullX.HCl)));
      }
    }
  }
  return gamma;
}

export function bubblePressureBarA(
  comps: SimCompKey[],
  xMol: Partial<Record<SimCompKey, number>>,
  T_C: number,
  method: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): { P_barA: number; y: Record<SimCompKey, number>; converged: boolean };
export function bubblePressureBarA(
  xMol: Partial<Record<SimCompKey, number>>,
  T_C: number,
  method?: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): { P_barA: number; y: Record<SimCompKey, number>; converged: boolean };
export function bubblePressureBarA(
  arg0: SimCompKey[] | Partial<Record<SimCompKey, number>>,
  arg1: Partial<Record<SimCompKey, number>> | number,
  arg2?: number | ('PR' | 'SRK' | 'NRTL' | 'ENRTL'),
  arg3?: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): { P_barA: number; y: Record<SimCompKey, number>; converged: boolean } {
  const { comps, xMol, scalar: T_C, method } = unpackValidationArgs<'PR' | 'SRK' | 'NRTL' | 'ENRTL'>(
    arg0,
    arg1,
    arg2 as number,
    arg3,
    'NRTL'
  );
  const fullX = zeroRigRecord(0);
  let xSum = 0;
  const candidateKeys = comps.length > 0 ? comps : ALL_RIG_KEYS;
  for (const k of candidateKeys) {
    const v = Math.max(0, xMol[k] ?? 0);
    fullX[k] = v;
    xSum += v;
  }
  if (xSum <= 1e-15) {
    return { P_barA: 1.01325, y: zeroRigRecord(0), converged: false };
  }
  for (const k of candidateKeys) fullX[k] /= xSum;

  const volComps = candidateKeys.filter(k => fullX[k] > 1e-15 && !NON_VOLATILE_RIG_SET.has(k));
  if (volComps.length === 0) {
    return { P_barA: 1e-8, y: zeroRigRecord(0), converged: true };
  }

  const xVol = zeroRigRecord(0);
  let volSum = 0;
  for (const k of volComps) volSum += fullX[k];
  for (const k of volComps) xVol[k] = fullX[k] / Math.max(1e-15, volSum);

  if (method === 'PR' || method === 'SRK') {
    const T_K = Math.max(60, T_C + 273.15);
    let P = 0;
    for (const k of volComps) {
      const c = RIGOROUS_CRIT[k];
      const pEst =
        T_K < c.Tc_K * 0.99
          ? pureDipprOrAntoineBarA(k, T_C)
          : c.Pc_bar * Math.exp(5.373 * (1.0 + c.omega) * (1.0 - c.Tc_K / T_K));
      P += xVol[k] * pEst;
    }
    P = Math.max(1e-4, P * 1.06);

    const y = zeroRigRecord(0);
    for (const k of volComps) {
      const c = RIGOROUS_CRIT[k];
      const kw = (c.Pc_bar / P) * Math.exp(5.373 * (1.0 + c.omega) * (1.0 - c.Tc_K / T_K));
      y[k] = xVol[k] * kw;
    }
    let ySum0 = 0;
    for (const k of volComps) ySum0 += y[k];
    for (const k of volComps) y[k] = ySum0 > 1e-15 ? y[k] / ySum0 : xVol[k];

    const zCritRatio = method === 'SRK' ? 3.84732 : 3.95136;
    let converged = false;

    for (let it = 0; it < 120; it++) {
      const eosL = evalCubicEosBar(method, xVol, T_C, P);
      if (eosL.rootCount === 1 && eosL.Z_liq / Math.max(1e-12, eosL.B) > zCritRatio && it < 20) {
        P *= 1.18;
        continue;
      }

      let S = 0;
      for (let inner = 0; inner < 8; inner++) {
        const eosV = evalCubicEosBar(method, y, T_C, P);
        S = 0;
        const yNext = zeroRigRecord(0);
        for (const k of volComps) {
          const ki = eosL.phi_liq[k] / Math.max(1e-25, eosV.phi_vap[k]);
          yNext[k] = xVol[k] * ki;
          S += yNext[k];
        }
        let maxDy = 0;
        for (const k of volComps) {
          const yn = yNext[k] / Math.max(1e-25, S);
          maxDy = Math.max(maxDy, Math.abs(yn - y[k]));
          y[k] = yn;
        }
        if (maxDy < 1e-9) break;
      }

      if (Math.abs(S - 1.0) < 1e-8 && it >= 1) {
        P = P * S;
        converged = true;
        break;
      }

      const pNext = P * Math.pow(Math.max(0.1, Math.min(10.0, S)), it < 4 ? 0.85 : 1.0);
      P = Math.max(1e-5, pNext);
    }

    return { P_barA: P, y, converged };
  }

  const T_K = Math.max(150, T_C + 273.15);
  const gamma = calcExtendedNrtlGamma(volComps, xVol, T_C);
  const xW = xVol.H2O || 0;

  let molElec: ElectrolyteMolalities = {
    mNaOH: 0, mNaCl: 0, mH2SO4: 0, mNaOCl: 0, mNaClO3: 0, mFeCl2: 0, mFeCl3: 0, mPAC: 0, totalMolality: 0,
  };
  let awSalt = 1.0;
  if (method === 'ENRTL' && fullX.H2O > 1e-12) {
    molElec = computeElectrolyteMolalitiesFromWaterKg(fullX, fullX.H2O * 0.01801528, true);
    awSalt = calcElectrolyteWaterActivity(molElec, T_C);
  }

  const hasHclAq = (xVol.HCl || 0) > 1e-15 && xW > 0.01;
  let hclRes: { pHCl_bar: number; pH2O_bar: number; aw_hcl: number } | null = null;
  if (hasHclAq) {
    const wHclAq =
      (xVol.HCl * RIGOROUS_CRIT.HCl.mw) /
      Math.max(1e-15, xVol.HCl * RIGOROUS_CRIT.HCl.mw + xW * RIGOROUS_CRIT.H2O.mw);
    const mClExtra = molElec.mNaCl + 2.0 * molElec.mFeCl2 + 3.0 * molElec.mFeCl3 + 2.0 * molElec.mPAC;
    hclRes = calcHclWaterEquilibriumBar(wHclAq, T_C, mClExtra);
  }

  const pSat = zeroRigRecord(0);
  const phiSat = zeroRigRecord(1.0);
  const vLiq = zeroRigRecord(0.05);
  for (const k of volComps) {
    pSat[k] = pureDipprOrAntoineBarA(k, T_C);
    phiSat[k] = PERMANENT_SUPERCRIT_SET.has(k) ? 1.0 : pureSatFugacityCoeffPR(k, T_C, pSat[k]);
    vLiq[k] = liquidMolarVolumeLPerMol(k);
  }

  const computeLiqFugBar = (k: SimCompKey, P_curr: number): number => {
    const poynt = Math.exp(Math.max(-0.5, Math.min(1.5, (vLiq[k] * (P_curr - pSat[k])) / (R_GAS_BAR * T_K))));
    if (PERMANENT_SUPERCRIT_SET.has(k)) {
      const hAq = Math.max(1.0, henryWaterBar(k, T_K) || pSat[k]);
      const sech = method === 'ENRTL' ? calcSechenovSaltingOutMultiplier(k, molElec, T_K) : 1.0;
      const eosL = evalCubicEosBar('PR', xVol, T_C, Math.max(1.0, P_curr));
      const hNonAq = Math.max(1.0, eosL.phi_liq[k] * Math.max(1.0, P_curr));
      const hEff =
        xW >= 0.999
          ? hAq * sech
          : xW <= 1e-4
            ? hNonAq
            : Math.exp(xW * Math.log(hAq * sech) + (1.0 - xW) * Math.log(hNonAq));
      return xVol[k] * hEff;
    }
    if (k === 'HCl' && hclRes) {
      const xAqPair = Math.max(1e-15, (xVol.HCl || 0) + xW);
      const xHclLocal = Math.max(1e-15, (xVol.HCl || 0) / xAqPair);
      const fAq = hclRes.pHCl_bar / xHclLocal;
      const fOrg = (gamma.HCl || 1.0) * pSat.HCl * phiSat.HCl * poynt;
      const wAq = Math.min(1.0, xAqPair);
      const fRef =
        wAq >= 0.999
          ? fAq
          : Math.exp(wAq * Math.log(Math.max(1e-15, fAq)) + (1.0 - wAq) * Math.log(Math.max(1e-15, fOrg)));
      return xVol.HCl * fRef;
    }
    if (k === 'H2O') {
      let gW = (gamma.H2O || 1.0) * awSalt;
      if (hclRes) {
        const xAqPair = Math.max(1e-15, (xVol.HCl || 0) + xW);
        const xWLocal = Math.max(1e-15, xW / xAqPair);
        gW *= hclRes.aw_hcl / xWLocal;
      }
      return xVol.H2O * gW * pSat.H2O * phiSat.H2O * poynt;
    }
    if (AQUEOUS_HENRY_CONDENSABLE_SET.has(k) && xW > 1e-4) {
      const sech = method === 'ENRTL' ? calcSechenovSaltingOutMultiplier(k, molElec, T_K) : 1.0;
      const hAq = Math.max(0.1, henryWaterBar(k, T_K)) * sech;
      const fSym = Math.max(1e-8, (gamma[k] || 1.0) * pSat[k] * phiSat[k] * poynt);
      const fRef = xW >= 0.999 ? hAq : Math.exp(xW * Math.log(hAq) + (1.0 - xW) * Math.log(fSym));
      return xVol[k] * fRef;
    }
    const sech = method === 'ENRTL' ? Math.pow(calcSechenovSaltingOutMultiplier(k, molElec, T_K), xW) : 1.0;
    return xVol[k] * (gamma[k] || 1.0) * sech * pSat[k] * phiSat[k] * poynt;
  };

  let P = 0;
  const y = zeroRigRecord(0);
  for (const k of volComps) {
    const fk = computeLiqFugBar(k, 1.01325);
    y[k] = fk;
    P += fk;
  }
  P = Math.max(1e-6, P);
  for (const k of volComps) y[k] /= P;

  let converged = false;
  for (let it = 0; it < 40; it++) {
    const eosV = evalCubicEosBar('PR', y, T_C, P);
    let pNew = 0;
    const pi = zeroRigRecord(0);
    for (const k of volComps) {
      const fLiq = computeLiqFugBar(k, P);
      pi[k] = fLiq / Math.max(1e-6, eosV.phi_vap[k]);
      pNew += pi[k];
    }
    pNew = Math.max(1e-8, pNew);
    for (const k of volComps) y[k] = pi[k] / pNew;
    if (Math.abs(pNew - P) / Math.max(1e-12, P) < 1e-8) {
      P = pNew;
      converged = true;
      break;
    }
    P = 0.8 * pNew + 0.2 * P;
  }

  return { P_barA: P, y, converged };
}

export function bubbleTemperatureC(
  comps: SimCompKey[],
  xMol: Partial<Record<SimCompKey, number>>,
  P_barA: number,
  method: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): { T_C: number; y: Record<SimCompKey, number>; converged: boolean };
export function bubbleTemperatureC(
  xMol: Partial<Record<SimCompKey, number>>,
  P_barA: number,
  method?: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): { T_C: number; y: Record<SimCompKey, number>; converged: boolean };
export function bubbleTemperatureC(
  arg0: SimCompKey[] | Partial<Record<SimCompKey, number>>,
  arg1: Partial<Record<SimCompKey, number>> | number,
  arg2?: number | ('PR' | 'SRK' | 'NRTL' | 'ENRTL'),
  arg3?: 'PR' | 'SRK' | 'NRTL' | 'ENRTL'
): { T_C: number; y: Record<SimCompKey, number>; converged: boolean } {
  const { comps, xMol, scalar: P_barA, method } = unpackValidationArgs<'PR' | 'SRK' | 'NRTL' | 'ENRTL'>(
    arg0,
    arg1,
    arg2 as number,
    arg3,
    'NRTL'
  );
  const P_target = Math.max(1e-5, P_barA);
  const active = comps.length > 0 ? comps : ALL_RIG_KEYS.filter(k => (xMol[k] ?? 0) > 0);
  if (active.length === 0) {
    return { T_C: 25.0, y: zeroRigRecord(0), converged: false };
  }

  const fOfT = (T: number) => {
    const bp = bubblePressureBarA(active, xMol, T, method);
    return { f: Math.log(Math.max(1e-12, bp.P_barA) / P_target), y: bp.y, bpConv: bp.converged };
  };

  let lo = -160.0;
  let hi = 320.0;
  const tGuess = 75.0;
  const rMid = fOfT(tGuess);
  if (Math.abs(rMid.f) < 1e-7) {
    return { T_C: tGuess, y: rMid.y, converged: true };
  }

  if (rMid.f < 0) {
    lo = tGuess;
    let step = 25.0;
    hi = lo + step;
    while (hi < 380.0 && fOfT(hi).f < 0) {
      lo = hi;
      step *= 1.5;
      hi = Math.min(380.0, hi + step);
    }
  } else {
    hi = tGuess;
    let step = 25.0;
    lo = hi - step;
    while (lo > -190.0 && fOfT(lo).f > 0) {
      hi = lo;
      step *= 1.5;
      lo = Math.max(-190.0, lo - step);
    }
  }

  let rLo = fOfT(lo);
  let rHi = fOfT(hi);
  if (rLo.f * rHi.f > 0) {
    const best = Math.abs(rLo.f) < Math.abs(rHi.f) ? { T: lo, r: rLo } : { T: hi, r: rHi };
    return { T_C: best.T, y: best.r.y, converged: false };
  }

  let tPrev = lo;
  let fPrev = rLo.f;
  let tCurr = hi;
  let fCurr = rHi.f;
  let bestY = rHi.y;
  let converged = false;

  for (let it = 0; it < 55; it++) {
    let tNext: number;
    if (Math.abs(fCurr - fPrev) > 1e-12) {
      const sec = tCurr - (fCurr * (tCurr - tPrev)) / (fCurr - fPrev);
      tNext = sec > lo + 0.02 * (hi - lo) && sec < hi - 0.02 * (hi - lo) ? sec : 0.5 * (lo + hi);
    } else {
      tNext = 0.5 * (lo + hi);
    }

    const rNext = fOfT(tNext);
    bestY = rNext.y;
    if (Math.abs(rNext.f) < 1e-7 || hi - lo < 1e-6) {
      tCurr = tNext;
      converged = true;
      break;
    }

    if (rNext.f < 0) {
      lo = tNext;
      rLo = rNext;
    } else {
      hi = tNext;
      rHi = rNext;
    }
    tPrev = tCurr;
    fPrev = fCurr;
    tCurr = tNext;
    fCurr = rNext.f;
  }

  return { T_C: tCurr, y: bestY, converged };
}

// ── 5) 정밀 전해조 전기화학(Nernst + Tafel + 막 저항) 및 자체 발열 모델 ──────
export function calcRigorousCellElectrochem(params: {
  currentKA: number;
  membraneAreaM2: number;
  tempC: number;
  pressAnodeKgcm2g: number;
  anBrineWtPct: number;
  caNaohWtPct: number;
}): {
  cellVoltageV: number;
  reversibleV: number;
  overpotentialV: number;
  ohmicDropV: number;
  currentDensityKAm2: number;
  jouleHeatKcalPerMolElectron: number;
} {
  const T_K = Math.max(300, params.tempC + 273.15);
  const area = Math.max(0.5, params.membraneAreaM2);
  const j = params.currentKA / area; // 전류밀도 kA/m² (통상 4.0 ~ 6.5 kA/m²)

  // Nernst 평형전위: E_rev(T) ≈ 2.188 - 0.00045*(T_K - 298.15) + RT/2F ln(P_Cl2 * P_H2 / a_NaCl^2)
  const P_abs = Math.max(1.0, params.pressAnodeKgcm2g + 1.03323);
  const a_nacl = Math.max(0.05, params.anBrineWtPct / 26.0);
  const a_naoh = Math.max(0.1, params.caNaohWtPct / 32.0);
  const E_rev =
    2.195 -
    0.00042 * (T_K - 298.15) +
    ((R_J_MOLK * T_K) / (2 * 96485)) * Math.log((P_abs * P_abs * a_naoh * a_naoh) / (a_nacl * a_nacl));

  // DSA 양극(RuO2-IrO2/Ti) + 활성니켈 음극 Tafel 활성화 과전압
  const eta_anode = 0.032 * Math.log10(Math.max(0.2, j) * 10);
  const eta_cathode = 0.085 + 0.045 * Math.log10(Math.max(0.2, j) * 10);
  const overpotentialV = Math.max(0.08, eta_anode + eta_cathode);

  // 불소계 이온교환막 + 전해액 + 구조체 저항 (온도가 높을수록 저항 감소, 32% NaOH 근처에서 최적 전도도)
  const tempFactor = Math.exp(1150 * (1 / T_K - 1 / 363.15));
  const concPenalty = 1.0 + 0.0018 * Math.pow(params.caNaohWtPct - 32.0, 2);
  const rAreaOhmCm2 = 1.18 * tempFactor * concPenalty; // Ω·cm² -> kA/m² 당 0.1 * rArea V
  const ohmicDropV = 0.1 * rAreaOhmCm2 * j;

  const cellVoltageV = Math.min(4.8, Math.max(2.35, E_rev + overpotentialV + ohmicDropV));

  // 열중립전압 V_tn = ΔH_rxn/(2F) — thermoCore 생성열 기준 (NaOH 농도 의존 용해열 포함, 32 wt% 에서 약 2.38 V)
  const V_thermoneutral = chlorAlkaliThermoneutralVoltage(params.tempC, params.caNaohWtPct);
  const jouleHeatKcalPerMolElectron = ((cellVoltageV - V_thermoneutral) * 96485) / 4184.0; // kcal / mol e-

  return {
    cellVoltageV,
    reversibleV: E_rev,
    overpotentialV,
    ohmicDropV,
    currentDensityKAm2: j,
    jouleHeatKcalPerMolElectron,
  };
}

// ── 6) 열교환기 · 액화기 3-Zone 상변화 분할 적분 (Desuperheat / Condense / Subcool) ──
export function calcRigorousThreeZoneHex(params: {
  T_in: number;
  T_out: number;
  T_dew: number;
  totalDutyKcalH: number;
  sensibleGasKcalH: number;
  latentCondKcalH: number;
  subcoolLiqKcalH: number;
  uT_in: number;
  uT_out: number;
  baseU: number;
  foulingFactorM2HKcal: number; // 예: 0.0002 m²·h·°C/kcal
}): {
  totalAreaM2: number;
  zoneSummary: string;
  pinchWarning: string | null;
  effectiveU: number;
} {
  const Q_tot = Math.abs(params.totalDutyKcalH);
  if (Q_tot < 1.0) {
    return { totalAreaM2: 0, zoneSummary: '열교환 부하 없음', pinchWarning: null, effectiveU: params.baseU };
  }

  // 향류(Counter-current) 기준 각 구역 경계에서의 냉매 온도 배분
  const q1 = Math.max(0, Math.abs(params.sensibleGasKcalH));
  const q2 = Math.max(0, Math.abs(params.latentCondKcalH));
  const q3 = Math.max(0, Math.abs(params.subcoolLiqKcalH));
  const qSum = Math.max(1, q1 + q2 + q3);
  const scale = Q_tot / qSum;
  const Q1 = q1 * scale; // 과열감온
  const Q2 = q2 * scale; // 상변화 액화/응축
  const Q3 = q3 * scale; // 액상 과냉각

  const isCooling = params.totalDutyKcalH <= 0;
  const dT_util = params.uT_out - params.uT_in;

  // 냉각 기준: 공정 입구(고온)가 냉매 출구(uT_out)와 만나고, 공정 출구(저온)가 냉매 입구(uT_in)와 만남
  const uT_at_subcoolEnd = params.uT_in + dT_util * (Q3 / Q_tot);
  const uT_at_condStart = params.uT_in + dT_util * ((Q3 + Q2) / Q_tot);

  const safeLmtd = (dtA: number, dtB: number) => {
    const a = Math.max(0.8, Math.abs(dtA));
    const b = Math.max(0.8, Math.abs(dtB));
    return Math.abs(a - b) < 0.2 ? 0.5 * (a + b) : (a - b) / Math.log(a / b);
  };

  let pinchWarning: string | null = null;
  if (isCooling && (params.T_out <= params.uT_in + 0.5 || params.T_in <= params.uT_out + 0.5)) {
    pinchWarning = `⚠️ 온도 교차(Temperature Cross) 주의: 공정 출구(${params.T_out.toFixed(1)}°C)가 냉매 입구(${params.uT_in.toFixed(1)}°C)에 근접하거나 낮습니다!`;
  }

  const Rf = Math.max(0, params.foulingFactorM2HKcal);
  const applyFouling = (uClean: number) => 1.0 / (1.0 / Math.max(20, uClean) + Rf);

  // 구역별 열전달계수 특성: 기상 현열(낮음 0.38x) / 상변화 응축(높음 1.25x) / 액상 과냉(중간 0.85x)
  const U_desup = applyFouling(params.baseU * 0.42);
  const U_cond = applyFouling(params.baseU * 1.22);
  const U_sub = applyFouling(params.baseU * 0.85);

  const T_dew_clamped = Math.min(params.T_in, Math.max(params.T_out, params.T_dew));

  const A1 = Q1 > 1 ? Q1 / (U_desup * safeLmtd(params.T_in - params.uT_out, T_dew_clamped - uT_at_condStart)) : 0;
  const A2 = Q2 > 1 ? Q2 / (U_cond * safeLmtd(T_dew_clamped - uT_at_condStart, T_dew_clamped - uT_at_subcoolEnd)) : 0;
  const A3 = Q3 > 1 ? Q3 / (U_sub * safeLmtd(T_dew_clamped - uT_at_subcoolEnd, params.T_out - params.uT_in)) : 0;

  const totalAreaM2 = A1 + A2 + A3;
  const effectiveU = totalAreaM2 > 0 ? Q_tot / (totalAreaM2 * safeLmtd(params.T_in - params.uT_out, params.T_out - params.uT_in)) : params.baseU;

  const parts: string[] = [];
  if (A1 > 0.05) parts.push(`감온 ${A1.toFixed(1)}m²`);
  if (A2 > 0.05) parts.push(`응축·액화 ${A2.toFixed(1)}m²`);
  if (A3 > 0.05) parts.push(`과냉 ${A3.toFixed(1)}m²`);

  return {
    totalAreaM2,
    zoneSummary: parts.length > 0 ? parts.join(' + ') : `${totalAreaM2.toFixed(1)} m²`,
    pinchWarning,
    effectiveU,
  };
}

// ── 7) 흡수·건조탑 다단 기액평형 (Kremser N-Stage MESH) 모델 ─────────────────
export function calcRigorousKremserRemoval(params: {
  target: SimCompKey;
  nStages: number;
  gasKmolH: number;
  liqKmolH: number;
  topTempC: number;
  pressKgcm2g: number;
  solventComp: SimCompKey;
  acidWtPct?: number;
}): {
  removalEff: number;
  absorptionFactorA: number;
  columnDiaM: number;
} {
  const N = Math.max(1, Math.min(60, Math.round(params.nStages)));
  const G = Math.max(0.01, params.gasKmolH);
  const L = Math.max(0.001, params.liqKmolH);
  const P_abs = Math.max(0.2, params.pressKgcm2g + 1.03323);
  const T_K = params.topTempC + 273.15;

  // 흡수제 종류별 평형분배계수 m = y* / x (온도·압력·황산농도 연동)
  let m_eq = 0.05;
  if (params.target === 'H2O' && params.solventComp === 'H2SO4') {
    // 황산 농도(60%~98%)에 따른 수분 평형 증기압 지수 감소 반영 (Perry's / 식염전해 핸드북 상관식)
    const wt = Math.max(50, Math.min(99, params.acidWtPct ?? 95));
    const concFactor = Math.exp(-0.145 * (wt - 75.0)); // 75% 대비 98%에서 평형분압 약 28배 감소!
    m_eq = (0.012 * concFactor * Math.exp(0.045 * (params.topTempC - 20))) / P_abs;
  } else if (params.target === 'HCl' && params.solventComp === 'H2O') {
    // 물에 의한 HCl 흡수 (온도 상승 시 분압 증가 반영)
    m_eq = (0.018 * Math.exp(0.065 * (params.topTempC - 35))) / P_abs;
  } else if (params.target === 'Cl2' && params.solventComp === 'NaOH') {
    // 가성소다 화학흡수 (비가역 중화반응으로 평형분압 극소)
    m_eq = 0.0004 / P_abs;
  } else {
    m_eq = (0.12 * (T_K / 298.15)) / P_abs;
  }

  const A = L / Math.max(1e-6, m_eq * G); // 흡수인자 A = L / (m * G)

  let removalEff = 0.99;
  if (Math.abs(A - 1.0) < 1e-3) {
    removalEff = N / (N + 1.0);
  } else {
    const AN1 = Math.pow(A, N + 1);
    const AN = Math.pow(A, N);
    removalEff = (AN1 - A) / Math.max(1e-9, AN1 - 1.0);
  }
  removalEff = Math.max(0.05, Math.min(0.99998, removalEff));

  // Souders-Brown 기반 충전탑 직경 추정 (공탑 기체유속 u_s ≈ 1.1 m/s 기준)
  const volGasM3S = (G * 0.08314 * T_K) / (P_abs * 0.980665 * 3600);
  const areaCol = volGasM3S / 1.05;
  const columnDiaM = Math.max(0.3, Math.sqrt((4 * areaCol) / Math.PI));

  return { removalEff, absorptionFactorA: A, columnDiaM };
}

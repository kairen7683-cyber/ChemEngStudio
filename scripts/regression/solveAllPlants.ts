/**
 * 전 플랜트 계층 시트 일괄 해석 회귀(Regression) 하네스
 *
 * 실행:  npx.cmd tsx scripts/regression/solveAllPlants.ts [출력JSON경로]
 *   예)  npx.cmd tsx scripts/regression/solveAllPlants.ts scripts/regression/baseline_stage1.json
 *        두 번째 인자로 비교 기준 JSON을 주면 시트별 차이를 출력합니다.
 *   예)  npx.cmd tsx scripts/regression/solveAllPlants.ts out.json scripts/regression/baseline_stage1.json
 *
 * 시트별 출력: 수렴 여부, 반복수, 소요 ms, 질량 불균형(kg/h), 에너지 잔차(kW / %),
 *            미연결 출구 수, 보충(makeup) 유입 수, 제품 스트림 유량·주요 조성
 */
import * as fs from 'fs';
import * as path from 'path';
import { solveFlowsheet, FlowNodeDef, FlowEdgeDef, SimCompKey } from '../../lib/calculations/flowsheetSolver';
import { createInitialHierarchySheets } from '../../lib/calculations/fullPlantHierarchy';
import { createInitialHcl1AHierarchySheets } from '../../lib/calculations/hcl1AHierarchy';
import { createInitialEchHierarchySheets } from '../../lib/calculations/echPlantHierarchy';
import { createInitialCmsHierarchySheets } from '../../lib/calculations/cmsPlantHierarchy';
import { createInitialMdiHierarchySheets } from '../../lib/calculations/mdiPlantHierarchy';

const KCALH_TO_KW = 1 / 859.845;

interface SheetLike { simDefs: FlowNodeDef[]; flowEdges: FlowEdgeDef[] }

interface ProductSummary { tag: string; kgH: number; tempC: number; topWtPct: string }

interface SheetReport {
  plant: string;
  sheetId: string;
  converged: boolean;
  overallStatus: 'converged' | 'converged_with_warnings' | 'failed';
  failedUnitCount: number;
  warningUnitCount: number;
  makeupTotalKgH: number;
  iterations: number;
  ms: number;
  /** 하네스 독립 계산: Σ(feed 송출) − Σ(종단 product 수취) */
  boundaryFeedKgH: number;
  boundaryProductKgH: number;
  rawBoundaryGapKgH: number;
  /** 기존 장치별 불균형 절대값 합 (UI 경고 기준) */
  sumAbsUnitImbalanceKgH: number;
  /** 하네스 독립 계산(단순): ΣH(feed) + ΣQ(장치 heatDuty) + ΣW(장치 동력) − ΣH(종단 product), kW */
  naiveEnergyResidualKW: number;
  /** 솔버 결과 balance 객체가 있으면 기록 (Stage 1 이후) */
  massImbalanceKgH: number | null;
  physicalMassImbalanceKgH: number | null;
  makeupInKgH: number | null;
  unroutedOutKgH: number | null;
  unroutedOutletCount: number | null;
  makeupInletCount: number | null;
  energyResidualKW: number | null;
  energyResidualPct: number | null;
  products: ProductSummary[];
}

function topComps(flows: Record<SimCompKey, number>, total: number): string {
  if (total <= 0) return '-';
  return (Object.entries(flows) as [SimCompKey, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${((v / total) * 100).toFixed(2)}%`)
    .join(', ');
}

function solveSheet(plant: string, sheetId: string, sh: SheetLike): SheetReport {
  const t0 = Date.now();
  const res = solveFlowsheet(sh.simDefs, sh.flowEdges) as ReturnType<typeof solveFlowsheet> & { balance?: any };
  const ms = Date.now() - t0;

  const nodeById = new Map(sh.simDefs.map(n => [n.id, n]));
  let feedKgH = 0;
  let feedH = 0;
  let prodH = 0;
  let prodKgH = 0;
  const products: ProductSummary[] = [];
  for (const n of sh.simDefs) {
    if (n.unitType === 'feed') {
      for (const e of sh.flowEdges.filter(e => e.source === n.id)) {
        const fs0 = res.streams.find(s => s.edgeId === e.id);
        feedKgH += fs0?.totalMassKgH ?? 0;
        feedH += fs0?.enthalpyKcalH ?? 0;
      }
    }
    if (n.unitType === 'product' && !sh.flowEdges.some(e => e.source === n.id)) {
      const ins = sh.flowEdges.filter(e => e.target === n.id);
      const flows: Record<string, number> = {};
      let m = 0;
      let wT = 0;
      for (const e of ins) {
        const st = res.streams.find(s => s.edgeId === e.id);
        if (!st) continue;
        m += st.totalMassKgH;
        prodH += st.enthalpyKcalH;
        wT += st.totalMassKgH * st.tempC;
        for (const [k, v] of Object.entries(st.flowsKgH)) flows[k] = (flows[k] ?? 0) + v;
      }
      prodKgH += m;
      products.push({
        tag: n.tag,
        kgH: Number(m.toFixed(2)),
        tempC: Number((m > 0 ? wT / m : 0).toFixed(1)),
        topWtPct: topComps(flows as Record<SimCompKey, number>, m),
      });
    }
  }
  void nodeById;
  const sumAbsUnit = res.units.filter(u => !u.isVisualOnly).reduce((s, u) => s + Math.abs(u.massImbalanceKgH), 0);
  const b = res.balance;
  const sumQ = res.units.reduce((s, u) => s + (u.heatDutyKcalH || 0), 0);
  const sumW = res.units.reduce((s, u) => s + (u.shaftPowerKW || 0), 0);
  const naiveE = (feedH + sumQ - prodH) * KCALH_TO_KW + sumW;
  const overallStatus =
    res.convergence.overallStatus ?? (res.convergence.converged ? 'converged' : 'failed');
  return {
    plant,
    sheetId,
    converged: res.convergence.converged,
    overallStatus,
    failedUnitCount: res.convergence.failedUnitCount ?? (res.convergence.converged ? 0 : 1),
    warningUnitCount: res.convergence.warningUnitCount ?? 0,
    makeupTotalKgH: res.convergence.makeupTotalKgH ?? (b ? b.makeupInKgH : 0),
    iterations: res.convergence.iterations,
    ms,
    boundaryFeedKgH: Number(feedKgH.toFixed(2)),
    boundaryProductKgH: Number(prodKgH.toFixed(2)),
    rawBoundaryGapKgH: Number((feedKgH - prodKgH).toFixed(2)),
    sumAbsUnitImbalanceKgH: Number(sumAbsUnit.toFixed(2)),
    naiveEnergyResidualKW: Number(naiveE.toFixed(1)),
    massImbalanceKgH: b ? b.massImbalanceKgH : null,
    physicalMassImbalanceKgH: b?.physicalMassImbalanceKgH ?? null,
    makeupInKgH: b ? b.makeupInKgH : null,
    unroutedOutKgH: b ? b.unroutedOutKgH : null,
    unroutedOutletCount: b ? b.unroutedOutlets.length : null,
    makeupInletCount: b ? b.makeupInlets.length : null,
    energyResidualKW: b ? b.energyResidualKW : null,
    energyResidualPct: b ? b.energyResidualPct : null,
    products,
  };
}

function main() {
  const outPath = process.argv[2] ?? path.join('scripts', 'regression', 'latest_run.json');
  const comparePath = process.argv[3];
  const plants: [string, Record<string, SheetLike>][] = [
    ['electrolysis', createInitialHierarchySheets({ syncMasterOnInit: true })],
    ['hcl1A', createInitialHcl1AHierarchySheets({ syncMasterOnInit: true })],
    ['ech', createInitialEchHierarchySheets({ syncMasterOnInit: true })],
    ['cms', createInitialCmsHierarchySheets({ syncMasterOnInit: true })],
    ['mdi', createInitialMdiHierarchySheets({ syncMasterOnInit: true })],
  ];
  const reports: SheetReport[] = [];
  for (const [plant, sheets] of plants) {
    for (const [sheetId, sh] of Object.entries(sheets)) {
      try {
        reports.push(solveSheet(plant, sheetId, sh));
      } catch (err) {
        console.error(`[ERROR] ${plant}/${sheetId}:`, err);
      }
    }
  }

  const fmt = (v: number | null, d = 1) => (v === null || v === undefined ? '-' : v.toFixed(d));
  console.log(
    'plant/sheet'.padEnd(34),
    'status'.padEnd(6),
    'failU'.padStart(5),
    'iter'.padStart(4),
    '   ms',
    ' feedGap(kg/h)',
    ' massImb',
    ' physImb',
    ' makeup(kg/h)',
    ' naiveE kW',
    '   E_res kW',
    ' E_res%'
  );
  for (const r of reports) {
    const stShort =
      r.overallStatus === 'converged'
        ? 'conv'
        : r.overallStatus === 'converged_with_warnings'
          ? 'warn'
          : 'FAIL';
    console.log(
      `${r.plant}/${r.sheetId}`.padEnd(34),
      stShort.padEnd(6),
      String(r.failedUnitCount).padStart(5),
      String(r.iterations).padStart(4),
      String(r.ms).padStart(5),
      fmt(r.rawBoundaryGapKgH).padStart(14),
      fmt(r.massImbalanceKgH).padStart(8),
      fmt(r.physicalMassImbalanceKgH).padStart(8),
      fmt(r.makeupTotalKgH).padStart(13),
      fmt(r.naiveEnergyResidualKW, 0).padStart(10),
      fmt(r.energyResidualKW).padStart(11),
      fmt(r.energyResidualPct, 2).padStart(7)
    );
  }

  const totalSheets = reports.length;
  const convCount = reports.filter(r => r.overallStatus === 'converged').length;
  const warnCount = reports.filter(r => r.overallStatus === 'converged_with_warnings').length;
  const failCount = reports.filter(r => r.overallStatus === 'failed').length;
  console.log(
    `\n전체 ${totalSheets}개 시트 해석 결과: 엄밀수렴 ${convCount}개 · 경고동반 ${warnCount}개 · 미수렴 ${failCount}개`
  );

  if (comparePath && fs.existsSync(comparePath)) {
    const prev: SheetReport[] = JSON.parse(fs.readFileSync(comparePath, 'utf8')).sheets;
    console.log(`\n=== 비교 기준: ${comparePath} ===`);
    for (const r of reports) {
      const p = prev.find(x => x.plant === r.plant && x.sheetId === r.sheetId);
      if (!p) { console.log(`  [NEW] ${r.plant}/${r.sheetId}`); continue; }
      const flags: string[] = [];
      if (p.converged && !r.converged) flags.push('수렴 상실!');
      for (const pr of r.products) {
        const pp = p.products.find(x => x.tag === pr.tag);
        if (pp && Math.abs(pp.kgH - pr.kgH) > Math.max(0.5, 0.005 * Math.abs(pp.kgH))) {
          flags.push(`${pr.tag}: ${pp.kgH} → ${pr.kgH} kg/h`);
        }
      }
      if (flags.length) console.log(`  ${r.plant}/${r.sheetId}: ${flags.join(' | ')}`);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sheets: reports }, null, 2), 'utf8');
  console.log(`\n저장: ${outPath} (${reports.length} sheets)`);
}

main();

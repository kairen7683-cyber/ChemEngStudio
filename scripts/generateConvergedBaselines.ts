/**
 * 전 플랜트(PLANT 02 전해 · PLANT 03 1A 염산 · PLANT 04 바이오 ECH) 19개 계층 시트의
 * 100% 수렴 기본 케이스(Converged Baseline Snapshots)를 사전 계산하여
 * public/data/converged-baselines.json 으로 생성합니다.
 *
 * 실행: npx.cmd tsx scripts/generateConvergedBaselines.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  SIM_COMPS,
  solveFlowsheet,
  type FlowEdgeDef,
  type FlowNodeDef,
  type SimCompKey,
} from '../lib/calculations/flowsheetSolver';
import { getPlantDefaultComponents } from '../lib/calculations/componentCatalog';
import {
  applyMasterBoundaryToSubDefs,
  createInitialHierarchySheets,
  type SheetRuntimeData,
} from '../lib/calculations/fullPlantHierarchy';
import { createInitialHcl1AHierarchySheets } from '../lib/calculations/hcl1AHierarchy';
import { createInitialEchHierarchySheets } from '../lib/calculations/echPlantHierarchy';
import {
  createInitialCmsHierarchySheets,
  syncCmsSubDefsFromMaster,
} from '../lib/calculations/cmsPlantHierarchy';
import {
  createInitialMdiHierarchySheets,
  syncMdiSubDefsFromMaster,
} from '../lib/calculations/mdiPlantHierarchy';

function mergeSheetFeedComponents(defs: FlowNodeDef[], base: SimCompKey[]): SimCompKey[] {
  const set = new Set<SimCompKey>(base);
  for (const d of defs) {
    if (d.params?.feedFlowsKgH) {
      for (const [k, v] of Object.entries(d.params.feedFlowsKgH)) {
        if ((v ?? 0) > 0 && SIM_COMPS.includes(k as SimCompKey)) {
          set.add(k as SimCompKey);
        }
      }
    }
    if (d.params?.makeupSolventComp && SIM_COMPS.includes(d.params.makeupSolventComp)) {
      set.add(d.params.makeupSolventComp);
    }
  }
  return Array.from(set);
}

interface BaselineSheetEntry {
  result: ReturnType<typeof solveFlowsheet>;
  elapsedMs: number;
  runCount: number;
  lastRunTime: string;
  simDefs: FlowNodeDef[];
  flowEdges: FlowEdgeDef[];
}

function solvePlantSheets(
  plantKey: 'electrolysis' | 'hcl1A' | 'ech' | 'cms' | 'mdi',
  workspaceMode: 'electrolyzer_plant' | 'hcl_1a_plant' | 'ech_gte_plant' | 'cms_plant' | 'mdi_plant',
  sheets: Record<string, SheetRuntimeData>
): Record<string, BaselineSheetEntry> {
  const baseComps = getPlantDefaultComponents(workspaceMode);
  const out: Record<string, BaselineSheetEntry> = {};

  // 1) Solve master first, then propagate exact master boundary feeds into subsheets
  const masterSheet = sheets.master;
  if (masterSheet) {
    const t0 = Date.now();
    const comps = mergeSheetFeedComponents(masterSheet.simDefs, baseComps);
    const res = solveFlowsheet(masterSheet.simDefs, masterSheet.flowEdges, {
      propertyMethod: 'AUTO',
      activeComponents: comps,
    });
    const dt = Math.max(1, Date.now() - t0);
    out.master = {
      result: res,
      elapsedMs: dt,
      runCount: 1,
      lastRunTime: '기본 수렴 케이스 (Base Case)',
      simDefs: masterSheet.simDefs,
      flowEdges: masterSheet.flowEdges,
    };

    const failCount = res.convergence.failedUnitCount ?? (res.convergence.converged ? 0 : 1);
    console.log(
      `[${plantKey}] master -> ${res.convergence.overallStatus ?? res.convergence.converged} (iter=${res.convergence.iterations}, fail=${failCount}, ${dt}ms)`
    );
    if (failCount > 0) {
      throw new Error(`Failed unit in ${plantKey}/master: ${JSON.stringify(res.convergence)}`);
    }

    for (const [sid, sh] of Object.entries(sheets)) {
      if (sid === 'master') continue;
      const { syncedDefs } =
        plantKey === 'cms'
          ? syncCmsSubDefsFromMaster(sid, sh.simDefs, masterSheet.flowEdges, res.streams)
          : plantKey === 'mdi'
            ? syncMdiSubDefsFromMaster(sid, sh.simDefs, masterSheet.flowEdges, res.streams)
            : applyMasterBoundaryToSubDefs(sh.simDefs, masterSheet.flowEdges, res.streams);
      sheets[sid] = { ...sh, simDefs: syncedDefs };
    }
  }

  // 2) Solve all subsheets
  for (const [sid, sh] of Object.entries(sheets)) {
    if (sid === 'master') continue;
    const t0 = Date.now();
    const comps = mergeSheetFeedComponents(sh.simDefs, baseComps);
    const res = solveFlowsheet(sh.simDefs, sh.flowEdges, {
      propertyMethod: 'AUTO',
      activeComponents: comps,
    });
    const dt = Math.max(1, Date.now() - t0);
    const failCount = res.convergence.failedUnitCount ?? (res.convergence.converged ? 0 : 1);
    console.log(
      `[${plantKey}] ${sid} -> ${res.convergence.overallStatus ?? res.convergence.converged} (iter=${res.convergence.iterations}, fail=${failCount}, ${dt}ms)`
    );
    if (failCount > 0) {
      throw new Error(`Failed unit in ${plantKey}/${sid}: ${JSON.stringify(res.convergence)}`);
    }
    out[sid] = {
      result: res,
      elapsedMs: dt,
      runCount: 1,
      lastRunTime: '기본 수렴 케이스 (Base Case)',
      simDefs: sh.simDefs,
      flowEdges: sh.flowEdges,
    };
  }

  return out;
}

function main() {
  const plants = {
    electrolysis: solvePlantSheets(
      'electrolysis',
      'electrolyzer_plant',
      createInitialHierarchySheets({ syncMasterOnInit: true })
    ),
    hcl1A: solvePlantSheets(
      'hcl1A',
      'hcl_1a_plant',
      createInitialHcl1AHierarchySheets({ syncMasterOnInit: true })
    ),
    ech: solvePlantSheets(
      'ech',
      'ech_gte_plant',
      createInitialEchHierarchySheets({ syncMasterOnInit: true })
    ),
    cms: solvePlantSheets(
      'cms',
      'cms_plant',
      createInitialCmsHierarchySheets({ syncMasterOnInit: true })
    ),
    mdi: solvePlantSheets(
      'mdi',
      'mdi_plant',
      createInitialMdiHierarchySheets({ syncMasterOnInit: true })
    ),
  };

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    plants,
  };

  const targetDir = path.join(process.cwd(), 'public', 'data');
  fs.mkdirSync(targetDir, { recursive: true });
  const outFile = path.join(targetDir, 'converged-baselines.json');
  const jsonText = JSON.stringify(payload);
  fs.writeFileSync(outFile, jsonText, 'utf8');

  const sizeKB = (Buffer.byteLength(jsonText, 'utf8') / 1024).toFixed(1);
  const totalSheets =
    Object.keys(plants.electrolysis).length +
    Object.keys(plants.hcl1A).length +
    Object.keys(plants.ech).length +
    Object.keys(plants.cms).length +
    Object.keys(plants.mdi).length;
  console.log(`\nDONE: ${totalSheets} converged sheets written to ${outFile} (${sizeKB} KB)`);
}

main();

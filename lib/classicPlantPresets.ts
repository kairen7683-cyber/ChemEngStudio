'use client';

import type { FlowEdgeDef, FlowNodeDef } from '@/lib/calculations/flowsheetSolver';
import {
  createInitialHierarchySheets,
  type SheetRuntimeData,
} from '@/lib/calculations/fullPlantHierarchy';
import { createInitialHcl1AHierarchySheets } from '@/lib/calculations/hcl1AHierarchy';
import { createInitialEchHierarchySheets } from '@/lib/calculations/echPlantHierarchy';
import type { FlowsheetSolveResult } from '@/lib/calculations/flowsheetSolver';

export interface BaselineEntryPayload {
  simDefs: FlowNodeDef[];
  flowEdges: FlowEdgeDef[];
  result: FlowsheetSolveResult;
  elapsedMs: number;
  lastRunTime: string;
  runCount: number;
}

export interface ConvergedBaselineBundle {
  plants: {
    electrolysis?: Record<string, BaselineEntryPayload>;
    hcl1A?: Record<string, BaselineEntryPayload>;
    ech?: Record<string, BaselineEntryPayload>;
  };
}

export interface ClassicPlantPresetOption {
  presetKey: string;
  plantGroup: 'electrolysis' | 'hcl1A' | 'ech';
  plantLabel: string;
  sheetId: string;
  title: string;
}

let cachedBundle: ConvergedBaselineBundle | null = null;

export async function fetchConvergedBaselinesBundle(): Promise<ConvergedBaselineBundle | null> {
  if (cachedBundle) return cachedBundle;
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch('/data/converged-baselines.json', { credentials: 'include' });
    if (!res.ok) return null;
    const data = (await res.json()) as ConvergedBaselineBundle;
    if (data && data.plants) {
      cachedBundle = data;
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function getPlantSheetsByGroup(
  group: 'electrolysis' | 'hcl1A' | 'ech'
): Record<string, SheetRuntimeData> {
  if (group === 'hcl1A') return createInitialHcl1AHierarchySheets({ syncMasterOnInit: true });
  if (group === 'ech') return createInitialEchHierarchySheets({ syncMasterOnInit: true });
  return createInitialHierarchySheets({ syncMasterOnInit: true });
}

export function getClassicPlantPresetOptions(): ClassicPlantPresetOption[] {
  const groups: Array<{
    group: 'electrolysis' | 'hcl1A' | 'ech';
    plantLabel: string;
  }> = [
    { group: 'electrolysis', plantLabel: 'PLANT 01 · 전해공장' },
    { group: 'hcl1A', plantLabel: 'PLANT 02 · 염산합성/정제' },
    { group: 'ech', plantLabel: 'PLANT 03 · ECH 공정' },
  ];
  const out: ClassicPlantPresetOption[] = [];
  for (const g of groups) {
    const sheets = getPlantSheetsByGroup(g.group);
    for (const [sid, sh] of Object.entries(sheets)) {
      out.push({
        presetKey: `${g.group}:${sid}`,
        plantGroup: g.group,
        plantLabel: g.plantLabel,
        sheetId: sid,
        title: sid === 'master' ? `★ 통합 마스터 (${sh.title})` : sh.title,
      });
    }
  }
  return out;
}

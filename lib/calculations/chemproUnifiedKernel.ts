/**
 * ChemEng Studio Pro — Unified Equipment Engineering Kernel
 * ---------------------------------------------------------------------------
 * Single source of truth for all 6 ChemPro equipment calculators + HX Auto-DOF
 * energy balance, powered 100% by TypeScript Master Engines in `lib/calculations/`:
 *   - Pump: `lib/calculations/pumpDesign.ts` (Churchill 1977 + 5-iter ANSI/HI 9.6.7 + API 610 + Stepanoff + MCSF)
 *   - Heat Exchanger: `lib/calculations/chemproHxAdapter.ts` -> `lib/calculations/shellTubeRating.ts` (Bell-Delaware + Shah + Gungor-Winterton + Connors FIV + 4-DOF EB + PHE)
 *   - Distillation & Absorption Column: `lib/calculations/chemproColumnAdapter.ts` (NRTL VLE + FUG + rigorous binary NRTL MESH + Fair tray + Billet-Schultes HETP) & `lib/calculations/absorptionTowerDesign.ts` (Eckert GPDC + Billet-Schultes + Onda HTU_OG + Colburn N_OG)
 *   - Piping: `lib/calculations/pipingDesign.ts` -> `lib/calculations/twoPhaseHydraulics.ts` (Churchill + compressible Mach + Friedel/LM/Taitel-Dukler 2-phase + API RP 14E + max_flow bisection)
 *   - Pressure Vessel / KO Drum: `lib/calculations/vesselDesign.ts` -> `lib/calculations/mechanicalDesign.ts` (Souders-Brown + GPSA + ASME Sec. VIII Div. 1 UG-27/UG-28/UG-32)
 *   - Pressure Safety Valve (PSV): `lib/calculations/psvDesign.ts` (API 521 fire/blocked/tube/thermal + API 520 critical/subcritical/steam Kn/Ksh + iterative liquid Kv + API 526 D~T)
 */

import { solvePump, type PumpSolverInput, type PumpSolverResult } from './pumpDesign';
import {
  solveHXEnergyBalance,
  solveHX,
  type HXEnergyBalanceInput,
  type HXEnergyBalanceResult,
  type ChemproHXInput,
  type ChemproHXResult,
} from './chemproHxAdapter';
import { solveAbsorptionColumn, type AbsorptionColumnInput, type AbsorptionColumnResult } from './absorptionTowerDesign';
import { solveDistillationColumn, type ChemproColumnInput, type ChemproDistillationResult } from './chemproColumnAdapter';
import { solvePiping, type PipingSolverInput, type PipingSolverResult } from './pipingDesign';
import { solveVessel, type VesselDesignInput, type VesselDesignResult } from './vesselDesign';
import { solvePSV, type PSVDesignInput, type PSVDesignResult } from './psvDesign';

export type UnifiedColumnInput = AbsorptionColumnInput | ChemproColumnInput;
export type UnifiedColumnResult = AbsorptionColumnResult | ChemproDistillationResult;

export function solveColumn(
  inp: UnifiedColumnInput | Record<string, any> = {},
  mode: 'quick' | 'rigorous' = 'quick'
): UnifiedColumnResult {
  const rawMode = String(
    (inp as any)?.col_mode ?? (inp as any)?.colMode ?? (inp as any)?.columnType ?? 'absorption'
  ).toLowerCase();
  if (rawMode === 'distillation' || rawMode === 'distill' || rawMode === 'fractionation') {
    return solveDistillationColumn(inp as ChemproColumnInput, mode);
  }
  return solveAbsorptionColumn(inp as AbsorptionColumnInput, mode);
}

export interface ChemEngUnifiedKernel {
  version: string;
  solvePump: (inp: PumpSolverInput, mode?: 'quick' | 'rigorous') => PumpSolverResult;
  solveHXEnergyBalance: (inp: HXEnergyBalanceInput) => HXEnergyBalanceResult;
  solveHX: (inp: ChemproHXInput, mode?: 'quick' | 'rigorous') => ChemproHXResult;
  solveColumn: typeof solveColumn;
  solvePiping: (inp: PipingSolverInput, mode?: 'quick' | 'rigorous') => PipingSolverResult;
  solveVessel: (inp: VesselDesignInput, mode?: 'quick' | 'rigorous') => VesselDesignResult;
  solvePSV: (inp: PSVDesignInput, mode?: 'quick' | 'rigorous') => PSVDesignResult;
}

export const CHEMPRO_UNIFIED_KERNEL_VERSION = '2026.11.15-unified-ts';

export const unifiedKernel: ChemEngUnifiedKernel = {
  version: CHEMPRO_UNIFIED_KERNEL_VERSION,
  solvePump,
  solveHXEnergyBalance,
  solveHX,
  solveColumn,
  solvePiping,
  solveVessel,
  solvePSV,
};

export function registerUnifiedKernel(): ChemEngUnifiedKernel {
  const g = globalThis as Record<string, any>;
  g.__ChemEngUnifiedKernel = unifiedKernel;
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, any>).__ChemEngUnifiedKernel = unifiedKernel;
  }
  return unifiedKernel;
}

registerUnifiedKernel();

export {
  solvePump,
  solveHXEnergyBalance,
  solveHX,
  solveAbsorptionColumn,
  solveDistillationColumn,
  solvePiping,
  solveVessel,
  solvePSV,
};

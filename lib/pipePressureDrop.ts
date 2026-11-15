// =====================================================================
// 배관 차압 계산 엔진 Facade (Pipe Pressure Drop Engine)
// Delegates all hydraulic calculations to lib/calculations/pipingDesign.ts
// (Churchill 1977 + Crane TP-410 + Compressible Gas + 2-Phase Superset)
// =====================================================================

import type { FluidProps } from './physicalProperties';
import {
  FITTING_TYPES,
  calcChurchillFrictionFactor,
  calcFlowVelocity,
  calcMultiSegmentPressureDrop,
  calcPipeArea,
  calcReynoldsNumber,
  classifyTaitelDuklerRegime,
  solvePiping,
  type FittingType,
  type PipeCalcResult,
  type PipeFitting,
  type PipeSegment,
  type PipeSegmentResult,
  type PipingFlowMode,
  type PipingDofMode,
  type PipingIterationRow,
  type PipingSolverCandidate,
  type PipingSolverInput,
  type PipingSolverResult,
  type PipingWarning,
  type TaitelDuklerRegime,
  type TwoPhaseFlowDetails,
} from './calculations/pipingDesign';

export {
  FITTING_TYPES,
  calcChurchillFrictionFactor,
  calcMultiSegmentPressureDrop,
  classifyTaitelDuklerRegime,
  solvePiping,
  type FittingType,
  type PipeCalcResult,
  type PipeFitting,
  type PipeSegment,
  type PipeSegmentResult,
  type PipingFlowMode,
  type PipingDofMode,
  type PipingIterationRow,
  type PipingSolverCandidate,
  type PipingSolverInput,
  type PipingSolverResult,
  type PipingWarning,
  type TaitelDuklerRegime,
  type TwoPhaseFlowDetails,
};

// ─────────────────────────────────────────────────────────────────────
// Churchill (1977) 마찰계수 상관식 — 층류/전이/난류 통합
// ─────────────────────────────────────────────────────────────────────
export function churchillFrictionFactor(Re: number, eps: number, D: number): number {
  if (Re < 1) return 64;
  return calcChurchillFrictionFactor(Re, eps, D);
}

/** 레이놀즈수 */
export function reynoldsNumber(rho: number, v: number, D_m: number, mu_mPas: number): number {
  return calcReynoldsNumber(rho, v, D_m, mu_mPas);
}

/** 단면적 (m²) */
export function pipeArea(D_mm: number): number {
  return calcPipeArea(D_mm);
}

/** 유속 (m/s) */
export function flowVelocity(flowRate_m3h: number, D_mm: number): number {
  return calcFlowVelocity(flowRate_m3h, D_mm);
}

// ─────────────────────────────────────────────────────────────────────
// 배관 차압 계산 메인 함수
// ─────────────────────────────────────────────────────────────────────
export function calcPipePressureDrop(
  fluid: FluidProps,
  T_C: number,
  flowRate_m3h: number,
  segments: PipeSegment[],
): PipeCalcResult {
  return calcMultiSegmentPressureDrop(fluid, T_C, flowRate_m3h, segments);
}

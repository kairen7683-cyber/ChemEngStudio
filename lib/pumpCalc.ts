// =====================================================================
// 원심 펌프 수력학 및 API 610 / HI 9.6.7 설계 엔진 Facade
// Delegates all calculations to lib/calculations/pumpDesign.ts
// (Churchill 1977 + ANSI/HI 9.6.7 + API 610 POR/AOR & MCSF/MCTF Superset)
// =====================================================================

import {
  calcChurchillFrictionFactor,
  calcHIViscosityCorrection,
  calcLegacyPumpCompatibility,
  selectMotorSize,
  selectMotorSizeAPI610,
  solveHIViscosityLoop,
  solvePump,
  type PumpCurvePoint,
  type PumpCurveSet,
  type PumpInputs,
  type PumpOperatingRange,
  type PumpResults,
  type PumpSolverInput,
  type PumpSolverIteration,
  type PumpSolverResult,
  type PumpSolverWarning,
  type ThomaCavitationInfo,
} from './calculations/pumpDesign';

export {
  calcChurchillFrictionFactor,
  calcHIViscosityCorrection,
  calcLegacyPumpCompatibility,
  selectMotorSize,
  selectMotorSizeAPI610,
  solveHIViscosityLoop,
  solvePump,
  type PumpCurvePoint,
  type PumpCurveSet,
  type PumpInputs,
  type PumpOperatingRange,
  type PumpResults,
  type PumpSolverInput,
  type PumpSolverIteration,
  type PumpSolverResult,
  type PumpSolverWarning,
  type ThomaCavitationInfo,
};

// ─────────────────────────────────────────────────────────────────────
// 펌프 설계 계산 메인 함수 (Strict-Superset Delegation)
// ─────────────────────────────────────────────────────────────────────
export function calcPump(inputs: PumpInputs): PumpResults {
  return calcLegacyPumpCompatibility(inputs);
}

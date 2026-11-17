/**
 * Flowsheet Simultaneous Multi-Tear Broyden Accelerator,
 * Feedback Controller (Design Spec / Adjust), and Multi-Variable Sensitivity Engine
 *
 * Pure mathematical & thermodynamic numerical methods — zero heuristic masking,
 * zero commercial trademarks.
 */

import {
  SIM_COMPS,
  COMP_META,
  emptySimFlows,
  solveFlowsheet,
  type SimCompKey,
  type FlowNodeDef,
  type FlowEdgeDef,
  type SolvedStream,
  type SolvedUnitResult,
  type VapRatio,
} from './flowsheetSolver';
import type { DistillColumnParams } from './rigorousDistillation';
import type { SimPropertyMethod } from './componentCatalog';

export interface FlowsheetSolveOptsCompat {
  propertyMethod?: SimPropertyMethod;
  activeComponents?: SimCompKey[];
  tearMethod?: 'auto' | 'wegstein' | 'broyden' | 'direct';
  relTolerance?: number;
  maxIterations?: number;
}

export type FlowsheetSolveResultCompat = ReturnType<typeof solveFlowsheet>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Simultaneous Multi-Tear Good Broyden Quasi-Newton Accelerator
// ─────────────────────────────────────────────────────────────────────────────

export interface BroydenTearState {
  flows: Record<SimCompKey, number>;
  tempC: number;
  pressKgcm2g: number;
  forcedPhase?: 'L' | 'G' | 'L/G';
  vapRatio?: VapRatio;
}

export interface BroydenAcceleratorOptions {
  /** Initial inverse Jacobian diagonal scalar H_0 = alpha0 * I (default 0.65) */
  alpha0?: number;
  /** Scaled trust-region radius multiplier (default 4.0) */
  trustRadius?: number;
  /** Residual spike threshold triggering automatic H_k reset to alpha0 * I (default 3.0) */
  spikeResetFactor?: number;
  /** Minimum flow threshold (kg/h) to include a species in the active tear vector */
  activeFlowThresholdKgH?: number;
}

export interface BroydenStepDiagnostics {
  dimension: number;
  scaledResidualNorm: number;
  rawResidualNorm: number;
  stepType: 'direct_warmup' | 'broyden_init' | 'broyden' | 'broyden_reset';
  dampingFactor: number;
  resetCount: number;
  activeLabels: string[];
  diagonalSummary: number[];
}

interface ActiveTearVarMeta {
  key: string;
  edgeId: string;
  kind: 'flow' | 'temp';
  comp?: SimCompKey;
  scale: number;
}

function vecNorm2(v: number[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

function makeScaledIdentity(n: number, diagVal: number): number[][] {
  const mat: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    row[i] = diagVal;
    mat[i] = row;
  }
  return mat;
}

/**
 * Simultaneous Multi-Tear Good Broyden Quasi-Newton Accelerator.
 *
 * Flattens active tear variables (per-component mass flows + stream temperature)
 * across all recycle tear streams into x_k in R^m with residual r_k = g(x_k) - x_k.
 *
 * Writing B_k ≈ (∂r/∂x)^{-1} = (J_g - I)^{-1} with B_0 = -alpha_0 I (equivalently
 * H_k = -B_k ≈ (I - J_g)^{-1} with H_0 = +alpha_0 I, alpha_0 = 0.65), the Good Broyden
 * Sherman-Morrison rank-1 inverse-Jacobian update is:
 *   B_{k+1} = B_k + ((Δx_k - B_k Δr_k) Δx_k^T B_k) / (Δx_k^T B_k Δr_k)
 * and the quasi-Newton step is x_{k+1} = x_k - B_{k+1} r_k = x_k + H_{k+1} r_k.
 */
export class BroydenTearAccelerator {
  private readonly alpha0: number;
  private readonly trustRadius: number;
  private readonly spikeResetFactor: number;
  private readonly activeFlowThreshold: number;

  /** Inverse Jacobian H_k = -B_k ≈ (I - J_g)^{-1}, initialized to H_0 = alpha0 * I */
  private H: number[][] | null = null;
  private prevScaledX: number[] | null = null;
  private prevScaledR: number[] | null = null;
  private prevResNorm: number = Infinity;
  private activeVars: ActiveTearVarMeta[] = [];
  private activeKeySignature: string = '';
  private resetCount = 0;

  constructor(opts: BroydenAcceleratorOptions = {}) {
    this.alpha0 = opts.alpha0 ?? 0.65;
    this.trustRadius = opts.trustRadius ?? 60.0;
    this.spikeResetFactor = opts.spikeResetFactor ?? 3.0;
    this.activeFlowThreshold = opts.activeFlowThresholdKgH ?? 1e-8;
  }

  public reset(): void {
    this.H = null;
    this.prevScaledX = null;
    this.prevScaledR = null;
    this.prevResNorm = Infinity;
    this.activeVars = [];
    this.activeKeySignature = '';
  }

  public getResetCount(): number {
    return this.resetCount;
  }

  /** Returns H_k (with H_0 = alpha_0 * I, step Δx = +H_k r_k) */
  public getInverseJacobian(): number[][] {
    if (!this.H) return [];
    return this.H.map(row => [...row]);
  }

  /** Returns B_k = -H_k (satisfying B_{k+1} = B_k + ((Δx - B_k Δr) Δx^T B_k)/(Δx^T B_k Δr)) */
  public getResidualInverseJacobian(): number[][] {
    if (!this.H) return [];
    return this.H.map(row => row.map(v => -v));
  }

  public getActiveLabels(): string[] {
    return this.activeVars.map(v => v.key);
  }

  /**
   * Direct vector-level Good Broyden step on x_k, g_k in R^m.
   */
  public stepVector(
    x: number[],
    g: number[],
    opts?: {
      scales?: number[];
      nonNegativeMask?: boolean[];
      tempMask?: boolean[];
    }
  ): {
    nextX: number[];
    stepType: 'broyden_init' | 'broyden' | 'broyden_reset';
    scaledResidualNorm: number;
    rawResidualNorm: number;
    dampingFactor: number;
    resetCount: number;
  } {
    const m = x.length;
    if (m === 0) {
      return {
        nextX: [],
        stepType: 'broyden_init',
        scaledResidualNorm: 0,
        rawResidualNorm: 0,
        dampingFactor: 1,
        resetCount: this.resetCount,
      };
    }

    const scales = opts?.scales ?? x.map((xv, i) => Math.max(Math.abs(xv), Math.abs(g[i]), 1.0));
    const nonNeg = opts?.nonNegativeMask ?? new Array<boolean>(m).fill(true);
    const tempMask = opts?.tempMask ?? new Array<boolean>(m).fill(false);

    const rawR = new Array<number>(m);
    const xHat = new Array<number>(m);
    const rHat = new Array<number>(m);
    for (let i = 0; i < m; i++) {
      const s = Math.max(1e-9, scales[i]);
      rawR[i] = g[i] - x[i];
      xHat[i] = x[i] / s;
      rHat[i] = rawR[i] / s;
    }

    const resNorm = vecNorm2(rHat);
    const rawNorm = vecNorm2(rawR);
    let stepType: 'broyden_init' | 'broyden' | 'broyden_reset' = 'broyden';
    let preDamp = 1.0;

    if (!this.H || !this.prevScaledX || !this.prevScaledR || this.H.length !== m) {
      this.H = makeScaledIdentity(m, this.alpha0);
      stepType = 'broyden_init';
    } else if (
      Number.isFinite(this.prevResNorm) &&
      this.prevResNorm > 1e-12 &&
      resNorm > this.spikeResetFactor * this.prevResNorm
    ) {
      // Automatic Jacobian reset on > 3x residual norm spike
      this.H = makeScaledIdentity(m, this.alpha0);
      this.resetCount += 1;
      stepType = 'broyden_reset';
      preDamp = 0.6;
    } else {
      // Good Broyden Sherman-Morrison rank-1 update in B_k = -H_k:
      //   B_{k+1} = B_k + ((Δx - B_k Δr) Δx^T B_k) / (Δx^T B_k Δr)
      // Since B_k = -H_k, let Δf = -Δr:
      //   H_{k+1} = H_k + ((Δx - H_k Δf) Δx^T H_k) / (Δx^T H_k Δf)
      //   and safeguard |Δx^T B_k Δr| = |Δx^T H_k Δr| > 1e-12 ||Δx|| ||Δr||
      const dx = new Array<number>(m);
      const dr = new Array<number>(m);
      const df = new Array<number>(m);
      for (let i = 0; i < m; i++) {
        dx[i] = xHat[i] - this.prevScaledX[i];
        dr[i] = rHat[i] - this.prevScaledR[i];
        df[i] = -dr[i];
      }
      const normDx = vecNorm2(dx);
      const normDr = vecNorm2(dr);

      if (normDx > 1e-14 && normDr > 1e-14) {
        const H = this.H;
        const Hdf = new Array<number>(m).fill(0);
        for (let i = 0; i < m; i++) {
          let s = 0;
          const row = H[i];
          for (let j = 0; j < m; j++) s += row[j] * df[j];
          Hdf[i] = s;
        }
        const dxTH = new Array<number>(m).fill(0);
        for (let i = 0; i < m; i++) {
          const dxi = dx[i];
          if (dxi === 0) continue;
          const row = H[i];
          for (let j = 0; j < m; j++) dxTH[j] += dxi * row[j];
        }
        // Note: dx^T H df = -dx^T H dr = dx^T B dr
        let denom = 0;
        for (let i = 0; i < m; i++) denom += dx[i] * Hdf[i];

        const minDenom = 1e-12 * normDx * normDr;
        if (Math.abs(denom) > minDenom && Number.isFinite(denom)) {
          for (let i = 0; i < m; i++) {
            const coeff = (dx[i] - Hdf[i]) / denom;
            if (coeff === 0) continue;
            const row = H[i];
            for (let j = 0; j < m; j++) {
              row[j] += coeff * dxTH[j];
            }
          }
        }
      }
    }

    // Raw quasi-Newton step in scaled coordinates: sHat = H * rHat
    const Hcurr = this.H;
    const sHat = new Array<number>(m).fill(0);
    for (let i = 0; i < m; i++) {
      let acc = 0;
      const row = Hcurr[i];
      for (let j = 0; j < m; j++) acc += row[j] * rHat[j];
      sHat[i] = preDamp * acc;
    }

    // Trust-region uniform step clamping (allows high-recycle Newton amplification up to trustRadius)
    let tau = 1.0;
    const stepNorm = vecNorm2(sHat);
    const maxStepNorm = Math.max(this.trustRadius, 25.0 * resNorm);
    if (stepNorm > maxStepNorm && stepNorm > 1e-12) {
      tau = Math.min(tau, maxStepNorm / stepNorm);
    }

    for (let i = 0; i < m; i++) {
      const deltaRaw = sHat[i] * scales[i];
      if (!Number.isFinite(deltaRaw)) {
        tau = 0;
        break;
      }
      if (tempMask[i]) {
        const maxTempJump = 45.0;
        if (Math.abs(deltaRaw) * tau > maxTempJump) {
          tau = Math.min(tau, maxTempJump / Math.abs(deltaRaw));
        }
      } else if (nonNeg[i]) {
        const refMag = Math.max(Math.abs(x[i]), Math.abs(g[i]), 1.0);
        const maxFlowJump = Math.max(15.0 * refMag, 250.0);
        if (Math.abs(deltaRaw) * tau > maxFlowJump) {
          tau = Math.min(tau, maxFlowJump / Math.abs(deltaRaw));
        }
      }
    }

    const nextX = new Array<number>(m);
    for (let i = 0; i < m; i++) {
      const candidate = tau > 0 ? x[i] + tau * sHat[i] * scales[i] : g[i];
      if (tempMask[i]) {
        nextX[i] = Number.isFinite(candidate) ? Math.max(-160, Math.min(650, candidate)) : g[i];
      } else if (nonNeg[i]) {
        nextX[i] = Number.isFinite(candidate) ? Math.max(0, candidate) : Math.max(0, g[i]);
      } else {
        nextX[i] = Number.isFinite(candidate) ? candidate : g[i];
      }
    }

    this.prevScaledX = xHat;
    this.prevScaledR = rHat;
    this.prevResNorm = resNorm;

    return {
      nextX,
      stepType,
      scaledResidualNorm: resNorm,
      rawResidualNorm: rawNorm,
      dampingFactor: tau * preDamp,
      resetCount: this.resetCount,
    };
  }

  /**
   * Simultaneous multi-tear stream update across all recycle tear edges.
   */
  public stepStreams(
    tearEdgeIds: string[],
    currentStates: Map<string, BroydenTearState>,
    computedGStates: Map<string, BroydenTearState>
  ): {
    nextStates: Map<string, BroydenTearState>;
    stepLabel: string;
    diagnostics: BroydenStepDiagnostics;
  } {
    const nextStates = new Map<string, BroydenTearState>();
    if (tearEdgeIds.length === 0) {
      return {
        nextStates,
        stepLabel: 'direct',
        diagnostics: {
          dimension: 0,
          scaledResidualNorm: 0,
          rawResidualNorm: 0,
          stepType: 'direct_warmup',
          dampingFactor: 1,
          resetCount: this.resetCount,
          activeLabels: [],
          diagonalSummary: [],
        },
      };
    }

    // Check if any tear stream is still at cold-start zero flow while g(x) just populated it
    let anyColdStreamJustActivated = false;
    let totalXMassAll = 0;
    for (const teId of tearEdgeIds) {
      const xc = currentStates.get(teId)!;
      const gc = computedGStates.get(teId) ?? xc;
      let xm = 0;
      let gm = 0;
      for (const k of SIM_COMPS) {
        xm += Math.max(0, xc.flows[k] || 0);
        gm += Math.max(0, gc.flows[k] || 0);
      }
      totalXMassAll += xm;
      if (xm < 1e-8 && gm > 1e-6) {
        anyColdStreamJustActivated = true;
      }
    }

    // Cold-start pass (iter 0, or downstream loop receiving flow for first time):
    // initialize newly active tear streams directly to g(x) so scales & compositions are physical
    if (totalXMassAll < 1e-8 || anyColdStreamJustActivated) {
      for (const teId of tearEdgeIds) {
        const xc = currentStates.get(teId)!;
        const gc = computedGStates.get(teId) ?? xc;
        const nf = emptySimFlows();
        for (const k of SIM_COMPS) {
          nf[k] = Math.max(0, gc.flows[k] || 0);
        }
        nextStates.set(teId, {
          flows: nf,
          tempC: Number.isFinite(gc.tempC) ? gc.tempC : xc.tempC,
          pressKgcm2g: gc.pressKgcm2g,
          forcedPhase: gc.forcedPhase,
          vapRatio: gc.vapRatio,
        });
      }
      // Reset Jacobian history so next pass begins Broyden cleanly from warm state
      this.H = null;
      this.prevScaledX = null;
      this.prevScaledR = null;
      this.prevResNorm = Infinity;
      return {
        nextStates,
        stepLabel: 'direct',
        diagnostics: {
          dimension: 0,
          scaledResidualNorm: 0,
          rawResidualNorm: 0,
          stepType: 'direct_warmup',
          dampingFactor: 1,
          resetCount: this.resetCount,
          activeLabels: [],
          diagonalSummary: [],
        },
      };
    }

    // Discover active variables across all tear streams (monotonic union with existing activeVars)
    const prevScaleByKey = new Map<string, number>();
    for (const v of this.activeVars) prevScaleByKey.set(v.key, v.scale);

    const nextActiveVars: ActiveTearVarMeta[] = [];
    for (const teId of tearEdgeIds) {
      const xc = currentStates.get(teId)!;
      const gc = computedGStates.get(teId) ?? xc;
      let streamMass = 0;
      for (const k of SIM_COMPS) {
        const xv = Math.max(0, xc.flows[k] || 0);
        const gv = Math.max(0, gc.flows[k] || 0);
        streamMass += Math.max(xv, gv);
        const key = `${teId}:${k}`;
        if (xv > this.activeFlowThreshold || gv > this.activeFlowThreshold || prevScaleByKey.has(key)) {
          const fixedScale = prevScaleByKey.get(key) ?? Math.max(xv, gv, 1.0);
          nextActiveVars.push({
            key,
            edgeId: teId,
            kind: 'flow',
            comp: k,
            scale: fixedScale,
          });
        }
      }
      if (streamMass > 1e-6 || prevScaleByKey.has(`${teId}:TEMP`)) {
        const tKey = `${teId}:TEMP`;
        nextActiveVars.push({
          key: tKey,
          edgeId: teId,
          kind: 'temp',
          scale: prevScaleByKey.get(tKey) ?? 50.0,
        });
      }
    }

    const sig = nextActiveVars.map(v => v.key).join('|');
    if (sig !== this.activeKeySignature) {
      this.activeVars = nextActiveVars;
      this.activeKeySignature = sig;
      this.H = makeScaledIdentity(nextActiveVars.length, this.alpha0);
      this.prevScaledX = null;
      this.prevScaledR = null;
      this.prevResNorm = Infinity;
    }

    const m = this.activeVars.length;
    const xVec = new Array<number>(m);
    const gVec = new Array<number>(m);
    const scales = new Array<number>(m);
    const nonNeg = new Array<boolean>(m);
    const tempMask = new Array<boolean>(m);

    for (let i = 0; i < m; i++) {
      const meta = this.activeVars[i];
      const xc = currentStates.get(meta.edgeId)!;
      const gc = computedGStates.get(meta.edgeId) ?? xc;
      scales[i] = meta.scale;
      if (meta.kind === 'flow') {
        xVec[i] = Math.max(0, xc.flows[meta.comp!] || 0);
        gVec[i] = Math.max(0, gc.flows[meta.comp!] || 0);
        nonNeg[i] = true;
        tempMask[i] = false;
      } else {
        xVec[i] = xc.tempC;
        gVec[i] = gc.tempC;
        nonNeg[i] = false;
        tempMask[i] = true;
      }
    }

    const stepRes = this.stepVector(xVec, gVec, {
      scales,
      nonNegativeMask: nonNeg,
      tempMask,
    });

    // Scatter flattened vector back into per-edge stream states
    const updatedByEdge = new Map<string, { flows: Record<SimCompKey, number>; tempC: number }>();
    for (const teId of tearEdgeIds) {
      const gc = computedGStates.get(teId) ?? currentStates.get(teId)!;
      const baseFlows = emptySimFlows();
      for (const k of SIM_COMPS) baseFlows[k] = Math.max(0, gc.flows[k] || 0);
      updatedByEdge.set(teId, { flows: baseFlows, tempC: gc.tempC });
    }
    for (let i = 0; i < m; i++) {
      const meta = this.activeVars[i];
      const entry = updatedByEdge.get(meta.edgeId)!;
      if (meta.kind === 'flow') {
        entry.flows[meta.comp!] = Math.max(0, stepRes.nextX[i]);
      } else {
        entry.tempC = stepRes.nextX[i];
      }
    }
    for (const teId of tearEdgeIds) {
      const gc = computedGStates.get(teId) ?? currentStates.get(teId)!;
      const up = updatedByEdge.get(teId)!;
      nextStates.set(teId, {
        flows: up.flows,
        tempC: up.tempC,
        pressKgcm2g: gc.pressKgcm2g,
        forcedPhase: gc.forcedPhase,
        vapRatio: gc.vapRatio,
      });
    }

    const diagArr = this.H ? this.H.map((row, idx) => Number((row[idx] ?? 0).toFixed(4))) : [];
    const stepLabel =
      stepRes.stepType === 'broyden_reset'
        ? 'broyden(reset)'
        : stepRes.stepType === 'broyden_init'
          ? 'broyden(init)'
          : 'broyden';

    return {
      nextStates,
      stepLabel,
      diagnostics: {
        dimension: m,
        scaledResidualNorm: stepRes.scaledResidualNorm,
        rawResidualNorm: stepRes.rawResidualNorm,
        stepType: stepRes.stepType,
        dampingFactor: stepRes.dampingFactor,
        resetCount: stepRes.resetCount,
        activeLabels: this.activeVars.map(v => v.key),
        diagonalSummary: diagArr,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Design Spec (Feedback Adjust Controller) Types & Evaluators
// ─────────────────────────────────────────────────────────────────────────────

export type DesignSpecStreamMetric =
  | 'comp_wt_pct'
  | 'comp_mol_pct'
  | 'comp_flow_kgh'
  | 'total_flow_kgh'
  | 'temp_c'
  | 'vapor_frac'
  | 'comp_recovery_pct';

export type DesignSpecUnitMetric =
  | 'heat_duty_mcalh'
  | 'shaft_power_kw'
  | 'outlet_mass_kgh';

export type ManipulatedParamKey =
  | 'feed_comp_kgh'
  | 'feed_total_scale'
  | 'operTempC'
  | 'operPressKgcm2g'
  | 'splitRatioTop'
  | 'makeupSolventKgH'
  | 'specifiedDutyMcalH'
  | 'conversion'
  | 'refluxRatio'
  | 'distillateRateKgH'
  | 'sideCutRateKgH'
  | 'sideCutRatioSF'
  | 'sideCutStage'
  | 'outletPressKgcm2g';

export const DESIGN_SPEC_STREAM_METRIC_LABELS: Record<
  DesignSpecStreamMetric,
  { labelKo: string; unit: string; needsComp: boolean }
> = {
  comp_wt_pct: { labelKo: '성분 질량농도 (wt%)', unit: 'wt%', needsComp: true },
  comp_mol_pct: { labelKo: '성분 몰농도 (mol%)', unit: 'mol%', needsComp: true },
  comp_flow_kgh: { labelKo: '성분 질량유량 (kg/h)', unit: 'kg/h', needsComp: true },
  total_flow_kgh: { labelKo: '총 질량유량 (kg/h)', unit: 'kg/h', needsComp: false },
  temp_c: { labelKo: '스트림 온도 (°C)', unit: '°C', needsComp: false },
  vapor_frac: { labelKo: '기상 분율 (Vapor Frac)', unit: '-', needsComp: false },
  comp_recovery_pct: { labelKo: '회수율 (Recovery %)', unit: '%', needsComp: false },
};

export const DESIGN_SPEC_UNIT_METRIC_LABELS: Record<
  DesignSpecUnitMetric,
  { labelKo: string; unit: string }
> = {
  heat_duty_mcalh: { labelKo: '장치 열부하 (Mcal/h)', unit: 'Mcal/h' },
  shaft_power_kw: { labelKo: '축동력 / 소비전력 (kW)', unit: 'kW' },
  outlet_mass_kgh: { labelKo: '장치 총 유출유량 (kg/h)', unit: 'kg/h' },
};

export const MANIPULATED_PARAM_LABELS: Record<
  ManipulatedParamKey,
  { labelKo: string; unit: string; needsComp?: boolean }
> = {
  feed_comp_kgh: { labelKo: '원료 성분 유량 (kg/h)', unit: 'kg/h', needsComp: true },
  feed_total_scale: { labelKo: '원료 총유량 배율 (Scale)', unit: '×배', needsComp: false },
  operTempC: { labelKo: '운전 온도 (°C)', unit: '°C', needsComp: false },
  operPressKgcm2g: { labelKo: '운전 압력 (kgf/cm²G)', unit: 'kgf/cm²G', needsComp: false },
  splitRatioTop: { labelKo: '분기비 / 퍼지율 (0~1)', unit: '-', needsComp: false },
  makeupSolventKgH: { labelKo: '보충 용매 유량 (kg/h)', unit: 'kg/h', needsComp: false },
  specifiedDutyMcalH: { labelKo: '지정 열부하 (Mcal/h)', unit: 'Mcal/h', needsComp: false },
  conversion: { labelKo: '반응 전화율 (0~1)', unit: '-', needsComp: false },
  refluxRatio: { labelKo: '증류 환류비 (Reflux Ratio)', unit: '-', needsComp: false },
  distillateRateKgH: { labelKo: '탑정 유출량 D (kg/h)', unit: 'kg/h', needsComp: false },
  sideCutRateKgH: { labelKo: '증류 사이드컷 유량 S (kg/h)', unit: 'kg/h', needsComp: false },
  sideCutRatioSF: { labelKo: '증류 사이드컷 분배비 S/F (0~0.85)', unit: '-', needsComp: false },
  sideCutStage: { labelKo: '증류 사이드컷 인출단 N_sc (단)', unit: '단', needsComp: false },
  outletPressKgcm2g: { labelKo: '토출/감압 출구압력 (kgf/cm²G)', unit: 'kgf/cm²G', needsComp: false },
};

export interface DesignSpecMeasuredTarget {
  streamEdgeId?: string;
  metric?: DesignSpecStreamMetric;
  comp?: SimCompKey;
  refFeedNodeId?: string;
  unitNodeId?: string;
  unitMetric?: DesignSpecUnitMetric;
  targetValue: number;
  tolerance?: number;
}

export interface DesignSpecManipulatedVar {
  nodeId: string;
  paramKey: ManipulatedParamKey;
  comp?: SimCompKey;
  minBound: number;
  maxBound: number;
  initialGuess?: number;
}

export interface DesignSpecDef {
  id: string;
  name: string;
  enabled: boolean;
  measured: DesignSpecMeasuredTarget;
  manipulated: DesignSpecManipulatedVar;
}

export interface DesignSpecIterationEntry {
  iter: number;
  manipulatedValue: number;
  achievedValue: number;
  error: number;
  flowsheetConverged: boolean;
}

export interface SingleDesignSpecResult {
  specId: string;
  name: string;
  converged: boolean;
  iterations: number;
  targetValue: number;
  achievedValue: number;
  residualError: number;
  tolerance: number;
  finalManipulatedValue: number;
  history: DesignSpecIterationEntry[];
  message: string;
}

export interface FlowsheetDesignSpecSolveResult {
  converged: boolean;
  solverMethodUsed: 'none' | 'secant_brent_1d' | 'damped_broyden_nd';
  outerIterations: number;
  adjustedNodes: FlowNodeDef[];
  solveResult: FlowsheetSolveResultCompat;
  specResults: SingleDesignSpecResult[];
}

function exactStreamTotalMassKgH(s: SolvedStream): number {
  let tot = 0;
  for (const k of SIM_COMPS) tot += Math.max(0, s.flowsKgH[k] || 0);
  return tot;
}

function exactStreamTotalMolarKmolH(s: SolvedStream): number {
  let mol = 0;
  for (const k of SIM_COMPS) {
    const m = Math.max(0, s.flowsKgH[k] || 0);
    if (m > 0) mol += m / COMP_META[k].mw;
  }
  return mol;
}

/**
 * Evaluates a measured stream or unit KPI from a solved flowsheet with full 64-bit precision.
 */
export function evaluateDesignSpecMetric(
  nodes: FlowNodeDef[],
  edges: FlowEdgeDef[],
  result: FlowsheetSolveResultCompat,
  measured: Pick<
    DesignSpecMeasuredTarget,
    'streamEdgeId' | 'metric' | 'comp' | 'refFeedNodeId' | 'unitNodeId' | 'unitMetric'
  >
): number {
  if (measured.unitNodeId && measured.unitMetric) {
    const u: SolvedUnitResult | undefined = result.units.find(x => x.nodeId === measured.unitNodeId);
    if (!u) return 0;
    switch (measured.unitMetric) {
      case 'heat_duty_mcalh':
        return u.heatDutyKcalH / 1000.0;
      case 'shaft_power_kw':
        return u.shaftPowerKW;
      case 'outlet_mass_kgh':
        return u.outletMassKgH;
      default:
        return 0;
    }
  }

  if (measured.streamEdgeId && measured.metric) {
    const s = result.streams.find(st => st.edgeId === measured.streamEdgeId);
    if (!s) return 0;
    const totMass = exactStreamTotalMassKgH(s);
    const comp = measured.comp;

    switch (measured.metric) {
      case 'total_flow_kgh':
        return totMass;
      case 'comp_flow_kgh':
        return comp ? Math.max(0, s.flowsKgH[comp] || 0) : totMass;
      case 'comp_wt_pct': {
        if (!comp || totMass <= 1e-12) return 0;
        return (Math.max(0, s.flowsKgH[comp] || 0) / totMass) * 100.0;
      }
      case 'comp_mol_pct': {
        if (!comp) return 0;
        const totMol = exactStreamTotalMolarKmolH(s);
        if (totMol <= 1e-12) return 0;
        const cMol = Math.max(0, s.flowsKgH[comp] || 0) / COMP_META[comp].mw;
        return (cMol / totMol) * 100.0;
      }
      case 'temp_c': {
        const exactT = (s as SolvedStream & { exactTempC?: number }).exactTempC;
        return typeof exactT === 'number' && Number.isFinite(exactT) ? exactT : s.tempC;
      }
      case 'vapor_frac': {
        const exactVf = (s as SolvedStream & { exactVaporFraction?: number }).exactVaporFraction;
        return typeof exactVf === 'number' && Number.isFinite(exactVf) ? exactVf : s.vaporFraction;
      }
      case 'comp_recovery_pct': {
        const num = comp ? Math.max(0, s.flowsKgH[comp] || 0) : totMass;
        let denom = 0;

        if (measured.refFeedNodeId) {
          const refNode = nodes.find(n => n.id === measured.refFeedNodeId);
          if (refNode?.unitType === 'feed') {
            if (comp) {
              denom = Math.max(0, refNode.params.feedFlowsKgH?.[comp] ?? 0);
            } else {
              for (const k of SIM_COMPS) denom += Math.max(0, refNode.params.feedFlowsKgH?.[k] ?? 0);
            }
          } else if (refNode) {
            // Non-feed reference unit: sum incoming streams to that unit (or outgoing if none)
            const inEdgeIds = new Set(edges.filter(e => e.target === refNode.id).map(e => e.id));
            const refStreams =
              inEdgeIds.size > 0
                ? result.streams.filter(st => inEdgeIds.has(st.edgeId))
                : result.streams.filter(st =>
                    edges.some(e => e.id === st.edgeId && e.source === refNode.id)
                  );
            for (const rs of refStreams) {
              denom += comp ? Math.max(0, rs.flowsKgH[comp] || 0) : exactStreamTotalMassKgH(rs);
            }
          }
        } else {
          // Default reference: sum across all feed nodes in the flowsheet
          for (const n of nodes) {
            if (n.unitType === 'feed') {
              if (comp) {
                denom += Math.max(0, n.params.feedFlowsKgH?.[comp] ?? 0);
              } else {
                for (const k of SIM_COMPS) denom += Math.max(0, n.params.feedFlowsKgH?.[k] ?? 0);
              }
            }
          }
          // Fallback to source unit's total inlet if no feed has that component
          if (denom <= 1e-12) {
            const edgeObj = edges.find(e => e.id === measured.streamEdgeId);
            if (edgeObj) {
              const srcInIds = new Set(edges.filter(e => e.target === edgeObj.source).map(e => e.id));
              for (const rs of result.streams) {
                if (srcInIds.has(rs.edgeId)) {
                  denom += comp ? Math.max(0, rs.flowsKgH[comp] || 0) : exactStreamTotalMassKgH(rs);
                }
              }
            }
          }
        }
        return denom > 1e-12 ? (num / denom) * 100.0 : 0;
      }
      default:
        return 0;
    }
  }
  return 0;
}

/**
 * Reads current value of a manipulated parameter from a FlowNodeDef.
 */
export function readManipulatedParam(
  node: FlowNodeDef,
  paramKey: ManipulatedParamKey,
  comp?: SimCompKey
): number {
  const p = node.params;
  switch (paramKey) {
    case 'feed_comp_kgh':
      return comp ? Math.max(0, p.feedFlowsKgH?.[comp] ?? 0) : 0;
    case 'feed_total_scale':
      return 1.0;
    case 'operTempC':
      return node.unitType === 'feed' ? (p.feedTempC ?? 25.0) : (p.operTempC ?? 25.0);
    case 'operPressKgcm2g':
      return node.unitType === 'feed' ? (p.feedPressKgcm2g ?? 1.0) : (p.operPressKgcm2g ?? 1.0);
    case 'splitRatioTop':
      return p.splitRatioTop ?? 0.5;
    case 'makeupSolventKgH':
      return p.makeupSolventKgH ?? 0;
    case 'specifiedDutyMcalH':
      return p.specifiedDutyMcalH ?? 0;
    case 'conversion':
      return p.conversion ?? 0.95;
    case 'refluxRatio':
      return p.distillConfig?.topSpecValue ?? 2.5;
    case 'distillateRateKgH':
      return p.distillConfig?.splitSpecValue ?? 500;
    case 'sideCutRateKgH':
      return p.distillConfig?.sideCut?.enabled && p.distillConfig.sideCut.specType === 'mass_kgh'
        ? Math.max(0, p.distillConfig.sideCut.specValue ?? 0)
        : 0;
    case 'sideCutRatioSF':
      return p.distillConfig?.sideCut?.enabled && p.distillConfig.sideCut.specType === 's_over_f_mass'
        ? Math.min(0.85, Math.max(0, p.distillConfig.sideCut.specValue ?? 0))
        : 0;
    case 'sideCutStage': {
      const nSt = Math.max(4, Math.round(p.distillConfig?.totalStages ?? 24));
      return p.distillConfig?.sideCut?.stage
        ? Math.max(2, Math.min(nSt - 1, Math.round(p.distillConfig.sideCut.stage)))
        : Math.max(2, Math.min(nSt - 1, Math.round(nSt * 0.35)));
    }
    case 'outletPressKgcm2g':
      return p.outletPressKgcm2g ?? 1.0;
    default:
      return 0;
  }
}

function cloneNodeDef(n: FlowNodeDef): FlowNodeDef {
  return {
    ...n,
    params: {
      ...n.params,
      feedFlowsKgH: n.params.feedFlowsKgH ? { ...n.params.feedFlowsKgH } : undefined,
      distillConfig: n.params.distillConfig
        ? {
            ...n.params.distillConfig,
            sideCut: n.params.distillConfig.sideCut ? { ...n.params.distillConfig.sideCut } : undefined,
            additionalSideCuts: n.params.distillConfig.additionalSideCuts
              ? n.params.distillConfig.additionalSideCuts.map(sc => ({ ...sc }))
              : undefined,
          }
        : undefined,
      hxDesignConfig: n.params.hxDesignConfig ? { ...n.params.hxDesignConfig } : undefined,
    },
  };
}

/**
 * Applies one or more manipulated variable values onto a clean clone of baseNodes.
 */
export function applyManipulatedParams(
  baseNodes: FlowNodeDef[],
  assignments: {
    nodeId: string;
    paramKey: ManipulatedParamKey;
    comp?: SimCompKey;
    value: number;
  }[]
): FlowNodeDef[] {
  const cloned = baseNodes.map(cloneNodeDef);
  const baseById = new Map<string, FlowNodeDef>();
  baseNodes.forEach(n => baseById.set(n.id, n));
  const mapById = new Map<string, FlowNodeDef>();
  cloned.forEach(n => mapById.set(n.id, n));

  for (const a of assignments) {
    const target = mapById.get(a.nodeId);
    const orig = baseById.get(a.nodeId);
    if (!target || !orig) continue;
    const p = target.params;
    const u = a.value;

    switch (a.paramKey) {
      case 'feed_comp_kgh': {
        if (a.comp) {
          p.feedFlowsKgH = {
            ...(p.feedFlowsKgH ?? {}),
            [a.comp]: Math.max(0, u),
          };
        }
        break;
      }
      case 'feed_total_scale': {
        const scale = Math.max(0, u);
        const origFlows = orig.params.feedFlowsKgH ?? {};
        const scaledFlows: Partial<Record<SimCompKey, number>> = {};
        for (const k of SIM_COMPS) {
          const baseVal = origFlows[k] ?? 0;
          if (baseVal > 0) scaledFlows[k] = baseVal * scale;
        }
        p.feedFlowsKgH = scaledFlows;
        break;
      }
      case 'operTempC': {
        if (target.unitType === 'feed') p.feedTempC = u;
        else p.operTempC = u;
        break;
      }
      case 'operPressKgcm2g': {
        if (target.unitType === 'feed') p.feedPressKgcm2g = u;
        else p.operPressKgcm2g = u;
        break;
      }
      case 'splitRatioTop': {
        p.splitRatioTop = Math.min(0.999999, Math.max(0.0, u));
        break;
      }
      case 'makeupSolventKgH': {
        p.makeupSolventKgH = Math.max(0, u);
        break;
      }
      case 'specifiedDutyMcalH': {
        p.hexSpecMode = 'heat_duty';
        p.specifiedDutyMcalH = u;
        break;
      }
      case 'conversion': {
        p.conversion = Math.min(1.0, Math.max(0, u));
        const rxCfg = (p as FlowNodeDef['params'] & { reactorConfig?: Record<string, unknown> }).reactorConfig;
        if (rxCfg && typeof rxCfg === 'object') {
          (p as FlowNodeDef['params'] & { reactorConfig?: Record<string, unknown> }).reactorConfig = {
            ...rxCfg,
            conversion: Math.min(1.0, Math.max(0, u)),
          };
        }
        break;
      }
      case 'refluxRatio': {
        const prevCfg: DistillColumnParams = p.distillConfig ?? {};
        const slots = Array.isArray(prevCfg.activeDofSlots)
          ? [...prevCfg.activeDofSlots]
          : undefined;
        p.distillConfig = {
          ...prevCfg,
          topSpecType: 'reflux_ratio',
          topSpecValue: Math.max(0.02, u),
          activeDofSlots: slots && !slots.includes('rr') ? ['rr', slots[0] ?? 'split'] : slots,
        };
        break;
      }
      case 'distillateRateKgH': {
        const prevCfg: DistillColumnParams = p.distillConfig ?? {};
        const slots = Array.isArray(prevCfg.activeDofSlots)
          ? [...prevCfg.activeDofSlots]
          : undefined;
        p.distillConfig = {
          ...prevCfg,
          splitSpecType: 'distillate_kgh',
          splitSpecValue: Math.max(0.01, u),
          activeDofSlots: slots && !slots.includes('split') ? [slots[0] ?? 'rr', 'split'] : slots,
        };
        break;
      }
      case 'sideCutRateKgH': {
        const prevCfg: DistillColumnParams = p.distillConfig ?? {};
        const prevSc = prevCfg.sideCut;
        const nStages = Math.max(4, Math.round(prevCfg.totalStages ?? 24));
        const defaultStage = Math.max(2, Math.min(nStages - 1, Math.round(nStages * 0.35)));
        p.distillConfig = {
          ...prevCfg,
          sideCut: {
            id: prevSc?.id ?? 'SC-1',
            label: prevSc?.label ?? '사이드컷 S',
            ...prevSc,
            enabled: u > 0,
            stage: prevSc?.stage ?? defaultStage,
            phase: prevSc?.phase ?? 'liquid',
            specType: 'mass_kgh',
            specValue: Math.max(0, u),
          },
        };
        break;
      }
      case 'sideCutRatioSF': {
        const prevCfg: DistillColumnParams = p.distillConfig ?? {};
        const prevSc = prevCfg.sideCut;
        const nStages = Math.max(4, Math.round(prevCfg.totalStages ?? 24));
        const defaultStage = Math.max(2, Math.min(nStages - 1, Math.round(nStages * 0.35)));
        p.distillConfig = {
          ...prevCfg,
          sideCut: {
            id: prevSc?.id ?? 'SC-1',
            label: prevSc?.label ?? '사이드컷 S',
            ...prevSc,
            enabled: u > 0,
            stage: prevSc?.stage ?? defaultStage,
            phase: prevSc?.phase ?? 'liquid',
            specType: 's_over_f_mass',
            specValue: Math.min(0.85, Math.max(0, u)),
          },
        };
        break;
      }
      case 'sideCutStage': {
        const prevCfg: DistillColumnParams = p.distillConfig ?? {};
        const prevSc = prevCfg.sideCut;
        const nStages = Math.max(4, Math.round(prevCfg.totalStages ?? 24));
        const clampedStage = Math.max(2, Math.min(nStages - 1, Math.round(u)));
        p.distillConfig = {
          ...prevCfg,
          sideCut: {
            id: prevSc?.id ?? 'SC-1',
            label: prevSc?.label ?? '사이드컷 S',
            ...prevSc,
            enabled: true,
            autoOptimizeStage: false,
            stage: clampedStage,
            phase: prevSc?.phase ?? 'liquid',
            specType: prevSc?.specType ?? 's_over_f_mass',
            specValue: prevSc?.specValue ?? 0.15,
          },
        };
        break;
      }
      case 'outletPressKgcm2g': {
        p.outletPressKgcm2g = u;
        break;
      }
    }
  }

  return cloned;
}

function clampBound(u: number, lo: number, hi: number): number {
  const minB = Math.min(lo, hi);
  const maxB = Math.max(lo, hi);
  return Math.min(maxB, Math.max(minB, u));
}

/**
 * Solves dense linear system A x = b via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal < 1e-14 || !Number.isFinite(maxVal)) return null;
    if (maxRow !== col) {
      const tmp = M[col];
      M[col] = M[maxRow];
      M[maxRow] = tmp;
    }
    const piv = M[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / piv;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return x;
}

/**
 * 1D Bracketed Secant + Brent's Method Hybrid Solver (maxIter = 30).
 */
function solveSingleDesignSpec1D(
  baseNodes: FlowNodeDef[],
  edges: FlowEdgeDef[],
  spec: DesignSpecDef,
  solveOpts?: FlowsheetSolveOptsCompat,
  maxIter = 30
): FlowsheetDesignSpecSolveResult {
  const minB = Math.min(spec.manipulated.minBound, spec.manipulated.maxBound);
  const maxB = Math.max(spec.manipulated.minBound, spec.manipulated.maxBound);
  const tol = Math.max(1e-7, spec.measured.tolerance ?? 1e-3);
  const node0 = baseNodes.find(n => n.id === spec.manipulated.nodeId);
  const defaultGuess = node0
    ? readManipulatedParam(node0, spec.manipulated.paramKey, spec.manipulated.comp)
    : 0.5 * (minB + maxB);
  const u0 = clampBound(spec.manipulated.initialGuess ?? defaultGuess, minB, maxB);

  const history: DesignSpecIterationEntry[] = [];
  let bestU = u0;
  let bestAbsErr = Infinity;
  let bestAchieved = 0;
  let bestNodes = baseNodes;
  let bestSolveRes: FlowsheetSolveResultCompat | null = null;
  let evalCount = 0;

  const evaluateU = (uRaw: number): { u: number; f: number; y: number; ok: boolean } => {
    const u = clampBound(uRaw, minB, maxB);
    const candNodes = applyManipulatedParams(baseNodes, [
      {
        nodeId: spec.manipulated.nodeId,
        paramKey: spec.manipulated.paramKey,
        comp: spec.manipulated.comp,
        value: u,
      },
    ]);
    const res = solveFlowsheet(candNodes, edges, solveOpts);
    const y = evaluateDesignSpecMetric(candNodes, edges, res, spec.measured);
    const f = y - spec.measured.targetValue;
    evalCount += 1;
    history.push({
      iter: evalCount,
      manipulatedValue: u,
      achievedValue: y,
      error: f,
      flowsheetConverged: res.convergence.converged,
    });
    if (Math.abs(f) < bestAbsErr || !bestSolveRes) {
      bestAbsErr = Math.abs(f);
      bestU = u;
      bestAchieved = y;
      bestNodes = candNodes;
      bestSolveRes = res;
    }
    return { u, f, y, ok: res.convergence.converged };
  };

  // Step 1: Initial guess evaluation
  const p0 = evaluateU(u0);
  if (Math.abs(p0.f) <= tol) {
    return build1DResult(spec, true, evalCount, tol, bestU, bestAchieved, bestNodes, bestSolveRes!, history);
  }

  const span = Math.max(1e-9, maxB - minB);
  const step0 = u0 + 0.06 * span <= maxB ? 0.06 * span : -0.06 * span;
  const p1 = evaluateU(u0 + step0);
  if (Math.abs(p1.f) <= tol) {
    return build1DResult(spec, true, evalCount, tol, bestU, bestAchieved, bestNodes, bestSolveRes!, history);
  }

  let bracketA = p0.u;
  let fA = p0.f;
  let bracketB = p1.u;
  let fB = p1.f;
  let hasBracket = fA * fB < 0;

  // Step 2: Secant search + endpoint / grid bracket acquisition if not yet bracketed
  let prevU = p0.u;
  let prevF = p0.f;
  let currU = p1.u;
  let currF = p1.f;

  for (let sIter = 0; !hasBracket && evalCount < Math.min(10, maxIter); sIter++) {
    const df = currF - prevF;
    let nextU: number;
    if (Math.abs(df) > 1e-12) {
      const secantRaw = currU - currF * ((currU - prevU) / df);
      const maxJump = 0.45 * span;
      const clampedStep = Math.max(-maxJump, Math.min(maxJump, secantRaw - currU));
      nextU = clampBound(currU + clampedStep, minB, maxB);
      if (Math.abs(nextU - currU) < 1e-7 * span) {
        nextU = sIter % 2 === 0 ? minB : maxB;
      }
    } else {
      nextU = sIter % 2 === 0 ? minB : maxB;
    }

    const pn = evaluateU(nextU);
    if (Math.abs(pn.f) <= tol) {
      return build1DResult(spec, true, evalCount, tol, bestU, bestAchieved, bestNodes, bestSolveRes!, history);
    }

    // Check sign change against any previously evaluated history point
    for (const h of history) {
      if (h.error * pn.f < 0) {
        bracketA = h.manipulatedValue;
        fA = h.error;
        bracketB = pn.u;
        fB = pn.f;
        hasBracket = true;
        break;
      }
    }
    prevU = currU;
    prevF = currF;
    currU = pn.u;
    currF = pn.f;
  }

  // Coarse interior probe if endpoints still had same sign
  if (!hasBracket && evalCount < maxIter - 4) {
    for (const frac of [0.0, 1.0, 0.25, 0.75, 0.5]) {
      if (evalCount >= maxIter) break;
      const probeU = minB + frac * span;
      if (history.some(h => Math.abs(h.manipulatedValue - probeU) < 0.02 * span)) continue;
      const pp = evaluateU(probeU);
      if (Math.abs(pp.f) <= tol) {
        return build1DResult(spec, true, evalCount, tol, bestU, bestAchieved, bestNodes, bestSolveRes!, history);
      }
      for (const h of history) {
        if (h.error * pp.f < 0) {
          bracketA = h.manipulatedValue;
          fA = h.error;
          bracketB = pp.u;
          fB = pp.f;
          hasBracket = true;
          break;
        }
      }
      if (hasBracket) break;
    }
  }

  // Step 3: Dekker-Brent superlinear bracketed root-finding
  if (hasBracket) {
    let a = bracketA;
    let fa = fA;
    let b = bracketB;
    let fb = fB;
    if (Math.abs(fa) < Math.abs(fb)) {
      [a, b] = [b, a];
      [fa, fb] = [fb, fa];
    }
    let c = a;
    let fc = fa;
    let mflag = true;
    let d = b - a;

    while (evalCount < maxIter && Math.abs(fb) > tol && Math.abs(b - a) > 1e-11 * Math.max(1, span)) {
      let s: number;
      if (Math.abs(fa - fc) > 1e-14 && Math.abs(fb - fc) > 1e-14) {
        // Inverse quadratic interpolation
        s =
          (a * fb * fc) / ((fa - fb) * (fa - fc)) +
          (b * fa * fc) / ((fb - fa) * (fb - fc)) +
          (c * fa * fb) / ((fc - fa) * (fc - fb));
      } else {
        // Secant step
        s = b - fb * ((b - a) / (fb - fa));
      }

      const cond1 = (s - (3 * a + b) / 4) * (s - b) > 0;
      const cond2 = mflag && Math.abs(s - b) >= Math.abs(b - c) / 2;
      const cond3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) / 2;
      const cond4 = mflag && Math.abs(b - c) < 1e-12;
      const cond5 = !mflag && Math.abs(c - d) < 1e-12;

      if (cond1 || cond2 || cond3 || cond4 || cond5) {
        s = 0.5 * (a + b);
        mflag = true;
      } else {
        mflag = false;
      }

      const ps = evaluateU(s);
      const fs = ps.f;
      if (Math.abs(fs) <= tol) {
        return build1DResult(spec, true, evalCount, tol, bestU, bestAchieved, bestNodes, bestSolveRes!, history);
      }

      d = c;
      c = b;
      fc = fb;
      if (fa * fs < 0) {
        b = ps.u;
        fb = fs;
      } else {
        a = ps.u;
        fa = fs;
      }
      if (Math.abs(fa) < Math.abs(fb)) {
        [a, b] = [b, a];
        [fa, fb] = [fb, fa];
      }
    }
  }

  const isConv = bestAbsErr <= tol;
  return build1DResult(spec, isConv, evalCount, tol, bestU, bestAchieved, bestNodes, bestSolveRes!, history);
}

function build1DResult(
  spec: DesignSpecDef,
  converged: boolean,
  iterations: number,
  tol: number,
  bestU: number,
  bestAchieved: number,
  bestNodes: FlowNodeDef[],
  bestSolveRes: FlowsheetSolveResultCompat,
  history: DesignSpecIterationEntry[]
): FlowsheetDesignSpecSolveResult {
  const err = bestAchieved - spec.measured.targetValue;
  return {
    converged: converged && bestSolveRes.convergence.converged,
    solverMethodUsed: 'secant_brent_1d',
    outerIterations: iterations,
    adjustedNodes: bestNodes,
    solveResult: bestSolveRes,
    specResults: [
      {
        specId: spec.id,
        name: spec.name,
        converged,
        iterations,
        targetValue: spec.measured.targetValue,
        achievedValue: bestAchieved,
        residualError: err,
        tolerance: tol,
        finalManipulatedValue: bestU,
        history,
        message: converged
          ? `수렴 완료 (${iterations}회, 오차 ${Math.abs(err).toExponential(2)} ≤ ${tol})`
          : `미수렴 (${iterations}회 탐색, 최소 오차 ${Math.abs(err).toFixed(4)} — 조작변수 상·하한을 확인하세요)`,
      },
    ],
  };
}

/**
 * Multi-Variable Simultaneous Design Spec Solver (K >= 2 active specs):
 * Bounded Damped Newton / Broyden Jacobian solver on F(u) = y(u) - y_target = 0.
 */
function solveMultiDesignSpecsND(
  baseNodes: FlowNodeDef[],
  edges: FlowEdgeDef[],
  specs: DesignSpecDef[],
  solveOpts?: FlowsheetSolveOptsCompat,
  maxOuterIter = 25
): FlowsheetDesignSpecSolveResult {
  const K = specs.length;
  const minBounds = specs.map(s => Math.min(s.manipulated.minBound, s.manipulated.maxBound));
  const maxBounds = specs.map(s => Math.max(s.manipulated.minBound, s.manipulated.maxBound));
  const spans = specs.map((_, j) => Math.max(1e-6, maxBounds[j] - minBounds[j]));
  const tols = specs.map(s => Math.max(1e-7, s.measured.tolerance ?? 1e-3));
  const histories: DesignSpecIterationEntry[][] = specs.map(() => []);

  const uInit = specs.map((s, j) => {
    const n0 = baseNodes.find(n => n.id === s.manipulated.nodeId);
    const defVal = n0 ? readManipulatedParam(n0, s.manipulated.paramKey, s.manipulated.comp) : 0.5 * (minBounds[j] + maxBounds[j]);
    return clampBound(s.manipulated.initialGuess ?? defVal, minBounds[j], maxBounds[j]);
  });

  // Normalized coordinates z_j in [0, 1]
  const toZ = (u: number[]) => u.map((v, j) => (v - minBounds[j]) / spans[j]);
  const fromZ = (z: number[]) => z.map((zj, j) => minBounds[j] + Math.min(1, Math.max(0, zj)) * spans[j]);

  let evalCounter = 0;
  let bestMerit = Infinity;
  let bestU = [...uInit];
  let bestY = new Array<number>(K).fill(0);
  let bestNodes = baseNodes;
  let bestSolveRes: FlowsheetSolveResultCompat | null = null;

  const evalVector = (
    zIn: number[],
    recordHistory: boolean
  ): { u: number[]; z: number[]; y: number[]; fScaled: number[]; merit: number; allOk: boolean; res: FlowsheetSolveResultCompat; nodes: FlowNodeDef[] } => {
    const z = zIn.map(v => Math.min(1, Math.max(0, v)));
    const u = fromZ(z);
    const candNodes = applyManipulatedParams(
      baseNodes,
      specs.map((s, j) => ({
        nodeId: s.manipulated.nodeId,
        paramKey: s.manipulated.paramKey,
        comp: s.manipulated.comp,
        value: u[j],
      }))
    );
    const res = solveFlowsheet(candNodes, edges, solveOpts);
    const y = specs.map(s => evaluateDesignSpecMetric(candNodes, edges, res, s.measured));
    const fScaled = y.map((yi, i) => (yi - specs[i].measured.targetValue) / tols[i]);
    const merit = 0.5 * fScaled.reduce((acc, v) => acc + v * v, 0);
    const allOk = y.every((yi, i) => Math.abs(yi - specs[i].measured.targetValue) <= tols[i]);

    if (recordHistory) {
      evalCounter += 1;
      for (let i = 0; i < K; i++) {
        histories[i].push({
          iter: evalCounter,
          manipulatedValue: u[i],
          achievedValue: y[i],
          error: y[i] - specs[i].measured.targetValue,
          flowsheetConverged: res.convergence.converged,
        });
      }
    }

    if (merit < bestMerit || !bestSolveRes) {
      bestMerit = merit;
      bestU = [...u];
      bestY = [...y];
      bestNodes = candNodes;
      bestSolveRes = res;
    }

    return { u, z, y, fScaled, merit, allOk, res, nodes: candNodes };
  };

  const computeFiniteDiffJacobian = (zCurr: number[], fCurr: number[]): number[][] => {
    const J: number[][] = Array.from({ length: K }, () => new Array<number>(K).fill(0));
    for (let j = 0; j < K; j++) {
      const h = zCurr[j] + 0.015 <= 1.0 ? 0.015 : -0.015;
      const zPert = [...zCurr];
      zPert[j] += h;
      const pEval = evalVector(zPert, false);
      for (let i = 0; i < K; i++) {
        J[i][j] = (pEval.fScaled[i] - fCurr[i]) / h;
      }
    }
    return J;
  };

  let curr = evalVector(toZ(uInit), true);
  if (curr.allOk) {
    return buildNDResult(specs, tols, evalCounter, bestU, bestY, bestNodes, bestSolveRes!, histories);
  }

  let J = computeFiniteDiffJacobian(curr.z, curr.fScaled);
  let fdRefreshes = 1;

  for (let iter = 0; iter < maxOuterIter; iter++) {
    if (curr.allOk) break;

    // Solve (J^T J + lambda I) dz = -J^T fScaled (damped Gauss-Newton / Newton step)
    let jNormSq = 0;
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) jNormSq += J[i][j] * J[i][j];
    const lambda = Math.max(1e-10, 1e-7 * jNormSq);

    const JTJ: number[][] = Array.from({ length: K }, (_, r) =>
      Array.from({ length: K }, (__, c) => {
        let s = r === c ? lambda : 0;
        for (let i = 0; i < K; i++) s += J[i][r] * J[i][c];
        return s;
      })
    );
    const rhs = Array.from({ length: K }, (_, r) => {
      let s = 0;
      for (let i = 0; i < K; i++) s -= J[i][r] * curr.fScaled[i];
      return s;
    });

    let dz = solveLinearSystem(JTJ, rhs);
    if (!dz) {
      if (fdRefreshes < 4) {
        J = computeFiniteDiffJacobian(curr.z, curr.fScaled);
        fdRefreshes += 1;
        continue;
      }
      break;
    }

    // Clamp max single-iteration normalized step to <= 0.45 of box width
    const maxAbsDz = Math.max(...dz.map(Math.abs), 1e-12);
    if (maxAbsDz > 0.45) {
      const sc = 0.45 / maxAbsDz;
      dz = dz.map(v => v * sc);
    }

    // Backtracking line search on merit function
    let accepted: ReturnType<typeof evalVector> | null = null;
    for (const alpha of [1.0, 0.5, 0.25, 0.125]) {
      const zCand = curr.z.map((zj, j) => Math.min(1, Math.max(0, zj + alpha * dz![j])));
      const stepDist = vecNorm2(zCand.map((v, j) => v - curr.z[j]));
      if (stepDist < 1e-10) continue;
      const cand = evalVector(zCand, alpha === 1.0);
      if (cand.merit < curr.merit * (1 - 1e-4 * alpha) || cand.allOk) {
        if (alpha !== 1.0) {
          // Record accepted damped step into iteration history
          evalCounter += 1;
          for (let i = 0; i < K; i++) {
            histories[i].push({
              iter: evalCounter,
              manipulatedValue: cand.u[i],
              achievedValue: cand.y[i],
              error: cand.y[i] - specs[i].measured.targetValue,
              flowsheetConverged: cand.res.convergence.converged,
            });
          }
        }
        accepted = cand;
        break;
      }
    }

    if (!accepted) {
      // Refresh exact finite-difference Jacobian if Broyden approximation stalled
      if (fdRefreshes < 4) {
        J = computeFiniteDiffJacobian(curr.z, curr.fScaled);
        fdRefreshes += 1;
        continue;
      }
      break;
    }

    // Rank-1 Good Broyden forward Jacobian update: J_{k+1} = J_k + ((ΔF - J_k Δz) Δz^T) / (Δz^T Δz)
    const dzActual = accepted.z.map((v, j) => v - curr.z[j]);
    const dfActual = accepted.fScaled.map((v, i) => v - curr.fScaled[i]);
    const dzDot = dzActual.reduce((s, v) => s + v * v, 0);
    if (dzDot > 1e-14) {
      for (let i = 0; i < K; i++) {
        let jDz = 0;
        for (let j = 0; j < K; j++) jDz += J[i][j] * dzActual[j];
        const diff = (dfActual[i] - jDz) / dzDot;
        for (let j = 0; j < K; j++) {
          J[i][j] += diff * dzActual[j];
        }
      }
    }

    curr = accepted;
    if (curr.allOk) break;
  }

  return buildNDResult(specs, tols, evalCounter, bestU, bestY, bestNodes, bestSolveRes!, histories);
}

function buildNDResult(
  specs: DesignSpecDef[],
  tols: number[],
  outerIterations: number,
  bestU: number[],
  bestY: number[],
  bestNodes: FlowNodeDef[],
  bestSolveRes: FlowsheetSolveResultCompat,
  histories: DesignSpecIterationEntry[][]
): FlowsheetDesignSpecSolveResult {
  const specResults: SingleDesignSpecResult[] = specs.map((s, i) => {
    const err = bestY[i] - s.measured.targetValue;
    const conv = Math.abs(err) <= tols[i];
    return {
      specId: s.id,
      name: s.name,
      converged: conv,
      iterations: histories[i].length,
      targetValue: s.measured.targetValue,
      achievedValue: bestY[i],
      residualError: err,
      tolerance: tols[i],
      finalManipulatedValue: bestU[i],
      history: histories[i],
      message: conv
        ? `동시역산 수렴 (오차 ${Math.abs(err).toExponential(2)} ≤ ${tols[i]})`
        : `미수렴 (오차 ${Math.abs(err).toFixed(4)} > 허용 ${tols[i]})`,
    };
  });

  const allSpecsOk = specResults.every(r => r.converged);
  return {
    converged: allSpecsOk && bestSolveRes.convergence.converged,
    solverMethodUsed: 'damped_broyden_nd',
    outerIterations,
    adjustedNodes: bestNodes,
    solveResult: bestSolveRes,
    specResults,
  };
}

/**
 * Solves a flowsheet subject to 1 or multiple simultaneous Design Specs (Feedback Controllers).
 * - 0 active specs: standard flowsheet solve
 * - 1 active spec : Bracketed Secant + Dekker-Brent hybrid (maxIter = 30)
 * - >=2 active specs: Multi-variable Bounded Damped Broyden / Gauss-Newton solver
 */
export function solveFlowsheetWithDesignSpecs(
  nodes: FlowNodeDef[],
  edges: FlowEdgeDef[],
  specs: DesignSpecDef[],
  solveOpts?: FlowsheetSolveOptsCompat
): FlowsheetDesignSpecSolveResult {
  const activeSpecs = specs.filter(s => s.enabled);
  if (activeSpecs.length === 0) {
    const cloned = nodes.map(cloneNodeDef);
    const res = solveFlowsheet(cloned, edges, solveOpts);
    return {
      converged: res.convergence.converged,
      solverMethodUsed: 'none',
      outerIterations: 1,
      adjustedNodes: cloned,
      solveResult: res,
      specResults: [],
    };
  }
  if (activeSpecs.length === 1) {
    return solveSingleDesignSpec1D(nodes, edges, activeSpecs[0], solveOpts, 30);
  }
  return solveMultiDesignSpecsND(nodes, edges, activeSpecs, solveOpts, 25);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Parametric Sweep (1D / 2D Sensitivity Analysis)
// ─────────────────────────────────────────────────────────────────────────────

export interface SensitivityWatchedOutput {
  id: string;
  label: string;
  streamEdgeId?: string;
  metric?: DesignSpecStreamMetric;
  comp?: SimCompKey;
  refFeedNodeId?: string;
  unitNodeId?: string;
  unitMetric?: DesignSpecUnitMetric;
}

export interface SensitivityAnalysisDef {
  primaryVar: {
    nodeId: string;
    paramKey: ManipulatedParamKey;
    comp?: SimCompKey;
    label?: string;
    minValue: number;
    maxValue: number;
    steps: number; // typically 5..30
  };
  secondaryVar?: {
    nodeId: string;
    paramKey: ManipulatedParamKey;
    comp?: SimCompKey;
    label?: string;
    values: number[];
  };
  watchedOutputs: SensitivityWatchedOutput[];
  /** Optional inner Design Specs maintained at every sweep point */
  activeDesignSpecs?: DesignSpecDef[];
}

export interface SensitivityPointRow {
  stepIndex: number;
  primaryValue: number;
  secondaryValue: number | null;
  converged: boolean;
  iterations: number;
  outputs: Record<string, number>;
}

export interface SensitivitySeriesResult {
  secondaryValue: number | null;
  secondaryLabel: string;
  rows: SensitivityPointRow[];
}

export interface SensitivityAnalysisResult {
  primaryValues: number[];
  secondaryValues: (number | null)[];
  series: SensitivitySeriesResult[];
  flatRows: SensitivityPointRow[];
  elapsedMs: number;
}

/**
 * Executes a 1D or 2D parametric sweep across the flowsheet, recording arbitrary stream & unit KPIs.
 */
export function runFlowsheetSensitivity(
  nodes: FlowNodeDef[],
  edges: FlowEdgeDef[],
  sensDef: SensitivityAnalysisDef,
  solveOpts?: FlowsheetSolveOptsCompat
): SensitivityAnalysisResult {
  const t0 = Date.now();
  const nSteps = Math.max(2, Math.min(60, Math.round(sensDef.primaryVar.steps || 10)));
  const pMin = sensDef.primaryVar.minValue;
  const pMax = sensDef.primaryVar.maxValue;

  const primaryValues: number[] = [];
  for (let i = 0; i < nSteps; i++) {
    const v = nSteps === 1 ? pMin : pMin + ((pMax - pMin) * i) / (nSteps - 1);
    primaryValues.push(Number(v.toPrecision(10)));
  }

  const hasSecondary =
    !!sensDef.secondaryVar &&
    Array.isArray(sensDef.secondaryVar.values) &&
    sensDef.secondaryVar.values.length > 0;
  const secondaryValues: (number | null)[] = hasSecondary
    ? sensDef.secondaryVar!.values
    : [null];

  const series: SensitivitySeriesResult[] = [];
  const flatRows: SensitivityPointRow[] = [];
  const innerSpecs = (sensDef.activeDesignSpecs ?? []).filter(s => s.enabled);

  for (const secVal of secondaryValues) {
    const rows: SensitivityPointRow[] = [];
    for (let idx = 0; idx < primaryValues.length; idx++) {
      const primVal = primaryValues[idx];
      const assignments: {
        nodeId: string;
        paramKey: ManipulatedParamKey;
        comp?: SimCompKey;
        value: number;
      }[] = [
        {
          nodeId: sensDef.primaryVar.nodeId,
          paramKey: sensDef.primaryVar.paramKey,
          comp: sensDef.primaryVar.comp,
          value: primVal,
        },
      ];
      if (secVal !== null && sensDef.secondaryVar) {
        assignments.push({
          nodeId: sensDef.secondaryVar.nodeId,
          paramKey: sensDef.secondaryVar.paramKey,
          comp: sensDef.secondaryVar.comp,
          value: secVal,
        });
      }

      const sweptNodes = applyManipulatedParams(nodes, assignments);
      let solved: FlowsheetSolveResultCompat;
      let evalNodes = sweptNodes;
      let pointConverged = false;
      let pointIters = 1;

      if (innerSpecs.length > 0) {
        const dsRes = solveFlowsheetWithDesignSpecs(sweptNodes, edges, innerSpecs, solveOpts);
        solved = dsRes.solveResult;
        evalNodes = dsRes.adjustedNodes;
        pointConverged = dsRes.converged;
        pointIters = dsRes.outerIterations;
      } else {
        solved = solveFlowsheet(sweptNodes, edges, solveOpts);
        pointConverged = solved.convergence.converged;
        pointIters = solved.convergence.iterations;
      }

      const outputs: Record<string, number> = {};
      for (const w of sensDef.watchedOutputs) {
        outputs[w.id] = evaluateDesignSpecMetric(evalNodes, edges, solved, w);
      }

      const row: SensitivityPointRow = {
        stepIndex: idx,
        primaryValue: primVal,
        secondaryValue: secVal,
        converged: pointConverged,
        iterations: pointIters,
        outputs,
      };
      rows.push(row);
      flatRows.push(row);
    }

    series.push({
      secondaryValue: secVal,
      secondaryLabel:
        secVal === null
          ? '기준 조건'
          : `${sensDef.secondaryVar?.label ?? sensDef.secondaryVar?.paramKey} = ${secVal}`,
      rows,
    });
  }

  return {
    primaryValues,
    secondaryValues,
    series,
    flatRows,
    elapsedMs: Math.max(1, Date.now() - t0),
  };
}

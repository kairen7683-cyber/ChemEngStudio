import type { SimCompKey } from './flowsheetSolver';
import type { ResolvedPropertyMethod } from './componentCatalog';
import { MW } from './constants';
import { KJ_PER_KCAL, streamEnthalpyKcalH } from './thermoCore';
import { liquidActivityCoefficients } from './rigorousThermo';
import { solveRigorousLLEDecanter } from './activityModels';

export interface ExtractorColumnConfig {
  stages: number;
  operTempC: number;
  operPressKgcm2g: number;
  propertyMethod?: ResolvedPropertyMethod;
  stageEfficiency?: number; // Murphree LLE stage efficiency (0.2–1.0, default 1.0)
}

export interface ExtractorStageProfile {
  stage: number;
  tempC: number;
  extractMassKgH: number;
  raffinateMassKgH: number;
  extractCompWtPct: Partial<Record<SimCompKey, number>>;
  raffinateCompWtPct: Partial<Record<SimCompKey, number>>;
  distributionK: Partial<Record<SimCompKey, number>>;
}

export interface ExtractorSolveResult {
  converged: boolean;
  iterations: number;
  extractFlowsKgH: Record<SimCompKey, number>;
  raffinateFlowsKgH: Record<SimCompKey, number>;
  extractTempC: number;
  raffinateTempC: number;
  soluteKey: SimCompKey | null;
  soluteRecoveryPct: number;
  massBalanceRelErr: number;
  stageProfiles: ExtractorStageProfile[];
  statusNote: string;
  warnings: string[];
}

const ALL_EXTRACTOR_KEYS: SimCompKey[] = Object.keys(MW) as SimCompKey[];

const NON_VOLATILE_ELECTROLYTES = new Set<SimCompKey>([
  'NaCl',
  'NaOH',
  'NaOCl',
  'NaClO3',
  'FeCl2',
  'FeCl3',
  'PAC',
  'Glycerol',
]);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function zeroCompRecord(): Record<SimCompKey, number> {
  const rec = {} as Record<SimCompKey, number>;
  for (let i = 0; i < ALL_EXTRACTOR_KEYS.length; i++) {
    rec[ALL_EXTRACTOR_KEYS[i]] = 0;
  }
  return rec;
}

function solveTridiagonalLLE(
  a: Float64Array,
  b: Float64Array,
  c: Float64Array,
  d: Float64Array,
  cp: Float64Array,
  dp: Float64Array,
  out: Float64Array
): Float64Array {
  const n = b.length;
  if (n === 1) {
    out[0] = Math.abs(b[0]) > 1e-18 ? d[0] / b[0] : 0;
    return out;
  }
  const b0 = Math.abs(b[0]) < 1e-18 ? (b[0] >= 0 ? 1e-18 : -1e-18) : b[0];
  cp[0] = c[0] / b0;
  dp[0] = d[0] / b0;

  for (let i = 1; i < n; i++) {
    let denom = b[i] - a[i] * cp[i - 1];
    if (Math.abs(denom) < 1e-18) denom = denom >= 0 ? 1e-18 : -1e-18;
    cp[i] = i < n - 1 ? c[i] / denom : 0;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / denom;
  }

  out[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    out[i] = dp[i] - cp[i] * out[i + 1];
  }
  return out;
}

/**
 * Michelsen Tangent-Plane Distance (TPD) 액-액 상불안정성 검정
 * - tpdMin < -1e-5 이면 2액상 분리(열역학적 불안정), tpdMin >= -1e-5 이면 완전 혼화 단일 액상(세출 Washout)
 */
function evaluateMixtureLLEStability(
  activeComps: SimCompKey[],
  feedMol: Record<SimCompKey, number>,
  totMol: number,
  carrierKey: SimCompKey,
  solventKey: SimCompKey,
  T_C: number,
  method: 'NRTL' | 'ENRTL'
): { splits: boolean; tpdMin: number } {
  if (totMol <= 1e-12 || carrierKey === solventKey) {
    return { splits: false, tpdMin: 0 };
  }

  const z = zeroCompRecord();
  let liqMol = 0;
  let saltMol = 0;
  for (const c of activeComps) {
    z[c] = feedMol[c] / totMol;
    if (NON_VOLATILE_ELECTROLYTES.has(c)) saltMol += feedMol[c];
    else liqMol += feedMol[c];
  }
  if (liqMol <= 1e-12) return { splits: false, tpdMin: 0 };

  const gammaZ = liquidActivityCoefficients(activeComps, z, T_C, method);

  const runTrial = (richKey: SimCompKey, poorKey: SimCompKey, includeSalts: boolean): number => {
    const w = zeroCompRecord();
    let wSum = 0;
    for (const c of activeComps) {
      if (NON_VOLATILE_ELECTROLYTES.has(c)) {
        w[c] = includeSalts ? feedMol[c] : 0;
      } else if (c === richKey) {
        w[c] = Math.max(1e-5, 0.92 * liqMol);
      } else if (c === poorKey) {
        w[c] = Math.max(1e-6, 0.015 * liqMol);
      } else {
        w[c] = Math.max(1e-6, 0.35 * feedMol[c]);
      }
      wSum += w[c];
    }
    if (wSum <= 1e-15) return 0;
    for (const c of activeComps) w[c] /= wSum;

    for (let st = 0; st < 6; st++) {
      const gw = liquidActivityCoefficients(activeComps, w, T_C, method);
      let nextSum = 0;
      for (const c of activeComps) {
        if (NON_VOLATILE_ELECTROLYTES.has(c)) {
          w[c] = includeSalts ? z[c] : 0;
        } else {
          const zi = Math.max(1e-14, z[c]);
          w[c] = (zi * Math.max(1e-8, gammaZ[c])) / Math.max(1e-4, gw[c]);
        }
        nextSum += w[c];
      }
      if (nextSum <= 1e-15) return 0;
      for (const c of activeComps) w[c] /= nextSum;
    }

    // 시험상 w가 전체 조성 z로 완전히 수렴했는지(자명해 Trivial Root) 거리 확인
    let l1Dist = 0;
    for (const c of activeComps) {
      l1Dist += Math.abs(w[c] - z[c]);
    }
    if (l1Dist < 0.015) return 0;

    const gwFinal = liquidActivityCoefficients(activeComps, w, T_C, method);
    let tpd = 0;
    for (const c of activeComps) {
      if (NON_VOLATILE_ELECTROLYTES.has(c)) continue;
      const wi = Math.max(1e-14, w[c]);
      const zi = Math.max(1e-14, z[c]);
      tpd += wi * (Math.log(wi * Math.max(1e-8, gwFinal[c])) - Math.log(zi * Math.max(1e-8, gammaZ[c])));
    }
    return tpd;
  };

  const carrierHasSalt = carrierKey === 'H2O' && saltMol > 0;
  const tpdExt = runTrial(solventKey, carrierKey, false);
  const tpdRaf = runTrial(carrierKey, solventKey, carrierHasSalt);
  let tpdMin = Math.min(tpdExt, tpdRaf);

  // 수계-소수성 유기용매 계의 경우 디캔터 안정성 판별기와 교차 검증
  if (tpdMin >= -1e-5 && (carrierKey === 'H2O' || solventKey === 'H2O')) {
    const massCheck = zeroCompRecord();
    for (const c of activeComps) {
      massCheck[c] = feedMol[c] * (MW[c] || 18.015);
    }
    const dec = solveRigorousLLEDecanter(massCheck, T_C);
    if (dec.phaseSplit && dec.tpdMin < tpdMin) {
      tpdMin = dec.tpdMin;
    }
  }

  return { splits: tpdMin < -1e-5, tpdMin };
}

/**
 * 다단 향류 액-액 추출탑(Multistage Countercurrent Liquid-Liquid Extractor) 엄밀 MESH 솔버
 * - 원료(Feed)는 Stage 1로 유입되어 Stage N에서 추잔상(Raffinate)으로 배출
 * - 추출용매(Solvent)는 Stage N으로 유입되어 Stage 1에서 추출상(Extract)으로 배출
 * - NRTL / ENRTL / UNIFAC 다성분 등활동도(Isoactivity, γ_i^raf x_i^raf = γ_i^ext x_i^ext) +
 *   단별 Murphree 액-액 단효율 + Thomas 3중대각 성분 수지 + 단별 엔탈피/온도 프로파일 동시 해법
 */
export function solveMultistageExtractor(
  feedFlowsKgH: Partial<Record<SimCompKey, number>>,
  feedTempC: number,
  solventFlowsKgH: Partial<Record<SimCompKey, number>>,
  solventTempC: number,
  config: ExtractorColumnConfig
): ExtractorSolveResult {
  const warnings: string[] = [];
  const rawStages = Math.round(config.stages || 1);
  if (rawStages < 1 || rawStages > 50) {
    warnings.push(`요청 단수(${rawStages})를 허용 운전 범위(1~50단)로 보정하여 계산했습니다.`);
  }
  const N = clamp(rawStages, 1, 50);
  const etaLL = clamp(config.stageEfficiency ?? 1.0, 0.2, 1.0);
  const operPressKgcm2g = Number.isFinite(config.operPressKgcm2g) ? config.operPressKgcm2g : 0.5;

  const feedKg = zeroCompRecord();
  const solvKg = zeroCompRecord();
  const totalInKg = zeroCompRecord();
  const feedMol = zeroCompRecord();
  const solvMol = zeroCompRecord();
  const totalInMol = zeroCompRecord();

  let feedMassTot = 0;
  let solvMassTot = 0;
  let feedMolTot = 0;
  let solvMolTot = 0;
  let hasElectrolyte = false;

  for (let i = 0; i < ALL_EXTRACTOR_KEYS.length; i++) {
    const k = ALL_EXTRACTOR_KEYS[i];
    const mw = MW[k] || 18.015;
    const mf = Math.max(0, feedFlowsKgH[k] || 0);
    const ms = Math.max(0, solventFlowsKgH[k] || 0);
    feedKg[k] = mf;
    solvKg[k] = ms;
    totalInKg[k] = mf + ms;
    feedMol[k] = mf / mw;
    solvMol[k] = ms / mw;
    totalInMol[k] = feedMol[k] + solvMol[k];
    feedMassTot += mf;
    solvMassTot += ms;
    feedMolTot += feedMol[k];
    solvMolTot += solvMol[k];
    if ((mf + ms) > 1e-9 && (NON_VOLATILE_ELECTROLYTES.has(k) || k === 'HCl' || k === 'H2SO4')) {
      hasElectrolyte = true;
    }
  }

  const totalMassIn = feedMassTot + solvMassTot;
  const totalMolIn = feedMolTot + solvMolTot;

  // 빈 스트림 또는 원료/용매 한쪽 미유입 방어
  if (feedMassTot <= 1e-8 || solvMassTot <= 1e-8) {
    warnings.push('원료(Feed)와 추출용매(Solvent) 양쪽 모두 0보다 큰 유량이 공급되어야 향류 추출이 성립합니다.');
    return {
      converged: false,
      iterations: 0,
      extractFlowsKgH: solvKg,
      raffinateFlowsKgH: feedKg,
      extractTempC: Number.isFinite(solventTempC) ? solventTempC : config.operTempC,
      raffinateTempC: Number.isFinite(feedTempC) ? feedTempC : config.operTempC,
      soluteKey: null,
      soluteRecoveryPct: 0,
      massBalanceRelErr: 0,
      stageProfiles: [],
      statusNote: '원료 또는 추출용매 유량 미입력으로 추출 계산 중단',
      warnings,
    };
  }

  let activityMethod: 'NRTL' | 'ENRTL' = hasElectrolyte ? 'ENRTL' : 'NRTL';
  if (config.propertyMethod === 'ENRTL') {
    activityMethod = 'ENRTL';
  } else if (config.propertyMethod === 'NRTL') {
    activityMethod = 'NRTL';
  } else if (config.propertyMethod === 'PR' || config.propertyMethod === 'SRK') {
    warnings.push(
      `액-액 추출(LLE) 상분리 정밀도를 위해 기상 상태방정식(${config.propertyMethod}) 대신 다성분 NRTL/UNIFAC 활동도 모델을 적용했습니다.`
    );
  }

  const activeComps = ALL_EXTRACTOR_KEYS.filter(k => totalInMol[k] > 1e-13);
  const nActive = activeComps.length;

  // 주 추출용매(solventKey), 추잔상 주 캐리어(carrierKey), 추출 대상 용질(soluteKey) 자동 식별
  let solventKey: SimCompKey = activeComps[0];
  let bestSolvMass = -1;
  for (const c of activeComps) {
    if (!NON_VOLATILE_ELECTROLYTES.has(c) && solvKg[c] > bestSolvMass) {
      bestSolvMass = solvKg[c];
      solventKey = c;
    }
  }

  let carrierKey: SimCompKey = activeComps.find(c => c !== solventKey) ?? solventKey;
  if (solventKey !== 'H2O' && feedKg.H2O >= 0.22 * feedMassTot) {
    carrierKey = 'H2O';
  } else {
    let bestCarrierMass = -1;
    for (const c of activeComps) {
      if (c !== solventKey && !NON_VOLATILE_ELECTROLYTES.has(c) && feedKg[c] > bestCarrierMass) {
        bestCarrierMass = feedKg[c];
        carrierKey = c;
      }
    }
  }

  let soluteKey: SimCompKey | null = null;
  let bestSoluteMass = 0;
  for (const c of activeComps) {
    if (c === carrierKey || c === solventKey || NON_VOLATILE_ELECTROLYTES.has(c)) continue;
    if (feedKg[c] > bestSoluteMass) {
      bestSoluteMass = feedKg[c];
      soluteKey = c;
    }
  }
  if (!soluteKey) {
    for (const c of activeComps) {
      if (c !== carrierKey && !NON_VOLATILE_ELECTROLYTES.has(c) && feedKg[c] > 1e-8) {
        soluteKey = c;
        break;
      }
    }
  }

  const tFeed = Number.isFinite(feedTempC) ? feedTempC : config.operTempC;
  const tSolv = Number.isFinite(solventTempC) ? solventTempC : config.operTempC;
  const tOper = Number.isFinite(config.operTempC) ? config.operTempC : 0.5 * (tFeed + tSolv);
  const useThermostat = Math.abs(tFeed - tSolv) < 0.25 && Math.abs(tOper - tFeed) > 0.5;
  const tRefCheck = useThermostat ? tOper : (feedMassTot * tFeed + solvMassTot * tSolv) / totalMassIn;

  // ── 1) 전체 혼합물 Michelsen TPD 혼화성(Washout / Plait-Point) 사전 검정 ──
  const stab = evaluateMixtureLLEStability(
    activeComps,
    totalInMol,
    totalMolIn,
    carrierKey,
    solventKey,
    tRefCheck,
    activityMethod
  );

  if (!stab.splits) {
    warnings.push(
      `운전 온도 ${tRefCheck.toFixed(1)} °C에서 원료(${carrierKey})와 용매(${solventKey}) 혼합물이 단일 균일 액상을 형성합니다 (Michelsen TPD_min = ${stab.tpdMin.toFixed(5)} >= 0, Plait-Point 초과 또는 완전 혼화 용매).`
    );
    const mostlySolv = solvMassTot > feedMassTot;
    return {
      converged: false,
      iterations: 1,
      extractFlowsKgH: mostlySolv ? totalInKg : zeroCompRecord(),
      raffinateFlowsKgH: mostlySolv ? zeroCompRecord() : totalInKg,
      extractTempC: tRefCheck,
      raffinateTempC: tRefCheck,
      soluteKey,
      soluteRecoveryPct: 0,
      massBalanceRelErr: 0,
      stageProfiles: [],
      statusNote: `단일 액상 완전 혼화(Single-Phase Washout / Plait-Point Flooding) 감지 — 상분리 불가`,
      warnings,
    };
  }

  const hFeedKJH = streamEnthalpyKcalH({}, feedKg, tFeed, operPressKgcm2g) * KJ_PER_KCAL;
  const hSolvKJH = streamEnthalpyKcalH({}, solvKg, tSolv, operPressKgcm2g) * KJ_PER_KCAL;

  const liqEnthFromMolKJH = (compMol: Record<SimCompKey, number>, tC: number): number => {
    const mKg = zeroCompRecord();
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      mKg[c] = Math.max(0, compMol[c] || 0) * (MW[c] || 18.015);
    }
    return streamEnthalpyKcalH({}, mKg, tC, operPressKgcm2g) * KJ_PER_KCAL;
  };

  const liqHeatCapKJK = (compMol: Record<SimCompKey, number>, tC: number): number => {
    const hPlus = liqEnthFromMolKJH(compMol, tC + 0.5);
    const hMinus = liqEnthFromMolKJH(compMol, tC - 0.5);
    return Math.max(1e-3, hPlus - hMinus);
  };

  // ── 2) 단일 단(N === 1) 엄밀 등활동도(Murphree 포함) 타이-라인 직접 해법 ──
  if (N === 1) {
    let tStage = useThermostat ? tOper : tRefCheck;
    const xRaf = zeroCompRecord();
    const xExt = zeroCompRecord();
    const xSolvIn = zeroCompRecord();
    let liqTotMol = 0;
    let saltTotMol = 0;

    for (const c of activeComps) {
      xSolvIn[c] = solvMolTot > 1e-14 ? solvMol[c] / solvMolTot : 0;
      if (NON_VOLATILE_ELECTROLYTES.has(c)) saltTotMol += totalInMol[c];
      else liqTotMol += totalInMol[c];
    }

    for (const c of activeComps) {
      if (NON_VOLATILE_ELECTROLYTES.has(c)) {
        xRaf[c] = carrierKey === 'H2O' ? totalInMol[c] : 0;
        xExt[c] = carrierKey === 'H2O' ? 0 : totalInMol[c];
      } else if (c === solventKey) {
        xExt[c] = Math.max(1e-8, 0.94 * totalInMol[c]);
        xRaf[c] = Math.max(1e-8, 0.06 * totalInMol[c]);
      } else if (c === carrierKey) {
        xRaf[c] = Math.max(1e-8, 0.94 * totalInMol[c]);
        xExt[c] = Math.max(1e-8, 0.06 * totalInMol[c]);
      } else {
        xExt[c] = 0.55 * totalInMol[c];
        xRaf[c] = 0.45 * totalInMol[c];
      }
    }

    const normVec = (v: Record<SimCompKey, number>) => {
      let s = 0;
      for (const c of activeComps) s += Math.max(0, v[c]);
      if (s > 1e-15) {
        for (const c of activeComps) v[c] = Math.max(0, v[c]) / s;
      }
    };
    normVec(xRaf);
    normVec(xExt);

    const kLL = zeroCompRecord();
    const betaIn = clamp(solvMolTot / totalMolIn, 0, 1);
    const betaMax = saltTotMol > 1e-12 && carrierKey === 'H2O' ? clamp(liqTotMol / totalMolIn, 1e-4, 0.9999) : 0.99999;
    let betaExt = clamp(solvMolTot / totalMolIn, 1e-4, betaMax);
    let iter1 = 0;
    let conv1 = false;

    for (let it = 0; it < 80; it++) {
      iter1 = it + 1;
      const gRaf = liquidActivityCoefficients(activeComps, xRaf, tStage, activityMethod);
      const gExt = liquidActivityCoefficients(activeComps, xExt, tStage, activityMethod);

      let maxRelK = 0;
      for (const c of activeComps) {
        if (NON_VOLATILE_ELECTROLYTES.has(c)) {
          kLL[c] = carrierKey === 'H2O' ? 0 : 1e6;
          continue;
        }
        const kRaw = clamp(Math.max(1e-8, gRaf[c]) / Math.max(1e-8, gExt[c]), 1e-6, 1e6);
        const prev = kLL[c] > 0 ? kLL[c] : kRaw;
        const wDamp = it === 0 ? 1.0 : 0.65;
        const kNext = Math.exp((1.0 - wDamp) * Math.log(prev) + wDamp * Math.log(kRaw));
        const rel = Math.abs(kNext - prev) / Math.max(1e-8, prev);
        if (rel > maxRelK) maxRelK = rel;
        kLL[c] = kNext;
      }

      const evalPsi1 = (b: number): number => {
        const bByp = etaLL < 0.999999 ? Math.min(b * (1.0 - etaLL), 0.999 * betaIn) : 0.0;
        let psi = 0;
        for (const c of activeComps) {
          const zi = totalInMol[c] / totalMolIn;
          const Ki = NON_VOLATILE_ELECTROLYTES.has(c) && carrierKey === 'H2O' ? 0.0 : kLL[c];
          if (b <= 1e-12) {
            psi += zi * (etaLL * Ki - 1.0) + (1.0 - etaLL) * xSolvIn[c];
          } else {
            const bOv = bByp / b;
            const den = Math.max(1e-14, 1.0 - b + (b - bByp) * Ki);
            psi += (zi * ((1.0 - bOv) * Ki - 1.0) + bOv * xSolvIn[c]) / den;
          }
        }
        return psi;
      };

      const pLo = evalPsi1(1e-6);
      const pHi = evalPsi1(betaMax);
      if (pLo <= 0 || pHi >= 0) {
        betaExt = pLo <= 0 ? 0.0 : betaMax;
      } else {
        let lo = 1e-6;
        let hi = betaMax;
        for (let bi = 0; bi < 36; bi++) {
          const mid = 0.5 * (lo + hi);
          const pm = evalPsi1(mid);
          if (Math.abs(pm) < 1e-12 || hi - lo < 1e-12) {
            lo = mid;
            hi = mid;
            break;
          }
          if (pm > 0) lo = mid;
          else hi = mid;
        }
        betaExt = 0.5 * (lo + hi);
      }

      const bByp = etaLL < 0.999999 ? Math.min(betaExt * (1.0 - etaLL), 0.999 * betaIn) : 0.0;
      for (const c of activeComps) {
        const zi = totalInMol[c] / totalMolIn;
        if (NON_VOLATILE_ELECTROLYTES.has(c) && carrierKey === 'H2O') {
          xRaf[c] = zi / Math.max(1e-12, 1.0 - betaExt);
          xExt[c] = 0;
        } else {
          const Ki = kLL[c];
          const xr = Math.max(0, zi - bByp * xSolvIn[c]) / Math.max(1e-14, 1.0 - betaExt + (betaExt - bByp) * Ki);
          xRaf[c] = xr;
          xExt[c] = betaExt > 1e-12 ? ((betaExt - bByp) * Ki * xr + bByp * xSolvIn[c]) / betaExt : Ki * xr;
        }
      }
      normVec(xRaf);
      normVec(xExt);

      if (!useThermostat && it % 2 === 1) {
        const extMolTmp = zeroCompRecord();
        const rafMolTmp = zeroCompRecord();
        for (const c of activeComps) {
          extMolTmp[c] = betaExt * totalMolIn * xExt[c];
          rafMolTmp[c] = (1.0 - betaExt) * totalMolIn * xRaf[c];
        }
        const hOut = liqEnthFromMolKJH(extMolTmp, tStage) + liqEnthFromMolKJH(rafMolTmp, tStage);
        const cpTot = liqHeatCapKJK(extMolTmp, tStage) + liqHeatCapKJK(rafMolTmp, tStage);
        tStage = clamp(tStage + (hFeedKJH + hSolvKJH - hOut) / cpTot, -30, 200);
      }

      if (it >= 4 && maxRelK < 1e-7) {
        conv1 = true;
        break;
      }
    }

    if (betaExt <= 1e-4 || betaExt >= betaMax - 1e-4) {
      warnings.push('단일 단 평형 계산 결과 한쪽 액상이 완전히 용해되어 상분리가 소멸했습니다 (Washout).');
      return {
        converged: false,
        iterations: iter1,
        extractFlowsKgH: betaExt > 0.5 ? totalInKg : zeroCompRecord(),
        raffinateFlowsKgH: betaExt > 0.5 ? zeroCompRecord() : totalInKg,
        extractTempC: tStage,
        raffinateTempC: tStage,
        soluteKey,
        soluteRecoveryPct: 0,
        massBalanceRelErr: 0,
        stageProfiles: [],
        statusNote: '단일 액상 용해(Washout)로 인해 2액상 추출 불성립',
        warnings,
      };
    }

    const extractFlowsKgH = zeroCompRecord();
    const raffinateFlowsKgH = zeroCompRecord();
    let extMass = 0;
    let rafMass = 0;
    const bByp = etaLL < 0.999999 ? Math.min(betaExt * (1.0 - etaLL), 0.999 * betaIn) : 0.0;

    for (const c of activeComps) {
      const mw = MW[c] || 18.015;
      if (NON_VOLATILE_ELECTROLYTES.has(c) && carrierKey === 'H2O') {
        extractFlowsKgH[c] = 0;
        raffinateFlowsKgH[c] = totalInKg[c];
      } else {
        const zi = totalInMol[c] / totalMolIn;
        const Ki = kLL[c];
        const xr = Math.max(0, zi - bByp * xSolvIn[c]) / Math.max(1e-14, 1.0 - betaExt + (betaExt - bByp) * Ki);
        const eMol = ((betaExt - bByp) * Ki * xr + bByp * xSolvIn[c]) * totalMolIn;
        const eKg = clamp(eMol * mw, 0, totalInKg[c]);
        extractFlowsKgH[c] = eKg;
        raffinateFlowsKgH[c] = totalInKg[c] - eKg;
      }
      extMass += extractFlowsKgH[c];
      rafMass += raffinateFlowsKgH[c];
    }

    const extractCompWtPct: Partial<Record<SimCompKey, number>> = {};
    const raffinateCompWtPct: Partial<Record<SimCompKey, number>> = {};
    const distributionK: Partial<Record<SimCompKey, number>> = {};
    let massErrAbs = 0;
    for (const c of activeComps) {
      extractCompWtPct[c] = extMass > 1e-12 ? (extractFlowsKgH[c] / extMass) * 100.0 : 0;
      raffinateCompWtPct[c] = rafMass > 1e-12 ? (raffinateFlowsKgH[c] / rafMass) * 100.0 : 0;
      distributionK[c] = kLL[c];
      massErrAbs += Math.abs(extractFlowsKgH[c] + raffinateFlowsKgH[c] - totalInKg[c]);
    }

    const soluteFeedKg = soluteKey ? Math.max(0, feedKg[soluteKey]) : 0;
    const soluteRecoveryPct =
      soluteKey && soluteFeedKg > 1e-12
        ? clamp(((extractFlowsKgH[soluteKey] - solvKg[soluteKey]) / soluteFeedKg) * 100.0, 0, 100)
        : 0;

    return {
      converged: conv1,
      iterations: iter1,
      extractFlowsKgH,
      raffinateFlowsKgH,
      extractTempC: tStage,
      raffinateTempC: tStage,
      soluteKey,
      soluteRecoveryPct,
      massBalanceRelErr: massErrAbs / Math.max(1e-9, totalMassIn),
      stageProfiles: [
        {
          stage: 1,
          tempC: tStage,
          extractMassKgH: extMass,
          raffinateMassKgH: rafMass,
          extractCompWtPct,
          raffinateCompWtPct,
          distributionK,
        },
      ],
      statusNote: `1단 액-액 추출 평형 수렴 완료 (${activityMethod}, 회수율 ${soluteRecoveryPct.toFixed(2)}%)`,
      warnings,
    };
  }

  // ── 3) 다단(2 <= N <= 50) 향류 액-액 추출탑 결합 MESH 해법 ──
  // 초기 조성 추정: 전체 혼합물의 단일 단 타이-라인으로 물리적 추잔상/추출상 활동도 시드 확보
  const xRafInit = zeroCompRecord();
  const xExtInit = zeroCompRecord();
  const xSolvFeed = zeroCompRecord();
  for (const c of activeComps) {
    xSolvFeed[c] = solvMolTot > 1e-14 ? solvMol[c] / solvMolTot : 0;
    if (NON_VOLATILE_ELECTROLYTES.has(c)) {
      xRafInit[c] = carrierKey === 'H2O' ? feedMol[c] / Math.max(1e-12, feedMolTot) : 0;
      xExtInit[c] = 0;
    } else if (c === solventKey) {
      xExtInit[c] = 0.92;
      xRafInit[c] = 0.015;
    } else if (c === carrierKey) {
      xRafInit[c] = 0.90;
      xExtInit[c] = 0.03;
    } else {
      const zf = feedMol[c] / Math.max(1e-12, feedMolTot);
      xRafInit[c] = 0.5 * zf;
      xExtInit[c] = 0.5 * zf;
    }
  }
  const normalizeComp = (obj: Record<SimCompKey, number>) => {
    let s = 0;
    for (let ci = 0; ci < nActive; ci++) s += Math.max(0, obj[activeComps[ci]]);
    if (s > 1e-15) {
      for (let ci = 0; ci < nActive; ci++) obj[activeComps[ci]] = Math.max(0, obj[activeComps[ci]]) / s;
    }
  };
  normalizeComp(xRafInit);
  normalizeComp(xExtInit);

  // 초기 K_LL 시드를 3회 고정점 반복으로 정교화
  for (let pre = 0; pre < 3; pre++) {
    const gr = liquidActivityCoefficients(activeComps, xRafInit, tRefCheck, activityMethod);
    const ge = liquidActivityCoefficients(activeComps, xExtInit, tRefCheck, activityMethod);
    for (const c of activeComps) {
      if (NON_VOLATILE_ELECTROLYTES.has(c)) continue;
      const kEst = clamp(Math.max(1e-8, gr[c]) / Math.max(1e-8, ge[c]), 1e-5, 1e5);
      const zAll = totalInMol[c] / totalMolIn;
      const bGuess = solvMolTot / totalMolIn;
      const xr = zAll / Math.max(1e-12, 1.0 + bGuess * (kEst - 1.0));
      xRafInit[c] = xr;
      xExtInit[c] = kEst * xr;
    }
    normalizeComp(xRafInit);
    normalizeComp(xExtInit);
  }

  const T = new Float64Array(N);
  const R = new Float64Array(N);
  const E = new Float64Array(N);
  const xRaf: Record<SimCompKey, number>[] = Array.from({ length: N }, () => ({ ...xRafInit }));
  const xExt: Record<SimCompKey, number>[] = Array.from({ length: N }, () => ({ ...xExtInit }));
  const K_LL: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());
  const lnKPrevX: Float64Array[] = Array.from({ length: N }, () => new Float64Array(nActive));
  const lnKGPrev: Float64Array[] = Array.from({ length: N }, () => new Float64Array(nActive));

  for (let j = 0; j < N; j++) {
    const frac = j / Math.max(1, N - 1);
    T[j] = useThermostat ? tOper : tFeed + frac * (tSolv - tFeed);
    R[j] = Math.max(1e-8, feedMolTot);
    E[j] = Math.max(1e-8, solvMolTot);

    const gr = liquidActivityCoefficients(activeComps, xRaf[j], T[j], activityMethod);
    const ge = liquidActivityCoefficients(activeComps, xExt[j], T[j], activityMethod);
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      if (NON_VOLATILE_ELECTROLYTES.has(c)) {
        K_LL[j][c] = carrierKey === 'H2O' ? 0 : 1e6;
      } else {
        K_LL[j][c] = clamp(Math.max(1e-8, gr[c]) / Math.max(1e-8, ge[c]), 1e-6, 1e6);
      }
      const lk = Math.log(Math.max(1e-12, K_LL[j][c] || 1e-12));
      lnKPrevX[j][ci] = lk;
      lnKGPrev[j][ci] = lk;
    }
  }

  const aVec = new Float64Array(N);
  const bVec = new Float64Array(N);
  const cVec = new Float64Array(N);
  const dVec = new Float64Array(N);
  const triCp = new Float64Array(N);
  const triDp = new Float64Array(N);
  const triSol = new Float64Array(N);
  const sStage = new Float64Array(N);
  const betaStage = new Float64Array(N);
  const etaEff = new Float64Array(N);

  const rStar: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());
  const eStar: Record<SimCompKey, number>[] = Array.from({ length: N }, () => zeroCompRecord());

  const FLOW_MIN = Math.max(1e-10, totalMolIn * 1e-9);

  const runThomasLLESolve = () => {
    for (let j = 0; j < N; j++) {
      const eInBelow = j < N - 1 ? E[j + 1] : solvMolTot;
      const bByp =
        eInBelow > 1e-12 && etaLL < 0.999999 ? Math.min(E[j] * (1.0 - etaLL), 0.999 * eInBelow) : 0.0;
      etaEff[j] = E[j] > 1e-12 ? clamp(1.0 - bByp / E[j], 0.02, 1.0) : 1.0;
    }

    for (let ci = 0; ci < nActive; ci++) {
      const comp = activeComps[ci];
      if (NON_VOLATILE_ELECTROLYTES.has(comp) && carrierKey === 'H2O') {
        const totSalt = feedMol[comp] + solvMol[comp];
        for (let j = 0; j < N; j++) {
          rStar[j][comp] = j < N - 1 ? feedMol[comp] : totSalt;
          eStar[j][comp] = 0;
        }
        continue;
      }

      for (let j = 0; j < N; j++) {
        sStage[j] = Math.max(1e-12, etaEff[j] * Math.max(1e-12, K_LL[j][comp]));
      }
      for (let j = 0; j < N - 1; j++) {
        betaStage[j] = etaEff[j] < 0.999999 ? ((1.0 - etaEff[j]) * sStage[j + 1]) / sStage[j] : 0.0;
      }
      betaStage[N - 1] = 0.0;

      const deltaBot =
        etaEff[N - 1] < 0.999999 ? ((1.0 - etaEff[N - 1]) * xSolvFeed[comp]) / sStage[N - 1] : 0.0;

      // Stage 0 (원료 유입단, 추출상 E_0 배출)
      aVec[0] = 0;
      bVec[0] = -(R[0] + E[0] * sStage[0]);
      cVec[0] = R[0] * betaStage[0] + E[1] * sStage[1];
      dVec[0] = -feedMol[comp];

      // 내부 단 1 .. N - 2
      for (let j = 1; j < N - 1; j++) {
        aVec[j] = R[j - 1];
        bVec[j] = -(R[j - 1] * betaStage[j - 1] + R[j] + E[j] * sStage[j]);
        cVec[j] = R[j] * betaStage[j] + E[j + 1] * sStage[j + 1];
        dVec[j] = 0;
      }

      // 최하단 N - 1 (추출용매 유입단, 추잔상 R_{N-1} 배출)
      aVec[N - 1] = R[N - 2];
      bVec[N - 1] = -(R[N - 2] * betaStage[N - 2] + R[N - 1] + E[N - 1] * sStage[N - 1]);
      cVec[N - 1] = 0;
      dVec[N - 1] = -(solvMol[comp] + R[N - 1] * deltaBot);

      const uSol = solveTridiagonalLLE(aVec, bVec, cVec, dVec, triCp, triDp, triSol);

      for (let j = 0; j < N - 1; j++) {
        const xrRaw = Math.max(0, uSol[j] - betaStage[j] * uSol[j + 1]);
        rStar[j][comp] = R[j] * xrRaw;
        eStar[j][comp] = E[j] * sStage[j] * Math.max(0, uSol[j]);
      }
      const xrBot = Math.max(0, uSol[N - 1] - deltaBot);
      rStar[N - 1][comp] = R[N - 1] * xrBot;
      eStar[N - 1][comp] = E[N - 1] * sStage[N - 1] * Math.max(0, uSol[N - 1]);
    }
  };

  const MAX_ITER = 150;
  let converged = false;
  let washoutDetected = false;
  let washoutStage = -1;
  let iterUsed = 0;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterUsed = iter + 1;

    runThomasLLESolve();

    let maxDeltaX = 0;
    let maxRelFlow = 0;
    const eSumStage = new Float64Array(N);
    const rSumStage = new Float64Array(N);

    const wComp = iter > 80 ? 0.35 : iter > 40 ? 0.55 : 0.78;
    const wFlow = iter > 80 ? 0.35 : iter > 40 ? 0.55 : 0.75;

    for (let j = 0; j < N; j++) {
      let sr = 0;
      let se = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        sr += rStar[j][c];
        se += eStar[j][c];
      }
      rSumStage[j] = sr;
      eSumStage[j] = se;

      if (sr > 1e-15) {
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          const xNew = rStar[j][c] / sr;
          const dx = xNew - xRaf[j][c];
          if (Math.abs(dx) > maxDeltaX) maxDeltaX = Math.abs(dx);
          xRaf[j][c] = Math.max(0, xRaf[j][c] + wComp * dx);
        }
        normalizeComp(xRaf[j]);
      }
      if (se > 1e-15) {
        for (let ci = 0; ci < nActive; ci++) {
          const c = activeComps[ci];
          const yNew = eStar[j][c] / se;
          const dy = yNew - xExt[j][c];
          if (Math.abs(dy) > maxDeltaX) maxDeltaX = Math.abs(dy);
          xExt[j][c] = Math.max(0, xExt[j][c] + wComp * dy);
        }
        normalizeComp(xExt[j]);
      }
    }

    // 수평 절단면 총괄 몰 연속식(Cut-plane Molar Continuity)을 보존하는 Sum-Rates 상유량 갱신
    for (let j = 0; j < N; j++) {
      const eTarget = Math.max(FLOW_MIN, eSumStage[j]);
      const relE = Math.abs(eTarget - E[j]) / Math.max(1e-6, totalMolIn);
      if (relE > maxRelFlow) maxRelFlow = relE;
      E[j] = (1.0 - wFlow) * E[j] + wFlow * eTarget;
    }
    let maxE0 = totalMolIn - FLOW_MIN;
    for (let j = 0; j < N - 1; j++) {
      maxE0 = Math.min(maxE0, E[j + 1] + feedMolTot - FLOW_MIN);
    }
    E[0] = clamp(E[0], FLOW_MIN, Math.max(FLOW_MIN, maxE0));
    for (let j = 0; j < N - 1; j++) {
      R[j] = Math.max(FLOW_MIN, E[j + 1] + feedMolTot - E[0]);
    }
    R[N - 1] = Math.max(FLOW_MIN, totalMolIn - E[0]);

    // 단별 액상 엔탈피 수지 (Newton-Thomas 3중대각 열수지 해석)
    let maxDeltaT = 0;
    if (!useThermostat && iter >= 1) {
      const aT = new Float64Array(N);
      const bT = new Float64Array(N);
      const cT = new Float64Array(N);
      const dT = new Float64Array(N);

      const cpRaf = new Float64Array(N);
      const cpExt = new Float64Array(N);
      const hRafOut = new Float64Array(N);
      const hExtOut = new Float64Array(N);

      for (let j = 0; j < N; j++) {
        cpRaf[j] = liqHeatCapKJK(rStar[j], T[j]);
        cpExt[j] = liqHeatCapKJK(eStar[j], T[j]);
        hRafOut[j] = liqEnthFromMolKJH(rStar[j], T[j]);
        hExtOut[j] = liqEnthFromMolKJH(eStar[j], T[j]);
      }

      for (let j = 0; j < N; j++) {
        const hIn =
          (j > 0 ? hRafOut[j - 1] : hFeedKJH) +
          (j < N - 1 ? hExtOut[j + 1] : hSolvKJH);
        const hOut = hRafOut[j] + hExtOut[j];
        aT[j] = j > 0 ? -cpRaf[j - 1] : 0;
        bT[j] = cpRaf[j] + cpExt[j];
        cT[j] = j < N - 1 ? -cpExt[j + 1] : 0;
        dT[j] = hIn - hOut;
      }

      const dTSol = solveTridiagonalLLE(aT, bT, cT, dT, triCp, triDp, triSol);
      for (let j = 0; j < N; j++) {
        const stepT = clamp(0.75 * dTSol[j], -8.0, 8.0);
        if (Math.abs(dTSol[j]) > maxDeltaT) maxDeltaT = Math.abs(dTSol[j]);
        T[j] = clamp(T[j] + stepT, -35.0, 220.0);
      }
    }

    // 단별 다성분 활동도 계수 재계산 및 Bounded Wegstein ln(K_LL) 가속 갱신
    let maxRelK = 0;
    let minTieLineDist = Infinity;
    let minPhaseFrac = 1.0;

    for (let j = 0; j < N; j++) {
      const gRaf = liquidActivityCoefficients(activeComps, xRaf[j], T[j], activityMethod);
      const gExt = liquidActivityCoefficients(activeComps, xExt[j], T[j], activityMethod);

      let tieDist = 0;
      for (let ci = 0; ci < nActive; ci++) {
        const c = activeComps[ci];
        tieDist += Math.abs(xExt[j][c] - xRaf[j][c]);
        if (NON_VOLATILE_ELECTROLYTES.has(c) && carrierKey === 'H2O') {
          K_LL[j][c] = 0;
          continue;
        }

        const kEval = clamp(Math.max(1e-8, gRaf[c]) / Math.max(1e-8, gExt[c]), 1e-6, 1e6);
        const gLnK = Math.log(kEval);
        const xLnKCurr = Math.log(Math.max(1e-12, K_LL[j][c]));

        let nextLnK: number;
        if (iter >= 3 && iter % 3 === 0) {
          const dx = xLnKCurr - lnKPrevX[j][ci];
          const dg = gLnK - lnKGPrev[j][ci];
          if (Math.abs(dx) > 1e-7) {
            const slope = dg / dx;
            // 안정적 수축 가속 범위 [-1.5, 0.72]로 제한된 Damped Wegstein 계수
            const qWeg = clamp(slope / (slope - 1.0), -0.65, 0.5);
            nextLnK = (1.0 - qWeg) * gLnK + qWeg * xLnKCurr;
          } else {
            nextLnK = 0.65 * gLnK + 0.35 * xLnKCurr;
          }
        } else {
          const wK = iter > 70 ? 0.42 : 0.68;
          nextLnK = (1.0 - wK) * xLnKCurr + wK * gLnK;
        }

        lnKPrevX[j][ci] = xLnKCurr;
        lnKGPrev[j][ci] = gLnK;

        const kNext = clamp(Math.exp(nextLnK), 1e-6, 1e6);
        const relK = Math.abs(kEval - K_LL[j][c]) / Math.max(1e-7, K_LL[j][c]);
        if (relK > maxRelK) maxRelK = relK;
        K_LL[j][c] = kNext;
      }

      if (tieDist < minTieLineDist) {
        minTieLineDist = tieDist;
        washoutStage = j + 1;
      }
      const totSt = R[j] + E[j];
      const phFrac = Math.min(R[j], E[j]) / Math.max(1e-12, totSt);
      if (phFrac < minPhaseFrac) minPhaseFrac = phFrac;
    }

    // 내부 단 Plait-Point 병합 / 상소멸(Washout) 감지
    if (iter >= 14 && (minTieLineDist < 0.015 || minPhaseFrac < 5e-4)) {
      washoutDetected = true;
      break;
    }

    if (
      iter >= 5 &&
      maxDeltaX < 1e-6 &&
      maxRelFlow < 1e-6 &&
      maxRelK < 5e-5 &&
      maxDeltaT < 0.005
    ) {
      converged = true;
      break;
    }
    if (
      iter >= 75 &&
      maxDeltaX < 5e-5 &&
      maxRelFlow < 5e-5 &&
      maxRelK < 1e-3 &&
      maxDeltaT < 0.05
    ) {
      converged = true;
      break;
    }
  }

  // 최종 수렴 시 정확히 1회 Thomas 3중대각 성분 수지 확정 (질량 오차 < 1e-14 보장)
  runThomasLLESolve();

  if (washoutDetected) {
    warnings.push(
      `제 ${washoutStage}단에서 고농도 용질 공용매 효과로 추잔상과 추출상의 타이-라인 길이가 소멸했습니다 (Plait-Point Flooding / Internal Washout). 추출용매 유량을 늘리거나 선택도가 높은 용매로 변경하세요.`
    );
  } else if (!converged) {
    warnings.push(
      `최대 반복 횟수(${MAX_ITER}회) 내에 허용 수렴 오차에 완전히 도달하지 못했습니다. 상분리 경계(Plait-Point) 근접 운전 여부를 확인하세요.`
    );
  }

  const extractFlowsKgH = zeroCompRecord();
  const raffinateFlowsKgH = zeroCompRecord();
  let massErrAbs = 0;

  for (let ci = 0; ci < nActive; ci++) {
    const c = activeComps[ci];
    const mw = MW[c] || 18.015;
    extractFlowsKgH[c] = eStar[0][c] * mw;
    raffinateFlowsKgH[c] = rStar[N - 1][c] * mw;
    massErrAbs += Math.abs(extractFlowsKgH[c] + raffinateFlowsKgH[c] - totalInKg[c]);
  }

  const massBalanceRelErr = massErrAbs / Math.max(1e-9, totalMassIn);

  const stageProfiles: ExtractorStageProfile[] = new Array(N);
  for (let j = 0; j < N; j++) {
    let extMassKg = 0;
    let rafMassKg = 0;
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      const mw = MW[c] || 18.015;
      extMassKg += eStar[j][c] * mw;
      rafMassKg += rStar[j][c] * mw;
    }
    const extractCompWtPct: Partial<Record<SimCompKey, number>> = {};
    const raffinateCompWtPct: Partial<Record<SimCompKey, number>> = {};
    const distributionK: Partial<Record<SimCompKey, number>> = {};
    for (let ci = 0; ci < nActive; ci++) {
      const c = activeComps[ci];
      const mw = MW[c] || 18.015;
      extractCompWtPct[c] = extMassKg > 1e-12 ? ((eStar[j][c] * mw) / extMassKg) * 100.0 : 0;
      raffinateCompWtPct[c] = rafMassKg > 1e-12 ? ((rStar[j][c] * mw) / rafMassKg) * 100.0 : 0;
      distributionK[c] = K_LL[j][c];
    }

    stageProfiles[j] = {
      stage: j + 1,
      tempC: T[j],
      extractMassKgH: extMassKg,
      raffinateMassKgH: rafMassKg,
      extractCompWtPct,
      raffinateCompWtPct,
      distributionK,
    };
  }

  const soluteFeedKg = soluteKey ? Math.max(0, feedKg[soluteKey]) : 0;
  const soluteRecoveryPct =
    soluteKey && soluteFeedKg > 1e-12
      ? clamp(((extractFlowsKgH[soluteKey] - solvKg[soluteKey]) / soluteFeedKg) * 100.0, 0, 100)
      : 0;

  const finalConverged = converged && !washoutDetected;
  const statusNote = washoutDetected
    ? `내부 단(Stage ${washoutStage}) Plait-Point 상병합(Washout) 감지로 미수렴 처리됨`
    : finalConverged
      ? `${N}단 향류 액-액 추출 MESH 수렴 완료 (${activityMethod}${etaLL < 0.999 ? `, η=${(etaLL * 100).toFixed(0)}%` : ''}${useThermostat ? ', 항온 운전' : ', 단별 열수지 반영'}, ${iterUsed}회 반복, 회수율 ${soluteRecoveryPct.toFixed(2)}%)`
      : `${N}단 향류 액-액 추출 미수렴 (${iterUsed}회 반복)`;

  return {
    converged: finalConverged,
    iterations: iterUsed,
    extractFlowsKgH,
    raffinateFlowsKgH,
    extractTempC: T[0],
    raffinateTempC: T[N - 1],
    soluteKey,
    soluteRecoveryPct,
    massBalanceRelErr,
    stageProfiles,
    statusNote,
    warnings,
  };
}

// ============================================================================
// 클라이언트 전용 AI · 폐루프 물리 최적화 어드바이저
// - 정적 배포(output: 'export') 100% 호환 (서버 /api 라우트 없음)
// - 열교환기(ΔP/Ft/FIV), 다단 증류탑(MESH/D/F/단수/환류/스펙), 컬럼 인터널(범람/차압) 자동 해결
// - 선택적 브라우저 Gemini 2.5 Flash 자문 (localStorage CHEMPRO_GEMINI_KEY 존재 시)
// ============================================================================

import { COMP_CATALOG_META } from './componentCatalog';
import {
  solveHeatExchangerDesign,
  type HxDesignParams,
  type HxDesignSolveResult,
} from './heatExchangerDesign';
import {
  solveRigorousDistillation,
  type DistillColumnParams,
  type DistillFeedInput,
  type DistillSolveResult,
} from './rigorousDistillation';
import {
  solveColumnInternalsDesign,
  type ColumnInternalsParams,
  type ColumnInternalsSolveResult,
} from './columnInternalsDesign';
import type {
  FlowUnitParams,
  FlowUnitType,
  SimCompKey,
  SolvedStream,
  SolvedUnitResult,
} from './flowsheetSolver';

export interface EquipmentAutoFixResult<TPatch, TSolve> {
  improved: boolean;
  resolved: boolean;
  patch: Partial<TPatch>;
  solvedBefore: TSolve;
  solvedAfter: TSolve;
  headline: string;
  rootCauses: string[];
  actionsTaken: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 16));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function scoreHxResult(r: HxDesignSolveResult): number {
  let pen = 0;
  if (r.overallStatus === 'error') pen += 1000;
  else if (r.overallStatus === 'warning') pen += 250;
  if (r.dpTubeBar > 0.7) pen += (r.dpTubeBar - 0.7) * 400 + 80;
  if (r.dpShellBar > 0.7) pen += (r.dpShellBar - 0.7) * 400 + 80;
  if (r.ftFactor < 0.78) pen += (0.78 - r.ftFactor) * 900 + 90;
  if (r.vibRatio > 0.8) pen += (r.vibRatio - 0.8) * 500 + 70;
  if (r.actualOverdesignPct < 0) pen += Math.abs(r.actualOverdesignPct) * 15 + 120;
  if (r.material.code !== r.recommendedMaterial) pen += 40;
  return pen;
}

/**
 * 열교환기 폐루프 AI · 물리 자동 해결기
 * - 튜브 ΔP (>0.7 bar) -> tubePasses 감소 / tubeLengthM 단축 / tubeOdMm 확대 / PHE 판간격 확대
 * - 쉘 ΔP (>0.7 bar) 또는 FIV 진동 (vibRatio>0.8) -> baffleSpacingRatio 증가 / baffleCutPct 확대 / 45°·90° 피치
 * - 온도교차 낮은 Ft (<0.78) -> 직렬 동체(shellCount) 증가 또는 1-패스 순향류 전환
 * - 부식/재질 경고 -> recommendedMaterial 자동 적용
 */
export function autoFixHeatExchanger(
  unitType: FlowUnitType,
  params: FlowUnitParams,
  initialCfg: HxDesignParams,
  procInStreams: SolvedStream[],
  procOutStreams: SolvedStream[],
  utilInStreams: SolvedStream[],
  utilOutStreams: SolvedStream[],
  unitRes?: SolvedUnitResult
): EquipmentAutoFixResult<HxDesignParams, HxDesignSolveResult> {
  const solvedBefore = solveHeatExchangerDesign(
    unitType,
    params,
    initialCfg,
    procInStreams,
    procOutStreams,
    utilInStreams,
    utilOutStreams,
    unitRes
  );

  const rootCauses: string[] = [];
  if (solvedBefore.dpTubeBar > 0.7) {
    rootCauses.push(
      `튜브측 차압 과다 (${solvedBefore.dpTubeBar.toFixed(2)} bar > 0.70 bar): ΔP는 (패스 수)³·(관길이)에 비례하므로 튜브 패스 수 감소·관길이 단축·관경(OD) 상향이 핵심입니다.`
    );
  }
  if (solvedBefore.dpShellBar > 0.7) {
    rootCauses.push(
      `쉘측 차압 과다 (${solvedBefore.dpShellBar.toFixed(2)} bar > 0.70 bar): 배플 간격비(B/Ds)와 배플 컷(%)이 좁아 교차류 저항이 증가했습니다.`
    );
  }
  if (solvedBefore.vibRatio > 0.8) {
    rootCauses.push(
      `유체유발 진동(FIV) 위험 (${(solvedBefore.vibRatio * 100).toFixed(0)}% ≥ 80%): 배플 스팬 유속이 과도하므로 배플 간격·유로 각도 조정이 필요합니다.`
    );
  }
  if (solvedBefore.ftFactor < 0.78) {
    rootCauses.push(
      `LMTD 보정계수 저하 (Ft=${solvedBefore.ftFactor.toFixed(3)} < 0.78): 온도 교차(Temperature Cross)가 발생해 직렬 쉘 수 증가 또는 1-패스 전환이 필요합니다.`
    );
  }
  if (solvedBefore.actualOverdesignPct < 0) {
    rootCauses.push(
      `전열면적 부족 (여유율 ${solvedBefore.actualOverdesignPct.toFixed(1)}% < 0%): 정격(Rating) 기하 면적이 요구 부하보다 작습니다.`
    );
  }
  if (solvedBefore.material.code !== solvedBefore.recommendedMaterial) {
    rootCauses.push(
      `유체 부식성 대비 재질 미스매치 (${solvedBefore.material.code} → 권장 ${solvedBefore.recommendedMaterial}).`
    );
  }
  if (rootCauses.length === 0 && solvedBefore.diagnostics.length > 0) {
    for (const d of solvedBefore.diagnostics) {
      if (d.level !== 'ok') rootCauses.push(d.message);
    }
  }

  let bestCfg: HxDesignParams = { ...initialCfg };
  let bestRes = solvedBefore;
  let bestScore = scoreHxResult(solvedBefore);
  const actionsTaken: string[] = [];

  const tryPatch = (patch: Partial<HxDesignParams>, reason: string): boolean => {
    const nextCfg: HxDesignParams = { ...bestCfg, ...patch };
    const candidate = solveHeatExchangerDesign(
      unitType,
      params,
      nextCfg,
      procInStreams,
      procOutStreams,
      utilInStreams,
      utilOutStreams,
      unitRes
    );
    const sc = scoreHxResult(candidate);
    if (sc < bestScore - 1e-3) {
      bestCfg = nextCfg;
      bestRes = candidate;
      bestScore = sc;
      actionsTaken.push(reason);
      return true;
    }
    return false;
  };

  // 진단 자체 remedyPatch 우선 시도
  for (const d of solvedBefore.diagnostics) {
    if (d.level !== 'ok' && d.remedyPatch) {
      tryPatch(d.remedyPatch, d.remedyLabel ?? '진단 권장 처방 적용');
    }
  }

  // 폐루프 다중 스텝 최적화 (최대 6회)
  for (let step = 0; step < 6; step++) {
    if (bestRes.overallStatus === 'ok' && bestScore <= 1) break;
    let progressed = false;

    if (bestRes.material.code !== bestRes.recommendedMaterial) {
      progressed =
        tryPatch(
          { material: bestRes.recommendedMaterial },
          `내식 재질 자동 변경 (${bestRes.material.code} → ${bestRes.recommendedMaterial})`
        ) || progressed;
    }

    if (bestRes.hxKind === 'plate_phe') {
      if (bestRes.dpTubeBar > 0.7 || bestRes.dpShellBar > 0.7) {
        const curGap = bestCfg.pheGapMm ?? 3.5;
        if (curGap < 5.0) {
          const nextGap = Number(Math.min(5.0, curGap + 0.7).toFixed(1));
          progressed =
            tryPatch(
              { pheGapMm: nextGap, pheChevronDeg: 30 },
              `PHE 판간격 확대 (${curGap}→${nextGap} mm) · 저차압 30° 쉐브론`
            ) || progressed;
        }
        if (bestRes.dpTubeBar > 0.7 || bestRes.dpShellBar > 0.7) {
          progressed =
            tryPatch(
              { hxKind: 'shell_tube', temaType: 'AES', tubePasses: 2, tubeOdMm: 25.4, tubeLengthM: 3.66 },
              '고유량·고차압 조건에 맞춰 TEMA 다관원통형(Shell & Tube)으로 전환'
            ) || progressed;
        }
      }
    } else {
      // Shell & Tube 규칙 기반 수렴 루프
      if (bestRes.designMode === 'rating' && bestRes.actualOverdesignPct < 0) {
        progressed =
          tryPatch(
            { designMode: 'design', designMarginPct: 15 },
            '면적 부족 정격(Rating) 해제 → 요구면적 자동 사이징 전환 (여유율 +15%)'
          ) || progressed;
      }

      if (bestRes.ftFactor < 0.78) {
        const curShells = bestCfg.shellCount ?? bestRes.shellCount ?? 1;
        if (curShells < 4) {
          const nextShells = curShells + 1;
          progressed =
            tryPatch(
              { shellCount: nextShells },
              `직렬 동체(Shell) 증설 (${curShells}→${nextShells}기)로 Ft 향상`
            ) || progressed;
        } else if ((bestCfg.tubePasses ?? bestRes.tubePasses) !== 1) {
          progressed =
            tryPatch({ tubePasses: 1, temaType: 'BEM' }, '순수 향류 1-Tube Pass 전환 (Ft = 1.0)') || progressed;
        }
      }

      if (bestRes.dpTubeBar > 0.7) {
        const curPass = bestCfg.tubePasses ?? bestRes.tubePasses ?? 2;
        if (curPass > 2) {
          const nextPass: 1 | 2 | 4 = curPass === 6 ? 4 : 2;
          progressed =
            tryPatch({ tubePasses: nextPass }, `튜브 패스 수 감소 (${curPass}→${nextPass} pass)로 튜브 ΔP 대폭 저감`) ||
            progressed;
        } else if ((bestCfg.tubeOdMm ?? bestRes.tubeOdMm) < 25.4) {
          progressed =
            tryPatch({ tubeOdMm: 25.4 }, `튜브 외경 확대 (${bestRes.tubeOdMm}→25.4 mm)로 유속·ΔP 완화`) || progressed;
        } else if ((bestCfg.tubeLengthM ?? bestRes.tubeLengthM) > 3.05) {
          const nextLen: 2.44 | 3.05 | 3.66 | 4.88 =
            bestRes.tubeLengthM >= 6.0 ? 4.88 : bestRes.tubeLengthM >= 4.8 ? 3.66 : 3.05;
          progressed =
            tryPatch({ tubeLengthM: nextLen }, `튜브 길이 단축 (${bestRes.tubeLengthM}→${nextLen} m)`) || progressed;
        } else if (curPass === 2) {
          progressed = tryPatch({ tubePasses: 1 }, '1-Tube Pass 전환으로 튜브측 차압 최소화') || progressed;
        }
      }

      if (bestRes.dpShellBar > 0.7 || bestRes.vibRatio > 0.8) {
        const curRatio = bestCfg.baffleSpacingRatio ?? 0.45;
        const curCut = bestCfg.baffleCutPct ?? bestRes.baffleCutPct ?? 25;
        const nextRatio = Number(Math.min(0.85, curRatio + 0.15).toFixed(2));
        const nextCut = Math.min(40, Math.max(curCut, 32));
        progressed =
          tryPatch(
            {
              baffleSpacingRatio: nextRatio,
              baffleCutPct: nextCut,
              pitchAngle: bestRes.vibRatio > 0.8 ? 90 : bestCfg.pitchAngle ?? 45,
            },
            `배플 간격비 확대 (B/Ds=${curRatio.toFixed(2)}→${nextRatio.toFixed(2)}) · 컷 ${nextCut}%로 쉘 ΔP/진동 완화`
          ) || progressed;
      }
    }

    if (!progressed) break;
  }

  const patch: Partial<HxDesignParams> = {};
  (Object.keys(bestCfg) as Array<keyof HxDesignParams>).forEach((k) => {
    if (bestCfg[k] !== initialCfg[k]) {
      (patch as Record<string, unknown>)[k] = bestCfg[k];
    }
  });

  const improved = bestScore < scoreHxResult(solvedBefore) - 1e-3;
  const resolved = bestRes.overallStatus === 'ok';
  const headline = resolved
    ? `AI 자동 보정 완료: 정상 운전 범위 달성 (Tube ΔP ${bestRes.dpTubeBar.toFixed(2)} bar, Shell ΔP ${bestRes.dpShellBar.toFixed(2)} bar, Ft ${bestRes.ftFactor.toFixed(2)}).`
    : improved
    ? `AI 부분 개선 완료 (Tube ΔP ${solvedBefore.dpTubeBar.toFixed(2)}→${bestRes.dpTubeBar.toFixed(2)} bar, Shell ΔP ${solvedBefore.dpShellBar.toFixed(2)}→${bestRes.dpShellBar.toFixed(2)} bar).`
    : '현재 열부하·상변화 조건에서 기하학적 조정 여지가 제한적입니다 (공정 유량·핀치 온도 점검 필요).';

  return {
    improved,
    resolved,
    patch,
    solvedBefore,
    solvedAfter: bestRes,
    headline,
    rootCauses,
    actionsTaken: actionsTaken.length > 0 ? actionsTaken : ['현재 운전 파라미터가 물리적 최적 상태에 가깝습니다.'],
  };
}

export async function autoFixHeatExchangerAsync(
  unitType: FlowUnitType,
  params: FlowUnitParams,
  initialCfg: HxDesignParams,
  procInStreams: SolvedStream[],
  procOutStreams: SolvedStream[],
  utilInStreams: SolvedStream[],
  utilOutStreams: SolvedStream[],
  unitRes?: SolvedUnitResult,
  onProgress?: (step: number, total: number, label: string) => void
): Promise<EquipmentAutoFixResult<HxDesignParams, HxDesignSolveResult>> {
  onProgress?.(1, 2, '열교환기 차압·Ft·유체유발진동(FIV) 원인 분석 중...');
  await yieldToBrowser();
  const res = autoFixHeatExchanger(
    unitType,
    params,
    initialCfg,
    procInStreams,
    procOutStreams,
    utilInStreams,
    utilOutStreams,
    unitRes
  );
  onProgress?.(2, 2, '최적 열교환기 기하 규격 도출 완료');
  await yieldToBrowser();
  return res;
}

function countProfileSawtoothReversals(r: DistillSolveResult): number {
  const st = r.stages;
  if (!st || st.length < 5) return 0;
  let rev = 0;
  const feedSt = r.feedStageUsed ?? -99;
  const watchComps: SimCompKey[] = ['ECH', 'H2O', 'DCP', 'DCH', 'HCl', 'Cl2', 'MeOH', 'EtOH'];
  for (let j = 1; j < st.length - 1; j++) {
    if (Math.abs(st[j].stage - feedSt) <= 1) continue;
    const dtPrev = st[j].tempC - st[j - 1].tempC;
    const dtNext = st[j].tempC - st[j + 1].tempC;
    if (Math.abs(dtPrev) > 0.6 && Math.abs(dtNext) > 0.6 && dtPrev * dtNext > 0) rev++;
    for (let k = 0; k < watchComps.length; k++) {
      const ck = watchComps[k];
      const dxPrev = (st[j].xWtPct[ck] || 0) - (st[j - 1].xWtPct[ck] || 0);
      const dxNext = (st[j].xWtPct[ck] || 0) - (st[j + 1].xWtPct[ck] || 0);
      if (Math.abs(dxPrev) > 2.0 && Math.abs(dxNext) > 2.0 && dxPrev * dxNext > 0) {
        rev++;
        break;
      }
    }
  }
  return rev;
}

function scoreDistillResult(r: DistillSolveResult): number {
  let pen = 0;
  if (!r.converged) pen += 2000;
  if (!r.dofValid) pen += 1200;
  if (r.diagnostics.level === 'error') pen += 800;
  else if (r.diagnostics.level === 'warning') pen += 200;

  if (r.shortcutDesign && !r.shortcutDesign.designMet) {
    if (!r.shortcutDesign.topSpecMet) pen += 350;
    if (!r.shortcutDesign.botSpecMet) pen += 350;
    pen += Math.max(10, Math.abs((r.shortcutDesign.targetTopPurityWtPct ?? 99) - (r.shortcutDesign.topLkPurityWtPct ?? 0))) * 5;
  }
  const addSpecPen = (st?: DistillSolveResult['spec1Status']) => {
    if (!st || !st.enabled || st.met) return;
    const rel = Math.abs(st.target - st.actual) / Math.max(1, Math.abs(st.target));
    pen += 120 + rel * 500;
  };
  addSpecPen(r.spec1Status);
  addSpecPen(r.spec2Status);
  if (r.actualRefluxRatio > 15) {
    pen += Math.min(400, (r.actualRefluxRatio - 15) * 10);
  }
  if (r.totalStagesUsed > 60) {
    pen += (r.totalStagesUsed - 60) * 6;
  }
  if (r.actualDOverFMass < 0.002) {
    pen += 450;
  }
  pen += countProfileSawtoothReversals(r) * 60;
  return pen;
}

interface DistillCandidateStep {
  label: string;
  progressText: string;
  buildPatch: (curParams: DistillColumnParams, curSol: DistillSolveResult) => Partial<DistillColumnParams> | null;
}

function prepareDistillFixContext(
  feedsInput: DistillFeedInput[],
  initialParams: DistillColumnParams,
  solvedBefore: DistillSolveResult
) {
  const feedTotals = {} as Record<SimCompKey, number>;
  let totalFeedKgH = 0;
  for (const f of feedsInput) {
    for (const [k, v] of Object.entries(f.flowsKgH || {})) {
      if (!v || v <= 0) continue;
      const ck = k as SimCompKey;
      feedTotals[ck] = (feedTotals[ck] || 0) + v;
      totalFeedKgH += v;
    }
  }
  const activeComps = (Object.keys(feedTotals) as SimCompKey[])
    .filter((k) => (feedTotals[k] || 0) > 1e-6)
    .sort((a, b) => (COMP_CATALOG_META[a]?.tbC ?? 100) - (COMP_CATALOG_META[b]?.tbC ?? 100));

  const hasWater = (feedTotals.H2O || 0) > 1e-3;
  const hydroKeys: SimCompKey[] = ['ECH', 'DCP', 'DCH', 'CHCl3', 'EtOAc', 'Benzene', 'Toluene', 'pXylene'];
  const hasHydroOrg = hydroKeys.some((k) => (feedTotals[k] || 0) > 1e-3);

  const topKey =
    initialParams.topQualityComp ??
    initialParams.designLkComp ??
    initialParams.spec1?.component ??
    activeComps[0];
  const botKey =
    initialParams.botQualityComp ??
    initialParams.designHkComp ??
    initialParams.spec2?.component ??
    activeComps[activeComps.length - 1];

  const tbTop = topKey ? COMP_CATALOG_META[topKey]?.tbC ?? 100 : 100;
  const estDfComps = new Set<SimCompKey>();
  for (const k of activeComps) {
    if ((COMP_CATALOG_META[k]?.tbC ?? 999) <= tbTop + 1) estDfComps.add(k);
  }
  // 불균일 수분-유기염소 공비계(ECH/DCP/DCH+H2O)는 상부 공비 디캔터로 회수되므로 수분 및 공비 동반 유기물 캐리어 여유분을 D/F 추정에 포함
  if (hasWater && hasHydroOrg && topKey !== botKey) {
    estDfComps.add('H2O');
  }
  const baseLightMassKgH = activeComps.reduce((s, k) => (estDfComps.has(k) ? s + (feedTotals[k] || 0) : s), 0);
  const azeoCarrierKgH =
    hasWater && hasHydroOrg && topKey !== botKey ? Math.min(totalFeedKgH * 0.12, (feedTotals.H2O || 0) * 2.4) : 0;
  const estDfMass = clamp((baseLightMassKgH + azeoCarrierKgH) / Math.max(1e-6, totalFeedKgH), 0.02, 0.98);

  const rootCauses: string[] = [...solvedBefore.diagnostics.causes];
  const revCount = countProfileSawtoothReversals(solvedBefore);
  if (revCount > 0) {
    rootCauses.push(`단별 조성·온도 프로파일에 교번 톱니 진동(${revCount}개소) 감지: 고환류·수분 트랩 또는 미수렴 MESH 상태.`);
  }
  const steps: DistillCandidateStep[] = [];

  // 1) 수분-유기물 불균일 공비계 최우선 처방: 디캔터(decanter_ech) + NRTL + 폭주 단수/환류 초기화
  if (hasWater && hasHydroOrg) {
    steps.push({
      label: '수분-유기물 불균일 공비 분리용 디캔터(decanter_ech) · NRTL 및 안정 단수·유출비 적용',
      progressText: '공비 유수분리 디캔터(decanter_ech) · NRTL 수렴 탐색 중...',
      buildPatch: (curP, curS) => {
        const modeNow = curP.columnCalcMode ?? 'rigorous_mesh';
        const needsDesignReset =
          modeNow === 'design_stages' &&
          (curS.actualRefluxRatio > 10 || (curP.totalStages ?? 24) > 56 || curS.totalStagesUsed > 56);
        const needsMeshReset =
          modeNow === 'rigorous_mesh' &&
          ((curP.totalStages ?? 24) > 52 ||
            curS.totalStagesUsed > 52 ||
            curS.actualRefluxRatio > 14 ||
            curS.actualDOverFMass < estDfMass * 0.75);
        return {
          condenserType: 'decanter_ech',
          thermoModel: 'NRTL',
          ...(needsDesignReset ? { designRefluxMode: 'r_mult', designRefluxMult: 1.35 } : {}),
          ...(needsMeshReset
            ? {
                totalStages: 24,
                feedStage: 12,
                activeDofSlots: ['rr', 'split'] as DistillColumnParams['activeDofSlots'],
                topSpecType: 'reflux_ratio' as const,
                topSpecValue: 2.5,
                splitSpecType: 'd_over_f_mass' as const,
                splitSpecValue: Number(estDfMass.toFixed(4)),
              }
            : {}),
        };
      },
    });
  }

  // 2) 진단 자체의 처방 평가 (최대 2건, 단순 design_stages 전환은 하단 전용 후보에서 처리)
  for (const rem of solvedBefore.diagnostics.remedies.slice(0, 2)) {
    if (rem.patch.columnCalcMode === 'design_stages') continue;
    steps.push({
      label: rem.label,
      progressText: `진단 처방 검증 중: ${rem.label}`,
      buildPatch: () => rem.patch,
    });
  }

  // 3) Candidate B: design_stages 모드 환류비 배수 초기화 및 과잉 회수율(≥99.2%) 현실화
  if ((initialParams.columnCalcMode ?? 'rigorous_mesh') === 'design_stages') {
    steps.push({
      label: '자동설계 환류비(1.35·R_min) 초기화로 과잉 단수/환류 팽창 해소',
      progressText: '자동설계 환류배수(1.35×R_min) 재산정 중...',
      buildPatch: (curP) => ({
        condenserType: hasWater && hasHydroOrg ? 'decanter_ech' : curP.condenserType ?? 'total',
        thermoModel: hasWater && hasHydroOrg ? 'NRTL' : curP.thermoModel ?? 'NRTL',
        designRefluxMode: 'r_mult',
        designRefluxMult: 1.35,
      }),
    });

    if ((initialParams.designTopRecoveryPct ?? 99) > 99.0 || (initialParams.designBotRecoveryPct ?? 99) > 99.2) {
      steps.push({
        label: '공비·다성분 핀치 구간 회피를 위해 탑정/탑저 회수율 목표 99.0% 최적화',
        progressText: '공비 핀치 회피용 현실 회수율(99.0%) 탐색 중...',
        buildPatch: (curP) => ({
          condenserType: hasWater && hasHydroOrg ? 'decanter_ech' : curP.condenserType ?? 'total',
          thermoModel: hasWater && hasHydroOrg ? 'NRTL' : curP.thermoModel ?? 'NRTL',
          designRefluxMode: 'r_mult',
          designRefluxMult: 1.35,
          designTopRecoveryPct: Math.min(99.0, curP.designTopRecoveryPct ?? 99.0),
          designBotRecoveryPct: Math.min(99.0, curP.designBotRecoveryPct ?? 99.0),
        }),
      });
    }
  }

  // 4) Candidate C: 깨진 74단·RR=48.45 승계 없이 안정화된 단수(24/32단) · 정밀모사 전환 탐색
  for (const [nCand, rrCand] of [
    [24, 2.5],
    [32, 4.0],
  ] as const) {
    const fOpt = Math.round(nCand * 0.5);
    steps.push({
      label: `안정화 정밀모사 적용 (${nCand}단 · 공급단 ${fOpt}단 · RR=${rrCand} · D/F=${estDfMass.toFixed(3)})`,
      progressText: `정밀모사 안정화 탐색 (${nCand}단 · RR=${rrCand} · D/F=${estDfMass.toFixed(3)})...`,
      buildPatch: (curP) => ({
        columnCalcMode: 'rigorous_mesh',
        condenserType: hasWater && hasHydroOrg ? 'decanter_ech' : curP.condenserType ?? 'total',
        thermoModel: hasWater && hasHydroOrg ? 'NRTL' : curP.thermoModel ?? 'NRTL',
        totalStages: nCand,
        feedStage: fOpt,
        activeDofSlots: ['rr', 'split'],
        topSpecType: 'reflux_ratio',
        topSpecValue: rrCand,
        splitSpecType: 'd_over_f_mass',
        splitSpecValue: Number(estDfMass.toFixed(4)),
      }),
    });
  }

  // 5) Candidate D: 원래 rigorous_mesh였으나 미수렴 시 design_stages 전환 및 고비점 비핵심 성분 보완
  if ((initialParams.columnCalcMode ?? 'rigorous_mesh') !== 'design_stages' && topKey && botKey) {
    steps.push({
      label: '목표순도 기반 Fenske-Underwood 자동단수 설계 모드로 전환',
      progressText: 'Fenske-Underwood 자동단수 설계 전환 검증 중...',
      buildPatch: () => ({
        columnCalcMode: 'design_stages',
        condenserType: hasWater && hasHydroOrg ? 'decanter_ech' : initialParams.condenserType ?? 'total',
        thermoModel: hasWater && hasHydroOrg ? 'NRTL' : initialParams.thermoModel ?? 'NRTL',
        designLkComp: topKey,
        designHkComp: botKey,
        designRefluxMode: 'r_mult',
        designRefluxMult: 1.35,
      }),
    });
  }

  if (botKey) {
    const tbBot = COMP_CATALOG_META[botKey]?.tbC ?? 120;
    const heavierMass = activeComps.reduce(
      (s, k) => (k !== botKey && (COMP_CATALOG_META[k]?.tbC ?? 0) > tbBot + 5 ? s + (feedTotals[k] || 0) : s),
      0
    );
    if (heavierMass > 0.05) {
      rootCauses.push(
        `원료에 [${botKey}]보다 비점이 높은 성분(${heavierMass.toFixed(1)} kg/h)이 포함되어 탑저 [${botKey}] 순도(wt%)가 물리적으로 제한됩니다.`
      );
      steps.push({
        label: `탑저 [${botKey}] 스펙을 '회수율 99.0%' 기준으로 현실화 (고비점 성분 공존 반영)`,
        progressText: `고비점 공존 반영 [${botKey}] 회수율 99.0% 기준 평가 중...`,
        buildPatch: () => ({
          designBotBasis: 'recovery_pct',
          designBotRecoveryPct: 99.0,
          botQualityComp: botKey,
          botQualityMetric: 'recovery_pct',
          botQualityTarget: 99.0,
        }),
      });
    }
  }

  return { rootCauses, steps };
}

function finalizeDistillFixResult(
  initialParams: DistillColumnParams,
  solvedBefore: DistillSolveResult,
  bestParams: DistillColumnParams,
  bestSol: DistillSolveResult,
  bestScore: number,
  rootCauses: string[],
  actionsTaken: string[]
): EquipmentAutoFixResult<DistillColumnParams, DistillSolveResult> {
  const patch: Partial<DistillColumnParams> = {};
  (Object.keys(bestParams) as Array<keyof DistillColumnParams>).forEach((k) => {
    if (bestParams[k] !== initialParams[k]) {
      (patch as Record<string, unknown>)[k] = bestParams[k];
    }
  });

  const improved = bestScore < scoreDistillResult(solvedBefore) - 1e-3;
  const resolved =
    bestSol.converged &&
    bestSol.diagnostics.level === 'ok' &&
    countProfileSawtoothReversals(bestSol) === 0 &&
    bestSol.actualRefluxRatio <= 20 &&
    bestSol.totalStagesUsed <= 60;
  const headline = resolved
    ? `AI 자동 해결 완료: ${bestSol.totalStagesUsed}단 · RR=${bestSol.actualRefluxRatio.toFixed(2)} · D/F=${bestSol.actualDOverFMass.toFixed(3)} 조건에서 수렴 및 스펙 달성.`
    : improved
    ? `AI 조건 개선 완료 (${bestSol.totalStagesUsed}단 · RR=${bestSol.actualRefluxRatio.toFixed(2)} · D/F=${bestSol.actualDOverFMass.toFixed(3)}): ${bestSol.diagnostics.headline}`
    : `현재 설정에서 자동 수렴 조건을 찾지 못했습니다 — 원료 조성·목표 스펙의 물리적 실현 가능성(공비/비핵심 고비점 유분)을 확인하세요.`;

  return {
    improved,
    resolved,
    patch,
    solvedBefore,
    solvedAfter: bestSol,
    headline,
    rootCauses: Array.from(new Set(rootCauses)),
    actionsTaken: actionsTaken.length > 0 ? actionsTaken : ['단수·환류·D/F 조합 탐색 완료'],
  };
}

/**
 * 다단 증류탑 폐루프 AI · 물리 자동 해결기 (동기 버전)
 */
export function autoFixDistillationSimulation(
  feedsInput: DistillFeedInput[],
  initialParams: DistillColumnParams
): EquipmentAutoFixResult<DistillColumnParams, DistillSolveResult> {
  const fixStartMs = Date.now();
  const solvedBefore = solveRigorousDistillation(feedsInput, initialParams);
  const { rootCauses, steps } = prepareDistillFixContext(feedsInput, initialParams, solvedBefore);

  let bestParams: DistillColumnParams = { ...initialParams };
  let bestSol = solvedBefore;
  let bestScore = scoreDistillResult(solvedBefore);
  const actionsTaken: string[] = [];
  let evals = 1;
  const loopStartMs = Date.now();

  for (const st of steps) {
    if (
      bestScore <= 1 ||
      (bestSol.converged &&
        bestSol.diagnostics.level === 'ok' &&
        bestSol.totalStagesUsed <= 48 &&
        bestSol.actualRefluxRatio <= 12 &&
        countProfileSawtoothReversals(bestSol) === 0) ||
      evals >= 8 ||
      (evals >= 2 && (Date.now() - fixStartMs > 2200 || Date.now() - loopStartMs > 1800))
    ) {
      break;
    }
    const patch = st.buildPatch(bestParams, bestSol);
    if (!patch) continue;
    const nextParams: DistillColumnParams = { ...bestParams, ...patch };
    const cand = solveRigorousDistillation(feedsInput, nextParams);
    evals++;
    const sc = scoreDistillResult(cand);
    if (sc < bestScore - 1e-3) {
      bestParams = nextParams;
      bestSol = cand;
      bestScore = sc;
      actionsTaken.push(st.label);
    }
  }

  return finalizeDistillFixResult(initialParams, solvedBefore, bestParams, bestSol, bestScore, rootCauses, actionsTaken);
}

/**
 * 다단 증류탑 비동기 단계별 AI · 물리 자동 해결기
 * - 첫 MESH 해석 전과 각 후보 탐색 사이에 브라우저 페인트를 양보하여 UI 멈춤 없이 진행률 표시
 */
export async function autoFixDistillationSimulationAsync(
  feedsInput: DistillFeedInput[],
  initialParams: DistillColumnParams,
  onProgress?: (step: number, total: number, label: string) => void
): Promise<EquipmentAutoFixResult<DistillColumnParams, DistillSolveResult>> {
  const fixStartMs = Date.now();
  onProgress?.(1, 6, '현재 운전점 및 미수렴·순도 미달 원인 정밀 진단 중...');
  await yieldToBrowser();

  const solvedBefore = solveRigorousDistillation(feedsInput, initialParams);
  const { rootCauses, steps } = prepareDistillFixContext(feedsInput, initialParams, solvedBefore);

  let bestParams: DistillColumnParams = { ...initialParams };
  let bestSol = solvedBefore;
  let bestScore = scoreDistillResult(solvedBefore);
  const actionsTaken: string[] = [];
  let evals = 1;
  const loopStartMs = Date.now();
  const maxSteps = Math.min(7, steps.length);
  const totalDisplay = maxSteps + 1;

  for (let i = 0; i < steps.length; i++) {
    if (
      bestScore <= 1 ||
      (bestSol.converged &&
        bestSol.diagnostics.level === 'ok' &&
        bestSol.totalStagesUsed <= 48 &&
        bestSol.actualRefluxRatio <= 12 &&
        countProfileSawtoothReversals(bestSol) === 0) ||
      evals >= 8 ||
      (evals >= 2 && (Date.now() - fixStartMs > 2200 || Date.now() - loopStartMs > 1800))
    ) {
      break;
    }
    const st = steps[i];
    onProgress?.(Math.min(totalDisplay, i + 2), totalDisplay, st.progressText);
    await yieldToBrowser();

    const patch = st.buildPatch(bestParams, bestSol);
    if (!patch) continue;
    const nextParams: DistillColumnParams = { ...bestParams, ...patch };
    const cand = solveRigorousDistillation(feedsInput, nextParams);
    evals++;
    const sc = scoreDistillResult(cand);
    if (sc < bestScore - 1e-3) {
      bestParams = nextParams;
      bestSol = cand;
      bestScore = sc;
      actionsTaken.push(st.label);
    }
  }

  onProgress?.(totalDisplay, totalDisplay, '최적 운전조건 반영 및 검증 완료');
  return finalizeDistillFixResult(initialParams, solvedBefore, bestParams, bestSol, bestScore, rootCauses, actionsTaken);
}

function scoreInternalsResult(r: ColumnInternalsSolveResult): number {
  let pen = 0;
  if (r.overallStatus === 'critical') pen += 800;
  else if (r.overallStatus === 'warning') pen += 200;
  if (r.maxFloodPct > 82) pen += (r.maxFloodPct - 82) * 30 + 100;
  if (r.maxDcChokeFloodPct > 80) pen += (r.maxDcChokeFloodPct - 80) * 25 + 80;
  if (r.totalInternalsDpMbar > 120) pen += (r.totalInternalsDpMbar - 120) * 2 + 40;
  pen += r.designWarnings.length * 40;
  return pen;
}

/**
 * 컬럼 인터널(트레이/패킹 · 범람 · 압력손실) AI 자동 해결기
 */
export function autoFixColumnInternals(
  colParams: DistillColumnParams,
  feeds: DistillFeedInput[],
  simResult: DistillSolveResult
): EquipmentAutoFixResult<ColumnInternalsParams, ColumnInternalsSolveResult> {
  const initialIc: ColumnInternalsParams = { ...(colParams.internalsConfig || {}) };
  const solvedBefore = solveColumnInternalsDesign(colParams, feeds, simResult);
  const rootCauses: string[] = [...solvedBefore.designWarnings];
  const actionsTaken: string[] = [];

  let bestIc: ColumnInternalsParams = { ...initialIc };
  let bestRes = solvedBefore;
  let bestScore = scoreInternalsResult(solvedBefore);

  const tryPatch = (patch: Partial<ColumnInternalsParams>, label: string): boolean => {
    const nextIc: ColumnInternalsParams = { ...bestIc, ...patch };
    const cand = solveColumnInternalsDesign({ ...colParams, internalsConfig: nextIc }, feeds, simResult);
    const sc = scoreInternalsResult(cand);
    if (sc < bestScore - 1e-3) {
      bestIc = nextIc;
      bestRes = cand;
      bestScore = sc;
      actionsTaken.push(label);
      return true;
    }
    return false;
  };

  if (bestRes.maxFloodPct > 82 || bestRes.maxDcChokeFloodPct > 80 || bestRes.overallStatus !== 'ok') {
    tryPatch(
      {
        designFloodTargetPct: 70,
        manualRectDiamM: undefined,
        manualStripDiamM: undefined,
        traySpacingMm: 600,
        flowPasses: 2,
        downcomerAreaPct: 16,
      },
      '설계 범람율 목표 70% · 단간격 600mm · 2-Pass 다운코머 16%로 수력학 여유 확보'
    );
  }

  // 진공 탑 + 높은 ΔP인 경우 규칙 충진물(Mellapak 250Y)로 자동 전환 시도
  if (
    bestScore > 1 &&
    (simResult.topPressKgcm2g < -0.25 || bestRes.totalInternalsDpMbar > 100) &&
    bestRes.internalsKind !== 'packed'
  ) {
    tryPatch(
      {
        internalsKind: 'packed',
        packingKey: 'mellapak_250y',
        designFloodTargetPct: 72,
        manualRectDiamM: undefined,
        manualStripDiamM: undefined,
      },
      '진공/저압손 조건에 맞춰 저압손 규칙 충진물(Mellapak 250Y)로 전환'
    );
  }

  // 위핑/턴다운 우려 시 밸브 트레이
  if (bestRes.internalsKind === 'tray' && bestRes.designWarnings.some((w) => w.includes('위핑') || w.includes('턴다운'))) {
    tryPatch({ trayType: 'valve' }, '밸브 트레이(Valve Tray) 적용으로 턴다운·위핑 안정화');
  }

  const patch: Partial<ColumnInternalsParams> = {};
  (Object.keys(bestIc) as Array<keyof ColumnInternalsParams>).forEach((k) => {
    if (bestIc[k] !== initialIc[k]) {
      (patch as Record<string, unknown>)[k] = bestIc[k];
    }
  });

  const improved = bestScore < scoreInternalsResult(solvedBefore) - 1e-3;
  const resolved = bestRes.overallStatus === 'ok';
  return {
    improved,
    resolved,
    patch,
    solvedBefore,
    solvedAfter: bestRes,
    headline: resolved
      ? `인터널 AI 보정 완료: 최대 범람율 ${bestRes.maxFloodPct.toFixed(1)}% · 총 압손 ${bestRes.totalInternalsDpMbar.toFixed(1)} mbar (정상)`
      : `인터널 보정 완료: 범람율 ${solvedBefore.maxFloodPct.toFixed(1)}% → ${bestRes.maxFloodPct.toFixed(1)}%`,
    rootCauses,
    actionsTaken: actionsTaken.length > 0 ? actionsTaken : ['현재 인터널 수력학 조건이 정상 범위입니다.'],
  };
}

export async function autoFixColumnInternalsAsync(
  colParams: DistillColumnParams,
  feeds: DistillFeedInput[],
  simResult: DistillSolveResult,
  onProgress?: (step: number, total: number, label: string) => void
): Promise<EquipmentAutoFixResult<ColumnInternalsParams, ColumnInternalsSolveResult>> {
  onProgress?.(1, 2, '트레이/충진물 범람율·압력손실·위핑 수력학 분석 중...');
  await yieldToBrowser();
  const res = autoFixColumnInternals(colParams, feeds, simResult);
  onProgress?.(2, 2, '컬럼 인터널 최적 보정 완료');
  await yieldToBrowser();
  return res;
}

/**
 * 선택적 AI 자문 호출
 * - 1순위: 서버 프록시 (/api/ai/advise) — API 키 미노출 및 일일 한도 제어
 * - 2순위: 브라우저 localStorage('CHEMPRO_GEMINI_KEY') 직접 호출 (로컬 개발 폴백)
 */
export async function fetchOptionalGeminiAdvice(contextPrompt: string): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null;

    try {
      const serverCtrl = new AbortController();
      const serverTimer = window.setTimeout(() => serverCtrl.abort(), 9000);
      const serverRes = await fetch('/api/ai/advise', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: serverCtrl.signal,
        body: JSON.stringify({ prompt: contextPrompt }),
      });
      window.clearTimeout(serverTimer);
      if (serverRes.ok) {
        const payload = (await serverRes.json()) as { text?: string };
        const t = payload.text?.trim();
        if (t) return t;
      }
    } catch {
      // 서버 프록시 미연결 시 로컬 키 폴백
    }

    const apiKey = window.localStorage?.getItem('CHEMPRO_GEMINI_KEY')?.trim();
    if (!apiKey) return null;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `당신은 화학공정 장치설계 수석 엔지니어입니다. 아래 장치 해석 요약을 보고 실무 핵심 코멘트 2줄만 한국어로 간결히 작성하세요.\n\n${contextPrompt}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.2, maxOutputTokens: 220 },
        }),
      }
    );
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || null;
  } catch {
    return null;
  }
}

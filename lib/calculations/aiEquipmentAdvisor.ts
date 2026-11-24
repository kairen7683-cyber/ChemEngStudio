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
  resolveEffectiveDofSlots,
  solveRigorousDistillation,
  type DistillColumnParams,
  type DistillFeedInput,
  type DistillSolveResult,
} from './rigorousDistillation';
import {
  solveColumnInternalsDesign,
  type ColumnInternalsParams,
  type ColumnInternalsSolveResult,
  type PackingKey,
  type ShellSectionMode,
  type TrayDeckType,
} from './columnInternalsDesign';
import type {
  FlowUnitParams,
  FlowUnitType,
  SimCompKey,
  SolvedStream,
  SolvedUnitResult,
} from './flowsheetSolver';

export interface HxAutoFixOption {
  id: string;
  labelKo: string;
  labelEn: string;
  badgeKo: string;
  badgeEn: string;
  cfg: HxDesignParams;
  params: FlowUnitParams;
  res: HxDesignSolveResult;
  estimatedCostUsd: number;
  allPassed: boolean;
}

export interface ColumnInternalsAutoFixOption {
  id: string;
  labelKo: string;
  labelEn: string;
  badgeKo: string;
  badgeEn: string;
  cfg: ColumnInternalsParams;
  res: ColumnInternalsSolveResult;
  costUsd: number;
  allPassed: boolean;
}

export interface DistillationAutoFixOption {
  id: string;
  labelKo: string;
  labelEn: string;
  badgeKo: string;
  badgeEn: string;
  params: DistillColumnParams;
  res: DistillSolveResult;
  tacScore: number;
  allPassed: boolean;
}

export interface EquipmentAutoFixResult<TPatch, TSolve> {
  improved: boolean;
  resolved: boolean;
  patch: Partial<TPatch>;
  paramsPatch?: Partial<FlowUnitParams>;
  solvedBefore: TSolve;
  solvedAfter: TSolve;
  headline: string;
  rootCauses: string[];
  actionsTaken: string[];
  options?: HxAutoFixOption[];
  internalsOptions?: ColumnInternalsAutoFixOption[];
  distillOptions?: DistillationAutoFixOption[];
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
  if (r.minPinchDeltaTC <= 0.5) pen += 3000 + Math.abs(r.minPinchDeltaTC) * 100;
  else if (r.minPinchDeltaTC < 3.5) pen += (3.5 - r.minPinchDeltaTC) * 180 + 150;
  if (r.dpTubeBar > 0.7) pen += (r.dpTubeBar - 0.7) * 400 + 80;
  if (r.dpShellBar > 0.7) pen += (r.dpShellBar - 0.7) * 400 + 80;
  if (r.ftFactor < 0.78) pen += (0.78 - r.ftFactor) * 900 + 90;
  if (r.vibRatio > 0.8) pen += (r.vibRatio - 0.8) * 500 + 70;
  if (r.actualOverdesignPct < 0) pen += Math.abs(r.actualOverdesignPct) * 15 + 120;
  if (r.areaProvM2 > 2000) pen += (r.areaProvM2 - 2000) * 0.05;
  if (r.material.code !== r.recommendedMaterial) pen += 40;
  return pen;
}

function isHxStrictPass(r: HxDesignSolveResult): boolean {
  return (
    r.dpTubeBar <= 0.7 &&
    r.dpShellBar <= 0.7 &&
    r.vibRatio < 0.8 &&
    r.ftFactor >= 0.78 &&
    r.actualOverdesignPct >= 0 &&
    r.minPinchDeltaTC >= 3.0
  );
}

function estimateHxCostUsd(r: HxDesignSolveResult): number {
  const area = Math.max(1, r.areaProvM2);
  if (r.hxKind === 'plate_phe') {
    return Math.round(6500 + 480 * Math.pow(area, 0.68));
  }
  const shells = Math.max(1, r.shellCount);
  return Math.round(12000 + 850 * Math.pow(area, 0.72) * shells);
}

interface HxEvalCandidate {
  cfg: HxDesignParams;
  params: FlowUnitParams;
  res: HxDesignSolveResult;
  allPassed: boolean;
  estimatedCostUsd: number;
  score: number;
}

function hxGeomKey(c: HxEvalCandidate): string {
  if (c.res.hxKind === 'plate_phe') {
    return `phe:${c.res.pheGapMm.toFixed(1)}:${c.res.pheChevronDeg}`;
  }
  const bRatio = (c.cfg.baffleSpacingRatio ?? c.res.baffleSpacingMm / Math.max(1, c.res.shellIdMm)).toFixed(2);
  return `st:${c.res.shellCount}:${c.res.tubePasses}:${c.res.tubeOdMm}:${c.res.tubeLengthM.toFixed(2)}:${bRatio}:${c.res.baffleCutPct}:${c.res.pitchAngle}`;
}

function hxMajorGeomKey(c: HxEvalCandidate): string {
  if (c.res.hxKind === 'plate_phe') {
    return `phe:${c.res.pheGapMm.toFixed(1)}:${c.res.pheChevronDeg}`;
  }
  return `st:${c.res.shellCount}:${c.res.tubePasses}:${c.res.tubeOdMm}:${c.res.tubeLengthM.toFixed(2)}`;
}

/**
 * 열교환기 폐루프 AI · 조합 기하 최적화 해결기
 * - Step 0: 열역학적 핀치(Pinch) 역전 / 온도교차 시 유틸리티 자동 전환
 * - Step 1: Shell & Tube + Plate PHE 조합 기하 스윕 (~180~280 후보, < 30 ms)
 * - Step 2: 엄격 통과(ΔP ≤ 0.7 bar, FIV < 80%, Ft ≥ 0.78, 여유율 ≥ 0%, Pinch ≥ 3.0°C) 후보 중
 *           최저 원가 1번 자동 적용 + 저차압 안전여유안(2번) + 대체 형식(3번) 반환
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

  let bestParams: FlowUnitParams = { ...params };
  let step0Res = solvedBefore;
  let step0Score = scoreHxResult(solvedBefore);
  const step0Actions: string[] = [];

  // ── Step 0: 열역학적 핀치(Pinch) 역전 / 온도교차 유틸리티 자동 해결 ──
  if (step0Res.minPinchDeltaTC < 3.5) {
    const isCooling = step0Res.dutyMcalH < 0 || step0Res.processSide.outTempC < step0Res.processSide.inTempC;
    if (utilInStreams.length === 0) {
      const utilityCandidates: Array<{ pPatch: Partial<FlowUnitParams>; label: string }> = isCooling
        ? [
            { pPatch: { refrigerantPreset: 'cw' }, label: '냉각수(CW 28→36°C)로 유틸리티 전환' },
            { pPatch: { refrigerantPreset: 'chw' }, label: '칠드워터(CHW 7→12°C)로 냉매 자동 전환' },
            { pPatch: { refrigerantPreset: 'meg_brine' }, label: '글리콜 브라인(-15→-8°C)으로 냉매 자동 전환' },
            { pPatch: { refrigerantPreset: 'brine_m20' }, label: '심냉 브라인(-25→-18°C)으로 냉매 자동 전환' },
            { pPatch: { refrigerantPreset: 'r404a_m32' }, label: 'R-404A 증발냉매(-35→-30°C)로 냉매 자동 전환' },
            { pPatch: { refrigerantPreset: 'freon_m35' }, label: 'R-507A 저온 증발냉매(-38→-33°C)로 냉매 자동 전환' },
          ]
        : [
            { pPatch: { refrigerantPreset: 'steam_lp' }, label: '저압 스팀(LP Steam 145°C)으로 열매 자동 전환' },
            { pPatch: { refrigerantPreset: 'custom', utilInTempC: 185, utilOutTempC: 184, utilCp: 1.0 }, label: '중압 스팀(MP Steam 185°C)으로 열매 자동 전환' },
            { pPatch: { refrigerantPreset: 'custom', utilInTempC: 235, utilOutTempC: 234, utilCp: 1.0 }, label: '고압 스팀(HP Steam 235°C)으로 열매 자동 전환' },
            { pPatch: { refrigerantPreset: 'custom', utilInTempC: 290, utilOutTempC: 260, utilCp: 0.56 }, label: '고온 열매체유(Therminol 66, 290→260°C)로 열매 자동 전환' },
          ];

      for (const cand of utilityCandidates) {
        const nextParams: FlowUnitParams = { ...bestParams, ...cand.pPatch };
        const solvedCand = solveHeatExchangerDesign(
          unitType,
          nextParams,
          initialCfg,
          procInStreams,
          procOutStreams,
          utilInStreams,
          utilOutStreams,
          unitRes
        );
        const sc = scoreHxResult(solvedCand);
        if (sc < step0Score - 1e-3) {
          bestParams = nextParams;
          step0Res = solvedCand;
          step0Score = sc;
          step0Actions.push(
            `${cand.label} (Pinch ΔT ${solvedBefore.minPinchDeltaTC.toFixed(1)}→${solvedCand.minPinchDeltaTC.toFixed(1)}°C, 면적 ${solvedBefore.areaProvM2.toFixed(0)}→${solvedCand.areaProvM2.toFixed(1)} m²)`
          );
          if (solvedCand.minPinchDeltaTC >= 5.0) break;
        }
      }
    } else {
      // PFD에 외부 유틸리티 스트림이 직접 연결된 경우: 필요 최소 유량 정량 계산 안내
      const absQ = Math.abs(step0Res.dutyMcalH) * 1000;
      const uCp = Math.max(0.25, step0Res.utilitySide.cpKcalKgC || 1.0);
      const targetDt = isCooling ? 8.0 : 15.0;
      const reqFlowKgH = Math.ceil(absQ / (uCp * targetDt));
      const curFlowKgH = Math.round(step0Res.utilitySide.massFlowKgH);
      const utilIn = step0Res.utilitySide.inTempC;
      const procOut = step0Res.processSide.outTempC;
      if (isCooling && utilIn >= procOut - 4) {
        step0Actions.push(
          `외부 연결 냉매 공급온도(${utilIn.toFixed(1)}°C)가 공정 목표온도(${procOut.toFixed(1)}°C)에 너무 가깝습니다. PFD 유틸리티 피드 온도를 칠드워터(7°C) 이하로 낮추고 유량을 최소 ${reqFlowKgH.toLocaleString()} kg/h 이상으로 증대하세요 (현재 ${curFlowKgH.toLocaleString()} kg/h).`
        );
      } else {
        step0Actions.push(
          `외부 연결 유틸리티 스트림 유량이 부족하여 출구온도가 ${step0Res.utilitySide.outTempC.toFixed(1)}°C까지 변했습니다. PFD 유틸리티 피드 유량을 현재 ${curFlowKgH.toLocaleString()} kg/h → 최소 ${reqFlowKgH.toLocaleString()} kg/h 이상으로 늘려주세요.`
        );
      }
    }
  }

  // ── Step 1: 고속 조합 기하 스윕 (Shell & Tube + Plate PHE) ──
  const recMat = step0Res.recommendedMaterial;
  const candidates: HxEvalCandidate[] = [];
  const seenKeys = new Set<string>();

  const evalCandidate = (cfg: HxDesignParams) => {
    const res = solveHeatExchangerDesign(
      unitType,
      bestParams,
      cfg,
      procInStreams,
      procOutStreams,
      utilInStreams,
      utilOutStreams,
      unitRes
    );
    const cand: HxEvalCandidate = {
      cfg,
      params: bestParams,
      res,
      allPassed: isHxStrictPass(res),
      estimatedCostUsd: estimateHxCostUsd(res),
      score: scoreHxResult(res),
    };
    const key = hxGeomKey(cand);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      candidates.push(cand);
    }
  };

  // 현재 설정(Step 0 반영)도 후보군에 포함
  evalCandidate({
    ...initialCfg,
    material: recMat,
    designMode: 'design',
    designMarginPct: 15,
  });

  // 1-A. Shell & Tube 조합 스윕
  const tubePassesGrid: Array<1 | 2 | 4> = [1, 2, 4];
  const tubeOdGrid: Array<19.05 | 25.4> = [19.05, 25.4];
  const tubeLenGrid: Array<2.44 | 3.05 | 3.66 | 4.88 | 6.1> = [2.44, 3.05, 3.66, 4.88, 6.1];
  // 배플 조합 (B/Ds ∈ [0.35, 0.55, 0.78], cut ∈ [25, 35]) — 핵심 대표 4조합으로 240개 이내 고속 유지
  const bafflePairs: Array<[number, number]> = [
    [0.35, 25],
    [0.55, 25],
    [0.55, 35],
    [0.78, 35],
  ];
  const baseTema = initialCfg.temaType ?? 'AES';

  for (const shellCount of [1, 2]) {
    for (const tubePasses of tubePassesGrid) {
      const temaType = tubePasses === 1 && baseTema === 'BEU' ? 'BEM' : baseTema;
      for (const tubeOdMm of tubeOdGrid) {
        for (const tubeLengthM of tubeLenGrid) {
          for (const [baffleSpacingRatio, baffleCutPct] of bafflePairs) {
            evalCandidate({
              ...initialCfg,
              hxKind: 'shell_tube',
              temaType,
              designMode: 'design',
              designMarginPct: 15,
              material: recMat,
              shellCount,
              tubePasses,
              tubeOdMm,
              tubeLengthM,
              baffleSpacingRatio,
              baffleCutPct,
              pitchAngle: 30,
            });
          }
        }
      }
    }
  }

  // Ft < 0.78 또는 Shell ΔP > 0.7 bar이면 직렬 3쉘 추가 탐색
  if (step0Res.ftFactor < 0.78 || step0Res.dpShellBar > 0.7) {
    for (const tubePasses of [1, 2] as const) {
      const temaType = tubePasses === 1 && baseTema === 'BEU' ? 'BEM' : baseTema;
      for (const tubeOdMm of tubeOdGrid) {
        for (const tubeLengthM of [3.05, 3.66, 4.88] as const) {
          for (const [baffleSpacingRatio, baffleCutPct] of [
            [0.55, 25],
            [0.78, 35],
          ] as Array<[number, number]>) {
            evalCandidate({
              ...initialCfg,
              hxKind: 'shell_tube',
              temaType,
              designMode: 'design',
              designMarginPct: 15,
              material: recMat,
              shellCount: 3,
              tubePasses,
              tubeOdMm,
              tubeLengthM,
              baffleSpacingRatio,
              baffleCutPct,
              pitchAngle: 30,
            });
          }
        }
      }
    }
  }

  // FIV > 0.75 또는 Shell ΔP > 0.6 bar이면 90° 정사각 피치 추가 탐색
  if (step0Res.vibRatio > 0.75 || step0Res.dpShellBar > 0.6) {
    for (const shellCount of [1, 2]) {
      for (const tubePasses of [1, 2] as const) {
        const temaType = tubePasses === 1 && baseTema === 'BEU' ? 'BEM' : baseTema;
        for (const tubeOdMm of tubeOdGrid) {
          for (const tubeLengthM of [2.44, 3.66, 4.88] as const) {
            for (const [baffleSpacingRatio, baffleCutPct] of [
              [0.55, 35],
              [0.78, 35],
            ] as Array<[number, number]>) {
              evalCandidate({
                ...initialCfg,
                hxKind: 'shell_tube',
                temaType,
                designMode: 'design',
                designMarginPct: 15,
                material: recMat,
                shellCount,
                tubePasses,
                tubeOdMm,
                tubeLengthM,
                baffleSpacingRatio,
                baffleCutPct,
                pitchAngle: 90,
              });
            }
          }
        }
      }
    }
  }

  // 1-B. Plate PHE 조합 스윕 (설계온도 ≤ 160°C, 설계압력 ≤ 16 bar 시 경제적 초소형 대안으로 평가)
  const designTempC = Math.max(
    step0Res.processSide.inTempC,
    step0Res.processSide.outTempC,
    step0Res.utilitySide.inTempC,
    step0Res.utilitySide.outTempC
  );
  const designPressBar =
    Math.max(step0Res.processSide.pressKgcm2g, step0Res.utilitySide.pressKgcm2g) * 0.980665;
  if (designTempC <= 160 && designPressBar <= 16) {
    for (const pheGapMm of [3.0, 4.0, 5.0]) {
      for (const pheChevronDeg of [30, 45, 60] as const) {
        evalCandidate({
          ...initialCfg,
          hxKind: 'plate_phe',
          designMode: 'design',
          designMarginPct: 15,
          material: recMat,
          pheGapMm,
          pheChevronDeg,
        });
      }
    }
  }

  // ── Step 2: 후보 랭킹 (통과안 우선 → 최저 원가 순, 미통과안은 최저 페널티 순) ──
  candidates.sort((a, b) => {
    if (a.allPassed !== b.allPassed) return a.allPassed ? -1 : 1;
    if (a.allPassed && b.allPassed) {
      if (a.estimatedCostUsd !== b.estimatedCostUsd) return a.estimatedCostUsd - b.estimatedCostUsd;
      const aDp = Math.max(a.res.dpTubeBar, a.res.dpShellBar);
      const bDp = Math.max(b.res.dpTubeBar, b.res.dpShellBar);
      return aDp - bDp;
    }
    if (Math.abs(a.score - b.score) > 1e-3) return a.score - b.score;
    return a.estimatedCostUsd - b.estimatedCostUsd;
  });

  const opt1 = candidates[0];
  const passingCandidates = candidates.filter((c) => c.allPassed);
  const poolForOpt2 = passingCandidates.length > 1 ? passingCandidates : candidates;

  // Option 2: 저차압 · 안전여유안 (Option 1과 구별되는 최소 max(dpTube, dpShell) 설계)
  const opt1Major = hxMajorGeomKey(opt1);
  const opt1Key = hxGeomKey(opt1);
  const lowDpSorted = [...poolForOpt2]
    .filter((c) => hxGeomKey(c) !== opt1Key)
    .sort((a, b) => {
      const aDp = Math.max(a.res.dpTubeBar, a.res.dpShellBar);
      const bDp = Math.max(b.res.dpTubeBar, b.res.dpShellBar);
      if (Math.abs(aDp - bDp) > 0.015) return aDp - bDp;
      if (Math.abs(a.res.vibRatio - b.res.vibRatio) > 0.03) return a.res.vibRatio - b.res.vibRatio;
      return a.estimatedCostUsd - b.estimatedCostUsd;
    });
  const opt2 =
    lowDpSorted.find((c) => hxMajorGeomKey(c) !== opt1Major) ?? lowDpSorted[0] ?? null;

  // Option 3: 대체 형식 (반대 hxKind 통과안 우선, 불가능 시 2순위 별도 통과 Shell & Tube 기하안)
  const chosenKeys = new Set<string>([opt1Key, ...(opt2 ? [hxGeomKey(opt2)] : [])]);
  const chosenMajors = new Set<string>([opt1Major, ...(opt2 ? [hxMajorGeomKey(opt2)] : [])]);
  const oppositeKind = opt1.res.hxKind === 'shell_tube' ? 'plate_phe' : 'shell_tube';
  const oppCand = candidates.find(
    (c) =>
      c.res.hxKind === oppositeKind &&
      (opt1.allPassed ? c.allPassed : true) &&
      !chosenKeys.has(hxGeomKey(c))
  );
  const altStCand =
    passingCandidates.find(
      (c) =>
        c.res.hxKind === 'shell_tube' &&
        !chosenKeys.has(hxGeomKey(c)) &&
        !chosenMajors.has(hxMajorGeomKey(c))
    ) ??
    passingCandidates.find(
      (c) => c.res.hxKind === 'shell_tube' && !chosenKeys.has(hxGeomKey(c))
    ) ??
    candidates.find(
      (c) =>
        c.res.hxKind === 'shell_tube' &&
        !chosenKeys.has(hxGeomKey(c)) &&
        !chosenMajors.has(hxMajorGeomKey(c))
    ) ??
    candidates.find((c) => !chosenKeys.has(hxGeomKey(c))) ??
    null;
  const opt3 = oppCand ?? altStCand;

  const options: HxAutoFixOption[] = [
    {
      id: 'opt-economical',
      labelKo: 'AI 추천 최적안 (최저 원가)',
      labelEn: 'AI Recommended · Most Economical',
      badgeKo: '최저 원가',
      badgeEn: 'Lowest Cost',
      cfg: opt1.cfg,
      params: opt1.params,
      res: opt1.res,
      estimatedCostUsd: opt1.estimatedCostUsd,
      allPassed: opt1.allPassed,
    },
  ];

  if (opt2) {
    options.push({
      id: 'opt-low-dp',
      labelKo: '저차압 · 안전여유안',
      labelEn: 'Low ΔP · High Margin',
      badgeKo: '저차압·고여유',
      badgeEn: 'Low ΔP',
      cfg: opt2.cfg,
      params: opt2.params,
      res: opt2.res,
      estimatedCostUsd: opt2.estimatedCostUsd,
      allPassed: opt2.allPassed,
    });
  }

  if (opt3) {
    const isOpposite = opt3.res.hxKind !== opt1.res.hxKind;
    options.push({
      id: isOpposite ? 'opt-alt-type' : 'opt-alt-geom',
      labelKo: isOpposite
        ? opt3.res.hxKind === 'plate_phe'
          ? '대체 형식 (판형 PHE)'
          : '대체 형식 (다관원통형 S&T)'
        : '대체 기하안 (다관원통형)',
      labelEn: isOpposite
        ? opt3.res.hxKind === 'plate_phe'
          ? 'Alternative Type: Plate PHE'
          : 'Alternative Type: Shell & Tube'
        : 'Alternative Shell & Tube',
      badgeKo:
        opt3.res.hxKind === 'plate_phe' ? '초소형 PHE' : isOpposite ? 'TEMA S&T' : '대체 규격',
      badgeEn:
        opt3.res.hxKind === 'plate_phe' ? 'Compact PHE' : isOpposite ? 'TEMA S&T' : 'Alt Spec',
      cfg: opt3.cfg,
      params: opt3.params,
      res: opt3.res,
      estimatedCostUsd: opt3.estimatedCostUsd,
      allPassed: opt3.allPassed,
    });
  }

  const bestCfg = opt1.cfg;
  const bestRes = opt1.res;
  const bestScore = opt1.score;

  // ── 변경 조치 목록 상세 기록 ──
  const actionsTaken: string[] = [...step0Actions];
  if (solvedBefore.hxKind !== bestRes.hxKind) {
    actionsTaken.push(
      `형식 전환 (${solvedBefore.hxKind === 'plate_phe' ? '판형 PHE' : 'TEMA S&T'} → ${
        bestRes.hxKind === 'plate_phe' ? '판형 PHE' : 'TEMA 다관원통형'
      })`
    );
  }
  if (initialCfg.designMode === 'rating' && bestCfg.designMode === 'design') {
    actionsTaken.push('정격(Rating) 해제 → 요구면적 자동 사이징 전환 (여유율 +15%)');
  }
  if (solvedBefore.material.code !== bestRes.material.code) {
    actionsTaken.push(`내식 재질 변경 (${solvedBefore.material.code} → ${bestRes.material.code})`);
  }
  if (bestRes.hxKind === 'shell_tube') {
    if (solvedBefore.hxKind === 'shell_tube' && solvedBefore.temaType !== bestRes.temaType) {
      actionsTaken.push(`TEMA 형식 ${solvedBefore.temaType}→${bestRes.temaType}`);
    }
    if (solvedBefore.hxKind !== 'shell_tube' || solvedBefore.shellCount !== bestRes.shellCount) {
      actionsTaken.push(`직렬 쉘 ${solvedBefore.shellCount}→${bestRes.shellCount}기`);
    }
    if (solvedBefore.hxKind !== 'shell_tube' || solvedBefore.tubePasses !== bestRes.tubePasses) {
      actionsTaken.push(`패스 수 ${solvedBefore.tubePasses}→${bestRes.tubePasses}`);
    }
    if (solvedBefore.hxKind !== 'shell_tube' || solvedBefore.tubeOdMm !== bestRes.tubeOdMm) {
      actionsTaken.push(`관경 ${solvedBefore.tubeOdMm}→${bestRes.tubeOdMm} mm`);
    }
    if (
      solvedBefore.hxKind !== 'shell_tube' ||
      Math.abs(solvedBefore.tubeLengthM - bestRes.tubeLengthM) > 0.01
    ) {
      actionsTaken.push(
        `관길이 ${solvedBefore.tubeLengthM.toFixed(2)}→${bestRes.tubeLengthM.toFixed(2)} m`
      );
    }
    const oldBRatio =
      initialCfg.baffleSpacingRatio ??
      solvedBefore.baffleSpacingMm / Math.max(1, solvedBefore.shellIdMm);
    const newBRatio =
      bestCfg.baffleSpacingRatio ?? bestRes.baffleSpacingMm / Math.max(1, bestRes.shellIdMm);
    if (solvedBefore.hxKind !== 'shell_tube' || Math.abs(oldBRatio - newBRatio) > 0.02) {
      actionsTaken.push(`배플 간격비 ${oldBRatio.toFixed(2)}→${newBRatio.toFixed(2)}`);
    }
    if (solvedBefore.hxKind !== 'shell_tube' || solvedBefore.baffleCutPct !== bestRes.baffleCutPct) {
      actionsTaken.push(`배플 컷 ${solvedBefore.baffleCutPct}→${bestRes.baffleCutPct}%`);
    }
    if (solvedBefore.hxKind !== 'shell_tube' || solvedBefore.pitchAngle !== bestRes.pitchAngle) {
      actionsTaken.push(`배열각 ${solvedBefore.pitchAngle}°→${bestRes.pitchAngle}°`);
    }
  } else {
    if (
      solvedBefore.hxKind !== 'plate_phe' ||
      Math.abs(solvedBefore.pheGapMm - bestRes.pheGapMm) > 0.05
    ) {
      actionsTaken.push(
        `PHE 판간격 ${solvedBefore.pheGapMm.toFixed(1)}→${bestRes.pheGapMm.toFixed(1)} mm`
      );
    }
    if (solvedBefore.hxKind !== 'plate_phe' || solvedBefore.pheChevronDeg !== bestRes.pheChevronDeg) {
      actionsTaken.push(`쉐브론 각도 ${solvedBefore.pheChevronDeg}°→${bestRes.pheChevronDeg}°`);
    }
  }

  const patch: Partial<HxDesignParams> = {};
  (Object.keys(bestCfg) as Array<keyof HxDesignParams>).forEach((k) => {
    if (bestCfg[k] !== initialCfg[k]) {
      (patch as Record<string, unknown>)[k] = bestCfg[k];
    }
  });

  const paramsPatch: Partial<FlowUnitParams> = {};
  (Object.keys(bestParams) as Array<keyof FlowUnitParams>).forEach((k) => {
    if (bestParams[k] !== params[k]) {
      (paramsPatch as Record<string, unknown>)[k] = bestParams[k];
    }
  });

  const beforeScore = scoreHxResult(solvedBefore);
  const beforePassed = isHxStrictPass(solvedBefore);
  const improved =
    (opt1.allPassed && !beforePassed) ||
    bestScore < beforeScore - 1e-3 ||
    (opt1.allPassed && beforePassed && opt1.estimatedCostUsd < estimateHxCostUsd(solvedBefore));
  const resolved = opt1.allPassed || bestRes.overallStatus === 'ok';
  const costK = (opt1.estimatedCostUsd / 1000).toFixed(1);
  const headline = resolved
    ? `AI 자동 보정 완료 (${candidates.length}개 기하 조합 검증 · 최저 원가 1번 Est. $${costK}k 자동 적용): Tube ΔP ${bestRes.dpTubeBar.toFixed(2)} bar, Shell ΔP ${bestRes.dpShellBar.toFixed(2)} bar, FIV ${(bestRes.vibRatio * 100).toFixed(0)}%, Ft ${bestRes.ftFactor.toFixed(2)}, Pinch ΔT ${bestRes.minPinchDeltaTC.toFixed(1)}°C.`
    : improved
    ? `AI 부분 개선 완료 (${candidates.length}개 조합 탐색 · Tube ΔP ${solvedBefore.dpTubeBar.toFixed(2)}→${bestRes.dpTubeBar.toFixed(2)} bar, Shell ΔP ${solvedBefore.dpShellBar.toFixed(2)}→${bestRes.dpShellBar.toFixed(2)} bar, 면적 ${bestRes.areaProvM2.toFixed(1)} m²).`
    : bestRes.minPinchDeltaTC <= 0.5 && utilInStreams.length > 0
    ? 'PFD에 직접 연결된 유틸리티 스트림의 유량 부족 또는 온도 역전으로 기하학적 보정만으로는 해결할 수 없습니다 (아래 유량·온도 가이드 적용 필요).'
    : '현재 열부하·상변화 조건에서 기하학적 조정 여지가 제한적입니다 (공정 유량·핀치 온도 점검 필요).';

  return {
    improved,
    resolved,
    patch,
    ...(Object.keys(paramsPatch).length > 0 ? { paramsPatch } : {}),
    solvedBefore,
    solvedAfter: bestRes,
    headline,
    rootCauses,
    actionsTaken:
      actionsTaken.length > 0
        ? actionsTaken
        : ['현재 운전 파라미터가 물리적 최적 상태에 가깝습니다.'],
    options,
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
  onProgress?.(1, 2, '열교환기 조합 기하 스윕(ΔP·Ft·FIV·경제성) 탐색 중...');
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
  onProgress?.(2, 2, '상위 3개 AI 검증 설계 대안 산출 완료');
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
  if (r.sideCutSpecStatus && !r.sideCutSpecStatus.met) {
    const relSc = r.sideCutSpecStatus.errorAbs / Math.max(1, Math.abs(r.sideCutSpecStatus.target));
    pen += 90 + relSc * 350;
  }
  if (r.actualRefluxRatio > 25) {
    pen += Math.min(400, (r.actualRefluxRatio - 25) * 10);
  }
  if (r.totalStagesUsed > 140) {
    pen += (r.totalStagesUsed - 140) * 3;
  }
  if (r.actualDOverFMass < 0.0005) {
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
  const initSlots = resolveEffectiveDofSlots(initialParams);
  const isDualQualitySpec =
    (initialParams.columnCalcMode ?? 'rigorous_mesh') !== 'design_stages' &&
    initSlots.includes('top_spec') &&
    initSlots.includes('bot_spec');
  const steps: DistillCandidateStep[] = [];

  // 0-sc) 사이드컷 목표 품질 미달 시 최적 인출단 자동탐색 활성화
  if (initialParams.sideCut?.enabled && solvedBefore.sideCutSpecStatus && !solvedBefore.sideCutSpecStatus.met) {
    steps.push({
      label: '사이드컷(측류) 최적 인출단 자동탐색으로 측류 목표 품질 달성',
      progressText: '사이드컷 피크 순도 인출단 자동탐색 중...',
      buildPatch: (curP) => ({
        sideCut: curP.sideCut ? { ...curP.sideCut, autoOptimizeStage: true } : curP.sideCut,
      }),
    });
  }

  // 0) 2개 품질 스펙(탑정+탑저) 동시 지정 시 단수(N)·공급단(Nf)·환류비·유량 AI 다중후보 자동최적화 최우선 활성화
  if (isDualQualitySpec) {
    steps.push({
      label: 'AI 다중후보 (단수·공급단·환류비·탑정유량) 동시 자동최적화 및 TAC 최소점 선정',
      progressText: '목표 순도 달성 가능한 다중후보(N·Nf·RR·D/F) 동시 최적화 중...',
      buildPatch: (curP) => ({
        ...(hasWater && hasHydroOrg ? { condenserType: 'decanter_ech', thermoModel: 'NRTL' } : {}),
        activeDofSlots: ['top_spec', 'bot_spec'] as DistillColumnParams['activeDofSlots'],
        autoOptimizeStagesOnDualSpec: true,
        columnCalcMode: curP.columnCalcMode ?? 'rigorous_mesh',
      }),
    });
  }

  // 1) 수분-유기물 불균일 공비계 최우선 처방: 디캔터(decanter_ech) + NRTL + 폭주 단수/환류 초기화
  if (hasWater && hasHydroOrg) {
    steps.push({
      label: '수분-유기물 불균일 공비 분리용 디캔터(decanter_ech) · NRTL 및 안정 조건 적용',
      progressText: '공비 유수분리 디캔터(decanter_ech) · NRTL 수렴 탐색 중...',
      buildPatch: (curP, curS) => {
        const modeNow = curP.columnCalcMode ?? 'rigorous_mesh';
        const needsDesignReset =
          modeNow === 'design_stages' &&
          (curS.actualRefluxRatio > 20 || (curP.totalStages ?? 24) > 120 || curS.totalStagesUsed > 120);
        const needsMeshReset =
          !isDualQualitySpec &&
          modeNow === 'rigorous_mesh' &&
          ((curP.totalStages ?? 24) > 65 ||
            curS.totalStagesUsed > 65 ||
            curS.actualRefluxRatio > 20 ||
            curS.actualDOverFMass < estDfMass * 0.75);
        return {
          condenserType: 'decanter_ech',
          thermoModel: 'NRTL',
          ...(needsDesignReset ? { designRefluxMode: 'auto_opt' } : {}),
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

  // 2) 진단 자체의 처방 평가 (최대 2건)
  for (const rem of solvedBefore.diagnostics.remedies.slice(0, 2)) {
    if (rem.patch.columnCalcMode === 'design_stages') continue;
    steps.push({
      label: rem.label,
      progressText: `진단 처방 검증 중: ${rem.label}`,
      buildPatch: () => rem.patch,
    });
  }

  // 3) design_stages 모드: AI 다중후보 자동최적화('auto_opt') 전환 및 과잉 회수율(≥99.2%) 현실화
  if ((initialParams.columnCalcMode ?? 'rigorous_mesh') === 'design_stages') {
    steps.push({
      label: 'AI 다중후보(1.15~1.80×R_min) 자동최적화로 최소 TAC 단수·환류비 산출',
      progressText: 'AI 다중후보 (N·Nf·RR·D/F) TAC 최적 설계 탐색 중...',
      buildPatch: (curP) => ({
        condenserType: hasWater && hasHydroOrg ? 'decanter_ech' : curP.condenserType ?? 'total',
        thermoModel: hasWater && hasHydroOrg ? 'NRTL' : curP.thermoModel ?? 'NRTL',
        designRefluxMode: 'auto_opt',
      }),
    });

    if ((initialParams.designTopRecoveryPct ?? 99) > 99.0 || (initialParams.designBotRecoveryPct ?? 99) > 99.2) {
      steps.push({
        label: '공비·다성분 핀치 구간 회피를 위해 탑정/탑저 회수율 목표 99.0% 최적화',
        progressText: '공비 핀치 회피용 현실 회수율(99.0%) 탐색 중...',
        buildPatch: (curP) => ({
          condenserType: hasWater && hasHydroOrg ? 'decanter_ech' : curP.condenserType ?? 'total',
          thermoModel: hasWater && hasHydroOrg ? 'NRTL' : curP.thermoModel ?? 'NRTL',
          designRefluxMode: 'auto_opt',
          designTopRecoveryPct: Math.min(99.0, curP.designTopRecoveryPct ?? 99.0),
          designBotRecoveryPct: Math.min(99.0, curP.designBotRecoveryPct ?? 99.0),
        }),
      });
    }
  }

  // 4) 단일/고정 유출 정밀모사 미수렴 시에만 안정화 (RR, D/F) 운전점 탐색 (이중 품질스펙은 목표 보존)
  if (!isDualQualitySpec) {
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
  }

  // 5) 원래 rigorous_mesh였으나 미수렴/미달 시 design_stages('auto_opt') 전환 (기존 품질 타겟 이관)
  if ((initialParams.columnCalcMode ?? 'rigorous_mesh') !== 'design_stages' && topKey && botKey) {
    const topMet = initialParams.topQualityMetric;
    const topVal = initialParams.topQualityTarget;
    const botMet = initialParams.botQualityMetric;
    const botVal = initialParams.botQualityTarget;
    const mappedLk = topMet === 'impurity_wt_ppm' ? (activeComps[0] ?? topKey) : topKey;
    const mappedHk = botMet === 'impurity_wt_ppm' ? (activeComps[activeComps.length - 1] ?? botKey) : botKey;
    steps.push({
      label: '목표순도 기반 AI 다중후보(단수·공급단·환류비·유량) 자동설계 모드로 전환',
      progressText: 'AI 다중후보 자동단수·TAC 최적설계 전환 검증 중...',
      buildPatch: () => ({
        columnCalcMode: 'design_stages',
        condenserType: hasWater && hasHydroOrg ? 'decanter_ech' : initialParams.condenserType ?? 'total',
        thermoModel: hasWater && hasHydroOrg ? 'NRTL' : initialParams.thermoModel ?? 'NRTL',
        designLkComp: mappedLk,
        designHkComp: mappedHk !== mappedLk ? mappedHk : (activeComps.find((c) => c !== mappedLk) ?? botKey),
        ...(topMet === 'impurity_wt_ppm' && typeof topVal === 'number'
          ? { designTopBasis: 'impurity_wt_ppm' as const, designTopImpurityPpm: topVal }
          : topMet === 'recovery_pct' && typeof topVal === 'number'
            ? { designTopBasis: 'recovery_pct' as const, designTopRecoveryPct: topVal }
            : typeof topVal === 'number'
              ? { designTopBasis: 'purity_wt_pct' as const, designTopPurityWtPct: topVal }
              : {}),
        ...(botMet === 'impurity_wt_ppm' && typeof botVal === 'number'
          ? { designBotBasis: 'impurity_wt_ppm' as const, designBotImpurityPpm: botVal }
          : botMet === 'recovery_pct' && typeof botVal === 'number'
            ? { designBotBasis: 'recovery_pct' as const, designBotRecoveryPct: botVal }
            : typeof botVal === 'number'
              ? { designBotBasis: 'purity_wt_pct' as const, designBotPurityWtPct: botVal }
              : {}),
        designRefluxMode: 'auto_opt',
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

interface DistillEvalCandidate {
  params: DistillColumnParams;
  res: DistillSolveResult;
  score: number;
  tacScore: number;
  allPassed: boolean;
  actionLabel?: string;
}

function computeDistillTacScore(r: DistillSolveResult): number {
  const reboilerDutyMW = Math.abs(r.reboilerDutyKcalH) / 859845.2;
  const numStages = Math.max(1, r.totalStagesUsed);
  return Number((reboilerDutyMW * 180 + numStages * 4.5).toFixed(2));
}

function isDistillStrictPass(r: DistillSolveResult): boolean {
  if (!r.converged || !r.dofValid) return false;
  if (r.diagnostics.level === 'error') return false;
  if (r.spec1Status?.enabled && !r.spec1Status.met) return false;
  if (r.spec2Status?.enabled && !r.spec2Status.met) return false;
  if (r.sideCutSpecStatus && !r.sideCutSpecStatus.met) return false;
  if (r.shortcutDesign && !r.shortcutDesign.designMet) return false;
  if (countProfileSawtoothReversals(r) > 0) return false;
  if (r.actualRefluxRatio > 45 || r.totalStagesUsed > 195) return false;
  return true;
}

function distillCandKey(p: DistillColumnParams, r: DistillSolveResult): string {
  return `${p.columnCalcMode ?? 'rigorous_mesh'}:${r.totalStagesUsed}:${r.feedStageUsed}:${r.actualRefluxRatio.toFixed(2)}:${r.actualDOverFMass.toFixed(3)}`;
}

function buildDistillGuidedGrid(
  baseParams: DistillColumnParams,
  baseSol: DistillSolveResult,
  initialParams: DistillColumnParams
): Array<{ label: string; params: DistillColumnParams }> {
  const grid: Array<{ label: string; params: DistillColumnParams }> = [];
  const seenCfg = new Set<string>();
  const mode = baseParams.columnCalcMode ?? 'rigorous_mesh';

  const curN = clamp(
    Math.round(baseSol.totalStagesUsed || baseParams.totalStages || initialParams.totalStages || 24),
    6,
    120
  );
  const fenskeN = baseSol.shortcutDesign?.solvedStagesN
    ? clamp(Math.round(baseSol.shortcutDesign.solvedStagesN), 8, 90)
    : null;
  const compactN = curN >= 14 ? Math.max(10, Math.round(curN * 0.8)) : null;

  const rawStages = [
    curN,
    Math.max(10, Math.round(curN * 1.35)),
    Math.min(80, curN + 14),
    ...(fenskeN ? [fenskeN] : []),
    ...(compactN ? [compactN] : []),
  ];
  const stageList = Array.from(new Set(rawStages)).slice(0, 4);

  if (mode === 'design_stages') {
    for (const rMult of [1.15, 1.3, 1.5, 1.8, 2.2]) {
      const key = `ds:${rMult}`;
      if (seenCfg.has(key)) continue;
      seenCfg.add(key);
      grid.push({
        label: `자동설계 환류배수 R/Rmin=${rMult.toFixed(2)} 탐색`,
        params: {
          ...baseParams,
          columnCalcMode: 'design_stages',
          designRefluxMode: 'r_mult',
          designRefluxMult: rMult,
        },
      });
    }
    return grid;
  }

  const slots = resolveEffectiveDofSlots(baseParams);
  const isDualSpec = slots.includes('top_spec') && slots.includes('bot_spec');
  const refluxAdjustable =
    !isDualSpec &&
    slots.includes('rr') &&
    (baseParams.topSpecType ?? 'reflux_ratio') === 'reflux_ratio';

  if (refluxAdjustable) {
    const rrList = [1.2, 1.8, 2.5, 3.5];
    const feedFracs = [0.45, 0.55];
    // 단수와 환류비를 교차 배치하여 시간 예산(850ms) 내에서도 넓은 설계 공간을 고르게 커버
    for (const fFrac of feedFracs) {
      for (const rr of rrList) {
        for (const n of stageList) {
          if (grid.length >= 18) break;
          const fs = clamp(Math.round(n * fFrac), 2, n - 1);
          const key = `mesh:${n}:${fs}:${rr.toFixed(2)}`;
          if (seenCfg.has(key)) continue;
          seenCfg.add(key);
          grid.push({
            label: `가이드 격자 탐색 (${n}단 · 공급단 ${fs}단 · RR=${rr.toFixed(1)})`,
            params: {
              ...baseParams,
              columnCalcMode: 'rigorous_mesh',
              totalStages: n,
              feedStage: fs,
              topSpecType: 'reflux_ratio',
              topSpecValue: rr,
            },
          });
        }
        if (grid.length >= 18) break;
      }
      if (grid.length >= 18) break;
    }
  } else {
    // 이중 품질스펙 또는 환류비 고정 외 모드: 단수 × 공급단 비율 격자 탐색
    const feedFracs = [0.45, 0.55, 0.38, 0.62];
    for (const fFrac of feedFracs) {
      for (const n of stageList) {
        if (grid.length >= 14) break;
        const fs = clamp(Math.round(n * fFrac), 2, n - 1);
        const key = `dual:${n}:${fs}`;
        if (seenCfg.has(key)) continue;
        seenCfg.add(key);
        grid.push({
          label: `가이드 격자 탐색 (${n}단 · 공급단 ${fs}단)`,
          params: {
            ...baseParams,
            columnCalcMode: 'rigorous_mesh',
            totalStages: n,
            feedStage: fs,
            ...(isDualSpec ? { autoOptimizeStagesOnDualSpec: false } : {}),
          },
        });
      }
      if (grid.length >= 14) break;
    }
  }

  return grid;
}

function finalizeDistillFixResult(
  initialParams: DistillColumnParams,
  solvedBefore: DistillSolveResult,
  evaluated: DistillEvalCandidate[],
  rootCauses: string[],
  baseActions: string[]
): EquipmentAutoFixResult<DistillColumnParams, DistillSolveResult> {
  const ranked = [...evaluated].sort((a, b) => {
    if (a.allPassed !== b.allPassed) return a.allPassed ? -1 : 1;
    if (a.res.converged !== b.res.converged) return a.res.converged ? -1 : 1;
    if (a.allPassed && b.allPassed) {
      if (Math.abs(a.tacScore - b.tacScore) > 0.05) return a.tacScore - b.tacScore;
      return Math.abs(a.res.reboilerDutyKcalH) - Math.abs(b.res.reboilerDutyKcalH);
    }
    if (a.res.converged && b.res.converged) {
      if (Math.abs(a.score - b.score) > 10) return a.score - b.score;
      return a.tacScore - b.tacScore;
    }
    return a.score - b.score;
  });

  const opt1 = ranked[0];
  const bestParams = opt1.params;
  const bestSol = opt1.res;
  const bestScore = opt1.score;

  // 상위 3개 구별되는 수렴 설계안 (distillOptions) 구성
  const passedPool = ranked.filter((c) => c.allPassed);
  const convergedPool = ranked.filter((c) => c.res.converged);
  const optPool = passedPool.length > 0 ? passedPool : convergedPool;
  const distillOptions: DistillationAutoFixOption[] = [];

  if (optPool.length > 0) {
    const primary = optPool[0];
    const primaryKey = distillCandKey(primary.params, primary.res);
    distillOptions.push({
      id: 'opt-tac',
      labelKo: 'AI 추천 최적안 (최저 TAC)',
      labelEn: 'AI Recommended · Lowest TAC',
      badgeKo: '최저 TAC',
      badgeEn: 'Lowest TAC',
      params: primary.params,
      res: primary.res,
      tacScore: primary.tacScore,
      allPassed: primary.allPassed,
    });

    const chosenKeys = new Set<string>([primaryKey]);

    // Option 2: 저에너지 · 최소 리보일러안
    const energyPool = (passedPool.length > 1 ? passedPool : convergedPool).filter(
      (c) => !chosenKeys.has(distillCandKey(c.params, c.res))
    );
    const opt2 = [...energyPool].sort((a, b) => {
      const qa = Math.abs(a.res.reboilerDutyKcalH);
      const qb = Math.abs(b.res.reboilerDutyKcalH);
      if (Math.abs(qa - qb) > 100) return qa - qb;
      return a.tacScore - b.tacScore;
    })[0];

    if (opt2) {
      chosenKeys.add(distillCandKey(opt2.params, opt2.res));
      distillOptions.push({
        id: 'opt-low-energy',
        labelKo: '저에너지 · 최소 리보일러안',
        labelEn: 'Low Energy · Min Reboiler Q',
        badgeKo: '저에너지',
        badgeEn: 'Low Energy',
        params: opt2.params,
        res: opt2.res,
        tacScore: opt2.tacScore,
        allPassed: opt2.allPassed,
      });
    }

    // Option 3: 최소 변경 · 컴팩트 단수안
    const initN = initialParams.totalStages ?? solvedBefore.totalStagesUsed ?? 24;
    const compactPool = (passedPool.length > 2 ? passedPool : convergedPool).filter(
      (c) => !chosenKeys.has(distillCandKey(c.params, c.res))
    );
    const opt3 = [...compactPool].sort((a, b) => {
      if (a.res.totalStagesUsed !== b.res.totalStagesUsed) {
        return a.res.totalStagesUsed - b.res.totalStagesUsed;
      }
      const dA = Math.abs(a.res.totalStagesUsed - initN);
      const dB = Math.abs(b.res.totalStagesUsed - initN);
      if (dA !== dB) return dA - dB;
      return a.tacScore - b.tacScore;
    })[0];

    if (opt3) {
      distillOptions.push({
        id: 'opt-compact',
        labelKo: '최소 변경 · 컴팩트 단수안',
        labelEn: 'Minimal Change / Compact N',
        badgeKo: '최소 단수',
        badgeEn: 'Compact N',
        params: opt3.params,
        res: opt3.res,
        tacScore: opt3.tacScore,
        allPassed: opt3.allPassed,
      });
    }
  }

  const patch: Partial<DistillColumnParams> = {};
  (Object.keys(bestParams) as Array<keyof DistillColumnParams>).forEach((k) => {
    if (bestParams[k] !== initialParams[k]) {
      (patch as Record<string, unknown>)[k] = bestParams[k];
    }
  });
  if (bestSol.autoStageOptimized || bestParams.columnCalcMode === 'design_stages') {
    if (bestSol.totalStagesUsed > 0 && bestSol.totalStagesUsed !== initialParams.totalStages) {
      patch.totalStages = bestSol.totalStagesUsed;
    }
    if (bestSol.feedStageUsed > 0 && bestSol.feedStageUsed !== initialParams.feedStage) {
      patch.feedStage = bestSol.feedStageUsed;
    }
  }

  const actionsTaken: string[] = [...baseActions];
  if (opt1.actionLabel && !actionsTaken.includes(opt1.actionLabel)) {
    actionsTaken.push(opt1.actionLabel);
  }
  if (solvedBefore.totalStagesUsed !== bestSol.totalStagesUsed) {
    actionsTaken.push(`이론단수 ${solvedBefore.totalStagesUsed}→${bestSol.totalStagesUsed}단`);
  }
  if (solvedBefore.feedStageUsed !== bestSol.feedStageUsed) {
    actionsTaken.push(`공급단 ${solvedBefore.feedStageUsed}→${bestSol.feedStageUsed}단`);
  }
  if (Math.abs(solvedBefore.actualRefluxRatio - bestSol.actualRefluxRatio) > 0.05) {
    actionsTaken.push(
      `환류비 RR ${solvedBefore.actualRefluxRatio.toFixed(2)}→${bestSol.actualRefluxRatio.toFixed(2)}`
    );
  }

  const beforeScore = scoreDistillResult(solvedBefore);
  const beforeTac = computeDistillTacScore(solvedBefore);
  const beforePassed = isDistillStrictPass(solvedBefore);
  const improved =
    (opt1.allPassed && !beforePassed) ||
    bestScore < beforeScore - 1e-3 ||
    (opt1.allPassed && beforePassed && opt1.tacScore < beforeTac - 0.1);
  const resolved = opt1.allPassed;
  const qRebMcalH = (Math.abs(bestSol.reboilerDutyKcalH) / 1000).toFixed(0);
  const headline = resolved
    ? `AI 자동 최적화 완료 (${evaluated.length}개 후보 검증 · 최저 TAC 1번 자동 적용): ${bestSol.totalStagesUsed}단(공급 ${bestSol.feedStageUsed}단) · RR=${bestSol.actualRefluxRatio.toFixed(2)} · D/F=${bestSol.actualDOverFMass.toFixed(3)} · Q_reb=${qRebMcalH} Mcal/h (TAC ${opt1.tacScore.toFixed(1)}).`
    : improved
    ? `AI 조건 개선 완료 (${evaluated.length}개 후보 탐색 · ${bestSol.totalStagesUsed}단 · RR=${bestSol.actualRefluxRatio.toFixed(2)} · D/F=${bestSol.actualDOverFMass.toFixed(3)}): ${bestSol.diagnostics.headline}`
    : `현재 설정에서 자동 수렴 조건을 찾지 못했습니다 — 원료 조성·목표 스펙의 물리적 실현 가능성(공비/비핵심 고비점 유분)을 확인하세요.`;

  return {
    improved,
    resolved,
    patch,
    solvedBefore,
    solvedAfter: bestSol,
    headline,
    rootCauses: Array.from(new Set(rootCauses)),
    actionsTaken: actionsTaken.length > 0 ? actionsTaken : ['단수·공급단·환류비 가이드 격자 탐색 완료'],
    distillOptions,
  };
}

/**
 * 다단 증류탑 폐루프 AI · 가이드 격자 최적화 해결기 (동기 버전, <= 900 ms 예산)
 */
export function autoFixDistillationSimulation(
  feedsInput: DistillFeedInput[],
  initialParams: DistillColumnParams
): EquipmentAutoFixResult<DistillColumnParams, DistillSolveResult> {
  const fixStartMs = Date.now();
  const HARD_BUDGET_MS = 850;
  const REMEDY_BUDGET_MS = 450;

  const solvedBefore = solveRigorousDistillation(feedsInput, initialParams);
  const { rootCauses, steps } = prepareDistillFixContext(feedsInput, initialParams, solvedBefore);

  const evaluated: DistillEvalCandidate[] = [];
  const seenKeys = new Set<string>();
  const recordCand = (
    params: DistillColumnParams,
    res: DistillSolveResult,
    actionLabel?: string
  ): DistillEvalCandidate => {
    const cand: DistillEvalCandidate = {
      params,
      res,
      score: scoreDistillResult(res),
      tacScore: computeDistillTacScore(res),
      allPassed: isDistillStrictPass(res),
      actionLabel,
    };
    const key = distillCandKey(params, res);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      evaluated.push(cand);
    }
    return cand;
  };

  const beforeCand = recordCand({ ...initialParams }, solvedBefore);
  let baseParams: DistillColumnParams = beforeCand.params;
  let baseSol = beforeCand.res;
  let baseScore = beforeCand.score;
  const baseActions: string[] = [];

  // ── Phase 1: 기존 고속 수렴 처방 (진단 처방 / 디캔터·NRTL / 이중스펙 등) ──
  let remedyEvals = 0;
  for (const st of steps) {
    if (remedyEvals >= 6 || Date.now() - fixStartMs > REMEDY_BUDGET_MS) break;
    if (isDistillStrictPass(baseSol) && remedyEvals >= 1) break;
    const patch = st.buildPatch(baseParams, baseSol);
    if (!patch) continue;
    const nextParams: DistillColumnParams = { ...baseParams, ...patch };
    const candRes = solveRigorousDistillation(feedsInput, nextParams);
    remedyEvals++;
    const cand = recordCand(nextParams, candRes, st.label);
    if (cand.score < baseScore - 1e-3 || (cand.allPassed && !isDistillStrictPass(baseSol))) {
      baseParams = nextParams;
      baseSol = candRes;
      baseScore = cand.score;
      baseActions.push(st.label);
    }
  }

  // ── Phase 2: 스마트 가이드 격자 탐색 (단수 × 환류비 × 공급단, <= 850 ms 하드 스톱) ──
  const grid = buildDistillGuidedGrid(baseParams, baseSol, initialParams);
  for (const item of grid) {
    if (Date.now() - fixStartMs > HARD_BUDGET_MS) break;
    const candRes = solveRigorousDistillation(feedsInput, item.params);
    recordCand(item.params, candRes, item.label);
  }

  return finalizeDistillFixResult(initialParams, solvedBefore, evaluated, rootCauses, baseActions);
}

/**
 * 다단 증류탑 비동기 단계별 AI · 가이드 격자 최적화 해결기
 * - 첫 MESH 해석 전과 각 후보 탐색 사이에 브라우저 페인트를 양보하여 UI 멈춤 없이 진행률 표시
 */
export async function autoFixDistillationSimulationAsync(
  feedsInput: DistillFeedInput[],
  initialParams: DistillColumnParams,
  onProgress?: (step: number, total: number, label: string) => void
): Promise<EquipmentAutoFixResult<DistillColumnParams, DistillSolveResult>> {
  const fixStartMs = Date.now();
  const HARD_BUDGET_MS = 850;
  const REMEDY_BUDGET_MS = 450;

  onProgress?.(1, 6, '현재 운전점 및 미수렴·순도 미달 원인 정밀 진단 중...');
  await yieldToBrowser();

  const solvedBefore = solveRigorousDistillation(feedsInput, initialParams);
  const { rootCauses, steps } = prepareDistillFixContext(feedsInput, initialParams, solvedBefore);

  const evaluated: DistillEvalCandidate[] = [];
  const seenKeys = new Set<string>();
  const recordCand = (
    params: DistillColumnParams,
    res: DistillSolveResult,
    actionLabel?: string
  ): DistillEvalCandidate => {
    const cand: DistillEvalCandidate = {
      params,
      res,
      score: scoreDistillResult(res),
      tacScore: computeDistillTacScore(res),
      allPassed: isDistillStrictPass(res),
      actionLabel,
    };
    const key = distillCandKey(params, res);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      evaluated.push(cand);
    }
    return cand;
  };

  const beforeCand = recordCand({ ...initialParams }, solvedBefore);
  let baseParams: DistillColumnParams = beforeCand.params;
  let baseSol = beforeCand.res;
  let baseScore = beforeCand.score;
  const baseActions: string[] = [];

  // Phase 1: 고속 수렴 처방
  let remedyEvals = 0;
  for (let i = 0; i < steps.length; i++) {
    if (remedyEvals >= 6 || Date.now() - fixStartMs > REMEDY_BUDGET_MS) break;
    if (isDistillStrictPass(baseSol) && remedyEvals >= 1) break;
    const st = steps[i];
    onProgress?.(2, 6, st.progressText);
    await yieldToBrowser();

    const patch = st.buildPatch(baseParams, baseSol);
    if (!patch) continue;
    const nextParams: DistillColumnParams = { ...baseParams, ...patch };
    const candRes = solveRigorousDistillation(feedsInput, nextParams);
    remedyEvals++;
    const cand = recordCand(nextParams, candRes, st.label);
    if (cand.score < baseScore - 1e-3 || (cand.allPassed && !isDistillStrictPass(baseSol))) {
      baseParams = nextParams;
      baseSol = candRes;
      baseScore = cand.score;
      baseActions.push(st.label);
    }
  }

  // Phase 2: 가이드 격자 탐색
  const grid = buildDistillGuidedGrid(baseParams, baseSol, initialParams);
  onProgress?.(4, 6, `단수·환류비·공급단 가이드 격자(${grid.length}개 후보) TAC 최적화 탐색 중...`);
  await yieldToBrowser();

  let gridDone = 0;
  for (const item of grid) {
    if (Date.now() - fixStartMs > HARD_BUDGET_MS) break;
    const candRes = solveRigorousDistillation(feedsInput, item.params);
    recordCand(item.params, candRes, item.label);
    gridDone++;
    if (gridDone % 6 === 0 && Date.now() - fixStartMs < HARD_BUDGET_MS - 60) {
      onProgress?.(5, 6, `가이드 격자 탐색 중 (${gridDone}/${grid.length})...`);
      await yieldToBrowser();
    }
  }

  onProgress?.(6, 6, '상위 3개 AI 검증 증류탑 설계 대안 산출 완료');
  return finalizeDistillFixResult(initialParams, solvedBefore, evaluated, rootCauses, baseActions);
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

function isInternalsStrictPass(r: ColumnInternalsSolveResult): boolean {
  if (r.overallStatus === 'critical') return false;
  if (r.maxFloodPct > 82) return false;
  if (r.internalsKind === 'tray' && r.maxDcChokeFloodPct > 80) return false;
  if (r.stageRows.some((s) => s.status === 'flooding' || s.status === 'weeping')) return false;
  if (
    r.designWarnings.some(
      (w) => w.includes('설계 상한') || w.includes('위핑') || w.includes('초크')
    )
  ) {
    return false;
  }
  return true;
}

function getInternalsInstalledCostUsd(r: ColumnInternalsSolveResult): number {
  return Math.round(
    r.costEstimate?.totalModuleUsd ??
      r.costEstimate?.bareModuleUsd ??
      r.costEstimate?.totalPurchaseUsd ??
      0
  );
}

interface InternalsEvalCandidate {
  cfg: ColumnInternalsParams;
  res: ColumnInternalsSolveResult;
  costUsd: number;
  allPassed: boolean;
  score: number;
}

function internalsGeomKey(c: InternalsEvalCandidate): string {
  if (c.res.internalsKind === 'packed') {
    return `packed:${c.res.packingSpec.key}:${c.res.shellSectionMode}:${c.res.governingDiamM.toFixed(2)}:${c.res.totalPackedHeightM.toFixed(2)}`;
  }
  return `tray:${c.res.trayType}:${c.res.traySpacingMm}:${c.res.shellSectionMode}:${c.res.rectifying.flowPasses}:${c.res.stripping.flowPasses}:${c.res.governingDiamM.toFixed(2)}`;
}

function internalsMajorKey(c: InternalsEvalCandidate): string {
  if (c.res.internalsKind === 'packed') {
    return `packed:${c.res.packingSpec.key}:${c.res.shellSectionMode}`;
  }
  return `tray:${c.res.trayType}:${c.res.traySpacingMm}:${c.res.shellSectionMode}`;
}

/**
 * 컬럼 인터널(트레이/패킹 · 범람 · 압력손실 · 경제성) AI 조합 격자 최적화 해결기 (< 50 ms)
 * - 트레이 격자(<=60 조합) + 충진물 격자(16 조합) 고속 조합 스윕
 * - 엄격 통과(범람 ≤ 82%, 위핑/초크 없음) 중 최저 설치원가 1번 자동 적용 +
 *   저차압·고턴다운 여유안(2번) + 대체 인터널(충진탑 ↔ 단탑, 3번) 반환
 */
export function autoFixColumnInternals(
  colParams: DistillColumnParams,
  feeds: DistillFeedInput[],
  simResult: DistillSolveResult
): EquipmentAutoFixResult<ColumnInternalsParams, ColumnInternalsSolveResult> {
  const initialIc: ColumnInternalsParams = { ...(colParams.internalsConfig || {}) };
  const solvedBefore = solveColumnInternalsDesign(colParams, feeds, simResult);
  const rootCauses: string[] = [...solvedBefore.designWarnings];
  if (rootCauses.length === 0 && solvedBefore.maxFloodPct > 82) {
    rootCauses.push(`최대 범람율(${solvedBefore.maxFloodPct.toFixed(1)}%)이 안전 상한(82%)을 초과합니다.`);
  }
  if (solvedBefore.internalsKind === 'tray' && solvedBefore.maxDcChokeFloodPct > 80) {
    rootCauses.push(
      `다운코머 초크 범람율(${solvedBefore.maxDcChokeFloodPct.toFixed(1)}%)이 권장 상한(80%)을 초과합니다.`
    );
  }

  const candidates: InternalsEvalCandidate[] = [];
  const seenKeys = new Set<string>();

  const evalCandidate = (cfg: ColumnInternalsParams, preSolved?: ColumnInternalsSolveResult) => {
    const res =
      preSolved ?? solveColumnInternalsDesign({ ...colParams, internalsConfig: cfg }, feeds, simResult);
    const cand: InternalsEvalCandidate = {
      cfg,
      res,
      costUsd: getInternalsInstalledCostUsd(res),
      allPassed: isInternalsStrictPass(res),
      score: scoreInternalsResult(res),
    };
    const key = internalsGeomKey(cand);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      candidates.push(cand);
    }
  };

  // 현재 설정 포함
  evalCandidate(initialIc, solvedBefore);

  // ── 1-A. Tray 조합 격자 스윕 (<= 60 조합) ──
  const trayTypes: TrayDeckType[] = ['sieve', 'valve'];
  const traySpacingsMm = [450, 500, 600];
  const shellModes: ShellSectionMode[] = ['uniform', 'swaged'];
  const trayFloodTargets = [72, 78];
  const dcBoostPct =
    solvedBefore.maxDcChokeFloodPct > 78
      ? Math.max(15, initialIc.downcomerAreaPct ?? 12)
      : initialIc.downcomerAreaPct;

  for (const trayType of trayTypes) {
    for (const traySpacingMm of traySpacingsMm) {
      for (const shellSectionMode of shellModes) {
        const passGrid: Array<'auto' | 1 | 2> =
          shellSectionMode === 'uniform' ? ['auto', 1, 2] : ['auto', 2];
        for (const designFloodTargetPct of trayFloodTargets) {
          for (const flowPasses of passGrid) {
            evalCandidate({
              ...initialIc,
              internalsKind: 'tray',
              trayType,
              traySpacingMm,
              shellSectionMode,
              designFloodTargetPct,
              flowPasses,
              ...(dcBoostPct !== undefined ? { downcomerAreaPct: dcBoostPct } : {}),
              manualRectDiamM: undefined,
              manualStripDiamM: undefined,
            });
          }
        }
      }
    }
  }

  // ── 1-B. Packed 조합 격자 스윕 (16 조합: 규칙 2종 + 불규칙 2종) ──
  const packingKeys: PackingKey[] = [
    'mellapak_250y',
    'mellapak_350y',
    'imtp_40_metal',
    'pall_ring_38_ss',
  ];
  const packedFloodTargets = [70, 76];

  for (const packingKey of packingKeys) {
    for (const shellSectionMode of shellModes) {
      for (const designFloodTargetPct of packedFloodTargets) {
        evalCandidate({
          ...initialIc,
          internalsKind: 'packed',
          packingKey,
          shellSectionMode,
          designFloodTargetPct,
          manualRectDiamM: undefined,
          manualStripDiamM: undefined,
        });
      }
    }
  }

  // ── 2. 후보 랭킹 (통과안 우선 → 최저 설치원가 순, 미통과안은 최저 페널티 순) ──
  candidates.sort((a, b) => {
    if (a.allPassed !== b.allPassed) return a.allPassed ? -1 : 1;
    if (a.allPassed && b.allPassed) {
      if (a.costUsd !== b.costUsd) return a.costUsd - b.costUsd;
      if ((a.res.overallStatus === 'ok') !== (b.res.overallStatus === 'ok')) {
        return a.res.overallStatus === 'ok' ? -1 : 1;
      }
      return a.res.totalInternalsDpMbar - b.res.totalInternalsDpMbar;
    }
    if (Math.abs(a.score - b.score) > 1e-3) return a.score - b.score;
    return a.costUsd - b.costUsd;
  });

  const opt1 = candidates[0];
  const passingCandidates = candidates.filter((c) => c.allPassed);
  const poolForOpt2 = passingCandidates.length > 1 ? passingCandidates : candidates;

  const opt1Key = internalsGeomKey(opt1);
  const opt1Major = internalsMajorKey(opt1);

  // Option 2: 저차압 · 고턴다운 여유안
  const lowDpSorted = [...poolForOpt2]
    .filter((c) => internalsGeomKey(c) !== opt1Key)
    .sort((a, b) => {
      if (Math.abs(a.res.totalInternalsDpMbar - b.res.totalInternalsDpMbar) > 2.0) {
        return a.res.totalInternalsDpMbar - b.res.totalInternalsDpMbar;
      }
      if (Math.abs(a.res.minTurndownRatio - b.res.minTurndownRatio) > 0.15) {
        return b.res.minTurndownRatio - a.res.minTurndownRatio;
      }
      return a.costUsd - b.costUsd;
    });
  const opt2 =
    lowDpSorted.find((c) => internalsMajorKey(c) !== opt1Major) ?? lowDpSorted[0] ?? null;

  // Option 3: 대체 인터널 (충진탑 ↔ 단탑) 또는 2순위 별도 기하안
  const chosenKeys = new Set<string>([opt1Key, ...(opt2 ? [internalsGeomKey(opt2)] : [])]);
  const chosenMajors = new Set<string>([opt1Major, ...(opt2 ? [internalsMajorKey(opt2)] : [])]);
  const oppositeKind = opt1.res.internalsKind === 'tray' ? 'packed' : 'tray';
  const oppCand =
    passingCandidates.find(
      (c) => c.res.internalsKind === oppositeKind && !chosenKeys.has(internalsGeomKey(c))
    ) ??
    candidates.find(
      (c) =>
        c.res.internalsKind === oppositeKind &&
        (opt1.allPassed ? c.allPassed : true) &&
        !chosenKeys.has(internalsGeomKey(c))
    ) ??
    candidates.find(
      (c) => c.res.internalsKind === oppositeKind && !chosenKeys.has(internalsGeomKey(c))
    );
  const altGeomCand =
    passingCandidates.find(
      (c) => !chosenKeys.has(internalsGeomKey(c)) && !chosenMajors.has(internalsMajorKey(c))
    ) ??
    passingCandidates.find((c) => !chosenKeys.has(internalsGeomKey(c))) ??
    candidates.find((c) => !chosenKeys.has(internalsGeomKey(c))) ??
    null;
  const opt3 = oppCand ?? altGeomCand;

  const internalsOptions: ColumnInternalsAutoFixOption[] = [
    {
      id: 'opt-economical',
      labelKo: 'AI 추천 최적안 (최저 원가)',
      labelEn: 'AI Recommended · Lowest Cost',
      badgeKo: '최저 원가',
      badgeEn: 'Lowest Cost',
      cfg: opt1.cfg,
      res: opt1.res,
      costUsd: opt1.costUsd,
      allPassed: opt1.allPassed,
    },
  ];

  if (opt2) {
    internalsOptions.push({
      id: 'opt-low-dp',
      labelKo: '저차압 · 고턴다운 여유안',
      labelEn: 'Low ΔP · High Turndown',
      badgeKo: '저차압·고턴다운',
      badgeEn: 'Low ΔP',
      cfg: opt2.cfg,
      res: opt2.res,
      costUsd: opt2.costUsd,
      allPassed: opt2.allPassed,
    });
  }

  if (opt3) {
    const isOpposite = opt3.res.internalsKind !== opt1.res.internalsKind;
    internalsOptions.push({
      id: isOpposite ? 'opt-alt-kind' : 'opt-alt-geom',
      labelKo: isOpposite
        ? opt3.res.internalsKind === 'packed'
          ? '대체 인터널 (충진탑 전환)'
          : '대체 인터널 (단탑 전환)'
        : '대체 규격안',
      labelEn: isOpposite
        ? opt3.res.internalsKind === 'packed'
          ? 'Alternative: Packed Column'
          : 'Alternative: Tray Column'
        : 'Alternative Geometry',
      badgeKo: isOpposite
        ? opt3.res.internalsKind === 'packed'
          ? '충진탑 대안'
          : '단탑 대안'
        : '대체 규격',
      badgeEn: isOpposite
        ? opt3.res.internalsKind === 'packed'
          ? 'Packed Alt'
          : 'Tray Alt'
        : 'Alt Spec',
      cfg: opt3.cfg,
      res: opt3.res,
      costUsd: opt3.costUsd,
      allPassed: opt3.allPassed,
    });
  }

  const bestIc = opt1.cfg;
  const bestRes = opt1.res;
  const bestScore = opt1.score;

  // ── 변경 조치 목록 상세 기록 ──
  const actionsTaken: string[] = [];
  if (solvedBefore.internalsKind !== bestRes.internalsKind) {
    actionsTaken.push(
      `인터널 형식 전환 (${solvedBefore.internalsKind === 'tray' ? '단탑(Tray)' : '충진탑(Packed)'} → ${
        bestRes.internalsKind === 'tray' ? '단탑(Tray)' : '충진탑(Packed)'
      })`
    );
  }
  if (initialIc.manualRectDiamM || initialIc.manualStripDiamM) {
    actionsTaken.push('수동 내경 고정 해제 → 수력학 기반 표준 탑경 자동 사이징 전환');
  }
  if (solvedBefore.shellSectionMode !== bestRes.shellSectionMode) {
    actionsTaken.push(
      `동체 직경 구성 변경 (${solvedBefore.shellSectionMode === 'swaged' ? '이단 직경' : '단일 직경'} → ${
        bestRes.shellSectionMode === 'swaged' ? '이단 직경(Swaged)' : '단일 직경(Uniform)'
      })`
    );
  }
  if (bestRes.internalsKind === 'tray') {
    if (solvedBefore.internalsKind !== 'tray' || solvedBefore.trayType !== bestRes.trayType) {
      actionsTaken.push(`트레이 형식 ${solvedBefore.trayType}→${bestRes.trayType} (${bestRes.trayTypeLabel})`);
    }
    if (solvedBefore.internalsKind !== 'tray' || solvedBefore.traySpacingMm !== bestRes.traySpacingMm) {
      actionsTaken.push(`단간격 ${solvedBefore.traySpacingMm}→${bestRes.traySpacingMm} mm`);
    }
    if (
      solvedBefore.internalsKind !== 'tray' ||
      solvedBefore.rectifying.flowPasses !== bestRes.rectifying.flowPasses ||
      solvedBefore.stripping.flowPasses !== bestRes.stripping.flowPasses
    ) {
      actionsTaken.push(
        `유로 패스 수 ${bestRes.rectifying.flowPasses}-Pass(정류)/${bestRes.stripping.flowPasses}-Pass(회수) 적용`
      );
    }
  } else {
    if (
      solvedBefore.internalsKind !== 'packed' ||
      solvedBefore.packingSpec.key !== bestRes.packingSpec.key
    ) {
      actionsTaken.push(`충진물 규격 ${bestRes.packingSpec.name} 적용`);
    }
  }
  if (
    bestIc.designFloodTargetPct !== undefined &&
    bestIc.designFloodTargetPct !== initialIc.designFloodTargetPct
  ) {
    actionsTaken.push(`설계 범람율 목표 ${bestIc.designFloodTargetPct}% 적용`);
  }
  if (Math.abs(solvedBefore.governingDiamM - bestRes.governingDiamM) > 0.01) {
    actionsTaken.push(
      `표준 내경 ${solvedBefore.governingDiamM.toFixed(2)}→${bestRes.governingDiamM.toFixed(2)} m`
    );
  }

  const patch: Partial<ColumnInternalsParams> = {};
  (Object.keys(bestIc) as Array<keyof ColumnInternalsParams>).forEach((k) => {
    if (bestIc[k] !== initialIc[k]) {
      (patch as Record<string, unknown>)[k] = bestIc[k];
    }
  });

  const beforeScore = scoreInternalsResult(solvedBefore);
  const beforePassed = isInternalsStrictPass(solvedBefore);
  const beforeCost = getInternalsInstalledCostUsd(solvedBefore);
  const improved =
    (opt1.allPassed && !beforePassed) ||
    bestScore < beforeScore - 1e-3 ||
    (opt1.allPassed && beforePassed && opt1.costUsd < beforeCost);
  const resolved = opt1.allPassed || bestRes.overallStatus === 'ok';
  const costBeforeK = (beforeCost / 1000).toFixed(1);
  const costAfterK = (opt1.costUsd / 1000).toFixed(1);
  const headline = resolved
    ? `AI 인터널 최적화 완료 (${candidates.length}개 조합 검증 · 최저 원가 1번 $${costAfterK}k 자동 적용): 범람율 ${solvedBefore.maxFloodPct.toFixed(1)}%→${bestRes.maxFloodPct.toFixed(1)}% · ΔP ${solvedBefore.totalInternalsDpMbar.toFixed(1)}→${bestRes.totalInternalsDpMbar.toFixed(1)} mbar · 내경 ${solvedBefore.governingDiamM.toFixed(2)}→${bestRes.governingDiamM.toFixed(2)} m (원가 $${costBeforeK}k→$${costAfterK}k).`
    : `인터널 보정 완료 (${candidates.length}개 조합 탐색): 범람율 ${solvedBefore.maxFloodPct.toFixed(1)}%→${bestRes.maxFloodPct.toFixed(1)}% · ΔP ${solvedBefore.totalInternalsDpMbar.toFixed(1)}→${bestRes.totalInternalsDpMbar.toFixed(1)} mbar · 내경 ${bestRes.governingDiamM.toFixed(2)} m ($${costAfterK}k).`;

  return {
    improved,
    resolved,
    patch,
    solvedBefore,
    solvedAfter: bestRes,
    headline,
    rootCauses,
    actionsTaken:
      actionsTaken.length > 0 ? actionsTaken : ['현재 인터널 수력학 조건이 최적 범위입니다.'],
    internalsOptions,
  };
}

export async function autoFixColumnInternalsAsync(
  colParams: DistillColumnParams,
  feeds: DistillFeedInput[],
  simResult: DistillSolveResult,
  onProgress?: (step: number, total: number, label: string) => void
): Promise<EquipmentAutoFixResult<ColumnInternalsParams, ColumnInternalsSolveResult>> {
  onProgress?.(1, 2, '트레이/충진물 조합 격자 스윕(범람·ΔP·턴다운·원가) 탐색 중...');
  await yieldToBrowser();
  const res = autoFixColumnInternals(colParams, feeds, simResult);
  onProgress?.(2, 2, '상위 3개 AI 검증 인터널 설계 대안 산출 완료');
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

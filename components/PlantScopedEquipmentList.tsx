'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { getPlantRegistryItem } from '@/lib/plantRegistry';
import {
  FlowNodeDef,
  FlowEdgeDef,
  FlowUnitType,
  REFRIGERANT_PRESETS,
  SolvedStream,
  createIdleFlowsheetResult,
  solveFlowsheet,
} from '@/lib/calculations/flowsheetSolver';
import {
  SheetRuntimeData,
  createInitialHierarchySheets,
} from '@/lib/calculations/fullPlantHierarchy';
import { createInitialHcl1AHierarchySheets } from '@/lib/calculations/hcl1AHierarchy';
import { createInitialEchHierarchySheets } from '@/lib/calculations/echPlantHierarchy';
import {
  HX_MATERIAL_CATALOG,
  solveHeatExchangerDesign,
} from '@/lib/calculations/heatExchangerDesign';
import { solveColumnInternalsDesign } from '@/lib/calculations/columnInternalsDesign';
import type { DistillFeedInput } from '@/lib/calculations/rigorousDistillation';
import {
  ChemProSimHandoffPayload,
  buildChemProHandoffPayload,
  saveChemProHandoffPayload,
} from '@/lib/calculations/unitDesignHandoff';

const PLANT02_SAVE_KEY = 'chemplant-plant02-electrolyzer-v2';
const PLANT03_SAVE_KEY = 'chemplant-plant03-hcl1a-v2';
const PLANT04_SAVE_KEY = 'chemplant-plant04-ech-v1';
const BUILDER_SAVE_KEY = 'chemplant-newplant-builder-v1';

type RatingHealth = 'ok' | 'warning' | 'critical' | 'passive';

interface DatasheetSpecItem {
  label: string;
  value: string;
}

interface ScopedEquipRow {
  uid: string;
  nodeId: string;
  sheetId: string;
  sectionCode: string;
  sectionTitle: string;
  tag: string;
  name: string;
  unitType: FlowUnitType | 'stack_bfd';
  categoryLabel: string;
  fluidLabel: string;
  flowSummary: string;
  inletTempPress: string;
  outletTempPress: string;
  dutyOrPower: string;
  powerKwNumeric: number;
  absDutyMcalNumeric: number;
  designSpecSummary: string;
  mechanicalSizingSummary: string;
  ratingLoadSummary: string;
  ratingHealth: RatingHealth;
  ratingBadgeLabel: string;
  materialLabel: string;
  hasEmbeddedWorkbench: boolean;
  handoffPayload: ChemProSimHandoffPayload | null;
  datasheetProcessRows: DatasheetSpecItem[];
  datasheetMechRows: DatasheetSpecItem[];
  datasheetNotes: string[];
}

function unitCategoryLabel(t: FlowUnitType): string {
  switch (t) {
    case 'distillation':
      return '정밀증류탑 (Column)';
    case 'absorber':
      return '흡수·건조탑 (Absorber)';
    case 'desiccant_dryer':
      return '흡착 제습탑 (Dryer)';
    case 'liquefier':
      return '심냉 액화기 (Liquefier)';
    case 'hex':
    case 'cooler':
      return '열교환기·냉각기 (HEX)';
    case 'electrolyzer':
      return '전해조 (Electrolyzer)';
    case 'reactor':
      return '반응기·합성로 (Reactor)';
    case 'evaporator':
      return '강하막 증발관 (Evaporator)';
    case 'compressor':
      return '가스 압축기 (Compressor)';
    case 'pump':
      return '이송 펌프 (Pump)';
    case 'separator':
      return '기액분리기·플래시 (Vessel)';
    case 'saturator':
      return '용해·침전조 (Saturator)';
    case 'chelate_tower':
      return '킬레이트 수지탑 (IX)';
    default:
      return '저장조·부대설비 (Aux)';
  }
}

function defaultMaterialForNode(def: FlowNodeDef): string {
  if (def.params.hxDesignConfig?.material) {
    return HX_MATERIAL_CATALOG[def.params.hxDesignConfig.material]?.shortLabel ?? def.params.hxDesignConfig.material;
  }
  const tagUp = def.tag.toUpperCase();
  const nameUp = def.name.toUpperCase();
  if (nameUp.includes('흑연') || nameUp.includes('GRAPHITE')) return '불침투성 흑연 (Graphite)';
  if (def.unitType === 'liquefier') return 'LTCS (ASTM A334 Gr.6)';
  if (def.unitType === 'electrolyzer') return 'Ti Gr.2 / Ni 200';
  if (def.unitType === 'chelate_tower' || nameUp.includes('FRP') || nameUp.includes('라이닝')) return 'PTFE / FRP Lining';
  if (def.unitType === 'distillation') {
    if (tagUp.includes('230')) return 'Ni-Alloy / Low-Temp CS';
    if (tagUp.includes('310') || tagUp.includes('320')) return 'PTFE Lined / Graphite / Ta';
    return 'SS316L / Duplex';
  }
  if (def.unitType === 'absorber') return 'FRP / PVC-FRP / Brick';
  if (def.unitType === 'evaporator') return 'Nickel 200 / Duplex';
  return 'SS316L / CS';
}

function healthStyle(h: RatingHealth): { bg: string; fg: string; border: string } {
  switch (h) {
    case 'critical':
      return { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' };
    case 'warning':
      return { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' };
    case 'ok':
      return { bg: '#ECFDF5', fg: '#065F46', border: '#6EE7B7' };
    default:
      return { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' };
  }
}

function extractRowsFromSheets(
  sheets: Record<string, SheetRuntimeData>,
  preferSubSheets: boolean,
  plantLabel: string,
  runLiveSolve = false
): ScopedEquipRow[] {
  const sheetList = Object.values(sheets);
  const targetSheets =
    preferSubSheets && sheetList.length > 1
      ? sheetList.filter(s => s.id !== 'master')
      : sheetList;

  const rows: ScopedEquipRow[] = [];

  for (const sh of targetSheets) {
    const solved = runLiveSolve
      ? solveFlowsheet(sh.simDefs, sh.flowEdges)
      : sh.cachedSolvedMeta?.result ?? createIdleFlowsheetResult(sh.simDefs, sh.flowEdges);
    const unitMap = new Map(solved.units.map(u => [u.nodeId, u]));
    const streamByEdge = new Map(solved.streams.map(s => [s.edgeId, s]));

    for (const def of sh.simDefs) {
      if (
        def.unitType === 'feed' ||
        def.unitType === 'product' ||
        def.unitType === 'mixer' ||
        def.unitType === 'splitter'
      ) {
        continue;
      }

      const uRes = unitMap.get(def.id);
      const isVisual =
        def.unitType === 'tank_visual' ||
        def.unitType === 'h_drum_visual' ||
        def.unitType === 'filter_visual' ||
        def.unitType === 'valve_visual' ||
        def.unitType === 'silo_visual';

      const inEdges = sh.flowEdges.filter(e => e.target === def.id && e.targetPort !== 'util_in');
      const outEdges = sh.flowEdges.filter(e => e.source === def.id && e.sourcePort !== 'util_out');
      const utilInEdges = sh.flowEdges.filter(e => e.target === def.id && e.targetPort === 'util_in');
      const utilOutEdges = sh.flowEdges.filter(e => e.source === def.id && e.sourcePort === 'util_out');

      const procInStreams = inEdges
        .map(e => streamByEdge.get(e.id))
        .filter((s): s is SolvedStream => Boolean(s));
      const procOutStreams = outEdges
        .map(e => streamByEdge.get(e.id))
        .filter((s): s is SolvedStream => Boolean(s));
      const utilInStreams = utilInEdges
        .map(e => streamByEdge.get(e.id))
        .filter((s): s is SolvedStream => Boolean(s));
      const utilOutStreams = utilOutEdges
        .map(e => streamByEdge.get(e.id))
        .filter((s): s is SolvedStream => Boolean(s));

      const inKgH = uRes?.inletMassKgH ?? procInStreams.reduce((a, b) => a + b.totalMassKgH, 0);
      const outKgH = uRes?.outletMassKgH ?? procOutStreams.reduce((a, b) => a + b.totalMassKgH, 0);
      const flowSummary =
        inKgH > 0.1
          ? `${inKgH.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg/h`
          : '-';

      const primaryIn = procInStreams[0];
      const primaryOut = procOutStreams[0];
      const inletTempPress = primaryIn
        ? `${primaryIn.tempC.toFixed(1)}°C / ${primaryIn.pressKgcm2g.toFixed(2)} kG (${primaryIn.phase})`
        : '-';
      const outletTempPress = primaryOut
        ? `${primaryOut.tempC.toFixed(1)}°C / ${primaryOut.pressKgcm2g.toFixed(2)} kG (${primaryOut.phase})`
        : '-';

      let dutyOrPower = '-';
      let powerKwNumeric = 0;
      let absDutyMcalNumeric = 0;

      if (uRes) {
        if (Math.abs(uRes.shaftPowerKW) > 0.05) {
          powerKwNumeric = Math.abs(uRes.shaftPowerKW);
          dutyOrPower = `${uRes.shaftPowerKW.toLocaleString(undefined, { maximumFractionDigits: 1 })} kW`;
        } else if (Math.abs(uRes.heatDutyKcalH) > 50) {
          const mcal = uRes.heatDutyKcalH / 1000;
          absDutyMcalNumeric = Math.abs(mcal);
          dutyOrPower = `${mcal >= 0 ? '+' : ''}${mcal.toFixed(1)} Mcal/h`;
        } else if (uRes.distillResult) {
          const qc = uRes.distillResult.condenserDutyKcalH / 1000;
          const qr = uRes.distillResult.reboilerDutyKcalH / 1000;
          absDutyMcalNumeric = Math.abs(qc) + Math.abs(qr);
          dutyOrPower = `Qc ${qc.toFixed(0)} / Qr +${qr.toFixed(0)} Mcal/h`;
        }
      }

      let designSpecSummary = '';
      let mechanicalSizingSummary = '-';
      let ratingLoadSummary = '-';
      let ratingHealth: RatingHealth = isVisual ? 'passive' : 'ok';
      let ratingBadgeLabel = isVisual ? '도면 표기' : '✓ 정상 운전';
      let materialLabel = defaultMaterialForNode(def);
      const hasEmbeddedWorkbench =
        def.unitType === 'distillation' ||
        def.unitType === 'hex' ||
        def.unitType === 'cooler' ||
        def.unitType === 'liquefier';

      const datasheetProcessRows: DatasheetSpecItem[] = [
        { label: '취급 유체 (Fluid)', value: uRes?.detectedFluidLabel || '-' },
        { label: '유입 질량유량', value: flowSummary },
        { label: '입구 온도 / 압력', value: inletTempPress },
        { label: '출구 온도 / 압력', value: outletTempPress },
        { label: '열부하 / 축동력', value: dutyOrPower },
      ];
      const datasheetMechRows: DatasheetSpecItem[] = [];
      let datasheetNotes: string[] = [];

      if (def.unitType === 'distillation') {
        const dRes = uRes?.distillResult;
        const dCfg = def.params.distillConfig ?? {};
        if (dRes) {
          const feeds: DistillFeedInput[] = inEdges
            .map(e => {
              const s = streamByEdge.get(e.id);
              if (!s) return null;
              const stg = dCfg.feedStageMap?.[e.id] ?? dCfg.feedStage ?? Math.max(2, Math.floor((dCfg.totalStages ?? 24) / 2));
              return {
                edgeId: e.id,
                streamNo: e.streamNo,
                stage: stg,
                flowsKgH: s.flowsKgH,
                tempC: s.tempC,
                pressKgcm2g: s.pressKgcm2g,
              };
            })
            .filter((x): x is DistillFeedInput => Boolean(x));

          const colRes = solveColumnInternalsDesign(dCfg, feeds, dRes);
          designSpecSummary = `이론 ${dRes.totalStagesUsed}단 (F:${dRes.feedStageUsed}) · RR=${dRes.actualRefluxRatio.toFixed(2)} · P_top ${(dCfg.topPressKgcm2g ?? 0.05).toFixed(2)} kG`;
          const intLabel =
            colRes.internalsKind === 'packed'
              ? `${colRes.packingSpec.name.split('(')[0].trim()} (${colRes.totalPackedHeightM.toFixed(1)}m)`
              : `${colRes.trayType.toUpperCase()} 트레이 ${colRes.actualTotalTrays}단`;
          mechanicalSizingSummary = `Ø ${colRes.governingDiamM.toFixed(2)} m × H_TT ${colRes.tangentToTangentHeightM.toFixed(1)} m · ${intLabel}`;
          ratingLoadSummary = `최대 범람 ${colRes.maxFloodPct.toFixed(1)}% (제${colRes.maxFloodStage}단) · ΔP ${colRes.totalInternalsDpMbar.toFixed(0)} mbar`;
          materialLabel = colRes.recommendedMaterialLabel.split('(')[0].trim() || materialLabel;

          if (colRes.overallStatus === 'critical') {
            ratingHealth = 'critical';
            ratingBadgeLabel = `✕ 범람위험 (${colRes.maxFloodPct.toFixed(0)}%)`;
          } else if (colRes.overallStatus === 'warning') {
            ratingHealth = 'warning';
            ratingBadgeLabel = `⚠ 부하주의 (${colRes.maxFloodPct.toFixed(0)}%)`;
          } else {
            ratingHealth = 'ok';
            ratingBadgeLabel = `✓ 적정 (${colRes.maxFloodPct.toFixed(0)}% Flood)`;
          }

          const dMassKgH = Object.values(dRes.distillateFlowsKgH).reduce((a, b) => a + b, 0);
          const bMassKgH = Object.values(dRes.bottomsFlowsKgH).reduce((a, b) => a + b, 0);
          datasheetProcessRows.push(
            { label: '탑정 / 탑저 온도', value: `${dRes.topTempC.toFixed(1)}°C / ${dRes.bottomTempC.toFixed(1)}°C` },
            { label: '탑정 D / 탑저 B 유량', value: `D=${dMassKgH.toFixed(1)} / B=${bMassKgH.toFixed(1)} kg/h` }
          );
          datasheetMechRows.push(
            { label: '탑 내경 (Governing ID)', value: `Ø ${colRes.governingDiamM.toFixed(2)} m (${(colRes.governingDiamM * 1000).toFixed(0)} mm)` },
            { label: '동체 높이 (T-T / 총고)', value: `${colRes.tangentToTangentHeightM.toFixed(1)} m / EL ${colRes.totalElevationM.toFixed(1)} m` },
            { label: '내장물 형식', value: intLabel },
            { label: '설계 범람율 / 턴다운비', value: `${colRes.maxFloodPct.toFixed(1)}% / ${colRes.minTurndownRatio.toFixed(1)} : 1` },
            { label: '탑 내 총 압력손실', value: `${colRes.totalInternalsDpMbar.toFixed(1)} mbar (${colRes.totalInternalsDpKgcm2.toFixed(3)} kgf/cm²)` },
            { label: '동체 두께 / 공중량', value: `${colRes.shellWallThicknessMm.toFixed(1)} mm / 약 ${colRes.estimatedDryWeightTon.toFixed(1)} ton` }
          );
          datasheetNotes = colRes.designWarnings;
        } else {
          designSpecSummary = `다단 정밀증류 · N=${dCfg.totalStages ?? 24}단`;
          mechanicalSizingSummary = '시뮬레이션 수렴 대기';
        }
      } else if (def.unitType === 'hex' || def.unitType === 'cooler' || def.unitType === 'liquefier') {
        const hxCfg = def.params.hxDesignConfig ?? {};
        const hxRes = solveHeatExchangerDesign(
          def.unitType,
          def.params,
          hxCfg,
          procInStreams,
          procOutStreams,
          utilInStreams,
          utilOutStreams,
          uRes
        );
        const refKey = def.params.refrigerantPreset ?? (def.unitType === 'liquefier' ? 'freon_m35' : 'cw');
        const refLabel = REFRIGERANT_PRESETS[refKey]?.label.split('(')[0]?.trim() ?? refKey;

        designSpecSummary = `출구 ${def.params.operTempC ?? 30}°C · ${refLabel} · CMTD ${hxRes.cmtdC.toFixed(1)}°C`;
        if (hxRes.hxKind === 'plate_phe') {
          mechanicalSizingSummary = `A=${hxRes.areaProvM2.toFixed(1)} m² · PHE ${hxRes.phePlateCount}매 (${hxRes.pheChevronDeg}°)`;
        } else {
          const shellPrefix = hxRes.shellCount > 1 ? `${hxRes.shellCount}직렬 × ` : '';
          mechanicalSizingSummary = `A=${hxRes.areaProvM2.toFixed(1)} m² · ${shellPrefix}TEMA ${hxRes.temaType} (Ø${hxRes.shellIdMm}mm, ${hxRes.tubeCountPerShell}관)`;
        }
        ratingLoadSummary = `여유율 ${hxRes.actualOverdesignPct >= 0 ? '+' : ''}${hxRes.actualOverdesignPct.toFixed(1)}% · U=${hxRes.uCalcKcalM2HC.toFixed(0)} · ΔT_min ${hxRes.minPinchDeltaTC.toFixed(1)}°C`;
        materialLabel = hxRes.material.shortLabel;

        if (hxRes.overallStatus === 'error') {
          ratingHealth = 'critical';
          ratingBadgeLabel = '✕ 용량초과·교차';
        } else if (hxRes.overallStatus === 'warning') {
          ratingHealth = 'warning';
          ratingBadgeLabel = `⚠ 설계주의 (${hxRes.actualOverdesignPct >= 0 ? '+' : ''}${hxRes.actualOverdesignPct.toFixed(0)}%)`;
        } else {
          ratingHealth = 'ok';
          ratingBadgeLabel = `✓ 여유 +${hxRes.actualOverdesignPct.toFixed(0)}%`;
        }

        datasheetProcessRows.push(
          { label: '유틸리티/냉매 유량', value: `${hxRes.utilitySide.fluidName} · ${hxRes.utilitySide.massFlowKgH.toFixed(0)} kg/h (${hxRes.utilitySide.inTempC.toFixed(1)}→${hxRes.utilitySide.outTempC.toFixed(1)}°C)` },
          { label: '교정 LMTD / 최소 접근온도', value: `CMTD ${hxRes.cmtdC.toFixed(2)}°C (Ft=${hxRes.ftFactor.toFixed(3)}) / ΔT_pinch ${hxRes.minPinchDeltaTC.toFixed(1)}°C` }
        );
        datasheetMechRows.push(
          { label: '형식 규격', value: hxRes.hxKind === 'plate_phe' ? `가스켓 판형 열교환기 (PHE · ${hxRes.phePlateCount}매)` : `다관원통형 TEMA ${hxRes.temaType} (${hxRes.shellCount} Shell, ${hxRes.tubePasses} Pass)` },
          { label: '필요 / 설계 전열면적', value: `필요 ${hxRes.areaReqM2.toFixed(2)} m² / 제공 ${hxRes.areaProvM2.toFixed(2)} m² (여유율 ${hxRes.actualOverdesignPct.toFixed(1)}%)` },
          { label: '총괄 열전달계수 (Clean / Service)', value: `${(hxRes.uCleanWm2K / 1.163).toFixed(0)} / ${hxRes.uCalcKcalM2HC.toFixed(0)} kcal/(m²·h·°C)` },
          { label: '기하 치수', value: hxRes.hxKind === 'plate_phe' ? `${hxRes.phePlateWidthMm}W × ${hxRes.phePlateHeightMm}H mm (채널간격 ${hxRes.pheGapMm}mm)` : `동체 내경 Ø${hxRes.shellIdMm} mm × 관장 ${hxRes.tubeLengthM} m (OD ${hxRes.tubeOdMm}mm × ${hxRes.tubeCountPerShell}본)` },
          { label: '압력손실 (공정 / 유틸리티)', value: `${hxRes.dpProcessKgcm2.toFixed(3)} / ${hxRes.dpUtilityKgcm2.toFixed(3)} kgf/cm²` }
        );
        datasheetNotes = hxRes.diagnostics.filter(d => d.level !== 'ok').map(d => d.message);
      } else if (def.unitType === 'electrolyzer') {
        const units = def.params.unitCount ?? 5;
        const cells = def.params.cellCount ?? 190;
        const kA = def.params.currentKA ?? 16.2;
        designSpecSummary = `${units}기 × ${cells}셀 · ${kA} kA (전류효율 ${def.params.currentEffPct ?? 94}%)`;
        mechanicalSizingSummary = `이온교환막 복극식 전해조 ${units}계열 (총 ${units * cells} Cell)`;
        ratingLoadSummary = `전류밀도 ${(kA / 2.72).toFixed(2)} kA/m² · 운전 ${def.params.operTempC ?? 89}°C`;
        datasheetMechRows.push(
          { label: '전해조 구성', value: `${units} 기 × 기당 ${cells} 셀` },
          { label: '인가 전류 / 전류밀도', value: `${kA} kA / 약 ${(kA / 2.72).toFixed(2)} kA/m²` }
        );
      } else if (def.unitType === 'compressor' || def.unitType === 'pump') {
        const pOut = def.params.outletPressKgcm2g ?? 3.5;
        const eff = (def.params.efficiency ?? 0.75) * 100;
        designSpecSummary = `토출압 ${pOut} kG · 효율 ${eff.toFixed(0)}%`;
        mechanicalSizingSummary =
          def.unitType === 'compressor'
            ? `${def.params.compStages ?? 2}단 인터쿨링 가스 압축기 · 축동력 ${powerKwNumeric.toFixed(1)} kW`
            : `원심식 공정 펌프 (1운전 + 1예비 권장) · 축동력 ${powerKwNumeric.toFixed(1)} kW`;
        ratingLoadSummary = `정격 효율 ${eff.toFixed(0)}% · 모터 여유율 +15% 기준`;
        datasheetMechRows.push(
          { label: '설계 토출압력', value: `${pOut} kgf/cm²G` },
          { label: '단열/수력 효율 및 소요동력', value: `${eff.toFixed(0)}% / 축동력 ${powerKwNumeric.toFixed(2)} kW (권장 모터 ${(powerKwNumeric * 1.18).toFixed(1)} kW)` }
        );
      } else if (def.unitType === 'absorber') {
        const effPct = ((def.params.removalEfficiency ?? 0.999) * 100).toFixed(2);
        const gasVol = primaryIn ? primaryIn.volFlowM3H : inKgH / 1.5;
        const estDiam = Math.max(0.45, Math.sqrt((gasVol / 3600) / (Math.PI * 0.25 * 1.15)));
        designSpecSummary = `목표성분 ${def.params.targetComponent ?? 'HCl'} · 제거율 ${effPct}% (${def.params.columnStages ?? 8}단)`;
        mechanicalSizingSummary = `충진 흡수탑 추정 Ø ${estDiam.toFixed(2)} m · ${def.params.columnStages ?? 8} 이론단`;
        ratingLoadSummary = `설계 공탑유속 ~1.15 m/s · 제거효율 ${effPct}%`;
        datasheetMechRows.push(
          { label: '추정 탑경 / 이론단수', value: `Ø ${estDiam.toFixed(2)} m / ${def.params.columnStages ?? 8} 단` },
          { label: '목표 흡수율', value: `${def.params.targetComponent ?? 'HCl'} ${effPct}%` }
        );
      } else if (def.unitType === 'reactor') {
        designSpecSummary = `전환율 ${((def.params.conversion ?? 0.995) * 100).toFixed(2)}% · 운전 ${def.params.operTempC ?? 180}°C`;
        mechanicalSizingSummary = `화염합성로 / 촉매반응기 · P_op ${def.params.operPressKgcm2g ?? 3.0} kG`;
        ratingLoadSummary = `반응열 제어 정상 · 전환율 ${((def.params.conversion ?? 0.995) * 100).toFixed(2)}%`;
      } else if (def.unitType === 'evaporator') {
        designSpecSummary = `목표 농축 ${def.params.evapTargetConcWt ?? 50} wt% · ${def.params.operTempC ?? 112}°C`;
        mechanicalSizingSummary = `강하막식(Falling-Film) 증발관 · 전열부하 ${absDutyMcalNumeric.toFixed(0)} Mcal/h`;
        ratingLoadSummary = `출구 농도 ${def.params.evapTargetConcWt ?? 50} wt% 수렴`;
      } else if (def.unitType === 'desiccant_dryer') {
        designSpecSummary = `목표 노점 ${def.params.targetDewPointC ?? -60}°C · ΔP ${def.params.columnDeltaPKgcm2 ?? 0.35} kG`;
        mechanicalSizingSummary = '2탑 교대 재생식(Dual-Bed TSA) 흡착 제습 패키지';
        ratingLoadSummary = `출구 노점 ${def.params.targetDewPointC ?? -60}°C 만족`;
      } else if (isVisual) {
        designSpecSummary = def.params.visualSpecNote || '공정 버퍼/저장 설비';
        mechanicalSizingSummary = def.params.visualSpecNote || 'PFD 보조 기기';
        ratingLoadSummary = '통과 유량 동기화';
      } else {
        const volM3H = primaryIn ? primaryIn.volFlowM3H : inKgH / 1000;
        const holdM3 = Math.max(0.8, (volM3H * 10) / 60);
        designSpecSummary = `운전 ${def.params.operTempC ?? 40}°C${outKgH > 0 ? ` · 유출 ${outKgH.toFixed(0)} kg/h` : ''}`;
        mechanicalSizingSummary = `추정 용량 ${holdM3.toFixed(1)} m³ (체류 10분 기준)`;
        ratingLoadSummary = '기액 평형 · 액위 정상';
      }

      const handoffPayload = buildChemProHandoffPayload(
        def,
        sh.flowEdges,
        solved.streams,
        uRes,
        `${plantLabel} · ${sh.shortTabLabel || sh.title}`
      );

      rows.push({
        uid: `${sh.id}-${def.id}`,
        nodeId: def.id,
        sheetId: sh.id,
        sectionCode: sh.sectionCode || sh.id.toUpperCase(),
        sectionTitle: sh.shortTabLabel || sh.title,
        tag: def.tag,
        name: def.name,
        unitType: def.unitType,
        categoryLabel: unitCategoryLabel(def.unitType),
        fluidLabel: uRes?.detectedFluidLabel || '-',
        flowSummary,
        inletTempPress,
        outletTempPress,
        dutyOrPower,
        powerKwNumeric,
        absDutyMcalNumeric,
        designSpecSummary,
        mechanicalSizingSummary,
        ratingLoadSummary,
        ratingHealth,
        ratingBadgeLabel,
        materialLabel,
        hasEmbeddedWorkbench,
        handoffPayload,
        datasheetProcessRows,
        datasheetMechRows,
        datasheetNotes,
      });
    }
  }

  return rows;
}

function buildGreenH2Rows(sf: number): ScopedEquipRow[] {
  const mw = 20 * sf;
  const h2KgH = (450 * sf).toFixed(0);
  const o2KgH = (3570 * sf).toFixed(0);
  const upwKgH = (4050 * sf).toFixed(0);
  return [
    {
      uid: 'gh2-1',
      nodeId: 'gh2-1',
      sheetId: 'master',
      sectionCode: '100-STACK',
      sectionTitle: '100 알칼라인 수전해 스택',
      tag: 'WE-101A~D',
      name: '가압 알칼라인 수전해 스택 모듈',
      unitType: 'stack_bfd',
      categoryLabel: '수전해 스택 (Electrolyzer)',
      fluidLabel: '30 wt% KOH 수용액 / H₂·O₂',
      flowSummary: `H₂ ${h2KgH} kg/h`,
      inletTempPress: '62°C / 15.2 barG',
      outletTempPress: '80°C / 15.0 barG',
      dutyOrPower: `${mw.toFixed(1)} MW DC`,
      powerKwNumeric: mw * 1000,
      absDutyMcalNumeric: 0,
      designSpecSummary: '운전 80°C · 15 barG · 4기 병렬 모듈',
      mechanicalSizingSummary: `5 MW급 가압 스택 × ${Math.max(1, Math.round(4 * sf))}기 모듈`,
      ratingLoadSummary: '예비 기본설계 사양 (BFD)',
      ratingHealth: 'passive',
      ratingBadgeLabel: '예비 사양',
      materialLabel: 'Nickel 200 / Zirfon 격막',
      hasEmbeddedWorkbench: false,
      handoffPayload: null,
      datasheetProcessRows: [
        { label: '수소 생산량', value: `${h2KgH} kg/h` },
        { label: '소비 전력', value: `${mw.toFixed(1)} MW DC` },
      ],
      datasheetMechRows: [{ label: '모듈 구성', value: '5 MW 가압 알칼라인 스택 병렬 패키지' }],
      datasheetNotes: [],
    },
    {
      uid: 'gh2-2',
      nodeId: 'gh2-2',
      sheetId: 'master',
      sectionCode: '100-SEP',
      sectionTitle: '100 기액분리 · KOH 순환',
      tag: 'V-102 / V-103',
      name: '수소(음극) · 산소(양극) 기액분리기',
      unitType: 'separator',
      categoryLabel: '기액분리기 (Vessel)',
      fluidLabel: 'H₂+KOH / O₂+KOH',
      flowSummary: `H₂ ${h2KgH} / O₂ ${o2KgH} kg/h`,
      inletTempPress: '80°C / 15.0 barG',
      outletTempPress: '80°C / 14.9 barG',
      dutyOrPower: '-',
      powerKwNumeric: 0,
      absDutyMcalNumeric: 0,
      designSpecSummary: '수평 데미스터 내장 고압 분리기 · 15 barG',
      mechanicalSizingSummary: 'Ø 1.6 m × L 4.8 m 수평 압력용기 × 2기',
      ratingLoadSummary: '예비 기본설계 사양 (BFD)',
      ratingHealth: 'passive',
      ratingBadgeLabel: '예비 사양',
      materialLabel: 'SS316L / Ni-Clad',
      hasEmbeddedWorkbench: false,
      handoffPayload: null,
      datasheetProcessRows: [{ label: '처리가스 유량', value: `H₂ ${h2KgH} / O₂ ${o2KgH} kg/h` }],
      datasheetMechRows: [{ label: '용기 치수', value: 'Ø 1,600 mm × 4,800 mm T-T' }],
      datasheetNotes: [],
    },
    {
      uid: 'gh2-3',
      nodeId: 'gh2-3',
      sheetId: 'master',
      sectionCode: '100-COOL',
      sectionTitle: '100 기액분리 · KOH 순환',
      tag: 'E-105A/B',
      name: '순환 KOH 전해액 배열 냉각기',
      unitType: 'hex',
      categoryLabel: '열교환기·냉각기 (HEX)',
      fluidLabel: '30 wt% KOH ↔ 냉각수(CW)',
      flowSummary: `순환액 ${(48000 * sf).toFixed(0)} kg/h`,
      inletTempPress: '80°C / 15.0 barG',
      outletTempPress: '62°C / 14.6 barG',
      dutyOrPower: `-${(4.8 * sf * 860).toFixed(0)} Mcal/h`,
      powerKwNumeric: 0,
      absDutyMcalNumeric: 4.8 * sf * 860,
      designSpecSummary: '판형 열교환기(PHE) · 80°C → 62°C 냉각',
      mechanicalSizingSummary: `티타늄/니켈 판형 열교환기 A≈${(185 * sf).toFixed(0)} m²`,
      ratingLoadSummary: '예비 기본설계 사양 (BFD)',
      ratingHealth: 'passive',
      ratingBadgeLabel: '예비 사양',
      materialLabel: 'Nickel 200 / SS316L',
      hasEmbeddedWorkbench: false,
      handoffPayload: null,
      datasheetProcessRows: [{ label: '열제거 부하', value: `${(4.8 * sf * 860).toFixed(0)} Mcal/h` }],
      datasheetMechRows: [{ label: '형식', value: '가스켓 판형 열교환기 (PHE)' }],
      datasheetNotes: [],
    },
    {
      uid: 'gh2-4',
      nodeId: 'gh2-4',
      sheetId: 'master',
      sectionCode: '200-PURIF',
      sectionTitle: '200 고순도 수소 정제',
      tag: 'R-201 / AD-202',
      name: '촉매 탈산소기(DeOxo) & PSA 수분제거 패키지',
      unitType: 'desiccant_dryer',
      categoryLabel: '정제 패키지 (DeOxo·PSA)',
      fluidLabel: '99.999% (5N) 초고순도 H₂',
      flowSummary: `H₂ ${h2KgH} kg/h (순수 ${upwKgH} kg/h)`,
      inletTempPress: '40°C / 14.6 barG',
      outletTempPress: '35°C / 14.2 barG',
      dutyOrPower: `${(85 * sf).toFixed(0)} kW`,
      powerKwNumeric: 85 * sf,
      absDutyMcalNumeric: 0,
      designSpecSummary: 'Pd 촉매 탈산소(O₂ < 2 ppm) + 4탑식 흡착제습(노점 -70°C)',
      mechanicalSizingSummary: 'DeOxo 반응기 + 4-Bed 분자체 흡착탑 스키드',
      ratingLoadSummary: '예비 기본설계 사양 (BFD)',
      ratingHealth: 'passive',
      ratingBadgeLabel: '예비 사양',
      materialLabel: 'SS316L',
      hasEmbeddedWorkbench: false,
      handoffPayload: null,
      datasheetProcessRows: [{ label: '제품 수소 순도', value: '99.999 mol% (O₂ < 2 ppm, 노점 -70°C)' }],
      datasheetMechRows: [{ label: '구성', value: 'Pd 촉매 반응탑 + 4탑식 분자체 제습기' }],
      datasheetNotes: [],
    },
    {
      uid: 'gh2-5',
      nodeId: 'gh2-5',
      sheetId: 'master',
      sectionCode: '300-COMP',
      sectionTitle: '300 고압 수소 압축·출하',
      tag: 'K-301A/B',
      name: '다단 다이어프램 고압 수소 압축기',
      unitType: 'compressor',
      categoryLabel: '가스 압축기 (Compressor)',
      fluidLabel: '고순도 H₂ 가스',
      flowSummary: `H₂ ${h2KgH} kg/h`,
      inletTempPress: '35°C / 14.2 barG',
      outletTempPress: '42°C / 200 barG',
      dutyOrPower: `${(620 * sf).toFixed(0)} kW`,
      powerKwNumeric: 620 * sf,
      absDutyMcalNumeric: 0,
      designSpecSummary: '입구 14.2 barG → 출하 200 barG (튜브트레일러 충전)',
      mechanicalSizingSummary: `무급유 다단 다이어프램 압축기 ${(620 * sf).toFixed(0)} kW`,
      ratingLoadSummary: '예비 기본설계 사양 (BFD)',
      ratingHealth: 'passive',
      ratingBadgeLabel: '예비 사양',
      materialLabel: 'SS316L (수소취성 방지)',
      hasEmbeddedWorkbench: false,
      handoffPayload: null,
      datasheetProcessRows: [{ label: '토출 압력', value: '200 barG (튜브트레일러)' }],
      datasheetMechRows: [{ label: '소요 동력', value: `${(620 * sf).toFixed(0)} kW` }],
      datasheetNotes: [],
    },
  ];
}

export default function PlantScopedEquipmentList() {
  const router = useRouter();
  const {
    activePlantId,
    expansionScaleFactor,
    plant02SyncSeq,
    plant03SyncSeq,
    requestSimNodeAction,
    setLastPlantReturnHref,
  } = useBalanceStore();
  const plantMeta = getPlantRegistryItem(activePlantId);

  const [searchTerm, setSearchTerm] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('ALL');
  const [onlyBottlenecks, setOnlyBottlenecks] = useState<boolean>(false);
  const [rows, setRows] = useState<ScopedEquipRow[]>([]);
  const [sourceNote, setSourceNote] = useState<string>('');
  const [datasheetRow, setDatasheetRow] = useState<ScopedEquipRow | null>(null);
  const loadedSheetsRef = useRef<Record<string, SheetRuntimeData>>({});

  useEffect(() => {
    setSectionFilter('ALL');
    setOnlyBottlenecks(false);
    setDatasheetRow(null);
  }, [activePlantId]);

  useEffect(() => {
    if (activePlantId === 'clorsim') {
      // hidden reference baseline falls back below
    }

    const storageKey =
      activePlantId === 'clorsim_sim'
        ? PLANT02_SAVE_KEY
        : activePlantId === 'hcl_synth'
          ? PLANT03_SAVE_KEY
          : activePlantId === 'ech_gte'
            ? PLANT04_SAVE_KEY
            : BUILDER_SAVE_KEY;

    let sheets: Record<string, SheetRuntimeData> | null = null;
    let savedStamp = '';

    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          savedStamp = parsed?.savedAt ? `자동저장 동기화 (${parsed.savedAt})` : '저장본 동기화됨';
          if (parsed?.hierarchySheets && Object.keys(parsed.hierarchySheets).length > 0) {
            sheets = parsed.hierarchySheets as Record<string, SheetRuntimeData>;
            const actId = parsed.activeSheetId || 'master';
            if (parsed.lastSolvedMeta?.result && sheets[actId] && !sheets[actId].cachedSolvedMeta) {
              sheets = {
                ...sheets,
                [actId]: {
                  ...sheets[actId],
                  cachedSolvedMeta: {
                    result: parsed.lastSolvedMeta.result,
                    elapsedMs: parsed.lastSolvedMeta.elapsedMs ?? 1,
                    lastRunTime: parsed.lastSolvedMeta.lastRunTime ?? '',
                    runCount: parsed.lastSolvedMeta.runCount ?? 1,
                  },
                },
              };
            }
          } else if (Array.isArray(parsed?.simDefs)) {
            sheets = {
              master: {
                id: 'master',
                sectionCode: 'SANDBOX',
                shortTabLabel: '신규 빌더 캔버스',
                title: '신규 공정 플로우시트',
                subtitle: '',
                parentMasterNodeIds: [],
                simDefs: parsed.simDefs as FlowNodeDef[],
                positions: parsed.positions ?? {},
                flowEdges: (parsed.flowEdges ?? []) as FlowEdgeDef[],
                cachedSolvedMeta: parsed.lastSolvedMeta?.result
                  ? {
                      result: parsed.lastSolvedMeta.result,
                      elapsedMs: parsed.lastSolvedMeta.elapsedMs ?? 1,
                      lastRunTime: parsed.lastSolvedMeta.lastRunTime ?? '',
                      runCount: parsed.lastSolvedMeta.runCount ?? 1,
                    }
                  : undefined,
              },
            };
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    if (!sheets) {
      if (activePlantId === 'clorsim_sim') {
        sheets = createInitialHierarchySheets();
        savedStamp = '표준 초기 시뮬레이션 패키지 기준';
      } else if (activePlantId === 'hcl_synth') {
        sheets = createInitialHcl1AHierarchySheets();
        savedStamp = '1A 표준 초기 시뮬레이션 패키지 기준';
      } else if (activePlantId === 'ech_gte') {
        sheets = createInitialEchHierarchySheets();
        savedStamp = 'ECH 70,000 TPA (GTE) 표준 초기 시뮬레이션 패키지 기준';
      } else {
        sheets = {};
        savedStamp = '신규 빌더 캔버스 (배치된 장치 실시간 반영)';
      }
    }

    loadedSheetsRef.current = sheets;
    const extracted = extractRowsFromSheets(
      sheets,
      activePlantId !== 'new_builder',
      `${plantMeta.code} ${plantMeta.shortLabel}`,
      false
    );
    setRows(extracted);
    setSourceNote(savedStamp);
  }, [activePlantId, expansionScaleFactor, plant02SyncSeq, plant03SyncSeq, plantMeta.code, plantMeta.shortLabel]);

  const handleRunManualRefresh = () => {
    if (activePlantId === 'green_h2') return;
    const extracted = extractRowsFromSheets(
      loadedSheetsRef.current,
      activePlantId !== 'new_builder',
      `${plantMeta.code} ${plantMeta.shortLabel}`,
      true
    );
    setRows(extracted);
    setSourceNote(`수동 수렴 갱신 완료 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
  };

  const sections = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach(r => {
      if (!map.has(r.sheetId)) {
        map.set(r.sheetId, `${r.sectionCode} · ${r.sectionTitle}`);
      }
    });
    return Array.from(map.entries());
  }, [rows]);

  const kpis = useMemo(() => {
    let embeddedCount = 0;
    let totalPowerKw = 0;
    let totalAbsDutyMcal = 0;
    let issueCount = 0;
    for (const r of rows) {
      if (r.hasEmbeddedWorkbench) embeddedCount += 1;
      totalPowerKw += r.powerKwNumeric;
      totalAbsDutyMcal += r.absDutyMcalNumeric;
      if (r.ratingHealth === 'critical' || r.ratingHealth === 'warning') issueCount += 1;
    }
    return { embeddedCount, totalPowerKw, totalAbsDutyMcal, issueCount };
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (sectionFilter !== 'ALL' && r.sheetId !== sectionFilter) return false;
      if (onlyBottlenecks && r.ratingHealth !== 'critical' && r.ratingHealth !== 'warning') return false;
      if (!searchTerm.trim()) return true;
      const q = searchTerm.trim().toLowerCase();
      return (
        r.tag.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.categoryLabel.toLowerCase().includes(q) ||
        r.fluidLabel.toLowerCase().includes(q) ||
        r.mechanicalSizingSummary.toLowerCase().includes(q) ||
        r.materialLabel.toLowerCase().includes(q)
      );
    });
  }, [rows, sectionFilter, onlyBottlenecks, searchTerm]);

  const handleOpenUnitAction = (row: ScopedEquipRow, openWorkbench: boolean) => {
    if (activePlantId === 'green_h2') {
      router.push('/material-balance');
      return;
    }
    requestSimNodeAction({
      sheetId: row.sheetId,
      nodeIdOrTag: row.nodeId,
      openWorkbench,
      workbenchView: row.unitType === 'distillation' ? 'internals' : 'thermal',
    });
    router.push(activePlantId === 'new_builder' ? '/flowsheet-simulator' : '/material-balance');
  };

  const handleSendToShortcutToolbox = (row: ScopedEquipRow) => {
    if (!row.handoffPayload) return;
    const stamped = { ...row.handoffPayload, timestamp: Date.now() };
    saveChemProHandoffPayload(stamped);
    setLastPlantReturnHref('/equipment-design?tab=equip');
    router.push(`/unit-equipment?tab=${encodeURIComponent(stamped.tab)}&handoff=1&ts=${stamped.timestamp}`);
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const aoa = [
      [`${plantMeta.code} — ${plantMeta.title} 마스터 장치목록 & 레이팅 요약`],
      ['동기화 기준', sourceNote, '총 장치 수', `${filteredRows.length} 기`],
      [],
      [
        '공정 섹션',
        'Tag No.',
        '장치명',
        '분류',
        '취급 유체',
        '유입 유량',
        '입구 조건',
        '출구 조건',
        '열부하 / 동력',
        '기계 사이징 규격 (탑경·전열면적·용량)',
        '부하율 · 여유율 진단',
        '상태 판정',
        '적용 재질',
      ],
      ...filteredRows.map(r => [
        r.sectionTitle,
        r.tag,
        r.name,
        r.categoryLabel,
        r.fluidLabel,
        r.flowSummary,
        r.inletTempPress,
        r.outletTempPress,
        r.dutyOrPower,
        r.mechanicalSizingSummary,
        r.ratingLoadSummary,
        r.ratingBadgeLabel,
        r.materialLabel,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Master_Equipment_List');
    XLSX.writeFile(wb, `${plantMeta.code.replace(/\s+/g, '_')}_Master_Equipment_List.xlsx`);
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#F6F7F2',
        overflow: 'hidden',
      }}
    >
      {/* 상단 공장 전용 헤더 바 */}
      <div
        style={{
          padding: '11px 18px',
          background: '#FFFFFF',
          borderBottom: '1px solid #DFDCD4',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 6,
                background: plantMeta.accent,
                color: '#FFFFFF',
                fontSize: 10.5,
                fontWeight: 900,
              }}
            >
              {plantMeta.code}
            </span>
            <span style={{ fontSize: 14.5, fontWeight: 900, color: '#0F172A' }}>
              {plantMeta.title} — 실시간 장치목록 &amp; 용량·병목 진단 ({filteredRows.length}기)
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
            플로우시트 수렴 결과와 증류탑·열교환기 내장 사이징(탑경 · 범람율 · 전열면적 · 여유율)이 양방향 연동됩니다 · <b>{sourceNote}</b>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="태그(C-310A, E-225A), 장치명, 규격, 재질 검색..."
            style={{
              width: 245,
              height: 32,
              padding: '0 10px',
              borderRadius: 6,
              border: '1px solid #CBD5E1',
              fontSize: 11.5,
              background: '#F8FAFC',
              color: '#0F172A',
            }}
          />
          {kpis.issueCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyBottlenecks(v => !v)}
              style={{
                height: 32,
                padding: '0 11px',
                borderRadius: 6,
                border: onlyBottlenecks ? '1.5px solid #B45309' : '1px solid #FCD34D',
                background: onlyBottlenecks ? '#B45309' : '#FFFBEB',
                color: onlyBottlenecks ? '#FFFFFF' : '#92400E',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ⚠ 병목·주의 장치만 ({kpis.issueCount})
            </button>
          )}
          {activePlantId !== 'green_h2' && (
            <button
              type="button"
              onClick={handleRunManualRefresh}
              title="저장된 마지막 시뮬레이션 상태 대신 각 공정 섹션의 유량·열부하를 지금 수동 수렴 계산하여 갱신합니다."
              style={{
                height: 32,
                padding: '0 11px',
                borderRadius: 6,
                border: '1px solid #1D4ED8',
                background: '#1D4ED8',
                color: '#FFFFFF',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ▶ 유량 수렴 갱신
            </button>
          )}
          <button
            type="button"
            onClick={handleExportExcel}
            style={{
              height: 32,
              padding: '0 12px',
              borderRadius: 6,
              border: '1px solid #1E3A8A',
              background: '#1E3A8A',
              color: '#FFFFFF',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            📥 엑셀(.xlsx) 마스터 목록 다운로드
          </button>
        </div>
      </div>

      {/* 핵심 엔지니어링 집계 KPI 바 */}
      <div
        style={{
          padding: '8px 18px',
          background: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <KpiMiniCard label="등록 주요 설비" value={`${rows.length} 기`} sub="배관·단순 분기 제외 실장치" />
        <KpiMiniCard
          label="내장 상세설계 연동"
          value={`${kpis.embeddedCount} 기`}
          sub="정밀증류탑 · 열교환기 · 액화기"
        />
        <KpiMiniCard
          label="공장 총 소요 축동력"
          value={`${kpis.totalPowerKw.toLocaleString(undefined, { maximumFractionDigits: 1 })} kW`}
          sub="전해·압축기·펌프 실시간 합산"
        />
        <KpiMiniCard
          label="총 교환 열부하 (|Q|)"
          value={`${kpis.totalAbsDutyMcal.toLocaleString(undefined, { maximumFractionDigits: 0 })} Mcal/h`}
          sub="가열·냉각·응축·재비 합산"
        />
        <KpiMiniCard
          label="용량·레이팅 건전성"
          value={kpis.issueCount === 0 ? '전 기기 적정' : `검토 필요 ${kpis.issueCount} 기`}
          sub={kpis.issueCount === 0 ? '범람·핀치·여유율 정상 범위' : '범람율 >80% 또는 전열여유 부족'}
          warn={kpis.issueCount > 0}
        />
      </div>

      {/* 공정 섹션 필터 칩 */}
      {sections.length > 1 && (
        <div
          style={{
            padding: '7px 18px',
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setSectionFilter('ALL')}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              border: sectionFilter === 'ALL' ? '1.5px solid #0F172A' : '1px solid #CBD5E1',
              background: sectionFilter === 'ALL' ? '#0F172A' : '#FFFFFF',
              color: sectionFilter === 'ALL' ? '#FFFFFF' : '#334155',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            전체 섹션 ({rows.length})
          </button>
          {sections.map(([shId, label]) => {
            const cnt = rows.filter(r => r.sheetId === shId).length;
            const active = sectionFilter === shId;
            return (
              <button
                key={shId}
                type="button"
                onClick={() => setSectionFilter(shId)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: active ? `1.5px solid ${plantMeta.accent}` : '1px solid #CBD5E1',
                  background: active ? plantMeta.accent : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#334155',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {label} ({cnt})
              </button>
            );
          })}
        </div>
      )}

      {/* 장치 테이블 본문 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 18px' }}>
        {filteredRows.length === 0 ? (
          <div
            style={{
              padding: 40,
              background: '#FFFFFF',
              borderRadius: 10,
              border: '1px solid #E2E8F0',
              textAlign: 'center',
              color: '#475569',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>
              조건에 해당하는 장치가 없습니다.
            </div>
            <div style={{ fontSize: 12 }}>
              플로우시트 캔버스에 장치를 배치하거나 필터/검색어를 초기화해 주세요.
            </div>
          </div>
        ) : (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 8,
              border: '1px solid #CBD5E1',
              overflow: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.2 }}>
              <thead>
                <tr style={{ background: '#F1F5F9', borderBottom: '1.5px solid #CBD5E1', color: '#1E293B', textAlign: 'left' }}>
                  <th style={{ padding: '8px 9px', fontWeight: 900, whiteSpace: 'nowrap' }}>섹션</th>
                  <th style={{ padding: '8px 9px', fontWeight: 900, whiteSpace: 'nowrap' }}>Tag No.</th>
                  <th style={{ padding: '8px 9px', fontWeight: 900 }}>장치명 · 유체</th>
                  <th style={{ padding: '8px 9px', fontWeight: 900, textAlign: 'right', whiteSpace: 'nowrap' }}>처리 유량</th>
                  <th style={{ padding: '8px 9px', fontWeight: 900, textAlign: 'right', whiteSpace: 'nowrap' }}>열부하 / 동력</th>
                  <th style={{ padding: '8px 9px', fontWeight: 900 }}>기계 사이징 규격 (탑경 · 면적 · 용량)</th>
                  <th style={{ padding: '8px 9px', fontWeight: 900 }}>부하율 · 여유율 진단</th>
                  <th style={{ padding: '8px 9px', fontWeight: 900, whiteSpace: 'nowrap' }}>재질</th>
                  <th style={{ padding: '8px 9px', fontWeight: 900, textAlign: 'center', whiteSpace: 'nowrap' }}>설계 · 검증 · 시트</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, idx) => {
                  const hs = healthStyle(r.ratingHealth);
                  return (
                    <tr
                      key={r.uid}
                      style={{
                        borderBottom: '1px solid #E2E8F0',
                        background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                      }}
                    >
                      <td style={{ padding: '8px 9px', fontSize: 10.5, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                        {r.sectionCode}
                      </td>
                      <td
                        style={{
                          padding: '8px 9px',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontWeight: 900,
                          color: '#1E3A8A',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.tag}
                      </td>
                      <td style={{ padding: '8px 9px' }}>
                        <div style={{ fontWeight: 800, color: '#0F172A' }}>{r.name}</div>
                        <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>
                          {r.categoryLabel} · {r.fluidLabel}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '8px 9px',
                          textAlign: 'right',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontWeight: 700,
                          color: '#0F172A',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.flowSummary}
                      </td>
                      <td
                        style={{
                          padding: '8px 9px',
                          textAlign: 'right',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontWeight: 700,
                          color: '#1E3A8A',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.dutyOrPower}
                      </td>
                      <td style={{ padding: '8px 9px', color: '#0F172A' }}>
                        <div style={{ fontWeight: 800, fontSize: 11 }}>{r.mechanicalSizingSummary}</div>
                        <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>{r.designSpecSummary}</div>
                      </td>
                      <td style={{ padding: '8px 9px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: hs.bg,
                            border: `1px solid ${hs.border}`,
                            color: hs.fg,
                            fontSize: 10,
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.ratingBadgeLabel}
                        </span>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{r.ratingLoadSummary}</div>
                      </td>
                      <td style={{ padding: '8px 9px', fontSize: 10.5, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
                        {r.materialLabel}
                      </td>
                      <td style={{ padding: '8px 9px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {r.hasEmbeddedWorkbench ? (
                            <button
                              type="button"
                              onClick={() => handleOpenUnitAction(r, true)}
                              title="공정도로 이동하여 이 장치의 내장 상세설계 워크벤치를 즉시 엽니다"
                              style={{
                                padding: '4px 8px',
                                borderRadius: 5,
                                border: '1px solid #1E3A8A',
                                background: '#1E3A8A',
                                color: '#FFFFFF',
                                fontSize: 10.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              🔧 내장설계
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenUnitAction(r, false)}
                              title="공정도에서 해당 장치를 선택·포커스합니다"
                              style={{
                                padding: '4px 8px',
                                borderRadius: 5,
                                border: '1px solid #CBD5E1',
                                background: '#FFFFFF',
                                color: '#1E3A8A',
                                fontSize: 10.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              🔍 도면위치
                            </button>
                          )}
                          {r.handoffPayload && (
                            <button
                              type="button"
                              onClick={() => handleSendToShortcutToolbox(r)}
                              title="현재 유량·온도·압력 조건을 독립 단품 숏컷 계산기(151종 DB)로 전달하여 교차 검증합니다"
                              style={{
                                padding: '4px 7px',
                                borderRadius: 5,
                                border: '1px solid #94A3B8',
                                background: '#F8FAFC',
                                color: '#334155',
                                fontSize: 10,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              ⚡ 숏컷검증
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDatasheetRow(r)}
                            title="엔지니어링 기기 데이터시트(Datasheet) 열람 및 인쇄"
                            style={{
                              padding: '4px 7px',
                              borderRadius: 5,
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#0F172A',
                              fontSize: 10,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            📄 시트
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 엔지니어링 기기 데이터시트(Equipment Datasheet) 모달 */}
      {datasheetRow && (
        <div
          onClick={() => setDatasheetRow(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 760,
              maxHeight: '88vh',
              background: '#FFFFFF',
              borderRadius: 10,
              border: '1px solid #94A3B8',
              boxShadow: '0 20px 45px rgba(15,23,42,0.28)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* 모달 헤더 */}
            <div
              style={{
                padding: '13px 18px',
                background: '#142435',
                color: '#FFFFFF',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 10.5, color: '#93C5FD', fontWeight: 800 }}>
                  PROCESS EQUIPMENT SPECIFICATION DATASHEET · {plantMeta.code}
                </div>
                <div style={{ fontSize: 15, fontWeight: 900, marginTop: 2 }}>
                  [{datasheetRow.tag}] {datasheetRow.name}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {datasheetRow.hasEmbeddedWorkbench && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = datasheetRow;
                      setDatasheetRow(null);
                      handleOpenUnitAction(target, true);
                    }}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 6,
                      border: '1px solid #60A5FA',
                      background: '#1E3A8A',
                      color: '#FFFFFF',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    🔧 내장 상세설계 열기 →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 6,
                    border: '1px solid #475569',
                    background: '#1E293B',
                    color: '#F8FAFC',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🖨 인쇄 / PDF
                </button>
                <button
                  type="button"
                  onClick={() => setDatasheetRow(null)}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 6,
                    border: '1px solid #475569',
                    background: 'transparent',
                    color: '#E2E8F0',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  닫기 ✕
                </button>
              </div>
            </div>

            {/* 모달 본문 */}
            <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 일반 식별 테이블 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: '#F8FAFC',
                  border: '1px solid #CBD5E1',
                }}
              >
                <div>
                  <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>기기 번호 (Item Tag)</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: '#1E3A8A', fontFamily: 'JetBrains Mono, monospace' }}>
                    {datasheetRow.tag}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>소속 공정 섹션</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>{datasheetRow.sectionTitle}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>기기 분류 / 선정 재질</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
                    {datasheetRow.categoryLabel} · {datasheetRow.materialLabel}
                  </div>
                </div>
              </div>

              {/* 1. 공정 운전 조건 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>
                  1. 공정 운전 및 열·물질수지 조건 (Process Operating Conditions)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, border: '1px solid #CBD5E1' }}>
                  <tbody>
                    {datasheetRow.datasheetProcessRows.map(item => (
                      <tr key={item.label} style={{ borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ width: '36%', padding: '7px 10px', background: '#F8FAFC', fontWeight: 800, color: '#334155' }}>
                          {item.label}
                        </td>
                        <td style={{ padding: '7px 10px', fontWeight: 700, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                          {item.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 2. 기계 · 수력학 사이징 사양 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>
                  2. 기계 · 수력학 · 전열 사이징 사양 (Mechanical &amp; Sizing Summary)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, border: '1px solid #CBD5E1' }}>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                      <td style={{ width: '36%', padding: '7px 10px', background: '#F8FAFC', fontWeight: 800, color: '#334155' }}>
                        핵심 기계 규격 요약
                      </td>
                      <td style={{ padding: '7px 10px', fontWeight: 800, color: '#1E3A8A' }}>
                        {datasheetRow.mechanicalSizingSummary}
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                      <td style={{ width: '36%', padding: '7px 10px', background: '#F8FAFC', fontWeight: 800, color: '#334155' }}>
                        부하율 · 여유율 판정
                      </td>
                      <td style={{ padding: '7px 10px', fontWeight: 800, color: '#0F172A' }}>
                        {datasheetRow.ratingBadgeLabel} ({datasheetRow.ratingLoadSummary})
                      </td>
                    </tr>
                    {datasheetRow.datasheetMechRows.map(item => (
                      <tr key={item.label} style={{ borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ width: '36%', padding: '7px 10px', background: '#F8FAFC', fontWeight: 800, color: '#334155' }}>
                          {item.label}
                        </td>
                        <td style={{ padding: '7px 10px', fontWeight: 700, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                          {item.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {datasheetRow.datasheetNotes.length > 0 && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: '#FFFBEB',
                    border: '1px solid #FCD34D',
                    color: '#92400E',
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontWeight: 900, marginBottom: 4 }}>엔지니어링 검토 노트</div>
                  {datasheetRow.datasheetNotes.map((n, i) => (
                    <div key={i}>• {n}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiMiniCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div
      style={{
        padding: '7px 11px',
        borderRadius: 7,
        background: warn ? '#FFFBEB' : '#FFFFFF',
        border: warn ? '1px solid #FCD34D' : '1px solid #CBD5E1',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: warn ? '#92400E' : '#64748B' }}>{label}</div>
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 900,
          color: warn ? '#B45309' : '#0F172A',
          fontFamily: 'JetBrains Mono, monospace',
          marginTop: 2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 1 }}>{sub}</div>
    </div>
  );
}

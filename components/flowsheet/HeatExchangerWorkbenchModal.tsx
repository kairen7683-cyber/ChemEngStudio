'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ENGINEERING_DISCLAIMER_ROWS } from '@/lib/legal/engineeringDisclaimer';
import BufferedNumberInput from '@/components/common/BufferedNumberInput';
import {
  UnitNumberInput,
  UnitSelect,
  useLocalUnit,
} from '@/components/units/UnitControls';
import {
  formatCanonicalValue,
  getUnitLabel,
} from '@/lib/units/unitSystem';
import {
  REFRIGERANT_PRESETS,
  type FlowUnitParams,
  type FlowUnitType,
  type RefrigerantPresetKey,
  type SolvedStream,
  type SolvedUnitResult,
} from '@/lib/calculations/flowsheetSolver';
import {
  HX_MATERIAL_CATALOG,
  solveHeatExchangerDesign,
  type HxDesignParams,
  type HxDesignSolveResult,
  type HxEquipmentKind,
  type HxMaterialCode,
  type HxTubeAllocation,
  type TemaConfiguration,
  type TubeLayoutAngle,
} from '@/lib/calculations/heatExchangerDesign';
import {
  autoFixHeatExchangerAsync,
  fetchOptionalGeminiAdvice,
  type EquipmentAutoFixResult,
} from '@/lib/calculations/aiEquipmentAdvisor';

export type HxWorkbenchView = 'thermal' | 'mechanical';

interface HeatExchangerWorkbenchModalProps {
  open: boolean;
  onClose: () => void;
  unitTag: string;
  unitLabel: string;
  unitType: FlowUnitType;
  params: FlowUnitParams;
  procInStreams: SolvedStream[];
  procOutStreams: SolvedStream[];
  utilInStreams: SolvedStream[];
  utilOutStreams: SolvedStream[];
  unitResult?: SolvedUnitResult;
  isSimDirty: boolean;
  initialView?: HxWorkbenchView;
  onChangeParams: (patch: Partial<FlowUnitParams>) => void;
  onRunSimulation: () => void;
  onOpenChemProDesign?: () => void;
}

type MechVisualTab = 'cad' | 'hydraulics' | 'datasheet';

const MONO = 'JetBrains Mono, monospace';
const BAR_TO_KGCM2 = 1 / 0.980665;
const WM2K_TO_KCALM2HC = 1 / 1.163;

function formatDeltaT(dtC: number, tempUnitId: string): string {
  if (!Number.isFinite(dtC)) return '—';
  if (tempUnitId === 'F') return `${(dtC * 1.8).toFixed(1)} °F`;
  if (tempUnitId === 'K') return `${dtC.toFixed(1)} K`;
  return `${dtC.toFixed(1)} °C`;
}

const cardBox: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  padding: '10px 12px',
};

const lblStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10.5,
  fontWeight: 800,
  color: '#334155',
  marginBottom: 4,
};

const inpStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '3px 8px',
  borderRadius: 5,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  fontSize: 11.5,
  fontWeight: 800,
  fontFamily: MONO,
  boxSizing: 'border-box',
};

const selStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '3px 7px',
  borderRadius: 5,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  fontSize: 11,
  fontWeight: 800,
  boxSizing: 'border-box',
  cursor: 'pointer',
};

export default function HeatExchangerWorkbenchModal({
  open,
  onClose,
  unitTag,
  unitLabel,
  unitType,
  params,
  procInStreams,
  procOutStreams,
  utilInStreams,
  utilOutStreams,
  unitResult,
  isSimDirty,
  initialView = 'thermal',
  onChangeParams,
  onRunSimulation,
  onOpenChemProDesign,
}: HeatExchangerWorkbenchModalProps) {
  const [workbenchView, setWorkbenchView] = useState<HxWorkbenchView>(initialView);
  const [visualTab, setVisualTab] = useState<MechVisualTab>('cad');
  const [isRunningFeedback, setIsRunningFeedback] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePane, setMobilePane] = useState<'inputs' | 'results'>('inputs');
  const [isAiBusy, setIsAiBusy] = useState(false);
  const [aiStepLabel, setAiStepLabel] = useState('');
  const [aiReport, setAiReport] = useState<{
    result: EquipmentAutoFixResult<HxDesignParams, HxDesignSolveResult>;
    geminiNote: string | null;
  } | null>(null);

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);
  const [lastRunStamp, setLastRunStamp] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setWorkbenchView(initialView);
      setAiReport(null);
      setAiStepLabel('');
    }
  }, [open, initialView, unitTag]);

  const triggerRun = () => {
    setIsRunningFeedback(true);
    onRunSimulation();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    setTimeout(() => {
      setIsRunningFeedback(false);
      setLastRunStamp(`${hh}:${mm}:${ss}`);
    }, 220);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'F5') {
        e.preventDefault();
        triggerRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onRunSimulation]);

  const hxCfg: HxDesignParams = params.hxDesignConfig ?? {};
  const patchHxCfg = (patch: Partial<HxDesignParams>) => {
    onChangeParams({
      hxDesignConfig: {
        ...hxCfg,
        ...patch,
      },
    });
  };

  const dRes = useMemo(() => {
    if (!open) return null;
    return solveHeatExchangerDesign(
      unitType,
      params,
      hxCfg,
      procInStreams,
      procOutStreams,
      utilInStreams,
      utilOutStreams,
      unitResult
    );
  }, [
    open,
    unitType,
    params,
    hxCfg,
    procInStreams,
    procOutStreams,
    utilInStreams,
    utilOutStreams,
    unitResult,
  ]);

  const [tempUnit, setTempUnit] = useLocalUnit('temp');
  const [pressUnit, setPressUnit] = useLocalUnit('pressG');
  const [dpUnit, setDpUnit] = useLocalUnit('deltaP');
  const [dutyUnit, setDutyUnit] = useLocalUnit('heatDuty');
  const [areaUnit, setAreaUnit] = useLocalUnit('area');
  const [htcUnit, setHtcUnit] = useLocalUnit('htc');
  const [velUnit, setVelUnit] = useLocalUnit('velocity');
  const [lenUnit, setLenUnit] = useLocalUnit('length');
  const [massUnit, setMassUnit] = useLocalUnit('massFlow');
  const [cpUnit, setCpUnit] = useLocalUnit('cp');
  const [densUnit, setDensUnit] = useLocalUnit('density');
  const [viscUnit, setViscUnit] = useLocalUnit('viscosity');

  if (!open || !dRes) return null;

  const runAiAutoFixHx = async () => {
    setIsAiBusy(true);
    setAiStepLabel('열·수력학 병목 원인 분석 중...');
    setAiReport(null);
    try {
      const fix = await autoFixHeatExchangerAsync(
        unitType,
        params,
        hxCfg,
        procInStreams,
        procOutStreams,
        utilInStreams,
        utilOutStreams,
        unitResult,
        (step, total, label) => {
          setAiStepLabel(`(${step}/${total}) ${label}`);
        }
      );
      if (Object.keys(fix.patch).length > 0) {
        patchHxCfg(fix.patch);
      }
      setWorkbenchView('mechanical');
      const prompt = `[열교환기 ${unitTag}] Q=${fix.solvedAfter.dutyMcalH.toFixed(1)} Mcal/h, Ft=${fix.solvedAfter.ftFactor.toFixed(2)}, Tube ΔP=${fix.solvedAfter.dpTubeBar.toFixed(2)} bar, Shell ΔP=${fix.solvedAfter.dpShellBar.toFixed(2)} bar. 조치: ${fix.actionsTaken.join(', ')}`;
      const geminiNote = await fetchOptionalGeminiAdvice(prompt);
      setAiReport({ result: fix, geminiNote });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setAiReport({
        result: {
          resolved: false,
          improved: false,
          headline: `⚠ AI 자동 해결 중 오류가 발생했습니다 (${errMsg})`,
          rootCauses: [errMsg],
          actionsTaken: [],
          patch: {},
          solvedBefore: dRes,
          solvedAfter: dRes,
        },
        geminiNote: null,
      });
    } finally {
      setIsAiBusy(false);
      setAiStepLabel('');
    }
  };

  const exportHxExcelDatasheet = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const isPhe = dRes.hxKind === 'plate_phe';
    const isProcTube = dRes.allocation === 'process_tube';
    const shellFluid = isProcTube ? dRes.utilitySide : dRes.processSide;
    const tubeFluid = isProcTube ? dRes.processSide : dRes.utilitySide;

    const getVapLiq = (side: typeof shellFluid) => {
      const m = side.massFlowKgH;
      const dPhase = Math.min(m, Math.max(0, side.phaseChangeMassKgH));
      if (side.phaseRegime === 'condensing') {
        return { vIn: m, vOut: Math.max(0, m - dPhase), lIn: 0, lOut: dPhase };
      }
      if (side.phaseRegime === 'boiling') {
        return { vIn: 0, vOut: dPhase, lIn: m, lOut: Math.max(0, m - dPhase) };
      }
      if (side.phaseRegime === 'sensible_gas') {
        return { vIn: m, vOut: m, lIn: 0, lOut: 0 };
      }
      return { vIn: 0, vOut: 0, lIn: m, lOut: m };
    };

    const sVL = getVapLiq(shellFluid);
    const tVL = getVapLiq(tubeFluid);
    const sPinBarG = Number((shellFluid.pressKgcm2g * 0.980665).toFixed(2));
    const tPinBarG = Number((tubeFluid.pressKgcm2g * 0.980665).toFixed(2));
    const sDesP = Math.max(6, Math.ceil((sPinBarG + 2) * 1.15));
    const tDesP = Math.max(6, Math.ceil((tPinBarG + 2) * 1.15));
    const sTestP = Number((sDesP * 1.5).toFixed(1));
    const tTestP = Number((tDesP * 1.5).toFixed(1));
    const sDesT = Math.ceil((Math.max(shellFluid.inTempC, shellFluid.outTempC) + 25) / 5) * 5;
    const tDesT = Math.ceil((Math.max(tubeFluid.inTempC, tubeFluid.outTempC) + 25) / 5) * 5;
    const uReqWm2K = (dRes.dutyKW * 1000) / Math.max(1e-6, dRes.areaProvM2 * Math.max(0.1, dRes.cmtdC));
    const shellNozzle = dRes.nozzles.find((n) => n.side === 'Shell') ?? dRes.nozzles[0];
    const tubeNozzle = dRes.nozzles.find((n) => n.side === 'Tube') ?? dRes.nozzles[2];
    const vib = dRes.vibration;
    const chf = dRes.chfCheck;
    const impText =
      dRes.rhoV2Status === 'OVERSIZE_NOZZLE'
        ? `OVERSIZE NOZZLE REQUIRED (ρv²=${shellNozzle?.rhoV2Pa ?? 0} Pa > 5950 Pa)`
        : dRes.impingementRequired
        ? `IMPINGEMENT PLATE REQUIRED (TEMA RCB-4.6, ρv²=${shellNozzle?.rhoV2Pa ?? 0} Pa > ${dRes.rhoV2LimitPa ?? 2230} Pa)`
        : `NOT REQUIRED (ρv²=${shellNozzle?.rhoV2Pa ?? 0} Pa ≤ ${dRes.rhoV2LimitPa ?? 2230} Pa)`;
    const vibText = vib
      ? `${vib.status.toUpperCase()} | Vortex f_vs/f_n=${vib.vortexRatio.toFixed(2)} (${vib.vortexFreqHz.toFixed(1)}/${vib.naturalFreqHz.toFixed(1)} Hz) | Fluidelastic V/Vc=${vib.fluidelasticRatio.toFixed(2)} (Vc=${vib.criticalVelMs.toFixed(2)} m/s) | Acoustic=${vib.acousticFreqsHz.length > 0 ? `${vib.acousticRatio.toFixed(2)}${vib.acousticRisk ? ' RISK' : ' OK'}` : 'N/A'} | Span 2·Lb=${(vib.windowSpanM * 1000).toFixed(0)}mm (Lb=${(vib.centralSpanM * 1000).toFixed(0)}mm)`
      : `f_vs/f_n=${dRes.vibRatio.toFixed(2)} (${dRes.vortexFreqHz.toFixed(1)}/${dRes.naturalFreqHz.toFixed(1)} Hz)`;
    const chfText = chf
      ? `${chf.status} | q''=${(chf.heatFluxWm2 / 1000).toFixed(1)} kW/m² vs q_CHF,bundle=${(chf.qChfBundleWm2 / 1000).toFixed(1)} kW/m² (Ratio=${chf.chfRatio.toFixed(2)})`
      : 'N/A (No Boiling)';

    const sheet1Rows: (string | number)[][] = isPhe
      ? [
          ['API 662 / ISO 15547-1 — PLATE HEAT EXCHANGER (PHE) SPECIFICATION SHEET', '', '', '', '', 'Date:', dateStr],
          ['Equipment Tag', unitTag, 'Service', unitLabel, 'Type', `Gasketed Chevron PHE (β=${dRes.pheChevronDeg}°)`],
          ['Line', 'Parameter', 'Units', 'Hot Side', 'Cold Side', 'Notes / Basis'],
          [1, 'Plate Pack Size (W × H × Pack L)', 'mm', `${dRes.phePlateWidthMm} × ${dRes.phePlateHeightMm} × ${dRes.phePackLengthMm}`, '', `Gap b = ${dRes.pheGapMm} mm`],
          [2, 'Heat Transfer Surface (Provided / Required)', 'm²', Number(dRes.areaProvM2.toFixed(2)), Number(dRes.areaReqM2.toFixed(2)), `Overdesign +${dRes.actualOverdesignPct.toFixed(1)}%`],
          [3, 'Total Plates / Channels per Side', 'EA', dRes.phePlateCount, dRes.pheChannelsPerSide, `Material: ${dRes.material.label}`],
          [4, 'Fluid Name', '-', dRes.hotSide.fluidName, dRes.coldSide.fluidName, `${dRes.hotSide.phaseLabel} / ${dRes.coldSide.phaseLabel}`],
          [5, 'Mass Flowrate Total', 'kg/h', Number(dRes.hotSide.massFlowKgH.toFixed(1)), Number(dRes.coldSide.massFlowKgH.toFixed(1)), ''],
          [6, 'Temperature In / Out', '°C', `${dRes.hotSide.inTempC.toFixed(1)} → ${dRes.hotSide.outTempC.toFixed(1)}`, `${dRes.coldSide.inTempC.toFixed(1)} → ${dRes.coldSide.outTempC.toFixed(1)}`, `Min Pinch ΔT = ${dRes.minPinchDeltaTC.toFixed(1)} °C`],
          [7, 'Inlet Pressure', 'barG', Number((dRes.hotSide.pressKgcm2g * 0.980665).toFixed(2)), Number((dRes.coldSide.pressKgcm2g * 0.980665).toFixed(2)), ''],
          [8, 'Density / Viscosity', 'kg/m³ / cP', `${dRes.hotSide.densityKgM3.toFixed(1)} / ${dRes.hotSide.viscosityCp.toFixed(3)}`, `${dRes.coldSide.densityKgM3.toFixed(1)} / ${dRes.coldSide.viscosityCp.toFixed(3)}`, ''],
          [9, 'Specific Heat / Conductivity', 'kJ/kg·K / W/m·K', `${(dRes.hotSide.cpKcalKgC * 4.1868).toFixed(3)} / ${dRes.hotSide.conductivityWmK.toFixed(3)}`, `${(dRes.coldSide.cpKcalKgC * 4.1868).toFixed(3)} / ${dRes.coldSide.conductivityWmK.toFixed(3)}`, ''],
          [10, 'Channel Velocity / Reynolds No.', 'm/s / -', `${dRes.velShellMs.toFixed(2)} / ${Math.round(dRes.reShell)}`, `${dRes.velTubeMs.toFixed(2)} / ${Math.round(dRes.reTube)}`, ''],
          [11, 'Pressure Drop (Calc / Allow)', 'bar', `${dRes.dpShellBar.toFixed(3)} / 0.700`, `${dRes.dpTubeBar.toFixed(3)} / 0.700`, ''],
          [12, 'Fouling Factor (Rf)', 'm²·K/W', Number((dRes.hotSide.foulingM2HKcal / 1.163).toFixed(5)), Number((dRes.coldSide.foulingM2HKcal / 1.163).toFixed(5)), ''],
          [13, 'Heat Duty (Q)', 'kW / Mcal/h', Number(dRes.dutyKW.toFixed(1)), Number(dRes.dutyMcalH.toFixed(1)), `USRT = ${dRes.usrt.toFixed(1)}`],
          [14, 'LMTD / CMTD / Ft', '°C / -', Number(dRes.lmtdCounterC.toFixed(2)), Number(dRes.cmtdC.toFixed(2)), `Ft = ${dRes.ftFactor.toFixed(3)}`],
          [15, 'Overall U (Clean / Service / Req)', 'W/m²·K', `${dRes.uCleanWm2K.toFixed(1)} / ${dRes.uCalcWm2K.toFixed(1)} / ${uReqWm2K.toFixed(1)}`, '', `h_A=${dRes.hTubeWm2K.toFixed(0)}, h_B=${dRes.hShellWm2K.toFixed(0)} W/m²·K`],
          [16, 'Design / Hydrotest Pressure', 'barG', `${sDesP} / ${sTestP}`, `${tDesP} / ${tTestP}`, `Design Temp: ${sDesT} / ${tDesT} °C`],
          [17, 'Port Nozzles', 'NPS', shellNozzle ? `DN${shellNozzle.dnMm} (${shellNozzle.npsInch})` : '-', tubeNozzle ? `DN${tubeNozzle.dnMm} (${tubeNozzle.npsInch})` : '-', 'ASME B16.5 CL150'],
          [18, 'CHF (Boiling Dryout) Check', '-', chfText, '', ''],
        ]
      : [
          ['OFFICIAL TEMA SHELL-AND-TUBE HEAT EXCHANGER SPECIFICATION SHEET', '', '', '', '', '', 'Date:', dateStr],
          ['Equipment Tag', unitTag, 'Service', unitLabel, 'TEMA Type', `${dRes.temaType} (Class R)`, 'Status', dRes.overallStatus.toUpperCase()],
          ['Line', 'TEMA Specification Item', 'Units', 'Shell Side In', 'Shell Side Out', 'Tube Side In', 'Tube Side Out', 'Notes / Basis'],
          [1, 'Size (Shell ID / Tube Length)', 'mm', `Ø${dRes.shellIdMm} / ${(dRes.tubeLengthM * 1000).toFixed(0)}`, '', `TEMA ${dRes.temaType}`, `${dRes.shellCount} Series / 1 Parallel`, ''],
          [2, 'Surface per Unit (Prov / Req)', 'm²', Number(dRes.areaProvM2.toFixed(2)), Number(dRes.areaReqM2.toFixed(2)), `Shells: ${dRes.shellCount}`, `Per Shell: ${(dRes.areaProvM2 / Math.max(1, dRes.shellCount)).toFixed(2)}`, `Overdesign +${dRes.actualOverdesignPct.toFixed(1)}%`],
          [3, 'PERFORMANCE OF ONE UNIT', '', '', '', '', '', ''],
          [4, 'Fluid Allocation', '-', `Shell (${shellFluid.roleLabel})`, '', `Tube (${tubeFluid.roleLabel})`, '', ''],
          [5, 'Fluid Name', '-', shellFluid.fluidName, '', tubeFluid.fluidName, '', `${shellFluid.phaseLabel} / ${tubeFluid.phaseLabel}`],
          [6, 'Fluid Quantities (In / Out)', 'kg/h', '', '', '', '', ''],
          [7, 'Flow Total', 'kg/h', Number(shellFluid.massFlowKgH.toFixed(1)), Number(shellFluid.massFlowKgH.toFixed(1)), Number(tubeFluid.massFlowKgH.toFixed(1)), Number(tubeFluid.massFlowKgH.toFixed(1)), ''],
          [8, '  Vapor', 'kg/h', Number(sVL.vIn.toFixed(1)), Number(sVL.vOut.toFixed(1)), Number(tVL.vIn.toFixed(1)), Number(tVL.vOut.toFixed(1)), ''],
          [9, '  Liquid', 'kg/h', Number(sVL.lIn.toFixed(1)), Number(sVL.lOut.toFixed(1)), Number(tVL.lIn.toFixed(1)), Number(tVL.lOut.toFixed(1)), ''],
          [10, '  Phase Change Mass', 'kg/h', Number(shellFluid.phaseChangeMassKgH.toFixed(1)), '', Number(tubeFluid.phaseChangeMassKgH.toFixed(1)), '', ''],
          [11, '  Water / Utility', '-', shellFluid.roleLabel, '', tubeFluid.roleLabel, '', ''],
          [12, '  Noncondensable Mol Frac', 'mol/mol', Number(shellFluid.nonCondensableMolFrac.toFixed(4)), '', Number(tubeFluid.nonCondensableMolFrac.toFixed(4)), '', ''],
          [13, 'Temperature (In / Out)', '°C', Number(shellFluid.inTempC.toFixed(2)), Number(shellFluid.outTempC.toFixed(2)), Number(tubeFluid.inTempC.toFixed(2)), Number(tubeFluid.outTempC.toFixed(2)), `Min Pinch ΔT = ${dRes.minPinchDeltaTC.toFixed(1)} °C`],
          [14, 'Density', 'kg/m³', Number(shellFluid.densityKgM3.toFixed(1)), Number(shellFluid.densityKgM3.toFixed(1)), Number(tubeFluid.densityKgM3.toFixed(1)), Number(tubeFluid.densityKgM3.toFixed(1)), ''],
          [15, 'Viscosity', 'cP', Number(shellFluid.viscosityCp.toFixed(3)), Number(shellFluid.viscosityCp.toFixed(3)), Number(tubeFluid.viscosityCp.toFixed(3)), Number(tubeFluid.viscosityCp.toFixed(3)), ''],
          [16, 'Phase Regime', '-', shellFluid.phaseRegime, '', tubeFluid.phaseRegime, '', ''],
          [17, 'Specific Heat (Cp)', 'kJ/kg·K', Number((shellFluid.cpKcalKgC * 4.1868).toFixed(3)), '', Number((tubeFluid.cpKcalKgC * 4.1868).toFixed(3)), '', ''],
          [18, 'Thermal Conductivity (k)', 'W/m·K', Number(shellFluid.conductivityWmK.toFixed(3)), '', Number(tubeFluid.conductivityWmK.toFixed(3)), '', ''],
          [19, 'Latent Heat', 'kJ/kg', shellFluid.latentHeatKcalKg > 0 ? Number((shellFluid.latentHeatKcalKg * 4.1868).toFixed(1)) : '-', '', tubeFluid.latentHeatKcalKg > 0 ? Number((tubeFluid.latentHeatKcalKg * 4.1868).toFixed(1)) : '-', '', ''],
          [20, 'Inlet Pressure', 'barG', sPinBarG, '', tPinBarG, '', ''],
          [21, 'Velocity / Reynolds No.', 'm/s / -', Number(dRes.velShellMs.toFixed(2)), `Re=${Math.round(dRes.reShell)}`, Number(dRes.velTubeMs.toFixed(2)), `Re=${Math.round(dRes.reTube)}`, ''],
          [22, 'Pressure Drop (Allow / Calc)', 'bar', 0.700, Number(dRes.dpShellBar.toFixed(3)), 0.700, Number(dRes.dpTubeBar.toFixed(3)), ''],
          [23, 'Fouling Resistance (Rf)', 'm²·K/W', Number((shellFluid.foulingM2HKcal / 1.163).toFixed(5)), `h_o=${dRes.hShellWm2K.toFixed(0)} W/m²K`, Number((tubeFluid.foulingM2HKcal / 1.163).toFixed(5)), `h_i=${dRes.hTubeWm2K.toFixed(0)} W/m²K`, ''],
          [24, 'Heat Exchanged / LMTD (CMTD)', 'kW / °C', `${dRes.dutyKW.toFixed(1)} kW (${dRes.dutyMcalH.toFixed(1)} Mcal/h)`, '', `CMTD=${dRes.cmtdC.toFixed(2)} °C`, `LMTD=${dRes.lmtdCounterC.toFixed(2)} °C`, `Ft=${dRes.ftFactor.toFixed(3)}`],
          [25, 'Overall Coeff. U (Clean / Service / Req)', 'W/m²·K', Number(dRes.uCleanWm2K.toFixed(1)), Number(dRes.uCalcWm2K.toFixed(1)), Number(uReqWm2K.toFixed(1)), '', `Overdesign +${dRes.actualOverdesignPct.toFixed(1)}%`],
          [26, 'CONSTRUCTION DATA FOR ONE SHELL', '', '', '', '', '', ''],
          [27, 'Design / Hydrotest Pressure', 'barG', `${sDesP} / ${sTestP}`, '', `${tDesP} / ${tTestP}`, '', ''],
          [28, 'Design Temperature', '°C', sDesT, '', tDesT, '', ''],
          [29, 'No. Passes per Shell', '-', 1, '', dRes.tubePasses, '', ''],
          [30, 'Corrosion Allowance', 'mm', 3.0, '', 3.0, '', 'Tube wall CA: 0.0 mm'],
          [31, 'Connections — In', 'NPS', shellNozzle ? `DN${shellNozzle.dnMm} (${shellNozzle.npsInch})` : '-', '', tubeNozzle ? `DN${tubeNozzle.dnMm} (${tubeNozzle.npsInch})` : '-', '', 'ASME B16.5 CL150 RF'],
          [32, 'Connections — Out', 'NPS', dRes.nozzles[1] ? `DN${dRes.nozzles[1].dnMm} (${dRes.nozzles[1].npsInch})` : '-', '', dRes.nozzles[3] ? `DN${dRes.nozzles[3].dnMm} (${dRes.nozzles[3].npsInch})` : '-', '', 'ASME B16.5 CL150 RF'],
          [33, 'Connections — Intermediate', '-', dRes.shellCount > 1 ? 'Series Jumper' : 'N/A', '', 'Vent/Drain 3/4"', '', ''],
          [34, 'Shell Method / Tube Method', '-', dRes.shellMethodLabel ?? 'Bell-Delaware', '', dRes.tubeMethodLabel ?? 'Gnielinski', '', ''],
          [35, 'Tubes (No. / OD / ID / Length)', 'EA/mm/m', dRes.tubeCountPerShell, `OD ${dRes.tubeOdMm} / ID ${dRes.tubeIdMm.toFixed(2)} mm`, `L = ${dRes.tubeLengthM} m`, `Layout ${dRes.pitchAngle}° (Pt=${dRes.tubePitchMm.toFixed(2)}mm)`, ''],
          [36, 'Tube Type & Material', '-', 'Plain Seamless', '', dRes.material.label, '', `k_w = ${dRes.material.kwWmK} W/m·K`],
          [37, 'Shell ID / Bundle Dia / Material', 'mm', `ID Ø${dRes.shellIdMm}`, `DOTL Ø${dRes.bundleDiaMm}`, dRes.material.label, '', ''],
          [38, 'Channel / Bonnet', '-', `ID Ø${dRes.shellIdMm} mm`, '', `TEMA ${dRes.temaType}`, '', ''],
          [39, 'Tubesheet', '-', 'Fixed / Floating', '', dRes.material.shortLabel, '', ''],
          [40, 'Nozzle ρv² & Impingement Protection', 'Pa', shellNozzle?.rhoV2Pa ?? 0, `Limit ${dRes.rhoV2LimitPa ?? 2230}`, impText, '', 'TEMA RCB-4.6'],
          [41, 'Baffles — Cross (No. / % Cut / Spacing)', 'EA/%/mm', dRes.baffleCount, `${dRes.baffleCutPct}% Cut`, `${dRes.baffleSpacingMm} mm C/C`, '', 'Single Segmental'],
          [42, 'Bell-Delaware J-Factors', '-', dRes.bellDelaware ? `Jtotal=${dRes.bellDelaware.Jtotal.toFixed(3)}` : '-', dRes.bellDelaware ? `Jc=${dRes.bellDelaware.Jc.toFixed(2)}, Jl=${dRes.bellDelaware.Jl.toFixed(2)}, Jb=${dRes.bellDelaware.Jb.toFixed(2)}` : '', '', '', ''],
          [43, 'Flow-Induced Vibration (TEMA RCB-V)', '-', vibText, '', '', '', ''],
          [44, 'Boiling CHF / Dryout Check', '-', chfText, '', '', '', dRes.material.serviceNote],
        ];

    const sheet2Rows: (string | number)[][] = [
      ['1. T-Q THERMAL PROFILE', '', '', '', '', '', '', '', ''],
      ['Q Fraction', 'Cum Duty (Mcal/h)', 'Hot Temp (°C)', 'Cold Temp (°C)', 'Local ΔT (°C)', 'Zone'],
      ...dRes.tqProfile.map((pt) => [
        Number(pt.fracQ.toFixed(3)),
        Number(pt.cumDutyMcalH.toFixed(2)),
        Number(pt.hotTempC.toFixed(2)),
        Number(pt.coldTempC.toFixed(2)),
        Number(pt.deltaTC.toFixed(2)),
        pt.zoneLabel,
      ]),
      [],
      ['2. NOZZLE SCHEDULE & TEMA RCB-4.6 IMPINGEMENT CHECK', '', '', '', '', '', '', '', ''],
      ['Nozzle ID', 'Service', 'Side', 'DN (mm)', 'NPS', 'Velocity (m/s)', 'ρv² (Pa)', 'Limit (Pa)', 'Impingement / Status'],
      ...dRes.nozzles.map((nz) => [
        nz.id,
        nz.service,
        nz.side,
        nz.dnMm,
        nz.npsInch,
        Number(nz.velocityMs.toFixed(2)),
        nz.rhoV2Pa,
        nz.rhoV2LimitPa ?? '-',
        nz.rhoV2Status ?? (nz.impingementRequired ? 'IMPINGEMENT_REQ' : 'OK'),
      ]),
    ];

    if (dRes.zoneRating && dRes.zoneRating.length > 0) {
      sheet2Rows.push(
        [],
        ['3. ZONAL HEAT TRANSFER RATING', '', '', '', '', '', '', '', ''],
        ['Zone', 'Duty (kW)', 'ΔT (°C)', 'h_tube (W/m²·K)', 'h_shell (W/m²·K)', 'U (W/m²·K)', 'Area (m²)'],
        ...dRes.zoneRating.map((z) => [
          z.zone,
          Number(z.dutyKW.toFixed(2)),
          Number(z.dtC.toFixed(2)),
          Number(z.hTubeWm2K.toFixed(1)),
          Number(z.hShellWm2K.toFixed(1)),
          Number(z.uWm2K.toFixed(1)),
          Number(z.areaM2.toFixed(2)),
        ]),
      );
    }

    sheet1Rows.push(...ENGINEERING_DISCLAIMER_ROWS);

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(sheet1Rows);
    ws1['!cols'] = [
      { wch: 7 },
      { wch: 36 },
      { wch: 13 },
      { wch: 22 },
      { wch: 20 },
      { wch: 22 },
      { wch: 20 },
      { wch: 28 },
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(sheet2Rows);
    ws2['!cols'] = [
      { wch: 12 },
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'TEMA_HX_Datasheet');
    XLSX.utils.book_append_sheet(wb, ws2, 'TQ_Profile_Nozzles');

    const safeTag = (unitTag || 'E-101').replace(/[^A-Za-z0-9_-]/g, '_');
    const stdTag = isPhe ? 'API662_PHE' : `TEMA_${dRes.temaType}`;
    XLSX.writeFile(wb, `${safeTag}_${stdTag}_Datasheet_${dateStr}.xlsx`);
  };

  const isLiquefier = unitType === 'liquefier';
  const hexSpecMode = params.hexSpecMode ?? 'proc_temp';
  const refKey: RefrigerantPresetKey =
    params.refrigerantPreset ?? (isLiquefier ? 'freon_m35' : 'cw');

  const statusTone = isRunningFeedback
    ? { bg: '#EFF6FF', fg: '#1D4ED8', bd: '#93C5FD', text: '⏳ 열수지·수력학 계산 실행 중...' }
    : isSimDirty
    ? { bg: '#FFFBEB', fg: '#92400E', bd: '#FCD34D', text: '운전조건 변경됨 — [▶ RUN] 실행 필요' }
    : dRes.overallStatus === 'error'
    ? { bg: '#FEF2F2', fg: '#991B1B', bd: '#FCA5A5', text: '✕ 열역학 핀치 또는 재질 안전 점검 필요' }
    : dRes.overallStatus === 'warning'
    ? { bg: '#FFFBEB', fg: '#92400E', bd: '#FCD34D', text: '⚠ 압력손실·접근온도 권장치 점검' }
    : {
        bg: '#DCFCE7',
        fg: '#166534',
        bd: '#86EFAC',
        text: `✓ 열수지·수력학·재질 정상 (${dRes.hxKind === 'plate_phe' ? '판형 PHE' : `TEMA ${dRes.temaType}`} · ${dRes.areaProvM2.toFixed(1)} m²)`,
      };

  const renderTQProfileSvg = () => {
    const pts = dRes.tqProfile;
    const W = 470;
    const H = 265;
    const padL = 48;
    const padR = 22;
    const padT = 26;
    const padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const allT = pts.flatMap((p) => [p.hotTempC, p.coldTempC]);
    const tMin = Math.floor(Math.min(...allT) - 5);
    const tMax = Math.ceil(Math.max(...allT, tMin + 10) + 5);

    const xOfF = (f: number) => padL + f * plotW;
    const yOfT = (t: number) =>
      padT + (1 - (t - tMin) / Math.max(1e-5, tMax - tMin)) * plotH;

    const hotPoly = pts.map((p) => `${xOfF(p.fracQ).toFixed(1)},${yOfT(p.hotTempC).toFixed(1)}`).join(' ');
    const coldPoly = pts.map((p) => `${xOfF(p.fracQ).toFixed(1)},${yOfT(p.coldTempC).toFixed(1)}`).join(' ');
    const areaPoly = [
      ...pts.map((p) => `${xOfF(p.fracQ).toFixed(1)},${yOfT(p.hotTempC).toFixed(1)}`),
      ...pts
        .slice()
        .reverse()
        .map((p) => `${xOfF(p.fracQ).toFixed(1)},${yOfT(p.coldTempC).toFixed(1)}`),
    ].join(' ');

    // 최소 핀치 지점 찾기
    let pinchPt = pts[0];
    for (const p of pts) {
      if (p.deltaTC < pinchPt.deltaTC) pinchPt = p;
    }
    const px = xOfF(pinchPt.fracQ);
    const pyHot = yOfT(pinchPt.hotTempC);
    const pyCold = yOfT(pinchPt.coldTempC);
    const isCross = pinchPt.deltaTC <= 0.5;

    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          background: '#FFFFFF',
          borderRadius: 8,
          border: '1px solid #CBD5E1',
        }}
      >
        {/* 수평 온도 격자 */}
        {[0, 0.25, 0.5, 0.75, 1].map((fr, idx) => {
          const tv = tMin + fr * (tMax - tMin);
          const yp = yOfT(tv);
          return (
            <g key={`tg-${idx}`}>
              <line x1={padL} x2={W - padR} y1={yp} y2={yp} stroke="#F1F5F9" />
              <text x={padL - 6} y={yp + 3.5} fontSize={9.5} textAnchor="end" fill="#64748B" fontFamily={MONO}>
                {tv.toFixed(0)}°C
              </text>
            </g>
          );
        })}

        {/* 수직 누적 열량 격자 */}
        {[0, 0.25, 0.5, 0.75, 1].map((fr, idx) => {
          const xp = xOfF(fr);
          const qVal = fr * dRes.dutyMcalH;
          return (
            <g key={`qg-${idx}`}>
              <line x1={xp} x2={xp} y1={padT} y2={H - padB} stroke="#F1F5F9" />
              <text x={xp} y={H - 11} fontSize={9.5} textAnchor="middle" fill="#64748B" fontFamily={MONO}>
                {qVal.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* 추진력 영역 채우기 */}
        <polygon
          points={areaPoly}
          fill={isCross ? 'rgba(220, 38, 38, 0.10)' : 'rgba(37, 99, 235, 0.07)'}
        />

        {/* 고온측(앰버-오렌지) & 저온측(스틸-블루) 곡선 */}
        <polyline fill="none" stroke="#D97706" strokeWidth={2.5} points={hotPoly} />
        <polyline fill="none" stroke="#0284C7" strokeWidth={2.5} points={coldPoly} />

        {/* 이슬점(Dew Point) 꺾임 마커 */}
        {dRes.dewPointC !== null && dRes.latentDutyMcalH > 0.05 && (
          <g>
            <circle
              cx={xOfF(Math.min(0.85, dRes.desupDutyMcalH / Math.max(0.1, dRes.dutyMcalH)))}
              cy={yOfT(dRes.dewPointC)}
              r={4}
              fill="#D97706"
            />
            <text
              x={xOfF(Math.min(0.85, dRes.desupDutyMcalH / Math.max(0.1, dRes.dutyMcalH))) + 6}
              y={yOfT(dRes.dewPointC) - 5}
              fontSize={9.5}
              fontWeight={800}
              fill="#92400E"
            >
              이슬점 {dRes.dewPointC.toFixed(1)}°C
            </text>
          </g>
        )}

        {/* 최소 접근온도(Pinch ΔT) 표시선 */}
        <line
          x1={px}
          x2={px}
          y1={pyHot}
          y2={pyCold}
          stroke={isCross ? '#DC2626' : '#0F766E'}
          strokeWidth={1.8}
          strokeDasharray="3 2"
        />
        <circle cx={px} cy={pyHot} r={3.5} fill="#D97706" />
        <circle cx={px} cy={pyCold} r={3.5} fill="#0284C7" />
        <text
          x={Math.min(W - padR - 85, Math.max(padL + 6, px + 6))}
          y={0.5 * (pyHot + pyCold) + 3}
          fontSize={10}
          fontWeight={900}
          fill={isCross ? '#DC2626' : '#0F766E'}
        >
          Pinch ΔT = {pinchPt.deltaTC.toFixed(1)}°C
        </text>

        {/* 상단 범례 */}
        <text x={padL} y={16} fontSize={10} fontWeight={800} fill="#B45309">
          ━ 고온측 ({dRes.hotSide.inTempC.toFixed(1)} → {dRes.hotSide.outTempC.toFixed(1)}°C)
        </text>
        <text x={padL + 195} y={16} fontSize={10} fontWeight={800} fill="#0369A1">
          ━ 저온측 향류 ({dRes.coldSide.inTempC.toFixed(1)} → {dRes.coldSide.outTempC.toFixed(1)}°C)
        </text>
        <text x={W - padR} y={H - 2} fontSize={9} textAnchor="end" fill="#64748B">
          누적 교환열량 Q (Mcal/h)
        </text>
      </svg>
    );
  };

  const renderCadDrawingSvg = () => {
    const W = 500;
    const H = 295;

    if (dRes.hxKind === 'plate_phe') {
      return (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            background: '#FFFFFF',
            borderRadius: 8,
            border: '1px solid #CBD5E1',
          }}
        >
          <text x={16} y={22} fontSize={11} fontWeight={900} fill="#0F172A">
            판형 열교환기 (Chevron PHE) 개념설계 외형도 · 포트 배치도
          </text>
          <text x={16} y={37} fontSize={9.8} fill="#475569" fontFamily={MONO}>
            전열판 {dRes.phePlateCount}매 ({dRes.material.shortLabel}) · 쉐브론 {dRes.pheChevronDeg}° · 유효면적 {dRes.areaProvM2.toFixed(1)} m²
          </text>

          {/* 측면 프레임 + 판 팩(Plate Pack) */}
          <rect x={48} y={72} width={16} height={165} rx={2} fill="#334155" />
          <rect x={64} y={82} width={170} height={145} fill="#F1F5F9" stroke="#475569" strokeWidth={1.5} />
          {Array.from({ length: 16 }).map((_, idx) => {
            const xp = 72 + idx * 10;
            return <line key={idx} x1={xp} x2={xp} y1={83} y2={226} stroke="#94A3B8" strokeWidth={1} />;
          })}
          <rect x={234} y={72} width={14} height={165} rx={2} fill="#475569" />
          {/* 상하 가이드 바 & 타이볼트 */}
          <rect x={44} y={66} width={236} height={6} fill="#64748B" />
          <rect x={44} y={237} width={236} height={7} fill="#64748B" />
          <line x1={64} x2={234} y1={258} y2={258} stroke="#1E3A8A" strokeWidth={1.3} />
          <text x={149} y={272} fontSize={10} fontWeight={800} fill="#1E3A8A" textAnchor="middle" fontFamily={MONO}>
            판 팩 압축길이 L_pack = {dRes.phePackLengthMm} mm
          </text>

          {/* 우측 전면 고정판 4-포트 배치 + 쉐브론 패턴 */}
          <rect x={325} y={62} width={125} height={185} rx={8} fill="#F8FAFC" stroke="#1E3A8A" strokeWidth={2} />
          {[
            { cx: 352, cy: 90, lbl: 'N1' },
            { cx: 423, cy: 90, lbl: 'N3' },
            { cx: 352, cy: 218, lbl: 'N2' },
            { cx: 423, cy: 218, lbl: 'N4' },
          ].map((pt) => (
            <g key={pt.lbl}>
              <circle cx={pt.cx} cy={pt.cy} r={13} fill="#EFF6FF" stroke="#2563EB" strokeWidth={1.8} />
              <text x={pt.cx} y={pt.cy + 3.5} fontSize={9.5} fontWeight={900} textAnchor="middle" fill="#1E3A8A" fontFamily={MONO}>
                {pt.lbl}
              </text>
            </g>
          ))}
          {[118, 136, 154, 172, 190].map((yv, i) => (
            <polyline
              key={i}
              fill="none"
              stroke="#64748B"
              strokeWidth={1.3}
              points={`345,${yv} 366,${yv - 9} 387,${yv} 408,${yv - 9} 430,${yv}`}
            />
          ))}
          <text x={387} y={266} fontSize={10} fontWeight={800} textAnchor="middle" fill="#334155" fontFamily={MONO}>
            판 규격 {dRes.phePlateWidthMm}W × {dRes.phePlateHeightMm}H mm
          </text>
        </svg>
      );
    }

    const isKettle = dRes.temaType === 'BKM';
    const isUTube = dRes.temaType === 'BEU';
    const shellTop = isKettle ? 74 : 96;
    const shellH = isKettle ? 122 : 100;
    const bundleTop = 106;
    const bundleH = 82;
    const visBaffles = Math.min(10, Math.max(3, dRes.baffleCount));

    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          background: '#FFFFFF',
          borderRadius: 8,
          border: '1px solid #CBD5E1',
        }}
      >
        <text x={14} y={21} fontSize={11} fontWeight={900} fill="#0F172A">
          TEMA {dRes.temaType} 다관원통형 열교환기 개념설계 종단면도 & 관배열(A-A)
        </text>
        <text x={14} y={36} fontSize={9.8} fill="#475569" fontFamily={MONO}>
          동체 내경 Ø{dRes.shellIdMm} mm × {dRes.shellCount}기 · 튜브 Ø{dRes.tubeOdMm}×{dRes.tubeLengthM}m ({dRes.tubeCountPerShell}본, {dRes.tubePasses}패스) · {dRes.material.shortLabel}
        </text>

        {/* 전면 헤더 (Front Stationary Head - B형 보닛/채널) */}
        <path
          d="M 48 96 L 74 96 L 74 196 L 48 196 Q 30 146 48 96 Z"
          fill="#EFF6FF"
          stroke="#1E3A8A"
          strokeWidth={2}
        />
        {/* 전면 관판 (Tubesheet) */}
        <rect x={74} y={92} width={6} height={108} fill="#1E293B" />

        {/* 주 동체 (Main Shell — BKM일 때 상부 기액분리 공간 확관 표현) */}
        {isKettle ? (
          <path
            d="M 80 96 L 108 74 L 285 74 L 285 196 L 80 196 Z"
            fill="#F8FAFC"
            stroke="#334155"
            strokeWidth={2}
          />
        ) : (
          <rect
            x={80}
            y={shellTop}
            width={220}
            height={shellH}
            fill="#F8FAFC"
            stroke="#334155"
            strokeWidth={2}
          />
        )}

        {/* 튜브 번들 라인 */}
        {[0, 1, 2, 3, 4, 5].map((idx) => {
          const yt = bundleTop + 6 + idx * 13;
          return (
            <line
              key={idx}
              x1={80}
              x2={isUTube ? 282 : 300}
              y1={yt}
              y2={yt}
              stroke="#64748B"
              strokeWidth={1.2}
            />
          );
        })}
        {isUTube && (
          <path
            d="M 282 112 Q 298 146 282 180"
            fill="none"
            stroke="#64748B"
            strokeWidth={1.6}
          />
        )}

        {/* 분절 배플 (Segmental Baffles) */}
        {!isKettle &&
          Array.from({ length: visBaffles }).map((_, bi) => {
            const bx = 98 + ((bi + 0.5) / visBaffles) * 184;
            const y1 = bi % 2 === 0 ? shellTop + 2 : shellTop + 26;
            const y2 = bi % 2 === 0 ? shellTop + shellH - 26 : shellTop + shellH - 2;
            return <line key={bi} x1={bx} x2={bx} y1={y1} y2={y2} stroke="#1D4ED8" strokeWidth={1.7} />;
          })}

        {/* 후면 헤더 (Rear Head) */}
        {!isUTube && !isKettle && <rect x={300} y={92} width={6} height={108} fill="#1E293B" />}
        <path
          d={
            isKettle
              ? 'M 285 74 L 306 74 Q 324 135 306 196 L 285 196 Z'
              : 'M 306 96 L 326 96 Q 344 146 326 196 L 306 196 Z'
          }
          fill="#F1F5F9"
          stroke="#334155"
          strokeWidth={2}
        />

        {/* 노즐 N1~N4 */}
        {/* N1 Shell In */}
        <rect x={108} y={shellTop - 20} width={14} height={20} fill="#E2E8F0" stroke="#334155" strokeWidth={1.5} />
        <text x={115} y={shellTop - 24} fontSize={9.5} fontWeight={900} textAnchor="middle" fill="#0F172A" fontFamily={MONO}>
          N1 ({dRes.nozzles[0]?.npsInch})
        </text>
        {/* N2 Shell Out */}
        <rect x={256} y={196} width={14} height={20} fill="#E2E8F0" stroke="#334155" strokeWidth={1.5} />
        <text x={263} y={229} fontSize={9.5} fontWeight={900} textAnchor="middle" fill="#0F172A" fontFamily={MONO}>
          N2 ({dRes.nozzles[1]?.npsInch})
        </text>
        {/* N3/N4 Tube In/Out */}
        <rect x={52} y={76} width={12} height={20} fill="#DBEAFE" stroke="#1E3A8A" strokeWidth={1.5} />
        <text x={58} y={71} fontSize={9.5} fontWeight={900} textAnchor="middle" fill="#1E3A8A" fontFamily={MONO}>
          N3 ({dRes.nozzles[2]?.npsInch})
        </text>
        <rect x={52} y={196} width={12} height={20} fill="#DBEAFE" stroke="#1E3A8A" strokeWidth={1.5} />
        <text x={58} y={229} fontSize={9.5} fontWeight={900} textAnchor="middle" fill="#1E3A8A" fontFamily={MONO}>
          N4 ({dRes.nozzles[3]?.npsInch})
        </text>

        {/* 치수 보조선 */}
        <line x1={80} x2={300} y1={250} y2={250} stroke="#1E3A8A" strokeWidth={1.2} />
        <text x={190} y={264} fontSize={9.8} fontWeight={800} textAnchor="middle" fill="#1E3A8A" fontFamily={MONO}>
          유효 관길이 L = {dRes.tubeLengthM.toFixed(2)} m · 배플 {dRes.baffleCount}단 (간격 {dRes.baffleSpacingMm} mm)
        </text>

        {/* 우측 A-A 동체 단면도 */}
        <circle cx={422} cy={146} r={54} fill="#F8FAFC" stroke="#334155" strokeWidth={2} />
        <circle cx={422} cy={146} r={45} fill="none" stroke="#94A3B8" strokeDasharray="3 2" />
        {[-24, -12, 0, 12, 24].map((dx) =>
          [-24, -12, 0, 12, 24].map((dy) => {
            if (dx * dx + dy * dy > 36 * 36) return null;
            return (
              <circle
                key={`${dx}-${dy}`}
                cx={422 + dx}
                cy={146 + dy}
                r={2.8}
                fill="#2563EB"
              />
            );
          })
        )}
        <text x={422} y={216} fontSize={9.8} fontWeight={800} textAnchor="middle" fill="#0F172A" fontFamily={MONO}>
          단면 A-A (Ø{dRes.shellIdMm} mm)
        </text>
        <text x={422} y={230} fontSize={9} textAnchor="middle" fill="#475569" fontFamily={MONO}>
          피치 {dRes.tubePitchMm}mm ({dRes.pitchAngle}° 배열)
        </text>
      </svg>
    );
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.56)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 18,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: isMobile ? '100vw' : 'min(1200px, 96vw)',
          height: isMobile ? '100dvh' : 'min(840px, 92vh)',
          background: '#F8FAFC',
          borderRadius: isMobile ? 0 : 12,
          border: isMobile ? 'none' : '1px solid #CBD5E1',
          boxShadow: '0 24px 56px rgba(15, 23, 42, 0.30)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 상단 헤더 */}
        <div
          style={{
            padding: '11px 16px',
            background: '#0F172A',
            color: '#F8FAFC',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                background: '#1E3A8A',
                color: '#DBEAFE',
                fontSize: 11,
                fontWeight: 900,
                fontFamily: MONO,
              }}
            >
              [{unitTag}]
            </span>
            <span style={{ fontSize: 14.5, fontWeight: 900 }}>
              {unitLabel} — 열교환기 설계 워크벤치
            </span>
            <span
              style={{
                padding: '2.5px 9px',
                borderRadius: 999,
                background: statusTone.bg,
                color: statusTone.fg,
                border: `1px solid ${statusTone.bd}`,
                fontSize: 10.5,
                fontWeight: 900,
              }}
            >
              {statusTone.text}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={runAiAutoFixHx}
              disabled={isAiBusy}
              style={{
                padding: '6px 11px',
                borderRadius: 6,
                border: dRes.overallStatus !== 'ok' ? '1.5px solid #C084FC' : '1px solid #64748B',
                background: dRes.overallStatus !== 'ok' ? '#7C3AED' : '#334155',
                color: '#FFFFFF',
                fontSize: 11.2,
                fontWeight: 900,
                cursor: isAiBusy ? 'wait' : 'pointer',
              }}
            >
              {isAiBusy ? (aiStepLabel || '⏳ AI 분석 중...') : '✨ AI 자동 해결'}
            </button>
            <button
              type="button"
              onClick={exportHxExcelDatasheet}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #34D399',
                background: '#065F46',
                color: '#ECFDF5',
                fontSize: 11,
                fontWeight: 900,
                cursor: 'pointer',
              }}
              title="공식 TEMA / API 662 엑셀 데이터시트(.xlsx) 다운로드"
            >
              📥 {dRes.hxKind === 'plate_phe' ? 'API 662' : 'TEMA'} .xlsx
            </button>
            {onOpenChemProDesign && (
              <button
                type="button"
                onClick={onOpenChemProDesign}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid #475569',
                  background: '#1E293B',
                  color: '#E2E8F0',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ↗ 숏컷 설계기
              </button>
            )}
            <button
              type="button"
              onClick={triggerRun}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #60A5FA',
                background: isSimDirty ? '#D97706' : '#2563EB',
                color: '#FFFFFF',
                fontSize: 11.5,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {isRunningFeedback ? '⏳ 계산 중...' : '▶ RUN (F5)'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #475569',
                background: '#1E293B',
                color: '#E2E8F0',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              닫기 ✕
            </button>
          </div>
        </div>

        {/* 상단 2-탭 스위처 */}
        <div
          style={{
            padding: '7px 16px',
            background: '#FFFFFF',
            borderBottom: '1px solid #CBD5E1',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {(
              [
                {
                  id: 'thermal',
                  title: '① 열수지 · T-Q 프로파일',
                  sub: '출구온도 · 열매/냉매 · 핀치',
                },
                {
                  id: 'mechanical',
                  title: '② 숏컷형 사이징 · 수력학 · 도면',
                  sub: '핵심 규격 · ΔP/진동 검증 · CAD',
                },
              ] as { id: HxWorkbenchView; title: string; sub: string }[]
            ).map((tb) => {
              const active = workbenchView === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => setWorkbenchView(tb.id)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 7,
                    border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                    background: active ? '#1E3A8A' : '#F8FAFC',
                    color: active ? '#FFFFFF' : '#334155',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 900 }}>{tb.title}</div>
                  <div
                    style={{
                      fontSize: 9.8,
                      color: active ? '#DBEAFE' : '#64748B',
                      marginTop: 1,
                    }}
                  >
                    {tb.sub}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: '#475569', fontFamily: MONO, fontWeight: 700 }}>
            Q = {formatCanonicalValue('heatDuty', dRes.dutyMcalH, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)} · A = {formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)} · U = {formatCanonicalValue('htc', dRes.uCalcKcalM2HC, htcUnit, 0)} {getUnitLabel('htc', htcUnit)}
            {lastRunStamp ? ` · 최근 실행 ${lastRunStamp}` : ''}
          </div>
        </div>

        {/* 모바일 전용 좌/우 패널 스위치 */}
        {isMobile && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              padding: '6px 10px',
              background: '#F1F5F9',
              borderBottom: '1px solid #CBD5E1',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setMobilePane('inputs')}
              style={{
                padding: '7px 8px',
                borderRadius: 6,
                border: mobilePane === 'inputs' ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                background: mobilePane === 'inputs' ? '#1E3A8A' : '#FFFFFF',
                color: mobilePane === 'inputs' ? '#FFFFFF' : '#334155',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ⚙ 조건 · 기하구조 입력
            </button>
            <button
              type="button"
              onClick={() => setMobilePane('results')}
              style={{
                padding: '7px 8px',
                borderRadius: 6,
                border: mobilePane === 'results' ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                background: mobilePane === 'results' ? '#1E3A8A' : '#FFFFFF',
                color: mobilePane === 'results' ? '#FFFFFF' : '#334155',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              📈 선도 · 단면도 · 사양서
            </button>
          </div>
        )}

        {/* 상시 노출 AI 자동 해결 진행·결과 배너 */}
        {(isAiBusy || aiReport) && (
          <div
            style={{
              padding: '8px 16px',
              background: isAiBusy
                ? '#EEF2FF'
                : aiReport?.result.resolved
                ? '#F0FDF4'
                : aiReport?.result.improved
                ? '#F5F3FF'
                : '#FEF2F2',
              borderBottom: `1.5px solid ${
                isAiBusy
                  ? '#818CF8'
                  : aiReport?.result.resolved
                  ? '#86EFAC'
                  : aiReport?.result.improved
                  ? '#C4B5FD'
                  : '#FCA5A5'
              }`,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 11,
              lineHeight: 1.4,
            }}
          >
            {isAiBusy ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: '#3730A3' }}>
                <span style={{ fontWeight: 900 }}>⏳ ✨ AI 자동 해결 탐색 중...</span>
                {aiStepLabel && (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10.5,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: '#FFFFFF',
                      border: '1px solid #C7D2FE',
                      color: '#4338CA',
                    }}
                  >
                    {aiStepLabel}
                  </span>
                )}
              </div>
            ) : aiReport ? (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div
                  style={{
                    fontWeight: 900,
                    color: aiReport.result.resolved
                      ? '#15803D'
                      : aiReport.result.improved
                      ? '#6D28D9'
                      : '#B91C1C',
                  }}
                >
                  {aiReport.result.headline}
                </div>
                {aiReport.result.rootCauses.length > 0 && (
                  <div style={{ color: '#475569', fontSize: 10.5 }}>
                    원인: {aiReport.result.rootCauses.slice(0, 2).join(' · ')}
                  </div>
                )}
                {aiReport.result.actionsTaken.length > 0 && (
                  <div style={{ color: '#1E293B', fontWeight: 700, fontSize: 10.6 }}>
                    조치: {aiReport.result.actionsTaken.join(' · ')}
                  </div>
                )}
                {aiReport.geminiNote && (
                  <div style={{ color: '#4C1D95', fontWeight: 700, fontSize: 10.5 }}>
                    {aiReport.geminiNote}
                  </div>
                )}
              </div>
            ) : null}
            {!isAiBusy && aiReport && (
              <button
                type="button"
                onClick={() => setAiReport(null)}
                style={{
                  flexShrink: 0,
                  padding: '3px 9px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#475569',
                  fontSize: 10.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ✕ 닫기
              </button>
            )}
          </div>
        )}

        {/* 본문 영역 */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          {workbenchView === 'thermal' ? (
            <>
              {/* 좌측: 운전 조건 입력 & 양측 유체 열수지 요약 */}
              {(!isMobile || mobilePane === 'inputs') && (
              <div
                style={{
                  flex: isMobile ? '1 1 100%' : '1 1 500px',
                  minWidth: 0,
                  padding: '12px 14px',
                  overflowY: 'auto',
                  borderRight: isMobile ? 'none' : '1px solid #CBD5E1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* 진단·안전 알림 박스 */}
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 8,
                    background:
                      dRes.overallStatus === 'error'
                        ? '#FEF2F2'
                        : dRes.overallStatus === 'warning'
                        ? '#FFFBEB'
                        : '#F0FDF4',
                    border: `1px solid ${
                      dRes.overallStatus === 'error'
                        ? '#FCA5A5'
                        : dRes.overallStatus === 'warning'
                        ? '#FCD34D'
                        : '#86EFAC'
                    }`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  {dRes.diagnostics.map((dg, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        fontSize: 11,
                        fontWeight: 700,
                        color:
                          dg.level === 'error'
                            ? '#991B1B'
                            : dg.level === 'warning'
                            ? '#92400E'
                            : '#166534',
                      }}
                    >
                      <span>{dg.message}</span>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {dg.remedyPatch && dg.remedyLabel && (
                          <button
                            type="button"
                            onClick={() => patchHxCfg(dg.remedyPatch!)}
                            style={{
                              padding: '4px 9px',
                              borderRadius: 5,
                              border: '1px solid #2563EB',
                              background: '#2563EB',
                              color: '#FFFFFF',
                              fontSize: 10.5,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            🔧 {dg.remedyLabel}
                          </button>
                        )}
                        {idx === 0 && dRes.overallStatus !== 'ok' && (
                          <button
                            type="button"
                            onClick={runAiAutoFixHx}
                            disabled={isAiBusy}
                            style={{
                              padding: '4px 9px',
                              borderRadius: 5,
                              border: '1px solid #7C3AED',
                              background: '#7C3AED',
                              color: '#FFFFFF',
                              fontSize: 10.5,
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            {isAiBusy ? (aiStepLabel || '⏳ 분석중...') : '✨ AI 자동 해결'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 필수 운전 사양 (공정 목표온도/열부하 & 유틸리티 선택) */}
                <div style={cardBox}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                      공정 운전 사양 & 열매/냉매 선택
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: '#EFF6FF',
                        color: '#1D4ED8',
                        border: '1px solid #BFDBFE',
                      }}
                    >
                      유입 유체: {dRes.processSide.fluidName} ({formatCanonicalValue('massFlow', dRes.processSide.massFlowKgH, massUnit)} {getUnitLabel('massFlow', massUnit)})
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                    <div>
                      <label style={lblStyle}>열수지 지정 기준</label>
                      <select
                        value={hexSpecMode}
                        onChange={(e) =>
                          onChangeParams({
                            hexSpecMode: e.target.value as 'proc_temp' | 'heat_duty',
                          })
                        }
                        style={selStyle}
                      >
                        <option value="proc_temp">공정 출구 목표온도 지정</option>
                        <option value="heat_duty">교환 열부하 Q 직접 지정</option>
                      </select>
                    </div>

                    {hexSpecMode === 'proc_temp' ? (
                      <div>
                        <label style={lblStyle}>
                          공정 출구 목표온도 [입구 {formatCanonicalValue('temp', dRes.processSide.inTempC, tempUnit, 1)} {getUnitLabel('temp', tempUnit)}]
                        </label>
                        <UnitNumberInput
                          quantity="temp"
                          unitId={tempUnit}
                          onUnitChange={setTempUnit}
                          syncKey={`${unitTag}-hx-tout`}
                          minCanonical={-65}
                          maxCanonical={350}
                          value={params.operTempC ?? (isLiquefier ? -22 : 32)}
                          onValueChange={(v) => onChangeParams({ operTempC: v })}
                          onEnterRun={triggerRun}
                          inputStyle={inpStyle}
                        />
                      </div>
                    ) : (
                      <div>
                        <label style={lblStyle}>지정 교환열량 (냉각 음수 -)</label>
                        <UnitNumberInput
                          quantity="heatDuty"
                          unitId={dutyUnit}
                          onUnitChange={setDutyUnit}
                          syncKey={`${unitTag}-hx-qspec`}
                          value={params.specifiedDutyMcalH ?? -500}
                          onValueChange={(v) => onChangeParams({ specifiedDutyMcalH: v })}
                          onEnterRun={triggerRun}
                          inputStyle={inpStyle}
                        />
                      </div>
                    )}

                    <div>
                      <label style={lblStyle}>사용 냉매 · 열매 (유틸리티 프리셋)</label>
                      <select
                        value={refKey}
                        onChange={(e) =>
                          onChangeParams({
                            refrigerantPreset: e.target.value as RefrigerantPresetKey,
                          })
                        }
                        style={selStyle}
                      >
                        {(Object.keys(REFRIGERANT_PRESETS) as RefrigerantPresetKey[]).map((rk) => (
                          <option key={rk} value={rk}>
                            {REFRIGERANT_PRESETS[rk].label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={lblStyle}>공정 출구 운전압력</label>
                      <UnitNumberInput
                        quantity="pressG"
                        unitId={pressUnit}
                        onUnitChange={setPressUnit}
                        syncKey={`${unitTag}-hx-pout`}
                        minCanonical={-0.98}
                        maxCanonical={45}
                        value={
                          params.operPressKgcm2g !== undefined
                            ? params.operPressKgcm2g
                            : Number(Math.max(0, dRes.processSide.pressKgcm2g - 0.05).toFixed(2))
                        }
                        onValueChange={(v) => onChangeParams({ operPressKgcm2g: v })}
                        onEnterRun={triggerRun}
                        inputStyle={inpStyle}
                      />
                    </div>
                  </div>

                  {refKey === 'custom' && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: 8,
                        marginTop: 9,
                        paddingTop: 9,
                        borderTop: '1px dashed #E2E8F0',
                      }}
                    >
                      <div>
                        <label style={lblStyle}>유틸리티 입구 온도</label>
                        <UnitNumberInput
                          quantity="temp"
                          unitId={tempUnit}
                          onUnitChange={setTempUnit}
                          syncKey={`${unitTag}-ut-in`}
                          value={params.utilInTempC ?? 20}
                          onValueChange={(v) => onChangeParams({ utilInTempC: v })}
                          onEnterRun={triggerRun}
                          inputStyle={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>유틸리티 출구 온도</label>
                        <UnitNumberInput
                          quantity="temp"
                          unitId={tempUnit}
                          onUnitChange={setTempUnit}
                          syncKey={`${unitTag}-ut-out`}
                          value={params.utilOutTempC ?? 30}
                          onValueChange={(v) => onChangeParams({ utilOutTempC: v })}
                          onEnterRun={triggerRun}
                          inputStyle={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>유틸리티 비열 Cp</label>
                        <UnitNumberInput
                          quantity="cp"
                          unitId={cpUnit}
                          onUnitChange={setCpUnit}
                          syncKey={`${unitTag}-ut-cp`}
                          minCanonical={0.1}
                          value={params.utilCp ?? 1.0}
                          onValueChange={(v) => onChangeParams({ utilCp: Math.max(0.1, v) })}
                          onEnterRun={triggerRun}
                          inputStyle={inpStyle}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 상변화 3-Zone 분해 요약 (응축/액화 발생 시) */}
                {dRes.latentDutyMcalH > 0.05 && (
                  <div style={cardBox}>
                    <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>
                      상변화 3-구간 열부하 분해 (이슬점 {dRes.dewPointC !== null ? `${formatCanonicalValue('temp', dRes.dewPointC, tempUnit, 1)} ${getUnitLabel('temp', tempUnit)}` : '—'} · 응축/액화량 {formatCanonicalValue('massFlow', dRes.processSide.phaseChangeMassKgH, massUnit)} {getUnitLabel('massFlow', massUnit)})
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 8,
                        fontFamily: MONO,
                      }}
                    >
                      <div style={{ background: '#F8FAFC', padding: '6px 8px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>① 과열가스 냉각</div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {formatCanonicalValue('heatDuty', dRes.desupDutyMcalH, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)}
                        </div>
                      </div>
                      <div style={{ background: '#F8FAFC', padding: '6px 8px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>② 잠열 응축·액화</div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: '#1E3A8A', marginTop: 2 }}>
                          {formatCanonicalValue('heatDuty', dRes.latentDutyMcalH, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)}
                        </div>
                      </div>
                      <div style={{ background: '#F8FAFC', padding: '6px 8px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>③ 응축액 과냉각</div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {formatCanonicalValue('heatDuty', dRes.subcoolDutyMcalH, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 공정 유체 vs 유틸리티 열수지·물성 비교 표 */}
                <div style={cardBox}>
                  <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 7 }}>
                    양측 유체 열수지 및 대표 열물성 비교
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
                        <th style={{ padding: '5px 7px', textAlign: 'left' }}>항목</th>
                        <th style={{ padding: '5px 7px', textAlign: 'right' }}>공정측 (Process)</th>
                        <th style={{ padding: '5px 7px', textAlign: 'right' }}>유틸리티측 (Utility)</th>
                      </tr>
                    </thead>
                    <tbody style={{ fontFamily: MONO }}>
                      <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '4px 7px', fontFamily: 'inherit', fontWeight: 700 }}>유체 / 상거동</td>
                        <td style={{ padding: '4px 7px', textAlign: 'right', fontFamily: 'inherit', fontWeight: 800 }}>
                          {dRes.processSide.phaseLabel}
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right', fontFamily: 'inherit', fontWeight: 800 }}>
                          {dRes.utilitySide.phaseLabel}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '4px 7px', fontFamily: 'inherit', fontWeight: 700 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            질량유량
                            <UnitSelect quantity="massFlow" value={massUnit} onChange={setMassUnit} />
                          </span>
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right', fontWeight: 800 }}>
                          {formatCanonicalValue('massFlow', dRes.processSide.massFlowKgH, massUnit)}
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right', fontWeight: 800, color: '#1E3A8A' }}>
                          {formatCanonicalValue('massFlow', dRes.utilitySide.massFlowKgH, massUnit)}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '4px 7px', fontFamily: 'inherit', fontWeight: 700 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            입구 → 출구 온도
                            <UnitSelect quantity="temp" value={tempUnit} onChange={setTempUnit} />
                          </span>
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right' }}>
                          {formatCanonicalValue('temp', dRes.processSide.inTempC, tempUnit, 1)} → {formatCanonicalValue('temp', dRes.processSide.outTempC, tempUnit, 1)}
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right' }}>
                          {formatCanonicalValue('temp', dRes.utilitySide.inTempC, tempUnit, 1)} → {formatCanonicalValue('temp', dRes.utilitySide.outTempC, tempUnit, 1)}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '4px 7px', fontFamily: 'inherit', fontWeight: 700 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            밀도 <UnitSelect quantity="density" value={densUnit} onChange={setDensUnit} /> / 점도 <UnitSelect quantity="viscosity" value={viscUnit} onChange={setViscUnit} />
                          </span>
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right' }}>
                          {formatCanonicalValue('density', dRes.processSide.densityKgM3, densUnit)} / {formatCanonicalValue('viscosity', dRes.processSide.viscosityCp, viscUnit, 2)}
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right' }}>
                          {formatCanonicalValue('density', dRes.utilitySide.densityKgM3, densUnit)} / {formatCanonicalValue('viscosity', dRes.utilitySide.viscosityCp, viscUnit, 2)}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: '4px 7px', fontFamily: 'inherit', fontWeight: 700 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            열전도도 (W/m·K) / 비열 <UnitSelect quantity="cp" value={cpUnit} onChange={setCpUnit} />
                          </span>
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right' }}>
                          {dRes.processSide.conductivityWmK.toFixed(3)} / {formatCanonicalValue('cp', dRes.processSide.cpKcalKgC, cpUnit, 2)}
                        </td>
                        <td style={{ padding: '4px 7px', textAlign: 'right' }}>
                          {dRes.utilitySide.conductivityWmK.toFixed(3)} / {formatCanonicalValue('cp', dRes.utilitySide.cpKcalKgC, cpUnit, 2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              )}

              {/* 우측: T-Q 프로파일 차트 & 열전달 추진력 KPI */}
              {(!isMobile || mobilePane === 'results') && (
              <div
                style={{
                  flex: isMobile ? '1 1 100%' : '1 1 460px',
                  minWidth: 0,
                  padding: '12px 14px',
                  background: '#F6F7F2',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                    향류 T-Q 열교환 온도 프로파일 & 핀치(Pinch) 선도
                  </span>
                  <button
                    type="button"
                    onClick={() => setWorkbenchView('mechanical')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid #2563EB',
                      background: '#EFF6FF',
                      color: '#1D4ED8',
                      fontSize: 10.5,
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    기하 사이징 · 도면 설계로 이동 →
                  </button>
                </div>

                {renderTQProfileSvg()}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 8,
                    fontFamily: MONO,
                  }}
                >
                  <div style={cardBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>총 교환열량 Q</span>
                      <UnitSelect quantity="heatDuty" value={dutyUnit} onChange={setDutyUnit} />
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                      {formatCanonicalValue('heatDuty', dRes.dutyMcalH, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)}
                    </div>
                    <div style={{ fontSize: 9.5, color: '#475569' }}>
                      {dRes.dutyKW.toFixed(1)} kW ({dRes.usrt.toFixed(1)} RT)
                    </div>
                  </div>
                  <div style={cardBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>유효 온도차 CMTD</span>
                      <UnitSelect quantity="temp" value={tempUnit} onChange={setTempUnit} />
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                      {formatDeltaT(dRes.cmtdC, tempUnit)}
                    </div>
                    <div style={{ fontSize: 9.5, color: '#475569' }}>
                      LMTD {formatDeltaT(dRes.lmtdCounterC, tempUnit)} · Ft={dRes.ftFactor.toFixed(2)}
                    </div>
                  </div>
                  <div style={cardBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>산출 총괄 U</span>
                      <UnitSelect quantity="htc" value={htcUnit} onChange={setHtcUnit} />
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 900, color: '#1E3A8A', marginTop: 2 }}>
                      {formatCanonicalValue('htc', dRes.uCalcKcalM2HC, htcUnit, 0)}
                    </div>
                    <div style={{ fontSize: 9.5, color: '#475569' }}>
                      {getUnitLabel('htc', htcUnit)}
                    </div>
                  </div>
                  <div style={cardBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>설계 전열면적 A</span>
                      <UnitSelect quantity="area" value={areaUnit} onChange={setAreaUnit} />
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                      {formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)}
                    </div>
                    <div style={{ fontSize: 9.5, color: '#475569' }}>
                      요구 {formatCanonicalValue('area', dRes.areaReqM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)} (+{dRes.actualOverdesignPct.toFixed(0)}%)
                    </div>
                  </div>
                </div>
              </div>
              )}
            </>
          ) : (
            <>
              {/* ② 숏컷 스타일 핵심 사이징 + 고급 기하 접힘 + AI 자동 해결 */}
              {(!isMobile || mobilePane === 'inputs') && (
              <div
                style={{
                  flex: isMobile ? '1 1 100%' : '1 1 480px',
                  minWidth: 0,
                  padding: '12px 14px',
                  overflowY: 'auto',
                  borderRight: isMobile ? 'none' : '1px solid #CBD5E1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* 숏컷 스타일 4-KPI 요약 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, fontFamily: MONO }}>
                  <div style={cardBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 700 }}>열부하 Q</span>
                      <UnitSelect quantity="heatDuty" value={dutyUnit} onChange={setDutyUnit} />
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>
                      {formatCanonicalValue('heatDuty', dRes.dutyMcalH, dutyUnit)}
                    </div>
                    <div style={{ fontSize: 9, color: '#64748B' }}>{getUnitLabel('heatDuty', dutyUnit)}</div>
                  </div>
                  <div style={cardBox}>
                    <div style={{ fontSize: 9.5, color: '#64748B', fontWeight: 700 }}>CMTD / Ft</div>
                    <div style={{ fontSize: 12.5, fontWeight: 900, color: dRes.ftFactor < 0.78 ? '#B91C1C' : '#0F172A' }}>
                      {formatDeltaT(dRes.cmtdC, tempUnit)}
                    </div>
                    <div style={{ fontSize: 9, color: dRes.ftFactor < 0.78 ? '#B91C1C' : '#64748B' }}>Ft {dRes.ftFactor.toFixed(2)}</div>
                  </div>
                  <div style={cardBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 700 }}>전열면적</span>
                      <UnitSelect quantity="area" value={areaUnit} onChange={setAreaUnit} />
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 900, color: '#1E3A8A' }}>
                      {formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)}
                    </div>
                    <div style={{ fontSize: 9, color: '#64748B' }}>+{dRes.actualOverdesignPct.toFixed(0)}%</div>
                  </div>
                  <div style={cardBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 700 }}>최대 ΔP</span>
                      <UnitSelect quantity="deltaP" value={dpUnit} onChange={setDpUnit} />
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 900,
                        color: Math.max(dRes.dpTubeBar, dRes.dpShellBar) > 0.7 ? '#B91C1C' : '#166534',
                      }}
                    >
                      {formatCanonicalValue('deltaP', Math.max(dRes.dpTubeBar, dRes.dpShellBar) * BAR_TO_KGCM2, dpUnit, 2)}
                    </div>
                    <div style={{ fontSize: 9, color: '#64748B' }}>
                      {getUnitLabel('deltaP', dpUnit)} (≤{formatCanonicalValue('deltaP', 0.7 * BAR_TO_KGCM2, dpUnit, 2)})
                    </div>
                  </div>
                </div>

                {/* ΔP / Ft / 진동 원인 설명 & AI 자동 해결 카드 */}
                {dRes.overallStatus !== 'ok' && (
                  <div
                    style={{
                      padding: '9px 11px',
                      borderRadius: 8,
                      background: dRes.overallStatus === 'error' ? '#FEF2F2' : '#FFFBEB',
                      border: `1.5px solid ${dRes.overallStatus === 'error' ? '#FCA5A5' : '#FCD34D'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      fontSize: 10.6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 900, color: '#0F172A' }}>
                        ⚠ 차압 · 진동 · 온도교차 점검
                      </span>
                      <button
                        type="button"
                        onClick={runAiAutoFixHx}
                        disabled={isAiBusy}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid #7C3AED',
                          background: '#7C3AED',
                          color: '#FFFFFF',
                          fontSize: 10.5,
                          fontWeight: 900,
                          cursor: isAiBusy ? 'wait' : 'pointer',
                        }}
                      >
                        {isAiBusy ? (aiStepLabel || '⏳ 최적화 중...') : '✨ AI 자동 해결'}
                      </button>
                    </div>
                    {dRes.dpTubeBar > 0.7 && (
                      <div style={{ color: '#991B1B' }}>
                        • 관측 ΔP={dRes.dpTubeBar.toFixed(2)} bar 초과 → <b>패스 수 감소</b>(4→2→1패스) 또는 <b>관길이 단축·외경 확대</b> 필요 (ΔP ∝ N³·L)
                      </div>
                    )}
                    {dRes.dpShellBar > 0.7 && (
                      <div style={{ color: '#92400E' }}>
                        • 동체 ΔP={dRes.dpShellBar.toFixed(2)} bar 초과 → <b>배플 간격비(B/Ds) 확대</b> 또는 <b>배플 컷(%) 상향</b> 필요
                      </div>
                    )}
                    {dRes.ftFactor < 0.78 && (
                      <div style={{ color: '#991B1B' }}>
                        • Ft={dRes.ftFactor.toFixed(2)} 저하 → <b>직렬 동체 수(2기 이상)</b> 증가 또는 <b>1패스 향류</b> 전환
                      </div>
                    )}
                    {dRes.vibRatio > 0.8 && (
                      <div style={{ color: '#92400E' }}>
                        • 와류진동비 {dRes.vibRatio.toFixed(2)} ≥ 0.80 → <b>배플 간격·튜브 피치(45°/90°)</b> 완화
                      </div>
                    )}
                  </div>
                )}

                {/* 형식 + 재질 (숏컷 핵심 카드) */}
                <div style={cardBox}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                    {(
                      [
                        { id: 'shell_tube', label: '다관원통형 (Shell & Tube)' },
                        { id: 'plate_phe', label: '판형 열교환기 (PHE)' },
                      ] as { id: HxEquipmentKind; label: string }[]
                    ).map((kt) => {
                      const active = dRes.hxKind === kt.id;
                      return (
                        <button
                          key={kt.id}
                          type="button"
                          onClick={() => patchHxCfg({ hxKind: kt.id })}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 6,
                            border: active ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                            background: active ? '#EFF6FF' : '#FFFFFF',
                            color: active ? '#1E3A8A' : '#334155',
                            fontSize: 11,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          {kt.label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ ...lblStyle, marginBottom: 0 }}>재질 (Metallurgy)</label>
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: '#1D4ED8' }}>
                      추천: {HX_MATERIAL_CATALOG[dRes.recommendedMaterial].shortLabel}
                    </span>
                  </div>
                  <select
                    value={dRes.material.code}
                    onChange={(e) => patchHxCfg({ material: e.target.value as HxMaterialCode })}
                    style={selStyle}
                  >
                    {(Object.keys(HX_MATERIAL_CATALOG) as HxMaterialCode[]).map((mc) => (
                      <option key={mc} value={mc}>
                        {HX_MATERIAL_CATALOG[mc].label} (k={HX_MATERIAL_CATALOG[mc].kwWmK})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 숏컷 4대 핵심 입력 */}
                {dRes.hxKind === 'shell_tube' ? (
                  <div style={cardBox}>
                    <div style={{ fontSize: 11.2, fontWeight: 900, color: '#0F172A', marginBottom: 7 }}>
                      핵심 규격 설정 (숏컷 방식)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={lblStyle}>관측 패스 수 (Tube Passes)</label>
                        <select
                          value={dRes.tubePasses}
                          onChange={(e) =>
                            patchHxCfg({ tubePasses: Number(e.target.value) as 1 | 2 | 4 | 6 })
                          }
                          style={selStyle}
                        >
                          <option value={1}>1 패스 (향류 · 최저 ΔP)</option>
                          <option value={2}>2 패스 (표준)</option>
                          <option value={4}>4 패스 (고전열)</option>
                          <option value={6}>6 패스</option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>유효 튜브 길이 L</label>
                        <div style={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
                          <select
                            value={dRes.tubeLengthM}
                            onChange={(e) =>
                              patchHxCfg({
                                tubeLengthM: Number(e.target.value) as 2.44 | 3.05 | 3.66 | 4.88 | 6.1,
                              })
                            }
                            style={{ ...selStyle, flex: 1, minWidth: 0 }}
                          >
                            {([
                              { v: 2.44, note: '8 ft' },
                              { v: 3.05, note: '10 ft' },
                              { v: 3.66, note: '12 ft 표준' },
                              { v: 4.88, note: '16 ft' },
                              { v: 6.1, note: '20 ft' },
                            ] as const).map((opt) => (
                              <option key={opt.v} value={opt.v}>
                                {formatCanonicalValue('length', opt.v, lenUnit, 2)} {getUnitLabel('length', lenUnit)} ({opt.note})
                              </option>
                            ))}
                          </select>
                          <UnitSelect quantity="length" value={lenUnit} onChange={setLenUnit} style={{ flexShrink: 0, minWidth: 50 }} />
                        </div>
                      </div>
                      <div>
                        <label style={lblStyle}>배플 간격비 (B / Ds)</label>
                        <BufferedNumberInput
                          syncKey={`${unitTag}-hx-bratio`}
                          step={0.05}
                          min={0.22}
                          max={0.95}
                          value={hxCfg.baffleSpacingRatio ?? 0.45}
                          onValueChange={(v) => patchHxCfg({ baffleSpacingRatio: v })}
                          style={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>직렬 동체 수 (Shells)</label>
                        <select
                          value={dRes.shellCount}
                          onChange={(e) => patchHxCfg({ shellCount: Number(e.target.value) })}
                          style={selStyle}
                        >
                          <option value={1}>1기 (단독)</option>
                          <option value={2}>직렬 2기</option>
                          <option value={3}>직렬 3기</option>
                          <option value={4}>직렬 4기</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={cardBox}>
                    <div style={{ fontSize: 11.2, fontWeight: 900, color: '#0F172A', marginBottom: 7 }}>
                      핵심 PHE 규격 설정
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={lblStyle}>쉐브론 각도 (β)</label>
                        <select
                          value={dRes.pheChevronDeg}
                          onChange={(e) =>
                            patchHxCfg({ pheChevronDeg: Number(e.target.value) as 30 | 45 | 60 })
                          }
                          style={selStyle}
                        >
                          <option value={30}>30° (저압손)</option>
                          <option value={45}>45° (표준)</option>
                          <option value={60}>60° (고난류)</option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>채널 판간격 b</label>
                        <UnitNumberInput
                          quantity="length"
                          syncKey={`${unitTag}-phe-gap`}
                          minCanonical={0.002}
                          maxCanonical={0.0055}
                          value={dRes.pheGapMm / 1000}
                          onValueChange={(v) => patchHxCfg({ pheGapMm: Number((v * 1000).toFixed(3)) })}
                          inputStyle={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>유효 판폭 W</label>
                        <UnitNumberInput
                          quantity="length"
                          unitId={lenUnit}
                          onUnitChange={setLenUnit}
                          syncKey={`${unitTag}-phe-w`}
                          minCanonical={0.25}
                          maxCanonical={1.2}
                          value={hxCfg.phePlateWidthM ?? 0.55}
                          onValueChange={(v) => patchHxCfg({ phePlateWidthM: v })}
                          inputStyle={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>유효 판길이 L</label>
                        <UnitNumberInput
                          quantity="length"
                          unitId={lenUnit}
                          onUnitChange={setLenUnit}
                          syncKey={`${unitTag}-phe-l`}
                          minCanonical={0.6}
                          maxCanonical={2.6}
                          value={hxCfg.phePlateLengthM ?? 1.45}
                          onValueChange={(v) => patchHxCfg({ phePlateLengthM: v })}
                          inputStyle={inpStyle}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 고급 TEMA · 기하 · 여유율 접힘 패널 */}
                {dRes.hxKind === 'shell_tube' && (
                  <details style={cardBox}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 900, color: '#334155', listStyle: 'none' }}>
                      ⚙ 고급 TEMA 기하 설정 (형식 {dRes.temaType} · OD {dRes.tubeOdMm}mm · 컷 {dRes.baffleCutPct}% ▾)
                    </summary>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 9 }}>
                      <div>
                        <label style={lblStyle}>TEMA 형식</label>
                        <select
                          value={dRes.temaType}
                          onChange={(e) => patchHxCfg({ temaType: e.target.value as TemaConfiguration })}
                          style={selStyle}
                        >
                          <option value="BEM">BEM (고정관판식)</option>
                          <option value="AES">AES (유동두식)</option>
                          <option value="BKM">BKM (케틀형)</option>
                          <option value="BEU">BEU (U-튜브식)</option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>유체 배치</label>
                        <select
                          value={dRes.allocation}
                          onChange={(e) => patchHxCfg({ allocation: e.target.value as HxTubeAllocation })}
                          style={selStyle}
                        >
                          <option value="process_tube">공정=Tube / 열매=Shell</option>
                          <option value="process_shell">공정=Shell / 열매=Tube</option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>튜브 외경 OD</label>
                        <div style={{ display: 'flex', gap: 3, alignItems: 'stretch' }}>
                          <select
                            value={dRes.tubeOdMm}
                            onChange={(e) => patchHxCfg({ tubeOdMm: Number(e.target.value) as 15.88 | 19.05 | 25.4 })}
                            style={{ ...selStyle, flex: 1, minWidth: 0 }}
                          >
                            {([
                              { v: 15.88, note: '5/8"' },
                              { v: 19.05, note: '3/4"' },
                              { v: 25.4, note: '1"' },
                            ] as const).map((opt) => (
                              <option key={opt.v} value={opt.v}>
                                {formatCanonicalValue('length', opt.v / 1000, lenUnit)} {getUnitLabel('length', lenUnit)} ({opt.note})
                              </option>
                            ))}
                          </select>
                          <UnitSelect quantity="length" value={lenUnit} onChange={setLenUnit} style={{ flexShrink: 0, minWidth: 50 }} />
                        </div>
                      </div>
                      <div>
                        <label style={lblStyle}>배열 각도</label>
                        <select
                          value={dRes.pitchAngle}
                          onChange={(e) => patchHxCfg({ pitchAngle: Number(e.target.value) as TubeLayoutAngle })}
                          style={selStyle}
                        >
                          <option value={30}>30° 삼각</option>
                          <option value={90}>90° 사각</option>
                          <option value={45}>45° 회전</option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>배플 컷율 (%)</label>
                        <BufferedNumberInput
                          syncKey={`${unitTag}-hx-bcut`}
                          step={2}
                          min={15}
                          max={45}
                          value={dRes.baffleCutPct}
                          onValueChange={(v) => patchHxCfg({ baffleCutPct: v })}
                          style={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>설계 여유율 (%)</label>
                        <BufferedNumberInput
                          syncKey={`${unitTag}-hx-margin`}
                          step={5}
                          min={0}
                          max={50}
                          value={hxCfg.designMarginPct ?? 15}
                          onValueChange={(v) => patchHxCfg({ designMarginPct: v })}
                          style={inpStyle}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 6 }}>{dRes.material.serviceNote}</div>
                  </details>
                )}

                {/* 플로우시트 양방향 역반영 액션 카드 */}
                <div
                  style={{
                    ...cardBox,
                    background: '#EFF6FF',
                    border: '1px solid #93C5FD',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ fontSize: 10.6, color: '#1E3A8A', fontWeight: 700 }}>
                    U = <b>{formatCanonicalValue('htc', dRes.uCalcKcalM2HC, htcUnit, 0)}</b> {getUnitLabel('htc', htcUnit)} · ΔP = <b>{formatCanonicalValue('deltaP', dRes.dpProcessKgcm2, dpUnit)} {getUnitLabel('deltaP', dpUnit)}</b>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeParams({
                        overallU: Math.round(dRes.uCalcKcalM2HC),
                        foulingFactor: Number(dRes.processSide.foulingM2HKcal.toFixed(5)),
                      });
                      setTimeout(() => triggerRun(), 15);
                    }}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid #1D4ED8',
                      background: '#2563EB',
                      color: '#FFFFFF',
                      fontSize: 10.8,
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    ✓ U값 반영 후 재실행
                  </button>
                </div>
              </div>
              )}

              {/* 우측: 개념설계 단면도 / 수력학·진동 / 노즐·사양서 서브탭 */}
              {(!isMobile || mobilePane === 'results') && (
              <div
                style={{
                  flex: isMobile ? '1 1 100%' : '1 1 500px',
                  minWidth: 0,
                  padding: '12px 14px',
                  background: '#F6F7F2',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', gap: 5 }}>
                  {(
                    [
                      { id: 'cad', label: '개념설계 단면도 (CAD)' },
                      { id: 'hydraulics', label: '열저항 · 압력손실 · 진동 검증' },
                      { id: 'datasheet', label: '노즐 스케줄 · 제작 사양서' },
                    ] as { id: MechVisualTab; label: string }[]
                  ).map((vt) => {
                    const active = visualTab === vt.id;
                    return (
                      <button
                        key={vt.id}
                        type="button"
                        onClick={() => setVisualTab(vt.id)}
                        style={{
                          padding: '5px 11px',
                          borderRadius: 6,
                          border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                          background: active ? '#1E3A8A' : '#FFFFFF',
                          color: active ? '#FFFFFF' : '#334155',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {vt.label}
                      </button>
                    );
                  })}
                </div>

                {visualTab === 'cad' && (
                  <>
                    {renderCadDrawingSvg()}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                        gap: 8,
                        fontFamily: MONO,
                      }}
                    >
                      <div style={cardBox}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                          <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                            {dRes.hxKind === 'plate_phe' ? '전열판 매수' : '동체 내경 D_s'}
                          </span>
                          {dRes.hxKind !== 'plate_phe' && (
                            <UnitSelect quantity="length" value={lenUnit} onChange={setLenUnit} />
                          )}
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {dRes.hxKind === 'plate_phe'
                            ? `${dRes.phePlateCount} 매`
                            : `Ø${formatCanonicalValue('length', dRes.shellIdMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)}`}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#475569' }}>
                          {dRes.hxKind === 'plate_phe'
                            ? `채널 ${dRes.pheChannelsPerSide}×2`
                            : `번들 Ø${formatCanonicalValue('length', dRes.bundleDiaMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)}`}
                        </div>
                      </div>
                      <div style={cardBox}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                          {dRes.hxKind === 'plate_phe' ? '압축 팩 길이' : '튜브 수량 / 동체'}
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {dRes.hxKind === 'plate_phe'
                            ? `${formatCanonicalValue('length', dRes.phePackLengthMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)}`
                            : `${dRes.tubeCountPerShell} 본`}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#475569' }}>
                          {dRes.hxKind === 'plate_phe'
                            ? `간격 ${dRes.pheGapMm} mm`
                            : `${dRes.tubePasses}패스 · L=${formatCanonicalValue('length', dRes.tubeLengthM, lenUnit, 2)}${getUnitLabel('length', lenUnit)}`}
                        </div>
                      </div>
                      <div style={cardBox}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                          <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>관측 / 동체 압손</span>
                          <UnitSelect quantity="deltaP" value={dpUnit} onChange={setDpUnit} />
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {formatCanonicalValue('deltaP', dRes.dpTubeBar * BAR_TO_KGCM2, dpUnit, 2)} / {formatCanonicalValue('deltaP', dRes.dpShellBar * BAR_TO_KGCM2, dpUnit, 2)}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#475569' }}>
                          {getUnitLabel('deltaP', dpUnit)} (권장 ≤ {formatCanonicalValue('deltaP', 0.7 * BAR_TO_KGCM2, dpUnit, 2)})
                        </div>
                      </div>
                      <div style={cardBox}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>와류 진동비 FIV</div>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 900,
                            color: dRes.vibRatio >= 0.8 ? '#92400E' : '#166534',
                            marginTop: 2,
                          }}
                        >
                          {dRes.hxKind === 'plate_phe' ? '해당없음' : dRes.vibRatio.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#475569' }}>
                          {dRes.hxKind === 'plate_phe' ? '판형 밀착지지' : '안전기준 < 0.80'}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {visualTab === 'hydraulics' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={cardBox}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                          막열전달계수 & 총괄 열전달계수 산출 내역
                        </span>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>U/h</span>
                          <UnitSelect quantity="htc" value={htcUnit} onChange={setHtcUnit} />
                          <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>유속</span>
                          <UnitSelect quantity="velocity" value={velUnit} onChange={setVelUnit} />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: MONO, fontSize: 11 }}>
                        <div style={{ background: '#F8FAFC', padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                          <div style={{ color: '#64748B', fontSize: 10 }}>관측(유로A) 막계수 h_i</div>
                          <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                            {formatCanonicalValue('htc', dRes.hTubeWm2K * WM2K_TO_KCALM2HC, htcUnit, 0)} {getUnitLabel('htc', htcUnit)}
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>
                            유속 {formatCanonicalValue('velocity', dRes.velTubeMs, velUnit, 2)} {getUnitLabel('velocity', velUnit)} · Re = {dRes.reTube.toFixed(0)}
                          </div>
                        </div>
                        <div style={{ background: '#F8FAFC', padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                          <div style={{ color: '#64748B', fontSize: 10 }}>동체(유로B) 막계수 h_o</div>
                          <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                            {formatCanonicalValue('htc', dRes.hShellWm2K * WM2K_TO_KCALM2HC, htcUnit, 0)} {getUnitLabel('htc', htcUnit)}
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>
                            유속 {formatCanonicalValue('velocity', dRes.velShellMs, velUnit, 2)} {getUnitLabel('velocity', velUnit)} · Re = {dRes.reShell.toFixed(0)}
                          </div>
                        </div>
                        <div style={{ background: '#F8FAFC', padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                          <div style={{ color: '#64748B', fontSize: 10 }}>청정 총괄 U_clean</div>
                          <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                            {formatCanonicalValue('htc', dRes.uCleanWm2K * WM2K_TO_KCALM2HC, htcUnit, 0)} {getUnitLabel('htc', htcUnit)}
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>({dRes.uCleanWm2K.toFixed(0)} W/m²·K)</div>
                        </div>
                        <div style={{ background: '#EFF6FF', padding: '8px 10px', borderRadius: 6, border: '1px solid #BFDBFE' }}>
                          <div style={{ color: '#1E3A8A', fontSize: 10, fontWeight: 800 }}>오염반영 설계 U_design</div>
                          <div style={{ fontSize: 13.5, fontWeight: 900, color: '#1E3A8A' }}>
                            {formatCanonicalValue('htc', dRes.uCalcKcalM2HC, htcUnit, 0)} {getUnitLabel('htc', htcUnit)}
                          </div>
                          <div style={{ fontSize: 10, color: '#1D4ED8' }}>({dRes.uCalcWm2K.toFixed(0)} W/m²·K)</div>
                        </div>
                      </div>
                    </div>

                    <div style={cardBox}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                          압력손실(ΔP ≤ {formatCanonicalValue('deltaP', 0.7 * BAR_TO_KGCM2, dpUnit, 2)} {getUnitLabel('deltaP', dpUnit)}) 및 TEMA RCB-V 진동(FIV) 검증 게이지
                        </span>
                        <UnitSelect quantity="deltaP" value={dpUnit} onChange={setDpUnit} />
                      </div>
                      {[
                        {
                          label: `${dRes.hxKind === 'plate_phe' ? '유로 A' : '관측(Tube)'} 압력손실`,
                          val: dRes.dpTubeBar,
                          limit: 0.7,
                          dangerAt: 0.7,
                          isDp: true,
                          subText: '',
                        },
                        {
                          label: `${dRes.hxKind === 'plate_phe' ? '유로 B' : '동체(Shell)'} 압력손실`,
                          val: dRes.dpShellBar,
                          limit: 0.7,
                          dangerAt: 0.7,
                          isDp: true,
                          subText: '',
                        },
                        ...(dRes.hxKind === 'shell_tube'
                          ? [
                              {
                                label: `① 와류 방출 진동비 Vortex Shedding (f_vs=${(dRes.vibration?.vortexFreqHz ?? dRes.vortexFreqHz).toFixed(1)}Hz / f_n=${(dRes.vibration?.naturalFreqHz ?? dRes.naturalFreqHz).toFixed(1)}Hz)`,
                                val: dRes.vibration?.vortexRatio ?? dRes.vibRatio,
                                limit: 0.8,
                                dangerAt: 1.0,
                                isDp: false,
                                subText: '',
                              },
                              ...(dRes.vibration
                                ? [
                                    {
                                      label: `② 유체탄성 불안정 Connors Fluidelastic (V=${dRes.velShellMs.toFixed(2)}m/s / V_c=${dRes.vibration.criticalVelMs.toFixed(2)}m/s)`,
                                      val: dRes.vibration.fluidelasticRatio,
                                      limit: 0.8,
                                      dangerAt: 1.0,
                                      isDp: false,
                                      subText: '',
                                    },
                                    {
                                      label:
                                        dRes.vibration.acousticFreqsHz.length > 0
                                          ? `③ 음향 공진 Acoustic Resonance (f_vs=${dRes.vibration.vortexFreqHz.toFixed(1)}Hz / f_a1=${dRes.vibration.acousticFreqsHz[0].toFixed(1)}Hz)`
                                          : '③ 음향 공진 Acoustic Resonance (액상/비공진 — 해당 없음)',
                                      val: dRes.vibration.acousticRatio,
                                      limit: 0.8,
                                      dangerAt: 1.0,
                                      isDp: false,
                                      subText: dRes.vibration.acousticFreqsHz.length === 0 ? 'N/A (액상)' : dRes.vibration.acousticRisk ? '⚠ 공진대역 (±20%)' : 'OK',
                                    },
                                  ]
                                : []),
                            ]
                          : []),
                      ].map((g, gi) => {
                        const pct = Math.min(100, (g.val / (g.limit * 1.25)) * 100);
                        const danger = !g.isDp && g.val >= g.dangerAt;
                        const over = g.val > g.limit;
                        return (
                          <div key={gi} style={{ marginBottom: 9 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, marginBottom: 3, gap: 6 }}>
                              <span style={{ color: '#334155' }}>{g.label}</span>
                              <span style={{ fontFamily: MONO, color: danger ? '#991B1B' : over ? '#92400E' : '#166534', whiteSpace: 'nowrap' }}>
                                {g.isDp
                                  ? `${formatCanonicalValue('deltaP', g.val * BAR_TO_KGCM2, dpUnit, 2)} ${getUnitLabel('deltaP', dpUnit)} / 기준 ${formatCanonicalValue('deltaP', g.limit * BAR_TO_KGCM2, dpUnit, 2)} ${getUnitLabel('deltaP', dpUnit)}`
                                  : g.subText && g.val === 0
                                  ? g.subText
                                  : `${g.val.toFixed(2)} / 기준 ${g.limit.toFixed(2)}${g.subText ? ` (${g.subText})` : ''}`}
                              </span>
                            </div>
                            <div style={{ height: 8, borderRadius: 999, background: '#E2E8F0', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: '100%',
                                  background: danger ? '#DC2626' : over ? '#D97706' : '#2563EB',
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}

                      {/* FIV Span / Sound Speed + TEMA RCB-4.6 Impingement + CHF Dryout Badges */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, paddingTop: 8, borderTop: '1px solid #E2E8F0' }}>
                        {dRes.hxKind === 'shell_tube' && dRes.vibration && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5, fontFamily: MONO }}>
                            <span style={{ padding: '3px 7px', borderRadius: 5, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#334155', fontWeight: 700 }}>
                              Window Span 2·Lb = {(dRes.vibration.windowSpanM * 1000).toFixed(0)} mm
                            </span>
                            <span style={{ padding: '3px 7px', borderRadius: 5, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#334155', fontWeight: 700 }}>
                              Central Span Lb = {(dRes.vibration.centralSpanM * 1000).toFixed(0)} mm
                            </span>
                            <span style={{ padding: '3px 7px', borderRadius: 5, background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E3A8A', fontWeight: 800 }}>
                              Effective Span = {(dRes.vibration.effectiveSpanM * 1000).toFixed(0)} mm
                            </span>
                            {dRes.vibration.soundSpeedMs != null && (
                              <span style={{ padding: '3px 7px', borderRadius: 5, background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534', fontWeight: 800 }}>
                                음속 c = {dRes.vibration.soundSpeedMs.toFixed(0)} m/s
                              </span>
                            )}
                          </div>
                        )}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          {dRes.hxKind === 'shell_tube' && (() => {
                            const shIn = dRes.nozzles.find((n) => n.side === 'Shell') ?? dRes.nozzles[0];
                            const rStatus = dRes.rhoV2Status ?? shIn?.rhoV2Status ?? (dRes.impingementRequired ? 'IMPINGEMENT_REQ' : 'OK');
                            const tone =
                              rStatus === 'OVERSIZE_NOZZLE'
                                ? { bg: '#FEF2F2', bd: '#FCA5A5', fg: '#991B1B', lbl: '노즐 확관 필요 (OVERSIZE)' }
                                : rStatus === 'IMPINGEMENT_REQ'
                                ? { bg: '#FFFBEB', bd: '#FCD34D', fg: '#92400E', lbl: '충돌판 필수 (IMPINGEMENT PLATE REQ)' }
                                : { bg: '#DCFCE7', bd: '#86EFAC', fg: '#166534', lbl: '충돌판 불필요 (OK)' };
                            return (
                              <span
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  background: tone.bg,
                                  border: `1px solid ${tone.bd}`,
                                  color: tone.fg,
                                  fontSize: 10.5,
                                  fontWeight: 900,
                                  fontFamily: MONO,
                                }}
                              >
                                TEMA RCB-4.6 노즐 ρv² = {shIn?.rhoV2Pa ?? 0} Pa (기준 {dRes.rhoV2LimitPa ?? shIn?.rhoV2LimitPa ?? 2230} Pa) · {tone.lbl}
                              </span>
                            );
                          })()}

                          {dRes.chfCheck && (() => {
                            const cTone =
                              dRes.chfCheck.status === 'CRITICAL'
                                ? { bg: '#FEF2F2', bd: '#FCA5A5', fg: '#991B1B' }
                                : dRes.chfCheck.status === 'WARN'
                                ? { bg: '#FFFBEB', bd: '#FCD34D', fg: '#92400E' }
                                : { bg: '#DCFCE7', bd: '#86EFAC', fg: '#166534' };
                            return (
                              <span
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  background: cTone.bg,
                                  border: `1px solid ${cTone.bd}`,
                                  color: cTone.fg,
                                  fontSize: 10.5,
                                  fontWeight: 900,
                                  fontFamily: MONO,
                                }}
                              >
                                비등 CHF(Dryout) [{dRes.chfCheck.status}] q&quot;={(dRes.chfCheck.heatFluxWm2 / 1000).toFixed(1)} / q_CHF={(dRes.chfCheck.qChfBundleWm2 / 1000).toFixed(1)} kW/m² (비율 {dRes.chfCheck.chfRatio.toFixed(2)})
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {visualTab === 'datasheet' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={cardBox}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                          노즐 스케줄 (Nozzle Sizing & Momentum ρv² Check — TEMA RCB-4.6)
                        </div>
                        <button
                          type="button"
                          onClick={exportHxExcelDatasheet}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: '1px solid #059669',
                            background: '#ECFDF5',
                            color: '#065F46',
                            fontSize: 10.8,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          📥 공식 {dRes.hxKind === 'plate_phe' ? 'API 662' : 'TEMA'} 엑셀 데이터시트 (.xlsx)
                        </button>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: MONO }}>
                        <thead>
                          <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
                            <th style={{ padding: '5px 7px', textAlign: 'left' }}>Nozzle</th>
                            <th style={{ padding: '5px 7px', textAlign: 'left', fontFamily: 'inherit' }}>서비스 위치</th>
                            <th style={{ padding: '5px 7px', textAlign: 'right' }}>규격 (DN / NPS)</th>
                            <th style={{ padding: '5px 7px', textAlign: 'right' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                유속 <UnitSelect quantity="velocity" value={velUnit} onChange={setVelUnit} />
                              </span>
                            </th>
                            <th style={{ padding: '5px 7px', textAlign: 'right' }}>ρv² (Pa)</th>
                            <th style={{ padding: '5px 7px', textAlign: 'center', fontFamily: 'inherit' }}>충돌판 (RCB-4.6)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dRes.nozzles.map((nz) => {
                            const nStatus = nz.rhoV2Status ?? (nz.impingementRequired ? 'IMPINGEMENT_REQ' : 'OK');
                            const nBadge =
                              nStatus === 'OVERSIZE_NOZZLE'
                                ? { bg: '#FEF2F2', fg: '#991B1B', text: 'OVERSIZE' }
                                : nStatus === 'IMPINGEMENT_REQ'
                                ? { bg: '#FFFBEB', fg: '#92400E', text: '충돌판 필수' }
                                : { bg: '#DCFCE7', fg: '#166534', text: 'OK' };
                            return (
                              <tr key={nz.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                <td style={{ padding: '4px 7px', fontWeight: 900, color: '#1E3A8A' }}>{nz.id}</td>
                                <td style={{ padding: '4px 7px', fontFamily: 'inherit', fontWeight: 700 }}>{nz.service}</td>
                                <td style={{ padding: '4px 7px', textAlign: 'right', fontWeight: 800 }}>
                                  DN{nz.dnMm} ({nz.npsInch})
                                </td>
                                <td style={{ padding: '4px 7px', textAlign: 'right' }}>{formatCanonicalValue('velocity', nz.velocityMs, velUnit, 2)}</td>
                                <td style={{ padding: '4px 7px', textAlign: 'right' }}>{nz.rhoV2Pa}</td>
                                <td style={{ padding: '4px 7px', textAlign: 'center' }}>
                                  <span style={{ padding: '1.5px 6px', borderRadius: 4, background: nBadge.bg, color: nBadge.fg, fontSize: 10, fontWeight: 800 }}>
                                    {nBadge.text}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div style={cardBox}>
                      <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 7 }}>
                        열교환기 개념설계 사양서 요약 (Equipment Specification Summary)
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <tbody>
                          {[
                            ['기기 번호 / 명칭', `${unitTag} — ${unitLabel}`],
                            [
                              '형식 규격',
                              dRes.hxKind === 'plate_phe'
                                ? `가스켓 판형 열교환기 (Chevron ${dRes.pheChevronDeg}°)`
                                : `TEMA ${dRes.temaType} 다관원통형 (${dRes.shellCount} Shell × ${dRes.tubePasses} Tube Pass)`,
                            ],
                            ['적용 주요 재질', dRes.material.label],
                            ['교환 열부하 Q', `${formatCanonicalValue('heatDuty', dRes.dutyMcalH, dutyUnit)} ${getUnitLabel('heatDuty', dutyUnit)} (${dRes.dutyKW.toFixed(1)} kW)`],
                            [
                              '전열 면적 (제공 / 요구)',
                              `${formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)} ${getUnitLabel('area', areaUnit)} / ${formatCanonicalValue('area', dRes.areaReqM2, areaUnit, 1)} ${getUnitLabel('area', areaUnit)} (여유율 +${dRes.actualOverdesignPct.toFixed(1)}%)`,
                            ],
                            [
                              '유효 온도차 / 총괄 U',
                              `CMTD ${formatDeltaT(dRes.cmtdC, tempUnit)} · U = ${formatCanonicalValue('htc', dRes.uCalcKcalM2HC, htcUnit, 0)} ${getUnitLabel('htc', htcUnit)}`,
                            ],
                            [
                              '기하 주요 치수',
                              dRes.hxKind === 'plate_phe'
                                ? `${formatCanonicalValue('length', dRes.phePlateWidthMm / 1000, lenUnit)}W × ${formatCanonicalValue('length', dRes.phePlateHeightMm / 1000, lenUnit)}H ${getUnitLabel('length', lenUnit)} × ${dRes.phePlateCount}매 (팩 ${formatCanonicalValue('length', dRes.phePackLengthMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)})`
                                : `동체 ID Ø${formatCanonicalValue('length', dRes.shellIdMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)} · 튜브 Ø${dRes.tubeOdMm}mm×${formatCanonicalValue('length', dRes.tubeLengthM, lenUnit, 2)}${getUnitLabel('length', lenUnit)} × ${dRes.tubeCountPerShell}본 · 배플 ${dRes.baffleCount}단`,
                            ],
                          ].map(([k, v], i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                              <td style={{ padding: '5px 7px', color: '#475569', fontWeight: 800, width: '36%' }}>
                                {k}
                              </td>
                              <td style={{ padding: '5px 7px', color: '#0F172A', fontWeight: 800, fontFamily: MONO }}>
                                {v}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

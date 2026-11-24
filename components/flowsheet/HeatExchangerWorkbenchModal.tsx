'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { ENGINEERING_DISCLAIMER_ROWS } from '@/lib/legal/engineeringDisclaimer';
import BufferedNumberInput from '@/components/common/BufferedNumberInput';
import {
  UnitNumberInput,
  UnitSelect,
  useLocalUnit,
} from '@/components/units/UnitControls';
import { useUnitStore } from '@/lib/stores/unitStore';
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
  type HxAutoFixOption,
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

const REFRIGERANT_PRESET_LABELS_EN: Record<RefrigerantPresetKey, string> = {
  cw: 'Cooling Water (28→36°C)',
  chw: 'Chilled Water (7→12°C)',
  meg_brine: '40% MEG Brine (-15→-8°C)',
  brine_m20: '25% CaCl₂ Deep Brine (-25→-18°C)',
  r134a_chiller: 'R-134a Evaporating (-15°C sat · 5°C SH)',
  r22_m30: 'R-22 Evaporating (-33°C sat)',
  r404a_m32: 'R-404A Low-Temp Evaporating (-35°C sat)',
  freon_m35: 'R-507A Azeotropic Evaporating (-38°C sat · Std Liquefier)',
  nh3_m33: 'R-717 Ammonia Evaporating (-33°C sat · High Latent)',
  steam_lp: 'LP Steam Heating (145°C condensing)',
  custom: 'Custom Utility Input',
};

const HX_MATERIAL_EN: Record<HxMaterialCode, { label: string; shortLabel: string; serviceNote: string }> = {
  CS_A179: {
    label: 'Carbon Steel (SA-179 / SA-516-70)',
    shortLabel: 'CS (SA-179)',
    serviceNote: 'General cooling water, steam, and non-corrosive organics at ambient temperatures',
  },
  LTCS_A334: {
    label: 'Low-Temp Carbon Steel (LTCS, SA-334 Gr.6 / SA-516-60N)',
    shortLabel: 'LTCS (-45°C)',
    serviceNote: 'Standard for dry Cl₂ (<50 ppm H₂O) & anhydrous HCl deep liquefiers (-20 to -40°C)',
  },
  SS316L: {
    label: 'Stainless Steel 316L (SA-213 TP316L)',
    shortLabel: 'SS 316L',
    serviceNote: 'ECH/DCP/glycerin condensers, H₂ coolers, and cold dilute caustic soda',
  },
  DUPLEX_2205: {
    label: 'Duplex Stainless Steel (S32205)',
    shortLabel: 'Duplex 2205',
    serviceNote: 'Chloride SCC resistance; chlorinated organics (DCH/MCH) process coolers',
  },
  TI_GR2: {
    label: 'Titanium Gr.2 (SB-338 Gr.2)',
    shortLabel: 'Titanium Gr.2',
    serviceNote: 'Standard for wet Cl₂ gas coolers, saturated/dechlorinated brine & hypochlorite (NEVER for dry Cl₂!)',
  },
  NI_200: {
    label: 'Nickel 200 (SB-163 UNS N02200)',
    shortLabel: 'Nickel 200',
    serviceNote: 'Standard for hot/concentrated (32–50 wt%) NaOH heating/cooling (prevents caustic embrittlement)',
  },
  HASTELLOY_C276: {
    label: 'Hastelloy C-276 (UNS N10276)',
    shortLabel: 'Hastelloy C-276',
    serviceNote: 'Hot HCl, DCH/glycerin chlorination heat exchange, and ferric chloride corrosion service',
  },
  IMPERVIOUS_GRAPHITE: {
    label: 'Impervious Graphite (Karbate)',
    shortLabel: 'Graphite',
    serviceNote: 'Ultra-corrosive & high-conductivity standard for HCl concentration/azeotropic reboilers & absorbers',
  },
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
  const lang = useUnitStore((s) => s.lang);
  const isEn = lang === 'en';
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
  const [selectedAiOptionId, setSelectedAiOptionId] = useState<string | null>(null);
  const [thermalAdvOpen, setThermalAdvOpen] = useState(false);

  useEffect(() => {
    setThermalAdvOpen(params.refrigerantPreset === 'custom');
  }, [params.refrigerantPreset, open, unitTag]);

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);
  const [lastRunStamp, setLastRunStamp] = useState<string | null>(null);
  const temaFileInputRef = useRef<HTMLInputElement | null>(null);
  const temaMenuRef = useRef<HTMLDivElement | null>(null);
  const [temaMenuOpen, setTemaMenuOpen] = useState(false);
  const [temaImportNotice, setTemaImportNotice] = useState<{
    count: number;
    summary: string;
    isError?: boolean;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setWorkbenchView(initialView);
      setAiReport(null);
      setSelectedAiOptionId(null);
      setAiStepLabel('');
      setTemaImportNotice(null);
      setTemaMenuOpen(false);
    }
  }, [open, initialView, unitTag]);

  useEffect(() => {
    if (!temaMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (temaMenuRef.current && !temaMenuRef.current.contains(e.target as Node)) {
        setTemaMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [temaMenuOpen]);

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
      if (e.key === 'Escape') {
        if (temaMenuOpen) {
          e.stopPropagation();
          setTemaMenuOpen(false);
          return;
        }
        onClose();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        triggerRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onRunSimulation, temaMenuOpen]);

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

  const applyAiOption = (opt: HxAutoFixOption) => {
    setSelectedAiOptionId(opt.id);
    const nextParamsPatch: Partial<FlowUnitParams> = {};
    (Object.keys(opt.params) as Array<keyof FlowUnitParams>).forEach((k) => {
      if (k !== 'hxDesignConfig' && opt.params[k] !== params[k]) {
        (nextParamsPatch as Record<string, unknown>)[k] = opt.params[k];
      }
    });
    onChangeParams({
      ...nextParamsPatch,
      hxDesignConfig: {
        ...hxCfg,
        ...opt.cfg,
      },
    });
  };

  const runAiAutoFixHx = async () => {
    setIsAiBusy(true);
    setAiStepLabel(isEn ? 'Analyzing thermal & hydraulic bottlenecks...' : '열·수력학 병목 원인 분석 중...');
    setAiReport(null);
    setSelectedAiOptionId(null);
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
      const hasParamsPatch = Boolean(fix.paramsPatch && Object.keys(fix.paramsPatch).length > 0);
      const hasCfgPatch = Object.keys(fix.patch).length > 0;
      if (hasParamsPatch || hasCfgPatch) {
        onChangeParams({
          ...(hasParamsPatch ? fix.paramsPatch : {}),
          ...(hasCfgPatch ? { hxDesignConfig: { ...hxCfg, ...fix.patch } } : {}),
        });
      }
      setSelectedAiOptionId(fix.options?.[0]?.id ?? null);
      setWorkbenchView('mechanical');
      const prompt = isEn
        ? `[Heat Exchanger ${unitTag}] Q=${fix.solvedAfter.dutyMcalH.toFixed(1)} Mcal/h, Pinch ΔT=${fix.solvedAfter.minPinchDeltaTC.toFixed(1)}°C, Area=${fix.solvedAfter.areaProvM2.toFixed(1)} m², Utility=${fix.solvedAfter.utilitySide.inTempC.toFixed(1)}→${fix.solvedAfter.utilitySide.outTempC.toFixed(1)}°C, Ft=${fix.solvedAfter.ftFactor.toFixed(2)}, Tube ΔP=${fix.solvedAfter.dpTubeBar.toFixed(2)} bar, Shell ΔP=${fix.solvedAfter.dpShellBar.toFixed(2)} bar. Actions: ${fix.actionsTaken.join(', ')}. Respond concisely in English.`
        : `[열교환기 ${unitTag}] Q=${fix.solvedAfter.dutyMcalH.toFixed(1)} Mcal/h, Pinch ΔT=${fix.solvedAfter.minPinchDeltaTC.toFixed(1)}°C, 전열면적=${fix.solvedAfter.areaProvM2.toFixed(1)} m², 유틸리티=${fix.solvedAfter.utilitySide.inTempC.toFixed(1)}→${fix.solvedAfter.utilitySide.outTempC.toFixed(1)}°C, Ft=${fix.solvedAfter.ftFactor.toFixed(2)}, Tube ΔP=${fix.solvedAfter.dpTubeBar.toFixed(2)} bar, Shell ΔP=${fix.solvedAfter.dpShellBar.toFixed(2)} bar. 조치: ${fix.actionsTaken.join(', ')}`;
      const geminiNote = await fetchOptionalGeminiAdvice(prompt);
      setAiReport({ result: fix, geminiNote });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setAiReport({
        result: {
          resolved: false,
          improved: false,
          headline: isEn
            ? `⚠ An error occurred during AI Auto-Fix (${errMsg})`
            : `⚠ AI 자동 해결 중 오류가 발생했습니다 (${errMsg})`,
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

  const exportHxExcelDatasheet = async () => {
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

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ChemPlant Studio';
    wb.created = new Date();

    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };

    const ws1 = wb.addWorksheet('TEMA_HX_Datasheet', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    const ws1Widths = [7, 36, 13, 22, 20, 22, 20, 28];
    ws1Widths.forEach((w, i) => { ws1.getColumn(i + 1).width = w; });

    sheet1Rows.forEach((rawRow, rIdx) => {
      const padded = Array.from({ length: 8 }, (_, ci) => rawRow[ci] ?? '');
      const row = ws1.addRow(padded);
      const firstCell = String(padded[0] ?? '').trim();
      const secondCell = String(padded[1] ?? '').trim();
      const upperJoined = `${firstCell} ${secondCell}`.toUpperCase();

      if (rIdx === 0) {
        row.height = 28;
        ws1.mergeCells(row.number, 1, row.number, 8);
        const c = row.getCell(1);
        c.font = { name: 'Arial', bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = thinBorder;
      } else if (
        upperJoined.includes('SPECIFICATION ITEM') ||
        (firstCell === 'Line' && secondCell.length > 0)
      ) {
        row.height = 22;
        row.eachCell((cell, colNumber) => {
          cell.font = { name: 'Arial', bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
          cell.alignment = { horizontal: colNumber <= 2 ? 'left' : 'center', vertical: 'middle', wrapText: true };
          cell.border = thinBorder;
        });
      } else if (
        upperJoined.includes('PERFORMANCE OF ONE UNIT') ||
        upperJoined.includes('CONSTRUCTION DATA FOR ONE SHELL') ||
        upperJoined.includes('ENGINEERING DISCLAIMER')
      ) {
        row.height = 20;
        const isWarn = upperJoined.includes('DISCLAIMER');
        ws1.mergeCells(row.number, 1, row.number, 8);
        const c = row.getCell(1);
        c.value = secondCell || firstCell;
        c.font = { name: 'Arial', bold: true, size: 10, color: { argb: isWarn ? 'FF92400E' : 'FF1E3A8A' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isWarn ? 'FFFEF3C7' : 'FFDBEAFE' } };
        c.alignment = { horizontal: 'left', vertical: 'middle' };
        c.border = thinBorder;
      } else if (padded.every((v) => String(v).trim() === '')) {
        row.height = 8;
      } else if (rIdx >= sheet1Rows.length - ENGINEERING_DISCLAIMER_ROWS.length) {
        row.height = 17;
        ws1.mergeCells(row.number, 1, row.number, 8);
        const c = row.getCell(1);
        c.value = padded.filter((v) => String(v).trim() !== '').join(' ');
        c.font = { name: 'Arial', italic: true, size: 8.5, color: { argb: 'FF78350F' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
        c.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        c.border = thinBorder;
      } else {
        row.height = 19;
        const isZebra = rIdx % 2 === 1;
        row.eachCell((cell, colNumber) => {
          const isNumeric = typeof cell.value === 'number';
          cell.font = {
            name: colNumber >= 4 && colNumber <= 7 ? 'Consolas' : 'Arial',
            bold: colNumber === 1 || colNumber === 2,
            size: 9.5,
            color: { argb: colNumber === 1 ? 'FF475569' : 'FF0F172A' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isZebra ? 'FFF8FAFC' : 'FFFFFFFF' },
          };
          cell.alignment = {
            horizontal: colNumber === 1 || colNumber === 3 ? 'center' : isNumeric ? 'right' : 'left',
            vertical: 'middle',
            wrapText: true,
          };
          cell.border = thinBorder;
        });
      }
    });

    const ws2 = wb.addWorksheet('TQ_Profile_Nozzles', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const ws2Widths = [12, 22, 14, 14, 14, 18, 13, 13, 24];
    ws2Widths.forEach((w, i) => { ws2.getColumn(i + 1).width = w; });

    sheet2Rows.forEach((rawRow, rIdx) => {
      if (rawRow.length === 0) {
        const emptyRow = ws2.addRow([]);
        emptyRow.height = 10;
        return;
      }
      const padded = Array.from({ length: 9 }, (_, ci) => rawRow[ci] ?? '');
      const row = ws2.addRow(padded);
      const firstCell = String(padded[0] ?? '').trim();
      const isSection = /^[123]\.\s/.test(firstCell);
      const isColHeader =
        firstCell === 'Q Fraction' || firstCell === 'Nozzle ID' || firstCell === 'Zone';

      if (isSection) {
        row.height = 22;
        ws2.mergeCells(row.number, 1, row.number, 9);
        const c = row.getCell(1);
        c.font = { name: 'Arial', bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        c.alignment = { horizontal: 'left', vertical: 'middle' };
        c.border = thinBorder;
      } else if (isColHeader) {
        row.height = 20;
        row.eachCell((cell) => {
          cell.font = { name: 'Arial', bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.border = thinBorder;
        });
      } else {
        row.height = 18;
        const isZebra = rIdx % 2 === 1;
        row.eachCell((cell) => {
          const isNumeric = typeof cell.value === 'number';
          cell.font = { name: isNumeric ? 'Consolas' : 'Arial', size: 9.5, color: { argb: 'FF0F172A' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isZebra ? 'FFF8FAFC' : 'FFFFFFFF' } };
          cell.alignment = { horizontal: isNumeric ? 'right' : 'center', vertical: 'middle' };
          cell.border = thinBorder;
        });
      }
    });

    const safeTag = (unitTag || 'E-101').replace(/[^A-Za-z0-9_-]/g, '_');
    const stdTag = isPhe ? 'API662_PHE' : `TEMA_${dRes.temaType}`;
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTag}_${stdTag}_Datasheet_${dateStr}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportTemaExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const prioritySheets = [
        '1_TEMA_HX_Datasheet',
        'TEMA_HX_Datasheet',
        'HX DATASHEET',
        '1_API662_PHE_Datasheet',
        'API662_PHE_Datasheet',
      ];
      let targetSheetName =
        prioritySheets.find((pn) =>
          wb.SheetNames.some((sn) => sn.trim().toLowerCase() === pn.toLowerCase())
        ) ?? '';
      if (targetSheetName) {
        targetSheetName =
          wb.SheetNames.find(
            (sn) => sn.trim().toLowerCase() === targetSheetName.toLowerCase()
          ) ?? wb.SheetNames[0];
      } else {
        targetSheetName =
          wb.SheetNames.find((sn) => /tema|hx|datasheet|phe|heat/i.test(sn)) ??
          wb.SheetNames[0];
      }
      const ws = targetSheetName ? wb.Sheets[targetSheetName] : undefined;
      if (!ws) {
        setTemaImportNotice({
          count: 0,
          summary: isEn ? 'Worksheet not found.' : '워크시트를 찾을 수 없습니다.',
          isError: true,
        });
        return;
      }

      const rawRows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(
        ws,
        { header: 1, defval: '' }
      );

      const parseNum = (s: unknown): number => {
        if (typeof s === 'number') return Number.isFinite(s) ? s : NaN;
        const m = String(s ?? '').replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
      };
      const snapNearest = <T extends number>(val: number, allowed: readonly T[]): T => {
        let best = allowed[0];
        let bestDiff = Infinity;
        for (const a of allowed) {
          const diff = Math.abs(a - val);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = a;
          }
        }
        return best;
      };

      const patch: Partial<HxDesignParams> = {};
      const matchedLabels: string[] = [];
      let shellIdMm = NaN;
      let baffleSpacingMm = NaN;
      let parsedTempInfo = '';
      let parsedDutyInfo = '';

      const isPheSheet =
        /phe|api\s*662/i.test(targetSheetName) ||
        rawRows.slice(0, 6).some((row) =>
          /plate\s*heat\s*exchanger|api\s*662|gasketed\s*chevron/i.test(row.join(' '))
        );
      if (isPheSheet) {
        patch.hxKind = 'plate_phe';
        matchedLabels.push('PHE');
      }

      const TEMA_RE = /\b(AES|AEM|AEU|AKT|AJW|BEM|BES|BEU|BKM|BKU|NEN|CEU|CFU|DEU)\b/;

      for (const row of rawRows) {
        const texts = row
          .map((c) => String(c ?? '').trim())
          .filter((t) => t.length > 0);
        if (texts.length === 0) continue;
        const joined = texts.join(' | ');
        const labelIdx = texts.length > 1 && /^\d{1,2}$/.test(texts[0]) ? 1 : 0;
        const label = texts[labelIdx] ?? '';
        const labelLow = label.toLowerCase();
        const rest = texts.slice(labelIdx + 1);

        // TEMA Type
        if (!patch.temaType && (/tema/i.test(joined) || /type/i.test(labelLow))) {
          const tm = joined.match(TEMA_RE);
          if (tm) {
            const rawTema = tm[1];
            const mappedTema: TemaConfiguration =
              rawTema === 'AES' || rawTema === 'BES' || rawTema === 'AJW'
                ? 'AES'
                : rawTema === 'BKM' || rawTema === 'AKT' || rawTema === 'BKU'
                ? 'BKM'
                : rawTema === 'BEU' || rawTema === 'AEU' || rawTema === 'CEU' || rawTema === 'DEU'
                ? 'BEU'
                : 'BEM';
            patch.temaType = mappedTema;
            patch.hxKind = 'shell_tube';
            matchedLabels.push(`TEMA ${mappedTema}`);
          }
        }

        // Shell Count (Shells per Unit / Series)
        if (patch.shellCount === undefined) {
          const serM =
            joined.match(/Shells?\s*(?:per\s*Unit)?\s*[:|]\s*(\d+)/i) ||
            joined.match(/(\d+)\s*Series/i) ||
            joined.match(/(\d+)\s*Shell\s*[×x]/i);
          if (serM) {
            const sc = Math.min(4, Math.max(1, parseInt(serM[1], 10)));
            patch.shellCount = sc;
            matchedLabels.push(`Shells ${sc}`);
          }
        }

        // Shell ID & Tube Length
        if (/size\s*\(|shell\s*id|쉘\s*내경/i.test(labelLow) || /^shell\s+od/i.test(labelLow)) {
          const idM = joined.match(/(?:ID\s*[:=]?\s*Ø?|Ø)(\d+(?:\.\d+)?)\s*(?:mm)?/i);
          if (idM) {
            const v = parseFloat(idM[1]);
            if (Number.isFinite(v) && v >= 100 && v <= 5000) {
              shellIdMm = v;
              patch.ratingShellIdMm = Math.round(v);
              matchedLabels.push(`Shell ID Ø${Math.round(v)}`);
            }
          }
          const lenMmM = joined.match(/(?:\/|×|L\s*[:=]?)\s*(\d{3,5}(?:\.\d+)?)\s*mm/i);
          if (lenMmM && patch.tubeLengthM === undefined) {
            const lm = parseFloat(lenMmM[1]) / 1000;
            if (lm >= 1.0 && lm <= 15.0) {
              patch.tubeLengthM = snapNearest(lm, [2.44, 3.05, 3.66, 4.88, 6.1] as const);
              patch.ratingTubeLengthM = Number(lm.toFixed(2));
              matchedLabels.push(`L=${patch.tubeLengthM}m`);
            }
          }
        }

        // Tube Passes
        if (/no\.?\s*passes|tube\s*passes|패스/i.test(labelLow)) {
          const nums = rest
            .filter((t) => t !== '-' && !/pass/i.test(t))
            .map(parseNum)
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= 16);
          if (nums.length > 0) {
            const tp = snapNearest(nums[nums.length - 1], [1, 2, 4, 6] as const);
            patch.tubePasses = tp;
            matchedLabels.push(`${tp}P`);
          }
        }

        // Tubes (No. / OD / Length / Pitch)
        if (/tubes?\b|튜브/i.test(labelLow) && !/tubesheet|tube\s*side|tube\s*type|supports/i.test(labelLow)) {
          const cntM =
            joined.match(/Tubes\s+No\.?\s*(\d+)/i) ||
            joined.match(/(\d+)\s*EA\b/i);
          if (cntM) {
            const cnt = parseInt(cntM[1], 10);
            if (cnt >= 4 && cnt <= 20000) {
              patch.ratingTubeCount = cnt;
            }
          } else {
            const firstCnt = parseNum(rest[1] ?? rest[0]);
            if (Number.isFinite(firstCnt) && firstCnt >= 4 && firstCnt <= 20000 && Number.isInteger(firstCnt)) {
              patch.ratingTubeCount = firstCnt;
            }
          }

          const odM = joined.match(/OD\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|in|")?/i);
          if (odM) {
            let od = parseFloat(odM[1]);
            const u = (odM[2] ?? '').toLowerCase();
            if (u === 'in' || u === '"' || (od > 0.4 && od < 3.0)) od *= 25.4;
            if (od >= 6 && od <= 60) {
              patch.tubeOdMm = snapNearest(od, [15.88, 19.05, 25.4] as const);
              matchedLabels.push(`OD ${patch.tubeOdMm}mm`);
            }
          }

          const lenM = joined.match(/(?:Length|L)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(m|mm|ft)\b/i);
          if (lenM) {
            let lv = parseFloat(lenM[1]);
            const u = lenM[2].toLowerCase();
            if (u === 'mm') lv /= 1000;
            else if (u === 'ft') lv *= 0.3048;
            if (lv >= 1.0 && lv <= 15.0) {
              patch.tubeLengthM = snapNearest(lv, [2.44, 3.05, 3.66, 4.88, 6.1] as const);
              patch.ratingTubeLengthM = Number(lv.toFixed(2));
              if (!matchedLabels.some((m) => m.startsWith('L='))) {
                matchedLabels.push(`L=${patch.tubeLengthM}m`);
              }
            }
          }

          const pitchM = joined.match(/(?:Pitch\s*deg|Layout|Pitch)\s*[:=]?\s*(30|45|60|90)\s*°?/i);
          if (pitchM) {
            const deg = parseInt(pitchM[1], 10);
            patch.pitchAngle = deg === 45 ? 45 : deg === 90 ? 90 : 30;
            matchedLabels.push(`Layout ${patch.pitchAngle}°`);
          }
        }

        // Baffle Cut & Spacing
        if (/baffle|배플/i.test(joined) && !/baffles?\s*long|clearance/i.test(labelLow)) {
          const cutM = joined.match(
            /(?:%?\s*Cut\s*(?:\(d\))?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%?)|(\d+(?:\.\d+)?)\s*%\s*Cut/i
          );
          if (cutM) {
            const cut = parseFloat(cutM[1] || cutM[2]);
            if (Number.isFinite(cut) && cut >= 10 && cut <= 50) {
              patch.baffleCutPct = Math.min(45, Math.max(15, Math.round(cut)));
              matchedLabels.push(`Cut ${patch.baffleCutPct}%`);
            }
          }
          const spM =
            joined.match(/(?:Spacing(?:\s*C\/C)?|B)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm/i) ||
            joined.match(/(\d+(?:\.\d+)?)\s*mm\s*C\/C/i);
          if (spM) {
            const sp = parseFloat(spM[1]);
            if (Number.isFinite(sp) && sp >= 30 && sp <= 3000) {
              baffleSpacingMm = sp;
              patch.ratingBaffleSpacingMm = Math.round(sp);
              matchedLabels.push(`B=${Math.round(sp)}mm`);
            }
          }
        }

        // Fouling Factor / Resistance
        if (/fouling|오염\s*계수/i.test(labelLow)) {
          const isWm2K = /m²·?k\/w|m2k\/w/i.test(joined);
          const rfVals = rest
            .filter((t) => !/h_[io]=/i.test(t) && !/m²|m2/i.test(t))
            .map(parseNum)
            .filter((n) => Number.isFinite(n) && n >= 0 && n < 0.05);
          if (rfVals.length >= 2) {
            const conv = isWm2K ? 1.163 : 1.0;
            const sRf = Number((rfVals[0] * conv).toFixed(5));
            const tRf = Number((rfVals[1] * conv).toFixed(5));
            const isProcTube = (hxCfg.allocation ?? dRes.allocation) === 'process_tube';
            patch.foulingProcM2HKcal = isProcTube ? tRf : sRf;
            patch.foulingUtilM2HKcal = isProcTube ? sRf : tRf;
            matchedLabels.push('Fouling');
          }
        }

        // Temperature & Duty (captured for inline verification summary)
        if (/temperature\s*\(?in|온도/i.test(labelLow) && !/design\s*temp/i.test(labelLow)) {
          const nums = rest
            .filter((t) => !/pinch/i.test(t) && /^[-+]?\d/.test(t))
            .map(parseNum)
            .filter(Number.isFinite);
          if (nums.length >= 4) {
            parsedTempInfo = `Shell ${nums[0]}→${nums[1]}°C / Tube ${nums[2]}→${nums[3]}°C`;
          }
        }
        if (/heat\s*(?:exchanged|duty)|열교환\s*용량/i.test(labelLow)) {
          const qM = joined.match(/(\d[\d,]*(?:\.\d+)?)\s*kW/i);
          if (qM) parsedDutyInfo = `Q=${qM[1]} kW`;
        }
      }

      if (Number.isFinite(baffleSpacingMm) && Number.isFinite(shellIdMm) && shellIdMm > 0) {
        patch.baffleSpacingRatio = Number(
          Math.min(0.95, Math.max(0.22, baffleSpacingMm / shellIdMm)).toFixed(2)
        );
      }

      const appliedCount = Object.keys(patch).length;
      if (appliedCount > 0) {
        patchHxCfg(patch);
        setWorkbenchView('mechanical');
        const extra = [parsedDutyInfo, parsedTempInfo].filter(Boolean).join(' · ');
        setTemaImportNotice({
          count: appliedCount,
          summary:
            matchedLabels.slice(0, 6).join(', ') + (extra ? ` (${extra})` : ''),
        });
      } else {
        setTemaImportNotice({
          count: 0,
          summary: isEn
            ? 'No recognizable TEMA design items found.'
            : '인식 가능한 TEMA 설계 항목을 찾지 못했습니다.',
          isError: true,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTemaImportNotice({
        count: 0,
        summary: isEn ? `Excel parsing error: ${msg}` : `엑셀 파싱 오류: ${msg}`,
        isError: true,
      });
    } finally {
      e.target.value = '';
    }
  };

  const isLiquefier = unitType === 'liquefier';
  const hexSpecMode = params.hexSpecMode ?? 'proc_temp';
  const refKey: RefrigerantPresetKey =
    params.refrigerantPreset ?? (isLiquefier ? 'freon_m35' : 'cw');

  const statusTone = isRunningFeedback
    ? {
        bg: '#EFF6FF',
        fg: '#1D4ED8',
        bd: '#93C5FD',
        text: isEn ? '⏳ Running heat balance & hydraulics...' : '⏳ 열수지·수력학 계산 실행 중...',
      }
    : isSimDirty
    ? {
        bg: '#FFFBEB',
        fg: '#92400E',
        bd: '#FCD34D',
        text: isEn ? 'Conditions changed — Click [▶ Run (F5)]' : '운전조건 변경됨 — [▶ RUN] 실행 필요',
      }
    : dRes.overallStatus === 'error'
    ? {
        bg: '#FEF2F2',
        fg: '#991B1B',
        bd: '#FCA5A5',
        text: isEn ? '✕ Check thermal pinch or metallurgy safety' : '✕ 열역학 핀치 또는 재질 안전 점검 필요',
      }
    : dRes.overallStatus === 'warning'
    ? {
        bg: '#FFFBEB',
        fg: '#92400E',
        bd: '#FCD34D',
        text: isEn ? '⚠ Check ΔP & approach temperature limits' : '⚠ 압력손실·접근온도 권장치 점검',
      }
    : {
        bg: '#DCFCE7',
        fg: '#166534',
        bd: '#86EFAC',
        text: isEn
          ? `✓ Thermal, Hydraulics & Material OK (${dRes.hxKind === 'plate_phe' ? 'Plate PHE' : `TEMA ${dRes.temaType}`} · ${dRes.areaProvM2.toFixed(1)} m²)`
          : `✓ 열수지·수력학·재질 정상 (${dRes.hxKind === 'plate_phe' ? '판형 PHE' : `TEMA ${dRes.temaType}`} · ${dRes.areaProvM2.toFixed(1)} m²)`,
      };

  const hysysStatusBar = (() => {
    const isRed =
      dRes.minPinchDeltaTC <= 0.5 ||
      dRes.dpTubeBar > 0.7 ||
      dRes.dpShellBar > 0.7 ||
      dRes.vibRatio >= 0.8 ||
      dRes.ftFactor < 0.78 ||
      dRes.actualOverdesignPct < 0 ||
      dRes.overallStatus === 'error';

    if (isRed) {
      const reasons: string[] = [];
      if (dRes.minPinchDeltaTC <= 0.5) {
        reasons.push(
          isEn
            ? `Pinch cross (ΔT=${dRes.minPinchDeltaTC.toFixed(1)}°C)`
            : `핀치 역전(ΔT=${dRes.minPinchDeltaTC.toFixed(1)}°C)`
        );
      }
      if (dRes.dpTubeBar > 0.7) {
        reasons.push(`Tube ΔP ${dRes.dpTubeBar.toFixed(2)} bar`);
      }
      if (dRes.dpShellBar > 0.7) {
        reasons.push(`Shell ΔP ${dRes.dpShellBar.toFixed(2)} bar`);
      }
      if (dRes.vibRatio >= 0.8) {
        reasons.push(`FIV ${dRes.vibRatio.toFixed(2)}`);
      }
      if (dRes.ftFactor < 0.78) {
        reasons.push(`Ft ${dRes.ftFactor.toFixed(2)}`);
      }
      if (dRes.actualOverdesignPct < 0) {
        reasons.push(
          isEn
            ? `Under-surfaced (${dRes.actualOverdesignPct.toFixed(1)}%)`
            : `전열면적 부족(${dRes.actualOverdesignPct.toFixed(1)}%)`
        );
      }
      if (reasons.length === 0) {
        const errDiag = dRes.diagnostics.find((d) => d.level === 'error');
        reasons.push(
          errDiag?.message ||
            (isEn ? 'Thermal / metallurgy safety interlock' : '열역학·재질 안전 인터록 점검 필요')
        );
      }
      return {
        level: 'red' as const,
        bg: '#FEF2F2',
        border: '#FCA5A5',
        color: '#991B1B',
        text: isEn
          ? `🔴 Physical / Hydraulic Error: ${reasons.join(' · ')}`
          : `🔴 물리적/수력학 오류: ${reasons.join(' · ')}`,
      };
    }

    const isAmber =
      dRes.minPinchDeltaTC < 5 ||
      dRes.material.code !== dRes.recommendedMaterial ||
      dRes.overallStatus === 'warning';

    if (isAmber) {
      const recMat = isEn
        ? HX_MATERIAL_EN[dRes.recommendedMaterial].shortLabel
        : HX_MATERIAL_CATALOG[dRes.recommendedMaterial].shortLabel;
      const warns: string[] = [];
      if (dRes.minPinchDeltaTC < 5) {
        warns.push(
          isEn
            ? `Tight pinch margin (ΔT=${dRes.minPinchDeltaTC.toFixed(1)}°C)`
            : `핀치 여유 협소(ΔT=${dRes.minPinchDeltaTC.toFixed(1)}°C)`
        );
      }
      if (dRes.material.code !== dRes.recommendedMaterial) {
        warns.push(
          isEn
            ? `Check recommended metallurgy (${recMat})`
            : `권장 재질(${recMat}) 확인 필요`
        );
      }
      if (warns.length === 0) {
        warns.push(
          isEn
            ? 'Check approach temperature & operating margins'
            : '접근온도·운전 여유 권장치 확인 필요'
        );
      }
      return {
        level: 'amber' as const,
        bg: '#FFFBEB',
        border: '#FCD34D',
        color: '#92400E',
        text: isEn ? `🟡 Caution: ${warns.join(' · ')}` : `🟡 주의: ${warns.join(' · ')}`,
      };
    }

    return {
      level: 'green' as const,
      bg: '#ECFDF5',
      border: '#6EE7B7',
      color: '#065F46',
      text: isEn
        ? '🟢 Ready & Verified — Duty, Area, ΔP & Vibration all within limits'
        : '🟢 설계 조건 완료 — 열부하 · 면적 · ΔP · 진동 모두 정상 범위',
    };
  })();

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
              {isEn ? `Dew Pt ${dRes.dewPointC.toFixed(1)}°C` : `이슬점 ${dRes.dewPointC.toFixed(1)}°C`}
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
          {isEn
            ? `━ Hot Side (${dRes.hotSide.inTempC.toFixed(1)} → ${dRes.hotSide.outTempC.toFixed(1)}°C)`
            : `━ 고온측 (${dRes.hotSide.inTempC.toFixed(1)} → ${dRes.hotSide.outTempC.toFixed(1)}°C)`}
        </text>
        <text x={padL + 195} y={16} fontSize={10} fontWeight={800} fill="#0369A1">
          {isEn
            ? `━ Cold Side Countercurrent (${dRes.coldSide.inTempC.toFixed(1)} → ${dRes.coldSide.outTempC.toFixed(1)}°C)`
            : `━ 저온측 향류 (${dRes.coldSide.inTempC.toFixed(1)} → ${dRes.coldSide.outTempC.toFixed(1)}°C)`}
        </text>
        <text x={W - padR} y={H - 2} fontSize={9} textAnchor="end" fill="#64748B">
          {isEn ? 'Cumulative Heat Duty Q (Mcal/h)' : '누적 교환열량 Q (Mcal/h)'}
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
            {isEn
              ? 'Plate Heat Exchanger (Chevron PHE) Conceptual Outline & Port Layout'
              : '판형 열교환기 (Chevron PHE) 개념설계 외형도 · 포트 배치도'}
          </text>
          <text x={16} y={37} fontSize={9.8} fill="#475569" fontFamily={MONO}>
            {isEn
              ? `${dRes.phePlateCount} Plates (${HX_MATERIAL_EN[dRes.material.code].shortLabel}) · Chevron ${dRes.pheChevronDeg}° · Eff. Area ${dRes.areaProvM2.toFixed(1)} m²`
              : `전열판 ${dRes.phePlateCount}매 (${dRes.material.shortLabel}) · 쉐브론 ${dRes.pheChevronDeg}° · 유효면적 ${dRes.areaProvM2.toFixed(1)} m²`}
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
            {isEn
              ? `Plate Pack Length L_pack = ${dRes.phePackLengthMm} mm`
              : `판 팩 압축길이 L_pack = ${dRes.phePackLengthMm} mm`}
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
            {isEn
              ? `Plate Size ${dRes.phePlateWidthMm}W × ${dRes.phePlateHeightMm}H mm`
              : `판 규격 ${dRes.phePlateWidthMm}W × ${dRes.phePlateHeightMm}H mm`}
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
          {isEn
            ? `TEMA ${dRes.temaType} Shell & Tube Heat Exchanger Conceptual Elevation & Tube Layout (A-A)`
            : `TEMA ${dRes.temaType} 다관원통형 열교환기 개념설계 종단면도 & 관배열(A-A)`}
        </text>
        <text x={14} y={36} fontSize={9.8} fill="#475569" fontFamily={MONO}>
          {isEn
            ? `Shell ID Ø${dRes.shellIdMm} mm × ${dRes.shellCount} · Tubes Ø${dRes.tubeOdMm}×${dRes.tubeLengthM}m (${dRes.tubeCountPerShell} ea, ${dRes.tubePasses}P) · ${HX_MATERIAL_EN[dRes.material.code].shortLabel}`
            : `동체 내경 Ø${dRes.shellIdMm} mm × ${dRes.shellCount}기 · 튜브 Ø${dRes.tubeOdMm}×${dRes.tubeLengthM}m (${dRes.tubeCountPerShell}본, ${dRes.tubePasses}패스) · ${dRes.material.shortLabel}`}
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
          {isEn
            ? `Effective Tube Length L = ${dRes.tubeLengthM.toFixed(2)} m · ${dRes.baffleCount} Baffles (Spacing ${dRes.baffleSpacingMm} mm)`
            : `유효 관길이 L = ${dRes.tubeLengthM.toFixed(2)} m · 배플 ${dRes.baffleCount}단 (간격 ${dRes.baffleSpacingMm} mm)`}
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
          {isEn ? `Section A-A (Ø${dRes.shellIdMm} mm)` : `단면 A-A (Ø${dRes.shellIdMm} mm)`}
        </text>
        <text x={422} y={230} fontSize={9} textAnchor="middle" fill="#475569" fontFamily={MONO}>
          {isEn
            ? `Pitch ${dRes.tubePitchMm}mm (${dRes.pitchAngle}° Layout)`
            : `피치 ${dRes.tubePitchMm}mm (${dRes.pitchAngle}° 배열)`}
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
            padding: isMobile ? '9px 12px' : '8px 14px',
            background: '#0F172A',
            color: '#F8FAFC',
            borderBottom: '1px solid #1E293B',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: 'space-between',
            alignItems: isMobile ? 'stretch' : 'center',
            gap: isMobile ? 8 : 10,
            flexWrap: 'nowrap',
            flexShrink: 0,
          }}
        >
          {/* 좌측: 타이틀 + 상태 배지 (1행) & 핵심 운전 요약 (2행) */}
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div
              style={{
                display: 'flex',
                alignItems: isMobile ? 'flex-start' : 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  flexWrap: isMobile ? 'wrap' : 'nowrap',
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 900,
                    color: '#FFFFFF',
                    whiteSpace: isMobile ? 'normal' : 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    wordBreak: 'keep-all',
                  }}
                  title={`[${unitTag}] ${unitLabel}`}
                >
                  [{unitTag}] {unitLabel}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: statusTone.bg,
                    color: statusTone.fg,
                    border: `1px solid ${statusTone.bd}`,
                    fontSize: 10,
                    fontWeight: 900,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {statusTone.text}
                </span>
              </div>

              {isMobile && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={isEn ? 'Close workbench' : '워크벤치 닫기'}
                  title={isEn ? 'Close (Esc)' : '닫기 (Esc)'}
                  style={{
                    flexShrink: 0,
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid #475569',
                    background: 'rgba(255,255,255,0.12)',
                    color: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 900,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            <div
              style={{
                fontSize: isMobile ? 10.2 : 10.5,
                color: '#CBD5E1',
                fontFamily: MONO,
                fontWeight: 600,
                marginTop: 2,
                lineHeight: 1.3,
                whiteSpace: isMobile ? 'normal' : 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={`Q = ${formatCanonicalValue('heatDuty', dRes.dutyMcalH, dutyUnit)} ${getUnitLabel('heatDuty', dutyUnit)} · A = ${formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)} ${getUnitLabel('area', areaUnit)} · U = ${formatCanonicalValue('htc', dRes.uCalcKcalM2HC, htcUnit, 0)} ${getUnitLabel('htc', htcUnit)}${lastRunStamp ? ` · ${lastRunStamp}` : ''}`}
            >
              Q = {formatCanonicalValue('heatDuty', dRes.dutyMcalH, dutyUnit)}{' '}
              {getUnitLabel('heatDuty', dutyUnit)} · A ={' '}
              {formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)}{' '}
              {getUnitLabel('area', areaUnit)} · U ={' '}
              {formatCanonicalValue('htc', dRes.uCalcKcalM2HC, htcUnit, 0)}{' '}
              {getUnitLabel('htc', htcUnit)}
              {lastRunStamp ? ` · ${lastRunStamp}` : ''}
            </div>
          </div>

          {/* 우측: TEMA·도구 드롭다운 + AI 자동 해결 + RUN + 닫기(✕) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              flexWrap: isMobile ? 'wrap' : 'nowrap',
              width: isMobile ? '100%' : undefined,
            }}
          >
            <input
              ref={temaFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleImportTemaExcel}
            />

            {/* 통합 TEMA · 도구 드롭다운 */}
            <div ref={temaMenuRef} style={{ position: 'relative', flex: isMobile ? '1 1 auto' : undefined }}>
              <button
                type="button"
                onClick={() => setTemaMenuOpen((prev) => !prev)}
                aria-expanded={temaMenuOpen}
                aria-haspopup="menu"
                title={
                  isEn
                    ? 'Export/Import TEMA / API 662 Excel & Shortcut Designer'
                    : 'TEMA / API 662 엑셀 내보내기·가져오기 및 단품 설계기'
                }
                style={{
                  width: isMobile ? '100%' : undefined,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: temaMenuOpen ? '1px solid #38BDF8' : '1px solid #475569',
                  background: temaMenuOpen ? '#1E3A5F' : '#1E293B',
                  color: '#E2E8F0',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {isEn ? '📊 TEMA · Tools ▾' : '📊 TEMA · 도구 ▾'}
              </button>

              {temaMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 5px)',
                    right: isMobile ? undefined : 0,
                    left: isMobile ? 0 : undefined,
                    zIndex: 60,
                    minWidth: 215,
                    background: '#1E293B',
                    border: '1px solid #475569',
                    borderRadius: 8,
                    boxShadow: '0 14px 32px rgba(15, 23, 42, 0.48)',
                    padding: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setTemaMenuOpen(false);
                      exportHxExcelDatasheet();
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 10px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      color: '#ECFDF5',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#065F46';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                    title={
                      isEn
                        ? 'Download official TEMA / API 662 Excel datasheet (.xlsx)'
                        : '공식 TEMA / API 662 엑셀 데이터시트(.xlsx) 다운로드'
                    }
                  >
                    {isEn
                      ? `📊 Export ${dRes.hxKind === 'plate_phe' ? 'API 662' : 'TEMA'} .xlsx`
                      : `📊 ${dRes.hxKind === 'plate_phe' ? 'API 662' : 'TEMA'} .xlsx 내보내기`}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setTemaMenuOpen(false);
                      temaFileInputRef.current?.click();
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 10px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      color: '#E0F2FE',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#0C4A6E';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                    title={
                      isEn
                        ? 'Import TEMA / API 662 Excel datasheet (.xlsx)'
                        : 'TEMA / API 662 엑셀 데이터시트(.xlsx) 불러오기'
                    }
                  >
                    {isEn ? '📂 Import TEMA .xlsx' : '📂 TEMA .xlsx 가져오기'}
                  </button>
                  {onOpenChemProDesign && (
                    <>
                      <div style={{ height: 1, background: '#334155', margin: '2px 4px' }} />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setTemaMenuOpen(false);
                          onOpenChemProDesign();
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '7px 10px',
                          borderRadius: 5,
                          border: 'none',
                          background: 'transparent',
                          color: '#E2E8F0',
                          fontSize: 11.5,
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#334155';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {isEn ? '↗ Shortcut Designer' : '↗ 단품 숏컷 설계기 열기'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={runAiAutoFixHx}
              disabled={isAiBusy}
              style={{
                flex: isMobile ? '1 1 auto' : undefined,
                padding: '5px 10px',
                borderRadius: 6,
                border: dRes.overallStatus !== 'ok' ? '1.5px solid #C084FC' : '1px solid #64748B',
                background: dRes.overallStatus !== 'ok' ? '#7C3AED' : '#334155',
                color: '#FFFFFF',
                fontSize: 11,
                fontWeight: 900,
                cursor: isAiBusy ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isAiBusy
                ? (aiStepLabel || (isEn ? '⏳ Analyzing...' : '⏳ AI 분석 중...'))
                : (isEn ? '✨ AI Auto-Fix' : '✨ AI 자동 해결')}
            </button>

            <button
              type="button"
              onClick={triggerRun}
              style={{
                flex: isMobile ? '1 1 auto' : undefined,
                padding: '5px 11px',
                borderRadius: 6,
                border: isSimDirty ? '1.5px solid #FDE047' : '1px solid #60A5FA',
                background: isSimDirty ? '#D97706' : '#2563EB',
                color: '#FFFFFF',
                fontSize: 11,
                fontWeight: 900,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: isSimDirty
                  ? '0 0 0 2px rgba(245,158,11,0.28)'
                  : '0 1px 4px rgba(15,23,42,0.25)',
              }}
            >
              {isRunningFeedback
                ? (isEn ? '⏳ Running...' : '⏳ 계산 중...')
                : (isEn ? '▶ Run (F5)' : '▶ RUN (F5)')}
            </button>

            {!isMobile && (
              <button
                type="button"
                onClick={onClose}
                aria-label={isEn ? 'Close workbench' : '워크벤치 닫기'}
                title={isEn ? 'Close (Esc)' : '닫기 (Esc)'}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid #475569',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.1,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 상단 2-탭 스위처 (컴팩트) */}
        <div
          style={{
            padding: isMobile ? '5px 10px' : '5px 14px',
            background: '#FFFFFF',
            borderBottom: '1px solid #CBD5E1',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(
              [
                {
                  id: 'thermal',
                  title: isEn ? '① Heat Balance & T-Q Profile' : '① 열수지 · T-Q 프로파일',
                  sub: isEn ? 'Outlet Temp · Utility · Pinch' : '출구온도 · 열매/냉매 · 핀치',
                },
                {
                  id: 'mechanical',
                  title: isEn ? '② Shortcut Sizing, Hydraulics & CAD' : '② 숏컷 사이징 · 수력학 · 도면',
                  sub: isEn ? 'Key Specs · ΔP/FIV · CAD' : '핵심 규격 · ΔP/진동 · CAD',
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
                    padding: isMobile ? '5px 9px' : '5px 12px',
                    borderRadius: 6,
                    border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                    background: active ? '#1E3A8A' : '#F8FAFC',
                    color: active ? '#FFFFFF' : '#334155',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 900 }}>{tb.title}</span>
                  {!isMobile && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: active ? '#BFDBFE' : '#64748B',
                      }}
                    >
                      {tb.sub}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {temaImportNotice && (
            <span
              title={temaImportNotice.summary}
              style={{
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: 10.5,
                fontWeight: 800,
                background: temaImportNotice.isError ? '#FEF2F2' : '#F0FDF4',
                color: temaImportNotice.isError ? '#991B1B' : '#166534',
                border: temaImportNotice.isError
                  ? '1px solid #FCA5A5'
                  : '1px solid #86EFAC',
                maxWidth: 280,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {temaImportNotice.isError
                ? `⚠ ${temaImportNotice.summary}`
                : isEn
                ? `✓ Imported ${temaImportNotice.count} TEMA items`
                : `✓ TEMA 항목 ${temaImportNotice.count}건 불러옴`}
            </span>
          )}
        </div>

        {/* HYSYS-스타일 1-Line 신호등 상태 바 (열수지 · 기하설계 공통 상시 표시) */}
        <div
          style={{
            padding: isMobile ? '6px 10px' : '5px 14px',
            background: hysysStatusBar.bg,
            borderBottom: `1.5px solid ${hysysStatusBar.border}`,
            color: hysysStatusBar.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexShrink: 0,
            minHeight: 30,
          }}
        >
          <div
            style={{
              fontSize: 11.2,
              fontWeight: 900,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: isMobile ? 'normal' : 'nowrap',
              minWidth: 0,
              flex: 1,
            }}
            title={hysysStatusBar.text}
          >
            {hysysStatusBar.text}
          </div>
          {hysysStatusBar.level !== 'green' && (
            <button
              type="button"
              onClick={runAiAutoFixHx}
              disabled={isAiBusy}
              style={{
                flexShrink: 0,
                padding: '3px 10px',
                borderRadius: 6,
                border: `1px solid ${hysysStatusBar.level === 'red' ? '#DC2626' : '#D97706'}`,
                background: hysysStatusBar.level === 'red' ? '#7C3AED' : '#B45309',
                color: '#FFFFFF',
                fontSize: 10.5,
                fontWeight: 900,
                cursor: isAiBusy ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isAiBusy
                ? (aiStepLabel || (isEn ? '⏳ Fixing...' : '⏳ 해결 중...'))
                : (isEn ? '✨ AI Auto-Fix' : '✨ AI 자동 해결')}
            </button>
          )}
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
              {isEn ? '⚙ Conditions & Geometry' : '⚙ 조건 · 기하구조 입력'}
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
              {isEn ? '📈 Curves · CAD · Spec' : '📈 선도 · 단면도 · 사양서'}
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
                <span style={{ fontWeight: 900 }}>
                  {isEn ? '⏳ ✨ Running AI Auto-Fix...' : '⏳ ✨ AI 자동 해결 탐색 중...'}
                </span>
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
                    {isEn ? 'Causes: ' : '원인: '}{aiReport.result.rootCauses.slice(0, 2).join(' · ')}
                  </div>
                )}
                {aiReport.result.actionsTaken.length > 0 && (
                  <div style={{ color: '#1E293B', fontWeight: 700, fontSize: 10.6 }}>
                    {isEn ? 'Actions: ' : '조치: '}{aiReport.result.actionsTaken.join(' · ')}
                  </div>
                )}
                {aiReport.geminiNote && (
                  <div style={{ color: '#4C1D95', fontWeight: 700, fontSize: 10.5 }}>
                    {aiReport.geminiNote}
                  </div>
                )}
                {aiReport.result.options && aiReport.result.options.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 900,
                        color: '#0F172A',
                        marginBottom: 5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>
                        {isEn
                          ? 'AI-Verified Design Options (#1 Most Economical Auto-Applied)'
                          : 'AI 검증 설계 대안 (가장 경제적인 1번 자동 적용됨)'}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
                        gap: 8,
                      }}
                    >
                      {aiReport.result.options.map((opt, idx) => {
                        const isSelected =
                          selectedAiOptionId === opt.id ||
                          (!selectedAiOptionId && idx === 0);
                        const isPhe = opt.res.hxKind === 'plate_phe';
                        const specLine = isPhe
                          ? `PHE · Gap ${opt.res.pheGapMm.toFixed(1)}mm · ${opt.res.pheChevronDeg}° · ${opt.res.phePlateCount} ${isEn ? 'Plates' : '판'}`
                          : `TEMA ${opt.res.temaType} · ${opt.res.tubePasses}-Pass · Ø${opt.res.tubeOdMm}×${opt.res.tubeLengthM.toFixed(2)}m · ${opt.res.shellCount} ${isEn ? (opt.res.shellCount > 1 ? 'Shells' : 'Shell') : '쉘'}`;
                        const costK = (opt.estimatedCostUsd / 1000).toFixed(1);
                        return (
                          <div
                            key={opt.id}
                            style={{
                              background: isSelected ? '#FFFFFF' : '#F8FAFC',
                              border: isSelected ? '1.5px solid #16A34A' : '1px solid #CBD5E1',
                              borderRadius: 7,
                              padding: '7px 9px',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              gap: 4,
                              boxShadow: isSelected
                                ? '0 1px 4px rgba(22, 163, 74, 0.14)'
                                : 'none',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 4,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: 900,
                                    padding: '1px 6px',
                                    borderRadius: 999,
                                    background: isSelected ? '#DCFCE7' : '#E2E8F0',
                                    color: isSelected ? '#15803D' : '#475569',
                                  }}
                                >
                                  {isSelected
                                    ? idx === 0
                                      ? isEn
                                        ? '✓ AI Auto-Applied'
                                        : '✓ AI 자동 선택'
                                      : isEn
                                      ? '✓ Applied'
                                      : '✓ 적용됨'
                                    : isEn
                                    ? `Option ${idx + 1} · ${opt.badgeEn}`
                                    : `대안 ${idx + 1} · ${opt.badgeKo}`}
                                </span>
                                <span
                                  style={{
                                    fontSize: 9.2,
                                    fontWeight: 900,
                                    fontFamily: MONO,
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    background: opt.allPassed ? '#ECFDF5' : '#FEF3C7',
                                    color: opt.allPassed ? '#047857' : '#B45309',
                                    border: `1px solid ${opt.allPassed ? '#A7F3D0' : '#FDE68A'}`,
                                  }}
                                >
                                  {opt.allPassed ? 'PASS' : 'CHECK'}
                                </span>
                              </div>
                              <div style={{ fontSize: 10.8, fontWeight: 900, color: '#0F172A' }}>
                                {isEn ? opt.labelEn : opt.labelKo}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  fontFamily: MONO,
                                  color: '#1E40AF',
                                }}
                              >
                                {specLine}
                              </div>
                              <div
                                style={{
                                  fontSize: 9.8,
                                  fontFamily: MONO,
                                  color: '#334155',
                                  lineHeight: 1.35,
                                }}
                              >
                                {isEn ? 'Area' : '면적'} {opt.res.areaProvM2.toFixed(1)} m² · Tube ΔP{' '}
                                {opt.res.dpTubeBar.toFixed(2)} / Shell ΔP{' '}
                                {opt.res.dpShellBar.toFixed(2)} bar · FIV{' '}
                                {(opt.res.vibRatio * 100).toFixed(0)}% · Est. ${costK}k
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => applyAiOption(opt)}
                              disabled={isSelected}
                              style={{
                                marginTop: 2,
                                width: '100%',
                                padding: '4px 8px',
                                borderRadius: 5,
                                border: isSelected
                                  ? '1px solid #86EFAC'
                                  : '1px solid #2563EB',
                                background: isSelected ? '#F0FDF4' : '#2563EB',
                                color: isSelected ? '#15803D' : '#FFFFFF',
                                fontSize: 10.2,
                                fontWeight: 900,
                                cursor: isSelected ? 'default' : 'pointer',
                              }}
                            >
                              {isSelected
                                ? isEn
                                  ? '✓ Currently Applied'
                                  : '✓ 현재 적용됨'
                                : isEn
                                ? 'Apply Option'
                                : '이 옵션 적용'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
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
                {isEn ? '✕ Close' : '✕ 닫기'}
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
                            {isAiBusy
                              ? (aiStepLabel || (isEn ? '⏳ Analyzing...' : '⏳ 분석중...'))
                              : (isEn ? '✨ AI Auto-Fix' : '✨ AI 자동 해결')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 필수 운전 사양 — 3-Line 핵심 입력 전면 뷰 */}
                <div style={cardBox}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 9,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                      {isEn ? 'Core Operating Inputs (3-Line)' : '핵심 운전 조건 (3-Line)'}
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
                      {isEn ? 'Inlet: ' : '유입: '}{dRes.processSide.fluidName} ({formatCanonicalValue('massFlow', dRes.processSide.massFlowKgH, massUnit)} {getUnitLabel('massFlow', massUnit)})
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {/* Line 1: ① 공정 출구 목표 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={lblStyle}>
                          {isEn ? '① Process Outlet Target' : '① 공정 출구 목표'}
                        </label>
                        <select
                          value={hexSpecMode}
                          onChange={(e) =>
                            onChangeParams({
                              hexSpecMode: e.target.value as 'proc_temp' | 'heat_duty',
                            })
                          }
                          style={selStyle}
                        >
                          <option value="proc_temp">
                            {isEn ? 'Target Outlet Temp' : '공정 출구 목표온도'}
                          </option>
                          <option value="heat_duty">
                            {isEn ? 'Specified Heat Duty Q' : '교환 열부하 Q 직접 지정'}
                          </option>
                        </select>
                      </div>

                      {hexSpecMode === 'proc_temp' ? (
                        <div>
                          <label style={lblStyle}>
                            {isEn
                              ? `Target Temp [In ${formatCanonicalValue('temp', dRes.processSide.inTempC, tempUnit, 1)} ${getUnitLabel('temp', tempUnit)}]`
                              : `목표 온도 [입구 ${formatCanonicalValue('temp', dRes.processSide.inTempC, tempUnit, 1)} ${getUnitLabel('temp', tempUnit)}]`}
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
                          <label style={lblStyle}>
                            {isEn ? 'Heat Duty Q (Cooling = -)' : '지정 열부하 Q (냉각 음수 -)'}
                          </label>
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
                    </div>

                    {/* Line 2: ② 유틸리티 선택 */}
                    <div>
                      <label style={lblStyle}>
                        {isEn ? '② Utility / Refrigerant Selection' : '② 유틸리티 선택 (냉매 · 열매)'}
                      </label>
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
                            {isEn ? REFRIGERANT_PRESET_LABELS_EN[rk] : REFRIGERANT_PRESETS[rk].label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Line 3: ③ 공정 운전 압력 */}
                    <div>
                      <label style={lblStyle}>
                        {isEn ? '③ Process Operating Pressure' : '③ 공정 운전 압력'}
                      </label>
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
                </div>

                {/* 고급 열수지 · 유틸리티 세부 설정 (Custom 선택 시 자동 펼침) */}
                <details
                  open={thermalAdvOpen}
                  onToggle={(e) => setThermalAdvOpen(e.currentTarget.open)}
                  style={cardBox}
                >
                  <summary
                    style={{
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 900,
                      color: '#334155',
                      listStyle: 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      {isEn
                        ? '⚙ Advanced Utility & Fouling Settings ▾'
                        : '⚙ 고급 열수지 · 유틸리티 세부 설정 ▾'}
                    </span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: '#64748B', fontFamily: MONO }}>
                      {refKey === 'custom'
                        ? (isEn ? 'Custom Active' : '사용자 지정 활성')
                        : `Rf ${(dRes.processSide.foulingM2HKcal).toFixed(4)}`}
                    </span>
                  </summary>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 9,
                      marginTop: 9,
                      paddingTop: 9,
                      borderTop: '1px dashed #E2E8F0',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={lblStyle}>{isEn ? 'Utility Inlet Temp' : '유틸리티 입구 온도'}</label>
                        <UnitNumberInput
                          quantity="temp"
                          unitId={tempUnit}
                          onUnitChange={setTempUnit}
                          syncKey={`${unitTag}-ut-in`}
                          value={
                            refKey === 'custom'
                              ? (params.utilInTempC ?? 20)
                              : Number(dRes.utilitySide.inTempC.toFixed(1))
                          }
                          onValueChange={(v) =>
                            onChangeParams({
                              refrigerantPreset: 'custom',
                              utilInTempC: v,
                              utilOutTempC:
                                params.utilOutTempC ?? Number(dRes.utilitySide.outTempC.toFixed(1)),
                              utilCp: params.utilCp ?? Number(dRes.utilitySide.cpKcalKgC.toFixed(3)),
                            })
                          }
                          onEnterRun={triggerRun}
                          inputStyle={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>{isEn ? 'Utility Outlet Temp' : '유틸리티 출구 온도'}</label>
                        <UnitNumberInput
                          quantity="temp"
                          unitId={tempUnit}
                          onUnitChange={setTempUnit}
                          syncKey={`${unitTag}-ut-out`}
                          value={
                            refKey === 'custom'
                              ? (params.utilOutTempC ?? 30)
                              : Number(dRes.utilitySide.outTempC.toFixed(1))
                          }
                          onValueChange={(v) =>
                            onChangeParams({
                              refrigerantPreset: 'custom',
                              utilInTempC:
                                params.utilInTempC ?? Number(dRes.utilitySide.inTempC.toFixed(1)),
                              utilOutTempC: v,
                              utilCp: params.utilCp ?? Number(dRes.utilitySide.cpKcalKgC.toFixed(3)),
                            })
                          }
                          onEnterRun={triggerRun}
                          inputStyle={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>{isEn ? 'Utility Specific Heat Cp' : '유틸리티 비열 Cp'}</label>
                        <UnitNumberInput
                          quantity="cp"
                          unitId={cpUnit}
                          onUnitChange={setCpUnit}
                          syncKey={`${unitTag}-ut-cp`}
                          minCanonical={0.1}
                          value={
                            refKey === 'custom'
                              ? (params.utilCp ?? 1.0)
                              : Number(dRes.utilitySide.cpKcalKgC.toFixed(3))
                          }
                          onValueChange={(v) =>
                            onChangeParams({
                              refrigerantPreset: 'custom',
                              utilInTempC:
                                params.utilInTempC ?? Number(dRes.utilitySide.inTempC.toFixed(1)),
                              utilOutTempC:
                                params.utilOutTempC ?? Number(dRes.utilitySide.outTempC.toFixed(1)),
                              utilCp: Math.max(0.1, v),
                            })
                          }
                          onEnterRun={triggerRun}
                          inputStyle={inpStyle}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={lblStyle}>
                          {isEn
                            ? 'Process Fouling Rf (m²·h·°C/kcal)'
                            : '공정측 오염계수 Rf (m²·h·°C/kcal)'}
                        </label>
                        <BufferedNumberInput
                          syncKey={`${unitTag}-hx-rf-proc`}
                          step={0.0001}
                          min={0}
                          max={0.01}
                          value={
                            hxCfg.foulingProcM2HKcal ??
                            Number(dRes.processSide.foulingM2HKcal.toFixed(5))
                          }
                          onValueChange={(v) => patchHxCfg({ foulingProcM2HKcal: Math.max(0, v) })}
                          style={inpStyle}
                        />
                      </div>
                      <div>
                        <label style={lblStyle}>
                          {isEn
                            ? 'Utility Fouling Rf (m²·h·°C/kcal)'
                            : '유틸리티측 오염계수 Rf (m²·h·°C/kcal)'}
                        </label>
                        <BufferedNumberInput
                          syncKey={`${unitTag}-hx-rf-util`}
                          step={0.0001}
                          min={0}
                          max={0.01}
                          value={
                            hxCfg.foulingUtilM2HKcal ??
                            Number(dRes.utilitySide.foulingM2HKcal.toFixed(5))
                          }
                          onValueChange={(v) => patchHxCfg({ foulingUtilM2HKcal: Math.max(0, v) })}
                          style={inpStyle}
                        />
                      </div>
                    </div>
                  </div>
                </details>

                {/* 상변화 3-Zone 분해 요약 (응축/액화 발생 시) */}
                {dRes.latentDutyMcalH > 0.05 && (
                  <div style={cardBox}>
                    <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>
                      {isEn
                        ? `Phase-Change 3-Zone Duty Breakdown (Dew Pt ${dRes.dewPointC !== null ? `${formatCanonicalValue('temp', dRes.dewPointC, tempUnit, 1)} ${getUnitLabel('temp', tempUnit)}` : '—'} · Condensed ${formatCanonicalValue('massFlow', dRes.processSide.phaseChangeMassKgH, massUnit)} ${getUnitLabel('massFlow', massUnit)})`
                        : `상변화 3-구간 열부하 분해 (이슬점 ${dRes.dewPointC !== null ? `${formatCanonicalValue('temp', dRes.dewPointC, tempUnit, 1)} ${getUnitLabel('temp', tempUnit)}` : '—'} · 응축/액화량 ${formatCanonicalValue('massFlow', dRes.processSide.phaseChangeMassKgH, massUnit)} ${getUnitLabel('massFlow', massUnit)})`}
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
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                          {isEn ? '① Desuperheating' : '① 과열가스 냉각'}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {formatCanonicalValue('heatDuty', dRes.desupDutyMcalH, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)}
                        </div>
                      </div>
                      <div style={{ background: '#F8FAFC', padding: '6px 8px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                          {isEn ? '② Latent Condensation' : '② 잠열 응축·액화'}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: '#1E3A8A', marginTop: 2 }}>
                          {formatCanonicalValue('heatDuty', dRes.latentDutyMcalH, dutyUnit)} {getUnitLabel('heatDuty', dutyUnit)}
                        </div>
                      </div>
                      <div style={{ background: '#F8FAFC', padding: '6px 8px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                          {isEn ? '③ Condensate Subcooling' : '③ 응축액 과냉각'}
                        </div>
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
                    {isEn ? 'Process vs. Utility Heat Balance & Thermophysical Properties' : '양측 유체 열수지 및 대표 열물성 비교'}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
                        <th style={{ padding: '5px 7px', textAlign: 'left' }}>{isEn ? 'Parameter' : '항목'}</th>
                        <th style={{ padding: '5px 7px', textAlign: 'right' }}>{isEn ? 'Process Side' : '공정측 (Process)'}</th>
                        <th style={{ padding: '5px 7px', textAlign: 'right' }}>{isEn ? 'Utility Side' : '유틸리티측 (Utility)'}</th>
                      </tr>
                    </thead>
                    <tbody style={{ fontFamily: MONO }}>
                      <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '4px 7px', fontFamily: 'inherit', fontWeight: 700 }}>
                          {isEn ? 'Fluid / Phase Regime' : '유체 / 상거동'}
                        </td>
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
                            {isEn ? 'Mass Flow' : '질량유량'}
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
                            {isEn ? 'Inlet → Outlet Temp' : '입구 → 출구 온도'}
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
                            {isEn ? 'Density' : '밀도'} <UnitSelect quantity="density" value={densUnit} onChange={setDensUnit} /> / {isEn ? 'Viscosity' : '점도'} <UnitSelect quantity="viscosity" value={viscUnit} onChange={setViscUnit} />
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
                            {isEn ? 'Conductivity (W/m·K) / Cp' : '열전도도 (W/m·K) / 비열'} <UnitSelect quantity="cp" value={cpUnit} onChange={setCpUnit} />
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
                    {isEn
                      ? 'Countercurrent T-Q Temperature Profile & Pinch Diagram'
                      : '향류 T-Q 열교환 온도 프로파일 & 핀치(Pinch) 선도'}
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
                    {isEn ? 'Go to Sizing & CAD →' : '기하 사이징 · 도면 설계로 이동 →'}
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
                      <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                        {isEn ? 'Heat Duty Q' : '총 교환열량 Q'}
                      </span>
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
                      <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                        {isEn ? 'Effective CMTD' : '유효 온도차 CMTD'}
                      </span>
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
                      <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                        {isEn ? 'Calculated U' : '산출 총괄 U'}
                      </span>
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
                      <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                        {isEn ? 'Design Area A' : '설계 전열면적 A'}
                      </span>
                      <UnitSelect quantity="area" value={areaUnit} onChange={setAreaUnit} />
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                      {formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)}
                    </div>
                    <div style={{ fontSize: 9.5, color: '#475569' }}>
                      {isEn ? 'Req' : '요구'} {formatCanonicalValue('area', dRes.areaReqM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)} (+{dRes.actualOverdesignPct.toFixed(0)}%)
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
                      <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 700 }}>
                        {isEn ? 'Heat Duty Q' : '열부하 Q'}
                      </span>
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
                      <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 700 }}>
                        {isEn ? 'Heat Transfer Area' : '전열면적'}
                      </span>
                      <UnitSelect quantity="area" value={areaUnit} onChange={setAreaUnit} />
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 900, color: '#1E3A8A' }}>
                      {formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)} {getUnitLabel('area', areaUnit)}
                    </div>
                    <div style={{ fontSize: 9, color: '#64748B' }}>+{dRes.actualOverdesignPct.toFixed(0)}%</div>
                  </div>
                  <div style={cardBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 9.5, color: '#64748B', fontWeight: 700 }}>
                        {isEn ? 'Max ΔP' : '최대 ΔP'}
                      </span>
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
                        {isEn ? '⚠ ΔP · Vibration · Temp Cross Check' : '⚠ 차압 · 진동 · 온도교차 점검'}
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
                        {isAiBusy
                          ? (aiStepLabel || (isEn ? '⏳ Optimizing...' : '⏳ 최적화 중...'))
                          : (isEn ? '✨ AI Auto-Fix' : '✨ AI 자동 해결')}
                      </button>
                    </div>
                    {dRes.dpTubeBar > 0.7 && (
                      <div style={{ color: '#991B1B' }}>
                        {isEn ? (
                          <>• Tube ΔP={dRes.dpTubeBar.toFixed(2)} bar exceeded → <b>Reduce passes</b> (4→2→1P) or <b>shorten length / increase OD</b> (ΔP ∝ N³·L)</>
                        ) : (
                          <>• 관측 ΔP={dRes.dpTubeBar.toFixed(2)} bar 초과 → <b>패스 수 감소</b>(4→2→1패스) 또는 <b>관길이 단축·외경 확대</b> 필요 (ΔP ∝ N³·L)</>
                        )}
                      </div>
                    )}
                    {dRes.dpShellBar > 0.7 && (
                      <div style={{ color: '#92400E' }}>
                        {isEn ? (
                          <>• Shell ΔP={dRes.dpShellBar.toFixed(2)} bar exceeded → <b>Increase baffle spacing ratio (B/Ds)</b> or <b>increase baffle cut (%)</b></>
                        ) : (
                          <>• 동체 ΔP={dRes.dpShellBar.toFixed(2)} bar 초과 → <b>배플 간격비(B/Ds) 확대</b> 또는 <b>배플 컷(%) 상향</b> 필요</>
                        )}
                      </div>
                    )}
                    {dRes.ftFactor < 0.78 && (
                      <div style={{ color: '#991B1B' }}>
                        {isEn ? (
                          <>• Low Ft={dRes.ftFactor.toFixed(2)} → <b>Add shells in series (2+)</b> or switch to <b>1-pass countercurrent</b></>
                        ) : (
                          <>• Ft={dRes.ftFactor.toFixed(2)} 저하 → <b>직렬 동체 수(2기 이상)</b> 증가 또는 <b>1패스 향류</b> 전환</>
                        )}
                      </div>
                    )}
                    {dRes.vibRatio > 0.8 && (
                      <div style={{ color: '#92400E' }}>
                        {isEn ? (
                          <>• Vortex FIV ratio {dRes.vibRatio.toFixed(2)} ≥ 0.80 → <b>Adjust baffle spacing / tube pitch (45°/90°)</b></>
                        ) : (
                          <>• 와류진동비 {dRes.vibRatio.toFixed(2)} ≥ 0.80 → <b>배플 간격·튜브 피치(45°/90°)</b> 완화</>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 3-Line 핵심 기하 입력 전면 뷰 (① 형식 · ② 재질 · ③ 핵심 규격) */}
                <div style={cardBox}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {/* Line 1: ① 형식 */}
                    <div>
                      <label style={lblStyle}>
                        {isEn ? '① Equipment Type' : '① 열교환기 형식'}
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        {(
                          [
                            { id: 'shell_tube', label: isEn ? 'Shell & Tube (TEMA)' : '다관원통형 (TEMA)' },
                            { id: 'plate_phe', label: isEn ? 'Plate (PHE)' : '판형 (PHE)' },
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
                    </div>

                    {/* Line 2: ② 재질 */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <label style={{ ...lblStyle, marginBottom: 0 }}>
                          {isEn ? '② Metallurgy' : '② 재질 (Metallurgy)'}
                        </label>
                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#1D4ED8' }}>
                          {isEn ? 'Recommended: ' : '추천: '}
                          {isEn
                            ? HX_MATERIAL_EN[dRes.recommendedMaterial].shortLabel
                            : HX_MATERIAL_CATALOG[dRes.recommendedMaterial].shortLabel}
                        </span>
                      </div>
                      <select
                        value={dRes.material.code}
                        onChange={(e) => patchHxCfg({ material: e.target.value as HxMaterialCode })}
                        style={selStyle}
                      >
                        {(Object.keys(HX_MATERIAL_CATALOG) as HxMaterialCode[]).map((mc) => (
                          <option key={mc} value={mc}>
                            {isEn ? HX_MATERIAL_EN[mc].label : HX_MATERIAL_CATALOG[mc].label} (k={HX_MATERIAL_CATALOG[mc].kwWmK})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Line 3: ③ 핵심 규격 */}
                    {dRes.hxKind === 'shell_tube' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={lblStyle}>
                            {isEn ? '③ Tube Passes' : '③ 패스 수 (Tube Passes)'}
                          </label>
                          <select
                            value={dRes.tubePasses}
                            onChange={(e) =>
                              patchHxCfg({ tubePasses: Number(e.target.value) as 1 | 2 | 4 | 6 })
                            }
                            style={selStyle}
                          >
                            <option value={1}>
                              {isEn ? '1 Pass (Countercurrent · Min ΔP)' : '1 패스 (향류 · 최저 ΔP)'}
                            </option>
                            <option value={2}>{isEn ? '2 Passes (Standard)' : '2 패스 (표준)'}</option>
                            <option value={4}>{isEn ? '4 Passes (High HTC)' : '4 패스 (고전열)'}</option>
                            <option value={6}>{isEn ? '6 Passes' : '6 패스'}</option>
                          </select>
                        </div>
                        <div>
                          <label style={lblStyle}>
                            {isEn ? 'Tube Length L' : '튜브 길이 L'}
                          </label>
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
                                { v: 3.66, note: isEn ? '12 ft Std' : '12 ft 표준' },
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
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={lblStyle}>
                            {isEn ? '③ Channel Gap b' : '③ 판 간격 b'}
                          </label>
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
                          <label style={lblStyle}>
                            {isEn ? 'Chevron Angle (β)' : '쉐브론 각도 (β)'}
                          </label>
                          <select
                            value={dRes.pheChevronDeg}
                            onChange={(e) =>
                              patchHxCfg({ pheChevronDeg: Number(e.target.value) as 30 | 45 | 60 })
                            }
                            style={selStyle}
                          >
                            <option value={30}>{isEn ? '30° (Low ΔP)' : '30° (저압손)'}</option>
                            <option value={45}>{isEn ? '45° (Standard)' : '45° (표준)'}</option>
                            <option value={60}>{isEn ? '60° (High Turbulence)' : '60° (고난류)'}</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 고급 TEMA / 기하 사양 접힘 패널 (기본 닫힘) */}
                {dRes.hxKind === 'shell_tube' ? (
                  <details style={cardBox}>
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 900,
                        color: '#334155',
                        listStyle: 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        {isEn ? '⚙ Advanced TEMA / Geometry Specs ▾' : '⚙ 고급 TEMA / 기하 사양 ▾'}
                      </span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: '#64748B', fontFamily: MONO }}>
                        {dRes.temaType} · {dRes.shellCount}S · B/Ds {(hxCfg.baffleSpacingRatio ?? 0.45).toFixed(2)} · OD {dRes.tubeOdMm}mm
                      </span>
                    </summary>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                        marginTop: 9,
                        paddingTop: 9,
                        borderTop: '1px dashed #E2E8F0',
                      }}
                    >
                      <div>
                        <label style={lblStyle}>{isEn ? 'Baffle Spacing Ratio (B / Ds)' : '배플 간격비 (B / Ds)'}</label>
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
                        <label style={lblStyle}>{isEn ? 'Shells in Series' : '직렬 동체 수 (Shells)'}</label>
                        <select
                          value={dRes.shellCount}
                          onChange={(e) => patchHxCfg({ shellCount: Number(e.target.value) })}
                          style={selStyle}
                        >
                          <option value={1}>{isEn ? '1 Shell (Single)' : '1기 (단독)'}</option>
                          <option value={2}>{isEn ? '2 Shells in Series' : '직렬 2기'}</option>
                          <option value={3}>{isEn ? '3 Shells in Series' : '직렬 3기'}</option>
                          <option value={4}>{isEn ? '4 Shells in Series' : '직렬 4기'}</option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>{isEn ? 'Baffle Cut (%)' : '배플 컷 (%)'}</label>
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
                        <label style={lblStyle}>{isEn ? 'Tube OD' : '튜브 외경 OD'}</label>
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
                        <label style={lblStyle}>{isEn ? 'Tube Layout Angle' : '배열각'}</label>
                        <select
                          value={dRes.pitchAngle}
                          onChange={(e) => patchHxCfg({ pitchAngle: Number(e.target.value) as TubeLayoutAngle })}
                          style={selStyle}
                        >
                          <option value={30}>{isEn ? '30° Triangular' : '30° 삼각'}</option>
                          <option value={90}>{isEn ? '90° Square' : '90° 사각'}</option>
                          <option value={45}>{isEn ? '45° Rotated Square' : '45° 회전'}</option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>{isEn ? 'Design / Rating Mode' : '정격 / 설계 모드'}</label>
                        <select
                          value={hxCfg.designMode ?? 'design'}
                          onChange={(e) =>
                            patchHxCfg({ designMode: e.target.value as 'design' | 'rating' })
                          }
                          style={selStyle}
                        >
                          <option value="design">
                            {isEn ? 'Design Mode (Auto-Size)' : '설계 모드 (Design · 자동 사이징)'}
                          </option>
                          <option value="rating">
                            {isEn ? 'Rating Mode (Fixed Geometry)' : '정격 모드 (Rating · 기존 기하 평가)'}
                          </option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>{isEn ? 'TEMA Type' : 'TEMA 형식'}</label>
                        <select
                          value={dRes.temaType}
                          onChange={(e) => patchHxCfg({ temaType: e.target.value as TemaConfiguration })}
                          style={selStyle}
                        >
                          <option value="BEM">{isEn ? 'BEM (Fixed Tubesheet)' : 'BEM (고정관판식)'}</option>
                          <option value="AES">{isEn ? 'AES (Floating Head)' : 'AES (유동두식)'}</option>
                          <option value="BKM">{isEn ? 'BKM (Kettle Reboiler)' : 'BKM (케틀형)'}</option>
                          <option value="BEU">{isEn ? 'BEU (U-Tube)' : 'BEU (U-튜브식)'}</option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>{isEn ? 'Fluid Allocation' : '유체 배치'}</label>
                        <select
                          value={dRes.allocation}
                          onChange={(e) => patchHxCfg({ allocation: e.target.value as HxTubeAllocation })}
                          style={selStyle}
                        >
                          <option value="process_tube">
                            {isEn ? 'Process = Tube / Utility = Shell' : '공정=Tube / 열매=Shell'}
                          </option>
                          <option value="process_shell">
                            {isEn ? 'Process = Shell / Utility = Tube' : '공정=Shell / 열매=Tube'}
                          </option>
                        </select>
                      </div>
                      <div>
                        <label style={lblStyle}>{isEn ? 'Design Margin (%)' : '설계 여유율 (%)'}</label>
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
                    <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 6 }}>
                      {isEn ? HX_MATERIAL_EN[dRes.material.code].serviceNote : dRes.material.serviceNote}
                    </div>
                  </details>
                ) : (
                  <details style={cardBox}>
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 900,
                        color: '#334155',
                        listStyle: 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        {isEn ? '⚙ Advanced PHE Geometry Specs ▾' : '⚙ 고급 PHE / 기하 사양 ▾'}
                      </span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: '#64748B', fontFamily: MONO }}>
                        W {(hxCfg.phePlateWidthM ?? 0.55).toFixed(2)}m × L {(hxCfg.phePlateLengthM ?? 1.45).toFixed(2)}m
                      </span>
                    </summary>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                        marginTop: 9,
                        paddingTop: 9,
                        borderTop: '1px dashed #E2E8F0',
                      }}
                    >
                      <div>
                        <label style={lblStyle}>{isEn ? 'Effective Plate Width W' : '유효 판폭 W'}</label>
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
                        <label style={lblStyle}>{isEn ? 'Effective Plate Length L' : '유효 판길이 L'}</label>
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
                      <div>
                        <label style={lblStyle}>{isEn ? 'Design Margin (%)' : '설계 여유율 (%)'}</label>
                        <BufferedNumberInput
                          syncKey={`${unitTag}-phe-margin`}
                          step={5}
                          min={0}
                          max={50}
                          value={hxCfg.designMarginPct ?? 15}
                          onValueChange={(v) => patchHxCfg({ designMarginPct: v })}
                          style={inpStyle}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 6 }}>
                      {isEn ? HX_MATERIAL_EN[dRes.material.code].serviceNote : dRes.material.serviceNote}
                    </div>
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
                    {isEn ? '✓ Apply U & Re-Run' : '✓ U값 반영 후 재실행'}
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
                      { id: 'cad', label: isEn ? 'Conceptual Section (CAD)' : '개념설계 단면도 (CAD)' },
                      { id: 'hydraulics', label: isEn ? 'Thermal, ΔP & Vibration Check' : '열저항 · 압력손실 · 진동 검증' },
                      { id: 'datasheet', label: isEn ? 'Nozzle Schedule & Spec Sheet' : '노즐 스케줄 · 제작 사양서' },
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
                            {dRes.hxKind === 'plate_phe'
                              ? (isEn ? 'Plate Count' : '전열판 매수')
                              : (isEn ? 'Shell ID D_s' : '동체 내경 D_s')}
                          </span>
                          {dRes.hxKind !== 'plate_phe' && (
                            <UnitSelect quantity="length" value={lenUnit} onChange={setLenUnit} />
                          )}
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {dRes.hxKind === 'plate_phe'
                            ? (isEn ? `${dRes.phePlateCount} ea` : `${dRes.phePlateCount} 매`)
                            : `Ø${formatCanonicalValue('length', dRes.shellIdMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)}`}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#475569' }}>
                          {dRes.hxKind === 'plate_phe'
                            ? (isEn ? `Channels ${dRes.pheChannelsPerSide}×2` : `채널 ${dRes.pheChannelsPerSide}×2`)
                            : `${isEn ? 'Bundle' : '번들'} Ø${formatCanonicalValue('length', dRes.bundleDiaMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)}`}
                        </div>
                      </div>
                      <div style={cardBox}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                          {dRes.hxKind === 'plate_phe'
                            ? (isEn ? 'Compressed Pack L' : '압축 팩 길이')
                            : (isEn ? 'Tube Count / Shell' : '튜브 수량 / 동체')}
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {dRes.hxKind === 'plate_phe'
                            ? `${formatCanonicalValue('length', dRes.phePackLengthMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)}`
                            : (isEn ? `${dRes.tubeCountPerShell} ea` : `${dRes.tubeCountPerShell} 본`)}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#475569' }}>
                          {dRes.hxKind === 'plate_phe'
                            ? (isEn ? `Gap ${dRes.pheGapMm} mm` : `간격 ${dRes.pheGapMm} mm`)
                            : (isEn
                                ? `${dRes.tubePasses}P · L=${formatCanonicalValue('length', dRes.tubeLengthM, lenUnit, 2)}${getUnitLabel('length', lenUnit)}`
                                : `${dRes.tubePasses}패스 · L=${formatCanonicalValue('length', dRes.tubeLengthM, lenUnit, 2)}${getUnitLabel('length', lenUnit)}`)}
                        </div>
                      </div>
                      <div style={cardBox}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                          <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                            {isEn ? 'Tube / Shell ΔP' : '관측 / 동체 압손'}
                          </span>
                          <UnitSelect quantity="deltaP" value={dpUnit} onChange={setDpUnit} />
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                          {formatCanonicalValue('deltaP', dRes.dpTubeBar * BAR_TO_KGCM2, dpUnit, 2)} / {formatCanonicalValue('deltaP', dRes.dpShellBar * BAR_TO_KGCM2, dpUnit, 2)}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#475569' }}>
                          {getUnitLabel('deltaP', dpUnit)} ({isEn ? 'Limit' : '권장'} ≤ {formatCanonicalValue('deltaP', 0.7 * BAR_TO_KGCM2, dpUnit, 2)})
                        </div>
                      </div>
                      <div style={cardBox}>
                        <div style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                          {isEn ? 'Vortex Vibration FIV' : '와류 진동비 FIV'}
                        </div>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 900,
                            color: dRes.vibRatio >= 0.8 ? '#92400E' : '#166534',
                            marginTop: 2,
                          }}
                        >
                          {dRes.hxKind === 'plate_phe' ? (isEn ? 'N/A' : '해당없음') : dRes.vibRatio.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 9.5, color: '#475569' }}>
                          {dRes.hxKind === 'plate_phe'
                            ? (isEn ? 'Plate Contact Support' : '판형 밀착지지')
                            : (isEn ? 'Safe Limit < 0.80' : '안전기준 < 0.80')}
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
                          {isEn
                            ? 'Film & Overall Heat Transfer Coefficient Breakdown'
                            : '막열전달계수 & 총괄 열전달계수 산출 내역'}
                        </span>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>U/h</span>
                          <UnitSelect quantity="htc" value={htcUnit} onChange={setHtcUnit} />
                          <span style={{ fontSize: 9.8, color: '#64748B', fontWeight: 700 }}>
                            {isEn ? 'Vel' : '유속'}
                          </span>
                          <UnitSelect quantity="velocity" value={velUnit} onChange={setVelUnit} />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: MONO, fontSize: 11 }}>
                        <div style={{ background: '#F8FAFC', padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                          <div style={{ color: '#64748B', fontSize: 10 }}>
                            {isEn ? 'Tube (Ch. A) Film Coeff. h_i' : '관측(유로A) 막계수 h_i'}
                          </div>
                          <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                            {formatCanonicalValue('htc', dRes.hTubeWm2K * WM2K_TO_KCALM2HC, htcUnit, 0)} {getUnitLabel('htc', htcUnit)}
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>
                            {isEn ? 'Vel' : '유속'} {formatCanonicalValue('velocity', dRes.velTubeMs, velUnit, 2)} {getUnitLabel('velocity', velUnit)} · Re = {dRes.reTube.toFixed(0)}
                          </div>
                        </div>
                        <div style={{ background: '#F8FAFC', padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                          <div style={{ color: '#64748B', fontSize: 10 }}>
                            {isEn ? 'Shell (Ch. B) Film Coeff. h_o' : '동체(유로B) 막계수 h_o'}
                          </div>
                          <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                            {formatCanonicalValue('htc', dRes.hShellWm2K * WM2K_TO_KCALM2HC, htcUnit, 0)} {getUnitLabel('htc', htcUnit)}
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>
                            {isEn ? 'Vel' : '유속'} {formatCanonicalValue('velocity', dRes.velShellMs, velUnit, 2)} {getUnitLabel('velocity', velUnit)} · Re = {dRes.reShell.toFixed(0)}
                          </div>
                        </div>
                        <div style={{ background: '#F8FAFC', padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                          <div style={{ color: '#64748B', fontSize: 10 }}>
                            {isEn ? 'Clean Overall U_clean' : '청정 총괄 U_clean'}
                          </div>
                          <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                            {formatCanonicalValue('htc', dRes.uCleanWm2K * WM2K_TO_KCALM2HC, htcUnit, 0)} {getUnitLabel('htc', htcUnit)}
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>({dRes.uCleanWm2K.toFixed(0)} W/m²·K)</div>
                        </div>
                        <div style={{ background: '#EFF6FF', padding: '8px 10px', borderRadius: 6, border: '1px solid #BFDBFE' }}>
                          <div style={{ color: '#1E3A8A', fontSize: 10, fontWeight: 800 }}>
                            {isEn ? 'Fouled Design U_design' : '오염반영 설계 U_design'}
                          </div>
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
                          {isEn
                            ? `Pressure Drop (ΔP ≤ ${formatCanonicalValue('deltaP', 0.7 * BAR_TO_KGCM2, dpUnit, 2)} ${getUnitLabel('deltaP', dpUnit)}) & TEMA RCB-V Vibration (FIV) Gauges`
                            : `압력손실(ΔP ≤ ${formatCanonicalValue('deltaP', 0.7 * BAR_TO_KGCM2, dpUnit, 2)} ${getUnitLabel('deltaP', dpUnit)}) 및 TEMA RCB-V 진동(FIV) 검증 게이지`}
                        </span>
                        <UnitSelect quantity="deltaP" value={dpUnit} onChange={setDpUnit} />
                      </div>
                      {[
                        {
                          label: isEn
                            ? `${dRes.hxKind === 'plate_phe' ? 'Channel A' : 'Tube Side'} Pressure Drop`
                            : `${dRes.hxKind === 'plate_phe' ? '유로 A' : '관측(Tube)'} 압력손실`,
                          val: dRes.dpTubeBar,
                          limit: 0.7,
                          dangerAt: 0.7,
                          isDp: true,
                          subText: '',
                        },
                        {
                          label: isEn
                            ? `${dRes.hxKind === 'plate_phe' ? 'Channel B' : 'Shell Side'} Pressure Drop`
                            : `${dRes.hxKind === 'plate_phe' ? '유로 B' : '동체(Shell)'} 압력손실`,
                          val: dRes.dpShellBar,
                          limit: 0.7,
                          dangerAt: 0.7,
                          isDp: true,
                          subText: '',
                        },
                        ...(dRes.hxKind === 'shell_tube'
                          ? [
                              {
                                label: isEn
                                  ? `① Vortex Shedding Ratio (f_vs=${(dRes.vibration?.vortexFreqHz ?? dRes.vortexFreqHz).toFixed(1)}Hz / f_n=${(dRes.vibration?.naturalFreqHz ?? dRes.naturalFreqHz).toFixed(1)}Hz)`
                                  : `① 와류 방출 진동비 Vortex Shedding (f_vs=${(dRes.vibration?.vortexFreqHz ?? dRes.vortexFreqHz).toFixed(1)}Hz / f_n=${(dRes.vibration?.naturalFreqHz ?? dRes.naturalFreqHz).toFixed(1)}Hz)`,
                                val: dRes.vibration?.vortexRatio ?? dRes.vibRatio,
                                limit: 0.8,
                                dangerAt: 1.0,
                                isDp: false,
                                subText: '',
                              },
                              ...(dRes.vibration
                                ? [
                                    {
                                      label: isEn
                                        ? `② Connors Fluidelastic Instability (V=${dRes.velShellMs.toFixed(2)}m/s / V_c=${dRes.vibration.criticalVelMs.toFixed(2)}m/s)`
                                        : `② 유체탄성 불안정 Connors Fluidelastic (V=${dRes.velShellMs.toFixed(2)}m/s / V_c=${dRes.vibration.criticalVelMs.toFixed(2)}m/s)`,
                                      val: dRes.vibration.fluidelasticRatio,
                                      limit: 0.8,
                                      dangerAt: 1.0,
                                      isDp: false,
                                      subText: '',
                                    },
                                    {
                                      label:
                                        dRes.vibration.acousticFreqsHz.length > 0
                                          ? (isEn
                                              ? `③ Acoustic Resonance (f_vs=${dRes.vibration.vortexFreqHz.toFixed(1)}Hz / f_a1=${dRes.vibration.acousticFreqsHz[0].toFixed(1)}Hz)`
                                              : `③ 음향 공진 Acoustic Resonance (f_vs=${dRes.vibration.vortexFreqHz.toFixed(1)}Hz / f_a1=${dRes.vibration.acousticFreqsHz[0].toFixed(1)}Hz)`)
                                          : (isEn
                                              ? '③ Acoustic Resonance (Liquid / Non-resonant — N/A)'
                                              : '③ 음향 공진 Acoustic Resonance (액상/비공진 — 해당 없음)'),
                                      val: dRes.vibration.acousticRatio,
                                      limit: 0.8,
                                      dangerAt: 1.0,
                                      isDp: false,
                                      subText:
                                        dRes.vibration.acousticFreqsHz.length === 0
                                          ? (isEn ? 'N/A (Liquid)' : 'N/A (액상)')
                                          : dRes.vibration.acousticRisk
                                          ? (isEn ? '⚠ Resonance Band (±20%)' : '⚠ 공진대역 (±20%)')
                                          : 'OK',
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
                                  ? `${formatCanonicalValue('deltaP', g.val * BAR_TO_KGCM2, dpUnit, 2)} ${getUnitLabel('deltaP', dpUnit)} / ${isEn ? 'Limit' : '기준'} ${formatCanonicalValue('deltaP', g.limit * BAR_TO_KGCM2, dpUnit, 2)} ${getUnitLabel('deltaP', dpUnit)}`
                                  : g.subText && g.val === 0
                                  ? g.subText
                                  : `${g.val.toFixed(2)} / ${isEn ? 'Limit' : '기준'} ${g.limit.toFixed(2)}${g.subText ? ` (${g.subText})` : ''}`}
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
                                {isEn ? 'Sound Speed' : '음속'} c = {dRes.vibration.soundSpeedMs.toFixed(0)} m/s
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
                                ? { bg: '#FEF2F2', bd: '#FCA5A5', fg: '#991B1B', lbl: isEn ? 'Oversize Nozzle Req (OVERSIZE)' : '노즐 확관 필요 (OVERSIZE)' }
                                : rStatus === 'IMPINGEMENT_REQ'
                                ? { bg: '#FFFBEB', bd: '#FCD34D', fg: '#92400E', lbl: isEn ? 'Impingement Plate Required' : '충돌판 필수 (IMPINGEMENT PLATE REQ)' }
                                : { bg: '#DCFCE7', bd: '#86EFAC', fg: '#166534', lbl: isEn ? 'No Impingement Needed (OK)' : '충돌판 불필요 (OK)' };
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
                                {isEn
                                  ? `TEMA RCB-4.6 Nozzle ρv² = ${shIn?.rhoV2Pa ?? 0} Pa (Limit ${dRes.rhoV2LimitPa ?? shIn?.rhoV2LimitPa ?? 2230} Pa) · ${tone.lbl}`
                                  : `TEMA RCB-4.6 노즐 ρv² = ${shIn?.rhoV2Pa ?? 0} Pa (기준 ${dRes.rhoV2LimitPa ?? shIn?.rhoV2LimitPa ?? 2230} Pa) · ${tone.lbl}`}
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
                                {isEn
                                  ? `Boiling CHF (Dryout) [${dRes.chfCheck.status}] q"=${(dRes.chfCheck.heatFluxWm2 / 1000).toFixed(1)} / q_CHF=${(dRes.chfCheck.qChfBundleWm2 / 1000).toFixed(1)} kW/m² (Ratio ${dRes.chfCheck.chfRatio.toFixed(2)})`
                                  : `비등 CHF(Dryout) [${dRes.chfCheck.status}] q"=${(dRes.chfCheck.heatFluxWm2 / 1000).toFixed(1)} / q_CHF=${(dRes.chfCheck.qChfBundleWm2 / 1000).toFixed(1)} kW/m² (비율 ${dRes.chfCheck.chfRatio.toFixed(2)})`}
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
                          {isEn
                            ? 'Nozzle Schedule (Nozzle Sizing & Momentum ρv² Check — TEMA RCB-4.6)'
                            : '노즐 스케줄 (Nozzle Sizing & Momentum ρv² Check — TEMA RCB-4.6)'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
                            {isEn
                              ? `📥 Official ${dRes.hxKind === 'plate_phe' ? 'API 662' : 'TEMA'} Excel Datasheet (.xlsx)`
                              : `📥 공식 ${dRes.hxKind === 'plate_phe' ? 'API 662' : 'TEMA'} 엑셀 데이터시트 (.xlsx)`}
                          </button>
                          <button
                            type="button"
                            onClick={() => temaFileInputRef.current?.click()}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: '1px solid #0284C7',
                              background: '#F0F9FF',
                              color: '#0369A1',
                              fontSize: 10.8,
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            {isEn ? '📂 Import TEMA .xlsx' : '📂 TEMA .xlsx 가져오기'}
                          </button>
                          {temaImportNotice && (
                            <span
                              title={temaImportNotice.summary}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 6,
                                fontSize: 10.5,
                                fontWeight: 800,
                                background: temaImportNotice.isError ? '#FEF2F2' : '#DCFCE7',
                                color: temaImportNotice.isError ? '#991B1B' : '#166534',
                                border: temaImportNotice.isError
                                  ? '1px solid #FCA5A5'
                                  : '1px solid #86EFAC',
                              }}
                            >
                              {temaImportNotice.isError
                                ? `⚠ ${temaImportNotice.summary}`
                                : isEn
                                ? `✓ Imported ${temaImportNotice.count} TEMA items`
                                : `✓ TEMA 항목 ${temaImportNotice.count}건 불러옴`}
                            </span>
                          )}
                        </div>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: MONO }}>
                        <thead>
                          <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
                            <th style={{ padding: '5px 7px', textAlign: 'left' }}>Nozzle</th>
                            <th style={{ padding: '5px 7px', textAlign: 'left', fontFamily: 'inherit' }}>
                              {isEn ? 'Service' : '서비스 위치'}
                            </th>
                            <th style={{ padding: '5px 7px', textAlign: 'right' }}>
                              {isEn ? 'Size (DN / NPS)' : '규격 (DN / NPS)'}
                            </th>
                            <th style={{ padding: '5px 7px', textAlign: 'right' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {isEn ? 'Velocity' : '유속'} <UnitSelect quantity="velocity" value={velUnit} onChange={setVelUnit} />
                              </span>
                            </th>
                            <th style={{ padding: '5px 7px', textAlign: 'right' }}>ρv² (Pa)</th>
                            <th style={{ padding: '5px 7px', textAlign: 'center', fontFamily: 'inherit' }}>
                              {isEn ? 'Impingement (RCB-4.6)' : '충돌판 (RCB-4.6)'}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dRes.nozzles.map((nz) => {
                            const nStatus = nz.rhoV2Status ?? (nz.impingementRequired ? 'IMPINGEMENT_REQ' : 'OK');
                            const nBadge =
                              nStatus === 'OVERSIZE_NOZZLE'
                                ? { bg: '#FEF2F2', fg: '#991B1B', text: 'OVERSIZE' }
                                : nStatus === 'IMPINGEMENT_REQ'
                                ? { bg: '#FFFBEB', fg: '#92400E', text: isEn ? 'IMPINGEMENT REQ' : '충돌판 필수' }
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
                        {isEn
                          ? 'Heat Exchanger Equipment Specification Summary'
                          : '열교환기 개념설계 사양서 요약 (Equipment Specification Summary)'}
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <tbody>
                          {[
                            [isEn ? 'Equipment Tag / Service' : '기기 번호 / 명칭', `${unitTag} — ${unitLabel}`],
                            [
                              isEn ? 'Equipment Type' : '형식 규격',
                              dRes.hxKind === 'plate_phe'
                                ? (isEn
                                    ? `Gasketed Plate Heat Exchanger (Chevron ${dRes.pheChevronDeg}°)`
                                    : `가스켓 판형 열교환기 (Chevron ${dRes.pheChevronDeg}°)`)
                                : (isEn
                                    ? `TEMA ${dRes.temaType} Shell & Tube (${dRes.shellCount} Shell × ${dRes.tubePasses} Tube Pass)`
                                    : `TEMA ${dRes.temaType} 다관원통형 (${dRes.shellCount} Shell × ${dRes.tubePasses} Tube Pass)`),
                            ],
                            [
                              isEn ? 'Metallurgy' : '적용 주요 재질',
                              isEn ? HX_MATERIAL_EN[dRes.material.code].label : dRes.material.label,
                            ],
                            [
                              isEn ? 'Heat Duty Q' : '교환 열부하 Q',
                              `${formatCanonicalValue('heatDuty', dRes.dutyMcalH, dutyUnit)} ${getUnitLabel('heatDuty', dutyUnit)} (${dRes.dutyKW.toFixed(1)} kW)`,
                            ],
                            [
                              isEn ? 'Heat Transfer Area (Prov / Req)' : '전열 면적 (제공 / 요구)',
                              `${formatCanonicalValue('area', dRes.areaProvM2, areaUnit, 1)} ${getUnitLabel('area', areaUnit)} / ${formatCanonicalValue('area', dRes.areaReqM2, areaUnit, 1)} ${getUnitLabel('area', areaUnit)} (${isEn ? 'Overdesign' : '여유율'} +${dRes.actualOverdesignPct.toFixed(1)}%)`,
                            ],
                            [
                              isEn ? 'Effective ΔT / Overall U' : '유효 온도차 / 총괄 U',
                              `CMTD ${formatDeltaT(dRes.cmtdC, tempUnit)} · U = ${formatCanonicalValue('htc', dRes.uCalcKcalM2HC, htcUnit, 0)} ${getUnitLabel('htc', htcUnit)}`,
                            ],
                            [
                              isEn ? 'Principal Dimensions' : '기하 주요 치수',
                              dRes.hxKind === 'plate_phe'
                                ? (isEn
                                    ? `${formatCanonicalValue('length', dRes.phePlateWidthMm / 1000, lenUnit)}W × ${formatCanonicalValue('length', dRes.phePlateHeightMm / 1000, lenUnit)}H ${getUnitLabel('length', lenUnit)} × ${dRes.phePlateCount} plates (Pack ${formatCanonicalValue('length', dRes.phePackLengthMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)})`
                                    : `${formatCanonicalValue('length', dRes.phePlateWidthMm / 1000, lenUnit)}W × ${formatCanonicalValue('length', dRes.phePlateHeightMm / 1000, lenUnit)}H ${getUnitLabel('length', lenUnit)} × ${dRes.phePlateCount}매 (팩 ${formatCanonicalValue('length', dRes.phePackLengthMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)})`)
                                : (isEn
                                    ? `Shell ID Ø${formatCanonicalValue('length', dRes.shellIdMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)} · Tubes Ø${dRes.tubeOdMm}mm×${formatCanonicalValue('length', dRes.tubeLengthM, lenUnit, 2)}${getUnitLabel('length', lenUnit)} × ${dRes.tubeCountPerShell} ea · ${dRes.baffleCount} Baffles`
                                    : `동체 ID Ø${formatCanonicalValue('length', dRes.shellIdMm / 1000, lenUnit)} ${getUnitLabel('length', lenUnit)} · 튜브 Ø${dRes.tubeOdMm}mm×${formatCanonicalValue('length', dRes.tubeLengthM, lenUnit, 2)}${getUnitLabel('length', lenUnit)} × ${dRes.tubeCountPerShell}본 · 배플 ${dRes.baffleCount}단`),
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

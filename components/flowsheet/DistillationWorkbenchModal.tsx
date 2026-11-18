'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import BufferedNumberInput from '@/components/common/BufferedNumberInput';
import ColumnInternalsDesignPanel from '@/components/flowsheet/ColumnInternalsDesignPanel';
import {
  resolveEffectiveDofSlots,
  type DistillCalcMode,
  type DistillColumnParams,
  type DistillCondenserType,
  type DistillDesignCandidate,
  type DistillDesignSpec,
  type DistillDofSlotId,
  type DistillEndpointBasis,
  type DistillFeedInput,
  type DistillReboilerType,
  type DistillRefluxDesignMode,
  type DistillSideCutConfig,
  type DistillSolveResult,
  type DistillSpecMetric,
  type DistillSplitSpecType,
  type DistillStageInputBasis,
  type DistillThermoModel,
  type DistillTopSpecType,
  type SideCutPhase,
  type SideCutSpecType,
} from '@/lib/calculations/rigorousDistillation';
import {
  COMP_META,
  SIM_COMPS,
  type SimCompKey,
} from '@/lib/calculations/flowsheetSolver';
import { COMP_CATALOG_META } from '@/lib/calculations/componentCatalog';
import {
  autoFixDistillationSimulationAsync,
  fetchOptionalGeminiAdvice,
  type EquipmentAutoFixResult,
} from '@/lib/calculations/aiEquipmentAdvisor';

function formatCompOption(ck: SimCompKey): string {
  const formula = COMP_META[ck]?.formula ?? ck;
  const rawLabel = COMP_META[ck]?.label ?? ck;
  if (rawLabel.startsWith(`${formula} (`) && rawLabel.endsWith(')')) {
    const inner = rawLabel.slice(formula.length + 2, -1);
    return `${formula} · ${inner}`;
  }
  return rawLabel === formula ? formula : `${formula} · ${rawLabel}`;
}

function formatCompOptionWithBp(ck: SimCompKey): string {
  const base = formatCompOption(ck);
  const tb = COMP_CATALOG_META[ck]?.tbC;
  return typeof tb === 'number' && Number.isFinite(tb) ? `${base} (${tb.toFixed(1)}°C)` : base;
}

interface DistillationWorkbenchModalProps {
  open: boolean;
  onClose: () => void;
  unitTag: string;
  unitLabel: string;
  config: DistillColumnParams;
  feeds: DistillFeedInput[];
  result?: DistillSolveResult;
  isSimDirty?: boolean;
  initialView?: 'simulation' | 'internals';
  onRunSimulation?: () => void;
  onChangeConfig: (patch: Partial<DistillColumnParams>) => void;
  onOpenChemProDesign?: () => void;
}

type LeftTabId = 'specs' | 'tower' | 'pressure';
type RightChartId = 'comp' | 'temp' | 'traffic';

const DEFAULT_SPEC1: DistillDesignSpec = {
  enabled: false,
  streamTarget: 'distillate',
  component: 'ECH',
  metric: 'purity_wt_pct',
  targetValue: 99.9,
  varyParam: 'd_over_f',
  varyMin: 0.05,
  varyMax: 0.95,
};

const DEFAULT_SPEC2: DistillDesignSpec = {
  enabled: false,
  streamTarget: 'distillate',
  component: 'DCP',
  metric: 'impurity_wt_ppm',
  targetValue: 100,
  varyParam: 'reflux_ratio',
  varyMin: 0.5,
  varyMax: 15.0,
};

const SIDECUT_SPEC_OPTIONS: Array<{
  value: SideCutSpecType;
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
}> = [
  { value: 'mass_kgh', label: '질량유량 지정 S (kg/h)', unit: 'kg/h', step: 10, min: 0.1, max: 1_000_000 },
  { value: 's_over_f_mass', label: '공급 대비 질량분배비 S/F (wt/wt)', unit: 'wt/wt', step: 0.01, min: 0.005, max: 0.95 },
  { value: 's_over_f_mole', label: '공급 대비 몰분배비 S/F (mol/mol)', unit: 'mol/mol', step: 0.01, min: 0.005, max: 0.95 },
  { value: 'draw_ratio', label: '단 내부유량 대비 인출비 (Draw Ratio 0.01~0.85)', unit: 'ratio', step: 0.02, min: 0.01, max: 0.85 },
  { value: 'purity_wt_pct', label: '측류 목표 성분순도 (wt%) 역산', unit: 'wt%', step: 0.1, min: 0.1, max: 99.999 },
  { value: 'recovery_pct', label: '측류 목표 성분회수율 (%) 역산', unit: '%', step: 0.5, min: 1, max: 99.9 },
  { value: 'impurity_ppm', label: '측류 불순물 한계 (ppm) 역산', unit: 'ppm', step: 25, min: 1, max: 200_000 },
];

const SIDECUT_SPEC_META = Object.fromEntries(
  SIDECUT_SPEC_OPTIONS.map((opt) => [opt.value, opt])
) as Record<SideCutSpecType, (typeof SIDECUT_SPEC_OPTIONS)[number]>;

function defaultSideCutSpecValue(specType: SideCutSpecType, feedKgH: number): number {
  switch (specType) {
    case 'mass_kgh':
      return feedKgH > 0 ? Number((feedKgH * 0.15).toFixed(1)) : 100;
    case 's_over_f_mass':
    case 's_over_f_mole':
      return 0.15;
    case 'draw_ratio':
      return 0.25;
    case 'purity_wt_pct':
      return 95.0;
    case 'recovery_pct':
      return 85.0;
    case 'impurity_ppm':
      return 500;
  }
}

// 차분한 엔지니어링 차트 팔레트 (정상 곡선에서 오류로 오인되는 적색 #DC2626 배제)
const SERIES_COLORS = [
  '#1D4ED8',
  '#0D9488',
  '#D97706',
  '#6366F1',
  '#475569',
  '#0284C7',
];

const MONO = 'JetBrains Mono, monospace';

const inputBaseStyle: React.CSSProperties = {
  width: '100%',
  height: 31,
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#1A2F44',
  fontSize: 12,
  fontWeight: 700,
  fontFamily: MONO,
  boxSizing: 'border-box',
};

const selectBaseStyle: React.CSSProperties = {
  width: '100%',
  height: 31,
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#1A2F44',
  fontSize: 11.5,
  fontWeight: 700,
  boxSizing: 'border-box',
  cursor: 'pointer',
};

const cardStyle: React.CSSProperties = {
  padding: '11px 13px',
  borderRadius: 9,
  border: '1px solid #E5E2DC',
  background: '#FFFFFF',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 800,
  color: '#334155',
  marginBottom: 4,
};

function fmtConc(wtPct: number): string {
  if (wtPct <= 0) return '0.0 ppm';
  if (wtPct < 0.1) {
    const ppm = wtPct * 10000;
    return ppm >= 10 ? `${ppm.toFixed(1)} ppm` : `${ppm.toFixed(2)} ppm`;
  }
  return wtPct >= 99.9 ? `${wtPct.toFixed(3)} wt%` : `${wtPct.toFixed(2)} wt%`;
}

export default function DistillationWorkbenchModal({
  open,
  onClose,
  unitTag,
  unitLabel,
  config,
  feeds,
  result,
  isSimDirty = false,
  initialView = 'simulation',
  onRunSimulation,
  onChangeConfig,
}: DistillationWorkbenchModalProps) {
  const [workspaceView, setWorkspaceView] = useState<'simulation' | 'internals'>(initialView);
  const [leftTab, setLeftTab] = useState<LeftTabId>('specs');
  const [rightChart, setRightChart] = useState<RightChartId>('comp');
  const [logScalePpm, setLogScalePpm] = useState<boolean>(false);
  const [phaseBasis, setPhaseBasis] = useState<'liq' | 'vap'>('liq');
  const [isRunningFeedback, setIsRunningFeedback] = useState<boolean>(false);
  const [lastRunStamp, setLastRunStamp] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const [mobilePane, setMobilePane] = useState<'inputs' | 'results'>('inputs');
  const pushedHistoryRef = useRef<boolean>(false);
  const closedByPopStateRef = useRef<boolean>(false);

  const handleCloseModal = () => {
    if (pushedHistoryRef.current && !closedByPopStateRef.current && typeof window !== 'undefined') {
      pushedHistoryRef.current = false;
      window.history.back();
    }
    onClose();
  };

  useEffect(() => {
    const syncMob = () => {
      if (typeof window !== 'undefined') setIsMobile(window.innerWidth <= 768);
    };
    syncMob();
    window.addEventListener('resize', syncMob);
    return () => window.removeEventListener('resize', syncMob);
  }, []);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    closedByPopStateRef.current = false;
    window.history.pushState({ distillModalOpen: true }, '');
    pushedHistoryRef.current = true;
    const onPopState = () => {
      if (pushedHistoryRef.current) {
        closedByPopStateRef.current = true;
        pushedHistoryRef.current = false;
        onClose();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [open, onClose]);

  const onRunSimRef = useRef(onRunSimulation);
  onRunSimRef.current = onRunSimulation;
  const pendingAutoRunRef = useRef<boolean>(false);

  const triggerRunSimulation = () => {
    if (!onRunSimRef.current) return;
    setIsRunningFeedback(true);
    onRunSimRef.current();
    window.setTimeout(() => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      setLastRunStamp(`${hh}:${mm}:${ss}`);
      setIsRunningFeedback(false);
    }, 220);
  };

  useEffect(() => {
    if (!open || !pendingAutoRunRef.current) return;
    pendingAutoRunRef.current = false;
    triggerRunSimulation();
  }, [config, open]);

  const [isAiBusy, setIsAiBusy] = useState(false);
  const [aiStepLabel, setAiStepLabel] = useState('');
  const [aiReport, setAiReport] = useState<{
    result: EquipmentAutoFixResult<DistillColumnParams, DistillSolveResult>;
    geminiNote: string | null;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setWorkspaceView(initialView);
      setAiReport(null);
      setAiStepLabel('');
    }
  }, [open, initialView, unitTag]);

  const runAiAutoFixDistill = async () => {
    setIsAiBusy(true);
    setAiStepLabel('후보 조합 및 원인 분석 중...');
    setAiReport(null);
    try {
      const fix = await autoFixDistillationSimulationAsync(feeds, config, (step, total, label) => {
        setAiStepLabel(`(${step}/${total}) ${label}`);
      });
      if (Object.keys(fix.patch).length > 0) {
        onChangeConfig(fix.patch);
      }
      const prompt = `[증류탑 ${unitTag}] N=${fix.solvedAfter.totalStagesUsed}단, RR=${fix.solvedAfter.actualRefluxRatio.toFixed(2)}, D/F=${fix.solvedAfter.actualDOverFMass.toFixed(3)}, 상태=${fix.solvedAfter.diagnostics.badgeText}. 조치: ${fix.actionsTaken.join(', ')}`;
      const geminiNote = await fetchOptionalGeminiAdvice(prompt);
      setAiReport({ result: fix, geminiNote });
      if (Object.keys(fix.patch).length > 0 && onRunSimRef.current) {
        window.setTimeout(() => triggerRunSimulation(), 50);
      }
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
          solvedBefore: result ?? ({} as DistillSolveResult),
          solvedAfter: result ?? ({} as DistillSolveResult),
        },
        geminiNote: null,
      });
    } finally {
      setIsAiBusy(false);
      setAiStepLabel('');
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        if (dofEvaluation.canRun) triggerRunSimulation();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const totalFeedKgH = useMemo(
    () =>
      feeds.reduce(
        (acc, f) =>
          acc + SIM_COMPS.reduce((s, k) => s + (f.flowsKgH[k] || 0), 0),
        0
      ),
    [feeds]
  );

  const activeComps = useMemo(() => {
    const totals: { key: SimCompKey; maxWt: number }[] = SIM_COMPS.map((k) => {
      let maxWt = 0;
      if (result?.stages?.length) {
        for (const st of result.stages) {
          maxWt = Math.max(maxWt, st.xWtPct[k] || 0, st.yWtPct[k] || 0);
        }
      } else {
        for (const f of feeds) {
          maxWt = Math.max(maxWt, f.flowsKgH[k] || 0);
        }
      }
      return { key: k, maxWt };
    });
    const nonZero = totals
      .filter((t) => t.maxWt > 1e-5)
      .sort((a, b) => b.maxWt - a.maxWt)
      .slice(0, 6)
      .map((t) => t.key);
    return nonZero.length > 0 ? nonZero : (['HCl', 'H2O'] as SimCompKey[]);
  }, [feeds, result]);

  const { feedSortedComps, otherSortedComps } = useMemo(() => {
    const sortByTb = (a: SimCompKey, b: SimCompKey) =>
      (COMP_CATALOG_META[a]?.tbC ?? 999) - (COMP_CATALOG_META[b]?.tbC ?? 999);
    const feedTotals = new Map<SimCompKey, number>();
    for (const f of feeds) {
      for (const k of SIM_COMPS) {
        const flow = f.flowsKgH[k] || 0;
        if (flow > 1e-6) {
          feedTotals.set(k, (feedTotals.get(k) ?? 0) + flow);
        }
      }
    }
    const feedPresent: SimCompKey[] =
      feedTotals.size > 0
        ? SIM_COMPS.filter((k) => (feedTotals.get(k) ?? 0) > 1e-6).sort(sortByTb)
        : [...activeComps].sort(sortByTb);
    const feedSet = new Set(feedPresent);
    const others = SIM_COMPS.filter((k) => !feedSet.has(k)).sort(sortByTb);
    return { feedSortedComps: feedPresent, otherSortedComps: others };
  }, [feeds, activeComps]);

  const calcMode: DistillCalcMode = config.columnCalcMode ?? 'rigorous_mesh';
  const isFixedStages = calcMode !== 'design_stages';

  const getUiDofSlots = (cfg: DistillColumnParams): DistillDofSlotId[] => {
    if (Array.isArray(cfg.activeDofSlots)) {
      const uniq: DistillDofSlotId[] = [];
      for (const s of cfg.activeDofSlots) {
        if ((s === 'rr' || s === 'split' || s === 'top_spec' || s === 'bot_spec') && !uniq.includes(s)) {
          uniq.push(s);
        }
      }
      return uniq;
    }
    if ((cfg.columnCalcMode ?? 'rigorous_mesh') === 'design_stages') {
      const out: DistillDofSlotId[] = [];
      if (cfg.designRefluxMode === 'fixed_rr') out.push('rr');
      if (cfg.designOmitTopPurity && cfg.sideCut?.enabled) {
        out.push('bot_spec');
      } else {
        out.push('top_spec', 'bot_spec');
      }
      return out;
    }
    return resolveEffectiveDofSlots(cfg);
  };

  const selectedSlots = getUiDofSlots(config);

  const applyUnifiedConfigChange = (patch: Partial<DistillColumnParams>) => {
    const merged: DistillColumnParams = { ...config, ...patch };
    const nextCalcMode: DistillCalcMode = merged.columnCalcMode ?? 'rigorous_mesh';
    const nextIsFixed = nextCalcMode !== 'design_stages';
    const nextSlots = getUiDofSlots(merged);
    const hasRr = nextSlots.includes('rr');
    const hasTop = nextSlots.includes('top_spec');
    const hasBot = nextSlots.includes('bot_spec');
    const hasSide = Boolean(merged.sideCut?.enabled);

    const defLk = feedSortedComps[0] ?? activeComps[0] ?? 'ECH';
    const defHk =
      feedSortedComps.find((c) => c !== defLk) ??
      activeComps.find((c) => c !== defLk) ??
      defLk;

    const topMetric: DistillSpecMetric =
      merged.topQualityMetric ??
      (merged.designTopBasis as DistillSpecMetric | undefined) ??
      merged.spec1?.metric ??
      'purity_wt_pct';
    const topComp: SimCompKey =
      merged.topQualityComp ??
      (topMetric === 'impurity_wt_ppm' ? defHk : merged.designLkComp ?? defLk);
    const topTarget: number =
      merged.topQualityTarget ??
      (topMetric === 'impurity_wt_ppm'
        ? merged.designTopImpurityPpm ?? 500
        : topMetric === 'recovery_pct'
        ? merged.designTopRecoveryPct ?? 99.2
        : merged.designTopPurityWtPct ?? 99.5);

    const botMetric: DistillSpecMetric =
      merged.botQualityMetric ??
      (merged.designBotBasis as DistillSpecMetric | undefined) ??
      merged.spec2?.metric ??
      'purity_wt_pct';
    const botComp: SimCompKey =
      merged.botQualityComp ??
      (botMetric === 'impurity_wt_ppm' ? defLk : merged.designHkComp ?? defHk);
    const botTarget: number =
      merged.botQualityTarget ??
      (botMetric === 'impurity_wt_ppm'
        ? merged.designBotImpurityPpm ?? 500
        : botMetric === 'recovery_pct'
        ? merged.designBotRecoveryPct ?? 99.2
        : merged.designBotPurityWtPct ?? 99.0);

    let syncedLk = merged.designLkComp ?? defLk;
    if (hasTop && topMetric !== 'impurity_wt_ppm') {
      syncedLk = topComp;
    } else if (hasBot && botMetric === 'impurity_wt_ppm') {
      syncedLk = botComp;
    }
    let syncedHk = merged.designHkComp ?? defHk;
    if (hasBot && botMetric !== 'impurity_wt_ppm') {
      syncedHk = botComp;
    } else if (hasTop && topMetric === 'impurity_wt_ppm') {
      syncedHk = topComp;
    }
    if (syncedLk === syncedHk && feedSortedComps.length >= 2) {
      syncedHk = feedSortedComps.find((c) => c !== syncedLk) ?? syncedHk;
    }

    const syncedTopBasis: DistillEndpointBasis =
      topMetric === 'impurity_wt_ppm'
        ? 'impurity_wt_ppm'
        : topMetric === 'recovery_pct'
        ? 'recovery_pct'
        : 'purity_wt_pct';
    const syncedBotBasis: DistillEndpointBasis =
      botMetric === 'impurity_wt_ppm'
        ? 'impurity_wt_ppm'
        : botMetric === 'recovery_pct'
        ? 'recovery_pct'
        : 'purity_wt_pct';

    const syncedPatch: Partial<DistillColumnParams> = {
      ...patch,
      activeDofSlots: nextSlots,
      designLkComp: syncedLk,
      designHkComp: syncedHk,
      designTopBasis: syncedTopBasis,
      designBotBasis: syncedBotBasis,
      ...(syncedTopBasis === 'purity_wt_pct' ? { designTopPurityWtPct: topTarget } : {}),
      ...(syncedTopBasis === 'impurity_wt_ppm' ? { designTopImpurityPpm: topTarget } : {}),
      ...(syncedTopBasis === 'recovery_pct' ? { designTopRecoveryPct: topTarget } : {}),
      ...(syncedBotBasis === 'purity_wt_pct' ? { designBotPurityWtPct: botTarget } : {}),
      ...(syncedBotBasis === 'impurity_wt_ppm' ? { designBotImpurityPpm: botTarget } : {}),
      ...(syncedBotBasis === 'recovery_pct' ? { designBotRecoveryPct: botTarget } : {}),
    };

    if (!nextIsFixed) {
      syncedPatch.designOmitTopPurity = Boolean(hasSide && !hasTop);
      syncedPatch.designRefluxMode = hasRr
        ? 'fixed_rr'
        : merged.designRefluxMode === 'r_mult'
        ? 'r_mult'
        : 'auto_opt';
      if (hasRr) {
        syncedPatch.designFixedRR =
          (merged.topSpecType ?? 'reflux_ratio') === 'reflux_ratio'
            ? merged.topSpecValue ?? merged.designFixedRR ?? 2.8
            : merged.designFixedRR ?? 2.8;
      }
    } else {
      syncedPatch.designOmitTopPurity = false;
      syncedPatch.autoOptimizeStagesOnDualSpec = false;
    }

    onChangeConfig(syncedPatch);
  };

  const applyPatchAndRun = (patch: Partial<DistillColumnParams>) => {
    pendingAutoRunRef.current = true;
    applyUnifiedConfigChange(patch);
  };

  const toggleDofSlot = (slot: DistillDofSlotId) => {
    const nextSlots = selectedSlots.includes(slot)
      ? selectedSlots.filter((s) => s !== slot)
      : [...selectedSlots, slot];
    applyUnifiedConfigChange({ activeDofSlots: nextSlots });
  };

  const spec1: DistillDesignSpec = { ...DEFAULT_SPEC1, ...(config.spec1 ?? {}) };
  const spec2: DistillDesignSpec = { ...DEFAULT_SPEC2, ...(config.spec2 ?? {}) };

  const defLkGlobal = feedSortedComps[0] ?? activeComps[0] ?? 'ECH';
  const defHkGlobal =
    feedSortedComps.find((c) => c !== defLkGlobal) ??
    activeComps.find((c) => c !== defLkGlobal) ??
    defLkGlobal;

  const uiTopMetric: DistillSpecMetric =
    !isFixedStages && config.designTopBasis
      ? config.designTopBasis
      : config.topQualityMetric ?? spec1.metric ?? 'purity_wt_pct';
  const uiTopComp: SimCompKey =
    config.topQualityComp ??
    (!isFixedStages
      ? uiTopMetric === 'impurity_wt_ppm'
        ? config.designHkComp ?? defHkGlobal
        : config.designLkComp ?? defLkGlobal
      : uiTopMetric === 'impurity_wt_ppm'
      ? defHkGlobal
      : defLkGlobal);
  const uiTopTarget: number =
    !isFixedStages
      ? uiTopMetric === 'impurity_wt_ppm'
        ? config.designTopImpurityPpm ?? config.topQualityTarget ?? 500
        : uiTopMetric === 'recovery_pct'
        ? config.designTopRecoveryPct ?? config.topQualityTarget ?? 99.2
        : config.designTopPurityWtPct ?? config.topQualityTarget ?? 99.5
      : config.topQualityTarget ?? (uiTopMetric === 'impurity_wt_ppm' ? 200 : 99.5);

  const uiBotMetric: DistillSpecMetric =
    !isFixedStages && config.designBotBasis
      ? config.designBotBasis
      : config.botQualityMetric ?? spec2.metric ?? 'purity_wt_pct';
  const uiBotComp: SimCompKey =
    config.botQualityComp ??
    (!isFixedStages
      ? uiBotMetric === 'impurity_wt_ppm'
        ? config.designLkComp ?? defLkGlobal
        : config.designHkComp ?? defHkGlobal
      : uiBotMetric === 'impurity_wt_ppm'
      ? defLkGlobal
      : defHkGlobal);
  const uiBotTarget: number =
    !isFixedStages
      ? uiBotMetric === 'impurity_wt_ppm'
        ? config.designBotImpurityPpm ?? config.botQualityTarget ?? 500
        : uiBotMetric === 'recovery_pct'
        ? config.designBotRecoveryPct ?? config.botQualityTarget ?? 99.2
        : config.designBotPurityWtPct ?? config.botQualityTarget ?? 99.0
      : config.botQualityTarget ?? (uiBotMetric === 'impurity_wt_ppm' ? 200 : 99.0);

  const dofEvaluation = (() => {
    const hasRr = selectedSlots.includes('rr');
    const hasSplit = selectedSlots.includes('split');
    const hasTop = selectedSlots.includes('top_spec');
    const hasBot = selectedSlots.includes('bot_spec');
    const hasSide = Boolean(config.sideCut?.enabled);
    const mainCount = [hasRr, hasSplit, hasTop, hasBot].filter(Boolean).length;
    const sideCount = hasSide ? 1 : 0;
    const selectedCount = mainCount + sideCount;

    const activeLabels: string[] = [];
    if (hasRr) activeLabels.push('① 환류비');
    if (hasSplit) activeLabels.push('② 유량분할');
    if (hasTop) activeLabels.push('③ 탑정품질');
    if (hasBot) activeLabels.push('④ 탑저품질');
    if (hasSide) activeLabels.push('⑤ 사이드컷');

    const sameEndpointConflict =
      hasTop &&
      hasBot &&
      uiTopComp === uiBotComp &&
      uiTopMetric !== 'impurity_wt_ppm' &&
      uiBotMetric !== 'impurity_wt_ppm';

    if (isFixedStages) {
      const requiredCount = 2 + sideCount;
      if (mainCount > 2) {
        return {
          canRun: false,
          selectedCount,
          requiredCount,
          statusLevel: 'error' as const,
          headline: `⚠️ 자유도 초과 (${mainCount}/2) — 과다 구속`,
          hint: '고정 단수(⓪) 모드에서는 ①~④ 중 정확히 2개만 선택해야 합니다. 1개 이상 해제하거나 ⓪ 고정 단수를 해제하세요.',
        };
      }
      if (mainCount < 2) {
        let hint = '① 환류비, ② 유량분할, ③ 탑정순도, ④ 탑저순도 중 2개를 선택하세요.';
        if (mainCount === 0 && hasSide) {
          hint =
            '⑤ 사이드컷 선택 완료 → ① 환류비, ② 유량분할, ③ 탑정순도, ④ 탑저순도 중 2개를 선택하세요 (③ 없이 ①+④+⑤ 또는 ②+④+⑤ 가능).';
        } else if (hasSide && hasBot && !hasTop) {
          hint =
            '④ 탑저순도 + ⑤ 사이드컷 선택 완료 → 추가로 ① 환류비 또는 ② 유량분할 중 1개를 선택하면 ③ 탑정순도 없이 실행할 수 있습니다.';
        } else if (hasRr) {
          hint =
            '① 탑정 환류비 선택 완료 → 추가로 ② 유량분할 또는 ③ 탑정순도 또는 ④ 탑저순도 중 1개를 선택하면 실행할 수 있습니다.';
        } else if (hasSplit) {
          hint =
            '② 유량·분할 조건 선택 완료 → 추가로 ① 환류비 또는 ③ 탑정순도 또는 ④ 탑저순도 중 1개를 선택하면 실행할 수 있습니다.';
        } else if (hasTop) {
          hint =
            '③ 탑정순도 선택 완료 → 추가로 ① 환류비 또는 ② 유량분할 또는 ④ 탑저순도 중 1개를 선택하면 실행할 수 있습니다.';
        } else if (hasBot) {
          hint = hasSide
            ? '④ 탑저순도 + ⑤ 사이드컷 선택 완료 → 추가로 ① 환류비 또는 ② 유량분할 중 1개를 선택하면 ③ 탑정순도 없이 실행할 수 있습니다.'
            : '④ 탑저순도 선택 완료 → 추가로 ① 환류비 또는 ② 유량분할 또는 ③ 탑정순도 중 1개를 선택하면 실행할 수 있습니다.';
        }
        return {
          canRun: false,
          selectedCount,
          requiredCount,
          statusLevel: 'warn' as const,
          headline: `🟡 추가 조건 ${2 - mainCount}개 선택 필요`,
          hint,
        };
      }
      if (sameEndpointConflict) {
        return {
          canRun: false,
          selectedCount,
          requiredCount,
          statusLevel: 'error' as const,
          headline: '⚠️ 탑정(③)·탑저(④) 목표 성분 중복',
          hint: '탑정(③)과 탑저(④) 목표 성분이 동일합니다. 서로 다른 경질(LK)/중질(HK) 성분을 선택하세요.',
        };
      }
      return {
        canRun: true,
        selectedCount,
        requiredCount,
        statusLevel: 'ok' as const,
        headline: `✓ 자유도 충족 [${activeLabels.join(' + ')}]`,
        hint:
          hasSide && !hasTop
            ? `⑤ 사이드컷 활성: ③ 탑정순도 없이 [${activeLabels.join(' + ')}] 조합으로 정밀 MESH 해석을 실행합니다.`
            : '모든 운전·설계 자유도가 정확히 충족되어 즉시 [▶ RUN] 실행 가능합니다.',
      };
    }

    // ⓪ 해제: AI 최적 단수(N · Nf) 자동설계 모드
    if (hasTop && hasBot && hasSplit) {
      return {
        canRun: false,
        selectedCount,
        requiredCount: 2 + (hasRr ? 1 : 0) + sideCount,
        statusLevel: 'error' as const,
        headline: '⚠️ 자유도 과다 구속 (③+④ + ② 충돌)',
        hint: 'AI 최적 단수 모드에서 ③ 탑정품질과 ④ 탑저품질을 동시에 지정하면 ② 유출분배(D/F)는 자동 산출되므로 ②를 해제하거나 ⓪ 고정 단수를 체크하세요.',
      };
    }
    if (sameEndpointConflict) {
      return {
        canRun: false,
        selectedCount,
        requiredCount: selectedCount,
        statusLevel: 'error' as const,
        headline: '⚠️ 탑정(③)·탑저(④) 목표 성분 중복',
        hint: '탑정(③)과 탑저(④) 목표 성분이 동일합니다. 서로 다른 경질(LK)/중질(HK) 성분을 선택하세요.',
      };
    }
    if (hasSide && !hasTop) {
      if (hasBot) {
        return {
          canRun: true,
          selectedCount,
          requiredCount: Math.max(2, selectedCount),
          statusLevel: 'ok' as const,
          headline: `✓ 사이드컷(⑤) + 탑저(④) AI 단수설계 [${activeLabels.join(' + ')}]`,
          hint: `⑤ 사이드컷 선택 시 ③ 탑정순도 없이 ${
            hasRr ? '① 환류비 + ④ 탑저순도' : hasSplit ? '② 유량분할 + ④ 탑저순도' : '④ 탑저순도(환류비 자동최적)'
          }만으로 N·Nf·측류를 자동 설계합니다.`,
        };
      }
      return {
        canRun: false,
        selectedCount,
        requiredCount: Math.max(2, selectedCount + 1),
        statusLevel: 'warn' as const,
        headline: '🟡 ④ 탑저순도 추가 선택 필요',
        hint: '⑤ 사이드컷 선택 시 ③ 탑정순도 없이 ④ 탑저순도(또는 ⓪ 고정 단수 체크 후 ①+②)만 선택하면 해석 가능합니다.',
      };
    }
    if (hasTop && hasBot) {
      return {
        canRun: true,
        selectedCount,
        requiredCount: Math.max(2, selectedCount),
        statusLevel: 'ok' as const,
        headline: `✓ AI 최적 단수·피드단 설계 [${activeLabels.join(' + ')}]`,
        hint: hasRr
          ? '① 지정 환류비 조건에서 ③ 탑정·④ 탑저 목표를 만족하는 최적 단수(N·Nf)와 D/F를 자동 산출합니다.'
          : '③ 탑정·④ 탑저 목표를 동시에 만족하는 최적 단수(N·Nf)·환류비·D/F를 TAC 최소 기준으로 탐색합니다.',
      };
    }
    if (hasTop && !hasBot) {
      return {
        canRun: false,
        selectedCount,
        requiredCount: Math.max(2, selectedCount + 1),
        statusLevel: 'warn' as const,
        headline: '🟡 ④ 탑저품질 추가 선택 필요',
        hint: '③ 탑정품질 선택 완료 → AI 최적 단수(N·Nf) 설계를 위해 ④ 탑저 제품 순도·회수율을 추가로 선택하세요 (운전 고정은 ⓪ 체크).',
      };
    }
    return {
      canRun: false,
      selectedCount,
      requiredCount: 2 + sideCount,
      statusLevel: 'warn' as const,
      headline: '🟡 제품 품질 목표(③·④) 선택 필요',
      hint: hasBot
        ? '④ 탑저품질 선택 완료 → ③ 탑정품질을 추가하거나 ⑤ 사이드컷을 선택하면 AI 최적 단수(N·Nf)를 자동 설계합니다.'
        : 'AI 최적 단수(⓪ 해제) 모드에서는 ③+④ (또는 ⑤ 사이드컷 시 ④ 단독/①+④/②+④)를 선택하세요. ①+②만으로 실행하려면 ⓪ 고정 단수를 체크하세요.',
    };
  })();

  const isDualQualityMode =
    isFixedStages &&
    selectedSlots.includes('top_spec') &&
    selectedSlots.includes('bot_spec');
  const isAutoStageActive = !isFixedStages;
  const N =
    isAutoStageActive && result?.totalStagesUsed
      ? result.totalStagesUsed
      : Math.max(4, Math.min(200, Math.round(config.totalStages ?? 24)));
  const primaryFeedStage =
    isAutoStageActive && result?.feedStageUsed
      ? result.feedStageUsed
      : Math.max(
          2,
          Math.min(N - 1, Math.round(config.feedStage ?? Math.round(N * 0.5)))
        );
  const topSpecType: DistillTopSpecType = config.topSpecType ?? 'reflux_ratio';
  const topSpecValue = config.topSpecValue ?? 2.8;
  const splitSpecType: DistillSplitSpecType =
    config.splitSpecType ?? 'd_over_f_mass';
  const splitSpecValue = config.splitSpecValue ?? 0.5;
  const condenserType: DistillCondenserType = config.condenserType ?? 'total';
  const reboilerType: DistillReboilerType = config.reboilerType ?? 'kettle';
  const thermoModel: DistillThermoModel = config.thermoModel ?? 'AUTO';
  const topPress = config.topPressKgcm2g ?? 0.05;
  const stageDp = config.stageDeltaPKgcm2 ?? 0.004;
  const murphreeEff = config.murphreeEffPct ?? 75;
  const stageInputBasis: DistillStageInputBasis = config.stageInputBasis ?? 'theoretical';

  if (!open) return null;

  const stages = result?.stages ?? [];
  const distTotalKgH = result
    ? SIM_COMPS.reduce((s, k) => s + (result.distillateFlowsKgH[k] || 0), 0)
    : 0;
  const botTotalKgH = result
    ? SIM_COMPS.reduce((s, k) => s + (result.bottomsFlowsKgH[k] || 0), 0)
    : 0;

  const isActualMurphreeUi = calcMode === 'rigorous_mesh' && stageInputBasis === 'actual_murphree';
  const actualTrays =
    result?.actualTrayCount ??
    (isActualMurphreeUi
      ? Math.max(2, N - 2)
      : Math.max(2, Math.ceil((N - 2) / Math.max(0.25, murphreeEff / 100))));
  const recFeedStage = result?.recommendedFeedStage ?? primaryFeedStage;

  const complementRatioText = (() => {
    if (splitSpecType === 'd_over_f_mass') {
      const bf = Math.max(0, 1 - splitSpecValue);
      return `자동 연동 B/F (질량비) = ${bf.toFixed(4)} (${(bf * 100).toFixed(1)}%)`;
    }
    if (splitSpecType === 'b_over_f_mass') {
      const df = Math.max(0, 1 - splitSpecValue);
      return `자동 연동 D/F (질량비) = ${df.toFixed(4)} (${(df * 100).toFixed(1)}%)`;
    }
    if (splitSpecType === 'd_over_f_mole') {
      const bf = Math.max(0, 1 - splitSpecValue);
      return `자동 연동 B/F (몰비) = ${bf.toFixed(4)}`;
    }
    if (splitSpecType === 'distillate_kgh' && totalFeedKgH > 0) {
      return `자동 연동 탑저 유량 B ≈ ${Math.max(0, totalFeedKgH - splitSpecValue).toFixed(1)} kg/h`;
    }
    if (splitSpecType === 'bottoms_kgh' && totalFeedKgH > 0) {
      return `자동 연동 탑정 유량 D ≈ ${Math.max(0, totalFeedKgH - splitSpecValue).toFixed(1)} kg/h`;
    }
    return '';
  })();

  const topBarA = Math.max(0.01, (topPress + 1.03323) * 0.980665);
  const topTorr = topBarA * 750.062;
  const botPress = topPress + stageDp * Math.max(1, N - 1);
  const botBarA = Math.max(0.01, (botPress + 1.03323) * 0.980665);

  const updateFeedStageForEdge = (edgeId: string, stageNum: number) => {
    const clamped = Math.max(2, Math.min(N - 1, Math.round(stageNum)));
    const nextMap = { ...(config.feedStageMap ?? {}), [edgeId]: clamped };
    onChangeConfig({
      feedStage: feeds[0]?.edgeId === edgeId ? clamped : primaryFeedStage,
      feedStageMap: nextMap,
    });
  };

  const makeDefaultSideCut = (enabled: boolean): DistillSideCutConfig => {
    const rawTotal = config.totalStages ?? 24;
    const midByTb =
      feedSortedComps.length >= 3
        ? feedSortedComps[Math.floor(feedSortedComps.length / 2)]
        : feedSortedComps[1] ?? feedSortedComps[0] ?? activeComps[0];
    return {
      id: 'SC-1',
      enabled,
      label: '사이드컷 S',
      stage: Math.max(2, Math.min(rawTotal - 2, Math.round(rawTotal * 0.3))),
      autoOptimizeStage: false,
      phase: 'liquid',
      specType: 's_over_f_mass',
      specValue: 0.15,
      targetComp: midByTb,
    };
  };

  const sideCutCfg: DistillSideCutConfig = config.sideCut
    ? { ...makeDefaultSideCut(Boolean(config.sideCut.enabled)), ...config.sideCut }
    : makeDefaultSideCut(false);
  const sideCutEnabled = Boolean(config.sideCut?.enabled);

  const toggleSideCutEnabled = () => {
    if (!config.sideCut) {
      applyUnifiedConfigChange({ sideCut: makeDefaultSideCut(true) });
      return;
    }
    applyUnifiedConfigChange({ sideCut: { ...sideCutCfg, enabled: !sideCutEnabled } });
  };

  const updateSideCut = (patch: Partial<DistillSideCutConfig>) => {
    const base = config.sideCut ? sideCutCfg : makeDefaultSideCut(true);
    applyUnifiedConfigChange({ sideCut: { ...base, ...patch } });
  };

  const renderCompOptGroups = () => (
    <>
      {feedSortedComps.length > 0 && (
        <optgroup label="현재 유입 성분 (비점 순)">
          {feedSortedComps.map((ck) => (
            <option key={ck} value={ck}>
              {formatCompOptionWithBp(ck)}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="기타 시뮬레이션 성분">
        {otherSortedComps.map((ck) => (
          <option key={ck} value={ck}>
            {formatCompOptionWithBp(ck)}
          </option>
        ))}
      </optgroup>
    </>
  );

  const renderSideCutCard = () => {
    const maxSideStage = Math.max(2, N - 1);
    const clampedSideStage = Math.max(2, Math.min(maxSideStage, Math.round(sideCutCfg.stage || 2)));
    const specMeta = SIDECUT_SPEC_META[sideCutCfg.specType] ?? SIDECUT_SPEC_META.s_over_f_mass;
    const showTargetComp =
      Boolean(sideCutCfg.autoOptimizeStage) ||
      sideCutCfg.specType === 'purity_wt_pct' ||
      sideCutCfg.specType === 'recovery_pct' ||
      sideCutCfg.specType === 'impurity_ppm';
    const effectiveTargetComp =
      sideCutCfg.targetComp ?? feedSortedComps[1] ?? feedSortedComps[0] ?? activeComps[0] ?? 'H2O';
    const showSideResultBadge = Boolean(
      result && (result.sideCutSpecStatus || (result.sideCutMassKgH ?? 0) > 0)
    );

    return (
      <div
        style={{
          ...cardStyle,
          border: sideCutEnabled ? '1.5px solid #7C3AED' : '1.5px dashed #C4B5FD',
          background: sideCutEnabled ? '#FFFFFF' : '#FAF8FF',
          boxShadow: sideCutEnabled ? '0 1px 4px rgba(124,58,237,0.10)' : undefined,
        }}
      >
        {/* 카드 헤더 */}
        <div
          onClick={toggleSideCutEnabled}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            cursor: 'pointer',
            marginBottom: sideCutEnabled ? 9 : 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: sideCutEnabled ? '#4C1D95' : '#334155' }}>
              ⑤ 사이드컷(측류) 조건 · Side-Cut (③ 탑정순도 없이 ①+④+⑤ 또는 ②+④+⑤ 지원)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <label
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10.8,
                fontWeight: 800,
                color: sideCutEnabled ? '#5B21B6' : '#475569',
                cursor: 'pointer',
                padding: '2px 8px',
                borderRadius: 999,
                background: sideCutEnabled ? '#EDE9FE' : '#FFFFFF',
                border: sideCutEnabled ? '1px solid #C4B5FD' : '1px solid #CBD5E1',
              }}
            >
              <input
                type="checkbox"
                checked={sideCutEnabled}
                onChange={toggleSideCutEnabled}
                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7C3AED' }}
              />
              <span>사이드컷(측류, Side-Cut) 인출 활성화</span>
            </label>
          </div>
        </div>

        {sideCutEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {/* 공정 실무 빠른 프리셋 스트립 */}
            <div
              style={{
                padding: '7px 9px',
                borderRadius: 7,
                background: '#FAF5FF',
                border: '1px solid #E9D5FF',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: '#6B21A8' }}>빠른 공정 프리셋:</span>
                <button
                  type="button"
                  onClick={() =>
                    updateSideCut({
                      stage: Math.min(3, Math.max(2, (config.totalStages ?? 24) - 2)),
                      autoOptimizeStage: false,
                      phase: 'liquid',
                      specType: 's_over_f_mass',
                      specValue: 0.70,
                    })
                  }
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: '1px solid #C084FC',
                    background: '#FFFFFF',
                    color: '#5B21B6',
                    fontSize: 10.3,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🧪 파스퇴르 정제품 측류 (상부 3단 액상)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const midComp =
                      feedSortedComps.length >= 3
                        ? feedSortedComps[Math.floor(feedSortedComps.length / 2)]
                        : feedSortedComps[1] ?? feedSortedComps[0] ?? activeComps[0];
                    const keepCurrent =
                      sideCutCfg.targetComp &&
                      feedSortedComps.length >= 3 &&
                      sideCutCfg.targetComp !== feedSortedComps[0] &&
                      sideCutCfg.targetComp !== feedSortedComps[feedSortedComps.length - 1];
                    updateSideCut({
                      autoOptimizeStage: true,
                      phase: 'liquid',
                      specType: 's_over_f_mass',
                      specValue: 0.20,
                      targetComp: keepCurrent ? sideCutCfg.targetComp : midComp,
                    });
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: '1px solid #C084FC',
                    background: '#FFFFFF',
                    color: '#5B21B6',
                    fontSize: 10.3,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🎯 중간비점 농축 측류 (최적단 AI 자동탐색)
                </button>
              </div>
              <div style={{ fontSize: 10, color: '#6B21A8', lineHeight: 1.35 }}>
                💡 파스퇴르 정제 운전 시 탑정(D)은 상부 미량 저비점(Lights) 불순물을 소량 퍼지(Purge)하고, 상부 측류(S)로 고순도 주제품을 인출합니다.
              </div>
            </div>

            {/* 인출 상(Phase) + 인출 단(Stage) + 최적단 자동탐색 */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.05fr 0.95fr', gap: 8 }}>
              <div>
                <label style={labelStyle}>인출 상 (Phase)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  {(
                    [
                      { id: 'liquid', lbl: '💧 액상 (Liquid — 침니 트레이)' },
                      { id: 'vapor', lbl: '💨 기상 (Vapor)' },
                    ] as { id: SideCutPhase; lbl: string }[]
                  ).map((ph) => {
                    const active = sideCutCfg.phase === ph.id;
                    return (
                      <button
                        key={ph.id}
                        type="button"
                        onClick={() => updateSideCut({ phase: ph.id })}
                        style={{
                          padding: '5px 6px',
                          borderRadius: 6,
                          border: active ? '1.5px solid #7C3AED' : '1px solid #CBD5E1',
                          background: active ? '#F5F3FF' : '#FFFFFF',
                          color: active ? '#5B21B6' : '#475569',
                          fontSize: 10.2,
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={ph.lbl}
                      >
                        {ph.lbl}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 4 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>
                    인출 단번호 (2 ~ {maxSideStage}단)
                  </label>
                  {result?.sideCutStageUsed && (
                    <span
                      style={{
                        fontSize: 9.8,
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: '#EDE9FE',
                        color: '#5B21B6',
                        fontFamily: MONO,
                      }}
                    >
                      실제 적용: {result.sideCutStageUsed}단
                      {result.sideCutTempC !== undefined ? ` (${result.sideCutTempC.toFixed(1)}°C)` : ''}
                    </span>
                  )}
                </div>
                <BufferedNumberInput
                  syncKey={`${unitTag}-scstage-${sideCutCfg.autoOptimizeStage ? 'auto' : 'man'}`}
                  min={2}
                  max={maxSideStage}
                  step={1}
                  disabled={Boolean(sideCutCfg.autoOptimizeStage)}
                  value={clampedSideStage}
                  onValueChange={(v) =>
                    updateSideCut({
                      stage: Math.max(2, Math.min(maxSideStage, Math.round(v || 2))),
                    })
                  }
                  onEnterRun={() => {
                    if (dofEvaluation.canRun) triggerRunSimulation();
                  }}
                  style={{
                    ...inputBaseStyle,
                    background: sideCutCfg.autoOptimizeStage ? '#F1F5F9' : '#FFFFFF',
                    color: sideCutCfg.autoOptimizeStage ? '#64748B' : '#1A2F44',
                    cursor: sideCutCfg.autoOptimizeStage ? 'not-allowed' : 'text',
                  }}
                />
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    marginTop: 5,
                    fontSize: 10.5,
                    fontWeight: 800,
                    color: '#5B21B6',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(sideCutCfg.autoOptimizeStage)}
                    onChange={(e) => updateSideCut({ autoOptimizeStage: e.target.checked })}
                    style={{ width: 13.5, height: 13.5, cursor: 'pointer', accentColor: '#7C3AED' }}
                  />
                  <span>✨ 최적 인출단 자동탐색 (피크 농도단)</span>
                </label>
              </div>
            </div>

            {/* 제어 변수(specType) + 목표 수치(specValue) + 기준 성분(targetComp) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? '1fr'
                  : showTargetComp
                  ? '1.25fr 0.9fr 0.85fr'
                  : '1.35fr 0.95fr',
                gap: 8,
              }}
            >
              <div>
                <label style={labelStyle}>제어 변수 선택</label>
                <select
                  value={sideCutCfg.specType}
                  onChange={(e) => {
                    const nextType = e.target.value as SideCutSpecType;
                    const prevType = sideCutCfg.specType;
                    const keepVal =
                      (prevType === 's_over_f_mass' && nextType === 's_over_f_mole') ||
                      (prevType === 's_over_f_mole' && nextType === 's_over_f_mass');
                    updateSideCut({
                      specType: nextType,
                      specValue: keepVal
                        ? sideCutCfg.specValue
                        : defaultSideCutSpecValue(nextType, totalFeedKgH),
                    });
                  }}
                  style={selectBaseStyle}
                >
                  {SIDECUT_SPEC_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {showTargetComp && (
                <div>
                  <label style={labelStyle}>기준 성분 (Target)</label>
                  <select
                    value={effectiveTargetComp}
                    onChange={(e) => updateSideCut({ targetComp: e.target.value as SimCompKey })}
                    style={selectBaseStyle}
                  >
                    {renderCompOptGroups()}
                  </select>
                </div>
              )}

              <div>
                <label style={labelStyle}>목표 수치 ({specMeta.unit})</label>
                <BufferedNumberInput
                  syncKey={`${unitTag}-scval-${sideCutCfg.specType}`}
                  step={specMeta.step}
                  min={specMeta.min}
                  max={specMeta.max}
                  value={sideCutCfg.specValue}
                  onValueChange={(v) => updateSideCut({ specValue: v })}
                  onEnterRun={() => {
                    if (dofEvaluation.canRun) triggerRunSimulation();
                  }}
                  style={inputBaseStyle}
                />
                {sideCutCfg.specType === 's_over_f_mass' && totalFeedKgH > 0 && (
                  <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 3, fontFamily: MONO }}>
                    ≈ {(sideCutCfg.specValue * totalFeedKgH).toFixed(1)} kg/h ({(sideCutCfg.specValue * 100).toFixed(1)}%)
                  </div>
                )}
                {sideCutCfg.specType === 's_over_f_mole' && (
                  <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 3, fontFamily: MONO }}>
                    몰분배 {(sideCutCfg.specValue * 100).toFixed(1)} mol%
                  </div>
                )}
              </div>
            </div>

            {/* 계산 결과 배지 */}
            {showSideResultBadge && result && (
              <div
                style={{
                  padding: '6px 9px',
                  borderRadius: 6,
                  background: result.sideCutSpecStatus?.met === false ? '#FFFBEB' : '#F5F3FF',
                  border: result.sideCutSpecStatus?.met === false ? '1px solid #FDE68A' : '1px solid #DDD6FE',
                  color: result.sideCutSpecStatus?.met === false ? '#92400E' : '#5B21B6',
                  fontSize: 10.5,
                  fontWeight: 800,
                  fontFamily: MONO,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>
                  {result.sideCutSpecStatus?.label
                    ? result.sideCutSpecStatus.label
                    : `S = ${(result.sideCutMassKgH ?? 0).toFixed(1)} kg/h (S/F ${((result.actualSOverFMass ?? 0) * 100).toFixed(1)}%)`}
                </span>
                {result.sideCutSpecStatus?.label &&
                  (result.sideCutMassKgH ?? 0) > 0 &&
                  !result.sideCutSpecStatus.label.includes('S=') && (
                    <span style={{ color: '#475569', fontWeight: 700 }}>
                      | S = {result.sideCutMassKgH!.toFixed(1)} kg/h (S/F {((result.actualSOverFMass ?? 0) * 100).toFixed(1)}%)
                    </span>
                  )}
                {result.sideCutSpecStatus?.label &&
                  result.sideCutSpecStatus.label.includes('S=') &&
                  (result.sideCutMassKgH ?? 0) > 0 && (
                    <span style={{ color: '#475569', fontWeight: 700 }}>
                      (S/F {((result.actualSOverFMass ?? 0) * 100).toFixed(1)}%)
                    </span>
                  )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderProfileSvg = () => {
    if (!stages.length) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 250,
            fontSize: 12,
            color: '#64748B',
            background: '#FFFFFF',
            border: '1px dashed #CBD5E1',
            borderRadius: 8,
            padding: 16,
            textAlign: 'center',
          }}
        >
          유입 피드 배관을 연결하면 단별(Stage 1 ~ {N}) 엄밀 MESH 프로파일이 즉시 계산됩니다.
        </div>
      );
    }

    const W = 450;
    const H = 290;
    const padL = 50;
    const padR = 20;
    const padT = 24;
    const padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const yOfStage = (stNum: number) =>
      padT + ((stNum - 1) / Math.max(1, stages.length - 1)) * plotH;

    const renderSideCutSvgMarker = () => {
      if (!result?.sideCutStageUsed || (result?.sideCutMassKgH ?? 0) <= 0) return null;
      const scStage = Math.max(1, Math.min(stages.length, result.sideCutStageUsed));
      const scY = yOfStage(scStage);
      const labelY = scY < padT + 14 ? scY + 11 : scY - 4;
      return (
        <g>
          <line
            x1={padL}
            x2={W - padR}
            y1={scY}
            y2={scY}
            stroke="#7C3AED"
            strokeWidth={1.6}
            strokeDasharray="5 3"
          />
          <text
            x={W - padR - 2}
            y={labelY}
            fontSize={9.5}
            textAnchor="end"
            fill="#7C3AED"
            fontWeight={800}
          >
            {`◀ S 측류 (${result.sideCutStageUsed}단 · ${result.sideCutPhase === 'G' ? '기상' : '액상'} ${result.sideCutMassKgH!.toFixed(1)} kg/h)`}
          </text>
        </g>
      );
    };

    if (rightChart === 'temp') {
      const temps = stages.map((s) => s.tempC);
      const tMin = Math.floor(Math.min(...temps) - 2);
      const tMax = Math.ceil(Math.max(...temps, tMin + 5) + 2);
      const xOfT = (t: number) =>
        padL + ((t - tMin) / Math.max(1e-6, tMax - tMin)) * plotW;

      const pts = stages
        .map((s) => `${xOfT(s.tempC).toFixed(1)},${yOfStage(s.stage).toFixed(1)}`)
        .join(' ');

      return (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            background: '#FFFFFF',
            borderRadius: 8,
            border: '1px solid #E2E8F0',
          }}
        >
          {[1, primaryFeedStage, stages.length].map((stNum, idx) => (
            <g key={`grid-${idx}`}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yOfStage(stNum)}
                y2={yOfStage(stNum)}
                stroke={stNum === primaryFeedStage ? '#F59E0B' : '#E2E8F0'}
                strokeDasharray={stNum === primaryFeedStage ? '4 2' : undefined}
              />
              <text x={6} y={yOfStage(stNum) + 4} fontSize={10} fill="#475569" fontWeight={700}>
                {stNum === 1 ? '1(탑정)' : stNum === stages.length ? `${stNum}(탑저)` : `F:${stNum}단`}
              </text>
            </g>
          ))}
          {renderSideCutSvgMarker()}
          <polyline fill="none" stroke="#0284C7" strokeWidth={2.4} points={pts} />
          {stages.map((s) => (
            <circle
              key={s.stage}
              cx={xOfT(s.tempC)}
              cy={yOfStage(s.stage)}
              r={s.stage === primaryFeedStage ? 4 : 2.3}
              fill={s.stage === primaryFeedStage ? '#D97706' : '#0284C7'}
            />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const tv = tMin + f * (tMax - tMin);
            const xp = padL + f * plotW;
            return (
              <g key={f}>
                <line x1={xp} x2={xp} y1={padT} y2={H - padB} stroke="#F1F5F9" />
                <text x={xp} y={H - 10} fontSize={10} textAnchor="middle" fill="#64748B">
                  {tv.toFixed(1)}°C
                </text>
              </g>
            );
          })}
          <text x={W - padR} y={15} fontSize={10.5} textAnchor="end" fill="#0369A1" fontWeight={800}>
            탑정 {result?.topTempC.toFixed(1)}°C → 탑저 {result?.bottomTempC.toFixed(1)}°C
          </text>
        </svg>
      );
    }

    if (rightChart === 'traffic') {
      const maxFlow = Math.max(
        10,
        ...stages.map((s) => Math.max(s.liqMassKgH, s.vapMassKgH))
      );
      const xOfF = (v: number) => padL + (v / maxFlow) * plotW;
      const ptsL = stages
        .map((s) => `${xOfF(s.liqMassKgH).toFixed(1)},${yOfStage(s.stage).toFixed(1)}`)
        .join(' ');
      const ptsV = stages
        .map((s) => `${xOfF(s.vapMassKgH).toFixed(1)},${yOfStage(s.stage).toFixed(1)}`)
        .join(' ');

      return (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            background: '#FFFFFF',
            borderRadius: 8,
            border: '1px solid #E2E8F0',
          }}
        >
          {[1, primaryFeedStage, stages.length].map((stNum, idx) => (
            <g key={`tg-${idx}`}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yOfStage(stNum)}
                y2={yOfStage(stNum)}
                stroke={stNum === primaryFeedStage ? '#F59E0B' : '#E2E8F0'}
                strokeDasharray={stNum === primaryFeedStage ? '4 2' : undefined}
              />
              <text x={6} y={yOfStage(stNum) + 4} fontSize={10} fill="#475569" fontWeight={700}>
                {stNum === 1 ? '1단' : stNum === stages.length ? `${stNum}단` : `F:${stNum}단`}
              </text>
            </g>
          ))}
          {renderSideCutSvgMarker()}
          <polyline fill="none" stroke="#2563EB" strokeWidth={2.3} points={ptsL} />
          <polyline fill="none" stroke="#EA580C" strokeWidth={2.3} strokeDasharray="5 3" points={ptsV} />
          {[0, 0.5, 1].map((f) => {
            const fv = f * maxFlow;
            const xp = padL + f * plotW;
            return (
              <text key={f} x={xp} y={H - 10} fontSize={10} textAnchor="middle" fill="#64748B">
                {fv.toFixed(0)} kg/h
              </text>
            );
          })}
          <text x={padL + 4} y={15} fontSize={10} fill="#2563EB" fontWeight={800}>
            ━ 내부 액상유량 L (kg/h)
          </text>
          <text x={padL + 160} y={15} fontSize={10} fill="#EA580C" fontWeight={800}>
            ┅ 내부 기상유량 V (kg/h)
          </text>
        </svg>
      );
    }

    const xOfWtPct = (wtPct: number) => {
      if (!logScalePpm) {
        return padL + (Math.max(0, Math.min(100, wtPct)) / 100) * plotW;
      }
      const ppm = Math.max(1, Math.min(1_000_000, wtPct * 10_000));
      const logVal = Math.log10(ppm);
      return padL + (logVal / 6) * plotW;
    };

    return (
      <div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            background: '#FFFFFF',
            borderRadius: 8,
            border: '1px solid #E2E8F0',
          }}
        >
          {[1, primaryFeedStage, stages.length].map((stNum, idx) => (
            <g key={`cg-${idx}`}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yOfStage(stNum)}
                y2={yOfStage(stNum)}
                stroke={stNum === primaryFeedStage ? '#F59E0B' : '#E2E8F0'}
                strokeDasharray={stNum === primaryFeedStage ? '4 2' : undefined}
              />
              <text x={5} y={yOfStage(stNum) + 4} fontSize={10} fill="#475569" fontWeight={700}>
                {stNum === 1 ? '1(탑정)' : stNum === stages.length ? `${stNum}(탑저)` : `F:${stNum}단`}
              </text>
            </g>
          ))}
          {renderSideCutSvgMarker()}

          {activeComps.map((ck, idx) => {
            const maxStWt = Math.max(
              0,
              ...stages.map((s) => (phaseBasis === 'liq' ? s.xWtPct[ck] || 0 : s.yWtPct[ck] || 0))
            );
            if (!logScalePpm && maxStWt < 0.08 && idx >= 2) return null;
            const color = SERIES_COLORS[idx % SERIES_COLORS.length];
            const pts = stages
              .map((s) => {
                const wt = phaseBasis === 'liq' ? s.xWtPct[ck] || 0 : s.yWtPct[ck] || 0;
                return `${xOfWtPct(wt).toFixed(1)},${yOfStage(s.stage).toFixed(1)}`;
              })
              .join(' ');
            return (
              <polyline
                key={ck}
                fill="none"
                stroke={color}
                strokeWidth={2.3}
                points={pts}
              />
            );
          })}

          {!logScalePpm
            ? [0, 25, 50, 75, 100].map((pct) => {
                const xp = xOfWtPct(pct);
                return (
                  <g key={pct}>
                    <line x1={xp} x2={xp} y1={padT} y2={H - padB} stroke="#F1F5F9" />
                    <text x={xp} y={H - 10} fontSize={10} textAnchor="middle" fill="#64748B">
                      {pct}%
                    </text>
                  </g>
                );
              })
            : [1, 10, 100, 1000, 10000, 100000, 1000000].map((ppm) => {
                const xp = padL + (Math.log10(ppm) / 6) * plotW;
                const lbl = ppm >= 10000 ? `${ppm / 10000}%` : `${ppm}ppm`;
                return (
                  <g key={ppm}>
                    <line x1={xp} x2={xp} y1={padT} y2={H - padB} stroke="#F1F5F9" />
                    <text x={xp} y={H - 10} fontSize={9.5} textAnchor="middle" fill="#64748B">
                      {lbl}
                    </text>
                  </g>
                );
              })}
        </svg>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            marginTop: 7,
          }}
        >
          {activeComps.map((ck, idx) => {
            const maxStWt = Math.max(
              0,
              ...stages.map((s) => (phaseBasis === 'liq' ? s.xWtPct[ck] || 0 : s.yWtPct[ck] || 0))
            );
            const hiddenTrace = !logScalePpm && maxStWt < 0.08 && idx >= 2;
            return (
              <span
                key={ck}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  fontSize: 10.5,
                  fontWeight: 800,
                  color: hiddenTrace ? '#94A3B8' : '#1E293B',
                  opacity: hiddenTrace ? 0.78 : 1,
                }}
                title={hiddenTrace ? '선형 스케일에서 0.08 wt% 미만 미량 성분 — 우측 상단 [ppm 로그 스케일] 버튼으로 확인 가능' : undefined}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: SERIES_COLORS[idx % SERIES_COLORS.length],
                    display: 'inline-block',
                  }}
                />
                {COMP_META[ck]?.formula ?? ck}
                {hiddenTrace && <span style={{ fontSize: 9.5, fontWeight: 600 }}>(미량)</span>}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCandidateComparisonTable = (
    candidates: DistillDesignCandidate[],
    contextMode: 'design_stages' | 'dual_spec'
  ) => {
    if (!candidates || candidates.length === 0) return null;
    const hasSideCutCols = candidates.some((c) => c.sideCutStage !== undefined);
    return (
      <div
        style={{
          marginTop: 10,
          padding: '9px 10px',
          borderRadius: 8,
          background: '#F8FAFC',
          border: '1px solid #CBD5E1',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 900, color: '#0F172A' }}>
            ✨ 다중후보 (단수 · 공급단 · 환류비 · 탑정유량) 수렴 & 총연간비용(TAC) 비교표
          </span>
          <span style={{ fontSize: 9.8, color: '#475569', fontWeight: 700 }}>
            TAC 지수 100.0 = 연간 투자비+에너지비 최저 최적안
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 10.2,
              fontFamily: MONO,
              background: '#FFFFFF',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <thead>
              <tr style={{ background: '#E2E8F0', color: '#1E293B', textAlign: 'right' }}>
                <th style={{ padding: '5px 7px', textAlign: 'left', fontWeight: 900 }}>설계 후보</th>
                <th style={{ padding: '5px 6px', fontWeight: 900 }}>단수 N (실단)</th>
                <th style={{ padding: '5px 6px', fontWeight: 900 }}>피드 Nf</th>
                <th style={{ padding: '5px 6px', fontWeight: 900 }}>환류비 RR</th>
                <th style={{ padding: '5px 6px', fontWeight: 900 }}>탑정 D (kg/h)</th>
                {hasSideCutCols && (
                  <>
                    <th style={{ padding: '5px 6px', fontWeight: 900, color: '#6D28D9' }}>측류단</th>
                    <th style={{ padding: '5px 6px', fontWeight: 900, color: '#6D28D9' }}>측류 S/F</th>
                  </>
                )}
                <th style={{ padding: '5px 6px', fontWeight: 900 }}>Q_reb (kW)</th>
                <th style={{ padding: '5px 6px', fontWeight: 900 }}>탑경 (m)</th>
                <th style={{ padding: '5px 6px', fontWeight: 900 }}>상대 TAC</th>
                <th style={{ padding: '5px 6px', textAlign: 'center', fontWeight: 900 }}>적용</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const isRec = c.recommended;
                return (
                  <tr
                    key={c.id}
                    style={{
                      background: isRec ? '#ECFDF5' : '#FFFFFF',
                      borderTop: '1px solid #E2E8F0',
                      color: '#0F172A',
                      textAlign: 'right',
                    }}
                  >
                    <td style={{ padding: '5px 7px', textAlign: 'left', fontFamily: 'sans-serif' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 10.3,
                            fontWeight: isRec ? 900 : 700,
                            color: isRec ? '#065F46' : '#1E293B',
                          }}
                        >
                          {c.label}
                        </span>
                        <span
                          style={{
                            padding: '1px 5px',
                            borderRadius: 999,
                            fontSize: 9.2,
                            fontWeight: 800,
                            background: c.specsMet ? '#DCFCE7' : '#FEF3C7',
                            color: c.specsMet ? '#166534' : '#92400E',
                          }}
                        >
                          {c.specsMet ? '✓ 달성' : '⚠ 근접'}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '5px 6px', fontWeight: isRec ? 900 : 700 }}>
                      {c.stagesN} ({c.actualTrays})
                    </td>
                    <td style={{ padding: '5px 6px' }}>{c.feedStage}</td>
                    <td style={{ padding: '5px 6px', fontWeight: 800 }}>
                      {c.refluxRatio.toFixed(2)}{' '}
                      <span style={{ fontSize: 9.2, color: '#64748B' }}>({c.rOverRmin}×)</span>
                    </td>
                    <td style={{ padding: '5px 6px' }}>{c.distillateKgH.toFixed(1)}</td>
                    {hasSideCutCols && (
                      <>
                        <td style={{ padding: '5px 6px', color: '#6D28D9', fontWeight: 800 }}>
                          {c.sideCutStage ? `${c.sideCutStage}단` : '-'}
                        </td>
                        <td style={{ padding: '5px 6px', color: '#6D28D9', fontWeight: 700 }}>
                          {c.sOverFMass !== undefined
                            ? `${(c.sOverFMass * 100).toFixed(1)}% (${c.sideCutPurityWtPct ?? '-'}%)`
                            : '-'}
                        </td>
                      </>
                    )}
                    <td style={{ padding: '5px 6px' }}>{c.reboilerDutyKW.toFixed(0)}</td>
                    <td style={{ padding: '5px 6px' }}>{c.estimatedDiameterM.toFixed(2)}</td>
                    <td
                      style={{
                        padding: '5px 6px',
                        fontWeight: 900,
                        color: isRec ? '#059669' : '#334155',
                      }}
                    >
                      {c.tacIndex.toFixed(1)}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => {
                          const syncedSideCut =
                            config.sideCut?.enabled && typeof c.sideCutStage === 'number'
                              ? { sideCut: { ...config.sideCut, stage: c.sideCutStage } }
                              : {};
                          applyPatchAndRun({
                            columnCalcMode: 'rigorous_mesh',
                            activeDofSlots: ['rr', 'split'],
                            totalStages: c.stagesN,
                            feedStage: c.feedStage,
                            topSpecType: 'reflux_ratio',
                            topSpecValue: Number(c.refluxRatio.toFixed(3)),
                            splitSpecType: 'd_over_f_mass',
                            splitSpecValue: Number(c.dOverFMass.toFixed(4)),
                            autoOptimizeStagesOnDualSpec: false,
                            ...syncedSideCut,
                          });
                        }}
                        style={{
                          padding: '3px 7px',
                          borderRadius: 5,
                          border: isRec ? '1px solid #059669' : '1px solid #94A3B8',
                          background: isRec ? '#059669' : '#FFFFFF',
                          color: isRec ? '#FFFFFF' : '#1E293B',
                          fontSize: 9.8,
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {contextMode === 'design_stages' ? '정밀모사 확정' : '이 후보 고정'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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
        padding: isMobile ? 0 : 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: isMobile ? '100vw' : 'min(1220px, 96vw)',
          height: isMobile ? '100dvh' : 'min(850px, 92vh)',
          background: '#FFFFFF',
          borderRadius: isMobile ? 0 : 13,
          border: isMobile ? 'none' : '1px solid #D6D3C9',
          boxShadow: '0 24px 64px rgba(15, 23, 42, 0.36)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#1A2F44',
        }}
      >
        {/* ── 상단 네이비 헤더 바 ── */}
        <div
          style={{
            background: '#1A2F44',
            color: '#FFFFFF',
            padding: isMobile ? '10px 12px' : '12px 18px',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between',
            flexWrap: isMobile ? 'nowrap' : 'wrap',
            gap: isMobile ? 8 : 10,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: isMobile ? 9.8 : 10.5, fontWeight: 700, color: '#93C5FD', letterSpacing: 0.2 }}>
                  다단 정밀증류 통합 시뮬레이션 &amp; 단수·유량 자동역산 워크벤치
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                  <span style={{ fontSize: isMobile ? 14.5 : 16, fontWeight: 900, color: '#FFFFFF', wordBreak: 'keep-all' }}>
                    [{unitTag}] {unitLabel}
                  </span>
                  {isRunningFeedback ? (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 900,
                        padding: '2px 10px',
                        borderRadius: 999,
                        background: '#2563EB',
                        color: '#FFFFFF',
                        fontFamily: MONO,
                      }}
                    >
                      ⏳ 다단 MESH 행렬 수렴 계산 실행 중...
                    </span>
                  ) : isSimDirty ? (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 900,
                        padding: '2px 10px',
                        borderRadius: 999,
                        background: '#F59E0B',
                        color: '#1E293B',
                        fontFamily: MONO,
                      }}
                    >
                      ⏸ 입력 변경됨 — [▶ RUN 실행] 필요
                    </span>
                  ) : (
                    result && (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 800,
                          padding: '2px 10px',
                          borderRadius: 999,
                          background:
                            result.diagnostics?.level === 'error'
                              ? '#DC2626'
                              : result.diagnostics?.level === 'warning'
                              ? '#D97706'
                              : '#059669',
                          color: '#FFFFFF',
                          fontFamily: MONO,
                        }}
                      >
                        {result.diagnostics?.level === 'error'
                          ? `✕ ${result.diagnostics.badgeText}`
                          : result.diagnostics?.level === 'warning'
                          ? `⚠ ${result.diagnostics.badgeText}`
                          : `✓ ${result.diagnostics?.badgeText ?? '정상 수렴 완료'} (${result.thermoModelUsed} · ${result.innerIterations}회)`}
                      </span>
                    )
                  )}
                </div>
              </div>

              {isMobile && (
                <button
                  type="button"
                  onClick={handleCloseModal}
                  aria-label="워크벤치 닫기"
                  style={{
                    flexShrink: 0,
                    padding: '6px 11px',
                    borderRadius: 7,
                    border: '1.5px solid rgba(255,255,255,0.45)',
                    background: 'rgba(255,255,255,0.16)',
                    color: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 900,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ✕ 닫기
                </button>
              )}
            </div>

            <div style={{ fontSize: isMobile ? 10.3 : 11, color: '#CBD5E1', marginTop: 3, lineHeight: 1.35 }}>
              {calcMode === 'design_stages' ? '자동산출 이론단 ' : '지정 이론단 '}
              <b>{N}단</b> (실제 약 {actualTrays}단) · 주 피드 {primaryFeedStage}단 · 권장 최적 공급단{' '}
              {recFeedStage}단 · 추정 탑경 Ø{(result?.estimatedDiameterM ?? 1.2).toFixed(2)} m
              {result?.sideCutStageUsed && (result?.sideCutMassKgH ?? 0) > 1e-4
                ? ` · 측류 S ${result.sideCutStageUsed}단 (${result.sideCutMassKgH!.toFixed(1)} kg/h)`
                : ''}
              {lastRunStamp ? ` · 최근 실행 ${lastRunStamp}` : ''}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              gap: isMobile ? 6 : 8,
              flexShrink: 0,
              flexWrap: isMobile ? 'nowrap' : 'wrap',
              width: isMobile ? '100%' : undefined,
            }}
          >
            {/* 내장 2-모드 전환 탭 (공정 시뮬레이션 ↔ 컬럼 사이징 & 인터널 개념설계) */}
            <div
              style={{
                display: isMobile ? 'grid' : 'inline-flex',
                gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
                width: isMobile ? '100%' : undefined,
                boxSizing: 'border-box',
                background: 'rgba(15,23,42,0.55)',
                padding: 3,
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.35)',
                gap: 4,
              }}
            >
              <button
                type="button"
                onClick={() => setWorkspaceView('simulation')}
                style={{
                  padding: isMobile ? '7px 6px' : '6px 12px',
                  borderRadius: 6,
                  border: workspaceView === 'simulation' ? '1px solid #93C5FD' : '1px solid transparent',
                  background: workspaceView === 'simulation' ? '#2563EB' : 'transparent',
                  color: workspaceView === 'simulation' ? '#FFFFFF' : '#CBD5E1',
                  fontSize: isMobile ? 11 : 11.5,
                  fontWeight: 900,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}
              >
                {isMobile ? '🔬 ① 시뮬레이션·프로필' : '🔬 ① 공정 시뮬레이션 & 프로파일'}
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceView('internals')}
                style={{
                  padding: isMobile ? '7px 6px' : '6px 12px',
                  borderRadius: 6,
                  border: workspaceView === 'internals' ? '1px solid #93C5FD' : '1px solid transparent',
                  background: workspaceView === 'internals' ? '#2563EB' : 'transparent',
                  color: workspaceView === 'internals' ? '#FFFFFF' : '#CBD5E1',
                  fontSize: isMobile ? 11 : 11.5,
                  fontWeight: 900,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}
              >
                {isMobile ? '🏗️ ② 컬럼 사이징·인터널' : '🏗️ ② 컬럼 사이징 & 인터널 개념설계'}
              </button>
            </div>

            {isMobile ? (
              <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                <button
                  type="button"
                  onClick={runAiAutoFixDistill}
                  disabled={isAiBusy}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: 7,
                    border:
                      !result?.converged || result?.diagnostics?.level !== 'ok'
                        ? '1.5px solid #C084FC'
                        : '1px solid #64748B',
                    background:
                      !result?.converged || result?.diagnostics?.level !== 'ok' ? '#7C3AED' : '#334155',
                    color: '#FFFFFF',
                    fontSize: 11.2,
                    fontWeight: 900,
                    cursor: isAiBusy ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isAiBusy ? (aiStepLabel ? `⏳ ${aiStepLabel}` : '⏳ AI 분석 중...') : '✨ AI 자동 해결'}
                </button>
                {onRunSimulation && (
                  <button
                    type="button"
                    onClick={triggerRunSimulation}
                    disabled={isRunningFeedback || !dofEvaluation.canRun}
                    title={!dofEvaluation.canRun ? dofEvaluation.hint : '다단 MESH 시뮬레이션 실행'}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 7,
                      border: !dofEvaluation.canRun ? '1px solid #64748B' : '1px solid #60A5FA',
                      background: !dofEvaluation.canRun
                        ? '#475569'
                        : isSimDirty
                        ? '#D97706'
                        : '#2563EB',
                      color: '#FFFFFF',
                      fontSize: 11.2,
                      fontWeight: 900,
                      cursor: isRunningFeedback
                        ? 'wait'
                        : !dofEvaluation.canRun
                        ? 'not-allowed'
                        : 'pointer',
                      opacity: !dofEvaluation.canRun ? 0.65 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isRunningFeedback ? '⏳ 계산 중...' : !dofEvaluation.canRun ? '▶ RUN (조건 필요)' : '▶ RUN 실행'}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={runAiAutoFixDistill}
                disabled={isAiBusy}
                style={{
                  padding: '7px 12px',
                  borderRadius: 7,
                  border:
                    !result?.converged || result?.diagnostics?.level !== 'ok'
                      ? '1.5px solid #C084FC'
                      : '1px solid #64748B',
                  background:
                    !result?.converged || result?.diagnostics?.level !== 'ok' ? '#7C3AED' : '#334155',
                  color: '#FFFFFF',
                  fontSize: 11.3,
                  fontWeight: 900,
                  cursor: isAiBusy ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {isAiBusy ? (aiStepLabel ? `⏳ ${aiStepLabel}` : '⏳ AI 분석 중...') : '✨ AI 자동 해결'}
              </button>
            )}
            {onRunSimulation && !isMobile && (
              <button
                type="button"
                onClick={triggerRunSimulation}
                disabled={isRunningFeedback || !dofEvaluation.canRun}
                title={!dofEvaluation.canRun ? dofEvaluation.hint : '다단 MESH 시뮬레이션 실행 (F5)'}
                style={{
                  padding: '8px 15px',
                  borderRadius: 7,
                  border: !dofEvaluation.canRun
                    ? '1px solid #64748B'
                    : isRunningFeedback
                    ? '1.5px solid #93C5FD'
                    : isSimDirty
                    ? '1.5px solid #FDE047'
                    : '1px solid #60A5FA',
                  background: !dofEvaluation.canRun
                    ? '#475569'
                    : isRunningFeedback
                    ? '#1D4ED8'
                    : isSimDirty
                    ? '#D97706'
                    : '#2563EB',
                  color: '#FFFFFF',
                  fontSize: 11.8,
                  fontWeight: 900,
                  cursor: isRunningFeedback
                    ? 'wait'
                    : !dofEvaluation.canRun
                    ? 'not-allowed'
                    : 'pointer',
                  opacity: !dofEvaluation.canRun ? 0.65 : 1,
                  whiteSpace: 'nowrap',
                  boxShadow:
                    dofEvaluation.canRun && isSimDirty
                      ? '0 0 0 3px rgba(245,158,11,0.30)'
                      : '0 2px 6px rgba(15,23,42,0.25)',
                }}
              >
                {isRunningFeedback
                  ? '⏳ 수렴 계산 중...'
                  : !dofEvaluation.canRun
                  ? '▶ RUN (자유도 확인)'
                  : isSimDirty
                  ? '▶ RUN 시뮬레이션 실행'
                  : '▶ RUN 재실행 (F5)'}
              </button>
            )}
            {!isMobile && (
              <button
                type="button"
                onClick={handleCloseModal}
                style={{
                  padding: '7px 12px',
                  borderRadius: 7,
                  border: '1px solid rgba(255,255,255,0.28)',
                  background: 'rgba(255,255,255,0.10)',
                  color: '#FFFFFF',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                닫기 ✕
              </button>
            )}
          </div>
        </div>

        {/* ── 상시 노출 AI 자동 해결 진행·결과 배너 (isSimDirty / 탭 상태와 독립) ── */}
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
              fontSize: 11.2,
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
                      fontSize: 10.6,
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
                  <div style={{ color: '#475569', fontSize: 10.6 }}>
                    원인: {aiReport.result.rootCauses.slice(0, 2).join(' · ')}
                  </div>
                )}
                {aiReport.result.actionsTaken.length > 0 && (
                  <div style={{ color: '#1E293B', fontWeight: 700, fontSize: 10.8 }}>
                    조치: {aiReport.result.actionsTaken.join(' · ')}
                  </div>
                )}
                {aiReport.geminiNote && (
                  <div style={{ color: '#4C1D95', fontWeight: 700, fontSize: 10.6 }}>
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

        {/* ── 내장 뷰 ②: 다성분 단별 수력학 기반 컬럼 사이징 & 인터널 개념설계 ── */}
        {workspaceView === 'internals' ? (
          <ColumnInternalsDesignPanel
            unitTag={unitTag}
            unitLabel={unitLabel}
            config={config}
            feeds={feeds}
            simResult={result}
            isMobile={isMobile}
            onChangeConfig={onChangeConfig}
            onApplyHydraulicsToMesh={(avgDpKgcm2, predEffPct) => {
              onChangeConfig({
                stageDeltaPKgcm2: avgDpKgcm2,
                murphreeEffPct: Math.round(predEffPct),
              });
              if (onRunSimRef.current) {
                setTimeout(() => onRunSimRef.current?.(), 25);
              }
            }}
          />
        ) : (
        /* ── 내장 뷰 ①: 본문 2단 분할 영역 (모바일에서는 입력 ↔ 프로파일 탭 전환 지원) ── */
        <>
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
                  border: mobilePane === 'inputs' ? '1.5px solid #1A2F44' : '1px solid #CBD5E1',
                  background: mobilePane === 'inputs' ? '#1A2F44' : '#FFFFFF',
                  color: mobilePane === 'inputs' ? '#FFFFFF' : '#334155',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ⚙ 분리조건 · 유량 입력
              </button>
              <button
                type="button"
                onClick={() => setMobilePane('results')}
                style={{
                  padding: '7px 8px',
                  borderRadius: 6,
                  border: mobilePane === 'results' ? '1.5px solid #1A2F44' : '1px solid #CBD5E1',
                  background: mobilePane === 'results' ? '#1A2F44' : '#FFFFFF',
                  color: mobilePane === 'results' ? '#FFFFFF' : '#334155',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                📈 단별 프로파일 · 결과표
              </button>
            </div>
          )}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexWrap: isMobile ? 'nowrap' : 'wrap',
            overflow: 'hidden',
          }}
        >
          {/* 좌측 패널 */}
          {(!isMobile || mobilePane === 'inputs') && (
          <div
            style={{
              flex: isMobile ? '1 1 100%' : '1.22 1 480px',
              minWidth: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              background: '#FAF9F5',
              borderRight: isMobile ? 'none' : '1px solid #E5E2DC',
              overflow: 'hidden',
            }}
          >
            {/* 좌측 3개 통합 세그먼트 탭 */}
            <div
              style={{
                display: 'flex',
                gap: 5,
                padding: '8px 14px',
                background: '#EFECE5',
                borderBottom: '1px solid #DFDCD4',
                flexShrink: 0,
                flexWrap: 'wrap',
              }}
            >
              {(
                [
                  {
                    id: 'specs',
                    label: `① 운전·설계 변수 (${dofEvaluation.selectedCount}/${dofEvaluation.requiredCount})`,
                  },
                  {
                    id: 'tower',
                    label: isFixedStages
                      ? `② 탑 단수·피드단 구성 (N=${N}단)`
                      : `② 응축기·리보일러·피드 (${feeds.length}개)`,
                  },
                  { id: 'pressure', label: '③ 압력·열역학·효율' },
                ] as { id: LeftTabId; label: string }[]
              ).map((tb) => {
                const active = leftTab === tb.id;
                return (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => setLeftTab(tb.id)}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 6,
                      border: active ? '1.5px solid #1A2F44' : '1px solid #CBD5E1',
                      background: active ? '#1A2F44' : '#FFFFFF',
                      color: active ? '#FFFFFF' : '#334155',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tb.label}
                  </button>
                );
              })}
            </div>

            {/* 좌측 스크롤 컨텐츠 */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '13px 15px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* ── 상단 통합 [시뮬레이션 실행 상태 · 수렴 판정 · 수렴 추천 조합] 패널 ── */}
              {(() => {
                const diag = result?.diagnostics;
                if (isRunningFeedback) {
                  return (
                    <div
                      style={{
                        padding: '10px 13px',
                        borderRadius: 8,
                        background: '#EFF6FF',
                        border: '1.5px solid #2563EB',
                        color: '#1E3A8A',
                        fontSize: 11.5,
                        fontWeight: 800,
                      }}
                    >
                      ⏳ 다단 MESH 기액평형 행렬 및 물질·열수지 반복 수렴 계산 중입니다...
                    </div>
                  );
                }
                return (
                  <>
                    {isSimDirty ? (
                      <div
                        style={{
                          padding: '10px 13px',
                          borderRadius: 8,
                          background: '#FFFBEB',
                          border: '1.5px solid #D97706',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 900, color: '#92400E' }}>
                            ⏸ 조건 변경됨 — [▶ RUN] 실행 시 프로파일이 갱신됩니다.
                          </div>
                        </div>
                        {onRunSimulation && (
                          <button
                            type="button"
                            onClick={triggerRunSimulation}
                            disabled={!dofEvaluation.canRun}
                            title={!dofEvaluation.canRun ? dofEvaluation.hint : '시뮬레이션 실행'}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 6,
                              border: !dofEvaluation.canRun ? '1px solid #64748B' : '1px solid #B45309',
                              background: !dofEvaluation.canRun ? '#475569' : '#D97706',
                              color: '#FFFFFF',
                              fontSize: 11,
                              fontWeight: 900,
                              cursor: !dofEvaluation.canRun ? 'not-allowed' : 'pointer',
                              opacity: !dofEvaluation.canRun ? 0.65 : 1,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            ▶ RUN 실행
                          </button>
                        )}
                      </div>
                    ) : diag ? (() => {
                      const isErr = diag.level === 'error';
                      const isWarn = diag.level === 'warning';
                      const boxBg = isErr ? '#FEF2F2' : isWarn ? '#FFFBEB' : '#ECFDF5';
                      const boxBd = isErr ? '#DC2626' : isWarn ? '#D97706' : '#059669';
                      const titleCol = isErr ? '#991B1B' : isWarn ? '#92400E' : '#065F46';
                      const icon = isErr ? '✕' : isWarn ? '⚠' : '✓';

                      return (
                        <div
                          style={{
                            padding: '10px 13px',
                            borderRadius: 8,
                            background: boxBg,
                            border: `1.5px solid ${boxBd}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 900, color: titleCol }}>
                              {icon} [{diag.badgeText}] {diag.headline}
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', fontFamily: MONO }}>
                              {result ? `내부 MESH ${result.innerIterations}회 · 외부 ${result.outerIterations}회` : ''}
                              {lastRunStamp ? ` · ${lastRunStamp} 갱신` : ''}
                            </span>
                          </div>
                          {diag.causes.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {diag.causes.map((cText, ci) => (
                                <div key={ci} style={{ fontSize: 10.8, color: '#1E293B', lineHeight: 1.4 }}>
                                  • {cText}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })() : null}

                    {/* ── 💡 수렴·스펙 달성 1-클릭 추천 조합 카드 (미수렴 · 스펙 미달 · remedies 존재 시 상시 노출) ── */}
                    {result &&
                      (!result.converged ||
                        result.diagnostics?.level !== 'ok' ||
                        (result.diagnostics?.remedies?.length ?? 0) > 0 ||
                        (result.spec1Status?.enabled && !result.spec1Status.met) ||
                        (result.spec2Status?.enabled && !result.spec2Status.met) ||
                        (result.shortcutDesign && !result.shortcutDesign.designMet) ||
                        (result.sideCutSpecStatus && !result.sideCutSpecStatus.met)) && (() => {
                        const recipes: Array<{ key: string; label: string; desc: string; patch: Partial<DistillColumnParams> }> = [];

                        // 1) 엔진 진단 remedies 우선 반영
                        for (const rem of result.diagnostics?.remedies ?? []) {
                          recipes.push({
                            key: `diag_${rem.label}`,
                            label: rem.label,
                            desc: '진단 엔진 권장 처방',
                            patch: rem.patch,
                          });
                        }

                        // 2) 내장 Fallback Recipe 1: 고정 운전 (① 환류비 + ② D/F) 안정 수렴 모드 전환
                        const estSFrac = sideCutEnabled
                          ? sideCutCfg.specType === 's_over_f_mass' || sideCutCfg.specType === 's_over_f_mole'
                            ? sideCutCfg.specValue
                            : sideCutCfg.specType === 'mass_kgh' && totalFeedKgH > 0
                            ? sideCutCfg.specValue / totalFeedKgH
                            : 0.15
                          : 0;
                        const feedLkMassEst =
                          feeds.reduce((s, f) => s + (f.flowsKgH[defLkGlobal] || 0), 0) ||
                          totalFeedKgH * 0.35;
                        const rawEstDf =
                          totalFeedKgH > 0
                            ? feedLkMassEst / totalFeedKgH
                            : result.actualDOverFMass || 0.35;
                        const safeDF = Number(
                          Math.max(0.03, Math.min(0.88 - Math.min(0.75, estSFrac), rawEstDf)).toFixed(4)
                        );
                        const safeRR = Number(
                          Math.min(6.0, Math.max(1.5, result.actualRefluxRatio || topSpecValue || 2.5)).toFixed(2)
                        );
                        if (
                          !recipes.some((r) => r.label.includes('① 환류비') && r.label.includes('②'))
                        ) {
                          recipes.push({
                            key: 'builtin_fixed_rr_df',
                            label: `고정 운전 (① 환류비 RR=${safeRR} + ② D/F=${safeDF}) 안정 수렴 모드 전환`,
                            desc: '품질 역산 루프를 해제하고 추정 물리 유량비로 즉시 수렴',
                            patch: {
                              columnCalcMode: 'rigorous_mesh',
                              activeDofSlots: ['rr', 'split'],
                              autoOptimizeStagesOnDualSpec: false,
                              topSpecType: 'reflux_ratio',
                              topSpecValue: safeRR,
                              splitSpecType: 'd_over_f_mass',
                              splitSpecValue: safeDF,
                            },
                          });
                        }

                        // 3) 내장 Fallback Recipe 2: 사이드컷(⑤) 발출량/회수율 안전 범위(0.7배)로 완화
                        if (sideCutEnabled) {
                          let relaxedVal = sideCutCfg.specValue;
                          if (
                            sideCutCfg.specType === 'mass_kgh' ||
                            sideCutCfg.specType === 's_over_f_mass' ||
                            sideCutCfg.specType === 's_over_f_mole' ||
                            sideCutCfg.specType === 'draw_ratio'
                          ) {
                            relaxedVal = Number(Math.max(0.02, sideCutCfg.specValue * 0.7).toFixed(4));
                          } else if (sideCutCfg.specType === 'recovery_pct') {
                            relaxedVal = Number(Math.max(15, sideCutCfg.specValue * 0.7).toFixed(2));
                          } else if (sideCutCfg.specType === 'purity_wt_pct') {
                            relaxedVal = Number(Math.max(70, Math.min(95, sideCutCfg.specValue - 2.5)).toFixed(2));
                          } else if (sideCutCfg.specType === 'impurity_ppm') {
                            relaxedVal = Math.min(100000, Math.round(sideCutCfg.specValue * 2));
                          }
                          recipes.push({
                            key: 'builtin_relax_sidecut',
                            label: `사이드컷(⑤) 발출량/회수율 안전 범위(0.7배 → ${relaxedVal})로 완화`,
                            desc: '단 내부 기액 트래픽 과부하·플러딩 방지 및 최적단 탐색',
                            patch: {
                              sideCut: {
                                ...sideCutCfg,
                                specValue: relaxedVal,
                                autoOptimizeStage: true,
                              },
                            },
                          });
                        }

                        // 4) 내장 Fallback Recipe 3: 고정 단수(⓪) 해제 → AI 최적 단수·피드단 자동 탐색
                        if (isFixedStages) {
                          const hasTopSlot = selectedSlots.includes('top_spec');
                          const nextSlotsForAuto: DistillDofSlotId[] =
                            sideCutEnabled && !hasTopSlot ? ['bot_spec'] : ['top_spec', 'bot_spec'];
                          recipes.push({
                            key: 'builtin_auto_stages',
                            label: '고정 단수(⓪) 해제 → AI 최적 단수·피드단 자동 탐색',
                            desc: '단수·공급단·환류비를 목표 순도 기준으로 자동 최적화',
                            patch: {
                              columnCalcMode: 'design_stages',
                              activeDofSlots: nextSlotsForAuto,
                              designRefluxMode: 'auto_opt',
                              designOmitTopPurity: Boolean(sideCutEnabled && !hasTopSlot),
                            },
                          });
                        }

                        // 5) 내장 Fallback Recipe 4: 목표 순도 현실화 & 환류비 상향
                        const hasEndpointUnmet = Boolean(
                          (result.spec1Status?.enabled && !result.spec1Status.met) ||
                            (result.spec2Status?.enabled && !result.spec2Status.met) ||
                            (result.shortcutDesign && !result.shortcutDesign.designMet)
                        );
                        if (hasEndpointUnmet || selectedSlots.includes('bot_spec') || selectedSlots.includes('top_spec')) {
                          const higherRR = Number(
                            Math.min(12.0, Math.max(2.5, (result.actualRefluxRatio || topSpecValue || 2.5) * 1.35)).toFixed(2)
                          );
                          const nextTopTgt =
                            uiTopMetric === 'impurity_wt_ppm'
                              ? Math.min(50000, Math.round(uiTopTarget * 2.5))
                              : uiTopMetric === 'recovery_pct'
                              ? Number(Math.max(85, Math.min(97.5, uiTopTarget - 1.5)).toFixed(2))
                              : Number(Math.max(85, Math.min(98.5, uiTopTarget - 1.2)).toFixed(2));
                          const nextBotTgt =
                            uiBotMetric === 'impurity_wt_ppm'
                              ? Math.min(50000, Math.round(uiBotTarget * 2.5))
                              : uiBotMetric === 'recovery_pct'
                              ? Number(Math.max(85, Math.min(97.5, uiBotTarget - 1.5)).toFixed(2))
                              : Number(Math.max(85, Math.min(98.5, uiBotTarget - 1.2)).toFixed(2));
                          recipes.push({
                            key: 'builtin_realistic_purity_rr',
                            label: `목표 순도 현실화 & 환류비 상향 (RR=${higherRR})`,
                            desc: '공비·다성분 물리 한계를 반영해 목표치 완화 및 분리도 강화',
                            patch: {
                              topSpecType: 'reflux_ratio',
                              topSpecValue: higherRR,
                              designFixedRR: higherRR,
                              ...(selectedSlots.includes('top_spec') ? { topQualityTarget: nextTopTgt } : {}),
                              ...(selectedSlots.includes('bot_spec') ? { botQualityTarget: nextBotTgt } : {}),
                            },
                          });
                        }

                        return (
                          <div
                            style={{
                              padding: '10px 12px',
                              borderRadius: 9,
                              background: '#F5F3FF',
                              border: '1.5px solid #8B5CF6',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 7,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11.8, fontWeight: 900, color: '#4C1D95' }}>
                                💡 수렴·스펙 달성 추천 조합 (클릭 1회로 조건 변경 &amp; 즉시 재실행)
                              </span>
                              <button
                                type="button"
                                onClick={runAiAutoFixDistill}
                                disabled={isAiBusy}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  border: '1px solid #6D28D9',
                                  background: '#6D28D9',
                                  color: '#FFFFFF',
                                  fontSize: 10.5,
                                  fontWeight: 900,
                                  cursor: isAiBusy ? 'wait' : 'pointer',
                                }}
                              >
                                {isAiBusy ? (aiStepLabel || '⏳ AI 해결 탐색 중...') : '✨ AI 전수 자동 해결'}
                              </button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {recipes.map((rec) => (
                                <button
                                  key={rec.key}
                                  type="button"
                                  onClick={() => applyPatchAndRun(rec.patch)}
                                  style={{
                                    padding: '7px 10px',
                                    borderRadius: 7,
                                    border: '1px solid #C4B5FD',
                                    background: '#FFFFFF',
                                    color: '#1E293B',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: 8,
                                  }}
                                >
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 11, fontWeight: 900, color: '#5B21B6' }}>
                                      ▶ {rec.label}
                                    </div>
                                    <div style={{ fontSize: 9.8, color: '#64748B', marginTop: 1 }}>
                                      {rec.desc}
                                    </div>
                                  </div>
                                  <span
                                    style={{
                                      flexShrink: 0,
                                      padding: '2px 7px',
                                      borderRadius: 5,
                                      background: '#EDE9FE',
                                      color: '#5B21B6',
                                      fontSize: 9.8,
                                      fontWeight: 900,
                                    }}
                                  >
                                    즉시 적용·실행
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                  </>
                );
              })()}

              {/* 탭 2: 탑·피드단 구성 */}
              {leftTab === 'tower' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {!isFixedStages && (
                    <div
                      style={{
                        padding: '8px 11px',
                        borderRadius: 7,
                        background: '#EFF6FF',
                        border: '1px solid #93C5FD',
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#1E3A8A',
                      }}
                    >
                      ✨ 현재 <b>AI 최적 단수·피드단 자동 탐색 모드</b> (⓪ 해제)입니다. 단수(N)·피드단(Nf)을 직접 고정하려면 [① 운전·설계 변수] 탭에서 <b>⓪ 고정 단수 지정</b>을 체크하세요.
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    <div style={cardStyle}>
                      <label style={labelStyle}>
                        {isActualMurphreeUi
                          ? '총 실제단수 N (1=응축기, N=리보일러 · 행렬 내 η_M)'
                          : '총 이론단수 N (1=응축기, N=리보일러)'}
                      </label>
                      <BufferedNumberInput
                        syncKey={`${unitTag}-nstages`}
                        min={4}
                        max={200}
                        step={1}
                        disabled={!isFixedStages}
                        value={N}
                        onValueChange={(rawN) => {
                          const nextN = Math.max(4, Math.min(200, Math.round(rawN || 24)));
                          onChangeConfig({
                            totalStages: nextN,
                            feedStage: Math.min(nextN - 1, Math.max(2, primaryFeedStage)),
                            ...(config.sideCut
                              ? {
                                  sideCut: {
                                    ...config.sideCut,
                                    stage: Math.max(2, Math.min(nextN - 1, config.sideCut.stage)),
                                  },
                                }
                              : {}),
                          });
                        }}
                        onEnterRun={() => {
                          if (dofEvaluation.canRun) triggerRunSimulation();
                        }}
                        style={{
                          ...inputBaseStyle,
                          background: !isFixedStages ? '#F1F5F9' : '#FFFFFF',
                          color: !isFixedStages ? '#64748B' : '#1A2F44',
                        }}
                      />
                      <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 4 }}>
                        {isActualMurphreeUi ? (
                          <>실제 트레이 <b>{actualTrays}단</b> (MESH 행렬 내 η_M={murphreeEff}% 직접 반영)</>
                        ) : (
                          <>단효율 {murphreeEff}% 적용 시 실제 트레이 약 <b>{actualTrays}단</b></>
                        )}
                      </div>
                    </div>

                    <div style={cardStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <label style={{ ...labelStyle, marginBottom: 0 }}>
                          주 공급단 (Primary Feed Stage)
                        </label>
                        {isFixedStages && recFeedStage !== primaryFeedStage && (
                          <button
                            type="button"
                            onClick={() => onChangeConfig({ feedStage: recFeedStage })}
                            style={{
                              padding: '2px 7px',
                              borderRadius: 4,
                              border: '1px solid #2563EB',
                              background: '#EFF6FF',
                              color: '#1D4ED8',
                              fontSize: 10,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            최적 {recFeedStage}단 적용
                          </button>
                        )}
                      </div>
                      <BufferedNumberInput
                        syncKey={`${unitTag}-pfeed`}
                        min={2}
                        max={N - 1}
                        step={1}
                        disabled={!isFixedStages}
                        value={primaryFeedStage}
                        onValueChange={(rawF) =>
                          onChangeConfig({
                            feedStage: Math.max(2, Math.min(N - 1, Math.round(rawF || 10))),
                          })
                        }
                        onEnterRun={() => {
                          if (dofEvaluation.canRun) triggerRunSimulation();
                        }}
                        style={{
                          ...inputBaseStyle,
                          background: !isFixedStages ? '#F1F5F9' : '#FFFFFF',
                          color: !isFixedStages ? '#64748B' : '#1A2F44',
                        }}
                      />
                      <div style={{ fontSize: 10.5, color: '#475569', fontWeight: 700, marginTop: 4 }}>
                        조성 정합 기준 권장 공급단: <b>제 {recFeedStage} 단</b>
                      </div>
                    </div>
                  </div>

                  {/* 동기화된 사이드컷(측류) 단 위치 컴팩트 카드 */}
                  <div
                    style={{
                      ...cardStyle,
                      padding: '9px 12px',
                      border: sideCutEnabled ? '1.5px solid #7C3AED' : '1px solid #CBD5E1',
                      background: sideCutEnabled ? '#FAF5FF' : '#FFFFFF',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          fontSize: 11.5,
                          fontWeight: 900,
                          color: sideCutEnabled ? '#4C1D95' : '#334155',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={sideCutEnabled}
                          onChange={toggleSideCutEnabled}
                          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7C3AED' }}
                        />
                        <span>사이드컷 (측류 인출 · Side-Cut) 단 위치</span>
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {sideCutEnabled && result?.sideCutStageUsed && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              padding: '1px 7px',
                              borderRadius: 999,
                              background: '#EDE9FE',
                              color: '#5B21B6',
                              fontFamily: MONO,
                            }}
                          >
                            실제 {result.sideCutStageUsed}단 · {(result.sideCutMassKgH ?? 0).toFixed(1)} kg/h
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setLeftTab('specs')}
                          style={{
                            padding: '2px 8px',
                            borderRadius: 5,
                            border: '1px solid #C4B5FD',
                            background: '#FFFFFF',
                            color: '#6D28D9',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          변수 상세설정 →
                        </button>
                      </div>
                    </div>

                    {sideCutEnabled && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: isMobile ? '1fr' : '1fr 0.85fr 1.15fr',
                          gap: 8,
                          marginTop: 8,
                          alignItems: 'end',
                        }}
                      >
                        <div>
                          <label style={labelStyle}>인출 상 (Phase)</label>
                          <select
                            value={sideCutCfg.phase}
                            onChange={(e) =>
                              updateSideCut({ phase: e.target.value as SideCutPhase })
                            }
                            style={selectBaseStyle}
                          >
                            <option value="liquid">💧 액상 (Liquid)</option>
                            <option value="vapor">💨 기상 (Vapor)</option>
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>인출 단 (2 ~ {Math.max(2, N - 1)})</label>
                          <BufferedNumberInput
                            syncKey={`${unitTag}-scstage-tower-${sideCutCfg.autoOptimizeStage ? 'auto' : 'man'}`}
                            min={2}
                            max={Math.max(2, N - 1)}
                            step={1}
                            disabled={Boolean(sideCutCfg.autoOptimizeStage)}
                            value={Math.max(
                              2,
                              Math.min(Math.max(2, N - 1), Math.round(sideCutCfg.stage || 2))
                            )}
                            onValueChange={(v) =>
                              updateSideCut({
                                stage: Math.max(
                                  2,
                                  Math.min(Math.max(2, N - 1), Math.round(v || 2))
                                ),
                              })
                            }
                            onEnterRun={() => {
                              if (dofEvaluation.canRun) triggerRunSimulation();
                            }}
                            style={{
                              ...inputBaseStyle,
                              background: sideCutCfg.autoOptimizeStage ? '#F1F5F9' : '#FFFFFF',
                              color: sideCutCfg.autoOptimizeStage ? '#64748B' : '#1A2F44',
                            }}
                          />
                        </div>
                        <div style={{ paddingBottom: 5 }}>
                          <label
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              fontSize: 10.5,
                              fontWeight: 800,
                              color: '#5B21B6',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(sideCutCfg.autoOptimizeStage)}
                              onChange={(e) =>
                                updateSideCut({ autoOptimizeStage: e.target.checked })
                              }
                              style={{ width: 13.5, height: 13.5, cursor: 'pointer', accentColor: '#7C3AED' }}
                            />
                            <span>✨ 최적 인출단 자동탐색</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    <div style={cardStyle}>
                      <label style={labelStyle}>탑정 응축기 (Stage 1 Condenser)</label>
                      <select
                        value={condenserType}
                        onChange={(e) =>
                          onChangeConfig({ condenserType: e.target.value as DistillCondenserType })
                        }
                        style={selectBaseStyle}
                      >
                        <option value="total">전응축기 (Total Condenser — 액상 유출 D)</option>
                        <option value="partial">부분응축기 (Partial Condenser — 기상 유출 D)</option>
                        <option value="decanter_ech">공비 디캔터 응축기 (유기층 환류 · 수층 분리)</option>
                      </select>
                    </div>

                    <div style={cardStyle}>
                      <label style={labelStyle}>탑저 리보일러 (Stage N Reboiler)</label>
                      <select
                        value={reboilerType}
                        onChange={(e) =>
                          onChangeConfig({ reboilerType: e.target.value as DistillReboilerType })
                        }
                        style={selectBaseStyle}
                      >
                        <option value="kettle">케틀형 리보일러 (Kettle Reboiler)</option>
                        <option value="thermosyphon">써모사이펀 리보일러 (Thermosyphon)</option>
                        <option value="live_steam">직접 생증기 취입 (Live Steam Stripping)</option>
                      </select>
                    </div>
                  </div>

                  {/* 다중 유입 피드 배관별 공급단 테이블 */}
                  <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: '#1A2F44' }}>
                        연결된 유입 피드 배관 ({feeds.length}개 · 총 {totalFeedKgH.toFixed(1)} kg/h)
                      </span>
                      <span style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>
                        다중 피드(주원료 + 순환액) 개별 투입단 지정 가능
                      </span>
                    </div>
                    {feeds.length === 0 ? (
                      <div style={{ fontSize: 11, color: '#94A3B8', padding: '8px 0' }}>
                        연결된 유입 피드가 없습니다. 캔버스에서 원료 배관을 증류탑 좌측 포트에 연결하세요.
                      </div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                        <thead>
                          <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
                            <th style={{ padding: '5px 8px', textAlign: 'left' }}>배관 번호</th>
                            <th style={{ padding: '5px 8px', textAlign: 'right' }}>유량 (kg/h)</th>
                            <th style={{ padding: '5px 8px', textAlign: 'right' }}>온도 / 압력</th>
                            <th style={{ padding: '5px 8px', textAlign: 'right' }}>투입 단번호 (2~{N - 1})</th>
                          </tr>
                        </thead>
                        <tbody>
                          {feeds.map((f) => {
                            const fMass = SIM_COMPS.reduce((s, k) => s + (f.flowsKgH[k] || 0), 0);
                            const stNum = config.feedStageMap?.[f.edgeId] ?? f.stage ?? primaryFeedStage;
                            return (
                              <tr key={f.edgeId} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                <td style={{ padding: '5px 8px', fontWeight: 800, fontFamily: MONO }}>
                                  [{f.streamNo}]
                                </td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: MONO }}>
                                  {fMass.toFixed(1)}
                                </td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: MONO, color: '#475569' }}>
                                  {f.tempC.toFixed(1)}°C / {f.pressKgcm2g.toFixed(2)} kG
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                  <BufferedNumberInput
                                    syncKey={`${unitTag}-ef-${f.edgeId}`}
                                    min={2}
                                    max={N - 1}
                                    step={1}
                                    value={stNum}
                                    onValueChange={(v) =>
                                      updateFeedStageForEdge(f.edgeId, v || primaryFeedStage)
                                    }
                                    onEnterRun={() => {
                                      if (dofEvaluation.canRun) triggerRunSimulation();
                                    }}
                                    style={{ ...inputBaseStyle, width: 72, height: 26, textAlign: 'right' }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {/* 탭 1 (통합): ⓪ 고정 단수 + ①~⑤ 운전·설계 변수 선택 (순차 자유도 가이드) */}
              {leftTab === 'specs' && (() => {
                const isRrSel = selectedSlots.includes('rr');
                const isSplitSel = selectedSlots.includes('split');
                const isTopSel = selectedSlots.includes('top_spec');
                const isBotSel = selectedSlots.includes('bot_spec');

                const topCompFormula = COMP_META[uiTopComp]?.formula ?? uiTopComp;
                const botCompFormula = COMP_META[uiBotComp]?.formula ?? uiBotComp;

                const toggleFixedStages = (checked: boolean) => {
                  if (checked) {
                    const nextSlots: DistillDofSlotId[] =
                      selectedSlots.length >= 2
                        ? selectedSlots.slice(0, 2)
                        : selectedSlots.length === 1
                        ? selectedSlots[0] === 'rr'
                          ? ['rr', 'split']
                          : ['rr', selectedSlots[0]]
                        : ['rr', 'split'];
                    applyUnifiedConfigChange({
                      columnCalcMode: 'rigorous_mesh',
                      activeDofSlots: nextSlots,
                      totalStages: config.totalStages ?? result?.totalStagesUsed ?? 24,
                      feedStage: config.feedStage ?? result?.feedStageUsed ?? 12,
                      autoOptimizeStagesOnDualSpec: false,
                      designOmitTopPurity: false,
                    });
                  } else {
                    const nextSlots: DistillDofSlotId[] =
                      selectedSlots.length === 0 ? ['top_spec', 'bot_spec'] : selectedSlots;
                    applyUnifiedConfigChange({
                      columnCalcMode: 'design_stages',
                      activeDofSlots: nextSlots,
                      designRefluxMode: nextSlots.includes('rr') ? 'fixed_rr' : 'auto_opt',
                    });
                  }
                };

                const renderSlotHeader = (
                  slotId: DistillDofSlotId,
                  titleText: string,
                  autoSummaryText: string
                ) => {
                  const selIdx = selectedSlots.indexOf(slotId);
                  const isSel = selIdx >= 0;
                  const canAdd =
                    !isSel &&
                    (isFixedStages
                      ? selectedSlots.length < 2
                      : slotId === 'split'
                      ? !isTopSel
                      : true);
                  return (
                    <div
                      onClick={() => toggleDofSlot(slotId)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        cursor: 'pointer',
                        marginBottom: isSel ? 9 : 0,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleDofSlot(slotId)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#2563EB' }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 900,
                            color: isSel ? '#0F172A' : '#334155',
                          }}
                        >
                          {titleText}
                        </span>
                      </div>

                      {isSel ? (
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: '#2563EB',
                            color: '#FFFFFF',
                            fontSize: 10,
                            fontWeight: 900,
                          }}
                        >
                          ✓ 선택됨 (클릭 시 해제)
                        </span>
                      ) : canAdd ? (
                        <span
                          style={{
                            padding: '2px 9px',
                            borderRadius: 999,
                            background: '#EFF6FF',
                            color: '#1D4ED8',
                            border: '1px solid #93C5FD',
                            fontSize: 10.5,
                            fontWeight: 900,
                          }}
                        >
                          + 클릭하여 선택
                        </span>
                      ) : (
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: '#E2E8F0',
                            color: '#475569',
                            fontSize: 10,
                            fontWeight: 800,
                            fontFamily: MONO,
                          }}
                        >
                          자동 계산됨 · {autoSummaryText}
                        </span>
                      )}
                    </div>
                  );
                };

                const slotCardBoxStyle = (isSel: boolean, slotId: DistillDofSlotId): React.CSSProperties => {
                  const canAdd =
                    !isSel &&
                    (isFixedStages
                      ? selectedSlots.length < 2
                      : slotId === 'split'
                      ? !isTopSel
                      : true);
                  if (isSel) {
                    return {
                      ...cardStyle,
                      border: '1.5px solid #2563EB',
                      background: '#FFFFFF',
                      boxShadow: '0 1px 4px rgba(37,99,235,0.08)',
                    };
                  }
                  if (canAdd) {
                    return {
                      ...cardStyle,
                      border: '1.5px dashed #93C5FD',
                      background: '#F8FAFC',
                    };
                  }
                  return {
                    ...cardStyle,
                    border: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    opacity: 0.85,
                  };
                };

                const dofBannerColors =
                  dofEvaluation.statusLevel === 'ok'
                    ? { bg: '#F0FDF4', bd: '#86EFAC', fg: '#166534' }
                    : dofEvaluation.statusLevel === 'error'
                    ? { bg: '#FEF2F2', bd: '#FCA5A5', fg: '#991B1B' }
                    : { bg: '#FFFBEB', bd: '#FCD34D', fg: '#92400E' };

                const effRMode: DistillRefluxDesignMode =
                  config.designRefluxMode ??
                  (typeof config.designRefluxMult === 'number' ? 'r_mult' : 'auto_opt');

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* ⓪ 고정 단수 지정 (N · Nf) 체크박스 카드 */}
                    <div
                      style={{
                        ...cardStyle,
                        border: isFixedStages ? '1.5px solid #1E3A8A' : '1.5px solid #059669',
                        background: isFixedStages ? '#FFFFFF' : '#F0FDF4',
                      }}
                    >
                      <div
                        onClick={() => toggleFixedStages(!isFixedStages)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={isFixedStages}
                            onChange={(e) => toggleFixedStages(e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1E3A8A' }}
                          />
                          <span style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                            ⓪ 고정 단수 지정 (N · Nf)
                          </span>
                        </div>
                        <span
                          style={{
                            padding: '2px 9px',
                            borderRadius: 999,
                            background: isFixedStages ? '#EFF6FF' : '#DCFCE7',
                            color: isFixedStages ? '#1E3A8A' : '#166534',
                            border: isFixedStages ? '1px solid #93C5FD' : '1px solid #86EFAC',
                            fontSize: 10,
                            fontWeight: 900,
                          }}
                        >
                          {isFixedStages
                            ? `고정 단수 정밀모사 (N=${N}단 · 피드 ${primaryFeedStage}단)`
                            : '✨ 해제됨: AI 최적 단수(N)·피드단(Nf) 자동 설계'}
                        </span>
                      </div>

                      {isFixedStages ? (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                            gap: 8,
                            marginTop: 9,
                            paddingTop: 8,
                            borderTop: '1px solid #E2E8F0',
                          }}
                        >
                          <div>
                            <label style={labelStyle}>
                              {isActualMurphreeUi ? '총 실제단수 N' : '총 이론단수 N'} (1=응축, N=리보일러)
                            </label>
                            <BufferedNumberInput
                              syncKey={`${unitTag}-nstages-spec`}
                              min={4}
                              max={200}
                              step={1}
                              value={N}
                              onValueChange={(rawN) => {
                                const nextN = Math.max(4, Math.min(200, Math.round(rawN || 24)));
                                applyUnifiedConfigChange({
                                  totalStages: nextN,
                                  feedStage: Math.min(nextN - 1, Math.max(2, primaryFeedStage)),
                                  ...(config.sideCut
                                    ? {
                                        sideCut: {
                                          ...config.sideCut,
                                          stage: Math.max(2, Math.min(nextN - 1, config.sideCut.stage)),
                                        },
                                      }
                                    : {}),
                                });
                              }}
                              onEnterRun={() => {
                                if (dofEvaluation.canRun) triggerRunSimulation();
                              }}
                              style={inputBaseStyle}
                            />
                          </div>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <label style={{ ...labelStyle, marginBottom: 0 }}>
                                주 공급단 Nf (2 ~ {N - 1}단)
                              </label>
                              {recFeedStage !== primaryFeedStage && (
                                <button
                                  type="button"
                                  onClick={() => applyUnifiedConfigChange({ feedStage: recFeedStage })}
                                  style={{
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    border: '1px solid #2563EB',
                                    background: '#EFF6FF',
                                    color: '#1D4ED8',
                                    fontSize: 9.8,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  최적 {recFeedStage}단
                                </button>
                              )}
                            </div>
                            <BufferedNumberInput
                              syncKey={`${unitTag}-pfeed-spec`}
                              min={2}
                              max={N - 1}
                              step={1}
                              value={primaryFeedStage}
                              onValueChange={(rawF) =>
                                applyUnifiedConfigChange({
                                  feedStage: Math.max(2, Math.min(N - 1, Math.round(rawF || 10))),
                                })
                              }
                              onEnterRun={() => {
                                if (dofEvaluation.canRun) triggerRunSimulation();
                              }}
                              style={inputBaseStyle}
                            />
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid #BBF7D0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ fontSize: 10.5, color: '#166534', fontWeight: 700, lineHeight: 1.4 }}>
                            💡 체크 해제 시 목표 스펙을 만족하는 최적 이론단수(N)·공급단(Nf)을 TAC 최소 기준으로 자동 탐색합니다.
                            {!isRrSel && ' (환류비 ① 미선택 시 R도 함께 자동 최적화)'}
                          </div>
                          {!isRrSel && (
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 0.8fr', gap: 8, alignItems: 'end' }}>
                              <div>
                                <label style={labelStyle}>자동 환류비(R) 탐색 기준</label>
                                <select
                                  value={effRMode === 'fixed_rr' ? 'auto_opt' : effRMode}
                                  onChange={(e) =>
                                    applyUnifiedConfigChange({
                                      designRefluxMode: e.target.value as DistillRefluxDesignMode,
                                    })
                                  }
                                  style={selectBaseStyle}
                                >
                                  <option value="auto_opt">✨ AI 다중후보 TAC 최소 최적화 (1.15~1.80 × R_min)</option>
                                  <option value="r_mult">최소환류비 배수 지정 (R = 배수 × R_min)</option>
                                </select>
                              </div>
                              {effRMode === 'r_mult' && (
                                <div>
                                  <label style={labelStyle}>R / R_min 배수</label>
                                  <BufferedNumberInput
                                    syncKey={`${unitTag}-rmult`}
                                    min={1.05}
                                    max={5.0}
                                    step={0.05}
                                    value={config.designRefluxMult ?? 1.25}
                                    onValueChange={(v) => applyUnifiedConfigChange({ designRefluxMult: v })}
                                    onEnterRun={() => {
                                      if (dofEvaluation.canRun) triggerRunSimulation();
                                    }}
                                    style={inputBaseStyle}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 순차 자유도(DOF) 실시간 상태 & 다음 선택 안내 스트립 */}
                    <div
                      style={{
                        padding: '9px 12px',
                        borderRadius: 8,
                        background: dofBannerColors.bg,
                        border: `1.5px solid ${dofBannerColors.bd}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: '#FFFFFF',
                              border: `1px solid ${dofBannerColors.bd}`,
                              color: dofBannerColors.fg,
                              fontSize: 10.5,
                              fontWeight: 900,
                              fontFamily: MONO,
                            }}
                          >
                            선택된 자유도: {dofEvaluation.selectedCount} / 필요 {dofEvaluation.requiredCount}
                          </span>
                          <span style={{ fontSize: 11.5, fontWeight: 900, color: dofBannerColors.fg }}>
                            {dofEvaluation.headline}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyUnifiedConfigChange({ activeDofSlots: [] })}
                          style={{
                            padding: '3px 9px',
                            borderRadius: 5,
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#334155',
                            fontSize: 10.5,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          조건 다시 선택 (초기화)
                        </button>
                      </div>
                      <div style={{ fontSize: 10.8, fontWeight: 700, color: '#1E293B', lineHeight: 1.45 }}>
                        {dofEvaluation.hint}
                      </div>
                    </div>

                    {/* 후보 ①: 탑정 응축기 운전조건 (RR / 환류량 / 재비율) */}
                    <div style={slotCardBoxStyle(isRrSel, 'rr')}>
                      {renderSlotHeader(
                        'rr',
                        '① 탑정 응축기 운전조건 (환류비 RR = L₀/D · 환류량 · 재비율)',
                        result ? `RR = ${result.actualRefluxRatio.toFixed(2)}` : '시뮬레이션 시 역산'
                      )}
                      {isRrSel && (
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.35fr 1fr', gap: 8 }}>
                          <div>
                            <label style={labelStyle}>환류/재비 입력 방식</label>
                            <select
                              value={isFixedStages ? topSpecType : 'reflux_ratio'}
                              disabled={!isFixedStages}
                              onChange={(e) =>
                                applyUnifiedConfigChange({
                                  topSpecType: e.target.value as DistillTopSpecType,
                                })
                              }
                              style={{
                                ...selectBaseStyle,
                                background: !isFixedStages ? '#F1F5F9' : '#FFFFFF',
                              }}
                            >
                              <option value="reflux_ratio">몰 환류비 (Reflux Ratio, RR = L₀/D)</option>
                              <option value="reflux_mass_kgh">환류 액상 유량 L₀ (kg/h)</option>
                              <option value="boilup_ratio">리보일러 재비율 (Boilup Ratio, VB/B)</option>
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>
                              {isFixedStages && topSpecType === 'reflux_mass_kgh'
                                ? '환류 액상 유량 (kg/h)'
                                : isFixedStages && topSpecType === 'boilup_ratio'
                                ? '재비율 (VB/B)'
                                : '운전 환류비 (RR)'}
                            </label>
                            <BufferedNumberInput
                              syncKey={`${unitTag}-topspec`}
                              step={0.1}
                              min={0.05}
                              value={topSpecValue}
                              onValueChange={(v) => {
                                const val = Math.max(0.05, v || 1.5);
                                applyUnifiedConfigChange({
                                  topSpecValue: val,
                                  designFixedRR: val,
                                });
                              }}
                              onEnterRun={() => {
                                if (dofEvaluation.canRun) triggerRunSimulation();
                              }}
                              style={inputBaseStyle}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 후보 ②: 유량·분할 조건 (D/F, B/F, D, B) */}
                    <div style={slotCardBoxStyle(isSplitSel, 'split')}>
                      {renderSlotHeader(
                        'split',
                        '② 유량·분할 조건 (D/F · B/F · 탑정/탑저 유량 kg/h)',
                        result
                          ? `D=${distTotalKgH.toFixed(1)} kg/h (D/F=${result.actualDOverFMass.toFixed(3)})`
                          : '시뮬레이션 시 역산'
                      )}
                      {isSplitSel && (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.35fr 1fr', gap: 8 }}>
                            <div>
                              <label style={labelStyle}>유출 분배 입력 방식</label>
                              <select
                                value={splitSpecType}
                                onChange={(e) =>
                                  applyUnifiedConfigChange({
                                    splitSpecType: e.target.value as DistillSplitSpecType,
                                  })
                                }
                                style={selectBaseStyle}
                              >
                                <option value="d_over_f_mass">탑정 대 피드 질량비 (D/F, kg/kg)</option>
                                <option value="b_over_f_mass">탑저 대 피드 질량비 (B/F, kg/kg)</option>
                                <option value="d_over_f_mole">탑정 대 피드 몰비 (D/F, kmol/kmol)</option>
                                <option value="distillate_kgh">탑정 유출 유량 D (kg/h)</option>
                                <option value="bottoms_kgh">탑저 관출 유량 B (kg/h)</option>
                              </select>
                            </div>
                            <div>
                              <label style={labelStyle}>
                                {splitSpecType === 'distillate_kgh'
                                  ? '탑정 유출 유량 D (kg/h)'
                                  : splitSpecType === 'bottoms_kgh'
                                  ? '탑저 관출 유량 B (kg/h)'
                                  : '분배 비율 수치'}
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-splitspec`}
                                step={splitSpecType.includes('kgh') ? 10 : 0.01}
                                min={0.0001}
                                value={splitSpecValue}
                                onValueChange={(v) =>
                                  applyUnifiedConfigChange({
                                    splitSpecValue: Math.max(0.0001, v || 0.5),
                                  })
                                }
                                onEnterRun={() => {
                                  if (dofEvaluation.canRun) triggerRunSimulation();
                                }}
                                style={inputBaseStyle}
                              />
                            </div>
                          </div>
                          <div
                            style={{
                              marginTop: 7,
                              padding: '4px 8px',
                              borderRadius: 5,
                              background: '#F8FAFC',
                              border: '1px solid #E2E8F0',
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: '#1E3A8A',
                              fontFamily: MONO,
                            }}
                          >
                            ⇄ {complementRatioText}
                            {!isFixedStages && sideCutEnabled && !isTopSel
                              ? ' (사이드컷 모드 탑정 퍼지 비율 연동)'
                              : ''}
                          </div>
                        </>
                      )}
                    </div>

                    {/* 후보 ③: 탑정 제품 순도·회수율 */}
                    <div style={slotCardBoxStyle(isTopSel, 'top_spec')}>
                      {renderSlotHeader(
                        'top_spec',
                        '③ 탑정 제품 순도·회수율 (wt% · 불순물 ppm · 회수율 %)',
                        result && activeComps[0]
                          ? `D=${distTotalKgH.toFixed(1)} kg/h`
                          : '시뮬레이션 시 자동 산출'
                      )}
                      {isTopSel && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <label style={labelStyle}>어떤 기준으로 탑정(D) 품질을 지정할까요? (택 1)</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                              {(
                                [
                                  { id: 'purity_wt_pct', lbl: '주제품 농도 (wt%)' },
                                  { id: 'impurity_wt_ppm', lbl: '불순물 상한 (wt ppm)' },
                                  { id: 'recovery_pct', lbl: '성분 회수율 (% · 선택)' },
                                ] as { id: DistillSpecMetric; lbl: string }[]
                              ).map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    const nextComp = m.id === 'impurity_wt_ppm' ? defHkGlobal : defLkGlobal;
                                    const nextTgt = m.id === 'impurity_wt_ppm' ? 200 : 99.5;
                                    applyUnifiedConfigChange({
                                      topQualityMetric: m.id,
                                      topQualityComp: nextComp,
                                      topQualityTarget: nextTgt,
                                    });
                                  }}
                                  style={{
                                    padding: '5px 6px',
                                    borderRadius: 6,
                                    border: uiTopMetric === m.id ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                                    background: uiTopMetric === m.id ? '#EFF6FF' : '#FFFFFF',
                                    color: uiTopMetric === m.id ? '#1D4ED8' : '#475569',
                                    fontSize: 10.5,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {m.lbl}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.15fr', gap: 8 }}>
                            <div>
                              <label style={labelStyle}>
                                {uiTopMetric === 'impurity_wt_ppm'
                                  ? '탑정(D)에서 억제할 불순물 성분'
                                  : uiTopMetric === 'recovery_pct'
                                  ? '탑정(D)으로 회수할 성분'
                                  : '탑정(D) 목표 제품 성분'}
                              </label>
                              <select
                                value={uiTopComp}
                                onChange={(e) =>
                                  applyUnifiedConfigChange({
                                    topQualityComp: e.target.value as SimCompKey,
                                  })
                                }
                                style={selectBaseStyle}
                              >
                                {renderCompOptGroups()}
                              </select>
                            </div>
                            <div>
                              <label style={{ ...labelStyle, color: '#0F172A' }}>
                                {uiTopMetric === 'impurity_wt_ppm'
                                  ? `탑정(D) 내 [${topCompFormula}] 허용 농도 (wt ppm)`
                                  : uiTopMetric === 'recovery_pct'
                                  ? `원료 대비 탑정(D) [${topCompFormula}] 회수율 (%)`
                                  : `탑정(D) 내 [${topCompFormula}] 목표 농도 (wt%)`}
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-topq-${uiTopMetric}`}
                                step={uiTopMetric === 'impurity_wt_ppm' ? 25 : 0.1}
                                min={0.001}
                                max={uiTopMetric === 'impurity_wt_ppm' ? 500000 : 99.9999}
                                value={uiTopTarget}
                                onValueChange={(v) => applyUnifiedConfigChange({ topQualityTarget: v })}
                                onEnterRun={() => {
                                  if (dofEvaluation.canRun) triggerRunSimulation();
                                }}
                                style={inputBaseStyle}
                              />
                            </div>
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>
                            {uiTopMetric === 'impurity_wt_ppm'
                              ? `※ 입력하신 수치는 탑정(D) 스트림 내 [${topCompFormula}]의 허용 불순물 농도(ppm = ${(uiTopTarget / 10000).toFixed(4)} wt%)입니다.`
                              : uiTopMetric === 'recovery_pct'
                              ? `※ 입력하신 수치는 유입 원료 중 탑정(D)으로 회수되는 [${topCompFormula}]의 질량 회수율(%)입니다.`
                              : `※ 입력하신 수치는 탑정(D) 스트림 내 [${topCompFormula}]의 질량 농도(wt%)입니다. 회수율(%)은 별도 입력 없이 자동 계산됩니다.`}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 후보 ④: 탑저 제품 순도·회수율·불순물 */}
                    <div style={slotCardBoxStyle(isBotSel, 'bot_spec')}>
                      {renderSlotHeader(
                        'bot_spec',
                        '④ 탑저 제품 순도·회수율·불순물 (wt% · ppm · %)',
                        result
                          ? `B=${botTotalKgH.toFixed(1)} kg/h`
                          : '시뮬레이션 시 자동 산출'
                      )}
                      {isBotSel && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <label style={labelStyle}>어떤 기준으로 탑저(B) 품질을 지정할까요? (택 1)</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                              {(
                                [
                                  { id: 'purity_wt_pct', lbl: '주제품 농도 (wt%)' },
                                  { id: 'impurity_wt_ppm', lbl: '불순물 상한 (wt ppm)' },
                                  { id: 'recovery_pct', lbl: '성분 회수율 (% · 선택)' },
                                ] as { id: DistillSpecMetric; lbl: string }[]
                              ).map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    const nextComp = m.id === 'impurity_wt_ppm' ? defLkGlobal : defHkGlobal;
                                    const nextTgt = m.id === 'impurity_wt_ppm' ? 200 : 99.0;
                                    applyUnifiedConfigChange({
                                      botQualityMetric: m.id,
                                      botQualityComp: nextComp,
                                      botQualityTarget: nextTgt,
                                    });
                                  }}
                                  style={{
                                    padding: '5px 6px',
                                    borderRadius: 6,
                                    border: uiBotMetric === m.id ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                                    background: uiBotMetric === m.id ? '#EFF6FF' : '#FFFFFF',
                                    color: uiBotMetric === m.id ? '#1D4ED8' : '#475569',
                                    fontSize: 10.5,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {m.lbl}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.15fr', gap: 8 }}>
                            <div>
                              <label style={labelStyle}>
                                {uiBotMetric === 'impurity_wt_ppm'
                                  ? '탑저(B)에서 억제할 불순물 성분'
                                  : uiBotMetric === 'recovery_pct'
                                  ? '탑저(B)로 회수할 성분'
                                  : '탑저(B) 목표 제품 성분'}
                              </label>
                              <select
                                value={uiBotComp}
                                onChange={(e) =>
                                  applyUnifiedConfigChange({
                                    botQualityComp: e.target.value as SimCompKey,
                                  })
                                }
                                style={selectBaseStyle}
                              >
                                {renderCompOptGroups()}
                              </select>
                            </div>
                            <div>
                              <label style={{ ...labelStyle, color: '#0F172A' }}>
                                {uiBotMetric === 'impurity_wt_ppm'
                                  ? `탑저(B) 내 [${botCompFormula}] 허용 농도 (wt ppm)`
                                  : uiBotMetric === 'recovery_pct'
                                  ? `원료 대비 탑저(B) [${botCompFormula}] 회수율 (%)`
                                  : `탑저(B) 내 [${botCompFormula}] 목표 농도 (wt%)`}
                              </label>
                              <BufferedNumberInput
                                syncKey={`${unitTag}-botq-${uiBotMetric}`}
                                step={uiBotMetric === 'impurity_wt_ppm' ? 25 : 0.1}
                                min={0.001}
                                max={uiBotMetric === 'impurity_wt_ppm' ? 500000 : 99.9999}
                                value={uiBotTarget}
                                onValueChange={(v) => applyUnifiedConfigChange({ botQualityTarget: v })}
                                onEnterRun={() => {
                                  if (dofEvaluation.canRun) triggerRunSimulation();
                                }}
                                style={inputBaseStyle}
                              />
                            </div>
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>
                            {uiBotMetric === 'impurity_wt_ppm'
                              ? `※ 입력하신 수치는 탑저(B) 스트림 내 [${botCompFormula}]의 허용 불순물 농도(ppm = ${(uiBotTarget / 10000).toFixed(4)} wt%)입니다.`
                              : uiBotMetric === 'recovery_pct'
                              ? `※ 입력하신 수치는 유입 원료 중 탑저(B)로 회수되는 [${botCompFormula}]의 질량 회수율(%)입니다.`
                              : `※ 입력하신 수치는 탑저(B) 스트림 내 [${botCompFormula}]의 질량 농도(wt%)입니다. 회수율(%)은 별도 입력 없이 자동 계산됩니다.`}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 후보 ⑤: 사이드컷 (측류 인출 · Side-Cut) 조건 */}
                    {renderSideCutCard()}

                    {/* AI 최적 단수·후보 비교표 (단수 자동설계 결과 존재 시 노출) */}
                    {!isFixedStages && result?.shortcutDesign && (
                      <div
                        style={{
                          padding: '11px 13px',
                          borderRadius: 9,
                          border: '1px solid #CBD5E1',
                          background: '#FFFFFF',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11.8, fontWeight: 900, color: '#0F172A' }}>
                            AI 자동설계 산출 요약 (단수 · 피드단 · 환류비 · 상하부 유량)
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              applyPatchAndRun({
                                columnCalcMode: 'rigorous_mesh',
                                activeDofSlots: ['rr', 'split'],
                                totalStages: result.shortcutDesign!.solvedStagesN,
                                feedStage: result.shortcutDesign!.solvedFeedStage,
                                topSpecType: 'reflux_ratio',
                                topSpecValue: Number(result.actualRefluxRatio.toFixed(3)),
                                splitSpecType: 'd_over_f_mass',
                                splitSpecValue: Number(result.actualDOverFMass.toFixed(4)),
                                autoOptimizeStagesOnDualSpec: false,
                                ...(config.sideCut?.enabled && result.sideCutStageUsed
                                  ? { sideCut: { ...config.sideCut, stage: result.sideCutStageUsed } }
                                  : {}),
                              })
                            }
                            style={{
                              padding: '4px 9px',
                              borderRadius: 6,
                              border: '1px solid #2563EB',
                              background: '#EFF6FF',
                              color: '#1D4ED8',
                              fontSize: 10.5,
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            산출 단수({result.shortcutDesign.solvedStagesN}단)·RR을 ⓪ 고정 단수로 확정 →
                          </button>
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                            gap: 8,
                            marginTop: 9,
                            fontFamily: MONO,
                          }}
                        >
                          <div style={{ background: '#F8FAFC', padding: '7px 9px', borderRadius: 7, border: '1px solid #E2E8F0' }}>
                            <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>산출 이론단 / 실제단</div>
                            <div style={{ fontSize: 14, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                              {result.shortcutDesign.solvedStagesN}단 / {result.shortcutDesign.solvedActualTrays}단
                            </div>
                            <div style={{ fontSize: 9.5, color: '#475569' }}>
                              N_min={result.shortcutDesign.minStagesNmin} · 피드 {result.shortcutDesign.solvedFeedStage}단
                            </div>
                          </div>
                          <div style={{ background: '#F8FAFC', padding: '7px 9px', borderRadius: 7, border: '1px solid #E2E8F0' }}>
                            <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>운전 환류비 (RR)</div>
                            <div style={{ fontSize: 14, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                              {result.actualRefluxRatio.toFixed(2)}
                            </div>
                            <div style={{ fontSize: 9.5, color: '#475569' }}>
                              R_min={result.shortcutDesign.minRefluxRmin} · α={result.shortcutDesign.alphaAvg}
                            </div>
                          </div>
                          <div style={{ background: '#F8FAFC', padding: '7px 9px', borderRadius: 7, border: '1px solid #E2E8F0' }}>
                            <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>탑정 유량 D (상부)</div>
                            <div style={{ fontSize: 14, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                              {distTotalKgH.toFixed(1)} kg/h
                            </div>
                            <div style={{ fontSize: 9.5, color: '#475569' }}>
                              {result.shortcutDesign.lkComp} {result.shortcutDesign.topLkPurityWtPct.toFixed(2)} wt% (회수 {result.shortcutDesign.topLkRecoveryPct}%)
                            </div>
                          </div>
                          <div style={{ background: '#F8FAFC', padding: '7px 9px', borderRadius: 7, border: '1px solid #E2E8F0' }}>
                            <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>탑저 유량 B (하부)</div>
                            <div style={{ fontSize: 14, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>
                              {botTotalKgH.toFixed(1)} kg/h
                            </div>
                            <div style={{ fontSize: 9.5, color: '#475569' }}>
                              {result.shortcutDesign.hkComp} {result.shortcutDesign.botHkPurityWtPct.toFixed(2)} wt% (회수 {result.shortcutDesign.botHkRecoveryPct}%)
                            </div>
                          </div>
                        </div>

                        {result.shortcutDesign.candidates &&
                          result.shortcutDesign.candidates.length > 0 &&
                          renderCandidateComparisonTable(result.shortcutDesign.candidates, 'design_stages')}
                      </div>
                    )}

                    {isFixedStages &&
                      result?.dualSpecCandidates &&
                      result.dualSpecCandidates.length > 0 &&
                      renderCandidateComparisonTable(result.dualSpecCandidates, 'dual_spec')}

                    {/* 응축기 / 리보일러 열수지 카드 */}
                    {result && (
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                        <div
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: '#F8FAFC',
                            border: '1px solid #CBD5E1',
                          }}
                        >
                          <div style={{ fontSize: 10.5, fontWeight: 800, color: '#475569' }}>
                            탑정 응축기 냉각열량 (Q_cond)
                          </div>
                          <div style={{ fontSize: 14.5, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 3 }}>
                            {(result.condenserDutyKcalH / 1000).toFixed(1)} Mcal/h
                          </div>
                          <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>
                            ({(result.condenserDutyKcalH / 860).toFixed(1)} kW · 탑정 {result.topTempC.toFixed(1)}°C)
                          </div>
                        </div>
                        <div
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: '#F8FAFC',
                            border: '1px solid #CBD5E1',
                          }}
                        >
                          <div style={{ fontSize: 10.5, fontWeight: 800, color: '#475569' }}>
                            탑저 리보일러 가열열량 (Q_reb)
                          </div>
                          <div style={{ fontSize: 14.5, fontWeight: 900, color: '#0F172A', fontFamily: MONO, marginTop: 3 }}>
                            +{(result.reboilerDutyKcalH / 1000).toFixed(1)} Mcal/h
                          </div>
                          <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>
                            ({(result.reboilerDutyKcalH / 860).toFixed(1)} kW · 탑저 {result.bottomTempC.toFixed(1)}°C)
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 탭 3: 압력·열역학·효율 */}
              {leftTab === 'pressure' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={cardStyle}>
                    <label style={labelStyle}>열역학 기액평형(VLE) 패키지 선택</label>
                    <select
                      value={thermoModel}
                      onChange={(e) =>
                        onChangeConfig({ thermoModel: e.target.value as DistillThermoModel })
                      }
                      style={selectBaseStyle}
                    >
                      <option value="AUTO">
                        자동 판별 (AUTO — 피드 성분에 따라 ENRTL / NRTL / PR / SRK 자동 선택)
                      </option>
                      <option value="ENRTL">
                        ENRTL 전해질 수용액 활동도 모델 (산·알칼리·염 수용액, 염석 및 압력변동 공비)
                      </option>
                      <option value="NRTL">
                        NRTL 비이상 액상 활동도 모델 (알코올·케톤·에스테르·ECH·클로로히드린·LLE 공비)
                      </option>
                      <option value="PR">
                        PR (Peng-Robinson 3차 상태방정식 — 탄화수소·BTX 방향족·액화 Cl₂/CO₂/AHCl)
                      </option>
                      <option value="SRK">
                        SRK (Soave-Redlich-Kwong 3차 상태방정식 — 수소·합성가스·에틸렌/프로필렌)
                      </option>
                      <option value="ELEC_HCL_AZEO">
                        ELEC_HCL_AZEO 압력변동 공비증류 전용 (진공 22.9% ↔ 상압 20.2% ↔ 가압 17.5% HCl)
                      </option>
                      <option value="PENG_ROB">
                        Peng-Robinson 호환 모드 (초고순도 무수염산 AHCl 고압 정제)
                      </option>
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 9 }}>
                    <div style={cardStyle}>
                      <label style={labelStyle}>탑정 압력 (kgf/cm²G)</label>
                      <BufferedNumberInput
                        syncKey={`${unitTag}-press`}
                        step={0.05}
                        min={-0.99}
                        max={35}
                        value={topPress}
                        onValueChange={(v) =>
                          onChangeConfig({
                            topPressKgcm2g: Math.max(-0.99, Math.min(35, v)),
                          })
                        }
                        onEnterRun={() => {
                          if (dofEvaluation.canRun) triggerRunSimulation();
                        }}
                        style={inputBaseStyle}
                      />
                      <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 4, fontFamily: MONO }}>
                        = {topBarA.toFixed(3)} barA ({topTorr.toFixed(0)} Torr)
                      </div>
                    </div>

                    <div style={cardStyle}>
                      <label style={labelStyle}>단당 ΔP (kgf/cm²/단)</label>
                      <BufferedNumberInput
                        syncKey={`${unitTag}-dp`}
                        step={0.001}
                        min={0}
                        max={0.05}
                        value={stageDp}
                        onValueChange={(v) =>
                          onChangeConfig({ stageDeltaPKgcm2: Math.max(0, v || 0) })
                        }
                        onEnterRun={() => {
                          if (dofEvaluation.canRun) triggerRunSimulation();
                        }}
                        style={inputBaseStyle}
                      />
                      <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 4, fontFamily: MONO }}>
                        탑저: {botPress.toFixed(3)} kG ({botBarA.toFixed(2)} barA)
                      </div>
                    </div>

                    <div style={cardStyle}>
                      <label style={labelStyle}>Murphree 단효율 (%)</label>
                      <BufferedNumberInput
                        syncKey={`${unitTag}-meff`}
                        step={5}
                        min={25}
                        max={100}
                        value={murphreeEff}
                        onValueChange={(v) =>
                          onChangeConfig({
                            murphreeEffPct: Math.max(25, Math.min(100, v || 75)),
                          })
                        }
                        onEnterRun={() => {
                          if (dofEvaluation.canRun) triggerRunSimulation();
                        }}
                        style={inputBaseStyle}
                      />
                      <select
                        value={stageInputBasis}
                        onChange={(e) =>
                          onChangeConfig({ stageInputBasis: e.target.value as DistillStageInputBasis })
                        }
                        style={{ ...selectBaseStyle, marginTop: 5, fontSize: 11, padding: '4px 6px' }}
                      >
                        <option value="theoretical">이론단 입력 → 실단 환산 (기본)</option>
                        <option value="actual_murphree">실제단 입력 → MESH 행렬 η_M 반영</option>
                      </select>
                      <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 4 }}>
                        {isActualMurphreeUi
                          ? `행렬 내 η_M 직접 적용 (실트레이 ${actualTrays}단 · 중복환산 없음)`
                          : `실제 트레이 ${actualTrays}단 산출 기준`}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>빠른 운전압력 적용:</span>
                    {[
                      { label: '고진공 60 Torr (-0.95 kG, ECH/DCH)', p: -0.95, dp: 0.0015 },
                      { label: '진공 115 Torr (-0.88 kG, 폐염산 농축)', p: -0.88, dp: 0.002 },
                      { label: '상압 (0.05 kG)', p: 0.05, dp: 0.004 },
                      { label: '가압 6.0 kG (폐염산 공비탈기)', p: 6.0, dp: 0.006 },
                      { label: '고압 17.6 kG (5N AHCl 정제)', p: 17.6, dp: 0.008 },
                    ].map((pr) => (
                      <button
                        key={pr.label}
                        type="button"
                        onClick={() => onChangeConfig({ topPressKgcm2g: pr.p, stageDeltaPKgcm2: pr.dp })}
                        style={{
                          padding: '4px 9px',
                          borderRadius: 6,
                          border: '1px solid #CBD5E1',
                          background: '#FFFFFF',
                          color: '#1E293B',
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {pr.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 하단 고정 요약: 탑정 유출(D) vs 탑저 관출(B) (+ 사이드컷 S) 물질수지 및 순도 표 */}
              {result && (() => {
                const sideCutOutMass = result.sideCutMassKgH ?? 0;
                const hasSideCutOut = sideCutOutMass > 1e-4 && Boolean(result.sideCutFlowsKgH);
                const scFlows = result.sideCutFlowsKgH;
                const scCompBreakdown = hasSideCutOut && scFlows
                  ? [...SIM_COMPS]
                      .map((ck) => ({
                        ck,
                        kgH: scFlows[ck] || 0,
                        wtPct: sideCutOutMass > 0 ? ((scFlows[ck] || 0) / sideCutOutMass) * 100 : 0,
                      }))
                      .filter((item) => item.kgH > 1e-4)
                      .sort((a, b) => b.kgH - a.kgH)
                      .slice(0, 4)
                  : [];

                return (
                <div style={cardStyle}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 7,
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>
                      {hasSideCutOut
                        ? '탑정(D) · 사이드컷(S) · 탑저(B) 물질수지 및 순도 요약'
                        : '탑정 유출(D) vs 탑저 관출(B) 물질수지 및 순도 요약'}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#1E3A8A', fontFamily: MONO }}>
                      D = {distTotalKgH.toFixed(1)} kg/h
                      {hasSideCutOut ? ` | S = ${sideCutOutMass.toFixed(1)} kg/h` : ''}
                      {` | B = ${botTotalKgH.toFixed(1)} kg/h`}
                      {result.decanterWaterDrawKgH > 0.005
                        ? ` | 💧 디캔터 수분 W = ${result.decanterWaterDrawKgH.toFixed(2)} kg/h`
                        : ''}
                    </span>
                  </div>

                  {hasSideCutOut && (
                    <div
                      style={{
                        marginBottom: 8,
                        padding: '7px 10px',
                        borderRadius: 7,
                        background: '#FAF5FF',
                        border: '1px solid #DDD6FE',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 6,
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#5B21B6' }}>
                          🟣 사이드컷 측류 (S)
                        </span>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#4C1D95', fontFamily: MONO }}>
                          {sideCutOutMass.toFixed(1)} kg/h (S/F {((result.actualSOverFMass ?? 0) * 100).toFixed(1)}%) ·{' '}
                          {result.sideCutStageUsed ?? '-'}단 ·{' '}
                          {result.sideCutTempC !== undefined ? `${result.sideCutTempC.toFixed(1)}°C` : '-'} ·{' '}
                          {result.sideCutPhase === 'G' ? '기상 (Vapor)' : '액상 (Liquid)'}
                        </span>
                      </div>
                      {scCompBreakdown.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: '#6D28D9' }}>주요 조성:</span>
                          {scCompBreakdown.map((item) => (
                            <span
                              key={item.ck}
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                fontFamily: MONO,
                                padding: '1px 6px',
                                borderRadius: 999,
                                background: '#FFFFFF',
                                border: '1px solid #E9D5FF',
                                color: '#4C1D95',
                              }}
                            >
                              {COMP_META[item.ck]?.formula ?? item.ck} {fmtConc(item.wtPct)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                      <thead>
                        <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
                          <th style={{ padding: '5px 8px', textAlign: 'left' }}>성분</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right' }}>탑정 D (kg/h)</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right' }}>탑정 농도</th>
                          {hasSideCutOut && (
                            <>
                              <th style={{ padding: '5px 8px', textAlign: 'right', color: '#6D28D9' }}>측류 S (kg/h)</th>
                              <th style={{ padding: '5px 8px', textAlign: 'right', color: '#6D28D9' }}>측류 농도</th>
                            </>
                          )}
                          <th style={{ padding: '5px 8px', textAlign: 'right' }}>탑저 B (kg/h)</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right' }}>탑저 농도</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeComps.map((ck) => {
                          const dKg = result.distillateFlowsKgH[ck] || 0;
                          const sKg = hasSideCutOut && scFlows ? (scFlows[ck] || 0) : 0;
                          const bKg = result.bottomsFlowsKgH[ck] || 0;
                          const dWt = distTotalKgH > 0 ? (dKg / distTotalKgH) * 100 : 0;
                          const sWt = hasSideCutOut && sideCutOutMass > 0 ? (sKg / sideCutOutMass) * 100 : 0;
                          const bWt = botTotalKgH > 0 ? (bKg / botTotalKgH) * 100 : 0;
                          return (
                            <tr key={ck} style={{ borderBottom: '1px solid #F1F5F9' }}>
                              <td style={{ padding: '5px 8px', fontWeight: 800, color: '#0F172A' }}>
                                {COMP_META[ck]?.formula ?? ck}
                              </td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: MONO, color: '#334155' }}>
                                {dKg.toFixed(2)}
                              </td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: MONO, fontWeight: 800, color: '#1D4ED8' }}>
                                {fmtConc(dWt)}
                              </td>
                              {hasSideCutOut && (
                                <>
                                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: MONO, color: '#5B21B6' }}>
                                    {sKg.toFixed(2)}
                                  </td>
                                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: MONO, fontWeight: 800, color: '#6D28D9' }}>
                                    {fmtConc(sWt)}
                                  </td>
                                </>
                              )}
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: MONO, color: '#334155' }}>
                                {bKg.toFixed(2)}
                              </td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: MONO, fontWeight: 800, color: '#0F172A' }}>
                                {fmtConc(bWt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                );
              })()}
            </div>
          </div>
          )}

          {/* 우측 패널: 단별 프로파일 차트 & Stage-by-Stage 테이블 */}
          {(!isMobile || mobilePane === 'results') && (
          <div
            style={{
              flex: isMobile ? '1 1 100%' : '1 1 390px',
              minWidth: 0,
              height: '100%',
              background: '#F6F7F2',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
          >
            {/* 차트 종류 전환 + 액상/기상 & 선형/ppm 로그 토글 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {(
                  [
                    { id: 'comp', label: '조성 프로파일' },
                    { id: 'temp', label: '온도 프로파일' },
                    { id: 'traffic', label: '기액유량(L/V)' },
                  ] as { id: RightChartId; label: string }[]
                ).map((ct) => {
                  const active = rightChart === ct.id;
                  return (
                    <button
                      key={ct.id}
                      type="button"
                      onClick={() => setRightChart(ct.id)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: active ? '1.5px solid #1E3A8A' : '1px solid #CBD5E1',
                        background: active ? '#1E3A8A' : '#FFFFFF',
                        color: active ? '#FFFFFF' : '#334155',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {ct.label}
                    </button>
                  );
                })}
              </div>

              {rightChart === 'comp' && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => setPhaseBasis((p) => (p === 'liq' ? 'vap' : 'liq'))}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 5,
                      border: '1px solid #CBD5E1',
                      background: '#FFFFFF',
                      color: '#1E293B',
                      fontSize: 10.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {phaseBasis === 'liq' ? '액상 x (wt%)' : '기상 y (wt%)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogScalePpm((v) => !v)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 5,
                      border: logScalePpm ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                      background: logScalePpm ? '#EFF6FF' : '#FFFFFF',
                      color: logScalePpm ? '#1D4ED8' : '#475569',
                      fontSize: 10.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {logScalePpm ? 'ppm 로그 스케일' : '선형 wt%'}
                  </button>
                </div>
              )}
            </div>

            {renderProfileSvg()}

            {/* 단별(Stage 1..N) 상세 수치 표 */}
            {(() => {
              const tableKeyComps =
                calcMode === 'design_stages' && result?.shortcutDesign
                  ? Array.from(new Set([result.shortcutDesign.lkComp, result.shortcutDesign.hkComp]))
                  : activeComps.slice(0, 2);
              return (
                <div
                  style={{
                    flex: 1,
                    minHeight: 170,
                    background: '#FFFFFF',
                    borderRadius: 8,
                    border: '1px solid #E2E8F0',
                    overflow: 'auto',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: MONO }}>
                    <thead>
                      <tr
                        style={{
                          position: 'sticky',
                          top: 0,
                          background: '#F1F5F9',
                          borderBottom: '1px solid #CBD5E1',
                          zIndex: 2,
                        }}
                      >
                        <th style={{ padding: '5px 7px', textAlign: 'left' }}>단(Stage)</th>
                        <th style={{ padding: '5px 7px', textAlign: 'right' }}>T (°C)</th>
                        <th style={{ padding: '5px 7px', textAlign: 'right' }}>P (barA)</th>
                        <th style={{ padding: '5px 7px', textAlign: 'right' }}>L (kg/h)</th>
                        <th style={{ padding: '5px 7px', textAlign: 'right' }}>V (kg/h)</th>
                        {tableKeyComps.map((ck) => (
                          <th key={ck} style={{ padding: '5px 7px', textAlign: 'right' }}>
                            x_{COMP_META[ck]?.formula ?? ck}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stages.map((st) => {
                        const isFeed = st.stage === primaryFeedStage;
                        const isSideCut = Boolean(st.isSideCutStage);
                        const scLiq = st.sideCutLiqKgH ?? 0;
                        const scVap = st.sideCutVapKgH ?? 0;
                        const scTooltip = isSideCut
                          ? `사이드컷 측류 인출: ${
                              scVap > 0 && scLiq > 0
                                ? `액상 ${scLiq.toFixed(1)} + 기상 ${scVap.toFixed(1)} kg/h`
                                : scVap > 0
                                ? `기상 ${scVap.toFixed(1)} kg/h`
                                : `액상 ${scLiq.toFixed(1)} kg/h`
                            }`
                          : undefined;
                        return (
                          <tr
                            key={st.stage}
                            title={scTooltip}
                            style={{
                              background: isSideCut ? '#F5F3FF' : isFeed ? '#FFFBEB' : 'transparent',
                              borderBottom: '1px solid #F1F5F9',
                              fontWeight: isFeed || isSideCut ? 800 : 500,
                            }}
                          >
                            <td style={{ padding: '4px 7px' }}>
                              {st.stage}
                              {st.stage === 1
                                ? ' (응축)'
                                : st.stage === stages.length
                                  ? ' (리보일)'
                                  : isFeed
                                    ? ' ★F'
                                    : ''}
                              {isSideCut && (
                                <span
                                  title={scTooltip}
                                  style={{
                                    marginLeft: 5,
                                    padding: '1px 5px',
                                    borderRadius: 999,
                                    background: '#EDE9FE',
                                    color: '#6D28D9',
                                    border: '1px solid #C4B5FD',
                                    fontSize: 9.2,
                                    fontWeight: 900,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  🟣 S측류
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '4px 7px', textAlign: 'right' }}>{st.tempC.toFixed(1)}</td>
                            <td style={{ padding: '4px 7px', textAlign: 'right' }}>{st.pressBarA.toFixed(2)}</td>
                            <td style={{ padding: '4px 7px', textAlign: 'right' }}>{st.liqMassKgH.toFixed(0)}</td>
                            <td style={{ padding: '4px 7px', textAlign: 'right' }}>{st.vapMassKgH.toFixed(0)}</td>
                            {tableKeyComps.map((ck) => (
                              <td key={ck} style={{ padding: '4px 7px', textAlign: 'right', color: '#1E3A8A' }}>
                                {fmtConc(st.xWtPct[ck] || 0)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
          )}
        </div>
        </>
        )}

        {/* ── 모바일 하단 고정 실행 · 닫기 액션 바 (원핸드 조작 보장) ── */}
        {isMobile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: '#0F172A',
              borderTop: '1px solid #334155',
              flexShrink: 0,
            }}
          >
            {onRunSimulation && (
              <button
                type="button"
                onClick={triggerRunSimulation}
                disabled={isRunningFeedback || !dofEvaluation.canRun}
                title={!dofEvaluation.canRun ? dofEvaluation.hint : '다단 MESH 시뮬레이션 실행'}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 7,
                  border: !dofEvaluation.canRun
                    ? '1px solid #64748B'
                    : isSimDirty
                    ? '1.5px solid #FDE047'
                    : '1px solid #60A5FA',
                  background: !dofEvaluation.canRun
                    ? '#475569'
                    : isRunningFeedback
                    ? '#1D4ED8'
                    : isSimDirty
                    ? '#D97706'
                    : '#2563EB',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: isRunningFeedback
                    ? 'wait'
                    : !dofEvaluation.canRun
                    ? 'not-allowed'
                    : 'pointer',
                  opacity: !dofEvaluation.canRun ? 0.65 : 1,
                  textAlign: 'center',
                }}
              >
                {isRunningFeedback
                  ? '⏳ 수렴 계산 중...'
                  : !dofEvaluation.canRun
                  ? '▶ RUN (자유도 확인)'
                  : isSimDirty
                  ? '▶ RUN 시뮬레이션 실행'
                  : '▶ RUN 재실행'}
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseModal}
              style={{
                flex: onRunSimulation ? '0 0 96px' : 1,
                padding: '9px 12px',
                borderRadius: 7,
                border: '1px solid #64748B',
                background: '#1E293B',
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              ✕ 닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
